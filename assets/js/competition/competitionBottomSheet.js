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

  function openSheet(title, bodyHtml, footerHtml, headerActionsHtml) {
    closeSheet();
    var overlay = document.createElement('div');
    overlay.id = 'competitionBottomSheetOverlay';
    overlay.className = 'competition-bottom-sheet-overlay';
    overlay.innerHTML =
      '<div class="competition-bottom-sheet" role="dialog" aria-modal="true" aria-label="' + title + '">' +
      '  <div class="competition-bottom-sheet-handle"></div>' +
      '  <div class="competition-bottom-sheet-header">' +
      '    <h3 class="competition-bottom-sheet-title">' + title + '</h3>' +
      '    <div class="competition-bottom-sheet-header-actions">' +
      (headerActionsHtml || '') +
      '      <button type="button" class="competition-bottom-sheet-close" aria-label="닫기">&times;</button>' +
      '    </div>' +
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

  function toDateMs(input) {
    if (!input) return null;
    var d = null;
    if (typeof input.toDate === 'function') d = input.toDate();
    else if (input instanceof Date) d = input;
    else d = new Date(input);
    return d && !isNaN(d.getTime()) ? d.getTime() : null;
  }

  function categoryLabel(category) {
    return category === 'CYCLE' ? 'CYCLE (사이클)' : category === 'RUN' ? 'RUN (러닝)' : '';
  }

  /** 접수 시작~마감까지 실시간 카운트다운 — 시작 전이면 시작까지, 접수중이면 마감까지 */
  function formatEntryPeriodCountdown(comp) {
    var opensMs = toDateMs(comp.opensAt);
    var closesMs = toDateMs(comp.closesAt);
    var nowMs = Date.now();
    if (closesMs != null && nowMs > closesMs) return '접수가 마감되었습니다';
    var targetMs = opensMs != null && nowMs < opensMs ? opensMs : closesMs;
    if (targetMs == null) return '';
    var diff = targetMs - nowMs;
    if (diff <= 0) return '';
    var totalSec = Math.floor(diff / 1000);
    var day = Math.floor(totalSec / 86400);
    var h = Math.floor((totalSec % 86400) / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    var prefix = opensMs != null && nowMs < opensMs ? '접수 시작까지 ' : '접수 마감까지 ';
    return prefix + (day > 0 ? day + '일 ' : '') + pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  /** 마감 이후 취소로 초대(INVITED)된 대기자의 24시간 신청 가능 시한 카운트다운 */
  function formatWaitlistInviteRemaining(input) {
    var ms = toDateMs(input);
    if (ms == null) return '';
    var diff = ms - Date.now();
    if (diff <= 0) return '신청 가능 시간이 만료되었습니다';
    var totalSec = Math.floor(diff / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return pad(h) + ':' + pad(m) + ':' + pad(s) + ' 이내 신청 가능';
  }

  var APPLICANT_GENDER_LABEL = { M: '남', F: '여' };
  var APPLICANT_NATIONALITY_LABEL = { DOMESTIC: '내국인', FOREIGN: '외국인' };
  var APPLICANT_DIVISION_LABEL = {
    FULL: 'Full', HALF: 'Half', '10K': '10km', '5K': '5km',
    GRANFONDO: '그란폰도', MEDIOFONDO: '메디오폰도',
  };
  var APPLICANT_SIZE_LABEL = { S: 'S (90)', M: 'M (95)', L: 'L (100)', XL: 'XL (105)', XXL: 'XXL (110)' };
  var APPLICANT_START_GROUP_LABEL = { A: 'A조', B: 'B조', C: 'C조' };
  var APPLICANT_BLOOD_TYPE_LABEL = {
    'RH+A': 'RH+ A형', 'RH+B': 'RH+ B형', 'RH+O': 'RH+ O형', 'RH+AB': 'RH+ AB형',
    'RH-A': 'RH- A형', 'RH-B': 'RH- B형', 'RH-O': 'RH- O형', 'RH-AB': 'RH- AB형',
  };

  var ICON_TAG = '<path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><circle cx="7" cy="7" r="1.5"></circle>';
  var ICON_CALENDAR = '<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>';
  var ICON_MAP_PIN = '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle>';
  var ICON_ACTIVITY = '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>';
  var ICON_CARD = '<rect x="1" y="4" width="22" height="16" rx="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line>';
  var ICON_USERS =
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle>' +
    '<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>';

  function infoIcon(inner) {
    return (
      '<svg class="competition-info-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'
    );
  }

  /** 접수 마감(또는 접수 시작) 기준 D-Day — 히어로 배지에 표시 */
  function computeDDayInfo(comp) {
    var nowMs = Date.now();
    var raceMs = toDateMs(comp.raceDate);
    var opensMs = toDateMs(comp.opensAt);
    var closesMs = toDateMs(comp.closesAt);
    if (raceMs != null && raceMs < nowMs) return { label: '종료', tone: 'past' };
    if (opensMs != null && nowMs < opensMs) {
      var daysToOpen = Math.max(0, Math.ceil((opensMs - nowMs) / 86400000));
      return { label: '접수 D-' + daysToOpen, tone: 'upcoming' };
    }
    if (closesMs != null) {
      if (nowMs > closesMs) return { label: '접수 종료', tone: 'past' };
      var daysToClose = Math.floor((closesMs - nowMs) / 86400000);
      return { label: daysToClose <= 0 ? '오늘 마감' : '마감 D-' + daysToClose, tone: 'open' };
    }
    return { label: '접수중', tone: 'open' };
  }

  /** 히어로(포스터) 섹션 — 이미지가 없으면 그라디언트 배경 + 배지만 표시 */
  function buildHeroHtml(comp, ddayInfo) {
    var hasImage = !!comp.posterImageUrl;
    var catLabel = comp.category === 'CYCLE' ? 'CYCLE' : 'RUN';
    return (
      '<div class="competition-hero' + (hasImage ? '' : ' is-placeholder') + '">' +
      (hasImage
        ? '<div class="competition-hero-img" id="competitionDetailHeroImg" style="background-image:url(\'' +
          escapeHtml(comp.posterImageUrl) + '\')"></div>' +
          '<div class="competition-hero-overlay"></div>'
        : '') +
      '  <div class="competition-hero-badges">' +
      '    <span class="competition-hero-badge">' + escapeHtml(catLabel) + '</span>' +
      '    <span class="competition-hero-badge competition-hero-badge--dday is-' + ddayInfo.tone + '">' +
      escapeHtml(ddayInfo.label) + '</span>' +
      '  </div>' +
      '</div>'
    );
  }

  /** 종목·일시·장소·코스거리·참가비·잔여인원 — 텍스트 나열 대신 아이콘 그리드 카드로 표시 */
  function buildInfoGridHtml(comp, opts, raceDateLabel) {
    var cards = [
      { icon: ICON_TAG, label: '종목', value: categoryLabel(comp.category) || '-' },
      { icon: ICON_CALENDAR, label: '대회 일시', value: raceDateLabel || '미정' },
      { icon: ICON_MAP_PIN, label: '장소', value: comp.location || '-' },
      { icon: ICON_ACTIVITY, label: '코스 거리', value: comp.courseDistance || '-' },
      {
        icon: ICON_CARD,
        label: '참가비',
        value: Number(comp.entryFee) > 0 ? Number(comp.entryFee).toLocaleString('ko-KR') + '원' : '무료',
      },
    ];
    var cardsHtml = cards
      .map(function (c) {
        return (
          '<div class="competition-info-card">' + infoIcon(c.icon) +
          '<div class="competition-info-card-label">' + escapeHtml(c.label) + '</div>' +
          '<div class="competition-info-card-value">' + escapeHtml(c.value) + '</div>' +
          '</div>'
        );
      })
      .join('');
    var remainingCardHtml =
      '<div class="competition-info-card">' + infoIcon(ICON_USERS) +
      '<div class="competition-info-card-label">잔여 인원</div>' +
      '<div class="competition-info-card-value" id="competitionDetailRemaining">' +
      escapeHtml(opts.remainingLabel || '확인 중...') + '</div>' +
      '</div>';
    return '<div class="competition-info-grid">' + cardsHtml + remainingCardHtml + '</div>';
  }

  function buildCourseMapHtml(comp) {
    if (!comp.courseMapImageUrl) return '';
    return (
      '<h4 class="competition-form-section-title">코스 맵</h4>' +
      '<div class="competition-course-map" style="background-image:url(\'' + escapeHtml(comp.courseMapImageUrl) + '\')"></div>'
    );
  }

  /** 히어로 이미지 시차(parallax) 스크롤 효과 — 모션 최소화 설정 시 비활성화 */
  function wireHeroParallax(overlay) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var bodyEl = overlay.querySelector('.competition-bottom-sheet-body');
    var heroImg = overlay.querySelector('#competitionDetailHeroImg');
    if (!bodyEl || !heroImg) return;
    bodyEl.addEventListener(
      'scroll',
      function () {
        var offset = Math.max(0, bodyEl.scrollTop);
        heroImg.style.transform = 'translateY(' + Math.min(offset * 0.35, 60) + 'px)';
      },
      { passive: true }
    );
  }

  /** 신청서 내용 요약 — 입금 계좌 정보 바로 아래에 표시(showDetailSheet) */
  var ICON_USER = '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>';
  var ICON_INFO = '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>';
  var ICON_GLOBE =
    '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line>' +
    '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>';
  var ICON_PHONE =
    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path>';
  var ICON_GIFT =
    '<polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect>' +
    '<line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>' +
    '<path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>';
  var ICON_FLAG = '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line>';
  var ICON_DROPLET = '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>';
  var ICON_CLIPBOARD =
    '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path><rect x="9" y="3" width="6" height="4" rx="2"></rect>';

  /** 신청서 내용 — 대회 정보 영역(종목·일시·장소·코스거리·참가비·잔여인원)과 동일한 아이콘 그리드 카드로 표시 */
  function buildApplicantSummaryHtml(a) {
    if (!a) return '';
    var address = ((a.zipCode ? '(' + a.zipCode + ') ' : '') + (a.address1 || '') + ' ' + (a.address2 || '')).trim();
    var emergency = (
      (a.emergencyName || '') +
      (a.emergencyRelation ? ' (' + a.emergencyRelation + ')' : '') +
      (a.emergencyPhone ? ' ' + a.emergencyPhone : '')
    ).trim();
    var cards = [
      { icon: ICON_USER, label: '이름', value: a.name },
      { icon: ICON_INFO, label: '성별', value: APPLICANT_GENDER_LABEL[a.gender] || a.gender },
      { icon: ICON_CALENDAR, label: '생년월일', value: a.birth6 },
      { icon: ICON_GLOBE, label: '국적', value: APPLICANT_NATIONALITY_LABEL[a.nationality] || a.nationality },
      { icon: ICON_PHONE, label: '휴대전화', value: a.phone },
      { icon: ICON_MAP_PIN, label: '배송지', value: address },
      { icon: ICON_TAG, label: '참가 부문', value: APPLICANT_DIVISION_LABEL[a.division] || a.division },
      { icon: ICON_GIFT, label: '기념품 사이즈', value: APPLICANT_SIZE_LABEL[a.size] || a.size },
      { icon: ICON_FLAG, label: '출발 그룹', value: APPLICANT_START_GROUP_LABEL[a.startGroup] || a.startGroup },
      { icon: ICON_PHONE, label: '비상 연락처', value: emergency },
      { icon: ICON_DROPLET, label: '혈액형', value: APPLICANT_BLOOD_TYPE_LABEL[a.bloodType] || a.bloodType },
    ];
    var cardsHtml = cards
      .filter(function (c) {
        return !!c.value;
      })
      .map(function (c) {
        return (
          '<div class="competition-info-card">' + infoIcon(c.icon) +
          '<div class="competition-info-card-label">' + escapeHtml(c.label) + '</div>' +
          '<div class="competition-info-card-value">' + escapeHtml(c.value) + '</div>' +
          '</div>'
        );
      })
      .join('');
    var medicalNoteHtml = a.medicalNote
      ? '<div class="competition-info-card competition-info-card--wide">' + infoIcon(ICON_CLIPBOARD) +
        '<div class="competition-info-card-label">의료 특이사항</div>' +
        '<div class="competition-info-card-value" style="font-weight:600;white-space:pre-wrap;">' +
        escapeHtml(a.medicalNote) + '</div></div>'
      : '';
    return (
      '<h4 class="competition-form-section-title" style="margin-top:20px;">신청서 내용</h4>' +
      '<div class="competition-info-grid">' + cardsHtml + medicalNoteHtml + '</div>'
    );
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
    var opensLabel = formatDateTimeKo(comp.opensAt);
    var closesLabel = formatDateTimeKo(comp.closesAt);
    var ddayInfo = computeDDayInfo(comp);
    var body =
      buildHeroHtml(comp, ddayInfo) +
      buildInfoGridHtml(comp, opts, raceDateLabel) +
      (opensLabel || closesLabel
        ? '<div class="competition-account-row"><div><div class="competition-account-row-label">접수 기간</div><div class="competition-account-row-value" style="font-size:14px;line-height:1.5;">' +
          escapeHtml(opensLabel || '-') + ' ~ <br>' + escapeHtml(closesLabel || '-') + '</div></div></div>' +
          '<div class="competition-period-countdown" id="competitionDetailPeriodCountdown">' + escapeHtml(formatEntryPeriodCountdown(comp)) + '</div>'
        : '') +
      buildCourseMapHtml(comp) +
      (comp.description
        ? '<p style="white-space:pre-wrap;font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">' + escapeHtml(comp.description) + '</p>'
        : '') +
      (opts.virtualAccount
        ? '<div class="competition-account-row">' +
          '  <div><div class="competition-account-row-label">입금 계좌</div><div class="competition-account-row-value" id="competitionDetailVaAccountNumber">' +
            escapeHtml(opts.virtualAccount.bankName || '-') + ' ' + escapeHtml(opts.virtualAccount.accountNumber || '-') + '</div></div>' +
          '  <button type="button" class="competition-copy-btn" id="competitionDetailVaCopyBtn">복사</button>' +
          '</div>' +
          (opts.paid
            ? '<div class="competition-period-countdown">입금 완료</div>'
            : '<div class="competition-due-countdown" id="competitionDetailVaCountdown">' + escapeHtml(formatRemaining(opts.virtualAccount.dueDate)) + '</div>')
        : '') +
      buildApplicantSummaryHtml(opts.applicant);

    var footerParts = [];
    if (opts.isAdmin) {
      footerParts.push(
        '<button type="button" class="competition-submit-btn" id="competitionDetailDownloadCsvBtn" style="background:#eef2ff;color:#4c51bf;margin-bottom:8px;">신청자 명단 CSV 다운로드</button>' +
        '<button type="button" class="competition-submit-btn" id="competitionDetailReconcileBtn" style="background:#f0fdf4;color:#15803d;margin-bottom:8px;">잔여 인원 재계산</button>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
        '  <button type="button" class="competition-submit-btn" id="competitionDetailEditBtn" style="background:#f1f5f9;color:#334155;">수정</button>' +
        '  <button type="button" class="competition-submit-btn" id="competitionDetailDeleteBtn" style="background:#fee2e2;color:#b91c1c;">삭제</button>' +
        '</div>'
      );
    }
    if (!opts.hideApply) {
      footerParts.push(
        '<button type="button" class="competition-apply-btn" id="competitionDetailApplyBtn"' +
        (opts.applyDisabledLabel ? ' disabled' : '') + '>' +
        escapeHtml(opts.applyLabel || opts.applyDisabledLabel || '신청하기') + '</button>' +
        (opts.waitlistInviteExpiresAt
          ? '<div class="competition-due-countdown" id="competitionDetailInviteCountdown">' +
            escapeHtml(formatWaitlistInviteRemaining(opts.waitlistInviteExpiresAt)) + '</div>'
          : '')
      );
    }

    var headerActionsHtml =
      (opts.onCancelApplication
        ? '<button type="button" class="competition-bottom-sheet-icon-btn" id="competitionDetailCancelIconBtn" aria-label="신청 취소"><img src="assets/img/cancel01.png" alt="" /></button>'
        : '') +
      (opts.onEditApplication
        ? '<button type="button" class="competition-bottom-sheet-icon-btn" id="competitionDetailEditIconBtn" aria-label="신청서 수정"><img src="assets/img/edit2.png" alt="" /></button>'
        : '');
    var overlay = openSheet(escapeHtml(comp.title || '대회 상세'), body, footerParts.join(''), headerActionsHtml);
    wireHeroParallax(overlay);

    if (opensLabel || closesLabel) {
      var periodTimer = setInterval(function () {
        var el = document.getElementById('competitionDetailPeriodCountdown');
        if (!el || !document.body.contains(el)) {
          clearInterval(periodTimer);
          return;
        }
        el.textContent = formatEntryPeriodCountdown(comp);
      }, 1000);
    }

    if (opts.waitlistInviteExpiresAt) {
      var inviteTimer = setInterval(function () {
        var el = document.getElementById('competitionDetailInviteCountdown');
        if (!el || !document.body.contains(el)) {
          clearInterval(inviteTimer);
          return;
        }
        el.textContent = formatWaitlistInviteRemaining(opts.waitlistInviteExpiresAt);
      }, 1000);
    }

    if (opts.virtualAccount) {
      var vaAccountNumber = opts.virtualAccount.accountNumber || '';
      var vaCopyBtn = overlay.querySelector('#competitionDetailVaCopyBtn');
      if (vaCopyBtn) {
        vaCopyBtn.addEventListener('click', function () {
          haptic(10);
          var text = vaAccountNumber.replace(/-/g, '');
          var done = function () {
            vaCopyBtn.textContent = '복사됨';
            vaCopyBtn.classList.add('is-copied');
            setTimeout(function () {
              vaCopyBtn.textContent = '복사';
              vaCopyBtn.classList.remove('is-copied');
            }, 1500);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(done);
          } else {
            done();
          }
        });
      }
      if (opts.virtualAccount.dueDate && !opts.paid) {
        var vaTimer = setInterval(function () {
          var el = document.getElementById('competitionDetailVaCountdown');
          if (!el || !document.body.contains(el)) {
            clearInterval(vaTimer);
            return;
          }
          el.textContent = formatRemaining(opts.virtualAccount.dueDate);
        }, 1000);
      }
    }

    var applyBtn = overlay.querySelector('#competitionDetailApplyBtn');
    if (applyBtn && !opts.applyDisabledLabel && typeof opts.onApply === 'function') {
      applyBtn.addEventListener('click', function () {
        haptic(10);
        opts.onApply(applyBtn);
      });
    }
    var cancelIconBtn = overlay.querySelector('#competitionDetailCancelIconBtn');
    if (cancelIconBtn && typeof opts.onCancelApplication === 'function') {
      cancelIconBtn.addEventListener('click', function () {
        haptic(10);
        opts.onCancelApplication();
      });
    }
    var editIconBtn = overlay.querySelector('#competitionDetailEditIconBtn');
    if (editIconBtn && typeof opts.onEditApplication === 'function') {
      editIconBtn.addEventListener('click', function () {
        opts.onEditApplication();
      });
    }
    var downloadCsvBtn = overlay.querySelector('#competitionDetailDownloadCsvBtn');
    if (downloadCsvBtn && typeof opts.onDownloadCsv === 'function') {
      downloadCsvBtn.addEventListener('click', async function () {
        downloadCsvBtn.disabled = true;
        downloadCsvBtn.textContent = '다운로드 준비 중...';
        try {
          await opts.onDownloadCsv();
        } finally {
          downloadCsvBtn.disabled = false;
          downloadCsvBtn.textContent = '신청자 명단 CSV 다운로드';
        }
      });
    }
    var reconcileBtn = overlay.querySelector('#competitionDetailReconcileBtn');
    if (reconcileBtn && typeof opts.onReconcileSlots === 'function') {
      reconcileBtn.addEventListener('click', async function () {
        reconcileBtn.disabled = true;
        reconcileBtn.textContent = '재계산 중...';
        try {
          await opts.onReconcileSlots();
        } finally {
          reconcileBtn.disabled = false;
          reconcileBtn.textContent = '잔여 인원 재계산';
        }
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
