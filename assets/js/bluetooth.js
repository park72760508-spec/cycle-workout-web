/* ==========================================================
   bluetooth.js (v5.2 Final Integrity)
   - 기존 UI/기능 100% 포함 (토스트, 아이콘, 연결상태 등)
   - ERG 제어권(Control Point) 심층 탐색 로직 탑재
   - 연결 즉시 버튼 색상(녹색) 변경 강제 수행
========================================================== */

// ── [1] UUID 상수 (모든 장비 호환용) ──
const UUIDS = {
  // FTMS (표준)
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', 
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  
  // 파워미터/센서
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb', 
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  
  // 레거시 (CycleOps, Wahoo, Tacx 등)
  CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
  CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592', 
  WAHOO_SERVICE:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  WAHOO_CONTROL:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  TACX_SERVICE:     '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  TACX_CONTROL:     '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
  
  HR_SERVICE:       '0000180d-0000-1000-8000-00805f9b34fb'
};

// BLE 명령 큐 (기존 기능 유지)
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

// 전역 데이터 (기존 기능 유지)
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
window.connectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };
window._lastCadenceUpdateTime = {};
window._lastCrankData = {}; 

// ── [2] UI 헬퍼 함수 (기존 기능 100% 유지 + 강화) ──

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

// ★ 버튼 이미지/색상 업데이트 (강화됨: 없는 이미지 자동 생성)
window.updateDeviceButtonImages = window.updateDeviceButtonImages || function () {
  const btnTrainer = document.getElementById("btnConnectTrainer");
  const btnHR = document.getElementById("btnConnectHR");
  const btnPM = document.getElementById("btnConnectPM");
  
  const updateBtn = (btn, type, imgOn, imgOff) => {
    if (!btn) return;
    
    // 이미지 태그 찾거나 생성
    let img = btn.querySelector("img.device-btn-icon") || btn.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      img.className = "device-btn-icon";
      const span = btn.querySelector("span");
      span ? btn.insertBefore(img, span) : btn.appendChild(img);
    } else {
      img.classList.add("device-btn-icon");
    }
    
    const isConnected = window.connectedDevices && window.connectedDevices[type];
    
    // 연결 상태 반영
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
  
  // ERG 활성화 시 파란색 테두리 등 효과
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

// app.js 호환용 래퍼
window.updateDevicesList = function () {
  if (typeof updateDeviceButtonImages === 'function') updateDeviceButtonImages();
};

// ── [3] 스마트 트레이너 연결 (핵심 로직 개선) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    console.log('[connectTrainer] 장치 검색 시작...');

    // 1. 필터 및 옵션 설정 (모든 가능성 열어둠)
    const filters = [
      { services: [UUIDS.FTMS_SERVICE] },
      { services: [UUIDS.CPS_SERVICE] },
      { namePrefix: "CycleOps" }, { namePrefix: "Hammer" }, { namePrefix: "Saris" }, 
      { namePrefix: "Wahoo" }, { namePrefix: "KICKR" }, { namePrefix: "Tacx" }
    ];
    const optionalServices = [
      UUIDS.FTMS_SERVICE, UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE,
      UUIDS.CYCLEOPS_SERVICE, UUIDS.WAHOO_SERVICE, UUIDS.TACX_SERVICE,
      "device_information"
    ];

    // 2. 장치 선택
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({ filters, optionalServices });
    } catch (scanErr) {
      showConnectionStatus(false);
      if (scanErr.name !== 'NotFoundError') alert("❌ 검색 취소/오류: " + scanErr.message);
      return;
    }

    const server = await device.gatt.connect();
    console.log('[connectTrainer] GATT 연결됨. 서비스 분석 중...');

    let service, characteristic, controlPointChar = null;
    let realProtocol = 'UNKNOWN';

    // 3. 제어권(Control Point) 탐색 - 3단계 깊이 우선 탐색
    // [Step A] 표준 FTMS
    try {
      service = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA);
      realProtocol = 'FTMS';
      try { 
          controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL);
          console.log('✅ FTMS Control Point 발견');
      } catch(e) {}
    } catch (e) {}

    // [Step B] Legacy (CycleOps/Wahoo/Tacx) - FTMS 실패 시 시도
    if (!controlPointChar) {
      try { // CycleOps
        const s = await server.getPrimaryService(UUIDS.CYCLEOPS_SERVICE);
        controlPointChar = await s.getCharacteristic(UUIDS.CYCLEOPS_CONTROL);
        realProtocol = 'CYCLEOPS';
        if(!characteristic) characteristic = (await s.getCharacteristics())[0];
        console.log('✅ CycleOps Control Point 발견');
      } catch (e) {}
    }
    if (!controlPointChar) {
      try { // Wahoo
        const s = await server.getPrimaryService(UUIDS.WAHOO_SERVICE);
        controlPointChar = await s.getCharacteristic(UUIDS.WAHOO_CONTROL);
        realProtocol = 'WAHOO';
        if(!characteristic) characteristic = (await s.getCharacteristics())[0];
        console.log('✅ Wahoo Control Point 발견');
      } catch (e) {}
    }

    // [Step C] 데이터 전용 (제어 불가, 최후의 수단)
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

    // 4. 알림 구독 (데이터 & 제어 응답)
    if (controlPointChar) {
        try {
            await controlPointChar.startNotifications();
            console.log('🔓 Control Point 구독 성공');
        } catch (subErr) {
            console.warn('Control Point 구독 실패 (쓰기 전용 가능성):', subErr);
        }
    } else {
        console.warn("⚠️ 경고: 제어권(Control Point)을 찾지 못했습니다. ERG 불가.");
    }

    await characteristic.startNotifications();
    const parser = (realProtocol === 'FTMS') ? handleTrainerData : handlePowerMeterData;
    characteristic.addEventListener("characteristicvaluechanged", parser);

    // 5. 프로토콜 UI 위장 (호환성)
    const name = (device.name || "").toUpperCase();
    let fakeProtocol = realProtocol;
    if (['CYCLEOPS', 'WAHOO', 'TACX'].includes(realProtocol)) fakeProtocol = 'FTMS'; 

    window.connectedDevices.trainer = { 
      name: device.name, device, server, characteristic,
      controlPoint: controlPointChar,
      protocol: fakeProtocol,
      realProtocol: realProtocol
    };

    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    // ★ [핵심] 연결 성공 즉시 버튼 색상 변경 (녹색)
    if (typeof updateDevicesList === 'function') updateDevicesList();
    
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결됨 [${realProtocol}]`);

  } catch (err) {
    showConnectionStatus(false);
    console.error(err);
    alert("❌ 연결 실패: " + err.message);
  }
}

// ── [4] 심박/파워미터 연결 (기존 기능 유지) ──

async function connectHeartRate() {
  try {
    showConnectionStatus(true);
    const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }], optionalServices: ['heart_rate', UUIDS.HR_SERVICE]
    });
    const server = await device.gatt.connect();
    let s = await server.getPrimaryService('heart_rate').catch(()=>server.getPrimaryService(UUIDS.HR_SERVICE));
    let c = await s.getCharacteristic('heart_rate_measurement').catch(()=>s.getCharacteristic(0x2A37));
    await c.startNotifications();
    c.addEventListener("characteristicvaluechanged", handleHeartRateData);
    
    window.connectedDevices.heartRate = { name: device.name, device, server, characteristic: c };
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('heartRate', device));
    updateDevicesList(); showConnectionStatus(false); showToast(`✅ ${device.name} 연결됨`);
  } catch (err) { showConnectionStatus(false); alert("심박계 오류: " + err.message); }
}

async function connectPowerMeter() {
  if (window.connectedDevices.trainer && !confirm("트레이너가 연결되어 있습니다. 교체하시겠습니까?")) return;
  try {
    showConnectionStatus(true);
    const device = await navigator.bluetooth.requestDevice({ 
        filters: [{ services: [UUIDS.CPS_SERVICE] }], optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE] 
    });
    const server = await device.gatt.connect();
    const s = await server.getPrimaryService(UUIDS.CPS_SERVICE);
    const c = await s.getCharacteristic(UUIDS.CPS_DATA);
    await c.startNotifications();
    c.addEventListener("characteristicvaluechanged", handlePowerMeterData);
    
    window.connectedDevices.powerMeter = { name: device.name, device, server, characteristic: c };
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('powerMeter', device));
    updateDevicesList(); showConnectionStatus(false); showToast(`✅ ${device.name} 연결됨`);
  } catch (err) { showConnectionStatus(false); alert("파워미터 오류: " + err.message); }
}

// ── [5] 데이터 파서 (케이던스 오류 수정본 포함) ──

function handleTrainerData(e) {
  const dv = e.target.value;
  if (dv.byteLength < 4) return;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  off += 2; // Speed (Mandatory)
  if (flags & 0x0002) off += 2; // Avg Speed
  
  // Cadence (Bit 2)
  if (flags & 0x0004) {
    const rpm = Math.round(dv.getUint16(off, true) * 0.5); // 0.5 unit
    off += 2;
    if (rpm >= 0 && rpm <= 250) {
      window.liveData.cadence = rpm;
      notifyChildWindows('cadence', rpm);
      window._lastCadenceUpdateTime['trainer'] = Date.now();
    }
  }
  if (flags & 0x0008) off += 2;
  if (flags & 0x0010) off += 3;
  if (flags & 0x0020) off += 2;
  
  // Power (Bit 6)
  if (flags & 0x0040) {
    const p = dv.getInt16(off, true);
    if (!Number.isNaN(p)) { window.liveData.power = p; notifyChildWindows('power', p); }
  }
}

function handlePowerMeterData(e) {
  const dv = e.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  const p = dv.getInt16(off, true); off += 2;
  if (!Number.isNaN(p)) { window.liveData.power = p; notifyChildWindows('power', p); }
  
  if (flags & 0x0001) off += 1;
  if (flags & 0x0004) off += 2;
  if (flags & 0x0010) off += 6;
  
  if (flags & 0x0020) { // Crank Data
    const revs = dv.getUint16(off, true); off += 2;
    const time = dv.getUint16(off, true); off += 2;
    const last = window._lastCrankData.powerMeter;
    if (last && time !== last.time) {
        let dT = time - last.time; if(dT<0) dT+=65536;
        let dR = revs - last.revs; if(dR<0) dR+=65536;
        if(dT>0 && dR>0) {
            const rpm = Math.round((dR / (dT/1024.0)) * 60);
            if(rpm <= 250) {
                window.liveData.cadence = rpm;
                window._lastCadenceUpdateTime['powerMeter'] = Date.now();
                notifyChildWindows('cadence', rpm);
            }
        }
    }
    window._lastCrankData.powerMeter = { revs, time };
  }
}

function handleHeartRateData(e) {
  const dv = e.target.value;
  const hr = (dv.getUint8(0) & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
  window.liveData.heartRate = hr;
  notifyChildWindows('heartRate', hr);
}

// ── [6] 유틸리티 ──
function handleDisconnect(type, device) {
  if (window.connectedDevices[type]?.device === device) {
    window.connectedDevices[type] = null;
    if(type==='trainer' && window.updateErgModeUI) window.updateErgModeUI(false);
  }
  updateDevicesList();
}
function notifyChildWindows(f, v) {
  if (window._bluetoothChildWindows) {
      window._bluetoothChildWindows.forEach(w => {
          if(!w.closed) w.postMessage({ type: 'bluetoothLiveDataUpdate', updatedField: f, updatedValue: v, ...window.liveData }, '*');
      });
  }
}
// 케이던스 0 처리
setInterval(() => {
    if(window.liveData.cadence > 0 && (Date.now() - (window._lastCadenceUpdateTime.trainer||0) > 3000)) {
        window.liveData.cadence = 0; notifyChildWindows('cadence', 0);
    }
}, 1000);

// 외부 노출
window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
window.setTargetPower = function(w) { if(window.ergController) window.ergController.setTargetPower(w); };
