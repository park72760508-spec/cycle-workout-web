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
const { deleteComputeCache } = require("./httpComputeCache");

const RIDING_GROUP_COLLECTION = "stelvio_riding_groups";

/**
 * getRidingGroupForRead(functions/index.js)는 8초 TTL의 짧은 캐시(withComputeCache)를 쓴다.
 * 가입 승인/거절·기간 설정처럼 members/joinRequests를 바꾸는 쓰기 직후 같은 그룹을 다시 읽으면
 * 캐시가 아직 만료 전이라 방금 반영한 변경(예: 만료일)이 안 보이는 버그가 있었다(2026-09) —
 * 쓰기 성공 시 해당 그룹의 캐시 키를 즉시 지워 다음 읽기가 항상 최신 데이터를 계산하게 한다.
 */
async function invalidateGroupReadCache(admin, firestoreGroupId) {
  const gid = String(firestoreGroupId || "").trim();
  if (!gid) return;
  await Promise.all([
    deleteComputeCache(admin, "riding_group_read_v1__" + gid + "__0"),
    deleteComputeCache(admin, "riding_group_read_v1__" + gid + "__1"),
  ]);
}

class WriteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 그룹(클럽) 관리자 판정 — grade=1(사이트 관리자)은 모든 클럽에서 관리자.
 * grade=3(클럽 부관리자)은 해당 클럽(groupUuid)의 riding_group_members에 본인이
 * 가입돼 있을 때만 관리자로 인정 — 가입하지 않은 클럽에서는 비활성.
 * Firestore 보안 규칙 stelvioGroupIsSiteAdmin/stelvioGroupIsSubAdminMember와 동일 기준.
 * @param {import('@supabase/supabase-js').SupabaseClient} [supabase] grade=3 검증에 필요(없으면 grade=3은 거부)
 * @param {string} [groupUuid] grade=3 검증에 필요(riding_groups.id, Firestore groupId 아님)
 */
async function isRidingGroupAdminGrade(admin, uid, supabase, groupUuid) {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  if (!snap.exists) return false;
  const grade = String((snap.data() || {}).grade ?? "2");
  if (grade === "1") return true;
  if (grade !== "3") return false;
  if (!supabase || !groupUuid) return false;
  const userUuid = supabaseGroupDualWrite.resolveUserUuid(uid);
  if (!userUuid) return false;
  const { data: memberRow } = await supabase
    .from("riding_group_members")
    .select("user_id")
    .eq("group_id", groupUuid)
    .eq("user_id", userUuid)
    .maybeSingle();
  return !!memberRow;
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
 * @param {{ groupId: string, passwordGuess?: string, displayName?: string, profileImageUrl?: string|null, renewal?: boolean }} body
 */
async function handleJoinRidingGroup(admin, uid, body) {
  const gid = String((body && body.groupId) || "").trim();
  if (!uid || !gid) throw new WriteError(400, "요청이 올바르지 않습니다.");
  const isRenewal = !!(body && body.renewal);

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const group = await fetchOrBackfillGroupRow(admin, supabase, gid);
  if (!group) throw new WriteError(404, "그룹을 찾을 수 없습니다.");
  if (String(group.status || "") !== "APPROVED") throw new WriteError(400, "가입할 수 없는 그룹입니다.");
  if (!isRenewal && !group.is_public) {
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
  // 연장 신청(renewal)은 "이미 멤버"인 상태에서 다시 기간을 정하는 것이므로 기존 멤버여야 하고,
  // 신규 가입 신청(renewal=false)은 아직 멤버가 아니어야 한다.
  if (isRenewal && !existingMember) throw new WriteError(400, "이 그룹의 멤버가 아닙니다.");
  if (!isRenewal && existingMember) throw new WriteError(400, "이미 이 그룹 멤버입니다.");

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
    is_renewal: isRenewal,
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
        isRenewal,
      });
  } catch (err) {
    warnMirrorFailed("join", err);
  }

  await invalidateGroupReadCache(admin, gid);
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
  const isAdmin = await isRidingGroupAdminGrade(admin, moderatorUid, supabase, group.id);
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
  // 유료 그룹만 승인 시 가입 기간(만료일)을 강제 — "기간" 버튼으로 미리 지정해야 함.
  // 무료(공개) 그룹은 기간 개념이 없는 자유로운 클럽이라 만료일 없이 바로 승인 가능.
  const expiresAt = joinReq.requested_expires_at || null;
  if (group.is_paid && !expiresAt) throw new WriteError(400, "가입 기간(만료일)을 먼저 설정해주세요.");

  const { data: existingMember } = await supabase
    .from("riding_group_members")
    .select("user_id")
    .eq("group_id", group.id)
    .eq("user_id", applicantUuid)
    .maybeSingle();
  const isRenewal = !!joinReq.is_renewal;
  if (existingMember && !isRenewal) throw new WriteError(400, "이미 멤버입니다.");
  if (!existingMember && isRenewal) throw new WriteError(400, "갱신 대상 멤버를 찾을 수 없습니다.");

  const joinedAtIso = new Date().toISOString();
  const { error: delErr } = await supabase
    .from("riding_group_join_requests")
    .delete()
    .eq("group_id", group.id)
    .eq("user_id", applicantUuid);
  if (delErr) throw delErr;

  if (isRenewal) {
    // 연장: 기존 멤버 행의 만료일만 갱신(신규 삽입이 아님 — PK 중복 방지).
    const { error: renewErr } = await supabase
      .from("riding_group_members")
      .update({ membership_expires_at: expiresAt })
      .eq("group_id", group.id)
      .eq("user_id", applicantUuid);
    if (renewErr) throw renewErr;
  } else {
    const { error: memErr } = await supabase.from("riding_group_members").insert({
      group_id: group.id,
      user_id: applicantUuid,
      role: "member",
      display_name: joinReq.display_name || "",
      profile_image_url: joinReq.profile_image_url || null,
      joined_at: joinedAtIso,
      membership_expires_at: expiresAt,
    });
    if (memErr) throw memErr;
  }

  const newCount = await recomputeMemberCount(supabase, group.id);

  try {
    const gRef = admin.firestore().collection(RIDING_GROUP_COLLECTION).doc(gid);
    const jRef = gRef.collection("joinRequests").doc(appUid);
    const mRef = gRef.collection("members").doc(appUid);
    const batch = admin.firestore().batch();
    batch.delete(jRef);
    const memberMirror = {
      displayName: joinReq.display_name || "",
      profileImageUrl: joinReq.profile_image_url || null,
      role: "member",
      membershipExpiresAt: expiresAt,
    };
    if (!isRenewal) memberMirror.joinedAt = admin.firestore.FieldValue.serverTimestamp();
    batch.set(mRef, memberMirror, { merge: true });
    batch.update(gRef, { memberCount: newCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await batch.commit();
  } catch (err) {
    warnMirrorFailed("approve", err);
  }

  await invalidateGroupReadCache(admin, gid);
  return { success: true };
}

/**
 * "기간" 버튼 — 가입 신청을 수락하기 전에 관리자/부관리자가 만료일을 미리 지정한다.
 * 수락(handleApproveJoinRequest)은 이 값이 없으면 거부된다.
 * @param {import('firebase-admin')} admin
 * @param {string} moderatorUid
 * @param {{ groupId: string, applicantUid: string, expiresAt: string }} body
 */
async function handleSetJoinRequestExpiry(admin, moderatorUid, body) {
  const gid = String((body && body.groupId) || "").trim();
  const appUid = String((body && body.applicantUid) || "").trim();
  const expiresAt = String((body && body.expiresAt) || "").trim();
  if (!moderatorUid || !gid || !appUid || !expiresAt) throw new WriteError(400, "요청이 올바르지 않습니다.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) throw new WriteError(400, "날짜 형식이 올바르지 않습니다.");

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const group = await fetchOrBackfillGroupRow(admin, supabase, gid);
  if (!group) throw new WriteError(404, "그룹을 찾을 수 없습니다.");

  const moderatorUuid = supabaseGroupDualWrite.resolveUserUuid(moderatorUid);
  const isOwner = moderatorUuid && String(group.created_by || "") === String(moderatorUuid);
  const isAdmin = await isRidingGroupAdminGrade(admin, moderatorUid, supabase, group.id);
  if (!isOwner && !isAdmin) throw new WriteError(403, "이 작업을 수행할 권한이 없습니다.");

  const applicantUuid = supabaseGroupDualWrite.resolveUserUuid(appUid);
  if (!applicantUuid) throw new WriteError(400, "신청자 정보를 확인할 수 없습니다.");

  const { data: updated, error: updErr } = await supabase
    .from("riding_group_join_requests")
    .update({ requested_expires_at: expiresAt })
    .eq("group_id", group.id)
    .eq("user_id", applicantUuid)
    .select("user_id")
    .maybeSingle();
  if (updErr) throw updErr;
  if (!updated) throw new WriteError(404, "가입 신청을 찾을 수 없습니다.");

  try {
    await admin
      .firestore()
      .collection(RIDING_GROUP_COLLECTION)
      .doc(gid)
      .collection("joinRequests")
      .doc(appUid)
      .set({ requestedExpiresAt: expiresAt }, { merge: true });
  } catch (err) {
    warnMirrorFailed("setJoinRequestExpiry", err);
  }

  await invalidateGroupReadCache(admin, gid);
  return { success: true, expiresAt };
}

/**
 * 아바타 팝업의 기간 설정 아이콘 — 이미 승인된 기존 멤버의 만료일을 가입 신청 절차 없이
 * 관리자/부관리자가 바로 수정한다.
 * @param {import('firebase-admin')} admin
 * @param {string} moderatorUid
 * @param {{ groupId: string, memberUid: string, expiresAt: string|null }} body
 */
async function handleUpdateMemberExpiry(admin, moderatorUid, body) {
  const gid = String((body && body.groupId) || "").trim();
  const memberUid = String((body && body.memberUid) || "").trim();
  const expiresAtRaw = body && body.expiresAt != null ? String(body.expiresAt).trim() : "";
  if (!moderatorUid || !gid || !memberUid) throw new WriteError(400, "요청이 올바르지 않습니다.");
  if (expiresAtRaw && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAtRaw)) {
    throw new WriteError(400, "날짜 형식이 올바르지 않습니다.");
  }
  const expiresAt = expiresAtRaw || null;

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const group = await fetchOrBackfillGroupRow(admin, supabase, gid);
  if (!group) throw new WriteError(404, "그룹을 찾을 수 없습니다.");

  const moderatorUuid = supabaseGroupDualWrite.resolveUserUuid(moderatorUid);
  const isOwner = moderatorUuid && String(group.created_by || "") === String(moderatorUuid);
  const isAdmin = await isRidingGroupAdminGrade(admin, moderatorUid, supabase, group.id);
  if (!isOwner && !isAdmin) throw new WriteError(403, "이 작업을 수행할 권한이 없습니다.");

  const memberUuid = supabaseGroupDualWrite.resolveUserUuid(memberUid);
  if (!memberUuid) throw new WriteError(400, "회원 정보를 확인할 수 없습니다.");

  const { data: updated, error: updErr } = await supabase
    .from("riding_group_members")
    .update({ membership_expires_at: expiresAt })
    .eq("group_id", group.id)
    .eq("user_id", memberUuid)
    .select("user_id")
    .maybeSingle();
  if (updErr) throw updErr;
  if (!updated) throw new WriteError(404, "멤버를 찾을 수 없습니다.");

  try {
    await admin
      .firestore()
      .collection(RIDING_GROUP_COLLECTION)
      .doc(gid)
      .collection("members")
      .doc(memberUid)
      .set({ membershipExpiresAt: expiresAt }, { merge: true });
  } catch (err) {
    warnMirrorFailed("updateMemberExpiry", err);
  }

  await invalidateGroupReadCache(admin, gid);
  return { success: true, expiresAt };
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

  const isSelfCancel = String(moderatorUid) === String(appUid);
  const moderatorUuid = supabaseGroupDualWrite.resolveUserUuid(moderatorUid);
  const isOwner = moderatorUuid && String(group.created_by || "") === String(moderatorUuid);
  const isAdmin = await isRidingGroupAdminGrade(admin, moderatorUid, supabase, group.id);
  // 방장/관리자의 "거절"뿐 아니라, 신청 당사자 본인이 승인 전 신청을 "취소"하는 경우도 이 경로를 탄다.
  if (!isOwner && !isAdmin && !isSelfCancel) throw new WriteError(403, "이 작업을 수행할 권한이 없습니다.");

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

  await invalidateGroupReadCache(admin, gid);
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

  await invalidateGroupReadCache(admin, gid);
  return { success: true };
}

/**
 * 전체 그룹 스캔 — Firestore members/joinRequests 서브컬렉션 개수와 Supabase 행 개수를
 * 비교해 어긋난 그룹을 찾고(dryRun=true면 리포트만), 실행 모드에서는
 * runSecondaryAfterRidingGroupWrite(syncMembersFromFirestore/syncJoinRequestsFromFirestore)로
 * Firestore 기준 전체 재동기화(추가된 것 upsert + Supabase에만 있는 고아 행 정리)를 수행한다.
 * 과거 fire-and-forget dual-write가 실패해 누적된 드리프트를 한 번에 복구하기 위한 운영 도구.
 *
 * @param {import('firebase-admin')} admin
 * @param {{ dryRun?: boolean }} opts
 */
async function handleBackfillRidingGroupMembers(admin, opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();

  const groupsSnap = await admin.firestore().collection(RIDING_GROUP_COLLECTION).get();
  const report = [];

  for (const groupDoc of groupsSnap.docs) {
    const gid = groupDoc.id;
    const gd = groupDoc.data() || {};
    const groupUuid = supabaseGroupDualWrite.resolveRidingGroupUuid(gid);
    if (!groupUuid) continue;

    const [memSnap, reqSnap] = await Promise.all([
      groupDoc.ref.collection("members").get(),
      groupDoc.ref.collection("joinRequests").get(),
    ]);
    const fsMemberCount = memSnap.size;
    const fsReqCount = reqSnap.size;

    const [{ count: sbMemberCount }, { count: sbReqCount }] = await Promise.all([
      supabase.from("riding_group_members").select("*", { count: "exact", head: true }).eq("group_id", groupUuid),
      supabase.from("riding_group_join_requests").select("*", { count: "exact", head: true }).eq("group_id", groupUuid),
    ]);

    const mismatch = fsMemberCount !== (sbMemberCount || 0) || fsReqCount !== (sbReqCount || 0);
    if (!mismatch) continue;

    const entry = {
      groupId: gid,
      name: gd.name || "",
      firestoreMembers: fsMemberCount,
      supabaseMembers: sbMemberCount || 0,
      firestoreJoinRequests: fsReqCount,
      supabaseJoinRequests: sbReqCount || 0,
    };
    if (!dryRun) {
      try {
        await supabaseGroupDualWrite.runSecondaryAfterRidingGroupWrite(admin, gid, gd, gd.createdBy, {
          syncMembersFromFirestore: true,
          syncJoinRequestsFromFirestore: true,
        });
        entry.repaired = true;
      } catch (err) {
        entry.repaired = false;
        entry.error = err.message || String(err);
      }
    }
    report.push(entry);
  }

  return { success: true, dryRun, scanned: groupsSnap.size, mismatches: report.length, report };
}

module.exports = {
  WriteError,
  handleJoinRidingGroup,
  handleApproveJoinRequest,
  handleRejectJoinRequest,
  handleLeaveRidingGroup,
  handleBackfillRidingGroupMembers,
  handleSetJoinRequestExpiry,
  handleUpdateMemberExpiry,
  fetchOrBackfillGroupRow,
  isRidingGroupAdminGrade,
};
