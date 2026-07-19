/**
 * 대회 선착순 신청 API 클라이언트 — 기존 fetch 패턴(index.html:27152-27163)과 동일:
 * window.authV9.currentUser.getIdToken(true) → Authorization: Bearer, cloudfunctions.net 절대 URL.
 */
(function () {
  var FUNCTIONS_BASE = 'https://asia-northeast3-stelvio-ai.cloudfunctions.net';

  async function getAuthToken() {
    if (
      typeof window.authV9 === 'undefined' ||
      !window.authV9.currentUser ||
      typeof window.authV9.currentUser.getIdToken !== 'function'
    ) {
      throw new Error('로그인이 필요합니다.');
    }
    return window.authV9.currentUser.getIdToken(true);
  }

  async function callAuthed(path, body) {
    var token = await getAuthToken();
    var res = await fetch(FUNCTIONS_BASE + '/' + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    });
    var json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok && !json) {
      throw new Error('요청 실패 HTTP ' + res.status);
    }
    return json;
  }

  async function applyForCompetition(competitionId, applicant) {
    return callAuthed('applyForCompetition', { competitionId: competitionId, applicant: applicant || null });
  }

  async function requestCompetitionRefund(applicationId, refundAccount) {
    return callAuthed('requestCompetitionRefund', {
      applicationId: applicationId,
      refundAccount: refundAccount,
    });
  }

  /** 입금 전(PAYMENT_WAITING) 신청 취소 — 결제된 건은 requestCompetitionRefund를 사용한다 */
  async function cancelCompetitionApplication(applicationId) {
    return callAuthed('cancelCompetitionApplication', { applicationId: applicationId });
  }

  /** 신청서 내용 수정 — 가상계좌·결제 상태는 변경하지 않고 applicant 필드만 갱신한다 */
  async function updateCompetitionApplication(applicationId, applicant) {
    return callAuthed('updateCompetitionApplication', { applicationId: applicationId, applicant: applicant });
  }

  /** 잔여 인원 조회 — 인증 불필요(공개 GET) */
  async function getCompetitionStatus(competitionId) {
    var res = await fetch(
      FUNCTIONS_BASE + '/getCompetitionStatus?competitionId=' + encodeURIComponent(competitionId)
    );
    var json = await res.json().catch(function () {
      return {};
    });
    return json;
  }

  window.competitionApi = {
    applyForCompetition: applyForCompetition,
    requestCompetitionRefund: requestCompetitionRefund,
    cancelCompetitionApplication: cancelCompetitionApplication,
    updateCompetitionApplication: updateCompetitionApplication,
    getCompetitionStatus: getCompetitionStatus,
  };
})();
