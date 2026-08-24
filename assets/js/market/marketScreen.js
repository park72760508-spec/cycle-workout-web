/**
 * 중고랜드(Market Land) 화면 컨트롤러 — 홈/목록·등록·상세·마이페이지 4개 화면을 vanilla JS로 렌더링한다.
 * (openRiding처럼 React가 아니라 competitionScreen.js/userManager.js와 동일한 템플릿 문자열 방식 —
 * 이 화면군은 별도 React 마운트가 필요 없을 만큼 단순해 무거운 React 트리 없이도 충분하다.)
 */
(function () {
  'use strict';

  var MARKET_SERVICE_URL = './marketService.js?v=20260828market9';
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

  function marketFormatDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('ko-KR');
    } catch (e) { return ''; }
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

  var detailState = { item: null, sliderIndex: 0, sellerProfile: null, sellerPhone: '', favoriteCount: 0, ratingAvg: 0, ratingCount: 0, myRating: 0, myNegoRequest: null, pendingNego: [] };

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
              var pendingNego = isMine ? negoRows.filter(function (r) { return r.status === 'PENDING'; }) : [];
              return Promise.all(pendingNego.map(function (r) { return s.getSellerPublicProfile(r.buyer_id).catch(function () { return null; }); }))
                .then(function (buyerProfiles) {
                  var pendingNegoWithBuyer = pendingNego.map(function (r, i) { return Object.assign({}, r, { buyerProfile: buyerProfiles[i] }); });
                  return {
                    item: item, myUserId: myUserId, myOrder: res[2],
                    sellerProfile: extra[0], sellerPhone: extra[1], favoriteCount: extra[2], ratingAgg: extra[3], myRating: extra[4],
                    myNegoRequest: myNegoRequest, pendingNego: pendingNegoWithBuyer,
                  };
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
        detailState.pendingNego = res.pendingNego;
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

    var sliderHtml =
      '<div class="market-detail-slider" id="marketDetailSlider">' +
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
    } else if (myOrder && myOrder.escrow_status === 'PAID') {
      actionHtml =
        '<div class="market-detail-order-notice">입금이 확인되었습니다. 물품을 수령하셨으면 아래 버튼을 눌러주세요.</div>' +
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
      actionHtml = '<button type="button" class="market-btn market-btn--primary" id="marketDetailBuyBtn">안전결제로 구매하기</button>';
    }

    var seller = detailState.sellerProfile;
    var sellerName = marketSellerDisplayName(seller);
    var sellerPhoneFormatted = marketFormatPhone(detailState.sellerPhone);
    var sellerNameDisplay = sellerName + (sellerPhoneFormatted ? '(' + sellerPhoneFormatted + ')' : '');
    var sellerAvatarUrl = (seller && seller.profile_image_url) || 'assets/img/profile-placeholder.svg';
    var sellerRowHtml =
      '<div class="market-detail-seller-row">' +
        '<div class="market-detail-seller-row__left">' +
          '<img class="market-detail-seller-avatar" src="' + escapeHtml(sellerAvatarUrl) + '" alt="" />' +
          '<span class="market-detail-seller-name">' + escapeHtml(sellerNameDisplay) + '</span>' +
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
    var priceRowHtml;
    if (!isMine && item.negotiable && !myOrder) {
      if (nego && nego.status === 'PENDING') {
        priceRowHtml =
          '<div class="market-detail-price">' + formatPrice(item.price) + '원</div>' +
          '<div class="market-nego-status market-nego-status--pending">가격 조정 요청 중 (제안가 ' + formatPrice(nego.requested_price) + '원)</div>';
      } else if (nego && nego.status === 'ACCEPTED') {
        priceRowHtml =
          '<div class="market-detail-price market-detail-price--negotiated">' +
            '<span class="market-detail-price__original">' + formatPrice(item.price) + '원</span>' +
            '<span class="market-detail-price__final">' + formatPrice(nego.requested_price) + '원</span>' +
          '</div>' +
          '<div class="market-nego-status market-nego-status--accepted">판매자가 가격 조정을 수락했습니다. 조정된 금액으로 구매할 수 있습니다.</div>';
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

    var negoListHtml = '';
    if (isMine && detailState.pendingNego && detailState.pendingNego.length) {
      negoListHtml =
        '<div class="market-nego-divider"></div>' +
        '<div class="market-nego-requests">' +
          detailState.pendingNego.map(function (r) {
            var bp = r.buyerProfile;
            var bName = marketSellerDisplayName(bp);
            var bAvatar = (bp && bp.profile_image_url) || 'assets/img/profile-placeholder.svg';
            return '<div class="market-nego-request-row">' +
              '<div class="market-nego-request-row__top">' +
                '<img class="market-nego-request-avatar" src="' + escapeHtml(bAvatar) + '" alt="" />' +
                '<span class="market-nego-request-name">' + escapeHtml(bName) + '</span>' +
              '</div>' +
              '<div class="market-nego-request-row__bottom">' +
                '<span class="market-nego-request-amount">가격 조정 요구 : ' + formatPrice(r.requested_price) + '원</span>' +
                '<div class="market-nego-request-actions">' +
                  '<button type="button" class="market-nego-accept-btn" data-nego-id="' + r.id + '">수락</button>' +
                  '<button type="button" class="market-nego-reject-btn" data-nego-id="' + r.id + '">거절</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>';
    }

    body.innerHTML =
      sliderHtml +
      '<div class="market-detail-info">' +
        sellerRowHtml +
        statusBadgeHtml(item.status) +
        '<div class="market-detail-title">' + escapeHtml(item.title) + '</div>' +
        priceRowHtml +
        '<div class="market-detail-meta">' +
          '<span>' + escapeHtml(item.condition) + '</span>' +
          '<span>' + escapeHtml(dealMethodText) + '</span>' +
        '</div>' +
        '<div class="market-detail-desc">' + escapeHtml(item.description || '').replace(/\n/g, '<br/>') + '</div>' +
        negoListHtml +
      '</div>';

    // 하단 액션 버튼은 body 레벨 플로팅 바(#marketDetailFloatingBar)에 렌더링한다 —
    // .market-scroll-area 안에 있으면 전역 .screen.active 스크롤 컨테이너와 겹쳐 버튼이
    // 눌리지 않는 문제가 있어 하단 네비와 동일하게 완전히 분리했다.
    var floatingBar = document.getElementById('marketDetailFloatingBar');
    var floatingBarContent = document.getElementById('marketDetailFloatingBarContent');
    if (floatingBarContent) floatingBarContent.innerHTML = '<div class="market-detail-action-bar">' + actionHtml + '</div>';
    if (floatingBar) floatingBar.style.display = 'block';

    wireMarketDetailSlider();
    var buyBtn = document.getElementById('marketDetailBuyBtn');
    if (buyBtn) buyBtn.onclick = function () { handleMarketBuy(item); };
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

  async function handleMarketBuy(item) {
    var nego = detailState.myNegoRequest;
    var buyPrice = (nego && nego.status === 'ACCEPTED') ? Number(nego.requested_price) : Number(item.price);
    if (!confirm(formatPrice(buyPrice) + '원 + 안전결제 수수료 1,000원 = 총 ' + formatPrice(buyPrice + 1000) + '원을 결제하시겠습니까?')) return;
    var btn = document.getElementById('marketDetailBuyBtn');
    if (btn) { btn.disabled = true; btn.textContent = '가상계좌 발급 중...'; }
    try {
      var s = await loadMarketService();
      var result = await s.requestMarketPurchase(item.id);
      var va = result.virtualAccount || {};
      alert(
        '안전결제 가상계좌가 발급되었습니다.\n\n' +
        '은행: ' + (va.bankName || va.bankCode || '') + '\n' +
        '계좌번호: ' + (va.accountNumber || '') + '\n' +
        '입금액: ' + formatPrice(result.amount) + '원\n' +
        '입금기한: ' + (va.dueDate ? new Date(va.dueDate).toLocaleString('ko-KR') : '') + '\n\n' +
        '입금이 확인되면 판매자에게 알림이 가고, 물품 수령 후 [구매 확정]을 눌러주세요.'
      );
      openMarketItemDetail(item.id);
    } catch (err) {
      toast('구매 요청 실패: ' + (err && err.message ? err.message : err));
      if (btn) { btn.disabled = false; btn.textContent = '안전결제로 구매하기'; }
    }
  }

  async function handleMarketConfirmPurchase(itemId, orderId) {
    if (!confirm('물품을 정상적으로 수령하셨습니까? 확정하면 판매자에게 대금이 정산됩니다.')) return;
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

  async function handleMarketCancelOrder(itemId, orderId) {
    if (!confirm('구매를 취소할까요? 아직 입금 전이라 별도 환불 절차 없이 바로 취소됩니다.')) return;
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

  async function handleMarketRefundSubmit(itemId, orderId, submitBtn) {
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
    if (!confirm('환불을 신청할까요? 상품가만 환불되며(수수료 1,000원 제외), 신청 후 취소할 수 없습니다.')) return;
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

  async function handleMarketDelete(itemId) {
    if (!confirm('이 상품을 삭제할까요?')) return;
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

  async function handleMarketNegoDecide(itemId, requestId, accept) {
    if (!confirm(accept ? '이 가격 조정 요청을 수락할까요?' : '이 가격 조정 요청을 거절할까요?')) return;
    try {
      var s = await loadMarketService();
      await s.decideMarketNegoRequest(requestId, accept);
      toast(accept ? '가격 조정을 수락했습니다.' : '가격 조정을 거절했습니다.');
      openMarketItemDetail(itemId);
    } catch (err) {
      toast('처리 실패: ' + (err && err.message ? err.message : err));
    }
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

  function loadMyPageContent() {
    var grid = document.getElementById('marketMyPageGrid');
    if (grid) grid.innerHTML = '<div class="market-loading">불러오는 중...</div>';
    loadMarketService()
      .then(function (s) {
        if (myPageState.tab === 'favorites') {
          return s.getMyFavoriteItemIds().then(function (ids) {
            return Promise.all(Array.from(ids).map(function (id) { return s.getMarketItem(id); }));
          });
        }
        return s.getMyMarketItems();
      })
      .then(function (rows) {
        rows = (rows || []).filter(Boolean);
        if (grid) {
          grid.innerHTML = rows.length
            ? rows.map(marketItemCardHtml).join('')
            : '<div class="market-empty">' + (myPageState.tab === 'favorites' ? '찜한 상품이 없습니다.' : '등록한 상품이 없습니다.') + '</div>';
          wireMarketGridEvents(grid);
        }
      })
      .catch(function (err) {
        if (grid) grid.innerHTML = '<div class="market-empty">불러오지 못했습니다: ' + escapeHtml(err.message || String(err)) + '</div>';
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
