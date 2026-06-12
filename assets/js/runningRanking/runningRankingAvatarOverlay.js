/**
 * RUN 랭킹보드 — 프로필 아바타 확대 오버레이 (CYCLE 랭킹보드와 동일 디자인·형식)
 */
(function () {
  'use strict';

  var BACKDROP_ID = 'runningRankAvatarZoomBackdrop';
  var IMG_ID = 'runningRankAvatarZoomImg';
  var PROFILE_ID = 'runningRankAvatarZoomProfile';
  var SPINNER_ID = 'runningRankAvatarZoomRankSpinner';
  var LINE_IDS = ['runningRankAvatarZoomLine1', 'runningRankAvatarZoomLine2', 'runningRankAvatarZoomLine3'];

  function el(id) {
    return document.getElementById(id);
  }

  function defaultProfileImg() {
    if (typeof window.stelvioRankingDefaultProfileImg === 'function') {
      return window.stelvioRankingDefaultProfileImg();
    }
    return 'assets/img/profile-placeholder.svg';
  }

  function resolveUiState() {
    var st = window.runningRankingUiState || {};
    return {
      gender: st.gender || 'all',
      ageCategory: st.activeCategory || 'Supremo'
    };
  }

  function setSpinner(on) {
    var sp = el(SPINNER_ID);
    if (!sp) return;
    if (on) {
      sp.classList.remove('hidden');
      sp.setAttribute('aria-busy', 'true');
    } else {
      sp.classList.add('hidden');
      sp.setAttribute('aria-busy', 'false');
    }
  }

  function getRows() {
    if (window.runningRankingApi && typeof window.runningRankingApi.getCachedRows === 'function') {
      var cached = window.runningRankingApi.getCachedRows();
      if (cached && cached.length) return cached;
    }
    return [];
  }

  function loadProfilePanels(userId, displayName, ageCategory, gen) {
    var backdrop = el(BACKDROP_ID);
    var l1 = el(LINE_IDS[0]);
    var l2 = el(LINE_IDS[1]);
    var l3 = el(LINE_IDS[2]);
    if (!backdrop || !l1 || !l2 || !l3) return;

    function isStale() {
      return !backdrop.classList.contains('hidden')
        && Number(backdrop.getAttribute('data-running-rank-zoom-gen')) === Number(gen);
    }

    setSpinner(true);

    function finish(lines) {
      if (!isStale()) return;
      if (lines) {
        l1.textContent = lines.line1 || '';
        l2.textContent = lines.line2 || '';
        l3.textContent = lines.line3 || '';
      } else {
        l2.textContent = '순위 정보를 불러오지 못했습니다. 다시 시도해 주세요.';
        l3.textContent = '';
      }
      setSpinner(false);
    }

    var rows = getRows();
    var ui = resolveUiState();
    var dataMod = window.runningRankingData;

    if (!rows.length) {
      var fetchFn = window.runningRankingApi && window.runningRankingApi.fetchLeaderboard;
      if (typeof fetchFn !== 'function') {
        finish(null);
        return;
      }
      fetchFn({}).then(function (res) {
        if (!isStale()) return;
        rows = (res && res.rows) || getRows();
        if (!dataMod || typeof dataMod.buildAvatarOverlayProfile !== 'function') {
          finish(null);
          return;
        }
        finish(dataMod.buildAvatarOverlayProfile(userId, rows, {
          gender: ui.gender,
          ageCategory: ageCategory || ui.ageCategory,
          displayName: displayName
        }));
      }).catch(function () {
        finish(null);
      });
      return;
    }

    if (!dataMod || typeof dataMod.buildAvatarOverlayProfile !== 'function') {
      finish(null);
      return;
    }

    finish(dataMod.buildAvatarOverlayProfile(userId, rows, {
      gender: ui.gender,
      ageCategory: ageCategory || ui.ageCategory,
      displayName: displayName
    }));
  }

  function openRunningRankAvatarZoom(imageSrc, meta) {
    var backdrop = el(BACKDROP_ID);
    var img = el(IMG_ID);
    var profWrap = el(PROFILE_ID);
    var l1 = el(LINE_IDS[0]);
    var l2 = el(LINE_IDS[1]);
    var l3 = el(LINE_IDS[2]);
    if (!backdrop || !img || !imageSrc) return;

    meta = meta || {};

    backdrop._runningRankAvatarZoomSeq = Number(backdrop._runningRankAvatarZoomSeq || 0) + 1;
    var seq = backdrop._runningRankAvatarZoomSeq;
    backdrop.setAttribute('data-running-rank-zoom-gen', String(seq));
    backdrop.setAttribute('data-running-rank-overlay-name', meta.overlayName != null ? String(meta.overlayName) : '');

    img.onerror = function () {
      img.onerror = null;
      var def = defaultProfileImg();
      if (img.src !== def) img.src = def;
    };
    img.src = imageSrc;

    var uidTrim = meta.userId != null ? String(meta.userId).trim() : '';
    if (profWrap && l1 && l2 && l3) {
      if (uidTrim) {
        profWrap.classList.remove('hidden');
        setSpinner(true);
        l1.textContent = meta.overlayName
          ? String(meta.overlayName) + ' · 불러오는 중…'
          : '불러오는 중…';
        l2.textContent = '';
        l3.textContent = '';
        var ageTrim = meta.ageCategory != null ? String(meta.ageCategory).trim() : '';
        loadProfilePanels(uidTrim, meta.overlayName, ageTrim, seq);
      } else {
        profWrap.classList.add('hidden');
        setSpinner(false);
        l1.textContent = '';
        l2.textContent = '';
        l3.textContent = '';
      }
    }

    backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false');

    if (backdrop._runningRankAvatarZoomEscKey) {
      document.removeEventListener('keydown', backdrop._runningRankAvatarZoomEscKey);
      backdrop._runningRankAvatarZoomEscKey = null;
    }
    function onEsc(evK) {
      if (evK.key === 'Escape') closeRunningRankAvatarZoom();
    }
    backdrop._runningRankAvatarZoomEscKey = onEsc;
    document.addEventListener('keydown', onEsc);
  }

  function closeRunningRankAvatarZoom() {
    var backdrop = el(BACKDROP_ID);
    if (!backdrop) return;
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
    if (backdrop._runningRankAvatarZoomEscKey) {
      document.removeEventListener('keydown', backdrop._runningRankAvatarZoomEscKey);
      backdrop._runningRankAvatarZoomEscKey = null;
    }
    var img = el(IMG_ID);
    if (img) img.removeAttribute('src');
    var pw = el(PROFILE_ID);
    var i;
    for (i = 0; i < LINE_IDS.length; i++) {
      var ln = el(LINE_IDS[i]);
      if (ln) ln.textContent = '';
    }
    if (pw) pw.classList.add('hidden');
    setSpinner(false);
  }

  function runningRankingAvatarZoomHandler(ev) {
    var t = ev.target;
    var btn = typeof t.closest === 'function' ? t.closest('.stelvio-rank-avatar-btn') : null;
    if (!btn) return;
    var runRoot = document.getElementById('running-ranking-react-root');
    if (!runRoot || !runRoot.contains(btn)) return;

    ev.preventDefault();
    ev.stopPropagation();

    var srcAttr = btn.getAttribute('data-stelvio-rank-zoom-src');
    if (!srcAttr || !String(srcAttr).trim()) return;

    openRunningRankAvatarZoom(String(srcAttr).trim(), {
      userId: btn.getAttribute('data-stelvio-rank-user-id'),
      overlayName: btn.getAttribute('data-stelvio-rank-overlay-name'),
      ageCategory: btn.getAttribute('data-stelvio-rank-age-cat')
    });
  }

  function bindBackdropListeners() {
    var backdrop = el(BACKDROP_ID);
    if (!backdrop || backdrop._runningRankAvatarZoomBound) return;
    backdrop._runningRankAvatarZoomBound = true;

    backdrop.addEventListener('click', function (evBd) {
      if (!evBd.target.closest('.stelvio-rank-avatar-zoom-card')) {
        closeRunningRankAvatarZoom();
      }
    });

    var zoomCard = backdrop.querySelector('.stelvio-rank-avatar-zoom-card');
    if (zoomCard) {
      zoomCard.addEventListener('click', function (evIn) {
        evIn.stopPropagation();
      });
    }
  }

  bindBackdropListeners();

  window.runningRankingAvatarZoomHandler = runningRankingAvatarZoomHandler;
  window.openRunningRankAvatarZoom = openRunningRankAvatarZoom;
  window.closeRunningRankAvatarZoom = closeRunningRankAvatarZoom;
})();
