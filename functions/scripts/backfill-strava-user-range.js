'use strict';

/**
 * 단일 사용자 Strava 구간 백필 (재연결 후)
 *   node scripts/backfill-strava-user-range.js <uid> <dateFrom> <dateTo>
 */
const admin = require('firebase-admin');
const path = require('path');
const stravaSyncRetry = require('../stravaSyncRetry');

const uid = process.argv[2];
const dateFrom = (process.argv[3] || '').slice(0, 10);
const dateTo = (process.argv[4] || dateFrom).slice(0, 10);
const keyPath = path.join(__dirname, 'serviceAccountKey.json');

if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
  console.error('Usage: node scripts/backfill-strava-user-range.js <uid> <dateFrom> <dateTo>');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
    projectId: 'stelvio-ai',
  });
}

const index = require('../index.js');

(async function main() {
  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new Error('user not found: ' + uid);
  const userData = userSnap.data() || {};
  if (userData.strava_auth_invalid === true) {
    throw new Error('strava_auth_invalid — 사용자가 Strava 재연결 후 실행하세요.');
  }
  const range = stravaSyncRetry.ymdRangeToUnix({ dateFrom, dateTo });
  console.log('[backfill] user=', uid, 'range=', dateFrom, '~', dateTo);
  const result = await index.processOneUserStravaSync(db, uid, userData, {
    afterUnix: range.afterUnix,
    beforeUnix: range.beforeUnix,
    dateFrom,
    dateTo,
  });
  console.log('[backfill] result=', JSON.stringify(result, null, 2));
  const logsSnap = await db
    .collection('users')
    .doc(uid)
    .collection('logs')
    .where('source', '==', 'strava')
    .where('date', '>=', dateFrom)
    .where('date', '<=', dateTo)
    .get();
  console.log('[backfill] strava logs in range=', logsSnap.size);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
