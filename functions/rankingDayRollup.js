/**
 * 일별 라이딩 집계(랭킹용): users/{userId}/ranking_day_totals/{YYYY-MM-DD}
 * — 스케줄 전체 로그 스캔 비용 축소(롤링 구간에는 최대 일수만 버킷 조회).
 * 로그 변경 시 해당 일자 버킸만 해당 사용자 로그 일괄로 재합산하여 일관성 유지.
 */

const admin = require("firebase-admin");

const EXCLUDED_ACTIVITY_TYPES = new Set(["run", "swim", "walk", "trailrun", "weighttraining"]);

exports.RANKING_DAY_TOTALS_COLL = "ranking_day_totals";
/** 사용자별 6개월 항속 사전 집계 — 랭킹 보드는 users×1회 읽기만 수행 */
exports.RANKING_ROLLUPS_COLL = "ranking_rollups";
exports.PERSONAL_SPEED_6M_ROLLUP_ID = "personal_speed_6m";
/** 랭킹 항속 산출식 버전 — 변경 시 rollup·순위 캐시 전면 재계산 */
exports.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION = 8;
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
 * 최근 6개월 로그에서 60분 파워(MMP) 최대만 사용 (레거시·비교용).
 */
async function peak60RankingStrictFromLogs(db, userId, startStr, endStr, weightKg) {
  let peak60 = 0;
  let peakYmd = "";
  if (!db || !userId || !startStr || !endStr) return { peak60, peakYmd };
  const wFall = Number(weightKg) > 0 ? Math.max(Number(weightKg), 45) : 70;
  const logSnap = await db
    .collection("users")
    .doc(userId)
    .collection("logs")
    .where("date", ">=", startStr)
    .where("date", "<=", endStr)
    .get();
  const inRange = logSnap.docs
    .map((doc) => doc.data() || {})
    .filter((d) => {
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
 * GC / 헵타곤 피크: 4주 각 주 최대 W/kg → 상위 3주 평균 후 미달 주차 페널티
 * @param {number[]} weeklyMaxWkgArr - 길이 4, 해당 주 무기록이면 0
 * @returns {{ finalWkg: number, penaltyMultiplier: number }}
 */
function calculateGcRankingFromWeeklyMaxWkg(weeklyMaxWkgArr) {
  const activeWeeks = (weeklyMaxWkgArr || [])
    .filter((val) => Number(val) > 0)
    .sort((a, b) => Number(b) - Number(a));
  const topWeeks = activeWeeks.slice(0, 3);
  const count = topWeeks.length;
  if (count === 0) return { finalWkg: 0, penaltyMultiplier: 1 };
  const sum = topWeeks.reduce((acc, val) => acc + Number(val), 0);
  const average = sum / count;
  let penaltyMultiplier = 1.0;
  if (count === 2) penaltyMultiplier = 0.85;
  if (count === 1) penaltyMultiplier = 0.70;
  const finalScore = average * penaltyMultiplier;
  const finalWkg = Math.round(finalScore * 100) / 100;
  return { finalWkg, penaltyMultiplier };
}

function weekIndexForSeoulYmd(ymd, weekRanges) {
  if (!ymd || !weekRanges || weekRanges.length !== 4) return -1;
  for (let i = 0; i < 4; i++) {
    if (ymd >= weekRanges[i].startStr && ymd <= weekRanges[i].endStr) return i;
  }
  return -1;
}

/**
 * 일 버킷 스냅샷(28일)으로 duration별 상위 3주 평균 피크 W/kg 산출 — 로그 1패스 동치, 추가 읽기 없음.
 */
function computeFourWeekGcStylePeaksFromBucketSnaps(userData, bucketSnaps, startStr, endStr) {
  const rawWeight = Number(userData.weight || userData.weightKg || 0);
  if (rawWeight <= 0) return null;
  const weightKg = Math.max(rawWeight, 45);
  const weekRanges = splitInclusiveRangeIntoFourWeeks(startStr, endStr);
  if (!weekRanges) return null;

  /** @type Record<string, number[]> duration -> 4주 최대 W */
  const maxWattsByDurWeek = {};
  for (const dt of Object.keys(DURATION_FIELDS)) {
    maxWattsByDurWeek[dt] = [0, 0, 0, 0];
  }

  bucketSnaps.forEach((snap) => {
    if (!snap || !snap.exists) return;
    const row = snap.data() || {};
    const ymd = row.ymd || snap.id || "";
    if (!ymd || ymd < startStr || ymd > endStr) return;
    const wi = weekIndexForSeoulYmd(ymd, weekRanges);
    if (wi < 0) return;
    for (const dt of Object.keys(DURATION_FIELDS)) {
      const field = DURATION_FIELDS[dt];
      const watts = Number(row[field]) || 0;
      if (watts <= maxWattsByDurWeek[dt][wi]) continue;
      if (!validatePeakPowerRecord(dt, watts, weightKg)) continue;
      maxWattsByDurWeek[dt][wi] = watts;
    }
  });

  const peaks = {};
  for (const dt of Object.keys(DURATION_FIELDS)) {
    const weeklyWkg = maxWattsByDurWeek[dt].map((mw) =>
      (mw > 0 ? Math.round((mw / weightKg) * 100) / 100 : 0)
    );
    const { finalWkg } = calculateGcRankingFromWeeklyMaxWkg(weeklyWkg);
    if (!finalWkg || finalWkg <= 0) continue;
    const watts = Math.round(finalWkg * weightKg);
    peaks[dt] = { watts, wkg: finalWkg, weightKg };
  }
  return Object.keys(peaks).length ? { weightKg, peaks } : null;
}

/** 로그 스냅샷 대신 버킂 스냅샷 목록으로 computeUserPeaksAllDurationsFromSnapshot 동치 */
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
      if (w > maxW[dt]) maxW[dt] = w;
    }
  });

  const peaks = {};
  for (const dt of Object.keys(DURATION_FIELDS)) {
    const mw = maxW[dt];
    if (mw > 0) peaks[dt] = { watts: mw, wkg: Math.round((mw / weightKg) * 100) / 100, weightKg };
  }
  if (!Object.keys(peaks).length) return null;
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
  const ensureMissing = !opts || opts.ensureMissingDays !== false;
  if (ensureMissing) {
    await ensureRankingBucketsFilledForRange(db, userId, userData || {}, startStr, endStr);
  }
  const dates = listInclusiveYmdsSeoul(startStr, endStr);
  if (!dates.length) return 0;
  const refs = dates.map((ymd) => bucketRef(db, userId, ymd));
  const bucketSnaps = await chunkedGetAll(db, refs, BUCKET_GET_CHUNK);
  return max60minWattsFromBucketSnaps(bucketSnaps, startStr, endStr);
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

function personalSpeed6mRollupRef(db, userId) {
  return db.collection("users").doc(userId).collection(exports.RANKING_ROLLUPS_COLL).doc(exports.PERSONAL_SPEED_6M_ROLLUP_ID);
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
  const ref = personalSpeed6mRollupRef(db, userId);
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
 * 6개월 창: ranking_day_totals 일 버킷만 1회 읽어 peak60·항속(km/h) 산출 (로그 스캔 없음).
 * ensureMissingDays=true일 때만 누락 일자 버킷을 로그로 채움(수동 백필용, 23시 배치는 false).
 */
async function rebuildPersonalSpeed6mRollupFromBuckets(db, userId, userData, startStr, endStr, opts) {
  const ensureMissing = !!(opts && opts.ensureMissingDays);
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
  const { peak60, peakYmd } = await peak60DashboardStyleFromLogs(
    db,
    userId,
    startStr,
    endStr,
    weightKg
  );
  const metrics = buildPersonalSpeedMetricsFromUserAndPeak60(userData, peak60, peakYmd);
  await writePersonalSpeed6mRollupDoc(db, userId, userData, startStr, endStr, metrics);
  return metrics;
}

/**
 * 로그→일 버킷 반영 직후: 증분 peak 갱신(대부분) / peak 하락 시에만 버킷 재스캔.
 */
async function touchPersonalSpeed6mRollupAfterDayChange(db, userId, userData, ymd, dayPayload) {
  const { startStr, endStr } = getRolling183DaysRangeSeoul();
  if (!ymd || ymd < startStr || ymd > endStr) {
    return;
  }
  const ref = personalSpeed6mRollupRef(db, userId);
  const existing = (await ref.get()).data() || null;
  const day60 = dayPayload ? Number(dayPayload.max_60min_watts) || 0 : 0;
  const windowOk =
    existing &&
    existing.windowStart === startStr &&
    existing.windowEnd === endStr;
  let peak60 = windowOk ? Number(existing.peak60minWatts) || 0 : 0;
  let peakYmd = windowOk ? String(existing.peak60Ymd || "") : "";

  if (!dayPayload) {
    if (peakYmd === ymd || peak60 <= 0) {
      await rebuildPersonalSpeed6mRollupFromBuckets(db, userId, userData, startStr, endStr, {
        ensureMissingDays: false,
      });
    }
    return;
  }

  if (day60 >= peak60) {
    peak60 = day60;
    peakYmd = ymd;
  } else if (peakYmd === ymd) {
    await rebuildPersonalSpeed6mRollupFromBuckets(db, userId, userData, startStr, endStr, {
      ensureMissingDays: false,
    });
    return;
  } else if (!windowOk) {
    await rebuildPersonalSpeed6mRollupFromBuckets(db, userId, userData, startStr, endStr, {
      ensureMissingDays: false,
    });
    return;
  }

  const metrics = buildPersonalSpeedMetricsFromUserAndPeak60(userData, peak60, peakYmd);
  await writePersonalSpeed6mRollupDoc(db, userId, userData, startStr, endStr, metrics);
}

/**
 * 23시 배치: 기본 skipUnchanged — 창이 맞는 personal_speed_6m은 재읽기 생략(체중/FTP만 바뀐 경우 km/h만 갱신).
 * 로그 스캔(ensureMissingDays)은 수동 백필에서만 true.
 */
async function rebuildPersonalSpeed6mRollupsBatch(db, userDocs, startStr, endStr, opts) {
  if (!userDocs || !userDocs.length) return { rebuilt: 0, skipped: 0, metricsRefreshed: 0 };
  const batchSize = (opts && opts.batchSize) || ROLLUP_REBUILD_BATCH;
  const bucketOpts = { ensureMissingDays: !!(opts && opts.ensureMissingDays) };
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
            const { peak60: peakFromLogs, peakYmd } = await peak60DashboardStyleFromLogs(
              db,
              userId,
              startStr,
              endStr,
              weightKg
            );
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
              await personalSpeed6mRollupRef(db, userId).delete().catch(() => {});
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
    toDelete.push(personalSpeed6mRollupRef(db, udoc.id));
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

/**
 * 항속 랭킹 집계 전: 무효 rollup 제거 후 전 사용자 rollup 재계산(60분 파워만).
 */
async function preparePersonalSpeedRankingRebuild(db, userDocs, startStr, endStr, opts) {
  const inv = await invalidateStalePersonalSpeedRollups(db, userDocs, startStr, endStr);
  const batch = await rebuildPersonalSpeed6mRollupsBatch(db, userDocs, startStr, endStr, {
    skipUnchanged: false,
    ensureMissingDays: !!(opts && opts.ensureMissingDays),
    batchSize: (opts && opts.batchSize) || ROLLUP_REBUILD_BATCH,
  });
  return { purged: inv.purged, ...batch };
}

/**
 * rollup은 있으나 로그 6개월 MMP와 peak60이 어긋난 사용자 — 로그 재스캔 후 rollup 갱신(HTTP 보드용).
 */
async function refreshPersonalSpeedRollupsPeakDriftFromLogs(db, userDocs, startStr, endStr, rollupMap, opts) {
  if (!userDocs || !userDocs.length) return { refreshed: 0, scanned: 0 };
  const maxScan =
    opts && opts.maxScan != null && Number.isFinite(Number(opts.maxScan))
      ? Math.max(0, Math.floor(Number(opts.maxScan)))
      : 120;
  const peakTolW = opts && opts.peakTolW != null ? Number(opts.peakTolW) : 1;
  const batchSize = (opts && opts.batchSize) || 20;
  const candidates = [];
  for (let i = 0; i < userDocs.length; i++) {
    const udoc = userDocs[i];
    const userData = udoc.data() || {};
    if (!userHasWeightForPersonalSpeed(userData)) continue;
    const rollup = rollupMap.get(udoc.id);
    if (!rollup || !personalSpeedRollupIsReady(rollup, startStr, endStr, userData)) continue;
    candidates.push(udoc);
  }
  let refreshed = 0;
  let scanned = 0;
  for (let i = 0; i < candidates.length && scanned < maxScan; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    if (scanned >= maxScan) break;
    /* eslint-disable no-await-in-loop */
    await Promise.all(
      batch.map(async (udoc) => {
        if (scanned >= maxScan) return;
        scanned += 1;
        const userId = udoc.id;
        const userData = udoc.data() || {};
        const rollup = rollupMap.get(userId);
        if (!rollup) return;
        try {
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
          if (
            Math.abs(peakFromLogs - stored) <= peakTolW &&
            (peakFromLogs > 0) === (stored > 0)
          ) {
            return;
          }
          const metrics = buildPersonalSpeedMetricsFromUserAndPeak60(
            userData,
            peakFromLogs,
            peakYmd
          );
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
            await personalSpeed6mRollupRef(db, userId).delete().catch(() => {});
            rollupMap.delete(userId);
          }
        } catch (e) {
          console.warn("[rankingDayRollup] peak drift refresh 실패:", userId, e.message);
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
    const refs = slice.map((uid) => personalSpeed6mRollupRef(db, uid));
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

exports.splitInclusiveRangeIntoFourWeeks = splitInclusiveRangeIntoFourWeeks;
exports.calculateGcRankingFromWeeklyMaxWkg = calculateGcRankingFromWeeklyMaxWkg;
exports.computeFourWeekGcStylePeaksFromBucketSnaps = computeFourWeekGcStylePeaksFromBucketSnaps;
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
exports.effective60minWattsFromLogRankingStrict = effective60minWattsFromLogRankingStrict;
exports.dedupeTrainingLogsByDateStravaFirstServer = dedupeTrainingLogsByDateStravaFirstServer;
exports.buildPersonalSpeedMetricsFromUserAndPeak60 = buildPersonalSpeedMetricsFromUserAndPeak60;
exports.backfillMissingPersonalSpeedRollups = backfillMissingPersonalSpeedRollups;
exports.personalSpeedRollupIsReady = personalSpeedRollupIsReady;
exports.personalSpeedRollupIsFtpDerived = personalSpeedRollupIsFtpDerived;
exports.personalSpeedRollupSpeedSynced = personalSpeedRollupSpeedSynced;
exports.invalidateStalePersonalSpeedRollups = invalidateStalePersonalSpeedRollups;
exports.preparePersonalSpeedRankingRebuild = preparePersonalSpeedRankingRebuild;
exports.refreshPersonalSpeedRollupsPeakDriftFromLogs = refreshPersonalSpeedRollupsPeakDriftFromLogs;
exports.userHasWeightForPersonalSpeed = userHasWeightForPersonalSpeed;
