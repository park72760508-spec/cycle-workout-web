// 중고랜드 — 송장 등록된 미배송완료 주문의 배송 상태를 주기 조회(pg_cron이 30분마다 호출).
// pg_cron -> pg_net이 x-cron-secret 헤더로 인증한다(서비스 전체를 여는 service_role JWT 대신
// 무작위 생성한 저권한 공유 비밀만 사용 — supabase/migrations/20260904090000_*.sql 참고).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DELIVERY_API_BASE = "https://api.deliveryapi.co.kr/v1";
const DELIVERED_TOKENS = ["delivered", "완료", "배달완료", "배송완료", "수령완료"];

function normalizeDeliveryTraceResponse(json: Record<string, unknown>) {
  const root = (json && ((json.data as Record<string, unknown>) || (json.result as Record<string, unknown>))) || json || {};
  const rawStatus = String(root.status || root.state || root.deliveryStatus || root.trackingStatus || "").trim();
  const statusLower = rawStatus.toLowerCase();
  const isDelivered = DELIVERED_TOKENS.some((t) => statusLower.includes(t.toLowerCase()));
  const statusText = String(root.statusText || root.stateText || root.description || rawStatus || "").trim();
  return {
    status: isDelivered ? "DELIVERED" : rawStatus ? "IN_TRANSIT" : "UNKNOWN",
    statusText,
    isDelivered,
  };
}

async function traceDelivery(apiKey: string, courierCode: string, trackingNumber: string) {
  const res = await fetch(`${DELIVERY_API_BASE}/tracking/trace`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ carrierId: courierCode, trackingNumber }),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_e) {
      throw new Error(`택배 조회 API 응답 파싱 실패(HTTP ${res.status})`);
    }
  }
  if (!res.ok) {
    throw new Error(`택배 조회 API 오류(HTTP ${res.status}): ${String(json?.message || json?.error || text.slice(0, 200))}`);
  }
  return normalizeDeliveryTraceResponse(json);
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const providedSecret = req.headers.get("x-cron-secret") || "";
  const { data: expectedSecret } = await admin.rpc("get_market_cron_secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return jsonResponse({ success: false, error: "unauthorized" }, 401);
  }

  const { data: apiKey, error: apiKeyErr } = await admin.rpc("get_delivery_api_key");
  if (apiKeyErr || !apiKey) {
    return jsonResponse({ success: false, error: "배송 조회 API 키를 찾을 수 없습니다." }, 500);
  }

  const { data: orders, error } = await admin
    .from("market_orders")
    .select("id, courier_code, tracking_number, delivery_status")
    .not("tracking_number", "is", null)
    .neq("delivery_status", "DELIVERED")
    .limit(200);
  if (error || !orders?.length) {
    return jsonResponse({ success: true, checked: 0, delivered: 0 });
  }

  let checked = 0;
  let delivered = 0;
  for (const o of orders) {
    try {
      const trace = await traceDelivery(apiKey as string, o.courier_code, o.tracking_number);
      const nowIso = new Date().toISOString();
      const update: Record<string, unknown> = {
        delivery_status: trace.status,
        delivery_status_text: trace.statusText,
        delivery_checked_at: nowIso,
      };
      if (trace.isDelivered && o.delivery_status !== "DELIVERED") {
        update.delivered_at = nowIso;
        delivered += 1;
      }
      await admin.from("market_orders").update(update).eq("id", o.id);
      checked += 1;
    } catch (e) {
      console.warn("[market-check-delivery-status] 조회 실패:", o.id, (e as Error).message);
    }
  }

  return jsonResponse({ success: true, checked, delivered });
});
