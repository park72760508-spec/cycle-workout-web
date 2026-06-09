'use strict';

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const PROJECT_ID = 'stelvio-ai';
const DEFAULT_KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const uid = process.argv[2] || 'gQQBL0SaVrcKLBV0S4nK774s0Vb2';
const date = process.argv[3] || '2026-06-09';

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

const db = admin.firestore();

(async function main() {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    console.log('USER_NOT_FOUND');
    return;
  }
  const u = userSnap.data() || {};
  const logsSnap = await db.collection('users').doc(uid).collection('logs').where('date', '==', date).get();
  const stravaLogs = logsSnap.docs.filter((d) => String(d.data().source || '').toLowerCase() === 'strava');

  console.log('=== USER ===');
  console.log(
    JSON.stringify(
      {
        uid,
        name: u.name || u.user_name,
        grade: u.grade,
        strava_athlete_id: u.strava_athlete_id,
        has_refresh_token: Boolean(u.strava_refresh_token),
        strava_expires_at: u.strava_expires_at,
        strava_scope: u.strava_scope,
        strava_has_activity_read: u.strava_has_activity_read,
        strava_has_activity_read_all: u.strava_has_activity_read_all,
        strava_last_activity_fetch_at: u.strava_last_activity_fetch_at,
        strava_last_activity_fetch_status: u.strava_last_activity_fetch_status,
        strava_last_activity_fetch_count: u.strava_last_activity_fetch_count,
        strava_last_activity_fetch_empty: u.strava_last_activity_fetch_empty,
        strava_last_activity_fetch_range: u.strava_last_activity_fetch_range,
        strava_last_activity_fetch_error: u.strava_last_activity_fetch_error,
        strava_last_activity_fetch_hint: u.strava_last_activity_fetch_hint,
      },
      null,
      2
    )
  );

  console.log('=== LOGS', date, '===');
  console.log('total', logsSnap.size, 'strava', stravaLogs.length);
  stravaLogs.forEach((d) => {
    const x = d.data();
    console.log(
      JSON.stringify({
        id: d.id,
        activity_id: x.activity_id,
        title: x.title,
        tss: x.tss,
        activity_type: x.activity_type,
        duration_sec: x.duration_sec,
      })
    );
  });

  const recentSnap = await db
    .collection('users')
    .doc(uid)
    .collection('logs')
    .orderBy('date', 'desc')
    .limit(8)
    .get();
  console.log('=== RECENT LOGS ===');
  recentSnap.docs.forEach((d) => {
    const x = d.data();
    console.log(d.id, x.date, x.source, x.title);
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
