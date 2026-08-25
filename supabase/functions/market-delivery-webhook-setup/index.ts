// 1회성 관리 작업 — STELVIO 웹훅 수신 엔드포인트를 deliveryapi.co.kr에 등록(이미 있으면 찾아서)
// 후 시크릿 로테이션으로 새 webhookSecret을 발급받는다. x-cron-secret으로 보호.
// 실행 후 응답의 endpointId/webhookSecret을 Vault(delivery_webhook_endpoint_id/
// delivery_webhook_secret)에 저장해야 한다 — webhookSecret은 이 응답에서만 평문으로 보인다.
// 이미 1회 실행 완료(2026-08-25) — 재실행 시 시크릿이 다시 로테이션되어 기존 저장값과
// 어긋나므로, 재실행이 필요하면 Vault 값도 함께 갱신해야 한다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const DELIVERY_API_BASE = "https://api.deliveryapi.co.kr/v1";

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

  const callbackUrl = `${supabaseUrl}/functions/v1/market-delivery-webhook`;

  const listRes = await fetch(`${DELIVERY_API_BASE}/webhooks/endpoints`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const listJson = await listRes.json().catch(() => ({}));
  if (!listRes.ok) {
    return jsonResponse({ success: false, error: `엔드포인트 목록 조회 실패(HTTP ${listRes.status})`, response: listJson }, 500);
  }
  const endpoints = (listJson?.data?.endpoints as Array<Record<string, unknown>>) || [];
  const existing = endpoints.find((e) => e.url === callbackUrl);

  let endpointId: string;
  if (existing) {
    endpointId = existing.endpointId as string;
  } else {
    const createRes = await fetch(`${DELIVERY_API_BASE}/webhooks/endpoints`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: callbackUrl, name: "STELVIO 중고랜드 배송 알림" }),
    });
    const createJson = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      return jsonResponse({ success: false, error: `엔드포인트 등록 실패(HTTP ${createRes.status})`, response: createJson }, 500);
    }
    return jsonResponse({ success: true, data: createJson.data });
  }

  // 기존 엔드포인트의 webhookSecret은 생성 시에만 보였으므로(이미 분실), rotate로 새 시크릿 발급.
  const rotateRes = await fetch(`${DELIVERY_API_BASE}/webhooks/endpoints/${endpointId}/rotate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const rotateJson = await rotateRes.json().catch(() => ({}));
  if (!rotateRes.ok) {
    return jsonResponse({ success: false, error: `시크릿 재발급 실패(HTTP ${rotateRes.status})`, response: rotateJson, endpointId }, 500);
  }

  return jsonResponse({ success: true, data: { endpointId, webhookSecret: rotateJson?.data?.webhookSecret, rotated: true } });
});
