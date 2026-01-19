/* ==========================================================
   bluetooth.js (v1.2 stable)
   - 전역 상태 window.connectedDevices 로 통일
   - 연결 성공 시 showScreen('profileScreen')로 전환
   - startNotifications 이후에 updateDevicesList 호출
   - 오류/종료 시 showConnectionStatus(false) 보장
   - beforeunload에서 안전 disconnect
========================================================== */

// ── [최고의 기술 1] 표준 UUID 상수화 (브랜드 상관없이 기기 기능으로 검색) ──
const UUIDS = {
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', // Fitness Machine
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', // Indoor Bike Data
  // ★ 중요: ERG 제어용 128-bit Full UUID (Control Point 에러 해결 핵심)
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', // Cycling Power
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb', // Power Measurement
  
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', // Speed & Cadence
  
  HEART_RATE_SERVICE: '0000180d-0000-1000-8000-00805f9b34fb', // Heart Rate Service
  HEART_RATE_MEASUREMENT: '00002a37-0000-1000-8000-00805f9b34fb', // Heart Rate Measurement
  HRS_SERVICE:  '0000180d-0000-1000-8000-00805f9b34fb'  // Heart Rate
};

// ── [최고의 기술 2] BLE 명령 안정성 큐 (Command Queue) ──
// ERG 모드 변경 시 명령이 씹히거나 끊기는 것을 방지하는 안전장치
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
    if (this.queue.length > 0) setTimeout(() => this.process(), 100); // 0.1초 딜레이로 안정성 확보
  }
};








// 파일 상단에 한 번만
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };

const CPS_FLAG = {
  PEDAL_POWER_BALANCE_PRESENT: 0x0001,
  ACC_TORQUE_PRESENT:         0x0004,
  WHEEL_REV_DATA_PRESENT:     0x0010, // wheel
  CRANK_REV_DATA_PRESENT:     0x0020  // crank
};


// 전역 상태 단일화
window.connectedDevices = window.connectedDevices || {
  trainer: null,
  powerMeter: null,
  heartRate: null,
};

// 파일 상단(모듈 스코프)에 이전 값 저장용 상태 추가
let __pmPrev = { 
  revs: null, 
  time1024: null,
  lastRealTime: null,
  sampleCount: 0,
  validSamples: 0,
  recentCadences: [],
  consecutiveFailures: 0  // 연속 실패 카운트 추가
};



window.liveData = window.liveData || { 
  power: 0, 
  heartRate: 0, 
  cadence: 0,  // null 대신 0으로 초기화
  targetPower: 0 
};

// UI 헬퍼들 (index.html/app.js에 이미 있으면 중복 선언하지 마세요)
// bluetooth.js의 상단 UI 헬퍼 부분을 다음과 같이 수정
// UI 헬퍼들 - window 객체 확인 후 할당

// ── CPS (Cycling Power Service) UUIDs ─────────────────
const CYCLING_POWER_SERVICE = 0x1818;
const CYCLING_POWER_MEASUREMENT = 0x2A63; // cadence는 이 측정값의 crank rev 데이터로 계산



if (!window.showConnectionStatus) {
  window.showConnectionStatus = function (show) {
    const el = document.getElementById("connectionStatus");
    if (!el) return;
    el.classList.toggle("hidden", !show);
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

if (!window.showScreen) {
  window.showScreen = function (id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const el = document.getElementById(id);
    if (el) el.classList.add("active");
  };
}
// 버튼 이미지 업데이트 함수 (전역으로 노출)
window.updateDeviceButtonImages = window.updateDeviceButtonImages || function updateDeviceButtonImages() {
  const btnTrainer = document.getElementById("btnConnectTrainer");
  const btnHR = document.getElementById("btnConnectHR");
  const btnPM = document.getElementById("btnConnectPM");
  
  // 스마트 트레이너 버튼
  if (btnTrainer) {
    let img = btnTrainer.querySelector(".device-btn-icon");
    if (!img) {
      // 이미지가 없으면 생성
      img = document.createElement("img");
      img.className = "device-btn-icon";
      img.alt = "스마트 트레이너";
      const span = btnTrainer.querySelector("span");
      if (span) {
        btnTrainer.insertBefore(img, span);
      } else {
        btnTrainer.appendChild(img);
      }
    }
    // 블루투스 연결 또는 페어링 상태 확인
    const isBluetoothConnected = window.connectedDevices && window.connectedDevices.trainer;
    // Indoor Training 페어링 정보 확인 (iOS 모드 대응)
    let isPaired = false;
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
      isPaired = window.indoorTrainingState.powerMeters.some(pm => pm.trainerDeviceId && pm.trainerDeviceId.toString().trim() !== '');
    }
    const isConnected = isBluetoothConnected || isPaired;
    
    if (isConnected) {
      img.src = "assets/img/trainer_g.png";
      btnTrainer.classList.add("connected");
      console.log("스마트 트레이너 연결됨 - trainer_g.png로 변경", { bluetooth: isBluetoothConnected, paired: isPaired });
    } else {
      img.src = "assets/img/trainer_i.png";
      btnTrainer.classList.remove("connected");
      console.log("스마트 트레이너 연결 해제 - trainer_i.png로 변경");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  }
  
  // 심박계 버튼
  if (btnHR) {
    let img = btnHR.querySelector(".device-btn-icon");
    if (!img) {
      // 이미지가 없으면 생성
      img = document.createElement("img");
      img.className = "device-btn-icon";
      img.alt = "심박계 연결";
      const span = btnHR.querySelector("span");
      if (span) {
        btnHR.insertBefore(img, span);
      } else {
        btnHR.appendChild(img);
      }
    }
    // 블루투스 연결 또는 페어링 상태 확인
    const isBluetoothConnected = window.connectedDevices && window.connectedDevices.heartRate;
    // Indoor Training 페어링 정보 확인 (iOS 모드 대응)
    let isPaired = false;
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
      isPaired = window.indoorTrainingState.powerMeters.some(pm => pm.heartRateDeviceId && pm.heartRateDeviceId.toString().trim() !== '');
    }
    const isConnected = isBluetoothConnected || isPaired;
    
    if (isConnected) {
      img.src = "assets/img/bpm_g.png";
      btnHR.classList.add("connected");
      console.log("심박계 연결됨 - bpm_g.png로 변경", { bluetooth: isBluetoothConnected, paired: isPaired });
    } else {
      img.src = "assets/img/bpm_i.png";
      btnHR.classList.remove("connected");
      console.log("심박계 연결 해제 - bpm_i.png로 변경");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  }
  
  // 파워미터 버튼
  if (btnPM) {
    let img = btnPM.querySelector(".device-btn-icon");
    if (!img) {
      // 이미지가 없으면 생성
      img = document.createElement("img");
      img.className = "device-btn-icon";
      img.alt = "파워미터 연결";
      const span = btnPM.querySelector("span");
      if (span) {
        btnPM.insertBefore(img, span);
      } else {
        btnPM.appendChild(img);
      }
    }
    // 블루투스 연결 또는 페어링 상태 확인
    const isBluetoothConnected = window.connectedDevices && window.connectedDevices.powerMeter;
    // Indoor Training 페어링 정보 확인 (iOS 모드 대응)
    // 주의: 파워메터는 deviceId 또는 powerMeterDeviceId에 저장됨
    let isPaired = false;
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
      isPaired = window.indoorTrainingState.powerMeters.some(pm => {
        const deviceId = pm.deviceId || pm.powerMeterDeviceId;
        return deviceId && deviceId.toString().trim() !== '';
      });
    }
    const isConnected = isBluetoothConnected || isPaired;
    
    if (isConnected) {
      img.src = "assets/img/power_g.png";
      btnPM.classList.add("connected");
      console.log("파워미터 연결됨 - power_g.png로 변경", { bluetooth: isBluetoothConnected, paired: isPaired });
    } else {
      img.src = "assets/img/power_i.png";
      btnPM.classList.remove("connected");
      console.log("파워미터 연결 해제 - power_i.png로 변경");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  }
  
  // ANT+ 버튼
  const btnANT = document.getElementById("btnConnectANT");
  if (btnANT) {
    // 기존 이미지가 있으면 숨김
    const img = btnANT.querySelector(".device-btn-icon");
    if (img) {
      img.style.display = "none";
    }
    const isConnected = window.connectedDevices && window.connectedDevices.ant;
    if (isConnected) {
      btnANT.classList.add("connected");
      console.log("ANT+ 연결됨");
    } else {
      btnANT.classList.remove("connected");
      console.log("ANT+ 연결 해제");
    }
  }
  
  console.log("Device button images updated", {
    trainer: window.connectedDevices?.trainer ? "connected" : "disconnected",
    heartRate: window.connectedDevices?.heartRate ? "connected" : "disconnected",
    powerMeter: window.connectedDevices?.powerMeter ? "connected" : "disconnected",
    ant: window.connectedDevices?.ant ? "connected" : "disconnected"
  });
}

// 연결 정보 표시 제거 (단순화 - 버튼에 연결 상태만 표시)
window.updateDevicesList = window.updateDevicesList || function () {
  // 연결 정보 리스트는 표시하지 않음 (버튼에 연결 상태만 표시)
  // 버튼 이미지만 업데이트
  if (typeof updateDeviceButtonImages === 'function') {
    updateDeviceButtonImages();
  }
};


// 화면 전환 (app.js에 이미 있으면 중복 선언 금지)
window.showScreen = window.showScreen || function (id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
};

// ──────────────────────────────────────────────────────────
// 1) Smart Trainer (FTMS 우선, CPS 폴백, Strict Filtering)
// ──────────────────────────────────────────────────────────
async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;

    // [ERG 모드 우선] FTMS를 최우선으로 검색하여 ERG 모드가 정상 작동하도록 함
    // 1순위: FTMS_SERVICE (Fitness Machine Service - 0x1826) - ERG 모드 필수
    // 2순위: CPS_SERVICE (Cycling Power Service - 0x1818) - ERG 모드 미지원, 파워미터 모드
    // 브라우저가 필터 배열의 첫 번째 항목을 우선시하므로, FTMS를 먼저 배치
    const filters = [
      { services: [UUIDS.FTMS_SERVICE] },  // 1순위: FTMS 지원 기기 (ERG 모드 가능)
      { services: [UUIDS.CPS_SERVICE] }    // 2순위: CPS 기기 (ERG 모드 불가, 파워미터 모드)
    ];
    
    try {
      // FTMS를 우선 검색하여 ERG 모드가 정상 작동하도록 함
      console.log('[connectTrainer] 필터 검색 시도 (FTMS 우선):', { 
        filters: filters.map(f => f.services),
        ftmsService: UUIDS.FTMS_SERVICE,
        cpsService: UUIDS.CPS_SERVICE,
        note: 'FTMS를 먼저 검색하여 ERG 모드 지원 기기를 우선 연결'
      });
      device = await navigator.bluetooth.requestDevice({
        filters: filters,
        optionalServices: [
          UUIDS.FTMS_SERVICE,  // FTMS 서비스 (ERG 모드 필수)
          UUIDS.CPS_SERVICE,   // CPS 서비스 (폴백용)
          UUIDS.CSC_SERVICE,   // Speed & Cadence
          "device_information" // 디바이스 정보
        ]
      });
      console.log('[connectTrainer] ✅ 필터 검색 성공, 선택된 디바이스:', device.name || device.id);
    } catch (filterError) {
      console.log("⚠️ 필터 검색 실패(iOS 등), 전체 검색 후 검증 모드 진입:", filterError);
      // iOS 등에서 필터 검색이 실패하면 전체 검색 후 서비스 검증
      // acceptAllDevices: true로 검색하면 스마트로라도 포함되어 검색됨
      try {
        console.log('[connectTrainer] acceptAllDevices 모드로 재시도 (FTMS 우선 검색)...');
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
              UUIDS.FTMS_SERVICE,  // FTMS 서비스 (ERG 모드 필수) - 우선순위
              UUIDS.CPS_SERVICE,   // CPS 서비스 (폴백용)
              UUIDS.CSC_SERVICE,   // Speed & Cadence
              "device_information"  // 디바이스 정보
          ]
        });
        console.log('[connectTrainer] ✅ acceptAllDevices 검색 성공, 선택된 디바이스:', device.name || device.id);
      } catch (acceptAllError) {
        // acceptAllDevices도 실패한 경우, 사용자가 취소한 것으로 간주
        console.log("⚠️ 사용자가 디바이스 선택을 취소했습니다:", acceptAllError);
        showConnectionStatus(false);
        return;
      }
    }

    const server = await device.gatt.connect();
    console.log('[connectTrainer] ✅ GATT 서버 연결 성공');
    
    // [ERG 모드 우선] 연결 후 서비스 검증 - FTMS를 최우선으로 시도
    // ERG 모드를 사용하려면 반드시 FTMS 프로토콜이 필요함
    let service, characteristic, isFTMS = false;
    
    // 1순위: FTMS (Fitness Machine Service - 0x1826)
    // 스마트로라 제어(ERG)를 위해 이것을 가장 먼저 찾아야 함
    try {
      console.log('[connectTrainer] 1순위: FTMS 서비스 검색 시도 (ERG 모드 필수)...');
      service = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA);
      isFTMS = true;
      console.log('[connectTrainer] ✅ FTMS 프로토콜(스마트로라 모드)로 연결되었습니다. ERG 모드 사용 가능.');
    } catch (e1) {
      console.log('[connectTrainer] ⚠️ FTMS 서비스 없음, 2순위 CPS 서비스 시도...', e1.message);
      
      // 2순위: CPS (Cycling Power Service - 0x1818)
      // FTMS가 없을 때만 파워미터 모드로 연결 (ERG 모드 불가)
      try {
        console.log('[connectTrainer] 2순위: CPS 서비스 검색 시도 (파워미터 모드)...');
        service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
        isFTMS = false;
        console.warn('[connectTrainer] ⚠️ CPS 프로토콜(파워미터 모드)로 연결되었습니다. 경고: 이 모드에서는 ERG 사용 불가');
      } catch (e2) {
        // 필수 서비스가 없으므로 연결 끊고 에러 발생
        console.error('[connectTrainer] ❌ FTMS 및 CPS 서비스를 모두 찾을 수 없습니다.');
        await device.gatt.disconnect();
        throw new Error("선택하신 기기는 스마트 트레이너 기능을 지원하지 않습니다. FTMS 또는 CPS 서비스가 필요합니다.");
      }
    }

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged",
      isFTMS ? handleTrainerData : handlePowerMeterData
    );

    // [ERG 모드 필수] ERG Control Point 획득 (ERG 모드 동작의 핵심!)
    // FTMS 프로토콜로 연결된 경우에만 Control Point 획득 시도
    let controlPointChar = null;
    if (isFTMS) {
      console.log('[connectTrainer] ERG 제어권(Control Point) 획득 시도 (FTMS 프로토콜)...');
      try {
        // 1차 시도: 정확한 128-bit Full UUID 사용
        controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL);
        console.log('[connectTrainer] ✅ ERG Control Point 획득 성공 (Full UUID:', UUIDS.FTMS_CONTROL, ')');
      } catch (err) {
        console.warn('[connectTrainer] ⚠️ Full UUID로 Control Point 획득 실패, 별칭으로 재시도...', err.message);
        try {
          // 2차 시도: 일부 구형 기기를 위한 별칭 사용
          controlPointChar = await service.getCharacteristic("fitness_machine_control_point");
          console.log('[connectTrainer] ✅ ERG Control Point 획득 성공 (별칭: fitness_machine_control_point)');
        } catch (fatalErr) {
          console.error('[connectTrainer] ❌ ERG 제어권 획득 최종 실패. ERG 모드 사용 불가.', fatalErr);
          console.warn('[connectTrainer] ⚠️ 이 기기는 FTMS를 지원하지만 Control Point를 제공하지 않습니다. ERG 모드는 사용할 수 없습니다.');
        }
      }
    } else {
      console.log('[connectTrainer] ℹ️ CPS 프로토콜로 연결되었으므로 Control Point 획득을 건너뜁니다 (ERG 모드 미지원).');
    }

    // 객체 저장
    window.connectedDevices.trainer = { 
      name: device.name || "Smart Trainer", 
      device, 
      server, 
      characteristic,
      controlPoint: controlPointChar, // 여기가 null이 아니어야 ERG가 동작함
      protocol: isFTMS ? 'FTMS' : 'CPS' 
    };
    
    // ERG UI 활성화 (FTMS 프로토콜이고 Control Point가 있을 때만)
    if (isFTMS && controlPointChar) {
      console.log('[connectTrainer] ✅ ERG 모드 사용 가능 - UI 활성화');
      if (typeof updateErgModeUI === 'function') {
        updateErgModeUI(true);
      }
    } else {
      if (isFTMS && !controlPointChar) {
        console.warn('[connectTrainer] ⚠️ FTMS 프로토콜이지만 Control Point가 없어 ERG 모드 사용 불가');
      } else if (!isFTMS) {
        console.log('[connectTrainer] ℹ️ CPS 프로토콜로 연결되어 ERG 모드 사용 불가 - UI 비활성화');
      }
      if (typeof updateErgModeUI === 'function') {
        updateErgModeUI(false);
      }
    }

    // (기존 이벤트 리스너 로직 유지)
    device.addEventListener("gattserverdisconnected", () => {
        /* ...기존 disconnect 로직... */
        handleDisconnect('trainer', device); 
    });

    updateDevicesList();
    if (typeof window.updateDeviceButtonImages === "function") setTimeout(window.updateDeviceButtonImages, 100);
    showConnectionStatus(false);
    
    // 연결 성공 메시지에 프로토콜 정보 포함
    const protocolInfo = isFTMS 
      ? (controlPointChar ? ' (FTMS - ERG 모드 지원)' : ' (FTMS - ERG 모드 미지원)')
      : ' (CPS - ERG 모드 미지원)';
    const successMessage = `✅ ${device.name} 연결 성공${protocolInfo}`;
    console.log('[connectTrainer]', successMessage);
    if (typeof showToast === 'function') {
      showToast(successMessage);
    }

  } catch (err) {
    showConnectionStatus(false);
    console.error("[connectTrainer] ❌ 트레이너 연결 오류:", err);
    const errorMessage = err.message || "알 수 없는 오류가 발생했습니다.";
    if (typeof showToast === 'function') {
      showToast("❌ 연결 실패: " + errorMessage);
    }
  }
}

// 헬퍼 함수 (중복 코드 제거용)
function handleDisconnect(type, device) {
     if (window.connectedDevices[type]?.device === device) {
          if (type === 'trainer' && typeof toggleErgMode === 'function') toggleErgMode(false);
          window.connectedDevices[type] = null;
          if (type === 'trainer' && typeof updateErgModeUI === 'function') updateErgModeUI(false);
     }
     updateDevicesList();
     if (typeof window.updateDeviceButtonImages === "function") setTimeout(window.updateDeviceButtonImages, 100);
}

// ──────────────────────────────────────────────────────────
// 2) Power Meter (CPS & CSC 통합 검색)
// ──────────────────────────────────────────────────────────
async function connectPowerMeter() {
  try {
    showConnectionStatus(true);
    let device;
    
    // [기술 적용] 파워미터(CPS) 또는 속도/케이던스(CSC) 센서만 검색
    const filters = [
        { services: [UUIDS.CPS_SERVICE] },
        { services: [UUIDS.CSC_SERVICE] }
    ];

    try {
      device = await navigator.bluetooth.requestDevice({
        filters: filters,
        optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE, "device_information"]
      });
    } catch (e) {
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE, "device_information"]
      });
    }

    const server = await device.gatt.connect();

    // [기술 적용] 스마트 트레이너 중복 방지 (이미 트레이너로 연결된 기기인지 체크)
    if (window.connectedDevices.trainer?.device?.id === device.id) {
        // 이미 트레이너로 잡힌 기기면 파워미터 슬롯에는 등록 안 함 (데이터 충돌 방지)
        showToast("⚠️ 이미 트레이너로 연결된 기기입니다.");
        showConnectionStatus(false);
        return;
    }

    // 서비스 검증 (파워 -> 케이던스 순서)
    let service, characteristic;
    try {
        service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
    } catch (e) {
        try {
            service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
            characteristic = await service.getCharacteristic(0x2A5B); // CSC Measurement
        } catch (fatal) {
             device.gatt.disconnect();
             throw new Error("파워미터 또는 센서 기능을 찾을 수 없습니다.");
        }
    }

    await characteristic.startNotifications();
    // 데이터 핸들러는 서비스 종류에 따라 분기 필요하나, 일단 기존 핸들러 연결
    characteristic.addEventListener("characteristicvaluechanged", handlePowerMeterData);
    
    // CSC 추가 구독 (케이던스 보정용)
    trySubscribeCSC(server);

    window.connectedDevices.powerMeter = { 
        name: device.name || "Power Meter", 
        device, server, characteristic 
    };

    device.addEventListener("gattserverdisconnected", () => handleDisconnect('powerMeter', device));

    updateDevicesList();
    if (typeof window.updateDeviceButtonImages === "function") setTimeout(window.updateDeviceButtonImages, 100);
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결 성공`);

  } catch (err) {
    showConnectionStatus(false);
    console.error("파워미터 연결 오류:", err);
    showToast("❌ 연결 실패: " + err.message);
  }
}

// ──────────────────────────────────────────────────────────
// 3) Heart Rate (HRS) - Zwift 스타일 최고의 검색 로직 적용
// ──────────────────────────────────────────────────────────
async function connectHeartRate() {
  try {
    showConnectionStatus(true);

    let device;
    
    // [Zwift 스타일] 1단계: 표준 Heart Rate Service UUID로 필터 검색
    // 여러 UUID 형식 지원 (16-bit, 128-bit)
    const heartRateServiceUUIDs = [
      UUIDS.HEART_RATE_SERVICE,           // 128-bit Full UUID
      '0x180D',                            // 16-bit UUID (일부 브라우저 지원)
      'heart_rate',                        // 별칭 (일부 브라우저 지원)
      UUIDS.HRS_SERVICE                    // 동일한 서비스 (별칭)
    ];
    
    try {
      console.log('[connectHeartRate] 1단계: 필터 검색 시도 (표준 UUID)', {
        primaryUUID: UUIDS.HEART_RATE_SERVICE,
        allUUIDs: heartRateServiceUUIDs
      });
      
      // 표준 Heart Rate Service를 광고하는 기기 우선 검색
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [UUIDS.HEART_RATE_SERVICE] }],
        optionalServices: [
          UUIDS.HEART_RATE_SERVICE,
          UUIDS.HEART_RATE_MEASUREMENT,
          "device_information",
          "battery_service"  // 배터리 서비스도 포함 (일부 심박계 지원)
        ],
      });
      console.log('[connectHeartRate] ✅ 필터 검색 성공, 선택된 디바이스:', device.name || device.id);
    } catch (filterError) {
      console.log("⚠️ 필터 검색 실패 (iOS/Android 등), 2단계: 전체 검색 모드로 전환:", filterError);
      
      // [Zwift 스타일] 2단계: 필터 검색 실패 시 전체 검색 후 서비스 검증
      // iOS, Android 등에서 필터 검색이 제한적인 경우 대응
      // 광고에 heart_rate UUID가 없는 기기 (Garmin, Polar, Wahoo 등) 대응
      try {
        console.log('[connectHeartRate] 2단계: acceptAllDevices 모드로 재시도...');
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            UUIDS.HEART_RATE_SERVICE,
            UUIDS.HEART_RATE_MEASUREMENT,
            "device_information",
            "battery_service"
          ],
        });
        console.log('[connectHeartRate] ✅ acceptAllDevices 검색 성공, 선택된 디바이스:', device.name || device.id);
      } catch (acceptAllError) {
        console.log("⚠️ 사용자가 디바이스 선택을 취소했습니다:", acceptAllError);
        showConnectionStatus(false);
        if (typeof showToast === 'function') {
          showToast('심박계 검색이 취소되었습니다.');
        }
        return;
      }
    }

    // [Zwift 스타일] 3단계: 연결 및 서비스 검증
    console.log('[connectHeartRate] 3단계: 디바이스 연결 중...');
    const server = await device.gatt.connect();
    console.log('[connectHeartRate] ✅ GATT 서버 연결 성공');
    
    // [Zwift 스타일] 4단계: Heart Rate Service 검증 (다양한 UUID 형식 시도)
    let service, characteristic;
    let serviceFound = false;
    
    // 여러 방법으로 서비스 찾기 시도
    const serviceUUIDs = [
      UUIDS.HEART_RATE_SERVICE,  // 128-bit Full UUID (우선)
      '0x180D',                   // 16-bit UUID
      'heart_rate'                // 별칭
    ];
    
    for (const serviceUUID of serviceUUIDs) {
      try {
        console.log(`[connectHeartRate] 서비스 검색 시도: ${serviceUUID}`);
        service = await server.getPrimaryService(serviceUUID);
        serviceFound = true;
        console.log(`[connectHeartRate] ✅ Heart Rate 서비스 발견: ${serviceUUID}`);
        break;
      } catch (err) {
        console.log(`[connectHeartRate] ⚠️ 서비스 검색 실패 (${serviceUUID}):`, err.message);
        continue;
      }
    }
    
    if (!serviceFound || !service) {
      // 서비스가 없으면 연결 끊고 에러 발생
      console.error('[connectHeartRate] ❌ Heart Rate 서비스를 찾을 수 없습니다');
      await device.gatt.disconnect();
      throw new Error("선택하신 기기는 심박계 기능을 지원하지 않습니다. Heart Rate Service(0x180D)가 없습니다.");
    }

    // [Zwift 스타일] 5단계: Heart Rate Measurement 특성 획득
    const characteristicUUIDs = [
      UUIDS.HEART_RATE_MEASUREMENT,  // 128-bit Full UUID (우선)
      '0x2A37',                       // 16-bit UUID
      'heart_rate_measurement'        // 별칭
    ];
    
    let characteristicFound = false;
    for (const charUUID of characteristicUUIDs) {
      try {
        console.log(`[connectHeartRate] 특성 검색 시도: ${charUUID}`);
        characteristic = await service.getCharacteristic(charUUID);
        characteristicFound = true;
        console.log(`[connectHeartRate] ✅ Heart Rate Measurement 특성 발견: ${charUUID}`);
        break;
      } catch (err) {
        console.log(`[connectHeartRate] ⚠️ 특성 검색 실패 (${charUUID}):`, err.message);
        continue;
      }
    }
    
    if (!characteristicFound || !characteristic) {
      console.error('[connectHeartRate] ❌ Heart Rate Measurement 특성을 찾을 수 없습니다');
      await device.gatt.disconnect();
      throw new Error("선택하신 기기는 Heart Rate Measurement 특성(0x2A37)을 지원하지 않습니다.");
    }

    // [Zwift 스타일] 6단계: 알림 활성화
    console.log('[connectHeartRate] 6단계: 알림 활성화 중...');
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handleHeartRateData);
    console.log('[connectHeartRate] ✅ 알림 활성화 완료');

    // 연결 정보 저장
    window.connectedDevices.heartRate = { 
      name: device.name || "Heart Rate", 
      device, 
      server, 
      characteristic: characteristic  // 변수명 수정 (ch → characteristic)
    };

    // [Zwift 스타일] 7단계: 연결 해제 이벤트 리스너 등록
    device.addEventListener("gattserverdisconnected", () => {
      console.log('[connectHeartRate] ⚠️ 심박계 연결 해제됨');
      if (window.connectedDevices.heartRate?.device === device) {
        window.connectedDevices.heartRate = null;
        if (typeof showToast === 'function') {
          showToast('심박계 연결이 해제되었습니다.');
        }
      }
      updateDevicesList();
      if (typeof window.updateDeviceButtonImages === "function") {
        setTimeout(() => window.updateDeviceButtonImages(), 100);
      }
    });

    // UI 업데이트
    updateDevicesList();
    if (typeof window.updateDeviceButtonImages === "function") {
      setTimeout(() => window.updateDeviceButtonImages(), 100);
    }
    
    showConnectionStatus(false);
    const deviceName = device.name || "심박계";
    console.log(`[connectHeartRate] ✅ ${deviceName} 연결 완료`);
    if (typeof showToast === 'function') {
      showToast(`✅ ${deviceName} 연결 성공`);
    }
    
  } catch (err) {
    showConnectionStatus(false);
    console.error("[connectHeartRate] ❌ 심박계 연결 오류:", err);
    
    // 더 구체적인 에러 메시지 제공
    let errorMessage = "심박계 연결 실패";
    if (err.message) {
      errorMessage = err.message;
    } else if (err.name === 'NotFoundError') {
      errorMessage = "심박계를 찾을 수 없습니다. 기기가 켜져 있고 페어링 모드인지 확인해주세요.";
    } else if (err.name === 'SecurityError') {
      errorMessage = "Bluetooth 권한이 필요합니다. 브라우저 설정에서 권한을 확인해주세요.";
    } else if (err.name === 'NetworkError') {
      errorMessage = "네트워크 오류가 발생했습니다. 기기와의 거리를 확인해주세요.";
    }
    
    if (typeof showToast === 'function') {
      showToast(`❌ ${errorMessage}`);
    }
    
    // 연결 실패 시에도 버튼 이미지 업데이트
    if (typeof window.updateDeviceButtonImages === "function") {
      setTimeout(() => window.updateDeviceButtonImages(), 100);
    }
  }
}


// ──────────────────────────────────────────────────────────
// 파워미터 알림 파서 보강 (크랭크 데이터 → RPM 계산)
// ──────────────────────────────────────────────────────────
// 파일 상단(모듈 스코프)에 이전 값 저장용 상태 추가


// 파워미터 측정 알림
// 2. 파워미터 상태 변수 (기존과 동일)
let powerMeterState = { lastCrankRevs: null, lastCrankEventTime: null };
let powerMeterCadenceLastTs = 0;
const POWER_METER_CADENCE_TTL = 3000; // ms

// 3. handlePowerMeterData 함수를 다음으로 완전히 교체
// 파워미터 상태 저장용
//const powerMeterState = { lastCrankRevs: null, lastCrankEventTime: null };

// ⚡ CPS 측정 알림 파서 (Cycling Power Measurement: 0x2A63)
function handlePowerMeterData(event) {
  const dv = event.target.value; // DataView
  let off = 0;

  // 1) Flags, Instantaneous Power
  const flags = dv.getUint16(off, true); off += 2;
  const instPower = dv.getInt16(off, true); off += 2;
  if (!Number.isNaN(instPower)) {
    window.liveData.power = instPower;
    // ERG 모드용 데이터 버퍼 업데이트 (타임스탬프와 함께 저장)
    const now = Date.now();
    if (!window._recentPowerBuffer) window._recentPowerBuffer = [];
    window._recentPowerBuffer.push({ power: instPower, timestamp: now });
    // 최근 5초 동안의 데이터만 유지 (3초 평균 계산을 위해 여유 있게 5초)
    const fiveSecondsAgo = now - 5000;
    window._recentPowerBuffer = window._recentPowerBuffer.filter(entry => entry.timestamp > fiveSecondsAgo);
  }

  // 2) 옵션 필드 스킵
  if (flags & CPS_FLAG.PEDAL_POWER_BALANCE_PRESENT) off += 1; // 1 byte
  if (flags & CPS_FLAG.ACC_TORQUE_PRESENT)          off += 2; // 2 byte
  if (flags & CPS_FLAG.WHEEL_REV_DATA_PRESENT)      off += 6; // uint32 + uint16

  // 3) Crank Revolution Data → 케이던스(RPM)
  if (flags & CPS_FLAG.CRANK_REV_DATA_PRESENT) {
    const crankRevs = dv.getUint16(off, true); off += 2;
    const lastCrankTime = dv.getUint16(off, true); off += 2; // 1/1024s

    if (powerMeterState.lastCrankRevs !== null && powerMeterState.lastCrankEventTime !== null) {
      let dRevs = crankRevs - powerMeterState.lastCrankRevs;
      if (dRevs < 0) dRevs += 0x10000; // uint16 롤오버

      let dTicks = lastCrankTime - powerMeterState.lastCrankEventTime;
      if (dTicks < 0) dTicks += 0x10000; // uint16 롤오버

      if (dRevs > 0 && dTicks > 0) {
        const dtSec = dTicks / 1024;
        const rpm = (dRevs / dtSec) * 60;
        if (rpm > 0 && rpm < 220) {
          const roundedRpm = Math.round(rpm);
          // 이전 값과 다를 때만 로그 출력 및 자식 창에 알림
          const prevCadence = window.liveData.cadence;
          if (prevCadence !== roundedRpm) {
            console.log('[bluetooth.js] handlePowerMeterData - cadence 업데이트:', prevCadence, '→', roundedRpm, 'RPM');
            notifyChildWindows('cadence', roundedRpm);
          }
          window.liveData.cadence = roundedRpm;
          // 케이던스 업데이트 타임스탬프 저장
          if (!window._lastCadenceUpdateTime) window._lastCadenceUpdateTime = {};
          window._lastCadenceUpdateTime.powerMeter = Date.now();
          // ERG 모드용 데이터 버퍼 업데이트
          if (!window._recentCadenceBuffer) window._recentCadenceBuffer = [];
          window._recentCadenceBuffer.push(Math.round(rpm));
          if (window._recentCadenceBuffer.length > 120) {
            window._recentCadenceBuffer.shift();
          }
        } else {
          // rpm이 0이거나 유효 범위를 벗어나면 0으로 업데이트
          if (window.liveData.cadence !== 0) {
            const prevCadence = window.liveData.cadence;
            window.liveData.cadence = 0;
            console.log('[bluetooth.js] handlePowerMeterData - cadence 0으로 업데이트:', prevCadence, '→ 0 RPM');
            notifyChildWindows('cadence', 0);
          }
        }
      } else if (dRevs === 0 && dTicks > 0) {
        // dRevs가 0이면 케이던스 0으로 업데이트 (페달을 돌지 않음)
        if (window.liveData.cadence !== 0) {
          const prevCadence = window.liveData.cadence;
          window.liveData.cadence = 0;
          console.log('[bluetooth.js] handlePowerMeterData - cadence 0으로 업데이트 (dRevs=0):', prevCadence, '→ 0 RPM');
          notifyChildWindows('cadence', 0);
        }
      }
    }
    powerMeterState.lastCrankRevs = crankRevs;
    powerMeterState.lastCrankEventTime = lastCrankTime;
  }
}

// 3. 케이던스 UI 업데이트 함수 추가
function updateCadenceUI(cadence) {
  const cadenceEl = document.getElementById("cadenceValue");
  if (cadenceEl) {
    cadenceEl.textContent = cadence.toString();
    console.log(`📱 UI Updated - Cadence: ${cadence} RPM`);
  }
}


// ──────────────────────────────────────────────────────────
// 스마트 트레이너(FTMS)에서 케이던스 파싱
// ──────────────────────────────────────────────────────────

function handleTrainerData(e) {
  const dv = e.target.value instanceof DataView ? e.target.value : new DataView(e.target.value.buffer || e.target.value);
  let off = 0;

  const flags = dv.getUint16(off, true); off += 2;

  // flags 비트에 따라 필드가 존재할 수 있음:
  // 0: More Data
  // 1: Average Speed Present
  // 2: Instantaneous Cadence Present
  // 3: Average Cadence Present
  // 4: Total Distance Present
  // 5: Resistance Level Present
  // 6: Instantaneous Power Present
  // 7: Average Power Present
  // 등등 (기기별 차이)

  // Instantaneous Speed (uint16, 0.01 m/s) 존재 시 스킵
  if (flags & 0x0001) { off += 2; }
  // Average Speed (uint16) 존재 시 스킵
  if (flags & 0x0002) { off += 2; }

  // Instantaneous Cadence (uint16, 0.5 rpm) — ★ 여기서 케이던스
  if (flags & 0x0004) {
    const cadHalf = dv.getUint16(off, true); off += 2;
    const rpm = cadHalf / 2;
    const roundedRpm = Math.round(rpm);
    // window.liveData 초기화 확인
    if (!window.liveData) {
      window.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    }
    // 유효 범위 체크: 0이거나 0~220 범위 내의 값만 허용
    const validRpm = (roundedRpm >= 0 && roundedRpm < 220) ? roundedRpm : 0;
    // 이전 값과 다를 때만 로그 출력 및 자식 창에 알림
    const prevCadence = window.liveData.cadence;
    if (prevCadence !== validRpm) {
      console.log('[bluetooth.js] handleTrainerData - cadence 업데이트:', prevCadence, '→', validRpm, 'RPM');
      notifyChildWindows('cadence', validRpm);
    }
    window.liveData.cadence = validRpm;
    // 케이던스 업데이트 타임스탬프 저장
    if (!window._lastCadenceUpdateTime) window._lastCadenceUpdateTime = {};
    window._lastCadenceUpdateTime.trainer = Date.now();
    // ERG 모드용 데이터 버퍼 업데이트 (유효한 값만)
    if (validRpm > 0) {
      if (!window._recentCadenceBuffer) window._recentCadenceBuffer = [];
      window._recentCadenceBuffer.push(validRpm);
      if (window._recentCadenceBuffer.length > 120) {
        window._recentCadenceBuffer.shift();
      }
    }
  }

  // Average Cadence 존재 시 스킵
  if (flags & 0x0008) { off += 2; }

  // Total Distance (uint24) 존재 시 스킵
  if (flags & 0x0010) { off += 3; }

  // Resistance Level (int16) 존재 시 스킵
  if (flags & 0x0020) { off += 2; }

  // Instantaneous Power (int16) — ★ 파워
  if (flags & 0x0040) {
    const p = dv.getInt16(off, true); off += 2;
    // window.liveData 초기화 확인
    if (!window.liveData) {
      window.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    }
    // 이전 값과 다를 때만 로그 출력 및 자식 창에 알림
    const prevPower = window.liveData.power;
    if (prevPower !== p) {
      console.log('[bluetooth.js] handleTrainerData - power 업데이트:', prevPower, '→', p, 'W');
      notifyChildWindows('power', p);
    }
    window.liveData.power = p;
    // ERG 모드용 데이터 버퍼 업데이트 (타임스탬프와 함께 저장)
    const now = Date.now();
    if (!window._recentPowerBuffer) window._recentPowerBuffer = [];
    window._recentPowerBuffer.push({ power: p, timestamp: now });
    // 최근 5초 동안의 데이터만 유지 (3초 평균 계산을 위해 여유 있게 5초)
    const fiveSecondsAgo = now - 5000;
    window._recentPowerBuffer = window._recentPowerBuffer.filter(entry => entry.timestamp > fiveSecondsAgo);
  }

  // Average Power 등 다른 필드들은 필요한 만큼 스킵/파싱 추가…

  if (typeof window.updateTrainingDisplay === "function") {
    window.updateTrainingDisplay();
  }
}


// ──────────────────────────────────────────────────────────
// (권장) 파워미터가 Crank 데이터 안 주는 경우 대비 → CSC 서비스도 구독
// ──────────────────────────────────────────────────────────
// 파워미터 connect 이후(또는 별도 버튼) CSC도 시도
async function trySubscribeCSC(server) {
  try {
    const cscSvc = await server.getPrimaryService(0x1816);
    const cscMeas = await cscSvc.getCharacteristic(0x2A5B);
    await cscMeas.startNotifications();
    cscMeas.addEventListener("characteristicvaluechanged", (evt) => {
      const dv = evt.target.value;
      let o = 0;
      const flags = dv.getUint8(o); o += 1;
      // flags bit1: Crank Revolution Data Present
      if (flags & 0x02) {
        const cumRevs = dv.getUint16(o, true); o += 2;
        const evtTime = dv.getUint16(o, true); o += 2;

        // 이전 표본과 RPM 계산 (1과 동일 로직)
        if (__pmPrev.revs !== null && __pmPrev.time1024 !== null) {
          let dRevs = cumRevs - __pmPrev.revs; if (dRevs < 0) dRevs += 0x10000;
          let dT = evtTime - __pmPrev.time1024; if (dT < 0) dT += 0x10000;
          const sec = dT / 1024;
          if (sec > 0 && sec < 5) {
            const rpm = (dRevs / sec) * 60;
            window.liveData.cadence = Math.round(rpm);
          }
        }
        __pmPrev.revs = cumRevs;
        __pmPrev.time1024 = evtTime;

        window.updateTrainingDisplay && window.updateTrainingDisplay();
      }
    });
  } catch (_) {
    // CSC가 없으면 조용히 패스
  }
}




// ──────────────────────────────────────────────────────────
// BLE 데이터 파서 (기존 함수명/로직 유지해도 OK)
// ──────────────────────────────────────────────────────────


window.handleHeartRateData = window.handleHeartRateData || function (event) {
  const dv = event.target.value;
  const flags = dv.getUint8(0);
  const hr = (flags & 0x1) ? dv.getUint16(1, true) : dv.getUint8(1);
  const roundedHR = Math.round(hr);
  
  // window.liveData 초기화 확인
  if (!window.liveData) {
    window.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
  }
  
  // 이전 값과 다를 때만 로그 출력 및 자식 창에 알림
  const prevHR = window.liveData.heartRate;
  if (prevHR !== roundedHR) {
    console.log('[bluetooth.js] handleHeartRateData 호출:', roundedHR, 'bpm (이전:', prevHR, 'bpm)');
    
    // 자식 창에 postMessage로 알림
    notifyChildWindows('heartRate', roundedHR);
  }
  
  window.liveData.heartRate = roundedHR;
  
  // ERG 모드용 데이터 버퍼 업데이트
  if (!window._recentHRBuffer) window._recentHRBuffer = [];
  window._recentHRBuffer.push(roundedHR);
  if (window._recentHRBuffer.length > 120) {
    window._recentHRBuffer.shift();
  }
  if (window.updateTrainingDisplay) window.updateTrainingDisplay();
};

// ──────────────────────────────────────────────────────────
// 언로드 시 안전 disconnect
// ──────────────────────────────────────────────────────────
window.addEventListener("beforeunload", () => {
  try {
    if (connectedDevices.trainer?.server?.connected) connectedDevices.trainer.device.gatt.disconnect();
    if (connectedDevices.powerMeter?.server?.connected) connectedDevices.powerMeter.device.gatt.disconnect();
    if (connectedDevices.heartRate?.server?.connected) connectedDevices.heartRate.device.gatt.disconnect();
  } catch (e) { /* noop */ }
});



// 자식 창에 liveData 업데이트 알림 함수
function notifyChildWindows(field, value) {
  try {
    // 열린 자식 창들을 찾기
    if (!window._bluetoothChildWindows) {
      window._bluetoothChildWindows = [];
    }
    
    // 닫힌 창 제거
    window._bluetoothChildWindows = window._bluetoothChildWindows.filter(win => {
      try {
        return !win.closed;
      } catch (e) {
        return false;
      }
    });
    
    // 각 자식 창에 liveData 업데이트 알림
    if (window._bluetoothChildWindows.length > 0) {
      window._bluetoothChildWindows.forEach(childWin => {
        try {
          if (!childWin.closed) {
            childWin.postMessage({
              type: 'bluetoothLiveDataUpdate',
              heartRate: window.liveData?.heartRate || 0,
              power: window.liveData?.power || 0,
              cadence: window.liveData?.cadence || 0,
              updatedField: field,
              updatedValue: value
            }, window.location.origin);
          }
        } catch (e) {
          // 자식 창 접근 실패 - 조용히 무시
        }
      });
    }
  } catch (e) {
    // postMessage 실패 - 조용히 무시
  }
}

/**
 * 최근 3초 동안의 파워값 평균 계산
 * @returns {number} 3초 평균 파워값 (W)
 */
function get3SecondAveragePower() {
  if (!window._recentPowerBuffer || window._recentPowerBuffer.length === 0) {
    // 버퍼가 없거나 비어있으면 현재 파워값 반환
    return Math.round(window.liveData?.power || 0);
  }
  
  const now = Date.now();
  const threeSecondsAgo = now - 3000; // 3초 전
  
  // 최근 3초 동안의 파워값만 필터링
  const recentPowers = window._recentPowerBuffer
    .filter(entry => entry.timestamp > threeSecondsAgo)
    .map(entry => entry.power);
  
  if (recentPowers.length === 0) {
    // 최근 3초 동안 데이터가 없으면 현재 파워값 반환
    return Math.round(window.liveData?.power || 0);
  }
  
  // 평균 계산
  const sum = recentPowers.reduce((acc, power) => acc + power, 0);
  const average = Math.round(sum / recentPowers.length);
  
  return average;
}

// 전역 export
window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
// 데이터 핸들러 함수들도 window에 노출 (bluetoothIndividual.js에서 래핑하기 위해)
window.handlePowerMeterData = handlePowerMeterData;
window.handleTrainerData = handleTrainerData;
window.connectHeartRate = connectHeartRate;
window.notifyChildWindows = notifyChildWindows; // 자식 창 알림 함수도 노출
window.get3SecondAveragePower = get3SecondAveragePower; // 3초 평균 파워 계산 함수 노출

/**
 * 케이던스 타임아웃 체크 (일정 시간 동안 데이터가 없으면 0으로 설정)
 * 3초 동안 케이던스 데이터가 오지 않으면 0으로 설정
 */
function checkCadenceTimeout() {
  if (!window._lastCadenceUpdateTime) {
    window._lastCadenceUpdateTime = {};
  }
  
  const now = Date.now();
  const timeoutMs = 3000; // 3초 타임아웃
  
  // 파워메터와 스마트 트레이너 중 하나라도 활성화되어 있으면 체크
  const hasPowerMeter = window.connectedDevices?.powerMeter?.device;
  const hasTrainer = window.connectedDevices?.trainer?.device;
  
  if (hasPowerMeter || hasTrainer) {
    // 파워메터 케이던스 타임아웃 체크
    if (hasPowerMeter) {
      const lastUpdate = window._lastCadenceUpdateTime.powerMeter || 0;
      if (lastUpdate > 0 && (now - lastUpdate) > timeoutMs && window.liveData.cadence !== 0) {
        const prevCadence = window.liveData.cadence;
        window.liveData.cadence = 0;
        console.log('[bluetooth.js] 케이던스 타임아웃 (파워메터): 3초 동안 데이터 없음, 0으로 설정:', prevCadence, '→ 0 RPM');
        notifyChildWindows('cadence', 0);
        window._lastCadenceUpdateTime.powerMeter = 0; // 타임아웃 처리 후 리셋
      }
    }
    
    // 스마트 트레이너 케이던스 타임아웃 체크
    if (hasTrainer) {
      const lastUpdate = window._lastCadenceUpdateTime.trainer || 0;
      if (lastUpdate > 0 && (now - lastUpdate) > timeoutMs && window.liveData.cadence !== 0) {
        const prevCadence = window.liveData.cadence;
        window.liveData.cadence = 0;
        console.log('[bluetooth.js] 케이던스 타임아웃 (스마트 트레이너): 3초 동안 데이터 없음, 0으로 설정:', prevCadence, '→ 0 RPM');
        notifyChildWindows('cadence', 0);
        window._lastCadenceUpdateTime.trainer = 0; // 타임아웃 처리 후 리셋
      }
    }
  }
}

// 케이던스 타임아웃 체크를 1초마다 실행
if (!window._cadenceTimeoutInterval) {
  window._cadenceTimeoutInterval = setInterval(checkCadenceTimeout, 1000);

}
