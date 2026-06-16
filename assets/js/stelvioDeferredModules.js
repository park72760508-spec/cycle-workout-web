/**
 * 인증·스플래시 전환 이후 로드 — journal / openRiding Babel 등 app.js 앞 동기 파싱을 줄임
 */
(function () {
  'use strict';

  var loadPromise = null;

  function waitForGlobal(name, maxMs) {
    maxMs = maxMs || 20000;
    return new Promise(function (resolve) {
      if (window[name]) {
        resolve(true);
        return;
      }
      var t0 = Date.now();
      var timer = setInterval(function () {
        if (window[name]) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - t0 >= maxMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, 40);
    });
  }

  function appendScript(src, type) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      if (type) s.type = type;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error('script load failed: ' + src));
      };
      document.body.appendChild(s);
    });
  }

  function registerJournalInit() {
    if (typeof window.initTrainingJournalReact === 'function') return;
    window.initTrainingJournalReact = function initTrainingJournalReact() {
      var root = document.getElementById('journal-react-root');
      var legacyCard = document.getElementById('journal-legacy-calendar-card');
      if (!root || typeof ReactDOM === 'undefined' || typeof window.TrainingJournalScreen !== 'function') {
        console.warn('[Journal React] 마운트 불가 - root 또는 React/TrainingJournalScreen 없음');
        return;
      }
      if (legacyCard) legacyCard.style.display = 'none';
      root.style.display = 'block';
      var monthlyRoot = document.getElementById('monthly-analysis-dashboard-root');
      if (monthlyRoot) monthlyRoot.style.display = 'none';
      if (!root._journalRoot) {
        root._journalRoot = ReactDOM.createRoot ? ReactDOM.createRoot(root) : null;
        if (root._journalRoot) {
          root._journalRoot.render(React.createElement(window.TrainingJournalScreen));
        } else if (typeof ReactDOM.render === 'function') {
          ReactDOM.render(React.createElement(window.TrainingJournalScreen), root);
        }
      } else if (root._journalRoot.render) {
        root._journalRoot.render(React.createElement(window.TrainingJournalScreen));
      }
    };
  }

  function registerOpenRidingInit() {
    if (typeof window.initOpenRidingRoomReact === 'function') return;

    var openRidingReactRoot = null;

    window.destroyOpenRidingRoomReact = function () {
      try {
        if (openRidingReactRoot && typeof openRidingReactRoot.unmount === 'function') {
          openRidingReactRoot.unmount();
        } else if (typeof ReactDOM !== 'undefined' && typeof ReactDOM.unmountComponentAtNode === 'function') {
          var rootElLegacy = document.getElementById('open-riding-react-root');
          if (rootElLegacy) ReactDOM.unmountComponentAtNode(rootElLegacy);
        }
      } catch (eUnmount) {
        console.warn('[OpenRiding] unmount:', eUnmount);
      }
      openRidingReactRoot = null;
      var rootEl = document.getElementById('open-riding-react-root');
      if (rootEl) rootEl.innerHTML = '';
    };

    if (typeof window.getOpenRidingUserId !== 'function') {
      window.getOpenRidingUserId = function () {
        try {
          if (window.authV9 && window.authV9.currentUser && window.authV9.currentUser.uid) {
            return String(window.authV9.currentUser.uid);
          }
          if (window.auth && window.auth.currentUser && window.auth.currentUser.uid) {
            return String(window.auth.currentUser.uid);
          }
          var u = JSON.parse(localStorage.getItem('authUser') || 'null');
          if (u && u.id != null) return String(u.id);
        } catch (err) {}
        return '';
      };
    }

    async function waitOpenRidingAuthAndFirestore(maxMs) {
      maxMs = maxMs || 12000;
      var t0 = Date.now();
      while (!window.firestoreV9 && Date.now() - t0 < Math.min(maxMs, 4000)) {
        await new Promise(function (r) {
          setTimeout(r, 80);
        });
      }
      try {
        if (window.authV9 && typeof window.authV9.authStateReady === 'function') {
          await Promise.race([
            window.authV9.authStateReady(),
            new Promise(function (r) {
              setTimeout(r, maxMs);
            }),
          ]);
          return;
        }
      } catch (eA) {}
      while (Date.now() - t0 < maxMs) {
        if (window.authV9 && window.authV9.currentUser) return;
        if (window.auth && window.auth.currentUser) return;
        try {
          var ju = JSON.parse(localStorage.getItem('authUser') || 'null');
          if (ju && ju.id != null) return;
        } catch (eB) {}
        await new Promise(function (r) {
          setTimeout(r, 120);
        });
      }
    }

    function getOpenRidingUserLabel() {
      try {
        var c = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
        if (c && c.name) return String(c.name);
      } catch (err2) {}
      return '라이더';
    }

    window.initOpenRidingRoomReact = async function () {
      var rootEl = document.getElementById('open-riding-react-root');
      if (!rootEl || typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
        console.warn('[OpenRiding] React 또는 root 없음');
        return;
      }
      try {
        await import('./openRiding/openRidingBoot.js?v=korea-region-groups-ui-20260403');
      } catch (bootErr) {
        console.error('[OpenRiding] openRidingBoot 로드 실패:', bootErr);
        rootEl.innerHTML = '<p class="text-sm text-red-700 px-2">오픈 라이딩 모듈을 불러오지 못했습니다.</p>';
        return;
      }
      if (typeof window.OpenRidingRoomApp !== 'function') {
        console.warn('[OpenRiding] OpenRidingRoomApp 없음');
        return;
      }
      if (typeof window.useOpenRiding !== 'function') {
        console.warn('[OpenRiding] useOpenRiding 없음 — boot 확인');
        rootEl.innerHTML = '<p class="text-sm text-amber-800 px-2">오픈 라이딩 훅 로드 실패. 새로고침해 주세요.</p>';
        return;
      }
      await waitOpenRidingAuthAndFirestore(12000);
      var firestore = window.firestoreV9 || null;
      var storage = window.firebaseStorageV9 || null;
      var userId = window.getOpenRidingUserId();
      var userLabel = getOpenRidingUserLabel();
      var initialView = '';
      try {
        initialView = String(window.__openRidingInitialView || '').trim();
        window.__openRidingInitialView = '';
      } catch (eInitView) {
        initialView = '';
      }
      var el = React.createElement(window.OpenRidingRoomApp, {
        firestore: firestore,
        storage: storage,
        userId: userId,
        userLabel: userLabel,
        initialView: initialView,
      });
      if (!openRidingReactRoot) {
        openRidingReactRoot = ReactDOM.createRoot ? ReactDOM.createRoot(rootEl) : null;
      }
      if (openRidingReactRoot && openRidingReactRoot.render) {
        openRidingReactRoot.render(el);
      } else if (typeof ReactDOM.render === 'function') {
        ReactDOM.render(el, rootEl);
      }
    };

    window.navigateToClubHouseFromBasecamp = function () {
      window.__openRidingInitialView = 'groups';
      if (typeof showScreen === 'function') showScreen('openRidingRoomScreen');
    };

    window.startBasecampClubHouseBadgeSubscription = function () {
      if (typeof window.refreshBasecampBadge === 'function') window.refreshBasecampBadge();
    };
  }

  function preloadFirebaseStorageMod() {
    if (window._firebaseStorageModReady) return;
    window._firebaseStorageModReady = import('https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js')
      .then(function (m) {
        window.firebaseStorageModV9API = m;
        return m;
      })
      .catch(function (e) {
        console.warn('[오픈라이딩] firebase-storage 모듈 선로드 실패:', e && e.message ? e.message : e);
        window.firebaseStorageModV9API = null;
        throw e;
      });
  }

  async function loadRunJournalBundle() {
    await waitForGlobal('Babel');
    if (typeof window.L === 'undefined') {
      await appendScript('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js');
    }
    await appendScript('assets/js/journal/stravaPolylineUtils.js');
    await appendScript('assets/js/journal/JournalCourseMapPreview.jsx', 'text/babel');
    await appendScript('assets/js/runJournal/runJournalPrUtils.js');
    await appendScript('assets/js/runJournal/useRunJournalData.js');
    await appendScript('assets/js/runJournal/RunJournalCalendarWidget.jsx', 'text/babel');
    await appendScript('assets/js/runJournal/RunJournalDailySummary.jsx', 'text/babel');
    await appendScript('assets/js/runJournal/RunJournalDetailBottomSheet.jsx', 'text/babel');
    await appendScript('assets/js/runJournal/RunTrainingJournalScreen.jsx', 'text/babel');
    registerRunJournalInit();
  }

  function registerRunJournalInit() {
    if (typeof window.initRunTrainingJournalReact === 'function') return;
    window.initRunTrainingJournalReact = function initRunTrainingJournalReact() {
      var root = document.getElementById('run-journal-react-root');
      if (!root || typeof ReactDOM === 'undefined' || typeof window.RunTrainingJournalScreen !== 'function') {
        console.warn('[RunJournal React] 마운트 불가');
        return;
      }
      root.style.display = 'block';
      if (!root._runJournalRoot) {
        root._runJournalRoot = ReactDOM.createRoot ? ReactDOM.createRoot(root) : null;
        if (root._runJournalRoot) {
          root._runJournalRoot.render(React.createElement(window.RunTrainingJournalScreen));
        } else if (typeof ReactDOM.render === 'function') {
          ReactDOM.render(React.createElement(window.RunTrainingJournalScreen), root);
        }
      } else if (root._runJournalRoot.render) {
        root._runJournalRoot.render(React.createElement(window.RunTrainingJournalScreen));
      }
    };
  }

  async function loadJournalBundle() {
    await waitForGlobal('Babel');
    await appendScript('assets/js/journal/stravaPolylineUtils.js');
    await appendScript('assets/js/journal/enrichLogHrPeaks.js');
    await appendScript('assets/js/journal/journalTransparentShare.js');
    await appendScript('assets/js/journal/JournalTransparentShareComposer.jsx', 'text/babel');
    await appendScript('assets/js/journal/useJournalData.js');
    await appendScript('assets/js/journal/JournalCalendarWidget.jsx', 'text/babel');
    await appendScript('assets/js/journal/RidingCourseSvgBackground.jsx', 'text/babel');
    await appendScript('assets/js/journal/JournalCourseMapPreview.jsx', 'text/babel');
    await appendScript('assets/js/journal/journalWorkoutGraphUtils.js');
    await appendScript('assets/js/journal/JournalWorkoutGraphPreview.jsx', 'text/babel');
    await appendScript('assets/js/journal/JournalDailySummary.jsx', 'text/babel');
    await appendScript('assets/js/journal/JournalDetailBottomSheet.jsx', 'text/babel');
    await appendScript('assets/js/journal/JournalMonthlyDashboard.jsx', 'text/babel');
    await appendScript('assets/js/journal/TrainingJournalScreen.jsx', 'text/babel');
    registerJournalInit();
  }

  async function loadOpenRidingBundle() {
    preloadFirebaseStorageMod();
    await appendScript('assets/js/openRiding/openRidingGpx.js');
    if (typeof window.L === 'undefined') {
      await appendScript('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js');
    }
    await appendScript(
      'assets/js/openRiding/OpenRidingScreens.jsx?v=open-riding-detail-nav-20260519',
      'text/babel'
    );
    registerOpenRidingInit();
  }

  function stelvioLoadDeferredModules() {
    if (window.__stelvioDeferredModulesLoaded) return Promise.resolve();
    if (loadPromise) return loadPromise;

    loadPromise = (async function () {
      try {
        await Promise.all([loadJournalBundle(), loadOpenRidingBundle(), loadRunJournalBundle()]);
        window.__stelvioDeferredModulesLoaded = true;
      } catch (e) {
        loadPromise = null;
        console.warn('[stelvioDeferredModules] 로드 실패:', e);
      }
    })();

    return loadPromise;
  }

  window.stelvioLoadDeferredModules = stelvioLoadDeferredModules;
})();
