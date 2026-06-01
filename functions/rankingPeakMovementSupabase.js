/**
 * Supabase peak_rank_board_snapshots — Firestore peak_rank_history 대체(Read 1차 등락).
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const peakMovement = require("./rankingPeakMovement");
const supabaseRankingReader = require("./supabaseRankingReader");

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

/** history_key peak_tss_weekly_{all|M|F} → API gender */
function historyKeyToGender(historyKey) {
  const k = String(historyKey || "");
  if (k.endsWith("_M")) return "M";
  if (k.endsWith("_F")) return "F";
  return "all";
}

/**
 * TSS 주간 등락 비교용 전일(또는 전주) 기간 — getWeekRangeSeoul 과 동일 달력 규칙.
 * 월요일: 직전 주 월~일. 그 외: 이번 주 월요일~어제.
 */
function getTssCompareBaselineRangeSeoul(todayYmd) {
  const parts = String(todayYmd || peakMovement.seoulTodayYmd()).split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  const today = new Date(y, m - 1, d);
  const dayOfWeek = today.getDay();
  const pad = (n) => String(n).padStart(2, "0");

  if (dayOfWeek === 1) {
    const monday = new Date(today);
    monday.setDate(today.getDate() - 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      startStr: `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`,
      endStr: `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`,
    };
  }

  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return {
    startStr: `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`,
    endStr: `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`,
  };
}

async function buildPrevDayRanksByCategoryFromWeeklyRange(admin, startStr, endStr, gender) {
  if (!admin) return null;
  let payload;
  try {
    payload = await supabaseRankingReader.fetchWeeklyTssRanking(admin, startStr, endStr, gender);
  } catch (eFetch) {
    console.warn(
      "[rankingPeakMovementSupabase] prev-day baseline fetch failed:",
      startStr,
      endStr,
      gender,
      eFetch && eFetch.message ? eFetch.message : eFetch
    );
    return null;
  }
  if (!payload || !payload.byCategory) return null;

  const prevDay = {};
  for (let i = 0; i < peakMovement.PEAK_RANK_BOARD_CATEGORIES.length; i++) {
    const cat = peakMovement.PEAK_RANK_BOARD_CATEGORIES[i];
    prevDay[cat] = peakMovement.buildPeakBoardRankMapForCategoryRows(payload.byCategory[cat] || []);
  }
  return prevDay;
}

/**
 * prev_day_ranks_by_category 가 비어 있으면 Supabase 주간 TSS 집계로 전일(전주) 순위 맵을 채운다.
 */
async function ensurePrevDayBaselineForTssWeekly(admin, prevNorm, historyKey, todayYmd) {
  const key = String(historyKey || "").trim();
  if (!key.startsWith("peak_tss_weekly_")) return prevNorm;

  prevNorm = peakMovement.normalizePeakRankHistoryDoc(prevNorm);
  if (prevDayRanksPopulated(prevNorm)) return prevNorm;

  const gender = historyKeyToGender(key);
  const range = getTssCompareBaselineRangeSeoul(todayYmd);
  const prevDayCats = await buildPrevDayRanksByCategoryFromWeeklyRange(
    admin,
    range.startStr,
    range.endStr,
    gender
  );
  if (!prevDayCats) return prevNorm;

  let any = false;
  for (let i = 0; i < peakMovement.PEAK_RANK_BOARD_CATEGORIES.length; i++) {
    const cat = peakMovement.PEAK_RANK_BOARD_CATEGORIES[i];
    if (prevDayCats[cat] && Object.keys(prevDayCats[cat]).length > 0) any = true;
  }
  if (!any) return prevNorm;

  console.log("[rankingPeakMovementSupabase] seeded prev-day TSS baseline", {
    historyKey: key,
    baselineStart: range.startStr,
    baselineEnd: range.endStr,
    gender,
  });

  return {
    ...prevNorm,
    prevDayRanksByCategory: prevDayCats,
    asOfSeoul: prevNorm.asOfSeoul || todayYmd,
  };
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

  payload.rankMovementSource = "supabase";
  payload.rankMovementHistoryKey = historyKey;
  payload.rankMovementHydrated = peakMovement.payloadHasRankMovement(payload);

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

/** 23:00 마스터·수동 집계 후 스냅샷 저장 (Firestore applyPeakRankChanges 와 동일 역할) */
async function applyPeakRankChangesSupabase(byCategory, historyKey, opts) {
  opts = opts || {};
  const key = String(historyKey || "").trim();
  if (!key || !byCategory || typeof byCategory !== "object") return;

  const todayYmd = peakMovement.seoulTodayYmd();
  let prevNorm = await readPeakRankSnapshotSupabase(key);
  if (opts.admin) {
    prevNorm = await ensurePrevDayBaselineForTssWeekly(opts.admin, prevNorm, key, todayYmd);
  }
  const snapFields = peakMovement.computePeakRankMovementFields(byCategory, prevNorm, todayYmd);
  await writePeakRankSnapshotSupabase(key, snapFields);
}

module.exports = {
  hydratePeakRankMovementOnPayload,
  applyPeakRankChangesSupabase,
  readPeakRankSnapshotSupabase,
  writePeakRankSnapshotSupabase,
  ensurePrevDayBaselineForTssWeekly,
  getTssCompareBaselineRangeSeoul,
};
