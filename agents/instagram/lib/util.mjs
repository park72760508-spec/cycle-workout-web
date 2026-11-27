import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const config = () => JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
export const env = (k, req = true) => {
  const v = process.env[k];
  if (!v && req) throw new Error(`환경변수 ${k} 가 필요합니다.`);
  return v || '';
};

/** KST 기준 ISO 주차 id (예: 2026-W49) */
export function weekId(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600e3);
  const t = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - new Date(Date.UTC(y, 0, 1))) / 864e5 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** 기준 시각 이후 첫 번째 슬롯(KST 요일·시각) → UTC ISO */
export function nextSlot(after, slot) {
  const [hh, mm] = slot.time.split(':').map(Number);
  const k = new Date(after.getTime() + 9 * 3600e3);
  for (let i = 0; i < 8; i++) {
    const c = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + i, hh, mm));
    if (c.getUTCDay() === slot.dow && c.getTime() - 9 * 3600e3 > after.getTime()) return new Date(c.getTime() - 9 * 3600e3).toISOString();
  }
  throw new Error('슬롯 계산 실패');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
