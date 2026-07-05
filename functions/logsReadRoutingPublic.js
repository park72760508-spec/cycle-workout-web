/**
 * Phase 6 — 훈련 로그 Read 라우팅 공개 API.
 */
const rankingReadConfig = require("./rankingReadConfig");

async function getPublicLogsReadRouting(admin) {
  await rankingReadConfig.refreshRankingReadConfig(admin, true);
  const cfg = rankingReadConfig.getRankingReadConfig();
  const useSupabaseLogsRead = cfg.useSupabaseLogsRead === true;
  return {
    success: true,
    readSource: useSupabaseLogsRead ? "supabase" : "firebase",
    useSupabaseLogsRead,
    parityFallbackToFirebase: cfg.parityFallbackToFirebase === true,
    note: "Phase 6: users/logs Read → Supabase rides. appConfig/supabase_read_routing.useSupabaseLogsRead",
  };
}

module.exports = { getPublicLogsReadRouting };
