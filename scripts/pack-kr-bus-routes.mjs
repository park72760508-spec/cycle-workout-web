#!/usr/bin/env node
/**
 * 버스 노선 파일 묶음 생성 (2026-11-07)
 * assets/data/kr-bus/routes/{id}.json 이 3만 7천 개라 GitHub Pages 배포(syncing_files)가 시간 초과로 자주 실패했다.
 * → 노선 id 의 FNV-1a 해시 % BUNDLES 로 묶어 routes/b{k}.json = { "<id>": {노선…}, … } 800개 안팎으로 줄인다.
 * 앱(outdoorRide.js busBundleOf)이 같은 해시로 묶음 파일을 한 번 받아 캐시한다. 해시·BUNDLES 값은 앱과 반드시 같아야 한다.
 * 실행: node scripts/pack-kr-bus-routes.mjs   (build-kr-bus.mjs 와 build-kr-bus-search.mjs 가 끝난 뒤. 낱개 파일이 없으면 아무 것도 안 함)
 */
import fs from 'node:fs';
import path from 'node:path';

const BUNDLES = 800;
const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/data/kr-bus/routes');
function bundleOf(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % BUNDLES;
}
const loose = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !/^b\d+\.json$/.test(f));
if (!loose.length) { console.log('낱개 노선 파일 없음 — 건너뜀'); process.exit(0); }
const groups = new Map();
for (const f of loose) {
  const id = f.slice(0, -5);
  const k = bundleOf(id);
  if (!groups.has(k)) groups.set(k, {});
  groups.get(k)[id] = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
}
// 이전 묶음 제거 후 새로 쓰기(낱개에 없는 노선이 남지 않게)
fs.readdirSync(DIR).filter((f) => /^b\d+\.json$/.test(f)).forEach((f) => fs.rmSync(path.join(DIR, f)));
let bytes = 0;
for (const [k, obj] of groups) { const js = JSON.stringify(obj); bytes += js.length; fs.writeFileSync(path.join(DIR, 'b' + k + '.json'), js); }
loose.forEach((f) => fs.rmSync(path.join(DIR, f)));
console.log('노선', loose.length, '개 →', groups.size, '개 묶음,', (bytes / 1048576).toFixed(1), 'MB');
