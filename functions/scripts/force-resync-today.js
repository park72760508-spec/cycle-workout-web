'use strict';

/**
 * 오늘(서울 기준, 기본값) 누락된 Strava 라이딩 활동을 전체 연동 사용자 대상으로 강제 재수집.
 *
 * - 프로덕션 배치 경로(index.runStravaSyncForRange)를 그대로 재사용 →
 *   Strava fetch → Firestore logs + Supabase rides dual-write → Supabase TSS parity → 마일리지 정산까지 스케줄러와 동일.
 * - 이미 있는 활동은 신규로 중복 생성하지 않고(MMP 보강), 누락된 것만 신규 수집됨.
 * - 앱 비활성으로 갇혔던 strava_sync_retry_pending 도 성공 시 자동 해제됨.
 *
 * 사용법:
 *   node scripts/force-resync-today.js            # 오늘(서울)
 *   node scripts/force-resync-today.js 2026-07-02 # 특정 날짜
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const PROJECT_ID = 'stelvio-ai';
const DEFAULT_KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const MIGRATION_ENV_PATH = path.join(__dirname, '..', '..', 'supabase', 'migration', '.env');

/** supabase/migration/.env 에서 Supabase 자격증명 로드 (하드코딩 회피) */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
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

function todaySeoulYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

loadEnvFile(MIGRATION_ENV_PATH);
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://eacrwhtbdqanaxpicqsm.supabase.co';
process.env.STELVIO_UID_NAMESPACE =
  process.env.STELVIO_UID_NAMESPACE || '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
process.env.STELVIO_UID_UUID_MODE = process.env.STELVIO_UID_UUID_MODE || 'v5';

const dateYmd = (process.argv[2] || todaySeoulYmd()).slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
  console.error('Usage: node scripts/force-resync-today.js [YYYY-MM-DD]');
  process.exit(1);
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY 미설정 (supabase/migration/.env 확인)');
  process.exit(1);
}

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

const index = require('../index.js');

function kst(d) {
  return new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

(async function main() {
  const db = admin.firestore();
  const startSeoul = new Date(`${dateYmd}T00:00:00+09:00`);
  const endSeoul = new Date(`${dateYmd}T23:59:59.999+09:00`);
  const afterUnix = Math.floor(startSeoul.getTime() / 1000);
  const beforeUnix = Math.floor(endSeoul.getTime() / 1000);

  console.log('==============================================');
  console.log('[force-resync] 대상 날짜 :', dateYmd, '(Asia/Seoul)');
  console.log('[force-resync] 구간      :', afterUnix, '~', beforeUnix);
  console.log('[force-resync] 시작 시각 :', kst(Date.now()));
  console.log('==============================================');

  if (typeof index.runStravaSyncForRange !== 'function') {
    throw new Error('runStravaSyncForRange not exported from index.js (배포 전이면 최신 코드로 갱신 필요)');
  }

  // 전체 연동 사용자 대상 (userIdsFilter 미지정 → strava_refresh_token 있는 전원)
  const summary = await index.runStravaSyncForRange(
    db,
    { afterUnix, beforeUnix, dateFrom: dateYmd, dateTo: dateYmd },
    '[force-resync-' + dateYmd + ']'
  );

  // 재수집 후 Firestore/Supabase 반영 확인
  let supabaseCount = null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(
      String(process.env.SUPABASE_URL).trim(),
      String(process.env.SUPABASE_SERVICE_ROLE_KEY).trim()
    );
    const { count, error } = await sb
      .from('rides')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'strava')
      .eq('ride_date', dateYmd);
    if (!error) supabaseCount = count;
    else console.warn('[force-resync] supabase count error:', error.message);
  } catch (e) {
    console.warn('[force-resync] supabase count skip:', e.message || e);
  }

  // 베드로 개별 확인
  let bedro = null;
  try {
    const bedroUid = 'qlvTO9eGL2Za4Pi8o5V0skegFOC2';
    const bs = await db.collection('users').doc(bedroUid).get();
    const bu = bs.exists ? bs.data() || {} : {};
    const bl = await db
      .collection('users')
      .doc(bedroUid)
      .collection('logs')
      .where('date', '==', dateYmd)
      .where('source', '==', 'strava')
      .get();
    bedro = {
      strava_sync_retry_pending: bu.strava_sync_retry_pending || false,
      strava_sync_retry_reason: bu.strava_sync_retry_reason || null,
      today_strava_logs: bl.size,
      logs: bl.docs.map((d) => ({ id: d.id, title: d.data().title, tss: d.data().tss })),
    };
  } catch (e) {
    bedro = { error: e.message || String(e) };
  }

  console.log('\n==================== 결과 요약 ====================');
  console.log(JSON.stringify({ date: dateYmd, summary, supabase_rides_today: supabaseCount, bedro }, null, 2));
  console.log('[force-resync] 종료 시각 :', kst(Date.now()));
})().catch((e) => {
  console.error('[force-resync] FATAL:', e);
  process.exit(1);
});
