/* ======================================================
   BLE CONNECTOR (FTMS / Power Meter / Heart Rate)
   v1010-filtered
   - 장치별 검색 필터 분리
   - 불필요한 블루투스 기기 검색 차단
====================================================== */

console.log("🔵 BLE 필터 분리 버전 로드됨");

window.BLEDevices = { trainer: null, powerMeter: null, heartRate: null };
window.liveData = { power: 0, cadence: 0, heartRate: 0, targetPower: 150 };

function checkBLESupport() {
  if (!navigator.bluetooth) {
    alert("⚠️ 이 브라우저는 Bluetooth를 지원하지 않습니다.\nChrome 또는 Edge(HTTPS 환경)에서 실행하세요.");
    return false;
  }
  return true;
}

function updateDeviceListUI() {
  const list = document.getElementById("connectedDevicesList");
  if (!list) return;
  let html = "";
  if (BLEDevices.trainer) html += `🚴 ${BLEDevices.trainer.device.name}<br>`;
  if (BLEDevices.powerMeter) html += `⚡ ${BLEDevices.powerMeter.device.name}<br>`;
  if (BLEDevices.heartRate) html += `❤️ ${BLEDevices.heartRate.device.name}<br>`;
  list.innerHTML = html || "<span class='muted'>연결된 기기가 없습니다.</span>";
}

/* ======================================================
   1️⃣ 스마트 트레이너 연결 (FTMS 전용)
====================================================== */
async function connectTrainer() {
  if (!checkBLESupport()) return;

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: ["fitness_machine"] },
        { namePrefix: "KICKR" },
        { namePrefix: "Wahoo" },
        { namePrefix: "Tacx" },
        { namePrefix: "Elite" },
        { namePrefix: "Stages" }
      ],
      optionalServices: ["device_information", "fitness_machine", "battery_service"],
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("fitness_machine");
    const char = await service.getCharacteristic("indoor_bike_data");

    await char.startNotifications();
    char.addEventListener("characteristicvaluechanged", handleTrainerData);

    BLEDevices.trainer = { device, server, service, char };
    device.addEventListener("gattserverdisconnected", () => {
      BLEDevices.trainer = null;
      updateDeviceListUI();
    });

    updateDeviceListUI();
    alert(`✅ ${device.name} (FTMS) 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 스마트 트레이너 연결 실패: " + err.message);
  }
}

function handleTrainerData(e) {
  const v = e.target.value;
  liveData.power = v.getUint16(2, true);
  liveData.cadence = v.getUint16(4, true) / 2;
  updateTrainingUI();
}

/* ======================================================
   2️⃣ 파워미터 연결 (Cycling Power 전용)
====================================================== */
async function connectPowerMeter() {
  if (!checkBLESupport()) return;

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: ["cycling_power"] },
        { namePrefix: "Assioma" },
        { namePrefix: "Garmin" },
        { namePrefix: "Stages" },
        { namePrefix: "4iiii" }
      ],
      optionalServices: ["cycling_power", "battery_service"],
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("cycling_power");
    const char = await service.getCharacteristic("cycling_power_measurement");

    await char.startNotifications();
    char.addEventListener("characteristicvaluechanged", (e) => {
      const v = e.target.value;
      liveData.power = v.getInt16(2, true);
      updateTrainingUI();
    });

    BLEDevices.powerMeter = { device, server, service, char };
    device.addEventListener("gattserverdisconnected", () => {
      BLEDevices.powerMeter = null;
      updateDeviceListUI();
    });

    updateDeviceListUI();
    alert(`✅ ${device.name} (파워미터) 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 파워미터 연결 실패: " + err.message);
  }
}

/* ======================================================
   3️⃣ 심박계 연결 (Heart Rate 전용)
====================================================== */
async function connectHeartRate() {
  if (!checkBLESupport()) return;

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: ["heart_rate"] },
        { namePrefix: "Polar" },
        { namePrefix: "Garmin" },
        { namePrefix: "Wahoo" },
        { namePrefix: "COOSPO" }
      ],
      optionalServices: ["heart_rate", "battery_service"],
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("heart_rate");
    const hrm = await service.getCharacteristic("heart_rate_measurement");

    await hrm.startNotifications();
    hrm.addEventListener("characteristicvaluechanged", (e) => {
      const val = e.target.value;
      liveData.heartRate = val.getUint8(1);
      updateTrainingUI();
    });

    BLEDevices.heartRate = { device, server, service, hrm };
    device.addEventListener("gattserverdisconnected", () => {
      BLEDevices.heartRate = null;
      updateDeviceListUI();
    });

    updateDeviceListUI();
    alert(`✅ ${device.name} (심박계) 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 심박계 연결 실패: " + err.message);
  }
}

/* ======================================================
   4️⃣ 연결 해제 및 전역 등록
====================================================== */
function disconnectAll() {
  for (const key in BLEDevices) {
    try {
      BLEDevices[key]?.device?.gatt?.disconnect();
    } catch {}
  }
  alert("🔌 모든 BLE 기기 연결 해제됨");
  updateDeviceListUI();
}

window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
window.disconnectAll = disconnectAll;
