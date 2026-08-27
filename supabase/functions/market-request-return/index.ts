// 중고랜드 — 구매자가 배송완료된 안전결제 주문에 반품을 신청한다.
// 토스 환불(cancelPayment)에는 환불받을 계좌정보가 필수라 반품 신청 시점에 함께 받아
// return_refund_account에 저장해둔다(실제 환불 실행은 판매자 "반품완료"/합의완료/72시간
// 자동완료 시점에 Firebase Cloud Function에서 이 값을 사용해 처리 — Toss 시크릿키는
// Firebase Secret Manager에만 있어 Supabase에서는 결제 관련 액션을 직접 하지 않는다).
//
// verify_jwt: false로 배포 — 중고랜드 전용 커스텀 JWT는 GoTrue가 세션으로 추적하지
// 않아 플랫폼 게이트웨이 verify_jwt와 supabase-js의 무인자 getUser()를 모두 통과하지
// 못한다(market-set-tracking에서 실측 확인된 이유와 동일). 프로젝트 JWKS로 직접
// 서명을 검증한다(PostgREST가 이 토큰을 검증하는 것과 동일한 무상태 방식).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const jwks = createRemoteJWKSet(
  new URL(`${Deno.env.get("SUPABASE_URL")}/auth/v1/.well-known/jwks.json`)
);

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
  const bank = String(body.bank || "").trim();
  const accountNumber = String(body.accountNumber || "").trim();
  const holderName = String(body.holderName || "").trim();
  if (!orderId || !bank || !accountNumber || !holderName) {
    return jsonResponse({ success: false, error: "orderId·bank·accountNumber·holderName이 필요합니다." }, 400);
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
    return jsonResponse({ success: false, error: "본인 주문만 반품 신청할 수 있습니다." }, 403);
  }
  if (order.deal_type === "DIRECT_DEAL") {
    return jsonResponse({ success: false, error: "직거래는 반품 신청을 지원하지 않습니다." }, 400);
  }
  if (order.escrow_status !== "PAID") {
    return jsonResponse({ success: false, error: "입금이 확인된 주문만 반품 신청할 수 있습니다." }, 400);
  }
  if (order.delivery_status !== "DELIVERED") {
    return jsonResponse({ success: false, error: "배송완료 후에만 반품 신청할 수 있습니다." }, 400);
  }
  if (order.return_status) {
    return jsonResponse({ success: false, error: "이미 반품이 진행 중입니다." }, 409);
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await admin
    .from("market_orders")
    .update({
      return_status: "REQUESTED",
      return_requested_at: nowIso,
      return_refund_account: { bank, accountNumber, holderName },
      updated_at: nowIso,
    })
    .eq("id", orderId)
    .is("return_status", null)
    .select()
    .single();
  if (updErr) {
    return jsonResponse({ success: false, error: updErr.message }, 500);
  }

  return jsonResponse({ success: true, order: updated });
});
