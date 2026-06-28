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

/** Supabase users.id → firebase_uid (필요 UUID만 조회 — 전체 users 스캔 방지) */
async function fetchFirebaseUidsForUserUuids(supabase, uuids) {
  const map = new Map();
  const uniq = [
    ...new Set(
      (uuids || [])
        .map((u) => (u != null ? String(u).trim().toLowerCase() : ""))
        .filter(Boolean)
    ),
  ];
  if (!supabase || !uniq.length) return map;
  const chunkSize = 80;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("users")
      .select("id, firebase_uid")
      .in("id", chunk);
    if (error) {
      console.warn("[supabaseGroupReader] users firebase_uid batch failed:", error.message);
      continue;
    }
    for (const row of data || []) {
      if (row && row.id && row.firebase_uid) {
        map.set(String(row.id).toLowerCase(), String(row.firebase_uid).trim());
      }
    }
  }
  return map;
}

async function resolveViewerUserUuid(supabase, firebaseUid) {
  const uid = String(firebaseUid || "").trim();
  if (!uid || !supabase) return null;
  const ns = supabaseDualWriteServer.uidNamespaceParam.value();
  const mode =
    supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5";
  return supabaseDualWriteServer.resolveRideUserIdForFirebaseUid(supabase, uid, {
    uidNamespace: ns,
    uidMode: mode,
  });
}

/** riding_groups 행 → 랭킹/클럽탭 `subscribeMyRidingGroupsAsMember` 목록 항목 */
function mapAdaptedGroupToMyGroupsListRow(doc) {
  if (!doc || !doc.id) return null;
  const gid = String(doc.id);
  const catNorm = String(doc.category || "CYCLE").toUpperCase() === "RUN" ? "RUN" : "CYCLE";
  return {
    id: gid,
    groupId: gid,
    name: doc.name != null ? String(doc.name) : "(이름 없음)",
    photoUrl: doc.photoUrl != null ? String(doc.photoUrl).trim() : "",
    memberCount: doc.memberCount != null ? Number(doc.memberCount) : null,
    createdBy: doc.createdBy != null ? String(doc.createdBy) : "",
    category: catNorm,
    resolvedCategory: catNorm,
    categoryExplicit: doc.category != null,
    regions: doc.regions != null ? doc.regions : null,
    isPublic: doc.isPublic !== false,
    rankingNotice: doc.rankingNotice || null,
    readBackend: doc.readBackend || "supabase",
  };
}

/**
 * 내가 멤버인 APPROVED 소mo임 — riding_group_members × riding_groups (1+1 쿼리).
 * Firestore U×G 리스너 대체.
 */
async function fetchMyRidingGroupsAsMember(admin, firebaseUid) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];

  const userUuid = await resolveViewerUserUuid(supabase, firebaseUid);
  if (!userUuid) return [];

  const { data: memRows, error: memErr } = await supabase
    .from("riding_group_members")
    .select("group_id")
    .eq("user_id", userUuid);
  if (memErr) throw memErr;
  if (!memRows || !memRows.length) return [];

  const groupUuids = [
    ...new Set(memRows.map((r) => r.group_id).filter(Boolean)),
  ];
  if (!groupUuids.length) return [];

  const { data: groupRows, error: grpErr } = await supabase
    .from("riding_groups")
    .select("*")
    .in("id", groupUuids)
    .eq("status", "APPROVED");
  if (grpErr) throw grpErr;
  if (!groupRows || !groupRows.length) return [];

  const creatorUuids = groupRows.map((g) => g.created_by).filter(Boolean);
  const uuidMap = await fetchFirebaseUidsForUserUuids(supabase, creatorUuids);

  return groupRows
    .map((row) => {
      const createdByFb = row.created_by
        ? uuidMap.get(String(row.created_by).toLowerCase()) || ""
        : "";
      const groupRow = {
        ...row,
        createdByFirebaseUid: createdByFb,
      };
      const adapted = groupResponseAdapter.adaptRidingGroupToFirestoreDoc(
        groupRow,
        [],
        []
      );
      return mapAdaptedGroupToMyGroupsListRow(adapted);
    })
    .filter(Boolean)
    .sort(function (a, b) {
      const mcA = a.memberCount != null ? Number(a.memberCount) : 0;
      const mcB = b.memberCount != null ? Number(b.memberCount) : 0;
      if (mcB !== mcA) return mcB - mcA;
      const na = String(a.name || "").toLowerCase();
      const nb = String(b.name || "").toLowerCase();
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    });
}

/**
 * 화면에 보이는 그룹 ID 중 내 멤버십 — 단일 배치 쿼리.
 */
async function fetchMyGroupMembershipFirestoreIds(admin, firebaseUid, groupFirestoreIds) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];

  const ids = (groupFirestoreIds || [])
    .map((g) => String(g || "").trim())
    .filter(Boolean);
  if (!ids.length) return [];

  const userUuid = await resolveViewerUserUuid(supabase, firebaseUid);
  if (!userUuid) return [];

  const { data: groups, error: gErr } = await supabase
    .from("riding_groups")
    .select("id, firestore_doc_id")
    .in("firestore_doc_id", ids);
  if (gErr) throw gErr;
  if (!groups || !groups.length) return [];

  const uuidByFs = new Map();
  const groupUuids = [];
  for (const g of groups) {
    if (!g || !g.id || !g.firestore_doc_id) continue;
    uuidByFs.set(String(g.id), String(g.firestore_doc_id));
    groupUuids.push(g.id);
  }
  if (!groupUuids.length) return [];

  const { data: memRows, error: mErr } = await supabase
    .from("riding_group_members")
    .select("group_id")
    .eq("user_id", userUuid)
    .in("group_id", groupUuids);
  if (mErr) throw mErr;

  const out = [];
  for (const m of memRows || []) {
    const fsId = uuidByFs.get(String(m.group_id));
    if (fsId) out.push(fsId);
  }
  return out;
}

/**
 * 내 소mo임들의 멤버 UID·프로필 맵 — M×K Firestore getDocs 대체.
 */
async function fetchMyGroupContactSet(admin, firebaseUid, groupFirestoreIds) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return { uids: [], map: {} };

  const ids = (groupFirestoreIds || [])
    .map((g) => String(g || "").trim())
    .filter(Boolean);
  if (!ids.length) return { uids: [], map: {} };

  const { data: groups, error: gErr } = await supabase
    .from("riding_groups")
    .select("id, firestore_doc_id")
    .in("firestore_doc_id", ids)
    .eq("status", "APPROVED");
  if (gErr) throw gErr;
  if (!groups || !groups.length) return { uids: [], map: {} };

  const groupUuids = groups.map((g) => g.id).filter(Boolean);
  if (!groupUuids.length) return { uids: [], map: {} };

  const { data: memRows, error: mErr } = await supabase
    .from("riding_group_members")
    .select("user_id, display_name, profile_image_url, role")
    .in("group_id", groupUuids);
  if (mErr) throw mErr;
  if (!memRows || !memRows.length) return { uids: [], map: {} };

  const memberUuids = [...new Set(memRows.map((r) => r.user_id).filter(Boolean))];
  const uuidMap = await fetchFirebaseUidsForUserUuids(supabase, memberUuids);

  const uidSet = new Set();
  const map = {};
  for (const row of memRows) {
    const fb = uuidMap.get(String(row.user_id).toLowerCase());
    if (!fb) continue;
    uidSet.add(fb);
    if (!map[fb]) {
      map[fb] = {
        userId: fb,
        name: row.display_name != null ? String(row.display_name).trim() : "",
        profileImageUrl: row.profile_image_url || null,
        role: row.role || "member",
      };
    }
  }
  return { uids: [...uidSet], map };
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

/** Supabase yearly_peaks → Firestore users/yearly_peaks/{year} 호환 객체 */
function mapYearlyPeaksRowToFirestoreDoc(row) {
  if (!row) return null;
  return {
    year: row.year != null ? Number(row.year) : null,
    weight: row.weight_kg != null ? Number(row.weight_kg) : null,
    max_hr: row.max_hr != null ? Number(row.max_hr) : null,
    max_hr_date: row.max_hr_date || null,
    max_1min_watts: row.max_1min_watts != null ? Number(row.max_1min_watts) : null,
    max_1min_wkg: row.max_1min_wkg != null ? Number(row.max_1min_wkg) : null,
    max_5min_watts: row.max_5min_watts != null ? Number(row.max_5min_watts) : null,
    max_5min_wkg: row.max_5min_wkg != null ? Number(row.max_5min_wkg) : null,
    max_10min_watts: row.max_10min_watts != null ? Number(row.max_10min_watts) : null,
    max_10min_wkg: row.max_10min_wkg != null ? Number(row.max_10min_wkg) : null,
    max_20min_watts: row.max_20min_watts != null ? Number(row.max_20min_watts) : null,
    max_20min_wkg: row.max_20min_wkg != null ? Number(row.max_20min_wkg) : null,
    max_40min_watts: row.max_40min_watts != null ? Number(row.max_40min_watts) : null,
    max_40min_wkg: row.max_40min_wkg != null ? Number(row.max_40min_wkg) : null,
    max_60min_watts: row.max_60min_watts != null ? Number(row.max_60min_watts) : null,
    max_60min_wkg: row.max_60min_wkg != null ? Number(row.max_60min_wkg) : null,
    max_watts: row.max_watts != null ? Number(row.max_watts) : null,
    max_wkg: row.max_wkg != null ? Number(row.max_wkg) : null,
    updated_at: row.updated_at || null,
    readBackend: "supabase",
  };
}

/**
 * PR 표시용 yearly_peaks (Service Role relay).
 * @param {string} firebaseUid
 * @param {number|string} year
 */
async function fetchYearlyPeaksForYear(firebaseUid, year) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return null;
  const uid = String(firebaseUid || "").trim();
  const yearNum = Number(year);
  if (!uid || !Number.isFinite(yearNum)) return null;

  const ns = supabaseDualWriteServer.uidNamespaceParam.value();
  const mode =
    supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5";
  const userUuid = supabaseDualWriteServer.resolveUserUuid(uid, ns, mode);
  if (!userUuid) return null;

  const { data, error } = await supabase
    .from("yearly_peaks")
    .select(
      "year, weight_kg, max_hr, max_hr_date, max_1min_watts, max_1min_wkg, max_5min_watts, max_5min_wkg, max_10min_watts, max_10min_wkg, max_20min_watts, max_20min_wkg, max_40min_watts, max_40min_wkg, max_60min_watts, max_60min_wkg, max_watts, max_wkg, updated_at"
    )
    .eq("user_id", userUuid)
    .eq("year", yearNum)
    .maybeSingle();
  if (error) throw error;
  return mapYearlyPeaksRowToFirestoreDoc(data);
}

const RUN_EFFORT_SELECT =
  "activity_id, speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k, hr_1k, hr_3k, hr_5k, hr_7k, hr_10k, hr_20k, hr_42k, cadence_1k, cadence_3k, cadence_5k, cadence_7k, cadence_10k, cadence_20k, cadence_42k, updated_at, created_at";
const RUN_ACTIVITY_SELECT = "activity_id, activity_date, activity_type, source";

function isRunningActivityType(type) {
  const t = String(type || "").trim().toLowerCase();
  return t === "run" || t === "virtualrun" || t === "trailrun";
}

function seoulTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftYmd(ymd, deltaDays) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + Number(deltaDays || 0));
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * RUN eTP — 최근 12개월 run_activity_efforts + activities.activity_date
 * @param {string} firebaseUid
 * @param {number} [limit=400]
 */
async function fetchUserRunEffortsRecent(firebaseUid, limit = 400) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];
  const uid = String(firebaseUid || "").trim();
  if (!uid) return [];

  const ns = supabaseDualWriteServer.uidNamespaceParam.value();
  const mode =
    supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5";
  const userUuid = supabaseDualWriteServer.resolveUserUuid(uid, ns, mode);
  if (!userUuid) return [];

  const cap = Math.min(1000, Math.max(1, Number(limit) || 400));
  const fromYmd = shiftYmd(seoulTodayYmd(), -365);

  const { data: efforts, error: effErr } = await supabase
    .from("run_activity_efforts")
    .select(RUN_EFFORT_SELECT)
    .eq("user_id", userUuid)
    .order("updated_at", { ascending: false })
    .limit(cap);
  if (effErr) throw effErr;
  if (!efforts || !efforts.length) return [];

  const activityIds = [
    ...new Set(efforts.map((e) => String(e.activity_id || "").trim()).filter(Boolean)),
  ];
  if (!activityIds.length) return [];

  const { data: acts, error: actErr } = await supabase
    .from("activities")
    .select(RUN_ACTIVITY_SELECT)
    .eq("user_id", userUuid)
    .in("activity_id", activityIds);
  if (actErr) throw actErr;

  const actMap = new Map();
  for (const a of acts || []) {
    if (!isRunningActivityType(a.activity_type)) continue;
    actMap.set(String(a.activity_id), a);
  }

  const merged = [];
  for (const e of efforts) {
    const act = actMap.get(String(e.activity_id));
    if (!act) continue;
    const activityDate = act.activity_date || null;
    if (activityDate && String(activityDate).slice(0, 10) < fromYmd) continue;
    merged.push({
      activity_id: e.activity_id,
      activity_date: activityDate,
      activity_type: act.activity_type,
      source: act.source,
      speed_1k: e.speed_1k,
      speed_3k: e.speed_3k,
      speed_5k: e.speed_5k,
      speed_7k: e.speed_7k,
      speed_10k: e.speed_10k,
      speed_20k: e.speed_20k,
      speed_42k: e.speed_42k,
      hr_1k: e.hr_1k,
      hr_3k: e.hr_3k,
      hr_5k: e.hr_5k,
      hr_7k: e.hr_7k,
      hr_10k: e.hr_10k,
      hr_20k: e.hr_20k,
      hr_42k: e.hr_42k,
      cadence_1k: e.cadence_1k,
      cadence_3k: e.cadence_3k,
      cadence_5k: e.cadence_5k,
      cadence_7k: e.cadence_7k,
      cadence_10k: e.cadence_10k,
      cadence_20k: e.cadence_20k,
      cadence_42k: e.cadence_42k,
      updated_at: e.updated_at,
      created_at: e.created_at,
      readBackend: "supabase",
    });
  }
  return merged;
}

/**
 * RUN 주간 TSS — Supabase activities.tss (오늘 포함 최근 7일, 서울 기준)
 * @param {string} firebaseUid
 * @returns {Promise<{ totalTss: number, fromYmd: string, toYmd: string, activityCount: number }>}
 */
async function fetchUserRunWeeklyTss(firebaseUid) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const empty = { totalTss: 0, fromYmd: "", toYmd: "", activityCount: 0 };
  if (!supabase) return empty;
  const uid = String(firebaseUid || "").trim();
  if (!uid) return empty;

  const ns = supabaseDualWriteServer.uidNamespaceParam.value();
  const mode =
    supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5";
  const userUuid = supabaseDualWriteServer.resolveUserUuid(uid, ns, mode);
  if (!userUuid) return empty;

  const toYmd = seoulTodayYmd();
  const fromYmd = shiftYmd(toYmd, -6);

  const { data, error } = await supabase
    .from("activities")
    .select("tss, activity_date, activity_type")
    .eq("user_id", userUuid)
    .gte("activity_date", fromYmd)
    .lte("activity_date", toYmd);
  if (error) throw error;

  let totalTss = 0;
  let activityCount = 0;
  for (const row of data || []) {
    if (!isRunningActivityType(row.activity_type)) continue;
    const tss = Number(row.tss);
    if (!Number.isFinite(tss) || tss <= 0 || tss >= 1200) continue;
    totalTss += tss;
    activityCount += 1;
  }

  return {
    totalTss: Math.round(totalTss * 10) / 10,
    fromYmd,
    toYmd,
    activityCount,
  };
}

const RUN_ACTIVITY_LOG_SELECT =
  "activity_id, source, activity_type, title, activity_date, duration_sec, distance_km, elevation_gain_m, avg_speed_kmh, avg_hr, max_hr, tss, summary_polyline";

function mapActivityRowToTrainingLog(row) {
  const dateStr = row.activity_date ? String(row.activity_date).slice(0, 10) : "";
  return {
    id: row.activity_id ? String(row.activity_id) : dateStr,
    activity_id: row.activity_id ? String(row.activity_id) : null,
    source: row.source || "strava",
    activity_type: row.activity_type || "Run",
    title: row.title || "",
    date: dateStr,
    duration_sec: Number(row.duration_sec) || 0,
    time: Number(row.duration_sec) || 0,
    distance_km: row.distance_km != null ? Number(row.distance_km) : null,
    elevation_gain:
      row.elevation_gain_m != null ? Number(row.elevation_gain_m) : null,
    avg_speed_kmh: row.avg_speed_kmh != null ? Number(row.avg_speed_kmh) : null,
    avg_hr: row.avg_hr != null ? Number(row.avg_hr) : null,
    max_hr: row.max_hr != null ? Number(row.max_hr) : null,
    tss: row.tss != null ? Number(row.tss) : null,
    summary_polyline: row.summary_polyline ? String(row.summary_polyline).trim() : "",
    readBackend: "supabase",
    sport_category: "run",
  };
}

/**
 * RUN 훈련 로그 — Supabase activities (최근 12개월, Run 계열)
 * @param {string} firebaseUid
 * @param {number} [limit=400]
 */
async function fetchUserRunActivitiesRecent(firebaseUid, limit = 400) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];
  const uid = String(firebaseUid || "").trim();
  if (!uid) return [];

  const ns = supabaseDualWriteServer.uidNamespaceParam.value();
  const mode =
    supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5";
  const userUuid = supabaseDualWriteServer.resolveUserUuid(uid, ns, mode);
  if (!userUuid) return [];

  const cap = Math.min(1000, Math.max(1, Number(limit) || 400));
  const fromYmd = shiftYmd(seoulTodayYmd(), -365);

  const { data, error } = await supabase
    .from("activities")
    .select(RUN_ACTIVITY_LOG_SELECT)
    .eq("user_id", userUuid)
    .gte("activity_date", fromYmd)
    .order("activity_date", { ascending: false })
    .limit(cap);
  if (error) throw error;

  return (data || [])
    .filter((row) => isRunningActivityType(row.activity_type))
    .map(mapActivityRowToTrainingLog);
}

module.exports = {
  fetchOpenRideByFirestoreId,
  fetchOpenRidesInDateRange,
  fetchRidingGroupByFirestoreId,
  fetchMyRidingGroupsAsMember,
  fetchMyGroupMembershipFirestoreIds,
  fetchMyGroupContactSet,
  fetchApprovedRidingGroups,
  fetchUserRideLogsForMonth,
  fetchUserRideLogsRecent,
  fetchUserRunEffortsRecent,
  fetchUserRunActivitiesRecent,
  fetchUserRunWeeklyTss,
  fetchYearlyPeaksForYear,
  mapYearlyPeaksRowToFirestoreDoc,
  mapRideRowToFirestoreTrainingLog,
  RIDE_LOG_SELECT,
  getUuidToFirebaseMap,
};
