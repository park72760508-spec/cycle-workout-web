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
    if (!after || !after.exists) return;
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
    if (!after || !after.exists) return;
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
    const { groupId, memberId } = event.params;
    const after = event.data && event.data.after;
    if (!after || !after.exists) return;
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
