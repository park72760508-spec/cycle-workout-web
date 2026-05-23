/**
 * 전 사용자 — 라이딩 모임 Read DB (Firebase vs Supabase) 공개 조회.
 */
const groupReadConfig = require("./groupReadConfig");

async function getPublicGroupsReadRouting(admin) {
  await groupReadConfig.refreshGroupReadConfig(admin, true);
  const cfg = groupReadConfig.getGroupReadConfig();
  const readSource = cfg.useSupabaseGlobal ? "supabase" : "firebase";
  return {
    success: true,
    readSource,
    useSupabaseGlobal: cfg.useSupabaseGlobal,
    whitelistCount: (cfg.whitelistUids || []).length,
    parityFallbackToFirebase: cfg.parityFallbackToFirebase !== false,
    note:
      "오픈 라이딩·소모임 Read Canary. 화이트리스트·USE_SUPABASE_GLOBAL 적용. UI onSnapshot 전환 전 HTTP Read Router용.",
  };
}

module.exports = { getPublicGroupsReadRouting };
