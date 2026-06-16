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
        'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
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
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        recoverFirestoreTransport('visibility');
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
