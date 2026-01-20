/* ==========================================================
   bluetooth.js (v6.0 Integrity Version)
   - [보존] 기존 BLE 명령 큐(bleCommandQueue) 로직 완벽 유지
   - [보존] CPS 케이던스 계산 공식(Overflow 처리) 원복
   - [추가] CycleOps/Legacy 제어권 강제 탐색 (ERG 제어권 확보)
========================================================== */

// ── [1] UUID 상수 (Universal Dictionary) ──
const UUIDS = {
  // 1. 표준 FTMS
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', 
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  
  // 2. 파워미터/센서
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb', 
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  
  // 3. 구형/독자 규격 (필수 스캔 대상)
  CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
  CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592', 

  WAHOO_SERVICE:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  WAHOO_CONTROL:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',

  TACX_SERVICE:     '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  TACX_CONTROL:     '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
  
  HR_SERVICE:   '0000180d-0000-1000-8000-00805f9b34fb'
};

// [기존 유지] BLE 명령 큐 (안정성을 위해 삭제하지 않음)
window.bleCommandQueue = {
  queue: [],
  isProcessing: false,
  async enqueue(task) {
    this.queue.push(task);
    this.process();
  },
  async process() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;
    const task = this.queue.shift();
    try { await task(); } catch (e) { console.warn("[BLE] Cmd Fail", e); }
    this.isProcessing = false;
    if (this.queue.length > 0) setTimeout(() => this.process(), 100);
  }
};

// 전역 상태
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
window.connectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };
window._lastCadenceUpdateTime = {}; 
window._lastCrankData = { trainer: null, powerMeter: null }; 

// ── [2] UI 헬퍼 (기존 코드 유지) ──
window.showConnectionStatus = window.showConnectionStatus || function (show) {
  const el = document.getElementById("connectionStatus");
  if (el) el.classList.toggle("hidden", !show);
};

window.showToast = window.showToast || function (msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.classList.remove("hidden");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
};

window.updateDeviceButtonImages = window.updateDeviceButtonImages || function () {
  const updateBtn = (id, type, imgOn, imgOff) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    let img = btn.querySelector(".device-btn-icon");
    if (!img) {
      img = document.createElement("img");
      img.className = "device-btn-icon";
      const span = btn.querySelector("span");
      span ? btn.insertBefore(img, span) : btn.appendChild(img);
    }
    const isConnected = window.connectedDevices && window.connectedDevices[type];
    img.src = isConnected ? imgOn : imgOff;
    btn.classList.toggle("connected", !!isConnected);
    
    // ERG 모드 시 버튼 강조
    if (type === 'trainer' && window.ergController && window.ergController.state.enabled) {
        btn.classList.add('erg-mode-active');
    } else if (type === 'trainer') {
        btn.classList.remove('erg-mode-active');
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  };
  updateBtn("btnConnectTrainer", 'trainer', "assets/img/trainer_g.png", "assets/img/trainer_i.png");
  updateBtn("btnConnectHR", 'heartRate', "assets/img/bpm_g.png", "assets/img/bpm_i.png");
  updateBtn("btnConnectPM", 'powerMeter', "assets/img/power_g.png", "assets/img/power_i.png");
  
  if(typeof window.updateBluetoothConnectionButtonColor === 'function') window.updateBluetoothConnectionButtonColor();
};

window.updateBluetoothConnectionButtonColor = function() {
  const btnTrainer = document.getElementById("btnConnectTrainer");
  if (!btnTrainer) return;
  const isTrainerConnected = window.connectedDevices?.trainer;
  const isErgModeActive = window.ergController && window.ergController.state.enabled;
  
  if (isTrainerConnected && isErgModeActive) {
    btnTrainer.classList.add("erg-mode-active");
  } else {
    btnTrainer.classList.remove("erg-mode-active");
  }
};

window.updateDevicesList = function () {
  if (typeof updateDeviceButtonImages === 'function') updateDeviceButtonImages();
};

// ── [3] 스마트 트레이너 연결 (제어권 확보 로직 강화) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;
    console.log('[connectTrainer] Universal Scan 시작...');

    // ★ [핵심] 제어 관련 UUID를 optionalServices에 모두 포함시켜야 권한이 획득됨
    const optionalServices = [
      UUIDS.FTMS_SERVICE, UUIDS.FTMS_DATA, UUIDS.FTMS_CONTROL,
      UUIDS.CPS_SERVICE, UUIDS.CPS_DATA,
      UUIDS.CYCLEOPS_SERVICE, UUIDS.CYCLEOPS_CONTROL,
      UUIDS.WAHOO_SERVICE, UUIDS.WAHOO_CONTROL,
      UUIDS.TACX_SERVICE, UUIDS.TACX_CONTROL,
      "device_information"
    ];

    const filters = [
      { services: [UUIDS.FTMS_SERVICE] },
      { services: [UUIDS.CPS_SERVICE] },
      { namePrefix: "CycleOps" },
      { namePrefix: "Hammer" },
      { namePrefix: "Saris" },
      { namePrefix: "Wahoo" },
      { namePrefix: "Tacx" }
    ];

    try {
      device = await navigator.bluetooth.requestDevice({ filters, optionalServices });
    } catch (scanErr) {
      showConnectionStatus(false);
      if (scanErr.name !== 'NotFoundError') alert("❌ 검색 오류: " + scanErr.message);
      return;
    }

    const server = await device.gatt.connect();
    console.log('[connectTrainer] 연결 성공. 프로토콜 분석 중...');

    let dataChar = null;
    let controlChar = null; // 제어권(ERG) 핵심
    let realProtocol = 'UNKNOWN'; 

    // [Step 1] 제어 포인트(Control Point) 우선 탐색
    // (이전 코드에서는 데이터를 먼저 찾았지만, 제어권이 더 중요함)

    // 1-1. FTMS Control
    try {
      const s = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      controlChar = await s.getCharacteristic(UUIDS.FTMS_CONTROL);
      dataChar = await s.getCharacteristic(UUIDS.FTMS_DATA);
      realProtocol = 'FTMS';
      console.log('✅ FTMS 제어권 발견');
    } catch (e) {}

    // 1-2. Legacy CycleOps Control (FTMS가 없거나 실패 시)
    if (!controlChar) {
      try {
        const s = await server.getPrimaryService(UUIDS.CYCLEOPS_SERVICE);
        controlChar = await s.getCharacteristic(UUIDS.CYCLEOPS_CONTROL);
        realProtocol = 'CYCLEOPS';
        console.log('✅ CycleOps Legacy 제어권 발견');
        // 데이터 채널 확보
        if(!dataChar) {
             const chars = await s.getCharacteristics();
             if(chars.length) dataChar = chars[0];
        }
      } catch (e) {}
    }

    // 1-3. Legacy Wahoo Control
    if (!controlChar) {
      try {
        const s = await server.getPrimaryService(UUIDS.WAHOO_SERVICE);
        controlChar = await s.getCharacteristic(UUIDS.WAHOO_CONTROL);
        realProtocol = 'WAHOO';
        console.log('✅ Wahoo Legacy 제어권 발견');
        if(!dataChar) {
             const chars = await s.getCharacteristics();
             if(chars.length) dataChar = chars[0];
        }
      } catch (e) {}
    }

    // [Step 2] 데이터 채널 최종 확보 (CPS Fallback)
    if (!dataChar) {
       try {
         const s = await server.getPrimaryService(UUIDS.CPS_SERVICE);
         dataChar = await s.getCharacteristic(UUIDS.CPS_DATA);
         if (realProtocol === 'UNKNOWN') realProtocol = 'CPS';
         console.log('ℹ️ CPS 데이터 채널 연결 (제어권 확인 필요)');
       } catch (e) {
         try {
            const s = await server.getPrimaryService(UUIDS.CSC_SERVICE);
            dataChar = await s.getCharacteristic(0x2A5B);
         } catch(fatal) {}
       }
    }

    if (!dataChar) throw new Error("데이터 서비스를 찾을 수 없습니다.");

    await dataChar.startNotifications();
    
    // 파서 선택: FTMS만 표준 파서, 나머지는 CPS(PowerMeter) 파서 사용
    // ★ CycleOps는 CPS 포맷으로 데이터를 쏘므로 handlePowerMeterData를 써야 케이던스가 나옴
    const parser = (realProtocol === 'FTMS') ? handleTrainerData : handlePowerMeterData;
    dataChar.addEventListener("characteristicvaluechanged", parser);

    window.connectedDevices.trainer = { 
      name: device.name, device, server, 
      characteristic: dataChar,
      controlPoint: controlChar,
      protocol: realProtocol
    };

    if (window.ergController) window.ergController.updateConnectionStatus('connected');
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    updateDevicesList();
    showConnectionStatus(false);
    
    const statusMsg = controlChar ? "(ERG 제어 가능)" : "(파워미터 모드 - 제어 불가)";
    showToast(`✅ ${device.name} 연결 [${realProtocol}] ${statusMsg}`);

  } catch (err) {
    showConnectionStatus(false);
    console.error(err);
    alert("❌ 연결 실패: " + err.message);
  }
}

// ── [4] 심박/파워미터 (기존 동일) ──

async function connectHeartRate() {
  try {
    showConnectionStatus(true);
    let device;
    try {
        device = await navigator.bluetooth.requestDevice({
            filters: [{ services: ['heart_rate'] }],
            optionalServices: ['heart_rate', UUIDS.HR_SERVICE, 'battery_service']
        });
    } catch(e) {
        device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [UUIDS.HR_SERVICE] }],
            optionalServices: [UUIDS.HR_SERVICE]
        });
    }
    const server = await device.gatt.connect();
    let service;
    try { service = await server.getPrimaryService('heart_rate'); } 
    catch (e) { service = await server.getPrimaryService(UUIDS.HR_SERVICE); }
    let characteristic;
    try { characteristic = await service.getCharacteristic('heart_rate_measurement'); }
    catch (e) { characteristic = await service.getCharacteristic(0x2A37); }
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handleHeartRateData);
    window.connectedDevices.heartRate = { name: device.name, device, server, characteristic };
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('heartRate', device));
    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결 성공`);
  } catch (err) {
    showConnectionStatus(false);
    alert("심박계 오류: " + err.message);
  }
}

async function connectPowerMeter() {
  if (window.connectedDevices.trainer && !confirm("트레이너가 이미 연결됨. 파워미터로 교체?")) return;
  try {
    showConnectionStatus(true);
    let device;
    const filters = [{ services: [UUIDS.CPS_SERVICE] }, { services: [UUIDS.CSC_SERVICE] }];
    device = await navigator.bluetooth.requestDevice({ filters, optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE] });
    const server = await device.gatt.connect();
    let service, characteristic;
    try {
        service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
    } catch (e) {
        service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
        characteristic = await service.getCharacteristic(0x2A5B);
    }
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handlePowerMeterData);
    window.connectedDevices.powerMeter = { name: device.name, device, server, characteristic };
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('powerMeter', device));
    updateDevicesList();
    showConnectionStatus(false);
    window._lastCrankData['powerMeter'] = null; // 초기화
    showToast(`✅ ${device.name} 연결 성공`);
  } catch (err) {
    showConnectionStatus(false);
    alert("파워미터 오류: " + err.message);
  }
}

// ── [5] 데이터 처리 (★ 복구된 로직) ──

// FTMS 파서
function handleTrainerData(e) {
  const dv = e.target.value;
  if (dv.byteLength < 4) return;
  const flags = dv.getUint16(0, true); 
  let off = 2; // Flags
  
  // Speed (Mandatory)
  off += 2;
  // Avg Speed
  if (flags & 0x0002) off += 2;
  // Cadence (Bit 2)
  if (flags & 0x0004) {
    const cadenceRaw = dv.getUint16(off, true);
    off += 2;
    const rpm = Math.round(cadenceRaw * 0.5);
    window.liveData.cadence = rpm;
    notifyChildWindows('cadence', rpm);
    window._lastCadenceUpdateTime['trainer'] = Date.now();
  }
  // ... Skip others
  if (flags & 0x0008) off += 2;
  if (flags & 0x0010) off += 3;
  if (flags & 0x0020) off += 2;

  // Power (Bit 6)
  if (flags & 0x0040) {
    const p = dv.getInt16(off, true);
    off += 2;
    if (!Number.isNaN(p)) {
      window.liveData.power = p;
      notifyChildWindows('power', p);
      if(window.ergController) window.ergController.updatePower(p);
    }
  }
}

// CPS (파워미터 & CycleOps) 파서 - ★ 원본 케이던스 계산 로직 100% 복구
function handlePowerMeterData(event) {
  const dv = event.target.value;
  const flags = dv.getUint16(0, true); 
  let off = 2;
  
  // Power (Mandatory)
  const instPower = dv.getInt16(off, true); 
  off += 2;
  if (!Number.isNaN(instPower)) {
    window.liveData.power = instPower;
    notifyChildWindows('power', instPower);
    if(window.ergController) window.ergController.updatePower(instPower);
  }
  
  // Optional Fields
  if (flags & 0x0001) off += 1;
  if (flags & 0x0004) off += 2;
  if (flags & 0x0010) off += 6;
  
  // ★ Cumulative Crank Revolution (Bit 5: 0x0020)
  if (flags & 0x0020) {
    const cumulativeCrank = dv.getUint16(off, true); 
    off += 2;
    const lastEventTime = dv.getUint16(off, true); // 1/1024s
    off += 2;
    
    // 케이던스 계산 (원본 로직)
    const deviceKey = window.connectedDevices.trainer ? 'trainer' : 'powerMeter';
    const lastData = window._lastCrankData[deviceKey];
    
    if (lastData) { // 첫 데이터가 아닐 때만 계산
      let timeDiff = lastEventTime - lastData.lastEventTime;
      if (timeDiff < 0) timeDiff += 65536; // Overflow
      
      let revDiff = cumulativeCrank - lastData.cumulativeCrank;
      if (revDiff < 0) revDiff += 65536; // Overflow
      
      if (timeDiff > 0 && revDiff > 0) {
        const timeInSeconds = timeDiff / 1024.0;
        const cadence = Math.round((revDiff / timeInSeconds) * 60);
        
        if (cadence >= 0 && cadence <= 250) {
          window.liveData.cadence = cadence;
          window._lastCadenceUpdateTime[deviceKey] = Date.now();
          notifyChildWindows('cadence', cadence);
        }
      }
    }
    
    window._lastCrankData[deviceKey] = {
      cumulativeCrank,
      lastEventTime,
      ts: Date.now()
    };
  }
}

function handleHeartRateData(event) {
  const dv = event.target.value;
  const flags = dv.getUint8(0);
  const hr = (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
  window.liveData.heartRate = hr;
  notifyChildWindows('heartRate', hr);
}

// ── [6] 유틸리티 ──
function handleDisconnect(type, device) {
  console.log(`${type} 연결 해제`);
  if (window.connectedDevices[type]?.device === device) {
    window.connectedDevices[type] = null;
    if (type === 'trainer' && window.ergController) window.ergController.updateConnectionStatus('disconnected');
  }
  updateDevicesList();
}
function notifyChildWindows(field, value) {
  if (!window._bluetoothChildWindows) return;
  window._bluetoothChildWindows = window._bluetoothChildWindows.filter(w => !w.closed);
  window._bluetoothChildWindows.forEach(w => {
    w.postMessage({ type: 'bluetoothLiveDataUpdate', updatedField: field, updatedValue: value, ...window.liveData }, '*');
  });
}
window.addEventListener("beforeunload", () => {
  try {
    if (connectedDevices.trainer?.server?.connected) connectedDevices.trainer.device.gatt.disconnect();
  } catch (e) {}
});

// 케이던스 0 처리 (3초 타임아웃)
setInterval(() => {
    const now = Date.now();
    const lastT = window._lastCrankData.trainer?.ts || 0;
    if (now - lastT > 3000 && window.liveData.cadence > 0) {
        window.liveData.cadence = 0;
        notifyChildWindows('cadence', 0);
    }
}, 1000);

window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
window.setTargetPower = function(watts) {
    if (window.ergController) window.ergController.setTargetPower(watts);
};
