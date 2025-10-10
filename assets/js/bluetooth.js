/* ==========================================================
   bluetooth.js (v1.2 stable)
   - 전역 상태 window.connectedDevices 로 통일
   - 연결 성공 시 showScreen('profileScreen')로 전환
   - startNotifications 이후에 updateDevicesList 호출
   - 오류/종료 시 showConnectionStatus(false) 보장
   - beforeunload에서 안전 disconnect
========================================================== */

// 전역 상태 단일화
window.connectedDevices = window.connectedDevices || {
  trainer: null,
  powerMeter: null,
  heartRate: null,
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
window.updateDevicesList = window.updateDevicesList || function () {
  const deviceList = document.getElementById("connectedDevicesList");
  const summary = document.getElementById("connectedDevicesSummary");
  const summaryList = document.getElementById("connectedDevicesList");
  if (!deviceList || !summary || !summaryList) return;

  let html = "";
  let count = 0;

  if (connectedDevices.trainer) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon">🚴‍♂️</div>
          <div class="device-details"><h3>${connectedDevices.trainer.name || "Smart Trainer"}</h3>
          <p>Smart Trainer (FTMS)</p></div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }
  if (connectedDevices.powerMeter) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon">⚡</div>
          <div class="device-details"><h3>${connectedDevices.powerMeter.name || "Power Meter"}</h3>
          <p>Crank Power (CPS)</p></div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }
  if (connectedDevices.heartRate) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon" style="background:#DC3545;">❤️</div>
          <div class="device-details"><h3>${connectedDevices.heartRate.name || "Heart Rate"}</h3>
          <p>Heart Rate (HRS)</p></div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }

  deviceList.innerHTML = html;
  if (count > 0) {
    summaryList.innerHTML = html;
    summary.classList.remove("hidden");
  } else {
    summary.classList.add("hidden");
  }
};

// 비차단 토스트
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.classList.remove("hidden");         // ✅ 중요: 숨김 해제
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}


// 화면 전환 (app.js에 이미 있으면 중복 선언 금지)
window.showScreen = window.showScreen || function (id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
};

// ──────────────────────────────────────────────────────────
// 1) Smart Trainer (FTMS → CPS 폴백)
// ──────────────────────────────────────────────────────────
async function connectTrainer() {
  try {
    showConnectionStatus(true);

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: ["fitness_machine"] },
        { services: ["cycling_power"] },
        { namePrefix: "KICKR" },
        { namePrefix: "Wahoo" },
        { namePrefix: "Tacx" },
      ],
      optionalServices: ["fitness_machine", "cycling_power", "device_information"],
    });

    const server = await device.gatt.connect();

    let service, characteristic, isFTMS = false;
    try {
      service = await server.getPrimaryService("fitness_machine");
      characteristic = await service.getCharacteristic("indoor_bike_data");
      isFTMS = true;
    } catch {
      service = await server.getPrimaryService("cycling_power");
      characteristic = await service.getCharacteristic("cycling_power_measurement");
    }

    await characteristic.startNotifications(); // ✅ 이후에 목록 갱신
    characteristic.addEventListener("characteristicvaluechanged",
      isFTMS ? handleTrainerData : handlePowerMeterData
    );

    if (isFTMS) {
      connectedDevices.trainer = { name: device.name || "Smart Trainer", device, server, characteristic };
    } else {
      connectedDevices.powerMeter = { name: device.name || "Power Meter", device, server, characteristic };
    }

    device.addEventListener("gattserverdisconnected", () => {
      try {
        if (connectedDevices.trainer?.device === device) connectedDevices.trainer = null;
        if (connectedDevices.powerMeter?.device === device) connectedDevices.powerMeter = null;
        updateDevicesList();
      } catch (e) { console.warn(e); }
    });

    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "Trainer"} 연결 성공`);
    showScreen("profileScreen"); // ✅ 연결 후 다음 단계로
  } catch (err) {
    showConnectionStatus(false);
    console.error("트레이너 연결 오류:", err);
    showToast("❌ 트레이너 연결 실패: " + err.message);
  }
}

// ──────────────────────────────────────────────────────────
// 2) Power Meter (CPS)
// ──────────────────────────────────────────────────────────
async function connectPowerMeter() {
  try {
    showConnectionStatus(true);

    // 우선 서비스 필터, 광고 누락 기기 대응 acceptAllDevices 폴백
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["cycling_power"] }],
        optionalServices: ["device_information"],
      });
    } catch {
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["cycling_power", "device_information"],
      });
    }

    const server = await device.gatt.connect();
    const service = await (async () => {
      try { return await server.getPrimaryService("cycling_power"); }
      catch { return await server.getPrimaryService(0x1818); }
    })();
    const ch = await (async () => {
      try { return await service.getCharacteristic("cycling_power_measurement"); }
      catch { return await service.getCharacteristic(0x2A63); }
    })();

    await ch.startNotifications(); // ✅ 이후 갱신
    ch.addEventListener("characteristicvaluechanged", handlePowerMeterData);

    connectedDevices.powerMeter = { name: device.name || "Power Meter", device, server, characteristic: ch };

    device.addEventListener("gattserverdisconnected", () => {
      if (connectedDevices.powerMeter?.device === device) connectedDevices.powerMeter = null;
      updateDevicesList();
    });

    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "Power Meter"} 연결 성공`);
    showScreen("profileScreen");
  } catch (err) {
    showConnectionStatus(false);
    console.error("파워미터 연결 오류:", err);
    showToast("❌ 파워미터 연결 실패: " + err.message);
  }
}

// ──────────────────────────────────────────────────────────
// 3) Heart Rate (HRS)
// ──────────────────────────────────────────────────────────
async function connectHeartRate() {
  console.log("=== connectHeartRate START ===");
  
  try {
    showConnectionStatus(true);
    showToast("심박계를 검색하고 있습니다...");
    
    let device;
    try {
      console.log("1. Requesting device with heart_rate filter...");
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }],
        optionalServices: ["heart_rate", "device_information"],
      });
      console.log("2. Device selected:", device.name);
    } catch (err) {
      console.log("3. First attempt failed:", err.message);
      console.log("4. Trying acceptAllDevices...");
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["heart_rate", "device_information"],
      });
      console.log("5. Device selected (all):", device.name);
    }

    console.log("6. Connecting to GATT server...");
    const server = await device.gatt.connect();
    console.log("7. GATT connected!");
    
    console.log("8. Getting heart_rate service...");
    const service = await server.getPrimaryService("heart_rate");
    console.log("9. Service found!");
    
    console.log("10. Getting heart_rate_measurement characteristic...");
    const ch = await service.getCharacteristic("heart_rate_measurement");
    console.log("11. Characteristic found!");

    console.log("12. Starting notifications...");
    await ch.startNotifications();
    console.log("13. Notifications started!");
    
    ch.addEventListener("characteristicvaluechanged", handleHeartRateData);

    connectedDevices.heartRate = { 
      name: device.name || "Heart Rate", 
      device, 
      server, 
      characteristic: ch 
    };

    device.addEventListener("gattserverdisconnected", () => {
      console.log("Device disconnected");
      if (connectedDevices.heartRate?.device === device) {
        connectedDevices.heartRate = null;
      }
      updateDevicesList();
    });

    console.log("14. Updating devices list...");
    updateDevicesList();
    
    console.log("15. Hiding connection status...");
    showConnectionStatus(false);
    
    console.log("16. Showing success toast...");
    showToast(`✅ ${device.name || "HR"} 연결 성공`);
    
    console.log("17. Showing profile screen...");
    showScreen("profileScreen");
    
    console.log("=== connectHeartRate SUCCESS ===");
  } catch (err) {
    console.error("=== connectHeartRate ERROR ===");
    console.error("Error details:", err);
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    
    showConnectionStatus(false);
    showToast("❌ 심박계 연결 실패: " + err.message);
  }
}

// ──────────────────────────────────────────────────────────
// BLE 데이터 파서 (기존 함수명/로직 유지해도 OK)
// ──────────────────────────────────────────────────────────
window.handleTrainerData = window.handleTrainerData || function (event) {
  // FTMS indoor_bike_data 해석 (필요 최소만 유지)
  const dv = event.target.value;
  const flags = dv.getUint16(0, true);
  let off = 2;

  // cadence (bit2)
  if (flags & 0x0004) {
    const cadence = dv.getUint16(off, true) * 0.5; off += 2;
    window.liveData = window.liveData || {};
    window.liveData.cadence = Math.round(cadence);
  }
  // power (bit6)
  if (flags & 0x0040) {
    const power = dv.getInt16(off, true); // signed
    window.liveData = window.liveData || {};
    window.liveData.power = Math.round(power);
  }
  if (window.updateTrainingDisplay) window.updateTrainingDisplay();
};

window.handlePowerMeterData = window.handlePowerMeterData || function (event) {
  const dv = event.target.value;
  let off = 0;
  const flags = dv.getUint16(off, true); off += 2;
  const instPower = dv.getInt16(off, true); off += 2;

  window.liveData = window.liveData || {};
  window.liveData.power = Math.round(instPower);

  // crank rev (bit5) → cadence 추정
  if (flags & (1 << 5)) {
    const crankRevs = dv.getUint16(off, true); off += 2;
    const lastCrankTime = dv.getUint16(off, true); off += 2; // 1/1024s
    // 간단화: 최신 두 포인트 간 속도로 RPM 추정 (상태 저장 필요 시 app.js로 이동)
  }

  if (window.updateTrainingDisplay) window.updateTrainingDisplay();
};

window.handleHeartRateData = window.handleHeartRateData || function (event) {
  const dv = event.target.value;
  const flags = dv.getUint8(0);
  const hr = (flags & 0x1) ? dv.getUint16(1, true) : dv.getUint8(1);
  window.liveData = window.liveData || {};
  window.liveData.heartRate = Math.round(hr);
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

// 전역 export
window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
