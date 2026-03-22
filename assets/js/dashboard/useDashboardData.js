/**
 * useDashboardData - Custom Hook for Performance Dashboard
 * 프로필, 훈련 로그, AI 분석, 차트 데이터를 통합 관리합니다.
 * @returns {Object} 데이터 상태 및 핸들러
 */
(function() {
  'use strict';

  if (typeof window === 'undefined') return;
  var React = window.React;
  if (!React || !React.useState || !React.useEffect || !React.useRef) {
    console.warn('[useDashboardData] React hooks not available');
    return;
  }

  var useState = React.useState;
  var useEffect = React.useEffect;
  var useRef = React.useRef;

  function useDashboardData() {
    var _useState = useState(null);
    var userProfile = _useState[0];
    var setUserProfile = _useState[1];

    var _useState2 = useState({
      ftp: 0,
      wkg: 0,
      weight: 0,
      totalPoints: 0,
      currentPoints: 0,
      weeklyGoal: 225,
      weeklyProgress: 0
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

    var retryLogsRef = useRef(null);
    var aiAnalysisInProgressRef = useRef(false);

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
        var weeklyTarget = 225;
        if (typeof window.getWeeklyTargetTSS === 'function') {
          var ti = window.getWeeklyTargetTSS(challenge);
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
          strava_last_sync: selectedUser.strava_last_sync
        });
        setStats({
          ftp: ftp,
          wkg: parseFloat(wkg),
          weight: weight,
          totalPoints: Number(selectedUser.acc_points || 0),
          currentPoints: Number(selectedUser.rem_points || 0),
          weeklyGoal: weeklyTarget,
          weeklyProgress: 0
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
            var wt = 225;
            if (typeof window.getWeeklyTargetTSS === 'function') {
              var tInfo = window.getWeeklyTargetTSS(ch);
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
              rem_points: d.rem_points || 0
            });
            setStats(function(prev) {
              var next = Object.assign({}, prev);
              next.ftp = f;
              next.wkg = parseFloat(wk);
              next.weight = w;
              next.totalPoints = Number(d.acc_points || 0);
              next.currentPoints = Number(d.rem_points || 0);
              next.weeklyGoal = wt;
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
        setUserProfile({ id: u.uid, name: u.displayName || '사용자', ftp: 0, weight: 0, grade: '2', acc_points: 0, rem_points: 0 });
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
      var sixMonthsAgo = new Date(today);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      var sixMonthsStr = sixMonthsAgo.getFullYear() + '-' + pad2(sixMonthsAgo.getMonth() + 1) + '-' + pad2(sixMonthsAgo.getDate());

      async function loadRecentLogs() {
        setLogsLoading(true);
        setLogsLoadError(null);
        try {
          var raw = [];
          if (typeof window.getUserTrainingLogs === 'function' && window.firestoreV9) {
            try {
              raw = await window.getUserTrainingLogs(userProfile.id, { limit: 400 });
              raw = Array.isArray(raw) ? raw : [];
            } catch (e) { raw = []; }
          }
          if (raw.length === 0 && window.firestore) {
            try {
              var snap = await window.firestore.collection('users').doc(userProfile.id).collection('logs').orderBy('date', 'desc').limit(200).get();
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
            return ds && ds >= sixtyDaysStr && ds <= todayStr;
          });
          logs.sort(function(a, b) {
            var da = parseDate(a.date) || '';
            var db = parseDate(b.date) || '';
            return db.localeCompare(da);
          });

          if (isMounted) {
            setRecentLogs(logs);
            setLogsLoaded(true);
          }

          var weeklyStart = new Date(today);
          weeklyStart.setDate(today.getDate() - 6);
          var weekStartStr = weeklyStart.getFullYear() + '-' + pad2(weeklyStart.getMonth() + 1) + '-' + pad2(weeklyStart.getDate());
          var logsInWeek = logs.filter(function(log) {
            var ds = parseDate(log.date);
            return ds && ds >= weekStartStr && ds <= todayStr;
          });
          var byDate = {};
          logsInWeek.forEach(function(log) {
            var ds = parseDate(log.date);
            if (!ds) return;
            if (!byDate[ds]) byDate[ds] = { strava: [], stelvio: [] };
            var src = String(log.source || '').toLowerCase();
            var tss = Number(log.tss) || 0;
            if (src === 'strava') byDate[ds].strava.push(tss); else byDate[ds].stelvio.push(tss);
          });
          var weeklyTss = 0;
          Object.keys(byDate).forEach(function(ds) {
            var day = byDate[ds];
            if (day.strava.length > 0) day.strava.forEach(function(t) { weeklyTss += t; });
            else if (day.stelvio.length > 0) day.stelvio.forEach(function(t) { weeklyTss += t; });
          });
          var weeklyTarget = 225;
          if (typeof window.getWeeklyTargetTSS === 'function') {
            var tInfo = window.getWeeklyTargetTSS(userProfile.challenge || 'Fitness');
            if (tInfo && tInfo.target != null) weeklyTarget = tInfo.target;
          }
          if (isMounted) {
            setStats(function(prev) {
              var next = Object.assign({}, prev);
              next.weeklyGoal = weeklyTarget;
              next.weeklyProgress = Math.min(Math.round(weeklyTss), 9999);
              return next;
            });
          }

          var byDateGrowth = {};
          raw.filter(function(log) {
            var ds = parseDate(log.date);
            return ds && ds >= sixMonthsStr && ds <= todayStr;
          }).forEach(function(log) {
            var ds = parseDate(log.date);
            if (!ds) return;
            if (!byDateGrowth[ds]) byDateGrowth[ds] = { max20minWatts: 0, maxHr20min: 0 };
            var w20 = Number(log.max_20min_watts) || 0;
            var h20 = Number(log.max_hr_20min) || 0;
            if (w20 > byDateGrowth[ds].max20minWatts) byDateGrowth[ds].max20minWatts = w20;
            if (h20 > byDateGrowth[ds].maxHr20min) byDateGrowth[ds].maxHr20min = h20;
          });
          var growthRows = [];
          for (var mOff = 5; mOff >= 0; mOff--) {
            var dMonth = new Date(today.getFullYear(), today.getMonth() - mOff, 1);
            var y = dMonth.getFullYear();
            var m = dMonth.getMonth() + 1;
            var startStr = y + '-' + pad2(m) + '-01';
            var endStr = y + '-' + pad2(m) + '-' + pad2(new Date(y, m, 0).getDate());
            if (mOff === 0) {
              var endD = new Date(today);
              var startD = new Date(endD);
              startD.setDate(endD.getDate() - 29);
              startStr = startD.getFullYear() + '-' + pad2(startD.getMonth() + 1) + '-' + pad2(startD.getDate());
              endStr = endD.getFullYear() + '-' + pad2(endD.getMonth() + 1) + '-' + pad2(endD.getDate());
            }
            var monthMaxWatts = 0, monthMaxHr = 0;
            Object.keys(byDateGrowth).forEach(function(ds) {
              if (ds < startStr || ds > endStr) return;
              var d = byDateGrowth[ds];
              if (d.max20minWatts > monthMaxWatts) monthMaxWatts = d.max20minWatts;
              if (d.maxHr20min > monthMaxHr) monthMaxHr = d.maxHr20min;
            });
            var monthLabel = m + '월';
            if (mOff === 0) monthLabel = m + '월(현재)';
            growthRows.push({
              monthLabel: monthLabel,
              sortKey: y + '-' + pad2(m),
              max20minWatts: monthMaxWatts > 0 ? monthMaxWatts : null,
              maxHr20min: monthMaxHr > 0 ? monthMaxHr : null
            });
          }
          growthRows.sort(function(a, b) { return (a.sortKey || '').localeCompare(b.sortKey || ''); });
          if (isMounted) setGrowthTrendData(growthRows);

          var byDateChart = {};
          logs.forEach(function(log) {
            var ds = parseDate(log.date);
            if (!ds || ds < sixtyDaysStr || ds > todayStr) return;
            if (!byDateChart[ds]) byDateChart[ds] = { tss: 0 };
            byDateChart[ds].tss += Number(log.tss) || 0;
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

          var vo2Rows = [];
          for (var mOff = 5; mOff >= 0; mOff--) {
            var dMonth = new Date(today.getFullYear(), today.getMonth() - mOff, 1);
            var y = dMonth.getFullYear();
            var m = dMonth.getMonth() + 1;
            var startStr = y + '-' + pad2(m) + '-01';
            var endStr = y + '-' + pad2(m) + '-' + pad2(new Date(y, m, 0).getDate());
            if (mOff === 0) {
              var endD = new Date(today);
              var startD = new Date(endD);
              startD.setDate(endD.getDate() - 29);
              startStr = startD.getFullYear() + '-' + pad2(startD.getMonth() + 1) + '-' + pad2(startD.getDate());
              endStr = endD.getFullYear() + '-' + pad2(endD.getMonth() + 1) + '-' + pad2(endD.getDate());
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
                totalTss += Number(l.tss) || 0;
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
            vo2Rows.push({ monthLabel: m + '월' + (mOff === 0 ? '(현재)' : ''), vo2: vo2Val != null ? vo2Val : 0, sortKey: y + '-' + pad2(m) });
          }
          vo2Rows.sort(function(a, b) { return a.sortKey.localeCompare(b.sortKey); });
          if (isMounted) setVo2TrendData(vo2Rows);

          var currentYear = today.getFullYear();
          var yearStart = currentYear + '-01-01';
          var logsYear = raw.filter(function(log) {
            var ds = parseDate(log.date);
            return ds && ds >= yearStart && ds <= todayStr;
          });
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
      if (!userProfile || !logsLoaded || logsLoading || !recentLogs.length) {
        if (logsLoaded && !logsLoading) setAiLoading(false);
        return;
      }
      if (logsLoadError) {
        setCoachData({
          condition_score: 50,
          training_status: 'Building Base',
          vo2max_estimate: 40,
          coach_comment: (userProfile.name || '사용자') + '님, 훈련 데이터를 불러오지 못했습니다.',
          recommended_workout: 'Active Recovery (Z1)',
          error_reason: logsLoadError
        });
        setAiLoading(false);
        setRunConditionAnalysis(false);
        return;
      }
      if (coachData && !coachData.error_reason && !runConditionAnalysis) {
        setAiLoading(false);
        return;
      }
      if (aiAnalysisInProgressRef.current) return;

      aiAnalysisInProgressRef.current = true;
      setAiLoading(true);
      setStreamingComment(null);

      var today = new Date();
      var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      var thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 29);
      var thirtyStr = thirtyDaysAgo.getFullYear() + '-' + String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0') + '-' + String(thirtyDaysAgo.getDate()).padStart(2, '0');

      function parseDate(date) {
        if (!date) return null;
        var d = null;
        if (date.toDate && typeof date.toDate === 'function') d = date.toDate();
        else if (date instanceof Date) d = date;
        else if (typeof date === 'string') {
          var ds = (date.split('T')[0] || '').trim();
          d = /^\d{4}-\d{2}-\d{2}$/.test(ds) ? new Date(ds + 'T00:00:00') : new Date(date);
        }
        if (!d || isNaN(d.getTime())) return null;
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }

      var logsToSend = recentLogs.filter(function(log) {
        var ds = parseDate(log.date);
        return ds && ds >= thirtyStr && ds <= todayStr;
      }).sort(function(a, b) { return (parseDate(a.date) || '').localeCompare(parseDate(b.date) || ''); });

      var start7 = new Date(today);
      start7.setDate(today.getDate() - 6);
      var start7Str = start7.getFullYear() + '-' + String(start7.getMonth() + 1).padStart(2, '0') + '-' + String(start7.getDate()).padStart(2, '0');
      var byDate7 = {};
      logsToSend.forEach(function(log) {
        var ds = parseDate(log.date);
        if (!ds || ds < start7Str || ds > todayStr) return;
        if (!byDate7[ds]) byDate7[ds] = { strava: [], stelvio: [] };
        var src = String(log.source || '').toLowerCase();
        var tss = Number(log.tss) || 0;
        if (src === 'strava') byDate7[ds].strava.push(tss); else byDate7[ds].stelvio.push(tss);
      });
      var last7TSS = 0;
      Object.keys(byDate7).forEach(function(ds) {
        var day = byDate7[ds];
        if (day.strava.length > 0) day.strava.forEach(function(t) { last7TSS += t; });
        else if (day.stelvio.length > 0) day.stelvio.forEach(function(t) { last7TSS += t; });
      });
      last7TSS = Math.round(last7TSS);

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
                var sec = Number(log.duration_sec ?? log.time ?? log.duration ?? 0);
                if (sec < 60) return;
                fireLogs.push({
                  completed_at: ds + 'T12:00:00.000Z',
                  duration_min: Math.round(sec / 60),
                  duration_sec: sec,
                  avg_power: Math.round(log.avg_watts ?? log.avg_power ?? 0),
                  np: Math.round(log.weighted_watts ?? log.np ?? log.avg_watts ?? 0),
                  tss: Math.round(log.tss ?? 0),
                  avg_hr: log.avg_hr != null ? Math.round(Number(log.avg_hr)) : 0,
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
                  totalTss += Number(h.tss) || 0;
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
        try {
          if (typeof window.callGeminiCoach !== 'function') {
            setCoachData({
              condition_score: 50,
              training_status: 'Building Base',
              vo2max_estimate: 40,
              coach_comment: 'AI 분석 함수를 불러올 수 없습니다.',
              recommended_workout: 'Active Recovery (Z1)',
              error_reason: 'callGeminiCoach 함수 없음'
            });
            setAiLoading(false);
            aiAnalysisInProgressRef.current = false;
            setRunConditionAnalysis(false);
            return;
          }

          var analysis = await window.callGeminiCoach(userProfile, cleanLogs, last7TSS, {
            timeoutMs: 120000,
            maxRetries: 5,
            useStreaming: true,
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

          if (analysis && typeof window.computeConditionScore === 'function') {
            try {
              var userForScore = { age: userProfile.age, gender: userProfile.gender, challenge: userProfile.challenge, ftp: userProfile.ftp, weight: userProfile.weight };
              var logsForScore = cleanLogs.length ? cleanLogs.slice() : logsToSend.slice();
              var deduped = typeof window.dedupeLogsForConditionScore === 'function' ? window.dedupeLogsForConditionScore(logsForScore) : logsForScore;
              var csResult = window.computeConditionScore(userForScore, deduped, todayStr);
              analysis.condition_score = Math.max(50, Math.min(100, csResult.score));
            } catch (e) {}
          }

          setCoachData(analysis);
          setStreamingComment(null);
        } catch (e) {
          console.error('[Dashboard] AI analysis error:', e);
          setCoachData({
            condition_score: 50,
            training_status: 'Building Base',
            vo2max_estimate: 40,
            coach_comment: (userProfile.name || '사용자') + '님, AI 분석 중 오류가 발생했습니다.',
            recommended_workout: 'Active Recovery (Z1)',
            error_reason: (e && e.message) || '분석 실패'
          });
        } finally {
          setAiLoading(false);
          aiAnalysisInProgressRef.current = false;
          setRunConditionAnalysis(false);
        }
      })();
    }, [userProfile, logsLoaded, logsLoading, logsLoadError, recentLogs.length, runConditionAnalysis]);

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
      growthTrendData,
      yearlyPowerPrData,
      stravaStatus,
      ftpCalcLoading,
      setFtpCalcLoading,
      ftpModalOpen,
      setFtpModalOpen,
      ftpCalcResult,
      setFtpCalcResult,
      retryLogsRef
    };
  }

  window.useDashboardData = useDashboardData;
})();
