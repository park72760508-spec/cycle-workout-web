/* ==========================================================
   bluetooth.js (v4.1 Final Feature-Complete)
   - Dual-Channel: Data (Read) and Control (Write) discovered independently
   - Mobile Safe: Bluefy/Android compatible (try-catch guarded)
   - Features Preserved: 3-sec Power Buffer, Garmin-style Cadence Logic
========================================================== */

const UUIDS = {
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', 
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb',
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
  CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592', 
  WAHOO_SERVICE:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  WAHOO_CONTROL:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  TACX_SERVICE:     '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  TACX_CONTROL:     '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
  HR_SERVICE:   '0000180d-0000-1000-8000-00805f9b34fb'
};

// Comprehensive list for iOS/Bluefy: Legacy services must be in optionalServices at connection time.
// Required for ErgController (v11.0) to discover CycleOps/Wahoo/FTMS control points on iPhone.
const COMPREHENSIVE_ERG_OPTIONAL_SERVICES = [
  '347b0001-7635-408b-8918-8ff3949ce592', // CycleOps - CRITICAL
  'a026e005-0a7d-4ab3-97fa-f1500f9feb8b', // Wahoo
  '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e', // Tacx
  '00001826-0000-1000-8000-00805f9b34fb', // FTMS
  '00001818-0000-1000-8000-00805f9b34fb'  // Cycling Power (CPS)
];

// Global State
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
window.connectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };
window._lastCadenceUpdateTime = {};
window._lastCrankData = {};

// ========== Smart Pairing: 기기 저장 및 관리 ==========
const STORAGE_KEY = 'stelvio_saved_devices';

// 저장된 기기 로드
function loadSavedDevices() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    console.log('[loadSavedDevices] localStorage에서 읽은 데이터:', stored);
    if (!stored) {
      console.log('[loadSavedDevices] 저장된 기기가 없습니다.');
      return [];
    }
    const parsed = JSON.parse(stored);
    console.log('[loadSavedDevices] 파싱된 기기 목록:', parsed);
    return parsed;
  } catch (error) {
    console.error('[loadSavedDevices] 저장된 기기 로드 실패:', error);
    return [];
  }
}

// 기기 저장
function saveDevice(deviceId, name, deviceType, nickname) {
  try {
    const saved = loadSavedDevices();
    const deviceData = {
      deviceId: deviceId,
      name: name || '알 수 없는 기기',
      nickname: nickname || name || '알 수 없는 기기',
      lastConnected: Date.now(),
      deviceType: deviceType
    };
    
    const existingIndex = saved.findIndex(d => d.deviceId === deviceId && d.deviceType === deviceType);
    if (existingIndex >= 0) {
      saved[existingIndex] = deviceData;
    } else {
      saved.push(deviceData);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return deviceData;
  } catch (error) {
    console.error('Failed to save device:', error);
    return null;
  }
}

// 저장된 기기에서 특정 타입의 기기 찾기
function getSavedDevicesByType(deviceType) {
  return loadSavedDevices().filter(d => d.deviceType === deviceType);
}

// 닉네임 입력 모달 표시
function showNicknameModal(deviceName, callback) {
  console.log('[showNicknameModal] 닉네임 입력 모달 표시 시작:', deviceName);
  console.log('[showNicknameModal] callback 타입:', typeof callback);
  
  if (!callback || typeof callback !== 'function') {
    console.error('[showNicknameModal] callback이 함수가 아닙니다:', callback);
    return false;
  }
  
  try {
    console.log('[showNicknameModal] prompt() 호출 전');
    const nickname = prompt(
      `이 기기의 이름을 무엇으로 저장할까요?\n\n기기명: ${deviceName}\n\n예: 지성이의 로라, 센터 3번 자전거`,
      deviceName || ''
    );
    
    console.log('[showNicknameModal] prompt() 호출 후, 사용자 입력:', nickname);
    
    if (nickname !== null && nickname.trim()) {
      const trimmedNickname = nickname.trim();
      console.log('[showNicknameModal] 닉네임 저장:', trimmedNickname);
      // 콜백을 즉시 호출
      try {
        callback(trimmedNickname);
        console.log('[showNicknameModal] 콜백 실행 완료');
      } catch (callbackError) {
        console.error('[showNicknameModal] 콜백 실행 오류:', callbackError);
      }
      return true;
    } else {
      console.log('[showNicknameModal] 닉네임 입력 취소 또는 빈 값');
      // 취소하거나 빈 값이면 기본 이름으로 저장
      try {
        callback(deviceName || '알 수 없는 기기');
        console.log('[showNicknameModal] 기본 이름으로 콜백 실행 완료');
      } catch (callbackError) {
        console.error('[showNicknameModal] 기본 이름 콜백 실행 오류:', callbackError);
      }
      return false;
    }
  } catch (error) {
    console.error('[showNicknameModal] 오류 발생:', error);
    console.error('[showNicknameModal] 오류 스택:', error.stack);
    // 오류 발생 시 기본 이름으로 저장
    try {
      callback(deviceName || '알 수 없는 기기');
      console.log('[showNicknameModal] 오류 후 기본 이름으로 콜백 실행 완료');
    } catch (callbackError) {
      console.error('[showNicknameModal] 오류 후 콜백 실행 오류:', callbackError);
    }
    return false;
  }
}

// 전역 노출 (app.js에서 사용)
window.getSavedDevicesByType = window.getSavedDevicesByType || getSavedDevicesByType;
window.loadSavedDevices = window.loadSavedDevices || loadSavedDevices;
window.saveDevice = window.saveDevice || saveDevice;
window.showNicknameModal = window.showNicknameModal || showNicknameModal;

// 저장된 기기 정보로 requestDevice 호출 (getDevices API 미지원 환경용)
async function requestDeviceWithSavedInfo(deviceId, deviceType, savedDeviceName) {
  try {
    if (!navigator.bluetooth || !('requestDevice' in navigator.bluetooth)) {
      throw new Error('Bluetooth API를 사용할 수 없습니다.');
    }
    
    // 저장된 기기 이름을 사용하여 필터 생성
    const filters = [];
    
    if (deviceType === 'heartRate') {
      filters.push({ services: ['heart_rate'] });
      filters.push({ services: [UUIDS.HR_SERVICE] });
      // 저장된 기기 이름이 있으면 namePrefix 필터 추가
      if (savedDeviceName) {
        filters.push({ namePrefix: savedDeviceName });
      }
    } else if (deviceType === 'trainer') {
      filters.push({ services: [UUIDS.FTMS_SERVICE] });
      filters.push({ services: [UUIDS.CPS_SERVICE] });
      filters.push({ namePrefix: "CycleOps" });
      filters.push({ namePrefix: "Hammer" });
      filters.push({ namePrefix: "Saris" });
      filters.push({ namePrefix: "Wahoo" });
      filters.push({ namePrefix: "KICKR" });
      filters.push({ namePrefix: "Tacx" });
      // 저장된 기기 이름이 있으면 namePrefix 필터 추가
      if (savedDeviceName) {
        filters.push({ namePrefix: savedDeviceName });
      }
    } else if (deviceType === 'powerMeter') {
      filters.push({ services: [UUIDS.CPS_SERVICE] });
      filters.push({ services: [UUIDS.CSC_SERVICE] });
      // 저장된 기기 이름이 있으면 namePrefix 필터 추가
      if (savedDeviceName) {
        filters.push({ namePrefix: savedDeviceName });
      }
    }
    
    const optionalServices = deviceType === 'heartRate' 
      ? ['heart_rate', UUIDS.HR_SERVICE, 'battery_service']
      : deviceType === 'trainer'
      ? [UUIDS.FTMS_SERVICE, UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE, UUIDS.CYCLEOPS_SERVICE, UUIDS.WAHOO_SERVICE, UUIDS.TACX_SERVICE, 'device_information', 'battery_service']
      : [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE];
    
    // requestDevice 호출
    const device = await navigator.bluetooth.requestDevice({ 
      filters: filters.length > 0 ? filters : undefined,
      optionalServices 
    });
    
    return device;
  } catch (error) {
    console.error('[requestDeviceWithSavedInfo] 기기 요청 실패:', error);
    throw error;
  }
}

// 저장된 기기에 재연결 시도
async function reconnectToSavedDevice(deviceId, deviceType) {
  try {
    // getDevices() API 지원 여부 확인
    if (!navigator.bluetooth || !('getDevices' in navigator.bluetooth)) {
      // 조용히 null 반환 (경고 로그 제거 - 사용자 경험 개선)
      // 호출자가 새 기기 검색으로 자동 폴백함
      return null;
    }
    
    console.log('[reconnectToSavedDevice] 페어링된 기기 목록 조회 중...', { deviceId, deviceType });
    const pairedDevices = await navigator.bluetooth.getDevices();
    console.log('[reconnectToSavedDevice] 페어링된 기기 수:', pairedDevices.length);
    
    if (pairedDevices.length > 0) {
      console.log('[reconnectToSavedDevice] 페어링된 기기 ID 목록:', pairedDevices.map(d => d.id));
    }
    
    const device = pairedDevices.find(d => d.id === deviceId);
    
    if (!device) {
      console.warn('[reconnectToSavedDevice] 기기를 찾을 수 없음:', { 
        deviceId, 
        deviceType, 
        pairedCount: pairedDevices.length,
        pairedIds: pairedDevices.map(d => d.id)
      });
      throw new Error('기기를 찾을 수 없습니다. 전원이 켜져 있고 범위 내에 있는지 확인하세요.');
    }
    
    console.log('[reconnectToSavedDevice] 기기 발견:', { name: device.name, id: device.id });
    
    if (!device.gatt) {
      throw new Error('GATT 서버를 사용할 수 없습니다.');
    }
    
    console.log('[reconnectToSavedDevice] GATT 서버 연결 시도...');
    const server = await device.gatt.connect();
    console.log('[reconnectToSavedDevice] 연결 성공');
    return { device, server };
  } catch (error) {
    console.error('[reconnectToSavedDevice] 재연결 실패:', error);
    throw error;
  }
}

// 전역 노출 (app.js에서 사용)
window.reconnectToSavedDevice = window.reconnectToSavedDevice || reconnectToSavedDevice;
window.requestDeviceWithSavedInfo = window.requestDeviceWithSavedInfo || requestDeviceWithSavedInfo;
window.handleHeartRateData = window.handleHeartRateData || handleHeartRateData;
window.handlePowerMeterData = window.handlePowerMeterData || handlePowerMeterData;
window.handleTrainerData = window.handleTrainerData || handleTrainerData;
window.handleDisconnect = window.handleDisconnect || handleDisconnect; 

// UI Helpers (Preserved)
window.showConnectionStatus = window.showConnectionStatus || function (show) {
  const el = document.getElementById("connectionStatus");
  if (el) el.classList.toggle("hidden", !show);
};
window.showToast = window.showToast || function (msg) {
  const t = document.getElementById("toast");
  if (!t) { console.log("[TOAST]", msg); return; }
  t.classList.remove("hidden");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
};
window.updateDevicesList = function () {
    if (typeof window.updateDeviceButtonImages === 'function') window.updateDeviceButtonImages();
};

// ── [Connection Engine] ──

async function connectTrainer() {
  console.log('[connectTrainer] 함수 호출 시작');
  try {
    console.log('[connectTrainer] showConnectionStatus 호출');
    showConnectionStatus(true);
    
    // 기존 트레이너 연결 해제 (나중에 연결한 기기가 이전 기기를 대체)
    if (window.connectedDevices?.trainer) {
      console.log('[connectTrainer] 기존 트레이너 연결 해제 중...', window.connectedDevices.trainer.name);
      try {
        const oldDevice = window.connectedDevices.trainer.device;
        if (oldDevice && oldDevice.gatt && oldDevice.gatt.connected) {
          await oldDevice.gatt.disconnect();
        }
        handleDisconnect('trainer', oldDevice);
        // UI 업데이트를 위해 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (disconnectError) {
        console.warn('[connectTrainer] 기존 연결 해제 실패:', disconnectError);
        // 강제로 연결 상태 해제
        window.connectedDevices.trainer = null;
        handleDisconnect('trainer', null);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log('[connectTrainer] ZWIFT-Class Scan (Dual-Channel) Started...');

    // 1. 저장된 기기 확인 및 재연결 시도
    const savedDevices = getSavedDevicesByType('trainer');
    if (savedDevices.length > 0 && navigator.bluetooth && 'getDevices' in navigator.bluetooth) {
      for (const saved of savedDevices) {
        try {
          const result = await reconnectToSavedDevice(saved.deviceId, 'trainer');
          if (result) {
            const { device, server } = result;
            
            // 기존 연결 로직 실행
            const _safeGetService = async (uuid) => { try { return await server.getPrimaryService(uuid); } catch (e) { return null; } };
            const _safeGetChar = async (svc, uuid) => { if(!svc) return null; try { return await svc.getCharacteristic(uuid); } catch (e) { return null; } };

            let dataChar = null;
            let dataProtocol = 'UNKNOWN';

            if (!dataChar) {
              const svc = await _safeGetService(UUIDS.FTMS_SERVICE);
              dataChar = await _safeGetChar(svc, UUIDS.FTMS_DATA);
              if(dataChar) dataProtocol = 'FTMS';
            }
            if (!dataChar) {
              const svc = await _safeGetService(UUIDS.CPS_SERVICE);
              dataChar = await _safeGetChar(svc, UUIDS.CPS_DATA);
              if(dataChar) dataProtocol = 'CPS';
            }
            if (!dataChar) {
               const svc = await _safeGetService(UUIDS.CYCLEOPS_SERVICE);
               if (svc) {
                   try {
                     const chars = await svc.getCharacteristics();
                     if (chars.length > 0) { dataChar = chars[0]; dataProtocol = 'CYCLEOPS_LEGACY'; }
                   } catch(e) {}
               }
            }
            
            if (!dataChar) throw new Error("데이터 전송 서비스를 찾을 수 없습니다.");
            
            await dataChar.startNotifications();
            const parser = (dataProtocol === 'FTMS') ? handleTrainerData : handlePowerMeterData; 
            dataChar.addEventListener("characteristicvaluechanged", parser);

            let controlChar = null;
            let controlProtocol = 'NONE';

            if (!controlChar) {
              const svc = await _safeGetService(UUIDS.FTMS_SERVICE);
              controlChar = await _safeGetChar(svc, UUIDS.FTMS_CONTROL);
              if(controlChar) controlProtocol = 'FTMS';
            }
            if (!controlChar) {
              const svc = await _safeGetService(UUIDS.CYCLEOPS_SERVICE);
              controlChar = await _safeGetChar(svc, UUIDS.CYCLEOPS_CONTROL);
              if(controlChar) controlProtocol = 'CYCLEOPS';
            }
            if (!controlChar) {
              const svc = await _safeGetService(UUIDS.WAHOO_SERVICE);
              controlChar = await _safeGetChar(svc, UUIDS.WAHOO_CONTROL);
              if(controlChar) controlProtocol = 'WAHOO';
            }

            window.connectedDevices.trainer = { 
              name: device.name || saved.name, device, server, characteristic: dataChar, controlPoint: controlChar,
              protocol: controlProtocol, dataProtocol: dataProtocol, realProtocol: controlProtocol
            };

            window.isSensorConnected = true;
            try { window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: true, deviceType: 'trainer' } })); } catch (e) {}
            device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
            
            saveDevice(saved.deviceId, device.name || saved.name, 'trainer', saved.nickname);
            
            updateDevicesList();
            showConnectionStatus(false);
            
            let statusMsg = `✅ ${saved.nickname || device.name || saved.name} 연결됨 [${dataProtocol}]`;
            if (controlChar) statusMsg += `\n⚡ ERG 제어 가능 [${controlProtocol}]`;
            else statusMsg += `\n⚠️ 파워미터 모드 (제어 불가)`;
            showToast(statusMsg);

            if (window.ergController) setTimeout(() => window.ergController.initializeTrainer(), 500);
            return;
          }
        } catch (reconnectError) {
          console.warn('재연결 실패, 새 기기 찾기로 진행:', reconnectError);
        }
      }
    }

    // 2. 저장된 기기가 없거나 재연결 실패 시 새 기기 찾기
    const filters = [
      { services: [UUIDS.FTMS_SERVICE] },
      { services: [UUIDS.CPS_SERVICE] },
      { namePrefix: "CycleOps" }, { namePrefix: "Hammer" }, { namePrefix: "Saris" },
      { namePrefix: "Wahoo" }, { namePrefix: "KICKR" }, { namePrefix: "Tacx" }
    ];
    
    // 저장된 기기가 있고 getDevices() API가 없으면 이름 필터 추가 (최대 3개까지만)
    if (savedDevices.length > 0 && (!navigator.bluetooth || !('getDevices' in navigator.bluetooth))) {
      const nameFilters = savedDevices
        .slice(0, 3) // 최대 3개까지만 필터 추가
        .filter(saved => saved.name && saved.name.trim())
        .map(saved => ({ namePrefix: saved.name }));
      filters = filters.concat(nameFilters);
    }

    const optionalServices = [
      UUIDS.FTMS_SERVICE, UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE,
      UUIDS.CYCLEOPS_SERVICE, UUIDS.WAHOO_SERVICE, UUIDS.TACX_SERVICE,
      'device_information', 'battery_service'
    ];
    COMPREHENSIVE_ERG_OPTIONAL_SERVICES.forEach(function (uuid) {
      if (optionalServices.indexOf(uuid) === -1) optionalServices.push(uuid);
    });

    console.log('[connectTrainer] requestDevice 필터:', filters);

    let device;
    try {
        device = await navigator.bluetooth.requestDevice({ 
          filters: filters.length > 0 ? filters : undefined, 
          optionalServices 
        });
    } catch (e) {
        console.warn('[connectTrainer] 필터로 기기 검색 실패:', e);
        // 사용자가 취소한 경우 (NotFoundError)는 재시도하지 않음
        if (e.name === 'NotFoundError' || e.name === 'AbortError') {
          showConnectionStatus(false);
          return;
        }
        // 필터 실패 시 기본 필터로 재시도
        try {
          device = await navigator.bluetooth.requestDevice({ 
            filters: [
              { services: [UUIDS.FTMS_SERVICE] },
              { services: [UUIDS.CPS_SERVICE] }
            ],
            optionalServices
          });
        } catch (e2) {
          console.error('[connectTrainer] 기본 필터로도 기기 검색 실패:', e2);
          showConnectionStatus(false);
          return;
        }
    }

    const server = await device.gatt.connect();
    
    // Helper: Safe Service Discovery (Prevents Bluefy crashes)
    const _safeGetService = async (uuid) => { try { return await server.getPrimaryService(uuid); } catch (e) { return null; } };
    const _safeGetChar = async (svc, uuid) => { if(!svc) return null; try { return await svc.getCharacteristic(uuid); } catch (e) { return null; } };

    // 3. Data Channel Discovery (FTMS -> CPS -> Legacy)
    let dataChar = null;
    let dataProtocol = 'UNKNOWN';

    // A. FTMS
    if (!dataChar) {
      const svc = await _safeGetService(UUIDS.FTMS_SERVICE);
      dataChar = await _safeGetChar(svc, UUIDS.FTMS_DATA);
      if(dataChar) dataProtocol = 'FTMS';
    }
    // B. CPS
    if (!dataChar) {
      const svc = await _safeGetService(UUIDS.CPS_SERVICE);
      dataChar = await _safeGetChar(svc, UUIDS.CPS_DATA);
      if(dataChar) dataProtocol = 'CPS';
    }
    // C. Legacy (CycleOps)
    if (!dataChar) {
       const svc = await _safeGetService(UUIDS.CYCLEOPS_SERVICE);
       if (svc) {
           try {
             const chars = await svc.getCharacteristics();
             // Often the first char is notification
             if (chars.length > 0) { dataChar = chars[0]; dataProtocol = 'CYCLEOPS_LEGACY'; }
           } catch(e) {}
       }
    }
    
    if (!dataChar) throw new Error("데이터 전송 서비스를 찾을 수 없습니다.");
    
    await dataChar.startNotifications();
    const parser = (dataProtocol === 'FTMS') ? handleTrainerData : handlePowerMeterData; 
    dataChar.addEventListener("characteristicvaluechanged", parser);

    // 4. Control Channel Discovery (Independent Search)
    let controlChar = null;
    let controlProtocol = 'NONE';

    // A. FTMS Control
    if (!controlChar) {
      const svc = await _safeGetService(UUIDS.FTMS_SERVICE);
      controlChar = await _safeGetChar(svc, UUIDS.FTMS_CONTROL);
      if(controlChar) controlProtocol = 'FTMS';
    }
    // B. CycleOps / Hammer Control (Legacy)
    if (!controlChar) {
      const svc = await _safeGetService(UUIDS.CYCLEOPS_SERVICE);
      controlChar = await _safeGetChar(svc, UUIDS.CYCLEOPS_CONTROL);
      if(controlChar) controlProtocol = 'CYCLEOPS';
    }
    // C. Wahoo Control (Legacy)
    if (!controlChar) {
      const svc = await _safeGetService(UUIDS.WAHOO_SERVICE);
      controlChar = await _safeGetChar(svc, UUIDS.WAHOO_CONTROL);
      if(controlChar) controlProtocol = 'WAHOO';
    }

    // 5. Finalize Connection Object
    window.connectedDevices.trainer = { 
      name: device.name, device, server, characteristic: dataChar, controlPoint: controlChar,
      protocol: controlProtocol, dataProtocol: dataProtocol, realProtocol: controlProtocol
    };

    window.isSensorConnected = true;
    try { window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: true, deviceType: 'trainer' } })); } catch (e) {}
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    // 새 기기 저장 (닉네임 설정)
    const deviceName = device.name || '알 수 없는 기기';
    const saved = loadSavedDevices().find(d => d.deviceId === device.id && d.deviceType === 'trainer');
    
    console.log('[connectTrainer] 기기 저장 확인:', { deviceId: device.id, deviceName, saved: !!saved });
    
    if (!saved) {
      // 처음 연결하는 기기이면 닉네임 입력 받기
      console.log('[connectTrainer] 새 기기 감지, 닉네임 입력 모달 표시');
      const nicknameModalFn = typeof showNicknameModal === 'function' ? showNicknameModal : (typeof window.showNicknameModal === 'function' ? window.showNicknameModal : null);
      if (nicknameModalFn) {
        nicknameModalFn(deviceName, (nickname) => {
          console.log('[connectTrainer] 닉네임 입력 완료:', nickname);
          saveDevice(device.id, deviceName, 'trainer', nickname);
          showToast(`✅ ${nickname} 저장 완료`);
          // 저장 후 드롭다운 목록 업데이트
          if (typeof updateIndividualBluetoothDropdownWithSavedDevices === 'function') {
            updateIndividualBluetoothDropdownWithSavedDevices();
          }
          if (typeof updateMobileBluetoothDropdownWithSavedDevices === 'function') {
            updateMobileBluetoothDropdownWithSavedDevices();
          }
        });
      } else {
        console.error('[connectTrainer] showNicknameModal 함수를 찾을 수 없습니다.');
        // 폴백: 기본 이름으로 저장
        saveDevice(device.id, deviceName, 'trainer', deviceName);
      }
    } else {
      // 이미 저장된 기기면 lastConnected만 업데이트
      console.log('[connectTrainer] 저장된 기기 감지, lastConnected 업데이트:', saved.nickname);
      saveDevice(device.id, deviceName, 'trainer', saved.nickname);
    }
    
    updateDevicesList();
    showConnectionStatus(false);
    
    const displayName = saved ? (saved.nickname || deviceName) : deviceName;
    let statusMsg = `✅ ${displayName} 연결됨 [${dataProtocol}]`;
    if (controlChar) statusMsg += `\n⚡ ERG 제어 가능 [${controlProtocol}]`;
    else statusMsg += `\n⚠️ 파워미터 모드 (제어 불가)`;
    showToast(statusMsg);

    if (window.ergController) setTimeout(() => window.ergController.initializeTrainer(), 500);

  } catch (err) {
    showConnectionStatus(false);
    console.error(err);
    alert("❌ 연결 실패: " + err.message);
  }
}

// ── [Data Parsers - STRICTLY PRESERVED] ──

function handleTrainerData(e) {
  const dv = e.target.value;
  if (dv.byteLength < 4) return;
  
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  off += 2; // Speed (Mandatory)

  if (flags & 0x0002) off += 2; // Avg Speed

  if (flags & 0x0004) { // Cadence
    const cadenceRaw = dv.getUint16(off, true); off += 2;
    const rpm = Math.round(cadenceRaw * 0.5);
    window.liveData.cadence = rpm;
    notifyChildWindows('cadence', rpm);
    window._lastCadenceUpdateTime['trainer'] = Date.now();
  }
  
  if (flags & 0x0008) off += 2; // Avg Cadence
  if (flags & 0x0010) off += 3; // Total Distance
  if (flags & 0x0020) off += 2; // Resistance
  
  if (flags & 0x0040) { // Power
    const p = dv.getInt16(off, true); off += 2;
    if (!Number.isNaN(p)) {
      // 파워미터가 연결되어 있으면 트레이너 파워 값 무시 (파워미터 우선)
      if (!window.connectedDevices?.powerMeter) {
        window.liveData.power = p;
        // ★ 3-Second Power Buffer Logic (Preserved)
        if (typeof window.addPowerToBuffer === 'function') window.addPowerToBuffer(p);
        if(window.ergController) window.ergController.updatePower(p);
        notifyChildWindows('power', p);
      }
      // 파워미터가 연결되어 있으면 트레이너 파워 값은 무시 (파워미터가 더 정확)
    }
  }
}

function handlePowerMeterData(event) {
  const dv = event.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  
  const instPower = dv.getInt16(off, true); off += 2;
  if (!Number.isNaN(instPower)) {
    window.liveData.power = instPower;
    // ★ 3-Second Power Buffer Logic (Preserved)
    if (typeof window.addPowerToBuffer === 'function') window.addPowerToBuffer(instPower);
    if(window.ergController) window.ergController.updatePower(instPower);
    notifyChildWindows('power', instPower);
  }
  
  if (flags & 0x0001) off += 1;
  if (flags & 0x0004) off += 2;
  if (flags & 0x0010) off += 6;
  
  // ★ Garmin-Style Complex Cadence Logic (Preserved)
  if (flags & 0x0020) { 
    const cumulativeCrankRevolutions = dv.getUint16(off, true); off += 2;
    const lastCrankEventTime = dv.getUint16(off, true); off += 2;
    
    const deviceKey = window.connectedDevices.trainer ? 'trainer' : 'powerMeter';
    const lastData = window._lastCrankData[deviceKey];
    
    if (lastData && lastCrankEventTime !== lastData.lastCrankEventTime) {
      let timeDiff = lastCrankEventTime - lastData.lastCrankEventTime;
      if (timeDiff < 0) timeDiff += 65536; // Handle Overflow
      let revDiff = cumulativeCrankRevolutions - lastData.cumulativeCrankRevolutions;
      if (revDiff < 0) revDiff += 65536; // Handle Overflow
      
      if (timeDiff > 0 && revDiff > 0) {
        const timeInSeconds = timeDiff / 1024.0;
        const cadence = Math.round((revDiff / timeInSeconds) * 60);
        if (cadence > 0 && cadence <= 250) {
          window.liveData.cadence = cadence;
          window._lastCadenceUpdateTime[deviceKey] = Date.now();
          notifyChildWindows('cadence', cadence);
        }
      }
    }
    window._lastCrankData[deviceKey] = { cumulativeCrankRevolutions, lastCrankEventTime, timestamp: Date.now() };
  }
}

// (Helper functions for HR/PM connection are kept standard)
async function connectHeartRate() {
  console.log('[connectHeartRate] 함수 호출 시작');
  try {
    console.log('[connectHeartRate] showConnectionStatus 호출');
    showConnectionStatus(true);
    
    // 기존 심박계 연결 해제 (나중에 연결한 기기가 이전 기기를 대체)
    if (window.connectedDevices?.heartRate) {
      console.log('[connectHeartRate] 기존 심박계 연결 해제 중...', window.connectedDevices.heartRate.name);
      try {
        const oldDevice = window.connectedDevices.heartRate.device;
        if (oldDevice && oldDevice.gatt && oldDevice.gatt.connected) {
          await oldDevice.gatt.disconnect();
        }
        handleDisconnect('heartRate', oldDevice);
        // UI 업데이트를 위해 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (disconnectError) {
        console.warn('[connectHeartRate] 기존 연결 해제 실패:', disconnectError);
        // 강제로 연결 상태 해제
        window.connectedDevices.heartRate = null;
        handleDisconnect('heartRate', null);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // 1. 저장된 기기 확인 및 재연결 시도
    const savedDevices = getSavedDevicesByType('heartRate');
    if (savedDevices.length > 0 && navigator.bluetooth && 'getDevices' in navigator.bluetooth) {
      // 저장된 기기가 있으면 재연결 시도
      for (const saved of savedDevices) {
        try {
          const result = await reconnectToSavedDevice(saved.deviceId, 'heartRate');
          if (result) {
            const { device, server } = result;
            
            // 서비스 및 특성 가져오기
            let service;
            try { service = await server.getPrimaryService('heart_rate'); } 
            catch (e) { service = await server.getPrimaryService(UUIDS.HR_SERVICE); }
            
            let characteristic;
            try { characteristic = await service.getCharacteristic('heart_rate_measurement'); }
            catch (e) { characteristic = await service.getCharacteristic(0x2A37); }
            
            await characteristic.startNotifications();
            characteristic.addEventListener("characteristicvaluechanged", handleHeartRateData);
            
            window.connectedDevices.heartRate = { 
              name: device.name || saved.name, 
              device, 
              server, 
              characteristic 
            };
            
            window.isSensorConnected = true;
            try { window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: true, deviceType: 'heartRate' } })); } catch (e) {}
            device.addEventListener("gattserverdisconnected", () => handleDisconnect('heartRate', device));
            
            // lastConnected 업데이트
            saveDevice(saved.deviceId, device.name || saved.name, 'heartRate', saved.nickname);
            
            updateDevicesList();
            showConnectionStatus(false);
            showToast(`✅ ${saved.nickname || device.name || saved.name} 연결 성공`);
            return;
          }
        } catch (reconnectError) {
          console.warn('재연결 실패, 새 기기 찾기로 진행:', reconnectError);
          // 재연결 실패 시 계속 진행
        }
      }
    }
    
    // 2. 저장된 기기가 없거나 재연결 실패 시 새 기기 찾기
    // 필터 없이 optionalServices만 사용하여 모든 심박계 기기 검색
    console.log('[connectHeartRate] requestDevice 호출 시작 (필터 없음, optionalServices만 사용)');
    
    let device;
    try {
        // 필터 없이 optionalServices만 사용하면 더 많은 기기가 검색됨
        device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true, // 모든 블루투스 기기 허용
            optionalServices: ['heart_rate', UUIDS.HR_SERVICE, 'battery_service']
        });
        console.log('[connectHeartRate] requestDevice 성공:', device.name);
        
        // 선택된 기기가 실제로 심박계 서비스를 가지고 있는지 확인
        if (!device) {
          throw new Error('기기를 선택하지 않았습니다.');
        }
    } catch(e) {
        console.warn('[connectHeartRate] requestDevice 실패:', e.name, e.message);
        // 사용자가 취소한 경우 조용히 종료
        if (e.name === 'NotFoundError' || e.name === 'AbortError') {
          console.log('[connectHeartRate] 사용자가 기기 선택을 취소했습니다.');
          showConnectionStatus(false);
          if (typeof showToast === 'function') {
            showToast('기기 선택이 취소되었습니다.');
          }
          return; // 조용히 종료
        }
        // 기타 에러는 전파
        showConnectionStatus(false);
        throw e;
    }
    
    if (!device) {
      console.warn('[connectHeartRate] 기기를 선택하지 않았습니다.');
      showConnectionStatus(false);
      return;
    }
    
    console.log('[connectHeartRate] 선택된 기기:', device.name, device.id);
    
    const server = await device.gatt.connect();
    console.log('[connectHeartRate] GATT 서버 연결 성공');
    let service;
    try { service = await server.getPrimaryService('heart_rate'); } 
    catch (e) { service = await server.getPrimaryService(UUIDS.HR_SERVICE); }
    let characteristic;
    try { characteristic = await service.getCharacteristic('heart_rate_measurement'); }
    catch (e) { characteristic = await service.getCharacteristic(0x2A37); }
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handleHeartRateData);
    window.connectedDevices.heartRate = { name: device.name, device, server, characteristic };
    window.isSensorConnected = true;
    try { window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: true, deviceType: 'heartRate' } })); } catch (e) {}
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('heartRate', device));
    
    // 3. 새 기기 저장 (닉네임 설정)
    const deviceName = device.name || '알 수 없는 기기';
    const allSavedDevices = loadSavedDevices();
    console.log('[connectHeartRate] 전체 저장된 기기 목록:', allSavedDevices);
    console.log('[connectHeartRate] 현재 기기 ID:', device.id);
    
    const saved = allSavedDevices.find(d => {
      const match = d.deviceId === device.id && d.deviceType === 'heartRate';
      if (match) {
        console.log('[connectHeartRate] 저장된 기기 매칭 성공:', d);
      }
      return match;
    });
    
    console.log('[connectHeartRate] 기기 저장 확인:', { 
      deviceId: device.id, 
      deviceName, 
      saved: !!saved,
      savedDevicesCount: allSavedDevices.length,
      heartRateDevicesCount: allSavedDevices.filter(d => d.deviceType === 'heartRate').length
    });
    
    if (!saved) {
      // 처음 연결하는 기기이면 닉네임 입력 받기
      console.log('[connectHeartRate] 새 기기 감지, 닉네임 입력 모달 표시');
      console.log('[connectHeartRate] showNicknameModal 함수 확인:', {
        local: typeof showNicknameModal,
        window: typeof window.showNicknameModal
      });
      
      // showNicknameModal 함수 찾기 (로컬 스코프 우선, 없으면 전역)
      const nicknameModalFn = typeof showNicknameModal === 'function' 
        ? showNicknameModal 
        : (typeof window.showNicknameModal === 'function' ? window.showNicknameModal : null);
      
      if (nicknameModalFn) {
        console.log('[connectHeartRate] showNicknameModal 함수 호출 시작');
        console.log('[connectHeartRate] nicknameModalFn:', nicknameModalFn);
        console.log('[connectHeartRate] deviceName:', deviceName);
        
        // prompt()는 동기 함수이므로 즉시 호출 (connectTrainer와 동일한 방식)
        try {
          console.log('[connectHeartRate] showNicknameModal 직접 호출');
          nicknameModalFn(deviceName, (nickname) => {
            console.log('[connectHeartRate] 닉네임 입력 완료 콜백 실행:', nickname);
            saveDevice(device.id, deviceName, 'heartRate', nickname);
            showToast(`✅ ${nickname} 저장 완료`);
            // 저장 후 드롭다운 목록 업데이트
            setTimeout(() => {
              if (typeof updateIndividualBluetoothDropdownWithSavedDevices === 'function') {
                updateIndividualBluetoothDropdownWithSavedDevices();
              }
              if (typeof updateMobileBluetoothDropdownWithSavedDevices === 'function') {
                updateMobileBluetoothDropdownWithSavedDevices();
              }
            }, 100);
          });
          console.log('[connectHeartRate] showNicknameModal 호출 완료');
        } catch (modalError) {
          console.error('[connectHeartRate] showNicknameModal 호출 오류:', modalError);
          console.error('[connectHeartRate] 오류 스택:', modalError.stack);
          // 오류 발생 시 기본 이름으로 저장
          saveDevice(device.id, deviceName, 'heartRate', deviceName);
          showToast(`✅ ${deviceName} 연결 성공 (기본 이름으로 저장됨)`);
        }
      } else {
        console.error('[connectHeartRate] showNicknameModal 함수를 찾을 수 없습니다.');
        console.error('[connectHeartRate] 사용 가능한 함수들:', {
          showNicknameModal: typeof showNicknameModal,
          windowShowNicknameModal: typeof window.showNicknameModal,
          saveDevice: typeof saveDevice,
          windowSaveDevice: typeof window.saveDevice
        });
        // 폴백: 기본 이름으로 저장
        saveDevice(device.id, deviceName, 'heartRate', deviceName);
        showToast(`✅ ${deviceName} 연결 성공 (기본 이름으로 저장됨)`);
      }
    } else {
      // 이미 저장된 기기면 lastConnected만 업데이트
      console.log('[connectHeartRate] 저장된 기기 감지, lastConnected 업데이트:', saved.nickname);
      saveDevice(device.id, deviceName, 'heartRate', saved.nickname);
    }
    
    updateDevicesList();
    showConnectionStatus(false);
    
    // 저장된 기기가 아닌 경우에만 기본 연결 성공 메시지 표시 (닉네임 모달에서 이미 표시됨)
    if (saved) {
      showToast(`✅ ${saved.nickname || deviceName} 연결 성공`);
    }
  } catch (err) {
    showConnectionStatus(false);
    if (err.name !== 'NotFoundError' && err.name !== 'SecurityError') {
      alert("심박계 오류: " + err.message);
    }
  }
}

async function connectPowerMeter() {
  console.log('[connectPowerMeter] 함수 호출 시작');
  // 트레이너가 연결되어 있으면 확인 (트레이너와 파워미터는 별개)
  if (window.connectedDevices.trainer && !confirm("트레이너가 이미 연결됨. 파워미터로 교체?")) {
    console.log('[connectPowerMeter] 사용자가 취소함');
    return;
  }
  
  try {
    console.log('[connectPowerMeter] showConnectionStatus 호출');
    showConnectionStatus(true);
    
    // 기존 파워미터 연결 해제 (나중에 연결한 기기가 이전 기기를 대체)
    if (window.connectedDevices?.powerMeter) {
      console.log('[connectPowerMeter] 기존 파워미터 연결 해제 중...', window.connectedDevices.powerMeter.name);
      try {
        const oldDevice = window.connectedDevices.powerMeter.device;
        if (oldDevice && oldDevice.gatt && oldDevice.gatt.connected) {
          await oldDevice.gatt.disconnect();
        }
        handleDisconnect('powerMeter', oldDevice);
        // UI 업데이트를 위해 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (disconnectError) {
        console.warn('[connectPowerMeter] 기존 연결 해제 실패:', disconnectError);
        // 강제로 연결 상태 해제
        window.connectedDevices.powerMeter = null;
        handleDisconnect('powerMeter', null);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // 1. 저장된 기기 확인 및 재연결 시도
    const savedDevices = getSavedDevicesByType('powerMeter');
    if (savedDevices.length > 0 && navigator.bluetooth && 'getDevices' in navigator.bluetooth) {
      for (const saved of savedDevices) {
        try {
          const result = await reconnectToSavedDevice(saved.deviceId, 'powerMeter');
          if (result) {
            const { device, server } = result;
            
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
            window.connectedDevices.powerMeter = { 
              name: device.name || saved.name, device, server, characteristic 
            };
            window.isSensorConnected = true;
            try { window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: true, deviceType: 'powerMeter' } })); } catch (e) {}
            device.addEventListener("gattserverdisconnected", () => handleDisconnect('powerMeter', device));
            
            saveDevice(saved.deviceId, device.name || saved.name, 'powerMeter', saved.nickname);
            
            updateDevicesList();
            showConnectionStatus(false);
            showToast(`✅ ${saved.nickname || device.name || saved.name} 연결 성공`);
            return;
          }
        } catch (reconnectError) {
          console.warn('재연결 실패, 새 기기 찾기로 진행:', reconnectError);
        }
      }
    }
    
    // 2. 저장된 기기가 없거나 재연결 실패 시 새 기기 찾기
    // getDevices() API가 없을 때 저장된 기기 이름으로 필터 적용
    const filters = [{ services: [UUIDS.CPS_SERVICE] }, { services: [UUIDS.CSC_SERVICE] }];
    
    // 저장된 기기가 있고 getDevices() API가 없으면 이름 필터 추가 (최대 3개까지만)
    if (savedDevices.length > 0 && (!navigator.bluetooth || !('getDevices' in navigator.bluetooth))) {
      const nameFilters = savedDevices
        .slice(0, 3) // 최대 3개까지만 필터 추가
        .filter(saved => saved.name && saved.name.trim())
        .map(saved => ({ namePrefix: saved.name }));
      filters = filters.concat(nameFilters);
    }
    
    console.log('[connectPowerMeter] requestDevice 필터:', filters);
    
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({ 
        filters: filters.length > 0 ? filters : undefined, 
        optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE, 'battery_service'] 
      });
    } catch(e) {
      console.warn('[connectPowerMeter] 필터로 기기 검색 실패, 기본 필터로 재시도:', e);
      // 사용자가 취소한 경우 (NotFoundError)는 재시도하지 않음
      if (e.name === 'NotFoundError' || e.name === 'AbortError') {
        showConnectionStatus(false);
        return;
      }
      // 필터 실패 시 기본 필터로 재시도
      try {
        device = await navigator.bluetooth.requestDevice({ 
          filters: [{ services: [UUIDS.CPS_SERVICE] }, { services: [UUIDS.CSC_SERVICE] }],
          optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE, 'battery_service']
        });
      } catch(e2) {
        console.error('[connectPowerMeter] 기본 필터로도 기기 검색 실패:', e2);
        showConnectionStatus(false);
        return;
      }
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
    window.connectedDevices.powerMeter = { name: device.name, device, server, characteristic };
    window.isSensorConnected = true;
    try { window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: true, deviceType: 'powerMeter' } })); } catch (e) {}
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('powerMeter', device));
    
    // 새 기기 저장 (닉네임 설정)
    const deviceName = device.name || '알 수 없는 기기';
    const saved = loadSavedDevices().find(d => d.deviceId === device.id && d.deviceType === 'powerMeter');
    
    console.log('[connectPowerMeter] 기기 저장 확인:', { deviceId: device.id, deviceName, saved: !!saved });
    
    if (!saved) {
      // 처음 연결하는 기기이면 닉네임 입력 받기
      console.log('[connectPowerMeter] 새 기기 감지, 닉네임 입력 모달 표시');
      const nicknameModalFn = typeof showNicknameModal === 'function' ? showNicknameModal : (typeof window.showNicknameModal === 'function' ? window.showNicknameModal : null);
      if (nicknameModalFn) {
        nicknameModalFn(deviceName, (nickname) => {
          console.log('[connectPowerMeter] 닉네임 입력 완료:', nickname);
          saveDevice(device.id, deviceName, 'powerMeter', nickname);
          showToast(`✅ ${nickname} 저장 완료`);
          // 저장 후 드롭다운 목록 업데이트
          if (typeof updateIndividualBluetoothDropdownWithSavedDevices === 'function') {
            updateIndividualBluetoothDropdownWithSavedDevices();
          }
          if (typeof updateMobileBluetoothDropdownWithSavedDevices === 'function') {
            updateMobileBluetoothDropdownWithSavedDevices();
          }
        });
      } else {
        console.error('[connectPowerMeter] showNicknameModal 함수를 찾을 수 없습니다.');
        // 폴백: 기본 이름으로 저장
        saveDevice(device.id, deviceName, 'powerMeter', deviceName);
      }
    } else {
      // 이미 저장된 기기면 lastConnected만 업데이트
      console.log('[connectPowerMeter] 저장된 기기 감지, lastConnected 업데이트:', saved.nickname);
      saveDevice(device.id, deviceName, 'powerMeter', saved.nickname);
    }
    
    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${deviceName} 연결 성공`);
  } catch (err) {
    showConnectionStatus(false);
    if (err.name !== 'NotFoundError' && err.name !== 'SecurityError') {
      alert("파워미터 오류: " + err.message);
    }
  }
}

function handleHeartRateData(event) {
  const dv = event.target.value;
  const flags = dv.getUint8(0);
  const hr = (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
  window.liveData.heartRate = hr;
  notifyChildWindows('heartRate', hr);
}

function handleDisconnect(type, device) {
  // device가 null이거나 undefined인 경우 강제 해제 (기존 연결 해제 시)
  if (device === null || device === undefined) {
    window.connectedDevices[type] = null;
  } else if (window.connectedDevices[type]?.device === device) {
    window.connectedDevices[type] = null;
  } else if (window.connectedDevices[type]) {
    // device가 일치하지 않아도 기존 연결이 있으면 해제 (안전장치)
    window.connectedDevices[type] = null;
  }
  
  if (type === 'trainer' && typeof updateErgModeUI === 'function') updateErgModeUI(false);
  const anyConnected = !!(window.connectedDevices?.heartRate || window.connectedDevices?.trainer || window.connectedDevices?.powerMeter);
  window.isSensorConnected = anyConnected;
  try { window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: anyConnected, deviceType: type, action: 'disconnected' } })); } catch (e) {}
  updateDevicesList();
}

function notifyChildWindows(field, value) {
  if (!window._bluetoothChildWindows) return;
  window._bluetoothChildWindows = window._bluetoothChildWindows.filter(w => !w.closed);
  window._bluetoothChildWindows.forEach(w => {
    w.postMessage({ type: 'bluetoothLiveDataUpdate', updatedField: field, updatedValue: value, ...window.liveData }, '*');
  });
}

window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
window.setTargetPower = function(targetWatts) {
    if (window.ergController) window.ergController.setTargetPower(targetWatts);
};

// ==========================================================
// ⚠️ [Restored Features] UI Updates & Safety Utilities
// (Recovered from legacy version to ensure full functionality)
// ==========================================================

// 1. UI Button Image & Color Updates
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
      btn.classList.remove("erg-mode-active");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  };
  
  // Update button images (Path preserved)
  updateBtn(btnTrainer, 'trainer', "assets/img/trainer_g.png", "assets/img/trainer_i.png");
  updateBtn(btnHR, 'heartRate', "assets/img/bpm_g.png", "assets/img/bpm_i.png");
  updateBtn(btnPM, 'powerMeter', "assets/img/power_g.png", "assets/img/power_i.png");
  
  // Trigger color update for ERG mode
  if (typeof window.updateBluetoothConnectionButtonColor === 'function') {
      window.updateBluetoothConnectionButtonColor();
  }
};

// 2. Button Color Update for ERG Mode
window.updateBluetoothConnectionButtonColor = function() {
  const btnTrainer = document.getElementById("btnConnectTrainer");
  if (!btnTrainer) return;
  
  const isTrainerConnected = window.connectedDevices?.trainer;
  const isErgModeActive = window.ergController && window.ergController.state && window.ergController.state.enabled;
  
  if (isTrainerConnected && isErgModeActive) {
    btnTrainer.classList.add("erg-mode-active");
  } else {
    btnTrainer.classList.remove("erg-mode-active");
  }
};

// 3. Safety: Disconnect on Page Unload
window.addEventListener("beforeunload", () => {
  try {
    if (window.connectedDevices?.trainer?.device?.gatt?.connected) {
        window.connectedDevices.trainer.device.gatt.disconnect();
    }
  } catch (e) {}
});

// 4. Safety: Reset cadence to 0 if data stops (timeout)
const CADENCE_TIMEOUT_MS = 3000;
setInterval(() => {
  const times = window._lastCadenceUpdateTime || {};
  const lastUpdate = Object.keys(times).length ? Math.max(...Object.values(times)) : 0;
  if (lastUpdate && (Date.now() - lastUpdate > CADENCE_TIMEOUT_MS)) {
    window.liveData.cadence = 0;
    notifyChildWindows('cadence', 0);
  }
}, 1000);
