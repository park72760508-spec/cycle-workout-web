"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrubAligoCredential = scrubAligoCredential;
exports.aligoApiFailureHint = aligoApiFailureHint;
exports.logAligoAuthShape = logAligoAuthShape;
/**
 * 알리고 Secret/환경 변수 복사-붙여넣기 시 흔한 오류(BOM, 따옴표, 개행) 제거.
 * 값 자체는 로그에 남기지 않는다.
 */
function scrubAligoCredential(raw) {
    if (raw == null)
        return "";
    let s = String(raw).trim();
    if (s.charCodeAt(0) === 0xfeff) {
        s = s.slice(1).trim();
    }
    if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
        (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
        s = s.slice(1, -1).trim();
    }
    return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}
/**
 * 알림톡 API JSON 응답 code/message 기준 운영 힌트 (Firestore 로그·콘솔용)
 * @see https://kakaoapi.aligo.in/akv10/alimtalk/send/
 */
function aligoApiFailureHint(code, message) {
    const c = code === undefined || code === null ? "" : String(code).trim();
    const m = (message || "").trim();
    if (c === "-99" || c === "99" || Number(code) === -99) {
        if (m.includes("인증키") || m.includes("등록되지")) {
            return (" [조치] Firebase Secret ALIGO_API_KEY·ALIGO_USER_ID·ALIGO_TOKEN 재확인: " +
                "알리고 콘솔 「문자 API → 카카오톡 → 신청/인증」의 Identifier(=userid)·발급키(=apikey) 사용. " +
                "일반 문자(SMS) 전용 키와 혼동 금지. ALIGO_TOKEN은 임의 비밀번호가 아니라 " +
                "`POST .../akv10/token/create/{time}/{type}` 응답의 token 값(만료 시 재발급). " +
                "Secret 갱신 후 `firebase deploy --only functions` 로 반영. " +
                "발송 서버 IP가 알리고에 미등록이면 별도 오류가 날 수 있음(고정 egress IP 등록).");
        }
        return (" [조치] code=-99: 알리고 카카오 API 인증 실패. userid·apikey·token·발송 IP 등록을 콘솔에서 점검.");
    }
    return "";
}
/** 로그용: 비밀 값 노출 없이 길이만 (ALIGO_DEBUG_AUTH=1 일 때) */
function logAligoAuthShape(label, apikey, userid, token) {
    const on = String(process.env.ALIGO_DEBUG_AUTH || "").toLowerCase();
    if (on !== "1" && on !== "true" && on !== "yes")
        return;
    console.log(`[Aligo][${label}] cred lengths apikey=${apikey.length} userid=${userid.length} token=${token.length} useridOk=${userid.length > 0}`);
}
