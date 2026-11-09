// 루트맵 노선도 실시간 위치 중계(2026-11-03)
//
// 앱(노선도 팝업이 열려 있을 때 20초마다) → 이 함수 → 공공 API
//  - 버스(TAGO, 경기 포함 전국 138개 도시): 국토교통부 버스위치정보 getRouteAcctoBusLcList (공공데이터포털 키 = Vault apikey_data_go_kr)
//  - 버스(서울): 서울특별시 버스위치정보 getBusPosByRtid (같은 키, 서버가 내려가 있으면 실패로 응답)
//  - 지하철(수도권): 서울 열린데이터광장 실시간 열차 위치 realtimePosition (Vault apikey_seoul_subway)
//  - 같은 요청은 20초 동안 결과를 저장해 두고 모든 사용자가 공유 → 공공 API 하루 한도·Supabase 무료 범위 안에서 운영
//  - 잔여좌석(2026-11-09): 경기도 버스위치정보(GBIS buslocationservice v2, remainSeatCnt) — 노선번호로 GBIS 노선을 찾아 차량번호판으로 위 버스와 맞춰 seat 를 붙임(경기·광역 노선만, 같은 키 apikey_data_go_kr 로 '경기도_버스노선조회'·'경기도_버스위치정보 조회' 활용신청 필요)
//  - 키는 서버에서만 사용(앱에 노출하지 않음). verify_jwt: false(로그인 없이 노선도에서 사용) — GET 만 허용
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const TTL_MS = 20000;
const cache = new Map<string, { at: number; body: unknown }>();
const keyCache = new Map<string, { at: number; v: string }>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=15" },
  });
}

async function apiKey(name: string): Promise<string> {
  const c = keyCache.get(name);
  if (c && Date.now() - c.at < 600000) return c.v;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await admin.rpc("fn_service_get_api_key", { p_name: name });
  let v = String(data || "");
  if (/%[0-9A-F]{2}/i.test(v)) v = decodeURIComponent(v); // 인코딩된 키로 저장된 경우
  keyCache.set(name, { at: Date.now(), v });
  return v;
}

async function getJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status);
  return JSON.parse(text);
}

async function tagoBus(city: string, rid: string) {
  const key = await apiKey("data_go_kr");
  const q = new URLSearchParams({ serviceKey: key, _type: "json", numOfRows: "200", cityCode: city, routeId: rid });
  const j = await getJson("https://apis.data.go.kr/1613000/BusLcInfoInqireService/getRouteAcctoBusLcList?" + q);
  const h = j?.response?.header;
  if (h && h.resultCode !== "00") throw new Error(h.resultCode + " " + h.resultMsg);
  let it = j?.response?.body?.items?.item;
  it = !it ? [] : Array.isArray(it) ? it : [it];
  return it.map((b: Record<string, unknown>) => ({
    v: String(b.vehicleno || ""), id: String(b.nodeid || ""), lat: Number(b.gpslati), lon: Number(b.gpslong),
  }));
}

// ---- 잔여좌석(경기도 GBIS) ----
const GBIS = "https://apis.data.go.kr/6410000";
const gbisRoutes = new Map<string, { at: number; ids: string[] }>(); // 노선번호 → GBIS routeId 후보(없으면 빈 배열, 1시간 보관)
function plateKey(v: unknown): string {
  const m = /(\d{2,3}[가-힣]\d{4})/.exec(String(v || ""));
  return m ? m[1] : "";
}
function asList(x: unknown): Record<string, unknown>[] {
  return !x ? [] : Array.isArray(x) ? x as Record<string, unknown>[] : [x as Record<string, unknown>];
}
async function gbisGet(path: string, params: Record<string, string>) {
  const key = await apiKey("data_go_kr");
  const q = new URLSearchParams({ serviceKey: key, format: "json", ...params });
  const j = await getJson(GBIS + path + "?" + q);
  const h = j?.response?.msgHeader;
  const code = String(h?.resultCode ?? "");
  if (code !== "0" && code !== "00" && code !== "4") throw new Error("GBIS " + code + " " + String(h?.resultMessage || "").slice(0, 60)); // 4 = 결과 없음
  return j?.response?.msgBody || {};
}
async function gbisRouteIds(rn: string): Promise<string[]> {
  const c = gbisRoutes.get(rn);
  if (c && Date.now() - c.at < 3600000) return c.ids;
  const b = await gbisGet("/busrouteservice/v2/getBusRouteListv2", { keyword: rn });
  const ids = asList(b.busRouteList).filter((r) => String(r.routeName) === rn).map((r) => String(r.routeId)).slice(0, 4);
  gbisRoutes.set(rn, { at: Date.now(), ids });
  return ids;
}
/** 차량번호판 → 잔여좌석(-1 = 정보 없음). 노선번호가 같은 GBIS 노선 중 번호판이 겹치는 노선의 값을 사용 */
async function gbisSeats(rn: string, plates: string[], dbgSink?: unknown[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!rn || !plates.length) return out;
  for (const rid of await gbisRouteIds(rn)) {
    const b = await gbisGet("/buslocationservice/v2/getBusLocationListv2", { routeId: rid });
    let hit = 0;
    if (dbgSink) dbgSink.push(...asList(b.busLocationList).slice(0, 3));
    for (const x of asList(b.busLocationList)) {
      const k = plateKey(x.plateNo);
      if (!k || plates.indexOf(k) < 0) continue;
      hit++;
      const n = Number(x.remainSeatCnt);
      // 태그리스(taglessCd=1) 단말 차량만 실제 값 — 일반형 시내버스(routeTypeCd 13)는 remainSeatCnt 가 항상 0 으로 와서 '정보 없음'(2026-11-09 10번 노선 확인)
      out[k] = Number(x.taglessCd) === 1 && Number.isFinite(n) && n >= 0 && String(x.remainSeatCnt) !== "" ? n : -1;
    }
    if (hit) break;
  }
  return out;
}

// 서울 시내버스 혼잡도·재차 인원(2026-11-09): 위치정보(congetion) + 노선별 도착정보(reride_Num = 재차 인원, rerdie_Div = 재차 구분)를 차량으로 합침
async function seoulBus(rid: string, dbg = false) {
  const key = await apiKey("data_go_kr");
  const q = new URLSearchParams({ serviceKey: key, busRouteId: rid, resultType: "json" });
  const [pos, arr] = await Promise.all([
    getJson("http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?" + q),
    getJson("http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?" + q).catch((e) => ({ err: String((e as Error)?.message || e) })),
  ]);
  const list = asList(pos?.msgBody?.itemList);
  const ld = new Map<string, { n: number; d: string }>(); // 차량(번호판·vehId) → 재차 인원·구분
  const arrList = asList(arr?.msgBody?.itemList);
  for (const a of arrList) {
    for (const i of ["1", "2"]) {
      const n = Number(a["reride_Num" + i]);
      const rec = { n: Number.isFinite(n) ? n : -1, d: String(a["rerdie_Div" + i] ?? "") };
      for (const k of [String(a["vehId" + i] || ""), String(a["plainNo" + i] || "")]) if (k && k !== "0") ld.set(k, rec);
    }
  }
  const items = list.map((b: Record<string, unknown>) => {
    const r = ld.get(String(b.vehId || "")) || ld.get(String(b.plainNo || ""));
    return {
      v: String(b.plainNo || b.vehId || ""), id: String(b.lastStnId || ""), lat: Number(b.gpsY), lon: Number(b.gpsX),
      stop: String(b.stopFlag || "") === "1",
      cg: Number(b.congetion ?? 0) || 0, // 위치정보 혼잡도(0 = 정보 없음)
      bt: String(b.busType ?? ""), // 0 일반 1 저상 2 굴절
      ld: r ? r.n : -1, ldd: r ? r.d : "", // 재차 인원(-1 = 정보 없음)
    };
  });
  if (dbg) return { items, raw: { pos: list.slice(0, 2), arr: arrList.slice(0, 2), arrKeys: arrList[0] ? Object.keys(arrList[0]) : [], arrHdr: (arr as Record<string, unknown> | null)?.msgHeader ?? (arr as Record<string, unknown> | null)?.err ?? null } };
  return { items };
}

// 앱 호선 이름 → 실시간 API 호선 이름
const SUBWAY_NAME: Record<string, string> = { "인천국제공항철도": "공항철도" };
async function seoulSubway(line: string) {
  const key = await apiKey("seoul_subway");
  if (!key) throw new Error("실시간 지하철 인증키가 없습니다.");
  const nm = SUBWAY_NAME[line] || line;
  const j = await getJson(`http://swopenapi.seoul.go.kr/api/subway/${encodeURIComponent(key)}/json/realtimePosition/0/200/${encodeURIComponent(nm)}`);
  const list = j?.realtimePositionList;
  if (!Array.isArray(list)) {
    const msg = j?.errorMessage?.message || j?.message || "";
    if (/해당하는 데이터가 없습니다|INFO-200/.test(JSON.stringify(j))) return [];
    throw new Error(msg || "응답 형식 오류");
  }
  return list.map((t: Record<string, unknown>) => ({
    st: String(t.statnNm || ""), ud: String(t.updnLine || ""), s: String(t.trainSttus || ""),
    no: String(t.trainNo || ""), to: String(t.statnTnm || ""), ex: String(t.directAt || "") === "1",
    dt: String(t.recptnDt || ""), // 기록 시각(KST "YYYY-MM-DD HH:MM:SS") — 앱이 경과 시간만큼 위치 추정
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ ok: false, error: "GET만 허용됩니다." }, 405);
  const u = new URL(req.url);
  const type = u.searchParams.get("type") || "";
  const src = u.searchParams.get("src") || "";
  const rid = (u.searchParams.get("rid") || "").slice(0, 40);
  const city = (u.searchParams.get("c") || "").replace(/\D/g, "").slice(0, 6);
  const line = (u.searchParams.get("line") || "").slice(0, 30);
  const rn = (u.searchParams.get("rn") || "").slice(0, 12);
  if (!/^[\w-]*$/.test(rid)) return json({ ok: false, error: "잘못된 요청" }, 400);

  const ck = [type, src, rid, city, line, rn].join("|");
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body);

  let body: unknown;
  try {
    let items: unknown[] = [];
    let extra: unknown;
    if (type === "bus" && src === "T" && rid && city) items = await tagoBus(city, rid);
    else if (type === "bus" && src === "S" && rid) { const r = await seoulBus(rid, u.searchParams.get("dbg") === "1"); items = r.items; extra = (r as { raw?: unknown }).raw; }
    else if (type === "subway" && line) items = await seoulSubway(line);
    else return json({ ok: false, error: "지원하지 않는 노선" }, 400);
    let seat: { ok: boolean; err?: string } | undefined;
    if (type === "bus" && rn && items.length) {
      try {
        const plates = (items as { v: string }[]).map((b) => plateKey(b.v)).filter(Boolean);
        const gsink: unknown[] = [];
        const m = await gbisSeats(rn, plates, dbg ? gsink : undefined);
        if (dbg) extra = { gbis: gsink };
        for (const b of items as { v: string; seat?: number }[]) { const k = plateKey(b.v); if (k && m[k] != null && m[k] >= 0) b.seat = m[k]; }
        seat = { ok: true };
      } catch (e) { seat = { ok: false, err: String((e as Error)?.message || e).slice(0, 100) }; }
    }
    body = { ok: true, at: Date.now(), items, seat, raw: extra };
  } catch (e) {
    body = { ok: false, at: Date.now(), error: String((e as Error)?.message || e).slice(0, 120) };
  }
  cache.set(ck, { at: Date.now(), body });
  if (cache.size > 2000) cache.clear();
  return json(body);
});
