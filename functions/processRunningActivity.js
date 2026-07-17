/**
 * Strava 러닝 Webhook 전용 처리 (Run / VirtualRun / TrailRun — Walk 제외).
 *
 * [사이클 영향 검토 — 2026-06-10]
 * - index.js processStravaActivity / processOneUserStravaSync / isCyclingForMmp: 미수정
 * - Firestore users/logs(사이클) 경로: 이 모듈에서 호출하지 않음
 * - Supabase public.rides: touch 없음 → daily_summaries·랭킹 트리거 영향 없음
 * - public.activities 테이블에만 upsert
 */
const admin = require("firebase-admin");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const stravaRouteMerge = require("./stravaRouteMerge");

/** Webhook create 라우팅 대상 — Walk 제외 (RUN 랭킹은 Run 계열만) */
const RUNNING_STRAVA_TYPES = new Set(["run", "virtualrun", "trailrun"]);

function normalizeStravaActivityTypeToken(type) {
  return String(type || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/** @param {unknown} type Detailed Activity `type` (예: Run, VirtualRun) @param {unknown} [sportType] */
function isRunningStravaActivityType(type, sportType) {
  const candidates = [type, sportType].map(normalizeStravaActivityTypeToken).filter(Boolean);
  return candidates.some((t) => RUNNING_STRAVA_TYPES.has(t));
}

function num(v, fallback = null) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v, fallback = null) {
  const n = num(v, fallback);
  return n == null ? fallback : Math.trunc(n);
}

function toActivityDate(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Strava splits_metric → 경량 JSONB
 * (distance, elapsed_time, average_speed, average_heartrate, max_heartrate)
 */
function buildLightweightSplitsMetric(splitsMetric) {
  if (!Array.isArray(splitsMetric) || splitsMetric.length === 0) return null;
  const out = [];
  for (const s of splitsMetric) {
    if (!s || typeof s !== "object") continue;
    const row = {
      distance: num(s.distance),
      elapsed_time: int(s.elapsed_time),
      average_speed: num(s.average_speed),
      average_heartrate: int(s.average_heartrate, null),
      max_heartrate: int(s.max_heartrate, null),
    };
    if (
      row.distance == null &&
      row.elapsed_time == null &&
      row.average_speed == null &&
      row.average_heartrate == null &&
      row.max_heartrate == null
    ) {
      continue;
    }
    out.push(row);
  }
  return out.length > 0 ? out : null;
}

/** Strava suffer_score 우선, 없으면 fn_running_activity_tss 와 동일 HR·시간 추정 */
function estimateRunningTss(activity, durationSec, avgHr) {
  const suffer = num(activity.suffer_score);
  if (suffer != null && suffer > 0) {
    return Math.round(suffer * 10) / 10;
  }
  const sec = Number(durationSec) || 0;
  const hr = Number(avgHr) || 0;
  if (sec > 0 && hr > 0) {
    const ifVal = hr / 180;
    return Math.round((sec / 3600) * ifVal * ifVal * 100 * 10) / 10;
  }
  return 0;
}

function mapStravaRunningToActivityRow(activity, firebaseUid) {
  const uidConfig = {
    uidNamespace: String(supabaseDualWriteServer.uidNamespaceParam.value() || "").trim(),
    uidMode: String(supabaseDualWriteServer.uidModeParam.value() || "v5").trim(),
  };
  const userId = supabaseDualWriteServer.resolveUserUuid(
    firebaseUid,
    uidConfig.uidNamespace,
    uidConfig.uidMode
  );
  const activityDate = toActivityDate(activity.start_date_local || activity.start_date);
  if (!userId || !activityDate) return null;

  const distanceM = Number(activity.distance) || 0;
  const distanceKm = Math.round((distanceM / 1000) * 1000) / 1000;
  const durationSec = Math.round(Number(activity.moving_time) || Number(activity.elapsed_time) || 0);
  const elapsedSec = Math.round(Number(activity.elapsed_time) || durationSec || 0);
  const avgHr = int(activity.average_heartrate, null);
  let avgSpeedKmh = num(activity.average_speed);
  if (avgSpeedKmh != null) {
    avgSpeedKmh = Math.round(avgSpeedKmh * 3.6 * 100) / 100;
  }
  const title = activity.name ? String(activity.name) : "Run";
  const startDateRaw = activity.start_date_local || activity.start_date || null;
  const summaryPolyline =
    activity && activity.map && activity.map.summary_polyline
      ? String(activity.map.summary_polyline).trim()
      : activity && activity.summary_polyline
        ? String(activity.summary_polyline).trim()
        : "";

  return {
    user_id: userId,
    source: "strava",
    activity_id: String(activity.id),
    activity_type: String(activity.type || activity.sport_type || "").trim(),
    title,
    // legacy activities 테이블 NOT NULL 컬럼 (프로덕션 스키마 호환)
    name: title,
    activity_date: activityDate,
    start_date: startDateRaw,
    duration_sec: durationSec,
    moving_time: durationSec,
    elapsed_time: elapsedSec,
    distance: distanceKm > 0 ? distanceKm : 0,
    distance_km: distanceKm > 0 ? distanceKm : null,
    elevation_gain_m: num(activity.total_elevation_gain),
    avg_speed_kmh: avgSpeedKmh,
    avg_hr: avgHr,
    max_hr: int(activity.max_heartrate, null),
    tss: estimateRunningTss(activity, durationSec, avgHr),
    splits_metric: buildLightweightSplitsMetric(activity.splits_metric),
    summary_polyline: summaryPolyline || null,
    updated_at: new Date().toISOString(),
  };
}

/** ingest 실패 시 갭 탐지·재시도 큐 (activities·efforts 보정) */
async function markRunningActivitySyncRetry(db, firebaseUid, activityId, activityDateRaw, reason, status) {
  if (!db || !firebaseUid) return;
  try {
    const stravaSyncRetry = require("./stravaSyncRetry");
    const ymd = toActivityDate(activityDateRaw);
    if (!ymd) return;
    await stravaSyncRetry.markStravaSyncRetryPending(db, firebaseUid, {
      dateFrom: ymd,
      dateTo: ymd,
      reason: String(reason || "run_mirror").slice(0, 40),
      status: Number(status) || 500,
      activityId,
    });
  } catch (e) {
    console.warn(
      "[processRunningActivity] mark retry failed:",
      firebaseUid,
      activityId,
      e && e.message ? e.message : e
    );
  }
}

async function resolveStravaUserByOwnerId(db, ownerId, options = {}) {
  // options.userId가 있으면 athlete_id 조회를 건너뛰고 해당 유저를 직접 사용한다.
  // (갭 스캔·재시도 경로는 userId를 이미 알고 있으므로 strava_athlete_id 누락·불일치와 무관하게 동작한다.)
  const forcedUserId = options && options.userId ? String(options.userId).trim() : "";
  if (forcedUserId) {
    if (options.userData) return { userId: forcedUserId, userData: options.userData };
    const doc = await db.collection("users").doc(forcedUserId).get();
    if (!doc.exists) return null;
    return { userId: forcedUserId, userData: doc.data() || {} };
  }
  const ownerIdNum = Number(ownerId);
  if (!ownerIdNum) return null;
  const snap = await db.collection("users").where("strava_athlete_id", "==", ownerIdNum).limit(1).get();
  if (snap.empty) return null;
  return { userId: snap.docs[0].id, userData: snap.docs[0].data() || {} };
}

/**
 * Webhook create 라우팅용 — Detailed Activity API 1회 조회.
 * @returns {Promise<{ success: boolean, activity?: object, userId?: string, status?: number, error?: string }>}
 */
async function fetchStravaActivityDetailForOwner(db, ownerId, objectId, options = {}) {
  const resolved = await resolveStravaUserByOwnerId(db, ownerId, options);
  if (!resolved) {
    return { success: false, error: "user_not_found" };
  }
  const { userId, userData } = resolved;
  const mainModule = require("./index.js");
  if (typeof mainModule.refreshStravaTokenForUser !== "function" || typeof mainModule.fetchStravaActivityDetail !== "function") {
    return { success: false, error: "strava_helpers_unavailable" };
  }

  let accessToken = userData.strava_access_token || "";
  const tokenExpiresAt = Number(userData.strava_expires_at || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!accessToken || tokenExpiresAt < nowSec + 300) {
    try {
      const tokenResult = await mainModule.refreshStravaTokenForUser(db, userId);
      accessToken = tokenResult.accessToken;
    } catch (e) {
      return { success: false, userId, error: `토큰 갱신 실패: ${e.message}`, status: 401 };
    }
  }

  let detailRes = await mainModule.fetchStravaActivityDetail(accessToken, String(objectId));
  if ((detailRes && detailRes.status === 401) || (detailRes && !detailRes.success && String(detailRes.error || "").includes("401"))) {
    try {
      const tokenResult = await mainModule.refreshStravaTokenForUser(db, userId);
      accessToken = tokenResult.accessToken;
      detailRes = await mainModule.fetchStravaActivityDetail(accessToken, String(objectId));
    } catch (e) {
      return { success: false, userId, error: `401 후 토큰 재갱신 실패: ${e.message}`, status: 401 };
    }
  }

  if (!detailRes || !detailRes.success || !detailRes.activity) {
    return {
      success: false,
      userId,
      error: (detailRes && detailRes.error) || "활동 상세 조회 실패",
      status: detailRes && detailRes.status ? detailRes.status : 0,
    };
  }
  return { success: true, userId, activity: detailRes.activity, accessToken };
}

async function upsertRunningActivityToSupabase(firebaseUid, row) {
  await supabaseDualWriteServer.refreshDualRunFromRemoteConfig(admin, true);
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const uidConfig = {
    uidNamespace: String(supabaseDualWriteServer.uidNamespaceParam.value() || "").trim(),
    uidMode: String(supabaseDualWriteServer.uidModeParam.value() || "v5").trim(),
  };
  row.user_id = await supabaseDualWriteServer.resolveRideUserIdForFirebaseUid(
    supabase,
    firebaseUid,
    uidConfig
  );

  async function writeOnce() {
    const { data: existing, error: readErr } = await supabase
      .from("activities")
      .select("id")
      .eq("user_id", row.user_id)
      .eq("activity_id", row.activity_id)
      .maybeSingle();
    if (readErr) throw readErr;

    if (existing && existing.id != null) {
      const { id: _omit, ...updateRow } = row;
      const { error } = await supabase
        .from("activities")
        .update(updateRow)
        .eq("user_id", row.user_id)
        .eq("activity_id", row.activity_id);
      if (error) throw error;
      return;
    }

    const { data: maxRow, error: maxErr } = await supabase
      .from("activities")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxErr) throw maxErr;
    const nextId = (maxRow && maxRow.id != null ? Number(maxRow.id) : 0) + 1;
    const { error } = await supabase.from("activities").insert({ ...row, id: nextId });
    if (error) throw error;
  }

  try {
    await writeOnce();
  } catch (error) {
    const msg = error && error.message ? error.message : String(error);
    if (!/activities_user_id_fkey|users.*fkey|23503/i.test(msg)) {
      throw error;
    }
    const supabaseUserProvision = require("./supabaseUserProvision");
    await supabaseUserProvision.provisionSupabaseUserAfterProfile(admin, firebaseUid);
    row.user_id = await supabaseDualWriteServer.resolveRideUserIdForFirebaseUid(
      supabase,
      firebaseUid,
      uidConfig
    );
    await writeOnce();
  }
}

/**
 * 같은 날(activityDate) RUN 활동이 여러 건이면 코스를 병합해 users/{uid}/daily_route_profiles/{date}에 저장.
 * CYCLE(functions/index.js의 manualStravaSyncWithMmp 등)과 동일한 stravaRouteMerge 모듈을 재사용한다.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} firebaseUid
 * @param {string} supabaseUserId activities.user_id (Supabase UUID)
 * @param {string} activityDate YYYY-MM-DD
 */
async function mergeRunningDailyRouteProfile(db, firebaseUid, supabaseUserId, activityDate) {
  if (!firebaseUid || !supabaseUserId || !activityDate) return;
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("activities")
    .select("activity_id, summary_polyline, start_date")
    .eq("user_id", supabaseUserId)
    .eq("activity_date", activityDate)
    .eq("source", "strava");
  if (error) throw error;
  const logsShape = (data || []).map((r) => ({
    activity_id: r.activity_id,
    summary_polyline: r.summary_polyline,
    start_date_local: r.start_date,
  }));
  await stravaRouteMerge.saveMergedDailyRouteProfile(db, firebaseUid, activityDate, logsShape);
}

/**
 * Strava Run 활동 → Supabase activities upsert.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {number} ownerId Strava athlete id
 * @param {number|string} objectId Strava activity id
 * @param {object} [activityPrefetched] 라우팅 단계에서 이미 조회한 activity
 */
async function processRunningActivity(db, ownerId, objectId, activityPrefetched, options = {}) {
  let activity = activityPrefetched;
  let userId = null;

  if (!activity) {
    const fetched = await fetchStravaActivityDetailForOwner(db, ownerId, objectId, options);
    if (!fetched.success || !fetched.activity) {
      const err = new Error(fetched.error || "running activity fetch failed");
      err.status = fetched.status || 0;
      err.userId = fetched.userId || null;
      if (fetched.userId) {
        await markRunningActivitySyncRetry(
          db,
          fetched.userId,
          String(objectId),
          null,
          "run_fetch_failed",
          fetched.status || 500
        );
      }
      throw err;
    }
    activity = fetched.activity;
    userId = fetched.userId;
  } else {
    const resolved = await resolveStravaUserByOwnerId(db, ownerId, options);
    if (!resolved) {
      throw new Error("user_not_found");
    }
    userId = resolved.userId;
  }

  if (!isRunningStravaActivityType(activity.type, activity.sport_type)) {
    return {
      skipped: true,
      reason: "not_running_type",
      activityType: activity.type,
      sportType: activity.sport_type,
      userId,
      activityId: String(objectId),
    };
  }

  const row = mapStravaRunningToActivityRow(activity, userId);
  if (!row) {
    const mapErr = new Error("mapStravaRunningToActivityRow failed");
    const actDate = toActivityDate(activity.start_date_local || activity.start_date);
    await markRunningActivitySyncRetry(
      db,
      userId,
      String(objectId),
      actDate,
      "run_map_failed",
      500
    );
    throw mapErr;
  }

  try {
    await upsertRunningActivityToSupabase(userId, row);
  } catch (upsertErr) {
    await markRunningActivitySyncRetry(
      db,
      userId,
      row.activity_id,
      row.activity_date,
      "activities_upsert_failed",
      500
    );
    throw upsertErr;
  }
  console.log("[processRunningActivity] Supabase activities upsert OK", {
    userId,
    activityId: row.activity_id,
    activityType: row.activity_type,
    splits: Array.isArray(row.splits_metric) ? row.splits_metric.length : 0,
  });

  let effortsResult = null;
  try {
    const calculateAndSaveRunEfforts = require("./calculateAndSaveRunEfforts");
    effortsResult = await calculateAndSaveRunEfforts.calculateAndSaveRunEfforts(
      db,
      userId,
      activity,
      null
    );
  } catch (effortsErr) {
    console.error("[processRunningActivity] calculateAndSaveRunEfforts 실패:", effortsErr);
    await markRunningActivitySyncRetry(
      db,
      userId,
      row.activity_id,
      row.activity_date,
      "run_efforts_failed",
      500
    );
  }

  try {
    await mergeRunningDailyRouteProfile(db, userId, row.user_id, row.activity_date);
  } catch (mergeErr) {
    console.warn(
      "[processRunningActivity] daily route merge 실패:",
      userId,
      row.activity_date,
      mergeErr && mergeErr.message ? mergeErr.message : mergeErr
    );
  }

  return {
    userId,
    activityId: row.activity_id,
    activityType: row.activity_type,
    upserted: true,
    efforts: effortsResult && effortsResult.efforts ? effortsResult.efforts : null,
  };
}

module.exports = {
  RUNNING_STRAVA_TYPES,
  isRunningStravaActivityType,
  buildLightweightSplitsMetric,
  fetchStravaActivityDetailForOwner,
  mergeRunningDailyRouteProfile,
  processRunningActivity,
};
