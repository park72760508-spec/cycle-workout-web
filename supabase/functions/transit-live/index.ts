// 루트맵 노선도 실시간 위치 중계(2026-11-03)
//
// 앱(노선도 팝업이 열려 있을 때 20초마다) → 이 함수 → 공공 API
//  - 버스(TAGO, 경기 포함 전국 138개 도시): 국토교통부 버스위치정보 getRouteAcctoBusLcList (공공데이터포털 키 = Vault apikey_data_go_kr)
//  - 버스(서울): 서울특별시 버스위치정보 getBusPosByRtid (같은 키, 서버가 내려가 있으면 실패로 응답)
//  - 지하철(수도권): 서울 열린데이터광장 실시간 열차 위치 realtimePosition (Vault apikey_seoul_subway)
//  - 같은 요청은 20초 동안 결과를 저장해 두고 모든 사용자가 공유 → 공공 API 하루 한도·Supabase 무료 범위 안에서 운영
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

async function seoulBus(rid: string) {
  const key = await apiKey("data_go_kr");
  const q = new URLSearchParams({ serviceKey: key, busRouteId: rid, resultType: "json" });
  const j = await getJson("http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?" + q);
  const list = j?.msgBody?.itemList || [];
  return (Array.isArray(list) ? list : [list]).map((b: Record<string, unknown>) => ({
    v: String(b.plainNo || b.vehId || ""), id: String(b.lastStnId || ""), lat: Number(b.gpsY), lon: Number(b.gpsX),
    stop: String(b.stopFlag || "") === "1",
  }));
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
  if (!/^[\w-]*$/.test(rid)) return json({ ok: false, error: "잘못된 요청" }, 400);

  const ck = [type, src, rid, city, line].join("|");
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body);

  let body: unknown;
  try {
    let items: unknown[] = [];
    if (type === "bus" && src === "T" && rid && city) items = await tagoBus(city, rid);
    else if (type === "bus" && src === "S" && rid) items = await seoulBus(rid);
    else if (type === "subway" && line) items = await seoulSubway(line);
    else return json({ ok: false, error: "지원하지 않는 노선" }, 400);
    body = { ok: true, at: Date.now(), items };
  } catch (e) {
    body = { ok: false, at: Date.now(), error: String((e as Error)?.message || e).slice(0, 120) };
  }
  cache.set(ck, { at: Date.now(), body });
  if (cache.size > 2000) cache.clear();
  return json(body);
});
