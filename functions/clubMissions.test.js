'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/* ---- 의존 모듈 스텁: Supabase(메모리 테이블) · UUID 매핑 · 관리자 판정 ---- */
const tables = {
  club_missions: [], club_mission_completions: [], riding_group_members: [], riding_groups: [],
  club_workout_segments: [], v_user_public_profile: [],
};
/* 외부 네트워크(GAS 워크아웃 조회) 차단 — 테스트는 스텁 응답만 사용 */
global.fetch = async () => ({ json: async () => ({ success: true, item: { segments: [
  { segment_type: 'interval', duration_sec: 3600, target_type: 'ftp_pct', target_value: '80' },
] } }) });

function query(table) {
  let rows = tables[table].slice();
  const q = {
    select() { return q; },
    eq(col, val) { rows = rows.filter((r) => String(r[col]) === String(val)); return q; },
    in(col, vals) { rows = rows.filter((r) => vals.map(String).includes(String(r[col]))); return q; },
    order() { return q; },
    update(fields) { rows.forEach((r) => Object.assign(r, fields)); return q; },
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
  logs['rider/L1'].ftp_at_time = 250;
  logs['rider/L1'].weight = 70;
  logs['rider/L1'].segment_avg_watts = [200];
  const r = await complete(1, 'L1');
  assert.equal(r.completed, true);
  assert.equal(tables.club_mission_completions.length, 1);
  // 세그먼트 목표를 서버가 조회해 점수 저장: 목표 200W(80%) 달성 100%, 2.86 W/kg → 가중치 0.886
  assert.equal(r.result.intervalAchievement, 100);
  assert.equal(tables.club_mission_completions[0].step_score, 88.6);
  // 조회한 세그먼트가 미션에 채워짐
  assert.equal(tables.club_missions[0].steps[0].segments.length, 1);
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
  tables.club_mission_completions.push(
    { mission_id: 'm1', user_id: 'u-rider', step_ord: 1, step_score: 90, completed_at: '2026-10-02' },
    { mission_id: 'm1', user_id: 'u-other', step_ord: 1, step_score: 70, completed_at: '2026-10-01' },
    { mission_id: 'm1', user_id: 'u-other', step_ord: 2, step_score: 70, completed_at: '2026-10-03' }
  );
  tables.v_user_public_profile = [
    { id: 'u-rider', display_name: '라이더', is_private: true },
    { id: 'u-other', display_name: '홍길동', is_private: true },
  ];
  const mine = await missions.handleGetClubMission(fakeAdmin, 'rider', { groupId: 'club1' });
  assert.deepEqual(mine.completedOrds, [1]);
  assert.equal(mine.myResults[1].score, 90);
  // other: 40×2/2 + 60×140/2/100 = 82, rider: 40×1/2 + 60×90/2/100 = 47
  assert.deepEqual(mine.leaderboard.map((r) => [r.name, r.total, r.isMe]), [['홍**', 82, false], ['라이더', 47, true]]);
  assert.equal(mine.myRank, 2);
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

test('단계 수가 줄면(3→2) 없어진 번호의 완료는 집계에서 제외, 늘면 그대로 반영', async () => {
  reset();
  tables.club_mission_completions.push(
    { mission_id: 'm1', user_id: 'u-rider', step_ord: 1, step_score: 90, completed_at: '2026-10-01' },
    { mission_id: 'm1', user_id: 'u-rider', step_ord: 2, step_score: 80, completed_at: '2026-10-02' },
    { mission_id: 'm1', user_id: 'u-rider', step_ord: 3, step_score: 70, completed_at: '2026-10-03' }
  );
  tables.v_user_public_profile = [{ id: 'u-rider', display_name: '라이더', is_private: false }];
  // 현재 미션은 2단계 → 3번 완료는 제외: 40×2/2 + 60×170/2/100 = 91
  const r = await missions.handleGetClubMission(fakeAdmin, 'rider', { groupId: 'club1' });
  assert.deepEqual(r.completedOrds, [1, 2]);
  assert.equal(r.leaderboard[0].total, 91);
  assert.equal(r.leaderboard[0].completed, 2);

  // 30단계로 늘리면 수행률 분모가 30: 40×3/30 + 60×240/30/100 = 4 + 4.8 = 8.8
  tables.club_missions[0].steps = Array.from({ length: 30 }, (_, i) => ({
    ord: i + 1, workoutId: 'w' + (i + 1), workoutSource: 'gas', title: 'S' + (i + 1), totalSeconds: 600,
  }));
  const r30 = await missions.handleGetClubMission(fakeAdmin, 'rider', { groupId: 'club1' });
  assert.deepEqual(r30.completedOrds, [1, 2, 3]);
  assert.equal(r30.leaderboard[0].total, 8.8);
  assert.equal(r30.leaderboard[0].completionRate, 10);
});
