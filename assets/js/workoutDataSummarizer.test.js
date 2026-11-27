'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./workoutDataSummarizer.js');
const P = require('./workoutSummaryParser.js');

const SAMPLE = '워밍업 80RPM FTP 70% 05:00 인터벌 FTP 120% 00:20 휴식 FTP 55% 00:40 반복 2회 01:00 휴식 FTP 50% 03:00 인터벌 FTP 92% 10:00 휴식 FTP 50% 04:00 반복 3회 14:00 쿨다운 FTP 50% 05:00';

test('예시: Sweet Spot, 57분, 오프너 제외, 요약 표현 일치', () => {
  const r = S.summarize(SAMPLE);
  assert.equal(r.ok, true);
  assert.equal(r.category, 'Sweet Spot');
  assert.equal(r.summary, 'WU 5m@70% | 2 X (20s@120% + 40s@55%) + 3m@50% + 3 X (10m@92% + 4m@50%) | CD 5m@50%');
  assert.match(r.text, /약 57분/);
  assert.match(r.text, /FTP 92%로 10분씩 3번/);
  assert.match(r.text, /오프너/);
});

test('요약 표현은 세그먼트 파서가 그대로 읽고 총 시간이 같다', () => {
  const r = S.summarize(SAMPLE);
  const p = P.parse(r.summary);
  assert.equal(p.ok, true);
  assert.equal(p.segments.reduce((n, s) => n + s.durationSec, 0), r.totalSec);
});

test('중첩 반복은 바깥쪽 [ ], 30/15 마이크로 인터벌은 VO2 Max', () => {
  const t = '워밍업 FTP 70% 05:00 인터벌 FTP 115% 00:30 휴식 FTP 50% 00:15 반복 10회 00:45 휴식 FTP 50% 02:30 반복 3회 10:00 쿨다운 FTP 50% 05:00';
  const r = S.summarize(t);
  assert.equal(r.summary, 'WU 5m@70% | 3 X [10 X (30s@115% + 15s@50%) + 2m30s@50%] | CD 5m@50%');
  assert.equal(r.category, 'VO2 Max');
  assert.equal(P.parse(r.summary).ok, true);
});

test('경계값 분류와 오류', () => {
  const one = (p) => S.summarize('워밍업 FTP 60% 05:00 인터벌 FTP ' + p + '% 10:00 쿨다운 FTP 50% 05:00').category;
  assert.deepEqual([70, 80, 90, 100, 110].map(one), ['Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Max']);
  assert.equal(S.summarize('').ok, false);
  assert.equal(S.summarize('인터벌 FTP 90%').ok, false);
});

test('합이 맞지 않는 반복은 가장 가까운 구간으로 묶고 설명에 남긴다', () => {
  const r = S.summarize('인터벌 FTP 90% 03:00 휴식 FTP 50% 01:00 반복 2회 05:00');
  assert.equal(r.ok, true);
  assert.equal(r.notes.length, 1);
});
