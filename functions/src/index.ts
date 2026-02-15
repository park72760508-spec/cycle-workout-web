/**
 * STELVIO AI - 네이버 구독 자동화 메인 엔트리
 * 30분 단위 스케줄러, VPC Connector(고정 IP 34.64.250.77) 적용
 */
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import {
  getAccessToken,
  getLastChangedOrders,
  getProductOrderDetails,
  dispatchProductOrders,
  extractContactFromOrder,
  extractContactFromDetail,
  computeSubscriptionDaysFromProduct,
  type LastChangedType,
  type ProductOrderDetailItem,
} from "./naverApi";
import {
  findUserByContact,
  isOrderProcessed,
  getProcessedOrderInfo,
  applySubscription,
  revokeSubscriptionByOrder,
  saveOrderLog,
  getOrderLog,
  updateOrderLogClaim,
  DEFAULT_SUBSCRIPTION_DAYS,
} from "./subscriptionService";
import { sendFailureEmail } from "./emailService";

const NAVER_CLIENT_ID = "6DPEyhnioC5AQfO2hsuUeq";

// Client Secret: process.env.NAVER_CLIENT_SECRET 또는 Firebase Secret Manager
const navSecret = defineSecret("NAVER_CLIENT_SECRET");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** 네이버 API 요구: KST(UTC+09:00) ISO 8601 + 밀리초(.SSS). 타임존 +09:00 명시 */
function toKstIso8601(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const d = kst.getUTCDate();
  const h = kst.getUTCHours();
  const min = kst.getUTCMinutes();
  const sec = kst.getUTCSeconds();
  const ms = kst.getUTCMilliseconds();
  return `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:${pad(sec)}.${ms.toString().padStart(3, "0")}+09:00`;
}

/** 조회 구간: 네이버 API 제한(104140) 준수 — 정확히 24시간. From = Now-24h, To = Now (KST ISO8601, +09:00) */
function getLastChangedRange(): { lastChangedFrom: string; lastChangedTo: string } {
  const now = Date.now();
  const from = new Date(now - 24 * 60 * 60 * 1000);
  const to = new Date(now);
  return {
    lastChangedFrom: toKstIso8601(from),
    lastChangedTo: toKstIso8601(to),
  };
}

/** 요청 파라미터 및 구간 검증 로그 (From~To 간격 24시간 이내 확인용) */
function logLastChangedRange(range: { lastChangedFrom: string; lastChangedTo: string }): void {
  const fromMs = new Date(range.lastChangedFrom).getTime();
  const toMs = new Date(range.lastChangedTo).getTime();
  const intervalHours = (toMs - fromMs) / (60 * 60 * 1000);
  const within24 = intervalHours > 0 && intervalHours <= 24;
  console.log(
    "[naverSubscription] 조회 구간 요청 파라미터:",
    { lastChangedFrom: range.lastChangedFrom, lastChangedTo: range.lastChangedTo },
    "| 간격:",
    intervalHours.toFixed(2),
    "시간 | 24시간 이내:",
    within24 ? "OK" : "초과(API 104140 위험)"
  );
}

/** PAYED 주문 처리: 매칭 → 중복 체크(upsert) → 구독 적용 → 네이버 발송 처리 */
async function processPayedOrders(accessToken: string): Promise<void> {
  const range = getLastChangedRange();
  logLastChangedRange(range);
  const result = await getLastChangedOrders(accessToken, "PAYED", {
    lastChangedFrom: range.lastChangedFrom,
    lastChangedTo: range.lastChangedTo,
    limitCount: 100,
  });
  const { orders, count } = result;
  const lastChangeStatusesLength = orders.length;
  if (lastChangeStatusesLength === 0) {
    console.warn(
      "[naverSubscription] PAYED 조회 0건 (lastChangeStatuses.length=0). 구간:",
      range.lastChangedFrom,
      "~",
      range.lastChangedTo,
      "— naverApi 로그에서 전체 Response Body 확인"
    );
  } else {
    console.log(
      "[naverSubscription] PAYED 조회",
      lastChangeStatusesLength,
      "건 (lastChangeStatuses.length=",
      lastChangeStatusesLength,
      ", response.data.count=",
      count ?? "-",
      ")"
    );
  }

  const productOrderIds = orders
    .map((o) => (o.productOrderId || "").toString())
    .filter(Boolean);
  let detailMap: Record<string, ProductOrderDetailItem> = {};
  if (productOrderIds.length > 0) {
    try {
      const details = await getProductOrderDetails(accessToken, productOrderIds);
      for (const d of details) {
        const id = (d.productOrderId || "").toString();
        if (id) detailMap[id] = d;
      }
    } catch (e) {
      console.warn("[naverSubscription] 주문 상세 조회 실패, last-changed 정보만으로 매칭 시도:", (e as Error).message);
    }
  }

  const matchingFailures: Array<{
    productOrderId: string;
    orderId?: string;
    ordererName?: string | null;
    optionPhoneOrId: string | null;
    ordererTel: string | null;
    shippingMemo?: string | null;
    reason: string;
  }> = [];
  const toDispatch: string[] = [];

  for (const order of orders) {
    const productOrderId = (order.productOrderId || "").toString();
    if (!productOrderId) continue;

    const alreadyProcessed = await isOrderProcessed(db, productOrderId);
    if (alreadyProcessed) continue;

    const detail = detailMap[productOrderId];
    let optionPhoneOrId: string | null = null;
    let ordererTel: string | null = null;
    let ordererNo: string | null = null;
    let memoOrOptionId: string | null = null;
    let ordererName: string | null = null;
    let shippingMemo: string | null = null;
    if (detail) {
      const extracted = extractContactFromDetail(detail);
      ordererTel = extracted.ordererTel;
      ordererName = extracted.ordererName;
      ordererNo = extracted.ordererNo;
      shippingMemo = extracted.shippingMemo;
      optionPhoneOrId = extracted.optionPhoneOrId;
      memoOrOptionId = extracted.memoOrOptionId;
    }
    if (ordererTel === null && optionPhoneOrId === null) {
      const fromOrder = extractContactFromOrder(order);
      optionPhoneOrId = fromOrder.optionPhoneOrId;
      ordererTel = fromOrder.ordererTel;
    }
    /* 1) ordererTel로 먼저 검색, 2) 없으면 shippingMemo 연락처로 검색 (하이픈 제거·숫자만 비교는 findUserByContact 내부) */
    let user = await findUserByContact(
      db,
      optionPhoneOrId,
      ordererTel,
      memoOrOptionId ?? undefined,
      ordererNo ?? undefined,
      null
    );
    if (!user && shippingMemo) {
      user = await findUserByContact(db, null, null, null, null, shippingMemo);
    }

    if (!user) {
      matchingFailures.push({
        productOrderId,
        orderId: (order.orderId || "").toString(),
        ordererName,
        optionPhoneOrId,
        ordererTel,
        shippingMemo,
        reason: "전화번호(ordererTel)/배송메모(shippingMemo)·옵션으로 매칭되는 사용자가 없음",
      });
      continue;
    }

    /* 상품별 기간(optionManageCode/productOption) × 수량(quantity). 없으면 기본 31일·수량 1 */
    const { totalDays, matchedCode } = detail
      ? computeSubscriptionDaysFromProduct(detail)
      : { totalDays: DEFAULT_SUBSCRIPTION_DAYS, matchedCode: undefined };
    const periodLabel = matchedCode ?? `${totalDays}일`;

    try {
      await applySubscription(db, user.userId, productOrderId, totalDays);

      const orderId = (order.orderId || "").toString();
      const productName =
        (detail?.productName ?? "").toString().trim() || "STELVIO AI";
      const productOptionStr =
        typeof detail?.productOption === "string"
          ? detail.productOption.trim()
          : (detail?.productOption?.optionValue ?? detail?.productOption?.optionName ?? "").toString().trim() || "";
      const quantity = Math.max(1, Math.floor(Number(detail?.quantity) || 1));
      const totalPaymentAmount = Number(detail?.totalPaymentAmount) || 0;
      const paymentDate = (detail?.paymentDate ?? order.paymentDate ?? new Date().toISOString()).toString().trim();
      const processedAt = new Date().toISOString();

      await saveOrderLog(db, user.userId, productOrderId, {
        orderId,
        productOrderId,
        productName,
        productOption: productOptionStr,
        quantity,
        totalPaymentAmount,
        paymentDate,
        processedAt,
        status: "COMPLETED",
      });

      console.log(
        "[naverSubscription] 성공: 유저",
        user.userId,
        "매칭 완료, 구독",
        periodLabel,
        "연장 및 구매로그 저장 성공"
      );
      toDispatch.push(productOrderId);
    } catch (e) {
      matchingFailures.push({
        productOrderId,
        orderId: (order.orderId || "").toString(),
        ordererName,
        optionPhoneOrId,
        ordererTel,
        shippingMemo,
        reason: (e as Error).message,
      });
    }
  }

  if (matchingFailures.length > 0) {
    await sendFailureEmail(matchingFailures);
  }

  if (toDispatch.length > 0) {
    const { successIds, failInfos } = await dispatchProductOrders(
      accessToken,
      toDispatch
    );
    if (failInfos.length > 0) {
      console.warn("[naverSubscription] dispatch 일부 실패:", failInfos);
    }
    console.log(
      "[naverSubscription] PAYED 처리 완료: 구독 적용",
      toDispatch.length,
      "발송 성공",
      successIds.length
    );
  }
}

/** CLAIM_COMPLETED(취소/반품 완료) 주문 처리: 구독 회수 + 구매 로그 status 업데이트 (멱등: 이미 CANCELLED/REFUNDED면 스킵) */
async function processRevokedOrders(
  accessToken: string,
  type: LastChangedType
): Promise<void> {
  const range = getLastChangedRange();
  logLastChangedRange(range);
  const { orders } = await getLastChangedOrders(accessToken, type, {
    lastChangedFrom: range.lastChangedFrom,
    lastChangedTo: range.lastChangedTo,
    limitCount: 100,
  });

  const claimDate = new Date().toISOString();
  const claimStatus: "CANCELLED" | "REFUNDED" = type === "CLAIM_COMPLETED" ? "CANCELLED" : "REFUNDED";

  for (const order of orders) {
    const productOrderId = (order.productOrderId || "").toString();
    if (!productOrderId) continue;

    try {
      const info = await getProcessedOrderInfo(db, productOrderId);
      if (!info) continue;

      const orderLog = await getOrderLog(db, info.userId, productOrderId);
      if (orderLog && (orderLog.status === "CANCELLED" || orderLog.status === "REFUNDED")) {
        continue;
      }

      const { revoked, userId } = await revokeSubscriptionByOrder(
        db,
        productOrderId
      );
      if (revoked && userId) {
        await updateOrderLogClaim(
          db,
          userId,
          productOrderId,
          claimStatus,
          claimDate,
          `${type} 처리`
        );
        console.log(
          "[naverSubscription] 구독 회수 및 구매로그 업데이트:",
          type,
          productOrderId,
          "userId:",
          userId,
          "status:",
          claimStatus
        );
      }
    } catch (e) {
      console.error("[naverSubscription] revoke 실패:", productOrderId, e);
    }
  }
}

/** 1회 동기화 실행 */
export async function runNaverSubscriptionSync(
  clientSecret: string
): Promise<void> {
  const accessToken = await getAccessToken(NAVER_CLIENT_ID, clientSecret);
  console.log("[naverSubscription] 네이버 토큰 발급 완료, PAYED·CLAIM_COMPLETED 처리 시작");

  await processPayedOrders(accessToken);
  await processRevokedOrders(accessToken, "CLAIM_COMPLETED");
}

/**
 * 30분마다 실행되는 스케줄러.
 * - Region: asia-northeast3 (서울)
 * - VPC Connector: stelvio-connector → 고정 IP(34.64.250.77)로 네이버 API 호출
 * - Client Secret: process.env.NAVER_CLIENT_SECRET 또는 Firebase Secret
 */
export const naverSubscriptionSyncSchedule = onSchedule(
  {
    schedule: "every 30 minutes",
    timeZone: "Asia/Seoul",
    timeoutSeconds: 300,
    region: "asia-northeast3",
    vpcConnector: "stelvio-connector",
    vpcConnectorEgressSettings: "ALL_TRAFFIC",
    secrets: [navSecret],
  },
  async () => {
    const runId = Date.now();
    console.log("[naverSubscription] 스케줄 실행 시작", { runId, region: "asia-northeast3" });

    let clientSecret: string;
    try {
      clientSecret = navSecret.value() || (process.env.NAVER_CLIENT_SECRET ?? "");
    } catch (e) {
      console.error("[naverSubscription] Secret 읽기 실패:", (e as Error).message, { runId });
      throw e;
    }

    if (!clientSecret.trim()) {
      console.error(
        "[naverSubscription] NAVER_CLIENT_SECRET이 비어 있습니다. Firebase Secret(NAVER_CLIENT_SECRET) 또는 .env 확인 필요.",
        { runId }
      );
      return;
    }

    try {
      await runNaverSubscriptionSync(clientSecret.trim());
      console.log("[naverSubscription] 스케줄 실행 완료", { runId });
    } catch (err) {
      const errMsg = (err as Error).message;
      const errStack = (err as Error).stack;
      console.error("[naverSubscription] 동기화 실패:", errMsg, { runId });
      if (errStack) console.error("[naverSubscription] stack:", errStack);
      throw err;
    }
  }
);

/** 네이버 구독 동기화 수동 테스트용 (스케줄 동작 확인) */
const NAVER_SYNC_TEST_SECRET = process.env.NAVER_SYNC_TEST_SECRET || "stelvio-naver-sync-test";

export const naverSubscriptionSyncTest = onRequest(
  {
    region: "asia-northeast3",
    vpcConnector: "stelvio-connector",
    vpcConnectorEgressSettings: "ALL_TRAFFIC",
    secrets: [navSecret],
    cors: false,
  },
  async (req, res) => {
    const auth = req.headers["x-naver-sync-secret"] || req.query.secret;
    if (auth !== NAVER_SYNC_TEST_SECRET) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const clientSecret = navSecret.value() || (process.env.NAVER_CLIENT_SECRET ?? "");
    if (!clientSecret.trim()) {
      res.status(500).json({
        success: false,
        error: "NAVER_CLIENT_SECRET not set",
      });
      return;
    }

    try {
      await runNaverSubscriptionSync(clientSecret.trim());
      res.status(200).json({
        success: true,
        message: "네이버 구독 동기화 1회 실행 완료. Firebase Console → Functions → 로그에서 상세 확인.",
      });
    } catch (err) {
      console.error("[naverSubscriptionSyncTest]", err);
      res.status(500).json({
        success: false,
        error: (err as Error).message,
      });
    }
  }
);
