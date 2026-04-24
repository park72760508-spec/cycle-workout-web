/**
 * STELVIO 옥타곤(레벨 포지션) — getPeakPowerRanking + StelvioRankingDistributionChart와 동일한
 * 참가자 분포(나의 위치)용 순위: 전체 rank / 나의 부문 index+1 / 타 부문 value 기준
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

  /** index.html 랭킹보드 #stelvioGenderSelect / #stelvioCategorySelect 와 동일 */
  var GENDER_OPTIONS = [
    { value: 'all', label: '전체' },
    { value: 'M', label: '남성' },
    { value: 'F', label: '여성' }
  ];
  var CATEGORY_OPTIONS = [
    { value: 'Supremo', label: '전체' },
    { value: 'Assoluto', label: '선수부' },
    { value: 'Bianco', label: '30대 이하' },
    { value: 'Rosa', label: '40대' },
    { value: 'Infinito', label: '50대' },
    { value: 'Leggenda', label: '60대 이상' }
  ];

  function labelForGender(v) {
    for (var i = 0; i < GENDER_OPTIONS.length; i++) {
      if (GENDER_OPTIONS[i].value === v) return GENDER_OPTIONS[i].label;
    }
    return '전체';
  }
  function labelForCategory(v) {
    for (var j = 0; j < CATEGORY_OPTIONS.length; j++) {
      if (CATEGORY_OPTIONS[j].value === v) return CATEGORY_OPTIONS[j].label;
    }
    return '전체';
  }

  /** 12시 기준 시계방향: TSS → Max → 1분 → … → 60분 */
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
  var DURATIONS = AXES.map(function(a) {
    return a.key;
  });

  function buildRankingUrl(uid, duration, periodForPeak, gender) {
    var p = new URLSearchParams();
    p.set('gender', gender == null || gender === '' ? 'all' : gender);
    p.set('duration', duration);
    if (uid) p.set('uid', String(uid));
    if (duration !== 'tss') p.set('period', periodForPeak || 'monthly');
    return RANKING_BASE + '?' + p.toString();
  }

  function safeFloorRank(n) {
    var r = Number(n);
    return isFinite(r) && r >= 1 ? Math.floor(r) : null;
  }

  /** StelvioRankingDistributionChart와 동일: 2위 표기만 3으로(차트 뱃지) */
  function rankDisplayForChart(n) {
    var r = Number(n);
    if (r !== 2) return r;
    return 3;
  }

  function rowMetricValue(row, duration) {
    if (!row) return NaN;
    if (duration === 'tss') return Number(row.totalTss);
    if (duration === 'personal_dist' || duration === 'group_dist') return Number(row.totalKm);
    return Number(row.wkg);
  }

  /**
   * StelvioRankingDistributionChart `displayRank`와 동일
   * - Supremo: currentUser.rank(전체 정렬 기준)
   * - 나의 ageCategory === 선택: 해당 부문 배열에서 findIndex+1
   * - 그 외(다른 부문 열람): 값 기준 rankInCategoryByValue(동점은 엄밀한 비교)
   */
  function rankInCategoryByValue(categoryRows, myVal, duration) {
    if (!categoryRows || !categoryRows.length || myVal == null || isNaN(myVal) || !isFinite(myVal)) return null;
    var eps = duration === 'tss' || duration === 'personal_dist' || duration === 'group_dist' ? 1e-6 : 1e-9;
    var strictlyGreater = 0;
    for (var i = 0; i < categoryRows.length; i++) {
      var row = categoryRows[i];
      if (!row) continue;
      var v = rowMetricValue(row, duration);
      if (isFinite(v) && v > myVal + eps) strictlyGreater++;
    }
    return strictlyGreater + 1;
  }

  function computeDisplayRankLikeDistribution(data, uid, category, duration) {
    if (!data || !data.success || !data.byCategory || !uid) return null;
    var cu = data.currentUser;
    if (!cu || String(cu.userId) !== String(uid)) return null;
    var byCategory = data.byCategory;
    var userAgeCat = cu.ageCategory;

    if (category === 'Supremo') {
      if (cu.rank == null) return null;
      return safeFloorRank(cu.rank);
    }

    if (userAgeCat && category === userAgeCat) {
      var heroArr = byCategory[category] || [];
      var heroIdx = heroArr.findIndex(function(e) {
        if (!e) return false;
        if (duration === 'group_dist') {
          return e.userId === uid || e.currentUserParticipated === true;
        }
        return String(e.userId) === String(uid);
      });
      if (heroIdx >= 0) return heroIdx + 1;
      return null;
    }

    var compareArr = byCategory[category] || [];
    var myRaw = rowMetricValue(cu, duration);
    var rawRank = rankInCategoryByValue(compareArr, myRaw, duration);
    if (rawRank != null) return rankDisplayForChart(rawRank);
    return null;
  }

  function fetchRankingPayload(uid, duration, period, gender) {
    return fetch(buildRankingUrl(uid, duration, period, gender), { method: 'GET', mode: 'cors' })
      .then(function(res) {
        return res.json().catch(function() {
          return { success: false };
        });
      });
  }

  function fetchRanksSet(uid, period, gender, category) {
    return Promise.all(
      DURATIONS.map(function(d) {
        return fetchRankingPayload(uid, d, period, gender).then(function(data) {
          return computeDisplayRankLikeDistribution(data, uid, category, d);
        });
      })
    );
  }

  /** 순위(1=최고) → 반지름 비율 0.06~0.98 (가운데=뒤쪽 순위) */
  function rankToRadiusNorm(rank) {
    if (rank == null || !isFinite(rank) || rank < 1) return 0.12;
    var r = 1 - Math.log(rank + 0.2) / Math.log(5000);
    if (r < 0.08) r = 0.08;
    if (r > 0.99) r = 0.99;
    return r;
  }

  /** i번째 축 각도(라디안) */
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

    var _g = useState('all');
    var gender = _g[0];
    var setGender = _g[1];
    var _c = useState('Supremo');
    var category = _c[0];
    var setCategory = _c[1];

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
        Promise.all([fetchRanksSet(uid, 'monthly', gender, category), fetchRanksSet(uid, 'yearly', gender, category)])
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
      [uid, gender, category]
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
          return pathFromPoints(octagonPoints([g, g, g, g, g, g, g, g], cx, cy, rMax));
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
                  ? mr != null
                    ? '(주간) ' + mr + '위'
                    : '(주간) —'
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

    var filterRow = null;
    if (uid) {
      filterRow = (
        <div className="stelvio-filter-bar-wrap stelvio-octagon-ranking-filters mb-3">
          <div className="stelvio-filter-bar">
            <div className="stelvio-gender-dropdown">
              <span className="stelvio-dropdown-caption">성별</span>
              <span className="stelvio-dropdown-label">{labelForGender(gender)}</span>
              <span className="stelvio-dropdown-chevron" aria-hidden="true">
                ▾
              </span>
              <select
                className="stelvio-dropdown-select"
                value={gender}
                onChange={function(e) {
                  setGender(e.target.value);
                }}
                aria-label="성별"
              >
                {GENDER_OPTIONS.map(function(o) {
                  return (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="stelvio-category-dropdown">
              <span className="stelvio-dropdown-caption">카테고리</span>
              <span className="stelvio-dropdown-label">{labelForCategory(category)}</span>
              <span className="stelvio-dropdown-chevron" aria-hidden="true">
                ▾
              </span>
              <select
                className="stelvio-dropdown-select"
                value={category}
                onChange={function(e) {
                  setCategory(e.target.value);
                }}
                aria-label="카테고리"
              >
                {CATEGORY_OPTIONS.map(function(o) {
                  return (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>
      );
    }

    var body = null;
    if (!uid) {
      body = (
        <div className="h-[200px] flex items-center justify-center text-gray-500 text-sm text-center px-2">
          사용자 ID가 없으면 순위를 불러올 수 없습니다.
        </div>
      );
    } else if (state.loading) {
      body = (
        <div className="h-[220px] flex flex-col items-center justify-center">
          <div className="w-10 h-10 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin mb-3" />
          <span className="text-sm text-gray-500">옥타곤 로딩…</span>
        </div>
      );
    } else if (state.err === 'fetch') {
      body = (
        <div className="h-[180px] flex items-center justify-center text-gray-500 text-sm">랭킹을 불러오지 못했습니다. 네트워크를 확인해 주세요.</div>
      );
    } else {
      body = (
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
      return (
        <DashboardCard title="STELVIO 옥타곤 (레벨 포지션)">
          {filterRow}
          {body}
        </DashboardCard>
      );
    }
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-gray-800 mb-2">STELVIO 옥타곤 (레벨 포지션)</h3>
        {filterRow}
        {body}
      </div>
    );
  }

  window.StelvioOctagonRanksCard = StelvioOctagonRanksCard;
})();
