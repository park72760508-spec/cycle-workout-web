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
        list.push({
          userId: rowUserId(r),
          name: rowDisplayName(r),
          profileUrl: rowProfileUrl(r),
          isPrivate: isPrivateRow(r),
          ageCategory: rowAgeCategory(r),
          raw: r,
          value: score,
          valueLabel: fmt().formatScore(score),
          segments: (cfg().OVERALL_SEGMENTS || []).map(function (seg) {
            var sc = getSegmentScore(r, seg.key, genderKey, categoryKey);
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
          ageCategory: rowAgeCategory(r),
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
          ageCategory: rowAgeCategory(r),
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
          ageCategory: rowAgeCategory(r),
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

  window.runningRankingData = {
    getCurrentUserId: getCurrentUserId,
    buildRankedList: buildRankedList,
    buildCrewRankedList: buildCrewRankedList,
    buildDistributionPayload: buildDistributionPayload,
    buildOverallHeroMessage: buildOverallHeroMessage,
    getVolumeWindowLabel: getVolumeWindowLabel,
    getDistanceWindowLabel: getDistanceWindowLabel,
    rowUserId: rowUserId,
    isPrivateRow: isPrivateRow
  };
})();
