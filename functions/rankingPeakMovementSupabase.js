/**
 * Supabase peak_rank_board_snapshots — Firestore peak_rank_history 대체(Read 1차 등락).
 * 등락 baseline: 전일 03:00(마스터 03:40) 공식 집계 스냅샷 순위.
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

function prevDayRanksPopulated(prevNorm) {
  const prevDay = (prevNorm && prevNorm.prevDayRanksByCategory) || {};
  for (let i = 0; i < peakMovement.PEAK_RANK_BOARD_CATEGORIES.length; i++) {
    const cat = peakMovement.PEAK_RANK_BOARD_CATEGORIES[i];
    const m = prevDay[cat];
    if (m && typeof m === "object" && Object.keys(m).length > 0) return true;
  }
  return false;
}

function seedPrevDayRanksFromOfficialSnapshot(prevNorm) {
  const prevDay = {};
  const ranks = (prevNorm && prevNorm.ranksByCategory) || {};
  for (let i = 0; i < peakMovement.PEAK_RANK_BOARD_CATEGORIES.length; i++) {
    const cat = peakMovement.PEAK_RANK_BOARD_CATEGORIES[i];
    const m = ranks[cat];
    if (m && typeof m === "object" && Object.keys(m).length > 0) {
      prevDay[cat] = m;
    }
  }
  return prevDay;
}

/**
 * prev_day_ranks_by_category 가 비어 있으면 전일(03:00) 공식 스냅샷 ranks 로 baseline 을 채운다.
 * 주간 TSS 라이브 순위로 시드하지 않음(전일 공식 집계와 불일치 방지).
 */
async function ensurePrevDayBaselineForTssWeekly(_admin, prevNorm, historyKey, todayYmd) {
  const key = String(historyKey || "").trim();
  if (!key.startsWith("peak_tss_weekly_")) return prevNorm;

  prevNorm = peakMovement.normalizePeakRankHistoryDoc(prevNorm);
  if (prevDayRanksPopulated(prevNorm)) return prevNorm;

  const yesterday = peakMovement.seoulYesterdayYmd(todayYmd);
  const asOf = String(prevNorm.asOfSeoul || "").trim();

  if (asOf === yesterday) {
    const prevDayCats = seedPrevDayRanksFromOfficialSnapshot(prevNorm);
    if (Object.keys(prevDayCats).length > 0) {
      return {
        ...prevNorm,
        prevDayRanksByCategory: prevDayCats,
      };
    }
  }

  return prevNorm;
}

function syncEntriesRankMovementFromSupremo(payload) {
  if (!payload || !payload.byCategory) return payload;
  const supremo = payload.byCategory.Supremo;
  if (!Array.isArray(supremo) || !supremo.length) return payload;

  const mvByUid = {};
  for (let i = 0; i < supremo.length; i++) {
    const r = supremo[i];
    const uid = r && r.userId != null ? String(r.userId).trim() : "";
    if (!uid) continue;
    mvByUid[uid] = {
      rankChange: r.rankChange,
      previousBoardRank: r.previousBoardRank,
    };
  }

  if (!Array.isArray(payload.entries) || !payload.entries.length) {
    payload.entries = supremo.slice();
    return payload;
  }

  for (let j = 0; j < payload.entries.length; j++) {
    const e = payload.entries[j];
    const uid = e && e.userId != null ? String(e.userId).trim() : "";
    const mv = mvByUid[uid];
    if (!mv) continue;
    if (mv.rankChange != null && mv.previousBoardRank != null) {
      e.rankChange = mv.rankChange;
      e.previousBoardRank = mv.previousBoardRank;
    } else {
      delete e.rankChange;
      delete e.previousBoardRank;
    }
  }
  return payload;
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
 * @param {{ admin?: import('firebase-admin'), persistSnapshot?: boolean }} [opts]
 */
async function hydratePeakRankMovementOnPayload(payload, historyKey, opts) {
  opts = opts || {};
  if (!payload || !payload.byCategory) return payload;

  const todayYmd = peakMovement.seoulTodayYmd();
  let prevNorm = await readPeakRankSnapshotSupabase(historyKey);
  const hadPrevDay = prevDayRanksPopulated(prevNorm);

  if (opts.admin) {
    prevNorm = await ensurePrevDayBaselineForTssWeekly(opts.admin, prevNorm, historyKey, todayYmd);
  }

  const snapFields = peakMovement.computePeakRankMovementFields(
    payload.byCategory,
    prevNorm,
    todayYmd
  );

  syncEntriesRankMovementFromSupremo(payload);

  payload.rankMovementSource = "supabase";
  payload.rankMovementHistoryKey = historyKey;
  payload.rankMovementHydrated = peakMovement.payloadHasRankMovement(payload);
  payload.rankMovementAsOfSeoul = snapFields.asOfSeoul || todayYmd;
  payload.rankMovementPrevDayByCategory = snapFields.newPrevDayRanksByCategory || {};
  payload.rankMovementCompareBaselineByCategory = snapFields.compareBaselineByCategory || {};

  if (
    opts.persistSnapshot !== false &&
    opts.admin &&
    !hadPrevDay &&
    prevDayRanksPopulated({
      prevDayRanksByCategory: snapFields.newPrevDayRanksByCategory,
    })
  ) {
    await writePeakRankSnapshotSupabase(historyKey, snapFields);
  }

  return payload;
}

/** 03:00(마스터 03:40) 공식 집계·수동 집계 후 스냅샷 저장 (Firestore applyPeakRankChanges 와 동일 역할) */
async function applyPeakRankChangesSupabase(byCategory, historyKey, opts) {
  opts = opts || {};
  const key = String(historyKey || "").trim();
  if (!key || !byCategory || typeof byCategory !== "object") return;

  const todayYmd = peakMovement.seoulTodayYmd();
  let eligibleByCategory = byCategory;
  try {
    const rankingEligibility = require("./rankingEligibility");
    if (typeof rankingEligibility.filterEligibleByCategory === "function") {
      eligibleByCategory = rankingEligibility.filterEligibleByCategory(byCategory);
    }
  } catch (_eElig) {}

  let prevNorm = await readPeakRankSnapshotSupabase(key);
  if (opts.admin) {
    prevNorm = await ensurePrevDayBaselineForTssWeekly(opts.admin, prevNorm, key, todayYmd);
  }
  const snapFields = peakMovement.computePeakRankMovementFields(eligibleByCategory, prevNorm, todayYmd);
  await writePeakRankSnapshotSupabase(key, snapFields);
}

module.exports = {
  hydratePeakRankMovementOnPayload,
  applyPeakRankChangesSupabase,
  readPeakRankSnapshotSupabase,
  writePeakRankSnapshotSupabase,
  ensurePrevDayBaselineForTssWeekly,
  syncEntriesRankMovementFromSupremo,
};
