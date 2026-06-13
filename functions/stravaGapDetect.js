/**
 * Strava 갭 탐지형 일일 동기화.
 * - A: strava_sync_retry_pending === true
 * - B: strava_webhook_retries (status=pending)
 * - C: 어제~오늘 API 1페이지 vs Firestore id diff → 누락만 ingest
 */
const admin = require("firebase-admin");
const stravaSyncRetry = require("./stravaSyncRetry");
const stravaLogRead = require("./stravaLogRead");

const STRAVA_GAP_DETECT_PAGE_SIZE = 30;
const STRAVA_WEBHOOK_RETRIES_COLLECTION = "strava_webhook_retries";
const EXCLUDED_STRAVA_TYPES = new Set(["run", "swim", "walk", "trailrun", "weighttraining"]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isCyclingStravaListActivity(act) {
  if (!act) return false;
  const type = String(act.type || act.sport_type || "").trim().toLowerCase();
  if (!type) return true;
  return !EXCLUDED_STRAVA_TYPES.has(type);
}

function webhookRetryDocId(ownerId, objectId) {
  return `${Number(ownerId)}_${String(objectId)}`;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ ownerId: number, objectId: number, userId?: string|null, reason?: string, status?: number, error?: string }} entry
 */
async function enqueueStravaWebhookRetry(db, entry) {
  if (!db || entry.ownerId == null || entry.objectId == null) return;
  const docId = webhookRetryDocId(entry.ownerId, entry.objectId);
  const payload = {
    object_id: Number(entry.objectId),
    owner_id: Number(entry.ownerId),
    user_id: entry.userId ? String(entry.userId) : null,
    failed_at: new Date().toISOString(),
    reason: String(entry.reason || "webhook").slice(0, 40),
    status: Number(entry.status) || 500,
    error: entry.error ? String(entry.error).slice(0, 500) : null,
    status_queue: "pending",
    processed_at: null,
  };
  try {
    await db.collection(STRAVA_WEBHOOK_RETRIES_COLLECTION).doc(docId).set(payload, { merge: true });
  } catch (e) {
    console.warn("[stravaGapDetect] enqueue webhook retry failed:", docId, e.message || e);
  }
}

/** @param {import('firebase-admin').firestore.Firestore} db @param {number} ownerId @param {string|number} objectId */
async function markStravaWebhookRetryDone(db, ownerId, objectId) {
  if (!db || ownerId == null || objectId == null) return;
  const docId = webhookRetryDocId(ownerId, objectId);
  try {
    await db.collection(STRAVA_WEBHOOK_RETRIES_COLLECTION).doc(docId).set(
      {
        status_queue: "done",
        processed_at: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("[stravaGapDetect] mark webhook retry done failed:", docId, e.message || e);
  }
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ maxEntries?: number }} [options]
 */
async function listPendingStravaWebhookRetries(db, options = {}) {
  const maxEntries = Math.max(1, Math.min(1000, Number(options.maxEntries) || 500));
  const snap = await db
    .collection(STRAVA_WEBHOOK_RETRIES_COLLECTION)
    .where("status_queue", "==", "pending")
    .limit(maxEntries)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

/** @param {import('firebase-admin').firestore.Firestore} db */
async function listStravaConnectedUserIds(db) {
  const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
  return usersSnap.docs.map((d) => d.id);
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ dateFrom: string, dateTo: string, maxUsers?: number }} rangeOpts
 */
async function listPendingRetryUserIds(db, rangeOpts = {}) {
  const dateFrom = String(rangeOpts.dateFrom || "").slice(0, 10);
  const dateTo = String(rangeOpts.dateTo || dateFrom).slice(0, 10);
  const maxUsers = Math.max(1, Math.min(2000, Number(rangeOpts.maxUsers) || 1000));
  const snap = await db.collection("users").where("strava_sync_retry_pending", "==", true).limit(maxUsers).get();
  const out = [];
  for (const doc of snap.docs) {
    out.push(doc.id);
  }
  return out;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {number} athleteId
 */
async function resolveUserIdByAthleteId(db, athleteId) {
  const ownerIdNum = Number(athleteId);
  if (!ownerIdNum) return null;
  const snap = await db.collection("users").where("strava_athlete_id", "==", ownerIdNum).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} userId
 * @param {string[]} activityIds
 * @param {{ supabaseDualWriteServer?: object }} [options]
 */
async function getExistingStravaActivityIdsForActivityList(db, userId, activityIds, options = {}) {
  const { ids, readCount } = await stravaLogRead.getExistingStravaLogDocsByActivityIds(
    db,
    userId,
    activityIds,
    options
  );
  return { ids, readCount };
}

/** @deprecated date range query — gap detect는 getExistingStravaActivityIdsForActivityList 사용 */
async function getExistingStravaActivityIdsForDateRange(db, userId, dateFrom, dateTo) {
  const ids = new Set();
  const from = String(dateFrom || "").slice(0, 10);
  const to = String(dateTo || from).slice(0, 10);
  if (!userId || !from || !to) return ids;
  const snap = await db
    .collection("users")
    .doc(userId)
    .collection("logs")
    .where("source", "==", "strava")
    .where("date", ">=", from)
    .where("date", "<=", to)
    .get();
  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.activity_id) ids.add(String(data.activity_id));
  });
  return ids;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ includeGapScanAllUsers?: boolean, maxUsers?: number }} options
 * @param {{ dateFrom: string, dateTo: string }} range
 */
async function buildGapDetectWorklist(db, range, options = {}) {
  const includeGapScanAllUsers = options.includeGapScanAllUsers !== false;
  /** @type {Map<string, { userId: string, explicitActivityIds: Set<string>, needsGapScan: boolean, sources: Set<string>, webhookEntries: Array<{ owner_id: number, object_id: number }> }>} */
  const worklist = new Map();

  function ensureUser(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return null;
    if (!worklist.has(uid)) {
      worklist.set(uid, {
        userId: uid,
        explicitActivityIds: new Set(),
        needsGapScan: false,
        sources: new Set(),
        webhookEntries: [],
      });
    }
    return worklist.get(uid);
  }

  const pendingUserIds = await listPendingRetryUserIds(db, {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    maxUsers: options.maxUsers,
  });
  for (const uid of pendingUserIds) {
    const entry = ensureUser(uid);
    if (!entry) continue;
    entry.sources.add("A_pending");
    const userSnap = await db.collection("users").doc(uid).get();
    const retryActivityId = String((userSnap.data() || {}).strava_sync_retry_activity_id || "").trim();
    if (retryActivityId) {
      entry.explicitActivityIds.add(retryActivityId);
    } else {
      entry.needsGapScan = true;
    }
  }

  const webhookRows = await listPendingStravaWebhookRetries(db, { maxEntries: options.maxUsers || 500 });
  for (const row of webhookRows) {
    const objectId = String(row.object_id || "").trim();
    const ownerId = Number(row.owner_id);
    if (!objectId || !ownerId) continue;
    let uid = String(row.user_id || "").trim();
    if (!uid) uid = (await resolveUserIdByAthleteId(db, ownerId)) || "";
    const entry = ensureUser(uid);
    if (!entry) continue;
    entry.sources.add("B_webhook");
    entry.explicitActivityIds.add(objectId);
    entry.webhookEntries.push({ owner_id: ownerId, object_id: Number(objectId) });
  }

  if (includeGapScanAllUsers) {
    const allUserIds = await listStravaConnectedUserIds(db);
    for (const uid of allUserIds) {
      const entry = ensureUser(uid);
      if (!entry) continue;
      entry.sources.add("C_gap_scan");
      entry.needsGapScan = true;
    }
  }

  return worklist;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} userId
 * @param {object} userData
 * @param {{ afterUnix: number, beforeUnix: number, dateFrom: string, dateTo: string }} range
 * @param {{ refreshStravaTokenForUser: Function, fetchStravaActivitiesPage: Function }} deps
 */
async function detectMissingActivityIdsForUser(db, userId, userData, range, deps) {
  let accessToken = userData.strava_access_token || "";
  const tokenExpiresAt = Number(userData.strava_expires_at || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!accessToken || tokenExpiresAt < nowSec + 300) {
    const tokenResult = await deps.refreshStravaTokenForUser(db, userId);
    accessToken = tokenResult.accessToken;
  }

  let pageRes = await deps.fetchStravaActivitiesPage(
    accessToken,
    range.afterUnix,
    range.beforeUnix,
    1,
    STRAVA_GAP_DETECT_PAGE_SIZE
  );
  if (!pageRes.success && pageRes.status === 401) {
    const tokenResult = await deps.refreshStravaTokenForUser(db, userId);
    accessToken = tokenResult.accessToken;
    pageRes = await deps.fetchStravaActivitiesPage(
      accessToken,
      range.afterUnix,
      range.beforeUnix,
      1,
      STRAVA_GAP_DETECT_PAGE_SIZE
    );
  }
  if (!pageRes.success) {
    return {
      missingIds: [],
      error: pageRes.error || `활동 목록 조회 실패: ${pageRes.status || 0}`,
      status: pageRes.status || 0,
      apiCount: 1,
    };
  }

  const listIds = [];
  for (const act of Array.isArray(pageRes.activities) ? pageRes.activities : []) {
    if (!isCyclingStravaListActivity(act)) continue;
    const actId = act && act.id != null ? String(act.id) : "";
    if (actId) listIds.push(actId);
  }
  if (listIds.length === 0) {
    return { missingIds: [], apiCount: 1, listCount: 0 };
  }

  const { ids: existingIds, readCount } = await getExistingStravaActivityIdsForActivityList(
    db,
    userId,
    listIds,
    deps && deps.supabaseDualWriteServer ? { supabaseDualWriteServer: deps.supabaseDualWriteServer } : {}
  );
  const missingIds = listIds.filter((id) => !existingIds.has(id));
  return { missingIds, apiCount: 1, listCount: listIds.length, logReadCount: readCount };
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ afterUnix: number, beforeUnix: number, dateFrom: string, dateTo: string }} range
 * @param {object} deps
 * @param {string} logPrefix
 * @param {{ includeGapScanAllUsers?: boolean, maxUsers?: number }} [options]
 */
async function runGapDetectSyncJob(db, range, deps, logPrefix, options = {}) {
  const prefix = logPrefix || "[stravaGapDetect]";
  const worklist = await buildGapDetectWorklist(db, range, options);
  const userEntries = Array.from(worklist.values());

  console.log(`${prefix} 시작`, {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    users: userEntries.length,
    gapScanAll: options.includeGapScanAllUsers !== false,
  });

  if (userEntries.length === 0) {
    console.log(`${prefix} 처리 대상 없음`);
    return { users: 0, ok: 0, fail: 0, ingested: 0, apiCalls: 0, results: [] };
  }

  const concurrency = stravaSyncRetry.STRAVA_SYNC_CONCURRENCY_SAFE;
  const results = [];
  let ok = 0;
  let fail = 0;
  let ingested = 0;
  let apiCalls = 0;

  async function processOneUser(entry) {
    const userSnap = await db.collection("users").doc(entry.userId).get();
    if (!userSnap.exists) {
      return { userId: entry.userId, skipped: true, reason: "user_not_found" };
    }
    const userData = userSnap.data() || {};
    const athleteId = Number(userData.strava_athlete_id);
    const activityIds = new Set(entry.explicitActivityIds);
    let gapError = null;
    let gapStatus = 0;

    if (entry.needsGapScan) {
      try {
        const gap = await detectMissingActivityIdsForUser(db, entry.userId, userData, range, deps);
        apiCalls += gap.apiCount || 1;
        if (gap.error) {
          gapError = gap.error;
          gapStatus = gap.status || 0;
        } else {
          (gap.missingIds || []).forEach((id) => activityIds.add(id));
        }
      } catch (e) {
        gapError = e && e.message ? e.message : String(e);
      }
    }

    if (activityIds.size === 0) {
      if (gapError) {
        await stravaSyncRetry.markStravaSyncRetryPending(db, entry.userId, {
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          afterUnix: range.afterUnix,
          beforeUnix: range.beforeUnix,
          reason: gapStatus === 429 ? "429" : "processing",
          status: gapStatus || 500,
        });
        return { userId: entry.userId, sources: Array.from(entry.sources), error: gapError, ingested: 0 };
      }
      if (entry.sources.has("A_pending") && !gapError) {
        await stravaSyncRetry.clearStravaSyncRetryPending(db, entry.userId, { count: 0 });
      }
      return {
        userId: entry.userId,
        sources: Array.from(entry.sources),
        ingested: 0,
        gapListCount: 0,
        note: gapError ? "gap_scan_failed_no_ids" : "no_missing_ids",
        error: gapError || null,
      };
    }

    if (!athleteId) {
      return { userId: entry.userId, error: "strava_athlete_id 없음", ingested: 0 };
    }

    let userIngested = 0;
    let lastError = gapError || null;
    const runningModule = require("./processRunningActivity");
    for (const activityId of activityIds) {
      let legacyResult;
      try {
        const preview = await runningModule.fetchStravaActivityDetailForOwner(db, athleteId, activityId);
        if (
          preview.success &&
          preview.activity &&
          runningModule.isRunningStravaActivityType(preview.activity.type, preview.activity.sport_type)
        ) {
          await runningModule.processRunningActivity(db, athleteId, activityId, preview.activity);
          userIngested += 1;
          await markStravaWebhookRetryDone(db, athleteId, activityId);
          continue;
        }
        legacyResult = await deps.processStravaActivity(db, athleteId, activityId);
      } catch (e) {
        lastError = e && e.message ? e.message : String(e);
        break;
      }
      if (!legacyResult || legacyResult.error) {
        lastError = (legacyResult && legacyResult.error) || "processStravaActivity 실패";
        await stravaSyncRetry.markStravaSyncRetryPending(db, entry.userId, {
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          afterUnix: range.afterUnix,
          beforeUnix: range.beforeUnix,
          reason: "processing",
          status: (legacyResult && legacyResult.status) || 500,
          activityId,
        });
        break;
      }
      userIngested += 1;
      await markStravaWebhookRetryDone(db, athleteId, activityId);
    }

    if (!lastError) {
      await stravaSyncRetry.clearStravaSyncRetryPending(db, entry.userId, { count: userIngested });
      for (const wh of entry.webhookEntries) {
        await markStravaWebhookRetryDone(db, wh.owner_id, wh.object_id);
      }
    }

    return {
      userId: entry.userId,
      sources: Array.from(entry.sources),
      ingested: userIngested,
      activityCount: activityIds.size,
      error: lastError,
    };
  }

  for (let i = 0; i < userEntries.length; i += concurrency) {
    const batch = userEntries.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map((entry) => processOneUser(entry)));
    for (const s of settled) {
      const result =
        s.status === "fulfilled"
          ? s.value
          : {
              userId: "(unknown)",
              error: s.reason && s.reason.message ? s.reason.message : String(s.reason),
              ingested: 0,
            };
      results.push(result);
      if (result.error && !result.skipped) fail += 1;
      else if (!result.skipped) ok += 1;
      ingested += Number(result.ingested) || 0;
      console.log(`${prefix} user`, result.userId, {
        sources: result.sources,
        ingested: result.ingested,
        error: result.error || null,
      });
    }
    if (i + concurrency < userEntries.length) {
      await sleep(stravaSyncRetry.STRAVA_USER_BATCH_DELAY_MS);
    }
  }

  console.log(`${prefix} 완료`, { users: userEntries.length, ok, fail, ingested, apiCalls });
  return { users: userEntries.length, ok, fail, ingested, apiCalls, results };
}

module.exports = {
  STRAVA_GAP_DETECT_PAGE_SIZE,
  STRAVA_WEBHOOK_RETRIES_COLLECTION,
  enqueueStravaWebhookRetry,
  markStravaWebhookRetryDone,
  listPendingStravaWebhookRetries,
  listPendingRetryUserIds,
  buildGapDetectWorklist,
  detectMissingActivityIdsForUser,
  getExistingStravaActivityIdsForActivityList,
  getExistingStravaActivityIdsForDateRange,
  runGapDetectSyncJob,
};
