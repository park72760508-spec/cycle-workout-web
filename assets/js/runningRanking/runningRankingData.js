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
  function normalizeLeaderboardRows(rows) {
    if (!rows || !rows.length) return rows || [];
    if (!needsClientGcScoring(rows)) return rows;

    var gcByUser = buildClientGcScores(rows);
    return rows.map(function (r) {
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
        var tss = Number(r.weekly_tss);
        if (!isFinite(tss) || tss <= 0) return;
        pushListItem(list, r, {
          value: tss,
          valueLabel: fmt().formatTss(tss)
        });
      });
      list.sort(function (a, b) { return b.value - a.value; });
    } else if (tabId === 'distance') {
      filtered.forEach(function (r) {
        var km = Number(r.distance_30d_km);
        if (!isFinite(km) || km <= 0) return;
        pushListItem(list, r, {
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

  var CHART_CATEGORIES = ['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];

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
    var uid = getCurrentUserId();
    var myRankSupremo = null;
    var currentUser = null;
    if (uid) {
      var sup = byCategory.Supremo || [];
      for (i = 0; i < sup.length; i++) {
        if (sup[i] && String(sup[i].userId) === String(uid)) {
          myRankSupremo = sup[i];
          currentUser = sup[i];
          break;
        }
      }
    }
    var catKey = opts.category || 'Supremo';
    var catLabel = (cfg().CATEGORY_LABELS || {})[catKey] || catKey;
    return {
      entries: byCategory.Supremo || [],
      byCategory: byCategory,
      activeCategory: catKey,
      duration: 'gc',
      currentUserId: uid,
      currentUser: currentUser,
      myRankSupremo: myRankSupremo,
      viewerIsAdmin: typeof window.getViewerGrade === 'function' && window.getViewerGrade() === '1',
      titleOverride: '참가자 분포',
      pillLabelOverride: catLabel + ' · 종합 점수',
      chartSubNoteOverride: '구간별 참가자 수(밀도). 곡선 아래 면적은 동일 스케일에서의 상대 분포를 나타냅니다.'
    };
  }

  /**
   * 종합 탭 한줄 히어로 코멘트 (CYCLE GC 탭 stelvioHeroText와 동일 톤)
   */
  function buildOverallHeroMessage(rows, opts) {
    opts = opts || {};
    var uid = getCurrentUserId();
    if (!uid) return null;
    var gender = opts.gender || 'all';
    var activeCategory = opts.category || 'Supremo';
    var filtered = filterByGender(rows || [], gender);
    var list = [];
    filtered.forEach(function (r) {
      var score = getOverallTotalScore(r, gender, 'Supremo');
      if (score == null || score <= 0) return;
      list.push({
        userId: rowUserId(r),
        name: rowDisplayName(r),
        score: score,
        ageCategory: rowAgeCategory(r)
      });
    });
    list.sort(function (a, b) { return b.score - a.score; });
    var globalRank = 0;
    var categoryRank = 0;
    var myRow = null;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].userId) === String(uid)) {
        globalRank = i + 1;
        myRow = list[i];
        break;
      }
    }
    if (!myRow) return null;
    var myBoardScore = getOverallTotalScore(
      (rows || []).find(function (r) { return String(rowUserId(r)) === String(uid); }),
      gender,
      activeCategory
    );
    if (myBoardScore != null && myBoardScore > 0) {
      myRow = Object.assign({}, myRow, { score: myBoardScore });
    }
    var userName = (window.currentUser && window.currentUser.name) || myRow.name || '러너';
    try {
      var ls = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (ls && ls.name) userName = ls.name;
    } catch (e) {}
    var scoreLabel = fmt().formatScore(myRow.score) + 'pt';
    var labels = cfg().CATEGORY_LABELS || {};
    var ageLabel = labels[myRow.ageCategory] || '';
    if (activeCategory !== 'Supremo') {
      var catList = [];
      filtered.forEach(function (r) {
        if (rowAgeCategory(r) !== activeCategory) return;
        var catScore = getOverallTotalScore(r, gender, activeCategory);
        if (catScore == null || catScore <= 0) return;
        catList.push({ userId: rowUserId(r), score: catScore });
      });
      catList.sort(function (a, b) { return b.score - a.score; });
      for (var j = 0; j < catList.length; j++) {
        if (String(catList[j].userId) === String(uid)) {
          categoryRank = j + 1;
          break;
        }
      }
    }
    if (activeCategory === 'Supremo' || !ageLabel || myRow.ageCategory === 'Supremo') {
      return userName + '님은 RUN 종합 랭킹 전체 ' + globalRank + '위(' + scoreLabel + ')입니다.';
    }
    if (categoryRank > 0) {
      return userName + '님은 RUN 종합 랭킹 ' + ageLabel + ' 부문에서 ' + categoryRank + '위(' + scoreLabel + '), 전체 ' + globalRank + '위입니다.';
    }
    return userName + '님은 RUN 종합 랭킹 전체 ' + globalRank + '위(' + scoreLabel + ')입니다.';
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
    buildRankedList: buildRankedList,
    buildCrewRankedList: buildCrewRankedList,
    buildDistributionPayload: buildDistributionPayload,
    buildOverallHeroMessage: buildOverallHeroMessage,
    buildAvatarOverlayProfile: buildAvatarOverlayProfile,
    normalizeLeaderboardRows: normalizeLeaderboardRows,
    getVolumeWindowLabel: getVolumeWindowLabel,
    getDistanceWindowLabel: getDistanceWindowLabel,
    rowUserId: rowUserId,
    rowFirebaseUid: rowFirebaseUid,
    isPrivateRow: isPrivateRow
  };
})();
