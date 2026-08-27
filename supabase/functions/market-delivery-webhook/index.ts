// 중고랜드 — deliveryapi.co.kr 웹훅 수신. market-set-tracking이 구독 등록 시 지정한 엔드포인트
// (market-delivery-webhook-setup으로 미리 1회 등록·Vault 저장)로, 배송 상태가 바뀔 때마다
// 무료로(등록 1건만 과금, 이후 폴링·알림은 무료) 푸시된다 — 이게 주 채널이고, 정기 폴링
// (market-check-delivery-status)은 구독이 실패/만료된 극소수 건만 처리하는 하루 1회 안전망이다.
//
// 서명 검증(공식 문서): HMAC-SHA256(webhookSecret, "{timestamp}.{rawBody}"),
// X-Webhook-Signature: "sha256=<hex>", X-Webhook-Timestamp 허용 오차 300초.
// 반드시 200을 반환해야 하며(문서: 실패 지속 시 엔드포인트 자동 비활성화), 서명 불일치처럼
// 우리가 명확히 거부해야 하는 경우에만 401로 응답한다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifySignature(rawBody: string, timestamp: string, signature: string, secret: string): Promise<boolean> {
  if (!timestamp || !signature) return false;
  const diff = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(diff) || diff > 300) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  const hex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqualStr(`sha256=${hex}`, signature);
}

function statusFromItem(item: Record<string, unknown>) {
  const isDelivered = Boolean(item.isDelivered);
  const currentStatus = String(item.currentStatus || "").trim();
  return {
    status: isDelivered ? "DELIVERED" : currentStatus ? "IN_TRANSIT" : "UNKNOWN",
    statusText: currentStatus,
    isDelivered,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ success: true }); // 헬스체크·GET 확인 등에 대비
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: webhookConfig } = await admin.rpc("get_delivery_webhook_config").single();
  const webhookSecret = webhookConfig?.webhook_secret as string | undefined;

  const rawBody = await req.text();
  const timestamp = req.headers.get("x-webhook-timestamp") || "";
  const signature = req.headers.get("x-webhook-signature") || "";

  if (!webhookSecret) {
    console.error("[market-delivery-webhook] webhookSecret 미설정 — 검증 불가로 요청 거부");
    return jsonResponse({ success: false, error: "server misconfigured" }, 401);
  }
  const validSig = await verifySignature(rawBody, timestamp, signature, webhookSecret);
  if (!validSig) {
    return jsonResponse({ success: false, error: "invalid signature" }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch (_e) {
    return jsonResponse({ success: false, error: "잘못된 요청 본문" }, 200); // 재시도 폭주 방지 위해 200 유지
  }

  const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
  let matched = 0;
  for (const item of items) {
    const rawClientId = String(item.clientId || "").trim();
    const trackingNumber = String(item.trackingNumber || "").trim();
    const courierCode = String(item.courierCode || "").trim();
    // market-set-return-tracking이 등록 시 clientId를 "{orderId}:return"으로 붙였다 —
    // 이 접미사로 원 배송 구독인지 반품 배송 구독인지 구분해 컬럼을 다르게 갱신한다.
    const isReturn = rawClientId.endsWith(":return");
    const clientId = isReturn ? rawClientId.slice(0, -":return".length) : rawClientId;

    let order: { id: string } | null = null;
    if (clientId) {
      const { data } = await admin.from("market_orders").select("id").eq("id", clientId).maybeSingle();
      order = data;
    } else {
      const col = isReturn ? "return_tracking_number" : "tracking_number";
      const courierCol = isReturn ? "return_courier_code" : "courier_code";
      const { data } = await admin
        .from("market_orders")
        .select("id")
        .eq(col, trackingNumber)
        .eq(courierCol, courierCode)
        .maybeSingle();
      order = data;
    }
    if (!order) continue;

    const trace = statusFromItem(item);
    const nowIso = new Date().toISOString();
    const update: Record<string, unknown> = isReturn
      ? {
          return_delivery_status: trace.status,
          return_delivery_status_text: trace.statusText,
          return_delivery_checked_at: nowIso,
        }
      : {
          delivery_status: trace.status,
          delivery_status_text: trace.statusText,
          delivery_checked_at: nowIso,
        };
    if (trace.isDelivered) {
      if (isReturn) {
        update.return_delivered_at = nowIso;
        update.return_status = "DELIVERED";
      } else {
        update.delivered_at = nowIso;
      }
    }

    await admin.from("market_orders").update(update).eq("id", order.id);
    matched += 1;
  }

  return jsonResponse({ success: true, event: body.event, matched, total: items.length });
});
