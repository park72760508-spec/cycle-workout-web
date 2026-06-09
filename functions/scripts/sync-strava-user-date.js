'use strict';

/**
 * 단일 사용자·날짜 Strava 재수집 (로컬 Admin SDK).
 *   node scripts/sync-strava-user-date.js <uid> <YYYY-MM-DD>
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const PROJECT_ID = 'stelvio-ai';
const DEFAULT_KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const uid = process.argv[2];
const dateYmd = (process.argv[3] || '').slice(0, 10);

if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
  console.error('Usage: node scripts/sync-strava-user-date.js <uid> <YYYY-MM-DD>');
  process.exit(1);
}

if (!admin.apps.length) {
  if (!fs.existsSync(DEFAULT_KEY_PATH)) {
    console.error('serviceAccountKey.json not found');
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.cert(require(DEFAULT_KEY_PATH)),
    projectId: PROJECT_ID,
  });
}

const index = require('../index.js');

(async function main() {
  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new Error('user not found: ' + uid);
  const userData = userSnap.data() || {};

  const startSeoul = new Date(dateYmd + 'T00:00:00+09:00');
  const endSeoul = new Date(dateYmd + 'T23:59:59.999+09:00');
  const afterUnix = Math.floor(startSeoul.getTime() / 1000);
  const beforeUnix = Math.floor(endSeoul.getTime() / 1000);

  console.log('[sync] user=', uid, 'date=', dateYmd, 'after=', afterUnix, 'before=', beforeUnix);

  if (typeof index.processOneUserStravaSync !== 'function') {
    throw new Error('processOneUserStravaSync not exported from index.js');
  }

  const result = await index.processOneUserStravaSync(db, uid, userData, {
    afterUnix,
    beforeUnix,
    dateFrom: dateYmd,
    dateTo: dateYmd,
  });
  console.log('[sync] result=', JSON.stringify(result, null, 2));

  const logsSnap = await db
    .collection('users')
    .doc(uid)
    .collection('logs')
    .where('date', '==', dateYmd)
    .where('source', '==', 'strava')
    .get();
  console.log('[sync] firestore strava logs after=', logsSnap.size);
  logsSnap.docs.forEach((d) => {
    const x = d.data();
    console.log(' -', d.id, x.title, 'tss=', x.tss);
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
