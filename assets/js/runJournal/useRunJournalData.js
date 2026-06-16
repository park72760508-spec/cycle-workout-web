/**
 * useRunJournalData — RUN 기록 일지 데이터 (Supabase activities + run_activity_efforts)
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || !window.React) return;

  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;
  var useMemo = React.useMemo;
  var pr = function () { return window.runJournalPrUtils; };

  function getCurrentUserId() {
    var currentUser = window.currentUser || (function () {
      try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; }
    })();
    if (currentUser && (currentUser.id != null || currentUser.uid != null)) {
      return currentUser.id != null ? currentUser.id : currentUser.uid;
    }
    var authV9 = typeof window.getCurrentUserForTrainingRooms === 'function'
      ? window.getCurrentUserForTrainingRooms() : null;
    if (authV9 && (authV9.uid != null || authV9.id != null)) {
      return authV9.uid != null ? authV9.uid : authV9.id;
    }
    return null;
  }

  function useRunJournalData() {
    var _d = useState(null);
    var selectedDate = _d[0];
    var setSelectedDate = _d[1];

    var _logs = useState({});
    var trainingLogs = _logs[0];
    var setTrainingLogs = _logs[1];

    var _y = useState(new Date().getFullYear());
    var currentYear = _y[0];
    var setCurrentYear = _y[1];

    var _m = useState(new Date().getMonth());
    var currentMonth = _m[0];
    var setCurrentMonth = _m[1];

    var _load = useState(false);
    var loading = _load[0];
    var setLoading = _load[1];

    var _err = useState(null);
    var error = _err[0];
    var setError = _err[1];

    var _efforts = useState([]);
    var efforts = _efforts[0];
    var setEfforts = _efforts[1];

    var _sheet = useState(false);
    var detailSheetOpen = _sheet[0];
    var setDetailSheetOpen = _sheet[1];

    var effortsByActivityId = useMemo(function () {
      return pr().indexEffortsByActivityId(efforts);
    }, [efforts]);

    var yearlyPacePrByYear = useMemo(function () {
      var years = [currentYear - 1, currentYear, currentYear + 1];
      var out = {};
      years.forEach(function (y) {
        out[y] = pr().buildYearlyPacePrByAxis(efforts, y);
      });
      return out;
    }, [efforts, currentYear]);

    var loadData = useCallback(function () {
      var userId = getCurrentUserId();
      if (!userId) {
        setError('로그인이 필요합니다.');
        setLoading(false);
        return Promise.resolve();
      }
      var fetchLogs = typeof window.getUserRunTrainingLogs === 'function'
        ? window.getUserRunTrainingLogs
        : (window.runEffortsReadClient && window.runEffortsReadClient.getUserRunTrainingLogs);
      var fetchEfforts = typeof window.getUserRunEfforts === 'function'
        ? window.getUserRunEfforts
        : (window.runEffortsReadClient && window.runEffortsReadClient.getUserRunEfforts);
      if (typeof fetchLogs !== 'function' || typeof fetchEfforts !== 'function') {
        setError('RUN 기록 API를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        setLoading(false);
        return Promise.resolve();
      }
      setLoading(true);
      setError(null);
      return Promise.all([
        fetchLogs(userId, { limit: 500 }),
        fetchEfforts(userId, { limit: 500 }),
      ])
        .then(function (res) {
          var logs = res[0] || [];
          var eff = res[1] || [];
          setEfforts(eff);
          var grouped = pr().groupLogsByDate(logs);
          setTrainingLogs(grouped);
          if (typeof window.updateRunJournalSubtitle === 'function') {
            window.updateRunJournalSubtitle('(' + logs.length + '건)');
          }
        })
        .catch(function (e) {
          setError((e && e.message) || 'RUN 기록을 불러오지 못했습니다.');
        })
        .finally(function () {
          setLoading(false);
        });
    }, []);

    useEffect(function () {
      var cancelled = false;
      function tryLoad(attempt) {
        if (cancelled) return;
        if (typeof window.getUserRunTrainingLogs === 'function') {
          loadData();
          return;
        }
        if (attempt < 30) {
          setTimeout(function () { tryLoad(attempt + 1); }, 120);
        } else {
          setError('RUN 기록 API를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
          setLoading(false);
        }
      }
      tryLoad(0);
      return function () { cancelled = true; };
    }, [loadData]);

    useEffect(function () {
      function onRefresh() { loadData(); }
      window.addEventListener('run-journal-refresh', onRefresh);
      return function () { window.removeEventListener('run-journal-refresh', onRefresh); };
    }, [loadData]);

    var logsForSelectedDate = useMemo(function () {
      if (!selectedDate) return [];
      var raw = trainingLogs[selectedDate] || [];
      return raw.map(function (log) {
        return pr().mergeEffortIntoLog(log, effortsByActivityId[String(log.activity_id || '')]);
      });
    }, [selectedDate, trainingLogs, effortsByActivityId]);

    var selectJournalDate = useCallback(function (dateKey) {
      setSelectedDate(dateKey);
    }, []);

    var navigateMonth = useCallback(function (dir) {
      setCurrentMonth(function (m) {
        var next = m + (dir === 'next' ? 1 : -1);
        if (next > 11) {
          setCurrentYear(function (y) { return y + 1; });
          return 0;
        }
        if (next < 0) {
          setCurrentYear(function (y) { return y - 1; });
          return 11;
        }
        return next;
      });
    }, []);

    return {
      selectedDate: selectedDate,
      selectJournalDate: selectJournalDate,
      setSelectedDate: setSelectedDate,
      trainingLogs: trainingLogs,
      currentYear: currentYear,
      currentMonth: currentMonth,
      loading: loading,
      error: error,
      logsForSelectedDate: logsForSelectedDate,
      navigateMonth: navigateMonth,
      openDetailSheet: function () { setDetailSheetOpen(true); },
      closeDetailSheet: function () { setDetailSheetOpen(false); },
      detailSheetOpen: detailSheetOpen,
      retryLoad: loadData,
      effortsByActivityId: effortsByActivityId,
      yearlyPacePrByYear: yearlyPacePrByYear,
      journalSelectionKey: selectedDate,
    };
  }

  window.useRunJournalData = useRunJournalData;
})();
