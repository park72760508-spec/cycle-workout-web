/**
 * Strava 러닝·워킹 Webhook 전용 처리.
 *
 * [사이클 영향 검토 — 2026-06-10]
 * - index.js processStravaActivity / processOneUserStravaSync / isCyclingForMmp: 미수정
 * - Firestore users/logs(사이클) 경로: 이 모듈에서 호출하지 않음
 * - Supabase public.rides: touch 없음 → daily_summaries·랭킹 트리거 영향 없음
 * - public.activities 테이블에만 upsert
 */
const admin = require("firebase-admin");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

/** Webhook create 라우팅 대상 — 소문자 Set, 비교 시 normalize (Run·VirtualRun 등 대소문자 무관) */
const RUNNING_STRAVA_TYPES = new Set(["run", "virtualrun", "trailrun", "walk"]);

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
  let avgSpeedKmh = num(activity.average_speed);
  if (avgSpeedKmh != null) {
    avgSpeedKmh = Math.round(avgSpeedKmh * 3.6 * 100) / 100;
  }

  return {
    user_id: userId,
    source: "strava",
    activity_id: String(activity.id),
    activity_type: String(activity.type || activity.sport_type || "").trim(),
    title: activity.name ? String(activity.name) : null,
    activity_date: activityDate,
    duration_sec: durationSec,
    distance_km: distanceKm > 0 ? distanceKm : null,
    elevation_gain_m: num(activity.total_elevation_gain),
    avg_speed_kmh: avgSpeedKmh,
    avg_hr: int(activity.average_heartrate, null),
    max_hr: int(activity.max_heartrate, null),
    splits_metric: buildLightweightSplitsMetric(activity.splits_metric),
    updated_at: new Date().toISOString(),
  };
}

async function resolveStravaUserByOwnerId(db, ownerId) {
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
async function fetchStravaActivityDetailForOwner(db, ownerId, objectId) {
  const resolved = await resolveStravaUserByOwnerId(db, ownerId);
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

  async function writeOnce() {
    const { error } = await supabase.from("activities").upsert(row, {
      onConflict: "user_id,activity_id",
      ignoreDuplicates: false,
    });
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
 * Strava Run/Walk 활동 → Supabase activities upsert.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {number} ownerId Strava athlete id
 * @param {number|string} objectId Strava activity id
 * @param {object} [activityPrefetched] 라우팅 단계에서 이미 조회한 activity
 */
async function processRunningActivity(db, ownerId, objectId, activityPrefetched) {
  let activity = activityPrefetched;
  let userId = null;

  if (!activity) {
    const fetched = await fetchStravaActivityDetailForOwner(db, ownerId, objectId);
    if (!fetched.success || !fetched.activity) {
      const err = new Error(fetched.error || "running activity fetch failed");
      err.status = fetched.status || 0;
      err.userId = fetched.userId || null;
      throw err;
    }
    activity = fetched.activity;
    userId = fetched.userId;
  } else {
    const resolved = await resolveStravaUserByOwnerId(db, ownerId);
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
    throw new Error("mapStravaRunningToActivityRow failed");
  }

  await upsertRunningActivityToSupabase(userId, row);
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
  processRunningActivity,
};
