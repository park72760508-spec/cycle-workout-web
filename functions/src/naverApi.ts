/**
 * STELVIO AI - 네이버 커머스 API 모듈
 * OAuth 2.0 인증, 주문 조회(last-changed-statuses), 발송 처리(dispatch)
 * bcryptjs 사용 (순수 JS, Cloud Functions 배포 호환)
 */
import * as bcrypt from "bcryptjs";

const NAVER_TOKEN_URL = "https://api.commerce.naver.com/external/v1/oauth2/token";
const NAVER_API_BASE = "https://api.commerce.naver.com/external/v1/pay-order/seller";
/** 주문 상세 조회 API(공식): POST pay-order/seller/product-orders/query, Body: {"productOrderIds": ["id1","id2"]} */
const NAVER_PRODUCT_ORDERS_QUERY_URL = "https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/query";

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

/** 주문 상세 내역 조회 API 응답 항목 — productOrder 내 ordererTel, ordererName, productOption 등 */
export interface ProductOrderDetailItem {
  productOrderId?: string;
  orderId?: string;
  /** API 응답: 주문자 연락처 (매칭용 핵심) */
  ordererTel?: string;
  /** API 응답: 주문자 이름 */
  ordererName?: string;
  /** API 응답: 주문자 번호 */
  ordererNo?: string;
  /** API 응답: 사용자 입력 추가 정보(옵션) */
  productOption?: string | { optionValue?: string; optionName?: string; [key: string]: unknown };
  orderer?: {
    tel?: string;
    contact?: string;
    name?: string;
    no?: string;
    [key: string]: unknown;
  };
  orderOptions?: Array<{
    optionCode?: string;
    optionValue?: string;
    optionName?: string;
    [key: string]: unknown;
  }>;
  orderMemo?: string;
  buyerComment?: string;
  [key: string]: unknown;
}

/** 주문 상세 조회 API 응답: data(배열), 각 항목은 productOrder 객체 래핑 가능 */
export interface ProductOrderDetailsResponse {
  /** 성공 시 data는 배열. 각 요소가 { productOrder: {...} } 형태일 수 있음 */
  data?: Array<
    | ProductOrderDetailItem
    | { productOrder?: ProductOrderDetailItem; [key: string]: unknown }
  >;
  productOrders?: ProductOrderDetailItem[];
  [key: string]: unknown;
}

/** 주문 상세 내역 조회 — POST /product-orders/query, Body: {"productOrderIds": ["id1","id2"]}, Authorization: Bearer 필수 */
export async function getProductOrderDetails(
  accessToken: string,
  productOrderIds: string[]
): Promise<ProductOrderDetailItem[]> {
  if (productOrderIds.length === 0) return [];
  const batch = Array.isArray(productOrderIds) ? productOrderIds.slice(0, 300) : [String(productOrderIds)];
  const payload: { productOrderIds: string[] } = { productOrderIds: batch };
  console.log("[naverApi] 주문 상세 조회 요청 payload:", JSON.stringify(payload));

  const res = await fetch(NAVER_PRODUCT_ORDERS_QUERY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver product-orders/query failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as ProductOrderDetailsResponse;
  const rawJson = JSON.stringify(data);
  const logJson = rawJson.length > 3000 ? rawJson.slice(0, 3000) + "...(truncated)" : rawJson;
  console.log("[naverApi] 주문 상세 조회 응답 전체 (필드 확인용):", logJson);

  /* 공식 API: 응답은 data(배열). 각 항목이 productOrder 객체로 래핑된 경우 풀어서 사용 */
  const rawList: Array<ProductOrderDetailItem | { productOrder?: ProductOrderDetailItem }> =
    Array.isArray(data.data) ? data.data
    : Array.isArray(data.productOrders) ? data.productOrders
    : [];
  const list = rawList.map((item): ProductOrderDetailItem => {
    if (item && typeof item === "object" && "productOrder" in item && item.productOrder != null) {
      return item.productOrder;
    }
    return item as ProductOrderDetailItem;
  });
  console.log("[naverApi] 주문 상세 조회:", batch.length, "건 요청 →", list.length, "건 수신");
  return list;
}

/** 상세 주문에서 연락처·이름·옵션 추출 (ordererTel, ordererName, productOption). 하이픈 제거는 매칭 단계에서 */
export function extractContactFromDetail(detail: ProductOrderDetailItem): {
  ordererTel: string | null;
  ordererName: string | null;
  ordererNo: string | null;
  optionPhoneOrId: string | null;
  memoOrOptionId: string | null;
} {
  let ordererTel: string | null = (detail.ordererTel ?? "")
    .toString()
    .trim() || null;
  let ordererName: string | null = (detail.ordererName ?? "")
    .toString()
    .trim() || null;
  let ordererNo: string | null = (detail.ordererNo ?? "")
    .toString()
    .trim() || null;
  const orderer = detail.orderer;
  if (orderer) {
    if (!ordererTel)
      ordererTel =
        (orderer.tel || orderer.contact || (orderer as { phone?: string }).phone || "")
          .toString()
          .trim() || null;
    if (!ordererName) ordererName = (orderer.name ?? "").toString().trim() || null;
    if (!ordererNo) ordererNo = (orderer.no ?? (orderer as { ordererNo?: string }).ordererNo ?? "").toString().trim() || null;
  }
  let optionPhoneOrId: string | null = null;
  let memoOrOptionId: string | null = null;
  const productOption = detail.productOption;
  if (productOption != null) {
    const val =
      typeof productOption === "string"
        ? productOption.trim()
        : (productOption.optionValue ?? productOption.optionName ?? "").toString().trim();
    if (val) {
      optionPhoneOrId = val;
      memoOrOptionId = val;
    }
  }
  const options = detail.orderOptions;
  if (options && options.length > 0 && !optionPhoneOrId) {
    for (const opt of options) {
      const val = (opt.optionValue ?? opt.optionName ?? "").toString().trim();
      if (val) {
        optionPhoneOrId = val;
        memoOrOptionId = memoOrOptionId ?? val;
        break;
      }
    }
  }
  const memo = (detail.orderMemo ?? detail.buyerComment ?? "").toString().trim() || null;
  if (memo) memoOrOptionId = memoOrOptionId ?? memo;
  return { ordererTel, ordererName, ordererNo, optionPhoneOrId, memoOrOptionId };
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
