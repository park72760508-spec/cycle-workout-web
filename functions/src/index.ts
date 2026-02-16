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

/** 네이버 API 정책상 lastChangedType은 한 번에 하나만 조회 가능. PAYED는 별도 처리, 취소/반품은 CANCELED·RETURNED 각각 조회 */
const CLAIM_LAST_CHANGED_TYPES: LastChangedType[] = ["CANCELED", "RETURNED"];
import {
  findUserByContactWithPriority,
  normalizeToContactFormat,
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
    ordererTel: string | null;
    shippingMemo?: string | null;
    triedNumbers?: string[];
    reason: string;
  }> = [];
  const toDispatch: string[] = [];

  for (const order of orders) {
    const productOrderId = (order.productOrderId || "").toString();
    if (!productOrderId) continue;

    const alreadyProcessed = await isOrderProcessed(db, productOrderId);
    if (alreadyProcessed) continue;

    const detail = detailMap[productOrderId];
    let shippingAddressTel1: string | null = null;
    let ordererTel: string | null = null;
    let shippingMemo: string | null = null;
    let ordererName: string | null = null;
    if (detail) {
      const extracted = extractContactFromDetail(detail);
      shippingAddressTel1 = extracted.shippingAddressTel1;
      ordererTel = extracted.ordererTel;
      shippingMemo = extracted.shippingMemo;
      ordererName = extracted.ordererName;
    }
    if (!ordererTel && !shippingAddressTel1 && !shippingMemo) {
      const fromOrder = extractContactFromOrder(order);
      ordererTel = fromOrder.ordererTel;
    }

    const user = await findUserByContactWithPriority(
      db,
      shippingAddressTel1,
      ordererTel,
      shippingMemo
    );

    if (!user) {
      const tried1 = shippingAddressTel1 ? normalizeToContactFormat(shippingAddressTel1) : "-";
      const tried2 = ordererTel ? normalizeToContactFormat(ordererTel) : "-";
      const tried3 = shippingMemo ? normalizeToContactFormat(shippingMemo) : "-";
      const triedNumbersLabel = `시도 번호: [1순위: ${tried1}, 2순위: ${tried2}, 3순위: ${tried3}]`;
      console.warn("[naverSubscription] 매칭 실패:", triedNumbersLabel, "productOrderId=", productOrderId);
      matchingFailures.push({
        productOrderId,
        orderId: (order.orderId || "").toString(),
        ordererName,
        ordererTel,
        shippingMemo,
        triedNumbers: [tried1, tried2, tried3],
        reason: "1~3순위(수령인·주문자·배송메모) 연락처로 매칭되는 사용자 없음. " + triedNumbersLabel,
      });
      continue;
    }

    /* 상품별 기간(optionManageCode/productOption) × 수량(quantity). 없으면 기본 31일·수량 1 */
    const { totalDays } = detail
      ? computeSubscriptionDaysFromProduct(detail)
      : { totalDays: DEFAULT_SUBSCRIPTION_DAYS };

    try {
      const { newEndDate } = await applySubscription(db, user.userId, productOrderId, totalDays);

      const orderId = (order.orderId || "").toString();
      const productName =
        (detail?.productName ?? "").toString().trim() || "STELVIO AI";
      const productOptionStr =
        (detail?.optionManageCode ?? "").toString().trim() ||
        (typeof detail?.productOption === "string"
          ? detail.productOption.trim()
          : (detail?.productOption?.optionValue ?? detail?.productOption?.optionName ?? "").toString().trim()) ||
        "";
      const quantity = Math.max(1, Math.floor(Number(detail?.quantity) || 1));
      const paymentDate = (detail?.paymentDate ?? order.paymentDate ?? new Date().toISOString()).toString().trim();

      await saveOrderLog(db, user.userId, productOrderId, {
        orderId,
        productOrderId,
        productName,
        productOption: productOptionStr,
        quantity,
        paymentDate,
        status: "PAYED",
      });

      console.log(
        "[naverSubscription] 매칭 성공(" + user.priority + "순위): 유저",
        user.userId,
        "- expiry_date",
        newEndDate,
        "로 갱신 완료"
      );
      toDispatch.push(productOrderId);
    } catch (e) {
      matchingFailures.push({
        productOrderId,
        orderId: (order.orderId || "").toString(),
        ordererName,
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

/** 취소 시 구독 회수 대상 claimStatus: 요청/처리중/완료 모두 포함(어뷰징 방지) */
const CANCEL_CLAIM_STATUSES = new Set(["CANCEL_REQUEST", "CANCELING", "CANCEL_DONE"]);

/** 반품 시 구독 회수 대상 claimStatus: 요청/완료 포함 */
const RETURN_CLAIM_STATUSES = new Set(["RETURN_REQUEST", "RETURN_DONE"]);

/** lastChangedType + claimStatus로 구독 회수 실행 여부 판단 */
function shouldRevokeByClaimStatus(claimStatus: string | undefined, lastChangedType: LastChangedType): boolean {
  if (!claimStatus) return false;
  const s = claimStatus.toUpperCase().replace(/\s/g, "");
  if (lastChangedType === "CANCELED") return CANCEL_CLAIM_STATUSES.has(s);
  if (lastChangedType === "RETURNED") return RETURN_CLAIM_STATUSES.has(s);
  return false;
}

/** lastChangedType → 구매 로그 status */
function claimTypeToOrderStatus(lastChangedType: LastChangedType): "CANCELLED" | "RETURNED" {
  return lastChangedType === "RETURNED" ? "RETURNED" : "CANCELLED";
}

/** CANCELED / RETURNED 주문 처리: 주문 로그 status 선체크(중복 차감 방지) → claimStatus 확인 → 구독 회수 → 로그 업데이트 */
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

  if (orders.length === 0) return;

  const productOrderIds = orders.map((o) => (o.productOrderId || "").toString()).filter(Boolean);
  let detailMap: Record<string, ProductOrderDetailItem> = {};
  try {
    const details = await getProductOrderDetails(accessToken, productOrderIds);
    for (const d of details) {
      const id = (d.productOrderId || "").toString();
      if (id) detailMap[id] = d;
    }
  } catch (e) {
    console.warn("[naverSubscription] 클레임 상세 조회 실패:", (e as Error).message);
  }

  const claimDate = new Date().toISOString();

  for (const order of orders) {
    const productOrderId = (order.productOrderId || "").toString();
    if (!productOrderId) continue;

    try {
      const info = await getProcessedOrderInfo(db, productOrderId);
      if (!info) continue;

      // 방어: 이미 CANCELLED/RETURNED 처리된 주문은 중복 차감하지 않음
      const orderLog = await getOrderLog(db, info.userId, productOrderId);
      if (orderLog && (orderLog.status === "CANCELLED" || orderLog.status === "RETURNED")) {
        continue;
      }

      const detail = detailMap[productOrderId];
      const claimStatus = detail?.claimStatus ?? (order as ProductOrderDetailItem).claimStatus;
      if (!shouldRevokeByClaimStatus(claimStatus, type)) {
        continue;
      }

      const { revoked, userId } = await revokeSubscriptionByOrder(db, productOrderId);
      if (revoked && userId) {
        const logStatus = claimTypeToOrderStatus(type);
        await updateOrderLogClaim(db, userId, productOrderId, logStatus, claimDate, `${type} 처리`);
        console.log(
          `[naverSubscription] 클레임 처리: 유저 ${userId}, 상태 ${claimStatus ?? "-"}, expiry_date 정정 완료`
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
  console.log("[naverSubscription] 네이버 토큰 발급 완료, PAYED·CANCELED·RETURNED 처리 시작");

  await processPayedOrders(accessToken);
  for (const claimType of CLAIM_LAST_CHANGED_TYPES) {
    await processRevokedOrders(accessToken, claimType);
  }
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
