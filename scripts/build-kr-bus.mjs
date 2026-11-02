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
  const wayNodes = new Map();   // 노선 경로(way) → 노드 목록(경로 근접 추정용)
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
    } else if (line[0] === 'w') {
      wayNodes.set(Number(line.slice(1, line.indexOf(' '))), (f.N || '').split(',').filter(Boolean).map((x) => Number(x.slice(1))));
    } else if (line[0] === 'r') {
      const t = oplTags(f.T);
      if (t.route !== 'bus') continue;
      const ref = String(t.ref || '').trim();
      if (!ref) continue;
      const nodes = (f.M || '').split(',').filter((m) => m[0] === 'n').map((m) => Number(m.slice(1, m.indexOf('@'))));
      const ways = (f.M || '').split(',').filter((m) => m[0] === 'w').map((m) => Number(m.slice(1, m.indexOf('@'))));
      // 광역급행(M버스)·급행은 지나가는 정류장에 서지 않으므로 경로 근접 추정에서 제외
      const express = /^M|급행|직행|공항/.test(ref) || /광역급행|급행|공항/.test(t.network || '') || /급행|공항/.test(t.name || '');
      routeMembers.push({ ref, nodes, ways, express });
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

  const direct = [...stops.values()].filter((x) => x.routes.size).length;

  // ── 노선 정보 없는 정류장 보완(추정, inf 표시) ──
  // 1) 같은 이름 정류장(길 건너편 반대 방향 등) 250m 안에 노선이 있으면 그 노선
  const byName = new Map();
  for (const st of stops.values()) if (st.routes.size) {
    if (!byName.has(st.n)) byName.set(st.n, []);
    byName.get(st.n).push(st);
  }
  let infName = 0;
  for (const st of stops.values()) {
    if (st.routes.size) continue;
    const peers = (byName.get(st.n) || []).filter((o) => Math.hypot((o.lat - st.lat) * 111000, (o.lon - st.lon) * 88000) <= 250);
    if (!peers.length) continue;
    peers.forEach((o) => o.routes.forEach((r) => st.routes.add(r)));
    st.inf = true; infName++;
  }
  // 2) 노선 경로(일반 시내·마을버스)가 20m 안으로 지나가면 그 노선(국내 버스는 경로 위 정류장 대부분 정차)
  const PATH_M = 20, GC = 0.0005;
  const segGrid = new Map(); // 격자 → [[lat1, lon1, lat2, lon2, ref]]
  for (const rm of routeMembers) {
    if (rm.express) continue;
    for (const wid of rm.ways) {
      const ns = wayNodes.get(wid);
      if (!ns) continue;
      for (let i = 1; i < ns.length; i++) {
        const a = nodePos.get(ns[i - 1]), b = nodePos.get(ns[i]);
        if (!a || !b) continue;
        const seg = [a[0], a[1], b[0], b[1], rm.ref];
        const i0 = Math.floor((Math.min(a[0], b[0]) - 0.0003) / GC), i1 = Math.floor((Math.max(a[0], b[0]) + 0.0003) / GC);
        const j0 = Math.floor((Math.min(a[1], b[1]) - 0.0003) / GC), j1 = Math.floor((Math.max(a[1], b[1]) + 0.0003) / GC);
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue; // 비정상적으로 긴 구간
        for (let gi = i0; gi <= i1; gi++) for (let gj = j0; gj <= j1; gj++) {
          const k = gi + ':' + gj;
          if (!segGrid.has(k)) segGrid.set(k, []);
          segGrid.get(k).push(seg);
        }
      }
    }
  }
  function segDistM(lat, lon, s) {
    const ky = 111000, kx = 88000;
    const ax = s[1] * kx, ay = s[0] * ky, bx = s[3] * kx, by = s[2] * ky, px = lon * kx, py = lat * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(ax + t * dx - px, ay + t * dy - py);
  }
  let infPath = 0;
  for (const st of stops.values()) {
    if (st.routes.size) continue;
    const segs = segGrid.get(Math.floor(st.lat / GC) + ':' + Math.floor(st.lon / GC)) || [];
    for (const sg of segs) if (!st.routes.has(sg[4]) && segDistM(st.lat, st.lon, sg) <= PATH_M) st.routes.add(sg[4]);
    if (st.routes.size) { st.inf = true; infPath++; }
  }
  console.log('노선 직접 연결', direct, '/ 같은 이름 보완', infName, '/ 경로 근접 보완', infPath);

  // 타일로 나눠 저장: { r:[노선번호...], s:[[lat, lon, 이름, [노선 인덱스...], 추정이면 1]] }
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
        const row = [r5(s.lat), r5(s.lon), s.n, [...s.routes].sort(byNum).map((r) => ri.get(r))];
        if (s.inf) row.push(1); // 추정 노선
        return row;
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
