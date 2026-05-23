/**
 * Strava 활동 로그 — Firebase(Primary) + Supabase(Secondary) 동시 쓰기.
 * Promise.allSettled 로 Secondary 실패를 Primary 에서 격리(Fault Isolation).
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

/**
 * @param {import('firebase-admin')} admin
 * @param {string} userId Firebase UID
 * @param {string} logDocId
 * @param {object} logDoc merge/set 할 최종 필드
 * @param {() => Promise<unknown>} writePrimaryAsync Firestore Primary 쓰기
 * @returns {Promise<unknown>} Primary 결과
 */
async function dualWriteStravaActivityLog(
  admin,
  userId,
  logDocId,
  logDoc,
  writePrimaryAsync
) {
  const primaryPromise = Promise.resolve().then(() => writePrimaryAsync());
  const secondaryPromise = supabaseDualWriteServer
    .runSecondaryAfterStravaLogSave(admin, userId, logDocId, logDoc)
    .catch((err) => {
      throw err;
    });

  const [primaryResult, secondaryResult] = await Promise.allSettled([
    primaryPromise,
    secondaryPromise,
  ]);

  if (primaryResult.status === "rejected") {
    throw primaryResult.reason;
  }

  if (secondaryResult.status === "rejected") {
    console.error(
      "[stravaDualWrite] Supabase secondary FAILED (Firebase Primary OK):",
      {
        userId,
        logDocId,
        message:
          secondaryResult.reason && secondaryResult.reason.message
            ? secondaryResult.reason.message
            : String(secondaryResult.reason),
      }
    );
  } else if (secondaryResult.value && secondaryResult.value.skipped) {
    console.log(
      "[stravaDualWrite] Supabase secondary skipped:",
      secondaryResult.value.reason
    );
  }

  return primaryResult.value;
}

module.exports = {
  dualWriteStravaActivityLog,
};
