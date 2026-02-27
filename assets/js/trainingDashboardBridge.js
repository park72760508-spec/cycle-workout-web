/**
 * trainingDashboardBridge.js (Dual Pipeline 업그레이드)
 * - 앱(App) vs 웹(Web) 환경 분기: isAppEnvironment 시 연결 버튼 클릭 가로채기(UI 보호)
 * - deviceConnected/deviceError 시 UI 녹색/회색 유지
 * - Track 1 (App): powerUpdate, trainerUpdate, speedUpdate 파싱 → liveData + 기존 DOM 업데이트 경로 재사용
 */

(function (global) {
  'use strict';

  var isAppEnvironment = !!global.ReactNativeWebView;

  var TARGET_SCREENS = ['trainingScreen', 'mobileDashboardScreen', 'bluetoothTrainingCoachScreen'];
  var AUTO_CONNECT_SENT_KEY = '_stelvioTrainingAutoConnectSent';

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
  var powerUpdateHandlerRef = null;
  var trainerUpdateHandlerRef = null;
  var speedUpdateHandlerRef = null;

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
    var off = 0;
    var flags = dv.getUint16(off, true); off += 2;
    var speedRaw = dv.getUint16(off, true); off += 2;
    // FTMS Indoor Bike Data 0x2AD2: Instantaneous Speed 단위는 0.01 km/h (트레드밀 0.001 m/s와 혼동 주의)
    var speedKmh = speedRaw / 100.0;
    if (flags & 0x0002) off += 2;
    if (flags & 0x0004) {
      var cadenceRaw = dv.getUint16(off, true); off += 2;
      var rpm = Math.round(cadenceRaw * 0.5);
      if (!global.liveData) global.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
      global.liveData.cadence = rpm;
      if (typeof global.notifyChildWindows === 'function') global.notifyChildWindows('cadence', rpm);
    }
    if (flags & 0x0008) off += 2;
    if (flags & 0x0010) off += 3;
    if (flags & 0x0020) off += 2;
    if (flags & 0x0040) {
      var p = dv.getInt16(off, true);
      if (!Number.isNaN(p)) {
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

  function interceptConnectButton() {
    if (!isAppEnvironment || _originalConnectMobileBluetoothDevice !== null) return;
    _originalConnectMobileBluetoothDevice = global.connectMobileBluetoothDevice;
    if (typeof _originalConnectMobileBluetoothDevice !== 'function') return;
    global.connectMobileBluetoothDevice = function (deviceType, savedDeviceId) {
      alert('앱 환경에서는 메인 메뉴의 [센서 연결]에서 기기를 관리합니다.');
      return Promise.resolve();
    };
  }

  // ---------- AUTO_CONNECT / deviceError / deviceConnected (기존 유지) ----------

  function sendAutoConnectOnce() {
    if (global[AUTO_CONNECT_SENT_KEY]) return;
    var api = global.StelvioDeviceBridgeStorage;
    if (!api || typeof api.loadSavedDevices !== 'function') return;
    var savedDevices = api.loadSavedDevices();
    if (!savedDevices || typeof savedDevices !== 'object') return;
    var keys = Object.keys(savedDevices);
    if (keys.length === 0) return;
    var post = global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function';
    if (!post) return;
    try {
      global.ReactNativeWebView.postMessage(JSON.stringify({ type: 'AUTO_CONNECT', devices: savedDevices }));
      global[AUTO_CONNECT_SENT_KEY] = true;
      if (typeof console !== 'undefined' && console.log) {
        console.log('[trainingDashboardBridge] AUTO_CONNECT sent', keys);
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[trainingDashboardBridge] AUTO_CONNECT postMessage failed', e);
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
    setDeviceErrorUI(String(deviceType));
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
    if (typeof console !== 'undefined' && console.log) {
      console.log('[trainingDashboardBridge] deviceConnected', deviceType, detail.deviceId);
    }
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

  function mountTrainingDashboardBridge() {
    sendAutoConnectOnce();
    if (deviceErrorHandlerRef !== null) return;
    deviceErrorHandlerRef = onDeviceError;
    deviceConnectedHandlerRef = onDeviceConnected;
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('deviceError', deviceErrorHandlerRef);
      global.addEventListener('deviceConnected', deviceConnectedHandlerRef);
    }
    if (isAppEnvironment) {
      powerUpdateHandlerRef = onPowerUpdate;
      trainerUpdateHandlerRef = onTrainerUpdate;
      speedUpdateHandlerRef = onSpeedUpdate;
      global.addEventListener('powerUpdate', powerUpdateHandlerRef);
      global.addEventListener('trainerUpdate', trainerUpdateHandlerRef);
      global.addEventListener('speedUpdate', speedUpdateHandlerRef);
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
    }
    global[AUTO_CONNECT_SENT_KEY] = false;
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
      }
      prevScreen = screenId;
    };
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

  if (isAppEnvironment) {
    if (typeof global.connectMobileBluetoothDevice === 'function') {
      interceptConnectButton();
    } else {
      if (typeof global.addEventListener === 'function') {
        global.addEventListener('DOMContentLoaded', function onReady() {
          global.removeEventListener('DOMContentLoaded', onReady);
          interceptConnectButton();
        });
      }
    }
  }

  global.StelvioTrainingDashboardBridge = {
    isAppEnvironment: isAppEnvironment,
    TARGET_SCREENS: TARGET_SCREENS,
    mount: mountTrainingDashboardBridge,
    teardown: teardownTrainingDashboardBridge,
    setDeviceErrorUI: setDeviceErrorUI,
    setDeviceConnectedUI: setDeviceConnectedUI,
    parsePowerUpdate: parsePowerUpdate,
    parseTrainerUpdate: parseTrainerUpdate,
    parseSpeedUpdate: parseSpeedUpdate
  };
})(typeof window !== 'undefined' ? window : this);
