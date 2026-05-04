export interface ErrorReportPayload {
    /** 제목에 들어갈 에러 유형 (예: 매칭 실패, 취소 처리 실패) */
    errorType: string;
    /** 본문 텍스트 (HTML 없이 사용 시) */
    body?: string;
    /** HTML 본문 (지정 시 body 대신 사용) */
    html?: string;
    /** 수신자 (미지정 시 ADMIN_EMAIL) */
    to?: string;
}
/**
 * 시스템 알림 메일 발송.
 * 제목: [STELVIO AI] 시스템 알림 - {errorType}
 * SMTP 미설정 시 로그만 남기고 완료 처리.
 */
export declare function sendErrorReport(payload: ErrorReportPayload): Promise<boolean>;
/** 실패한 주문 번호·시도한 연락처·사유 (매칭 실패 알림용) */
export interface FailureEmailPayload {
    productOrderId: string;
    orderId?: string;
    ordererName?: string | null;
    ordererTel?: string | null;
    shippingMemo?: string | null;
    triedNumbers?: string[];
    reason: string;
}
/**
 * 유저 매칭 실패 시 관리자에게 HTML 메일 발송.
 * 발생 시각, 주문번호, 시도한 연락처(1~3순위), 매칭 실패 사유 포함.
 */
export declare function sendFailureEmail(failures: FailureEmailPayload[]): Promise<boolean>;
/**
 * 취소/반품(구독 회수) 처리 실패 시 관리자에게 알림 발송.
 */
export declare function sendRevokeFailureReport(productOrderId: string, errorMessage: string): Promise<boolean>;
/**
 * SMTP 설정 완료 테스트 메일 발송.
 * 수신: ADMIN_EMAIL (관리자 Gmail). 테스트 엔드포인트에서 호출.
 */
export declare function sendSmtpTestEmail(): Promise<boolean>;
/** @deprecated sendFailureEmail 사용 권장 */
export declare function sendMatchingFailureReport(failures: Array<{
    productOrderId: string;
    orderId?: string;
    optionPhoneOrId: string | null;
    ordererTel: string | null;
    reason: string;
}>): Promise<boolean>;
