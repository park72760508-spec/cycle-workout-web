'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sodium = require('libsodium-wrappers');
const { createHandler, validateValues, encryptForGithub } = require('./instagramAgentAdmin.js');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('GitHub 비밀값 암호화: 공개키로 봉인 → 개인키로 복호화 왕복', async () => {
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  const enc = await encryptForGithub(sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL), 'sk-ant-테스트');
  const dec = sodium.crypto_box_seal_open(sodium.from_base64(enc, sodium.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey);
  assert.equal(sodium.to_string(dec), 'sk-ant-테스트');
});

test('검증: 일부만 입력, 짝 누락, 형식 오류는 거부 / 정상은 확인 결과 반환', async () => {
  const f = async (url) => {
    if (String(url).includes('anthropic')) return json(200, {});
    if (String(url).includes('graph.facebook')) return json(200, { username: 'stelvioai', media_count: 3 });
    return json(200, {});
  };
  await assert.rejects(validateValues({}, f), /저장할 값/);
  await assert.rejects(validateValues({ IG_USER_ID: '123' }, f), /함께 입력/);
  await assert.rejects(validateValues({ IG_USER_ID: 'abc', IG_ACCESS_TOKEN: 't' }, f), /숫자/);
  await assert.rejects(validateValues({ SUPABASE_URL: 'https://x.supabase.co' }, f), /함께 입력/);
  await assert.rejects(validateValues({ SUPABASE_URL: 'http://evil.com', SUPABASE_SERVICE_KEY: 'k' }, f), /형식/);
  await assert.rejects(validateValues({ ANTHROPIC_API_KEY: 'bad' }, f), /sk-ant-/);
  const r = await validateValues({ ANTHROPIC_API_KEY: ' "sk-ant-x" ', IG_USER_ID: '1789', IG_ACCESS_TOKEN: 'tok', SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_SERVICE_KEY: 'k' }, f);
  assert.equal(r.values.ANTHROPIC_API_KEY, 'sk-ant-x'); // 따옴표·공백 제거
  assert.equal(r.checks.instagram.username, 'stelvioai');
});

test('검증: 외부 서비스 거부는 사용자에게 이유와 함께 전달', async () => {
  const bad = async (url) => (String(url).includes('graph.facebook') ? json(400, { error: { message: 'Invalid OAuth access token' } }) : json(401, {}));
  await assert.rejects(validateValues({ IG_USER_ID: '1', IG_ACCESS_TOKEN: 't' }, bad), /Invalid OAuth/);
  await assert.rejects(validateValues({ ANTHROPIC_API_KEY: 'sk-ant-x' }, bad), /올바르지 않/);
  const nobucket = async () => json(404, {});
  await assert.rejects(validateValues({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_KEY: 'k' }, nobucket), /버킷이 없습니다/);
});

function harness({ grade = '1', token = 'ghp_x', fetchImpl }) {
  const store = { githubToken: token };
  const admin = { firestore: () => ({ collection: (c) => ({ doc: (d) => ({
    get: async () => (c === 'users' ? { data: () => ({ grade }) } : { exists: !!store.githubToken, data: () => store }),
    set: async (v) => Object.assign(store, v),
  }) }) }) };
  const out = {};
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, send() { return this; } };
  const handler = createHandler({ admin, verifyAuth: async () => ({ uid: 'u1' }), setCors() {}, fetchImpl });
  return { call: async (body) => { await handler({ method: 'POST', body, headers: {} }, res); return out; }, store };
}

test('관리자가 아니면 403', async () => {
  const h = harness({ grade: '2', fetchImpl: async () => json(200, {}) });
  assert.equal((await h.call({ action: 'status' })).status, 403);
});

test('토큰 없으면 status 는 github:false, 나머지는 안내 오류', async () => {
  const h = harness({ token: '', fetchImpl: async () => json(200, {}) });
  const s = await h.call({ action: 'status' });
  assert.equal(s.body.github, false);
  const r = await h.call({ action: 'run', workflow: 'weekly' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /GitHub 토큰/);
});

test('saveConnection: 검증 통과 값만 암호화해 PUT, 평문은 전송하지 않음', async () => {
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  const puts = [];
  const f = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/actions/secrets/public-key')) return json(200, { key: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL), key_id: 'k1' });
    if (u.includes('/actions/secrets/') && opts.method === 'PUT') { puts.push({ name: u.split('/').pop(), body: JSON.parse(opts.body) }); return { ok: true, status: 204, json: async () => null }; }
    if (u.includes('anthropic')) return json(200, {});
    return json(200, {});
  };
  const h = harness({ fetchImpl: f });
  const r = await h.call({ action: 'saveConnection', values: { ANTHROPIC_API_KEY: 'sk-ant-secret' } });
  assert.equal(r.body.success, true);
  assert.deepEqual(r.body.saved, ['ANTHROPIC_API_KEY']);
  assert.equal(puts.length, 1);
  assert.ok(!JSON.stringify(puts[0].body).includes('sk-ant-secret'));
  const back = sodium.crypto_box_seal_open(sodium.from_base64(puts[0].body.encrypted_value, sodium.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey);
  assert.equal(sodium.to_string(back), 'sk-ant-secret');
});

test('approve: 해당 주차 Issue 에 ig-approved 라벨, 없으면 404 / run 은 dispatch 입력 전달', async () => {
  const calls = [];
  const f = async (url, opts = {}) => {
    const u = String(url); calls.push({ u, m: opts.method || 'GET', b: opts.body });
    if (u.includes('/issues?labels=ig-draft')) return json(200, [{ number: 7, title: '[인스타 초안] 2026-W49' }]);
    if (u.includes('/issues/7/labels')) return json(200, []);
    if (u.includes('/dispatches')) return { ok: true, status: 204, json: async () => null };
    return json(200, {});
  };
  const h = harness({ fetchImpl: f });
  assert.equal((await h.call({ action: 'approve', week: '2026-W49' })).body.issue, 7);
  assert.ok(calls.some((c) => c.u.endsWith('/issues/7/labels') && c.b.includes('ig-approved')));
  assert.equal((await h.call({ action: 'approve', week: '2026-W50' })).status, 404);
  assert.equal((await h.call({ action: 'approve', week: 'x' })).status, 400);
  await h.call({ action: 'run', workflow: 'weekly', mode: 'dry-run', force: true });
  const d = calls.find((c) => c.u.includes('instagram-weekly.yml/dispatches'));
  assert.deepEqual(JSON.parse(d.b), { ref: 'main', inputs: { mode: 'dry-run', force: 'true' } });
  assert.equal((await h.call({ action: 'run', workflow: 'nope' })).status, 400);
});
