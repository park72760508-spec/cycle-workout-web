/**
 * 오픈 라이딩방 ES 모듈 부트 — React(전역) 로드 이후에만 실행하세요.
 * window.openRidingService, window.useOpenRiding, window.useOpenRideDetail, 지역/레벨 옵션 노출
 */
import { refreshDualRunFromRemoteConfig } from '../supabaseDualWrite.js';
import './openRidingService.js?v=settlement-paid-20260822b';
import './openRidingGroupService.js?v=hosted-cat-split-20260816v1';

refreshDualRunFromRemoteConfig(true).catch(function (err) {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[openRidingBoot] Remote Config prefetch:', err);
  }
});
import './openRidingFriendsService.js?v=settlement-paid-20260822b';
import './useOpenRiding.js?v=settlement-paid-20260822b';
import './koreaRegions.js';
import './groupRideEligibility.js';
