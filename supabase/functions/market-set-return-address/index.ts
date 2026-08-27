// 중고랜드 — 판매자가 "반품 확인" 클릭 후 반품받을 주소를 입력한다(대회 신청서의 다음
// 주소검색 로직과 동일한 Daum 우편번호 서비스를 프론트에서 재사용, 여기서는 결과만 저장).
// verify_jwt: false — market-request-return과 동일한 이유(JWKS 무상태 검증).
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

  let sellerId: string;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: "authenticated",
    });
    if (!payload.sub) throw new Error("no sub claim");
    sellerId = payload.sub;
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
  const zipCode = String(body.zipCode || "").trim();
  const address1 = String(body.address1 || "").trim();
  const address2 = String(body.address2 || "").trim();
  if (!orderId || !zipCode || !address1 || !address2) {
    return jsonResponse({ success: false, error: "orderId·zipCode·address1·address2가 필요합니다." }, 400);
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
    return jsonResponse({ success: false, error: "본인 상품의 주문만 처리할 수 있습니다." }, 403);
  }
  if (order.return_status !== "REQUESTED") {
    return jsonResponse({ success: false, error: "반품 신청 상태의 주문만 주소를 등록할 수 있습니다." }, 400);
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await admin
    .from("market_orders")
    .update({
      return_address_zip: zipCode,
      return_address1: address1,
      return_address2: address2,
      return_status: "ADDRESS_SET",
      return_address_set_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", orderId)
    .eq("return_status", "REQUESTED")
    .select()
    .single();
  if (updErr) {
    return jsonResponse({ success: false, error: updErr.message }, 500);
  }

  return jsonResponse({ success: true, order: updated });
});
