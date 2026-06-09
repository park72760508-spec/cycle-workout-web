'use strict';

const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const uid = process.argv[2];
const dateYmd = (process.argv[3] || '').slice(0, 10);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd) || !serviceKey) {
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-user-strava-to-supabase.js <uid> <YYYY-MM-DD>');
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

  const logsSnap = await db
    .collection('users')
    .doc(uid)
    .collection('logs')
    .where('date', '==', dateYmd)
    .where('source', '==', 'strava')
    .get();

  console.log('[backfill] strava logs=', logsSnap.size);
  for (const doc of logsSnap.docs) {
    const result = await sb.runSecondaryAfterStravaLogSave(admin, uid, doc.id, doc.data(), {
      force: true,
    });
    console.log('[backfill]', doc.id, result);
  }

  const supabase = createClient(process.env.SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ns = process.env.STELVIO_UID_NAMESPACE;
  const userUuid = sb.resolveUserUuid(uid, ns, 'v5');
  const { data, error } = await supabase
    .from('rides')
    .select('activity_id, ride_date, title, tss, max_hr_5sec')
    .eq('user_id', userUuid)
    .eq('ride_date', dateYmd);
  if (error) throw error;
  console.log('[verify supabase]', data);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
