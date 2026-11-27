'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./workoutSummaryParser.js');
const total = (r) => r.segments.reduce((n, s) => n + s.durationSec, 0);

test('섹션 5개 + 중첩 반복 [ ] (머리말 WU/CD, 사이는 모두 메인)', () => {
  const r = P.parse('WU 5m@70% | 2 X (20s@120% + 40s@55%) | 3m@50% | 3 X [10 X (30s@115% + 15s@50%) + 2m30s@50%] | CD 5m@50%');
  assert.equal(r.ok, true);
  assert.equal(r.segments.length, 70);
  assert.equal(total(r), 2700);
  assert.equal(r.segments[0].type, '워밍업');
  assert.equal(r.segments[r.segments.length - 1].type, '쿨다운');
});

test('머리말 없는 4섹션: 첫=워밍업, 끝=쿨다운, 사이=메인', () => {
  const r = P.parse('5m@50% | 10m@90% | 5m@50% | 5m@40%');
  assert.equal(r.ok, true);
  assert.deepEqual(r.segments.map((s) => s.type), ['워밍업', '인터벌', '휴식', '쿨다운']);
});

test('기존 3섹션·머리말 형식 유지', () => {
  const a = P.parse('WD 2m@70%/80rpm + 2m@85%/90rpm | 2 X (8m@88% + 3m@50%) + 12m@90% | CD 5m@50%');
  assert.equal(a.ok, true);
  assert.equal(a.segments.length, 2 + 4 + 1 + 1);
  assert.equal(P.parse('5m@50% | 3 X (3m@90% + 2m@50%) | 5m@50%').ok, true);
  assert.equal(P.parse('10m@60%').segments[0].type, '인터벌');
});

test('오류: 워밍업 머리말 중복, 2섹션 머리말 없음, 괄호 불일치', () => {
  assert.equal(P.parse('WU 5m@50% | WU 5m@50%').ok, false);
  assert.equal(P.parse('5m@50% | 5m@50%').ok, false);
  assert.equal(P.parse('WU 5m@50% | 2 X (3m@90% | CD 5m@50%').ok, false);
});
