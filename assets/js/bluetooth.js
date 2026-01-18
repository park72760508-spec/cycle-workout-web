/* ==========================================================
   bluetooth.js (v1.2 stable)
   - 전역 상태 window.connectedDevices 로 통일
   - 연결 성공 시 showScreen('profileScreen')로 전환
   - startNotifications 이후에 updateDevicesList 호출
   - 오류/종료 시 showConnectionStatus(false) 보장
   - beforeunload에서 안전 disconnect
========================================================== */
// 파일 상단에 한 번만
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };


/* ==========================================================
   bluetooth.js (v2.0 Optimized)
   - Service UUID 기반의 정밀 필터링 (브랜드 이름 의존 제거)
   - 연결 후 서비스 검증(Validation) 로직 강화
   - 잘못된 기기 선택 시 자동 차단
========================================================== */

// ── Standard BLE UUID Constants ───────────────────────────
const UUIDS = {
  FTMS: 0x1826,      // Fitness Machine Service (스마트 트레이너)
  CPS:  0x1818,      // Cycling Power Service (파워미터)
  CSC:  0x1816,      // Cycling Speed and Cadence (속도/케이던스 센서)
  HRS:  0x180D       // Heart Rate Service (심박계)
};



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
// 1) Smart Trainer (FTMS 우선, CPS 폴백) - 정밀 검색 로직
// ──────────────────────────────────────────────────────────
async function connectTrainer() {
  try {
    showConnectionStatus(true);

    let device;
    let useServiceValidation = false;
    
    // 스마트 트레이너 검색: FTMS 또는 CPS 서비스 필터링
    // (구형 스마트 트레이너는 CPS만 제공하므로 둘 다 포함)
    try {
      // 1순위: fitness_machine 또는 cycling_power 서비스 필터링
      // FTMS 스마트 트레이너와 구형 CPS 스마트 트레이너 모두 검색
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [UUIDS.FTMS] }, // FTMS 스마트 트레이너
          { services: [UUIDS.CPS] }  // 구형 CPS 스마트 트레이너 (CycleOps 등)
        ],
        optionalServices: [UUIDS.FTMS, UUIDS.CPS, "device_information"]
      });
      console.log('✅ 스마트 트레이너 필터로 검색 성공 (FTMS 또는 CPS)');
    } catch (filterError) {
      // iOS/Bluefy에서 filters가 실패할 경우 acceptAllDevices로 재시도
      console.log("⚠️ Filters로 검색 실패, acceptAllDevices로 재시도 (서비스 검증 사용):", filterError);
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [UUIDS.FTMS, UUIDS.CPS, "device_information"],
      });
      useServiceValidation = true; // 서비스 검증 필요
    }

    const server = await device.gatt.connect();
    
    // 서비스 검증: FTMS 또는 CPS 확인
    let service;
    let isFTMS = false;
    let isValidDevice = false;
    
    // FTMS 서비스 확인 (최신 스마트 트레이너)
    try {
      service = await server.getPrimaryService(UUIDS.FTMS);
      isValidDevice = true;
      isFTMS = true;
      console.log('✅ FTMS 스마트 트레이너 확인됨');
    } catch (ftmsError) {
      // FTMS가 없으면 CPS 확인 (구형 스마트 트레이너)
      try {
        service = await server.getPrimaryService(UUIDS.CPS);
        isValidDevice = true;
        isFTMS = false;
        console.log('✅ CPS 스마트 트레이너 확인됨 (구형 모델)');
      } catch (cpsError) {
        // 둘 다 없으면 유효하지 않은 기기
        isValidDevice = false;
        console.warn('⚠️ FTMS와 CPS 서비스 모두 없음');
      }
    }
    
    if (!isValidDevice) {
      // 필수 서비스가 없으면 즉시 연결 해제
      await server.disconnect();
      throw new Error("선택하신 기기는 스마트 트레이너가 아닙니다. FTMS 또는 CPS 서비스를 제공하는 스마트 트레이너를 선택해주세요.");
    }

    // 특성(Characteristic) 연결
    let characteristic;
    if (isFTMS) {
      characteristic = await service.getCharacteristic("indoor_bike_data");
    } else {
      characteristic = await service.getCharacteristic("cycling_power_measurement");
    }

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged",
      isFTMS ? handleTrainerData : handlePowerMeterData
    );

    // [FTMS Control Point] ERG 모드 제어권 획득 시도
    let controlPointChar = null;
    if (isFTMS) {
      try {
        // 0x2AD9: Fitness Machine Control Point
        controlPointChar = await service.getCharacteristic(0x2AD9);
        console.log('✅ ERG 제어(Control Point) 활성화됨');
      } catch (e) {
        console.warn('⚠️ 이 트레이너는 ERG 제어를 지원하지 않습니다.');
      }
    }

    // 객체 저장
    window.connectedDevices.trainer = {
      name: device.name || "Smart Trainer",
      device,
      server,
      characteristic,
      controlPoint: controlPointChar, // ERG 제어용
      protocol: isFTMS ? 'FTMS' : 'CPS'
    };

    // 이벤트 핸들러 및 UI 업데이트 (기존 로직 유지)
    device.addEventListener("gattserverdisconnected", () => {
       /* 기존 해제 로직 그대로 */
       if (window.connectedDevices.trainer?.device === device) {
          if (typeof toggleErgMode === 'function') toggleErgMode(false);
          window.connectedDevices.trainer = null;
          if (typeof updateErgModeUI === 'function') updateErgModeUI(false);
       }
       updateDevicesList();
       if (window.updateDeviceButtonImages) setTimeout(window.updateDeviceButtonImages, 100);
    });

    updateDevicesList();
    if (window.updateDeviceButtonImages) setTimeout(window.updateDeviceButtonImages, 100);
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결됨`);

    // ERG UI 활성화
    if (typeof updateErgModeUI === 'function') updateErgModeUI(true);

  } catch (err) {
    showConnectionStatus(false);
    console.error("트레이너 연결 실패:", err);
    // iOS 디버깅을 위해 에러 객체 상세 정보 출력
    if (err) {
      console.error("에러 상세:", {
        name: err.name,
        message: err.message,
        code: err.code,
        toString: err.toString(),
        stack: err.stack
      });
    }
    
    // 에러 메시지 안전하게 처리 (iOS/Bluefy 대응 강화)
    let errorMessage = "알 수 없는 오류가 발생했습니다.";
    if (err) {
      // 1순위: err.name 기반 처리 (가장 신뢰성 높음)
      if (err.name === 'NotFoundError') {
        errorMessage = "스마트 트레이너를 찾을 수 없습니다. 기기가 켜져 있고 페어링 모드인지 확인해주세요.";
      } else if (err.name === 'SecurityError') {
        errorMessage = "블루투스 권한이 필요합니다. 브라우저 설정에서 블루투스 권한을 허용해주세요.";
      } else if (err.name === 'NetworkError') {
        errorMessage = "네트워크 오류가 발생했습니다. 블루투스 연결을 다시 시도해주세요.";
      } else if (err.name === 'InvalidStateError') {
        errorMessage = "블루투스가 활성화되지 않았습니다. 기기의 블루투스를 켜주세요.";
      } else if (err.name === 'NotSupportedError') {
        errorMessage = "이 브라우저는 Web Bluetooth를 지원하지 않습니다. Bluefy 앱을 사용해주세요.";
      } else if (err.name === 'AbortError') {
        errorMessage = "연결이 취소되었습니다.";
      } else if (err.message && err.message.trim() !== '') {
        // 2순위: err.message가 있고 비어있지 않으면 사용
        const msg = err.message.trim();
        // 숫자만 있는 경우 (예: "2") 특별 처리
        if (/^\d+$/.test(msg)) {
          errorMessage = "블루투스 연결에 실패했습니다. 기기와의 연결을 확인해주세요.";
        } else {
          errorMessage = msg;
        }
      } else if (typeof err === 'string') {
        // 3순위: 문자열인 경우
        const msg = err.trim();
        if (/^\d+$/.test(msg)) {
          errorMessage = "블루투스 연결에 실패했습니다. 기기와의 연결을 확인해주세요.";
        } else {
          errorMessage = msg;
        }
      } else if (err.code !== undefined) {
        // 4순위: err.code가 있는 경우 (iOS/Bluefy에서 발생 가능)
        const code = err.code;
        if (code === 2 || code === '2') {
          errorMessage = "블루투스 기기를 찾을 수 없습니다. 기기가 켜져 있고 페어링 모드인지 확인해주세요.";
        } else if (code === 18 || code === '18') {
          errorMessage = "블루투스 권한이 필요합니다.";
        } else {
          errorMessage = `블루투스 연결 오류 (코드: ${code}). 기기 연결을 확인해주세요.`;
        }
      } else if (err.toString && typeof err.toString === 'function') {
        // 5순위: toString() 결과 확인
        const strResult = err.toString();
        if (strResult !== '[object Object]' && strResult !== '[object Error]') {
          const msg = strResult.trim();
          if (/^\d+$/.test(msg)) {
            errorMessage = "블루투스 연결에 실패했습니다. 기기와의 연결을 확인해주세요.";
          } else {
            errorMessage = msg;
          }
        }
      }
    }
    
    showToast("❌ 연결 실패: " + errorMessage);
  }
}

// ──────────────────────────────────────────────────────────
// 2) Power Meter (CPS & CSC 통합 검색) - 정밀 검색 로직
// ──────────────────────────────────────────────────────────
async function connectPowerMeter() {
  try {
    showConnectionStatus(true);
    let device;
    let useServiceValidation = false;

    // 파워미터만 검색 (cycling_power 서비스만 필터링, 스마트로라 제외)
    try {
      // 1순위: cycling_power 서비스만 필터링 (파워미터만 검색)
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [UUIDS.CPS] } // 파워미터만 (스마트로라는 fitness_machine 우선)
        ],
        optionalServices: [UUIDS.CPS, "device_information"],
      });
      console.log('✅ 파워미터 필터로 검색 성공');
    } catch (filterError) {
      // iOS/Bluefy에서 filters가 실패할 경우 acceptAllDevices로 재시도
      console.log("⚠️ Filters로 검색 실패, acceptAllDevices로 재시도 (서비스 검증 사용):", filterError);
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [UUIDS.FTMS, UUIDS.CPS, "device_information"],
      });
      useServiceValidation = true; // 서비스 검증 필요
    }

    const server = await device.gatt.connect();
    
    // iOS/Bluefy에서 acceptAllDevices를 사용한 경우 서비스 검증
    let service;
    let characteristic;
    let isPowerMeter = false;
    
    if (useServiceValidation) {
      let hasFitnessMachine = false;
      let hasCyclingPower = false;
      
      // fitness_machine 서비스 확인 (스마트로라인지 체크)
      try {
        const ftmsService = await server.getPrimaryService(UUIDS.FTMS);
        hasFitnessMachine = !!ftmsService;
      } catch (err) {
        hasFitnessMachine = false;
      }
      
      // cycling_power 서비스 확인 (파워미터인지 체크)
      try {
        service = await server.getPrimaryService(UUIDS.CPS);
        hasCyclingPower = !!service;
      } catch (err) {
        hasCyclingPower = false;
      }
      
      // fitness_machine이 있으면 스마트로라 (파워미터가 아님)
      if (hasFitnessMachine && !hasCyclingPower) {
        await server.disconnect();
        throw new Error('선택한 기기는 스마트 트레이너입니다. 파워미터를 선택해주세요.');
      }
      
      // cycling_power가 없으면 파워미터가 아님
      if (!hasCyclingPower) {
        await server.disconnect();
        throw new Error('선택한 기기는 파워미터가 아닙니다. 파워미터를 선택해주세요.');
      }
      
      // cycling_power 서비스가 있으면 파워미터
      characteristic = await service.getCharacteristic("cycling_power_measurement");
      isPowerMeter = true;
      
      console.log('✅ 서비스 검증 완료: 파워미터 확인됨 (스마트로라 아님)');
    } else {
      // 필터로 검색한 경우 서비스 확인
      try {
        service = await server.getPrimaryService(UUIDS.CPS);
        characteristic = await service.getCharacteristic("cycling_power_measurement");
        isPowerMeter = true;
      } catch (e) {
        await server.disconnect();
        throw new Error("선택하신 기기는 파워미터가 아닙니다.");
      }
    }

    await characteristic.startNotifications();
    // 파워미터면 handlePowerMeterData, 케이던스 센서면 별도 처리(또는 trySubscribeCSC 로직 활용)
    characteristic.addEventListener("characteristicvaluechanged", (e) => {
        if (isPowerMeter) {
            handlePowerMeterData(e);
        } else {
            // CSC 센서 데이터 처리 (기존 trySubscribeCSC 내부 로직과 유사하게 처리)
            // 여기서는 단순화를 위해 handlePowerMeterData가 아닌 전용 파서 필요할 수 있음
            // 기존 코드의 trySubscribeCSC 로직을 활용하는 것이 좋음
            const dv = e.target.value;
            // ... CSC 파싱 로직 ...
        }
    });
    
    // 만약 파워미터로 연결했지만 CSC도 지원하면 구독 (케이던스 정확도 향상)
    if (isPowerMeter) {
        trySubscribeCSC(server);
    }

    window.connectedDevices.powerMeter = { 
        name: device.name || "Power Meter", 
        device, 
        server, 
        characteristic 
    };

    device.addEventListener("gattserverdisconnected", () => {
      /* 기존 해제 로직 */
      if (window.connectedDevices.powerMeter?.device === device) window.connectedDevices.powerMeter = null;
      updateDevicesList();
      if (window.updateDeviceButtonImages) setTimeout(window.updateDeviceButtonImages, 100);
    });

    updateDevicesList();
    if (window.updateDeviceButtonImages) setTimeout(window.updateDeviceButtonImages, 100);
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결됨`);

  } catch (err) {
    showConnectionStatus(false);
    console.error("파워미터 연결 실패:", err);
    
    // 에러 메시지 안전하게 처리
    let errorMessage = "알 수 없는 오류가 발생했습니다.";
    if (err) {
      if (err.message) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else if (err.name === 'NotFoundError') {
        errorMessage = "파워미터를 찾을 수 없습니다.";
      } else if (err.name === 'SecurityError') {
        errorMessage = "블루투스 권한이 필요합니다.";
      } else if (err.name === 'NetworkError') {
        errorMessage = "네트워크 오류가 발생했습니다.";
      } else if (err.toString && err.toString() !== '[object Object]') {
        errorMessage = err.toString();
      }
    }
    
    showToast("❌ 연결 실패: " + errorMessage);
  }
}

// ──────────────────────────────────────────────────────────
// 3) Heart Rate (HRS 전용) - 정밀 검색 로직
// ──────────────────────────────────────────────────────────
async function connectHeartRate() {
  try {
    showConnectionStatus(true);
    let device;

    // [최신 기술 5] 오직 심박 서비스(0x180D)만 필터링
    const options = {
      filters: [{ services: [UUIDS.HRS] }],
      optionalServices: [UUIDS.HRS, "device_information"]
    };

    try {
      device = await navigator.bluetooth.requestDevice(options);
    } catch (filterError) {
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [UUIDS.HRS, "device_information"],
      });
    }

    const server = await device.gatt.connect();

    // [최신 기술 6] 심박 서비스 검증 (Validation)
    let service;
    try {
        service = await server.getPrimaryService(UUIDS.HRS);
    } catch(e) {
        device.gatt.disconnect();
        throw new Error("선택하신 기기는 심박계가 아닙니다.");
    }

    const characteristic = await service.getCharacteristic("heart_rate_measurement");
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handleHeartRateData);

    window.connectedDevices.heartRate = { 
        name: device.name || "Heart Rate", 
        device, 
        server, 
        characteristic 
    };

    device.addEventListener("gattserverdisconnected", () => {
      /* 기존 해제 로직 */
      if (window.connectedDevices.heartRate?.device === device) window.connectedDevices.heartRate = null;
      updateDevicesList();
    });

    updateDevicesList();
    if (window.updateDeviceButtonImages) setTimeout(window.updateDeviceButtonImages, 100);
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결됨`);

  } catch (err) {
    showConnectionStatus(false);
    console.error("심박계 연결 실패:", err);
    // iOS 디버깅을 위해 에러 객체 상세 정보 출력
    if (err) {
      console.error("에러 상세:", {
        name: err.name,
        message: err.message,
        code: err.code,
        toString: err.toString(),
        stack: err.stack
      });
    }
    
    // 에러 메시지 안전하게 처리 (iOS/Bluefy 대응 강화)
    let errorMessage = "알 수 없는 오류가 발생했습니다.";
    if (err) {
      // 1순위: err.name 기반 처리 (가장 신뢰성 높음)
      if (err.name === 'NotFoundError') {
        errorMessage = "심박계를 찾을 수 없습니다. 기기가 켜져 있고 페어링 모드인지 확인해주세요.";
      } else if (err.name === 'SecurityError') {
        errorMessage = "블루투스 권한이 필요합니다. 브라우저 설정에서 블루투스 권한을 허용해주세요.";
      } else if (err.name === 'NetworkError') {
        errorMessage = "네트워크 오류가 발생했습니다. 블루투스 연결을 다시 시도해주세요.";
      } else if (err.name === 'InvalidStateError') {
        errorMessage = "블루투스가 활성화되지 않았습니다. 기기의 블루투스를 켜주세요.";
      } else if (err.name === 'NotSupportedError') {
        errorMessage = "이 브라우저는 Web Bluetooth를 지원하지 않습니다. Bluefy 앱을 사용해주세요.";
      } else if (err.name === 'AbortError') {
        errorMessage = "연결이 취소되었습니다.";
      } else if (err.message && err.message.trim() !== '') {
        // 2순위: err.message가 있고 비어있지 않으면 사용
        const msg = err.message.trim();
        // 숫자만 있는 경우 (예: "2") 특별 처리
        if (/^\d+$/.test(msg)) {
          errorMessage = "블루투스 연결에 실패했습니다. 기기와의 연결을 확인해주세요.";
        } else {
          errorMessage = msg;
        }
      } else if (typeof err === 'string') {
        // 3순위: 문자열인 경우
        const msg = err.trim();
        if (/^\d+$/.test(msg)) {
          errorMessage = "블루투스 연결에 실패했습니다. 기기와의 연결을 확인해주세요.";
        } else {
          errorMessage = msg;
        }
      } else if (err.code !== undefined) {
        // 4순위: err.code가 있는 경우 (iOS/Bluefy에서 발생 가능)
        const code = err.code;
        if (code === 2 || code === '2') {
          errorMessage = "블루투스 기기를 찾을 수 없습니다. 기기가 켜져 있고 페어링 모드인지 확인해주세요.";
        } else if (code === 18 || code === '18') {
          errorMessage = "블루투스 권한이 필요합니다.";
        } else {
          errorMessage = `블루투스 연결 오류 (코드: ${code}). 기기 연결을 확인해주세요.`;
        }
      } else if (err.toString && typeof err.toString === 'function') {
        // 5순위: toString() 결과 확인
        const strResult = err.toString();
        if (strResult !== '[object Object]' && strResult !== '[object Error]') {
          const msg = strResult.trim();
          if (/^\d+$/.test(msg)) {
            errorMessage = "블루투스 연결에 실패했습니다. 기기와의 연결을 확인해주세요.";
          } else {
            errorMessage = msg;
          }
        }
      }
    }
    
    showToast("❌ 연결 실패: " + errorMessage);
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
