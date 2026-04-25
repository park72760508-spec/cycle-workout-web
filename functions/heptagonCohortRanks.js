/**
 * STELVIO 헵타곤: 코호트별(월·성별·부문) **전면(Supremo) 환산 점수 합**이 동일한 값으로 모든 부문에 저장되고,
 * 각 부문 코호트에서는 이 값만으로 **내림차순** 정렬해 `boardRank`를 부여한다(부문마다 별도 환산 합을 계산하지 않음).
 * - 기간: `getRolling30DaysRangeSeoul` (최근 30일, 서울)
 * - 7축 `sumPositionScores`: 항상 `computeDisplayRankForUser(..., "Supremo", ...)` 랭크로만 산출
 */

const HEPTAGON_DURATIONS = ["max", "1min", "5min", "10min", "20min", "40min", "60min"];
const HEPTAGON_GENDERS = ["all", "M", "F"];
const HEPTAGON_CATEGORIES = ["Supremo", "Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"];
const N_AXIS = 7;
const HEPTAGON_COHORT_COL = "heptagon_cohort_ranks";

/**
 * Supremo: 전 기간(전체) 집계. 그 외: 선택 부문 **소속**만(타 부문 열람용 가상 순위 제외).
 * Assoluto: ageCategory === Assoluto.
 */
function isUserInCohortForFilter(filterCategory, userAgeCategory) {
  const f = String(filterCategory || "Supremo");
  const ac = String(userAgeCategory || "");
  if (f === "Supremo") return true;
  if (f === "Assoluto") return ac === "Assoluto";
  if (!ac) return false;
  return ac === f;
}

/** 대시보드 StelvioOctagonRanksCard `currentMonthKeyKst`와 동일: 서울 달력 월(YYYY-MM) */
function getMonthKeyKstNow() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).slice(0, 7);
}

function safeFloorRank(n) {
  const r = Number(n);
  return isFinite(r) && r >= 1 ? Math.floor(r) : null;
}

function cohortSizeForCategory(byCategory, category) {
  const arr = byCategory[category];
  return Array.isArray(arr) ? arr.length : 0;
}

function rankInCategoryByValue(categoryRows, myVal) {
  const eps = 1e-9;
  let strictlyGreater = 0;
  for (let i = 0; i < categoryRows.length; i++) {
    const row = categoryRows[i];
    if (!row) continue;
    const v = Number(row.wkg);
    if (isFinite(v) && v > myVal + eps) strictlyGreater++;
  }
  return strictlyGreater + 1;
}

function rankDisplayForChart(n) {
  if (n !== 2) return n;
  return 3;
}

/**
 * 단일 duration의 byCategory + 사용자 profile 부문으로, 화면과 동일한 "표시 순위" 1..
 */
function computeDisplayRankForUser(byCategory, userId, filterCategory, userAgeCategory) {
  const supremo = byCategory.Supremo || [];
  const cu = supremo.find((e) => e && e.userId === userId);
  if (!cu) return { rank: null, n: 0 };

  if (filterCategory === "Supremo") {
    return { rank: safeFloorRank(cu.rank), n: cohortSizeForCategory(byCategory, "Supremo") };
  }
  if (userAgeCategory && filterCategory === userAgeCategory) {
    const heroArr = byCategory[filterCategory] || [];
    const heroIdx = heroArr.findIndex((e) => e && e.userId === userId);
    if (heroIdx >= 0) return { rank: heroIdx + 1, n: heroArr.length };
    return { rank: null, n: cohortSizeForCategory(byCategory, filterCategory) };
  }
  const compareArr = byCategory[filterCategory] || [];
  const myVal = Number(cu.wkg);
  if (!isFinite(myVal)) return { rank: null, n: compareArr.length };
  const rawRank = rankInCategoryByValue(compareArr, myVal);
  if (rawRank == null) return { rank: null, n: compareArr.length };
  const displayR = filterCategory !== userAgeCategory ? rankDisplayForChart(rawRank) : rawRank;
  return { rank: displayR, n: compareArr.length };
}

function positionScore100FromRank(rank, n) {
  const ni = n | 0;
  if (ni < 1) return 0;
  if (rank == null || !isFinite(rank) || rank < 1) return 0;
  let r = Math.floor(Number(rank));
  if (r < 1) r = 1;
  if (r > ni) r = ni;
  if (ni === 1) return 100;
  return (100 * (ni - r)) / (ni - 1);
}

function effectiveRankForAverage(rank, n) {
  const nn = n | 0;
  if (nn < 1) return null;
  if (rank == null || !isFinite(rank) || rank < 1) return nn;
  let r = Math.floor(Number(rank));
  if (r < 1) r = 1;
  if (r > nn) r = nn;
  return r;
}

function stelvioOctagonSmallGroupK(n) {
  const N = n | 0;
  if (N < 1) N = 1;
  if (N >= 100) return 1;
  return 1 + (100 - N) / (100 + N);
}

function stelvioOctagonPercentCutoffs(nRef) {
  const N = nRef | 0;
  if (N < 1) N = 1;
  if (N >= 100) {
    return { k: 1, isLarge: true, cutoffs: [5, 10, 20, 40, 60, 80] };
  }
  const k = stelvioOctagonSmallGroupK(N);
  const bases = [5, 10, 20, 40, 60, 80];
  const cut = [];
  for (let i = 0; i < bases.length; i++) {
    const B = bases[i];
    let sc = B * k;
    if (sc > 100) sc = 100;
    const fl = (B / 5) * (100 / N);
    let v = Math.max(sc, fl);
    if (v > 100) v = 100;
    if (i > 0) {
      if (v <= cut[i - 1]) v = cut[i - 1] + 0.0001;
      if (v > 100) v = 100;
      if (v <= cut[i - 1]) v = 100;
    }
    cut.push(v);
  }
  return { k, isLarge: false, cutoffs: cut };
}

function tierIdFromP(pTotal, co) {
  if (pTotal <= co[0]) return "HC";
  if (pTotal <= co[1]) return "C1";
  if (pTotal <= co[2]) return "C2";
  if (pTotal <= co[3]) return "C3";
  if (pTotal <= co[4]) return "C4";
  if (pTotal <= co[5]) return "C5";
  return "C6";
}

/** 레벨%: (순위÷필터 코호트 모수)×100 — 모수 100 미만도 동일(대시보드와 일치) */
function heptagonLevelPercentForRankN(boardRank, nCohort) {
  const Nc = nCohort | 0;
  if (Nc < 1) return 0;
  let r = boardRank == null || !isFinite(boardRank) ? 1 : Math.floor(Number(boardRank));
  if (r < 1) r = 1;
  if (r > Nc) r = Nc;
  return (r / Nc) * 100;
}

/**
 * STELVIO 헵타곤 등급(표시: 레벨1~7 ↔ HC~C6)
 * ≤3% L1, (3,7] L2, (7,20] L3, (20,40] L4, (40,60] L5, (60,90] L6, >90% L7
 */
function heptagonCohortBoardTierIdFromLevelPercent(p) {
  if (!isFinite(p)) return "C6";
  if (p <= 3) return "HC";
  if (p <= 7) return "C1";
  if (p <= 20) return "C2";
  if (p <= 40) return "C3";
  if (p <= 60) return "C4";
  if (p <= 90) return "C5";
  return "C6";
}

function comprehensiveRankFromSumPosition100(sum0to700, nRef) {
  const n = nRef | 0;
  if (n < 1) return NaN;
  let s = Number(sum0to700);
  if (!isFinite(s)) return NaN;
  if (s < 0) s = 0;
  if (s > 700) s = 700;
  if (n === 1) return 1;
  let r = 1 + (1 - s / 700) * (n - 1);
  if (r < 1) r = 1;
  if (r > n) r = n;
  return r;
}

function computePTotalAndTierHeptagon(ranks, cohortNPerAxis) {
  if (!ranks || !cohortNPerAxis || ranks.length !== N_AXIS || cohortNPerAxis.length !== N_AXIS) {
    return null;
  }
  let nRef = 0;
  for (let k = 0; k < N_AXIS; k++) {
    const nk0 = cohortNPerAxis[k] | 0;
    if (nk0 > nRef) nRef = nk0;
  }
  if (nRef < 1) return null;

  const posScores = [];
  let allOk = true;
  for (let i = 0; i < N_AXIS; i++) {
    const ni = (cohortNPerAxis[i] | 0) > 0 ? cohortNPerAxis[i] : nRef;
    const er = effectiveRankForAverage(ranks[i], ni);
    if (er == null) {
      allOk = false;
      break;
    }
    posScores.push(positionScore100FromRank(ranks[i], ni));
  }
  if (!allOk) return null;

  let sumPos = 0;
  for (let j = 0; j < posScores.length; j++) sumPos += posScores[j];
  const avgPos = sumPos / N_AXIS;
  if (!isFinite(avgPos)) return null;
  const pTier = 100 - Math.max(0, Math.min(100, avgPos));
  const cspec = stelvioOctagonPercentCutoffs(nRef);
  const tierId = tierIdFromP(pTier, cspec.cutoffs);
  const rFromSumPos = comprehensiveRankFromSumPosition100(sumPos, nRef);
  if (!isFinite(rFromSumPos)) return null;
  const pComprehensive = nRef >= 1 ? (rFromSumPos / nRef) * 100 : pTier;
  return {
    positionScores100: posScores,
    sumPositionScores: sumPos,
    avgPositionScore: avgPos,
    pTier,
    tierId,
    nRef,
    pComprehensive,
    comprehensiveRankSynthetic: rFromSumPos,
  };
}

/**
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {object} deps
 * @param {Function} deps.getPeakPowerRankingEntries
 * @param {Function} deps.getLeagueCategory
 * @param {Function} deps.getRolling30DaysRangeSeoul
 * @param {typeof import("firebase-admin")} admin
 */
async function runRebuildHeptagonCohortRanks(db, deps) {
  const { getPeakPowerRankingEntries, getLeagueCategory, getRolling30DaysRangeSeoul } = deps;
  const { admin } = deps;
  const t0 = Date.now();
  const { startStr, endStr } = getRolling30DaysRangeSeoul();
  const monthKey = getMonthKeyKstNow();
  const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

  const usersSnap = await db.collection("users").get();
  const userMeta = new Map();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
    const challenge = data.challenge || "Fitness";
    const leagueCategory = getLeagueCategory(challenge, birthYear);
    if (!leagueCategory) continue;
    userMeta.set(doc.id, {
      displayName: (data.name || data.displayName || "(이름 없음)").toString().trim() || "(이름 없음)",
      ageCategory: leagueCategory,
      is_private: data.is_private === true,
    });
  }

  const cache = {};
  for (const g of HEPTAGON_GENDERS) {
    cache[g] = {};
    for (const d of HEPTAGON_DURATIONS) {
      const { entries, byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, d, g);
      cache[g][d] = { byCategory, entries };
    }
  }

  let wrote = 0;
  let batch = db.batch();
  let batchCount = 0;
  const commitBatch = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    wrote += batchCount;
    batch = db.batch();
    batchCount = 0;
  };

  /** filterGender — userId — 전면(Supremo) 기준 7축·합 (모든 부문이 동일 sum 공유) */
  const supRowByUser = {};
  for (const filterGender of HEPTAGON_GENDERS) {
    const supMap = new Map();
    for (const [userId, meta] of userMeta) {
      if (!isUserInCohortForFilter("Supremo", meta.ageCategory)) {
        continue;
      }
      const ranks = [];
      const ns = [];
      let ok = true;
      for (const d of HEPTAGON_DURATIONS) {
        const { byCategory } = cache[filterGender][d];
        const dr = computeDisplayRankForUser(byCategory, userId, "Supremo", meta.ageCategory);
        if (dr == null || dr.rank == null || !isFinite(Number(dr.rank))) {
          ok = false;
          break;
        }
        ranks.push(Number(dr.rank));
        ns.push(Number(dr.n) | 0);
      }
      if (!ok) continue;
      const tier = computePTotalAndTierHeptagon(ranks, ns);
      if (!tier) continue;
      supMap.set(userId, {
        userId,
        displayName: meta.displayName,
        ageCategory: meta.ageCategory,
        is_private: meta.is_private,
        ranks,
        cohortNPerAxis: ns,
        ...tier,
      });
    }
    supRowByUser[filterGender] = supMap;
  }

  for (const filterGender of HEPTAGON_GENDERS) {
    for (const filterCategory of HEPTAGON_CATEGORIES) {
      const rows = [];
      const supMap = supRowByUser[filterGender];
      for (const [userId, meta] of userMeta) {
        if (!isUserInCohortForFilter(filterCategory, meta.ageCategory)) {
          continue;
        }
        const pre = supMap.get(userId);
        if (!pre) continue;
        rows.push({ ...pre });
      }
      rows.sort((a, b) => {
        if (b.sumPositionScores !== a.sumPositionScores) return b.sumPositionScores - a.sumPositionScores;
        return String(a.userId).localeCompare(String(b.userId));
      });
      const L = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const boardRank = i + 1;
        const r = rows[i];
        const docId = `${monthKey}_${filterCategory}_${filterGender}_${r.userId}`.replace(/\//g, "_");
        const ref = db.collection(HEPTAGON_COHORT_COL).doc(docId);
        const pCohort = heptagonLevelPercentForRankN(boardRank, L);
        const boardTierId = heptagonCohortBoardTierIdFromLevelPercent(pCohort);
        const crSynth = comprehensiveRankFromSumPosition100(r.sumPositionScores, L);
        const crSynthI = isFinite(crSynth) ? Math.max(1, Math.min(L, Math.round(crSynth))) : null;
        batch.set(
          ref,
          {
            monthKey,
            periodMode: "rolling30",
            rangeStart: startStr,
            rangeEnd: endStr,
            asOfSeoul: todayYmd,
            userId: r.userId,
            displayName: r.displayName,
            ageCategory: r.ageCategory,
            filterCategory,
            filterGender,
            boardRank,
            comprehensiveRank: boardRank,
            sumPositionScores: r.sumPositionScores,
            avgPositionScore: r.avgPositionScore,
            positionScores100: r.positionScores100,
            ranks: r.ranks,
            cohortNPerAxis: r.cohortNPerAxis,
            pTier: pCohort,
            tierId: boardTierId,
            nRef: L,
            pComprehensive: pCohort,
            comprehensiveRankSynthetic: crSynthI,
            is_private: r.is_private === true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        batchCount++;
        if (batchCount >= 400) {
          await commitBatch();
        }
      }
    }
  }
  await commitBatch();
  const ms = Date.now() - t0;
  console.log("[runRebuildHeptagonCohortRanks] done", { monthKey, startStr, endStr, wrote, ms, users: userMeta.size });
  return { monthKey, startStr, endStr, wrote, ms };
}

module.exports = {
  runRebuildHeptagonCohortRanks,
  HEPTAGON_COHORT_COL,
  HEPTAGON_GENDERS,
  HEPTAGON_CATEGORIES,
  HEPTAGON_DURATIONS,
};
