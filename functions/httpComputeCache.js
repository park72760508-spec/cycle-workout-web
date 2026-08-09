/**
 * 짧은 TTL Firestore 캐시 — 동시에 몰리는 동일 요청(여러 유저의 폴링 등)이
 * 같은 비싼 계산을 반복하지 않도록 결과만 잠깐 재사용한다. 읽기/쓰기 실패는
 * 항상 무시하고 호출부가 정상 계산 경로로 폴백하므로 캐시 장애가 응답을 깨지 않는다.
 */
const CACHE_COLLECTION = "cache";
const CACHE_MAX_CHARS = 700000;

async function readComputeCache(admin, cacheKey, ttlMs) {
  try {
    const snap = await admin.firestore().collection(CACHE_COLLECTION).doc(cacheKey).get();
    if (!snap.exists) return null;
    const d = snap.data();
    if (!d || d.payload === undefined || !isFinite(Number(d.updatedAtMs))) return null;
    if (Date.now() - Number(d.updatedAtMs) > ttlMs) return null;
    return d.payload;
  } catch (err) {
    console.warn("[httpComputeCache] read failed:", cacheKey, err && err.message ? err.message : err);
    return null;
  }
}

async function writeComputeCache(admin, cacheKey, payload) {
  try {
    let serialized;
    try {
      serialized = JSON.stringify(payload);
    } catch (eSer) {
      return;
    }
    if (!serialized || serialized.length > CACHE_MAX_CHARS) return;
    /* undefined 필드가 있으면 Firestore.set()이 거부함 — JSON 왕복으로 제거(res.json()과 동일하게 undefined 키는 어차피 응답에도 안 나감) */
    const safePayload = JSON.parse(serialized);
    await admin
      .firestore()
      .collection(CACHE_COLLECTION)
      .doc(cacheKey)
      .set({ payload: safePayload, updatedAtMs: Date.now() });
  } catch (err) {
    console.warn("[httpComputeCache] write failed:", cacheKey, err && err.message ? err.message : err);
  }
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string} cacheKey
 * @param {number} ttlMs
 * @param {() => Promise<any>} computeFn 캐시 미스일 때만 실행되는 원본 계산
 * @param {string} [logLabel] 히트/미스 로그 태그(생략 시 로그 없음)
 */
async function withComputeCache(admin, cacheKey, ttlMs, computeFn, logLabel) {
  const t0 = Date.now();
  const cached = await readComputeCache(admin, cacheKey, ttlMs);
  if (cached !== null) {
    if (logLabel) console.log("[httpComputeCache] HIT", logLabel, cacheKey, "readMs=", Date.now() - t0);
    return cached;
  }
  const fresh = await computeFn();
  if (logLabel) console.log("[httpComputeCache] MISS", logLabel, cacheKey, "computeMs=", Date.now() - t0);
  if (fresh !== null && fresh !== undefined) {
    /* Cloud Run은 응답 전송 직후 백그라운드 실행을 보장하지 않으므로 fire-and-forget이면
       쓰기가 끊길 수 있다 — 반드시 await(응답까지의 지연은 미스 시에만, 수십~백여 ms 수준). */
    await writeComputeCache(admin, cacheKey, fresh).catch(function () {});
  }
  return fresh;
}

module.exports = {
  readComputeCache,
  writeComputeCache,
  withComputeCache,
};
