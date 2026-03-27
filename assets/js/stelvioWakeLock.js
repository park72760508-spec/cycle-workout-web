/**
 * STELVIO 통합 화면 유지 (Triple Fallback)
 * 1) Web API: visibility 복귀 시 500ms 지연 후 재요청 + 재시도
 * 2) 무음 비디오: base64 MP4 + 실패 시 Canvas MediaStream
 * 3) Native: Android setKeepScreenOn / iOS WKWebView messageHandlers
 */
(function (global) {
  'use strict';

  var LOG = '[StelvioWakeLock]';
  var WAKE_SCREEN_IDS = ['mobileDashboardScreen', 'trainingScreen', 'bluetoothIndividualScreen'];

  /** dmlap gist 스타일 최소 무음 MP4 (1프레임 수준, 다수 브라우저 재생) */
  var SILENT_MP4_DATA_URI =
    'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAr9tZGF0AAACoAYF//+c3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDEyNSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMTIgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz02IGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yNCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA9liIQAV/0TAAYdeBTXzg8AAALvbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAACoAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAhl0cmFrAAAAXHRraGQAAAAPAAAAAAAAAAAAAAABAAAAAAAAACoAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAgAAAAIAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAqAAAAAAABAAAAAAGRbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAAgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABPG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPxzdGJsAAAAmHN0c2QAAAAAAAAAAQAAAIhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAgACABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMmF2Y0MBZAAK/+EAGWdkAAqs2V+WXAWyAAADAAIAAAMAYB4kSywBAAZo6+PLIsAAAAAYc3R0cwAAAAAAAAABAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAACtwAAAAEAAAAUc3RjbwAAAAAAAAABAAAAMAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlzbHQAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNTQuNjMuMTA0';

  var state = {
    desired: false,
    webLock: null,
    videoEl: null,
    videoPollId: null,
    visTimer: null,
    bound: false,
    lastSuccess: []
  };

  function logOk(layer, detail) {
    var msg = detail ? layer + ' — ' + detail : layer;
    console.log(LOG + ' ✓ 성공:', msg);
    if (state.lastSuccess.indexOf(layer) === -1) state.lastSuccess.push(layer);
  }

  function callNative(on) {
    try {
      if (global.Android && typeof global.Android.setKeepScreenOn === 'function') {
        global.Android.setKeepScreenOn(!!on);
        if (on) logOk('Native', 'Android.setKeepScreenOn(true)');
        return true;
      }
    } catch (e) {
      console.warn(LOG + ' Native Android 오류:', e);
    }
    try {
      if (
        global.webkit &&
        global.webkit.messageHandlers &&
        global.webkit.messageHandlers.setKeepScreenOn &&
        typeof global.webkit.messageHandlers.setKeepScreenOn.postMessage === 'function'
      ) {
        global.webkit.messageHandlers.setKeepScreenOn.postMessage(!!on);
        if (on) logOk('Native', 'iOS webkit.messageHandlers.setKeepScreenOn');
        return true;
      }
    } catch (e2) {
      console.warn(LOG + ' Native iOS 오류:', e2);
    }
    return false;
  }

  function releaseWebApi() {
    if (!state.webLock) return Promise.resolve();
    var wl = state.webLock;
    state.webLock = null;
    return wl.release().catch(function () {});
  }

  function requestWebApiOnce() {
    if (!('wakeLock' in navigator)) return Promise.resolve(false);
    return releaseWebApi().then(function () {
      return navigator.wakeLock.request('screen').then(function (sentinel) {
        state.webLock = sentinel;
        state.webLock.addEventListener('release', function () {
          state.webLock = null;
        });
        logOk('Web API', 'navigator.wakeLock.request(screen)');
        return true;
      });
    });
  }

  function requestWebApiWithRetries(maxAttempts) {
    maxAttempts = maxAttempts || 3;
    var attempt = 0;
    function tryOnce() {
      attempt++;
      return requestWebApiOnce().then(function (ok) {
        if (ok) return true;
        if (attempt >= maxAttempts) return false;
        return new Promise(function (r) {
          setTimeout(function () {
            r(tryOnce());
          }, 180 * attempt);
        });
      }).catch(function (err) {
        console.warn(LOG + ' Web API 시도 ' + attempt + '/' + maxAttempts + ' 실패:', err && err.message);
        if (attempt >= maxAttempts) return false;
        return new Promise(function (r) {
          setTimeout(function () {
            r(tryOnce());
          }, 180 * attempt);
        });
      });
    }
    return tryOnce();
  }

  function startCanvasVideoFallback(container) {
    var canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 2, 2);
    var stream = canvas.captureStream(30);
    container.srcObject = stream;
    container.removeAttribute('src');
    logOk('Video hack', 'Canvas MediaStream (base64 실패 시 폴백)');
  }

  function startVideoHack() {
    if (state.videoEl) return;
    var v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('muted', '');
    v.setAttribute('loop', '');
    v.setAttribute('autoplay', '');
    v.muted = true;
    v.playsInline = true;
    v.loop = true;
    v.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-9999;';
    v.src = SILENT_MP4_DATA_URI;

    var playedBase64 = false;
    v.addEventListener(
      'loadeddata',
      function onLd() {
        v.removeEventListener('loadeddata', onLd);
        var p = v.play();
        if (p && p.then) {
          p.then(function () {
            if (!playedBase64) {
              playedBase64 = true;
              logOk('Video hack', 'base64 무음 MP4 재생');
            }
          }).catch(function () {
            startCanvasVideoFallback(v);
            v.play().catch(function () {});
          });
        }
      },
      false
    );
    v.addEventListener(
      'error',
      function onErr() {
        v.removeEventListener('error', onErr);
        startCanvasVideoFallback(v);
        v.play().catch(function () {});
      },
      false
    );

    document.body.appendChild(v);
    state.videoEl = v;

    var p0 = v.play();
    if (p0 && p0.then) {
      p0
        .then(function () {
          if (!playedBase64) {
            playedBase64 = true;
            logOk('Video hack', 'base64 무음 MP4 재생');
          }
        })
        .catch(function () {
          startCanvasVideoFallback(v);
          v.play().catch(function () {});
        });
    }

    if (state.videoPollId) clearInterval(state.videoPollId);
    state.videoPollId = setInterval(function () {
      if (!state.desired || !state.videoEl) return;
      if (state.videoEl.paused || state.videoEl.ended) {
        state.videoEl.play().catch(function () {});
      }
    }, 4000);
  }

  function stopVideoHack() {
    if (state.videoPollId) {
      clearInterval(state.videoPollId);
      state.videoPollId = null;
    }
    if (state.videoEl) {
      try {
        if (state.videoEl.srcObject) {
          state.videoEl.srcObject.getTracks().forEach(function (t) {
            t.stop();
          });
          state.videoEl.srcObject = null;
        }
        state.videoEl.pause();
        if (state.videoEl.parentNode) state.videoEl.parentNode.removeChild(state.videoEl);
      } catch (e) {}
      state.videoEl = null;
    }
  }

  function bindVisibility() {
    if (state.bound) return;
    state.bound = true;
    function onVis() {
      if (document.visibilityState !== 'visible') return;
      if (!state.desired) return;
      clearTimeout(state.visTimer);
      state.visTimer = setTimeout(function () {
        state.visTimer = null;
        state.lastSuccess = [];
        callNative(true);
        requestWebApiWithRetries(3).catch(function () {});
        if (state.videoEl && state.videoEl.paused) {
          state.videoEl.play().catch(function () {});
        }
      }, 500);
    }
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onVis);
    window.addEventListener('focus', onVis);
  }

  function getWakeTargetScreenActive() {
    for (var i = 0; i < WAKE_SCREEN_IDS.length; i++) {
      var el = document.getElementById(WAKE_SCREEN_IDS[i]);
      if (el && el.classList.contains('active')) return true;
    }
    return false;
  }

  function acquire() {
    state.desired = true;
    state.lastSuccess = [];
    bindVisibility();
    callNative(true);
    return requestWebApiWithRetries(3)
      .then(function () {
        startVideoHack();
      })
      .catch(function () {
        startVideoHack();
      });
  }

  function tearDown() {
    state.desired = false;
    clearTimeout(state.visTimer);
    state.visTimer = null;
    callNative(false);
    return releaseWebApi()
      .then(function () {
        stopVideoHack();
        console.log(LOG + ' 전체 해제 완료');
      })
      .catch(function () {
        stopVideoHack();
      });
  }

  function applyForScreen(screenId) {
    if (WAKE_SCREEN_IDS.indexOf(screenId) !== -1) {
      return acquire();
    }
    return tearDown();
  }

  /** 훈련 화면에 머물 때는 legacy release 무시 */
  function releaseLegacy() {
    if (getWakeTargetScreenActive()) {
      console.log(LOG + ' legacy release 무시 (훈련 대상 화면 활성)');
      return Promise.resolve();
    }
    return tearDown();
  }

  function refresh() {
    if (!state.desired && !getWakeTargetScreenActive()) return Promise.resolve();
    state.lastSuccess = [];
    callNative(true);
    return requestWebApiWithRetries(3).then(function () {
      startVideoHack();
    });
  }

  global.StelvioWakeLock = {
    acquire: acquire,
    release: tearDown,
    applyForScreen: applyForScreen,
    refresh: refresh,
    releaseLegacy: releaseLegacy,
    getWakeTargetScreenActive: getWakeTargetScreenActive,
    WAKE_SCREEN_IDS: WAKE_SCREEN_IDS
  };
})(typeof window !== 'undefined' ? window : this);
