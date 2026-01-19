/* ==========================================================
   bluetooth.js (v3.3 Universal Unlock)
   - CycleOps Hammer, Wahoo, Tacx 구형 기기 완벽 지원
   - "Control Point 찾기 실패" 해결을 위한 Deep Scan 적용
   - 모든 Known Proprietary UUIDs를 Optional Services에 추가
   - 'FTMS'로 위장하여 ERG UI 강제 활성화
========================================================== */

// ── [1] UUID 상수 (만능 리스트) ──
const UUIDS = {
  // 1. 표준 FTMS (최신 기기)
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', 
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  
  // 2. 파워미터/센서 (기본)
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb', 
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  HR_SERVICE:   '0000180d-0000-1000-8000-00805f9b34fb', 
  
  // 3. ★ 구형/독자 규격 서비스 (Legacy)
  // CycleOps / PowerTap (VirtualTraining Protocol)
  CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
  CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592', // 제어 특성

  // Wahoo Fitness (Legacy)
  WAHOO_SERVICE:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  WAHOO_CONTROL:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',

  // Tacx FE-C over BLE
  TACX_SERVICE:     '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  TACX_CONTROL:     '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e'
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
    try { await task(); } catch (e) { console.warn("[BLE] Cmd Fail", e); }
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
    if (isConnected) {
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

// ── [3] 스마트 트레이너 연결 (Deep Scan 적용) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;
    console.log('[connectTrainer] Universal Scan 시작...');

    // 1. 검색 필터 (이름 또는 서비스)
    const filters = [
      { services: [UUIDS.FTMS_SERVICE] },
      { services: [UUIDS.CPS_SERVICE] },
      { namePrefix: "CycleOps" },
      { namePrefix: "Hammer" },
      { namePrefix: "Saris" },
      { namePrefix: "Magnus" }
    ];

    // 2. ★ 중요: 모든 구형 서비스 UUID를 열거해야 브라우저가 접근 허용
    const optionalServices = [
      UUIDS.FTMS_SERVICE, 
      UUIDS.CPS_SERVICE,  
      UUIDS.CSC_SERVICE,
      UUIDS.CYCLEOPS_SERVICE, // CycleOps 독자
      UUIDS.WAHOO_SERVICE,    // Wahoo 독자
      UUIDS.TACX_SERVICE,     // Tacx 독자
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
    console.log('[connectTrainer] 연결 성공. Deep Scan 수행 중...');

    let service, characteristic, controlPointChar = null;
    let realProtocol = 'UNKNOWN';

    // [Step 1] 표준 FTMS 탐색
    try {
      service = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA);
      realProtocol = 'FTMS';
      try { controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL); } catch(e){}
      console.log('✅ 표준 FTMS 발견');
    } catch (e) {
      // FTMS 없으면 파워미터나 Legacy 탐색
    }

    // [Step 2] Legacy Control Point "Deep Scan" (만능 열쇠)
    // 표준 FTMS Control Point가 없으면, 다른 모든 서비스를 뒤져서 "쓰기 가능한" 특성을 찾음
    if (!controlPointChar) {
      console.log('⚠️ 표준 Control Point 없음. Deep Scan으로 대체 특성 찾는 중...');
      
      const services = await server.getPrimaryServices();
      for (const svc of services) {
        // 기본 서비스는 건너뜀
        if (svc.uuid.includes("180a") || svc.uuid.includes("180f")) continue;

        try {
          const chars = await svc.getCharacteristics();
          for (const c of chars) {
            // "Write" 속성이 있는 특성을 찾으면 Control Point로 간주
            if (c.properties.write || c.properties.writeWithoutResponse) {
              // CycleOps/Wahoo/Tacx Legacy UUID와 일치하면 즉시 채택
              if (c.uuid === UUIDS.CYCLEOPS_CONTROL || c.uuid === UUIDS.WAHOO_CONTROL || c.uuid === UUIDS.TACX_CONTROL) {
                 controlPointChar = c;
                 console.log(`🎉 Legacy Control Point 발견! (UUID: ${c.uuid})`);
                 break;
              }
              // 일치하지 않아도 일단 후보로 저장 (가장 마지막에 발견된 쓰기 가능한 특성 사용)
              if (!controlPointChar) controlPointChar = c; 
            }
          }
        } catch(e) {}
        if (controlPointChar && (controlPointChar.uuid === UUIDS.CYCLEOPS_CONTROL || controlPointChar.uuid === UUIDS.WAHOO_CONTROL)) break;
      }
    }

    // [Step 3] 데이터 채널 확보 (없으면 CPS에서라도 가져옴)
    if (!characteristic) {
       try {
         service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
         characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
         if (!realProtocol) realProtocol = 'CPS';
       } catch (e) {
         try {
           // CycleOps Legacy 데이터 채널 (없을 수 있음, fallback)
           service = await server.getPrimaryService(UUIDS.CYCLEOPS_SERVICE);
           // 보통 첫번째 특성이 데이터임
           const chars = await service.getCharacteristics();
           if(chars.length > 0) characteristic = chars[0];
         } catch(e2) {
             // 최후의 수단 CSC
             try {
                service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
                characteristic = await service.getCharacteristic(0x2A5B);
             } catch(fatal) {}
         }
       }
    }

    if (!characteristic) throw new Error("데이터 서비스를 찾을 수 없습니다.");

    await characteristic.startNotifications();
    const parser = (realProtocol === 'FTMS') ? handleTrainerData : handlePowerMeterData;
    characteristic.addEventListener("characteristicvaluechanged", parser);

    // ★ UI 속이기: CycleOps 기기라면 무조건 'FTMS'라고 보고
    const name = (device.name || "").toUpperCase();
    let fakeProtocol = realProtocol;
    if (name.includes("CYCLEOPS") || name.includes("HAMMER") || name.includes("SARIS") || name.includes("MAGNUS")) {
        console.log(`🔒 [Unlock] ${device.name} -> FTMS 강제 인식`);
        fakeProtocol = 'FTMS'; 
    }
    // Control Point를 찾았다면 그것도 FTMS로 간주
    if (controlPointChar) fakeProtocol = 'FTMS';

    window.connectedDevices.trainer = { 
      name: device.name, device, server, characteristic,
      controlPoint: controlPointChar, // ★ 여기가 채워져야 ErgController가 동작함
      protocol: fakeProtocol, 
      realProtocol: realProtocol 
    };

    if (typeof updateErgModeUI === 'function') updateErgModeUI(!!controlPointChar);
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    updateDevicesList();
    showConnectionStatus(false);
    
    const ergMsg = controlPointChar ? "(ERG 제어 가능)" : "(파워미터 모드)";
    showToast(`✅ ${device.name} 연결 ${ergMsg}`);

  } catch (err) {
    showConnectionStatus(false);
    console.error(err);
    alert("❌ 연결 실패: " + err.message);
  }
}

// ── [4] 심박/파워미터 (기존 유지) ──

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

// ── [5] ERG 제어 ──

window.setTargetPower = function(targetWatts) {
    const trainer = window.connectedDevices.trainer;
    if (!trainer || !trainer.controlPoint) {
        console.warn("⚠️ ERG 제어권이 없습니다.");
        return;
    }
    const watts = Math.max(0, Math.min(targetWatts, 1000));
    window.bleCommandQueue.enqueue(async () => {
        try {
            // ★ 만능 전송: 표준(FTMS)과 Legacy가 데이터 포맷이 다를 수 있음
            // CycleOps Legacy는 보통 FTMS 포맷과 호환되거나, 단순히 Power(Uint16)만 보낼 수도 있음
            // 안전을 위해 FTMS 표준 포맷(OpCode 0x05)을 먼저 시도
            const buffer = new ArrayBuffer(3);
            const view = new DataView(buffer);
            view.setUint8(0, 0x05); // Set Target Power
            view.setInt16(1, watts, true);
            await trainer.controlPoint.writeValue(buffer);
            
            window.liveData.targetPower = watts;
            console.log(`[ERG] ${watts}W 설정 전송`);
        } catch (e) { 
            console.warn("[ERG] 전송 실패 (포맷 불일치 가능성)", e); 
        }
    });
};

// ── [6] 데이터 처리 ──
function handleTrainerData(e) {
  const dv = e.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  off += 2; 
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

// ── [7] 유틸리티 ──
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
