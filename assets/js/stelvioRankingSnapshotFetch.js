/**
 * 비용 절감 3단계(2026-09): 랭킹보드(getPeakPowerRanking) 공용 스냅샷 우선 읽기.
 *
 * 랭킹은 배치 구간(GC 01:15·03:30 / 피크·독주 01:00·03:15) 동안 모든 사용자에게 같다.
 * Cloud Run 이 구간당 처음 계산할 때 뷰어 개인화 전 응답을 Supabase ranking_board_snapshots 에
 * 저장하므로(functions/rankingBoardSnapshots.js), 같은 epoch 스냅샷이 있으면 Cloud Run 대신
 * Supabase 에서 읽고 본인 행(currentUser)·동기부여 메시지·GC 뷰어 7축만 여기서 붙인다.
 * 스냅샷이 없거나 실패하면 null → 호출부가 기존 Cloud Run 요청을 그대로 보낸다(그 요청이 스냅샷을 채움).
 *
 * - window.stelvioRankingSnapshotTry(url): 랭킹보드 메인 fetch(Worker 경유) 앞단에서 명시 호출
 * - window.fetch 래핑: 대시보드·클럽·헵타곤 카드 등 나머지 getPeakPowerRanking 호출부 공통 적용
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__stelvioRankingSnapshotInstalled) return;
  window.__stelvioRankingSnapshotInstalled = true;

  var PEAK_DURATIONS = ['max', '1min', '5min', '10min', '20min', '40min', '60min'];
  var GC_BOUNDARIES = ['01:15', '03:30'];
  var PEAK_BOUNDARIES = ['01:00', '03:15'];
  /** functions/rankingResponseAdapter.js PEAK_RANKING_USER_LOOKUP_ORDER 와 동일 */
  var USER_LOOKUP_ORDER = ['Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda', 'Supremo'];
  var hitCache = Object.create(null); // key|epoch → Promise<payload>

  function boundariesFor(duration) {
    if (duration === 'gc') return GC_BOUNDARIES;
    if (duration === 'personal_speed') return PEAK_BOUNDARIES;
    if (PEAK_DURATIONS.indexOf(duration) >= 0) return PEAK_BOUNDARIES;
    return null;
  }

  /** functions/supabaseRankingReader.js currentBatchEpochKeyKst 와 동일 */
  function currentBatchEpochKeyKst(boundaries) {
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    function kstParts(date) {
      var parts = fmt.formatToParts(date);
      var get = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
      var hh = get('hour') === '24' ? 0 : Number(get('hour'));
      return { dateStr: get('year') + '-' + get('month') + '-' + get('day'), minutes: hh * 60 + Number(get('minute')) };
    }
    var bm = boundaries.map(function (b) { var s = b.split(':'); return Number(s[0]) * 60 + Number(s[1]); });
    var now = new Date();
    var k = kstParts(now);
    var idx = -1;
    for (var i = 0; i < bm.length; i++) if (k.minutes >= bm[i]) idx = i;
    if (idx === -1) {
      var y = kstParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));
      return y.dateStr + '_b' + (bm.length - 1);
    }
    return k.dateStr + '_b' + idx;
  }

  function parseRankingUrl(url) {
    try {
      var u = new URL(String(url), window.location.href);
      if (u.hostname.indexOf('cloudfunctions.net') < 0 || u.pathname.indexOf('getPeakPowerRanking') < 0) return null;
      var q = u.searchParams;
      if (q.get('parity') === '1' || q.get('parity') === 'true') return null;
      var duration = q.get('duration') || '5min';
      var boundaries = boundariesFor(duration);
      if (!boundaries) return null;
      var period = q.get('period') || 'monthly';
      if (period === 'yearly') period = 'monthly';
      var gender = q.get('gender') || 'all';
      return {
        duration: duration,
        gender: gender,
        uid: q.get('uid') || '',
        key: period + '|' + duration + '|' + gender,
        epoch: currentBatchEpochKeyKst(boundaries)
      };
    } catch (e) {
      return null;
    }
  }

  function supabaseCfg() {
    var c = window.STELVIO_SUPABASE_CONFIG || window.__STELVIO_SUPABASE__ || {};
    return c.supabaseUrl && c.supabaseAnonKey ? c : null;
  }

  function fetchSnapshot(info) {
    var cacheKey = info.key + '|' + info.epoch;
    if (hitCache[cacheKey]) return hitCache[cacheKey];
    var cfg = supabaseCfg();
    if (!cfg) return Promise.resolve(null);
    var url = cfg.supabaseUrl + '/rest/v1/ranking_board_snapshots?select=payload' +
      '&snapshot_key=eq.' + encodeURIComponent(info.key) + '&epoch=eq.' + encodeURIComponent(info.epoch);
    var p = originalFetch(url, {
      method: 'GET',
      headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey, Accept: 'application/json' }
    }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (rows) {
      var payload = Array.isArray(rows) && rows[0] && rows[0].payload;
      if (!payload || payload.success !== true) return null;
      return payload;
    }).catch(function () { return null; });
    p.then(function (v) { if (!v) delete hitCache[cacheKey]; });
    hitCache[cacheKey] = p;
    return p;
  }

  /* ---- 동기부여 메시지 — functions/index.js buildMotivationMessage* 와 동일 ---- */
  function msgTss(c, n) {
    var d = Number(n.totalTss) - Number(c.totalTss);
    if (!(d > 0)) return null;
    return c.name + '님 현재 ' + c.rank + '위! 앞선 사용자와의 차이는 ' + d.toFixed(1) + ' TSS입니다. 주간 합계를 ' + Math.ceil(d) + ' TSS 이상 더 올리면 추월할 수 있습니다. 도전해 보세요!';
  }
  function msgKm(c, n) {
    var d = Number(n.totalKm) - Number(c.totalKm);
    if (!(d > 0)) return null;
    var need = Math.ceil(d * 10) / 10;
    return c.name + '님 현재 ' + c.rank + '위! 앞선 사용자와의 차이는 ' + d.toFixed(1) + ' km입니다. ' + need.toFixed(1) + ' km 이상 더 올리면 추월할 수 있습니다. 도전해 보세요!';
  }
  function msgSpeed(c, n) {
    var d = Number(n.speedKmh) - Number(c.speedKmh);
    if (!(d > 0)) return null;
    var need = Math.ceil(d * 10) / 10;
    return c.name + '님 현재 ' + c.rank + '위! 앞선 사용자와의 차이는 ' + d.toFixed(1) + ' km/h입니다. ' + need.toFixed(1) + ' km/h 이상 올리면 추월할 수 있습니다. 도전해 보세요!';
  }
  function buildMotivationMessage(c, n) {
    if (!c || !n || c.rank >= n.rank) return null;
    if (c.gcScore != null && n.gcScore != null) {
      var dg = Number(n.gcScore) - Number(c.gcScore);
      if (!(dg > 0)) return null;
      return c.name + '님 현재 ' + c.rank + '위! 바로 앞 순위와의 환산 점수 차는 약 ' + dg.toFixed(1) + '점입니다.';
    }
    if (c.speedKmh != null && n.speedKmh != null) return msgSpeed(c, n);
    if (c.totalKm != null && n.totalKm != null) return msgKm(c, n);
    if (c.totalTss != null && n.totalTss != null) return msgTss(c, n);
    var dw = n.wkg - c.wkg;
    if (dw <= 0) return null;
    var kg = Number(c.weightKg) || 0;
    if (kg <= 0) return null;
    var req = Math.ceil(dw * kg);
    return c.name + '님 현재 ' + c.rank + '위! 앞선 사용자와의 차이는 ' + dw.toFixed(2) + ' W/kg로, ' + req + 'W 향상 시키면(목표 파워: ' + ((c.watts || 0) + req) + 'W) 추월할 수 있습니다. 도전해 보세요!';
  }

  /** attachCurrentUserToPayload 와 동일 — 부문 배열에서 본인 행을 찾아 currentUser 로 */
  function attachCurrentUser(payload, uid) {
    if (!uid || !payload.byCategory) return;
    for (var i = 0; i < USER_LOOKUP_ORDER.length; i++) {
      var arr = payload.byCategory[USER_LOOKUP_ORDER[i]] || [];
      for (var j = 0; j < arr.length; j++) {
        if (arr[j] && String(arr[j].userId) === String(uid)) {
          payload.currentUser = arr[j];
          payload.motivationMessage = buildMotivationMessage(arr[j], j > 0 ? arr[j - 1] : null);
          return;
        }
      }
    }
  }

  function currentFirebaseUid() {
    try {
      if (window.authV9 && window.authV9.currentUser) return String(window.authV9.currentUser.uid || '');
    } catch (e) {}
    return '';
  }

  /** attachGcViewerHeptagonAxes 와 동일 — 본인 세션일 때만(RPC fn_my_gc_heptagon_axis) */
  function attachGcViewerAxis(payload, info) {
    if (info.duration !== 'gc' || !info.uid || info.uid !== currentFirebaseUid()) return Promise.resolve();
    var rpcP = typeof window.stelvioSupabaseRpc === 'function'
      ? Promise.resolve(window.stelvioSupabaseRpc)
      : import('/assets/js/supabaseDualWrite.js').then(function (m) { return m.callSupabaseRpcAsUser; });
    return rpcP.then(function (rpc) {
      return rpc('fn_my_gc_heptagon_axis', { p_month_key: payload.gcMonthKey || '', p_gender: info.gender });
    }).then(function (res) {
      var a = res && res.axis;
      if (!a || !Array.isArray(a.ranks) || a.ranks.length !== 7) return;
      var ranks = a.ranks.map(function (r) { return Math.floor(Number(r)); });
      var cohortN = Array.isArray(a.cohortN) && a.cohortN.length === 7
        ? a.cohortN.map(function (n) { return Math.max(0, Math.floor(Number(n))); })
        : ranks.map(function () { return 100; });
      var pos = Array.isArray(a.positionScores100) && a.positionScores100.length === 7
        ? a.positionScores100.map(Number) : null;
      payload.viewerHeptagonAxis = {
        ranks: ranks,
        cohortSizePerAxis: cohortN,
        positionScores100: pos,
        sumPositionScores: a.sumPositionScores != null && isFinite(Number(a.sumPositionScores)) ? Number(a.sumPositionScores) : null,
        boardRank: a.boardRank != null && isFinite(Number(a.boardRank)) ? Math.floor(Number(a.boardRank)) : null
      };
      var sup = (payload.byCategory && payload.byCategory.Supremo) || [];
      for (var i = 0; i < sup.length; i++) {
        if (sup[i] && String(sup[i].userId) === info.uid) {
          sup[i].heptagonRanks = ranks;
          sup[i].heptagonCohortNPerAxis = cohortN;
          sup[i].positionScores100 = pos;
          break;
        }
      }
      if (payload.currentUser && String(payload.currentUser.userId) === info.uid) {
        payload.currentUser.heptagonRanks = ranks;
        payload.currentUser.heptagonCohortNPerAxis = cohortN;
        payload.currentUser.positionScores100 = pos;
      }
    }).catch(function () {});
  }

  function clonePayload(p) {
    try { return typeof structuredClone === 'function' ? structuredClone(p) : JSON.parse(JSON.stringify(p)); }
    catch (e) { return JSON.parse(JSON.stringify(p)); }
  }

  /**
   * @param {string} url getPeakPowerRanking 요청 URL
   * @returns {Promise<object|null>} 개인화된 응답(스냅샷 hit) 또는 null(→ Cloud Run 사용)
   */
  function stelvioRankingSnapshotTry(url) {
    if (window.__stelvioRankingSnapshotOff === true) return Promise.resolve(null);
    var info = parseRankingUrl(url);
    if (!info) return Promise.resolve(null);
    return fetchSnapshot(info).then(function (shared) {
      if (!shared) return null;
      var payload = clonePayload(shared);
      attachCurrentUser(payload, info.uid);
      payload.readSource = 'supabase_snapshot';
      return attachGcViewerAxis(payload, info).then(function () { return payload; });
    }).catch(function () { return null; });
  }

  var originalFetch = window.fetch.bind(window);
  window.stelvioRankingSnapshotTry = stelvioRankingSnapshotTry;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    if (!url || String(url).indexOf('getPeakPowerRanking') < 0 || (init && init.method && init.method !== 'GET')) {
      return originalFetch(input, init);
    }
    return stelvioRankingSnapshotTry(url).then(function (payload) {
      if (!payload) return originalFetch(input, init);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Stelvio-Read-Source': 'supabase_snapshot' }
      });
    });
  };
})();
