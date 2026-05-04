/**
 * 카카오 알림톡(알리고) 공통 레이어
 * - 라이딩 미션 달성·구독 연장(UH_2120 등, ALIGO_TPL_CODE / tpl_code)
 * - 오프라인 라이딩 모임 오픈(UH_5528 등, MEETUP_OPEN_TPL 코드)
 *
 * 채널·API·senderkey/apikey 패턴은 동일하고 템플릿 코드·subject·본문·env 옵션만 다르다.
 * (code=-99 IP 이슈는 트리거 종류가 아니라 VPC egress로 해결 — 본 모듈은 HTTP 페이로드만 통일)
 */
import type { Firestore } from "firebase-admin/firestore";
import { aligoApiFailureHint, logAligoAuthShape, scrubAligoCredential } from "./aligoCredentials";

const aligoapi = require("aligoapi");

const APP_CONFIG_COLLECTION = "appConfig";
const ALIGO_CONFIG_DOC = "aligo";

const DEFAULT_MEETUP_OPEN_TPL_CODE = "UH_5528";

export const ALIMTALK_TEMPLATE = {
  /** 미션 달성·구독 연장 안내 (기본 템플릿 코드 UH_2120 계열 — env/appConfig 에서 로드) */
  MISSION_SUBSCRIPTION: "mission_subscription",
  /** 오프라인 라이딩 모임 오픈 (UH_5528 계열 — meetup_* 키) */
  MEETUP_OFFLINE_OPEN: "meetup_offline_open",
} as const;

export type AlimtalkTemplateKind = (typeof ALIMTALK_TEMPLATE)[keyof typeof ALIMTALK_TEMPLATE];

export interface AligoAlimtalkConfig {
  senderkey: string;
  tpl_code: string;
  sender: string;
  apikey: string;
  userid: string;
  token: string;
}

/** 빈 값·단일 비(문자/숫자) 기호 등 recvname 오류 유발값 방지 — PointReward·모임 동일 규칙 */
export function safeAlimtalkDisplayNameUnified(raw: unknown): string {
  const t = String(raw ?? "").trim();
  if (!t) return "회원";
  if (t.length === 1 && /[^\p{L}\p{N}]/u.test(t)) return "회원";
  return t;
}

export function normalizeReceiverPhoneDigits(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

export function isAligoAlimtalkApiSuccessUnified(data: Record<string, unknown>): boolean {
  if (data.code !== undefined && data.code !== null) {
    const c = Number(data.code);
    return c === 0 && !Number.isNaN(c);
  }
  if (data.result_code !== undefined && data.result_code !== null) {
    return String(data.result_code) === "1";
  }
  return false;
}

/**
 * 미션 템플릿과 모임 템플릿의 tpl_code 출처만 다르고, sender·API 3종은 동일 스킴
 */
export async function loadAligoAlimtalkConfig(
  db: Firestore,
  kind: AlimtalkTemplateKind
): Promise<AligoAlimtalkConfig> {
  const appConfigSnap = await db.collection(APP_CONFIG_COLLECTION).doc(ALIGO_CONFIG_DOC).get();
  const appConfig = appConfigSnap.exists ? appConfigSnap.data() ?? {} : {};

  const senderkey = scrubAligoCredential(String(process.env.ALIGO_SENDER_KEY || appConfig.senderkey || ""));
  const sender = scrubAligoCredential(String(process.env.ALIGO_SENDER || appConfig.sender || ""));
  const apikey = scrubAligoCredential(process.env.ALIGO_API_KEY);
  const userid = scrubAligoCredential(process.env.ALIGO_USER_ID);
  const token = scrubAligoCredential(process.env.ALIGO_TOKEN);

  let tplCode = "";
  if (kind === ALIMTALK_TEMPLATE.MISSION_SUBSCRIPTION) {
    tplCode = scrubAligoCredential(String(process.env.ALIGO_TPL_CODE || appConfig.tpl_code || ""));
  } else {
    tplCode = scrubAligoCredential(
      String(
        process.env.ALIGO_MEETUP_OPEN_TPL_CODE ||
          appConfig.meetup_open_tpl_code ||
          appConfig.meetupOpenTplCode ||
          DEFAULT_MEETUP_OPEN_TPL_CODE
      )
    );
  }

  if (kind === ALIMTALK_TEMPLATE.MEETUP_OFFLINE_OPEN && !tplCode) {
    throw new Error(
      "오프라인 모임 알림톡 템플릿 코드가 없습니다. ALIGO_MEETUP_OPEN_TPL_CODE 또는 appConfig/aligo.meetup_open_tpl_code 를 확인하세요."
    );
  }

  const missing: string[] = [];
  if (!senderkey) missing.push("senderkey(ALIGO_SENDER_KEY 또는 appConfig/aligo.senderkey)");
  if (!sender) missing.push("sender(ALIGO_SENDER 또는 appConfig/aligo.sender)");
  if (!tplCode) missing.push("tpl_code(ALIGO_TPL_CODE 또는 appConfig/aligo.tpl_code)");
  if (!apikey) missing.push("ALIGO_API_KEY(Secret)");
  if (!userid) missing.push("ALIGO_USER_ID(Secret)");
  if (!token) missing.push("ALIGO_TOKEN(Secret)");
  if (missing.length) {
    throw new Error(`알리고 설정 누락 [${kind}]: ${missing.join(" · ")}`);
  }

  logAligoAuthShape(`loadAligoAlimtalkConfig(${kind})`, apikey, userid, token);

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
 * aligoapi.alimtalkSend 공통 — 템플릿별로 emtitle/button env 키만 분기
 */
export async function sendAlimtalkUnified(
  cfg: AligoAlimtalkConfig,
  args: {
    receiverPhone: string;
    displayName: string;
    subject: string;
    message: string;
    templateKind: AlimtalkTemplateKind;
    /** 로그 태그 (선택) */
    logTag?: string;
  }
): Promise<void> {
  const tag = args.logTag || "[Aligo unified]";
  const receiver = normalizeReceiverPhoneDigits(args.receiverPhone);
  if (!receiver) {
    throw new Error("알림톡 수신자 번호가 비어 있습니다.");
  }
  const recvName = safeAlimtalkDisplayNameUnified(args.displayName || "");
  const messageOut = args.message.replace(/\r?\n/g, "\r\n");

  const body: Record<string, string> = {
    senderkey: cfg.senderkey,
    tpl_code: cfg.tpl_code,
    sender: cfg.sender,
    receiver_1: receiver,
    recvname_1: recvName,
    subject_1: args.subject,
    message_1: messageOut,
    failover: "N",
  };

  if (String(process.env.ALIGO_ALIMTALK_TEST_MODE || "").toUpperCase() === "Y") {
    body.testMode = "Y";
  }

  if (args.templateKind === ALIMTALK_TEMPLATE.MISSION_SUBSCRIPTION) {
    const em = String(process.env.ALIGO_ALIMTALK_EMTITLE_1 || "").trim();
    if (em) body.emtitle_1 = em;
    const btn = String(process.env.ALIGO_ALIMTALK_BUTTON_1 || "").trim();
    if (btn) body.button_1 = btn;
  } else {
    const em = String(process.env.ALIGO_MEETUP_ALIMTALK_EMTITLE_1 || "").trim();
    if (em) body.emtitle_1 = em;
    const btn = String(process.env.ALIGO_MEETUP_OPEN_BUTTON_1 || "").trim();
    if (btn) body.button_1 = btn;
  }

  console.log(
    `${tag} tpl=${cfg.tpl_code} kind=${args.templateKind} • 테스트(ALIGO_ALIMTALK_TEST_MODE)=${String(process.env.ALIGO_ALIMTALK_TEST_MODE || "").toUpperCase() || "미설정"}`
  );

  const req = { body, headers: { "content-type": "application/json" } };
  const authData = { apikey: cfg.apikey, userid: cfg.userid, token: cfg.token };
  const raw = (await aligoapi.alimtalkSend(req, authData)) as Record<string, unknown>;

  if (!isAligoAlimtalkApiSuccessUnified(raw)) {
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
    console.error(`${tag} alimtalkSend 실패:`, detail, hint || "");
    throw new Error(`알림톡 API 실패(code=${String(c)}): ${msg}${hint}`);
  }

  const info = raw.info as { mid?: string | number; scnt?: number; fcnt?: number; type?: string } | undefined;
  if (info && info.mid != null) {
    console.log(
      `${tag} 전송요청 수신 tpl=${cfg.tpl_code} type=${String(info.type ?? "AT")} mid=${String(info.mid)} scnt=${
        info.scnt ?? ""
      } fcnt=${info.fcnt ?? ""}`
    );
  }
}
