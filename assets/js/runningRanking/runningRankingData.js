/**
 * 러닝 랭킹 — 정렬·필터·크루 집계
 */
(function () {
  'use strict';

  function cfg() { return window.runningRankingConfig || {}; }
  function fmt() { return window.runningRankingFormat || {}; }

  function getCurrentUserId() {
    if (typeof window.stelvioResolveRankingViewerUserId === 'function') {
      var resolved = window.stelvioResolveRankingViewerUserId();
      if (resolved) return String(resolved);
    }
    var u = window.currentUser;
    if (u && (u.id || u.uid)) return String(u.id || u.uid);
    try {
      var ls = JSON.parse(localStorage.getItem('currentUser') || 'null');
      return ls && (ls.id || ls.uid) ? String(ls.id || ls.uid) : null;
    } catch (e) { return null; }
  }

  /** 로그인 사용자 — Firebase UID + RUN 랭킹 보드 user_info.user_id(Supabase UUID) */
  function getViewerIdentity(rows) {
    var firebaseId = getCurrentUserId();
    var boardUserId = null;
    var i;
    if (firebaseId && rows && rows.length) {
      for (i = 0; i < rows.length; i++) {
        var fb = rowFirebaseUid(rows[i]);
        if (fb && String(fb) === String(firebaseId)) {
          var bid = rowUserId(rows[i]);
          if (bid) boardUserId = String(bid);
          break;
        }
      }
    }
    return {
      firebaseId: firebaseId || null,
      boardUserId: boardUserId
    };
  }

  /** 목록 행이 접속 사용자 본인인지 — CYCLE 소셜 행 매칭과 동일( Firebase·보드 UUID 모두 ) */
  function listItemMatchesViewer(item, identity) {
    if (!item || !identity) return false;
    if (item.isCrew) return false;
    var fid = identity.firebaseId ? String(identity.firebaseId) : '';
    var bid = identity.boardUserId ? String(identity.boardUserId) : '';
    var boardUid = item.userId != null ? String(item.userId) : '';
    var sid = item.socialUserId || item.firebaseUid || '';
    if (sid) sid = String(sid);
    if (bid && boardUid && boardUid === bid) return true;
    if (fid && sid && sid === fid) return true;
    if (fid && boardUid && boardUid === fid) return true;
    return false;
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

  function rowFirebaseUid(row) {
    var ui = row && row.user_info;
    var fb = ui && (ui.firebase_uid != null ? ui.firebase_uid : ui.firebaseUid);
    return fb != null && String(fb).trim() ? String(fb).trim() : '';
  }

  function rowSocialUserId(row) {
    var fb = rowFirebaseUid(row);
    var uid = rowUserId(row);
    return fb || uid;
  }

  function isPrivateRow(row) {
    var ui = row && row.user_info;
    if (typeof window.stelvioRankingIsPrivateRow === 'function') {
      return window.stelvioRankingIsPrivateRow({
        is_private: ui && ui.is_private,
        userId: rowUserId(row),
        name: rowDisplayName(row)
      });
    }
    return !!(ui && (ui.is_private === true || ui.is_private === 'true' || ui.is_private === 1));
  }

  function pushListItem(list, r, fields) {
    list.push(Object.assign({
      userId: rowUserId(r),
      firebaseUid: rowFirebaseUid(r),
      socialUserId: rowSocialUserId(r),
      name: rowDisplayName(r),
      profileUrl: rowProfileUrl(r),
      isPrivate: isPrivateRow(r),
      ageCategory: rowAgeCategory(r),
      raw: r
    }, fields || {}));
  }

  var GC_SCORING_VERSION = 2;
  var GC_AXES = ['1k', '3k', '5k', '7k', '10k', '20k'];
  var GC_GENDERS = ['all', 'M', 'F'];
  var GC_CATEGORIES = ['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];

  function positionScore100(rank, n) {
    var ni = Number(n);
    var r = Math.floor(Number(rank));
    if (!isFinite(ni) || ni < 1) return 0;
    if (!isFinite(r) || r < 1) return 0;
    if (r > ni) r = ni;
    if (ni === 1) return 100;
    return Math.round((100 * (ni - r) / (ni - 1)) * 10) / 10;
  }

  function paceSecToSpeed(paceSec) {
    var p = Number(paceSec);
    if (!isFinite(p) || p <= 0) return null;
    return 1000 / p;
  }

  function getPeakPerformancesSource(row, forOverall) {
    if (forOverall && row && row.profile_peak_performances) {
      return row.profile_peak_performances;
    }
    return row && row.peak_performances;
  }

  function getSpeedForDistance(row, distKey, forOverall) {
    var pp = getPeakPerformancesSource(row, forOverall);
    var seg = pp && pp[distKey];
    var paceStr = seg && seg.pace ? String(seg.pace) : '';
    var sec = fmt().parsePaceToSecPerKm ? fmt().parsePaceToSecPerKm(paceStr) : null;
    return paceSecToSpeed(sec);
  }

  function enforceMonotonicSpeeds(speeds) {
    var cap = null;
    var i;
    for (i = 0; i < GC_AXES.length; i++) {
      var key = GC_AXES[i];
      var s = speeds[key];
      if (s == null || s <= 0) continue;
      if (cap != null && s > cap) speeds[key] = cap;
      else cap = s;
    }
    return speeds;
  }

  function fillShorterSpeedsFromLonger(speeds) {
    var i;
    var j;
    for (i = 0; i < GC_AXES.length; i++) {
      var key = GC_AXES[i];
      if (speeds[key] > 0) continue;
      for (j = i + 1; j < GC_AXES.length; j++) {
        var longerKey = GC_AXES[j];
        if (speeds[longerKey] > 0) {
          speeds[key] = speeds[longerKey];
          break;
        }
      }
    }
    return speeds;
  }

  function getOverallPaceForDistance(row, distKey) {
    var speeds = buildProfileSpeeds(row);
    var sp = speeds[distKey];
    if (sp == null || sp <= 0) {
      return getPaceForDistance(row, distKey, { forOverall: true });
    }
    var sec = 1000 / sp;
    var paceStr = fmt().formatPaceMmSs
      ? fmt().formatPaceMmSs(sec)
      : (fmt().formatPaceSecPerKm ? fmt().formatPaceSecPerKm(sec) : '—');
    return { paceStr: paceStr, paceSec: sec };
  }

  function buildProfileSpeeds(row) {
    var speeds = {};
    var i;
    for (i = 0; i < GC_AXES.length; i++) {
      var key = GC_AXES[i];
      var sp = getSpeedForDistance(row, key, true);
      if (sp != null && sp > 0) speeds[key] = sp;
    }
    fillShorterSpeedsFromLonger(speeds);
    return enforceMonotonicSpeeds(speeds);
  }

  function isLegacyScoringRow(row) {
    if (!row) return true;
    if (Number(row.scoring_version) >= GC_SCORING_VERSION) return false;
    if (row.gc_scores && typeof row.gc_scores === 'object' && Object.keys(row.gc_scores).length) {
      return false;
    }
    var total = Number(row.total_score);
    if (isFinite(total) && total > 150) return false;
    return true;
  }

  function needsClientGcScoring(rows) {
    if (!rows || !rows.length) return false;
    if (Number(rows[0].scoring_version) >= GC_SCORING_VERSION) return false;
    return rows.some(isLegacyScoringRow);
  }

  function buildClientGcScores(rows) {
    var entries = (rows || []).filter(function (r) {
      return !isPrivateRow(r) && rowUserId(r);
    }).map(function (r) {
      return {
        row: r,
        userId: rowUserId(r),
        gender: rowGender(r),
        ageCategory: rowAgeCategory(r) || 'Supremo',
        speeds: buildProfileSpeeds(r)
      };
    });

    var gcByUser = {};
    var gi;
    var ci;
    var ai;

    for (gi = 0; gi < GC_GENDERS.length; gi++) {
      var gKey = GC_GENDERS[gi];
      for (ci = 0; ci < GC_CATEGORIES.length; ci++) {
        var cKey = GC_CATEGORIES[ci];
        var cohort = entries.filter(function (e) {
          if (gKey === 'M' && e.gender !== 'M') return false;
          if (gKey === 'F' && e.gender !== 'F') return false;
          if (cKey !== 'Supremo' && e.ageCategory !== cKey) return false;
          return true;
        });
        if (!cohort.length) continue;

        for (ai = 0; ai < GC_AXES.length; ai++) {
          var axis = GC_AXES[ai];
          var ranked = cohort
            .filter(function (e) { return e.speeds[axis] > 0; })
            .sort(function (a, b) {
              if (b.speeds[axis] !== a.speeds[axis]) return b.speeds[axis] - a.speeds[axis];
              return String(a.userId).localeCompare(String(b.userId));
            });
          var n = ranked.length;
          var ri;
          for (ri = 0; ri < n; ri++) {
            var uid = ranked[ri].userId;
            if (!gcByUser[uid]) gcByUser[uid] = {};
            if (!gcByUser[uid][gKey]) gcByUser[uid][gKey] = {};
            if (!gcByUser[uid][gKey][cKey]) {
              gcByUser[uid][gKey][cKey] = { total_score: 0, segment_scores: {} };
            }
            var sc = positionScore100(ri + 1, n);
            gcByUser[uid][gKey][cKey].segment_scores[axis] = sc;
            gcByUser[uid][gKey][cKey].total_score += sc;
          }
        }

        Object.keys(gcByUser).forEach(function (uid) {
          var board = gcByUser[uid][gKey] && gcByUser[uid][gKey][cKey];
          if (board) board.total_score = Math.round(board.total_score * 10) / 10;
        });
      }
    }

    return gcByUser;
  }

  /**
   * 구 스냅샷·평균 점수 응답을 GC v2 형식으로 보정
   * @param {object[]} rows
   * @returns {object[]}
   */
  function parseWeeklyTss(row) {
    if (!row) return 0;
    var v = row.weekly_tss;
    if (v == null || v === '') return 0;
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function normalizeLeaderboardRows(rows) {
    if (!rows || !rows.length) return rows || [];
    var normalized = rows.map(function (r) {
      if (!r || typeof r !== 'object') return r;
      var tss = parseWeeklyTss(r);
      return Object.assign({}, r, { weekly_tss: tss });
    });
    if (!needsClientGcScoring(normalized)) return normalized;

    var gcByUser = buildClientGcScores(normalized);
    return normalized.map(function (r) {
      var uid = rowUserId(r);
      var gc = gcByUser[uid];
      if (!gc) return r;
      var merged = Object.assign({}, r, {
        scoring_version: GC_SCORING_VERSION,
        gc_scores: gc
      });
      var supremo = gc.all && gc.all.Supremo;
      if (supremo) {
        merged.total_score = supremo.total_score;
        merged.segment_scores = supremo.segment_scores;
      }
      return merged;
    });
  }

  function getPaceForDistance(row, distKey, opts) {
    opts = opts || {};
    var pp = getPeakPerformancesSource(row, !!opts.forOverall);
    var seg = pp && pp[distKey];
    var paceStr = seg && seg.pace ? String(seg.pace) : '';
    var sec = fmt().parsePaceToSecPerKm ? fmt().parsePaceToSecPerKm(paceStr) : null;
    return { paceStr: paceStr || '—', paceSec: sec };
  }

  function getGcBoard(row, gender, category) {
    var gc = row && row.gc_scores;
    if (!gc || typeof gc !== 'object') return null;
    var g = gender || 'all';
    var c = category || 'Supremo';
    var board = gc[g] && gc[g][c];
    if (!board) return null;
    return board;
  }

  function getOverallTotalScore(row, gender, category) {
    var board = getGcBoard(row, gender, category);
    if (board && board.total_score != null) {
      var fromBoard = Number(board.total_score);
      if (isFinite(fromBoard)) return fromBoard;
    }
    var fallback = Number(row && row.total_score);
    return isFinite(fallback) ? fallback : null;
  }

  function getSegmentScore(row, distKey, gender, category) {
    var board = getGcBoard(row, gender, category);
    var ss = (board && board.segment_scores) || (row && row.segment_scores);
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

  function buildListItemFromRawRow(raw, tabId, opts) {
    if (!raw) return null;
    opts = opts || {};
    var list = [];
    if (tabId === 'overall') {
      var genderKey = opts.gender || 'all';
      var categoryKey = opts.category || 'Supremo';
      var score = getOverallTotalScore(raw, genderKey, categoryKey);
      pushListItem(list, raw, {
        value: score != null && isFinite(score) && score > 0 ? score : -1,
        valueLabel: score != null && isFinite(score) && score > 0 ? fmt().formatScore(score) : '—'
      });
    } else if (tabId === 'pace') {
      var pace = getPaceForDistance(raw, opts.paceDistance || '5k');
      pushListItem(list, raw, {
        value: pace.paceSec != null ? pace.paceSec : -1,
        valueLabel: pace.paceStr || '—'
      });
    } else if (tabId === 'tss') {
      var tss = parseWeeklyTss(raw);
      pushListItem(list, raw, {
        value: tss > 0 ? tss : -1,
        valueLabel: tss > 0 ? fmt().formatTss(tss) : '—'
      });
    } else if (tabId === 'distance') {
      var km = Number(raw.distance_30d_km);
      pushListItem(list, raw, {
        value: isFinite(km) && km > 0 ? km : -1,
        valueLabel: isFinite(km) && km > 0 ? fmt().formatDistanceKm(km) : '—'
      });
    }
    return list.length ? list[0] : null;
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
      var genderKey = opts.gender || 'all';
      var categoryKey = opts.category || 'Supremo';
      filtered.forEach(function (r) {
        var score = getOverallTotalScore(r, genderKey, categoryKey);
        if (score == null || score <= 0) return;
        pushListItem(list, r, {
          value: score,
          valueLabel: fmt().formatScore(score),
          segments: (cfg().OVERALL_SEGMENTS || []).map(function (seg) {
            var sc = getSegmentScore(r, seg.key, genderKey, categoryKey);
            var pace = getOverallPaceForDistance(r, seg.key);
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
        pushListItem(list, r, {
          value: pace.paceSec,
          valueLabel: pace.paceStr
        });
      });
      list.sort(function (a, b) { return a.value - b.value; });
    } else if (tabId === 'tss') {
      filtered.forEach(function (r) {
        var tss = parseWeeklyTss(r);
        if (tss <= 0) return;
        pushListItem(list, r, {
          value: tss,
          valueLabel: fmt().formatTss(tss)
        });
      });
      list.sort(function (a, b) {
        var diff = b.value - a.value;
        if (diff !== 0) return diff;
        var au = a.userId != null ? String(a.userId) : '';
        var bu = b.userId != null ? String(b.userId) : '';
        return au < bu ? -1 : au > bu ? 1 : 0;
      });
    } else if (tabId === 'distance') {
      filtered.forEach(function (r) {
        var km = Number(r.distance_30d_km);
        if (!isFinite(km) || km <= 0) return;
        pushListItem(list, r, {
          value: km,
          valueLabel: fmt().formatDistanceKm(km)
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
      var sumAsOf = vw.week_sum_as_of || vw.week_end;
      if (sumAsOf && sumAsOf < vw.week_end) {
        return '주간 TSS: ' + vw.week_start + ' ~ ' + vw.week_end + ' (누계 ~' + sumAsOf + ')';
      }
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

  var CHART_CATEGORIES = ['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];

  /**
   * 분포 차트 currentUserId — CYCLE 랭킹보드와 동일하게 byCategory 행의 userId(보드 UUID) 사용.
   * 로그인 Firebase UID만 넘기면 나의 위치·배지가 표시되지 않음.
   */
  function resolveChartBoardUserId(rows) {
    var identity = getViewerIdentity(rows);
    if (identity.boardUserId) return String(identity.boardUserId);
    if (identity.firebaseId) return String(identity.firebaseId);
    var fb = getCurrentUserId();
    return fb ? String(fb) : '';
  }

  function findViewerChartEntries(byCategory, boardUid) {
    var currentUser = null;
    var myRankSupremo = null;
    if (!boardUid || !byCategory) {
      return { currentUser: currentUser, myRankSupremo: myRankSupremo };
    }
    var uid = String(boardUid);
    var sup = byCategory.Supremo || [];
    var i;
    for (i = 0; i < sup.length; i++) {
      if (sup[i] && String(sup[i].userId) === uid) {
        myRankSupremo = sup[i];
        currentUser = sup[i];
        break;
      }
    }
    return { currentUser: currentUser, myRankSupremo: myRankSupremo };
  }

  function findViewerChartEntryInCategory(byCategory, boardUid, category) {
    if (!boardUid || !byCategory || !category) return null;
    var arr = byCategory[category] || [];
    var uid = String(boardUid);
    var i;
    for (i = 0; i < arr.length; i++) {
      if (arr[i] && String(arr[i].userId) === uid) return arr[i];
    }
    return null;
  }

  /**
   * 목록 행(등락·순위)을 분포 차트 props에 병합 — CYCLE overrideDisplayRank·등락 배지와 동일.
   */
  function enrichChartPayloadWithViewerItem(payload, viewerItem, rows) {
    if (!payload || !viewerItem) return payload;
    var boardUid = resolveChartBoardUserId(rows || []);
    if (!boardUid && viewerItem.userId != null) {
      boardUid = String(viewerItem.userId);
    }
    if (!boardUid) return payload;

    payload.currentUserId = boardUid;
    if (viewerItem.rank != null && isFinite(Number(viewerItem.rank)) && Number(viewerItem.rank) >= 1) {
      payload.overrideDisplayRank = Math.floor(Number(viewerItem.rank));
    }

    var found = findViewerChartEntries(payload.byCategory, boardUid);
    if (found.myRankSupremo) payload.myRankSupremo = found.myRankSupremo;

    var activeCat = payload.activeCategory || 'Supremo';
    var catEntry = findViewerChartEntryInCategory(payload.byCategory, boardUid, activeCat);
    var base = catEntry
      ? Object.assign({}, catEntry)
      : found.currentUser
        ? Object.assign({}, found.currentUser)
        : { userId: boardUid };
    if (viewerItem.rankChange != null && isFinite(Number(viewerItem.rankChange))) {
      base.rankChange = Math.round(Number(viewerItem.rankChange));
    }
    if (viewerItem.previousBoardRank != null && isFinite(Number(viewerItem.previousBoardRank))) {
      base.previousBoardRank = Math.floor(Number(viewerItem.previousBoardRank));
    }
    if (viewerItem.rank != null && isFinite(Number(viewerItem.rank))) {
      base.rank = Math.floor(Number(viewerItem.rank));
    }
    if (payload.duration === 'gc' && viewerItem.value != null && isFinite(Number(viewerItem.value))) {
      base.gcScore = Number(viewerItem.value);
    }
    if (payload.duration === 'tss' && viewerItem.value != null && isFinite(Number(viewerItem.value))) {
      base.totalTss = Number(viewerItem.value);
    }
    if (payload.duration === 'personal_dist' && viewerItem.value != null && isFinite(Number(viewerItem.value))) {
      base.totalKm = Number(viewerItem.value);
    }
    if (payload.duration === 'run_pace' && viewerItem.value != null && isFinite(Number(viewerItem.value))) {
      base.paceSec = Number(viewerItem.value);
    }
    payload.currentUser = base;
    return payload;
  }

  /** StelvioRankingDistributionChart gc 모드용 엔트리 */
  function rowToChartEntry(row, gender, category) {
    var score = getOverallTotalScore(row, gender, category);
    if (score == null || score <= 0) return null;
    return {
      userId: rowUserId(row),
      name: rowDisplayName(row),
      gcScore: score,
      ageCategory: rowAgeCategory(row) || 'Supremo',
      is_private: isPrivateRow(row)
    };
  }

  function resolvePaceDistanceLabel(distKey) {
    var key = distKey || '5k';
    var dists = cfg().PACE_DISTANCES || [];
    var i;
    for (i = 0; i < dists.length; i++) {
      if (dists[i].key === key) return dists[i].label || key;
    }
    return key;
  }

  /** StelvioRankingDistributionChart run_pace 모드용 엔트리 */
  function rowToPaceChartEntry(row, distKey) {
    var pace = getPaceForDistance(row, distKey);
    if (pace.paceSec == null || pace.paceSec <= 0) return null;
    return {
      userId: rowUserId(row),
      name: rowDisplayName(row),
      paceSec: pace.paceSec,
      ageCategory: rowAgeCategory(row) || 'Supremo',
      is_private: isPrivateRow(row)
    };
  }

  /**
   * RUN 랭킹 탭별 분포 차트 공통 payload (종합·페이스·TSS·거리)
   * @param {object[]} rows
   * @param {{ gender?: string, category?: string }} opts
   * @param {{ makeEntry: function, sortFn: function, pillMetricLabel: string, duration: string, extra?: object }} spec
   */
  function buildMetricDistributionPayload(rows, opts, spec) {
    opts = opts || {};
    spec = spec || {};
    var gender = opts.gender || 'all';
    var filtered = filterByGender(rows || [], gender);
    var byCategory = {};
    var i;
    for (i = 0; i < CHART_CATEGORIES.length; i++) {
      byCategory[CHART_CATEGORIES[i]] = [];
    }
    filtered.forEach(function (r) {
      var ci;
      var base = spec.makeEntry ? spec.makeEntry(r) : null;
      if (!base) return;
      for (ci = 0; ci < CHART_CATEGORIES.length; ci++) {
        var chartCat = CHART_CATEGORIES[ci];
        if (chartCat === 'Supremo' || base.ageCategory === chartCat) {
          byCategory[chartCat].push(base);
        }
      }
    });
    CHART_CATEGORIES.forEach(function (cat) {
      byCategory[cat].sort(spec.sortFn);
      byCategory[cat].forEach(function (e, idx) { e.rank = idx + 1; });
    });
    var boardUid = resolveChartBoardUserId(filtered);
    var viewerChart = findViewerChartEntries(byCategory, boardUid);
    var catKey = opts.category || 'Supremo';
    var catLabel = (cfg().CATEGORY_LABELS || {})[catKey] || catKey;
    var out = {
      entries: byCategory.Supremo || [],
      byCategory: byCategory,
      activeCategory: catKey,
      duration: spec.duration || 'gc',
      currentUserId: boardUid || null,
      currentUser: viewerChart.currentUser,
      myRankSupremo: viewerChart.myRankSupremo,
      viewerIsAdmin: typeof window.getViewerGrade === 'function' && window.getViewerGrade() === '1',
      titleOverride: '참가자 분포',
      pillLabelOverride: catLabel + ' · ' + (spec.pillMetricLabel || ''),
      chartSubNoteOverride: '구간별 참가자 수(밀도). 곡선 아래 면적은 동일 스케일에서의 상대 분포를 나타냅니다.'
    };
    if (spec.extra && typeof spec.extra === 'object') {
      Object.keys(spec.extra).forEach(function (k) {
        out[k] = spec.extra[k];
      });
    }
    return out;
  }

  /**
   * 페이스 탭 분포 차트 payload (종합 탭 buildDistributionPayload 와 동일 props 형식)
   * @param {object[]} rows
   * @param {{ gender?: string, category?: string, paceDistance?: string }} opts
   */
  function buildPaceDistributionPayload(rows, opts) {
    opts = opts || {};
    var distKey = opts.paceDistance || '5k';
    var distLabel = resolvePaceDistanceLabel(distKey);
    return buildMetricDistributionPayload(rows, opts, {
      makeEntry: function (r) {
        return rowToPaceChartEntry(r, distKey);
      },
      sortFn: function (a, b) { return a.paceSec - b.paceSec; },
      pillMetricLabel: distLabel + ' 페이스',
      duration: 'run_pace',
      extra: {
        paceDistance: distKey,
        paceDistanceLabel: distLabel
      }
    });
  }

  /**
   * TSS 탭 분포 차트 payload
   * @param {object[]} rows
   * @param {{ gender?: string, category?: string }} opts
   */
  function buildTssDistributionPayload(rows, opts) {
    return buildMetricDistributionPayload(rows, opts, {
      makeEntry: function (r) {
        var tss = parseWeeklyTss(r);
        if (tss <= 0) return null;
        return {
          userId: rowUserId(r),
          name: rowDisplayName(r),
          totalTss: tss,
          ageCategory: rowAgeCategory(r) || 'Supremo',
          is_private: isPrivateRow(r)
        };
      },
      sortFn: function (a, b) { return Number(b.totalTss) - Number(a.totalTss); },
      pillMetricLabel: '주간 TSS',
      duration: 'tss'
    });
  }

  /**
   * 거리 탭 분포 차트 payload
   * @param {object[]} rows
   * @param {{ gender?: string, category?: string }} opts
   */
  function buildDistanceDistributionPayload(rows, opts) {
    return buildMetricDistributionPayload(rows, opts, {
      makeEntry: function (r) {
        var km = Number(r.distance_30d_km);
        if (!isFinite(km) || km <= 0) return null;
        return {
          userId: rowUserId(r),
          name: rowDisplayName(r),
          totalKm: km,
          ageCategory: rowAgeCategory(r) || 'Supremo',
          is_private: isPrivateRow(r)
        };
      },
      sortFn: function (a, b) { return Number(b.totalKm) - Number(a.totalKm); },
      pillMetricLabel: '최근 30일 거리',
      duration: 'personal_dist'
    });
  }

  /**
   * 종합 탭 분포 차트 payload (CYCLE GC 탭과 동일 props 형식)
   * @param {object[]} rows
   * @param {{ gender?: string, category?: string }} opts
   */
  function buildDistributionPayload(rows, opts) {
    opts = opts || {};
    var gender = opts.gender || 'all';
    var filtered = filterByGender(rows || [], gender);
    var byCategory = {};
    var i;
    for (i = 0; i < CHART_CATEGORIES.length; i++) {
      byCategory[CHART_CATEGORIES[i]] = [];
    }
    filtered.forEach(function (r) {
      var i;
      for (i = 0; i < CHART_CATEGORIES.length; i++) {
        var chartCat = CHART_CATEGORIES[i];
        var entry = rowToChartEntry(r, gender, chartCat);
        if (!entry) continue;
        if (chartCat === 'Supremo' || entry.ageCategory === chartCat) {
          byCategory[chartCat].push(entry);
        }
      }
    });
    CHART_CATEGORIES.forEach(function (cat) {
      byCategory[cat].sort(function (a, b) { return Number(b.gcScore) - Number(a.gcScore); });
      byCategory[cat].forEach(function (e, idx) { e.rank = idx + 1; });
    });
    var boardUid = resolveChartBoardUserId(filtered);
    var viewerChart = findViewerChartEntries(byCategory, boardUid);
    var catKey = opts.category || 'Supremo';
    var catLabel = (cfg().CATEGORY_LABELS || {})[catKey] || catKey;
    return {
      entries: byCategory.Supremo || [],
      byCategory: byCategory,
      activeCategory: catKey,
      duration: 'gc',
      currentUserId: boardUid || null,
      currentUser: viewerChart.currentUser,
      myRankSupremo: viewerChart.myRankSupremo,
      viewerIsAdmin: typeof window.getViewerGrade === 'function' && window.getViewerGrade() === '1',
      titleOverride: '참가자 분포',
      pillLabelOverride: catLabel + ' · 종합 점수',
      chartSubNoteOverride: '구간별 참가자 수(밀도). 곡선 아래 면적은 동일 스케일에서의 상대 분포를 나타냅니다.'
    };
  }

  function escapeHeroHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildHeroRankDeltaHtml(viewerItem) {
    if (!viewerItem) return '';
    var badgeFn = typeof window.stelvioServerRankChangeBadgeHtml === 'function'
      ? window.stelvioServerRankChangeBadgeHtml
      : (typeof window.stelvioRankDeltaBadgeHtml === 'function' ? window.stelvioRankDeltaBadgeHtml : null);
    if (!badgeFn) return '';
    if (viewerItem.rankChange != null && viewerItem.previousBoardRank != null) {
      return badgeFn(viewerItem.rankChange, viewerItem.previousBoardRank);
    }
    if (viewerItem.previousBoardRank != null && viewerItem.rank != null) {
      var prev = Math.floor(Number(viewerItem.previousBoardRank));
      var curr = Math.floor(Number(viewerItem.rank));
      if (prev >= 1 && curr >= 1) {
        return badgeFn(prev - curr, prev);
      }
    }
    return '';
  }

  function injectHeroRankDelta(msg, rankNum, deltaHtml) {
    if (!msg || !deltaHtml || rankNum == null || rankNum < 1) return msg;
    if (typeof window.stelvioInjectRankDeltaAfterPrimaryRank === 'function') {
      return window.stelvioInjectRankDeltaAfterPrimaryRank(msg, rankNum, ' ' + deltaHtml);
    }
    if (typeof window.stelvioInjectRankDeltaAfterRankInText === 'function') {
      return window.stelvioInjectRankDeltaAfterRankInText(msg, rankNum, ' ' + deltaHtml);
    }
    return msg + deltaHtml;
  }

  function resolveHeroUserName(fallbackName) {
    var userName = fallbackName || '러너';
    if (window.currentUser && window.currentUser.name) userName = window.currentUser.name;
    try {
      var ls = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (ls && ls.name) userName = ls.name;
    } catch (e) {}
    return escapeHeroHtml(userName);
  }

  function findViewerInRankedList(list, identity) {
    if (!list || !identity) return null;
    var i;
    for (i = 0; i < list.length; i++) {
      if (listItemMatchesViewer(list[i], identity)) {
        return {
          rank: list[i].rank != null ? list[i].rank : (i + 1),
          item: list[i]
        };
      }
    }
    return null;
  }

  /** CYCLE renderStelvioHeroCard — 본인 age_category 기준 부문 (필터 Supremo여도 표시) */
  function resolveViewerAgeCategory(rows, identity, hintItem) {
    var ageCat = hintItem && hintItem.ageCategory ? String(hintItem.ageCategory).trim() : '';
    if (ageCat && ageCat !== 'Supremo') return ageCat;
    var i;
    for (i = 0; i < (rows || []).length; i++) {
      var r = rows[i];
      if (identity && identity.boardUserId && String(rowUserId(r)) === String(identity.boardUserId)) {
        var ac = rowAgeCategory(r);
        if (ac) return ac;
      }
      if (identity && identity.firebaseId) {
        var fb = rowFirebaseUid(r);
        if (fb && String(fb) === String(identity.firebaseId)) {
          ac = rowAgeCategory(r);
          if (ac) return ac;
        }
      }
    }
    try {
      var u = window.currentUser;
      if (!u) u = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (u && u.ageCategory) return String(u.ageCategory).trim();
    } catch (e) {}
    return 'Supremo';
  }

  function heroMovementMeta(opts) {
    opts = opts || {};
    return {
      gender: opts.gender || 'all',
      category: opts.category || 'Supremo',
      paceDistance: opts.paceDistance,
      rankMovementSource: opts.rankMovementSource,
      leaderboardAsOfSeoul: opts.leaderboardAsOfSeoul,
      rankMovementAsOfSeoul: opts.rankMovementAsOfSeoul
    };
  }

  function getRankedListWithMovement(rows, tabId, listOpts, movementMeta, rankMovementByKey) {
    var list = buildRankedList(rows, tabId, listOpts);
    var moveMod = window.runningRankingMovement;
    if (moveMod && typeof moveMod.applyRankMovement === 'function') {
      moveMod.applyRankMovement(list, tabId, movementMeta || {}, rankMovementByKey || {});
    }
    return list;
  }

  function buildHeroRankDeltaForBoard(rows, identity, tabId, listOpts, movementMeta, rankMovementByKey) {
    var list = getRankedListWithMovement(rows, tabId, listOpts, movementMeta, rankMovementByKey);
    var found = findViewerInRankedList(list, identity);
    return buildHeroRankDeltaHtml(found ? found.item : null);
  }

  function buildCategoryHeroMessage(userNameEsc, tabLabel, catLabel, categoryRank, globalRank) {
    if (!catLabel || categoryRank <= 0) {
      return userNameEsc + '님은 ' + tabLabel + ' 전체 ' + globalRank + '위입니다.';
    }
    return userNameEsc + '님은 ' + tabLabel + ' ' + catLabel + ' 부문에서 ' + categoryRank + '위, 전체 ' + globalRank + '위입니다.';
  }

  function formatHeroMetricWithUnit(item, tabId, paceDistance) {
    if (!item) return '—';
    if (tabId === 'overall') {
      return fmt().formatScore(item.value) + '점';
    }
    if (tabId === 'pace') {
      return item.valueLabel || '—';
    }
    if (tabId === 'tss') {
      var tssTxt = item.valueLabel || fmt().formatTss(item.value);
      if (!tssTxt || tssTxt === '—') return '—';
      return String(tssTxt).indexOf('TSS') >= 0 ? String(tssTxt) : tssTxt + ' TSS';
    }
    if (tabId === 'distance') {
      var kmTxt = item.valueLabel || fmt().formatDistanceKm(item.value);
      if (!kmTxt || kmTxt === '—') return '—';
      return String(kmTxt).indexOf('km') >= 0 ? String(kmTxt) : kmTxt + 'km';
    }
    return item.valueLabel != null ? String(item.valueLabel) : '—';
  }

  function appendGlobalHeroMetric(msg, metricPart) {
    if (!msg || !metricPart || metricPart === '—') return msg;
    var safeMetric = escapeHeroHtml(metricPart);
    if (/입니다\.?\s*$/.test(msg)) {
      return msg.replace(/입니다\.?\s*$/, ' (' + safeMetric + ')입니다.');
    }
    return msg + ' (' + safeMetric + ')';
  }

  function injectHeroDualRankDelta(msg, categoryRank, globalRank, catBadge, supBadge) {
    if (categoryRank > 0 && catBadge) {
      if (typeof window.stelvioInjectRankDeltaAfterRankInText === 'function') {
        msg = window.stelvioInjectRankDeltaAfterRankInText(msg, categoryRank, ' ' + catBadge);
      } else {
        msg = injectHeroRankDelta(msg, categoryRank, catBadge);
      }
    }
    if (globalRank >= 1 && supBadge) {
      msg = injectHeroRankDelta(msg, globalRank, supBadge);
    }
    return msg;
  }

  function paceDistanceLabel(dk) {
    var dists = cfg().PACE_DISTANCES || [];
    var i;
    for (i = 0; i < dists.length; i++) {
      if (dists[i].key === dk) return dists[i].label;
    }
    return dk || '5k';
  }

  function finalizeHeroPayload(msg) {
    return { text: msg.replace(/<[^>]+>/g, ''), html: msg };
  }

  /**
   * 탭별 히어로 코멘트 공통 — CYCLE renderStelvioHeroCard와 동일 톤·부문/전체·등락
   * @returns {{ text: string, html: string }|null}
   */
  function buildTabHeroPayload(rows, tabId, opts) {
    opts = opts || {};
    var identity = getViewerIdentity(rows);
    if (!identity.firebaseId && !identity.boardUserId) return null;

    var gender = opts.gender || 'all';
    var activeCategory = opts.category || 'Supremo';
    var paceDistance = opts.paceDistance || '5k';
    var movementMeta = heroMovementMeta(opts);
    var rankMovementByKey = opts.rankMovementByKey || {};

    var globalList = getRankedListWithMovement(rows, tabId, {
      gender: gender,
      category: 'Supremo',
      paceDistance: paceDistance
    }, Object.assign({}, movementMeta, { category: 'Supremo' }), rankMovementByKey);
    var globalFound = findViewerInRankedList(globalList, identity);
    if (!globalFound) return null;

    var globalRank = globalFound.rank;
    var categoryRank = 0;
    var catFound = null;
    var labels = cfg().CATEGORY_LABELS || {};
    var viewerAgeCategory = resolveViewerAgeCategory(rows, identity, globalFound.item);
    var heroCategory = viewerAgeCategory !== 'Supremo'
      ? viewerAgeCategory
      : (activeCategory !== 'Supremo' ? activeCategory : 'Supremo');
    var catLabel = labels[heroCategory] || '';

    if (heroCategory !== 'Supremo' && catLabel) {
      catFound = findViewerInRankedList(
        getRankedListWithMovement(rows, tabId, {
          gender: gender,
          category: heroCategory,
          paceDistance: paceDistance
        }, Object.assign({}, movementMeta, { category: heroCategory }), rankMovementByKey),
        identity
      );
      if (catFound) {
        categoryRank = catFound.rank;
      }
    }

    var userNameEsc = resolveHeroUserName(globalFound.item && globalFound.item.name);
    var tabLabel;
    var globalMetricPart = formatHeroMetricWithUnit(globalFound.item, tabId, paceDistance);

    if (tabId === 'overall') {
      tabLabel = '종합 랭킹';
    } else if (tabId === 'pace') {
      tabLabel = paceDistanceLabel(paceDistance) + ' 구간 페이스';
    } else if (tabId === 'tss') {
      tabLabel = '주간 TSS';
    } else if (tabId === 'distance') {
      tabLabel = '최근 30일 거리';
    } else {
      return null;
    }

    var msg = buildCategoryHeroMessage(
      userNameEsc,
      tabLabel,
      heroCategory === 'Supremo' ? '' : catLabel,
      categoryRank,
      globalRank
    );

    var supBadge = buildHeroRankDeltaHtml(globalFound.item);
    var catBadge = catFound && catFound.item ? buildHeroRankDeltaHtml(catFound.item) : '';

    if (!supBadge && opts.viewerItem && activeCategory === 'Supremo') {
      supBadge = buildHeroRankDeltaHtml(opts.viewerItem);
    }

    msg = injectHeroDualRankDelta(msg, categoryRank, globalRank, catBadge, supBadge);
    msg = appendGlobalHeroMetric(msg, globalMetricPart);
    return finalizeHeroPayload(msg);
  }

  /**
   * 종합 탭 히어로 코멘트 (CYCLE GC 탭 stelvioHeroText와 동일 톤·등락 표시)
   * @returns {{ text: string, html: string }|null}
   */
  function buildOverallHeroPayload(rows, opts) {
    return buildTabHeroPayload(rows, 'overall', opts);
  }

  function buildPaceHeroPayload(rows, opts) {
    return buildTabHeroPayload(rows, 'pace', opts);
  }

  function buildTssHeroPayload(rows, opts) {
    return buildTabHeroPayload(rows, 'tss', opts);
  }

  function buildDistanceHeroPayload(rows, opts) {
    return buildTabHeroPayload(rows, 'distance', opts);
  }

  function buildOverallHeroMessage(rows, opts) {
    var payload = buildOverallHeroPayload(rows, opts);
    return payload ? payload.text : null;
  }

  /**
   * RUN 6축 헥사곤 — 구간별 페이스 순위 (CYCLE 헵타곤 rank→반지름 로직 동일)
   */
  function buildRunningHexagonState(rows, opts) {
    opts = opts || {};
    var uid = getCurrentUserId();
    if (!uid) return null;
    var gender = opts.gender || 'all';
    var activeCategory = opts.category || 'Supremo';
    var segmentMaps = buildSegmentRankMaps(rows, gender);
    var segments = cfg().OVERALL_SEGMENTS || [];
    var axes = [];
    var nRef = 1;
    var si;

    for (si = 0; si < segments.length; si++) {
      var seg = segments[si];
      var map = segmentMaps[seg.key] || {};
      var cohortN = 0;
      var keys = Object.keys(map);
      var ki;
      for (ki = 0; ki < keys.length; ki++) {
        if (map[keys[ki]] && map[keys[ki]].rank != null) cohortN += 1;
      }
      if (cohortN > nRef) nRef = cohortN;
      var info = map[uid] || map[String(uid).toLowerCase()] || null;
      if (!info) {
        for (ki = 0; ki < keys.length; ki++) {
          if (keys[ki].toLowerCase() === String(uid).toLowerCase()) {
            info = map[keys[ki]];
            break;
          }
        }
      }
      axes.push({
        key: seg.key,
        label: seg.label,
        rank: info && info.rank != null ? info.rank : null,
        pace: info && info.pace ? info.pace : '—',
        cohortN: cohortN
      });
    }

    var supremoRanks = buildOverallRankMap(rows, gender, 'Supremo');
    var catRanks = activeCategory !== 'Supremo'
      ? buildOverallRankMap(rows, gender, activeCategory)
      : null;
    var rawMy = (rows || []).find(function (r) { return String(rowUserId(r)) === String(uid); });
    var score = rawMy ? getOverallTotalScore(rawMy, gender, activeCategory) : null;

    return {
      userId: uid,
      axes: axes,
      nRef: nRef < 1 ? 1 : nRef,
      overallRank: supremoRanks[uid],
      categoryRank: catRanks ? catRanks[uid] : null,
      score: score,
      activeCategory: activeCategory,
      gender: gender
    };
  }

  function findViewerListItem(list, identity) {
    if (!list || !list.length || !identity) return null;
    var soc = window.runningRankingSocial;
    var i;
    if (soc && typeof soc.isViewerListItem === 'function') {
      for (i = 0; i < list.length; i++) {
        if (soc.isViewerListItem(list[i], identity)) return list[i];
      }
    }
    for (i = 0; i < list.length; i++) {
      if (listItemMatchesViewer(list[i], identity)) return list[i];
    }
    if (identity.boardUserId) {
      for (i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].userId) === String(identity.boardUserId)) return list[i];
      }
    }
    return null;
  }

  /** 랭킹보드 구간탭과 동일: buildRankedList + applyRankMovement */
  function buildPaceTabRankedListWithMovement(rows, opts) {
    opts = opts || {};
    var list = buildRankedList(rows, 'pace', {
      paceDistance: opts.paceDistance,
      gender: opts.gender || 'all',
      category: opts.category || 'Supremo'
    });
    var moveMod = window.runningRankingMovement;
    if (moveMod && typeof moveMod.applyRankMovement === 'function') {
      moveMod.applyRankMovement(
        list,
        'pace',
        {
          paceDistance: opts.paceDistance,
          gender: opts.gender || 'all',
          category: opts.category || 'Supremo',
          rankMovementSource: opts.rankMovementSource || '',
          leaderboardAsOfSeoul: opts.leaderboardAsOfSeoul || '',
          rankMovementAsOfSeoul: opts.rankMovementAsOfSeoul || ''
        },
        opts.rankMovementByKey || {}
      );
    }
    return list;
  }

  function buildOverallTabRankedListWithMovement(rows, opts) {
    opts = opts || {};
    var list = buildRankedList(rows, 'overall', {
      gender: opts.gender || 'all',
      category: opts.category || 'Supremo'
    });
    var moveMod = window.runningRankingMovement;
    if (moveMod && typeof moveMod.applyRankMovement === 'function') {
      moveMod.applyRankMovement(
        list,
        'overall',
        {
          gender: opts.gender || 'all',
          category: opts.category || 'Supremo',
          rankMovementSource: opts.rankMovementSource || '',
          leaderboardAsOfSeoul: opts.leaderboardAsOfSeoul || '',
          rankMovementAsOfSeoul: opts.rankMovementAsOfSeoul || ''
        },
        opts.rankMovementByKey || {}
      );
    }
    return list;
  }

  function resolveAxisRankChangeFromSocial(item, category) {
    var soc = window.runningRankingSocial;
    if (!item || !soc) return { suffix: null, html: '' };
    if (typeof soc.getRankChangeSuffix === 'function') {
      return {
        suffix: soc.getRankChangeSuffix(item, category),
        html: typeof soc.getRankChangeHtmlForHexagonAxis === 'function'
          ? soc.getRankChangeHtmlForHexagonAxis(item, category)
          : (typeof soc.getRankChangeHtml === 'function' ? soc.getRankChangeHtml(item, category) : '')
      };
    }
    return { suffix: resolveListItemRankChangeSuffix(item), html: '' };
  }

  /** 순위 → 백분위(1위=0%, 꼴찌=100%) — 헥사곤 가로바 색상 구간용 */
  function rankToPercentile(rank, n) {
    var nn = n | 0;
    if (rank == null || !isFinite(rank) || nn < 2) return 50;
    var r = Math.max(1, Math.min(nn, Math.floor(Number(rank))));
    return ((r - 1) / (nn - 1)) * 100;
  }

  /**
   * 상위 점유 % — rank/n×100 (1위/39≈2.56%, 꼴찌=100%)
   * 랭킹보드·헥사곤 툴팁·가로바 폭 공통
   */
  function rankToTopSharePercent(rank, n) {
    var nn = n | 0;
    if (rank == null || !isFinite(rank) || nn < 1) return 0;
    var r = Math.max(1, Math.min(nn, Math.floor(Number(rank))));
    return Math.round((r / nn) * 10000) / 100;
  }

  /**
   * 랭킹보드 구간·종합 탭과 동일 등락 표기 (stelvioRankMovementRowMatchesCurrentRank + badge 규칙)
   * @returns {{ text: string, kind: string, title: string }|null}
   */
  function resolveListItemRankChangeSuffix(item) {
    var rc = typeof window !== 'undefined' ? window.runningRankingRankChange : null;
    if (rc && typeof rc.suffixForListItem === 'function') {
      return rc.suffixForListItem(item, 'Supremo');
    }
    if (!item || item.isCrew) return null;
    var boardRank =
      item.boardRank != null && isFinite(Number(item.boardRank))
        ? Math.floor(Number(item.boardRank))
        : item.rank != null && isFinite(Number(item.rank))
          ? Math.floor(Number(item.rank))
          : null;
    var matchesFn =
      typeof window.stelvioRankMovementRowMatchesCurrentRank === 'function'
        ? window.stelvioRankMovementRowMatchesCurrentRank
        : null;
    if (matchesFn && boardRank != null && boardRank >= 1) {
      if (!matchesFn(item, boardRank)) return null;
    }
    if (item.rankChange == null || item.previousBoardRank == null) return null;
    var rcN = Number(item.rankChange);
    var prevN = Math.floor(Number(item.previousBoardRank));
    if (!isFinite(rcN) || !isFinite(prevN) || prevN < 1) return null;
    if (rcN > 0) {
      return { text: '(↑' + rcN + ')', kind: 'up', title: '전날 ' + prevN + '위' };
    }
    if (rcN < 0) {
      return { text: '(↓' + Math.abs(rcN) + ')', kind: 'down', title: '전날 ' + prevN + '위' };
    }
    return { text: '(-)', kind: 'flat', title: '전날 ' + prevN + '위' };
  }

  /** 백분위 → STELVIO 헥사곤 등급 ID (n≥100 컷과 동일) */
  function tierIdFromPercentile(p) {
    var v = Number(p);
    if (!isFinite(v)) return 'C6';
    if (v <= 5) return 'HC';
    if (v <= 10) return 'C1';
    if (v <= 20) return 'C2';
    if (v <= 40) return 'C3';
    if (v <= 60) return 'C4';
    if (v <= 80) return 'C5';
    return 'C6';
  }

  /**
   * RUN 대시보드 헥사곤 — 랭킹보드 구간·종합 탭과 동일 순위·등락
   * @param {object[]} rows
   * @param {{ gender?: string, category?: string, rankMovementByKey?: object, rankMovementSource?: string, leaderboardAsOfSeoul?: string, rankMovementAsOfSeoul?: string }} opts
   */
  function buildRunDashboardHexagonState(rows, opts) {
    opts = opts || {};
    var identity = getViewerIdentity(rows);
    if (!identity.firebaseId && !identity.boardUserId) return null;

    var gender = opts.gender || 'all';
    var category = opts.category || 'Supremo';
    var segments = cfg().OVERALL_SEGMENTS || [];
    var rankMovementByKey = opts.rankMovementByKey || {};
    var movementOpts = {
      gender: gender,
      category: category,
      rankMovementSource: opts.rankMovementSource || '',
      leaderboardAsOfSeoul: opts.leaderboardAsOfSeoul || '',
      rankMovementAsOfSeoul: opts.rankMovementAsOfSeoul || ''
    };

    var axes = [];
    var nRef = 1;
    var si;

    for (si = 0; si < segments.length; si++) {
      var seg = segments[si];
      var paceList = buildPaceTabRankedListWithMovement(rows, Object.assign({ paceDistance: seg.key }, movementOpts, {
        rankMovementByKey: rankMovementByKey
      }));
      var cohortN = paceList.length;
      if (cohortN > nRef) nRef = cohortN;
      var viewerItem = findViewerListItem(paceList, identity);
      var axisRc = resolveAxisRankChangeFromSocial(viewerItem, category);
      axes.push({
        key: seg.key,
        label: seg.label,
        rank: viewerItem && viewerItem.rank != null ? viewerItem.rank : null,
        rankChange: viewerItem && viewerItem.rankChange != null ? viewerItem.rankChange : null,
        previousBoardRank: viewerItem && viewerItem.previousBoardRank != null ? viewerItem.previousBoardRank : null,
        rankChangeSuffix: axisRc.suffix,
        rankChangeHtml: axisRc.html,
        pace: viewerItem && viewerItem.valueLabel ? viewerItem.valueLabel : '—',
        cohortN: cohortN
      });
    }

    var overallList = buildOverallTabRankedListWithMovement(rows, Object.assign({}, movementOpts, {
      rankMovementByKey: rankMovementByKey
    }));
    var overallViewer = findViewerListItem(overallList, identity);
    var overallN = overallList.length;
    var overallRank = overallViewer && overallViewer.rank != null ? overallViewer.rank : null;
    var overallRankChange = overallViewer && overallViewer.rankChange != null ? overallViewer.rankChange : null;
    var overallPrevRank = overallViewer && overallViewer.previousBoardRank != null ? overallViewer.previousBoardRank : null;
    var overallRc = overallViewer ? resolveAxisRankChangeFromSocial(overallViewer, category) : { suffix: null, html: '' };
    var overallRankChangeSuffix = overallRc.suffix;
    var overallRankChangeHtml = overallRc.html;
    var overallScore = overallViewer && overallViewer.value != null ? overallViewer.value : null;

    var pPercentile = overallRank != null && overallN >= 1 ? rankToPercentile(overallRank, overallN) : null;
    var topSharePercent = overallRank != null && overallN >= 1 ? rankToTopSharePercent(overallRank, overallN) : 0;
    var tierIdFromRank = pPercentile != null ? tierIdFromPercentile(pPercentile) : 'C6';

    return {
      userId: identity.boardUserId || identity.firebaseId,
      viewerIdentity: identity,
      axes: axes,
      nRef: nRef < 1 ? 1 : nRef,
      overallRank: overallRank,
      overallRankChange: overallRankChange,
      overallPreviousBoardRank: overallPrevRank,
      overallRankChangeSuffix: overallRankChangeSuffix,
      overallRankChangeHtml: overallRankChangeHtml,
      overallCohortN: overallN,
      overallScore: overallScore,
      pPercentile: pPercentile,
      topSharePercent: topSharePercent,
      tierIdFromRank: tierIdFromRank,
      activeCategory: category,
      gender: gender
    };
  }

  function formatRankLabel(rankNum) {
    return rankNum != null && Number(rankNum) >= 1
      ? Math.floor(Number(rankNum)) + '위'
      : '—';
  }

  function buildOverallRankMap(rows, gender, category) {
    var list = buildRankedList(rows, 'overall', { gender: gender, category: category });
    var map = {};
    list.forEach(function (item) {
      if (item && item.userId != null) map[String(item.userId)] = item.rank;
    });
    return map;
  }

  function buildSegmentRankMaps(rows, gender) {
    var filtered = filterByGender(rows || [], gender || 'all');
    var segments = cfg().OVERALL_SEGMENTS || [];
    var maps = {};
    var si;

    for (si = 0; si < segments.length; si++) {
      var key = segments[si].key;
      var cohort = [];
      filtered.forEach(function (r) {
        var uid = rowUserId(r);
        if (!uid) return;
        var pace = getOverallPaceForDistance(r, key);
        if (pace.paceSec == null) return;
        cohort.push({
          userId: uid,
          paceSec: pace.paceSec,
          paceStr: fmt().formatPaceOverlayMmSs
            ? fmt().formatPaceOverlayMmSs(pace.paceSec)
            : (pace.paceStr || '—')
        });
      });
      cohort.sort(function (a, b) {
        if (a.paceSec !== b.paceSec) return a.paceSec - b.paceSec;
        return String(a.userId).localeCompare(String(b.userId));
      });
      var rankMap = {};
      var ri;
      for (ri = 0; ri < cohort.length; ri++) {
        rankMap[cohort[ri].userId] = {
          rank: ri + 1,
          pace: cohort[ri].paceStr
        };
      }
      maps[key] = rankMap;
    }
    return maps;
  }

  /**
   * 아바타 오버레이 3줄 텍스트 (CYCLE 랭킹보드 프로필 카드와 동일 형식)
   * @returns {{ line1: string, line2: string, line3: string }|null}
   */
  function buildAvatarOverlayProfile(userId, rows, opts) {
    opts = opts || {};
    if (!userId || !rows || !rows.length) return null;

    var uid = String(userId).trim();
    var gender = opts.gender || 'all';
    var ageCategory = opts.ageCategory ? String(opts.ageCategory).trim() : 'Supremo';
    var displayName = opts.displayName != null ? String(opts.displayName).trim() : '';

    var row = null;
    var i;
    for (i = 0; i < rows.length; i++) {
      var rid = rowUserId(rows[i]);
      if (!rid) continue;
      if (rid === uid || rid.toLowerCase() === uid.toLowerCase()) {
        row = rows[i];
        uid = rid;
        break;
      }
    }
    if (!row) return null;

    if (!displayName) displayName = rowDisplayName(row);

    var supremoRanks = buildOverallRankMap(rows, gender, 'Supremo');
    var catRanks = ageCategory && ageCategory !== 'Supremo'
      ? buildOverallRankMap(rows, gender, ageCategory)
      : null;
    var segmentMaps = buildSegmentRankMaps(rows, gender);

    var catLab = (cfg().CATEGORY_LABELS || {})[ageCategory] || ageCategory;
    var gcSupRank = supremoRanks[uid];
    var gcCatRank = catRanks ? catRanks[uid] : null;

    var p1Mid = gcSupRank != null
      ? 'GC 전체 ' + formatRankLabel(gcSupRank)
      : 'GC 전체 —';
    var p1Cat = ageCategory && ageCategory !== 'Supremo' && gcCatRank != null
      ? '(' + (catLab || ageCategory) + ' ' + formatRankLabel(gcCatRank) + ')'
      : '';

    var line2Parts = [];
    var segments = cfg().OVERALL_SEGMENTS || [];
    for (i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var segMap = segmentMaps[seg.key] || {};
      var segInfo = segMap[uid];
      if (!segInfo || segInfo.rank == null) {
        line2Parts.push(seg.label + '(—)');
      } else {
        var rankPart = formatRankLabel(segInfo.rank);
        var pacePart = segInfo.pace && segInfo.pace !== '—' ? segInfo.pace : '—';
        line2Parts.push(seg.label + '(' + rankPart + '/' + pacePart + ')');
      }
    }

    var tss = Number(row.weekly_tss);
    var tssTxt = isFinite(tss) && tss > 0 ? fmt().formatTss(tss) : '—';
    var km = Number(row.distance_30d_km);
    var distTxt = isFinite(km) && km > 0 ? fmt().formatDistanceKm(km) + 'km' : '—';

    return {
      line1: displayName
        ? displayName + ' · ' + p1Mid + (p1Cat ? ' ' + p1Cat : '')
        : p1Mid + (p1Cat ? ' ' + p1Cat : ''),
      line2: line2Parts.join(' · '),
      line3: '주간 TSS: ' + tssTxt + ' · 최근 30일 거리: ' + distTxt
    };
  }

  window.runningRankingData = {
    getCurrentUserId: getCurrentUserId,
    getViewerIdentity: getViewerIdentity,
    listItemMatchesViewer: listItemMatchesViewer,
    buildRankedList: buildRankedList,
    buildListItemFromRawRow: buildListItemFromRawRow,
    getPaceForDistance: getPaceForDistance,
    buildCrewRankedList: buildCrewRankedList,
    resolveChartBoardUserId: resolveChartBoardUserId,
    enrichChartPayloadWithViewerItem: enrichChartPayloadWithViewerItem,
    buildDistributionPayload: buildDistributionPayload,
    buildPaceDistributionPayload: buildPaceDistributionPayload,
    buildTssDistributionPayload: buildTssDistributionPayload,
    buildDistanceDistributionPayload: buildDistanceDistributionPayload,
    buildOverallHeroMessage: buildOverallHeroMessage,
    buildOverallHeroPayload: buildOverallHeroPayload,
    buildPaceHeroPayload: buildPaceHeroPayload,
    buildTssHeroPayload: buildTssHeroPayload,
    buildDistanceHeroPayload: buildDistanceHeroPayload,
    buildTabHeroPayload: buildTabHeroPayload,
    buildRunningHexagonState: buildRunningHexagonState,
    buildRunDashboardHexagonState: buildRunDashboardHexagonState,
    buildPaceTabRankedListWithMovement: buildPaceTabRankedListWithMovement,
    buildOverallTabRankedListWithMovement: buildOverallTabRankedListWithMovement,
    rankToPercentile: rankToPercentile,
    rankToTopSharePercent: rankToTopSharePercent,
    resolveListItemRankChangeSuffix: resolveListItemRankChangeSuffix,
    tierIdFromPercentile: tierIdFromPercentile,
    buildSegmentRankMaps: buildSegmentRankMaps,
    buildAvatarOverlayProfile: buildAvatarOverlayProfile,
    normalizeLeaderboardRows: normalizeLeaderboardRows,
    getVolumeWindowLabel: getVolumeWindowLabel,
    getDistanceWindowLabel: getDistanceWindowLabel,
    rowUserId: rowUserId,
    rowFirebaseUid: rowFirebaseUid,
    isPrivateRow: isPrivateRow
  };
})();
