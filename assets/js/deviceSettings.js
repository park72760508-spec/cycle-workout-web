/**
 * deviceSettings.js
 * 센서 연결(Device Settings) 화면: 스캔 모달, 앱으로 START_SCAN/CONNECT_DEVICE 발송, deviceFound/deviceConnected로 UI 동기화
 */

(function (global) {
  'use strict';

  var MODAL_ID = 'deviceScanModal';
  var LIST_ID = 'deviceScanList';
  var HINT_ID = 'deviceScanModalHint';

  /** 현재 스캔/연결 대상 deviceType (hr, power, trainer, speed) */
  var savedTargetType = null;

  var deviceFoundHandlerRef = null;
  var deviceConnectedHandlerRef = null;

  var CARD_IDS = {
    hr: { card: 'deviceCardHr', status: 'deviceStatusHr', id: 'deviceIdHr' },
    heartRate: { card: 'deviceCardHr', status: 'deviceStatusHr', id: 'deviceIdHr' },
    power: { card: 'deviceCardPower', status: 'deviceStatusPower', id: 'deviceIdPower' },
    powerMeter: { card: 'deviceCardPower', status: 'deviceStatusPower', id: 'deviceIdPower' },
    trainer: { card: 'deviceCardTrainer', status: 'deviceStatusTrainer', id: 'deviceIdTrainer' },
    speed: { card: 'deviceCardSpeed', status: 'deviceStatusSpeed', id: 'deviceIdSpeed' }
  };

  function getCardIds(deviceType) {
    return CARD_IDS[deviceType] || null;
  }

  /**
   * 모달 열기, "기기 검색 중..." 표시, 앱에 START_SCAN 발송
   */
  function openDeviceScanModal(deviceType) {
    savedTargetType = deviceType;
    var modal = document.getElementById(MODAL_ID);
    var list = document.getElementById(LIST_ID);
    var hint = document.getElementById(HINT_ID);
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.remove('hidden');
    }
    if (list) list.innerHTML = '';
    if (hint) hint.textContent = '기기 검색 중...';
    try {
      if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
        global.ReactNativeWebView.postMessage(JSON.stringify({ type: 'START_SCAN', deviceType: deviceType }));
      }
    } catch (e) {
      if (console && console.warn) console.warn('[deviceSettings] START_SCAN postMessage failed', e);
    }
  }

  /**
   * 모달 닫기, 리스트 비우기
   */
  function closeDeviceScanModal() {
    savedTargetType = null;
    var modal = document.getElementById(MODAL_ID);
    var list = document.getElementById(LIST_ID);
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
    if (list) list.innerHTML = '';
  }

  /**
   * deviceFound: 검색된 기기를 모달 리스트에 추가
   */
  function onDeviceFound(e) {
    var detail = e && e.detail;
    if (!detail) return;
    var id = detail.id != null ? detail.id : detail.deviceId;
    var name = detail.name != null ? detail.name : (detail.deviceName || '알 수 없는 기기');
    if (!id) return;
    var list = document.getElementById(LIST_ID);
    var hint = document.getElementById(HINT_ID);
    if (hint) hint.textContent = '검색된 기기를 탭하면 연결합니다.';
    if (!list) return;
    var li = document.createElement('li');
    li.dataset.deviceId = String(id);
    li.innerHTML = '<span class="device-scan-name">' + escapeHtml(String(name)) + '</span><span class="device-scan-id">' + escapeHtml(String(id)) + '</span>';
    li.addEventListener('click', function () {
      var deviceId = li.dataset.deviceId;
      var deviceTypeToConnect = savedTargetType;
      closeDeviceScanModal();
      try {
        if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
          global.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'CONNECT_DEVICE',
            deviceId: deviceId,
            deviceType: deviceTypeToConnect
          }));
        }
      } catch (err) {
        if (console && console.warn) console.warn('[deviceSettings] CONNECT_DEVICE postMessage failed', err);
      }
    });
    list.appendChild(li);
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /**
   * 특정 deviceType 카드를 "연결됨" + deviceId 표시로 갱신
   */
  function setCardConnected(deviceType, deviceId) {
    var ids = getCardIds(deviceType);
    if (!ids) return;
    var card = document.getElementById(ids.card);
    var statusEl = document.getElementById(ids.status);
    var idEl = document.getElementById(ids.id);
    if (card) {
      card.classList.add('connected');
    }
    if (statusEl) {
      statusEl.textContent = '연결됨';
      statusEl.style.color = '#00d4aa';
    }
    if (idEl && deviceId) {
      idEl.textContent = String(deviceId);
      idEl.style.display = 'block';
    }
  }

  /**
   * deviceConnected: 해당 타입 카드 UI를 연결됨(녹색) + 기기 ID 표시
   */
  function onDeviceConnected(e) {
    var detail = e && e.detail;
    if (!detail) return;
    var deviceType = detail.deviceType != null ? detail.deviceType : detail.type;
    var deviceId = detail.deviceId != null ? detail.deviceId : detail.id;
    if (!deviceType) return;
    setCardConnected(String(deviceType), deviceId);
  }

  /**
   * 화면 열릴 때 저장된 기기로 카드 상태 초기화
   */
  function refreshDeviceSettingCards() {
    var api = global.StelvioDeviceBridgeStorage;
    if (!api || typeof api.loadSavedDevices !== 'function') return;
    var saved = api.loadSavedDevices();
    if (!saved || typeof saved !== 'object') return;
    var types = ['hr', 'power', 'trainer', 'speed'];
    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      var id = saved[t];
      if (id) {
        setCardConnected(t, id);
      } else {
        var ids = getCardIds(t);
        if (!ids) continue;
        var card = document.getElementById(ids.card);
        var statusEl = document.getElementById(ids.status);
        var idEl = document.getElementById(ids.id);
        if (card) card.classList.remove('connected');
        if (statusEl) {
          statusEl.textContent = '미연결';
          statusEl.style.color = '';
        }
        if (idEl) {
          idEl.textContent = '';
          idEl.style.display = 'none';
        }
      }
    }
  }

  /**
   * 스캔 트리거: 카드 클릭 시 호출. 모달 띄우고 START_SCAN 발송, 타겟 타입 저장
   */
  global.startDeviceScan = function (deviceType) {
    openDeviceScanModal(deviceType);
  };

  global.closeDeviceScanModal = closeDeviceScanModal;

  /**
   * 전역 리스너 등록 (deviceFound, deviceConnected)
   */
  function attachListeners() {
    if (deviceFoundHandlerRef !== null) return;
    deviceFoundHandlerRef = onDeviceFound;
    deviceConnectedHandlerRef = onDeviceConnected;
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('deviceFound', deviceFoundHandlerRef);
      global.addEventListener('deviceConnected', deviceConnectedHandlerRef);
    }
  }

  /**
   * showScreen 래핑: deviceSettingScreen 진입 시 저장된 기기로 카드 갱신
   */
  function wrapShowScreen() {
    var original = global.showScreen;
    if (typeof original !== 'function') return;
    global.showScreen = function (screenId) {
      original(screenId);
      if (screenId === 'deviceSettingScreen') {
        refreshDeviceSettingCards();
      }
    };
  }

  attachListeners();
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

  global.StelvioDeviceSettings = {
    refreshDeviceSettingCards: refreshDeviceSettingCards,
    closeDeviceScanModal: closeDeviceScanModal
  };
})(typeof window !== 'undefined' ? window : this);
