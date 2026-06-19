/**
 * Strava 활동 로그 Dual-Write.
 *
 * Phase 1-2 (레거시): Firestore Primary → Supabase Secondary
 * Phase 3 (Canary):    Supabase Primary → Firestore Shadow (실패 시 Firestore fallback)
 * Phase 4-3:           Supabase Primary 성공 시 Firestore mirror 중단 (실패 시에만 fallback)
 *
 * 롤백: dual_write_status=OFF | STRAVA_FIRESTORE_MIRROR=true | FIRESTORE_SHADOW_WRITE=true
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

/**
 * Firestore shadow 메타 (읽기 fallback·TTL 30일 — Firestore TTL 정책 연동용).
 * @param {import('firebase-admin')} admin
 * @param {object} logDoc
 * @param {{ supabasePrimaryOk: boolean, fallback: boolean }} meta
 */
function buildFirestoreShadowFields(admin, logDoc, meta) {
  const ttlDays = supabaseDualWriteServer.getShadowTtlDays();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  return Object.assign({}, logDoc, {
    _ingestPrimary: "supabase",
    _shadowWrite: true,
    _shadowExpiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    _supabasePrimaryOk: meta.supabasePrimaryOk === true,
    _firestoreFallback: meta.fallback === true,
    _shadowSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string} userId Firebase UID
 * @param {string} logDocId
 * @param {object} logDoc merge/set 할 최종 필드 (객체 참조 — shadow 필드 주입 가능)
 * @param {() => Promise<unknown>} writePrimaryAsync Firestore 쓰기
 */
async function dualWriteStravaActivityLog(
  admin,
  userId,
  logDocId,
  logDoc,
  writePrimaryAsync
) {
  await supabaseDualWriteServer.refreshDualRunFromRemoteConfig(admin, true);
  const primaryDecision = supabaseDualWriteServer.evaluateSupabasePrimaryIngest(userId);

  if (!primaryDecision.usePrimary) {
    const primaryResult = await Promise.resolve().then(() => writePrimaryAsync());

    const secondaryResult = await supabaseDualWriteServer
      .runSecondaryAfterStravaLogSave(admin, userId, logDocId, logDoc, { force: true })
      .then((value) => ({ status: "fulfilled", value }))
      .catch((reason) => ({ status: "rejected", reason }));

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

    return primaryResult;
  }

  let supabaseOk = false;
  let supabaseSkipped = false;
  try {
    const value = await supabaseDualWriteServer.runSecondaryAfterStravaLogSave(
      admin,
      userId,
      logDocId,
      logDoc,
      { force: true }
    );
    supabaseSkipped = !!(value && value.skipped);
    supabaseOk = !supabaseSkipped;
  } catch (e) {
    console.error("[stravaDualWrite] Supabase primary FAILED — Firestore fallback:", {
      userId,
      logDocId,
      reason: primaryDecision.reason,
      message: e && e.message ? e.message : String(e),
    });
  }

  if (
    supabaseOk &&
    !supabaseDualWriteServer.shouldMirrorStravaLogToFirestoreAfterSupabaseOk(true)
  ) {
    console.log("[stravaDualWrite] Supabase primary OK — Firestore mirror skipped", {
      userId,
      logDocId,
      supabaseSkipped,
      reason: primaryDecision.reason,
    });
    return { supabasePrimary: true, firestoreMirrorSkipped: true };
  }

  const shadowEnabled = supabaseDualWriteServer.isFirestoreShadowWriteEnabled();

  if (!supabaseOk) {
    Object.assign(
      logDoc,
      buildFirestoreShadowFields(admin, logDoc, {
        supabasePrimaryOk: false,
        fallback: true,
      })
    );
  } else if (shadowEnabled) {
    Object.assign(
      logDoc,
      buildFirestoreShadowFields(admin, logDoc, {
        supabasePrimaryOk: true,
        fallback: false,
      })
    );
  }

  try {
    const firestoreResult = await Promise.resolve().then(() => writePrimaryAsync());
    console.log("[stravaDualWrite] Firestore mirror OK (Strava fallback/shadow)", {
      userId,
      logDocId,
      supabasePrimaryOk: supabaseOk,
      supabaseSkipped,
      fallback: !supabaseOk,
      shadowMeta: shadowEnabled && supabaseOk,
      reason: primaryDecision.reason,
    });
    return firestoreResult;
  } catch (e) {
    if (supabaseOk) {
      console.warn(
        "[stravaDualWrite] Firestore mirror failed but Supabase primary OK:",
        userId,
        logDocId,
        e && e.message ? e.message : e
      );
      return { supabasePrimary: true, firestoreMirrorFailed: true };
    }
    throw e;
  }
}

module.exports = {
  dualWriteStravaActivityLog,
  buildFirestoreShadowFields,
};
