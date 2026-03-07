/**
 * trainingDashboardBridge.js (Dual Pipeline 업그레이드)
 * - 앱(App) vs 웹(Web) 환경 분기: isAppEnvironment 시 연결 버튼 클릭 가로채기(UI 보호)
 * - deviceConnected/deviceError 시 UI 녹색/회색 유지 + connectedDevices 반영(연결 버튼/목록 동기화)
 * - Track 1 (App): powerUpdate, trainerUpdate, speedUpdate, heartRateUpdate 파싱 → liveData + 기존 DOM 업데이트 경로 재사용
 * - 앱에서 심박 표시: heartRateUpdate 이벤트로 detail = BPM 숫자 또는 [flags, bpm] 배열 전달
 */

(function (global) {
  'use strict';

  /** 스크립트 로드 시점 값. 앱에서는 WebView 주입이 늦을 수 있으므로 런타임에 재확인 */
  var isAppEnvironment = !!(typeof global !== 'undefined' && global.ReactNativeWebView);
  function isAppEnvironmentNow() {
    try {
      return !!(typeof global !== 'undefined' && (global.ReactNativeWebView || global.StelvioInApp));
    } catch (e) {
      return false;
    }
  }
  /** 웹 환경에서 Native 전용 객체 호출 방지: 앱 환경에서만 postMessage 실행 */
  function safePostToNative(messageObj) {
    try {
      if (typeof global === 'undefined' || !global.ReactNativeWebView || typeof global.ReactNativeWebView.postMessage !== 'function') return false;
      global.ReactNativeWebView.postMessage(JSON.stringify(messageObj));
      return true;
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[trainingDashboardBridge] Native postMessage failed', e);
      return false;
    }
  }

  var TARGET_SCREENS = ['trainingScreen', 'mobileDashboardScreen', 'bluetoothTrainingCoachScreen'];
  var AUTO_CONNECT_SENT_KEY = '_stelvioTrainingAutoConnectSent';
  /** 자동 연결 진행 중 플래그 — 사용자 수동 클릭 시 중단(Abort)용 */
  var AUTO_CONNECT_IN_PROGRESS_KEY = '_stelvioAutoConnectInProgress';
  var AUTO_CONNECT_TIMEOUT_MS = 20000;
  var _autoConnectTimeoutId = null;
  /** 브릿지 미주입 시 재시도 간격(ms). 앱에서 ReactNativeWebView가 늦게 들어올 수 있음 */
  var AUTO_CONNECT_RETRY_DELAYS_MS = [100, 300, 600, 1000, 2000];
  var _autoConnectRetryCount = 0;
  /** REQUEST_AUTO_CONNECT 전송 전 대기(ms). 앱/WebView가 메시지 수신 준비될 시간 확보 */
  var AUTO_CONNECT_SEND_DELAY_MS = 350;

  /** 파워/케이던스 소스 선택: 'powerMeter' | 'trainer' | null(미선택). 파워미터·스마트트레이너 동시 연결 시 팝업으로 선택 */
  var POWER_CADENCE_SOURCE_KEY = '_stelvioPowerCadenceSource';

  /**
   * 순간 끊김 디바운스: deviceError 수신 후 이 시간(ms) 이내에 deviceConnected 오면 해제로 간주하지 않음.
   * 15초: 일시 끊김과 실제 방전/이탈 구분, 재연결 여유 확보.
   */
  var DISCONNECT_DEBOUNCE_MS = 15000;
  var _disconnectDebounceTimers = {};

  var DEVICE_UI_MAP = {
    hr: [
      { item: 'trainingScreenBluetoothHRItem', status: 'trainingScreenHeartRateStatus' },
      { item: 'mobileBluetoothHRItem', status: 'mobileHeartRateStatus' }
    ],
    heartRate: [
      { item: 'trainingScreenBluetoothHRItem', status: 'trainingScreenHeartRateStatus' },
      { item: 'mobileBluetoothHRItem', status: 'mobileHeartRateStatus' }
    ],
    power: [
      { item: 'trainingScreenBluetoothPMItem', status: 'trainingScreenPowerMeterStatus' },
      { item: 'mobileBluetoothPMItem', status: 'mobilePowerMeterStatus' }
    ],
    powerMeter: [
      { item: 'trainingScreenBluetoothPMItem', status: 'trainingScreenPowerMeterStatus' },
      { item: 'mobileBluetoothPMItem', status: 'mobilePowerMeterStatus' }
    ],
    speed: [
      { item: 'trainingScreenBluetoothSpeedItem', status: 'trainingScreenSpeedStatus' },
      { item: 'mobileBluetoothSpeedItem', status: 'mobileSpeedStatus' }
    ],
    trainer: [
      { item: 'trainingScreenBluetoothTrainerItem', status: 'trainingScreenTrainerStatus' },
      { item: 'mobileBluetoothTrainerItem', status: 'mobileTrainerStatus' }
    ]
  };

  var deviceErrorHandlerRef = null;
  var deviceConnectedHandlerRef = null;
  var autoConnectStateHandlerRef = null;
  var powerUpdateHandlerRef = null;
  var trainerUpdateHandlerRef = null;
  var speedUpdateHandlerRef = null;
  var speedDataHandlerRef = null;
  var heartRateUpdateHandlerRef = null;

  /** deviceType(앱) → connectedDevices 키 (heartRate, trainer, powerMeter, speed). 다중 센서 개별 반영. smartrola → trainer 매핑 */
  function toConnectedDevicesKey(deviceType) {
    var t = String(deviceType || '').toLowerCase();
    if (t === 'hr' || t === 'heartrate') return 'heartRate';
    if (t === 'power' || t === 'powermeter') return 'powerMeter';
    if (t === 'trainer' || t === 'smartrola') return 'trainer';
    if (t === 'speed') return 'speed';
    return deviceType;
  }

  /** CSC 속도 계산용 이전 휠 데이터 (평로라 규격 재사용) */
  var _lastWheelData = { rev: null, time: null };
  var DEFAULT_WHEEL_CIRCUMFERENCE_MM = 2096;
  /** 파워미터 케이던스 계산용 크랭크 데이터 (앱 powerUpdate 시 케이던스 반영) */
  var _lastCrankDataBridge = {};

  function isTargetScreen(screenId) {
    return TARGET_SCREENS.indexOf(screenId) !== -1;
  }

  function wasOnTargetScreen(prevScreen) {
    return prevScreen != null && isTargetScreen(prevScreen);
  }

  /**
   * 원시 배열을 DataView로 변환 (앱에서 [0, 24, ...] 형태로 전달)
   */
  function arrayToDataView(arr) {
    if (!arr || !arr.length) return null;
    var buf = new ArrayBuffer(arr.length);
    var view = new Uint8Array(buf);
    for (var i = 0; i < arr.length; i++) view[i] = arr[i] & 0xff;
    return new DataView(buf);
  }

  /**
   * liveData 반영 후 기존 화면 업데이트 경로 호출 (훈련화면, 모바일대시보드, bluetoothIndividual)
   */
  function applyLiveDataToScreen() {
    try {
      if (typeof global.updateTrainingDisplay === 'function') global.updateTrainingDisplay();
      if (typeof global.updateMobileDashboardData === 'function') global.updateMobileDashboardData();
      if (typeof global.updateDashboard === 'function') global.updateDashboard();
    } catch (err) {
      if (console && console.warn) console.warn('[trainingDashboardBridge] applyLiveDataToScreen failed', err);
    }
  }

  // ---------- Track 1 (App) 전용 파서 ----------

  /**
   * powerUpdate: BLE Cycling Power (0x1818/0x2a63) 규격
   * Flags(2) + Instantaneous Power(2) + [선택: Pedal 0x01, Torque 0x04, Wheel 0x10, Crank 0x20]
   * 앱에서 파워미터 데이터 수신 시 파워+케이던스 모두 반영 (웹 bluetooth.js handlePowerMeterData와 동일)
   */
  function parsePowerUpdate(detail) {
    if (global[POWER_CADENCE_SOURCE_KEY] === 'trainer') return;
    var arr = detail;
    if (!Array.isArray(arr) || arr.length < 4) return;
    var dv = arrayToDataView(arr);
    if (!dv) return;
    var off = 0;
    var flags = dv.getUint16(off, true); off += 2;
    var instPower = dv.getInt16(off, true); off += 2;
    if (Number.isNaN(instPower)) return;
    if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    global.liveData.power = instPower;
    global._lastPowerUpdateTime = Date.now();
    if (instPower > 0) global._lastPowerNonZeroTime = Date.now();
    if (typeof global.addPowerToBuffer === 'function') global.addPowerToBuffer(instPower);
    if (global.ergController && typeof global.ergController.updatePower === 'function') {
      global.ergController.updatePower(instPower);
    }
    if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('power', instPower);
    // 선택 필드 스킵 후 Crank Revolution Data(0x0020) 파싱 — 케이던스 반영
    if (flags & 0x0001) off += 1;
    if (flags & 0x0004) off += 2;
    if (flags & 0x0010) off += 6;
    if (flags & 0x0020 && arr.length >= off + 4) {
      var cumulativeCrankRevolutions = dv.getUint16(off, true); off += 2;
      var lastCrankEventTime = dv.getUint16(off, true); off += 2;
      var deviceKey = (global.connectedDevices && global.connectedDevices.trainer) ? 'trainer' : 'powerMeter';
      var lastData = _lastCrankDataBridge[deviceKey];
      if (lastData && lastCrankEventTime !== lastData.lastCrankEventTime) {
        var timeDiff = lastCrankEventTime - lastData.lastCrankEventTime;
        if (timeDiff < 0) timeDiff += 65536;
        var revDiff = cumulativeCrankRevolutions - lastData.cumulativeCrankRevolutions;
        if (revDiff < 0) revDiff += 65536;
        if (timeDiff > 0 && revDiff > 0) {
          var timeInSeconds = timeDiff / 1024.0;
          var cadence = Math.round((revDiff / timeInSeconds) * 60);
          if (cadence > 0 && cadence <= 250) {
            global.liveData.cadence = cadence;
            if (!global._lastCadenceUpdateTime) global._lastCadenceUpdateTime = {};
            global._lastCadenceUpdateTime[deviceKey] = Date.now();
            if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('cadence', cadence);
          }
        }
      }
      _lastCrankDataBridge[deviceKey] = { cumulativeCrankRevolutions: cumulativeCrankRevolutions, lastCrankEventTime: lastCrankEventTime };
    }
    applyLiveDataToScreen();
  }

  /**
   * trainerUpdate: FTMS (0x1826/0x2ad2) 규격
   * Flags(2), Instantaneous Speed(2), [Avg Speed], [Cadence], [Avg Cadence], [Total Distance], [Resistance], [Power]
   */
  function parseTrainerUpdate(detail) {
    var arr = detail;
    if (!Array.isArray(arr) || arr.length < 4) return;
    var dv = arrayToDataView(arr);
    if (!dv) return;
    var usePowerCadence = global[POWER_CADENCE_SOURCE_KEY] !== 'powerMeter';
    var off = 0;
    var flags = dv.getUint16(off, true); off += 2;
    var speedRaw = dv.getUint16(off, true); off += 2;
    var speedKmh = speedRaw / 100.0;
    if (flags & 0x0002) off += 2;
    if (flags & 0x0004) {
      var cadenceRaw = dv.getUint16(off, true); off += 2;
      var rpm = Math.round(cadenceRaw * 0.5);
      if (usePowerCadence) {
        if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
        global.liveData.cadence = rpm;
        if (!global._lastCadenceUpdateTime) global._lastCadenceUpdateTime = {};
        global._lastCadenceUpdateTime.trainer = Date.now();
        if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('cadence', rpm);
      }
    }
    if (flags & 0x0008) off += 2;
    if (flags & 0x0010) off += 3;
    if (flags & 0x0020) off += 2;
    if (flags & 0x0040) {
      var p = dv.getInt16(off, true);
      if (!Number.isNaN(p) && usePowerCadence) {
        if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
        global.liveData.power = p;
        global._lastPowerUpdateTime = Date.now();
        if (p > 0) global._lastPowerNonZeroTime = Date.now();
        if (typeof global.addPowerToBuffer === 'function') global.addPowerToBuffer(p);
        if (global.ergController && typeof global.ergController.updatePower === 'function') {
          global.ergController.updatePower(p);
        }
        if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('power', p);
      }
    }
    if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    global.liveData.speed = speedKmh;
    global._lastSpeedUpdateTime = Date.now();
    if (typeof window !== 'undefined') window._lastSpeedUpdateTime = global._lastSpeedUpdateTime;
    applyLiveDataToScreen();
  }

  /**
   * speedUpdate: CSC (0x1816/0x2a5b) 규격
   * Flags(1), [Wheel rev(4) + Last wheel time(2)], [Crank rev(2) + Last crank time(2)]
   * 속도: 평로라 대회용 계산(회전수 기반) 또는 누적 휠 회전수 기반
   */
  function parseSpeedUpdate(detail) {
    var arr = detail;
    if (!Array.isArray(arr) || arr.length < 1) return;
    var dv = arrayToDataView(arr);
    if (!dv) return;
    var off = 0;
    var flags = dv.getUint8(off); off += 1;
    if (flags & 0x01 && arr.length >= 7) {
      var currentRev = dv.getUint32(off, true); off += 4;
      var currentTime = dv.getUint16(off, true); off += 2;
      var last = _lastWheelData;
      if (last.rev !== null && last.time !== null) {
        var revDiff = currentRev - last.rev;
        var timeDiff = currentTime - last.time;
        if (revDiff < 0) revDiff += 4294967296;
        if (timeDiff < 0) timeDiff += 65536; // 16비트 롤오버 보정 (Last Wheel Event Time uint16)
        if (timeDiff > 0 && revDiff > 0) {
          // (바퀴 차이 * 둘레 mm / 1000) = 이동 거리(m), (시간 차이 / 1024) = 걸린 시간(초), m/s → km/h * 3.6
          var speedKmh = (revDiff * DEFAULT_WHEEL_CIRCUMFERENCE_MM * 1024 * 3.6) / (timeDiff * 1000);
          if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
          global.liveData.speed = Math.min(speedKmh, 999);
          global._lastSpeedUpdateTime = Date.now();
          if (typeof window !== 'undefined') window._lastSpeedUpdateTime = global._lastSpeedUpdateTime;
          applyLiveDataToScreen();
        }
      }
      _lastWheelData = { rev: currentRev, time: currentTime };
    }
    if (flags & 0x02 && arr.length >= off + 4) {
      var crankRev = dv.getUint16(off, true); off += 2;
      var crankTime = dv.getUint16(off, true); off += 2;
      if (!global._lastCrankData) global._lastCrankData = {};
      var deviceKey = 'speedSensor';
      var lastData = global._lastCrankData[deviceKey];
      if (lastData && crankTime !== lastData.lastCrankEventTime) {
        var timeDiff = crankTime - lastData.lastCrankEventTime;
        if (timeDiff < 0) timeDiff += 65536; // 16비트 롤오버 보정
        var revDiff = crankRev - lastData.cumulativeCrankRevolutions;
        if (revDiff < 0) revDiff += 65536;
        if (timeDiff > 0 && revDiff > 0) {
          var timeInSeconds = timeDiff / 1024.0;
          var cadence = Math.round((revDiff / timeInSeconds) * 60);
          if (cadence > 0 && cadence <= 250 && global.liveData) {
            global.liveData.cadence = cadence;
            if (!global._lastCadenceUpdateTime) global._lastCadenceUpdateTime = {};
            global._lastCadenceUpdateTime.speedSensor = Date.now();
            if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('cadence', cadence);
            applyLiveDataToScreen();
          }
        }
      }
      global._lastCrankData[deviceKey] = { cumulativeCrankRevolutions: crankRev, lastCrankEventTime: crankTime };
    }
  }

  // ---------- 연결 버튼 클릭 가로채기 (앱 환경) ----------

  var _originalConnectMobileBluetoothDevice = null;

  /** 훈련 화면에서 연결 버튼 클릭 시: Device Settings를 오버레이 팝업으로 표시 (화면 이탈 없음) */
  function openDeviceSettingPopup() {
    var overlay = document.getElementById('deviceSettingOverlay');
    var popupContent = document.getElementById('deviceSettingPopupContent');
    var screenEl = document.getElementById('deviceSettingScreen');
    if (!overlay || !popupContent || !screenEl) return;
    var container = screenEl.querySelector('.connection-main-container');
    if (!container) return;
    popupContent.innerHTML = '';
    popupContent.appendChild(container);
    var backBtn = container.querySelector('.connection-header button[aria-label="뒤로 가기"], .connection-header button[onclick*="basecamp"]');
    if (backBtn) {
      backBtn._originalOnClick = backBtn.onclick;
      backBtn.onclick = function () { if (typeof global.closeDeviceSettingPopup === 'function') global.closeDeviceSettingPopup(); };
    }
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    if (typeof global.StelvioDeviceSettings !== 'undefined' && typeof global.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') {
      global.StelvioDeviceSettings.refreshDeviceSettingCards();
    }
  }

  function closeDeviceSettingPopup() {
    if (isAppEnvironmentNow() && typeof safePostToNative === 'function') {
      safePostToNative({ type: 'ABORT_AUTO_CONNECT' });
    }
    var overlay = document.getElementById('deviceSettingOverlay');
    var popupContent = document.getElementById('deviceSettingPopupContent');
    var screenEl = document.getElementById('deviceSettingScreen');
    if (!overlay || !popupContent || !screenEl) return;
    var container = popupContent.querySelector('.connection-main-container');
    if (container) {
      var backBtn = container.querySelector('.connection-header button[aria-label="뒤로 가기"], .connection-header button[onclick*="basecamp"]');
      if (backBtn && backBtn._originalOnClick != null) {
        backBtn.onclick = backBtn._originalOnClick;
      }
      screenEl.appendChild(container);
    }
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    if (global.self !== global.top) {
      try { global.parent.postMessage({ type: 'CLOSE_DEVICE_SETTINGS_OVERLAY' }, '*'); } catch (e) {}
    }
  }

  var _interceptConnectButtonDone = false;
  /** 앱 환경: 연결 버튼 클릭 시 자동 연결 중단 후 Device Settings를 오버레이 팝업으로 표시 */
  function interceptConnectButton() {
    if (_interceptConnectButtonDone) return;
    if (!isAppEnvironmentNow()) return;
    _interceptConnectButtonDone = true;
    var origToggle = global.toggleBluetoothDropdown;
    var origMobileToggle = global.toggleMobileBluetoothDropdown;
    if (typeof origToggle === 'function') {
      global.toggleBluetoothDropdown = function (context) {
        abortAutoConnect();
        if (typeof global.openDeviceSettingPopup === 'function') {
          global.openDeviceSettingPopup();
        } else if (typeof global.showScreen === 'function') {
          global.showScreen('deviceSettingScreen');
        } else {
          origToggle(context);
        }
      };
    }
    if (typeof origMobileToggle === 'function') {
      global.toggleMobileBluetoothDropdown = function () {
        abortAutoConnect();
        if (typeof global.openDeviceSettingPopup === 'function') {
          global.openDeviceSettingPopup();
        } else if (typeof global.showScreen === 'function') {
          global.showScreen('deviceSettingScreen');
        } else {
          origMobileToggle();
        }
      };
    }
    _originalConnectMobileBluetoothDevice = global.connectMobileBluetoothDevice;
    if (typeof _originalConnectMobileBluetoothDevice === 'function') {
      global.connectMobileBluetoothDevice = function (deviceType, savedDeviceId) {
        abortAutoConnect();
        if (typeof global.openDeviceSettingPopup === 'function') {
          global.openDeviceSettingPopup();
        } else if (typeof global.showScreen === 'function') {
          global.showScreen('deviceSettingScreen');
        } else {
          _originalConnectMobileBluetoothDevice(deviceType, savedDeviceId);
        }
        return Promise.resolve();
      };
    }
  }

  // ---------- REQUEST_AUTO_CONNECT / 앱 '연결 중' 신호 / deviceConnected ----------
  // 훈련 화면 진입 시 앱에 REQUEST_AUTO_CONNECT 전송 → 앱이 기억한 기기로 자동 연결.
  // 앱에서 '연결 중' 신호(stelvio-auto-connect-state)가 오면 버튼 옆에 상태 표시, 성공 시 deviceConnected로 데이터 노출.
  // 수동: 연결 버튼 클릭 시 목록(드롭다운) 유지, 목록에서 기기 클릭 시만 상세 연결 흐름.

  /** 연결 버튼 왼쪽에 '연결 중...' + 로딩 인디케이터 표시 (O 연결중,, [연결 버튼] 형태) */
  function setAutoConnectStatusNextToButton(buttonEl, show, text) {
    if (!buttonEl || !buttonEl.parentNode) return;
    var statusId = buttonEl.id ? 'stelvio-auto-connect-wrap-' + buttonEl.id : null;
    var wrapEl = statusId ? document.getElementById(statusId) : buttonEl.parentNode.querySelector('.stelvio-auto-connect-status-wrap');
    if (show && text) {
      if (!wrapEl) {
        wrapEl = document.createElement('span');
        wrapEl.className = 'stelvio-auto-connect-status-wrap';
        if (statusId) wrapEl.id = statusId;
        wrapEl.style.cssText = 'display:inline-flex;align-items:center;margin-right:8px;white-space:nowrap;gap:6px;';
        var spinner = document.createElement('span');
        spinner.className = 'stelvio-auto-connect-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        var textEl = document.createElement('span');
        textEl.className = 'stelvio-auto-connect-status';
        wrapEl.appendChild(spinner);
        wrapEl.appendChild(textEl);
        buttonEl.parentNode.insertBefore(wrapEl, buttonEl);
      }
      var textNode = wrapEl.querySelector('.stelvio-auto-connect-status');
      if (textNode) textNode.textContent = text;
      wrapEl.style.display = '';
    } else if (wrapEl) {
      wrapEl.style.display = 'none';
      var t = wrapEl.querySelector('.stelvio-auto-connect-status');
      if (t) t.textContent = '';
    }
  }

  /** 연결 버튼 문구 + 버튼 옆 상태 표시 (연결중 / 연결). 앱 'connecting' 시 '연결 중...' + 로딩 인디케이터 */
  function setConnectButtonConnectingLabel(connecting) {
    var mobileBtn = document.getElementById('mobileBluetoothConnectBtn');
    var tsBtn = document.getElementById('trainingScreenBluetoothConnectBtn');
    var label = connecting ? '연결중' : '연결';
    var statusText = connecting ? '연결 중...' : '';
    if (mobileBtn) {
      var span = mobileBtn.querySelector('span');
      if (span) span.textContent = label;
      mobileBtn.classList.toggle('auto-connecting', !!connecting);
      setAutoConnectStatusNextToButton(mobileBtn, !!connecting, statusText);
    }
    if (tsBtn) {
      var spanTs = tsBtn.querySelector('span');
      if (spanTs) spanTs.textContent = label;
      tsBtn.classList.toggle('auto-connecting', !!connecting);
      setAutoConnectStatusNextToButton(tsBtn, !!connecting, statusText);
    }
  }

  /** 자동 연결 진행 종료(성공/실패/타임아웃): 플래그 해제, 버튼 문구 복구, UI 갱신 */
  function clearAutoConnectInProgress() {
    if (_autoConnectTimeoutId != null) {
      clearTimeout(_autoConnectTimeoutId);
      _autoConnectTimeoutId = null;
    }
    global[AUTO_CONNECT_IN_PROGRESS_KEY] = false;
    setConnectButtonConnectingLabel(false);
    if (typeof global.updateMobileBluetoothConnectionStatus === 'function') {
      global.updateMobileBluetoothConnectionStatus();
    }
  }

  /** 사용자 수동 연결 버튼 클릭 시 호출: 자동 연결 즉시 중단 후 수동 검색(Device Settings)으로 유도 */
  function abortAutoConnect() {
    if (!global[AUTO_CONNECT_IN_PROGRESS_KEY]) return;
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] AUTO_CONNECT aborted by user');
    }
    try {
      safePostToNative({ type: 'ABORT_AUTO_CONNECT' });
    } catch (e) {}
    clearAutoConnectInProgress();
  }

  /**
   * 훈련 화면 진입 시 앱에 자동 연결 요청. (앱 WebView 전용 — 웹 전용에서는 표시/요청 없음)
   * - 진입 시 즉시 '연결중' 표시(낙관적). ReactNativeWebView가 없으면 재시도(100,300,600,1000,2000ms).
   */
  function sendRequestAutoConnect() {
    if (!isAppEnvironmentNow()) return;
    _autoConnectRetryCount = 0;
    global[AUTO_CONNECT_IN_PROGRESS_KEY] = true;
    setConnectButtonConnectingLabel(true);
    if (_autoConnectTimeoutId != null) clearTimeout(_autoConnectTimeoutId);
    _autoConnectTimeoutId = setTimeout(function () {
      _autoConnectTimeoutId = null;
      if (global[AUTO_CONNECT_IN_PROGRESS_KEY]) {
        clearAutoConnectInProgress();
      }
    }, AUTO_CONNECT_TIMEOUT_MS);

    function tryPost() {
      var post = isAppEnvironmentNow();
      if (!post) {
        var idx = _autoConnectRetryCount;
        if (idx < AUTO_CONNECT_RETRY_DELAYS_MS.length) {
          var delay = AUTO_CONNECT_RETRY_DELAYS_MS[idx];
          _autoConnectRetryCount += 1;
          if (typeof console !== 'undefined' && console.log) {
            console.log('[trainingDashboardBridge] ReactNativeWebView 대기 중, ' + delay + 'ms 후 재시도 (' + (_autoConnectRetryCount) + '/' + AUTO_CONNECT_RETRY_DELAYS_MS.length + ')');
          }
          setTimeout(tryPost, delay);
          return;
        }
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[trainingDashboardBridge] sendRequestAutoConnect: 재시도 후에도 ReactNativeWebView 없음');
        }
        return;
      }
      _autoConnectRetryCount = 0;
      function doSend() {
        try {
          var payload = { type: 'REQUEST_AUTO_CONNECT' };
          if (global.StelvioDeviceBridgeStorage && typeof global.StelvioDeviceBridgeStorage.loadSavedDevices === 'function') {
            var saved = global.StelvioDeviceBridgeStorage.loadSavedDevices();
            if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
              payload.devices = {};
              var names = (typeof global.StelvioDeviceBridgeStorage.loadSavedDeviceNames === 'function')
                ? global.StelvioDeviceBridgeStorage.loadSavedDeviceNames() : {};
              var list = [];
              var keys = ['hr', 'power', 'trainer', 'speed'];
              for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                var id = saved[k];
                if (!id) continue;
                payload.devices[k] = id;
                if (k === 'trainer') payload.devices.smartrola = id;
                list.push({
                  deviceType: k,
                  deviceId: id,
                  deviceName: (names && names[k]) ? names[k] : ''
                });
              }
              if (list.length > 0) payload.devicesList = list;
              if (names && typeof names === 'object') payload.deviceNames = names;
            }
          }
          if (safePostToNative(payload)) {
            global[AUTO_CONNECT_SENT_KEY] = true;
            if (typeof console !== 'undefined' && console.log) {
              console.log('[trainingDashboardBridge] REQUEST_AUTO_CONNECT 발송됨', payload);
            }
          }
        } catch (e) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[trainingDashboardBridge] REQUEST_AUTO_CONNECT postMessage failed', e);
          }
        }
      }
      if (AUTO_CONNECT_SEND_DELAY_MS > 0) {
        setTimeout(doSend, AUTO_CONNECT_SEND_DELAY_MS);
      } else {
        doSend();
      }
    }
    tryPost();
  }

  function setDeviceErrorUI(deviceType) {
    var list = DEVICE_UI_MAP[deviceType];
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var ui = list[i];
      var itemEl = document.getElementById(ui.item);
      var statusEl = document.getElementById(ui.status);
      if (statusEl) {
        statusEl.textContent = '연결해제';
        statusEl.classList.add('device-error');
        statusEl.classList.remove('device-connected');
        statusEl.style.color = '#9ca3af';
        statusEl.style.opacity = '1';
      }
      if (itemEl) {
        itemEl.classList.add('device-error');
        itemEl.classList.remove('device-connected');
        itemEl.style.opacity = '0.6';
        itemEl.style.color = '#9ca3af';
      }
    }
  }

  function setDeviceConnectedUI(deviceType) {
    var list = DEVICE_UI_MAP[deviceType];
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var ui = list[i];
      var itemEl = document.getElementById(ui.item);
      var statusEl = document.getElementById(ui.status);
      if (statusEl) {
        statusEl.textContent = '연결됨';
        statusEl.classList.remove('device-error');
        statusEl.classList.add('device-connected');
        statusEl.style.color = '#00d4aa';
        statusEl.style.opacity = '1';
      }
      if (itemEl) {
        itemEl.classList.remove('device-error');
        itemEl.classList.add('device-connected');
        itemEl.style.opacity = '1';
        itemEl.style.color = '';
      }
    }
  }

  /** 디바운스 후 실제 연결 해제 적용: connectedDevices 갱신, liveData 0 리셋, UI, 전역 플래그, 이벤트 */
  function applyDisconnect(key, deviceType) {
    if (global.connectedDevices && key) global.connectedDevices[key] = null;
    if (typeof global.resetLiveDataForDevice === 'function') {
      try { global.resetLiveDataForDevice(key); } catch (e) {}
    }
    if (key === 'powerMeter' || key === 'trainer') {
      if (!global.connectedDevices.powerMeter && !global.connectedDevices.trainer) {
        global[POWER_CADENCE_SOURCE_KEY] = null;
      }
    }
    if (!global._stelvioDisconnectedTypes) global._stelvioDisconnectedTypes = {};
    global._stelvioDisconnectedTypes[key] = Date.now();
    setDeviceErrorUI(String(deviceType));
    if (typeof global.updateMobileBluetoothConnectionStatus === 'function') {
      global.updateMobileBluetoothConnectionStatus();
    }
    try {
      global.dispatchEvent(new CustomEvent('stelvio-connection-lost', { detail: { deviceType: deviceType, key: key } }));
    } catch (evErr) {}
    if (typeof global.StelvioDeviceSettings !== 'undefined' && typeof global.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') {
      try { global.StelvioDeviceSettings.refreshDeviceSettingCards(); } catch (e) {}
    }
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] 연결해제 적용', deviceType, key);
    }
    notifyBluetoothChildWindows('deviceError', { deviceType: deviceType, key: key });
  }

  function onDeviceError(e) {
    var detail = e && e.detail;
    if (!detail) return;
    var deviceType = detail.deviceType != null ? detail.deviceType : detail.type;
    if (!deviceType) return;
    var key = toConnectedDevicesKey(deviceType);
    if (!key) return;
    var hadConnection = !!(global.connectedDevices && global.connectedDevices[key]);
    if (!hadConnection) {
      if (_disconnectDebounceTimers[key]) {
        clearTimeout(_disconnectDebounceTimers[key]);
        _disconnectDebounceTimers[key] = null;
      }
      if (typeof console !== 'undefined' && console.log) {
        console.log('[trainingDashboardBridge] deviceError 무시 (연결된 적 없음, "연결 해제" 미표시)', deviceType, key);
      }
      return;
    }
    if (_disconnectDebounceTimers[key]) {
      clearTimeout(_disconnectDebounceTimers[key]);
      _disconnectDebounceTimers[key] = null;
    }
    _disconnectDebounceTimers[key] = setTimeout(function () {
      _disconnectDebounceTimers[key] = null;
      applyDisconnect(key, deviceType);
    }, DISCONNECT_DEBOUNCE_MS);
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] deviceError(디바운스 ' + DISCONNECT_DEBOUNCE_MS + 'ms)', deviceType, detail.deviceId);
    }
  }

  function onDeviceConnected(e) {
    var detail = e && e.detail;
    if (!detail) return;
    var deviceType = detail.deviceType != null ? detail.deviceType : detail.type;
    if (!deviceType) return;
    var key = toConnectedDevicesKey(deviceType);
    if (key && _disconnectDebounceTimers[key]) {
      clearTimeout(_disconnectDebounceTimers[key]);
      _disconnectDebounceTimers[key] = null;
    }
    if (key && global._stelvioDisconnectedTypes) {
      delete global._stelvioDisconnectedTypes[key];
    }
    setDeviceConnectedUI(String(deviceType));
    if (!global.connectedDevices) global.connectedDevices = { trainer: null, powerMeter: null, heartRate: null, speed: null };
    if (key) {
      global.connectedDevices[key] = {
        name: detail.deviceName || detail.name || '연결됨',
        deviceId: detail.deviceId || detail.id
      };
    }
    if (global[AUTO_CONNECT_IN_PROGRESS_KEY]) {
      clearAutoConnectInProgress();
    } else if (typeof global.updateMobileBluetoothConnectionStatus === 'function') {
      global.updateMobileBluetoothConnectionStatus();
    }
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] deviceConnected', deviceType, detail.deviceId, '(connectedDevices 반영)');
    }
    // 트레이너만 연결된 경우 파워/케이던스 소스를 trainer로 자동 설정 (앱이 trainerUpdate 보내면 즉시 표시)
    if (key === 'trainer') {
      var hasPm = global.connectedDevices && global.connectedDevices.powerMeter;
      if (!hasPm && (global[POWER_CADENCE_SOURCE_KEY] == null)) {
        global[POWER_CADENCE_SOURCE_KEY] = 'trainer';
        if (typeof console !== 'undefined' && console.log) {
          console.log('[trainingDashboardBridge] 트레이너만 연결됨 → 파워/케이던스 소스: trainer (trainerUpdate 수신 시 표시)');
        }
      }
    }
    tryShowPowerSourceSelectPopup();
    notifyBluetoothChildWindows('deviceConnected', detail);
  }

  function openPowerSourceSelectPopup() {
    var overlay = document.getElementById('powerSourceSelectOverlay');
    var pmName = document.getElementById('powerSourcePowerMeterName');
    var trName = document.getElementById('powerSourceTrainerName');
    if (!overlay) return;
    var pm = global.connectedDevices && global.connectedDevices.powerMeter;
    var tr = global.connectedDevices && global.connectedDevices.trainer;
    if (pmName) pmName.textContent = pm && pm.name ? pm.name : '—';
    if (trName) trName.textContent = tr && tr.name ? tr.name : '—';
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closePowerSourceSelectPopup() {
    var overlay = document.getElementById('powerSourceSelectOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function setPowerCadenceSource(source) {
    if (source === 'powerMeter' || source === 'trainer') {
      global[POWER_CADENCE_SOURCE_KEY] = source;
      if (typeof console !== 'undefined' && console.log) {
        console.log('[trainingDashboardBridge] 파워/케이던스 소스 선택:', source);
      }
    }
    closePowerSourceSelectPopup();
    applyLiveDataToScreen();
  }

  var _powerSourcePopupBound = false;
  function bindPowerSourceSelectPopup() {
    if (_powerSourcePopupBound) return;
    _powerSourcePopupBound = true;
    var btnPm = document.getElementById('powerSourceSelectPowerMeter');
    var btnTr = document.getElementById('powerSourceSelectTrainer');
    if (btnPm) btnPm.addEventListener('click', function () { setPowerCadenceSource('powerMeter'); });
    if (btnTr) btnTr.addEventListener('click', function () { setPowerCadenceSource('trainer'); });
  }

  function tryShowPowerSourceSelectPopup() {
    if (!global.connectedDevices) return;
    var pm = global.connectedDevices.powerMeter;
    var tr = global.connectedDevices.trainer;
    if (!pm || !tr) return;
    if (global[POWER_CADENCE_SOURCE_KEY] != null) return;
    bindPowerSourceSelectPopup();
    openPowerSourceSelectPopup();
  }

  function onPowerUpdate(e) {
    var detail = e && e.detail;
    if (detail != null) parsePowerUpdate(Array.isArray(detail) ? detail : (detail.data || detail.payload));
  }

  function onTrainerUpdate(e) {
    var detail = e && e.detail;
    if (detail == null) return;
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] trainerUpdate 수신', Array.isArray(detail) ? '배열(' + detail.length + ')' : detail);
    }
    if (detail && typeof detail === 'object' && !Array.isArray(detail) && (detail.power != null || detail.cadence != null || detail.speed != null)) {
      applyTrainerUpdateSimple(detail);
      return;
    }
    parseTrainerUpdate(Array.isArray(detail) ? detail : (detail.data || detail.payload));
  }

  /** 앱이 파싱한 값을 보낼 때: detail = { power?, cadence?, speed? } → liveData 반영 */
  function applyTrainerUpdateSimple(detail) {
    if (global[POWER_CADENCE_SOURCE_KEY] === 'powerMeter') return;
    if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    var changed = false;
    if (detail.power != null && !Number.isNaN(Number(detail.power))) {
      var p = Math.round(Number(detail.power));
      if (p >= 0 && p <= 2000) {
        global.liveData.power = p;
        if (typeof global.addPowerToBuffer === 'function') global.addPowerToBuffer(p);
        if (global.ergController && typeof global.ergController.updatePower === 'function') global.ergController.updatePower(p);
        if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('power', p);
        changed = true;
      }
    }
    if (detail.cadence != null && !Number.isNaN(Number(detail.cadence))) {
      var c = Math.round(Number(detail.cadence));
      if (c >= 0 && c <= 250) {
        global.liveData.cadence = c;
        if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('cadence', c);
        changed = true;
      }
    }
    if (detail.speed != null && !Number.isNaN(Number(detail.speed))) {
      var s = Number(detail.speed);
      if (s >= 0 && s < 1000) {
        global.liveData.speed = s;
        global._lastSpeedUpdateTime = Date.now();
        if (typeof window !== 'undefined') window._lastSpeedUpdateTime = global._lastSpeedUpdateTime;
      }
      changed = true;
    }
    if (changed) applyLiveDataToScreen();
  }

  /**
   * 앱이 파싱한 속도만 보낼 때: detail = { deviceId?, speed } (km/h) → liveData.speed 반영
   */
  function applySpeedUpdateSimple(detail) {
    if (!detail || typeof detail !== 'object' || Number.isNaN(Number(detail.speed))) return;
    var speedKmh = Number(detail.speed);
    if (speedKmh < 0 || speedKmh >= 1000) return;
    if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    global.liveData.speed = Math.min(speedKmh, 999);
    global._lastSpeedUpdateTime = Date.now();
    if (typeof window !== 'undefined') window._lastSpeedUpdateTime = global._lastSpeedUpdateTime;
    if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('speed', speedKmh);
    applyLiveDataToScreen();
  }

  function onSpeedUpdate(e) {
    var detail = e && e.detail;
    if (detail == null) return;
    if (typeof detail === 'object' && !Array.isArray(detail) && detail.speed != null) {
      applySpeedUpdateSimple(detail);
      return;
    }
    var raw = Array.isArray(detail) ? detail : (detail.data || detail.payload);
    if (raw != null) parseSpeedUpdate(raw);
  }

  /** 앱이 CustomEvent('speedData', { detail: { deviceId, speed } }) 로 보낼 때 */
  function onSpeedData(e) {
    var detail = e && e.detail;
    if (detail && typeof detail === 'object' && detail.speed != null) applySpeedUpdateSimple(detail);
  }

  /**
   * heartRateUpdate: 앱에서 심박수(BPM) 전달 시 liveData.heartRate 반영 (하이브리드 표시용)
   * payload: number(bpm) | { bpm, heartRate } | 배열(BLE 0x2A37: [flags, bpm] 또는 [flags, bpmLo, bpmHi])
   */
  function parseHeartRateUpdate(detail) {
    var bpm = null;
    if (typeof detail === 'number' && !Number.isNaN(detail)) {
      bpm = Math.max(0, Math.min(255, Math.round(detail)));
    } else if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      bpm = detail.bpm != null ? Number(detail.bpm) : detail.heartRate != null ? Number(detail.heartRate) : null;
      if (bpm != null && !Number.isNaN(bpm)) bpm = Math.max(0, Math.min(255, Math.round(bpm)));
    } else if (Array.isArray(detail) && detail.length >= 2) {
      var flags = detail[0] & 0xff;
      if (flags & 0x01 && detail.length >= 3) {
        bpm = (detail[1] & 0xff) | ((detail[2] & 0xff) << 8);
      } else {
        bpm = detail[1] & 0xff;
      }
      if (bpm != null && !Number.isNaN(bpm)) bpm = Math.max(0, Math.min(255, bpm));
    }
    if (bpm == null || Number.isNaN(bpm)) return;
    if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    global.liveData.heartRate = bpm;
    global._lastHeartRateUpdateTime = Date.now();
    if (global.ergController && typeof global.ergController.updateHeartRate === 'function') {
      try { global.ergController.updateHeartRate(bpm); } catch (err) {}
    }
    applyLiveDataToScreen();
  }

  function onHeartRateUpdate(e) {
    var detail = e && e.detail;
    if (detail != null) parseHeartRateUpdate(Array.isArray(detail) ? detail : (detail && (detail.data != null || detail.payload != null) ? (detail.data || detail.payload) : detail));
  }

  /** 앱에서 보내는 '연결 중' 신호 수신. detail.state: 'connecting' | 'connected' | 'idle' */
  function onAutoConnectState(e) {
    var state = e && e.detail && e.detail.state;
    if (state === 'connecting') {
      global[AUTO_CONNECT_IN_PROGRESS_KEY] = true;
      setConnectButtonConnectingLabel(true);
      if (typeof console !== 'undefined' && console.log) {
        console.log('[trainingDashboardBridge] stelvio-auto-connect-state: connecting');
      }
    } else if (state === 'connected' || state === 'idle') {
      if (global[AUTO_CONNECT_IN_PROGRESS_KEY]) clearAutoConnectInProgress();
      if (state === 'connected' && typeof global.updateMobileBluetoothConnectionStatus === 'function') {
        global.updateMobileBluetoothConnectionStatus();
      }
    }
    notifyBluetoothChildWindows('stelvio-auto-connect-state', (e && e.detail) ? e.detail : {});
  }

  /** 블루투스 개인 훈련 창(자식 창)에 연결/해제/자동연결 상태 전달 — 모바일과 동일 로직 반영용 */
  function notifyBluetoothChildWindows(msgType, detail) {
    var list = global._bluetoothChildWindows;
    if (!list || !list.length) return;
    list = list.filter(function (w) { return w && !w.closed; });
    global._bluetoothChildWindows = list;
    for (var i = 0; i < list.length; i++) {
      try {
        list[i].postMessage({ type: msgType, detail: detail || {} }, '*');
      } catch (err) {}
    }
  }

  /** deviceError/deviceConnected는 페이지 로드 시 1회만 등록. 훈련 화면 여부와 무관하게 연결 해제 시 UI 반영 */
  var _connectionListenersRegistered = false;
  function registerConnectionListenersOnce() {
    if (_connectionListenersRegistered) return;
    _connectionListenersRegistered = true;
    deviceErrorHandlerRef = onDeviceError;
    deviceConnectedHandlerRef = onDeviceConnected;
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('deviceError', deviceErrorHandlerRef);
      global.addEventListener('deviceConnected', deviceConnectedHandlerRef);
    }
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] deviceError/deviceConnected 리스너 등록 (연결 해제 시 훈련/Device Settings 반영)');
    }
  }

  function mountTrainingDashboardBridge() {
    registerConnectionListenersOnce();
    if (autoConnectStateHandlerRef !== null) return;
    autoConnectStateHandlerRef = onAutoConnectState;
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('stelvio-auto-connect-state', autoConnectStateHandlerRef);
    }
    if (isAppEnvironmentNow()) {
      powerUpdateHandlerRef = onPowerUpdate;
      trainerUpdateHandlerRef = onTrainerUpdate;
      speedUpdateHandlerRef = onSpeedUpdate;
      speedDataHandlerRef = onSpeedData;
      heartRateUpdateHandlerRef = onHeartRateUpdate;
      global.addEventListener('powerUpdate', powerUpdateHandlerRef);
      global.addEventListener('trainerUpdate', trainerUpdateHandlerRef);
      global.addEventListener('speedUpdate', speedUpdateHandlerRef);
      global.addEventListener('speedData', speedDataHandlerRef);
      global.addEventListener('heartRateUpdate', heartRateUpdateHandlerRef);
    }
  }

  function teardownTrainingDashboardBridge() {
    if (typeof global.removeEventListener === 'function') {
      if (autoConnectStateHandlerRef !== null) {
        global.removeEventListener('stelvio-auto-connect-state', autoConnectStateHandlerRef);
        autoConnectStateHandlerRef = null;
      }
      if (powerUpdateHandlerRef !== null) {
        global.removeEventListener('powerUpdate', powerUpdateHandlerRef);
        powerUpdateHandlerRef = null;
      }
      if (trainerUpdateHandlerRef !== null) {
        global.removeEventListener('trainerUpdate', trainerUpdateHandlerRef);
        trainerUpdateHandlerRef = null;
      }
      if (speedUpdateHandlerRef !== null) {
        global.removeEventListener('speedUpdate', speedUpdateHandlerRef);
        speedUpdateHandlerRef = null;
      }
      if (speedDataHandlerRef !== null) {
        global.removeEventListener('speedData', speedDataHandlerRef);
        speedDataHandlerRef = null;
      }
      if (heartRateUpdateHandlerRef !== null) {
        global.removeEventListener('heartRateUpdate', heartRateUpdateHandlerRef);
        heartRateUpdateHandlerRef = null;
      }
    }
    global[AUTO_CONNECT_SENT_KEY] = false;
    global[AUTO_CONNECT_IN_PROGRESS_KEY] = false;
    _lastActiveTargetScreenId = null;
    if (_autoConnectTimeoutId != null) {
      clearTimeout(_autoConnectTimeoutId);
      _autoConnectTimeoutId = null;
    }
    setConnectButtonConnectingLabel(false);
  }

  /** 현재 활성(보이는) 화면 ID 반환. .active 클래스 또는 display !== 'none' 기준 */
  function getActiveScreenId() {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      var el = screens[i];
      var id = el.id;
      if (!id) continue;
      if (el.classList.contains('active')) return id;
      var style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(el) : null;
      if (style && style.display !== 'none') return id;
    }
    return null;
  }

  var _stelvioShowScreenWrapped = false;
  function wrapShowScreen() {
    var current = global.showScreen;
    if (typeof current !== 'function') return;
    if (current._stelvioTrainingBridgeWrap) return;
    var original = current;
    _stelvioShowScreenWrapped = true;
    var prevScreen = null;
    function wrappedShowScreen(screenId, skipHistory) {
      if (wasOnTargetScreen(prevScreen) && !isTargetScreen(screenId)) {
        teardownTrainingDashboardBridge();
      }
      original(screenId, skipHistory);
      if (isTargetScreen(screenId)) {
        mountTrainingDashboardBridge();
        sendRequestAutoConnect();
        tryShowPowerSourceSelectPopup();
        if (typeof console !== 'undefined' && console.log) {
          console.log('[trainingDashboardBridge] 훈련 화면 진입(showScreen) → REQUEST_AUTO_CONNECT, screenId=', screenId);
        }
      }
      prevScreen = screenId;
    }
    wrappedShowScreen._stelvioTrainingBridgeWrap = true;
    global.showScreen = wrappedShowScreen;
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] showScreen 래핑 완료');
    }
  }

  /** 훈련 화면이 DOM에서 active가 된 것을 감지해 자동연결 트리거 (showScreen 미호출 시 폴백) */
  var _lastActiveTargetScreenId = null;
  function onTargetScreenBecameActive(screenId) {
    if (!screenId || !isTargetScreen(screenId)) return;
    if (_lastActiveTargetScreenId === screenId) return;
    _lastActiveTargetScreenId = screenId;
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] 훈련 화면 active 감지 → 자동연결 트리거, screenId=', screenId);
    }
    mountTrainingDashboardBridge();
    sendRequestAutoConnect();
    tryShowPowerSourceSelectPopup();
  }
  function checkActiveScreenForAutoConnect() {
    var activeId = getActiveScreenId();
    if (activeId && isTargetScreen(activeId)) {
      onTargetScreenBecameActive(activeId);
    } else {
      _lastActiveTargetScreenId = null;
    }
  }
  var _observerRef = null;
  var _checkActiveDebounceTimer = null;
  function startActiveScreenObserver() {
    if (_observerRef) return;
    try {
      var body = global.document && global.document.body;
      if (!body) return;
      _observerRef = new MutationObserver(function () {
        if (_checkActiveDebounceTimer) clearTimeout(_checkActiveDebounceTimer);
        _checkActiveDebounceTimer = setTimeout(function () {
          _checkActiveDebounceTimer = null;
          checkActiveScreenForAutoConnect();
        }, 150);
      });
      _observerRef.observe(body, { attributes: true, attributeFilter: ['class'], subtree: true, childList: false });
      if (typeof console !== 'undefined' && console.log) {
        console.log('[trainingDashboardBridge] 훈련 화면 active 감시(MutationObserver) 시작');
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[trainingDashboardBridge] MutationObserver 실패', e);
    }
  }
  /** 앱/디버깅용: 훈련 화면에서 수동으로 자동연결 트리거 */
  function triggerAutoConnectNow() {
    mountTrainingDashboardBridge();
    sendRequestAutoConnect();
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] triggerAutoConnectNow() 호출됨');
    }
  }
  /** 주기적으로 showScreen이 덮어씌워졌는지 확인 후 재래핑 */
  function ensureShowScreenWrapped() {
    if (typeof global.showScreen !== 'function') return;
    if (global.showScreen._stelvioTrainingBridgeWrap) return;
    _stelvioShowScreenWrapped = false;
    wrapShowScreen();
  }

  var _initialAutoConnectDone = false;
  function tryInitialAutoConnect() {
    if (_initialAutoConnectDone) return;
    var activeId = getActiveScreenId();
    if (activeId && isTargetScreen(activeId)) {
      _initialAutoConnectDone = true;
      mountTrainingDashboardBridge();
      sendRequestAutoConnect();
      tryShowPowerSourceSelectPopup();
      if (typeof console !== 'undefined' && console.log) {
        console.log('[trainingDashboardBridge] 초기 화면이 훈련 화면 → REQUEST_AUTO_CONNECT 시도, screenId=', activeId, 'inApp=', isAppEnvironmentNow());
      }
    }
  }

  function installShowScreenAndInitialAutoConnect() {
    wrapShowScreen();
    tryInitialAutoConnect();
  }

  if (typeof global.showScreen === 'function') {
    installShowScreenAndInitialAutoConnect();
  }
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('DOMContentLoaded', function onReady() {
      _stelvioShowScreenWrapped = false;
      if (typeof global.showScreen === 'function') wrapShowScreen();
      tryInitialAutoConnect();
      startActiveScreenObserver();
      setTimeout(checkActiveScreenForAutoConnect, 100);
      setTimeout(checkActiveScreenForAutoConnect, 600);
    });
  }
  registerConnectionListenersOnce();
  setTimeout(installShowScreenAndInitialAutoConnect, 0);
  setTimeout(installShowScreenAndInitialAutoConnect, 300);
  setTimeout(function () {
    startActiveScreenObserver();
    checkActiveScreenForAutoConnect();
  }, 100);
  setTimeout(tryInitialAutoConnect, 500);
  setTimeout(tryInitialAutoConnect, 1000);
  setTimeout(tryInitialAutoConnect, 1500);
  var _rewrapCount = 0;
  var _rewrapInterval = setInterval(function () {
    ensureShowScreenWrapped();
    checkActiveScreenForAutoConnect();
    _rewrapCount += 1;
    if (_rewrapCount >= 10) clearInterval(_rewrapInterval);
  }, 2000);
  if (typeof global.document !== 'undefined' && global.document.readyState === 'complete') {
    startActiveScreenObserver();
    checkActiveScreenForAutoConnect();
  }

  function tryInterceptConnectButton() {
    if (!isAppEnvironmentNow()) return;
    if (typeof global.connectMobileBluetoothDevice === 'function' || typeof global.toggleBluetoothDropdown === 'function') {
      interceptConnectButton();
    }
  }
  if (isAppEnvironmentNow()) {
    tryInterceptConnectButton();
  }
  setTimeout(tryInterceptConnectButton, 300);
  setTimeout(tryInterceptConnectButton, 800);
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('DOMContentLoaded', function onReady() {
      tryInterceptConnectButton();
    });
  }

  global.StelvioTrainingDashboardBridge = {
    isAppEnvironment: isAppEnvironment,
    TARGET_SCREENS: TARGET_SCREENS,
    mount: mountTrainingDashboardBridge,
    teardown: teardownTrainingDashboardBridge,
    triggerAutoConnectNow: triggerAutoConnectNow,
    abortAutoConnect: abortAutoConnect,
    openDeviceSettingPopup: openDeviceSettingPopup,
    closeDeviceSettingPopup: closeDeviceSettingPopup,
    closePowerSourceSelectPopup: closePowerSourceSelectPopup,
    setPowerCadenceSource: setPowerCadenceSource,
    setDeviceErrorUI: setDeviceErrorUI,
    setDeviceConnectedUI: setDeviceConnectedUI,
    parsePowerUpdate: parsePowerUpdate,
    parseTrainerUpdate: parseTrainerUpdate,
    parseSpeedUpdate: parseSpeedUpdate,
    parseHeartRateUpdate: parseHeartRateUpdate
  };
  global.abortAutoConnect = abortAutoConnect;
  global.StelvioTriggerAutoConnect = triggerAutoConnectNow;
  global.openDeviceSettingPopup = openDeviceSettingPopup;
  global.closeDeviceSettingPopup = closeDeviceSettingPopup;
  global.closePowerSourceSelectPopup = closePowerSourceSelectPopup;
})(typeof window !== 'undefined' ? window : this);
