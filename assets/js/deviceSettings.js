/**
 * deviceSettings.js
 * 센서 연결(Device Settings) 화면: 스캔 모달, 앱으로 START_SCAN/CONNECT_DEVICE 발송, deviceFound/deviceConnected로 UI 동기화
 * - 투 트랙: 앱 환경에서만 설정 화면 진입 허용, 웹 브라우저에서는 안내만 표시
 *
 * 앱 연동 (권장):
 * - CONNECT_DEVICE 후 BLE 연결 성공 시 반드시 deviceConnected 디스패치: { deviceType, deviceId, deviceName }
 * - REQUEST_KNOWN_DEVICES 수신 시 페어링된(이미 연결된) 기기 목록을 knownDevices 이벤트로 전달하면
 *   스마트로라 등 LED 파란색(페어링된) 기기가 스캔에 안 뜨는 경우에도 목록에 표시됨
 */

(function (global) {
  'use strict';

  var isAppEnvironment = !!global.ReactNativeWebView;

  var MODAL_ID = 'deviceScanModal';
  var LIST_ID = 'deviceScanList';
  var HINT_ID = 'deviceScanModalHint';
  var TITLE_ID = 'deviceScanModalTitle';
  var RESCAN_WRAP_ID = 'deviceScanRescanWrap';

  /** 스캔 완료로 간주하는 대기 시간(ms). 이 시간 후 "기기 검색 완료" + 재검색 버튼 표시 */
  var SCAN_COMPLETE_MS = 12000;
  var _scanCompleteTimeoutId = null;

  /** 현재 스캔/연결 대상 deviceType (hr, power, trainer, speed) */
  var savedTargetType = null;
  /** 디바이스 선택 후 연결 대기 중일 때 표시용: 기기명, deviceType */
  var _connectingDeviceName = null;
  var _connectingDeviceType = null;
  /** CONNECT_DEVICE 후 deviceConnected 미수신 시 카드 갱신용 타임아웃 ID */
  var _connectFallbackTimeoutId = null;
  /** 연결 대기 타임아웃(ms). 이 시간 내에 deviceConnected 없으면 스피너 숨기고 저장 상태로 카드 갱신 */
  var CONNECT_FALLBACK_MS = 14000;

  var deviceFoundHandlerRef = null;
  var deviceConnectedHandlerRef = null;
  var deviceErrorHandlerRef = null;
  var knownDevicesHandlerRef = null;

  var CARD_IDS = {
    hr: { card: 'deviceCardHr', status: 'deviceStatusHr', id: 'deviceIdHr' },
    heartRate: { card: 'deviceCardHr', status: 'deviceStatusHr', id: 'deviceIdHr' },
    power: { card: 'deviceCardPower', status: 'deviceStatusPower', id: 'deviceIdPower' },
    powerMeter: { card: 'deviceCardPower', status: 'deviceStatusPower', id: 'deviceIdPower' },
    trainer: { card: 'deviceCardTrainer', status: 'deviceStatusTrainer', id: 'deviceIdTrainer' },
    speed: { card: 'deviceCardSpeed', status: 'deviceStatusSpeed', id: 'deviceIdSpeed' }
  };
  /** 연결됨일 때 카드 아이콘 이미지, 연결 해제/저장됨/미연결일 때 원래 이미지 */
  var CARD_IMG_CONNECTED = { hr: 'assets/img/bpm_b.png', power: 'assets/img/power_b.png', trainer: 'assets/img/trainer_b_b.png', speed: 'assets/img/s(02).png' };
  var CARD_IMG_DEFAULT = { hr: 'assets/img/bpm_i.png', power: 'assets/img/power_i.png', trainer: 'assets/img/trainer_i.png', speed: 'assets/img/s(01).png' };
  /** Device Settings 팝업에서는 스마트 트레이너 카드 라벨을 항상 "스마트로라"로 표시 */
  var TRAINER_LABEL_CONNECTED = '스마트로라';
  var TRAINER_LABEL_DEFAULT = '스마트로라';

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
    trainer: ['trainer', 'wahoo', 'tacx', 'kickr', 'hammer', 'direto', 'flux', 'smart', '스마트로라', 'smartrola', 'rola'],
    speed: ['speed', 'cadence', 'spd', 'cad', 'igpsport']
  };

  /** 모달에 이미 추가된 기기 ID 집합 (중복 제거용). 스캔 모달 열릴 때마다 초기화 */
  var addedDeviceIds = new Set();

  function getCardIds(deviceType) {
    return CARD_IDS[deviceType] || null;
  }

  /** Device Settings 카드 아이콘 및 스마트 트레이너 라벨 설정. connected true=연결됨 이미지/스마트로라, false=원래 이미지/스마트 트레이너 */
  function setDeviceCardIconAndLabel(deviceType, connected) {
    var ids = getCardIds(deviceType);
    if (!ids) return;
    var card = document.getElementById(ids.card);
    if (!card) return;
    var img = card.querySelector('.device-setting-icon');
    var t = (deviceType === 'heartRate' || deviceType === 'hr') ? 'hr' : (deviceType === 'powerMeter' || deviceType === 'power') ? 'power' : (deviceType === 'trainer') ? 'trainer' : (deviceType === 'speed') ? 'speed' : null;
    if (img && t && CARD_IMG_CONNECTED[t] && CARD_IMG_DEFAULT[t]) {
      img.src = connected ? CARD_IMG_CONNECTED[t] : CARD_IMG_DEFAULT[t];
    }
    if (t === 'trainer') {
      var labelEl = card.querySelector('.device-setting-label');
      if (labelEl) labelEl.textContent = connected ? TRAINER_LABEL_CONNECTED : TRAINER_LABEL_DEFAULT;
    }
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
   * 검색 완료 상태 표시: 제목 "기기 검색 완료", 재검색 버튼 노출
   * 연결 대기 중(스피너 표시)이면 표시하지 않음
   */
  function showScanComplete() {
    if (_scanCompleteTimeoutId) {
      clearTimeout(_scanCompleteTimeoutId);
      _scanCompleteTimeoutId = null;
    }
    if (_connectingDeviceName != null || _connectingDeviceType != null) return;
    var titleEl = document.getElementById(TITLE_ID);
    var hint = document.getElementById(HINT_ID);
    var rescanWrap = document.getElementById(RESCAN_WRAP_ID);
    if (titleEl) titleEl.textContent = '기기 검색 완료';
    if (hint) {
      hint.textContent = '검색된 기기를 탭하면 연결합니다. 원하는 기기가 없으면 재검색을 눌러주세요.';
      hint.style.display = '';
    }
    if (rescanWrap) rescanWrap.style.display = 'flex';
  }

  /**
   * 재검색 실행: 목록 초기화 후 START_SCAN·REQUEST_KNOWN_DEVICES 재전송, "기기 검색 중..." 표시
   */
  function triggerDeviceRescan() {
    if (!savedTargetType) return;
    if (_scanCompleteTimeoutId) {
      clearTimeout(_scanCompleteTimeoutId);
      _scanCompleteTimeoutId = null;
    }
    var titleEl = document.getElementById(TITLE_ID);
    var hint = document.getElementById(HINT_ID);
    var list = document.getElementById(LIST_ID);
    var rescanWrap = document.getElementById(RESCAN_WRAP_ID);
    if (titleEl) titleEl.textContent = '기기 검색 중...';
    if (hint) {
      hint.textContent = '기기 검색 중...';
      hint.style.display = '';
    }
    if (rescanWrap) rescanWrap.style.display = 'none';
    addedDeviceIds.clear();
    if (list) list.innerHTML = '';
    try {
      if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
        global.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'START_SCAN',
          deviceType: savedTargetType,
          allowReplace: true
        }));
        global.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'REQUEST_KNOWN_DEVICES',
          deviceType: savedTargetType
        }));
      }
    } catch (e) {
      if (console && console.warn) console.warn('[deviceSettings] 재검색 START_SCAN failed', e);
    }
    addSavedDeviceToScanListIfAny(savedTargetType);
    _scanCompleteTimeoutId = setTimeout(showScanComplete, SCAN_COMPLETE_MS);
  }

  /**
   * 모달 열기, "기기 검색 중..." 표시, 앱에 START_SCAN 발송
   * allowReplace: true → 이미 연결된 상태에서도 검색 가능(새 기기로 변경용)
   */
  function openDeviceScanModal(deviceType) {
    savedTargetType = deviceType;
    addedDeviceIds.clear();
    if (_scanCompleteTimeoutId) {
      clearTimeout(_scanCompleteTimeoutId);
      _scanCompleteTimeoutId = null;
    }
    var modal = document.getElementById(MODAL_ID);
    var list = document.getElementById(LIST_ID);
    var hint = document.getElementById(HINT_ID);
    var titleEl = document.getElementById(TITLE_ID);
    var rescanWrap = document.getElementById(RESCAN_WRAP_ID);
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.remove('hidden');
    }
    if (titleEl) titleEl.textContent = '기기 검색 중...';
    if (list) list.innerHTML = '';
    if (hint) {
      hint.textContent = '기기 검색 중...';
      hint.style.display = '';
    }
    if (rescanWrap) rescanWrap.style.display = 'none';
    try {
      if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
        global.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'START_SCAN',
          deviceType: deviceType,
          allowReplace: true
        }));
        global.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'REQUEST_KNOWN_DEVICES',
          deviceType: deviceType
        }));
      }
    } catch (e) {
      if (console && console.warn) console.warn('[deviceSettings] START_SCAN postMessage failed', e);
    }
    addSavedDeviceToScanListIfAny(deviceType);
    _scanCompleteTimeoutId = setTimeout(showScanComplete, SCAN_COMPLETE_MS);
  }

  /**
   * 현재 선택된 deviceType에 대해 웹 저장소에 저장된 기기가 있으면 검색 목록 맨 앞에 추가.
   * 스캔/앱 knownDevices에 안 뜨는 저장된 스마트로라 등이 목록에 보이도록 함.
   */
  function addSavedDeviceToScanListIfAny(deviceType) {
    if (!savedTargetType || !deviceType) return;
    if (!global.StelvioDeviceBridgeStorage || typeof global.StelvioDeviceBridgeStorage.loadSavedDevices !== 'function') return;
    var storageKey = (deviceType === 'heartRate' || deviceType === 'hr') ? 'hr' : (deviceType === 'powerMeter' || deviceType === 'power') ? 'power' : deviceType;
    var saved = global.StelvioDeviceBridgeStorage.loadSavedDevices();
    var deviceId = saved && saved[storageKey] ? String(saved[storageKey]).trim() : null;
    if (!deviceId) return;
    var names = typeof global.StelvioDeviceBridgeStorage.loadSavedDeviceNames === 'function' ? global.StelvioDeviceBridgeStorage.loadSavedDeviceNames() : {};
    var deviceName = (names && names[storageKey]) ? String(names[storageKey]).trim() : '저장된 기기';
    if (!deviceName) deviceName = '저장된 기기';
    deviceName = deviceName + ' (저장됨)';
    var list = document.getElementById(LIST_ID);
    if (list && !addedDeviceIds.has(deviceId)) {
      addedDeviceIds.add(deviceId);
      var hint = document.getElementById(HINT_ID);
      if (hint) hint.textContent = '검색된 기기를 탭하면 연결합니다.';
      var li = document.createElement('li');
      li.dataset.deviceId = deviceId;
      li.classList.add('device-scan-item-saved');
      li.innerHTML = '<span class="device-scan-name">' + escapeHtml(deviceName) + '</span><span class="device-scan-id">' + escapeHtml(deviceId) + '</span>';
      li.addEventListener('click', function () {
        var id = li.dataset.deviceId;
        var typeToConnect = savedTargetType;
        var nameEl = li.querySelector('.device-scan-name');
        var displayName = (nameEl && nameEl.textContent) ? nameEl.textContent.replace(/\s*\(저장됨\)\s*$/, '').trim() : '기기';
        _connectingDeviceName = displayName;
        _connectingDeviceType = typeToConnect;
        if (_connectFallbackTimeoutId) {
          clearTimeout(_connectFallbackTimeoutId);
          _connectFallbackTimeoutId = null;
        }
        if (global.StelvioDeviceBridgeStorage && typeof global.StelvioDeviceBridgeStorage.saveDevice === 'function') {
          var key = (typeToConnect === 'heartRate' || typeToConnect === 'hr') ? 'hr' : (typeToConnect === 'powerMeter' || typeToConnect === 'power') ? 'power' : typeToConnect;
          try { global.StelvioDeviceBridgeStorage.saveDevice(key, id, displayName); } catch (e) { if (console && console.warn) console.warn('[deviceSettings] saveDevice on saved-item click failed', e); }
        }
        setCardSaved(typeToConnect, id, displayName);
        showDeviceScanConnecting(displayName);
        try {
          if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
            global.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'CONNECT_DEVICE',
              deviceId: id,
              deviceType: typeToConnect,
              deviceName: displayName,
              replaceDevice: true
            }));
          }
        } catch (err) {
          if (console && console.warn) console.warn('[deviceSettings] CONNECT_DEVICE postMessage failed', err);
          hideDeviceScanConnecting();
          _connectingDeviceName = null;
          _connectingDeviceType = null;
          if (typeof global.StelvioDeviceSettings !== 'undefined' && typeof global.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') global.StelvioDeviceSettings.refreshDeviceSettingCards();
          return;
        }
        _connectFallbackTimeoutId = setTimeout(function () {
          _connectFallbackTimeoutId = null;
          if (_connectingDeviceType != null && _connectingDeviceName != null) {
            hideDeviceScanConnecting();
            closeDeviceScanModal();
            _connectingDeviceName = null;
            _connectingDeviceType = null;
            if (typeof global.StelvioDeviceSettings !== 'undefined' && typeof global.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') global.StelvioDeviceSettings.refreshDeviceSettingCards();
            if (console && console.log) console.log('[deviceSettings] 연결 대기 타임아웃 — 카드를 저장됨 상태로 갱신 (deviceConnected 미수신)');
          }
        }, CONNECT_FALLBACK_MS);
      });
      list.insertBefore(li, list.firstChild);
    }
  }

  /**
   * 모달 닫기, 리스트 비우기, 연결 중 UI 숨김
   */
  function closeDeviceScanModal() {
    if (_connectFallbackTimeoutId) {
      clearTimeout(_connectFallbackTimeoutId);
      _connectFallbackTimeoutId = null;
    }
    if (_scanCompleteTimeoutId) {
      clearTimeout(_scanCompleteTimeoutId);
      _scanCompleteTimeoutId = null;
    }
    savedTargetType = null;
    _connectingDeviceName = null;
    _connectingDeviceType = null;
    var modal = document.getElementById(MODAL_ID);
    var list = document.getElementById(LIST_ID);
    var connectingWrap = document.getElementById('deviceScanConnectingWrap');
    var hint = document.getElementById(HINT_ID);
    if (connectingWrap) {
      connectingWrap.style.display = 'none';
    }
    if (hint) hint.style.display = '';
    if (list) {
      list.innerHTML = '';
      list.style.display = '';
    }
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
    if (typeof global.StelvioDeviceSettings !== 'undefined' && typeof global.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') {
      global.StelvioDeviceSettings.refreshDeviceSettingCards();
    }
  }

  /**
   * 기기 검색 모달에서 "연결 중" UI 표시: 녹색 원 스피너 + "기기명 연결 중....."
   */
  function showDeviceScanConnecting(deviceName) {
    var wrap = document.getElementById('deviceScanConnectingWrap');
    var textEl = document.getElementById('deviceScanConnectingText');
    var list = document.getElementById(LIST_ID);
    var hint = document.getElementById(HINT_ID);
    if (wrap) {
      if (textEl) textEl.textContent = (deviceName || '기기') + ' 연결 중.....';
      wrap.style.display = 'flex';
    }
    if (list) list.style.display = 'none';
    if (hint) hint.style.display = 'none';
  }

  function hideDeviceScanConnecting() {
    var wrap = document.getElementById('deviceScanConnectingWrap');
    var list = document.getElementById(LIST_ID);
    var hint = document.getElementById(HINT_ID);
    if (wrap) wrap.style.display = 'none';
    if (list) list.style.display = '';
    if (hint) hint.style.display = '';
  }

  /**
   * knownDevices: 앱이 페어링된(이미 연결된) 기기 목록을 보낼 때 목록에 추가 (스캔에 안 뜨는 스마트로라 등)
   * 앱에서 REQUEST_KNOWN_DEVICES 수신 후 dispatchEvent('knownDevices', { deviceType, devices: [{ id, name }] }) 로 응답
   */
  function onKnownDevices(e) {
    var detail = e && e.detail;
    if (!detail || !savedTargetType) return;
    var type = detail.deviceType != null ? detail.deviceType : detail.type;
    if (!type) return;
    var norm = function (t) {
      t = String(t).toLowerCase();
      if (t === 'heartrate') return 'hr';
      if (t === 'powermeter') return 'power';
      if (t === 'smartrola') return 'trainer';
      return t;
    };
    if (norm(type) !== norm(savedTargetType)) return;
    var devices = detail.devices;
    if (!Array.isArray(devices)) devices = (detail.device != null) ? [detail.device] : [];
    if (devices.length === 0) return;
    if (console && console.log) console.log('[deviceSettings] knownDevices 수신', type, devices.length, '대', devices);
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      var id = d.id != null ? d.id : d.deviceId;
      var name = (d.name || d.deviceName || '').trim() || '알 수 없는 기기';
      if (id) addDeviceItemToList(String(id), name);
    }
  }

  /**
   * deviceFound: 선택된 카테고리에 맞고 중복이 아닌 기기만 모달 리스트에 추가
   * - name/localName 없는 기기도 UUID 매칭 시 추가 (페어링된 기기 등), id 기준 중복 제거
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

    /* name·localName 둘 다 없어도 UUID로 카테고리 매칭되면 목록에 추가 (페어링된 기기 등 광고 이름이 비어 올 수 있음) */
    if (!hasNameOrLocalName(detail) && !deviceMatchesCategory(detail, targetType)) return;

    var id = detail.id != null ? detail.id : detail.deviceId;
    var name = (detail.name || detail.deviceName || detail.localName || '').trim() || '알 수 없는 기기';

    if (!deviceMatchesCategory(detail, targetType)) return;
    if (!id) return;
    addDeviceItemToList(String(id), name);
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /**
   * 스캔/knownDevices 목록에 기기 한 건 추가 (중복 제거, 동일 클릭·저장·연결 로직)
   */
  function addDeviceItemToList(idStr, name) {
    if (!idStr || addedDeviceIds.has(idStr)) return;
    addedDeviceIds.add(idStr);
    var list = document.getElementById(LIST_ID);
    var hint = document.getElementById(HINT_ID);
    if (hint) hint.textContent = '검색된 기기를 탭하면 연결합니다.';
    if (!list) return;
    var li = document.createElement('li');
    li.dataset.deviceId = idStr;
    li.innerHTML = '<span class="device-scan-name">' + escapeHtml(String(name || '알 수 없는 기기')) + '</span><span class="device-scan-id">' + escapeHtml(idStr) + '</span>';
    li.addEventListener('click', function () {
      var deviceId = li.dataset.deviceId;
      var deviceTypeToConnect = savedTargetType;
      var nameEl = li.querySelector('.device-scan-name');
      var deviceName = (nameEl && nameEl.textContent) ? nameEl.textContent.trim() : '기기';
      _connectingDeviceName = deviceName;
      _connectingDeviceType = deviceTypeToConnect;
      if (_connectFallbackTimeoutId) {
        clearTimeout(_connectFallbackTimeoutId);
        _connectFallbackTimeoutId = null;
      }
      if (global.StelvioDeviceBridgeStorage && typeof global.StelvioDeviceBridgeStorage.saveDevice === 'function') {
        var storageKey = (deviceTypeToConnect === 'heartRate' || deviceTypeToConnect === 'hr') ? 'hr' : (deviceTypeToConnect === 'powerMeter' || deviceTypeToConnect === 'power') ? 'power' : deviceTypeToConnect;
        try {
          global.StelvioDeviceBridgeStorage.saveDevice(storageKey, deviceId, deviceName);
        } catch (e) { if (console && console.warn) console.warn('[deviceSettings] saveDevice on select failed', e); }
      }
      setCardSaved(deviceTypeToConnect, deviceId, deviceName);
      showDeviceScanConnecting(deviceName);
      try {
        if (global.ReactNativeWebView && typeof global.ReactNativeWebView.postMessage === 'function') {
          global.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'CONNECT_DEVICE',
            deviceId: deviceId,
            deviceType: deviceTypeToConnect,
            deviceName: deviceName,
            replaceDevice: true
          }));
        }
      } catch (err) {
        if (console && console.warn) console.warn('[deviceSettings] CONNECT_DEVICE postMessage failed', err);
        hideDeviceScanConnecting();
        _connectingDeviceName = null;
        _connectingDeviceType = null;
        if (typeof global.StelvioDeviceSettings !== 'undefined' && typeof global.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') global.StelvioDeviceSettings.refreshDeviceSettingCards();
        return;
      }
      _connectFallbackTimeoutId = setTimeout(function () {
        _connectFallbackTimeoutId = null;
        if (_connectingDeviceType != null && _connectingDeviceName != null) {
          hideDeviceScanConnecting();
          closeDeviceScanModal();
          _connectingDeviceName = null;
          _connectingDeviceType = null;
          if (typeof global.StelvioDeviceSettings !== 'undefined' && typeof global.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') global.StelvioDeviceSettings.refreshDeviceSettingCards();
          if (console && console.log) console.log('[deviceSettings] 연결 대기 타임아웃 — 카드를 저장됨 상태로 갱신 (deviceConnected 미수신)');
        }
      }, CONNECT_FALLBACK_MS);
    });
    list.appendChild(li);
  }

  /** deviceType(hr, power, trainer, speed, smartrola) → window.connectedDevices 키. smartrola → trainer */
  function typeToConnectedKey(deviceType) {
    var t = String(deviceType || '').toLowerCase();
    if (t === 'hr' || t === 'heartrate') return 'heartRate';
    if (t === 'power' || t === 'powermeter') return 'powerMeter';
    if (t === 'trainer' || t === 'smartrola' || t === 'speed') return t === 'speed' ? 'speed' : 'trainer';
    return deviceType;
  }

  /**
   * 특정 deviceType 카드를 "연결됨"(녹색) + 그 아래 디바이스 이름 표시로 갱신 (실제 BLE 연결 시에만 사용)
   * 연결됨 밑에는 "연결됨" 문구 대신 디바이스 이름을 표시
   * @param {string} [deviceName] - 연결됨일 때 밑줄에 표시할 디바이스 이름 (없으면 deviceId 표시)
   */
  function setCardConnected(deviceType, deviceId, deviceName) {
    var ids = getCardIds(deviceType);
    if (!ids) return;
    var card = document.getElementById(ids.card);
    var statusEl = document.getElementById(ids.status);
    var idEl = document.getElementById(ids.id);
    if (card) card.classList.add('connected');
    if (statusEl) {
      statusEl.textContent = '연결됨';
      statusEl.style.color = '#00d4aa';
    }
    if (idEl) {
      var nameToShow = (deviceName && String(deviceName).trim()) ? String(deviceName).trim() : (deviceId ? String(deviceId) : '');
      idEl.textContent = nameToShow;
      idEl.style.display = nameToShow ? 'block' : 'none';
    }
    setDeviceCardIconAndLabel(deviceType, true);
  }

  /**
   * 특정 deviceType 카드를 "연결해제" + 디바이스 이름(또는 ID) 표시
   */
  function setCardDisconnected(deviceType, deviceId, deviceName) {
    var ids = getCardIds(deviceType);
    if (!ids) return;
    var card = document.getElementById(ids.card);
    var statusEl = document.getElementById(ids.status);
    var idEl = document.getElementById(ids.id);
    if (card) card.classList.remove('connected');
    if (statusEl) {
      statusEl.textContent = '연결해제';
      statusEl.style.color = '#9ca3af';
    }
    if (idEl && (deviceId || deviceName)) {
      idEl.textContent = (deviceName && String(deviceName).trim()) ? String(deviceName).trim() : String(deviceId || '');
      idEl.style.display = 'block';
    }
    setDeviceCardIconAndLabel(deviceType, false);
  }

  /**
   * 특정 deviceType 카드를 "저장됨" + 디바이스 이름(또는 ID) 표시로 갱신 (스토리지에만 있고 아직 연결 안 된 경우)
   * 색상은 연결됨과 동일하게 유지: #00d4aa
   */
  function setCardSaved(deviceType, deviceId, deviceName) {
    var ids = getCardIds(deviceType);
    if (!ids) return;
    var card = document.getElementById(ids.card);
    var statusEl = document.getElementById(ids.status);
    var idEl = document.getElementById(ids.id);
    if (card) card.classList.add('connected');
    if (statusEl) {
      statusEl.textContent = '저장됨';
      statusEl.style.color = '#00d4aa';
    }
    if (idEl && (deviceId || (deviceName && String(deviceName).trim()))) {
      idEl.textContent = (deviceName && String(deviceName).trim()) ? String(deviceName).trim() : String(deviceId || '');
      idEl.style.display = 'block';
    }
    setDeviceCardIconAndLabel(deviceType, false);
  }

  /** stelvio-connection-lost의 key(heartRate 등) → 카드 타입(hr, power, trainer, speed) */
  function connectedKeyToCardType(key) {
    if (!key) return null;
    var k = String(key);
    if (k === 'heartRate') return 'hr';
    if (k === 'powerMeter') return 'power';
    if (k === 'trainer' || k === 'speed') return k;
    return key;
  }
  /** 연결 해제된 타입 기록 (연결해제 문구 표시용, 60초 후에는 저장됨으로 복귀) */
  var _lastDisconnectedTypes = {};
  var DISCONNECTED_LABEL_EXPIRE_MS = 60000;

  /** 연결 중 대기 타입과 이벤트 타입이 같은지 비교 (hr/heartRate 등 통일) */
  function isSameDeviceType(a, b) {
    if (!a || !b) return false;
    var ka = typeToConnectedKey(a);
    var kb = typeToConnectedKey(b);
    return ka === kb;
  }

  /**
   * deviceConnected: 해당 타입 카드 UI를 연결됨(녹색) + 다음 줄에 검색 시 보이는 디바이스 이름 표시
   * 앱이 name을 안 보내면 스캔 목록에서 선택한 _connectingDeviceName 사용. 동일 로직은 화면/팝업 공통 DOM이라 둘 다 반영됨.
   * payload: deviceType|type, deviceId|id, deviceName|name (앱 구현에 따라 필드명 유연 처리)
   */
  function onDeviceConnected(e) {
    var detail = e && e.detail;
    if (!detail) return;
    if (console && console.log) console.log('[deviceSettings] deviceConnected 수신', JSON.stringify({ deviceType: detail.deviceType, type: detail.type, deviceId: detail.deviceId, id: detail.id, deviceName: detail.deviceName, name: detail.name }));
    if (_connectFallbackTimeoutId) {
      clearTimeout(_connectFallbackTimeoutId);
      _connectFallbackTimeoutId = null;
    }
    var deviceType = detail.deviceType != null ? detail.deviceType : detail.type;
    if (deviceType && String(deviceType).toLowerCase() === 'smartrola') deviceType = 'trainer';
    var deviceId = detail.deviceId != null ? detail.deviceId : detail.id;
    if (!deviceId && _connectingDeviceType != null && deviceType && isSameDeviceType(deviceType, _connectingDeviceType) && global.StelvioDeviceBridgeStorage && typeof global.StelvioDeviceBridgeStorage.loadSavedDevices === 'function') {
      var saved = global.StelvioDeviceBridgeStorage.loadSavedDevices();
      var cKey = typeToConnectedKey(deviceType);
      var storageKey = (cKey === 'heartRate') ? 'hr' : (cKey === 'powerMeter') ? 'power' : cKey;
      if (saved && saved[storageKey]) deviceId = saved[storageKey];
    }
    var fromEvent = (detail.deviceName != null && String(detail.deviceName).trim()) ? String(detail.deviceName).trim() : (detail.name != null && String(detail.name).trim()) ? String(detail.name).trim() : '';
    var deviceName = fromEvent || (_connectingDeviceType != null && deviceType && isSameDeviceType(deviceType, _connectingDeviceType) && _connectingDeviceName ? String(_connectingDeviceName).trim() : '') || '';
    if (!deviceType) return;
    var key = typeToConnectedKey(deviceType);
    var cardType = connectedKeyToCardType(key) || (key || String(deviceType).toLowerCase());
    if (cardType) delete _lastDisconnectedTypes[cardType];
    setCardConnected(String(deviceType), deviceId, deviceName);
    if (deviceName) {
      if (global.connectedDevices && global.connectedDevices[key]) {
        global.connectedDevices[key].name = deviceName;
        global.connectedDevices[key].deviceName = deviceName;
      }
      if (global.StelvioDeviceBridgeStorage && typeof global.StelvioDeviceBridgeStorage.saveDevice === 'function') {
        var storageKey = cardType || (key === 'heartRate' ? 'hr' : key === 'powerMeter' ? 'power' : key);
        try { global.StelvioDeviceBridgeStorage.saveDevice(storageKey, deviceId, deviceName); } catch (err) { if (console && console.warn) console.warn('[deviceSettings] saveDevice name failed', err); }
      }
    }
    if (_connectingDeviceType != null && isSameDeviceType(deviceType, _connectingDeviceType)) {
      hideDeviceScanConnecting();
      _connectingDeviceName = null;
      _connectingDeviceType = null;
      closeDeviceScanModal();
    }
  }

  /** localStorage 키 (저장된 기기 이름) — 화면/팝업 열 때 항상 최신 이름 로드용 */
  var STORAGE_NAMES_KEY = 'stelvio_saved_devices_names_bridge';

  /**
   * 화면/팝업 열릴 때 저장된 기기로 카드 상태 초기화. 저장된 기기 이름은 항상 localStorage에서 로드해 계속 표시.
   * - 저장된 ID만 있고 실제 연결 안 됨 → "저장됨" + 기기 이름
   * - 실제 연결됨 → "연결됨" + 기기 이름
   */
  function refreshDeviceSettingCards() {
    var api = global.StelvioDeviceBridgeStorage;
    if (!api || typeof api.loadSavedDevices !== 'function') return;
    var saved = api.loadSavedDevices();
    if (!saved || typeof saved !== 'object') return;
    var names = (typeof api.loadSavedDeviceNames === 'function') ? api.loadSavedDeviceNames() : {};
    try {
      var raw = global.localStorage && global.localStorage.getItem(STORAGE_NAMES_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (var k in parsed) { if (parsed[k] != null && String(parsed[k]).trim()) names[k] = String(parsed[k]).trim(); }
        }
      }
    } catch (e) {}
    var connected = global.connectedDevices || {};
    var types = ['hr', 'power', 'trainer', 'speed'];
    var now = Date.now();
    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      var id = saved[t];
      var displayName = (names && names[t] && String(names[t]).trim()) ? String(names[t]).trim() : '';
      if (id) {
        var cKey = typeToConnectedKey(t);
        var conn = connected[cKey];
        var isActuallyConnected = conn && (conn.deviceId === id || conn.deviceId === String(id) || (conn.id && (conn.id === id || conn.id === String(id))));
        if (isActuallyConnected) {
          delete _lastDisconnectedTypes[t];
          var nameToShow = (displayName && String(displayName).trim()) ? String(displayName).trim() : (conn && (conn.name || conn.deviceName) ? (conn.name || conn.deviceName) : '');
          setCardConnected(t, id, nameToShow);
        } else {
          var disconnectedAt = _lastDisconnectedTypes[t];
          if (disconnectedAt != null && (now - disconnectedAt) < DISCONNECTED_LABEL_EXPIRE_MS) {
            setCardDisconnected(t, id, displayName);
          } else {
            if (disconnectedAt != null) delete _lastDisconnectedTypes[t];
            setCardSaved(t, id, displayName);
          }
        }
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
        setDeviceCardIconAndLabel(t, false);
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
  global.triggerDeviceRescan = triggerDeviceRescan;

  /**
   * 메인 메뉴 [센서 연결] 버튼용: 앱이면 설정 화면으로, 웹이면 안내만 표시 (데드락 방지)
   */
  global.openDeviceSettingsOrPrompt = function () {
    if (isAppEnvironment) {
      if (typeof global.showScreen === 'function') {
        global.showScreen('deviceSettingScreen');
      }
    } else {
      if (typeof global.showStelvioDeviceSettingsWebPopup === 'function') {
        global.showStelvioDeviceSettingsWebPopup();
      } else {
        alert('App설치 사용자 전용 메뉴입니다. 웹 사용자는 훈련화면에 연결버튼을 사용하세요.');
      }
    }
  };

  /** deviceError: 연결 대기 중이었으면 모달만 닫기. 실제 카드 갱신은 stelvio-connection-lost(디바운스 후)에서 처리 */
  function onDeviceError(e) {
    var detail = e && e.detail;
    var errorType = detail && (detail.deviceType != null ? detail.deviceType : detail.type);
    if (_connectingDeviceType != null && (!errorType || isSameDeviceType(errorType, _connectingDeviceType))) {
      if (_connectFallbackTimeoutId) {
        clearTimeout(_connectFallbackTimeoutId);
        _connectFallbackTimeoutId = null;
      }
      hideDeviceScanConnecting();
      _connectingDeviceName = null;
      _connectingDeviceType = null;
      closeDeviceScanModal();
      if (typeof global.StelvioDeviceSettings !== 'undefined' && typeof global.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') global.StelvioDeviceSettings.refreshDeviceSettingCards();
    }
  }

  /** stelvio-connection-lost: 디바운스 후 연결 해제 확정 시 카드에 "연결해제" 반영 */
  function onConnectionLost(e) {
    var detail = e && e.detail;
    var key = detail && detail.key;
    var cardType = connectedKeyToCardType(key);
    if (cardType) {
      _lastDisconnectedTypes[cardType] = Date.now();
      if (typeof global.StelvioDeviceSettings !== 'undefined' && typeof global.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') {
        global.StelvioDeviceSettings.refreshDeviceSettingCards();
      }
    }
  }

  /**
   * 앱에서 스캔 종료 알림 시 검색 완료 처리 (앱이 dispatchEvent('deviceScanComplete') 시 즉시 "기기 검색 완료" 표시)
   */
  var scanCompleteHandlerRef = null;
  function onDeviceScanComplete() {
    showScanComplete();
  }

  /**
   * 전역 리스너 등록 (deviceFound, deviceConnected, deviceError, knownDevices, deviceScanComplete)
   */
  var connectionLostHandlerRef = null;
  function attachListeners() {
    if (deviceFoundHandlerRef !== null) return;
    deviceFoundHandlerRef = onDeviceFound;
    deviceConnectedHandlerRef = onDeviceConnected;
    deviceErrorHandlerRef = onDeviceError;
    knownDevicesHandlerRef = onKnownDevices;
    connectionLostHandlerRef = onConnectionLost;
    scanCompleteHandlerRef = onDeviceScanComplete;
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('deviceFound', deviceFoundHandlerRef);
      global.addEventListener('deviceConnected', deviceConnectedHandlerRef);
      global.addEventListener('deviceError', deviceErrorHandlerRef);
      global.addEventListener('knownDevices', knownDevicesHandlerRef);
      global.addEventListener('stelvio-connection-lost', connectionLostHandlerRef);
      global.addEventListener('deviceScanComplete', scanCompleteHandlerRef);
    }
    var rescanBtn = document.getElementById('deviceScanRescanBtn');
    if (rescanBtn && !rescanBtn._deviceSettingsBound) {
      rescanBtn._deviceSettingsBound = true;
      rescanBtn.addEventListener('click', function () {
        triggerDeviceRescan();
      });
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

  /**
   * 연결 초기화: 저장된 디바이스 정보(ID·이름)를 모두 삭제하고 카드를 "미연결"로 갱신.
   * 센서 연결 화면·훈련 화면 연결 버튼 팝업 양쪽에서 사용 (동일 헤더 DOM).
   */
  function resetDeviceSettingsSaved() {
    if (typeof global.confirm === 'function' && !global.confirm('저장된 센서 연결 정보를 모두 초기화할까요?\n다시 기기를 검색해 연결해야 합니다.')) return;
    var api = global.StelvioDeviceBridgeStorage;
    if (api && typeof api.clearSavedDevices === 'function') api.clearSavedDevices();
    if (typeof global.StelvioDeviceSettings !== 'undefined' && typeof global.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') {
      global.StelvioDeviceSettings.refreshDeviceSettingCards();
    }
  }

  global.StelvioDeviceSettings = {
    refreshDeviceSettingCards: refreshDeviceSettingCards,
    closeDeviceScanModal: closeDeviceScanModal,
    resetDeviceSettingsSaved: resetDeviceSettingsSaved
  };

  global.resetDeviceSettingsSaved = resetDeviceSettingsSaved;
})(typeof window !== 'undefined' ? window : this);
