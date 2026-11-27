import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './util.mjs';

const DIR = join(ROOT, 'queue');
export const file = (week) => join(DIR, `${week}.json`);
export const load = (week) => (existsSync(file(week)) ? JSON.parse(readFileSync(file(week), 'utf8')) : null);
export function save(plan) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file(plan.week), JSON.stringify(plan, null, 2) + '\n');
}
export const listWeeks = () =>
  existsSync(DIR) ? readdirSync(DIR).filter((f) => /^\d{4}-W\d\d\.json$/.test(f)).map((f) => f.slice(0, -5)).sort() : [];

/** 승인됐고 게시 시각이 지난 게시물 */
export function duePosts(plans, now = new Date()) {
  const out = [];
  for (const plan of plans) {
    if (plan.status !== 'approved') continue;
    for (const p of plan.posts) if (p.status === 'approved' && new Date(p.publishAt) <= now) out.push({ plan, post: p });
  }
  return out;
}
