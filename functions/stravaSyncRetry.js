/**
 * Strava 429(레이트 리밋) 등으로 동기화가 실패한 사용자 재수집.
 * - processOneUserStravaSync 실패 시 retry 플래그 기록
 * - 스케줄/HTTP로 저동시성 순차 재시도
 */
const admin = require("firebase-admin");
const stravaConnectionReader = require("./stravaConnectionReader");

/** 429 복구 시 유저 간 간격 (전역 한도 회복) */
const STRAVA_RETRY_USER_DELAY_MS = 12000;
/** API 내부 재시도(최대 8회) 소진 후 1회 추가 대기 재시도 — Strava 15분 윈도우 회복용 */
const STRAVA_429_OUTER_RETRY_DELAY_MS = 90000;
/** 갭 탐지 429 2차 패스 최대 인원 (Functions 타임아웃 방지) */
const STRAVA_429_GAP_SECOND_PASS_MAX = 40;
/** 팬아웃 청크 간 대기 (동시 청크 폭주 방지) */
const STRAVA_CHUNK_FANOUT_DELAY_MS = 45000;
/** 일반 배치 동시 처리 수 (10→3, 429 예방) */
const STRAVA_SYNC_CONCURRENCY_SAFE = 3;
/** 배치 내 유저 처리 후 추가 대기 */
const STRAVA_USER_BATCH_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Strava OAuth token 응답 본문에서 refresh_token 확정 무효 여부.
 * (400 Bad Request 단독·Authorization Error 단독은 포함하지 않음)
 */
function hasStravaRefreshTokenInvalidInTokenData(tokenData) {
  if (!tokenData || typeof tokenData !== "object") return false;
  const oauthErr = String(tokenData.error || "").trim().toLowerCase();
  if (oauthErr === "invalid_grant") return true;
  const errors = Array.isArray(tokenData.errors) ? tokenData.errors : [];
  return errors.some((e) => {
    const resource = String((e && e.resource) || "").trim().toLowerCase();
    const field = String((e && e.field) || "").trim().toLowerCase();
    const code = String((e && e.code) || "").trim().toLowerCase();
    return resource === "refreshtoken" && field === "refresh_token" && code === "invalid";
  });
}

/**
 * refresh_token **확정** 무효 — 재연결 필요 시에만 true.
 * @param {number} [httpStatus]
 * @param {object|null} [tokenData] Strava /oauth/token JSON 본문
 * @param {string} [errorText] 보조(본문 없을 때 invalid_grant 등만)
 */
function isDefinitiveStravaRefreshTokenInvalid(httpStatus, tokenData, errorText) {
  if (hasStravaRefreshTokenInvalidInTokenData(tokenData)) return true;
  const err = String(errorText || "").trim().toLowerCase();
  if (err.includes("invalid_grant")) return true;
  // 에러 문자열에 Strava errors 배열이 포함된 경우만 파싱 (단순 "Bad Request"는 제외)
  if (err.includes("refreshtoken") && err.includes("refresh_token") && err.includes("invalid")) {
    return true;
  }
  try {
    const raw = String(errorText || "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (hasStravaRefreshTokenInvalidInTokenData(parsed)) return true;
    }
  } catch (_e) {
    /* ignore */
  }
  return false;
}

/** @deprecated — isDefinitiveStravaRefreshTokenInvalid 사용. tokenData 없이 true가 되지 않도록 엄격화됨. */
function isStravaRefreshTokenInvalidError(errorText, status, tokenData) {
  return isDefinitiveStravaRefreshTokenInvalid(status, tokenData, errorText);
}

/** 재시도 큐에서 제외·pending 중단 대상 (확정 무효만) */
function isStravaAuthInvalidUserData(userData) {
  if (!userData || userData.strava_auth_invalid !== true) return false;
  if (userData.strava_auth_invalid_confirmed === true) return true;
  // 수동/API 검증으로 표시된 기존 사용자(일괄 처리 등)
  const reason = String(userData.strava_auth_invalid_reason || "").trim();
  return reason === "refresh_token_invalid" || reason === "manual_api_verify";
}

async function isUserStravaAuthInvalidConfirmed(db, userId) {
  if (!db || !userId) return false;
  try {
    const snap = await db.collection("users").doc(userId).get();
    return snap.exists && isStravaAuthInvalidUserData(snap.data() || {});
  } catch (_e) {
    return false;
  }
}

/**
 * refresh_token **확정** 무효 — 재연결 필요. evidence 검증 통과 시에만 pending 중단.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} userId
 * @param {{ reason?: string, error?: string, since?: string, evidence?: { httpStatus?: number, tokenData?: object, errorText?: string, refreshTokenTried?: string } }} [meta]
 * @returns {Promise<boolean>} 차단 적용 여부
 */
async function markStravaAuthInvalid(db, userId, meta) {
  if (!db || !userId) return false;
  const m = meta && typeof meta === "object" ? meta : {};
  const evidence = m.evidence && typeof m.evidence === "object" ? m.evidence : {};
  const httpStatus = Number(evidence.httpStatus) || 0;
  const tokenData = evidence.tokenData || null;
  const errorText = String(evidence.errorText || m.error || "").trim();

  if (!isDefinitiveStravaRefreshTokenInvalid(httpStatus, tokenData, errorText)) {
    console.warn("[stravaSyncRetry] markStravaAuthInvalid skipped (not definitive):", userId, {
      httpStatus: httpStatus || null,
      errorText: errorText ? errorText.slice(0, 120) : null,
    });
    return false;
  }

  // 동시 회전: Firestore refresh_token이 방금 시도한 것과 다르면 다른 프로세스가 이미 갱신한 것 → 차단하지 않음
  if (evidence.refreshTokenTried) {
    try {
      const snap = await db.collection("users").doc(userId).get();
      const currentRefresh = String((snap.data() || {}).strava_refresh_token || "");
      if (currentRefresh && currentRefresh !== String(evidence.refreshTokenTried)) {
        console.warn("[stravaSyncRetry] markStravaAuthInvalid skipped (concurrent token rotation):", userId);
        return false;
      }
    } catch (_e) {
      /* continue — evidence is definitive */
    }
  }

  const since = String(m.since || "").slice(0, 10);
  const evidencePayload = {
    httpStatus: httpStatus || null,
    error: errorText ? errorText.slice(0, 300) : null,
    oauthError: tokenData && tokenData.error != null ? String(tokenData.error) : null,
    errors: tokenData && Array.isArray(tokenData.errors) ? tokenData.errors.slice(0, 5) : null,
    confirmedAt: new Date().toISOString(),
  };
  try {
    await db.collection("users").doc(userId).update({
      strava_auth_invalid: true,
      strava_auth_invalid_confirmed: true,
      strava_auth_invalid_at: new Date().toISOString(),
      strava_auth_invalid_reason: String(m.reason || "refresh_token_invalid").slice(0, 80),
      strava_auth_invalid_error: errorText ? errorText.slice(0, 500) : admin.firestore.FieldValue.delete(),
      strava_auth_invalid_evidence: evidencePayload,
      strava_auth_invalid_since: since || admin.firestore.FieldValue.delete(),
      strava_sync_retry_pending: false,
      strava_sync_retry_reason: admin.firestore.FieldValue.delete(),
      strava_sync_retry_status: admin.firestore.FieldValue.delete(),
      strava_sync_retry_activity_id: admin.firestore.FieldValue.delete(),
      strava_last_activity_fetch_hint:
        "Strava refresh_token이 만료·무효화되었습니다. 환경설정에서 Strava를 다시 연결해 주세요.",
    });
    return true;
  } catch (e) {
    console.warn("[stravaSyncRetry] markStravaAuthInvalid failed:", userId, e.message || e);
    return false;
  }
}

/** Strava OAuth 재연결 성공 시 auth invalid 플래그 해제 */
async function clearStravaAuthInvalidOnReconnect(db, userId) {
  if (!db || !userId) return;
  try {
    await db.collection("users").doc(userId).update({
      strava_auth_invalid: false,
      strava_auth_invalid_confirmed: admin.firestore.FieldValue.delete(),
      strava_auth_invalid_at: admin.firestore.FieldValue.delete(),
      strava_auth_invalid_reason: admin.firestore.FieldValue.delete(),
      strava_auth_invalid_error: admin.firestore.FieldValue.delete(),
      strava_auth_invalid_evidence: admin.firestore.FieldValue.delete(),
      strava_auth_invalid_since: admin.firestore.FieldValue.delete(),
      strava_auth_invalid_cleared_at: new Date().toISOString(),
      strava_last_activity_fetch_error: admin.firestore.FieldValue.delete(),
      strava_last_activity_fetch_hint: admin.firestore.FieldValue.delete(),
    });
  } catch (e) {
    console.warn("[stravaSyncRetry] clearStravaAuthInvalidOnReconnect failed:", userId, e.message || e);
  }
}

/**
 * 재연결 후 누락 구간 백필 큐 등록 (마지막 Strava 로그 다음날 ~ 오늘, 최대 90일).
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} userId
 */
async function scheduleStravaReconnectBackfill(db, userId) {
  if (!db || !userId) return;
  const todaySeoul = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  let dateFrom = "";
  try {
    const logsSnap = await db
      .collection("users")
      .doc(userId)
      .collection("logs")
      .where("source", "==", "strava")
      .orderBy("date", "desc")
      .limit(1)
      .get();
    if (!logsSnap.empty) {
      const lastDate = String((logsSnap.docs[0].data() || {}).date || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(lastDate)) {
        const [y, mo, d] = lastDate.split("-").map(Number);
        const next = new Date(y, mo - 1, d);
        next.setDate(next.getDate() + 1);
        dateFrom = next.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      }
    }
  } catch (e) {
    console.warn("[stravaSyncRetry] scheduleStravaReconnectBackfill last log lookup failed:", userId, e.message || e);
  }
  if (!dateFrom) {
    const cap = new Date();
    cap.setDate(cap.getDate() - 90);
    dateFrom = cap.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  }
  if (dateFrom > todaySeoul) return;
  const range = ymdRangeToUnix({ dateFrom, dateTo: todaySeoul });
  try {
    await db.collection("users").doc(userId).update({
      strava_sync_retry_pending: true,
      strava_sync_retry_date_from: dateFrom,
      strava_sync_retry_date_to: todaySeoul,
      strava_sync_retry_range: {
        dateFrom,
        dateTo: todaySeoul,
        afterUnix: range.afterUnix,
        beforeUnix: range.beforeUnix,
        activityId: null,
      },
      strava_sync_retry_reason: "reconnect_backfill",
      strava_sync_retry_status: 200,
      strava_sync_retry_requested_at: new Date().toISOString(),
      strava_sync_retry_attempts: 0,
    });
    console.log("[stravaSyncRetry] reconnect backfill scheduled:", userId, { dateFrom, dateTo: todaySeoul });
  } catch (e) {
    console.warn("[stravaSyncRetry] scheduleStravaReconnectBackfill failed:", userId, e.message || e);
  }
}

function is429StatusOrError(status, errorText) {
  const s = Number(status) || 0;
  if (s === 429) return true;
  return String(errorText || "").includes("429");
}

/**
 * fetchStravaActivitiesPage 내부 재시도(최대 8회) 후에도 429면 90초 대기 후 1회 추가 시도.
 * @param {Function} fetchPageFn fetchStravaActivitiesPage
 */
async function fetchActivitiesPageWithOuter429Retry(
  fetchPageFn,
  accessToken,
  afterUnix,
  beforeUnix,
  page,
  perPage,
  logContext
) {
  let pageRes = await fetchPageFn(accessToken, afterUnix, beforeUnix, page, perPage);
  if (pageRes && pageRes.success) return pageRes;
  if (!is429StatusOrError(pageRes && pageRes.status, pageRes && pageRes.error)) return pageRes;
  const ctx = logContext ? String(logContext) : "stravaSync";
  console.log(`[${ctx}] 429 외부 재시도 대기 ${STRAVA_429_OUTER_RETRY_DELAY_MS / 1000}s`, {
    page: page || 1,
  });
  await sleep(STRAVA_429_OUTER_RETRY_DELAY_MS);
  pageRes = await fetchPageFn(accessToken, afterUnix, beforeUnix, page, perPage);
  return pageRes;
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
 * @param {{ dateFrom: string, dateTo: string, afterUnix?: number, beforeUnix?: number, reason?: string, status?: number, activityId?: string|number }} meta
 */
async function markStravaSyncRetryPending(db, userId, meta) {
  if (!db || !userId) return;
  try {
    const userSnap = await db.collection("users").doc(userId).get();
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    // 확정 무효 사용자만 pending 등록 생략 (일시 오류·429·동시 회전은 pending 유지)
    if (isStravaAuthInvalidUserData(userData)) return;
  } catch (e) {
    console.warn("[stravaSyncRetry] mark pending precheck failed:", userId, e.message || e);
  }
  const dateFrom = String(meta.dateFrom || "").slice(0, 10);
  const dateTo = String(meta.dateTo || "").slice(0, 10);
  const activityId = meta.activityId != null ? String(meta.activityId).trim() : "";
  const update = {
    strava_sync_retry_pending: true,
    strava_sync_retry_date_from: dateFrom || null,
    strava_sync_retry_date_to: dateTo || null,
    strava_sync_retry_range: {
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      afterUnix: meta.afterUnix != null ? Number(meta.afterUnix) : null,
      beforeUnix: meta.beforeUnix != null ? Number(meta.beforeUnix) : null,
      activityId: activityId || null,
    },
    strava_sync_retry_reason: String(meta.reason || "429").slice(0, 40),
    strava_sync_retry_status: Number(meta.status) || 429,
    strava_sync_retry_requested_at: new Date().toISOString(),
    strava_sync_retry_attempts: admin.firestore.FieldValue.increment(1),
  };
  if (activityId) {
    update.strava_sync_retry_activity_id = activityId;
  }
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
      strava_sync_retry_activity_id: admin.firestore.FieldValue.delete(),
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

  const docs = await stravaConnectionReader.fetchStravaConnectedUserDocSnaps(db);
  const out = [];
  for (const doc of docs) {
    const d = doc.data() || {};
    if (isStravaAuthInvalidUserData(d)) continue;
    if (d.strava_sync_retry_pending === false && d.strava_sync_retry_cleared_at) continue;
    const pending = d.strava_sync_retry_pending === true;
    const hasActivityRetry = Boolean(String(d.strava_sync_retry_activity_id || "").trim());
    const status429 = Number(d.strava_last_activity_fetch_status) === 429;
    const retryStatus429 = Number(d.strava_sync_retry_status) === 429;
    if (!pending && !hasActivityRetry && !status429 && !retryStatus429) continue;

    const range =
      d.strava_sync_retry_range ||
      d.strava_last_activity_fetch_range ||
      {};
    const rFrom = String(range.dateFrom || d.strava_sync_retry_date_from || "").slice(0, 10);
    const rTo = String(range.dateTo || d.strava_sync_retry_date_to || "").slice(0, 10);
    // pending·429·단건 activityId 재시도는 저장된 구간이 과거여도 현재 job 구간으로 재수집해야 함
    const forceRetryRegardlessOfRange =
      pending || hasActivityRetry || status429 || retryStatus429;
    if (
      !forceRetryRegardlessOfRange &&
      dateFrom &&
      dateTo &&
      !rangeOverlapsYmd(rFrom, rTo, dateFrom, dateTo)
    ) {
      continue;
    }

    out.push(doc.id);
    if (out.length >= maxUsers) break;
  }
  return out;
}

function extractRetryStatusFromResult(result, userData) {
  if (result && Number(result.status) > 0) return Number(result.status);
  const errText = String(result && result.error ? result.error : "");
  const m = errText.match(/\b(401|429|5\d{2})\b/);
  if (m) return Number(m[1]);
  return Number(userData && userData.strava_sync_retry_status) || 0;
}

function inferRetryReasonFromResult(result, userData) {
  if (result && result.authInvalid === true) return "auth_invalid";
  // 403 Application Inactive(앱 비활성)는 앱 레벨 공통 장애 → 사용자별 재시도 사유와 구분해 기록
  const appInactive =
    (result && result.appInactive === true) ||
    String(result && result.error ? result.error : "").toLowerCase().includes("application inactive");
  if (appInactive) return "app_inactive";
  const status = extractRetryStatusFromResult(result, userData);
  if (status === 403) return "app_inactive";
  const existing = String(userData && userData.strava_sync_retry_reason ? userData.strava_sync_retry_reason : "").trim();
  if (existing) return existing.slice(0, 40);
  if (status === 401) return "401";
  if (status === 429) return "429";
  return "processing";
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} userId
 * @param {object} userData
 * @param {string} activityId
 * @param {Function} processStravaActivityFn
 */
async function retrySingleStravaActivity(db, userId, userData, activityId, processStravaActivityFn) {
  const athleteId = Number(userData && userData.strava_athlete_id) || 0;
  if (!activityId) {
    return {
      userId,
      processed: 0,
      newActivities: 0,
      userTss: 0,
      error: "activity_id 없음",
    };
  }
  try {
    // { userId } 전달로 strava_athlete_id 누락·불일치와 무관하게 단건 수집이 되도록 한다.
    const legacyResult = await processStravaActivityFn(db, athleteId, activityId, { userId });
    if (!legacyResult || legacyResult.error) {
      return {
        userId,
        processed: 0,
        newActivities: 0,
        userTss: 0,
        error: (legacyResult && legacyResult.error) || "processStravaActivity 실패",
        status: legacyResult && legacyResult.status ? legacyResult.status : 0,
        mode: "single_activity",
        activityId,
      };
    }
    return {
      userId,
      processed: 1,
      newActivities: legacyResult.isNew ? 1 : 0,
      userTss: Number(legacyResult.userTss) || 0,
      mode: "single_activity",
      activityId,
    };
  } catch (e) {
    return {
      userId,
      processed: 0,
      newActivities: 0,
      userTss: 0,
      error: e && e.message ? e.message : String(e),
      mode: "single_activity",
      activityId,
    };
  }
}

/**
 * pending 재시도 — 유저당 순차 처리 + 간격. activityId 있으면 단건 processStravaActivity 우선.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ afterUnix: number, beforeUnix: number, dateFrom: string, dateTo: string }} range
 * @param {string[]} userIds
 * @param {string} logPrefix
 * @param {Function} processOneUserStravaSync
 * @param {Function|null} [processStravaActivityFn]
 */
async function runStravaSyncRetrySequential(
  db,
  range,
  userIds,
  logPrefix,
  processOneUserStravaSync,
  processStravaActivityFn
) {
  const prefix = logPrefix || "[stravaSyncRetry]";
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
    const userData = userSnap.data() || {};
    const retryActivityId = String(userData.strava_sync_retry_activity_id || "").trim();
    let result;
    try {
      if (retryActivityId && typeof processStravaActivityFn === "function") {
        result = await retrySingleStravaActivity(db, uid, userData, retryActivityId, processStravaActivityFn);
      } else {
        result = await processOneUserStravaSync(db, uid, userData, range);
      }
    } catch (e) {
      result = {
        userId: uid,
        processed: 0,
        newActivities: 0,
        userTss: 0,
        error: e && e.message ? e.message : String(e),
      };
    }

    if (!result.error) {
      await clearStravaSyncRetryPending(db, uid, {
        count: result.newActivities,
      });
    } else {
      const failStatus = extractRetryStatusFromResult(result, userData);
      const errText = String(result.error || "");
      const authBlocked = result.authInvalid === true || isStravaAuthInvalidUserData(userData);
      if (authBlocked) {
        // refreshStravaTokenForUser에서 확정 무효로 이미 차단됨 — pending 재등록하지 않음
        console.warn(`${prefix} auth invalid confirmed, skip retry pending:`, uid);
      } else {
        await markStravaSyncRetryPending(db, uid, {
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          afterUnix: range.afterUnix,
          beforeUnix: range.beforeUnix,
          reason: inferRetryReasonFromResult(result, userData),
          status: failStatus || 429,
          activityId: retryActivityId || null,
          error: errText,
        });
      }
    }
    results.push(result);
    console.log(`${prefix} [${i + 1}/${userIds.length}]`, uid, {
      mode: result.mode || "range_sync",
      activityId: result.activityId || retryActivityId || null,
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

/** 서울 기준 어제~오늘 YYYY-MM-DD (웹훅 재시도 기본 구간) */
function getYesterdayTodayYmdSeoul() {
  const now = new Date();
  const todaySeoulStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [y, m, d] = todaySeoulStr.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const dateTo = `${y}-${pad(m)}-${pad(d)}`;
  const yesterday = new Date(y, m - 1, d);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateFrom = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
  return { dateFrom, dateTo };
}

/** 활동 날짜가 있으면 해당 일, 없으면 어제~오늘 */
function resolveStravaRetryDateRange(activityDateYmd) {
  const activityDate = String(activityDateYmd || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) {
    return { dateFrom: activityDate, dateTo: activityDate };
  }
  return getYesterdayTodayYmdSeoul();
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
  STRAVA_429_OUTER_RETRY_DELAY_MS,
  STRAVA_429_GAP_SECOND_PASS_MAX,
  STRAVA_CHUNK_FANOUT_DELAY_MS,
  STRAVA_SYNC_CONCURRENCY_SAFE,
  STRAVA_USER_BATCH_DELAY_MS,
  hasStravaRefreshTokenInvalidInTokenData,
  isDefinitiveStravaRefreshTokenInvalid,
  isStravaRefreshTokenInvalidError,
  isStravaAuthInvalidUserData,
  isUserStravaAuthInvalidConfirmed,
  markStravaAuthInvalid,
  clearStravaAuthInvalidOnReconnect,
  scheduleStravaReconnectBackfill,
  markStravaSyncRetryPending,
  clearStravaSyncRetryPending,
  listUsersNeedingStravaSyncRetry,
  runStravaSyncRetrySequential,
  retrySingleStravaActivity,
  rangeOverlapsYmd,
  is429StatusOrError,
  fetchActivitiesPageWithOuter429Retry,
  getYesterdayTodayYmdSeoul,
  resolveStravaRetryDateRange,
  ymdRangeToUnix,
};
