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
    var thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 29);
    var thirtyStr =
      thirtyDaysAgo.getFullYear() +
      '-' +
      String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(thirtyDaysAgo.getDate()).padStart(2, '0');
    var logsToSend = recentLogs
      .filter(function(log) {
        if (!isRunLogForWeeklyTss(log)) return false;
        var ds = parseDateForCoachAnalysis(log.date);
        return ds && ds >= thirtyStr && ds <= todayStr;
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
    next.thresholdPaceDisplay = info.display || null;
    next.thresholdPaceInferred = !!info.inferred;
    next.thresholdPaceInferredFrom = info.inferredFrom || null;
    next.thresholdPaceUnavailable = !!info.unavailable;
    next.thresholdPace = info.secPerKm != null ? Math.round(info.secPerKm) : 0;
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

  function useRunDashboardData() {
    var _useState = useState(null);
    var userProfile = _useState[0];
    var setUserProfile = _useState[1];

    var _useState2 = useState({
      thresholdPace: 0,
      thresholdPaceSec: null,
      thresholdPaceDisplay: null,
      thresholdPaceInferred: false,
      thresholdPaceInferredFrom: null,
      thresholdPaceUnavailable: true,
      weightKg: 0,
      weight: 0,
      totalPoints: 0,
      currentPoints: 0,
      weeklyRtssGoal: 175,
      weeklyRtssProgress: 0
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
        var challenge = selectedUser.challenge || 'Fitness';
        var weeklyTarget = 175;
        if (typeof window.getWeeklyTargetRtss === 'function') {
          var ti = window.getWeeklyTargetRtss(challenge);
          if (ti && ti.target != null) weeklyTarget = ti.target;
        }

        setUserProfile({
          id: userId,
          name: userName,
          ftp: ftp,
          weight: weight,
          grade: selectedUser.grade || '2',
          challenge: challenge,
          acc_points: selectedUser.acc_points || 0,
          rem_points: selectedUser.rem_points || 0,
          strava_refresh_token: selectedUser.strava_refresh_token,
          strava_last_sync: selectedUser.strava_last_sync,
          is_private: selectedUser.is_private === true
        });
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
            var ch = d.challenge || 'Fitness';
            var wt = 175;
            if (typeof window.getWeeklyTargetRtss === 'function') {
              var tInfo = window.getWeeklyTargetRtss(ch);
              if (tInfo && tInfo.target != null) wt = tInfo.target;
            }
            setUserProfile({
              id: userId,
              name: d.name || userName,
              ftp: f,
              weight: w,
              grade: d.grade || '2',
              challenge: ch,
              acc_points: d.acc_points || 0,
              rem_points: d.rem_points || 0,
              is_private: d.is_private === true
            });
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
          // Phase 6: getUserTrainingLogs → logsReadRouter(Supabase rides | Firestore logs)
          var raw = [];
          if (typeof window.getUserTrainingLogs === 'function') {
            try {
              raw = await window.getUserTrainingLogs(userProfile.id, { limit: 400 });
              raw = Array.isArray(raw) ? raw : [];
            } catch (e) { raw = []; }
          }
          if (raw.length === 0 && window.firestore && (!window.getLogsReadSourceSync || window.getLogsReadSourceSync() !== 'supabase')) {
            try {
              var snap = await window.firestore.collection('users').doc(userProfile.id).collection('logs').orderBy('date', 'desc').limit(400).get();
              snap.docs.forEach(function(doc) {
                var dd = doc.data();
                var o = { id: doc.id };
                if (dd) for (var k in dd) if (dd.hasOwnProperty(k)) o[k] = dd[k];
                raw.push(o);
              });
            } catch (e) { raw = []; }
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

          var logsDeduped = typeof window.dedupeTrainingLogsByDateStravaFirst === 'function'
            ? window.dedupeTrainingLogsByDateStravaFirst(logs)
            : logs;

          if (isMounted) {
            setRecentLogs(logsDeduped);
            setLogsLoaded(true);
          }

          var weeklyStart = new Date(today);
          weeklyStart.setDate(today.getDate() - 6);
          var weekStartStr = weeklyStart.getFullYear() + '-' + pad2(weeklyStart.getMonth() + 1) + '-' + pad2(weeklyStart.getDate());
          var logsInWeek = logsDeduped.filter(function(log) {
            var ds = parseDate(log.date);
            return ds && ds >= weekStartStr && ds <= todayStr && isRunLogForWeeklyTss(log);
          });
          var byDate = {};
          logsInWeek.forEach(function(log) {
            var ds = parseDate(log.date);
            if (!ds) return;
            if (!byDate[ds]) byDate[ds] = { strava: [], stelvio: [] };
            var src = String(log.source || '').toLowerCase();
            var tss = sanitizeRtss(log.tss);
            if (src === 'strava') byDate[ds].strava.push(tss); else byDate[ds].stelvio.push(tss);
          });
          var weeklyTss = 0;
          Object.keys(byDate).forEach(function(ds) {
            var day = byDate[ds];
            var stravaSum = day.strava.reduce(function(s, t) { return s + t; }, 0);
            var stelvioSum = day.stelvio.reduce(function(s, t) { return s + t; }, 0);
            weeklyTss += stravaSum > 0 ? stravaSum : stelvioSum;
          });
          weeklyTss = Math.round(weeklyTss * 10) / 10;
          var weeklyTarget = 175;
          if (typeof window.getWeeklyTargetRtss === 'function') {
            var tInfo = window.getWeeklyTargetRtss(userProfile.challenge || 'Fitness');
            if (tInfo && tInfo.target != null) weeklyTarget = tInfo.target;
          }
          var lbCoachCtx = await fetchRunCoachLeaderboardContext(userProfile.id);
          var paceInfo = (lbCoachCtx && lbCoachCtx.thresholdPace) || {};
          if (isMounted) {
            setStats(function(prev) {
              var next = Object.assign({}, prev);
              next.weeklyRtssGoal = weeklyTarget;
              next.weeklyRtssProgress = Math.min(Math.round(weeklyTss * 10) / 10, 9999);
              return applyThresholdPaceToStats(next, paceInfo);
            });
            setHexagonCoachContext(lbCoachCtx && lbCoachCtx.hexagonContext ? lbCoachCtx.hexagonContext : null);
            setRunLeaderboardCoachReady(true);
          }

          var GROWTH_SLOT_FIELDS = [
            { w: 'max_watts', h: 'max_hr' },
            { w: 'max_1min_watts', h: 'max_hr_1min' },
            { w: 'max_5min_watts', h: 'max_hr_5min' },
            { w: 'max_10min_watts', h: 'max_hr_10min' },
            { w: 'max_20min_watts', h: 'max_hr_20min' },
            { w: 'max_40min_watts', h: 'max_hr_40min' },
            { w: 'max_60min_watts', h: 'max_hr_60min' }
          ];
          function emptyGrowthDay() {
            return { w: [0, 0, 0, 0, 0, 0, 0], h: [0, 0, 0, 0, 0, 0, 0] };
          }
          var rawSixMonthsForGrowth = raw.filter(function(log) {
            var ds = parseDate(log.date);
            return ds && ds >= sixMonthsStr && ds <= todayStr;
          });
          var logsForGrowth = typeof window.dedupeTrainingLogsByDateStravaFirst === 'function'
            ? window.dedupeTrainingLogsByDateStravaFirst(rawSixMonthsForGrowth)
            : rawSixMonthsForGrowth;
          var byDateGrowth = {};
          logsForGrowth.forEach(function(log) {
            var ds = parseDate(log.date);
            if (!ds) return;
            if (!byDateGrowth[ds]) byDateGrowth[ds] = emptyGrowthDay();
            var d = byDateGrowth[ds];
            var si;
            for (si = 0; si < GROWTH_SLOT_FIELDS.length; si++) {
              var wf = GROWTH_SLOT_FIELDS[si].w;
              var hf = GROWTH_SLOT_FIELDS[si].h;
              var wv = Number(log[wf]) || 0;
              var hv = Number(log[hf]) || 0;
              if (wv > d.w[si]) d.w[si] = wv;
              if (hv > d.h[si]) d.h[si] = hv;
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
            var monthW = [0, 0, 0, 0, 0, 0, 0];
            var monthH = [0, 0, 0, 0, 0, 0, 0];
            Object.keys(byDateGrowth).forEach(function(ds) {
              if (ds < startStr || ds > endStr) return;
              var day = byDateGrowth[ds];
              var si2;
              for (si2 = 0; si2 < 7; si2++) {
                if (day.w[si2] > monthW[si2]) monthW[si2] = day.w[si2];
                if (day.h[si2] > monthH[si2]) monthH[si2] = day.h[si2];
              }
            });
            var monthLabel = m + '월';
            if (mOff === 0) monthLabel = m + '월(현재)';
            growthRows.push({
              monthLabel: monthLabel,
              sortKey: y + '-' + pad2(m),
              growthWattsSlots: monthW.map(function(v) { return v > 0 ? v : null; }),
              growthHrSlots: monthH.map(function(v) { return v > 0 ? v : null; }),
              max20minWatts: monthW[4] > 0 ? monthW[4] : null,
              maxHr20min: monthH[4] > 0 ? monthH[4] : null
            });
          }
          growthRows.sort(function(a, b) { return (a.sortKey || '').localeCompare(b.sortKey || ''); });
          if (isMounted) setGrowthTrendData(growthRows);

          var byDateChart = {};
          logsDeduped.forEach(function(log) {
            var ds = parseDate(log.date);
            if (!ds || ds < sixtyDaysStr || ds > todayStr) return;
            if (!byDateChart[ds]) byDateChart[ds] = { tss: 0 };
            byDateChart[ds].tss += sanitizeRtss(log.tss);
          });
          var xAxisDates = [];
          for (var i = 30; i >= 0; i -= 7) {
            var d = new Date(today);
            d.setDate(today.getDate() - i);
            d.setHours(0, 0, 0, 0);
            xAxisDates.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()));
          }
          if (xAxisDates[xAxisDates.length - 1] !== todayStr) xAxisDates.push(todayStr);
          var fitnessDecay = Math.pow(0.5, 1 / 42);
          var fatigueDecay = Math.pow(0.5, 1 / 7);
          function calcFF(targetStr) {
            var fit = 0, fat = 0;
            var sorted = Object.keys(byDateChart).sort().filter(function(d) { return d <= targetStr; });
            for (var idx = sorted.length - 1; idx >= 0; idx--) {
              var logStr = sorted[idx];
              var logDate = new Date(logStr + 'T00:00:00');
              var targetDate = new Date(targetStr + 'T00:00:00');
              var daysAgo = Math.floor((targetDate.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24));
              if (daysAgo < 0) continue;
              var tss = byDateChart[logStr].tss || 0;
              fit += tss * Math.pow(fitnessDecay, daysAgo);
              if (daysAgo <= 7) fat += tss * Math.pow(fatigueDecay, daysAgo);
            }
            return { fitness: Math.round(fit * 10) / 10, fatigue: Math.round(fat * 10) / 10 };
          }
          var chartData = xAxisDates.map(function(ds) {
            var res = calcFF(ds);
            var logD = new Date(ds + 'T00:00:00');
            var daysDiff = Math.floor((today.getTime() - logD.getTime()) / (1000 * 60 * 60 * 24));
            var label = daysDiff === 0 ? '오늘' : '-' + daysDiff + '일';
            return { date: label, fitness: res.fitness, fatigue: res.fatigue };
          });
          if (isMounted) setFitnessData(chartData);
          if (isMounted && userProfile && typeof window.persistFitnessDemographicSampleAsync === 'function') {
            window.persistFitnessDemographicSampleAsync(userProfile, chartData).catch(function() {});
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
              var totalSec = 0, totalTss = 0, sumNp = 0, sumHr = 0;
              chosen.forEach(function(l) {
                var sec = Number(l.duration_sec ?? l.time ?? l.duration ?? 0) || (Number(l.duration_min) || 0) * 60;
                totalSec += sec;
                totalTss += sanitizeRtss(l.tss);
                sumNp += (Number(l.weighted_watts ?? l.np ?? l.avg_watts ?? 0)) * sec;
                sumHr += (Number(l.avg_hr ?? 0)) * sec;
              });
              merged.push({
                date: dk,
                duration_sec: totalSec,
                tss: Math.round(totalTss),
                np: totalSec > 0 ? Math.round(sumNp / totalSec) : 0,
                avg_hr: totalSec > 0 ? Math.round(sumHr / totalSec) : 0
              });
            });
            var vo2Val = (typeof window.calculateStelvioVO2Max === 'function') ? window.calculateStelvioVO2Max(userProfile, merged) : null;
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

      /* 캐시: 같은 local 날짜 + 동일 logsSignature(로그/7일TSS/30일TSS)일 때만. 수동 재분석(runConditionAnalysis)은 스킵 */
      if (!runConditionAnalysis && retryCoach === 0 && typeof window.getDashboardCoachCache === 'function') {
        var cached = window.getDashboardCoachCache(userProfile.id, todayStr, logsSignature);
        if (cached && cached.condition_score != null && !cached.error_reason) {
          setCoachData(normalizeRunCoachAnalysis(cached));
          setAiLoading(false);
          return;
        }
      }
      if (aiAnalysisInProgressRef.current) return;

      aiAnalysisInProgressRef.current = true;
      setAiLoading(true);
      setStreamingComment(null);

      (async function() {
        var cleanLogs = [];
        if (typeof window.getTrainingLogsByDateRange === 'function') {
          try {
            var startForFetch = new Date(today);
            startForFetch.setDate(today.getDate() - 29);
            var startStr = startForFetch.getFullYear() + '-' + String(startForFetch.getMonth() + 1).padStart(2, '0') + '-' + String(startForFetch.getDate()).padStart(2, '0');
            var endStr = todayStr;
            var months = [];
            var dM = new Date(startForFetch.getFullYear(), startForFetch.getMonth(), 1);
            var endM = new Date(today.getFullYear(), today.getMonth(), 1);
            while (dM <= endM) {
              months.push({ year: dM.getFullYear(), month: dM.getMonth() });
              dM.setMonth(dM.getMonth() + 1);
            }
            var fireLogs = [];
            for (var mi = 0; mi < months.length; mi++) {
              var ym = months[mi];
              var ml = await window.getTrainingLogsByDateRange(userProfile.id, ym.year, ym.month);
              if (!Array.isArray(ml)) continue;
              ml.forEach(function(log) {
                var dv = log.date;
                var ds = null;
                if (dv && dv.toDate) ds = dv.toDate().toISOString().split('T')[0];
                else if (dv) ds = String(dv).slice(0, 10);
                if (!ds || ds < startStr || ds > endStr) return;
                if (!isRunLogForWeeklyTss(log)) return;
                var sec = Number(log.duration_sec ?? log.time ?? log.duration ?? 0);
                if (sec < 60) return;
                fireLogs.push({
                  completed_at: ds + 'T12:00:00.000Z',
                  date: ds,
                  duration_min: Math.round(sec / 60),
                  duration_sec: sec,
                  avg_power: Math.round(log.avg_watts ?? log.avg_power ?? 0),
                  np: Math.round(log.weighted_watts ?? log.np ?? log.avg_watts ?? 0),
                  tss: Math.round(log.tss ?? 0),
                  avg_hr: log.avg_hr != null ? Math.round(Number(log.avg_hr)) : 0,
                  activity_type: log.activity_type || log.sport_type || 'run',
                  source: (log.source || '').toLowerCase()
                });
              });
            }
            if (fireLogs.length > 0) {
              var byDateC = {};
              fireLogs.forEach(function(h) {
                var d = (h.completed_at || '').split('T')[0];
                if (!d) return;
                if (!byDateC[d]) byDateC[d] = [];
                byDateC[d].push(h);
              });
              var merged = [];
              Object.keys(byDateC).sort().forEach(function(dk) {
                var arr = byDateC[dk];
                var strava = arr.filter(function(h) { return h.source === 'strava'; });
                var chosen = strava.length > 0 ? strava : arr;
                if (chosen.length === 0) return;
                var totalMin = 0, totalTss = 0, sumNp = 0, sumAp = 0, sumHr = 0;
                chosen.forEach(function(h) {
                  var m = Number(h.duration_min) || 0;
                  totalMin += m;
                  totalTss += sanitizeRtss(h.tss);
                  sumNp += (Number(h.np) || 0) * m;
                  sumAp += (Number(h.avg_power) || 0) * m;
                  sumHr += (Number(h.avg_hr) || 0) * m;
                });
                merged.push({
                  completed_at: dk + 'T12:00:00.000Z',
                  duration_min: Math.round(totalMin),
                  duration_sec: totalMin * 60,
                  avg_power: totalMin > 0 ? Math.round(sumAp / totalMin) : 0,
                  np: totalMin > 0 ? Math.round(sumNp / totalMin) : 0,
                  tss: Math.round(totalTss),
                  avg_hr: totalMin > 0 ? Math.round(sumHr / totalMin) : 0,
                  source: chosen[0].source
                });
              });
              fireLogs = merged;
            }
            if (typeof window.dedupeLogsForConditionScore === 'function') {
              cleanLogs = window.dedupeLogsForConditionScore(fireLogs);
            } else {
              cleanLogs = fireLogs;
            }
          } catch (e) {
            console.warn('[AI] getTrainingLogsByDateRange failed:', e);
          }
        }
        if (cleanLogs.length === 0 && typeof window.sanitizeLogs === 'function') {
          cleanLogs = window.sanitizeLogs(logsToSend);
          if (typeof window.dedupeLogsForConditionScore === 'function') {
            cleanLogs = window.dedupeLogsForConditionScore(cleanLogs);
          }
        } else if (cleanLogs.length === 0) {
          cleanLogs = logsToSend;
        }
        cleanLogs = cleanLogs.filter(isRunLogForWeeklyTss);
        try {
          var userProfileForCoach = Object.assign({}, userProfile, {
            sport_category: 'RUN',
            category: 'RUN',
            threshold_pace: stats.thresholdPaceDisplay || null,
            threshold_pace_sec: stats.thresholdPaceSec != null ? stats.thresholdPaceSec : null,
            weight: userProfile.weight || stats.weight || 0
          });
          if (typeof window.callGeminiCoach !== 'function') {
            setCoachData({
              condition_score: 50,
              training_status: '기초 강화',
              vo2max_estimate: 40,
              coach_comment: 'AI 분석 함수를 불러올 수 없습니다.',
              recommended_workout: 'Recovery Jog (Z1)',
              error_reason: 'callGeminiCoach 함수 없음'
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
          var analysis = await window.callGeminiCoach(userProfileForCoach, cleanLogs, last7Rtss, {
            timeoutMs: 120000,
            maxRetries: 2,
            useStreaming: quotaCooldownSec <= 0,
            forceApi: retryCoach > 0,
            sportCategory: 'run',
            hexagonContext: hexagonCoachContext,
            weeklyRtssGoal: stats.weeklyRtssGoal,
            thresholdPaceDisplay: stats.thresholdPaceDisplay,
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
                challenge: userProfile.challenge,
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
          if (analysis && !analysis.error_reason && typeof window.setDashboardCoachCache === 'function') {
            window.setDashboardCoachCache(userProfile.id, todayStr, logsSignature, normalizeRunCoachAnalysis(analysis));
          }
        } catch (e) {
          console.error('[Dashboard] AI analysis error:', e);
          setCoachData({
            condition_score: 50,
            training_status: '기초 강화',
            vo2max_estimate: 40,
            coach_comment: (userProfile.name || '사용자') + '님, AI 분석 중 오류가 발생했습니다.',
            recommended_workout: 'Recovery Jog (Z1)',
            error_reason: (e && e.message) || '분석 실패'
          });
        } finally {
          setAiLoading(false);
          aiAnalysisInProgressRef.current = false;
          setRunConditionAnalysis(false);
          setRetryCoach(0);
        }
      })();
    }, [coachAnalysisTriggerKey, runConditionAnalysis, retryCoach, userProfile && userProfile.id, hexagonCoachContext, stats.thresholdPaceDisplay, stats.weeklyRtssGoal, runLeaderboardCoachReady]);

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
      retryLogsRef
    };
  }

  window.useRunDashboardData = useRunDashboardData;
})();
