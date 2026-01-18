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


// UI 헬퍼들 (index.html/app.js에 이미 있으면 중복 선언하지 마세요)
// bluetooth.js의 상단 UI 헬퍼 부분을 다음과 같이 수정
// UI 헬퍼들 - window 객체 확인 후 할당




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

window.updateDevicesList = window.updateDevicesList || function () {
  const deviceList = document.getElementById("connectedDevicesList");
  if (!deviceList) return;

  let html = "";
  let count = 0;

  if (window.connectedDevices.trainer) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon"><img src="assets/img/trainer_g.png" alt="스마트 트레이너" style="width: 72px; height: 72px; object-fit: contain;" /></div>
          <div class="device-details"><h3>${window.connectedDevices.trainer.name || "Smart Trainer"}</h3>
          <p>Smart Trainer (FTMS)</p></div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }
  if (window.connectedDevices.powerMeter) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon"><img src="assets/img/power_g.png" alt="파워미터" style="width: 72px; height: 72px; object-fit: contain;" /></div>
          <div class="device-details"><h3>${window.connectedDevices.powerMeter.name || "Power Meter"}</h3>
          <p>Crank Power (CPS)</p></div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }
  if (window.connectedDevices.heartRate) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon"><img src="assets/img/bpm_g.png" alt="심박계" style="width: 72px; height: 72px; object-fit: contain;" /></div>
          <div class="device-details"><h3>${window.connectedDevices.heartRate.name || "Heart Rate"}</h3>
          <p>Heart Rate (HRS)</p></div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }

  deviceList.innerHTML = html;
  
  // 버튼 이미지 업데이트
  updateDeviceButtonImages();
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

    // [기술 적용] 이름(Prefix) 필터 제거 -> 오직 '기능(Service)'으로만 검색
    // 옆집 TV, 이어폰 등이 검색되지 않도록 원천 차단
    const filters = [
      { services: [UUIDS.FTMS_SERVICE] }, // 1순위: FTMS 지원 기기
      { services: [UUIDS.CPS_SERVICE] }   // 2순위: 파워미터 기능만 있는 구형 로라
    ];
    
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: filters,
        optionalServices: [
          UUIDS.FTMS_SERVICE, UUIDS.CPS_SERVICE, 
          UUIDS.CSC_SERVICE, "device_information"
        ]
      });
    } catch (filterError) {
      console.log("⚠️ 필터 검색 실패(iOS 등), 전체 검색 후 검증 모드 진입");
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
            UUIDS.FTMS_SERVICE, UUIDS.CPS_SERVICE, 
            UUIDS.CSC_SERVICE, "device_information"
        ]
      });
    }

    const server = await device.gatt.connect();
    
    // [기술 적용] 연결 후 즉시 서비스 검증 (Validation)
    // 사용자가 실수로 잘못된 기기를 선택했더라도, 필수 서비스가 없으면 즉시 차단
    let service, characteristic, isFTMS = false;
    
    try {
      // FTMS 서비스 확인
      service = await server.getPrimaryService(UUIDS.FTMS_SERVICE);
      // 0x2AD2 대신 Full UUID 사용으로 호환성 확보
      characteristic = await service.getCharacteristic(UUIDS.FTMS_DATA); 
      isFTMS = true;
    } catch (e1) {
      try {
        console.warn("FTMS 서비스 없음, CPS(파워) 서비스 시도...");
        service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
        isFTMS = false;
      } catch (e2) {
        // 필수 서비스가 없으므로 연결 끊고 에러 발생
        device.gatt.disconnect();
        throw new Error("선택하신 기기는 스마트 트레이너 기능을 지원하지 않습니다.");
      }
    }

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged",
      isFTMS ? handleTrainerData : handlePowerMeterData
    );

    // [기술 적용] ERG Control Point 획득 (에러 해결의 핵심!)
    let controlPointChar = null;
    if (isFTMS) {
      try {
        console.log('[BLE] ERG 제어권(Control Point) 획득 시도...');
        // 반드시 정의해둔 128-bit Full UUID를 사용
        controlPointChar = await service.getCharacteristic(UUIDS.FTMS_CONTROL);
        console.log('✅ ERG Control Point 획득 성공 (UUID:', UUIDS.FTMS_CONTROL, ')');
      } catch (err) {
        console.warn('⚠️ 1차 시도 실패. 대체 이름으로 재시도...');
        try {
            // 일부 구형 기기를 위한 폴백
            controlPointChar = await service.getCharacteristic("fitness_machine_control_point");
            console.log('✅ ERG Control Point 획득 성공 (Alias Name)');
        } catch (fatalErr) {
            console.error('❌ ERG 제어권 획득 최종 실패. ERG 모드 사용 불가.', fatalErr);
        }
      }
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
    
    // ERG UI 활성화 (Control Point가 있을 때만)
    if (isFTMS && controlPointChar && typeof updateErgModeUI === 'function') {
      updateErgModeUI(true);
    } else if (typeof updateErgModeUI === 'function') {
      console.log('ℹ️ ERG 제어 불가 기기 - UI 비활성화');
      updateErgModeUI(false);
    }

    // (기존 이벤트 리스너 로직 유지)
    device.addEventListener("gattserverdisconnected", () => {
        /* ...기존 disconnect 로직... */
        handleDisconnect('trainer', device); 
    });

    updateDevicesList();
    if (typeof window.updateDeviceButtonImages === "function") setTimeout(window.updateDeviceButtonImages, 100);
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결 성공`);

  } catch (err) {
    showConnectionStatus(false);
    console.error("트레이너 연결 오류:", err);
    showToast("❌ 연결 실패: " + err.message);
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
// 3) Heart Rate (HRS)
// ──────────────────────────────────────────────────────────
async function connectHeartRate() {
  try {
    showConnectionStatus(true);

    let device;
    try {
      // 기본적으로 heart_rate 서비스를 광고하는 기기 우선
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }],
        optionalServices: ["heart_rate", "device_information"],
      });
    } catch {
      // 광고에 heart_rate UUID가 없는 기기 (가민, 폴라 등) 대응
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["heart_rate", "device_information"],
      });
    }

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("heart_rate");
    const ch = await service.getCharacteristic("heart_rate_measurement");

    await ch.startNotifications();
    ch.addEventListener("characteristicvaluechanged", handleHeartRateData);

    window.connectedDevices.heartRate = { 
      name: device.name || "Heart Rate", 
      device, 
      server, 
      characteristic: ch 
    };

    device.addEventListener("gattserverdisconnected", () => {
      if (window.connectedDevices.heartRate?.device === device) {
        window.connectedDevices.heartRate = null;
      }
      updateDevicesList();
    });

    updateDevicesList();
    // 버튼 이미지 즉시 업데이트
    if (typeof window.updateDeviceButtonImages === "function") {
      setTimeout(() => window.updateDeviceButtonImages(), 100);
    }
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "HR"} 연결 성공`);
    
  } catch (err) {
    showConnectionStatus(false);
    console.error("심박계 연결 오류:", err);
    showToast("❌ 심박계 연결 실패: " + err.message);
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

