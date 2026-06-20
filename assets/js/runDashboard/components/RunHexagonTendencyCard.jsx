/**
 * RUN 나의 성향 — STELVIO 헥사곤(역량·주주 성향) 분석 카드
 * analyzeStelvioHexagon 엔진 결과 시각화
 */
/* global React, useMemo, useState, useEffect, window */
(function () {
  'use strict';
  if (!window.React) return;

  var React = window.React;
  var useMemo = React.useMemo;
  var useState = React.useState;
  var useEffect = React.useEffect;

  function axisAngle(i, n) {
    return -Math.PI / 2 + (i * 2 * Math.PI) / n;
  }

  function radarPolygonPoints(ratioArr, cx, cy, rMax) {
    var n = ratioArr && ratioArr.length ? ratioArr.length : 0;
    var pts = [];
    var i;
    for (i = 0; i < n; i++) {
      var t = axisAngle(i, n);
      var ri = (ratioArr[i] != null ? ratioArr[i] : 0.1) * rMax;
      pts.push([cx + ri * Math.cos(t), cy + ri * Math.sin(t)]);
    }
    return pts;
  }

  function pathFromPoints(pts) {
    if (!pts.length) return '';
    var s = 'M ' + pts[0][0].toFixed(2) + ' ' + pts[0][1].toFixed(2);
    var j;
    for (j = 1; j < pts.length; j++) {
      s += ' L ' + pts[j][0].toFixed(2) + ' ' + pts[j][1].toFixed(2);
    }
    return s + ' Z';
  }

  function RunHexagonTendencyCard(props) {
    var p = props || {};
    var hexagonContext = p.hexagonContext;
    var peakPerformances = p.peakPerformances;
    var userProfile = p.userProfile;
    var stats = p.stats || {};
    var DashboardCard = p.DashboardCard;

    var _ai = useState('');
    var aiComment = _ai[0];
    var setAiComment = _ai[1];
    var _aiLoad = useState(false);
    var aiLoading = _aiLoad[0];
    var setAiLoading = _aiLoad[1];
    var _aiErr = useState(false);
    var aiError = _aiErr[0];
    var setAiError = _aiErr[1];
    var _runAi = useState(false);
    var runAICommentAnalysis = _runAi[0];
    var setRunAICommentAnalysis = _runAi[1];

    var analysis = useMemo(function () {
      if (typeof window.analyzeStelvioHexagon !== 'function') return null;
      var paceInput = null;
      if (peakPerformances && typeof window.buildPaceDataInputFromPeakMap === 'function') {
        paceInput = window.buildPaceDataInputFromPeakMap(peakPerformances);
      } else if (hexagonContext && typeof window.buildPaceDataInputFromHexagonContext === 'function') {
        paceInput = window.buildPaceDataInputFromHexagonContext(hexagonContext);
      }
      if (!paceInput) return null;
      return window.analyzeStelvioHexagon(paceInput);
    }, [hexagonContext, peakPerformances]);

    useEffect(
      function fetchRunInsightComment() {
        if (!analysis || analysis.runnerTypeId === 'insufficient_data' || !userProfile || !userProfile.id) return;
        var isMounted = true;
        var todayStr =
          typeof window.getTodayStrForCache === 'function'
            ? window.getTodayStrForCache()
            : (function () {
                var d = new Date();
                return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
              })();
        var hexSig =
          typeof window.buildRunHexagonInsightSignature === 'function'
            ? window.buildRunHexagonInsightSignature(analysis)
            : '';

        if (!runAICommentAnalysis) {
          var cached =
            typeof window.getDashboardAIRunningInsightCache === 'function'
              ? window.getDashboardAIRunningInsightCache(userProfile.id, todayStr, hexSig)
              : null;
          if (cached && cached.text) {
            setAiComment(cached.text);
            setAiError(false);
          }
          return function () {
            isMounted = false;
          };
        }

        setAiLoading(true);
        setAiError(false);
        (async function () {
          try {
            var cachedHit =
              typeof window.getDashboardAIRunningInsightCache === 'function'
                ? window.getDashboardAIRunningInsightCache(userProfile.id, todayStr, hexSig)
                : null;
            if (cachedHit && cachedHit.text) {
              if (isMounted) {
                setAiComment(cachedHit.text);
                setAiError(false);
              }
            } else {
              var profileForAi = Object.assign({}, userProfile, {
                threshold_pace: stats.thresholdPaceDisplay || stats.thresholdPaceValue || userProfile.threshold_pace,
                vo2max_estimate: stats.vo2maxEstimate != null ? stats.vo2maxEstimate : userProfile.vo2max_estimate
              });
              var fetchFn = window.fetchRunProfileInsightAnalysis;
              if (typeof fetchFn !== 'function') {
                throw new Error('fetchRunProfileInsightAnalysis 없음');
              }
              var text = await fetchFn(analysis, profileForAi, { timeoutMs: 12000, maxRetries: 2 });
              if (isMounted) {
                setAiComment(text);
                setAiError(false);
                if (typeof window.setDashboardAIRunningInsightCache === 'function') {
                  window.setDashboardAIRunningInsightCache(userProfile.id, todayStr, hexSig, text);
                }
              }
            }
          } catch (e) {
            console.warn('[RunHexagonTendencyCard] AI 인사이트 실패:', e);
            if (isMounted) {
              var fallback =
                typeof window.buildDeterministicRunInsight === 'function'
                  ? window.buildDeterministicRunInsight(analysis, userProfile)
                  : window.FALLBACK_RUN_INSIGHT || '분석을 불러올 수 없습니다.';
              setAiComment(fallback);
              setAiError(true);
            }
          } finally {
            if (isMounted) {
              setAiLoading(false);
              setRunAICommentAnalysis(false);
            }
          }
        })();
        return function () {
          isMounted = false;
        };
      },
      [analysis, runAICommentAnalysis, userProfile, stats.thresholdPaceDisplay, stats.thresholdPaceValue, stats.vo2maxEstimate]
    );

    var svg = useMemo(function () {
      if (!analysis || !analysis.radarScoreNorms || !analysis.radarScoreNorms.length) return null;
      var cx = 100;
      var cy = 100;
      var rLabel = 88;
      var rMax = 70;
      var nAxis = analysis.radarScoreNorms.length;
      var mPts = pathFromPoints(radarPolygonPoints(analysis.radarScoreNorms, cx, cy, rMax));
      var grid = [0.25, 0.5, 0.75, 1].map(function (g) {
        var gr = [];
        var gi;
        for (gi = 0; gi < nAxis; gi++) gr.push(g);
        return pathFromPoints(radarPolygonPoints(gr, cx, cy, rMax));
      });
      var fillGradId = 'run-tendency-hex-fill';

      return (
        <svg viewBox="0 0 200 200" className="w-full h-[240px] touch-manipulation stelvio-run-hexagon-radar-svg" role="img" aria-label="STELVIO 헥사곤 역량 프로필">
          <defs>
            <radialGradient id={fillGradId} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={rMax * 1.02} fx={cx} fy={cy}>
              <stop offset="0%" stopColor="rgb(236, 253, 245)" stopOpacity={0.95} />
              <stop offset="38%" stopColor="rgb(167, 243, 208)" stopOpacity={0.72} />
              <stop offset="72%" stopColor="rgb(52, 211, 153)" stopOpacity={0.62} />
              <stop offset="100%" stopColor="rgb(5, 150, 105)" stopOpacity={0.78} />
            </radialGradient>
          </defs>
          {grid.map(function (d, idx) {
            return <path key={'g-' + idx} d={d} fill="none" stroke="rgba(148, 163, 184, 0.35)" strokeWidth="0.6" />;
          })}
          {analysis.hexagonDataset.map(function (pt, ai) {
            var t = axisAngle(ai, nAxis);
            return (
              <line key={pt.key + '-spoke'} x1={cx} y1={cy} x2={cx + rLabel * 1.05 * Math.cos(t)} y2={cy + rLabel * 1.05 * Math.sin(t)} stroke="rgba(148, 163, 184, 0.45)" strokeWidth="0.5" />
            );
          })}
          <path d={mPts} fill={'url(#' + fillGradId + ')'} stroke="rgb(5, 150, 105)" strokeWidth="2.2" strokeLinejoin="round" className="stelvio-run-hexagon-radar-fill" />
          {analysis.hexagonDataset.map(function (pt, ai) {
            var t = axisAngle(ai, nAxis);
            var lx = cx + rLabel * Math.cos(t);
            var ly = cy + rLabel * Math.sin(t);
            return (
              <text key={pt.key + '-lbl'} x={lx} y={ly} textAnchor="middle" className="fill-slate-800">
                <tspan x={lx} dy="0" style={{ fontSize: '9.5px', fontWeight: 600 }}>{pt.label}</tspan>
                <tspan x={lx} dy="11" style={{ fontSize: '7.5px', fill: '#64748b' }}>
                  {pt.score != null ? Math.round(pt.score) + '점' : '—'}
                </tspan>
              </text>
            );
          })}
        </svg>
      );
    }, [analysis]);

    var body = null;
    if (!analysis || analysis.runnerTypeId === 'insufficient_data') {
      body = (
        <div className="py-8 px-3 text-center text-sm text-gray-500">
          최근 90일 1k~20k Peak 페이스가 3구간 이상 필요합니다.<br />
          <span className="text-xs text-gray-400 mt-1 inline-block">구간 PR·레이스 기록을 쌓으면 성향 분석이 표시됩니다.</span>
        </div>
      );
    } else {
      body = (
        <div>
          <div className="flex items-center justify-center max-w-[360px] mx-auto">{svg}</div>
          <div className="mt-3 px-1 space-y-3">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2.5">
              <div className="text-xs font-semibold text-emerald-800 mb-0.5">나의 러너 유형</div>
              <div className="text-sm font-bold text-gray-900">{analysis.runnerType}</div>
              {analysis.fatigueFactorP != null ? (
                <div className="text-[11px] text-emerald-700 mt-1 tabular-nums">
                  Riegel p = {analysis.fatigueFactorP.toFixed(3)}
                  <span className="text-gray-500 ml-1">(기준 1.06)</span>
                </div>
              ) : null}
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{analysis.description}</p>
            {analysis.recommendations && analysis.recommendations.length ? (
              <ul className="text-xs text-gray-600 space-y-1.5 list-disc pl-4">
                {analysis.recommendations.map(function (rec, ri) {
                  return <li key={'rec-' + ri}>{rec}</li>;
                })}
              </ul>
            ) : null}
            <table className="w-full text-xs border-collapse mt-2">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="py-1 text-left font-medium">구간</th>
                  <th className="py-1 text-right font-medium">페이스</th>
                  <th className="py-1 text-right font-medium">역량</th>
                </tr>
              </thead>
              <tbody>
                {analysis.hexagonDataset.map(function (pt) {
                  return (
                    <tr key={'row-' + pt.key} className="border-b border-gray-50">
                      <td className="py-1.5 text-gray-800 font-medium">{pt.label}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-600">{pt.paceDisplay || '—'}</td>
                      <td className="py-1.5 text-right tabular-nums font-semibold text-emerald-700">{pt.score != null ? Math.round(pt.score) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    var aiCoachBlock =
      analysis && analysis.runnerTypeId !== 'insufficient_data'
        ? React.createElement(
            'div',
            {
              className: 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm',
              style: { backgroundColor: 'rgba(249, 250, 251, 0.95)', minHeight: '80px' }
            },
            React.createElement(
              'div',
              { className: 'flex items-center gap-2 mb-3' },
              React.createElement(
                'span',
                {
                  className:
                    'inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-sm font-semibold'
                },
                'AI'
              ),
              React.createElement('span', { className: 'text-sm font-semibold text-gray-700' }, 'AI Coach')
            ),
            aiLoading
              ? React.createElement(
                  'div',
                  { className: 'text-center py-8' },
                  React.createElement('div', {
                    className: 'relative w-28 h-28 mx-auto mb-4'
                  },
                    React.createElement('div', {
                      className: 'absolute inset-0 rounded-full',
                      style: { border: '8px solid #bbf7d0' }
                    }),
                    React.createElement('div', {
                      className: 'absolute inset-0 rounded-full border-t-transparent animate-spin',
                      style: { border: '8px solid #22c55e', borderTopColor: 'transparent' }
                    })
                  ),
                  React.createElement('div', { className: 'text-base font-semibold text-gray-800' }, 'AI 러닝 인사이트 분석 중...')
                )
              : !aiComment
                ? React.createElement(
                    'div',
                    { className: 'text-center py-4' },
                    React.createElement(
                      'div',
                      { className: 'flex justify-center' },
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          onClick: function () {
                            setRunAICommentAnalysis(true);
                          },
                          className: 'stelvio-ranking-board-entry-btn'
                        },
                        'AI 러닝 인사이트 분석'
                      )
                    ),
                    React.createElement(
                      'p',
                      { className: 'mt-3 text-xs leading-relaxed px-2', style: { color: '#374151' } },
                      'Riegel p·6축 Peak 페이스 기반 러닝 성향·훈련 처방을 AI가 해석합니다.'
                    )
                  )
                : React.createElement(
                    'div',
                    null,
                    React.createElement(
                      'p',
                      {
                        className: 'text-sm text-gray-700 leading-relaxed whitespace-pre-wrap',
                        style: { overflow: 'visible', wordBreak: 'keep-all' }
                      },
                      aiComment
                    ),
                    aiError
                      ? React.createElement(
                          'div',
                          { className: 'mt-3 flex justify-center' },
                          React.createElement(
                            'button',
                            {
                              type: 'button',
                              onClick: function () {
                                setAiComment('');
                                setRunAICommentAnalysis(true);
                              },
                              className: 'stelvio-ranking-board-entry-btn'
                            },
                            'AI 러닝 인사이트 분석'
                          )
                        )
                      : null
                  )
          )
        : null;

    var mainCard = DashboardCard
      ? React.createElement(
          DashboardCard,
          { title: 'STELVIO 헥사곤 (나의 성향)' },
          React.createElement(
            'p',
            { className: 'text-xs text-gray-500 mb-3 px-0.5' },
            '최근 90일 Peak 페이스 · Riegel p 지수 · 6축 역량 점수(0~100)'
          ),
          body
        )
      : React.createElement(
          'div',
          { className: 'rounded-2xl border border-gray-100 bg-white p-4 shadow-sm' },
          React.createElement('h3', { className: 'text-sm font-bold text-gray-800 mb-2' }, 'STELVIO 헥사곤 (나의 성향)'),
          body
        );

    return React.createElement(
      'div',
      { className: 'space-y-4' },
      mainCard,
      aiCoachBlock
    );
  }

  window.RunHexagonTendencyCard = RunHexagonTendencyCard;
})();
