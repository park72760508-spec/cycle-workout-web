import * as admin from "firebase-admin";
import type { Firestore, Timestamp } from "firebase-admin/firestore";

const aligoapi = require("aligoapi");

/** 포인트 계산 비율: 기본 1 TSS = 1 SP */
const POINTS_PER_TSS = Number(process.env.POINTS_PER_TSS || "1");
/** 구독 연장 트리거 포인트 기준치 */
const SUBSCRIPTION_POINT_THRESHOLD = Number(process.env.SUBSCRIPTION_POINT_THRESHOLD || "500");
/** 기준치 1회 충족 시 연장되는 일수 */
const SUBSCRIPTION_DAYS_PER_THRESHOLD = Number(process.env.SUBSCRIPTION_DAYS_PER_THRESHOLD || "1");

const USERS_COLLECTION = "users";
const POINT_HISTORY_COLLECTION = "point_history";
const APP_CONFIG_COLLECTION = "appConfig";
const ALIGO_CONFIG_DOC = "aligo";

interface AligoConfig {
  senderkey: string;
  tpl_code: string;
  sender: string;
  apikey: string;
  userid: string;
  token: string;
}

interface ProcessRidingRewardResult {
  userId: string;
  earnedPoints: number;
  pointsBefore: number;
  pointsAfter: number;
  pointsUsed: number;
  extensionCount: number;
  extendedDays: number;
  expiryDateBefore: string;
  expiryDateAfter: string;
  alimtalkSent: boolean;
  historyId: string;
}

interface RidingRewardTxOutput {
  userName: string;
  receiverPhone: string;
  result: ProcessRidingRewardResult;
}

/** Firestore/문자/Date → Asia/Seoul 달력 YYYY-MM-DD (Strava·실내 `saveTrainingSession`과 동일 스킴) */
function toYmdSeoul(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
  }
  const ts = value as Timestamp;
  if (ts && typeof ts.toDate === "function") {
    const d = ts.toDate();
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(value);
  }
  const raw = String(value).trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(parsed);
}

function ymdTodaySeoul(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function ymdCompare(a: string, b: string): number {
  if (!a || !b) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** KST YMD에 calendar days일 더함 (toISOString UTC + 로컬 Date 혼용 금지) */
function addCalendarDaysYmdSeoul(ymd: string, days: number): string {
  if (!ymd || !/^(\d{4})-(\d{2})-(\d{2})$/.test(ymd)) return ymd;
  const t = new Date(`${ymd}T00:00:00+09:00`);
  if (Number.isNaN(t.getTime())) return ymd;
  t.setTime(t.getTime() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(t);
}

/**
 * rem+TSS로 extensionDays만큼 구독 끝을 연장할 때, 연장 직전 기준일(before)과 연장 반영 후(after).
 * - 만료일이 오늘(Seoul) 이전이면 기준을 오늘로 맞춤 (기존 computeExtendedExpiryDate와 동일 의도).
 * - 만료일이 비어 있으면 오늘(Seoul)을 기준으로 둠.
 */
function computeSubscriptionExpiryBeforeAfterSeoul(
  userExpiryRaw: unknown,
  extensionDays: number
): { before: string; after: string } {
  const todayYmd = ymdTodaySeoul();
  let baseYmd = toYmdSeoul(userExpiryRaw);
  if (!baseYmd) {
    baseYmd = todayYmd;
  }
  if (ymdCompare(baseYmd, todayYmd) < 0) {
    baseYmd = todayYmd;
  }
  const before = baseYmd;
  const after =
    extensionDays > 0 ? addCalendarDaysYmdSeoul(before, extensionDays) : before;
  return { before, after };
}

/** 한국형 날짜 포맷: YYYY년 MM월 DD일 (Seoul YMD 기준) */
function formatDateKo(value: string): string {
  const ymd = toYmdSeoul(value);
  if (!ymd) return "-";
  const [y, m, d] = ymd.split("-");
  return `${y}년 ${m}월 ${d}일`;
}

/** 휴대폰 숫자만 추출하여 알림톡 수신자 형태(11자리)로 정규화 */
function normalizeReceiverPhone(phone: string): string {
  return (phone || "").replace(/\D/g, "");
}

/** 카카오 승인 템플릿과 동일한 문구로 알림톡 본문 생성 */
function buildAlimtalkMessage(params: {
  userName: string;
  earnedPoints: number;
  extendedDays: number;
  expiryDateBefore: string;
  expiryDateAfter: string;
  remPointsAfter: number;
}): string {
  return `[STELVIO 포인트 적립 및 구독 연장 안내]

안녕하세요 ${params.userName}님,
오늘도 STELVIO와 함께 멋진 라이딩을 완료하셨습니다! 🚴‍♂️

이번 라이딩(TSS) 보상으로 포인트가 적립되었으며, 보유하신 포인트가 기준치에 도달하여 구독 기간이 자동으로 연장되었습니다.

▶ 이번 라이딩 보상
획득 포인트 : ${params.earnedPoints} SP

▶ 구독 연장 혜택 적용
500 SP 자동 사용으로 인하여 구독 기간이 ${params.extendedDays}일 추가 연장되었습니다.

기존 만료일 : ${formatDateKo(params.expiryDateBefore)}
변경 만료일 : ${formatDateKo(params.expiryDateAfter)}

▶ 내 포인트 현황
사용 후 잔여 포인트 : ${params.remPointsAfter} SP

오늘 흘린 땀방울이 성장의 밑거름이 됩니다. 다음 훈련에서 뵙겠습니다!

※ 이 메시지는 고객님의 STELVIO 서비스 이용(라이딩 완료)에 따른 거래관계로 지급된 포인트 안내 메시지입니다.`;
}

/**
 * 알리고 카카오 알림톡(akv10) 응답: code === 0 이 성공. 구 SMS API result_code=1 은 하위호환.
 */
function isAligoAlimtalkApiSuccess(data: Record<string, unknown>): boolean {
  if (data.code !== undefined) {
    return Number(data.code) === 0;
  }
  if (data.result_code !== undefined) {
    return String(data.result_code) === "1";
  }
  return false;
}

export class PointRewardService {
  constructor(private readonly db: Firestore) {}

  /** Strava Secret 패턴과 동일하게 env + appConfig(aligo) 조합으로 설정 로딩 */
  private async loadAligoConfig(): Promise<AligoConfig> {
    const appConfigSnap = await this.db.collection(APP_CONFIG_COLLECTION).doc(ALIGO_CONFIG_DOC).get();
    const appConfig = appConfigSnap.exists ? appConfigSnap.data() ?? {} : {};

    const senderkey = String(process.env.ALIGO_SENDER_KEY || appConfig.senderkey || "").trim();
    const tplCode = String(process.env.ALIGO_TPL_CODE || appConfig.tpl_code || "").trim();
    const sender = String(process.env.ALIGO_SENDER || appConfig.sender || "").trim();

    const apikey = String(process.env.ALIGO_API_KEY || "").trim();
    const userid = String(process.env.ALIGO_USER_ID || "").trim();
    const token = String(process.env.ALIGO_TOKEN || "").trim();

    if (!senderkey || !tplCode || !sender || !apikey || !userid || !token) {
      throw new Error("알리고 설정이 누락되었습니다. (ALIGO_* env 또는 appConfig/aligo 확인 필요)");
    }

    return {
      senderkey,
      tpl_code: tplCode,
      sender,
      apikey,
      userid,
      token,
    };
  }

  /**
   * aligoapi.alimtalkSend(req, auth) — npm 패키지는 콜백 미지원, Promise 응답 body만 유효.
   * @see https://kakaoapi.aligo.in/akv10/alimtalk/send/
   */
  private async sendAlimtalk(
    receiverPhone: string,
    displayName: string,
    subject: string,
    message: string
  ): Promise<void> {
    const cfg = await this.loadAligoConfig();
    const receiver = normalizeReceiverPhone(receiverPhone);
    if (!receiver) {
      throw new Error("알림톡 수신자 번호가 비어 있습니다.");
    }
    const recvName = (displayName || "회원").trim() || "회원";

    const req = {
      body: {
        senderkey: cfg.senderkey,
        tpl_code: cfg.tpl_code,
        sender: cfg.sender,
        receiver_1: receiver,
        recvname_1: recvName,
        subject_1: subject,
        message_1: message,
      },
    };
    const authData = {
      apikey: cfg.apikey,
      userid: cfg.userid,
      token: cfg.token,
    };

    const raw = (await aligoapi.alimtalkSend(req, authData)) as Record<string, unknown>;
    if (!isAligoAlimtalkApiSuccess(raw)) {
      const msg = String(
        (raw as { message?: string; Message?: string }).message ??
          (raw as { Message?: string }).Message ??
          "알 수 없는 응답"
      );
      const c = raw?.code ?? raw?.result_code;
      throw new Error(`알림톡 API 실패(code=${String(c)}): ${msg}`);
    }
  }

  /**
   * 인도어 세션 종료 / Strava 업로드 완료 시 호출되는 메인 함수
   * - 포인트 누적
   * - 기준치(500SP) 충족 시 자동 차감 + 구독 연장
   * - point_history 기록
   * - 필요 시 알림톡 발송
   */
  async processRidingReward(userId: string, tss: number, isStrava: boolean): Promise<ProcessRidingRewardResult> {
    if (!userId || !userId.trim()) {
      throw new Error("userId가 비어 있습니다.");
    }
    if (!Number.isFinite(tss) || tss < 0) {
      throw new Error("tss는 0 이상의 숫자여야 합니다.");
    }

    const earnedPoints = Math.max(0, Math.floor(tss * POINTS_PER_TSS));
    const userRef = this.db.collection(USERS_COLLECTION).doc(userId);
    const pointHistoryRef = this.db.collection(POINT_HISTORY_COLLECTION).doc();

    const txResult = await this.db.runTransaction<RidingRewardTxOutput>(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new Error(`사용자를 찾을 수 없습니다: ${userId}`);
      }

      const userData = userSnap.data() ?? {};
      const pointsBefore = Number(userData.rem_points || 0);
      const totalPoints = pointsBefore + earnedPoints;

      const extensionCount = Math.floor(totalPoints / SUBSCRIPTION_POINT_THRESHOLD);
      const pointsUsed = extensionCount * SUBSCRIPTION_POINT_THRESHOLD;
      const pointsAfter = totalPoints - pointsUsed;
      const extendedDays = extensionCount * SUBSCRIPTION_DAYS_PER_THRESHOLD;

      const expiryRaw = userData.expiry_date ?? userData.subscription_end_date ?? "";
      const { before: expiryDateBefore, after: expiryDateAfter } = computeSubscriptionExpiryBeforeAfterSeoul(
        expiryRaw,
        extendedDays
      );

      const currentAccPoints = Number(userData.acc_points || 0);
      const updatePayload: Record<string, unknown> = {
        rem_points: pointsAfter,
        acc_points: currentAccPoints + earnedPoints,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (extendedDays > 0) {
        updatePayload.expiry_date = expiryDateAfter;
        // 프로젝트에 해당 필드가 존재하는 경우 동기화 용도로 같이 업데이트
        if (userData.subscription_end_date !== undefined) {
          updatePayload.subscription_end_date = expiryDateAfter;
        }
      }

      tx.update(userRef, updatePayload);

      tx.set(pointHistoryRef, {
        user_id: userId,
        source: isStrava ? "strava" : "indoor",
        is_strava: isStrava,
        tss,
        earned_points: earnedPoints,
        points_before: pointsBefore,
        points_after: pointsAfter,
        points_used_for_subscription: pointsUsed,
        subscription_threshold: SUBSCRIPTION_POINT_THRESHOLD,
        extension_count: extensionCount,
        extended_days: extendedDays,
        expiry_date_before: expiryDateBefore || null,
        expiry_date_after: expiryDateAfter || null,
        // 실내 훈련 로그(`subscription_*`)와 동일 의미·Seoul YMD (Strava/Outdoor 포함)
        subscription_extended_days: extendedDays,
        subscription_expiry_date_before: expiryDateBefore || null,
        subscription_expiry_date_after: expiryDateAfter || null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      const userName = String(userData.name || userData.user_name || "회원").trim() || "회원";
      const receiverPhone = String(
        userData.contact || userData.phoneNumber || userData.phone || userData.tel || ""
      ).trim();

      return {
        userName,
        receiverPhone,
        result: {
          userId,
          earnedPoints,
          pointsBefore,
          pointsAfter,
          pointsUsed,
          extensionCount,
          extendedDays,
          expiryDateBefore,
          expiryDateAfter,
          alimtalkSent: false,
          historyId: pointHistoryRef.id,
        },
      };
    });

    let alimtalkSent = false;
    if (txResult.result.extendedDays > 0) {
      const message = buildAlimtalkMessage({
        userName: txResult.userName,
        earnedPoints: txResult.result.earnedPoints,
        extendedDays: txResult.result.extendedDays,
        expiryDateBefore: txResult.result.expiryDateBefore,
        expiryDateAfter: txResult.result.expiryDateAfter,
        remPointsAfter: txResult.result.pointsAfter,
      });
      const subject = "STELVIO 포인트 적립 및 구독 연장 안내";
      try {
        if (!normalizeReceiverPhone(txResult.receiverPhone)) {
          console.warn(
            `[PointReward] userId=${txResult.result.userId} 구독 연장 알림톡 생략: users 문서에 휴대전화 없음 (contact/phone/phoneNumber/tel)`
          );
        } else {
          await this.sendAlimtalk(txResult.receiverPhone, txResult.userName, subject, message);
          alimtalkSent = true;
        }
      } catch (err) {
        console.error(
          `[PointReward] userId=${txResult.result.userId} 알림톡 발송 실패(적립/연장은 이미 반영됨):`,
          err
        );
      }
    }

    return {
      ...txResult.result,
      alimtalkSent,
    };
  }

  /**
   * 실내 STELVIO 훈련: `saveTrainingSession`이 트랜잭션에서 이미 rem/acc/만료일을 반영한 뒤 로그가 생성됨.
   * 이 경우 `processRidingReward`를 호출하면 동일 TSS가 다시 더해져 이중 적립되고,
   * 서버가 읽는 잔여 포인트는 이미 500이 차감된 뒤라 extendedDays=0이 되어 알림톡이 절대 나가지 않음.
   * 클라이언트가 logs에 남긴 `subscription_*` 메타로 연장이 있을 때만 알리고 알림톡을 발송한다.
   */
  async sendAlimtalkForStelvioIndoorLog(
    userId: string,
    logData: Record<string, unknown>
  ): Promise<{ alimtalkSent: boolean; skipped: string | null }> {
    if (!userId || !userId.trim()) {
      throw new Error("userId가 비어 있습니다.");
    }
    const extendedDays = Math.floor(Number(logData.subscription_extended_days ?? 0));
    if (extendedDays <= 0) {
      return { alimtalkSent: false, skipped: "no_subscription_extension" };
    }

    const earned = Math.max(0, Math.floor(Number(logData.earned_points ?? logData.tss ?? 0)));
    const expiryBefore = String(logData.subscription_expiry_date_before ?? "").trim();
    const expiryAfter = String(logData.subscription_expiry_date_after ?? "").trim();

    const userRef = this.db.collection(USERS_COLLECTION).doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return { alimtalkSent: false, skipped: "user_not_found" };
    }
    const userData = userSnap.data() ?? {};
    const userName = String(userData.name || userData.user_name || "회원").trim() || "회원";
    const receiverPhone = String(
      userData.contact || userData.phoneNumber || userData.phone || userData.tel || ""
    ).trim();
    const remPointsAfter = Math.round(Number(userData.rem_points || 0));

    const message = buildAlimtalkMessage({
      userName,
      earnedPoints: earned,
      extendedDays,
      expiryDateBefore: expiryBefore,
      expiryDateAfter: expiryAfter,
      remPointsAfter,
    });
    const subject = "STELVIO 포인트 적립 및 구독 연장 안내";
    try {
      if (!normalizeReceiverPhone(receiverPhone)) {
        console.warn(
          `[PointReward] userId=${userId} (stelvio indoor) 구독 연장 알림톡 생략: users 문서에 휴대전화 없음 (contact/phone/phoneNumber/tel)`
        );
        return { alimtalkSent: false, skipped: "no_phone" };
      }
      await this.sendAlimtalk(receiverPhone, userName, subject, message);
      return { alimtalkSent: true, skipped: null };
    } catch (err) {
      console.error(`[PointReward] userId=${userId} (stelvio indoor) 알림톡 실패:`, err);
      throw err;
    }
  }
}
