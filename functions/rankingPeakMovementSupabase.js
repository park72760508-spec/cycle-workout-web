/**
 * Supabase peak_rank_board_snapshots — Firestore peak_rank_history 대체(Read 1차 등락).
 * 등락 baseline: 전일 03:00(마스터 03:40) 공식 집계 스냅샷 순위.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const peakMovement = require("./rankingPeakMovement");

const TABLE = "peak_rank_board_snapshots";
const PEAK_RANK_HISTORY_COL = "peak_rank_history";

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

function categoryMapsHaveRanks(ranksByCategory) {
  if (!ranksByCategory || typeof ranksByCategory !== "object") return false;
  for (let i = 0; i < peakMovement.PEAK_RANK_BOARD_CATEGORIES.length; i++) {
    const cat = peakMovement.PEAK_RANK_BOARD_CATEGORIES[i];
    const m = ranksByCategory[cat];
    if (m && typeof m === "object" && Object.keys(m).length > 0) return true;
  }
  return false;
}

async function readPeakRankHistoryFirestore(admin, historyKey) {
  if (!admin || !historyKey) return peakMovement.normalizePeakRankHistoryDoc(null);
  try {
    const snap = await admin
      .firestore()
      .collection(PEAK_RANK_HISTORY_COL)
      .doc(String(historyKey))
      .get();
    if (!snap.exists) return peakMovement.normalizePeakRankHistoryDoc(null);
    return peakMovement.normalizePeakRankHistoryDoc(snap.data());
  } catch (eFs) {
    console.warn(
      "[rankingPeakMovementSupabase] Firestore read failed:",
      historyKey,
      eFs && eFs.message ? eFs.message : eFs
    );
    return peakMovement.normalizePeakRankHistoryDoc(null);
  }
}

/**
 * Supabase 스냅샷 + Firestore peak_rank_history 병합 — prev_day baseline 우선 복구.
 */
function mergePeakRankNorms(supabaseNorm, firestoreNorm, todayYmd) {
  const today = todayYmd || peakMovement.seoulTodayYmd();
  const yesterday = peakMovement.seoulYesterdayYmd(today);
  const sb = peakMovement.normalizePeakRankHistoryDoc(supabaseNorm);
  const fs = peakMovement.normalizePeakRankHistoryDoc(firestoreNorm);

  let asOfSeoul = sb.asOfSeoul || fs.asOfSeoul || "";
  let ranksByCategory = categoryMapsHaveRanks(sb.ranksByCategory)
    ? sb.ranksByCategory
    : fs.ranksByCategory;
  let prevDayRanksByCategory = { ...(sb.prevDayRanksByCategory || {}) };
  let rankChangesByCategory = sb.rankChangesByCategory || {};
  let previousRanksByCategory = sb.previousRanksByCategory || {};

  if (fs.asOfSeoul && (!asOfSeoul || fs.asOfSeoul > asOfSeoul) && categoryMapsHaveRanks(fs.ranksByCategory)) {
    ranksByCategory = fs.ranksByCategory;
    asOfSeoul = fs.asOfSeoul;
  }

  if (!prevDayRanksPopulated({ prevDayRanksByCategory })) {
    if (prevDayRanksPopulated(fs)) {
      prevDayRanksByCategory = fs.prevDayRanksByCategory;
    } else if (String(fs.asOfSeoul || "") === yesterday) {
      prevDayRanksByCategory = seedPrevDayRanksFromOfficialSnapshot(fs);
    } else if (String(sb.asOfSeoul || "") === yesterday) {
      prevDayRanksByCategory = seedPrevDayRanksFromOfficialSnapshot(sb);
    } else if (fs.asOfSeoul && fs.asOfSeoul < today && categoryMapsHaveRanks(fs.ranksByCategory)) {
      prevDayRanksByCategory = seedPrevDayRanksFromOfficialSnapshot(fs);
    } else if (sb.asOfSeoul && sb.asOfSeoul < today && categoryMapsHaveRanks(sb.ranksByCategory)) {
      prevDayRanksByCategory = seedPrevDayRanksFromOfficialSnapshot(sb);
    }
  }

  if (
    String(asOfSeoul) === today &&
    !prevDayRanksPopulated({ prevDayRanksByCategory }) &&
    prevDayRanksPopulated(fs)
  ) {
    prevDayRanksByCategory = fs.prevDayRanksByCategory;
  }

  if (!categoryMapsHaveRanks(rankChangesByCategory) && categoryMapsHaveRanks(fs.rankChangesByCategory)) {
    rankChangesByCategory = fs.rankChangesByCategory;
    previousRanksByCategory = fs.previousRanksByCategory || {};
  }

  return {
    asOfSeoul,
    ranksByCategory: ranksByCategory || {},
    rankChangesByCategory: rankChangesByCategory || {},
    previousRanksByCategory: previousRanksByCategory || {},
    prevDayRanksByCategory: prevDayRanksByCategory || {},
  };
}

async function readPeakRankNormForHydrate(admin, historyKey, todayYmd) {
  const sb = await readPeakRankSnapshotSupabase(historyKey);
  if (!admin) return sb;
  const fs = await readPeakRankHistoryFirestore(admin, historyKey);
  return mergePeakRankNorms(sb, fs, todayYmd);
}

/**
 * prev_day_ranks_by_category 가 비어 있으면 전일(03:00) 공식 스냅샷 ranks 로 baseline 을 채운다.
 */
async function ensurePrevDayBaselineForTssWeekly(admin, prevNorm, historyKey, todayYmd) {
  const key = String(historyKey || "").trim();
  if (!key.startsWith("peak_tss_weekly_")) return prevNorm;

  const today = todayYmd || peakMovement.seoulTodayYmd();
  prevNorm = peakMovement.normalizePeakRankHistoryDoc(prevNorm);
  if (prevDayRanksPopulated(prevNorm)) return prevNorm;

  const yesterday = peakMovement.seoulYesterdayYmd(today);
  const asOf = String(prevNorm.asOfSeoul || "").trim();

  if (asOf === yesterday) {
    const prevDayCats = seedPrevDayRanksFromOfficialSnapshot(prevNorm);
    if (Object.keys(prevDayCats).length > 0) {
      return { ...prevNorm, prevDayRanksByCategory: prevDayCats };
    }
  }

  if (asOf && asOf < today && categoryMapsHaveRanks(prevNorm.ranksByCategory)) {
    const prevDayCats = seedPrevDayRanksFromOfficialSnapshot(prevNorm);
    if (Object.keys(prevDayCats).length > 0) {
      return { ...prevNorm, prevDayRanksByCategory: prevDayCats };
    }
  }

  if (admin) {
    const fsNorm = await readPeakRankHistoryFirestore(admin, historyKey);
    const merged = mergePeakRankNorms(prevNorm, fsNorm, today);
    if (prevDayRanksPopulated(merged)) return merged;
  }

  return prevNorm;
}

function applyStoredRankMovementFromNorm(byCategory, prevNorm, todayYmd) {
  prevNorm = peakMovement.normalizePeakRankHistoryDoc(prevNorm);
  if (String(prevNorm.asOfSeoul || "") !== String(todayYmd)) return false;

  let any = false;
  for (let i = 0; i < peakMovement.PEAK_RANK_BOARD_CATEGORIES.length; i++) {
    const cat = peakMovement.PEAK_RANK_BOARD_CATEGORIES[i];
    const rows = byCategory[cat];
    if (!Array.isArray(rows) || !rows.length) continue;
    const chMap =
      prevNorm.rankChangesByCategory[cat] && typeof prevNorm.rankChangesByCategory[cat] === "object"
        ? prevNorm.rankChangesByCategory[cat]
        : {};
    const prevMap =
      prevNorm.previousRanksByCategory[cat] && typeof prevNorm.previousRanksByCategory[cat] === "object"
        ? prevNorm.previousRanksByCategory[cat]
        : {};
    for (let j = 0; j < rows.length; j++) {
      const e = rows[j];
      const uid = e && e.userId != null ? String(e.userId).trim() : "";
      if (!uid || chMap[uid] == null || prevMap[uid] == null) continue;
      if (e.rankChange != null && e.previousBoardRank != null) continue;
      e.rankChange = chMap[uid];
      e.previousBoardRank = prevMap[uid];
      any = true;
    }
  }
  return any;
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
 */
async function hydratePeakRankMovementOnPayload(payload, historyKey, opts) {
  opts = opts || {};
  if (!payload || !payload.byCategory) return payload;

  const todayYmd = peakMovement.seoulTodayYmd();
  let prevNorm = await readPeakRankNormForHydrate(opts.admin, historyKey, todayYmd);
  const hadPrevDay = prevDayRanksPopulated(prevNorm);

  if (opts.admin) {
    prevNorm = await ensurePrevDayBaselineForTssWeekly(opts.admin, prevNorm, historyKey, todayYmd);
  }

  const snapFields = peakMovement.computePeakRankMovementFields(
    payload.byCategory,
    prevNorm,
    todayYmd
  );

  if (!peakMovement.payloadHasRankMovement(payload)) {
    applyStoredRankMovementFromNorm(payload.byCategory, prevNorm, todayYmd);
  }

  syncEntriesRankMovementFromSupremo(payload);

  payload.rankMovementSource = prevDayRanksPopulated(prevNorm) ? "supabase" : "supabase_partial";
  if (prevDayRanksPopulated({ prevDayRanksByCategory: snapFields.newPrevDayRanksByCategory })) {
    payload.rankMovementSource = "supabase";
  }
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

/** 03:00(마스터 03:40) 공식 집계·수동 집계 후 스냅샷 저장 */
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

  let prevNorm = await readPeakRankNormForHydrate(opts.admin, key, todayYmd);
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
  readPeakRankHistoryFirestore,
  readPeakRankNormForHydrate,
  writePeakRankSnapshotSupabase,
  ensurePrevDayBaselineForTssWeekly,
  syncEntriesRankMovementFromSupremo,
  mergePeakRankNorms,
};
