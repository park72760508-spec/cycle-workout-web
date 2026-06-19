/**
 * RUN 6축 헥사곤 — 구간별 페이스 순위 (CYCLE GC 헵타곤 레이더와 동일 rank→반지름 로직)
 * 축: 1k · 3k · 5k · 7k · 10k · 20k
 */
/* global React, useMemo */
(function () {
  'use strict';
  if (!window.React) return;

  var React = window.React;
  var useMemo = React.useMemo;
  var useRef = React.useRef;

  function axisAngle(i, n) {
    return -Math.PI / 2 + (i * 2 * Math.PI) / n;
  }

  function radarPolygonPoints(ratioArr, cx, cy, rMax) {
    var n = ratioArr && ratioArr.length > 0 ? ratioArr.length : 0;
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

  function rankToNorm(rank, nRef) {
    if (rank == null || !isFinite(rank) || rank < 1) return 0.08;
    var rr = Math.floor(Number(rank));
    if (rr < 1) rr = 1;
    if (rr > nRef) rr = nRef;
    var norm = (nRef - rr + 1) / nRef;
    if (norm > 0.99) norm = 0.99;
    if (norm < 0.08) norm = 0.08;
    return norm;
  }

  function formatScore(v) {
    var fmt = window.runningRankingFormat;
    if (fmt && typeof fmt.formatScore === 'function') return fmt.formatScore(v);
    var n = Number(v);
    if (!isFinite(n)) return '—';
    return n % 1 === 0 ? String(n) : n.toFixed(1);
  }

  function RunningHexagonRanksCard(props) {
    var rows = props.rows || [];
    var gender = props.gender || 'all';
    var category = props.category || 'Supremo';
    var hexSvgInstanceRef = useRef(null);
    if (!hexSvgInstanceRef.current) {
      hexSvgInstanceRef.current =
        'rhx' + String(Date.now().toString(36)) + Math.random().toString(36).slice(2, 8);
    }

    var state = useMemo(function () {
      var api = window.runningRankingData;
      if (!api || typeof api.buildRunningHexagonState !== 'function') return null;
      return api.buildRunningHexagonState(rows, { gender: gender, category: category });
    }, [rows, gender, category]);

    var svg = useMemo(function () {
      if (!state || !state.axes || !state.axes.length) return null;
      var cx = 100;
      var cy = 100;
      var rLabel = 88;
      var rMax = 70;
      var nAxis = state.axes.length;
      var nRef = state.nRef < 1 ? 1 : state.nRef;
      var rankNorms = [];
      var i;
      for (i = 0; i < nAxis; i++) {
        rankNorms.push(rankToNorm(state.axes[i].rank, nRef));
      }
      var mPts = pathFromPoints(radarPolygonPoints(rankNorms, cx, cy, rMax));
      var grid = [0.25, 0.5, 0.75, 1].map(function (g) {
        var gr = [];
        var gi;
        for (gi = 0; gi < nAxis; gi++) gr.push(g);
        return pathFromPoints(radarPolygonPoints(gr, cx, cy, rMax));
      });
      var uidSafe = String(state.userId || 'run').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
      var fillGradId =
        'running-hex-fill-rad-' + (uidSafe || 'def') + '-' + String(hexSvgInstanceRef.current || 'inst');

      return React.createElement('svg', {
        viewBox: '0 0 200 200',
        className: 'w-full h-[260px] touch-manipulation running-hexagon-radar-svg stelvio-run-hexagon-radar-svg',
        role: 'img',
        'aria-label': 'RUN 구간별 페이스 6축 헥사곤'
      },
        React.createElement('defs', null,
          React.createElement('radialGradient', {
            id: fillGradId,
            gradientUnits: 'userSpaceOnUse',
            cx: cx,
            cy: cy,
            r: rMax * 1.02,
            fx: cx,
            fy: cy
          },
            React.createElement('stop', { offset: '0%', stopColor: 'rgb(245, 243, 255)', stopOpacity: 0.95 }),
            React.createElement('stop', { offset: '38%', stopColor: 'rgb(196, 181, 253)', stopOpacity: 0.72 }),
            React.createElement('stop', { offset: '72%', stopColor: 'rgb(139, 92, 246)', stopOpacity: 0.62 }),
            React.createElement('stop', { offset: '100%', stopColor: 'rgb(91, 33, 182)', stopOpacity: 0.78 })
          )
        ),
        grid.map(function (d, idx) {
          return React.createElement('path', {
            key: 'grid-' + idx,
            d: d,
            fill: 'none',
            stroke: 'rgba(148, 163, 184, 0.35)',
            strokeWidth: '0.6'
          });
        }),
        state.axes.map(function (ax, ai) {
          var t = axisAngle(ai, nAxis);
          return React.createElement('line', {
            key: ax.key + '-spoke',
            x1: cx,
            y1: cy,
            x2: cx + rLabel * 1.05 * Math.cos(t),
            y2: cy + rLabel * 1.05 * Math.sin(t),
            stroke: 'rgba(148, 163, 184, 0.45)',
            strokeWidth: '0.5'
          });
        }),
        React.createElement('path', {
          d: mPts,
          className: 'stelvio-run-hexagon-radar-fill',
          fill: 'url(#' + fillGradId + ')',
          stroke: 'rgb(109, 40, 217)',
          strokeWidth: '2.2',
          strokeLinejoin: 'round'
        }),
        state.axes.map(function (ax, ai) {
          var t = axisAngle(ai, nAxis);
          var lx = cx + rLabel * Math.cos(t);
          var ly = cy + rLabel * Math.sin(t);
          var mr = ax.rank;
          return React.createElement('text', {
            key: ax.key + '-lbl',
            x: lx,
            y: ly,
            textAnchor: 'middle',
            className: 'fill-slate-800'
          },
            React.createElement('tspan', { x: lx, dy: '0', style: { fontSize: '9.5px', fontWeight: 600 } }, ax.label),
            React.createElement('tspan', {
              x: lx,
              dy: '11',
              style: { fontSize: '7.5px', fill: '#64748b' }
            }, mr != null ? mr + '위' : '—')
          );
        })
      );
    }, [state]);

    if (!state) {
      return React.createElement('div', {
        className: 'running-hexagon-empty text-sm text-gray-500 text-center py-6 px-2'
      }, '헥사곤 데이터를 불러올 수 없습니다.');
    }

    var centerRank = state.overallRank;
    var centerScore = state.score != null ? formatScore(state.score) + '점' : '—';

    return React.createElement('div', { className: 'running-hexagon-card' },
      React.createElement('p', {
        className: 'running-hexagon-caption text-xs text-center text-slate-500 mb-1 px-2'
      }, '구간별 페이스 순위 · 성별 ' + (gender === 'M' ? '남성' : gender === 'F' ? '여성' : '전체')),
      React.createElement('div', { className: 'flex items-center justify-center gap-1 w-full max-w-[420px] mx-auto' },
        React.createElement('div', { className: 'stelvio-octagon-chart-shell relative flex-1 h-[260px]' },
          svg,
          React.createElement('div', {
            className: 'stelvio-octagon-tier-wrap running-hexagon-center-wrap',
            'aria-hidden': true
          },
            React.createElement('div', { className: 'stelvio-octagon-tier-inner running-hexagon-center-inner' },
              React.createElement('span', { className: 'running-hexagon-center-rank' },
                centerRank != null ? centerRank + '위' : '—'
              ),
              React.createElement('span', { className: 'running-hexagon-center-score' }, centerScore)
            )
          )
        )
      ),
      React.createElement('div', {
        className: 'flex flex-wrap justify-center gap-3 text-xs text-gray-600 mt-2 mb-0 px-1'
      },
        React.createElement('div', { className: 'flex items-center gap-1.5' },
          React.createElement('span', {
            className: 'inline-block w-3 h-2 rounded',
            style: { background: 'rgba(124, 58, 237, 0.45)', border: '1px solid #6d28d9' }
          }),
          React.createElement('span', null, '구간별 페이스 순위')
        )
      ),
      React.createElement('div', {
        className: 'running-hexagon-axis-table-wrap mt-3 px-1',
        role: 'region',
        'aria-label': '구간별 순위·페이스'
      },
        React.createElement('table', { className: 'running-hexagon-axis-table' },
          React.createElement('thead', null,
            React.createElement('tr', null,
              React.createElement('th', { scope: 'col' }, '구간'),
              React.createElement('th', { scope: 'col' }, '순위'),
              React.createElement('th', { scope: 'col' }, '페이스')
            )
          ),
          React.createElement('tbody', null,
            state.axes.map(function (ax) {
              return React.createElement('tr', { key: ax.key },
                React.createElement('td', null, ax.label),
                React.createElement('td', null, ax.rank != null ? ax.rank + '위' : '—'),
                React.createElement('td', null, ax.pace || '—')
              );
            })
          )
        )
      )
    );
  }

  window.RunningHexagonRanksCard = RunningHexagonRanksCard;
})();
