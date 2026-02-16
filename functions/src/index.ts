/**
 * STELVIO AI - 네이버 구독 자동화 메인 엔트리
 * 30분 단위 스케줄러, VPC Connector(고정 IP 34.64.250.77) 적용
 */
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString, defineInt } from "firebase-functions/params";
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

/** 네이버 공식 명세: CLAIM_REQUESTED(요청 시점), CLAIM_COMPLETED(완료 시점) 루프 조회. PAYED는 별도 처리 */
const CLAIM_LAST_CHANGED_TYPES: LastChangedType[] = ["CLAIM_REQUESTED", "CLAIM_COMPLETED"];
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
import { sendFailureEmail, sendRevokeFailureReport, sendSmtpTestEmail } from "./emailService";

const NAVER_CLIENT_ID = "6DPEyhnioC5AQfO2hsuUeq";

// Client Secret: Firebase Secret Manager
const navSecret = defineSecret("NAVER_CLIENT_SECRET");

// SMTP: 배포 시 .env에서 로드. Secret은 firebase functions:secrets:set SMTP_PASS 로 설정
const smtpUser = defineString("SMTP_USER", { default: "" });
const smtpHost = defineString("SMTP_HOST", { default: "smtp.naver.com" });
const smtpPort = defineInt("SMTP_PORT", { default: 465 });
const adminEmail = defineString("ADMIN_EMAIL", { default: "stelvio.ai.kr@gmail.com" });
const smtpPassSecret = defineSecret("SMTP_PASS");

/** SMTP 환경 변수를 process.env에 주입 (emailService가 읽을 수 있도록). 호출 시점에 실행 */
function injectSmtpEnv(): void {
  try {
    process.env.SMTP_USER = smtpUser.value() || process.env.SMTP_USER;
    process.env.SMTP_PASS = smtpPassSecret.value() || process.env.SMTP_PASS;
    process.env.SMTP_HOST = smtpHost.value() || process.env.SMTP_HOST;
    process.env.SMTP_PORT = String(smtpPort.value() || process.env.SMTP_PORT || "465");
    process.env.ADMIN_EMAIL = adminEmail.value() || process.env.ADMIN_EMAIL;
  } catch {
    // Secret 미설정 시 무시 (emailService에서 SMTP 미설정으로 처리)
  }
}

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
  console.log(
    "[naverSubscription] lastChangedType=PAYED 조회 결과:",
    lastChangeStatusesLength,
    "건",
    count != null ? `(response.data.count=${count})` : ""
  );
  if (lastChangeStatusesLength === 0) {
    console.warn(
      "[naverSubscription] PAYED 0건. 구간:",
      range.lastChangedFrom,
      "~",
      range.lastChangedTo,
      "— naverApi 로그에서 전체 Response Body 확인"
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
    for (const f of matchingFailures) {
      const tried = (f.triedNumbers ?? []).join(", ");
      console.warn(
        "[naverSubscription] 매칭 실패 에러 리포트: productOrderId=",
        f.productOrderId,
        "| 1~3순위 연락처 변환값:",
        tried || "-",
        "| 사유:",
        f.reason
      );
    }
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

/** 상세 응답에서 구독 회수 대상: claimType CANCEL/RETURN, claimStatus 요청/완료 (네이버 공식 명세) */
const CLAIM_STATUSES_FOR_REVOKE = new Set(["CANCEL_REQUEST", "CANCEL_DONE", "RETURN_REQUEST", "RETURN_DONE"]);

/** claimType이 취소/반품이고 claimStatus가 요청 또는 완료일 때 구독 회수 실행 */
function shouldRevokeByClaimDetail(claimType: string | undefined, claimStatus: string | undefined): boolean {
  if (!claimType || !claimStatus) return false;
  const t = claimType.toUpperCase().replace(/\s/g, "");
  const s = claimStatus.toUpperCase().replace(/\s/g, "");
  if (t !== "CANCEL" && t !== "RETURN") return false;
  return CLAIM_STATUSES_FOR_REVOKE.has(s);
}

/** claimType → 구매 로그 status (YYYY-MM-DD 저장용과 별개로 CANCELLED/RETURNED) */
function claimTypeToOrderStatus(claimType: string | undefined): "CANCELLED" | "RETURNED" {
  return (claimType ?? "").toUpperCase() === "RETURN" ? "RETURNED" : "CANCELLED";
}

/** CLAIM_REQUESTED / CLAIM_COMPLETED 주문 처리: 멱등 체크 → claimType/claimStatus 판별 → 구독 회수 → expiry_date 정정(YYYY-MM-DD) 및 구매 로그 업데이트 */
async function processRevokedOrders(
  accessToken: string,
  type: LastChangedType
): Promise<void> {
  const range = getLastChangedRange();
  logLastChangedRange(range);
  const { orders, count } = await getLastChangedOrders(accessToken, type, {
    lastChangedFrom: range.lastChangedFrom,
    lastChangedTo: range.lastChangedTo,
    limitCount: 100,
  });

  console.log(
    "[naverSubscription] lastChangedType=" + type + " 조회 결과:",
    orders.length,
    "건",
    count != null ? `(response.data.count=${count})` : ""
  );
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

      // 멱등: 이미 CANCELLED 처리된 주문은 중복 차감하지 않음 (RETURNED 포함)
      const orderLog = await getOrderLog(db, info.userId, productOrderId);
      if (orderLog && (orderLog.status === "CANCELLED" || orderLog.status === "RETURNED")) {
        continue;
      }

      const detail = detailMap[productOrderId];
      const claimType = detail?.claimType ?? (order as ProductOrderDetailItem).claimType;
      const claimStatus = detail?.claimStatus ?? (order as ProductOrderDetailItem).claimStatus;
      if (!shouldRevokeByClaimDetail(claimType, claimStatus)) {
        continue;
      }

      const { revoked, userId } = await revokeSubscriptionByOrder(db, productOrderId);
      if (revoked && userId) {
        const logStatus = claimTypeToOrderStatus(claimType);
        await updateOrderLogClaim(db, userId, productOrderId, logStatus, claimDate, `${type} 처리`);
        console.log(
          `[naverSubscription] 클레임 처리: 유저 ${userId}, 상태 ${claimStatus ?? "-"}, expiry_date 정정 완료`
        );
      }
    } catch (e) {
      console.error("[naverSubscription] revoke 실패:", productOrderId, e);
      await sendRevokeFailureReport(productOrderId, (e as Error).message);
    }
  }
}

/** 1회 동기화 실행 */
export async function runNaverSubscriptionSync(
  clientSecret: string
): Promise<void> {
  const accessToken = await getAccessToken(NAVER_CLIENT_ID, clientSecret);
  console.log("[naverSubscription] 네이버 토큰 발급 완료, PAYED·CLAIM_REQUESTED·CLAIM_COMPLETED 처리 시작");

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
    secrets: [navSecret, smtpPassSecret],
  },
  async () => {
    injectSmtpEnv();
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
    secrets: [navSecret, smtpPassSecret],
    cors: false,
  },
  async (req, res) => {
    const auth = req.headers["x-naver-sync-secret"] || req.query.secret;
    if (auth !== NAVER_SYNC_TEST_SECRET) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    injectSmtpEnv();

    // SMTP 테스트: ?smtpTest=1 이면 테스트 메일만 발송 후 종료 (Jisung/관리자 Gmail로)
    const smtpTest = req.query.smtpTest === "1" || req.query.smtpTest === "true";
    if (smtpTest) {
      try {
        const sent = await sendSmtpTestEmail();
        res.status(200).json({
          success: true,
          message: sent
            ? "SMTP 설정 완료 테스트 메일을 ADMIN_EMAIL로 발송했습니다. 수신함을 확인하세요."
            : "SMTP 미설정으로 테스트 메일 미발송. SMTP_USER, SMTP_PASS, ADMIN_EMAIL을 설정하세요.",
          smtpTest: true,
          mailSent: sent,
        });
      } catch (err) {
        console.error("[naverSubscriptionSyncTest] SMTP 테스트 실패:", err);
        res.status(500).json({
          success: false,
          error: (err as Error).message,
          smtpTest: true,
        });
      }
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
