#!/usr/bin/env node
/**
 * 루트맵 버스 정류장 오버레이 데이터 생성 (2026-11-02)
 * Geofabrik 국내 OSM 추출본(south-korea-latest.osm.pbf, 매일 갱신)에서 osmium 으로 버스 정류장(highway=bus_stop)과
 * 버스 노선(route=bus)만 걸러 노선번호를 정류장에 붙이고, 0.1° 격자 타일 assets/data/kr-bus/{i}_{j}.json + index.json 으로 저장.
 * 앱은 줌 16 이상에서 화면 근처 타일만 받는다(실행 중 외부 API 호출 없음).
 * (Overpass API 는 전국 단위 질의에서 혼잡·시간 초과가 잦아 추출본 방식으로 변경)
 *
 * 필요: osmium-tool (macOS: brew install osmium-tool / Ubuntu: apt-get install osmium-tool)
 * 실행: node scripts/build-kr-bus.mjs [--pbf 기존파일.osm.pbf]   (약 5분, 대부분 290MB 내려받기)
 * 데이터 출처: © OpenStreetMap contributors (ODbL)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';

const OUT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/data/kr-bus');
const PBF_URL = 'https://download.geofabrik.de/asia/south-korea-latest.osm.pbf';
const CELL = 0.1;         // 앱 타일 크기(도)
const NEAR_M = 40;        // 노선 정차 지점(stop_position)과 정류장을 잇는 거리

const r5 = (v) => Math.round(v * 1e5) / 1e5;
const cellKey = (lat, lon) => Math.floor(lat / CELL) + '_' + Math.floor(lon / CELL);
/** OPL 문자열 복원: %hex% → 문자 */
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

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kr-bus-'));
  const argPbf = process.argv.indexOf('--pbf');
  let pbf = argPbf > 0 ? process.argv[argPbf + 1] : '';
  if (!pbf) {
    pbf = path.join(work, 'kr.osm.pbf');
    console.log('OSM 추출본 내려받는 중…');
    execFileSync('curl', ['-sSfL', '--retry', '3', '-o', pbf, PBF_URL], { stdio: 'inherit' });
  }
  console.log('버스 정류장·노선 거르는 중…');
  const filtered = path.join(work, 'bus.pbf'), opl = path.join(work, 'bus.opl');
  execFileSync('osmium', ['tags-filter', pbf, 'n/highway=bus_stop', 'r/route=bus', '-o', filtered, '--overwrite'], { stdio: 'inherit' });
  execFileSync('osmium', ['cat', filtered, '-f', 'opl', '-o', opl, '--overwrite'], { stdio: 'inherit' });

  const stops = new Map();      // node id → { lat, lon, n, routes:Set }
  const routeMembers = [];      // { ref, nodes:[id] }
  const nodePos = new Map();    // 노선 구성 노드 위치(정차 지점 → 가까운 정류장 연결용)
  const rl = readline.createInterface({ input: fs.createReadStream(opl), crlfDelay: Infinity });
  for await (const line of rl) {
    const f = {};
    for (const part of line.split(' ')) f[part[0]] = part.slice(1);
    if (line[0] === 'n') {
      const id = Number(line.slice(1, line.indexOf(' ')));
      const lon = Number(f.x), lat = Number(f.y);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const t = oplTags(f.T);
      if (t.highway === 'bus_stop') {
        const nm = t['name:ko'] || t.name || '';
        if (/[가-힣]/.test(nm)) { stops.set(id, { lat, lon, n: nm, routes: new Set() }); continue; } // 국내 정류장만
      }
      nodePos.set(id, [lat, lon]);
    } else if (line[0] === 'r') {
      const t = oplTags(f.T);
      if (t.route !== 'bus') continue;
      const ref = String(t.ref || '').trim();
      if (!ref) continue;
      const nodes = (f.M || '').split(',').filter((m) => m[0] === 'n').map((m) => Number(m.slice(1, m.indexOf('@'))));
      routeMembers.push({ ref, nodes });
    }
  }
  fs.rmSync(work, { recursive: true, force: true });
  console.log('정류장 합계', stops.size, '노선 관계', routeMembers.length);

  // 정류장 격자(약 0.0005° ≈ 50m)
  const g = new Map();
  const gk = (a, b) => Math.round(a / 0.0005) + ':' + Math.round(b / 0.0005);
  for (const [id, s] of stops) {
    const k = gk(s.lat, s.lon);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(id);
  }
  function nearestStop(lat, lon) {
    const i0 = Math.round(lat / 0.0005), j0 = Math.round(lon / 0.0005);
    let best = null, bd = NEAR_M * NEAR_M;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const id of g.get((i0 + di) + ':' + (j0 + dj)) || []) {
        const s = stops.get(id);
        const dy = (s.lat - lat) * 111000, dx = (s.lon - lon) * 88000;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = s; }
      }
    }
    return best;
  }
  for (const rm of routeMembers) {
    for (const nid of rm.nodes) {
      const s = stops.get(nid);
      if (s) { s.routes.add(rm.ref); continue; }
      const p = nodePos.get(nid);
      if (!p) continue;
      const near = nearestStop(p[0], p[1]);
      if (near) near.routes.add(rm.ref);
    }
  }

  // 타일로 나눠 저장: { r:[노선번호...], s:[[lat, lon, 이름, [노선 인덱스...]]] }
  const tiles = new Map();
  for (const s of stops.values()) {
    const k = cellKey(s.lat, s.lon);
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(s);
  }
  const byNum = (a, b) => a.localeCompare(b, 'ko', { numeric: true });
  const files = new Map();
  let bytes = 0, withRoutes = 0;
  for (const [k, list] of tiles) {
    const refs = [...new Set(list.flatMap((s) => [...s.routes]))].sort(byNum);
    const ri = new Map(refs.map((r, i) => [r, i]));
    const out = {
      r: refs,
      s: list.map((s) => {
        if (s.routes.size) withRoutes++;
        return [r5(s.lat), r5(s.lon), s.n, [...s.routes].sort(byNum).map((r) => ri.get(r))];
      })
    };
    const js = JSON.stringify(out);
    bytes += js.length;
    files.set(k + '.json', js);
  }
  // 내용이 그대로면 파일을 건드리지 않음(자동 갱신 작업이 변경 여부로 배포를 판단)
  const oldNames = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => f !== 'index.json') : [];
  const same = oldNames.length === files.size &&
    [...files].every(([f, js]) => fs.existsSync(path.join(OUT_DIR, f)) && fs.readFileSync(path.join(OUT_DIR, f), 'utf8') === js);
  if (same) { console.log('변경 없음'); return; }
  // 서버가 일부만 돌려준 경우 대비: 정류장 수가 이전보다 20% 넘게 줄면 저장하지 않고 실패
  try {
    const prevN = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'index.json'), 'utf8')).n || 0;
    if (prevN && stops.size < prevN * 0.8) throw new Error(`정류장 수 급감(${prevN} → ${stops.size}) — 저장 중단`);
  } catch (e) { if (/급감/.test(e.message)) throw e; }
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [f, js] of files) fs.writeFileSync(path.join(OUT_DIR, f), js);
  const index = { v: new Date().toISOString().slice(0, 10), src: '© OpenStreetMap contributors (ODbL)', cell: CELL, n: stops.size, t: [...tiles.keys()].sort() };
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index));
  console.log('타일', tiles.size, '개, 합계', (bytes / 1024 / 1024).toFixed(1), 'MB, 노선번호 있는 정류장', withRoutes, '/', stops.size);
}
main().catch((e) => { console.error(e); process.exit(1); });
