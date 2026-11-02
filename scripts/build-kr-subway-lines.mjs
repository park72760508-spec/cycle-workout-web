#!/usr/bin/env node
/**
 * 루트맵 지하철 노선도(호선별 역 순서) 생성 (2026-11-03)
 * kr-subway.json(역·호선)에 맞춰 Geofabrik 국내 OSM 추출본의 노선(route=subway·light_rail·monorail·train) 정차 순서를 읽어
 * assets/data/kr-subway-lines.json = { v, o: [호선별 [[역 인덱스…](본선), [역 인덱스…](지선)…]] } 로 저장.
 * 앱: 지하철역 팝업에서 호선 칩을 누르면 이 순서로 노선도 팝업을 그림.
 *
 * 필요: osmium-tool / 실행 순서: build-kr-subway.mjs 다음에
 * 실행: node scripts/build-kr-subway-lines.mjs [--pbf 기존파일.osm.pbf]
 * 데이터 출처: © OpenStreetMap contributors (ODbL)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SUBWAY = path.join(ROOT, 'assets/data/kr-subway.json');
const OUT = path.join(ROOT, 'assets/data/kr-subway-lines.json');
const PBF_URL = 'https://download.geofabrik.de/asia/south-korea-latest.osm.pbf';
const MATCH_M = 500; // 정차 지점 → 역 연결 거리

// build-kr-subway.mjs 와 같은 호선 묶기 규칙
const TRAIN_INCLUDE = /경의.?중앙|수인.?분당|신분당|인천국제공항철도 일반|경춘선|경강선|서해선|광역급행철도|동해선 광역|대경선/;
const TRAIN_EXCLUDE = /ITX|무궁화|직통|평택선|교외선/;
function lineKey(name) {
  let n = String(name || '').split(':')[0];
  n = n.replace(/\(.*?\)/g, '').replace(/급행|셔틀|일반열차|성수지선|신정지선|경인·경원 계통/g, '').replace(/·/g, '').replace(/\s+/g, ' ').trim();
  return n;
}
function shortLabel(key) {
  const m = key.match(/(\d+)호선/);
  if (m && /서울|수도권 전철 1호선/.test(key)) return m[1] + '호선';
  return key.replace(/^(서울 지하철|수도권 전철|서울 경전철)\s*/, '');
}
const oplDecode = (v) => v.replace(/%([0-9a-f]+)%/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function oplTags(field) {
  const t = {};
  if (!field) return t;
  for (const kv of field.split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) t[oplDecode(kv.slice(0, i))] = oplDecode(kv.slice(i + 1));
  }
  return t;
}
const distM = (a, b) => Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 88000);

async function main() {
  const sub = JSON.parse(fs.readFileSync(SUBWAY, 'utf8'));
  const lineIdx = new Map(sub.lines.map((l, i) => [l.n, i]));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kr-subway-'));
  const argPbf = process.argv.indexOf('--pbf');
  let pbf = argPbf > 0 ? process.argv[argPbf + 1] : '';
  if (!pbf) {
    pbf = path.join(work, 'kr.osm.pbf');
    console.log('OSM 추출본 내려받는 중…');
    execFileSync('curl', ['-sSfL', '--retry', '3', '-o', pbf, PBF_URL], { stdio: 'inherit' });
  }
  const filtered = path.join(work, 'rail.pbf'), opl = path.join(work, 'rail.opl');
  execFileSync('osmium', ['tags-filter', pbf, 'r/route=subway,light_rail,monorail,train', '-o', filtered, '--overwrite'], { stdio: 'inherit' });
  execFileSync('osmium', ['cat', filtered, '-f', 'opl', '-o', opl, '--overwrite'], { stdio: 'inherit' });

  const nodePos = new Map();
  const rels = []; // { li, stops:[node id] }
  const rl = readline.createInterface({ input: fs.createReadStream(opl), crlfDelay: Infinity });
  for await (const line of rl) {
    const f = {};
    for (const part of line.split(' ')) f[part[0]] = part.slice(1);
    if (line[0] === 'n') {
      const lon = Number(f.x), lat = Number(f.y);
      if (isFinite(lat) && isFinite(lon)) nodePos.set(Number(line.slice(1, line.indexOf(' '))), [lat, lon]);
    } else if (line[0] === 'r') {
      const t = oplTags(f.T);
      if (!/^(subway|light_rail|monorail|train)$/.test(t.route || '')) continue;
      const name = t['name:ko'] || t.name || '';
      if (t.route === 'train' && (!TRAIN_INCLUDE.test(name) || TRAIN_EXCLUDE.test(name))) continue;
      const li = lineIdx.get(shortLabel(lineKey(name)));
      if (li == null) continue;
      const stopsN = (f.M || '').split(',').filter((m) => m[0] === 'n' && /@(stop|platform)/.test(m)).map((m) => Number(m.slice(1, m.indexOf('@'))));
      if (stopsN.length >= 2) rels.push({ li, stops: stopsN });
    }
  }
  fs.rmSync(work, { recursive: true, force: true });

  const o = sub.lines.map(() => []);
  for (let li = 0; li < sub.lines.length; li++) {
    const cand = sub.stations.map((s, i) => [s, i]).filter(([s]) => (s.l || []).includes(li));
    const seqs = rels.filter((r) => r.li === li).map((r) => {
      const seq = [];
      for (const nid of r.stops) {
        const p = nodePos.get(nid);
        if (!p) continue;
        let best = -1, bd = MATCH_M;
        for (const [s, i] of cand) { const d = distM(p, s.p); if (d < bd) { bd = d; best = i; } }
        if (best >= 0 && !seq.includes(best)) seq.push(best);
      }
      return seq;
    }).filter((s) => s.length >= 2).sort((a, b) => b.length - a.length);
    // 가장 긴 정차 순서 = 본선, 새 역을 3개 이상 더하는 순서 = 지선(최대 4개)
    const covered = new Set();
    for (const seq of seqs) {
      const fresh = seq.filter((i) => !covered.has(i)).length;
      if (o[li].length && fresh < 3) continue;
      o[li].push(seq);
      seq.forEach((i) => covered.add(i));
      if (o[li].length >= 4) break;
    }
  }
  const out = { v: new Date().toISOString().slice(0, 10), o };
  try {
    const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (JSON.stringify(old.o) === JSON.stringify(o)) { console.log('변경 없음'); return; }
  } catch (e) { /* 처음 생성 */ }
  fs.writeFileSync(OUT, JSON.stringify(out));
  const miss = sub.lines.filter((_, i) => !o[i].length).map((l) => l.n);
  console.log('노선도', sub.lines.length - miss.length, '/', sub.lines.length, '호선', miss.length ? '(순서 없음: ' + miss.join(', ') + ')' : '', (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
}
main().catch((e) => { console.error(e); process.exit(1); });
