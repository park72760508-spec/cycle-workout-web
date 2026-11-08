/**
 * 훈련 결과 미전송 큐 (2026-11-08)
 * - 훈련 종료 시 서버(Firestore) 저장이 실패하면 기기에 보관했다가, 로그인·앱 시작·네트워크 복구 시 자동으로 다시 저장한다.
 * - 같은 세션은 save_key 로 한 번만 저장(saveTrainingSession 이 멱등 처리)되므로 재전송해도 중복·이중 적립이 없다.
 * - 결과 팝업은 "결과 확인" 전용: 저장은 훈련 종료 시 자동 수행되고, 저장 상태 문구만 표시한다.
 */
(function () {
  var KEY = 'stelvio_pending_training';
  var MAX_ITEMS = 5;
  var running = false;

  function readQueue() {
    try { var a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function writeQueue(q) {
    try { localStorage.setItem(KEY, JSON.stringify(q)); return true; } catch (e) {
      // 용량 초과: 큰 배열(파워·심박 스트림)을 덜어내고 요약값만 보관
      try {
        var slim = q.map(function (it) {
          var td = Object.assign({}, it.trainingData); delete td.powerData; delete td.hrData; delete td.cadenceData;
          return Object.assign({}, it, { trainingData: td, slim: true });
        });
        localStorage.setItem(KEY, JSON.stringify(slim)); return true;
      } catch (e2) { return false; }
    }
  }

  window.stelvioQueuePendingTraining = function (payload) {
    if (!payload || !payload.userId || !payload.trainingData) return;
    var q = readQueue().filter(function (it) { return it.trainingData && it.trainingData.save_key !== payload.trainingData.save_key; });
    q.push(payload);
    while (q.length > MAX_ITEMS) q.shift();
    writeQueue(q);
    console.warn('[pendingTraining] 서버 저장 실패 → 미전송 큐에 보관', payload.trainingData.save_key);
  };

  window.stelvioRetryPendingTraining = async function () {
    if (running) return;
    var q = readQueue();
    if (!q.length) return;
    if (typeof window.saveTrainingSession !== 'function') return;
    var uid = window.currentUser && (window.currentUser.id || window.currentUser.uid);
    if (!uid) return;
    if (navigator.onLine === false) return;
    running = true;
    var saved = 0;
    try {
      var rest = [];
      for (var i = 0; i < q.length; i++) {
        var it = q[i];
        if (it.userId !== uid) { rest.push(it); continue; }
        try {
          var r = await window.saveTrainingSession(it.userId, it.trainingData);
          if (r && r.success) { saved++; continue; }
          rest.push(it);
        } catch (e) {
          console.warn('[pendingTraining] 재전송 실패(다음에 다시 시도):', e && e.message ? e.message : e);
          rest.push(it);
        }
      }
      writeQueue(rest);
      if (saved && typeof window.showToast === 'function') {
        window.showToast('저장되지 않았던 훈련 기록 ' + saved + '건을 저장했습니다');
        try { window.dispatchEvent(new CustomEvent('stelvio:training-saved')); } catch (e) {}
      }
    } finally { running = false; }
  };

  var TXT = {
    saved: '훈련 결과가 저장되었습니다',
    pending: '서버 연결이 불안정해 기기에 보관했습니다 · 연결되면 자동으로 저장됩니다'
  };
  window.stelvioShowSaveStatus = function (state) {
    var t = TXT[state]; if (!t) return;
    var els = document.querySelectorAll('#mobileTrainingResultModal .mobile-result-subtitle, .indiv-result-subtitle');
    for (var i = 0; i < els.length; i++) els[i].textContent = t;
    if (state === 'pending' && typeof window.showToast === 'function') window.showToast('서버 저장 지연 — 기기에 보관, 연결되면 자동 저장됩니다', 'warning');
  };

  // 자동 재전송 트리거: 앱 시작(로그인 대기, 최대 2분) · 네트워크 복구 · 화면 복귀
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (!readQueue().length || tries > 24) { clearInterval(timer); return; }
    window.stelvioRetryPendingTraining();
  }, 5000);
  window.addEventListener('online', function () { setTimeout(window.stelvioRetryPendingTraining, 1500); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(window.stelvioRetryPendingTraining, 1500); });
})();
