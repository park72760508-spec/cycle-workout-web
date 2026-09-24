/**
 * 비용 절감 3단계(2026-09): 랭킹보드(getPeakPowerRanking) 공용 스냅샷 우선 읽기.
 *
 * 랭킹은 배치 구간(GC 01:15·03:30 / 피크·독주 01:00·03:15) 동안 모든 사용자에게 같다.
 * Cloud Run 이 구간당 처음 계산할 때 뷰어 개인화 전 응답을 Supabase ranking_board_snapshots 에
 * 저장하므로(functions/rankingBoardSnapshots.js), 같은 epoch 스냅샷이 있으면 Cloud Run 대신
 * Supabase 에서 읽고 본인 행(currentUser)·동기부여 메시지·GC 뷰어 7축만 여기서 붙인다.
 * 스냅샷이 없거나 실패하면 null → 호출부가 기존 Cloud Run 요청을 그대로 보낸다(그 요청이 스냅샷을 채움).
 *
 * 4단계: 실시간 보드(TSS·30일 거리·클럽 거리)·주간 TOP10(getWeeklyRanking)은 배치 경계 대신
 * Supabase 변경 신호(ranking_build_meta: ranking_metrics_live·open_rides_live·master_daily_rebuild)로
 * epoch 를 만든다 — 데이터가 바뀔 때만 Cloud Run 이 한 번 계산한다.
 * 랭킹 설정·빌드 메타(getRankingReadRoutingPublic·getRankingBuildMetaPublic)는 공개 RPC
 * fn_ranking_public_meta 로 대체하고 마지막 응답을 localStorage 에 캐시한다(실패 시 폴백).
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
  var LIVE_DURATIONS = ['tss', 'personal_dist', 'group_dist'];
  /** functions/supabaseRankingReader.js LIVE_BOARD_META_KEYS 와 같은 순서 */
  var LIVE_META_KEYS = ['ranking_metrics_live', 'open_rides_live', 'master_daily_rebuild'];
  var META_MEMO_MS = 3000;
  var META_LS_KEY = 'stelvio_ranking_public_meta_v1';
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

  function isLiveDuration(d) { return LIVE_DURATIONS.indexOf(d) >= 0; }

  function parseRankingUrl(url) {
    try {
      var u = new URL(String(url), window.location.href);
      if (u.hostname.indexOf('cloudfunctions.net') < 0) return null;
      var q = u.searchParams;
      if (u.pathname.indexOf('getWeeklyRanking') >= 0) {
        return {
          weekly: true,
          live: true,
          uid: q.get('userId') || '',
          key: 'weekly_top10|' + (q.get('week') === 'prev' ? 'prev' : 'current')
        };
      }
      if (u.pathname.indexOf('getPeakPowerRanking') < 0) return null;
      if (q.get('parity') === '1' || q.get('parity') === 'true') return null;
      var duration = q.get('duration') || '5min';
      var live = isLiveDuration(duration);
      var boundaries = boundariesFor(duration);
      if (!boundaries && !live) return null;
      var period = q.get('period') || 'monthly';
      if (period === 'yearly') period = 'monthly';
      var gender = q.get('gender') || 'all';
      return {
        duration: duration,
        gender: gender,
        live: live,
        uid: q.get('uid') || '',
        key: period + '|' + duration + '|' + gender,
        epoch: live ? null : currentBatchEpochKeyKst(boundaries)
      };
    } catch (e) {
      return null;
    }
  }

  function supabaseCfg() {
    var c = window.STELVIO_SUPABASE_CONFIG || window.__STELVIO_SUPABASE__ || {};
    return c.supabaseUrl && c.supabaseAnonKey ? c : null;
  }

  /* ---- 공개 메타 RPC(fn_ranking_public_meta) — 라우팅·빌드 메타·live epoch 공용 ---- */
  var metaMemo = { at: 0, promise: null };

  function fetchPublicMetaRaw() {
    var now = Date.now();
    if (metaMemo.promise && now - metaMemo.at < META_MEMO_MS) return metaMemo.promise;
    var cfg = supabaseCfg();
    if (!cfg) return Promise.resolve(null);
    var p = originalFetch(cfg.supabaseUrl + '/rest/v1/rpc/fn_ranking_public_meta', {
      method: 'POST',
      headers: {
        apikey: cfg.supabaseAnonKey,
        Authorization: 'Bearer ' + cfg.supabaseAnonKey,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: '{}'
    }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (j) {
      if (!j || j.success !== true || !Array.isArray(j.rows)) return null;
      try { localStorage.setItem(META_LS_KEY, JSON.stringify({ at: Date.now(), meta: j })); } catch (e) {}
      return j;
    }).catch(function () { return null; });
    p.then(function (v) { if (!v) metaMemo = { at: 0, promise: null }; });
    metaMemo = { at: now, promise: p };
    return p;
  }

  /** 네트워크 실패 시 마지막으로 받은 메타(24시간 이내) */
  function cachedPublicMeta() {
    try {
      var o = JSON.parse(localStorage.getItem(META_LS_KEY) || 'null');
      if (o && o.meta && Date.now() - Number(o.at || 0) < 24 * 60 * 60 * 1000) return o.meta;
    } catch (e) {}
    return null;
  }

  /* 데이터 변경 신호(Realtime) 직후 재조회가 옛 메타를 쓰지 않게 */
  window.addEventListener('stelvio-ranking-metrics-live', function () { metaMemo = { at: 0, promise: null }; });

  function metaMs(iso) {
    if (!iso) return 0;
    var t = Date.parse(String(iso));
    return isFinite(t) ? t : 0;
  }

  function kstTodayYmd() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  }

  /** functions/supabaseRankingReader.js fetchLiveBoardEpochKst 와 동일 문자열 */
  function fetchLiveEpoch() {
    return fetchPublicMetaRaw().then(function (j) {
      if (!j) return null;
      var byKey = {};
      j.rows.forEach(function (r) { if (r && r.meta_key) byKey[r.meta_key] = metaMs(r.completed_at); });
      return [kstTodayYmd()].concat(LIVE_META_KEYS.map(function (k) { return byKey[k] || 0; })).join('@');
    });
  }

  /** functions/rankingBuildMetaSupabase.js buildRankingBuildMetaPayload 와 동일 */
  function buildMetaFromRows(rows) {
    var byKey = {};
    (rows || []).forEach(function (r) { if (r && r.meta_key) byKey[r.meta_key] = r; });
    function shape(row) {
      if (!row) return null;
      return {
        dateKst: row.date_kst ? String(row.date_kst).slice(0, 10) : '',
        status: row.status || 'complete',
        version: row.version != null ? Number(row.version) : null,
        completedAt: row.completed_at
      };
    }
    var master = shape(byKey.master_daily_rebuild);
    var heptagon = shape(byKey.heptagon_daily_rebuild);
    var personalSpeed = shape(byKey.personal_speed_logic);
    var peak28d = shape(byKey.peak_28d_board_refresh);
    var rankingMetricsLive = shape(byKey.ranking_metrics_live);
    var pv = byKey.run_privacy_version;
    var fingerprint = [
      'm:' + String((master && master.dateKst) || '') + ':' + metaMs(master && master.completedAt),
      'h:' + String((heptagon && heptagon.dateKst) || '') + ':' + String((heptagon && heptagon.status) || '') + ':' +
        metaMs(heptagon && heptagon.completedAt),
      'ps:' + String(personalSpeed && personalSpeed.version != null ? personalSpeed.version : ''),
      'pk:' + String((peak28d && peak28d.dateKst) || '') + ':' + String((peak28d && peak28d.status) || '') + ':' +
        metaMs(peak28d && peak28d.completedAt),
      'live:' + metaMs(rankingMetricsLive && rankingMetricsLive.completedAt)
    ].join('|');
    return {
      master: master, heptagon: heptagon, personalSpeed: personalSpeed, peak28d: peak28d,
      rankingMetricsLive: rankingMetricsLive,
      runPrivacyVersion: pv && pv.version != null ? Number(pv.version) : 0,
      fingerprint: fingerprint
    };
  }

  /** getRankingReadRoutingPublic · getRankingBuildMetaPublic 응답과 같은 모양 */
  function publicMetaResponse(kind, j) {
    var bm = buildMetaFromRows(j.rows);
    if (kind === 'buildMeta') {
      return {
        success: true,
        buildMetaSource: 'supabase',
        buildMeta: {
          master: bm.master, heptagon: bm.heptagon, personalSpeed: bm.personalSpeed, peak28d: bm.peak28d,
          rankingMetricsLive: bm.rankingMetricsLive
        },
        buildMetaFingerprint: bm.fingerprint || '',
        runPrivacyVersion: bm.runPrivacyVersion || 0
      };
    }
    var readSource = j.useSupabaseGlobal ? 'supabase' : 'firebase';
    var out = {
      success: true,
      readSource: readSource,
      useSupabaseGlobal: j.useSupabaseGlobal === true,
      parityFallbackToFirebase: j.parityFallbackToFirebase === true,
      note: '클라이언트 IndexedDB·getPeakPowerRanking 캐시 네임스페이스 분리용. Supabase Read 시 서버가 Supabase MV에서 응답합니다.'
    };
    if (readSource === 'supabase') {
      out.buildMetaSource = 'supabase';
      out.buildMeta = { master: bm.master, heptagon: bm.heptagon, personalSpeed: bm.personalSpeed, peak28d: bm.peak28d };
      out.buildMetaFingerprint = bm.fingerprint || '';
    }
    return out;
  }

  function publicMetaKindForUrl(url) {
    var s = String(url || '');
    if (s.indexOf('cloudfunctions.net') < 0) return null;
    if (s.indexOf('/getRankingReadRoutingPublic') >= 0) return 'routing';
    if (s.indexOf('/getRankingBuildMetaPublic') >= 0) return 'buildMeta';
    return null;
  }

  /** @returns {Promise<object|null>} 기존 공개 API 와 같은 JSON(RPC → localStorage 캐시), 실패 시 null */
  function stelvioRankingPublicMetaTry(kind) {
    if (window.__stelvioRankingSnapshotOff === true) return Promise.resolve(null);
    return fetchPublicMetaRaw().then(function (j) {
      var m = j || cachedPublicMeta();
      return m ? publicMetaResponse(kind, m) : null;
    }).catch(function () { return null; });
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
  /** 행 복사(스냅샷 전용 _origRank 제거) — 순위는 목록과 같은 탈퇴자 필터 후 값 */
  function withOrigRank(row) {
    if (!row) return row;
    var o = Object.assign({}, row);
    delete o._origRank;
    return o;
  }

  /**
   * attachCurrentUserToPayload 와 동일 — 부문 배열에서 본인 행을 찾아 currentUser 로.
   * 순위는 목록 표시와 같은 탈퇴자 필터 후 값(현재 Cloud Run 응답과 동일).
   * 스냅샷 전용 필드 _origRank 는 모든 행에서 제거해 기존 응답과 같은 모양으로 맞춘다.
   */
  function attachCurrentUser(payload, uid) {
    if (uid && payload.byCategory) {
      outer: for (var i = 0; i < USER_LOOKUP_ORDER.length; i++) {
        var arr = payload.byCategory[USER_LOOKUP_ORDER[i]] || [];
        for (var j = 0; j < arr.length; j++) {
          if (arr[j] && String(arr[j].userId) === String(uid)) {
            var cur = withOrigRank(arr[j]);
            payload.currentUser = cur;
            payload.motivationMessage = buildMotivationMessage(cur, j > 0 ? withOrigRank(arr[j - 1]) : null);
            break outer;
          }
        }
      }
    }
    var cats = payload.byCategory ? Object.keys(payload.byCategory) : [];
    for (var c = 0; c < cats.length; c++) {
      var rows = payload.byCategory[cats[c]] || [];
      for (var k = 0; k < rows.length; k++) if (rows[k]) delete rows[k]._origRank;
    }
    if (Array.isArray(payload.entries)) {
      for (var e = 0; e < payload.entries.length; e++) if (payload.entries[e]) delete payload.entries[e]._origRank;
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
      /* 서버는 7축을 currentUser 부착 전에 붙이므로 currentUser 에는 넣지 않는다(기존 응답과 동일) */
    }).catch(function () {});
  }

  /** applyGroupRankingParticipationForViewer 와 동일 — 본인 세션일 때만(RPC fn_my_group_dist_participated_hosts) */
  function attachGroupParticipation(payload, info) {
    if (info.duration !== 'group_dist' || !info.uid) return Promise.resolve(true);
    if (info.uid !== currentFirebaseUid()) return Promise.resolve(false);
    var rpcP = typeof window.stelvioSupabaseRpc === 'function'
      ? Promise.resolve(window.stelvioSupabaseRpc)
      : import('/assets/js/supabaseDualWrite.js').then(function (m) { return m.callSupabaseRpcAsUser; });
    return rpcP.then(function (rpc) {
      return rpc('fn_my_group_dist_participated_hosts', { p_start: payload.startStr, p_end: payload.endStr });
    }).then(function (hosts) {
      if (!Array.isArray(hosts)) return false;
      var set = Object.create(null);
      hosts.forEach(function (h) { set[String(h).trim()] = true; });
      var mark = function (row) {
        if (row && row.userId) row.currentUserParticipated = !!set[String(row.userId).trim()];
      };
      ((payload.byCategory && payload.byCategory.Supremo) || []).forEach(mark);
      (payload.entries || []).forEach(mark);
      return true;
    }).catch(function () { return false; });
  }

  /** getWeeklyRanking 과 동일 — TOP10 밖이면 myRank(전체 행 순서 기준) */
  function personalizeWeekly(payload, uid) {
    var all = Array.isArray(payload.allEntriesLite) ? payload.allEntriesLite : [];
    delete payload.allEntriesLite;
    if (!uid) return;
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e && e.userId === uid) {
        if (i >= 10) {
          payload.myRank = {
            rank: i + 1,
            userId: e.userId,
            name: e.name,
            totalTss: e.totalTss,
            rankChange: e.rankChange,
            previousBoardRank: e.previousBoardRank,
            is_private: e.is_private === true,
            profileImageUrl: e.profileImageUrl || null
          };
        }
        return;
      }
    }
  }

  function clonePayload(p) {
    try { return typeof structuredClone === 'function' ? structuredClone(p) : JSON.parse(JSON.stringify(p)); }
    catch (e) { return JSON.parse(JSON.stringify(p)); }
  }

  /**
   * @param {string} url getPeakPowerRanking 요청 URL
   * @returns {Promise<object|null>} 개인화된 응답(스냅샷 hit) 또는 null(→ Cloud Run 사용)
   */
  /** 실시간 보드: 데이터 변경 직후 여러 기기가 동시에 놓치면 잠깐 기다렸다 한 번 더 확인(첫 계산분 재사용) */
  function fetchSnapshotWithEpoch(info) {
    if (!info.live) return fetchSnapshot(info);
    return fetchLiveEpoch().then(function (epoch) {
      if (!epoch) return null;
      info.epoch = epoch;
      return fetchSnapshot(info).then(function (shared) {
        if (shared) return shared;
        /* 이 보드 스냅샷이 아직 한 번도 없으면(서버 미배포·첫 요청) 기다리지 않고 바로 Cloud Run */
        return snapshotRowExists(info.key).then(function (exists) {
          if (!exists) return null;
          return new Promise(function (r) { setTimeout(r, 400 + Math.floor(Math.random() * 1200)); })
            .then(function () { return fetchSnapshot(info); });
        });
      });
    });
  }

  function snapshotRowExists(key) {
    var cfg = supabaseCfg();
    if (!cfg) return Promise.resolve(false);
    return originalFetch(cfg.supabaseUrl + '/rest/v1/ranking_board_snapshots?select=epoch&snapshot_key=eq.' + encodeURIComponent(key), {
      method: 'GET',
      headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey, Accept: 'application/json' }
    }).then(function (res) { return res.ok ? res.json() : []; })
      .then(function (rows) { return Array.isArray(rows) && rows.length > 0; })
      .catch(function () { return false; });
  }

  function stelvioRankingSnapshotTry(url) {
    if (window.__stelvioRankingSnapshotOff === true) return Promise.resolve(null);
    var info = parseRankingUrl(url);
    if (!info) return Promise.resolve(null);
    return fetchSnapshotWithEpoch(info).then(function (shared) {
      if (!shared) return null;
      var payload = clonePayload(shared);
      if (info.weekly) {
        personalizeWeekly(payload, info.uid);
        payload.readSource = 'supabase_snapshot';
        return payload;
      }
      return attachGroupParticipation(payload, info).then(function (ok) {
        if (!ok) return null; // 본인 참가 여부를 못 붙이면 기존 Cloud Run 응답 사용
        attachCurrentUser(payload, info.uid);
        payload.readSource = 'supabase_snapshot';
        return attachGcViewerAxis(payload, info).then(function () { return payload; });
      });
    }).catch(function () { return null; });
  }

  var originalFetch = window.fetch.bind(window);
  window.stelvioRankingSnapshotTry = stelvioRankingSnapshotTry;
  window.stelvioRankingPublicMetaTry = stelvioRankingPublicMetaTry;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    if (init && init.method && init.method !== 'GET') return originalFetch(input, init);
    var metaKind = url ? publicMetaKindForUrl(url) : null;
    if (metaKind) {
      return stelvioRankingPublicMetaTry(metaKind).then(function (json) {
        if (!json) return originalFetch(input, init);
        return new Response(JSON.stringify(json), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Stelvio-Read-Source': 'supabase_rpc' }
        });
      });
    }
    if (!url || (String(url).indexOf('getPeakPowerRanking') < 0 && String(url).indexOf('getWeeklyRanking') < 0)) {
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
