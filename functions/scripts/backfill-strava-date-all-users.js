'use strict';

/**
 * 특정 날짜 Firestore Strava 로그 → Supabase rides 일괄 백필.
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-strava-date-all-users.js 2026-06-09
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const dateYmd = (process.argv[2] || '').slice(0, 10);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd) || !serviceKey) {
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-strava-date-all-users.js YYYY-MM-DD');
  process.exit(1);
}

const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
    projectId: 'stelvio-ai',
  });
}

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://eacrwhtbdqanaxpicqsm.supabase.co';
process.env.STELVIO_UID_NAMESPACE =
  process.env.STELVIO_UID_NAMESPACE || '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const sb = require('../supabaseDualWriteServer');

(async function main() {
  const db = admin.firestore();
  const usersSnap = await db.collection('users').where('strava_refresh_token', '!=', '').get();
  let users = 0;
  let logs = 0;
  let ok = 0;
  let fail = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const logsSnap = await db
      .collection('users')
      .doc(uid)
      .collection('logs')
      .where('date', '==', dateYmd)
      .where('source', '==', 'strava')
      .get();
    if (!logsSnap.size) continue;
    users += 1;
    for (const logDoc of logsSnap.docs) {
      logs += 1;
      try {
        await sb.runSecondaryAfterStravaLogSave(admin, uid, logDoc.id, logDoc.data(), {
          force: true,
        });
        ok += 1;
      } catch (e) {
        fail += 1;
        console.warn('[backfill fail]', uid, logDoc.id, e.message || e);
      }
    }
  }
  console.log('[backfill-all]', { dateYmd, users, logs, ok, fail });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
