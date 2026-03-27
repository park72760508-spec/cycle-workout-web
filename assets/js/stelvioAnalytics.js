/**
 * STELVIO 사용자 행동 분석 (클라이언트)
 *
 * [권장 서버/Firestore Upsert용 JSON 페이로드 예시 — 주석]
 * 컬렉션: analytics_daily / 문서 ID: YYYY-MM-DD (로컬 날짜 또는 앱 표준 타임존)
 * {
 *   "date": "2025-03-27",
 *   "updatedAt": <ServerTimestamp>,
 *   "screens": {
 *     "deviceSettingScreen": 42,
 *     "workoutScreen": 10,
 *     "trainingJournalScreen": 5,
 *     "scheduleListScreen": 3,
 *     "performanceDashboardScreen": 8,
 *     "stelvioRankingBoardModal": 2,
 *     "mobileDashboardScreen": 15,
 *     "trainingScreen": 7,
 *     "bluetoothIndividualScreen": 4,
 *     "profileScreen": 9
 *   },
 *   "basecamp_unique": 120,
 *   "buttonClicks": {
 *     "nav_workout": 30,
 *     "settings_save": 5
 *   },
 *   "meta": { "schemaVersion": 1 }
 * }
 * - basecamp_unique: 일별 베이스캠프 "계정당 1회" 집계(서브컬렉션 bc_uniq/{uid}와 동기화)
 * - screens.*: 화면(또는 모달) 진입 횟수(중복 허용)
 * - buttonClicks.*: data-analytics-id 기준 누적 클릭
 */
(function (global) {
  'use strict';

  var BATCH_MS = 15000;
  var COLLECTION = 'analytics_daily';
  var STORAGE_PENDING = 'stelvio_analytics_pending_v1';

  /** @type {Object.<string, { screens: Object.<string, number>, clicks: Object.<string, number> }>} */
  var pendingBuckets = {};
  var flushTimer = null;
  var isFlushing = false;
  var docListenerBound = false;

  var TRACKED_SCREENS = {
    basecampScreen: true,
    deviceSettingScreen: true,
    workoutScreen: true,
    trainingJournalScreen: true,
    scheduleListScreen: true,
    performanceDashboardScreen: true,
    stelvioRankingBoardModal: true,
    mobileDashboardScreen: true,
    trainingScreen: true,
    bluetoothIndividualScreen: true,
    profileScreen: true
  };

  global.STELVIO_ANALYTICS_LABELS = {
    basecamp_unique: '접속자 수 (베이스캠프·계정당 1회/일)',
    deviceSettingScreen: '디바이스 설정',
    workoutScreen: '워크아웃',
    trainingJournalScreen: '라이딩 일지',
    scheduleListScreen: '훈련 스케줄',
    performanceDashboardScreen: '대시보드',
    stelvioRankingBoardModal: '랭킹보드',
    mobileDashboardScreen: '훈련 화면 (모바일)',
    trainingScreen: '훈련 화면 (태블릿)',
    bluetoothIndividualScreen: '훈련 화면 (그룹)',
    profileScreen: '사용자 정보'
  };

  function getLocalDateKey(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1);
    if (m.length < 2) m = '0' + m;
    var day = String(d.getDate());
    if (day.length < 2) day = '0' + day;
    return y + '-' + m + '-' + day;
  }

  function getFirestore() {
    return global.firestore || (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null);
  }

  function getAuthUser() {
    try {
      if (global.auth && global.auth.currentUser) return global.auth.currentUser;
      if (typeof firebase !== 'undefined' && firebase.auth) return firebase.auth().currentUser;
    } catch (e) {}
    return null;
  }

  function sanitizeClickId(id) {
    if (!id || typeof id !== 'string') return '';
    return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  }

  function addToPending(dateKey, kind, key, n) {
    if (!dateKey || !key || !n) return;
    if (!pendingBuckets[dateKey]) pendingBuckets[dateKey] = { screens: {}, clicks: {} };
    var bucket = pendingBuckets[dateKey][kind];
    bucket[key] = (bucket[key] || 0) + n;
  }

  function pendingIsEmpty() {
    for (var dk in pendingBuckets) {
      var b = pendingBuckets[dk];
      var sk = b.screens;
      var ck = b.clicks;
      for (var s in sk) if (sk[s]) return false;
      for (var c in ck) if (ck[c]) return false;
    }
    return true;
  }

  function clearPendingBuckets() {
    pendingBuckets = {};
  }

  function snapshotPendingForBeacon() {
    try {
      return JSON.stringify({ buckets: pendingBuckets, savedAt: Date.now() });
    } catch (e) {
      return '';
    }
  }

  function persistPendingToStorage() {
    try {
      if (pendingIsEmpty()) {
        global.sessionStorage && global.sessionStorage.removeItem(STORAGE_PENDING);
        return;
      }
      global.sessionStorage && global.sessionStorage.setItem(STORAGE_PENDING, snapshotPendingForBeacon());
    } catch (e) {}
  }

  function loadPendingFromStorage() {
    try {
      var raw = global.sessionStorage && global.sessionStorage.getItem(STORAGE_PENDING);
      if (!raw) return;
      var o = JSON.parse(raw);
      global.sessionStorage.removeItem(STORAGE_PENDING);
      if (!o || !o.buckets) return;
      for (var dk in o.buckets) {
        var b = o.buckets[dk];
        if (!b) continue;
        var screens = b.screens || {};
        var clicks = b.clicks || {};
        for (var ks in screens) addToPending(dk, 'screens', ks, screens[ks]);
        for (var kc in clicks) addToPending(dk, 'clicks', kc, clicks[kc]);
      }
    } catch (e) {}
  }

  function mergeBeaconPayload(str) {
    try {
      var o = JSON.parse(str);
      if (!o || !o.buckets) return;
      for (var dk in o.buckets) {
        var b = o.buckets[dk];
        if (!b) continue;
        var screens = b.screens || {};
        var clicks = b.clicks || {};
        for (var ks in screens) addToPending(dk, 'screens', ks, screens[ks]);
        for (var kc in clicks) addToPending(dk, 'clicks', kc, clicks[kc]);
      }
    } catch (e) {}
  }

  function flushPendingToFirestore(reason) {
    if (isFlushing) return;
    if (pendingIsEmpty()) return;
    var fs = getFirestore();
    var user = getAuthUser();
    if (!fs || !user) {
      persistPendingToStorage();
      return;
    }

    isFlushing = true;
    var toFlush = pendingBuckets;
    clearPendingBuckets();

    var batch = fs.batch();
    var FieldValue = firebase.firestore.FieldValue;
    var ops = 0;

    try {
      for (var dateKey in toFlush) {
        var b = toFlush[dateKey];
        if (!b) continue;
        var ref = fs.collection(COLLECTION).doc(dateKey);
        var upd = {
          date: dateKey,
          updatedAt: FieldValue.serverTimestamp(),
          lastWriterUid: user.uid
        };
        var screens = b.screens || {};
        var clicks = b.clicks || {};
        var hasAny = false;
        for (var sk in screens) {
          if (!screens[sk]) continue;
          upd['screens.' + sk] = FieldValue.increment(screens[sk]);
          hasAny = true;
        }
        for (var ck in clicks) {
          if (!clicks[ck]) continue;
          upd['buttonClicks.' + ck] = FieldValue.increment(clicks[ck]);
          hasAny = true;
        }
        if (hasAny) {
          batch.set(ref, upd, { merge: true });
          ops++;
        }
      }

      if (ops === 0) {
        isFlushing = false;
        return;
      }

      batch
        .commit()
        .then(function () {
          isFlushing = false;
        })
        .catch(function (err) {
          console.warn('[StelvioAnalytics] flush 실패:', err && err.message);
          isFlushing = false;
          for (var dk in toFlush) {
            var bb = toFlush[dk];
            if (!bb) continue;
            var ss = bb.screens || {};
            var cc = bb.clicks || {};
            for (var k in ss) addToPending(dk, 'screens', k, ss[k]);
            for (var k2 in cc) addToPending(dk, 'clicks', k2, cc[k2]);
          }
          persistPendingToStorage();
        });
    } catch (e) {
      console.warn('[StelvioAnalytics] batch 오류:', e);
      isFlushing = false;
      for (var dk2 in toFlush) {
        var bb2 = toFlush[dk2];
        if (!bb2) continue;
        var ss2 = bb2.screens || {};
        var cc2 = bb2.clicks || {};
        for (var k3 in ss2) addToPending(dk2, 'screens', k3, ss2[k3]);
        for (var k4 in cc2) addToPending(dk2, 'clicks', k4, cc2[k4]);
      }
      persistPendingToStorage();
    }
  }

  function ensureBasecampUniqueForUser() {
    var fs = getFirestore();
    var user = getAuthUser();
    if (!fs || !user) return;

    var dateKey = getLocalDateKey();
    var uid = user.uid;
    var uniqRef = fs.collection(COLLECTION).doc(dateKey).collection('bc_uniq').doc(uid);
    var parentRef = fs.collection(COLLECTION).doc(dateKey);

    return fs
      .runTransaction(function (tx) {
        return tx.get(uniqRef).then(function (snap) {
          if (snap.exists) return null;
          tx.set(uniqRef, { v: 1, at: firebase.firestore.FieldValue.serverTimestamp() });
          tx.set(
            parentRef,
            {
              date: dateKey,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              basecamp_unique: firebase.firestore.FieldValue.increment(1)
            },
            { merge: true }
          );
        });
      })
      .catch(function (e) {
        console.warn('[StelvioAnalytics] basecamp unique:', e && e.message);
      });
  }

  function recordScreenVisit(screenId) {
    if (!screenId || !TRACKED_SCREENS[screenId]) return;
    var dateKey = getLocalDateKey();
    if (screenId === 'basecampScreen') {
      ensureBasecampUniqueForUser();
      return;
    }
    addToPending(dateKey, 'screens', screenId, 1);
  }

  global.stelvioAnalyticsOnScreenChange = function (screenId) {
    try {
      recordScreenVisit(screenId);
    } catch (e) {}
  };

  global.stelvioAnalyticsRecordScreen = function (screenId) {
    recordScreenVisit(screenId);
  };

  global.stelvioAnalyticsRecordRankingModal = function () {
    recordScreenVisit('stelvioRankingBoardModal');
  };

  function onDocumentClickCapture(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var el = t.closest('[data-analytics-id]');
    if (!el) return;
    var raw = el.getAttribute('data-analytics-id');
    var id = sanitizeClickId(raw);
    if (!id) return;
    var dateKey = getLocalDateKey();
    addToPending(dateKey, 'clicks', id, 1);
  }

  function sendBeaconIfConfigured() {
    var url = (global.CONFIG && global.CONFIG.ANALYTICS_BEACON_URL) || global.STELVIO_ANALYTICS_BEACON_URL;
    if (!url || pendingIsEmpty()) return false;
    var blob = new Blob([snapshotPendingForBeacon()], { type: 'application/json;charset=UTF-8' });
    try {
      return global.navigator.sendBeacon(url, blob);
    } catch (e) {
      return false;
    }
  }

  function onUnloadDefense() {
    if (pendingIsEmpty()) return;
    persistPendingToStorage();
    sendBeaconIfConfigured();
    flushPendingToFirestore('unload');
  }

  function onVisibilityChange() {
    if (global.document.hidden) {
      flushPendingToFirestore('visibility');
    }
  }

  function startIntervalFlush() {
    if (flushTimer) return;
    flushTimer = global.setInterval(function () {
      flushPendingToFirestore('interval');
    }, BATCH_MS);
  }

  function bindLifecycle() {
    if (docListenerBound) return;
    docListenerBound = true;
    global.document.addEventListener('click', onDocumentClickCapture, true);
    global.document.addEventListener('visibilitychange', onVisibilityChange, false);
    global.addEventListener('pagehide', onUnloadDefense, false);
    global.addEventListener('beforeunload', onUnloadDefense, false);
    startIntervalFlush();
  }

  function init() {
    loadPendingFromStorage();
    bindLifecycle();
    flushPendingToFirestore('init');
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /** 관리자 전용: 접속 통계 화면 열기 */
  global.openAccessStatsScreen = function () {
    var g =
      typeof global.getLoginUserGrade === 'function'
        ? String(global.getLoginUserGrade())
        : typeof global.getViewerGrade === 'function'
          ? String(global.getViewerGrade())
          : '2';
    var ok =
      typeof global.isStelvioAdminGrade === 'function'
        ? global.isStelvioAdminGrade(g)
        : String(g).trim() === '1' || Number(g) === 1;
    if (!ok) {
      if (typeof global.showToast === 'function') global.showToast('관리자만 이용할 수 있습니다.');
      else alert('관리자만 이용할 수 있습니다.');
      return;
    }
    if (typeof global.closeSettingsModal === 'function') global.closeSettingsModal();
    if (typeof global.showScreen === 'function') global.showScreen('accessStatsScreen');
  };

  global.closeAccessStatsScreen = function () {
    if (typeof global.showScreen === 'function') global.showScreen('basecampScreen');
  };

  /** 접속 통계 화면 UI (미니 달력 + 카드) */
  global.renderAccessStatsView = function () {
    if (!global._accessStatsSelectedYMD) global._accessStatsSelectedYMD = getLocalDateKey();
    var d0 = parseYMD(global._accessStatsSelectedYMD);
    accessStatsViewMonth = new Date(d0.getFullYear(), d0.getMonth(), 1);
    var host = global.document.getElementById('accessStatsCalendarHost');
    if (!host || !global.renderAccessStatsCalendar) return;
    global.renderAccessStatsCalendar(host);
  };

  var accessStatsViewMonth = new Date();

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function parseYMD(s) {
    var p = (s || '').split('-');
    if (p.length !== 3) return new Date();
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }

  function monthMatrix(year, month0) {
    var first = new Date(year, month0, 1);
    var startWeekday = first.getDay();
    var dim = new Date(year, month0 + 1, 0).getDate();
    var cells = [];
    var i;
    for (i = 0; i < startWeekday; i++) cells.push(null);
    for (i = 1; i <= dim; i++) cells.push(i);
    while (cells.length % 7 !== 0) cells.push(null);
    while (cells.length < 42) cells.push(null);
    return cells;
  }

  function renderAccessStatsCards(dateStr, data) {
    var body = global.document.getElementById('accessStatsBody');
    if (!body) return;
    var labels = global.STELVIO_ANALYTICS_LABELS || {};
    var screens = (data && data.screens) || {};
    var bu =
      data && typeof data.basecamp_unique === 'number' ? data.basecamp_unique : '—';

    var order = [
      { key: 'basecamp_unique', val: bu, isSpecial: true },
      { key: 'deviceSettingScreen', val: screens.deviceSettingScreen },
      { key: 'workoutScreen', val: screens.workoutScreen },
      { key: 'trainingJournalScreen', val: screens.trainingJournalScreen },
      { key: 'scheduleListScreen', val: screens.scheduleListScreen },
      { key: 'performanceDashboardScreen', val: screens.performanceDashboardScreen },
      { key: 'stelvioRankingBoardModal', val: screens.stelvioRankingBoardModal },
      { key: 'mobileDashboardScreen', val: screens.mobileDashboardScreen },
      { key: 'trainingScreen', val: screens.trainingScreen },
      { key: 'bluetoothIndividualScreen', val: screens.bluetoothIndividualScreen },
      { key: 'profileScreen', val: screens.profileScreen }
    ];

    var parts = [];
    parts.push(
      '<div style="font-size:13px;color:#64748b;margin-bottom:12px;">선택한 날짜: <strong style="color:#0f172a;">' +
        dateStr +
        '</strong></div>'
    );
    parts.push('<div class="access-stats-grid">');
    for (var i = 0; i < order.length; i++) {
      var row = order[i];
      var label = labels[row.key] || row.key;
      var v = row.isSpecial ? row.val : row.val != null ? row.val : '—';
      parts.push(
        '<div class="access-stats-card">' +
          '<div class="access-stats-card-label">' +
          label +
          '</div>' +
          '<div class="access-stats-card-value">' +
          v +
          '</div>' +
          '</div>'
      );
    }
    parts.push('</div>');
    body.innerHTML = parts.join('');
  }

  function fetchAccessStatsForDate(dateStr) {
    var fs = getFirestore();
    var body = global.document.getElementById('accessStatsBody');
    if (!fs || !body) return;
    body.innerHTML =
      '<div style="text-align:center;padding:24px;color:#64748b;">불러오는 중…</div>';
    fs.collection(COLLECTION)
      .doc(dateStr)
      .get()
      .then(function (snap) {
        var d = snap.exists ? snap.data() : {};
        renderAccessStatsCards(dateStr, d || {});
      })
      .catch(function (e) {
        body.innerHTML =
          '<div style="text-align:center;padding:24px;color:#dc2626;">통계를 불러오지 못했습니다. (' +
          (e && e.message ? e.message : '오류') +
          ')</div>';
      });
  }

  global.renderAccessStatsCalendar = function (host) {
    if (!host) return;
    var y = accessStatsViewMonth.getFullYear();
    var m = accessStatsViewMonth.getMonth();
    var cells = monthMatrix(y, m);
    var title = y + '년 ' + (m + 1) + '월';
    if (!global._accessStatsSelectedYMD) global._accessStatsSelectedYMD = getLocalDateKey();
    var selected = global._accessStatsSelectedYMD;

    var html = [];
    html.push('<div class="access-stats-cal-wrap">');
    html.push('<div class="access-stats-cal-nav">');
    html.push(
      '<button type="button" class="access-stats-cal-btn" id="accessStatsPrevMonth" aria-label="이전 달">◀</button>'
    );
    html.push('<span class="access-stats-cal-title">' + title + '</span>');
    html.push(
      '<button type="button" class="access-stats-cal-btn" id="accessStatsNextMonth" aria-label="다음 달">▶</button>'
    );
    html.push('</div>');
    html.push('<div class="access-stats-weekdays">');
    var wds = ['일', '월', '화', '수', '목', '금', '토'];
    for (var w = 0; w < 7; w++) {
      html.push('<span>' + wds[w] + '</span>');
    }
    html.push('</div>');
    html.push('<div class="access-stats-cal-grid">');
    for (var c = 0; c < cells.length; c++) {
      var day = cells[c];
      if (day === null) {
        html.push('<span class="access-stats-cal-cell empty"></span>');
      } else {
        var ymd = y + '-' + pad2(m + 1) + '-' + pad2(day);
        var sel = ymd === selected ? ' selected' : '';
        html.push(
          '<button type="button" class="access-stats-cal-cell' +
            sel +
            '" data-ymd="' +
            ymd +
            '">' +
            day +
            '</button>'
        );
      }
    }
    html.push('</div>');
    html.push('</div>');
    host.innerHTML = html.join('');

    var prev = global.document.getElementById('accessStatsPrevMonth');
    var next = global.document.getElementById('accessStatsNextMonth');
    if (prev) {
      prev.onclick = function () {
        accessStatsViewMonth = new Date(y, m - 1, 1);
        global.renderAccessStatsCalendar(host);
      };
    }
    if (next) {
      next.onclick = function () {
        accessStatsViewMonth = new Date(y, m + 1, 1);
        global.renderAccessStatsCalendar(host);
      };
    }

    var btns = host.querySelectorAll('button.access-stats-cal-cell[data-ymd]');
    for (var b = 0; b < btns.length; b++) {
      btns[b].onclick = function (ev) {
        var ymd = ev.currentTarget.getAttribute('data-ymd');
        if (!ymd) return;
        global._accessStatsSelectedYMD = ymd;
        global.renderAccessStatsCalendar(host);
        fetchAccessStatsForDate(ymd);
      };
    }

    fetchAccessStatsForDate(selected);
  };
})(typeof window !== 'undefined' ? window : this);
