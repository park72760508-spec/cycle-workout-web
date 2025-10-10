// ===== BLE 모듈 =====
const BLE = (() => {
  // FTMS/CPS 플래그
  const CPS_FLAG = {
    PEDAL_POWER_BALANCE_PRESENT: 1 << 0,
    PEDAL_POWER_BALANCE_REF: 1 << 1,
    ACC_TORQUE_PRESENT: 1 << 2,
    ACC_TORQUE_SOURCE: 1 << 3,
    WHEEL_REV_DATA_PRESENT: 1 << 4,
    CRANK_REV_DATA_PRESENT: 1 << 5,
  };

  const powerMeterState = { lastCrankRevs: null, lastCrankEventTime: null };
  let powerMeterCadenceLastTs = 0;
  const POWER_METER_CADENCE_TTL = 3000;

  function showConnectionStatus(show) {
    const status = document.getElementById('connectionStatus');
    status.classList.toggle('hidden', !show);
  }

  function updateDevicesList() {
    const { trainer, heartRate, powerMeter } = STATE.connected;
    const deviceList = document.getElementById('deviceList');
    const summary = document.getElementById('connectedDevicesSummary');
    const summaryList = document.getElementById('connectedDevicesList');

    let connectedCount = 0;
    let html = '';

    if (trainer) {
      connectedCount++;
      html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon">🚴‍♂️</div>
          <div class="device-details"><h3>${trainer.name}</h3><p>Smart Trainer</p></div>
        </div>
        <div style="color:var(--success-color);font-weight:600;">연결됨</div>
      </div>`;
    }
    if (powerMeter) {
      connectedCount++;
      html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon">⚡</div>
          <div class="device-details"><h3>${powerMeter.name}</h3><p>Crank Power Meter (BLE)</p></div>
        </div>
        <div style="color:var(--success-color);font-weight:600;">연결됨</div>
      </div>`;
    }
    if (heartRate) {
      connectedCount++;
      html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon" style="background:var(--danger-color);">❤️</div>
          <div class="device-details"><h3>${heartRate.name}</h3><p>Heart Rate Monitor</p></div>
        </div>
        <div style="color:var(--success-color);font-weight:600;">연결됨</div>
      </div>`;
    }

    deviceList.innerHTML = html;
    if (connectedCount > 0) {
      summaryList.innerHTML = html;
      summary.classList.remove('hidden');
    } else summary.classList.add('hidden');
  }

  function handleTrainerData(event) {
    const dv = event.target.value;
    const flags = dv.getUint16(0, true);
    let off = 2;

    // cadence bit2
    if (flags & 0x0004) {
      const ftmsCad = dv.getUint16(off, true) * 0.5; off += 2;
      const pmFresh = (Date.now() - powerMeterCadenceLastTs) < POWER_METER_CADENCE_TTL;
      if (!(STATE.usePowerMeterPreferred && STATE.connected.powerMeter && pmFresh)) {
        STATE.liveData.cadence = ftmsCad;
      }
    }
    // power bit6
    if (flags & 0x0040) {
      const ftmsPower = dv.getInt16(off, true);
      if (!(STATE.usePowerMeterPreferred && STATE.connected.powerMeter)) {
        STATE.liveData.power = ftmsPower;
      }
    }

    if (STATE.trainingSession.isRunning && !STATE.trainingSession.isPaused) {
      APP.updateTrainingDisplay();
      APP.recordDataPoint();
    }
  }

  function handlePowerMeterData(event) {
    const dv = event.target.value;
    let off = 0;

    const flags = dv.getUint16(off, true); off += 2;
    const instPower = dv.getInt16(off, true); off += 2;

    if (STATE.usePowerMeterPreferred) {
      STATE.liveData.power = instPower;
    }
    if (flags & CPS_FLAG.PEDAL_POWER_BALANCE_PRESENT) off += 1;
    if (flags & CPS_FLAG.ACC_TORQUE_PRESENT) off += 2;
    if (flags & CPS_FLAG.WHEEL_REV_DATA_PRESENT) off += 6;

    if (flags & CPS_FLAG.CRANK_REV_DATA_PRESENT) {
      const crankRevs = dv.getUint16(off, true); off += 2;
      const lastCrankTime = dv.getUint16(off, true); off += 2;

      if (powerMeterState.lastCrankRevs !== null) {
        let dtTicks = lastCrankTime - powerMeterState.lastCrankEventTime;
        if (dtTicks < 0) dtTicks += 0x10000;
        const dRev = crankRevs - powerMeterState.lastCrankRevs;
        if (dRev > 0 && dtTicks > 0) {
          const dtSec = dtTicks / 1024;
          const rpm = (dRev / dtSec) * 60;
          if (rpm > 0 && rpm < 220) {
            STATE.liveData.cadence = Math.round(rpm);
            powerMeterCadenceLastTs = Date.now();
          }
        }
      }
      powerMeterState.lastCrankRevs = crankRevs;
      powerMeterState.lastCrankEventTime = lastCrankTime;
    }

    if (STATE.trainingSession.isRunning && !STATE.trainingSession.isPaused) {
      APP.updateTrainingDisplay();
      APP.recordDataPoint();
    }
  }

  function handleHeartRateData(event) {
    const value = event.target.value;
    const flags = value.getUint8(0);
    const rate16Bits = flags & 0x1;
    const bpm = rate16Bits ? value.getUint16(1, true) : value.getUint8(1);
    STATE.liveData.heartRate = bpm;
    if (STATE.trainingSession.isRunning && !STATE.trainingSession.isPaused) {
      APP.updateTrainingDisplay();
    }
  }

  async function connectTrainer() {
    try {
      showConnectionStatus(true);
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

      let service, characteristic, isFTMS = false;
      try {
        service = await server.getPrimaryService('fitness_machine');
        characteristic = await service.getCharacteristic('indoor_bike_data');
        isFTMS = true;
      } catch {
        service = await server.getPrimaryService('cycling_power');
        characteristic = await service.getCharacteristic('cycling_power_measurement');
        isFTMS = false;
      }

      await characteristic.startNotifications();
      if (isFTMS) {
        characteristic.addEventListener('characteristicvaluechanged', handleTrainerData);
        STATE.connected.trainer = { name: device.name || 'Smart Trainer', device, server, characteristic };
      } else {
        characteristic.addEventListener('characteristicvaluechanged', handlePowerMeterData);
        STATE.connected.powerMeter = { name: device.name || 'Power Meter', device, server, characteristic };
        STATE.usePowerMeterPreferred = true;
      }

      device.addEventListener('gattserverdisconnected', () => {
        try {
          if (isFTMS && STATE.connected.trainer?.device === device) STATE.connected.trainer = null;
          if (!isFTMS && STATE.connected.powerMeter?.device === device) STATE.connected.powerMeter = null;
          updateDevicesList();
        } catch {}
      });

      updateDevicesList();
      showConnectionStatus(false);
      alert(`✅ ${device.name || (isFTMS ? 'Smart Trainer' : 'Power Meter')} 연결 성공!`);
    } catch (error) {
      showConnectionStatus(false);
      console.error('트레이너/파워미터 연결 오류:', error);
      alert('❌ 연결 실패: ' + error.message);
    }
  }

  async function connectPowerMeter() {
    try {
      showConnectionStatus(true);
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

      STATE.connected.powerMeter = { name: device.name || 'Power Meter', device, server, characteristic: ch };
      STATE.usePowerMeterPreferred = true;

      updateDevicesList();
      showConnectionStatus(false);
      alert(`✅ ${device.name} 파워미터 연결 성공!`);
    } catch (err) {
      showConnectionStatus(false);
      console.error('파워미터 연결 오류:', err);
      alert('❌ 파워미터 연결 실패: ' + err.message);
    }
  }

  async function connectHeartRate() {
    try {
      showConnectionStatus(true);
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('heart_rate');
      const characteristic = await service.getCharacteristic('heart_rate_measurement');
      characteristic.addEventListener('characteristicvaluechanged', handleHeartRateData);
      await characteristic.startNotifications();

      STATE.connected.heartRate = { name: device.name || 'Heart Rate Monitor', device, server, characteristic };
      updateDevicesList();
      showConnectionStatus(false);
      alert(`✅ ${device.name || 'Heart Rate'} 연결 성공!`);
    } catch (error) {
      showConnectionStatus(false);
      console.error('심박계 연결 오류:', error);
      alert('❌ 심박계 연결 실패: ' + error.message);
    }
  }

  return {
    connectTrainer,
    connectPowerMeter,
    connectHeartRate,
    updateDevicesList,
  };
})();
