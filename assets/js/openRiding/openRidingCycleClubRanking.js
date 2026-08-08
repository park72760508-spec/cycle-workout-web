/**
 * CYCLE(자전거) 클럽 상세 화면 전용 — 랭킹보드 화면 상태와 무관하게 독립적으로 동작하는
 * 클럽 멤버 순위 조회 로직. 랭킹보드 클럽탭(stelvioGroupTabBuildMergedForGid 등)과 같은
 * 항목→값 매핑(stelvioGroupTabGetMetricValue)을 그대로 따르되, 화면 전용 module-private
 * 상태(stelvioGroupTabExpandedId 등)에 의존하지 않고 getPeakPowerRanking 공개 API를
 * 직접 호출해 필요한 값만 계산한다.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var API_URL = 'https://us-central1-stelvio-ai.cloudfunctions.net/getPeakPowerRanking';
  var CACHE_TTL_MS = 60000;
  var _cache = Object.create(null);

  var METRIC_OPTIONS = [
    { value: 'gc', label: 'GC' },
    { value: 'personal_speed', label: '독주' },
    { value: 'tss', label: 'TSS' },
    { value: 'personal_dist', label: '거리' },
    { value: 'max', label: 'Max' },
    { value: '1min', label: '1분' },
    { value: '5min', label: '5분' },
    { value: '10min', label: '10분' },
    { value: '20min', label: '20분' },
    { value: '40min', label: '40분' },
    { value: '60min', label: '60분' }
  ];

  /** 랭킹보드 stelvioGroupTabCurrentMetricUnit과 동일 매핑 */
  function metricUnit(metric) {
    switch (metric) {
      case 'gc': return '점';
      case 'tss': return 'TSS';
      case 'personal_dist': return 'km';
      case 'personal_speed': return 'km/h';
      default: return 'W/kg';
    }
  }

  /** 랭킹보드 stelvioGroupTabGetMetricValue와 동일 필드 매핑 */
  function metricValue(metric, entry) {
    if (!entry) return null;
    var v;
    switch (metric) {
      case 'gc': v = entry.gcScore; break;
      case 'tss': v = entry.totalTss; break;
      case 'personal_dist': v = entry.totalKm; break;
      case 'personal_speed': v = entry.speedKmh; break;
      default: v = entry.wkg; break;
    }
    return v != null && isFinite(Number(v)) ? Number(v) : null;
  }

  function formatMetricValue(metric, v) {
    var n = Number(v);
    if (!isFinite(n)) return '-';
    switch (metric) {
      case 'gc':
        return n.toFixed(1);
      case 'tss':
        return n.toLocaleString('en-US', {
          minimumFractionDigits: n % 1 === 0 ? 0 : 1,
          maximumFractionDigits: n % 1 === 0 ? 0 : 1
        });
      case 'personal_dist':
        return n.toLocaleString('en-US', {
          minimumFractionDigits: n >= 100 ? 0 : 1,
          maximumFractionDigits: n >= 100 ? 0 : 1
        });
      case 'personal_speed':
        return n.toFixed(1);
      default:
        return n.toFixed(2);
    }
  }

  function currentUid() {
    try {
      if (window.currentUser && window.currentUser.id) return String(window.currentUser.id);
      var u = JSON.parse(localStorage.getItem('currentUser') || 'null');
      return u && u.id ? String(u.id) : '';
    } catch (e) {
      return '';
    }
  }

  /** 항목(duration)·성별별 getPeakPowerRanking 조회 — 화면 상태와 무관, 60초 메모리 캐시 */
  function fetchClubRanking(opts) {
    opts = opts || {};
    var metric = opts.metric || 'gc';
    var gender = opts.gender || 'all';
    var readDb =
      typeof window.stelvioGetRankingReadSourceSync === 'function'
        ? window.stelvioGetRankingReadSourceSync()
        : 'supabase';
    var uid = currentUid();
    var key = metric + '|' + gender + '|' + readDb;
    var now = Date.now();
    var hit = _cache[key];
    if (hit && now - hit.ts < CACHE_TTL_MS) return Promise.resolve(hit.data);

    var params = new URLSearchParams({
      period: 'monthly',
      duration: metric,
      gender: gender,
      readDb: readDb,
      gfVer: '7'
    });
    if (uid) params.set('uid', uid);
    if (metric === 'personal_dist') params.set('distPriv', '1');
    if (metric === 'gc') params.set('gcSnap', '1');

    return fetch(API_URL + '?' + params.toString(), { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json || json.success === false || !json.byCategory) {
          throw new Error('club ranking fetch failed');
        }
        _cache[key] = { ts: Date.now(), data: json };
        return json;
      });
  }

  /** 특정 항목 기준으로 전체 풀을 정렬해 userId → 전체 순위 맵을 만든다(랭킹보드와 동일 기준). */
  function rankPoolByMetric(rows, metric) {
    var pool = rows.slice().sort(function (a, b) {
      var av = metricValue(metric, a);
      var bv = metricValue(metric, b);
      av = av == null ? -1 : av;
      bv = bv == null ? -1 : bv;
      return bv - av;
    });
    var byUid = Object.create(null);
    pool.forEach(function (r, idx) {
      if (!r || r.userId == null) return;
      byUid[String(r.userId)] = idx + 1;
    });
    return byUid;
  }

  function rowsByUid(rows) {
    var map = Object.create(null);
    (rows || []).forEach(function (r) {
      if (r && r.userId != null) map[String(r.userId)] = r;
    });
    return map;
  }

  /**
   * 클럽 멤버 순위 목록 — RUN 크루탭 buildCrewMemberRankedList와 동일한 결과 형태.
   * 전체순위(rank/boardRank)는 카테고리 풀 전체 기준, 목록 표시 순서(_crewRank)는
   * 클럽 멤버 중 유효 값이 있는 멤버만 값 기준 재정렬한다.
   *
   * @param {object} opts.allMetricsByCategory — { gc, tss, personal_dist, personal_speed } 각각
   *   fetchClubRanking({metric}).byCategory. getPeakPowerRanking은 duration(항목)별로 별도 응답이라
   *   한 응답에 gcScore/totalTss/totalKm/speedKmh가 동시에 들어있지 않다 — 아바타 오버레이가 4개
   *   항목을 모두 보여주려면 4번 fetch한 결과를 각각 넘겨야 한다(2026-08).
   */
  function buildClubMemberRankedList(byCategory, memberRows, opts) {
    opts = opts || {};
    var metric = opts.metric || 'gc';
    var category = opts.category || 'Supremo';
    var rows = (byCategory && byCategory[category]) || [];

    var pool = rows.slice().sort(function (a, b) {
      var av = metricValue(metric, a);
      var bv = metricValue(metric, b);
      av = av == null ? -1 : av;
      bv = bv == null ? -1 : bv;
      return bv - av;
    });
    var byUid = Object.create(null);
    pool.forEach(function (r, idx) {
      if (!r || r.userId == null) return;
      byUid[String(r.userId)] = { row: r, boardRank: idx + 1 };
    });

    /* 아바타 확대 오버레이 — GC·주간TSS·최근 30일 거리·독주 각각의 원본 값·전체 순위.
       allMetricsByCategory가 없으면(호출부가 아직 안 넘겨줬을 때) 현재 탭 응답으로 폴백하되,
       그 경우 선택 탭 외 나머지 항목 값은 비어(-) 보일 수 있다. */
    var allMetrics = opts.allMetricsByCategory || {};
    function metricRows(key) {
      var byCat = allMetrics[key];
      return (byCat && byCat[category]) || rows;
    }
    var gcRows = metricRows('gc');
    var tssRows = metricRows('tss');
    var distRows = metricRows('personal_dist');
    var speedRows = metricRows('personal_speed');
    var gcByUid = rowsByUid(gcRows);
    var tssByUid = rowsByUid(tssRows);
    var distByUid = rowsByUid(distRows);
    var speedByUid = rowsByUid(speedRows);
    var gcRankByUid = rankPoolByMetric(gcRows, 'gc');
    var tssRankByUid = rankPoolByMetric(tssRows, 'tss');
    var distRankByUid = rankPoolByMetric(distRows, 'personal_dist');
    var speedRankByUid = rankPoolByMetric(speedRows, 'personal_speed');

    var merged = [];
    (memberRows || []).forEach(function (m) {
      var uid = m && (m.userId || m.uid || m.id) ? String(m.userId || m.uid || m.id) : '';
      if (!uid) return;
      var hit = byUid[uid];
      if (!hit) return;
      var val = metricValue(metric, hit.row);
      if (val == null || val <= 0) return;
      merged.push(
        Object.assign({}, m, {
          firebaseUid: uid,
          socialUserId: uid,
          value: val,
          valueLabel: formatMetricValue(metric, val),
          boardRank: hit.boardRank,
          rank: hit.boardRank,
          rankChange: hit.row.rankChange != null ? hit.row.rankChange : null,
          previousBoardRank: hit.row.previousBoardRank != null ? hit.row.previousBoardRank : null,
          _groupRole: m.role || 'member',
          /* 아바타 확대 오버레이(GC·주간TSS·최근 30일 거리·독주) — 선택된 항목과 무관하게 원본 값 보존 */
          gcScore: metricValue('gc', gcByUid[uid]),
          weeklyTss: metricValue('tss', tssByUid[uid]),
          distance30dKm: metricValue('personal_dist', distByUid[uid]),
          personalSpeedKmh: metricValue('personal_speed', speedByUid[uid]),
          gcRank: gcRankByUid[uid] || null,
          weeklyTssRank: tssRankByUid[uid] || null,
          distance30dRank: distRankByUid[uid] || null,
          personalSpeedRank: speedRankByUid[uid] || null
        })
      );
    });
    merged.sort(function (a, b) { return b.value - a.value; });
    merged.forEach(function (item, idx) { item._crewRank = idx + 1; });
    return merged;
  }

  window.openRidingCycleClubRanking = {
    METRIC_OPTIONS: METRIC_OPTIONS,
    metricUnit: metricUnit,
    metricValue: metricValue,
    formatMetricValue: formatMetricValue,
    fetchClubRanking: fetchClubRanking,
    buildClubMemberRankedList: buildClubMemberRankedList
  };
})();
