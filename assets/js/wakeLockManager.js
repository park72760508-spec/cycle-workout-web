/**
 * Screen Wake Lock API 공통 모듈 (훈련 화면 꺼짐 방지)
 * - requestScreenWakeLock / releaseScreenWakeLock 분리
 * - Foreground 복귀 시 reacquireScreenWakeLockOnForeground 로 stale 참조·미해제 잠금 정리 후 재요청
 */
(function (global) {
  'use strict';

  /**
   * @param {{ wakeLock: WakeLockSentinel|null }} stateRef
   * @param {string} [logPrefix]
   */
  async function releaseScreenWakeLock(stateRef, logPrefix) {
    logPrefix = logPrefix || '[WakeLockManager]';
    try {
      if (!stateRef || !stateRef.wakeLock) return;
      await stateRef.wakeLock.release();
    } catch (err) {
      try {
        console.warn(logPrefix + ' releaseScreenWakeLock:', err);
      } catch (_) {}
    } finally {
      if (stateRef) stateRef.wakeLock = null;
    }
  }

  /**
   * @param {{ wakeLock: WakeLockSentinel|null }} stateRef
   * @param {string} [logPrefix]
   * @returns {Promise<boolean>}
   */
  async function requestScreenWakeLock(stateRef, logPrefix) {
    logPrefix = logPrefix || '[WakeLockManager]';
    try {
      if (!stateRef || !('wakeLock' in navigator)) return false;
      if (stateRef.wakeLock) return true;
      stateRef.wakeLock = await navigator.wakeLock.request('screen');
      stateRef.wakeLock.addEventListener('release', function () {
        stateRef.wakeLock = null;
      });
      return true;
    } catch (err) {
      try {
        console.warn(logPrefix + ' requestScreenWakeLock:', err);
      } catch (_) {}
      if (stateRef) stateRef.wakeLock = null;
      return false;
    }
  }

  /**
   * Background → Foreground 복귀 시: 브라우저가 잠금을 해제한 뒤에도 참조가 남거나
   * 재요청이 필요한 경우를 위해 안전히 해제 후 새로 요청합니다.
   * @param {{ wakeLock: WakeLockSentinel|null }} stateRef
   * @param {string} [logPrefix]
   * @returns {Promise<boolean>}
   */
  async function reacquireScreenWakeLockOnForeground(stateRef, logPrefix) {
    logPrefix = logPrefix || '[WakeLockManager]';
    try {
      await releaseScreenWakeLock(stateRef, logPrefix);
      return await requestScreenWakeLock(stateRef, logPrefix);
    } catch (err) {
      try {
        console.warn(logPrefix + ' reacquireScreenWakeLockOnForeground:', err);
      } catch (_) {}
      return false;
    }
  }

  global.WakeLockManager = {
    requestScreenWakeLock: requestScreenWakeLock,
    releaseScreenWakeLock: releaseScreenWakeLock,
    reacquireScreenWakeLockOnForeground: reacquireScreenWakeLockOnForeground
  };
})(typeof window !== 'undefined' ? window : global);
