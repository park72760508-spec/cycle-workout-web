/**
 * useRunDashboardData - Custom Hook for Performance Dashboard
 * 프로필, 훈련 로그, AI 분석, 차트 데이터를 통합 관리합니다.
 * @returns {Object} 데이터 상태 및 핸들러
 */
(function() {
  'use strict';

  if (typeof window === 'undefined') return;
  var React = window.React;
  if (!React || !React.useState || !React.useEffect || !React.useRef) {
    console.warn('[useRunDashboardData] React hooks not available');
    return;
  }

  var useState = React.useState;
  var useEffect = React.useEffect;
  var useRef = React.useRef;
  var useMemo = React.useMemo;
  if (!useMemo) {
    console.warn('[useRunDashboardData] useMemo not available, AI cache trigger may re-run on each render');
    useMemo = function(factory) {
      return factory();
    };
  }

  /**
   * TSS 단일 세션 유효 범위 필터 (파일 전역 사용)
   * 9999 = AI 스케줄 "제한 없음" 플레이스홀더, 그 외 비정상 대값 방어
   * 단일 세션 현실 상한 ≈ 1,200 (200km 이상 울트라 라이딩)
   */
  function sanitizeRtss(val) {
    var n = Number(val) || 0;
    return (n > 0 && n < 1200) ? n : 0;
  }

  /** currentUser / Firestore / localStorage 공통 — 생년·성별·연령 추출 */
  function pickDemographicsFromUser(source) {
    if (!source) {
      return { birth_year: null, birthYear: null, gender: '', sex: '', age: null };
    }
    var birthYear = source.birth_year != null ? source.birth_year : source.birthYear;
    if (birthYear == null && source.birth && source.birth.year != null) {
      birthYear = source.birth.year;
    }
    var genderRaw = source.gender != null && String(source.gender).trim() !== ''
      ? source.gender
      : (source.sex != null ? source.sex : '');
    var age = source.age != null ? Number(source.age) : null;
    if ((!isFinite(age) || age <= 0) && birthYear != null && isFinite(Number(birthYear))) {
      age = new Date().getFullYear() - Number(birthYear);
    }
    return {
      birth_year: birthYear != null && isFinite(Number(birthYear)) ? Number(birthYear) : null,
      birthYear: birthYear != null && isFinite(Number(birthYear)) ? Number(birthYear) : null,
      gender: String(genderRaw || ''),
      sex: String(source.sex || source.gender || ''),
      age: isFinite(age) && age > 0 && age < 120 ? Math.round(age) : null
    };
  }

  function buildRunDashboardUserProfile(base) {
    var demo = pickDemographicsFromUser(base);
    var runChallenge =
      typeof window.resolveChallengeForSport === 'function'
        ? window.resolveChallengeForSport(base, 'run')
        : base.run_challenge || base.challenge || 'Fitness';
    return {
      id: base.id,
      name: base.name || '사용자',
      ftp: Number(base.ftp) || 0,
      weight: Number(base.weight) || 0,
      grade: base.grade || '2',
      challenge: runChallenge,
      run_challenge: base.run_challenge || runChallenge || '',
      category: 'RUN',
      sport_category: 'RUN',
      acc_points: base.acc_points || 0,
      rem_points: base.rem_points || 0,
      strava_refresh_token: base.strava_refresh_token,
      strava_last_sync: base.strava_last_sync,
      is_private: base.is_private === true,
      birth_year: demo.birth_year,
      birthYear: demo.birthYear,
      gender: demo.gender,
      sex: demo.sex,
      age: demo.age
    };
  }

  function parseDateForCoachAnalysis(date) {
    if (!date) return null;
    var d = null;
    if (date.toDate && typeof date.toDate === 'function') d = date.toDate();
    else if (date instanceof Date) d = date;
    else if (typeof date === 'string') {
      var ds0 = (date.split('T')[0] || '').trim();
      d = /^\d{4}-\d{2}-\d{2}$/.test(ds0) ? new Date(ds0 + 'T00:00:00') : new Date(date);
    }
    if (!d || isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * todayStr, logsToSend, 7일 TSS, buildLogsSignatureForCache용 시그니처를 일관되게 계산한다.
   * useMemo 트리거 키와 effect 본문이 항상 동일한 캐시 키를 쓰도록 공유한다.
   */
  function buildCoachContextForCoachAnalysis(recentLogs) {
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    var out = { today: today, todayStr: todayStr, logsToSend: [], last7Rtss: 0, logsSignature: '0' };
    if (!recentLogs || !Array.isArray(recentLogs) || !recentLogs.length) {
      return out;
    }
    var ninetyDaysAgo = new Date(today);
    ninetyDaysAgo.setDate(today.getDate() - 89);
    var ninetyStr =
      ninetyDaysAgo.getFullYear() +
      '-' +
      String(ninetyDaysAgo.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(ninetyDaysAgo.getDate()).padStart(2, '0');
    var logsToSend = recentLogs
      .filter(function(log) {
        if (!isRunLogForWeeklyTss(log)) return false;
        var ds = parseDateForCoachAnalysis(log.date);
        return ds && ds >= ninetyStr && ds <= todayStr;
      })
      .sort(function(a, b) {
        return (parseDateForCoachAnalysis(a.date) || '').localeCompare(parseDateForCoachAnalysis(b.date) || '');
      });
    out.logsToSend = logsToSend;
    var start7 = new Date(today);
    start7.setDate(today.getDate() - 6);
    var start7Str = start7.getFullYear() + '-' + String(start7.getMonth() + 1).padStart(2, '0') + '-' + String(start7.getDate()).padStart(2, '0');
    var byDate7 = {};
    logsToSend.forEach(function(log) {
      var ds = parseDateForCoachAnalysis(log.date);
      if (!ds || ds < start7Str || ds > todayStr) return;
      if (!byDate7[ds]) byDate7[ds] = { strava: [], stelvio: [] };
      var src = String(log.source || '').toLowerCase();
      var tss = sanitizeRtss(log.tss);
      if (src === 'strava') byDate7[ds].strava.push(tss);
      else byDate7[ds].stelvio.push(tss);
    });
    var last7Rtss = 0;
    Object.keys(byDate7).forEach(function(ds) {
      var day = byDate7[ds];
      if (day.strava.length > 0) day.strava.forEach(function(t) { last7Rtss += t; });
      else if (day.stelvio.length > 0) day.stelvio.forEach(function(t) { last7Rtss += t; });
    });
    last7Rtss = Math.round(last7Rtss);
    out.last7Rtss = last7Rtss;
    out.logsSignature =
      typeof window.buildLogsSignatureForCache === 'function'
        ? window.buildLogsSignatureForCache(logsToSend, last7Rtss)
        : logsToSend.length + '_' + last7Rtss;
    return out;
  }

  function isRunLogForWeeklyTss(log) {
    if (typeof window.isRunTrainingLog === 'function') return window.isRunTrainingLog(log);
    var type = String(log && log.activity_type || '').trim().toLowerCase();
    return type === 'run' || type === 'trailrun' || type === 'virtualrun';
  }

  function applyThresholdPaceToStats(prev, paceInfo) {
    var next = Object.assign({}, prev);
    var info = paceInfo || {};
    next.thresholdPaceSec = info.secPerKm != null ? info.secPerKm : null;
    next.thresholdPaceDisplay = info.display || info.paceValue || null;
    next.thresholdPaceValue = info.paceValue || info.display || null;
    next.thresholdPaceUnit = info.paceUnit || 'min/km';
    next.thresholdPaceInferred = !!info.inferred;
    next.thresholdPaceInferredFrom = info.inferredFrom || null;
    next.thresholdPaceUnavailable = !!info.unavailable;
    next.thresholdPace = info.secPerKm != null ? Math.round(info.secPerKm) : 0;
    var tier = info.hexagonTier || null;
    if (!tier && info.secPerKm != null && window.runDashboardPace && typeof window.runDashboardPace.getRunHexagonTierFromPaceSec === 'function') {
      tier = window.runDashboardPace.getRunHexagonTierFromPaceSec(info.secPerKm);
    }
    next.hexagonTierId = tier ? tier.tierId : null;
    next.hexagonTierLabel = tier ? tier.label : null;
    next.hexagonTierLevelName = tier ? tier.levelName : null;
    next.hexagonTierBadgeSrc = tier ? tier.badgeSrc : null;
    return next;
  }

  function computeRunVo2Estimate(userProfile, runLogs, thresholdPaceSec) {
    if (typeof window.calculateStelvioRunVO2Max !== 'function') return null;
    return window.calculateStelvioRunVO2Max(userProfile, runLogs, {
      thresholdPaceSec: thresholdPaceSec,
    });
  }

  function applyRunVo2ToStats(prev, vo2Result) {
    var next = Object.assign({}, prev);
    if (!vo2Result) {
      next.vo2maxEstimate = null;
      return next;
    }
    next.vo2maxEstimate = vo2Result.vo2max;
    next.vo2maxMethod = vo2Result.method || null;
    next.vo2maxComponents = vo2Result.components || null;
    return next;
  }

  async function fetchRunCoachLeaderboardContext(userId) {
    var emptyPace = { secPerKm: null, display: null, inferred: false, inferredFrom: null, unavailable: true };
    var empty = { thresholdPace: emptyPace, hexagonContext: null };
    if (window.runDashboardPace && typeof window.runDashboardPace.fetchRunLeaderboardCoachContext === 'function') {
      try {
        return await window.runDashboardPace.fetchRunLeaderboardCoachContext(userId);
      } catch (e) {
        console.warn('[useRunDashboardData] fetchRunLeaderboardCoachContext failed:', e);
      }
    }
    return empty;
  }

  function normalizeRunCoachAnalysis(analysis) {
    if (typeof window.normalizeRunCoachPayload === 'function') {
      return window.normalizeRunCoachPayload(analysis);
    }
    if (!analysis || typeof window.pickDeterministicRunRecommendedWorkout !== 'function') return analysis;
    var next = Object.assign({}, analysis);
    next.recommended_workout = window.pickDeterministicRunRecommendedWorkout({
      category: next.workout_category,
      primaryZone: next.training_zone,
      hexagonOverride: next.hexagon_override,
      recommendedWorkout: next.recommended_workout
    });
    if (typeof window.parseRunWorkoutZone === 'function') {
      next.training_zone = window.parseRunWorkoutZone(next.recommended_workout);
    }
    next.sport_category = 'run';
    return next;
  }

  function isAcceptableRunCoachCache(cached) {
    if (!cached || cached.condition_score == null || cached.error_reason) return false;
    var normalized = normalizeRunCoachAnalysis(Object.assign({}, cached));
    if (normalized.sport_category !== 'run') return false;
    if (typeof window.isRunWorkoutLabel === 'function') {
      return window.isRunWorkoutLabel(normalized.recommended_workout);
    }
    return true;
  }

  function useRunDashboardData() {
    var _useState = useState(null);
    var userProfile = _useState[0];
    var setUserProfile = _useState[1];

    var _useState2 = useState({
      thresholdPace: 0,
      thresholdPaceSec: null,
      thresholdPaceDisplay: null,
      thresholdPaceValue: null,
      thresholdPaceUnit: 'min/km',
      thresholdPaceInferred: false,
      thresholdPaceInferredFrom: null,
      thresholdPaceUnavailable: true,
      weightKg: 0,
      weight: 0,
      totalPoints: 0,
      currentPoints: 0,
      weeklyRtssGoal: 175,
      weeklyRtssProgress: 0,
      vo2maxEstimate: null
    });
    var stats = _useState2[0];
    var setStats = _useState2[1];

    var _useState3 = useState([]);
    var recentLogs = _useState3[0];
    var setRecentLogs = _useState3[1];

    var _useState4 = useState(false);
    var logsLoaded = _useState4[0];
    var setLogsLoaded = _useState4[1];

    var _useState5 = useState(false);
    var logsLoading = _useState5[0];
    var setLogsLoading = _useState5[1];

    var _useState6 = useState(null);
    var logsLoadError = _useState6[0];
    var setLogsLoadError = _useState6[1];

    var _useState7 = useState(false);
    var loading = _useState7[0];
    var setLoading = _useState7[1];

    var _useState8 = useState(null);
    var coachData = _useState8[0];
    var setCoachData = _useState8[1];

    var _useState9 = useState(false);
    var runConditionAnalysis = _useState9[0];
    var setRunConditionAnalysis = _useState9[1];

    var _useState10 = useState(0);
    var retryCoach = _useState10[0];
    var setRetryCoach = _useState10[1];

    var _useState11 = useState(false);
    var aiLoading = _useState11[0];
    var setAiLoading = _useState11[1];

    var _useState12 = useState(null);
    var streamingComment = _useState12[0];
    var setStreamingComment = _useState12[1];

    var _useState13 = useState([]);
    var fitnessData = _useState13[0];
    var setFitnessData = _useState13[1];

    var _useState14 = useState([]);
    var vo2TrendData = _useState14[0];
    var setVo2TrendData = _useState14[1];

    var _useState14b = useState([]);
    var weeklyTssTrendData = _useState14b[0];
    var setWeeklyTssTrendData = _useState14b[1];

    var _useState15 = useState([]);
    var growthTrendData = _useState15[0];
    var setGrowthTrendData = _useState15[1];

    var _useState16 = useState([]);
    var yearlyPowerPrData = _useState16[0];
    var setYearlyPowerPrData = _useState16[1];

    var _useState17 = useState({ connected: false, lastSync: null });
    var stravaStatus = _useState17[0];
    var setStravaStatus = _useState17[1];

    var _useState18 = useState(false);
    var ftpCalcLoading = _useState18[0];
    var setFtpCalcLoading = _useState18[1];

    var _useState19 = useState(false);
    var ftpModalOpen = _useState19[0];
    var setFtpModalOpen = _useState19[1];

    var _useState20 = useState(null);
    var ftpCalcResult = _useState20[0];
    var setFtpCalcResult = _useState20[1];

    var _useState21 = useState(null);
    var hexagonCoachContext = _useState21[0];
    var setHexagonCoachContext = _useState21[1];

    var _useState22 = useState(false);
    var runLeaderboardCoachReady = _useState22[0];
    var setRunLeaderboardCoachReady = _useState22[1];

    var retryLogsRef = useRef(null);
    var aiAnalysisInProgressRef = useRef(false);
    var statsRef = useRef(stats);
    var lastCoachTriggerKeyRef = useRef('');
    var coachDataRef = useRef(null);

    useEffect(function syncStatsRef() {
      statsRef.current = stats;
    }, [stats]);

    useEffect(function syncCoachDataRef() {
      coachDataRef.current = coachData;
    }, [coachData]);

    /** effect 의존성에 recentLogs 배열 ref 대신 'uid|날짜|로그시그니처'만 두어, 데이터 동일 시 재실행·재분석을 막는다. */
    var coachAnalysisTriggerKey = useMemo(
      function() {
        var uid = userProfile && userProfile.id;
        if (!uid) return '';
        if (!logsLoaded || logsLoading || !runLeaderboardCoachReady) return 'loading';
        if (logsLoadError) return 'err|' + String(uid);
        var runLogs = (recentLogs || []).filter(isRunLogForWeeklyTss);
        var hexSig = hexagonCoachContext && hexagonCoachContext.missingAxes
          ? hexagonCoachContext.missingAxes.join(',')
          : 'none';
        if (!runLogs.length && !hexagonCoachContext) return 'nologs|' + String(uid);
        var ctx0 = buildCoachContextForCoachAnalysis(recentLogs);
        return String(uid) + '|' + ctx0.todayStr + '|' + ctx0.logsSignature + '|' + hexSig;
      },
      [userProfile && userProfile.id, logsLoaded, logsLoading, logsLoadError, recentLogs, hexagonCoachContext, runLeaderboardCoachReady]
    );

    // --- Profile Load ---
    useEffect(function profileLoadEffect() {
      var loadingTimeout = null;
      var isLowSpec = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
      var baseMs = isLowSpec ? 20000 : 8000;

      function clearLoadingTimeout() {
        if (loadingTimeout) {
          clearTimeout(loadingTimeout);
          loadingTimeout = null;
        }
      }

      loadingTimeout = setTimeout(function() {
        console.warn('[Dashboard] Profile load timeout');
        setLoading(false);
      }, baseMs);

      var selectedUser = window.currentUser;
      if (!selectedUser || !selectedUser.id) {
        try {
          var stored = localStorage.getItem('currentUser');
          if (stored) {
            var parsed = JSON.parse(stored);
            if (parsed && parsed.id) {
              selectedUser = parsed;
              window.currentUser = parsed;
            }
          }
        } catch (e) {}
      }

      if (selectedUser && selectedUser.id) {
        var userId = selectedUser.id;
        var userName = selectedUser.name || '사용자';
        var ftp = Number(selectedUser.ftp) || 0;
        var weight = Number(selectedUser.weight) || 0;
        var wkg = weight > 0 ? (ftp / weight).toFixed(2) : 0;
        var challenge = (typeof window.resolveChallengeForSport === 'function')
          ? window.resolveChallengeForSport(selectedUser, 'run')
          : (selectedUser.run_challenge || selectedUser.challenge || 'Fitness');
        var weeklyTarget = 175;
        if (typeof window.getWeeklyTargetRtss === 'function') {
          var ti = window.getWeeklyTargetRtss(challenge);
          if (ti && ti.target != null) weeklyTarget = ti.target;
        }

        setUserProfile(buildRunDashboardUserProfile(Object.assign({}, selectedUser, {
          id: userId,
          name: userName,
          ftp: ftp,
          weight: weight,
          grade: selectedUser.grade || '2',
          challenge: challenge,
          run_challenge: selectedUser.run_challenge || '',
          category: selectedUser.category || selectedUser.sport_category || 'RUN',
          acc_points: selectedUser.acc_points || 0,
          rem_points: selectedUser.rem_points || 0,
          strava_refresh_token: selectedUser.strava_refresh_token,
          strava_last_sync: selectedUser.strava_last_sync,
          is_private: selectedUser.is_private === true
        })));
        setStats({
          ftp: ftp,
          wkg: parseFloat(wkg),
          weight: weight,
          totalPoints: Number(selectedUser.acc_points || 0),
          currentPoints: Number(selectedUser.rem_points || 0),
          weeklyRtssGoal: weeklyTarget,
          weeklyRtssProgress: 0
        });
        setStravaStatus({
          connected: !!(selectedUser.strava_refresh_token),
          lastSync: selectedUser.strava_last_sync || null
        });
        clearLoadingTimeout();
        setLoading(false);

        (async function syncFromFirestore() {
          try {
            var firestore = window.firestore || (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null);
            if (!firestore) return;
            var userDoc = await firestore.collection('users').doc(userId).get();
            if (!userDoc.exists) return;
            var d = userDoc.data() || {};
            var f = Number(d.ftp) || 0;
            var w = Number(d.weight) || 0;
            var wk = w > 0 ? (f / w).toFixed(2) : 0;
            var ch = (typeof window.resolveChallengeForSport === 'function')
              ? window.resolveChallengeForSport(d, 'run')
              : (d.challenge || 'Fitness');
            var wt = 175;
            if (typeof window.getWeeklyTargetRtss === 'function') {
              var tInfo = window.getWeeklyTargetRtss(ch);
              if (tInfo && tInfo.target != null) wt = tInfo.target;
            }
            setUserProfile(buildRunDashboardUserProfile(Object.assign({}, d, {
              id: userId,
              name: d.name || userName,
              ftp: f,
              weight: w,
              grade: d.grade || '2',
              challenge: ch,
              run_challenge: d.run_challenge || ch || '',
              acc_points: d.acc_points || 0,
              rem_points: d.rem_points || 0,
              is_private: d.is_private === true
            })));
            setStats(function(prev) {
              var next = Object.assign({}, prev);
              next.ftp = f;
              next.wkg = parseFloat(wk);
              next.weight = w;
              next.totalPoints = Number(d.acc_points || 0);
              next.currentPoints = Number(d.rem_points || 0);
              next.weeklyRtssGoal = wt;
              return next;
            });
            setStravaStatus({
              connected: !!(d.strava_refresh_token),
              lastSync: d.strava_last_sync || null
            });
          } catch (e) {
            console.warn('[Dashboard] Firestore sync failed:', e);
          }
        })();
        return;
      }

      var auth = window.authV9 || window.auth || (typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null);
      if (auth && auth.currentUser) {
        clearLoadingTimeout();
        setLoading(false);
        var u = auth.currentUser;
        setUserProfile({ id: u.uid, name: u.displayName || '사용자', thresholdPace: 0, weight: 0, grade: '2', acc_points: 0, rem_points: 0 });
      } else {
        clearLoadingTimeout();
        setLoading(false);
      }

      return function() { clearLoadingTimeout(); };
    }, []);

    // --- Logs Load (depends on userProfile) ---
    useEffect(function logsLoadEffect() {
      if (!userProfile || !userProfile.id) {
        setLogsLoading(false);
        return;
      }

      var isMounted = true;

      function parseDate(date) {
        if (!date) return null;
        var d = null;
        if (date.toDate && typeof date.toDate === 'function') {
          d = date.toDate();
        } else if (date instanceof Date) {
          d = date;
        } else if (typeof date === 'string') {
          var ds = (date.split('T')[0] || '').trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) d = new Date(ds + 'T00:00:00');
          else d = new Date(date);
        } else {
          return null;
        }
        if (!d || isNaN(d.getTime())) return null;
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }

      var pad2 = function(n) { return String(n).padStart(2, '0'); };
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var todayStr = today.getFullYear() + '-' + pad2(today.getMonth() + 1) + '-' + pad2(today.getDate());
      var sixtyDaysAgo = new Date(today);
      sixtyDaysAgo.setDate(today.getDate() - 60);
      var sixtyDaysStr = sixtyDaysAgo.getFullYear() + '-' + pad2(sixtyDaysAgo.getMonth() + 1) + '-' + pad2(sixtyDaysAgo.getDate());
      var rollingSixMonthStart = new Date(today);
      rollingSixMonthStart.setDate(today.getDate() - 182);
      var rollingSixMonthStr =
        rollingSixMonthStart.getFullYear() + '-' + pad2(rollingSixMonthStart.getMonth() + 1) + '-' + pad2(rollingSixMonthStart.getDate());
      var sixMonthsAgo = new Date(today);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      var sixMonthsStr = sixMonthsAgo.getFullYear() + '-' + pad2(sixMonthsAgo.getMonth() + 1) + '-' + pad2(sixMonthsAgo.getDate());

      async function loadRecentLogs() {
        setLogsLoading(true);
        setLogsLoadError(null);
        setRunLeaderboardCoachReady(false);
        try {
          var raw = [];
          if (typeof window.getUserRunTrainingLogs === 'function') {
            raw = await window.getUserRunTrainingLogs(userProfile.id, { limit: 400 });
            raw = Array.isArray(raw) ? raw : [];
          } else {
            throw new Error('RUN 활동 로그 모듈을 불러올 수 없습니다.');
          }
          if (!raw.length) {
            console.warn('[useRunDashboardData] Supabase activities RUN 로그 없음');
          }

          var logs = raw.filter(function(log) {
            var ds = parseDate(log.date);
            return ds && ds >= rollingSixMonthStr && ds <= todayStr;
          });
          logs.sort(function(a, b) {
            var da = parseDate(a.date) || '';
            var db = parseDate(b.date) || '';
            return db.localeCompare(da);
          });

          var logsDeduped = logs.filter(isRunLogForWeeklyTss);

          if (isMounted) {
            setRecentLogs(logsDeduped);
            setLogsLoaded(true);
          }

          var weeklyTss = 0;
          if (typeof window.getUserRunWeeklyTss === 'function') {
            try {
              weeklyTss = await window.getUserRunWeeklyTss(userProfile.id);
            } catch (weeklyErr) {
              console.warn('[useRunDashboardData] getUserRunWeeklyTss failed:', weeklyErr && weeklyErr.message);
            }
          }
          var weeklyTarget = 175;
          var runChallenge = (typeof window.resolveChallengeForSport === 'function')
            ? window.resolveChallengeForSport(userProfile, 'run')
            : (userProfile.challenge || 'Fitness');
          if (typeof window.getWeeklyTargetRtss === 'function') {
            var tInfo = window.getWeeklyTargetRtss(runChallenge);
            if (tInfo && tInfo.target != null) weeklyTarget = tInfo.target;
          }
          var lbCoachCtx = await fetchRunCoachLeaderboardContext(userProfile.id);
          var paceInfo = (lbCoachCtx && lbCoachCtx.thresholdPace) || {};
          var vo2Result = computeRunVo2Estimate(
            userProfile,
            logsDeduped,
            paceInfo.secPerKm != null ? paceInfo.secPerKm : null
          );
          if (isMounted) {
            setStats(function(prev) {
              var next = Object.assign({}, prev);
              next.weeklyRtssGoal = weeklyTarget;
              next.weeklyRtssProgress = Math.min(Math.round(weeklyTss * 10) / 10, 9999);
              next = applyThresholdPaceToStats(next, paceInfo);
              return applyRunVo2ToStats(next, vo2Result);
            });
            setHexagonCoachContext(lbCoachCtx && lbCoachCtx.hexagonContext ? lbCoachCtx.hexagonContext : null);
            setRunLeaderboardCoachReady(true);
          }

          var RUN_GROWTH_SPEED_FIELDS = ['speed_1k', 'speed_3k', 'speed_5k', 'speed_7k', 'speed_10k', 'speed_20k'];
          var RUN_GROWTH_HR_FIELDS = ['hr_1k', 'hr_3k', 'hr_5k', 'hr_7k', 'hr_10k', 'hr_20k'];
          var RUN_GROWTH_SLOT_COUNT = 6;
          function emptyRunGrowthDay() {
            return {
              w: [0, 0, 0, 0, 0, 0],
              h: [0, 0, 0, 0, 0, 0],
              wDate: [null, null, null, null, null, null],
              hDate: [null, null, null, null, null, null]
            };
          }
          var effortsForGrowth = [];
          if (typeof window.getUserRunEfforts === 'function') {
            try {
              effortsForGrowth = await window.getUserRunEfforts(userProfile.id, { limit: 600 }) || [];
            } catch (growthEffErr) {
              console.warn('[useRunDashboardData] growth efforts:', growthEffErr && growthEffErr.message);
            }
          }
          var byDateGrowth = {};
          effortsForGrowth.forEach(function(eff) {
            var ds = String(eff.activity_date || '').slice(0, 10);
            if (!ds || ds < sixMonthsStr || ds > todayStr) return;
            if (!byDateGrowth[ds]) byDateGrowth[ds] = emptyRunGrowthDay();
            var d = byDateGrowth[ds];
            var si;
            for (si = 0; si < RUN_GROWTH_SLOT_COUNT; si++) {
              var wv = Number(eff[RUN_GROWTH_SPEED_FIELDS[si]]) || 0;
              var hv = Number(eff[RUN_GROWTH_HR_FIELDS[si]]) || 0;
              if (wv > d.w[si]) {
                d.w[si] = wv;
                d.wDate[si] = ds;
              }
              if (hv > d.h[si]) {
                d.h[si] = hv;
                d.hDate[si] = ds;
              }
            }
          });
          var growthRows = [];
          for (var mOff = 5; mOff >= 0; mOff--) {
            var dMonth = new Date(today.getFullYear(), today.getMonth() - mOff, 1);
            var y = dMonth.getFullYear();
            var m = dMonth.getMonth() + 1;
            var startStr = y + '-' + pad2(m) + '-01';
            var endStr = y + '-' + pad2(m) + '-' + pad2(new Date(y, m, 0).getDate());
            if (mOff === 0) {
              endStr = todayStr;
            }
            var monthW = [0, 0, 0, 0, 0, 0];
            var monthH = [0, 0, 0, 0, 0, 0];
            var monthPeakDateW = [null, null, null, null, null, null];
            var monthPeakDateH = [null, null, null, null, null, null];
            Object.keys(byDateGrowth).forEach(function(ds) {
              if (ds < startStr || ds > endStr) return;
              var day = byDateGrowth[ds];
              var si2;
              for (si2 = 0; si2 < RUN_GROWTH_SLOT_COUNT; si2++) {
                if (day.w[si2] > monthW[si2]) {
                  monthW[si2] = day.w[si2];
                  monthPeakDateW[si2] = day.wDate[si2] || ds;
                }
                if (day.h[si2] > monthH[si2]) {
                  monthH[si2] = day.h[si2];
                  monthPeakDateH[si2] = day.hDate[si2] || ds;
                }
              }
            });
            var monthLabel = m + '월';
            if (mOff === 0) monthLabel = m + '월(현재)';
            growthRows.push({
              monthLabel: monthLabel,
              sortKey: y + '-' + pad2(m),
              growthSport: 'run',
              growthWattsSlots: monthW.map(function(v) { return v > 0 ? v : null; }),
              growthHrSlots: monthH.map(function(v) { return v > 0 ? v : null; }),
              growthWattsPeakDates: monthPeakDateW.slice(),
              growthHrPeakDates: monthPeakDateH.slice(),
              max20minWatts: monthW[4] > 0 ? monthW[4] : null,
              maxHr20min: monthH[4] > 0 ? monthH[4] : null
            });
          }
          growthRows.sort(function(a, b) { return (a.sortKey || '').localeCompare(b.sortKey || ''); });
          if (isMounted) setGrowthTrendData(growthRows);

          var chartData =
            typeof window.buildRunFitnessTrendChartData === 'function'
              ? window.buildRunFitnessTrendChartData(logsDeduped, {
                  today: today,
                  parseDate: parseDate,
                  windowDays: 60
                })
              : [];
          if (isMounted) setFitnessData(chartData);
          if (isMounted && userProfile) {
            var persistRun =
              typeof window.persistRunFitnessDemographicSampleAsync === 'function'
                ? window.persistRunFitnessDemographicSampleAsync
                : null;
            if (persistRun) persistRun(userProfile, chartData).catch(function () {});
          }

          var vo2Rows = [];
          for (var mOff = 5; mOff >= 0; mOff--) {
            var dMonth = new Date(today.getFullYear(), today.getMonth() - mOff, 1);
            var y = dMonth.getFullYear();
            var m = dMonth.getMonth() + 1;
            var startStr = y + '-' + pad2(m) + '-01';
            var endStr = y + '-' + pad2(m) + '-' + pad2(new Date(y, m, 0).getDate());
            if (mOff === 0) {
              endStr = todayStr;
            }
            var inMonth = raw.filter(function(log) {
              var ds = parseDate(log.date);
              return ds && ds >= startStr && ds <= endStr;
            });
            var byDateVo2 = {};
            inMonth.forEach(function(log) {
              var ds = parseDate(log.date);
              if (!ds) return;
              if (!byDateVo2[ds]) byDateVo2[ds] = [];
              byDateVo2[ds].push(log);
            });
            var merged = [];
            Object.keys(byDateVo2).sort().forEach(function(dk) {
              var arr = byDateVo2[dk];
              var strava = arr.filter(function(l) { return String(l.source || '').toLowerCase() === 'strava'; });
              var chosen = strava.length > 0 ? strava : arr;
              if (chosen.length === 0) return;
              var totalSec = 0, totalTss = 0, totalDist = 0, sumHr = 0;
              chosen.forEach(function(l) {
                var sec = Number(l.duration_sec ?? l.time ?? l.duration ?? 0) || (Number(l.duration_min) || 0) * 60;
                var dist = Number(l.distance_km ?? l.distance ?? 0);
                totalSec += sec;
                totalDist += dist > 0 && dist < 200 ? dist : 0;
                totalTss += sanitizeRtss(l.tss);
                sumHr += (Number(l.avg_hr ?? 0)) * sec;
              });
              merged.push({
                date: dk,
                duration_sec: totalSec,
                distance_km: totalDist > 0 ? Math.round(totalDist * 1000) / 1000 : null,
                tss: Math.round(totalTss),
                avg_hr: totalSec > 0 ? Math.round(sumHr / totalSec) : 0,
                activity_type: 'Run',
                source: chosen[0].source || 'strava'
              });
            });
            var monthTpSec = mOff === 0 && paceInfo && paceInfo.secPerKm != null ? paceInfo.secPerKm : null;
            var vo2Val = null;
            if (typeof window.calculateStelvioRunVO2Max === 'function') {
              vo2Val = window.calculateStelvioRunVO2Max(userProfile, inMonth.length ? inMonth : merged, {
                thresholdPaceSec: monthTpSec,
              }).vo2max;
            }
            vo2Rows.push({ monthLabel: m + '월' + (mOff === 0 ? '(현재)' : ''), vo2: vo2Val != null ? vo2Val : null, sortKey: y + '-' + pad2(m) });
          }
          vo2Rows.sort(function(a, b) { return a.sortKey.localeCompare(b.sortKey); });
          if (isMounted) setVo2TrendData(vo2Rows);
          if (isMounted && userProfile && typeof window.persistVo2DemographicSampleAsync === 'function') {
            window.persistVo2DemographicSampleAsync(userProfile, vo2Rows).catch(function() {});
          }

          var oldestStart = new Date(today);
          oldestStart.setDate(today.getDate() - (29 * 7 + 6));
          var tssRangeStartRolling = oldestStart.getFullYear() + '-' + pad2(oldestStart.getMonth() + 1) + '-' + pad2(oldestStart.getDate());
          var rawForWeeklyTss = raw.filter(function(log) {
            var dsT = parseDate(log.date);
            return dsT && dsT >= tssRangeStartRolling && dsT <= todayStr;
          });
          var byDayTssBuckets = {};
          rawForWeeklyTss.forEach(function(log) {
            var dsT = parseDate(log.date);
            if (!dsT) return;
            if (!byDayTssBuckets[dsT]) byDayTssBuckets[dsT] = { strava: [], stelvio: [] };
            var srcT = String(log.source || '').toLowerCase();
            var tssOne = sanitizeRtss(log.tss);
            if (srcT === 'strava') byDayTssBuckets[dsT].strava.push(tssOne);
            else byDayTssBuckets[dsT].stelvio.push(tssOne);
          });
          var dayTssTotals = {};
          Object.keys(byDayTssBuckets).forEach(function(dsT) {
            var buck = byDayTssBuckets[dsT];
            var stravaSum = buck.strava.reduce(function(s, t) { return s + t; }, 0);
            var stelvioSum = buck.stelvio.reduce(function(s, t) { return s + t; }, 0);
            dayTssTotals[dsT] = stravaSum > 0 ? stravaSum : stelvioSum;
          });
          var weeklyTssRows = [];
          for (var wkOff = 29; wkOff >= 0; wkOff--) {
            var endDw = new Date(today);
            endDw.setDate(today.getDate() - wkOff * 7);
            var startDw = new Date(today);
            startDw.setDate(today.getDate() - (wkOff * 7 + 6));
            var startStrW = startDw.getFullYear() + '-' + pad2(startDw.getMonth() + 1) + '-' + pad2(startDw.getDate());
            var endStrW = endDw.getFullYear() + '-' + pad2(endDw.getMonth() + 1) + '-' + pad2(endDw.getDate());
            var weekSumW = 0;
            Object.keys(dayTssTotals).forEach(function(dsT) {
              if (dsT >= startStrW && dsT <= endStrW) weekSumW += dayTssTotals[dsT];
            });
            var chartIdx = 29 - wkOff;
            var showEveryFive = chartIdx % 5 === 0 || chartIdx === 29;
            var tickLabel = showEveryFive ? endDw.getMonth() + 1 + '/' + endDw.getDate() : '';
            weeklyTssRows.push({
              weekLabel: tickLabel,
              tss: Math.round(weekSumW),
              sortKey: endStrW,
              showValueLabel: showEveryFive
            });
          }
          if (isMounted) setWeeklyTssTrendData(weeklyTssRows);
          if (isMounted && userProfile && typeof window.persistWeeklyTssDemographicSampleAsync === 'function') {
            window.persistWeeklyTssDemographicSampleAsync(userProfile, weeklyTssRows).catch(function () {});
          }

          var currentYear = today.getFullYear();
          var yearStart = currentYear + '-01-01';
          var logsYear = raw.filter(function(log) {
            var ds = parseDate(log.date);
            return ds && ds >= yearStart && ds <= todayStr;
          });
          if (typeof window.dedupeTrainingLogsByDateStravaFirst === 'function') {
            logsYear = window.dedupeTrainingLogsByDateStravaFirst(logsYear);
          }
          var prConfig = [
            { field: 'max_watts', label: 'Max' },
            { field: 'max_1min_watts', label: '1분' },
            { field: 'max_5min_watts', label: '5분' },
            { field: 'max_10min_watts', label: '10분' },
            { field: 'max_20min_watts', label: '20분' },
            { field: 'max_40min_watts', label: '40분' },
            { field: 'max_60min_watts', label: '60분' }
          ];
          (async function() {
            var peaks = null;
            if (typeof window.fetchYearlyPeaksForYear === 'function') {
              try { peaks = await window.fetchYearlyPeaksForYear(userProfile.id, currentYear); } catch (e) {}
            }
            var userW = Number(userProfile.weight) || 0;
            var prRows = prConfig.map(function(cfg) {
              var pw = peaks ? (Number(peaks[cfg.field]) || 0) : 0;
              var pk = peaks && peaks[cfg.field.replace('_watts', '_wkg')] != null
                ? Math.round(Number(peaks[cfg.field.replace('_watts', '_wkg')]) * 100) / 100
                : (userW > 0 && pw > 0 ? Math.round((pw / userW) * 100) / 100 : 0);
              var dateStr = null;
              for (var li = 0; li < logsYear.length; li++) {
                var log = logsYear[li];
                if ((Number(log[cfg.field]) || 0) === pw) {
                  var ds = parseDate(log.date);
                  if (ds) {
                    var parts = ds.split('-');
                    dateStr = (parts[1] && parts[2]) ? parseInt(parts[1], 10) + '/' + parseInt(parts[2], 10) : null;
                  }
                  break;
                }
              }
              return { label: cfg.label, watts: pw, wkg: pk > 0 ? pk : null, dateStr: dateStr || null };
            });
            if (isMounted) setYearlyPowerPrData(prRows);
          })();

          retryLogsRef.current = loadRecentLogs;
        } catch (e) {
          console.error('[Dashboard] Logs load error:', e);
          if (isMounted) {
            setLogsLoadError((e && e.message) || '훈련 로그 로드 실패');
            setLogsLoaded(true);
            setRecentLogs([]);
            setWeeklyTssTrendData([]);
            setRunLeaderboardCoachReady(true);
          }
        } finally {
          if (isMounted) setLogsLoading(false);
        }
      }

      loadRecentLogs();

      return function() {
        isMounted = false;
        retryLogsRef.current = null;
      };
    }, [userProfile]);

    // --- AI Coach Analysis ---
    useEffect(function coachAnalysisEffect() {
      var runRecentLogs = (recentLogs || []).filter(isRunLogForWeeklyTss);
      var hasHexagonData = !!(hexagonCoachContext && hexagonCoachContext.hexagon);
      if (!userProfile || !logsLoaded || logsLoading || !runLeaderboardCoachReady) {
        if (logsLoaded && !logsLoading && runLeaderboardCoachReady) setAiLoading(false);
        return;
      }
      if (!runRecentLogs.length && !hasHexagonData) {
        if (logsLoaded && !logsLoading) setAiLoading(false);
        return;
      }
      if (logsLoadError) {
        setCoachData({
          condition_score: 50,
          training_status: '기초 강화',
          vo2max_estimate: 40,
          coach_comment: (userProfile.name || '사용자') + '님, 훈련 데이터를 불러오지 못했습니다.',
          recommended_workout: 'Recovery Jog (Z1)',
          error_reason: logsLoadError
        });
        setAiLoading(false);
        setRunConditionAnalysis(false);
        return;
      }

      var ctx = buildCoachContextForCoachAnalysis(recentLogs);
      var today = ctx.today;
      var todayStr = ctx.todayStr;
      var logsToSend = ctx.logsToSend;
      var last7Rtss = ctx.last7Rtss;
      var logsSignature = ctx.logsSignature;

      /* 캐시: 오늘 이미 분석한 결과가 있으면 재구동 시에도 표시. API 자동 호출은 수동 분석 클릭 시에만 */
      if (!runConditionAnalysis && retryCoach === 0) {
        if (
          lastCoachTriggerKeyRef.current === coachAnalysisTriggerKey &&
          coachDataRef.current &&
          coachDataRef.current.sport_category === 'run'
        ) {
          return;
        }
        var cached = null;
        if (typeof window.getDashboardCoachCache === 'function') {
          cached = window.getDashboardCoachCache(userProfile.id, todayStr, logsSignature);
        }
        if ((!cached || cached.condition_score == null || cached.error_reason) &&
            typeof window.getDashboardCoachDailyCache === 'function') {
          cached = window.getDashboardCoachDailyCache(userProfile.id, todayStr);
        }
        lastCoachTriggerKeyRef.current = coachAnalysisTriggerKey;
        if (cached && isAcceptableRunCoachCache(cached)) {
          setCoachData(normalizeRunCoachAnalysis(cached));
          setAiLoading(false);
          return;
        }
        setAiLoading(false);
        return;
      }
      if (aiAnalysisInProgressRef.current) return;

      aiAnalysisInProgressRef.current = true;
      setAiLoading(true);
      setStreamingComment(null);

      (async function() {
        var cleanLogs = [];
        if (typeof window.buildRunCoachCleanLogs === 'function') {
          cleanLogs = window.buildRunCoachCleanLogs(logsToSend);
        } else {
          cleanLogs = logsToSend.slice();
        }
        if (typeof window.dedupeLogsForConditionScore === 'function') {
          cleanLogs = window.dedupeLogsForConditionScore(cleanLogs);
        }
        cleanLogs = cleanLogs.filter(isRunLogForWeeklyTss);
        var currentStats = statsRef.current || stats || {};
        var last7RtssForCoach = last7Rtss;
        if (currentStats && typeof currentStats.weeklyRtssProgress === 'number') {
          last7RtssForCoach = Math.round(currentStats.weeklyRtssProgress);
        }
        try {
          var userProfileForCoach = Object.assign({}, userProfile, {
            sport_category: 'RUN',
            category: 'RUN',
            threshold_pace: currentStats.thresholdPaceValue || currentStats.thresholdPaceDisplay || null,
            threshold_pace_sec: currentStats.thresholdPaceSec != null ? currentStats.thresholdPaceSec : null,
            vo2max_estimate: currentStats.vo2maxEstimate != null ? currentStats.vo2maxEstimate : null,
            weight: userProfile.weight || currentStats.weight || 0
          });
          var callCoachFn =
            typeof window.callRunGeminiCoach === 'function'
              ? window.callRunGeminiCoach
              : (typeof window.callGeminiCoach === 'function' ? window.callGeminiCoach : null);
          if (!callCoachFn) {
            setCoachData({
              condition_score: 50,
              training_status: '기초 강화',
              vo2max_estimate: 40,
              coach_comment: 'AI 분석 함수를 불러올 수 없습니다.',
              recommended_workout: 'Recovery Jog (Z1)',
              error_reason: 'callRunGeminiCoach 함수 없음',
              sport_category: 'run'
            });
            setAiLoading(false);
            aiAnalysisInProgressRef.current = false;
            setRunConditionAnalysis(false);
            return;
          }

          var quotaCooldownSec =
            typeof window.getGeminiQuotaCooldownRemainingSec === 'function'
              ? window.getGeminiQuotaCooldownRemainingSec()
              : 0;
          var analysis = await callCoachFn(userProfileForCoach, cleanLogs, last7RtssForCoach, {
            timeoutMs: 120000,
            maxRetries: 2,
            useStreaming: quotaCooldownSec <= 0,
            forceApi: retryCoach > 0,
            sportCategory: 'run',
            hexagonContext: hexagonCoachContext,
            weeklyRtssGoal: currentStats.weeklyRtssGoal,
            thresholdPaceDisplay: currentStats.thresholdPaceDisplay,
            onChunk: function(delta, fullText) {
              try {
                var match = fullText.match(/"coach_comment"\s*:\s*"((?:[^"\\]|\\.)*)/);
                if (match && match[1]) {
                  var partial = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                  if (partial.length > 5) setStreamingComment(partial);
                }
              } catch (e) {}
            }
          });

          if (analysis && typeof window.computeConditionScore === 'function' && !analysis.sport_category) {
            try {
              var userForScore = {
                age: userProfile.age,
                gender: userProfile.gender,
                challenge: (typeof window.resolveChallengeForSport === 'function')
                  ? window.resolveChallengeForSport(userProfile, 'run')
                  : userProfile.challenge,
                ftp: userProfile.ftp,
                weight: userProfile.weight,
                sportCategory: 'run',
                category: 'RUN'
              };
              var logsForScore = cleanLogs.length ? cleanLogs.slice() : logsToSend.slice();
              var deduped = typeof window.dedupeLogsForConditionScore === 'function' ? window.dedupeLogsForConditionScore(logsForScore) : logsForScore;
              var csResult = window.computeConditionScore(userForScore, deduped, todayStr);
              analysis.condition_score = Math.max(50, Math.min(100, csResult.score));
            } catch (e) {}
          }

          if (analysis && typeof window.pickDeterministicRunRecommendedWorkout === 'function') {
            analysis = normalizeRunCoachAnalysis(analysis);
          }

          setCoachData(analysis);
          setStreamingComment(null);
          lastCoachTriggerKeyRef.current = coachAnalysisTriggerKey;
          if (analysis && !analysis.error_reason) {
            var normalizedAnalysis = normalizeRunCoachAnalysis(analysis);
            if (typeof window.setDashboardCoachCache === 'function') {
              window.setDashboardCoachCache(userProfile.id, todayStr, logsSignature, normalizedAnalysis);
            } else if (typeof window.setDashboardCoachDailyCache === 'function') {
              window.setDashboardCoachDailyCache(userProfile.id, todayStr, normalizedAnalysis);
            }
          }
        } catch (e) {
          console.error('[Dashboard] AI analysis error:', e);
          setCoachData(normalizeRunCoachAnalysis({
            condition_score: 50,
            training_status: '기초 강화',
            vo2max_estimate: stats.vo2maxEstimate != null ? stats.vo2maxEstimate : 40,
            coach_comment: (userProfile.name || '사용자') + '님, AI 분석 중 오류가 발생했습니다.',
            recommended_workout: 'Recovery Jog (Z1)',
            error_reason: (e && e.message) || '분석 실패',
            sport_category: 'run'
          }));
        } finally {
          setAiLoading(false);
          aiAnalysisInProgressRef.current = false;
          setRunConditionAnalysis(false);
          setRetryCoach(0);
        }
      })();
    }, [coachAnalysisTriggerKey, runConditionAnalysis, retryCoach, userProfile && userProfile.id, runLeaderboardCoachReady]);

    return {
      userProfile,
      setUserProfile,
      stats,
      setStats,
      recentLogs,
      logsLoaded,
      logsLoading,
      logsLoadError,
      loading,
      coachData,
      runConditionAnalysis,
      setRunConditionAnalysis,
      retryCoach,
      setRetryCoach,
      aiLoading,
      streamingComment,
      fitnessData,
      vo2TrendData,
      weeklyTssTrendData,
      growthTrendData,
      yearlyPowerPrData,
      stravaStatus,
      tpCalcLoading: ftpCalcLoading,
      setTpCalcLoading: setFtpCalcLoading,
      tpModalOpen: ftpModalOpen,
      setTpModalOpen: setFtpModalOpen,
      tpCalcResult: ftpCalcResult,
      setTpCalcResult: setFtpCalcResult,
      retryLogsRef,
      hexagonCoachContext
    };
  }

  window.useRunDashboardData = useRunDashboardData;
})();
