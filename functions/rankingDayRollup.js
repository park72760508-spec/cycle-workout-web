/**
 * 일별 라이딩 집계(랭킹용): users/{userId}/ranking_day_totals/{YYYY-MM-DD}
 * — 스케줄 전체 로그 스캔 비용 축소(롤링 구간에는 최대 일수만 버킷 조회).
 * 로그 변경 시 해당 일자 버킸만 해당 사용자 로그 일괄로 재합산하여 일관성 유지.
 */

const admin = require("firebase-admin");

const EXCLUDED_ACTIVITY_TYPES = new Set(["run", "swim", "walk", "trailrun", "weighttraining"]);

exports.RANKING_DAY_TOTALS_COLL = "ranking_day_totals";
/** 사용자별 4주(28일) 항속 사전 집계 — rollup 읽기 후 보드 조립 */
exports.RANKING_ROLLUPS_COLL = "ranking_rollups";
exports.PERSONAL_SPEED_28D_ROLLUP_ID = "personal_speed_28d";
/** @deprecated v12 이전 — prepare 시 삭제 */
exports.PERSONAL_SPEED_6M_ROLLUP_ID = "personal_speed_6m";
exports.PERSONAL_SPEED_ROLLUP_DOC_ID = exports.PERSONAL_SPEED_28D_ROLLUP_ID;
exports.PERSONAL_SPEED_PERIOD_ROLLING = "rolling28";
/** 28일 피크·GC·헵타곤 — 일 버킷만 증분 갱신(전체 로그 스캔 없음) */
exports.PEAK_28D_ROLLUP_ID = "peak_28d";
/** 4주(28일) 중 주별 최고 1건씩 → 4주 중 최대 1건으로 환산 (GC·헵타곤) */
exports.PEAK_28D_LOGIC_VERSION = 3;
exports.PEAK_METHOD_FOUR_WEEK_ONE_PEAK = "four_week_one_peak";
/**
 * 랭킹 항속 산출식 버전 — 변경 시 rollup·ranking_aggregates·cache 전면 재계산.
 * v12: 4주(28일) 롤링 창·rollup doc personal_speed_28d·일 버킷 우선(183일 제거).
 * v11: 대시보드 로그 루트·max_60min_watts.
 */
exports.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION = 12;
/** 사전집계 payload.peakDataSource — 구 rollup/캐시와 구분 */
exports.PERSONAL_SPEED_PEAK_DATA_SOURCE = "dashboard_logs_route_v11";
/** useDashboardData·getUserTrainingLogs 와 동일 상한 */
const DASHBOARD_TRAINING_LOG_FETCH_LIMIT = 400;
/** rollup.peakSource — 로그 max_60min_watts(60분 MMP)만, FTP·50분 avg 폴백 없음 */
exports.PERSONAL_SPEED_PEAK_SOURCE_MAX60 = "max_60min_watts";
/** @deprecated v7 이하 호환 */
exports.PERSONAL_SPEED_PEAK_SOURCE_EFFECTIVE = exports.PERSONAL_SPEED_PEAK_SOURCE_MAX60;
const ROLLUP_REBUILD_BATCH = 40;
const BUCKET_GET_CHUNK = 100;

const DURATION_FIELDS = {
  "1min": "max_1min_watts",
  "5min": "max_5min_watts",
  "10min": "max_10min_watts",
  "20min": "max_20min_watts",
  "40min": "max_40min_watts",
  "60min": "max_60min_watts",
  max: "max_watts",
};

const DURATION_HR_FIELDS = {
  "1min": "max_hr_1min",
  "5min": "max_hr_5min",
  "10min": "max_hr_10min",
  "20min": "max_hr_20min",
  "40min": "max_hr_40min",
  "60min": "max_hr_60min",
};

const PEAK_POWER_LIMITS = {
  max: { wkg: 25.0, watts: 2200 },
  "1min": { wkg: 12.0, watts: 900 },
  "5min": { wkg: 8.0, watts: 700 },
  "10min": { wkg: 7.0, watts: 600 },
  "20min": { wkg: 6.5, watts: 550 },
  "40min": { wkg: 6.0, watts: 500 },
  "60min": { wkg: 5.8, watts: 450 },
};

const TSS_PER_DAY_CHEAT_THRESHOLD = 500;
const HR_MAX_BPM = 220;

function isCyclingForMmp(logData) {
  const source = String(logData.source || "").toLowerCase();
  if (source !== "strava") return true;
  const type = String(logData.activity_type || "").trim().toLowerCase();
  if (!type) return true;
  return !EXCLUDED_ACTIVITY_TYPES.has(type);
}

/**
 * useRiderAnalysis.dedupeTrainingLogsByDateStravaFirst 와 동일 — 동일 일자 Strava 우선.
 */
function dedupeTrainingLogsByDateStravaFirstServer(logs) {
  if (!logs || !logs.length) return [];
  const byDate = new Map();
  logs.forEach((log) => {
    const ds = normalizeLogDateToSeoulYmd(log && log.date);
    if (!ds) return;
    if (!byDate.has(ds)) byDate.set(ds, []);
    byDate.get(ds).push(log);
  });
  const out = [];
  byDate.forEach((arr) => {
    const strava = arr.filter((l) => String(l.source || "").toLowerCase() === "strava");
    const chosen =
      strava.length > 0
        ? strava
        : arr.filter((l) => String(l.source || "").toLowerCase() !== "strava");
    chosen.forEach((l) => out.push(l));
  });
  return out;
}

function maxPlausible60minFromSiblingPeaksServer(logData) {
  const d = logData || {};
  const m40 = Number(d.max_40min_watts) || 0;
  const m20 = Number(d.max_20min_watts) || 0;
  const m10 = Number(d.max_10min_watts) || 0;
  let cap = 0;
  if (m40 > 0) cap = m40;
  else if (m20 > 0) cap = m20 * 1.06;
  else if (m10 > 0) cap = m10 * 1.12;
  return cap > 0 ? Math.round(cap * 1.12 * 10) / 10 : 0;
}

/**
 * 랭킹·대시보드(로그 경로) 공통: max_60min_watts(60분 MMP)만. avg/NP/FTP 폴백 없음.
 */
function peak60minWattsFromLogValidated(logData, weightKg) {
  const d = logData || {};
  const wFall = Number(weightKg) > 0 ? Math.max(Number(weightKg), 45) : 70;
  let w60 = Number(d.max_60min_watts) || 0;
  if (!(w60 > 0)) return 0;
  if (!validatePeakPowerRecord("60min", w60, wFall)) return 0;
  const sibCap = maxPlausible60minFromSiblingPeaksServer(d);
  if (sibCap > 0 && w60 > sibCap) return 0;
  return w60;
}

/** @deprecated peak60minWattsFromLogValidated 와 동일 */
function effective60minWattsFromLogDashboard(logData, weightKg) {
  return peak60minWattsFromLogValidated(logData, weightKg);
}

/** @deprecated peak60minWattsFromLogValidated 와 동일 */
function effective60minWattsFromLogRankingStrict(logData, weightKg) {
  return peak60minWattsFromLogValidated(logData, weightKg || 70);
}

/**
 * 대시보드 useDashboardData / getUserTrainingLogs 와 동일: 최근 로그 N건 조회 후 서울 YMD로 6개월 필터.
 */
async function fetchUserTrainingLogsDashboardRoute(db, userId) {
  if (!db || !userId) return [];
  const snap = await db
    .collection("users")
    .doc(userId)
    .collection("logs")
    .orderBy("date", "desc")
    .limit(DASHBOARD_TRAINING_LOG_FETCH_LIMIT)
    .get();
  const out = [];
  snap.docs.forEach((doc) => {
    const d = doc.data() || {};
    if (!isCyclingForMmp(d)) return;
    out.push(d);
  });
  return out;
}

/**
 * stelvioComputeOneHourAbilityFromLogs(rankingStrict) 와 동일 데이터 루트 — max_60min_watts 최대만.
 */
async function peak60RankingStrictFromLogs(db, userId, startStr, endStr, weightKg) {
  let peak60 = 0;
  let peakYmd = "";
  if (!db || !userId || !startStr || !endStr) return { peak60, peakYmd };
  const wFall = Number(weightKg) > 0 ? Math.max(Number(weightKg), 45) : 70;
  const logs = await fetchUserTrainingLogsDashboardRoute(db, userId);
  const inRange = logs.filter((d) => {
    const ymd = normalizeLogDateToSeoulYmd(d.date);
    return ymd && ymd >= startStr && ymd <= endStr;
  });
  const deduped = dedupeTrainingLogsByDateStravaFirstServer(inRange);
  deduped.forEach((d) => {
    const ymd = normalizeLogDateToSeoulYmd(d.date);
    if (!ymd) return;
    const w60 = peak60minWattsFromLogValidated(d, wFall);
    if (w60 > peak60) {
      peak60 = w60;
      peakYmd = ymd;
    }
  });
  return { peak60, peakYmd };
}

/**
 * 랭킹·rollup 공용: 대시보드 1시간 항속과 동일 루트로 60분 피크 → km/h (피크 없으면 null).
 */
async function computePersonalSpeedMetricsFromLogsDashboardRoute(db, userId, userData, startStr, endStr) {
  if (!db || !userId || !userData || !startStr || !endStr) return null;
  if (!userHasWeightForPersonalSpeed(userData)) return null;
  const rawW =
    Number(
      userData.weight != null
        ? userData.weight
        : userData.weightKg != null
          ? userData.weightKg
          : userData.weight_kg
    ) || 0;
  const { peak60, peakYmd } = await peak60DashboardStyleFromLogs(db, userId, startStr, endStr, rawW);
  if (!(peak60 > 0)) return null;
  return buildPersonalSpeedMetricsFromUserAndPeak60(userData, peak60, peakYmd);
}

/** 최근 6개월 로그 max_60min_watts(60분 MMP) 최대 — 50분 avg·FTP 폴백 없음 */
async function peak60DashboardStyleFromLogs(db, userId, startStr, endStr, weightKg) {
  return peak60RankingStrictFromLogs(db, userId, startStr, endStr, weightKg);
}

function validatePeakPowerRecord(durationType, watts, weightKg) {
  const limit = PEAK_POWER_LIMITS[durationType];
  if (!limit || !weightKg || weightKg <= 0) return true;
  const wkg = watts / weightKg;
  if (wkg > limit.wkg) return false;
  if (watts > limit.watts) return false;
  return true;
}

function normalizeLogDateToSeoulYmd(logDate) {
  if (!logDate) return "";
  try {
    if (typeof logDate === "string") {
      const s = String(logDate).trim();
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) return s.slice(0, 10);
      return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
    }
    let d = null;
    if (typeof logDate.toDate === "function") d = logDate.toDate();
    else if (logDate instanceof admin.firestore.Timestamp) d = logDate.toDate();
    else if (logDate instanceof Date) d = logDate;
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  } catch (_e) {
    return "";
  }
}

function extractLogDistanceKm(logData) {
  const km = Number(logData && logData.distance_km);
  if (Number.isFinite(km) && km > 0) return km;
  const raw = Number(logData && logData.distance);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw >= 300) return Math.round((raw / 1000) * 100) / 100;
  return raw;
}

function listInclusiveYmdsSeoul(startStr, endStr) {
  const dates = [];
  const start = new Date(`${startStr}T12:00:00+09:00`);
  const end = new Date(`${endStr}T12:00:00+09:00`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    dates.push(new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }));
  }
  return dates;
}

function bucketRef(db, userId, ymd) {
  const coll = exports.RANKING_DAY_TOTALS_COLL;
  return db.collection("users").doc(userId).collection(coll).doc(ymd);
}

/**
 * 해당 일(day) 사용자 로그만 읽어 일 버킹 문서 재작성(삭제/수정 포함 정확 재현).
 */
async function reconcileUserRankingDayBucket(db, userId, ymd, userData) {
  if (!db || !userId || !ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;

  const logSnap = await db
    .collection("users")
    .doc(userId)
    .collection("logs")
    .where("date", ">=", ymd)
    .where("date", "<=", ymd)
    .get();

  let stravaTssSum = 0;
  let stelvioTssSum = 0;
  let stravaKmSum = 0;
  let stelvioKmSum = 0;

  const rawWeight = Number(userData && (userData.weight || userData.weightKg)) || 0;
  const weightKgFall = rawWeight > 0 ? Math.max(rawWeight, 45) : 0;

  const maxWattsByDur = {};
  for (const dt of Object.keys(DURATION_FIELDS)) maxWattsByDur[dt] = 0;

  const maxHrByDur = {};
  for (const dt of Object.keys(DURATION_HR_FIELDS)) maxHrByDur[dt] = 0;

  const dayLogs = [];
  logSnap.docs.forEach((doc) => {
    const d = doc.data() || {};
    if (!isCyclingForMmp(d)) return;
    const dateStr = normalizeLogDateToSeoulYmd(d.date);
    if (!dateStr || dateStr !== ymd) return;
    dayLogs.push(d);
  });

  const logsForDay = dedupeTrainingLogsByDateStravaFirstServer(dayLogs);
  logsForDay.forEach((d) => {
    const tss = Number(d.tss) || 0;
    const isStrava = String(d.source || "").toLowerCase() === "strava";
    const kmPart = extractLogDistanceKm(d);
    if (isStrava) {
      stravaTssSum += tss;
      stravaKmSum += kmPart;
    } else {
      stelvioTssSum += tss;
      stelvioKmSum += kmPart;
    }

    const w60Rank = peak60minWattsFromLogValidated(d, weightKgFall > 0 ? weightKgFall : 70);
    if (w60Rank > maxWattsByDur["60min"]) maxWattsByDur["60min"] = w60Rank;

    if (weightKgFall > 0) {
      for (const [durationType, field] of Object.entries(DURATION_FIELDS)) {
        if (durationType === "60min") continue;
        const watts = Number(d[field]) || 0;
        if (watts <= 0) continue;
        /** computeUserPeaksAllDurationsFromSnapshot 과 동일: 프로필 체중(≥45)만으로 검증 */
        if (!validatePeakPowerRecord(durationType, watts, weightKgFall)) continue;
        if (watts > maxWattsByDur[durationType]) maxWattsByDur[durationType] = watts;
      }
    }

    for (const [durationType, field] of Object.entries(DURATION_HR_FIELDS)) {
      const hr = Number(d[field]) || 0;
      if (hr < 40 || hr > HR_MAX_BPM) continue;
      if (hr > maxHrByDur[durationType]) maxHrByDur[durationType] = hr;
    }
  });

  /** 일 합계는 원본(치팅 필터 미적용) 저장 — 주간 합계는 effectiveDay에서 500 규칙 적용 */
  const payload = {
    ymd,
    tss_strava_sum: Math.round(stravaTssSum * 100) / 100,
    tss_stelvio_sum: Math.round(stelvioTssSum * 100) / 100,
    km_strava_sum: Math.round(stravaKmSum * 100) / 100,
    km_stelvio_sum: Math.round(stelvioKmSum * 100) / 100,
    weight_used_kg: weightKgFall > 0 ? weightKgFall : null,
    reconciled_at: admin.firestore.FieldValue.serverTimestamp(),
  };

  for (const [dt] of Object.entries(DURATION_FIELDS)) {
    const w = maxWattsByDur[dt] || 0;
    payload[DURATION_FIELDS[dt]] = w > 0 ? w : 0;
  }
  for (const [dt, fld] of Object.entries(DURATION_HR_FIELDS)) {
    const h = maxHrByDur[dt] || 0;
    payload[fld] = h > 0 ? h : 0;
  }

  const ref = bucketRef(db, userId, ymd);
  if (
    payload.tss_strava_sum <= 0
    && payload.tss_stelvio_sum <= 0
    && payload.km_strava_sum <= 0
    && payload.km_stelvio_sum <= 0
    && Object.keys(DURATION_FIELDS).every((dt) => (payload[DURATION_FIELDS[dt]] || 0) <= 0)
  ) {
    await ref.delete().catch(() => {});
    try {
      await touchPersonalSpeed6mRollupAfterDayChange(db, userId, userData, ymd, null);
    } catch (eTouch) {
      console.warn("[rankingDayRollup] personal_speed touch(삭제) 실패:", userId, ymd, eTouch.message);
    }
    return;
  }

  await ref.set(payload, { merge: false });
  try {
    await touchPersonalSpeed6mRollupAfterDayChange(db, userId, userData, ymd, payload);
  } catch (eTouch2) {
    console.warn("[rankingDayRollup] personal_speed touch 실패:", userId, ymd, eTouch2.message);
  }
  try {
    await touchPeak28dRollupAfterDayChange(db, userId, userData, ymd, payload);
  } catch (ePeak28) {
    console.warn("[rankingDayRollup] peak_28d touch 실패:", userId, ymd, ePeak28.message);
  }
}

/**
 * users/{uid}/logs 쓰기 시: 변경 전·후 로그 일자별 버킷 재합산.
 * @param {FirebaseFirestore.Change<FirebaseFirestore.DocumentSnapshot>} change
 */
async function reconcileRankingDayTotalsOnLogWrite(db, userId, userData, change) {
  const ymds = new Set();
  try {
    if (change.before && change.before.exists) {
      const b = normalizeLogDateToSeoulYmd(change.before.data().date);
      if (b) ymds.add(b);
    }
    if (change.after && change.after.exists) {
      const a = normalizeLogDateToSeoulYmd(change.after.data().date);
      if (a) ymds.add(a);
    }
  } catch (_e) {
    return;
  }
  const arr = [...ymds].filter(Boolean);
  for (const ymd of arr) {
    try {
      await reconcileUserRankingDayBucket(db, userId, ymd, userData || {});
    } catch (e) {
      console.warn("[rankingDayRollup] reconcile 실패:", userId, ymd, e.message);
    }
  }
}

async function chunkedGetAll(db, refs, chunkSize) {
  const out = [];
  if (!refs || refs.length === 0) return out;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const slice = refs.slice(i, i + chunkSize);
    /* eslint-disable no-await-in-loop */
    const part = await db.getAll(...slice);
    /* eslint-enable no-await-in-loop */
    out.push(...part);
  }
  return out;
}

/**
 * 기간 내 일 버킷 채우기.
 * @param {boolean} [forceReconcile=false] true이면 이미 존재하는 버킷도 강제 재계산 (로그 수동 수정 후 즉시 반영 시 사용).
 */
async function ensureRankingBucketsFilledForRange(db, userId, userData, startStr, endStr, forceReconcile) {
  const dates = listInclusiveYmdsSeoul(startStr, endStr);
  if (dates.length === 0) return;
  if (forceReconcile) {
    // 기존 버킷 존재 여부와 무관하게 전체 재계산
    for (const ymd of dates) {
      /* eslint-disable no-await-in-loop */
      await reconcileUserRankingDayBucket(db, userId, ymd, userData || {});
      /* eslint-enable no-await-in-loop */
    }
    return;
  }
  // 기본 동작: 버킷이 없는 날만 채우기
  const refs = dates.map((ymd) => bucketRef(db, userId, ymd));
  const snaps = await chunkedGetAll(db, refs, 30);
  for (let i = 0; i < dates.length; i++) {
    if (!snaps[i] || snaps[i].exists) continue;
    /* eslint-disable no-await-in-loop */
    await reconcileUserRankingDayBucket(db, userId, dates[i], userData || {});
    /* eslint-enable no-await-in-loop */
  }
}

function effectiveDayTssFromSnap(snap) {
  if (!snap || !snap.exists) return 0;
  const b = snap.data() || {};
  const ds = Number(b.tss_strava_sum) || 0;
  const dk = Number(b.tss_stelvio_sum) || 0;
  const dayTss = ds > 0 ? ds : dk;
  if (dayTss >= TSS_PER_DAY_CHEAT_THRESHOLD) return 0;
  return dayTss;
}

function effectiveDayKmFromSnap(snap) {
  if (!snap || !snap.exists) return 0;
  const b = snap.data() || {};
  const ks = Number(b.km_strava_sum) || 0;
  const kk = Number(b.km_stelvio_sum) || 0;
  return ks > 0 ? ks : kk;
}

async function weeklyTssSumFromDayBuckets(db, userId, userData, startStr, endStr, forceReconcile) {
  await ensureRankingBucketsFilledForRange(db, userId, userData, startStr, endStr, forceReconcile);
  const dates = listInclusiveYmdsSeoul(startStr, endStr);
  const refs = dates.map((ymd) => bucketRef(db, userId, ymd));
  const snaps = await chunkedGetAll(db, refs, 30);
  let total = 0;
  snaps.forEach((snap) => {
    total += effectiveDayTssFromSnap(snap);
  });
  return total;
}

async function rollingKmSumFromDayBuckets(db, userId, userData, startStr, endStr) {
  await ensureRankingBucketsFilledForRange(db, userId, userData, startStr, endStr);
  const dates = listInclusiveYmdsSeoul(startStr, endStr);
  const refs = dates.map((ymd) => bucketRef(db, userId, ymd));
  const snaps = await chunkedGetAll(db, refs, 30);
  let total = 0;
  snaps.forEach((snap) => {
    total += effectiveDayKmFromSnap(snap);
  });
  return Math.round(total * 100) / 100;
}

async function cheatDayPresentFromBuckets(db, userId, userData, startStr, endStr) {
  await ensureRankingBucketsFilledForRange(db, userId, userData, startStr, endStr);
  const dates = listInclusiveYmdsSeoul(startStr, endStr);
  const refs = dates.map((ymd) => bucketRef(db, userId, ymd));
  const snaps = await chunkedGetAll(db, refs, 30);
  return snaps.some((snap) => {
    if (!snap || !snap.exists) return false;
    const b = snap.data() || {};
    const ds = Number(b.tss_strava_sum) || 0;
    const dk = Number(b.tss_stelvio_sum) || 0;
    const dayTss = ds > 0 ? ds : dk;
    return dayTss >= TSS_PER_DAY_CHEAT_THRESHOLD;
  });
}

/**
 * 롤링 28일 창인지 확인 후 7일 × 4주 구간 [start,end] 목록 생성 (실패 시 null)
 */
function splitInclusiveRangeIntoFourWeeks(startStr, endStr) {
  const dates = listInclusiveYmdsSeoul(startStr, endStr);
  if (!dates.length || dates.length !== 28) return null;
  const ranges = [];
  for (let w = 0; w < 4; w++) {
    ranges.push({
      startStr: dates[w * 7],
      endStr: dates[w * 7 + 6],
    });
  }
  return ranges;
}

/**
 * @deprecated 상위 3주 평균·페널티 폐기. 호환 export: 주별 W/kg 배열 중 최대 1개만 반환.
 * @param {number[]} weeklyMaxWkgArr
 * @returns {{ finalWkg: number, penaltyMultiplier: number }}
 */
function calculateGcRankingFromWeeklyMaxWkg(weeklyMaxWkgArr) {
  const active = (weeklyMaxWkgArr || []).map((v) => Number(v)).filter((v) => v > 0);
  if (!active.length) return { finalWkg: 0, penaltyMultiplier: 1 };
  const finalWkg = Math.round(Math.max(...active) * 100) / 100;
  return { finalWkg, penaltyMultiplier: 1 };
}

function weekIndexForSeoulYmd(ymd, weekRanges) {
  if (!ymd || !weekRanges || weekRanges.length !== 4) return -1;
  for (let i = 0; i < 4; i++) {
    if (ymd >= weekRanges[i].startStr && ymd <= weekRanges[i].endStr) return i;
  }
  return -1;
}

function getRolling28DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -27);
  return { startStr, endStr };
}

/**
 * GC·헵타곤: 28일을 4주로 나누고, 주별 최고 W/kg 중 **최대 1주**만 환산점수에 사용.
 * (28일 전체 일별 max와 수학적으로 동일한 단일 피크이나, 주별 breakdown을 rollup에 저장)
 */
function computeUserPeaksFourWeekOnePeakFromBucketSnaps(userData, bucketSnaps, startStr, endStr) {
  const rawWeight = Number(userData.weight || userData.weightKg || 0);
  if (rawWeight <= 0) return null;
  const weightKg = Math.max(rawWeight, 45);
  const weekRanges = splitInclusiveRangeIntoFourWeeks(startStr, endStr);
  if (!weekRanges) {
    return computeUserPeaksAllDurationsFromBucketSnaps(userData, bucketSnaps, startStr, endStr);
  }

  const peaks = {};
  for (const dt of Object.keys(DURATION_FIELDS)) {
    const field = DURATION_FIELDS[dt];
    const weeklyWkgArr = [];
    let bestWatts = 0;
    let bestWeekIndex = -1;

    for (let w = 0; w < weekRanges.length; w++) {
      const wr = weekRanges[w];
      let weekMax = 0;
      (bucketSnaps || []).forEach((snap) => {
        if (!snap || !snap.exists) return;
        const row = snap.data() || {};
        const ymd = row.ymd || snap.id || "";
        if (!ymd || ymd < wr.startStr || ymd > wr.endStr) return;
        const watts = Number(row[field]) || 0;
        if (watts <= 0) return;
        if (!validatePeakPowerRecord(dt, watts, weightKg)) return;
        if (watts > weekMax) weekMax = watts;
      });
      if (weekMax > 0) {
        weeklyWkgArr.push(Math.round((weekMax / weightKg) * 100) / 100);
        if (weekMax > bestWatts) {
          bestWatts = weekMax;
          bestWeekIndex = w;
        }
      }
    }

    if (bestWatts <= 0) continue;
    const gc = calculateGcRankingFromWeeklyMaxWkg(weeklyWkgArr);
    const finalWkg = gc.finalWkg > 0 ? gc.finalWkg : Math.round((bestWatts / weightKg) * 100) / 100;
    peaks[dt] = {
      watts: bestWatts,
      wkg: finalWkg,
      weightKg,
      bestWeekIndex,
      weeklyWkg: weeklyWkgArr,
      peakMethod: exports.PEAK_METHOD_FOUR_WEEK_ONE_PEAK,
    };
  }

  return Object.keys(peaks).length
    ? { weightKg, peaks, peakMethod: exports.PEAK_METHOD_FOUR_WEEK_ONE_PEAK }
    : null;
}

/**
 * GC·헵타곤·28일 롤링: 4주 중 주별 최고 → 그중 1피크만 환산.
 */
function computeFourWeekGcStylePeaksFromBucketSnaps(userData, bucketSnaps, startStr, endStr) {
  return computeUserPeaksFourWeekOnePeakFromBucketSnaps(userData, bucketSnaps, startStr, endStr);
}

/** 일 버킷 스냅샷(28일 등)으로 duration별 기간 내 최고 피크 1건 — 추가 로그 스캔 없음 */
function computeUserPeaksAllDurationsFromBucketSnaps(userData, bucketSnaps, startStr, endStr) {
  const rawWeight = Number(userData.weight || userData.weightKg || 0);
  if (rawWeight <= 0) return null;
  const weightKg = Math.max(rawWeight, 45);
  const maxW = {};
  for (const dt of Object.keys(DURATION_FIELDS)) maxW[dt] = 0;

  bucketSnaps.forEach((snap) => {
    if (!snap || !snap.exists) return;
    const row = snap.data() || {};
    const ymd = row.ymd || snap.id || "";
    if (!ymd || ymd < startStr || ymd > endStr) return;
    for (const dt of Object.keys(DURATION_FIELDS)) {
      const field = DURATION_FIELDS[dt];
      const w = Number(row[field]) || 0;
      if (w <= 0) continue;
      if (!validatePeakPowerRecord(dt, w, weightKg)) continue;
      if (w > maxW[dt]) maxW[dt] = w;
    }
  });

  const peaks = {};
  for (const dt of Object.keys(DURATION_FIELDS)) {
    const mw = maxW[dt];
    if (mw > 0) {
      const wkg = Math.round((mw / weightKg) * 100) / 100;
      peaks[dt] = { watts: mw, wkg, weightKg };
    }
  }
  return Object.keys(peaks).length ? { weightKg, peaks } : null;
}

/** 기간 내 일 버킷 max_60min_watts 최대값 (로그 재스캔 없음) */
function max60minWattsFromBucketSnaps(bucketSnaps, startStr, endStr) {
  let peak60 = 0;
  (bucketSnaps || []).forEach((snap) => {
    if (!snap || !snap.exists) return;
    const row = snap.data() || {};
    const ymd = row.ymd || snap.id || "";
    if (!ymd || ymd < startStr || ymd > endStr) return;
    const w = Number(row.max_60min_watts) || 0;
    if (w > peak60) peak60 = w;
  });
  return peak60;
}

/**
 * ranking_day_totals만 읽어 60분 피크(W) 반환.
 * @param {{ ensureMissingDays?: boolean }} [opts] ensureMissingDays=false면 HTTP 빠른 경로(미존재 일은 스킵)
 */
async function max60minWattsFromDayBuckets(db, userId, userData, startStr, endStr, opts) {
  const { peak60 } = await peak60YmdFromDayBuckets(db, userId, userData, startStr, endStr, opts);
  return peak60;
}

/**
 * ranking_day_totals만 읽어 60분 피크(W)·일자 반환 (로그 400건 스캔 없음).
 * @param {{ ensureMissingDays?: boolean }} [opts] false면 미존재 일 버킷 채우기 생략(트리거·HTTP 핫 경로)
 */
async function peak60YmdFromDayBuckets(db, userId, userData, startStr, endStr, opts) {
  const ensureMissing = opts && opts.ensureMissingDays === true;
  if (ensureMissing) {
    await ensureRankingBucketsFilledForRange(db, userId, userData || {}, startStr, endStr);
  }
  const dates = listInclusiveYmdsSeoul(startStr, endStr);
  if (!dates.length) return { peak60: 0, peakYmd: "" };
  const refs = dates.map((ymd) => bucketRef(db, userId, ymd));
  const bucketSnaps = await chunkedGetAll(db, refs, BUCKET_GET_CHUNK);
  let peak60 = 0;
  let peakYmd = "";
  for (let i = 0; i < bucketSnaps.length; i++) {
    const snap = bucketSnaps[i];
    if (!snap || !snap.exists) continue;
    const row = snap.data() || {};
    const ymd = row.ymd || dates[i] || "";
    if (!ymd || ymd < startStr || ymd > endStr) continue;
    const w = Number(row.max_60min_watts) || 0;
    if (w > peak60) {
      peak60 = w;
      peakYmd = ymd;
    }
  }
  return { peak60, peakYmd };
}

function addDaysSeoulYmd(ymdStr, deltaDays) {
  const t = new Date(`${ymdStr}T12:00:00+09:00`).getTime() + deltaDays * 86400000;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function getRolling183DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -182);
  return { startStr, endStr };
}

/** 대시보드·랭킹 공통 평지 항속(km/h) */
function calculateSpeedOnFlat(power, weight) {
  const P = Number(power);
  const m = Number(weight);
  if (!Number.isFinite(P) || P <= 0 || !Number.isFinite(m) || m <= 0) return 0;
  const rho = 1.225;
  const g = 9.81;
  const Crr = 0.0045;
  let CdA = 0.328 + (m - 70) * 0.0012;
  if (CdA < 0.22) CdA = 0.22;
  if (CdA > 0.42) CdA = 0.42;
  const powerAtV = (vMs) => 0.5 * rho * CdA * vMs * vMs * vMs + Crr * m * g * vMs;
  let lo = 0.1;
  let hi = 40;
  for (let i = 0; i < 55; i++) {
    const mid = (lo + hi) / 2;
    if (powerAtV(mid) < P) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 3.6;
}

function personalSpeedRollupRef(db, userId) {
  return db
    .collection("users")
    .doc(userId)
    .collection(exports.RANKING_ROLLUPS_COLL)
    .doc(exports.PERSONAL_SPEED_ROLLUP_DOC_ID);
}

function personalSpeedLegacy6mRollupRef(db, userId) {
  return db
    .collection("users")
    .doc(userId)
    .collection(exports.RANKING_ROLLUPS_COLL)
    .doc(exports.PERSONAL_SPEED_6M_ROLLUP_ID);
}

/** @deprecated */ function personalSpeed6mRollupRef(db, userId) {
  return personalSpeedRollupRef(db, userId);
}

function ftp93ReferenceWattsFromUser(userData) {
  const ftp =
    Number(
      userData &&
        (userData.ftp != null
          ? userData.ftp
          : userData.ftp_watts != null
            ? userData.ftp_watts
            : userData.FTP)
    ) || 0;
  if (!(ftp > 0)) return 0;
  return Math.round(ftp * 0.93 * 10) / 10;
}

/** 구버전·FTP×0.93 폴백으로 채워진 rollup 여부 (재집계 대상) */
function personalSpeedRollupIsFtpDerived(rollup, userData) {
  if (!rollup) return false;
  const src = rollup.peakSource != null ? String(rollup.peakSource) : "";
  if (src && src !== exports.PERSONAL_SPEED_PEAK_SOURCE_MAX60) return true;
  const peak = Number(rollup.peak60minWatts) || 0;
  const ref = Number(rollup.referenceWatts) || 0;
  if (peak > 0 && ref > 0 && Math.abs(ref - peak) > 0.65) return true;
  const ftp93 = ftp93ReferenceWattsFromUser(userData);
  if (!(ftp93 > 0)) return false;
  const tol = 0.65;
  if (peak > 0 && Math.abs(peak - ftp93) <= tol) return true;
  if (ref > 0 && Math.abs(ref - ftp93) <= tol && !(peak > 0 && Math.abs(peak - ftp93) > tol)) return true;
  return false;
}

/** 저장된 speedKmh 가 peak60·현재 체중으로 재계산한 값과 일치하는지 */
function personalSpeedRollupSpeedSynced(rollup, userData) {
  if (!rollup || !(Number(rollup.peak60minWatts) > 0)) return false;
  const m = buildPersonalSpeedMetricsFromUserAndPeak60(
    userData,
    Number(rollup.peak60minWatts) || 0,
    String(rollup.peak60Ymd || "")
  );
  if (!m || !(m.speedKmh > 0)) return false;
  return Math.abs(Number(rollup.speedKmh) - m.speedKmh) <= 0.15;
}

function personalSpeedRollupNeedsInvalidate(rollup, startStr, endStr, userData) {
  if (!rollup) return false;
  if (rollup.windowStart !== startStr || rollup.windowEnd !== endStr) return false;
  if (Number(rollup.rollupLogicVersion) < exports.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION) return true;
  if (rollup.peakSource !== exports.PERSONAL_SPEED_PEAK_SOURCE_MAX60) return true;
  if (personalSpeedRollupIsFtpDerived(rollup, userData)) return true;
  if (!personalSpeedRollupSpeedSynced(rollup, userData)) return true;
  return false;
}

/**
 * @returns {{ peak60minWatts:number, referenceWatts:number, speedKmh:number, weightKg:number, peak60Ymd:string }|null}
 */
function buildPersonalSpeedMetricsFromUserAndPeak60(userData, peak60, peak60Ymd) {
  const peak = Number(peak60) || 0;
  if (!(peak > 0)) return null;
  const rawWeight =
    Number(
      userData &&
        (userData.weight != null
          ? userData.weight
          : userData.weightKg != null
            ? userData.weightKg
            : userData.weight_kg)
    ) || 0;
  const weightKg = rawWeight > 0 ? rawWeight : 0;
  let referenceWatts = peak;
  if (!(weightKg > 0)) return null;
  referenceWatts = Math.round(referenceWatts * 10) / 10;
  const speedKmh = Math.round(calculateSpeedOnFlat(referenceWatts, weightKg) * 10) / 10;
  if (!(speedKmh > 0)) return null;
  return {
    peak60minWatts: Math.round(peak * 10) / 10,
    referenceWatts,
    speedKmh,
    weightKg,
    peak60Ymd: peak60Ymd || "",
  };
}

async function writePersonalSpeed6mRollupDoc(db, userId, userData, startStr, endStr, metrics) {
  const ref = personalSpeedRollupRef(db, userId);
  if (!metrics) {
    await ref.delete().catch(() => {});
    return;
  }
  await ref.set({
    windowStart: startStr,
    windowEnd: endStr,
    peak60minWatts: metrics.peak60minWatts,
    peak60Ymd: metrics.peak60Ymd || "",
    referenceWatts: metrics.referenceWatts,
    speedKmh: metrics.speedKmh,
    weightKg: metrics.weightKg,
    peakSource: exports.PERSONAL_SPEED_PEAK_SOURCE_MAX60,
    rollupLogicVersion: exports.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION,
    reconciled_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * 4주(28일) 창: ranking_day_totals 일 버킷만 읽어 peak60·항속(km/h) 산출 (로그 스캔 없음).
 * ensureMissingDays=true일 때만 누락 일자 버킷을 로그로 채움(수동 백필용).
 */
async function rebuildPersonalSpeed6mRollupFromBuckets(db, userId, userData, startStr, endStr, opts) {
  const fromBucketsOnly = opts && opts.fromBucketsOnly === false ? false : true;
  const ensureMissing = !fromBucketsOnly && !!(opts && opts.ensureMissingDays);
  if (ensureMissing) {
    await ensureRankingBucketsFilledForRange(db, userId, userData || {}, startStr, endStr, false);
  }
  const rawW =
    Number(
      userData &&
        (userData.weight != null
          ? userData.weight
          : userData.weightKg != null
            ? userData.weightKg
            : userData.weight_kg)
    ) || 0;
  const weightKg = rawW > 0 ? Math.max(rawW, 45) : 70;
  const { peak60, peakYmd } = fromBucketsOnly
    ? await peak60YmdFromDayBuckets(db, userId, userData, startStr, endStr, { ensureMissingDays: false })
    : await peak60DashboardStyleFromLogs(db, userId, startStr, endStr, weightKg);
  const metrics = buildPersonalSpeedMetricsFromUserAndPeak60(userData, peak60, peakYmd);
  await writePersonalSpeed6mRollupDoc(db, userId, userData, startStr, endStr, metrics);
  return metrics;
}

/**
 * 로그→일 버킷 반영 직후: 증분 peak 갱신(대부분) / peak 하락 시에만 버킷 재스캔.
 */
async function touchPersonalSpeed6mRollupAfterDayChange(db, userId, userData, ymd, dayPayload) {
  const { startStr, endStr } = getRolling28DaysRangeSeoul();
  if (!ymd || ymd < startStr || ymd > endStr) {
    return;
  }
  const ref = personalSpeedRollupRef(db, userId);
  const existing = (await ref.get()).data() || null;
  const day60 = dayPayload ? Number(dayPayload.max_60min_watts) || 0 : 0;
  const windowOk =
    existing &&
    existing.windowStart === startStr &&
    existing.windowEnd === endStr;
  let peak60 = windowOk ? Number(existing.peak60minWatts) || 0 : 0;
  let peakYmd = windowOk ? String(existing.peak60Ymd || "") : "";
  const bucketOnlyOpts = { ensureMissingDays: false, fromBucketsOnly: true };

  if (!dayPayload) {
    if (peakYmd === ymd || peak60 <= 0) {
      await rebuildPersonalSpeed6mRollupFromBuckets(db, userId, userData, startStr, endStr, bucketOnlyOpts);
    }
    return;
  }

  if (!windowOk) {
    await rebuildPersonalSpeed6mRollupFromBuckets(db, userId, userData, startStr, endStr, bucketOnlyOpts);
    return;
  }

  /** 신규 PR: 일 버킷 값만 반영(로그 400건 스캔 금지 — Strava 대량 동기화 시 과금 폭탄 방지) */
  if (day60 > peak60) {
    const metrics = buildPersonalSpeedMetricsFromUserAndPeak60(userData, day60, ymd);
    await writePersonalSpeed6mRollupDoc(db, userId, userData, startStr, endStr, metrics);
    return;
  }

  if (day60 === peak60 && peakYmd === ymd) {
    const metrics = buildPersonalSpeedMetricsFromUserAndPeak60(userData, peak60, peakYmd);
    await writePersonalSpeed6mRollupDoc(db, userId, userData, startStr, endStr, metrics);
    return;
  }

  /** 피크 일자 로그 수정·삭제로 하락 가능 → 일 버킷만 재집계 */
  if (peakYmd === ymd && day60 < peak60) {
    await rebuildPersonalSpeed6mRollupFromBuckets(db, userId, userData, startStr, endStr, bucketOnlyOpts);
  }
}

function peak28dRollupRef(db, userId) {
  return db
    .collection("users")
    .doc(userId)
    .collection(exports.RANKING_ROLLUPS_COLL)
    .doc(exports.PEAK_28D_ROLLUP_ID);
}

function peak28dRollupNeedsInvalidate(rollup, startStr, endStr) {
  if (!rollup) return true;
  if (rollup.windowStart !== startStr || rollup.windowEnd !== endStr) return true;
  if (Number(rollup.rollupLogicVersion) < exports.PEAK_28D_LOGIC_VERSION) return true;
  if (rollup.peakMethod !== exports.PEAK_METHOD_FOUR_WEEK_ONE_PEAK) return true;
  if (!rollup.userMeta || !rollup.userMeta.ageCategory) return true;
  return false;
}

/**
 * 보드 조립 시 users.get() 없이 collectionGroup 만으로 행 구성.
 * @param {object} userData
 * @param {Function} getLeagueCategory — (challenge, birthYear) => string|null
 */
function snapshotUserMetaForPeakRollup(userData, getLeagueCategory) {
  const data = userData || {};
  const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
  const challenge = data.challenge || "Fitness";
  const ageCategory = typeof getLeagueCategory === "function" ? getLeagueCategory(challenge, birthYear) : null;
  const gender = String(data.gender || data.sex || "").toLowerCase();
  const genderKey =
    gender === "m" || gender === "male" || gender === "남"
      ? "M"
      : gender === "f" || gender === "female" || gender === "여"
        ? "F"
        : null;
  const acc = String(data.account_status || "").trim().toLowerCase();
  return {
    name: (data.name || data.displayName || "(이름 없음)").toString().trim() || "(이름 없음)",
    ageCategory: ageCategory || "",
    genderKey,
    is_private: data.is_private === true,
    profileImageUrl: data.profileImageUrl || data.photoURL || data.profile_image_url || null,
    account_status: data.account_status || "",
    isWithdrawn: acc === "withdrawn" || acc === "inactive" || acc === "deleted",
  };
}

async function writePeak28dRollupDoc(db, userId, userData, startStr, endStr, peakMap, hrMax, getLeagueCategory) {
  const ref = peak28dRollupRef(db, userId);
  if (!peakMap || !peakMap.peaks || !Object.keys(peakMap.peaks).length) {
    await ref.delete().catch(() => {});
    return null;
  }
  const userMeta =
    typeof getLeagueCategory === "function"
      ? snapshotUserMetaForPeakRollup(userData, getLeagueCategory)
      : null;
  const payload = {
    windowStart: startStr,
    windowEnd: endStr,
    weightKg: peakMap.weightKg,
    peaks: peakMap.peaks,
    peakMethod: peakMap.peakMethod || exports.PEAK_METHOD_FOUR_WEEK_ONE_PEAK,
    hrMaxByDuration: hrMax || {},
    userMeta,
    rollupLogicVersion: exports.PEAK_28D_LOGIC_VERSION,
    reconciled_at: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(payload);
  return payload;
}

/**
 * 28일 창: 일 버킷만 읽어 4주 1피크 rollup 갱신 (로그 400건 스캔 없음).
 */
async function rebuildPeak28dRollupFromBuckets(db, userId, userData, startStr, endStr, opts) {
  const ensureMissing = !!(opts && opts.ensureMissingDays);
  if (ensureMissing) {
    await ensureRankingBucketsFilledForRange(db, userId, userData || {}, startStr, endStr, false);
  }
  const dates = listInclusiveYmdsSeoul(startStr, endStr);
  const refs = dates.map((ymd) => bucketRef(db, userId, ymd));
  const bucketSnaps = await chunkedGetAll(db, refs, BUCKET_GET_CHUNK);
  const peakMap = computeFourWeekGcStylePeaksFromBucketSnaps(userData, bucketSnaps, startStr, endStr);
  const hrMax = maxHrByDurationFromBucketSnaps(bucketSnaps, startStr, endStr);
  const getLc = opts && opts.getLeagueCategory;
  await writePeak28dRollupDoc(db, userId, userData, startStr, endStr, peakMap, hrMax, getLc);
  return { peakMap, hrMax };
}

/**
 * 청크 백필 — users 컬렉션을 cursor 로 N명만 rollup 갱신 (전체 1회 스캔 방지).
 * @returns {{ processed: number, nextIndex: number, done: boolean, rebuilt: number }}
 */
async function rebuildPeak28dRollupsChunk(db, userDocs, startIndex, chunkSize, startStr, endStr, getLeagueCategory) {
  const n = userDocs.length;
  const end = Math.min(n, startIndex + chunkSize);
  let rebuilt = 0;
  for (let i = startIndex; i < end; i++) {
    const udoc = userDocs[i];
    /* eslint-disable no-await-in-loop */
    await rebuildPeak28dRollupFromBuckets(db, udoc.id, udoc.data() || {}, startStr, endStr, {
      ensureMissingDays: false,
      getLeagueCategory,
    });
    /* eslint-enable no-await-in-loop */
    rebuilt++;
  }
  return {
    processed: end - startIndex,
    nextIndex: end,
    done: end >= n,
    rebuilt,
    totalUsers: n,
  };
}

/**
 * 로그→일 버킷 직후: 28일 창이면 일 버킷만 재읽어 peak_28d 갱신(로그 전체 스캔 없음, 최대 28 reads).
 */
async function touchPeak28dRollupAfterDayChange(db, userId, userData, ymd, _dayPayload) {
  const { startStr, endStr } = getRolling28DaysRangeSeoul();
  if (!ymd || ymd < startStr || ymd > endStr) return;
  await rebuildPeak28dRollupFromBuckets(db, userId, userData, startStr, endStr, { ensureMissingDays: false });
}

/**
 * 배치: 창·버전 불일치 rollup만 28버킷 재집계 (users×28 reads, logs 스캔 없음).
 */
async function rebuildPeak28dRollupsBatch(db, userDocs, startStr, endStr, opts) {
  if (!userDocs || !userDocs.length) return { rebuilt: 0, skipped: 0 };
  const batchSize = (opts && opts.batchSize) || ROLLUP_REBUILD_BATCH;
  const ensureMissing = !!(opts && opts.ensureMissingDays);
  let rebuilt = 0;
  let skipped = 0;

  for (let i = 0; i < userDocs.length; i += batchSize) {
    const slice = userDocs.slice(i, i + batchSize);
    /* eslint-disable no-await-in-loop */
    const refs = slice.map((d) => peak28dRollupRef(db, d.id));
    const rollSnaps = await chunkedGetAll(db, refs, 40);
    await Promise.all(
      slice.map(async (udoc, j) => {
        const userId = udoc.id;
        const userData = udoc.data() || {};
        const existing = rollSnaps[j] && rollSnaps[j].exists ? rollSnaps[j].data() : null;
        if (!peak28dRollupNeedsInvalidate(existing, startStr, endStr)) {
          skipped++;
          return;
        }
        await rebuildPeak28dRollupFromBuckets(db, userId, userData, startStr, endStr, {
          ensureMissingDays: ensureMissing,
        });
        rebuilt++;
      })
    );
    /* eslint-enable no-await-in-loop */
  }
  return { rebuilt, skipped };
}

/**
 * @returns {Promise<Map<string, { peakMap: object, hrMax: object }>>}
 */
async function fetchPeak28dRollupMap(db, userIds, startStr, endStr) {
  const map = new Map();
  if (!userIds || !userIds.length) return map;
  for (let i = 0; i < userIds.length; i += BUCKET_GET_CHUNK) {
    const slice = userIds.slice(i, i + BUCKET_GET_CHUNK);
    const refs = slice.map((uid) => peak28dRollupRef(db, uid));
    /* eslint-disable no-await-in-loop */
    const snaps = await chunkedGetAll(db, refs, 40);
    /* eslint-enable no-await-in-loop */
    for (let j = 0; j < slice.length; j++) {
      const snap = snaps[j];
      if (!snap || !snap.exists) continue;
      const d = snap.data() || {};
      if (d.windowStart !== startStr || d.windowEnd !== endStr) continue;
      if (!d.peaks || typeof d.peaks !== "object") continue;
      map.set(slice[j], {
        peakMap: { weightKg: d.weightKg, peaks: d.peaks, peakMethod: d.peakMethod },
        hrMax: d.hrMaxByDuration || {},
      });
    }
  }
  return map;
}

/**
 * 배치: 창·버전 불일치만 재계산. 기본 fromBucketsOnly(28일 버킷만, 로그 스캔 없음).
 */
async function rebuildPersonalSpeed6mRollupsBatch(db, userDocs, startStr, endStr, opts) {
  if (!userDocs || !userDocs.length) return { rebuilt: 0, skipped: 0, metricsRefreshed: 0 };
  const batchSize = (opts && opts.batchSize) || ROLLUP_REBUILD_BATCH;
  const fromBucketsOnly = opts && opts.fromBucketsOnly === false ? false : true;
  const bucketOpts = {
    ensureMissingDays: !!(opts && opts.ensureMissingDays),
    fromBucketsOnly,
  };
  const skipUnchanged = !opts || opts.skipUnchanged !== false;
  let rebuilt = 0;
  let skipped = 0;
  let metricsRefreshed = 0;
  let rollupMap = new Map();
  if (skipUnchanged) {
    rollupMap = await fetchPersonalSpeed6mRollupMap(
      db,
      userDocs.map((d) => d.id)
    );
  }
  for (let i = 0; i < userDocs.length; i += batchSize) {
    const batch = userDocs.slice(i, i + batchSize);
    /* eslint-disable no-await-in-loop */
    await Promise.all(
      batch.map(async (udoc) => {
        const userId = udoc.id;
        const userData = udoc.data() || {};
        try {
          if (skipUnchanged) {
            const ex = rollupMap.get(userId);
            const rawW =
              Number(
                userData.weight != null
                  ? userData.weight
                  : userData.weightKg != null
                    ? userData.weightKg
                    : userData.weight_kg
              ) || 0;
            const weightKg = rawW > 0 ? Math.max(rawW, 45) : 70;
            const { peak60: peakFromLogs, peakYmd } = fromBucketsOnly
              ? await peak60YmdFromDayBuckets(db, userId, userData, startStr, endStr, {
                  ensureMissingDays: false,
                })
              : await peak60DashboardStyleFromLogs(db, userId, startStr, endStr, weightKg);
            const metrics = buildPersonalSpeedMetricsFromUserAndPeak60(
              userData,
              peakFromLogs,
              peakYmd
            );
            if (
              ex &&
              ex.windowStart === startStr &&
              ex.windowEnd === endStr &&
              metrics &&
              metrics.speedKmh > 0 &&
              Number(ex.peak60minWatts) === metrics.peak60minWatts &&
              personalSpeedRollupSpeedSynced(ex, userData) &&
              Math.abs(Number(ex.speedKmh) - metrics.speedKmh) <= 0.05
            ) {
              skipped += 1;
              return;
            }
            if (metrics && metrics.speedKmh > 0) {
              await writePersonalSpeed6mRollupDoc(db, userId, userData, startStr, endStr, metrics);
              if (ex) metricsRefreshed += 1;
              else rebuilt += 1;
              return;
            }
            if (ex) {
              await personalSpeedRollupRef(db, userId).delete().catch(() => {});
            }
            return;
          }
          const m = await rebuildPersonalSpeed6mRollupFromBuckets(
            db,
            userId,
            userData,
            startStr,
            endStr,
            bucketOpts
          );
          if (m && m.speedKmh > 0) rebuilt += 1;
        } catch (e) {
          console.warn("[rankingDayRollup] personal_speed rollup 실패:", userId, e.message);
        }
      })
    );
    /* eslint-enable no-await-in-loop */
  }
  return { rebuilt, skipped, metricsRefreshed };
}

function userHasWeightForPersonalSpeed(userData) {
  const w =
    Number(
      userData &&
        (userData.weight != null
          ? userData.weight
          : userData.weightKg != null
            ? userData.weightKg
            : userData.weight_kg)
    ) || 0;
  return w > 0;
}

function personalSpeedRollupIsReady(rollup, startStr, endStr, userData) {
  if (!rollup) return false;
  if (rollup.windowStart !== startStr || rollup.windowEnd !== endStr) return false;
  if (Number(rollup.rollupLogicVersion) < exports.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION) return false;
  if (rollup.peakSource !== exports.PERSONAL_SPEED_PEAK_SOURCE_MAX60) return false;
  if (!(Number(rollup.peak60minWatts) > 0)) return false;
  if (userData && personalSpeedRollupIsFtpDerived(rollup, userData)) return false;
  if (userData && !personalSpeedRollupSpeedSynced(rollup, userData)) return false;
  return true;
}

/**
 * 구버전·FTP 유사 rollup 삭제 — 다음 rebuild에서 60분 파워만 반영.
 */
async function invalidateStalePersonalSpeedRollups(db, userDocs, startStr, endStr) {
  if (!userDocs || !userDocs.length) return { purged: 0 };
  const rollupMap = await fetchPersonalSpeed6mRollupMap(
    db,
    userDocs.map((d) => d.id)
  );
  let purged = 0;
  const DELETE_BATCH = 400;
  const toDelete = [];
  for (let i = 0; i < userDocs.length; i++) {
    const udoc = userDocs[i];
    const rollup = rollupMap.get(udoc.id);
    if (!rollup) continue;
    if (!personalSpeedRollupNeedsInvalidate(rollup, startStr, endStr, udoc.data() || {})) continue;
    toDelete.push(personalSpeedRollupRef(db, udoc.id));
  }
  for (let i = 0; i < toDelete.length; i += DELETE_BATCH) {
    const slice = toDelete.slice(i, i + DELETE_BATCH);
    /* eslint-disable no-await-in-loop */
    const batch = db.batch();
    slice.forEach((ref) => batch.delete(ref));
    await batch.commit();
    /* eslint-enable no-await-in-loop */
    purged += slice.length;
  }
  return { purged };
}

/** 구 personal_speed_6m 문서 삭제(창 183일 → 28일 전환) */
async function purgeLegacyPersonalSpeed6mRollups(db, userDocs) {
  if (!userDocs || !userDocs.length) return { legacyPurged: 0 };
  let legacyPurged = 0;
  const DELETE_BATCH = 400;
  const refs = userDocs.map((d) => personalSpeedLegacy6mRollupRef(db, d.id));
  for (let i = 0; i < refs.length; i += DELETE_BATCH) {
    const slice = refs.slice(i, i + DELETE_BATCH);
    /* eslint-disable no-await-in-loop */
    const snaps = await chunkedGetAll(db, slice, 40);
    const batch = db.batch();
    let n = 0;
    snaps.forEach((snap, j) => {
      if (snap && snap.exists) {
        batch.delete(slice[j]);
        n++;
      }
    });
    if (n > 0) {
      await batch.commit();
      legacyPurged += n;
    }
    /* eslint-enable no-await-in-loop */
  }
  return { legacyPurged };
}

/**
 * 항속 랭킹 집계 전: legacy 6m 삭제 → 무효 rollup 제거 → 28일 버킷 기반 재계산.
 */
async function preparePersonalSpeedRankingRebuild(db, userDocs, startStr, endStr, opts) {
  const legacy = await purgeLegacyPersonalSpeed6mRollups(db, userDocs);
  const inv = await invalidateStalePersonalSpeedRollups(db, userDocs, startStr, endStr);
  const batch = await rebuildPersonalSpeed6mRollupsBatch(db, userDocs, startStr, endStr, {
    skipUnchanged: !(opts && opts.skipUnchanged === false),
    ensureMissingDays: !!(opts && opts.ensureMissingDays),
    fromBucketsOnly: opts && opts.fromBucketsOnly === false ? false : true,
    batchSize: (opts && opts.batchSize) || ROLLUP_REBUILD_BATCH,
  });
  return { legacyPurged: legacy.legacyPurged, purged: inv.purged, ...batch };
}

/**
 * rollup은 있으나 로그 6개월 MMP와 peak60이 어긋난 사용자 — 로그 재스캔 후 rollup 갱신(HTTP 보드용).
 */
async function refreshPersonalSpeedRollupsPeakDriftFromLogs(db, userDocs, startStr, endStr, rollupMap, opts) {
  if (!userDocs || !userDocs.length) return { refreshed: 0, scanned: 0 };
  const maxScan =
    opts && opts.maxScan != null && Number.isFinite(Number(opts.maxScan))
      ? Math.max(0, Math.floor(Number(opts.maxScan)))
      : 0;
  const peakTolW = opts && opts.peakTolW != null ? Number(opts.peakTolW) : 1;
  const batchSize = (opts && opts.batchSize) || 20;
  const speedMismatch = [];
  const peakDriftRest = [];
  for (let i = 0; i < userDocs.length; i++) {
    const udoc = userDocs[i];
    const userData = udoc.data() || {};
    if (!userHasWeightForPersonalSpeed(userData)) continue;
    const rollup = rollupMap.get(udoc.id);
    if (!rollup || !personalSpeedRollupIsReady(rollup, startStr, endStr, userData)) continue;
    if (!personalSpeedRollupSpeedSynced(rollup, userData)) speedMismatch.push(udoc);
    else peakDriftRest.push(udoc);
  }
  let refreshed = 0;
  let scanned = 0;

  const rescanOne = async (udoc) => {
    const userId = udoc.id;
    const userData = udoc.data() || {};
    const rollup = rollupMap.get(userId);
    if (!rollup) return;
    const rawW =
      Number(
        userData.weight != null
          ? userData.weight
          : userData.weightKg != null
            ? userData.weightKg
            : userData.weight_kg
      ) || 0;
    const weightKg = rawW > 0 ? Math.max(rawW, 45) : 70;
    const { peak60: peakFromLogs, peakYmd } = await peak60DashboardStyleFromLogs(
      db,
      userId,
      startStr,
      endStr,
      weightKg
    );
    const stored = Number(rollup.peak60minWatts) || 0;
    const forceRescan = speedMismatch.indexOf(udoc) >= 0;
    if (
      !forceRescan &&
      Math.abs(peakFromLogs - stored) <= peakTolW &&
      (peakFromLogs > 0) === (stored > 0)
    ) {
      return;
    }
    const metrics = buildPersonalSpeedMetricsFromUserAndPeak60(userData, peakFromLogs, peakYmd);
    if (metrics && metrics.speedKmh > 0) {
      await writePersonalSpeed6mRollupDoc(db, userId, userData, startStr, endStr, metrics);
      rollupMap.set(userId, {
        windowStart: startStr,
        windowEnd: endStr,
        peak60minWatts: metrics.peak60minWatts,
        peak60Ymd: metrics.peak60Ymd || "",
        referenceWatts: metrics.referenceWatts,
        speedKmh: metrics.speedKmh,
        weightKg: metrics.weightKg,
        peakSource: exports.PERSONAL_SPEED_PEAK_SOURCE_MAX60,
        rollupLogicVersion: exports.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION,
      });
      refreshed += 1;
    } else {
      await personalSpeedRollupRef(db, userId).delete().catch(() => {});
      rollupMap.delete(userId);
    }
  };

  for (let i = 0; i < speedMismatch.length; i += batchSize) {
    const batch = speedMismatch.slice(i, i + batchSize);
    /* eslint-disable no-await-in-loop */
    await Promise.all(
      batch.map(async (udoc) => {
        scanned += 1;
        try {
          await rescanOne(udoc);
        } catch (e) {
          console.warn("[rankingDayRollup] peak drift refresh 실패:", udoc.id, e.message);
        }
      })
    );
    /* eslint-enable no-await-in-loop */
  }
  const driftScanCap = maxScan > 0 ? maxScan : peakDriftRest.length;
  for (let i = 0; i < peakDriftRest.length && scanned < driftScanCap; i += batchSize) {
    const batch = peakDriftRest.slice(i, i + batchSize);
    if (scanned >= driftScanCap) break;
    /* eslint-disable no-await-in-loop */
    await Promise.all(
      batch.map(async (udoc) => {
        if (scanned >= driftScanCap) return;
        scanned += 1;
        try {
          await rescanOne(udoc);
        } catch (e) {
          console.warn("[rankingDayRollup] peak drift refresh 실패:", udoc.id, e.message);
        }
      })
    );
    /* eslint-enable no-await-in-loop */
  }
  if (refreshed > 0) {
    console.log("[rankingDayRollup] personal_speed peak drift refresh", {
      refreshed,
      scanned,
      startStr,
      endStr,
    });
  }
  return { refreshed, scanned };
}

/**
 * rollup 미존재·구버전·창 불일치 사용자 — 대시보드 동일 로그 산출로 personal_speed_6m 생성.
 * @param {Map<string, object>} rollupMap — 갱신된 rollup이 map에 병합됨
 */
async function backfillMissingPersonalSpeedRollups(db, userDocs, startStr, endStr, rollupMap, opts) {
  if (!userDocs || !userDocs.length) return { backfilled: 0, attempted: 0 };
  const batchSize = (opts && opts.batchSize) || ROLLUP_REBUILD_BATCH;
  const maxBackfill =
    opts && opts.maxBackfill != null && Number.isFinite(Number(opts.maxBackfill))
      ? Math.max(0, Math.floor(Number(opts.maxBackfill)))
      : Infinity;
  const toRun = [];
  for (let i = 0; i < userDocs.length; i++) {
    const udoc = userDocs[i];
    const userData = udoc.data() || {};
    if (!userHasWeightForPersonalSpeed(userData)) continue;
    if (personalSpeedRollupIsReady(rollupMap.get(udoc.id), startStr, endStr, userData)) continue;
    toRun.push(udoc);
    if (toRun.length >= maxBackfill) break;
  }
  let backfilled = 0;
  for (let i = 0; i < toRun.length; i += batchSize) {
    const batch = toRun.slice(i, i + batchSize);
    /* eslint-disable no-await-in-loop */
    await Promise.all(
      batch.map(async (udoc) => {
        const userId = udoc.id;
        try {
          const m = await rebuildPersonalSpeed6mRollupFromBuckets(
            db,
            userId,
            udoc.data() || {},
            startStr,
            endStr,
            { ensureMissingDays: false }
          );
          if (m && m.speedKmh > 0) {
            rollupMap.set(userId, {
              windowStart: startStr,
              windowEnd: endStr,
              peak60minWatts: m.peak60minWatts,
              peak60Ymd: m.peak60Ymd || "",
              referenceWatts: m.referenceWatts,
              speedKmh: m.speedKmh,
              weightKg: m.weightKg,
              peakSource: exports.PERSONAL_SPEED_PEAK_SOURCE_MAX60,
              rollupLogicVersion: exports.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION,
            });
            backfilled += 1;
          }
        } catch (e) {
          console.warn("[rankingDayRollup] personal_speed backfill 실패:", userId, e.message);
        }
      })
    );
    /* eslint-enable no-await-in-loop */
  }
  return { backfilled, attempted: toRun.length };
}

/**
 * users 스냅샷 + rollup 1문서/사용자 batch getAll — O(users) 읽기.
 * @returns {Map<string, object>} userId -> rollup data
 */
async function fetchPersonalSpeed6mRollupMap(db, userIds) {
  const map = new Map();
  if (!userIds.length) return map;
  const chunk = 500;
  for (let i = 0; i < userIds.length; i += chunk) {
    const slice = userIds.slice(i, i + chunk);
    const refs = slice.map((uid) => personalSpeedRollupRef(db, uid));
    /* eslint-disable no-await-in-loop */
    const snaps = await chunkedGetAll(db, refs, chunk);
    /* eslint-enable no-await-in-loop */
    for (let j = 0; j < slice.length; j++) {
      if (snaps[j] && snaps[j].exists) {
        map.set(slice[j], snaps[j].data() || {});
      }
    }
  }
  return map;
}

function maxHrByDurationFromBucketSnaps(bucketSnaps, startStr, endStr) {
  const out = {};
  for (const dt of Object.keys(DURATION_HR_FIELDS)) out[dt] = 0;
  bucketSnaps.forEach((snap) => {
    if (!snap || !snap.exists) return;
    const row = snap.data() || {};
    const ymd = row.ymd || snap.id || "";
    if (!ymd || ymd < startStr || ymd > endStr) return;
    for (const [durationType, field] of Object.entries(DURATION_HR_FIELDS)) {
      const hr = Number(row[field]) || 0;
      if (hr < 40 || hr > HR_MAX_BPM) continue;
      if (hr > out[durationType]) out[durationType] = hr;
    }
  });
  return out;
}

exports.getRolling28DaysRangeSeoul = getRolling28DaysRangeSeoul;
exports.splitInclusiveRangeIntoFourWeeks = splitInclusiveRangeIntoFourWeeks;
exports.calculateGcRankingFromWeeklyMaxWkg = calculateGcRankingFromWeeklyMaxWkg;
exports.computeUserPeaksFourWeekOnePeakFromBucketSnaps = computeUserPeaksFourWeekOnePeakFromBucketSnaps;
exports.computeFourWeekGcStylePeaksFromBucketSnaps = computeFourWeekGcStylePeaksFromBucketSnaps;
exports.rebuildPeak28dRollupFromBuckets = rebuildPeak28dRollupFromBuckets;
exports.touchPeak28dRollupAfterDayChange = touchPeak28dRollupAfterDayChange;
exports.rebuildPeak28dRollupsBatch = rebuildPeak28dRollupsBatch;
exports.fetchPeak28dRollupMap = fetchPeak28dRollupMap;
exports.peak28dRollupNeedsInvalidate = peak28dRollupNeedsInvalidate;
exports.snapshotUserMetaForPeakRollup = snapshotUserMetaForPeakRollup;
exports.rebuildPeak28dRollupsChunk = rebuildPeak28dRollupsChunk;
exports.reconcileRankingDayTotalsOnLogWrite = reconcileRankingDayTotalsOnLogWrite;
exports.reconcileUserRankingDayBucket = reconcileUserRankingDayBucket;
exports.ensureRankingBucketsFilledForRange = ensureRankingBucketsFilledForRange;
exports.listInclusiveYmdsSeoul = listInclusiveYmdsSeoul;
exports.effectiveDayTssFromSnap = effectiveDayTssFromSnap;
exports.weeklyTssSumFromDayBuckets = weeklyTssSumFromDayBuckets;
exports.rollingKmSumFromDayBuckets = rollingKmSumFromDayBuckets;
exports.cheatDayPresentFromBuckets = cheatDayPresentFromBuckets;
exports.computeUserPeaksAllDurationsFromBucketSnaps = computeUserPeaksAllDurationsFromBucketSnaps;
exports.max60minWattsFromBucketSnaps = max60minWattsFromBucketSnaps;
exports.max60minWattsFromDayBuckets = max60minWattsFromDayBuckets;
exports.peak60YmdFromDayBuckets = peak60YmdFromDayBuckets;
exports.maxHrByDurationFromBucketSnaps = maxHrByDurationFromBucketSnaps;
exports.bucketRef = bucketRef;
exports.chunkedGetAll = chunkedGetAll;
exports.getRolling183DaysRangeSeoul = getRolling183DaysRangeSeoul;
exports.calculateSpeedOnFlat = calculateSpeedOnFlat;
exports.rebuildPersonalSpeed6mRollupFromBuckets = rebuildPersonalSpeed6mRollupFromBuckets;
exports.rebuildPersonalSpeed6mRollupsBatch = rebuildPersonalSpeed6mRollupsBatch;
exports.fetchPersonalSpeed6mRollupMap = fetchPersonalSpeed6mRollupMap;
exports.touchPersonalSpeed6mRollupAfterDayChange = touchPersonalSpeed6mRollupAfterDayChange;
exports.peak60minWattsFromLogValidated = peak60minWattsFromLogValidated;
exports.effective60minWattsFromLogDashboard = effective60minWattsFromLogDashboard;
exports.peak60DashboardStyleFromLogs = peak60DashboardStyleFromLogs;
exports.peak60RankingStrictFromLogs = peak60RankingStrictFromLogs;
exports.computePersonalSpeedMetricsFromLogsDashboardRoute =
  computePersonalSpeedMetricsFromLogsDashboardRoute;
exports.fetchUserTrainingLogsDashboardRoute = fetchUserTrainingLogsDashboardRoute;
exports.effective60minWattsFromLogRankingStrict = effective60minWattsFromLogRankingStrict;
exports.dedupeTrainingLogsByDateStravaFirstServer = dedupeTrainingLogsByDateStravaFirstServer;
exports.buildPersonalSpeedMetricsFromUserAndPeak60 = buildPersonalSpeedMetricsFromUserAndPeak60;
exports.writePersonalSpeed6mRollupDoc = writePersonalSpeed6mRollupDoc;
exports.backfillMissingPersonalSpeedRollups = backfillMissingPersonalSpeedRollups;
exports.personalSpeedRollupIsReady = personalSpeedRollupIsReady;
exports.personalSpeedRollupIsFtpDerived = personalSpeedRollupIsFtpDerived;
exports.personalSpeedRollupSpeedSynced = personalSpeedRollupSpeedSynced;
exports.invalidateStalePersonalSpeedRollups = invalidateStalePersonalSpeedRollups;
exports.preparePersonalSpeedRankingRebuild = preparePersonalSpeedRankingRebuild;
exports.refreshPersonalSpeedRollupsPeakDriftFromLogs = refreshPersonalSpeedRollupsPeakDriftFromLogs;
exports.userHasWeightForPersonalSpeed = userHasWeightForPersonalSpeed;
