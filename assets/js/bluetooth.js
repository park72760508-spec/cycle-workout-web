/* ==========================================================
   bluetooth.js (v4.1 Final Integrity Ver)
   - 기존 UI 및 보조 기능(Toast, Icon, Color 등) 100% 유지
   - 핵심 수정 1: FTMS Control Point '구독(startNotifications)' 추가 (ERG 먹통 해결)
   - 핵심 수정 2: 케이던스 0.5 RPM 단위 및 필수 속도 오프셋 보정 (데이터 표시 해결)
========================================================== */

// ── [1] UUID 상수 (만능 리스트 유지) ──
const UUIDS = {
  // 1. 표준 FTMS
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', 
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  
  // 2. 파워미터/센서 (CPS, CSC)
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb', 
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  
  // 3. 구형/독자 규격 서비스 (Legacy)
  // CycleOps (VirtualTraining)
  CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
  CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592', 

  // Wahoo Fitness (Legacy)
  WAHOO_SERVICE:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  WAHOO_CONTROL:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',

  // Tacx FE-C over BLE
  TACX_SERVICE:     '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  TACX_CONTROL:     '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
  
  // Heart Rate
  HR_SERVICE:   '0000180d-0000-1000-8000-00805f9b34fb'
};

// BLE 명령 큐 (기존 유지)
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

// 전역 상태 변수 (기존 유지)
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
window.connectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };
window._lastCadenceUpdateTime = {};
window._lastCrankData = {}; 

// ── [2] UI 헬퍼 함수들 (삭제 없이 전면 유지) ──

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

// 버튼 아이콘 교체 로직 (기존 유지)
window.updateDeviceButtonImages = window.updateDeviceButtonImages || function () {
  const btnTrainer = document.getElementById("btnConnectTrainer");
  const btnHR = document.getElementById("btnConnectHR");
  const btnPM = document.getElementById("btnConnectPM");
  
  const updateBtn = (btn, type, imgOn, imgOff) => {
    if (!btn) return;
    let img = btn.querySelector(".device-btn-icon");
    if (!img) {
      img = document.createElement("img");
      img.className = "device-btn-icon";
      const span = btn.querySelector("span");
      span ? btn.insertBefore(img, span) : btn.appendChild(img);
    }
    const isConnected = window.connectedDevices && window.connectedDevices[type];
    if (isConnected) {
      img.src = imgOn;
      btn.classList.add("connected");
    } else {
      img.src = imgOff;
      btn.classList.remove("connected");
      btn.classList.remove("erg-mode-active");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  };
  updateBtn(btnTrainer, 'trainer', "assets/img/trainer_g.png", "assets/img/trainer_i.png");
  updateBtn(btnHR, 'heartRate', "assets/img/bpm_g.png", "assets/img/bpm_i.png");
  updateBtn(btnPM, 'powerMeter', "assets/img/power_g.png", "assets/img/power_i.png");
  
  // ERG 모드 상태에 따른 버튼 색상 업데이트
  updateBluetoothConnectionButtonColor();
};

function updateBluetoothConnectionButtonColor() {
  const btnTrainer = document.getElementById("btnConnectTrainer");
  if (!btnTrainer) return;
  
  const isTrainerConnected = window.connectedDevices?.trainer;
  const isErgModeActive = (window.ergModeState && window.ergModeState.enabled) ||
                          (window.ergController && window.ergController.state.enabled);
  
  if (isTrainerConnected && isErgModeActive) {
    btnTrainer.classList.add("erg-mode-active");
  } else {
    btnTrainer.classList.remove("erg-mode-active");
  }
}
window.updateBluetoothConnectionButtonColor = updateBluetoothConnectionButtonColor;

window.updateDevicesList = function () {
  if (typeof updateDeviceButtonImages === 'function') updateDeviceButtonImages();
};

// ── [3] 스마트 트레이너 연결 (★ 핵심 수정 적용됨) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;
    console.log('[connectTrainer] Universal Scan 시작...');

    const filters = [
      { services: [UUIDS.FTMS_SERVICE] },
      { services: [UUIDS.CPS_SERVICE] },
      { namePrefix: "CycleOps" },
      { namePrefix: "Hammer" },
      { namePrefix: "Saris" },
      { namePrefix: "Magnus" },
      { namePrefix: "Wahoo" },
      { namePrefix: "KICKR" }
    ];

    const optionalServices = [
      UUIDS.FTMS_SERVICE, UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE,
      UUIDS.CYCLEOPS_SERVICE, UUIDS.WAHOO_SERVICE, UUIDS.TACX_SERVICE,
      "device_information"
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

    let service, characteristic, controlPointChar = null;
    let realProtocol = 'UNKNOWN'; // 'FTMS' | 'CYCLEOPS' | 'WAHOO' | 'CPS'

    // [Step 1] 표준 FTMS 탐색
    try {
      service = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA);
      realProtocol = 'FTMS';
      try { 
          controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL);
          console.log('✅ 표준 FTMS Control Point 발견');
      } catch(e) { console.warn('FTMS Control Point 없음'); }
    } catch (e) {}

    // [Step 2] Legacy Control Point 탐색 (표준 실패 시)
    if (!controlPointChar) {
      // CycleOps
      try {
        const legacySvc = await server.getPrimaryService(UUIDS.CYCLEOPS_SERVICE);
        controlPointChar = await legacySvc.getCharacteristic(UUIDS.CYCLEOPS_CONTROL);
        realProtocol = 'CYCLEOPS';
        const chars = await legacySvc.getCharacteristics();
        if (chars.length > 0) characteristic = chars[0];
        console.log('✅ CycleOps Legacy 발견');
      } catch (e) {
        // Wahoo
        try {
          const wahooSvc = await server.getPrimaryService(UUIDS.WAHOO_SERVICE);
          controlPointChar = await wahooSvc.getCharacteristic(UUIDS.WAHOO_CONTROL);
          realProtocol = 'WAHOO';
          const chars = await wahooSvc.getCharacteristics();
          if (chars.length > 0) characteristic = chars[0];
          console.log('✅ Wahoo Legacy 발견');
        } catch (e2) {}
      }
    }

    // [Step 3] 데이터 채널 확보 (CPS 폴백)
    if (!characteristic) {
       try {
         service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
         characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
         if (realProtocol === 'UNKNOWN') realProtocol = 'CPS';
       } catch (e) {
         try {
            service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
            characteristic = await service.getCharacteristic(0x2A5B);
         } catch(fatal) {}
       }
    }

    if (!characteristic) throw new Error("데이터 서비스를 찾을 수 없습니다.");

    // ★ [ERG 수정] Control Point가 있으면 반드시 startNotifications()를 호출해야 함!
    // 이것이 없으면 트레이너가 제어 명령을 무시합니다.
    if (controlPointChar) {
        try {
            await controlPointChar.startNotifications();
            console.log('🔓 Control Point 구독 성공 (제어 준비 완료)');
        } catch (subErr) {
            console.warn('Control Point 구독 실패 (단방향일 수 있음):', subErr);
        }
    }

    // 데이터 알림 시작
    await characteristic.startNotifications();
    
    // 데이터 파서 연결 (수정된 파서 사용)
    const parser = (realProtocol === 'FTMS') ? handleTrainerData : handlePowerMeterData;
    characteristic.addEventListener("characteristicvaluechanged", parser);

    // UI 호환성을 위한 프로토콜 위장
    const name = (device.name || "").toUpperCase();
    let fakeProtocol = realProtocol;
    if (name.includes("CYCLEOPS") || name.includes("HAMMER") || name.includes("WAHOO") || realProtocol === 'CYCLEOPS' || realProtocol === 'WAHOO') {
        fakeProtocol = 'FTMS'; 
    }

    window.connectedDevices.trainer = { 
      name: device.name, device, server, characteristic,
      controlPoint: controlPointChar,
      protocol: fakeProtocol,
      realProtocol: realProtocol
    };

    if (typeof updateErgModeUI === 'function') updateErgModeUI(!!controlPointChar);
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    updateDevicesList();
    showConnectionStatus(false);
    
    const ergMsg = controlPointChar ? "(ERG 제어 가능)" : "(파워미터 모드)";
    showToast(`✅ ${device.name} 연결 [${realProtocol}]`);

  } catch (err) {
    showConnectionStatus(false);
    console.error(err);
    alert("❌ 연결 실패: " + err.message);
  }
}

// ── [4] 심박/파워미터 (기존 로직 유지) ──

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
    showToast(`✅ ${device.name} 연결 성공`);
  } catch (err) {
    showConnectionStatus(false);
    alert("파워미터 오류: " + err.message);
  }
}

// ── [5] ERG 제어 (Wrapper) ──
window.setTargetPower = function(targetWatts) {
    if (window.ergController) {
        window.ergController.setTargetPower(targetWatts);
    } else {
        console.warn("ErgController not found!");
    }
};

// ── [6] 데이터 처리 (★ 케이던스 오류 수정 적용) ──

/**
 * FTMS 데이터 파싱 (케이던스 복구)
 */
function handleTrainerData(e) {
  const dv = e.target.value;
  if (dv.byteLength < 4) return;

  let off = 0;
  const flags = dv.getUint16(off, true); 
  off += 2; // Flags

  // 1. Instantaneous Speed (MANDATORY)
  // 대부분의 FTMS 구현체에서 속도 값은 플래그와 무관하게 존재하거나, 
  // 플래그 체크 순서상 가장 먼저 2바이트를 차지합니다.
  off += 2; 

  // 2. Average Speed (Flag Bit 1: 0x0002)
  if (flags & 0x0002) {
    off += 2;
  }

  // 3. Instantaneous Cadence (Flag Bit 2: 0x0004)
  if (flags & 0x0004) {
    // ★ 수정: 케이던스는 Uint16 (2바이트)이며 단위는 0.5 RPM
    const cadenceRaw = dv.getUint16(off, true);
    off += 2;
    
    const rpm = Math.round(cadenceRaw * 0.5);
    if (rpm >= 0 && rpm <= 250) {
      window.liveData.cadence = rpm;
      notifyChildWindows('cadence', rpm);
      window._lastCadenceUpdateTime['trainer'] = Date.now();
    }
  }

  // 4. Average Cadence (0x0008)
  if (flags & 0x0008) off += 2;

  // 5. Total Distance (0x0010) - Uint24
  if (flags & 0x0010) off += 3;

  // 6. Resistance Level (0x0020)
  if (flags & 0x0020) off += 2;

  // 7. Instantaneous Power (0x0040)
  if (flags & 0x0040) {
    const p = dv.getInt16(off, true);
    off += 2;
    if (!Number.isNaN(p)) {
      window.liveData.power = p;
      notifyChildWindows('power', p);
    }
  }
}

/**
 * 파워미터/CPS 데이터 파싱 (안전장치 추가)
 */
function handlePowerMeterData(event) {
  const dv = event.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); 
  off += 2;
  
  // Instantaneous Power (Mandatory)
  const instPower = dv.getInt16(off, true); 
  off += 2;
  
  if (!Number.isNaN(instPower)) {
    window.liveData.power = instPower;
    notifyChildWindows('power', instPower);
  }
  
  // Optional 필드들 순차 처리
  if (flags & 0x0001) off += 1; // Pedal Power Balance
  if (flags & 0x0004) off += 2; // Accumulated Torque
  if (flags & 0x0010) off += 6; // Wheel Revolution
  
  // Crank Revolution (케이던스 계산)
  if (flags & 0x0020) {
    const cumulativeCrankRevolutions = dv.getUint16(off, true); 
    off += 2;
    const lastCrankEventTime = dv.getUint16(off, true); 
    off += 2;
    
    const deviceKey = window.connectedDevices.trainer ? 'trainer' : 'powerMeter';
    const lastData = window._lastCrankData[deviceKey];
    
    if (lastData && lastCrankEventTime !== lastData.lastCrankEventTime) {
      let timeDiff = lastCrankEventTime - lastData.lastCrankEventTime;
      if (timeDiff < 0) timeDiff += 65536;
      
      let revDiff = cumulativeCrankRevolutions - lastData.cumulativeCrankRevolutions;
      if (revDiff < 0) revDiff += 65536;
      
      if (timeDiff > 0 && revDiff > 0) {
        const timeInSeconds = timeDiff / 1024.0;
        const cadence = Math.round((revDiff / timeInSeconds) * 60);
        
        if (cadence > 0 && cadence <= 250) {
          window.liveData.cadence = cadence;
          window._lastCadenceUpdateTime[deviceKey] = Date.now();
          notifyChildWindows('cadence', cadence);
        }
      }
    }
    
    window._lastCrankData[deviceKey] = {
      cumulativeCrankRevolutions,
      lastCrankEventTime,
      timestamp: Date.now()
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

// ── [7] 유틸리티 및 종료 처리 (기존 유지) ──

function handleDisconnect(type, device) {
  console.log(`${type} 연결 해제`);
  if (window.connectedDevices[type]?.device === device) {
    window.connectedDevices[type] = null;
    if (type === 'trainer' && typeof updateErgModeUI === 'function') updateErgModeUI(false);
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

// 데이터 타임아웃 처리 (케이던스 0 초기화)
setInterval(() => {
    const now = Date.now();
    if (window.liveData.cadence > 0) {
        const lastT = window._lastCadenceUpdateTime.trainer || 0;
        const lastP = window._lastCadenceUpdateTime.powerMeter || 0;
        if (now - Math.max(lastT, lastP) > 3000) {
            window.liveData.cadence = 0;
            notifyChildWindows('cadence', 0);
        }
    }
}, 1000);

window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
