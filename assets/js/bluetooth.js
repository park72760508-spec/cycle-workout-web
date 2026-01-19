/* ==========================================================
   bluetooth.js (v2.6 Stable - UUID String Only)
   - "Undefined" 및 "Unknown service" 오류 원천 차단
   - 숫자(0x1826) 및 별명(fitness_machine) 전면 배제
   - 오직 128-bit 정식 문자열 UUID만 사용하여 호환성 극대화
   - CycleOps/Hammer 이름 검색 유지
========================================================== */

// ── [1] UUID 상수 (오직 소문자 문자열만 사용) ──
const UUIDS = {
  // Service UUIDs (기기 종류)
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', // 스마트로라
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', // 파워미터
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', // 속도/케이던스
  HR_SERVICE:   '0000180d-0000-1000-8000-00805f9b34fb', // 심박계

  // Characteristic UUIDs (데이터 통로)
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb',
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb',
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb',
  CSC_DATA:     '00002a5b-0000-1000-8000-00805f9b34fb',
  HR_DATA:      '00002a37-0000-1000-8000-00805f9b34fb'
};

// BLE 명령 큐 (데이터 전송 안정화)
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

// 전역 상태 초기화
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
window.connectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };
let powerMeterState = { lastCrankRevs: null, lastCrankEventTime: null };
window._lastCadenceUpdateTime = {}; 

// ── [2] UI 헬퍼 함수 ──

window.showConnectionStatus = window.showConnectionStatus || function (show) {
  const el = document.getElementById("connectionStatus");
  if (el) el.classList.toggle("hidden", !show);
};

window.showToast = window.showToast || function (msg) {
  const t = document.getElementById("toast");
  if (!t) { console.log("Toast:", msg); return; }
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

// ── [3] 스마트 트레이너 연결 (v2.6: UUID String Only) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;

    console.log('[connectTrainer] UUID 필터 검색 시작...');
    
    // ★ 에러 원인 제거: 숫자(0x...)나 별명(fitness_machine) 절대 사용 금지
    // 오직 128-bit UUID 문자열과 이름(namePrefix)만 사용
    const filters = [
      { services: [UUIDS.FTMS_SERVICE] }, // 스마트로라 정식 UUID
      { services: [UUIDS.CPS_SERVICE] },  // 파워미터 정식 UUID
      // CycleOps 및 Hammer 이름 검색
      { namePrefix: "CycleOps" },
      { namePrefix: "Saris" },
      { namePrefix: "Hammer" },
      { namePrefix: "Magnus" }
    ];

    const optionalServices = [
      UUIDS.FTMS_SERVICE, 
      UUIDS.CPS_SERVICE,  
      UUIDS.CSC_SERVICE,  
      "device_information"
    ];

    try {
      device = await navigator.bluetooth.requestDevice({
        filters: filters,
        optionalServices: optionalServices
      });
    } catch (scanErr) {
      showConnectionStatus(false);
      if (scanErr.name === 'NotFoundError') {
        console.log("사용자 취소");
        return;
      }
      // undefined 에러 방지를 위해 에러 객체 전체 출력
      alert("❌ 검색 오류: " + (scanErr.message || scanErr));
      return;
    }

    const server = await device.gatt.connect();
    console.log('[connectTrainer] 연결 성공');

    let service, characteristic, isFTMS = false;
    let controlPointChar = null;

    // 1. FTMS 서비스 탐색
    try {
      service = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA);
      isFTMS = true;
      console.log('✅ FTMS 서비스 발견 (스마트로라 모드)');

      // ERG 제어권 탐색 (128-bit UUID 사용)
      try {
        controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL);
      } catch (e) {
        // 일부 구형 기기를 위해 별명도 시도해봄 (여기서는 에러나도 무방)
        try { controlPointChar = await service.getCharacteristic('fitness_machine_control_point'); } 
        catch (f) { console.warn('ERG Control Point 없음'); }
      }

    } catch (e) {
      console.log('FTMS 실패, 파워미터(CPS) 모드 시도');
      // 2. CPS 서비스 탐색
      try {
        service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
        isFTMS = false;
      } catch (fatal) {
         // 3. CSC 서비스 탐색
         try {
             service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
             characteristic = await service.getCharacteristic(UUIDS.CSC_DATA);
             isFTMS = false;
         } catch(reallyFatal) {
             throw new Error("지원 서비스(FTMS/CPS/CSC)를 찾을 수 없습니다.");
         }
      }
    }

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", isFTMS ? handleTrainerData : handlePowerMeterData);

    window.connectedDevices.trainer = { 
      name: device.name, device, server, characteristic,
      controlPoint: controlPointChar, 
      protocol: isFTMS ? 'FTMS' : 'CPS' 
    };

    if (typeof updateErgModeUI === 'function') updateErgModeUI(!!controlPointChar);
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    updateDevicesList();
    showConnectionStatus(false);
    
    const modeMsg = isFTMS ? (controlPointChar ? "(ERG 지원)" : "(ERG 미지원)") : "(파워미터 모드)";
    showToast(`✅ ${device.name} 연결 성공 ${modeMsg}`);

  } catch (err) {
    showConnectionStatus(false);
    console.error(err);
    alert("❌ 트레이너 연결 실패: " + (err.message || err));
  }
}

// ── [4] 심박계 연결 (기존 성공 코드 + 안전장치) ──

async function connectHeartRate() {
  try {
    showConnectionStatus(true);
    let device;
    // 심박계는 'heart_rate' 별명이 가장 잘 작동하므로 1순위 유지
    try {
        device = await navigator.bluetooth.requestDevice({
            filters: [{ services: ['heart_rate'] }],
            optionalServices: ['heart_rate', UUIDS.HR_SERVICE, 'battery_service']
        });
    } catch(e) {
        // 만약 실패하면 128-bit UUID로 재시도
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
    catch (e) { characteristic = await service.getCharacteristic(UUIDS.HR_DATA); }

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handleHeartRateData);

    window.connectedDevices.heartRate = { name: device.name, device, server, characteristic };
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('heartRate', device));
    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결 성공`);

  } catch (err) {
    showConnectionStatus(false);
    alert("심박계 연결 실패: " + (err.message || err));
  }
}

// ── [5] 파워미터 연결 (v2.6: UUID String Only) ──

async function connectPowerMeter() {
  if (window.connectedDevices.trainer && !confirm("트레이너가 이미 연결됨. 파워미터로 교체?")) return;
  try {
    showConnectionStatus(true);
    let device;
    
    // ★ 에러 원인 제거: 문자열 별명 제거하고 128-bit UUID만 사용
    const filters = [
        { services: [UUIDS.CPS_SERVICE] },
        { services: [UUIDS.CSC_SERVICE] }
    ];
    
    device = await navigator.bluetooth.requestDevice({
        filters: filters,
        optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE]
    });

    const server = await device.gatt.connect();
    let service, characteristic;
    
    try {
        service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
    } catch (e) {
        service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CSC_DATA);
    }

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handlePowerMeterData);
    trySubscribeCSC(server);

    window.connectedDevices.powerMeter = { name: device.name, device, server, characteristic };
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('powerMeter', device));
    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결 성공`);
  } catch (err) {
    showConnectionStatus(false);
    alert("파워미터 연결 실패: " + (err.message || err));
  }
}

// ── [6] 데이터 처리 및 ERG ──

window.setTargetPower = function(targetWatts) {
    const trainer = window.connectedDevices.trainer;
    if (!trainer || !trainer.controlPoint) return;
    const watts = Math.max(0, Math.min(targetWatts, 1000));
    window.bleCommandQueue.enqueue(async () => {
        try {
            const buffer = new ArrayBuffer(3);
            const view = new DataView(buffer);
            view.setUint8(0, 0x05); 
            view.setInt16(1, watts, true);
            await trainer.controlPoint.writeValue(buffer);
            window.liveData.targetPower = watts;
            console.log(`[ERG] ${watts}W 설정`);
        } catch (e) { console.warn("[ERG] 실패", e); }
    });
};

function handleTrainerData(e) {
  const dv = e.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  off += 2; // Speed
  if (flags & 0x0001) off += 2;
  if (flags & 0x0004) {
    const rpm = Math.round(dv.getUint16(off, true) / 2); off += 2;
    updateCadence(rpm, 'trainer');
  }
  if (flags & 0x0008) off += 2; 
  if (flags & 0x0010) off += 3; 
  if (flags & 0x0020) off += 2; 
  if (flags & 0x0040) {
    const p = dv.getInt16(off, true);
    window.liveData.power = p;
    notifyChildWindows('power', p);
    if (!window._recentPowerBuffer) window._recentPowerBuffer = [];
    window._recentPowerBuffer.push({ power: p, timestamp: Date.now() });
    window._recentPowerBuffer = window._recentPowerBuffer.filter(x => Date.now() - x.timestamp < 5000);
  }
  if (window.updateTrainingDisplay) window.updateTrainingDisplay();
}

function handlePowerMeterData(event) {
  const dv = event.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  const instPower = dv.getInt16(off, true); off += 2;
  if (!Number.isNaN(instPower)) {
    window.liveData.power = instPower;
    notifyChildWindows('power', instPower);
  }
  if (flags & 0x0020) { 
    if (flags & 0x0001) off += 1;
    if (flags & 0x0004) off += 2;
    if (flags & 0x0010) off += 6;
    const crankRevs = dv.getUint16(off, true); off += 2;
    const lastCrankTime = dv.getUint16(off, true); off += 2;
    if (powerMeterState.lastCrankRevs !== null) {
      let dRevs = crankRevs - powerMeterState.lastCrankRevs;
      if (dRevs < 0) dRevs += 0x10000;
      let dTicks = lastCrankTime - powerMeterState.lastCrankEventTime;
      if (dTicks < 0) dTicks += 0x10000;
      if (dRevs > 0 && dTicks > 0) {
        const rpm = Math.round((dRevs / (dTicks / 1024)) * 60);
        updateCadence(rpm, 'powerMeter');
      }
    }
    powerMeterState.lastCrankRevs = crankRevs;
    powerMeterState.lastCrankEventTime = lastCrankTime;
  }
}

function handleHeartRateData(event) {
  const dv = event.target.value;
  const flags = dv.getUint8(0);
  const hr = (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
  window.liveData.heartRate = hr;
  notifyChildWindows('heartRate', hr);
  if (window.updateTrainingDisplay) window.updateTrainingDisplay();
}

// ── [7] 유틸리티 ──

function updateCadence(rpm, source) {
    if (rpm >= 0 && rpm < 250) {
        window.liveData.cadence = rpm;
        notifyChildWindows('cadence', rpm);
        window._lastCadenceUpdateTime[source] = Date.now();
    }
}
async function trySubscribeCSC(server) {
  try {
    const s = await server.getPrimaryService(UUIDS.CSC_SERVICE);
    const c = await s.getCharacteristic(UUIDS.CSC_DATA);
    await c.startNotifications();
  } catch(e) {}
}
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
