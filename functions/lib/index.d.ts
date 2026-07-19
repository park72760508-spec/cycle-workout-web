/** 1회 동기화 실행 */
export declare function runNaverSubscriptionSync(clientSecret: string): Promise<void>;
/**
 * 30분마다 실행되는 스케줄러.
 * - Region: asia-northeast3 (서울)
 * - Direct VPC Egress → Cloud NAT → 고정 IP(34.64.250.77)로 네이버 API 호출
 * - Client Secret: process.env.NAVER_CLIENT_SECRET 또는 Firebase Secret
 *
 * [중요] network 값을 실제 VPC 네트워크 이름으로 교체하세요.
 *   확인 방법: GCP Console → VPC network → VPC networks → 네트워크 이름
 *   (예: "default" 또는 커스텀 VPC명 "stelvio-vpc" 등)
 */
export declare const naverSubscriptionSyncSchedule: import("firebase-functions/v2/scheduler").ScheduleFunction;
export declare const naverSubscriptionSyncTest: import("firebase-functions/v2/https").HttpsFunction;
/**
 * Strava Webhook 수신 엔드포인트 (GET: 등록 인증, POST: 이벤트 수신)
 * - 경로: /api/strava/webhook (Firebase Hosting rewrite 시) 또는 Cloud Functions URL
 * - Strava가 2초 이내 200 응답을 요구하므로, POST 시 즉시 200 반환 후 비동기 처리
 */
export declare const stravaWebhook: import("firebase-functions/v2/https").HttpsFunction;
/**
 * 인도어 세션 로그 생성 시 포인트 보상 처리.
 * - users/{userId}/logs/{logId} 생성 이벤트에서 source!=strava 이고 tss>0 인 경우만 적립
 * - point_reward_v2_applied 플래그로 중복 적립 방지
 */
export declare const onIndoorLogCreatedReward: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, Record<string, string>>>;
/**
 * 라이딩 미션·구독 연장(UH_2120) 알림톡 — Strava 웹훅 전용 HTTPS 릴레이.
 * `onIndoorLogCreatedReward`(실내)·모임 릴레이와 동일 Direct VPC egress로 알리고 kakaoapi 호출하여 NAT 고정 IP 정렬.
 */
export declare const missionSubscriptionAlimtalkHttpsRelay: import("firebase-functions/v2/https").HttpsFunction;
/**
 * 모임 알림톡 전용 HTTPS 릴레이 (VPC + ALL_TRAFFIC egress).
 * 알리고 code=-99 시: rides....diagSeenPublicIp 에 찍힌 공인 IP를 카카오톡 API 허용 목록에 넣을 것.
 * (VPC 미적용 egress는 34.96.x처럼 Google 기본 출구와 유사하게 보입니다. firebase-functions 예전 버전에서는 `network` 플래트 옵션이 배포 매니페스트에서 빠져 NAT가 적용되지 않을 수 있습니다 — 현재 레포는 `networkInterface`+`vpcEgress`(SDK ^7.2)로 배포합니다.)
 */
export declare const meetupInviteAlimtalkHttpsRelay: import("firebase-functions/v2/https").HttpsFunction;
/** rides 생성 → 내부 HTTPS 릴레이 호출만 (VPC 없음). 성공 시 meetup 요약은 릴레이가 rides 에 기록한다. */
export declare const onRideCreatedMeetupInviteAlimtalk: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, Record<string, string>>>;
/** 라이딩 모임 참석 검증 (Strava 스트림 + 집결지 반경 200m, 모임 시각 ±1h) — 방장 전용 Callable */
export declare const verifyMeetingAttendance: import("firebase-functions/v2/https").CallableFunction<any, Promise<import("./verifyMeetingAttendance").VerifyMeetingAttendanceResult>, unknown>;
/** 서울 새벽 3:30: stravaSyncPreviousDay(00:10 갭 탐지) 이후 미검증 rides 일괄 참석 검증 (스케줄러, Strava Secret 필요) */
export declare const scheduledRideAttendanceVerification: import("firebase-functions/v2/scheduler").ScheduleFunction;
