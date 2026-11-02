#!/usr/bin/env node
/**
 * 루트맵 지하철 오버레이 데이터 생성 (2026-11-02)
 * OpenStreetMap(Overpass API)에서 국내 도시철도·경전철·수도권 광역전철 노선(호선 색상 포함)과 역을 받아
 * 용량을 줄인 정적 파일 assets/data/kr-subway.json 으로 저장한다. 앱은 실행 중 외부 API를 호출하지 않는다.
 *
 * 실행: node scripts/build-kr-subway.mjs        (노선 개통 등으로 갱신이 필요할 때 다시 실행)
 * 데이터 출처: © OpenStreetMap contributors (ODbL)
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/data/kr-subway.json');
const UA = 'STELVIO-routemap-build/1.0 (park72760508@gmail.com)';
const BBOX = '33.0,124.5,38.7,129.65';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

// 일반 열차(route=train) 중 지도에 넣을 수도권·광역 전철만
const TRAIN_INCLUDE = /경의.?중앙|수인.?분당|신분당|인천국제공항철도 일반|경춘선|경강선|서해선|광역급행철도|동해선 광역|대경선/;
const TRAIN_EXCLUDE = /ITX|무궁화|직통|평택선|교외선/;

async function overpass(query) {
  let lastErr;
  for (const url of [...ENDPOINTS, ...ENDPOINTS, ...ENDPOINTS]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      });
      if (!res.ok) throw new Error(url + ' HTTP ' + res.status);
      return await res.json();
    } catch (e) { lastErr = e; console.warn('overpass 실패, 재시도:', e.message); await new Promise((r) => setTimeout(r, 8000)); }
  }
  throw lastErr;
}

/** "서울 지하철 2호선: 내선순환" → 같은 호선끼리 묶는 키와 표시명 */
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

// Douglas–Peucker (위경도 근사, tol 도 단위)
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-18;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0 && max > tol * tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r5 = (v) => Math.round(v * 1e5) / 1e5;

async function main() {
  console.log('노선 조회 중…');
  // 국가 영역(area) 질의는 서버 시간 초과가 잦아 국내 범위 박스 + 한글 노선명으로 거른다(후쿠오카 등 제외)
  const q = `[out:json][timeout:180];
(
  rel(${BBOX})["route"~"^(subway|light_rail|monorail)$"];
  rel(${BBOX})["route"="train"]["colour"];
);
out geom;`;
  const data = await overpass(q);
  const lines = new Map();
  for (const rel of data.elements || []) {
    const t = rel.tags || {};
    const name = t['name:ko'] || t.name || '';
    if (t.route === 'train' && (!TRAIN_INCLUDE.test(name) || TRAIN_EXCLUDE.test(name))) continue;
    if (!t.colour || !/[가-힣]/.test(name)) continue;
    const key = lineKey(name);
    if (!key) continue;
    let L = lines.get(key);
    if (!L) { L = { key, label: shortLabel(key), colour: t.colour, ways: new Map(), stops: [] }; lines.set(key, L); }
    for (const m of rel.members || []) {
      // 정차 지점(stop·platform 노드) — 역마다 실제로 서는 호선을 찾는 데 사용
      if (m.type === 'node' && /^(stop|platform)/.test(m.role || '') && m.lat != null) { L.stops.push([m.lat, m.lon]); continue; }
      if (m.type !== 'way' || !Array.isArray(m.geometry) || m.geometry.length < 2) continue;
      if (m.role && /platform/.test(m.role)) continue;
      if (!L.ways.has(m.ref)) L.ways.set(m.ref, m.geometry.map((g) => [g.lat, g.lon]));
    }
  }
  const outLines = [];
  const grid = new Map(); // 역이 노선 근처인지 확인용(약 0.002° 격자)
  for (const L of lines.values()) {
    const segs = [];
    for (const pts of L.ways.values()) {
      const s = simplify(pts, 0.00003).map(([a, b]) => [r5(a), r5(b)]);
      if (s.length >= 2) segs.push(s);
      for (const [a, b] of pts) {
        const gk = Math.round(a / 0.002) + ':' + Math.round(b / 0.002);
        if (!grid.has(gk)) grid.set(gk, new Set());
        grid.get(gk).add(L.key);
      }
    }
    // 2026-11-02: 지도에는 역만 표시(노선 선 제거) → 선형(g)은 저장하지 않고 이름·색만
    if (segs.length) { L.idx = outLines.length; outLines.push({ n: L.label, c: L.colour }); }
  }
  const lineList = [...lines.values()].filter((L) => L.idx != null);
  /** 이 역에 서는 호선: 정차 지점이 300m 안에 있는 노선(없으면 선로가 지나가는 노선) */
  function linesAt(lat, lon, nearKeys) {
    const dLat = 0.0027, dLon = 0.0034;
    const hit = lineList.filter((L) => L.stops.some(([a, b]) => Math.abs(a - lat) < dLat && Math.abs(b - lon) < dLon));
    const use = hit.length ? hit : lineList.filter((L) => nearKeys.has(L.key));
    return use.map((L) => L.idx).sort((a, b) => a - b);
  }
  console.log('노선', outLines.length, '개');

  console.log('역 조회 중…');
  const sq = `[out:json][timeout:120];
node(${BBOX})["railway"="station"]["name"];
out;`;
  const sdata = await overpass(sq);
  const stations = [];
  const seen = [];
  for (const n of sdata.elements || []) {
    const name = (n.tags && (n.tags['name:ko'] || n.tags.name)) || '';
    if (!name) continue;
    const gi = Math.round(n.lat / 0.002), gj = Math.round(n.lon / 0.002);
    const near = new Set();
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const s = grid.get((gi + di) + ':' + (gj + dj));
      if (s) s.forEach((k) => near.add(k));
    }
    if (!near.size) continue;
    const l = linesAt(n.lat, n.lon, near);
    if (!l.length) continue;
    // 같은 이름 역(호선마다 따로 찍힌 역 지점)이 약 650m 안에 있으면 한 점으로 합침: 위치 평균, 호선 합집합
    const dup = seen.find((o) => o.n === name && Math.abs(o.a - n.lat) < 0.006 && Math.abs(o.b - n.lon) < 0.007);
    if (dup) {
      dup.cnt += 1;
      dup.sa += n.lat; dup.sb += n.lon;
      dup.st.p = [r5(dup.sa / dup.cnt), r5(dup.sb / dup.cnt)];
      dup.st.l = [...new Set(dup.st.l.concat(l))].sort((x, y) => x - y);
      continue;
    }
    const stObj = { n: name.replace(/역$/, ''), p: [r5(n.lat), r5(n.lon)], l };
    seen.push({ n: name, a: n.lat, b: n.lon, sa: n.lat, sb: n.lon, cnt: 1, st: stObj });
    stations.push(stObj);
  }
  console.log('역', stations.length, '개');

  const out = { v: new Date().toISOString().slice(0, 10), src: '© OpenStreetMap contributors (ODbL)', lines: outLines, stations };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('저장:', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
}
main().catch((e) => { console.error(e); process.exit(1); });
