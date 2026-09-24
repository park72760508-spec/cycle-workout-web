'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeStepAchievement,
  rankMissionUsers,
  segmentTargetFtpPct,
  wkgFactor,
} = require('./clubMissionScoring');

/** 워밍업 10분(50%) · 인터벌 5분(100%) · 휴식 3분(50%) · 인터벌 5분(100%) · 쿨다운 10분(40%) */
const SEGS = [
  { segment_type: 'warmup', duration_sec: 600, target_type: 'ftp_pct', target_value: '50' },
  { segment_type: 'interval', duration_sec: 300, target_type: 'ftp_pct', target_value: '100' },
  { segment_type: 'rest', duration_sec: 180, target_type: 'ftp_pct', target_value: '50' },
  { segment_type: 'interval', duration_sec: 300, target_type: 'ftp_pct', target_value: '100' },
  { segment_type: 'cooldown', duration_sec: 600, target_type: 'ftp_pct', target_value: '40' },
];

test('W/kg 가중치: 2.0 이하 0.8, 3.0 → 0.9, 4.0 이상 1.0', () => {
  assert.equal(wkgFactor(1.5), 0.8);
  assert.equal(wkgFactor(2.0), 0.8);
  assert.ok(Math.abs(wkgFactor(3.0) - 0.9) < 1e-9);
  assert.equal(wkgFactor(4.0), 1);
  assert.equal(wkgFactor(4.5), 1);
});

test('목표 FTP%: 일반·램프·구간(하한)·dual·케이던스', () => {
  assert.equal(segmentTargetFtpPct({ target_type: 'ftp_pct', target_value: '90' }), 90);
  assert.equal(segmentTargetFtpPct({ target_type: 'ftp_pct', target_value: '60', ramp: 'linear', ramp_to_value: 80 }), 70);
  assert.equal(segmentTargetFtpPct({ target_type: 'ftp_pctz', target_value: '56~75' }), 56);
  assert.equal(segmentTargetFtpPct({ target_type: 'dual', target_value: '100~120' }), 100);
  assert.ok(Number.isNaN(segmentTargetFtpPct({ target_type: 'cadence_rpm', target_value: '90' })));
});

test('워밍업·쿨다운·휴식은 제외하고 인터벌만 평가 (FTP 250W, 70kg)', () => {
  // 인터벌 목표 250W: 첫 인터벌 250W(100%), 두 번째 200W(80%) → 달성률 90%
  // 워밍업을 아무리 못 해도(0W) 점수에 영향 없음
  const r = computeStepAchievement(SEGS, [0, 250, 0, 200, 0], 250, 70);
  assert.equal(r.method, 'segments');
  assert.equal(r.intervalAchievement, 90);
  assert.equal(r.intervalAvgWatts, 225); // 3.21 W/kg
  assert.equal(r.wkg, 3.21);
  assert.equal(r.wkgFactor, 0.921);
  assert.equal(r.score, 82.9); // 90 × 0.921
});

test('목표 초과 수행은 세그먼트별 100% 상한', () => {
  const r = computeStepAchievement(SEGS, [0, 400, 0, 400, 0], 250, 70);
  assert.equal(r.intervalAchievement, 100);
  assert.equal(r.wkgFactor, 1); // 400W/70kg = 5.7 W/kg
  assert.equal(r.score, 100);
});

test('같은 달성률이면 W/kg 가 높을수록 점수 높음 (2.0 → 80%, 4.0 → 100%)', () => {
  const segs = [{ segment_type: 'interval', duration_sec: 600, target_type: 'ftp_pct', target_value: '100' }];
  const low = computeStepAchievement(segs, [140], 140, 70); // 2.0 W/kg, 100% 달성
  const high = computeStepAchievement(segs, [280], 280, 70); // 4.0 W/kg, 100% 달성
  assert.equal(low.score, 80);
  assert.equal(high.score, 100);
});

test('구간 파워가 없으면 전체 평균 파워로 대체 산출', () => {
  const r = computeStepAchievement(SEGS, null, 250, 70, 150);
  assert.equal(r.method, 'overall');
  assert.ok(r.score > 0 && r.score <= 100);
});

test('세그먼트·FTP 없으면 산출 불가(null)', () => {
  assert.equal(computeStepAchievement([], [100], 250, 70), null);
  assert.equal(computeStepAchievement(SEGS, [0, 250, 0, 200, 0], 0, 70), null);
});

test('순위 점수 = 40×수행률 + 60×(단계 점수 합 ÷ 전체 단계)', () => {
  const rows = rankMissionUsers(5, [
    { userId: 'steady', stepScores: [80, 80, 80, 80, 80], lastCompletedAt: '2026-10-20' }, // 40 + 48 = 88
    { userId: 'strong', stepScores: [100, 100, 100], lastCompletedAt: '2026-10-10' }, //       24 + 36 = 60
    { userId: 'one', stepScores: [100], lastCompletedAt: '2026-10-02' }, //                    8 + 12 = 20
  ]);
  assert.deepEqual(rows.map((r) => [r.userId, r.total, r.rank]), [
    ['steady', 88, 1],
    ['strong', 60, 2],
    ['one', 20, 3],
  ]);
  assert.equal(rows[0].completionRate, 100);
  assert.equal(rows[1].avgStepScore, 100);
});

test('동점이면 완료 수 → 평균 점수 → 먼저 끝낸 사람', () => {
  const rows = rankMissionUsers(4, [
    { userId: 'late', stepScores: [50, 50], lastCompletedAt: '2026-10-20' },
    { userId: 'early', stepScores: [50, 50], lastCompletedAt: '2026-10-05' },
  ]);
  assert.deepEqual(rows.map((r) => r.userId), ['early', 'late']);
});
