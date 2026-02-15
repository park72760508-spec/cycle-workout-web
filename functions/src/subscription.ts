/**
 * STELVIO AI - Firestore DB 처리 로직 (구독·중복·유저 매칭)
 * processed_orders 컬렉션으로 중복 지급 방지
 */
export {
  findUserByContact,
  isOrderProcessed,
  getProcessedOrderInfo,
  revokeSubscriptionByOrder,
  computeNewSubscriptionEndDate,
  applySubscription,
  DEFAULT_SUBSCRIPTION_DAYS,
} from "./subscriptionService";
