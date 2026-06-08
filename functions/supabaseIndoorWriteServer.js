/**
 * Phase 5 — 실내 로그·포인트 Supabase Primary (Service Role).
 * Strava ingest(supabaseDualWriteServer)와 독립 트랙.
 *
 * Remote Config: indoor_write_status = OFF | SHADOW | CANARY | FULL
 * 롤백: indoor_write_status=OFF
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

const REMOTE_CONFIG_KEY_INDOOR_STATUS = "indoor_write_status";
const REMOTE_CONFIG_KEY_INDOOR_CANARY = "indoor_write_canary_percent";

/** @type {{ status: string, canaryPercent: number, lastFetchAt: number }} */
let indoorCache = {
  status: "OFF",
  canaryPercent: 10,
  lastFetchAt: 0,
};

function parseIndoorStatus(raw) {
  const n = String(raw || "")
    .trim()
    .toUpperCase();
  if (["OFF", "SHADOW", "CANARY", "FULL"].includes(n)) return n;
  return "OFF";
}

function readRcParameterValue(template, key) {
  const param = template.parameters && template.parameters[key];
  if (!param) return undefined;
  const dv = param.defaultValue;
  if (dv && dv.value !== undefined && dv.value !== null) {
    return String(dv.value);
  }
  return undefined;
}

async function refreshIndoorWriteFromRemoteConfig(admin, force = false) {
  const minInterval = 5 * 60 * 1000;
  const now = Date.now();
  if (!force && now - indoorCache.lastFetchAt < minInterval) {
    return indoorCache;
  }

  const envRaw = process.env.INDOOR_WRITE_STATUS;
  if (envRaw != null && String(envRaw).trim() !== "") {
    indoorCache.status = parseIndoorStatus(envRaw);
    const envCanary = Number(process.env.INDOOR_WRITE_CANARY_PERCENT);
    if (Number.isFinite(envCanary) && envCanary >= 0) {
      indoorCache.canaryPercent = Math.min(100, Math.trunc(envCanary));
    }
    indoorCache.lastFetchAt = now;
    return indoorCache;
  }

  if (!admin || !admin.remoteConfig) return indoorCache;

  try {
    const template = await admin.remoteConfig().getTemplate();
    const status = parseIndoorStatus(
      readRcParameterValue(template, REMOTE_CONFIG_KEY_INDOOR_STATUS)
    );
    let canaryPercent = Number(
      readRcParameterValue(template, REMOTE_CONFIG_KEY_INDOOR_CANARY)
    );
    if (!Number.isFinite(canaryPercent) || canaryPercent <= 0) {
      canaryPercent = 10;
    }
    indoorCache = {
      status,
      canaryPercent: Math.min(100, Math.max(0, Math.trunc(canaryPercent))),
      lastFetchAt: now,
    };
    console.log("[supabaseIndoorWriteServer] Remote Config", indoorCache);
  } catch (err) {
    console.warn("[supabaseIndoorWriteServer] Remote Config fetch 실패:", err);
  }
  return indoorCache;
}

function evaluateIndoorSupabasePrimary(firebaseUid) {
  if (process.env.INDOOR_SUPABASE_PRIMARY === "false") {
    return { usePrimary: false, reason: "INDOOR_SUPABASE_PRIMARY=false" };
  }
  const status = indoorCache.status;
  const uid = String(firebaseUid || "").trim();
  if (status === "OFF") {
    return { usePrimary: false, reason: "indoor_write_status=OFF" };
  }
  if (status === "FULL") {
    return { usePrimary: true, reason: "indoor_write_status=FULL", status };
  }
  if (status === "CANARY") {
    const inCanary = supabaseDualWriteServer.isUidInCanaryPercent(
      uid,
      indoorCache.canaryPercent
    );
    return {
      usePrimary: inCanary,
      reason: inCanary
        ? `indoor_write_status=CANARY(${indoorCache.canaryPercent}%)`
        : `indoor_write_status=CANARY(skip)`,
      status,
    };
  }
  return { usePrimary: false, reason: `indoor_write_status=${status}` };
}

function isIndoorFirestoreLogShadowEnabled() {
  if (String(process.env.INDOOR_FIRESTORE_LOG_SHADOW || "").toLowerCase() === "false") {
    return false;
  }
  return true;
}

async function upsertRideFromLog(admin, firebaseUid, logDocId, logData) {
  const row = supabaseDualWriteServer.mapTrainingLogToRideRow(
    firebaseUid,
    logDocId,
    logData,
    {
      uidNamespace: String(supabaseDualWriteServer.uidNamespaceParam.value() || "").trim(),
      uidMode: String(supabaseDualWriteServer.uidModeParam.value() || "v5").trim(),
    }
  );
  if (!row) throw new Error("ride row mapping failed");
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { error } = await supabase.from("rides").upsert(row, {
    onConflict: "user_id,activity_id",
    ignoreDuplicates: false,
  });
  if (error && error.code !== "23505") throw error;
  return row;
}

async function resolveUserId(firebaseUid) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const uidConfig = {
    uidNamespace: String(supabaseDualWriteServer.uidNamespaceParam.value() || "").trim(),
    uidMode: String(supabaseDualWriteServer.uidModeParam.value() || "v5").trim(),
  };
  return supabaseDualWriteServer.resolveRideUserIdForFirebaseUid(
    supabase,
    firebaseUid,
    uidConfig
  );
}

async function syncUserPoints(firebaseUid, patch) {
  const userUuid = await resolveUserId(firebaseUid);
  if (!userUuid) throw new Error("user uuid resolve failed");

  const update = {};
  if (patch.rem_points != null) update.rem_points = Math.trunc(Number(patch.rem_points));
  if (patch.acc_points != null) update.acc_points = Math.trunc(Number(patch.acc_points));
  if (patch.expiry_date != null && String(patch.expiry_date).trim()) {
    update.expiry_date = String(patch.expiry_date).slice(0, 10);
  }
  if (patch.last_training_date != null && String(patch.last_training_date).trim()) {
    update.last_training_date = String(patch.last_training_date).slice(0, 10);
  }
  if (!Object.keys(update).length) return;

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { error } = await supabase.from("users").update(update).eq("id", userUuid);
  if (error) throw error;
}

async function appendPointHistory(firebaseUid, payload) {
  const userUuid = await resolveUserId(firebaseUid);
  if (!userUuid) throw new Error("user uuid resolve failed");

  const firebaseLogId = payload.firebase_log_id
    ? String(payload.firebase_log_id).trim()
    : null;

  const row = {
    user_id: userUuid,
    source: payload.source === "strava" || payload.is_strava ? "strava" : "stelvio",
    is_strava: !!payload.is_strava,
    tss: Number(payload.tss) || 0,
    earned_points: Math.trunc(Number(payload.earned_points) || 0),
    points_before: Math.trunc(Number(payload.points_before) || 0),
    points_after: Math.trunc(Number(payload.points_after) || 0),
    points_used_for_subscription: Math.trunc(
      Number(payload.points_used_for_subscription) || 0
    ),
    subscription_threshold: Math.trunc(Number(payload.subscription_threshold) || 500),
    extension_count: Math.trunc(Number(payload.extension_count) || 0),
    extended_days: Math.trunc(Number(payload.extended_days) || 0),
    expiry_date_before: payload.expiry_date_before || null,
    expiry_date_after: payload.expiry_date_after || null,
    firebase_log_id: firebaseLogId,
    client_mileage_from_stelvio_log: !!payload.client_mileage_from_stelvio_log,
  };

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (firebaseLogId) {
    const { error } = await supabase.from("point_history").upsert(row, {
      onConflict: "user_id,firebase_log_id",
      ignoreDuplicates: false,
    });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("point_history").insert(row);
  if (error) throw error;
}

async function mirrorPointHistoryFromFirestoreDoc(firebaseUid, firestoreDoc) {
  const d = firestoreDoc || {};
  await appendPointHistory(firebaseUid, {
    is_strava: !!d.is_strava,
    tss: d.tss,
    earned_points: d.earned_points,
    points_before: d.points_before,
    points_after: d.points_after,
    points_used_for_subscription: d.points_used_for_subscription,
    subscription_threshold: d.subscription_threshold,
    extension_count: d.extension_count,
    extended_days: d.extended_days,
    expiry_date_before: d.expiry_date_before || d.subscription_expiry_date_before,
    expiry_date_after: d.expiry_date_after || d.subscription_expiry_date_after,
    firebase_log_id: d.users_training_log_id || d.firebase_log_id,
    client_mileage_from_stelvio_log: !!d.client_mileage_from_stelvio_log,
  });
}

module.exports = {
  refreshIndoorWriteFromRemoteConfig,
  evaluateIndoorSupabasePrimary,
  isIndoorFirestoreLogShadowEnabled,
  upsertRideFromLog,
  syncUserPoints,
  appendPointHistory,
  mirrorPointHistoryFromFirestoreDoc,
  appendServiceRoleSecret: supabaseDualWriteServer.appendServiceRoleSecret,
};
