'use strict';

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const dateFrom = (process.argv[2] || '2026-06-09').slice(0, 10);
const dateTo = (process.argv[3] || dateFrom).slice(0, 10);

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
  const userIds = await stravaSyncRetry.listUsersNeedingStravaSyncRetry(db, {
    dateFrom,
    dateTo,
    maxUsers: 500,
  });
  console.log('date', dateFrom, 'to', dateTo, 'count', userIds.length);
  for (const uid of userIds) {
    const snap = await db.collection('users').doc(uid).get();
    const d = snap.data() || {};
    console.log(
      uid,
      d.name || d.user_name || '',
      'status',
      d.strava_last_activity_fetch_status,
      'range',
      (d.strava_last_activity_fetch_range || {}).dateFrom,
      '-',
      (d.strava_last_activity_fetch_range || {}).dateTo,
      'err',
      d.strava_last_activity_fetch_error || ''
    );
  }
})();
