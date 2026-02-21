/**
 * STELVIO AI - 사용자 선택형 FTP 갱신 및 보수적 하락 알림
 * FtpSuggestionModal 공통 베이스, UPGRADE/DECAY 테마별 렌더링.
 * '예' 선택 시에만 confirmFtp API 호출 후 DB 반영.
 */
(function (global) {
  'use strict';

  var FTP_SUGGESTION_DISMISSED_KEY = 'stelvio_ftp_suggestion_dismissed_until';
  var COOLDOWN_DAYS = 7;

  function getProjectId() {
    try {
      if (window.authV9 && window.authV9.app && window.authV9.app.options && window.authV9.app.options.projectId) {
        return window.authV9.app.options.projectId;
      }
      if (typeof __FIREBASE_CONFIG__ !== 'undefined' && window.__FIREBASE_CONFIG__ && window.__FIREBASE_CONFIG__.projectId) {
        return window.__FIREBASE_CONFIG__.projectId;
      }
    } catch (e) {}
    return 'stelvio-ai';
  }

  function getFtpSuggestionUrl() {
    return 'https://us-central1-' + getProjectId() + '.cloudfunctions.net/getFtpSuggestion';
  }

  function getConfirmFtpUrl() {
    return 'https://us-central1-' + getProjectId() + '.cloudfunctions.net/confirmFtp';
  }

  /** 쿨타임 확인: '아니오' 선택 후 7일 동안 같은 알림 비표시 */
  function isDismissedWithinCooldown() {
    try {
      var until = localStorage.getItem(FTP_SUGGESTION_DISMISSED_KEY);
      if (!until) return false;
      var untilMs = parseInt(until, 10);
      if (isNaN(untilMs)) return false;
      return Date.now() < untilMs;
    } catch (e) {
      return false;
    }
  }

  function setDismissedCooldown() {
    try {
      var until = Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(FTP_SUGGESTION_DISMISSED_KEY, String(until));
    } catch (e) {}
  }

  /** FTP 제안 API 호출 (계산만, DB 미수정) */
  async function getFtpSuggestionFromApi() {
    var authUser = (window.authV9 && window.authV9.currentUser) ? window.authV9.currentUser : null;
    if (!authUser || typeof authUser.getIdToken !== 'function') {
      return { hasSuggestion: false };
    }
    var idToken;
    try {
      idToken = await authUser.getIdToken();
    } catch (e) {
      console.warn('[FtpSuggestion] getIdToken 실패:', e);
      return { hasSuggestion: false };
    }
    var url = getFtpSuggestionUrl();
    var res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + idToken }
    });
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      return { hasSuggestion: false };
    }
    if (!res.ok) {
      if (data && data.error && data.error.message) console.warn('[FtpSuggestion] API 오류:', data.error.message);
      return { hasSuggestion: false };
    }
    return data;
  }

  /** FTP 승인 API 호출 (POST, DB 반영) */
  async function confirmFtpApi(suggestedFtp) {
    var authUser = (window.authV9 && window.authV9.currentUser) ? window.authV9.currentUser : null;
    if (!authUser || typeof authUser.getIdToken !== 'function') {
      return { success: false, error: '로그인이 필요합니다.' };
    }
    var idToken;
    try {
      idToken = await authUser.getIdToken();
    } catch (e) {
      return { success: false, error: e.message || '토큰을 가져올 수 없습니다.' };
    }
    var url = getConfirmFtpUrl();
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
      body: JSON.stringify({ suggestedFtp: suggestedFtp })
    });
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      return { success: false, error: '응답을 읽을 수 없습니다.' };
    }
    if (!res.ok) {
      var msg = (data && data.error && data.error.message) ? data.error.message : 'FTP 반영에 실패했습니다.';
      return { success: false, error: msg };
    }
    return { success: true, ftp: data.ftp };
  }

  function createModalContainer() {
    var id = 'ftpSuggestionModalContainer';
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
  }

  /**
   * 공통 FtpSuggestionModal 렌더링
   * @param {Object} opts - { type: 'UPGRADE'|'DECAY', previousFtp, suggestedFtp, userName, onConfirm, onDecline }
   */
  function renderFtpSuggestionModal(opts) {
    opts = opts || {};
    var type = opts.type === 'DECAY' ? 'DECAY' : 'UPGRADE';
    var previousFtp = Number(opts.previousFtp) || 0;
    var suggestedFtp = Number(opts.suggestedFtp) || 0;
    var userName = (opts.userName && String(opts.userName).trim()) || '사용자';
    var onConfirm = typeof opts.onConfirm === 'function' ? opts.onConfirm : function () {};
    var onDecline = typeof opts.onDecline === 'function' ? opts.onDecline : function () {};

    var container = createModalContainer();
    var isUpgrade = type === 'UPGRADE';

    var title = isUpgrade ? '축하합니다!' : '휴식을 잘 취하셨네요';
    var subtitle = isUpgrade
      ? userName + '님의 땀방울이 만든 결과입니다.'
      : '최근 꿀맛 같은 휴식을 취하셨군요!';
    var bodyText = isUpgrade
      ? '기존 FTP ' + previousFtp + 'W에서 ' + suggestedFtp + 'W로 상승하였습니다. 새로운 FTP 값을 훈련에 반영할까요?'
      : '지성님의 현재 컨디션에 맞춰 훈련 강도를 무리 없이 조절하는 것을 추천합니다. 기존 FTP ' + previousFtp + 'W에서 ' + suggestedFtp + 'W로 조정되었습니다. 변경된 FTP 값을 반영하여 가벼운 라이딩부터 다시 시작해 볼까요?';
    if (!isUpgrade) bodyText = bodyText.replace('지성님', userName + '님');

    var themeClass = isUpgrade ? 'ftp-modal-upgrade' : 'ftp-modal-decay';
    var icon = isUpgrade ? '🎉' : '🌿';

    container.innerHTML =
      '<div id="ftpSuggestionModalBackdrop" class="ftp-modal-backdrop ' + themeClass + '" role="dialog" aria-modal="true" aria-labelledby="ftp-modal-title">' +
        '<div class="ftp-modal-box">' +
          '<div class="ftp-modal-icon">' + icon + '</div>' +
          '<h2 id="ftp-modal-title" class="ftp-modal-title">' + title + '</h2>' +
          '<p class="ftp-modal-subtitle">' + subtitle + '</p>' +
          '<p class="ftp-modal-body">' + bodyText + '</p>' +
          '<div class="ftp-modal-actions">' +
            '<button type="button" id="ftpModalBtnConfirm" class="ftp-modal-btn ftp-modal-btn-primary">예, 적용합니다</button>' +
            '<button type="button" id="ftpModalBtnDecline" class="ftp-modal-btn ftp-modal-btn-secondary">' + (isUpgrade ? '아니오, 유지할게요' : '아니오, 현재 값 유지') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var backdrop = container.querySelector('#ftpSuggestionModalBackdrop');
    var btnConfirm = container.querySelector('#ftpModalBtnConfirm');
    var btnDecline = container.querySelector('#ftpModalBtnDecline');

    function closeModal() {
      if (backdrop && backdrop.parentNode) {
        backdrop.classList.add('ftp-modal-closing');
        setTimeout(function () {
          container.innerHTML = '';
        }, 300);
      }
    }

    function handleConfirm() {
      if (btnConfirm.disabled) return;
      btnConfirm.disabled = true;
      btnConfirm.textContent = '적용 중...';
      var spinner = document.createElement('span');
      spinner.className = 'ftp-modal-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      btnConfirm.insertBefore(spinner, btnConfirm.firstChild);

      onConfirm(suggestedFtp)
        .then(function (ok) {
          if (ok !== false) closeModal();
          else { btnConfirm.disabled = false; btnConfirm.textContent = '예, 적용합니다'; var s = btnConfirm.querySelector('.ftp-modal-spinner'); if (s) s.remove(); }
        })
        .catch(function () {
          btnConfirm.disabled = false;
          btnConfirm.textContent = '예, 적용합니다';
          var s = btnConfirm.querySelector('.ftp-modal-spinner');
          if (s) s.remove();
        });
    }

    function handleDecline() {
      setDismissedCooldown();
      onDecline();
      closeModal();
    }

    btnConfirm.addEventListener('click', handleConfirm);
    btnDecline.addEventListener('click', handleDecline);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) handleDecline();
    });

    requestAnimationFrame(function () {
      backdrop.classList.add('ftp-modal-visible');
    });

    if (isUpgrade && typeof global.confetti === 'function') {
      try {
        global.confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
        setTimeout(function () {
          global.confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0.4 } });
          global.confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 0.6 } });
        }, 200);
      } catch (e) {}
    }

    return { close: closeModal };
  }

  /** 주간 TOP10 모달이 열려 있으면 true (FTP 모달과 충돌 방지용) */
  function isWeeklyTop10ModalVisible() {
    var el = document.getElementById('weeklyTop10Modal');
    return el && !el.classList.contains('hidden');
  }

  /**
   * 제안 확인 후 모달 표시 (쿨타임·로그인 체크 포함)
   * 주간 TOP10 팝업이 열려 있으면 표시하지 않고, 닫힌 뒤에만 FTP 제안 표시 (TOP10과 충돌 방지).
   * @param {number} [deferCount] - TOP10 대기로 인한 지연 횟수 (최대 10회)
   */
  async function checkFtpSuggestionAndShow(deferCount) {
    deferCount = deferCount || 0;
    if (deferCount > 10) return;
    if (isDismissedWithinCooldown()) return;
    var authUser = (window.authV9 && window.authV9.currentUser) ? window.authV9.currentUser : null;
    if (!authUser) return;

    if (isWeeklyTop10ModalVisible()) {
      setTimeout(function () { checkFtpSuggestionAndShow(deferCount + 1); }, 2000);
      return;
    }

    var data = await getFtpSuggestionFromApi();
    if (!data || !data.hasSuggestion || !data.suggestionType) return;

    var userName = data.userName || (window.currentUser && window.currentUser.name) || '사용자';
    var previousFtp = data.previousFtp || 0;
    var suggestedFtp = data.suggestedFtp || 0;

    renderFtpSuggestionModal({
      type: data.suggestionType,
      previousFtp: previousFtp,
      suggestedFtp: suggestedFtp,
      userName: userName,
      onConfirm: function (suggestedFtpValue) {
        return confirmFtpApi(suggestedFtpValue).then(function (result) {
          if (result.success) {
            if (window.currentUser) window.currentUser.ftp = result.ftp;
            try {
              var cur = JSON.parse(localStorage.getItem('currentUser') || '{}');
              cur.ftp = result.ftp;
              localStorage.setItem('currentUser', JSON.stringify(cur));
            } catch (e) {}
            if (typeof global.showToast === 'function') {
              global.showToast('FTP가 ' + result.ftp + 'W로 반영되었습니다.');
            }
            return true;
          }
          if (typeof global.showToast === 'function') global.showToast(result.error || '반영에 실패했습니다.');
          return false;
        });
      },
      onDecline: function () {}
    });
  }

  function injectStyles() {
    var id = 'ftpSuggestionModalStyles';
    if (document.getElementById(id)) return;
    var css =
      '.ftp-modal-backdrop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 999999; opacity: 0; transition: opacity 0.3s ease; }' +
      '.ftp-modal-backdrop.ftp-modal-visible { opacity: 1; }' +
      '.ftp-modal-backdrop.ftp-modal-closing { opacity: 0; }' +
      '.ftp-modal-box { background: #fff; border-radius: 16px; padding: 28px 24px; max-width: 400px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.25); text-align: center; }' +
      '.ftp-modal-upgrade .ftp-modal-box { border: 2px solid #ffd700; background: linear-gradient(180deg, #fffef5 0%, #fff 100%); }' +
      '.ftp-modal-decay .ftp-modal-box { border: 2px solid #87ceeb; background: linear-gradient(180deg, #f0f9ff 0%, #fff 100%); }' +
      '.ftp-modal-icon { font-size: 3em; margin-bottom: 12px; }' +
      '.ftp-modal-title { font-size: 1.4em; font-weight: 700; margin: 0 0 8px 0; color: #1a1a1a; }' +
      '.ftp-modal-subtitle { font-size: 0.95em; color: #555; margin: 0 0 12px 0; }' +
      '.ftp-modal-body { font-size: 0.95em; line-height: 1.6; color: #333; margin: 0 0 24px 0; }' +
      '.ftp-modal-actions { display: flex; flex-direction: column; gap: 10px; }' +
      '.ftp-modal-btn { padding: 14px 20px; border-radius: 10px; font-size: 1em; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; }' +
      '.ftp-modal-btn-primary { background: linear-gradient(135deg, #00d4aa 0%, #00a88a 100%); color: #000; }' +
      '.ftp-modal-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,212,170,0.4); }' +
      '.ftp-modal-btn-primary:disabled { opacity: 0.8; cursor: not-allowed; }' +
      '.ftp-modal-btn-secondary { background: #f0f0f0; color: #333; }' +
      '.ftp-modal-btn-secondary:hover { background: #e0e0e0; }' +
      '.ftp-modal-spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(0,0,0,0.2); border-top-color: #000; border-radius: 50%; animation: ftp-spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }' +
      '@keyframes ftp-spin { to { transform: rotate(360deg); } }';
    var style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  injectStyles();

  if (typeof global !== 'undefined') {
    global.checkFtpSuggestionAndShow = checkFtpSuggestionAndShow;
    global.getFtpSuggestionFromApi = getFtpSuggestionFromApi;
    global.confirmFtpApi = confirmFtpApi;
    global.renderFtpSuggestionModal = renderFtpSuggestionModal;
  }
})(typeof window !== 'undefined' ? window : this);
