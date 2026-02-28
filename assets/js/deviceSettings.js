/**
 * deviceSettings.js
 * 센서 연결(Device Settings) 화면: 스캔 모달, 앱으로 START_SCAN/CONNECT_DEVICE 발송, deviceFound/deviceConnected로 UI 동기화
 * - 투 트랙: 앱 환경에서만 설정 화면 진입 허용, 웹 브라우저에서는 안내만 표시
 */

(function (global) {
  'use strict';

  var isAppEnvironment = !!global.ReactNativeWebView;

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

  /** 기기 종류별 Service UUID (BLE 표준). 0x 접두사 제거한 4자리 hex로 비교 */
  var SERVICE_UUID_BY_TYPE = {
    hr: '180D',         /* Heart Rate */
    heartRate: '180D',
    power: '1818',      /* Cycling Power */
    powerMeter: '1818',
    trainer: '1826',    /* Fitness Machine */
    speed: '1816'       /* Cycling Speed and Cadence */
  };

  /** 모달에 이미 추가된 기기 ID 집합 (중복 제거용). 스캔 모달 열릴 때마다 초기화 */
  var addedDeviceIds = new Set();

  function getCardIds(deviceType) {
    return CARD_IDS[deviceType] || null;
  }

  /**
   * 기기가 선택된 카테고리(deviceType)에 해당하는지 Service UUID 또는 name으로 판별
   * @param {Object} detail - deviceFound 이벤트의 detail (id, deviceId, name, serviceUuids 등)
   * @param {string} deviceType - hr | power | trainer | speed (또는 heartRate, powerMeter)
   * @returns {boolean}
   */
  function deviceMatchesCategory(detail, deviceType) {
    var requiredUuid = SERVICE_UUID_BY_TYPE[deviceType];
    if (!requiredUuid) return true;

    var uuids = detail.serviceUuids || detail.serviceUUIDs;
    if (Array.isArray(uuids)) {
      for (var i = 0; i < uuids.length; i++) {
        var u = String(uuids[i] || '').toUpperCase().replace(/^0X/, '').replace(/-/g, '');
        if (u.indexOf(requiredUuid.toUpperCase()) !== -1 || (u.length >= 4 && u.slice(-4) === requiredUuid.toUpperCase())) return true;
      }
    }
    var single = detail.serviceUuid || detail.serviceUUID || detail.uuid;
    if (single) {
      var s = String(single).toUpperCase().replace(/^0X/, '').replace(/-/g, '');
      if (s.indexOf(requiredUuid.toUpperCase()) !== -1 || (s.length >= 4 && s.slice(-4) === requiredUuid.toUpperCase())) return true;
    }
    /* Name 기반 폴백: 앱이 UUID를 보내지 않을 경우 */
    var name = (detail.name || detail.deviceName || '').toLowerCase();
    if (name) {
      if ((deviceType === 'hr' || deviceType === 'heartRate') && (name.indexOf('heart') !== -1 || name.indexOf('hr') !== -1 || name.indexOf('심박') !== -1)) return true;
      if ((deviceType === 'power' || deviceType === 'powerMeter') && (name.indexOf('power') !== -1 || name.indexOf('파워') !== -1)) return true;
      if (deviceType === 'trainer' && (name.indexOf('trainer') !== -1 || name.indexOf('트레이너') !== -1 || name.indexOf('fitness') !== -1)) return true;
      if (deviceType === 'speed' && (name.indexOf('speed') !== -1 || name.indexOf('cadence') !== -1 || name.indexOf('속도') !== -1 || name.indexOf('csc') !== -1)) return true;
    }
    return false;
  }

  /**
   * 모달 열기, "기기 검색 중..." 표시, 앱에 START_SCAN 발송
   */
  function openDeviceScanModal(deviceType) {
    savedTargetType = deviceType;
    addedDeviceIds.clear();
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
   * deviceFound: 선택된 카테고리에 맞고 중복이 아닌 기기만 모달 리스트에 추가
   * - 기기 종류별 Service UUID(0x180D/0x1818/0x1826/0x1816) 또는 name 기반 필터링
   * - 기기 고유 ID(id/deviceId) 기준 중복 제거
   */
  function onDeviceFound(e) {
    var detail = e && e.detail;
    if (!detail) return;
    var targetType = savedTargetType;
    if (!targetType) return;
    if (!deviceMatchesCategory(detail, targetType)) return;
    var id = detail.id != null ? detail.id : detail.deviceId;
    var name = detail.name != null ? detail.name : (detail.deviceName || '알 수 없는 기기');
    if (!id) return;
    var idStr = String(id);
    if (addedDeviceIds.has(idStr)) return;
    addedDeviceIds.add(idStr);
    var list = document.getElementById(LIST_ID);
    var hint = document.getElementById(HINT_ID);
    if (hint) hint.textContent = '검색된 기기를 탭하면 연결합니다.';
    if (!list) return;
    var li = document.createElement('li');
    li.dataset.deviceId = idStr;
    li.innerHTML = '<span class="device-scan-name">' + escapeHtml(String(name)) + '</span><span class="device-scan-id">' + escapeHtml(idStr) + '</span>';
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
   * 메인 메뉴 [센서 연결] 버튼용: 앱이면 설정 화면으로, 웹이면 안내만 표시 (데드락 방지)
   */
  global.openDeviceSettingsOrPrompt = function () {
    if (isAppEnvironment) {
      if (typeof global.showScreen === 'function') {
        global.showScreen('deviceSettingScreen');
      }
    } else {
      alert('웹 브라우저 환경에서는 훈련 대시보드 화면 내에 있는 연결 버튼을 눌러 직접 센서를 연결해 주세요.');
    }
  };

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
