'use strict';

/**
 * 28일 피크 선정 진단 — raw(구간별 독립 최대) vs capPeakWkgMonotonic(현행 랭킹) 비교
 *
 * Usage:
 *   node functions/scripts/diagnose-peak-selection.js <uid>
 *   node functions/scripts/diagnose-peak-selection.js --name "박지성"
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const rankingDayRollup = require('../rankingDayRollup');
const { capPeakWkgMonotonicInPlace } = require('../peakPowerMonotonic');

const PROJECT_ID = 'stelvio-ai';
const DEFAULT_KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');

const DURATION_FIELDS = {
  max: 'max_watts',
  '1min': 'max_1min_watts',
  '5min': 'max_5min_watts',
  '10min': 'max_10min_watts',
  '20min': 'max_20min_watts',
  '40min': 'max_40min_watts',
  '60min': 'max_60min_watts',
};

function initAdmin() {
  if (admin.apps.length) return;
  if (!fs.existsSync(DEFAULT_KEY_PATH)) {
    console.error('serviceAccountKey.json not found at', DEFAULT_KEY_PATH);
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.cert(require(DEFAULT_KEY_PATH)),
    projectId: PROJECT_ID,
  });
}

async function findUserByName(name) {
  const snap = await admin.firestore().collection('users').get();
  const q = String(name || '').trim();
  const hits = [];
  snap.docs.forEach((d) => {
    const u = d.data() || {};
    const n = String(u.name || u.displayName || '').trim();
    if (n === q || n.indexOf(q) >= 0) {
      hits.push({ uid: d.id, name: n, weight: u.weight || u.weightKg });
    }
  });
  return hits;
}

function comparePeaks(rawPeaks, cappedPeaks, weightKg) {
  const order = ['max', '1min', '5min', '10min', '20min', '40min', '60min'];
  const rows = [];
  order.forEach((dt) => {
    const raw = rawPeaks[dt];
    const cap = cappedPeaks[dt];
    if (!raw && !cap) return;
    const rawWkg = raw ? raw.wkg : 0;
    const capWkg = cap ? cap.wkg : 0;
    const delta = Math.round((rawWkg - capWkg) * 100) / 100;
    rows.push({
      duration: dt,
      rawWatts: raw ? raw.watts : 0,
      rawWkg,
      rankedWatts: cap ? cap.watts : 0,
      rankedWkg: capWkg,
      wkgDelta: delta,
      cappedDown: delta > 0.001,
    });
  });
  return rows;
}

function rawPeaksFromBucketSnaps(userData, bucketSnaps, startStr, endStr) {
  const rawWeight = Number(userData.weight || userData.weightKg || 0);
  if (rawWeight <= 0) return null;
  const weightKg = Math.max(rawWeight, 45);
  const maxW = {};
  Object.keys(DURATION_FIELDS).forEach((dt) => {
    maxW[dt] = 0;
  });

  (bucketSnaps || []).forEach((snap) => {
    if (!snap || !snap.exists) return;
    const row = snap.data() || {};
    const ymd = row.ymd || snap.id || '';
    if (!ymd || ymd < startStr || ymd > endStr) return;
    Object.keys(DURATION_FIELDS).forEach((dt) => {
      const field = DURATION_FIELDS[dt];
      const w = Number(row[field]) || 0;
      if (w > maxW[dt]) maxW[dt] = w;
    });
  });

  const peaks = {};
  Object.keys(maxW).forEach((dt) => {
    if (maxW[dt] > 0) {
      peaks[dt] = {
        watts: maxW[dt],
        wkg: Math.round((maxW[dt] / weightKg) * 100) / 100,
        weightKg,
      };
    }
  });
  return Object.keys(peaks).length ? { weightKg, peaks } : null;
}

async function diagnoseUser(uid) {
  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    console.log('USER_NOT_FOUND', uid);
    return;
  }
  const userData = userSnap.data() || {};
  const { startStr, endStr } = rankingDayRollup.getRolling28DaysRangeSeoul();

  const dates = rankingDayRollup.listInclusiveYmdsSeoul(startStr, endStr);
  const refs = dates.map((ymd) => rankingDayRollup.bucketRef(db, uid, ymd));
  const bucketSnaps = await rankingDayRollup.chunkedGetAll(db, refs, 100);

  const rawMap = rawPeaksFromBucketSnaps(userData, bucketSnaps, startStr, endStr);
  const rollupSnap = await db
    .collection('users')
    .doc(uid)
    .collection(rankingDayRollup.RANKING_ROLLUPS_COLL)
    .doc(rankingDayRollup.PEAK_28D_ROLLUP_ID)
    .get();

  const cappedFromRollup =
    rollupSnap.exists && rollupSnap.data() && rollupSnap.data().peaks
      ? rollupSnap.data().peaks
      : null;

  let cappedFromCompute = null;
  if (rawMap) {
    const wkgMap = {};
    Object.keys(rawMap.peaks).forEach((dt) => {
      wkgMap[dt] = rawMap.peaks[dt].wkg;
    });
    capPeakWkgMonotonicInPlace(wkgMap);
    cappedFromCompute = {};
    Object.keys(rawMap.peaks).forEach((dt) => {
      cappedFromCompute[dt] = {
        watts: Math.round(wkgMap[dt] * rawMap.weightKg),
        wkg: wkgMap[dt],
      };
    });
  }

  const comparison = comparePeaks(
    rawMap ? rawMap.peaks : {},
    cappedFromRollup || cappedFromCompute || {},
    rawMap ? rawMap.weightKg : 0
  );

  console.log('=== PEAK SELECTION DIAGNOSIS ===');
  console.log(
    JSON.stringify(
      {
        uid,
        name: userData.name || userData.displayName,
        weightKg: userData.weight || userData.weightKg,
        window: { startStr, endStr },
        rollupExists: rollupSnap.exists,
        rollupWindow: rollupSnap.exists
          ? { start: rollupSnap.data().windowStart, end: rollupSnap.data().windowEnd }
          : null,
      },
      null,
      2
    )
  );

  console.log('\n=== PER-DURATION: raw vs ranked (rollup/cap) ===');
  comparison.forEach((r) => {
    if (r.rawWkg > 0 || r.rankedWkg > 0) {
      console.log(JSON.stringify(r));
    }
  });

  const cappedDurations = comparison.filter((r) => r.cappedDown);
  if (cappedDurations.length) {
    console.log('\n=== CAPPED DOWN (likely ranking drop cause) ===');
    cappedDurations.forEach((r) => console.log(JSON.stringify(r)));
  } else {
    console.log('\nNo cross-duration cap reduction detected in 28d window.');
  }

  console.log('\n=== TOP DAILY BUCKET VALUES (max / 1min / 5min) ===');
  const topByDur = { max: [], '1min': [], '5min': [] };
  bucketSnaps.forEach((snap) => {
    if (!snap || !snap.exists) return;
    const row = snap.data() || {};
    const ymd = row.ymd || snap.id;
    ['max', '1min', '5min'].forEach((dt) => {
      const w = Number(row[DURATION_FIELDS[dt]]) || 0;
      if (w > 0) topByDur[dt].push({ ymd, watts: w });
    });
  });
  ['max', '1min', '5min'].forEach((dt) => {
    topByDur[dt].sort((a, b) => b.watts - a.watts);
    console.log(dt, JSON.stringify(topByDur[dt].slice(0, 5)));
  });
}

(async function main() {
  initAdmin();
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node diagnose-peak-selection.js <uid> | --name "이름"');
    process.exit(1);
  }
  if (arg === '--name') {
    const name = process.argv[3];
    const hits = await findUserByName(name);
    if (!hits.length) {
      console.log('NO_USER_MATCH', name);
      process.exit(1);
    }
    if (hits.length > 1) {
      console.log('MULTIPLE_MATCHES — pick uid:');
      hits.forEach((h) => console.log(JSON.stringify(h)));
      process.exit(0);
    }
    await diagnoseUser(hits[0].uid);
    return;
  }
  await diagnoseUser(arg);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
