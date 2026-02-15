export interface ErrorReportPayload {
    subject: string;
    body: string;
    to?: string;
}
/**
 * 에러 리포트 메일 발송.
 * SMTP 설정이 없으면 로그만 남기고 완료 처리.
 */
export declare function sendErrorReport(payload: ErrorReportPayload): Promise<boolean>;
/**
 * 네이버 구독 매칭 실패 건 요약 리포트
 */
export declare function sendMatchingFailureReport(failures: Array<{
    productOrderId: string;
    orderId?: string;
    optionPhoneOrId: string | null;
    ordererTel: string | null;
    reason: string;
}>): Promise<boolean>;
