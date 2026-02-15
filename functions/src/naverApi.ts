/**
 * STELVIO AI - 네이버 커머스 API 모듈
 * OAuth 2.0 인증, 주문 조회(last-changed-statuses), 발송 처리(dispatch)
 * bcryptjs 사용 (순수 JS, Cloud Functions 배포 호환)
 */
import * as bcrypt from "bcryptjs";

const NAVER_TOKEN_URL = "https://api.commerce.naver.com/external/v1/oauth2/token";
const NAVER_API_BASE = "https://api.commerce.naver.com/external/v1/pay-order/seller";

/** API 허용값: PAYED(결제완료), CLAIM_COMPLETED(클레임 완료 = 취소/반품 완료). CANCELLED/RETURNED는 미지원 */
export type LastChangedType = "PAYED" | "CLAIM_COMPLETED";

/** 전자서명 생성: client_id_timestamp 를 client_secret(salt)으로 bcrypt 후 Base64 */
export function createClientSecretSign(
  clientId: string,
  clientSecret: string,
  timestamp: number
): string {
  const password = `${clientId}_${timestamp}`;
  const hashed = bcrypt.hashSync(password, clientSecret);
  return Buffer.from(hashed, "utf-8").toString("base64");
}

/** Access Token 발급 (Client Credentials) */
export async function getAccessToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  const timestamp = Date.now();
  const clientSecretSign = createClientSecretSign(clientId, clientSecret, timestamp);

  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: clientSecretSign,
    grant_type: "client_credentials",
    type: "SELF",
  });

  const res = await fetch(NAVER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver token failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Naver token response has no access_token");
  }
  return data.access_token;
}

/** last-changed-statuses API 응답 상품 주문 항목 */
export interface ProductOrderItem {
  productOrderId?: string;
  orderId?: string;
  productOrderStatus?: string;
  lastChangedType?: string;
  lastChangedDate?: string;
  paymentDate?: string;
  orderer?: {
    name?: string;
    tel?: string;
    contact?: string;
    [key: string]: unknown;
  };
  orderOptions?: Array<{
    optionCode?: string;
    optionValue?: string;
    optionName?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** 네이버 API 실제 응답: data.lastChangeStatuses(배열), data.count(건수) */
export interface LastChangedStatusesResponse {
  data?: {
    lastChangeStatuses?: ProductOrderItem[];
    count?: number;
    [key: string]: unknown;
  };
  moreSequence?: number;
  [key: string]: unknown;
}

/** 최근 상태 변경된 주문 조회 (PAYED, CLAIM_COMPLETED 등) */
export async function getLastChangedOrders(
  accessToken: string,
  lastChangedType: LastChangedType,
  options: {
    lastChangedFrom: string; // ISO 8601
    lastChangedTo?: string;
    limitCount?: number;
    moreSequence?: number;
  }
): Promise<{ orders: ProductOrderItem[]; count?: number; moreSequence?: number }> {
  const params = new URLSearchParams({
    lastChangedFrom: options.lastChangedFrom,
    lastChangedType,
  });
  if (options.lastChangedTo) params.set("lastChangedTo", options.lastChangedTo);
  if (options.limitCount != null) params.set("limitCount", String(options.limitCount));
  if (options.moreSequence != null) params.set("moreSequence", String(options.moreSequence));

  const url = `${NAVER_API_BASE}/product-orders/last-changed-statuses?${params.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver last-changed-statuses failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as LastChangedStatusesResponse;
  const lastChangeStatuses = Array.isArray(data.data?.lastChangeStatuses)
    ? data.data.lastChangeStatuses
    : [];
  const count = data.data?.count;
  if (lastChangeStatuses.length === 0) {
    const reqParams = Object.fromEntries(params.entries());
    const resBodyStr = JSON.stringify(data);
    const truncate = resBodyStr.length > 2000 ? resBodyStr.slice(0, 2000) + "...(truncated)" : resBodyStr;
    console.warn(
      "[naverApi] last-changed-statuses 응답 0건 (lastChangeStatuses.length=0). 요청 params:",
      reqParams,
      "| Response Body(디버깅용):",
      truncate
    );
  } else {
    console.log(
      "[naverApi] last-changed-statuses 수신: lastChangeStatuses.length=",
      lastChangeStatuses.length,
      "response.data.count=",
      count
    );
  }
  return { orders: lastChangeStatuses, count, moreSequence: data.moreSequence };
}

/** 주문 상세 내역 조회 API 응답 항목 (연락처·옵션·요청사항 포함) */
export interface ProductOrderDetailItem {
  productOrderId?: string;
  orderId?: string;
  orderer?: {
    tel?: string;
    contact?: string;
    name?: string;
    [key: string]: unknown;
  };
  orderOptions?: Array<{
    optionCode?: string;
    optionValue?: string;
    optionName?: string;
    [key: string]: unknown;
  }>;
  /** 주문 시 요청사항(스마트스토어) */
  orderMemo?: string;
  buyerComment?: string;
  [key: string]: unknown;
}

/** 주문 상세 내역 조회 API 응답 (POST product-orders/query) */
export interface ProductOrderDetailsResponse {
  data?: {
    productOrders?: ProductOrderDetailItem[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** 주문 상세 내역 조회 — 연락처·옵션·요청사항 추출용 (최대 300건) */
export async function getProductOrderDetails(
  accessToken: string,
  productOrderIds: string[]
): Promise<ProductOrderDetailItem[]> {
  if (productOrderIds.length === 0) return [];
  const batch = productOrderIds.slice(0, 300);
  const res = await fetch(`${NAVER_API_BASE}/product-orders/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ productOrderIds: batch }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver product-orders/query failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as ProductOrderDetailsResponse;
  const list = Array.isArray(data.data?.productOrders) ? data.data.productOrders : [];
  console.log("[naverApi] 주문 상세 조회:", batch.length, "건 요청 →", list.length, "건 수신");
  return list;
}

/** 상세 주문에서 연락처·요청사항·옵션값 추출 (매칭용) */
export function extractContactFromDetail(detail: ProductOrderDetailItem): {
  ordererTel: string | null;
  optionPhoneOrId: string | null;
  memoOrOptionId: string | null;
} {
  let ordererTel: string | null = null;
  const orderer = detail.orderer;
  if (orderer) {
    ordererTel =
      (orderer.tel || orderer.contact || (orderer as { phone?: string }).phone || "")
        .toString()
        .trim() || null;
  }
  let optionPhoneOrId: string | null = null;
  let memoOrOptionId: string | null = null;
  const options = detail.orderOptions;
  if (options && options.length > 0) {
    for (const opt of options) {
      const val = (opt.optionValue ?? opt.optionName ?? "").toString().trim();
      if (val) {
        optionPhoneOrId = optionPhoneOrId ?? val;
        memoOrOptionId = memoOrOptionId ?? val;
        break;
      }
    }
  }
  const memo = (detail.orderMemo ?? detail.buyerComment ?? "").toString().trim() || null;
  if (memo) memoOrOptionId = memoOrOptionId ?? memo;
  return { ordererTel, optionPhoneOrId, memoOrOptionId };
}

/** 주문 옵션/연락처에서 전화번호 또는 사용자 식별자 추출 (1순위: 옵션, 2순위: 주문자 연락처) — last-changed-statuses용 */
export function extractContactFromOrder(order: ProductOrderItem): {
  optionPhoneOrId: string | null;
  ordererTel: string | null;
} {
  let optionPhoneOrId: string | null = null;
  const options = order.orderOptions;
  if (options && options.length > 0) {
    for (const opt of options) {
      const val = (opt.optionValue || opt.optionName || "").toString().trim();
      if (val) {
        optionPhoneOrId = val;
        break;
      }
    }
  }

  let ordererTel: string | null = null;
  const orderer = order.orderer;
  if (orderer) {
    ordererTel =
      (orderer.tel || orderer.contact || (orderer as { phone?: string }).phone || "")
        .toString()
        .trim() || null;
  }

  return { optionPhoneOrId, ordererTel };
}

/** 발송 처리 (배송 없음: NOTHING - 디지털 상품/구독 정산 확정용) */
export async function dispatchProductOrders(
  accessToken: string,
  productOrderIds: string[]
): Promise<{ successIds: string[]; failInfos: Array<{ productOrderId: string; message?: string }> }> {
  if (productOrderIds.length === 0) {
    return { successIds: [], failInfos: [] };
  }
  // 최대 30건 일괄 처리
  const batch = productOrderIds.slice(0, 30);
  const dispatchDate = new Date().toISOString();

  const body = {
    dispatchProductOrders: batch.map((id) => ({
      productOrderId: id,
      deliveryMethod: "NOTHING",
      dispatchDate,
    })),
  };

  const res = await fetch(`${NAVER_API_BASE}/product-orders/dispatch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver dispatch failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    successProductOrderIds?: string[];
    failProductOrderInfos?: Array<{ productOrderId?: string; message?: string }>;
  };
  const successIds = Array.isArray(data.successProductOrderIds) ? data.successProductOrderIds : [];
  const failInfos = (Array.isArray(data.failProductOrderInfos) ? data.failProductOrderInfos : []).map(
    (f) => ({ productOrderId: String(f.productOrderId || ""), message: f.message })
  );
  return { successIds, failInfos };
}
