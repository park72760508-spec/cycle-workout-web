/**
 * RUN 랭킹보드 크루 탭 — CYCLE 클럽 탭과 동일한 소모임·멤버 순위 로직
 */
(function () {
  'use strict';

  var RUN = 'RUN';

  function normalizeGroupCategory(raw) {
    var svc = window.openRidingGroupService;
    if (svc && typeof svc.normalizeRidingGroupCategory === 'function') {
      return svc.normalizeRidingGroupCategory(raw);
    }
    var c = raw != null ? String(raw).trim().toUpperCase() : '';
    return c === RUN ? RUN : 'CYCLE';
  }

  /** RUN 크루 탭 — category=RUN 소모임만 */
  function filterRunCrewGroups(rows) {
    if (!rows || !rows.length) return [];
    return rows.filter(function (gr) {
      return normalizeGroupCategory(gr && gr.category) === RUN;
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
    var listOpts = {
      gender: opts.gender || 'all',
      category: opts.category || 'Supremo',
      paceDistance: opts.paceDistance || '5k'
    };
    var fullList = dataApi.buildRankedList(leaderboardRows || [], tabId, listOpts);
    var byUid = {};
    fullList.forEach(function (item) {
      if (item && item.userId != null) byUid[String(item.userId)] = item;
    });

    var merged = [];
    (memberRows || []).forEach(function (mem) {
      var uid = mem && (mem.userId || mem.uid || mem.id) ? String(mem.userId || mem.uid || mem.id) : '';
      if (!uid) return;
      var row = byUid[uid];
      if (!row) return;
      merged.push(Object.assign({}, row, { _groupRole: mem.role || 'member' }));
    });

    merged.sort(function (a, b) {
      var diff = tabId === 'pace' ? a.value - b.value : b.value - a.value;
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
    rankingNoticeMaxLen: rankingNoticeMaxLen,
    formatNoticeDate: formatNoticeDate
  };
})();
