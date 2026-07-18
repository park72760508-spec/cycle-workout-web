/**
 * 대회 화면 — competitions(공개, Firestore 직접 읽기) 카드 리스트 + 신청/취소/상세보기 플로우.
 * 관리자(grade=1)는 전체 대회(모든 상태) + 생성/수정/삭제, 일반 사용자는 접수중(open) 대회 + 상세보기만 가능.
 * window.competitionScreenInit()은 하단 네비 '대회' 탭 클릭 시 매번 호출된다(hubNavGoCompetition, index.html).
 */
(function () {
  function haptic(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getFirestoreFns() {
    if (!window.firestoreV9 || !window._firebaseFirestoreFns) return null;
    return { db: window.firestoreV9, fns: window._firebaseFirestoreFns };
  }

  function isAdmin() {
    return !!(window.competitionAdminForm && window.competitionAdminForm.isAdmin());
  }

  async function fetchCompetitionsForList(admin) {
    var ctx = getFirestoreFns();
    if (!ctx) return [];
    var fns = ctx.fns;
    var q = admin
      ? fns.collection(ctx.db, 'competitions')
      : fns.query(fns.collection(ctx.db, 'competitions'), fns.where('status', '==', 'open'));
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

  function formatDateTimeKo(input) {
    if (!input) return '';
    var d = null;
    if (typeof input.toDate === 'function') d = input.toDate();
    else if (input instanceof Date) d = input;
    else d = new Date(input);
    if (!d || isNaN(d.getTime())) return '';
    return d.toLocaleString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
    });
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
      if (!status || status.success === false) return null;
      var remaining = Number(status.remaining) || 0;
      var capacity = Number(status.capacity) || capacityFallback || 0;
      var label;
      if (remaining <= 0) {
        label = '마감';
        if (labelEl) {
          labelEl.textContent = label;
          labelEl.className = 'competition-card-remaining is-soldout';
        }
        if (btnEl) {
          btnEl.disabled = true;
          btnEl.textContent = '마감되었습니다';
        }
      } else {
        label = '잔여 ' + remaining + ' / ' + capacity + '명';
        if (labelEl) {
          labelEl.textContent = label;
          labelEl.className = 'competition-card-remaining' + (remaining <= Math.max(3, capacity * 0.05) ? ' is-low' : '');
        }
      }
      return label;
    } catch (e) {
      return null;
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
      if (wrap && !wrap.querySelector('.competition-refund-btn')) {
        var refundBtn = document.createElement('button');
        refundBtn.type = 'button';
        refundBtn.className = 'competition-apply-btn competition-refund-btn';
        refundBtn.style.marginTop = '8px';
        refundBtn.style.background = '#f1f5f9';
        refundBtn.style.color = '#334155';
        refundBtn.textContent = '취소 및 환불';
        refundBtn.addEventListener('click', function (e) {
          e.stopPropagation();
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
        wrap.appendChild(refundBtn);
      }
      return;
    }

    // PAYMENT_WAITING(신규 발급 또는 기존 대기중 재조회) — 계좌 안내 시트
    applyBtn.textContent = '입금 대기중';
    applyBtn.disabled = true;
    window.competitionBottomSheet.showVirtualAccountSheet(result.virtualAccount || {});
  }

  /** 카드 버튼·상세시트 버튼 공용 신청 플로우 */
  async function applyToCompetitionFlow(comp, applyBtn) {
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
  }

  function openDetail(comp, admin, remainingLabel) {
    window.competitionBottomSheet.showDetailSheet(comp, {
      isAdmin: admin,
      remainingLabel: remainingLabel || '확인 중...',
      onApply: function (btn) {
        applyToCompetitionFlow(comp, btn);
      },
      onEdit: function () {
        window.competitionBottomSheet.closeSheet();
        window.competitionAdminForm.openForm(comp, renderCompetitionList);
      },
      onDelete: function () {
        window.competitionAdminForm.confirmAndDelete(comp, function () {
          window.competitionBottomSheet.closeSheet();
          renderCompetitionList();
        });
      },
    });
  }

  function renderCard(comp, admin) {
    var card = document.createElement('div');
    card.className = 'competition-card';
    var remainingId = 'competitionRemaining_' + comp.id;
    var statusBadge =
      admin && comp.status !== 'open'
        ? '<span style="font-size:11px;font-weight:700;color:#9ca3af;border:1px solid #e5e7eb;border-radius:6px;padding:2px 6px;margin-left:6px;">마감</span>'
        : '';
    var raceDateLabel = formatDateTimeKo(comp.raceDate) || '-';
    var locationLabel = comp.location ? escapeHtml(comp.location) : '-';

    card.innerHTML =
      '<h3 class="competition-card-title">' + escapeHtml(comp.title || '대회') + statusBadge + '</h3>' +
      '<div class="competition-card-info">' +
      '  <div class="competition-card-info-row"><img src="assets/img/day.png" class="competition-card-icon" alt="" />대회 일시 : ' + escapeHtml(raceDateLabel) + '</div>' +
      '  <div class="competition-card-info-row"><img src="assets/img/gps.png" class="competition-card-icon" alt="" />장소 : ' + locationLabel + '</div>' +
      '</div>' +
      '<div class="competition-card-meta">' +
      '  <span><img src="assets/img/profit.png" class="competition-card-icon" alt="" />참가비 ' + formatEntryFee(comp.entryFee) + '</span>' +
      '  <span><img src="assets/img/users.png" class="competition-card-icon" alt="" /><span class="competition-card-remaining" id="' + remainingId + '">정원 확인 중...</span></span>' +
      '</div>' +
      '<button type="button" class="competition-apply-btn">신청하기</button>';

    var applyBtn = card.querySelector('.competition-apply-btn');
    var remainingEl = card.querySelector('#' + remainingId);
    var lastRemainingLabel = '확인 중...';

    refreshRemainingLabel(comp.id, comp.capacity, remainingEl, applyBtn).then(function (label) {
      if (label) lastRemainingLabel = label;
    });

    applyBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      applyToCompetitionFlow(comp, applyBtn);
    });

    card.style.cursor = 'pointer';
    card.addEventListener('click', function () {
      openDetail(comp, admin, lastRemainingLabel);
    });

    return card;
  }

  async function renderCompetitionList() {
    var container = document.getElementById('competitionListContainer');
    if (!container) return;
    renderSkeleton(container);
    var admin = isAdmin();
    try {
      var list = await fetchCompetitionsForList(admin);
      var existingFab = document.getElementById('competitionAdminCreateFab');
      if (existingFab) existingFab.remove();
      if (admin) {
        // 제휴사 등록(.affiliate-fab-create)과 동일한 좌하단 원형 FAB
        var createBtn = document.createElement('button');
        createBtn.type = 'button';
        createBtn.id = 'competitionAdminCreateFab';
        createBtn.className = 'competition-fab-create fixed z-[100100] flex items-center justify-center rounded-full shadow-lg text-white text-2xl font-bold';
        createBtn.setAttribute('aria-label', '새 대회 만들기');
        createBtn.textContent = '+';
        createBtn.addEventListener('click', function () {
          window.competitionAdminForm.openForm(null, renderCompetitionList);
        });
        document.getElementById('competitionScreen').appendChild(createBtn);
      }

      if (!list.length) {
        renderEmpty(container);
        return;
      }
      container.innerHTML = '';
      list
        .sort(function (a, b) {
          return (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1);
        })
        .forEach(function (comp) {
          container.appendChild(renderCard(comp, admin));
        });
    } catch (e) {
      console.warn('[competitionScreen] 대회 목록 로드 실패:', e && e.message ? e.message : e);
      container.innerHTML = '<div class="competition-empty-state">대회 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
    }
  }

  window.competitionScreenInit = function () {
    renderCompetitionList();
  };
})();
