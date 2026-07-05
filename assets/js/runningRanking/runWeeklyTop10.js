/**
 * RUN 주간 마일리지 TOP10 모달
 * ─ CYCLE STELVIO 주간 TOP10과 동일 디자인/로직. 지표만 "주간(월~일) 누적 거리(km)".
 *
 * 데이터: runningRankingApi.fetchLeaderboard() (get_running_leaderboard → weekly_distance_km)
 * 등락  : runningRankingMovement.applyRankMovement — 일~토 실시간, 일 21시 확정 후 21시 이전 스냅샷 고정
 * 표시  : 1~10위 + 하단 나의 순위/거리 + 순위 등락(↑↓)
 */
(function () {
  'use strict';

  var LS_DONT_SHOW = 'runWeeklyTop10DontShowDate';
  /** 일요일 21시 순위 확정 이후 — 21시 직전 등락 스냅샷 재사용 (CYCLE weeklyTop10 캐시 등락과 동일 개념) */
  var LS_RANK_MV_PREFIX = 'runWeeklyTop10RankMv:v1:';

  function cfg() { return window.runningRankingConfig || {}; }
  function fmt() { return window.runningRankingFormat || {}; }
  function api() { return window.runningRankingApi || null; }
  function dataMod() { return window.runningRankingData || null; }
  function moveMod() { return window.runningRankingMovement || null; }

  function seoulToday() {
    if (typeof window.getSeoulDateStringYYYYMMDD === 'function') {
      try { return window.getSeoulDateStringYYYYMMDD(); } catch (e) {}
    }
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    } catch (e) {
      var d = new Date();
      var m = d.getMonth() + 1;
      var day = d.getDate();
      return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
    }
  }

  /** 서울 기준 주간 범위. weekOffset 0=이번 주, -1=전주(월~일) */
  function seoulWeekRangeOffset(weekOffset) {
    weekOffset = weekOffset == null ? 0 : Number(weekOffset);
    var ymd = seoulToday();
    var parts = ymd.split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    var base = new Date(y, m - 1, d);
    var dow = base.getDay();
    var mondayOffset = dow === 0 ? -6 : 1 - dow;
    var mon = new Date(base);
    mon.setDate(base.getDate() + mondayOffset + weekOffset * 7);
    var end = new Date(mon);
    if (weekOffset < 0) {
      end.setDate(mon.getDate() + 6);
    } else {
      end = new Date(base);
    }
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return {
      startStr: mon.getFullYear() + '-' + pad(mon.getMonth() + 1) + '-' + pad(mon.getDate()),
      endStr: end.getFullYear() + '-' + pad(end.getMonth() + 1) + '-' + pad(end.getDate())
    };
  }

  function seoulWeekRange() {
    return seoulWeekRangeOffset(0);
  }

  function isSuppressedToday() {
    try { return localStorage.getItem(LS_DONT_SHOW) === seoulToday(); } catch (e) { return false; }
  }
  function setSuppressedToday() {
    try { localStorage.setItem(LS_DONT_SHOW, seoulToday()); } catch (e) {}
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** CYCLE 주간 TOP10과 동일한 원 스피너 디자인 (assets/css/style.css .weekly-top10-* 전역 클래스 재사용) */
  function loadingHtml() {
    return '<div class="weekly-top10-loading" aria-live="polite" aria-busy="true">' +
      '<div class="weekly-top10-spinner" role="img" aria-label="로딩 중"></div>' +
      '<p class="weekly-top10-loading-text">주간 마일리지 TOP10 불러오는 중...</p>' +
      '</div>';
  }

  function avatarHtml(profUrl, userId, name) {
    if (typeof window.stelvioRankingAvatarHtml === 'function') {
      return window.stelvioRankingAvatarHtml(profUrl, { userId: userId, overlayName: name });
    }
    if (profUrl) {
      return '<span class="weekly-rank-avatar"><img src="' + escapeHtml(profUrl) +
        '" alt="" width="28" height="28" style="border-radius:50%;object-fit:cover;" decoding="async" /></span>';
    }
    var initial = name && name.length ? escapeHtml(name.charAt(0)) : '·';
    return '<span class="weekly-rank-avatar weekly-rank-avatar-fallback" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#ede9fe;color:#7c3aed;font-weight:700;font-size:13px;">' + initial + '</span>';
  }

  /** CYCLE stelvioServerRankChangeBadgeHtml 와 동일 클래스(↑↓) */
  function rankChangeBadgeHtml(item) {
    if (!item || item.rankChange == null || item.previousBoardRank == null) return '';
    var rc = Number(item.rankChange);
    var prev = Math.floor(Number(item.previousBoardRank));
    if (!isFinite(rc) || !isFinite(prev) || prev < 1) return '';
    if (rc > 0) {
      return '<span class="stelvio-rank-change stelvio-rank-change--up weekly-rank-change-tight" style="margin-left:0;margin-right:0;" title="전날 ' + prev + '위">(↑' + rc + ')</span>';
    }
    if (rc < 0) {
      return '<span class="stelvio-rank-change stelvio-rank-change--down weekly-rank-change-tight" style="margin-left:0;margin-right:0;" title="전날 ' + prev + '위">(↓' + Math.abs(rc) + ')</span>';
    }
    return '<span class="stelvio-rank-change stelvio-rank-change--flat weekly-rank-change-tight" style="margin-left:0;margin-right:0;" title="전날 ' + prev + '위">(-)</span>';
  }

  /** 순위 행에는 값만 표기 (단위 km 는 캡션 우측에 표시) */
  function kmLabel(km) {
    return fmt().formatDistanceKm ? fmt().formatDistanceKm(km) : (Number(km) || 0).toFixed(1);
  }

  function resolveViewerFirebaseUid() {
    if (typeof window.stelvioResolveRankingViewerUserId === 'function') {
      var uid = window.stelvioResolveRankingViewerUserId();
      if (uid) return String(uid);
    }
    var cur = window.currentUser;
    if (cur && (cur.id || cur.uid)) return String(cur.id || cur.uid);
    try {
      var ls = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (ls && (ls.id || ls.uid)) return String(ls.id || ls.uid);
    } catch (e) {}
    return '';
  }

  function isPrivateRow(item) {
    if (typeof window.stelvioRankingIsPrivateRow === 'function') {
      return window.stelvioRankingIsPrivateRow(item);
    }
    return !!(item && (item.is_private === true || item.isPrivate === true));
  }

  function canSeePrivateFull(item, isSelf) {
    if (isSelf) return true;
    var uid = String((item && (item.userId || item.firebaseUid || item.socialUserId)) || '');
    if (uid && typeof window.stelvioRankingCanViewerSeeUserFull === 'function') {
      return window.stelvioRankingCanViewerSeeUserFull(uid);
    }
    if (typeof window.stelvioRankingViewerCanSeePrivateNames === 'function' &&
      window.stelvioRankingViewerCanSeePrivateNames()) {
      return true;
    }
    return false;
  }

  function resolveRawName(item) {
    if (typeof window.stelvioRankingResolveRowRawName === 'function') {
      return window.stelvioRankingResolveRowRawName(item);
    }
    return (item && item.name) ? String(item.name) : '러너';
  }

  function resolveMaskedName(rawName) {
    if (typeof window.stelvioRankingPrivateMaskedDisplayName === 'function') {
      return window.stelvioRankingPrivateMaskedDisplayName(rawName);
    }
    var n = rawName || '러너';
    return n.length >= 1 ? n.charAt(0) + '**' : '**';
  }

  function resolveProfileUrl(item) {
    if (typeof window.stelvioRankingProfileImageUrlForDisplay === 'function') {
      return window.stelvioRankingProfileImageUrlForDisplay({
        profileImageUrl: item.profileUrl || item.profileImageUrl,
        profile_image_url: item.profileUrl || item.profileImageUrl
      });
    }
    return item.profileUrl || item.profileImageUrl || null;
  }

  /** CYCLE weeklyTop10 renderTop10 — stelvioWeeklyTop10RankChangeBadgeHtml 우선 */
  function weeklyRankChangeTightHtml(item, boardRank) {
    if (typeof window.stelvioWeeklyTop10RankChangeBadgeHtml === 'function') {
      return window.stelvioWeeklyTop10RankChangeBadgeHtml(item, boardRank);
    }
    var rc = window.runningRankingRankChange;
    if (rc && typeof rc.badgeHtmlForListItem === 'function') {
      var h = rc.badgeHtmlForListItem(item, 'Supremo');
      if (!h) return '';
      return h.replace(
        'class="stelvio-rank-change ',
        'style="margin-left:0;margin-right:0;" class="stelvio-rank-change weekly-rank-change-tight '
      );
    }
    return rankChangeBadgeHtml(item);
  }

  function toSocialRow(item) {
    return {
      userId: item.userId || item.firebaseUid,
      firebaseUid: item.firebaseUid || item.userId,
      boardUserId: item.boardUserId,
      name: item.name,
      is_private: item.is_private != null ? item.is_private : item.isPrivate,
      profileImageUrl: item.profileUrl || item.profileImageUrl,
      rank: item.rank,
      rankChange: item.rankChange,
      previousBoardRank: item.previousBoardRank
    };
  }

  /** CYCLE stelvioRefreshWeeklyTop10RankChangeDom — ranking[] 페이로드 변환 */
  function buildRankRefreshPayload(list, myItem) {
    function rowFromItem(it) {
      if (!it) return null;
      return {
        userId: String(it.firebaseUid || it.userId || ''),
        rank: it.rank,
        rankChange: it.rankChange,
        previousBoardRank: it.previousBoardRank
      };
    }
    var ranking = [];
    var i;
    for (i = 0; i < Math.min(10, (list || []).length); i++) {
      var row = rowFromItem(list[i]);
      if (row) ranking.push(row);
    }
    var payload = { ranking: ranking };
    if (myItem && myItem.rank > 10) {
      var myRow = rowFromItem(myItem);
      if (myRow) payload.myRank = myRow;
    }
    return payload;
  }

  /** CYCLE fetchAndShowWeeklyTop10Modal renderTop10 — DOM 등락 재주입(모바일 WebView) */
  function refreshRankChangeDom(bodyEl, list, myItem) {
    if (!bodyEl || typeof window.stelvioRefreshWeeklyTop10RankChangeDom !== 'function') return;
    var payload = buildRankRefreshPayload(list, myItem);
    window.stelvioRefreshWeeklyTop10RankChangeDom(bodyEl, payload);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.stelvioRefreshWeeklyTop10RankChangeDom(bodyEl, payload);
      });
    });
    setTimeout(function () {
      window.stelvioRefreshWeeklyTop10RankChangeDom(bodyEl, payload);
    }, 600);
    setTimeout(function () {
      window.stelvioRefreshWeeklyTop10RankChangeDom(bodyEl, payload);
    }, 1500);
  }

  function weekRankMvCacheKey(weekStartStr) {
    return LS_RANK_MV_PREFIX + (weekStartStr || seoulWeekRange().startStr);
  }

  function extractRankMvSnap(list) {
    var snap = {};
    (list || []).forEach(function (it) {
      if (!it || it.rankChange == null || it.previousBoardRank == null) return;
      var rc = Number(it.rankChange);
      var pr = Math.floor(Number(it.previousBoardRank));
      if (!isFinite(rc) || !isFinite(pr) || pr < 1) return;
      var payload = { rankChange: rc, previousBoardRank: pr };
      var ids = [it.boardUserId, it.firebaseUid, it.userId, it.socialUserId];
      var i;
      for (i = 0; i < ids.length; i++) {
        if (ids[i] != null && String(ids[i]).trim()) snap[String(ids[i]).trim()] = payload;
      }
    });
    return snap;
  }

  /** @returns {number} 냉동 스냅샷과 매칭되어 등락이 채워진 항목 수 */
  function applyRankMvSnap(list, snap) {
    if (!list || !list.length || !snap) return 0;
    var matched = 0;
    list.forEach(function (it) {
      if (!it) return;
      var ids = [it.boardUserId, it.firebaseUid, it.userId, it.socialUserId];
      var pk = null;
      var i;
      for (i = 0; i < ids.length; i++) {
        if (ids[i] != null && snap[String(ids[i])]) {
          pk = snap[String(ids[i])];
          break;
        }
      }
      if (pk) {
        it.rankChange = pk.rankChange;
        it.previousBoardRank = pk.previousBoardRank;
        matched++;
      } else {
        it.rankChange = null;
        it.previousBoardRank = null;
      }
    });
    return matched;
  }

  function loadWeekRankMvCache(weekStartStr) {
    try {
      var raw = localStorage.getItem(weekRankMvCacheKey(weekStartStr));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.snap || typeof parsed.snap !== 'object') return null;
      if (parsed.weekStart && parsed.weekStart !== weekStartStr) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function saveWeekRankMvCache(weekStartStr, list, opts) {
    opts = opts || {};
    var snap = extractRankMvSnap(list);
    if (!Object.keys(snap).length) return;
    try {
      localStorage.setItem(weekRankMvCacheKey(weekStartStr), JSON.stringify({
        weekStart: weekStartStr,
        savedAt: seoulToday(),
        finalized: opts.finalized === true,
        snap: snap
      }));
    } catch (e) {}
  }

  function hasUsableRankMvSnap(snap) {
    if (!snap || typeof snap !== 'object') return false;
    return Object.keys(snap).length > 0;
  }

  /** 리더보드 rows → 주간 거리 랭킹 목록 (등락 적용 완료) */
  function buildList(res, opts) {
    opts = opts || {};
    var d = dataMod();
    var rows = (res && res.rows) || [];
    var list = [];
    rows.forEach(function (r) {
      if (!r) return;
      var km = Number(r.weekly_distance_km);
      if (!isFinite(km) || km <= 0) return;
      var fbUid = d ? d.rowFirebaseUid(r) : (r.user_info && r.user_info.firebase_uid) || '';
      var boardUid = d ? d.rowUserId(r) : (r.user_info && r.user_info.user_id) || '';
      var displayName = (r.user_info && r.user_info.display_name) ? String(r.user_info.display_name) : '러너';
      var socialRow = {
        userId: fbUid || boardUid,
        firebaseUid: fbUid,
        boardUserId: boardUid,
        socialUserId: fbUid || boardUid,
        name: displayName,
        is_private: d ? (d.isPrivateRow(r) ? true : false) : !!(r.user_info && r.user_info.is_private),
        profileUrl: (r.user_info && r.user_info.profile_image_url) ? String(r.user_info.profile_image_url) : '',
        profileImageUrl: (r.user_info && r.user_info.profile_image_url) ? String(r.user_info.profile_image_url) : ''
      };
      list.push({
        userId: socialRow.userId,
        boardUserId: boardUid,
        firebaseUid: fbUid,
        socialUserId: socialRow.socialUserId,
        name: displayName,
        is_private: socialRow.is_private,
        isPrivate: socialRow.is_private,
        profileUrl: socialRow.profileUrl,
        profileImageUrl: socialRow.profileImageUrl,
        value: km,
        raw: r
      });
    });
    list.sort(function (a, b) {
      var diff = b.value - a.value;
      if (diff !== 0) return diff;
      var au = String(a.userId || '');
      var bu = String(b.userId || '');
      return au < bu ? -1 : au > bu ? 1 : 0;
    });
    list.forEach(function (it, i) { it.rank = i + 1; });

    var mv = moveMod();
    /* 전주 응답 자체엔 rankMovementByKey 가 비어 있으므로, 전주 표시 시엔 메인 응답에서 넘겨받은
       주간 스냅샷(opts.rankMovementByKey)을 사용한다. 현재 주는 res 의 것을 사용. */
    var mvByKey = (res && res.rankMovementByKey && Object.keys(res.rankMovementByKey).length)
      ? res.rankMovementByKey
      : (opts.rankMovementByKey || {});
    var mvOpts = {
      gender: 'all',
      category: 'Supremo',
      rankMovementSource: (res && res.rankMovementSource) || opts.rankMovementSource || '',
      leaderboardSource: (res && res.leaderboardSource) || opts.leaderboardSource || '',
      leaderboardAsOfSeoul: (res && res.leaderboardAsOfSeoul) || opts.leaderboardAsOfSeoul || '',
      rankMovementAsOfSeoul: (res && res.rankMovementAsOfSeoul) || opts.rankMovementAsOfSeoul || ''
    };

    if (opts.isPrevWeek) {
      /* 전주 확정 순위 — 지난주 마지막날 집계 스냅샷(run_weekly_distance_*)의 서버 공식 등락 적용.
         (월요일 등 새 주 시작 시 이번 주 거리가 0이라 전주 확정 화면으로 폴백되는 경로) */
      if (mv && typeof mv.applyRankMovement === 'function') {
        mv.applyRankMovement(list, 'weekly_distance', mvOpts, mvByKey);
      }
      return list;
    }

    var weekStartStr = seoulWeekRange().startStr;
    var finalized = isWeeklyRankingFinalizedSeoul();

    if (finalized) {
      /* 순위 확정(일 21시~) — 21시 이전에 저장된 등락 스냅샷 고정 표시 (CYCLE weeklyTop10 캐시 등락) */
      var frozen = loadWeekRankMvCache(weekStartStr);
      if (frozen && hasUsableRankMvSnap(frozen.snap)) {
        /* 냉동 스냅샷이 현재 목록과 하나라도 매칭될 때만 확정 등락으로 사용.
           매칭 0건이면 (예: 캐시 식별자 불일치) 아래 라이브 등락 계산으로 폴백 */
        if (applyRankMvSnap(list, frozen.snap) > 0) {
          return list;
        }
      }
    }

    if (mv && typeof mv.applyRankMovement === 'function') {
      mv.applyRankMovement(list, 'weekly_distance', mvOpts, mvByKey);
    }

    if (finalized) {
      saveWeekRankMvCache(weekStartStr, list, { finalized: true });
    } else if (hasUsableRankMvSnap(extractRankMvSnap(list))) {
      /* 21시 이전 — 매 조회마다 등락 갱신·저장 → 21시 이후 확정 화면에서 동일 등락 재사용 */
      saveWeekRankMvCache(weekStartStr, list, { finalized: false });
    }
    return list;
  }

  /** CYCLE 주간 TOP10과 동일: Asia/Seoul 기준 일요일 21시 이후 순위 확정 */
  function isWeeklyRankingFinalizedSeoul() {
    try {
      var now = new Date();
      var hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false });
      var weekDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' });
      var seoulHour = parseInt(hourFmt.format(now), 10);
      var seoulWeekday = weekDayFmt.format(now);
      return seoulWeekday === 'Sun' && seoulHour >= 21;
    } catch (e) {
      return false;
    }
  }

  /** CYCLE weeklyTop10 renderTop10 과 동일 도장 오버레이 (assets/img/crop1.png) */
  function weeklyTop10StampOverlayHtml() {
    return '<div class="weekly-top10-stamp-overlay" style="position:absolute;left:0;top:0;right:0;bottom:0;display:flex;justify-content:center;align-items:center;pointer-events:none;">' +
      '<img src="assets/img/crop1.png" alt="" class="weekly-top10-stamp-img" style="width:240px;height:auto;display:block;" />' +
      '</div>';
  }

  function rowHtml(item, opts) {
    opts = opts || {};
    var rank = item.rank;
    var medalSrc = (cfg().MEDAL_SRC) || ['assets/img/1st.svg', 'assets/img/2nd.svg', 'assets/img/3rd.svg'];
    var social = toSocialRow(item);
    var isSelf = !!opts.isSelf;
    var isPrivate = isPrivateRow(social);
    var canSee = canSeePrivateFull(social, isSelf);
    var rawName = escapeHtml(resolveRawName(social));
    var displayText;
    var privateBadge = '';
    if (isPrivate) {
      if (canSee) {
        displayText = rawName;
        privateBadge =
          '<span class="ranking-private-badge ranking-private-badge-admin weekly-rank-private-badge-tight" style="margin-left:0;margin-right:0;" title="비공개">비</span>';
      } else {
        displayText = escapeHtml(resolveMaskedName(social.name));
      }
    } else {
      displayText = rawName;
    }
    var profUrl = resolveProfileUrl(social);
    var avatarUid = String(social.userId || social.firebaseUid || '');
    var badge = weeklyRankChangeTightHtml(social, rank);
    var html = '<div class="weekly-rank-item' + (isSelf ? ' weekly-rank-item-self' : '') + '"' + (isSelf ? ' id="runWeeklyTop10MyRankRow"' : '') + '>';
    if (rank <= 3) {
      html += '<span class="weekly-rank-medal"><img src="' + medalSrc[rank - 1] + '" alt="" width="20" height="20" decoding="async" /></span>';
    }
    html += '<span class="weekly-rank-position">' + rank + '위</span>';
    html += '<span class="weekly-rank-name">' + avatarHtml(profUrl, avatarUid, displayText) +
      '<span class="weekly-rank-name-text" title="' + rawName + '">' +
      '<span class="weekly-rank-name-label">' + displayText + '</span>' +
      '<span class="weekly-rank-change-slot">' + badge + privateBadge + '</span></span></span>';
    html += '<span class="weekly-rank-tss">' + kmLabel(item.value) + '</span>';
    html += '</div>';
    return html;
  }

  function render(list, renderOpts) {
    renderOpts = renderOpts || {};
    var isPrevWeek = !!renderOpts.isPrevWeek;
    var body = document.getElementById('runWeeklyTop10Body');
    if (!body) return false;

    var d = dataMod();
    var identity = d && typeof d.getViewerIdentity === 'function' ? d.getViewerIdentity((list || []).map(function (i) { return i.raw; })) : null;
    var viewerFbUid = resolveViewerFirebaseUid();

    function matchesViewer(item) {
      if (!item) return false;
      if (identity && d && typeof d.listItemMatchesViewer === 'function') {
        return d.listItemMatchesViewer(item, identity);
      }
      var fb = String(item.firebaseUid || item.userId || '');
      return !!(viewerFbUid && fb && viewerFbUid === fb);
    }

    if (!list || !list.length) {
      return false;
    }

    var wk = isPrevWeek
      ? (renderOpts.weekStartStr && renderOpts.weekEndStr
        ? { startStr: renderOpts.weekStartStr, endStr: renderOpts.weekEndStr }
        : seoulWeekRangeOffset(-1))
      : seoulWeekRange();
    var captionText = isPrevWeek
      ? '※ 전주 확정 순위 (' + wk.startStr + ' ~ ' + wk.endStr + ')'
      : '※ 이번 주 순위 (' + wk.startStr + ' ~ ' + wk.endStr + ')';
    var html = '<p class="weekly-top10-week-caption" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
      '<span>' + captionText + '</span>' +
      '<span class="weekly-top10-unit-label" style="font-weight:700;color:#7c3aed;flex-shrink:0;">km</span>' +
      '</p>';

    var myItem = null;
    for (var i = 0; i < list.length; i++) {
      if (matchesViewer(list[i])) { myItem = list[i]; break; }
    }

    list.slice(0, 10).forEach(function (item) {
      html += rowHtml(item, { isSelf: myItem && item === myItem });
    });

    if (myItem && myItem.rank > 10) {
      if (myItem.rank >= 12) html += '<div class="weekly-rank-item weekly-rank-ellipsis">....</div>';
      html += rowHtml(myItem, { isSelf: true });
    }

    var showStamp = isPrevWeek || isWeeklyRankingFinalizedSeoul();
    if (showStamp) {
      html = '<div class="weekly-top10-body-inner" style="position:relative;">' + html +
        weeklyTop10StampOverlayHtml() + '</div>';
    }

    body.innerHTML = html;

    refreshRankChangeDom(body, list, myItem);

    if (myItem) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var el = document.getElementById('runWeeklyTop10MyRankRow');
          if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          }
        });
      });
    }
    return true;
  }

  function closeRunWeeklyTop10Modal() {
    var modal = document.getElementById('runWeeklyTop10Modal');
    if (!modal) return;
    var cb = document.getElementById('runWeeklyTop10DontShowToday');
    if (cb && cb.checked) setSuppressedToday();
    modal.classList.add('hidden');
  }

  function fetchAndShowRunWeeklyTop10Modal(force) {
    if (!force && isSuppressedToday()) return;
    var modal = document.getElementById('runWeeklyTop10Modal');
    var body = document.getElementById('runWeeklyTop10Body');
    if (!modal || !body) return;

    var cb = document.getElementById('runWeeklyTop10DontShowToday');
    if (cb) cb.checked = false;
    modal.classList.remove('hidden');
    body.innerHTML = loadingHtml();

    var a = api();
    if (!a || typeof a.fetchLeaderboard !== 'function') {
      body.innerHTML = '<p class="weekly-top10-loading-text" style="padding:24px;text-align:center;">데이터를 불러올 수 없습니다.</p>';
      return;
    }

    a.fetchLeaderboard().then(function (res) {
      if (modal.classList.contains('hidden')) return;
      if (!res || res.success === false) {
        body.innerHTML = '<p class="weekly-top10-loading-text" style="padding:24px;text-align:center;">데이터를 불러올 수 없습니다.</p>';
        return;
      }
      try {
        var list = buildList(res);
        if (list.length > 0 && render(list, { isPrevWeek: false })) {
          return;
        }
        return a.fetchLeaderboard({ week: 'prev', force: true }).then(function (prevRes) {
          if (modal.classList.contains('hidden')) return;
          if (!prevRes || prevRes.success === false) {
            modal.classList.add('hidden');
            return;
          }
          var prevList = buildList(prevRes, {
            isPrevWeek: true,
            /* 전주 응답엔 등락 스냅샷이 없으므로 메인 응답(res)의 주간 스냅샷을 넘겨 등락 적용 */
            rankMovementByKey: (res && res.rankMovementByKey) || {},
            rankMovementSource: (res && res.rankMovementSource) || '',
            rankMovementAsOfSeoul: (res && res.rankMovementAsOfSeoul) || '',
            leaderboardSource: (res && res.leaderboardSource) || '',
            leaderboardAsOfSeoul: (res && res.leaderboardAsOfSeoul) || ''
          });
          if (prevList.length > 0 && render(prevList, {
            isPrevWeek: true,
            weekStartStr: prevRes.weekStartStr,
            weekEndStr: prevRes.weekEndStr
          })) {
            return;
          }
          modal.classList.add('hidden');
        });
      } catch (e) {
        console.warn('[RunWeeklyTop10] render 실패:', e && e.message ? e.message : e);
        body.innerHTML = '<p class="weekly-top10-loading-text" style="padding:24px;text-align:center;">순위를 표시하지 못했습니다.</p>';
      }
    }).catch(function (e) {
      if (modal.classList.contains('hidden')) return;
      console.warn('[RunWeeklyTop10] 조회 실패:', e && e.message ? e.message : e);
      body.innerHTML = '<p class="weekly-top10-loading-text" style="padding:24px;text-align:center;">연결에 실패했습니다. 나중에 다시 시도해 주세요.</p>';
    });
  }

  /** RUN 베이스캠프 진입 시 자동 표시 (세션당 1회, "오늘 그만 보기"·비로그인 시 생략) */
  function maybeAutoShowRunWeeklyTop10() {
    if (isSuppressedToday()) return;
    if (window.__runWeeklyTop10AutoShownSession) return;

    var cur = window.currentUser || (function () {
      try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; }
    })();
    var authUid = (window.auth && window.auth.currentUser && window.auth.currentUser.uid) ||
      (window.authV9 && window.authV9.currentUser && window.authV9.currentUser.uid);
    var isAuth = (cur && (cur.id || cur.uid)) || authUid;
    if (!isAuth) return;

    var run = document.getElementById('runBasecampScreen');
    if (!run || !run.classList.contains('active')) return;

    var settings = document.getElementById('settingsModal');
    if (settings && settings.style.display === 'flex') return;

    window.__runWeeklyTop10AutoShownSession = true;
    fetchAndShowRunWeeklyTop10Modal(false);
  }

  window.closeRunWeeklyTop10Modal = closeRunWeeklyTop10Modal;
  window.fetchAndShowRunWeeklyTop10Modal = fetchAndShowRunWeeklyTop10Modal;
  window.maybeAutoShowRunWeeklyTop10 = maybeAutoShowRunWeeklyTop10;
})();
