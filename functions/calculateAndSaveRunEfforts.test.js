/**
 * RUN 구간 피크 — 슬라이딩·단조 보정 단위 테스트
 * 실행: node functions/calculateAndSaveRunEfforts.test.js
 */
"use strict";

const {
  findFastestDistanceWindow,
  enforceMonotonicEffortSpeeds,
  elapsedForExactDistanceWindow,
} = require("./calculateAndSaveRunEfforts");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps || 0.01);
}

/** 균일 4:00/km 페이스 — 모든 구간 동일 속도 */
(function testUniformPace() {
  const paceSec = 240;
  const speed = 1000 / paceSec;
  const n = 500;
  const time = [];
  const distance = [];
  for (let i = 0; i < n; i++) {
    time.push(i * paceSec);
    distance.push(i * 1000);
  }
  const w3 = findFastestDistanceWindow(time, distance, null, 3000);
  const w5 = findFastestDistanceWindow(time, distance, null, 5000);
  assert(w3 && w5, "uniform: windows found");
  assert(approx(w3.speed, speed), "uniform 3k speed");
  assert(approx(w5.speed, speed), "uniform 5k speed");
  assert(w3.speed >= w5.speed - 0.001, "uniform: 3k not slower than 5k");
})();

/** 앞 1km 만 sprint — 단조 보정 전 역전, 보정 후 준수 */
(function testMonotonicEnforcement() {
  const row = {
    speed_1k: 4.0,
    speed_3k: 4.5,
    speed_5k: 4.2,
    speed_7k: 3.8,
    speed_10k: 3.5,
    speed_20k: null,
    speed_42k: null,
  };
  enforceMonotonicEffortSpeeds(row);
  assert(row.speed_3k === 4.0, "3k capped to 1k");
  assert(row.speed_5k === 4.0, "5k capped to chain");
  assert(row.speed_7k === 3.8, "7k unchanged");
  assert(row.speed_10k === 3.5, "10k unchanged");
  const order = ["1k", "3k", "5k", "7k", "10k"];
  for (let i = 1; i < order.length; i++) {
    const prev = row[`speed_${order[i - 1]}`];
    const curr = row[`speed_${order[i]}`];
    if (prev != null && curr != null) {
      assert(curr <= prev + 1e-9, `${order[i]} should not exceed ${order[i - 1]}`);
    }
  }
})();

/** 보간 elapsed: 정확 3000m 구간 */
(function testInterpolatedElapsed() {
  const time = [0, 100, 200, 400, 700];
  const distance = [0, 1000, 2000, 4000, 7000];
  const elapsed = elapsedForExactDistanceWindow(time, distance, 0, 3, 3000);
  assert(elapsed != null && elapsed > 0, "interpolated elapsed exists");
  const speed = 3000 / elapsed;
  assert(speed > 8 && speed < 12, "interpolated speed plausible");
})();

console.log("calculateAndSaveRunEfforts.test.js — all passed");
