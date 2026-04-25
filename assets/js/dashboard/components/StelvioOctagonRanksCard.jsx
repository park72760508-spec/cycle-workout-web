/**
 * STELVIO 헵타곤(7축 레벨 포지션) — getPeakPowerRanking + 분포용 순위(부문/값 기준) 동일.
 * **그래프(면도)**: `rankToRadiusNorm` (기존 로그 스케일) — 7각형 W/kg·레이더.
 * **집계 순위·레벨%·이미지(중앙)**: `heptagon_cohort_ranks` **선택 성별 + 선택 카테고리(부문)** 문서와 동일(항목별 순위 팝업 `동일 조건·월(환산) 점수 순위`와 대응). 성별=전체·카테고리=전체(Supremo)이면 **종합(전면) 순위·모수**; 부문/성별을 바꾸면 **해당 필터의 boardRank·n**. 환산 합(점수)은 전면 집계값이 코호트 문서에 공통 저장됨.
 * **레벨%**: 모수 n≥100 → (순위÷n)×100. n<100 → (순위÷n) ÷ (100÷n) × 100(= 항목별 순위 팝업과 동일).
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
          return {
            rank: computeDisplayRankLikeDistribution(data, uid, category, d),
            n: cohortSizeForCategory(data, category)
          };
        });
      })
    );
  }

  /** N_WKG_AXES 축(피크 W/kg) rank + 코호트 n → 차트·면적·레벨 동일 */
  function stateFromRanksArray(monthlyRanks, cohortSizePerAxis, hofRanks) {
    var mRat = monthlyRanks.map(rankToRadiusNorm);
    var hRat = hofRanks.map(rankToRadiusNorm);
    return {
      loading: false,
      err: null,
      monthly: { ranks: monthlyRanks, norm: mRat, cohortSizePerAxis: cohortSizePerAxis },
      hof: { ranks: hofRanks, norm: hRat }
    };
  }

  function stateFromApiRows(mRows, hRows) {
    return stateFromRanksArray(
      mRows.map(function(x) {
        return x.rank;
      }),
      mRows.map(function(x) {
        return x.n;
      }),
      hRows.map(function(x) {
        return x.rank;
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
   * 집계 레벨%: n≥100 → (r÷n)×100. n<100 → (r÷n)÷(100÷n)×100(= r와 동일 스케일 1~100, 소집단 보정).
   * 등급: ≤3%·(3,7]·…·(90,100] → HC~C6(레벨1~7).
   */
  var HEPTAGON_BOARD_PCT_CUTS = [3, 7, 20, 40, 60, 90];

  function heptagonLevelPercentForRankN(boardRank, n) {
    var Nc = n | 0;
    if (Nc < 1) return 0;
    var r = boardRank == null || !isFinite(boardRank) ? 1 : Math.floor(Number(boardRank));
    if (r < 1) r = 1;
    if (r > Nc) r = Nc;
    if (Nc >= 100) {
      return (r / Nc) * 100;
    }
    var nScale = 100 / Nc;
    return (r / Nc) / nScale;
  }

  function heptagonBoardTierIdFromLevelPercent(p) {
    if (!isFinite(p)) {
      return { id: 'C6', text: 'Cat 6', labelShort: 'Cat 6' };
    }
    if (p <= 3) {
      return { id: 'HC', text: 'HC', labelShort: 'HC' };
    }
    if (p <= 7) {
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
    if (p <= 90) {
      return { id: 'C5', text: 'Cat 5', labelShort: 'Cat 5' };
    }
    return { id: 'C6', text: 'Cat 6', labelShort: 'Cat 6' };
  }

  function heptagonBoardTierObjectFromRankN(boardRank, n) {
    var Nc = n | 0;
    if (Nc < 1) {
      return { tier: { id: 'C6', text: 'Cat 6', labelShort: 'Cat 6' }, mode: 'none', pRank: 0, upperRankBounds: null };
    }
    var p = heptagonLevelPercentForRankN(boardRank, Nc);
    return { tier: heptagonBoardTierIdFromLevelPercent(p), mode: 'percent', pRank: p, upperRankBounds: null };
  }

  /**
   * `heptagon_cohort_ranks` 집계(월·필터): 전면 환산 합 기준 집계 순위, 레벨%·레벨은 `heptagonBoardTierObjectFromRankN`.
   * @param {object|null} tierBase 7축·합산(포지션 점수) 기반 요약
   * @param {{ loading?: boolean, skip?: boolean, err?: boolean, nTotal?: number, boardRank?: number, cohortData?: object }} ovl
   */
  function applyCohortBoardMerge(tierBase, ovl) {
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
    br = Math.max(1, Math.min(nTot, Math.floor(Number(br))));
    var hb = heptagonBoardTierObjectFromRankN(br, nTot);
    var pRank = hb.pRank;
    var out = Object.assign({}, tierBase);
    out.pTier = pRank;
    out.pTotal = pRank;
    out.pComprehensive = pRank;
    out.comprehensiveRank = br;
    out.rankAverage = br;
    out.cohortN = nTot;
    out.tier = hb.tier;
    out.tierPercentCutoffs = HEPTAGON_BOARD_PCT_CUTS;
    out.kAdjust = 1;
    out.isLargeCohort = nTot >= 100;
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
    return out;
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
   */
  function comprehensiveRankUiFromTierSummary(ts) {
    if (!ts) return null;
    var nC = ts.cohortN != null && isFinite(Number(ts.cohortN)) ? Math.max(0, Math.floor(Number(ts.cohortN))) : 0;
    var rSynth = ts.comprehensiveRank != null && isFinite(Number(ts.comprehensiveRank)) ? Number(ts.comprehensiveRank) : NaN;
    if (isNaN(rSynth) && ts.rankAverage != null && isFinite(Number(ts.rankAverage))) {
      rSynth = Number(ts.rankAverage);
    }
    if (isNaN(rSynth)) return null;
    return Math.max(1, nC > 0 ? Math.min(nC, Math.round(rSynth)) : Math.max(1, Math.round(rSynth)));
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

  /** 헵타곤 중앙 이미지 하단 표기용(레벨1=HC) */
  function tierLevelDisplayName(tierId) {
    var m = { HC: '레벨1', C1: '레벨2', C2: '레벨3', C3: '레벨4', C4: '레벨5', C5: '레벨6', C6: '레벨7' };
    return m[tierId] || '레벨7';
  }

  /** 축별 표용 행(랭킹 동기화 완료 시) */
  function buildHeptagonDetailRows(monthly, tierSummary) {
    if (!monthly || !monthly.ranks || !monthly.cohortSizePerAxis || !tierSummary) return null;
    var ranks = monthly.ranks;
    var ns = monthly.cohortSizePerAxis;
    var ps = tierSummary.positionScores100 || tierSummary.itemP || [];
    if (!Array.isArray(ranks) || ranks.length !== N_WKG_AXES) return null;
    var nRef = tierSummary.cohortN != null && isFinite(Number(tierSummary.cohortN)) ? Math.max(0, Math.floor(Number(tierSummary.cohortN))) : 0;
    var out = [];
    for (var i = 0; i < N_WKG_AXES; i++) {
      var nAxis = (ns[i] | 0) > 0 ? ns[i] | 0 : nRef;
      out.push({
        key: AXES[i].key,
        label: AXES[i].label,
        rank: ranks[i] != null && isFinite(Number(ranks[i])) ? Number(ranks[i]) : null,
        n: nAxis,
        score: ps[i] != null && isFinite(Number(ps[i])) ? Number(ps[i]) : null
      });
    }
    return out;
  }

  /** Firestore heptagon_rank_log 본(로딩 중 직전 저장값) */
  function buildHeptagonDetailRowsFromLog(d, nowMonthKey, g, c) {
    if (!d || d.monthKey !== nowMonthKey || d.filterGender !== g || d.filterCategory !== c) {
      return null;
    }
    var ranks = d.ranks;
    var ns = d.cohortNPerAxis;
    var ps = d.positionScores100;
    if (!Array.isArray(ranks) || ranks.length !== N_WKG_AXES) return null;
    var nRef = d.nRef != null && isFinite(Number(d.nRef)) ? Math.max(0, Math.floor(Number(d.nRef))) : 0;
    var out = [];
    for (var i = 0; i < N_WKG_AXES; i++) {
      var nAxis = Array.isArray(ns) && (ns[i] | 0) > 0 ? ns[i] | 0 : nRef;
      var score = null;
      if (Array.isArray(ps) && ps[i] != null && isFinite(Number(ps[i]))) {
        score = Number(ps[i]);
      }
      out.push({
        key: AXES[i].key,
        label: AXES[i].label,
        rank: ranks[i] != null && isFinite(Number(ranks[i])) ? Number(ranks[i]) : null,
        n: nAxis,
        score: score
      });
    }
    return out;
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
    return nQ;
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
      return buildHeptagonModalBoardRowsByBoardRankOnly(leadersRaw, myUid, myCohortDataFilter);
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
      work[k].displayRank = k + 1;
    }
    return { rows: work, meInList: true };
  }

  function renumberHeptagonBoardDisplayRanksOnly(rowsIn) {
    var rows = (rowsIn || []).slice();
    for (var i = 0; i < rows.length; i++) {
      rows[i].displayRank = i + 1;
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
      out2[k2].displayRank = k2 + 1;
    }
    return { rows: out2, meInList: false };
  }

  function HeptagonRankDetailModal(props) {
    var onClose = props.onClose;
    var genderLabel = props.genderLabel;
    var categoryLabel = props.categoryLabel;
    var periodLabel = props.periodLabel;
    var rows = props.rows;
    var axisRowsLoading = props.axisRowsLoading;
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
    var tid = summary.tier.id;
    var nC = summary.cohortN != null && isFinite(Number(summary.cohortN)) ? Math.max(0, Math.floor(Number(summary.cohortN))) : 0;
    var rComp = summary.comprehensiveRank != null && isFinite(Number(summary.comprehensiveRank)) ? Number(summary.comprehensiveRank) : NaN;
    var rUi =
      !isNaN(rComp) && nC > 0
        ? Math.max(1, Math.min(nC, Math.floor(rComp + 0.5)))
        : summary.rankAverage != null && isFinite(Number(summary.rankAverage))
          ? Math.max(1, nC > 0 ? Math.min(nC, Math.floor(Number(summary.rankAverage) + 0.5)) : Math.floor(Number(summary.rankAverage) + 0.5))
          : '—';
    var pT =
      summary.pTier != null && isFinite(Number(summary.pTier)) ? Number(summary.pTier) : null;
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
              title="3·7·20·40·60·90% 경계(레벨1~7). 집계 순위·레벨%·모수 n은 선택한 성별·부문(heptagon_cohort_ranks)과 동일"
            >
              <span>레벨</span>
              <strong>{tierLevelDisplayName(tid)}</strong>
            </div>
            <div
              className="stelvio-heptagon-detail-modal__summary-row"
              title={
                isBoardSupremoAll
                  ? '성별·부문(전체) 기준 전면(종합) 집계 순위 — 환산 합은 Supremo와 동일 값'
                  : '선택 부문·성별 코호트에서의 환산 합(전면과 동일 점수) 집계 순위'
              }
            >
              <span>{isBoardSupremoAll ? '종합(환산) 순위' : '집계 순위 (필터)'}</span>
              <strong>{rUi !== '—' ? String(rUi) + '위' : '—'}</strong>
            </div>
            {pT != null ? (
              <div
                className="stelvio-heptagon-detail-modal__summary-row"
                title={
                  nC >= 100
                    ? '레벨% = (순위 r ÷ 모수 n) × 100'
                    : '모수 n<100: 보정 n₂=100÷n, 레벨% = (r÷n)÷n₂ (순위 팝업과 동일)'
                }
              >
                <span>레벨 % {nC >= 100 || nC < 1 ? '(순위÷모수×100)' : '(소집단 보정)'}</span>
                <strong>{pT.toFixed(2)}%</strong>
              </div>
            ) : null}
            {sumP != null ? (
              <div
                className="stelvio-heptagon-detail-modal__summary-row"
                title="7축 합(0~700)은 전면(Supremo) 랭크로만 산출된 합(모든 부문 문서에 동일). 아래 7구간 표는 랭킹보드 필터별 W/kg"
              >
                <span>7축 점수 합 (0~700)</span>
                <strong>
                  {sumP.toFixed(1)}
                  {avgP != null ? ' (평균 ' + avgP.toFixed(2) + ')' : ''}
                </strong>
              </div>
            ) : null}
            {nC > 0 ? (
              <div className="stelvio-heptagon-detail-modal__summary-foot">
                <span className="stelvio-heptagon-detail-modal__nref">참조 코호트(집계) 모수 n = {nC}</span>
              </div>
            ) : null}
            {nC > 0 && nC < 100 ? (
              <div className="stelvio-heptagon-detail-modal__summary-foot">
                <span className="stelvio-heptagon-detail-modal__nref">
                  모수 n이 100명 미만: n₂=100÷n, 레벨%=(순위÷n)÷n₂. 위 3·7·20·40·60·90% 경계로 레벨1~7을 정합니다(항목별 순위·동일 조건과 일치).
                </span>
              </div>
            ) : null}
          </div>
          {axisRowsLoading ? (
            <p className="stelvio-heptagon-detail-modal__neighborload">선택한 부문·성별 7구간 데이터를 불러오는 중…</p>
          ) : rows && rows.length ? (
            <div className="stelvio-heptagon-detail-modal__tablewrap">
              <table className="stelvio-heptagon-detail-modal__table" role="grid">
                <caption className="stelvio-heptagon-detail-modal__caption">카테고리·부문별 7구간 피크 파워 순위와 환산 점수</caption>
                <thead>
                  <tr>
                    <th scope="col">구간</th>
                    <th scope="col" className="stelvio-heptagon-detail-modal__thnum">
                      순위
                    </th>
                    <th scope="col" className="stelvio-heptagon-detail-modal__thnum">
                      인원(n)
                    </th>
                    <th scope="col" className="stelvio-heptagon-detail-modal__thnum">
                      환산(0~100)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(function(row) {
                    return (
                      <tr key={row.key || row.label}>
                        <td>{row.label}</td>
                        <td className="stelvio-heptagon-detail-modal__tdnum">
                          {row.rank != null && isFinite(row.rank) ? String(Math.floor(row.rank)) + '위' : '—'}
                        </td>
                        <td className="stelvio-heptagon-detail-modal__tdnum">
                          {row.n != null && (row.n | 0) > 0 ? String(row.n) : '—'}
                        </td>
                        <td className="stelvio-heptagon-detail-modal__tdnum">
                          {row.score != null && isFinite(row.score) ? row.score.toFixed(1) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="stelvio-heptagon-detail-modal__empty">항목별 순위·점수는 랭킹 동기화 직후 표시됩니다.</p>
          )}

          <div className="stelvio-heptagon-detail-modal__boardhead">
            <div className="stelvio-heptagon-detail-modal__boardhead-titlerow">
              <span className="stelvio-heptagon-detail-modal__boardhead-t">동일 조건·월(환산) 점수 순위</span>
              <div className="stelvio-heptagon-detail-modal__board-filters" role="group" aria-label="순위표 부문·성별">
                <div className="stelvio-heptagon-board-btngroup" role="group" aria-label="성별">
                  {GENDER_OPTIONS.map(function(og) {
                    var gActive = String(boardG) === String(og.value);
                    return (
                      <button
                        key={og.value + '-g'}
                        type="button"
                        className={'stelvio-heptagon-board-pill' + (gActive ? ' stelvio-heptagon-board-pill--active' : '')}
                        onClick={function() {
                          if (typeof onBoardFilterChange === 'function' && !gActive) {
                            onBoardFilterChange(og.value, boardC);
                          }
                        }}
                        aria-pressed={gActive}
                        aria-label={'성별 ' + og.label}
                      >
                        {og.label}
                      </button>
                    );
                  })}
                </div>
                <div className="stelvio-heptagon-board-btngroup" role="group" aria-label="부문(카테고리)">
                  {CATEGORY_OPTIONS.map(function(oc) {
                    var cActive = String(boardC) === String(oc.value);
                    return (
                      <button
                        key={oc.value + '-c'}
                        type="button"
                        className={'stelvio-heptagon-board-pill' + (cActive ? ' stelvio-heptagon-board-pill--active' : '')}
                        onClick={function() {
                          if (typeof onBoardFilterChange === 'function' && !cActive) {
                            onBoardFilterChange(boardG, oc.value);
                          }
                        }}
                        aria-pressed={cActive}
                        aria-label={'부문 ' + oc.label}
                      >
                        {oc.label}
                      </button>
                    );
                  })}
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
                      row.displayRank != null && isFinite(row.displayRank)
                        ? String(row.displayRank) + '위'
                        : row.boardRank != null && isFinite(row.boardRank)
                          ? String(row.boardRank) + '위'
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
          <p className="stelvio-heptagon-detail-modal__note">
            <strong>요약(상단)</strong>: <code>heptagon_cohort_ranks</code>는 <strong>7축 환산 합(전면 랭크 기준)</strong>이 모든 부문·성별
            문서에 동일 값으로 저장됩니다. 선택한 부문·성별에서 그 합으로 내림차순 1,2,3… 집계 순위(헵타곤 중앙·레벨%와 동일)입니다. 레벨%는
            모수 n≥100일 때 (순위÷n)×100%, n{'<'}100일 때 (순위÷n)÷(100÷n)×100%입니다. <strong>7구간 표(위)</strong>는 W/kg
            7축(랭킹보드와 동일 필터), <strong>아래 표</strong>는 동일 조건·환산 합(최대 500행)입니다. 목록 밖이면
            <code>boardRank</code>에 맞게 본인 행을 삽입해 순위를 맞춥니다.
          </p>
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
    var _pct = useState(false);
    var showPct = _pct[0];
    var setShowPct = _pct[1];
    var _img = useState(false);
    var imgError = _img[0];
    var setImgError = _img[1];
    var tid = summary && summary.tier ? summary.tier.id : '';
    var pShow =
      summary && summary.pTier != null && isFinite(summary.pTier)
        ? summary.pTier
        : summary && summary.pComprehensive != null && isFinite(summary.pComprehensive)
          ? summary.pComprehensive
          : summary && summary.pTotal != null
            ? summary.pTotal
            : -1;
    useEffect(
      function() {
        setImgError(false);
      },
      [tid, pShow]
    );
    if (!summary || !summary.tier) return null;
    var st = tierStyleForId(tid);
    var label = summary.tier.labelShort || summary.tier.text;
    var levelName = tierLevelDisplayName(tid);
    var src = tierBadgeImageSrc(tid);
    var nCohort = summary.cohortN != null && isFinite(Number(summary.cohortN)) ? Math.max(0, Math.floor(Number(summary.cohortN))) : 0;
    var rSynth = summary.comprehensiveRank != null && isFinite(Number(summary.comprehensiveRank)) ? Number(summary.comprehensiveRank) : NaN;
    var rFallback = summary.rankAverage != null && isFinite(Number(summary.rankAverage)) ? Math.round(Number(summary.rankAverage)) : null;
    var rankForUi = !isNaN(rSynth)
      ? Math.max(1, nCohort > 0 ? Math.min(nCohort, Math.round(rSynth)) : Math.max(1, Math.round(rSynth)))
      : rFallback;

    return (
      <div className="stelvio-octagon-tier-wrap" aria-hidden={false}>
        <div className="stelvio-octagon-tier-inner stelvio-octagon-tier-inner--img">
          <div className="stelvio-octagon-tier-btn-stack">
            <button
              type="button"
              className="stelvio-octagon-tier-btn stelvio-octagon-tier-btn--beast"
              aria-label={levelName + ' 배지 · 클릭 시 항목별 순위·환산 점수 팝업'}
              title="클릭: 항목별 순위·환산 점수"
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
                (rankForUi != null
                  ? levelName + ', 집계 ' + String(rankForUi) + '위, 레벨% ' + (pShow >= 0 ? pShow.toFixed(2) : '—') + '%. '
                  : levelName + ', 레벨% ' + (pShow >= 0 ? pShow.toFixed(2) : '—') + '%. ') + '클릭하여 순위·% 힌트 표시/숨김'
              }
              title="클릭: 순위·레벨% 툴팁"
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
              <span className="stelvio-octagon-tier-hint-split">
                <span className="stelvio-octagon-tier-hint-line stelvio-octagon-tier-hint-rank">{String(rankForUi) + '위'}</span>
                <span className="stelvio-octagon-tier-hint-line stelvio-octagon-tier-hint-pct">
                  {pShow >= 0 && isFinite(pShow) ? pShow.toFixed(2) : '—'}%
                </span>
              </span>
            ) : (
              <span>{pShow >= 0 && isFinite(pShow) ? pShow.toFixed(2) + '%' : '—'}</span>
            )}
          </div>
        </div>
      </div>
    );
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
    var saveKeyRef = useRef('');
    var heptagonLogReqRef = useRef(0);
    var _hLog = useState(null);
    var heptagonRankLog = _hLog[0];
    var setHeptagonRankLog = _hLog[1];
    var _dOpen = useState(false);
    var heptagonDetailOpen = _dOpen[0];
    var setHeptagonDetailOpen = _dOpen[1];
    var _hb = useState({ loading: false, err: null, rows: [], nCohort: 0 });
    var heptagonBoard = _hb[0];
    var setHeptagonBoard = _hb[1];
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
        setStelvioCohortOvl({ loading: true });
        var mk = currentMonthKeyKst();
        var prE = window.getStelvioHeptagonCohortEntry({
          userId: uid,
          monthKey: mk,
          filterCategory: category,
          filterGender: gender
        });
        var prN = window.queryStelvioHeptagonCohortBoardN({
          monthKey: mk,
          filterCategory: category,
          filterGender: gender
        });
        Promise.all([prE, prN])
          .then(function(pair) {
            var ce = pair[0];
            var cn = pair[1];
            var nTotal = cn && cn.ok && cn.nTotal > 0 ? Math.floor(cn.nTotal) : 0;
            if (!nTotal) {
              setStelvioCohortOvl({ loading: false, nTotal: 0, skip: true });
              return;
            }
            if (!ce || !ce.ok || !ce.exists || !ce.data) {
              setStelvioCohortOvl({ loading: false, nTotal: nTotal, skip: true });
              return;
            }
            var d = ce.data;
            var br = d.boardRank;
            if (br == null && d.comprehensiveRank != null) {
              br = d.comprehensiveRank;
            }
            if (br == null || !isFinite(br)) {
              setStelvioCohortOvl({ loading: false, nTotal: nTotal, skip: true });
              return;
            }
            setStelvioCohortOvl({ loading: false, nTotal: nTotal, boardRank: br, cohortData: d, skip: false });
          })
          .catch(function() {
            setStelvioCohortOvl({ loading: false, err: true, skip: true });
          });
      },
      [uid, gender, category]
    );

    useEffect(
      function() {
        if (!uid) {
          setState({ loading: false, err: 'noUser', monthly: null, hof: null });
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
              stateFromRanksArray(cached.monthly.ranks, cached.monthly.cohortSizePerAxis, cached.hof.ranks)
            );
            return;
          }
        }

        setState({ loading: true, err: null, monthly: null, hof: null });
        Promise.all([fetchRanksSet(uid, 'monthly', gender, category), fetchRanksSet(uid, 'yearly', gender, category)])
          .then(function(results) {
            var mRows = results[0];
            var hRows = results[1];
            var monthlyRanks = mRows.map(function(x) {
              return x.rank;
            });
            var cohortSizePerAxis = mRows.map(function(x) {
              return x.n;
            });
            var hofRanks = hRows.map(function(x) {
              return x.rank;
            });
            setState(stateFromApiRows(mRows, hRows));
            if (typeof window.setStelvioOctagonRanksCache === 'function') {
              try {
                window.setStelvioOctagonRanksCache(uid, gender, category, todayStr, monthlyRanks, cohortSizePerAxis, hofRanks);
              } catch (e) {
                console.warn('[StelvioOctagon] cache write failed:', e && e.message);
              }
            }
          })
          .catch(function() {
            setState({ loading: false, err: 'fetch', monthly: null, hof: null });
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
        return applyCohortBoardMerge(tierSummaryComputed, stelvioCohortOvl);
      },
      [tierSummaryComputed, stelvioCohortOvl]
    );

    var heptagonSummaryCacheMerged = useMemo(
      function() {
        if (!heptagonSummaryCache) {
          return null;
        }
        return applyCohortBoardMerge(heptagonSummaryCache, stelvioCohortOvl);
      },
      [heptagonSummaryCache, stelvioCohortOvl]
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
        return applyCohortBoardMerge(heptagonModalBaseTier, heptCohortOvlForModalHeader);
      },
      [heptagonModalBaseTier, heptCohortOvlForModalHeader]
    );

    var heptagonDetailRows = useMemo(
      function() {
        if (state.monthly && tierSummaryComputed) {
          return buildHeptagonDetailRows(state.monthly, tierSummaryComputed);
        }
        if (heptagonRankLog) {
          return buildHeptagonDetailRowsFromLog(heptagonRankLog, currentMonthKeyKst(), gender, category);
        }
        return null;
      },
      [state.monthly, tierSummaryComputed, heptagonRankLog, gender, category]
    );

    var heptagonModalDetailRows = useMemo(
      function() {
        if (heptagonModalGender === gender && heptagonModalCategory === category) {
          return heptagonDetailRows;
        }
        if (heptagonModalRanks && heptagonModalRanks.tierUnmerged && heptagonModalRanks.monthly) {
          return buildHeptagonDetailRows(heptagonModalRanks.monthly, heptagonModalRanks.tierUnmerged);
        }
        return null;
      },
      [
        heptagonDetailRows,
        heptagonModalGender,
        heptagonModalCategory,
        gender,
        category,
        heptagonModalRanks
      ]
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
        setStelvioCohortOvlModal({ loading: true });
        var mk = currentMonthKeyKst();
        var prE = window.getStelvioHeptagonCohortEntry({
          userId: uid,
          monthKey: mk,
          filterCategory: heptagonModalCategory,
          filterGender: heptagonModalGender
        });
        var prN = window.queryStelvioHeptagonCohortBoardN({
          monthKey: mk,
          filterCategory: heptagonModalCategory,
          filterGender: heptagonModalGender
        });
        Promise.all([prE, prN])
          .then(function(pair) {
            var ce = pair[0];
            var cn = pair[1];
            var nTotal = cn && cn.ok && cn.nTotal > 0 ? Math.floor(cn.nTotal) : 0;
            if (!nTotal) {
              setStelvioCohortOvlModal({ loading: false, nTotal: 0, skip: true });
              return;
            }
            if (!ce || !ce.ok || !ce.exists || !ce.data) {
              setStelvioCohortOvlModal({ loading: false, nTotal: nTotal, skip: true });
              return;
            }
            var d = ce.data;
            var br = d.boardRank;
            if (br == null && d.comprehensiveRank != null) {
              br = d.comprehensiveRank;
            }
            if (br == null || !isFinite(br)) {
              setStelvioCohortOvlModal({ loading: false, nTotal: nTotal, skip: true });
              return;
            }
            setStelvioCohortOvlModal({ loading: false, nTotal: nTotal, boardRank: br, cohortData: d, skip: false, useCard: false });
          })
          .catch(function() {
            setStelvioCohortOvlModal({ loading: false, err: true, skip: true, useCard: false });
          });
      },
      [heptagonDetailOpen, uid, heptagonModalGender, heptagonModalCategory, gender, category]
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
        fetchRanksSet(uid, 'monthly', heptagonModalGender, heptagonModalCategory)
          .then(function(mRows) {
            var monthlyRanks = mRows.map(function(x) {
              return x.rank;
            });
            var cohortSizePerAxis = mRows.map(function(x) {
              return x.n;
            });
            var mRat = monthlyRanks.map(rankToRadiusNorm);
            var monthly = { ranks: monthlyRanks, norm: mRat, cohortSizePerAxis: cohortSizePerAxis };
            var tUn = computePTotalAndTier(monthlyRanks, cohortSizePerAxis);
            setHeptagonModalRanks({ loading: false, monthly: monthly, tierUnmerged: tUn });
          })
          .catch(function() {
            setHeptagonModalRanks({ loading: false, err: true });
          });
      },
      [heptagonDetailOpen, uid, heptagonModalGender, heptagonModalCategory, gender, category]
    );

    useEffect(
      function() {
        if (!heptagonDetailOpen) {
          return;
        }
        if (!uid) {
          setHeptagonBoard({ loading: false, err: null, rows: [], nCohort: 0 });
          return;
        }
        if (typeof window.queryStelvioHeptagonCohortBySumDesc !== 'function') {
          setHeptagonBoard({ loading: false, err: 'no-fn', rows: [], nCohort: 0 });
          return;
        }
        setHeptagonBoard({ loading: true, err: null, rows: [], nCohort: 0 });
        var mk = currentMonthKeyKst();
        var prBoard = window.queryStelvioHeptagonCohortBySumDesc({
          monthKey: mk,
          filterCategory: heptagonModalCategory,
          filterGender: heptagonModalGender,
          limit: 500
        });
        var prCohort =
          typeof window.getStelvioHeptagonCohortEntry === 'function'
            ? window.getStelvioHeptagonCohortEntry({
                userId: uid,
                monthKey: mk,
                filterCategory: heptagonModalCategory,
                filterGender: heptagonModalGender
              })
            : Promise.resolve({ ok: false, exists: false, data: null });
        var prCohortSupr =
          typeof window.getStelvioHeptagonCohortEntry === 'function'
            ? window.getStelvioHeptagonCohortEntry({
                userId: uid,
                monthKey: mk,
                filterCategory: 'Supremo',
                filterGender: heptagonModalGender
              })
            : Promise.resolve({ ok: false, exists: false, data: null });
        var prN =
          typeof window.queryStelvioHeptagonCohortBoardN === 'function'
            ? window.queryStelvioHeptagonCohortBoardN({
                monthKey: mk,
                filterCategory: heptagonModalCategory,
                filterGender: heptagonModalGender
              })
            : Promise.resolve({ ok: false, nTotal: 0 });
        Promise.all([prCohort, prCohortSupr, prBoard, prN])
          .then(function(quad) {
            var cr = quad[0];
            var crS = quad[1];
            var res = quad[2];
            var nRes = quad[3];
            var nTotal = nRes && nRes.ok && nRes.nTotal > 0 ? Math.floor(nRes.nTotal) : 0;
            if (res && res.ok) {
              var myData = cr && cr.ok && cr.exists && cr.data ? cr.data : null;
              var myDataSupr = crS && crS.ok && crS.exists && crS.data ? crS.data : null;
              var itemsRaw = res.items || [];
              var nRec = reconcileHeptagonCohortNFromList(nTotal, itemsRaw);
              var built = buildHeptagonModalBoardRows(itemsRaw, uid, myData, myDataSupr);
              setHeptagonBoard({ loading: false, err: null, rows: built.rows, meInList: built.meInList, nCohort: nRec });
            } else {
              setHeptagonBoard({
                loading: false,
                err: (res && res.error) || 'fetch',
                rows: [],
                nCohort: 0
              });
            }
          })
          .catch(function() {
            setHeptagonBoard({ loading: false, err: 'catch', rows: [], nCohort: 0 });
          });
      },
      [heptagonDetailOpen, uid, heptagonModalCategory, heptagonModalGender]
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
        var rankForSave = comprehensiveRankUiFromTierSummary(tierForCard);
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
      [state.loading, state.err, state.monthly, tierForCard, uid, gender, category, userProfile]
    );

    var svg = useMemo(
      function() {
        if (state.loading || !state.monthly || !state.hof) return null;
        var cx = 100;
        var cy = 100;
        var rLabel = 88;
        var rMax = 70;
        var nAxis = N_WKG_AXES;
        var mPts = pathFromPoints(radarPolygonPoints(state.monthly.norm, cx, cy, rMax));
        var hPts = pathFromPoints(radarPolygonPoints(state.hof.norm, cx, cy, rMax));
        var grid = [0.25, 0.5, 0.75, 1].map(function(g) {
          var gr = [];
          for (var gi = 0; gi < nAxis; gi++) gr.push(g);
          return pathFromPoints(radarPolygonPoints(gr, cx, cy, rMax));
        });
        return (
          <svg viewBox="0 0 200 200" className="w-full max-w-[360px] mx-auto h-[260px] touch-manipulation" role="img" aria-label="STELVIO 피크 파워 7축 헵타곤 레벨 포지션">
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
              var t = axisAngle(i, nAxis);
              var lx = cx + rLabel * Math.cos(t);
              var ly = cy + rLabel * Math.sin(t);
              var mr = state.monthly.ranks[i];
              var hr = state.hof.ranks[i];
              var sub2 = (mr != null ? 'M' + mr : 'M—') + ' ' + (hr != null ? 'Y' + hr : 'Y—') + '위';
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
        </div>
      );
    }

    var onHeptagonOpenDetail = function() {
      if (heptagonModalBaseTier || heptagonModalSummary) {
        setHeptagonDetailOpen(true);
      }
    };

    var heptagonModalShowSummary = heptagonModalHeaderSummary || heptagonModalSummary;

    var heptagonDetailModal =
      heptagonDetailOpen && heptagonModalShowSummary ? (
        <HeptagonRankDetailModal
          onClose={function() {
            setHeptagonDetailOpen(false);
          }}
          tierSummary={heptagonModalShowSummary}
          rows={
            heptagonModalGender !== gender || heptagonModalCategory !== category
              ? heptagonModalDetailRows
              : heptagonDetailRows
          }
          axisRowsLoading={
            (heptagonModalGender !== gender || heptagonModalCategory !== category) &&
            !!(heptagonModalRanks && heptagonModalRanks.loading)
          }
          genderLabel={labelForGender(heptagonModalGender)}
          categoryLabel={labelForCategory(heptagonModalCategory)}
          periodLabel="최근 30일 피크 파워(월)"
          boardState={heptagonBoard}
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
          <div className="stelvio-octagon-chart-shell relative w-full max-w-[360px] mx-auto h-[260px]">
            {svg}
            {tierForCard ? (
              <OctagonTierCenterOverlay summary={tierForCard} onOpenDetail={onHeptagonOpenDetail} />
            ) : null}
          </div>
          <div className="flex flex-wrap justify-center gap-3 text-xs text-gray-600 mt-1 mb-0 px-1">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded" style={{ background: 'rgba(124, 58, 237, 0.45)', border: '1px solid #6d28d9' }} />
              <span>최근 30일 피크 파워</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded" style={{ background: 'rgba(16, 185, 129, 0.4)', border: '1px solid #059669' }} />
              <span>최근 365일 피크 파워</span>
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
