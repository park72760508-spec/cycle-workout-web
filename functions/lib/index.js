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
exports.naverSubscriptionSyncSchedule = void 0;
exports.runNaverSubscriptionSync = runNaverSubscriptionSync;
/**
 * STELVIO AI - 네이버 구독 자동화 메인 엔트리
 * 30분 단위 스케줄러 및 오케스트레이션
 */
const admin = __importStar(require("firebase-admin"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
const naverApi_1 = require("./naverApi");
const subscriptionService_1 = require("./subscriptionService");
const emailService_1 = require("./emailService");
const NAVER_CLIENT_ID = "6DPEyhnioC5AQfO2hsuUeq";
// Client Secret은 Firebase Secret Manager 또는 .env의 NAVER_CLIENT_SECRET 사용
const navSecret = (0, params_1.defineSecret)("NAVER_CLIENT_SECRET");
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
/** 지난 1시간 구간 (ISO 8601) - 중복 방지를 위해 넉넉히 */
function getLastChangedRange() {
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60 * 1000);
    return {
        lastChangedFrom: from.toISOString(),
        lastChangedTo: to.toISOString(),
    };
}
/** PAYED 주문 처리: 매칭 → 중복 체크 → 구독 적용 → 네이버 발송 처리 */
async function processPayedOrders(accessToken) {
    const range = getLastChangedRange();
    const { orders } = await (0, naverApi_1.getLastChangedOrders)(accessToken, "PAYED", {
        ...range,
        limitCount: 100,
    });
    const matchingFailures = [];
    const toDispatch = [];
    for (const order of orders) {
        const productOrderId = (order.productOrderId || "").toString();
        if (!productOrderId)
            continue;
        const alreadyProcessed = await (0, subscriptionService_1.isOrderProcessed)(db, productOrderId);
        if (alreadyProcessed)
            continue;
        const { optionPhoneOrId, ordererTel } = (0, naverApi_1.extractContactFromOrder)(order);
        const user = await (0, subscriptionService_1.findUserByContact)(db, optionPhoneOrId, ordererTel);
        if (!user) {
            matchingFailures.push({
                productOrderId,
                orderId: (order.orderId || "").toString(),
                optionPhoneOrId,
                ordererTel,
                reason: "전화번호/ID로 매칭되는 사용자가 없음",
            });
            continue;
        }
        try {
            await (0, subscriptionService_1.applySubscription)(db, user.userId, productOrderId, subscriptionService_1.DEFAULT_SUBSCRIPTION_DAYS);
            toDispatch.push(productOrderId);
        }
        catch (e) {
            matchingFailures.push({
                productOrderId,
                orderId: (order.orderId || "").toString(),
                optionPhoneOrId,
                ordererTel,
                reason: e.message,
            });
        }
    }
    if (matchingFailures.length > 0) {
        await (0, emailService_1.sendMatchingFailureReport)(matchingFailures);
    }
    if (toDispatch.length > 0) {
        const { successIds, failInfos } = await (0, naverApi_1.dispatchProductOrders)(accessToken, toDispatch);
        if (failInfos.length > 0) {
            console.warn("[naverSubscription] dispatch 일부 실패:", failInfos);
        }
        console.log("[naverSubscription] PAYED 처리 완료: 구독 적용", toDispatch.length, "발송 성공", successIds.length);
    }
}
/** CANCELLED / RETURNED 주문 처리: 구독 회수 */
async function processRevokedOrders(accessToken, type) {
    const range = getLastChangedRange();
    const { orders } = await (0, naverApi_1.getLastChangedOrders)(accessToken, type, {
        ...range,
        limitCount: 100,
    });
    for (const order of orders) {
        const productOrderId = (order.productOrderId || "").toString();
        if (!productOrderId)
            continue;
        try {
            const { revoked, userId } = await (0, subscriptionService_1.revokeSubscriptionByOrder)(db, productOrderId);
            if (revoked && userId) {
                console.log("[naverSubscription] 구독 회수:", type, productOrderId, "userId:", userId);
            }
        }
        catch (e) {
            console.error("[naverSubscription] revoke 실패:", productOrderId, e);
        }
    }
}
/** 1회 동기화 실행 */
async function runNaverSubscriptionSync(clientSecret) {
    const accessToken = await (0, naverApi_1.getAccessToken)(NAVER_CLIENT_ID, clientSecret);
    await processPayedOrders(accessToken);
    await processRevokedOrders(accessToken, "CANCELLED");
    await processRevokedOrders(accessToken, "RETURNED");
}
/**
 * 30분마다 실행되는 스케줄러.
 * NAVER_CLIENT_SECRET 은 Firebase Secret Manager 또는 환경변수에 설정.
 */
exports.naverSubscriptionSyncSchedule = (0, scheduler_1.onSchedule)({
    schedule: "every 30 minutes",
    timeZone: "Asia/Seoul",
    timeoutSeconds: 300,
    secrets: [navSecret],
}, async () => {
    const clientSecret = navSecret.value() ||
        process.env.NAVER_CLIENT_SECRET ||
        "";
    if (!clientSecret.trim()) {
        console.error("[naverSubscription] NAVER_CLIENT_SECRET이 설정되지 않았습니다. Firebase Secret(NAVER_CLIENT_SECRET) 또는 .env를 확인하세요.");
        return;
    }
    try {
        await runNaverSubscriptionSync(clientSecret.trim());
    }
    catch (err) {
        console.error("[naverSubscription] 동기화 실패:", err);
        throw err;
    }
});
