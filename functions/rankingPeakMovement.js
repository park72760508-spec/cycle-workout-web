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

/** rolling90d 전환 시 등락 baseline — 구 rolling28d 스냅샷 키 */
function resolveLegacyPeakRankHistoryKey(historyKey) {
  const k = String(historyKey || "").trim();
  if (!k) return null;
  if (k.startsWith("peak_personal_speed_rolling90d_")) {
    return k.replace("rolling90d_", "rolling28d_");
  }
  return null;
}

/** 클라이언트 stelvioResolveRankingBoardPeriod 와 동일 */
function resolveRankingBoardPeriod(durationType, period) {
  const dt = String(durationType || "").trim();
  if (dt === "tss") return "weekly";
  if (dt === "personal_speed") return "rolling90d";
  if (dt === "personal_dist" || dt === "group_dist") return "rolling30";
  const pr = String(period || "").trim();
  if (pr === "yearly") return "monthly";
  if (pr === "rolling90" || pr === "rolling90d") return "rolling90d";
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
  if (dt === "personal_speed") return `peak_personal_speed_rolling90d_${g}`;
  if (dt === "group_dist") return "peak_group_dist_rolling30_all";
  const p = resolveRankingBoardPeriod(dt, period);
  return buildPeakRankHistoryKey(dt, p, g);
}

/**
 * 부문 목록 내 표시 순위(1..N) — item.rank(전체 Supremo 순위)와 혼용하지 않음.
 * 클라이언트 stelvioCategoryRankInFullList / stelvioBuildPeakRankMapForCategory 와 동일.
 */
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

/**
 * 탈퇴·목록 이탈자를 제외한 생존 코호트 기준 전일 순위 대비 등락.
 * 전일 스냅샷 모수에 탈퇴자가 남아 있으면 survivor rank 로 재산정 후 절대 비교.
 * @param {any[]} rows 현재 필터·정렬된 행(표시 순서 = 현재 순위)
 * @param {Record<string, number>} baseline uid → 전일(공식) 순위
 */
function computeSurvivorAwareRankMovementForRows(rows, baseline) {
  const rankChanges = {};
  const previousRanks = {};
  if (!Array.isArray(rows) || !rows.length || !baseline || typeof baseline !== "object") {
    return { rankChanges, previousRanks };
  }

  const survivorUids = [];
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i];
    const uid = e && e.userId != null ? String(e.userId).trim() : "";
    if (!uid || baseline[uid] == null) continue;
    const prevRaw = Math.floor(Number(baseline[uid]));
    if (!isFinite(prevRaw) || prevRaw < 1) continue;
    survivorUids.push(uid);
  }
  if (!survivorUids.length) return { rankChanges, previousRanks };

  const yesterdayOrderAsc = survivorUids
    .slice()
    .sort((a, b) => Math.floor(Number(baseline[a])) - Math.floor(Number(baseline[b])));

  const prevAmongSurvivors = {};
  for (let i = 0; i < yesterdayOrderAsc.length; i++) {
    prevAmongSurvivors[yesterdayOrderAsc[i]] = i + 1;
  }

  const currAmongSurvivors = {};
  let si = 0;
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i];
    const uid = e && e.userId != null ? String(e.userId).trim() : "";
    if (!uid || prevAmongSurvivors[uid] == null) continue;
    si++;
    currAmongSurvivors[uid] = si;
  }

  for (let i = 0; i < survivorUids.length; i++) {
    const uid = survivorUids[i];
    const prev = prevAmongSurvivors[uid];
    const curr = currAmongSurvivors[uid];
    if (prev == null || curr == null) continue;
    rankChanges[uid] = prev - curr;
    previousRanks[uid] = prev;
  }

  return { rankChanges, previousRanks };
}

/**
 * 주간 TSS·TOP10 — Supremo 전체 순위(절대 rank) vs 전일 baseline 절대 순위.
 * previousBoardRank = baseline[uid], rankChange = baseline[uid] − 현재 rank.
 */
function computeAbsoluteBoardRankMovementForRows(rows, baseline) {
  const rankChanges = {};
  const previousRanks = {};
  if (!Array.isArray(rows) || !rows.length || !baseline || typeof baseline !== "object") {
    return { rankChanges, previousRanks };
  }
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i];
    const uid = e && e.userId != null ? String(e.userId).trim() : "";
    if (!uid || baseline[uid] == null) continue;
    const prev = Math.floor(Number(baseline[uid]));
    if (!isFinite(prev) || prev < 1) continue;
    const curr =
      e.rank != null && isFinite(Number(e.rank)) && Number(e.rank) >= 1
        ? Math.floor(Number(e.rank))
        : i + 1;
    rankChanges[uid] = prev - curr;
    previousRanks[uid] = prev;
  }
  return { rankChanges, previousRanks };
}

/**
 * 탈퇴 필터·재정렬 후 payload 등락 재계산(서버 res.json·클라이언트 공통).
 */
function recomputePeakRankMovementAfterEligibleFilter(payload) {
  if (!payload || !payload.byCategory || typeof payload.byCategory !== "object") return payload;

  const tssWeeklyAbsolute = String(payload.durationType || "").trim() === "tss";
  const categoriesToProcess = tssWeeklyAbsolute ? ["Supremo"] : PEAK_RANK_BOARD_CATEGORIES;

  for (let ci = 0; ci < categoriesToProcess.length; ci++) {
    const cat = categoriesToProcess[ci];
    const rows = payload.byCategory[cat];
    if (!Array.isArray(rows) || !rows.length) continue;

    let baseline = null;
    const compare =
      payload.rankMovementCompareBaselineByCategory &&
      payload.rankMovementCompareBaselineByCategory[cat];
    const prevDay =
      payload.rankMovementPrevDayByCategory && payload.rankMovementPrevDayByCategory[cat];
    if (compare && typeof compare === "object" && Object.keys(compare).length) {
      baseline = compare;
    } else if (prevDay && typeof prevDay === "object" && Object.keys(prevDay).length) {
      baseline = prevDay;
    } else {
      baseline = {};
      for (let ri = 0; ri < rows.length; ri++) {
        const r = rows[ri];
        if (!r || r.userId == null || r.previousBoardRank == null) continue;
        const pr = Math.floor(Number(r.previousBoardRank));
        if (isFinite(pr) && pr >= 1) baseline[String(r.userId)] = pr;
      }
    }
    if (!baseline || !Object.keys(baseline).length) continue;

    const computeMv =
      tssWeeklyAbsolute && cat === "Supremo"
        ? computeAbsoluteBoardRankMovementForRows
        : computeSurvivorAwareRankMovementForRows;
    const { rankChanges, previousRanks } = computeMv(rows, baseline);
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (!row || row.userId == null) continue;
      const uid = String(row.userId);
      if (rankChanges[uid] == null || previousRanks[uid] == null) {
        delete row.rankChange;
        delete row.previousBoardRank;
        continue;
      }
      row.rankChange = rankChanges[uid];
      row.previousBoardRank = previousRanks[uid];
    }
  }

  return payload;
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

function seoulTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function seoulYesterdayYmd(todayYmd) {
  const today = String(todayYmd || seoulTodayYmd()).trim();
  const parts = today.split("-").map(Number);
  if (parts.length < 3 || !parts[0]) return today;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function freezeOfficialPrevDayRanks(prevNorm, prevRanksCat, prevDayRanksCat, todayYmd) {
  const today = todayYmd || seoulTodayYmd();
  const yesterday = seoulYesterdayYmd(today);
  const asOf = String(prevNorm.asOfSeoul || "").trim();
  const prevDay =
    prevDayRanksCat && typeof prevDayRanksCat === "object" ? prevDayRanksCat : {};

  /* 전일 03:00 공식 집계(as_of = today-1) 순위 */
  if (asOf === yesterday && Object.keys(prevRanksCat).length > 0) {
    return prevRanksCat;
  }
  /* 당일 재집계: 저장된 전일 baseline 유지 */
  if (asOf === today && Object.keys(prevDay).length > 0) {
    return prevDay;
  }
  const isNewOfficialDay = !asOf || asOf < today;
  if (isNewOfficialDay && Object.keys(prevRanksCat).length > 0) {
    return prevRanksCat;
  }
  return prevDay;
}

function resolveOfficialPeakRankBaseline(prevNorm, prevRanksCat, prevDayRanksCat, todayYmd) {
  const prevDay =
    prevDayRanksCat && typeof prevDayRanksCat === "object" ? prevDayRanksCat : {};
  if (Object.keys(prevDay).length > 0) return prevDay;
  const isNewOfficialDay = !!(prevNorm.asOfSeoul && prevNorm.asOfSeoul < todayYmd);
  if (isNewOfficialDay && Object.keys(prevRanksCat).length > 0) return prevRanksCat;
  /* 당일 재집계: prev_day 비어 있으면 당일 ranks로 비교하지 않음(전원 보합 오표시 방지) */
  return {};
}

function peakRankUidRankMapsEqual(a, b) {
  if (!a || typeof a !== "object") a = {};
  if (!b || typeof b !== "object") b = {};
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (Math.floor(Number(a[k])) !== Math.floor(Number(b[k]))) return false;
  }
  return keysA.length > 0;
}

/**
 * @param {Record<string, any[]>} byCategory
 * @param {object} prevNorm
 * @param {string} [todayYmd]
 * @param {{ tssWeeklyAbsolute?: boolean }} [opts]
 */
function computePeakRankMovementFields(byCategory, prevNorm, todayYmd, opts) {
  const today = todayYmd || seoulTodayYmd();
  prevNorm = normalizePeakRankHistoryDoc(prevNorm);
  opts = opts && typeof opts === "object" ? opts : {};
  const tssWeeklyAbsolute = opts.tssWeeklyAbsolute === true;
  const categoriesToProcess = tssWeeklyAbsolute ? ["Supremo"] : PEAK_RANK_BOARD_CATEGORIES;

  const newRanksByCategory = {};
  const newRankChangesByCategory = {};
  const newPreviousRanksByCategory = {};
  const newPrevDayRanksByCategory = {};
  const compareBaselineByCategory = {};

  for (const cat of categoriesToProcess) {
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
    const sameDaySelfBaseline =
      prevNorm.asOfSeoul === today &&
      peakRankUidRankMapsEqual(compareBaseline, currRanks);

    if (compareBaseline && Object.keys(compareBaseline).length) {
      compareBaselineByCategory[cat] = compareBaseline;
    }

    newRanksByCategory[cat] = currRanks;
    newPrevDayRanksByCategory[cat] = frozenPrevDay;
    newRankChangesByCategory[cat] = {};
    newPreviousRanksByCategory[cat] = {};

    if (!sameDaySelfBaseline && compareBaseline && Object.keys(compareBaseline).length) {
      const computeMv =
        tssWeeklyAbsolute && cat === "Supremo"
          ? computeAbsoluteBoardRankMovementForRows
          : computeSurvivorAwareRankMovementForRows;
      const survivorMv = computeMv(rows, compareBaseline);
      for (let i = 0; i < rows.length; i++) {
        const e = rows[i];
        const uid = e && e.userId != null ? String(e.userId).trim() : "";
        if (!uid) continue;
        delete e.rankChange;
        delete e.previousBoardRank;
        if (survivorMv.rankChanges[uid] == null || survivorMv.previousRanks[uid] == null) continue;
        e.rankChange = survivorMv.rankChanges[uid];
        e.previousBoardRank = survivorMv.previousRanks[uid];
        newRankChangesByCategory[cat][uid] = e.rankChange;
        newPreviousRanksByCategory[cat][uid] = e.previousBoardRank;
      }
    } else {
      for (let i = 0; i < rows.length; i++) {
        const e = rows[i];
        if (!e) continue;
        delete e.rankChange;
        delete e.previousBoardRank;
      }
    }
  }

  return {
    asOfSeoul: today,
    newRanksByCategory,
    newRankChangesByCategory,
    newPreviousRanksByCategory,
    newPrevDayRanksByCategory,
    compareBaselineByCategory,
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
  resolveLegacyPeakRankHistoryKey,
  buildPeakBoardRankMapForCategoryRows,
  computeSurvivorAwareRankMovementForRows,
  computeAbsoluteBoardRankMovementForRows,
  recomputePeakRankMovementAfterEligibleFilter,
  normalizePeakRankHistoryDoc,
  computePeakRankMovementFields,
  payloadHasRankMovement,
  seoulTodayYmd,
  seoulYesterdayYmd,
};
