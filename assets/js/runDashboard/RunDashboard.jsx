/**
 * RunDashboard - RUN 전용 Performance Dashboard (CYCLE PerformanceDashboard 복제·1차 치환)
 * Level 1: RunAICoachHeroCard (Hero)
 * Level 2: RunDailyQuickStats (역치 페이스·체중 / 주간 rTSS)
 * Level 3: DashboardDetailTabs (헥사곤 6축 · 성장 · rTSS 트렌드)
 *
 * @see assets/js/runDashboard/index.js
 */
/* global React, useState, useLayoutEffect, useEffect, window */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[RunDashboard] React not loaded');
    return;
  }

  var ReactObj = window.React;
  var useState = ReactObj.useState;
  var useLayoutEffect = ReactObj.useLayoutEffect || ReactObj.useEffect;
  var useEffect = ReactObj.useEffect;

  function renderRunHeaderTierBadge(stats, size) {
    var badge = { badgeSrc: 'assets/img/G.svg', levelName: '등급', unavailable: true };
    if (window.runDashboardPace && typeof window.runDashboardPace.resolveRunHexagonTierBadge === 'function') {
      badge = window.runDashboardPace.resolveRunHexagonTierBadge(stats);
    } else if (stats && stats.hexagonTierBadgeSrc) {
      badge = {
        badgeSrc: stats.hexagonTierBadgeSrc,
        levelName: stats.hexagonTierLevelName || '등급',
        unavailable: false
      };
    }
    var s = size || 40;
    var paceDisplay = stats && (stats.thresholdPaceDisplay || stats.thresholdPaceValue);
    var title = badge.levelName;
    if (paceDisplay) {
      title += ' · 10k ' + paceDisplay + ' min/km (90일)';
    } else if (badge.unavailable) {
      title = '10k 페이스 기록 없음';
    }
    return ReactObj.createElement('img', {
      key: badge.badgeSrc + '-' + (stats && stats.thresholdPaceSec),
      src: badge.badgeSrc,
      alt: badge.levelName,
      title: title,
      className: 'object-contain shrink-0' + (badge.unavailable ? ' opacity-50' : ''),
      style: { width: s + 'px', height: s + 'px' },
      width: s,
      height: s,
      loading: 'lazy',
      decoding: 'async',
      draggable: false
    });
  }

  function formatPoints(points) {
    var num = Math.round(Number(points) || 0);
    if (num >= 1000) {
      var k = num / 1000;
      return k % 1 === 0 ? k + 'k' : k.toFixed(1) + 'k';
    }
    return num.toString();
  }

  function getGradeBadge(grade) {
    if (!grade) return '';
    if (grade === '1') return '관리자';
    if (grade === '2') return '회원';
    return '등급 ' + grade;
  }

  function getSeoulYmdFromUnknown(dateLike) {
    if (!dateLike) return '';
    try {
      var d = null;
      if (dateLike && typeof dateLike.toDate === 'function') d = dateLike.toDate();
      else if (dateLike instanceof Date) d = dateLike;
      else if (typeof dateLike === 'string') {
        var s = String(dateLike).trim();
        var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return m[1] + '-' + String(Number(m[2])).padStart(2, '0') + '-' + String(Number(m[3])).padStart(2, '0');
        d = new Date(s);
      }
      if (!d || isNaN(d.getTime())) return '';
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(d);
      var y = '';
      var mo = '';
      var da = '';
      parts.forEach(function(p) {
        if (p.type === 'year') y = p.value;
        if (p.type === 'month') mo = p.value;
        if (p.type === 'day') da = p.value;
      });
      return y && mo && da ? y + '-' + mo + '-' + da : '';
    } catch (e) {
      return '';
    }
  }

  function getSeoulTodayYmd() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (e) {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
  }

  function shiftYmd(ymd, deltaDays) {
    var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setDate(d.getDate() + Number(deltaDays || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function RunDashboard() {
    var data = typeof window.useRunDashboardData === 'function' ? window.useRunDashboardData() : {};

    var userProfile = data.userProfile || null;
    var stats = data.stats || { thresholdPace: 0, weightKg: 0, weight: 0, weeklyRtssGoal: 175, weeklyRtssProgress: 0, totalPoints: 0, currentPoints: 0 };
    var coachData = data.coachData || null;
    var loading = data.loading;
    var aiLoading = data.aiLoading;
    var streamingComment = data.streamingComment;
    var runConditionAnalysis = data.runConditionAnalysis;
    var setRunConditionAnalysis = data.setRunConditionAnalysis;
    var logsLoading = data.logsLoading;
    var logsLoadError = data.logsLoadError;
    var retryLogsRef = data.retryLogsRef;
    var fitnessData = data.fitnessData || [];
    var vo2TrendData = data.vo2TrendData || [];
    var weeklyTssTrendData = data.weeklyTssTrendData || [];
    var growthTrendData = data.growthTrendData || [];
    var growthYearlyPr = data.growthYearlyPr || null;
    var yearlyPowerPrData = data.yearlyPowerPrData || [];
    var recentLogs = data.recentLogs || [];
    var hexagonCoachContext = data.hexagonCoachContext || null;
    var tpCalcLoading = data.tpCalcLoading;
    var setTpCalcLoading = data.setTpCalcLoading;
    var tpModalOpen = data.tpModalOpen;
    var setTpModalOpen = data.setTpModalOpen;
    var tpCalcResult = data.tpCalcResult;
    var setTpCalcResult = data.setTpCalcResult;
    var setUserProfile = data.setUserProfile;
    var setStats = data.setStats;
    var _ftpCalc = useState(false);
    var runFtpCalcLoading = _ftpCalc[0];
    var setRunFtpCalcLoading = _ftpCalc[1];
    var _ftpModal = useState(false);
    var runFtpModalOpen = _ftpModal[0];
    var setRunFtpModalOpen = _ftpModal[1];
    var _ftpResult = useState(null);
    var runFtpCalcResult = _ftpResult[0];
    var setRunFtpCalcResult = _ftpResult[1];

    function closeEtpModal() {
      var cb = document.getElementById('dynamicEtpDontShow10DaysReact');
      if (cb && cb.checked && userProfile && userProfile.id && typeof window.setDynamicFtpCooldown === 'function') {
        window.setDynamicFtpCooldown(userProfile.id);
      }
      setTpModalOpen(false);
      setTpCalcResult(null);
    }

    function closeRunFtpModal() {
      setRunFtpModalOpen(false);
      setRunFtpCalcResult(null);
    }

    // 스크롤 초기화: useLayoutEffect로 DOM 마운트 직후 1회 실행 (기존 setTimeout 4회 폐기)
    useLayoutEffect(function() {
      var container = document.getElementById('run-dashboard-container');
      if (container) {
        container.scrollTop = 0;
        container.scrollTo(0, 0);
      }
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    }, []);

    var RunAICoachHeroCard = window.RunAICoachHeroCard;
    var RunDailyQuickStats = window.RunDailyQuickStats;
    var DashboardDetailTabs = window.DashboardDetailTabs;
    var CircularProgress = window.DashboardCircularProgress;
    var DashboardCard = window.DashboardCard;
    if (!DashboardCard) {
      DashboardCard = function(p) {
        return React.createElement('div', { className: 'bg-white rounded-2xl p-4 shadow-sm border border-gray-100' + (p.className ? ' ' + p.className : '') }, p.title && React.createElement('h3', { className: 'text-sm font-semibold text-gray-600 mb-3' }, p.title), p.children);
      };
    }

    if (loading) {
      return (
        <div className="max-w-[480px] mx-auto min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <div className="text-sm text-gray-600">사용자 정보를 불러오는 중...</div>
          </div>
        </div>
      );
    }

    if (!userProfile) {
      return (
        <div className="max-w-[480px] mx-auto min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="text-center text-gray-600">
            <p className="mb-4">로그인이 필요합니다.</p>
            <button
              type="button"
              onClick={function() { if (typeof showScreen === 'function') showScreen('myCareerScreen'); }}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg"
            >
              나의 기록으로 이동
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-[480px] mx-auto min-h-screen bg-gray-50 scrollbar-hide relative">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="w-10 shrink-0" aria-hidden="true" />
            <div className="flex items-center gap-3 flex-1 justify-center">
              {renderRunHeaderTierBadge(stats, 40)}
              <div>
                <div className="font-semibold text-gray-900">{userProfile.name || '사용자'}</div>
                <div className="text-xs text-gray-500">{getGradeBadge(userProfile.grade)}</div>
              </div>
            </div>
            <button
              className="p-2 rounded-lg hover:bg-gray-100 active:opacity-80 transition-all opacity-50 cursor-not-allowed"
              aria-label="프로필 편집 (추후 구현)"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        </header>

        {/* Level 1: Hero - RunAICoachHeroCard */}
        <section className="px-4 pt-6">
          {RunAICoachHeroCard ? (
            React.createElement(RunAICoachHeroCard, {
              coachData: coachData,
              aiLoading: aiLoading,
              streamingComment: streamingComment,
              runConditionAnalysis: runConditionAnalysis,
              setRunConditionAnalysis: setRunConditionAnalysis,
              setRetryCoach: data.setRetryCoach,
              userProfile: userProfile,
              stats: stats,
              CircularProgress: CircularProgress
            })
          ) : (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <div className="text-center text-gray-500 text-sm">RunAICoachHeroCard (구현 예정)</div>
              {coachData && (
                <div className="mt-4">
                  <div className="text-lg font-bold text-gray-900">컨디션: {coachData.condition_score}점</div>
                  <p className="text-sm text-gray-700 mt-2">{streamingComment || coachData.coach_comment}</p>
                  <button
                    type="button"
                    onClick={function() {
                      if (typeof window.showRunWorkoutGuideModal === 'function') {
                        window.showRunWorkoutGuideModal(userProfile, coachData, stats);
                      }
                    }}
                    className="mt-4 w-full py-3 bg-blue-500 text-white font-semibold rounded-xl"
                  >
                    추천: {coachData.recommended_workout || 'Recovery Jog (Z1)'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Level 2: Quick Stats - RunDailyQuickStats */}
        <section className="px-4 pt-6">
          {RunDailyQuickStats ? (
            React.createElement(RunDailyQuickStats, {
              stats: stats,
              logsLoading: logsLoading,
              logsLoadError: logsLoadError,
              retryLogsRef: retryLogsRef,
              formatPoints: formatPoints,
              DashboardCard: DashboardCard
            })
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">역치 페이스 & 체중</h3>
                <div className="text-xs text-gray-500 mb-1">10k</div>
                <div className="text-xl font-bold text-gray-900">{stats.thresholdPaceDisplay || '산출 불가'}</div>
                <div className="text-sm text-gray-600 mt-2">{stats.weight ? stats.weight + 'kg' : '체중 미등록'}</div>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">주간 목표</h3>
                <div className="text-2xl font-bold text-gray-900">
                  {logsLoading ? '...' : Math.min(Math.round((stats.weeklyRtssProgress / (stats.weeklyRtssGoal || 175)) * 100), 100)}%
                </div>
                <div className="text-sm text-gray-600">{stats.weeklyRtssProgress}/{stats.weeklyRtssGoal || 175} rTSS</div>
              </div>
            </div>
          )}
        </section>

        {/* 나의 역치 페이스(TP) 산출 카드 (탭 위쪽, 기존 디자인) */}
        <section className="px-4 pt-6">
          {DashboardCard && React.createElement(DashboardCard, {
            title: '나의 역치 페이스(TP) 산출',
            className: 'mt-0'
          }, React.createElement(React.Fragment, null,
            React.createElement('ul', { className: 'text-xs text-gray-600 space-y-1.5 mb-4' },
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/clock.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '6개 구간(1k, 3k, 5k, 7k, 10k, 20k) PR 페이스 데이터 종합')
              ),
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/statistics.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '구간별 생리학적 신뢰도 반영 (10k 역치 페이스 비중 최대)')
              ),
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/calendar.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '최신 기록 우대 (오래된 기록일수록 반영 비율 감소)')
              )
            ),
            React.createElement('div', { className: 'flex justify-center' },
              React.createElement('button', {
                type: 'button',
                onClick: async function() {
                  if (tpCalcLoading || !userProfile || !userProfile.id) return;
                  setTpCalcLoading(true);
                  setTpCalcResult(null);
                  try {
                    var efforts = [];
                    if (typeof window.getUserRunEfforts === 'function') {
                      efforts = await window.getUserRunEfforts(userProfile.id, { limit: 400 }) || [];
                    }
                    var result = window.calculateDynamicEtp
                      ? window.calculateDynamicEtp(efforts)
                      : { success: false, error: 'eTP 산출 함수를 불러올 수 없습니다.' };
                    setTpCalcResult(result);
                    setTpModalOpen(true);
                  } catch (e) {
                    setTpCalcResult({ success: false, error: (e && e.message) || 'eTP 산출 중 오류가 발생했습니다.' });
                    setTpModalOpen(true);
                  } finally {
                    setTpCalcLoading(false);
                  }
                },
                disabled: tpCalcLoading,
                className: 'stelvio-ranking-board-entry-btn'
              }, tpCalcLoading ? React.createElement('span', { className: 'flex items-center justify-center gap-2' },
                React.createElement('span', { className: 'w-5 h-5 border-2 border-[#667eea] border-t-transparent rounded-full animate-spin' }),
                '산출 중...'
              ) : 'eTP 산출하기')
            )
          ))}
        </section>

        <section className="px-4 pt-4">
          {DashboardCard && React.createElement(DashboardCard, {
            title: '나의 풀코스(fTP) 예측',
            className: 'mt-0'
          }, React.createElement(React.Fragment, null,
            React.createElement('ul', { className: 'text-xs text-gray-600 space-y-1.5 mb-4' },
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/clock.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '6개 구간(1k~20k) PR 페이스 → Riegel 공식으로 42.195km 예측')
              ),
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/statistics.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '20k·10k 누락 시 유산소 지구력 패널티 지수 자동 가산')
              ),
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/calendar.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '누락 구간 가중치 제외 후 Valid_W_Sum 기준 재분배(Normalized)')
              )
            ),
            React.createElement('div', { className: 'flex justify-center' },
              React.createElement('button', {
                type: 'button',
                onClick: async function () {
                  if (runFtpCalcLoading || !userProfile || !userProfile.id) return;
                  setRunFtpCalcLoading(true);
                  setRunFtpCalcResult(null);
                  try {
                    var efforts = [];
                    if (typeof window.getUserRunEfforts === 'function') {
                      efforts = await window.getUserRunEfforts(userProfile.id, { limit: 400 }) || [];
                    }
                    var ftpProfile = window.enrichRunFtpUserProfile
                      ? window.enrichRunFtpUserProfile(userProfile)
                      : userProfile;
                    var result = window.calculateDynamicRunFtp
                      ? window.calculateDynamicRunFtp(efforts, ftpProfile)
                      : { success: false, error: 'fTP 산출 함수를 불러올 수 없습니다.' };
                    setRunFtpCalcResult(result);
                    setRunFtpModalOpen(true);
                  } catch (e) {
                    setRunFtpCalcResult({ success: false, error: (e && e.message) || 'fTP 산출 중 오류가 발생했습니다.' });
                    setRunFtpModalOpen(true);
                  } finally {
                    setRunFtpCalcLoading(false);
                  }
                },
                disabled: runFtpCalcLoading,
                className: 'stelvio-ranking-board-entry-btn'
              }, runFtpCalcLoading ? React.createElement('span', { className: 'flex items-center justify-center gap-2' },
                React.createElement('span', { className: 'w-5 h-5 border-2 border-[#667eea] border-t-transparent rounded-full animate-spin' }),
                '예측 중...'
              ) : 'fTP 풀코스 예측하기')
            )
          ))}
        </section>

        {/* Level 3: Deep Dive - DashboardDetailTabs (RUN) */}
        <section className="px-4 py-6 pb-32">
          {DashboardDetailTabs ? (
            React.createElement(DashboardDetailTabs, {
              sportCategory: 'run',
              userProfile: userProfile,
              recentLogs: recentLogs,
              fitnessData: fitnessData,
              vo2TrendData: vo2TrendData,
              weeklyTssTrendData: weeklyTssTrendData,
              growthTrendData: growthTrendData,
              growthYearlyPr: growthYearlyPr,
              yearlyPowerPrData: yearlyPowerPrData,
              stats: stats,
              logsLoading: logsLoading,
              logsLoadError: logsLoadError,
              retryLogsRef: retryLogsRef,
              hexagonCoachContext: hexagonCoachContext,
              DashboardCard: DashboardCard
            })
          ) : (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <div className="text-center text-gray-500 text-sm">DashboardDetailTabs (구현 예정)</div>
              <div className="mt-4 text-xs text-gray-400">
                Tab 1: 나의 성향 | Tab 2: 최근 훈련 | Tab 3: 성장 추이
              </div>
            </div>
          )}
        </section>

        {/* eTP 산출 결과 모달 */}
        {tpModalOpen && tpCalcResult && React.createElement(
          'div',
          {
            className: 'fixed inset-0 z-[10001] flex items-center justify-center p-4 overflow-y-auto',
            style: { background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' },
            onClick: function(e) { if (e.target === e.currentTarget) closeEtpModal(); }
          },
          React.createElement(
            'div',
            {
              className: 'w-full max-w-lg my-4 bg-white rounded-2xl overflow-hidden shadow-xl border border-purple-100',
              style: { padding: '20px 24px 24px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
              onClick: function(e) { e.stopPropagation(); }
            },
            React.createElement('div', { className: 'flex items-start justify-between gap-3 mb-2', style: { borderBottom: '2px solid #667eea', paddingBottom: '10px' } },
              React.createElement('h3', { className: 'text-lg font-semibold text-gray-800 m-0' }, '역치 페이스(TP) 산출 결과'),
              React.createElement('button', {
                type: 'button',
                onClick: closeEtpModal,
                className: 'shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors',
                'aria-label': '닫기'
              }, React.createElement('svg', { className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
              ))
            ),
            React.createElement('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } },
              React.createElement('label', { className: 'flex items-center gap-2 mb-3 text-sm text-gray-600 cursor-pointer' },
                React.createElement('input', { type: 'checkbox', id: 'dynamicEtpDontShow10DaysReact' }),
                React.createElement('span', null, '10일 동안 보이지 않음')
              ),
              tpCalcResult.success ? React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'mb-4 overflow-x-auto text-xs' },
                  React.createElement('table', { className: 'w-full', style: { borderCollapse: 'collapse', minWidth: '520px' } },
                    React.createElement('thead', null,
                      React.createElement('tr', { style: { borderBottom: '2px solid #e2e8f0' } },
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'left', color: '#64748b', fontWeight: 600 } }, '구간'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'center', color: '#64748b', fontWeight: 600 } }, '달성일'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, '기록 페이스'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'P(초)'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'C'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, '보정 페이스'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'W'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'D'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'W×D')
                      )
                    ),
                    React.createElement('tbody', null,
                      (tpCalcResult.details || []).map(function(row, idx) {
                        var dateFmt = row.dateStr ? row.dateStr.replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3') : '-';
                        return React.createElement('tr', { key: idx, style: { borderBottom: '1px solid #f1f5f9', opacity: row.used ? 1 : 0.5 } },
                          React.createElement('td', { style: { padding: '6px 4px', color: '#334155', fontWeight: 600 } }, row.label),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'center', color: '#64748b', fontSize: '11px' } }, dateFmt),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: row.used ? '#667eea' : '#94a3b8' } }, row.used ? row.paceDisplay : '-'),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: '#64748b' } }, row.used ? row.paceSec : '-'),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: '#64748b' } }, row.convertFactor),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: row.used ? '#334155' : '#94a3b8' } }, row.used ? row.adjustedPaceDisplay : '-'),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: '#64748b' } }, row.weight),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: '#64748b' } }, row.used ? row.timeDecay : '-'),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: row.used ? '#667eea' : '#94a3b8', fontWeight: 600 } }, row.used ? row.appliedWeight.toFixed(2) : '-')
                        );
                      })
                    )
                  ),
                  React.createElement('p', { className: 'text-xs mt-2', style: { color: '#94a3b8' } }, 'P: 페이스(초/km) · C: 10k 역치 환산계수 · W: 신뢰도 · D: 시간감쇠(최신 우대) · W×D: 최종 적용 가중치')
                ),
                React.createElement('p', { className: 'text-sm mb-2', style: { color: '#475569', lineHeight: 1.6 } },
                  '새롭게 산출된 예상 10k 역치 페이스(eTP)는 ',
                  React.createElement('strong', { style: { color: '#667eea', fontSize: '1.1em' } }, tpCalcResult.newEtpSummary || tpCalcResult.newEtpDisplay),
                  ' 입니다.'
                )
              ) : React.createElement('p', { className: 'text-red-600 mb-2', style: { fontSize: '15px', lineHeight: 1.5 } }, tpCalcResult.error)
            )
          )
        )}

        {/* fTP 풀코스 예측 결과 모달 */}
        {runFtpModalOpen && runFtpCalcResult && (function () {
          var ftpProfile = window.enrichRunFtpUserProfile
            ? window.enrichRunFtpUserProfile(userProfile)
            : userProfile;
          var ftpAgeLabel = runFtpCalcResult.appliedAge != null
            ? String(runFtpCalcResult.appliedAge)
            : (window.resolveRunFtpProfileAge && ftpProfile
              ? (function () { var a = window.resolveRunFtpProfileAge(ftpProfile); return a != null ? String(a) : '미등록'; })()
              : '미등록');
          var ftpGenderLabel = runFtpCalcResult.appliedGenderLabel
            && runFtpCalcResult.appliedGenderLabel !== '미등록'
            ? runFtpCalcResult.appliedGenderLabel
            : (window.resolveRunFtpProfileGenderLabel && ftpProfile
              ? window.resolveRunFtpProfileGenderLabel(ftpProfile)
              : '미등록');
          return React.createElement(
          'div',
          {
            className: 'fixed inset-0 z-[10001] flex items-center justify-center p-4 overflow-y-auto run-ftp-modal-overlay',
            style: { background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' },
            onClick: function (e) { if (e.target === e.currentTarget) closeRunFtpModal(); }
          },
          React.createElement(
            'div',
            {
              className: 'w-full max-w-lg my-4 bg-white rounded-2xl overflow-hidden shadow-xl border border-emerald-100 run-ftp-modal-panel',
              style: { padding: '20px 24px 24px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
              onClick: function (e) { e.stopPropagation(); }
            },
            React.createElement('div', { className: 'flex items-start justify-between gap-3 mb-2', style: { borderBottom: '2px solid #059669', paddingBottom: '10px' } },
              React.createElement('h3', { className: 'text-lg font-semibold text-gray-800 m-0' }, '풀코스(fTP) 예측 결과'),
              React.createElement('button', {
                type: 'button',
                onClick: closeRunFtpModal,
                className: 'shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors',
                'aria-label': '닫기'
              }, React.createElement('svg', { className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
              ))
            ),
            React.createElement('div', {
              className: 'rounded-lg px-3 py-2.5 mb-3 text-xs leading-relaxed',
              style: { background: 'linear-gradient(135deg, rgba(5,150,105,0.08) 0%, rgba(16,185,129,0.06) 100%)', border: '1px solid rgba(5,150,105,0.25)', color: '#065f46' },
              role: 'note'
            },
              React.createElement('strong', { className: 'block mb-1 text-[11px]' }, '안내'),
              runFtpCalcResult.guidanceRecommended ||
                (window.RUN_FTP_GUIDANCE_RECOMMENDED || '보다 정확한 풀코스 산출을 위해서는 1k~10k 기록이 반드시 존재해야 합니다.'),
              (runFtpCalcResult.success && runFtpCalcResult.guidanceMessages && runFtpCalcResult.guidanceMessages.length > 1)
                ? React.createElement('ul', { className: 'mt-2 mb-0 pl-4 space-y-1 list-disc' },
                    runFtpCalcResult.guidanceMessages.slice(1).map(function (msg, gi) {
                      return React.createElement('li', { key: 'g-' + gi }, msg);
                    })
                  )
                : null
            ),
            React.createElement('div', { className: 'run-ftp-modal-body', style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } },
              runFtpCalcResult.success ? React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'mb-4 overflow-x-auto text-xs run-ftp-modal-table-scroll' },
                  React.createElement('table', { className: 'w-full', style: { borderCollapse: 'collapse', minWidth: '640px' } },
                    React.createElement('thead', null,
                      React.createElement('tr', { style: { borderBottom: '2px solid #e2e8f0' } },
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'left', color: '#64748b', fontWeight: 600 } }, '구간'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'center', color: '#64748b', fontWeight: 600 } }, '달성일'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, '기록 페이스'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, '예측 풀코스'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'W'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'Wₙ'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'D'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, '지수'),
                        React.createElement('th', { style: { padding: '8px 4px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, '패널티')
                      )
                    ),
                    React.createElement('tbody', null,
                      (runFtpCalcResult.details || []).map(function (row, idx) {
                        var dateFmt = row.dateStr ? row.dateStr.replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3') : '-';
                        return React.createElement('tr', { key: idx, style: { borderBottom: '1px solid #f1f5f9', opacity: row.used ? 1 : 0.5 } },
                          React.createElement('td', { style: { padding: '6px 4px', color: '#334155', fontWeight: 600 } }, row.label),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'center', color: '#64748b', fontSize: '11px' } }, dateFmt),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: row.used ? '#059669' : '#94a3b8' } }, row.used ? row.paceDisplay : '-'),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: row.used ? '#334155' : '#94a3b8', fontWeight: 600 } }, row.used ? row.predictedMarathonDisplay : '-'),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: '#64748b' } }, row.weight),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: '#64748b' } }, row.used ? row.normalizedWeight : '-'),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: '#64748b' } }, row.used ? row.timeDecay : '-'),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: '#64748b' } }, row.used ? row.finalExponent : '-'),
                          React.createElement('td', { style: { padding: '6px 4px', textAlign: 'right', color: row.fatiguePenalty > 0 ? '#b45309' : '#94a3b8' } }, row.used && row.fatiguePenalty > 0 ? '+' + row.fatiguePenalty.toFixed(2) : '-')
                        );
                      })
                    )
                  ),
                  React.createElement('p', { className: 'text-xs mt-2', style: { color: '#94a3b8' } },
                    'W: 원 가중치 · Wₙ: Valid_W_Sum 기준 재분배 · D: 시간감쇠 · 지수: Riegel(1.06)+연령(' + ftpAgeLabel + ')·성별(' + ftpGenderLabel + ')+패널티 · 예측 풀코스: 42.195km'
                  ),
                  runFtpCalcResult.validWSum != null && runFtpCalcResult.validWSum < 1
                    ? React.createElement('p', { className: 'text-xs mt-1', style: { color: '#64748b' } },
                        '유효 가중치 합(Valid_W_Sum): ',
                        React.createElement('strong', null, Math.round(runFtpCalcResult.validWSum * 100) + '%'),
                        runFtpCalcResult.renormalized ? ' · 누락 구간 제외 후 Normalized 적용' : ''
                      )
                    : null
                ),
                React.createElement('p', { className: 'text-sm mb-1', style: { color: '#475569', lineHeight: 1.6 } },
                  '예상 풀코스(42.195km) 완주 시간은 ',
                  React.createElement('strong', { style: { color: '#059669', fontSize: '1.15em' } }, runFtpCalcResult.marathonDisplay),
                  ' 입니다.'
                ),
                React.createElement('p', { className: 'text-sm mb-2', style: { color: '#475569', lineHeight: 1.6 } },
                  '예상 평균 페이스: ',
                  React.createElement('strong', { style: { color: '#059669' } }, runFtpCalcResult.marathonPaceSummary || runFtpCalcResult.marathonPaceDisplay)
                )
              ) : React.createElement('p', { className: 'text-red-600 mb-2', style: { fontSize: '15px', lineHeight: 1.5 } }, runFtpCalcResult.error)
            )
          )
        );
        })()}
      </div>
    );
  }

  window.RunDashboardRefactored = RunDashboard;
  window.RunDashboard = RunDashboard;
  console.log('[Dashboard] 리팩터링된 RunDashboard 로드 완료');
})();
