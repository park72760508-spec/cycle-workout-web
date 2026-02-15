export type LastChangedType = "PAYED" | "CANCELLED" | "RETURNED" | "DISPATCHED";
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
export interface LastChangedStatusesResponse {
    data?: ProductOrderItem[];
    moreSequence?: number;
    [key: string]: unknown;
}
/** 최근 상태 변경된 주문 조회 (PAYED, CANCELLED, RETURNED 등) */
export declare function getLastChangedOrders(accessToken: string, lastChangedType: LastChangedType, options: {
    lastChangedFrom: string;
    lastChangedTo?: string;
    limitCount?: number;
    moreSequence?: number;
}): Promise<{
    orders: ProductOrderItem[];
    moreSequence?: number;
}>;
/** 주문 옵션/연락처에서 전화번호 또는 사용자 식별자 추출 (1순위: 옵션, 2순위: 주문자 연락처) */
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
