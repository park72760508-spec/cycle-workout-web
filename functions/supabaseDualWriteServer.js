/**
 * Cloud Functions — Strava ingest Dual-Write (Phase 3: Supabase Primary Canary 지원).
 * Service Role로 RLS 우회 upsert (Webhook·배치 Strava 동기화용).
 *
 * Secret: SUPABASE_SERVICE_ROLE_KEY
 * Params: SUPABASE_URL, STELVIO_UID_NAMESPACE, STELVIO_UID_UUID_MODE
 *
 * @see docs/DUAL_RUN_REMOTE_CONFIG.md, functions/stravaDualWrite.js
 *
 * Phase 3 쓰기 순서: dual_write_status·canary_percent 로 Supabase Primary / Firestore Shadow 결정.
 * 롤백: dual_write_status=OFF 또는 DUAL_WRITE_SUPABASE_PRIMARY=false
 */
const { v5: uuidv5 } = require("uuid");
const { defineSecret, defineString } = require("firebase-functions/params");
const { createClient } = require("@supabase/supabase-js");
const { sanitizePeakPowerWattsOnRow } = require("./peakPowerMonotonic");

const supabaseServiceRoleKey = defineSecret("SUPABASE_SERVICE_ROLE_KEY");
const supabaseUrlParam = defineString("SUPABASE_URL", {
  description: "Supabase project URL",
});
const uidNamespaceParam = defineString("STELVIO_UID_NAMESPACE", {
  default: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
});
const uidModeParam = defineString("STELVIO_UID_UUID_MODE", {
  default: "v5",
});

const REMOTE_CONFIG_KEY_STATUS = "dual_write_status";
const REMOTE_CONFIG_KEY_SHADOW_UIDS = "dual_write_shadow_uids";
const REMOTE_CONFIG_KEY_CANARY_PERCENT = "dual_write_canary_percent";

const DEFAULT_SHADOW_WHITELIST = ["Ys8GQZYyf3ZoEunSVGKnWNbtSkv2"];
const DEFAULT_CANARY_PERCENT = 10;
/** Phase 3-3: 이 비율 이상 CANARY 시 onUserLogWritten ④⑤ Supabase 트리거에 위임 */
const DEFAULT_FIREBASE_SIDE_EFFECTS_OFF_CANARY_PERCENT = 50;
const SHADOW_TTL_DAYS = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {{ status: string, shadowUids: string[], canaryPercent: number, lastFetchAt: number }} */
let dualRunCache = {
  status: "OFF",
  shadowUids: DEFAULT_SHADOW_WHITELIST.slice(),
  canaryPercent: DEFAULT_CANARY_PERCENT,
  lastFetchAt: 0,
};

let supabaseAdminClient = null;

function parseDualWriteStatus(raw) {
  const n = String(raw || "")
    .trim()
    .toUpperCase();
  if (["OFF", "SHADOW", "CANARY", "FULL"].includes(n)) return n;
  return "OFF";
}

function parseShadowUidList(raw) {
  if (!raw || !String(raw).trim()) return [];
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch (_) {
      /* comma split */
    }
  }
  return trimmed
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergeUidLists() {
  const sets = new Set();
  for (let i = 0; i < arguments.length; i++) {
    const arr = arguments[i];
    if (!arr) continue;
    for (const u of arr) {
      const t = String(u).trim();
      if (t) sets.add(t);
    }
  }
  return Array.from(sets);
}

function isUidInCanaryPercent(firebaseUid, percent) {
  const uid = String(firebaseUid || "").trim();
  if (!uid) return false;
  const clamped = Math.min(100, Math.max(0, Math.trunc(percent)));
  if (clamped <= 0) return false;
  if (clamped >= 100) return true;
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  }
  return hash % 100 < clamped;
}

function parseIngestBool(raw) {
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function isSupabasePrimaryIngestEnvDisabled() {
  const raw = process.env.DUAL_WRITE_SUPABASE_PRIMARY;
  if (raw == null || String(raw).trim() === "") return false;
  return !parseIngestBool(raw);
}

function getFirebaseSideEffectsOffCanaryPercent() {
  const raw = process.env.FIREBASE_LOG_SIDE_EFFECTS_OFF_CANARY_PERCENT;
  if (raw != null && String(raw).trim() !== "") {
    const n = Math.trunc(Number(raw));
    if (Number.isFinite(n)) return Math.min(100, Math.max(0, n));
  }
  return DEFAULT_FIREBASE_SIDE_EFFECTS_OFF_CANARY_PERCENT;
}

/**
 * Phase 4-2: FULL + Primary 성공 시 users/logs shadow 중단 (기본 ON).
 * 롤백: FIRESTORE_SHADOW_WRITE=true
 */
function isPhase4FirestoreLogShadowStopped() {
  if (parseIngestBool(process.env.FIRESTORE_SHADOW_WRITE) === true) return false;
  const raw = process.env.PHASE4_STOP_FIRESTORE_LOG_SHADOW;
  if (raw != null && String(raw).trim() !== "") {
    return parseIngestBool(raw);
  }
  return true;
}

function isFirestoreShadowWriteEnabled() {
  if (parseIngestBool(process.env.FIRESTORE_SHADOW_WRITE) === false) return false;
  if (String(process.env.FIRESTORE_SHADOW_WRITE || "").trim().toLowerCase() === "false") {
    return false;
  }
  if (
    isPhase4FirestoreLogShadowStopped() &&
    dualRunCache.status === "FULL"
  ) {
    return false;
  }
  return true;
}

/**
 * Phase 4-3: Supabase Primary ingest 성공 후 Firestore users/logs mirror 여부.
 * 기본 false — Primary OK면 mirror 생략, 실패 시에만 fallback write.
 * 롤백: STRAVA_FIRESTORE_MIRROR=true
 * @param {boolean} supabaseOk
 */
function shouldMirrorStravaLogToFirestoreAfterSupabaseOk(supabaseOk) {
  if (!supabaseOk) return true;
  return parseIngestBool(process.env.STRAVA_FIRESTORE_MIRROR) === true;
}

function isOnUserLogWrittenEnabled() {
  const raw = process.env.ON_USER_LOG_WRITTEN_ENABLED;
  if (raw != null && String(raw).trim() !== "") {
    return parseIngestBool(raw);
  }
  return false;
}

/**
 * Phase 3 — Supabase Primary ingest 대상 UID (CANARY·SHADOW·FULL).
 * OFF 이면 Firestore Primary(레거시) 유지.
 */
function evaluateSupabasePrimaryIngest(firebaseUid) {
  if (isSupabasePrimaryIngestEnvDisabled()) {
    return { usePrimary: false, reason: "DUAL_WRITE_SUPABASE_PRIMARY=false" };
  }
  if (process.env.SUPABASE_INGEST_DUAL_WRITE === "false") {
    return { usePrimary: false, reason: "SUPABASE_INGEST_DUAL_WRITE=false" };
  }

  const status = dualRunCache.status;
  const uid = String(firebaseUid || "").trim();

  if (status === "OFF") {
    return { usePrimary: false, reason: "dual_write_status=OFF" };
  }
  if (status === "FULL") {
    return { usePrimary: true, reason: "dual_write_status=FULL", status };
  }
  if (status === "SHADOW") {
    const inShadow =
      dualRunCache.shadowUids.includes(uid) ||
      DEFAULT_SHADOW_WHITELIST.includes(uid);
    return {
      usePrimary: inShadow,
      reason: inShadow ? "dual_write_status=SHADOW(uid)" : "dual_write_status=SHADOW(skip)",
      status,
    };
  }
  if (status === "CANARY") {
    const inCanary = isUidInCanaryPercent(uid, dualRunCache.canaryPercent);
    return {
      usePrimary: inCanary,
      reason: inCanary
        ? `dual_write_status=CANARY(${dualRunCache.canaryPercent}%)`
        : `dual_write_status=CANARY(skip_${dualRunCache.canaryPercent}%)`,
      status,
      canaryPercent: dualRunCache.canaryPercent,
    };
  }

  return { usePrimary: false, reason: `dual_write_status=${status || "unknown"}` };
}

/**
 * onUserLogWritten ③ Supabase upsert 생략 — Primary 경로에서 이미 rides upsert 됨.
 */
function shouldSkipOnUserLogWrittenSupabaseUpsert(firebaseUid) {
  return evaluateSupabasePrimaryIngest(firebaseUid).usePrimary === true;
}

/**
 * onUserLogWritten ④⑤ 생략 — Supabase PG 트리거(yearly_peaks·open_ride)에 위임.
 * CANARY ≥50% 또는 FULL/SHADOW(primary UID) 에서 Primary ingest 사용자만.
 */
function shouldSkipFirebaseLogSideEffects(firebaseUid) {
  const primary = evaluateSupabasePrimaryIngest(firebaseUid);
  if (!primary.usePrimary) return false;

  const status = dualRunCache.status;
  if (status === "FULL" || status === "SHADOW") return true;
  if (status === "CANARY") {
    return dualRunCache.canaryPercent >= getFirebaseSideEffectsOffCanaryPercent();
  }
  return false;
}

function getShadowTtlDays() {
  const raw = process.env.FIRESTORE_SHADOW_TTL_DAYS;
  const n = raw != null ? Math.trunc(Number(raw)) : SHADOW_TTL_DAYS;
  return Number.isFinite(n) && n > 0 ? n : SHADOW_TTL_DAYS;
}

/**
 * Secondary **쓰기**(Strava·훈련 ingest) — 전 사용자 대상.
 * SHADOW/CANARY/FULL 은 “Secondary 기록 켜짐” 의미만 가지며, UID별 쓰기 제한은 하지 않음.
 * 읽기 Canary(랭킹 MV)는 rankingReadConfig (SUPABASE_WHITELIST_UIDS / USE_SUPABASE_GLOBAL) 전용.
 */
function evaluateSecondaryIngestWrite(firebaseUid) {
  const status = dualRunCache.status;
  const uid = String(firebaseUid || "").trim();

  if (process.env.SUPABASE_INGEST_DUAL_WRITE === "false") {
    return {
      execute: false,
      status: "OFF",
      reason: "SUPABASE_INGEST_DUAL_WRITE=false",
    };
  }

  if (status === "OFF") {
    return { execute: false, status, reason: "dual_write_status=OFF" };
  }

  return {
    execute: true,
    status,
    reason: `dual_write_status=${status}, ingest=all_users`,
    userId: uid,
  };
}

/** @deprecated 읽기 라우팅용 — 쓰기는 evaluateSecondaryIngestWrite 사용 */
function evaluateSupabaseDualWrite(firebaseUid) {
  return evaluateSecondaryIngestWrite(firebaseUid);
}

function readRcParameterValue(template, key) {
  const param = template.parameters && template.parameters[key];
  if (!param) return undefined;
  const dv = param.defaultValue;
  if (dv && dv.value !== undefined && dv.value !== null) {
    return String(dv.value);
  }
  const cv = param.conditionalValues;
  if (cv && typeof cv === "object") {
    for (const k of Object.keys(cv)) {
      const entry = cv[k];
      if (entry && entry.value !== undefined && entry.value !== null) {
        return String(entry.value);
      }
    }
  }
  return undefined;
}

async function refreshDualRunFromRemoteConfig(admin, force = false) {
  const minInterval = 5 * 60 * 1000;
  const now = Date.now();
  if (!force && now - dualRunCache.lastFetchAt < minInterval) {
    return dualRunCache;
  }

  const envRaw = process.env.DUAL_WRITE_STATUS;
  const envStatus = parseDualWriteStatus(envRaw);
  if (envRaw != null && String(envRaw).trim() !== "") {
    dualRunCache.status = envStatus;
    const envCanary = Number(process.env.DUAL_WRITE_CANARY_PERCENT);
    if (Number.isFinite(envCanary) && envCanary >= 0) {
      dualRunCache.canaryPercent = Math.min(100, Math.trunc(envCanary));
    }
    dualRunCache.lastFetchAt = now;
    console.log("[supabaseDualWriteServer] DUAL_WRITE_STATUS env", envStatus);
    return dualRunCache;
  }

  if (!admin || !admin.remoteConfig) {
    return dualRunCache;
  }

  try {
    const template = await admin.remoteConfig().getTemplate();
    const status = parseDualWriteStatus(
      readRcParameterValue(template, REMOTE_CONFIG_KEY_STATUS)
    );
    const rcShadow = parseShadowUidList(
      readRcParameterValue(template, REMOTE_CONFIG_KEY_SHADOW_UIDS)
    );
    let canaryPercent = Number(
      readRcParameterValue(template, REMOTE_CONFIG_KEY_CANARY_PERCENT)
    );
    if (!Number.isFinite(canaryPercent) || canaryPercent <= 0) {
      canaryPercent = DEFAULT_CANARY_PERCENT;
    }

    dualRunCache = {
      status,
      shadowUids: mergeUidLists(DEFAULT_SHADOW_WHITELIST, rcShadow),
      canaryPercent: Math.min(100, Math.max(0, Math.trunc(canaryPercent))),
      lastFetchAt: now,
    };
    console.log("[supabaseDualWriteServer] Remote Config", {
      status: dualRunCache.status,
      shadowCount: dualRunCache.shadowUids.length,
      canaryPercent: dualRunCache.canaryPercent,
    });
  } catch (err) {
    console.warn("[supabaseDualWriteServer] Remote Config fetch 실패:", err);
  }
  return dualRunCache;
}

function resolveUserUuid(firebaseUid, uidNamespace, uidMode) {
  const raw = String(firebaseUid || "").trim();
  if (!raw) return null;
  if (uidMode === "literal" || UUID_RE.test(raw)) {
    return raw.toLowerCase();
  }
  return uuidv5(raw, uidNamespace);
}

function num(v, fallback = null) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v, fallback = 0) {
  const n = num(v, fallback);
  return n == null ? fallback : Math.trunc(n);
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Firestore log.date → 서울 YMD (랭킹 day bucket·daily_summaries와 동일) */
function toSeoulRideDateYmd(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    }
    return null;
  }
  let d = null;
  if (typeof raw === "object" && raw !== null && typeof raw.toDate === "function") {
    d = raw.toDate();
  } else if (raw instanceof Date) {
    d = raw;
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function toRideDate(raw) {
  return toSeoulRideDateYmd(raw);
}

function mapTrainingLogToRideRow(firebaseUid, logDocId, log, uidConfig) {
  const userId = resolveUserUuid(
    firebaseUid,
    uidConfig.uidNamespace,
    uidConfig.uidMode
  );
  const rideDate = toRideDate(log.date);
  if (!userId || !rideDate) return null;

  const sourceRaw = str(log.source)?.toLowerCase();
  const source = sourceRaw === "strava" ? "strava" : "stelvio";
  let activityId = str(log.activity_id);
  if (!activityId) {
    activityId = source === "strava" ? logDocId : "stelvio:" + logDocId;
  }

  const duration = int(log.duration_sec) || int(log.time) || 0;
  const weightForPeaks = num(log.weight) || num(log.weight_at_ride_kg) || null;

  const row = {
    user_id: userId,
    source,
    activity_id: activityId,
    activity_type: str(log.activity_type),
    title: str(log.title),
    ride_date: rideDate,
    workout_id: str(log.workout_id),
    duration_sec: duration,
    distance_km: num(log.distance_km),
    elevation_gain_m: num(log.elevation_gain),
    avg_speed_kmh: num(log.avg_speed_kmh),
    weight_at_ride_kg: num(log.weight),
    ftp_at_time: num(log.ftp_at_time),
    avg_watts: num(log.avg_watts),
    weighted_watts: num(log.weighted_watts),
    max_watts: num(log.max_watts),
    tss: num(log.tss) ?? 0,
    intensity_factor: num(log.if),
    kilojoules: num(log.kilojoules),
    earned_points: int(log.earned_points, 0),
    avg_hr: int(log.avg_hr, 0) || null,
    max_hr: int(log.max_hr, 0) || null,
    max_hr_5sec: int(log.max_hr_5sec, 0) || null,
    avg_cadence: int(log.avg_cadence, 0) || null,
    efficiency_factor: num(log.efficiency_factor),
    rpe: int(log.rpe, 0) || null,
    max_1min_watts: num(log.max_1min_watts),
    max_5min_watts: num(log.max_5min_watts),
    max_10min_watts: num(log.max_10min_watts),
    max_20min_watts: num(log.max_20min_watts),
    max_30min_watts: num(log.max_30min_watts),
    max_40min_watts: num(log.max_40min_watts),
    max_60min_watts: num(log.max_60min_watts),
    max_hr_1min: int(log.max_hr_1min, 0) || null,
    max_hr_5min: int(log.max_hr_5min, 0) || null,
    max_hr_10min: int(log.max_hr_10min, 0) || null,
    max_hr_20min: int(log.max_hr_20min, 0) || null,
    max_hr_40min: int(log.max_hr_40min, 0) || null,
    max_hr_60min: int(log.max_hr_60min, 0) || null,
    tss_applied: Boolean(log.tss_applied),
    summary_polyline: str(log.summary_polyline),
    elevation_profile_json:
      log.elevation_profile != null
        ? log.elevation_profile
        : log.elevation_profile_json != null
          ? log.elevation_profile_json
          : null,
    route_profile_updated_at: log.route_profile_updated_at || null,
    time_in_zones_json:
      log.time_in_zones && typeof log.time_in_zones === "object"
        ? log.time_in_zones
        : null,
  };
  if (weightForPeaks != null && weightForPeaks > 0) {
    sanitizePeakPowerWattsOnRow(row, weightForPeaks);
  }
  return row;
}

function getSupabaseAdminClient() {
  const url = String(supabaseUrlParam.value() || "").trim();
  let serviceKey;
  try {
    serviceKey = String(supabaseServiceRoleKey.value() || "").trim();
  } catch (err) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY Secret 미연결: " + err.message);
  }
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 미설정");
  }
  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseAdminClient;
}

async function writeRideToSupabase(rideRow) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("rides").upsert(rideRow, {
    onConflict: "user_id,activity_id",
    ignoreDuplicates: false,
  });
  if (error) {
    if (error.code === "23505") return;
    throw error;
  }
}

async function resolveSupabaseUserIdForFirebaseUid(firebaseUid) {
  const uidConfig = {
    uidNamespace: String(uidNamespaceParam.value() || "").trim(),
    uidMode: String(uidModeParam.value() || "v5").trim(),
  };
  const supabase = getSupabaseAdminClient();
  return resolveRideUserIdForFirebaseUid(supabase, firebaseUid, uidConfig);
}

/** Phase 4 — shadow 중단 시 Strava activity_id 중복·TSS 조회용 */
async function fetchStravaActivityIdsForUser(firebaseUid, sinceDateStr) {
  const userId = await resolveSupabaseUserIdForFirebaseUid(firebaseUid);
  if (!userId) return new Set();

  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from("rides")
    .select("activity_id")
    .eq("user_id", userId)
    .eq("source", "strava");
  if (sinceDateStr) {
    query = query.gte("ride_date", sinceDateStr);
  }
  const { data, error } = await query.limit(5000);
  if (error) throw error;

  const ids = new Set();
  for (const row of data || []) {
    const id = str(row.activity_id);
    if (id) ids.add(id);
  }
  return ids;
}

/** Phase 4 — shadow 중단 시 특정 activity_id 존재 여부 (range query 대신 in 필터) */
async function fetchStravaActivityIdsExistForUser(firebaseUid, activityIds) {
  const userId = await resolveSupabaseUserIdForFirebaseUid(firebaseUid);
  if (!userId) return new Set();

  const list = [...new Set((activityIds || []).map((id) => str(id)).filter(Boolean))];
  if (list.length === 0) return new Set();

  const supabase = getSupabaseAdminClient();
  const ids = new Set();
  const chunkSize = 100;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("rides")
      .select("activity_id")
      .eq("user_id", userId)
      .eq("source", "strava")
      .in("activity_id", chunk);
    if (error) throw error;
    for (const row of data || []) {
      const id = str(row.activity_id);
      if (id) ids.add(id);
    }
  }
  return ids;
}

async function fetchStravaTssSumForDate(firebaseUid, dateStr) {
  const userId = await resolveSupabaseUserIdForFirebaseUid(firebaseUid);
  if (!userId || !dateStr) return 0;

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("rides")
    .select("tss, activity_type, distance_km")
    .eq("user_id", userId)
    .eq("source", "strava")
    .eq("ride_date", dateStr);
  if (error) throw error;

  const excluded = new Set(["run", "swim", "walk", "trailrun", "weighttraining"]);
  let sum = 0;
  for (const row of data || []) {
    const activityType = str(row.activity_type);
    if (activityType && excluded.has(activityType.toLowerCase())) continue;
    const dist = num(row.distance_km, 0) || 0;
    if (dist <= 0) continue;
    sum += num(row.tss, 0) || 0;
  }
  return sum;
}

function isSupabaseForeignKeyUserError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || error.details || "");
  return (
    code === "23503" &&
    (
      message.includes("rides_user_id_fkey") ||
      message.includes("rides") ||
      message.includes("user_id")
    )
  );
}

async function resolveRideUserIdForFirebaseUid(supabase, firebaseUid, uidConfig) {
  const fallbackId = resolveUserUuid(
    firebaseUid,
    uidConfig.uidNamespace,
    uidConfig.uidMode
  );
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("firebase_uid", String(firebaseUid || "").trim())
      .maybeSingle();
    if (error) {
      console.warn("[supabaseDualWriteServer] firebase_uid 사용자 매핑 조회 실패:", {
        firebaseUid,
        message: error.message || String(error),
      });
      return fallbackId;
    }
    return data && data.id ? String(data.id) : fallbackId;
  } catch (err) {
    console.warn("[supabaseDualWriteServer] firebase_uid 사용자 매핑 예외:", {
      firebaseUid,
      message: err && err.message ? err.message : String(err),
    });
    return fallbackId;
  }
}

const EXCLUDED_RANKING_ACTIVITY_TYPES = new Set([
  "run",
  "swim",
  "walk",
  "trailrun",
  "weighttraining",
]);

function isCyclingLogForRankingSync(logDoc) {
  const source = String((logDoc && logDoc.source) || "").toLowerCase();
  if (source !== "strava") return true;
  const type = String((logDoc && logDoc.activity_type) || "")
    .trim()
    .toLowerCase();
  if (!type) return true;
  return !EXCLUDED_RANKING_ACTIVITY_TYPES.has(type);
}

/**
 * Firestore training·Strava log → Supabase rides upsert (주간 TSS·랭킹 원천).
 * @param {import('firebase-admin')} admin
 * @param {string} userId Firebase UID
 * @param {string} logDocId Firestore logs 문서 ID
 * @param {object} logDoc 저장된 log 필드
 */
async function runSecondaryAfterLogSave(admin, userId, logDocId, logDoc, options = {}) {
  await refreshDualRunFromRemoteConfig(admin, true);
  let decision = evaluateSecondaryIngestWrite(userId);
  const forceStravaIngest =
    options.force === true || process.env.SUPABASE_STRAVA_INGEST_ALWAYS !== "false";
  if (!decision.execute) {
    if (
      forceStravaIngest &&
      process.env.SUPABASE_INGEST_DUAL_WRITE !== "false"
    ) {
      decision = {
        execute: true,
        status: "FORCED",
        reason: `${decision.reason}; strava_ingest_forced`,
        userId,
      };
    } else {
      console.log(
        "[supabaseDualWriteServer] strava secondary 스킵:",
        decision.reason
      );
      return { skipped: true, reason: decision.reason };
    }
  }

  if (!logDocId || !logDoc) {
    console.warn("[supabaseDualWriteServer] strava logDocId/log 없음");
    return { skipped: true, reason: "missing log payload" };
  }

  const uidConfig = {
    uidNamespace: uidNamespaceParam.value(),
    uidMode: uidModeParam.value() === "literal" ? "literal" : "v5",
  };

  const row = mapTrainingLogToRideRow(userId, logDocId, logDoc, uidConfig);
  if (!row) {
    console.warn("[supabaseDualWriteServer] strava ride row 매핑 실패", {
      userId,
      logDocId,
      date: logDoc.date,
    });
    return { skipped: true, reason: "map failed" };
  }

  const supabase = getSupabaseAdminClient();
  row.user_id = await resolveRideUserIdForFirebaseUid(supabase, userId, uidConfig);
  try {
    await writeRideToSupabase(row);
  } catch (error) {
    if (!isSupabaseForeignKeyUserError(error)) {
      throw error;
    }
    console.warn("[supabaseDualWriteServer] rides user_id FK 실패, Supabase 사용자 보정 후 재시도:", {
      userId,
      logDocId,
      mappedUserId: row.user_id,
      message: error.message || String(error),
    });
    const supabaseUserProvision = require("./supabaseUserProvision");
    await supabaseUserProvision.provisionSupabaseUserAfterProfile(admin, userId);
    row.user_id = await resolveRideUserIdForFirebaseUid(supabase, userId, uidConfig);
    await writeRideToSupabase(row);
  }
  console.log("[supabaseDualWriteServer] rides upsert OK", {
    userId,
    activity_id: row.activity_id,
    ride_date: row.ride_date,
    source: row.source,
    status: decision.status,
  });
  return { skipped: false, activity_id: row.activity_id };
}

/** @deprecated runSecondaryAfterLogSave 와 동일 */
async function runSecondaryAfterStravaLogSave(admin, userId, logDocId, logDoc, options = {}) {
  return runSecondaryAfterLogSave(admin, userId, logDocId, logDoc, options);
}

async function syncUserLogsInRangeToSupabase(db, admin, userId, startStr, endStr) {
  const rankingDayRollup = require("./rankingDayRollup");
  const dates = rankingDayRollup.listInclusiveYmdsSeoul(startStr, endStr);
  const dateSet = new Set(dates);
  let synced = 0;
  const seen = new Set();

  const tryUpsert = async (doc) => {
    if (!doc || seen.has(doc.id)) return;
    const data = doc.data() || {};
    if (!isCyclingLogForRankingSync(data)) return;
    const ymd = rankingDayRollup.normalizeLogDateToSeoulYmd(data.date);
    if (!ymd || !dateSet.has(ymd)) return;
    seen.add(doc.id);
    const result = await runSecondaryAfterLogSave(admin, userId, doc.id, data, {
      force: true,
    });
    if (result && !result.skipped) synced += 1;
  };

  const collectDocs = async (snap) => {
    for (const doc of snap.docs) {
      /* eslint-disable no-await-in-loop */
      await tryUpsert(doc);
      /* eslint-enable no-await-in-loop */
    }
  };

  try {
    const rangedStr = await db
      .collection("users")
      .doc(userId)
      .collection("logs")
      .where("date", ">=", startStr)
      .where("date", "<=", endStr)
      .get();
    await collectDocs(rangedStr);
  } catch (rangeErr) {
    console.warn(
      "[supabaseDualWriteServer] string date range query failed:",
      userId,
      rangeErr && rangeErr.message ? rangeErr.message : rangeErr
    );
  }

  try {
    const tsStart = admin.firestore.Timestamp.fromDate(new Date(`${startStr}T00:00:00+09:00`));
    const tsEnd = admin.firestore.Timestamp.fromDate(new Date(`${endStr}T23:59:59.999+09:00`));
    const rangedTs = await db
      .collection("users")
      .doc(userId)
      .collection("logs")
      .where("date", ">=", tsStart)
      .where("date", "<=", tsEnd)
      .get();
    await collectDocs(rangedTs);
  } catch (tsRangeErr) {
    console.warn(
      "[supabaseDualWriteServer] timestamp date range query failed:",
      userId,
      tsRangeErr && tsRangeErr.message ? tsRangeErr.message : tsRangeErr
    );
  }

  try {
    const recent = await db
      .collection("users")
      .doc(userId)
      .collection("logs")
      .orderBy("date", "desc")
      .limit(400)
      .get();
    await collectDocs(recent);
  } catch (recentErr) {
    console.warn(
      "[supabaseDualWriteServer] recent log scan failed:",
      userId,
      recentErr && recentErr.message ? recentErr.message : recentErr
    );
  }

  return synced;
}

const RANKING_LOG_SYNC_CONCURRENCY = 8;

/**
 * Firestore ranking_day_totals → Supabase daily_summaries TSS/KM (Stelvio rides 누락 보정).
 * @returns {Promise<number>} upserted day count
 */
async function syncRankingDayBucketsToSupabaseForUser(db, userId, startStr, endStr) {
  const rankingDayRollup = require("./rankingDayRollup");
  if (!db || !userId || !startStr || !endStr) return 0;

  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) return 0;
  const userData = userSnap.data() || {};

  await rankingDayRollup.ensureRankingBucketsFilledForRange(
    db,
    userId,
    userData,
    startStr,
    endStr,
    false
  );

  const dates = rankingDayRollup.listInclusiveYmdsSeoul(startStr, endStr);
  if (!dates.length) return 0;

  const refs = dates.map((ymd) => rankingDayRollup.bucketRef(db, userId, ymd));
  const snaps = await rankingDayRollup.chunkedGetAll(db, refs, 30);
  const buckets = [];
  snaps.forEach((snap, i) => {
    if (!snap || !snap.exists) return;
    const b = snap.data() || {};
    const tssStrava = Number(b.tss_strava_sum) || 0;
    const tssStelvio = Number(b.tss_stelvio_sum) || 0;
    const kmStrava = Number(b.km_strava_sum) || 0;
    const kmStelvio = Number(b.km_stelvio_sum) || 0;
    if (tssStrava <= 0 && tssStelvio <= 0 && kmStrava <= 0 && kmStelvio <= 0) return;
    buckets.push({
      summary_date: dates[i],
      tss_strava_sum: Math.round(tssStrava * 100) / 100,
      tss_stelvio_sum: Math.round(tssStelvio * 100) / 100,
      km_strava_sum: Math.round(kmStrava * 1000) / 1000,
      km_stelvio_sum: Math.round(kmStelvio * 1000) / 1000,
    });
  });
  if (!buckets.length) return 0;

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.rpc("fn_sync_daily_summary_buckets_from_firestore", {
    p_firebase_uid: userId,
    p_buckets: buckets,
  });
  if (error) {
    throw error;
  }
  return Number(data) || buckets.length;
}

/**
 * 주간 TSS Supabase parity — rides 로그 upsert + ranking_day_totals → daily_summaries.
 */
async function syncUsersWeeklyTssParityToSupabase(db, admin, userIds, startStr, endStr) {
  if (!db || !admin || !userIds || !userIds.length || !startStr || !endStr) {
    return { ridesSynced: 0, bucketsSynced: 0 };
  }
  const uniqueIds = Array.from(
    new Set((userIds || []).map((id) => String(id || "").trim()).filter(Boolean))
  );
  let ridesSynced = 0;
  let bucketsSynced = 0;

  for (let i = 0; i < uniqueIds.length; i += RANKING_LOG_SYNC_CONCURRENCY) {
    const batch = uniqueIds.slice(i, i + RANKING_LOG_SYNC_CONCURRENCY);
    /* eslint-disable no-await-in-loop */
    const results = await Promise.all(
      batch.map(async (userId) => {
        let rides = 0;
        let buckets = 0;
        try {
          rides = await syncUserLogsInRangeToSupabase(db, admin, userId, startStr, endStr);
        } catch (rideErr) {
          console.warn(
            "[supabaseDualWriteServer] weekly TSS rides sync:",
            userId,
            rideErr && rideErr.message ? rideErr.message : rideErr
          );
        }
        try {
          buckets = await syncRankingDayBucketsToSupabaseForUser(db, userId, startStr, endStr);
        } catch (bucketErr) {
          console.warn(
            "[supabaseDualWriteServer] weekly TSS bucket sync:",
            userId,
            bucketErr && bucketErr.message ? bucketErr.message : bucketErr
          );
        }
        return { rides, buckets };
      })
    );
    /* eslint-enable no-await-in-loop */
    results.forEach((r) => {
      ridesSynced += Number(r.rides) || 0;
      bucketsSynced += Number(r.buckets) || 0;
    });
  }

  return { ridesSynced, bucketsSynced };
}

/**
 * ranking_day_totals에 이번 주(또는 지정 구간) 활동이 있는 전체 사용자 Supabase TSS parity.
 * @returns {Promise<{ users: number, ridesSynced: number, bucketsSynced: number }>}
 */
async function runWeeklyTssSupabaseParityForActiveUsers(db, admin, startStr, endStr) {
  const rankingDayRollup = require("./rankingDayRollup");
  if (!db || !admin || !startStr || !endStr) {
    return { users: 0, ridesSynced: 0, bucketsSynced: 0 };
  }
  const activeUserIds = await rankingDayRollup.findUserIdsWithRankingDayTotalsInRange(
    db,
    startStr,
    endStr
  );
  if (!activeUserIds.length) {
    return { users: 0, ridesSynced: 0, bucketsSynced: 0 };
  }
  const sortedIds = activeUserIds.slice().sort();
  const result = await syncUsersWeeklyTssParityToSupabase(
    db,
    admin,
    sortedIds,
    startStr,
    endStr
  );
  return {
    users: sortedIds.length,
    ridesSynced: result.ridesSynced,
    bucketsSynced: result.bucketsSynced,
  };
}

/**
 * 주간 TSS 조회 전 — Firestore logs를 Supabase rides에 맞춤 (Stelvio 누락·ride_date UTC 오차 보정).
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {import('firebase-admin')} admin
 * @param {string[]} userIds Firebase UID
 * @param {string} startStr YYYY-MM-DD
 * @param {string} endStr YYYY-MM-DD
 */
async function syncUsersLogsToSupabaseForDateRange(db, admin, userIds, startStr, endStr) {
  if (!db || !admin || !userIds || !userIds.length || !startStr || !endStr) return { synced: 0 };
  const uniqueIds = Array.from(
    new Set((userIds || []).map((id) => String(id || "").trim()).filter(Boolean))
  );
  let synced = 0;
  for (let i = 0; i < uniqueIds.length; i += RANKING_LOG_SYNC_CONCURRENCY) {
    const batch = uniqueIds.slice(i, i + RANKING_LOG_SYNC_CONCURRENCY);
    /* eslint-disable no-await-in-loop */
    const counts = await Promise.all(
      batch.map(async (userId) => {
        try {
          return await syncUserLogsInRangeToSupabase(db, admin, userId, startStr, endStr);
        } catch (e) {
          console.warn(
            "[supabaseDualWriteServer] syncUsersLogsToSupabaseForDateRange:",
            userId,
            e && e.message ? e.message : e
          );
          return 0;
        }
      })
    );
    /* eslint-enable no-await-in-loop */
    counts.forEach((n) => {
      synced += Number(n) || 0;
    });
  }
  return { synced };
}

/** Cloud Function options.secrets 에 추가 */
function appendServiceRoleSecret(options) {
  const o = Object.assign({}, options);
  o.secrets = Array.isArray(o.secrets) ? o.secrets.slice() : [];
  if (!o.secrets.includes(supabaseServiceRoleKey)) {
    o.secrets.push(supabaseServiceRoleKey);
  }
  return o;
}

module.exports = {
  supabaseServiceRoleKey,
  supabaseUrlParam,
  uidNamespaceParam,
  uidModeParam,
  runSecondaryAfterLogSave,
  runSecondaryAfterStravaLogSave,
  syncUsersLogsToSupabaseForDateRange,
  syncRankingDayBucketsToSupabaseForUser,
  syncUsersWeeklyTssParityToSupabase,
  runWeeklyTssSupabaseParityForActiveUsers,
  toSeoulRideDateYmd,
  appendServiceRoleSecret,
  mapTrainingLogToRideRow,
  resolveRideUserIdForFirebaseUid,
  evaluateSecondaryIngestWrite,
  evaluateSupabasePrimaryIngest,
  shouldSkipOnUserLogWrittenSupabaseUpsert,
  shouldSkipFirebaseLogSideEffects,
  isFirestoreShadowWriteEnabled,
  shouldMirrorStravaLogToFirestoreAfterSupabaseOk,
  isPhase4FirestoreLogShadowStopped,
  isOnUserLogWrittenEnabled,
  getShadowTtlDays,
  evaluateSupabaseDualWrite,
  refreshDualRunFromRemoteConfig,
  resolveUserUuid,
  getSupabaseAdminClient,
  isUidInCanaryPercent,
  fetchStravaActivityIdsForUser,
  fetchStravaActivityIdsExistForUser,
  fetchStravaTssSumForDate,
};
