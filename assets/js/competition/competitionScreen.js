/**
 * 대회 화면 — competitions(공개, Firestore 직접 읽기) 카드 리스트 + 신청/취소 플로우.
 * window.competitionScreenInit()은 하단 네비 '대회' 탭 클릭 시 매번 호출된다(hubNavGoCompetition, index.html).
 */
(function () {
  var renderedOnce = false;

  function haptic(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
  }

  function getFirestoreFns() {
    if (!window.firestoreV9 || !window._firebaseFirestoreFns) return null;
    return { db: window.firestoreV9, fns: window._firebaseFirestoreFns };
  }

  async function fetchOpenCompetitions() {
    var ctx = getFirestoreFns();
    if (!ctx) return [];
    var fns = ctx.fns;
    var q = fns.query(
      fns.collection(ctx.db, 'competitions'),
      fns.where('status', '==', 'open')
    );
    var snap = await fns.getDocs(q);
    var rows = [];
    snap.forEach(function (d) {
      var data = typeof d.data === 'function' ? d.data() : {};
      rows.push(Object.assign({ id: d.id }, data));
    });
    return rows;
  }

  function formatEntryFee(fee) {
    var n = Number(fee) || 0;
    return n > 0 ? n.toLocaleString('ko-KR') + '원' : '무료';
  }

  function renderSkeleton(container) {
    container.innerHTML =
      '<div class="competition-card skeleton-card" aria-hidden="true">' +
      '  <div class="skeleton-line short"></div><div class="skeleton-line medium"></div><div class="skeleton-line"></div>' +
      '</div>' +
      '<div class="competition-card skeleton-card" aria-hidden="true">' +
      '  <div class="skeleton-line short"></div><div class="skeleton-line medium"></div><div class="skeleton-line"></div>' +
      '</div>';
  }

  function renderEmpty(container) {
    container.innerHTML = '<div class="competition-empty-state">현재 접수 중인 대회가 없습니다.</div>';
  }

  async function refreshRemainingLabel(competitionId, capacityFallback, labelEl, btnEl) {
    try {
      var status = await window.competitionApi.getCompetitionStatus(competitionId);
      if (!status || status.success === false) return;
      var remaining = Number(status.remaining) || 0;
      var capacity = Number(status.capacity) || capacityFallback || 0;
      if (remaining <= 0) {
        labelEl.textContent = '마감';
        labelEl.className = 'competition-card-remaining is-soldout';
        if (btnEl) {
          btnEl.disabled = true;
          btnEl.textContent = '마감되었습니다';
        }
      } else {
        labelEl.textContent = '잔여 ' + remaining + ' / ' + capacity + '명';
        labelEl.className = 'competition-card-remaining' + (remaining <= Math.max(3, capacity * 0.05) ? ' is-low' : '');
      }
    } catch (e) {
      // 잔여 인원 조회 실패는 조용히 무시 — 신청 버튼 자체는 계속 동작(서버가 최종 판정)
    }
  }

  function handleApplyResult(result, applyBtn) {
    if (!result || result.success === false) {
      if (result && result.reason === 'SOLD_OUT') {
        window.competitionBottomSheet.showSoldOutFeedback();
        applyBtn.disabled = true;
        applyBtn.textContent = '마감되었습니다';
      } else if (result && result.reason === 'CLOSED') {
        window.competitionBottomSheet.showSoldOutFeedback();
        applyBtn.textContent = '접수 기간이 아닙니다';
      } else {
        haptic(10);
        alert((result && result.error) || '신청에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        applyBtn.disabled = false;
        applyBtn.textContent = '신청하기';
      }
      return;
    }

    if (result.status === 'PAYMENT_COMPLETED') {
      applyBtn.textContent = '신청 완료';
      applyBtn.disabled = true;
      var wrap = applyBtn.parentElement;
      var refundBtn = document.createElement('button');
      refundBtn.type = 'button';
      refundBtn.className = 'competition-apply-btn';
      refundBtn.style.marginTop = '8px';
      refundBtn.style.background = '#f1f5f9';
      refundBtn.style.color = '#334155';
      refundBtn.textContent = '취소 및 환불';
      refundBtn.addEventListener('click', function () {
        haptic(10);
        window.competitionBottomSheet.showRefundFormSheet(result.applicationId, function (refundAccount) {
          return window.competitionApi.requestCompetitionRefund(result.applicationId, refundAccount).then(function (r) {
            if (!r || r.success === false) throw new Error((r && r.error) || '환불 신청 실패');
            applyBtn.textContent = '신청하기';
            applyBtn.disabled = false;
            refundBtn.remove();
          });
        });
      });
      if (wrap) wrap.appendChild(refundBtn);
      return;
    }

    // PAYMENT_WAITING(신규 발급 또는 기존 대기중 재조회) — 계좌 안내 시트
    applyBtn.textContent = '입금 대기중';
    applyBtn.disabled = true;
    window.competitionBottomSheet.showVirtualAccountSheet(result.virtualAccount || {});
  }

  function renderCard(comp) {
    var card = document.createElement('div');
    card.className = 'competition-card';
    var remainingId = 'competitionRemaining_' + comp.id;
    card.innerHTML =
      '<h3 class="competition-card-title">' + (comp.title || '대회') + '</h3>' +
      '<div class="competition-card-meta">' +
      '  <span>참가비 ' + formatEntryFee(comp.entryFee) + '</span>' +
      '  <span class="competition-card-remaining" id="' + remainingId + '">정원 확인 중...</span>' +
      '</div>' +
      '<button type="button" class="competition-apply-btn">신청하기</button>';

    var applyBtn = card.querySelector('.competition-apply-btn');
    var remainingEl = card.querySelector('#' + remainingId);

    refreshRemainingLabel(comp.id, comp.capacity, remainingEl, applyBtn);

    applyBtn.addEventListener('click', async function () {
      haptic(10);
      applyBtn.disabled = true;
      applyBtn.classList.add('is-loading');
      try {
        var result = await window.competitionApi.applyForCompetition(comp.id);
        applyBtn.classList.remove('is-loading');
        handleApplyResult(result, applyBtn);
      } catch (e) {
        applyBtn.classList.remove('is-loading');
        applyBtn.disabled = false;
        applyBtn.textContent = '신청하기';
        haptic(10);
        alert((e && e.message) || '신청에 실패했습니다.');
      }
    });

    return card;
  }

  async function renderCompetitionList() {
    var container = document.getElementById('competitionListContainer');
    if (!container) return;
    renderSkeleton(container);
    try {
      var list = await fetchOpenCompetitions();
      if (!list.length) {
        renderEmpty(container);
        return;
      }
      container.innerHTML = '';
      list.forEach(function (comp) {
        container.appendChild(renderCard(comp));
      });
    } catch (e) {
      console.warn('[competitionScreen] 대회 목록 로드 실패:', e && e.message ? e.message : e);
      container.innerHTML = '<div class="competition-empty-state">대회 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
    }
  }

  window.competitionScreenInit = function () {
    renderedOnce = true;
    renderCompetitionList();
  };
})();
