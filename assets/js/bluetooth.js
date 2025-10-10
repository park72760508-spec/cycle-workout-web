/* ===============================================
 * bluetooth.js
 * - Web Bluetooth 연결 (FTMS / CPS / HR)
 * - 데이터 파싱 및 전역 liveData 갱신
 * - FTMS ERG(Set Target Power) 제어
 * =============================================== */

// ---- 전역(다른 스크립트와 공유) ---------------------------------
window.connectedDevices = window.connectedDevices || { trainer: null, heartRate: null, powerMeter: null };
window.usePowerMeterPreferred = window.usePowerMeterPreferred ?? true; // 외부 파워/케이던스 우선
window.liveData = window.liveData || { power: 0, cadence: 0, heartRate: 0, targetPower: 0 };

// 파워미터(CPS) 상태 (케이던스 계산용)
const CPS_FLAG = {
  PEDAL_POWER_BALANCE_PRESENT: 1 << 0,
  PEDAL_POWER_BALANCE_REF:     1 << 1,
  ACC_TORQUE_PRESENT:          1 << 2,
  ACC_TORQUE_SOURCE:           1 << 3,
  WHEEL_REV_DATA_PRESENT:      1 << 4,
  CRANK_REV_DATA_PRESENT:      1 << 5,
};

let powerMeterState = { lastCrankRevs: null, lastCrankEventTime: null };
let powerMeterCadenceLastTs = 0;
const POWER_METER_CADENCE_TTL = 3000; // ms

// FTMS 컨트롤 포인트 핸들 유지
let ftms = {
  service: null,
  dataChar: null,          // indoor_bike_data
  controlPoint: null,      // fitness_machine_control_point
  requestedControl: false, // Request Control 수행 여부
};

// ---- BLE 연결 진입점들 ------------------------------------------
async function connectTrainer() {
  try {
    showConnectionStatus?.(true);

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: ['fitness_machine'] },
        { services: ['cycling_power'] },
        { namePrefix: 'KICKR' },
        { namePrefix: 'Wahoo' },
      ],
      optionalServices: ['device_information', 'fitness_machine', 'cycling_power'],
    });

    const server = await device.gatt.connect();

    // FTMS 우선 → 실패 시 CPS 폴백
    let service, characteristic, isFTMS = false;
    try {
      service = await server.getPrimaryService('fitness_machine');
      characteristic = await service.getCharacteristic('indoor_bike_data');
      isFTMS = true;
    } catch (_) {
      service = await server.getPrimaryService('cycling_power');
      characteristic = await service.getCharacteristic('cycling_power_measurement');
      isFTMS = false;
    }

    await characteristic.startNotifications();

    if (isFTMS) {
      // FTMS
      characteristic.addEventListener('characteristicvaluechanged', handleTrainerData);
      connectedDevices.trainer = { name: device.name || 'Smart Trainer', device, server, characteristic: characteristic };
      // 컨트롤 포인트 핸들 보관
      ftms.service = service;
      ftms.dataChar = characteristic;
      ftms.controlPoint = await service.getCharacteristic('fitness_machine_control_point');
      await ensureFTMSControl();
    } else {
      // CPS 파워미터
      characteristic.addEventListener('characteristicvaluechanged', handlePowerMeterData);
      connectedDevices.powerMeter = { name: device.name || 'Power Meter', device, server, characteristic: characteristic };
      usePowerMeterPreferred = true;
    }

    device.addEventListener('gattserverdisconnected', () => {
      try {
        if (isFTMS && connectedDevices.trainer?.device === device) {
          connectedDevices.trainer = null;
          ftms = { service: null, dataChar: null, controlPoint: null, requestedControl: false };
        }
        if (!isFTMS && connectedDevices.powerMeter?.device === device) {
          connectedDevices.powerMeter = null;
        }
        updateDevicesList?.();
      } catch (e) { console.warn(e); }
    });

    updateDevicesList?.();
    showConnectionStatus?.(false);
    alert(`✅ ${device.name || (isFTMS ? 'Smart Trainer' : 'Power Meter')} 연결 성공!`);
  } catch (error) {
    showConnectionStatus?.(false);
    console.error('트레이너/파워미터 연결 오류:', error);
    alert("❌ 연결 실패: " + error.message);
  }
}

async function connectPowerMeter() {
  try {
    showConnectionStatus?.(true);

    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_power'] }],
        optionalServices: ['device_information'],
      });
    } catch {
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [0x1818, 'cycling_power', 'device_information'],
      });
    }

    const server = await device.gatt.connect();
    let service;
    try { service = await server.getPrimaryService(0x1818); }
    catch { service = await server.getPrimaryService('cycling_power'); }
    const ch = await service.getCharacteristic(0x2A63);
    await ch.startNotifications();
    ch.addEventListener('characteristicvaluechanged', handlePowerMeterData);

    connectedDevices.powerMeter = { name: device.name || 'Power Meter', device, server, characteristic: ch };
    usePowerMeterPreferred = true;

    device.addEventListener('gattserverdisconnected', () => {
      if (connectedDevices.powerMeter?.device === device) {
        connectedDevices.powerMeter = null;
      }
      updateDevicesList?.();
    });

    updateDevicesList?.();
    showConnectionStatus?.(false);
    alert(`✅ ${device.name} 파워미터 연결 성공!`);
  } catch (err) {
    showConnectionStatus?.(false);
    console.error('파워미터 연결 오류:', err);
    alert('❌ 파워미터 연결 실패: ' + err.message);
  }
}

async function connectHeartRate() {
  try {
    showConnectionStatus?.(true);
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const characteristic = await service.getCharacteristic('heart_rate_measurement');
    characteristic.addEventListener('characteristicvaluechanged', handleHeartRateData);
    await characteristic.startNotifications();

    connectedDevices.heartRate = { name: device.name || 'Heart Rate Monitor', device, server, characteristic };

    device.addEventListener('gattserverdisconnected', () => {
      if (connectedDevices.heartRate?.device === device) {
        connectedDevices.heartRate = null;
      }
      updateDevicesList?.();
    });

    updateDevicesList?.();
    showConnectionStatus?.(false);
    alert(`✅ ${device.name} 연결 성공!`);
  } catch (error) {
    showConnectionStatus?.(false);
    console.error('심박계 연결 오류:', error);
    alert("❌ 심박계 연결 실패: " + error.message);
  }
}

// ---- 데이터 핸들러 ----------------------------------------------
function handleTrainerData(event) {
  const dv = event.target.value;
  const flags = dv.getUint16(0, true);
  let off = 2;

  // cadence (bit2)
  if (flags & 0x0004) {
    const ftmsCad = dv.getUint16(off, true) * 0.5; off += 2;
    const pmFresh = (Date.now() - powerMeterCadenceLastTs) < POWER_METER_CADENCE_TTL;
    if (!(usePowerMeterPreferred && connectedDevices.powerMeter && pmFresh)) {
      liveData.cadence = Math.round(ftmsCad);
    }
  }

  // power (bit6)
  if (flags & 0x0040) {
    const ftmsPower = dv.getInt16(off, true);
    if (!(usePowerMeterPreferred && connectedDevices.powerMeter)) {
      liveData.power = ftmsPower;
    }
  }

  // 화면 갱신/기록
  if (window.trainingSession?.isRunning && !window.trainingSession?.isPaused) {
    window.updateTrainingDisplay?.();
    window.recordDataPoint?.();
  }
}

function handlePowerMeterData(event) {
  const dv = event.target.value;
  let off = 0;

  const flags = dv.getUint16(off, true); off += 2;
  const instPower = dv.getInt16(off, true); off += 2;

  if (usePowerMeterPreferred) {
    liveData.power = instPower;
  }

  if (flags & CPS_FLAG.PEDAL_POWER_BALANCE_PRESENT) off += 1;
  if (flags & CPS_FLAG.ACC_TORQUE_PRESENT) off += 2;
  if (flags & CPS_FLAG.WHEEL_REV_DATA_PRESENT) off += 6;

  if (flags & CPS_FLAG.CRANK_REV_DATA_PRESENT) {
    const crankRevs = dv.getUint16(off, true); off += 2;
    const lastCrankTime = dv.getUint16(off, true); off += 2; // 1/1024s

    if (powerMeterState.lastCrankRevs !== null) {
      let dtTicks = lastCrankTime - powerMeterState.lastCrankEventTime;
      if (dtTicks < 0) dtTicks += 0x10000;
      const dRev = crankRevs - powerMeterState.lastCrankRevs;
      if (dRev > 0 && dtTicks > 0) {
        const dtSec = dtTicks / 1024;
        const rpm = (dRev / dtSec) * 60;
        if (rpm > 0 && rpm < 220) {
          liveData.cadence = Math.round(rpm);
          powerMeterCadenceLastTs = Date.now();
        }
      }
    }
    powerMeterState.lastCrankRevs = crankRevs;
    powerMeterState.lastCrankEventTime = lastCrankTime;
  }

  if (window.trainingSession?.isRunning && !window.trainingSession?.isPaused) {
    window.updateTrainingDisplay?.();
    window.recordDataPoint?.();
  }
}

function handleHeartRateData(event) {
  const value = event.target.value;
  const flags = value.getUint8(0);
  const rate16Bits = flags & 0x1;
  const bpm = rate16Bits ? value.getUint16(1, true) : value.getUint8(1);
  liveData.heartRate = bpm;

  if (window.trainingSession?.isRunning && !window.trainingSession?.isPaused) {
    window.updateTrainingDisplay?.();
  }
}

// ---- FTMS 제어(ERG) ---------------------------------------------
async function ensureFTMSControl() {
  if (!ftms.controlPoint) return;
  try {
    // 1) Request Control (opcode: 0x00)
    if (!ftms.requestedControl) {
      const buf = new Uint8Array([0x00]);
      await ftms.controlPoint.writeValue(buf);
      ftms.requestedControl = true;
    }
    // 2) Start or Resume (opcode: 0x07)
    const start = new Uint8Array([0x07]);
    await ftms.controlPoint.writeValue(start);
  } catch (e) {
    console.warn('FTMS Control 확보 실패:', e);
  }
}

// 목표 파워 설정 (ERG)
async function setTargetPower(watts) {
  if (!connectedDevices.trainer || !ftms.controlPoint) return;
  try {
    await ensureFTMSControl();
    // opcode 0x05: Set Target Power, Little Endian s16
    const buf = new ArrayBuffer(3);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x05);
    dv.setInt16(1, Math.round(watts), true);
    await ftms.controlPoint.writeValue(new Uint8Array(buf));
  } catch (e) {
    console.warn('Set Target Power 실패:', e);
  }
}

// ERG on/off 토글(OFF는 목표파워 0 혹은 Stop/Pause 사용)
async function setERGMode(enabled, fallbackWatts = 0) {
  if (!connectedDevices.trainer || !ftms.controlPoint) return;
  try {
    await ensureFTMSControl();
    if (enabled) {
      await setTargetPower(fallbackWatts || (liveData.targetPower || 150));
    } else {
      // Stop or Pause (opcode: 0x08, parameter 0x01: stop)
      const buf = new Uint8Array([0x08, 0x01]);
      await ftms.controlPoint.writeValue(buf);
    }
  } catch (e) {
    console.warn('ERG 모드 전환 실패:', e);
  }
}

// 전역 export
window.setTargetPower = setTargetPower;
window.setERGMode = setERGMode;
window.connectTrainer = connectTrainer;
window.connectPowerMeter = connectPowerMeter;
window.connectHeartRate = connectHeartRate;
