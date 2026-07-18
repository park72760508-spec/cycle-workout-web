/**
 * 대회 신청 바텀시트 — 가상계좌 안내 · 환불 계좌 입력.
 * .journal-bottom-sheet(index.html #trainingJournalScreen) 구조를 competition-bottom-sheet-* 로 복제.
 */
(function () {
  /** Toss 가상계좌 발급 은행 코드 — 콘솔에서 실제 코드로 재확인 필요(플레이스홀더) */
  var BANK_OPTIONS = [
    { code: '20', name: '우리은행' },
    { code: '81', name: 'KEB하나은행' },
    { code: '88', name: '신한은행' },
    { code: '04', name: 'KB국민은행' },
    { code: '11', name: 'NH농협은행' },
    { code: '90', name: '카카오뱅크' },
    { code: '92', name: '토스뱅크' },
  ];

  function haptic(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
  }

  function closeSheet() {
    var overlay = document.getElementById('competitionBottomSheetOverlay');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', onEscKey);
  }

  function onEscKey(e) {
    if (e.key === 'Escape') closeSheet();
  }

  function openSheet(title, bodyHtml, footerHtml) {
    closeSheet();
    var overlay = document.createElement('div');
    overlay.id = 'competitionBottomSheetOverlay';
    overlay.className = 'competition-bottom-sheet-overlay';
    overlay.innerHTML =
      '<div class="competition-bottom-sheet" role="dialog" aria-modal="true" aria-label="' + title + '">' +
      '  <div class="competition-bottom-sheet-handle"></div>' +
      '  <div class="competition-bottom-sheet-header">' +
      '    <h3 class="competition-bottom-sheet-title">' + title + '</h3>' +
      '    <button type="button" class="competition-bottom-sheet-close" aria-label="닫기">&times;</button>' +
      '  </div>' +
      '  <div class="competition-bottom-sheet-body">' + bodyHtml + '</div>' +
      (footerHtml ? '  <div class="competition-bottom-sheet-footer">' + footerHtml + '</div>' : '') +
      '</div>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSheet();
    });
    document.body.appendChild(overlay);
    var closeBtn = overlay.querySelector('.competition-bottom-sheet-close');
    if (closeBtn) closeBtn.addEventListener('click', closeSheet);
    document.addEventListener('keydown', onEscKey);
    return overlay;
  }

  function formatRemaining(dueDateStr) {
    var due = new Date(dueDateStr).getTime();
    var diff = due - Date.now();
    if (!isFinite(due) || diff <= 0) return '입금 기한이 지났습니다';
    var totalSec = Math.floor(diff / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return pad(h) + ':' + pad(m) + ':' + pad(s) + ' 남음';
  }

  /**
   * 신청 성공 — 가상계좌 정보 안내.
   * @param {{bankName:string, accountNumber:string, dueDate:string}} virtualAccount
   */
  function showVirtualAccountSheet(virtualAccount) {
    haptic(50);
    var bankName = virtualAccount.bankName || '입금 은행';
    var accountNumber = virtualAccount.accountNumber || '';
    var body =
      '<div class="competition-account-row">' +
      '  <div><div class="competition-account-row-label">은행</div><div class="competition-account-row-value">' + bankName + '</div></div>' +
      '</div>' +
      '<div class="competition-account-row">' +
      '  <div><div class="competition-account-row-label">계좌번호</div><div class="competition-account-row-value" id="competitionVaAccountNumber">' + accountNumber + '</div></div>' +
      '  <button type="button" class="competition-copy-btn" id="competitionVaCopyBtn">복사</button>' +
      '</div>' +
      '<div class="competition-due-countdown" id="competitionVaCountdown">' + formatRemaining(virtualAccount.dueDate) + '</div>';

    var overlay = openSheet('입금 계좌 안내', body);
    var copyBtn = overlay.querySelector('#competitionVaCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        haptic(10);
        var text = accountNumber.replace(/-/g, '');
        var done = function () {
          copyBtn.textContent = '복사됨';
          copyBtn.classList.add('is-copied');
          setTimeout(function () {
            copyBtn.textContent = '복사';
            copyBtn.classList.remove('is-copied');
          }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(done);
        } else {
          done();
        }
      });
    }
    if (virtualAccount.dueDate) {
      var timer = setInterval(function () {
        var el = document.getElementById('competitionVaCountdown');
        if (!el || !document.body.contains(el)) {
          clearInterval(timer);
          return;
        }
        el.textContent = formatRemaining(virtualAccount.dueDate);
      }, 1000);
    }
  }

  /** 마감(SOLD_OUT) 짧은 안내 — 별도 시트 없이 진동 피드백만 */
  function showSoldOutFeedback() {
    haptic(10);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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

  /**
   * 대회 상세 정보 — 설명·장소·일시 + 신청/관리 버튼.
   * @param {object} comp — competitions 문서(id 포함)
   * @param {{
   *   isAdmin: boolean,
   *   remainingLabel: string,
   *   onApply: function(HTMLElement):void,
   *   onEdit: function():void,
   *   onDelete: function():void
   * }} opts
   */
  function showDetailSheet(comp, opts) {
    opts = opts || {};
    var raceDateLabel = formatDateTimeKo(comp.raceDate);
    var body =
      (comp.description
        ? '<p style="white-space:pre-wrap;font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">' + escapeHtml(comp.description) + '</p>'
        : '') +
      '<div class="competition-account-row">' +
      '  <div><div class="competition-account-row-label">참가비</div><div class="competition-account-row-value">' +
        (Number(comp.entryFee) > 0 ? Number(comp.entryFee).toLocaleString('ko-KR') + '원' : '무료') + '</div></div>' +
      '</div>' +
      (raceDateLabel
        ? '<div class="competition-account-row"><div><div class="competition-account-row-label">대회 일시</div><div class="competition-account-row-value" style="font-size:14px;">' + escapeHtml(raceDateLabel) + '</div></div></div>'
        : '') +
      (comp.location
        ? '<div class="competition-account-row"><div><div class="competition-account-row-label">장소</div><div class="competition-account-row-value" style="font-size:14px;">' + escapeHtml(comp.location) + '</div></div></div>'
        : '') +
      '<div class="competition-account-row">' +
      '  <div><div class="competition-account-row-label">잔여 인원</div><div class="competition-account-row-value" id="competitionDetailRemaining">' +
        escapeHtml(opts.remainingLabel || '확인 중...') + '</div></div>' +
      '</div>';

    var footerParts = [];
    if (opts.isAdmin) {
      footerParts.push(
        '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
        '  <button type="button" class="competition-submit-btn" id="competitionDetailEditBtn" style="background:#f1f5f9;color:#334155;">수정</button>' +
        '  <button type="button" class="competition-submit-btn" id="competitionDetailDeleteBtn" style="background:#fee2e2;color:#b91c1c;">삭제</button>' +
        '</div>'
      );
    }
    footerParts.push('<button type="button" class="competition-apply-btn" id="competitionDetailApplyBtn">신청하기</button>');

    var overlay = openSheet(escapeHtml(comp.title || '대회 상세'), body, footerParts.join(''));

    var applyBtn = overlay.querySelector('#competitionDetailApplyBtn');
    if (applyBtn && typeof opts.onApply === 'function') {
      applyBtn.addEventListener('click', function () {
        haptic(10);
        opts.onApply(applyBtn);
      });
    }
    var editBtn = overlay.querySelector('#competitionDetailEditBtn');
    if (editBtn && typeof opts.onEdit === 'function') {
      editBtn.addEventListener('click', function () {
        opts.onEdit();
      });
    }
    var deleteBtn = overlay.querySelector('#competitionDetailDeleteBtn');
    if (deleteBtn && typeof opts.onDelete === 'function') {
      deleteBtn.addEventListener('click', function () {
        opts.onDelete();
      });
    }
  }

  /**
   * 취소·환불 계좌 입력 폼.
   * @param {string} applicationId
   * @param {function(object):Promise} onSubmit — competitionApi.requestCompetitionRefund 등 호출부에서 주입
   */
  function showRefundFormSheet(applicationId, onSubmit) {
    var bankOptionsHtml = BANK_OPTIONS.map(function (b) {
      return '<option value="' + b.code + '">' + b.name + '</option>';
    }).join('');

    var body =
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="competitionRefundBank">환불 받을 은행</label>' +
      '  <select class="competition-form-select" id="competitionRefundBank">' + bankOptionsHtml + '</select>' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="competitionRefundAccountNumber">계좌번호</label>' +
      '  <input class="competition-form-input" id="competitionRefundAccountNumber" type="text" inputmode="numeric" placeholder="- 없이 숫자만 입력" />' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="competitionRefundHolderName">예금주명</label>' +
      '  <input class="competition-form-input" id="competitionRefundHolderName" type="text" placeholder="본인 명의 예금주" />' +
      '</div>' +
      '<div class="competition-form-error" id="competitionRefundError"></div>';
    var footer = '<button type="button" class="competition-submit-btn" id="competitionRefundSubmitBtn">취소 및 환불 신청</button>';

    var overlay = openSheet('취소 및 환불', body, footer);
    var submitBtn = overlay.querySelector('#competitionRefundSubmitBtn');
    var errorEl = overlay.querySelector('#competitionRefundError');

    submitBtn.addEventListener('click', async function () {
      var bank = overlay.querySelector('#competitionRefundBank').value;
      var accountNumber = overlay.querySelector('#competitionRefundAccountNumber').value.trim();
      var holderName = overlay.querySelector('#competitionRefundHolderName').value.trim();

      errorEl.classList.remove('is-visible');
      if (!accountNumber || !/^[0-9]{6,20}$/.test(accountNumber)) {
        errorEl.textContent = '계좌번호를 정확히 입력해 주세요(숫자만).';
        errorEl.classList.add('is-visible');
        return;
      }
      if (!holderName || holderName.length < 2) {
        errorEl.textContent = '예금주명을 입력해 주세요.';
        errorEl.classList.add('is-visible');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '처리 중...';
      try {
        await onSubmit({ bank: bank, accountNumber: accountNumber, holderName: holderName });
        haptic(50);
        closeSheet();
      } catch (e) {
        haptic(10);
        errorEl.textContent = (e && e.message) || '환불 신청에 실패했습니다. 잠시 후 다시 시도해 주세요.';
        errorEl.classList.add('is-visible');
        submitBtn.disabled = false;
        submitBtn.textContent = '취소 및 환불 신청';
      }
    });
  }

  window.competitionBottomSheet = {
    showVirtualAccountSheet: showVirtualAccountSheet,
    showRefundFormSheet: showRefundFormSheet,
    showSoldOutFeedback: showSoldOutFeedback,
    showDetailSheet: showDetailSheet,
    openRawSheet: openSheet,
    closeSheet: closeSheet,
  };
})();
