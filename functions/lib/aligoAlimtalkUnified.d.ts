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
export declare const ALIMTALK_TEMPLATE: {
    /** 미션 달성·구독 연장 안내 (기본 템플릿 코드 UH_2120 계열 — env/appConfig 에서 로드) */
    readonly MISSION_SUBSCRIPTION: "mission_subscription";
    /** 오프라인 라이딩 모임 오픈 (UH_5528 계열 — meetup_* 키) */
    readonly MEETUP_OFFLINE_OPEN: "meetup_offline_open";
};
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
/** 빈 값·단일 비(문자/숫자) 기호 등 recvname 오류 유발값 방지 — PointReward·모임 동일 규칙 */
export declare function safeAlimtalkDisplayNameUnified(raw: unknown): string;
export declare function normalizeReceiverPhoneDigits(phone: string): string;
export declare function isAligoAlimtalkApiSuccessUnified(data: Record<string, unknown>): boolean;
/**
 * 미션 템플릿과 모임 템플릿의 tpl_code 출처만 다르고, sender·API 3종은 동일 스킴
 */
export declare function loadAligoAlimtalkConfig(db: Firestore, kind: AlimtalkTemplateKind): Promise<AligoAlimtalkConfig>;
/**
 * aligoapi.alimtalkSend 공통 — 템플릿별로 emtitle/button env 키만 분기
 */
export declare function sendAlimtalkUnified(cfg: AligoAlimtalkConfig, args: {
    receiverPhone: string;
    displayName: string;
    subject: string;
    message: string;
    templateKind: AlimtalkTemplateKind;
    /** 로그 태그 (선택) */
    logTag?: string;
}): Promise<void>;
