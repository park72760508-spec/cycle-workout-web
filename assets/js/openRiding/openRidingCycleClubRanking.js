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

  /**
   * 클럽 멤버 순위 목록 — RUN 크루탭 buildCrewMemberRankedList와 동일한 결과 형태.
   * 전체순위(rank/boardRank)는 카테고리 풀 전체 기준, 목록 표시 순서(_crewRank)는
   * 클럽 멤버 중 유효 값이 있는 멤버만 값 기준 재정렬한다.
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
          gcScore: metricValue('gc', hit.row),
          weeklyTss: metricValue('tss', hit.row),
          distance30dKm: metricValue('personal_dist', hit.row),
          personalSpeedKmh: metricValue('personal_speed', hit.row)
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
