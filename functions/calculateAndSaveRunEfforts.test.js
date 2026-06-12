/**
 * RUN 구간 피크 — 중첩 슬라이딩·단조 검증
 * 실행: node functions/calculateAndSaveRunEfforts.test.js
 */
"use strict";

const {
  findFastestDistanceWindow,
  findNestedEffortWindowsFromStreams,
  enforceMonotonicEffortSpeeds,
  effortSpeedsAreMonotonic,
  elapsedForExactDistanceWindow,
  paceSecPerKmFromSpeed,
  EFFORT_DISTANCE_ORDER,
} = require("./calculateAndSaveRunEfforts");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps || 0.01);
}

/** 균일 4:00/km — 중첩 탐색 페이스 단조 */
(function testNestedUniformPace() {
  const paceSec = 240;
  const speed = 1000 / paceSec;
  const n = 500;
  const time = [];
  const distance = [];
  for (let i = 0; i < n; i++) {
    time.push(i * paceSec);
    distance.push(i * 1000);
  }
  const row = findNestedEffortWindowsFromStreams(time, distance, null, 500000);
  assert(row.speed_1k != null && row.speed_3k != null, "nested: 1k/3k found");
  assert(effortSpeedsAreMonotonic(row), "nested uniform: pace monotonic");
  assert(approx(row.speed_3k, speed), "nested 3k speed");
})();

/** 앞 2km 느림·이후 빠름 — 독립 탐색 시 1k/3k 역전 가능, 중첩은 10k 윈도우 내에서만 탐색 */
(function testNestedVariablePace() {
  const n = 120;
  const time = [];
  const distance = [];
  for (let i = 0; i < n; i++) {
    distance.push(i * 1000);
    if (i <= 2) {
      time.push(i * 360);
    } else {
      time.push(720 + (i - 2) * 220);
    }
  }
  const totalM = distance[n - 1];
  const row = findNestedEffortWindowsFromStreams(time, distance, null, totalM);
  assert(row.speed_10k != null, "nested variable: 10k found");
  assert(effortSpeedsAreMonotonic(row), "nested variable: pace monotonic without cap");
  if (row.speed_1k != null && row.speed_3k != null) {
    assert(row.speed_1k >= row.speed_3k - 1e-9, "1k speed >= 3k speed");
  }
})();

/** 중첩 윈도우 포함 관계: 각 구간 [start,end] 가 상위 구간 안에 있어야 함 */
(function testNestedWindowContainment() {
  const n = 80;
  const time = [];
  const distance = [];
  for (let i = 0; i < n; i++) {
    distance.push(i * 1000);
    time.push(i * 250 + (i > 40 ? (i - 40) * 20 : 0));
  }
  const streams = { time, distance, heartrate: null };
  const clip = { lo: 0, hi: n - 1 };
  const windows = {};
  const order = ["42k", "20k", "10k", "7k", "5k", "3k", "1k"];
  const targets = { "1k": 1000, "3k": 3000, "5k": 5000, "7k": 7000, "10k": 10000, "20k": 20000, "42k": 42000 };
  for (const label of order) {
    const targetM = targets[label];
    if (distance[clip.hi] - distance[clip.lo] < targetM) continue;
    const w = findFastestDistanceWindow(time, distance, null, targetM, {
      indexLo: clip.lo,
      indexHi: clip.hi,
    });
    if (!w) continue;
    windows[label] = w;
    assert(w.start >= clip.lo && w.end <= clip.hi, label + " window inside clip");
    clip.lo = w.start;
    clip.hi = w.end;
  }
  assert(Object.keys(windows).length >= 2, "nested chain: at least 2 windows");
})();

/** 사후 캡 (활동 간 max 집계용 안전망) */
(function testMonotonicEnforcementFallback() {
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
  assert(effortSpeedsAreMonotonic(row), "after cap: monotonic");
})();

/** 보간 elapsed */
(function testInterpolatedElapsed() {
  const time = [0, 100, 200, 400, 700];
  const distance = [0, 1000, 2000, 4000, 7000];
  const elapsed = elapsedForExactDistanceWindow(time, distance, 0, 3, 3000);
  assert(elapsed != null && elapsed > 0, "interpolated elapsed exists");
  const speed = 3000 / elapsed;
  assert(speed > 8 && speed < 12, "interpolated speed plausible");
})();

/** 페이스 sec/km 단조 헬퍼 */
(function testPaceHelper() {
  const p1 = paceSecPerKmFromSpeed(4);
  const p3 = paceSecPerKmFromSpeed(3.5);
  assert(p1 < p3, "faster speed → lower pace sec/km");
})();

console.log("calculateAndSaveRunEfforts.test.js — all passed");
