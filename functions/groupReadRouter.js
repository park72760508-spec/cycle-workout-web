/**
 * 라이딩 모임 Read Router — Supabase try-first, null이면 Firebase 폴백.
 */
const groupReadConfig = require("./groupReadConfig");
const supabaseGroupReader = require("./supabaseGroupReader");

/**
 * @param {import('firebase-admin')} admin
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {object} query req.query
 */
async function tryFetchOpenRideFromSupabase(admin, db, query) {
  const rideId = String(query.rideId || query.id || "").trim();
  const uid = String(query.uid || query.userId || "").trim() || null;
  if (!rideId) return null;

  const route = await groupReadConfig.shouldReadGroupsFromSupabase(admin, uid);
  if (route.route !== "supabase") return null;

  try {
    const doc = await supabaseGroupReader.fetchOpenRideByFirestoreId(admin, rideId);
    if (!doc) return null;
    return { success: true, ride: doc, readBackend: "supabase", readSource: "supabase" };
  } catch (err) {
    console.error("[groupReadRouter] open ride Supabase failed:", err.message || err);
    return null;
  }
}

/**
 * @param {import('firebase-admin')} admin
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {object} query req.query
 */
async function tryFetchOpenRidesRangeFromSupabase(admin, db, query) {
  const startStr = String(query.startStr || query.start || "").trim();
  const endStr = String(query.endStr || query.end || "").trim();
  const uid = String(query.uid || query.userId || "").trim() || null;
  if (!startStr || !endStr) return null;

  const route = await groupReadConfig.shouldReadGroupsFromSupabase(admin, uid);
  if (route.route !== "supabase") return null;

  try {
    const rides = await supabaseGroupReader.fetchOpenRidesInDateRange(
      admin,
      startStr,
      endStr
    );
    return {
      success: true,
      rides,
      startStr,
      endStr,
      readBackend: "supabase",
      readSource: "supabase",
    };
  } catch (err) {
    console.error("[groupReadRouter] open rides range Supabase failed:", err.message || err);
    return null;
  }
}

/**
 * @param {import('firebase-admin')} admin
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {object} query req.query
 */
async function tryFetchRidingGroupFromSupabase(admin, db, query) {
  const groupId = String(query.groupId || query.id || "").trim();
  const uid = String(query.uid || query.userId || "").trim() || null;
  const includeJoinRequests = query.includeJoinRequests === "1" || query.includeJoinRequests === "true";
  if (!groupId) return null;

  const route = await groupReadConfig.shouldReadGroupsFromSupabase(admin, uid);
  if (route.route !== "supabase") return null;

  try {
    const group = await supabaseGroupReader.fetchRidingGroupByFirestoreId(admin, groupId, {
      includeMembers: true,
      includeJoinRequests,
    });
    if (!group) return null;

    const cfg = groupReadConfig.getGroupReadConfig();
    const sbMembers = Array.isArray(group._members) ? group._members : [];
    const mc = Number(group.memberCount) || 0;
    if (
      cfg.parityFallbackToFirebase !== false &&
      sbMembers.length === 0 &&
      mc > 0
    ) {
      const fromFb = await fetchRidingGroupFromFirebase(db, groupId, {
        includeMembers: true,
        includeJoinRequests,
      });
      if (fromFb && fromFb.group) {
        const fbMembers = Array.isArray(fromFb.group._members) ? fromFb.group._members : [];
        if (fbMembers.length > 0) {
          console.warn("[groupReadRouter] Supabase members empty → Firebase merge", {
            groupId,
            memberCount: mc,
            fbCount: fbMembers.length,
          });
          group._members = fbMembers;
          if (includeJoinRequests && (!group._joinRequests || !group._joinRequests.length)) {
            group._joinRequests = fromFb.group._joinRequests || [];
          }
          group.readBackend = "supabase";
          group.readSource = "supabase";
          group.membersParityFallback = true;
        }
      }
    }

    return { success: true, group, readBackend: "supabase", readSource: "supabase" };
  } catch (err) {
    console.error("[groupReadRouter] riding group Supabase failed:", err.message || err);
    return null;
  }
}

/**
 * @param {import('firebase-admin')} admin
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {object} query req.query
 */
async function tryFetchApprovedRidingGroupsFromSupabase(admin, db, query) {
  const uid = String(query.uid || query.userId || "").trim() || null;
  const route = await groupReadConfig.shouldReadGroupsFromSupabase(admin, uid);
  if (route.route !== "supabase") return null;

  try {
    const groups = await supabaseGroupReader.fetchApprovedRidingGroups(admin, {
      limit: Math.min(Number(query.limit) || 200, 500),
    });
    return {
      success: true,
      groups,
      readBackend: "supabase",
      readSource: "supabase",
    };
  } catch (err) {
    console.error("[groupReadRouter] riding groups list Supabase failed:", err.message || err);
    return null;
  }
}

/** Firebase 폴백 — rides/{id} */
async function fetchOpenRideFromFirebase(db, rideId) {
  const snap = await db.collection("rides").doc(rideId).get();
  if (!snap.exists) return null;
  return { success: true, ride: { id: snap.id, ...snap.data() }, readBackend: "firebase" };
}

/** Firebase 폴백 — stelvio_riding_groups/{id} */
async function fetchRidingGroupFromFirebase(db, groupId, opts) {
  opts = opts || {};
  const ref = db.collection("stelvio_riding_groups").doc(groupId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const group = { id: snap.id, ...snap.data(), readBackend: "firebase" };
  if (opts.includeMembers) {
    const memSnap = await ref.collection("members").get();
    group._members = memSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  if (opts.includeJoinRequests) {
    const reqSnap = await ref.collection("joinRequests").get();
    group._joinRequests = reqSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return { success: true, group, readBackend: "firebase" };
}

module.exports = {
  tryFetchOpenRideFromSupabase,
  tryFetchOpenRidesRangeFromSupabase,
  tryFetchRidingGroupFromSupabase,
  tryFetchApprovedRidingGroupsFromSupabase,
  fetchOpenRideFromFirebase,
  fetchRidingGroupFromFirebase,
};
