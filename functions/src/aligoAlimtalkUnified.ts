/**
 * 카카오 알림톡(알리고) 공통 레이어
 * - 라이딩 미션 달성·구독 연장(UH_2120 등, ALIGO_TPL_CODE / tpl_code)
 * - 오프라인 라이딩 모임 오픈(UH_5528 등, MEETUP_OPEN_TPL 코드)
 *
 * UH_2120 과 UH_5528 모두 다음이 동일해야 함(알리고 콘솔 카카오톡 API 키 1세트):
 * 발급키(apikey)·Identifier/userid(stelvioai 등)·발급 token·SenderKey·발신프로필(sender).
 * 차이는 tpl_code(subject·본문·선택 버튼 env) 만.
 *
 * (code=-99 은 카카오톡 API 측 「인증 실패」류 코드로, 알리고 응답 문구가 IP 중심이어도 키·token·userid 불일치로 동일 코드가 올 수 있음.)
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
  /** 알림톡 버튼 JSON (알리고 button_1 파라미터). 미설정 시 기본 '참석 하기' 버튼 적용 */
  button_1?: string;
}

/** 모임 알림톡 기본 버튼 — 환경변수·Firestore 미설정 시 필수 Fallback */
const DEFAULT_MEETUP_OPEN_BUTTON_1 = JSON.stringify({
  button: [
    {
      name: "참석 하기",
      linkType: "WL",
      linkTypeName: "웹링크",
      linkMo: "https://stelvio.ai",
      linkPc: "https://stelvio.ai",
    },
  ],
});

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

  const senderkey = scrubAligoCredential(
    String(process.env.ALIGO_SENDER_KEY || appConfig.senderkey || (appConfig as { senderKey?: unknown }).senderKey || "")
  );
  const sender = scrubAligoCredential(String(process.env.ALIGO_SENDER || appConfig.sender || ""));

  /** 발급키·token은 Secret만 (Firestore 비저장 원칙). Identifier(stelvioai 등)만 env 빈값일 때 appConfig identifier/userId 폴백 */
  const useridCfg = scrubAligoCredential(
    String(
      (appConfig as { userid?: unknown }).userid ??
        (appConfig as { userId?: unknown }).userId ??
        (appConfig as { identifier?: unknown }).identifier ??
        ""
    )
  );

  const apikeyEnv = scrubAligoCredential(process.env.ALIGO_API_KEY);
  const useridEnv = scrubAligoCredential(process.env.ALIGO_USER_ID);
  const tokenEnv = scrubAligoCredential(process.env.ALIGO_TOKEN);

  const apikey = apikeyEnv;
  const userid = useridEnv || useridCfg;
  const token = tokenEnv;

  if (useridEnv && useridCfg && useridEnv.toLowerCase() !== useridCfg.toLowerCase()) {
    console.warn(
      `[loadAligoAlimtalkConfig] ALIGO_USER_ID(Secret)와 appConfig/aligo 의 identifier/userid 불일치 — Secret값으로 발송합니다. kind=${kind}`
    );
  }

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

  // ── button_1: MEETUP_OFFLINE_OPEN 전용 ──────────────────────────────────
  // 우선순위: env(ALIGO_MEETUP_OPEN_BUTTON_1) > Firestore(appConfig/aligo.meetup_open_button_1)
  //           > 기본값(DEFAULT_MEETUP_OPEN_BUTTON_1 — '참석 하기' 웹링크 버튼)
  let button1: string | undefined;
  if (kind === ALIMTALK_TEMPLATE.MEETUP_OFFLINE_OPEN) {
    button1 = String(
      process.env.ALIGO_MEETUP_OPEN_BUTTON_1 ||
        (appConfig as { meetup_open_button_1?: unknown }).meetup_open_button_1 ||
        (appConfig as { meetupOpenButton1?: unknown }).meetupOpenButton1 ||
        DEFAULT_MEETUP_OPEN_BUTTON_1
    ).trim();
  }

  const missing: string[] = [];
  if (!senderkey) missing.push("senderkey(ALIGO_SENDER_KEY 또는 appConfig/aligo.senderkey)");
  if (!sender) missing.push("sender(ALIGO_SENDER 또는 appConfig/aligo.sender)");
  if (!tplCode) missing.push("tpl_code(ALIGO_TPL_CODE 또는 appConfig/aligo.tpl_code 등)");
  if (!apikey) missing.push("ALIGO_API_KEY(Secret, 카카오톡 API 발급키)");
  if (!userid) missing.push("ALIGO_USER_ID(Secret 또는 appConfig/aligo.identifier) — 예: stelvioai");
  if (!token) missing.push("ALIGO_TOKEN(Secret, 카카오톡 API token)");
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
    ...(button1 !== undefined ? { button_1: button1 } : {}),
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

  /**
   * 줄바꿈 정책:
   *   MISSION_SUBSCRIPTION → \r\n (CRLF): 알리고에 CRLF로 등록된 UH_2120 계열
   *   MEETUP_OFFLINE_OPEN  → \n   (LF):   알리고에 LF로 등록된 UH_5528 계열
   * ※ 미션은 CRLF로 정상 수신 확인됨. 모임은 구조 동일 메시지임에도 지속 실패하여
   *    LF 전환으로 원인 검증.
   */
  const messageOut =
    args.templateKind === ALIMTALK_TEMPLATE.MEETUP_OFFLINE_OPEN
      ? args.message.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      : args.message.replace(/\r?\n/g, "\r\n");

  console.log(
    `${args.logTag || "[Aligo unified]"} message_1 진단 (앞80자): ${JSON.stringify(messageOut.slice(0, 80))}`
  );

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
    // MEETUP_OFFLINE_OPEN: emtitle(선택) + button_1(필수 — loadAligoAlimtalkConfig 에서 기본값 보장)
    const em = String(process.env.ALIGO_MEETUP_ALIMTALK_EMTITLE_1 || "").trim();
    if (em) body.emtitle_1 = em;
    if (cfg.button_1) body.button_1 = cfg.button_1;
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
