/* ==========================================================
   bluetooth.js (v4.0 Dual-Channel Architecture)
   - Dual-Channel: Data (Read) and Control (Write) discovered independently
   - Data: FTMS Data → CPS → Legacy; Control: FTMS Control → CycleOps 0x42 → Wahoo 0x42
   - Bluefy/iOS: optionalServices comprehensive; per-service try-catch for discovery
   - Mobile: GATT timeout handling; no platform-specific blocking (Bluefy-safe)
   - Legacy hybrid: CPS data + Legacy Control (CycleOps/Wahoo) fully supported
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
  CPS_CONTROL:  '00002a66-0000-1000-8000-00805f9b34fb', // Cycling Power Control Point
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

// ── [3] 스마트 트레이너 연결 (Dual-Channel Architecture) ──

/** Bluefy-safe: get primary service; returns null on failure (no throw). */
async function _safeGetService(server, serviceUuid) {
  try {
    return await server.getPrimaryService(serviceUuid);
  } catch (_) {
    return null;
  }
}

/** Bluefy-safe: get characteristic; returns null on failure. */
async function _safeGetChar(service, charUuid) {
  if (!service) return null;
  try {
    return await service.getCharacteristic(charUuid);
  } catch (_) {
    return null;
  }
}

async function connectTrainer() {
  try {
    showConnectionStatus(true);
    let device;
    console.log('[connectTrainer] Universal Scan (Dual-Channel) 시작...');

    const filters = [
      { services: [UUIDS.FTMS_SERVICE] },
      { services: [UUIDS.CPS_SERVICE] },
      { namePrefix: "CycleOps" },
      { namePrefix: "Hammer" },
      { namePrefix: "Saris" },
      { namePrefix: "Magnus" },
      { namePrefix: "KICKR" },
      { namePrefix: "Wahoo" }
    ];

    // Bluefy/iOS: optionalServices must list every service we might access after connect.
    // If a service is not in this list, getPrimaryService() can throw SecurityError on Bluefy.
    // Listing all trainer-related services here ensures the device picker shows compatible devices
    // and post-connect discovery is allowed. Per-service try-catch handles devices that don't advertise all of these.
    const optionalServices = [
      UUIDS.FTMS_SERVICE,
      UUIDS.CPS_SERVICE,
      UUIDS.CSC_SERVICE,
      UUIDS.CYCLEOPS_SERVICE,
      UUIDS.WAHOO_SERVICE,
      UUIDS.TACX_SERVICE,
      'device_information'
    ];

    try {
      device = await navigator.bluetooth.requestDevice({ filters, optionalServices });
    } catch (scanErr) {
      showConnectionStatus(false);
      if (scanErr.name !== 'NotFoundError') alert("❌ 검색 오류: " + scanErr.message);
      return;
    }

    let server;
    try {
      server = await device.gatt.connect();
    } catch (connErr) {
      showConnectionStatus(false);
      console.error('[connectTrainer] GATT connect failed (timeout common on mobile):', connErr);
      alert("❌ 연결 실패 (타임아웃). 기기를 가까이에서 다시 시도해 주세요.");
      return;
    }
    console.log('[connectTrainer] GATT 연결 성공. 채널 탐색 중...');

    const deviceName = (device.name || "").toUpperCase();
    const isCycleOpsDevice = deviceName.includes("CYCLEOPS") || deviceName.includes("HAMMER") ||
                             deviceName.includes("SARIS") || deviceName.includes("MAGNUS");
    const isWahooDevice = deviceName.includes("KICKR") || deviceName.includes("WAHOO");

    // ─── Channel Discovery: each in try-catch (Bluefy-safe) ───
    // [1] Data Channel: FTMS Data → CPS → Legacy (CycleOps first char) → CSC
    let dataChar = null;
    let dataSource = 'UNKNOWN'; // 'FTMS' | 'CPS' | 'CYCLEOPS' | 'WAHOO' | 'CSC'

    try {
      const ftmsSvc = await _safeGetService(server, UUIDS.FTMS_SERVICE);
      if (ftmsSvc) {
        dataChar = await _safeGetChar(ftmsSvc, UUIDS.FTMS_DATA);
        if (dataChar) {
          dataSource = 'FTMS';
          console.log('✅ [Data] FTMS Data 채널 발견');
        }
      }
    } catch (e) {
      console.warn('[connectTrainer] FTMS Data 탐색 실패:', e.message);
    }

    if (!dataChar) {
      try {
        const cpsSvc = await _safeGetService(server, UUIDS.CPS_SERVICE);
        if (cpsSvc) {
          dataChar = await _safeGetChar(cpsSvc, UUIDS.CPS_DATA);
          if (dataChar) {
            dataSource = 'CPS';
            console.log('✅ [Data] CPS 데이터 채널 발견');
          }
        }
      } catch (e) {
        console.warn('[connectTrainer] CPS Data 탐색 실패:', e.message);
      }
    }

    if (!dataChar) {
      try {
        const cycleOpsSvc = await _safeGetService(server, UUIDS.CYCLEOPS_SERVICE);
        if (cycleOpsSvc) {
          const chars = await cycleOpsSvc.getCharacteristics();
          if (chars.length > 0) {
            const dataC = chars.find(c => {
              const u = (c.uuid || '').toLowerCase();
              return u !== UUIDS.CYCLEOPS_CONTROL.toLowerCase() && u !== UUIDS.WAHOO_CONTROL.toLowerCase();
            }) || chars[0];
            dataChar = dataC;
            dataSource = 'CYCLEOPS';
            console.log('✅ [Data] Legacy (CycleOps) 데이터 채널 발견');
          }
        }
      } catch (e) {
        console.warn('[connectTrainer] CycleOps Data 탐색 실패:', e.message);
      }
    }

    if (!dataChar) {
      try {
        const wahooSvc = await _safeGetService(server, UUIDS.WAHOO_SERVICE);
        if (wahooSvc) {
          const chars = await wahooSvc.getCharacteristics();
          const readChar = chars.find(c => (c.properties?.notify || c.properties?.read));
          if (readChar) {
            dataChar = readChar;
            dataSource = 'WAHOO';
            console.log('✅ [Data] Legacy (Wahoo) 데이터 채널 발견');
          }
        }
      } catch (e) {
        console.warn('[connectTrainer] Wahoo Data 탐색 실패:', e.message);
      }
    }

    if (!dataChar) {
      try {
        const cscSvc = await _safeGetService(server, UUIDS.CSC_SERVICE);
        if (cscSvc) {
          dataChar = await _safeGetChar(cscSvc, '00002a5b-0000-1000-8000-00805f9b34fb');
          if (dataChar) {
            dataSource = 'CSC';
            console.log('✅ [Data] CSC 데이터 채널 발견');
          }
        }
      } catch (e) {
        console.warn('[connectTrainer] CSC Data 탐색 실패:', e.message);
      }
    }

    if (!dataChar) {
      showConnectionStatus(false);
      throw new Error("데이터 채널을 찾을 수 없습니다.");
    }

    // [2] Control Channel: FTMS Control → CycleOps 0x42 → Wahoo 0x42 (independent of Data; do not stop if Data is CPS)
    let controlChar = null;
    let controlProtocol = null; // 'FTMS' | 'CYCLEOPS' | 'WAHOO'

    try {
      const ftmsSvc = await _safeGetService(server, UUIDS.FTMS_SERVICE);
      if (ftmsSvc) {
        controlChar = await _safeGetChar(ftmsSvc, UUIDS.FTMS_CONTROL);
        if (controlChar) {
          controlProtocol = 'FTMS';
          console.log('✅ [Control] FTMS Control Point 발견');
        }
      }
    } catch (e) {
      console.warn('[connectTrainer] FTMS Control 탐색 실패:', e.message);
    }

    if (!controlChar) {
      try {
        const cycleOpsSvc = await _safeGetService(server, UUIDS.CYCLEOPS_SERVICE);
        if (cycleOpsSvc) {
          controlChar = await _safeGetChar(cycleOpsSvc, UUIDS.CYCLEOPS_CONTROL);
          if (controlChar) {
            controlProtocol = 'CYCLEOPS';
            console.log('✅ [Control] CycleOps Legacy (0x42) Control Point 발견');
          }
        }
      } catch (e) {
        console.warn('[connectTrainer] CycleOps Control 탐색 실패:', e.message);
      }
    }

    if (!controlChar) {
      try {
        const wahooSvc = await _safeGetService(server, UUIDS.WAHOO_SERVICE);
        if (wahooSvc) {
          controlChar = await _safeGetChar(wahooSvc, UUIDS.WAHOO_CONTROL);
          if (controlChar) {
            controlProtocol = 'WAHOO';
            console.log('✅ [Control] Wahoo Legacy (0x42) Control Point 발견');
          }
        }
      } catch (e) {
        console.warn('[connectTrainer] Wahoo Control 탐색 실패:', e.message);
      }
    }

    // Force Legacy Control search when Data is CPS (hybrid: CPS data + Legacy control)
    if (!controlChar && dataSource === 'CPS' && (isCycleOpsDevice || isWahooDevice)) {
      try {
        const cycleOpsSvc = await _safeGetService(server, UUIDS.CYCLEOPS_SERVICE);
        if (cycleOpsSvc) {
          const chars = await cycleOpsSvc.getCharacteristics();
          const cp = chars.find(c => (c.uuid || '').toLowerCase().includes('347b0012') || (c.properties?.write || c.properties?.writeWithoutResponse));
          if (cp) {
            controlChar = cp;
            controlProtocol = 'CYCLEOPS';
            console.log('✅ [Control] CPS+CycleOps hybrid: Legacy Control 발견');
          }
        }
      } catch (e) {
        console.warn('[connectTrainer] Legacy Control (CPS hybrid) 탐색 실패:', e.message);
      }
      if (!controlChar) {
        try {
          const wahooSvc = await _safeGetService(server, UUIDS.WAHOO_SERVICE);
          if (wahooSvc) {
            const chars = await wahooSvc.getCharacteristics();
            const cp = chars.find(c => (c.uuid || '').toLowerCase().includes('a026e005') || (c.properties?.write || c.properties?.writeWithoutResponse));
            if (cp) {
              controlChar = cp;
              controlProtocol = 'WAHOO';
              console.log('✅ [Control] CPS+Wahoo hybrid: Legacy Control 발견');
            }
          }
        } catch (e) {
          console.warn('[connectTrainer] Wahoo hybrid Control 탐색 실패:', e.message);
        }
      }
    }

    const realProtocol = controlProtocol || dataSource;
    const isLegacyControl = controlProtocol === 'CYCLEOPS' || controlProtocol === 'WAHOO';
    const fakeProtocol = isLegacyControl ? 'FTMS' : realProtocol;

    await dataChar.startNotifications();
    const parser = (dataSource === 'FTMS') ? handleTrainerData : handlePowerMeterData;
    dataChar.addEventListener("characteristicvaluechanged", parser);

    window.connectedDevices.trainer = {
      name: device.name,
      device,
      server,
      characteristic: dataChar,
      controlPoint: controlChar,
      protocol: fakeProtocol,
      realProtocol: realProtocol
    };

    var anyConnected = !!(window.connectedDevices?.heartRate || window.connectedDevices?.trainer || window.connectedDevices?.powerMeter);
    window.isSensorConnected = anyConnected;
    try {
      window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: anyConnected, deviceType: 'trainer' } }));
    } catch (e) {
      console.warn('[BLE] dispatchEvent stelvio-sensor-update failed:', e);
    }

    if (typeof updateErgModeUI === 'function') updateErgModeUI(!!controlChar);
    device.addEventListener("gattserverdisconnected", () => handleDisconnect('trainer', device));

    updateDevicesList();
    showConnectionStatus(false);

    const ergMsg = controlChar ? "(ERG 제어 가능)" : "(파워미터 모드 - 제어 불가)";
    const protocolMsg = realProtocol !== 'UNKNOWN' ? `[${realProtocol}]` : '';
    if (isCycleOpsDevice && !controlChar && dataSource === 'CPS') {
      console.warn('[connectTrainer] CycleOps 기기이지만 Control Point 미발견. ERG 제어 불가.');
    }
    showToast(`✅ ${device.name} 연결 ${protocolMsg} ${ergMsg}`);

    console.log('[connectTrainer] Dual-Channel 결과:', {
      name: device.name,
      dataSource,
      controlProtocol,
      realProtocol,
      hasControlPoint: !!controlChar,
      hasDataChannel: !!dataChar
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
    
    // [Event-Driven Architecture] 센서 연결 상태 전역 이벤트 dispatch
    var anyConnected = !!(window.connectedDevices?.heartRate || window.connectedDevices?.trainer || window.connectedDevices?.powerMeter);
    window.isSensorConnected = anyConnected;
    try {
      window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: anyConnected, deviceType: 'heartRate' } }));
      console.log('[Mobile Debug] [BLE] stelvio-sensor-update dispatched: heartRate connected, isSensorConnected =', anyConnected);
    } catch (e) {
      console.warn('[BLE] dispatchEvent stelvio-sensor-update failed:', e);
    }
    
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
    
    // [Event-Driven Architecture] 센서 연결 상태 전역 이벤트 dispatch
    var anyConnected = !!(window.connectedDevices?.heartRate || window.connectedDevices?.trainer || window.connectedDevices?.powerMeter);
    window.isSensorConnected = anyConnected;
    try {
      window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: anyConnected, deviceType: 'powerMeter' } }));
      console.log('[Mobile Debug] [BLE] stelvio-sensor-update dispatched: powerMeter connected, isSensorConnected =', anyConnected);
    } catch (e) {
      console.warn('[BLE] dispatchEvent stelvio-sensor-update failed:', e);
    }
    
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
    
    // [Event-Driven Architecture] 센서 연결 해제 시 전역 이벤트 dispatch
    var anyConnected = !!(window.connectedDevices?.heartRate || window.connectedDevices?.trainer || window.connectedDevices?.powerMeter);
    window.isSensorConnected = anyConnected;
    try {
      window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: anyConnected, deviceType: type, action: 'disconnected' } }));
      console.log('[Mobile Debug] [BLE] stelvio-sensor-update dispatched: ' + type + ' disconnected, isSensorConnected =', anyConnected);
    } catch (e) {
      console.warn('[BLE] dispatchEvent stelvio-sensor-update failed:', e);
    }
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
// 케이던스 타임아웃 체크 (0 표시 오류 개선: 타임아웃을 더 길게 설정)
setInterval(() => {
    const now = Date.now();
    if (window.liveData.cadence > 0) {
        const lastT = window._lastCadenceUpdateTime.trainer || 0;
        const lastP = window._lastCadenceUpdateTime.powerMeter || 0;
        // 5초로 연장하여 일시적인 데이터 누락 시 0으로 표시되지 않도록 개선
        if (now - Math.max(lastT, lastP) > 5000) {
            window.liveData.cadence = 0;
            notifyChildWindows('cadence', 0);
        }
    }
}, 1000);

window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
