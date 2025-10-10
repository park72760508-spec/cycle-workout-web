/* ======================================================
   BLE 연결 제어 (FTMS / Power Meter / Heart Rate)
   cycle_workout_web_ble_full_v1009
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

// 블루투스 지원 확인
function checkBLESupport() {
  if (!navigator.bluetooth) {
    alert("⚠️ 이 브라우저는 Bluetooth를 지원하지 않습니다. Chrome 또는 Edge를 사용하세요.");
    return false;
  }
  return true;
}

/* -------------------------
   FTMS (스마트 트레이너)
-------------------------- */
async function connectTrainer() {
  if (!checkBLESupport()) return;

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["fitness_machine"] }],
      optionalServices: ["device_information", "battery_service"],
    });
    const server = await device.gatt.connect();

    const service = await server.getPrimaryService("fitness_machine");
    const control = await service.getCharacteristic("fitness_machine_control_point");
    const status = await service.getCharacteristic("fitness_machine_status");
    const data = await service.getCharacteristic("indoor_bike_data");

    await data.startNotifications();
    data.addEventListener("characteristicvaluechanged", handleTrainerData);

    BLEDevices.trainer = { device, control, status, data };
    alert(`✅ ${device.name} (FTMS) 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 스마트 트레이너 연결 중 오류가 발생했습니다.");
  }
}

function handleTrainerData(event) {
  const v = event.target.value;
  // 2~3byte = instantaneous power (W)
  liveData.power = v.getUint16(2, true);
  // 4~5byte = cadence (1/2 rpm)
  liveData.cadence = v.getUint16(4, true) / 2;
  updateTrainingUI();
}

async function setTargetPower(power) {
  try {
    if (!BLEDevices.trainer?.control) return;
    const control = BLEDevices.trainer.control;
    const cmd = new Uint8Array([0x05, power & 0xff, (power >> 8) & 0xff]);
    await control.writeValue(cmd);
    liveData.targetPower = power;
  } catch (e) {
    console.warn("⚠️ 파워 제어 실패:", e);
  }
}

/* -------------------------
   파워미터
-------------------------- */
async function connectPowerMeter() {
  if (!checkBLESupport()) return;

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["cycling_power"] }],
      optionalServices: ["battery_service"],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("cycling_power");
    const characteristic = await service.getCharacteristic("cycling_power_measurement");

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      const v = event.target.value;
      liveData.power = v.getInt16(2, true);
      updateTrainingUI();
    });

    BLEDevices.powerMeter = { device };
    alert(`✅ ${device.name} (파워미터) 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 파워미터 연결 중 오류가 발생했습니다.");
  }
}

/* -------------------------
   심박계
-------------------------- */
async function connectHeartRate() {
  if (!checkBLESupport()) return;

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["heart_rate"] }],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("heart_rate");
    const hrm = await service.getCharacteristic("heart_rate_measurement");

    await hrm.startNotifications();
    hrm.addEventListener("characteristicvaluechanged", (event) => {
      const val = event.target.value;
      liveData.heartRate = val.getUint8(1);
      updateTrainingUI();
    });

    BLEDevices.heartRate = { device };
    alert(`❤️ ${device.name} (심박계) 연결 완료`);
  } catch (err) {
    console.error(err);
    alert("❌ 심박계 연결 중 오류가 발생했습니다.");
  }
}

/* -------------------------
   BLE 연결 요약 표시
-------------------------- */
function listConnectedDevices() {
  const summary = document.getElementById("connectedDevicesList");
  if (!summary) return;
  let html = "";
  if (BLEDevices.trainer) html += `🚴 ${BLEDevices.trainer.device.name}<br>`;
  if (BLEDevices.powerMeter) html += `⚡ ${BLEDevices.powerMeter.device.name}<br>`;
  if (BLEDevices.heartRate) html += `❤️ ${BLEDevices.heartRate.device.name}<br>`;
  summary.innerHTML = html || "<span class='muted'>연결된 기기가 없습니다.</span>";
}

/* -------------------------
   BLE 연결 해제
-------------------------- */
function disconnectAll() {
  for (const key in BLEDevices) {
    try {
      BLEDevices[key]?.device?.gatt?.disconnect();
    } catch (e) {
      console.warn("연결 해제 실패:", e);
    }
  }
  alert("🔌 모든 기기 연결이 해제되었습니다.");
}

/* -------------------------
   실시간 데이터 업데이트
-------------------------- */
function updateTrainingUI() {
  if (document.getElementById("trainingScreen").classList.contains("active")) {
    document.getElementById("currentPowerValue").textContent = liveData.power;
    document.getElementById("cadenceValue").textContent = liveData.cadence.toFixed(0);
    document.getElementById("heartRateValue").textContent = liveData.heartRate;
    const ratio = liveData.targetPower
      ? Math.min(100, (liveData.power / liveData.targetPower) * 100)
      : 0;
    document.getElementById("powerProgressBar").style.width = ratio + "%";
    document.getElementById("achievementValueBar").textContent = ratio.toFixed(0);
  }
}
