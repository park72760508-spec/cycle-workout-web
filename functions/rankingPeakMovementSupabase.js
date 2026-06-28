/**
 * Supabase peak_rank_board_snapshots — Firestore peak_rank_history 대체(Read 1차 등락).
 * 등락 baseline: 전일 03:00(마스터 03:40) 공식 집계 스냅샷 순위.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const peakMovement = require("./rankingPeakMovement");

const TABLE = "peak_rank_board_snapshots";
const PEAK_RANK_HISTORY_COL = "peak_rank_history";
const RANKING_AGGREGATES_COLLECTION = "ranking_aggregates";

function historyKeyToGender(historyKey) {
  const k = String(historyKey || "");
  if (k.endsWith("_M")) return "M";
  if (k.endsWith("_F")) return "F";
  return "all";
}

/** getWeekRangeSeoul 과 동일 — 기준일 KST YYYY-MM-DD */
function getWeekRangeForSeoulYmd(todayYmd, weekOffset = 0) {
  const parts = String(todayYmd || peakMovement.seoulTodayYmd())
    .split("-")
    .map(Number);
  const today = new Date(parts[0], parts[1] - 1, parts[2]);
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  const pad = (n) => String(n).padStart(2, "0");

  if (weekOffset < 0) {
    monday.setDate(monday.getDate() + weekOffset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      startStr: `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`,
      endStr: `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`,
    };
  }

  return {
    startStr: `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`,
    endStr: `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}`,
  };
}

/** 전일 03:40 마스터가 저장한 ranking_aggregates 키 (월요일=전주 확정) */
function officialTssAggregateKeysForBaseline(todayYmd) {
  const today = String(todayYmd || peakMovement.seoulTodayYmd()).trim();
  const parts = today.split("-").map(Number);
  const dayOfWeek = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  if (dayOfWeek === 1) {
    const prev = getWeekRangeForSeoulYmd(today, -1);
    return [{ startStr: prev.startStr, endStr: prev.endStr, reason: "monday_prev_week" }];
  }
  const yesterday = peakMovement.seoulYesterdayYmd(today);
  const curr = getWeekRangeForSeoulYmd(today, 0);
  return [{ startStr: curr.startStr, endStr: yesterday, reason: "yesterday_in_week" }];
}

function byCategoryFromAggregateDoc(data) {
  if (!data || typeof data !== "object") return null;
  if (data.byCategory && typeof data.byCategory === "object") return data.byCategory;
  if (!Array.isArray(data.entries) || !data.entries.length) return null;
  const byCategory = {
    Supremo: data.entries.slice(),
    Assoluto: [],
    Bianco: [],
    Rosa: [],
    Infinito: [],
    Leggenda: [],
  };
  for (let i = 0; i < data.entries.length; i++) {
    const e = data.entries[i];
    const cat = e && e.ageCategory;
    if (cat && byCategory[cat]) byCategory[cat].push(e);
  }
  return byCategory;
}

function buildPrevDayRanksFromByCategory(byCategory) {
  const prevDay = {};
  for (let i = 0; i < peakMovement.PEAK_RANK_BOARD_CATEGORIES.length; i++) {
    const cat = peakMovement.PEAK_RANK_BOARD_CATEGORIES[i];
    prevDay[cat] = peakMovement.buildPeakBoardRankMapForCategoryRows(byCategory[cat] || []);
  }
  return prevDay;
}

function prevDayBaselineLooksCorrupt(prevNorm) {
  prevNorm = peakMovement.normalizePeakRankHistoryDoc(prevNorm);
  const prevDay = (prevNorm.prevDayRanksByCategory || {}).Supremo || {};
  const ranks = (prevNorm.ranksByCategory || {}).Supremo || {};
  const nPrev = Object.keys(prevDay).length;
  const nRanks = Object.keys(ranks).length;
  if (nRanks > 15 && nPrev > 0 && nPrev < Math.min(15, Math.floor(nRanks * 0.1))) return true;
  if (nRanks > 0 && nPrev === 0) return true;
  return false;
}

/**
 * Firestore ranking_aggregates — 전일 03:40 공식 TSS 보드에서 prev_day baseline 복구.
 */
async function buildPrevDayRanksFromFirestoreAggregate(admin, historyKey, todayYmd) {
  if (!admin) return null;
  const gender = historyKeyToGender(historyKey);
  const keys = officialTssAggregateKeysForBaseline(todayYmd);
  const db = admin.firestore();

  for (let ki = 0; ki < keys.length; ki++) {
    const { startStr, endStr, reason } = keys[ki];
    const cacheKey = `peakRanking_weekly_tss_v2_${gender}_${startStr}_${endStr}`;
    try {
      const snap = await db.collection(RANKING_AGGREGATES_COLLECTION).doc(cacheKey).get();
      if (!snap.exists) continue;
      const byCategory = byCategoryFromAggregateDoc(snap.data() || {});
      if (!byCategory) continue;
      const prevDay = buildPrevDayRanksFromByCategory(byCategory);
      if (!prevDayRanksPopulated({ prevDayRanksByCategory: prevDay })) continue;
      console.log("[rankingPeakMovementSupabase] baseline from Firestore aggregate", {
        historyKey,
        cacheKey,
        reason,
        supremo: Object.keys(prevDay.Supremo || {}).length,
      });
      return prevDay;
    } catch (eAgg) {
      console.warn(
        "[rankingPeakMovementSupabase] aggregate baseline read failed:",
        cacheKey,
        eAgg && eAgg.message ? eAgg.message : eAgg
      );
    }
  }
  return null;
}

/**
 * Firestore 집계가 없을 때 — 전일(또는 월요일=전주) 구간 Supabase 주간 TSS 순위로 baseline 복구.
 */
async function buildPrevDayRanksFromSupabaseWeeklyTss(admin, historyKey, todayYmd) {
  if (!admin) return null;
  const gender = historyKeyToGender(historyKey);
  const keys = officialTssAggregateKeysForBaseline(todayYmd);
  let supabaseRankingReader;
  try {
    supabaseRankingReader = require("./supabaseRankingReader");
  } catch (_e) {
    return null;
  }

  for (let ki = 0; ki < keys.length; ki++) {
    const { startStr, endStr, reason } = keys[ki];
    try {
      const payload = await supabaseRankingReader.fetchWeeklyTssRanking(
        admin,
        startStr,
        endStr,
        gender
      );
      if (!payload || !payload.byCategory) continue;
      const prevDay = buildPrevDayRanksFromByCategory(payload.byCategory);
      if (!prevDayRanksPopulated({ prevDayRanksByCategory: prevDay })) continue;
      console.log("[rankingPeakMovementSupabase] baseline from Supabase weekly TSS", {
        historyKey,
        startStr,
        endStr,
        reason,
        supremo: Object.keys(prevDay.Supremo || {}).length,
      });
      return prevDay;
    } catch (eSb) {
      console.warn(
        "[rankingPeakMovementSupabase] Supabase weekly baseline fetch failed:",
        startStr,
        endStr,
        gender,
        eSb && eSb.message ? eSb.message : eSb
      );
    }
  }
  return null;
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
  const today = todayYmd || peakMovement.seoulTodayYmd();
  const sb = await readPeakRankSnapshotSupabase(historyKey);
  let fs = peakMovement.normalizePeakRankHistoryDoc(null);
  if (admin) {
    fs = await readPeakRankHistoryFirestore(admin, historyKey);
  }
  let merged = mergePeakRankNorms(sb, fs, today);
  if (!prevDayRanksPopulated(merged)) {
    const legacyKey = peakMovement.resolveLegacyPeakRankHistoryKey(historyKey);
    if (legacyKey) {
      const legacySb = await readPeakRankSnapshotSupabase(legacyKey);
      let legacyFs = peakMovement.normalizePeakRankHistoryDoc(null);
      if (admin) {
        legacyFs = await readPeakRankHistoryFirestore(admin, legacyKey);
      }
      const legacyNorm = mergePeakRankNorms(legacySb, legacyFs, today);
      if (prevDayRanksPopulated(legacyNorm)) {
        merged = {
          ...merged,
          prevDayRanksByCategory: legacyNorm.prevDayRanksByCategory,
          asOfSeoul: merged.asOfSeoul || today,
        };
      } else if (categoryMapsHaveRanks(legacyNorm.ranksByCategory)) {
        const prevDayCats = seedPrevDayRanksFromOfficialSnapshot(legacyNorm);
        if (Object.keys(prevDayCats).length > 0) {
          merged = {
            ...merged,
            prevDayRanksByCategory: prevDayCats,
            asOfSeoul: merged.asOfSeoul || today,
          };
        }
      }
    }
  }
  return merged;
}

/**
 * 독주(rolling90d): prev_day 비어 있으면 rolling28d 스냅샷·Firestore baseline 복구.
 */
async function ensurePrevDayBaselineForPersonalSpeed(admin, prevNorm, historyKey, todayYmd) {
  const key = String(historyKey || "").trim();
  if (!key.startsWith("peak_personal_speed_rolling90d_")) return prevNorm;

  const today = todayYmd || peakMovement.seoulTodayYmd();
  prevNorm = peakMovement.normalizePeakRankHistoryDoc(prevNorm);
  if (prevDayRanksPopulated(prevNorm) && !prevDayBaselineLooksCorrupt(prevNorm)) return prevNorm;

  const legacyKey = peakMovement.resolveLegacyPeakRankHistoryKey(key);
  if (!legacyKey) return prevNorm;

  const legacyNorm = await readPeakRankNormForHydrate(admin, legacyKey, today);
  if (prevDayRanksPopulated(legacyNorm)) {
    return {
      ...prevNorm,
      prevDayRanksByCategory: legacyNorm.prevDayRanksByCategory,
      asOfSeoul: prevNorm.asOfSeoul || today,
    };
  }
  if (categoryMapsHaveRanks(legacyNorm.ranksByCategory)) {
    const prevDayCats = seedPrevDayRanksFromOfficialSnapshot(legacyNorm);
    if (Object.keys(prevDayCats).length > 0) {
      return {
        ...prevNorm,
        prevDayRanksByCategory: prevDayCats,
        asOfSeoul: prevNorm.asOfSeoul || today,
      };
    }
  }
  return prevNorm;
}

/**
 * prev_day_ranks_by_category 가 비어 있으면 전일(03:00) 공식 스냅샷 ranks 로 baseline 을 채운다.
 */
async function ensurePrevDayBaselineForTssWeekly(admin, prevNorm, historyKey, todayYmd) {
  const key = String(historyKey || "").trim();
  if (!key.startsWith("peak_tss_weekly_")) return prevNorm;

  const today = todayYmd || peakMovement.seoulTodayYmd();
  prevNorm = peakMovement.normalizePeakRankHistoryDoc(prevNorm);
  const corrupt = prevDayBaselineLooksCorrupt(prevNorm);
  if (prevDayRanksPopulated(prevNorm) && !corrupt) return prevNorm;
  if (corrupt) {
    prevNorm = { ...prevNorm, prevDayRanksByCategory: {} };
  }

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
    if (prevDayRanksPopulated(merged) && !prevDayBaselineLooksCorrupt(merged)) return merged;
  }

  if (admin) {
    const aggPrevDay = await buildPrevDayRanksFromFirestoreAggregate(admin, historyKey, today);
    if (aggPrevDay) {
      return {
        ...prevNorm,
        prevDayRanksByCategory: aggPrevDay,
        asOfSeoul: prevNorm.asOfSeoul || today,
      };
    }
  }

  if (admin) {
    const sbPrevDay = await buildPrevDayRanksFromSupabaseWeeklyTss(admin, historyKey, today);
    if (sbPrevDay) {
      return {
        ...prevNorm,
        prevDayRanksByCategory: sbPrevDay,
        asOfSeoul: prevNorm.asOfSeoul || today,
      };
    }
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
    prevNorm = await ensurePrevDayBaselineForPersonalSpeed(opts.admin, prevNorm, historyKey, todayYmd);
  }

  const snapFields = peakMovement.computePeakRankMovementFields(
    payload.byCategory,
    prevNorm,
    todayYmd,
    { tssWeeklyAbsolute: String(historyKey || "").startsWith("peak_tss_weekly_") }
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
    (!hadPrevDay || prevDayBaselineLooksCorrupt(prevNorm)) &&
    prevDayRanksPopulated({
      prevDayRanksByCategory: snapFields.newPrevDayRanksByCategory,
    }) &&
    !prevDayBaselineLooksCorrupt({
      ranksByCategory: snapFields.newRanksByCategory,
      prevDayRanksByCategory: snapFields.newPrevDayRanksByCategory,
    })
  ) {
    await writePeakRankSnapshotSupabase(historyKey, snapFields);
    try {
      await opts.admin
        .firestore()
        .collection(PEAK_RANK_HISTORY_COL)
        .doc(String(historyKey))
        .set(
          {
            asOfSeoul: snapFields.asOfSeoul || todayYmd,
            ranksByCategory: snapFields.newRanksByCategory || {},
            rankChangesByCategory: snapFields.newRankChangesByCategory || {},
            previousRanksByCategory: snapFields.newPreviousRanksByCategory || {},
            prevDayRanksByCategory: snapFields.newPrevDayRanksByCategory || {},
            officialBaselineLabel: "prev_day_03h_kst",
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
    } catch (eFsWrite) {
      console.warn(
        "[rankingPeakMovementSupabase] Firestore snapshot write failed:",
        historyKey,
        eFsWrite && eFsWrite.message ? eFsWrite.message : eFsWrite
      );
    }
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
    prevNorm = await ensurePrevDayBaselineForPersonalSpeed(opts.admin, prevNorm, key, todayYmd);
  }
  const snapFields = peakMovement.computePeakRankMovementFields(eligibleByCategory, prevNorm, todayYmd, {
    tssWeeklyAbsolute: key.startsWith("peak_tss_weekly_"),
  });
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
  ensurePrevDayBaselineForPersonalSpeed,
  syncEntriesRankMovementFromSupremo,
  mergePeakRankNorms,
  buildPrevDayRanksFromFirestoreAggregate,
  buildPrevDayRanksFromSupabaseWeeklyTss,
  officialTssAggregateKeysForBaseline,
  prevDayBaselineLooksCorrupt,
};
