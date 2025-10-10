// ===============================================
// Cycle Workout Web App (v5.0) - bluetooth.js
// FTMS + PowerMeter + HeartRate 통합 BLE 제어 모듈
// ===============================================

export const connectedDevices = {
  trainer: null,
  powerMeter: null,
  heartRate: null
};

export const liveData = {
  power: 0,
  cadence: 0,
  heartRate: 0,
  targetPower: 0
};

// === 유틸 ===
function log(msg) {
  console.log(`[BLE] ${msg}`);
}

// ======================
// FTMS (스마트 트레이너)
// ======================
export async function connectTrainer() {
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['fitness_machine'] }],
      optionalServices: ['device_information']
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('fitness_machine');

    // 특성(characteristic)
    const featureChar = await service.getCharacteristic('fitness_machine_feature');
    const controlChar = await service.getCharacteristic('fitness_machine_control_point');
    const statusChar = await service.getCharacteristic('fitness_machine_status');
    const powerChar = await service.getCharacteristic('indoor_bike_data');

    // 상태 알림 수신
    await statusChar.startNotifications();
    statusChar.addEventListener('characteristicvaluechanged', e => {
      log('FTMS 상태 변화 감지');
    });

    // 실시간 파워 데이터 수신
    await powerChar.startNotifications();
    powerChar.addEventListener('characteristicvaluechanged', e => {
      const v = e.target.value;
      const power = v.getUint16(2, true);
      const cadence = v.getUint16(4, true);
      liveData.power = power;
      liveData.cadence = cadence;
      updatePowerDisplay?.(power, cadence);
    });

    connectedDevices.trainer = { device, server, service, controlChar };
    alert(`✅ ${device.name} (FTMS) 연결 완료`);
  } catch (err) {
    console.error('Trainer 연결 오류:', err);
    alert('❌ 스마트 트레이너 연결 중 오류가 발생했습니다.');
  }
}

// 저항(ERG 모드) 제어
export async function setTargetPower(power) {
  try {
    if (!connectedDevices.trainer?.controlChar) return;
    const ctrl = connectedDevices.trainer.controlChar;
    const data = new Uint8Array([0x05, power & 0xff, (power >> 8) & 0xff]);
    await ctrl.writeValue(data);
    liveData.targetPower = power;
    log(`ERG 목표파워 설정: ${power}W`);
  } catch (err) {
    console.error('Target Power 설정 실패:', err);
  }
}

// ======================
// Power Meter (CPS)
// ======================
export async function connectPowerMeter() {
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['cycling_power'] }],
      optionalServices: ['device_information']
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('cycling_power');
    const measureChar = await service.getCharacteristic('cycling_power_measurement');

    await measureChar.startNotifications();
    measureChar.addEventListener('characteristicvaluechanged', e => {
      const v = e.target.value;
      const power = v.getUint16(2, true);
      const cadence = v.getUint8(4);
      liveData.power = power;
      liveData.cadence = cadence;
      updatePowerDisplay?.(power, cadence);
    });

    connectedDevices.powerMeter = { device, server };
    alert(`✅ ${device.name} (PowerMeter) 연결 완료`);
  } catch (err) {
    console.error('PowerMeter 연결 오류:', err);
    alert('❌ 파워미터 연결 실패');
  }
}

// ======================
// Heart Rate (HRM)
// ======================
export async function connectHeartRate() {
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }]
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const hrChar = await service.getCharacteristic('heart_rate_measurement');
    await hrChar.startNotifications();

    hrChar.addEventListener('characteristicvaluechanged', e => {
      const bpm = e.target.value.getUint8(1);
      liveData.heartRate = bpm;
      const el = document.getElementById('heartRateValue');
      if (el) el.textContent = bpm;
    });

    connectedDevices.heartRate = { device, server };
    alert(`❤️ ${device.name} 심박계 연결 완료`);
  } catch (err) {
    console.error('HeartRate 연결 오류:', err);
    alert('❌ 심박계 연결 실패');
  }
}

// ======================
// 연결 상태 갱신
// ======================
export function updateConnectedList() {
  const list = document.getElementById("connectedDevicesList");
  if (!list) return;
  list.innerHTML = `
    <p>🚴‍♂️ 트레이너: ${connectedDevices.trainer?.device?.name || "❌ 미연결"}</p>
    <p>⚡ 파워미터: ${connectedDevices.powerMeter?.device?.name || "❌ 미연결"}</p>
    <p>💓 심박계: ${connectedDevices.heartRate?.device?.name || "❌ 미연결"}</p>
  `;
}

// ======================
// 연결 해제
// ======================
export function disconnectAll() {
  for (const key in connectedDevices) {
    const dev = connectedDevices[key];
    if (dev?.server?.connected) dev.server.disconnect();
    connectedDevices[key] = null;
  }
  alert("🔌 모든 BLE 연결 해제 완료");
  updateConnectedList();
}
