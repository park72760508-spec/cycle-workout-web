/**
 * CYCLE 랭킹보드 평속 탭 — 히어로 카드「펼쳐보기」STELVIO 헵타곤 (평속 레벨 포지션)
 * GC 헵타곤(StelvioOctagonRanksCard)과 같은 디자인·로직, 축 값만 W/kg 대신 Max~60분 평속 순위.
 * - 데이터: Supabase RPC fn_speed_gc_ranking(p_gender) — 평속 랭킹과 같은 값(최근 90일 일별 top2 평균)
 * - 축 점수 S_k = 100·(n−r)/(n−1) (성별 전체 순위), 종합 = Σ GC 가중치·S_k (0~100) — GC 와 동일 가중치
 * - 종합 순위: 선택 부문에서 종합 점수 desc → 20분 점수 → 5분 점수 → uid (GC 와 동일 타이브레이크)
 * - 레벨%·레벨(A~G)·Neff(타 부문 가상 n+1)·레벨바: GC 와 같은 함수(window.StelvioHeptagonShared) 사용
 */
/* global React, window */
(function() {
  'use strict';
  if (!window.React) return;
  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;

  var PERIOD_LABEL = '최근 90일 최고 기록 2회 평균';
  var memo = Object.create(null);

  function supabaseCfg() {
    var c = window.STELVIO_SUPABASE_CONFIG || window.__STELVIO_SUPABASE__ || {};
    return c.supabaseUrl && c.supabaseAnonKey ? c : null;
  }

  function fetchSpeedGc(gender) {
    var key = String(gender || 'all');
    var m = memo[key];
    if (m && Date.now() - m.at < 60000) return m.p;
    var cfg = supabaseCfg();
    if (!cfg) return Promise.reject(new Error('no-supabase'));
    var p = fetch(cfg.supabaseUrl + '/rest/v1/rpc/fn_speed_gc_ranking', {
      method: 'POST',
      headers: {
        apikey: cfg.supabaseAnonKey,
        Authorization: 'Bearer ' + cfg.supabaseAnonKey,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ p_gender: key })
    }).then(function(res) {
      if (!res.ok) throw new Error('http-' + res.status);
      return res.json();
    }).then(function(j) {
      if (!j || j.success !== true) throw new Error('bad-payload');
      return j;
    });
    memo[key] = { at: Date.now(), p: p };
    p.catch(function() {
      delete memo[key];
    });
    return p;
  }

  function num(v) {
    var n = Number(v);
    return v != null && isFinite(n) ? n : null;
  }

  function cmpBoard(a, b) {
    var d = (num(b.gc) || 0) - (num(a.gc) || 0);
    if (d) return d;
    d = (num(b.pos && b.pos[4]) || 0) - (num(a.pos && a.pos[4]) || 0);
    if (d) return d;
    d = (num(b.pos && b.pos[2]) || 0) - (num(a.pos && a.pos[2]) || 0);
    if (d) return d;
    return String(a.userId) < String(b.userId) ? -1 : String(a.userId) > String(b.userId) ? 1 : 0;
  }

  /** 선택 부문 코호트: GC 순위표 행 + 본인 위치(타 부문이면 점수 기준 가상 삽입) + 축별 부문 순위 */
  function buildCohortView(data, uid, category, isInCohort) {
    var all = (data && data.entries) || [];
    var me = null;
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].userId) === String(uid)) {
        me = all[i];
        break;
      }
    }
    var cohort = all.filter(function(e) {
      return category === 'Supremo' ? true : isInCohort(category, e.ageCategory);
    });
    cohort.sort(cmpBoard);
    var rows = cohort.map(function(e, idx) {
      return {
        userId: e.userId,
        displayName: e.name,
        isPrivate: e.is_private === true,
        boardRank: idx + 1,
        score: num(e.gc),
        isMe: me != null && String(e.userId) === String(uid)
      };
    });
    var n = cohort.length;
    var myRank = null;
    var isVirtual = false;
    if (me) {
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].isMe) {
          myRank = rows[r].boardRank;
          break;
        }
      }
      if (myRank == null) {
        isVirtual = true;
        var better = 0;
        for (var c = 0; c < cohort.length; c++) {
          if (cmpBoard(cohort[c], me) < 0) better++;
        }
        myRank = better + 1;
        rows.splice(better, 0, {
          userId: me.userId,
          displayName: me.name,
          isPrivate: me.is_private === true,
          boardRank: myRank,
          score: num(me.gc),
          isMe: true,
          isInserted: true
        });
      }
    }
    var axisRanks = [];
    var axisN = [];
    var axisSpeeds = [];
    for (var a = 0; a < 7; a++) {
      var cnt = 0;
      var ahead = 0;
      var myR = me && me.ranks ? num(me.ranks[a]) : null;
      for (var k = 0; k < cohort.length; k++) {
        var rr = cohort[k].ranks ? num(cohort[k].ranks[a]) : null;
        if (rr == null) continue;
        cnt++;
        if (myR != null && rr < myR) ahead++;
      }
      axisN.push(cnt);
      axisRanks.push(myR != null ? ahead + 1 : null);
      axisSpeeds.push(me && me.speeds ? num(me.speeds[a]) : null);
    }
    var supRank = null;
    if (me) {
      var sorted = all.slice().sort(cmpBoard);
      for (var s = 0; s < sorted.length; s++) {
        if (String(sorted[s].userId) === String(uid)) {
          supRank = s + 1;
          break;
        }
      }
    }
    return {
      me: me,
      rows: rows,
      n: n,
      myRank: myRank,
      isVirtual: isVirtual,
      axisRanks: axisRanks,
      axisN: axisN,
      axisSpeeds: axisSpeeds,
      supRank: supRank
    };
  }

  function FilterRow(props) {
    var H = props.H;
    return (
      <div className="stelvio-octagon-filters" role="group" aria-label="랭킹 기준(성별·부문) 선택">
        <div className="stelvio-octagon-filter-joined">
          <div className="stelvio-octagon-filter-cell stelvio-octagon-gender">
            <span className="stelvio-octagon-filter-cap">성별</span>
            <span className="stelvio-octagon-filter-val">{H.labelForGender(props.gender)}</span>
            <span className="stelvio-octagon-filter-chev" aria-hidden="true" />
            <select
              className="stelvio-octagon-filter-select"
              value={props.gender}
              onChange={function(e) {
                props.onChange(e.target.value, props.category);
              }}
              aria-label="성별"
            >
              {H.GENDER_OPTIONS.map(function(o) {
                return (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="stelvio-octagon-filter-cell stelvio-octagon-category">
            <span className="stelvio-octagon-filter-cap">카테고리</span>
            <span className="stelvio-octagon-filter-val">{H.labelForCategory(props.category)}</span>
            <span className="stelvio-octagon-filter-chev" aria-hidden="true" />
            <select
              className="stelvio-octagon-filter-select"
              value={props.category}
              onChange={function(e) {
                props.onChange(props.gender, e.target.value);
              }}
              aria-label="카테고리"
            >
              {H.CATEGORY_OPTIONS.map(function(o) {
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

  /** GC 헵타곤 상세 팝업과 같은 구성 — 요약(레벨·순위·레벨%·종합 점수) + 동일 조건 순위표 */
  function SpeedHeptagonDetailModal(props) {
    var H = props.H;
    var onClose = props.onClose;
    var view = props.view;
    var boardC = props.category;
    var viewerAc = props.viewerAc;
    useEffect(
      function() {
        var h = function(e) {
          if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', h);
        return function() {
          window.removeEventListener('keydown', h);
        };
      },
      [onClose]
    );
    var me = view && view.me;
    var pT = me && view.n >= 1 ? H.heptagonLevelPercentForRankN(view.myRank, view.n, view.isVirtual, boardC, viewerAc) : null;
    var tid = pT != null ? (H.heptagonBoardTierIdFromLevelPercent(pT) || {}).id : 'C6';
    var isSup = String(props.gender) === 'all' && String(boardC) === 'Supremo';
    return (
      <div
        className="stelvio-heptagon-detail-modal"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
        onClick={function(e) {
          if (e.target === e.currentTarget) onClose();
        }}
        role="presentation"
      >
        <div
          className="stelvio-heptagon-detail-modal__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stelvio-speed-heptagon-detail-title"
          onClick={function(e) {
            e.stopPropagation();
          }}
        >
          <div className="stelvio-heptagon-detail-modal__head">
            <div className="stelvio-heptagon-detail-modal__head-block">
              <div className="stelvio-heptagon-detail-modal__title-row">
                <h3 className="stelvio-heptagon-detail-modal__title" id="stelvio-speed-heptagon-detail-title">
                  STELVIO 헵타곤 · 평속 항목별 순위
                </h3>
                <button type="button" className="stelvio-heptagon-detail-modal__close" aria-label="닫기" onClick={onClose}>
                  ×
                </button>
              </div>
              <p className="stelvio-heptagon-detail-modal__meta">
                <span>
                  부문(카테고리): {H.labelForCategory(boardC)} · 성별: {H.labelForGender(props.gender)} · {PERIOD_LABEL}
                </span>
              </p>
            </div>
          </div>
          {me ? (
            <div className="stelvio-heptagon-detail-modal__summary">
              <div className="stelvio-heptagon-detail-modal__summary-row">
                <span>레벨</span>
                <strong>{H.tierLevelDisplayName(tid)}</strong>
              </div>
              <div className="stelvio-heptagon-detail-modal__summary-row">
                <span>{isSup ? '종합(환산) 순위' : '집계 순위 (필터)'}</span>
                <strong>{view.myRank != null ? view.myRank + '위' : '—'}</strong>
              </div>
              {pT != null ? (
                <div className="stelvio-heptagon-detail-modal__summary-row">
                  <span>레벨 % {view.isVirtual ? '(가상, 순위~n+1)' : '(실집계, 1~n)'}</span>
                  <strong>{pT.toFixed(2)}%</strong>
                </div>
              ) : null}
              <div className="stelvio-heptagon-detail-modal__summary-row">
                <span>평속 GC 종합 점수 (0~100)</span>
                <strong>{num(me.gc) != null ? num(me.gc).toFixed(1) : '—'}</strong>
              </div>
            </div>
          ) : null}
          <div className="stelvio-heptagon-detail-modal__boardbody">
            <div className="stelvio-heptagon-detail-modal__boardhead">
              <p className="stelvio-heptagon-detail-modal__boardhead-t m-0 mb-2 text-center w-full">동일 조건 평속 환산 점수 순위</p>
              <div className="stelvio-heptagon-detail-modal__board-oct-filters w-full max-w-full justify-center flex">
                <FilterRow H={H} gender={props.gender} category={boardC} onChange={props.onFilterChange} />
              </div>
            </div>
            {props.loading ? <p className="stelvio-heptagon-detail-modal__neighborload">순위표를 불러오는 중…</p> : null}
            {!props.loading && view && view.rows.length ? (
              <div className="stelvio-heptagon-detail-modal__tablewrap stelvio-heptagon-detail-modal__tablewrap--neighbor">
                <table className="stelvio-heptagon-detail-modal__table" role="grid">
                  <caption className="stelvio-heptagon-detail-modal__caption">
                    {H.labelForCategory(boardC)} · {H.labelForGender(props.gender)} — 평속 GC 종합 점수(Max~60분 평속 순위 가중 합, 0~100)가 높은 순
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="stelvio-heptagon-detail-modal__thnum">순위</th>
                      <th scope="col">이름</th>
                      <th scope="col" className="stelvio-heptagon-detail-modal__thnum">환산점수 합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map(function(row, idx) {
                      var npb = H.stelvioNeighborNameParts(
                        row.isMe ? props.myDisplayName || row.displayName : row.displayName,
                        row.isPrivate,
                        row.userId,
                        props.viewerUserId,
                        props.viewerGrade
                      );
                      var pRow = H.heptagonLevelPercentForRankN(row.boardRank, view.n, view.isVirtual, boardC, viewerAc);
                      var gLet = H.heptagonTierIdToGradeLetter((H.heptagonBoardTierIdFromLevelPercent(pRow) || {}).id);
                      return (
                        <tr
                          key={row.isInserted ? 'me-ins' : 'br-' + (row.userId || idx)}
                          className={row.isMe ? 'stelvio-heptagon-detail-modal__tr--me' : ''}
                        >
                          <td className="stelvio-heptagon-detail-modal__tdnum">{row.boardRank + '위'}</td>
                          <td>
                            {row.isMe ? (
                              <strong>
                                <span className="stelvio-heptagon-detail-modal__namecell" title={npb.title || undefined}>{npb.text}</span>
                              </strong>
                            ) : (
                              <span className="stelvio-heptagon-detail-modal__namecell" title={npb.title || undefined}>{npb.text}</span>
                            )}
                            <span className="stelvio-heptagon-detail-modal__rank-meta">
                              <span className={'stelvio-hept-grade stelvio-hept-grade--' + gLet.toLowerCase()} aria-label={'등급 ' + gLet}>
                                {gLet}
                              </span>
                            </span>
                            {npb.showPrivateBadge ? (
                              <span className="ranking-private-badge ranking-private-badge-admin" title="비공개">비</span>
                            ) : null}
                          </td>
                          <td className="stelvio-heptagon-detail-modal__tdnum">
                            {row.score != null ? (row.isMe ? <strong>{row.score.toFixed(1)}</strong> : row.score.toFixed(1)) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            {!props.loading && view && !view.rows.length ? (
              <p className="stelvio-heptagon-detail-modal__neighborload">표시할 순위가 없습니다. (동일 조건·집계 기준)</p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function StelvioSpeedHeptagonCard(props) {
    var H = window.StelvioHeptagonShared;
    var userProfile = (props && props.userProfile) || null;
    var uid = userProfile && userProfile.id != null ? String(userProfile.id) : '';

    var _g = useState('all');
    var gender = _g[0];
    var setGender = _g[1];
    var _c = useState('Supremo');
    var category = _c[0];
    var setCategory = _c[1];
    var _d = useState({ loading: true, err: null, data: null, gender: null });
    var st = _d[0];
    var setSt = _d[1];
    var _pct = useState(false);
    var pctOpen = _pct[0];
    var setPctOpen = _pct[1];
    var _open = useState(false);
    var detailOpen = _open[0];
    var setDetailOpen = _open[1];
    var _mf = useState(null);
    var modalFilter = _mf[0];
    var setModalFilter = _mf[1];
    var _md = useState({ loading: false, data: null, gender: null });
    var modalSt = _md[0];
    var setModalSt = _md[1];

    useEffect(
      function() {
        var alive = true;
        setSt(function(prev) {
          return { loading: true, err: null, data: prev.data, gender: prev.gender };
        });
        fetchSpeedGc(gender)
          .then(function(j) {
            if (alive) setSt({ loading: false, err: null, data: j, gender: gender });
          })
          .catch(function() {
            if (alive) setSt({ loading: false, err: 'fetch', data: null, gender: gender });
          });
        return function() {
          alive = false;
        };
      },
      [gender]
    );

    var modalG = modalFilter ? modalFilter.g : gender;
    var modalC = modalFilter ? modalFilter.c : category;
    useEffect(
      function() {
        if (!detailOpen || modalG === gender) return undefined;
        var alive = true;
        setModalSt({ loading: true, data: null, gender: modalG });
        fetchSpeedGc(modalG)
          .then(function(j) {
            if (alive) setModalSt({ loading: false, data: j, gender: modalG });
          })
          .catch(function() {
            if (alive) setModalSt({ loading: false, data: null, gender: modalG });
          });
        return function() {
          alive = false;
        };
      },
      [detailOpen, modalG, gender]
    );

    var data = st.data && st.gender === gender ? st.data : null;
    var view = useMemo(
      function() {
        if (!H || !data) return null;
        return buildCohortView(data, uid, category, H.isUserInCohortForFilter);
      },
      [data, uid, category]
    );
    var viewerAc =
      (view && view.me && view.me.ageCategory) || (H && H.categoryValueMatchingUserAge(userProfile)) || '';

    if (!H) {
      return null;
    }

    var summary = null;
    var hct = { kind: 'none' };
    var pPct = -1;
    if (view && view.me && view.n >= 1) {
      pPct = H.heptagonLevelPercentForRankN(view.myRank, view.n, view.isVirtual, category, viewerAc);
      var tierObj = H.heptagonBoardTierIdFromLevelPercent(pPct);
      summary = { tier: tierObj, cohortN: view.n, heptagonBoardVirtualCohort: view.isVirtual, pTotal: pPct };
      hct = {
        kind: 'ok',
        rank: view.myRank,
        pPct: pPct,
        nCohort: H.heptagonUseNeffNPlusOne(category, viewerAc, view.isVirtual) ? view.n + 1 : view.n,
        isVirtual: view.isVirtual
      };
    }

    var svg = null;
    if (view) {
      var cx = 100;
      var cy = 100;
      var rLabel = 88;
      var rMax = 70;
      var nAxis = H.AXES.length;
      var nRef = view.n >= 1 ? view.n : 1;
      var norms = view.axisRanks.map(function(r) {
        if (r == null) return 0.08;
        var rr = Math.min(Math.max(1, r), nRef);
        return Math.min(0.99, Math.max(0.08, (nRef - rr + 1) / nRef));
      });
      var grid = [0.25, 0.5, 0.75, 1].map(function(g) {
        var gr = [];
        for (var gi = 0; gi < nAxis; gi++) gr.push(g);
        return H.pathFromPoints(H.radarPolygonPoints(gr, cx, cy, rMax));
      });
      var fillId = 'stelvio-spd-hept-fill-' + String(uid || 'def').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
      svg = (
        <svg viewBox="0 0 200 200" overflow="visible" className="w-full h-[260px] touch-manipulation" role="img" aria-label="STELVIO 평속 7축 헵타곤 레벨 포지션">
          <defs>
            <radialGradient id={fillId} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={rMax * 1.02} fx={cx} fy={cy}>
              <stop offset="0%" stopColor="rgb(245, 243, 255)" stopOpacity={0.95} />
              <stop offset="38%" stopColor="rgb(196, 181, 253)" stopOpacity={0.72} />
              <stop offset="72%" stopColor="rgb(139, 92, 246)" stopOpacity={0.62} />
              <stop offset="100%" stopColor="rgb(91, 33, 182)" stopOpacity={0.78} />
            </radialGradient>
          </defs>
          {grid.map(function(d, idx) {
            return <path key={idx} d={d} fill="none" stroke="rgba(148, 163, 184, 0.35)" strokeWidth="0.6" />;
          })}
          {H.AXES.map(function(ax, i) {
            var t = H.axisAngle(i, nAxis);
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
            d={H.pathFromPoints(H.radarPolygonPoints(norms, cx, cy, rMax))}
            fill={'url(#' + fillId + ')'}
            stroke="rgb(109, 40, 217)"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          {H.AXES.map(function(ax, i) {
            var t = H.axisAngle(i, nAxis);
            var lx = cx + rLabel * Math.cos(t);
            var ly = cy + rLabel * Math.sin(t);
            var mr = view.axisRanks[i];
            var sp = view.axisSpeeds[i];
            return (
              <text key={ax.key + '-lbl'} x={lx} y={ly} textAnchor="middle" className="fill-slate-800">
                <title>{ax.label + ' 평속 ' + (sp != null ? sp.toFixed(1) + ' km/h' : '—')}</title>
                <tspan x={lx} dy="0" style={{ fontSize: '9.5px', fontWeight: 600 }}>
                  {ax.label}
                  <tspan style={{ fontSize: '7.5px', fontWeight: 600, fill: '#7c3aed' }}>
                    {'(' + Math.round(H.GC_AXIS_WEIGHTS[ax.key] * 100) + '%)'}
                  </tspan>
                </tspan>
                <tspan x={lx} dy="11" style={{ fontSize: '7.5px', fill: '#64748b' }}>
                  {mr != null ? mr + '위' : '—'}
                </tspan>
                {/* 현재 순위의 기준 평속(최근 90일 상위 2회 평균) */}
                <tspan x={lx} dy="9.5" style={{ fontSize: '7.5px', fontWeight: 600, fill: '#0369a1' }}>
                  {sp != null ? sp.toFixed(1) : '—'}
                  {sp != null ? (
                    <tspan dx="1" style={{ fontSize: '5.5px', fontWeight: 400, fill: '#94a3b8' }}>km/h</tspan>
                  ) : null}
                </tspan>
              </text>
            );
          })}
        </svg>
      );
    }

    var onFilter = function(g, c) {
      setGender(g);
      setCategory(c);
    };

    var body;
    if (!uid) {
      body = (
        <div className="h-[200px] flex items-center justify-center text-gray-500 text-sm text-center px-2">
          사용자 ID가 없으면 순위를 불러올 수 없습니다.
        </div>
      );
    } else if (st.loading && !view) {
      body = (
        <div className="h-[220px] flex flex-col items-center justify-center">
          <div className="w-10 h-10 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin mb-3" />
          <span className="text-sm text-gray-500">헵타곤 로딩…</span>
        </div>
      );
    } else if (st.err === 'fetch' || !view) {
      body = (
        <div className="h-[180px] flex items-center justify-center text-gray-500 text-sm">랭킹을 불러오지 못했습니다. 네트워크를 확인해 주세요.</div>
      );
    } else if (!view.me) {
      body = (
        <div className="h-[180px] flex items-center justify-center text-gray-500 text-sm text-center px-3">
          최근 90일 아웃도어 평속 기록이 없어 헵타곤을 표시할 수 없습니다.
        </div>
      );
    } else {
      var barTierId = (H.heptagonBoardTierIdFromLevelPercent(pPct) || {}).id || summary.tier.id;
      var barCtx = { isVirtualCohort: view.isVirtual, filterCategory: category, viewerAgeCategory: viewerAc };
      body = (
        <div>
          <div className="flex items-center justify-center gap-1 w-full max-w-[420px] mx-auto">
            <div className="stelvio-octagon-chart-shell relative flex-1 h-[260px]">
              {svg}
              <H.OctagonTierCenterOverlay
                summary={summary}
                onOpenDetail={function() {
                  setModalFilter(null);
                  setDetailOpen(true);
                }}
                heptagonCardTooltip={hct}
                filterGenderLabel={H.labelForGender(gender)}
                filterCategoryLabel={H.labelForCategory(category)}
                filterCategoryKey={category}
                viewerUserId=""
                cohortOvlLoading={st.loading}
                detachedLevelPill={true}
                pctHintOpen={pctOpen}
                setPctHintOpen={setPctOpen}
                gcRank={view.supRank}
              />
            </div>
            <div className="stelvio-octagon-sidebar-col">
              <H.OctagonTierLevelPillSidebar
                summary={summary}
                heptagonCardTooltip={hct}
                filterGenderLabel={H.labelForGender(gender)}
                filterCategoryLabel={H.labelForCategory(category)}
                showPct={pctOpen}
                setShowPct={setPctOpen}
              />
              <H.LevelProgressBar summary={summary} tierId={barTierId} pPctForBar={pPct} hideTopTierLabel={true} barContext={barCtx} />
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-3 text-xs text-gray-600 mt-1 mb-0 px-1">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded" style={{ background: 'rgba(124, 58, 237, 0.45)', border: '1px solid #6d28d9' }} />
              <span>{PERIOD_LABEL}</span>
            </div>
          </div>
          <div className="stelvio-heptagon-tier-legend mt-2 mb-1 px-1 w-full max-w-xl mx-auto" role="group" aria-label="등급 A~G 및 순위 적용 % 범례">
            <div className="grid grid-cols-7 gap-x-0.5 sm:gap-x-1 gap-y-1.5 justify-items-center items-end text-[10px] text-gray-600">
              {H.HEPTAGON_CARD_TIER_LEGEND_IDS.map(function(tLegendId) {
                return (
                  <div
                    key={'spd-leg-' + tLegendId}
                    className={'stelvio-heptagon-tier-legend__img-wrap ' + (barTierId && tLegendId !== barTierId ? 'stelvio-heptagon-tier-legend__img-wrap--dim' : 'stelvio-heptagon-tier-legend__img-wrap--focus') + ' flex items-end justify-center w-full pt-0.5'}
                  >
                    <img
                      src={H.tierBadgeImageSrc(tLegendId)}
                      alt=""
                      className="stelvio-heptagon-tier-legend__img max-w-none object-contain object-bottom pointer-events-none w-[calc(24px*1.56)] h-[calc(16px*1.56)]"
                      decoding="async"
                    />
                  </div>
                );
              })}
            </div>
            <H.HeptagonTierHorizontalGradientBar summary={summary} tierId={barTierId} pPctForBar={pPct} barContext={barCtx} />
          </div>
        </div>
      );
    }

    var modalData = modalG === gender ? data : modalSt.gender === modalG ? modalSt.data : null;
    var modalView = detailOpen && modalData && H ? buildCohortView(modalData, uid, modalC, H.isUserInCohortForFilter) : null;
    var modalAc = (modalView && modalView.me && modalView.me.ageCategory) || viewerAc;

    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-gray-800 mb-2">STELVIO 헵타곤 (평속 레벨 포지션)</h3>
        {uid ? <FilterRow H={H} gender={gender} category={category} onChange={onFilter} /> : null}
        {body}
        {detailOpen ? (
          <SpeedHeptagonDetailModal
            H={H}
            onClose={function() {
              setDetailOpen(false);
            }}
            view={modalView}
            loading={!modalView}
            gender={modalG}
            category={modalC}
            viewerAc={modalAc}
            onFilterChange={function(g, c) {
              setModalFilter({ g: g, c: c });
            }}
            myDisplayName={userProfile && (userProfile.name || userProfile.displayName) ? String(userProfile.name || userProfile.displayName) : ''}
            viewerUserId={uid}
            viewerGrade={userProfile && userProfile.grade != null ? String(userProfile.grade) : '2'}
          />
        ) : null}
      </div>
    );
  }

  window.StelvioSpeedHeptagonCard = StelvioSpeedHeptagonCard;
})();
