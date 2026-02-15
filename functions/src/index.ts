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

/** 조회 시간 구간 (ISO 8601). 24시간으로 넓혀 결제 후 1시간 지난 주문도 수집 (중복은 isOrderProcessed로 방지) */
const LAST_CHANGED_WINDOW_HOURS = 24;
function getLastChangedRange(): { lastChangedFrom: string; lastChangedTo: string } {
  const to = new Date();
  const from = new Date(to.getTime() - LAST_CHANGED_WINDOW_HOURS * 60 * 60 * 1000);
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
  console.log(
    "[naverSubscription] PAYED 조회",
    orders.length,
    "건 (범위: 최근",
    LAST_CHANGED_WINDOW_HOURS,
    "시간)"
  );

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

/** CLAIM_COMPLETED(취소/반품 완료) 주문 처리: 구독 회수 */
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
