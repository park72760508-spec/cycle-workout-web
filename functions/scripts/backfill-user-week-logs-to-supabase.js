'use strict';

/**
 * 특정 사용자의 주간(또는 임의 기간) Firestore → Supabase TSS parity 백필.
 * 1) logs → rides upsert
 * 2) ranking_day_totals → daily_summaries (Stelvio 누락 보정)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-user-week-logs-to-supabase.js <uid> <startYmd> <endYmd>
 */
const admin = require('firebase-admin');
const path = require('path');

const uid = process.argv[2];
const startStr = (process.argv[3] || '').slice(0, 10);
const endStr = (process.argv[4] || startStr).slice(0, 10);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endStr) || !serviceKey) {
  console.error(
    'Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-user-week-logs-to-supabase.js <uid> <startYmd> [endYmd]'
  );
  process.exit(1);
}

const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
    projectId: 'stelvio-ai',
  });
}

const sb = require('../supabaseDualWriteServer');

(async function main() {
  const db = admin.firestore();
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://eacrwhtbdqanaxpicqsm.supabase.co';
  process.env.STELVIO_UID_NAMESPACE =
    process.env.STELVIO_UID_NAMESPACE || '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  process.env.STELVIO_UID_UUID_MODE = process.env.STELVIO_UID_UUID_MODE || 'v5';

  try {
    const provision = require('../supabaseUserProvision');
    await provision.provisionSupabaseUserAfterProfile(admin, uid);
  } catch (provErr) {
    console.warn('[backfill] provision skip:', provErr.message || provErr);
  }

  const parity = await sb.syncUsersWeeklyTssParityToSupabase(db, admin, [uid], startStr, endStr);
  console.log('[backfill] parity sync', { uid, startStr, endStr, ...parity });

  const rankingDayRollup = require('../rankingDayRollup');
  const userSnap = await db.collection('users').doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() : {};
  const firestoreTss = await rankingDayRollup.weeklyTssSumFromDayBuckets(
    db,
    uid,
    userData,
    startStr,
    endStr,
    true
  );
  console.log('[verify firestore ranking_day_totals weekly TSS]', firestoreTss);

  const supabase = sb.getSupabaseAdminClient();
  const { data: rows, error } = await supabase.rpc('fn_weekly_tss_leaderboard_live', {
    p_start: startStr,
    p_end: endStr,
  });
  if (error) {
    console.warn('[verify supabase weekly TSS] rpc error:', error.message || error);
    return;
  }
  const row = (rows || []).find((r) => String(r.firebase_uid || '') === uid);
  console.log('[verify supabase fn_weekly_tss_leaderboard_live]', {
    weekly_tss: row ? row.weekly_tss : null,
    found: !!row,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
