/** 네이버 공식 변경 상품 주문 정보: PAYED(결제완료), CLAIM_REQUESTED(취소/반품/교환 요청), CLAIM_COMPLETED(취소/반품/교환 완료). 한 번에 한 타입만 조회 가능 */
export type LastChangedType = "PAYED" | "CLAIM_REQUESTED" | "CLAIM_COMPLETED";
/** 전자서명 생성: client_id_timestamp 를 client_secret(salt)으로 bcrypt 후 Base64 */
export declare function createClientSecretSign(clientId: string, clientSecret: string, timestamp: number): string;
/** Access Token 발급 (Client Credentials) */
export declare function getAccessToken(clientId: string, clientSecret: string): Promise<string>;
/** last-changed-statuses API 응답 상품 주문 항목 */
export interface ProductOrderItem {
    productOrderId?: string;
    orderId?: string;
    productOrderStatus?: string;
    lastChangedType?: string;
    lastChangedDate?: string;
    paymentDate?: string;
    orderer?: {
        name?: string;
        tel?: string;
        contact?: string;
        [key: string]: unknown;
    };
    orderOptions?: Array<{
        optionCode?: string;
        optionValue?: string;
        optionName?: string;
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
}
/** 네이버 API 실제 응답: data.lastChangeStatuses(배열), data.count(건수) */
export interface LastChangedStatusesResponse {
    data?: {
        lastChangeStatuses?: ProductOrderItem[];
        count?: number;
        [key: string]: unknown;
    };
    moreSequence?: number;
    [key: string]: unknown;
}
/** 최근 상태 변경된 주문 조회 (PAYED, CLAIM_REQUESTED, CLAIM_COMPLETED) */
export declare function getLastChangedOrders(accessToken: string, lastChangedType: LastChangedType, options: {
    lastChangedFrom: string;
    lastChangedTo?: string;
    limitCount?: number;
    moreSequence?: number;
}): Promise<{
    orders: ProductOrderItem[];
    count?: number;
    moreSequence?: number;
}>;
/** 주문 상세 내역 조회 API 응답 항목 — productOrder 내 ordererTel, shippingMemo, optionManageCode 등 */
export interface ProductOrderDetailItem {
    productOrderId?: string;
    orderId?: string;
    /** API 응답: 주문자 연락처 (매칭용 핵심) */
    ordererTel?: string;
    /** API 응답: 주문자 이름 */
    ordererName?: string;
    /** API 응답: 주문자 번호 */
    ordererNo?: string;
    /** API 응답: 배송 메모 (연락처 포함 가능) */
    shippingMemo?: string;
    /** API 응답: 수령인 연락처 (1순위 매칭) productOrder.shippingAddress.tel1 */
    shippingAddress?: {
        tel1?: string;
        [key: string]: unknown;
    };
    /** API 응답: 옵션 관리 코드 (예: 01M, 06M, 12M) */
    optionManageCode?: string;
    /** API 응답: 수량 */
    quantity?: number;
    /** API 응답: 상품명 */
    productName?: string;
    /** API 응답: 결제 금액 */
    totalPaymentAmount?: number;
    /** API 응답: 결제 시각 */
    paymentDate?: string;
    /** API 응답: 사용자 입력 추가 정보(옵션) */
    productOption?: string | {
        optionValue?: string;
        optionName?: string;
        [key: string]: unknown;
    };
    orderer?: {
        tel?: string;
        contact?: string;
        name?: string;
        no?: string;
        [key: string]: unknown;
    };
    orderOptions?: Array<{
        optionCode?: string;
        optionValue?: string;
        optionName?: string;
        [key: string]: unknown;
    }>;
    orderMemo?: string;
    buyerComment?: string;
    /** 클레임 유형: CANCEL(취소), RETURN(반품) */
    claimType?: string;
    /** 클레임 상태: CANCEL_REQUEST, CANCEL_DONE, RETURN_REQUEST, RETURN_DONE 등 */
    claimStatus?: string;
    [key: string]: unknown;
}
/** 주문 상세 조회 API 응답: data(배열), 각 항목은 productOrder 객체 래핑 가능 */
export interface ProductOrderDetailsResponse {
    /** 성공 시 data는 배열. 각 요소가 { productOrder: {...} } 형태일 수 있음 */
    data?: Array<ProductOrderDetailItem | {
        productOrder?: ProductOrderDetailItem;
        [key: string]: unknown;
    }>;
    productOrders?: ProductOrderDetailItem[];
    [key: string]: unknown;
}
/** 주문 상세 내역 조회 — POST /product-orders/query, Body: {"productOrderIds": ["id1","id2"]}, Authorization: Bearer 필수 */
export declare function getProductOrderDetails(accessToken: string, productOrderIds: string[]): Promise<ProductOrderDetailItem[]>;
/** 연락처 추출 (매칭 우선순위용). 1순위: productOrder.shippingAddress.tel1, 2순위: order.ordererTel, 3순위: productOrder.shippingMemo */
export declare function extractContactFromDetail(detail: ProductOrderDetailItem): {
    /** 1순위: 수령인 번호 */
    shippingAddressTel1: string | null;
    /** 2순위: 주문자 번호 */
    ordererTel: string | null;
    /** 3순위: 배송 메모 */
    shippingMemo: string | null;
    ordererName: string | null;
    ordererNo: string | null;
    optionPhoneOrId: string | null;
    memoOrOptionId: string | null;
};
/** optionManageCode / productOption 명으로 기본 기간(일) 산정, quantity 곱하여 총 연장 일수 반환. 매칭 안 되면 31일, quantity 없으면 1 */
export declare function computeSubscriptionDaysFromProduct(detail: ProductOrderDetailItem): {
    totalDays: number;
    matchedCode?: string;
};
/** 주문 옵션/연락처에서 전화번호 또는 사용자 식별자 추출 (1순위: 옵션, 2순위: 주문자 연락처) — last-changed-statuses용 */
export declare function extractContactFromOrder(order: ProductOrderItem): {
    optionPhoneOrId: string | null;
    ordererTel: string | null;
};
/** 발송 처리 (배송 없음: NOTHING - 디지털 상품/구독 정산 확정용) */
export declare function dispatchProductOrders(accessToken: string, productOrderIds: string[]): Promise<{
    successIds: string[];
    failInfos: Array<{
        productOrderId: string;
        message?: string;
    }>;
}>;
