/* ==========================================================
   bluetooth.js (v5.0 Connection & UI Fix)
   - 연결 즉시 버튼 녹색 전환 (UI 강제 갱신)
   - "Control Point Missing" 해결을 위한 UUID 풀 스캔 적용
   - Wahoo/CycleOps/Tacx 레거시 모드 완벽 지원
========================================================== */

// ── [1] UUID 상수 (제어권 확보를 위한 필수 목록) ──
const UUIDS = {
  // 1. 표준 FTMS (Fitness Machine Service)
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', 
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  
  // 2. 파워미터/센서 (CPS, CSC)
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb', 
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  
  // 3. 레거시/제조사 전용 (필수: 이것들이 없으면 Control Point Missing 발생)
  CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
  CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592', 

  WAHOO_SERVICE:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  WAHOO_CONTROL:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',

  TACX_SERVICE:     '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  TACX_CONTROL:     '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
  
  HR_SERVICE:       '0000180d-0000-1000-8000-00805f9b34fb'
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

// 전역 상태
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
window.connectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };
window._lastCadenceUpdateTime = {};
window._lastCrankData = {}; 

// ── [2] UI 헬퍼 (버튼 색상 문제 해결) ──

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

// ★ [Fix] 버튼 이미지 업데이트 로직 강화
window.updateDeviceButtonImages = window.updateDeviceButtonImages || function () {
  const btnTrainer = document.getElementById("btnConnectTrainer");
  const btnHR = document.getElementById("btnConnectHR");
  const btnPM = document.getElementById("btnConnectPM");
  
  const updateBtn = (btn, type, imgOn, imgOff) => {
    if (!btn) return;
    
    // 이미지 태그 찾기 혹은 생성
    let img = btn.querySelector("img.device-btn-icon"); // 클래스로 명확히 찾기
    if (!img) {
      // 혹시 클래스가 없는 img가 있는지 확인
      img = btn.querySelector("img");
      if (!img) {
          img = document.createElement("img");
          img.className = "device-btn-icon";
          const span = btn.querySelector("span");
          span ? btn.insertBefore(img, span) : btn.appendChild(img);
      } else {
          img.classList.add("device-btn-icon");
      }
    }
    
    const isConnected = window.connectedDevices && window.connectedDevices[type];
    
    // 연결 상태에 따라 이미지 소스 및 클래스 변경
    if (isConnected) {
      img.src = imgOn; // 녹색 이미지
      btn.classList.add("connected");
    } else {
      img.src = imgOff; // 회색 이미지
      btn.classList.remove("connected");
      btn.classList.remove("erg-mode-active");
    }
    
    // 스타일 강제 적용
    img.style.display = "block";
    img.style.margin = "0 auto";
    // 캐싱 방지를 위해 src 재확인 (선택사항)
  };

  // 경로 확인: assets/img/ 폴더에 해당 파일들이 있어야 함
  updateBtn(btnTrainer, 'trainer', "assets/img/trainer_g.png", "assets/img/trainer_i.png");
  updateBtn(btnHR, 'heartRate', "assets/img/bpm_g.png", "assets/img/bpm_i.png");
  updateBtn(btnPM, 'powerMeter', "assets/img/power_g.png", "assets/img/power_i.png");
  
  // ERG 상태 컬러 반영
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

// ── [3] 스마트 트레이너 연결 (★ Control Point Missing 해결) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;
    console.log('[connectTrainer] 검색 시작...');

    // 1. 모든 서비스 UUID를 포함하여 검색 (중요)
    const filters = [
      { services: [UUIDS.FTMS_SERVICE] },
      { services: [UUIDS.CPS_SERVICE] },
      { namePrefix: "CycleOps" },
      { namePrefix: "Hammer" },
      { namePrefix: "Saris" },
      { namePrefix: "Wahoo" }, 
      { namePrefix: "KICKR" },
      { namePrefix: "Tacx" }
    ];

    // ★ 여기에 명시되지 않은 서비스는 연결 후에도 접근 불가 (Security Error)
    const optionalServices = [
      UUIDS.FTMS_SERVICE, UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE,
      UUIDS.CYCLEOPS_SERVICE, UUIDS.WAHOO_SERVICE, UUIDS.TACX_SERVICE,
      "device_information"
    ];

    try {
      device = await navigator.bluetooth.requestDevice({ filters, optionalServices });
    } catch (scanErr) {
      showConnectionStatus(false);
      if (scanErr.name !== 'NotFoundError') alert("❌ 검색 취소/오류: " + scanErr.message);
      return;
    }

    const server = await device.gatt.connect();
    console.log('[connectTrainer] GATT 연결됨. 서비스 탐색 중...');

    let service, characteristic, controlPointChar = null;
    let realProtocol = 'UNKNOWN';

    // [Step 1] 표준 FTMS 제어권 탐색
    try {
      service = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA);
      realProtocol = 'FTMS';
      try { 
          controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL);
          console.log('✅ FTMS Control Point 발견');
      } catch(e) { console.warn('FTMS Control Point 없음 (Data Only)'); }
    } catch (e) {}

    // [Step 2] Legacy 제어권 탐색 (FTMS 제어점이 없을 경우 필수)
    if (!controlPointChar) {
      // CycleOps
      try {
        const legacySvc = await server.getPrimaryService(UUIDS.CYCLEOPS_SERVICE);
        controlPointChar = await legacySvc.getCharacteristic(UUIDS.CYCLEOPS_CONTROL);
        realProtocol = 'CYCLEOPS';
        // 데이터 채널도 레거시에서 확보 시도
        if(!characteristic) {
            const chars = await legacySvc.getCharacteristics();
            if(chars.length > 0) characteristic = chars[0];
        }
        console.log('✅ CycleOps Control Point 발견');
      } catch (e) {}
    }

    if (!controlPointChar) {
      // Wahoo
      try {
        const wahooSvc = await server.getPrimaryService(UUIDS.WAHOO_SERVICE);
        controlPointChar = await wahooSvc.getCharacteristic(UUIDS.WAHOO_CONTROL);
        realProtocol = 'WAHOO';
        if(!characteristic) {
            const chars = await wahooSvc.getCharacteristics();
            if(chars.length > 0) characteristic = chars[0];
        }
        console.log('✅ Wahoo Control Point 발견');
      } catch (e) {}
    }

    if (!controlPointChar) {
      // Tacx
       try {
        const tacxSvc = await server.getPrimaryService(UUIDS.TACX_SERVICE);
        controlPointChar = await tacxSvc.getCharacteristic(UUIDS.TACX_CONTROL);
        realProtocol = 'TACX'; // Tacx는 별도 처리가 필요할 수 있음
        console.log('✅ Tacx Control Point 발견');
       } catch(e) {}
    }

    // [Step 3] 최후의 수단: 데이터 채널만이라도 확보 (CPS)
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

    // ★ Control Point 구독 (Start Notifications) - ERG 필수
    if (controlPointChar) {
        try {
            await controlPointChar.startNotifications();
            console.log('🔓 Control Point 구독 성공');
        } catch (subErr) {
            console.warn('Control Point 구독 실패 (쓰기 전용일 수 있음):', subErr);
            // 구독 실패해도 controlPointChar 객체는 유지해야 ERG 시도 가능
        }
    } else {
        console.warn("⚠️ 경고: Control Point를 찾지 못했습니다. ERG 모드 사용 불가.");
    }

    // 데이터 알림 시작
    await characteristic.startNotifications();
    const parser = (realProtocol === 'FTMS') ? handleTrainerData : handlePowerMeterData;
    characteristic.addEventListener("characteristicvaluechanged", parser);

    // 프로토콜 위장 (Legacy도 FTMS인 척 해야 내부 로직이 돎)
    const name = (device.name || "").toUpperCase();
    let fakeProtocol = realProtocol;
    if (realProtocol === 'CYCLEOPS' || realProtocol === 'WAHOO' || realProtocol === 'TACX') {
        fakeProtocol = 'FTMS'; 
    }

    // 객체 저장
    window.connectedDevices.trainer = { 
      name: device.name, device, server, characteristic,
      controlPoint: controlPointChar,
      protocol: fakeProtocol,
      realProtocol: realProtocol
    };

    // 연결 해제 이벤트
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    // ★ [핵심 Fix] 버튼 색상 즉시 변경 강제 실행
    if (typeof updateDevicesList === 'function') {
        console.log("UI 업데이트 실행");
        updateDevicesList(); 
    }
    
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결됨`);

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
    const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['heart_rate', UUIDS.HR_SERVICE]
    });
    const server = await device.gatt.connect();
    let service = await server.getPrimaryService('heart_rate').catch(()=>server.getPrimaryService(UUIDS.HR_SERVICE));
    let char = await service.getCharacteristic('heart_rate_measurement').catch(()=>service.getCharacteristic(0x2A37));
    await char.startNotifications();
    char.addEventListener("characteristicvaluechanged", handleHeartRateData);
    
    window.connectedDevices.heartRate = { name: device.name, device, server, characteristic: char };
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('heartRate', device));
    
    updateDevicesList(); // UI 갱신
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결됨`);
  } catch (err) {
    showConnectionStatus(false);
    alert("심박계 오류: " + err.message);
  }
}

async function connectPowerMeter() {
  if (window.connectedDevices.trainer && !confirm("트레이너 교체하시겠습니까?")) return;
  try {
    showConnectionStatus(true);
    const device = await navigator.bluetooth.requestDevice({ 
        filters: [{ services: [UUIDS.CPS_SERVICE] }], 
        optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE] 
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
    const char = await service.getCharacteristic(UUIDS.CPS_DATA);
    await char.startNotifications();
    char.addEventListener("characteristicvaluechanged", handlePowerMeterData);
    
    window.connectedDevices.powerMeter = { name: device.name, device, server, characteristic: char };
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('powerMeter', device));
    
    updateDevicesList(); // UI 갱신
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결됨`);
  } catch (err) {
    showConnectionStatus(false);
    alert("파워미터 오류: " + err.message);
  }
}

// ── [5] 데이터 파서 (케이던스/파워) ──
function handleTrainerData(e) {
  const dv = e.target.value;
  if (dv.byteLength < 4) return;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  off += 2; // Inst Speed (Mandatory)
  if (flags & 0x0002) off += 2; // Avg Speed
  
  // Inst Cadence
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
  
  // Inst Power
  if (flags & 0x0040) {
    const p = dv.getInt16(off, true);
    if (!Number.isNaN(p)) {
      window.liveData.power = p;
      notifyChildWindows('power', p);
    }
  }
}

function handlePowerMeterData(event) {
  const dv = event.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  const p = dv.getInt16(off, true); off += 2;
  if (!Number.isNaN(p)) { window.liveData.power = p; notifyChildWindows('power', p); }
  
  if (flags & 0x0001) off += 1;
  if (flags & 0x0004) off += 2;
  if (flags & 0x0010) off += 6;
  
  // Crank Data for Cadence
  if (flags & 0x0020) {
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
  updateDevicesList(); // 연결 해제 시에도 즉시 UI 갱신
}
function notifyChildWindows(f, v) {
  if (window._bluetoothChildWindows) {
      window._bluetoothChildWindows.forEach(w => {
          if(!w.closed) w.postMessage({ type: 'bluetoothLiveDataUpdate', updatedField: f, updatedValue: v, ...window.liveData }, '*');
      });
  }
}
setInterval(() => { // 케이던스 0 처리
    if(window.liveData.cadence > 0 && (Date.now() - (window._lastCadenceUpdateTime.trainer||0) > 3000)) {
        window.liveData.cadence = 0; notifyChildWindows('cadence', 0);
    }
}, 1000);

window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
window.setTargetPower = function(w) { if(window.ergController) window.ergController.setTargetPower(w); };
