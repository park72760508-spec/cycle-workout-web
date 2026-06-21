/**
 * RUN 랭킹보드 크루 탭 — CYCLE 클럽 탭과 동일한 소모임·멤버 순위 로직
 */
(function () {
  'use strict';

  function rgCatApi() {
    return window.ridingGroupCategory || {};
  }

  /** RUN 크루 탭 — category=RUN 소모임만 (레거시는 방장 RUN 프로필 추론) */
  function filterRunCrewGroups(rows) {
    var api = rgCatApi();
    if (typeof api.filterRidingGroupsByBoardCategory === 'function') {
      return api.filterRidingGroupsByBoardCategory(rows, 'RUN');
    }
    return (rows || []).filter(function (gr) {
      var c = gr && gr.category != null ? String(gr.category).trim().toUpperCase() : '';
      return c === 'RUN';
    });
  }

  function metricToTabId(metric) {
    var m = String(metric || 'overall');
    if (m === 'pace' || m === 'tss' || m === 'distance') return m;
    return 'overall';
  }

  function crewMetricLabel(metric) {
    var labels = { overall: '종합', pace: '구간', tss: 'TSS', distance: '거리' };
    return labels[metric] || labels.overall;
  }

  function crewMetricUnit(metric) {
    switch (metric) {
      case 'overall': return 'pt';
      case 'pace': return 'min/km';
      case 'tss': return 'TSS';
      case 'distance': return 'km';
      default: return 'pt';
    }
  }

  /**
   * 확장된 크루 내 멤버 순위 (성별·카테고리·항목 필터 적용)
   * — Firestore members/{firebaseUid} 와 RUN 보드 user_info.user_id 이중 매칭
   * — 집계 점수 없어도 멤버 행 표시 (값 '—')
   * @param {object[]} leaderboardRows
   * @param {object[]} memberRows — subscribeRidingGroupMembers 결과
   * @param {{ metric?: string, gender?: string, category?: string, paceDistance?: string }} opts
   * @returns {object[]}
   */
  function buildCrewMemberRankedList(leaderboardRows, memberRows, opts) {
    opts = opts || {};
    var dataApi = window.runningRankingData;
    if (!dataApi || typeof dataApi.buildRankedList !== 'function') return [];

    var tabId = metricToTabId(opts.metric);
    var gender = opts.gender || 'all';
    var category = opts.category || 'Supremo';
    var paceDistance = opts.paceDistance || '5k';
    var rowUserId = dataApi.rowUserId;
    var rowFirebaseUid = dataApi.rowFirebaseUid;
    var fmtApi = window.runningRankingFormat || {};
    var rows = leaderboardRows || [];

    function rowGender(r) {
      var ui = r && r.user_info;
      return fmtApi.normalizeGender ? fmtApi.normalizeGender(ui && ui.gender) : '';
    }

    function rowAgeCategory(r) {
      var ui = r && r.user_info;
      var cat = ui && (ui.age_category != null ? ui.age_category : ui.ageCategory);
      return cat != null ? String(cat).trim() : '';
    }

    function rowDisplayName(r) {
      var ui = r && r.user_info;
      return (ui && ui.display_name) ? String(ui.display_name) : '';
    }

    function rowProfileUrl(r) {
      var ui = r && r.user_info;
      return (ui && ui.profile_image_url) ? String(ui.profile_image_url) : '';
    }

    function genderOk(r) {
      if (!gender || gender === 'all') return true;
      return rowGender(r) === gender;
    }

    function categoryOk(r) {
      if (!category || category === 'Supremo') return true;
      return rowAgeCategory(r) === category;
    }

    function findRawRow(memUid) {
      var i;
      var r;
      var board;
      var fb;
      for (i = 0; i < rows.length; i++) {
        r = rows[i];
        if (!r) continue;
        board = rowUserId(r);
        fb = rowFirebaseUid(r);
        if (board !== memUid && fb !== memUid) continue;
        if (!genderOk(r)) return null;
        if (!categoryOk(r)) return null;
        return r;
      }
      return null;
    }

    var fullList = dataApi.buildRankedList(rows, tabId, {
      gender: gender,
      category: category,
      paceDistance: paceDistance
    });
    var rankedById = {};
    function indexRanked(item) {
      if (!item) return;
      var board = item.userId != null ? String(item.userId) : '';
      var fb = item.firebaseUid || item.socialUserId || '';
      if (board) rankedById[board] = item;
      if (fb) rankedById[fb] = item;
    }
    fullList.forEach(indexRanked);

    function memName(mem, raw) {
      if (mem && mem.displayName != null && String(mem.displayName).trim()) {
        return String(mem.displayName).trim();
      }
      if (mem && mem.name != null && String(mem.name).trim()) {
        return String(mem.name).trim();
      }
      var dn = raw ? rowDisplayName(raw) : '';
      return dn || '(이름 없음)';
    }

    function memProfile(mem, raw) {
      if (mem && mem.profileImageUrl) return String(mem.profileImageUrl);
      if (mem && mem.photoUrl) return String(mem.photoUrl);
      return raw ? rowProfileUrl(raw) : '';
    }

    function placeholderItem(mem, raw, memUid) {
      var board = raw ? rowUserId(raw) : '';
      var fb = raw ? rowFirebaseUid(raw) : '';
      var base = {
        userId: board || memUid,
        firebaseUid: fb || memUid,
        socialUserId: fb || board || memUid,
        name: memName(mem, raw),
        profileUrl: memProfile(mem, raw),
        value: -1,
        valueLabel: '—',
        _groupRole: mem.role || 'member'
      };
      if (raw && dataApi.buildListItemFromRawRow) {
        var fromRaw = dataApi.buildListItemFromRawRow(raw, tabId, {
          gender: gender,
          category: category,
          paceDistance: paceDistance
        });
        if (fromRaw) {
          return Object.assign({}, fromRaw, {
            name: memName(mem, raw) || fromRaw.name,
            profileUrl: memProfile(mem, raw) || fromRaw.profileUrl,
            _groupRole: mem.role || 'member'
          });
        }
      }
      return base;
    }

    var merged = [];
    (memberRows || []).forEach(function (mem) {
      var memUid = mem && (mem.userId || mem.uid || mem.id)
        ? String(mem.userId || mem.uid || mem.id)
        : '';
      if (!memUid) return;

      var raw = findRawRow(memUid);
      var ranked =
        rankedById[memUid] ||
        (raw ? rankedById[rowUserId(raw)] || rankedById[rowFirebaseUid(raw)] : null);

      if (ranked) {
        merged.push(Object.assign({}, ranked, { _groupRole: mem.role || 'member' }));
        return;
      }

      if (raw) {
        merged.push(placeholderItem(mem, raw, memUid));
        return;
      }

      /* 랭킹 API에 없어도 승인 멤버는 표시 (방장 단독 크루 등) */
      merged.push(placeholderItem(mem, null, memUid));
    });

    merged.sort(function (a, b) {
      var av = Number(a.value);
      var bv = Number(b.value);
      if (!isFinite(av)) av = -1;
      if (!isFinite(bv)) bv = -1;
      var diff = tabId === 'pace' ? av - bv : bv - av;
      if (diff !== 0) return diff;
      var au = a.userId != null ? String(a.userId) : '';
      var bu = b.userId != null ? String(b.userId) : '';
      return au < bu ? -1 : au > bu ? 1 : 0;
    });
    merged.forEach(function (item, idx) {
      item.rank = idx + 1;
      item.boardRank = idx + 1;
    });
    return merged;
  }

  function rankingNoticeMaxLen() {
    var svc = window.openRidingGroupService;
    if (svc && svc.RIDING_GROUP_RANKING_NOTICE_MAX_LEN) {
      return Number(svc.RIDING_GROUP_RANKING_NOTICE_MAX_LEN);
    }
    return 500;
  }

  /** CYCLE stelvioGroupTabMemberNameRankMetaHtml — (전체순위/등락) */
  function buildGroupMemberRankMetaHtml(item, leaderboardRows, listCategory) {
    if (!item || item.userId == null) return '';
    var dataApi = window.runningRankingData;
    var overallRank = null;
    if (dataApi && typeof dataApi.buildRankedList === 'function') {
      var supList = dataApi.buildRankedList(leaderboardRows || [], 'overall', {
        gender: 'all',
        category: 'Supremo'
      });
      var uid = String(item.userId);
      var itemFb = item.firebaseUid || item.socialUserId || '';
      for (var i = 0; i < supList.length; i++) {
        if (!supList[i]) continue;
        var su = supList[i].userId != null ? String(supList[i].userId) : '';
        var sf = supList[i].firebaseUid || supList[i].socialUserId || '';
        if (su === uid || (itemFb && sf === String(itemFb)) || (sf && sf === uid)) {
          overallRank = i + 1;
          break;
        }
      }
    }
    var rc = item.rankChange;
    var prevR = item.previousBoardRank;
    var inlineFn = typeof window.stelvioRankChangeInlineSpanHtml === 'function'
      ? window.stelvioRankChangeInlineSpanHtml
      : null;
    var badgeFn = typeof window.stelvioServerRankChangeBadgeHtml === 'function'
      ? window.stelvioServerRankChangeBadgeHtml
      : null;
    var changeInline = inlineFn ? inlineFn(rc, prevR) : '';
    var changeOnly = badgeFn ? badgeFn(rc, prevR) : '';
    var overallPart =
      overallRank != null && isFinite(overallRank) && overallRank >= 1
        ? '<span class="stelvio-rank-overall" title="전체 순위(Supremo)">' + overallRank + '위</span>'
        : '';
    if (!overallPart && !changeOnly) return '';
    if (overallPart && changeInline) {
      var prevNT =
        prevR != null && isFinite(Number(prevR)) ? Math.floor(Number(prevR)) : '';
      return (
        '<span class="stelvio-rank-name-meta" title="전체 순위' +
        (prevNT ? ', 전일 ' + prevNT + '위 대비' : '') +
        '">(' +
        overallPart +
        '<span class="stelvio-rank-meta-sep" aria-hidden="true">/</span>' +
        changeInline +
        ')</span>'
      );
    }
    if (overallPart) {
      return (
        '<span class="stelvio-rank-name-meta" title="전체 순위(Supremo)">(' +
        overallPart +
        ')</span>'
      );
    }
    return changeOnly;
  }

  function formatNoticeDate(ts) {
    if (!ts) return '';
    var d = null;
    if (ts.toDate && typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else if (typeof ts.seconds === 'number') d = new Date(ts.seconds * 1000);
    else if (typeof ts === 'number' && isFinite(ts)) d = new Date(ts);
    if (!d || isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1);
    if (m.length < 2) m = '0' + m;
    var day = String(d.getDate());
    if (day.length < 2) day = '0' + day;
    return y + '.' + m + '.' + day;
  }

  window.runningRankingCrewTab = {
    filterRunCrewGroups: filterRunCrewGroups,
    metricToTabId: metricToTabId,
    crewMetricLabel: crewMetricLabel,
    crewMetricUnit: crewMetricUnit,
    buildCrewMemberRankedList: buildCrewMemberRankedList,
    buildGroupMemberRankMetaHtml: buildGroupMemberRankMetaHtml,
    rankingNoticeMaxLen: rankingNoticeMaxLen,
    formatNoticeDate: formatNoticeDate
  };
})();
