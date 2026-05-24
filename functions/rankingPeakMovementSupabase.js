/**
 * Supabase peak_rank_board_snapshots — Firestore peak_rank_history 대체(Read 1차 등락).
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const peakMovement = require("./rankingPeakMovement");

const TABLE = "peak_rank_board_snapshots";

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

async function readPeakRankSnapshotSupabase(historyKey) {
  const key = String(historyKey || "").trim();
  if (!key) return peakMovement.normalizePeakRankHistoryDoc(null);

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return peakMovement.normalizePeakRankHistoryDoc(null);

  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "history_key, as_of_seoul, ranks_by_category, rank_changes_by_category, previous_ranks_by_category, prev_day_ranks_by_category"
    )
    .eq("history_key", key)
    .maybeSingle();

  if (error) {
    console.warn("[rankingPeakMovementSupabase] read failed:", key, error.message);
    return peakMovement.normalizePeakRankHistoryDoc(null);
  }
  return rowToNorm(data);
}

async function writePeakRankSnapshotSupabase(historyKey, snapFields) {
  const key = String(historyKey || "").trim();
  if (!key || !snapFields) return;

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase.from(TABLE).upsert(
    {
      history_key: key,
      as_of_seoul: snapFields.asOfSeoul,
      ranks_by_category: snapFields.newRanksByCategory || {},
      rank_changes_by_category: snapFields.newRankChangesByCategory || {},
      previous_ranks_by_category: snapFields.newPreviousRanksByCategory || {},
      prev_day_ranks_by_category: snapFields.newPrevDayRanksByCategory || {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "history_key" }
  );

  if (error) {
    console.warn("[rankingPeakMovementSupabase] write failed:", key, error.message);
  }
}

/**
 * HTTP 응답용 — 스냅샷 읽기 + 행에 등락 주입. Firestore hydratePeakRankMovementFromHistory 대체.
 * @param {object} payload getPeakPowerRanking 응답
 * @param {string} historyKey
 * @param {{ persistSnapshot?: boolean }} [opts]
 */
async function hydratePeakRankMovementOnPayload(payload, historyKey, opts) {
  opts = opts || {};
  if (!payload || !payload.byCategory) return payload;

  const prevNorm = await readPeakRankSnapshotSupabase(historyKey);
  const snapFields = peakMovement.computePeakRankMovementFields(
    payload.byCategory,
    prevNorm
  );

  payload.rankMovementSource = "supabase";
  payload.rankMovementHistoryKey = historyKey;
  payload.rankMovementHydrated = peakMovement.payloadHasRankMovement(payload);

  return payload;
}

/** 23:00 마스터·수동 집계 후 스냅샷 저장 (Firestore applyPeakRankChanges 와 동일 역할) */
async function applyPeakRankChangesSupabase(byCategory, historyKey) {
  const key = String(historyKey || "").trim();
  if (!key || !byCategory || typeof byCategory !== "object") return;

  const prevNorm = await readPeakRankSnapshotSupabase(key);
  const snapFields = peakMovement.computePeakRankMovementFields(byCategory, prevNorm);
  await writePeakRankSnapshotSupabase(key, snapFields);
}

module.exports = {
  hydratePeakRankMovementOnPayload,
  applyPeakRankChangesSupabase,
  readPeakRankSnapshotSupabase,
  writePeakRankSnapshotSupabase,
};
