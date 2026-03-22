/**
 * useJournalData - Custom Hook for Training Journal Screen
 * 훈련 로그, 선택된 날짜, 월간 데이터를 통합 관리합니다.
 * @see docs/라이딩_일지_리팩터링_계획.md
 */
(function() {
  'use strict';

  if (typeof window === 'undefined') return;
  var React = window.React;
  if (!React || !React.useState || !React.useEffect || !React.useCallback) {
    console.warn('[useJournalData] React hooks not available');
    return;
  }

  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;

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
        setUserProfile({
          ftp: Number(cu.ftp || 200),
          weight: Number(cu.weight || cu.weightKg || 0),
          max_hr: Number(cu.max_hr || cu.maxHr || 190)
        });
      }
    }, []);

    // PR 표시용 yearly_peaks 조회 (기존 renderMiniCalendarJournal 로직 이관)
    useEffect(function loadYearlyPeaks() {
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

    // 훈련 로그 로드
    useEffect(function loadLogs() {
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

      fetchFn(userId)
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

    // 월별 네비게이션
    var navigateMonth = useCallback(function(direction) {
      setCurrentMonth(function(prev) {
        var next = direction === 'prev' ? prev - 1 : prev + 1;
        if (next < 0) {
          setCurrentYear(function(y) { return y - 1; });
          return 11;
        }
        if (next > 11) {
          setCurrentYear(function(y) { return y + 1; });
          return 0;
        }
        return next;
      });
    }, []);

    // 선택된 날짜의 로그
    var logsForSelectedDate = selectedDate && trainingLogs[selectedDate] ? trainingLogs[selectedDate] : [];

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
      var uid = getCurrentUserId();
      if (!uid) {
        setError('로그인 상태를 확인해 주세요.');
        return;
      }
      if (typeof window.fetchTrainingLogsForCalendarJournal === 'function') {
        setLoading(true);
        window.fetchTrainingLogsForCalendarJournal(uid)
          .then(function(logsByDate) {
            setTrainingLogs(logsByDate || {});
            setError(null);
            if (typeof window.updateJournalSubtitle === 'function') {
              window.updateJournalSubtitle('(' + Object.keys(logsByDate || {}).length + '일 훈련 기록)');
            }
          })
          .catch(function(err) { setError(err && err.message ? err.message : '로드 실패'); })
          .finally(function() { setLoading(false); });
      }
    }, []);

    var userWeightForPr = userProfile && userProfile.weight != null ? Number(userProfile.weight) : (function() {
      try { var cu = JSON.parse(localStorage.getItem('currentUser') || 'null'); return Number(cu && (cu.weight || cu.weightKg)) || 0; } catch(e) { return 0; }
    })();

    return {
      selectedDate: selectedDate,
      setSelectedDate: setSelectedDate,
      trainingLogs: trainingLogs,
      currentYear: currentYear,
      currentMonth: currentMonth,
      loading: loading,
      error: error,
      yearlyPeaksByYear: yearlyPeaksByYear,
      userWeightForPr: userWeightForPr,
      userProfile: userProfile,
      logsForSelectedDate: logsForSelectedDate,
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
