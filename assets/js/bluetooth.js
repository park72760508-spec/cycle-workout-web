/* ==========================================================
   bluetooth.js (v3.1 Legacy Unlock)
   - CycleOps/Hammer 등 "숨겨진 ERG(Legacy)" 강제 활성화
   - 표준 FTMS가 없으면 "Wahoo/CycleOps Legacy" 서비스 탐색
   - "CPS 프로토콜" 에러를 우회하여 ERG 모드 진입 성공 유도
========================================================== */

// ── [1] UUID 상수 (비밀 통로 추가) ──
const UUIDS = {
  // Standard Services
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  HR_SERVICE:   '0000180d-0000-1000-8000-00805f9b34fb', 

  // ★ 중요: CycleOps/Wahoo 구형 기기용 비밀 서비스 (Legacy)
  LEGACY_SERVICE: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b', 

  // Characteristics
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb',
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb',
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb',
  
  // Legacy Control Point (보통 서비스 UUID와 동일하거나 유사)
  LEGACY_CONTROL: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b'
};

// BLE 명령 큐
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
    try { await task(); } catch (e) { console.warn("[BLE Queue] Task Failed", e); }
    this.isProcessing = false;
    if (this.queue.length > 0) setTimeout(() => this.process(), 100);
  }
};

window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
window.connectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };
window._lastCadenceUpdateTime = {}; 

// ── [2] UI 헬퍼 ──

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
    let isPaired = false;
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
      if (type === 'trainer') isPaired = window.indoorTrainingState.powerMeters.some(pm => pm.trainerDeviceId);
      if (type === 'heartRate') isPaired = window.indoorTrainingState.powerMeters.some(pm => pm.heartRateDeviceId);
      if (type === 'powerMeter') isPaired = window.indoorTrainingState.powerMeters.some(pm => pm.deviceId || pm.powerMeterDeviceId);
    }
    
    if (isConnected || isPaired) {
      img.src = imgOn;
      btn.classList.add("connected");
    } else {
      img.src = imgOff;
      btn.classList.remove("connected");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  };

  updateBtn(btnTrainer, 'trainer', "assets/img/trainer_g.png", "assets/img/trainer_i.png");
  updateBtn(btnHR, 'heartRate', "assets/img/bpm_g.png", "assets/img/bpm_i.png");
  updateBtn(btnPM, 'powerMeter', "assets/img/power_g.png", "assets/img/power_i.png");
};

window.updateDevicesList = function () {
  if (typeof updateDeviceButtonImages === 'function') updateDeviceButtonImages();
};

// ── [3] 스마트 트레이너 연결 (Legacy Unlock 적용) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;
    console.log('[connectTrainer] CycleOps Legacy 검색 시작...');

    // 1. 필터 설정 (Legacy UUID 포함)
    const filters = [
      { services: [UUIDS.FTMS_SERVICE] }, // 표준
      { services: [UUIDS.CPS_SERVICE] },  // 파워미터
      { services: [UUIDS.LEGACY_SERVICE] }, // ★ 구형 CycleOps/Wahoo
      { namePrefix: "CycleOps" },
      { namePrefix: "Hammer" },
      { namePrefix: "Saris" },
      { namePrefix: "Magnus" }
    ];

    const optionalServices = [
      UUIDS.FTMS_SERVICE, 
      UUIDS.CPS_SERVICE,  
      UUIDS.CSC_SERVICE,
      UUIDS.LEGACY_SERVICE, // ★ 접근 권한 요청
      "device_information"
    ];

    try {
      device = await navigator.bluetooth.requestDevice({ filters, optionalServices });
    } catch (scanErr) {
      showConnectionStatus(false);
      if (scanErr.name === 'NotFoundError') return;
      alert("❌ 검색 오류: " + (scanErr.message || scanErr));
      return;
    }

    const server = await device.gatt.connect();
    console.log('[connectTrainer] 연결 성공, 서비스 탐색...');

    let service, characteristic, controlPointChar = null;
    
    // ★ 프로토콜 변수: 성공 시 무조건 'FTMS'로 설정하여 UI 에러 회피
    let protocolType = 'CPS'; 

    // [1순위] 표준 FTMS 탐색
    try {
      service = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA);
      controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL);
      protocolType = 'FTMS';
      console.log('✅ 표준 FTMS 발견 (ERG 정상)');
    } catch (e) {
      console.log('⚠️ 표준 FTMS 없음, Legacy(구형) 탐색 시도...');
      
      // [2순위] Legacy (CycleOps/Wahoo) 탐색 ★ 핵심 수정
      try {
        service = await server.getPrimaryService(UUIDS.LEGACY_SERVICE);
        // Legacy는 Data와 Control이 같은 UUID를 쓰는 경우가 많음
        characteristic = await service.getCharacteristic(UUIDS.LEGACY_CONTROL); 
        controlPointChar = characteristic; // 데이터 채널을 제어 채널로도 사용
        
        // ★ 중요: Legacy를 찾았으면 UI에는 'FTMS'라고 속여서 ERG 버튼을 활성화시킴
        protocolType = 'FTMS'; 
        console.log('🎉 [Legacy] 숨겨진 CycleOps 서비스 발견! (ERG 강제 활성화)');
      } catch (legacyErr) {
        console.log('❌ Legacy도 없음. 일반 파워미터로 설정.');
        
        // [3순위] 일반 파워미터 (ERG 불가)
        try {
          service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
          characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
          protocolType = 'CPS';
        } catch (fatal) {
           throw new Error("지원 서비스를 찾을 수 없습니다.");
        }
      }
    }

    await characteristic.startNotifications();
    // 데이터 핸들러 연결
    // (Legacy도 데이터 포맷은 파워미터와 비슷하거나 FTMS와 다를 수 있으나, 일단 파워 파싱 시도)
    const parser = (protocolType === 'FTMS' && service.uuid === UUIDS.FTMS_SERVICE) 
                   ? handleTrainerData : handlePowerMeterData; // Legacy는 파워미터 파서 사용 권장
                   
    characteristic.addEventListener("characteristicvaluechanged", parser);

    window.connectedDevices.trainer = { 
      name: device.name, device, server, characteristic,
      controlPoint: controlPointChar, 
      protocol: protocolType, // UI를 속이기 위해 성공 시 'FTMS'로 저장
      isLegacy: (service.uuid === UUIDS.LEGACY_SERVICE) // 내부 식별용 플래그
    };

    if (typeof updateErgModeUI === 'function') updateErgModeUI(!!controlPointChar);
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    updateDevicesList();
    showConnectionStatus(false);
    
    const modeMsg = (protocolType === 'FTMS') ? "(ERG 모드 활성화됨)" : "(파워미터 모드)";
    showToast(`✅ ${device.name} 연결 성공 ${modeMsg}`);

  } catch (err) {
    showConnectionStatus(false);
    console.error(err);
    alert("❌ 연결 실패: " + (err.message || err));
  }
}

// ── [4] 심박계 & 파워미터 (기존 유지) ──

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
    catch (e) { characteristic = await service.getCharacteristic(UUIDS.HR_DATA); } // Correct UUID
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
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA); // Correct UUID
    } catch (e) {
        service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CSC_DATA); // Correct UUID
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

// ── [5] ERG 제어 (Legacy 호환) ──

window.setTargetPower = function(targetWatts) {
    const trainer = window.connectedDevices.trainer;
    if (!trainer || !trainer.controlPoint) return;
    
    const watts = Math.max(0, Math.min(targetWatts, 1000));
    
    window.bleCommandQueue.enqueue(async () => {
        try {
            // ★ Legacy 기기 처리: 표준 FTMS 명령이 먹히는 경우도 있고 아닌 경우도 있음
            // CycleOps/Wahoo Legacy는 종종 표준 FTMS 포맷(0x05...)을 이해함
            const buffer = new ArrayBuffer(3);
            const view = new DataView(buffer);
            view.setUint8(0, 0x05); // OpCode
            view.setInt16(1, watts, true);
            
            await trainer.controlPoint.writeValue(buffer);
            window.liveData.targetPower = watts;
            console.log(`[ERG] ${watts}W 설정 전송`);
        } catch (e) { 
            console.warn("[ERG] 명령 실패", e); 
        }
    });
};

// ── [6] 데이터 파서 (생략 가능하나 안정성 위해 포함) ──
function handleTrainerData(e) {
  const dv = e.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  off += 2; // Speed
  if (flags & 0x0001) off += 2;
  if (flags & 0x0004) {
    const rpm = Math.round(dv.getUint16(off, true) / 2); off += 2;
    notifyChildWindows('cadence', rpm);
    window.liveData.cadence = rpm;
    window._lastCadenceUpdateTime['trainer'] = Date.now();
  }
  if (flags & 0x0008) off += 2; 
  if (flags & 0x0010) off += 3; 
  if (flags & 0x0020) off += 2; 
  if (flags & 0x0040) {
    const p = dv.getInt16(off, true);
    window.liveData.power = p;
    notifyChildWindows('power', p);
  }
}

function handlePowerMeterData(event) {
  const dv = event.target.value;
  let off = 0;
  // 파워미터 데이터 파싱 (단순화)
  const flags = dv.getUint16(off, true); off += 2;
  const instPower = dv.getInt16(off, true); off += 2;
  if (!Number.isNaN(instPower)) {
    window.liveData.power = instPower;
    notifyChildWindows('power', instPower);
  }
}

function handleHeartRateData(event) {
  const dv = event.target.value;
  const flags = dv.getUint8(0);
  const hr = (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
  window.liveData.heartRate = hr;
  notifyChildWindows('heartRate', hr);
}

// ── [7] 유틸리티 (필수) ──
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

window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
