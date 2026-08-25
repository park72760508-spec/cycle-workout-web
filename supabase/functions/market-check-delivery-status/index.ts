// 중고랜드 — 미배송완료 주문의 배송 상태를 하루 1회 배치로 재확인(pg_cron이 매일 09:00 호출).
// pg_cron -> pg_net이 x-cron-secret 헤더로 인증한다(서비스 전체를 여는 service_role JWT 대신
// 무작위 생성한 저권한 공유 비밀만 사용).
//
// 구독형 웹훅 추적(recurring:true)은 최대 14일간 1시간 간격으로 공급자 쪽에서 자동 폴링하고
// 상태 변경을 무료로 웹훅 전송하므로(market-set-tracking이 등록, market-delivery-webhook이
// 수신), 정상적인 경우 이 함수가 할 일은 거의 없다. 이 함수는 웹훅 전송 실패·엔드포인트 일시
// 비활성화·14일 구독 만료 같은 드문 예외만 잡아내는 안전망이며, 여러 건을 POST
// /v1/webhooks/results 배치 API 한 번(최대 50건씩)으로 묶어 조회해 API 호출 자체를 최소화한다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DELIVERY_API_BASE = "https://api.deliveryapi.co.kr/v1";
const BATCH_SIZE = 50;

function statusFromItem(item: Record<string, unknown>) {
  const isDelivered = Boolean(item.isDelivered);
  const currentStatus = String(item.currentStatus || "").trim();
  return {
    status: isDelivered ? "DELIVERED" : currentStatus ? "IN_TRANSIT" : "UNKNOWN",
    statusText: currentStatus,
    isDelivered,
  };
}

async function batchResults(apiKey: string, items: { courierCode: string; trackingNumber: string }[]) {
  const res = await fetch(`${DELIVERY_API_BASE}/webhooks/results`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`배치 조회 실패(HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json?.data?.results as Record<string, unknown>[]) || [];
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
  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const chunk = orders.slice(i, i + BATCH_SIZE);
    try {
      const results = await batchResults(
        apiKey as string,
        chunk.map((o) => ({ courierCode: o.courier_code, trackingNumber: o.tracking_number }))
      );
      for (const item of results) {
        const match = chunk.find(
          (o) => o.tracking_number === item.trackingNumber && o.courier_code === item.courierCode
        );
        if (!match) continue;
        const trace = statusFromItem(item);
        const nowIso = new Date().toISOString();
        const update: Record<string, unknown> = {
          delivery_status: trace.status,
          delivery_status_text: trace.statusText,
          delivery_checked_at: nowIso,
        };
        if (trace.isDelivered && match.delivery_status !== "DELIVERED") {
          update.delivered_at = nowIso;
          delivered += 1;
        }
        await admin.from("market_orders").update(update).eq("id", match.id);
        checked += 1;
      }
    } catch (e) {
      console.warn("[market-check-delivery-status] 배치 조회 실패:", (e as Error).message);
    }
  }

  return jsonResponse({ success: true, checked, delivered });
});
