// 중고랜드 — 미배송완료 주문의 배송 상태를 하루 1회 배치로 재확인(pg_cron이 매일 09:00 호출).
// pg_cron -> pg_net이 x-cron-secret 헤더로 인증한다(서비스 전체를 여는 service_role JWT 대신
// 무작위 생성한 저권한 공유 비밀만 사용).
//
// 구독형 웹훅 추적(recurring:true)은 최대 14일간 1시간 간격으로 공급자 쪽에서 자동 폴링하고
// 상태 변경을 무료로 웹훅 전송하므로(market-set-tracking이 등록, market-delivery-webhook이
// 수신), 정상적인 경우 이 함수가 할 일은 거의 없다. 이 함수는 웹훅 전송 실패·엔드포인트 일시
// 비활성화·14일 구독 만료 같은 드문 예외만 잡아내는 안전망이며, 여러 건을 POST
// /v1/tracking/trace 배치 조회 한 번(최대 50건씩, clientId로 주문과 매칭)으로 묶어 조회해
// API 호출 자체를 최소화한다. 원 배송(forward)과 반품 배송(return_*)을 각각 별도 배치로
// 폴링한다(반품 배송완료 시 return_status도 함께 DELIVERED로 전환).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DELIVERY_API_BASE = "https://api.deliveryapi.co.kr/v1";
const BATCH_SIZE = 50; // POST /v1/tracking/trace의 items 최대 개수(문서화됨)와 동일하게 맞춤

// deliveryStatus는 API가 이미 정규화해서 주는 코드라 추측 매핑 없이 그대로 사용한다.
function statusFromTraceData(data: Record<string, unknown>) {
  const isDelivered = Boolean(data.isDelivered);
  const status = String(data.deliveryStatus || "").trim() || "UNKNOWN";
  const statusText = String(data.deliveryStatusText || "").trim();
  return { status, statusText, isDelivered };
}

async function batchTrace(apiKey: string, items: { courierCode: string; trackingNumber: string; clientId: string }[]) {
  const res = await fetch(`${DELIVERY_API_BASE}/tracking/trace`, {
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

  type Cols = { id: string; courierCode: string; trackingNumber: string; status: string };

  async function pollGroup(
    orders: Cols[],
    fields: { courier: string; tracking: string; status: string; statusText: string; checkedAt: string; deliveredAt: string; returnStatus?: string }
  ) {
    let checked = 0;
    let delivered = 0;
    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      const chunk = orders.slice(i, i + BATCH_SIZE);
      try {
        const results = await batchTrace(
          apiKey as string,
          chunk.map((o) => ({ courierCode: o.courierCode, trackingNumber: o.trackingNumber, clientId: o.id }))
        );
        for (const result of results) {
          const match = chunk.find((o) => o.id === result.clientId);
          if (!match || !result.success || !result.data) continue;
          const trace = statusFromTraceData(result.data as Record<string, unknown>);
          const nowIso = new Date().toISOString();
          const update: Record<string, unknown> = {
            [fields.status]: trace.status,
            [fields.statusText]: trace.statusText,
            [fields.checkedAt]: nowIso,
          };
          if (trace.isDelivered && match.status !== "DELIVERED") {
            update[fields.deliveredAt] = nowIso;
            if (fields.returnStatus) update[fields.returnStatus] = "DELIVERED";
            delivered += 1;
          }
          await admin.from("market_orders").update(update).eq("id", match.id);
          checked += 1;
        }
      } catch (e) {
        console.warn("[market-check-delivery-status] 배치 조회 실패:", (e as Error).message);
      }
    }
    return { checked, delivered };
  }

  const { data: forwardOrders } = await admin
    .from("market_orders")
    .select("id, courier_code, tracking_number, delivery_status")
    .not("tracking_number", "is", null)
    .neq("delivery_status", "DELIVERED")
    .limit(200);
  const { data: returnOrders } = await admin
    .from("market_orders")
    .select("id, return_courier_code, return_tracking_number, return_delivery_status")
    .not("return_tracking_number", "is", null)
    .neq("return_delivery_status", "DELIVERED")
    .limit(200);

  const forwardResult = await pollGroup(
    (forwardOrders || []).map((o) => ({ id: o.id, courierCode: o.courier_code, trackingNumber: o.tracking_number, status: o.delivery_status })),
    { courier: "courier_code", tracking: "tracking_number", status: "delivery_status", statusText: "delivery_status_text", checkedAt: "delivery_checked_at", deliveredAt: "delivered_at" }
  );
  const returnResult = await pollGroup(
    (returnOrders || []).map((o) => ({ id: o.id, courierCode: o.return_courier_code, trackingNumber: o.return_tracking_number, status: o.return_delivery_status })),
    { courier: "return_courier_code", tracking: "return_tracking_number", status: "return_delivery_status", statusText: "return_delivery_status_text", checkedAt: "return_delivery_checked_at", deliveredAt: "return_delivered_at", returnStatus: "return_status" }
  );

  return jsonResponse({
    success: true,
    checked: forwardResult.checked + returnResult.checked,
    delivered: forwardResult.delivered + returnResult.delivered,
  });
});
