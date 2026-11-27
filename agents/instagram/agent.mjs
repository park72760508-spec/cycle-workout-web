#!/usr/bin/env node
/* STELVIO 인스타그램 주간 에이전트 — node agent.mjs <login|insights|plan|produce|approve|publish> [--week 2026-W49] [--force] [--sample] [--dry]
 * 흐름: plan(주간 기획·초안) → produce(앱 화면 녹화+자막 영상·업로드) → [사람이 Issue 에 ig-approved 라벨] → approve → publish(게시 시각 도래분) */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT, weekId } from './lib/util.mjs';
import * as Q from './lib/queue.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const INSIGHTS = join(ROOT, 'queue', 'insights.json');

const kst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + ' KST';

/** 승인용 GitHub Issue 본문 */
export function issueBody(plan) {
  const posts = plan.posts.map((p, i) => [
    `### ${i + 1}. ${p.title}`,
    `- 게시 예정: **${kst(p.publishAt)}**`,
    `- 영상: ${p.videoUrl ? `[미리보기](${p.videoUrl})` : '(생성 전)'}`,
    `- 장면: ${p.scenes.map((s) => `\`${s.ref}\` "${s.sub}"`).join(' → ')}`,
    '', '```', p.caption, '', p.hashtags.join(' '), '```'
  ].join('\n')).join('\n\n');
  return `${posts}\n\n---\n**승인하려면 이 Issue 에 \`ig-approved\` 라벨을 붙이세요.** 게시 시각이 되면 자동으로 올라갑니다. 올리지 않으려면 Issue 를 닫고 \`queue/${plan.week}.json\` 의 status 를 \`rejected\` 로 바꾸세요.`;
}

async function main() {
  const cfg = config();
  const week = opt('week', weekId());

  if (cmd === 'login') {
    const { loginAndExport } = await import('./lib/record.mjs');
    return loginAndExport(cfg, join(ROOT, 'storage-state.json'));
  }

  if (cmd === 'insights') {
    const { recentInsights } = await import('./lib/graph.mjs');
    mkdirSync(join(ROOT, 'queue'), { recursive: true });
    writeFileSync(INSIGHTS, JSON.stringify(await recentInsights(), null, 2) + '\n');
    return console.log('성과 저장:', INSIGHTS);
  }

  if (cmd === 'plan') {
    if (Q.load(week) && !flag('force')) return console.log(`${week} 기획이 이미 있습니다(--force 로 다시 만들기).`);
    const P = await import('./lib/plan.mjs');
    const insights = existsSync(INSIGHTS) ? JSON.parse(readFileSync(INSIGHTS, 'utf8')).filter((i) => i.reach != null).sort((a, b) => (b.reach || 0) - (a.reach || 0)).slice(0, 5) : [];
    const recentTitles = Q.listWeeks().slice(-4).flatMap((w) => Q.load(w).posts.map((p) => p.title));
    const posts = flag('sample')
      ? P.assignSlots(P.validatePosts({ posts: [
          { title: '샘플 1', caption: '샘플 캡션', hashtags: ['#샘플'], scenes: [{ ref: 'workout-categories', sub: '존별로 골라 타요' }, { ref: 'workout-graph', sub: '구간 그래프로 한눈에' }] },
          { title: '샘플 2', caption: '샘플 캡션', hashtags: ['#샘플'], scenes: [{ ref: 'workout-builder', sub: '붙여넣고 요약하기' }, { ref: 'riding-moim', sub: '모임 일정 확인' }] }] }, cfg), cfg)
      : await P.planWeek({ changes: P.recentChanges(), insights, recentTitles }, cfg);
    Q.save({ week, status: 'draft', createdAt: new Date().toISOString(), posts });
    return console.log(`${week} 초안 ${posts.length}개 생성`);
  }

  const plan = Q.load(week);
  if (['produce', 'approve'].includes(cmd) && !plan) throw new Error(`${week} 기획이 없습니다(먼저 plan).`);

  if (cmd === 'produce') {
    const { recordPost } = await import('./lib/record.mjs');
    const { compose } = await import('./lib/compose.mjs');
    const out = join(ROOT, 'out', week);
    for (const post of plan.posts) {
      if (post.videoUrl || post.status !== 'draft') continue;
      const rec = await recordPost(post, cfg, out);
      const { output } = compose({ input: rec.webm, outDir: out, name: post.id, trimStart: rec.trimStart, scenes: rec.scenes });
      post.videoUrl = flag('dry') ? `file://${output}` : await (await import('./lib/upload.mjs')).uploadPublic(output, `${week}/${post.id}.mp4`);
      Q.save(plan);
    }
    const body = issueBody(plan);
    writeFileSync(join(ROOT, 'queue', `${week}.issue.md`), body + '\n');
    return console.log(`${week} 영상 제작 완료`);
  }

  if (cmd === 'approve') {
    if (plan.status === 'rejected') throw new Error(`${week} 는 거부된 주차입니다.`);
    plan.status = 'approved';
    for (const p of plan.posts) if (p.status === 'draft' && p.videoUrl && !p.videoUrl.startsWith('file://')) p.status = 'approved';
    Q.save(plan);
    return console.log(`${week} 승인: ${plan.posts.filter((p) => p.status === 'approved').length}개`);
  }

  if (cmd === 'publish') {
    const { publishReel } = await import('./lib/graph.mjs');
    const plans = Q.listWeeks().map(Q.load);
    const due = Q.duePosts(plans);
    const lines = [];
    for (const { plan: pl, post } of due) {
      try {
        const r = await publishReel({ videoUrl: post.videoUrl, caption: `${post.caption}\n\n${post.hashtags.join(' ')}` });
        Object.assign(post, { status: 'published', igMediaId: r.id, permalink: r.permalink, publishedAt: new Date().toISOString() });
        lines.push(`- 게시됨 ${pl.week}/${post.id} ${r.permalink}`);
      } catch (e) {
        Object.assign(post, { status: 'failed', error: String(e.message).slice(0, 300) });
        lines.push(`- 실패 ${pl.week}/${post.id}: ${post.error}`);
      }
      Q.save(pl); // 게시 직후 바로 저장 — 중복 게시 방지
    }
    const sum = lines.length ? lines.join('\n') : '- 게시할 항목 없음';
    console.log(sum);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 인스타 게시\n${sum}\n`);
    return;
  }

  console.log('사용법: node agent.mjs <login|insights|plan|produce|approve|publish> [--week YYYY-Www] [--force] [--sample] [--dry]');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
