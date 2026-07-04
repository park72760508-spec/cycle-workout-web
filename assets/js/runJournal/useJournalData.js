/**
 * useJournalData - Custom Hook for Training Journal Screen
 * 훈련 로그, 선택된 날짜, 월간 데이터를 통합 관리합니다.
 * @see docs/라이딩_일지_리팩터링_계획.md
 */
(function() {
  'use strict';

  if (typeof window === 'undefined') return;
  var React = window.React;
  if (!React || !React.useState || !React.useEffect || !React.useCallback || !React.useMemo) {
    console.warn('[useJournalData] React hooks not available');
    return;
  }

  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;
  var useMemo = React.useMemo;

  function useJournalData() {
    var _useState = useState(null);
    var selectedDate = _useState[0];
    var setSelectedDate = _useState[1];

    var _useState2 = useState({});
    var trainingLogs = _useState2[0];
    var setTrainingLogs = _useState2[1];

    var _useState3 = useState(new Date().getFullYear());
    var currentYear = _useState3[0];
    var setCurrentYear = _useState3[1];

    var _useState4 = useState(new Date().getMonth());
    var currentMonth = _useState4[0];
    var setCurrentMonth = _useState4[1];

    var _useState5 = useState(false);
    var loading = _useState5[0];
    var setLoading = _useState5[1];

    var _useState6 = useState(null);
    var error = _useState6[0];
    var setError = _useState6[1];

    var _useState7 = useState({});
    var yearlyPeaksByYear = _useState7[0];
    var setYearlyPeaksByYear = _useState7[1];

    var _useState8 = useState(null);
    var userProfile = _useState8[0];
    var setUserProfile = _useState8[1];

    var _useState9 = useState(false);
    var detailSheetOpen = _useState9[0];
    var setDetailSheetOpen = _useState9[1];

    var _useState10 = useState(null);
    var dailyRouteDoc = _useState10[0];
    var setDailyRouteDoc = _useState10[1];

    var _useState11 = useState(null);
    var dailyRouteDocDate = _useState11[0];
    var setDailyRouteDocDate = _useState11[1];

    // 사용자 ID 획득
    function getCurrentUserId() {
      var currentUser = window.currentUser || (function() {
        try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; }
      })();
      var authV9 = typeof window.getCurrentUserForTrainingRooms === 'function' ? window.getCurrentUserForTrainingRooms() : null;
      if (currentUser && (currentUser.id != null || currentUser.uid != null)) {
        return currentUser.id != null ? currentUser.id : currentUser.uid;
      }
      if (authV9 && (authV9.uid != null || authV9.id != null)) {
        return authV9.uid != null ? authV9.uid : authV9.id;
      }
      return null;
    }

    // 프로필 로드 (FTP, weight 등)
    useEffect(function loadProfile() {
      var cu = window.currentUser || (function() {
        try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; }
      })();
      if (cu) {
        var uid = cu.id != null ? cu.id : (cu.uid != null ? cu.uid : null);
        setUserProfile({
          id: uid,
          uid: uid,
          ftp: Number(cu.ftp || 200),
          weight: Number(cu.weight || cu.weightKg || 0),
          max_hr: Number(cu.max_hr || cu.maxHr || 190)
        });
      }
    }, []);

    // PR 표시용 yearly_peaks 조회
    var runYearlyPeaksFetch = useCallback(function() {
      var userId = getCurrentUserId();
      if (!userId || typeof window.fetchYearlyPeaksForYear !== 'function') return;
      var yearsToFetch = [currentYear - 1, currentYear, currentYear + 1];
      Promise.all(yearsToFetch.map(function(y) { return window.fetchYearlyPeaksForYear(userId, y); }))
        .then(function(peaks) {
          var next = {};
          yearsToFetch.forEach(function(y, i) {
            if (peaks[i]) next[y] = peaks[i];
          });
          setYearlyPeaksByYear(function(prev) {
            var merged = Object.assign({}, prev);
            Object.keys(next).forEach(function(k) { merged[k] = next[k]; });
            return merged;
          });
        })
        .catch(function(e) { console.warn('[useJournalData] yearly_peaks 조회 실패:', e); });
    }, [currentYear]);

    // 연도 변경 시(달 이동으로 연도 바뀔 때) 자동 재조회
    useEffect(function loadYearlyPeaks() {
      runYearlyPeaksFetch();
    }, [runYearlyPeaksFetch]);

    // 훈련 로그 로드
    var runTrainingLogsFetch = useCallback(function(forceRefresh) {
      var userId = getCurrentUserId();
      if (!userId) {
        setError('로그인이 필요합니다.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      var fetchFn = typeof window.fetchTrainingLogsForCalendarJournal === 'function'
        ? window.fetchTrainingLogsForCalendarJournal
        : null;

      if (!fetchFn) {
        console.warn('[useJournalData] fetchTrainingLogsForCalendarJournal 없음 - initMiniCalendarJournal 후 사용');
        setLoading(false);
        setError('훈련 로드 모듈이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }

      var fetchOpts = forceRefresh ? { force: true } : undefined;
      fetchFn(userId, fetchOpts)
        .then(function(logsByDate) {
          setTrainingLogs(logsByDate || {});
          setError(null);
          if (typeof window.updateJournalSubtitle === 'function') {
            var count = Object.keys(logsByDate || {}).length;
            window.updateJournalSubtitle('(' + count + '일 훈련 기록)');
          }
        })
        .catch(function(err) {
          console.error('[useJournalData] 로드 실패:', err);
          setError(err && err.message ? err.message : '훈련 로그를 불러오지 못했습니다.');
          setTrainingLogs({});
        })
        .finally(function() {
          setLoading(false);
        });
    }, []);

    useEffect(function loadLogsOnMount() {
      runTrainingLogsFetch(false);
    }, [runTrainingLogsFetch]);

    useEffect(function subscribeJournalRefreshEvent() {
      function onRefresh(ev) {
        var force = !(ev && ev.detail && ev.detail.force === false);
        runTrainingLogsFetch(force);
        // 로그 갱신 시 yearly_peaks도 함께 재조회:
        // Cloud Function이 새 라이딩 저장 후 peaks를 업데이트하므로
        // 최신 PR 정보를 반영하기 위해 항상 재패치한다.
        runYearlyPeaksFetch();
      }
      window.addEventListener('journal-training-logs-refresh', onRefresh);
      return function() {
        window.removeEventListener('journal-training-logs-refresh', onRefresh);
      };
    }, [runTrainingLogsFetch, runYearlyPeaksFetch]);

    useEffect(function autoSelectDefaultJournalDate() {
      if (loading) return;
      var tl = trainingLogs || {};
      var keys = Object.keys(tl);
      if (keys.length === 0) return;
      setSelectedDate(function (prev) {
        if (prev != null) return prev;
        var now = new Date();
        var todayKey =
          now.getFullYear() +
          '-' +
          String(now.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now.getDate()).padStart(2, '0');
        if (tl[todayKey] && tl[todayKey].length > 0) return todayKey;
        var y = currentYear;
        var m = currentMonth;
        var inMonth = keys
          .filter(function (k) {
            var p = k.split('-');
            if (p.length < 3) return false;
            return Number(p[0]) === y && Number(p[1]) === m + 1;
          })
          .sort(function (a, b) {
            return b.localeCompare(a);
          });
        if (inMonth.length > 0) return inMonth[0];
        var sorted = keys.slice().sort(function (a, b) {
          return b.localeCompare(a);
        });
        return sorted[0];
      });
    }, [loading, trainingLogs, currentYear, currentMonth]);

    function fetchDailyRouteProfileDoc(userId, dateKey) {
      if (!userId || !dateKey) return Promise.resolve(null);
      var fns = window._firebaseFirestoreFns;
      var db = window.firestoreV9;
      if (db && fns && typeof fns.doc === 'function' && typeof fns.getDoc === 'function') {
        var ref = fns.doc(db, 'users', String(userId), 'daily_route_profiles', String(dateKey));
        return fns.getDoc(ref).then(function (snap) {
          var exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
          if (!exists) return null;
          var data = typeof snap.data === 'function' ? snap.data() : null;
          return data || null;
        }).catch(function (e) {
          var code = e && (e.code || e.message || '');
          if (String(code).indexOf('permission') === -1) {
            console.warn('[useJournalData] daily_route_profiles(v9) 조회 실패:', e);
          }
          return null;
        });
      }
      if (window.firestore && typeof window.firestore.collection === 'function') {
        return window.firestore
          .collection('users')
          .doc(String(userId))
          .collection('daily_route_profiles')
          .doc(String(dateKey))
          .get()
          .then(function (snap) {
            return snap && snap.exists ? snap.data() : null;
          })
          .catch(function (e2) {
            var code2 = e2 && (e2.code || e2.message || '');
            if (String(code2).indexOf('permission') === -1) {
              console.warn('[useJournalData] daily_route_profiles(compat) 조회 실패:', e2);
            }
            return null;
          });
      }
      return Promise.resolve(null);
    }

    useEffect(function loadDailyRouteProfileForSelectedDate() {
      if (!selectedDate) {
        setDailyRouteDoc(null);
        setDailyRouteDocDate(null);
        return;
      }
      var userId = getCurrentUserId();
      if (!userId) {
        setDailyRouteDoc(null);
        setDailyRouteDocDate(null);
        return;
      }
      var fetchForDate = selectedDate;
      var cancelled = false;
      fetchDailyRouteProfileDoc(userId, fetchForDate).then(function (doc) {
        if (!cancelled) {
          setDailyRouteDoc(doc);
          setDailyRouteDocDate(fetchForDate);
        }
      });
      return function () {
        cancelled = true;
      };
    }, [selectedDate]);

    /** iOS WebView — 날짜 탭 시 이전 날짜 경로·요약이 한 박자 남는 현상 방지 */
    var selectJournalDate = useCallback(function (dateKey) {
      setSelectedDate(dateKey);
      setDailyRouteDoc(null);
      setDailyRouteDocDate(null);
    }, []);

    useEffect(function refreshDailyRouteOnJournalEvent() {
      function onRefresh(ev) {
        if (!selectedDate) return;
        var userId = getCurrentUserId();
        if (!userId) return;
        fetchDailyRouteProfileDoc(userId, selectedDate).then(function (doc) {
          setDailyRouteDoc(doc);
          setDailyRouteDocDate(selectedDate);
        });
      }
      window.addEventListener('journal-training-logs-refresh', onRefresh);
      return function () {
        window.removeEventListener('journal-training-logs-refresh', onRefresh);
      };
    }, [selectedDate]);

    // 월별 네비게이션 (달 이동 시 서버 훈련 로그 재조회)
    var navigateMonth = useCallback(function(direction) {
      var delta = direction === 'prev' ? -1 : 1;
      var targetYear = currentYear;
      var targetMonth = currentMonth + delta;
      if (targetMonth < 0) {
        targetYear -= 1;
        targetMonth = 11;
      } else if (targetMonth > 11) {
        targetYear += 1;
        targetMonth = 0;
      }
      setCurrentYear(targetYear);
      setCurrentMonth(targetMonth);

      // 현재월(실제 오늘 기준)로 복귀하면 새로 동기화된 로그·PR까지 반영되도록
      // Strava 동기화 후와 동일한 전체 강제 새로고침 경로를 태운다.
      var realNow = new Date();
      var isBackToRealCurrentMonth =
        targetYear === realNow.getFullYear() && targetMonth === realNow.getMonth();
      if (
        isBackToRealCurrentMonth &&
        typeof window !== 'undefined' &&
        typeof window.dispatchEvent === 'function' &&
        typeof window.CustomEvent === 'function'
      ) {
        setTimeout(function() {
          window.dispatchEvent(
            new CustomEvent('journal-training-logs-refresh', { detail: { force: true } })
          );
        }, 0);
      } else {
        setTimeout(function() {
          runTrainingLogsFetch(true);
        }, 0);
      }
    }, [currentYear, currentMonth, runTrainingLogsFetch]);

    // 선택된 날짜의 로그 (배열 복사 — iOS에서 참조 재사용 시 요약 수치가 늦게 갱신되는 문제 완화)
    var logsForSelectedDate = useMemo(
      function () {
        if (!selectedDate || !trainingLogs) return [];
        var raw = trainingLogs[selectedDate];
        if (!raw || !raw.length) return [];
        return raw.slice();
      },
      [selectedDate, trainingLogs]
    );

    var _enrichedLogsState = useState([]);
    var enrichedLogsForSelectedDate = _enrichedLogsState[0];
    var setEnrichedLogsForSelectedDate = _enrichedLogsState[1];

    useEffect(function enrichHrPeaksForSelectedDate() {
      if (!logsForSelectedDate.length) {
        setEnrichedLogsForSelectedDate([]);
        return;
      }
      setEnrichedLogsForSelectedDate(logsForSelectedDate);
      var userId = getCurrentUserId();
      var enrichHrFn = window.enrichLogsHrPeaksFromFirestore;
      var enrichWoFn =
        window.journalWorkoutGraphUtils &&
        typeof window.journalWorkoutGraphUtils.enrichLogsWithStelvioWorkoutFromFirestore === 'function'
          ? window.journalWorkoutGraphUtils.enrichLogsWithStelvioWorkoutFromFirestore
          : null;
      if (!userId) return;
      var cancelled = false;
      var chain = Promise.resolve(logsForSelectedDate.slice());
      if (typeof enrichHrFn === 'function') {
        chain = chain.then(function (base) {
          return enrichHrFn(userId, base);
        });
      }
      if (enrichWoFn) {
        chain = chain.then(function (base) {
          return enrichWoFn(userId, base, selectedDate);
        });
      }
      chain
        .then(function (enriched) {
          if (!cancelled && enriched && enriched.length) {
            setEnrichedLogsForSelectedDate(enriched);
          }
        })
        .catch(function () { /* keep raw copy */ });
      return function () {
        cancelled = true;
      };
    }, [logsForSelectedDate, selectedDate]);

    var displayLogsForSelectedDate =
      enrichedLogsForSelectedDate && enrichedLogsForSelectedDate.length
        ? enrichedLogsForSelectedDate
        : logsForSelectedDate;

    var dailyRouteDocForSelectedDate =
      dailyRouteDocDate === selectedDate ? dailyRouteDoc : null;

    function buildJournalSelectionKey(date, logs) {
      if (!date) return 'none';
      if (!logs || !logs.length) return date + '-0';
      var ids = [];
      var i;
      for (i = 0; i < logs.length; i++) {
        ids.push(String(logs[i].activity_id != null ? logs[i].activity_id : logs[i].id || i));
      }
      var woKey = '';
      if (
        window.journalWorkoutGraphUtils &&
        typeof window.journalWorkoutGraphUtils.resolveWorkoutIdFromLogs === 'function'
      ) {
        var wid = window.journalWorkoutGraphUtils.resolveWorkoutIdFromLogs(null, logs);
        if (wid) woKey = '-wo' + wid;
      }
      var comp = logs._companionStelvioLogs;
      if (comp && comp.length) woKey += '-sc' + comp.length;
      return date + '-' + logs.length + '-' + ids.join(',') + woKey;
    }

    var journalSelectionKey = buildJournalSelectionKey(selectedDate, displayLogsForSelectedDate);

    // 월간 로그 (해당 월 날짜들의 로그)
    var monthlyLogs = (function() {
      var result = [];
      var start = new Date(currentYear, currentMonth, 1);
      var end = new Date(currentYear, currentMonth + 1, 0);
      for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        var logs = trainingLogs[key];
        if (logs && logs.length > 0) {
          result.push.apply(result, logs);
        }
      }
      return result;
    })();

    var openDetailSheet = useCallback(function() { setDetailSheetOpen(true); }, []);
    var closeDetailSheet = useCallback(function() { setDetailSheetOpen(false); }, []);

    var retryLoad = useCallback(function() {
      setError(null);
      if (typeof window !== 'undefined') {
        window.__journalInitInProgress = false;
        window.__journalFetchCallCount = 0;
        window.__journalEmptyRetryDone = false;
      }
      if (!getCurrentUserId()) {
        setError('로그인 상태를 확인해 주세요.');
        return;
      }
      runTrainingLogsFetch(true);
    }, [runTrainingLogsFetch]);

    var userWeightForPr = userProfile && userProfile.weight != null ? Number(userProfile.weight) : (function() {
      try { var cu = JSON.parse(localStorage.getItem('currentUser') || 'null'); return Number(cu && (cu.weight || cu.weightKg)) || 0; } catch(e) { return 0; }
    })();

    return {
      selectedDate: selectedDate,
      setSelectedDate: setSelectedDate,
      selectJournalDate: selectJournalDate,
      trainingLogs: trainingLogs,
      currentYear: currentYear,
      currentMonth: currentMonth,
      loading: loading,
      error: error,
      yearlyPeaksByYear: yearlyPeaksByYear,
      userWeightForPr: userWeightForPr,
      userProfile: userProfile,
      logsForSelectedDate: displayLogsForSelectedDate,
      dailyRouteDoc: dailyRouteDocForSelectedDate,
      journalSelectionKey: journalSelectionKey,
      monthlyLogs: monthlyLogs,
      navigateMonth: navigateMonth,
      detailSheetOpen: detailSheetOpen,
      openDetailSheet: openDetailSheet,
      closeDetailSheet: closeDetailSheet,
      retryLoad: retryLoad,
      getCurrentUserId: getCurrentUserId
    };
  }

  window.useJournalData = useJournalData;
  console.log('[useJournalData] 훅 로드 완료');
})();
