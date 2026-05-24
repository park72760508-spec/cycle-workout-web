/**
 * 전 사용자 — 랭킹 Read DB (Firebase vs Supabase) 공개 조회.
 */
const rankingReadConfig = require("./rankingReadConfig");
const rankingBuildMetaSupabase = require("./rankingBuildMetaSupabase");

/**
 * @param {import('firebase-admin')} admin
 */
async function getPublicRankingReadRouting(admin) {
  await rankingReadConfig.refreshRankingReadConfig(admin, true);
  const cfg = rankingReadConfig.getRankingReadConfig();
  const readSource = cfg.useSupabaseGlobal ? "supabase" : "firebase";
  const out = {
    success: true,
    readSource,
    useSupabaseGlobal: cfg.useSupabaseGlobal,
    parityFallbackToFirebase: cfg.parityFallbackToFirebase !== false,
    note:
      "클라이언트 IndexedDB·getPeakPowerRanking 캐시 네임스페이스 분리용. Supabase Read 시 서버가 Supabase MV에서 응답합니다.",
  };
  if (readSource === "supabase") {
    try {
      const buildMeta = await rankingBuildMetaSupabase.fetchRankingBuildMetaFromSupabase();
      out.buildMetaSource = "supabase";
      out.buildMeta = {
        master: buildMeta.master,
        heptagon: buildMeta.heptagon,
        personalSpeed: buildMeta.personalSpeed,
        peak28d: buildMeta.peak28d,
      };
      out.buildMetaFingerprint = buildMeta.fingerprint || "";
      if (buildMeta.error) out.buildMetaError = buildMeta.error;
    } catch (eMeta) {
      console.warn(
        "[getPublicRankingReadRouting] buildMeta skipped:",
        eMeta && eMeta.message ? eMeta.message : eMeta
      );
      out.buildMetaError =
        eMeta && eMeta.message ? eMeta.message : String(eMeta);
    }
  }
  return out;
}

module.exports = { getPublicRankingReadRouting };
