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
//
// 2026-10-09: body {"mode":"tracker"}로 30분마다 호출되면(pg_cron market-check-delivery-tracker)
// delivery_provider='tracker' 송장만 Delivery Tracker V2로 개별 조회한다. 배달완료는 영구 확정이라
// 재조회하지 않고, 배송 중은 마지막 조회 후 30분 이내면 건너뛴다(_shared/deliveryTracker.ts).
// 하루 1회 기본 모드는 기존 deliveryapi 배치 그대로이며, Tracker 송장 중 12시간 넘게 갱신되지
// 않은 건(Tracker 장애 등)도 deliveryapi 단발 조회로 함께 보정한다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isTrackerEnabled, shouldSkipTrackerCheck, trackShipment, TrackerNotFoundError } from "../_shared/deliveryTracker.ts";

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

  let reqBody: Record<string, unknown> = {};
  try {
    reqBody = await req.json();
  } catch (_e) {
    // pg_cron 기본 호출은 body {} — 기존 일일 배치 모드
  }

  if (reqBody.mode === "tracker") {
    if (!isTrackerEnabled()) return jsonResponse({ success: true, mode: "tracker", skipped: "not_configured" });
    const sides = [
      { p: "", returnStatus: false },
      { p: "return_", returnStatus: true },
    ];
    let checked = 0, delivered = 0, cached = 0, failed = 0;
    for (const side of sides) {
      const P = side.p;
      const { data: rows } = await admin
        .from("market_orders")
        .select(`id, ${P}courier_code, ${P}tracking_number, ${P}delivery_status, ${P}delivery_checked_at`)
        .eq(`${P}delivery_provider`, "tracker")
        .not(`${P}tracking_number`, "is", null)
        .neq(`${P}delivery_status`, "DELIVERED")
        .limit(200);
      for (const o of (rows || []) as Record<string, any>[]) {
        if (shouldSkipTrackerCheck(o[`${P}delivery_status`], o[`${P}delivery_checked_at`])) {
          cached += 1;
          continue;
        }
        try {
          const tr = await trackShipment(o[`${P}courier_code`], o[`${P}tracking_number`]);
          if (!tr) continue;
          const nowIso = new Date().toISOString();
          const update: Record<string, unknown> = {
            [`${P}delivery_status`]: tr.status,
            [`${P}delivery_status_text`]: tr.statusText,
            [`${P}delivery_events`]: tr.events,
            [`${P}delivery_checked_at`]: nowIso,
          };
          if (tr.isDelivered) {
            update[`${P}delivered_at`] = nowIso; // 감지 시각 기준 72h — 기존 웹훅 경로와 동일 의미
            if (side.returnStatus) update.return_status = "DELIVERED";
            delivered += 1;
          }
          // 이미 DELIVERED로 바뀐 행은 덮어쓰지 않는다(동시 웹훅·수동 처리와 경합 방지).
          await admin.from("market_orders").update(update).eq("id", o.id).neq(`${P}delivery_status`, "DELIVERED");
          checked += 1;
        } catch (e) {
          failed += 1;
          // NOT_FOUND(아직 택배사 전산 미등록)는 다음 주기 재시도. 조회 시각만 남겨 30분 캐시를 적용.
          if (e instanceof TrackerNotFoundError) {
            await admin.from("market_orders").update({ [`${P}delivery_checked_at`]: new Date().toISOString() }).eq("id", o.id);
          } else {
            console.warn("[market-check-delivery-status:tracker] 조회 실패:", o.id, (e as Error).message);
          }
        }
      }
    }
    return jsonResponse({ success: true, mode: "tracker", checked, delivered, cached, failed });
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
    .select("id, courier_code, tracking_number, delivery_status, delivery_provider, delivery_checked_at")
    .not("tracking_number", "is", null)
    .neq("delivery_status", "DELIVERED")
    .limit(200);
  const { data: returnOrders } = await admin
    .from("market_orders")
    .select("id, return_courier_code, return_tracking_number, return_delivery_status, return_delivery_provider, return_delivery_checked_at")
    .not("return_tracking_number", "is", null)
    .neq("return_delivery_status", "DELIVERED")
    .limit(200);
  // Tracker 송장은 30분 폴링이 담당 — 12시간 넘게 갱신 안 된 건(Tracker 장애·미등록 지속)만 deliveryapi로 보정.
  const STALE_MS = 12 * 60 * 60 * 1000;
  const needsLegacy = (provider: unknown, checkedAt: unknown) =>
    provider !== "tracker" || !checkedAt || Date.now() - Date.parse(String(checkedAt)) > STALE_MS;

  const forwardResult = await pollGroup(
    (forwardOrders || []).filter((o) => needsLegacy(o.delivery_provider, o.delivery_checked_at)).map((o) => ({ id: o.id, courierCode: o.courier_code, trackingNumber: o.tracking_number, status: o.delivery_status })),
    { courier: "courier_code", tracking: "tracking_number", status: "delivery_status", statusText: "delivery_status_text", checkedAt: "delivery_checked_at", deliveredAt: "delivered_at" }
  );
  const returnResult = await pollGroup(
    (returnOrders || []).filter((o) => needsLegacy(o.return_delivery_provider, o.return_delivery_checked_at)).map((o) => ({ id: o.id, courierCode: o.return_courier_code, trackingNumber: o.return_tracking_number, status: o.return_delivery_status })),
    { courier: "return_courier_code", tracking: "return_tracking_number", status: "return_delivery_status", statusText: "return_delivery_status_text", checkedAt: "return_delivery_checked_at", deliveredAt: "return_delivered_at", returnStatus: "return_status" }
  );

  return jsonResponse({
    success: true,
    checked: forwardResult.checked + returnResult.checked,
    delivered: forwardResult.delivered + returnResult.delivered,
  });
});
