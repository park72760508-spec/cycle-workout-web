'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/* ---- 의존 모듈 스텁: Supabase(메모리 테이블) · UUID 매핑 · 관리자 판정 ---- */
const tables = { club_missions: [], club_mission_completions: [], riding_group_members: [], riding_groups: [] };

function query(table) {
  let rows = tables[table].slice();
  const q = {
    select() { return q; },
    eq(col, val) { rows = rows.filter((r) => String(r[col]) === String(val)); return q; },
    maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
    single() { return Promise.resolve({ data: rows[0] || null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
    insert(row) {
      const dup = tables[table].find(
        (r) => r.mission_id === row.mission_id && r.user_id === row.user_id && r.step_ord === row.step_ord
      );
      if (dup) return Promise.resolve({ error: { code: '23505' } });
      tables[table].push(Object.assign({ id: 'id' + tables[table].length }, row));
      return Promise.resolve({ error: null });
    },
  };
  return q;
}
const fakeSupabase = { from: (t) => query(t) };

function stub(rel, exportsObj) {
  const p = path.join(__dirname, rel);
  require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports: exportsObj };
}
class WriteError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
stub('./supabaseDualWriteServer.js', { getSupabaseAdminClient: () => fakeSupabase });
stub('./supabaseGroupDualWriteServer.js', {
  resolveUserUuid: (uid) => 'u-' + uid,
  resolveRidingGroupUuid: (gid) => 'g-' + gid,
});
stub('./ridingGroupSupabaseWrites.js', {
  WriteError,
  fetchOrBackfillGroupRow: async () => ({ id: 'g-club1', created_by: 'u-owner' }),
  isRidingGroupAdminGrade: async () => false,
});

const missions = require('./clubMissions');

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const logs = {};
const fakeAdmin = {
  firestore: () => ({
    collection: () => ({
      doc: (uid) => ({
        collection: () => ({
          doc: (logId) => ({
            get: async () => {
              const d = logs[uid + '/' + logId];
              return { exists: !!d, data: () => d };
            },
          }),
        }),
      }),
    }),
  }),
};

function reset() {
  tables.club_missions = [{
    id: 'm1', group_id: 'g-club1', title: '겨울 챌린지', is_active: true,
    start_date: '2020-01-01', end_date: '2099-12-31',
    steps: [
      { ord: 1, workoutId: 'w1', workoutSource: 'gas', title: 'A', totalSeconds: 3600 },
      { ord: 2, workoutId: 'w2', workoutSource: 'club', title: 'B', totalSeconds: 1800 },
    ],
  }];
  tables.club_mission_completions = [];
  tables.riding_group_members = [{ group_id: 'g-club1', user_id: 'u-rider', membership_expires_at: null }];
  tables.riding_groups = [{ id: 'g-club1', created_by: 'u-owner' }];
}

function complete(stepOrd, logId) {
  return missions.handleCompleteClubMissionStep(fakeAdmin, 'rider', {
    groupId: 'club1', missionId: 'm1', stepOrd, trainingLogId: logId,
  });
}

test('1번 미션: 같은 워크아웃·충분한 시간이면 완료', async () => {
  reset();
  logs['rider/L1'] = { workout_id: 'w1', duration_sec: 3500, date: TODAY };
  const r = await complete(1, 'L1');
  assert.equal(r.completed, true);
  assert.equal(tables.club_mission_completions.length, 1);
});

test('순서 건너뛰기(2번 먼저)는 거부', async () => {
  reset();
  logs['rider/L2'] = { workout_id: 'w2', duration_sec: 1800, date: TODAY };
  await assert.rejects(complete(2, 'L2'), /순서대로/);
});

test('다른 워크아웃 훈련 로그는 거부', async () => {
  reset();
  logs['rider/L3'] = { workout_id: 'other', duration_sec: 3600, date: TODAY };
  await assert.rejects(complete(1, 'L3'), /다른 훈련/);
});

test('수행 시간 90% 미만이면 완료되지 않음', async () => {
  reset();
  logs['rider/L4'] = { workout_id: 'w1', duration_sec: 3000, date: TODAY };
  const r = await complete(1, 'L4');
  assert.equal(r.completed, false);
  assert.equal(r.reason, 'too_short');
  assert.equal(tables.club_mission_completions.length, 0);
});

test('비회원·만료 회원은 거부', async () => {
  reset();
  tables.riding_group_members[0].membership_expires_at = '2000-01-01';
  logs['rider/L5'] = { workout_id: 'w1', duration_sec: 3600, date: TODAY };
  await assert.rejects(complete(1, 'L5'), /클럽 회원/);
});

test('미션 기간 밖이면 거부', async () => {
  reset();
  tables.club_missions[0].end_date = '2000-12-31';
  tables.club_missions[0].start_date = '2000-01-01';
  logs['rider/L6'] = { workout_id: 'w1', duration_sec: 3600, date: TODAY };
  await assert.rejects(complete(1, 'L6'), /기간/);
});

test('조회: 진행 미션 + 내 완료 단계, 방장이면 canManage', async () => {
  reset();
  tables.club_mission_completions.push({ mission_id: 'm1', user_id: 'u-rider', step_ord: 1 });
  const mine = await missions.handleGetClubMission(fakeAdmin, 'rider', { groupId: 'club1' });
  assert.deepEqual(mine.completedOrds, [1]);
  assert.equal(mine.canManage, false);
  assert.equal(mine.mission.steps.length, 2);
  const owner = await missions.handleGetClubMission(fakeAdmin, 'owner', { groupId: 'club1' });
  assert.equal(owner.canManage, true);
});

test('저장: 권한 없는 회원은 거부, 워크아웃 미선택 단계는 거부', async () => {
  reset();
  const body = { groupId: 'club1', title: 'T', startDate: '2026-11-01', endDate: '2027-02-28',
    steps: [{ workoutId: 'w1', workoutSource: 'gas', title: 'A', totalSeconds: 60 }] };
  await assert.rejects(missions.handleSaveClubMission(fakeAdmin, 'rider', body), /권한/);
  await assert.rejects(
    missions.handleSaveClubMission(fakeAdmin, 'owner', Object.assign({}, body, { steps: [null] })),
    /워크아웃을 선택/
  );
});
