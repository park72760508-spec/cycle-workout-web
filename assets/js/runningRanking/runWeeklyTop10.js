/**
 * RUN 주간 마일리지 TOP10 모달
 * ─ CYCLE STELVIO 주간 TOP10과 동일 디자인/로직. 지표만 "주간(월~일) 누적 거리(km)".
 *
 * 데이터: runningRankingApi.fetchLeaderboard() (get_running_leaderboard → weekly_distance_km)
 * 등락  : runningRankingMovement.applyRankMovement(list, 'weekly_distance', ...) — run_weekly_distance_* 스냅샷(전일 대비)
 * 표시  : 1~10위 + 하단 나의 순위/거리 + 순위 등락(↑↓)
 */
(function () {
  'use strict';

  var LS_DONT_SHOW = 'runWeeklyTop10DontShowDate';

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

  /** 서울 기준 이번 주 월요일~일요일 (표시용) */
  function seoulWeekRange() {
    var ymd = seoulToday();
    var parts = ymd.split('-');
    var base = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    var dow = base.getUTCDay(); // 0=일
    var isoDow = dow === 0 ? 7 : dow;
    var mon = new Date(base);
    mon.setUTCDate(base.getUTCDate() - (isoDow - 1));
    var sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    var f = function (d) { return d.toISOString().slice(0, 10); };
    return { startStr: f(mon), endStr: f(sun) };
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

  function maskedName(name) {
    var n = name || '러너';
    return n.length >= 1 ? n.charAt(0) + '**' : '**';
  }

  /** 리더보드 rows → 주간 거리 랭킹 목록 (등락 적용 완료) */
  function buildList(res) {
    var d = dataMod();
    var rows = (res && res.rows) || [];
    var list = [];
    rows.forEach(function (r) {
      if (!r) return;
      var km = Number(r.weekly_distance_km);
      if (!isFinite(km) || km <= 0) return;
      var userId = d ? d.rowUserId(r) : (r.user_info && r.user_info.user_id) || '';
      var fbUid = d ? d.rowFirebaseUid(r) : (r.user_info && r.user_info.firebase_uid) || '';
      list.push({
        userId: userId,
        firebaseUid: fbUid,
        socialUserId: fbUid || userId,
        name: (r.user_info && r.user_info.display_name) ? String(r.user_info.display_name) : '러너',
        profileUrl: (r.user_info && r.user_info.profile_image_url) ? String(r.user_info.profile_image_url) : '',
        isPrivate: d ? d.isPrivateRow(r) : !!(r.user_info && r.user_info.is_private),
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
    if (mv && typeof mv.applyRankMovement === 'function') {
      mv.applyRankMovement(list, 'weekly_distance', {
        gender: 'all',
        category: 'Supremo',
        rankMovementSource: (res && res.rankMovementSource) || '',
        leaderboardSource: (res && res.leaderboardSource) || '',
        leaderboardAsOfSeoul: (res && res.leaderboardAsOfSeoul) || '',
        rankMovementAsOfSeoul: (res && res.rankMovementAsOfSeoul) || ''
      }, (res && res.rankMovementByKey) || {});
    }
    return list;
  }

  /** CYCLE 주간 TOP10과 동일: 본인·관리자·친구·같은 모임 멤버는 실명 확인 가능 */
  function viewerCanSeeFull(item, isSelf, isAdmin) {
    if (isSelf || isAdmin) return true;
    var friendSet = window.stelvioRankingFriendUserSet;
    var groupSet = window.stelvioRankingGroupContactSet;
    var ids = [];
    if (item.socialUserId) ids.push(String(item.socialUserId));
    if (item.userId != null) ids.push(String(item.userId));
    if (item.firebaseUid) ids.push(String(item.firebaseUid));
    for (var i = 0; i < ids.length; i++) {
      if (friendSet && typeof friendSet.has === 'function' && friendSet.has(ids[i])) return true;
      if (groupSet && typeof groupSet.has === 'function' && groupSet.has(ids[i])) return true;
    }
    return false;
  }

  function rowHtml(item, opts) {
    opts = opts || {};
    var rank = item.rank;
    var medalSrc = (cfg().MEDAL_SRC) || ['assets/img/1st.svg', 'assets/img/2nd.svg', 'assets/img/3rd.svg'];
    var canSee = viewerCanSeeFull(item, opts.isSelf, opts.isAdmin);
    var rawName = escapeHtml(item.name || '러너');
    var displayText = item.isPrivate && !canSee ? escapeHtml(maskedName(item.name)) : rawName;
    /* CYCLE 동일: 비공개 사용자를 실명으로 볼 수 있는 뷰어(본인·관리자·친구·모임)에게 '비' 배지 표시 */
    var privateBadge = (item.isPrivate && canSee)
      ? '<span class="ranking-private-badge ranking-private-badge-admin weekly-rank-private-badge-tight" style="margin-left:0;margin-right:0;" title="비공개">비</span>'
      : '';
    var badge = rankChangeBadgeHtml(item);
    var html = '<div class="weekly-rank-item' + (opts.isSelf ? ' weekly-rank-item-self' : '') + '"' + (opts.isSelf ? ' id="runWeeklyTop10MyRankRow"' : '') + '>';
    if (rank <= 3) {
      html += '<span class="weekly-rank-medal"><img src="' + medalSrc[rank - 1] + '" alt="" width="20" height="20" decoding="async" /></span>';
    }
    html += '<span class="weekly-rank-position">' + rank + '위</span>';
    html += '<span class="weekly-rank-name">' + avatarHtml(item.profileUrl, item.userId, displayText) +
      '<span class="weekly-rank-name-text" title="' + rawName + '">' +
      '<span class="weekly-rank-name-label">' + displayText + '</span>' +
      '<span class="weekly-rank-change-slot">' + badge + privateBadge + '</span></span></span>';
    html += '<span class="weekly-rank-tss">' + kmLabel(item.value) + '</span>';
    html += '</div>';
    return html;
  }

  function render(list) {
    var body = document.getElementById('runWeeklyTop10Body');
    if (!body) return;
    var d = dataMod();
    var identity = d && typeof d.getViewerIdentity === 'function' ? d.getViewerIdentity((list || []).map(function (i) { return i.raw; })) : null;
    var isAdmin = typeof window.stelvioRankingLoginIsAdmin === 'function' && window.stelvioRankingLoginIsAdmin();

    function matchesViewer(item) {
      if (!identity) return false;
      if (d && typeof d.listItemMatchesViewer === 'function') return d.listItemMatchesViewer(item, identity);
      return false;
    }

    if (!list || !list.length) {
      body.innerHTML = '<p class="weekly-top10-loading-text" style="padding:24px;text-align:center;color:#666;">이번 주 러닝 기록이 아직 없습니다.</p>';
      return;
    }

    var wk = seoulWeekRange();
    var html = '<p class="weekly-top10-week-caption" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
      '<span>※ 이번 주 순위 (' + wk.startStr + ' ~ ' + wk.endStr + ')</span>' +
      '<span class="weekly-top10-unit-label" style="font-weight:700;color:#7c3aed;flex-shrink:0;">km</span>' +
      '</p>';

    var myItem = null;
    for (var i = 0; i < list.length; i++) {
      if (matchesViewer(list[i])) { myItem = list[i]; break; }
    }

    list.slice(0, 10).forEach(function (item) {
      html += rowHtml(item, { isSelf: myItem && item === myItem, isAdmin: isAdmin });
    });

    // 나의 순위가 TOP10 밖이면 하단에 별도 표시
    if (myItem && myItem.rank > 10) {
      if (myItem.rank >= 12) html += '<div class="weekly-rank-item weekly-rank-ellipsis">....</div>';
      html += rowHtml(myItem, { isSelf: true, isAdmin: isAdmin });
    }

    body.innerHTML = html;

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
        render(buildList(res));
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
