/**
 * deviceBridgeStorage.js
 * STELVIO AI - 앱(React Native WebView) → 웹 브릿지: deviceConnected 이벤트 수신 및 localStorage 영구 저장
 *
 * - 전역 CustomEvent 'deviceConnected' 수신
 * - 저장 포맷: { "hr": "F0:13:...", "power": "A1:B2:...", "trainer": "..." } (타입별 병합 유지)
 * - 메모리 누수 방지: setup 시 리스너 등록, teardown 시 removeEventListener
 *
 * 앱(App) 코드 변경 없이 웹 전용 구현.
 */

(function (global) {
  'use strict';

  // 기존 웹 BLE용 stelvio_saved_devices는 배열 포맷 사용 → 브릿지 전용 객체 포맷은 별도 키로 저장해 호환 유지
  var STELVIO_SAVED_DEVICES_KEY = 'stelvio_saved_devices_bridge';

  /**
   * 저장된 기기 맵 로드. 항상 객체 반환 (병합 안전).
   * @returns {{ hr?: string, power?: string, trainer?: string }}
   */
  function loadSavedDevices() {
    try {
      var raw = localStorage.getItem(STELVIO_SAVED_DEVICES_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  /**
   * 단일 타입 기기 저장. 기존 다른 타입은 그대로 두고 병합.
   * @param {string} deviceType - 'hr' | 'power' | 'trainer' (앱에서 오는 값에 따라 매핑 가능)
   * @param {string} deviceId - 기기 ID (예: "F0:13:...")
   */
  function saveDevice(deviceType, deviceId) {
    if (!deviceType || !deviceId) return;
    var saved = loadSavedDevices();
    saved[deviceType] = String(deviceId);
    try {
      localStorage.setItem(STELVIO_SAVED_DEVICES_KEY, JSON.stringify(saved));
      try {
        global.dispatchEvent(new CustomEvent('stelvio-bridge-devices-updated', { detail: saved }));
      } catch (evErr) { /* no-op */ }
    } catch (e) {
      console.warn('[deviceBridgeStorage] saveDevice failed:', e);
    }
  }

  // 앱에서 보낼 수 있는 deviceType → 저장 키 매핑 (요구 포맷 hr, power, trainer)
  var DEVICE_TYPE_TO_KEY = {
    hr: 'hr',
    heartRate: 'hr',
    power: 'power',
    powerMeter: 'power',
    trainer: 'trainer'
  };

  function normalizeDeviceType(deviceType) {
    if (!deviceType) return null;
    var key = String(deviceType).trim();
    return DEVICE_TYPE_TO_KEY[key] || (key in DEVICE_TYPE_TO_KEY ? key : null) || key;
  }

  var boundHandler = null;

  /**
   * deviceConnected 이벤트 핸들러 (동일 참조로 등록/해제)
   */
  function onDeviceConnected(e) {
    var detail = e && e.detail;
    if (!detail) return;
    var deviceType = detail.deviceType != null ? detail.deviceType : detail.type;
    var deviceId = detail.deviceId != null ? detail.deviceId : detail.id;
    if (!deviceId) return;
    var key = normalizeDeviceType(deviceType);
    if (!key) return;
    saveDevice(key, deviceId);
    if (typeof console !== 'undefined' && console.log) {
      console.log('[deviceBridgeStorage] deviceConnected saved:', key, deviceId);
    }
  }

  /**
   * 전역 deviceConnected 리스너 등록. 앱 로드 시 한 번 호출.
   * @returns {function(): void} teardown 함수 (언마운트/소멸 시 호출하여 removeEventListener)
   */
  function setupDeviceConnectedBridge() {
    if (typeof global.addEventListener !== 'function') return function () {};
    if (boundHandler !== null) return function () {}; // 이미 등록됨, 중복 방지
    boundHandler = onDeviceConnected;
    global.addEventListener('deviceConnected', boundHandler);
    return function teardown() {
      if (boundHandler !== null && typeof global.removeEventListener === 'function') {
        global.removeEventListener('deviceConnected', boundHandler);
        boundHandler = null;
      }
    };
  }

  /**
   * 리스너 해제만 수행 (setup에서 반환한 teardown과 동일 동작).
   */
  function teardownDeviceConnectedBridge() {
    if (boundHandler !== null && typeof global.removeEventListener === 'function') {
      global.removeEventListener('deviceConnected', boundHandler);
      boundHandler = null;
    }
  }

  // 전역 노출 (다른 스크립트/React 훅에서 사용 가능)
  global.StelvioDeviceBridgeStorage = {
    STELVIO_SAVED_DEVICES_KEY: STELVIO_SAVED_DEVICES_KEY,
    loadSavedDevices: loadSavedDevices,
    saveDevice: saveDevice,
    setupDeviceConnectedBridge: setupDeviceConnectedBridge,
    teardownDeviceConnectedBridge: teardownDeviceConnectedBridge
  };

  // 스크립트 로드 시 한 번만 전역 리스너 등록, 페이지 이탈 시 해제 (메모리 누수 방지)
  var teardownRef = null;
  if (typeof global.addEventListener === 'function') {
    teardownRef = setupDeviceConnectedBridge();
    global.addEventListener('beforeunload', function onBeforeUnload() {
      if (typeof teardownRef === 'function') teardownRef();
      global.removeEventListener('beforeunload', onBeforeUnload);
    });
  }
})(typeof window !== 'undefined' ? window : this);
