/**
 * PerformanceDashboard - 리팩터링된 대시보드 최상위 컴포넌트
 * Level 1: AICoachHeroCard (Hero)
 * Level 2: DailyQuickStats (Quick Stats)
 * Level 3: DashboardDetailTabs (탭 구조)
 *
 * @see docs/대시보드_리팩터링_디렉터리_구조.md
 */
/* global React, useState, useLayoutEffect, useEffect, window */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[PerformanceDashboard] React not loaded');
    return;
  }

  var ReactObj = window.React;
  var useState = ReactObj.useState;
  var useLayoutEffect = ReactObj.useLayoutEffect || ReactObj.useEffect;
  var useEffect = ReactObj.useEffect;

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

  function calculateSpeedOnFlatFallback(power, weight) {
    var P = Number(power);
    var m = Number(weight);
    if (!isFinite(P) || P <= 0 || !isFinite(m) || m <= 0) return 0;
    var rho = 1.225;
    var g = 9.81;
    var crr = 0.0045;
    var cda = 0.328 + (m - 70) * 0.0012;
    if (cda < 0.22) cda = 0.22;
    if (cda > 0.42) cda = 0.42;
    function powerAt(vMs) {
      var aero = 0.5 * rho * cda * vMs * vMs * vMs;
      var roll = crr * m * g * vMs;
      return aero + roll;
    }
    var lo = 0.1;
    var hi = 40;
    var i;
    for (i = 0; i < 55; i++) {
      var mid = (lo + hi) / 2;
      if (powerAt(mid) < P) lo = mid;
      else hi = mid;
    }
    return ((lo + hi) / 2) * 3.6;
  }

  function PerformanceDashboard() {
    var data = typeof window.useDashboardData === 'function' ? window.useDashboardData() : {};

    var userProfile = data.userProfile || null;
    var stats = data.stats || { ftp: 0, wkg: 0, weight: 0, weeklyGoal: 225, weeklyProgress: 0, totalPoints: 0, currentPoints: 0 };
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
    var growthTrendData = data.growthTrendData || [];
    var yearlyPowerPrData = data.yearlyPowerPrData || [];
    var recentLogs = data.recentLogs || [];
    var ftpCalcLoading = data.ftpCalcLoading;
    var setFtpCalcLoading = data.setFtpCalcLoading;
    var ftpModalOpen = data.ftpModalOpen;
    var setFtpModalOpen = data.setFtpModalOpen;
    var ftpCalcResult = data.ftpCalcResult;
    var setFtpCalcResult = data.setFtpCalcResult;
    var setUserProfile = data.setUserProfile;
    var setStats = data.setStats;
    var _aero = useState(false);
    var oneHourAbilityModalOpen = _aero[0];
    var setOneHourAbilityModalOpen = _aero[1];

    var todayYmd = getSeoulTodayYmd();
    var start30Ymd = shiftYmd(todayYmd, -29);
    var ftpVal = Number(
      stats && stats.ftp != null ? stats.ftp :
      userProfile && userProfile.ftp != null ? userProfile.ftp :
      userProfile && userProfile.ftp_watts != null ? userProfile.ftp_watts :
      0
    ) || 0;
    var weightVal = Number(
      stats && stats.weight != null ? stats.weight :
      userProfile && userProfile.weight != null ? userProfile.weight :
      userProfile && userProfile.weightKg != null ? userProfile.weightKg :
      userProfile && userProfile.weight_kg != null ? userProfile.weight_kg :
      0
    ) || 0;
    var last30Peak60Watts = 0;
    var last30PeakDate = '';
    (Array.isArray(recentLogs) ? recentLogs : []).forEach(function(log) {
      var ymd = getSeoulYmdFromUnknown(log && log.date);
      if (!ymd || ymd < start30Ymd || ymd > todayYmd) return;
      var w60 = Number(log && log.max_60min_watts != null ? log.max_60min_watts : 0) || 0;
      if (!(w60 > 0)) {
        var sec = Number(
          log && log.duration_sec != null ? log.duration_sec :
          log && log.time != null ? log.time :
          log && log.duration != null ? log.duration :
          0
        ) || 0;
        if (sec >= 50 * 60) {
          w60 = Number(
            log && log.avg_watts != null ? log.avg_watts :
            log && log.weighted_watts != null ? log.weighted_watts :
            0
          ) || 0;
        }
      }
      if (w60 > last30Peak60Watts) {
        last30Peak60Watts = w60;
        last30PeakDate = ymd;
      }
    });
    var useFallbackFtp93 = !(last30Peak60Watts > 0) && ftpVal > 0;
    var referenceWattsRaw = last30Peak60Watts > 0 ? last30Peak60Watts : useFallbackFtp93 ? ftpVal * 0.93 : 0;
    var referenceWatts = referenceWattsRaw > 0 ? Math.round(referenceWattsRaw * 10) / 10 : 0;
    var calcSpeed = typeof window.calculateSpeedOnFlat === 'function' ? window.calculateSpeedOnFlat : calculateSpeedOnFlatFallback;
    var soloSpeedRaw = calcSpeed && referenceWatts > 0 && weightVal > 0 ? Number(calcSpeed(referenceWatts, weightVal)) : 0;
    var soloSpeed = soloSpeedRaw > 0 ? Math.round(soloSpeedRaw * 10) / 10 : 0;
    var estimatedGroupSpeed = soloSpeed > 0 ? Math.round(soloSpeed * 1.2 * 10) / 10 : 0;
    var referenceWkg = referenceWatts > 0 && weightVal > 0 ? Math.round((referenceWatts / weightVal) * 100) / 100 : 0;
    var oneHourAbilityRangeLabel = start30Ymd && todayYmd ? start30Ymd + ' ~ ' + todayYmd : '';

    // 스크롤 초기화: useLayoutEffect로 DOM 마운트 직후 1회 실행 (기존 setTimeout 4회 폐기)
    useLayoutEffect(function() {
      var container = document.getElementById('performance-dashboard-container');
      if (container) {
        container.scrollTop = 0;
        container.scrollTo(0, 0);
      }
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    }, []);

    var AICoachHeroCard = window.AICoachHeroCard;
    var DailyQuickStats = window.DailyQuickStats;
    var DashboardDetailTabs = window.DashboardDetailTabs;
    var CircularProgress = window.DashboardCircularProgress;
    var WkgGradeIndicator = window.WkgGradeIndicator;
    var DashboardCard = window.DashboardCard;
    if (!DashboardCard) {
      DashboardCard = function(p) {
        return React.createElement('div', { className: 'bg-white rounded-2xl p-4 shadow-sm border border-gray-100' + (p.className ? ' ' + p.className : '') }, p.title && React.createElement('h3', { className: 'text-sm font-semibold text-gray-600 mb-3' }, p.title), p.children);
      };
    }
    if (!WkgGradeIndicator) {
      WkgGradeIndicator = function(p) {
        return React.createElement('div', { className: 'rounded-full bg-gray-200 flex items-center justify-center', style: { width: p.size || 40, height: p.size || 40 } }, React.createElement('span', { className: 'text-gray-600 font-bold' }, p.letter || '-'));
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
              {WkgGradeIndicator && React.createElement(WkgGradeIndicator, {
                wkg: stats.wkg,
                size: 40,
                letter: (stats.wkg != null && stats.wkg !== '') ? Number(stats.wkg).toFixed(2) : '-'
              })}
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

        {/* Level 1: Hero - AICoachHeroCard */}
        <section className="px-4 pt-6">
          {AICoachHeroCard ? (
            React.createElement(AICoachHeroCard, {
              coachData: coachData,
              aiLoading: aiLoading,
              streamingComment: streamingComment,
              runConditionAnalysis: runConditionAnalysis,
              setRunConditionAnalysis: setRunConditionAnalysis,
              setRetryCoach: data.setRetryCoach,
              userProfile: userProfile,
              CircularProgress: CircularProgress
            })
          ) : (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <div className="text-center text-gray-500 text-sm">AICoachHeroCard (구현 예정)</div>
              {coachData && (
                <div className="mt-4">
                  <div className="text-lg font-bold text-gray-900">컨디션: {coachData.condition_score}점</div>
                  <p className="text-sm text-gray-700 mt-2">{streamingComment || coachData.coach_comment}</p>
                  <button
                    type="button"
                    onClick={function() {
                      if (typeof window.runDashboardAIWorkoutRecommendation === 'function') {
                        window.runDashboardAIWorkoutRecommendation(userProfile, coachData);
                      }
                    }}
                    className="mt-4 w-full py-3 bg-blue-500 text-white font-semibold rounded-xl"
                  >
                    추천: {coachData.recommended_workout || 'Active Recovery (Z1)'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Level 2: Quick Stats - DailyQuickStats */}
        <section className="px-4 pt-6">
          {DailyQuickStats ? (
            React.createElement(DailyQuickStats, {
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
                <h3 className="text-sm font-semibold text-gray-600 mb-2">파워</h3>
                <div className="text-2xl font-bold text-gray-900">{stats.ftp}W</div>
                <div className="text-sm text-gray-600">{stats.wkg} W/kg</div>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">주간 목표</h3>
                <div className="text-2xl font-bold text-gray-900">
                  {logsLoading ? '...' : Math.min(Math.round((stats.weeklyProgress / (stats.weeklyGoal || 225)) * 100), 100)}%
                </div>
                <div className="text-sm text-gray-600">{stats.weeklyProgress}/{stats.weeklyGoal || 225} TSS</div>
              </div>
            </div>
          )}
        </section>

        {/* 나의 동적 FTP 산출 카드 (탭 위쪽, 기존 디자인) */}
        <section className="px-4 pt-6">
          {DashboardCard && React.createElement(DashboardCard, {
            title: '나의 동적 FTP 산출',
            className: 'mt-0'
          }, React.createElement(React.Fragment, null,
            React.createElement('ul', { className: 'text-xs text-gray-600 space-y-1.5 mb-4' },
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/clock.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '6개 구간(1, 5, 10, 20, 40, 60분) PR 파워 데이터 종합')
              ),
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/statistics.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '구간별 생리학적 신뢰도 반영 (20분 파워 비중 최대)')
              ),
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/calendar.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '최신 기록 우대 (오래된 기록일수록 반영 비율 감소)')
              )
            ),
            React.createElement('button', {
              type: 'button',
              onClick: async function() {
                if (ftpCalcLoading || !userProfile || !userProfile.id) return;
                setFtpCalcLoading(true);
                setFtpCalcResult(null);
                try {
                  var logs = [];
                  if (typeof window.getUserTrainingLogs === 'function') {
                    logs = await window.getUserTrainingLogs(userProfile.id, { limit: 400 }) || [];
                  }
                  if (logs.length === 0 && window.firestore) {
                    try {
                      var snap = await window.firestore.collection('users').doc(userProfile.id).collection('logs').orderBy('date', 'desc').limit(400).get();
                      snap.docs.forEach(function(d) {
                        var dd = d.data();
                        var o = { id: d.id };
                        if (dd && typeof dd === 'object') { for (var k in dd) { if (dd.hasOwnProperty(k)) o[k] = dd[k]; } }
                        logs.push(o);
                      });
                    } catch (e2) {}
                  }
                  var result = window.calculateDynamicFtp ? window.calculateDynamicFtp(logs) : { success: false, error: 'FTP 산출 함수를 불러올 수 없습니다.' };
                  setFtpCalcResult(result);
                  setFtpModalOpen(true);
                } catch (e) {
                  setFtpCalcResult({ success: false, error: (e && e.message) || 'FTP 산출 중 오류가 발생했습니다.' });
                  setFtpModalOpen(true);
                } finally {
                  setFtpCalcLoading(false);
                }
              },
              disabled: ftpCalcLoading,
              className: ('w-full py-3.5 px-4 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all text-base border-none ') + (ftpCalcLoading ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'),
              style: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', boxShadow: '0 2px 8px rgba(102, 126, 234, 0.35)' }
            }, ftpCalcLoading ? React.createElement('span', { className: 'flex items-center justify-center gap-2' },
              React.createElement('span', { className: 'w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin' }),
              '산출 중...'
            ) : 'FTP 산출하기')
          ))}
        </section>

        <section className="px-4 pt-4">
          {DashboardCard && React.createElement(DashboardCard, {
            title: '나의 1시간 항속 능력 산출',
            className: 'mt-0'
          }, React.createElement(React.Fragment, null,
            React.createElement('ul', { className: 'text-xs text-gray-600 space-y-1.5 mb-4' },
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/statistics.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '산출 기준: 항속')
              ),
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/calendar.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '현실 지표: 최근 30일 · 60분 최대 평균 파워 · 체중 반영')
              ),
              React.createElement('li', { className: 'flex items-start gap-2' },
                React.createElement('img', { src: 'assets/img/clock.png', alt: '', className: 'w-4 h-4 mt-0.5 flex-shrink-0 object-contain', width: 16, height: 16, decoding: 'async' }),
                React.createElement('span', null, '60분 피크가 없으면 FTP 기반 평속에 93%를 반영해 표기')
              )
            ),
            React.createElement('button', {
              type: 'button',
              onClick: function() { setOneHourAbilityModalOpen(true); },
              className: 'w-full py-3.5 px-4 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all text-base border-none cursor-pointer',
              style: { background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', boxShadow: '0 2px 8px rgba(79, 70, 229, 0.35)' }
            }, '1시간 항속능력 산출하기')
          ))}
        </section>

        {/* Level 3: Deep Dive - DashboardDetailTabs */}
        <section className="px-4 py-6 pb-32">
          {DashboardDetailTabs ? (
            React.createElement(DashboardDetailTabs, {
              userProfile: userProfile,
              recentLogs: recentLogs,
              fitnessData: fitnessData,
              vo2TrendData: vo2TrendData,
              growthTrendData: growthTrendData,
              yearlyPowerPrData: yearlyPowerPrData,
              stats: stats,
              logsLoading: logsLoading,
              logsLoadError: logsLoadError,
              retryLogsRef: retryLogsRef,
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

        {/* FTP 산출 결과 모달 (기존 로직 연동) */}
        {ftpModalOpen && ftpCalcResult && React.createElement(
          'div',
          {
            className: 'fixed inset-0 z-[10001] flex items-center justify-center p-4 overflow-y-auto',
            style: { background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' },
            onClick: function(e) { if (e.target === e.currentTarget) setFtpModalOpen(false); }
          },
          React.createElement(
            'div',
            {
              className: 'w-full max-w-md my-4 bg-white rounded-2xl overflow-hidden shadow-xl border border-purple-100',
              style: { padding: '24px 28px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
              onClick: function(e) { e.stopPropagation(); }
            },
            React.createElement('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } },
              React.createElement('h3', { className: 'text-lg font-semibold mb-2 text-gray-800', style: { borderBottom: '2px solid #667eea', paddingBottom: '10px' } }, '동적 FTP 산출 결과'),
              React.createElement('label', { className: 'flex items-center gap-2 mb-3 text-sm text-gray-600 cursor-pointer' },
                React.createElement('input', { type: 'checkbox', id: 'dynamicFtpDontShow10DaysReact' }),
                React.createElement('span', null, '10일 동안 보이지 않음')
              ),
              ftpCalcResult.success ? React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'mb-4 overflow-x-auto text-xs' },
                  React.createElement('table', { className: 'w-full', style: { borderCollapse: 'collapse' } },
                    React.createElement('thead', null,
                      React.createElement('tr', { style: { borderBottom: '2px solid #e2e8f0' } },
                        React.createElement('th', { style: { padding: '8px 6px', textAlign: 'left', color: '#64748b', fontWeight: 600 } }, '구간'),
                        React.createElement('th', { style: { padding: '8px 6px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'PR(W)'),
                        React.createElement('th', { style: { padding: '8px 6px', textAlign: 'center', color: '#64748b', fontWeight: 600 } }, '달성일'),
                        React.createElement('th', { style: { padding: '8px 6px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'eFTP'),
                        React.createElement('th', { style: { padding: '8px 6px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'W'),
                        React.createElement('th', { style: { padding: '8px 6px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'D'),
                        React.createElement('th', { style: { padding: '8px 6px', textAlign: 'right', color: '#64748b', fontWeight: 600 } }, 'W×D')
                      )
                    ),
                    React.createElement('tbody', null,
                      (ftpCalcResult.details || []).map(function(row, idx) {
                        var appliedW = (row.weight || 0) * (row.timeDecay || 0);
                        var dateFmt = row.dateStr ? row.dateStr.replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3') : '-';
                        return React.createElement('tr', { key: idx, style: { borderBottom: '1px solid #f1f5f9', opacity: row.used ? 1 : 0.5 } },
                          React.createElement('td', { style: { padding: '6px', color: '#334155' } }, row.minutes + '분'),
                          React.createElement('td', { style: { padding: '6px', textAlign: 'right', color: row.used ? '#667eea' : '#94a3b8' } }, row.power > 0 ? row.power : '-'),
                          React.createElement('td', { style: { padding: '6px', textAlign: 'center', color: '#64748b', fontSize: '11px' } }, dateFmt),
                          React.createElement('td', { style: { padding: '6px', textAlign: 'right', color: row.used ? '#334155' : '#94a3b8' } }, row.used ? row.eFtp : '-'),
                          React.createElement('td', { style: { padding: '6px', textAlign: 'right', color: '#64748b' } }, row.weight),
                          React.createElement('td', { style: { padding: '6px', textAlign: 'right', color: '#64748b' } }, row.used ? row.timeDecay : '-'),
                          React.createElement('td', { style: { padding: '6px', textAlign: 'right', color: row.used ? '#667eea' : '#94a3b8', fontWeight: 600 } }, row.used ? appliedW.toFixed(2) : '-')
                        );
                      })
                    )
                  ),
                  React.createElement('p', { className: 'text-xs mt-2', style: { color: '#94a3b8' } }, 'W: 신뢰도 가중치 · D: 시간감쇠(최신 우대) · W×D: 최종 적용 가중치')
                ),
                React.createElement('p', { className: 'text-sm mb-5', style: { color: '#475569', lineHeight: 1.6 } },
                  '새롭게 산출된 예상 FTP는 ',
                  React.createElement('strong', { style: { color: '#667eea', fontSize: '1.1em' } }, ftpCalcResult.newFtp + 'W'),
                  ' 입니다. 이 값을 현재 나의 FTP로 업데이트 하시겠습니까?'
                )
              ) : React.createElement('p', { className: 'text-red-600 mb-5', style: { fontSize: '15px', lineHeight: 1.5 } }, ftpCalcResult.error)
            ),
            React.createElement('div', { className: 'flex gap-3 mt-4 pt-4 border-t border-gray-200' },
              ftpCalcResult.success ? React.createElement(React.Fragment, null,
                React.createElement('button', {
                  type: 'button',
                  onClick: function() {
                    var cb = document.getElementById('dynamicFtpDontShow10DaysReact');
                    if (cb && cb.checked && userProfile && userProfile.id && typeof window.setDynamicFtpCooldown === 'function') window.setDynamicFtpCooldown(userProfile.id);
                    setFtpModalOpen(false);
                    setFtpCalcResult(null);
                  },
                  className: 'flex-1 py-3 px-4 text-sm font-semibold rounded-xl bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 transition-colors'
                }, '취소'),
                React.createElement('button', {
                  type: 'button',
                  onClick: async function() {
                    if (!userProfile || !userProfile.id || !ftpCalcResult.newFtp) return;
                    try {
                      var res = await (window.apiUpdateUser || function() { return Promise.resolve({ success: false, error: '함수 없음' }); })(userProfile.id, { ftp: ftpCalcResult.newFtp });
                      if (res && res.success) {
                        var cb = document.getElementById('dynamicFtpDontShow10DaysReact');
                        if (cb && cb.checked && typeof window.setDynamicFtpCooldown === 'function') window.setDynamicFtpCooldown(userProfile.id);
                        if (typeof setUserProfile === 'function') setUserProfile(function(prev) { return prev ? Object.assign({}, prev, { ftp: ftpCalcResult.newFtp }) : prev; });
                        if (typeof setStats === 'function') setStats(function(prev) { return prev ? Object.assign({}, prev, { ftp: ftpCalcResult.newFtp }) : prev; });
                        setFtpModalOpen(false);
                        setFtpCalcResult(null);
                        var cur = window.currentUser;
                        if (cur) { cur.ftp = ftpCalcResult.newFtp; try { localStorage.setItem('currentUser', JSON.stringify(cur)); } catch (e) {} }
                        if (typeof window.userFTP !== 'undefined') window.userFTP = ftpCalcResult.newFtp;
                        if (typeof showToast === 'function') showToast('성공적으로 반영되었습니다', 'success');
                      } else {
                        alert((res && res.error) || '업데이트에 실패했습니다.');
                      }
                    } catch (e) {
                      alert((e && e.message) || '업데이트 중 오류가 발생했습니다.');
                    }
                  },
                  className: 'flex-1 py-3 px-4 text-sm font-semibold rounded-xl text-white',
                  style: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', boxShadow: '0 2px 8px rgba(102, 126, 234, 0.35)' }
                }, 'FTP 업데이트')
              ) : React.createElement('button', {
                type: 'button',
                onClick: function() {
                  var cb = document.getElementById('dynamicFtpDontShow10DaysReact');
                  if (cb && cb.checked && userProfile && userProfile.id && typeof window.setDynamicFtpCooldown === 'function') window.setDynamicFtpCooldown(userProfile.id);
                  setFtpModalOpen(false);
                  setFtpCalcResult(null);
                },
                className: 'w-full py-3 px-4 text-sm font-semibold rounded-xl text-white',
                style: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', boxShadow: '0 2px 8px rgba(102, 126, 234, 0.35)' }
              }, '확인')
            )
          )
        )}

        {oneHourAbilityModalOpen && React.createElement(
          'div',
          {
            className: 'fixed inset-0 z-[10002] flex items-center justify-center p-4 overflow-y-auto',
            style: { background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' },
            onClick: function(e) { if (e.target === e.currentTarget) setOneHourAbilityModalOpen(false); }
          },
          React.createElement(
            'div',
            {
              className: 'w-full max-w-md my-4 bg-white rounded-2xl overflow-hidden shadow-xl border border-violet-100',
              style: { padding: '24px 20px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
              onClick: function(e) { e.stopPropagation(); }
            },
            React.createElement('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } },
              React.createElement('h3', { className: 'text-lg font-semibold mb-2 text-gray-800', style: { borderBottom: '2px solid #7c3aed', paddingBottom: '10px' } }, '나의 1시간 항속 능력 산출'),
              React.createElement('p', { className: 'text-[11px] text-slate-600 mt-0 mb-3 leading-relaxed' },
                '라이딩 모임 > 맞춤 필터 설정 > 현실 지표(30일, 60분 최대 평균 파워, 체중 반영)와 동일 로직입니다.'
              ),
              React.createElement('p', { className: 'text-[10px] font-semibold text-slate-800 m-0 pb-2 border-b border-violet-100/80' },
                '현실 지표 (최근 30일 · 60분 최대 평균 파워·체중, 랭킹보드와 동일 산출)',
                oneHourAbilityRangeLabel ? React.createElement('span', { className: 'font-normal text-slate-500' }, ' · ' + oneHourAbilityRangeLabel) : null
              ),
              weightVal > 0 && (last30Peak60Watts > 0 || ftpVal > 0) ? React.createElement(
                'div',
                { className: 'grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs mt-3' },
                React.createElement('div', { className: 'rounded-lg bg-white/90 border border-slate-200 px-2 py-1.5' },
                  React.createElement('div', { className: 'text-slate-500 text-[10px]' }, useFallbackFtp93 ? '기준 파워 (FTP×93%)' : '60분 최고 평균 파워'),
                  React.createElement('div', { className: 'font-semibold text-slate-800 tabular-nums' }, referenceWatts > 0 ? referenceWatts + ' W' : '-')
                ),
                React.createElement('div', { className: 'rounded-lg bg-white/90 border border-slate-200 px-2 py-1.5' },
                  React.createElement('div', { className: 'text-slate-500 text-[10px]' }, '체중 (프로필)'),
                  React.createElement('div', { className: 'font-semibold text-slate-800 tabular-nums' }, weightVal + ' kg')
                ),
                React.createElement('div', { className: 'rounded-lg bg-white/90 border border-slate-200 px-2 py-1.5 col-span-2 sm:col-span-1' },
                  React.createElement('div', { className: 'text-slate-500 text-[10px]' }, useFallbackFtp93 ? 'W/kg (FTP×93%)' : 'W/kg (60분 피크)'),
                  React.createElement('div', { className: 'font-semibold text-indigo-700 tabular-nums' }, referenceWkg > 0 ? referenceWkg.toFixed(2) : '-')
                ),
                React.createElement('div', {
                  className: 'rounded-xl border px-3 py-3 col-span-2 sm:col-span-3 open-riding-filter-realistic-solo-highlight',
                  style: {
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(124,58,237,0.08) 100%)',
                    borderColor: 'rgba(99,102,241,0.35)',
                    boxShadow: '0 8px 20px rgba(99,102,241,0.12)'
                  }
                },
                  React.createElement('div', { className: 'text-indigo-900 text-[11px] font-semibold' }, useFallbackFtp93 ? '평지 개인 평속 (FTP×93% 투입) — 현실 지표 핵심' : '평지 개인 평속 (60분 피크 투입) — 현실 지표 핵심'),
                  React.createElement('div', { className: 'font-extrabold text-indigo-950 tabular-nums text-4xl leading-none mt-1 tracking-tight' }, soloSpeed > 0 ? soloSpeed.toFixed(1) : '-'),
                  React.createElement('div', { className: 'text-indigo-800 text-sm font-bold mt-1' }, 'km/h')
                ),
                React.createElement('div', { className: 'rounded-lg bg-white/90 border border-slate-200 px-2 py-1.5 col-span-2 sm:col-span-3' },
                  React.createElement('div', { className: 'text-slate-500 text-[10px]' }, '예상 그룹 평속 (×1.2)'),
                  React.createElement('div', { className: 'font-semibold text-slate-800 tabular-nums' }, estimatedGroupSpeed > 0 ? estimatedGroupSpeed + ' km/h' : '-')
                ),
                useFallbackFtp93 ? React.createElement('p', { className: 'col-span-2 sm:col-span-3 text-[10px] text-slate-500 m-0 leading-snug' },
                  '최근 30일 60분 피크가 없어 최대 능력치(프로필 FTP·체중)를 사용했고, 맞춤 필터 기준과 동일하게 FTP 기반 평속의 93%를 반영했습니다.'
                ) : React.createElement('p', { className: 'col-span-2 sm:col-span-3 text-[10px] text-slate-500 m-0 leading-snug' },
                  last30PeakDate ? ('60분 피크 반영일: ' + last30PeakDate) : '최근 30일 60분 피크를 반영했습니다.'
                )
              ) : React.createElement('p', { className: 'text-[11px] text-slate-500 m-0 leading-snug mt-3' },
                '프로필에 FTP·체중을 저장하면 1시간 항속 현실 지표를 계산해 표시합니다.'
              )
            ),
            React.createElement('div', { className: 'mt-4 pt-4 border-t border-gray-200' },
              React.createElement('button', {
                type: 'button',
                onClick: function() { setOneHourAbilityModalOpen(false); },
                className: 'w-full py-3 px-4 text-sm font-semibold rounded-xl text-white',
                style: { background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', boxShadow: '0 2px 8px rgba(79, 70, 229, 0.35)' }
              }, '확인')
            )
          )
        )}
      </div>
    );
  }

  window.PerformanceDashboardRefactored = PerformanceDashboard;
  window.PerformanceDashboard = PerformanceDashboard;
  console.log('[Dashboard] 리팩터링된 PerformanceDashboard 로드 완료');
})();
