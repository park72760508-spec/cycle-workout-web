/**
 * CYCLE 주간 TSS·개인 거리 랭킹 실시간 동기화 — Supabase ranking_build_meta Realtime (Firebase 미사용)
 * Auth Bridge 미사용: anon 키 + RLS SELECT — localStorage 세션 403(setSession) 회피
 */
(function (global) {
  'use strict';

  var LIVE_META_KEY = 'ranking_metrics_live';
  var DEBOUNCE_MS = 1500;
  var POLL_INTERVAL_MS = 20000;
  var BUILD_META_PUBLIC_URL =
    'https://us-central1-stelvio-ai.cloudfunctions.net/getRankingBuildMetaPublic';

  var channel = null;
  var debounceTimer = null;
  var pollTimer = null;
  var lastLiveTs = 0;
  var startInflight = null;
  var pollInflight = null;

  function getSupabaseConfig() {
    var c = global.STELVIO_SUPABASE_CONFIG || {};
    return {
      supabaseUrl: String(c.supabaseUrl || '').trim(),
      supabaseAnonKey: String(c.supabaseAnonKey || '').trim(),
    };
  }

  var supabaseAnonClientPromise = null;

  /** localStorage 공유 세션을 읽지 않음 — setSession /auth/v1/user 403 방지 */
  async function getSupabaseAnonClient() {
    var cfg = getSupabaseConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      throw new Error('STELVIO_SUPABASE_CONFIG 미설정');
    }
    if (!supabaseAnonClientPromise) {
      supabaseAnonClientPromise = (async function () {
        var mod = await import('https://esm.sh/@supabase/supabase-js@2.49.1');
        return mod.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });
      })();
    }
    return supabaseAnonClientPromise;
  }

  function parseLiveMetaTs(row) {
    if (!row) return 0;
    var iso = row.updated_at || row.completedAt || row.completed_at;
    if (!iso) return 0;
    var t = Date.parse(String(iso));
    return isFinite(t) ? t : 0;
  }

  function scheduleLiveDispatch(row) {
    var ts = parseLiveMetaTs(row);
    if (ts > 0 && ts <= lastLiveTs) return;
    if (ts > 0) lastLiveTs = ts;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      try {
        if (typeof global.stelvioHandleRankingMetricsLiveUpdate === 'function') {
          global.stelvioHandleRankingMetricsLiveUpdate({ source: 'realtime', metaKey: LIVE_META_KEY });
        }
        global.dispatchEvent(
          new CustomEvent('stelvio-ranking-metrics-live', {
            detail: { metaKey: LIVE_META_KEY, updatedAt: ts || Date.now() },
          })
        );
      } catch (eDisp) {
        console.warn('[StelvioRankingLive] dispatch 실패:', eDisp && eDisp.message);
      }
    }, DEBOUNCE_MS);
  }

  function shouldUseLiveSync() {
    if (typeof global.stelvioGetRankingReadSourceSync !== 'function') return false;
    return global.stelvioGetRankingReadSourceSync() === 'supabase';
  }

  async function fetchLiveMetaTsFromRest() {
    try {
      var supabase = await getSupabaseAnonClient();
      var res = await supabase
        .from('ranking_build_meta')
        .select('meta_key, updated_at, completed_at')
        .eq('meta_key', LIVE_META_KEY)
        .maybeSingle();
      if (res.data) return parseLiveMetaTs(res.data);
    } catch (_eRest) {}
    return 0;
  }

  async function fetchLiveMetaTsFromPublicApi() {
    try {
      var res = await fetch(BUILD_META_PUBLIC_URL, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
      });
      if (!res.ok) return 0;
      var json = await res.json().catch(function () {
        return null;
      });
      var live = json && json.buildMeta && json.buildMeta.rankingMetricsLive;
      return parseLiveMetaTs(live);
    } catch (_eApi) {
      return 0;
    }
  }

  async function pollLiveMetaOnce() {
    if (pollInflight) return pollInflight;
    pollInflight = (async function () {
      var ts = await fetchLiveMetaTsFromRest();
      if (!ts) ts = await fetchLiveMetaTsFromPublicApi();
      if (ts > lastLiveTs) {
        scheduleLiveDispatch({ updated_at: new Date(ts).toISOString() });
      } else if (ts > 0 && !lastLiveTs) {
        lastLiveTs = ts;
      }
    })().finally(function () {
      pollInflight = null;
    });
    return pollInflight;
  }

  function startPollingFallback() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (!shouldUseLiveSync()) return;
      pollLiveMetaOnce().catch(function () {});
    }, POLL_INTERVAL_MS);
    pollLiveMetaOnce().catch(function () {});
  }

  function stopPollingFallback() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function bootstrapLastLiveTs() {
    var ts = await fetchLiveMetaTsFromRest();
    if (!ts) ts = await fetchLiveMetaTsFromPublicApi();
    if (ts > 0) lastLiveTs = ts;
  }

  async function subscribeRealtime(supabase) {
    return new Promise(function (resolve) {
      var settled = false;
      var ch = supabase
        .channel('stelvio-ranking-metrics-live')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'ranking_build_meta',
            filter: 'meta_key=eq.' + LIVE_META_KEY,
          },
          function (payload) {
            scheduleLiveDispatch(payload && payload.new ? payload.new : null);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'ranking_build_meta',
            filter: 'meta_key=eq.' + LIVE_META_KEY,
          },
          function (payload) {
            scheduleLiveDispatch(payload && payload.new ? payload.new : null);
          }
        )
        .subscribe(function (status) {
          if (status === 'SUBSCRIBED') {
            console.log('[StelvioRankingLive] Realtime 구독 시작 —', LIVE_META_KEY);
            if (!settled) {
              settled = true;
              resolve({ ok: true, mode: 'realtime' });
            }
          } else if (
            (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') &&
            !settled
          ) {
            settled = true;
            resolve({ ok: false, mode: 'realtime', status: status });
          }
        });
      channel = ch;
      setTimeout(function () {
        if (!settled) {
          settled = true;
          resolve({ ok: false, mode: 'realtime', status: 'timeout' });
        }
      }, 8000);
    });
  }

  async function startRankingLiveSync() {
    if (!shouldUseLiveSync()) return { ok: false, reason: 'not_supabase_read' };
    if (channel || pollTimer) return { ok: true, reason: 'already_started' };
    if (startInflight) return startInflight;

    startInflight = (async function () {
      await bootstrapLastLiveTs();
      var realtimeOk = false;
      try {
        var supabase = await getSupabaseAnonClient();
        var sub = await subscribeRealtime(supabase);
        realtimeOk = !!(sub && sub.ok);
        if (!realtimeOk) {
          console.warn(
            '[StelvioRankingLive] Realtime 미연결 — 폴링으로 대체:',
            sub && sub.status ? sub.status : 'unknown'
          );
          if (channel && typeof channel.unsubscribe === 'function') {
            try {
              channel.unsubscribe();
            } catch (_eUn) {}
          }
          channel = null;
        }
      } catch (eRt) {
        console.warn('[StelvioRankingLive] Realtime 오류 — 폴링으로 대체:', eRt && eRt.message);
        channel = null;
      }
      startPollingFallback();
      return { ok: true, realtime: realtimeOk, polling: true };
    })().finally(function () {
      startInflight = null;
    });
    return startInflight;
  }

  function stopRankingLiveSync() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    stopPollingFallback();
    if (channel && typeof channel.unsubscribe === 'function') {
      try {
        channel.unsubscribe();
      } catch (_eUnsub) {}
    }
    channel = null;
  }

  global.stelvioStartRankingLiveSync = startRankingLiveSync;
  global.stelvioStopRankingLiveSync = stopRankingLiveSync;
  global.stelvioPollRankingMetricsLiveMeta = pollLiveMetaOnce;
})(typeof window !== 'undefined' ? window : globalThis);
