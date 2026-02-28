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

  /** 기기 종류별 Service UUID (BLE 표준). 0x 접두사 제거한 4자리 hex로 비교 (대소문자 무시) */
  var SERVICE_UUID_BY_TYPE = {
    hr: '180d',
    heartRate: '180d',
    power: '1818',
    powerMeter: '1818',
    trainer: '1826',
    speed: '1816'
  };

  /** 카테고리별 이름 키워드 (대소문자 구분 없이 포함 여부로 검사). UUID 매칭 실패 시에도 이름에 키워드 있으면 표시 */
  var NAME_KEYWORDS_BY_TYPE = {
    hr: ['heart', 'hrm', 'hr', 'pulse', 'magene', 'coospo', 'fitcare'],
    heartRate: ['heart', 'hrm', 'hr', 'pulse', 'magene', 'coospo', 'fitcare'],
    power: ['power', 'assioma', 'stages', 'quarq', 'vector', 'rally'],
    powerMeter: ['power', 'assioma', 'stages', 'quarq', 'vector', 'rally'],
    trainer: ['trainer', 'wahoo', 'tacx', 'kickr', 'hammer', 'direto', 'flux', 'smart'],
    speed: ['speed', 'cadence', 'spd', 'cad', 'igpsport']
  };

  /** 모달에 이미 추가된 기기 ID 집합 (중복 제거용). 스캔 모달 열릴 때마다 초기화 */
  var addedDeviceIds = new Set();

  function getCardIds(deviceType) {
    return CARD_IDS[deviceType] || null;
  }

  /**
   * name 또는 localName이 하나라도 있으면 true (빈 문자열만 있는 경우는 false)
   */
  function hasNameOrLocalName(detail) {
    var n = (detail.name || detail.deviceName || '').trim();
    var ln = (detail.localName || '').trim();
    return n.length > 0 || ln.length > 0;
  }

  /**
   * UUID 문자열 정규화: 16비트(180d)·128비트(0000180d-0000-1000-8000-00805f9b34fb) 모두 toLowerCase 후 비교용 문자열로
   */
  function normalizeUuidForCompare(uuidStr) {
    return String(uuidStr || '').toLowerCase().replace(/^0x/, '').replace(/-/g, '');
  }

  /**
   * 기기가 선택된 카테고리(deviceType)에 해당하는지 Service UUID 또는 name으로 판별
   * - UUID: 16비트(180d)·128비트(0000180d-...) 형식 모두 toLowerCase()로 비교
   * - Name: 카테고리별 키워드 포함 시 UUID 없어도 목록 표시
   * @param {Object} detail - deviceFound 이벤트의 detail
   * @param {string} deviceType - hr | power | trainer | speed (또는 heartRate, powerMeter)
   * @returns {boolean}
   */
  function deviceMatchesCategory(detail, deviceType) {
    var requiredUuid = SERVICE_UUID_BY_TYPE[deviceType];
    var nameKeywords = NAME_KEYWORDS_BY_TYPE[deviceType];
    if (!requiredUuid && !nameKeywords) return true;

    var reqLower = requiredUuid ? requiredUuid.toLowerCase() : '';

    var uuidMatch = false;
    if (reqLower) {
      var uuids = detail.serviceUuids || detail.serviceUUIDs;
      if (Array.isArray(uuids)) {
        for (var i = 0; i < uuids.length; i++) {
          var u = normalizeUuidForCompare(uuids[i]);
          if (u.indexOf(reqLower) !== -1 || (u.length >= 4 && u.slice(-4) === reqLower)) {
            uuidMatch = true;
            break;
          }
        }
      }
      if (!uuidMatch) {
        var single = detail.serviceUuid || detail.serviceUUID || detail.uuid;
        if (single) {
          var s = normalizeUuidForCompare(single);
          if (s.indexOf(reqLower) !== -1 || (s.length >= 4 && s.slice(-4) === reqLower)) uuidMatch = true;
        }
      }
    }

    var nameMatch = false;
    if (nameKeywords && nameKeywords.length) {
      var combinedName = ((detail.name || '') + ' ' + (detail.deviceName || '') + ' ' + (detail.localName || '')).toLowerCase();
      for (var j = 0; j < nameKeywords.length; j++) {
        if (combinedName.indexOf(nameKeywords[j].toLowerCase()) !== -1) {
          nameMatch = true;
          break;
        }
      }
    }

    return uuidMatch || nameMatch;
  }

  /**
   * 모달 열기, "기기 검색 중..." 표시, 앱에 START_SCAN 발송
   * allowReplace: true → 이미 연결된 상태에서도 검색 가능(새 기기로 변경용)
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
        global.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'START_SCAN',
          deviceType: deviceType,
          allowReplace: true
        }));
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
   * - name/localName 없는 기기 제외, UUID 또는 name 키워드로 카테고리 필터, id 기준 중복 제거
   */
  function onDeviceFound(e) {
    var detail = e && e.detail;
    if (!detail) return;

    /* 디버깅: 앱에서 넘어오는 모든 기기의 name·localName·uuids 출력 */
    var uuids = detail.serviceUuids || detail.serviceUUIDs;
    var uuidList = Array.isArray(uuids) ? uuids : (detail.serviceUuid || detail.serviceUUID || detail.uuid ? [detail.serviceUuid || detail.serviceUUID || detail.uuid] : []);
    if (console && console.log) {
      console.log('[deviceSettings] deviceFound 수신:', {
        name: detail.name || '(없음)',
        localName: detail.localName || '(없음)',
        deviceName: detail.deviceName || '(없음)',
        uuids: uuidList,
        id: detail.id != null ? detail.id : detail.deviceId
      });
    }

    var targetType = savedTargetType;
    if (!targetType) return;

    /* name·localName 둘 다 없으면 목록에서 제외 */
    if (!hasNameOrLocalName(detail)) return;

    var id = detail.id != null ? detail.id : detail.deviceId;
    var name = (detail.name || detail.deviceName || detail.localName || '').trim() || '알 수 없는 기기';

    if (!deviceMatchesCategory(detail, targetType)) return;
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
            deviceType: deviceTypeToConnect,
            replaceDevice: true
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
