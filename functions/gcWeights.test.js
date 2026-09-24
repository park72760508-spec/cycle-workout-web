'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GC_AXIS_KEYS,
  GC_AXIS_WEIGHTS,
  GC_AXIS_WEIGHT_LIST,
  computeGcWeightedScore,
  compareGcRows,
} = require('./gcWeights');
const heptagon = require('./heptagonCohortRanks');

/** 축 순서: max, 1min, 5min, 10min, 20min, 40min, 60min */
function row(userId, scores) {
  return { userId, positionScores100: scores, sumPositionScores: computeGcWeightedScore(scores) };
}

test('가중치: 7축, 총합 1.00, SQL fn_gc_axis_weights 와 같은 순서', () => {
  assert.deepEqual(GC_AXIS_KEYS, ['max', '1min', '5min', '10min', '20min', '40min', '60min']);
  assert.deepEqual(GC_AXIS_WEIGHT_LIST, [0.05, 0.1, 0.2, 0.15, 0.25, 0.15, 0.1]);
  const total = Object.values(GC_AXIS_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-12);
});

test('가중 합: 전 축 100점 → 100, 전 축 0점 → 0, 20분만 100점 → 25', () => {
  assert.equal(computeGcWeightedScore([100, 100, 100, 100, 100, 100, 100]), 100);
  assert.equal(computeGcWeightedScore([0, 0, 0, 0, 0, 0, 0]), 0);
  assert.equal(computeGcWeightedScore([0, 0, 0, 0, 100, 0, 0]), 25);
});

test('잘못된 입력은 null, 미측정(null/NaN) 축은 0점', () => {
  assert.equal(computeGcWeightedScore(null), null);
  assert.equal(computeGcWeightedScore([100, 100]), null);
  assert.equal(computeGcWeightedScore([100, null, 100, 100, 100, NaN, 100]), 75);
});

test('5명 정렬: 스프린터보다 20분·5분 강자가 위 (가중치 반영)', () => {
  const users = [
    row('sprinter', [100, 100, 20, 20, 20, 20, 20]), //  5+10+4+3+5+3+2 = 32
    row('climber', [20, 40, 90, 90, 100, 90, 80]), //   1+4+18+13.5+25+13.5+8 = 83
    row('allround', [80, 80, 80, 80, 80, 80, 80]), //  80
    row('tt', [10, 20, 70, 80, 90, 100, 100]), //      0.5+2+14+12+22.5+15+10 = 76
    row('newbie', [50, 50, 50, 0, 0, 0, 0]), //        2.5+5+10 = 17.5 (장시간 미측정 0점)
  ];
  assert.equal(users[0].sumPositionScores, 32);
  assert.equal(users[1].sumPositionScores, 83);
  assert.equal(users[3].sumPositionScores, 76);
  assert.equal(users[4].sumPositionScores, 17.5);

  const order = users.slice().sort(compareGcRows).map((u) => u.userId);
  assert.deepEqual(order, ['climber', 'allround', 'tt', 'sprinter', 'newbie']);

  // 균등 합(구 로직)에서는 allround(560) 가 climber(510) 보다 위 — 가중치로 순서가 뒤집히는지 확인
  const equalSum = (u) => u.positionScores100.reduce((a, b) => a + b, 0);
  assert.ok(equalSum(users[2]) > equalSum(users[1]));
});

test('동점 처리: GC 같으면 20분 → 5분 → userId 순', () => {
  // 둘 다 GC 50: a 는 20분 60, b 는 20분 40
  const a = { userId: 'b-user', sumPositionScores: 50, positionScores100: [0, 0, 50, 0, 60, 0, 0] };
  const b = { userId: 'a-user', sumPositionScores: 50, positionScores100: [0, 0, 50, 0, 40, 0, 0] };
  assert.deepEqual([b, a].sort(compareGcRows).map((u) => u.userId), ['b-user', 'a-user']);

  // 20분도 같으면 5분
  const c = { userId: 'c', sumPositionScores: 50, positionScores100: [0, 0, 70, 0, 60, 0, 0] };
  assert.deepEqual([a, c].sort(compareGcRows).map((u) => u.userId), ['c', 'b-user']);

  // 모두 같으면 userId
  const d = { userId: 'a-dup', sumPositionScores: 50, positionScores100: [0, 0, 50, 0, 60, 0, 0] };
  assert.deepEqual([a, d].sort(compareGcRows).map((u) => u.userId), ['a-dup', 'b-user']);
});

test('computePTotalAndTierHeptagon: 순위 → 축 점수 → 가중 합 (미측정 축 0점)', () => {
  const n = [11, 11, 11, 11, 11, 11, 11];
  // 전 축 1위 → 100점
  const top = heptagon.computePTotalAndTierHeptagon([1, 1, 1, 1, 1, 1, 1], n);
  assert.equal(top.sumPositionScores, 100);
  assert.equal(top.avgPositionScore, 100);
  assert.equal(top.comprehensiveRankSynthetic, 1);

  // 20분만 1위, 나머지 꼴찌(11위) → 25점
  const only20 = heptagon.computePTotalAndTierHeptagon([11, 11, 11, 11, 1, 11, 11], n);
  assert.equal(only20.sumPositionScores, 25);

  // 40·60분 미측정(rank null) → 해당 축 0점, 나머지 6위(50점)
  const missing = heptagon.computePTotalAndTierHeptagon([6, 6, 6, 6, 6, null, null], n);
  assert.deepEqual(missing.positionScores100, [50, 50, 50, 50, 50, 0, 0]);
  assert.equal(missing.sumPositionScores, 37.5); // 50 × 0.75
});

test('comprehensiveRankFromGcScore: 0~100 스케일', () => {
  assert.equal(heptagon.comprehensiveRankFromGcScore(100, 21), 1);
  assert.equal(heptagon.comprehensiveRankFromGcScore(0, 21), 21);
  assert.equal(heptagon.comprehensiveRankFromGcScore(50, 21), 11);
  assert.equal(heptagon.comprehensiveRankFromGcScore(80, 1), 1);
});

test('rerankGcBoardRows: 점수 동점이면 집계 순위(board rank) 유지', () => {
  const rows = [
    { userId: 'z', gcScore: 60, rank: 1 },
    { userId: 'a', gcScore: 60, rank: 2 },
    { userId: 'm', gcScore: 70, rank: 3 },
  ];
  const out = heptagon.rerankGcBoardRows(rows).map((r) => r.userId);
  assert.deepEqual(out, ['m', 'z', 'a']);
});
