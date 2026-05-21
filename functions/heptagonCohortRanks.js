/**
 * STELVIO 헵타곤: 코호트별(월·성별·부문) **전면(Supremo) 환산 점수 합**이 동일한 값으로 모든 부문에 저장되고,
 * 각 부문 코호트에서는 이 값만으로 **내림차순** 정렬해 `boardRank`를 부여한다(부문마다 별도 환산 합을 계산하지 않음).
 * - 기간: `getRolling28DaysRangeSeoul` (최근 28일, 서울) — 피크는 구간별 단일 최고값(일 버킷 max)
 * - 7축 `sumPositionScores`: 항상 `computeDisplayRankForUser(..., "Supremo", ...)` 랭크로만 산출
 */

const HEPTAGON_DURATIONS = ["max", "1min", "5min", "10min", "20min", "40min", "60min"];
const HEPTAGON_GENDERS = ["all", "M", "F"];
const HEPTAGON_CATEGORIES = ["Supremo", "Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"];
const N_AXIS = 7;
const HEPTAGON_COHORT_COL = "heptagon_cohort_ranks";

/** 랭킹보드 월간 피크 집계 키와 동일 — getPeakPowerRanking / rebuildRankingAggregates (28일 롤링) */
function peakMonthlyAggregateDocKey(durationType, gender, startStr, endStr) {
  return `peakRanking_v2_monthly_${durationType}_${gender}_${startStr}_${endStr}`;
}

/**
 * 사전 집계(ranking_aggregates) 21슬롯 — 23:00 마스터와 동일 피크 보드
 * 한 슬롯만 없어도 전체 null 이 되면 헵타곤이 며칠째 갱신되지 않음 → 부분 로드 + onepass 보강.
 * @param {Function} readPayload async (db, key) => payload | null
 * @returns {{ cache: object, complete: boolean, missingSlots: Array<{g:string,d:string,cacheKey:string}> }|null}
 */
async function tryLoadHeptagonPeakCacheFromAggregates(db, readPayload, startStr, endStr) {
  if (!readPayload) return null;
  const slots = [];
  for (const g of HEPTAGON_GENDERS) {
    for (const d of HEPTAGON_DURATIONS) {
      slots.push({ g, d, cacheKey: peakMonthlyAggregateDocKey(d, g, startStr, endStr) });
    }
  }
  const payloads = await Promise.all(slots.map((s) => readPayload(db, s.cacheKey)));
  const cache = {};
  const missingSlots = [];
  for (let i = 0; i < slots.length; i++) {
    const { g, d, cacheKey } = slots[i];
    const payload = payloads[i];
    if (
      !payload ||
      !payload.byCategory ||
      (payload.startStr != null &&
        payload.endStr != null &&
        (String(payload.startStr) !== startStr || String(payload.endStr) !== endStr))
    ) {
      missingSlots.push({ g, d, cacheKey });
      continue;
    }
    if (!cache[g]) cache[g] = {};
    cache[g][d] = {
      byCategory: payload.byCategory,
      entries: Array.isArray(payload.entries) ? payload.entries : [],
    };
  }
  if (!Object.keys(cache).length) return null;
  return {
    cache,
    complete: missingSlots.length === 0,
    missingSlots,
  };
}

/**
 * 수동·스케줄 공통: 마스터 집계 캐시 우선(신선 → 긴 stale) → 부분만 있어도 반환
 */
async function tryLoadHeptagonPeakCacheForRebuild(db, readFresh, readAllowStale, startStr, endStr) {
  const freshHit = await tryLoadHeptagonPeakCacheFromAggregates(db, readFresh, startStr, endStr);
  if (freshHit && freshHit.complete) {
    return { cache: freshHit.cache, peakSource: "aggregates_fresh", missingSlots: [] };
  }
  if (readAllowStale) {
    const staleHit = await tryLoadHeptagonPeakCacheFromAggregates(db, readAllowStale, startStr, endStr);
    if (staleHit && staleHit.complete) {
      return { cache: staleHit.cache, peakSource: "aggregates_stale", missingSlots: [] };
    }
    if (staleHit && staleHit.cache) {
      return {
        cache: staleHit.cache,
        peakSource: "aggregates_stale_partial",
        missingSlots: staleHit.missingSlots,
      };
    }
  }
  if (freshHit && freshHit.cache) {
    return {
      cache: freshHit.cache,
      peakSource: "aggregates_fresh_partial",
      missingSlots: freshHit.missingSlots,
    };
  }
  return null;
}

/** onepass 결과에서 누락 슬롯만 채움 */
function fillHeptagonCacheMissingSlots(cache, fullMapped, missingSlots) {
  if (!cache || !fullMapped || !missingSlots || !missingSlots.length) return cache;
  for (let i = 0; i < missingSlots.length; i++) {
    const { g, d } = missingSlots[i];
    const pack = fullMapped[g] && fullMapped[g][d];
    if (!pack || !pack.byCategory) continue;
    if (!cache[g]) cache[g] = {};
    cache[g][d] = {
      byCategory: pack.byCategory,
      entries: Array.isArray(pack.entries) ? pack.entries : [],
    };
  }
  return cache;
}

/** 7축 피크 캐시 구조 검증 */
function heptagonPeakCacheIsComplete(cache) {
  if (!cache || typeof cache !== "object") return false;
  for (const g of HEPTAGON_GENDERS) {
    if (!cache[g] || typeof cache[g] !== "object") return false;
    for (const d of HEPTAGON_DURATIONS) {
      const slot = cache[g][d];
      if (!slot || !slot.byCategory) return false;
    }
  }
  return true;
}

/** buildPeakPowerAllDurationsForRangeAllGendersOnePass 결과 → 헵타곤 cache[g][d] 형식 */
function mapAllDurToHeptagonCache(allDur) {
  if (!allDur) return null;
  const cache = {};
  for (const g of HEPTAGON_GENDERS) {
    cache[g] = {};
    for (const d of HEPTAGON_DURATIONS) {
      const pack = allDur[g] && allDur[g][d];
      if (!pack || !pack.byCategory) return null;
      cache[g][d] = { byCategory: pack.byCategory, entries: pack.entries || [] };
    }
  }
  return cache;
}

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

const HEPTAGON_AGE_CATEGORIES = ["Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"];

/**
 * 피크 byCategory에서 userId 행 탐색 — Supremo 우선, 없으면 연령·선수부 배열(대시보드 StelvioOctagonRanksCard [4]와 동일).
 */
function findUserPeakRowInByCategory(byCategory, userId) {
  if (!byCategory || userId == null) return null;
  const uid = String(userId);
  const supremo = byCategory.Supremo || [];
  const inSup = supremo.find((e) => e && String(e.userId) === uid);
  if (inSup) return { entry: inSup, inSupremo: true };
  for (let i = 0; i < HEPTAGON_AGE_CATEGORIES.length; i++) {
    const cat = HEPTAGON_AGE_CATEGORIES[i];
    const arr = byCategory[cat] || [];
    const hit = arr.find((e) => e && String(e.userId) === uid);
    if (hit) return { entry: hit, inSupremo: false };
  }
  return null;
}

/**
 * 단일 duration의 byCategory + 사용자 profile 부문으로, 화면·대시보드와 동일한 "표시 순위" 1..
 * Supremo: 배열 내 rank → W/kg 추정(rankInCategoryByValue) → 부문 배열 entry.rank 순.
 */
function computeDisplayRankForUser(byCategory, userId, filterCategory, userAgeCategory) {
  const found = findUserPeakRowInByCategory(byCategory, userId);
  if (!found) return { rank: null, n: 0 };

  const cu = found.entry;
  const supremo = byCategory.Supremo || [];
  const nSup = cohortSizeForCategory(byCategory, "Supremo");

  if (filterCategory === "Supremo") {
    if (found.inSupremo) {
      const r0 = safeFloorRank(cu.rank);
      if (r0 != null) return { rank: r0, n: nSup };
    }
    const myVal = Number(cu.wkg);
    if (isFinite(myVal) && myVal > 0 && supremo.length > 0) {
      const est = rankInCategoryByValue(supremo, myVal);
      if (est != null) return { rank: est, n: nSup };
    }
    const r1 = safeFloorRank(cu.rank);
    if (r1 != null) return { rank: r1, n: nSup };
    return { rank: null, n: nSup };
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

/**
 * 대시보드 `heptagonLevelPercentForRankN`과 동일(실집계, isVirtual=false). L≥100 → (r/L)×100, 미만 → ((r/L)/(100/L))×100.
 */
function heptagonLevelPercentForRankN(boardRank, nCohort) {
  const Nc = nCohort | 0;
  if (Nc < 1) return 0;
  let r = boardRank == null || !isFinite(boardRank) ? 1 : Math.floor(Number(boardRank));
  if (r < 1) r = 1;
  const finalN = Nc;
  if (r > finalN) r = finalN;
  if (finalN >= 100) {
    return (r / finalN) * 100;
  }
  const n2 = 100 / finalN;
  return ((r / finalN) / n2) * 100;
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
 * @param {Function} deps.getRolling28DaysRangeSeoul
 * @param {typeof import("firebase-admin")} admin
 * @param {Function} [deps.readRankingAggregatePayloadIfFresh] ranking_aggregates 신선(26h)
 * @param {Function} [deps.readRankingAggregatePayloadAllowStale] 마스터 직후·수동 집계용 stale 허용
 * @param {Function} [deps.buildPeakPowerAllDurationsForRangeAllGendersOnePass] 마스터와 동일 1패스 (선택)
 */
async function runRebuildHeptagonCohortRanks(db, deps) {
  const {
    getPeakPowerRankingEntries,
    getLeagueCategory,
    getRolling28DaysRangeSeoul,
    readRankingAggregatePayloadIfFresh,
    readRankingAggregatePayloadAllowStale,
    buildPeakPowerAllDurationsForRangeAllGendersOnePass,
  } = deps;
  const { admin } = deps;
  const t0 = Date.now();
  const { startStr, endStr } = getRolling28DaysRangeSeoul();
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

  let peakSource = "none";
  let cache = null;
  let missingSlots = [];
  const aggHit = await tryLoadHeptagonPeakCacheForRebuild(
    db,
    readRankingAggregatePayloadIfFresh,
    readRankingAggregatePayloadAllowStale,
    startStr,
    endStr
  );
  if (aggHit && aggHit.cache) {
    cache = aggHit.cache;
    peakSource = aggHit.peakSource;
    missingSlots = Array.isArray(aggHit.missingSlots) ? aggHit.missingSlots : [];
  }
  if (
    cache &&
    missingSlots.length > 0 &&
    typeof buildPeakPowerAllDurationsForRangeAllGendersOnePass === "function"
  ) {
    const allDurFill = await buildPeakPowerAllDurationsForRangeAllGendersOnePass(db, startStr, endStr, usersSnap);
    const mappedFill = mapAllDurToHeptagonCache(allDurFill);
    if (mappedFill) {
      fillHeptagonCacheMissingSlots(cache, mappedFill, missingSlots);
      peakSource = `${peakSource}+onepass_fill`;
      missingSlots = [];
    }
  }
  if (!cache && typeof buildPeakPowerAllDurationsForRangeAllGendersOnePass === "function") {
    const allDur = await buildPeakPowerAllDurationsForRangeAllGendersOnePass(db, startStr, endStr, usersSnap);
    cache = mapAllDurToHeptagonCache(allDur);
    if (cache) peakSource = "onepass";
  }
  if (!cache && typeof getPeakPowerRankingEntries === "function") {
    console.warn(
      "[runRebuildHeptagonCohortRanks] aggregates·onepass miss — legacy 21× 피크 스캔(수동 집계와 다를 수 있음)"
    );
    cache = {};
    for (const g of HEPTAGON_GENDERS) {
      cache[g] = {};
      for (const d of HEPTAGON_DURATIONS) {
        const { entries, byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, d, g, usersSnap);
        cache[g][d] = { byCategory, entries };
      }
    }
    peakSource = "legacy";
  }
  if (!heptagonPeakCacheIsComplete(cache)) {
    throw new Error(
      `heptagon_peak_cache_unavailable(incomplete peakSource=${peakSource} missing=${missingSlots.length})`
    );
  }

  // 배치 쓰기 전에 기존 문서의 boardRank·asOfSeoul 을 한 번에 읽어 전날 순위 비교에 사용
  // docId: `${monthKey}_${filterCategory}_${filterGender}_${userId}` → boardRank, asOfSeoul
  const prevRankMap = new Map(); // key: docId, value: { boardRank, asOfSeoul }
  try {
    const existingSnap = await db
      .collection(HEPTAGON_COHORT_COL)
      .where("monthKey", "==", monthKey)
      .select("boardRank", "asOfSeoul", "yesterdayOfficialBoardRank")
      .get();
    for (const doc of existingSnap.docs) {
      const d = doc.data();
      if (d.boardRank != null && isFinite(Number(d.boardRank))) {
        prevRankMap.set(doc.id, {
          boardRank: Math.floor(Number(d.boardRank)),
          asOfSeoul: d.asOfSeoul || "",
          yesterdayOfficialBoardRank:
            d.yesterdayOfficialBoardRank != null && isFinite(Number(d.yesterdayOfficialBoardRank))
              ? Math.floor(Number(d.yesterdayOfficialBoardRank))
              : null,
        });
      }
    }
    console.log("[runRebuildHeptagonCohortRanks] prevRankMap loaded:", prevRankMap.size);
  } catch (e) {
    // 조회 실패 시 전날 순위 없이 계속 진행
    console.warn("[runRebuildHeptagonCohortRanks] prevRankMap load failed:", e && e.message);
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
        const slot = cache[filterGender] && cache[filterGender][d];
        if (!slot || !slot.byCategory) {
          ok = false;
          break;
        }
        const { byCategory } = slot;
        const dr = computeDisplayRankForUser(byCategory, userId, "Supremo", meta.ageCategory);
        const nAxis = Number(dr && dr.n) | 0;
        if (!dr || nAxis < 1) {
          ok = false;
          break;
        }
        let rankUse = dr.rank;
        if (rankUse == null || !isFinite(Number(rankUse))) {
          /* 대시보드 computePTotalAndTier: null rank → effectiveRankForAverage = n(꼴찌) */
          rankUse = nAxis;
        }
        ranks.push(Number(rankUse));
        ns.push(nAxis);
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

        /** 전일 03:20 정규 집계 순위(yesterdayOfficial) 고정 — 당일 수동 재집계 시에도 덮어쓰지 않음 */
        const existing = prevRankMap.get(docId);
        const rankChangeFields = {};
        let yesterdayOfficial = null;
        if (existing) {
          if (existing.asOfSeoul && existing.asOfSeoul !== todayYmd) {
            yesterdayOfficial = existing.boardRank;
          } else if (
            existing.yesterdayOfficialBoardRank != null &&
            isFinite(Number(existing.yesterdayOfficialBoardRank))
          ) {
            yesterdayOfficial = Math.floor(Number(existing.yesterdayOfficialBoardRank));
          }
        }
        if (yesterdayOfficial != null && yesterdayOfficial >= 1) {
          rankChangeFields.yesterdayOfficialBoardRank = yesterdayOfficial;
          rankChangeFields.previousBoardRank = yesterdayOfficial;
          rankChangeFields.rankChange = yesterdayOfficial - boardRank;
        } else if (!existing) {
          rankChangeFields.previousBoardRank = null;
          rankChangeFields.rankChange = null;
          rankChangeFields.yesterdayOfficialBoardRank = null;
        } else {
          /* 당일 재집계: yesterdayOfficial·등락은 merge 유지, boardRank 등만 갱신 */
        }

        batch.set(
          ref,
          {
            monthKey,
            periodMode: "rolling28",
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
            ...rankChangeFields,
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
  if (wrote < 1) {
    throw new Error(
      `heptagon_cohort_ranks_zero_writes(users=${userMeta.size} peakSource=${peakSource} asOf=${todayYmd})`
    );
  }
  console.log("[runRebuildHeptagonCohortRanks] done", {
    monthKey,
    startStr,
    endStr,
    wrote,
    ms,
    users: userMeta.size,
    peakSource,
    asOfSeoul: todayYmd,
  });
  return { monthKey, startStr, endStr, wrote, ms, peakSource, asOfSeoul: todayYmd };
}

/**
 * 즉시 GC 집계(디버그·비상용). 프로덕션 GC는 `scheduledPeak28dHeptagonOnly`(03:20) 스냅샷 + Firestore 읽기.
 * 대시보드와 동일 파이프라인(28일 롤링, 구간별 최고 피크 1건).
 *
 * @param {string} filterGender `"all" | "M" | "F"` — getPeakPowerRanking gc 분기와 동일
 * @returns {{ byCategory: object, entries: Array, startStr: string, endStr: string, peakSource: string }}
 */
async function buildLiveGcRankingPayload(db, filterGender, deps) {
  const {
    getPeakPowerRankingEntries,
    getLeagueCategory,
    getRolling28DaysRangeSeoul,
    readRankingAggregatePayloadIfFresh,
    buildPeakPowerAllDurationsForRangeAllGendersOnePass,
  } = deps;

  const { startStr, endStr } = getRolling28DaysRangeSeoul();

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

  let peakSource = "legacy";
  let cache = null;
  const aggLive = await tryLoadHeptagonPeakCacheFromAggregates(
    db,
    readRankingAggregatePayloadIfFresh,
    startStr,
    endStr
  );
  if (aggLive && aggLive.complete && aggLive.cache) {
    cache = aggLive.cache;
    peakSource = "aggregates";
  } else if (typeof buildPeakPowerAllDurationsForRangeAllGendersOnePass === "function") {
    const allDur = await buildPeakPowerAllDurationsForRangeAllGendersOnePass(db, startStr, endStr, usersSnap);
    cache = mapAllDurToHeptagonCache(allDur);
    if (cache) peakSource = "onepass";
  }
  if (!cache) {
    cache = {};
    for (const g of HEPTAGON_GENDERS) {
      cache[g] = {};
      for (const d of HEPTAGON_DURATIONS) {
        const { entries, byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, d, g, usersSnap);
        cache[g][d] = { byCategory, entries };
      }
    }
    peakSource = "legacy";
  }

  const supRowByUser = {};
  for (const filterG of HEPTAGON_GENDERS) {
    const supMap = new Map();
    for (const [userId, meta] of userMeta) {
      if (!isUserInCohortForFilter("Supremo", meta.ageCategory)) {
        continue;
      }
      const ranks = [];
      const ns = [];
      let ok = true;
      for (const d of HEPTAGON_DURATIONS) {
        const { byCategory } = cache[filterG][d];
        const dr = computeDisplayRankForUser(byCategory, userId, "Supremo", meta.ageCategory);
        const nAxis = Number(dr && dr.n) | 0;
        if (!dr || nAxis < 1) {
          ok = false;
          break;
        }
        let rankUse = dr.rank;
        if (rankUse == null || !isFinite(Number(rankUse))) {
          rankUse = nAxis;
        }
        ranks.push(Number(rankUse));
        ns.push(nAxis);
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
    supRowByUser[filterG] = supMap;
  }

  const applyGenderScoreUnify = filterGender === "M" || filterGender === "F";
  const supMapFg = supRowByUser[filterGender];
  const supMapAll = supRowByUser.all;
  const genderStr = filterGender === "F" ? "female" : filterGender === "M" ? "male" : "male";

  const byCategory = {
    Supremo: [],
    Assoluto: [],
    Bianco: [],
    Rosa: [],
    Infinito: [],
    Leggenda: [],
  };

  for (let ci = 0; ci < HEPTAGON_CATEGORIES.length; ci++) {
    const cat = HEPTAGON_CATEGORIES[ci];
    const rows = [];
    for (const [userId, meta] of userMeta) {
      if (!isUserInCohortForFilter(cat, meta.ageCategory)) continue;
      const pre = supMapFg.get(userId);
      if (!pre) continue;
      rows.push({ ...pre });
    }
    const apiRows = [];
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      let gcScore = r.sumPositionScores;
      if (applyGenderScoreUnify && supMapAll.has(r.userId)) {
        gcScore = supMapAll.get(r.userId).sumPositionScores;
      }
      apiRows.push({
        userId: String(r.userId),
        name: r.displayName,
        ageCategory: r.ageCategory,
        gender: genderStr,
        is_private: r.is_private === true,
        rank: 0,
        gcScore,
      });
    }
    apiRows.sort((a, b) => {
      if (b.gcScore !== a.gcScore) return b.gcScore - a.gcScore;
      return String(a.userId).localeCompare(String(b.userId));
    });
    for (let i = 0; i < apiRows.length; i++) {
      apiRows[i].rank = i + 1;
    }
    byCategory[cat] = apiRows;
  }

  const entries = (byCategory.Supremo || []).slice();
  return { byCategory, entries, startStr, endStr, peakSource };
}

/**
 * GC 랭킹보드: 일일 스냅샷에 없고 라이브 집계에만 있는 사용자를 병합(대시보드 헵타곤 목록·삽입과 정합).
 * @param {object} snapPayload buildStelvioGcRankingPayload 결과
 * @param {object} livePayload buildLiveGcRankingPayload 결과
 * @param {string} filterGender
 */
function mergeGcRankingSnapshotWithLive(snapPayload, livePayload, filterGender) {
  if (!snapPayload || !livePayload || !livePayload.byCategory) {
    return snapPayload;
  }
  const byCategory = {
    Supremo: [],
    Assoluto: [],
    Bianco: [],
    Rosa: [],
    Infinito: [],
    Leggenda: [],
  };
  let added = 0;
  for (let ci = 0; ci < HEPTAGON_CATEGORIES.length; ci++) {
    const cat = HEPTAGON_CATEGORIES[ci];
    const snapRows = (snapPayload.byCategory && snapPayload.byCategory[cat]) || [];
    const liveRows = livePayload.byCategory[cat] || [];
    const idSet = new Set();
    const merged = [];
    for (let si = 0; si < snapRows.length; si++) {
      const r = snapRows[si];
      if (!r || r.userId == null) continue;
      const uid = String(r.userId);
      if (idSet.has(uid)) continue;
      idSet.add(uid);
      merged.push(Object.assign({}, r));
    }
    for (let li = 0; li < liveRows.length; li++) {
      const lr = liveRows[li];
      if (!lr || lr.userId == null) continue;
      const uid2 = String(lr.userId);
      if (idSet.has(uid2)) continue;
      idSet.add(uid2);
      merged.push(Object.assign({}, lr));
      added += 1;
    }
    merged.sort((a, b) => {
      const sa = a.gcScore != null && isFinite(Number(a.gcScore)) ? Number(a.gcScore) : 0;
      const sb = b.gcScore != null && isFinite(Number(b.gcScore)) ? Number(b.gcScore) : 0;
      if (sb !== sa) return sb - sa;
      return String(a.userId).localeCompare(String(b.userId));
    });
    for (let ri = 0; ri < merged.length; ri++) {
      merged[ri].rank = ri + 1;
    }
    byCategory[cat] = merged;
  }
  return {
    byCategory,
    entries: (byCategory.Supremo || []).slice(),
    snapshotRangeStart: snapPayload.snapshotRangeStart || livePayload.startStr || "",
    snapshotRangeEnd: snapPayload.snapshotRangeEnd || livePayload.endStr || "",
    snapshotAsOfSeoul: snapPayload.snapshotAsOfSeoul || "",
    gcMergedLiveCount: added,
    gcMergedLive: added > 0,
    peakSource: livePayload.peakSource || null,
  };
}

module.exports = {
  runRebuildHeptagonCohortRanks,
  buildLiveGcRankingPayload,
  mergeGcRankingSnapshotWithLive,
  getMonthKeyKstNow,
  HEPTAGON_COHORT_COL,
  HEPTAGON_GENDERS,
  HEPTAGON_CATEGORIES,
  HEPTAGON_DURATIONS,
};
