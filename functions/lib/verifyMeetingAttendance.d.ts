/**
 * 라이딩 모임 참석 검증: Strava 활동 스트림(latlng, time) + 집결지 반경 200m + 모임 시각 ±1시간
 */
import * as admin from "firebase-admin";
import type { SecretParam } from "firebase-functions/lib/params/types";
export type MeetingParticipantStatus = "APPLIED" | "ATTENDED" | "MISSED";
export interface VerifyMeetingAttendanceUserDetail {
    userId: string;
    participantDocId: string;
    outcome: "ATTENDED" | "MISSED" | "SKIPPED";
    note?: string;
}
export interface VerifyMeetingAttendanceResult {
    success: true;
    meetingId: string;
    processedCount: number;
    attendedCount: number;
    missedCount: number;
    skippedCount: number;
    details: VerifyMeetingAttendanceUserDetail[];
}
/**
 * Haversine 공식: 두 위경도 좌표 간 거리 (미터)
 */
export declare function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number;
interface StravaStreamSet {
    latlng: [number, number][];
    timeSec: number[];
}
/**
 * Strava Activity Streams: latlng, time (초 단위, 활동 시작 기준)
 */
export declare function fetchActivityLatLngTimeStreams(accessToken: string, activityId: string): Promise<StravaStreamSet | null>;
/**
 * meetings 또는 rides(eventId)에 대한 참석 검증 실행.
 * @param callerUid null 이면 방장 검사 생략(일괄 스케줄러 전용). 문자열이면 해당 uid 가 방장과 일치해야 함.
 */
export declare function executeVerifyAttendanceForEventId(db: admin.firestore.Firestore, eventId: string, clientSecretTrim: string, callerUid: string | null): Promise<VerifyMeetingAttendanceResult>;
/**
 * Callable 팩토리: Strava client secret 파라미터를 엔트리(index.ts)와 공유
 * - 호출자는 로그인 필수, 모임 `hostUserId` 와 동일한 uid 만 실행 가능
 */
export declare function createVerifyMeetingAttendance(stravaClientSecret: SecretParam): import("firebase-functions/v2/https").CallableFunction<any, Promise<VerifyMeetingAttendanceResult>>;
/**
 * 매일 서울 새벽: stravaSyncPreviousDay(전날 로그 수집, 02:00)·청크 완료 여유를 둔 뒤,
 * 금일 0시 이전 일정의 rides 중 미검증 건에 대해 참석 검증(방장 없이 서버 실행).
 * 이전 자정+5분(00:05) 배치는 Strava 로그가 아직 Firestore에 없어 좌표 검증이 MISSED로 고착되는 경우가 많았음.
 */
export declare function createScheduledRideAttendanceVerification(stravaClientSecret: SecretParam): import("firebase-functions/v2/scheduler").ScheduleFunction;
export {};
