/**
 * STELVIO AI - 네이버 구독 자동화 메인 엔트리
 * 30분 단위 스케줄러, VPC Connector(고정 IP 34.64.250.77) 적용
 */
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import {
  getAccessToken,
  getLastChangedOrders,
  dispatchProductOrders,
  extractContactFromOrder,
  type LastChangedType,
} from "./naverApi";
import {
  findUserByContact,
  isOrderProcessed,
  applySubscription,
  revokeSubscriptionByOrder,
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

/** 지난 1시간 구간 (ISO 8601) - 중복 방지를 위해 넉넉히 */
function getLastChangedRange(): { lastChangedFrom: string; lastChangedTo: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 60 * 60 * 1000);
  return {
    lastChangedFrom: from.toISOString(),
    lastChangedTo: to.toISOString(),
  };
}

/** PAYED 주문 처리: 매칭 → 중복 체크 → 구독 적용 → 네이버 발송 처리 */
async function processPayedOrders(accessToken: string): Promise<void> {
  const range = getLastChangedRange();
  const { orders } = await getLastChangedOrders(accessToken, "PAYED", {
    ...range,
    limitCount: 100,
  });

  const matchingFailures: Array<{
    productOrderId: string;
    orderId?: string;
    optionPhoneOrId: string | null;
    ordererTel: string | null;
    reason: string;
  }> = [];
  const toDispatch: string[] = [];

  for (const order of orders) {
    const productOrderId = (order.productOrderId || "").toString();
    if (!productOrderId) continue;

    const alreadyProcessed = await isOrderProcessed(db, productOrderId);
    if (alreadyProcessed) continue;

    const { optionPhoneOrId, ordererTel } = extractContactFromOrder(order);
    const user = await findUserByContact(db, optionPhoneOrId, ordererTel);

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
      await applySubscription(
        db,
        user.userId,
        productOrderId,
        DEFAULT_SUBSCRIPTION_DAYS
      );
      toDispatch.push(productOrderId);
    } catch (e) {
      matchingFailures.push({
        productOrderId,
        orderId: (order.orderId || "").toString(),
        optionPhoneOrId,
        ordererTel,
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

/** CANCELLED / RETURNED 주문 처리: 구독 회수 */
async function processRevokedOrders(
  accessToken: string,
  type: LastChangedType
): Promise<void> {
  const range = getLastChangedRange();
  const { orders } = await getLastChangedOrders(accessToken, type, {
    ...range,
    limitCount: 100,
  });

  for (const order of orders) {
    const productOrderId = (order.productOrderId || "").toString();
    if (!productOrderId) continue;

    try {
      const { revoked, userId } = await revokeSubscriptionByOrder(
        db,
        productOrderId
      );
      if (revoked && userId) {
        console.log(
          "[naverSubscription] 구독 회수:",
          type,
          productOrderId,
          "userId:",
          userId
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

  await processPayedOrders(accessToken);
  await processRevokedOrders(accessToken, "CANCELLED");
  await processRevokedOrders(accessToken, "RETURNED");
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
    const clientSecret =
      navSecret.value() ||
      (process.env.NAVER_CLIENT_SECRET ?? "");

    if (!clientSecret.trim()) {
      console.error(
        "[naverSubscription] NAVER_CLIENT_SECRET이 설정되지 않았습니다. .env 또는 Firebase Secret(NAVER_CLIENT_SECRET)을 확인하세요."
      );
      return;
    }

    try {
      await runNaverSubscriptionSync(clientSecret.trim());
    } catch (err) {
      console.error("[naverSubscription] 동기화 실패:", err);
      throw err;
    }
  }
);
