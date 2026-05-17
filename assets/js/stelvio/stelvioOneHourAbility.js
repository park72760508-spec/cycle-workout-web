/**
 * 대시보드 「나의 1시간 항속 능력」과 랭킹보드 항속 탭 공용 산출 (단일 소스).
 */
(function (global) {
  'use strict';

  function getSeoulYmdFromUnknown(dateLike) {
    if (!dateLike) return '';
    try {
      var d = null;
      if (dateLike && typeof dateLike.toDate === 'function') d = dateLike.toDate();
      else if (dateLike instanceof Date) d = dateLike;
      else if (typeof dateLike === 'string') {
        var s = String(dateLike).trim();
        var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) {
          return m[1] + '-' + String(Number(m[2])).padStart(2, '0') + '-' + String(Number(m[3])).padStart(2, '0');
        }
        d = new Date(s);
      }
      if (!d || isNaN(d.getTime())) return '';
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(d);
      var y = '';
      var mo = '';
      var da = '';
      parts.forEach(function (p) {
        if (p.type === 'year') y = p.value;
        if (p.type === 'month') mo = p.value;
        if (p.type === 'day') da = p.value;
      });
      return y && mo && da ? y + '-' + mo + '-' + da : '';
    } catch (e) {
      return '';
    }
  }

  function getSeoulTodayYmd() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (e) {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
  }

  function shiftYmd(ymd, deltaDays) {
    var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setDate(d.getDate() + Number(deltaDays || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function parseTrainingLogDate(log) {
    return getSeoulYmdFromUnknown(log && log.date);
  }

  /** useRiderAnalysis.dedupeTrainingLogsByDateStravaFirst 와 동일 */
  function dedupeTrainingLogsByDateStravaFirst(logs) {
    if (!logs || !logs.length) return [];
    var byDate = new Map();
    logs.forEach(function (log) {
      var ds = parseTrainingLogDate(log);
      if (!ds) return;
      if (!byDate.has(ds)) byDate.set(ds, []);
      byDate.get(ds).push(log);
    });
    var out = [];
    byDate.forEach(function (arr) {
      var strava = arr.filter(function (l) {
        return String(l.source || '').toLowerCase() === 'strava';
      });
      var chosen =
        strava.length > 0
          ? strava
          : arr.filter(function (l) {
              return String(l.source || '').toLowerCase() !== 'strava';
            });
      chosen.forEach(function (l) {
        out.push(l);
      });
    });
    return out;
  }

  /** rankingDayRollup PEAK_POWER_LIMITS["60min"] 와 동일 */
  var PEAK_60MIN_LIMIT_WKG = 5.8;
  var PEAK_60MIN_LIMIT_WATTS = 450;
  var MIN_60MIN_FALLBACK_RIDE_SEC = 50 * 60;
  var MAX_60MIN_FALLBACK_RIDE_SEC = 8 * 3600;

  function weightKgForPeakValidation(weightKg) {
    var w = Number(weightKg) || 0;
    return w > 0 ? Math.max(w, 45) : 70;
  }

  function validatePeak60minWatts(watts, weightKg) {
    var w = Number(watts) || 0;
    if (!(w > 0)) return false;
    var wkg = weightKgForPeakValidation(weightKg);
    if (w / wkg > PEAK_60MIN_LIMIT_WKG) return false;
    if (w > PEAK_60MIN_LIMIT_WATTS) return false;
    return true;
  }

  /** duration_sec 우선; 분 단위·ms 오입력 일부 보정 */
  function normalizeTrainingLogDurationSec(log) {
    var raw =
      log && log.duration_sec != null
        ? log.duration_sec
        : log && log.time != null
          ? log.time
          : log && log.duration != null
            ? log.duration
            : 0;
    var sec = Number(raw) || 0;
    if (!(sec > 0)) return 0;
    if (sec > 86400 * 2) sec = Math.round(sec / 1000);
    if (sec > 0 && sec < 600) {
      var km = Number(log && log.distance_km) || 0;
      if (km >= 8 && sec <= 360) sec = sec * 60;
    }
    return sec;
  }

  /** 동일 로그의 짧은 구간 MMP 대비 60분 후보 상한 (비정상 avg·NP 방지) */
  function maxPlausible60minFromSiblingPeaks(log) {
    var m40 = Number(log && log.max_40min_watts) || 0;
    var m20 = Number(log && log.max_20min_watts) || 0;
    var m10 = Number(log && log.max_10min_watts) || 0;
    var cap = 0;
    if (m40 > 0) cap = m40;
    else if (m20 > 0) cap = m20 * 1.06;
    else if (m10 > 0) cap = m10 * 1.12;
    return cap > 0 ? Math.round(cap * 1.12 * 10) / 10 : 0;
  }

  function effective60minWattsFromLog(log, opts) {
    opts = opts || {};
    var weightKg =
      Number(opts.weightKg) ||
      Number(log && log.weight) ||
      Number(log && log.weightKg) ||
      0;
    var w60 = Number(log && log.max_60min_watts != null ? log.max_60min_watts : 0) || 0;
    if (opts.rankingStrict) {
      return w60 > 0 && validatePeak60minWatts(w60, weightKg) ? w60 : 0;
    }
    if (w60 > 0 && !validatePeak60minWatts(w60, weightKg)) w60 = 0;
    if (!(w60 > 0)) {
      var sec = normalizeTrainingLogDurationSec(log);
      if (sec >= MIN_60MIN_FALLBACK_RIDE_SEC && sec <= MAX_60MIN_FALLBACK_RIDE_SEC) {
        w60 = Number(log && log.avg_watts != null ? log.avg_watts : 0) || 0;
      }
    }
    if (!(w60 > 0)) return 0;
    if (!validatePeak60minWatts(w60, weightKg)) return 0;
    var sibCap = maxPlausible60minFromSiblingPeaks(log);
    if (sibCap > 0 && w60 > sibCap) return 0;
    return w60;
  }

  function calculateSpeedOnFlatFallback(power, weight) {
    var P = Number(power);
    var m = Number(weight);
    if (!isFinite(P) || P <= 0 || !isFinite(m) || m <= 0) return 0;
    var rho = 1.225;
    var g = 9.81;
    var crr = 0.0045;
    var cda = 0.328 + (m - 70) * 0.0012;
    if (cda < 0.22) cda = 0.22;
    if (cda > 0.42) cda = 0.42;
    function powerAt(vMs) {
      return 0.5 * rho * cda * vMs * vMs * vMs + crr * m * g * vMs;
    }
    var lo = 0.1;
    var hi = 40;
    for (var i = 0; i < 55; i++) {
      var mid = (lo + hi) / 2;
      if (powerAt(mid) < P) lo = mid;
      else hi = mid;
    }
    return ((lo + hi) / 2) * 3.6;
  }

  /**
   * @param {Array} logs
   * @param {{ ftp?: number, weight?: number, rankingStrict?: boolean }} profile
   */
  function computeOneHourAbilityFromLogs(logs, profile) {
    profile = profile || {};
    var rankingStrict = profile.rankingStrict === true;
    var todayYmd = getSeoulTodayYmd();
    var start6mYmd = shiftYmd(todayYmd, -182);
    var ftpVal = Number(profile.ftp) || 0;
    var weightVal = Number(profile.weight) || 0;
    var deduped = dedupeTrainingLogsByDateStravaFirst(Array.isArray(logs) ? logs : []);
    var last6mPeak60Watts = 0;
    var last6mPeakDate = '';
    var logOpts = rankingStrict
      ? { rankingStrict: true, weightKg: weightVal }
      : { weightKg: weightVal };
    deduped.forEach(function (log) {
      var ymd = getSeoulYmdFromUnknown(log && log.date);
      if (!ymd || ymd < start6mYmd || ymd > todayYmd) return;
      var w60 = effective60minWattsFromLog(log, logOpts);
      if (w60 > last6mPeak60Watts) {
        last6mPeak60Watts = w60;
        last6mPeakDate = ymd;
      }
    });
    var useFallbackFtp93 = !rankingStrict && !(last6mPeak60Watts > 0) && ftpVal > 0;
    var referenceWattsRaw =
      last6mPeak60Watts > 0 ? last6mPeak60Watts : useFallbackFtp93 ? ftpVal * 0.93 : 0;
    var referenceWatts = referenceWattsRaw > 0 ? Math.round(referenceWattsRaw * 10) / 10 : 0;
    var calcSpeed =
      typeof global.calculateSpeedOnFlat === 'function'
        ? global.calculateSpeedOnFlat
        : calculateSpeedOnFlatFallback;
    var soloSpeedRaw =
      calcSpeed && referenceWatts > 0 && weightVal > 0
        ? Number(calcSpeed(referenceWatts, weightVal))
        : 0;
    var soloSpeed = soloSpeedRaw > 0 ? Math.round(soloSpeedRaw * 10) / 10 : 0;
    return {
      speedKmh: soloSpeed,
      referenceWatts: referenceWatts,
      weightKg: weightVal,
      peak60minWatts: last6mPeak60Watts > 0 ? Math.round(last6mPeak60Watts * 10) / 10 : 0,
      peak60Ymd: last6mPeakDate,
      start6mYmd: start6mYmd,
      end6mYmd: todayYmd
    };
  }

  function resolveProfileForOneHourAbility(uid) {
    var ftp = 0;
    var weight = 0;
    var name = '';
    try {
      var cu = global.currentUser;
      if (cu && String(cu.id) === String(uid)) {
        name = cu.name || '';
        ftp = Number(cu.ftp != null ? cu.ftp : cu.ftp_watts != null ? cu.ftp_watts : 0) || 0;
        weight =
          Number(
            cu.weight != null ? cu.weight : cu.weightKg != null ? cu.weightKg : cu.weight_kg
          ) || 0;
      }
    } catch (eCu) {}
    return { ftp: ftp, weight: weight, name: name };
  }

  async function fetchTrainingLogsForUser(uid, limit) {
    limit = limit || 400;
    var raw = [];
    if (typeof global.getUserTrainingLogs === 'function' && global.firestoreV9) {
      try {
        raw = await global.getUserTrainingLogs(uid, { limit: limit });
        if (Array.isArray(raw)) return raw;
      } catch (e) {}
    }
    if (global.firestore) {
      try {
        var snap = await global.firestore
          .collection('users')
          .doc(uid)
          .collection('logs')
          .orderBy('date', 'desc')
          .limit(limit)
          .get();
        snap.docs.forEach(function (doc) {
          var dd = doc.data() || {};
          var o = { id: doc.id };
          Object.keys(dd).forEach(function (k) {
            o[k] = dd[k];
          });
          raw.push(o);
        });
      } catch (e2) {}
    }
    return raw;
  }

  function removeUidFromPersonalSpeedBoard(data, uid) {
    if (!data || !uid) return;
    var cats = ['Supremo', 'Bianco', 'Rosa', 'Infinito', 'Leggenda', 'Assoluto'];
    cats.forEach(function (cat) {
      var arr = data.byCategory && data.byCategory[cat];
      if (!Array.isArray(arr)) return;
      data.byCategory[cat] = arr.filter(function (e) {
        return !e || String(e.userId) !== String(uid);
      });
    });
    if (Array.isArray(data.entries)) {
      data.entries = data.entries.filter(function (e) {
        return !e || String(e.userId) !== String(uid);
      });
    }
    if (data.currentUser && String(data.currentUser.userId) === String(uid)) data.currentUser = null;
    if (data.myRankSupremo && String(data.myRankSupremo.userId) === String(uid)) data.myRankSupremo = null;
  }

  function patchRankingEntrySpeed(entry, metrics, profile) {
    if (!entry || !metrics || !(metrics.speedKmh > 0)) return entry;
    entry.speedKmh = metrics.speedKmh;
    entry.referenceWatts = metrics.referenceWatts;
    entry.weightKg = metrics.weightKg;
    if (metrics.peak60minWatts > 0) entry.peak60minWatts = metrics.peak60minWatts;
    if (!entry.name && profile.name) entry.name = profile.name;
    return entry;
  }

  /**
   * 항속 보드에서 60분 파워 없이 speed만 있는 행 제거(FTP 폴백 잔여·구 캐시 방어).
   */
  function filterPersonalSpeedBoardExcludeNonLog60(data) {
    if (!data || !data.byCategory) return data;
    var cats = ['Supremo', 'Bianco', 'Rosa', 'Infinito', 'Leggenda', 'Assoluto'];
    function keepRow(e) {
      if (!e) return false;
      if (Number(e.peak60minWatts) > 0) return true;
      return !(Number(e.speedKmh) > 0);
    }
    function rerank(arr) {
      if (!Array.isArray(arr)) return arr;
      var kept = arr.filter(keepRow);
      kept.sort(function (a, b) {
        return (Number(b.speedKmh) || 0) - (Number(a.speedKmh) || 0);
      });
      return kept.map(function (row, idx) {
        var o = row;
        o.rank = idx + 1;
        return o;
      });
    }
    cats.forEach(function (cat) {
      if (Array.isArray(data.byCategory[cat])) {
        data.byCategory[cat] = rerank(data.byCategory[cat]);
      }
    });
    if (Array.isArray(data.entries)) {
      data.entries = rerank(data.entries);
    }
    return data;
  }

  /** FTP×93% 폴백만 있고 로그 기반 60분 피크가 없는 경우 */
  function isPersonalSpeedFtpOnlyMetrics(metrics, profile) {
    if (!metrics || Number(metrics.peak60minWatts) > 0) return false;
    var ftp = Number(profile && profile.ftp) || 0;
    if (!(ftp > 0) || !(Number(metrics.referenceWatts) > 0)) return false;
    var ftp93 = Math.round(ftp * 0.93 * 10) / 10;
    return Math.abs(Number(metrics.referenceWatts) - ftp93) < 0.65;
  }

  /**
   * 랭킹 API 응답에서 본인(uid) 항속을 대시보드·맞춤필터 현실지표와 동일하게 맞춤.
   */
  async function alignPersonalSpeedRankingPayloadWithDashboard(data, uid) {
    data = filterPersonalSpeedBoardExcludeNonLog60(data);
    if (!data || !uid || !data.byCategory) return data;
    var profile = resolveProfileForOneHourAbility(uid);
    var logs = await fetchTrainingLogsForUser(uid, 400);
    var metrics = computeOneHourAbilityFromLogs(logs, {
      ftp: profile.ftp,
      weight: profile.weight,
      rankingStrict: false
    });
    if (isPersonalSpeedFtpOnlyMetrics(metrics, profile) || !(metrics.speedKmh > 0)) {
      removeUidFromPersonalSpeedBoard(data, uid);
      return data;
    }

    var cats = ['Supremo', 'Bianco', 'Rosa', 'Infinito', 'Leggenda', 'Assoluto'];
    cats.forEach(function (cat) {
      var arr = data.byCategory[cat];
      if (!Array.isArray(arr)) return;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && String(arr[i].userId) === String(uid)) {
          patchRankingEntrySpeed(arr[i], metrics, profile);
        }
      }
    });
    if (Array.isArray(data.entries)) {
      data.entries.forEach(function (e) {
        if (e && String(e.userId) === String(uid)) patchRankingEntrySpeed(e, metrics, profile);
      });
    }
    if (data.currentUser && String(data.currentUser.userId) === String(uid)) {
      patchRankingEntrySpeed(data.currentUser, metrics, profile);
    }
    if (data.myRankSupremo && String(data.myRankSupremo.userId) === String(uid)) {
      patchRankingEntrySpeed(data.myRankSupremo, metrics, profile);
    }
    data.dashboardSpeedAligned = true;
    data.startStr = metrics.start6mYmd;
    data.endStr = metrics.end6mYmd;
    return data;
  }

  /** 지원용: 6개월 로그에서 60분 후보 상위 N건(검증 전·후) */
  function debugList60minPeakCandidates(logs, profile, limit) {
    profile = profile || {};
    limit = limit || 8;
    var todayYmd = getSeoulTodayYmd();
    var start6mYmd = shiftYmd(todayYmd, -182);
    var weightVal = Number(profile.weight) || 0;
    var deduped = dedupeTrainingLogsByDateStravaFirst(Array.isArray(logs) ? logs : []);
    var rows = [];
    deduped.forEach(function (log) {
      var ymd = getSeoulYmdFromUnknown(log && log.date);
      if (!ymd || ymd < start6mYmd || ymd > todayYmd) return;
      var rawM60 = Number(log.max_60min_watts) || 0;
      var avg = Number(log.avg_watts) || 0;
      var np = Number(log.weighted_watts) || 0;
      var sec = normalizeTrainingLogDurationSec(log);
      var accepted = effective60minWattsFromLog(log, { weightKg: weightVal });
      var rejected = Math.max(rawM60, avg, np);
      if (!(rejected > 0)) return;
      rows.push({
        date: ymd,
        source: log.source || '',
        title: log.title || '',
        acceptedW: accepted,
        max_60min_watts: rawM60,
        avg_watts: avg,
        weighted_watts: np,
        duration_sec: sec,
        max_20min_watts: Number(log.max_20min_watts) || 0,
        max_40min_watts: Number(log.max_40min_watts) || 0
      });
    });
    rows.sort(function (a, b) {
      var ba = Math.max(b.max_60min_watts, b.avg_watts, b.weighted_watts);
      var aa = Math.max(a.max_60min_watts, a.avg_watts, a.weighted_watts);
      return ba - aa;
    });
    return rows.slice(0, limit);
  }

  global.stelvioComputeOneHourAbilityFromLogs = computeOneHourAbilityFromLogs;
  global.stelvioValidatePeak60minWatts = validatePeak60minWatts;
  global.stelvioEffective60minWattsFromLog = effective60minWattsFromLog;
  global.stelvioDebugList60minPeakCandidates = debugList60minPeakCandidates;
  global.stelvioDedupeTrainingLogsByDateStravaFirst = dedupeTrainingLogsByDateStravaFirst;
  global.stelvioAlignPersonalSpeedRankingWithDashboard = alignPersonalSpeedRankingPayloadWithDashboard;
  global.stelvioFilterPersonalSpeedBoardExcludeNonLog60 = filterPersonalSpeedBoardExcludeNonLog60;
})(typeof window !== 'undefined' ? window : globalThis);
