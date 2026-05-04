/**
 * STELVIO AI - 네이버 구독 자동화 메인 엔트리
 * 30분 단위 스케줄러, Direct VPC Egress(고정 IP 34.64.250.77 / Cloud NAT) 적용
 * [마이그레이션] VPC Connector(stelvio-connector) → Direct VPC Egress
 *   - network: GCP VPC 네트워크 이름 (GCP Console > VPC networks 에서 확인)
 *   - vpcEgress: 'ALL_TRAFFIC' → Cloud NAT를 통해 고정 IP로 아웃바운드
 */
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
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
import { createVerifyMeetingAttendance, createScheduledRideAttendanceVerification } from "./verifyMeetingAttendance";
import { PointRewardService, type StelvioMileageAppendResult } from "./PointRewardService";
import {
  ALIGO_KAKAO_CLOUD_FUNCTIONS_VPC_EGRESS_OPTS,
  fetchAligoKakaoEgressPublicIpDiagnostics,
  warnIfDiagPublicIpMismatch,
} from "./aligoKakaoNatEgress";
import {
  ALIMTALK_TEMPLATE,
  loadAligoAlimtalkConfig,
  sendAlimtalkUnified,
} from "./aligoAlimtalkUnified";
import { scrubAligoCredential } from "./aligoCredentials";

const NAVER_CLIENT_ID = "6DPEyhnioC5AQfO2hsuUeq";

// Client Secret: Firebase Secret Manager
const navSecret = defineSecret("NAVER_CLIENT_SECRET");

// SMTP: 배포 시 .env에서 로드. Secret은 firebase functions:secrets:set SMTP_PASS 로 설정
const smtpUser = defineString("SMTP_USER", { default: "" });
const smtpHost = defineString("SMTP_HOST", { default: "smtp.naver.com" });
const smtpPort = defineInt("SMTP_PORT", { default: 465 });
const adminEmail = defineString("ADMIN_EMAIL", { default: "stelvio.ai.kr@gmail.com" });
const smtpPassSecret = defineSecret("SMTP_PASS");

// Strava Webhook: 웹훅 등록 시 hub.verify_token 검증용 (.env 또는 Firebase 파라미터)
const stravaWebhookVerifyToken = defineString("STRAVA_WEBHOOK_VERIFY_TOKEN", {
  default: "STELVIO_SECURE_TOKEN_2026",
});

// Strava Webhook: processStravaActivity에서 토큰 갱신 시 STRAVA_CLIENT_SECRET 필요
const stravaClientSecret = defineSecret("STRAVA_CLIENT_SECRET");
const aligoApiKeySecret = defineSecret("ALIGO_API_KEY");
const aligoUserIdSecret = defineSecret("ALIGO_USER_ID");
const aligoTokenSecret = defineSecret("ALIGO_TOKEN");
/** Firestore 트리거 → HTTPS 릴레이 헤더 검증 (VPC는 릴레이만 적용해 알리고 IP=-99 방지) */
const meetupAlimRelaySecret = defineSecret("MEETUP_ALIM_RELAY_SECRET");
/** 릴레이 함수 URL 미지정 시 asia-northeast3-{프로젝트}.cloudfunctions.net 패턴 */
const meetupAlimRelayUrlParam = defineString("MEETUP_ALIM_RELAY_URL", { default: "" });

/** Strava 웹훅(VPC 미적용) → 미션·구독 연장 알림만 NAT 고정 출구 HTTPS 릴레이 (실내 로그 트리거와 동일 egress) */
const missionAlimRelaySecret = defineSecret("MISSION_ALIM_RELAY_SECRET");
const missionAlimRelayUrlParam = defineString("MISSION_ALIM_RELAY_URL", { default: "" });

/** 선택: 진단 공인 IP가 이 값과 다르면 경고 로그 (예: 34.64.250.77) */
const aligoNatEgressExpectIpv4 = defineString("ALIGO_NAT_EGRESS_EXPECT_IPV4", { default: "" });

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

/** 알리고 인증 Secret을 process.env로 주입 (PointRewardService가 동일 패턴으로 읽음). BOM·따옴표·개행 제거 */
function injectAligoEnv(): void {
  try {
    const k = scrubAligoCredential(aligoApiKeySecret.value());
    const u = scrubAligoCredential(aligoUserIdSecret.value());
    const t = scrubAligoCredential(aligoTokenSecret.value());
    process.env.ALIGO_API_KEY = k || scrubAligoCredential(process.env.ALIGO_API_KEY);
    process.env.ALIGO_USER_ID = u || scrubAligoCredential(process.env.ALIGO_USER_ID);
    process.env.ALIGO_TOKEN = t || scrubAligoCredential(process.env.ALIGO_TOKEN);
  } catch {
    process.env.ALIGO_API_KEY = scrubAligoCredential(process.env.ALIGO_API_KEY);
    process.env.ALIGO_USER_ID = scrubAligoCredential(process.env.ALIGO_USER_ID);
    process.env.ALIGO_TOKEN = scrubAligoCredential(process.env.ALIGO_TOKEN);
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
 * - Direct VPC Egress → Cloud NAT → 고정 IP(34.64.250.77)로 네이버 API 호출
 * - Client Secret: process.env.NAVER_CLIENT_SECRET 또는 Firebase Secret
 *
 * [중요] network 값을 실제 VPC 네트워크 이름으로 교체하세요.
 *   확인 방법: GCP Console → VPC network → VPC networks → 네트워크 이름
 *   (예: "default" 또는 커스텀 VPC명 "stelvio-vpc" 등)
 */
export const naverSubscriptionSyncSchedule = onSchedule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  {
    schedule: "every 30 minutes",
    timeZone: "Asia/Seoul",
    timeoutSeconds: 300,
    region: "asia-northeast3",
    // [Direct VPC Egress] VPC Connector 대신 직접 VPC 연결 (Gen 2 전용, 비용 절감)
    network: "default", // ← 실제 VPC 네트워크 이름으로 교체 필요
    vpcEgress: "ALL_TRAFFIC", // 모든 아웃바운드를 VPC(Cloud NAT)로 라우팅 → 고정 IP 유지
    secrets: [navSecret, smtpPassSecret],
  } as any,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  {
    region: "asia-northeast3",
    // [Direct VPC Egress] VPC Connector 대신 직접 VPC 연결
    network: "default", // ← 실제 VPC 네트워크 이름으로 교체 필요
    vpcEgress: "ALL_TRAFFIC",
    secrets: [navSecret, smtpPassSecret],
    cors: false,
  } as any,
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

/** Strava Webhook: index.js의 processStravaActivity 호출 (순환 참조 방지를 위해 런타임 require) */
async function processStravaActivityAsync(
  db: admin.firestore.Firestore,
  ownerId: number,
  objectId: number
): Promise<void> {
  injectAligoEnv();
  const mainModule = require("../index.js");
  const legacyResult = await mainModule.processStravaActivity(db, ownerId, objectId, {
    skipPointUpdate: true,
  });
  const userId = String(legacyResult?.userId || "").trim();
  const userTss = Number(legacyResult?.userTss || 0);
  const activityId = String(legacyResult?.activityId || objectId || "").trim();

  if (!userId || !activityId || userTss <= 0) {
    return;
  }

  const logRef = db.collection("users").doc(userId).collection("logs").doc(activityId);
  const logSnap = await logRef.get();
  if (logSnap.exists && logSnap.data()?.point_reward_v2_applied === true) {
    return;
  }

  try {
    let relayUrl = missionAlimRelayUrlParam.value()?.trim();
    const pid = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
    if (!relayUrl && pid.length > 0) {
      relayUrl = `https://asia-northeast3-${pid}.cloudfunctions.net/missionSubscriptionAlimtalkHttpsRelay`.trim();
    }

    let relaySecret = "";
    try {
      relaySecret = scrubAligoCredential(missionAlimRelaySecret.value());
    } catch {
      relaySecret = "";
    }

    const missionRelayOpts =
      relayUrl && relaySecret
        ? ({ missionAlimVpcRelay: { url: relayUrl, secret: relaySecret } } as const)
        : undefined;

    if (!missionRelayOpts) {
      console.warn(
        "[Strava Webhook] MISSION_ALIM_RELAY_SECRET 미설정 또는 URL 없음 — 구독 연장 알림톡은 이 함수 기본 egress로 직접 알리고 호출됩니다(카카오 API 화이트리스트 IP가 NAT 전용이면 -99 가능)."
      );
    }

    const rewardService = new PointRewardService(db, missionRelayOpts);
    const rewardResult = await rewardService.processRidingReward(userId, userTss, true);

    await logRef.set(
      {
        point_reward_v2_applied: true,
        point_reward_v2_history_id: rewardResult.historyId,
        point_reward_v2_alimtalk_sent: rewardResult.alimtalkSent,
        point_reward_v2_alimtalk_skip: rewardResult.alimtalkSkip,
        point_reward_v2_alimtalk_error: rewardResult.alimtalkError,
        point_reward_v2_processed_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (rewardErr) {
    console.error("[Strava Webhook] 로그 저장은 완료됨. 포인트/알림톡 처리 실패:", rewardErr);
  }
}

/**
 * Strava Webhook 수신 엔드포인트 (GET: 등록 인증, POST: 이벤트 수신)
 * - 경로: /api/strava/webhook (Firebase Hosting rewrite 시) 또는 Cloud Functions URL
 * - Strava가 2초 이내 200 응답을 요구하므로, POST 시 즉시 200 반환 후 비동기 처리
 */
export const stravaWebhook = onRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  {
    region: "asia-northeast3",
    cors: false,
    /**
     * Strava OAuth·활동·Streams API는 공용 인터넷으로 나가야 안정적이다.
     * Direct VPC Egress(고정 NAT)만 쓰면 Strava 쪽 TLS/라우팅 실패로 토큰 갱신·로그 저장이 끊길 수 있어
     * 이 함수에는 network/vpcEgress를 넣지 않는다.
     *
     * 구독 연장 알림톡(UH_2120): Secret `MISSION_ALIM_RELAY_SECRET` 설정 시 `missionSubscriptionAlimtalkHttpsRelay`(VPC+NAT)로 위임 —
     * 실내 로그 트리거(onIndoorLogCreatedReward)와 동일 출구 정렬. 미설정 시 이 함수 기본 egress로 알리고 직접 호출(화이트리스트 불일치 시 -99 가능).
     */
    secrets: [
      stravaClientSecret,
      aligoApiKeySecret,
      aligoUserIdSecret,
      aligoTokenSecret,
      missionAlimRelaySecret,
    ],
  } as any,
  async (req, res) => {
    if (req.method === "GET") {
      // Strava 웹훅 등록 인증: hub.mode=subscribe, hub.verify_token 일치 시 hub.challenge 에코
      const hubMode = req.query["hub.mode"] as string | undefined;
      const hubVerifyToken = req.query["hub.verify_token"] as string | undefined;
      const hubChallenge = req.query["hub.challenge"] as string | undefined;

      const expectedToken = stravaWebhookVerifyToken.value() || process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "";

      if (
        hubMode === "subscribe" &&
        hubVerifyToken != null &&
        hubVerifyToken === expectedToken &&
        typeof hubChallenge === "string"
      ) {
        res.status(200).json({ "hub.challenge": hubChallenge });
      } else {
        res.status(403).send("Forbidden");
      }
      return;
    }

    if (req.method === "POST") {
      // Strava 이벤트 수신: 2초 이내 200 응답 필수 → 즉시 응답 후 비동기 처리
      res.status(200).send("EVENT_RECEIVED");

      const body = req.body;
      const aspectType = String(body?.aspect_type || "").toLowerCase();
      const objectType = String(body?.object_type || "").toLowerCase();
      const ownerId = body?.owner_id;
      const objectId = body?.object_id;

      /** 생성·갱신: 동일 활동 재조회·merge 저장 (공개 변경·제목 수정 등으로 update만 오는 경우 대비) — delete 비처리 */
      const shouldFetchActivity =
        objectType === "activity" &&
        ownerId != null &&
        objectId != null &&
        (aspectType === "create" || aspectType === "update");

      if (shouldFetchActivity) {
        // 비동기 처리: await 없이 백그라운드에서 실행 (2초 제한 회피)
        processStravaActivityAsync(db, ownerId, objectId).catch((err) => {
          console.error("[Strava Webhook] Strava 활동 처리 실패:", err);
        });
      } else {
        console.log("[Strava Webhook] POST (미처리):", { aspectType, objectType, ownerId, objectId });
      }
      return;
    }

    res.status(405).send("Method Not Allowed");
  }
);

/**
 * 인도어 세션 로그 생성 시 포인트 보상 처리.
 * - users/{userId}/logs/{logId} 생성 이벤트에서 source!=strava 이고 tss>0 인 경우만 적립
 * - point_reward_v2_applied 플래그로 중복 적립 방지
 */
export const onIndoorLogCreatedReward = onDocumentCreated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  {
    document: "users/{userId}/logs/{logId}",
    ...ALIGO_KAKAO_CLOUD_FUNCTIONS_VPC_EGRESS_OPTS,
    secrets: [aligoApiKeySecret, aligoUserIdSecret, aligoTokenSecret],
  } as any,
  async (event) => {
    injectAligoEnv();

    const snap = event.data;
    if (!snap?.exists) return;

    const logData = snap.data() as Record<string, unknown>;
    const userId = String(event.params.userId || "").trim();
    if (!userId) return;

    // Strava 로그는 stravaWebhook 경로에서 별도 처리
    const source = String(logData.source || "").toLowerCase();
    if (source === "strava") return;

    if (logData.point_reward_v2_applied === true) return;

    const tss = Number(logData.tss || 0);
    if (!Number.isFinite(tss) || tss <= 0) return;

    const rewardService = new PointRewardService(db);

    // 실내 source=stelvio(또는 subscription_*가 있는 source=indoor): `saveTrainingSession`이 먼저 users·포인트·만료를 반영함.
    // `processRidingReward`는 TSS를 한 번 더 더하며, point_history 쪽 source=indoor 기록이 잘못 잡힘.
    const hasClientMileageMeta =
      logData.subscription_extended_days != null || logData.subscription_expiry_date_before != null;
    if (source === "stelvio" || (source === "indoor" && hasClientMileageMeta)) {
      const logId = String((event.params as { logId?: string }).logId || snap.id || "").trim();
      let historyId: string;
      let appendResult: StelvioMileageAppendResult;
      try {
        // users는 이미 클라이언트가 반영함. point_history + 알림톡용 페이로드는 append에서 한 번에 산출.
        appendResult = await rewardService.appendPointHistoryForStelvioClientMileage(userId, logData, logId);
        historyId = appendResult.historyId;
      } catch (err) {
        console.error("[onIndoorLogCreatedReward] point_history 기록 실패:", err);
        throw err;
      }
      const notifyResult = await rewardService.sendStelvioIndoorAlimtalkFromPayload(appendResult.alimtalkPayload);
      await snap.ref.set(
        {
          point_reward_v2_applied: true,
          point_reward_v2_history_id: historyId,
          point_reward_v2_alimtalk_sent: notifyResult.alimtalkSent,
          point_reward_v2_alimtalk_skip: notifyResult.skipped || null,
          point_reward_v2_alimtalk_error: notifyResult.errorDetail || null,
          point_reward_v2_processed_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    const rewardResult = await rewardService.processRidingReward(userId, tss, false);

    await snap.ref.set(
      {
        point_reward_v2_applied: true,
        point_reward_v2_history_id: rewardResult.historyId,
        point_reward_v2_alimtalk_sent: rewardResult.alimtalkSent,
        point_reward_v2_alimtalk_skip: rewardResult.alimtalkSkip,
        point_reward_v2_alimtalk_error: rewardResult.alimtalkError,
        point_reward_v2_processed_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);

/**
 * 오픈 라이딩 rides 모임 초대 알림톡.
 * rides 전용 Firestore 트리거는 VPC egress가 users 로그 생성 트리거와 실제 적용이 달라 알리고 code=-99가 날 수 있어,
 * 트리거는 HTTPS 릴레이만 호출하고 알리고는 vpcEgress ALL_TRAFFIC 인 HTTPS 릴레이(onRequest)에서만 호출한다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const openRidingMeetupAlimtalkJs = require("../openRidingMeetupAlimtalk.js") as {
  sendMeetupInviteAlimtalksForNewRide: (
    firestore: admin.firestore.Firestore,
    rideId: string,
    rideData: Record<string, unknown>
  ) => Promise<{
    skipped: boolean;
    reason?: string;
    error?: string;
    attempts?: unknown[];
    sent?: number;
    total?: number;
  }>;
};

/**
 * 라이딩 미션·구독 연장(UH_2120) 알림톡 — Strava 웹훅 전용 HTTPS 릴레이.
 * `onIndoorLogCreatedReward`(실내)·모임 릴레이와 동일 Direct VPC egress로 알리고 kakaoapi 호출하여 NAT 고정 IP 정렬.
 */
export const missionSubscriptionAlimtalkHttpsRelay = onRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  {
    ...ALIGO_KAKAO_CLOUD_FUNCTIONS_VPC_EGRESS_OPTS,
    timeoutSeconds: 120,
    memory: "512MiB",
    cors: false,
    secrets: [missionAlimRelaySecret, aligoApiKeySecret, aligoUserIdSecret, aligoTokenSecret],
  } as any,
  async (req, res): Promise<void> => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }
    let expectedRelay: string;
    try {
      expectedRelay = scrubAligoCredential(missionAlimRelaySecret.value());
    } catch {
      res.status(500).json({ ok: false, error: "MISSION_ALIM_RELAY_SECRET 없음" });
      return;
    }
    const gotRelay = String(req.headers["x-mission-alim-relay-secret"] ?? "").trim();
    if (!expectedRelay || gotRelay !== expectedRelay) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }

    injectAligoEnv();

    let receiverPhone = "";
    let displayName = "";
    let subject = "";
    let message = "";
    try {
      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as {
              receiverPhone?: unknown;
              displayName?: unknown;
              subject?: unknown;
              message?: unknown;
            })
          : {};
      receiverPhone = String(body.receiverPhone ?? "").trim();
      displayName = String(body.displayName ?? "").trim();
      subject = String(body.subject ?? "").trim();
      message = String(body.message ?? "").trim();
    } catch {
      res.status(400).json({ ok: false, error: "INVALID_BODY" });
      return;
    }
    if (!receiverPhone || !subject || !message) {
      res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
      return;
    }

    let diagSeenPublicIp: string | undefined;
    try {
      const dip = await fetchAligoKakaoEgressPublicIpDiagnostics();
      diagSeenPublicIp = dip ?? undefined;
      warnIfDiagPublicIpMismatch(dip, aligoNatEgressExpectIpv4.value(), "missionSubscriptionAlimtalkHttpsRelay");
      console.log("[missionSubscriptionAlimtalkHttpsRelay] diagSeenPublicIp:", dip ?? "(조회실패)");
    } catch {
      /* ignore */
    }

    try {
      const cfg = await loadAligoAlimtalkConfig(db, ALIMTALK_TEMPLATE.MISSION_SUBSCRIPTION);
      await sendAlimtalkUnified(cfg, {
        receiverPhone,
        displayName,
        subject,
        message,
        templateKind: ALIMTALK_TEMPLATE.MISSION_SUBSCRIPTION,
        logTag: "[PointReward Aligo vpc-relay]",
      });
      res.status(200).json({ ok: true, ...(diagSeenPublicIp ? { diagSeenPublicIp } : {}) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[missionSubscriptionAlimtalkHttpsRelay]", msg);
      res.status(500).json({ ok: false, error: msg, ...(diagSeenPublicIp ? { diagSeenPublicIp } : {}) });
    }
  }
);

/**
 * 모임 알림톡 전용 HTTPS 릴레이 (VPC + ALL_TRAFFIC egress).
 * 알리고 code=-99 시: rides....diagSeenPublicIp 에 찍힌 공인 IP를 카카오톡 API 허용 목록에 넣을 것.
 * (미션용 Firestore 트리거와 NAT 풀·우선순위가 달라 공인 IP가 별도일 수 있음 — 예: 34.64.250.77 만 등록 시 릴레이는 34.96.x 대역으로 나갈 수 있음)
 */
export const meetupInviteAlimtalkHttpsRelay = onRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  {
    ...ALIGO_KAKAO_CLOUD_FUNCTIONS_VPC_EGRESS_OPTS,
    timeoutSeconds: 300,
    memory: "512MiB",
    cors: false,
    secrets: [meetupAlimRelaySecret, aligoApiKeySecret, aligoUserIdSecret, aligoTokenSecret],
  } as any,
  async (req, res): Promise<void> => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }
    let expectedRelay: string;
    try {
      expectedRelay = scrubAligoCredential(meetupAlimRelaySecret.value());
    } catch {
      res.status(500).json({ ok: false, error: "MEETUP_ALIM_RELAY_SECRET 없음" });
      return;
    }
    const gotRelay = String(req.headers["x-meetup-alim-relay-secret"] ?? "").trim();
    if (!expectedRelay || gotRelay !== expectedRelay) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }

    injectAligoEnv();

    let rideId = "";
    try {
      const body = typeof req.body === "object" && req.body !== null ? (req.body as { rideId?: unknown }) : {};
      rideId = String(body.rideId ?? "").trim();
    } catch {
      res.status(400).json({ ok: false, error: "INVALID_BODY" });
      return;
    }
    if (!rideId) {
      res.status(400).json({ ok: false, error: "MISSING_RIDE_ID" });
      return;
    }

    const rideRef = db.collection("rides").doc(rideId);
    const rideSnap = await rideRef.get();
    if (!rideSnap.exists) {
      res.status(404).json({ ok: false, error: "RIDE_NOT_FOUND" });
      return;
    }
    const rideDataRaw = rideSnap.data();
    if (!rideDataRaw) {
      res.status(404).json({ ok: false, error: "NO_RIDE_DATA" });
      return;
    }
    const rideData = rideDataRaw as Record<string, unknown>;

    const prevSum = rideData.meetupInviteAlimtalkSummary as { sent?: number } | undefined;
    if (prevSum != null && typeof prevSum === "object" && Number(prevSum.sent) > 0) {
      res.status(200).json({ ok: true, skipped: true, reason: "already_sent" });
      return;
    }

    // 알리고 -99 분쟁 시: 미션 NAT IP와 숫자 비교해 릴레이 VPC 적용 여부 판별
    let diagSeenPublicIp: string | undefined;
    try {
      const dip = await fetchAligoKakaoEgressPublicIpDiagnostics();
      diagSeenPublicIp = dip ?? undefined;
      warnIfDiagPublicIpMismatch(dip, aligoNatEgressExpectIpv4.value(), "meetupInviteAlimtalkHttpsRelay");
      console.log("[meetupInviteAlimtalkHttpsRelay] diagSeenPublicIp:", dip ?? "(조회실패)", rideId);
    } catch (_) {
      /* ignore */
    }

    try {
      const result = await openRidingMeetupAlimtalkJs.sendMeetupInviteAlimtalksForNewRide(db, rideId, rideData);
      const diag = diagSeenPublicIp ? ({ diagSeenPublicIp } as Record<string, string>) : {};
      const summary = result.skipped
        ? {
            skipped: true,
            reason: result.reason || "unknown",
            error: result.error || null,
            delivery: "https_relay_vpc",
            ...diag,
          }
        : {
            skipped: false,
            sent: result.sent || 0,
            total: result.total || 0,
            attempts: result.attempts || [],
            delivery: "https_relay_vpc",
            ...diag,
          };
      await rideRef.set(
        {
          meetupInviteAlimtalkAt: admin.firestore.FieldValue.serverTimestamp(),
          meetupInviteAlimtalkSummary: summary,
        },
        { merge: true }
      );
      res.status(200).json({ ok: true, skipped: result.skipped ?? false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[meetupInviteAlimtalkHttpsRelay]", rideId, msg);
      try {
        await rideRef.set(
          {
            meetupInviteAlimtalkAt: admin.firestore.FieldValue.serverTimestamp(),
            meetupInviteAlimtalkSummary: {
              skipped: false,
              error: msg,
              delivery: "https_relay_vpc",
              ...(diagSeenPublicIp ? { diagSeenPublicIp } : {}),
            },
          },
          { merge: true }
        );
      } catch (e2) {
        console.error("[meetupInviteAlimtalkHttpsRelay] 요약 기록 실패", e2);
      }
      res.status(500).json({ ok: false, error: msg });
    }
  }
);

/** rides 생성 → 내부 HTTPS 릴레이 호출만 (VPC 없음). 성공 시 meetup 요약은 릴레이가 rides 에 기록한다. */
export const onRideCreatedMeetupInviteAlimtalk = onDocumentCreated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  {
    document: "rides/{rideId}",
    region: "asia-northeast3",
    timeoutSeconds: 180,
    memory: "256MiB",
    secrets: [meetupAlimRelaySecret],
  } as any,
  async (event) => {
    const snap = event.data;
    if (!snap?.exists) return;

    const rideId = String((event.params as { rideId?: string }).rideId || "").trim();
    const rideData = snap.data() as Record<string, unknown>;
    if (String(rideData.rideStatus || "active") === "cancelled") return;

    const invitedRaw = Array.isArray(rideData.invitedList) ? rideData.invitedList : [];
    if (invitedRaw.length === 0) return;

    const prevSum = rideData.meetupInviteAlimtalkSummary as { sent?: number } | undefined;
    if (prevSum != null && typeof prevSum === "object" && Number(prevSum.sent) > 0) {
      console.log("[onRideCreatedMeetupInviteAlimtalk] 이미 발송 성공 기록 있음 — 스킵", rideId);
      return;
    }

    const rideRef = db.collection("rides").doc(rideId);

    let relaySecretVal = "";
    try {
      relaySecretVal = scrubAligoCredential(meetupAlimRelaySecret.value());
    } catch (eSec) {
      console.error("[onRideCreatedMeetupInviteAlimtalk] MEETUP_ALIM_RELAY_SECRET 읽기 실패", rideId, eSec);
      return;
    }

    const paramUrl = meetupAlimRelayUrlParam.value()?.trim();
    const pid = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
    const fallbackUrl =
      pid.length > 0 ? `https://asia-northeast3-${pid}.cloudfunctions.net/meetupInviteAlimtalkHttpsRelay`.trim() : "";
    const relayUrl = (paramUrl || fallbackUrl || "").trim();

    if (!relayUrl) {
      console.error("[onRideCreatedMeetupInviteAlimtalk] 릴레이 URL 없음(PROJECT 또는 MEETUP_ALIM_RELAY_URL)", rideId);
      try {
        await rideRef.set(
          {
            meetupInviteAlimtalkAt: admin.firestore.FieldValue.serverTimestamp(),
            meetupInviteAlimtalkSummary: {
              skipped: false,
              error: "릴레이 URL 미설정(GCLOUD_PROJECT / MEETUP_ALIM_RELAY_URL)",
              delivery: "firestore_relay_invoke",
            },
          },
          { merge: true }
        );
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      const resp = await fetch(relayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-meetup-alim-relay-secret": relaySecretVal,
        },
        body: JSON.stringify({ rideId }),
      });
      const bodyText = await resp.text().catch(() => "");
      if (!resp.ok) {
        console.error("[onRideCreatedMeetupInviteAlimtalk] 릴레이 HTTP 오류", rideId, resp.status, bodyText);
        try {
          await rideRef.set(
            {
              meetupInviteAlimtalkAt: admin.firestore.FieldValue.serverTimestamp(),
              meetupInviteAlimtalkSummary: {
                skipped: false,
                error: `릴레이 HTTP ${resp.status}: ${bodyText.slice(0, 800)}`,
                delivery: "firestore_relay_invoke",
              },
            },
            { merge: true }
          );
        } catch (eWr) {
          console.error("[onRideCreatedMeetupInviteAlimtalk] 요약 기록 실패", eWr);
        }
        return;
      }
      console.log("[onRideCreatedMeetupInviteAlimtalk] 릴레이 OK", rideId, bodyText.slice(0, 200));
    } catch (eFetch) {
      const msg = eFetch instanceof Error ? eFetch.message : String(eFetch);
      console.error("[onRideCreatedMeetupInviteAlimtalk] 릴레이 fetch 실패", rideId, msg);
      try {
        await rideRef.set(
          {
            meetupInviteAlimtalkAt: admin.firestore.FieldValue.serverTimestamp(),
            meetupInviteAlimtalkSummary: {
              skipped: false,
              error: msg,
              delivery: "firestore_relay_invoke",
            },
          },
          { merge: true }
        );
      } catch (eWr) {
        console.error("[onRideCreatedMeetupInviteAlimtalk] 요약 기록 실패", eWr);
      }
    }
  }
);

/** 라이딩 모임 참석 검증 (Strava 스트림 + 집결지 반경 200m, 모임 시각 ±1h) — 방장 전용 Callable */
export const verifyMeetingAttendance = createVerifyMeetingAttendance(stravaClientSecret);

/** 서울 새벽 3:30: 전날 Strava 배치(02:00) 이후 미검증 rides 일괄 참석 검증 (스케줄러, Strava Secret 필요) */
export const scheduledRideAttendanceVerification = createScheduledRideAttendanceVerification(stravaClientSecret);
