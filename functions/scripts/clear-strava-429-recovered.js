'use strict';

/** 2026-06-09 Strava 로그가 생긴 유저의 429 진단 플래그 정리 */
const admin = require('firebase-admin');
const path = require('path');

const dateYmd = (process.argv[2] || '2026-06-09').slice(0, 10);
const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
    projectId: 'stelvio-ai',
  });
}
const stravaSyncRetry = require('../stravaSyncRetry');

(async function main() {
  const db = admin.firestore();
  const usersSnap = await db.collection('users').where('strava_refresh_token', '!=', '').get();
  let cleared = 0;
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const d = userDoc.data() || {};
    if (Number(d.strava_last_activity_fetch_status) !== 429) continue;
    const logsSnap = await db
      .collection('users')
      .doc(uid)
      .collection('logs')
      .where('date', '==', dateYmd)
      .where('source', '==', 'strava')
      .limit(1)
      .get();
    const hasLogs = logsSnap.size > 0;
    const range = d.strava_last_activity_fetch_range || {};
    const overlaps =
      String(range.dateFrom || '').slice(0, 10) <= dateYmd &&
      String(range.dateTo || '').slice(0, 10) >= dateYmd;
    if (!overlaps) continue;
    if (hasLogs || d.strava_sync_retry_pending === false) {
      await stravaSyncRetry.clearStravaSyncRetryPending(db, uid, { count: logsSnap.size });
      cleared += 1;
      console.log('cleared', uid, d.name || d.user_name || '');
    }
  }
  console.log('done cleared', cleared);
})();
