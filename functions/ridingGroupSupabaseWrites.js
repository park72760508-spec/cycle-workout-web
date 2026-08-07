/**
 * 크루/클럽 가입·승인·거절·탈퇴 — Supabase Primary 쓰기.
 *
 * 기존 구조(joinRidingGroup 등, assets/js/openRiding/openRidingGroupService.js)는 클라이언트가
 * Firestore에 먼저 쓰고 Supabase는 비동기(fire-and-forget) relay로 뒤따라가서, relay가 지연·실패하면
 * "가입신청자 수" 배지(Supabase 전용 집계)와 상세 화면 목록(Supabase 우선 조회)이 어긋나는 버그가 있었다
 * (2026-08). 이 4개 오퍼레이션만 Supabase에 먼저 쓰고 Firestore는 같은 요청 안에서 동기적으로
 * 미러링하도록 전환한다 — Firestore 미러링이 실패해도 Supabase(주 저장소) 쓰기는 이미 끝났으므로
 * 치명적 오류로 취급하지 않고 경고만 남긴다.
 *
 * @see functions/groupReadRouter.js (읽기), functions/supabaseGroupDualWriteServer.js (매핑·헬퍼 재사용)
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const supabaseGroupDualWrite = require("./supabaseGroupDualWriteServer");

const RIDING_GROUP_COLLECTION = "stelvio_riding_groups";

class WriteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function isAdminGrade1(admin, uid) {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  if (!snap.exists) return false;
  return String((snap.data() || {}).grade ?? "2") === "1";
}

/** 그룹 조회 — Supabase에 없으면(한 번도 미러링 안 된 구그룹) Firestore에서 1회 백필 후 재조회. */
async function fetchOrBackfillGroupRow(admin, supabase, firestoreGroupId) {
  const groupUuid = supabaseGroupDualWrite.resolveRidingGroupUuid(firestoreGroupId);
  if (!groupUuid) return null;

  const { data: row } = await supabase
    .from("riding_groups")
    .select("*")
    .eq("id", groupUuid)
    .maybeSingle();
  if (row) return row;

  const fsSnap = await admin
    .firestore()
    .collection(RIDING_GROUP_COLLECTION)
    .doc(firestoreGroupId)
    .get();
  if (!fsSnap.exists) return null;

  await supabaseGroupDualWrite.runSecondaryAfterRidingGroupWrite(
    admin,
    firestoreGroupId,
    fsSnap.data(),
    fsSnap.data().createdBy,
    { syncMembersFromFirestore: true, syncJoinRequestsFromFirestore: true }
  );

  const { data: backfilled } = await supabase
    .from("riding_groups")
    .select("*")
    .eq("id", groupUuid)
    .maybeSingle();
  return backfilled || null;
}

/** members 행 삽입/삭제 후 riding_groups.member_count를 실제 행 수로 재계산(증분 대신 자기교정). */
async function recomputeMemberCount(supabase, groupUuid) {
  const { count, error } = await supabase
    .from("riding_group_members")
    .select("*", { count: "exact", head: true })
    .eq("group_id", groupUuid);
  if (error) throw error;
  const { error: uErr } = await supabase
    .from("riding_groups")
    .update({ member_count: count || 0 })
    .eq("id", groupUuid);
  if (uErr) throw uErr;
  return count || 0;
}

function warnMirrorFailed(op, err) {
  console.warn("[ridingGroupSupabaseWrites] Firestore mirror failed (Supabase primary write OK):", op, err.message || err);
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string} uid 신청자
 * @param {{ groupId: string, passwordGuess?: string, displayName?: string, profileImageUrl?: string|null }} body
 */
async function handleJoinRidingGroup(admin, uid, body) {
  const gid = String((body && body.groupId) || "").trim();
  if (!uid || !gid) throw new WriteError(400, "요청이 올바르지 않습니다.");

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const group = await fetchOrBackfillGroupRow(admin, supabase, gid);
  if (!group) throw new WriteError(404, "그룹을 찾을 수 없습니다.");
  if (String(group.status || "") !== "APPROVED") throw new WriteError(400, "가입할 수 없는 그룹입니다.");
  if (!group.is_public) {
    const need = String(group.join_password || "");
    if (!need || String((body && body.passwordGuess) || "") !== need) {
      throw new WriteError(400, "비밀번호가 일치하지 않습니다.");
    }
  }

  const userUuid = supabaseGroupDualWrite.resolveUserUuid(uid);
  if (!userUuid) throw new WriteError(400, "사용자 정보를 확인할 수 없습니다.");

  const { data: existingMember } = await supabase
    .from("riding_group_members")
    .select("user_id")
    .eq("group_id", group.id)
    .eq("user_id", userUuid)
    .maybeSingle();
  if (existingMember) throw new WriteError(400, "이미 이 그룹 멤버입니다.");

  const { data: existingReq } = await supabase
    .from("riding_group_join_requests")
    .select("user_id")
    .eq("group_id", group.id)
    .eq("user_id", userUuid)
    .maybeSingle();
  if (existingReq) throw new WriteError(400, "이미 가입 신청이 접수되었습니다.");

  const displayName = body && body.displayName != null ? String(body.displayName) : "";
  const profileImageUrl = body && body.profileImageUrl != null ? body.profileImageUrl : null;
  const requestedAtIso = new Date().toISOString();

  const { error: insErr } = await supabase.from("riding_group_join_requests").insert({
    group_id: group.id,
    user_id: userUuid,
    display_name: displayName,
    profile_image_url: profileImageUrl,
    requested_at: requestedAtIso,
  });
  if (insErr) {
    if (insErr.code === "23505") throw new WriteError(400, "이미 가입 신청이 접수되었습니다.");
    throw insErr;
  }

  try {
    await admin
      .firestore()
      .collection(RIDING_GROUP_COLLECTION)
      .doc(gid)
      .collection("joinRequests")
      .doc(uid)
      .set({
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        displayName,
        profileImageUrl,
      });
  } catch (err) {
    warnMirrorFailed("join", err);
  }

  return { success: true };
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string} moderatorUid
 * @param {{ groupId: string, applicantUid: string }} body
 */
async function handleApproveJoinRequest(admin, moderatorUid, body) {
  const gid = String((body && body.groupId) || "").trim();
  const appUid = String((body && body.applicantUid) || "").trim();
  if (!moderatorUid || !gid || !appUid) throw new WriteError(400, "요청이 올바르지 않습니다.");

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const group = await fetchOrBackfillGroupRow(admin, supabase, gid);
  if (!group) throw new WriteError(404, "그룹을 찾을 수 없습니다.");

  const moderatorUuid = supabaseGroupDualWrite.resolveUserUuid(moderatorUid);
  const isOwner = moderatorUuid && String(group.created_by || "") === String(moderatorUuid);
  const isAdmin = await isAdminGrade1(admin, moderatorUid);
  if (!isOwner && !isAdmin) throw new WriteError(403, "이 작업을 수행할 권한이 없습니다.");
  if (String(group.status || "") !== "APPROVED") throw new WriteError(400, "이 그룹은 가입을 수락할 수 없습니다.");

  const applicantUuid = supabaseGroupDualWrite.resolveUserUuid(appUid);
  if (!applicantUuid) throw new WriteError(400, "신청자 정보를 확인할 수 없습니다.");

  const { data: joinReq } = await supabase
    .from("riding_group_join_requests")
    .select("*")
    .eq("group_id", group.id)
    .eq("user_id", applicantUuid)
    .maybeSingle();
  if (!joinReq) throw new WriteError(404, "가입 신청을 찾을 수 없습니다.");

  const { data: existingMember } = await supabase
    .from("riding_group_members")
    .select("user_id")
    .eq("group_id", group.id)
    .eq("user_id", applicantUuid)
    .maybeSingle();
  if (existingMember) throw new WriteError(400, "이미 멤버입니다.");

  const joinedAtIso = new Date().toISOString();
  const { error: delErr } = await supabase
    .from("riding_group_join_requests")
    .delete()
    .eq("group_id", group.id)
    .eq("user_id", applicantUuid);
  if (delErr) throw delErr;

  const { error: memErr } = await supabase.from("riding_group_members").insert({
    group_id: group.id,
    user_id: applicantUuid,
    role: "member",
    display_name: joinReq.display_name || "",
    profile_image_url: joinReq.profile_image_url || null,
    joined_at: joinedAtIso,
  });
  if (memErr) throw memErr;

  const newCount = await recomputeMemberCount(supabase, group.id);

  try {
    const gRef = admin.firestore().collection(RIDING_GROUP_COLLECTION).doc(gid);
    const jRef = gRef.collection("joinRequests").doc(appUid);
    const mRef = gRef.collection("members").doc(appUid);
    const batch = admin.firestore().batch();
    batch.delete(jRef);
    batch.set(mRef, {
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      displayName: joinReq.display_name || "",
      profileImageUrl: joinReq.profile_image_url || null,
      role: "member",
    });
    batch.update(gRef, { memberCount: newCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await batch.commit();
  } catch (err) {
    warnMirrorFailed("approve", err);
  }

  return { success: true };
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string} moderatorUid
 * @param {{ groupId: string, applicantUid: string }} body
 */
async function handleRejectJoinRequest(admin, moderatorUid, body) {
  const gid = String((body && body.groupId) || "").trim();
  const appUid = String((body && body.applicantUid) || "").trim();
  if (!moderatorUid || !gid || !appUid) throw new WriteError(400, "요청이 올바르지 않습니다.");

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const group = await fetchOrBackfillGroupRow(admin, supabase, gid);
  if (!group) throw new WriteError(404, "그룹을 찾을 수 없습니다.");

  const moderatorUuid = supabaseGroupDualWrite.resolveUserUuid(moderatorUid);
  const isOwner = moderatorUuid && String(group.created_by || "") === String(moderatorUuid);
  const isAdmin = await isAdminGrade1(admin, moderatorUid);
  if (!isOwner && !isAdmin) throw new WriteError(403, "이 작업을 수행할 권한이 없습니다.");

  const applicantUuid = supabaseGroupDualWrite.resolveUserUuid(appUid);
  if (!applicantUuid) throw new WriteError(400, "신청자 정보를 확인할 수 없습니다.");

  const { error: delErr } = await supabase
    .from("riding_group_join_requests")
    .delete()
    .eq("group_id", group.id)
    .eq("user_id", applicantUuid);
  if (delErr) throw delErr;

  try {
    await admin
      .firestore()
      .collection(RIDING_GROUP_COLLECTION)
      .doc(gid)
      .collection("joinRequests")
      .doc(appUid)
      .delete();
  } catch (err) {
    warnMirrorFailed("reject", err);
  }

  return { success: true };
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string} uid
 * @param {{ groupId: string }} body
 */
async function handleLeaveRidingGroup(admin, uid, body) {
  const gid = String((body && body.groupId) || "").trim();
  if (!uid || !gid) throw new WriteError(400, "요청이 올바르지 않습니다.");

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const group = await fetchOrBackfillGroupRow(admin, supabase, gid);
  if (!group) throw new WriteError(404, "그룹을 찾을 수 없습니다.");

  const userUuid = supabaseGroupDualWrite.resolveUserUuid(uid);
  if (!userUuid) throw new WriteError(400, "사용자 정보를 확인할 수 없습니다.");
  if (String(group.created_by || "") === String(userUuid)) {
    throw new WriteError(400, "방장은 탈퇴할 수 없습니다. 그룹 삭제는 별도 메뉴에서 진행해 주세요.");
  }

  const { data: existingMember } = await supabase
    .from("riding_group_members")
    .select("user_id")
    .eq("group_id", group.id)
    .eq("user_id", userUuid)
    .maybeSingle();
  if (!existingMember) return { success: true };

  const { error: delErr } = await supabase
    .from("riding_group_members")
    .delete()
    .eq("group_id", group.id)
    .eq("user_id", userUuid);
  if (delErr) throw delErr;

  const newCount = await recomputeMemberCount(supabase, group.id);

  try {
    const gRef = admin.firestore().collection(RIDING_GROUP_COLLECTION).doc(gid);
    const batch = admin.firestore().batch();
    batch.delete(gRef.collection("members").doc(uid));
    batch.update(gRef, { memberCount: newCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await batch.commit();
  } catch (err) {
    warnMirrorFailed("leave", err);
  }

  return { success: true };
}

module.exports = {
  WriteError,
  handleJoinRidingGroup,
  handleApproveJoinRequest,
  handleRejectJoinRequest,
  handleLeaveRidingGroup,
};
