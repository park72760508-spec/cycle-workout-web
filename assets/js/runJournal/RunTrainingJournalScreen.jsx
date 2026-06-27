/**
 * RunTrainingJournalScreen — RUN 기록 일지 (CYCLE trainingJournalScreen 과 분리)
 */
/* global React */

(function () {
  'use strict';
  if (!window.React) return;

  var R = window.React;
  var useLayoutEffect = R.useLayoutEffect || R.useEffect;

  function RunTrainingJournalScreen() {
    var useRunJournalData = window.useRunJournalData;
    if (!useRunJournalData) {
      return R.createElement('div', { className: 'journal-error' }, 'useRunJournalData 훅을 불러올 수 없습니다.');
    }

    var data = useRunJournalData();
    var Calendar = window.RunJournalCalendarWidget;
    var Summary = window.RunJournalDailySummary;
    var MonthlySummary = window.RunJournalMonthlySummary;
    var YearlyChart = window.RunJournalYearlyChart;
    var Sheet = window.RunJournalDetailBottomSheet;

    useLayoutEffect(function () {
      var container = document.getElementById('run-journal-react-root');
      if (container) container.scrollTop = 0;
    }, []);

    if (data.loading && Object.keys(data.trainingLogs).length === 0) {
      return R.createElement('div', { className: 'journal-loading-wrap', id: 'run-journal-react-root' },
        R.createElement('div', { className: 'journal-loading-spinner' }),
        R.createElement('p', { className: 'journal-loading-text' }, 'RUN 로그 분석 중...')
      );
    }

    if (data.error && Object.keys(data.trainingLogs).length === 0) {
      return R.createElement('div', { className: 'journal-error-wrap', id: 'run-journal-react-root' },
        R.createElement('p', { className: 'journal-error-msg' }, data.error),
        R.createElement('button', { type: 'button', className: 'journal-retry-btn', onClick: data.retryLoad }, '다시 시도')
      );
    }

    return R.createElement('div', { className: 'journal-screen-content', id: 'run-journal-react-root' },
      Calendar ? R.createElement(Calendar, {
        trainingLogs: data.trainingLogs,
        currentYear: data.currentYear,
        currentMonth: data.currentMonth,
        onNavigate: data.navigateMonth,
        onDateSelect: data.selectJournalDate,
        selectedDate: data.selectedDate,
        yearlyPacePrByYear: data.yearlyPacePrByYear,
        effortsByActivityId: data.effortsByActivityId
      }) : null,
      Summary ? R.createElement(Summary, {
        key: data.journalSelectionKey || data.selectedDate || 'run-summary',
        selectedDate: data.selectedDate,
        logs: data.logsForSelectedDate,
        dailyRouteDoc: data.dailyRouteDoc,
        onShowDetail: data.openDetailSheet
      }) : null,
      MonthlySummary ? R.createElement(MonthlySummary, {
        trainingLogs: data.trainingLogs,
        currentYear: data.currentYear,
        currentMonth: data.currentMonth
      }) : null,
      YearlyChart ? R.createElement(YearlyChart, {
        trainingLogs: data.trainingLogs,
        currentYear: data.currentYear,
        currentMonth: data.currentMonth
      }) : null,
      Sheet ? R.createElement(Sheet, {
        open: data.detailSheetOpen,
        onClose: data.closeDetailSheet,
        logs: data.logsForSelectedDate,
        selectedDate: data.selectedDate,
        yearlyPacePrByYear: data.yearlyPacePrByYear
      }) : null
    );
  }

  window.RunTrainingJournalScreen = RunTrainingJournalScreen;
})();
