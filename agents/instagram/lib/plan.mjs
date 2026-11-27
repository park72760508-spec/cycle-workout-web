import { execFileSync } from 'node:child_process';
import { config, env, nextSlot } from './util.mjs';

const MAX_SUB = 24;

/** 최근 2주 커밋 제목 중 사용자에게 보이는 변경만(기능 소재). 개인정보·내부 정보는 담지 않는다. */
export function recentChanges(days = 14) {
  try {
    const out = execFileSync('git', ['log', `--since=${days}.days`, '--no-merges', '--pretty=%s'], { encoding: 'utf8', cwd: new URL('../../..', import.meta.url).pathname });
    return out.split('\n').map((s) => s.trim()).filter((s) => s && !/Co-Authored|\[skip ci\]|인스타/.test(s)).slice(0, 25);
  } catch { return []; }
}

export function buildPrompt(cfg, { changes, insights, recentTitles }) {
  const catalog = cfg.catalog.filter((c) => c.enabled !== false).map((c) => `- ${c.id}: ${c.title} — ${c.summary}`).join('\n');
  return `너는 인스타그램 계정 @${cfg.account} (STELVIO — 실내 로라·야외 라이딩 훈련 앱)의 주간 콘텐츠 기획자다.
대상: ${cfg.audience}
톤: ${cfg.tone}
이번 주에 올릴 릴스 ${cfg.reelsPerWeek}개를 기획해 JSON 으로만 답해라(설명·코드블록 금지).

## 사용할 수 있는 화면 장면 (ref 는 반드시 아래 id 중에서만)
${catalog}

## 최근 2주간 앱 변경(소재 참고, 없는 기능을 지어내지 말 것)
${changes.length ? changes.map((c) => '- ' + c).join('\n') : '(없음)'}

## 지난 게시물 성과(도달/저장 기준 상위, 참고)
${insights.length ? insights.map((i) => `- ${i.title}: 도달 ${i.reach ?? '?'}, 저장 ${i.saved ?? '?'}`).join('\n') : '(아직 없음)'}

## 최근에 이미 올린 제목(비슷한 주제 반복 금지)
${recentTitles.length ? recentTitles.map((t) => '- ' + t).join('\n') : '(없음)'}

## 규칙
- 릴스마다 scenes 3~5개. 각 scene: {"ref": 장면 id, "sub": 화면 자막(한국어, ${MAX_SUB}자 이내, 한 문장)}
- 위 장면 설명에 없는 기능·수치를 단정하지 말 것. 개인정보·회원 이름·실명 언급 금지.
- caption: 훅 한 줄 + 핵심 2~3줄 + CTA("${cfg.cta}"). 300자 이내.
- hashtags: 주제별 5~8개(# 포함). 공통 해시태그는 코드가 추가한다.
- 릴스끼리 장면 조합과 주제가 달라야 한다.

## 출력 형식
{"posts":[{"title":"내부 관리용 제목","caption":"...","hashtags":["#..."],"scenes":[{"ref":"workout-categories","sub":"..."}]}]}`;
}

/** 모델 응답에서 JSON 추출 */
export function extractJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('모델 응답에서 JSON 을 찾지 못했습니다.');
  return JSON.parse(s.slice(a, b + 1));
}

/** 카탈로그에 없는 장면·너무 긴 자막·빈 캡션은 거부(→ 재시도/실패) */
export function validatePosts(raw, cfg) {
  const ids = new Set(cfg.catalog.filter((c) => c.enabled !== false).map((c) => c.id));
  const posts = raw && Array.isArray(raw.posts) ? raw.posts : [];
  if (posts.length < 1) throw new Error('게시물 기획이 비어 있습니다.');
  return posts.slice(0, cfg.reelsPerWeek).map((p, i) => {
    const scenes = (Array.isArray(p.scenes) ? p.scenes : []).slice(0, 6);
    if (scenes.length < 2) throw new Error(`게시물 ${i + 1}: 장면이 2개 미만`);
    for (const s of scenes) {
      if (!ids.has(s.ref)) throw new Error(`게시물 ${i + 1}: 알 수 없는 장면 '${s.ref}'`);
      s.sub = String(s.sub || '').trim().slice(0, MAX_SUB);
      if (!s.sub) throw new Error(`게시물 ${i + 1}: 자막이 비어 있음`);
    }
    const caption = String(p.caption || '').trim();
    if (!caption) throw new Error(`게시물 ${i + 1}: 캡션이 비어 있음`);
    const tags = [...new Set([...(Array.isArray(p.hashtags) ? p.hashtags : []), ...cfg.baseHashtags].map((t) => '#' + String(t).replace(/^#+/, '').replace(/\s+/g, '')).filter((t) => t.length > 1))].slice(0, 15);
    return { id: `p${i + 1}`, type: 'reel', title: String(p.title || `릴스 ${i + 1}`).slice(0, 60), caption, hashtags: tags, scenes, status: 'draft' };
  });
}

export function assignSlots(posts, cfg, from = new Date()) {
  return posts.map((p, i) => ({ ...p, publishAt: nextSlot(from, cfg.slots[i % cfg.slots.length]) }));
}

export async function askClaude(prompt, cfg) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model, max_tokens: 3000, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(j.error && j.error.message) || ''}`);
  return (j.content || []).map((c) => c.text || '').join('');
}

export async function planWeek(ctx, cfg = config()) {
  const prompt = buildPrompt(cfg, ctx);
  let lastErr;
  for (let i = 0; i < 2; i++) { // 형식 오류는 한 번 더
    try { return assignSlots(validatePosts(extractJson(await askClaude(prompt, cfg)), cfg), cfg); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
