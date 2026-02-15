/**
 * STELVIO AI - 구독 처리 서비스
 * Firestore: users 읽기/쓰기, 만료일 계산, 중복 처리 체크, 유저 매칭
 */
import type { Firestore } from "firebase-admin/firestore";
/** 1순위: 주문 옵션 전화번호/ID로 유저 매칭, 2순위: 주문자 연락처로 매칭 */
export declare function findUserByContact(db: Firestore, optionPhoneOrId: string | null, ordererTel: string | null): Promise<{
    userId: string;
} | null>;
/** 이미 처리된 주문인지 확인 */
export declare function isOrderProcessed(db: Firestore, productOrderId: string): Promise<boolean>;
/** PAYED 적용 시 처리 기록 저장 (환불 시 회수용으로 addedDays 저장) */
export declare function markOrderProcessed(db: Firestore, productOrderId: string, userId: string, addedDays: number): Promise<void>;
/** CANCELLED/RETURNED 시 기존 처리 내역 조회 (회수용) */
export declare function getProcessedOrderInfo(db: Firestore, productOrderId: string): Promise<{
    userId: string;
    addedDays: number;
} | null>;
/** 취소/반품 시 구독 일수 회수 후 처리 기록 업데이트 */
export declare function revokeSubscriptionByOrder(db: Firestore, productOrderId: string): Promise<{
    revoked: boolean;
    userId?: string;
}>;
/** 구독 만료일 계산: 기존 만료일이 남아 있으면 기존+일수, 만료되었으면 오늘+일수 */
export declare function computeNewSubscriptionEndDate(currentEndDate: string | null | undefined, addDays: number): string;
/** 상품별 구독 일수 (상품 설정 또는 기본값). 필요 시 Firestore appConfig/naver 에서 상품별 일수 매핑 */
export declare const DEFAULT_SUBSCRIPTION_DAYS = 30;
/** 유저 문서에 구독 만료일 적용 (subscription_end_date, 필요 시 expiry_date 동기화) */
export declare function applySubscription(db: Firestore, userId: string, productOrderId: string, addDays: number): Promise<{
    success: boolean;
    newEndDate: string;
}>;
