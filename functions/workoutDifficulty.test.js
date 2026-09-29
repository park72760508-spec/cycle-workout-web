const test = require('node:test');
const assert = require('node:assert');
const { computeWorkoutDifficulty } = require('../assets/js/workoutDifficulty.js');

const P = (d, v, t = 'ftp_pct') => ({ duration_sec: d, target_value: String(v), target_type: t });
const rep = (n, arr) => Array.from({ length: n }).flatMap(() => arr);

test('기초 지구력(65%) 50분 = 별 1개', () => {
  assert.equal(computeWorkoutDifficulty([P(600, 50), P(2100, 65), P(300, 40)]).stars, 1);
});

test('템포 2x20(83%) = 별 2개', () => {
  const r = computeWorkoutDifficulty([P(720, 50), P(1200, 83), P(300, 45), P(1200, 83), P(300, 45), P(480, 45)]);
  assert.equal(r.stars, 2);
});

test('스위트스팟 2x15(90%) = 별 3개', () => {
  const r = computeWorkoutDifficulty([P(720, 50), P(900, 90), P(300, 45), P(900, 90), P(300, 45), P(480, 50)]);
  assert.equal(r.stars, 3);
});

test('역치 2x20(100%) = 별 4개', () => {
  const r = computeWorkoutDifficulty([P(900, 55), P(1200, 100), P(300, 50), P(1200, 100), P(600, 45)]);
  assert.equal(r.stars, 4);
});

test('VO2max 6x5(118%) + 역치 2x10 = 별 5개', () => {
  const r = computeWorkoutDifficulty([P(900, 55), ...rep(6, [P(300, 118), P(180, 50)]), ...rep(2, [P(600, 100), P(180, 50)]), P(600, 45)]);
  assert.equal(r.stars, 5);
});

test('세그먼트 없으면 null', () => {
  assert.equal(computeWorkoutDifficulty([]), null);
});
