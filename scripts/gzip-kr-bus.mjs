#!/usr/bin/env node
/**
 * 버스 데이터 큰 JSON 압축 (2026-11-07) — GitHub Pages 배포 크기(syncing_files 지연) 축소
 * assets/data/kr-bus/{search,graph}/*.json 과 routes/b*.json 을 .json.gz 로 바꾸고 원본은 지운다.
 * 앱(outdoorRide.js fetchGzJson)이 받아서 DecompressionStream 으로 푼다. 타일(*.json)·index.json 은 작아서 그대로 둔다.
 * gzip 헤더에 시각이 안 들어가므로 같은 내용이면 같은 바이트 → 데이터가 안 바뀌면 git 변경 없음.
 * 실행: build-kr-bus.mjs → build-kr-bus-search.mjs → pack-kr-bus-routes.mjs → 이 스크립트
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/data/kr-bus');
let n = 0, before = 0, after = 0;
for (const sub of ['search', 'graph', 'routes']) {
  const d = path.join(DIR, sub);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    if (sub === 'routes' && !/^b\d+\.json$/.test(f)) continue;
    const raw = fs.readFileSync(path.join(d, f));
    const gz = zlib.gzipSync(raw, { level: 9 });
    fs.writeFileSync(path.join(d, f + '.gz'), gz);
    fs.rmSync(path.join(d, f));
    n++; before += raw.length; after += gz.length;
  }
}
console.log('gzip', n, '개:', (before / 1048576).toFixed(1), 'MB →', (after / 1048576).toFixed(1), 'MB');
