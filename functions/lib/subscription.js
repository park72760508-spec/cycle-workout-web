"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SUBSCRIPTION_DAYS = exports.applySubscription = exports.computeNewSubscriptionEndDate = exports.revokeSubscriptionByOrder = exports.getProcessedOrderInfo = exports.isOrderProcessed = exports.findUserByContact = void 0;
/**
 * STELVIO AI - Firestore DB 처리 로직 (구독·중복·유저 매칭)
 * processed_orders 컬렉션으로 중복 지급 방지
 */
var subscriptionService_1 = require("./subscriptionService");
Object.defineProperty(exports, "findUserByContact", { enumerable: true, get: function () { return subscriptionService_1.findUserByContact; } });
Object.defineProperty(exports, "isOrderProcessed", { enumerable: true, get: function () { return subscriptionService_1.isOrderProcessed; } });
Object.defineProperty(exports, "getProcessedOrderInfo", { enumerable: true, get: function () { return subscriptionService_1.getProcessedOrderInfo; } });
Object.defineProperty(exports, "revokeSubscriptionByOrder", { enumerable: true, get: function () { return subscriptionService_1.revokeSubscriptionByOrder; } });
Object.defineProperty(exports, "computeNewSubscriptionEndDate", { enumerable: true, get: function () { return subscriptionService_1.computeNewSubscriptionEndDate; } });
Object.defineProperty(exports, "applySubscription", { enumerable: true, get: function () { return subscriptionService_1.applySubscription; } });
Object.defineProperty(exports, "DEFAULT_SUBSCRIPTION_DAYS", { enumerable: true, get: function () { return subscriptionService_1.DEFAULT_SUBSCRIPTION_DAYS; } });
