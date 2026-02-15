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
/** 최근 상태 변경된 주문 조회 (PAYED, CANCELLED, RETURNED 등) */
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
    const orders = Array.isArray(data.data) ? data.data : [];
    return { orders, moreSequence: data.moreSequence };
}
/** 주문 옵션/연락처에서 전화번호 또는 사용자 식별자 추출 (1순위: 옵션, 2순위: 주문자 연락처) */
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
