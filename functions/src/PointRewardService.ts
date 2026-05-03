import * as admin from "firebase-admin";
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import {
  aligoApiFailureHint,
  logAligoAuthShape,
  scrubAligoCredential,
} from "./aligoCredentials";

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

/** 알리고/카카오 승인 알림톡 제목(subject_1) — 본문 첫째 줄 […] 제목 텍스트와 동일(대괄호 없음) */
const ALIMTALK_SUBJECT_KO = "STELVIO 라이딩 미션 달성 및 구독 연장 안내";
/** 본문 첫 줄 검수 문구(대괄호 포함) — 승인 템플릿과 바이트 단위로 맞춤 */
const ALIMTALK_MISSION_TITLE = ALIMTALK_SUBJECT_KO;
const ALIMTALK_MISSION_HEADER_LINE = `[${ALIMTALK_MISSION_TITLE}]`;

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
  /** 구독 연장이 있을 때만 의미: indoor 트리거·Strava 로그 merge용 */
  alimtalkSkip: string | null;
  alimtalkError: string | null;
  historyId: string;
}

interface RidingRewardTxOutput {
  userName: string;
  receiverPhone: string;
  result: ProcessRidingRewardResult;
}

/** appendPointHistory와 동일 스냅샷으로 알림톡 전송(훈련 로그 필드 타입/누락으로 send만 실패하는 것 방지) */
export interface StelvioIndoorAlimtalkPayload {
  userId: string;
  extendedDays: number;
  earnedPoints: number;
  expiryBefore: string;
  expiryAfter: string;
  remPointsAfter: number;
  userName: string;
  receiverPhone: string;
}

export interface StelvioMileageAppendResult {
  historyId: string;
  /** 구독 연장이 없으면 null (알림톡 불필요) */
  alimtalkPayload: StelvioIndoorAlimtalkPayload | null;
}

export interface StelvioIndoorAlimtalkSendResult {
  alimtalkSent: boolean;
  skipped: string | null;
  /** Functions 트리거 로그·훈련 로그 merge용 */
  errorDetail?: string;
}

/** Firestore/문자/Date → Asia/Seoul 달력 YYYY-MM-DD (Strava·실내 `saveTrainingSession`과 동일 스킴) */
function toYmdSeoul(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    // YYYY-MM-DD 형식 (정상)
    const m1 = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m1) return m1[0];
    // MM-DD-YY 또는 MM-DD-YYYY 형식 → YYYY-MM-DD 로 변환
    const m2 = trimmed.match(/^(\d{2})-(\d{2})-(\d{2,4})$/);
    if (m2) {
      const [, mm, dd, yy] = m2;
      const yyyy = yy.length === 2 ? `20${yy}` : yy;
      return `${yyyy}-${mm}-${dd}`;
    }
    // MM/DD/YYYY 또는 MM/DD/YY 형식 → YYYY-MM-DD 로 변환
    const m3 = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m3) {
      const [, mm, dd, yy] = m3;
      const yyyy = yy.length === 2 ? `20${yy}` : yy;
      return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
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

/** 휴대폰 숫자만 추출하여 알림톡 수신자 형태(11자리)로 정규화 */
function normalizeReceiverPhone(phone: string): string {
  return (phone || "").replace(/\D/g, "");
}

function getReceiverPhoneFromUserData(userData: Record<string, unknown>): string {
  return String(
    userData.contact ??
      userData.phoneNumber ??
      userData.phone ??
      userData.tel ??
      userData.mobile ??
      userData.phone_number ??
      ""
  ).trim();
}

/** Firestore Int/Long/문자 등 → 정수 (subscription_extended_days 등) */
function coerceToInt(value: unknown, defaultVal = 0): number {
  if (value === null || value === undefined) return defaultVal;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? defaultVal : n;
  }
  const withToNumber = value as { toNumber?: () => number };
  if (typeof withToNumber?.toNumber === "function") {
    try {
      const n = withToNumber.toNumber();
      return Number.isFinite(n) ? Math.trunc(n) : defaultVal;
    } catch {
      /* ignore */
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : defaultVal;
}

function diffCalendarDaysSeoulYmd(ymdBefore: string, ymdAfter: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymdBefore) || !/^\d{4}-\d{2}-\d{2}$/.test(ymdAfter)) return 0;
  const t0 = new Date(`${ymdBefore}T00:00:00+09:00`).getTime();
  const t1 = new Date(`${ymdAfter}T00:00:00+09:00`).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return 0;
  return Math.round((t1 - t0) / (24 * 60 * 60 * 1000));
}

/**
 * 카카오 검수 알림톡 템플릿: 만료일 줄 형식 MM-DD-YY (예: 06-07-26).
 * 내부 계산은 YYYY-MM-DD(서울) 유지, message_1 삽입 직전에만 변환.
 */
function formatSeoulYmdToAlimtalkMmDdYy(ymd: string): string {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd.trim() || "-";
  const [, yyyy, mm, dd] = m;
  return `${mm}-${dd}-${yyyy.slice(-2)}`;
}

/** SP 표시: 부동소수 오차 제거(알림톡 본문이 검수 템플릿과 글자 단위로 일치해야 함) */
function formatSpForKakaoTemplate(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2);
}

/**
 * 잔여 포인트 줄: 검수 샘플이 정수면 `286.37`이 불일치를 유발할 수 있음.
 * `KAKAO_ALIMTALK_SP_ALLOW_DECIMAL=1`이면 소수 둘째 자리까지(기존 로직).
 */
function formatRemPointsForMissionAlimtalk(n: number): string {
  const allowDec = String(process.env.KAKAO_ALIMTALK_SP_ALLOW_DECIMAL || "").toLowerCase();
  if (allowDec === "1" || allowDec === "true" || allowDec === "yes") {
    return formatSpForKakaoTemplate(n);
  }
  return String(Math.round(Number.isFinite(n) ? n : 0));
}

/** 빈 값·공백·단일 비(문자/숫자) 기호(예: `-`)는 recvname/본문 치환 시 검수 오류 유발 → 안전 폴백 */
function safeAlimtalkDisplayName(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "회원";
  if (t.length === 1 && /[^\p{L}\p{N}]/u.test(t)) return "회원";
  return t;
}

function buildAlimtalkMessage(params: {
  userName: string;
  earnedPoints: number;
  extendedDays: number;
  expiryDateBefore: string;
  expiryDateAfter: string;
  remPointsAfter: number;
}): string {
  const displayName = safeAlimtalkDisplayName(params.userName);
  const earnedSp = formatSpForKakaoTemplate(params.earnedPoints);
  const extendedDaysStr = String(
    Number.isFinite(params.extendedDays) ? Math.trunc(params.extendedDays) : 0
  );
  const remSp = formatRemPointsForMissionAlimtalk(params.remPointsAfter);

  const beforeYmd = toYmdSeoul(params.expiryDateBefore);
  const afterYmd = toYmdSeoul(params.expiryDateAfter);
  const beforeLine = beforeYmd ? formatSeoulYmdToAlimtalkMmDdYy(beforeYmd) : "-";
  const afterLine = afterYmd ? formatSeoulYmdToAlimtalkMmDdYy(afterYmd) : "-";

  // 완성된 문장으로 조립하되, 이모지는 알리고 DB에 저장된 깨진 형태(?‍♂️)를 유지
  const rawMessage = `${ALIMTALK_MISSION_HEADER_LINE}
안녕하세요 ${displayName}님,
오늘도 STELVIO와 함께 멋진 라이딩 미션을 완료하셨습니다! ?‍♂️

이번 라이딩(TSS) 달성 보상으로 포인트가 적립되었으며, 보유하신 포인트가 기준치에 도달하여 구독 기간이 자동으로 연장되었습니다.

▶ 이번 라이딩 보상
획득 포인트 : ${earnedSp} SP

▶ 구독 연장 혜택 적용
500 SP 자동 사용으로 인하여 구독 기간이 ${extendedDaysStr}일 추가 연장되었습니다.

기존 만료일 : ${beforeLine}
변경 만료일 : ${afterLine}

▶ 내 포인트 현황
사용 후 잔여 포인트 : ${remSp} SP

오늘 흘린 땀방울이 성장의 밑거름이 됩니다. 다음 훈련에서 뵙겠습니다!

※ 이 메시지는 고객님이 참여하신 STELVIO 라이딩 미션(이벤트) 달성에 따라 지급된 포인트 안내 메시지입니다.`;

  return rawMessage.replace(/\r?\n/g, "\r\n");
}

/**
 * POST /akv10/alimtalk/send/ 응답: 성공 시 `code` 는 Integer 0, message 예: "성공적으로 전송요청 하였습니다."
 * (구 SMS 연동 result_code=1 는 본 API와 혼용되지 않음 — alimtalk 전용이면 code만 본다)
 */
function isAligoAlimtalkApiSuccess(data: Record<string, unknown>): boolean {
  if (data.code !== undefined && data.code !== null) {
    const c = Number(data.code);
    return c === 0 && !Number.isNaN(c);
  }
  if (data.result_code !== undefined && data.result_code !== null) {
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

    const senderkey = scrubAligoCredential(String(process.env.ALIGO_SENDER_KEY || appConfig.senderkey || ""));
    const tplCode = scrubAligoCredential(String(process.env.ALIGO_TPL_CODE || appConfig.tpl_code || ""));
    const sender = scrubAligoCredential(String(process.env.ALIGO_SENDER || appConfig.sender || ""));

    const apikey = scrubAligoCredential(process.env.ALIGO_API_KEY);
    const userid = scrubAligoCredential(process.env.ALIGO_USER_ID);
    const token = scrubAligoCredential(process.env.ALIGO_TOKEN);

    if (!senderkey || !tplCode || !sender || !apikey || !userid || !token) {
      throw new Error(
        "알리고 설정이 누락되었습니다. (ALIGO_* env·Secret 또는 appConfig/aligo의 senderkey·tpl_code·sender 확인. API 인증 3종은 Secret ALIGO_API_KEY/USER_ID/TOKEN)"
      );
    }

    logAligoAuthShape("loadAligoConfig", apikey, userid, token);

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
   * aligoapi.alimtalkSend(req, auth) — body + auth( apikey, userid, token ) form 합쳐 POST
   * 공식 필수: senderkey, tpl_code, sender, receiver_1, subject_1, message_1
   * 선택: recvname_1, senddate, emtitle_1, button_1, failover, fsubject_1, fmessage_1, testMode
   * failover=Y 일 때 fsubject_1, fmessage_1 필수 — 본 구현은 failover N(대체문자 없음)
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
    const recvName = safeAlimtalkDisplayName(displayName || "");
    const messageOut = message.replace(/\r?\n/g, "\r\n");

    const body: Record<string, string> = {
      senderkey: cfg.senderkey,
      tpl_code: cfg.tpl_code,
      sender: cfg.sender,
      receiver_1: receiver,
      recvname_1: recvName,
      subject_1: subject,
      message_1: messageOut,
      failover: "N",
    };

    if (String(process.env.ALIGO_ALIMTALK_TEST_MODE || "").toUpperCase() === "Y") {
      body.testMode = "Y";
    }
    const em = String(process.env.ALIGO_ALIMTALK_EMTITLE_1 || "").trim();
    if (em) {
      body.emtitle_1 = em;
    }
    const btn = String(process.env.ALIGO_ALIMTALK_BUTTON_1 || "").trim();
    if (btn) {
      body.button_1 = btn;
    }

    /* aligoapi.formParse()는 Express req를 가정하여 obj.headers['content-type']에 직접 접근함.
     * Firebase Functions 환경에서는 headers가 없으므로 직접 주입.
     * 'application/json' 지정 → non-multipart 분기로 obj.body를 정상 파싱. */
    const req = { body, headers: { 'content-type': 'application/json' } };
    const authData = {
      apikey: cfg.apikey,
      userid: cfg.userid,
      token: cfg.token,
    };

    const raw = (await aligoapi.alimtalkSend(req, authData)) as Record<string, unknown>;
    if (!isAligoAlimtalkApiSuccess(raw)) {
      let detail = "";
      try {
        detail = JSON.stringify(raw);
      } catch {
        detail = String(raw);
      }
      const msg = String(
        (raw as { message?: string; Message?: string }).message ??
          (raw as { Message?: string }).Message ??
          "알 수 없는 응답"
      );
      const c = raw?.code ?? raw?.result_code;
      const hint = aligoApiFailureHint(c, msg);
      console.error("[Aligo] alimtalkSend 비성공 응답:", detail, hint || "");
      throw new Error(`알림톡 API 실패(code=${String(c)}): ${msg}${hint}`);
    }
    const info = raw.info as
      | { mid?: string | number; scnt?: number; fcnt?: number; type?: string }
      | undefined;
    if (info && info.mid != null) {
      console.log(
        `[Aligo] alimtalk 전송요청 수신 type=${String(info.type ?? "AT")} mid=${String(info.mid)} scnt=${
          info.scnt ?? ""
        } fcnt=${info.fcnt ?? ""}`
      );
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
      const receiverPhone = getReceiverPhoneFromUserData(userData);

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
          alimtalkSkip: null,
          alimtalkError: null,
          historyId: pointHistoryRef.id,
        },
      };
    });

    let alimtalkSent = false;
    let alimtalkSkip: string | null =
      txResult.result.extendedDays > 0 ? null : "no_subscription_extension";
    let alimtalkError: string | null = null;
    if (txResult.result.extendedDays > 0) {
      const notify = await this.sendStelvioIndoorAlimtalkFromPayload({
        userId: txResult.result.userId,
        extendedDays: txResult.result.extendedDays,
        earnedPoints: txResult.result.earnedPoints,
        expiryBefore: txResult.result.expiryDateBefore,
        expiryAfter: txResult.result.expiryDateAfter,
        remPointsAfter: txResult.result.pointsAfter,
        userName: txResult.userName,
        receiverPhone: txResult.receiverPhone,
      });
      alimtalkSent = notify.alimtalkSent;
      alimtalkSkip = notify.skipped;
      alimtalkError = notify.errorDetail ?? null;
    }

    return {
      ...txResult.result,
      alimtalkSent,
      alimtalkSkip,
      alimtalkError,
    };
  }

  /**
   * `saveTrainingSession`이 먼저 `users`를 갱신한 뒤이므로 `processRidingReward`를 쓰지 않는 대신
   * `point_history`만 남긴다(이중 적립 방지). rem은 클라이언트 기준, 이전 rem은 역산.
   * 문서 id를 `stelvio_mileage_{userId}_{logId}`로 고정해 트리거 재시도 시 중복 기록을 방지한다.
   */
  async appendPointHistoryForStelvioClientMileage(
    userId: string,
    logData: Record<string, unknown>,
    trainingLogId: string
  ): Promise<StelvioMileageAppendResult> {
    if (!userId || !userId.trim()) {
      throw new Error("userId가 비어 있습니다.");
    }
    if (!trainingLogId) {
      throw new Error("trainingLogId가 비어 있습니다.");
    }
    const userRef = this.db.collection(USERS_COLLECTION).doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new Error(`사용자를 찾을 수 없습니다: ${userId}`);
    }
    const userData = userSnap.data() ?? {};
    const tss = Math.max(0, Math.round(Number(logData.tss) || 0));
    const earnedPoints =
      logData.earned_points != null && String(logData.earned_points) !== ""
        ? Math.max(0, coerceToInt(logData.earned_points))
        : Math.max(0, Math.floor(tss * POINTS_PER_TSS));
    const remAfter = Math.round(
      coerceToInt(userData.rem_points) || Number(userData.rem_points) || 0
    );

    let expiryDateBefore = String(logData.subscription_expiry_date_before ?? "").trim();
    let expiryDateAfter = String(logData.subscription_expiry_date_after ?? "").trim();
    if (!expiryDateBefore) {
      expiryDateBefore = toYmdSeoul(userData.expiry_date ?? userData.subscription_end_date ?? "");
    }
    if (!expiryDateAfter) {
      expiryDateAfter = toYmdSeoul(userData.expiry_date ?? userData.subscription_end_date ?? "");
    }

    const extendedFromLog = coerceToInt(logData.subscription_extended_days);
    const fromDateDiff =
      expiryDateBefore && expiryDateAfter
        ? diffCalendarDaysSeoulYmd(expiryDateBefore, expiryDateAfter)
        : 0;
    const extendedDays = Math.max(extendedFromLog, fromDateDiff, 0);

    const pointsUsed = extendedDays * SUBSCRIPTION_POINT_THRESHOLD;
    let pointsBefore = Math.round(remAfter - earnedPoints + pointsUsed);
    if (pointsBefore < 0) {
      console.warn(
        `[PointReward] appendPointHistoryForStelvioClientMileage: pointsBefore<0 → 0 보정 userId=${userId} logId=${trainingLogId}`,
        { remAfter, earnedPoints, pointsBefore, extendedDays, extendedFromLog, fromDateDiff }
      );
      pointsBefore = 0;
    }
    const pointsAfter = remAfter;

    const userName = String(userData.name || userData.user_name || "회원").trim() || "회원";
    const receiverPhone = getReceiverPhoneFromUserData(userData);

    const historyDocId = `stelvio_mileage_${userId}_${trainingLogId}`.replace(/[/#]/g, "_");
    const pointHistoryRef = this.db.collection(POINT_HISTORY_COLLECTION).doc(historyDocId);
    await pointHistoryRef.set(
      {
        user_id: userId,
        source: "indoor",
        is_strava: false,
        client_mileage_from_stelvio_log: true,
        users_training_log_id: trainingLogId,
        tss,
        earned_points: earnedPoints,
        points_before: pointsBefore,
        points_after: pointsAfter,
        points_used_for_subscription: pointsUsed,
        subscription_threshold: SUBSCRIPTION_POINT_THRESHOLD,
        extension_count: extendedDays,
        extended_days: extendedDays,
        expiry_date_before: expiryDateBefore || null,
        expiry_date_after: expiryDateAfter || null,
        subscription_extended_days: extendedDays,
        subscription_expiry_date_before: expiryDateBefore || null,
        subscription_expiry_date_after: expiryDateAfter || null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const alimtalkPayload: StelvioIndoorAlimtalkPayload | null =
      extendedDays > 0
        ? {
            userId,
            extendedDays,
            earnedPoints: earnedPoints,
            expiryBefore: expiryDateBefore,
            expiryAfter: expiryDateAfter,
            remPointsAfter: remAfter,
            userName,
            receiverPhone,
          }
        : null;

    return { historyId: pointHistoryRef.id, alimtalkPayload };
  }

  /**
   * `appendPointHistoryForStelvioClientMileage`의 `alimtalkPayload`로만 발송(훈련 로그 재파싱·타입 이슈 제거).
   * API 실패 시 예외를 던지지 않고 `aligo_error` + errorDetail로 반환(Functions가 멈추지 않음).
   */
  async sendStelvioIndoorAlimtalkFromPayload(
    payload: StelvioIndoorAlimtalkPayload | null
  ): Promise<StelvioIndoorAlimtalkSendResult> {
    if (!payload) {
      return { alimtalkSent: false, skipped: "no_subscription_extension" };
    }
    if (payload.extendedDays <= 0) {
      return { alimtalkSent: false, skipped: "no_subscription_extension" };
    }
    if (!normalizeReceiverPhone(payload.receiverPhone)) {
      console.warn(
        `[PointReward] userId=${payload.userId} 구독 연장 알림톡 생략: users에 휴대전화 없음 (contact·phone·mobile 등)`
      );
      return { alimtalkSent: false, skipped: "no_phone" };
    }
    const message = buildAlimtalkMessage({
      userName: payload.userName,
      earnedPoints: payload.earnedPoints,
      extendedDays: payload.extendedDays,
      expiryDateBefore: payload.expiryBefore,
      expiryDateAfter: payload.expiryAfter,
      remPointsAfter: payload.remPointsAfter,
    });
    const subject = ALIMTALK_SUBJECT_KO;
    try {
      await this.sendAlimtalk(payload.receiverPhone, payload.userName, subject, message);
      return { alimtalkSent: true, skipped: null };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error(`[PointReward] stelvio indoor 알림톡 API userId=${payload.userId}:`, err);
      return { alimtalkSent: false, skipped: "aligo_error", errorDetail: m };
    }
  }
}
