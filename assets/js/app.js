/* ==========================================================
   app-integrated.js (v2.0 통합 개선 버전)
   - 전역 변수 초기화 통일
   - 블루투스 연결 기능 개선
   - 함수 중복 제거
   - 오류 처리 강화
========================================================== */

// ========== 전역 변수 안전 초기화 (파일 최상단) ==========
(function initializeGlobals() {
  // liveData 객체 안전 초기화
  if (!window.liveData) {
    window.liveData = {
      power: 0,
      cadence: 0,
      heartRate: 0,
      targetPower: 0
    };
  }

  // currentUser 안전 초기화
  if (!window.currentUser) {
    window.currentUser = null;
  }

  // currentWorkout 안전 초기화
  if (!window.currentWorkout) {
    window.currentWorkout = null;
  }

  // trainingState 안전 초기화
  if (!window.trainingState) {
    window.trainingState = {
      timerId: null,
      paused: false,
      elapsedSec: 0,
      segIndex: 0,
      segElapsedSec: 0,
      segEnds: [],
      totalSec: 0
    };
  }

  // connectedDevices 안전 초기화
  if (!window.connectedDevices) {
    window.connectedDevices = {
      trainer: null,
      powerMeter: null,
      heartRate: null
    };
  }

  console.log('Global variables initialized safely');
})();

// ========== 블루투스 관련 상수 및 설정 ==========
const BLUETOOTH_CONFIG = {
  // Cycling Power Service (CPS) UUIDs
  CYCLING_POWER_SERVICE: 0x1818,
  CYCLING_POWER_MEASUREMENT: 0x2A63,
  
  // Fitness Machine Service (FTMS) UUIDs
  FITNESS_MACHINE_SERVICE: "fitness_machine",
  INDOOR_BIKE_DATA: "indoor_bike_data",
  
  // Heart Rate Service (HRS) UUIDs
  HEART_RATE_SERVICE: "heart_rate",
  HEART_RATE_MEASUREMENT: "heart_rate_measurement",
  
  // CSC Service UUIDs
  CSC_SERVICE: 0x1816,
  CSC_MEASUREMENT: 0x2A5B,
  
  // CPS Flags
  CPS_FLAG: {
    PEDAL_POWER_BALANCE_PRESENT: 0x0001,
    ACC_TORQUE_PRESENT: 0x0004,
    WHEEL_REV_DATA_PRESENT: 0x0010,
    CRANK_REV_DATA_PRESENT: 0x0020
  }
};

// ========== 블루투스 상태 관리 ==========
let bluetoothState = {
  isSupported: false,
  isInitialized: false,
  powerMeterState: { 
    lastCrankRevs: null, 
    lastCrankEventTime: null 
  }
};

// ========== 유틸리티 함수들 ==========
function safeGetElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    console.warn(`Element with id '${id}' not found`);
  }
  return element;
}

function safeSetText(id, text) {
  const element = safeGetElement(id);
  if (element) {
    element.textContent = text;
  }
}

// ========== UI 핼퍼 함수들 (중복 제거) ==========
if (!window.showScreen) {
  window.showScreen = function(id) {
    try {
      console.log(`Switching to screen: ${id}`);
      
      // 모든 화면 숨기기
      document.querySelectorAll(".screen").forEach(screen => {
        screen.classList.remove("active");
      });
      
      // 짧은 지연 후 대상 화면만 표시
      setTimeout(() => {
        const targetScreen = document.getElementById(id);
        if (targetScreen) {
          targetScreen.classList.add("active");
          
          // 스크롤을 최상단으로 이동
          window.scrollTo(0, 0);
          if (targetScreen.scrollTop !== undefined) {
            targetScreen.scrollTop = 0;
          }
          
          console.log(`Successfully switched to: ${id}`);
        } else {
          console.error(`Screen element '${id}' not found`);
        }
      }, 50);
      
    } catch (error) {
      console.error('Error in showScreen:', error);
    }
  };
}

if (!window.showConnectionStatus) {
  window.showConnectionStatus = function(show) {
    const el = safeGetElement("connectionStatus");
    if (el) {
      el.classList.toggle("hidden", !show);
    }
  };
}

if (!window.showToast) {
  window.showToast = function(msg) {
    const t = safeGetElement("toast");
    if (!t) {
      alert(msg);
      return;
    }
    t.classList.remove("hidden");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.classList.add("hidden"), 300);
    }, 2400);
  };
}

// ========== 블루투스 지원 여부 체크 ==========
function checkBluetoothSupport() {
  if (!navigator.bluetooth) {
    console.error('Web Bluetooth API not supported');
    bluetoothState.isSupported = false;
    showToast('이 브라우저는 블루투스를 지원하지 않습니다');
    return false;
  }
  
  bluetoothState.isSupported = true;
  bluetoothState.isInitialized = true;
  console.log('Bluetooth support confirmed');
  return true;
}

// ========== 기기 목록 업데이트 ==========
window.updateDevicesList = function() {
  const deviceList = safeGetElement("connectedDevicesList");
  const summary = safeGetElement("connectedDevicesSummary");
  
  if (!deviceList || !summary) {
    console.warn('Device list elements not found');
    return;
  }

  let html = "";
  let count = 0;
  const devices = window.connectedDevices;

  if (devices.trainer) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon">🚴‍♂️</div>
          <div class="device-details">
            <h3>${devices.trainer.name || "Smart Trainer"}</h3>
            <p>Smart Trainer (FTMS)</p>
          </div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }

  if (devices.powerMeter) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon">⚡</div>
          <div class="device-details">
            <h3>${devices.powerMeter.name || "Power Meter"}</h3>
            <p>Crank Power (CPS)</p>
          </div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }

  if (devices.heartRate) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon" style="background:#DC3545;">❤️</div>
          <div class="device-details">
            <h3>${devices.heartRate.name || "Heart Rate"}</h3>
            <p>Heart Rate (HRS)</p>
          </div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }

  deviceList.innerHTML = html;
  
  if (count > 0) {
    summary.classList.remove("hidden");
    // 연결된 기기가 있으면 프로필 화면으로 이동 버튼 활성화
    const continueBtn = safeGetElement("btnContinueToProfile");
    if (continueBtn) {
      continueBtn.disabled = false;
      continueBtn.style.opacity = "1";
    }
  } else {
    summary.classList.add("hidden");
  }
  
  console.log(`Updated device list: ${count} devices connected`);
};

// ========== 스마트 트레이너 연결 ==========
async function connectTrainer() {
  console.log('🚴‍♂️ Starting trainer connection...');
  
  if (!checkBluetoothSupport()) {
    return;
  }

  try {
    showConnectionStatus(true);
    showToast('트레이너를 검색 중...');

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [BLUETOOTH_CONFIG.FITNESS_MACHINE_SERVICE] },
        { services: ["cycling_power"] },
        { namePrefix: "KICKR" },
        { namePrefix: "Wahoo" },
        { namePrefix: "Tacx" },
        { namePrefix: "Elite" }
      ],
      optionalServices: [
        BLUETOOTH_CONFIG.FITNESS_MACHINE_SERVICE, 
        "cycling_power", 
        "device_information"
      ],
    });

    console.log('Trainer device selected:', device.name);
    const server = await device.gatt.connect();
    console.log('Connected to GATT server');

    let service, characteristic, isFTMS = false;
    
    // FTMS 서비스 먼저 시도
    try {
      service = await server.getPrimaryService(BLUETOOTH_CONFIG.FITNESS_MACHINE_SERVICE);
      characteristic = await service.getCharacteristic(BLUETOOTH_CONFIG.INDOOR_BIKE_DATA);
      isFTMS = true;
      console.log('Using FTMS service');
    } catch (ftmsError) {
      console.log('FTMS not available, trying CPS:', ftmsError.message);
      // CPS 서비스로 폴백
      service = await server.getPrimaryService("cycling_power");
      characteristic = await service.getCharacteristic("cycling_power_measurement");
      console.log('Using CPS service as fallback');
    }

    await characteristic.startNotifications();
    console.log('Notifications started');
    
    characteristic.addEventListener("characteristicvaluechanged",
      isFTMS ? handleTrainerData : handlePowerMeterData
    );

    if (isFTMS) {
      window.connectedDevices.trainer = { 
        name: device.name || "Smart Trainer", 
        device, 
        server, 
        characteristic 
      };
    } else {
      window.connectedDevices.powerMeter = { 
        name: device.name || "Power Meter", 
        device, 
        server, 
        characteristic 
      };
    }

    // 연결 해제 이벤트 리스너
    device.addEventListener("gattserverdisconnected", () => {
      console.log('Trainer disconnected');
      try {
        if (window.connectedDevices.trainer?.device === device) {
          window.connectedDevices.trainer = null;
        }
        if (window.connectedDevices.powerMeter?.device === device) {
          window.connectedDevices.powerMeter = null;
        }
        updateDevicesList();
        showToast('트레이너 연결이 해제되었습니다');
      } catch (e) { 
        console.warn('Error handling disconnect:', e); 
      }
    });

    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "트레이너"} 연결 성공`);
    
  } catch (err) {
    showConnectionStatus(false);
    console.error("트레이너 연결 오류:", err);
    
    let errorMessage = "트레이너 연결 실패";
    if (err.name === 'NotFoundError') {
      errorMessage = "트레이너를 찾을 수 없습니다";
    } else if (err.name === 'SecurityError') {
      errorMessage = "보안 오류: HTTPS 환경에서 실행해주세요";
    } else if (err.name === 'NotSupportedError') {
      errorMessage = "지원되지 않는 기기입니다";
    }
    
    showToast(`❌ ${errorMessage}`);
  }
}

// ========== 파워미터 연결 ==========
async function connectPowerMeter() {
  console.log('⚡ Starting power meter connection...');
  
  if (!checkBluetoothSupport()) {
    return;
  }

  try {
    showConnectionStatus(true);
    showToast('파워미터를 검색 중...');

    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["cycling_power"] }],
        optionalServices: ["cycling_power", "device_information", BLUETOOTH_CONFIG.CSC_SERVICE],
      });
    } catch (filterError) {
      console.log('Filtered search failed, trying acceptAllDevices:', filterError.message);
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["cycling_power", "device_information", BLUETOOTH_CONFIG.CSC_SERVICE],
      });
    }

    console.log('Power meter device selected:', device.name);
    const server = await device.gatt.connect();
    console.log('Connected to GATT server');

    const service = await (async () => {
      try { 
        return await server.getPrimaryService("cycling_power"); 
      } catch { 
        return await server.getPrimaryService(BLUETOOTH_CONFIG.CYCLING_POWER_SERVICE); 
      }
    })();

    const characteristic = await (async () => {
      try { 
        return await service.getCharacteristic("cycling_power_measurement"); 
      } catch { 
        return await service.getCharacteristic(BLUETOOTH_CONFIG.CYCLING_POWER_MEASUREMENT); 
      }
    })();

    await characteristic.startNotifications();
    console.log('Power meter notifications started');
    
    characteristic.addEventListener("characteristicvaluechanged", handlePowerMeterData);
     
    // CSC 서비스도 시도 (케이던스 보완용)
    trySubscribeCSC(server);
    
    window.connectedDevices.powerMeter = { 
      name: device.name || "Power Meter", 
      device, 
      server, 
      characteristic 
    };

    device.addEventListener("gattserverdisconnected", () => {
      console.log('Power meter disconnected');
      if (window.connectedDevices.powerMeter?.device === device) {
        window.connectedDevices.powerMeter = null;
        updateDevicesList();
        showToast('파워미터 연결이 해제되었습니다');
      }
    });

    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "파워미터"} 연결 성공`);
    
  } catch (err) {
    showConnectionStatus(false);
    console.error("파워미터 연결 오류:", err);
    
    let errorMessage = "파워미터 연결 실패";
    if (err.name === 'NotFoundError') {
      errorMessage = "파워미터를 찾을 수 없습니다";
    } else if (err.name === 'SecurityError') {
      errorMessage = "보안 오류: HTTPS 환경에서 실행해주세요";
    } else if (err.name === 'NotSupportedError') {
      errorMessage = "지원되지 않는 기기입니다";
    }
    
    showToast(`❌ ${errorMessage}`);
  }
}

// ========== 심박계 연결 ==========
async function connectHeartRate() {
  console.log('❤️ Starting heart rate monitor connection...');
  
  if (!checkBluetoothSupport()) {
    return;
  }

  try {
    showConnectionStatus(true);
    showToast('심박계를 검색 중...');

    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLUETOOTH_CONFIG.HEART_RATE_SERVICE] }],
        optionalServices: [BLUETOOTH_CONFIG.HEART_RATE_SERVICE, "device_information"],
      });
    } catch (filterError) {
      console.log('Filtered search failed, trying acceptAllDevices:', filterError.message);
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BLUETOOTH_CONFIG.HEART_RATE_SERVICE, "device_information"],
      });
    }

    console.log('Heart rate device selected:', device.name);
    const server = await device.gatt.connect();
    console.log('Connected to GATT server');
    
    const service = await server.getPrimaryService(BLUETOOTH_CONFIG.HEART_RATE_SERVICE);
    const characteristic = await service.getCharacteristic(BLUETOOTH_CONFIG.HEART_RATE_MEASUREMENT);

    await characteristic.startNotifications();
    console.log('Heart rate notifications started');
    
    characteristic.addEventListener("characteristicvaluechanged", handleHeartRateData);

    window.connectedDevices.heartRate = { 
      name: device.name || "Heart Rate Monitor", 
      device, 
      server, 
      characteristic 
    };

    device.addEventListener("gattserverdisconnected", () => {
      console.log('Heart rate monitor disconnected');
      if (window.connectedDevices.heartRate?.device === device) {
        window.connectedDevices.heartRate = null;
        updateDevicesList();
        showToast('심박계 연결이 해제되었습니다');
      }
    });

    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "심박계"} 연결 성공`);
    
  } catch (err) {
    showConnectionStatus(false);
    console.error("심박계 연결 오류:", err);
    
    let errorMessage = "심박계 연결 실패";
    if (err.name === 'NotFoundError') {
      errorMessage = "심박계를 찾을 수 없습니다";
    } else if (err.name === 'SecurityError') {
      errorMessage = "보안 오류: HTTPS 환경에서 실행해주세요";
    } else if (err.name === 'NotSupportedError') {
      errorMessage = "지원되지 않는 기기입니다";
    }
    
    showToast(`❌ ${errorMessage}`);
  }
}

// ========== 데이터 핸들러 함수들 ==========

// 스마트 트레이너 데이터 처리 (FTMS)
function handleTrainerData(event) {
  try {
    const dv = event.target.value instanceof DataView 
      ? event.target.value 
      : new DataView(event.target.value.buffer || event.target.value);
    
    let offset = 0;
    const flags = dv.getUint16(offset, true); 
    offset += 2;

    // Instantaneous Speed 건너뛰기
    if (flags & 0x0001) { offset += 2; }
    
    // Average Speed 건너뛰기
    if (flags & 0x0002) { offset += 2; }

    // Instantaneous Cadence (0.5 rpm 단위)
    if (flags & 0x0004) {
      const cadHalf = dv.getUint16(offset, true); 
      offset += 2;
      const rpm = cadHalf / 2;
      if (rpm > 0 && rpm < 220) {
        window.liveData.cadence = Math.round(rpm);
      }
    }

    // Average Cadence 건너뛰기
    if (flags & 0x0008) { offset += 2; }

    // Total Distance 건너뛰기
    if (flags & 0x0010) { offset += 3; }

    // Resistance Level 건너뛰기
    if (flags & 0x0020) { offset += 2; }

    // Instantaneous Power
    if (flags & 0x0040) {
      const power = dv.getInt16(offset, true); 
      offset += 2;
      if (power >= 0) {
        window.liveData.power = power;
      }
    }

    // UI 업데이트
    if (typeof window.updateTrainingDisplay === "function") {
      window.updateTrainingDisplay();
    }
    
  } catch (error) {
    console.error('Error handling trainer data:', error);
  }
}

// 파워미터 데이터 처리 (CPS)
function handlePowerMeterData(event) {
  try {
    const dv = event.target.value;
    let offset = 0;

    // Flags와 Instantaneous Power
    const flags = dv.getUint16(offset, true); 
    offset += 2;
    const instPower = dv.getInt16(offset, true); 
    offset += 2;
    
    if (!Number.isNaN(instPower) && instPower >= 0) {
      window.liveData.power = instPower;
    }

    // 옵션 필드들 건너뛰기
    if (flags & BLUETOOTH_CONFIG.CPS_FLAG.PEDAL_POWER_BALANCE_PRESENT) offset += 1;
    if (flags & BLUETOOTH_CONFIG.CPS_FLAG.ACC_TORQUE_PRESENT) offset += 2;
    if (flags & BLUETOOTH_CONFIG.CPS_FLAG.WHEEL_REV_DATA_PRESENT) offset += 6;

    // Crank Revolution Data로 케이던스 계산
    if (flags & BLUETOOTH_CONFIG.CPS_FLAG.CRANK_REV_DATA_PRESENT) {
      const crankRevs = dv.getUint16(offset, true); 
      offset += 2;
      const lastCrankTime = dv.getUint16(offset, true); 
      offset += 2;

      const state = bluetoothState.powerMeterState;
      if (state.lastCrankRevs !== null && state.lastCrankEventTime !== null) {
        let deltaRevs = crankRevs - state.lastCrankRevs;
        if (deltaRevs < 0) deltaRevs += 0x10000; // uint16 롤오버 처리

        let deltaTicks = lastCrankTime - state.lastCrankEventTime;
        if (deltaTicks < 0) deltaTicks += 0x10000;

        if (deltaRevs > 0 && deltaTicks > 0) {
          const deltaSec = deltaTicks / 1024;
          const rpm = (deltaRevs / deltaSec) * 60;
          if (rpm > 0 && rpm < 220) {
            window.liveData.cadence = Math.round(rpm);
          }
        }
      }
      
      state.lastCrankRevs = crankRevs;
      state.lastCrankEventTime = lastCrankTime;
    }

    // UI 업데이트
    if (typeof window.updateTrainingDisplay === "function") {
      window.updateTrainingDisplay();
    }
    
  } catch (error) {
    console.error('Error handling power meter data:', error);
  }
}

// 심박계 데이터 처리 (HRS)
function handleHeartRateData(event) {
  try {
    const dv = event.target.value;
    const flags = dv.getUint8(0);
    const heartRate = (flags & 0x1) ? dv.getUint16(1, true) : dv.getUint8(1);
    
    if (heartRate > 0 && heartRate < 250) {
      window.liveData.heartRate = Math.round(heartRate);
    }

    // UI 업데이트
    if (typeof window.updateTrainingDisplay === "function") {
      window.updateTrainingDisplay();
    }
    
  } catch (error) {
    console.error('Error handling heart rate data:', error);
  }
}

// CSC 서비스 구독 시도 (케이던스 보완용)
async function trySubscribeCSC(server) {
  try {
    const cscService = await server.getPrimaryService(BLUETOOTH_CONFIG.CSC_SERVICE);
    const cscMeasurement = await cscService.getCharacteristic(BLUETOOTH_CONFIG.CSC_MEASUREMENT);
    await cscMeasurement.startNotifications();
    
    cscMeasurement.addEventListener("characteristicvaluechanged", (event) => {
      try {
        const dv = event.target.value;
        let offset = 0;
        const flags = dv.getUint8(offset); 
        offset += 1;
        
        // Crank Revolution Data Present
        if (flags & 0x02) {
          const cumRevs = dv.getUint16(offset, true); 
          offset += 2;
          const eventTime = dv.getUint16(offset, true); 
          offset += 2;

          const state = bluetoothState.powerMeterState;
          if (state.lastCrankRevs !== null && state.lastCrankEventTime !== null) {
            let deltaRevs = cumRevs - state.lastCrankRevs;
            if (deltaRevs < 0) deltaRevs += 0x10000;
            
            let deltaTicks = eventTime - state.lastCrankEventTime;
            if (deltaTicks < 0) deltaTicks += 0x10000;
            
            const deltaSec = deltaTicks / 1024;
            if (deltaSec > 0 && deltaSec < 5) {
              const rpm = (deltaRevs / deltaSec) * 60;
              if (rpm > 0 && rpm < 220) {
                window.liveData.cadence = Math.round(rpm);
              }
            }
          }
          
          state.lastCrankRevs = cumRevs;
          state.lastCrankEventTime = eventTime;

          if (typeof window.updateTrainingDisplay === "function") {
            window.updateTrainingDisplay();
          }
        }
      } catch (error) {
        console.error('Error handling CSC data:', error);
      }
    });
    
    console.log('CSC service subscribed successfully');
  } catch (error) {
    // CSC가 없으면 조용히 패스
    console.log('CSC service not available:', error.message);
  }
}

// ========== 사용자 검색 함수 ==========
function searchUsersByPhoneLastFour(searchDigits) {
    console.log('=== 사용자 검색 함수 실행 ===');
    console.log('검색할 뒷자리:', searchDigits);
    
    if (!window.users || window.users.length === 0) {
        console.log('⚠ 사용자 데이터가 없습니다');
        return [];
    }
    
    console.log('전체 사용자 수:', window.users.length);
    
    const results = window.users.filter(user => {
        if (!user.contact) {
            console.log(`⚠️ ${user.name}: 전화번호 없음`);
            return false;
        }
        
        const contactStr = String(user.contact);
        const cleanContact = contactStr.replace(/[-\s]/g, '');
        const userLastFour = cleanContact.slice(-4);
        
        console.log(`검사: ${user.name} - "${user.contact}" → "${cleanContact}" → "${userLastFour}"`);
        
        const isMatch = userLastFour === String(searchDigits);
        if (isMatch) {
            console.log(`✅ 매칭됨: ${user.name}`);
        }
        
        return isMatch;
    });
    
    console.log('검색 결과:', results.length, '명');
    return results;
}

// ========== 로그인 화면 초기화 ==========
function initializeLoginScreen() {
  const phoneInput = safeGetElement("phoneAuth");
  const authButton = safeGetElement("btnAuthenticate");
  const registerButton = safeGetElement("btnGoRegister");
  const authError = safeGetElement("authError");
  const authStatus = safeGetElement("authStatus");

  // 초기 버튼 상태 설정
  if (authButton) {
    authButton.disabled = true;
    authButton.style.opacity = "0.6";
  }

  // 전화번호 입력 유효성 검사
  if (phoneInput) {
    phoneInput.addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
      
      if (e.target.value.length > 4) {
        e.target.value = e.target.value.slice(0, 4);
      }
      
      if (authError) {
        authError.classList.add("hidden");
      }
      
      if (authStatus) {
        authStatus.classList.add("hidden");
      }
      
      if (authButton) {
        const isValid = e.target.value.length === 4;
        authButton.disabled = !isValid;
        authButton.style.opacity = isValid ? "1" : "0.6";
      }
    });

    phoneInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && phoneInput.value.length === 4) {
        handleAuthentication();
      }
    });

    phoneInput.addEventListener("focus", () => {
      if (authError) {
        authError.classList.add("hidden");
      }
      if (authStatus) {
        authStatus.classList.add("hidden");
      }
    });
  }

  if (authButton) {
    authButton.addEventListener("click", (e) => {
      e.preventDefault();
      if (!authButton.disabled) {
        handleAuthentication();
      }
    });
  }

  if (registerButton) {
    registerButton.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof showScreen === "function") {
        showScreen("profileScreen");
      }
    });
  }

  console.log("로그인 화면 초기화 완료");
}

// ========== 사용자 인증 처리 ==========
async function handleAuthentication() {
  const phoneInput = safeGetElement("phoneAuth");
  const authButton = safeGetElement("btnAuthenticate");
  const authError = safeGetElement("authError");
  
  if (!phoneInput || phoneInput.value.length !== 4) {
    return;
  }

  const phoneLastFour = phoneInput.value;
  console.log(`인증 시도: 전화번호 뒷자리 ${phoneLastFour}`);
  
  try {
    if (authButton) {
      authButton.classList.add("loading");
      authButton.disabled = true;
    }

    if (authError) {
      authError.classList.add("hidden");
    }

    showAuthStatus("loading", "사용자 정보를 확인하는 중...", "⏳");

    console.log('사용자 데이터 로딩 시작...');
    await loadUsersForAuth(true);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const users = window.users || window.userProfiles || [];
    console.log(`로딩된 사용자 수: ${users.length}`);
    
    const matchingUsers = searchUsersByPhoneLastFour(phoneLastFour);

    if (matchingUsers.length >= 1) {
      window.currentUser = matchingUsers[0];
      console.log('선택된 사용자:', window.currentUser);
      
      if (matchingUsers.length > 1) {
        console.log("여러 사용자가 매칭됨:", matchingUsers.map(u => u.name));
        console.log("첫 번째 사용자를 선택:", matchingUsers[0].name);
      }
      
      showAuthStatus("success", `${matchingUsers[0].name}님 인증 완료`, "✅");
      
      if (typeof showToast === "function") {
        showToast(`${matchingUsers[0].name}님 환영합니다!`);
      }
      
      setTimeout(() => {
        hideAuthStatus();
        showScreen("connectionScreen");
      }, 1500);
      
    } else {
      console.log("매칭되는 사용자가 없음 - 사용자 등록 화면으로 이동");
      
      showAuthStatus("redirect", "미등록 번호입니다. 회원가입으로 이동합니다...", "📋");
      
      if (typeof showToast === "function") {
        showToast("등록되지 않은 번호입니다. 사용자 등록을 진행합니다.");
      }
      
      setTimeout(() => {
        hideAuthStatus();
        showScreen("profileScreen");
      }, 2000);
    }
    
  } catch (error) {
    console.error("Authentication error:", error);
    
    hideAuthStatus();
    
    if (authError) {
      authError.classList.remove("hidden");
      authError.textContent = "인증 중 오류가 발생했습니다. 다시 시도해주세요.";
    }
    
    const inputWrapper = phoneInput.closest('.input-wrapper');
    if (inputWrapper) {
      inputWrapper.classList.add('error');
      setTimeout(() => {
        inputWrapper.classList.remove('error');
      }, 2000);
    }
    
    phoneInput.select();
    
  } finally {
    if (authButton) {
      authButton.classList.remove("loading");
      authButton.disabled = false;
    }
  }
}

// ========== 상태 메시지 처리 ==========
function showAuthStatus(type, message, icon = '⏳') {
  const statusEl = safeGetElement("authStatus");
  const statusIcon = statusEl?.querySelector(".status-icon");
  const statusText = statusEl?.querySelector(".status-text");
  
  if (!statusEl || !statusIcon || !statusText) return;
  
  statusEl.classList.remove("hidden", "success", "redirect", "loading");
  
  if (type && type.trim()) {
    statusEl.classList.add(type);
  } else {
    statusEl.classList.add("loading");
  }
  
  statusIcon.textContent = icon;
  statusText.textContent = message;
}

function hideAuthStatus() {
  const statusEl = safeGetElement("authStatus");
  if (statusEl) {
    statusEl.classList.add("hidden");
  }
}

// ========== 사용자 데이터 로딩 ==========
async function loadUsersForAuth(forceReload = false) {
  try {
    console.log('loadUsersForAuth 시작', 'forceReload:', forceReload);
    
    if (!forceReload && ((window.users && window.users.length > 0) || 
        (window.userProfiles && window.userProfiles.length > 0))) {
      console.log('기존 사용자 데이터 사용');
      return;
    }

    if (typeof window.loadUsers === "function") {
      console.log('userManager.loadUsers 함수 호출');
      await window.loadUsers();
      console.log('userManager.loadUsers 완료, 사용자 수:', (window.users || []).length);
      return;
    }

    if (window.CONFIG && window.CONFIG.GAS_WEB_APP_URL) {
      console.log('Google Apps Script에서 사용자 데이터 가져오기');
      const url = window.CONFIG.GAS_WEB_APP_URL + "?action=getUsers&t=" + Date.now();
      console.log('요청 URL:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      console.log('응답 상태:', response.status, response.statusText);
      
      if (response.ok) {
        const data = await response.json();
        console.log('받은 데이터:', data);
        
        if (data && data.users && Array.isArray(data.users)) {
          window.users = data.users;
          console.log(`성공적으로 ${data.users.length}명의 사용자 데이터를 로딩했습니다.`);
          console.log('첫 번째 사용자 예시:', data.users[0]);
        } else {
          console.warn('올바르지 않은 데이터 형식:', data);
          window.users = [];
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } else {
      console.warn('Google Apps Script URL이 설정되지 않았습니다.');
      window.users = [];
    }
    
  } catch (error) {
    console.error("사용자 데이터 로딩 실패:", error);
    window.users = window.users || [];
  }
}

// ========== 연결 해제 함수 ==========
function disconnectAllDevices() {
  const devices = window.connectedDevices;
  
  try {
    if (devices.trainer?.server?.connected) {
      devices.trainer.device.gatt.disconnect();
      devices.trainer = null;
    }
    if (devices.powerMeter?.server?.connected) {
      devices.powerMeter.device.gatt.disconnect();
      devices.powerMeter = null;
    }
    if (devices.heartRate?.server?.connected) {
      devices.heartRate.device.gatt.disconnect();
      devices.heartRate = null;
    }
    
    updateDevicesList();
    showToast('모든 기기가 연결 해제되었습니다');
    
  } catch (error) {
    console.error('Error disconnecting devices:', error);
  }
}

// ========== 전역 함수 export ==========
window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
window.disconnectAllDevices = disconnectAllDevices;
window.searchUsersByPhoneLastFour = searchUsersByPhoneLastFour;
window.handleAuthentication = handleAuthentication;

// ========== 언로드 시 안전 disconnect ==========
window.addEventListener("beforeunload", () => {
  disconnectAllDevices();
});

// ========== DOM 로딩 완료 후 초기화 ==========
document.addEventListener('DOMContentLoaded', function() {
  console.log('앱 초기화 시작');
  
  // 블루투스 지원 체크
  checkBluetoothSupport();
  
  // 로그인 화면 초기화
  if (typeof initializeLoginScreen === "function") {
    initializeLoginScreen();
  }
  
  // 초기 화면을 로그인으로 설정
  if (typeof showScreen === "function") {
    showScreen("loginScreen");
  }
  
  console.log('앱 초기화 완료');
});

// ========== 훈련 화면용 함수들 (기존 코드 유지) ==========

// 시간 포맷팅
function formatMMSS(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

// 세그먼트 타입 정규화
function normalizeType(seg){
  const t = (seg.segment_type || seg.label || "").toString().toLowerCase();
  if (t.includes("warm")) return "warmup";
  if (t.includes("cool")) return "cooldown";
  if (t.includes("rest") || t.includes("recover")) return "rest";
  if (t.includes("sweet")) return "sweetspot";
  if (t.includes("tempo")) return "tempo";
  return "interval";
}

// FTP 백분율 추출
function getSegmentFtpPercent(seg) {
  if (!seg) return 0;
  
  if (typeof seg.target_value === "number") {
    return Math.round(seg.target_value);
  }
  
  if (typeof seg.ftp_percent === "number") {
    return Math.round(seg.ftp_percent);
  }
  
  if (typeof seg.target === "number") {
    return Math.round(seg.target * 100);
  }
  
  console.warn('FTP 백분율을 찾을 수 없습니다:', seg);
  return 100;
}

// 훈련 디스플레이 업데이트
window.updateTrainingDisplay = function () {
  const currentPower = window.liveData?.power || 0;
  const target = window.liveData?.targetPower || 200;
  const hr = window.liveData?.heartRate || 0;
  const cadence = window.liveData?.cadence || 0;

  const p = safeGetElement("currentPowerValue");
  const h = safeGetElement("heartRateValue");
  const c = safeGetElement("cadenceValue");
  const bar = safeGetElement("powerProgressBar");
  const t = safeGetElement("targetPowerValue");

  if (p) {
    p.textContent = Math.round(currentPower);
    p.classList.remove("power-low","power-mid","power-high","power-max");
    const ratio = currentPower / target;
    if (ratio < 0.8) p.classList.add("power-low");
    else if (ratio < 1.0) p.classList.add("power-mid");
    else if (ratio < 1.2) p.classList.add("power-high");
    else p.classList.add("power-max");
  }

  if (bar) {
    const pct = target > 0 ? Math.min(100, (currentPower / target) * 100) : 0;
    bar.style.width = pct + "%";
    if (pct < 80) bar.style.background = "linear-gradient(90deg,#00b7ff,#0072ff)";
    else if (pct < 100) bar.style.background = "linear-gradient(90deg,#3cff4e,#00ff88)";
    else if (pct < 120) bar.style.background = "linear-gradient(90deg,#ffb400,#ff9000)";
    else bar.style.background = "linear-gradient(90deg,#ff4c4c,#ff1a1a)";
  }

  if (t) t.textContent = String(Math.round(target));

  if (h) {
    h.textContent = Math.round(hr);
    h.classList.remove("hr-zone1","hr-zone2","hr-zone3","hr-zone4","hr-zone5");
    if (hr < 100) h.classList.add("hr-zone1");
    else if (hr < 120) h.classList.add("hr-zone2");
    else if (hr < 140) h.classList.add("hr-zone3");
    else if (hr < 160) h.classList.add("hr-zone4");
    else h.classList.add("hr-zone5");
  }

  if (c) {
    if (typeof cadence === "number" && cadence > 0) {
      c.textContent = Math.round(cadence);
    } else {
      c.textContent = "--";
    }
  }

  // 중앙 디스플레이에 펄스 애니메이션 추가
  const powerDisplay = document.querySelector("#trainingScreen .power-display");
  if (powerDisplay) {
    if (currentPower > 0) powerDisplay.classList.add("active");
    else powerDisplay.classList.remove("active");
  }
};

console.log('App integrated v2.0 loaded successfully');
