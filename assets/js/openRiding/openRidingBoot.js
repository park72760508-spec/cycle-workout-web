/**
 * 오픈 라이딩방 ES 모듈 부트 — React(전역) 로드 이후에만 실행하세요.
 * window.openRidingService, window.useOpenRiding, window.useOpenRideDetail, 지역/레벨 옵션 노출
 */
import { refreshDualRunFromRemoteConfig } from '../supabaseDualWrite.js';
import './openRidingService.js';
import './openRidingGroupService.js';

refreshDualRunFromRemoteConfig(true).catch(function (err) {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[openRidingBoot] Remote Config prefetch:', err);
  }
});
import './openRidingFriendsService.js';
import './useOpenRiding.js';
import './koreaRegions.js';
import './groupRideEligibility.js';
