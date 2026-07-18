/**
 * 토스페이먼츠 서버 API 클라이언트 — 가상계좌 발급·조회·취소.
 * https://docs.tosspayments.com (2026-07-18 기준 확인):
 *   POST /v1/virtual-accounts                — 가상계좌 발급
 *   GET  /v1/payments/orders/{orderId}        — orderId로 결제 조회
 *   POST /v1/payments/{paymentKey}/cancel     — 결제 취소(가상계좌는 refundReceiveAccount 필수)
 * 인증: Authorization: Basic base64(secretKey + ":") — 콜론 필수, BOM 없이 인코딩.
 * functions/aligoAlimtalkUnified.js와 동일하게 실패 시 응답 JSON을 그대로 담아 throw.
 */
const { scrubTossCredential, logTossAuthShape } = require("./tossCredentials");

const TOSS_API_BASE = "https://api.tosspayments.com/v1";

function buildAuthHeader(secretKeyRaw) {
  const secretKey = scrubTossCredential(secretKeyRaw);
  logTossAuthShape("auth", secretKey);
  if (!secretKey) {
    throw new Error("[tossPaymentsClient] TOSS_SECRET_KEY가 비어 있습니다.");
  }
  const encoded = Buffer.from(`${secretKey}:`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

async function tossFetch(secretKeyRaw, path, options = {}) {
  const headers = {
    Authorization: buildAuthHeader(secretKeyRaw),
    "Content-Type": "application/json",
  };
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = String(options.idempotencyKey);
  }
  const res = await fetch(`${TOSS_API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `[tossPaymentsClient] ${path} 실패 HTTP ${res.status}: ${json && json.message ? json.message : JSON.stringify(json)}`
    );
    err.tossCode = json && json.code;
    err.tossResponse = json;
    err.httpStatus = res.status;
    throw err;
  }
  return json;
}

/**
 * 가상계좌 발급.
 * @param {string} secretKeyRaw
 * @param {{ amount:number, orderId:string, orderName:string, customerName:string, bank:string, validHours?:number, dueDate?:string }} params
 */
async function issueVirtualAccount(secretKeyRaw, params) {
  return tossFetch(secretKeyRaw, "/virtual-accounts", {
    method: "POST",
    body: params,
    idempotencyKey: `va-issue-${params.orderId}`,
  });
}

/** orderId로 결제 단건 조회 — 웹훅 authoritative 상태 재확인용(웹훅 바디 status를 직접 신뢰하지 않음). */
async function getPaymentByOrderId(secretKeyRaw, orderId) {
  return tossFetch(secretKeyRaw, `/payments/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });
}

/**
 * 결제 취소(환불). 가상계좌 결제는 refundReceiveAccount 필수.
 * @param {string} secretKeyRaw
 * @param {string} paymentKey
 * @param {{ cancelReason:string, refundReceiveAccount?: { bank:string, accountNumber:string, holderName:string } }} params
 * @param {string} idempotencyKey — 중복 취소 방지(applicationId 기반 고정값 권장)
 */
async function cancelPayment(secretKeyRaw, paymentKey, params, idempotencyKey) {
  return tossFetch(secretKeyRaw, `/payments/${encodeURIComponent(paymentKey)}/cancel`, {
    method: "POST",
    body: params,
    idempotencyKey,
  });
}

module.exports = {
  issueVirtualAccount,
  getPaymentByOrderId,
  cancelPayment,
};
