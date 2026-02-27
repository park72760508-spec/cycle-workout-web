/**
 * trainingDashboardBridge.js
 * 훈련 대시보드(trainingScreen) 마운트 시 AUTO_CONNECT 발송, deviceError 수신 시 UI 회색(끊김) 처리
 * - 메모리 누수 방지: 화면 이탈 시 deviceError 리스너 제거
 */

(function (global) {
  'use strict';

  var DASHBOARD_SCREEN_ID = 'trainingScreen';
  var AUTO_CONNECT_SENT_KEY = '_stelvioTrainingAutoConnectSent';

  // deviceType(앱) → [dropdown item id, status span id]
  var DEVICE_UI_IDS = {
    hr: { item: 'trainingScreenBluetoothHRItem', status: 'trainingScreenHeartRateStatus' },
    heartRate: { item: 'trainingScreenBluetoothHRItem', status: 'trainingScreenHeartRateStatus' },
    power: { item: 'trainingScreenBluetoothPMItem', status: 'trainingScreenPowerMeterStatus' },
    powerMeter: { item: 'trainingScreenBluetoothPMItem', status: 'trainingScreenPowerMeterStatus' },
    trainer: { item: 'trainingScreenBluetoothTrainerItem', status: 'trainingScreenTrainerStatus' }
  };

  var deviceErrorHandlerRef = null;

  /**
   * 저장된 기기 명단으로 앱에 AUTO_CONNECT 발송 (마운트 시 1회만).
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
   * deviceType에 해당하는 UI를 회색(연결 끊김/실패) 상태로 변경.
   * @param {string} deviceType - 'hr' | 'heartRate' | 'power' | 'powerMeter' | 'trainer'
   */
  function setDeviceErrorUI(deviceType) {
    var ui = DEVICE_UI_IDS[deviceType];
    if (!ui) return;
    var itemEl = document.getElementById(ui.item);
    var statusEl = document.getElementById(ui.status);
    if (statusEl) {
      statusEl.textContent = '연결 끊김';
      statusEl.classList.add('device-error');
      statusEl.style.color = '#9ca3af';
      statusEl.style.opacity = '1';
    }
    if (itemEl) {
      itemEl.classList.add('device-error');
      itemEl.style.opacity = '0.6';
      itemEl.style.color = '#9ca3af';
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
   * 훈련 대시보드 마운트: AUTO_CONNECT 1회 발송 + deviceError 리스너 등록.
   */
  function mountTrainingDashboardBridge() {
    sendAutoConnectOnce();
    if (deviceErrorHandlerRef !== null) return;
    deviceErrorHandlerRef = onDeviceError;
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('deviceError', deviceErrorHandlerRef);
    }
  }

  /**
   * 훈련 대시보드 언마운트: deviceError 리스너 제거 (메모리 누수 방지).
   */
  function teardownTrainingDashboardBridge() {
    if (deviceErrorHandlerRef === null) return;
    if (typeof global.removeEventListener === 'function') {
      global.removeEventListener('deviceError', deviceErrorHandlerRef);
    }
    deviceErrorHandlerRef = null;
  }

  /**
   * showScreen 래핑: trainingScreen 진입 시 mount, 이탈 시 teardown.
   */
  function wrapShowScreen() {
    var original = global.showScreen;
    if (typeof original !== 'function') return;
    var prevScreen = null;
    global.showScreen = function (screenId) {
      if (prevScreen === DASHBOARD_SCREEN_ID && screenId !== DASHBOARD_SCREEN_ID) {
        teardownTrainingDashboardBridge();
      }
      original(screenId);
      if (screenId === DASHBOARD_SCREEN_ID) {
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
    mount: mountTrainingDashboardBridge,
    teardown: teardownTrainingDashboardBridge,
    setDeviceErrorUI: setDeviceErrorUI
  };
})(typeof window !== 'undefined' ? window : this);
