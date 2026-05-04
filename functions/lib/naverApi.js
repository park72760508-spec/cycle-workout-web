"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClientSecretSign = createClientSecretSign;
exports.getAccessToken = getAccessToken;
exports.getLastChangedOrders = getLastChangedOrders;
exports.getProductOrderDetails = getProductOrderDetails;
exports.extractContactFromDetail = extractContactFromDetail;
exports.computeSubscriptionDaysFromProduct = computeSubscriptionDaysFromProduct;
exports.extractContactFromOrder = extractContactFromOrder;
exports.dispatchProductOrders = dispatchProductOrders;
/**
 * STELVIO AI - 네이버 커머스 API 모듈
 * OAuth 2.0 인증, 주문 조회(last-changed-statuses), 발송 처리(dispatch)
 * bcryptjs 사용 (순수 JS, Cloud Functions 배포 호환)
 */
const bcrypt = __importStar(require("bcryptjs"));
const NAVER_TOKEN_URL = "https://api.commerce.naver.com/external/v1/oauth2/token";
const NAVER_API_BASE = "https://api.commerce.naver.com/external/v1/pay-order/seller";
/** 주문 상세 조회 API(공식): POST pay-order/seller/product-orders/query, Body: {"productOrderIds": ["id1","id2"]} */
const NAVER_PRODUCT_ORDERS_QUERY_URL = "https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/query";
/** 전자서명 생성: client_id_timestamp 를 client_secret(salt)으로 bcrypt 후 Base64 */
function createClientSecretSign(clientId, clientSecret, timestamp) {
    const password = `${clientId}_${timestamp}`;
    const hashed = bcrypt.hashSync(password, clientSecret);
    return Buffer.from(hashed, "utf-8").toString("base64");
}
/** Access Token 발급 (Client Credentials) */
async function getAccessToken(clientId, clientSecret) {
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
    const data = (await res.json());
    if (!data.access_token) {
        throw new Error("Naver token response has no access_token");
    }
    return data.access_token;
}
/** 최근 상태 변경된 주문 조회 (PAYED, CLAIM_REQUESTED, CLAIM_COMPLETED) */
async function getLastChangedOrders(accessToken, lastChangedType, options) {
    const params = new URLSearchParams({
        lastChangedFrom: options.lastChangedFrom,
        lastChangedType,
    });
    if (options.lastChangedTo)
        params.set("lastChangedTo", options.lastChangedTo);
    if (options.limitCount != null)
        params.set("limitCount", String(options.limitCount));
    if (options.moreSequence != null)
        params.set("moreSequence", String(options.moreSequence));
    const url = `${NAVER_API_BASE}/product-orders/last-changed-statuses?${params.toString()}`;
    const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Naver last-changed-statuses failed: ${res.status} ${text}`);
    }
    const data = (await res.json());
    const lastChangeStatuses = Array.isArray(data.data?.lastChangeStatuses)
        ? data.data.lastChangeStatuses
        : [];
    const count = data.data?.count;
    if (lastChangeStatuses.length === 0) {
        const reqParams = Object.fromEntries(params.entries());
        const resBodyStr = JSON.stringify(data);
        const truncate = resBodyStr.length > 2000 ? resBodyStr.slice(0, 2000) + "...(truncated)" : resBodyStr;
        console.warn("[naverApi] last-changed-statuses 응답 0건 (lastChangeStatuses.length=0). 요청 params:", reqParams, "| Response Body(디버깅용):", truncate);
    }
    else {
        console.log("[naverApi] last-changed-statuses 수신: lastChangeStatuses.length=", lastChangeStatuses.length, "response.data.count=", count);
    }
    return { orders: lastChangeStatuses, count, moreSequence: data.moreSequence };
}
/** 주문 상세 내역 조회 — POST /product-orders/query, Body: {"productOrderIds": ["id1","id2"]}, Authorization: Bearer 필수 */
async function getProductOrderDetails(accessToken, productOrderIds) {
    if (productOrderIds.length === 0)
        return [];
    const batch = Array.isArray(productOrderIds) ? productOrderIds.slice(0, 300) : [String(productOrderIds)];
    const payload = { productOrderIds: batch };
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
    const data = (await res.json());
    const rawJson = JSON.stringify(data);
    const logJson = rawJson.length > 3000 ? rawJson.slice(0, 3000) + "...(truncated)" : rawJson;
    console.log("[naverApi] 주문 상세 조회 응답 전체 (필드 확인용):", logJson);
    /* 공식 API: 응답은 data(배열). 각 항목이 { order, productOrder } 형태일 수 있음. order.ordererTel(2순위)을 productOrder에 병합 */
    const rawList = Array.isArray(data.data) ? data.data
        : Array.isArray(data.productOrders) ? data.productOrders
            : [];
    const list = rawList.map((item) => {
        let detail;
        if (item && typeof item === "object" && "productOrder" in item && item.productOrder != null) {
            detail = { ...item.productOrder };
            const order = item && "order" in item ? item.order : undefined;
            if (order && typeof order === "object") {
                if (order.ordererTel != null && order.ordererTel !== "")
                    detail.ordererTel = order.ordererTel;
                if (order.ordererName != null && order.ordererName !== "")
                    detail.ordererName = order.ordererName;
            }
            return detail;
        }
        return item;
    });
    console.log("[naverApi] 주문 상세 조회:", batch.length, "건 요청 →", list.length, "건 수신");
    return list;
}
/** 연락처 추출 (매칭 우선순위용). 1순위: productOrder.shippingAddress.tel1, 2순위: order.ordererTel, 3순위: productOrder.shippingMemo */
function extractContactFromDetail(detail) {
    const orderer = detail.orderer;
    const orderAny = orderer;
    const shippingAddressTel1 = (detail.shippingAddress?.tel1 ?? "")
        .toString()
        .trim() || null;
    let ordererTel = (detail.ordererTel ?? orderAny?.ordererTel ?? orderAny?.tel ?? "")
        .toString()
        .trim() || null;
    let ordererName = (detail.ordererName ?? orderAny?.ordererName ?? orderAny?.name ?? "")
        .toString()
        .trim() || null;
    let ordererNo = (detail.ordererNo ?? orderer?.no ?? orderer?.ordererNo ?? "")
        .toString()
        .trim() || null;
    if (orderer) {
        if (!ordererTel)
            ordererTel =
                (orderer.tel || orderer.contact || orderer.phone || "")
                    .toString()
                    .trim() || null;
        if (!ordererName)
            ordererName = (orderer.name ?? "").toString().trim() || null;
        if (!ordererNo)
            ordererNo = (orderer.no ?? orderer.ordererNo ?? "").toString().trim() || null;
    }
    const shippingMemo = (detail.shippingMemo ?? "")
        .toString()
        .trim() || null;
    let optionPhoneOrId = null;
    let memoOrOptionId = null;
    const productOption = detail.productOption;
    if (productOption != null) {
        const val = typeof productOption === "string"
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
    if (memo)
        memoOrOptionId = memoOrOptionId ?? memo;
    return { shippingAddressTel1, ordererTel, shippingMemo, ordererName, ordererNo, optionPhoneOrId, memoOrOptionId };
}
/** optionManageCode / productOption 명으로 기본 기간(일) 산정, quantity 곱하여 총 연장 일수 반환. 매칭 안 되면 31일, quantity 없으면 1 */
function computeSubscriptionDaysFromProduct(detail) {
    const quantity = Math.max(1, Math.floor(Number(detail.quantity) || 1));
    let baseDays = 31;
    let matchedCode;
    const code = (detail.optionManageCode ?? "").toString().trim().toUpperCase();
    const optionLabel = typeof detail.productOption === "string"
        ? detail.productOption
        : (detail.productOption?.optionValue ?? detail.productOption?.optionName ?? "").toString().trim();
    const combined = `${code} ${optionLabel}`;
    if (/\b01M\b|1개월권|1개월/.test(combined)) {
        baseDays = 31;
        matchedCode = "01M/1개월권";
    }
    else if (/\b06M\b|6개월권|6개월/.test(combined)) {
        baseDays = 183;
        matchedCode = "06M/6개월권";
    }
    else if (/\b12M\b|1년권|12개월/.test(combined)) {
        baseDays = 365;
        matchedCode = "12M/1년권";
    }
    const totalDays = baseDays * quantity;
    return { totalDays, matchedCode };
}
/** 주문 옵션/연락처에서 전화번호 또는 사용자 식별자 추출 (1순위: 옵션, 2순위: 주문자 연락처) — last-changed-statuses용 */
function extractContactFromOrder(order) {
    let optionPhoneOrId = null;
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
    let ordererTel = null;
    const orderer = order.orderer;
    if (orderer) {
        ordererTel =
            (orderer.tel || orderer.contact || orderer.phone || "")
                .toString()
                .trim() || null;
    }
    return { optionPhoneOrId, ordererTel };
}
/** 발송 처리 (배송 없음: NOTHING - 디지털 상품/구독 정산 확정용) */
async function dispatchProductOrders(accessToken, productOrderIds) {
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
    const data = (await res.json());
    const successIds = Array.isArray(data.successProductOrderIds) ? data.successProductOrderIds : [];
    const failInfos = (Array.isArray(data.failProductOrderInfos) ? data.failProductOrderInfos : []).map((f) => ({ productOrderId: String(f.productOrderId || ""), message: f.message }));
    return { successIds, failInfos };
}
