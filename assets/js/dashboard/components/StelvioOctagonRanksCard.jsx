/**
 * STELVIO 헵타곤(7축 레벨 포지션) — getPeakPowerRanking + 분포용 순위(부문/값 기준) 동일.
 * **그래프(면도)**: 축마다 30d·365d W/kg가 있으면 **동일 축** 정규화(롤링 365d≥30d)로 반지름; 없으면 순위→반지름 + 365d≥30d `max` 보정(순위만으로는 기간·코호트가 달라 보라·녹 역전 가능).
 * **집계 순위·레벨%·중앙 배지**: 카드(및 항목별 순위 모달)의 **선택 `gender`·`category`** 로 `heptagon_cohort_ranks` “동일 조건·월(환산) 점수”와 동기화. 7각형 W/kg 레이더는 **건드리지 않음**.
 * **레벨%** / **n 표기**: `heptagonUseNeffNPlusOne` — **가상·타 연령 부문**에만 Neff=n+1. **전체(Supremo)**·**본인 부문**은 집계 n만. Neff·n≥100 / Neff·n<100 식, r 1‥Neff.
 * **7축** 랭킹·표는 `getPeakPowerRanking` (선택 부문·성별).
 * Firestore: `heptagon_rank_log/{uid}` (동기화). 팝업: 성별·부문 `heptagon_cohort_ranks` 순위표.
 */
/* global React, useState, useEffect, useMemo, window */
(function() {
  'use strict';
  if (!window.React) return;
  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;

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

  /** 프로필 `ageCategory`가 카드 부문 옵션과 일치할 때만 (나의 순위가 실집계로 묶이는 부문) */
  function categoryValueMatchingUserAge(userProfile) {
    if (!userProfile || userProfile.ageCategory == null) return null;
    var ac = String(userProfile.ageCategory).trim();
    if (!ac) return null;
    for (var ci = 0; ci < CATEGORY_OPTIONS.length; ci++) {
      if (CATEGORY_OPTIONS[ci].value === ac) return ac;
    }
    return null;
  }

  /**
   * 필터된 동일 조건 표 `rows`만으로도 모수 추정: max(boardRank) vs 행 수 중 큰 값(쿼리 n 실패·500명 밖 본인 삽입 등).
   */
  function nCohortFromHeptagonBoardRows(boardState) {
    if (!boardState || boardState.err) {
      return 0;
    }
    var rows = boardState.rows;
    if (!rows || !rows.length) {
      return 0;
    }
    var maxR = 0;
    for (var i = 0; i < rows.length; i++) {
      var br = rows[i] && rows[i].boardRank != null && isFinite(rows[i].boardRank) ? Math.floor(Number(rows[i].boardRank)) : 0;
      if (br > maxR) {
        maxR = br;
      }
    }
    var nList = rows.length;
    return Math.max(maxR, nList) | 0;
  }

  /** 동일 조건 표 n → 표 rows 산출 → ovl nTotal(집계·가상) 순(카테고리 필터) */
  function heptagonEffectiveCohortNFromBoardAndOvl(boardState, ovl) {
    if (!boardState || boardState.err) {
      if (ovl && !ovl.loading && ovl.nTotal != null && isFinite(ovl.nTotal) && (ovl.nTotal | 0) >= 1) {
        return ovl.nTotal | 0;
      }
      return 0;
    }
    var b = boardState.nCohort | 0;
    if (b >= 1) {
      return b;
    }
    b = nCohortFromHeptagonBoardRows(boardState);
    if (b >= 1) {
      return b;
    }
    if (ovl && !ovl.loading && ovl.nTotal != null && isFinite(ovl.nTotal) && (ovl.nTotal | 0) >= 1) {
      return ovl.nTotal | 0;
    }
    return 0;
  }

  /**
   * getPeakPowerRanking 피크 파워: **W/kg만** (TSS·주간 적산 제외 — 순위 왜곡 방지)
   * 12시=Max, 시계방향 Max → 1·5·10·20·40·60분
   */
  var AXES = [
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
  var N_WKG_AXES = DURATIONS.length;

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
    var byCategory = data.byCategory;
    var cuValid = cu && String(cu.userId) === String(uid);
    var userAgeCat = cuValid ? cu.ageCategory : null;

    if (category === 'Supremo') {
      var supArr = byCategory.Supremo || [];

      /* [1] cu.rank — API가 사용자를 찾아 돌려준 Supremo 순위(가장 정확) */
      if (cuValid && cu.rank != null) {
        var supremoRank = safeFloorRank(cu.rank);
        if (supremoRank != null) return supremoRank;
      }

      /* [2] byCategory.Supremo 배열에서 userId 직접 검색
       *     → API lookup order 이슈나 cuValid 불일치 시에도 동작 */
      var supIdx = supArr.findIndex(function(e) {
        return e && String(e.userId) === String(uid);
      });
      if (supIdx >= 0) return supIdx + 1;

      /* [3] cu.wkg 값을 Supremo 배열과 비교해 순위 추정
       *     byCategory.Supremo는 전체 참가자 목록이므로 추정이 아닌 실제 순위
       *     cu.rank가 null이어도 wkg가 있으면(=데이터는 있으나 API rank 미반영) 사용 */
      if (cuValid && supArr.length > 0) {
        var myWkg = rowMetricValue(cu, duration);
        if (myWkg != null && isFinite(myWkg) && myWkg > 0) {
          var estRank = rankInCategoryByValue(supArr, myWkg, duration);
          if (estRank != null) return estRank;
        }
      }

      /* [4] cu가 없더라도(userId 불일치·API 미반환) 해당 duration에 age-category 배열에서
       *     userId를 찾을 수 있으면 그 entry의 wkg로 Supremo 위치를 추정 */
      if (!cuValid && supArr.length > 0) {
        var ageCats = Object.keys(byCategory);
        for (var ai = 0; ai < ageCats.length; ai++) {
          var ac = ageCats[ai];
          if (ac === 'Supremo') continue;
          var acArr = byCategory[ac] || [];
          var acEntry = null;
          for (var aj = 0; aj < acArr.length; aj++) {
            if (acArr[aj] && String(acArr[aj].userId) === String(uid)) {
              acEntry = acArr[aj];
              break;
            }
          }
          if (acEntry) {
            /* entry.rank = Supremo 배열 내 순위(서버가 부여) */
            if (acEntry.rank != null) {
              var aer = safeFloorRank(acEntry.rank);
              if (aer != null) return aer;
            }
            var acWkg = rowMetricValue(acEntry, duration);
            if (acWkg != null && isFinite(acWkg) && acWkg > 0) {
              var acEst = rankInCategoryByValue(supArr, acWkg, duration);
              if (acEst != null) return acEst;
            }
            break;
          }
        }
      }

      return null;
    }

    /* ── Supremo 외 부문 ── */
    if (!cuValid) {
      /* cuValid 실패 시에도 byCategory에서 uid 검색 후 rank 반환 */
      var acCats2 = Object.keys(byCategory);
      for (var bi = 0; bi < acCats2.length; bi++) {
        var bc = acCats2[bi];
        var bcArr = byCategory[bc] || [];
        for (var bj = 0; bj < bcArr.length; bj++) {
          if (bcArr[bj] && String(bcArr[bj].userId) === String(uid)) {
            var bcEntry = bcArr[bj];
            /* 요청 category의 배열인 경우에만 위치 순위 사용 */
            if (bc === category) return bj + 1;
            /* category 배열에서 wkg 비교로 추정 */
            var catArr = byCategory[category] || [];
            var bcWkg = rowMetricValue(bcEntry, duration);
            if (bcWkg != null && isFinite(bcWkg) && bcWkg > 0 && catArr.length > 0) {
              var bcEst = rankInCategoryByValue(catArr, bcWkg, duration);
              if (bcEst != null) return rankDisplayForChart(bcEst);
            }
            break;
          }
        }
      }
      return null;
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

  /** 랭킹 API에서 나의 ageCategory(부문) 등 */
  function fetchRankingUserMeta(uid, gender) {
    return fetchRankingPayload(uid, 'max', 'monthly', gender).then(function(data) {
      var cu = data && data.currentUser;
      if (!cu) return { ageCategory: '', displayName: '' };
      return {
        ageCategory: cu.ageCategory != null ? String(cu.ageCategory) : '',
        displayName: cu.name != null ? String(cu.name) : ''
      };
    });
  }

  function cohortSizeForCategory(data, category) {
    if (!data || !data.success || !data.byCategory) return 0;
    var arr = data.byCategory[category];
    return Array.isArray(arr) ? arr.length : 0;
  }

  /**
   * `heptagon_cohort_ranks` / 랭킹과 동일: 사용자가 선택 부문·코호트에 “소속”되는지(전체 Supremo는 항상 true).
   */
  function isUserInCohortForFilter(filterCategory, userAgeCategory) {
    var f = String(filterCategory != null ? filterCategory : 'Supremo');
    var ac = String(userAgeCategory != null ? userAgeCategory : '');
    if (f === 'Supremo') {
      return true;
    }
    if (f === 'Assoluto') {
      return ac === 'Assoluto';
    }
    if (!ac) {
      return false;
    }
    return ac === f;
  }

  /**
   * Neff=n+1: API `isVirtualCohort`가 true이고(타 부문 가상) **전체(Supremo) 아님**이며,
   * **프로필/랭킹으로 확인되는 연령 부문이 필터와 같으면(본인 부문)** → 절대 +1 하지 않음.
   */
  function heptagonUseNeffNPlusOne(filterCategory, userAgeCategory, isVirtualCohort) {
    if (isVirtualCohort !== true) {
      return false;
    }
    var f = String(filterCategory != null ? filterCategory : 'Supremo');
    if (f === 'Supremo') {
      return false;
    }
    var ac = userAgeCategory != null ? String(userAgeCategory).trim() : '';
    if (ac && isUserInCohortForFilter(f, ac)) {
      return false;
    }
    return true;
  }

  function heptagonCohortNDisplay(nRaw, filterCategory, userAgeCategory, isVirtualCohort) {
    var n = nRaw | 0;
    if (n < 1) {
      return 0;
    }
    if (heptagonUseNeffNPlusOne(filterCategory, userAgeCategory, isVirtualCohort)) {
      return n + 1;
    }
    return n;
  }

  /**
   * 항목별 **포지션 점수** 0~100: 1등=100, 꼴등=0, 중간=선형 (등수 n명 기준, r=1..n).
   * positionRatio = (n - r) / (n - 1) (n>1), n===1 → 100.
   */
  function positionScore100FromRank(rank, n) {
    var ni = n | 0;
    if (ni < 1) return 0;
    if (rank == null || !isFinite(rank) || rank < 1) return 0;
    var r = Math.floor(Number(rank));
    if (r < 1) r = 1;
    if (r > ni) r = ni;
    if (ni === 1) return 100;
    return (100 * (ni - r)) / (ni - 1);
  }

  /**
   * @deprecated 테이블·레벨엔 `positionScore100FromRank` 사용. (구) 순위/인원 비
   */
  function itemPercentileFromRankAndN(rank, n) {
    var nn = n | 0;
    if (nn < 1) return 100;
    if (rank == null || !isFinite(rank) || rank < 1) return 100;
    return (Number(rank) / nn) * 100;
  }

  /** 해당 축에서 부동 순위 → 리스트 끄트머리(상대 비율 산정용) */
  function effectiveRankForAverage(rank, n) {
    var nn = n | 0;
    if (nn < 1) return null;
    if (rank == null || !isFinite(rank) || rank < 1) return nn;
    var r = Math.floor(Number(rank));
    if (r < 1) r = 1;
    if (r > nn) r = nn;
    return r;
  }

  function fetchRanksSet(uid, period, gender, category) {
    return Promise.all(
      DURATIONS.map(function(d) {
        return fetchRankingPayload(uid, d, period, gender).then(function(data) {
          var cu = data && data.currentUser;
          var cuValid = cu && String(cu.userId) === String(uid);
          var wk = cuValid && cu.wkg != null && isFinite(Number(cu.wkg)) ? Number(cu.wkg) : null;
          /* W/kg 폴백: byCategory 전체를 탐색하여 uid와 일치하는 entry의 wkg 사용 */
          if (wk == null && data && data.byCategory) {
            var allCats = Object.keys(data.byCategory);
            for (var ci = 0; ci < allCats.length && wk == null; ci++) {
              var catArr3 = data.byCategory[allCats[ci]] || [];
              for (var cj = 0; cj < catArr3.length; cj++) {
                var ce = catArr3[cj];
                if (ce && String(ce.userId) === String(uid) && ce.wkg != null && isFinite(Number(ce.wkg))) {
                  wk = Number(ce.wkg);
                  break;
                }
              }
            }
          }
          return {
            rank: computeDisplayRankLikeDistribution(data, uid, category, d),
            n: cohortSizeForCategory(data, category),
            wkg: wk
          };
        });
      })
    );
  }

  /**
   * 30d(보라) vs 365d(녹) 레이더: W/kg이 있으면 **동일 축** max 기준으로 스케일(365≥30 물리 정합);
   * 없을 때(캐시·구버전)는 순위 반지름에 축마다 `max(년, 월)` — 순위만 쓰면 기간·코호트 차로 역전 가능.
   */
  function heptagonRadarDisplayNorms(monthlyRanks, hofRanks, monthlyWkgs, hofWkgs) {
    var outM = [];
    var outH = [];
    for (var i = 0; i < N_WKG_AXES; i++) {
      var rm = monthlyRanks && monthlyRanks[i];
      var ry = hofRanks && hofRanks[i];
      var wm = monthlyWkgs && monthlyWkgs[i] != null && isFinite(Number(monthlyWkgs[i])) ? Number(monthlyWkgs[i]) : null;
      var wy = hofWkgs && hofWkgs[i] != null && isFinite(Number(hofWkgs[i])) ? Number(hofWkgs[i]) : null;
      if (wm != null && wy != null) {
        var wmc = wm >= 0 ? wm : 0;
        var wyc = Math.max(wmc, wy);
        var denom = Math.max(wmc, wyc, 1e-9);
        outM[i] = Math.min(0.99, Math.max(0.08, 0.08 + 0.91 * (wmc / denom)));
        outH[i] = Math.min(0.99, Math.max(0.08, 0.08 + 0.91 * (wyc / denom)));
      } else {
        outM[i] = rankToRadiusNorm(rm);
        outH[i] = Math.max(rankToRadiusNorm(ry), outM[i]);
      }
    }
    return { m: outM, h: outH };
  }

  /** N_WKG_AXES 축(피크 W/kg) rank + 코호트 n + (선택) w/kg 축 → 차트 norm */
  function stateFromRanksArray(monthlyRanks, cohortSizePerAxis, hofRanks, supremoRanks, supremoCohortNPerAxis, monthlyWkgs, hofWkgs) {
    var pair = heptagonRadarDisplayNorms(monthlyRanks, hofRanks, monthlyWkgs, hofWkgs);
    var supremoMonthly = null;
    if (
      supremoRanks &&
      supremoCohortNPerAxis &&
      supremoRanks.length === supremoCohortNPerAxis.length &&
      supremoRanks.length > 0
    ) {
      supremoMonthly = { ranks: supremoRanks, cohortSizePerAxis: supremoCohortNPerAxis };
    }
    return {
      loading: false,
      err: null,
      monthly: { ranks: monthlyRanks, norm: pair.m, cohortSizePerAxis: cohortSizePerAxis, wkg: monthlyWkgs || null },
      hof: { ranks: hofRanks, norm: pair.h, wkg: hofWkgs || null },
      supremoMonthly: supremoMonthly
    };
  }

  function stateFromApiRows(mRows, hRows, sRows) {
    var sr = sRows
      ? sRows.map(function(x) {
          return x.rank;
        })
      : null;
    var sc = sRows
      ? sRows.map(function(x) {
          return x.n;
        })
      : null;
    var mw = mRows.map(function(x) {
      return x.wkg != null && isFinite(x.wkg) ? x.wkg : null;
    });
    var hw = hRows.map(function(x) {
      return x.wkg != null && isFinite(x.wkg) ? x.wkg : null;
    });
    return stateFromRanksArray(
      mRows.map(function(x) {
        return x.rank;
      }),
      mRows.map(function(x) {
        return x.n;
      }),
      hRows.map(function(x) {
        return x.rank;
      }),
      sr,
      sc,
      mw,
      hw
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

  /**
   * i=0 → 12시(위), n각형: 축마다 360/n ° 시계방향
   */
  function axisAngle(i, n) {
    return -Math.PI / 2 + (i * 2 * Math.PI) / n;
  }

  function radarPolygonPoints(ratioArr, cx, cy, rMax) {
    var n = ratioArr && ratioArr.length > 0 ? ratioArr.length : 0;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var t = axisAngle(i, n);
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

  /** 닫힌 다각형 면적(좌표 단위²), 시계/반시계 무관 */
  function shoelaceAreaXY(pts) {
    if (!pts || pts.length < 3) return 0;
    var n = pts.length;
    var s = 0;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      s += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    return Math.abs(s) / 2;
  }

  function polygonAreaFromNormRatios(ratioArr, rMax) {
    var cx = 100;
    var cy = 100;
    var pts = radarPolygonPoints(ratioArr, cx, cy, rMax);
    return shoelaceAreaXY(pts);
  }

  /**
   * 레이더 꼭짓점(norm = 각 축 rankToRadiusNorm)으로 다각형 면적 A만 산출(차트/참고).
   * 종합 N위·% 표시는 **7축 유효순위 산술평균**을 사용하며, 이 면적 보간값은 **표시·종합순위에 쓰지 않음** (과거엔 rSynth로 nRef 꼴찌가 나올 수 있음).
   */
  function comprehensivePercentFromDisplayNorm(norm, nRef) {
    if (!norm || norm.length < 3 || nRef < 1) return null;
    var nVert = norm.length;
    var rMax = 1;
    var A = polygonAreaFromNormRatios(norm, rMax);
    if (!isFinite(A)) return null;
    var r1 = rankToRadiusNorm(1);
    var rW = rankToRadiusNorm(nRef);
    var allBest = [];
    var allWorst = [];
    for (var z = 0; z < nVert; z++) {
      allBest.push(r1);
      allWorst.push(rW);
    }
    var aMax = polygonAreaFromNormRatios(allBest, rMax);
    var aMin = polygonAreaFromNormRatios(allWorst, rMax);
    if (!(aMax > aMin) || !isFinite(aMax) || !isFinite(aMin)) return null;
    var t = (A - aMin) / (aMax - aMin);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var rSynth = 1 + (1 - t) * (nRef - 1);
    if (rSynth < 1) rSynth = 1;
    if (rSynth > nRef) rSynth = nRef;
    return {
      area: A,
      aMax: aMax,
      aMin: aMin,
      rSynthetic: rSynth,
      pComprehensive: (rSynth / nRef) * 100
    };
  }

  /**
   * 소집단(N<100) 100분위 보정: K = 1 + (100−N)/(100+N). 예) N=40 → K=1+60/140≈1.4286. N≥100이면 large 분기·K=1
   */
  function stelvioOctagonSmallGroupK(n) {
    var N = n | 0;
    if (N < 1) N = 1;
    if (N >= 100) return 1;
    return 1 + (100 - N) / (100 + N);
  }

  /**
   * 6개 상한(%) = 레벨1~7 구간(레벨1=HC) 기준. 이후 잔여=레벨7.
   * N≥100: 5,10,20,40,60,80. N<100: max(min(100, B·K), (B/5)·(100/N)) 뒤 단조 증가.
   */
  function stelvioOctagonPercentCutoffs(nRef) {
    var N = nRef | 0;
    if (N < 1) N = 1;
    if (N >= 100) {
      return { k: 1, isLarge: true, cutoffs: [5, 10, 20, 40, 60, 80] };
    }
    var k = stelvioOctagonSmallGroupK(N);
    var bases = [5, 10, 20, 40, 60, 80];
    var cut = [];
    for (var i = 0; i < bases.length; i++) {
      var B = bases[i];
      var sc = B * k;
      if (sc > 100) sc = 100;
      var fl = (B / 5) * (100 / N);
      var v = Math.max(sc, fl);
      if (v > 100) v = 100;
      if (i > 0) {
        if (v <= cut[i - 1]) v = cut[i - 1] + 0.0001;
        if (v > 100) v = 100;
        if (v <= cut[i - 1]) v = 100;
      }
      cut.push(v);
    }
    return { k: k, isLarge: false, cutoffs: cut };
  }

  function tierIdFromPAndPercentCutoffs(pTotal, co) {
    if (pTotal <= co[0]) {
      return { id: 'HC', text: 'HC', labelShort: 'HC' };
    }
    if (pTotal <= co[1]) {
      return { id: 'C1', text: 'Cat 1', labelShort: 'Cat 1' };
    }
    if (pTotal <= co[2]) {
      return { id: 'C2', text: 'Cat 2', labelShort: 'Cat 2' };
    }
    if (pTotal <= co[3]) {
      return { id: 'C3', text: 'Cat 3', labelShort: 'Cat 3' };
    }
    if (pTotal <= co[4]) {
      return { id: 'C4', text: 'Cat 4', labelShort: 'Cat 4' };
    }
    if (pTotal <= co[5]) {
      return { id: 'C5', text: 'Cat 5', labelShort: 'Cat 5' };
    }
    return { id: 'C6', text: 'Cat 6', labelShort: 'Cat 6' };
  }

  /**
   * 집계 레벨%: `n`은 **실집계 코호트 인원**. `heptagonUseNeffNPlusOne`일 때만 Neff=n+1(가상·타 부문). 전체·본인 부문은 n.
   * Neff≥100 → (r÷Neff)×100, Neff<100 → n₂=100÷Neff, ((r÷Neff)÷n₂)×100. 등급(동물)은 `heptagonBoardTierIdFromLevelPercent`.
   */
  var HEPTAGON_BOARD_PCT_CUTS = [5, 10, 20, 40, 60, 80];

  function heptagonLevelPercentForRankN(boardRank, n, isVirtualCohort, filterCategory, userAgeCategory) {
    var Nc = n | 0;
    if (Nc < 1) return 0;
    var useNeff = heptagonUseNeffNPlusOne(filterCategory, userAgeCategory, isVirtualCohort);
    var r = boardRank == null || !isFinite(boardRank) ? 1 : Math.floor(Number(boardRank));
    if (r < 1) r = 1;
    var Neff = useNeff ? Nc + 1 : Nc;
    if (r > Neff) r = Neff;
    var p;
    if (Neff >= 100) {
      p = (r / Neff) * 100;
    } else {
      var n2 = 100 / Neff;
      p = ((r / Neff) / n2) * 100;
    }
    if (!isFinite(p) || p < 0) p = 0;
    if (p > 100) p = 100;
    return p;
  }

  function heptagonBoardTierIdFromLevelPercent(p) {
    if (!isFinite(p)) {
      return { id: 'C6', text: 'Cat 6', labelShort: 'Cat 6' };
    }
    if (p <= 5) {
      return { id: 'HC', text: 'HC', labelShort: 'HC' };
    }
    if (p <= 10) {
      return { id: 'C1', text: 'Cat 1', labelShort: 'Cat 1' };
    }
    if (p <= 20) {
      return { id: 'C2', text: 'Cat 2', labelShort: 'Cat 2' };
    }
    if (p <= 40) {
      return { id: 'C3', text: 'Cat 3', labelShort: 'Cat 3' };
    }
    if (p <= 60) {
      return { id: 'C4', text: 'Cat 4', labelShort: 'Cat 4' };
    }
    if (p <= 80) {
      return { id: 'C5', text: 'Cat 5', labelShort: 'Cat 5' };
    }
    return { id: 'C6', text: 'Cat 6', labelShort: 'Cat 6' };
  }

  function heptagonBoardTierObjectFromRankN(boardRank, n, isVirtualCohort, filterCategory, userAgeCategory) {
    var Nc = n | 0;
    if (Nc < 1) {
      return { tier: { id: 'C6', text: 'Cat 6', labelShort: 'Cat 6' }, mode: 'none', pRank: 0, upperRankBounds: null };
    }
    var p = heptagonLevelPercentForRankN(boardRank, Nc, isVirtualCohort, filterCategory, userAgeCategory);
    return { tier: heptagonBoardTierIdFromLevelPercent(p), mode: 'percent', pRank: p, upperRankBounds: null };
  }

  /**
   * `heptagon_cohort_ranks` 집계(월·필터): 전면 환산 합 기준 집계 순위, 레벨%·레벨은 `heptagonBoardTierObjectFromRankN`.
   * @param {object|null} tierBase 7축·합산(포지션 점수) 기반 요약
   * @param {{ loading?: boolean, skip?: boolean, err?: boolean, nTotal?: number, boardRank?: number, cohortData?: object, isVirtualCohort?: boolean }} ovl
   *         `isVirtualCohort`: 타 부문 열람(가상)만 true, Supremo·본인 부문 실문서는 false. 레벨% → `heptagonLevelPercentForRankN`.
   */
  function applyCohortBoardMerge(tierBase, ovl, filterCategory, userAgeCategory) {
    if (!tierBase) {
      return null;
    }
    if (!ovl || ovl.loading) {
      return tierBase;
    }
    if (ovl.err) {
      return tierBase;
    }
    if (ovl.skip) {
      return tierBase;
    }
    var nTot = ovl.nTotal != null && isFinite(ovl.nTotal) ? Math.max(0, Math.floor(Number(ovl.nTotal))) : 0;
    if (nTot < 1) {
      return tierBase;
    }
    var br = ovl.boardRank;
    if (br == null && ovl.cohortData) {
      var d0 = ovl.cohortData;
      br = d0.boardRank;
      if (br == null && d0.comprehensiveRank != null) {
        br = d0.comprehensiveRank;
      }
    }
    if (br == null || !isFinite(br)) {
      return tierBase;
    }
    var isVirt = ovl.isVirtualCohort === true;
    var useNeff = heptagonUseNeffNPlusOne(filterCategory, userAgeCategory, isVirt);
    var brMax = useNeff ? nTot + 1 : nTot;
    if (!isVirt) {
      br = Math.max(1, Math.min(nTot, Math.floor(Number(br))));
    } else {
      br = Math.max(1, Math.min(brMax, Math.floor(Number(br))));
    }
    var hb = heptagonBoardTierObjectFromRankN(br, nTot, isVirt, filterCategory, userAgeCategory);
    var pRank = hb.pRank;
    var out = Object.assign({}, tierBase);
    out.pTier = pRank;
    out.pTotal = pRank;
    out.pComprehensive = pRank;
    out.comprehensiveRank = br;
    out.rankAverage = br;
    out.cohortN = nTot;
    out.heptagonBoardVirtualCohort = isVirt;
    out.tier = hb.tier;
    out.tierPercentCutoffs = HEPTAGON_BOARD_PCT_CUTS;
    out.kAdjust = 1;
    out.isLargeCohort = (useNeff ? nTot + 1 : nTot) >= 100;
    out.heptagonBoardTierMode = hb.mode;
    out.heptagonBoardUpperRankBounds = hb.upperRankBounds;
    var d = ovl.cohortData;
    if (d) {
      if (d.sumPositionScores != null && isFinite(Number(d.sumPositionScores))) {
        out.sumPositionScores = Number(d.sumPositionScores);
      }
      if (d.avgPositionScore != null && isFinite(Number(d.avgPositionScore))) {
        out.avgPositionScore = Number(d.avgPositionScore);
      }
    }
    out.heptagonCohortBoardRankApplied = true;
    out.heptagonCohortBoardRank = br;
    return out;
  }

  /**
   * `loadStelvioCohortOvlData` / 동일 집계(카드 ovl)에서 순위·n — 리스트에 본인 행이 없어도 표·툴팁에 반영.
   * `applyCohortBoardMerge`와 동일한 rank·n·가상 여부(클램프) 사용.
   */
  function stelvioOvlBoardRankNForDisplay(ovl, filterCategory, userAgeCategory) {
    if (!ovl || ovl.loading || ovl.err || ovl.skip) {
      return null;
    }
    var nTot = ovl.nTotal != null && isFinite(ovl.nTotal) ? Math.max(0, Math.floor(Number(ovl.nTotal))) : 0;
    if (nTot < 1) {
      return null;
    }
    var br = ovl.boardRank;
    if (br == null && ovl.cohortData) {
      var d0 = ovl.cohortData;
      br = d0.boardRank;
      if (br == null && d0.comprehensiveRank != null) {
        br = d0.comprehensiveRank;
      }
    }
    if (br == null || !isFinite(br)) {
      return null;
    }
    var isVirt = ovl.isVirtualCohort === true;
    var useNeff = heptagonUseNeffNPlusOne(filterCategory, userAgeCategory, isVirt);
    var brMax = useNeff ? nTot + 1 : nTot;
    if (!isVirt) {
      br = Math.max(1, Math.min(nTot, Math.floor(Number(br))));
    } else {
      br = Math.max(1, Math.min(brMax, Math.floor(Number(br))));
    }
    return { br: br, nTot: nTot, isVirt: isVirt };
  }

  /**
   * 레벨: 7축 **포지션 점수** 합(0~700)·평균(0~100) → `pTier = 100 - 평균` (낮을수록 상위) + 구간(소수 n은 K·상한).
   * **종합 N위** `comprehensiveRank` = 7축 100분위(포지션) **합 S**·`0~700` → 동일 nRef 띠에서
   * `1 + (1 - S/700)(nRef-1)` (S↑ → 1위에 가깝게). `pComprehensive` = (그 값 / nRef)·100. 면적과 독립.
   * 그래프 `displayNorm`는 기존 log 스케일.
   */
  function comprehensiveRankFromSumPosition100(sum0to700, nRef) {
    var n = nRef | 0;
    if (n < 1) return NaN;
    var s = Number(sum0to700);
    if (!isFinite(s)) return NaN;
    if (s < 0) s = 0;
    if (s > 700) s = 700;
    if (n === 1) {
      return 1;
    }
    var r = 1 + (1 - s / 700) * (n - 1);
    if (r < 1) r = 1;
    if (r > n) r = n;
    return r;
  }

  function computePTotalAndTier(ranks, cohortNPerAxis) {
    if (!ranks || !cohortNPerAxis || ranks.length !== N_WKG_AXES || cohortNPerAxis.length !== N_WKG_AXES) {
      return null;
    }
    var nRef = 0;
    for (var k = 0; k < N_WKG_AXES; k++) {
      var nk0 = cohortNPerAxis[k] | 0;
      if (nk0 > nRef) nRef = nk0;
    }
    if (nRef < 1) return null;

    var posScores = [];
    var allOk = true;
    var displayNorm = [];
    for (var i = 0; i < N_WKG_AXES; i++) {
      var ni = (cohortNPerAxis[i] | 0) > 0 ? cohortNPerAxis[i] : nRef;
      var er = effectiveRankForAverage(ranks[i], ni);
      if (er == null) {
        allOk = false;
        break;
      }
      posScores.push(positionScore100FromRank(ranks[i], ni));
      displayNorm.push(rankToRadiusNorm(ranks[i]));
    }
    if (!allOk) return null;

    var sumPos = 0;
    for (var j = 0; j < posScores.length; j++) sumPos += posScores[j];
    var avgPos = sumPos / N_WKG_AXES;
    if (!isFinite(avgPos)) avgPos = 0;
    if (avgPos < 0) avgPos = 0;
    if (avgPos > 100) avgPos = 100;

    /** ‘상위%’ 티어 매핑(낮을수록 상위): 평균 포지션이 높을수록 pTier 낮음 */
    var pTier = 100 - avgPos;
    if (!isFinite(pTier)) pTier = 100;
    if (pTier < 0) pTier = 0;
    if (pTier > 100) pTier = 100;

    var cspec = stelvioOctagonPercentCutoffs(nRef);
    var tier = tierIdFromPAndPercentCutoffs(pTier, cspec.cutoffs);

    var comp = comprehensivePercentFromDisplayNorm(displayNorm, nRef);
    var rFromSumPos = comprehensiveRankFromSumPosition100(sumPos, nRef);
    if (!isFinite(rFromSumPos)) {
      return null;
    }
    var pComprehensive = nRef >= 1 ? (rFromSumPos / nRef) * 100 : pTier;
    var rAvg = Math.max(1, Math.min(nRef, Math.round(rFromSumPos)));

    return {
      itemP: posScores,
      positionScores100: posScores,
      sumPositionScores: sumPos,
      avgPositionScore: avgPos,
      pTotal: pTier,
      pTier: pTier,
      /** 7축 100분위(포지션) 합 → 동일 nRef 띠 대응값 / nRef · 100 */
      pLegacyRankAvg: pComprehensive,
      /** `comprehensiveRank` 정수에 가깝게(폴백) */
      rankAverage: rAvg,
      cohortN: nRef,
      tier: tier,
      kAdjust: cspec.k,
      isLargeCohort: cspec.isLarge,
      tierPercentCutoffs: cspec.cutoffs,
      displayNorm: displayNorm,
      octagonArea: comp ? comp.area : null,
      octagonAreaMax: comp ? comp.aMax : null,
      octagonAreaMin: comp ? comp.aMin : null,
      /** 0~700 합 S 기준 nRef 띠 상 동급순위(실수) — 툴팁 N위·Firestore는 반올림/클램프 */
      comprehensiveRank: rFromSumPos,
      pComprehensive: pComprehensive
    };
  }

  function currentMonthKeyKst() {
    var t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
  }

  function tierObjectFromStelvioId(id) {
    var m = {
      HC: { id: 'HC', text: 'HC', labelShort: 'HC' },
      C1: { id: 'C1', text: 'Cat 1', labelShort: 'Cat 1' },
      C2: { id: 'C2', text: 'Cat 2', labelShort: 'Cat 2' },
      C3: { id: 'C3', text: 'Cat 3', labelShort: 'Cat 3' },
      C4: { id: 'C4', text: 'Cat 4', labelShort: 'Cat 4' },
      C5: { id: 'C5', text: 'Cat 5', labelShort: 'Cat 5' },
      C6: { id: 'C6', text: 'Cat 6', labelShort: 'Cat 6' }
    };
    return m[id] || m.C6;
  }

  /**
   * 툴팁 N위(정수)와 동일. 저장·Firestore `comprehensiveRank`에 사용.
   * (7축 `comprehensiveRank` 실수·폴백 — heptagon 집계-only 표시는 `heptagonCardRankFromSummary` 사용)
   */
  function comprehensiveRankUiFromTierSummary(ts, filterCategory, userAgeCategory) {
    if (!ts) return null;
    var nC = ts.cohortN != null && isFinite(Number(ts.cohortN)) ? Math.max(0, Math.floor(Number(ts.cohortN))) : 0;
    var isV = ts.heptagonBoardVirtualCohort === true;
    var useN = heptagonUseNeffNPlusOne(filterCategory, userAgeCategory, isV);
    var cap = nC > 0 ? (useN ? nC + 1 : nC) : 0;
    var rSynth = ts.comprehensiveRank != null && isFinite(Number(ts.comprehensiveRank)) ? Number(ts.comprehensiveRank) : NaN;
    if (isNaN(rSynth) && ts.rankAverage != null && isFinite(Number(ts.rankAverage))) {
      rSynth = Number(ts.rankAverage);
    }
    if (isNaN(rSynth)) return null;
    return Math.max(1, cap > 0 ? Math.min(cap, Math.round(rSynth)) : Math.max(1, Math.round(rSynth)));
  }

  /**
   * 카드·모달: 성별+카테고리 `heptagon_cohort_ranks` 집계(동일 조건·월(환산) 점수)로만 N위. 병합 전(7축) 값은 쓰지 않음.
   */
  function heptagonCardRankFromSummary(ts, filterCategory, userAgeCategory) {
    if (!ts || ts.heptagonCohortBoardRankApplied !== true) {
      return null;
    }
    var br0 = ts.heptagonCohortBoardRank;
    if (br0 == null && ts.comprehensiveRank != null && isFinite(Number(ts.comprehensiveRank))) {
      br0 = Number(ts.comprehensiveRank);
    }
    if (br0 == null || !isFinite(br0)) {
      return null;
    }
    var nC = ts.cohortN != null && isFinite(Number(ts.cohortN)) ? Math.max(0, Math.floor(Number(ts.cohortN))) : 0;
    var isV = ts.heptagonBoardVirtualCohort === true;
    var useN = heptagonUseNeffNPlusOne(filterCategory, userAgeCategory, isV);
    var cap = nC > 0 ? (useN ? nC + 1 : nC) : 0;
    var r = Math.floor(Number(br0));
    if (cap > 0) {
      r = Math.max(1, Math.min(cap, r));
    } else {
      r = Math.max(1, r);
    }
    return r;
  }

  /**
   * 동일 조건·월(환산) 점수 집계: 순위·대상자 모수 n·가상 여부 → `heptagonLevelPercentForRankN` 레벨% (툴팁·힌트).
   */
  function heptagonCohortTooltipFromSummary(s, filterCategory, userAgeCategory) {
    if (!s || s.heptagonCohortBoardRankApplied !== true) {
      return { ok: false, rank: null, nCohort: 0, pPct: -1, isVirtual: false };
    }
    var nC = s.cohortN != null && isFinite(Number(s.cohortN)) ? Math.max(0, Math.floor(Number(s.cohortN))) : 0;
    var isV = s.heptagonBoardVirtualCohort === true;
    if (nC < 1) {
      return { ok: false, rank: heptagonCardRankFromSummary(s, filterCategory, userAgeCategory), nCohort: 0, pPct: -1, isVirtual: isV };
    }
    var br0 = s.heptagonCohortBoardRank;
    if (br0 == null && s.comprehensiveRank != null && isFinite(Number(s.comprehensiveRank))) {
      br0 = Number(s.comprehensiveRank);
    }
    if (br0 == null || !isFinite(br0)) {
      return { ok: false, rank: null, nCohort: heptagonCohortNDisplay(nC, filterCategory, userAgeCategory, isV), pPct: -1, isVirtual: isV };
    }
    var pPct = heptagonLevelPercentForRankN(br0, nC, isV, filterCategory, userAgeCategory);
    var rankU = heptagonCardRankFromSummary(s, filterCategory, userAgeCategory);
    if (rankU == null) {
      return { ok: false, rank: null, nCohort: heptagonCohortNDisplay(nC, filterCategory, userAgeCategory, isV), pPct: pPct, isVirtual: isV };
    }
    return { ok: true, rank: rankU, nCohort: heptagonCohortNDisplay(nC, filterCategory, userAgeCategory, isV), pPct: pPct, isVirtual: isV };
  }

  /**
   * `동일 조건·월(환산) 점수 순위` 표(카드 필터)에서 본인 행 `boardRank` + 모수 n.
   */
  function getMyRankFromHeptagonBoardRows(boardState) {
    if (!boardState || boardState.err) {
      return null;
    }
    var rows = boardState.rows || [];
    for (var ri = 0; ri < rows.length; ri++) {
      if (rows[ri].isMe && rows[ri].boardRank != null && isFinite(rows[ri].boardRank)) {
        return {
          boardRank: Math.floor(Number(rows[ri].boardRank)),
          nCohort: (boardState.nCohort | 0) > 0 ? boardState.nCohort | 0 : 0
        };
      }
    }
    return null;
  }

  /**
   * 월·필터가 일치하고 `comprehensiveRank`·`tierId`가 있을 때만 중앙 오버레이용 요약(로딩 스텁).
   */
  function summaryFromHeptagonRankLogIfMatch(d, nowMonthKey, g, c) {
    if (!d || d.monthKey !== nowMonthKey || d.filterGender !== g || d.filterCategory !== c) {
      return null;
    }
    if (d.comprehensiveRank == null || !isFinite(Number(d.comprehensiveRank)) || d.tierId == null) {
      return null;
    }
    var nRef = d.nRef != null && isFinite(Number(d.nRef)) ? Math.max(0, Math.floor(Number(d.nRef))) : 0;
    var pTier =
      d.pTier != null && isFinite(Number(d.pTier))
        ? Number(d.pTier)
        : d.pComprehensive != null && isFinite(Number(d.pComprehensive))
          ? Number(d.pComprehensive)
          : -1;
    if (pTier < 0) {
      return null;
    }
    var pC =
      d.pComprehensive != null && isFinite(Number(d.pComprehensive)) ? Number(d.pComprehensive) : pTier;
    return {
      itemP: d.positionScores100,
      positionScores100: d.positionScores100,
      sumPositionScores: d.sumPositionScores,
      avgPositionScore: d.avgPositionScore,
      pTotal: pTier,
      pTier: pTier,
      pComprehensive: pC,
      rankAverage: d.comprehensiveRank,
      cohortN: nRef,
      tier: tierObjectFromStelvioId(String(d.tierId)),
      kAdjust: 1,
      isLargeCohort: nRef >= 100,
      tierPercentCutoffs: null,
      displayNorm: null,
      octagonArea: null,
      octagonAreaMax: null,
      octagonAreaMin: null,
      comprehensiveRank: Number(d.comprehensiveRank)
    };
  }

  var TIER_STYLE = {
    HC: { color: '#ff1a1a', shadow: '0 0 12px #ff1a1a, 0 0 20px rgba(255,0,0,0.45)' },
    C1: { color: '#ff6b3d', shadow: '0 0 12px rgba(255,107,61,0.85), 0 0 24px rgba(255,60,0,0.4)' },
    C2: { color: '#ffb020', shadow: '0 0 10px rgba(255,176,32,0.7), 0 0 20px rgba(200,100,0,0.35)' },
    C3: { color: '#e8c547', shadow: '0 0 8px rgba(232,197,71,0.6)' },
    C4: { color: '#9fe870', shadow: '0 0 8px rgba(140,200,100,0.5)' },
    C5: { color: '#94a3b8', shadow: '0 0 6px rgba(148,163,184,0.5)' },
    C6: { color: '#7c8aa0', shadow: '0 0 4px rgba(100,110,120,0.4)' }
  };

  function tierStyleForId(id) {
    return TIER_STYLE[id] || TIER_STYLE.C6;
  }

  function tierBadgeImageSrc(tierId) {
    var m = { HC: 'hc.png', C1: 'c1.png', C2: 'c2.png', C3: 'c3.png', C4: 'c4.png', C5: 'c5.png', C6: 'c6.png' };
    return 'assets/img/' + (m[tierId] || 'c6.png');
  }

  /** 헵타곤 중앙 이미지 하단 표기용(레벨A=HC) */
  function tierLevelDisplayName(tierId) {
    var m = { HC: '레벨A', C1: '레벨B', C2: '레벨C', C3: '레벨D', C4: '레벨E', C5: '레벨F', C6: '레벨G' };
    return m[tierId] || '레벨G';
  }

  /**
   * index.html 랭킹 `buildSupremoRow` 와 동일: 비공개 + grade2 → 첫 글자** , grade1(관리자) → 풀명(길이 제한) + [비] 뱃지
   */
  /** HeptagonRankDetailModal — 코호트 랭킹(점수 합) 조회 오류 문구(인덱스 대기 / 미배포 구분) */
  function stelvioHeptagonRankListErrorMessage(err) {
    if (err == null) {
      return '순위표를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.';
    }
    var s = String(err).toLowerCase();
    if (s.indexOf('building') >= 0 || s.indexOf('cannot be used yet') >= 0) {
      return '복합 인덱스가 Firestore에 아직 구축 중입니다. 콘솔 → Firestore → 인덱스에서 해당 인덱스가 Enabled(준비됨)으로 바뀐 뒤(수 분~십수 분) 다시 열어 주세요.';
    }
    if (s.indexOf('index') >= 0) {
      return '복합 인덱스가 아직 없거나 쿼리와 맞지 않습니다. `firestore.indexes.json` 배포 후 인덱스가 완성될 때까지 기다리거나, 콘솔 오류에 나온 링크로 인덱스를 생성하세요.';
    }
    return '순위표를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.';
  }

  function stelvioNeighborNameParts(rawName, isPrivate, rowUserId, viewerUserId, viewerGrade) {
    var maxNameLenS = 12;
    var raw = rawName == null || String(rawName).trim() === '' ? '(이름 없음)' : String(rawName);
    var vg = viewerGrade != null ? String(viewerGrade) : '2';
    var isAdmin = vg === '1' || Number(vg) === 1;
    var isCurrent = viewerUserId && rowUserId && String(viewerUserId) === String(rowUserId);
    var canSeeFull = isCurrent || isAdmin;
    if (isPrivate) {
      if (canSeeFull) {
        return {
          text: raw.length > maxNameLenS ? raw.substring(0, maxNameLenS - 2) + '..' : raw,
          showPrivateBadge: true,
          title: raw
        };
      }
      return { text: raw.length >= 2 ? raw.charAt(0) + '**' : '**', showPrivateBadge: false, title: '' };
    }
    return {
      text: raw.length > maxNameLenS ? raw.substring(0, maxNameLenS - 2) + '..' : raw,
      showPrivateBadge: false,
      title: raw
    };
  }

  function mapHeptagonCohortToBoardRow(d, myUid) {
    return {
      userId: d.userId != null ? String(d.userId) : '',
      displayName: (d.displayName && String(d.displayName).trim()) || '—',
      boardRank: d.boardRank != null && isFinite(Number(d.boardRank)) ? Math.floor(Number(d.boardRank)) : null,
      sumPositionScores: d.sumPositionScores != null && isFinite(Number(d.sumPositionScores)) ? Number(d.sumPositionScores) : null,
      isPrivate: d.is_private === true,
      isMe: !!(myUid && d.userId != null && String(d.userId) === String(myUid)),
      isInserted: false
    };
  }

  /**
   * `queryStelvioHeptagonCohortBoardN` max(boardRank)가 인덱스/목록(500건)과 어긋날 수 있어,
   * 목록에서 보이는 max(boardRank)와 length로 상한을 맞춘다.
   */
  function reconcileHeptagonCohortNFromList(nFromQuery, items) {
    var nQ = nFromQuery | 0;
    if (!items || !items.length) {
      return nQ;
    }
    var maxR = 0;
    for (var i = 0; i < items.length; i++) {
      var x = items[i];
      var b = x && x.boardRank != null && isFinite(x.boardRank) ? Math.floor(Number(x.boardRank)) : 0;
      if (b > maxR) maxR = b;
    }
    var nList = items.length;
    var listN = Math.max(maxR, nList);
    if (listN < 1) {
      return nQ;
    }
    if (nQ > 0 && nQ > listN) {
      return listN;
    }
    if (nQ >= 1) {
      return nQ;
    }
    return listN;
  }

  /**
   * 본인 환산 합(필터 문서·없으면 전면)으로 전면과 동일한 점수 순 정렬, 표시 순위 = 1..N, sum 없으면 집계 boardRank 삽입 방식.
   * @param {object|null} myCohortDataFilter 현재 필터 getEntry
   * @param {object|null} myCohortDataSupr 전면 getEntry(환산 합)
   */
  function buildHeptagonModalBoardRows(leadersRaw, myUid, myCohortDataFilter, myCohortDataSupr) {
    myCohortDataSupr = myCohortDataSupr || null;
    var mySum = null;
    if (myCohortDataFilter && myCohortDataFilter.sumPositionScores != null && isFinite(Number(myCohortDataFilter.sumPositionScores))) {
      mySum = Number(myCohortDataFilter.sumPositionScores);
    } else if (myCohortDataSupr && myCohortDataSupr.sumPositionScores != null && isFinite(Number(myCohortDataSupr.sumPositionScores))) {
      mySum = Number(myCohortDataSupr.sumPositionScores);
    }
    if (mySum == null || !isFinite(mySum)) {
      return buildHeptagonModalBoardRowsByBoardRankOnly(
        leadersRaw,
        myUid,
        myCohortDataFilter != null ? myCohortDataFilter : myCohortDataSupr
      );
    }
    var leaders = (leadersRaw || []).map(function(d) {
      return mapHeptagonCohortToBoardRow(d, myUid);
    });
    if (!myUid) {
      return renumberHeptagonBoardDisplayRanksOnly(leaders);
    }
    var wasInRaw = false;
    for (var w = 0; w < (leadersRaw || []).length; w++) {
      var u0 = leadersRaw[w].userId != null ? String(leadersRaw[w].userId) : '';
      if (u0 === String(myUid)) {
        wasInRaw = true;
        break;
      }
    }
    var work = [];
    for (var j = 0; j < leaders.length; j++) {
      if (leaders[j].isMe) continue;
      work.push(leaders[j]);
    }
    var dispName = '—';
    if (myCohortDataFilter && myCohortDataFilter.displayName) {
      dispName = String(myCohortDataFilter.displayName).trim() || '—';
    } else if (myCohortDataSupr && myCohortDataSupr.displayName) {
      dispName = String(myCohortDataSupr.displayName).trim() || '—';
    }
    var meRow = {
      userId: String(myUid),
      displayName: dispName,
      boardRank:
        myCohortDataFilter && myCohortDataFilter.boardRank != null && isFinite(myCohortDataFilter.boardRank)
          ? Math.floor(Number(myCohortDataFilter.boardRank))
          : null,
      sumPositionScores: mySum,
      isPrivate: (myCohortDataFilter && myCohortDataFilter.is_private === true) || (myCohortDataSupr && myCohortDataSupr.is_private === true),
      isMe: true,
      isInserted: !wasInRaw
    };
    work.push(meRow);
    work.sort(function(a, b) {
      var sa = a.sumPositionScores;
      var sb = b.sumPositionScores;
      if (sa == null && sb == null) {
        return String(a.userId).localeCompare(String(b.userId));
      }
      if (sa == null) return 1;
      if (sb == null) return -1;
      if (sb !== sa) return sb - sa;
      return String(a.userId).localeCompare(String(b.userId));
    });
    for (var k = 0; k < work.length; k++) {
      if (work[k].boardRank == null || !isFinite(work[k].boardRank)) {
        work[k].boardRank = k + 1;
      }
    }
    return { rows: work, meInList: true };
  }

  function renumberHeptagonBoardDisplayRanksOnly(rowsIn) {
    var rows = (rowsIn || []).slice();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].boardRank == null || !isFinite(rows[i].boardRank)) {
        rows[i].boardRank = i + 1;
      }
    }
    return { rows: rows, meInList: false };
  }

  function buildHeptagonModalBoardRowsByBoardRankOnly(leadersRaw, myUid, myCohortData) {
    var leaders = (leadersRaw || []).map(function(d) {
      return mapHeptagonCohortToBoardRow(d, myUid);
    });
    if (!myUid) {
      return renumberHeptagonBoardDisplayRanksOnly(leaders);
    }
    for (var j2 = 0; j2 < leaders.length; j2++) {
      if (leaders[j2].isMe) {
        return renumberHeptagonBoardDisplayRanksOnly(leaders);
      }
    }
    if (!myCohortData) {
      return renumberHeptagonBoardDisplayRanksOnly(leaders);
    }
    var myR =
      myCohortData.boardRank != null && isFinite(Number(myCohortData.boardRank)) ? Math.max(1, Math.floor(Number(myCohortData.boardRank))) : 0;
    if (!myR) {
      return renumberHeptagonBoardDisplayRanksOnly(leaders);
    }
    var meRow2 = {
      userId: String(myUid),
      displayName: (myCohortData.displayName && String(myCohortData.displayName).trim()) || '—',
      boardRank: myR,
      sumPositionScores:
        myCohortData.sumPositionScores != null && isFinite(Number(myCohortData.sumPositionScores)) ? Number(myCohortData.sumPositionScores) : null,
      isPrivate: myCohortData.is_private === true,
      isMe: true,
      isInserted: true
    };
    var out2 = [];
    var ins2 = false;
    for (var i2 = 0; i2 < leaders.length; i2++) {
      var br2 = leaders[i2].boardRank != null && isFinite(Number(leaders[i2].boardRank)) ? leaders[i2].boardRank : 999999;
      if (!ins2 && br2 > myR) {
        out2.push(meRow2);
        ins2 = true;
      }
      out2.push(leaders[i2]);
    }
    if (!ins2) {
      out2.push(meRow2);
    }
    for (var k2 = 0; k2 < out2.length; k2++) {
      if (out2[k2].boardRank == null || !isFinite(out2[k2].boardRank)) {
        out2[k2].boardRank = k2 + 1;
      }
    }
    return { rows: out2, meInList: false };
  }

  /**
   * 본인 부문 외(가상): 대시보드 **전체(Supremo) 7축**에서 계산한 환산 합(전체랭킹)을 우선 비교에 쓰고, 없을 때 `heptagon_cohort_ranks` Supremo 문서의 합.
   * @param {number|null|undefined} chartSupremoSum `computePTotalAndTier` 를 `fetchRanksSet(..., 'Supremo')` 로 얻은 합
   * @param {object|null} crSData Firestore getEntry(Supremo)
   * @returns {number|null}
   */
  function heptagonVirtualCompareSumFromSources(chartSupremoSum, crSData) {
    if (chartSupremoSum != null && isFinite(Number(chartSupremoSum))) {
      return Number(chartSupremoSum);
    }
    if (crSData && crSData.sumPositionScores != null && isFinite(Number(crSData.sumPositionScores))) {
      return Number(crSData.sumPositionScores);
    }
    return null;
  }

  /**
   * 대시보드·모달 공통: 선택 gender·category 로 “동일 조건·환산 점수” 코호트 집계 또는 Supremo+삽입 가상 순위.
   * @param {number|null|undefined} chartSupremoSum — 가상(타 부문)일 때: 전체(Supremo) 랭킹 기준 환산 합(우선)
   * @returns {Promise<{ ok: boolean, skip?: boolean, nTotal?: number, boardRank?: number, cohortData?: object, isVirtualCohort?: boolean }>}
   */
  function loadStelvioCohortOvlData(uid, monthKey, gender, category, ageCategoryHint, chartSupremoSum) {
    var getE = window.getStelvioHeptagonCohortEntry;
    var qN = window.queryStelvioHeptagonCohortBoardN;
    var qList = window.queryStelvioHeptagonCohortBySumDesc;
    if (typeof getE !== 'function' || typeof qN !== 'function') {
      return Promise.resolve({ ok: false, skip: true });
    }
    return fetchRankingUserMeta(uid, gender).then(function(meta) {
      var ac = ageCategoryHint != null && String(ageCategoryHint).trim() !== '' ? String(ageCategoryHint) : '';
      if ((!ac || ac === '') && meta && meta.ageCategory) {
        ac = String(meta.ageCategory);
      }
      if (isUserInCohortForFilter(category, ac)) {
        return Promise.all([
          getE({
            userId: uid,
            monthKey: monthKey,
            filterCategory: category,
            filterGender: gender
          }),
          qN({
            monthKey: monthKey,
            filterCategory: category,
            filterGender: gender
          })
        ]).then(function(pair) {
          var ce = pair[0];
          var cn = pair[1];
          var nTotal = cn && cn.ok && cn.nTotal > 0 ? Math.floor(cn.nTotal) : 0;
          if (nTotal < 1) {
            return { ok: true, skip: true, nTotal: 0 };
          }
          if (!ce || !ce.ok || !ce.exists || !ce.data) {
            return { ok: true, skip: true, nTotal: nTotal };
          }
          var d = ce.data;
          var br = d.boardRank;
          if (br == null && d.comprehensiveRank != null) {
            br = d.comprehensiveRank;
          }
          if (br == null || !isFinite(br)) {
            return { ok: true, skip: true, nTotal: nTotal };
          }
          return {
            ok: true,
            skip: false,
            nTotal: nTotal,
            boardRank: br,
            cohortData: d,
            isVirtualCohort: false
          };
        });
      }
      if (typeof qList !== 'function') {
        return { ok: false, skip: true };
      }
      return Promise.all([
        getE({
          userId: uid,
          monthKey: monthKey,
          filterCategory: 'Supremo',
          filterGender: gender
        }),
        qN({
          monthKey: monthKey,
          filterCategory: category,
          filterGender: gender
        }),
        qList({
          monthKey: monthKey,
          filterCategory: category,
          filterGender: gender,
          limit: 500
        })
      ]).then(function(triple) {
        var crS = triple[0];
        var cn = triple[1];
        var res = triple[2];
        var nFromQ = cn && cn.ok && cn.nTotal > 0 ? Math.floor(cn.nTotal) : 0;
        var itemsRaw = res && res.ok ? res.items || [] : [];
        var nRec = reconcileHeptagonCohortNFromList(nFromQ, itemsRaw);
        if (nRec < 1) {
          return { ok: true, skip: true, nTotal: 0 };
        }
        if (!res || !res.ok) {
          return { ok: true, skip: true, nTotal: nRec };
        }
        var hasCrS = crS && crS.ok && crS.exists && crS.data;
        var dSup = hasCrS ? crS.data : null;
        var sumForVirtual = heptagonVirtualCompareSumFromSources(chartSupremoSum, dSup);
        if (sumForVirtual == null || !isFinite(sumForVirtual)) {
          if (dSup) {
            var brFb0 =
              dSup.boardRank != null && isFinite(dSup.boardRank)
                ? Math.floor(Number(dSup.boardRank))
                : dSup.comprehensiveRank != null && isFinite(dSup.comprehensiveRank)
                  ? Math.floor(Number(dSup.comprehensiveRank))
                  : null;
            if (brFb0 != null && brFb0 >= 1) {
              return {
                ok: true,
                skip: false,
                nTotal: nRec,
                boardRank: brFb0,
                cohortData: dSup,
                isVirtualCohort: true
              };
            }
          }
          return { ok: true, skip: true, nTotal: nRec };
        }
        var mergedData = dSup
          ? Object.assign({}, dSup, { sumPositionScores: sumForVirtual })
          : { sumPositionScores: sumForVirtual, displayName: '—' };
        var built = buildHeptagonModalBoardRows(itemsRaw, uid, null, mergedData);
        var dr = null;
        for (var hi = 0; hi < (built.rows || []).length; hi++) {
          if (built.rows[hi].isMe && built.rows[hi].boardRank != null && isFinite(built.rows[hi].boardRank)) {
            dr = Math.floor(Number(built.rows[hi].boardRank));
            break;
          }
        }
        if (dr == null) {
          var brFb2 = dSup
            ? dSup.boardRank != null && isFinite(dSup.boardRank)
              ? Math.floor(Number(dSup.boardRank))
              : dSup.comprehensiveRank != null && isFinite(dSup.comprehensiveRank)
                ? Math.floor(Number(dSup.comprehensiveRank))
                : null
            : null;
          if (brFb2 != null && brFb2 >= 1) {
            dr = brFb2;
          }
        }
        if (dr == null) {
          return { ok: true, skip: true, nTotal: nRec };
        }
        return {
          ok: true,
          skip: false,
          nTotal: nRec,
          boardRank: dr,
          cohortData: dSup
            ? Object.assign({}, dSup, { sumPositionScores: sumForVirtual })
            : { sumPositionScores: sumForVirtual },
          isVirtualCohort: true
        };
      });
    });
  }

  function HeptagonRankDetailModal(props) {
    var onClose = props.onClose;
    var genderLabel = props.genderLabel;
    var categoryLabel = props.categoryLabel;
    var periodLabel = props.periodLabel;
    var summary = props.tierSummary;
    var boardState = props.boardState || { loading: false, err: null, rows: [] };
    var onBoardFilterChange = props.onBoardFilterChange;
    var boardG = props.boardFilterGender != null ? props.boardFilterGender : 'all';
    var boardC = props.boardFilterCategory != null ? props.boardFilterCategory : 'Supremo';
    var myDisplayName = (props.myDisplayName && String(props.myDisplayName).trim()) || '나';
    var viewerUserId = props.viewerUserId != null ? String(props.viewerUserId) : '';
    var viewerGrade = props.viewerGrade != null ? props.viewerGrade : '2';
    useEffect(
      function() {
        if (!onClose) return;
        var h = function(e) {
          if (e.key === 'Escape') {
            onClose();
          }
        };
        window.addEventListener('keydown', h);
        return function() {
          window.removeEventListener('keydown', h);
        };
      },
      [onClose]
    );
    if (!summary || !summary.tier) {
      return null;
    }
    var isBoardSupremoAll = String(boardG) === 'all' && String(boardC) === 'Supremo';
    var isVirtPct = summary.heptagonBoardVirtualCohort === true;
    var tid = summary.tier.id;
    var viewerAgeCategory = props.viewerAgeCategory != null ? String(props.viewerAgeCategory) : '';
    var ttModal = heptagonCohortTooltipFromSummary(summary, boardC, viewerAgeCategory);
    var rUi = ttModal.ok && ttModal.rank != null ? ttModal.rank : '—';
    var pT = ttModal.ok && ttModal.pPct >= 0 && isFinite(ttModal.pPct) ? ttModal.pPct : null;
    var sumP = summary.sumPositionScores != null && isFinite(Number(summary.sumPositionScores)) ? Number(summary.sumPositionScores) : null;
    var avgP = summary.avgPositionScore != null && isFinite(Number(summary.avgPositionScore)) ? Number(summary.avgPositionScore) : null;
    return (
      <div
        className="stelvio-heptagon-detail-modal"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
        onClick={function(e) {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
        role="presentation"
      >
        <div
          className="stelvio-heptagon-detail-modal__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stelvio-heptagon-detail-title"
          onClick={function(e) {
            e.stopPropagation();
          }}
        >
          <div className="stelvio-heptagon-detail-modal__head">
            <div>
              <h3 className="stelvio-heptagon-detail-modal__title" id="stelvio-heptagon-detail-title">STELVIO 헵타곤 · 항목별 순위</h3>
              <p className="stelvio-heptagon-detail-modal__meta">
                <span>
                  집계 필터 — 부문(카테고리): {categoryLabel} · 성별: {genderLabel} · {periodLabel}
                </span>
              </p>
            </div>
            <button
              type="button"
              className="stelvio-heptagon-detail-modal__close"
              onClick={onClose}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
          <div className="stelvio-heptagon-detail-modal__summary">
            <div
              className="stelvio-heptagon-detail-modal__summary-row"
              title="3·7·20·40·60·90% 경계(레벨1~7). 집계 순위·레벨%·n은 이 화면에서 선택한 성별·부문(heptagon_cohort_ranks)과 동일. 본인 부문이면 집계(boardRank) 순위, 그 밖이면 환산 합 비교·삽입 순위"
            >
              <span>레벨</span>
              <strong>{tierLevelDisplayName(tid)}</strong>
            </div>
            <div
              className="stelvio-heptagon-detail-modal__summary-row"
              title={
                isBoardSupremoAll
                  ? '다른 필터: 동일한 환산 합(전면)으로 전·후면(종합) 집계 순위'
                  : '선택 부문·성별에서 동일한 환산 합(전면)으로 코호트 내 순위 — 본인 부문이면 본인 집계 순위'
              }
            >
              <span>{isBoardSupremoAll ? '종합(환산) 순위' : '집계 순위 (필터)'}</span>
              <strong>{rUi !== '—' ? String(rUi) + '위' : '—'}</strong>
            </div>
            {pT != null ? (
              <div
                className="stelvio-heptagon-detail-modal__summary-row"
                title={
                  heptagonUseNeffNPlusOne(boardC, viewerAgeCategory, isVirtPct)
                    ? '가상·타 연령 부문: 전면(Supremo) 환산 합으로 삽입 순위, Neff=n+1·레벨%·n 표기'
                    : '전체·본인 부문: 집계 n — n(또는 Neff)≥100 (r÷n)×100, 미만 n₂=100÷n, ((r÷n)÷n₂)×100(상한 100)'
                }
              >
                <span>레벨 % {isVirtPct ? '(가상, 순위~n+1)' : '(실집계, 1~n)'}</span>
                <strong>{pT.toFixed(2)}%</strong>
              </div>
            ) : null}
            {sumP != null ? (
              <div
                className="stelvio-heptagon-detail-modal__summary-row"
                title="7축 합(0~700)은 전면(Supremo) 랭크로만 산출된 합(모든 부문 문서에 동일)"
              >
                <span>7축 점수 합 (0~700)</span>
                <strong>
                  {sumP.toFixed(1)}
                  {avgP != null ? ' (평균 ' + avgP.toFixed(2) + ')' : ''}
                </strong>
              </div>
            ) : null}
          </div>

          <div className="stelvio-heptagon-detail-modal__boardbody">
          <div className="stelvio-heptagon-detail-modal__boardhead">
            <p className="stelvio-heptagon-detail-modal__boardhead-t m-0 mb-2 text-center w-full">동일 조건·월(환산) 점수 순위</p>
            <div
              className="stelvio-octagon-filters stelvio-heptagon-detail-modal__board-oct-filters w-full max-w-full justify-center"
              role="group"
              aria-label="순위표 부문·성별"
            >
              <div className="stelvio-octagon-filter-joined">
                <div className="stelvio-octagon-filter-cell stelvio-octagon-gender">
                  <span className="stelvio-octagon-filter-cap">성별</span>
                  <span className="stelvio-octagon-filter-val">{labelForGender(boardG)}</span>
                  <span className="stelvio-octagon-filter-chev" aria-hidden="true" />
                  <select
                    className="stelvio-octagon-filter-select"
                    value={boardG}
                    onChange={function(e) {
                      if (typeof onBoardFilterChange === 'function') {
                        onBoardFilterChange(e.target.value, boardC);
                      }
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
                <div className="stelvio-octagon-filter-cell stelvio-octagon-category">
                  <span className="stelvio-octagon-filter-cap">카테고리</span>
                  <span className="stelvio-octagon-filter-val">{labelForCategory(boardC)}</span>
                  <span className="stelvio-octagon-filter-chev" aria-hidden="true" />
                  <select
                    className="stelvio-octagon-filter-select"
                    value={boardC}
                    onChange={function(e) {
                      if (typeof onBoardFilterChange === 'function') {
                        onBoardFilterChange(boardG, e.target.value);
                      }
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
          </div>
          {boardState.loading ? (
            <p className="stelvio-heptagon-detail-modal__neighborload">순위표를 불러오는 중…</p>
          ) : null}
          {!boardState.loading && boardState.err && boardState.err !== 'no-sum' && boardState.err !== 'no-fn' ? (
            <p className="stelvio-heptagon-detail-modal__neighboreq">{stelvioHeptagonRankListErrorMessage(boardState.err)}</p>
          ) : null}
          {!boardState.loading && boardState.err === 'no-sum' ? (
            <p className="stelvio-heptagon-detail-modal__neighborload">7축 점수 합이 없어 순위표를 표시할 수 없습니다.</p>
          ) : null}
          {!boardState.loading && boardState.err === 'no-fn' ? (
            <p className="stelvio-heptagon-detail-modal__neighborload">코호트 랭킹 모듈이 로드되지 않았습니다.</p>
          ) : null}
          {!boardState.loading && sumP != null && !boardState.err ? (
            <div className="stelvio-heptagon-detail-modal__tablewrap stelvio-heptagon-detail-modal__tablewrap--neighbor">
              <table className="stelvio-heptagon-detail-modal__table" role="grid">
                <caption className="stelvio-heptagon-detail-modal__caption">
                  {categoryLabel} · {genderLabel} — 환산점수 합(0~700)이 높은 순(랭킹보드·
                  <code>heptagon_cohort_ranks</code> 집계, 상위 500명 표시, 본인은 목록에 없을 때 집계 순위 위치에 삽입)
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="stelvio-heptagon-detail-modal__thnum">
                      순위
                    </th>
                    <th scope="col">이름</th>
                    <th scope="col" className="stelvio-heptagon-detail-modal__thnum">
                      환산점수 합계
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(boardState.rows || []).map(function(row, idx) {
                    var npb = stelvioNeighborNameParts(
                      row.isMe ? myDisplayName : row.displayName,
                      row.isPrivate === true,
                      row.userId,
                      viewerUserId,
                      viewerGrade
                    );
                    var rankCell =
                      row.boardRank != null && isFinite(row.boardRank)
                        ? String(Math.floor(Number(row.boardRank))) + '위'
                        : '—';
                    return (
                      <tr
                        key={row.isMe && row.isInserted ? 'me-ins' : 'br-' + (row.userId || idx)}
                        className={row.isMe ? 'stelvio-heptagon-detail-modal__tr--me' : ''}
                      >
                        <td className="stelvio-heptagon-detail-modal__tdnum">{rankCell}</td>
                        <td>
                          {row.isMe ? (
                            <strong>
                              <span className="stelvio-heptagon-detail-modal__namecell" title={npb.title || undefined}>
                                {npb.text}
                              </span>
                            </strong>
                          ) : (
                            <span>
                              <span className="stelvio-heptagon-detail-modal__namecell" title={npb.title || undefined}>
                                {npb.text}
                              </span>
                            </span>
                          )}
                          {npb.showPrivateBadge ? (
                            <span className="ranking-private-badge ranking-private-badge-admin" title="비공개">
                              비
                            </span>
                          ) : null}
                        </td>
                        <td className="stelvio-heptagon-detail-modal__tdnum">
                          {row.sumPositionScores != null && isFinite(row.sumPositionScores) ? (
                            row.isMe ? (
                              <strong>{row.sumPositionScores.toFixed(1)}</strong>
                            ) : (
                              row.sumPositionScores.toFixed(1)
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {sumP != null && !boardState.loading && !boardState.err && (!boardState.rows || !boardState.rows.length) ? (
            <p className="stelvio-heptagon-detail-modal__neighborload">표시할 순위가 없습니다. (동일 조건·집계 기준)</p>
          ) : null}
          </div>
          <div className="stelvio-heptagon-detail-modal__actions">
            <button type="button" className="stelvio-heptagon-detail-modal__btn" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      </div>
    );
  }

  function OctagonTierCenterOverlay(props) {
    var summary = props.summary;
    var onOpenDetail = props.onOpenDetail;
    var hct = props.heptagonCardTooltip || { kind: 'none' };
    var filterGenderLabel = props.filterGenderLabel != null && String(props.filterGenderLabel).trim() !== '' ? String(props.filterGenderLabel).trim() : '';
    var filterCategoryLabel = props.filterCategoryLabel != null && String(props.filterCategoryLabel).trim() !== '' ? String(props.filterCategoryLabel).trim() : '';
    var _pct = useState(false);
    var showPct = _pct[0];
    var setShowPct = _pct[1];
    var _img = useState(false);
    var imgError = _img[0];
    var setImgError = _img[1];
    var rankForUi = null;
    var pShow = -1;
    var nCohortHint = null;
    var virtLabel = '';
    var nCohortLine = '';
    if (hct.kind === 'ok') {
      rankForUi = hct.rank != null ? hct.rank : null;
      pShow = hct.pPct >= 0 && isFinite(hct.pPct) ? hct.pPct : -1;
      nCohortHint = hct.nCohort > 0 ? hct.nCohort : null;
      nCohortLine = nCohortHint != null ? String(nCohortHint) : '—';
      virtLabel = hct.isVirtual
        ? '가상(전면 환산 합·타 부문 삽입, Neff=n+1은 해당 열람에만)'
        : '실집계(1~n, 집계 모수 n)';
    } else if (hct.kind === 'board_partial') {
      rankForUi = hct.rank != null ? hct.rank : null;
      nCohortHint = hct.nCohort > 0 ? hct.nCohort : null;
      pShow = -1;
      nCohortLine = nCohortHint != null ? String(nCohortHint) : '…';
      virtLabel = '집계 동기화 중(%)';
    }
    var filterContext =
      filterGenderLabel && filterCategoryLabel
        ? '성별: ' + filterGenderLabel + ', 부문: ' + filterCategoryLabel + ' — '
        : '';
    var cohortOvlLoading = props.cohortOvlLoading === true || hct.kind === 'board_loading';
    /** 집계 순위·n·레벨%(`hct.pPct`) → 등급·동물(7축 W/kg 티어가 아닌 동일 조건·월(환산) 점수 기준) */
    var useCohortRankTier = hct.kind === 'ok' && pShow >= 0 && isFinite(pShow);
    var cohortTierIdObj = useCohortRankTier ? heptagonBoardTierIdFromLevelPercent(pShow) : null;
    var tid = cohortTierIdObj ? cohortTierIdObj.id : summary && summary.tier ? summary.tier.id : '';
    useEffect(
      function() {
        setImgError(false);
      },
      [tid, pShow, rankForUi, nCohortHint, hct.kind]
    );
    if (!summary || !summary.tier) return null;
    var st = tierStyleForId(tid);
    var label = cohortTierIdObj
      ? cohortTierIdObj.labelShort || cohortTierIdObj.text
      : summary.tier.labelShort || summary.tier.text;
    var levelName = tierLevelDisplayName(tid);
    var src = tierBadgeImageSrc(tid);

    return (
      <div className="stelvio-octagon-tier-wrap" aria-hidden={false}>
        <div className="stelvio-octagon-tier-inner stelvio-octagon-tier-inner--img">
          <div className="stelvio-octagon-tier-btn-stack">
            <button
              type="button"
              className="stelvio-octagon-tier-btn stelvio-octagon-tier-btn--beast"
              aria-label={levelName + ' 배지 · 클릭 시 항목별 순위·환산 점수 팝업'}
              title={filterContext + 'STELVIO 헵타곤 · 동일 조건·월(환산) 점수 순위 (클릭: 상세)'}
              onClick={function(e) {
                e.stopPropagation();
                if (typeof onOpenDetail === 'function') {
                  onOpenDetail();
                }
              }}
            >
              {!imgError ? (
                <img
                  className="stelvio-octagon-tier-img"
                  src={src}
                  alt=""
                  draggable={false}
                  decoding="async"
                  onError={function() {
                    setImgError(true);
                  }}
                />
              ) : (
                <span
                  className={'stelvio-octagon-tier-fallback stelvio-octagon-tier-btn--' + tid + (tid === 'HC' ? ' stelvio-octagon-tier--hc' : '')}
                  style={tid === 'HC' ? { textShadow: st.shadow } : { color: st.color, textShadow: st.shadow }}
                >
                  {label}
                </span>
              )}
            </button>
            <button
              type="button"
              className="stelvio-octagon-tier-btn stelvio-octagon-tier-btn--leveltag"
              aria-pressed={showPct}
              aria-label={
                filterContext +
                (rankForUi != null
                  ? levelName + ', ' + String(rankForUi) + '위, 집계 모수 n=' + nCohortLine + ', ' + virtLabel + ', 레벨% ' + (pShow >= 0 ? pShow.toFixed(2) : '—') + '%. '
                  : levelName + ', 동일 조건·월(환산) 점수 표(팝업과 동일) 로딩·동기화 후 표시. ') + '클릭: 툴팁'
              }
              title={filterContext + '동일 조건·월(환산) 점수 순위·n·레벨% (카드 필터 = 모달「동일 조건」) — 클릭: 힌트'}
              onClick={function(e) {
                e.stopPropagation();
                setShowPct(!showPct);
              }}
            >
              <span className="stelvio-octagon-tier-level-name">{levelName}</span>
            </button>
          </div>
          <div
            className={
              'stelvio-octagon-tier-hint ' +
              (rankForUi != null ? 'stelvio-octagon-tier-hint--split ' : '') +
              (showPct ? 'stelvio-octagon-tier-hint--visible' : '')
            }
            role="status"
          >
            {rankForUi != null ? (
              <span className="stelvio-octagon-tier-hint-split stelvio-octagon-tier-hint-split--cohort" title={virtLabel + ' · 집계 대상자 수 n(카드=팝업 동일 조건 표)'}>
                <span className="stelvio-octagon-tier-hint-line stelvio-octagon-tier-hint-rank">{String(rankForUi) + '위'}</span>
                <span className="stelvio-octagon-tier-hint-line stelvio-octagon-tier-hint-nref">n={nCohortLine}</span>
                <span className="stelvio-octagon-tier-hint-line stelvio-octagon-tier-hint-pct">
                  {pShow >= 0 && isFinite(pShow) ? pShow.toFixed(2) : hct.kind === 'board_partial' ? '…' : '—'}%
                </span>
              </span>
            ) : (
              <span
                className="stelvio-octagon-tier-hint-pending"
                title={
                  cohortOvlLoading
                    ? '동일 조건·월(환산) 점수 순위표(카드 필터) 로딩'
                    : '동일 조건·월(환산) 점수 집계를 쓰려면 랭킹/코호트 동기화가 필요하거나, 필터·월 문서를 확인하세요'
                }
              >
                {cohortOvlLoading ? '집계 동기화…' : hct.kind === 'board_err' ? '표 조회 실패' : '— · — · —'}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ──────────────────────────────────────────────────────────────
   * LevelProgressBar – 현재 레벨(1~7) × 세부 단계(1~10) 세로 막대
   * pTotal: 백분위(낮을수록 상위). 레벨 내 상한·하한을 10등분하여
   * 아래부터 위로 채워지는 블록으로 표시.
   * ────────────────────────────────────────────────────────────── */
  /* 레벨바 색상: 녹색 계열 (레벨A 진녹 → 레벨G 연녹/회녹) */
  var LEVEL_BAR_DEFS = [
    { id: 'HC', lower: 0,   upper: 5,   color: '#059669', bg: 'rgba(5,150,105,0.18)' },
    { id: 'C1', lower: 5,   upper: 10,  color: '#10b981', bg: 'rgba(16,185,129,0.18)' },
    { id: 'C2', lower: 10,  upper: 20,  color: '#34d399', bg: 'rgba(52,211,153,0.18)' },
    { id: 'C3', lower: 20,  upper: 40,  color: '#6ee7b7', bg: 'rgba(110,231,183,0.18)' },
    { id: 'C4', lower: 40,  upper: 60,  color: '#86efac', bg: 'rgba(134,239,172,0.18)' },
    { id: 'C5', lower: 60,  upper: 80,  color: '#bbf7d0', bg: 'rgba(187,247,208,0.18)' },
    { id: 'C6', lower: 80,  upper: 100, color: '#d1fae5', bg: 'rgba(209,250,229,0.18)' }
  ];

  function computeLevelBarStep(summary) {
    if (!summary || !summary.tier) return { lv: LEVEL_BAR_DEFS[6], step: 1 };
    var tid = summary.tier.id;
    var p = summary.pTotal != null && isFinite(summary.pTotal) ? summary.pTotal
          : summary.pComprehensive != null && isFinite(summary.pComprehensive) ? summary.pComprehensive
          : null;
    var lvIdx = LEVEL_BAR_DEFS.findIndex(function(l) { return l.id === tid; });
    if (lvIdx < 0) lvIdx = 6;
    var lv = LEVEL_BAR_DEFS[lvIdx];
    var step = 1;
    if (p != null) {
      var span = lv.upper - lv.lower;
      if (span > 0) {
        var ratio = (lv.upper - p) / span; /* 0=레벨 하한(최하), 1=레벨 상한(최상) */
        ratio = Math.max(0, Math.min(1, ratio));
        step = Math.max(1, Math.min(10, Math.ceil(ratio * 10)));
      } else {
        step = 10;
      }
    }
    return { lv: lv, lvIdx: lvIdx, step: step };
  }

  function LevelProgressBar(props) {
    var summary = props.summary;
    if (!summary || !summary.tier) return null;
    var result = computeLevelBarStep(summary);
    var lv = result.lv;
    var lvIdx = result.lvIdx;
    var step = result.step;
    var blocks = [];
    for (var bi = 0; bi < 10; bi++) {
      /* bi=0 → 최상단(비어있음), bi=9 → 최하단(가장 먼저 채워짐) */
      var filled = bi >= (10 - step);
      /* 채워진 블록: 아래로 갈수록 불투명, 위로 갈수록 조금 연함 */
      var blockOpacity = filled ? (0.5 + ((9 - bi) / 9) * 0.5) : 1;
      blocks.push(
        <div
          key={bi}
          style={{
            width: '28px',
            height: '18px',
            borderRadius: '4px',
            background: filled ? lv.color : 'rgba(16,185,129,0.06)',
            border: filled ? ('1px solid ' + lv.color) : '1px solid rgba(16,185,129,0.20)',
            opacity: blockOpacity,
            flexShrink: 0
          }}
        />
      );
    }
    /* 상단·하단 텍스트 모두 진한 녹색(#065f46)으로 고정 */
    var darkGreen = '#065f46';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '38px', minHeight: '260px', paddingTop: '4px', paddingBottom: '4px', gap: 0 }}>
        <div style={{ fontSize: '9px', fontWeight: 700, color: darkGreen, marginBottom: '5px', letterSpacing: '-0.3px', whiteSpace: 'nowrap' }}>
          {tierLevelDisplayName(lv.id)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, justifyContent: 'center' }}>
          {blocks}
        </div>
        <div style={{ fontSize: '9px', color: darkGreen, marginTop: '5px', fontVariantNumeric: 'tabular-nums' }}>
          {step}<span style={{ color: darkGreen, opacity: 0.6 }}>/10</span>
        </div>
      </div>
    );
  }

  function StelvioOctagonRanksCard(props) {
    var p = props || {};
    var userProfile = p.userProfile;
    var DashboardCard = p.DashboardCard;
    var uid = userProfile && userProfile.id != null ? String(userProfile.id) : null;
    var userAgeCatStr = userProfile && userProfile.ageCategory != null ? String(userProfile.ageCategory) : '';

    var _rankMeta = useState({ ageCategory: '', loaded: false });
    var rankingMeta = _rankMeta[0];
    var setRankingMeta = _rankMeta[1];
    useEffect(
      function() {
        if (!uid) {
          setRankingMeta({ ageCategory: '', loaded: true });
          return;
        }
        fetchRankingUserMeta(uid, gender)
          .then(function(m) {
            setRankingMeta({
              ageCategory: m && m.ageCategory != null ? String(m.ageCategory) : '',
              loaded: true
            });
          })
          .catch(function() {
            setRankingMeta({ ageCategory: '', loaded: true });
          });
      },
      [uid, gender]
    );
    var viewerAc = useMemo(
      function() {
        var fromM = rankingMeta.ageCategory != null && String(rankingMeta.ageCategory).trim() !== '' ? String(rankingMeta.ageCategory).trim() : '';
        return fromM || userAgeCatStr;
      },
      [rankingMeta.ageCategory, userAgeCatStr]
    );

    var _g = useState('all');
    var gender = _g[0];
    var setGender = _g[1];
    var _c = useState('Supremo');
    var category = _c[0];
    var setCategory = _c[1];

    var _s = useState({ loading: true, err: null, monthly: null, hof: null, supremoMonthly: null });
    var state = _s[0];
    var setState = _s[1];
    var saveKeyRef = useRef('');
    var heptagonLogReqRef = useRef(0);
    var stelvioOvlReqRef = useRef(0);
    var stelvioOvlModalReqRef = useRef(0);
    var _hLog = useState(null);
    var heptagonRankLog = _hLog[0];
    var setHeptagonRankLog = _hLog[1];
    var _dOpen = useState(false);
    var heptagonDetailOpen = _dOpen[0];
    var setHeptagonDetailOpen = _dOpen[1];
    var _hcb = useState({ loading: false, err: null, rows: [], nCohort: 0, meInList: false });
    var heptagonCardBoard = _hcb[0];
    var setHeptagonCardBoard = _hcb[1];
    var _hmb = useState(null);
    var heptagonModalBoard = _hmb[0];
    var setHeptagonModalBoard = _hmb[1];
    var _stOvl = useState({ loading: true });
    var stelvioCohortOvl = _stOvl[0];
    var setStelvioCohortOvl = _stOvl[1];
    var _stOvlM = useState({ loading: true });
    var stelvioCohortOvlModal = _stOvlM[0];
    var setStelvioCohortOvlModal = _stOvlM[1];
    var _hmg = useState('all');
    var heptagonModalGender = _hmg[0];
    var setHeptagonModalGender = _hmg[1];
    var _hmc = useState('Supremo');
    var heptagonModalCategory = _hmc[0];
    var setHeptagonModalCategory = _hmc[1];
    var _hmr = useState(null);
    var heptagonModalRanks = _hmr[0];
    var setHeptagonModalRanks = _hmr[1];
    var heptagonPrevOpenRef = useRef(false);

    /** 전체(Supremo) 랭킹 7축·환산 합 — 본인 부문 외(가상) 순위 비교의 1순위(전체랭킹·대시보드 `fetchRanksSet` Supremo) */
    var chartSupremoSumFromGlobalRanking = useMemo(
      function() {
        if (state.loading || !state.supremoMonthly) {
          return null;
        }
        var t0 = computePTotalAndTier(state.supremoMonthly.ranks, state.supremoMonthly.cohortSizePerAxis);
        if (!t0 || t0.sumPositionScores == null || !isFinite(t0.sumPositionScores)) {
          return null;
        }
        return Number(t0.sumPositionScores);
      },
      [state.loading, state.supremoMonthly]
    );

    /** 팝업이 카드와 다른 **성별**이면, 해당 성별 `fetchRanksSet(..., 'Supremo')` 기준 환산 합 */
    var chartSupremoSumForModalVirtualOvl = useMemo(
      function() {
        if (heptagonModalGender === gender) {
          return chartSupremoSumFromGlobalRanking;
        }
        if (heptagonModalRanks && heptagonModalRanks.tierSupremoForVirtual) {
          var ts = heptagonModalRanks.tierSupremoForVirtual;
          if (ts && ts.sumPositionScores != null && isFinite(ts.sumPositionScores)) {
            return Number(ts.sumPositionScores);
          }
        }
        return null;
      },
      [heptagonModalGender, gender, chartSupremoSumFromGlobalRanking, heptagonModalRanks]
    );

    useEffect(
      function() {
        if (!uid) {
          setHeptagonRankLog(null);
          return;
        }
        if (typeof window.getStelvioHeptagonRankLog !== 'function') {
          setHeptagonRankLog(null);
          return;
        }
        heptagonLogReqRef.current = heptagonLogReqRef.current + 1;
        var myRid = heptagonLogReqRef.current;
        window.getStelvioHeptagonRankLog(uid).then(function(res) {
          if (heptagonLogReqRef.current !== myRid) {
            return;
          }
          if (res && res.ok) {
            setHeptagonRankLog(res.exists && res.data ? res.data : null);
          } else {
            setHeptagonRankLog(null);
          }
        });
      },
      [uid, gender, category]
    );

    useEffect(
      function() {
        if (!uid) {
          setStelvioCohortOvl({ loading: false, skip: true });
          return;
        }
        if (typeof window.getStelvioHeptagonCohortEntry !== 'function' || typeof window.queryStelvioHeptagonCohortBoardN !== 'function') {
          setStelvioCohortOvl({ loading: false, skip: true });
          return;
        }
        stelvioOvlReqRef.current = stelvioOvlReqRef.current + 1;
        var reqId = stelvioOvlReqRef.current;
        setStelvioCohortOvl({ loading: true });
        var mk = currentMonthKeyKst();
        loadStelvioCohortOvlData(uid, mk, gender, category, viewerAc, chartSupremoSumFromGlobalRanking)
          .then(function(result) {
            if (stelvioOvlReqRef.current !== reqId) {
              return;
            }
            if (!result || !result.ok) {
              setStelvioCohortOvl({ loading: false, skip: true });
              return;
            }
            if (result.skip) {
              setStelvioCohortOvl({
                loading: false,
                skip: true,
                nTotal: result.nTotal != null ? result.nTotal : 0
              });
              return;
            }
            setStelvioCohortOvl({
              loading: false,
              nTotal: result.nTotal,
              boardRank: result.boardRank,
              cohortData: result.cohortData,
              skip: false,
              isVirtualCohort: result.isVirtualCohort === true
            });
          })
          .catch(function() {
            if (stelvioOvlReqRef.current !== reqId) {
              return;
            }
            setStelvioCohortOvl({ loading: false, err: true, skip: true });
          });
      },
      [uid, gender, category, viewerAc, chartSupremoSumFromGlobalRanking]
    );

    useEffect(
      function() {
        if (!uid) {
          setState({ loading: false, err: 'noUser', monthly: null, hof: null, supremoMonthly: null });
          return;
        }
        var todayStr =
          typeof window.getTodayStrForCache === 'function'
            ? window.getTodayStrForCache()
            : (function() {
                var t = new Date();
                return (
                  t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')
                );
              })();

        if (typeof window.getStelvioOctagonRanksCache === 'function') {
          var cached = window.getStelvioOctagonRanksCache(uid, gender, category, todayStr);
          if (cached && cached.monthly && cached.hof) {
            setState(
              stateFromRanksArray(
                cached.monthly.ranks,
                cached.monthly.cohortSizePerAxis,
                cached.hof.ranks,
                null,
                null,
                cached.monthly.wkgs,
                cached.hof.wkgs
              )
            );
            fetchRanksSet(uid, 'monthly', gender, 'Supremo')
              .then(function(sRows) {
                setState(function(prev) {
                  if (!prev || !prev.monthly) {
                    return prev;
                  }
                  return Object.assign({}, prev, {
                    supremoMonthly: {
                      ranks: sRows.map(function(x) {
                        return x.rank;
                      }),
                      cohortSizePerAxis: sRows.map(function(x) {
                        return x.n;
                      })
                    }
                  });
                });
              })
              .catch(function() {});
            return;
          }
        }

        setState({ loading: true, err: null, monthly: null, hof: null, supremoMonthly: null });
        Promise.all([
          fetchRanksSet(uid, 'monthly', gender, category),
          fetchRanksSet(uid, 'yearly', gender, category),
          fetchRanksSet(uid, 'monthly', gender, 'Supremo')
        ])
          .then(function(results) {
            var mRows = results[0];
            var hRows = results[1];
            var sRows = results[2];
            var monthlyRanks = mRows.map(function(x) {
              return x.rank;
            });
            var cohortSizePerAxis = mRows.map(function(x) {
              return x.n;
            });
            var hofRanks = hRows.map(function(x) {
              return x.rank;
            });
            setState(stateFromApiRows(mRows, hRows, sRows));
            if (typeof window.setStelvioOctagonRanksCache === 'function') {
              try {
                var mwForCache = mRows.map(function(x) {
                  return x.wkg != null && isFinite(x.wkg) ? x.wkg : null;
                });
                var hwForCache = hRows.map(function(x) {
                  return x.wkg != null && isFinite(x.wkg) ? x.wkg : null;
                });
                window.setStelvioOctagonRanksCache(
                  uid,
                  gender,
                  category,
                  todayStr,
                  monthlyRanks,
                  cohortSizePerAxis,
                  hofRanks,
                  mwForCache,
                  hwForCache
                );
              } catch (e) {
                console.warn('[StelvioOctagon] cache write failed:', e && e.message);
              }
            }
          })
          .catch(function() {
            setState({ loading: false, err: 'fetch', monthly: null, hof: null, supremoMonthly: null });
          });
      },
      [uid, gender, category]
    );

    var heptagonSummaryCache = useMemo(
      function() {
        if (!heptagonRankLog) {
          return null;
        }
        return summaryFromHeptagonRankLogIfMatch(heptagonRankLog, currentMonthKeyKst(), gender, category);
      },
      [heptagonRankLog, gender, category]
    );

    var tierSummaryComputed = useMemo(
      function() {
        if (state.loading || !state.monthly || !state.monthly.cohortSizePerAxis) return null;
        return computePTotalAndTier(state.monthly.ranks, state.monthly.cohortSizePerAxis);
      },
      [state.loading, state.monthly]
    );

    var tierForCard = useMemo(
      function() {
        if (!tierSummaryComputed) {
          return null;
        }
        return applyCohortBoardMerge(tierSummaryComputed, stelvioCohortOvl, category, viewerAc);
      },
      [tierSummaryComputed, stelvioCohortOvl, category, viewerAc]
    );

    /** 카드 필터 = 팝업「동일 조건」표 — 리스트 본인 순위·모수 n(표 또는 ovl nTotal) → 레벨% */
    var stelvioCardTooltip = useMemo(
      function() {
        if (uid) {
          if (heptagonCardBoard && heptagonCardBoard.loading) {
            return { kind: 'board_loading' };
          }
          var mineBR = getMyRankFromHeptagonBoardRows(heptagonCardBoard);
          if (mineBR && mineBR.boardRank != null && mineBR.boardRank >= 1) {
            var ovlL = stelvioCohortOvl;
            var nEff = heptagonEffectiveCohortNFromBoardAndOvl(heptagonCardBoard, ovlL);
            var isVb;
            if (ovlL && !ovlL.loading && ovlL.skip !== true && ovlL.isVirtualCohort != null) {
              isVb = ovlL.isVirtualCohort === true;
            } else {
              isVb = viewerAc ? !isUserInCohortForFilter(category, viewerAc) : false;
            }
            if (ovlL && ovlL.loading && nEff < 1) {
              return {
                kind: 'board_partial',
                rank: mineBR.boardRank,
                nCohort: 0,
                pPct: -1,
                isVirtual: isVb
              };
            }
            if (nEff < 1) {
              if (heptagonCardBoard && heptagonCardBoard.err) {
                return { kind: 'board_err' };
              }
              return {
                kind: 'board_partial',
                rank: mineBR.boardRank,
                nCohort: 0,
                pPct: -1,
                isVirtual: isVb
              };
            }
            var pBx = heptagonLevelPercentForRankN(mineBR.boardRank, nEff, isVb, category, viewerAc);
            return {
              kind: 'ok',
              source: 'board',
              rank: mineBR.boardRank,
              nCohort: heptagonCohortNDisplay(nEff, category, viewerAc, isVb),
              pPct: pBx,
              isVirtual: isVb
            };
          }
          if (heptagonCardBoard && heptagonCardBoard.err) {
            return { kind: 'board_err' };
          }
          var ovlE = stelvioOvlBoardRankNForDisplay(stelvioCohortOvl, category, viewerAc);
          if (ovlE) {
            var pE = heptagonLevelPercentForRankN(ovlE.br, ovlE.nTot, ovlE.isVirt, category, viewerAc);
            return {
              kind: 'ok',
              source: 'cohort_ovl',
              rank: ovlE.br,
              nCohort: heptagonCohortNDisplay(ovlE.nTot, category, viewerAc, ovlE.isVirt),
              pPct: pE,
              isVirtual: ovlE.isVirt
            };
          }
          if (stelvioCohortOvl && stelvioCohortOvl.loading) {
            return { kind: 'board_loading' };
          }
        }
        var ttF = heptagonCohortTooltipFromSummary(tierForCard, category, viewerAc);
        if (ttF && ttF.ok) {
          return {
            kind: 'ok',
            source: 'summary',
            rank: ttF.rank,
            nCohort: ttF.nCohort,
            pPct: ttF.pPct,
            isVirtual: ttF.isVirtual
          };
        }
        if (heptagonCardBoard && heptagonCardBoard.loading) {
          return { kind: 'board_loading' };
        }
        return { kind: 'none' };
      },
      [uid, heptagonCardBoard, stelvioCohortOvl, tierForCard, userProfile, category, viewerAc]
    );

    var heptagonSummaryCacheMerged = useMemo(
      function() {
        if (!heptagonSummaryCache) {
          return null;
        }
        return applyCohortBoardMerge(heptagonSummaryCache, stelvioCohortOvl, category, viewerAc);
      },
      [heptagonSummaryCache, stelvioCohortOvl, category, viewerAc]
    );

    var heptagonModalSummary =
      state.monthly && tierForCard
        ? tierForCard
        : heptagonSummaryCacheMerged;

    var heptagonModalBaseTier = useMemo(
      function() {
        if (heptagonModalGender === gender && heptagonModalCategory === category) {
          return tierSummaryComputed || heptagonSummaryCache;
        }
        if (heptagonModalRanks && heptagonModalRanks.tierUnmerged) {
          return heptagonModalRanks.tierUnmerged;
        }
        return tierSummaryComputed || heptagonSummaryCache;
      },
      [heptagonModalGender, heptagonModalCategory, gender, category, tierSummaryComputed, heptagonSummaryCache, heptagonModalRanks]
    );

    var heptCohortOvlForModalHeader = useMemo(
      function() {
        if (!heptagonDetailOpen) {
          return stelvioCohortOvl;
        }
        if (heptagonModalGender === gender && heptagonModalCategory === category) {
          return stelvioCohortOvl;
        }
        return stelvioCohortOvlModal;
      },
      [heptagonDetailOpen, heptagonModalGender, heptagonModalCategory, gender, category, stelvioCohortOvl, stelvioCohortOvlModal]
    );

    var heptagonModalHeaderSummary = useMemo(
      function() {
        if (!heptagonModalBaseTier) {
          return null;
        }
        return applyCohortBoardMerge(heptagonModalBaseTier, heptCohortOvlForModalHeader, heptagonModalCategory, viewerAc);
      },
      [heptagonModalBaseTier, heptCohortOvlForModalHeader, heptagonModalCategory, viewerAc]
    );

    useEffect(
      function() {
        setHeptagonDetailOpen(false);
      },
      [gender, category, uid]
    );

    useEffect(
      function() {
        if (heptagonDetailOpen && !heptagonPrevOpenRef.current) {
          setHeptagonModalGender(gender);
          setHeptagonModalCategory(category);
        }
        heptagonPrevOpenRef.current = heptagonDetailOpen;
      },
      [heptagonDetailOpen, gender, category]
    );

    useEffect(
      function() {
        if (!heptagonDetailOpen || !uid) {
          return;
        }
        if (heptagonModalGender === gender && heptagonModalCategory === category) {
          setStelvioCohortOvlModal({ useCard: true, loading: false });
          return;
        }
        if (typeof window.getStelvioHeptagonCohortEntry !== 'function' || typeof window.queryStelvioHeptagonCohortBoardN !== 'function') {
          setStelvioCohortOvlModal({ loading: false, skip: true });
          return;
        }
        stelvioOvlModalReqRef.current = stelvioOvlModalReqRef.current + 1;
        var mReq = stelvioOvlModalReqRef.current;
        setStelvioCohortOvlModal({ loading: true });
        var mk = currentMonthKeyKst();
        loadStelvioCohortOvlData(uid, mk, heptagonModalGender, heptagonModalCategory, viewerAc, chartSupremoSumForModalVirtualOvl)
          .then(function(result) {
            if (stelvioOvlModalReqRef.current !== mReq) {
              return;
            }
            if (!result || !result.ok) {
              setStelvioCohortOvlModal({ loading: false, skip: true, useCard: false });
              return;
            }
            if (result.skip) {
              setStelvioCohortOvlModal({
                loading: false,
                skip: true,
                nTotal: result.nTotal != null ? result.nTotal : 0,
                useCard: false
              });
              return;
            }
            setStelvioCohortOvlModal({
              loading: false,
              nTotal: result.nTotal,
              boardRank: result.boardRank,
              cohortData: result.cohortData,
              skip: false,
              isVirtualCohort: result.isVirtualCohort === true,
              useCard: false
            });
          })
          .catch(function() {
            if (stelvioOvlModalReqRef.current !== mReq) {
              return;
            }
            setStelvioCohortOvlModal({ loading: false, err: true, skip: true, useCard: false });
          });
      },
      [heptagonDetailOpen, uid, heptagonModalGender, heptagonModalCategory, gender, category, viewerAc, chartSupremoSumForModalVirtualOvl]
    );

    useEffect(
      function() {
        if (!heptagonDetailOpen || !uid) {
          return;
        }
        if (heptagonModalGender === gender && heptagonModalCategory === category) {
          setHeptagonModalRanks(null);
          return;
        }
        setHeptagonModalRanks({ loading: true });
        Promise.all([
          fetchRanksSet(uid, 'monthly', heptagonModalGender, heptagonModalCategory),
          fetchRanksSet(uid, 'monthly', heptagonModalGender, 'Supremo')
        ])
          .then(function(pair) {
            var mRows = pair[0];
            var sRows = pair[1];
            var monthlyRanks = mRows.map(function(x) {
              return x.rank;
            });
            var cohortSizePerAxis = mRows.map(function(x) {
              return x.n;
            });
            var mRat = monthlyRanks.map(rankToRadiusNorm);
            var monthly = { ranks: monthlyRanks, norm: mRat, cohortSizePerAxis: cohortSizePerAxis };
            var tUn = computePTotalAndTier(monthlyRanks, cohortSizePerAxis);
            var sR = sRows.map(function(x) {
              return x.rank;
            });
            var sN = sRows.map(function(x) {
              return x.n;
            });
            var tSup = computePTotalAndTier(sR, sN);
            setHeptagonModalRanks({ loading: false, monthly: monthly, tierUnmerged: tUn, tierSupremoForVirtual: tSup });
          })
          .catch(function() {
            setHeptagonModalRanks({ loading: false, err: true });
          });
      },
      [heptagonDetailOpen, uid, heptagonModalGender, heptagonModalCategory, gender, category]
    );

    function runHeptagonCohortBoardFetch(uidIn, gIn, cIn, setBoard, chartSupremoSumForVirtual) {
      if (!uidIn) {
        setBoard({ loading: false, err: null, rows: [], nCohort: 0, meInList: false });
        return;
      }
      if (typeof window.queryStelvioHeptagonCohortBySumDesc !== 'function') {
        setBoard({ loading: false, err: 'no-fn', rows: [], nCohort: 0, meInList: false });
        return;
      }
      setBoard({ loading: true, err: null, rows: [], nCohort: 0, meInList: false });
      var mk2 = currentMonthKeyKst();
      var prB = window.queryStelvioHeptagonCohortBySumDesc({
        monthKey: mk2,
        filterCategory: cIn,
        filterGender: gIn,
        limit: 500
      });
      var prCo =
        typeof window.getStelvioHeptagonCohortEntry === 'function'
          ? window.getStelvioHeptagonCohortEntry({
              userId: uidIn,
              monthKey: mk2,
              filterCategory: cIn,
              filterGender: gIn
            })
          : Promise.resolve({ ok: false, exists: false, data: null });
      var prCoS =
        typeof window.getStelvioHeptagonCohortEntry === 'function'
          ? window.getStelvioHeptagonCohortEntry({
              userId: uidIn,
              monthKey: mk2,
              filterCategory: 'Supremo',
              filterGender: gIn
            })
          : Promise.resolve({ ok: false, exists: false, data: null });
      var prN2 =
        typeof window.queryStelvioHeptagonCohortBoardN === 'function'
          ? window.queryStelvioHeptagonCohortBoardN({
              monthKey: mk2,
              filterCategory: cIn,
              filterGender: gIn
            })
          : Promise.resolve({ ok: false, nTotal: 0 });
      Promise.all([prCo, prCoS, prB, prN2])
        .then(function(quad) {
          var crA = quad[0];
          var crSA = quad[1];
          var resA = quad[2];
          var nResA = quad[3];
          var nTot2 = nResA && nResA.ok && nResA.nTotal > 0 ? Math.floor(nResA.nTotal) : 0;
          if (resA && resA.ok) {
            var myD = crA && crA.ok && crA.exists && crA.data ? crA.data : null;
            var myDS = crSA && crSA.ok && crSA.exists && crSA.data ? crSA.data : null;
            if (chartSupremoSumForVirtual != null && isFinite(Number(chartSupremoSumForVirtual))) {
              var sv = Number(chartSupremoSumForVirtual);
              if (myDS) {
                myDS = Object.assign({}, myDS, { sumPositionScores: sv });
              } else {
                myDS = { sumPositionScores: sv, displayName: '—' };
              }
            }
            var items2 = resA.items || [];
            var nRe2 = reconcileHeptagonCohortNFromList(nTot2, items2);
            var built2 = buildHeptagonModalBoardRows(items2, uidIn, myD, myDS);
            var nReFromRows = nCohortFromHeptagonBoardRows({ rows: built2.rows, nCohort: 0, err: null });
            var nReFinal = Math.max(nRe2, nReFromRows);
            setBoard({ loading: false, err: null, rows: built2.rows, meInList: built2.meInList, nCohort: nReFinal | 0 });
          } else {
            setBoard({
              loading: false,
              err: (resA && resA.error) || 'fetch',
              rows: [],
              nCohort: 0,
              meInList: false
            });
          }
        })
        .catch(function() {
          setBoard({ loading: false, err: 'catch', rows: [], nCohort: 0, meInList: false });
        });
    }

    useEffect(
      function() {
        if (!uid) {
          setHeptagonCardBoard({ loading: false, err: null, rows: [], nCohort: 0, meInList: false });
          return;
        }
        runHeptagonCohortBoardFetch(uid, gender, category, setHeptagonCardBoard, chartSupremoSumFromGlobalRanking);
      },
      [uid, gender, category, chartSupremoSumFromGlobalRanking]
    );

    useEffect(
      function() {
        if (!heptagonDetailOpen) {
          setHeptagonModalBoard(null);
          return;
        }
        if (heptagonModalGender === gender && heptagonModalCategory === category) {
          setHeptagonModalBoard(null);
          return;
        }
        if (!uid) {
          setHeptagonModalBoard({ loading: false, err: null, rows: [], nCohort: 0, meInList: false });
          return;
        }
        var chartS =
          heptagonModalGender === gender
            ? chartSupremoSumFromGlobalRanking
            : heptagonModalRanks && heptagonModalRanks.tierSupremoForVirtual
              ? heptagonModalRanks.tierSupremoForVirtual.sumPositionScores
              : null;
        runHeptagonCohortBoardFetch(uid, heptagonModalGender, heptagonModalCategory, setHeptagonModalBoard, chartS);
      },
      [heptagonDetailOpen, uid, heptagonModalCategory, heptagonModalGender, gender, category, chartSupremoSumFromGlobalRanking, heptagonModalRanks]
    );

    useEffect(
      function() {
        if (state.loading || !uid || !tierForCard || !state.monthly) return;
        if (state.err) return;
        if (typeof window.saveStelvioHeptagonRankLog !== 'function') return;
        var sk =
          uid +
          '|' +
          gender +
          '|' +
          category +
          '|' +
          (state.monthly.ranks
            ? state.monthly.ranks.join(',')
            : '') +
          '|' +
          (tierForCard.pTier != null ? String(tierForCard.pTier) : '');
        if (sk === saveKeyRef.current) return;
        saveKeyRef.current = sk;
        var monthKeyKst = currentMonthKeyKst();
        var rankForSave = heptagonCardRankFromSummary(tierForCard, category, viewerAc);
        if (rankForSave == null) {
          rankForSave = comprehensiveRankUiFromTierSummary(tierForCard, category, viewerAc);
        }
        var disp =
          (userProfile && (userProfile.name || userProfile.displayName)) != null
            ? String(userProfile.name || userProfile.displayName)
            : '';
        fetchRankingUserMeta(uid, gender)
          .then(function(meta) {
            return window.saveStelvioHeptagonRankLog({
              userId: uid,
              displayName: disp || (meta && meta.displayName) || '',
              filterGender: gender,
              filterCategory: category,
              ageCategory: (meta && meta.ageCategory) || (userProfile && userProfile.ageCategory) || '',
              period: 'monthly',
              monthKey: monthKeyKst,
              ranks: state.monthly.ranks || [],
              cohortNPerAxis: state.monthly.cohortSizePerAxis || [],
              positionScores100: tierForCard.positionScores100 || tierForCard.itemP || [],
              sumPositionScores: tierForCard.sumPositionScores,
              avgPositionScore: tierForCard.avgPositionScore,
              pTier: tierForCard.pTier,
              tierId: tierForCard.tier && tierForCard.tier.id,
              nRef: tierForCard.cohortN,
              pComprehensive: tierForCard.pComprehensive,
              comprehensiveRank: rankForSave,
              isPrivate: userProfile && userProfile.is_private === true
            });
          })
          .catch(function() {
            return window.saveStelvioHeptagonRankLog({
              userId: uid,
              displayName: disp,
              filterGender: gender,
              filterCategory: category,
              ageCategory: (userProfile && userProfile.ageCategory) || '',
              period: 'monthly',
              monthKey: monthKeyKst,
              ranks: state.monthly.ranks || [],
              cohortNPerAxis: state.monthly.cohortSizePerAxis || [],
              positionScores100: tierForCard.positionScores100 || tierForCard.itemP || [],
              sumPositionScores: tierForCard.sumPositionScores,
              avgPositionScore: tierForCard.avgPositionScore,
              pTier: tierForCard.pTier,
              tierId: tierForCard.tier && tierForCard.tier.id,
              nRef: tierForCard.cohortN,
              pComprehensive: tierForCard.pComprehensive,
              comprehensiveRank: rankForSave,
              isPrivate: userProfile && userProfile.is_private === true
            });
          });
      },
      [state.loading, state.err, state.monthly, tierForCard, uid, gender, category, userProfile, viewerAc]
    );

    var svg = useMemo(
      function() {
        if (state.loading || !state.monthly) return null;
        var cx = 100;
        var cy = 100;
        var rLabel = 88;
        var rMax = 70;
        var nAxis = N_WKG_AXES;

        /* ── 모수(n) 결정 ──────────────────────────────────────────────────────
         * 툴팁에 표시되는 모수와 동일한 값을 사용한다.
         * 우선순위: tierForCard.cohortN(Firestore 집계 or API max) > max(cohortSizePerAxis) > 1
         * ──────────────────────────────────────────────────────────────────── */
        var nRef = (tierForCard && tierForCard.cohortN != null && (tierForCard.cohortN | 0) > 0)
          ? (tierForCard.cohortN | 0)
          : 0;
        if (nRef < 1) {
          var perAxis = state.monthly.cohortSizePerAxis || [];
          for (var pi = 0; pi < perAxis.length; pi++) {
            var pn = (perAxis[pi] | 0);
            if (pn > nRef) nRef = pn;
          }
        }
        if (nRef < 1) nRef = 1;

        /* 순위 비율 직접 계산: (nRef - rank + 1) / nRef
         * rank 1위 → 0.99(최대), 꼴찌 → ~0.08(최소), 데이터 없음(null) → 0.08 */
        var rankNorms = [];
        var ranks = state.monthly.ranks || [];
        for (var ni = 0; ni < nAxis; ni++) {
          var r = ranks[ni];
          var norm;
          if (r == null || !isFinite(r) || r < 1) {
            norm = 0.08;
          } else {
            var rr = Math.floor(Number(r));
            if (rr < 1) rr = 1;
            if (rr > nRef) rr = nRef;
            norm = (nRef - rr + 1) / nRef;
            if (norm > 0.99) norm = 0.99;
            if (norm < 0.08) norm = 0.08;
          }
          rankNorms.push(norm);
        }

        var mPts = pathFromPoints(radarPolygonPoints(rankNorms, cx, cy, rMax));
        var grid = [0.25, 0.5, 0.75, 1].map(function(g) {
          var gr = [];
          for (var gi = 0; gi < nAxis; gi++) gr.push(g);
          return pathFromPoints(radarPolygonPoints(gr, cx, cy, rMax));
        });
        return (
          <svg viewBox="0 0 200 200" className="w-full h-[260px] touch-manipulation" role="img" aria-label="STELVIO 피크 파워 7축 헵타곤 레벨 포지션">
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
              var t = axisAngle(i, nAxis);
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
              d={mPts}
              fill="rgba(124, 58, 237, 0.22)"
              stroke="rgb(109, 40, 217)"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            {AXES.map(function(ax, i) {
              var t = axisAngle(i, nAxis);
              var lx = cx + rLabel * Math.cos(t);
              var ly = cy + rLabel * Math.sin(t);
              var mr = state.monthly.ranks[i];
              return (
                <text
                  key={ax.key + '-lbl'}
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  className="fill-slate-800"
                >
                  <tspan x={lx} dy="0" style={{ fontSize: '9.5px', fontWeight: 600 }}>
                    {ax.label}
                  </tspan>
                  <tspan x={lx} dy="11" style={{ fontSize: '7.5px', fill: '#64748b' }}>
                    {mr != null ? mr + '위' : '—'}
                  </tspan>
                </text>
              );
            })}
          </svg>
        );
      },
      [state, tierForCard]
    );

    var filterRow = null;
    if (uid) {
      filterRow = (
        <div
          className="stelvio-octagon-filters"
          role="group"
          aria-label="랭킹 기준(성별·부문) 선택"
        >
          <div className="stelvio-octagon-filter-joined">
            <div className="stelvio-octagon-filter-cell stelvio-octagon-gender">
              <span className="stelvio-octagon-filter-cap">성별</span>
              <span className="stelvio-octagon-filter-val">{labelForGender(gender)}</span>
              <span className="stelvio-octagon-filter-chev" aria-hidden="true" />
              <select
                className="stelvio-octagon-filter-select"
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
            <div className="stelvio-octagon-filter-cell stelvio-octagon-category">
              <span className="stelvio-octagon-filter-cap">카테고리</span>
              <span className="stelvio-octagon-filter-val">{labelForCategory(category)}</span>
              <span className="stelvio-octagon-filter-chev" aria-hidden="true" />
              <select
                className="stelvio-octagon-filter-select"
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
          {(() => {
            var myCat = categoryValueMatchingUserAge(userProfile);
            if (!myCat) {
              return null;
            }
            return (
              <div className="stelvio-octagon-filter-verify mt-1.5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-600">
                {category !== myCat ? (
                  <button
                    type="button"
                    className="px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50/90 text-violet-900 font-medium hover:bg-violet-100 shadow-sm"
                    onClick={function() {
                      setCategory(myCat);
                    }}
                  >
                    나의 부문(검증): {labelForCategory(myCat)}
                  </button>
                ) : (
                  <span className="px-1 text-center leading-snug">
                    동일 조건·월(환산) 순위: <strong>나의 부문</strong>({labelForCategory(myCat)}) — 리스트·툴팁과 동기
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      );
    }

    var onHeptagonOpenDetail = function() {
      if (heptagonModalBaseTier || heptagonModalSummary) {
        setHeptagonDetailOpen(true);
      }
    };

    /** 팝업:「동일 조건」표 — 카드 필터와 같으면 카드에서 이미 로드한 표 재사용, 아니면 모달 전용 조회 */
    var heptagonBoardForModal = useMemo(
      function() {
        if (!heptagonDetailOpen) {
          return { loading: false, err: null, rows: [], nCohort: 0, meInList: false };
        }
        if (heptagonModalGender === gender && heptagonModalCategory === category) {
          return heptagonCardBoard;
        }
        if (heptagonModalBoard == null) {
          return { loading: true, err: null, rows: [], nCohort: 0, meInList: false };
        }
        return heptagonModalBoard;
      },
      [heptagonDetailOpen, gender, category, heptagonModalGender, heptagonModalCategory, heptagonCardBoard, heptagonModalBoard]
    );

    var heptagonModalShowSummary = heptagonModalHeaderSummary || heptagonModalSummary;

    var heptagonDetailModal =
      heptagonDetailOpen && heptagonModalShowSummary ? (
        <HeptagonRankDetailModal
          onClose={function() {
            setHeptagonDetailOpen(false);
          }}
          tierSummary={heptagonModalShowSummary}
          genderLabel={labelForGender(heptagonModalGender)}
          categoryLabel={labelForCategory(heptagonModalCategory)}
          periodLabel="최근 30일 피크 파워(월)"
          boardState={heptagonBoardForModal}
          boardFilterGender={heptagonModalGender}
          boardFilterCategory={heptagonModalCategory}
          onBoardFilterChange={function(nextG, nextC) {
            setHeptagonModalGender(nextG);
            setHeptagonModalCategory(nextC);
          }}
          myDisplayName={
            userProfile && (userProfile.name || userProfile.displayName) != null
              ? String(userProfile.name || userProfile.displayName)
              : ''
          }
          viewerUserId={uid}
          viewerGrade={userProfile && userProfile.grade != null ? String(userProfile.grade) : '2'}
          viewerAgeCategory={viewerAc}
        />
      ) : null;

    var body = null;
    if (!uid) {
      body = (
        <div className="h-[200px] flex items-center justify-center text-gray-500 text-sm text-center px-2">
          사용자 ID가 없으면 순위를 불러올 수 없습니다.
        </div>
      );
    } else if (state.loading) {
      if (heptagonSummaryCache) {
        body = (
          <div className="h-[220px] flex flex-col items-center justify-center">
            <div className="stelvio-octagon-chart-shell relative w-full max-w-[360px] mx-auto h-[260px] flex items-center justify-center min-h-[200px]">
              <OctagonTierCenterOverlay
                summary={heptagonSummaryCacheMerged != null ? heptagonSummaryCacheMerged : heptagonSummaryCache}
                onOpenDetail={onHeptagonOpenDetail}
                heptagonCardTooltip={stelvioCardTooltip}
                filterGenderLabel={labelForGender(gender)}
                filterCategoryLabel={labelForCategory(category)}
                cohortOvlLoading={!!(stelvioCohortOvl && stelvioCohortOvl.loading === true)}
              />
            </div>
            <p className="text-xs text-center text-slate-500 mt-0 px-2">최신 헵타곤 순위를 동기화하는 중… (직전 저장값 표시)</p>
            <div
              className="w-8 h-8 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin mt-2"
              aria-hidden="true"
            />
          </div>
        );
      } else {
        body = (
          <div className="h-[220px] flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin mb-3" />
            <span className="text-sm text-gray-500">헵타곤 로딩…</span>
          </div>
        );
      }
    } else if (state.err === 'fetch') {
      body = (
        <div className="h-[180px] flex items-center justify-center text-gray-500 text-sm">랭킹을 불러오지 못했습니다. 네트워크를 확인해 주세요.</div>
      );
    } else {
      body = (
        <div>
          <div className="flex items-center justify-center gap-1 w-full max-w-[420px] mx-auto">
            <div className="stelvio-octagon-chart-shell relative flex-1 h-[260px]">
              {svg}
              {tierForCard ? (
                <OctagonTierCenterOverlay
                  summary={tierForCard}
                  onOpenDetail={onHeptagonOpenDetail}
                  heptagonCardTooltip={stelvioCardTooltip}
                  filterGenderLabel={labelForGender(gender)}
                  filterCategoryLabel={labelForCategory(category)}
                  cohortOvlLoading={!!(stelvioCohortOvl && stelvioCohortOvl.loading === true)}
                />
              ) : null}
            </div>
            {tierForCard ? <LevelProgressBar summary={tierForCard} /> : null}
          </div>
          <div className="flex flex-wrap justify-center gap-3 text-xs text-gray-600 mt-1 mb-0 px-1">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded" style={{ background: 'rgba(124, 58, 237, 0.45)', border: '1px solid #6d28d9' }} />
              <span>최근 30일 피크 파워</span>
            </div>
          </div>
        </div>
      );
    }

    if (DashboardCard) {
      return (
        <DashboardCard title="STELVIO 헵타곤 (레벨 포지션)">
          {filterRow}
          {body}
          {heptagonDetailModal}
        </DashboardCard>
      );
    }
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-gray-800 mb-2">STELVIO 헵타곤 (레벨 포지션)</h3>
        {filterRow}
        {body}
        {heptagonDetailModal}
      </div>
    );
  }

  window.StelvioOctagonRanksCard = StelvioOctagonRanksCard;
})();
