/* ==========================================================
   bluetooth.js (v3.6 Universal Protocol Support)
   - 연결된 기기가 FTMS인지 Legacy(CycleOps/Wahoo)인지 정확히 식별
   - ErgController가 올바른 '방언(OpCode)'을 쓰도록 유도
   - ★ [v3.5] FTMS 및 CPS 데이터 파싱 로직 수정 (케이던스 복구)
   - ★ [v3.6] 구형 스마트 로라 ERG 모드 지원 강화
     * 모든 서비스 병렬 탐색 (ZWIFT/Mywoosh 방식)
     * CPS 데이터 + CycleOps Control Point 조합 지원
     * 구형/신형 기기 모두 완벽 대응
========================================================== */

// ── [1] UUID 상수 (만능 리스트) ──
const UUIDS = {
  // 1. 표준 FTMS
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb', 
  FTMS_DATA:    '00002ad2-0000-1000-8000-00805f9b34fb', 
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb', 
  
  // 2. 파워미터/센서
  CPS_SERVICE:  '00001818-0000-1000-8000-00805f9b34fb', 
  CPS_DATA:     '00002a63-0000-1000-8000-00805f9b34fb', 
  CSC_SERVICE:  '00001816-0000-1000-8000-00805f9b34fb', 
  
  // 3. ★ 구형/독자 규격 서비스 (Legacy)
  CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
  CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592', 

  WAHOO_SERVICE:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  WAHOO_CONTROL:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',

  TACX_SERVICE:     '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  TACX_CONTROL:     '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
  
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
window._lastCrankData = {}; 

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
      btn.classList.remove("erg-mode-active");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  };
  updateBtn(btnTrainer, 'trainer', "assets/img/trainer_g.png", "assets/img/trainer_i.png");
  updateBtn(btnHR, 'heartRate', "assets/img/bpm_g.png", "assets/img/bpm_i.png");
  updateBtn(btnPM, 'powerMeter', "assets/img/power_g.png", "assets/img/power_i.png");
  
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

// ── [3] 스마트 트레이너 연결 (프로토콜 식별 강화) ──

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;
    console.log('[connectTrainer] Universal Scan 시작...');

    const filters = [
      { services: [UUIDS.FTMS_SERVICE] },
      { services: [UUIDS.CPS_SERVICE] },
      { namePrefix: "CycleOps" },
      { namePrefix: "Hammer" },
      { namePrefix: "Saris" },
      { namePrefix: "Magnus" }
    ];

    const optionalServices = [
      UUIDS.FTMS_SERVICE, UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE,
      UUIDS.CYCLEOPS_SERVICE, UUIDS.WAHOO_SERVICE, UUIDS.TACX_SERVICE,
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
    console.log('[connectTrainer] 연결 성공. 프로토콜 분석 중...');

    let service, characteristic, controlPointChar = null;
    let realProtocol = 'UNKNOWN';
    let dataService = null;

    // ★ [개선] 모든 서비스를 병렬로 탐색하여 구형/신형 기기 모두 지원
    // ZWIFT/Mywoosh 방식: 모든 가능한 서비스를 탐색하고 최적의 조합 선택
    
    // [Step 1] 모든 가능한 서비스 탐색 (병렬)
    const servicePromises = [];
    
    // FTMS 서비스 탐색
    servicePromises.push(
      server.getPrimaryService(UUIDS.FTMS_SERVICE)
        .then(svc => ({ type: 'FTMS', service: svc }))
        .catch(() => null)
    );
    
    // CycleOps Legacy 서비스 탐색
    servicePromises.push(
      server.getPrimaryService(UUIDS.CYCLEOPS_SERVICE)
        .then(svc => ({ type: 'CYCLEOPS', service: svc }))
        .catch(() => null)
    );
    
    // Wahoo Legacy 서비스 탐색
    servicePromises.push(
      server.getPrimaryService(UUIDS.WAHOO_SERVICE)
        .then(svc => ({ type: 'WAHOO', service: svc }))
        .catch(() => null)
    );
    
    // CPS 서비스 탐색
    servicePromises.push(
      server.getPrimaryService(UUIDS.CPS_SERVICE)
        .then(svc => ({ type: 'CPS', service: svc }))
        .catch(() => null)
    );
    
    // CSC 서비스 탐색
    servicePromises.push(
      server.getPrimaryService(UUIDS.CSC_SERVICE)
        .then(svc => ({ type: 'CSC', service: svc }))
        .catch(() => null)
    );

    const foundServices = await Promise.all(servicePromises);
    const availableServices = foundServices.filter(s => s !== null);
    
    console.log(`[connectTrainer] 발견된 서비스:`, availableServices.map(s => s.type).join(', '));

    // [Step 2] Control Point 찾기 (우선순위: FTMS > CycleOps > Wahoo)
    for (const svcInfo of availableServices) {
      if (svcInfo.type === 'FTMS') {
        try {
          controlPointChar = await svcInfo.service.getCharacteristic(UUIDS.FTMS_CONTROL);
          realProtocol = 'FTMS';
          dataService = svcInfo.service;
          console.log('✅ FTMS Control Point 발견');
          break;
        } catch (e) {}
      }
    }
    
    // FTMS Control Point가 없으면 Legacy 탐색
    if (!controlPointChar) {
      for (const svcInfo of availableServices) {
        if (svcInfo.type === 'CYCLEOPS') {
          try {
            controlPointChar = await svcInfo.service.getCharacteristic(UUIDS.CYCLEOPS_CONTROL);
            realProtocol = 'CYCLEOPS';
            console.log('✅ CycleOps Legacy Control Point 발견');
            break;
          } catch (e) {}
        } else if (svcInfo.type === 'WAHOO') {
          try {
            controlPointChar = await svcInfo.service.getCharacteristic(UUIDS.WAHOO_CONTROL);
            realProtocol = 'WAHOO';
            console.log('✅ Wahoo Legacy Control Point 발견');
            break;
          } catch (e) {}
        }
      }
    }

    // [Step 3] 데이터 채널 찾기
    // FTMS가 있으면 FTMS 데이터 채널 우선 사용
    if (realProtocol === 'FTMS' && dataService) {
      try {
        characteristic = await dataService.getCharacteristic(UUIDS.FTMS_DATA);
        console.log('✅ FTMS 데이터 채널 발견');
      } catch (e) {
        console.warn('⚠️ FTMS 데이터 채널 없음');
      }
    }
    
    // 데이터 채널이 없으면 다른 서비스에서 찾기
    if (!characteristic) {
      // CycleOps Legacy에서 데이터 채널 찾기
      for (const svcInfo of availableServices) {
        if (svcInfo.type === 'CYCLEOPS') {
          try {
            const chars = await svcInfo.service.getCharacteristics();
            // CycleOps는 보통 첫 번째 characteristic이 데이터 채널
            if (chars.length > 0) {
              characteristic = chars[0];
              if (!controlPointChar) {
                // Control Point를 별도로 찾기
                const controlChar = chars.find(c => c.uuid === UUIDS.CYCLEOPS_CONTROL);
                if (controlChar) controlPointChar = controlChar;
              }
              if (realProtocol === 'UNKNOWN') realProtocol = 'CYCLEOPS';
              console.log('✅ CycleOps 데이터 채널 발견');
              break;
            }
          } catch (e) {}
        }
      }
    }
    
    // 여전히 데이터 채널이 없으면 CPS에서 찾기
    if (!characteristic) {
      for (const svcInfo of availableServices) {
        if (svcInfo.type === 'CPS') {
          try {
            characteristic = await svcInfo.service.getCharacteristic(UUIDS.CPS_DATA);
            service = svcInfo.service;
            if (realProtocol === 'UNKNOWN') realProtocol = 'CPS';
            console.log('✅ CPS 데이터 채널 발견');
            break;
          } catch (e) {}
        }
      }
    }
    
    // 최후의 수단: CSC
    if (!characteristic) {
      for (const svcInfo of availableServices) {
        if (svcInfo.type === 'CSC') {
          try {
            characteristic = await svcInfo.service.getCharacteristic(0x2A5B);
            service = svcInfo.service;
            if (realProtocol === 'UNKNOWN') realProtocol = 'CSC';
            console.log('✅ CSC 데이터 채널 발견');
            break;
          } catch (e) {}
        }
      }
    }
    
    // ★ [핵심] 구형 CycleOps 기기: CPS 데이터 + CycleOps Control Point 조합
    // Mywoosh/ZWIFT 방식: CPS로 데이터를 받되, CycleOps Control Point로 제어
    if (characteristic && !controlPointChar) {
      console.log('[connectTrainer] Control Point 재탐색 중...');
      for (const svcInfo of availableServices) {
        if (svcInfo.type === 'CYCLEOPS') {
          try {
            const chars = await svcInfo.service.getCharacteristics();
            const controlChar = chars.find(c => 
              c.uuid === UUIDS.CYCLEOPS_CONTROL || 
              c.uuid.toLowerCase() === UUIDS.CYCLEOPS_CONTROL.toLowerCase()
            );
            if (controlChar) {
              controlPointChar = controlChar;
              if (realProtocol === 'CPS') realProtocol = 'CYCLEOPS'; // CPS 데이터 + CycleOps 제어
              console.log('✅ CycleOps Control Point 발견 (CPS 데이터와 조합)');
              break;
            }
          } catch (e) {
            console.warn('CycleOps Control Point 탐색 실패:', e);
          }
        }
      }
    }

    if (!characteristic) throw new Error("데이터 서비스를 찾을 수 없습니다.");

    await characteristic.startNotifications();
    
    // 데이터 파서 연결 - realProtocol에 따라 적절한 파서 선택
    const parser = (realProtocol === 'FTMS') ? handleTrainerData : handlePowerMeterData;
    characteristic.addEventListener("characteristicvaluechanged", parser);

    const name = (device.name || "").toUpperCase();
    let fakeProtocol = realProtocol;
    if (name.includes("CYCLEOPS") || name.includes("HAMMER") || name.includes("SARIS") || realProtocol === 'CYCLEOPS' || realProtocol === 'WAHOO') {
        fakeProtocol = 'FTMS'; 
    }

    window.connectedDevices.trainer = { 
      name: device.name, device, server, characteristic,
      controlPoint: controlPointChar,
      protocol: fakeProtocol,
      realProtocol: realProtocol
    };

    if (typeof updateErgModeUI === 'function') updateErgModeUI(!!controlPointChar);
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));
    
    updateDevicesList();
    showConnectionStatus(false);
    
    // 연결 상태 메시지 개선
    const ergMsg = controlPointChar ? "(ERG 제어 가능)" : "(파워미터 모드 - 제어 불가)";
    const protocolMsg = realProtocol !== 'UNKNOWN' ? `[${realProtocol}]` : '';
    showToast(`✅ ${device.name} 연결 ${protocolMsg} ${ergMsg}`);
    
    // 디버그 정보 출력
    console.log('[connectTrainer] 최종 연결 정보:', {
      name: device.name,
      protocol: realProtocol,
      hasControlPoint: !!controlPointChar,
      hasDataChannel: !!characteristic,
      controlPointUUID: controlPointChar?.uuid,
      dataChannelUUID: characteristic?.uuid
    });

  } catch (err) {
    showConnectionStatus(false);
    console.error(err);
    alert("❌ 연결 실패: " + err.message);
  }
}

// ── [4] 심박/파워미터 ──

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

window.setTargetPower = function(targetWatts) {
    if (window.ergController) {
        window.ergController.setTargetPower(targetWatts);
    } else {
        console.warn("ErgController not found!");
    }
};

// ── [6] 데이터 처리 (★ 핵심 수정 부분) ──

/**
 * FTMS (Indoor Bike Data 0x2AD2) 표준 파서
 * 수정 내용: Instantaneous Speed는 Flag와 무관하게 필수 필드이므로 항상 Offset을 증가시켜야 함.
 * 수정 내용: Cadence는 uint8이 아니라 uint16이며 0.5 RPM 해상도임.
 */
function handleTrainerData(e) {
  const dv = e.target.value;
  if (dv.byteLength < 4) return; // 최소 Flags(2) + Speed(2)

  let off = 0;
  const flags = dv.getUint16(off, true); 
  off += 2; // Flags

  // 1. Instantaneous Speed (MANDATORY in FTMS 2AD2)
  // 대부분의 표준 FTMS 기기에서 속도 값은 플래그 비트 0 여부와 상관없이 Flags 바로 뒤에 옵니다.
  // (Uint16, 0.01 km/h)
  off += 2;

  // 2. Average Speed (Optional, Flag Bit 1: 0x0002)
  if (flags & 0x0002) {
    off += 2;
  }

  // 3. Instantaneous Cadence (Optional, Flag Bit 2: 0x0004)
  if (flags & 0x0004) {
    // FTMS 표준: Cadence는 Uint16, 단위 0.5 RPM
    const cadenceRaw = dv.getUint16(off, true);
    off += 2;
    
    const rpm = Math.round(cadenceRaw * 0.5);
    if (rpm >= 0 && rpm <= 250) {
      window.liveData.cadence = rpm;
      notifyChildWindows('cadence', rpm);
      window._lastCadenceUpdateTime['trainer'] = Date.now();
    }
  }

  // 4. Average Cadence (Optional, Flag Bit 3: 0x0008)
  if (flags & 0x0008) {
    off += 2;
  }

  // 5. Total Distance (Optional, Flag Bit 4: 0x0010)
  if (flags & 0x0010) {
    off += 3; // Uint24
  }

  // 6. Resistance Level (Optional, Flag Bit 5: 0x0020)
  if (flags & 0x0020) {
    off += 2;
  }

  // 7. Instantaneous Power (Optional, Flag Bit 6: 0x0040)
  if (flags & 0x0040) {
    const p = dv.getInt16(off, true);
    off += 2;
    if (!Number.isNaN(p)) {
      window.liveData.power = p;
      // 3초 평균 파워 계산을 위한 버퍼에 추가
      if (typeof window.addPowerToBuffer === 'function') {
        window.addPowerToBuffer(p);
      }
      notifyChildWindows('power', p);
    }
  }
}

/**
 * CPS (Cycling Power Service 0x2A63) 파서
 * 수정 내용: Crank Data(Bit 5) 앞에 있는 Optional 필드들(Balance, Torque 등)을 안전하게 처리.
 */
function handlePowerMeterData(event) {
  const dv = event.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); 
  off += 2;
  
  // 1. Instantaneous Power (Mandatory)
  const instPower = dv.getInt16(off, true); 
  off += 2;
  
  if (!Number.isNaN(instPower)) {
    window.liveData.power = instPower;
    // 3초 평균 파워 계산을 위한 버퍼에 추가
    if (typeof window.addPowerToBuffer === 'function') {
      window.addPowerToBuffer(instPower);
    }
    notifyChildWindows('power', instPower);
  }
  
  // 2. Pedal Power Balance (Optional, Flag Bit 0: 0x01)
  if (flags & 0x0001) {
    off += 1; // 1 byte
  }

  // 3. Accumulated Torque (Optional, Flag Bit 2: 0x04)
  // 참고: CPS 스펙에 따라 0x04가 Accumulated Torque 인 경우가 많음
  if (flags & 0x0004) {
    off += 2;
  }

  // 4. Cumulative Wheel Revolution (Optional, Flag Bit 4: 0x10)
  if (flags & 0x0010) {
    off += 6; // Revs(4) + Time(2)
  }
  
  // 5. Cumulative Crank Revolution (Optional, Flag Bit 5: 0x20)
  if (flags & 0x0020) {
    const cumulativeCrankRevolutions = dv.getUint16(off, true); 
    off += 2;
    const lastCrankEventTime = dv.getUint16(off, true); // 1/1024초 단위
    off += 2;
    
    // 케이던스 계산 로직
    const deviceKey = window.connectedDevices.trainer ? 'trainer' : 'powerMeter';
    const lastData = window._lastCrankData[deviceKey];
    
    if (lastData && lastCrankEventTime !== lastData.lastCrankEventTime) {
      let timeDiff = lastCrankEventTime - lastData.lastCrankEventTime;
      if (timeDiff < 0) timeDiff += 65536; // Overflow 처리
      
      let revDiff = cumulativeCrankRevolutions - lastData.cumulativeCrankRevolutions;
      if (revDiff < 0) revDiff += 65536; // Overflow 처리
      
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
    
    window._lastCrankData[deviceKey] = {
      cumulativeCrankRevolutions,
      lastCrankEventTime,
      timestamp: Date.now()
    };
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
