/* ==========================================================
   bluetooth.js (v2.4 Final - Filters Fixed)
   - 심박계 성공 방식(Filters)을 스마트로라에도 적용
   - CycleOps, Hammer, Saris, 파워미터, FTMS 모두 타겟팅
   - 'acceptAllDevices' 제거 (브라우저 차단 회피)
========================================================== */

// ── [1] UUID 상수 ──
const UUIDS = {
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', 
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb', 
  
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  
  HEART_RATE_SERVICE: '0000180d-0000-1000-8000-00805f9b34fb', 
  
  // 브라우저 호환용 Short UUID
  SHORT_FTMS: 0x1826,
  SHORT_CPS:  0x1818,
  SHORT_CSC:  0x1816
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

// 전역 상태
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
window.connectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };
let powerMeterState = { lastCrankRevs: null, lastCrankEventTime: null };
window._lastCadenceUpdateTime = {}; 

// ── [2] UI 헬퍼 ──

window.showConnectionStatus = window.showConnectionStatus || function (show) {
  const el = document.getElementById("connectionStatus");
  if (el) el.classList.toggle("hidden", !show);
};

window.showToast = window.showToast || function (msg) {
  const t = document.getElementById("toast");
  if (!t) { console.log(msg); return; } // 토스트 없으면 로그만
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

// ── [3] 연결 로직 (수정됨: Filters 사용) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;

    console.log('[connectTrainer] 필터 검색 시작 (CycleOps/FTMS/CPS)');
    
    // ★ 심박계처럼 'Filters' 방식 사용 (브라우저 차단 회피)
    // CycleOps Hammer는 보통 'cycling_power' 서비스나 이름으로 식별됨
    const filters = [
      { services: ['fitness_machine'] },       // 표준 스마트로라
      { services: [UUIDS.FTMS_SERVICE] },
      { services: ['cycling_power'] },         // 파워미터 (Hammer 구형 호환)
      { services: [UUIDS.CPS_SERVICE] },
      { services: ['speed_cadence'] },         // CSC 센서
      { namePrefix: "CycleOps" },              // 이름으로 검색
      { namePrefix: "Saris" },
      { namePrefix: "Hammer" },
      { namePrefix: "Magnus" }
    ];

    const optionalServices = [
      UUIDS.FTMS_SERVICE, UUIDS.SHORT_FTMS, 'fitness_machine',
      UUIDS.CPS_SERVICE,  UUIDS.SHORT_CPS,  'cycling_power',
      UUIDS.CSC_SERVICE,  UUIDS.SHORT_CSC,  'speed_cadence',
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
        console.log("사용자가 취소함");
        return;
      }
      alert("❌ 검색 오류: " + scanErr.message);
      return;
    }

    const server = await device.gatt.connect();
    console.log('[connectTrainer] 연결 성공');

    let service, characteristic, isFTMS = false;
    let controlPointChar = null;

    // 1. FTMS(스마트로라) 서비스 우선 탐색
    try {
      try { service = await server.getPrimaryService('fitness_machine'); }
      catch (e) { 
          try { service = await server.getPrimaryService(UUIDS.FTMS_SERVICE); }
          catch (e2) { service = await server.getPrimaryService(UUIDS.SHORT_FTMS); }
      }
      
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA); // 0x2AD2
      isFTMS = true;
      console.log('✅ FTMS 서비스 발견 (스마트로라 모드)');

      // ERG 제어권 획득
      try {
        controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL);
      } catch (e) {
        try {
            controlPointChar = await service.getCharacteristic('fitness_machine_control_point');
        } catch (fatal) { console.warn('Control Point 없음'); }
      }

    } catch (e) {
      console.log('FTMS 실패, 파워미터(CPS) 모드 진입');
      // 2. FTMS 실패 시 파워미터(CPS)로 연결
      try {
        try { service = await server.getPrimaryService('cycling_power'); }
        catch (e) { 
            try { service = await server.getPrimaryService(UUIDS.CPS_SERVICE); }
            catch (e2) { service = await server.getPrimaryService(UUIDS.SHORT_CPS); }
        }
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA); // 0x2A63
        isFTMS = false;
      } catch (fatal) {
         // 3. 최후의 수단 CSC
         try {
             service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
             characteristic = await service.getCharacteristic(0x2A5B);
             isFTMS = false;
         } catch(reallyFatal) {
             throw new Error("지원하지 않는 기기입니다. (FTMS/CPS 서비스 없음)");
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
    alert("❌ 연결 실패: " + err.message);
  }
}

// ── [4] 심박계 (기존 성공 방식 유지) ──

async function connectHeartRate() {
  try {
    showConnectionStatus(true);
    let device;
    // 'heart_rate' 필터 사용 (성공 확인됨)
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
      optionalServices: ['heart_rate', UUIDS.HEART_RATE_SERVICE, 'battery_service']
    });

    const server = await device.gatt.connect();
    let service;
    try { service = await server.getPrimaryService('heart_rate'); } 
    catch (e) { service = await server.getPrimaryService(UUIDS.HEART_RATE_SERVICE); }
    
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
    alert("심박계 연결 실패: " + err.message);
  }
}

// ── [5] 파워미터 ──

async function connectPowerMeter() {
  if (window.connectedDevices.trainer && !confirm("트레이너가 이미 연결됨. 파워미터로 교체?")) return;
  try {
    showConnectionStatus(true);
    let device;
    device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_power'] }, { services: ['speed_cadence'] }],
        optionalServices: ['cycling_power', 'speed_cadence', UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE]
    });

    const server = await device.gatt.connect();
    let service, characteristic;
    try {
        service = await server.getPrimaryService('cycling_power');
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
    } catch (e) {
        service = await server.getPrimaryService('speed_cadence');
        characteristic = await service.getCharacteristic(0x2A5B);
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
    alert("파워미터 연결 실패: " + err.message);
  }
}

// ── [6] 데이터 처리 ──

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
    const c = await s.getCharacteristic(0x2A5B);
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
