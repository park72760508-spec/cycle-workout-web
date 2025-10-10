/* ======================================================
   BLE 연결 제어 (FTMS / Power Meter / Heart Rate)
   cycle_workout_web_ble_full_v1009
   복원 버전 - 원본(1009V1) 기준 + 확장형 호환
====================================================== */

const BLEDevices = {
  trainer: null,
  powerMeter: null,
  heartRate: null,
};

const liveData = {
  power: 0,
  cadence: 0,
  heartRate: 0,
  resistance: 0,
  targetPower: 150,
};

/* -----------------------------
   지원 여부 확인
------------------------------ */
function checkBLESupport() {
  if (!navigator.bluetooth) {
    alert("⚠️ 이 브라우저는 Bluetooth를 지원하지 않습니다.\nChrome / Edge (HTTPS 환경) 에서 사용하세요.");
    return false;
  }
  return true;
}

/* ======================================================
   ① 스마트로라 (FTMS + CPS 폴백)
====================================================== */
async function connectTrainer() {
  if (!checkBLESupport()) return;

  try {
    console.log("🔍 스마트로라 검색 시작...");
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
    console.log("✅ BLE 연결됨:", device.name);

    let service, characteristic, isFTMS = false;

    try {
      // FTMS 우선 시도
      service = await server.getPrimaryService("fitness_machine");
      characteristic = await service.getCharacteristic("indoor_bike_data");
      isFTMS = true;
      console.log("📡 FTMS 모드로 연결됨");
    } catch (e) {
      // CPS (Cycling Power) 폴백
      console.log("⚠️ FTMS 실패, CPS 모드로 폴백 시도");
      service = await server.getPrimaryService("cycling_power");
      characteristic = await service.getCharacteristic("cycling_power_measurement");
      isFTMS = false;
    }

    // 데이터 수신 이벤트
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      handleTrainerData(event, isFTMS);
    });

    BLEDevices.trainer = { device, server, service, characteristic };
    listConnectedDevices();

    alert(`✅ ${device.name} (${isFTMS ? "FTMS" : "CPS"}) 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 스마트 트레이너 연결 중 오류가 발생했습니다.");
  }
}

/* -----------------------------
   FTMS/CPS 데이터 파싱
------------------------------ */
function handleTrainerData(event, isFTMS = true) {
  const v = event.target.value;

  if (isFTMS) {
    // FTMS: Indoor Bike Data (0x2AD2)
    // 2~3 byte: instantaneous power (W)
    // 4~5 byte: cadence (1/2 rpm)
    if (v.byteLength >= 6) {
      liveData.power = v.getUint16(2, true);
      liveData.cadence = v.getUint16(4, true) / 2;
    }
  } else {
    // CPS: Cycling Power Measurement (0x2A63)
    if (v.byteLength >= 4) {
      liveData.power = v.getInt16(2, true);
      liveData.cadence = 0; // CPS는 cadence 미포함
    }
  }

  updateTrainingUI();
}

/* -----------------------------
   저항(ERG) 제어
------------------------------ */
async function setTargetPower(power) {
  try {
    if (!BLEDevices.trainer?.service) return;
    const controlPoint = await BLEDevices.trainer.service.getCharacteristic("fitness_machine_control_point");
    const cmd = new Uint8Array([0x05, power & 0xff, (power >> 8) & 0xff]);
    await controlPoint.writeValue(cmd);
    liveData.targetPower = power;
    console.log(`🎯 목표 파워 ${power}W 설정`);
  } catch (e) {
    console.warn("⚠️ 저항 제어 실패:", e);
  }
}

/* ======================================================
   ② 파워미터 (별도 장치)
====================================================== */
async function connectPowerMeter() {
  if (!checkBLESupport()) return;
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
    listConnectedDevices();
    alert(`⚡ ${device.name} (파워미터) 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 파워미터 연결 실패");
  }
}

/* ======================================================
   ③ 심박계
====================================================== */
async function connectHeartRate() {
  if (!checkBLESupport()) return;

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["heart_rate"] }],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("heart_rate");
    const hrChar = await service.getCharacteristic("heart_rate_measurement");

    await hrChar.startNotifications();
    hrChar.addEventListener("characteristicvaluechanged", (event) => {
      const val = event.target.value;
      liveData.heartRate = val.getUint8(1);
      updateTrainingUI();
    });

    BLEDevices.heartRate = { device, server, service, hrChar };
    listConnectedDevices();

    alert(`❤️ ${device.name} (심박계) 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 심박계 연결 실패");
  }
}

/* ======================================================
   공통 함수
====================================================== */
function listConnectedDevices() {
  const list = document.getElementById("connectedDevicesList");
  if (!list) return;
  let html = "";
  if (BLEDevices.trainer) html += `🚴 ${BLEDevices.trainer.device.name}<br>`;
  if (BLEDevices.powerMeter) html += `⚡ ${BLEDevices.powerMeter.device.name}<br>`;
  if (BLEDevices.heartRate) html += `❤️ ${BLEDevices.heartRate.device.name}<br>`;
  list.innerHTML = html || "<span class='muted'>연결된 기기가 없습니다.</span>";
}

function disconnectAll() {
  for (const key in BLEDevices) {
    try {
      BLEDevices[key]?.device?.gatt?.disconnect();
    } catch {}
  }
  alert("🔌 모든 기기 연결이 해제되었습니다.");
}

function updateTrainingUI() {
  if (!document.getElementById("trainingScreen")) return;
  document.getElementById("currentPowerValue").textContent = liveData.power;
  document.getElementById("cadenceValue").textContent = liveData.cadence.toFixed(0);
  document.getElementById("heartRateValue").textContent = liveData.heartRate;

  const ratio = liveData.targetPower
    ? Math.min(100, (liveData.power / liveData.targetPower) * 100)
    : 0;
  document.getElementById("powerProgressBar").style.width = ratio + "%";
  document.getElementById("achievementValueBar").textContent = ratio.toFixed(0);
}
