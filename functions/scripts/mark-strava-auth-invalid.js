'use strict';

/**
 * refresh_token 무효 사용자 — 재시도 루프 중단 + strava_auth_invalid 표시
 *   node scripts/mark-strava-auth-invalid.js <uid> [sinceYYYY-MM-DD]
 */
const admin = require('firebase-admin');
const path = require('path');
const stravaSyncRetry = require('../stravaSyncRetry');

const uid = process.argv[2];
const since = (process.argv[3] || '').slice(0, 10);
const keyPath = path.join(__dirname, 'serviceAccountKey.json');

if (!uid) {
  console.error('Usage: node scripts/mark-strava-auth-invalid.js <uid> [sinceYYYY-MM-DD]');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
    projectId: 'stelvio-ai',
  });
}

(async function main() {
  const db = admin.firestore();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) throw new Error('user not found: ' + uid);
  const u = snap.data() || {};
  await stravaSyncRetry.markStravaAuthInvalid(db, uid, {
    reason: 'manual_api_verify',
    error: u.strava_last_activity_fetch_error || 'manual_mark',
    since: since || undefined,
    evidence: {
      httpStatus: 400,
      tokenData: {
        message: 'Bad Request',
        errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }],
      },
      errorText: u.strava_last_activity_fetch_error || 'manual_api_verify',
    },
  });
  const after = await db.collection('users').doc(uid).get();
  const d = after.data() || {};
  console.log(JSON.stringify({
    uid,
    name: d.name,
    strava_auth_invalid: d.strava_auth_invalid,
    strava_sync_retry_pending: d.strava_sync_retry_pending,
    strava_sync_retry_attempts: d.strava_sync_retry_attempts,
    hint: d.strava_last_activity_fetch_hint,
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
