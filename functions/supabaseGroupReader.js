/**
 * Supabase — 오픈 라이딩·소모임 Read (Service Role).
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const groupResponseAdapter = require("./groupResponseAdapter");

/** @type {Map<string, string>} uuid → firebase uid */
let uuidToFirebaseCache = { map: new Map(), loadedAt: 0 };
const UUID_CACHE_MS = 5 * 60 * 1000;

async function getUuidToFirebaseMap(admin) {
  const now = Date.now();
  if (now - uuidToFirebaseCache.loadedAt < UUID_CACHE_MS && uuidToFirebaseCache.map.size) {
    return uuidToFirebaseCache.map;
  }
  const map = new Map();
  const snap = await admin.firestore().collection("users").select().get();
  const ns = supabaseDualWriteServer.uidNamespaceParam.value();
  const mode = supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5";
  snap.forEach((doc) => {
    const uid = doc.id;
    const uuid = supabaseDualWriteServer.resolveUserUuid(uid, ns, mode);
    if (uuid) map.set(String(uuid).toLowerCase(), uid);
  });
  uuidToFirebaseCache = { map, loadedAt: now };
  return map;
}

function attachFirebaseUids(row, uuidMap, fields) {
  if (!row) return row;
  const out = { ...row };
  for (const f of fields) {
    const uuid = row[f];
    if (uuid) {
      const fb = uuidMap.get(String(uuid).toLowerCase());
      if (fb) {
        const key = f === "host_user_id" ? "hostFirebaseUid"
          : f === "created_by" ? "createdByFirebaseUid"
          : f === "reviewed_by" ? "reviewedByFirebaseUid"
          : "firebaseUid";
        out[key] = fb;
      }
    }
  }
  return out;
}

async function fetchOpenRideByFirestoreId(admin, firestoreDocId) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return null;

  const { data: row, error } = await supabase
    .from("open_rides")
    .select("*")
    .eq("firestore_doc_id", firestoreDocId)
    .maybeSingle();
  if (error || !row) return null;

  const uuidMap = await getUuidToFirebaseMap(admin);
  const rideRow = attachFirebaseUids(row, uuidMap, ["host_user_id"]);

  const { data: parts } = await supabase
    .from("open_ride_participants")
    .select("*")
    .eq("ride_id", row.id);

  const participants = (parts || []).map((p) => {
    const fb = uuidMap.get(String(p.user_id).toLowerCase());
    return { ...p, firebaseUid: fb || p.user_id };
  });

  return groupResponseAdapter.adaptOpenRideToFirestoreDoc(rideRow, participants);
}

async function fetchOpenRidesInDateRange(admin, startYmd, endYmd) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];

  const { data: rows, error } = await supabase
    .from("open_rides")
    .select("*")
    .gte("ride_date", startYmd)
    .lte("ride_date", endYmd)
    .eq("status", "active")
    .order("ride_date", { ascending: true });
  if (error || !rows || !rows.length) return [];

  const uuidMap = await getUuidToFirebaseMap(admin);
  const rideIds = rows.map((r) => r.id);
  const { data: allParts } = await supabase
    .from("open_ride_participants")
    .select("*")
    .in("ride_id", rideIds);

  const partsByRide = new Map();
  for (const p of allParts || []) {
    const list = partsByRide.get(p.ride_id) || [];
    const fb = uuidMap.get(String(p.user_id).toLowerCase());
    list.push({ ...p, firebaseUid: fb || p.user_id });
    partsByRide.set(p.ride_id, list);
  }

  return rows
    .map((row) => {
      const rideRow = attachFirebaseUids(row, uuidMap, ["host_user_id"]);
      return groupResponseAdapter.adaptOpenRideToFirestoreDoc(
        rideRow,
        partsByRide.get(row.id) || []
      );
    })
    .filter(Boolean);
}

async function fetchRidingGroupByFirestoreId(admin, firestoreDocId, opts) {
  opts = opts || {};
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return null;

  const { data: row, error } = await supabase
    .from("riding_groups")
    .select("*")
    .eq("firestore_doc_id", firestoreDocId)
    .maybeSingle();
  if (error || !row) return null;

  const uuidMap = await getUuidToFirebaseMap(admin);
  const groupRow = attachFirebaseUids(row, uuidMap, [
    "created_by",
    "reviewed_by",
  ]);

  let members = [];
  let joinRequests = [];
  if (opts.includeMembers !== false) {
    const { data: memRows } = await supabase
      .from("riding_group_members")
      .select("*")
      .eq("group_id", row.id);
    members = (memRows || []).map((m) => {
      const fb = uuidMap.get(String(m.user_id).toLowerCase());
      return { ...m, firebaseUid: fb || m.user_id };
    });
  }
  if (opts.includeJoinRequests) {
    const { data: reqRows } = await supabase
      .from("riding_group_join_requests")
      .select("*")
      .eq("group_id", row.id);
    joinRequests = (reqRows || []).map((r) => {
      const fb = uuidMap.get(String(r.user_id).toLowerCase());
      return { ...r, firebaseUid: fb || r.user_id };
    });
  }

  return groupResponseAdapter.adaptRidingGroupToFirestoreDoc(
    groupRow,
    members,
    joinRequests
  );
}

async function fetchApprovedRidingGroups(admin, opts) {
  opts = opts || {};
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];

  let q = supabase
    .from("riding_groups")
    .select("*")
    .eq("status", "APPROVED")
    .order("created_at", { ascending: false });
  if (opts.limit) q = q.limit(opts.limit);

  const { data: rows, error } = await q;
  if (error || !rows) return [];

  const uuidMap = await getUuidToFirebaseMap(admin);
  return rows
    .map((row) => {
      const groupRow = attachFirebaseUids(row, uuidMap, ["created_by", "reviewed_by"]);
      return groupResponseAdapter.adaptRidingGroupToFirestoreDoc(groupRow, [], []);
    })
    .filter(Boolean);
}

async function fetchUserRideLogsForMonth(firebaseUid, year, month) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];
  const y = Number(year);
  const m0 = Number(month);
  if (!firebaseUid || !Number.isFinite(y) || !Number.isFinite(m0)) return [];

  const ns = supabaseDualWriteServer.uidNamespaceParam.value();
  const mode = supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5";
  const userUuid = supabaseDualWriteServer.resolveUserUuid(firebaseUid, ns, mode);
  if (!userUuid) return [];

  const start = new Date(y, m0, 1);
  const end = new Date(y, m0 + 1, 0);
  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
  const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("rides")
    .select(RIDE_LOG_SELECT)
    .eq("user_id", userUuid)
    .gte("ride_date", startStr)
    .lte("ride_date", endStr)
    .order("ride_date", { ascending: true });
  if (error) throw error;

  return mapRideRowsToTrainingLogs(data);
}

/** Firestore users/logs 호환 — JournalDetail Heart Rate·Power Profile 필드 포함 */
const RIDE_LOG_SELECT =
  "activity_id, source, activity_type, title, ride_date, workout_id, duration_sec, distance_km, elevation_gain_m, avg_speed_kmh, weight_at_ride_kg, ftp_at_time, avg_cadence, avg_hr, max_hr, max_hr_5sec, max_hr_1min, max_hr_5min, max_hr_10min, max_hr_20min, max_hr_40min, max_hr_60min, avg_watts, weighted_watts, max_watts, max_1min_watts, max_5min_watts, max_10min_watts, max_20min_watts, max_30min_watts, max_40min_watts, max_60min_watts, tss, intensity_factor, kilojoules, earned_points, efficiency_factor, rpe, tss_applied, summary_polyline, elevation_profile_json, route_profile_updated_at, time_in_zones_json";

const STRAVA_EXCLUDED_ACTIVITY_TYPES = new Set([
  "run",
  "swim",
  "walk",
  "trailrun",
  "weighttraining",
]);

function parseTimeInZonesFromRideRow(row) {
  if (!row) return null;
  const raw = row.time_in_zones_json;
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const power = parsed.power;
  const hr = parsed.hr;
  if ((!power || typeof power !== "object") && (!hr || typeof hr !== "object")) return null;
  return { power: power || {}, hr: hr || {} };
}

function isRidingRideRow(row) {
  const src = String((row && row.source) || "").toLowerCase();
  if (src !== "strava") return true;
  const act = String((row && row.activity_type) || "")
    .trim()
    .toLowerCase();
  if (!act) return true;
  return !STRAVA_EXCLUDED_ACTIVITY_TYPES.has(act);
}

function mapRideRowsToTrainingLogs(rows) {
  return (rows || []).filter(isRidingRideRow).map(mapRideRowToFirestoreTrainingLog);
}

/** @param {object} row Supabase rides row */
function mapRideRowToFirestoreTrainingLog(row) {
  return {
    id: row.activity_id || `${row.source || "ride"}:${row.ride_date || ""}`,
    activity_id: row.activity_id || null,
    source: row.source || "strava",
    activity_type: row.activity_type || null,
    title: row.title || "",
    date: row.ride_date || "",
    workout_id: row.workout_id || null,
    duration_sec: Number(row.duration_sec) || 0,
    time: Number(row.duration_sec) || 0,
    distance_km: row.distance_km != null ? Number(row.distance_km) : null,
    elevation_gain: row.elevation_gain_m != null ? Number(row.elevation_gain_m) : null,
    avg_speed_kmh: row.avg_speed_kmh != null ? Number(row.avg_speed_kmh) : null,
    weight:
      row.weight_at_ride_kg != null
        ? Number(row.weight_at_ride_kg)
        : row.weight != null
          ? Number(row.weight)
          : null,
    ftp_at_time: row.ftp_at_time != null ? Number(row.ftp_at_time) : null,
    avg_cadence: row.avg_cadence != null ? Number(row.avg_cadence) : null,
    avg_hr: row.avg_hr != null ? Number(row.avg_hr) : null,
    max_hr: row.max_hr != null ? Number(row.max_hr) : null,
    max_hr_5sec: (function () {
      const v5 = row.max_hr_5sec != null ? Number(row.max_hr_5sec) : 0;
      if (v5 > 0) return v5;
      const mh = row.max_hr != null ? Number(row.max_hr) : 0;
      return mh > 0 ? mh : null;
    })(),
    max_hr_1min: row.max_hr_1min != null ? Number(row.max_hr_1min) : null,
    max_hr_5min: row.max_hr_5min != null ? Number(row.max_hr_5min) : null,
    max_hr_10min: row.max_hr_10min != null ? Number(row.max_hr_10min) : null,
    max_hr_20min: row.max_hr_20min != null ? Number(row.max_hr_20min) : null,
    max_hr_40min: row.max_hr_40min != null ? Number(row.max_hr_40min) : null,
    max_hr_60min: row.max_hr_60min != null ? Number(row.max_hr_60min) : null,
    avg_watts: row.avg_watts != null ? Number(row.avg_watts) : null,
    weighted_watts: row.weighted_watts != null ? Number(row.weighted_watts) : null,
    max_watts: row.max_watts != null ? Number(row.max_watts) : null,
    max_1min_watts: row.max_1min_watts != null ? Number(row.max_1min_watts) : null,
    max_5min_watts: row.max_5min_watts != null ? Number(row.max_5min_watts) : null,
    max_10min_watts: row.max_10min_watts != null ? Number(row.max_10min_watts) : null,
    max_20min_watts: row.max_20min_watts != null ? Number(row.max_20min_watts) : null,
    max_30min_watts: row.max_30min_watts != null ? Number(row.max_30min_watts) : null,
    max_40min_watts: row.max_40min_watts != null ? Number(row.max_40min_watts) : null,
    max_60min_watts: row.max_60min_watts != null ? Number(row.max_60min_watts) : null,
    tss: row.tss != null ? Number(row.tss) : null,
    if: row.intensity_factor != null ? Number(row.intensity_factor) : null,
    kilojoules: row.kilojoules != null ? Number(row.kilojoules) : null,
    earned_points: row.earned_points != null ? Number(row.earned_points) : null,
    efficiency_factor:
      row.efficiency_factor != null ? Number(row.efficiency_factor) : null,
    rpe: row.rpe != null ? Number(row.rpe) : null,
    tss_applied: row.tss_applied === true,
    summary_polyline: row.summary_polyline != null ? String(row.summary_polyline) : null,
    elevation_profile:
      row.elevation_profile_json != null ? row.elevation_profile_json : null,
    elevation_profile_json:
      row.elevation_profile_json != null ? row.elevation_profile_json : null,
    route_profile_updated_at: row.route_profile_updated_at || null,
    time_in_zones: parseTimeInZonesFromRideRow(row),
    readBackend: "supabase",
  };
}

/**
 * 훈련일지 달력 — 최근 N건 (Service Role, Auth Bridge 불필요).
 * @param {string} firebaseUid
 * @param {number} [limit=200]
 */
async function fetchUserRideLogsRecent(firebaseUid, limit = 200) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];
  const uid = String(firebaseUid || "").trim();
  if (!uid) return [];

  const ns = supabaseDualWriteServer.uidNamespaceParam.value();
  const mode =
    supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5";
  const userUuid = supabaseDualWriteServer.resolveUserUuid(uid, ns, mode);
  if (!userUuid) return [];

  const cap = Math.min(1000, Math.max(1, Number(limit) || 200));
  const { data, error } = await supabase
    .from("rides")
    .select(RIDE_LOG_SELECT)
    .eq("user_id", userUuid)
    .order("ride_date", { ascending: false })
    .limit(cap);
  if (error) throw error;
  return mapRideRowsToTrainingLogs(data);
}

module.exports = {
  fetchOpenRideByFirestoreId,
  fetchOpenRidesInDateRange,
  fetchRidingGroupByFirestoreId,
  fetchApprovedRidingGroups,
  fetchUserRideLogsForMonth,
  fetchUserRideLogsRecent,
  mapRideRowToFirestoreTrainingLog,
  RIDE_LOG_SELECT,
  getUuidToFirebaseMap,
};
