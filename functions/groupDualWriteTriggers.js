/**
 * Firestore onWrite → Supabase Secondary (서버 측 Dual-Write, Fault Isolated).
 */
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const supabaseGroupDualWrite = require("./supabaseGroupDualWriteServer");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

const rideWriteOpts = supabaseDualWriteServer.appendServiceRoleSecret({
  region: "us-central1",
  memory: "256MiB",
});

const groupWriteOpts = supabaseDualWriteServer.appendServiceRoleSecret({
  region: "us-central1",
  memory: "256MiB",
});

exports.onOpenRideWrittenDualWrite = onDocumentWritten(
  { document: "rides/{rideId}", ...rideWriteOpts },
  async (event) => {
    const rideId = event.params.rideId;
    const after = event.data && event.data.after;
    /* 모임 삭제(하드 delete)도 반드시 Supabase에 반영해야 한다 — 예전엔 여기서 조용히
       return해서 삭제된 모임이 Supabase 읽기 경로(캘린더)에 영원히 남아있던 버그(2026-08). */
    if (!after || !after.exists) {
      try {
        await supabaseGroupDualWrite.deleteOpenRideFromSupabase(rideId);
      } catch (err) {
        console.warn("[onOpenRideWrittenDualWrite] delete secondary failed:", err.message || err);
      }
      return;
    }
    try {
      await supabaseGroupDualWrite.runSecondaryAfterOpenRideWrite(
        require("firebase-admin"),
        rideId,
        after.data(),
        after.data().hostUserId
      );
    } catch (err) {
      console.warn("[onOpenRideWrittenDualWrite] secondary failed (Primary OK):", err.message || err);
    }
  }
);

exports.onRidingGroupWrittenDualWrite = onDocumentWritten(
  { document: "stelvio_riding_groups/{groupId}", ...groupWriteOpts },
  async (event) => {
    const groupId = event.params.groupId;
    const after = event.data && event.data.after;
    /* 그룹 삭제(하드 delete)도 반드시 Supabase에 반영해야 한다 — 예전엔 여기서 조용히
       return해서 삭제된 그룹이 Supabase 읽기 경로에 고아로 영원히 남아있던 버그(2026-08). */
    if (!after || !after.exists) {
      try {
        await supabaseGroupDualWrite.deleteRidingGroupFromSupabase(groupId);
      } catch (err) {
        console.warn("[onRidingGroupWrittenDualWrite] delete secondary failed:", err.message || err);
      }
      return;
    }
    try {
      await supabaseGroupDualWrite.runSecondaryAfterRidingGroupWrite(
        require("firebase-admin"),
        groupId,
        after.data(),
        after.data().createdBy,
        { syncMembersFromFirestore: true }
      );
    } catch (err) {
      console.warn(
        "[onRidingGroupWrittenDualWrite] secondary failed (Primary OK):",
        err.message || err
      );
    }
  }
);

exports.onRidingGroupMemberWrittenDualWrite = onDocumentWritten(
  { document: "stelvio_riding_groups/{groupId}/members/{memberId}", ...groupWriteOpts },
  async (event) => {
    const { groupId } = event.params;
    /* 멤버 문서가 삭제(탈퇴)된 경우도 반드시 동기화해야 한다 — 예전엔 여기서 조용히 return해서
       탈퇴가 Supabase에 전혀 반영되지 않았다(2026-08). 생성·수정·삭제 모두 동일하게 그룹의
       members 서브컬렉션 전체를 다시 읽어 upsertRidingGroupToSupabase의 삭제 정리까지 태운다. */
    const admin = require("firebase-admin");
    try {
      const groupSnap = await admin
        .firestore()
        .collection("stelvio_riding_groups")
        .doc(groupId)
        .get();
      if (!groupSnap.exists) return;
      await supabaseGroupDualWrite.runSecondaryAfterRidingGroupWrite(
        admin,
        groupId,
        groupSnap.data(),
        groupSnap.data().createdBy,
        { syncMembersFromFirestore: true }
      );
    } catch (err) {
      console.warn(
        "[onRidingGroupMemberWrittenDualWrite] secondary failed:",
        err.message || err
      );
    }
  }
);

exports.onRidingGroupJoinRequestWrittenDualWrite = onDocumentWritten(
  {
    document: "stelvio_riding_groups/{groupId}/joinRequests/{reqUid}",
    ...groupWriteOpts,
  },
  async (event) => {
    const { groupId, reqUid } = event.params;
    const before = event.data && event.data.before;
    const after = event.data && event.data.after;
    const admin = require("firebase-admin");
    try {
      const groupSnap = await admin
        .firestore()
        .collection("stelvio_riding_groups")
        .doc(groupId)
        .get();
      if (!groupSnap.exists) return;

      if (!after || !after.exists) {
        const groupUuid = supabaseGroupDualWrite.resolveRidingGroupUuid(groupId);
        if (groupUuid) {
          await supabaseGroupDualWrite.deleteJoinRequestFromSupabase(groupUuid, reqUid);
        }
        return;
      }

      await supabaseGroupDualWrite.runSecondaryAfterRidingGroupWrite(
        admin,
        groupId,
        groupSnap.data(),
        groupSnap.data().createdBy,
        { syncJoinRequestsFromFirestore: true, syncMembersFromFirestore: true }
      );
    } catch (err) {
      console.warn(
        "[onRidingGroupJoinRequestWrittenDualWrite] secondary failed:",
        err.message || err
      );
    }
  }
);
