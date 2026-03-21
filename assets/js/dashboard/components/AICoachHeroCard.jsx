/**
 * AICoachHeroCard - AI 컨디션 분석 Hero 섹션
 * Strava/Garmin 수준의 프리미엄 디자인
 * - 점수 구간별 색상 Circular Progress
 * - 인용구 스타일 코멘트 박스
 * - Primary CTA 버튼
 */
/* global React, window */

(function() {
  'use strict';

  if (!window.React) {
    console.warn('[AICoachHeroCard] React not loaded');
    return;
  }

  var React = window.React;

  function getScoreColor(score) {
    if (score >= 85) return { fill: '#059669', bg: 'rgba(5, 150, 105, 0.12)', label: '최상' };
    if (score >= 75) return { fill: '#0891b2', bg: 'rgba(8, 145, 178, 0.12)', label: '양호' };
    if (score >= 65) return { fill: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)', label: '보통' };
    if (score >= 50) return { fill: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', label: '주의' };
    return { fill: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', label: '회복 필요' };
  }

  function HeroCircularProgress(props) {
    var value = Math.min(100, Math.max(0, Number(props.value) || 0));
    var size = props.size || 140;
    var strokeWidth = props.strokeWidth || 10;
    var colors = getScoreColor(value);
    var radius = (size - strokeWidth) / 2;
    var circumference = 2 * Math.PI * radius;
    var offset = circumference - (value / 100) * circumference;

    return React.createElement(
      'div',
      { className: 'relative inline-flex items-center justify-center', style: { width: size, height: size } },
      React.createElement(
        'svg',
        { width: size, height: size, className: 'transform -rotate-90', style: { filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.06))' } },
        React.createElement('circle', {
          cx: size / 2,
          cy: size / 2,
          r: radius,
          stroke: '#e5e7eb',
          strokeWidth: strokeWidth,
          fill: 'none'
        }),
        React.createElement('circle', {
          cx: size / 2,
          cy: size / 2,
          r: radius,
          stroke: colors.fill,
          strokeWidth: strokeWidth,
          fill: 'none',
          strokeDasharray: circumference,
          strokeDashoffset: offset,
          strokeLinecap: 'round',
          className: 'transition-all duration-700 ease-out'
        })
      ),
      React.createElement(
        'div',
        { className: 'absolute inset-0 flex items-center justify-center flex-col' },
        React.createElement('span', {
          className: 'font-bold tabular-nums',
          style: { fontSize: size * 0.28, color: colors.fill, lineHeight: 1, letterSpacing: '-0.02em' }
        }, Math.round(value)),
        React.createElement('span', {
          className: 'text-xs font-medium mt-0.5',
          style: { color: colors.fill, opacity: 0.9 }
        }, colors.label)
      )
    );
  }

  function AICoachHeroCard(props) {
    var p = props || {};
    var coachData = p.coachData;
    var aiLoading = p.aiLoading;
    var streamingComment = p.streamingComment;
    var setRunConditionAnalysis = p.setRunConditionAnalysis;
    var setRetryCoach = p.setRetryCoach;
    var userProfile = p.userProfile || {};
    var CircularProgress = p.CircularProgress;

    if (aiLoading) {
      return React.createElement(
        'div',
        { className: 'rounded-2xl p-8 shadow-lg border border-gray-100 overflow-hidden', style: { background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 50%, #f0f9ff 100%)' } },
        React.createElement('div', { className: 'text-center py-10' },
          React.createElement('div', {
            className: 'w-20 h-20 mx-auto mb-4 rounded-full border-4 border-emerald-200 border-t-emerald-500 animate-spin'
          }),
          React.createElement('div', { className: 'text-base font-semibold text-gray-700' }, 'AI가 컨디션을 분석하고 있습니다'),
          React.createElement('div', { className: 'text-sm text-gray-500 mt-1' }, '잠시만 기다려 주세요...')
        )
      );
    }

    if (!coachData) {
      return React.createElement(
        'div',
        { className: 'rounded-2xl p-8 shadow-lg border border-gray-100', style: { background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)' } },
        React.createElement('div', { className: 'text-center py-6' },
          React.createElement('div', { className: 'text-5xl mb-4' }, '🧠'),
          React.createElement('div', { className: 'text-lg font-semibold text-gray-800 mb-2' }, '컨디션 분석하기'),
          React.createElement('p', { className: 'text-sm text-gray-500 mb-6 max-w-xs mx-auto' }, '훈련 데이터를 분석해 오늘의 추천 워크아웃을 알려드립니다'),
          React.createElement('button', {
            type: 'button',
            onClick: function() { if (typeof setRunConditionAnalysis === 'function') setRunConditionAnalysis(true); },
            className: 'px-6 py-3.5 rounded-xl font-semibold text-white transition-all active:scale-[0.98] shadow-md hover:shadow-lg border-none cursor-pointer',
            style: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', boxShadow: '0 2px 8px rgba(102, 126, 234, 0.35)' }
          }, '컨디션 분석 하기')
        )
      );
    }

    var score = Number(coachData.condition_score) || 50;
    var colors = getScoreColor(score);
    var commentText = streamingComment || coachData.coach_comment || '';
    var workoutType = coachData.recommended_workout || 'Active Recovery (Z1)';
    var hasError = !!(coachData.error_reason);

    var CircularEl = CircularProgress && typeof CircularProgress === 'function'
      ? React.createElement(CircularProgress, { value: score, size: 140, strokeWidth: 10 })
      : React.createElement(HeroCircularProgress, { value: score, size: 140, strokeWidth: 10 });

    var ftpCardTone = {
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      shadow: '0 4px 16px rgba(102, 126, 234, 0.25), 0 1px 3px rgba(0,0,0,0.04)',
      border: '1px solid rgba(102, 126, 234, 0.2)',
      accentBg: 'rgba(102, 126, 234, 0.08)'
    };

    return React.createElement(
      'div',
      {
        className: 'rounded-2xl overflow-hidden shadow-lg border',
        style: {
          background: 'linear-gradient(160deg, ' + ftpCardTone.accentBg + ' 0%, rgba(255,255,255,0.98) 45%)',
          borderColor: ftpCardTone.border,
          boxShadow: ftpCardTone.shadow
        }
      },
      React.createElement('div', { className: 'p-6 sm:p-8' },
        React.createElement('div', { className: 'flex flex-col items-center' },
          React.createElement('div', { className: 'mb-6' }, CircularEl),
          React.createElement('div', { className: 'text-center mb-1' },
            React.createElement('span', {
              className: 'text-sm font-semibold px-3 py-1 rounded-full',
              style: { backgroundColor: colors.bg, color: colors.fill }
            }, coachData.training_status || 'Building Base')
          ),
          (coachData.vo2max_estimate != null && coachData.vo2max_estimate > 0) && React.createElement('div', { className: 'text-xs text-gray-500 mb-6' },
            'VO₂max 추정: ' + coachData.vo2max_estimate + ' ml/kg/min'
          )
        ),
        React.createElement(
          'div',
          {
            className: 'relative rounded-2xl p-5 mb-6',
            style: {
              background: 'rgba(248, 250, 252, 0.9)',
              borderLeft: '4px solid #667eea',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)'
            }
          },
          React.createElement('div', { className: 'absolute top-4 left-4 text-2xl opacity-30', style: { color: '#667eea' } }, '"'),
          React.createElement('p', {
            className: 'text-sm text-gray-800 leading-relaxed pl-2 pr-2 whitespace-pre-wrap',
            style: { fontFamily: 'inherit', lineHeight: 1.7 }
          }, commentText, streamingComment && React.createElement('span', {
            className: 'inline-block w-2 h-4 ml-0.5 align-middle bg-blue-500 animate-pulse'
          }))
        ),
        hasError && React.createElement('div', {
          className: 'mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200'
        },
          React.createElement('p', { className: 'text-xs text-amber-800' }, '원인: ' + (coachData.error_reason || '')),
          (String(coachData.error_reason || '').indexOf('API 키') !== -1 || String(coachData.error_reason || '').indexOf('geminiApiKey') !== -1) &&
          React.createElement('p', { className: 'text-xs text-gray-600 mt-1' }, '환경 설정에서 Gemini API 키를 입력한 뒤 "다시 분석"을 눌러 주세요.')
        ),
        React.createElement('div', { className: 'flex flex-col sm:flex-row gap-3' },
          React.createElement('button', {
            type: 'button',
            onClick: function() {
              if (typeof window.runDashboardAIWorkoutRecommendation === 'function') {
                window.runDashboardAIWorkoutRecommendation(userProfile, coachData);
              }
            },
            className: 'flex-1 py-3.5 px-4 rounded-xl font-semibold text-white text-center transition-all active:scale-[0.98] min-h-[52px] flex items-center justify-center gap-2.5 shadow-md hover:shadow-lg border-none cursor-pointer',
            style: {
              background: hasError ? 'linear-gradient(135deg, #64748b 0%, #475569 100%)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              boxShadow: hasError ? '0 4px 12px rgba(100,116,139,0.25)' : '0 2px 8px rgba(102, 126, 234, 0.35)'
            }
          },
            React.createElement('span', { className: 'flex flex-col items-center leading-tight text-center' },
              React.createElement('span', { className: 'text-sm' }, '추천 워크 아웃'),
              React.createElement('span', { className: 'text-base font-bold' }, workoutType)
            )
          ),
          hasError && React.createElement('button', {
            type: 'button',
            onClick: function() {
              try {
                var prefix = 'coach_analysis_v3_' + (userProfile.id || '') + '_';
                Object.keys(localStorage).forEach(function(k) {
                  if (k.indexOf(prefix) === 0) localStorage.removeItem(k);
                });
              } catch (e) {}
              if (typeof setRetryCoach === 'function') setRetryCoach(function(prev) { return (prev || 0) + 1; });
              if (typeof setRunConditionAnalysis === 'function') setRunConditionAnalysis(true);
            },
            className: 'py-3.5 px-5 rounded-2xl font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 active:scale-[0.98] min-h-[52px]'
          }, '다시 분석')
        )
      )
    );
  }

  window.AICoachHeroCard = AICoachHeroCard;
})();
