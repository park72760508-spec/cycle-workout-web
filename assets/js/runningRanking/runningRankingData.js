/**
 * 러닝 랭킹 — 정렬·필터·크루 집계
 */
(function () {
  'use strict';

  function cfg() { return window.runningRankingConfig || {}; }
  function fmt() { return window.runningRankingFormat || {}; }

  function getCurrentUserId() {
    var u = window.currentUser;
    if (u && (u.id || u.uid)) return String(u.id || u.uid);
    try {
      var ls = JSON.parse(localStorage.getItem('currentUser') || 'null');
      return ls && (ls.id || ls.uid) ? String(ls.id || ls.uid) : null;
    } catch (e) { return null; }
  }

  function rowUserId(row) {
    var ui = row && row.user_info;
    return ui && ui.user_id ? String(ui.user_id) : '';
  }

  function rowDisplayName(row) {
    var ui = row && row.user_info;
    return (ui && ui.display_name) ? String(ui.display_name) : '러너';
  }

  function rowProfileUrl(row) {
    var ui = row && row.user_info;
    return (ui && ui.profile_image_url) ? String(ui.profile_image_url) : '';
  }

  function rowGender(row) {
    var ui = row && row.user_info;
    return fmt().normalizeGender ? fmt().normalizeGender(ui && ui.gender) : '';
  }

  function rowAgeCategory(row) {
    var ui = row && row.user_info;
    var cat = ui && (ui.age_category != null ? ui.age_category : ui.ageCategory);
    return cat != null ? String(cat).trim() : '';
  }

  function isPrivateRow(row) {
    var ui = row && row.user_info;
    return !!(ui && (ui.is_private === true || ui.is_private === 'true' || ui.is_private === 1));
  }

  function getPaceForDistance(row, distKey) {
    var pp = row && row.peak_performances;
    var seg = pp && pp[distKey];
    var paceStr = seg && seg.pace ? String(seg.pace) : '';
    var sec = fmt().parsePaceToSecPerKm ? fmt().parsePaceToSecPerKm(paceStr) : null;
    return { paceStr: paceStr || '—', paceSec: sec };
  }

  function getSegmentScore(row, distKey) {
    var ss = row && row.segment_scores;
    if (!ss || ss[distKey] == null) return null;
    var n = Number(ss[distKey]);
    return isFinite(n) ? n : null;
  }

  function filterByGender(rows, gender) {
    if (!gender || gender === 'all') return rows.slice();
    return rows.filter(function (r) { return rowGender(r) === gender; });
  }

  function filterByCategory(rows, category) {
    var cat = category || 'Supremo';
    if (!cat || cat === 'Supremo') return rows.slice();
    return rows.filter(function (r) { return rowAgeCategory(r) === cat; });
  }

  /**
   * @param {object[]} rows
   * @param {string} tabId
   * @param {{ paceDistance?: string, gender?: string, category?: string }} opts
   */
  function buildRankedList(rows, tabId, opts) {
    opts = opts || {};
    var filtered = filterByGender(rows || [], opts.gender || 'all');
    filtered = filterByCategory(filtered, opts.category || 'Supremo');
    var list = [];

    if (tabId === 'overall') {
      filtered.forEach(function (r) {
        var score = Number(r.total_score);
        if (!isFinite(score)) return;
        list.push({
          userId: rowUserId(r),
          name: rowDisplayName(r),
          profileUrl: rowProfileUrl(r),
          isPrivate: isPrivateRow(r),
          raw: r,
          value: score,
          valueLabel: fmt().formatScore(score),
          segments: (cfg().OVERALL_SEGMENTS || []).map(function (seg) {
            var sc = getSegmentScore(r, seg.key);
            var pace = getPaceForDistance(r, seg.key);
            return {
              key: seg.key,
              label: seg.label,
              score: sc,
              pace: pace.paceStr
            };
          })
        });
      });
      list.sort(function (a, b) { return b.value - a.value; });
    } else if (tabId === 'pace') {
      var dk = opts.paceDistance || '5k';
      filtered.forEach(function (r) {
        var pace = getPaceForDistance(r, dk);
        if (pace.paceSec == null) return;
        list.push({
          userId: rowUserId(r),
          name: rowDisplayName(r),
          profileUrl: rowProfileUrl(r),
          isPrivate: isPrivateRow(r),
          raw: r,
          value: pace.paceSec,
          valueLabel: pace.paceStr
        });
      });
      list.sort(function (a, b) { return a.value - b.value; });
    } else if (tabId === 'tss') {
      filtered.forEach(function (r) {
        var tss = Number(r.weekly_tss);
        if (!isFinite(tss) || tss <= 0) return;
        list.push({
          userId: rowUserId(r),
          name: rowDisplayName(r),
          profileUrl: rowProfileUrl(r),
          isPrivate: isPrivateRow(r),
          raw: r,
          value: tss,
          valueLabel: fmt().formatTss(tss)
        });
      });
      list.sort(function (a, b) { return b.value - a.value; });
    } else if (tabId === 'distance') {
      filtered.forEach(function (r) {
        var km = Number(r.distance_30d_km);
        if (!isFinite(km) || km <= 0) return;
        list.push({
          userId: rowUserId(r),
          name: rowDisplayName(r),
          profileUrl: rowProfileUrl(r),
          isPrivate: isPrivateRow(r),
          raw: r,
          value: km,
          valueLabel: fmt().formatDistanceKm(km) + 'km'
        });
      });
      list.sort(function (a, b) { return b.value - a.value; });
    }

    list.forEach(function (item, idx) { item.rank = idx + 1; });
    return list;
  }

  /**
   * 크루 탭 — 소모임별 멤버 total_score 평균(기록 있는 멤버만)
   * @param {object[]} leaderboardRows
   * @param {object[]} groupRows — openRidingGroupService subscribe 결과
   */
  function buildCrewRankedList(leaderboardRows, groupRows) {
    var byUid = {};
    (leaderboardRows || []).forEach(function (r) {
      var uid = rowUserId(r);
      if (uid) byUid[uid] = r;
    });

    var crews = [];
    (groupRows || []).forEach(function (gr) {
      var gid = gr && (gr.groupId || gr.id) ? String(gr.groupId || gr.id) : '';
      if (!gid) return;
      var memberIds = [];
      if (Array.isArray(gr.memberUserIds)) memberIds = gr.memberUserIds.map(String);
      else if (Array.isArray(gr.members)) {
        memberIds = gr.members.map(function (m) {
          return m && (m.userId || m.uid || m.id) ? String(m.userId || m.uid || m.id) : '';
        }).filter(Boolean);
      }
      if (!memberIds.length && gr.contactUserIds) {
        memberIds = String(gr.contactUserIds).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      }

      var scores = [];
      memberIds.forEach(function (uid) {
        var row = byUid[uid];
        if (!row) return;
        var sc = Number(row.total_score);
        if (isFinite(sc) && sc > 0) scores.push(sc);
      });
      if (!scores.length) return;

      var avg = scores.reduce(function (a, b) { return a + b; }, 0) / scores.length;
      crews.push({
        crewId: gid,
        name: (gr.name || gr.groupName || gr.title || '크루').toString(),
        profileUrl: gr.photoUrl || gr.coverImageUrl || gr.imageUrl || gr.profileImageUrl || '',
        memberCount: memberIds.length,
        scoredCount: scores.length,
        value: avg,
        valueLabel: fmt().formatScore(avg) + 'pt',
        isCrew: true
      });
    });

    crews.sort(function (a, b) { return b.value - a.value; });
    crews.forEach(function (c, i) { c.rank = i + 1; });
    return crews;
  }

  function getVolumeWindowLabel(rows) {
    if (!rows || !rows.length) return '';
    var vw = rows[0] && rows[0].volume_window;
    if (!vw) return '';
    if (vw.week_start && vw.week_end) {
      return '주간 TSS: ' + vw.week_start + ' ~ ' + vw.week_end;
    }
    return '';
  }

  function getDistanceWindowLabel(rows) {
    if (!rows || !rows.length) return '';
    var vw = rows[0] && rows[0].volume_window;
    if (!vw) return '최근 30일 누적';
    if (vw.distance_from && vw.distance_to) {
      return '최근 30일 (' + vw.distance_from + ' ~ ' + vw.distance_to + ')';
    }
    return '최근 30일 누적';
  }

  window.runningRankingData = {
    getCurrentUserId: getCurrentUserId,
    buildRankedList: buildRankedList,
    buildCrewRankedList: buildCrewRankedList,
    getVolumeWindowLabel: getVolumeWindowLabel,
    getDistanceWindowLabel: getDistanceWindowLabel,
    rowUserId: rowUserId,
    isPrivateRow: isPrivateRow
  };
})();
