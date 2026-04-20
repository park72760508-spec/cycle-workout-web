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

/** 문자열/타임스탬프/Date 입력을 YYYY-MM-DD로 표준화 */
function toIsoDate(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split("T")[0];
  }

  const ts = value as Timestamp;
  if (ts && typeof ts.toDate === "function") {
    const d = ts.toDate();
    if (!Number.isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }

  const raw = String(value).trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().split("T")[0];
}

/** 한국형 날짜 포맷: YYYY년 MM월 DD일 */
function formatDateKo(value: string): string {
  const iso = toIsoDate(value);
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${y}년 ${m}월 ${d}일`;
}

/** 휴대폰 숫자만 추출하여 알림톡 수신자 형태(11자리)로 정규화 */
function normalizeReceiverPhone(phone: string): string {
  return (phone || "").replace(/\D/g, "");
}

/** 기존 만료일(미래면 유지, 과거/없음이면 오늘)을 기준으로 일수 연장 */
function computeExtendedExpiryDate(currentExpiryDate: string, addDays: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const base = new Date(today);
  const current = toIsoDate(currentExpiryDate);
  if (current) {
    const currentDate = new Date(current);
    currentDate.setHours(0, 0, 0, 0);
    if (currentDate.getTime() >= today.getTime()) {
      base.setTime(currentDate.getTime());
    }
  }

  base.setDate(base.getDate() + addDays);
  return base.toISOString().split("T")[0];
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

  /** aligoapi.alimtalkSend(req, AuthData) 호출 래퍼 */
  private async sendAlimtalk(receiverPhone: string, subject: string, message: string): Promise<void> {
    const cfg = await this.loadAligoConfig();
    const receiver = normalizeReceiverPhone(receiverPhone);
    if (!receiver) {
      throw new Error("알림톡 수신자 번호가 비어 있습니다.");
    }

    const req = {
      body: {
        senderkey: cfg.senderkey,
        tpl_code: cfg.tpl_code,
        sender: cfg.sender,
        receiver_1: receiver,
        subject_1: subject,
        message_1: message,
      },
    };
    const authData = {
      apikey: cfg.apikey,
      userid: cfg.userid,
      token: cfg.token,
    };

    await new Promise<void>((resolve, reject) => {
      try {
        const maybePromise = aligoapi.alimtalkSend(req, authData, (response: unknown) => {
          const raw = response as { result_code?: number | string; message?: string };
          const code = String(raw?.result_code ?? "");
          if (code && code !== "1") {
            reject(new Error(`알림톡 발송 실패(result_code=${code}, message=${raw?.message ?? "-"})`));
            return;
          }
          resolve();
        });

        if (maybePromise && typeof maybePromise.then === "function") {
          (maybePromise as Promise<unknown>).then(() => resolve()).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });
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

      const expiryDateBefore = toIsoDate(userData.expiry_date ?? userData.subscription_end_date ?? "");
      const expiryDateAfter = extendedDays > 0
        ? computeExtendedExpiryDate(expiryDateBefore, extendedDays)
        : expiryDateBefore;

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
      await this.sendAlimtalk(
        txResult.receiverPhone,
        "STELVIO 포인트 적립 및 구독 연장 안내",
        message
      );
      alimtalkSent = true;
    }

    return {
      ...txResult.result,
      alimtalkSent,
    };
  }
}
