/**
 * fix-strava-tss.js
 * Strava TSS 일괄 재계산 스크립트 (관리자용)
 *
 * 사용법:
 *   cd functions
 *   node scripts/fix-strava-tss.js
 *     → 기본: 2026-05-09 ~ 2026-05-12, dryRun=true (미리보기)
 *
 *   node scripts/fix-strava-tss.js --apply
 *     → 실제 Firestore 데이터 정정
 *
 *   node scripts/fix-strava-tss.js --start=2026-05-01 --end=2026-05-12 --apply
 *     → 날짜 범위 지정 후 실제 정정
 *
 * 실행 전 준비:
 *   서비스 계정 키 파일 준비:
 *     Firebase Console → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성" → JSON 저장
 *     저장 경로(기본): functions/scripts/serviceAccountKey.json
 *
 *   -- 또는 키 경로를 직접 지정 --
 *   node scripts/fix-strava-tss.js --key=C:\path\to\serviceAccountKey.json
 */

'use strict';

const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

// ─── 설정 ────────────────────────────────────────────────────────────────────
const PROJECT_ID = 'stelvio-ai';

// CLI 인수 파싱
const args      = process.argv.slice(2);
const applyFlag = args.includes('--apply');
const startDate = (args.find(a => a.startsWith('--start=')) || '').replace('--start=', '') || '2026-05-09';
const endDate   = (args.find(a => a.startsWith('--end='))   || '').replace('--end=',   '') || '2026-05-12';
const dryRun    = !applyFlag;
const keyArg    = (args.find(a => a.startsWith('--key=')) || '').replace('--key=', '');

const STELVIO_RTSS_DEFAULT_WEIGHT_KG = 70;

// ─── Firebase Admin 초기화 ────────────────────────────────────────────────────
// 서비스 계정 키 파일 탐색 순서:
//   1) --key=경로 CLI 인수
//   2) scripts/serviceAccountKey.json (기본 위치)
//   3) 환경변수 GOOGLE_APPLICATION_CREDENTIALS (ADC)
const DEFAULT_KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const keyPath = keyArg || DEFAULT_KEY_PATH;

if (!admin.apps.length) {
  if (fs.existsSync(keyPath)) {
    const serviceAccount = require(keyPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId : PROJECT_ID,
    });
    console.log(`[인증] 서비스 계정 키 사용: ${keyPath}\n`);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ projectId: PROJECT_ID });
    console.log(`[인증] GOOGLE_APPLICATION_CREDENTIALS 환경변수 사용\n`);
  } else {
    console.error(`
[오류] 인증 파일을 찾을 수 없습니다.

해결 방법:
  1) Firebase Console → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성"
     다운로드한 JSON 파일을 아래 경로에 저장:
     ${DEFAULT_KEY_PATH}

  2) 또는 키 파일 경로를 직접 지정:
     node scripts/fix-strava-tss.js --key=C:\\path\\to\\serviceAccountKey.json
`);
    process.exit(1);
  }
}
const db = admin.firestore();

// ─── TSS 계산 함수 (수정된 버전) ──────────────────────────────────────────────
function calculateStelvioRevisedTSS(durationSec, avgPower, np, ftp, weight) {
  const d    = Number(durationSec);
  const npN  = Math.min(Number(np), 2500);          // 최대 2500W 클램프
  const ftpN = Number(ftp);
  const w    = Number(weight);
  const avgN = Math.min(Number(avgPower), 2500);
  if (!ftpN || !w || ftpN <= 0 || w <= 0) return 0;
  if (npN <= 0 || avgN <= 0) return 0;
  if (!d || d <= 0) return 0;
  const ifFactor  = npN / ftpN;
  const baseTSS   = ((d * npN * ifFactor) / (ftpN * 3600)) * 100;
  const totalKJ   = (avgN * d) / 1000;
  if (totalKJ <= 0) return 0;
  const wPerKg    = ftpN / w;
  let wFactor     = Math.pow(3.0 / wPerKg, 0.15);
  wFactor         = Math.max(0.8, Math.min(1.2, wFactor));
  let adjustedTSS = baseTSS * wFactor;
  // TSS/kJ 상한: 1.5 TSS/kJ (모든 wPerKg 범위 통일 적용)
  if (adjustedTSS / totalKJ > 1.5) adjustedTSS = totalKJ * 1.5;
  // 단일 세션 절대 상한: 500 TSS
  if (adjustedTSS > 500) adjustedTSS = 500;
  return Math.round(adjustedTSS * 10) / 10;
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('========================================================');
  console.log(' Strava TSS 일괄 재계산 스크립트');
  console.log(`  프로젝트  : ${PROJECT_ID}`);
  console.log(`  대상 기간 : ${startDate} ~ ${endDate}`);
  console.log(`  모드      : ${dryRun ? '미리보기 (DRY RUN) — Firestore 쓰기 없음' : '⚠️  실제 정정 (APPLY)'}`);
  console.log('========================================================\n');

  // 사용자 목록 조회
  console.log('사용자 목록 조회 중...');
  const usersSnap = await db.collection('users').get();
  console.log(`  총 ${usersSnap.size}명\n`);

  const results = { total: 0, updated: 0, skipped: 0, errors: 0 };
  const changed = [];

  for (const userDoc of usersSnap.docs) {
    const userId   = userDoc.id;
    const userData = userDoc.data() || {};
    const weightKg = Number(userData.weight) > 0   ? Number(userData.weight)
                   : Number(userData.weightKg) > 0  ? Number(userData.weightKg)
                   : STELVIO_RTSS_DEFAULT_WEIGHT_KG;

    let logsSnap;
    try {
      logsSnap = await db.collection('users').doc(userId).collection('logs')
        .where('source', '==', 'strava')
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();
    } catch (e) {
      results.errors++;
      console.error(`  [오류] 사용자 ${userId}: ${e.message}`);
      continue;
    }
    if (logsSnap.empty) continue;

    let batch     = db.batch();
    let batchCnt  = 0;

    for (const logDoc of logsSnap.docs) {
      results.total++;
      const log = logDoc.data() || {};

      const durationSec   = Number(log.duration_sec || log.time) || 0;
      const avgWatts      = log.avg_watts      != null ? Number(log.avg_watts)      : null;
      const weightedWatts = log.weighted_watts != null ? Number(log.weighted_watts) : null;
      const ftpAtTime     = Number(log.ftp_at_time) || 0;
      const oldTss        = Number(log.tss) || 0;

      // 재계산 불가: 필수 데이터 없음
      if (durationSec <= 0 || ftpAtTime <= 0) { results.skipped++; continue; }
      const np = weightedWatts != null ? weightedWatts : (avgWatts != null ? avgWatts : 0);
      const avgForTss = (avgWatts != null && avgWatts > 0) ? avgWatts : np;
      if (np <= 0 || avgForTss <= 0) { results.skipped++; continue; }

      const newTss = Math.max(0, calculateStelvioRevisedTSS(durationSec, avgForTss, np, ftpAtTime, weightKg));

      // 변경 없으면 건너뜀
      if (Math.abs(newTss - oldTss) < 0.05) { results.skipped++; continue; }

      results.updated++;
      changed.push({
        userId,
        logId : logDoc.id,
        date  : log.date || '',
        oldTss,
        newTss,
        np    : Math.round(np),
        ftp   : ftpAtTime,
        durationSec,
      });

      if (!dryRun) {
        batch.update(logDoc.ref, {
          tss                : newTss,
          tss_recalculated_at: new Date().toISOString(),
        });
        batchCnt++;
        if (batchCnt >= 400) {
          await batch.commit();
          batch    = db.batch();
          batchCnt = 0;
        }
      }
    }

    if (!dryRun && batchCnt > 0) {
      await batch.commit();
    }
  }

  // ─── 결과 출력 ────────────────────────────────────────────────────────────
  console.log('\n========================================================');
  console.log(' 결과 요약');
  console.log(`  조회된 Strava 로그 : ${results.total}건`);
  console.log(`  변경 대상          : ${results.updated}건`);
  console.log(`  변경 없음(스킵)    : ${results.skipped}건`);
  console.log(`  오류               : ${results.errors}건`);
  if (dryRun) {
    console.log('\n  ※ DRY RUN — 실제 변경 없음. --apply 옵션으로 재실행하면 정정됩니다.');
  } else {
    console.log('\n  ✅ Firestore 업데이트 완료.');
  }
  console.log('========================================================\n');

  if (changed.length > 0) {
    console.log('변경 예정(또는 완료) 목록 (최대 50건):');
    console.log('날짜       | 사용자ID             | 로그ID               | 구TSS    → 신TSS  | NP(W) | FTP');
    console.log('-----------|----------------------|----------------------|-------------------|-------|----');
    changed.slice(0, 50).forEach(r => {
      console.log(
        `${r.date.padEnd(10)} | ${r.userId.slice(0,20).padEnd(20)} | ${r.logId.slice(0,20).padEnd(20)} | ` +
        `${String(r.oldTss).padStart(8)} → ${String(r.newTss).padStart(6)} | ${String(r.np).padStart(5)} | ${r.ftp}`
      );
    });
    if (changed.length > 50) {
      console.log(`  ... 외 ${changed.length - 50}건`);
    }
  } else {
    console.log('  변경 대상 로그 없음.');
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error('\n[치명적 오류]', e);
  process.exit(1);
});
