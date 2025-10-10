/* ======================================================
   BLE CONNECTOR (FTMS / Power Meter / Heart Rate)
   완전 통합 버전 v1010
   - 원본(1009V1) 구조 복원
   - Chrome/Edge 최신 버전 호환
   - GitHub Pages(HTTPS) 완전 대응
====================================================== */

console.log("🔵 BLE 모듈 로드됨");

// 전역 공유 객체
window.BLEDevices = {
  trainer: null,
  powerMeter: null,
  heartRate: null,
};
window.liveData = {
  power: 0,
  cadence: 0,
  heartRate: 0,
  resistance: 0,
  targetPower: 150,
};

/* ======================================================
   1️⃣ 공통 함수
====================================================== */
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
   2️⃣ 스마트 트레이너 (FTMS + CPS 폴백)
====================================================== */
async function connectTrainer() {
  if (!checkBLESupport()) return;
  console.log("🔍 스마트 트레이너 검색 시작...");

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: ["fitness_machine"] },
        { services: ["cycling_power"] },
        { namePrefix: "KICKR" },
        { namePrefix: "Wahoo" },
        { namePrefix: "Tacx" },
        { namePrefix: "Elite" },
        { namePrefix: "Stages" },
        { namePrefix: "Assioma" }
      ],
      optionalServices: [
        "device_information",
        "fitness_machine",
        "cycling_power",
        "battery_service",
      ],
    });

    const server = await device.gatt.connect();
    console.log(`✅ ${device.name} 연결됨`);

    let service, char, isFTMS = false;
    try {
      service = await server.getPrimaryService("fitness_machine");
      char = await service.getCharacteristic("indoor_bike_data");
      isFTMS = true;
      console.log("📡 FTMS 서비스 연결 성공");
    } catch (e) {
      console.warn("⚠️ FTMS 실패 → CPS 폴백 시도");
      service = await server.getPrimaryService("cycling_power");
      char = await service.getCharacteristic("cycling_power_measurement");
    }

    await char.startNotifications();
    char.addEventListener("characteristicvaluechanged", (e) => handleTrainerData(e, isFTMS));

    BLEDevices.trainer = { device, server, service, char };
    device.addEventListener("gattserverdisconnected", () => {
      BLEDevices.trainer = null;
      updateDeviceListUI();
    });

    updateDeviceListUI();
    alert(`✅ ${device.name} (${isFTMS ? "FTMS" : "CPS"}) 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 스마트 트레이너 연결 실패: " + err.message);
  }
}

function handleTrainerData(event, isFTMS = true) {
  const v = event.target.value;
  if (isFTMS) {
    if (v.byteLength >= 6) {
      liveData.power = v.getUint16(2, true);
      liveData.cadence = v.getUint16(4, true) / 2;
    }
  } else {
    if (v.byteLength >= 4) {
      liveData.power = v.getInt16(2, true);
      liveData.cadence = 0;
    }
  }
  updateTrainingUI();
}

/* ======================================================
   3️⃣ 파워미터 (별도 기기)
====================================================== */
async function connectPowerMeter() {
  if (!checkBLESupport()) return;
  console.log("⚡ 파워미터 연결 시작...");

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["cycling_power"] }],
      optionalServices: ["battery_service"],
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
   4️⃣ 심박계 (HRM)
====================================================== */
async function connectHeartRate() {
  if (!checkBLESupport()) return;
  console.log("❤️ 심박계 연결 시작...");

  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ["heart_rate", "battery_service", "device_information"]
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
    alert(`✅ ${device.name || "심박계"} 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 심박계 연결 실패: " + err.message);
  }
}

/* ======================================================
   5️⃣ 공통 제어 (해제 / 업데이트)
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

// 전역 등록 (HTML 버튼에서 직접 호출 가능)
window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
window.disconnectAll = disconnectAll;
window.updateDeviceListUI = updateDeviceListUI;
