'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const snap = require('./rankingBoardSnapshots');

test('스냅샷 키: period(yearly→monthly)·duration·gender, uid 등 나머지 무시', () => {
  assert.equal(snap.snapshotKeyForQuery({ duration: 'gc', gender: 'M', uid: 'x', gfVer: '7' }), 'monthly|gc|M');
  assert.equal(snap.snapshotKeyForQuery({ period: 'yearly', duration: '5min' }), 'monthly|5min|all');
});

test('대상 보드: GC·피크 7종·독주만 (TSS·그룹·30일 거리 제외)', () => {
  ['gc', 'max', '1min', '5min', '10min', '20min', '40min', '60min', 'personal_speed'].forEach((d) =>
    assert.ok(snap.boundariesForDuration(d), d)
  );
  ['tss', 'group_dist', 'personal_dist'].forEach((d) => assert.equal(snap.boundariesForDuration(d), null, d));
});

test('뷰어 개인화 필드 제거 — 원본은 호출부가 복제해서 넘김', () => {
  const payload = {
    success: true,
    currentUser: { userId: 'me' },
    motivationMessage: 'm',
    viewerHeptagonAxis: { ranks: [1] },
    rankingParity: { ok: true },
    byCategory: {
      Supremo: [
        { userId: 'me', heptagonRanks: [1], heptagonCohortNPerAxis: [2], positionScores100: [3], gcScore: 90 },
        { userId: 'b', gcScore: 80 },
      ],
    },
    entries: [{ userId: 'me', heptagonRanks: [1] }],
  };
  const out = snap.stripViewerFields(JSON.parse(JSON.stringify(payload)));
  assert.equal(out.currentUser, undefined);
  assert.equal(out.motivationMessage, undefined);
  assert.equal(out.viewerHeptagonAxis, undefined);
  assert.equal(out.rankingParity, undefined);
  assert.deepEqual(out.byCategory.Supremo[0], { userId: 'me', gcScore: 90 });
  assert.deepEqual(out.entries[0], { userId: 'me' });
  assert.ok(payload.currentUser, '원본 불변');
});

test('4단계 실시간 보드: TSS·30일 거리·클럽 거리는 live epoch 대상', () => {
  ['tss', 'personal_dist', 'group_dist'].forEach((d) => assert.ok(snap.isLiveDuration(d), d));
  ['gc', '5min', 'personal_speed'].forEach((d) => assert.equal(snap.isLiveDuration(d), false, d));
  assert.equal(snap.weeklyTop10SnapshotKey({ week: 'prev' }), 'weekly_top10|prev');
  assert.equal(snap.weeklyTop10SnapshotKey({}), 'weekly_top10|current');
});

test('클럽 거리: 뷰어 참가 여부는 공용본에서 false 로 초기화', () => {
  const payload = {
    byCategory: { Supremo: [{ userId: 'h1', currentUserParticipated: true }, { userId: 'h2', currentUserParticipated: false }] },
    entries: [{ userId: 'h1', currentUserParticipated: true }],
  };
  const out = snap.stripViewerFields(payload);
  assert.equal(out.byCategory.Supremo[0].currentUserParticipated, false);
  assert.equal(out.entries[0].currentUserParticipated, false);
  assert.ok(!('currentUserParticipated' in { userId: 'x' }));
});
