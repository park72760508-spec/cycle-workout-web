/**
 * STELVIO 옥타곤(레벨 포지션) — TSS(주간) + Max·1~60분(최근30일 보라 / 365일 초록)
 * API: getPeakPowerRanking
 */
/* global React, useState, useEffect, useMemo, window */
(function() {
  'use strict';
  if (!window.React) return;
  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;

  var RANKING_BASE = 'https://us-central1-stelvio-ai.cloudfunctions.net/getPeakPowerRanking';

  /** 12시 기준 시계방향: TSS → Max → 1분 → 5분 → … → 60분 */
  var AXES = [
    { key: 'tss', label: 'TSS' },
    { key: 'max', label: 'Max' },
    { key: '1min', label: '1분' },
    { key: '5min', label: '5분' },
    { key: '10min', label: '10분' },
    { key: '20min', label: '20분' },
    { key: '40min', label: '40분' },
    { key: '60min', label: '60분' }
  ];
  var DURATIONS = AXES.map(function(a) { return a.key; });

  function buildRankingUrl(uid, duration, periodForPeak) {
    var p = new URLSearchParams();
    p.set('gender', 'all');
    p.set('duration', duration);
    if (uid) p.set('uid', String(uid));
    if (duration !== 'tss') p.set('period', periodForPeak || 'monthly');
    return RANKING_BASE + '?' + p.toString();
  }

  function parseRankFromResponse(data) {
    if (!data || !data.success) return null;
    if (data.currentUser && data.currentUser.rank != null) return Number(data.currentUser.rank);
    if (data.myRank && data.myRank.rank != null) return Number(data.myRank.rank);
    if (data.myRankSupremo && data.myRankSupremo.rank != null) return Number(data.myRankSupremo.rank);
    return null;
  }

  /** 순위(1=최고) → 반지름 비율 0.06~0.98 (가운데=뒤쪽 순위) */
  function rankToRadiusNorm(rank) {
    if (rank == null || !isFinite(rank) || rank < 1) return 0.12;
    var r = 1 - Math.log(rank + 0.2) / Math.log(5000);
    if (r < 0.08) r = 0.08;
    if (r > 0.99) r = 0.99;
    return r;
  }

  function fetchRank(uid, duration, period) {
    return fetch(buildRankingUrl(uid, duration, period), { method: 'GET', mode: 'cors' })
      .then(function(res) { return res.json().catch(function() { return { success: false }; }); })
      .then(function(data) { return parseRankFromResponse(data); });
  }

  function fetchRanksSet(uid, period) {
    return Promise.all(
      DURATIONS.map(function(d) {
        return fetchRank(uid, d, period);
      })
    );
  }

  /** i번째 축 각도(라디안), y 아래로 증가(화면) */
  function axisAngle(i) {
    return -Math.PI / 2 + Math.PI / 8 - (i * 2 * Math.PI) / 8;
  }

  function octagonPoints(ratioArr, cx, cy, rMax) {
    var pts = [];
    for (var i = 0; i < 8; i++) {
      var t = axisAngle(i);
      var ri = (ratioArr[i] != null ? ratioArr[i] : 0.1) * rMax;
      pts.push([cx + ri * Math.cos(t), cy + ri * Math.sin(t)]);
    }
    return pts;
  }

  function pathFromPoints(pts) {
    if (!pts.length) return '';
    var s = 'M ' + pts[0][0].toFixed(2) + ' ' + pts[0][1].toFixed(2);
    for (var j = 1; j < pts.length; j++) s += ' L ' + pts[j][0].toFixed(2) + ' ' + pts[j][1].toFixed(2);
    return s + ' Z';
  }

  function StelvioOctagonRanksCard(props) {
    var p = props || {};
    var userProfile = p.userProfile;
    var DashboardCard = p.DashboardCard;
    var uid = userProfile && userProfile.id != null ? String(userProfile.id) : null;

    var _s = useState({ loading: true, err: null, monthly: null, hof: null });
    var state = _s[0];
    var setState = _s[1];

    useEffect(
      function() {
        if (!uid) {
          setState({ loading: false, err: 'noUser', monthly: null, hof: null });
          return;
        }
        setState({ loading: true, err: null, monthly: null, hof: null });
        Promise.all([fetchRanksSet(uid, 'monthly'), fetchRanksSet(uid, 'yearly')])
          .then(function(results) {
            var monthlyRanks = results[0];
            var hofRanks = results[1];
            var mRat = monthlyRanks.map(rankToRadiusNorm);
            var hRat = hofRanks.map(function(r, i) {
              if (i === 0) return mRat[0];
              return rankToRadiusNorm(r);
            });
            setState({
              loading: false,
              err: null,
              monthly: { ranks: monthlyRanks, norm: mRat },
              hof: { ranks: hofRanks, norm: hRat }
            });
          })
          .catch(function() {
            setState({ loading: false, err: 'fetch', monthly: null, hof: null });
          });
      },
      [uid]
    );

    var svg = useMemo(
      function() {
        if (state.loading || !state.monthly || !state.hof) return null;
        var cx = 100;
        var cy = 100;
        var rLabel = 88;
        var rMax = 70;
        var mPts = pathFromPoints(octagonPoints(state.monthly.norm, cx, cy, rMax));
        var hPts = pathFromPoints(octagonPoints(state.hof.norm, cx, cy, rMax));
        var grid = [0.25, 0.5, 0.75, 1].map(function(g) {
          return pathFromPoints(
            octagonPoints([g, g, g, g, g, g, g, g], cx, cy, rMax)
          );
        });
        return (
          <svg viewBox="0 0 200 200" className="w-full max-w-[360px] mx-auto h-[260px] touch-manipulation" role="img" aria-label="STELVIO 옥타곤 레벨 포지션">
            {grid.map(function(d, idx) {
              return (
                <path
                  key={idx}
                  d={d}
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.35)"
                  strokeWidth="0.6"
                />
              );
            })}
            {AXES.map(function(ax, i) {
              var t = axisAngle(i);
              return (
                <line
                  key={ax.key}
                  x1={cx}
                  y1={cy}
                  x2={cx + rLabel * 1.05 * Math.cos(t)}
                  y2={cy + rLabel * 1.05 * Math.sin(t)}
                  stroke="rgba(148, 163, 184, 0.45)"
                  strokeWidth="0.5"
                />
              );
            })}
            <path
              d={hPts}
              fill="rgba(16, 185, 129, 0.18)"
              stroke="rgb(5, 150, 105)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d={mPts}
              fill="rgba(124, 58, 237, 0.22)"
              stroke="rgb(109, 40, 217)"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            {AXES.map(function(ax, i) {
              var t = axisAngle(i);
              var lx = cx + rLabel * Math.cos(t);
              var ly = cy + rLabel * Math.sin(t);
              var mr = state.monthly.ranks[i];
              var hr = state.hof.ranks[i];
              var sub2 =
                i === 0
                  ? (mr != null ? '(주간) ' + mr + '위' : '(주간) —')
                  : (mr != null ? 'M' + mr : 'M—') + ' ' + (hr != null ? 'Y' + hr : 'Y—') + '위';
              return (
                <text
                  key={ax.key + '-lbl'}
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  className="fill-slate-800"
                >
                  <tspan x={lx} dy="0" style={{ fontSize: '9.5px', fontWeight: 600 }}>
                    {i === 0 ? 'TSS' : ax.label}
                  </tspan>
                  <tspan x={lx} dy="11" style={{ fontSize: '7.5px', fill: '#64748b' }}>
                    {sub2}
                  </tspan>
                </text>
              );
            })}
          </svg>
        );
      },
      [state]
    );

    var inner = null;
    if (!uid) {
      inner = (
        <div className="h-[200px] flex items-center justify-center text-gray-500 text-sm text-center px-2">
          사용자 ID가 없으면 순위를 불러올 수 없습니다.
        </div>
      );
    } else if (state.loading) {
      inner = (
        <div className="h-[220px] flex flex-col items-center justify-center">
          <div className="w-10 h-10 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin mb-3" />
          <span className="text-sm text-gray-500">옥타곤 로딩…</span>
        </div>
      );
    } else if (state.err === 'fetch') {
      inner = (
        <div className="h-[180px] flex items-center justify-center text-gray-500 text-sm">랭킹을 불러오지 못했습니다. 네트워크를 확인해 주세요.</div>
      );
    } else {
      inner = (
        <div>
          {svg}
          <div className="flex flex-wrap justify-center gap-3 text-xs text-gray-600 mt-1 mb-0 px-1">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded" style={{ background: 'rgba(124, 58, 237, 0.45)', border: '1px solid #6d28d9' }} />
              <span>최근 30일 + TSS 주간</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded" style={{ background: 'rgba(16, 185, 129, 0.4)', border: '1px solid #059669' }} />
              <span>최근365일 · TSS는 주간(동일선)</span>
            </div>
          </div>
          <p className="text-center text-xs text-gray-500 mt-2 mb-0 px-1">! 바깥에 가까울수록 상위 레벨</p>
        </div>
      );
    }

    if (DashboardCard) {
      return <DashboardCard title="STELVIO 옥타곤 (레벨 포지션)">{inner}</DashboardCard>;
    }
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-gray-800 mb-2">STELVIO 옥타곤 (레벨 포지션)</h3>
        {inner}
      </div>
    );
  }

  window.StelvioOctagonRanksCard = StelvioOctagonRanksCard;
})();
