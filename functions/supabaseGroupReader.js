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

module.exports = {
  fetchOpenRideByFirestoreId,
  fetchOpenRidesInDateRange,
  fetchRidingGroupByFirestoreId,
  fetchApprovedRidingGroups,
  getUuidToFirebaseMap,
};
