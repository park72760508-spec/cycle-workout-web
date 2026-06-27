/**
 * Strava 로그 Firestore read 최적화.
 * 1년 range query 대신 sync 대상 activity id만 doc.get / getAll.
 *
 * 갭 탐지: Firestore 문서 존재 ≠ Supabase rides 동기화 완료.
 * Supabase-primary(Phase 4)에서는 syncFirestoreSupabaseRidesGapsForUser로 보정.
 */
const BATCH_GET_SIZE = 100;

function normalizeActivityIds(activityIds) {
  return [...new Set((activityIds || []).map((id) => String(id).trim()).filter(Boolean))];
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} userId
 * @param {Array<string|number>} activityIds
 * @param {{ supabaseDualWriteServer?: object }} [options]
 * @returns {Promise<{ ids: Set<string>, docMap: Map<string, { ref: import('firebase-admin').firestore.DocumentReference, data: object }>, readCount: number }>}
 */
async function getExistingStravaLogDocsByActivityIds(db, userId, activityIds, options = {}) {
  const ids = new Set();
  const docMap = new Map();
  const unique = normalizeActivityIds(activityIds);
  if (!userId || unique.length === 0) {
    return { ids, docMap, readCount: 0 };
  }

  const logsRef = db.collection("users").doc(userId).collection("logs");
  let readCount = 0;
  for (let i = 0; i < unique.length; i += BATCH_GET_SIZE) {
    const chunk = unique.slice(i, i + BATCH_GET_SIZE);
    const refs = chunk.map((id) => logsRef.doc(id));
    const snaps = await db.getAll(...refs);
    readCount += snaps.length;
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      const source = String(data.source || "").toLowerCase();
      if (source && source !== "strava") continue;
      const actId = data.activity_id ? String(data.activity_id) : snap.id;
      ids.add(actId);
      docMap.set(actId, { ref: snap.ref, data });
    }
  }

  const sbServer = options.supabaseDualWriteServer;
  if (
    sbServer &&
    typeof sbServer.isPhase4FirestoreLogShadowStopped === "function" &&
    sbServer.isPhase4FirestoreLogShadowStopped() &&
    typeof sbServer.fetchStravaActivityIdsExistForUser === "function"
  ) {
    const missing = unique.filter((id) => !ids.has(id));
    if (missing.length > 0) {
      try {
        const sbIds = await sbServer.fetchStravaActivityIdsExistForUser(userId, missing);
        for (const id of sbIds) ids.add(String(id));
      } catch (e) {
        console.warn("[stravaLogRead] supabase id check failed:", userId, e.message || e);
      }
    }
  }

  return { ids, docMap, readCount };
}

/** @param {import('firebase-admin').firestore.Firestore} db @param {string} userId @param {string|number} activityId */
async function hasStravaActivityLog(db, userId, activityId, options = {}) {
  const { ids } = await getExistingStravaLogDocsByActivityIds(db, userId, [activityId], options);
  return ids.has(String(activityId));
}

module.exports = {
  BATCH_GET_SIZE,
  getExistingStravaLogDocsByActivityIds,
  hasStravaActivityLog,
};
