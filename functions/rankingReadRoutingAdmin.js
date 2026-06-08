/**
 * 관리자 — 랭킹·집계 Read DB (Firebase vs Supabase) 조회·전환 HTTP 핸들러.
 */
const rankingReadConfig = require("./rankingReadConfig");

/**
 * @param {import('firebase-admin')} admin
 * @param {string} uid
 */
async function assertAdminGrade1(admin, uid) {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  if (!snap.exists) {
    const err = new Error("호출자 정보를 찾을 수 없습니다.");
    err.status = 403;
    throw err;
  }
  const grade = String((snap.data() || {}).grade ?? "2");
  if (grade !== "1") {
    const err = new Error("관리자(grade=1) 권한이 필요합니다.");
    err.status = 403;
    throw err;
  }
}

/**
 * @param {import('firebase-admin')} admin
 * @param {import('express').Request} req
 * @param {"GET"|"POST"} method
 */
async function handleAdminSupabaseReadRouting(admin, req, method, adminUid) {
  const cfg = await rankingReadConfig.refreshRankingReadConfig(admin, true);
  const meta = await rankingReadConfig.getRankingReadRoutingDocMeta(admin);
  const status = rankingReadConfig.buildReadRoutingStatus(cfg, meta);

  if (method === "GET") {
    return {
      success: true,
      ...status,
      docPath: "appConfig/supabase_read_routing",
      note:
        "랭킹·집계 Read Router(getPeakPowerRanking, getWeeklyRanking)만 전환됩니다. Phase 1 rollup 롤백: appConfig useSupabaseGlobal=false, 또는 FIREBASE_INCREMENTAL_RANKING_ROLLUP_ENABLED=true.",
    };
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const raw =
    body.readSource != null
      ? body.readSource
      : body.target != null
        ? body.target
        : req.query?.readSource ?? req.query?.target;
  const readSource = String(raw ?? "")
    .trim()
    .toLowerCase();

  if (readSource !== "firebase" && readSource !== "supabase") {
    const err = new Error('readSource는 "firebase" 또는 "supabase" 여야 합니다.');
    err.status = 400;
    throw err;
  }

  const useSupabaseGlobal = readSource === "supabase";
  if (status.useSupabaseGlobal === useSupabaseGlobal) {
    return {
      success: true,
      unchanged: true,
      ...status,
      message:
        readSource === "supabase"
          ? "이미 Supabase 랭킹·집계 Read DB로 설정되어 있습니다."
          : "이미 Firebase 랭킹·집계 Read DB로 설정되어 있습니다.",
    };
  }

  const updatedBy =
    String(adminUid || body.updatedBy || req.query?.updatedBy || "").trim() || undefined;
  const nextCfg = await rankingReadConfig.persistRankingReadRouting(admin, {
    useSupabaseGlobal,
    parityFallbackToFirebase: true,
    updatedBy,
  });
  const nextMeta = await rankingReadConfig.getRankingReadRoutingDocMeta(admin);
  const nextStatus = rankingReadConfig.buildReadRoutingStatus(nextCfg, nextMeta);

  console.log("[adminSupabaseReadRouting] switched", {
    readSource: nextStatus.readSource,
    updatedBy: nextMeta.updatedBy,
  });

  return {
    success: true,
    unchanged: false,
    ...nextStatus,
    message:
      readSource === "supabase"
        ? "랭킹·집계 Read DB를 Supabase로 전환했습니다. (정합성 불일치 시 Firebase 자동 폴백)"
        : "랭킹·집계 Read DB를 Firebase로 전환했습니다.",
  };
}

module.exports = {
  assertAdminGrade1,
  handleAdminSupabaseReadRouting,
};
