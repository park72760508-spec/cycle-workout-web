/**
 * Supabase ranking_build_meta — pg_cron 집계 버전 (Firestore ranking_meta 대체).
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

const META_KEYS = [
  "master_daily_rebuild",
  "heptagon_daily_rebuild",
  "personal_speed_logic",
  "peak_28d_board_refresh",
  /** rides/daily_summaries → user_ranking_metrics 갱신 시 터치 (주간 TSS 실시간) */
  "ranking_metrics_live",
  /** 러닝 랭킹 비공개 캐시 버전 — Firestore ranking_meta/run_privacy_version 대체 */
  "run_privacy_version",
];

function metaTsFromIso(iso) {
  if (!iso) return 0;
  const t = Date.parse(String(iso));
  return isFinite(t) ? t : 0;
}

function rowToClientShape(row) {
  if (!row) return null;
  const dateKst = row.date_kst ? String(row.date_kst).slice(0, 10) : "";
  return {
    dateKst,
    status: row.status || "complete",
    version: row.version != null ? Number(row.version) : null,
    completedAt: row.completed_at,
  };
}

/**
 * Firestore ranking_meta 와 동일 구조 + fingerprint (index.html 호환).
 */
function buildRankingBuildMetaPayload(rows) {
  const byKey = {};
  for (const row of rows || []) {
    if (row && row.meta_key) byKey[row.meta_key] = row;
  }

  const master = rowToClientShape(byKey.master_daily_rebuild);
  const heptagon = rowToClientShape(byKey.heptagon_daily_rebuild);
  const personalSpeed = rowToClientShape(byKey.personal_speed_logic);
  const peak28d = rowToClientShape(byKey.peak_28d_board_refresh);
  const rankingMetricsLive = rowToClientShape(byKey.ranking_metrics_live);
  const runPrivacyVersionRow = byKey.run_privacy_version;
  const runPrivacyVersion = runPrivacyVersionRow && runPrivacyVersionRow.version != null
    ? Number(runPrivacyVersionRow.version)
    : 0;

  const fingerprint = [
    "m:" +
      String((master && master.dateKst) || "") +
      ":" +
      metaTsFromIso(master && master.completedAt),
    "h:" +
      String((heptagon && heptagon.dateKst) || "") +
      ":" +
      String((heptagon && heptagon.status) || "") +
      ":" +
      metaTsFromIso(heptagon && heptagon.completedAt),
    "ps:" + String(personalSpeed && personalSpeed.version != null ? personalSpeed.version : ""),
    "pk:" +
      String((peak28d && peak28d.dateKst) || "") +
      ":" +
      String((peak28d && peak28d.status) || "") +
      ":" +
      metaTsFromIso(peak28d && peak28d.completedAt),
    "live:" + metaTsFromIso(rankingMetricsLive && rankingMetricsLive.completedAt),
  ].join("|");

  return {
    source: "supabase",
    master,
    heptagon,
    personalSpeed,
    peak28d,
    rankingMetricsLive,
    runPrivacyVersion,
    fingerprint,
    rows: (rows || []).map((r) => ({
      metaKey: r.meta_key,
      dateKst: r.date_kst,
      status: r.status,
      version: r.version,
      completedAt: r.completed_at,
      updatedAt: r.updated_at,
    })),
  };
}

async function fetchRankingBuildMetaFromSupabase() {
  let supabase;
  try {
    supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  } catch (eClient) {
    const msg = eClient && eClient.message ? eClient.message : String(eClient);
    console.warn("[rankingBuildMetaSupabase] client init failed:", msg);
    return { ...buildRankingBuildMetaPayload([]), error: msg };
  }
  if (!supabase) {
    return { ...buildRankingBuildMetaPayload([]), error: "supabase_unavailable" };
  }

  const { data, error } = await supabase
    .from("ranking_build_meta")
    .select("meta_key, date_kst, status, version, completed_at, updated_at")
    .in("meta_key", META_KEYS);

  if (error) {
    console.warn("[rankingBuildMetaSupabase] read failed:", error.message);
    return { ...buildRankingBuildMetaPayload([]), error: error.message };
  }

  return buildRankingBuildMetaPayload(data || []);
}

async function invokeSupabaseRankingRpc(rpcName, logPrefix) {
  const prefix = logPrefix || `[rankingBuildMetaSupabase.${rpcName}]`;
  let supabase;
  try {
    supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  } catch (eClient) {
    const msg = eClient && eClient.message ? eClient.message : String(eClient);
    console.warn(prefix, "client init failed:", msg);
    return { ok: false, error: msg };
  }
  if (!supabase) {
    return { ok: false, error: "supabase_unavailable" };
  }
  const { error } = await supabase.rpc(rpcName);
  if (error) {
    console.warn(prefix, "rpc failed:", error.message);
    return { ok: false, error: error.message };
  }
  console.log(prefix, "rpc ok");
  return { ok: true };
}

/** pg_cron 03:40 KST — 수동·긴급 시 Functions에서 호출 */
async function runMasterDailyRebuildWeeklyTss() {
  return invokeSupabaseRankingRpc(
    "fn_master_daily_rebuild_weekly_tss",
    "[runMasterDailyRebuildWeeklyTss]"
  );
}

/** pg_cron 09:00 KST — 수동·긴급 시 Functions에서 호출 */
async function runWeeklyTssDaytimeRefresh() {
  return invokeSupabaseRankingRpc(
    "fn_weekly_tss_daytime_refresh",
    "[runWeeklyTssDaytimeRefresh]"
  );
}

/** rides/daily_summaries 동기화 직후 — 클라이언트 Realtime·폴링 시그널 */
async function touchRankingMetricsLiveMeta() {
  let supabase;
  try {
    supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  } catch (eClient) {
    return { ok: false, error: eClient && eClient.message ? eClient.message : String(eClient) };
  }
  if (!supabase) return { ok: false, error: "supabase_unavailable" };
  const nowIso = new Date().toISOString();
  const todayKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const { error } = await supabase.from("ranking_build_meta").upsert(
    {
      meta_key: "ranking_metrics_live",
      date_kst: todayKst,
      status: "complete",
      completed_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "meta_key" }
  );
  if (error) {
    console.warn("[rankingBuildMetaSupabase] touch ranking_metrics_live failed:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * 러닝 랭킹 비공개 토글 시 호출 — Supabase ranking_build_meta.run_privacy_version 원자적 증가.
 * Firestore ranking_meta/run_privacy_version 증가(onUserProfileWritten)와 나란히 dual-write된다.
 * @param {string} [userId] 로그용
 */
async function touchRunPrivacyVersionMeta(userId) {
  let supabase;
  try {
    supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  } catch (eClient) {
    return { ok: false, error: eClient && eClient.message ? eClient.message : String(eClient) };
  }
  if (!supabase) return { ok: false, error: "supabase_unavailable" };
  const { data, error } = await supabase.rpc("fn_bump_run_privacy_version");
  if (error) {
    console.warn("[rankingBuildMetaSupabase] bump run_privacy_version failed:", userId, error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, version: data };
}

module.exports = {
  META_KEYS,
  buildRankingBuildMetaPayload,
  fetchRankingBuildMetaFromSupabase,
  runMasterDailyRebuildWeeklyTss,
  runWeeklyTssDaytimeRefresh,
  touchRankingMetricsLiveMeta,
  touchRunPrivacyVersionMeta,
};
