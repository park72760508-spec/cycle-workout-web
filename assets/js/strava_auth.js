/**
 * Strava OAuth 2.0 연동 - 프론트엔드
 * - 인증 페이지로 리다이렉트 (connectStrava)
 * - 콜백 페이지에서 code 추출 후 GAS로 POST (callback.html에서 사용)
 */

(function (global) {
  'use strict';

  /** Strava Client ID (앱 등록 시 발급) */
  var STRAVA_CLIENT_ID = '197363';

  /**
   * 인증 후 돌아올 콜백 URL.
   * - 배포: https://stelvio.ai.kr/callback.html
   * - 로컬: 현재 페이지 origin + /callback.html (또는 설정에 맞게 변경)
   */
  function getRedirectUri() {
    if (typeof window.STRAVA_REDIRECT_URI === 'string' && window.STRAVA_REDIRECT_URI) {
      return window.STRAVA_REDIRECT_URI;
    }
    if (typeof window.CONFIG !== 'undefined' && window.CONFIG.STRAVA_REDIRECT_URI) {
      return window.CONFIG.STRAVA_REDIRECT_URI;
    }
    var base = window.location.origin;
    return base + (base.slice(-1) === '/' ? '' : '/') + 'callback.html';
  }

  /**
   * GAS 웹앱 URL (POST용).
   * window.GAS_URL 또는 CONFIG.GAS_WEB_APP_URL 사용.
   */
  function getGasUrl() {
    if (typeof window.GAS_URL === 'string' && window.GAS_URL) {
      return window.GAS_URL;
    }
    if (typeof window.CONFIG !== 'undefined' && window.CONFIG.GAS_WEB_APP_URL) {
      return window.CONFIG.GAS_WEB_APP_URL;
    }
    return '';
  }

  /**
   * Strava 인증 페이지로 이동한다.
   * scope: activity:read_all (훈련 데이터 조회 필수)
   * state: user_id 전달용 (콜백에서 그대로 돌려받음)
   *
   * @param {string|number} userId - 현재 로그인한 사용자 ID (Firebase 문서 ID 또는 Users 시트 id)
   */
  function connectStrava(userId) {
    // userId가 없으면 Firebase Auth의 현재 사용자 uid 사용 시도
    var uid = userId != null ? String(userId) : '';
    
    // userId가 없고 Firebase Auth가 있으면 현재 사용자 uid 가져오기
    if (!uid) {
      try {
        var auth = window.authV9 || window.auth;
        if (auth && auth.currentUser) {
          uid = auth.currentUser.uid;
          console.log('[Strava] connectStrava: Firebase Auth에서 uid 가져옴:', uid);
        } else if (window.currentUser && window.currentUser.id) {
          uid = String(window.currentUser.id);
          console.log('[Strava] connectStrava: window.currentUser.id 사용:', uid);
        }
      } catch (e) {
        console.warn('[Strava] connectStrava: Firebase Auth 접근 실패:', e);
      }
    }
    
    if (!uid) {
      console.warn('[Strava] connectStrava: userId가 없습니다.');
      if (typeof window.showToast === 'function') {
        window.showToast('먼저 사용자를 선택해 주세요.');
      }
      return;
    }

    var redirectUri = getRedirectUri();
    var scope = 'activity:read_all';
    var state = uid;
    console.log('[Strava] connectStrava: state에 전달할 userId:', state);
    var url =
      'https://www.strava.com/oauth/authorize' +
      '?client_id=' + encodeURIComponent(STRAVA_CLIENT_ID) +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&response_type=code' +
      '&scope=' + encodeURIComponent(scope) +
      '&state=' + encodeURIComponent(state) +
      '&approval_prompt=force';

    // Strava 로그인/승인 화면을 오버레이 팝업으로 띄움
    var w = 500, h = 650;
    var left = (window.screen.width - w) / 2;
    var top = (window.screen.height - h) / 2;
    var popup = window.open(url, 'strava_authorize', 'width=' + w + ',height=' + h + ',left=' + Math.max(0, left) + ',top=' + Math.max(0, top) + ',scrollbars=yes,resizable=yes');
    if (popup) {
      popup.focus();
      var checkClosed = setInterval(function () {
        if (popup.closed) {
          clearInterval(checkClosed);
          if (typeof window.onStravaPopupClosed === 'function') {
            window.onStravaPopupClosed();
          }
        }
      }, 500);
    } else {
      // 팝업 차단 시 기존처럼 현재 창에서 이동
      window.location.href = url;
    }
  }

  /**
   * 콜백 페이지 전용: URL에서 code, state 추출 후 GAS로 POST한다.
   * callback.html에서 호출한다.
   *
   * @param {function} [onSuccess] - 성공 시 콜백 (res)
   * @param {function} [onError]   - 실패 시 콜백 (errMessage)
   */
  function handleStravaCallback(onSuccess, onError) {
    var params = new URLSearchParams(window.location.search);
    var code = params.get('code');
    var state = params.get('state');

    if (!code) {
      var err = '인증 코드를 받지 못했습니다.';
      if (params.get('error')) {
        err += ' ' + (params.get('error_description') || params.get('error'));
      }
      if (typeof onError === 'function') {
        onError(err);
      } else {
        console.error('[Strava] ' + err);
      }
      return;
    }

    var userId = (state != null && state !== '') ? String(state).trim() : null;
    
    // userId가 없으면 Firebase Auth의 현재 사용자 uid 사용 시도
    if (!userId) {
      try {
        var auth = window.authV9 || window.auth;
        if (auth && auth.currentUser) {
          userId = auth.currentUser.uid;
          console.log('[Strava] handleStravaCallback: Firebase Auth에서 uid 가져옴:', userId);
        } else if (window.currentUser && window.currentUser.id) {
          userId = String(window.currentUser.id);
          console.log('[Strava] handleStravaCallback: window.currentUser.id 사용:', userId);
        }
      } catch (e) {
        console.warn('[Strava] handleStravaCallback: Firebase Auth 접근 실패:', e);
      }
    }
    
    if (!userId) {
      var noUser = 'user_id(state)가 없습니다. Strava 연결은 사용자 선택 후 진행해 주세요.';
      if (typeof onError === 'function') {
        onError(noUser);
      } else {
        console.error('[Strava] ' + noUser);
      }
      return;
    }
    
    console.log('[Strava] handleStravaCallback: 사용할 userId:', userId);

    // Firebase로 직접 처리 (GAS 대신)
    if (typeof window.exchangeStravaCode === 'function') {
      // Firebase로 직접 처리
      window.exchangeStravaCode(code, userId)
        .then(function (data) {
          if (data && data.success) {
            if (typeof onSuccess === 'function') { onSuccess(data); }
          } else {
            var msg = (data && data.error) ? data.error : 'Strava 연동 처리에 실패했습니다.';
            if (typeof onError === 'function') { onError(msg); } else { console.error('[Strava] ' + msg); }
          }
        })
        .catch(function (error) {
          var msg = error.message || 'Strava 연동 처리 중 오류가 발생했습니다.';
          if (typeof onError === 'function') { onError(msg); } else { console.error('[Strava] ' + msg); }
        });
      return;
    }

    // Firebase 함수가 없으면 GAS로 폴백
    var gasUrl = getGasUrl();
    if (!gasUrl) {
      var noGas = 'GAS URL이 설정되지 않았습니다. (GAS_URL 또는 CONFIG.GAS_WEB_APP_URL)';
      if (typeof onError === 'function') {
        onError(noGas);
      } else {
        console.error('[Strava] ' + noGas);
      }
      return;
    }

    /* CORS 회피: GAS POST 응답에 Access-Control-Allow-Origin이 없어 fetch 차단됨.
     * JSONP(GET + script)로 호출하면 CORS 없이 동작. */
    var cbName = 'strava_jsonp_' + Date.now() + '_' + Math.round(Math.random() * 1e4);
    var script = document.createElement('script');
    var timeout = setTimeout(function () {
      if (!window[cbName]) return;
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
      var msg = 'Strava 연동 요청 시간이 초과되었습니다.';
      if (typeof onError === 'function') { onError(msg); } else { console.error('[Strava] ' + msg); }
    }, 15000);

    window[cbName] = function (data) {
      clearTimeout(timeout);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
      if (data && data.success) {
        if (typeof onSuccess === 'function') { onSuccess(data); }
      } else {
        var msg = (data && data.error) ? data.error : 'Strava 연동 처리에 실패했습니다.';
        if (typeof onError === 'function') { onError(msg); } else { console.error('[Strava] ' + msg); }
      }
    };

    var q = 'action=exchangeStravaCode&code=' + encodeURIComponent(code) + '&user_id=' + encodeURIComponent(userId) + '&callback=' + encodeURIComponent(cbName);
    script.src = gasUrl + (gasUrl.indexOf('?') >= 0 ? '&' : '?') + q;
    script.onerror = function () {
      clearTimeout(timeout);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
      var msg = '네트워크 오류가 발생했습니다.';
      if (typeof onError === 'function') { onError(msg); } else { console.error('[Strava] ' + msg); }
    };
    document.body.appendChild(script);
  }

  // 전역 노출
  global.connectStrava = connectStrava;
  global.handleStravaCallback = handleStravaCallback;
  global.getStravaRedirectUri = getRedirectUri;
  global.getStravaGasUrl = getGasUrl;

})(typeof window !== 'undefined' ? window : this);
