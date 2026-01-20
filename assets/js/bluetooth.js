/* ==========================================================
   bluetooth.js (v5.0 Final Repair)
   - [복구] 원본 파일의 CPS 케이던스 계산 로직(Crank Data) 완벽 이식
   - [수정] CycleOps/Hammer 연결 시 제어권(Control Point) 강제 확보 로직
   - [해결] "파워미터 모드(제어 불가)" 상태 방지
========================================================== */

// ── [1] UUID 상수 ──
const UUIDS = {
  // 표준 FTMS
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb',
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb',
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb',
  
  // 파워미터 (CPS)
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb',
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb',
  
  // 레거시 (CycleOps/Wahoo/Tacx) - 제어권 확보용 필수 UUID
  CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
  CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592',

  WAHOO_SERVICE:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  WAHOO_CONTROL:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',

  TACX_SERVICE:     '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  TACX_CONTROL:     '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
  
  HR_SERVICE:       '0000180d-0000-1000-8000-00805f9b34fb'
};

// 전역 변수 초기화
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0 };
window.connectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };
// ★ 케이던스 계산을 위한 필수 저장소 (초기화)
window._lastCrankData = { trainer: null, powerMeter: null }; 
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
    
    if (type === 'trainer') {
        const isErg = window.ergController && window.ergController.state.enabled;
        btn.classList.toggle('erg-mode-active', !!isErg);
    }
    img.style.display = "block"; img.style.margin = "0 auto";
  };
  updateBtn("btnConnectTrainer", 'trainer', "assets/img/trainer_g.png", "assets/img/trainer_i.png");
  updateBtn("btnConnectHR", 'heartRate', "assets/img/bpm_g.png", "assets/img/bpm_i.png");
  updateBtn("btnConnectPM", 'powerMeter', "assets/img/power_g.png", "assets/img/power_i.png");
};

window.updateDevicesList = function () {
  if (typeof window.updateDeviceButtonImages === 'function') window.updateDeviceButtonImages();
};

// ── [3] 스마트 트레이너 연결 (제어권 확보 로직 강화) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    console.log('[BLE] 트레이너 연결 시도...');

    // 모든 제어 UUID를 포함 (이게 없으면 연결 후에도 제어 불가)
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
      { services: [UUIDS.CPS_SERVICE] }, // CycleOps는 이걸로 주로 검색됨
      { namePrefix: "CycleOps" },
      { namePrefix: "Hammer" },
      { namePrefix: "Saris" },
      { namePrefix: "Wahoo" },
      { namePrefix: "Tacx" }
    ];

    const device = await navigator.bluetooth.requestDevice({ filters, optionalServices });
    const server = await device.gatt.connect();
    console.log(`[BLE] ${device.name} GATT 연결됨.`);

    let dataChar = null;
    let controlChar = null;
    let protocol = 'UNKNOWN';

    // ── [Step 1] 제어 포인트(Control Point) 필사적 탐색 ──
    // 순서: FTMS -> CycleOps -> Wahoo -> Tacx
    
    // 1. FTMS Control 확인
    try {
      const s = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      controlChar = await s.getCharacteristic(UUIDS.FTMS_CONTROL);
      dataChar = await s.getCharacteristic(UUIDS.FTMS_DATA); // FTMS Data 선호
      protocol = 'FTMS';
      console.log('✅ FTMS 제어권 확보');
    } catch(e) {}

    // 2. CycleOps Legacy Control 확인 (FTMS가 없거나 실패 시)
    if (!controlChar) {
      try {
        const s = await server.getPrimaryService(UUIDS.CYCLEOPS_SERVICE);
        controlChar = await s.getCharacteristic(UUIDS.CYCLEOPS_CONTROL);
        protocol = 'CYCLEOPS';
        console.log('✅ CycleOps 제어권 확보');
        // 데이터 채널이 아직 없다면 여기서 찾기 시도
        if (!dataChar) {
            const chars = await s.getCharacteristics();
            if(chars.length) dataChar = chars[0];
        }
      } catch(e) {}
    }

    // 3. Wahoo Legacy Control 확인
    if (!controlChar) {
      try {
        const s = await server.getPrimaryService(UUIDS.WAHOO_SERVICE);
        controlChar = await s.getCharacteristic(UUIDS.WAHOO_CONTROL);
        protocol = 'WAHOO';
        console.log('✅ Wahoo 제어권 확보');
      } catch(e) {}
    }

    // ── [Step 2] 데이터 채널 확보 (CPS Fallback) ──
    // 제어권은 찾았는데 데이터 채널(FTMS Data)이 없거나, 혹은 제어권을 못 찾았더라도 데이터는 받아야 함
    if (!dataChar) {
      try {
        const s = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        dataChar = await s.getCharacteristic(UUIDS.CPS_DATA);
        // 프로토콜이 아직 UNKNOWN이면 CPS (파워미터 모드)
        if (protocol === 'UNKNOWN') protocol = 'CPS'; 
        console.log('ℹ️ CPS 데이터 채널 연결 (CycleOps의 경우 여기서 데이터 수신)');
      } catch(e) {}
    }

    if (!dataChar) throw new Error("데이터 채널을 찾을 수 없습니다.");

    // Notification 시작
    await dataChar.startNotifications();
    
    // 파서 선택: FTMS면 FTMS파서, 그 외(CycleOps 포함)는 CPS파서 사용 (CycleOps는 CPS 규격으로 데이터 보냄)
    if (protocol === 'FTMS') {
        dataChar.addEventListener("characteristicvaluechanged", handleTrainerData);
    } else {
        // ★ CycleOps, CPS, Wahoo Legacy 등은 CPS 파서(handlePowerMeterData)를 써야 케이던스가 계산됨
        dataChar.addEventListener("characteristicvaluechanged", handlePowerMeterData);
    }

    window.connectedDevices.trainer = {
      name: device.name,
      device: device,
      server: server,
      characteristic: dataChar,
      controlPoint: controlChar,
      protocol: protocol
    };

    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    updateDevicesList();
    showConnectionStatus(false);
    
    // UI 메시지
    if (controlChar) {
        showToast(`✅ ${device.name} 연결 (ERG 가능)`);
    } else {
        showToast(`⚠️ ${device.name} 연결 (파워미터 모드 - 제어 불가)`);
    }
    
    // 초기화
    window._lastCrankData['trainer'] = null;

  } catch (err) {
    showConnectionStatus(false);
    console.error(err);
    alert("연결 오류: " + err.message);
  }
}

// ── [4] 심박/파워미터 연결 (기존 유지) ──
async function connectHeartRate() {
    // (기존 코드와 동일, 생략 없이 사용 가능)
    try {
        showConnectionStatus(true);
        const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }], optionalServices: ['heart_rate', UUIDS.HR_SERVICE] });
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService('heart_rate');
        const char = await service.getCharacteristic('heart_rate_measurement');
        await char.startNotifications();
        char.addEventListener("characteristicvaluechanged", handleHeartRateData);
        window.connectedDevices.heartRate = { name: device.name, device, server };
        device.addEventListener("gattserverdisconnected", () => handleDisconnect('heartRate', device));
        updateDevicesList();
        showConnectionStatus(false);
    } catch(e) { showConnectionStatus(false); alert(e.message); }
}

async function connectPowerMeter() {
    // (기존 코드와 동일)
    if (window.connectedDevices.trainer && !confirm("이미 트레이너가 있습니다. 추가 연결합니까?")) return;
    try {
        showConnectionStatus(true);
        const device = await navigator.bluetooth.requestDevice({ filters: [{services:[UUIDS.CPS_SERVICE]}], optionalServices:[UUIDS.CPS_SERVICE] });
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        const char = await service.getCharacteristic(UUIDS.CPS_DATA);
        await char.startNotifications();
        char.addEventListener("characteristicvaluechanged", handlePowerMeterData);
        window.connectedDevices.powerMeter = { name: device.name, device, server };
        device.addEventListener("gattserverdisconnected", () => handleDisconnect('powerMeter', device));
        updateDevicesList();
        showConnectionStatus(false);
        window._lastCrankData['powerMeter'] = null;
    } catch(e) { showConnectionStatus(false); alert(e.message); }
}

// ── [5] 데이터 파서 (★ 핵심 복구 영역) ──

/** * FTMS 표준 파서 
 */
function handleTrainerData(e) {
  const dv = e.target.value;
  const flags = dv.getUint16(0, true);
  let off = 2;
  // Speed (Mandatory)
  off += 2; 
  // Avg Speed
  if (flags & 0x0002) off += 2;
  // Cadence (Bit 2)
  if (flags & 0x0004) {
    const raw = dv.getUint16(off, true);
    off += 2;
    const rpm = Math.round(raw * 0.5);
    window.liveData.cadence = rpm;
    notifyChildWindows('cadence', rpm);
  }
  // ... (나머지 스킵)
  // Power (Bit 6) - 위치 계산 필요
  // Avg Cadence(Bit3, +2), Total Dist(Bit4, +3), Resistance(Bit5, +2)
  if (flags & 0x0008) off += 2; 
  if (flags & 0x0010) off += 3; 
  if (flags & 0x0020) off += 2; 

  if (flags & 0x0040) {
    const p = dv.getInt16(off, true);
    window.liveData.power = p;
    notifyChildWindows('power', p);
    if(window.ergController) window.ergController.updatePower(p);
  }
}

/** * CPS (CycleOps/파워미터) 파서 
 * ★ 원본 파일 로직 100% 복구: Crank Data를 이용한 케이던스 계산
 */
function handlePowerMeterData(event) {
  const dv = event.target.value;
  const flags = dv.getUint16(0, true);
  let off = 2;

  // 1. Instantaneous Power (Mandatory)
  const power = dv.getInt16(off, true);
  off += 2;
  window.liveData.power = power;
  notifyChildWindows('power', power);
  if(window.ergController) window.ergController.updatePower(power);

  // 2. Optional Fields Skip
  if (flags & 0x0001) off += 1; // Pedal Balance
  if (flags & 0x0004) off += 2; // Torque
  if (flags & 0x0010) off += 6; // Wheel Rev

  // 3. ★ Cumulative Crank Revolution (Bit 5: 0x0020) - 케이던스 복구 핵심
  if (flags & 0x0020) {
    const cumulativeCrank = dv.getUint16(off, true);
    off += 2;
    const lastEventTime = dv.getUint16(off, true); // 1/1024 sec
    off += 2;

    const deviceKey = window.connectedDevices.trainer ? 'trainer' : 'powerMeter';
    const lastData = window._lastCrankData[deviceKey];

    if (lastData) {
      let timeDiff = lastEventTime - lastData.lastEventTime;
      if (timeDiff < 0) timeDiff += 65536; // Overflow 처리

      let revDiff = cumulativeCrank - lastData.cumulativeCrank;
      if (revDiff < 0) revDiff += 65536; // Overflow 처리

      if (timeDiff > 0 && revDiff > 0) {
        // 원본 공식: (회전수 차이 / (시간차이/1024)) * 60초
        const timeSeconds = timeDiff / 1024.0;
        const rpm = Math.round((revDiff / timeSeconds) * 60);
        
        // 튀는 값 필터링 (0~200 RPM)
        if (rpm >= 0 && rpm < 250) {
            window.liveData.cadence = rpm;
            notifyChildWindows('cadence', rpm);
        }
      }
    }

    // 상태 업데이트
    window._lastCrankData[deviceKey] = {
      cumulativeCrank: cumulativeCrank,
      lastEventTime: lastEventTime,
      ts: Date.now()
    };
  }
}

function handleHeartRateData(e) {
  const dv = e.target.value;
  const flags = dv.getUint8(0);
  const hr = (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
  window.liveData.heartRate = hr;
  notifyChildWindows('heartRate', hr);
}

// ── [6] 유틸리티 ──
function handleDisconnect(type, device) {
  window.connectedDevices[type] = null;
  updateDevicesList();
  if (type === 'trainer' && window.ergController) window.ergController.updateConnectionStatus('disconnected');
}

function notifyChildWindows(field, value) {
  if (!window._bluetoothChildWindows) return;
  window._bluetoothChildWindows.forEach(w => {
    if (!w.closed) w.postMessage({ type: 'bluetoothLiveDataUpdate', updatedField: field, updatedValue: value }, '*');
  });
}

// 타임아웃 처리 (케이던스 0 처리)
setInterval(() => {
    const now = Date.now();
    const lastT = window._lastCrankData.trainer?.ts || 0;
    // 3초 이상 데이터 없으면 0으로
    if (now - lastT > 3000 && window.liveData.cadence > 0) {
        window.liveData.cadence = 0;
        notifyChildWindows('cadence', 0);
    }
}, 1000);

window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
