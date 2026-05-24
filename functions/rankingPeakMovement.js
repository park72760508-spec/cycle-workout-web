/**
 * 랭킹보드 순위 등락(↑↓) — Firestore peak_rank_history 와 동일 규칙.
 * Supabase peak_rank_board_snapshots 에서도 재사용.
 */
const PEAK_RANK_BOARD_CATEGORIES = [
  "Supremo",
  "Assoluto",
  "Bianco",
  "Rosa",
  "Infinito",
  "Leggenda",
];

function buildPeakRankHistoryKey(durationType, period, gender) {
  const dt = String(durationType || "").trim() || "5min";
  const p = String(period || "").trim() || "monthly";
  const g = String(gender || "").trim() || "all";
  return `peak_${dt}_${p}_${g}`;
}

/** 클라이언트 stelvioResolveRankingBoardPeriod 와 동일 */
function resolveRankingBoardPeriod(durationType, period) {
  const dt = String(durationType || "").trim();
  if (dt === "tss") return "weekly";
  if (dt === "personal_speed") return "rolling28d";
  if (dt === "personal_dist" || dt === "group_dist") return "rolling30";
  const pr = String(period || "").trim();
  if (pr === "yearly") return "monthly";
  if (pr === "rolling28" || pr === "rolling28d") return "rolling28d";
  return pr || "monthly";
}

/** Firebase peak_rank_history 문서 ID (스케줄·HTTP hydrate 공통) */
function resolvePeakRankHistoryKey(durationType, period, gender) {
  const dt = String(durationType || "").trim();
  const g = String(gender || "").trim() || "all";
  if (!dt || dt === "gc") return null;
  if (dt === "tss") return `peak_tss_weekly_${g}`;
  if (dt === "personal_dist") return `peak_personal_dist_rolling30_${g}`;
  if (dt === "personal_speed") return `peak_personal_speed_rolling28d_${g}`;
  if (dt === "group_dist") return "peak_group_dist_rolling30_all";
  const p = resolveRankingBoardPeriod(dt, period);
  return buildPeakRankHistoryKey(dt, p, g);
}

function buildPeakBoardRankMapForCategoryRows(rows) {
  const ranks = {};
  if (!Array.isArray(rows)) return ranks;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const uid = r && r.userId != null ? String(r.userId).trim() : "";
    if (!uid) continue;
    ranks[uid] = i + 1;
  }
  return ranks;
}

function normalizePeakRankHistoryDoc(d) {
  if (!d || typeof d !== "object") {
    return {
      asOfSeoul: "",
      ranksByCategory: {},
      rankChangesByCategory: {},
      previousRanksByCategory: {},
      prevDayRanksByCategory: {},
    };
  }
  if (d.ranksByCategory && typeof d.ranksByCategory === "object") {
    return {
      asOfSeoul: d.asOfSeoul || d.as_of_seoul || "",
      ranksByCategory: d.ranksByCategory,
      rankChangesByCategory:
        d.rankChangesByCategory && typeof d.rankChangesByCategory === "object"
          ? d.rankChangesByCategory
          : {},
      previousRanksByCategory:
        d.previousRanksByCategory && typeof d.previousRanksByCategory === "object"
          ? d.previousRanksByCategory
          : {},
      prevDayRanksByCategory:
        d.prevDayRanksByCategory && typeof d.prevDayRanksByCategory === "object"
          ? d.prevDayRanksByCategory
          : {},
    };
  }
  return {
    asOfSeoul: d.asOfSeoul || d.as_of_seoul || "",
    ranksByCategory: d.ranks && typeof d.ranks === "object" ? { Supremo: d.ranks } : {},
    rankChangesByCategory:
      d.rankChanges && typeof d.rankChanges === "object" ? { Supremo: d.rankChanges } : {},
    previousRanksByCategory:
      d.previousRanks && typeof d.previousRanks === "object" ? { Supremo: d.previousRanks } : {},
    prevDayRanksByCategory: {},
  };
}

function freezeOfficialPrevDayRanks(prevNorm, prevRanksCat, prevDayRanksCat, todayYmd) {
  const isNewOfficialDay = !prevNorm.asOfSeoul || prevNorm.asOfSeoul < todayYmd;
  if (isNewOfficialDay && Object.keys(prevRanksCat).length > 0) {
    return prevRanksCat;
  }
  return prevDayRanksCat && typeof prevDayRanksCat === "object" ? prevDayRanksCat : {};
}

function resolveOfficialPeakRankBaseline(prevNorm, prevRanksCat, prevDayRanksCat, todayYmd) {
  const prevDay =
    prevDayRanksCat && typeof prevDayRanksCat === "object" ? prevDayRanksCat : {};
  if (Object.keys(prevDay).length > 0) return prevDay;
  const isNewOfficialDay = !!(prevNorm.asOfSeoul && prevNorm.asOfSeoul < todayYmd);
  if (isNewOfficialDay && Object.keys(prevRanksCat).length > 0) return prevRanksCat;
  return prevRanksCat && typeof prevRanksCat === "object" ? prevRanksCat : {};
}

function seoulTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/**
 * @param {Record<string, any[]>} byCategory
 * @param {object} prevNorm
 * @param {string} [todayYmd]
 */
function computePeakRankMovementFields(byCategory, prevNorm, todayYmd) {
  const today = todayYmd || seoulTodayYmd();
  prevNorm = normalizePeakRankHistoryDoc(prevNorm);

  const newRanksByCategory = {};
  const newRankChangesByCategory = {};
  const newPreviousRanksByCategory = {};
  const newPrevDayRanksByCategory = {};

  for (const cat of PEAK_RANK_BOARD_CATEGORIES) {
    const rows = byCategory[cat];
    if (!Array.isArray(rows) || !rows.length) continue;

    const currRanks = buildPeakBoardRankMapForCategoryRows(rows);
    const prevRanksCat =
      prevNorm.ranksByCategory[cat] && typeof prevNorm.ranksByCategory[cat] === "object"
        ? prevNorm.ranksByCategory[cat]
        : {};
    const prevDayIn =
      prevNorm.prevDayRanksByCategory[cat] &&
      typeof prevNorm.prevDayRanksByCategory[cat] === "object"
        ? prevNorm.prevDayRanksByCategory[cat]
        : {};

    const frozenPrevDay = freezeOfficialPrevDayRanks(prevNorm, prevRanksCat, prevDayIn, today);
    const compareBaseline = resolveOfficialPeakRankBaseline(
      prevNorm,
      prevRanksCat,
      frozenPrevDay,
      today
    );

    newRanksByCategory[cat] = currRanks;
    newPrevDayRanksByCategory[cat] = frozenPrevDay;
    newRankChangesByCategory[cat] = {};
    newPreviousRanksByCategory[cat] = {};

    for (let i = 0; i < rows.length; i++) {
      const e = rows[i];
      const uid = e && e.userId != null ? String(e.userId).trim() : "";
      if (!uid) continue;
      const curr = currRanks[uid];
      if (curr == null) continue;

      delete e.rankChange;
      delete e.previousBoardRank;

      if (compareBaseline[uid] != null) {
        const prev = Math.floor(Number(compareBaseline[uid]));
        if (isFinite(prev) && prev >= 1) {
          e.rankChange = prev - curr;
          e.previousBoardRank = prev;
          newRankChangesByCategory[cat][uid] = e.rankChange;
          newPreviousRanksByCategory[cat][uid] = prev;
        }
      }
    }
  }

  return {
    asOfSeoul: today,
    newRanksByCategory,
    newRankChangesByCategory,
    newPreviousRanksByCategory,
    newPrevDayRanksByCategory,
  };
}

function payloadHasRankMovement(payload) {
  if (!payload || !payload.byCategory) return false;
  for (const cat of PEAK_RANK_BOARD_CATEGORIES) {
    const rows = payload.byCategory[cat] || [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r && r.rankChange != null && r.previousBoardRank != null) return true;
    }
  }
  return false;
}

module.exports = {
  PEAK_RANK_BOARD_CATEGORIES,
  buildPeakRankHistoryKey,
  resolveRankingBoardPeriod,
  resolvePeakRankHistoryKey,
  buildPeakBoardRankMapForCategoryRows,
  normalizePeakRankHistoryDoc,
  computePeakRankMovementFields,
  payloadHasRankMovement,
  seoulTodayYmd,
};
