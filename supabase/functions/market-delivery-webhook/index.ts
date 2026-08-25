// 중고랜드 — deliveryapi.co.kr 웹훅 수신. market-set-tracking이 송장 등록 시 함께 등록해둔
// 콜백 주소로, 배송 상태가 바뀔 때마다 무료로(등록 1건만 차감, 이후 상태 변경 알림은 무료 정책)
// 푸시된다. 이게 주 채널이 되면서 정기 폴링(market-check-delivery-status)은 웹훅 등록에
// 실패한 건에 한해서만 6시간 주기 안전망으로만 동작해 API 호출량을 크게 줄인다.
//
// ⚠️ 실제 웹훅 페이로드 스키마와 서명 검증 방식을 확인하지 못했다 — 흔한 필드명 후보를 관대하게
// 탐색하고, 서명 검증은 하지 않는다(수신 URL을 아는 제3자가 이미 우리 DB에 존재하는 송장번호에
// 대해 조회를 조작해 보낼 수 있다는 뜻 — 다만 tracking_number가 실제로 매칭되는 미배송완료
// 주문에 한해서만 반영하므로 임의 주문을 건드릴 수는 없고, 최악의 경우도 "배송완료" 조기 반영
// 정도라 실제 정산은 여전히 관리자가 수동 확인 후 처리해 자금 이동 위험은 없다).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ success: true }); // 헬스체크·GET 확인 등에 대비해 200으로만 응답
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ success: false, error: "잘못된 요청 본문" }, 200); // 웹훅은 재시도 폭주 방지를 위해 200 유지
  }

  // ⚠️ 실제 필드명 미검증 — trackingNumber/invoiceNo/trackNo 후보를 관대하게 탐색.
  const trackingNumber = String(body.trackingNumber || body.invoiceNo || body.trackNo || "").trim();
  if (!trackingNumber) {
    return jsonResponse({ success: false, error: "trackingNumber 없음" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: order, error } = await admin
    .from("market_orders")
    .select("id, delivery_status")
    .eq("tracking_number", trackingNumber)
    .neq("delivery_status", "DELIVERED")
    .maybeSingle();
  if (error || !order) {
    return jsonResponse({ success: true, matched: false });
  }

  const trace = normalizeDeliveryTraceResponse(body);
  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    delivery_status: trace.status,
    delivery_status_text: trace.statusText,
    delivery_checked_at: nowIso,
  };
  if (trace.isDelivered) update.delivered_at = nowIso;

  await admin.from("market_orders").update(update).eq("id", order.id);

  return jsonResponse({ success: true, matched: true });
});
