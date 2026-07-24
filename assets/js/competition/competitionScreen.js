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

  /** 카드 라인 아이콘 — assets/img에 없는 파일(day/gps/profit/users.png)을 대체하는 인라인 SVG */
  function cardIcon(inner) {
    return (
      '<svg class="competition-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'
    );
  }
  var CARD_ICON_CALENDAR = '<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>';
  var CARD_ICON_MAP_PIN = '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle>';
  var CARD_ICON_CARD = '<rect x="1" y="4" width="22" height="16" rx="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line>';
  var CARD_ICON_USERS =
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle>' +
    '<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>';

  /** 카드용 D-Day — 대회 상세 히어로 배지와 동일 규칙(competitionBottomSheet.computeDDayInfo) */
  function computeCardDDay(comp) {
    var nowMs = Date.now();
    var raceMs = toDateMs(comp.raceDate);
    var opensMs = toDateMs(comp.opensAt);
    var closesMs = toDateMs(comp.closesAt);
    if (raceMs != null && raceMs < nowMs) return null;
    if (opensMs != null && nowMs < opensMs) {
      return { label: '접수 D-' + Math.max(0, Math.ceil((opensMs - nowMs) / 86400000)), tone: 'upcoming' };
    }
    if (closesMs != null && nowMs <= closesMs) {
      var days = Math.floor((closesMs - nowMs) / 86400000);
      return { label: days <= 0 ? '오늘 마감' : '마감 D-' + days, tone: 'open' };
    }
    return null;
  }

  function getFirestoreFns() {
    if (!window.firestoreV9 || !window._firebaseFirestoreFns) return null;
    return { db: window.firestoreV9, fns: window._firebaseFirestoreFns };
  }

  /**
   * window.firestoreV9 준비를 기다린다(라이딩 모임 달력의 waitForFirestoreV9와 동일 취지 —
   * assets/js/stelvioDeferredModules.js:117-145 참고). 'stelvio-firestoreV9-ready' 이벤트를
   * 우선 신호로 쓰고, 리스너 등록 전에 이미 dispatch됐을 레이스에 대비해 짧은 폴백 폴링을 병행한다.
   *
   * 이 화면은 하단 네비 클릭 시 고정 150ms setTimeout 이후 호출되는데, gstatic CDN에서 Firebase SDK를
   * 내려받는 게 느린 환경(모바일 셀룰러·콜드 스타트)에서는 150ms 안에 firestoreV9가 준비되지 않아
   * getFirestoreFns()가 null을 반환 → 목록이 "없음"으로 조용히 렌더되는 게 간헐적 빈 목록의 원인이었다.
   */
  function waitForFirestoreV9(maxMs) {
    return new Promise(function (resolve) {
      if (window.firestoreV9 && window._firebaseFirestoreFns) {
        resolve();
        return;
      }
      var done = false;
      var pollId = null;
      function finish() {
        if (done) return;
        done = true;
        try {
          window.removeEventListener('stelvio-firestoreV9-ready', onReady);
        } catch (eRm) {}
        if (pollId) clearInterval(pollId);
        resolve();
      }
      function onReady() {
        if (window.firestoreV9 && window._firebaseFirestoreFns) finish();
      }
      try {
        window.addEventListener('stelvio-firestoreV9-ready', onReady);
      } catch (eAdd) {}
      pollId = setInterval(function () {
        if (window.firestoreV9 && window._firebaseFirestoreFns) finish();
      }, 100);
      setTimeout(finish, maxMs || 8000);
    });
  }

  function isAdmin() {
    return !!(window.competitionAdminForm && window.competitionAdminForm.isAdmin());
  }

  /** 현재 진입한 하단 네비 스포츠(CYCLE/RUN) — 대회 목록은 이 카테고리에 해당하는 대회만 표시한다 */
  function getActiveCompetitionCategory() {
    try {
      if (window.sportCategoryRoutes && typeof window.sportCategoryRoutes.getActiveSport === 'function') {
        return window.sportCategoryRoutes.getActiveSport() === 'run' ? 'RUN' : 'CYCLE';
      }
    } catch (e) {}
    return 'CYCLE';
  }

  function getCurrentUid() {
    try {
      return (window.authV9 && window.authV9.currentUser && window.authV9.currentUser.uid) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 승인제 노출 규칙 — approvalStatus 미지정(승인제 도입 이전 문서)·APPROVED는 누구나,
   * PENDING·REJECTED는 생성자 본인과 관리자만 볼 수 있다(stelvio_riding_groups와 동일 패턴).
   */
  function isCompetitionVisible(comp, admin, uid) {
    var status = comp.approvalStatus;
    if (!status || status === 'APPROVED') return true;
    if (admin) return true;
    return !!uid && comp.createdBy === uid;
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

  /**
   * 내 대기자 등록 내역(WAITING·INVITED) — competitionId → race_waitlist 문서 맵.
   * 마감 이후 취소로 자리가 나 초대(INVITED)되면 신청하기가 활성화되도록 카드/상세에 반영한다.
   */
  async function fetchMyWaitlistMap() {
    var map = new Map();
    var ctx = getFirestoreFns();
    var uid = getCurrentUid();
    if (!ctx || !uid) return map;
    try {
      var fns = ctx.fns;
      var q = fns.query(fns.collection(ctx.db, 'race_waitlist'), fns.where('userId', '==', uid));
      var snap = await fns.getDocs(q);
      snap.forEach(function (d) {
        var data = typeof d.data === 'function' ? d.data() : {};
        if (data.status === 'WAITING' || data.status === 'INVITED') {
          map.set(data.competitionId, Object.assign({ id: d.id }, data));
        }
      });
    } catch (e) {
      console.warn('[competitionScreen] 내 대기자 등록 내역 조회 실패:', e && e.message ? e.message : e);
    }
    return map;
  }

  /** 마감 이후 취소로 대기자 1순위로 초대(INVITED)되어 아직 유효한지 — 신청하기를 예외적으로 활성화한다 */
  function getActiveWaitlistInvite(myWaitlist) {
    if (!myWaitlist || myWaitlist.status !== 'INVITED') return null;
    var expiresMs = toDateMs(myWaitlist.inviteExpiresAt);
    return expiresMs != null && expiresMs > Date.now() ? myWaitlist : null;
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

  /**
   * 대회 목록 원본 조회.
   * 관리자는 전체 컬렉션을 필터 없이 읽는다(firestore.rules상 관리자는 모든 문서에서 항상 허용되므로
   * list 쿼리가 문제없이 통과한다).
   * 일반 사용자(비로그인 포함)는 반드시 규칙이 문서 단위가 아니라 쿼리 단위로 증명 가능한 where 절을 써야 한다 —
   * Firestore는 list 쿼리 결과에 규칙을 통과하지 못하는 문서가 하나라도 섞이면 쿼리 전체를 permission-denied로
   * 거부하기 때문에(부분 필터링이 아님), 필터 없는 조회를 쓰면 다른 사람의 PENDING/REJECTED 대회가 하나라도
   * 있는 순간 전체 목록 조회가 실패한다. 그래서 승인된 것 + 내가 만든 것(로그인 시) 두 쿼리로 나눠 합친다.
   */
  async function fetchCompetitionsForList() {
    var ctx = getFirestoreFns();
    if (!ctx) return [];
    var fns = ctx.fns;
    var admin = isAdmin();
    var uid = getCurrentUid();
    var rows = [];
    var col = fns.collection(ctx.db, 'competitions');
    if (admin) {
      var snap = await fns.getDocs(col);
      snap.forEach(function (d) {
        var data = typeof d.data === 'function' ? d.data() : {};
        rows.push(Object.assign({ id: d.id }, data));
      });
      // 승인제 도입 이전(approvalStatus 필드 없는) 기존 대회를 자동으로 APPROVED 처리 —
      // 그래야 아래 일반 사용자용 where('approvalStatus','==','APPROVED') 쿼리에도 노출된다.
      if (window.competitionAdminForm && typeof window.competitionAdminForm.backfillLegacyApprovalStatus === 'function') {
        window.competitionAdminForm.backfillLegacyApprovalStatus(rows).catch(function (e) {
          console.warn('[competitionScreen] 승인 상태 자동 보정 실패:', e && e.message ? e.message : e);
        });
      }
    } else {
      var queries = [fns.getDocs(fns.query(col, fns.where('approvalStatus', '==', 'APPROVED')))];
      if (uid) {
        queries.push(fns.getDocs(fns.query(col, fns.where('createdBy', '==', uid))));
      }
      var snaps = await Promise.all(queries);
      var seen = {};
      snaps.forEach(function (s) {
        s.forEach(function (d) {
          if (seen[d.id]) return;
          seen[d.id] = true;
          var data = typeof d.data === 'function' ? d.data() : {};
          rows.push(Object.assign({ id: d.id }, data));
        });
      });
    }
    var thisYear = seoulYearOf(Date.now());
    var activeCategory = getActiveCompetitionCategory();
    // 카드별 지난/접수중/예정 구분·연도 필터는 클라이언트에서 일괄 처리(대회 수가 많지 않아 인덱스 불필요)
    return rows.filter(function (comp) {
      var raceMs = toDateMs(comp.raceDate);
      // 종목 미입력 건(종목 필드 추가 이전 등록분)은 과거 대회 화면이 RUN 전용이었던 이력을 반영해 RUN으로 간주
      var compCategory = comp.category === 'CYCLE' ? 'CYCLE' : 'RUN';
      // 대회 일시 미입력 건은 연도 필터를 적용할 수 없으므로 예정 목록에서 계속 보이도록 유지
      return compCategory === activeCategory &&
        (raceMs == null || seoulYearOf(raceMs) === thisYear) &&
        isCompetitionVisible(comp, admin, uid);
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
    var categoryLabel = getActiveCompetitionCategory() === 'CYCLE' ? 'CYCLE' : 'RUN';
    container.innerHTML = '<div class="competition-empty-state">올해 등록된 ' + categoryLabel + ' 대회가 없습니다.</div>';
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
        // 마감 시 자동으로 대기자 명단에 등록되므로(joinCompetitionWaitlistIfNotAlready), 사용자가 알 수 있게 안내한다.
        applyBtn.textContent = result.waitlisted ? '대기 등록됨' : '마감되었습니다';
      } else if (result && result.reason === 'CLOSED') {
        window.competitionBottomSheet.showSoldOutFeedback();
        applyBtn.textContent = '접수 기간이 아닙니다';
      } else {
        haptic(10);
        if (!opts.silentAlert) alert((result && result.error) || '신청에 실패했습니다. 잠시 후 다시 시도해 주세요.');
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
      // 신청서 작성 폼(competitionApplicationForm)에서 이어지는 흐름은 onSubmit resolve 직후
      // 폼 자신의 바텀시트를 닫는다(단일 오버레이 구조) — 같은 틱에 열면 그 close에 곧바로 닫히므로
      // 다음 매크로태스크로 미뤄 폼이 닫힌 뒤에 계좌 안내 시트가 열리도록 한다.
      setTimeout(function () {
        window.competitionBottomSheet.showVirtualAccountSheet(result.virtualAccount || {});
      }, 0);
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

  /**
   * 신청서 제출(competitionApplicationForm의 onSubmit) — 검증된 참가자 정보로 실제 신청 API를 호출한다.
   * SOLD_OUT/CLOSED를 포함해 실패 시 reject해서 신청서 시트가 에러를 보여주고 재시도할 수 있게 열어둔다.
   */
  async function submitCompetitionApplication(comp, applyBtn, applicant) {
    applyBtn.disabled = true;
    applyBtn.classList.add('is-loading');
    var result;
    try {
      result = await window.competitionApi.applyForCompetition(comp.id, applicant);
    } catch (e) {
      applyBtn.classList.remove('is-loading');
      applyBtn.disabled = false;
      applyBtn.textContent = '신청하기';
      throw e;
    }
    applyBtn.classList.remove('is-loading');
    // silentAlert: 실패 사유는 신청서 시트의 인라인 에러로 보여주므로 handleApplyResult의 alert()는 생략한다
    handleApplyResult(result, applyBtn, { silentAlert: true });
    if (!result || result.success === false) {
      var msg =
        (result && result.reason === 'SOLD_OUT' &&
          (result.waitlisted ? '마감되어 대기자 명단에 등록되었습니다. 자리가 나면 알려드립니다.' : '마감되었습니다.')) ||
        (result && result.reason === 'CLOSED' && '접수 기간이 아닙니다.') ||
        (result && result.error) ||
        '신청에 실패했습니다.';
      throw new Error(msg);
    }

    // 신청 완료(입금 대기중/신청 완료) 후에는 목록을 다시 불러와 잔여 인원·카드 상태를 최신으로 반영한다.
    // 계좌 안내 시트가 그 위에 뜨는 동안 배경에서 갱신되므로 시트를 닫으면 바로 반영된 화면이 보인다.
    renderCompetitionList();
  }

  /** 카드 버튼·상세시트 버튼 공용 신청 플로우 — 신청서 작성 화면을 먼저 띄운 뒤 제출 시 신청 API를 호출한다 */
  function applyToCompetitionFlow(comp, applyBtn) {
    haptic(10);
    if (!window.competitionApplicationForm || typeof window.competitionApplicationForm.open !== 'function') {
      console.error('[competitionScreen] competitionApplicationForm 필요');
      return;
    }
    window.competitionApplicationForm.open(comp, function (applicant) {
      return submitCompetitionApplication(comp, applyBtn, applicant);
    });
  }

  /** 신청서 수정 제출 — 가상계좌·결제 상태는 그대로 두고 applicant 내용만 갱신한다 */
  async function submitEditApplication(applicationId, applicant) {
    var result = await window.competitionApi.updateCompetitionApplication(applicationId, applicant);
    if (!result || result.success === false) {
      throw new Error((result && result.error) || '신청서 수정에 실패했습니다.');
    }
  }

  function editMyApplicationFlow(comp, myApp) {
    window.competitionApplicationForm.open(
      comp,
      function (applicant) {
        return submitEditApplication(myApp.id, applicant).then(function () {
          renderCompetitionList();
        });
      },
      myApp.applicant
    );
  }

  /**
   * 신청 취소 — 입금 전(PAYMENT_WAITING)이면 환불 계좌 없이 바로 취소, 이미 입금 완료면
   * 기존 취소 및 환불 플로우(showRefundFormSheet)로 안내한다(토스 결제취소 API 호출 필요).
   */
  function cancelMyApplicationFlow(comp, myApp) {
    if (!myApp) return;
    if (myApp.status === 'PAYMENT_COMPLETED') {
      window.competitionBottomSheet.showRefundFormSheet(myApp.id, function (refundAccount) {
        return window.competitionApi.requestCompetitionRefund(myApp.id, refundAccount).then(function (r) {
          if (!r || r.success === false) throw new Error((r && r.error) || '취소 및 환불 신청에 실패했습니다.');
          renderCompetitionList();
        });
      });
      return;
    }
    if (myApp.status === 'PAYMENT_WAITING') {
      if (!confirm('신청을 취소하시겠습니까? 발급된 가상계좌는 더 이상 사용할 수 없습니다.')) return;
      haptic(10);
      window.competitionApi
        .cancelCompetitionApplication(myApp.id)
        .then(function (r) {
          if (!r || r.success === false) {
            alert((r && r.error) || '취소에 실패했습니다.');
            return;
          }
          window.competitionBottomSheet.closeSheet();
          renderCompetitionList();
        })
        .catch(function (e) {
          alert((e && e.message) || '취소에 실패했습니다.');
        });
    }
  }

  function openDetail(comp, admin, remainingLabel, myApp, myWaitlist, uid) {
    var category = categorizeCompetition(comp);
    var invite = getActiveWaitlistInvite(myWaitlist);
    var isWaiting =
      myApp && myApp.status === 'PAYMENT_WAITING' && (toDateMs(myApp.paymentDueAt) == null || toDateMs(myApp.paymentDueAt) > Date.now());
    var isPaid = !!myApp && myApp.status === 'PAYMENT_COMPLETED';
    var hasApplication = isWaiting || isPaid;
    var isOwner = !!uid && comp.createdBy === uid;
    // 생성자 화면: 관리자가 아니어도 본인이 만든 대회는 CSV·재계산·수정·삭제를 사용할 수 있다.
    var canManage = admin || isOwner;
    // 승인/거절은 관리자만, 그리고 아직 승인 대기중인 건에 한해 노출한다.
    var canModerate = admin && comp.approvalStatus === 'PENDING';
    window.competitionBottomSheet.showDetailSheet(comp, {
      isAdmin: admin,
      canManage: canManage,
      canModerate: canModerate,
      remainingLabel: category.key === 'past' && !invite ? '종료' : remainingLabel || '확인 중...',
      hideApply: !invite && (category.key === 'past' || hasApplication),
      applyDisabledLabel: !invite && category.key === 'upcoming' ? '접수 예정' : null,
      applyLabel: invite ? '자리 확보! 지금 신청하기' : null,
      waitlistInviteExpiresAt: invite ? invite.inviteExpiresAt : null,
      virtualAccount: hasApplication ? myApp.virtualAccount || {} : null,
      applicant: hasApplication ? myApp.applicant || null : null,
      paid: isPaid,
      onApply: function (btn) {
        applyToCompetitionFlow(comp, btn);
      },
      onEditApplication: hasApplication
        ? function () {
            window.competitionBottomSheet.closeSheet();
            editMyApplicationFlow(comp, myApp);
          }
        : null,
      onCancelApplication: hasApplication
        ? function () {
            cancelMyApplicationFlow(comp, myApp);
          }
        : null,
      onDownloadCsv: function () {
        return window.competitionAdminForm.downloadApplicantsCsv(comp);
      },
      onCancelUnpaid: function () {
        return window.competitionApi.manualCancelUnpaidCompetitionApplications().then(function (r) {
          if (!r || r.success === false) {
            alert((r && r.error) || '미입금 취소 처리에 실패했습니다.');
            return;
          }
          alert('입금기한 만료건 ' + r.processed + '건을 취소 처리했습니다.');
          // 방금 취소로 풀린 슬롯을 즉시 반영 — 이 대회 잔여 인원도 함께 재계산
          return window.competitionApi.reconcileCompetitionSlots(comp.id).finally(function () {
            renderCompetitionList();
          });
        });
      },
      onReconcileSlots: function () {
        return window.competitionApi.reconcileCompetitionSlots(comp.id).then(function (r) {
          if (!r || r.success === false) {
            alert((r && r.error) || '재계산에 실패했습니다.');
            return;
          }
          alert('잔여 인원을 재계산했습니다 (' + r.before + ' → ' + r.after + ').');
          renderCompetitionList();
        });
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
      onApprove: canModerate
        ? function () {
            return window.competitionAdminForm.approveCompetition(comp.id).then(function () {
              window.competitionBottomSheet.closeSheet();
              renderCompetitionList();
            });
          }
        : null,
      onReject: canModerate
        ? function () {
            return window.competitionAdminForm.rejectCompetition(comp.id).then(function () {
              window.competitionBottomSheet.closeSheet();
              renderCompetitionList();
            });
          }
        : null,
    });
  }

  function renderCard(comp, admin, myApp, myWaitlist, uid) {
    var category = categorizeCompetition(comp);
    var invite = getActiveWaitlistInvite(myWaitlist);
    var card = document.createElement('div');
    card.className = 'competition-card is-' + category.key + (invite ? ' is-invited' : '');
    var remainingId = 'competitionRemaining_' + comp.id;
    var statusBadge = invite
      ? '<span class="competition-status-badge is-invited">대기 순번 도착</span>'
      : '<span class="competition-status-badge is-' + category.key + '">' + category.label + '</span>';
    var raceDateLabel = formatDateTimeKo(comp.raceDate) || '-';
    var locationLabel = comp.location ? escapeHtml(comp.location) : '-';
    var dday = category.key === 'past' ? null : computeCardDDay(comp);
    var ddayBadge = dday
      ? '<span class="competition-dday-chip is-' + dday.tone + '">' + escapeHtml(dday.label) + '</span>'
      : '';
    // 승인 대기·거절 배지 — 관리자·생성자 본인에게만 보인다(다른 사용자에게는 목록 자체에서 걸러짐)
    var isOwner = !!uid && comp.createdBy === uid;
    var approvalBadge = '';
    if ((admin || isOwner) && comp.approvalStatus === 'PENDING') {
      approvalBadge = '<span class="competition-status-badge is-pending">승인 대기</span>';
    } else if ((admin || isOwner) && comp.approvalStatus === 'REJECTED') {
      approvalBadge = '<span class="competition-status-badge is-rejected">거절</span>';
    }
    var thumbHtml = comp.posterImageUrl
      ? '<div class="competition-card-thumb" style="background-image:url(\'' + escapeHtml(comp.posterImageUrl) + '\')"></div>'
      : '<div class="competition-card-thumb competition-card-thumb--placeholder">' +
        escapeHtml(comp.category === 'CYCLE' ? 'CYCLE' : 'RUN') + '</div>';

    var showApplyBtn = invite || category.key !== 'past';
    var applyBtnLabel = invite ? '자리 확보! 지금 신청하기' : category.key === 'upcoming' ? '접수 예정' : '신청하기';
    var applyBtnDisabled = !invite && category.key === 'upcoming';
    var inviteHintHtml =
      invite && invite.inviteExpiresAt
        ? '<div class="competition-card-invite-hint">' +
          escapeHtml(formatDateTimeKo(invite.inviteExpiresAt) || '') + '까지 신청 가능</div>'
        : '';

    // 종료된 대회는 잔여 인원 조회(refreshRemainingLabel)를 하지 않으므로(마감 이후라 의미 없음),
    // "정원 확인 중..." placeholder가 그대로 남지 않도록 모집 당시 정원(comp.capacity)을 바로 표시한다.
    var initialRemainingLabel =
      category.key === 'past' && !invite
        ? '정원 ' + (Number(comp.capacity) || 0) + '명'
        : '정원 확인 중...';

    card.innerHTML =
      '<div class="competition-card-row">' +
      thumbHtml +
      '<div class="competition-card-main">' +
      '<h3 class="competition-card-title">' + escapeHtml(comp.title || '대회') + statusBadge + ddayBadge + approvalBadge + '</h3>' +
      '<div class="competition-card-info">' +
      '  <div class="competition-card-info-row">' + cardIcon(CARD_ICON_CALENDAR) + '대회 일시 : ' + escapeHtml(raceDateLabel) + '</div>' +
      '  <div class="competition-card-info-row">' + cardIcon(CARD_ICON_MAP_PIN) + '장소 : ' + locationLabel + '</div>' +
      '</div>' +
      '<div class="competition-card-meta">' +
      '  <span>' + cardIcon(CARD_ICON_CARD) + '참가비 ' + formatEntryFee(comp.entryFee) + '</span>' +
      '  <span>' + cardIcon(CARD_ICON_USERS) + '<span class="competition-card-remaining" id="' + remainingId + '">' + escapeHtml(initialRemainingLabel) + '</span></span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      inviteHintHtml +
      (showApplyBtn ? '<button type="button" class="competition-apply-btn">' + escapeHtml(applyBtnLabel) + '</button>' : '');

    var applyBtn = card.querySelector('.competition-apply-btn');
    var remainingEl = card.querySelector('#' + remainingId);
    var lastRemainingLabel = initialRemainingLabel;
    var hasExistingApp = applyBtn && !invite && category.key === 'open' && applyExistingStateToButton(applyBtn, myApp);

    if (category.key !== 'past' || invite) {
      // 이미 입금 대기중/신청 완료/대기자 초대 상태면 잔여 인원 조회로 버튼을 덮어쓰지 않는다(라벨 텍스트만 갱신)
      refreshRemainingLabel(comp.id, comp.capacity, remainingEl, hasExistingApp || invite ? null : applyBtn).then(
        function (label) {
          if (label) lastRemainingLabel = label;
        }
      );
    }

    if (applyBtn) {
      if (applyBtnDisabled) {
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
      openDetail(comp, admin, lastRemainingLabel, myApp, myWaitlist, uid);
    });

    return card;
  }

  /** 짧은 시간에 두 번 진입(중복 탭 등)했을 때, 먼저 시작한 호출의 응답이 늦게 도착해
   *  나중 호출의 결과를 덮어쓰지 않도록 하는 세대 토큰. */
  var renderCompetitionListGen = 0;

  async function renderCompetitionList() {
    var container = document.getElementById('competitionListContainer');
    if (!container) return;
    renderSkeleton(container);
    var myGen = ++renderCompetitionListGen;
    if (!getFirestoreFns()) {
      await waitForFirestoreV9(8000);
    }
    if (myGen !== renderCompetitionListGen) return; // 그 사이 화면을 다시 진입해 더 최신 호출이 시작됨
    var admin = isAdmin();
    var uid = getCurrentUid();
    try {
      var listAndMyApps = await Promise.all([fetchCompetitionsForList(), fetchMyApplicationsMap(), fetchMyWaitlistMap()]);
      if (myGen !== renderCompetitionListGen) return;
      var list = listAndMyApps[0];
      var myAppsMap = listAndMyApps[1];
      var myWaitlistMap = listAndMyApps[2];
      var existingFab = document.getElementById('competitionAdminCreateFab');
      if (existingFab) existingFab.remove();
      if (uid) {
        // 제휴사 등록(.affiliate-fab-create)과 동일한 좌하단 원형 FAB — 로그인한 사용자라면 관리자·일반 모두 노출.
        // 관리자가 만들면 즉시 공개(APPROVED), 일반 사용자가 만들면 승인 대기(PENDING)로 시작한다(competitionAdminForm.saveCompetition).
        var createBtn = document.createElement('button');
        createBtn.type = 'button';
        createBtn.id = 'competitionAdminCreateFab';
        createBtn.className = 'competition-fab-create fixed z-[100100] flex items-center justify-center rounded-full shadow-lg text-white text-2xl font-bold';
        createBtn.setAttribute('aria-label', '새 대회 만들기');
        createBtn.textContent = '+';
        createBtn.addEventListener('click', function () {
          window.competitionAdminForm.openForm({ category: getActiveCompetitionCategory() }, renderCompetitionList);
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
          container.appendChild(
            renderCard(entry.comp, admin, myAppsMap.get(entry.comp.id), myWaitlistMap.get(entry.comp.id), uid)
          );
        });
    } catch (e) {
      if (myGen !== renderCompetitionListGen) return;
      console.warn('[competitionScreen] 대회 목록 로드 실패:', e && e.message ? e.message : e);
      container.innerHTML = '<div class="competition-empty-state">대회 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
    }
  }

  window.competitionScreenInit = function () {
    renderCompetitionList();
  };
})();
