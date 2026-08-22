/**
 * 중고랜드(Market Land) 화면 컨트롤러 — 홈/목록·등록·상세·마이페이지 4개 화면을 vanilla JS로 렌더링한다.
 * (openRiding처럼 React가 아니라 competitionScreen.js/userManager.js와 동일한 템플릿 문자열 방식 —
 * 이 화면군은 별도 React 마운트가 필요 없을 만큼 단순해 무거운 React 트리 없이도 충분하다.)
 */
(function () {
  'use strict';

  var MARKET_SERVICE_URL = './marketService.js?v=20260823market2';
  var svc = null;

  function loadMarketService() {
    if (svc) return Promise.resolve(svc);
    return import(MARKET_SERVICE_URL).then(function (mod) {
      svc = mod;
      return svc;
    });
  }

  var SUB_CATEGORIES = {
    CYCLE: ['완성차/프레임', '휠셋', '구동계', '부품/용품', '의류'],
    RUN: ['러닝화', '운동복', '용품/부품'],
  };
  var PAGE_SIZE = 60;
  var MAX_IMAGES = 3;
  var MAX_DESC_LEN = 1000;

  var homeState = {
    category: 'CYCLE',
    subCategory: '',
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

  // ───────────────────────── 홈/목록 화면 ─────────────────────────

  function renderSubCategoryTabs() {
    var wrap = document.getElementById('marketSubCategoryTabs');
    if (!wrap) return;
    var subs = SUB_CATEGORIES[homeState.category] || [];
    var html = '<button type="button" class="market-subtab' + (homeState.subCategory === '' ? ' active' : '') +
      '" data-sub="">전체</button>';
    subs.forEach(function (s) {
      html += '<button type="button" class="market-subtab' + (homeState.subCategory === s ? ' active' : '') +
        '" data-sub="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>';
    });
    wrap.innerHTML = html;
    Array.prototype.forEach.call(wrap.querySelectorAll('.market-subtab'), function (btn) {
      btn.onclick = function () {
        homeState.subCategory = btn.getAttribute('data-sub') || '';
        renderSubCategoryTabs();
        reloadMarketHomeList();
      };
    });
  }

  function marketItemCardHtml(item) {
    var img = (item.images && item.images[0]) || 'assets/img/profile-placeholder.svg';
    var isFav = homeState.favoriteIds.has(item.id);
    var isMine = homeState.myUserId && item.user_id === homeState.myUserId;
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
        (isMine
          ? '<button type="button" class="market-card__bump" data-bump="' + item.id + '">끌어올리기</button>'
          : '') +
      '</div>'
    );
  }

  function renderMarketGrid(append) {
    var grid = document.getElementById('marketItemGrid');
    if (!grid) return;
    var html = homeState.items.map(marketItemCardHtml).join('');
    if (!append) {
      grid.innerHTML = html || '<div class="market-empty">등록된 상품이 없습니다.</div>';
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
        if (e.target.closest('[data-fav-toggle]') || e.target.closest('[data-bump]')) return;
        openMarketItemDetail(card.getAttribute('data-item-id'));
      });
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-fav-toggle]'), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        handleFavoriteToggle(btn.getAttribute('data-fav-toggle'), btn);
      };
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-bump]'), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        handleBump(btn.getAttribute('data-bump'), btn);
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
    if (grid) grid.innerHTML = '<div class="market-loading">불러오는 중...</div>';
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
    if (cycleTab) cycleTab.classList.toggle('active', cat === 'CYCLE');
    if (runTab) runTab.classList.toggle('active', cat === 'RUN');
    renderSubCategoryTabs();
    reloadMarketHomeList();
  }

  window.marketScreenInit = function () {
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
  };

  window.navigateToMarketLand = function () {
    if (typeof window.showScreen === 'function') window.showScreen('marketHomeScreen');
  };

  // ───────────────────────── 마이페이지 진입 ─────────────────────────

  window.navigateToMarketForm = function () {
    resetMarketForm();
    if (typeof window.showScreen === 'function') window.showScreen('marketItemFormScreen');
  };

  // ───────────────────────── 상품 등록/수정 화면 ─────────────────────────

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
    Array.prototype.forEach.call(document.querySelectorAll('.market-form-deal-checkbox'), function (cb) {
      cb.checked = false;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.market-form-condition'), function (r) {
      r.checked = r.value === '중고 상품';
    });
    renderMarketFormCategoryOptions('CYCLE');
    renderMarketImageSlots();
    updateMarketDescCounter();
  }

  function renderMarketFormCategoryOptions(cat) {
    var catSelect = document.getElementById('marketFormCategory');
    var subSelect = document.getElementById('marketFormSubCategory');
    if (catSelect) catSelect.value = cat;
    if (!subSelect) return;
    var subs = SUB_CATEGORIES[cat] || [];
    subSelect.innerHTML = subs.map(function (s) {
      return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
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

    var title = (titleEl.value || '').trim();
    var priceRaw = (priceEl.value || '').replace(/[^0-9]/g, '');
    var price = Number(priceRaw);
    var description = (descEl.value || '').trim();
    var dealMethods = collectDealMethods();
    var directLocation = (locEl.value || '').trim();

    if (!title) { toast('상품명을 입력해 주세요.'); return; }
    if (!priceRaw || price < 0) { toast('판매가를 입력해 주세요.'); return; }
    if (!dealMethods.length) { toast('거래 방법을 하나 이상 선택해 주세요.'); return; }
    if (dealMethods.indexOf('직거래') !== -1 && !directLocation) {
      toast('직거래 지역을 입력해 주세요.');
      return;
    }
    if (formState.files.every(function (f) { return !f; })) {
      toast('사진을 최소 1장 첨부해 주세요.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '등록 중...';
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
        direct_deal_location: dealMethods.indexOf('직거래') !== -1 ? directLocation : null,
        description: description,
        images: images,
        image_hashes: hashes,
      };

      if (formState.editingId) {
        await s.updateMarketItem(formState.editingId, payload);
      } else {
        await s.createMarketItem(payload);
      }
      toast('등록되었습니다.');
      window.navigateToMarketLand();
    } catch (err) {
      if (err && err.code === 'DUPLICATE_IMAGE') {
        toast(err.message);
      } else {
        toast('등록 실패: ' + (err && err.message ? err.message : err));
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '등록 하기';
    }
  }

  window.marketFormScreenInit = function () {
    resetMarketForm();
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

  var detailState = { item: null, sliderIndex: 0 };

  function openMarketItemDetail(itemId) {
    if (typeof window.showScreen === 'function') window.showScreen('marketItemDetailScreen');
    var body = document.getElementById('marketDetailBody');
    if (body) body.innerHTML = '<div class="market-loading">불러오는 중...</div>';
    loadMarketService()
      .then(function (s) {
        return Promise.all([s.getMarketItem(itemId), s.getMySupabaseUserId(), s.getMarketOrderForItem(itemId)]);
      })
      .then(function (res) {
        detailState.item = res[0];
        detailState.sliderIndex = 0;
        renderMarketDetail(res[1], res[2]);
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
          '<button type="button" class="market-btn market-btn--danger" id="marketDetailDeleteBtn">삭제</button>' +
        '</div>';
    } else if (myOrder && myOrder.escrow_status === 'PAID') {
      actionHtml =
        '<div class="market-detail-order-notice">입금이 확인되었습니다. 물품을 수령하셨으면 아래 버튼을 눌러주세요.</div>' +
        '<button type="button" class="market-btn market-btn--primary" id="marketDetailConfirmBtn">구매 확정하기</button>';
    } else if (myOrder && myOrder.escrow_status === 'PENDING') {
      actionHtml = '<button type="button" class="market-btn market-btn--disabled" disabled>입금 확인 대기 중입니다</button>';
    } else if (myOrder && myOrder.escrow_status === 'CONFIRMED') {
      actionHtml = '<button type="button" class="market-btn market-btn--disabled" disabled>구매 확정 완료된 거래입니다</button>';
    } else if (item.status === 'SOLD') {
      actionHtml = '<button type="button" class="market-btn market-btn--disabled" disabled>판매 완료된 상품입니다</button>';
    } else if (item.status === 'RESERVED') {
      actionHtml = '<button type="button" class="market-btn market-btn--disabled" disabled>거래 진행 중인 상품입니다</button>';
    } else {
      actionHtml = '<button type="button" class="market-btn market-btn--primary" id="marketDetailBuyBtn">안전결제로 구매하기</button>';
    }

    body.innerHTML =
      sliderHtml +
      '<div class="market-detail-info">' +
        statusBadgeHtml(item.status) +
        '<div class="market-detail-title">' + escapeHtml(item.title) + '</div>' +
        '<div class="market-detail-price">' + formatPrice(item.price) + '원</div>' +
        '<div class="market-detail-meta">' +
          '<span>' + escapeHtml(item.condition) + '</span>' +
          '<span>' + escapeHtml(dealMethodText) + '</span>' +
        '</div>' +
        '<div class="market-detail-desc">' + escapeHtml(item.description || '').replace(/\n/g, '<br/>') + '</div>' +
      '</div>' +
      '<div class="market-detail-action-bar">' + actionHtml + '</div>';

    wireMarketDetailSlider();
    var buyBtn = document.getElementById('marketDetailBuyBtn');
    if (buyBtn) buyBtn.onclick = function () { handleMarketBuy(item); };
    var confirmBtn = document.getElementById('marketDetailConfirmBtn');
    if (confirmBtn) confirmBtn.onclick = function () { handleMarketConfirmPurchase(item.id, myOrder.id); };
    var bumpBtn = document.getElementById('marketDetailBumpBtn');
    if (bumpBtn) bumpBtn.onclick = function () { handleBump(item.id, bumpBtn); };
    var deleteBtn = document.getElementById('marketDetailDeleteBtn');
    if (deleteBtn) deleteBtn.onclick = function () { handleMarketDelete(item.id); };
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
    if (!confirm(formatPrice(item.price) + '원 + 안전결제 수수료 1,000원 = 총 ' + formatPrice(item.price + 1000) + '원을 결제하시겠습니까?')) return;
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

  window.marketItemDetailScreenInit = function () {};

  // ───────────────────────── 마이페이지 화면 ─────────────────────────

  var myPageState = { tab: 'selling' };

  function renderMyPageTabs() {
    var wrap = document.getElementById('marketMyPageTabs');
    if (!wrap) return;
    var tabs = [
      { key: 'selling', label: '내 상품' },
      { key: 'favorites', label: '찜한 상품' },
    ];
    wrap.innerHTML = tabs.map(function (t) {
      return '<button type="button" class="market-subtab' + (myPageState.tab === t.key ? ' active' : '') +
        '" data-tab="' + t.key + '">' + t.label + '</button>';
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
