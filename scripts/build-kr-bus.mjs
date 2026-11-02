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

  const stops = new Map();      // node id → { lat, lon, n, routes:Map(노선번호 → Set(노선 relation id)) }
  const routeMembers = [];      // { id, ref, name, nodes:[id], roles:[역할], ways:[id], express }
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
        if (/[가-힣]/.test(nm)) { stops.set(id, { lat, lon, n: nm, routes: new Map() }); continue; } // 국내 정류장만
      }
      nodePos.set(id, [lat, lon]);
    } else if (line[0] === 'w') {
      wayNodes.set(Number(line.slice(1, line.indexOf(' '))), (f.N || '').split(',').filter(Boolean).map((x) => Number(x.slice(1))));
    } else if (line[0] === 'r') {
      const t = oplTags(f.T);
      if (t.route !== 'bus') continue;
      const ref = String(t.ref || '').trim();
      if (!ref) continue;
      const nm = (f.M || '').split(',').filter((m) => m[0] === 'n');
      const nodes = nm.map((m) => Number(m.slice(1, m.indexOf('@'))));
      const roles = nm.map((m) => m.slice(m.indexOf('@') + 1));
      const ways = (f.M || '').split(',').filter((m) => m[0] === 'w').map((m) => Number(m.slice(1, m.indexOf('@'))));
      // 광역급행(M버스)·급행은 지나가는 정류장에 서지 않으므로 경로 근접 추정에서 제외
      const express = /^M|급행|직행|공항/.test(ref) || /광역급행|급행|공항/.test(t.network || '') || /급행|공항/.test(t.name || '');
      routeMembers.push({ id: Number(line.slice(1, line.indexOf(' '))), ref, name: t['name:ko'] || t.name || '', nodes, roles, ways, express });
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
  const addRoute = (st, ref, id) => {
    if (!st.routes.has(ref)) st.routes.set(ref, new Set());
    st.routes.get(ref).add(id);
  };
  // 노선 구성 정차 지점 → 정류장 연결 + 노선별 정류장 순서(노선번호 탭 → 정류장 목록 팝업)
  const routeStops = new Map(); // relation id → [정류장 객체…] (운행 순서)
  for (const rm of routeMembers) {
    const seq = [];
    rm.nodes.forEach((nid, i) => {
      let st = stops.get(nid);
      if (!st) {
        const p = nodePos.get(nid);
        if (p) st = nearestStop(p[0], p[1]);
      }
      if (!st) return;
      addRoute(st, rm.ref, rm.id);
      if (/^(stop|platform|bus_stop)/.test(rm.roles[i] || '') || stops.has(nid)) {
        if (seq[seq.length - 1] !== st) seq.push(st); // 정차 지점·승강장이 짝으로 들어간 경우 한 번만
      }
    });
    if (seq.length >= 2) routeStops.set(rm.id, seq);
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
    peers.forEach((o) => o.routes.forEach((ids, ref) => ids.forEach((id) => addRoute(st, ref, id))));
    st.inf = true; infName++;
  }
  // 2) 노선 경로(일반 시내·마을버스)가 20m 안으로 지나가면 그 노선(국내 버스는 경로 위 정류장 대부분 정차)
  const PATH_M = 20, GC = 0.0005;
  const segGrid = new Map(); // 격자 → [[lat1, lon1, lat2, lon2, ref, relation id]]
  for (const rm of routeMembers) {
    if (rm.express) continue;
    for (const wid of rm.ways) {
      const ns = wayNodes.get(wid);
      if (!ns) continue;
      for (let i = 1; i < ns.length; i++) {
        const a = nodePos.get(ns[i - 1]), b = nodePos.get(ns[i]);
        if (!a || !b) continue;
        const seg = [a[0], a[1], b[0], b[1], rm.ref, rm.id];
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
    for (const sg of segs) if (segDistM(st.lat, st.lon, sg) <= PATH_M) addRoute(st, sg[4], sg[5]);
    if (st.routes.size) { st.inf = true; infPath++; }
  }
  // 3) 정차 지점 없이 경로만 있는 노선(서울 등): 경로를 따라가며 20m 안 정류장을 순서대로 → 노선 정류장 목록(추정)
  const routeEst = new Set();
  for (const rm of routeMembers) {
    if (routeStops.has(rm.id) || rm.express) continue;
    const seq = [];
    let prevEnd = null;
    rm.ways.forEach((wid, wi) => {
      let ns = wayNodes.get(wid);
      if (!ns || ns.length < 2) return;
      // 운행 방향으로 way 뒤집기: 앞 way 끝과 이어지는 쪽이 시작
      const nextWay = wayNodes.get(rm.ways[wi + 1]);
      const last = ns[ns.length - 1], first = ns[0];
      if (prevEnd != null ? (last === prevEnd && first !== prevEnd) : (nextWay && (first === nextWay[0] || first === nextWay[nextWay.length - 1]) && last !== nextWay[0] && last !== nextWay[nextWay.length - 1])) ns = ns.slice().reverse();
      prevEnd = ns[ns.length - 1];
      for (let i = 1; i < ns.length; i++) {
        const a2 = nodePos.get(ns[i - 1]), b2 = nodePos.get(ns[i]);
        if (!a2 || !b2) continue;
        const sg = [a2[0], a2[1], b2[0], b2[1]];
        const found = [];
        const i0 = Math.round((Math.min(a2[0], b2[0])) / 0.0005) - 1, i1 = Math.round((Math.max(a2[0], b2[0])) / 0.0005) + 1;
        const j0 = Math.round((Math.min(a2[1], b2[1])) / 0.0005) - 1, j1 = Math.round((Math.max(a2[1], b2[1])) / 0.0005) + 1;
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue;
        for (let gi = i0; gi <= i1; gi++) for (let gj = j0; gj <= j1; gj++) {
          for (const sid of g.get(gi + ':' + gj) || []) {
            const st = stops.get(sid);
            if (segDistM(st.lat, st.lon, sg) > PATH_M) continue;
            // 우측 통행: 진행 방향 오른쪽 정류장만(길 건너 반대 방향 정류장 제외)
            const cross = (b2[1] - a2[1]) * 88000 * (st.lat - a2[0]) * 111000 - (b2[0] - a2[0]) * 111000 * (st.lon - a2[1]) * 88000;
            if (cross > 0) continue;
            const t = ((st.lat - a2[0]) * (b2[0] - a2[0]) + (st.lon - a2[1]) * (b2[1] - a2[1])) / (((b2[0] - a2[0]) ** 2 + (b2[1] - a2[1]) ** 2) || 1e-12);
            found.push([t, st]);
          }
        }
        found.sort((x, y) => x[0] - y[0]).forEach(([, st]) => {
          if (!seq.includes(st) && !(seq.length && seq[seq.length - 1].n === st.n)) seq.push(st);
        });
      }
    });
    if (seq.length >= 2) { routeStops.set(rm.id, seq); routeEst.add(rm.id); seq.forEach((st) => addRoute(st, rm.ref, rm.id)); }
  }
  console.log('노선 직접 연결', direct, '/ 같은 이름 보완', infName, '/ 경로 근접 보완', infPath);

  const rmById = new Map(routeMembers.map((rm) => [rm.id, rm]));
  // ── 공식 데이터(서울 열린데이터광장·국토교통부 TAGO, scripts/fetch-kr-bus-official.mjs) 우선 ──
  // 공식 정류소 150m 안의 OSM 정류소는 버리고, 정류소 절반 이상이 공식 정류소 근처인 OSM 노선도 버림(공식이 없는 곳만 OSM 유지)
  const OFFICIAL = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../.cache/kr-bus-official/merged.json');
  let officialN = 0;
  if (fs.existsSync(OFFICIAL)) {
    const off = JSON.parse(fs.readFileSync(OFFICIAL, 'utf8'));
    const og = new Map(); // 약 150m 격자
    const ogk = (a2, b2) => Math.round(a2 / 0.0015) + ':' + Math.round(b2 / 0.0015);
    for (const [sid, v] of Object.entries(off.stops)) {
      if (!v) continue;
      const k = ogk(v[1], v[2]);
      if (!og.has(k)) og.set(k, []);
      og.get(k).push(v);
    }
    const nearOfficial = (lat, lon, m) => {
      const i0 = Math.round(lat / 0.0015), j0 = Math.round(lon / 0.0015);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        for (const v of og.get((i0 + di) + ':' + (j0 + dj)) || []) if (Math.hypot((v[1] - lat) * 111000, (v[2] - lon) * 88000) <= m) return true;
      }
      return false;
    };
    for (const [id, seq] of [...routeStops]) {
      if (seq.filter((st) => nearOfficial(st.lat, st.lon, 150)).length >= seq.length / 2) { routeStops.delete(id); routeEst.delete(id); }
    }
    for (const [id, st] of [...stops]) if (nearOfficial(st.lat, st.lon, 150)) stops.delete(id);
    // 같은 실제 정류장이 출처별로 따로 있는 경우(서울 정류소 + 서울을 지나는 경기 노선의 TAGO 정류소) 하나로 합침:
    // 이름이 같고 40m 안, 또는 이름과 상관없이 15m 안 — 서울(S) 정류소를 먼저 기준으로 둠
    const offStop = new Map(), cg = new Map();
    const cgk = (a2, b2) => Math.round(a2 / 0.0005) + ':' + Math.round(b2 / 0.0005);
    const norm = (n) => String(n || '').replace(/[\s.·()]/g, '');
    const entries = Object.entries(off.stops).filter(([, v]) => v).sort((x, y) => (x[0][0] === 'S' ? 0 : 1) - (y[0][0] === 'S' ? 0 : 1));
    let mergedN = 0;
    for (const [sid, v] of entries) {
      const i0 = Math.round(v[1] / 0.0005), j0 = Math.round(v[2] / 0.0005);
      let hit = null;
      for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) {
        for (const c of cg.get((i0 + di) + ':' + (j0 + dj)) || []) {
          const d = Math.hypot((c.lat - v[1]) * 111000, (c.lon - v[2]) * 88000);
          if (d <= 15 || (d <= 40 && norm(c.n) === norm(v[0]))) { hit = c; break; }
        }
      }
      if (hit) { offStop.set(sid, hit); mergedN++; continue; }
      const st = { lat: v[1], lon: v[2], n: v[0], routes: new Map() };
      offStop.set(sid, st);
      stops.set(sid, st);
      const k = cgk(v[1], v[2]);
      if (!cg.has(k)) cg.set(k, []);
      cg.get(k).push(st);
    }
    console.log('출처별 중복 정류소 합침', mergedN);
    for (const r of off.routes) {
      const seq = r.s.map((sid) => offStop.get(sid)).filter((st, i, a) => st && a[i - 1] !== st);
      if (seq.length < 2) continue;
      seq.forEach((st) => addRoute(st, r.n, r.id));
      routeStops.set(r.id, seq);
      rmById.set(r.id, { ref: r.n, name: r.t });
    }
    officialN = off.routes.length;
    console.log('공식 데이터 반영: 노선(방향별)', off.routes.length, '정류소', new Set(offStop.values()).size, off.tago ? `(TAGO ${off.tago.have}/${off.tago.total} 노선 수집)` : '');
  }

  // 타일로 나눠 저장: { r:[[노선번호, [노선(방향) id…]]…], s:[[lat, lon, 이름, [노선 항목 인덱스...], 추정이면 1]] }
  // 노선 정류장 목록: routes/{relation id}.json = { n:노선번호, t:노선 이름, s:[[이름, lat, lon]…] } (운행 순서)
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
    // 노선 항목 = (노선번호, 그 정류장에 실제로 서는 노선 id들) — 같은 번호의 다른 지역 노선이 섞이지 않게 정류장 기준으로 묶음
    const entKey = new Map(), ents = [];
    const entOf = (ref, ids) => {
      const keep = [...ids].filter((id) => routeStops.has(id)).map(String).sort();
      const k = ref + '|' + keep.join(',');
      if (!entKey.has(k)) { entKey.set(k, ents.length); ents.push([ref, keep]); }
      return entKey.get(k);
    };
    const out = {
      r: ents,
      s: list.map((s) => {
        if (s.routes.size) withRoutes++;
        const row = [r5(s.lat), r5(s.lon), s.n, [...s.routes.keys()].sort(byNum).map((r) => entOf(r, s.routes.get(r)))];
        if (s.inf) row.push(1); // 추정 노선
        return row;
      })
    };
    const js = JSON.stringify(out);
    bytes += js.length;
    files.set(k + '.json', js);
  }
  for (const [id, seq] of routeStops) {
    const rm = rmById.get(id);
    const js = JSON.stringify(Object.assign({ n: rm.ref, t: rm.name, s: seq.map((st) => [st.n, r5(st.lat), r5(st.lon)]) }, routeEst.has(id) ? { e: 1 } : {}));
    bytes += js.length;
    files.set('routes/' + id + '.json', js);
  }
  // ── 대중교통 경로 찾기용 권역 그래프(2026-11-03): graph/{권역}.json ──
  // { s:[lat*1e5, lon*1e5, …](정류장 좌표, 정수), n:[정류장 이름…], r:[[노선번호, 노선 이름, [정류장 인덱스…]]…] }
  // 앱(루트맵 대중교통 경로)이 출발·도착이 함께 들어가는 가장 작은 권역 파일만 받아 지하철 노선과 합쳐 계산
  const REGIONS = {
    capital: [36.85, 126.3, 38.35, 127.95], busan: [34.7, 127.6, 35.95, 129.6], daegu: [35.5, 127.8, 37.2, 129.6],
    gwangju: [34.2, 125.9, 35.5, 127.9], daejeon: [35.9, 126.1, 37.1, 128.1], jeonbuk: [35.3, 126.4, 36.2, 127.9],
    gangwon: [37.0, 127.4, 38.6, 129.4], jeju: [33.1, 126.1, 33.6, 127.0]
  };
  for (const [rg, bb] of Object.entries(REGIONS)) {
    const inside = (st) => st.lat >= bb[0] && st.lat <= bb[2] && st.lon >= bb[1] && st.lon <= bb[3];
    const idx = new Map(), S = [], N = [], R = [];
    for (const [id, seq] of routeStops) {
      if (!seq.some(inside)) continue;
      const rm = rmById.get(id) || {};
      // 일반 이용객이 아무 정류장에서나 탈 수 없는 노선은 경로 찾기에서 제외(지도·노선 목록에는 그대로)
      if (/공항|예약|리무진|출근|퇴근|투어|관광|학생|통학|새벽|심야|올빼미/.test((rm.ref || '') + ' ' + (rm.name || '')) || /^N\d/.test(rm.ref || '')) continue;
      const q = seq.filter((st) => !/\(가상\)|가상정류장/.test(st.n)).map((st) => {
        if (!idx.has(st)) { idx.set(st, N.length); S.push(Math.round(st.lat * 1e5), Math.round(st.lon * 1e5)); N.push(st.n); }
        return idx.get(st);
      });
      R.push([rm.ref || '', rm.name || '', q]);
    }
    const js = JSON.stringify({ v: 1, bb, s: S, n: N, r: R });
    bytes += js.length;
    files.set('graph/' + rg + '.json', js);
  }

  // 내용이 그대로면 파일을 건드리지 않음(자동 갱신 작업이 변경 여부로 배포를 판단)
  const oldNames = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR, { recursive: true }).filter((f) => f.endsWith('.json') && f !== 'index.json') : [];
  const same = oldNames.length === files.size &&
    [...files].every(([f, js]) => fs.existsSync(path.join(OUT_DIR, f)) && fs.readFileSync(path.join(OUT_DIR, f), 'utf8') === js);
  if (same) { console.log('변경 없음'); return; }
  // 서버가 일부만 돌려준 경우 대비: 정류장 수가 이전보다 20% 넘게 줄면 저장하지 않고 실패
  try {
    const prevIdx = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'index.json'), 'utf8'));
    const prevN = prevIdx.n || 0;
    // 공식 데이터 범위가 바뀐 실행(정류소 합침·교체로 수가 크게 달라짐)은 비교하지 않음
    if (prevN && (prevIdx.o || 0) === officialN && stops.size < prevN * 0.8) throw new Error(`정류장 수 급감(${prevN} → ${stops.size}) — 저장 중단`);
  } catch (e) { if (/급감/.test(e.message)) throw e; }
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, 'routes'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'graph'), { recursive: true });
  for (const [f, js] of files) fs.writeFileSync(path.join(OUT_DIR, f), js);
  const index = { v: new Date().toISOString().slice(0, 10), src: '© OpenStreetMap contributors (ODbL)', cell: CELL, n: stops.size, o: officialN, t: [...tiles.keys()].sort() };
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index));
  console.log('노선 정류장 목록', routeStops.size, '개(경로 추정', routeEst.size, ')');
  console.log('타일', tiles.size, '개, 합계', (bytes / 1024 / 1024).toFixed(1), 'MB, 노선번호 있는 정류장', withRoutes, '/', stops.size);
}
main().catch((e) => { console.error(e); process.exit(1); });
