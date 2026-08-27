// 중고랜드 — 구매자가 반품 택배사/송장번호를 등록한다(market-set-tracking과 동일한
// deliveryapi.co.kr 구독형 웹훅 추적 로직을 반품 배송에 그대로 재사용, return_* 컬럼에
// 기록한다는 점과 판매자 대신 구매자가 등록한다는 점만 다르다).
// clientId는 orderId 뒤에 ":return"을 붙여 원 배송 구독과 구분한다(market-delivery-webhook
// 수신부가 이 접미사로 반품 배송인지 판별).
// verify_jwt: false — market-set-tracking과 동일한 이유(JWKS 무상태 검증).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const jwks = createRemoteJWKSet(
  new URL(`${Deno.env.get("SUPABASE_URL")}/auth/v1/.well-known/jwks.json`)
);

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
      throw new Error(`반품 택배 추적 등록 응답 파싱 실패(HTTP ${res.status})`);
    }
  }
  if (!res.ok) {
    const detail = Array.isArray(json?.data) && json.data[0]
      ? `${(json.data[0] as Record<string, unknown>).errorCode || ""} ${(json.data[0] as Record<string, unknown>).trackingNumber || ""}`.trim()
      : "";
    throw new Error(`${String(json?.error || `HTTP ${res.status}`)}${detail ? ` (${detail})` : ""}`);
  }
  return json.data as { requestId: string; itemCount: number; recurring: boolean };
}

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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  let buyerId: string;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: "authenticated",
    });
    if (!payload.sub) throw new Error("no sub claim");
    buyerId = payload.sub;
  } catch (_eAuth) {
    return jsonResponse({ success: false, error: "인증이 필요합니다." }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_e) {
    // 아래 필수값 검증에서 걸러짐
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
  if (order.buyer_id !== buyerId) {
    return jsonResponse({ success: false, error: "본인 주문만 등록할 수 있습니다." }, 403);
  }
  if (order.return_status !== "ADDRESS_SET" && !order.return_tracking_number) {
    return jsonResponse({ success: false, error: "판매자가 반품 주소를 등록한 후에 송장을 등록할 수 있습니다." }, 400);
  }
  if (order.return_status === "DISPUTED" || order.return_status === "COMPLETED") {
    return jsonResponse({ success: false, error: "더 이상 송장을 수정할 수 없는 상태입니다." }, 400);
  }

  const { data: apiKey, error: apiKeyErr } = await admin.rpc("get_delivery_api_key");
  if (apiKeyErr || !apiKey) {
    return jsonResponse({ success: false, error: "배송 조회 API 키를 찾을 수 없습니다." }, 500);
  }
  const { data: webhookConfig, error: webhookConfigErr } = await admin.rpc("get_delivery_webhook_config").single();
  if (webhookConfigErr || !webhookConfig?.endpoint_id) {
    return jsonResponse({ success: false, error: "웹훅 엔드포인트 설정을 찾을 수 없습니다." }, 500);
  }

  const isCorrection = !!order.return_tracking_number && (order.return_courier_code !== courierCode || order.return_tracking_number !== trackingNumber);
  if (isCorrection && order.return_delivery_request_id) {
    await cancelTrackingSubscription(apiKey as string, order.return_delivery_request_id as string);
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    return_courier_code: courierCode,
    return_courier_name: courierName,
    return_tracking_number: trackingNumber,
    return_shipped_at: nowIso,
    return_delivery_status: "IN_TRANSIT",
    return_delivery_status_text: null,
    return_delivery_checked_at: null,
    return_delivered_at: null,
    updated_at: nowIso,
  };

  try {
    const registered = await registerTracking(
      apiKey as string,
      webhookConfig.endpoint_id as string,
      courierCode,
      trackingNumber,
      orderId + ":return"
    );
    update.return_delivery_request_id = registered.requestId;
    update.return_webhook_registered = true;
    update.return_webhook_registered_at = nowIso;
  } catch (eReg) {
    return jsonResponse({ success: false, error: (eReg as Error).message }, 400);
  }

  try {
    const immediate = await fetchImmediateStatus(apiKey as string, courierCode, trackingNumber);
    if (immediate) {
      update.return_delivery_status = immediate.status;
      update.return_delivery_status_text = immediate.statusText;
      update.return_delivery_checked_at = nowIso;
      if (immediate.isDelivered) {
        update.return_delivered_at = nowIso;
        update.return_status = "DELIVERED";
      }
    }
  } catch (_eImmediate) {
    // 즉시 조회 실패는 무시 — 구독이 곧 첫 자동 폴링 결과를 웹훅으로 보내준다.
  }

  const { data: updated, error: updErr } = await admin
    .from("market_orders")
    .update(update)
    .eq("id", orderId)
    .select()
    .single();
  if (updErr) {
    return jsonResponse({ success: false, error: updErr.message }, 500);
  }

  return jsonResponse({ success: true, order: updated });
});
