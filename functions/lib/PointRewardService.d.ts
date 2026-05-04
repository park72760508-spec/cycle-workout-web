import type { Firestore } from "firebase-admin/firestore";
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
export declare class PointRewardService {
    private readonly db;
    constructor(db: Firestore);
    /** Strava Secret 패턴과 동일하게 env + appConfig(aligo) 조합으로 설정 로딩 */
    private loadAligoConfig;
    /**
     * aligoapi.alimtalkSend(req, auth) — body + auth( apikey, userid, token ) form 합쳐 POST
     * 공식 필수: senderkey, tpl_code, sender, receiver_1, subject_1, message_1
     * 선택: recvname_1, senddate, emtitle_1, button_1, failover, fsubject_1, fmessage_1, testMode
     * failover=Y 일 때 fsubject_1, fmessage_1 필수 — 본 구현은 failover N(대체문자 없음)
     * @see https://kakaoapi.aligo.in/akv10/alimtalk/send/
     */
    private sendAlimtalk;
    /**
     * 인도어 세션 종료 / Strava 업로드 완료 시 호출되는 메인 함수
     * - 포인트 누적
     * - 기준치(500SP) 충족 시 자동 차감 + 구독 연장
     * - point_history 기록
     * - 필요 시 알림톡 발송
     */
    processRidingReward(userId: string, tss: number, isStrava: boolean): Promise<ProcessRidingRewardResult>;
    /**
     * `saveTrainingSession`이 먼저 `users`를 갱신한 뒤이므로 `processRidingReward`를 쓰지 않는 대신
     * `point_history`만 남긴다(이중 적립 방지). rem은 클라이언트 기준, 이전 rem은 역산.
     * 문서 id를 `stelvio_mileage_{userId}_{logId}`로 고정해 트리거 재시도 시 중복 기록을 방지한다.
     */
    appendPointHistoryForStelvioClientMileage(userId: string, logData: Record<string, unknown>, trainingLogId: string): Promise<StelvioMileageAppendResult>;
    /**
     * `appendPointHistoryForStelvioClientMileage`의 `alimtalkPayload`로만 발송(훈련 로그 재파싱·타입 이슈 제거).
     * API 실패 시 예외를 던지지 않고 `aligo_error` + errorDetail로 반환(Functions가 멈추지 않음).
     */
    sendStelvioIndoorAlimtalkFromPayload(payload: StelvioIndoorAlimtalkPayload | null): Promise<StelvioIndoorAlimtalkSendResult>;
}
export {};
