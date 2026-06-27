'use strict';

/**
 * 특정 날짜 Strava 라이딩 → Supabase rides 백필 (Firestore fallback·배치 누락 보정).
 *
 * 1) Firestore users/{uid}/logs (source=strava) → Supabase rides upsert
 * 2) (--refetch-strava) Strava API 재수집 → Supabase primary (Phase 4)
 * 3) daily_summaries TSS parity 동기화
 *
 * Usage:
 *   # .env 또는 환경변수에 SUPABASE_SERVICE_ROLE_KEY 필요
 *   node scripts/backfill-strava-supabase-for-date.js 2026-06-27
 *   node scripts/backfill-strava-supabase-for-date.js 2026-06-27 --refetch-strava
 *   node scripts/backfill-strava-supabase-for-date.js 2026-06-27 --uid=Ys8GQZYyf3ZoEunSVGKnWNbtSkv2
 *   node scripts/backfill-strava-supabase-for-date.js 2026-06-27 --dry-run
 *
 * Secrets (택1):
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/...
 *   functions/.env.local 에 SUPABASE_SERVICE_ROLE_KEY=... 저장 후 실행
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const PROJECT_ID = 'stelvio-ai';
const SCRIPTS_DIR = __dirname;
const FUNCTIONS_DIR = path.join(SCRIPTS_DIR, '..');
const DEFAULT_KEY_PATH = path.join(SCRIPTS_DIR, 'serviceAccountKey.json');
const ENV_PATHS = [
  path.join(FUNCTIONS_DIR, '.env.local'),
  path.join(FUNCTIONS_DIR, '.env'),
  path.join(FUNCTIONS_DIR, '.env.stelvio-ai'),
];

function loadLocalEnvFiles() {
  for (const filePath of ENV_PATHS) {
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] == null) process.env[key] = val;
    }
  }
}

function parseArgs(argv) {
  const flags = {
    dryRun: false,
    refetchStrava: false,
    skipParity: false,
    uid: '',
  };
  let dateYmd = '';
  for (const arg of argv) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      dateYmd = arg;
      continue;
    }
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (arg === '--refetch-strava') {
      flags.refetchStrava = true;
      continue;
    }
    if (arg === '--skip-parity') {
      flags.skipParity = true;
      continue;
    }
    if (arg.startsWith('--uid=')) {
      flags.uid = arg.slice('--uid='.length).trim();
    }
  }
  return { dateYmd, flags };
}

loadLocalEnvFiles();

const { dateYmd, flags } = parseArgs(process.argv.slice(2));
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

process.env.SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://eacrwhtbdqanaxpicqsm.supabase.co';
process.env.STELVIO_UID_NAMESPACE =
  process.env.STELVIO_UID_NAMESPACE || '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
process.env.STELVIO_UID_UUID_MODE = process.env.STELVIO_UID_UUID_MODE || 'v5';

if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
  console.error(
    'Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-strava-supabase-for-date.js YYYY-MM-DD [--refetch-strava] [--uid=firebaseUid] [--dry-run] [--skip-parity]'
  );
  process.exit(1);
}

if (!serviceKey) {
  console.error('[backfill] SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  console.error('  firebase functions:secrets:access SUPABASE_SERVICE_ROLE_KEY');
  console.error('  또는 functions/.env.local 에 SUPABASE_SERVICE_ROLE_KEY=... 저장');
  process.exit(1);
}

if (!admin.apps.length) {
  if (!fs.existsSync(DEFAULT_KEY_PATH)) {
    console.error('serviceAccountKey.json not found:', DEFAULT_KEY_PATH);
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.cert(require(DEFAULT_KEY_PATH)),
    projectId: PROJECT_ID,
  });
}

const sb = require('../supabaseDualWriteServer');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @returns {Promise<import('firebase-admin').firestore.QueryDocumentSnapshot[]>} */
async function collectFirestoreStravaLogsForDate(db, uid, dateYmdArg) {
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
      .where('date', '>=', dateYmdArg)
      .where('date', '<=', dateYmdArg)
      .get();
    collect(rangedStr);
  } catch (e) {
    console.warn('[backfill] string date query', uid, e.message || e);
  }

  try {
    const tsStart = admin.firestore.Timestamp.fromDate(
      new Date(`${dateYmdArg}T00:00:00+09:00`)
    );
    const tsEnd = admin.firestore.Timestamp.fromDate(
      new Date(`${dateYmdArg}T23:59:59.999+09:00`)
    );
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
    console.warn('[backfill] timestamp date query', uid, e.message || e);
  }

  return logDocs;
}

async function listSupabaseStravaActivityIdsForDate(firebaseUid, dateYmdArg) {
  const supabase = sb.getSupabaseAdminClient();
  const uidConfig = {
    uidNamespace: process.env.STELVIO_UID_NAMESPACE,
    uidMode: process.env.STELVIO_UID_UUID_MODE,
  };
  const userId = await sb.resolveRideUserIdForFirebaseUid(
    supabase,
    firebaseUid,
    uidConfig
  );
  if (!userId) return { userId: null, ids: new Set() };

  const { data, error } = await supabase
    .from('rides')
    .select('activity_id, title, tss')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .eq('ride_date', dateYmdArg);
  if (error) throw error;

  const ids = new Set();
  for (const row of data || []) {
    const id = String(row.activity_id || '').trim();
    if (id) ids.add(id);
  }
  return { userId, ids, rows: data || [] };
}

async function ensureSupabaseUserProvision(adminApp, uid) {
  try {
    const provision = require('../supabaseUserProvision');
    await provision.provisionSupabaseUserAfterProfile(adminApp, uid);
  } catch (provErr) {
    console.warn('[backfill] provision skip:', uid, provErr.message || provErr);
  }
}

async function mirrorFirestoreLogsToSupabase(db, adminApp, uid, logDocs, dryRun) {
  let mirrored = 0;
  let skipped = 0;
  let failed = 0;

  for (const logDoc of logDocs) {
    const data = logDoc.data() || {};
    const actId = String(data.activity_id || logDoc.id);
    if (dryRun) {
      console.log('[dry-run mirror]', uid, actId, data.title || '');
      mirrored += 1;
      continue;
    }
    try {
      const result = await sb.runSecondaryAfterStravaLogSave(
        adminApp,
        uid,
        logDoc.id,
        data,
        { force: true }
      );
      if (result && result.skipped) {
        skipped += 1;
        console.warn('[mirror skipped]', uid, actId, result.reason);
      } else {
        mirrored += 1;
        console.log('[mirror ok]', uid, actId, data.title || '', 'tss=', data.tss);
      }
    } catch (e) {
      failed += 1;
      console.warn('[mirror fail]', uid, actId, e.message || e);
    }
  }

  return { mirrored, skipped, failed };
}

async function refetchStravaForUser(db, index, uid, userData, dateYmdArg, dryRun) {
  if (dryRun) {
    console.log('[dry-run refetch]', uid, dateYmdArg);
    return { processed: 0, newActivities: 0, dryRun: true };
  }

  const startSeoul = new Date(`${dateYmdArg}T00:00:00+09:00`);
  const endSeoul = new Date(`${dateYmdArg}T23:59:59.999+09:00`);
  const afterUnix = Math.floor(startSeoul.getTime() / 1000);
  const beforeUnix = Math.floor(endSeoul.getTime() / 1000);

  if (typeof index.processOneUserStravaSync !== 'function') {
    throw new Error('processOneUserStravaSync not exported from index.js');
  }

  return index.processOneUserStravaSync(db, uid, userData, {
    afterUnix,
    beforeUnix,
    dateFrom: dateYmdArg,
    dateTo: dateYmdArg,
  });
}

(async function main() {
  const db = admin.firestore();
  const index = require('../index.js');

  console.log('[backfill] start', {
    dateYmd,
    dryRun: flags.dryRun,
    refetchStrava: flags.refetchStrava,
    uidFilter: flags.uid || '(all strava-connected)',
    skipParity: flags.skipParity,
  });

  let userDocs;
  if (flags.uid) {
    const snap = await db.collection('users').doc(flags.uid).get();
    if (!snap.exists) throw new Error('user not found: ' + flags.uid);
    userDocs = [snap];
  } else {
    const usersSnap = await db
      .collection('users')
      .where('strava_refresh_token', '!=', '')
      .get();
    userDocs = usersSnap.docs;
  }

  const summary = {
    dateYmd,
    users: userDocs.length,
    firestoreLogs: 0,
    mirrored: 0,
    mirrorSkipped: 0,
    mirrorFailed: 0,
    refetchedUsers: 0,
    refetchNewActivities: 0,
    refetchErrors: 0,
    stillMissing: [],
    parity: null,
  };

  const userIdsTouched = [];

  for (let i = 0; i < userDocs.length; i += 1) {
    const userDoc = userDocs[i];
    const uid = userDoc.id;
    const userData = userDoc.data() || {};

    if (!flags.dryRun) {
      await ensureSupabaseUserProvision(admin, uid);
    }

    const logDocs = await collectFirestoreStravaLogsForDate(db, uid, dateYmd);
    summary.firestoreLogs += logDocs.length;

    if (logDocs.length > 0) {
      userIdsTouched.push(uid);
      const mirror = await mirrorFirestoreLogsToSupabase(
        db,
        admin,
        uid,
        logDocs,
        flags.dryRun
      );
      summary.mirrored += mirror.mirrored;
      summary.mirrorSkipped += mirror.skipped;
      summary.mirrorFailed += mirror.failed;
    }

    const { ids: supabaseIds } = await listSupabaseStravaActivityIdsForDate(uid, dateYmd);
    const firestoreIds = new Set(
      logDocs.map((d) => String((d.data() || {}).activity_id || d.id))
    );

    const missingInSupabase = [...firestoreIds].filter((id) => !supabaseIds.has(id));
    const needsRefetch =
      flags.refetchStrava &&
      (logDocs.length === 0 || missingInSupabase.length > 0 || supabaseIds.size === 0);

    if (needsRefetch) {
      try {
        const refetchResult = await refetchStravaForUser(
          db,
          index,
          uid,
          userData,
          dateYmd,
          flags.dryRun
        );
        summary.refetchedUsers += 1;
        summary.refetchNewActivities += Number(refetchResult.newActivities) || 0;
        if (!userIdsTouched.includes(uid)) userIdsTouched.push(uid);
        console.log('[refetch]', uid, refetchResult);
      } catch (e) {
        summary.refetchErrors += 1;
        console.warn('[refetch fail]', uid, e.message || e);
      }
      if (i < userDocs.length - 1 && !flags.dryRun) {
        await sleep(400);
      }
    }

    if (!flags.dryRun) {
      const after = await listSupabaseStravaActivityIdsForDate(uid, dateYmd);
      const stillMissingIds = [...firestoreIds].filter((id) => !after.ids.has(id));
      if (stillMissingIds.length > 0) {
        summary.stillMissing.push({
          uid,
          name: userData.name || userData.user_name || '',
          missingActivityIds: stillMissingIds,
        });
      }
    }
  }

  if (!flags.skipParity && userIdsTouched.length > 0 && !flags.dryRun) {
    summary.parity = await sb.syncUsersWeeklyTssParityToSupabase(
      db,
      admin,
      userIdsTouched,
      dateYmd,
      dateYmd
    );
  }

  console.log('[backfill] done', JSON.stringify(summary, null, 2));

  if (summary.stillMissing.length > 0) {
    console.warn(
      '[backfill] Supabase에 아직 없는 Firestore Strava 로그:',
      summary.stillMissing.length,
      'users'
    );
    process.exitCode = 2;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
