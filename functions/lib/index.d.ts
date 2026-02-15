/** 1회 동기화 실행 */
export declare function runNaverSubscriptionSync(clientSecret: string): Promise<void>;
/**
 * 30분마다 실행되는 스케줄러.
 * NAVER_CLIENT_SECRET 은 Firebase Secret Manager 또는 환경변수에 설정.
 */
export declare const naverSubscriptionSyncSchedule: import("firebase-functions/v2/scheduler").ScheduleFunction;
