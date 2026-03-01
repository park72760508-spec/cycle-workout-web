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
  var isAppEnvironment = !!global.ReactNativeWebView;
  function isAppEnvironmentNow() {
    return !!(global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function');
  }

  var TARGET_SCREENS = ['trainingScreen', 'mobileDashboardScreen', 'bluetoothTrainingCoachScreen'];
  var AUTO_CONNECT_SENT_KEY = '_stelvioTrainingAutoConnectSent';
  /** 자동 연결 진행 중 플래그 — 사용자 수동 클릭 시 중단(Abort)용 */
  var AUTO_CONNECT_IN_PROGRESS_KEY = '_stelvioAutoConnectInProgress';
  var AUTO_CONNECT_TIMEOUT_MS = 20000;
  var _autoConnectTimeoutId = null;

  /** 파워/케이던스 소스 선택: 'powerMeter' | 'trainer' | null(미선택). 파워미터·스마트트레이너 동시 연결 시 팝업으로 선택 */
  var POWER_CADENCE_SOURCE_KEY = '_stelvioPowerCadenceSource';

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
  var heartRateUpdateHandlerRef = null;

  /** deviceType(앱) → connectedDevices 키 (heartRate, trainer, powerMeter, speed). 다중 센서 개별 반영 */
  function toConnectedDevicesKey(deviceType) {
    var t = String(deviceType || '').toLowerCase();
    if (t === 'hr' || t === 'heartrate') return 'heartRate';
    if (t === 'power' || t === 'powermeter') return 'powerMeter';
    if (t === 'trainer') return 'trainer';
    if (t === 'speed') return 'speed';
    return deviceType;
  }

  /** CSC 속도 계산용 이전 휠 데이터 (평로라 규격 재사용) */
  var _lastWheelData = { rev: null, time: null };
  var DEFAULT_WHEEL_CIRCUMFERENCE_MM = 2096;

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
   * liveData 반영 후 기존 화면 업데이트 경로 호출 (재사용)
   */
  function applyLiveDataToScreen() {
    try {
      if (typeof global.updateTrainingDisplay === 'function') {
        global.updateTrainingDisplay();
      }
    } catch (err) {
      if (console && console.warn) console.warn('[trainingDashboardBridge] updateTrainingDisplay failed', err);
    }
  }

  // ---------- Track 1 (App) 전용 파서 ----------

  /**
   * powerUpdate: BLE Cycling Power (0x1818/0x2a63) 규격
   * Flags(2) + Instantaneous Power(2, int16 LE)
   */
  function parsePowerUpdate(detail) {
    if (global[POWER_CADENCE_SOURCE_KEY] === 'trainer') return;
    var arr = detail;
    if (!Array.isArray(arr) || arr.length < 4) return;
    var dv = arrayToDataView(arr);
    if (!dv) return;
    var flags = dv.getUint16(0, true);
    var instPower = dv.getInt16(2, true);
    if (Number.isNaN(instPower)) return;
    if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    global.liveData.power = instPower;
    if (typeof global.addPowerToBuffer === 'function') global.addPowerToBuffer(instPower);
    if (global.ergController && typeof global.ergController.updatePower === 'function') {
      global.ergController.updatePower(instPower);
    }
    if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('power', instPower);
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
        if (typeof global.addPowerToBuffer === 'function') global.addPowerToBuffer(p);
        if (global.ergController && typeof global.ergController.updatePower === 'function') {
          global.ergController.updatePower(p);
        }
        if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('power', p);
      }
    }
    if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    global.liveData.speed = speedKmh;
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

  /** 버튼 옆 '연결 중...' + 로딩 인디케이터 영역 찾기 또는 생성 후 표시/숨김 */
  function setAutoConnectStatusNextToButton(buttonEl, show, text) {
    if (!buttonEl || !buttonEl.parentNode) return;
    var statusId = buttonEl.id ? 'stelvio-auto-connect-wrap-' + buttonEl.id : null;
    var wrapEl = statusId ? document.getElementById(statusId) : buttonEl.parentNode.querySelector('.stelvio-auto-connect-status-wrap');
    if (show && text) {
      if (!wrapEl) {
        wrapEl = document.createElement('span');
        wrapEl.className = 'stelvio-auto-connect-status-wrap';
        if (statusId) wrapEl.id = statusId;
        wrapEl.style.cssText = 'display:inline-flex;align-items:center;margin-left:8px;white-space:nowrap;gap:6px;';
        var spinner = document.createElement('span');
        spinner.className = 'stelvio-auto-connect-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        var textEl = document.createElement('span');
        textEl.className = 'stelvio-auto-connect-status';
        wrapEl.appendChild(spinner);
        wrapEl.appendChild(textEl);
        buttonEl.parentNode.insertBefore(wrapEl, buttonEl.nextSibling);
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
      if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
        global.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ABORT_AUTO_CONNECT' }));
      }
    } catch (e) {}
    clearAutoConnectInProgress();
  }

  /** 훈련 화면 진입 시 앱에 자동 연결 요청 (앱이 기억한 기기로 연결). 트리거만 전송, 버튼 옆 '연결 중' 표시 */
  function sendRequestAutoConnect() {
    var post = global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function';
    if (!post) {
      if (typeof console !== 'undefined' && console.log) {
        console.log('[trainingDashboardBridge] sendRequestAutoConnect: ReactNativeWebView 없음, 스킵');
      }
      return;
    }
    try {
      var payload = { type: 'REQUEST_AUTO_CONNECT' };
      global.ReactNativeWebView.postMessage(JSON.stringify(payload));
      global[AUTO_CONNECT_SENT_KEY] = true;
      global[AUTO_CONNECT_IN_PROGRESS_KEY] = true;
      setConnectButtonConnectingLabel(true);
      if (_autoConnectTimeoutId != null) clearTimeout(_autoConnectTimeoutId);
      _autoConnectTimeoutId = setTimeout(function () {
        _autoConnectTimeoutId = null;
        if (global[AUTO_CONNECT_IN_PROGRESS_KEY]) {
          clearAutoConnectInProgress();
        }
      }, AUTO_CONNECT_TIMEOUT_MS);
      if (typeof console !== 'undefined' && console.log) {
        console.log('[trainingDashboardBridge] REQUEST_AUTO_CONNECT 발송됨', payload);
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[trainingDashboardBridge] REQUEST_AUTO_CONNECT postMessage failed', e);
      }
    }
  }

  function setDeviceErrorUI(deviceType) {
    var list = DEVICE_UI_MAP[deviceType];
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var ui = list[i];
      var itemEl = document.getElementById(ui.item);
      var statusEl = document.getElementById(ui.status);
      if (statusEl) {
        statusEl.textContent = '연결 끊김';
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

  function onDeviceError(e) {
    var detail = e && e.detail;
    if (!detail) return;
    var deviceType = detail.deviceType != null ? detail.deviceType : detail.type;
    if (!deviceType) return;
    var key = toConnectedDevicesKey(deviceType);
    if (global.connectedDevices && key) global.connectedDevices[key] = null;
    if (key === 'powerMeter' || key === 'trainer') {
      if (!global.connectedDevices.powerMeter && !global.connectedDevices.trainer) {
        global[POWER_CADENCE_SOURCE_KEY] = null;
      }
    }
    setDeviceErrorUI(String(deviceType));
    if (typeof global.updateMobileBluetoothConnectionStatus === 'function') {
      global.updateMobileBluetoothConnectionStatus();
    }
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] deviceError', deviceType, detail.deviceId);
    }
  }

  function onDeviceConnected(e) {
    var detail = e && e.detail;
    if (!detail) return;
    var deviceType = detail.deviceType != null ? detail.deviceType : detail.type;
    if (!deviceType) return;
    setDeviceConnectedUI(String(deviceType));
    if (!global.connectedDevices) global.connectedDevices = { trainer: null, powerMeter: null, heartRate: null, speed: null };
    var key = toConnectedDevicesKey(deviceType);
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
    tryShowPowerSourceSelectPopup();
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
    if (detail != null) parseTrainerUpdate(Array.isArray(detail) ? detail : (detail.data || detail.payload));
  }

  function onSpeedUpdate(e) {
    var detail = e && e.detail;
    if (detail != null) parseSpeedUpdate(Array.isArray(detail) ? detail : (detail.data || detail.payload));
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
  }

  function mountTrainingDashboardBridge() {
    if (deviceErrorHandlerRef !== null) return;
    deviceErrorHandlerRef = onDeviceError;
    deviceConnectedHandlerRef = onDeviceConnected;
    autoConnectStateHandlerRef = onAutoConnectState;
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('deviceError', deviceErrorHandlerRef);
      global.addEventListener('deviceConnected', deviceConnectedHandlerRef);
      global.addEventListener('stelvio-auto-connect-state', autoConnectStateHandlerRef);
    }
    if (isAppEnvironment) {
      powerUpdateHandlerRef = onPowerUpdate;
      trainerUpdateHandlerRef = onTrainerUpdate;
      speedUpdateHandlerRef = onSpeedUpdate;
      heartRateUpdateHandlerRef = onHeartRateUpdate;
      global.addEventListener('powerUpdate', powerUpdateHandlerRef);
      global.addEventListener('trainerUpdate', trainerUpdateHandlerRef);
      global.addEventListener('speedUpdate', speedUpdateHandlerRef);
      global.addEventListener('heartRateUpdate', heartRateUpdateHandlerRef);
    }
  }

  function teardownTrainingDashboardBridge() {
    if (typeof global.removeEventListener === 'function') {
      if (deviceErrorHandlerRef !== null) {
        global.removeEventListener('deviceError', deviceErrorHandlerRef);
        deviceErrorHandlerRef = null;
      }
      if (deviceConnectedHandlerRef !== null) {
        global.removeEventListener('deviceConnected', deviceConnectedHandlerRef);
        deviceConnectedHandlerRef = null;
      }
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
      if (heartRateUpdateHandlerRef !== null) {
        global.removeEventListener('heartRateUpdate', heartRateUpdateHandlerRef);
        heartRateUpdateHandlerRef = null;
      }
    }
    global[AUTO_CONNECT_SENT_KEY] = false;
    global[AUTO_CONNECT_IN_PROGRESS_KEY] = false;
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

  function wrapShowScreen() {
    var original = global.showScreen;
    if (typeof original !== 'function') return;
    var prevScreen = null;
    global.showScreen = function (screenId) {
      if (wasOnTargetScreen(prevScreen) && !isTargetScreen(screenId)) {
        teardownTrainingDashboardBridge();
      }
      original(screenId);
      if (isTargetScreen(screenId)) {
        mountTrainingDashboardBridge();
        sendRequestAutoConnect();
        tryShowPowerSourceSelectPopup();
        if (typeof console !== 'undefined' && console.log) {
          console.log('[trainingDashboardBridge] 훈련 화면 진입 → REQUEST_AUTO_CONNECT 시도, screenId=', screenId, 'inApp=', isAppEnvironmentNow());
        }
      }
      prevScreen = screenId;
    };

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

    setTimeout(tryInitialAutoConnect, 0);
    setTimeout(tryInitialAutoConnect, 300);
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('DOMContentLoaded', tryInitialAutoConnect);
    }
  }

  if (typeof global.showScreen === 'function') {
    wrapShowScreen();
  } else {
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('DOMContentLoaded', function onReady() {
        global.removeEventListener('DOMContentLoaded', onReady);
        wrapShowScreen();
      });
    }
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
  global.openDeviceSettingPopup = openDeviceSettingPopup;
  global.closeDeviceSettingPopup = closeDeviceSettingPopup;
  global.closePowerSourceSelectPopup = closePowerSourceSelectPopup;
})(typeof window !== 'undefined' ? window : this);
