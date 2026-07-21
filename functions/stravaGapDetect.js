/**
 * Strava 갭 탐지형 일일 동기화.
 * - A: strava_sync_retry_pending === true
 * - B: strava_webhook_retries (status=pending)
 * - C: 어제~오늘 API 페이지네이션 vs Supabase diff → 누락만 ingest
 *      · 사이클: rides (Firestore/Supabase rides)
 *      · Run/VirtualRun/TrailRun: public.activities
 */
const admin = require("firebase-admin");
const stravaSyncRetry = require("./stravaSyncRetry");
const stravaLogRead = require("./stravaLogRead");
const processRunningActivity = require("./processRunningActivity");

const STRAVA_GAP_DETECT_PAGE_SIZE = 200;
const STRAVA_GAP_DETECT_MAX_PAGES = 15;
const STRAVA_WEBHOOK_RETRIES_COLLECTION = "strava_webhook_retries";
const EXCLUDED_STRAVA_TYPES = new Set(["run", "swim", "walk", "trailrun", "weighttraining"]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Firestore logs ↔ Supabase rides 불일치 보정 (Strava API 재수집 없이 mirror) */
async function mirrorFirestoreSupabaseRidesGaps(db, userId, dateFrom, dateTo, supabaseDualWriteServer) {
  if (!db || !userId || !dateFrom || !dateTo || !supabaseDualWriteServer) {
    return { checked: 0, missing: 0, mirrored: 0, failed: 0 };
  }
  if (typeof supabaseDualWriteServer.syncFirestoreSupabaseRidesGapsForUser !== "function") {
    return { checked: 0, missing: 0, mirrored: 0, failed: 0 };
  }
  try {
    return await supabaseDualWriteServer.syncFirestoreSupabaseRidesGapsForUser(
      db,
      admin,
      userId,
      dateFrom,
      dateTo
    );
  } catch (e) {
    console.warn(
      "[stravaGapDetect] firestore→supabase rides gap mirror failed:",
      userId,
      e && e.message ? e.message : e
    );
    return { checked: 0, missing: 0, mirrored: 0, failed: 1, error: e && e.message ? e.message : String(e) };
  }
}

function isCyclingStravaListActivity(act) {
  if (!act) return false;
  if (processRunningActivity.isRunningStravaActivityType(act.type, act.sport_type)) {
    return false;
  }
  const type = String(act.type || act.sport_type || "").trim().toLowerCase();
  if (!type) return true;
  return !EXCLUDED_STRAVA_TYPES.has(type);
}

function classifyStravaListActivity(act) {
  if (!act || act.id == null) return null;
  const actId = String(act.id);
  if (processRunningActivity.isRunningStravaActivityType(act.type, act.sport_type)) {
    return { actId, kind: "running" };
  }
  if (isCyclingStravaListActivity(act)) {
    return { actId, kind: "cycling" };
  }
  return null;
}

function webhookRetryDocId(ownerId, objectId) {
  return `${Number(ownerId)}_${String(objectId)}`;
}

/**
 * strava_webhook_retries는 클라이언트가 접근하지 않는 백엔드 전용 재시도 큐라 Firestore 없이
 * Supabase(service_role)만으로 전량 이관했다(Firestore 읽기/쓰기 비용 절감). 롤백 시에는 호출부에서
 * db 인자를 다시 Firestore write 로직으로 되돌리면 된다(과거 구현은 git history 참고).
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

/**
 * @param {{ ownerId: number, objectId: number, userId?: string|null, reason?: string, status?: number, error?: string }} entry
 */
async function enqueueStravaWebhookRetry(_db, entry) {
  if (entry.ownerId == null || entry.objectId == null) return;
  const docId = webhookRetryDocId(entry.ownerId, entry.objectId);
  const payload = {
    id: docId,
    object_id: Number(entry.objectId),
    owner_id: Number(entry.ownerId),
    user_id: entry.userId ? String(entry.userId) : null,
    failed_at: new Date().toISOString(),
    reason: String(entry.reason || "webhook").slice(0, 40),
    status: Number(entry.status) || 500,
    error: entry.error ? String(entry.error).slice(0, 500) : null,
    status_queue: "pending",
    processed_at: null,
    updated_at: new Date().toISOString(),
  };
  try {
    const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
    const { error } = await supabase.from("strava_webhook_retries").upsert(payload, { onConflict: "id" });
    if (error) throw error;
  } catch (e) {
    console.warn("[stravaGapDetect] enqueue webhook retry failed:", docId, e.message || e);
  }
}

/** @param {number} ownerId @param {string|number} objectId */
async function markStravaWebhookRetryDone(_db, ownerId, objectId) {
  if (ownerId == null || objectId == null) return;
  const docId = webhookRetryDocId(ownerId, objectId);
  try {
    const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
    const { error } = await supabase
      .from("strava_webhook_retries")
      .update({
        status_queue: "done",
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", docId);
    if (error) throw error;
  } catch (e) {
    console.warn("[stravaGapDetect] mark webhook retry done failed:", docId, e.message || e);
  }
}

/**
 * @param {{ maxEntries?: number }} [options]
 */
async function listPendingStravaWebhookRetries(_db, options = {}) {
  const maxEntries = Math.max(1, Math.min(1000, Number(options.maxEntries) || 500));
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("strava_webhook_retries")
    .select("*")
    .eq("status_queue", "pending")
    .limit(maxEntries);
  if (error) {
    console.warn("[stravaGapDetect] listPendingStravaWebhookRetries failed:", error.message);
    return [];
  }
  return (data || []).map((row) => ({ id: row.id, ...row }));
}

const stravaConnectionReader = require("./stravaConnectionReader");

/** @param {import('firebase-admin').firestore.Firestore} db */
async function listStravaConnectedUserIds(db) {
  return stravaConnectionReader.listStravaConnectedFirebaseUids(db);
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
    const d = doc.data() || {};
    if (stravaSyncRetry.isStravaAuthInvalidUserData(d)) continue;
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
    try {
      const tokenResult = await deps.refreshStravaTokenForUser(db, userId);
      accessToken = tokenResult.accessToken;
    } catch (e) {
      const errMsg = e && e.message ? e.message : String(e);
      const authInvalidConfirmed = await stravaSyncRetry.isUserStravaAuthInvalidConfirmed(db, userId);
      return {
        missingIds: [],
        error: `토큰 갱신 실패: ${errMsg}`,
        status: 401,
        apiCount: 0,
        authInvalid: authInvalidConfirmed,
      };
    }
  }

  const cyclingListIds = [];
  const runningListIds = [];
  let page = 1;
  let apiCount = 0;
  let firstPageError = null;
  let firstPageStatus = 0;
  // 활동 목록 항목의 athlete.id로 실제 Strava athlete id를 파악한다 (strava_athlete_id 누락·불일치 자가복구용).
  let detectedAthleteId = 0;

  while (page <= STRAVA_GAP_DETECT_MAX_PAGES) {
    let pageRes = await stravaSyncRetry.fetchActivitiesPageWithOuter429Retry(
      deps.fetchStravaActivitiesPage,
      accessToken,
      range.afterUnix,
      range.beforeUnix,
      page,
      STRAVA_GAP_DETECT_PAGE_SIZE,
      `stravaGapDetect:${userId}:p${page}`
    );
    if (!pageRes.success && pageRes.status === 401) {
      const tokenResult = await deps.refreshStravaTokenForUser(db, userId);
      accessToken = tokenResult.accessToken;
      pageRes = await deps.fetchStravaActivitiesPage(
        accessToken,
        range.afterUnix,
        range.beforeUnix,
        page,
        STRAVA_GAP_DETECT_PAGE_SIZE
      );
    }
    apiCount += 1;
    if (!pageRes.success) {
      if (page === 1) {
        return {
          missingIds: [],
          error: pageRes.error || `활동 목록 조회 실패: ${pageRes.status || 0}`,
          status: pageRes.status || 0,
          apiCount,
        };
      }
      firstPageError = pageRes.error || `활동 목록 조회 실패: ${pageRes.status || 0}`;
      firstPageStatus = pageRes.status || 0;
      break;
    }

    const pageActivities = Array.isArray(pageRes.activities) ? pageRes.activities : [];
    for (const act of pageActivities) {
      if (!detectedAthleteId && act && act.athlete && act.athlete.id != null) {
        const aid = Number(act.athlete.id);
        if (Number.isFinite(aid) && aid > 0) detectedAthleteId = aid;
      }
      const classified = classifyStravaListActivity(act);
      if (!classified) continue;
      if (classified.kind === "running") runningListIds.push(classified.actId);
      else cyclingListIds.push(classified.actId);
    }
    if (pageActivities.length < STRAVA_GAP_DETECT_PAGE_SIZE) break;
    page += 1;
  }

  if (cyclingListIds.length === 0 && runningListIds.length === 0) {
    return {
      missingIds: [],
      missingCyclingIds: [],
      missingRunningIds: [],
      apiCount,
      listCount: 0,
      listCountCycling: 0,
      listCountRunning: 0,
      detectedAthleteId,
      error: firstPageError || null,
      status: firstPageStatus || 0,
    };
  }

  let existingCyclingIds = new Set();
  let readCount = 0;
  if (cyclingListIds.length > 0) {
    const cyclingExisting = await getExistingStravaActivityIdsForActivityList(
      db,
      userId,
      cyclingListIds,
      deps && deps.supabaseDualWriteServer ? { supabaseDualWriteServer: deps.supabaseDualWriteServer } : {}
    );
    existingCyclingIds = cyclingExisting.ids;
    readCount = cyclingExisting.readCount;
  }

  let existingRunningIds = new Set();
  const sbServer = deps && deps.supabaseDualWriteServer;
  if (runningListIds.length > 0 && sbServer && typeof sbServer.fetchStravaRunningActivityIdsExistForUser === "function") {
    try {
      existingRunningIds = await sbServer.fetchStravaRunningActivityIdsExistForUser(
        userId,
        runningListIds
      );
    } catch (e) {
      console.warn("[stravaGapDetect] supabase running id check failed:", userId, e.message || e);
    }
  }

  const missingCyclingIds = cyclingListIds.filter((id) => !existingCyclingIds.has(id));
  const missingRunningIds = runningListIds.filter((id) => !existingRunningIds.has(id));
  const missingIds = [...new Set([...missingCyclingIds, ...missingRunningIds])];

  return {
    missingIds,
    missingCyclingIds,
    missingRunningIds,
    apiCount,
    listCount: cyclingListIds.length + runningListIds.length,
    listCountCycling: cyclingListIds.length,
    listCountRunning: runningListIds.length,
    logReadCount: readCount,
    detectedAthleteId,
    error: firstPageError || null,
    status: firstPageStatus || 0,
  };
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
    let athleteId = Number(userData.strava_athlete_id) || 0;
    const activityIds = new Set(entry.explicitActivityIds);
    let gapError = null;
    let gapStatus = 0;

    if (entry.needsGapScan) {
      try {
        const gap = await detectMissingActivityIdsForUser(db, entry.userId, userData, range, deps);
        apiCalls += gap.apiCount || 1;
        // strava_athlete_id 자가복구: 토큰이 실제로 소유한 athlete id로 보정한다.
        // (누락·불일치 시 웹훅이 owner_id로 유저를 못 찾아 실시간 수집이 실패하던 문제를 영구 복구)
        const detectedAthleteId = Number(gap.detectedAthleteId) || 0;
        if (detectedAthleteId > 0 && detectedAthleteId !== athleteId) {
          try {
            await db.collection("users").doc(entry.userId).update({ strava_athlete_id: detectedAthleteId });
            console.warn("[stravaGapDetect] strava_athlete_id 자가복구:", entry.userId, {
              before: athleteId || null,
              after: detectedAthleteId,
            });
            athleteId = detectedAthleteId;
          } catch (backfillErr) {
            console.warn(
              "[stravaGapDetect] strava_athlete_id 자가복구 실패(무시하고 계속):",
              entry.userId,
              backfillErr && backfillErr.message ? backfillErr.message : backfillErr
            );
          }
        }
        if (gap.error) {
          gapError = gap.error;
          gapStatus = gap.status || 0;
        } else {
          (gap.missingIds || []).forEach((id) => activityIds.add(id));
          if ((gap.missingRunningIds || []).length > 0 || (gap.missingCyclingIds || []).length > 0) {
            console.log("[stravaGapDetect] gap missing", entry.userId, {
              cycling: (gap.missingCyclingIds || []).length,
              running: (gap.missingRunningIds || []).length,
              apiListCycling: gap.listCountCycling || 0,
              apiListRunning: gap.listCountRunning || 0,
            });
          }
        }
      } catch (e) {
        gapError = e && e.message ? e.message : String(e);
      }
    }

    if (activityIds.size === 0) {
      if (range.dateFrom && range.dateTo && deps.supabaseDualWriteServer) {
        const gapMirror = await mirrorFirestoreSupabaseRidesGaps(
          db,
          entry.userId,
          range.dateFrom,
          range.dateTo,
          deps.supabaseDualWriteServer
        );
        if (gapMirror.mirrored > 0) {
          console.log("[stravaGapDetect] firestore→supabase rides gap mirror", entry.userId, gapMirror);
        }
        try {
          await deps.supabaseDualWriteServer.syncUsersWeeklyTssParityToSupabase(
            db,
            admin,
            [entry.userId],
            range.dateFrom,
            range.dateTo
          );
        } catch (parityErr) {
          console.warn(
            "[stravaGapDetect] Supabase TSS parity sync (no missing ids):",
            entry.userId,
            parityErr && parityErr.message ? parityErr.message : parityErr
          );
        }
      }
      if (gapError) {
        const errText = String(gapError || "");
        const authBlocked =
          gap.authInvalid === true ||
          (await stravaSyncRetry.isUserStravaAuthInvalidConfirmed(db, entry.userId));
        if (!authBlocked) {
          await stravaSyncRetry.markStravaSyncRetryPending(db, entry.userId, {
            dateFrom: range.dateFrom,
            dateTo: range.dateTo,
            afterUnix: range.afterUnix,
            beforeUnix: range.beforeUnix,
            reason: gapStatus === 429 ? "429" : "processing",
            status: gapStatus || 500,
            error: errText,
          });
        } else {
          console.warn("[stravaGapDetect] auth invalid confirmed, skip retry pending:", entry.userId);
        }
        return { userId: entry.userId, sources: Array.from(entry.sources), error: gapError, ingested: 0, gapStatus };
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
        gapStatus: gapStatus || 0,
      };
    }

    // strava_athlete_id가 없거나 불일치여도 userId를 알고 있으므로 수집을 진행한다.
    // (ingest 경로에 { userId }를 넘겨 athlete_id 재조회 의존을 제거)
    const ingestOptions = { userId: entry.userId, userData };

    let userIngested = 0;
    let runIngested = 0;
    let cycleIngested = 0;
    let lastError = gapError || null;
    const runningModule = processRunningActivity;
    for (const activityId of activityIds) {
      let legacyResult;
      try {
        const preview = await runningModule.fetchStravaActivityDetailForOwner(db, athleteId, activityId, ingestOptions);
        if (
          preview.success &&
          preview.activity &&
          runningModule.isRunningStravaActivityType(preview.activity.type, preview.activity.sport_type)
        ) {
          try {
            await runningModule.processRunningActivity(db, athleteId, activityId, preview.activity, ingestOptions);
            userIngested += 1;
            runIngested += 1;
            if (athleteId) await markStravaWebhookRetryDone(db, athleteId, activityId);
          } catch (runErr) {
            lastError = runErr && runErr.message ? runErr.message : String(runErr);
            await stravaSyncRetry.markStravaSyncRetryPending(db, entry.userId, {
              dateFrom: range.dateFrom,
              dateTo: range.dateTo,
              afterUnix: range.afterUnix,
              beforeUnix: range.beforeUnix,
              reason: "run_ingest_failed",
              status: (runErr && runErr.status) || 500,
              activityId,
            });
          }
          continue;
        }
        legacyResult = await deps.processStravaActivity(db, athleteId, activityId, ingestOptions);
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
      cycleIngested += 1;
      if (athleteId) await markStravaWebhookRetryDone(db, athleteId, activityId);
    }

    if (!lastError) {
      await stravaSyncRetry.clearStravaSyncRetryPending(db, entry.userId, { count: userIngested });
      for (const wh of entry.webhookEntries) {
        await markStravaWebhookRetryDone(db, wh.owner_id, wh.object_id);
      }
    }

    if (range.dateFrom && range.dateTo && deps.supabaseDualWriteServer) {
      const gapMirror = await mirrorFirestoreSupabaseRidesGaps(
        db,
        entry.userId,
        range.dateFrom,
        range.dateTo,
        deps.supabaseDualWriteServer
      );
      if (gapMirror.mirrored > 0) {
        console.log("[stravaGapDetect] firestore→supabase rides gap mirror", entry.userId, gapMirror);
      }
      try {
        await deps.supabaseDualWriteServer.syncUsersWeeklyTssParityToSupabase(
          db,
          admin,
          [entry.userId],
          range.dateFrom,
          range.dateTo
        );
      } catch (parityErr) {
        console.warn(
          "[stravaGapDetect] Supabase TSS parity sync:",
          entry.userId,
          parityErr && parityErr.message ? parityErr.message : parityErr
        );
      }
    }

    return {
      userId: entry.userId,
      sources: Array.from(entry.sources),
      ingested: userIngested,
      runIngested,
      cycleIngested,
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

  // 429 갭 스캔 실패 유저 — 90초+ 순차 2차 패스 (당일 누락 즉시 보완, 타임아웃 방지로 상한 적용)
  const gap429UserIds = results
    .filter(
      (r) =>
        r &&
        r.error &&
        stravaSyncRetry.is429StatusOrError(r.gapStatus, r.error) &&
        !r.skipped
    )
    .map((r) => r.userId)
    .filter(Boolean);
  const unique429 = Array.from(new Set(gap429UserIds)).slice(
    0,
    stravaSyncRetry.STRAVA_429_GAP_SECOND_PASS_MAX
  );
  if (unique429.length > 0 && typeof deps.processOneUserStravaSync === "function") {
    console.log(`${prefix} 429 2차 패스 시작`, { users: unique429.length });
    const secondPass = await stravaSyncRetry.runStravaSyncRetrySequential(
      db,
      range,
      unique429,
      `${prefix}:429-second-pass`,
      deps.processOneUserStravaSync,
      deps.processStravaActivity
    );
    ingested += (secondPass.results || []).reduce(
      (s, r) => s + (Number(r && r.newActivities) || Number(r && r.ingested) || 0),
      0
    );
    ok += Number(secondPass.ok) || 0;
    fail = Math.max(0, fail - (Number(secondPass.ok) || 0));
    results.push(...(secondPass.results || []).map((r) => ({ ...r, secondPass429: true })));
  }

  return { users: userEntries.length, ok, fail, ingested, apiCalls, results };
}

/**
 * Strava API 목록 vs Supabase activities — RUN 누락만 재수집 (90일 랭킹 원천 activities·efforts 유지).
 * @returns {Promise<{ ingested: number, failed: number, missing: number, listCountRunning?: number, apiCount?: number, error?: string, status?: number }>}
 */
async function ingestMissingRunningActivityIds(
  db,
  firebaseUid,
  athleteId,
  missingIds,
  range
) {
  const ids = [...new Set((missingIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length || !athleteId) {
    return { ingested: 0, failed: 0, missing: 0 };
  }
  let ingested = 0;
  let failed = 0;
  // { userId }를 넘겨 strava_athlete_id 누락·불일치와 무관하게 RUN 누락도 수집되게 한다.
  const ingestOptions = { userId: firebaseUid };
  for (const activityId of ids) {
    try {
      const preview = await processRunningActivity.fetchStravaActivityDetailForOwner(
        db,
        athleteId,
        activityId,
        ingestOptions
      );
      if (
        preview.success &&
        preview.activity &&
        processRunningActivity.isRunningStravaActivityType(
          preview.activity.type,
          preview.activity.sport_type
        )
      ) {
        await processRunningActivity.processRunningActivity(
          db,
          athleteId,
          activityId,
          preview.activity,
          ingestOptions
        );
      } else {
        await processRunningActivity.processRunningActivity(db, athleteId, activityId, null, ingestOptions);
      }
      ingested += 1;
      if (athleteId) await markStravaWebhookRetryDone(db, athleteId, activityId);
    } catch (e) {
      failed += 1;
      console.warn(
        "[stravaGapDetect] RUN gap ingest failed:",
        firebaseUid,
        activityId,
        e && e.message ? e.message : e
      );
      await stravaSyncRetry.markStravaSyncRetryPending(db, firebaseUid, {
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        afterUnix: range.afterUnix,
        beforeUnix: range.beforeUnix,
        reason: "run_gap_ingest",
        status: (e && e.status) || 500,
        activityId,
      });
    }
  }
  return { ingested, failed, missing: ids.length };
}

/**
 * 단일 사용자 RUN 갭 보정 (API ↔ activities).
 */
async function syncRunningActivitiesGapForUser(db, userId, userData, range, deps) {
  if (!db || !userId || !range || !deps) {
    return { ingested: 0, failed: 0, missing: 0 };
  }
  const gap = await detectMissingActivityIdsForUser(db, userId, userData || {}, range, deps);
  if (gap.error) {
    return {
      ingested: 0,
      failed: 0,
      missing: 0,
      listCountRunning: gap.listCountRunning || 0,
      apiCount: gap.apiCount || 0,
      error: gap.error,
      status: gap.status || 0,
    };
  }
  const missingIds = gap.missingRunningIds || [];
  if (!missingIds.length) {
    return {
      ingested: 0,
      failed: 0,
      missing: 0,
      listCountRunning: gap.listCountRunning || 0,
      apiCount: gap.apiCount || 0,
    };
  }
  const athleteId = Number((userData && userData.strava_athlete_id) || 0);
  const ingest = await ingestMissingRunningActivityIds(
    db,
    userId,
    athleteId,
    missingIds,
    range
  );
  return {
    ingested: ingest.ingested,
    failed: ingest.failed,
    missing: ingest.missing,
    listCountRunning: gap.listCountRunning || 0,
    apiCount: gap.apiCount || 0,
  };
}

/**
 * Strava 연동 사용자 전원 RUN 갭 보정 (주간 parity·스케줄용).
 * 90일 피크 윈도우는 Supabase running_leaderboard SQL에서 유지 — 여기서는 누락 ingest만.
 */
async function syncUsersRunningActivitiesGapParity(db, userIds, range, deps) {
  const unique = Array.from(
    new Set((userIds || []).map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (!unique.length || !range || !deps) {
    return { users: 0, ingested: 0, failed: 0, missing: 0, apiCalls: 0 };
  }
  const concurrency = stravaSyncRetry.STRAVA_SYNC_CONCURRENCY_SAFE;
  let ingested = 0;
  let failed = 0;
  let missing = 0;
  let apiCalls = 0;
  let usersWithGap = 0;

  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    /* eslint-disable no-await-in-loop */
    const batchResults = await Promise.all(
      batch.map(async (userId) => {
        const snap = await db.collection("users").doc(userId).get();
        if (!snap.exists) return null;
        return syncRunningActivitiesGapForUser(db, userId, snap.data() || {}, range, deps);
      })
    );
    /* eslint-enable no-await-in-loop */
    for (const r of batchResults) {
      if (!r) continue;
      ingested += Number(r.ingested) || 0;
      failed += Number(r.failed) || 0;
      missing += Number(r.missing) || 0;
      apiCalls += Number(r.apiCount) || 0;
      if ((r.missing || 0) > 0) usersWithGap += 1;
    }
    if (i + concurrency < unique.length) {
      await sleep(stravaSyncRetry.STRAVA_USER_BATCH_DELAY_MS);
    }
  }

  if (ingested > 0) {
    console.log("[stravaGapDetect] RUN activities gap parity", {
      users: unique.length,
      usersWithGap,
      ingested,
      failed,
      missing,
      apiCalls,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    });
  }

  return {
    users: unique.length,
    usersWithGap,
    ingested,
    failed,
    missing,
    apiCalls,
  };
}

module.exports = {
  STRAVA_GAP_DETECT_PAGE_SIZE,
  STRAVA_WEBHOOK_RETRIES_COLLECTION,
  enqueueStravaWebhookRetry,
  markStravaWebhookRetryDone,
  listPendingStravaWebhookRetries,
  listPendingRetryUserIds,
  listStravaConnectedUserIds,
  buildGapDetectWorklist,
  classifyStravaListActivity,
  detectMissingActivityIdsForUser,
  getExistingStravaActivityIdsForActivityList,
  getExistingStravaActivityIdsForDateRange,
  syncRunningActivitiesGapForUser,
  syncUsersRunningActivitiesGapParity,
  runGapDetectSyncJob,
};
