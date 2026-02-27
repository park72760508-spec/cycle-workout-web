/**
 * trainingDashboardBridge.js (업그레이드)
 * - 대상 화면 3종: trainingScreen, mobileDashboardScreen, bluetoothTrainingCoachScreen
 * - AUTO_CONNECT: 대시보드 진입 시 발송, 이탈 시 플래그 리셋으로 재진입 시 재연결 시도
 * - deviceError: 해당 deviceType UI 회색(끊김) 처리 (노트북+모바일 동시 반영)
 * - deviceConnected: 해당 deviceType UI 녹색 "연결됨" 상태로 동기화
 * - 메모리 누수 방지: 대시보드 이탈 시 리스너 제거
 */

(function (global) {
  'use strict';

  var TARGET_SCREENS = ['trainingScreen', 'mobileDashboardScreen', 'bluetoothTrainingCoachScreen'];
  var AUTO_CONNECT_SENT_KEY = '_stelvioTrainingAutoConnectSent';

  /**
   * deviceType별 UI 매핑 (노트북 + 모바일 등 다중 화면 동시 갱신).
   * 각 타입당 { item, status } 배열로 모든 화면의 요소 ID를 나열.
   */
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

  function isTargetScreen(screenId) {
    return TARGET_SCREENS.indexOf(screenId) !== -1;
  }

  function wasOnTargetScreen(prevScreen) {
    return prevScreen != null && isTargetScreen(prevScreen);
  }

  /**
   * 저장된 기기 명단으로 앱에 AUTO_CONNECT 발송.
   * StelvioDeviceBridgeStorage 모듈 재사용, 키워드 하드코딩 없음.
   */
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

  /**
   * deviceType에 해당하는 모든 UI를 회색(연결 끊김/실패) 상태로 변경.
   * @param {string} deviceType - 'hr' | 'heartRate' | 'power' | 'powerMeter' | 'trainer'
   */
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

  /**
   * deviceType에 해당하는 모든 UI를 녹색(연결됨) 상태로 변경. device-error 제거.
   * @param {string} deviceType - 'hr' | 'heartRate' | 'power' | 'powerMeter' | 'trainer'
   */
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

  /**
   * deviceError 이벤트 핸들러 (동일 참조로 등록/해제).
   */
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

  /**
   * deviceConnected 이벤트 핸들러 (동일 참조로 등록/해제).
   * 앱에서 연결 성공 시 매핑된 모든 UI를 "연결됨" 상태로 동기화.
   */
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

  /**
   * 대시보드 마운트: AUTO_CONNECT 1회 발송 + deviceError / deviceConnected 리스너 등록.
   */
  function mountTrainingDashboardBridge() {
    sendAutoConnectOnce();
    if (deviceErrorHandlerRef !== null) return;
    deviceErrorHandlerRef = onDeviceError;
    deviceConnectedHandlerRef = onDeviceConnected;
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('deviceError', deviceErrorHandlerRef);
      global.addEventListener('deviceConnected', deviceConnectedHandlerRef);
    }
  }

  /**
   * 대시보드 언마운트: 리스너 제거 + AUTO_CONNECT 플래그 리셋 (재진입 시 재연결 시도 보장).
   */
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
    }
    global[AUTO_CONNECT_SENT_KEY] = false;
  }

  /**
   * showScreen 래핑: TARGET_SCREENS 진입 시 mount, 이탈 시 teardown.
   */
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

  global.StelvioTrainingDashboardBridge = {
    TARGET_SCREENS: TARGET_SCREENS,
    mount: mountTrainingDashboardBridge,
    teardown: teardownTrainingDashboardBridge,
    setDeviceErrorUI: setDeviceErrorUI,
    setDeviceConnectedUI: setDeviceConnectedUI
  };
})(typeof window !== 'undefined' ? window : this);
