// 중고랜드 — 판매자가 입금완료(PAID) 주문에 택배사/송장번호를 등록하고, deliveryapi.co.kr의
// 구독형 웹훅 추적(POST /v1/webhooks/register, recurring:true)을 함께 등록한다.
//
// 과금 구조(공식 문서 기준): 구독 등록 시 건당 1회만 과금되고, 이후 최대 14일간 1시간 간격
// 자동 폴링과 상태 변경 웹훅 전송은 전부 무료다. 등록 즉시 1회 조회도 이 안에 포함된다.
// 배달 완료가 감지되면 구독이 자동 종료되고, 14일이 지나면(드물게 미배송 장기 지연 시) 자동
// 만료된다 — 이 두 경우를 대비해 market-check-delivery-status가 하루 1회 안전망으로 돈다.
//
// 엔드포인트(콜백 URL)는 market-delivery-webhook-setup으로 미리 1회 등록해뒀고(endpointId는
// Vault에 저장), 여기서는 그 endpointId를 붙여 송장을 구독 등록하기만 한다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// deliveryapi.co.kr 공식 문서(GET /v1/tracking/couriers, POST /v1/tracking/trace)의
// courierCode 전체 목록을 그대로 반영 — 이전에는 예시 코드에 나온 5개만 등록했었음.
const MARKET_COURIERS: Record<string, string> = {
  cj: "CJ대한통운",
  lotte: "롯데택배",
  post: "우체국택배",
  hanjin: "한진택배",
  logen: "로젠택배",
  kyungdong: "경동택배",
  daesin: "대신택배",
  hapdong: "합동택배",
  coupang: "쿠팡",
  woori: "우리택배",
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

// POST /v1/tracking/trace 응답의 results[].data를 그대로 해석 — deliveryStatus는 API가
// 이미 정규화해서 주는 코드(PENDING/REGISTERED/PICKUP_READY/PICKED_UP/IN_TRANSIT/
// OUT_FOR_DELIVERY/DELIVERED/FAILED/RETURNED/CANCELLED/HOLD/UNKNOWN)라 추측 매핑이 필요 없다.
function statusFromTraceData(data: Record<string, unknown>) {
  const isDelivered = Boolean(data.isDelivered);
  const status = String(data.deliveryStatus || "").trim() || "UNKNOWN";
  const statusText = String(data.deliveryStatusText || "").trim();
  return { status, statusText, isDelivered };
}

async function registerTracking(
  apiKey: string,
  endpointId: string,
  courierCode: string,
  trackingNumber: string,
  clientId: string
) {
  const res = await fetch(`${DELIVERY_API_BASE}/webhooks/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ courierCode, trackingNumber, clientId }],
      recurring: true,
      endpointId,
      metadata: { orderId: clientId },
    }),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_e) {
      throw new Error(`택배 추적 등록 응답 파싱 실패(HTTP ${res.status})`);
    }
  }
  if (!res.ok) {
    // items 전건 검증 실패(예: INVALID_TRACKING_NUMBER) 시 문서화된 data[0]에 구체적 사유가 담김.
    const detail = Array.isArray(json?.data) && json.data[0]
      ? `${(json.data[0] as Record<string, unknown>).errorCode || ""} ${(json.data[0] as Record<string, unknown>).trackingNumber || ""}`.trim()
      : "";
    throw new Error(`${String(json?.error || `HTTP ${res.status}`)}${detail ? ` (${detail})` : ""}`);
  }
  return json.data as { requestId: string; itemCount: number; recurring: boolean };
}

/** 오입력 정정 시 기존 구독을 취소 — 실패해도 새 등록을 막지 않는다(문서화된 만료
 * 정책상 최대 14일 뒤 어차피 자동 종료되므로, 취소 실패는 잔여 폴링 낭비 정도로 그침). */
async function cancelTrackingSubscription(apiKey: string, requestId: string) {
  try {
    await fetch(`${DELIVERY_API_BASE}/webhooks/subscriptions/${requestId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (_e) {
    // best-effort
  }
}

/** 등록 즉시 현재 상태를 한 번 더 확인 — 문서상 단발성 조회 전용 API인 POST /v1/tracking/trace를
 * 사용한다(구독 폴링용 웹훅과는 별개). 구독의 첫 자동 폴링을 기다리지 않고 화면에 바로 최신
 * 상태를 보여주기 위한 선택적 호출이며, 실패해도 무시(구독이 곧 웹훅으로 갱신해줌). */
async function fetchImmediateStatus(apiKey: string, courierCode: string, trackingNumber: string) {
  const res = await fetch(`${DELIVERY_API_BASE}/tracking/trace`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ courierCode, trackingNumber }], skipCache: true }),
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const result = json?.data?.results?.[0];
  if (!result?.success || !result.data) return null;
  return statusFromTraceData(result.data as Record<string, unknown>);
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
  // 중고랜드 전용 커스텀 JWT는 GoTrue가 추적하는 실제 세션이 아니므로, 인자 없는
  // auth.getUser()는 로컬 세션을 찾다가 네트워크 호출조차 없이 "Auth session missing!"으로
  // 즉시 실패한다(marketService.js의 accessToken 콜백 설계와 동일한 이유). 토큰을 직접
  // getUser(jwt)에 넘겨 무상태(stateless) 검증을 해야 한다.
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const userClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
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

  const { data: apiKey, error: apiKeyErr } = await admin.rpc("get_delivery_api_key");
  if (apiKeyErr || !apiKey) {
    return jsonResponse({ success: false, error: "배송 조회 API 키를 찾을 수 없습니다." }, 500);
  }
  const { data: webhookConfig, error: webhookConfigErr } = await admin.rpc("get_delivery_webhook_config").single();
  if (webhookConfigErr || !webhookConfig?.endpoint_id) {
    return jsonResponse({ success: false, error: "웹훅 엔드포인트 설정을 찾을 수 없습니다." }, 500);
  }

  // 이미 등록된 송장을 다시 제출 — 오입력 정정. 기존 구독은 취소하고 delivered_at 등
  // 이전 잘못된 송장의 조회 결과를 새 등록에 남기지 않도록 초기화한다.
  const isCorrection = !!order.tracking_number && (order.courier_code !== courierCode || order.tracking_number !== trackingNumber);
  if (isCorrection && order.delivery_request_id) {
    await cancelTrackingSubscription(apiKey as string, order.delivery_request_id as string);
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    courier_code: courierCode,
    courier_name: courierName,
    tracking_number: trackingNumber,
    shipped_at: nowIso,
    delivery_status: "IN_TRANSIT",
    delivery_status_text: null,
    delivery_checked_at: null,
    delivered_at: null,
    updated_at: nowIso,
  };

  try {
    const registered = await registerTracking(
      apiKey as string,
      webhookConfig.endpoint_id as string,
      courierCode,
      trackingNumber,
      orderId
    );
    update.delivery_request_id = registered.requestId;
    update.webhook_registered = true;
    update.webhook_registered_at = nowIso;
  } catch (eReg) {
    // 구독 등록 자체가 실패하면(예: 잘못된 송장번호) 등록을 중단하고 판매자에게 사유를 그대로 보여준다.
    return jsonResponse({ success: false, error: (eReg as Error).message }, 400);
  }

  try {
    const immediate = await fetchImmediateStatus(apiKey as string, courierCode, trackingNumber);
    if (immediate) {
      update.delivery_status = immediate.status;
      update.delivery_status_text = immediate.statusText;
      update.delivery_checked_at = nowIso;
      if (immediate.isDelivered) update.delivered_at = nowIso;
    }
  } catch (_eImmediate) {
    // 즉시 조회 실패는 무시 — 구독이 곧 첫 자동 폴링 결과를 웹훅으로 보내준다.
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
