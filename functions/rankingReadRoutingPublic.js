/**
 * 전 사용자 — 랭킹 Read DB (Firebase vs Supabase) 공개 조회.
 */
const rankingReadConfig = require("./rankingReadConfig");

/**
 * @param {import('firebase-admin')} admin
 */
async function getPublicRankingReadRouting(admin) {
  await rankingReadConfig.refreshRankingReadConfig(admin, true);
  const cfg = rankingReadConfig.getRankingReadConfig();
  const readSource = cfg.useSupabaseGlobal ? "supabase" : "firebase";
  return {
    success: true,
    readSource,
    useSupabaseGlobal: cfg.useSupabaseGlobal,
    parityFallbackToFirebase: cfg.parityFallbackToFirebase !== false,
    note:
      "클라이언트 IndexedDB·getPeakPowerRanking 캐시 네임스페이스 분리용. Supabase Read 시 서버가 Supabase MV에서 응답합니다.",
  };
}

module.exports = { getPublicRankingReadRouting };
