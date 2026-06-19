/**
 * 계정 및 연동 데이터 영구 삭제 (앱 스토어·개인정보처리방침 대응)
 */
(function () {
  'use strict';

  var ACCOUNT_DELETION_URL = 'https://stelvio.ai.kr/delete-account.html';
  var CONFIRM_PHRASE = '삭제';

  function getDeleteAccountUrl() {
    var cfg =
      typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG
        ? window.STELVIO_SUPABASE_CONFIG
        : {};
    if (cfg.deleteUserAccountUrl) {
      return String(cfg.deleteUserAccountUrl).trim();
    }
    var projectId =
      (window.__FIREBASE_CONFIG__ && window.__FIREBASE_CONFIG__.projectId) ||
      'stelvio-ai';
    return (
      'https://us-central1-' +
      projectId +
      '.cloudfunctions.net/deleteUserAccountHttp'
    );
  }

  function getAuthUser() {
    return (
      (window.authV9 && window.authV9.currentUser) ||
      (window.auth && window.auth.currentUser) ||
      null
    );
  }

  async function signOutLocally() {
    try {
      if (window.auth && window.auth.signOut) await window.auth.signOut();
    } catch (e1) {}
    try {
      if (window.authV9) {
        var signOutMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
        if (signOutMod && signOutMod.signOut) await signOutMod.signOut(window.authV9);
      }
    } catch (e2) {}
    window.currentUser = null;
    try {
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authUser');
    } catch (eLs) {}
    if (typeof window !== 'undefined') window.isPhoneAuthenticated = false;
  }

  /**
   * 본인 계정·연동 데이터 영구 삭제
   * @returns {Promise<{success:boolean, error?:string}>}
   */
  async function requestAccountAndDataDeletion() {
    var user = getAuthUser();
    if (!user || typeof user.getIdToken !== 'function') {
      return { success: false, error: '로그인이 필요합니다.' };
    }

    var intro =
      '계정과 아래 데이터가 영구 삭제되며 복구할 수 없습니다.\n\n' +
      '• 프로필(이름, 연락처, FTP·체중 등)\n' +
      '• Strava 연동 토큰 및 동기화 활동 기록\n' +
      '• 훈련 일지·랭킹·대시보드 데이터\n' +
      '• Firebase·Supabase에 저장된 개인정보\n\n' +
      '계속하시려면 확인란에 「' + CONFIRM_PHRASE + '」를 입력해 주세요.';

    var typed = window.prompt(intro, '');
    if (typed == null) {
      return { success: false, error: 'cancelled' };
    }
    if (String(typed).trim() !== CONFIRM_PHRASE) {
      return { success: false, error: '확인 문구가 일치하지 않습니다.' };
    }

    if (!window.confirm('정말로 계정과 모든 연동 데이터를 영구 삭제하시겠습니까?')) {
      return { success: false, error: 'cancelled' };
    }

    var url = getDeleteAccountUrl();
    try {
      var token = await user.getIdToken(true);
      var res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ confirmPhrase: CONFIRM_PHRASE })
      });
      var json = null;
      try {
        json = await res.json();
      } catch (eJson) {
        json = { success: false, error: { message: 'invalid_json' } };
      }
      if (!res.ok || !json || json.success === false) {
        var msg =
          (json && json.error && json.error.message) ||
          (json && json.error) ||
          '계정 삭제 요청이 실패했습니다.';
        return { success: false, error: String(msg) };
      }

      await signOutLocally();
      if (typeof window.closeSettingsModal === 'function') {
        window.closeSettingsModal();
      }
      if (typeof window.showScreen === 'function') {
        window.showScreen('authScreen');
      }
      if (typeof window.showToast === 'function') {
        window.showToast('계정과 연동 데이터가 삭제되었습니다.', 'success');
      }
      return { success: true };
    } catch (e) {
      console.error('[accountDeletion]', e);
      return { success: false, error: e && e.message ? e.message : String(e) };
    }
  }

  function openAccountDeletionInfo() {
    if (typeof window.openStelvioExternalUrl === 'function') {
      window.openStelvioExternalUrl(ACCOUNT_DELETION_URL);
    } else {
      window.open(ACCOUNT_DELETION_URL, '_blank', 'noopener,noreferrer');
    }
  }

  if (typeof window !== 'undefined') {
    window.STELVIO_ACCOUNT_DELETION_URL = ACCOUNT_DELETION_URL;
    window.requestAccountAndDataDeletion = requestAccountAndDataDeletion;
    window.openAccountDeletionInfo = openAccountDeletionInfo;
  }
})();
