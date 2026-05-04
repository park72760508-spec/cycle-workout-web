/**
 * 일별 라이딩 집계(랭킹용): users/{userId}/ranking_day_totals/{YYYY-MM-DD}
 * — 스케줄 전체 로그 스캔 비용 축소(롤링 구간에는 최대 일수만 버킷 조회).
 * 로그 변경 시 해당 일자 버킸만 해당 사용자 로그 일괄로 재합산하여 일관성 유지.
 */

const admin = require("firebase-admin");

const EXCLUDED_ACTIVITY_TYPES = new Set(["run", "swim", "walk", "trailrun", "weighttraining"]);

exports.RANKING_DAY_TOTALS_COLL = "ranking_day_totals";

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

  logSnap.docs.forEach((doc) => {
    const d = doc.data() || {};
    if (!isCyclingForMmp(d)) return;
    const dateStr = normalizeLogDateToSeoulYmd(d.date);
    if (!dateStr || dateStr !== ymd) return;

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

    if (weightKgFall > 0) {
      for (const [durationType, field] of Object.entries(DURATION_FIELDS)) {
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
    return;
  }

  await ref.set(payload, { merge: false });
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
 * 기간 내 일 버킂이 하나라도 없으면 해당 일만 reconcile(로컬 채우기).
 */
async function ensureRankingBucketsFilledForRange(db, userId, userData, startStr, endStr) {
  const dates = listInclusiveYmdsSeoul(startStr, endStr);
  if (dates.length === 0) return;
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

async function weeklyTssSumFromDayBuckets(db, userId, userData, startStr, endStr) {
  await ensureRankingBucketsFilledForRange(db, userId, userData, startStr, endStr);
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

exports.reconcileRankingDayTotalsOnLogWrite = reconcileRankingDayTotalsOnLogWrite;
exports.reconcileUserRankingDayBucket = reconcileUserRankingDayBucket;
exports.ensureRankingBucketsFilledForRange = ensureRankingBucketsFilledForRange;
exports.listInclusiveYmdsSeoul = listInclusiveYmdsSeoul;
exports.effectiveDayTssFromSnap = effectiveDayTssFromSnap;
exports.weeklyTssSumFromDayBuckets = weeklyTssSumFromDayBuckets;
exports.rollingKmSumFromDayBuckets = rollingKmSumFromDayBuckets;
exports.cheatDayPresentFromBuckets = cheatDayPresentFromBuckets;
exports.computeUserPeaksAllDurationsFromBucketSnaps = computeUserPeaksAllDurationsFromBucketSnaps;
exports.maxHrByDurationFromBucketSnaps = maxHrByDurationFromBucketSnaps;
exports.bucketRef = bucketRef;
exports.chunkedGetAll = chunkedGetAll;
