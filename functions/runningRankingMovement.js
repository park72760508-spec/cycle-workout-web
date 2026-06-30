/**
 * RUN 랭킹보드 순위 등락 — Supabase peak_rank_board_snapshots (history_key run_*)
 */
const peakMovement = require("./rankingPeakMovement");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

const TABLE = "peak_rank_board_snapshots";

function buildRunRankHistoryKey(tabId, gender, paceDistance) {
  const tab = String(tabId || "overall").trim() || "overall";
  const g = String(gender || "all").trim() || "all";
  if (tab === "crew") return `run_crew_${g}`;
  if (tab === "pace") {
    const d = String(paceDistance || "5k").trim() || "5k";
    return `run_pace_${d}_${g}`;
  }
  return `run_${tab}_${g}`;
}

function rowToNorm(row) {
  if (!row) return peakMovement.normalizePeakRankHistoryDoc(null);
  return peakMovement.normalizePeakRankHistoryDoc({
    asOfSeoul: row.as_of_seoul,
    ranksByCategory: row.ranks_by_category,
    rankChangesByCategory: row.rank_changes_by_category,
    previousRanksByCategory: row.previous_ranks_by_category,
    prevDayRanksByCategory: row.prev_day_ranks_by_category,
  });
}

function snapshotToClientPayload(norm) {
  norm = peakMovement.normalizePeakRankHistoryDoc(norm);
  return {
    asOfSeoul: norm.asOfSeoul || "",
    /* 스냅샷 자신의 보드(=집계일 전체 순위). 라이브(오늘) 보드 표시 시 직전일 baseline 으로 사용 */
    ranksByCategory: norm.ranksByCategory || {},
    rankChangesByCategory: norm.rankChangesByCategory || {},
    previousRanksByCategory: norm.previousRanksByCategory || {},
    prevDayRanksByCategory: norm.prevDayRanksByCategory || {},
  };
}

async function fetchAllRunRankSnapshots() {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return {};

  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "history_key, as_of_seoul, ranks_by_category, rank_changes_by_category, previous_ranks_by_category, prev_day_ranks_by_category"
    )
    .like("history_key", "run_%");

  if (error) {
    console.warn("[runningRankingMovement] snapshot read failed:", error.message);
    return {};
  }

  const byKey = {};
  let latestAsOf = "";
  for (let i = 0; i < (data || []).length; i++) {
    const row = data[i];
    const key = row && row.history_key ? String(row.history_key) : "";
    if (!key) continue;
    const norm = rowToNorm(row);
    byKey[key] = snapshotToClientPayload(norm);
    if (norm.asOfSeoul && (!latestAsOf || norm.asOfSeoul > latestAsOf)) {
      latestAsOf = norm.asOfSeoul;
    }
  }

  return { byKey, asOfSeoul: latestAsOf };
}

module.exports = {
  buildRunRankHistoryKey,
  fetchAllRunRankSnapshots,
  snapshotToClientPayload,
};
