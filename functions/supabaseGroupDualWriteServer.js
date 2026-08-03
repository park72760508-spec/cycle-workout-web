/**
 * Cloud Functions — 오픈 라이딩·소모임 Firestore Primary 후 Supabase Secondary.
 * @see supabaseDualWriteServer.js (ingest 게이트 재사용)
 */
const { v5: uuidv5 } = require("uuid");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

function uidConfig() {
  return {
    uidNamespace: supabaseDualWriteServer.uidNamespaceParam.value(),
    uidMode:
      supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5",
  };
}

function resolveUserUuid(firebaseUid) {
  const cfg = uidConfig();
  return supabaseDualWriteServer.resolveUserUuid(
    firebaseUid,
    cfg.uidNamespace,
    cfg.uidMode
  );
}

function resolveOpenRideUuid(firestoreDocId) {
  const cfg = uidConfig();
  const raw = String(firestoreDocId || "").trim();
  if (!raw) return null;
  if (cfg.uidMode === "literal" && /^[0-9a-f-]{36}$/i.test(raw)) {
    return raw.toLowerCase();
  }
  return uuidv5("open_ride:" + raw, cfg.uidNamespace);
}

function resolveRidingGroupUuid(firestoreDocId) {
  const cfg = uidConfig();
  const raw = String(firestoreDocId || "").trim();
  if (!raw) return null;
  if (cfg.uidMode === "literal" && /^[0-9a-f-]{36}$/i.test(raw)) {
    return raw.toLowerCase();
  }
  return uuidv5("riding_group:" + raw, cfg.uidNamespace);
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

function int(v, fb = 0) {
  const n = num(v, fb);
  return n == null ? fb : Math.trunc(n);
}

function toRideDate(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (typeof raw === "object" && raw !== null && typeof raw.toDate === "function") {
    return raw.toDate().toISOString().slice(0, 10);
  }
  if (typeof raw === "object" && raw !== null) {
    const sec =
      typeof raw.seconds === "number"
        ? raw.seconds
        : typeof raw._seconds === "number"
          ? raw._seconds
          : null;
    if (sec != null) {
      return new Date(sec * 1000).toISOString().slice(0, 10);
    }
  }
  return null;
}

function toTimeOnly(raw) {
  const s = str(raw);
  if (!s) return "09:00:00";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    return s.length === 5 ? s + ":00" : s;
  }
  return "09:00:00";
}

function toIso(raw) {
  if (!raw) return new Date().toISOString();
  if (typeof raw === "string") return raw;
  if (typeof raw.toDate === "function") return raw.toDate().toISOString();
  if (typeof raw.seconds === "number") {
    return new Date(raw.seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function asJson(v, fb) {
  if (v == null) return fb;
  if (typeof v === "object") return v;
  return fb;
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

/** Firebase Storage download URL → storage path 추정 (gs://bucket/path 미포함 시 URL path) */
function inferStoragePathFromFirebaseUrl(url) {
  const u = str(url);
  if (!u) return null;
  try {
    const parsed = new URL(u);
    const m = parsed.pathname.match(/\/o\/(.+)$/);
    if (m) return decodeURIComponent(m[1].split("?")[0]);
    if (parsed.pathname.startsWith("/")) return parsed.pathname.slice(1);
  } catch (_) {
    /* ignore */
  }
  return null;
}

function buildMediaAssetRow(entityType, entityId, ownerFirebaseUid, publicUrl, storagePath, contentType) {
  const ownerId = ownerFirebaseUid ? resolveUserUuid(ownerFirebaseUid) : null;
  if (!publicUrl || !storagePath) return null;
  return {
    entity_type: entityType,
    entity_id: String(entityId),
    owner_user_id: ownerId,
    storage_provider: "firebase_storage",
    storage_bucket: null,
    storage_path: storagePath,
    public_url: publicUrl,
    content_type: contentType || null,
    metadata: {},
  };
}

async function upsertMediaAssets(rows) {
  if (!rows || !rows.length) return;
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return;
  const { error } = await supabase.from("media_assets").upsert(rows, {
    onConflict: "entity_type,entity_id,storage_path",
  });
  if (error) console.warn("[supabaseGroupDualWrite] media_assets upsert:", error.message);
}

async function syncMediaForOpenRide(firestoreDocId, rideData) {
  const media = [];
  const hostUid = str(rideData.hostUserId);
  if (rideData.gpxUrl) {
    const path =
      str(rideData.gpxStoragePath) ||
      inferStoragePathFromFirebaseUrl(rideData.gpxUrl) ||
      `rides/${firestoreDocId}/course.gpx`;
    const row = buildMediaAssetRow(
      "open_ride_gpx",
      firestoreDocId,
      hostUid,
      str(rideData.gpxUrl),
      path,
      "application/gpx+xml"
    );
    if (row) media.push(row);
  }
  if (media.length) await upsertMediaAssets(media);
}

async function syncMediaForRidingGroup(firestoreDocId, groupData) {
  if (!groupData.photoUrl) return;
  const path =
    str(groupData.photoStoragePath) ||
    inferStoragePathFromFirebaseUrl(groupData.photoUrl) ||
    `stelvio_riding_groups/${firestoreDocId}/cover`;
  const row = buildMediaAssetRow(
    "group_cover",
    firestoreDocId,
    str(groupData.createdBy),
    str(groupData.photoUrl),
    path,
    str(groupData.coverContentType) || "image/jpeg"
  );
  if (row) await upsertMediaAssets([row]);
}

/**
 * Firestore rides/{id} → open_rides + open_ride_participants
 */
function mapFirestoreOpenRideToRows(firestoreDocId, d) {
  const hostUid = str(d.hostUserId) || str(d.host_user_id);
  const hostUserId = hostUid ? resolveUserUuid(hostUid) : null;
  const rideDate = toRideDate(d.date);
  if (!hostUserId || !rideDate || !firestoreDocId) {
    console.warn("[supabaseGroupDualWrite] map_open_ride_failed", {
      firestoreDocId,
      hostUid: hostUid || null,
      hostUserId: hostUserId || null,
      rideDate: rideDate || null,
      dateType: d.date == null ? "null" : typeof d.date,
    });
    return null;
  }

  const statusRaw = str(d.rideStatus)?.toLowerCase();
  let status = "active";
  if (statusRaw === "cancelled") status = "cancelled";
  else if (statusRaw === "completed") status = "completed";

  const rideId = resolveOpenRideUuid(firestoreDocId);
  const category = str(d.category)?.toUpperCase() === "RUN" ? "RUN" : "CYCLE";
  const openRide = {
    id: rideId,
    firestore_doc_id: firestoreDocId,
    host_user_id: hostUserId,
    title: str(d.title) || "",
    ride_date: rideDate,
    category,
    departure_time: toTimeOnly(d.departureTime),
    departure_location: str(d.departureLocation) || "",
    distance_km: num(d.distance, 0),
    course: str(d.course) || "",
    level: str(d.level) || "",
    max_participants: int(d.maxParticipants, 0),
    host_name: str(d.hostName) || "",
    contact_info: str(d.contactInfo) || "",
    is_contact_public: Boolean(d.isContactPublic),
    gpx_url: str(d.gpxUrl),
    region: str(d.region) || "",
    status,
    is_private: Boolean(d.isPrivate),
    ride_join_password: str(d.rideJoinPassword) || "",
    invited_list: asStringArray(d.invitedList),
    invite_display_by_phone: asJson(d.inviteDisplayByPhone, {}),
    invite_friend_uid_by_phone: asJson(d.inviteFriendUidByPhone, {}),
    invite_joined_uid_by_phone: asJson(d.inviteJoinedUidByPhone, {}),
    participant_display: asJson(d.participantDisplay, {}),
    participant_contact: asJson(d.participantContact, {}),
    participant_contact_public: asJson(d.participantContactPublic, {}),
    pack_riding_rules: asJson(d.packRidingRules, {}),
    host_point_charge_sp: int(d.hostPointChargeSp, 0),
    host_point_charged: Boolean(d.hostPointCharged),
    host_point_refunded: Boolean(d.hostPointRefunded),
    participant_join_charge_sp: int(d.participantJoinChargeSp, 0),
    host_public_review_summary: d.hostPublicReviewSummary || null,
    gpx_storage_path: str(d.gpxStoragePath) || inferStoragePathFromFirebaseUrl(d.gpxUrl),
    gpx_content_type: str(d.gpxContentType) || "application/gpx+xml",
    created_at: toIso(d.createdAt),
    updated_at: toIso(d.updatedAt),
  };

  const participants = [];
  const confirmed = asStringArray(d.participants);
  const waitlist = asStringArray(d.waitlist);
  const pDisplay = asJson(d.participantDisplay, {});
  const pContact = asJson(d.participantContact, {});
  const pContactPub = asJson(d.participantContactPublic, {});

  confirmed.forEach((uid, idx) => {
    const userId = resolveUserUuid(uid);
    if (!userId) return;
    participants.push({
      ride_id: rideId,
      user_id: userId,
      is_waitlist: false,
      waitlist_position: null,
      /* Firestore participants 배열 순서(항상 host가 0번, 이후 참가 순서대로 append)를 그대로
         보존 — 이 값이 없으면 읽기 쿼리가 정렬 기준으로 쓸 컬럼이 없어 "1번=방장, 순차 참가"
         순서가 화면에서 뒤섞이는 버그(2026-08)가 재발한다. */
      join_order: idx,
      display_name: str(pDisplay[uid]) || "",
      contact_info: str(pContact[uid]) || "",
      is_contact_public: Boolean(pContactPub[uid]),
      joined_at: toIso(d.createdAt),
    });
  });
  waitlist.forEach((uid, idx) => {
    const userId = resolveUserUuid(uid);
    if (!userId) return;
    participants.push({
      ride_id: rideId,
      user_id: userId,
      is_waitlist: true,
      waitlist_position: idx + 1,
      display_name: str(pDisplay[uid]) || "",
      contact_info: str(pContact[uid]) || "",
      is_contact_public: Boolean(pContactPub[uid]),
      joined_at: toIso(d.updatedAt || d.createdAt),
    });
  });

  return { openRide, participants, rideId };
}

/**
 * Firestore stelvio_riding_groups/{id} → riding_groups
 */
function mapFirestoreRidingGroupToRow(firestoreDocId, d) {
  const createdBy = str(d.createdBy);
  const createdByUuid = createdBy ? resolveUserUuid(createdBy) : null;
  if (!createdByUuid || !firestoreDocId) return null;

  const notice = d.rankingNotice && typeof d.rankingNotice === "object"
    ? {
        text: str(d.rankingNotice.text) || "",
        updatedAt: d.rankingNotice.updatedAt
          ? toIso(d.rankingNotice.updatedAt)
          : null,
        updatedBy: str(d.rankingNotice.updatedBy) || null,
      }
    : {};

  const statusRaw = str(d.status)?.toUpperCase() || "PENDING";
  const status = ["PENDING", "APPROVED", "REJECTED"].includes(statusRaw)
    ? statusRaw
    : "PENDING";

  return {
    id: resolveRidingGroupUuid(firestoreDocId),
    firestore_doc_id: firestoreDocId,
    name: str(d.name) || "",
    regions: asStringArray(d.regions),
    intro: str(d.intro) || "",
    is_public: Boolean(d.isPublic),
    join_password: str(d.joinPassword) || "",
    photo_url: str(d.photoUrl),
    category: (function () {
      const raw = str(d.category)?.toUpperCase();
      return raw === "RUN" ? "RUN" : "CYCLE";
    })(),
    photo_storage_path:
      str(d.photoStoragePath) || inferStoragePathFromFirebaseUrl(d.photoUrl),
    cover_content_type: str(d.coverContentType) || "image/jpeg",
    status,
    created_by: createdByUuid,
    member_count: int(d.memberCount, 0),
    ranking_notice: notice,
    reviewed_at: d.reviewedAt ? toIso(d.reviewedAt) : null,
    reviewed_by: d.reviewedBy ? resolveUserUuid(String(d.reviewedBy)) : null,
    created_at: toIso(d.createdAt),
    updated_at: toIso(d.updatedAt),
  };
}

function mapFirestoreGroupMemberToRow(groupUuid, memberUid, m) {
  const userId = resolveUserUuid(memberUid);
  if (!userId || !groupUuid) return null;
  const roleRaw = str(m.role)?.toLowerCase();
  return {
    group_id: groupUuid,
    user_id: userId,
    role: roleRaw === "owner" ? "owner" : "member",
    display_name: str(m.displayName) || "",
    profile_image_url: str(m.profileImageUrl),
    joined_at: toIso(m.joinedAt),
  };
}

function mapFirestoreJoinRequestToRow(groupUuid, reqUid, r) {
  const userId = resolveUserUuid(reqUid);
  if (!userId || !groupUuid) return null;
  return {
    group_id: groupUuid,
    user_id: userId,
    display_name: str(r.displayName) || "",
    profile_image_url: str(r.profileImageUrl),
    requested_at: toIso(r.requestedAt),
  };
}

async function upsertOpenRideToSupabase(openRide, participants) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) throw new Error("supabase_admin_unavailable");

  const { error: rideErr } = await supabase.from("open_rides").upsert(openRide, {
    onConflict: "id",
  });
  if (rideErr) throw rideErr;

  if (participants && participants.length) {
    const { error: pErr } = await supabase
      .from("open_ride_participants")
      .upsert(participants, { onConflict: "ride_id,user_id" });
    if (pErr) throw pErr;
  }

  /*
   * 참석 취소 반영 — 위 upsert는 "현재 참가자"만 추가/갱신할 뿐 빠진 사람을 지우지 않는다.
   * Firestore participants 배열에서 빠졌는데도 이 행이 계속 남아있어, 취소해도 Supabase
   * 읽기 경로에서는 영원히 참가자로 보이던 버그(2026-08). 매 쓰기마다 "지금 목록에 없는
   * 행"을 정리해 upsert-only 테이블을 실제 배열과 일치시킨다.
   */
  const currentUserIds = (participants || []).map((p) => p.user_id).filter(Boolean);
  let deleteQuery = supabase.from("open_ride_participants").delete().eq("ride_id", openRide.id);
  if (currentUserIds.length) {
    deleteQuery = deleteQuery.not("user_id", "in", `(${currentUserIds.join(",")})`);
  }
  const { error: delErr } = await deleteQuery;
  if (delErr) throw delErr;
}

/**
 * @param {boolean} membersAreComplete true면 members가 Firestore members 서브컬렉션 전체를
 *   막 다시 읽어온 완전한 목록(opts.syncMembersFromFirestore 경로)이라는 뜻 — 이때만 안전하게
 *   "목록에 없는 행 삭제"를 수행한다. false/미지정이면 members가 부분 목록일 수 있어(예: 클라이언트
 *   릴레이가 syncMembers:false로 호출) 삭제를 절대 수행하지 않는다(잘못하면 다른 멤버까지 지워짐).
 */
async function upsertRidingGroupToSupabase(groupRow, members, joinRequests, membersAreComplete) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) throw new Error("supabase_admin_unavailable");

  const { error: gErr } = await supabase.from("riding_groups").upsert(groupRow, {
    onConflict: "id",
  });
  if (gErr) throw gErr;

  if (members && members.length) {
    const { error: mErr } = await supabase
      .from("riding_group_members")
      .upsert(members, { onConflict: "group_id,user_id" });
    if (mErr) throw mErr;
  }
  if (joinRequests && joinRequests.length) {
    const { error: jErr } = await supabase
      .from("riding_group_join_requests")
      .upsert(joinRequests, { onConflict: "group_id,user_id" });
    if (jErr) throw jErr;
  }

  /*
   * 소모임 탈퇴 반영 — upsert는 추가/갱신만 할 뿐 빠진 멤버를 지우지 않는다. Firestore
   * members 서브컬렉션에서 문서가 삭제(탈퇴)돼도 이 행이 Supabase에 계속 남아있어, 탈퇴해도
   * 계속 멤버로 보이던 버그(2026-08, open_ride_participants와 동일 패턴). members가 전체
   * 목록임이 확실할 때만(membersAreComplete) 목록에 없는 행을 정리한다.
   */
  if (membersAreComplete) {
    const currentUserIds = (members || []).map((m) => m.user_id).filter(Boolean);
    let deleteQuery = supabase.from("riding_group_members").delete().eq("group_id", groupRow.id);
    if (currentUserIds.length) {
      deleteQuery = deleteQuery.not("user_id", "in", `(${currentUserIds.join(",")})`);
    }
    const { error: delErr } = await deleteQuery;
    if (delErr) throw delErr;
  }
}

async function deleteJoinRequestFromSupabase(groupUuid, firebaseUid) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return;
  const userId = resolveUserUuid(firebaseUid);
  if (!userId) return;
  await supabase
    .from("riding_group_join_requests")
    .delete()
    .eq("group_id", groupUuid)
    .eq("user_id", userId);
}

/**
 * Firestore rides/{id} 하드 삭제(모임 삭제) → Supabase open_rides 행 정리.
 * @see onOpenRideWrittenDualWrite (groupDualWriteTriggers.js) — 예전엔 삭제 이벤트에서
 *   그냥 return해서 Supabase에 삭제된 모임이 영원히 남아있던 버그(2026-08).
 */
async function deleteOpenRideFromSupabase(firestoreDocId) {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return;
  const rideId = resolveOpenRideUuid(firestoreDocId);
  if (!rideId) return;
  const { error: pErr } = await supabase
    .from("open_ride_participants")
    .delete()
    .eq("ride_id", rideId);
  if (pErr) throw pErr;
  const { error: rErr } = await supabase.from("open_rides").delete().eq("id", rideId);
  if (rErr) throw rErr;
}

/**
 * Firestore rides/{id} 변경 → Supabase Secondary (ingest 게이트 적용).
 */
async function runSecondaryAfterOpenRideWrite(admin, firestoreDocId, rideData, actorUid) {
  await supabaseDualWriteServer.refreshDualRunFromRemoteConfig(admin, true);
  const decision = supabaseDualWriteServer.evaluateSecondaryIngestWrite(
    actorUid || rideData.hostUserId
  );
  if (!decision.execute) {
    return { skipped: true, reason: decision.reason };
  }

  const mapped = mapFirestoreOpenRideToRows(firestoreDocId, rideData);
  if (!mapped) {
    return {
      skipped: true,
      reason: "map_open_ride_failed",
      hint: "hostUserId·date·firestoreDocId 확인 (public.users 이관 여부)",
    };
  }

  try {
    await upsertOpenRideToSupabase(mapped.openRide, mapped.participants);
  } catch (upsertErr) {
    console.error("[supabaseGroupDualWrite] open_rides upsert error", {
      firestoreDocId,
      message: upsertErr.message || String(upsertErr),
    });
    throw upsertErr;
  }
  await syncMediaForOpenRide(firestoreDocId, rideData);
  console.log("[supabaseGroupDualWrite] open_rides upsert OK", {
    firestoreDocId,
    rideId: mapped.rideId,
  });
  return { skipped: false, rideId: mapped.rideId };
}

/**
 * Firestore stelvio_riding_groups/{id} 변경 → Supabase Secondary.
 */
async function runSecondaryAfterRidingGroupWrite(
  admin,
  firestoreDocId,
  groupData,
  actorUid,
  opts
) {
  opts = opts || {};
  await supabaseDualWriteServer.refreshDualRunFromRemoteConfig(admin, true);
  const decision = supabaseDualWriteServer.evaluateSecondaryIngestWrite(
    actorUid || groupData.createdBy
  );
  if (!decision.execute) {
    return { skipped: true, reason: decision.reason };
  }

  const groupRow = mapFirestoreRidingGroupToRow(firestoreDocId, groupData);
  if (!groupRow) {
    return { skipped: true, reason: "map_riding_group_failed" };
  }

  let members = opts.members || [];
  let joinRequests = opts.joinRequests || [];

  if (opts.syncMembersFromFirestore && admin) {
    const memSnap = await admin
      .firestore()
      .collection("stelvio_riding_groups")
      .doc(firestoreDocId)
      .collection("members")
      .get();
    members = memSnap.docs
      .map((d) => mapFirestoreGroupMemberToRow(groupRow.id, d.id, d.data()))
      .filter(Boolean);
  }
  if (opts.syncJoinRequestsFromFirestore && admin) {
    const reqSnap = await admin
      .firestore()
      .collection("stelvio_riding_groups")
      .doc(firestoreDocId)
      .collection("joinRequests")
      .get();
    joinRequests = reqSnap.docs
      .map((d) => mapFirestoreJoinRequestToRow(groupRow.id, d.id, d.data()))
      .filter(Boolean);
  }

  await upsertRidingGroupToSupabase(groupRow, members, joinRequests, opts.syncMembersFromFirestore === true);
  await syncMediaForRidingGroup(firestoreDocId, groupData);
  console.log("[supabaseGroupDualWrite] riding_groups upsert OK", {
    firestoreDocId,
    groupId: groupRow.id,
  });
  return { skipped: false, groupId: groupRow.id };
}

module.exports = {
  mapFirestoreOpenRideToRows,
  mapFirestoreRidingGroupToRow,
  mapFirestoreGroupMemberToRow,
  mapFirestoreJoinRequestToRow,
  upsertOpenRideToSupabase,
  upsertRidingGroupToSupabase,
  deleteJoinRequestFromSupabase,
  deleteOpenRideFromSupabase,
  runSecondaryAfterOpenRideWrite,
  runSecondaryAfterRidingGroupWrite,
  resolveOpenRideUuid,
  resolveRidingGroupUuid,
  syncMediaForOpenRide,
  syncMediaForRidingGroup,
  upsertMediaAssets,
};
