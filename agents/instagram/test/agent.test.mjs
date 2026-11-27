import test from 'node:test';
import assert from 'node:assert/strict';
import { config, weekId, nextSlot } from '../lib/util.mjs';
import { validatePosts, extractJson, assignSlots, buildPrompt } from '../lib/plan.mjs';
import { buildFfmpegArgs, wrapSub } from '../lib/compose.mjs';
import { duePosts } from '../lib/queue.mjs';
import { issueBody } from '../agent.mjs';

const cfg = config();
const good = { posts: [
  { title: 'a', caption: 'c', hashtags: ['x', '#STELVIO'], scenes: [{ ref: 'workout-categories', sub: '존별로 골라 타요' }, { ref: 'workout-graph', sub: '구간 그래프' }] },
  { title: 'b', caption: 'c', hashtags: [], scenes: [{ ref: 'workout-builder', sub: '요약하기' }, { ref: 'riding-moim', sub: '모임' }] }] };

test('주차 id 와 슬롯(KST)', () => {
  assert.equal(weekId(new Date('2026-11-30T00:00:00Z')), '2026-W49'); // 월요일 09:00 KST
  assert.equal(weekId(new Date('2026-01-01T00:00:00Z')), '2026-W01');
  // 월요일 09:00 KST 기준 다음 화요일 19:00 KST = 10:00 UTC
  assert.equal(nextSlot(new Date('2026-11-30T00:00:00Z'), { dow: 2, time: '19:00' }), '2026-12-01T10:00:00.000Z');
});

test('기획 검증: 정상 통과, 해시태그 중복 제거·공통 태그 추가, 슬롯 배정', () => {
  const posts = assignSlots(validatePosts(good, cfg), cfg, new Date('2026-11-30T00:00:00Z'));
  assert.equal(posts.length, 2);
  assert.equal(posts[0].hashtags.filter((t) => t === '#STELVIO').length, 1);
  assert.ok(posts[0].hashtags.includes('#x'));
  assert.equal(posts[1].publishAt, '2026-12-04T10:00:00.000Z'); // 금 19:00 KST
});

test('기획 검증: 카탈로그 밖·비활성(개인정보) 장면, 빈 자막, 장면 부족은 거부', () => {
  const mk = (scenes) => ({ posts: [{ title: 't', caption: 'c', scenes }] });
  assert.throws(() => validatePosts(mk([{ ref: 'nope', sub: 'a' }, { ref: 'workout-graph', sub: 'b' }]), cfg), /알 수 없는 장면/);
  assert.throws(() => validatePosts(mk([{ ref: 'ranking', sub: 'a' }, { ref: 'workout-graph', sub: 'b' }]), cfg), /알 수 없는 장면/);
  assert.throws(() => validatePosts(mk([{ ref: 'workout-graph', sub: '' }, { ref: 'workout-graph', sub: 'b' }]), cfg), /자막/);
  assert.throws(() => validatePosts(mk([{ ref: 'workout-graph', sub: 'a' }]), cfg), /2개 미만/);
});

test('모델 응답 JSON 추출 + 프롬프트에 비활성 장면 미포함', () => {
  assert.deepEqual(extractJson('설명 {"posts":[]} 끝'), { posts: [] });
  const p = buildPrompt(cfg, { changes: [], insights: [], recentTitles: [] });
  assert.ok(p.includes('workout-builder') && !p.includes('- ranking:') && !p.includes('- market:'));
});

test('ffmpeg 인자: 9:16 1080x1920, 자막 구간·무음 오디오', () => {
  const a = buildFfmpegArgs({ input: 'in.webm', output: 'o.mp4', trimStart: 4, duration: 20, subs: [{ file: 's0.txt', start: 0, end: 5 }, { file: 's1.txt', start: 5.5, end: 10 }], fontPath: '/f.ttc' });
  const vf = a[a.indexOf('-vf') + 1];
  assert.match(vf, /scale=1080:1920/);
  assert.match(vf, /between\(t,0\.00,5\.00\)/);
  assert.match(vf, /between\(t,5\.50,10\.00\)/);
  assert.ok(a.includes('anullsrc=r=44100:cl=stereo') && a.includes('libx264') && a.includes('+faststart'));
  assert.equal(wrapSub('가나다 라마바 사아자 차카타 파하', 8), '가나다 라마바\n사아자 차카타\n파하');
});

test('게시 대상: 승인+시각 도래+approved 만', () => {
  const now = new Date('2026-12-01T11:00:00Z');
  const mk = (status, pStatus, at) => ({ week: 'w', status, posts: [{ id: 'p', status: pStatus, publishAt: at }] });
  const due = duePosts([
    mk('approved', 'approved', '2026-12-01T10:00:00Z'), // 대상
    mk('approved', 'approved', '2026-12-04T10:00:00Z'), // 아직
    mk('draft', 'approved', '2026-12-01T10:00:00Z'), // 주차 미승인
    mk('approved', 'published', '2026-12-01T10:00:00Z'), // 이미 게시
    mk('rejected', 'approved', '2026-12-01T10:00:00Z') // 거부
  ], now);
  assert.equal(due.length, 1);
});

test('Issue 본문: 캡션·해시태그, 인스타 연결 유무에 따라 승인/직접 업로드 안내', () => {
  const plan = { week: '2026-W49', posts: [{ title: 't', publishAt: '2026-12-01T10:00:00Z', videoUrl: 'https://x/v.mp4', scenes: [{ ref: 'workout-graph', sub: 's' }], caption: 'cap', hashtags: ['#a'] }] };
  const prev = process.env.IG_ACCESS_TOKEN;
  try {
    process.env.IG_ACCESS_TOKEN = 'x';
    const auto = issueBody(plan);
    assert.match(auto, /2026-12-01 19:00 KST/);
    assert.match(auto, /ig-approved/);
    delete process.env.IG_ACCESS_TOKEN;
    const manual = issueBody(plan);
    assert.match(manual, /직접 올리는 방법/);
    assert.ok(!/ig-approved/.test(manual));
    assert.match(manual, /cap/);
  } finally {
    if (prev === undefined) delete process.env.IG_ACCESS_TOKEN; else process.env.IG_ACCESS_TOKEN = prev;
  }
});
