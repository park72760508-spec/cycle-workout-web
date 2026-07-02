'use strict';

/**
 * Strava 애플리케이션(client_id) 활성 상태 점검 스크립트.
 *
 * 배경: Strava 개발자 프로그램 정책상 앱이 비활성/미승인이면 모든 사용자 호출이
 * 403 {"resource":"Application","field":"Status","code":"Inactive"} 로 실패한다.
 * 이는 특정 사용자 문제가 아닌 앱 레벨 공통 장애이므로, 여러 사용자 토큰으로
 * athlete/activities 를 호출해 앱이 활성 상태인지 한 번에 확인한다.
 *
 * 사용법:  node scripts/check-strava-app-status.js [샘플수(기본 8)]
 * 재활성화 이후 이 스크립트가 전부 200을 반환하면 스케줄 동기화가 자동 복구한다.
 */

const admin = require('firebase-admin');
const path = require('path');

const PROJECT_ID = 'stelvio-ai';
const DEFAULT_KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const SAMPLE = Math.max(1, Math.min(30, Number(process.argv[2]) || 8));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(DEFAULT_KEY_PATH)),
    projectId: PROJECT_ID,
  });
}
const db = admin.firestore();

async function stravaGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 200), usage: res.headers.get('x-ratelimit-usage') };
}

(async function main() {
  const snap = await db.collection('users').where('strava_refresh_token', '>', '').limit(5000).get();
  const nowSec = Math.floor(Date.now() / 1000);
  // access token이 아직 유효한 유저만 사용 (토큰 갱신 없이 앱 상태만 확인)
  const candidates = [];
  snap.docs.forEach((d) => {
    const u = d.data() || {};
    if (u.strava_access_token && Number(u.strava_expires_at || 0) > nowSec + 60) {
      candidates.push({
        uid: d.id,
        name: String(u.name || u.user_name || ''),
        token: u.strava_access_token,
        athlete: u.strava_athlete_id,
      });
    }
  });
  console.log('연동 사용자:', snap.size, '| 유효 access token 보유:', candidates.length);
  const sample = candidates.slice(0, SAMPLE);
  let inactive = 0;
  let ok = 0;
  let other = 0;
  console.log('\n=== 사용자별 athlete/activities 호출 ===');
  for (const c of sample) {
    const r = await stravaGet('https://www.strava.com/api/v3/athlete/activities?per_page=1', c.token);
    const isInactive = r.text.toLowerCase().includes('inactive');
    if (r.status === 200) ok += 1;
    else if (isInactive) inactive += 1;
    else other += 1;
    console.log(
      `  ${String(c.name).padEnd(12)} athlete=${c.athlete} status=${r.status} ${r.status !== 200 ? r.text : 'OK'}`
    );
    await new Promise((res) => setTimeout(res, 1200));
  }
  const verdict =
    inactive === sample.length
      ? 'APP_INACTIVE (앱 비활성 — https://www.strava.com/settings/api 에서 재활성화/티어 승인 필요)'
      : ok === sample.length
        ? 'APP_ACTIVE (정상)'
        : 'MIXED (일부 실패 — 개별 토큰/권한 점검 필요)';
  console.log('\n=== 판정 ===');
  console.log(JSON.stringify({ tested: sample.length, ok, application_inactive: inactive, other, verdict }, null, 2));
})().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
