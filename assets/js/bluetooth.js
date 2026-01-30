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
  try {
    showConnectionStatus(true);
    console.log('[connectTrainer] ZWIFT-Class Scan (Dual-Channel) Started...');

    // 1. Broad Filters
    const filters = [
      { services: [UUIDS.FTMS_SERVICE] },
      { services: [UUIDS.CPS_SERVICE] },
      { namePrefix: "CycleOps" }, { namePrefix: "Hammer" }, { namePrefix: "Saris" },
      { namePrefix: "Wahoo" }, { namePrefix: "KICKR" }, { namePrefix: "Tacx" }
    ];

    // 2. Comprehensive Optional Services (Critical for iOS/Bluefy - Legacy visibility)
    const optionalServices = [
      UUIDS.FTMS_SERVICE, UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE,
      UUIDS.CYCLEOPS_SERVICE, UUIDS.WAHOO_SERVICE, UUIDS.TACX_SERVICE,
      'device_information', 'battery_service'
    ];
    COMPREHENSIVE_ERG_OPTIONAL_SERVICES.forEach(function (uuid) {
      if (optionalServices.indexOf(uuid) === -1) optionalServices.push(uuid);
    });

    let device;
    try {
        device = await navigator.bluetooth.requestDevice({ filters, optionalServices });
    } catch (e) {
        showConnectionStatus(false);
        return;
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
    
    updateDevicesList();
    showConnectionStatus(false);
    
    let statusMsg = `✅ ${device.name} 연결됨 [${dataProtocol}]`;
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
      window.liveData.power = p;
      // ★ 3-Second Power Buffer Logic (Preserved)
      if (typeof window.addPowerToBuffer === 'function') window.addPowerToBuffer(p);
      if(window.ergController) window.ergController.updatePower(p);
      notifyChildWindows('power', p);
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
    window.isSensorConnected = true;
    try { window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: true, deviceType: 'heartRate' } })); } catch (e) {}
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
    let device = await navigator.bluetooth.requestDevice({ 
        filters: [{ services: [UUIDS.CPS_SERVICE] }, { services: [UUIDS.CSC_SERVICE] }], 
        optionalServices: [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE] 
    });
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
    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name} 연결 성공`);
  } catch (err) {
    showConnectionStatus(false);
    alert("파워미터 오류: " + err.message);
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
  if (window.connectedDevices[type]?.device === device) {
    window.connectedDevices[type] = null;
    if (type === 'trainer' && typeof updateErgModeUI === 'function') updateErgModeUI(false);
    const anyConnected = !!(window.connectedDevices?.heartRate || window.connectedDevices?.trainer || window.connectedDevices?.powerMeter);
    window.isSensorConnected = anyConnected;
    try { window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: anyConnected, deviceType: type, action: 'disconnected' } })); } catch (e) {}
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
