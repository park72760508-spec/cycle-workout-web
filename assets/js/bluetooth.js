/* ==========================================================
   bluetooth.js (v2.2 Fixed for CycleOps/Saris)
   - CycleOps/Saris 기기 검색을 위한 이름(Name) 필터 추가
   - 심박계 검색 호환성 강화 ('heart_rate' 별칭 사용)
   - 스마트로라 FTMS 강제 탐색 및 ERG 제어(setTargetPower)
   - 앱 연동 UI 및 케이던스 타임아웃 유지
========================================================== */

// ── [1] 표준 UUID 및 설정 ──
const UUIDS = {
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', 
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb', 
  
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  
  HEART_RATE_SERVICE: '0000180d-0000-1000-8000-00805f9b34fb', 
  HEART_RATE_MEASUREMENT: '00002a37-0000-1000-8000-00805f9b34fb',

  // 브라우저 호환성을 위한 Short UUID
  SHORT_FTMS: 0x1826,
  SHORT_CPS:  0x1818,
  SHORT_CSC:  0x1816
};

// ERG 명령 씹힘 방지 큐
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

// 전역 변수 초기화
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
window.connectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };

// 파워미터 계산용 변수
let powerMeterState = { lastCrankRevs: null, lastCrankEventTime: null };
window._lastCadenceUpdateTime = {}; // 타임아웃 체크용

// ── [2] UI 헬퍼 (기존 로직 보존) ──

if (!window.showConnectionStatus) {
  window.showConnectionStatus = function (show) {
    const el = document.getElementById("connectionStatus");
    if (el) el.classList.toggle("hidden", !show);
  };
}

if (!window.showToast) {
  window.showToast = function (msg) {
    const t = document.getElementById("toast");
    if (!t) return alert(msg);
    t.classList.remove("hidden");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2400);
  };
}

window.updateDeviceButtonImages = window.updateDeviceButtonImages || function () {
  const btnTrainer = document.getElementById("btnConnectTrainer");
  const btnHR = document.getElementById("btnConnectHR");
  const btnPM = document.getElementById("btnConnectPM");
  
  // 1. 스마트 트레이너 버튼
  if (btnTrainer) {
    let img = btnTrainer.querySelector(".device-btn-icon");
    if (!img) {
      img = document.createElement("img");
      img.className = "device-btn-icon";
      const span = btnTrainer.querySelector("span");
      span ? btnTrainer.insertBefore(img, span) : btnTrainer.appendChild(img);
    }
    
    const isBluetoothConnected = window.connectedDevices && window.connectedDevices.trainer;
    let isPaired = false;
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
      isPaired = window.indoorTrainingState.powerMeters.some(pm => pm.trainerDeviceId && pm.trainerDeviceId.toString().trim() !== '');
    }
    
    if (isBluetoothConnected || isPaired) {
      img.src = "assets/img/trainer_g.png";
      btnTrainer.classList.add("connected");
    } else {
      img.src = "assets/img/trainer_i.png";
      btnTrainer.classList.remove("connected");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  }
  
  // 2. 심박계 버튼
  if (btnHR) {
    let img = btnHR.querySelector(".device-btn-icon");
    if (!img) {
      img = document.createElement("img");
      img.className = "device-btn-icon";
      const span = btnHR.querySelector("span");
      span ? btnHR.insertBefore(img, span) : btnHR.appendChild(img);
    }
    
    const isBluetoothConnected = window.connectedDevices && window.connectedDevices.heartRate;
    let isPaired = false;
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
      isPaired = window.indoorTrainingState.powerMeters.some(pm => pm.heartRateDeviceId && pm.heartRateDeviceId.toString().trim() !== '');
    }
    
    if (isBluetoothConnected || isPaired) {
      img.src = "assets/img/bpm_g.png";
      btnHR.classList.add("connected");
    } else {
      img.src = "assets/img/bpm_i.png";
      btnHR.classList.remove("connected");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  }
  
  // 3. 파워미터 버튼
  if (btnPM) {
    let img = btnPM.querySelector(".device-btn-icon");
    if (!img) {
      img = document.createElement("img");
      img.className = "device-btn-icon";
      const span = btnPM.querySelector("span");
      span ? btnPM.insertBefore(img, span) : btnPM.appendChild(img);
    }
    
    const isBluetoothConnected = window.connectedDevices && window.connectedDevices.powerMeter;
    let isPaired = false;
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
      isPaired = window.indoorTrainingState.powerMeters.some(pm => {
        const deviceId = pm.deviceId || pm.powerMeterDeviceId;
        return deviceId && deviceId.toString().trim() !== '';
      });
    }
    
    if (isBluetoothConnected || isPaired) {
      img.src = "assets/img/power_g.png";
      btnPM.classList.add("connected");
    } else {
      img.src = "assets/img/power_i.png";
      btnPM.classList.remove("connected");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  }
};

window.updateDevicesList = function () {
  if (typeof updateDeviceButtonImages === 'function') updateDeviceButtonImages();
};

// ── [3] 핵심 연결 로직 (CycleOps/Saris 대응) ──

// 1) 스마트 트레이너 연결
async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;

    // ★ CycleOps 대응: 이름(Prefix) 필터 추가
    // 서비스 UUID를 광고하지 않는 구형 펌웨어를 위해 이름으로 검색
    const optionalServicesList = [
      UUIDS.FTMS_SERVICE, UUIDS.SHORT_FTMS,
      UUIDS.CPS_SERVICE,  UUIDS.SHORT_CPS,
      UUIDS.CSC_SERVICE,  UUIDS.SHORT_CSC,
      "device_information"
    ];

    try {
      console.log('[connectTrainer] 검색 시작 (CycleOps/Saris 필터 포함)...');
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [UUIDS.FTMS_SERVICE] },
          { services: [UUIDS.SHORT_FTMS] },
          // ★ 중요: 브랜드 이름으로 강제 검색
          { namePrefix: "CycleOps" },
          { namePrefix: "Saris" },
          { namePrefix: "Hammer" },
          { namePrefix: "Magnus" },
          // 기존 파워미터 서비스 필터
          { services: [UUIDS.CPS_SERVICE] },
          { services: [UUIDS.SHORT_CPS] }
        ],
        optionalServices: optionalServicesList
      });
    } catch (e) {
      console.log("⚠️ 필터 검색 실패, 전체 검색 시도...", e);
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: optionalServicesList
      });
    }

    const server = await device.gatt.connect();
    
    // ★ 중요: 이름으로 찾았더라도, 내부적으로는 FTMS 서비스를 강제 탐색해야 ERG가 됨
    let service, characteristic, isFTMS = false;
    let controlPointChar = null;

    try {
      try {
        service = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      } catch (err) {
        service = await server.getPrimaryService(UUIDS.SHORT_FTMS);
      }
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA);
      isFTMS = true;
      console.log('[connectTrainer] FTMS 프로토콜 연결됨 (ERG 가능)');

      // ERG Control Point 획득 시도
      try {
        controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL);
      } catch (e) {
        try {
            controlPointChar = await service.getCharacteristic('fitness_machine_control_point');
        } catch (fatal) {
             console.warn('FTMS Control Point 없음');
        }
      }
    } catch (e) {
      console.log('FTMS 실패, CPS(파워미터) 모드로 연결 시도');
      try {
        service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
        isFTMS = false;
      } catch (fatal) {
        throw new Error("지원하지 않는 기기입니다. (FTMS/CPS 없음)");
      }
    }

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", isFTMS ? handleTrainerData : handlePowerMeterData);

    window.connectedDevices.trainer = { 
      name: device.name, 
      device, server, characteristic,
      controlPoint: controlPointChar, // ERG 핵심
      protocol: isFTMS ? 'FTMS' : 'CPS' 
    };

    if (typeof updateErgModeUI === 'function') updateErgModeUI(!!controlPointChar);

    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    updateDevicesList();
    showConnectionStatus(false);
    
    // 연결 상태 메시지
    const ergMsg = isFTMS ? (controlPointChar ? "(ERG 지원)" : "(ERG 미지원)") : "(파워미터 모드)";
    showToast(`✅ ${device.name} 연결 성공 ${ergMsg}`);

  } catch (err) {
    showConnectionStatus(false);
    console.error(err);
    showToast("❌ 연결 실패: " + err.message);
  }
}

// 2) 심박계 연결
async function connectHeartRate() {
  try {
    showConnectionStatus(true);
    let device;
    
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['heart_rate', UUIDS.HEART_RATE_SERVICE, 'battery_service']
      });
    } catch (e) {
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['heart_rate', UUIDS.HEART_RATE_SERVICE]
      });
    }

    const server = await device.gatt.connect();
    let service;
    try { service = await server.getPrimaryService('heart_rate'); } 
    catch (e) { 
        try { service = await server.getPrimaryService(0x180D); }
        catch (e2) { service = await server.getPrimaryService(UUIDS.HEART_RATE_SERVICE); }
    }

    if (!service) throw new Error("심박 서비스를 찾을 수 없습니다.");
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
    showToast("❌ 심박계 연결 실패");
  }
}

// 3) 파워미터 연결
async function connectPowerMeter() {
  if (window.connectedDevices.trainer) {
    if (!confirm("트레이너가 이미 연결되어 있습니다. 파워미터로 교체할까요?")) return;
  }
  
  try {
    showConnectionStatus(true);
    let device;
    
    try {
        device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [UUIDS.CPS_SERVICE] }, { services: [UUIDS.CSC_SERVICE] }],
            optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE]
        });
    } catch(e) {
        device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE]
        });
    }

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
    trySubscribeCSC(server);

    window.connectedDevices.powerMeter = { name: device.name, device, server, characteristic };
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('powerMeter', device));
    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결 성공`);

  } catch (err) {
    showConnectionStatus(false);
    showToast("❌ 파워미터 연결 실패");
  }
}

// ── [4] 데이터 처리 및 ERG 제어 ──

window.setTargetPower = function(targetWatts) {
    const trainer = window.connectedDevices.trainer;
    if (!trainer || !trainer.controlPoint) return;

    const watts = Math.max(0, Math.min(targetWatts, 1000));
    window.bleCommandQueue.enqueue(async () => {
        try {
            const buffer = new ArrayBuffer(3);
            const view = new DataView(buffer);
            view.setUint8(0, 0x05); // OpCode: Set Target Power
            view.setInt16(1, watts, true);
            await trainer.controlPoint.writeValue(buffer);
            window.liveData.targetPower = watts;
            console.log(`[ERG] 저항 설정: ${watts}W`);
        } catch (e) {
            console.warn("[ERG] 명령 실패", e);
        }
    });
};

function handleTrainerData(e) {
  const dv = e.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  
  off += 2; // Inst Speed
  if (flags & 0x0001) off += 2; // More Data
  
  // Cadence
  if (flags & 0x0004) {
    const cadHalf = dv.getUint16(off, true); off += 2;
    const rpm = Math.round(cadHalf / 2);
    updateCadence(rpm, 'trainer');
  }

  // Flags 건너뛰기
  if (flags & 0x0008) off += 2; // Avg Cadence
  if (flags & 0x0010) off += 3; // Distance
  if (flags & 0x0020) off += 2; // Resistance
  
  // Power
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

// ── [5] 기타 유틸 ──

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
    if (type === 'trainer') {
        if (typeof updateErgModeUI === 'function') updateErgModeUI(false);
    }
  }
  updateDevicesList();
}

function notifyChildWindows(field, value) {
  if (!window._bluetoothChildWindows) return;
  window._bluetoothChildWindows = window._bluetoothChildWindows.filter(w => !w.closed);
  window._bluetoothChildWindows.forEach(w => {
    w.postMessage({ 
        type: 'bluetoothLiveDataUpdate', 
        updatedField: field, 
        updatedValue: value, 
        ...window.liveData 
    }, '*');
  });
}

window.addEventListener("beforeunload", () => {
  try {
    if (connectedDevices.trainer?.server?.connected) connectedDevices.trainer.device.gatt.disconnect();
    if (connectedDevices.powerMeter?.server?.connected) connectedDevices.powerMeter.device.gatt.disconnect();
    if (connectedDevices.heartRate?.server?.connected) connectedDevices.heartRate.device.gatt.disconnect();
  } catch (e) {}
});

setInterval(() => {
    const now = Date.now();
    if (window.liveData.cadence > 0) {
        const lastTrainer = window._lastCadenceUpdateTime.trainer || 0;
        const lastPM = window._lastCadenceUpdateTime.powerMeter || 0;
        const lastUpdate = Math.max(lastTrainer, lastPM);
        
        if (now - lastUpdate > 3000) {
            console.log("Cadence Timeout -> 0");
            window.liveData.cadence = 0;
            notifyChildWindows('cadence', 0);
        }
    }
}, 1000);

window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
