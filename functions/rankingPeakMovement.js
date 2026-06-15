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
 * 전일 336위·오늘 331위(꼴창)처럼 절대 순위만 비교하면 탈퇴로 인한 허위 상승이 난다.
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
 * 탈퇴 필터·재정렬 후 payload 등락 재계산(서버 res.json·클라이언트 공통).
 */
function recomputePeakRankMovementAfterEligibleFilter(payload) {
  if (!payload || !payload.byCategory || typeof payload.byCategory !== "object") return payload;

  for (let ci = 0; ci < PEAK_RANK_BOARD_CATEGORIES.length; ci++) {
    const cat = PEAK_RANK_BOARD_CATEGORIES[ci];
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

    const { rankChanges, previousRanks } = computeSurvivorAwareRankMovementForRows(rows, baseline);
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
  /* 당일 재집계: prev_day 비어 있으면 당일 ranks로 비교하지 않음(전원 보합 오표시 방지) */
  return {};
}

function seoulTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
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
 */
function computePeakRankMovementFields(byCategory, prevNorm, todayYmd) {
  const today = todayYmd || seoulTodayYmd();
  prevNorm = normalizePeakRankHistoryDoc(prevNorm);

  const newRanksByCategory = {};
  const newRankChangesByCategory = {};
  const newPreviousRanksByCategory = {};
  const newPrevDayRanksByCategory = {};
  const compareBaselineByCategory = {};

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
      const survivorMv = computeSurvivorAwareRankMovementForRows(rows, compareBaseline);
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
  buildPeakBoardRankMapForCategoryRows,
  computeSurvivorAwareRankMovementForRows,
  recomputePeakRankMovementAfterEligibleFilter,
  normalizePeakRankHistoryDoc,
  computePeakRankMovementFields,
  payloadHasRankMovement,
  seoulTodayYmd,
};
