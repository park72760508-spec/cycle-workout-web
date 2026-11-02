#!/usr/bin/env node
/**
 * 공식 버스 노선·경유 정류소 수집 (2026-11-03) → build-kr-bus.mjs 가 OSM 대신 우선 사용
 *  - 서울: 서울 열린데이터광장 '서울시 버스노선별 정류소 정보'(OA-1095) 최신 엑셀(인증키 불필요)
 *  - 그 밖(경기 시·군 포함 138개 도시): 국토교통부 TAGO 버스노선정보 API(공공데이터포털 인증키)
 * 결과: .cache/kr-bus-official/merged.json = { stops: {id: [이름, lat, lon]}, routes: [{id, n, t, s:[정류소 id…]}] }
 *
 * TAGO 는 노선마다 1회 호출(전국 약 2.1만 노선)이라 개발계정 하루 호출 한도를 넘는다 →
 * 응답을 캐시해 두고 한 번에 MAX_CALLS(기본 9000)회까지만 호출, 없는 노선부터·오래된 노선 순으로 채움(여러 날에 걸쳐 완성·갱신).
 * 인증키: 환경변수 DATA_GO_KR_KEY, 없으면 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 로 Vault(fn_service_get_api_key('data_go_kr'))
 * 실행: node scripts/fetch-kr-bus-official.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache/kr-bus-official');
const TAGO = 'https://apis.data.go.kr/1613000/BusRouteInfoInqireService';
const MAX_CALLS = Number(process.env.MAX_CALLS || 9000);
const ROUTE_TTL_DAYS = 30; // 이보다 오래된 노선은 다시 받음
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(CACHE, 'tago'), { recursive: true });

async function getKey() {
  let k = process.env.DATA_GO_KR_KEY || '';
  if (!k && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/rpc/fn_service_get_api_key', {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_name: 'data_go_kr' })
    });
    k = r.ok ? await r.json() : '';
  }
  if (!k) throw new Error('공공데이터포털 인증키가 없습니다(DATA_GO_KR_KEY 또는 Supabase Vault).');
  return /%[0-9A-F]{2}/i.test(k) ? decodeURIComponent(k) : k; // 인코딩된 키로 저장된 경우
}

let calls = 0, limited = false;
async function tago(op, params, key) {
  if (calls >= MAX_CALLS || limited) return null;
  const q = new URLSearchParams(Object.assign({ _type: 'json', serviceKey: key }, params));
  for (let k = 0; k < 3; k++) {
    calls++;
    try {
      const res = await fetch(TAGO + '/' + op + '?' + q, { signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS|resultCode>22</.test(text)) { limited = true; console.warn('하루 호출 한도 도달 — 다음 실행에서 이어서'); return null; }
      const j = JSON.parse(text);
      const h = j.response && j.response.header;
      if (h && h.resultCode !== '00') throw new Error(h.resultCode + ' ' + h.resultMsg);
      const body = j.response.body;
      let items = body.items && body.items.item;
      items = !items ? [] : Array.isArray(items) ? items : [items];
      return { items, total: Number(body.totalCount || 0) };
    } catch (e) {
      console.warn('  TAGO 재시도', op, e.message);
      await sleep(3000);
    }
  }
  return null;
}

/** 서울 열린데이터광장 OA-1095 최신 '서울시버스노선별정류소정보' 엑셀 → 노선 */
async function fetchSeoul() {
  const page = await (await fetch('https://data.seoul.go.kr/dataList/OA-1095/F/1/datasetView.do', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const files = [...page.matchAll(/서울시버스노선별정류소정보\((\d{8})\)\.xlsx[^]*?downloadFile\('(\d+)'\)/g)].map((m) => ({ d: m[1], seq: m[2] }));
  if (!files.length) throw new Error('서울 파일 목록을 찾지 못함');
  files.sort((a, b) => b.d.localeCompare(a.d));
  const latest = files[0];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'seoul-bus-'));
  const xlsx = path.join(work, 'r.xlsx');
  const res = await fetch('https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false', {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://data.seoul.go.kr/dataList/OA-1095/F/1/datasetView.do', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'infId=OA-1095&seqNo=&seq=' + latest.seq + '&infSeq=2'
  });
  fs.writeFileSync(xlsx, Buffer.from(await res.arrayBuffer()));
  const shared = execFileSync('unzip', ['-p', xlsx, 'xl/sharedStrings.xml'], { maxBuffer: 1 << 28 }).toString();
  const sheet = execFileSync('unzip', ['-p', xlsx, 'xl/worksheets/sheet1.xml'], { maxBuffer: 1 << 29 }).toString();
  fs.rmSync(work, { recursive: true, force: true });
  const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const ss = [...shared.matchAll(/<si>([^]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([^]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rows = [];
  for (const m of sheet.matchAll(/<row [^>]*>([^]*?)<\/row>/g)) {
    const cells = {};
    for (const c of m[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>([^<]*)<\/v>)?<\/c>/g)) {
      const v = c[3] == null ? '' : (/t="s"/.test(c[2]) ? ss[Number(c[3])] : c[3]);
      cells[c[1]] = v;
    }
    rows.push(cells);
  }
  // 열: A ROUTE_ID, B 노선명, C 순번, D NODE_ID, E ARS_ID, F 정류소명, G X좌표(경도), H Y좌표(위도)
  const stops = {}, byRoute = new Map();
  for (const r of rows.slice(1)) {
    const lon = Number(r.G), lat = Number(r.H);
    if (!r.A || !r.D || !(lat > 33 && lon > 124)) continue;
    const sid = 'S' + r.D;
    stops[sid] = [String(r.F || '').trim(), Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5];
    if (!byRoute.has(r.A)) byRoute.set(r.A, { n: String(r.B || '').trim(), seq: [] });
    byRoute.get(r.A).seq.push([Number(r.C), sid]);
  }
  const routes = [];
  for (const [rid, r] of byRoute) {
    const seq = r.seq.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    splitRoundTrip('S' + rid, r.n, seq, stops).forEach((x) => routes.push(Object.assign(x, { rid })));
  }
  console.log('서울', latest.d, '노선', byRoute.size, '정류소', Object.keys(stops).length);
  return { stops, routes };
}

/** 왕복이 한 줄로 이어진 노선 → 기점에서 가장 먼 정류소(회차 지점)에서 나눠 방향 2개 */
function splitRoundTrip(id, n, seq, stops) {
  if (seq.length < 4) return [{ id, n, t: n, s: seq }];
  const p0 = stops[seq[0]];
  let far = 0, fd = -1;
  seq.forEach((sid, i) => { const p = stops[sid]; const d = (p[1] - p0[1]) ** 2 + ((p[2] - p0[2]) * 0.8) ** 2; if (d > fd) { fd = d; far = i; } });
  const a = seq.slice(0, far + 1), b = seq.slice(far);
  const nm = (x) => stops[x] ? stops[x][0] : '';
  const out = [{ id: id + '_1', n, t: n + ' (' + nm(a[a.length - 1]) + ' 방면)', s: a }];
  if (b.length >= 2) out.push({ id: id + '_2', n, t: n + ' (' + nm(b[b.length - 1]) + ' 방면)', s: b });
  return out;
}

async function fetchTago(key) {
  const cityFile = path.join(CACHE, 'cities.json');
  let cities = fs.existsSync(cityFile) ? JSON.parse(fs.readFileSync(cityFile, 'utf8')) : null;
  if (!cities) {
    const r = await tago('getCtyCodeList', { numOfRows: 500 }, key);
    if (!r) throw new Error('TAGO 도시 목록을 받지 못함');
    cities = r.items.map((c) => ({ code: c.citycode, name: c.cityname }));
    fs.writeFileSync(cityFile, JSON.stringify(cities));
  }
  // 도시별 노선 목록(30일마다 갱신)
  const allRoutes = [];
  for (const c of cities) {
    const f = path.join(CACHE, 'tago', 'routes-' + c.code + '.json');
    let list = null;
    if (fs.existsSync(f)) {
      const o = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Date.now() - o.at < ROUTE_TTL_DAYS * 864e5) list = o.items;
    }
    if (!list) {
      const r = await tago('getRouteNoList', { cityCode: c.code, numOfRows: 2000 }, key);
      if (r) { list = r.items; fs.writeFileSync(f, JSON.stringify({ at: Date.now(), items: list })); }
      else if (fs.existsSync(f)) list = JSON.parse(fs.readFileSync(f, 'utf8')).items;
      else list = [];
    }
    list.forEach((it) => allRoutes.push({ city: c.code, it }));
  }
  // 노선별 경유 정류소: 없는 것 먼저, 그다음 오래된 순
  const ageOf = (rid) => { const f = path.join(CACHE, 'tago', 'r-' + rid + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).at : 0; };
  const todo = allRoutes.map((x) => ({ x, age: ageOf(x.it.routeid) })).filter((y) => Date.now() - y.age > ROUTE_TTL_DAYS * 864e5).sort((a, b) => a.age - b.age);
  console.log('TAGO 노선', allRoutes.length, '/ 받을 노선', todo.length, '/ 이번 호출 한도', MAX_CALLS - calls);
  for (const { x } of todo) {
    if (calls >= MAX_CALLS || limited) break;
    const r = await tago('getRouteAcctoThrghSttnList', { cityCode: x.city, routeId: x.it.routeid, numOfRows: 1000 }, key);
    if (!r) continue;
    fs.writeFileSync(path.join(CACHE, 'tago', 'r-' + x.it.routeid + '.json'), JSON.stringify({ at: Date.now(), items: r.items.map((s) => [s.nodeid, s.nodenm, s.gpslati, s.gpslong, s.nodeord, s.updowncd]) }));
  }
  // 캐시로 합치기
  const stops = {}, routes = [];
  let have = 0;
  for (const { city, it } of allRoutes) {
    const f = path.join(CACHE, 'tago', 'r-' + it.routeid + '.json');
    if (!fs.existsSync(f)) continue;
    have++;
    const items = JSON.parse(fs.readFileSync(f, 'utf8')).items.filter((s) => s[2] > 33 && s[3] > 124).sort((a, b) => a[4] - b[4]);
    items.forEach((s) => { stops['T' + s[0]] = [String(s[1] || '').trim(), Math.round(s[2] * 1e5) / 1e5, Math.round(s[3] * 1e5) / 1e5]; });
    const n = String(it.routeno);
    const dirs = [0, 1].map((d) => items.filter((s) => Number(s[5]) === d).map((s) => 'T' + s[0])).filter((q) => q.length >= 2);
    // 실시간 위치 조회용: 원본 노선 id·도시 코드(c)
    const meta = { rid: it.routeid, c: city };
    if (dirs.length === 2) {
      dirs.forEach((q, k) => routes.push(Object.assign({ id: 'T' + it.routeid + '_' + k, n, t: n + ' (' + stops[q[q.length - 1]][0] + ' 방면)', s: q }, meta)));
    } else {
      splitRoundTrip('T' + it.routeid, n, items.map((s) => 'T' + s[0]), stops).forEach((r) => routes.push(Object.assign(r, meta)));
    }
  }
  console.log('TAGO 정류소 목록 보유', have, '/', allRoutes.length, '노선, 이번 호출', calls);
  return { stops, routes, have, total: allRoutes.length };
}

async function main() {
  const key = await getKey();
  const seoul = await fetchSeoul().catch((e) => { console.warn('서울 데이터 실패:', e.message); return null; });
  const tg = await fetchTago(key);
  const prev = fs.existsSync(path.join(CACHE, 'merged.json')) ? JSON.parse(fs.readFileSync(path.join(CACHE, 'merged.json'), 'utf8')) : null;
  const merged = { v: new Date().toISOString().slice(0, 10), stops: Object.assign({}, tg.stops), routes: tg.routes.slice(), tago: { have: tg.have, total: tg.total } };
  if (seoul) { Object.assign(merged.stops, seoul.stops); merged.routes.push(...seoul.routes); }
  else if (prev) { // 서울 실패 시 지난번 서울 데이터 유지
    prev.routes.filter((r) => r.id[0] === 'S').forEach((r) => { merged.routes.push(r); r.s.forEach((sid) => { merged.stops[sid] = prev.stops[sid]; }); });
  }
  fs.writeFileSync(path.join(CACHE, 'merged.json'), JSON.stringify(merged));
  console.log('합계 노선(방향별)', merged.routes.length, '정류소', Object.keys(merged.stops).length);
}
main().catch((e) => { console.error(e); process.exit(1); });
