/**
 * Phase 6 — 훈련 로그 Read 라우팅 (appConfig/supabase_read_routing.useSupabaseLogsRead).
 */
const API_BASE = 'https://us-central1-stelvio-ai.cloudfunctions.net';
const LOGS_READ_ROUTING_URL = API_BASE + '/getLogsReadRoutingPublic';
const CACHE_MS = 60 * 1000;

/** @type {{ useSupabaseLogsRead: boolean, loadedAt: number, loading: Promise<boolean>|null }} */
const state = {
  useSupabaseLogsRead: false,
  loadedAt: 0,
  loading: null,
};

export function getLogsReadSourceSync() {
  return state.useSupabaseLogsRead ? 'supabase' : 'firebase';
}

export async function refreshLogsReadRouting(force = false) {
  const now = Date.now();
  if (!force && state.loadedAt > 0 && now - state.loadedAt < CACHE_MS) {
    return state.useSupabaseLogsRead;
  }
  if (state.loading && !force) return state.loading;

  state.loading = (async function () {
    try {
      const res = await fetch(LOGS_READ_ROUTING_URL, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
      });
      const json = res.ok ? await res.json().catch(function () { return null; }) : null;
      state.useSupabaseLogsRead = !!(json && json.success && json.useSupabaseLogsRead);
    } catch (e) {
      try {
        if (window.firestore) {
          const snap = await window.firestore
            .collection('appConfig')
            .doc('supabase_read_routing')
            .get();
          const d = snap.exists ? snap.data() : {};
          state.useSupabaseLogsRead = d.useSupabaseLogsRead === true;
        }
      } catch (_) {
        /* keep last */
      }
    }
    state.loadedAt = Date.now();
    return state.useSupabaseLogsRead;
  })();

  try {
    return await state.loading;
  } finally {
    state.loading = null;
  }
}

export async function shouldReadTrainingLogsFromSupabase() {
  await refreshLogsReadRouting(false);
  return state.useSupabaseLogsRead;
}

if (typeof window !== 'undefined') {
  window.refreshLogsReadRouting = refreshLogsReadRouting;
  window.getLogsReadSourceSync = getLogsReadSourceSync;
}
