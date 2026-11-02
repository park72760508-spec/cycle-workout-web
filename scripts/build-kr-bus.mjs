#!/usr/bin/env node
/**
 * 루트맵 버스 정류장 오버레이 데이터 생성 (2026-11-02)
 * OpenStreetMap(Overpass API)에서 국내 버스 정류장(highway=bus_stop)과 버스 노선(route=bus)의 노선번호를 받아
 * 0.1° 격자 타일로 나눈 정적 파일 assets/data/kr-bus/{i}_{j}.json 과 타일 목록 index.json 으로 저장한다.
 * 앱은 줌 16 이상에서 화면 근처 타일만 받는다(실행 중 외부 API 호출 없음).
 *
 * 실행: node scripts/build-kr-bus.mjs        (노선 개편 등으로 갱신이 필요할 때 다시 실행, 수십 분 걸림)
 * 데이터 출처: © OpenStreetMap contributors (ODbL)
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/data/kr-bus');
const UA = 'STELVIO-routemap-build/1.0 (park72760508@gmail.com)';
// kumi 등 대체 서버는 응답이 없는 경우가 많아 공식 서버만 사용
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const CELL = 0.1;         // 앱 타일 크기(도)
const CHUNK = 0.5;        // Overpass 질의 단위(도) — 실패(서버 한도·시간 초과)하면 4등분해 다시(최소 MIN_CHUNK)
const MIN_CHUNK = 0.0625;
const LAT0 = 33.0, LAT1 = 38.7, LON0 = 124.5, LON1 = 131.0;
const NEAR_M = 40;        // 노선 정차 지점(stop_position)과 정류장을 잇는 거리

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 서버 혼잡(429·502 at capacity)은 기다렸다 다시(최대 약 30분), 시간 초과·한도 초과는 실패로 돌려 구간을 4등분하게 */
async function overpass(query, tries = 2) {
  let lastErr, busyWait = 20000, busyTotal = 0;
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(240000)
      });
      const text = await res.text();
      if (res.status === 429 || (res.status === 502 && /at capacity|busy/i.test(text))) {
        if (busyTotal > 1800000) throw new Error('서버 혼잡이 30분 넘게 지속');
        console.warn('  서버 혼잡, ' + Math.round(busyWait / 1000) + '초 뒤 재시도');
        await sleep(busyWait); busyTotal += busyWait; busyWait = Math.min(busyWait * 2, 300000); k--; continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = JSON.parse(text);
      if (d.remark && /runtime error|timed out|out of memory/i.test(d.remark)) throw new Error(d.remark.slice(0, 120));
      return d;
    } catch (e) {
      if (/30분/.test(e.message)) throw e;
      lastErr = e; console.warn('  overpass 실패:', e.message); await sleep(15000);
    }
  }
  throw lastErr;
}
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const cellKey = (lat, lon) => Math.floor(lat / CELL) + '_' + Math.floor(lon / CELL);

async function main() {
  const stops = new Map();      // node id → { lat, lon, n, routes:Set }
  const routeMembers = [];      // { ref, nodes:[id] }
  const nodePos = new Map();    // 노선 구성 노드 위치(정차 지점 → 가까운 정류장 연결용)
  function absorb(d) {
    let ns = 0, nr = 0;
    for (const el of d.elements || []) {
      if (el.type === 'node' && el.tags && el.tags.highway === 'bus_stop') {
        const nm = el.tags['name:ko'] || el.tags.name || '';
        if (!/[가-힣]/.test(nm)) continue; // 국내 정류장만(일본 후쿠오카·쓰시마 등 제외)
        if (!stops.has(el.id)) {
          const t = el.tags;
          stops.set(el.id, { lat: el.lat, lon: el.lon, n: t['name:ko'] || t.name || '', routes: new Set() });
          ns++;
        }
      } else if (el.type === 'node') {
        nodePos.set(el.id, [el.lat, el.lon]);
      } else if (el.type === 'relation') {
        const ref = String(el.tags.ref || '').trim();
        if (!ref) continue;
        routeMembers.push({ ref, nodes: (el.members || []).filter((m) => m.type === 'node').map((m) => m.ref) });
        nr++;
      }
    }
    return [ns, nr];
  }
  async function chunk(la, lo, size) {
    const bb = `${la.toFixed(4)},${lo.toFixed(4)},${(la + size).toFixed(4)},${(lo + size).toFixed(4)}`;
    const q = `[out:json][timeout:180];
node(${bb})["highway"="bus_stop"];
out body qt;
rel(${bb})["route"="bus"]->.r;
.r out body qt;
node(r.r);
out skel qt;`;
    let d;
    try {
      d = await overpass(q, size > MIN_CHUNK ? 1 : 4);
    } catch (e) {
      if (size <= MIN_CHUNK) throw new Error(bb + ' 구간을 받지 못함: ' + e.message);
      const h = size / 2;
      console.log(bb, '→ 4등분');
      for (const [a, b] of [[la, lo], [la, lo + h], [la + h, lo], [la + h, lo + h]]) await chunk(a, b, h);
      return;
    }
    const [ns, nr] = absorb(d);
    if (ns || nr) console.log(bb, '정류장', ns, '노선', nr);
    await sleep(2000);
  }
  for (let la = LAT0; la < LAT1; la += CHUNK) {
    for (let lo = LON0; lo < LON1; lo += CHUNK) {
      if (la < 35 && lo >= 129.5) continue; // 규슈·쓰시마(일본) 해역 — 국내 정류장 없음
      if (la < 37 && lo >= 130) continue;   // 동해 먼바다(울릉도는 위도 37.4~37.6)
      await chunk(la, lo, CHUNK);
    }
  }
  for (const [id, s] of stops) nodePos.set(id, [s.lat, s.lon]);
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
