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

// 파일 상단(모듈 스코프)에 이전 값 저장용 상태 추가
let __pmPrev = { 
  revs: null, 
  time1024: null,
  lastRealTime: null,
  sampleCount: 0,
  validSamples: 0,
  recentCadences: []  // 최근 케이던스 값들 저장
};


window.liveData = window.liveData || { 
  power: 0, 
  heartRate: 0, 
  cadence: 0,  // null 대신 0으로 초기화
  targetPower: 0 
};

// UI 헬퍼들 (index.html/app.js에 이미 있으면 중복 선언하지 마세요)
// bluetooth.js의 상단 UI 헬퍼 부분을 다음과 같이 수정
// UI 헬퍼들 - window 객체 확인 후 할당

// ── CPS (Cycling Power Service) UUIDs ─────────────────
const CYCLING_POWER_SERVICE = 0x1818;
const CYCLING_POWER_MEASUREMENT = 0x2A63; // cadence는 이 측정값의 crank rev 데이터로 계산



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
  const summaryList = document.getElementById("connectedDevicesList"); // const summaryList = document.getElementById("connectedDevicesSummaryList");로 구분 권장
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
     
    trySubscribeCSC(server);
    connectedDevices.powerMeter = { name: device.name || "Power Meter", device, server, characteristic: ch };

    device.addEventListener("gattserverdisconnected", () => {
      if (connectedDevices.powerMeter?.device === device) connectedDevices.powerMeter = null;
      updateDevicesList();
    });

    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "Power Meter"} 연결 성공`);
    

     
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
  try {
    showConnectionStatus(true);

    let device;
    try {
      // 기본적으로 heart_rate 서비스를 광고하는 기기 우선
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }],
        optionalServices: ["heart_rate", "device_information"],
      });
    } catch {
      // 광고에 heart_rate UUID가 없는 기기 (가민, 폴라 등) 대응
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["heart_rate", "device_information"],
      });
    }

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("heart_rate");
    const ch = await service.getCharacteristic("heart_rate_measurement");

    await ch.startNotifications();
    ch.addEventListener("characteristicvaluechanged", handleHeartRateData);

    connectedDevices.heartRate = { 
      name: device.name || "Heart Rate", 
      device, 
      server, 
      characteristic: ch 
    };

    device.addEventListener("gattserverdisconnected", () => {
      if (connectedDevices.heartRate?.device === device) {
        connectedDevices.heartRate = null;
      }
      updateDevicesList();
    });

    updateDevicesList();
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "HR"} 연결 성공`);
    
  } catch (err) {
    showConnectionStatus(false);
    console.error("심박계 연결 오류:", err);
    showToast("❌ 심박계 연결 실패: " + err.message);
  }
}


// ──────────────────────────────────────────────────────────
// 파워미터 알림 파서 보강 (크랭크 데이터 → RPM 계산)
// ──────────────────────────────────────────────────────────
// 파일 상단(모듈 스코프)에 이전 값 저장용 상태 추가


// 파워미터 측정 알림
// ⚡ 파워미터 데이터 처리 (cadence 보강)
// 2. handlePowerMeterData 함수를 다음으로 완전히 교체
// 2. handlePowerMeterData 함수를 다음으로 완전히 교체
function handlePowerMeterData(e) {
  const dv = e.target.value instanceof DataView ? e.target.value : new DataView(e.target.value.buffer || e.target.value);
  let offset = 0;

  const flags = dv.getUint16(offset, true); offset += 2;
  const instPower = dv.getInt16(offset, true); offset += 2;
  
  console.log(`Power meter flags: 0x${flags.toString(16)}, has crank data: ${!!(flags & 0x20)}`);
  
  // 파워 데이터 업데이트
  if (!isNaN(instPower)) {
    window.liveData.power = Math.max(0, instPower);
  }

  // 크랭크 회전 데이터가 있는지 확인 (bit 5)
  if (flags & 0x20) {
    const crankRevs = dv.getUint16(offset, true); offset += 2;
    const crankTime = dv.getUint16(offset, true); offset += 2;
    const currentTime = Date.now();
    
    __pmPrev.sampleCount++;
    console.log(`📊 Raw crank data - Revs: ${crankRevs}, Time: ${crankTime}, Power: ${instPower}W`);

    // 첫 번째 데이터이거나 10초 이상 경과한 경우 초기화
    if (__pmPrev.revs === null || __pmPrev.time1024 === null || 
        (currentTime - (__pmPrev.lastRealTime || 0)) > 10000) {
      console.log(`🔄 Initializing crank data tracking (sample #${__pmPrev.sampleCount})`);
      __pmPrev.revs = crankRevs;
      __pmPrev.time1024 = crankTime;
      __pmPrev.lastRealTime = currentTime;
      __pmPrev.validSamples = 0;
      __pmPrev.recentCadences = [];
      return;
    }

    // 실시간 기준으로만 케이던스 계산 (BLE 타임스탬프 무시)
    const realTimeDiff = currentTime - __pmPrev.lastRealTime;
    
    // 데이터 변화 확인
    let revDiff = crankRevs - __pmPrev.revs;
    let timeDiff = crankTime - __pmPrev.time1024;
    
    // 16비트 오버플로우 처리
    if (revDiff < 0) revDiff += 65536;
    if (timeDiff < 0) timeDiff += 65536;
    
    console.log(`🔍 Sample #${__pmPrev.sampleCount} - RevDiff: ${revDiff}, RealTime: ${realTimeDiff}ms`);
    
    // 데이터가 변화하지 않는 경우
    if (revDiff === 0) {
      console.log(`⚠️ No crank revolution change`);
      // 5초 이상 변화가 없으면 정지 상태로 판단
      if (realTimeDiff > 5000) {
        console.log(`🛑 Setting cadence to 0 (no movement for ${realTimeDiff}ms)`);
        window.liveData.cadence = 0;
        updateCadenceUI(0);
        __pmPrev.recentCadences = [];
      }
      return;
    }
    
    // 실시간 기준으로만 케이던스 계산
    if (revDiff > 0 && realTimeDiff > 500 && realTimeDiff < 10000) { // 0.5초~10초 사이
      const realTimeInSeconds = realTimeDiff / 1000;
      let cadence = (revDiff / realTimeInSeconds) * 60; // RPM
      
      console.log(`⚙️ Real-time calculation - ${revDiff} revs in ${realTimeInSeconds.toFixed(1)}s = ${cadence.toFixed(1)} RPM`);
      
      // 극단적 값 필터링 (30-120 RPM 범위)
      if (cadence >= 30 && cadence <= 120) {
        // 최근 값들과 비교하여 급격한 변화 확인
        __pmPrev.recentCadences.push(cadence);
        if (__pmPrev.recentCadences.length > 5) {
          __pmPrev.recentCadences.shift(); // 오래된 값 제거
        }
        
        // 평균값 계산
        const avgCadence = __pmPrev.recentCadences.reduce((a, b) => a + b, 0) / __pmPrev.recentCadences.length;
        const finalCadence = Math.round(avgCadence);
        
        window.liveData.cadence = finalCadence;
        updateCadenceUI(finalCadence);
        __pmPrev.validSamples++;
        
        console.log(`✅ Valid cadence: ${finalCadence} RPM (avg of ${__pmPrev.recentCadences.length} samples)`);
        
        // 성공적으로 계산된 경우에만 이전 값 업데이트
        __pmPrev.revs = crankRevs;
        __pmPrev.time1024 = crankTime;
        __pmPrev.lastRealTime = currentTime;
        
      } else {
        console.log(`❌ Cadence out of realistic range: ${cadence.toFixed(1)} RPM`);
        
        // 비정상적인 값이 3번 연속 나오면 초기화
        if (__pmPrev.validSamples === 0 && __pmPrev.sampleCount > 3) {
          console.log(`🔄 Resetting due to consecutive invalid samples`);
          __pmPrev.revs = crankRevs;
          __pmPrev.time1024 = crankTime;
          __pmPrev.lastRealTime = currentTime;
          __pmPrev.sampleCount = 0;
          __pmPrev.recentCadences = [];
        }
      }
    } else {
      console.log(`❌ Invalid timing - RevDiff: ${revDiff}, RealTimeDiff: ${realTimeDiff}ms`);
    }
    
  } else {
    console.log(`❌ No crank revolution data in power meter packet`);
  }

  // 전체 UI 업데이트 호출
  if (typeof window.updateTrainingDisplay === "function") {
    window.updateTrainingDisplay();
  }
}

// 3. 케이던스 UI 업데이트 함수 추가
function updateCadenceUI(cadence) {
  const cadenceEl = document.getElementById("cadenceValue");
  if (cadenceEl) {
    cadenceEl.textContent = cadence.toString();
    console.log(`📱 UI Updated - Cadence: ${cadence} RPM`);
  }
}


// ──────────────────────────────────────────────────────────
// 스마트 트레이너(FTMS)에서 케이던스 파싱
// ──────────────────────────────────────────────────────────

function handleTrainerData(e) {
  const dv = e.target.value instanceof DataView ? e.target.value : new DataView(e.target.value.buffer || e.target.value);
  let off = 0;

  const flags = dv.getUint16(off, true); off += 2;

  // flags 비트에 따라 필드가 존재할 수 있음:
  // 0: More Data
  // 1: Average Speed Present
  // 2: Instantaneous Cadence Present
  // 3: Average Cadence Present
  // 4: Total Distance Present
  // 5: Resistance Level Present
  // 6: Instantaneous Power Present
  // 7: Average Power Present
  // 등등 (기기별 차이)

  // Instantaneous Speed (uint16, 0.01 m/s) 존재 시 스킵
  if (flags & 0x0001) { off += 2; }
  // Average Speed (uint16) 존재 시 스킵
  if (flags & 0x0002) { off += 2; }

  // Instantaneous Cadence (uint16, 0.5 rpm) — ★ 여기서 케이던스
  if (flags & 0x0004) {
    const cadHalf = dv.getUint16(off, true); off += 2;
    const rpm = cadHalf / 2;
    window.liveData.cadence = Math.round(rpm);
  }

  // Average Cadence 존재 시 스킵
  if (flags & 0x0008) { off += 2; }

  // Total Distance (uint24) 존재 시 스킵
  if (flags & 0x0010) { off += 3; }

  // Resistance Level (int16) 존재 시 스킵
  if (flags & 0x0020) { off += 2; }

  // Instantaneous Power (int16) — ★ 파워
  if (flags & 0x0040) {
    const p = dv.getInt16(off, true); off += 2;
    window.liveData.power = p;
  }

  // Average Power 등 다른 필드들은 필요한 만큼 스킵/파싱 추가…

  if (typeof window.updateTrainingDisplay === "function") {
    window.updateTrainingDisplay();
  }
}


// ──────────────────────────────────────────────────────────
// (권장) 파워미터가 Crank 데이터 안 주는 경우 대비 → CSC 서비스도 구독
// ──────────────────────────────────────────────────────────
// 파워미터 connect 이후(또는 별도 버튼) CSC도 시도
async function trySubscribeCSC(server) {
  try {
    const cscSvc = await server.getPrimaryService(0x1816);
    const cscMeas = await cscSvc.getCharacteristic(0x2A5B);
    await cscMeas.startNotifications();
    cscMeas.addEventListener("characteristicvaluechanged", (evt) => {
      const dv = evt.target.value;
      let o = 0;
      const flags = dv.getUint8(o); o += 1;
      // flags bit1: Crank Revolution Data Present
      if (flags & 0x02) {
        const cumRevs = dv.getUint16(o, true); o += 2;
        const evtTime = dv.getUint16(o, true); o += 2;

        // 이전 표본과 RPM 계산 (1과 동일 로직)
        if (__pmPrev.revs !== null && __pmPrev.time1024 !== null) {
          let dRevs = cumRevs - __pmPrev.revs; if (dRevs < 0) dRevs += 0x10000;
          let dT = evtTime - __pmPrev.time1024; if (dT < 0) dT += 0x10000;
          const sec = dT / 1024;
          if (sec > 0 && sec < 5) {
            const rpm = (dRevs / sec) * 60;
            window.liveData.cadence = Math.round(rpm);
          }
        }
        __pmPrev.revs = cumRevs;
        __pmPrev.time1024 = evtTime;

        window.updateTrainingDisplay && window.updateTrainingDisplay();
      }
    });
  } catch (_) {
    // CSC가 없으면 조용히 패스
  }
}




// ──────────────────────────────────────────────────────────
// BLE 데이터 파서 (기존 함수명/로직 유지해도 OK)
// ──────────────────────────────────────────────────────────


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
