/**
 * Firestore Listen 채널 400(세션 만료) 후 자동 복구 보조.
 * 백그라운드·절전 복귀 시 enableNetwork로 WebChannel을 재협상합니다.
 */
(function (w) {
  'use strict';

  var lastRecoverAt = 0;
  var RECOVER_DEBOUNCE_MS = 4000;
  var fsModPromise = null;

  function getFirestoreMod() {
    if (!fsModPromise) {
      fsModPromise = import(
        '/assets/js/vendor/firebasejs/10.14.1/firebase-firestore.js'
      ).catch(function () {
        fsModPromise = null;
        return null;
      });
    }
    return fsModPromise;
  }

  function recoverCompatFirestore() {
    try {
      var fs = w.firestore;
      if (fs && typeof fs.enableNetwork === 'function') {
        return fs.enableNetwork().catch(function () {});
      }
    } catch (_e) {}
    return Promise.resolve();
  }

  function recoverModularFirestore() {
    if (!w.firestoreV9) return Promise.resolve();
    return getFirestoreMod().then(function (mod) {
      if (mod && typeof mod.enableNetwork === 'function' && w.firestoreV9) {
        return mod.enableNetwork(w.firestoreV9).catch(function () {});
      }
    });
  }

  function recoverFirestoreTransport(reason) {
    var now = Date.now();
    if (now - lastRecoverAt < RECOVER_DEBOUNCE_MS) return;
    lastRecoverAt = now;
    Promise.all([recoverCompatFirestore(), recoverModularFirestore()]).then(function () {
      try {
        if (typeof w.stelvioAdminDebug === 'function') {
          w.stelvioAdminDebug('[Firestore] transport recover:', reason || 'unknown');
        }
      } catch (_log) {}
    });
  }

  w.stelvioRecoverFirestoreTransport = recoverFirestoreTransport;

  if (typeof document !== 'undefined') {
    /* 2026-11-21 짧은 탭 전환·알림창 등에서는 SDK 가 스스로 연결을 유지한다. 구독이 많은 상태에서
       enableNetwork 로 감시 스트림을 재시작하면 SDK 10.14.1 이 "INTERNAL ASSERTION FAILED: Unexpected state"
       를 내는 경우가 확인돼(라이딩 모임 화면), 실제로 오래 백그라운드였던 경우(30초 이상)에만 재협상한다. */
    var hiddenAt = 0;
    var MIN_HIDDEN_MS = 30000;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (document.visibilityState === 'visible') {
        var away = hiddenAt ? Date.now() - hiddenAt : 0;
        hiddenAt = 0;
        if (away >= MIN_HIDDEN_MS) recoverFirestoreTransport('visibility');
      }
    });
  }
  if (typeof w.addEventListener === 'function') {
    w.addEventListener('pageshow', function (ev) {
      if (ev && ev.persisted) recoverFirestoreTransport('pageshow-bfcache');
    });
    w.addEventListener('online', function () {
      recoverFirestoreTransport('online');
    });
  }
})(typeof window !== 'undefined' ? window : {});
