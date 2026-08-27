/**
 * 중고랜드(Market Land) 화면 컨트롤러 — 홈/목록·등록·상세·마이페이지 4개 화면을 vanilla JS로 렌더링한다.
 * (openRiding처럼 React가 아니라 competitionScreen.js/userManager.js와 동일한 템플릿 문자열 방식 —
 * 이 화면군은 별도 React 마운트가 필요 없을 만큼 단순해 무거운 React 트리 없이도 충분하다.)
 */
(function () {
  'use strict';

  var MARKET_SERVICE_URL = './marketService.js?v=20260827marketPurchaseAddr1';
  var svc = null;

  function loadMarketService() {
    if (svc) return Promise.resolve(svc);
    return import(MARKET_SERVICE_URL).then(function (mod) {
      svc = mod;
      return svc;
    });
  }

  /** 라이딩 모임 글래스 네비와 동일한 iOS 폰 판별(assets/js/openRiding/OpenRidingScreens.jsx의
   * openRidingIsIOSPhoneUA와 동일 로직) — iOS Safari에서 안전영역 부근 버튼이 눌리지 않는 문제를
   * 같은 방식(html 클래스 + bottom 오프셋 보정)으로 대응하기 위함. */
  function marketIsIOSPhoneUA() {
    if (typeof navigator === 'undefined') return false;
    var ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return false;
    if (/iPhone|iPod/.test(ua)) return true;
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
    return false;
  }
  if (typeof document !== 'undefined' && marketIsIOSPhoneUA()) {
    document.documentElement.classList.add('market-glass-nav-ios-phone');
  }

  /** body 최상위 단일 네비(#marketBottomNav)의 표시 여부·활성 탭을 화면 전환마다 동기화한다.
   * activeKey가 null이면(상세 화면) 네비 자체를 숨긴다. */
  function syncMarketBottomNav(activeKey) {
    var nav = document.getElementById('marketBottomNav');
    if (activeKey) {
      var floatingBar = document.getElementById('marketDetailFloatingBar');
      if (floatingBar) floatingBar.style.display = 'none';
    }
    if (!nav) return;
    if (!activeKey) {
      nav.style.display = 'none';
      return;
    }
    nav.style.display = 'block';
    var idByKey = {
      home: 'marketNavBtnHome',
      list: 'marketNavBtnList',
      register: 'marketNavBtnRegister',
      mypage: 'marketNavBtnMyPage',
    };
    Object.keys(idByKey).forEach(function (key) {
      var btn = document.getElementById(idByKey[key]);
      if (btn) btn.classList.toggle('active', key === activeKey);
    });
  }

  /** competitionBottomSheet.js의 BANK_OPTIONS와 동일 목록(모듈이 분리돼 있어 값만 그대로 복사) */
  var MARKET_BANK_OPTIONS = [
    { code: '20', name: '우리은행' },
    { code: '81', name: 'KEB하나은행' },
    { code: '88', name: '신한은행' },
    { code: '06', name: 'KB국민은행' },
    { code: '11', name: 'NH농협은행' },
    { code: '90', name: '카카오뱅크' },
    { code: '92', name: '토스뱅크' },
    { code: '03', name: 'IBK기업은행' },
    { code: '39', name: '경남은행' },
    { code: '34', name: '광주은행' },
    { code: '31', name: 'iM뱅크(대구)' },
    { code: '32', name: '부산은행' },
    { code: '07', name: 'Sh수협은행' },
    { code: '71', name: '우체국예금보험' },
    { code: '37', name: '전북은행' },
  ];

  /** deliveryapi.co.kr 공식 문서(GET /v1/tracking/couriers, POST /v1/tracking/trace)의 courierCode
   * 전체 목록 — supabase/functions/market-set-tracking의 MARKET_COURIERS와 동일하게 유지해야 함. */
  var MARKET_COURIER_OPTIONS = [
    { code: 'cj', name: 'CJ대한통운' },
    { code: 'lotte', name: '롯데택배' },
    { code: 'post', name: '우체국택배' },
    { code: 'hanjin', name: '한진택배' },
    { code: 'logen', name: '로젠택배' },
    { code: 'kyungdong', name: '경동택배' },
    { code: 'daesin', name: '대신택배' },
    { code: 'hapdong', name: '합동택배' },
    { code: 'coupang', name: '쿠팡' },
    { code: 'woori', name: '우리택배' },
  ];

  var SUB_CATEGORIES = {
    CYCLE: [
      { label: '완차', icon: 'bike1' },
      { label: '프레임', icon: 'bike2' },
      { label: '휠셋', icon: 'bike3' },
      { label: '구동계', icon: 'bike4' },
      { label: '부품', icon: 'bike5' },
      { label: '의류', icon: 'bike6' },
      { label: '용품', icon: 'bike7' },
    ],
    RUN: [
      { label: '런닝화', icon: 'run1' },
      { label: '워치', icon: 'run2' },
      { label: '의류', icon: 'run3' },
      { label: '용품', icon: 'run4' },
    ],
  };

  /** "전체" 탭 — 하단 네비게이션바 "목록" 아이콘과 동일한 SVG(그리드)를 재사용 */
  var SUB_CATEGORY_ALL_ICON_SVG =
    '<svg class="market-subtab__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect>' +
    '<rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect>' +
    '</svg>';

  function subCategoryIconHtml(sub) {
    if (!sub) return SUB_CATEGORY_ALL_ICON_SVG;
    return '<img class="market-subtab__icon" src="assets/img/' + sub.icon + '.svg" alt="" />';
  }
  var PAGE_SIZE = 60;
  var MAX_IMAGES = 3;
  var MAX_DESC_LEN = 1000;

  var homeState = {
    category: 'CYCLE',
    subCategory: '',
    keyword: '',
    items: [],
    offset: 0,
    hasMore: true,
    loading: false,
    favoriteIds: new Set(),
    myUserId: null,
  };

  var formState = {
    files: [null, null, null],
    previews: [null, null, null],
    uploaded: [null, null, null], // {url, hash}
    editingId: null,
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatPrice(n) {
    return Number(n || 0).toLocaleString('ko-KR');
  }

  function haptic(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 8);
    } catch (e) {}
  }

  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
    else alert(msg);
  }

  function statusBadgeHtml(status) {
    if (status === 'SOLD') return '<span class="market-badge market-badge--sold">판매완료</span>';
    if (status === 'RESERVED') return '<span class="market-badge market-badge--reserved">예약중</span>';
    return '';
  }

  /** 상세화면 이미지 중앙 오버레이 배지(목록 카드용 statusBadgeHtml과 별도 — 이미지 위에
   * 놓이도록 반투명·큰 크기로 표시) */
  function marketDetailImageStatusBadgeHtml(status) {
    if (status === 'SOLD') return '<div class="market-detail-slider__status-badge market-detail-slider__status-badge--sold">판매완료</div>';
    if (status === 'RESERVED') return '<div class="market-detail-slider__status-badge market-detail-slider__status-badge--reserved">예약중</div>';
    return '';
  }

  function marketFormatDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('ko-KR');
    } catch (e) { return ''; }
  }

  /** 대회 참가신청 입금기한 카운트다운(competitionBottomSheet.js의 formatRemaining)과 동일 로직 */
  function marketFormatRemaining(dueDateStr) {
    var due = new Date(dueDateStr).getTime();
    var diff = due - Date.now();
    if (!isFinite(due) || diff <= 0) return '입금 기한이 지났습니다';
    var totalSec = Math.floor(diff / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(h) + ':' + pad(m) + ':' + pad(s) + ' 남음';
  }

  function marketOrderStatusLabel(status) {
    if (status === 'PENDING') return '입금 대기중';
    if (status === 'RESERVED') return '직거래 예약중';
    if (status === 'PAID') return '입금완료';
    if (status === 'CONFIRMED') return '구매확정 완료';
    if (status === 'REFUNDED') return '환불 완료';
    if (status === 'CANCELLED') return '거래 취소됨';
    return status;
  }

  /** 연락처 공개 시점 — 예약(RESERVED/PENDING) 시점부터 판매자·구매자가 바로 연락을
   * 조율할 수 있도록 서버 함수(get_market_buyer_contact)와 동일한 조건을 클라이언트에서도 사용. */
  function marketOrderRevealsPhone(status) {
    return status === 'PENDING' || status === 'RESERVED' || status === 'PAID' || status === 'CONFIRMED';
  }

  function marketDeliveryFormHtml(o, isEdit) {
    var selectedCourier = isEdit ? o.courier_code : '';
    return '<div class="market-delivery-form' + (isEdit ? ' is-hidden' : '') + '" data-order-id="' + o.id + '">' +
      '<select class="market-form-select market-delivery-courier-select">' +
        MARKET_COURIER_OPTIONS.map(function (c) {
          return '<option value="' + c.code + '"' + (c.code === selectedCourier ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
        }).join('') +
      '</select>' +
      '<input type="text" class="market-form-input market-delivery-tracking-input" placeholder="송장번호" value="' + escapeHtml(isEdit ? o.tracking_number : '') + '" />' +
      '<div class="market-delivery-form__actions">' +
        '<button type="button" class="market-btn market-btn--outline market-delivery-submit-btn" data-order-id="' + o.id + '">' + (isEdit ? '수정 완료' : '택배사/송장번호 등록') + '</button>' +
        (isEdit ? '<button type="button" class="market-btn market-btn--outline market-delivery-edit-cancel-btn" data-order-id="' + o.id + '">취소</button>' : '') +
      '</div>' +
    '</div>';
  }

  /** "송장정보 : " 라벨(굵은 오렌지) + 택배사/송장번호(보통 굵기 검정) 한 줄 — 판매자·구매자 공용. */
  function marketTrackingInfoLineHtml(o) {
    return '<span class="market-delivery-info__label">송장정보 : </span>' +
      '<span class="market-delivery-info__value">' +
        escapeHtml(o.courier_name || o.courier_code || '') + ' / ' + escapeHtml(o.tracking_number) +
      '</span>';
  }

  /** 안전결제 구매 시점에 입력받은 배송 주소 — 구매자·판매자 거래내역 공통 표시(직거래는 해당 없음). */
  function marketDeliveryAddressLineHtml(o) {
    if (o.deal_type === 'DIRECT_DEAL' || !o.delivery_address1) return '';
    return '<div class="market-delivery-info">배송 주소 : ' +
      escapeHtml('(' + (o.delivery_address_zip || '') + ') ' + (o.delivery_address1 || '') + ' ' + (o.delivery_address2 || '')) +
    '</div>';
  }

  /** 판매자 거래내역 행 아래 택배 정보 — 입금완료(PAID)+안전결제 주문에서만 노출.
   * 송장 미등록 시 입력 폼, 등록 후에는 조회된 배송상태 + 수정 버튼(오입력 정정용)을 표시한다. */
  function marketSellerDeliveryHtml(o) {
    if (o.deal_type === 'DIRECT_DEAL' || o.escrow_status !== 'PAID') return '';
    if (o.tracking_number) {
      // 배송 상태 자체는 위쪽 6단계 진행 스텝바(marketDealStepsHtml)에서 이미 보여주므로
      // 여기서는 택배사·송장번호 확인 + 오입력 시 정정할 수 있는 수정 버튼만 남긴다.
      return '<div class="market-delivery-info" data-order-id="' + o.id + '">' +
        '<div class="market-delivery-info__row">' +
          '<span class="market-delivery-info__text">' + marketTrackingInfoLineHtml(o) + '</span>' +
          '<button type="button" class="market-deal-contact-btn market-delivery-edit-btn" data-order-id="' + o.id + '" aria-label="송장정보 수정">' + MARKET_EDIT_ICON_SVG + '</button>' +
        '</div>' +
      '</div>' +
      marketDeliveryFormHtml(o, true);
    }
    return marketDeliveryFormHtml(o, false);
  }

  /** 구매자 거래내역의 배송 추적 카드 — 배송완료 시 72시간 자동 구매확정 잔여 타이머 포함. */
  function marketBuyerDeliveryHtml(o) {
    if (o.deal_type === 'DIRECT_DEAL' || !o.tracking_number) return '';
    var timerHtml = '';
    if (o.delivery_status === 'DELIVERED') {
      if (o.return_status) {
        // 반품이 신청된 이후로는 72시간 자동 구매확정이 더 이상 의미가 없다(반품이 대신 진행됨).
        timerHtml = '<div>자동 구매확정까지 : <span class="market-return-cancelled-text">시간표시 취소됨</span></div>';
      } else if (o.delivered_at) {
        var deadlineIso = new Date(new Date(o.delivered_at).getTime() + 72 * 3600 * 1000).toISOString();
        timerHtml = '<div>자동 구매확정까지 : <span class="market-due-countdown market-tx-row__due" data-va-due="' + escapeHtml(deadlineIso) + '">' + escapeHtml(marketFormatRemaining(deadlineIso)) + '</span></div>';
      }
    }
    // 배송 상태 자체는 위쪽 6단계 진행 스텝바(marketDealStepsHtml)에서 이미 보여주므로
    // 여기서는 송장정보와 72시간 자동확정 타이머만 남긴다.
    return '<div class="market-delivery-info">' +
      '<div>' + marketTrackingInfoLineHtml(o) + '</div>' +
      timerHtml +
    '</div>';
  }

  /** 거래 주문 카드 상단 — 금액+상태(+입금기한)만 표시(아바타·이름은 아래 상대방 카드가
   * 전담하므로 marketTxRowHtml처럼 중복 표시하지 않는다). */
  function marketDealAmountStatusHtml(labelText, valueText, status, vaDueAt) {
    var statusClass = status ? status.toLowerCase() : '';
    var dueHtml = (status === 'PENDING' && vaDueAt)
      ? '<span class="market-due-countdown market-tx-row__due" data-va-due="' + escapeHtml(vaDueAt) + '">' + escapeHtml(marketFormatRemaining(vaDueAt)) + '</span>'
      : '';
    return '<div class="market-deal-amount-row">' +
      '<span class="market-tx-row__amount">' +
        '<span class="market-delivery-info__label">' + labelText + '</span>' +
        '<span class="market-delivery-info__value">' + valueText + '</span>' +
      '</span>' +
      '<span class="market-order-history-status market-order-history-status--' + statusClass + '">' + marketOrderStatusLabel(status) + '</span>' +
      dueHtml +
    '</div>';
  }

  function marketRatingHintText(myScore) {
    if (myScore >= 2) return '현재 평가: ' + myScore + '점 · 같은 별을 다시 누르면 초기화됩니다';
    if (myScore === 1) return '1점(낮음)으로 저장됨 · 같은 별을 다시 눌러 초기화하거나 2점 이상을 선택하세요';
    return '2~5번 별을 눌러 만족도를 평가해 주세요 (같은 별 재클릭 시 초기화)';
  }

  function marketFormatPhone(raw) {
    var digits = String(raw || '').replace(/\D/g, '').slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return digits.slice(0, 3) + '-' + digits.slice(3);
    return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11);
  }

  /** 중고랜드는 실거래 상대를 식별해야 하는 특성상, 랭킹보드 등과 달리 비공개(is_private)
   * 설정과 무관하게 실명을 그대로 표시한다. */
  function marketSellerDisplayName(profile) {
    return (profile && profile.display_name) ? String(profile.display_name) : '판매자';
  }

  /** 제휴사 만족도(별점) 로직 그대로 이식(assets/js/affiliate/AffiliateScreens.jsx) —
   * AFFILIATE_STAR_PATH/색 보간/부분 채움(clip-path) 방식을 vanilla HTML 문자열로 재구현. */
  var AFFILIATE_STAR_PATH = 'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

  /** 상세화면 상단 요약행 만족도 표시 — 별 아이콘 대신 "4.2/5" 숫자 표기(5점 만점) */
  function marketRatingNumericHtml(avg) {
    var avgFixed = Math.round((Number(avg) || 0) * 10) / 10;
    return '<span class="market-detail-stat market-detail-stat--rating">' + avgFixed.toFixed(1) + '/5</span>';
  }

  var MARKET_EYE_ICON_SVG =
    '<svg class="market-detail-stat__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"></path>' +
    '<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>';
  var MARKET_HEART_ICON_SVG =
    '<svg class="market-detail-stat__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"></path></svg>';

  var MARKET_CALL_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.25 6.75c0 8.284 6.716 15 15 15h1.5a2.25 2.25 0 002.25-2.25v-1.372a1.125 1.125 0 00-.852-1.091l-4.423-1.106a1.125 1.125 0 00-1.173.417l-.97 1.293a.996.996 0 01-1.21.38 12.035 12.035 0 01-7.143-7.143.996.996 0 01.38-1.21l1.293-.97a1.125 1.125 0 00.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"></path></svg>';
  var MARKET_SMS_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"></path>' +
    '<path d="M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"></path></svg>';
  var MARKET_EDIT_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M16.862 4.487a2.1 2.1 0 112.97 2.97L7.5 19.79l-4.5 1.13 1.13-4.5L16.862 4.487z"></path>' +
    '<path d="M15.232 6.117l2.65 2.65"></path></svg>';

  /** 거래 진행 6단계 — 직거래(DIRECT_DEAL)는 안전결제·택배 배송 개념이 없어 예약(RESERVED)
   * 시점에 2~5단계가 한꺼번에 완료되는 것으로 취급한다(대면 거래는 앱이 중간 과정을 추적하지 않음). */
  var MARKET_DEAL_STEPS = [
    { icon: 'deal', label: '구매협상' },
    { icon: 'bank', label: '입금확인' },
    { icon: 'delivery1', label: '택배접수' },
    { icon: 'delivery2', label: '배송중' },
    { icon: 'delivery3', label: '배송완료' },
    { icon: 'delivery4', label: '구매확정' },
  ];

  // "배송중"·"구매확정 대기"처럼 실제로 지금 진행 중인 단계는 done(완료)이 아니라
  // active(진행중 — 점선 테두리+펄스)로 표시해야 한다. 이전엔 "다음에 아직 안 끝난 단계"를
  // 무조건 active로 잡는 단순 컷오프 방식이라, 배송중일 때 정작 배송중 아이콘은 완료로
  // 채워지고 아직 시작도 안 한 배송완료 아이콘이 대신 깜빡이는 오해를 낳았다 — 각 단계의
  // 상태를 실제 의미에 맞게 개별적으로 판정한다.
  function marketDealStepStates(order) {
    var isDirect = order.deal_type === 'DIRECT_DEAL';
    var status = order.escrow_status;
    var paidDone = isDirect ? (status === 'RESERVED' || status === 'CONFIRMED') : (status === 'PAID' || status === 'CONFIRMED');
    var shippedDone = isDirect ? paidDone : !!order.tracking_number;
    var deliveredDone = isDirect ? paidDone : order.delivery_status === 'DELIVERED';
    var confirmedDone = status === 'CONFIRMED';

    var negoState = 'done'; // 주문이 존재하는 시점엔 가격이 이미 합의된 상태
    var paidState = paidDone ? 'done' : 'active';
    var shippedState = !paidDone ? 'pending' : shippedDone ? 'done' : 'active';
    // 송장 등록 후 배송완료 전까지는 "배송중"이 지금 실제로 진행되는 단계.
    var transitState = !shippedDone ? 'pending' : deliveredDone ? 'done' : 'active';
    var deliveredState = !shippedDone ? 'pending' : deliveredDone ? 'done' : 'pending';
    // 반품이 신청된 이후로는 구매확정이 더 이상 진행될 수 없는 경로이므로(반품이 최종 종료를
    // 대신함) "구매확정" 단계를 취소 상태로 표시한다.
    var confirmedState = order.return_status
      ? 'cancelled'
      : (!deliveredDone ? 'pending' : confirmedDone ? 'done' : 'active');

    return [negoState, paidState, shippedState, transitState, deliveredState, confirmedState];
  }

  // CSS의 dashed 테두리는 점 개수를 지정할 수 없어(브라우저가 굵기 기준으로 자동 계산),
  // 진행중(active) 단계는 SVG 원 stroke-dasharray로 정확히 20개 점선을 그린다.
  // 원 지름 34px(반지름 16) 기준 둘레 ≈ 100.5px → 점 20개+칸 20개 = 40구간, 구간당 ≈ 2.51px.
  var MARKET_DEAL_STEP_ACTIVE_RING_SVG =
    '<svg class="market-deal-step__active-ring" viewBox="0 0 34 34" aria-hidden="true">' +
    '<circle cx="17" cy="17" r="16" fill="none" stroke="#ea580c" stroke-width="2" stroke-dasharray="2.51 2.51"></circle>' +
    '</svg>';

  function marketDealStepsHtml(order) {
    var states = marketDealStepStates(order);
    return '<div class="market-deal-steps">' +
      MARKET_DEAL_STEPS.map(function (step, i) {
        var state = states[i];
        var label = state === 'cancelled' ? '취소' : step.label;
        return '<div class="market-deal-step market-deal-step--' + state + '">' +
          '<div class="market-deal-step__icon-wrap">' +
            (state === 'active' ? MARKET_DEAL_STEP_ACTIVE_RING_SVG : '') +
            '<img class="market-deal-step__icon" src="assets/img/' + step.icon + '.svg" alt="" />' +
          '</div>' +
          '<span class="market-deal-step__label">' + label + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  /** 반품 진행 6단계 — return_status(REQUESTED→ADDRESS_SET→…→COMPLETED)가 안전거래
   * escrow_status와 완전히 독립적으로 진행되므로, 위의 거래 6단계와 별개의 스텝바로 표시한다.
   * 이의제기(DISPUTED)는 별도 아이콘 없이 "반품완료" 단계가 보류(active)된 상태로 취급한다. */
  var MARKET_RETURN_STEPS = [
    { icon: 'return', label: '반품신청' },
    { icon: 'address', label: '반품주소' },
    { icon: 'delivery1', label: '택배접수' },
    { icon: 'delivery2', label: '배송중' },
    { icon: 'delivery3', label: '배송완료' },
    { icon: 'delivery4', label: '반품완료' },
  ];

  function marketReturnStepStates(order) {
    var rs = order.return_status;
    var requestedDone = !!rs;
    var addressDone = rs === 'ADDRESS_SET' || rs === 'DELIVERED' || rs === 'DISPUTED' || rs === 'COMPLETED';
    var shippedDone = !!order.return_tracking_number;
    var deliveredDone = rs === 'DELIVERED' || rs === 'DISPUTED' || rs === 'COMPLETED';
    var completedDone = rs === 'COMPLETED';

    var requestedState = requestedDone ? 'done' : 'pending';
    var addressState = !requestedDone ? 'pending' : addressDone ? 'done' : 'active';
    var shippedState = !addressDone ? 'pending' : shippedDone ? 'done' : 'active';
    var transitState = !shippedDone ? 'pending' : deliveredDone ? 'done' : 'active';
    var deliveredState = !shippedDone ? 'pending' : deliveredDone ? 'done' : 'pending';
    var completedState = !deliveredDone ? 'pending' : completedDone ? 'done' : 'active';

    return [requestedState, addressState, shippedState, transitState, deliveredState, completedState];
  }

  function marketReturnStepsHtml(order) {
    var states = marketReturnStepStates(order);
    return '<div class="market-deal-steps">' +
      MARKET_RETURN_STEPS.map(function (step, i) {
        var state = states[i];
        return '<div class="market-deal-step market-deal-step--' + state + '">' +
          '<div class="market-deal-step__icon-wrap">' +
            (state === 'active' ? MARKET_DEAL_STEP_ACTIVE_RING_SVG : '') +
            '<img class="market-deal-step__icon" src="assets/img/' + step.icon + '.svg" alt="" />' +
          '</div>' +
          '<span class="market-deal-step__label">' + step.label + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  /** 구매자 또는 판매자 — 이의제기(DISPUTED) 상태에서 "합의완료" 인라인 버튼/대기 상태 표시.
   * 본인이 이미 합의했다면 비활성 버튼으로 상대방 확인 대기 중임을 알린다. */
  function marketReturnAgreeHtml(o, isBuyer) {
    var agreed = isBuyer ? o.return_dispute_agreed_by_buyer : o.return_dispute_agreed_by_seller;
    if (agreed) {
      return '<button type="button" class="market-btn market-btn--disabled" disabled>합의완료(상대방 확인 대기 중)</button>';
    }
    return '<button type="button" class="market-btn market-btn--primary market-return-agree-btn" data-order-id="' + o.id + '">합의완료</button>';
  }

  /** 구매자가 반품 택배사/송장번호를 입력하는 폼 — marketDeliveryFormHtml과 동일 구조를
   * return_* 컬럼·전용 클래스로 재사용한다(제출 시 market-set-return-tracking 호출). */
  function marketReturnDeliveryFormHtml(o, isEdit) {
    var selectedCourier = isEdit ? o.return_courier_code : '';
    return '<div class="market-delivery-form market-return-delivery-form' + (isEdit ? ' is-hidden' : '') + '" data-order-id="' + o.id + '">' +
      '<select class="market-form-select market-return-delivery-courier-select">' +
        MARKET_COURIER_OPTIONS.map(function (c) {
          return '<option value="' + c.code + '"' + (c.code === selectedCourier ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
        }).join('') +
      '</select>' +
      '<input type="text" class="market-form-input market-return-delivery-tracking-input" placeholder="반품 송장번호" value="' + escapeHtml(isEdit ? o.return_tracking_number : '') + '" />' +
      '<div class="market-delivery-form__actions">' +
        '<button type="button" class="market-btn market-btn--outline market-return-delivery-submit-btn" data-order-id="' + o.id + '">' + (isEdit ? '수정 완료' : '반품 송장번호 등록') + '</button>' +
        (isEdit ? '<button type="button" class="market-btn market-btn--outline market-return-delivery-edit-cancel-btn" data-order-id="' + o.id + '">취소</button>' : '') +
      '</div>' +
    '</div>';
  }

  function marketReturnTrackingInfoLineHtml(o) {
    return '<span class="market-delivery-info__label">반품 송장정보 : </span>' +
      '<span class="market-delivery-info__value">' +
        escapeHtml(o.return_courier_name || o.return_courier_code || '') + ' / ' + escapeHtml(o.return_tracking_number) +
      '</span>';
  }

  /** 판매자가 "반품 확인" 클릭 후 반품받을 주소를 입력하는 폼 — 대회 참가신청의 Daum
   * 우편번호 embed 로직(openDaumPostcode)을 그대로 재사용한다. */
  function marketReturnAddressFormHtml(o) {
    return '<div class="market-return-address" data-order-id="' + o.id + '">' +
      '<button type="button" class="market-btn market-btn--outline market-return-confirm-btn" data-order-id="' + o.id + '">반품 확인</button>' +
      '<div class="market-return-address-form is-hidden" data-order-id="' + o.id + '">' +
        '<div class="market-address-search-row">' +
          '<input type="text" class="market-form-input market-return-zip" placeholder="우편번호" readonly />' +
          '<button type="button" class="market-btn market-btn--outline market-return-zip-search-btn" data-order-id="' + o.id + '">주소 검색</button>' +
        '</div>' +
        '<input type="text" class="market-form-input market-return-address1" placeholder="주소" readonly />' +
        '<input type="text" class="market-form-input market-return-address2" placeholder="상세주소" />' +
        '<button type="button" class="market-btn market-btn--primary market-return-address-submit-btn" data-order-id="' + o.id + '">주소 등록</button>' +
      '</div>' +
    '</div>';
  }

  /** 판매자 화면(내 상품 거래내역) — 반품 진행 카드. return_status가 있을 때만 표시된다. */
  function marketSellerReturnHtml(o) {
    if (!o.return_status) return '';
    var body = '';
    if (o.return_status === 'REQUESTED') {
      body = marketReturnAddressFormHtml(o);
    } else if (o.return_status === 'ADDRESS_SET') {
      body =
        '<div class="market-delivery-info">반품 받을 주소 : ' +
          escapeHtml('(' + (o.return_address_zip || '') + ') ' + (o.return_address1 || '') + ' ' + (o.return_address2 || '')) +
        '</div>' +
        '<div class="market-delivery-info">구매자의 반품 송장 등록을 기다리는 중입니다.</div>';
    } else if (o.return_status === 'DELIVERED') {
      var deadlineIso = o.return_delivered_at ? new Date(new Date(o.return_delivered_at).getTime() + 72 * 3600 * 1000).toISOString() : null;
      var timerHtml = deadlineIso
        ? '<div>자동 반품완료까지 : <span class="market-due-countdown market-tx-row__due" data-va-due="' + escapeHtml(deadlineIso) + '">' + escapeHtml(marketFormatRemaining(deadlineIso)) + '</span></div>'
        : '';
      body =
        '<div class="market-delivery-info">' + marketReturnTrackingInfoLineHtml(o) + timerHtml + '</div>' +
        '<div class="market-detail-actions">' +
          '<button type="button" class="market-btn market-btn--primary market-return-complete-btn" data-order-id="' + o.id + '">반품완료</button>' +
          '<button type="button" class="market-btn market-btn--outline market-return-dispute-btn" data-order-id="' + o.id + '">이의제기</button>' +
        '</div>';
    } else if (o.return_status === 'DISPUTED') {
      body =
        '<div class="market-delivery-info market-return-dispute-notice">이의제기 중입니다. 구매자와 합의 후 [합의완료]를 눌러주세요.</div>' +
        marketReturnAgreeHtml(o, false);
    } else if (o.return_status === 'COMPLETED') {
      body = '<div class="market-delivery-info market-return-complete-notice">반품이 완료되어 구매자에게 환불되었습니다.</div>';
    }
    return '<div class="market-nego-divider"></div>' +
      '<p class="market-order-history__title--deal-status">반품 진행 상태</p>' +
      marketReturnStepsHtml(o) +
      body;
  }

  /** 구매자 화면(거래 진행 상태) — 반품 진행 카드. return_status가 있을 때만 표시된다. */
  function marketBuyerReturnHtml(o) {
    if (!o.return_status) return '';
    var body = '';
    if (o.return_status === 'REQUESTED') {
      body = '<div class="market-delivery-info">판매자가 반품 받으실 주소를 등록하면 반품 송장을 입력할 수 있습니다.</div>';
    } else if (o.return_status === 'ADDRESS_SET' || o.return_status === 'DELIVERED') {
      var addrHtml = '<div class="market-delivery-info">반품 받을 주소 : ' +
        escapeHtml('(' + (o.return_address_zip || '') + ') ' + (o.return_address1 || '') + ' ' + (o.return_address2 || '')) +
      '</div>';
      var trackingHtml;
      if (o.return_tracking_number) {
        trackingHtml =
          '<div class="market-delivery-info" data-order-id="' + o.id + '">' +
            '<div class="market-delivery-info__row">' +
              '<span class="market-delivery-info__text">' + marketReturnTrackingInfoLineHtml(o) + '</span>' +
              '<button type="button" class="market-deal-contact-btn market-return-delivery-edit-btn" data-order-id="' + o.id + '" aria-label="반품 송장정보 수정">' + MARKET_EDIT_ICON_SVG + '</button>' +
            '</div>' +
          '</div>' +
          marketReturnDeliveryFormHtml(o, true);
      } else {
        trackingHtml = marketReturnDeliveryFormHtml(o, false);
      }
      var timerHtml = '';
      if (o.return_status === 'DELIVERED' && o.return_delivered_at) {
        var deadlineIso2 = new Date(new Date(o.return_delivered_at).getTime() + 72 * 3600 * 1000).toISOString();
        timerHtml = '<div>판매자 확인 대기(자동 환불까지) : <span class="market-due-countdown market-tx-row__due" data-va-due="' + escapeHtml(deadlineIso2) + '">' + escapeHtml(marketFormatRemaining(deadlineIso2)) + '</span></div>';
      }
      body = addrHtml + trackingHtml + timerHtml;
    } else if (o.return_status === 'DISPUTED') {
      body =
        '<div class="market-delivery-info market-return-dispute-notice">판매자가 이의제기하여 대금 지급이 보류되었습니다. 합의가 완료되면 환불됩니다.</div>' +
        marketReturnAgreeHtml(o, true);
    } else if (o.return_status === 'COMPLETED') {
      body = '<div class="market-delivery-info market-return-complete-notice">반품이 완료되어 환불되었습니다.</div>';
    }
    return '<div class="market-nego-divider"></div>' +
      '<p class="market-order-history__title--deal-status">반품 진행 상태</p>' +
      marketReturnStepsHtml(o) +
      body;
  }

  /** 상대방(구매자/판매자) 정보 + 전화·문자 바로가기 카드 — 연락처가 아직 공개되지 않은
   * 단계(marketOrderRevealsPhone 이전)에서는 통화/문자 버튼 없이 아바타+이름만 표시한다. */
  function marketCounterpartCardHtml(avatarUrl, name, phone) {
    var phoneFormatted = marketFormatPhone(phone);
    var digitsOnly = phoneFormatted.replace(/[^0-9]/g, '');
    var actionsHtml = digitsOnly
      ? '<div class="market-deal-contact-card__actions">' +
          '<a class="market-deal-contact-btn" href="tel:' + digitsOnly + '" aria-label="전화 걸기">' + MARKET_CALL_ICON_SVG + '</a>' +
          '<a class="market-deal-contact-btn" href="sms:' + digitsOnly + '" aria-label="문자 보내기">' + MARKET_SMS_ICON_SVG + '</a>' +
        '</div>'
      : '';
    return '<div class="market-deal-contact-card">' +
      '<img class="market-deal-contact-card__avatar" src="' + escapeHtml(avatarUrl) + '" alt="" />' +
      '<span class="market-deal-contact-card__name">' + escapeHtml(name) + '</span>' +
      actionsHtml +
    '</div>';
  }

  /** 아직 주문으로 이어지지 않은 가격 조정 요청 — 어떤 구매자인지 특정할 상대방 카드가
   * 아직 없으므로 이름을 함께 표시(요청당 1행, item+buyer 유니크). */
  function marketNegoRowHtml(r) {
    var bp = r.buyerProfile;
    var bName = marketSellerDisplayName(bp);
    var bAvatar = (bp && bp.profile_image_url) || 'assets/img/profile-placeholder.svg';
    return '<div class="market-nego-divider"></div>' +
      '<div class="market-tx-row">' +
        '<img class="market-tx-row__avatar" src="' + escapeHtml(bAvatar) + '" alt="" />' +
        '<span class="market-tx-row__name">' + escapeHtml(bName) + '</span>' +
        '<span class="market-tx-row__amount">조정 가격 : ' + formatPrice(r.requested_price) + '원</span>' +
        marketNegoActionHtml(r) +
      '</div>';
  }

  /** 이미 주문이 있는 구매자의 가격 조정 요청 — 위쪽 거래 상대 정보 카드가 이미 구매자를
   * 알려주므로 아바타·이름 없이, 아래 입금 금액 행과 동일한 형식(label : 값 + 상태)으로 표시. */
  function marketNegoAmountRowHtml(r) {
    return '<div class="market-deal-amount-row">' +
      '<span class="market-tx-row__amount">' +
        '<span class="market-delivery-info__label">조정 가격 : </span>' +
        '<span class="market-delivery-info__value">' + formatPrice(r.requested_price) + '원</span>' +
      '</span>' +
      marketNegoActionHtml(r) +
    '</div>';
  }

  function marketNegoActionHtml(r) {
    if (r.status === 'PENDING') {
      return '<div class="market-tx-row__actions">' +
        '<button type="button" class="market-nego-accept-btn" data-nego-id="' + r.id + '">수락</button>' +
        '<button type="button" class="market-nego-reject-btn" data-nego-id="' + r.id + '">거절</button>' +
      '</div>';
    }
    return '<span class="market-nego-request-status market-nego-request-status--' +
      (r.status === 'ACCEPTED' ? 'accepted' : 'rejected') + '">' +
      (r.status === 'ACCEPTED' ? '수락됨' : '거절') + '</span>';
  }

  // ───────────────────────── 홈/목록 화면 ─────────────────────────

  function renderSubCategoryTabs() {
    var wrap = document.getElementById('marketSubCategoryTabs');
    if (!wrap) return;
    var subs = SUB_CATEGORIES[homeState.category] || [];
    var html = '<button type="button" class="market-subtab' + (homeState.subCategory === '' ? ' active' : '') +
      '" data-sub="" aria-label="전체" title="전체">' + subCategoryIconHtml(null) + '</button>';
    subs.forEach(function (s) {
      html += '<button type="button" class="market-subtab' + (homeState.subCategory === s.label ? ' active' : '') +
        '" data-sub="' + escapeHtml(s.label) + '" aria-label="' + escapeHtml(s.label) + '" title="' + escapeHtml(s.label) + '">' + subCategoryIconHtml(s) + '</button>';
    });
    wrap.innerHTML = html;
    Array.prototype.forEach.call(wrap.querySelectorAll('.market-subtab'), function (btn) {
      btn.onclick = function () {
        homeState.subCategory = btn.getAttribute('data-sub') || '';
        renderSubCategoryTabs();
        reloadMarketHomeList();
      };
    });
    updateMarketSelectedCategoryLabel();
  }

  function updateMarketSelectedCategoryLabel() {
    var labelEl = document.getElementById('marketSelectedCategoryLabel');
    if (!labelEl) return;
    labelEl.textContent = homeState.subCategory || '전체';
  }

  function marketItemCardHtml(item) {
    var img = (item.images && item.images[0]) || 'assets/img/profile-placeholder.svg';
    var isFav = homeState.favoriteIds.has(item.id);
    var soldClass = item.status === 'SOLD' ? ' market-card--sold' : '';
    return (
      '<div class="market-card' + soldClass + '" data-item-id="' + item.id + '">' +
        '<div class="market-card__img-wrap">' +
          '<img class="market-card__img" src="' + escapeHtml(img) + '" alt="" loading="lazy" decoding="async" />' +
          statusBadgeHtml(item.status) +
          '<button type="button" class="market-card__heart" data-fav-toggle="' + item.id + '" aria-label="관심상품">' +
            (isFav ? '♥' : '♡') +
          '</button>' +
        '</div>' +
        '<div class="market-card__title">' + escapeHtml(item.title) + '</div>' +
        '<div class="market-card__price">' + formatPrice(item.price) + '원</div>' +
      '</div>'
    );
  }

  function renderMarketGrid(append) {
    var grid = document.getElementById('marketItemGrid');
    if (!grid) return;
    var html = homeState.items.map(marketItemCardHtml).join('');
    if (!append) {
      grid.innerHTML =
        html ||
        (homeState.keyword
          ? '<div class="market-empty">\'' + escapeHtml(homeState.keyword) + '\'에 대한 검색 결과가 없습니다.</div>'
          : '<div class="market-empty">등록된 상품이 없습니다.</div>');
    } else {
      grid.insertAdjacentHTML('beforeend', html);
    }
    wireMarketGridEvents(grid);
    var moreBtn = document.getElementById('marketLoadMoreBtn');
    if (moreBtn) moreBtn.style.display = homeState.hasMore ? 'block' : 'none';
  }

  function wireMarketGridEvents(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('.market-card'), function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('[data-fav-toggle]')) return;
        openMarketItemDetail(card.getAttribute('data-item-id'));
      });
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-fav-toggle]'), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        handleFavoriteToggle(btn.getAttribute('data-fav-toggle'), btn);
      };
    });
  }

  function handleFavoriteToggle(itemId, btn) {
    var next = !homeState.favoriteIds.has(itemId);
    btn.textContent = next ? '♥' : '♡';
    if (next) homeState.favoriteIds.add(itemId);
    else homeState.favoriteIds.delete(itemId);
    haptic(8);
    loadMarketService().then(function (s) {
      return s.toggleMarketFavorite(itemId, next);
    }).catch(function (err) {
      // 실패 시 낙관적 업데이트 롤백
      if (next) homeState.favoriteIds.delete(itemId);
      else homeState.favoriteIds.add(itemId);
      btn.textContent = homeState.favoriteIds.has(itemId) ? '♥' : '♡';
      toast('관심상품 처리 실패: ' + (err && err.message ? err.message : err));
    });
  }

  function handleBump(itemId, btn) {
    btn.disabled = true;
    loadMarketService()
      .then(function (s) { return s.bumpMarketItem(itemId); })
      .then(function () {
        toast('끌어올렸습니다.');
        reloadMarketHomeList();
      })
      .catch(function (err) {
        toast(err && err.message ? err.message : '끌어올리기에 실패했습니다.');
      })
      .finally(function () {
        btn.disabled = false;
      });
  }

  function reloadMarketHomeList() {
    homeState.items = [];
    homeState.offset = 0;
    homeState.hasMore = true;
    var grid = document.getElementById('marketItemGrid');
    if (grid) grid.innerHTML = '<div class="market-loading market-loading--spinner"><div class="market-loading__spinner-circle"></div><div class="market-loading__spinner-text">상품 로딩 중 ....</div></div>';
    loadMoreMarketItems();
  }

  function loadMoreMarketItems() {
    if (homeState.loading || !homeState.hasMore) return;
    homeState.loading = true;
    loadMarketService()
      .then(function (s) {
        return s.listMarketItems({
          category: homeState.category,
          subCategory: homeState.subCategory || undefined,
          keyword: homeState.keyword || undefined,
          offset: homeState.offset,
          limit: PAGE_SIZE,
        });
      })
      .then(function (rows) {
        var append = homeState.offset > 0;
        homeState.items = append ? homeState.items.concat(rows) : rows;
        homeState.offset += rows.length;
        homeState.hasMore = rows.length === PAGE_SIZE;
        renderMarketGrid(append);
      })
      .catch(function (err) {
        var grid = document.getElementById('marketItemGrid');
        if (grid) grid.innerHTML = '<div class="market-empty">목록을 불러오지 못했습니다: ' + escapeHtml(err.message || String(err)) + '</div>';
      })
      .finally(function () {
        homeState.loading = false;
      });
  }

  function setMarketCategory(cat) {
    homeState.category = cat;
    homeState.subCategory = '';
    var cycleTab = document.getElementById('marketCategoryTabCycle');
    var runTab = document.getElementById('marketCategoryTabRun');
    if (cycleTab) {
      cycleTab.classList.toggle('active', cat === 'CYCLE');
      cycleTab.setAttribute('aria-pressed', cat === 'CYCLE' ? 'true' : 'false');
    }
    if (runTab) {
      runTab.classList.toggle('active', cat === 'RUN');
      runTab.setAttribute('aria-pressed', cat === 'RUN' ? 'true' : 'false');
    }
    renderSubCategoryTabs();
    reloadMarketHomeList();
  }

  window.marketScreenInit = function () {
    syncMarketBottomNav('list');
    // 화면 접속과 동시에 스피너부터 표시 — 즐겨찾기/로그인 사용자 조회가 끝나야 시작되던
    // reloadMarketHomeList() 호출 이전에도 곧바로 로딩 상태가 보이게 한다.
    var grid = document.getElementById('marketItemGrid');
    if (grid) grid.innerHTML = '<div class="market-loading market-loading--spinner"><div class="market-loading__spinner-circle"></div><div class="market-loading__spinner-text">상품 로딩 중 ....</div></div>';
    loadMarketService()
      .then(function (s) {
        return Promise.all([s.getMyFavoriteItemIds(), s.getMySupabaseUserId()]);
      })
      .then(function (res) {
        homeState.favoriteIds = res[0] || new Set();
        homeState.myUserId = res[1] || null;
      })
      .catch(function () {})
      .finally(function () {
        renderSubCategoryTabs();
        reloadMarketHomeList();
      });

    var cycleTab = document.getElementById('marketCategoryTabCycle');
    var runTab = document.getElementById('marketCategoryTabRun');
    if (cycleTab) cycleTab.onclick = function () { setMarketCategory('CYCLE'); };
    if (runTab) runTab.onclick = function () { setMarketCategory('RUN'); };
    var moreBtn = document.getElementById('marketLoadMoreBtn');
    if (moreBtn) moreBtn.onclick = function () { loadMoreMarketItems(); };
    wireMarketSearchInput();
  };

  var marketSearchDebounceTimer = null;

  function wireMarketSearchInput() {
    var input = document.getElementById('marketSearchInput');
    var clearBtn = document.getElementById('marketSearchClearBtn');
    if (!input) return;
    input.value = homeState.keyword;
    if (clearBtn) clearBtn.style.display = homeState.keyword ? 'flex' : 'none';
    input.oninput = function () {
      var val = input.value;
      if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
      if (marketSearchDebounceTimer) clearTimeout(marketSearchDebounceTimer);
      marketSearchDebounceTimer = setTimeout(function () {
        homeState.keyword = val.trim();
        reloadMarketHomeList();
      }, 350);
    };
    if (clearBtn) {
      clearBtn.onclick = function () {
        input.value = '';
        clearBtn.style.display = 'none';
        if (marketSearchDebounceTimer) clearTimeout(marketSearchDebounceTimer);
        homeState.keyword = '';
        reloadMarketHomeList();
        input.focus();
      };
    }
  }

  window.navigateToMarketLand = function () {
    if (typeof window.showScreen === 'function') window.showScreen('marketHomeScreen');
  };

  // ───────────────────────── 마이페이지 진입 ─────────────────────────

  window.navigateToMarketForm = function () {
    pendingEditItem = null;
    if (typeof window.showScreen === 'function') window.showScreen('marketItemFormScreen');
  };

  /** 상품 상세 화면의 [수정] 버튼 — 기존 상품 정보로 채운 등록 화면을 연다. */
  window.navigateToMarketFormForEdit = function (item) {
    pendingEditItem = item;
    if (typeof window.showScreen === 'function') window.showScreen('marketItemFormScreen');
  };

  // ───────────────────────── 상품 등록/수정 화면 ─────────────────────────

  var pendingEditItem = null;

  function populateMarketFormForEdit(item) {
    resetMarketForm();
    formState.editingId = item.id;
    var titleEl = document.getElementById('marketFormTitle');
    var priceEl = document.getElementById('marketFormPrice');
    var descEl = document.getElementById('marketFormDescription');
    var locEl = document.getElementById('marketFormDirectLocation');
    if (titleEl) titleEl.value = item.title || '';
    if (priceEl) priceEl.value = item.price != null ? Number(item.price).toLocaleString('ko-KR') : '';
    if (descEl) descEl.value = item.description || '';
    renderMarketFormCategoryOptions(item.category || 'CYCLE');
    var subEl = document.getElementById('marketFormSubCategory');
    if (subEl && item.sub_category) subEl.value = item.sub_category;
    var bankEl = document.getElementById('marketFormSettlementBank');
    var accNumEl = document.getElementById('marketFormSettlementAccountNumber');
    var holderEl = document.getElementById('marketFormSettlementHolderName');
    if (bankEl && item.settlement_bank) bankEl.value = item.settlement_bank;
    if (accNumEl) accNumEl.value = item.settlement_account_number || '';
    if (holderEl) holderEl.value = item.settlement_holder_name || '';
    var dealMethods = item.deal_method || [];
    Array.prototype.forEach.call(document.querySelectorAll('.market-form-deal-checkbox'), function (cb) {
      cb.checked = dealMethods.indexOf(cb.value) !== -1;
    });
    var negotiableEditEl = document.getElementById('marketFormNegotiable');
    if (negotiableEditEl) negotiableEditEl.checked = !!item.negotiable;
    var directWrap = document.getElementById('marketFormDirectLocationWrap');
    if (directWrap) directWrap.style.display = dealMethods.indexOf('직거래') !== -1 ? 'block' : 'none';
    if (locEl) locEl.value = item.direct_deal_location || '';
    Array.prototype.forEach.call(document.querySelectorAll('.market-form-condition'), function (r) {
      r.checked = r.value === item.condition;
    });
    var images = item.images || [];
    var hashes = item.image_hashes || [];
    for (var i = 0; i < MAX_IMAGES; i++) {
      if (images[i]) {
        formState.previews[i] = images[i];
        formState.uploaded[i] = { url: images[i], hash: hashes[i] || '' };
      }
    }
    renderMarketImageSlots();
    updateMarketDescCounter();
  }

  function resetMarketForm() {
    formState.files = [null, null, null];
    formState.previews = [null, null, null];
    formState.uploaded = [null, null, null];
    formState.editingId = null;
    var titleEl = document.getElementById('marketFormTitle');
    var priceEl = document.getElementById('marketFormPrice');
    var descEl = document.getElementById('marketFormDescription');
    var locEl = document.getElementById('marketFormDirectLocation');
    if (titleEl) titleEl.value = '';
    if (priceEl) priceEl.value = '';
    if (descEl) descEl.value = '';
    if (locEl) locEl.value = '';
    var bankEl = document.getElementById('marketFormSettlementBank');
    var accNumEl = document.getElementById('marketFormSettlementAccountNumber');
    var holderEl = document.getElementById('marketFormSettlementHolderName');
    if (bankEl) bankEl.value = MARKET_BANK_OPTIONS[0].code;
    if (accNumEl) accNumEl.value = '';
    if (holderEl) holderEl.value = '';
    Array.prototype.forEach.call(document.querySelectorAll('.market-form-deal-checkbox'), function (cb) {
      cb.checked = false;
    });
    var negotiableEl0 = document.getElementById('marketFormNegotiable');
    if (negotiableEl0) negotiableEl0.checked = false;
    Array.prototype.forEach.call(document.querySelectorAll('.market-form-condition'), function (r) {
      r.checked = r.value === '중고 상품';
    });
    renderMarketFormCategoryOptions('CYCLE');
    renderMarketFormBankOptions();
    renderMarketImageSlots();
    updateMarketDescCounter();
  }

  function renderMarketFormBankOptionsInto(elId) {
    var bankEl = document.getElementById(elId);
    if (!bankEl || bankEl.options.length) return;
    bankEl.innerHTML = MARKET_BANK_OPTIONS.map(function (b) {
      return '<option value="' + b.code + '">' + escapeHtml(b.name) + '</option>';
    }).join('');
  }

  function renderMarketFormBankOptions() {
    renderMarketFormBankOptionsInto('marketFormSettlementBank');
  }

  function renderMarketFormCategoryOptions(cat) {
    var catSelect = document.getElementById('marketFormCategory');
    var subSelect = document.getElementById('marketFormSubCategory');
    if (catSelect) catSelect.value = cat;
    if (!subSelect) return;
    var subs = SUB_CATEGORIES[cat] || [];
    subSelect.innerHTML = subs.map(function (s) {
      return '<option value="' + escapeHtml(s.label) + '">' + escapeHtml(s.label) + '</option>';
    }).join('');
  }

  function renderMarketImageSlots() {
    var wrap = document.getElementById('marketImageSlots');
    if (!wrap) return;
    var html = '';
    for (var i = 0; i < MAX_IMAGES; i++) {
      var preview = formState.previews[i];
      html +=
        '<label class="market-image-slot' + (preview ? ' has-image' : '') + '">' +
          (preview
            ? '<img src="' + preview + '" alt="" />'
            : '<span class="market-image-slot__plus">+</span>') +
          '<input type="file" accept="image/*" data-slot="' + i + '" style="display:none" />' +
        '</label>';
    }
    wrap.innerHTML = html;
    Array.prototype.forEach.call(wrap.querySelectorAll('input[type="file"]'), function (input) {
      input.onchange = function () {
        var idx = Number(input.getAttribute('data-slot'));
        var file = input.files && input.files[0];
        if (file) handleMarketImageSelected(idx, file);
      };
    });
  }

  function handleMarketImageSelected(idx, file) {
    formState.files[idx] = file;
    formState.previews[idx] = URL.createObjectURL(file);
    formState.uploaded[idx] = null;
    renderMarketImageSlots();
  }

  function updateMarketDescCounter() {
    var descEl = document.getElementById('marketFormDescription');
    var counterEl = document.getElementById('marketFormDescCounter');
    if (!descEl || !counterEl) return;
    var len = (descEl.value || '').length;
    counterEl.textContent = len + '/' + MAX_DESC_LEN;
  }

  function collectDealMethods() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('.market-form-deal-checkbox:checked'), function (cb) {
      out.push(cb.value);
    });
    return out;
  }

  async function submitMarketForm() {
    var submitBtn = document.getElementById('marketFormSubmitBtn');
    var titleEl = document.getElementById('marketFormTitle');
    var priceEl = document.getElementById('marketFormPrice');
    var descEl = document.getElementById('marketFormDescription');
    var catEl = document.getElementById('marketFormCategory');
    var subEl = document.getElementById('marketFormSubCategory');
    var locEl = document.getElementById('marketFormDirectLocation');
    var conditionEl = document.querySelector('.market-form-condition:checked');
    var bankEl = document.getElementById('marketFormSettlementBank');
    var accNumEl = document.getElementById('marketFormSettlementAccountNumber');
    var holderEl = document.getElementById('marketFormSettlementHolderName');

    var title = (titleEl.value || '').trim();
    var priceRaw = (priceEl.value || '').replace(/[^0-9]/g, '');
    var price = Number(priceRaw);
    var description = (descEl.value || '').trim();
    var dealMethods = collectDealMethods();
    var negotiableEl = document.getElementById('marketFormNegotiable');
    var negotiable = !!(negotiableEl && negotiableEl.checked);
    var directLocation = (locEl.value || '').trim();
    var settlementBank = bankEl ? bankEl.value : '';
    var settlementAccountNumber = (accNumEl ? accNumEl.value : '').replace(/[^0-9]/g, '');
    var settlementHolderName = (holderEl ? holderEl.value : '').trim();

    if (!title) { toast('상품명을 입력해 주세요.'); return; }
    if (!priceRaw || price < 0) { toast('판매가를 입력해 주세요.'); return; }
    if (!dealMethods.length) { toast('거래 방법을 하나 이상 선택해 주세요.'); return; }
    if (dealMethods.indexOf('직거래') !== -1 && !directLocation) {
      toast('직거래 지역을 입력해 주세요.');
      return;
    }
    if (formState.files.every(function (f) { return !f; }) && formState.uploaded.every(function (u) { return !u; })) {
      toast('사진을 최소 1장 첨부해 주세요.');
      return;
    }
    if (!settlementAccountNumber || !/^[0-9]{6,20}$/.test(settlementAccountNumber)) {
      toast('안전거래 입금 계좌번호를 정확히 입력해 주세요(숫자만).');
      return;
    }
    if (!settlementHolderName || settlementHolderName.length < 2) {
      toast('안전거래 입금 계좌의 예금주명을 입력해 주세요.');
      return;
    }

    var isEditing = !!formState.editingId;
    submitBtn.disabled = true;
    submitBtn.textContent = isEditing ? '수정 중...' : '등록 중...';
    try {
      var s = await loadMarketService();
      var userId = await s.getMySupabaseUserId();
      if (!userId) throw new Error('로그인이 필요합니다.');
      var draftId = 'draft-' + Date.now();

      for (var i = 0; i < MAX_IMAGES; i++) {
        if (formState.files[i] && !formState.uploaded[i]) {
          submitBtn.textContent = '사진 업로드 중 (' + (i + 1) + '/' + MAX_IMAGES + ')...';
          formState.uploaded[i] = await s.processAndUploadMarketImage(formState.files[i], userId, draftId, i);
        }
      }
      var images = formState.uploaded.filter(Boolean).map(function (u) { return u.url; });
      var hashes = formState.uploaded.filter(Boolean).map(function (u) { return u.hash; });

      var payload = {
        title: title,
        category: catEl.value,
        sub_category: subEl.value,
        price: price,
        condition: conditionEl ? conditionEl.value : '중고 상품',
        deal_method: dealMethods,
        negotiable: negotiable,
        direct_deal_location: dealMethods.indexOf('직거래') !== -1 ? directLocation : null,
        description: description,
        images: images,
        image_hashes: hashes,
        settlement_bank: settlementBank,
        settlement_account_number: settlementAccountNumber,
        settlement_holder_name: settlementHolderName,
      };

      if (isEditing) {
        await s.updateMarketItem(formState.editingId, payload);
        toast('수정되었습니다.');
        openMarketItemDetail(formState.editingId);
      } else {
        await s.createMarketItem(payload);
        toast('등록되었습니다.');
        window.navigateToMarketLand();
      }
    } catch (err) {
      if (err && err.code === 'DUPLICATE_IMAGE') {
        toast(err.message);
      } else {
        toast((isEditing ? '수정' : '등록') + ' 실패: ' + (err && err.message ? err.message : err));
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isEditing ? '수정 완료' : '등록 하기';
    }
  }

  window.marketFormScreenInit = function () {
    syncMarketBottomNav('register');
    var titleEl = document.getElementById('marketFormScreenTitle');
    var submitBtnLabelEl = document.getElementById('marketFormSubmitBtn');
    if (pendingEditItem) {
      populateMarketFormForEdit(pendingEditItem);
      pendingEditItem = null;
      if (titleEl) titleEl.textContent = '상품 수정';
      if (submitBtnLabelEl) submitBtnLabelEl.textContent = '수정 완료';
    } else {
      resetMarketForm();
      if (titleEl) titleEl.textContent = '상품 등록';
      if (submitBtnLabelEl) submitBtnLabelEl.textContent = '등록 하기';
    }
    var catEl = document.getElementById('marketFormCategory');
    if (catEl) catEl.onchange = function () { renderMarketFormCategoryOptions(catEl.value); };
    var descEl = document.getElementById('marketFormDescription');
    if (descEl) descEl.oninput = updateMarketDescCounter;
    var priceEl = document.getElementById('marketFormPrice');
    if (priceEl) {
      priceEl.oninput = function () {
        var digits = priceEl.value.replace(/[^0-9]/g, '');
        priceEl.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
      };
    }
    var directWrap = document.getElementById('marketFormDirectLocationWrap');
    Array.prototype.forEach.call(document.querySelectorAll('.market-form-deal-checkbox'), function (cb) {
      cb.onchange = function () {
        var checkedDirect = document.querySelector('.market-form-deal-checkbox[value="직거래"]');
        if (directWrap) directWrap.style.display = checkedDirect && checkedDirect.checked ? 'block' : 'none';
      };
    });
    var submitBtn = document.getElementById('marketFormSubmitBtn');
    if (submitBtn) submitBtn.onclick = submitMarketForm;
  };

  // ───────────────────────── 상품 상세 화면 ─────────────────────────

  var detailState = { item: null, sliderIndex: 0, sellerProfile: null, sellerPhone: '', favoriteCount: 0, ratingAvg: 0, ratingCount: 0, myRating: 0, myNegoRequest: null, negoRequests: [], orderHistory: [] };

  function openMarketItemDetail(itemId) {
    if (typeof window.showScreen === 'function') window.showScreen('marketItemDetailScreen');
    var body = document.getElementById('marketDetailBody');
    if (body) body.innerHTML = '<div class="market-loading">불러오는 중...</div>';
    loadMarketService()
      .then(function (s) {
        s.incrementMarketItemView(itemId).catch(function () {});
        return Promise.all([s.getMarketItem(itemId), s.getMySupabaseUserId(), s.getMarketOrderForItem(itemId)])
          .then(function (res) {
            var item = res[0];
            var myUserId = res[1];
            var isMine = myUserId && item.user_id === myUserId;
            return Promise.all([
              s.getSellerPublicProfile(item.user_id).catch(function () { return null; }),
              s.getSellerPhone(item.user_id).catch(function () { return ''; }),
              s.getMarketFavoriteCount(item.id).catch(function () { return 0; }),
              s.getSellerRatingAggregate(item.user_id).catch(function () { return { avg: 0, count: 0 }; }),
              res[2] && res[2].escrow_status === 'CONFIRMED' ? s.getMyRatingForOrder(res[2].id).catch(function () { return 0; }) : Promise.resolve(0),
              item.negotiable ? s.getMarketNegoRequestsForItem(item.id).catch(function () { return []; }) : Promise.resolve([]),
            ]).then(function (extra) {
              var negoRows = extra[5] || [];
              var myNegoRequest = !isMine ? (negoRows.filter(function (r) { return r.buyer_id === myUserId; })[0] || null) : null;
              // 판매자에게는 결정 여부와 무관하게 전체 요청 이력을 보여준다(수락/거절 후에도
              // 목록에서 사라지지 않고 상태만 갱신되어야 하므로 PENDING만 걸러내지 않는다).
              var sellerNego = isMine ? negoRows : [];
              return Promise.all(sellerNego.map(function (r) { return s.getSellerPublicProfile(r.buyer_id).catch(function () { return null; }); }))
                .then(function (buyerProfiles) {
                  var sellerNegoWithBuyer = sellerNego.map(function (r, i) { return Object.assign({}, r, { buyerProfile: buyerProfiles[i] }); });
                  // 판매자 전용 "거래내역" — 해당 상품의 전체 주문(입금/구매확정/환불 등)을 시간순으로 표시.
                  return (isMine ? s.getMarketOrdersForItem(item.id).catch(function () { return []; }) : Promise.resolve([]))
                    .then(function (orders) {
                      return Promise.all(orders.map(function (o) {
                        var revealPhone = marketOrderRevealsPhone(o.escrow_status);
                        return Promise.all([
                          s.getSellerPublicProfile(o.buyer_id).catch(function () { return null; }),
                          revealPhone ? s.getBuyerPhone(o.buyer_id).catch(function () { return ''; }) : Promise.resolve(''),
                        ]);
                      })).then(function (pairs) {
                        var orderHistory = orders.map(function (o, i) {
                          return Object.assign({}, o, { buyerProfile: pairs[i][0], buyerPhone: pairs[i][1] });
                        });
                        return {
                          item: item, myUserId: myUserId, myOrder: res[2],
                          sellerProfile: extra[0], sellerPhone: extra[1], favoriteCount: extra[2], ratingAgg: extra[3], myRating: extra[4],
                          myNegoRequest: myNegoRequest, negoRequests: sellerNegoWithBuyer, orderHistory: orderHistory,
                        };
                      });
                    });
                });
            });
          });
      })
      .then(function (res) {
        detailState.item = res.item;
        detailState.sliderIndex = 0;
        detailState.sellerProfile = res.sellerProfile;
        detailState.sellerPhone = res.sellerPhone || '';
        detailState.favoriteCount = res.favoriteCount;
        detailState.ratingAvg = res.ratingAgg ? res.ratingAgg.avg : 0;
        detailState.ratingCount = res.ratingAgg ? res.ratingAgg.count : 0;
        detailState.myRating = res.myRating || 0;
        detailState.myNegoRequest = res.myNegoRequest;
        detailState.negoRequests = res.negoRequests;
        detailState.orderHistory = res.orderHistory;
        renderMarketDetail(res.myUserId, res.myOrder);
      })
      .catch(function (err) {
        if (body) body.innerHTML = '<div class="market-empty">상품을 불러오지 못했습니다: ' + escapeHtml(err.message || String(err)) + '</div>';
      });
  }

  function renderMarketDetail(myUserId, myOrder) {
    var item = detailState.item;
    var body = document.getElementById('marketDetailBody');
    if (!body || !item) return;
    var images = item.images && item.images.length ? item.images : ['assets/img/profile-placeholder.svg'];
    var isMine = myUserId && item.user_id === myUserId;

    var isUnavailableStatus = item.status === 'RESERVED' || item.status === 'SOLD';
    var sliderHtml =
      '<div class="market-detail-slider' + (isUnavailableStatus ? ' market-detail-slider--dimmed' : '') + '" id="marketDetailSlider">' +
        '<div class="market-detail-slider__track" id="marketDetailSliderTrack">' +
          images.map(function (url) {
            return '<img class="market-detail-slider__img" src="' + escapeHtml(url) + '" alt="" loading="lazy" decoding="async" />';
          }).join('') +
        '</div>' +
        (images.length > 1
          ? '<div class="market-detail-slider__dots">' +
              images.map(function (_, i) {
                return '<span class="market-detail-slider__dot' + (i === 0 ? ' active' : '') + '"></span>';
              }).join('') +
            '</div>'
          : '') +
        marketDetailImageStatusBadgeHtml(item.status) +
      '</div>';

    var dealMethodText = (item.deal_method || []).join(', ') + (item.direct_deal_location ? (' (' + escapeHtml(item.direct_deal_location) + ')') : '');

    var actionHtml;
    if (isMine) {
      actionHtml =
        '<div class="market-detail-actions">' +
          '<button type="button" class="market-btn market-btn--outline" id="marketDetailBumpBtn">끌어올리기</button>' +
          '<button type="button" class="market-btn market-btn--outline" id="marketDetailEditBtn">수정</button>' +
          '<button type="button" class="market-btn market-btn--danger" id="marketDetailDeleteBtn">삭제</button>' +
        '</div>';
    } else if (myOrder && myOrder.escrow_status === 'PAID' && (myOrder.return_status === 'DISPUTED' || myOrder.return_status === 'COMPLETED')) {
      // 이의제기 중엔 인라인 [합의완료] 버튼(marketBuyerReturnHtml)이, 반품완료 후엔 별도 액션이 필요 없다.
      actionHtml = '';
    } else if (myOrder && myOrder.escrow_status === 'PAID' && myOrder.return_status === 'REQUESTED') {
      actionHtml = '<button type="button" class="market-btn market-btn--disabled" disabled>판매자의 반품 주소 등록을 기다리는 중입니다</button>';
    } else if (myOrder && myOrder.escrow_status === 'PAID' && myOrder.return_status === 'ADDRESS_SET') {
      actionHtml = '<button type="button" class="market-btn market-btn--disabled" disabled>반품 송장번호를 등록해 주세요</button>';
    } else if (myOrder && myOrder.escrow_status === 'PAID' && myOrder.return_status === 'DELIVERED') {
      actionHtml = '<button type="button" class="market-btn market-btn--disabled" disabled>판매자의 반품 확인을 기다리는 중입니다</button>';
    } else if (myOrder && myOrder.escrow_status === 'PAID' && myOrder.delivery_status === 'DELIVERED') {
      actionHtml =
        '<div class="market-detail-actions">' +
          '<button type="button" class="market-btn market-btn--primary" id="marketDetailConfirmBtn">구매 확정</button>' +
          '<button type="button" class="market-btn market-btn--outline" id="marketDetailReturnToggleBtn">반품 신청</button>' +
        '</div>' +
        '<div id="marketReturnRequestForm" class="market-refund-form" style="display:none;">' +
          '<p class="market-form-hint">환불 받으실 계좌 정보를 입력해 주세요. 반품 상품이 판매자에게 배송완료되면 환불됩니다.</p>' +
          '<select id="marketReturnBank" class="market-form-select"></select>' +
          '<input id="marketReturnAccountNumber" class="market-form-input" inputmode="numeric" placeholder="환불 계좌번호(숫자만)" />' +
          '<input id="marketReturnHolderName" class="market-form-input" placeholder="예금주명(본인)" />' +
          '<button type="button" class="market-btn market-btn--danger" id="marketReturnRequestSubmitBtn">반품 신청</button>' +
        '</div>';
    } else if (myOrder && myOrder.escrow_status === 'PAID') {
      actionHtml =
        '<div class="market-detail-actions">' +
          '<button type="button" class="market-btn market-btn--primary" id="marketDetailConfirmBtn">구매 확정하기</button>' +
          '<button type="button" class="market-btn market-btn--outline" id="marketDetailRefundToggleBtn">환불 요청</button>' +
        '</div>' +
        '<div id="marketRefundForm" class="market-refund-form" style="display:none;">' +
          '<p class="market-form-hint">본인 명의 환불 계좌로 상품가(수수료 1,000원 제외)가 환불됩니다.</p>' +
          '<select id="marketRefundBank" class="market-form-select"></select>' +
          '<input id="marketRefundAccountNumber" class="market-form-input" inputmode="numeric" placeholder="환불 계좌번호(숫자만)" />' +
          '<input id="marketRefundHolderName" class="market-form-input" placeholder="예금주명(본인)" />' +
          '<button type="button" class="market-btn market-btn--danger" id="marketRefundSubmitBtn">환불 신청</button>' +
        '</div>';
    } else if (myOrder && myOrder.escrow_status === 'PENDING') {
      actionHtml =
        '<div class="market-detail-actions">' +
          '<button type="button" class="market-btn market-btn--disabled" disabled>입금 확인 대기 중입니다</button>' +
          '<button type="button" class="market-btn market-btn--outline" id="marketDetailCancelOrderBtn">구매 취소</button>' +
        '</div>';
    } else if (myOrder && myOrder.escrow_status === 'RESERVED') {
      actionHtml =
        '<div class="market-detail-actions">' +
          '<button type="button" class="market-btn market-btn--primary" id="marketDetailConfirmBtn">구매 확정하기</button>' +
          '<button type="button" class="market-btn market-btn--outline" id="marketDetailCancelOrderBtn">예약 취소</button>' +
        '</div>';
    } else if (myOrder && myOrder.escrow_status === 'CONFIRMED') {
      actionHtml =
        '<div class="market-rating-widget">' +
          '<p class="market-rating-widget__title">⭐ 판매자 만족도 평가</p>' +
          '<p class="market-rating-widget__hint" id="marketRatingHint">' + marketRatingHintText(detailState.myRating) + '</p>' +
          '<div class="market-rating-widget__stars" id="marketRatingStars">' +
            [1, 2, 3, 4, 5].map(function (i) {
              var filled = (detailState.myRating >= 2 ? detailState.myRating : 0) >= i;
              return '<button type="button" class="market-rating-star-btn' + (filled ? ' filled' : '') + '" data-score="' + i + '" aria-label="' + i + '점 평가">' +
                '<svg viewBox="0 0 20 20" width="30" height="30"><path d="' + AFFILIATE_STAR_PATH + '" fill="currentColor"></path></svg>' +
              '</button>';
            }).join('') +
          '</div>' +
        '</div>';
    } else if (item.status === 'SOLD') {
      actionHtml = '<button type="button" class="market-btn market-btn--disabled" disabled>판매 완료된 상품입니다</button>';
    } else if (item.status === 'RESERVED') {
      actionHtml = '<button type="button" class="market-btn market-btn--disabled" disabled>거래 진행 중인 상품입니다</button>';
    } else {
      var supportsDirectDeal = item.deal_method && item.deal_method.indexOf('직거래') !== -1;
      actionHtml =
        '<div class="market-detail-actions">' +
          '<button type="button" class="market-btn market-btn--primary" id="marketDetailBuyBtn">안전결제로 구매하기</button>' +
          (supportsDirectDeal
            ? '<button type="button" class="market-btn market-btn--outline" id="marketDetailDirectDealBtn">직거래 요청</button>'
            : '') +
        '</div>';
    }

    var seller = detailState.sellerProfile;
    var sellerName = marketSellerDisplayName(seller);
    var sellerAvatarUrl = (seller && seller.profile_image_url) || 'assets/img/profile-placeholder.svg';
    var sellerRowHtml =
      '<div class="market-detail-seller-row">' +
        '<div class="market-detail-seller-row__left">' +
          '<img class="market-detail-seller-avatar" src="' + escapeHtml(sellerAvatarUrl) + '" alt="" />' +
          '<span class="market-detail-seller-name">' + escapeHtml(sellerName) + '</span>' +
          '<span class="market-detail-seller-sep">·</span>' +
          '<span>' + escapeHtml(item.sub_category || '') + '</span>' +
          '<span class="market-detail-seller-sep">·</span>' +
          '<span>' + escapeHtml(marketFormatDate(item.created_at)) + '</span>' +
        '</div>' +
        '<div class="market-detail-seller-row__right">' +
          '<span class="market-detail-stat">' + MARKET_EYE_ICON_SVG + (Number(item.view_count) || 0) + '</span>' +
          '<span class="market-detail-stat">' + MARKET_HEART_ICON_SVG + (detailState.favoriteCount || 0) + '</span>' +
          marketRatingNumericHtml(detailState.ratingAvg) +
        '</div>' +
      '</div>';

    var nego = detailState.myNegoRequest;
    // 수락된 가격 조정 — 판매자와 해당 예약자(구매 예정자) 화면에만 취소선 원가 + 조정가를 표시.
    // 다른 사용자가 보는 목록/상세에는 영향 없음(각자 화면 기준으로만 계산).
    var acceptedNego = isMine
      ? (detailState.negoRequests || []).filter(function (r) { return r.status === 'ACCEPTED'; })[0] || null
      : (nego && nego.status === 'ACCEPTED' ? nego : null);

    var priceRowHtml;
    if (acceptedNego) {
      priceRowHtml =
        '<div class="market-detail-price market-detail-price--negotiated">' +
          '<span class="market-detail-price__original">' + formatPrice(item.price) + '원</span>' +
          '<span class="market-detail-price__final">' + formatPrice(acceptedNego.requested_price) + '원</span>' +
        '</div>' +
        (!isMine && !myOrder
          ? '<div class="market-nego-status market-nego-status--accepted">판매자가 가격 조정을 수락했습니다. 조정된 금액으로 구매할 수 있습니다.</div>'
          : '');
    } else if (!isMine && item.negotiable && !myOrder) {
      if (nego && nego.status === 'PENDING') {
        priceRowHtml =
          '<div class="market-detail-price">' + formatPrice(item.price) + '원</div>' +
          '<div class="market-nego-status market-nego-status--pending">가격 조정 요청 중 (제안가 ' + formatPrice(nego.requested_price) + '원)</div>';
      } else {
        priceRowHtml =
          '<div class="market-detail-price">' + formatPrice(item.price) + '원</div>' +
          (nego && nego.status === 'REJECTED'
            ? '<div class="market-nego-status market-nego-status--rejected">네고 불가 (이전 제안 ' + formatPrice(nego.requested_price) + '원이 거절되었습니다)</div>'
            : '') +
          '<div class="market-nego-form">' +
            '<input type="text" inputmode="numeric" id="marketNegoPriceInput" class="market-form-input market-nego-input" placeholder="희망 가격(숫자만)" />' +
            '<button type="button" class="market-btn market-btn--outline market-nego-submit-btn" id="marketNegoSubmitBtn">가격 조정 요구</button>' +
          '</div>';
      }
    } else {
      priceRowHtml = '<div class="market-detail-price">' + formatPrice(item.price) + '원</div>';
    }

    // 가격 조정 요청은 구매자당 1건(유니크)이라, 주문이 이미 생긴 구매자의 요청은 해당 주문의
    // 거래 상대 정보 카드 아래에 발생 순서대로 붙여서 보여준다(요청 → 주문 흐름이 한 곳에 보이게).
    // 아직 주문으로 이어지지 않은(협상만 진행 중인) 요청만 별도 목록으로 상단에 남긴다.
    var orderBuyerIds = {};
    if (isMine && detailState.orderHistory) {
      detailState.orderHistory.forEach(function (o) { orderBuyerIds[o.buyer_id] = true; });
    }
    var negoRowsHtml = '';
    if (isMine && detailState.negoRequests && detailState.negoRequests.length) {
      negoRowsHtml = detailState.negoRequests
        .filter(function (r) { return !orderBuyerIds[r.buyer_id]; })
        .map(marketNegoRowHtml)
        .join('');
    }

    // 판매자 전용 "거래내역" — 예약(RESERVED/PENDING) 시점부터 구매자 연락처를 노출하되,
    // 본인(판매자) 연락처는 표시하지 않는다.
    var orderRowsHtml = '';
    if (isMine && detailState.orderHistory && detailState.orderHistory.length) {
      orderRowsHtml = detailState.orderHistory.map(function (o) {
        var bp = o.buyerProfile;
        var bName = marketSellerDisplayName(bp);
        var bAvatar = (bp && bp.profile_image_url) || 'assets/img/profile-placeholder.svg';
        // 구매자 연락처는 전화·문자 버튼이 붙은 상대방 카드(marketCounterpartCardHtml)로 대체 —
        // 텍스트로 따로 또 보여주지 않는다.
        var counterpartHtml = marketOrderRevealsPhone(o.escrow_status)
          ? marketCounterpartCardHtml(bAvatar, bName, o.buyerPhone)
          : '';
        // 이 구매자가 제출한 가격 조정 요청(있다면) — 거래 상대 정보 카드 바로 아래, 발생 순서에 표시.
        var negoForThisOrder = (detailState.negoRequests || []).find(function (r) { return r.buyer_id === o.buyer_id; });
        var negoHtml = negoForThisOrder ? marketNegoAmountRowHtml(negoForThisOrder) : '';
        // 판매자에게는 실제 정산받는 금액(수수료 차감된 item_price)을 보여준다 — amount는
        // 구매자가 실제로 입금한 총액(수수료 포함)이라 판매자 관점에서는 오해를 줄 수 있다.
        var sellerAmountLabelText = o.deal_type === 'DIRECT_DEAL' ? '거래 금액 : ' : '입금 금액 : ';
        var sellerAmountValueText = formatPrice(o.item_price) + '원';
        return '<div class="market-nego-divider"></div>' +
          marketDealStepsHtml(o) +
          counterpartHtml +
          negoHtml +
          marketDealAmountStatusHtml(sellerAmountLabelText, sellerAmountValueText, o.escrow_status, o.va_due_at) +
          marketDeliveryAddressLineHtml(o) +
          marketSellerDeliveryHtml(o) +
          marketSellerReturnHtml(o);
      }).join('');
    }

    var dealsHistoryHtml = (negoRowsHtml || orderRowsHtml)
      ? '<div class="market-order-history"><div class="market-nego-divider"></div>' +
        '<p class="market-order-history__title--deal-status">거래 진행 상태</p>' +
        negoRowsHtml + orderRowsHtml + '</div>'
      : '';

    // 구매자 전용 "거래내역" — 안전결제로 구매하기 클릭 후, 이후 화면을 나갔다 돌아와도
    // 6단계 진행 스텝바·판매자 연락처(전화·문자 바로가기)를 계속 확인할 수 있게 한다.
    var buyerOrderHistoryHtml = '';
    if (!isMine && myOrder) {
      var sp = detailState.sellerProfile;
      var sellerName = marketSellerDisplayName(sp);
      var sellerAvatar = (sp && sp.profile_image_url) || 'assets/img/profile-placeholder.svg';
      var isDirectDeal = myOrder.deal_type === 'DIRECT_DEAL';
      var buyerAmountLabelText = isDirectDeal ? '거래 금액 : ' : '입금 금액 : ';
      var buyerAmountValueText = formatPrice(myOrder.amount) + '원';
      var vaLineHtml = myOrder.va_account_number
        ? '<div class="market-order-history-contacts">가상계좌 : ' + escapeHtml((myOrder.va_bank_name || '') + ' ' + myOrder.va_account_number) + '</div>'
        : '';
      var sellerCounterpartHtml = marketOrderRevealsPhone(myOrder.escrow_status)
        ? marketCounterpartCardHtml(sellerAvatar, sellerName, detailState.sellerPhone)
        : '';
      buyerOrderHistoryHtml =
        '<div class="market-order-history">' +
          '<div class="market-nego-divider"></div>' +
          '<p class="market-order-history__title--deal-status">거래 진행 상태</p>' +
          marketDealStepsHtml(myOrder) +
          sellerCounterpartHtml +
          marketDealAmountStatusHtml(buyerAmountLabelText, buyerAmountValueText, myOrder.escrow_status, myOrder.va_due_at) +
          vaLineHtml +
          marketDeliveryAddressLineHtml(myOrder) +
          marketBuyerDeliveryHtml(myOrder) +
          marketBuyerReturnHtml(myOrder) +
        '</div>';
    }

    body.innerHTML =
      sliderHtml +
      '<div class="market-detail-info">' +
        sellerRowHtml +
        '<div class="market-detail-title">' + escapeHtml(item.title) + '</div>' +
        priceRowHtml +
        '<div class="market-detail-meta">' +
          '<span>' + escapeHtml(item.condition) + '</span>' +
          '<span>' + escapeHtml(dealMethodText) + '</span>' +
        '</div>' +
        '<div class="market-detail-desc">' + escapeHtml(item.description || '').replace(/\n/g, '<br/>') + '</div>' +
        dealsHistoryHtml +
        buyerOrderHistoryHtml +
      '</div>';

    // 하단 액션 버튼은 body 레벨 플로팅 바(#marketDetailFloatingBar)에 렌더링한다 —
    // .market-scroll-area 안에 있으면 전역 .screen.active 스크롤 컨테이너와 겹쳐 버튼이
    // 눌리지 않는 문제가 있어 하단 네비와 동일하게 완전히 분리했다.
    var floatingBar = document.getElementById('marketDetailFloatingBar');
    var floatingBarContent = document.getElementById('marketDetailFloatingBarContent');
    if (floatingBarContent) floatingBarContent.innerHTML = '<div class="market-detail-action-bar">' + actionHtml + '</div>';
    if (floatingBar) floatingBar.style.display = 'block';

    wireMarketDetailSlider();
    // 거래내역의 입금기한 카운트다운 — 판매자 화면엔 여러 건이 동시에 있을 수 있어 클래스
    // 기준으로 전체를 매초 갱신한다(대회 참가신청 입금기한 표시와 동일 로직).
    if (document.querySelector('.market-tx-row__due')) {
      var vaTimer = setInterval(function () {
        var els = document.querySelectorAll('.market-tx-row__due');
        if (!els.length) {
          clearInterval(vaTimer);
          return;
        }
        Array.prototype.forEach.call(els, function (el) {
          el.textContent = marketFormatRemaining(el.getAttribute('data-va-due'));
        });
      }, 1000);
    }
    var buyBtn = document.getElementById('marketDetailBuyBtn');
    if (buyBtn) buyBtn.onclick = function () { handleMarketBuy(item); };
    var directDealBtn = document.getElementById('marketDetailDirectDealBtn');
    if (directDealBtn) directDealBtn.onclick = function () { handleMarketDirectDeal(item, directDealBtn); };
    var confirmBtn = document.getElementById('marketDetailConfirmBtn');
    if (confirmBtn) confirmBtn.onclick = function () { handleMarketConfirmPurchase(item.id, myOrder.id); };
    var cancelOrderBtn = document.getElementById('marketDetailCancelOrderBtn');
    if (cancelOrderBtn) cancelOrderBtn.onclick = function () { handleMarketCancelOrder(item.id, myOrder.id); };
    var refundToggleBtn = document.getElementById('marketDetailRefundToggleBtn');
    if (refundToggleBtn) {
      refundToggleBtn.onclick = function () {
        var form = document.getElementById('marketRefundForm');
        if (!form) return;
        var showing = form.style.display !== 'none';
        form.style.display = showing ? 'none' : 'block';
        if (!showing) renderMarketFormBankOptionsInto('marketRefundBank');
      };
    }
    var refundSubmitBtn = document.getElementById('marketRefundSubmitBtn');
    if (refundSubmitBtn) refundSubmitBtn.onclick = function () { handleMarketRefundSubmit(item.id, myOrder.id, refundSubmitBtn); };
    var returnToggleBtn = document.getElementById('marketDetailReturnToggleBtn');
    if (returnToggleBtn) {
      returnToggleBtn.onclick = function () {
        var form = document.getElementById('marketReturnRequestForm');
        if (!form) return;
        var showing = form.style.display !== 'none';
        form.style.display = showing ? 'none' : 'block';
        if (!showing) renderMarketFormBankOptionsInto('marketReturnBank');
      };
    }
    var returnSubmitBtn = document.getElementById('marketReturnRequestSubmitBtn');
    if (returnSubmitBtn) returnSubmitBtn.onclick = function () { handleMarketReturnRequestSubmit(item.id, myOrder.id, returnSubmitBtn); };
    Array.prototype.forEach.call(document.querySelectorAll('.market-return-confirm-btn'), function (btn) {
      btn.onclick = function () {
        var orderId = btn.getAttribute('data-order-id');
        var form = document.querySelector('.market-return-address-form[data-order-id="' + orderId + '"]');
        if (form) form.classList.remove('is-hidden');
        btn.style.display = 'none';
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-return-zip-search-btn'), function (btn) {
      btn.onclick = function () {
        var orderId = btn.getAttribute('data-order-id');
        var wrap = document.querySelector('.market-return-address[data-order-id="' + orderId + '"]');
        if (!wrap) return;
        openDaumPostcode(function (result) {
          var zipEl = wrap.querySelector('.market-return-zip');
          var addr1El = wrap.querySelector('.market-return-address1');
          var addr2El = wrap.querySelector('.market-return-address2');
          if (zipEl) zipEl.value = result.zonecode;
          if (addr1El) addr1El.value = result.address;
          if (addr2El) addr2El.focus();
        });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-return-address-submit-btn'), function (btn) {
      btn.onclick = function () { handleMarketSetReturnAddress(item.id, btn); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-return-delivery-submit-btn'), function (btn) {
      btn.onclick = function () { handleMarketSetReturnTracking(item.id, btn); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-return-delivery-edit-btn'), function (btn) {
      btn.onclick = function () {
        var orderId = btn.getAttribute('data-order-id');
        var form = document.querySelector('.market-return-delivery-form[data-order-id="' + orderId + '"]');
        if (form) form.classList.remove('is-hidden');
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-return-delivery-edit-cancel-btn'), function (btn) {
      btn.onclick = function () {
        var orderId = btn.getAttribute('data-order-id');
        var form = document.querySelector('.market-return-delivery-form[data-order-id="' + orderId + '"]');
        if (form) form.classList.add('is-hidden');
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-return-complete-btn'), function (btn) {
      btn.onclick = function () { handleMarketReturnComplete(item.id, btn); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-return-dispute-btn'), function (btn) {
      btn.onclick = function () { handleMarketReturnDispute(item.id, btn); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-return-agree-btn'), function (btn) {
      btn.onclick = function () { handleMarketReturnAgree(item.id, btn.getAttribute('data-order-id'), btn); };
    });
    var bumpBtn = document.getElementById('marketDetailBumpBtn');
    if (bumpBtn) bumpBtn.onclick = function () { handleBump(item.id, bumpBtn); };
    var editBtn = document.getElementById('marketDetailEditBtn');
    if (editBtn) editBtn.onclick = function () { window.navigateToMarketFormForEdit(item); };
    var deleteBtn = document.getElementById('marketDetailDeleteBtn');
    if (deleteBtn) deleteBtn.onclick = function () { handleMarketDelete(item.id); };
    var negoSubmitBtn = document.getElementById('marketNegoSubmitBtn');
    if (negoSubmitBtn) negoSubmitBtn.onclick = function () { handleMarketNegoSubmit(item, negoSubmitBtn); };
    Array.prototype.forEach.call(document.querySelectorAll('.market-nego-accept-btn'), function (btn) {
      btn.onclick = function () { handleMarketNegoDecide(item.id, btn.getAttribute('data-nego-id'), true); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-nego-reject-btn'), function (btn) {
      btn.onclick = function () { handleMarketNegoDecide(item.id, btn.getAttribute('data-nego-id'), false); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-delivery-submit-btn'), function (btn) {
      btn.onclick = function () { handleMarketSetTracking(item.id, btn); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-delivery-edit-btn'), function (btn) {
      btn.onclick = function () {
        var orderId = btn.getAttribute('data-order-id');
        var form = document.querySelector('.market-delivery-form[data-order-id="' + orderId + '"]');
        if (form) form.classList.remove('is-hidden');
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-delivery-edit-cancel-btn'), function (btn) {
      btn.onclick = function () {
        var orderId = btn.getAttribute('data-order-id');
        var form = document.querySelector('.market-delivery-form[data-order-id="' + orderId + '"]');
        if (form) form.classList.add('is-hidden');
      };
    });
    if (myOrder && myOrder.escrow_status === 'CONFIRMED') {
      var starsWrap = document.getElementById('marketRatingStars');
      if (starsWrap) {
        Array.prototype.forEach.call(starsWrap.querySelectorAll('.market-rating-star-btn'), function (starBtn) {
          starBtn.onclick = function () {
            handleMarketRateSeller(myOrder.id, item.user_id, Number(starBtn.getAttribute('data-score')));
          };
        });
      }
    }
  }

  var marketRatingSaving = false;
  function handleMarketRateSeller(orderId, sellerId, score) {
    if (marketRatingSaving) return;
    marketRatingSaving = true;
    var isClear = score === detailState.myRating;
    loadMarketService()
      .then(function (s) {
        return isClear ? s.clearSellerRating(orderId) : s.submitSellerRating(orderId, sellerId, score);
      })
      .then(function () {
        detailState.myRating = isClear ? 0 : score;
        toast(isClear ? '만족도 평가가 초기화되었습니다.' : '만족도가 저장되었습니다.');
        return loadMarketService().then(function (s) { return s.getSellerRatingAggregate(sellerId); });
      })
      .then(function (agg) {
        detailState.ratingAvg = agg ? agg.avg : 0;
        detailState.ratingCount = agg ? agg.count : 0;
        var hint = document.getElementById('marketRatingHint');
        if (hint) hint.textContent = marketRatingHintText(detailState.myRating);
        var starsWrap = document.getElementById('marketRatingStars');
        if (starsWrap) {
          Array.prototype.forEach.call(starsWrap.querySelectorAll('.market-rating-star-btn'), function (starBtn) {
            var i = Number(starBtn.getAttribute('data-score'));
            starBtn.classList.toggle('filled', (detailState.myRating >= 2 ? detailState.myRating : 0) >= i);
          });
        }
      })
      .catch(function (err) {
        toast('평가 저장 실패: ' + (err && err.message ? err.message : err));
      })
      .finally(function () { marketRatingSaving = false; });
  }

  function wireMarketDetailSlider() {
    var track = document.getElementById('marketDetailSliderTrack');
    var slider = document.getElementById('marketDetailSlider');
    if (!track || !slider) return;
    var startX = null;
    slider.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
    }, { passive: true });
    slider.addEventListener('touchend', function (e) {
      if (startX == null) return;
      var dx = e.changedTouches[0].clientX - startX;
      var imgs = track.querySelectorAll('.market-detail-slider__img');
      if (dx < -40 && detailState.sliderIndex < imgs.length - 1) detailState.sliderIndex++;
      else if (dx > 40 && detailState.sliderIndex > 0) detailState.sliderIndex--;
      applySliderPosition();
      startX = null;
    }, { passive: true });
  }

  function applySliderPosition() {
    var track = document.getElementById('marketDetailSliderTrack');
    if (!track) return;
    track.style.transform = 'translateX(-' + (detailState.sliderIndex * 100) + '%)';
    var dots = document.querySelectorAll('.market-detail-slider__dot');
    Array.prototype.forEach.call(dots, function (dot, i) {
      dot.classList.toggle('active', i === detailState.sliderIndex);
    });
  }

  function handleMarketBuy(item) {
    var nego = detailState.myNegoRequest;
    var buyPrice = (nego && nego.status === 'ACCEPTED') ? Number(nego.requested_price) : Number(item.price);
    showMarketPurchaseAddressPopup(item, buyPrice);
  }

  /** 안전결제 구매 확인 팝업 — 결제 전 배송받을 주소를 입력받는다(대회 참가신청과 동일한
   * Daum 우편번호 검색 폼을 openDaumPostcode로 재사용). 주소 입력을 완료해야 결제가 진행된다. */
  function showMarketPurchaseAddressPopup(item, buyPrice) {
    var modal = document.getElementById('marketPurchaseAddressModal');
    if (!modal) { doMarketBuy(item, null); return; }
    var msgEl = document.getElementById('marketPurchaseAddressMessage');
    var zipEl = document.getElementById('marketPurchaseZip');
    var addr1El = document.getElementById('marketPurchaseAddress1');
    var addr2El = document.getElementById('marketPurchaseAddress2');
    var okBtn = document.getElementById('marketPurchaseAddressOkBtn');
    var cancelBtn = document.getElementById('marketPurchaseAddressCancelBtn');
    var searchBtn = document.getElementById('marketPurchaseZipSearchBtn');
    if (msgEl) {
      msgEl.textContent =
        formatPrice(buyPrice) + '원 + 안전결제 수수료 1,000원 = 총 ' + formatPrice(buyPrice + 1000) + '원을 결제합니다.\n' +
        '상품을 받으실 배송 주소를 입력해 주세요.';
    }
    if (zipEl) zipEl.value = '';
    if (addr1El) addr1El.value = '';
    if (addr2El) addr2El.value = '';
    if (searchBtn) {
      searchBtn.onclick = function () {
        openDaumPostcode(function (result) {
          if (zipEl) zipEl.value = result.zonecode;
          if (addr1El) addr1El.value = result.address;
          if (addr2El) addr2El.focus();
        });
      };
    }
    if (cancelBtn) cancelBtn.onclick = closeMarketPurchaseAddressPopup;
    if (okBtn) {
      okBtn.onclick = function () {
        var zipCode = zipEl ? zipEl.value.trim() : '';
        var address1 = addr1El ? addr1El.value.trim() : '';
        var address2 = addr2El ? addr2El.value.trim() : '';
        if (!zipCode || !address1) { toast('주소 검색으로 배송받을 주소를 입력해 주세요.'); return; }
        if (!address2) { toast('상세주소를 입력해 주세요.'); return; }
        closeMarketPurchaseAddressPopup();
        doMarketBuy(item, { zipCode: zipCode, address1: address1, address2: address2 });
      };
    }
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeMarketPurchaseAddressPopup() {
    var modal = document.getElementById('marketPurchaseAddressModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }
  window.closeMarketPurchaseAddressPopup = closeMarketPurchaseAddressPopup;

  async function doMarketBuy(item, address) {
    var btn = document.getElementById('marketDetailBuyBtn');
    if (btn) { btn.disabled = true; btn.textContent = '가상계좌 발급 중...'; }
    try {
      var s = await loadMarketService();
      var result = await s.requestMarketPurchase(item.id, address);
      var va = result.virtualAccount || {};
      showMarketAlertPopup(
        '은행: ' + (va.bankName || va.bankCode || '') + '\n' +
        '계좌번호: ' + (va.accountNumber || '') + '\n' +
        '입금액: ' + formatPrice(result.amount) + '원\n' +
        '입금기한: ' + (va.dueDate ? new Date(va.dueDate).toLocaleString('ko-KR') : '') + '\n\n' +
        '입금이 확인되면 판매자에게 알림이 가고, 물품 수령 후 [구매 확정]을 눌러주세요.',
        function () { openMarketItemDetail(item.id); },
        { title: '안전결제 가상계좌가 발급되었습니다' }
      );
    } catch (err) {
      toast('구매 요청 실패: ' + (err && err.message ? err.message : err));
      if (btn) { btn.disabled = false; btn.textContent = '안전결제로 구매하기'; }
    }
  }

  function handleMarketDirectDeal(item, btn) {
    var nego = detailState.myNegoRequest;
    var dealPrice = (nego && nego.status === 'ACCEPTED') ? Number(nego.requested_price) : Number(item.price);
    showMarketConfirmPopup(
      formatPrice(dealPrice) + '원에 직거래를 요청할까요? 안전결제(가상계좌 입금) 없이 예약되며, 판매자와 직접 만나 대금을 주고받습니다.',
      function () { doMarketDirectDeal(item, btn); },
      { okText: '직거래 요청' }
    );
  }

  async function doMarketDirectDeal(item, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '요청 중...'; }
    try {
      var s = await loadMarketService();
      await s.requestMarketDirectDeal(item.id);
      toast('직거래를 요청했습니다. 판매자 연락처를 확인해 거래를 진행해 주세요.');
      openMarketItemDetail(item.id);
    } catch (err) {
      toast('직거래 요청 실패: ' + (err && err.message ? err.message : err));
      if (btn) { btn.disabled = false; btn.textContent = '직거래 요청'; }
    }
  }

  function handleMarketConfirmPurchase(itemId, orderId) {
    showMarketConfirmPopup(
      '물품을 정상적으로 수령하셨습니까? 확정하면 판매자에게 대금이 정산됩니다.',
      function () { doMarketConfirmPurchase(itemId, orderId); },
      { okText: '구매 확정' }
    );
  }

  async function doMarketConfirmPurchase(itemId, orderId) {
    var btn = document.getElementById('marketDetailConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
    try {
      var s = await loadMarketService();
      await s.confirmMarketPurchase(orderId);
      toast('구매를 확정했습니다. 이용해 주셔서 감사합니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('구매 확정 실패: ' + (err && err.message ? err.message : err));
      if (btn) { btn.disabled = false; btn.textContent = '구매 확정하기'; }
    }
  }

  function handleMarketCancelOrder(itemId, orderId) {
    showMarketConfirmPopup(
      '구매를 취소할까요? 아직 입금 전이라 별도 환불 절차 없이 바로 취소됩니다.',
      function () { doMarketCancelOrder(itemId, orderId); },
      { okText: '구매 취소', cancelText: '계속 진행' }
    );
  }

  async function doMarketCancelOrder(itemId, orderId) {
    var btn = document.getElementById('marketDetailCancelOrderBtn');
    if (btn) { btn.disabled = true; btn.textContent = '취소 중...'; }
    try {
      var s = await loadMarketService();
      await s.cancelMarketOrder(orderId);
      toast('구매가 취소되었습니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('취소 실패: ' + (err && err.message ? err.message : err));
      if (btn) { btn.disabled = false; btn.textContent = '구매 취소'; }
    }
  }

  function handleMarketRefundSubmit(itemId, orderId, submitBtn) {
    var bankEl = document.getElementById('marketRefundBank');
    var accNumEl = document.getElementById('marketRefundAccountNumber');
    var holderEl = document.getElementById('marketRefundHolderName');
    var bank = bankEl ? bankEl.value : '';
    var accountNumber = (accNumEl ? accNumEl.value : '').replace(/[^0-9]/g, '');
    var holderName = (holderEl ? holderEl.value : '').trim();
    if (!accountNumber || !/^[0-9]{6,20}$/.test(accountNumber)) {
      toast('환불 계좌번호를 정확히 입력해 주세요(숫자만).');
      return;
    }
    if (!holderName || holderName.length < 2) {
      toast('예금주명을 입력해 주세요.');
      return;
    }
    showMarketConfirmPopup(
      '환불을 신청할까요? 상품가만 환불되며(수수료 1,000원 제외), 신청 후 취소할 수 없습니다.',
      function () { doMarketRefundSubmit(itemId, orderId, submitBtn, bank, accountNumber, holderName); },
      { okText: '환불 신청' }
    );
  }

  async function doMarketRefundSubmit(itemId, orderId, submitBtn, bank, accountNumber, holderName) {
    submitBtn.disabled = true;
    submitBtn.textContent = '환불 처리 중...';
    try {
      var s = await loadMarketService();
      var result = await s.requestMarketOrderRefund(orderId, { bank: bank, accountNumber: accountNumber, holderName: holderName });
      toast(formatPrice(result.refundAmount) + '원 환불이 접수되었습니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('환불 신청 실패: ' + (err && err.message ? err.message : err));
      submitBtn.disabled = false;
      submitBtn.textContent = '환불 신청';
    }
  }

  function handleMarketDelete(itemId) {
    showMarketConfirmPopup(
      '이 상품을 삭제할까요?',
      function () { doMarketDelete(itemId); },
      { okText: '삭제' }
    );
  }

  async function doMarketDelete(itemId) {
    try {
      var s = await loadMarketService();
      await s.deleteMarketItem(itemId);
      toast('삭제되었습니다.');
      window.navigateToMarketLand();
    } catch (err) {
      toast('삭제 실패: ' + (err && err.message ? err.message : err));
    }
  }

  async function handleMarketNegoSubmit(item, btn) {
    var input = document.getElementById('marketNegoPriceInput');
    var priceRaw = input ? (input.value || '').replace(/[^0-9]/g, '') : '';
    var price = Number(priceRaw);
    if (!priceRaw || price <= 0) { toast('희망 가격을 숫자로 입력해 주세요.'); return; }
    if (price >= Number(item.price)) { toast('현재 판매가보다 낮은 금액을 입력해 주세요.'); return; }
    btn.disabled = true;
    btn.textContent = '요청 중...';
    try {
      var s = await loadMarketService();
      await s.submitMarketNegoRequest(item.id, price);
      toast('가격 조정을 요청했습니다.');
      openMarketItemDetail(item.id);
    } catch (err) {
      toast('요청 실패: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
      btn.textContent = '가격 조정 요구';
    }
  }

  /** 스텔비오 전역 종료확인 팝업(showStelvioExitConfirmPopup)과 동일한 구조·상호작용을
   * 중고랜드 전용 오렌지 톤(#marketConfirmModal)으로 재구현 — 네이티브 confirm() 대체.
   * 팝업 요소가 없는 예외 상황을 대비해 네이티브 confirm() 폴백은 유지한다. */
  function showMarketConfirmPopup(message, onConfirm, options) {
    options = options || {};
    var modal = document.getElementById('marketConfirmModal');
    if (!modal) {
      if (confirm(message)) onConfirm();
      return;
    }
    var titleEl = document.getElementById('marketConfirmTitle');
    var msgEl = document.getElementById('marketConfirmMessage');
    var okBtn = document.getElementById('marketConfirmOkBtn');
    var cancelBtn = document.getElementById('marketConfirmCancelBtn');
    if (titleEl) {
      if (options.title) { titleEl.textContent = options.title; titleEl.style.display = 'block'; }
      else { titleEl.textContent = ''; titleEl.style.display = 'none'; }
    }
    if (msgEl) {
      msgEl.textContent = message;
      msgEl.classList.toggle('market-confirm-message--detail', !!options.detail);
    }
    if (okBtn) okBtn.textContent = options.okText || '확인';
    if (cancelBtn) {
      cancelBtn.textContent = options.cancelText || '취소';
      cancelBtn.style.display = options.hideCancel ? 'none' : '';
    }
    if (okBtn) {
      okBtn.onclick = function () {
        closeMarketConfirmPopup();
        if (typeof onConfirm === 'function') onConfirm();
      };
    }
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  /** 확인 버튼 하나만 있는 안내형 팝업(가상계좌 발급 안내 등) — showMarketConfirmPopup을
   * 취소 버튼 없이 재사용한다. */
  function showMarketAlertPopup(message, onOk, options) {
    options = Object.assign({ hideCancel: true, detail: true }, options || {});
    showMarketConfirmPopup(message, onOk, options);
  }

  function closeMarketConfirmPopup() {
    var modal = document.getElementById('marketConfirmModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }
  window.closeMarketConfirmPopup = closeMarketConfirmPopup;

  async function handleMarketNegoDecide(itemId, requestId, accept) {
    showMarketConfirmPopup(
      accept ? '이 가격 조정 요청을 수락할까요?' : '이 가격 조정 요청을 거절할까요?',
      async function () {
        try {
          var s = await loadMarketService();
          await s.decideMarketNegoRequest(requestId, accept);
          toast(accept ? '가격 조정을 수락했습니다.' : '가격 조정을 거절했습니다.');
          openMarketItemDetail(itemId);
        } catch (err) {
          toast('처리 실패: ' + (err && err.message ? err.message : err));
        }
      },
      { okText: accept ? '수락' : '거절' }
    );
  }

  async function handleMarketSetTracking(itemId, btn) {
    var orderId = btn.getAttribute('data-order-id');
    var form = document.querySelector('.market-delivery-form[data-order-id="' + orderId + '"]');
    if (!form) return;
    var courierSelect = form.querySelector('.market-delivery-courier-select');
    var trackingInput = form.querySelector('.market-delivery-tracking-input');
    var courierCode = courierSelect ? courierSelect.value : '';
    var trackingNumber = (trackingInput ? trackingInput.value : '').trim();
    if (!trackingNumber) { toast('송장번호를 입력해 주세요.'); return; }
    btn.disabled = true;
    btn.textContent = '등록 중...';
    try {
      var s = await loadMarketService();
      await s.setMarketOrderTracking(orderId, courierCode, trackingNumber);
      toast('택배사·송장번호를 등록했습니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('등록 실패: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
      btn.textContent = '택배사/송장번호 등록';
    }
  }

  /** 반품 신청 시 환불 계좌 정보 입력 폼 — handleMarketRefundSubmit과 동일한 검증 로직. */
  function handleMarketReturnRequestSubmit(itemId, orderId, submitBtn) {
    var bankEl = document.getElementById('marketReturnBank');
    var accNumEl = document.getElementById('marketReturnAccountNumber');
    var holderEl = document.getElementById('marketReturnHolderName');
    var bank = bankEl ? bankEl.value : '';
    var accountNumber = (accNumEl ? accNumEl.value : '').replace(/[^0-9]/g, '');
    var holderName = (holderEl ? holderEl.value : '').trim();
    if (!accountNumber || !/^[0-9]{6,20}$/.test(accountNumber)) {
      toast('환불 계좌번호를 정확히 입력해 주세요(숫자만).');
      return;
    }
    if (!holderName || holderName.length < 2) {
      toast('예금주명을 입력해 주세요.');
      return;
    }
    showMarketConfirmPopup(
      '반품을 신청할까요? 신청 후 판매자가 반품 받을 주소를 등록하면 반품 택배를 발송할 수 있습니다.',
      function () { doMarketReturnRequestSubmit(itemId, orderId, submitBtn, bank, accountNumber, holderName); },
      { okText: '반품 신청' }
    );
  }

  async function doMarketReturnRequestSubmit(itemId, orderId, submitBtn, bank, accountNumber, holderName) {
    submitBtn.disabled = true;
    submitBtn.textContent = '신청 중...';
    try {
      var s = await loadMarketService();
      await s.requestMarketReturn(orderId, { bank: bank, accountNumber: accountNumber, holderName: holderName });
      toast('반품을 신청했습니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('반품 신청 실패: ' + (err && err.message ? err.message : err));
      submitBtn.disabled = false;
      submitBtn.textContent = '반품 신청';
    }
  }

  async function handleMarketSetReturnAddress(itemId, btn) {
    var orderId = btn.getAttribute('data-order-id');
    var wrap = document.querySelector('.market-return-address[data-order-id="' + orderId + '"]');
    if (!wrap) return;
    var zipEl = wrap.querySelector('.market-return-zip');
    var addr1El = wrap.querySelector('.market-return-address1');
    var addr2El = wrap.querySelector('.market-return-address2');
    var zipCode = zipEl ? zipEl.value.trim() : '';
    var address1 = addr1El ? addr1El.value.trim() : '';
    var address2 = addr2El ? addr2El.value.trim() : '';
    if (!zipCode || !address1) { toast('주소 검색으로 주소를 입력해 주세요.'); return; }
    if (!address2) { toast('상세주소를 입력해 주세요.'); return; }
    btn.disabled = true;
    btn.textContent = '등록 중...';
    try {
      var s = await loadMarketService();
      await s.setMarketReturnAddress(orderId, zipCode, address1, address2);
      toast('반품 받을 주소를 등록했습니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('주소 등록 실패: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
      btn.textContent = '주소 등록';
    }
  }

  async function handleMarketSetReturnTracking(itemId, btn) {
    var orderId = btn.getAttribute('data-order-id');
    var form = document.querySelector('.market-return-delivery-form[data-order-id="' + orderId + '"]');
    if (!form) return;
    var courierSelect = form.querySelector('.market-return-delivery-courier-select');
    var trackingInput = form.querySelector('.market-return-delivery-tracking-input');
    var courierCode = courierSelect ? courierSelect.value : '';
    var trackingNumber = (trackingInput ? trackingInput.value : '').trim();
    if (!trackingNumber) { toast('반품 송장번호를 입력해 주세요.'); return; }
    btn.disabled = true;
    btn.textContent = '등록 중...';
    try {
      var s = await loadMarketService();
      await s.setMarketReturnTracking(orderId, courierCode, trackingNumber);
      toast('반품 택배사·송장번호를 등록했습니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('등록 실패: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
      btn.textContent = '반품 송장번호 등록';
    }
  }

  function handleMarketReturnComplete(itemId, btn) {
    var orderId = btn.getAttribute('data-order-id');
    showMarketConfirmPopup(
      '반품을 완료 처리할까요? 즉시 구매자에게 환불됩니다.',
      function () { doMarketReturnComplete(itemId, orderId, btn); },
      { okText: '반품완료' }
    );
  }

  async function doMarketReturnComplete(itemId, orderId, btn) {
    btn.disabled = true;
    btn.textContent = '처리 중...';
    try {
      var s = await loadMarketService();
      await s.completeMarketReturn(orderId);
      toast('반품이 완료되어 환불되었습니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('반품완료 처리 실패: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
      btn.textContent = '반품완료';
    }
  }

  function handleMarketReturnDispute(itemId, btn) {
    var orderId = btn.getAttribute('data-order-id');
    showMarketConfirmPopup(
      '이의제기할까요? 대금 지급이 보류되며, 구매자와 합의 후 [합의완료]를 눌러야 환불됩니다.',
      function () { doMarketReturnDispute(itemId, orderId, btn); },
      { okText: '이의제기' }
    );
  }

  async function doMarketReturnDispute(itemId, orderId, btn) {
    btn.disabled = true;
    try {
      var s = await loadMarketService();
      await s.disputeMarketReturn(orderId);
      toast('이의제기가 접수되었습니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('이의제기 실패: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
    }
  }

  async function handleMarketReturnAgree(itemId, orderId, btn) {
    btn.disabled = true;
    btn.textContent = '처리 중...';
    try {
      var s = await loadMarketService();
      var result = await s.agreeMarketReturnDispute(orderId);
      toast(result && result.finalized ? '합의가 완료되어 환불되었습니다.' : '합의 처리되었습니다. 상대방 확인을 기다립니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('처리 실패: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
      btn.textContent = '합의완료';
    }
  }

  /**
   * 반품받을 주소 검색 — 대회 참가신청(competitionApplicationForm.js의 openDaumPostcode)과
   * 동일한 로직: .embed()로 오버레이 안에 iframe 렌더링해 iOS Safari 팝업 차단을 피한다.
   * CSS는 index.html에 이미 전역으로 정의된 .competition-postcode-* 클래스를 그대로 재사용한다.
   */
  function openDaumPostcode(onComplete) {
    function launch() {
      var overlay = document.createElement('div');
      overlay.className = 'competition-postcode-overlay';
      overlay.innerHTML =
        '<div class="competition-postcode-modal">' +
        '  <div class="competition-postcode-header">' +
        '    <span>주소 검색</span>' +
        '    <button type="button" class="competition-postcode-close" aria-label="닫기">&times;</button>' +
        '  </div>' +
        '  <div class="competition-postcode-embed"></div>' +
        '</div>';
      document.body.appendChild(overlay);

      var removed = false;
      var remove = function () {
        if (removed) return;
        removed = true;
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      };
      overlay.querySelector('.competition-postcode-close').addEventListener('click', remove);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) remove();
      });

      new window.daum.Postcode({
        oncomplete: function (data) {
          var addr = data.userSelectedType === 'R' ? data.roadAddress : data.jibunAddress;
          var extra = '';
          if (data.userSelectedType === 'R') {
            if (data.bname) extra += data.bname;
            if (data.buildingName) extra += extra ? ', ' + data.buildingName : data.buildingName;
            if (extra) addr += ' (' + extra + ')';
          }
          remove();
          onComplete({ zonecode: data.zonecode, address: addr });
        },
        width: '100%',
        height: '100%',
      }).embed(overlay.querySelector('.competition-postcode-embed'));
    }
    if (window.daum && window.daum.Postcode) {
      launch();
      return;
    }
    var script = document.createElement('script');
    script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.onload = launch;
    script.onerror = function () {
      alert('우편번호 서비스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    };
    document.body.appendChild(script);
  }

  window.marketItemDetailScreenInit = function () {
    syncMarketBottomNav(null);
  };

  // ───────────────────────── 마이페이지 화면 ─────────────────────────

  var myPageState = { tab: 'selling' };

  function renderMyPageTabs() {
    var wrap = document.getElementById('marketMyPageTabs');
    if (!wrap) return;
    var tabs = [
      { key: 'selling', label: '내 상품', icon: 'my' },
      { key: 'favorites', label: '찜한 상품', icon: 'heart' },
      { key: 'deals', label: '나의거래내역', icon: 'deal' },
    ];
    wrap.innerHTML = tabs.map(function (t) {
      return '<button type="button" class="market-subtab' + (myPageState.tab === t.key ? ' active' : '') +
        '" data-tab="' + t.key + '" aria-label="' + t.label + '" title="' + t.label + '">' +
        '<img class="market-subtab__icon" src="assets/img/' + t.icon + '.svg" alt="" /></button>';
    }).join('');
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-tab]'), function (btn) {
      btn.onclick = function () {
        myPageState.tab = btn.getAttribute('data-tab');
        renderMyPageTabs();
        loadMyPageContent();
      };
    });
  }

  var MARKET_DEALS_RESERVED_STATUSES = ['PENDING', 'PAID'];

  function loadMyPageContent() {
    var grid = document.getElementById('marketMyPageGrid');
    if (!grid) return;
    grid.className = myPageState.tab === 'deals' ? 'market-deals-list' : 'market-grid';
    grid.innerHTML = '<div class="market-loading">불러오는 중...</div>';
    loadMarketService()
      .then(function (s) {
        if (myPageState.tab === 'deals') return renderMyDeals(s, grid);
        if (myPageState.tab === 'favorites') {
          return s.getMyFavoriteItemIds().then(function (ids) {
            return Promise.all(Array.from(ids).map(function (id) { return s.getMarketItem(id); }));
          }).then(function (rows) {
            renderMyPageItemGrid(grid, rows, '찜한 상품이 없습니다.');
          });
        }
        return s.getMyMarketItems().then(function (rows) {
          renderMyPageItemGrid(grid, rows, '등록한 상품이 없습니다.');
        });
      })
      .catch(function (err) {
        grid.innerHTML = '<div class="market-empty">불러오지 못했습니다: ' + escapeHtml(err.message || String(err)) + '</div>';
      });
  }

  function renderMyPageItemGrid(grid, rows, emptyMessage) {
    rows = (rows || []).filter(Boolean);
    grid.innerHTML = rows.length ? rows.map(marketItemCardHtml).join('') : '<div class="market-empty">' + emptyMessage + '</div>';
    wireMarketGridEvents(grid);
  }

  /** "나의거래내역" — 내가 구매자인 주문을 예약중(PENDING·PAID)/거래완료(CONFIRMED)로 나눠 표시 */
  function renderMyDeals(s, grid) {
    return s.getMyMarketOrders().then(function (orders) {
      orders = orders || [];
      var reserved = orders.filter(function (o) { return MARKET_DEALS_RESERVED_STATUSES.indexOf(o.escrow_status) !== -1; });
      var completed = orders.filter(function (o) { return o.escrow_status === 'CONFIRMED'; });
      function sectionHtml(title, list) {
        var cardsHtml = list.length
          ? '<div class="market-grid">' + list.map(function (o) { return marketItemCardHtml(o.item); }).join('') + '</div>'
          : '<div class="market-empty">' + title + ' 내역이 없습니다.</div>';
        return '<p class="market-order-history__title">' + title + '</p>' + cardsHtml;
      }
      grid.innerHTML = sectionHtml('예약중', reserved) + sectionHtml('거래완료', completed);
      wireMarketGridEvents(grid);
    });
  }

  window.marketMyPageScreenInit = function () {
    syncMarketBottomNav('mypage');
    myPageState.tab = 'selling';
    loadMarketService()
      .then(function (s) { return s.getMySupabaseUserId(); })
      .then(function (id) { homeState.myUserId = id; })
      .catch(function () {})
      .finally(function () {
        renderMyPageTabs();
        loadMyPageContent();
      });
  };

  window.navigateToMarketMyPage = function () {
    if (typeof window.showScreen === 'function') window.showScreen('marketMyPageScreen');
  };

  // ───────────────────────── 하단 네비게이션 ─────────────────────────

  window.marketNavGoHome = function () {
    syncMarketBottomNav(null);
    if (typeof window.showScreen === 'function') window.showScreen('sportCategoryScreen');
  };
  window.marketNavGoList = function () {
    window.navigateToMarketLand();
  };
  window.marketNavGoRegister = function () {
    window.navigateToMarketForm();
  };
  window.marketNavGoMyPage = function () {
    window.navigateToMarketMyPage();
  };
})();
