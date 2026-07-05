'use strict';

/**
 * refresh_token 무효 사용자 일괄 처리 — 재시도 루프 중단 + strava_auth_invalid
 *   node scripts/mark-strava-auth-invalid-bulk.js
 */
const admin = require('firebase-admin');
const path = require('path');
const stravaSyncRetry = require('../stravaSyncRetry');

const keyPath = path.join(__dirname, 'serviceAccountKey.json');

/** API 검증으로 refresh_token invalid 확인된 14명 (윤중헌 제외 — 이미 처리됨) */
const TARGET_UIDS = [
  '7AVN7Iu3P5gYfAjx2y0KP3D1YbC3',
  'rJd8628kBqZkE3tS7bRiWcUHbC63',
  'doWUroCo9iZAs1PlrOhCJs9QPT62',
  'EPnZZuuYDUSf0Xxisj7XatgD0462',
  'acuQzf2SHcTtcyAnZRfDyoAvqoW2',
  'eYq9lu2kSqd24tbKiLYyfAP3yiR2',
  'YmuUizlVmtRFxm2RjujS5VBL8Us2',
  'kOWTJTwoYVVkNuHf2vlZipgPDjK2',
  'KhFt9IKIlDOEgCP520S3riM2f3q2',
  'VoYDV8N57hMO3s3CQeXhzSYK2iZ2',
  'y3XlmF1ruwaHsfy5Ilchrnlc2kr1',
  'Y9JOTYVXikRo7bo1zFbun37TlYK2',
  'Adc0R5SVXSY2LBOTGUKjgQT6BGY2',
  'gXeaWM4EOMUQvtqmpD00hsZeHng2',
];

function nextDayYmd(ymd) {
  const s = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

async function getLastStravaLogDate(db, userId) {
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('logs')
    .where('source', '==', 'strava')
    .limit(200)
    .get();
  let maxDate = '';
  snap.docs.forEach((doc) => {
    const dt = String((doc.data() || {}).date || '').slice(0, 10);
    if (dt > maxDate) maxDate = dt;
  });
  return maxDate;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
    projectId: 'stelvio-ai',
  });
}

(async function main() {
  const db = admin.firestore();
  const results = [];
  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const uid of TARGET_UIDS) {
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) {
        results.push({ uid, status: 'not_found' });
        fail += 1;
        continue;
      }
      const u = snap.data() || {};
      if (u.strava_auth_invalid === true && u.strava_sync_retry_pending === false) {
        results.push({
          uid,
          name: u.name || u.user_name || '',
          status: 'already_marked',
          strava_sync_retry_attempts: u.strava_sync_retry_attempts || 0,
        });
        skip += 1;
        continue;
      }
      const lastLog = await getLastStravaLogDate(db, uid);
      const since = nextDayYmd(lastLog) || lastLog || undefined;
      await stravaSyncRetry.markStravaAuthInvalid(db, uid, {
        reason: 'manual_api_verify',
        error: u.strava_last_activity_fetch_error || 'bulk_mark_refresh_token_invalid',
        since,
        evidence: {
          httpStatus: 400,
          tokenData: {
            message: 'Bad Request',
            errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }],
          },
          errorText: u.strava_last_activity_fetch_error || 'bulk_mark_refresh_token_invalid',
        },
      });
      const after = (await db.collection('users').doc(uid).get()).data() || {};
      results.push({
        uid,
        name: after.name || after.user_name || '',
        status: 'marked',
        last_strava_log_date: lastLog || null,
        auth_invalid_since: since || null,
        strava_auth_invalid: after.strava_auth_invalid === true,
        strava_sync_retry_pending: after.strava_sync_retry_pending === true,
        strava_sync_retry_attempts: Number(after.strava_sync_retry_attempts) || 0,
      });
      ok += 1;
    } catch (e) {
      results.push({ uid, status: 'error', error: e && e.message ? e.message : String(e) });
      fail += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        total: TARGET_UIDS.length,
        marked: ok,
        skipped: skip,
        failed: fail,
        users: results,
      },
      null,
      2
    )
  );
  if (fail > 0) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
