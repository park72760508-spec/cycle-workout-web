"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALIMTALK_TEMPLATE = void 0;
exports.safeAlimtalkDisplayNameUnified = safeAlimtalkDisplayNameUnified;
exports.normalizeReceiverPhoneDigits = normalizeReceiverPhoneDigits;
exports.isAligoAlimtalkApiSuccessUnified = isAligoAlimtalkApiSuccessUnified;
exports.loadAligoAlimtalkConfig = loadAligoAlimtalkConfig;
exports.sendAlimtalkUnified = sendAlimtalkUnified;
const aligoCredentials_1 = require("./aligoCredentials");
const aligoapi = require("aligoapi");
const APP_CONFIG_COLLECTION = "appConfig";
const ALIGO_CONFIG_DOC = "aligo";
const DEFAULT_MEETUP_OPEN_TPL_CODE = "UH_5528";
exports.ALIMTALK_TEMPLATE = {
    /** 미션 달성·구독 연장 안내 (기본 템플릿 코드 UH_2120 계열 — env/appConfig 에서 로드) */
    MISSION_SUBSCRIPTION: "mission_subscription",
    /** 오프라인 라이딩 모임 오픈 (UH_5528 계열 — meetup_* 키) */
    MEETUP_OFFLINE_OPEN: "meetup_offline_open",
};
/**
 * 모임 알림톡 기본 버튼 — 환경변수(ALIGO_MEETUP_OPEN_BUTTON_1) 또는
 * Firestore(appConfig/aligo.meetup_open_button_1) 미설정 시 자동 적용되는 Fallback.
 *
 * ⚠️ 아래 값은 카카오 채널 관리자 센터에 실제 승인된 버튼 정보와 한 글자도 틀리면 안 됩니다.
 *
 *  [반드시 확인해야 할 3가지]
 *  1) name     : 카카오 채널 관리자 센터에 등록된 버튼명 그대로.
 *                "참석 하기"(띄어쓰기 있음) vs "참석하기"(없음) — 완전히 일치해야 함.
 *                현재 기본값: "참석하기" (띄어쓰기 없음)
 *  2) linkType : "WL" = 웹링크, "AL" = 앱링크 — 등록된 버튼 타입과 반드시 일치.
 *                현재 기본값: "WL" (웹링크)
 *  3) URL      : linkMo(모바일) / linkPc(PC) — 등록 시 입력한 URL 그대로.
 *
 *  위 값이 실제 등록 정보와 다를 경우 "메시지가 템플릿과 일치하지않음" 에러가 발생합니다.
 *  실제 버튼명이 "참석 하기"(띄어쓰기 있음)라면 name 값을 "참석 하기"로 변경하세요.
 */
const DEFAULT_MEETUP_OPEN_BUTTON_1 = JSON.stringify({
    button: [
        {
            name: "참석하기",
            linkType: "WL",
            linkTypeName: "웹링크",
            linkMo: "https://stelvio.ai.kr",
            linkPc: "https://stelvio.ai.kr",
        },
    ],
});
/** 빈 값·단일 비(문자/숫자) 기호 등 recvname 오류 유발값 방지 — PointReward·모임 동일 규칙 */
function safeAlimtalkDisplayNameUnified(raw) {
    const t = String(raw ?? "").trim();
    if (!t)
        return "회원";
    if (t.length === 1 && /[^\p{L}\p{N}]/u.test(t))
        return "회원";
    return t;
}
function normalizeReceiverPhoneDigits(phone) {
    return String(phone || "").replace(/\D/g, "");
}
function isAligoAlimtalkApiSuccessUnified(data) {
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
async function loadAligoAlimtalkConfig(db, kind) {
    const appConfigSnap = await db.collection(APP_CONFIG_COLLECTION).doc(ALIGO_CONFIG_DOC).get();
    const appConfig = appConfigSnap.exists ? appConfigSnap.data() ?? {} : {};
    const senderkey = (0, aligoCredentials_1.scrubAligoCredential)(String(process.env.ALIGO_SENDER_KEY || appConfig.senderkey || appConfig.senderKey || ""));
    const sender = (0, aligoCredentials_1.scrubAligoCredential)(String(process.env.ALIGO_SENDER || appConfig.sender || ""));
    /** 발급키·token은 Secret만 (Firestore 비저장 원칙). Identifier(stelvioai 등)만 env 빈값일 때 appConfig identifier/userId 폴백 */
    const useridCfg = (0, aligoCredentials_1.scrubAligoCredential)(String(appConfig.userid ??
        appConfig.userId ??
        appConfig.identifier ??
        ""));
    const apikeyEnv = (0, aligoCredentials_1.scrubAligoCredential)(process.env.ALIGO_API_KEY);
    const useridEnv = (0, aligoCredentials_1.scrubAligoCredential)(process.env.ALIGO_USER_ID);
    const tokenEnv = (0, aligoCredentials_1.scrubAligoCredential)(process.env.ALIGO_TOKEN);
    const apikey = apikeyEnv;
    const userid = useridEnv || useridCfg;
    const token = tokenEnv;
    if (useridEnv && useridCfg && useridEnv.toLowerCase() !== useridCfg.toLowerCase()) {
        console.warn(`[loadAligoAlimtalkConfig] ALIGO_USER_ID(Secret)와 appConfig/aligo 의 identifier/userid 불일치 — Secret값으로 발송합니다. kind=${kind}`);
    }
    let tplCode = "";
    if (kind === exports.ALIMTALK_TEMPLATE.MISSION_SUBSCRIPTION) {
        tplCode = (0, aligoCredentials_1.scrubAligoCredential)(String(process.env.ALIGO_TPL_CODE || appConfig.tpl_code || ""));
    }
    else {
        tplCode = (0, aligoCredentials_1.scrubAligoCredential)(String(process.env.ALIGO_MEETUP_OPEN_TPL_CODE ||
            appConfig.meetup_open_tpl_code ||
            appConfig.meetupOpenTplCode ||
            DEFAULT_MEETUP_OPEN_TPL_CODE));
    }
    if (kind === exports.ALIMTALK_TEMPLATE.MEETUP_OFFLINE_OPEN && !tplCode) {
        throw new Error("오프라인 모임 알림톡 템플릿 코드가 없습니다. ALIGO_MEETUP_OPEN_TPL_CODE 또는 appConfig/aligo.meetup_open_tpl_code 를 확인하세요.");
    }
    // ── button_1: MEETUP_OFFLINE_OPEN 전용 ──────────────────────────────────
    // 우선순위: env(ALIGO_MEETUP_OPEN_BUTTON_1) > Firestore(appConfig/aligo.meetup_open_button_1)
    //           > 기본값(DEFAULT_MEETUP_OPEN_BUTTON_1 — '참석 하기' 웹링크 버튼)
    let button1;
    if (kind === exports.ALIMTALK_TEMPLATE.MEETUP_OFFLINE_OPEN) {
        button1 = String(process.env.ALIGO_MEETUP_OPEN_BUTTON_1 ||
            appConfig.meetup_open_button_1 ||
            appConfig.meetupOpenButton1 ||
            DEFAULT_MEETUP_OPEN_BUTTON_1).trim();
    }
    const missing = [];
    if (!senderkey)
        missing.push("senderkey(ALIGO_SENDER_KEY 또는 appConfig/aligo.senderkey)");
    if (!sender)
        missing.push("sender(ALIGO_SENDER 또는 appConfig/aligo.sender)");
    if (!tplCode)
        missing.push("tpl_code(ALIGO_TPL_CODE 또는 appConfig/aligo.tpl_code 등)");
    if (!apikey)
        missing.push("ALIGO_API_KEY(Secret, 카카오톡 API 발급키)");
    if (!userid)
        missing.push("ALIGO_USER_ID(Secret 또는 appConfig/aligo.identifier) — 예: stelvioai");
    if (!token)
        missing.push("ALIGO_TOKEN(Secret, 카카오톡 API token)");
    if (missing.length) {
        throw new Error(`알리고 설정 누락 [${kind}]: ${missing.join(" · ")}`);
    }
    (0, aligoCredentials_1.logAligoAuthShape)(`loadAligoAlimtalkConfig(${kind})`, apikey, userid, token);
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
async function sendAlimtalkUnified(cfg, args) {
    const tag = args.logTag || "[Aligo unified]";
    const receiver = normalizeReceiverPhoneDigits(args.receiverPhone);
    if (!receiver) {
        throw new Error("알림톡 수신자 번호가 비어 있습니다.");
    }
    const recvName = safeAlimtalkDisplayNameUnified(args.displayName || "");
    // 카카오 알림톡 표준 줄바꿈: CRLF(\r\n) 통일 — 모든 템플릿 동일 적용
    const messageOut = args.message.replace(/\r?\n/g, "\r\n");
    console.log(`${args.logTag || "[Aligo unified]"} message_1 진단 (앞80자): ${JSON.stringify(messageOut.slice(0, 80))}`);
    const body = {
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
    if (args.templateKind === exports.ALIMTALK_TEMPLATE.MISSION_SUBSCRIPTION) {
        const em = String(process.env.ALIGO_ALIMTALK_EMTITLE_1 || "").trim();
        if (em)
            body.emtitle_1 = em;
        const btn = String(process.env.ALIGO_ALIMTALK_BUTTON_1 || "").trim();
        if (btn)
            body.button_1 = btn;
    }
    else {
        // MEETUP_OFFLINE_OPEN: emtitle(선택) + button_1(필수 — loadAligoAlimtalkConfig 에서 기본값 보장)
        const em = String(process.env.ALIGO_MEETUP_ALIMTALK_EMTITLE_1 || "").trim();
        if (em)
            body.emtitle_1 = em;
        if (cfg.button_1)
            body.button_1 = cfg.button_1;
    }
    console.log(`${tag} tpl=${cfg.tpl_code} kind=${args.templateKind} • 테스트(ALIGO_ALIMTALK_TEST_MODE)=${String(process.env.ALIGO_ALIMTALK_TEST_MODE || "").toUpperCase() || "미설정"}`);
    const req = { body, headers: { "content-type": "application/json" } };
    const authData = { apikey: cfg.apikey, userid: cfg.userid, token: cfg.token };
    const raw = (await aligoapi.alimtalkSend(req, authData));
    if (!isAligoAlimtalkApiSuccessUnified(raw)) {
        let detail = "";
        try {
            detail = JSON.stringify(raw);
        }
        catch {
            detail = String(raw);
        }
        const msg = String(raw.message ??
            raw.Message ??
            "알 수 없는 응답");
        const c = raw?.code ?? raw?.result_code;
        const hint = (0, aligoCredentials_1.aligoApiFailureHint)(c, msg);
        console.error(`${tag} alimtalkSend 실패:`, detail, hint || "");
        throw new Error(`알림톡 API 실패(code=${String(c)}): ${msg}${hint}`);
    }
    const info = raw.info;
    if (info && info.mid != null) {
        console.log(`${tag} 전송요청 수신 tpl=${cfg.tpl_code} type=${String(info.type ?? "AT")} mid=${String(info.mid)} scnt=${info.scnt ?? ""} fcnt=${info.fcnt ?? ""}`);
    }
}
