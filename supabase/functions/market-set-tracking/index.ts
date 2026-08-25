// 중고랜드 — 판매자가 입금완료(PAID) 주문에 택배사/송장번호를 등록.
// ⚠️ deliveryapi.co.kr 공식 요청/응답 스키마 문서를 확인하지 못해, 요청 필드명(carrierId/
// trackingNumber)과 응답 정규화(normalizeDeliveryTraceResponse)는 업계 통상 관례를 따른
// 최선의 추정이다. 실제 배송 건 첫 호출 결과를 보고 이 함수 안의 normalize 로직만 조정하면 된다.
//
// 트래픽 최소화: 등록 즉시 1회 조회 후, "웹훅 등록 1건만 차감·이후 무료" 정책을 활용해
// market-delivery-webhook으로 상태 변경을 무료로 받도록 웹훅도 함께 등록한다(POST
// /v1/webhooks/endpoints — 이 엔드포인트의 요청 스키마도 문서를 확인하지 못해 최선의 추정).
// 웹훅 등록이 성공하면 market-check-delivery-status의 정기 폴링 대상에서 제외되어 API
// 호출을 아낀다. 등록에 실패해도 주문 등록 자체는 성공 처리하고 폴링(6시간 주기)으로 폴백한다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MARKET_COURIERS: Record<string, string> = {
  cj: "CJ대한통운",
  lotte: "롯데",
  post: "우체국",
  hanjin: "한진",
  logen: "로젠",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
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

/** ⚠️ 요청 스키마 미검증 — carrierId/trackingNumber/url(콜백 주소) 조합은 최선의 추정. */
async function registerDeliveryWebhook(apiKey: string, courierCode: string, trackingNumber: string, callbackUrl: string) {
  const res = await fetch(`${DELIVERY_API_BASE}/webhooks/endpoints`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ carrierId: courierCode, trackingNumber, url: callbackUrl }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`웹훅 등록 실패(HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "POST만 허용됩니다." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ success: false, error: "인증이 필요합니다." }, 401);
  }
  const sellerId = userData.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_e) {
    // 빈 바디 허용 안 함 — 아래 필수값 검증에서 걸러짐
  }
  const orderId = String(body.orderId || "").trim();
  const courierCode = String(body.courierCode || "").trim();
  const trackingNumber = String(body.trackingNumber || "").replace(/[^0-9A-Za-z-]/g, "").trim();
  if (!orderId || !courierCode || !trackingNumber) {
    return jsonResponse({ success: false, error: "orderId·courierCode·trackingNumber가 필요합니다." }, 400);
  }
  const courierName = MARKET_COURIERS[courierCode];
  if (!courierName) {
    return jsonResponse({ success: false, error: "지원하지 않는 택배사입니다." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !order) {
    return jsonResponse({ success: false, error: "주문을 찾을 수 없습니다." }, 404);
  }
  if (order.seller_id !== sellerId) {
    return jsonResponse({ success: false, error: "본인 상품의 주문만 등록할 수 있습니다." }, 403);
  }
  if (order.escrow_status !== "PAID") {
    return jsonResponse({ success: false, error: "입금이 확인된 주문만 송장을 등록할 수 있습니다." }, 400);
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    courier_code: courierCode,
    courier_name: courierName,
    tracking_number: trackingNumber,
    shipped_at: nowIso,
    delivery_status: "IN_TRANSIT",
    updated_at: nowIso,
  };

  try {
    const { data: apiKey } = await admin.rpc("get_delivery_api_key");
    if (apiKey) {
      const trace = await traceDelivery(apiKey as string, courierCode, trackingNumber);
      update.delivery_status = trace.status;
      update.delivery_status_text = trace.statusText;
      update.delivery_checked_at = nowIso;
      if (trace.isDelivered) update.delivered_at = nowIso;

      if (!trace.isDelivered) {
        try {
          const callbackUrl = `${supabaseUrl}/functions/v1/market-delivery-webhook`;
          await registerDeliveryWebhook(apiKey as string, courierCode, trackingNumber, callbackUrl);
          update.webhook_registered = true;
          update.webhook_registered_at = nowIso;
        } catch (eHook) {
          // 웹훅 등록 실패는 폴링(6시간 주기)으로 폴백 — 등록 자체는 계속 성공 처리한다.
          console.warn("[market-set-tracking] 웹훅 등록 실패(폴링으로 폴백):", orderId, (eHook as Error).message);
        }
      }
    }
  } catch (eTrace) {
    console.warn("[market-set-tracking] 즉시 조회 실패(폴링이 재시도):", orderId, (eTrace as Error).message);
  }

  const { data: updated, error: updErr } = await admin
    .from("market_orders")
    .update(update)
    .eq("id", orderId)
    .eq("escrow_status", "PAID")
    .select()
    .single();
  if (updErr) {
    return jsonResponse({ success: false, error: updErr.message }, 500);
  }

  return jsonResponse({ success: true, order: updated });
});
