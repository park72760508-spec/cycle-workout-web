'use strict';

/**
 * 429로 실패한 Strava 동기화 사용자 재수집 (로컬 Admin SDK).
 *   node scripts/run-strava-429-retry.js 2026-06-09
 *   node scripts/run-strava-429-retry.js 2026-06-09 2026-06-09
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const dateFrom = (process.argv[2] || '').slice(0, 10);
const dateTo = (process.argv[3] || dateFrom).slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
  console.error('Usage: node scripts/run-strava-429-retry.js <dateFrom> [dateTo]');
  process.exit(1);
}

const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!admin.apps.length) {
  if (!fs.existsSync(keyPath)) {
    console.error('serviceAccountKey.json not found');
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
    projectId: 'stelvio-ai',
  });
}

const stravaSyncRetry = require('../stravaSyncRetry');
const index = require('../index.js');

(async function main() {
  const db = admin.firestore();
  const userIds = await stravaSyncRetry.listUsersNeedingStravaSyncRetry(db, {
    dateFrom,
    dateTo,
    maxUsers: 500,
  });
  console.log('[429-retry] candidates=', userIds.length, userIds);
  if (!userIds.length) return;

  const range = stravaSyncRetry.ymdRangeToUnix({ dateFrom, dateTo });
  const summary = await stravaSyncRetry.runStravaSyncRetrySequential(
    db,
    range,
    userIds,
    '[local-429-retry]',
    index.processOneUserStravaSync,
    index.processStravaActivity
  );
  console.log('[429-retry] done', {
    total: summary.total,
    ok: summary.ok,
    fail: summary.fail,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
