/**
 * STELVIO AI - 구독 처리 서비스
 * Firestore: users 읽기/쓰기, 만료일 계산, 중복 처리 체크, 유저 매칭
 */
import type { Firestore } from "firebase-admin/firestore";
/** DB contact 포맷: "010-XXXX-XXXX" (13자). 숫자만 추출 후 010-앞4자-뒤4자로 변환 */
export declare function normalizeToContactFormat(phone: string): string;
/** 1순위 shippingAddress.tel1, 2순위 ordererTel, 3순위 shippingMemo. contact(010-XXXX-XXXX)로 where 절 비교, 1순위 매칭 시 2·3순위 생략 */
export declare function findUserByContactWithPriority(db: Firestore, shippingAddressTel1: string | null, ordererTel: string | null, shippingMemo: string | null): Promise<{
    userId: string;
    priority: 1 | 2 | 3;
} | null>;
/** (레거시) 1순위 ordererTel, 2순위 shippingMemo. 숫자 아닌 문자 제거 후 비교. DB는 contact·phoneNumber·phone·tel 대조 */
export declare function findUserByContact(db: Firestore, optionPhoneOrId: string | null, ordererTel: string | null, memoOrOptionId?: string | null, ordererNo?: string | null, shippingMemo?: string | null): Promise<{
    userId: string;
} | null>;
/** 이미 처리된 주문인지 확인 */
export declare function isOrderProcessed(db: Firestore, productOrderId: string): Promise<boolean>;
/** PAYED 적용 시 처리 기록 저장 (환불 시 회수용으로 addedDays 저장). productOrderId를 문서 ID로 사용하여 upsert: 기존 건은 덮어쓰기, 신규 건은 추가 */
export declare function markOrderProcessed(db: Firestore, productOrderId: string, userId: string, addedDays: number): Promise<void>;
/** CLAIM_COMPLETED(취소/반품) 시 기존 처리 내역 조회 (회수용) */
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
/** 유저 문서에 구독 만료일 적용. 대상 필드: expiry_date (YYYY-MM-DD). 기존이 미래면 기존+일수, 과거/없으면 현재+일수 */
export declare function applySubscription(db: Firestore, userId: string, productOrderId: string, addDays: number): Promise<{
    success: boolean;
    newEndDate: string;
    previousEndDate: string | null;
}>;
/** 구매 로그 저장: users/{userId}/orders/{productOrderId} (PAYED 성공 시). status: "PAYED" | "CANCELLED" | "RETURNED" */
export interface OrderLogPayload {
    orderId: string;
    productOrderId: string;
    productName: string;
    productOption: string;
    quantity: number;
    totalPaymentAmount?: number;
    paymentDate: string;
    processedAt?: string;
    status: "PAYED" | "CANCELLED" | "RETURNED";
}
export declare function saveOrderLog(db: Firestore, userId: string, productOrderId: string, payload: OrderLogPayload): Promise<void>;
/** 구매 로그 조회 (취소 중복 방지용) */
export declare function getOrderLog(db: Firestore, userId: string, productOrderId: string): Promise<{
    status: string;
} | null>;
/** 취소/반품 시 구매 로그 상태 업데이트 (status: CANCELLED | RETURNED, claimDate, claimReason). 문서 없으면 merge로 생성 */
export declare function updateOrderLogClaim(db: Firestore, userId: string, productOrderId: string, status: "CANCELLED" | "RETURNED", claimDate: string, claimReason?: string): Promise<void>;
