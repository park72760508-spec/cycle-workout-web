/* ==========================================================
   BLE Device Manager – Smart Trainer, Power Meter, Heart Rate
   원본(1009V1) 기반 + 목록 필터 강화
========================================================== */

window.connectedDevices = window.connectedDevices || {
  trainer: null,
  powerMeter: null,
  heartRate: null
};


/* ---------- UI 헬퍼 ---------- */
function showConnectionStatus(show) {
  document.getElementById("connectionStatus").classList.toggle("hidden", !show);
}
function updateDevicesList() {
  const list = document.getElementById("connectedDevicesList");
  if (!list) return;
  list.innerHTML = "";

  ["trainer", "powerMeter", "heartRate"].forEach((type) => {
    const d = connectedDevices[type];
    if (d) {
      const div = document.createElement("div");
      div.className = "connected-item";
      div.textContent = `✅ ${type}: ${d.name}`;
      list.appendChild(div);
    }
  });
   // 연결된 기기 카드가 존재하면 요약 카드 보이기
   const summary = document.getElementById("connectedDevicesSummary");
   if (summary) {
     summary.classList.toggle("hidden", list.childElementCount === 0);
   }

}

/* ==========================================================
   1️⃣ Smart Trainer (FTMS/CPS)
========================================================== */
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

    // FTMS 우선, 실패 시 CPS 폴백
    let service, characteristic, isFTMS = false;
    try {
      service = await server.getPrimaryService("fitness_machine");
      characteristic = await service.getCharacteristic("indoor_bike_data");
      isFTMS = true;
    } catch (e) {
      service = await server.getPrimaryService("cycling_power");
      characteristic = await service.getCharacteristic("cycling_power_measurement");
    }

    await characteristic.startNotifications();

    if (isFTMS) {
      characteristic.addEventListener("characteristicvaluechanged", handleTrainerData);
      connectedDevices.trainer = { name: device.name || "Smart Trainer", device, server, characteristic };
    } else {
      characteristic.addEventListener("characteristicvaluechanged", handlePowerMeterData);
      connectedDevices.powerMeter = { name: device.name || "Power Meter", device, server, characteristic };
    }

    device.addEventListener("gattserverdisconnected", () => {
      if (connectedDevices.trainer?.device === device) connectedDevices.trainer = null;
      if (connectedDevices.powerMeter?.device === device) connectedDevices.powerMeter = null;
      updateDevicesList();
    });

    updateDevicesList();
    showConnectionStatus(false);
    alert(`✅ ${device.name || "Trainer"} 연결 성공!`);
  } catch (err) {
    showConnectionStatus(false);
    console.error("트레이너 연결 오류:", err);
    alert("❌ 트레이너 연결 실패: " + err.message);
  }
}

/* ==========================================================
   2️⃣ Power Meter (Cycling Power Service)
========================================================== */
async function connectPowerMeter() {
  try {
    showConnectionStatus(true);

    let device;
    try {
      // 파워미터로 추정되는 장치 우선
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [0x1818] },
          { namePrefix: "4iiii" },
          { namePrefix: "Stages" },
          { namePrefix: "Garmin" },
          { namePrefix: "Favero" },
          { namePrefix: "SRM" },
        ],
        optionalServices: [0x1818, "device_information"],
      });
    } catch {
      // 폴백: 서비스 광고 없는 기기
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [0x1818, "cycling_power", "device_information"],
      });
    }

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(0x1818);
    const ch = await service.getCharacteristic(0x2a63);

    await ch.startNotifications();
    ch.addEventListener("characteristicvaluechanged", handlePowerMeterData);

    connectedDevices.powerMeter = { name: device.name || "Power Meter", device, server, characteristic: ch };
    updateDevicesList();
    showConnectionStatus(false);
    alert(`✅ ${device.name} 연결 성공!`);
  } catch (err) {
    showConnectionStatus(false);
    console.error("파워미터 연결 오류:", err);
    alert("❌ 파워미터 연결 실패: " + err.message);
  }
}

/* ==========================================================
   3️⃣ Heart Rate Monitor (Heart Rate Service)
========================================================== */
async function connectHeartRate() {
  try {
    showConnectionStatus(true);
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["heart_rate"] }],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("heart_rate");
    const ch = await service.getCharacteristic("heart_rate_measurement");
    await ch.startNotifications();
    ch.addEventListener("characteristicvaluechanged", handleHeartRateData);

    connectedDevices.heartRate = { name: device.name || "Heart Rate Monitor", device, server, characteristic: ch };
    /*updateDevicesList();*/
     const device = await connectDevice('heart_rate');
     if (device) {
       updateDevicesList();
       showScreen('profileScreen'); // ✅ 연결 완료 후 다음 단계 이동
     }
     
    showConnectionStatus(false);
    alert(`✅ ${device.name} 연결 성공!`);
  } catch (err) {
    showConnectionStatus(false);
    console.error("심박계 연결 오류:", err);
    alert("❌ 심박계 연결 실패: " + err.message);
  }
}

/* ==========================================================
   데이터 파서
========================================================== */
function handleTrainerData(event) {
  const d = event.target.value;
  // FTMS 데이터 파싱 (간략화 예시)
  const flags = d.getUint16(0, true);
  const power = d.getInt16(2, true);
  window.liveData = { ...(window.liveData || {}), power };
}
function handlePowerMeterData(event) {
  const d = event.target.value;
  const flags = d.getUint16(0, true);
  const power = d.getInt16(2, true);
  window.liveData = { ...(window.liveData || {}), power };
}
function handleHeartRateData(event) {
  const d = event.target.value;
  const hr = d.getUint8(1);
  window.liveData = { ...(window.liveData || {}), heartRate: hr };
  document.getElementById("heartRateValue")?.textContent = hr;
}

/* ==========================================================
   전체 해제
========================================================== */
function disconnectAll() {
  Object.keys(connectedDevices).forEach(async (k) => {
    const dev = connectedDevices[k];
    if (dev?.server?.connected) await dev.server.disconnect();
    connectedDevices[k] = null;
  });
  updateDevicesList();
  alert("🔌 모든 블루투스 기기 연결 해제됨");
}

/* ==========================================================
   버튼 바인딩
========================================================== */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnConnectTrainer")?.addEventListener("click", connectTrainer);
  document.getElementById("btnConnectHR")?.addEventListener("click", connectHeartRate);
  document.getElementById("btnConnectPM")?.addEventListener("click", connectPowerMeter);
});

