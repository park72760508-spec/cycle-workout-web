// 루트맵 카카오 도보·자전거·오토바이 길찾기 중계(2026-10-24, 오토바이 2026-10-30)
//
// 앱 → (STELVIO 커스텀 JWT) → 이 함수 → 카카오 REST API(dapi.kakao.com/v2/routing/{bicycle|walk})
//                                     오토바이(api='car') → apis-navi.kakaomobility.com/v1/directions(car_type=7 이륜차, avoid=motorway)
//  - 카카오 REST 키는 Vault('kakao_rest_api_key')에만 있다(브라우저에 노출하지 않음).
//  - 오늘(한국 날짜) 같은 목적지·같은 방식으로 저장된 경로가 있고 출발지가 그 경로 근처면 그 경로를 쓴다(카카오 호출 없음).
//  - 무료 한도(API별 하루 1,000건, 한국 날짜)를 우리 쪽에서 세어 넘으면 호출하지 않는다 → 앱은 기본 경로(Valhalla)로 전환.
//  - verify_jwt: false 로 배포(커스텀 JWT 는 게이트웨이 검증을 통과하지 못함) — 함수 안에서 JWKS 로 직접 검증.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const jwks = createRemoteJWKSet(new URL(`${Deno.env.get("SUPABASE_URL")}/auth/v1/.well-known/jwks.json`));
const DAILY_LIMIT = 1000;
const MODES: Record<string, string[]> = {
  bicycle: ["BIKE_ONLY", "SHORTEST", "ACCESSIBLE"],
  walk: ["BROAD_FIRST", "SHORTEST", "ACCESSIBLE"],
  // 2026-10-30 오토바이: 카카오모빌리티 자동차 길찾기(apis-navi) + 이륜차(car_type=7) + 자동차전용도로 회피(avoid=motorway)
  car: ["RECOMMEND", "DISTANCE", "TIME"],
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const grid = (v: number, step: number) => (Math.round(v / step) * step).toFixed(5);

async function usageOf(admin: ReturnType<typeof createClient>) {
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const { data } = await admin.from("kakao_route_usage").select("api,calls,exhausted").eq("day", day);
  const u: Record<string, unknown> = { limit: DAILY_LIMIT, bicycle: 0, walk: 0, car: 0 };
  (data || []).forEach((r: { api: string; calls: number; exhausted: boolean }) => {
    u[r.api] = r.calls;
    if (r.exhausted) u[r.api + "_exhausted"] = true;
  });
  return u;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST만 허용됩니다." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `${supabaseUrl}/auth/v1`, audience: "authenticated" });
    if (!payload.sub) throw new Error("no sub");
  } catch (_e) {
    return json({ success: false, error: "인증이 필요합니다." }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { /* 아래 검증 */ }
  const api = String(body.api || "");
  const mode = String(body.mode || "");
  const sx = Number(body.sx), sy = Number(body.sy), ex = Number(body.ex), ey = Number(body.ey);
  if (!MODES[api] || !MODES[api].includes(mode)) return json({ success: false, error: "잘못된 경로 방식" }, 400);
  if (![sx, sy, ex, ey].every(Number.isFinite)) return json({ success: false, error: "잘못된 좌표" }, 400);
  // 한국 범위 밖은 카카오가 지원하지 않음
  const inKr = (x: number, y: number) => x > 124 && x < 132 && y > 33 && y < 39;
  if (!inKr(sx, sy) || !inKr(ex, ey)) return json({ success: false, error: "국내 경로만 지원", code: "OUT_OF_KR" });

  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // 한국 날짜
  const key = [day, api, mode, grid(sx, 0.0005), grid(sy, 0.0005), grid(ex, 0.0002), grid(ey, 0.0002)].join("|");

  // 1) 오늘 같은 목적지(약 30m 안)·같은 방식으로 저장된 경로 중, 지금 출발지가 경로 근처(자전거 500m·걷기 250m)인 것
  //    → 카카오를 부르지 않고 그 경로를 돌려준다. reuse.idx = 출발지에서 가장 가까운 경로 점(앱이 거기까지 짧게 연결)
  const near = api === "walk" ? 250 : 500; // 자전거·오토바이 500m
  const { data: cands } = await admin.from("kakao_route_cache").select("route")
    .eq("api", api).eq("mode", mode).eq("day", day)
    .gte("ex", ex - 0.0004).lte("ex", ex + 0.0004).gte("ey", ey - 0.0003).lte("ey", ey + 0.0003)
    .order("created_at", { ascending: false }).limit(20);
  let best: { route: any; idx: number; dist: number } | null = null;
  const kx = 111320 * Math.cos((sy * Math.PI) / 180), ky = 110540;
  for (const c of cands || []) {
    const pts: number[][] = (c.route && c.route.pts) || [];
    for (let i = 0; i < pts.length; i++) {
      const dx = (pts[i][1] - sx) * kx, dy = (pts[i][0] - sy) * ky;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= near && (!best || dist < best.dist)) best = { route: c.route, idx: i, dist };
    }
  }
  if (best) {
    await admin.rpc("kakao_route_mark", { p_api: api, p_cache_hit: true, p_exhausted: false });
    return json({ success: true, cached: true, reuse: { idx: best.idx, dist: Math.round(best.dist) }, route: best.route, usage: await usageOf(admin) });
  }

  const { data: n } = await admin.rpc("kakao_route_take", { p_api: api, p_limit: DAILY_LIMIT });
  if (typeof n !== "number" || n < 0) {
    return json({ success: false, code: "QUOTA", error: "오늘 카카오 무료 사용량을 모두 썼습니다.", usage: await usageOf(admin) });
  }
  const { data: restKey } = await admin.rpc("get_kakao_rest_api_key");
  if (!restKey) return json({ success: false, error: "카카오 키가 설정되지 않았습니다." }, 500);

  if (api === "car") {
    // 오토바이: 자동차 길찾기에 이륜차 차종 + 자동차전용도로(고속도로·도시고속화도로 등) 회피를 함께 지정
    const cq = new URLSearchParams({
      origin: `${sx},${sy}`, destination: `${ex},${ey}`, priority: mode,
      car_type: "7", avoid: "motorway", summary: "false", alternatives: "false",
    });
    let cd: Record<string, any> | null = null;
    let cStatus = 0;
    try {
      const res = await fetch(`https://apis-navi.kakaomobility.com/v1/directions?${cq}`, {
        headers: { Authorization: `KakaoAK ${restKey}` },
        signal: AbortSignal.timeout(12000),
      });
      cStatus = res.status;
      cd = await res.json().catch(() => null);
    } catch (e) {
      return json({ success: false, error: "카카오 응답 없음: " + String((e as Error).message || e), usage: await usageOf(admin) });
    }
    if (cStatus === 429 || (cd && /limit|quota|exceed/i.test(String(cd.msg || cd.message || "")))) {
      await admin.rpc("kakao_route_mark", { p_api: api, p_cache_hit: false, p_exhausted: true });
      return json({ success: false, code: "QUOTA", error: "카카오 무료 사용량 초과", usage: await usageOf(admin) });
    }
    const r0 = cd && Array.isArray(cd.routes) ? cd.routes[0] : null;
    if (!r0 || r0.result_code !== 0) {
      return json({ success: false, code: "KAKAO_" + String((r0 && r0.result_code) ?? (cd && cd.code) ?? cStatus), error: "카카오 경로 없음", usage: await usageOf(admin) });
    }
    const cpts: number[][] = [];
    const csteps: { i: number; g: string; d: number }[] = [];
    let dist = 0, time = 0;
    for (const sec of r0.sections || []) {
      dist += Number(sec.distance) || 0;
      time += Number(sec.duration) || 0;
      for (const road of sec.roads || []) {
        const v: number[] = road.vertexes || [];
        for (let k = 0; k + 1 < v.length; k += 2) {
          const ll = [r6(v[k + 1]), r6(v[k])];
          const last = cpts[cpts.length - 1];
          if (last && last[0] === ll[0] && last[1] === ll[1]) continue;
          cpts.push(ll);
        }
      }
    }
    // 안내 지점(x,y) → 경로 좌표 번호(앞으로만 찾아 가장 가까운 점)
    let from = 0;
    const kx2 = 111320 * Math.cos((sy * Math.PI) / 180), ky2 = 110540;
    for (const sec of r0.sections || []) {
      for (const g of sec.guides || []) {
        const t = Number(g.type);
        if (t === 100 || t === 101 || t === 300 || t === 301) continue; // 출발·도착·경유지
        let bi = from, bd = Infinity;
        for (let i = from; i < cpts.length; i++) {
          const dx = (cpts[i][1] - Number(g.x)) * kx2, dy = (cpts[i][0] - Number(g.y)) * ky2;
          const dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; bi = i; }
          if (bd < 4 && dd > 250000) break; // 2m 안을 찾았고 500m 넘게 멀어지면 그만
        }
        from = bi;
        csteps.push({ i: bi, g: String(g.guidance || ""), d: Number(g.distance) || 0 });
      }
    }
    if (cpts.length < 2) return json({ success: false, error: "카카오 경로 좌표 없음", usage: await usageOf(admin) });
    csteps.unshift({ i: 0, g: "출발", d: 0 });
    const croute = { pts: cpts, steps: csteps, dist, time };
    await admin.from("kakao_route_cache").upsert({ key, api, mode, day, sx, sy, ex, ey, route: croute, created_at: new Date().toISOString() });
    return json({ success: true, cached: false, route: croute, usage: await usageOf(admin) });
  }

  const qs = new URLSearchParams({
    start_x: String(sx), start_y: String(sy), end_x: String(ex), end_y: String(ey), route_mode: mode,
  });
  let d: Record<string, any> | null = null;
  let httpStatus = 0;
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/routing/${api}?${qs}`, {
      headers: { Authorization: `KakaoAK ${restKey}` },
      signal: AbortSignal.timeout(12000),
    });
    httpStatus = res.status;
    d = await res.json().catch(() => null);
  } catch (e) {
    return json({ success: false, error: "카카오 응답 없음: " + String((e as Error).message || e), usage: await usageOf(admin) });
  }
  if (httpStatus === 429 || (d && /limit|quota|exceed/i.test(String(d.msg || d.message || "")))) {
    await admin.rpc("kakao_route_mark", { p_api: api, p_cache_hit: false, p_exhausted: true });
    return json({ success: false, code: "QUOTA", error: "카카오 무료 사용량 초과", usage: await usageOf(admin) });
  }
  if (!d || d.status !== "OK" || !d.route) {
    return json({ success: false, code: String((d && (d.status || d.code)) || httpStatus), error: "카카오 경로 없음", usage: await usageOf(admin) });
  }

  // 앱에 필요한 것만: 좌표[lat,lng], 거리(m)·시간(초), 안내(시작 좌표 번호 i, 문구 g, 거리 d)
  const pts: number[][] = [];
  const steps: { i: number; g: string; d: number }[] = [];
  for (const leg of d.route.legs || []) {
    for (const s of leg.steps || []) {
      const sp: number[][] = (s.path && s.path.points) || [];
      let startIdx = pts.length ? pts.length - 1 : 0;
      sp.forEach((p, k) => {
        const ll = [r6(p[1]), r6(p[0])];
        const last = pts[pts.length - 1];
        if (last && last[0] === ll[0] && last[1] === ll[1]) { if (k === 0) startIdx = pts.length - 1; return; }
        if (k === 0) startIdx = pts.length;
        pts.push(ll);
      });
      const pr = s.properties || {};
      steps.push({ i: startIdx, g: String(pr.guidance || ""), d: Number(pr.distance) || 0 });
    }
  }
  if (pts.length < 2) return json({ success: false, error: "카카오 경로 좌표 없음", usage: await usageOf(admin) });
  const route = {
    pts, steps,
    dist: Number(d.route.properties && d.route.properties.totalDistance) || 0,
    time: Number(d.route.properties && d.route.properties.totalTime) || 0,
  };
  await admin.from("kakao_route_cache").upsert({ key, api, mode, day, sx, sy, ex, ey, route, created_at: new Date().toISOString() });
  return json({ success: true, cached: false, route, usage: await usageOf(admin) });
});
