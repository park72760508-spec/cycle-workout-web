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

/**
 * Firebase 폴백 — 내 멤버십 소mo임 (HTTP 1회 = 1+G reads, 지속 리스너 아님).
 */
async function fetchMyRidingGroupsFromFirebase(db, firebaseUid) {
  const uid = String(firebaseUid || "").trim();
  if (!uid || !db) return [];

  const snap = await db
    .collection("stelvio_riding_groups")
    .where("status", "==", "APPROVED")
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const rows = [];
  await Promise.all(
    snap.docs.map(async (docSnap) => {
      const memSnap = await docSnap.ref.collection("members").doc(uid).get();
      if (!memSnap.exists) return;
      const gd = docSnap.data() || {};
      const catRaw =
        gd.category != null
          ? gd.category
          : gd.sportCategory != null
            ? gd.sportCategory
            : null;
      const catNorm =
        catRaw != null && String(catRaw).trim().toUpperCase() === "RUN" ? "RUN" : "CYCLE";
      const rnRaw = gd.rankingNotice;
      let rankingNotice = null;
      if (rnRaw && typeof rnRaw === "object") {
        rankingNotice = {
          text: rnRaw.text != null ? String(rnRaw.text) : "",
          updatedAt: rnRaw.updatedAt != null ? rnRaw.updatedAt : null,
          updatedBy: rnRaw.updatedBy != null ? String(rnRaw.updatedBy) : "",
        };
      }
      rows.push({
        id: docSnap.id,
        groupId: docSnap.id,
        name: gd.name != null ? String(gd.name) : "(이름 없음)",
        photoUrl: gd.photoUrl != null ? String(gd.photoUrl).trim() : "",
        memberCount: gd.memberCount != null ? Number(gd.memberCount) : null,
        createdBy: gd.createdBy != null ? String(gd.createdBy) : "",
        category: catNorm,
        resolvedCategory: catNorm,
        categoryExplicit: catRaw != null,
        regions: gd.regions != null ? gd.regions : null,
        isPublic: gd.isPublic !== false,
        rankingNotice,
        readBackend: "firebase",
      });
    })
  );

  return rows.sort(function (a, b) {
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
 * 내 소mo임 Read — Supabase 우선(Canary 무관, Firestore reads 폭증 방지).
 */
async function tryFetchMyRidingGroupsFromSupabase(admin, query) {
  const uid = String(query.uid || query.userId || "").trim();
  if (!uid) return null;

  try {
    const groups = await supabaseGroupReader.fetchMyRidingGroupsAsMember(admin, uid);
    return {
      success: true,
      groups: groups || [],
      readBackend: "supabase",
      readSource: "supabase",
    };
  } catch (err) {
    console.error("[groupReadRouter] my riding groups Supabase failed:", err.message || err);
    return null;
  }
}

async function tryFetchMyGroupMembershipsFromSupabase(admin, query) {
  const uid = String(query.uid || query.userId || "").trim();
  const rawIds = query.groupIds || query.ids || "";
  const groupIds = String(rawIds)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!uid || !groupIds.length) return null;

  try {
    const memberGroupIds = await supabaseGroupReader.fetchMyGroupMembershipFirestoreIds(
      admin,
      uid,
      groupIds
    );
    return {
      success: true,
      memberGroupIds: memberGroupIds || [],
      readBackend: "supabase",
      readSource: "supabase",
    };
  } catch (err) {
    console.error("[groupReadRouter] my group memberships Supabase failed:", err.message || err);
    return null;
  }
}

async function tryFetchMyGroupContactSetFromSupabase(admin, query) {
  const uid = String(query.uid || query.userId || "").trim();
  const rawIds = query.groupIds || query.ids || "";
  const groupIds = String(rawIds)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!uid || !groupIds.length) return null;

  try {
    const payload = await supabaseGroupReader.fetchMyGroupContactSet(admin, uid, groupIds);
    return {
      success: true,
      uids: payload.uids || [],
      map: payload.map || {},
      readBackend: "supabase",
      readSource: "supabase",
    };
  } catch (err) {
    console.error("[groupReadRouter] my group contact set Supabase failed:", err.message || err);
    return null;
  }
}

/** Firebase 폴백 — 멤버십 Set */
async function fetchMyGroupMembershipsFromFirebase(db, firebaseUid, groupFirestoreIds) {
  const uid = String(firebaseUid || "").trim();
  const ids = (groupFirestoreIds || []).map((g) => String(g || "").trim()).filter(Boolean);
  if (!uid || !ids.length) return [];

  const out = [];
  await Promise.all(
    ids.map(async (gid) => {
      const memSnap = await db
        .collection("stelvio_riding_groups")
        .doc(gid)
        .collection("members")
        .doc(uid)
        .get();
      if (memSnap.exists) out.push(gid);
    })
  );
  return out;
}

/** Firebase 폴백 — 그룹 멤버 contact set */
async function fetchMyGroupContactSetFromFirebase(db, groupFirestoreIds) {
  const ids = (groupFirestoreIds || []).map((g) => String(g || "").trim()).filter(Boolean);
  if (!ids.length) return { uids: [], map: {} };

  const uidSet = new Set();
  const map = {};
  await Promise.all(
    ids.map(async (gid) => {
      const memSnap = await db
        .collection("stelvio_riding_groups")
        .doc(gid)
        .collection("members")
        .get();
      memSnap.docs.forEach((d) => {
        const data = d.data() || {};
        const fb = String(d.id);
        uidSet.add(fb);
        if (!map[fb]) {
          map[fb] = {
            userId: fb,
            name: data.displayName != null ? String(data.displayName) : "",
            profileImageUrl: data.profileImageUrl || null,
            role: data.role || "member",
          };
        }
      });
    })
  );
  return { uids: [...uidSet], map };
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
  tryFetchMyRidingGroupsFromSupabase,
  tryFetchMyGroupMembershipsFromSupabase,
  tryFetchMyGroupContactSetFromSupabase,
  fetchMyRidingGroupsFromFirebase,
  fetchMyGroupMembershipsFromFirebase,
  fetchMyGroupContactSetFromFirebase,
  fetchOpenRideFromFirebase,
  fetchRidingGroupFromFirebase,
};
