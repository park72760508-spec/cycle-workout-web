/**
 * Supabase 관계형 행 → Firestore NoSQL JSON (UI·기존 클라이언트 스펙 100% 호환).
 */

function tsFromIso(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const seconds = Math.floor(ms / 1000);
  return { seconds, nanoseconds: (ms % 1000) * 1e6 };
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

function asObjectMap(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v;
}

/**
 * open_rides + participants → Firestore rides/{id} 문서 형태
 * @param {object} row open_rides row
 * @param {object[]} participants open_ride_participants rows (firebase uid attached)
 */
function adaptOpenRideToFirestoreDoc(row, participants) {
  if (!row) return null;
  const firestoreId = row.firestore_doc_id || row._firestoreDocId || null;
  if (!firestoreId) return null;

  const confirmed = [];
  const waitlist = [];
  const participantDisplay = asObjectMap(row.participant_display);
  const participantContact = asObjectMap(row.participant_contact);
  const participantContactPublic = asObjectMap(row.participant_contact_public);

  for (const p of participants || []) {
    const uid = p.firebaseUid || p.user_id;
    if (!uid) continue;
    if (p.is_waitlist) {
      waitlist.push(String(uid));
    } else {
      confirmed.push(String(uid));
    }
    if (p.display_name && !participantDisplay[String(uid)]) {
      participantDisplay[String(uid)] = String(p.display_name);
    }
    if (p.contact_info && !participantContact[String(uid)]) {
      participantContact[String(uid)] = String(p.contact_info);
    }
    if (p.is_contact_public && participantContactPublic[String(uid)] == null) {
      participantContactPublic[String(uid)] = true;
    }
  }

  const statusRaw = str(row.status)?.toLowerCase() || "active";
  const rideStatus =
    statusRaw === "cancelled" || statusRaw === "completed" ? statusRaw : "active";

  return {
    id: firestoreId,
    title: str(row.title) || "",
    date: tsFromIso(row.ride_date ? row.ride_date + "T00:00:00+09:00" : null),
    departureTime: str(row.departure_time)?.slice(0, 5) || "",
    departureLocation: str(row.departure_location) || "",
    distance: num(row.distance_km, 0),
    course: str(row.course) || "",
    level: str(row.level) || "",
    maxParticipants: num(row.max_participants, 0),
    hostName: str(row.host_name) || "",
    contactInfo: str(row.contact_info) || "",
    isContactPublic: Boolean(row.is_contact_public),
    gpxUrl: str(row.gpx_url),
    region: str(row.region) || "",
    isPrivate: Boolean(row.is_private),
    invitedList: asStringArray(row.invited_list),
    inviteDisplayByPhone: asObjectMap(row.invite_display_by_phone),
    inviteFriendUidByPhone: asObjectMap(row.invite_friend_uid_by_phone),
    inviteJoinedUidByPhone: asObjectMap(row.invite_joined_uid_by_phone),
    rideJoinPassword: str(row.ride_join_password) || "",
    participantDisplay,
    participantContact,
    participantContactPublic,
    participants: confirmed,
    waitlist,
    hostUserId: row.hostFirebaseUid || row.host_user_id || "",
    packRidingRules: asObjectMap(row.pack_riding_rules),
    rideStatus,
    hostPointChargeSp: num(row.host_point_charge_sp, 0),
    hostPointCharged: Boolean(row.host_point_charged),
    hostPointRefunded: Boolean(row.host_point_refunded),
    participantJoinChargeSp: num(row.participant_join_charge_sp, 0),
    hostPublicReviewSummary: row.host_public_review_summary || null,
    createdAt: tsFromIso(row.created_at),
    updatedAt: tsFromIso(row.updated_at),
    readBackend: "supabase",
  };
}

/**
 * riding_groups + members → Firestore stelvio_riding_groups/{id}
 */
function adaptRidingGroupToFirestoreDoc(row, members, joinRequests) {
  if (!row) return null;
  const firestoreId = row.firestore_doc_id || row._firestoreDocId;
  if (!firestoreId) return null;

  const notice = row.ranking_notice && typeof row.ranking_notice === "object"
    ? row.ranking_notice
    : {};

  const categoryRaw = str(row.category)?.toUpperCase();
  const category = categoryRaw === "RUN" ? "RUN" : "CYCLE";

  return {
    id: firestoreId,
    name: str(row.name) || "",
    regions: asStringArray(row.regions),
    intro: str(row.intro) || "",
    isPublic: Boolean(row.is_public),
    joinPassword: str(row.join_password) || "",
    photoUrl: str(row.photo_url),
    category,
    status: str(row.status) || "PENDING",
    createdBy: row.createdByFirebaseUid || row.created_by || "",
    memberCount: num(row.member_count, 0),
    rankingNotice: notice.text != null
      ? {
          text: String(notice.text || ""),
          updatedAt: notice.updatedAt ? tsFromIso(notice.updatedAt) : null,
          updatedBy: notice.updatedBy || notice.updated_by || null,
        }
      : undefined,
    reviewedAt: tsFromIso(row.reviewed_at),
    reviewedBy: row.reviewedByFirebaseUid || row.reviewed_by || null,
    createdAt: tsFromIso(row.created_at),
    updatedAt: tsFromIso(row.updated_at),
    readBackend: "supabase",
    _members: (members || []).map(adaptRidingGroupMemberToFirestoreDoc),
    _joinRequests: (joinRequests || []).map(adaptJoinRequestToFirestoreDoc),
  };
}

function adaptRidingGroupMemberToFirestoreDoc(m) {
  if (!m) return null;
  return {
    id: m.firebaseUid || m.user_id,
    joinedAt: tsFromIso(m.joined_at),
    displayName: str(m.display_name) || "",
    profileImageUrl: str(m.profile_image_url),
    role: str(m.role) || "member",
  };
}

function adaptJoinRequestToFirestoreDoc(r) {
  if (!r) return null;
  return {
    id: r.firebaseUid || r.user_id,
    requestedAt: tsFromIso(r.requested_at),
    displayName: str(r.display_name) || "",
    profileImageUrl: str(r.profile_image_url),
  };
}

module.exports = {
  adaptOpenRideToFirestoreDoc,
  adaptRidingGroupToFirestoreDoc,
  adaptRidingGroupMemberToFirestoreDoc,
  adaptJoinRequestToFirestoreDoc,
  tsFromIso,
};
