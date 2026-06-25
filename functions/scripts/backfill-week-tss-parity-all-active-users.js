'use strict';

/**
 * 이번 주(또는 지정 구간) ranking_day_totals 활동 사용자 전원
 * Firestore → Supabase 주간 TSS parity (Strava 지연 수집·6/24 누락 일괄 보정).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-week-tss-parity-all-active-users.js [startYmd] [endYmd]
 */
const admin = require('firebase-admin');
const path = require('path');

const startStr = (process.argv[2] || '').slice(0, 10);
const endStr = (process.argv[3] || startStr).slice(0, 10);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!serviceKey) {
  console.error(
    'Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-week-tss-parity-all-active-users.js [startYmd] [endYmd]'
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

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://eacrwhtbdqanaxpicqsm.supabase.co';
process.env.STELVIO_UID_NAMESPACE =
  process.env.STELVIO_UID_NAMESPACE || '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
process.env.STELVIO_UID_UUID_MODE = process.env.STELVIO_UID_UUID_MODE || 'v5';

const sb = require('../supabaseDualWriteServer');

function getWeekRangeSeoulLocal() {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const [y, m, d] = todayStr.split('-').map(Number);
  const today = new Date(y, m - 1, d);
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    startStr: `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`,
    endStr: `${y}-${pad(m)}-${pad(d)}`,
  };
}

(async function main() {
  const db = admin.firestore();
  const range =
    /^\d{4}-\d{2}-\d{2}$/.test(startStr) && /^\d{4}-\d{2}-\d{2}$/.test(endStr)
      ? { startStr, endStr }
      : getWeekRangeSeoulLocal();

  console.log('[backfill-week-parity] range', range);
  const result = await sb.runWeeklyTssSupabaseParityForActiveUsers(
    db,
    admin,
    range.startStr,
    range.endStr
  );
  console.log('[backfill-week-parity] done', result);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
