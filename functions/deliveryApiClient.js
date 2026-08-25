/**
 * deliveryapi.co.kr 택배 조회 API 클라이언트.
 * ⚠️ 공식 요청/응답 스키마 문서를 확인하지 못한 상태로 작성했다 — 사용자가 제공한 정보는
 * 엔드포인트(POST /v1/tracking/trace)와 Bearer 인증 형식뿐이라, 요청 바디 필드명(carrierId/
 * trackingNumber)과 응답 정규화 로직은 업계 통상 관례를 따른 최선의 추정이다. 실제 배송 건으로
 * 첫 호출을 해보고 응답이 다르면 normalizeDeliveryTraceResponse()만 실제 스키마에 맞게 고치면
 * 나머지(스케줄러·UI)는 그대로 동작한다.
 * 인증: Authorization: Bearer <apiKey> (pk_live_...:sk_client_... 형태 문자열 그대로 사용)
 */

const DELIVERY_API_BASE = "https://api.deliveryapi.co.kr/v1";

async function deliveryFetch(apiKeyRaw, path, options = {}) {
  const apiKey = String(apiKeyRaw || "").trim();
  if (!apiKey) {
    throw new Error("[deliveryApiClient] DELIVERY_API_KEY가 비어 있습니다.");
  }
  const res = await fetch(`${DELIVERY_API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`[deliveryApiClient] ${path} 응답 파싱 실패(HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
  }
  if (!res.ok) {
    const err = new Error(
      `[deliveryApiClient] ${path} 실패 HTTP ${res.status}: ${(json && (json.message || json.error)) || text.slice(0, 300)}`
    );
    err.httpStatus = res.status;
    err.response = json;
    throw err;
  }
  return json;
}

const DELIVERED_STATUS_TOKENS = ["delivered", "완료", "배달완료", "배송완료", "수령완료"];

/** 응답 스키마가 불확실하므로 흔히 쓰이는 필드명 후보를 관대하게 탐색해 내부 상태로 정규화한다. */
function normalizeDeliveryTraceResponse(json) {
  const root = (json && (json.data || json.result)) || json || {};
  const rawStatus = String(
    root.status || root.state || root.deliveryStatus || root.trackingStatus || ""
  ).trim();
  const statusLower = rawStatus.toLowerCase();
  const isDelivered = DELIVERED_STATUS_TOKENS.some((t) => statusLower.includes(t.toLowerCase()));
  const statusText = String(root.statusText || root.stateText || root.description || rawStatus || "").trim();
  return {
    raw: json,
    status: isDelivered ? "DELIVERED" : rawStatus ? "IN_TRANSIT" : "UNKNOWN",
    statusText,
    isDelivered,
  };
}

/**
 * 송장 배송 상태 조회.
 * @param {string} apiKeyRaw
 * @param {string} courierCode
 * @param {string} trackingNumber
 */
async function traceDelivery(apiKeyRaw, courierCode, trackingNumber) {
  const json = await deliveryFetch(apiKeyRaw, "/tracking/trace", {
    method: "POST",
    body: { carrierId: courierCode, trackingNumber },
  });
  return normalizeDeliveryTraceResponse(json);
}

module.exports = { traceDelivery, normalizeDeliveryTraceResponse };
