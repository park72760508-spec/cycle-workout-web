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

  function getCurrentUid() {
    try {
      return (window.authV9 && window.authV9.currentUser && window.authV9.currentUser.uid) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 내 신청 내역(PAYMENT_WAITING·PAYMENT_COMPLETED) — competitionId → race_applications 문서 맵.
   * 화면 재진입 시에도 "입금 대기중"/"신청 완료" 상태가 그대로 보이도록 카드 최초 렌더에 반영한다.
   */
  async function fetchMyApplicationsMap() {
    var map = new Map();
    var ctx = getFirestoreFns();
    var uid = getCurrentUid();
    if (!ctx || !uid) return map;
    try {
      var fns = ctx.fns;
      var q = fns.query(fns.collection(ctx.db, 'race_applications'), fns.where('userId', '==', uid));
      var snap = await fns.getDocs(q);
      snap.forEach(function (d) {
        var data = typeof d.data === 'function' ? d.data() : {};
        if (data.status === 'PAYMENT_WAITING' || data.status === 'PAYMENT_COMPLETED') {
          map.set(data.competitionId, Object.assign({ id: d.id }, data));
        }
      });
    } catch (e) {
      console.warn('[competitionScreen] 내 신청 내역 조회 실패:', e && e.message ? e.message : e);
    }
    return map;
  }

  /** 대회 일시(raceDate)·상태(status)·접수기간(opensAt/closesAt) 기준 목록 표시 상태 — 지난/접수중/예정 */
  function categorizeCompetition(comp) {
    var nowMs = Date.now();
    var raceMs = toDateMs(comp.raceDate);
    if (raceMs != null && raceMs < nowMs) {
      return { key: 'past', label: '종료' };
    }
    var opensMs = toDateMs(comp.opensAt);
    var closesMs = toDateMs(comp.closesAt);
    var withinWindow = (opensMs == null || nowMs >= opensMs) && (closesMs == null || nowMs <= closesMs);
    if (comp.status === 'open' && withinWindow) {
      return { key: 'open', label: '접수중' };
    }
    return { key: 'upcoming', label: '예정' };
  }

  function toDateMs(input) {
    if (!input) return null;
    var d = null;
    if (typeof input.toDate === 'function') d = input.toDate();
    else if (input instanceof Date) d = input;
    else d = new Date(input);
    return d && !isNaN(d.getTime()) ? d.getTime() : null;
  }

  function seoulYearOf(ms) {
    return Number(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date(ms))
    );
  }

  async function fetchCompetitionsForList() {
    var ctx = getFirestoreFns();
    if (!ctx) return [];
    var fns = ctx.fns;
    // 카드별 지난/접수중/예정 구분·연도 필터는 클라이언트에서 일괄 처리(전체 조회 — 대회 수가 많지 않아 인덱스 불필요)
    var snap = await fns.getDocs(fns.collection(ctx.db, 'competitions'));
    var rows = [];
    snap.forEach(function (d) {
      var data = typeof d.data === 'function' ? d.data() : {};
      rows.push(Object.assign({ id: d.id }, data));
    });
    var thisYear = seoulYearOf(Date.now());
    return rows.filter(function (comp) {
      var raceMs = toDateMs(comp.raceDate);
      // 대회 일시 미입력 건은 연도 필터를 적용할 수 없으므로 예정 목록에서 계속 보이도록 유지
      return raceMs == null || seoulYearOf(raceMs) === thisYear;
    });
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
    container.innerHTML = '<div class="competition-empty-state">올해 등록된 대회가 없습니다.</div>';
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

  function handleApplyResult(result, applyBtn, opts) {
    opts = opts || {};
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
    if (opts.autoOpenSheet !== false) {
      window.competitionBottomSheet.showVirtualAccountSheet(result.virtualAccount || {});
    }
  }

  /**
   * 화면 재진입 시 카드 최초 렌더에 내 신청 상태 반영 — handleApplyResult와 동일 표시 규칙,
   * 단 시트를 자동으로 열지 않는다(신청 직후 클릭 흐름과 달리 목록 진입만으로는 팝업 없음).
   * 입금 대기중인데 이미 기한이 지난 건은 무시(신청하기로 되돌아감) — 미입금 취소 스케줄이
   * 아직 처리 전이어도 사용자에게는 정상 신청 가능한 상태로 보여준다.
   */
  function applyExistingStateToButton(applyBtn, myApp) {
    if (!myApp || !applyBtn) return false;
    if (myApp.status === 'PAYMENT_COMPLETED') {
      handleApplyResult(
        { success: true, status: 'PAYMENT_COMPLETED', applicationId: myApp.id },
        applyBtn,
        { autoOpenSheet: false }
      );
      return true;
    }
    if (myApp.status === 'PAYMENT_WAITING') {
      var dueMs = toDateMs(myApp.paymentDueAt);
      if (dueMs == null || dueMs > Date.now()) {
        handleApplyResult(
          {
            success: true,
            status: 'PAYMENT_WAITING',
            applicationId: myApp.id,
            virtualAccount: myApp.virtualAccount || {},
          },
          applyBtn,
          { autoOpenSheet: false }
        );
        return true;
      }
    }
    return false;
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
    var category = categorizeCompetition(comp);
    window.competitionBottomSheet.showDetailSheet(comp, {
      isAdmin: admin,
      remainingLabel: category.key === 'past' ? '종료' : remainingLabel || '확인 중...',
      hideApply: category.key === 'past',
      applyDisabledLabel: category.key === 'upcoming' ? '접수 예정' : null,
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

  function renderCard(comp, admin, myApp) {
    var category = categorizeCompetition(comp);
    var card = document.createElement('div');
    card.className = 'competition-card is-' + category.key;
    var remainingId = 'competitionRemaining_' + comp.id;
    var statusBadge = '<span class="competition-status-badge is-' + category.key + '">' + category.label + '</span>';
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
      (category.key === 'past'
        ? ''
        : '<button type="button" class="competition-apply-btn">' + (category.key === 'upcoming' ? '접수 예정' : '신청하기') + '</button>');

    var applyBtn = card.querySelector('.competition-apply-btn');
    var remainingEl = card.querySelector('#' + remainingId);
    var lastRemainingLabel = '확인 중...';
    var hasExistingApp = applyBtn && category.key === 'open' && applyExistingStateToButton(applyBtn, myApp);

    if (category.key !== 'past') {
      // 이미 입금 대기중/신청 완료 상태면 잔여 인원 조회로 버튼을 덮어쓰지 않는다(라벨 텍스트만 갱신)
      refreshRemainingLabel(comp.id, comp.capacity, remainingEl, hasExistingApp ? null : applyBtn).then(function (label) {
        if (label) lastRemainingLabel = label;
      });
    }

    if (applyBtn) {
      if (category.key === 'upcoming') {
        applyBtn.disabled = true;
      } else {
        // hasExistingApp이면 handleApplyResult가 이미 disabled 처리 — 클릭 리스너는 항상 붙여둬서
        // 환불 성공 후 버튼이 다시 활성화됐을 때(신청하기로 복귀) 정상 동작하도록 한다.
        applyBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          applyToCompetitionFlow(comp, applyBtn);
        });
      }
    }

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
      var listAndMyApps = await Promise.all([fetchCompetitionsForList(), fetchMyApplicationsMap()]);
      var list = listAndMyApps[0];
      var myAppsMap = listAndMyApps[1];
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
      var categoryOrder = { open: 0, upcoming: 1, past: 2 };
      list
        .map(function (comp) {
          return { comp: comp, category: categorizeCompetition(comp).key, raceMs: toDateMs(comp.raceDate) || 0 };
        })
        .sort(function (a, b) {
          var byCategory = categoryOrder[a.category] - categoryOrder[b.category];
          if (byCategory !== 0) return byCategory;
          // 접수중·예정은 임박한 순, 종료는 최근 종료 순
          return a.category === 'past' ? b.raceMs - a.raceMs : a.raceMs - b.raceMs;
        })
        .forEach(function (entry) {
          container.appendChild(renderCard(entry.comp, admin, myAppsMap.get(entry.comp.id)));
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
