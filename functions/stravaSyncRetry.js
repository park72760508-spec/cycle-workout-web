/**
 * Strava 429(레이트 리밋) 등으로 동기화가 실패한 사용자 재수집.
 * - processOneUserStravaSync 실패 시 retry 플래그 기록
 * - 스케줄/HTTP로 저동시성 순차 재시도
 */
const admin = require("firebase-admin");

/** 429 복구 시 유저 간 간격 (전역 한도 회복) */
const STRAVA_RETRY_USER_DELAY_MS = 12000;
/** 팬아웃 청크 간 대기 (동시 청크 폭주 방지) */
const STRAVA_CHUNK_FANOUT_DELAY_MS = 45000;
/** 일반 배치 동시 처리 수 (10→3, 429 예방) */
const STRAVA_SYNC_CONCURRENCY_SAFE = 3;
/** 배치 내 유저 처리 후 추가 대기 */
const STRAVA_USER_BATCH_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rangeOverlapsYmd(rangeFrom, rangeTo, targetFrom, targetTo) {
  const a = String(rangeFrom || "").slice(0, 10);
  const b = String(rangeTo || "").slice(0, 10);
  const t0 = String(targetFrom || "").slice(0, 10);
  const t1 = String(targetTo || "").slice(0, 10);
  if (!a || !b || !t0 || !t1) return true;
  return a <= t1 && b >= t0;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} userId
 * @param {{ dateFrom: string, dateTo: string, afterUnix?: number, beforeUnix?: number, reason?: string, status?: number }} meta
 */
async function markStravaSyncRetryPending(db, userId, meta) {
  if (!db || !userId) return;
  const dateFrom = String(meta.dateFrom || "").slice(0, 10);
  const dateTo = String(meta.dateTo || "").slice(0, 10);
  const update = {
    strava_sync_retry_pending: true,
    strava_sync_retry_date_from: dateFrom || null,
    strava_sync_retry_date_to: dateTo || null,
    strava_sync_retry_range: {
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      afterUnix: meta.afterUnix != null ? Number(meta.afterUnix) : null,
      beforeUnix: meta.beforeUnix != null ? Number(meta.beforeUnix) : null,
    },
    strava_sync_retry_reason: String(meta.reason || "429").slice(0, 40),
    strava_sync_retry_status: Number(meta.status) || 429,
    strava_sync_retry_requested_at: new Date().toISOString(),
    strava_sync_retry_attempts: admin.firestore.FieldValue.increment(1),
  };
  try {
    await db.collection("users").doc(userId).update(update);
  } catch (e) {
    console.warn("[stravaSyncRetry] mark pending failed:", userId, e.message || e);
  }
}

/** @param {import('firebase-admin').firestore.Firestore} db @param {string} userId */
async function clearStravaSyncRetryPending(db, userId, successMeta) {
  if (!db || !userId) return;
  const meta = successMeta && typeof successMeta === "object" ? successMeta : {};
  try {
    await db.collection("users").doc(userId).update({
      strava_sync_retry_pending: false,
      strava_sync_retry_cleared_at: new Date().toISOString(),
      strava_sync_retry_reason: admin.firestore.FieldValue.delete(),
      strava_sync_retry_status: admin.firestore.FieldValue.delete(),
      strava_last_activity_fetch_status: 200,
      strava_last_activity_fetch_error: admin.firestore.FieldValue.delete(),
      strava_last_activity_fetch_empty:
        meta.count != null ? Number(meta.count) === 0 : admin.firestore.FieldValue.delete(),
      strava_last_activity_fetch_recovered_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[stravaSyncRetry] clear pending failed:", userId, e.message || e);
  }
}

/**
 * 재시도 대상 UID 목록.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ dateFrom?: string, dateTo?: string, maxUsers?: number }} [options]
 */
async function listUsersNeedingStravaSyncRetry(db, options = {}) {
  const dateFrom = String(options.dateFrom || "").slice(0, 10);
  const dateTo = String(options.dateTo || dateFrom).slice(0, 10);
  const maxUsers = Math.max(1, Math.min(500, Number(options.maxUsers) || 200));

  const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
  const out = [];
  for (const doc of usersSnap.docs) {
    const d = doc.data() || {};
    if (d.strava_sync_retry_pending === false && d.strava_sync_retry_cleared_at) continue;
    const pending = d.strava_sync_retry_pending === true;
    const status429 = Number(d.strava_last_activity_fetch_status) === 429;
    const retryStatus429 = Number(d.strava_sync_retry_status) === 429;
    if (!pending && !status429 && !retryStatus429) continue;

    const range =
      d.strava_sync_retry_range ||
      d.strava_last_activity_fetch_range ||
      {};
    const rFrom = String(range.dateFrom || d.strava_sync_retry_date_from || "").slice(0, 10);
    const rTo = String(range.dateTo || d.strava_sync_retry_date_to || "").slice(0, 10);
    if (dateFrom && dateTo && !rangeOverlapsYmd(rFrom, rTo, dateFrom, dateTo)) continue;

    out.push(doc.id);
    if (out.length >= maxUsers) break;
  }
  return out;
}

/**
 * 429 복구용 — 유저당 순차 처리 + 간격.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ afterUnix: number, beforeUnix: number, dateFrom: string, dateTo: string }} range
 * @param {string[]} userIds
 * @param {string} logPrefix
 * @param {Function} processOneUserStravaSync
 */
async function runStravaSyncRetrySequential(db, range, userIds, logPrefix, processOneUserStravaSync) {
  const prefix = logPrefix || "[stravaSync429Retry]";
  const results = [];
  console.log(`${prefix} 시작`, {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    users: userIds.length,
  });

  for (let i = 0; i < userIds.length; i++) {
    const uid = userIds[i];
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      results.push({ userId: uid, skipped: true, reason: "user_not_found" });
      continue;
    }
    let result;
    try {
      result = await processOneUserStravaSync(db, uid, userSnap.data(), range);
    } catch (e) {
      result = {
        userId: uid,
        processed: 0,
        newActivities: 0,
        userTss: 0,
        error: e && e.message ? e.message : String(e),
      };
    }

    const errText = String(result && result.error ? result.error : "");
    const is429 = errText.includes("429");
    if (!result.error) {
      await clearStravaSyncRetryPending(db, uid, {
        count: result.newActivities,
      });
    } else if (is429) {
      await markStravaSyncRetryPending(db, uid, {
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        afterUnix: range.afterUnix,
        beforeUnix: range.beforeUnix,
        reason: "429",
        status: 429,
      });
    }
    results.push(result);
    console.log(`${prefix} [${i + 1}/${userIds.length}]`, uid, {
      newActivities: result.newActivities,
      error: result.error || null,
    });
    if (i < userIds.length - 1) {
      await sleep(STRAVA_RETRY_USER_DELAY_MS);
    }
  }

  const ok = results.filter((r) => r && !r.error && !r.skipped).length;
  const fail = results.filter((r) => r && r.error).length;
  console.log(`${prefix} 완료`, { ok, fail, total: userIds.length });
  return { results, ok, fail, total: userIds.length };
}

function ymdRangeToUnix(range) {
  const dateFrom = String(range.dateFrom || "").slice(0, 10);
  const dateTo = String(range.dateTo || dateFrom).slice(0, 10);
  const startSeoul = new Date(`${dateFrom}T00:00:00+09:00`);
  const endSeoul = new Date(`${dateTo}T23:59:59.999+09:00`);
  return {
    afterUnix: Math.floor(startSeoul.getTime() / 1000),
    beforeUnix: Math.floor(endSeoul.getTime() / 1000),
    dateFrom,
    dateTo,
  };
}

module.exports = {
  STRAVA_RETRY_USER_DELAY_MS,
  STRAVA_CHUNK_FANOUT_DELAY_MS,
  STRAVA_SYNC_CONCURRENCY_SAFE,
  STRAVA_USER_BATCH_DELAY_MS,
  markStravaSyncRetryPending,
  clearStravaSyncRetryPending,
  listUsersNeedingStravaSyncRetry,
  runStravaSyncRetrySequential,
  rangeOverlapsYmd,
  ymdRangeToUnix,
};
