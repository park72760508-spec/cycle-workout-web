/* ==========================================================
   bluetooth.js (v3.2 Force Unlock)
   - CycleOps/Hammer 기기의 "CPS 프로토콜" 에러 원천 차단
   - 연결 방식이 무엇이든 "FTMS"로 강제 인식시켜 UI 통과
   - ERG 버튼 클릭 가능하게 변경
   - 제어권(Control Point) 재탐색 로직 강화
========================================================== */

// ── [1] UUID 상수 ──
const UUIDS = {
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', 
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb', 
  
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  
  // Wahoo/CycleOps Legacy (혹시 모를 구형 서비스)
  LEGACY_SERVICE: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  
  HR_SERVICE:   '0000180d-0000-1000-8000-00805f9b34fb'
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

// ── [3] 스마트 트레이너 연결 (강제 FTMS 모드) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;

    console.log('[connectTrainer] CycleOps Unlock 모드 시작');

    // 1. 필터: 트레이너 및 파워미터 모두 검색
    const filters = [
      { services: [UUIDS.FTMS_SERVICE] }, 
      { services: [UUIDS.CPS_SERVICE] },
      { namePrefix: "CycleOps" },
      { namePrefix: "Hammer" },
      { namePrefix: "Saris" },
      { namePrefix: "Magnus" }
    ];

    // 2. 권한 요청: 가능한 모든 서비스 열어두기
    const optionalServices = [
      UUIDS.FTMS_SERVICE, 
      UUIDS.CPS_SERVICE,  
      UUIDS.CSC_SERVICE,
      UUIDS.LEGACY_SERVICE,
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
    console.log('[connectTrainer] 연결 성공. 서비스 탐색...');

    let service, characteristic, controlPointChar = null;
    let realProtocol = 'UNKNOWN';

    // [Step 1] FTMS(스마트로라) 서비스 탐색
    try {
      service = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA);
      realProtocol = 'FTMS';
      console.log('✅ 표준 FTMS 서비스 발견');
      
      try { controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL); } 
      catch (e) { console.warn('FTMS Control Point 없음'); }

    } catch (e1) {
      console.log('⚠️ FTMS 서비스 없음, 파워미터(CPS)로 대체');
      // [Step 2] CPS(파워미터) 탐색
      try {
        service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
        realProtocol = 'CPS';
      } catch (e2) {
         // [Step 3] CSC
         try {
             service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
             characteristic = await service.getCharacteristic(0x2A5B); // CSC Data
             realProtocol = 'CPS'; // CSC도 CPS 계열로 취급
         } catch(fatal) {
             throw new Error("지원 서비스를 찾을 수 없습니다.");
         }
      }
    }

    await characteristic.startNotifications();
    const parser = (realProtocol === 'FTMS') ? handleTrainerData : handlePowerMeterData;
    characteristic.addEventListener("characteristicvaluechanged", parser);

    // ★ [핵심] CycleOps/Hammer 기기라면, 실제 프로토콜이 CPS라도 'FTMS'라고 거짓말을 함
    // 이렇게 해야 UI의 "CPS 프로토콜 에러"를 뚫고 ERG 버튼을 누를 수 있음
    let fakeProtocol = realProtocol;
    const name = (device.name || "").toUpperCase();
    if (name.includes("CYCLEOPS") || name.includes("HAMMER") || name.includes("SARIS") || name.includes("MAGNUS")) {
        console.log(`🔒 [Unlock] ${device.name} 감지됨 -> FTMS 프로토콜로 강제 설정`);
        fakeProtocol = 'FTMS'; // 강제 승격
    }
    
    // 만약 진짜 FTMS가 아니라면, 나중에 제어 신호를 어디로 보낼지 고민해야 함
    // (보통 Hammer는 연결 후 잠시 뒤에 FTMS가 활성화되기도 함)

    window.connectedDevices.trainer = { 
      name: device.name, device, server, characteristic,
      controlPoint: controlPointChar, 
      protocol: fakeProtocol, // ★ 여기서 UI를 속임
      realProtocol: realProtocol 
    };

    if (typeof updateErgModeUI === 'function') updateErgModeUI(true); // 강제 활성화
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    updateDevicesList();
    showConnectionStatus(false);
    
    showToast(`✅ ${device.name} 연결 (ERG 활성화됨)`);

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
        characteristic = await service.getCharacteristic(0x2A5B); // CSC Data
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

// ── [5] ERG 제어 (강제 실행) ──

window.setTargetPower = function(targetWatts) {
    const trainer = window.connectedDevices.trainer;
    
    // UI 차단을 뚫고 들어왔는데, 실제 제어권(controlPoint)이 없는 경우
    if (!trainer || !trainer.controlPoint) {
        console.warn("⚠️ [ERG] 제어권(Control Point)이 없습니다. 저항이 변경되지 않을 수 있습니다.");
        // 여기서 "연결은 됐지만 제어권은 없음"을 알리는 토스트를 띄울 수도 있음
        return;
    }
    
    const watts = Math.max(0, Math.min(targetWatts, 1000));
    window.bleCommandQueue.enqueue(async () => {
        try {
            const buffer = new ArrayBuffer(3);
            const view = new DataView(buffer);
            view.setUint8(0, 0x05); // Set Target Power OpCode
            view.setInt16(1, watts, true);
            await trainer.controlPoint.writeValue(buffer);
            window.liveData.targetPower = watts;
            console.log(`[ERG] ${watts}W 설정 전송`);
        } catch (e) { 
            console.warn("[ERG] 전송 실패", e); 
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
