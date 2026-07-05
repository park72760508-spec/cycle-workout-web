/**
 * Phase 6 — 훈련 로그 Read 라우팅 (appConfig/supabase_read_routing.useSupabaseLogsRead).
 */
const API_BASE = 'https://us-central1-stelvio-ai.cloudfunctions.net';
const LOGS_READ_ROUTING_URL = API_BASE + '/getLogsReadRoutingPublic';
const CACHE_MS = 60 * 1000;

/** @type {{ useSupabaseLogsRead: boolean, parityFallbackToFirebase: boolean, loadedAt: number, loading: Promise<boolean>|null }} */
const state = {
  useSupabaseLogsRead: false,
  parityFallbackToFirebase: false,
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
      state.parityFallbackToFirebase = !!(json && json.success && json.parityFallbackToFirebase);
    } catch (e) {
      try {
        if (window.firestore) {
          const snap = await window.firestore
            .collection('appConfig')
            .doc('supabase_read_routing')
            .get();
          const d = snap.exists ? snap.data() : {};
          state.useSupabaseLogsRead = d.useSupabaseLogsRead === true;
          state.parityFallbackToFirebase = d.parityFallbackToFirebase === true;
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

/** Supabase cutover 시 users/logs 대량 Firestore 폴백(compat·orderBy limit) 허용 여부 */
export function shouldAllowFirestoreTrainingLogsBulkFallbackSync() {
  if (!state.useSupabaseLogsRead) return true;
  return state.parityFallbackToFirebase === true;
}

export async function shouldAllowFirestoreTrainingLogsBulkFallback() {
  await refreshLogsReadRouting(false);
  return shouldAllowFirestoreTrainingLogsBulkFallbackSync();
}

if (typeof window !== 'undefined') {
  window.refreshLogsReadRouting = refreshLogsReadRouting;
  window.getLogsReadSourceSync = getLogsReadSourceSync;
  window.shouldAllowFirestoreTrainingLogsBulkFallback = shouldAllowFirestoreTrainingLogsBulkFallback;
  window.shouldAllowFirestoreTrainingLogsBulkFallbackSync =
    shouldAllowFirestoreTrainingLogsBulkFallbackSync;
}
