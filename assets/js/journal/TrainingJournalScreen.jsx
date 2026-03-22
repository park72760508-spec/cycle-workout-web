/**
 * TrainingJournalScreen - 라이딩 일지 리팩터링 부모 컴포넌트
 * Level 1: JournalCalendarWidget + JournalDailySummary
 * Level 2: JournalDetailBottomSheet (추후)
 * Level 3: JournalMonthlyDashboard (추후)
 */
/* global React, useLayoutEffect, useEffect */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[TrainingJournalScreen] React not loaded');
    return;
  }

  var ReactObj = window.React;
  var useLayoutEffect = ReactObj.useLayoutEffect || ReactObj.useEffect;
  var useEffect = ReactObj.useEffect;

  function TrainingJournalScreen() {
    var useJournalData = window.useJournalData;
    if (!useJournalData) {
      return React.createElement('div', { className: 'journal-error' }, 'useJournalData 훅을 불러올 수 없습니다.');
    }

    var data = useJournalData();
    var selectedDate = data.selectedDate;
    var setSelectedDate = data.setSelectedDate;
    var trainingLogs = data.trainingLogs;
    var currentYear = data.currentYear;
    var currentMonth = data.currentMonth;
    var loading = data.loading;
    var error = data.error;
    var logsForSelectedDate = data.logsForSelectedDate;
    var navigateMonth = data.navigateMonth;
    var openDetailSheet = data.openDetailSheet;
    var closeDetailSheet = data.closeDetailSheet;
    var detailSheetOpen = data.detailSheetOpen;
    var retryLoad = data.retryLoad;

    var CalendarWidget = window.JournalCalendarWidget;
    var DailySummary = window.JournalDailySummary;
    var DetailBottomSheet = window.JournalDetailBottomSheet;
    var MonthlyDashboard = window.JournalMonthlyDashboard;

    useLayoutEffect(function() {
      var container = document.getElementById('journal-react-root');
      if (container) {
        container.scrollTop = 0;
      }
    }, []);

    if (loading && Object.keys(trainingLogs).length === 0) {
      return React.createElement('div', { className: 'journal-loading-wrap', id: 'journal-react-root' },
        React.createElement('div', { className: 'journal-loading-spinner' }),
        React.createElement('p', { className: 'journal-loading-text' }, '라이딩 로그 분석 중...')
      );
    }

    if (error && Object.keys(trainingLogs).length === 0) {
      return React.createElement('div', { className: 'journal-error-wrap', id: 'journal-react-root' },
        React.createElement('p', { className: 'journal-error-msg' }, error),
        React.createElement('button', {
          type: 'button',
          className: 'journal-retry-btn',
          onClick: retryLoad
        }, '훈련 로드 다시 시도')
      );
    }

    return React.createElement('div', { className: 'journal-screen-content', id: 'journal-react-root' },
      CalendarWidget ? React.createElement(CalendarWidget, {
        trainingLogs: trainingLogs,
        currentYear: currentYear,
        currentMonth: currentMonth,
        onNavigate: navigateMonth,
        onDateSelect: setSelectedDate,
        selectedDate: selectedDate,
        yearlyPeaksByYear: data.yearlyPeaksByYear,
        userWeightForPr: data.userWeightForPr
      }) : null,
      DailySummary ? React.createElement(DailySummary, {
        selectedDate: selectedDate,
        logs: logsForSelectedDate,
        onShowDetail: openDetailSheet
      }) : null,
      MonthlyDashboard ? React.createElement(MonthlyDashboard, {
        trainingLogs: trainingLogs,
        currentYear: currentYear,
        currentMonth: currentMonth,
        userProfile: data.userProfile
      }) : null,
      DetailBottomSheet ? React.createElement(DetailBottomSheet, {
        open: detailSheetOpen,
        onClose: closeDetailSheet,
        logs: logsForSelectedDate,
        selectedDate: selectedDate,
        yearlyPeaksByYear: data.yearlyPeaksByYear,
        userWeightForPr: data.userWeightForPr
      }) : null
    );
  }

  window.TrainingJournalScreen = TrainingJournalScreen;
})();
