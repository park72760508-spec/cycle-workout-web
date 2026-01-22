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
   * @param {string|number} userId - 현재 로그인한 사용자 ID (Users 시트 id)
   */
  function connectStrava(userId) {
    var uid = userId != null ? String(userId) : '';
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
    var url =
      'https://www.strava.com/oauth/authorize' +
      '?client_id=' + encodeURIComponent(STRAVA_CLIENT_ID) +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&response_type=code' +
      '&scope=' + encodeURIComponent(scope) +
      '&state=' + encodeURIComponent(state) +
      '&approval_prompt=force';

    window.location.href = url;
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

    var userId = (state != null && state !== '') ? state : null;
    if (!userId) {
      var noUser = 'user_id(state)가 없습니다. Strava 연결은 사용자 선택 후 진행해 주세요.';
      if (typeof onError === 'function') {
        onError(noUser);
      } else {
        console.error('[Strava] ' + noUser);
      }
      return;
    }

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

    var postUrl = gasUrl + (gasUrl.indexOf('?') >= 0 ? '&' : '?') + 'action=exchangeStravaCode';
    var payload = JSON.stringify({ code: code, user_id: userId });

    fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.success) {
          if (typeof onSuccess === 'function') {
            onSuccess(data);
          }
        } else {
          var msg = (data && data.error) ? data.error : 'Strava 연동 처리에 실패했습니다.';
          if (typeof onError === 'function') {
            onError(msg);
          } else {
            console.error('[Strava] ' + msg);
          }
        }
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : '네트워크 오류가 발생했습니다.';
        if (typeof onError === 'function') {
          onError(msg);
        } else {
          console.error('[Strava] ' + msg);
        }
      });
  }

  // 전역 노출
  global.connectStrava = connectStrava;
  global.handleStravaCallback = handleStravaCallback;
  global.getStravaRedirectUri = getRedirectUri;
  global.getStravaGasUrl = getGasUrl;

})(typeof window !== 'undefined' ? window : this);
