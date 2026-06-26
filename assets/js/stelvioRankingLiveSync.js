/**
 * CYCLE 주간 TSS 랭킹 실시간 동기화 — Supabase ranking_build_meta Realtime (Firebase 미사용)
 */
(function (global) {
  'use strict';

  var LIVE_META_KEY = 'ranking_metrics_live';
  var DEBOUNCE_MS = 1500;
  var channel = null;
  var debounceTimer = null;
  var lastLiveTs = 0;
  var startInflight = null;

  function getSupabaseConfig() {
    var c = global.STELVIO_SUPABASE_CONFIG || {};
    return {
      supabaseUrl: String(c.supabaseUrl || '').trim(),
      supabaseAnonKey: String(c.supabaseAnonKey || '').trim(),
      authBridgeUrl: String(c.authBridgeUrl || '').trim(),
    };
  }

  var supabaseClientPromise = null;

  async function getSupabaseClient() {
    var cfg = getSupabaseConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      throw new Error('STELVIO_SUPABASE_CONFIG 미설정');
    }
    if (!supabaseClientPromise) {
      supabaseClientPromise = (async function () {
        var mod = await import('https://esm.sh/@supabase/supabase-js@2.49.1');
        return mod.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            storage: typeof global.localStorage !== 'undefined' ? global.localStorage : undefined,
          },
        });
      })();
    }
    return supabaseClientPromise;
  }

  async function getFirebaseIdToken() {
    var user =
      (global.authV9 && global.authV9.currentUser) ||
      (global.auth && global.auth.currentUser) ||
      null;
    if (!user || typeof user.getIdToken !== 'function') {
      throw new Error('Firebase 로그인 세션이 없습니다.');
    }
    return user.getIdToken(false);
  }

  async function ensureSupabaseSession() {
    var cfg = getSupabaseConfig();
    if (!cfg.authBridgeUrl) throw new Error('authBridgeUrl 미설정');
    var supabase = await getSupabaseClient();
    var existing = await supabase.auth.getSession();
    if (
      existing.data.session &&
      existing.data.session.expires_at &&
      existing.data.session.expires_at > Math.floor(Date.now() / 1000) + 120
    ) {
      return supabase;
    }
    var bridgeUrl = cfg.authBridgeUrl.replace(/\/+$/, '');
    var idToken = await getFirebaseIdToken();
    var res = await fetch(bridgeUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + idToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({}),
    });
    var body = {};
    try {
      body = await res.json();
    } catch (_e) {
      body = {};
    }
    if (!res.ok || !body.success || !body.session || !body.session.access_token) {
      throw new Error((body.error && body.error.message) || 'Auth bridge HTTP ' + res.status);
    }
    var setResult = await supabase.auth.setSession({
      access_token: body.session.access_token,
      refresh_token: body.session.refresh_token,
    });
    if (setResult.error || !setResult.data.session) {
      throw new Error('Supabase setSession 실패');
    }
    return supabase;
  }

  function parseLiveMetaTs(row) {
    if (!row) return 0;
    var iso = row.updated_at || row.completed_at;
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

  async function bootstrapLastLiveTs(supabase) {
    try {
      var res = await supabase
        .from('ranking_build_meta')
        .select('meta_key, updated_at, completed_at')
        .eq('meta_key', LIVE_META_KEY)
        .maybeSingle();
      if (res.data) lastLiveTs = parseLiveMetaTs(res.data);
    } catch (_eBoot) {}
  }

  async function startRankingLiveSync() {
    if (!shouldUseLiveSync()) return { ok: false, reason: 'not_supabase_read' };
    if (channel) return { ok: true, reason: 'already_subscribed' };
    if (startInflight) return startInflight;

    startInflight = (async function () {
      try {
        var supabase = await ensureSupabaseSession();
        await bootstrapLastLiveTs(supabase);
        channel = supabase
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
            }
          });
        return { ok: true };
      } catch (eStart) {
        console.warn('[StelvioRankingLive] 구독 실패(폴링·수동 갱신으로 대체):', eStart && eStart.message);
        return { ok: false, error: eStart && eStart.message };
      } finally {
        startInflight = null;
      }
    })();
    return startInflight;
  }

  function stopRankingLiveSync() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (channel && typeof channel.unsubscribe === 'function') {
      try {
        channel.unsubscribe();
      } catch (_eUnsub) {}
    }
    channel = null;
  }

  global.stelvioStartRankingLiveSync = startRankingLiveSync;
  global.stelvioStopRankingLiveSync = stopRankingLiveSync;
})(typeof window !== 'undefined' ? window : globalThis);
