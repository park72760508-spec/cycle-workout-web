#!/usr/bin/env node
/**
 * 버스 노선 목록 검색용 색인 생성 (2026-11-05)
 * 타일(assets/data/kr-bus/{i}_{j}.json)의 노선 목록(r) 순서와 같은 순서로, 각 노선의 모든 정류장 이름(시작~끝, 방향·변형 합침, 중복 제거,
 * 공백 제거)을 '|' 로 이어 assets/data/kr-bus/search/{i}_{j}.json 의 n[] 에 저장한다. 앱은 노선명(종점·경유 정류장) 키워드 검색에 사용.
 * 실행: node scripts/build-kr-bus-search.mjs   (build-kr-bus.mjs 가 타일·노선을 만든 뒤에 실행)
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/data/kr-bus');
const OUT = path.join(DIR, 'search');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const cache = new Map();
function namesOf(id) {
  if (cache.has(id)) return cache.get(id);
  let arr = [];
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, 'routes', id + '.json'), 'utf8'));
    arr = (d.s || []).map((x) => String(x[0] || '').replace(/\s+/g, '')).filter(Boolean);
  } catch (e) { /* 노선 파일 없음 */ }
  cache.set(id, arr);
  return arr;
}

let files = 0, bytes = 0;
for (const k of index.t) {
  const f = path.join(DIR, k + '.json');
  if (!fs.existsSync(f)) continue;
  const tile = JSON.parse(fs.readFileSync(f, 'utf8'));
  const n = (tile.r || []).map((x) => {
    const ids = typeof x === 'string' ? [] : (x[1] || []);
    const set = new Set();
    ids.forEach((id) => namesOf(id).forEach((nm) => set.add(nm)));
    return [...set].join('|');
  });
  const txt = JSON.stringify({ v: 1, n });
  fs.writeFileSync(path.join(OUT, k + '.json'), txt);
  files++; bytes += txt.length;
}
console.log('search index', files, 'tiles,', (bytes / 1048576).toFixed(1), 'MB');
