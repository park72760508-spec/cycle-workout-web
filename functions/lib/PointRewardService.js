"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PointRewardService = void 0;
const admin = __importStar(require("firebase-admin"));
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
/** 알리고/카카오 승인 알림톡 제목(subject_1) — 본문 첫째 줄 […]과 짝 */
const ALIMTALK_SUBJECT_KO = "STELVIO 라이딩 미션 달성 및 구독 연장 안내";
/** Firestore/문자/Date → Asia/Seoul 달력 YYYY-MM-DD (Strava·실내 `saveTrainingSession`과 동일 스킴) */
function toYmdSeoul(value) {
    if (value == null || value === "")
        return "";
    if (typeof value === "string") {
        const trimmed = value.trim();
        // YYYY-MM-DD 형식 (정상)
        const m1 = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m1)
            return m1[0];
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
    const ts = value;
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
    if (!raw)
        return "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime()))
        return "";
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(parsed);
}
function ymdTodaySeoul() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
function ymdCompare(a, b) {
    if (!a || !b)
        return 0;
    return a < b ? -1 : a > b ? 1 : 0;
}
/** KST YMD에 calendar days일 더함 (toISOString UTC + 로컬 Date 혼용 금지) */
function addCalendarDaysYmdSeoul(ymd, days) {
    if (!ymd || !/^(\d{4})-(\d{2})-(\d{2})$/.test(ymd))
        return ymd;
    const t = new Date(`${ymd}T00:00:00+09:00`);
    if (Number.isNaN(t.getTime()))
        return ymd;
    t.setTime(t.getTime() + days * 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(t);
}
/**
 * rem+TSS로 extensionDays만큼 구독 끝을 연장할 때, 연장 직전 기준일(before)과 연장 반영 후(after).
 * - 만료일이 오늘(Seoul) 이전이면 기준을 오늘로 맞춤 (기존 computeExtendedExpiryDate와 동일 의도).
 * - 만료일이 비어 있으면 오늘(Seoul)을 기준으로 둠.
 */
function computeSubscriptionExpiryBeforeAfterSeoul(userExpiryRaw, extensionDays) {
    const todayYmd = ymdTodaySeoul();
    let baseYmd = toYmdSeoul(userExpiryRaw);
    if (!baseYmd) {
        baseYmd = todayYmd;
    }
    if (ymdCompare(baseYmd, todayYmd) < 0) {
        baseYmd = todayYmd;
    }
    const before = baseYmd;
    const after = extensionDays > 0 ? addCalendarDaysYmdSeoul(before, extensionDays) : before;
    return { before, after };
}
/** 한국형 날짜 포맷: YYYY년 MM월 DD일 (Seoul YMD 기준) */
function formatDateKo(value) {
    const ymd = toYmdSeoul(value);
    if (!ymd)
        return "-";
    const [y, m, d] = ymd.split("-");
    return `${y}년 ${m}월 ${d}일`;
}
/** 휴대폰 숫자만 추출하여 알림톡 수신자 형태(11자리)로 정규화 */
function normalizeReceiverPhone(phone) {
    return (phone || "").replace(/\D/g, "");
}
function getReceiverPhoneFromUserData(userData) {
    return String(userData.contact ??
        userData.phoneNumber ??
        userData.phone ??
        userData.tel ??
        userData.mobile ??
        userData.phone_number ??
        "").trim();
}
/** Firestore Int/Long/문자 등 → 정수 (subscription_extended_days 등) */
function coerceToInt(value, defaultVal = 0) {
    if (value === null || value === undefined)
        return defaultVal;
    if (typeof value === "number" && Number.isFinite(value))
        return Math.trunc(value);
    if (typeof value === "boolean")
        return value ? 1 : 0;
    if (typeof value === "bigint")
        return Number(value);
    if (typeof value === "string" && value.trim() !== "") {
        const n = parseInt(value, 10);
        return Number.isNaN(n) ? defaultVal : n;
    }
    const withToNumber = value;
    if (typeof withToNumber?.toNumber === "function") {
        try {
            const n = withToNumber.toNumber();
            return Number.isFinite(n) ? Math.trunc(n) : defaultVal;
        }
        catch {
            /* ignore */
        }
    }
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : defaultVal;
}
function diffCalendarDaysSeoulYmd(ymdBefore, ymdAfter) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymdBefore) || !/^\d{4}-\d{2}-\d{2}$/.test(ymdAfter))
        return 0;
    const t0 = new Date(`${ymdBefore}T00:00:00+09:00`).getTime();
    const t1 = new Date(`${ymdAfter}T00:00:00+09:00`).getTime();
    if (Number.isNaN(t0) || Number.isNaN(t1))
        return 0;
    return Math.round((t1 - t0) / (24 * 60 * 60 * 1000));
}
/** SP 표시: 부동소수 오차 제거(알림톡 본문이 검수 템플릿과 글자 단위로 일치해야 함) */
function formatSpForKakaoTemplate(n) {
    if (!Number.isFinite(n))
        return "0";
    const rounded = Math.round(n * 100) / 100;
    if (Number.isInteger(rounded))
        return String(rounded);
    return rounded.toFixed(2);
}
/**
 * 카카오/알리고 승인 템플릿 본문과 동일(줄바꿈·이모지 포함)해야 발송 성공.
 * 이모지(🚴‍♂️)는 승인서에 있으면 그대로 둔다(검수에 없는데 넣으면 거절).
 */
function buildAlimtalkMessage(params) {
    // 기존 만료일·변경 만료일 모두 YYYY-MM-DD 형식으로 통일
    const beforeLine = toYmdSeoul(params.expiryDateBefore) || "-";
    const afterLine = toYmdSeoul(params.expiryDateAfter) || "-";
    return `[STELVIO 라이딩 미션 달성 및 구독 연장 안내]
안녕하세요 ${params.userName}님,
오늘도 STELVIO와 함께 멋진 라이딩 미션을 완료하셨습니다! 🚴‍♂️

이번 라이딩(TSS) 달성 보상으로 포인트가 적립되었으며, 보유하신 포인트가 기준치에 도달하여 구독 기간이 자동으로 연장되었습니다.

▶ 이번 라이딩 보상
획득 포인트 : ${params.earnedPoints} SP

▶ 구독 연장 혜택 적용
500 SP 자동 사용으로 인하여 구독 기간이 ${params.extendedDays}일 추가 연장되었습니다.

기존 만료일 : ${beforeLine}
변경 만료일 : ${afterLine}

▶ 내 포인트 현황
사용 후 잔여 포인트 : ${formatSpForKakaoTemplate(params.remPointsAfter)} SP

오늘 흘린 땀방울이 성장의 밑거름이 됩니다. 다음 훈련에서 뵙겠습니다!

※ 이 메시지는 고객님이 참여하신 STELVIO 라이딩 미션(이벤트) 달성에 따라 지급된 포인트 안내 메시지입니다.`;
}
/** 검수 템플릿에 이모지가 없으면 ALIGO/Kakao에서 거절될 수 있음 → env로 제거 가능 */
function maybeStripAlimtalkEmojiForTemplate(message) {
    const strip = String(process.env.KAKAO_ALIMTALK_STRIP_EMOJI || "").toLowerCase();
    if (strip === "1" || strip === "true" || strip === "yes") {
        return message.replace(/\p{Extended_Pictographic}/gu, "").replace(/\u200d/g, "");
    }
    return message;
}
/**
 * Aligo 문서 [Notice] 2: "알림톡 내용(message)은 템플릿과 동일하게 개행문자를 입력하셔야 합니다."
 * 카카오 검수 시 저장된 개행이 CRLF(`\r\n`)인 경우가 많아, LF만 보내면 "템플릿과 일치하지 않음"이 난다.
 * `ALIGO_ALIMTALK_LF_ONLY=1` 이면 변환 생략(검수본이 LF일 때).
 */
function normalizeAlimtalkNewlinesForKakaoTemplate(message) {
    const lfOnly = String(process.env.ALIGO_ALIMTALK_LF_ONLY || "").toLowerCase();
    if (lfOnly === "1" || lfOnly === "true" || lfOnly === "yes") {
        return message;
    }
    return message.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").join("\r\n");
}
/**
 * POST /akv10/alimtalk/send/ 응답: 성공 시 `code` 는 Integer 0, message 예: "성공적으로 전송요청 하였습니다."
 * (구 SMS 연동 result_code=1 는 본 API와 혼용되지 않음 — alimtalk 전용이면 code만 본다)
 */
function isAligoAlimtalkApiSuccess(data) {
    if (data.code !== undefined && data.code !== null) {
        const c = Number(data.code);
        return c === 0 && !Number.isNaN(c);
    }
    if (data.result_code !== undefined && data.result_code !== null) {
        return String(data.result_code) === "1";
    }
    return false;
}
class PointRewardService {
    constructor(db) {
        this.db = db;
    }
    /** Strava Secret 패턴과 동일하게 env + appConfig(aligo) 조합으로 설정 로딩 */
    async loadAligoConfig() {
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
     * aligoapi.alimtalkSend(req, auth) — body + auth( apikey, userid, token ) form 합쳐 POST
     * 공식 필수: senderkey, tpl_code, sender, receiver_1, subject_1, message_1
     * 선택: recvname_1, senddate, emtitle_1, button_1, failover, fsubject_1, fmessage_1, testMode
     * failover=Y 일 때 fsubject_1, fmessage_1 필수 — 본 구현은 failover N(대체문자 없음)
     * @see https://kakaoapi.aligo.in/akv10/alimtalk/send/
     */
    async sendAlimtalk(receiverPhone, displayName, subject, message) {
        const cfg = await this.loadAligoConfig();
        const receiver = normalizeReceiverPhone(receiverPhone);
        if (!receiver) {
            throw new Error("알림톡 수신자 번호가 비어 있습니다.");
        }
        const recvName = (displayName || "회원").trim() || "회원";
        let messageOut = maybeStripAlimtalkEmojiForTemplate(message);
        messageOut = normalizeAlimtalkNewlinesForKakaoTemplate(messageOut);
        const body = {
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
        const raw = (await aligoapi.alimtalkSend(req, authData));
        if (!isAligoAlimtalkApiSuccess(raw)) {
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
            console.error("[Aligo] alimtalkSend 비성공 응답:", detail);
            throw new Error(`알림톡 API 실패(code=${String(c)}): ${msg}`);
        }
        const info = raw.info;
        if (info && info.mid != null) {
            console.log(`[Aligo] alimtalk 전송요청 수신 type=${String(info.type ?? "AT")} mid=${String(info.mid)} scnt=${info.scnt ?? ""} fcnt=${info.fcnt ?? ""}`);
        }
    }
    /**
     * 인도어 세션 종료 / Strava 업로드 완료 시 호출되는 메인 함수
     * - 포인트 누적
     * - 기준치(500SP) 충족 시 자동 차감 + 구독 연장
     * - point_history 기록
     * - 필요 시 알림톡 발송
     */
    async processRidingReward(userId, tss, isStrava) {
        if (!userId || !userId.trim()) {
            throw new Error("userId가 비어 있습니다.");
        }
        if (!Number.isFinite(tss) || tss < 0) {
            throw new Error("tss는 0 이상의 숫자여야 합니다.");
        }
        const earnedPoints = Math.max(0, Math.floor(tss * POINTS_PER_TSS));
        const userRef = this.db.collection(USERS_COLLECTION).doc(userId);
        const pointHistoryRef = this.db.collection(POINT_HISTORY_COLLECTION).doc();
        const txResult = await this.db.runTransaction(async (tx) => {
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
            const { before: expiryDateBefore, after: expiryDateAfter } = computeSubscriptionExpiryBeforeAfterSeoul(expiryRaw, extendedDays);
            const currentAccPoints = Number(userData.acc_points || 0);
            const updatePayload = {
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
        let alimtalkSkip = txResult.result.extendedDays > 0 ? null : "no_subscription_extension";
        let alimtalkError = null;
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
    async appendPointHistoryForStelvioClientMileage(userId, logData, trainingLogId) {
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
        const earnedPoints = logData.earned_points != null && String(logData.earned_points) !== ""
            ? Math.max(0, coerceToInt(logData.earned_points))
            : Math.max(0, Math.floor(tss * POINTS_PER_TSS));
        const remAfter = Math.round(coerceToInt(userData.rem_points) || Number(userData.rem_points) || 0);
        let expiryDateBefore = String(logData.subscription_expiry_date_before ?? "").trim();
        let expiryDateAfter = String(logData.subscription_expiry_date_after ?? "").trim();
        if (!expiryDateBefore) {
            expiryDateBefore = toYmdSeoul(userData.expiry_date ?? userData.subscription_end_date ?? "");
        }
        if (!expiryDateAfter) {
            expiryDateAfter = toYmdSeoul(userData.expiry_date ?? userData.subscription_end_date ?? "");
        }
        const extendedFromLog = coerceToInt(logData.subscription_extended_days);
        const fromDateDiff = expiryDateBefore && expiryDateAfter
            ? diffCalendarDaysSeoulYmd(expiryDateBefore, expiryDateAfter)
            : 0;
        const extendedDays = Math.max(extendedFromLog, fromDateDiff, 0);
        const pointsUsed = extendedDays * SUBSCRIPTION_POINT_THRESHOLD;
        let pointsBefore = Math.round(remAfter - earnedPoints + pointsUsed);
        if (pointsBefore < 0) {
            console.warn(`[PointReward] appendPointHistoryForStelvioClientMileage: pointsBefore<0 → 0 보정 userId=${userId} logId=${trainingLogId}`, { remAfter, earnedPoints, pointsBefore, extendedDays, extendedFromLog, fromDateDiff });
            pointsBefore = 0;
        }
        const pointsAfter = remAfter;
        const userName = String(userData.name || userData.user_name || "회원").trim() || "회원";
        const receiverPhone = getReceiverPhoneFromUserData(userData);
        const historyDocId = `stelvio_mileage_${userId}_${trainingLogId}`.replace(/[/#]/g, "_");
        const pointHistoryRef = this.db.collection(POINT_HISTORY_COLLECTION).doc(historyDocId);
        await pointHistoryRef.set({
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
        }, { merge: true });
        const alimtalkPayload = extendedDays > 0
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
    async sendStelvioIndoorAlimtalkFromPayload(payload) {
        if (!payload) {
            return { alimtalkSent: false, skipped: "no_subscription_extension" };
        }
        if (payload.extendedDays <= 0) {
            return { alimtalkSent: false, skipped: "no_subscription_extension" };
        }
        if (!normalizeReceiverPhone(payload.receiverPhone)) {
            console.warn(`[PointReward] userId=${payload.userId} 구독 연장 알림톡 생략: users에 휴대전화 없음 (contact·phone·mobile 등)`);
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
        }
        catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            console.error(`[PointReward] stelvio indoor 알림톡 API userId=${payload.userId}:`, err);
            return { alimtalkSent: false, skipped: "aligo_error", errorDetail: m };
        }
    }
}
exports.PointRewardService = PointRewardService;
