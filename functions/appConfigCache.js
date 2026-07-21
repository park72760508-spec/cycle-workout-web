/**
 * appConfig/{configKey} 조회 캐시 — Supabase app_config 미러 우선, 실패 시 Firestore 폴백.
 * Firestore는 admin 쓰기 원본으로 유지되고(onAppConfigWritten 트리거가 Supabase로 미러링),
 * 읽기만 이 헬퍼를 통해 Supabase로 옮겨 함수 인스턴스당 반복 조회 비용을 줄인다.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

const CACHE_MS = 60 * 1000;
/** @type {Map<string, { data: object, at: number }>} */
const cache = new Map();

/**
 * @param {import('firebase-admin')} admin
 * @param {string} configKey 예: 'strava' | 'sync'
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<object|null>}
 */
async function getAppConfigDocCached(admin, configKey, options = {}) {
  const now = Date.now();
  const hit = cache.get(configKey);
  if (!options.forceRefresh && hit && now - hit.at < CACHE_MS) {
    return hit.data;
  }

  try {
    const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("app_config")
      .select("data")
      .eq("config_key", configKey)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const value = data.data || {};
      cache.set(configKey, { data: value, at: now });
      return value;
    }
  } catch (err) {
    console.warn("[appConfigCache] Supabase 조회 실패, Firestore 폴백:", configKey, err && err.message ? err.message : err);
  }

  if (!admin || !admin.firestore) return hit ? hit.data : null;
  try {
    const snap = await admin.firestore().collection("appConfig").doc(configKey).get();
    const value = snap.exists ? snap.data() || {} : null;
    if (value) cache.set(configKey, { data: value, at: now });
    return value;
  } catch (err) {
    console.warn("[appConfigCache] Firestore 폴백도 실패:", configKey, err && err.message ? err.message : err);
    return hit ? hit.data : null;
  }
}

module.exports = { getAppConfigDocCached };
