/* ==========================================================
   bluetooth.js (v1.2 stable)
   - 전역 상태 window.connectedDevices 로 통일
   - 연결 성공 시 showScreen('profileScreen')로 전환
   - startNotifications 이후에 updateDevicesList 호출
   - 오류/종료 시 showConnectionStatus(false) 보장
   - beforeunload에서 안전 disconnect
========================================================== */
// 파일 상단에 한 번만
window.liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };

const CPS_FLAG = {
  PEDAL_POWER_BALANCE_PRESENT: 0x0001,
  ACC_TORQUE_PRESENT:         0x0004,
  WHEEL_REV_DATA_PRESENT:     0x0010, // wheel
  CRANK_REV_DATA_PRESENT:     0x0020  // crank
};


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
  recentCadences: [],
  consecutiveFailures: 0  // 연속 실패 카운트 추가
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
// 버튼 이미지 업데이트 함수 (전역으로 노출)
window.updateDeviceButtonImages = window.updateDeviceButtonImages || function updateDeviceButtonImages() {
  const btnTrainer = document.getElementById("btnConnectTrainer");
  const btnHR = document.getElementById("btnConnectHR");
  const btnPM = document.getElementById("btnConnectPM");
  
  // 스마트 트레이너 버튼
  if (btnTrainer) {
    let img = btnTrainer.querySelector(".device-btn-icon");
    if (!img) {
      // 이미지가 없으면 생성
      img = document.createElement("img");
      img.className = "device-btn-icon";
      img.alt = "스마트 트레이너";
      const span = btnTrainer.querySelector("span");
      if (span) {
        btnTrainer.insertBefore(img, span);
      } else {
        btnTrainer.appendChild(img);
      }
    }
    // 블루투스 연결 또는 페어링 상태 확인
    const isBluetoothConnected = window.connectedDevices && window.connectedDevices.trainer;
    // Indoor Training 페어링 정보 확인 (iOS 모드 대응)
    let isPaired = false;
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
      isPaired = window.indoorTrainingState.powerMeters.some(pm => pm.trainerDeviceId && pm.trainerDeviceId.toString().trim() !== '');
    }
    const isConnected = isBluetoothConnected || isPaired;
    
    if (isConnected) {
      img.src = "assets/img/trainer_g.png";
      btnTrainer.classList.add("connected");
      console.log("스마트 트레이너 연결됨 - trainer_g.png로 변경", { bluetooth: isBluetoothConnected, paired: isPaired });
    } else {
      img.src = "assets/img/trainer_i.png";
      btnTrainer.classList.remove("connected");
      console.log("스마트 트레이너 연결 해제 - trainer_i.png로 변경");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  }
  
  // 심박계 버튼
  if (btnHR) {
    let img = btnHR.querySelector(".device-btn-icon");
    if (!img) {
      // 이미지가 없으면 생성
      img = document.createElement("img");
      img.className = "device-btn-icon";
      img.alt = "심박계 연결";
      const span = btnHR.querySelector("span");
      if (span) {
        btnHR.insertBefore(img, span);
      } else {
        btnHR.appendChild(img);
      }
    }
    // 블루투스 연결 또는 페어링 상태 확인
    const isBluetoothConnected = window.connectedDevices && window.connectedDevices.heartRate;
    // Indoor Training 페어링 정보 확인 (iOS 모드 대응)
    let isPaired = false;
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
      isPaired = window.indoorTrainingState.powerMeters.some(pm => pm.heartRateDeviceId && pm.heartRateDeviceId.toString().trim() !== '');
    }
    const isConnected = isBluetoothConnected || isPaired;
    
    if (isConnected) {
      img.src = "assets/img/bpm_g.png";
      btnHR.classList.add("connected");
      console.log("심박계 연결됨 - bpm_g.png로 변경", { bluetooth: isBluetoothConnected, paired: isPaired });
    } else {
      img.src = "assets/img/bpm_i.png";
      btnHR.classList.remove("connected");
      console.log("심박계 연결 해제 - bpm_i.png로 변경");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  }
  
  // 파워미터 버튼
  if (btnPM) {
    let img = btnPM.querySelector(".device-btn-icon");
    if (!img) {
      // 이미지가 없으면 생성
      img = document.createElement("img");
      img.className = "device-btn-icon";
      img.alt = "파워미터 연결";
      const span = btnPM.querySelector("span");
      if (span) {
        btnPM.insertBefore(img, span);
      } else {
        btnPM.appendChild(img);
      }
    }
    // 블루투스 연결 또는 페어링 상태 확인
    const isBluetoothConnected = window.connectedDevices && window.connectedDevices.powerMeter;
    // Indoor Training 페어링 정보 확인 (iOS 모드 대응)
    // 주의: 파워메터는 deviceId 또는 powerMeterDeviceId에 저장됨
    let isPaired = false;
    if (window.indoorTrainingState && window.indoorTrainingState.powerMeters) {
      isPaired = window.indoorTrainingState.powerMeters.some(pm => {
        const deviceId = pm.deviceId || pm.powerMeterDeviceId;
        return deviceId && deviceId.toString().trim() !== '';
      });
    }
    const isConnected = isBluetoothConnected || isPaired;
    
    if (isConnected) {
      img.src = "assets/img/power_g.png";
      btnPM.classList.add("connected");
      console.log("파워미터 연결됨 - power_g.png로 변경", { bluetooth: isBluetoothConnected, paired: isPaired });
    } else {
      img.src = "assets/img/power_i.png";
      btnPM.classList.remove("connected");
      console.log("파워미터 연결 해제 - power_i.png로 변경");
    }
    img.style.display = "block";
    img.style.margin = "0 auto";
  }
  
  // ANT+ 버튼
  const btnANT = document.getElementById("btnConnectANT");
  if (btnANT) {
    // 기존 이미지가 있으면 숨김
    const img = btnANT.querySelector(".device-btn-icon");
    if (img) {
      img.style.display = "none";
    }
    const isConnected = window.connectedDevices && window.connectedDevices.ant;
    if (isConnected) {
      btnANT.classList.add("connected");
      console.log("ANT+ 연결됨");
    } else {
      btnANT.classList.remove("connected");
      console.log("ANT+ 연결 해제");
    }
  }
  
  console.log("Device button images updated", {
    trainer: window.connectedDevices?.trainer ? "connected" : "disconnected",
    heartRate: window.connectedDevices?.heartRate ? "connected" : "disconnected",
    powerMeter: window.connectedDevices?.powerMeter ? "connected" : "disconnected",
    ant: window.connectedDevices?.ant ? "connected" : "disconnected"
  });
}

window.updateDevicesList = window.updateDevicesList || function () {
  const deviceList = document.getElementById("connectedDevicesList");
  if (!deviceList) return;

  let html = "";
  let count = 0;

  if (window.connectedDevices.trainer) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon"><img src="assets/img/trainer_g.png" alt="스마트 트레이너" style="width: 72px; height: 72px; object-fit: contain;" /></div>
          <div class="device-details"><h3>${window.connectedDevices.trainer.name || "Smart Trainer"}</h3>
          <p>Smart Trainer (FTMS)</p></div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }
  if (window.connectedDevices.powerMeter) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon"><img src="assets/img/power_g.png" alt="파워미터" style="width: 72px; height: 72px; object-fit: contain;" /></div>
          <div class="device-details"><h3>${window.connectedDevices.powerMeter.name || "Power Meter"}</h3>
          <p>Crank Power (CPS)</p></div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }
  if (window.connectedDevices.heartRate) {
    count++;
    html += `
      <div class="card device-card connected">
        <div class="device-info">
          <div class="device-icon"><img src="assets/img/bpm_g.png" alt="심박계" style="width: 72px; height: 72px; object-fit: contain;" /></div>
          <div class="device-details"><h3>${window.connectedDevices.heartRate.name || "Heart Rate"}</h3>
          <p>Heart Rate (HRS)</p></div>
        </div>
        <div style="color:#28A745;font-weight:600;">연결됨</div>
      </div>`;
  }

  deviceList.innerHTML = html;
  
  // 버튼 이미지 업데이트
  updateDeviceButtonImages();
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

    // iOS/Bluefy 대응: filters 실패 시 acceptAllDevices 폴백
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: ["fitness_machine"] },
          { services: ["cycling_power"] },
          { namePrefix: "KICKR" },
          { namePrefix: "Wahoo" },
          { namePrefix: "Tacx" },
        ],
        optionalServices: ["fitness_machine", "cycling_power", "device_information"],
      });
    } catch (filterError) {
      // iOS/Bluefy에서 filters가 실패할 경우 acceptAllDevices로 재시도
      console.log("⚠️ Filters로 검색 실패, acceptAllDevices로 재시도:", filterError);
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["fitness_machine", "cycling_power", "device_information"],
      });
    }

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
      // FTMS Control Point 서비스 및 특성 가져오기 (ERG 모드용)
      let controlPointService = null;
      let controlPointCharacteristic = null;
      try {
        controlPointService = await server.getPrimaryService("fitness_machine");
        // Control Point 특성 UUID: 0x2AD9
        try {
          controlPointCharacteristic = await controlPointService.getCharacteristic("fitness_machine_control_point");
        } catch {
          // UUID로 직접 시도
          controlPointCharacteristic = await controlPointService.getCharacteristic(0x2AD9);
        }
        console.log('✅ FTMS Control Point 연결 성공 (ERG 모드 지원)');
      } catch (err) {
        console.warn('⚠️ FTMS Control Point 연결 실패 (ERG 모드 미지원 가능):', err);
      }
      
      window.connectedDevices.trainer = { 
        name: device.name || "Smart Trainer", 
        device, 
        server, 
        characteristic,
        controlPoint: controlPointCharacteristic // ERG 모드용
      };
      
      // ERG 모드 UI 표시
      if (typeof updateErgModeUI === 'function') {
        updateErgModeUI(true);
      }
    } else {
      window.connectedDevices.powerMeter = { name: device.name || "Power Meter", device, server, characteristic };
    }

    device.addEventListener("gattserverdisconnected", () => {
      try {
        if (window.connectedDevices.trainer?.device === device) {
          // ERG 모드 비활성화
          if (window.ergModeState && window.ergModeState.enabled && typeof toggleErgMode === 'function') {
            toggleErgMode(false);
          }
          window.connectedDevices.trainer = null;
          // ERG 모드 UI 숨김
          if (typeof updateErgModeUI === 'function') {
            updateErgModeUI(false);
          }
        }
        if (window.connectedDevices.powerMeter?.device === device) window.connectedDevices.powerMeter = null;
        updateDevicesList();
        // 연결 해제 시 버튼 이미지 업데이트
        if (typeof window.updateDeviceButtonImages === "function") {
          setTimeout(() => window.updateDeviceButtonImages(), 100);
        }
      } catch (e) { console.warn(e); }
    });

    updateDevicesList();
    // 버튼 이미지 즉시 업데이트
    if (typeof window.updateDeviceButtonImages === "function") {
      setTimeout(() => window.updateDeviceButtonImages(), 100);
    }
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "Trainer"} 연결 성공`);
   
     
  } catch (err) {
    showConnectionStatus(false);
    console.error("트레이너 연결 오류:", err);
    showToast("❌ 트레이너 연결 실패: " + err.message);
    // 연결 실패 시에도 버튼 이미지 업데이트
    if (typeof window.updateDeviceButtonImages === "function") {
      setTimeout(() => window.updateDeviceButtonImages(), 100);
    }
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
    window.connectedDevices.powerMeter = { name: device.name || "Power Meter", device, server, characteristic: ch };

    device.addEventListener("gattserverdisconnected", () => {
      if (window.connectedDevices.powerMeter?.device === device) window.connectedDevices.powerMeter = null;
      updateDevicesList();
      // 연결 해제 시 버튼 이미지 업데이트
      if (typeof window.updateDeviceButtonImages === "function") {
        setTimeout(() => window.updateDeviceButtonImages(), 100);
      }
    });

    updateDevicesList();
    // 버튼 이미지 즉시 업데이트
    if (typeof window.updateDeviceButtonImages === "function") {
      setTimeout(() => window.updateDeviceButtonImages(), 100);
    }
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "Power Meter"} 연결 성공`);
    

     
  } catch (err) {
    showConnectionStatus(false);
    console.error("파워미터 연결 오류:", err);
    showToast("❌ 파워미터 연결 실패: " + err.message);
    // 연결 실패 시에도 버튼 이미지 업데이트
    if (typeof window.updateDeviceButtonImages === "function") {
      setTimeout(() => window.updateDeviceButtonImages(), 100);
    }
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

    window.connectedDevices.heartRate = { 
      name: device.name || "Heart Rate", 
      device, 
      server, 
      characteristic: ch 
    };

    device.addEventListener("gattserverdisconnected", () => {
      if (window.connectedDevices.heartRate?.device === device) {
        window.connectedDevices.heartRate = null;
      }
      updateDevicesList();
    });

    updateDevicesList();
    // 버튼 이미지 즉시 업데이트
    if (typeof window.updateDeviceButtonImages === "function") {
      setTimeout(() => window.updateDeviceButtonImages(), 100);
    }
    showConnectionStatus(false);
    showToast(`✅ ${device.name || "HR"} 연결 성공`);
    
  } catch (err) {
    showConnectionStatus(false);
    console.error("심박계 연결 오류:", err);
    showToast("❌ 심박계 연결 실패: " + err.message);
    // 연결 실패 시에도 버튼 이미지 업데이트
    if (typeof window.updateDeviceButtonImages === "function") {
      setTimeout(() => window.updateDeviceButtonImages(), 100);
    }
  }
}


// ──────────────────────────────────────────────────────────
// 파워미터 알림 파서 보강 (크랭크 데이터 → RPM 계산)
// ──────────────────────────────────────────────────────────
// 파일 상단(모듈 스코프)에 이전 값 저장용 상태 추가


// 파워미터 측정 알림
// 2. 파워미터 상태 변수 (기존과 동일)
let powerMeterState = { lastCrankRevs: null, lastCrankEventTime: null };
let powerMeterCadenceLastTs = 0;
const POWER_METER_CADENCE_TTL = 3000; // ms

// 3. handlePowerMeterData 함수를 다음으로 완전히 교체
// 파워미터 상태 저장용
//const powerMeterState = { lastCrankRevs: null, lastCrankEventTime: null };

// ⚡ CPS 측정 알림 파서 (Cycling Power Measurement: 0x2A63)
function handlePowerMeterData(event) {
  const dv = event.target.value; // DataView
  let off = 0;

  // 1) Flags, Instantaneous Power
  const flags = dv.getUint16(off, true); off += 2;
  const instPower = dv.getInt16(off, true); off += 2;
  if (!Number.isNaN(instPower)) {
    window.liveData.power = instPower;
    // ERG 모드용 데이터 버퍼 업데이트
    if (!window._recentPowerBuffer) window._recentPowerBuffer = [];
    window._recentPowerBuffer.push(instPower);
    if (window._recentPowerBuffer.length > 120) { // 최근 2분 (1초당 1개 가정)
      window._recentPowerBuffer.shift();
    }
  }

  // 2) 옵션 필드 스킵
  if (flags & CPS_FLAG.PEDAL_POWER_BALANCE_PRESENT) off += 1; // 1 byte
  if (flags & CPS_FLAG.ACC_TORQUE_PRESENT)          off += 2; // 2 byte
  if (flags & CPS_FLAG.WHEEL_REV_DATA_PRESENT)      off += 6; // uint32 + uint16

  // 3) Crank Revolution Data → 케이던스(RPM)
  if (flags & CPS_FLAG.CRANK_REV_DATA_PRESENT) {
    const crankRevs = dv.getUint16(off, true); off += 2;
    const lastCrankTime = dv.getUint16(off, true); off += 2; // 1/1024s

    if (powerMeterState.lastCrankRevs !== null && powerMeterState.lastCrankEventTime !== null) {
      let dRevs = crankRevs - powerMeterState.lastCrankRevs;
      if (dRevs < 0) dRevs += 0x10000; // uint16 롤오버

      let dTicks = lastCrankTime - powerMeterState.lastCrankEventTime;
      if (dTicks < 0) dTicks += 0x10000; // uint16 롤오버

      if (dRevs > 0 && dTicks > 0) {
        const dtSec = dTicks / 1024;
        const rpm = (dRevs / dtSec) * 60;
        if (rpm > 0 && rpm < 220) {
          window.liveData.cadence = Math.round(rpm);
          // ERG 모드용 데이터 버퍼 업데이트
          if (!window._recentCadenceBuffer) window._recentCadenceBuffer = [];
          window._recentCadenceBuffer.push(Math.round(rpm));
          if (window._recentCadenceBuffer.length > 120) {
            window._recentCadenceBuffer.shift();
          }
        }
      }
    }
    powerMeterState.lastCrankRevs = crankRevs;
    powerMeterState.lastCrankEventTime = lastCrankTime;
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
    // ERG 모드용 데이터 버퍼 업데이트
    if (!window._recentCadenceBuffer) window._recentCadenceBuffer = [];
    window._recentCadenceBuffer.push(Math.round(rpm));
    if (window._recentCadenceBuffer.length > 120) {
      window._recentCadenceBuffer.shift();
    }
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
    // ERG 모드용 데이터 버퍼 업데이트
    if (!window._recentPowerBuffer) window._recentPowerBuffer = [];
    window._recentPowerBuffer.push(p);
    if (window._recentPowerBuffer.length > 120) {
      window._recentPowerBuffer.shift();
    }
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
  // ERG 모드용 데이터 버퍼 업데이트
  if (!window._recentHRBuffer) window._recentHRBuffer = [];
  window._recentHRBuffer.push(Math.round(hr));
  if (window._recentHRBuffer.length > 120) {
    window._recentHRBuffer.shift();
  }
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
