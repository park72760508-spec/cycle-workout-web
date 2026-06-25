'use strict';

/**
 * 특정 날짜 Firestore Strava 로그 → Supabase rides + daily_summaries 일괄 백필.
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-strava-date-all-users.js 2026-06-09
 */
const admin = require('firebase-admin');
const path = require('path');

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
  const userIdsWithLogs = [];
  let logsOk = 0;
  let logsFail = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const logDocs = [];
    const seen = new Set();
    const collect = (snap) => {
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        logDocs.push(doc);
      }
    };

    try {
      const rangedStr = await db
        .collection('users')
        .doc(uid)
        .collection('logs')
        .where('source', '==', 'strava')
        .where('date', '>=', dateYmd)
        .where('date', '<=', dateYmd)
        .get();
      collect(rangedStr);
    } catch (e) {
      console.warn('[backfill-all] string date query', uid, e.message || e);
    }

    try {
      const tsStart = admin.firestore.Timestamp.fromDate(new Date(`${dateYmd}T00:00:00+09:00`));
      const tsEnd = admin.firestore.Timestamp.fromDate(new Date(`${dateYmd}T23:59:59.999+09:00`));
      const rangedTs = await db
        .collection('users')
        .doc(uid)
        .collection('logs')
        .where('source', '==', 'strava')
        .where('date', '>=', tsStart)
        .where('date', '<=', tsEnd)
        .get();
      collect(rangedTs);
    } catch (e) {
      console.warn('[backfill-all] timestamp date query', uid, e.message || e);
    }

    if (!logDocs.length) continue;
    userIdsWithLogs.push(uid);
    for (const logDoc of logDocs) {
      try {
        await sb.runSecondaryAfterStravaLogSave(admin, uid, logDoc.id, logDoc.data(), {
          force: true,
        });
        logsOk += 1;
      } catch (e) {
        logsFail += 1;
        console.warn('[backfill fail]', uid, logDoc.id, e.message || e);
      }
    }
  }

  let parity = { ridesSynced: 0, bucketsSynced: 0 };
  if (userIdsWithLogs.length) {
    parity = await sb.syncUsersWeeklyTssParityToSupabase(
      db,
      admin,
      userIdsWithLogs,
      dateYmd,
      dateYmd
    );
  }

  console.log('[backfill-all]', {
    dateYmd,
    usersWithLogs: userIdsWithLogs.length,
    logsOk,
    logsFail,
    ...parity,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
