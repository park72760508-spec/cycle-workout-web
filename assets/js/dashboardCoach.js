/* ==========================================================
   Dashboard AI Coach 모듈
   - Gemini API를 사용한 사용자 대시보드 분석
   - callGeminiCoach 함수 제공
========================================================== */

/**
 * Gemini API를 사용하여 사용자 코치 인사이트 생성
 * @param {Object} userProfile - 사용자 프로필 데이터
 * @param {Array} recentLogs - 최근 30일간의 훈련 로그
 * @param {number} [last7DaysTSSFromDashboard] - 대시보드 주간 목표 실적(최근 7일 TSS). 전달 시 코멘트에 이 값만 사용(화면과 일치)
 * @returns {Promise<Object>} AI 분석 결과 (condition_score, training_status, vo2max_estimate, coach_comment, recommended_workout)
 */
// 일별 훈련 로그 중 복수개 시 source: "strava" 1개만 분석 대상 (conditionScoreModule 미로드 시 폴백)
function oneLogPerDayPreferStravaForCoach(logs) {
  if (!logs || !logs.length) return [];
  function getDateStr(log) {
    var dateStr = '';
    if (log.completed_at) {
      var d = typeof log.completed_at === 'string' ? new Date(log.completed_at) : log.completed_at;
      dateStr = d && d.toISOString ? d.toISOString().split('T')[0] : String(log.completed_at).split('T')[0];
    } else if (log.date) {
      var d2 = log.date;
      if (d2 && typeof d2.toDate === 'function') d2 = d2.toDate();
      dateStr = d2 && d2.toISOString ? d2.toISOString().split('T')[0] : String(d2 || '').split('T')[0];
    }
    return dateStr;
  }
  var byDate = {};
  for (var i = 0; i < logs.length; i++) {
    var log = logs[i];
    var dateStr = getDateStr(log);
    if (!dateStr) continue;
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push(log);
  }
  var result = [];
  var dates = Object.keys(byDate).sort();
  for (var j = 0; j < dates.length; j++) {
    var arr = byDate[dates[j]];
    var stravaLogs = arr.filter(function (l) { return String(l.source || '').toLowerCase() === 'strava'; });
    result.push(stravaLogs.length > 0 ? stravaLogs[0] : arr[0]);
  }
  return result;
}

/**
 * conditionScore + TSS 부하율 + 최근 고강도 빈도를 기반으로
 * 워크아웃 카테고리를 결정론적으로 선결정합니다.
 * AI가 자유롭게 카테고리를 선택하지 못하도록 범위를 좁히는 역할.
 *
 * @param {number} conditionScore - 0~100
 * @param {number} last7DaysTSS  - 최근 7일 TSS 합계
 * @param {number} weeklyTSS     - 주간 평균 TSS (30일 기준)
 * @param {Array}  recentLogs    - 중복 제거된 훈련 로그
 * @returns {{ category: string, allowedWorkouts: string[], reason: string }}
 */
function determineDeterministicWorkoutCategory(conditionScore, last7DaysTSS, weeklyTSS, recentLogs) {
  // 최근 2일 내 고강도 훈련 횟수 (TSS 80 이상)
  var recentHighIntensityCount = 0;
  if (recentLogs && recentLogs.length > 0) {
    var now = new Date();
    var cutoffDates = [];
    for (var di = 1; di <= 2; di++) {
      var dd = new Date(now);
      dd.setDate(dd.getDate() - di);
      cutoffDates.push(
        dd.getFullYear() + '-' +
        String(dd.getMonth() + 1).padStart(2, '0') + '-' +
        String(dd.getDate()).padStart(2, '0')
      );
    }
    for (var li = 0; li < recentLogs.length; li++) {
      var log = recentLogs[li];
      var logDate = '';
      if (log.completed_at) logDate = String(log.completed_at).split('T')[0];
      else if (log.date) {
        var ld = log.date;
        if (ld && typeof ld.toDate === 'function') ld = ld.toDate();
        logDate = ld ? String(ld instanceof Date ? ld.toISOString() : ld).split('T')[0] : '';
      }
      if (cutoffDates.indexOf(logDate) !== -1 && (Number(log.tss) || 0) >= 80) {
        recentHighIntensityCount++;
      }
    }
  }

  // TSS 부하율: 최근 7일 / 주간 평균. 주간 평균이 0이면 1.0으로 처리
  var tssLoadRatio = (weeklyTSS > 0) ? (last7DaysTSS / weeklyTSS) : 1.0;

  // ── 규칙 기반 카테고리 결정 ──────────────────────────────────────
  // 회복 우선: 컨디션 낮거나 / 부하 과다 / 연속 고강도
  if (conditionScore < 62 || tssLoadRatio > 1.35 || recentHighIntensityCount >= 2) {
    return {
      category: 'recovery',
      allowedWorkouts: ['Active Recovery (Z1)', 'Easy Endurance (Z2)'],
      reason: '컨디션 점수(' + conditionScore + '점) 또는 최근 훈련 부하(7일 TSS ' + last7DaysTSS + '점)를 고려해 회복 훈련을 권장합니다.'
    };
  }
  // 지구력: 컨디션 보통 또는 부하가 약간 높음
  if (conditionScore < 73 || tssLoadRatio > 1.10) {
    return {
      category: 'endurance',
      allowedWorkouts: ['Endurance (Z2)', 'Sweet Spot (Low)', 'Tempo (Z3)'],
      reason: '중간 수준의 컨디션(' + conditionScore + '점)에 알맞은 지구력 훈련을 권장합니다.'
    };
  }
  // 고강도: 컨디션 우수 + 부하 여유 있음
  if (conditionScore >= 82 && tssLoadRatio <= 0.80) {
    return {
      category: 'high_intensity',
      allowedWorkouts: ['VO2 Max (Z5)', 'Threshold (Z4)', 'Anaerobic Capacity (Z6)'],
      reason: '컨디션이 우수(' + conditionScore + '점)하고 훈련 부하에 여유가 있어 고강도 훈련을 권장합니다.'
    };
  }
  // 템포: 그 외 (일반적인 상태)
  return {
    category: 'tempo',
    allowedWorkouts: ['Sweet Spot (Z3-Z4)', 'Threshold (Low, Z4)', 'Tempo Training (Z3)'],
    reason: '안정적인 컨디션(' + conditionScore + '점)으로 템포/스위트스팟 훈련이 적합합니다.'
  };
}

/**
 * RUN 전용 — 6축 헥사곤 페이스·rTSS·컨디션 기반 워크아웃 카테고리 선결정
 * @param {number} conditionScore
 * @param {number} last7DaysRtss
 * @param {number} weeklyRtss - 30일 평균 주간 rTSS
 * @param {{ hexagon?: object, missingAxes?: string[] }} hexagonContext
 * @param {Array} recentLogs
 * @param {number} [weeklyRtssGoal]
 */
function determineDeterministicRunWorkoutCategory(conditionScore, last7DaysRtss, weeklyRtss, hexagonContext, recentLogs, weeklyRtssGoal) {
  hexagonContext = hexagonContext || {};
  var guide = typeof window !== 'undefined' && window.RUN_TRAINING_ZONE_GUIDE;
  var analyzeGaps = guide && guide.analyzeRunHexagonGaps;
  var resolvePrescription = guide && guide.resolveRunHexagonPrescription;
  var buildIntegratedReason = guide && guide.buildIntegratedRunWorkoutReason;
  var logReasonVerification = guide && guide.logRunCoachReasonVerification;
  var categoryDefaults = (guide && guide.CATEGORY_DEFAULTS) || {};

  var gaps = analyzeGaps ? analyzeGaps(hexagonContext) : { missingLong: false, missingShort: false, missingMid: false, missingAxes: hexagonContext.missingAxes || [], missingCount: 0 };
  var missingCount = gaps.missingCount != null ? gaps.missingCount : (gaps.missingAxes ? gaps.missingAxes.length : 0);
  var hexagonSeverelyInactive = missingCount >= 4;

  var recentHighIntensityCount = 0;
  if (recentLogs && recentLogs.length > 0) {
    var now = new Date();
    var cutoffDates = [];
    for (var di = 1; di <= 2; di++) {
      var dd = new Date(now);
      dd.setDate(dd.getDate() - di);
      cutoffDates.push(
        dd.getFullYear() + '-' +
        String(dd.getMonth() + 1).padStart(2, '0') + '-' +
        String(dd.getDate()).padStart(2, '0')
      );
    }
    for (var li = 0; li < recentLogs.length; li++) {
      var log = recentLogs[li];
      var logDate = '';
      if (log.completed_at) logDate = String(log.completed_at).split('T')[0];
      else if (log.date) {
        var ld = log.date;
        if (ld && typeof ld.toDate === 'function') ld = ld.toDate();
        logDate = ld ? String(ld instanceof Date ? ld.toISOString() : ld).split('T')[0] : '';
      }
      if (cutoffDates.indexOf(logDate) !== -1 && (Number(log.tss) || 0) >= 80) {
        recentHighIntensityCount++;
      }
    }
  }

  var tssLoadRatio = weeklyRtss > 0 ? last7DaysRtss / weeklyRtss : 1.0;
  var baseCategory;
  var result;

  if (hexagonSeverelyInactive && conditionScore >= 62) {
    baseCategory = 'recovery';
    result = Object.assign({}, categoryDefaults.recovery || {
      category: 'recovery',
      primaryZone: 'Z1',
      allowedWorkouts: ['Recovery Jog (Z1)', 'Easy Run (Z2)'],
      reason: ''
    });
    result.hexagonOverride = 'profile_inactive';
  } else if (conditionScore < 62 || tssLoadRatio > 1.35 || recentHighIntensityCount >= 2) {
    baseCategory = 'recovery';
    result = Object.assign({}, categoryDefaults.recovery || {
      category: 'recovery',
      primaryZone: 'Z1',
      allowedWorkouts: ['Recovery Jog (Z1)', 'Easy Run (Z2)'],
      reason: '컨디션 점수(' + conditionScore + '점) 또는 최근 RUN 부하(7일 rTSS ' + last7DaysRtss + '점)를 고려해 Z1 회복 조깅을 권장합니다.'
    });
    result.reason = '컨디션 점수(' + conditionScore + '점) 또는 최근 RUN 부하(7일 rTSS ' + last7DaysRtss + '점)를 고려해 Z1 회복 조깅을 권장합니다.';
  } else if (conditionScore < 73 || tssLoadRatio > 1.10) {
    baseCategory = 'endurance';
    result = Object.assign({}, categoryDefaults.endurance || {
      category: 'endurance',
      primaryZone: 'Z2',
      allowedWorkouts: ['Easy Run (Z2)', 'Long Run (Z2)'],
      reason: '중간 수준의 컨디션(' + conditionScore + '점)에 알맞은 Z2 지구력 러닝을 권장합니다.'
    });
    result.reason = '중간 수준의 컨디션(' + conditionScore + '점)에 알맞은 Z2 지구력 러닝을 권장합니다.';
  } else if (conditionScore >= 82 && tssLoadRatio <= 0.80) {
    baseCategory = 'high_intensity';
    result = Object.assign({}, categoryDefaults.high_intensity || {
      category: 'high_intensity',
      primaryZone: 'Z4',
      allowedWorkouts: ['Threshold Intervals (Z4)', 'VO₂max Intervals (Z5)'],
      reason: '컨디션이 우수(' + conditionScore + '점)하고 rTSS 부하에 여유가 있어 Z4~Z5 고강도 러닝을 권장합니다.'
    });
    result.reason = '컨디션이 우수(' + conditionScore + '점)하고 rTSS 부하에 여유가 있어 Z4~Z5 고강도 러닝을 권장합니다.';
  } else {
    baseCategory = 'tempo';
    result = Object.assign({}, categoryDefaults.tempo || {
      category: 'tempo',
      primaryZone: 'Z3',
      allowedWorkouts: ['Steady Run (Z3)', 'Tempo Run (Z3)'],
      reason: '안정적인 컨디션(' + conditionScore + '점)으로 Z3 템포·역치 러닝이 적합합니다.'
    });
    result.reason = '안정적인 컨디션(' + conditionScore + '점)으로 Z3 템포·역치 러닝이 적합합니다.';
  }

  // 6축 헥사곤 공백 맞춤 처방 (결측 4+는 프로필 미활성화 진단으로 통합, 개별 처방 스킵)
  if (resolvePrescription && !hexagonSeverelyInactive) {
    var prescription = resolvePrescription(gaps, conditionScore, baseCategory);
    if (prescription) {
      result = Object.assign({}, result, prescription);
    }
  }

  if (buildIntegratedReason) {
    result.reason = buildIntegratedReason({
      hexagonContext: hexagonContext,
      last7DaysRtss: last7DaysRtss,
      weeklyRtssGoal: weeklyRtssGoal,
      baseReason: hexagonSeverelyInactive ? '' : result.reason,
      hexagonOverride: result.hexagonOverride,
      conditionScore: conditionScore
    });
  }

  if (!result.primaryZone && result.allowedWorkouts && result.allowedWorkouts.length) {
    var pz = typeof window.parseRunWorkoutZone === 'function'
      ? window.parseRunWorkoutZone(result.allowedWorkouts[0])
      : 'Z2';
    result.primaryZone = pz;
  }
  if (typeof window.finalizeRunWorkoutDecision === 'function') {
    result = window.finalizeRunWorkoutDecision(result);
  } else if (typeof window.pickDeterministicRunRecommendedWorkout === 'function') {
    result.recommendedWorkout = window.pickDeterministicRunRecommendedWorkout(result);
    result.training_zone = window.parseRunWorkoutZone
      ? window.parseRunWorkoutZone(result.recommendedWorkout)
      : result.primaryZone;
    result.primaryZone = result.training_zone;
  }

  if (logReasonVerification) {
    logReasonVerification(result, gaps);
  }
  return result;
}

function resolveCoachSportCategory(userProfile, opts) {
  opts = opts || {};
  if (opts.sportCategory === 'run' || opts.sportCategory === 'RUN') return 'run';
  if (opts.sportCategory === 'cycle' || opts.sportCategory === 'CYCLE') return 'cycle';
  var cat = userProfile && (userProfile.sport_category || userProfile.category);
  if (cat && String(cat).trim().toUpperCase() === 'RUN') return 'run';
  return 'cycle';
}

function trainingStatusFromRunWorkoutCategory(category) {
  var map = {
    recovery: '회복 필요',
    endurance: '기초 강화',
    tempo: '준비 완료',
    high_intensity: '최적'
  };
  return map[category] || '준비 완료';
}

/** AI recommended_workout → Zone 포함 표준 문자열 (예: "VO2 Max" → "VO2 Max (Z5)") */
function normalizeCoachRecommendedWorkout(aiValue, workoutDecision) {
  var raw = String(aiValue || '').trim();
  var isRunDecision = workoutDecision && (workoutDecision.training_zone || workoutDecision.primaryZone);
  if (!raw) raw = isRunDecision ? 'Recovery Jog (Z1)' : 'Active Recovery (Z1)';
  if (typeof window.stelvioParseCoachBasisRecommendedWorkout === 'function') {
    var parsed = window.stelvioParseCoachBasisRecommendedWorkout(raw);
    if (parsed.label) return parsed.label;
  }
  if (/\(Z[1-5]/i.test(raw)) return raw;
  var zone =
    typeof window.extractZoneTagFromCategoryOrText === 'function'
      ? window.extractZoneTagFromCategoryOrText(raw)
      : '';
  var allowed = (workoutDecision && workoutDecision.allowedWorkouts) || [];
  var i;
  for (i = 0; i < allowed.length; i++) {
    if (zone && allowed[i].indexOf(zone) >= 0) return allowed[i];
  }
  if (allowed.length > 0) return allowed[0];
  return raw;
}

/** RUN: AI 선택 무시, 규칙 엔진이 확정한 워크아웃만 사용 (동일 조건 → 동일 추천) */
function resolveRunRecommendedWorkout(workoutDecision, aiValue) {
  if (workoutDecision && workoutDecision.recommendedWorkout) {
    return workoutDecision.recommendedWorkout;
  }
  if (typeof window.pickDeterministicRunRecommendedWorkout === 'function') {
    return window.pickDeterministicRunRecommendedWorkout(workoutDecision);
  }
  return normalizeCoachRecommendedWorkout(aiValue, workoutDecision);
}

/** RUN 코치 응답에 규칙 엔진 메타데이터 부착 (팝업·캐시용) */
function attachCoachWorkoutMetadata(response, workoutDecision, isRun) {
  if (!response || !workoutDecision || !isRun) return response;
  response.workout_category = workoutDecision.category;
  response.workout_category_reason = workoutDecision.reason;
  response.training_zone = workoutDecision.training_zone || workoutDecision.primaryZone || null;
  response.hexagon_override = workoutDecision.hexagonOverride || null;
  response.recommended_workout = resolveRunRecommendedWorkout(workoutDecision, response.recommended_workout);
  response.sport_category = 'run';
  return response;
}

var STELVIO_GEMINI_QUOTA_LS_KEY = 'stelvio_gemini_quota_until';

function getGeminiQuotaCooldownUntilMs() {
  try {
    var v = Number(localStorage.getItem(STELVIO_GEMINI_QUOTA_LS_KEY) || 0);
    return v > Date.now() ? v : 0;
  } catch (e) {
    return 0;
  }
}

function getGeminiQuotaCooldownRemainingSec() {
  var until = getGeminiQuotaCooldownUntilMs();
  if (!until) return 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function setGeminiQuotaCooldown(retryAfterSec) {
  var sec = Math.max(5, Math.min(600, Math.ceil(Number(retryAfterSec) || 30)));
  try {
    localStorage.setItem(STELVIO_GEMINI_QUOTA_LS_KEY, String(Date.now() + sec * 1000));
  } catch (e) {}
}

/** Gemini 오류 본문 파싱 — 429 할당량·retry-after(초) */
function parseGeminiApiError(text, httpStatus) {
  var msg = '';
  try {
    var data = typeof text === 'string' ? JSON.parse(text) : text;
    msg = (data && data.error && data.error.message) || '';
  } catch (e) {
    msg = String(text || '');
  }
  var retrySec = 0;
  var m = msg.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  if (m) retrySec = Math.ceil(parseFloat(m[1]));
  var isQuotaExceeded =
    httpStatus === 429 &&
    (/quota exceeded|free_tier|free tier|generate_content_free_tier/i.test(msg) ||
      /limit:\s*20/i.test(msg));
  return {
    message: msg,
    retryAfterSec: retrySec,
    isQuotaExceeded: isQuotaExceeded,
    isRateLimited: httpStatus === 429,
    status: httpStatus,
  };
}

function trainingStatusFromWorkoutCategory(category) {
  var map = {
    recovery: 'Recovery Needed',
    endurance: 'Building Base',
    tempo: 'Ready to Race',
    high_intensity: 'Peaking',
  };
  return map[category] || 'Building Base';
}

/** 429 할당량 소진 시 사용자 안내 문구 (오류가 아님을 명시) */
function buildGeminiQuotaUserNotice(retryAfterSec) {
  var sec =
    retryAfterSec != null ? Math.max(0, Math.ceil(Number(retryAfterSec))) : getGeminiQuotaCooldownRemainingSec();
  var waitLine =
    sec > 0
      ? '약 ' +
        sec +
        '초 후 「훈련 상태」 옆 새로고침을 누르시면 AI 코멘트 생성을 다시 시도합니다. (같은 날 무료 한도가 남아 있을 때만 성공합니다.)'
      : 'Google AI Studio 무료 한도는 보통 자정(미국 태평양 기준)에 초기화됩니다. 유료 플랜·다른 API 키를 쓰시면 한도가 늘어납니다.';
  return {
    gemini_quota_exceeded: true,
    quota_notice_title: 'AI 코멘트 안내 — 분석 오류가 아닙니다',
    quota_notice:
      'Gemini API 무료 한도(일 20회, gemini-2.5-flash)가 모두 사용되어, 지금은 AI가 작성하는 코멘트 대신 훈련 로그·컨디션 점수 기반 안내 문구를 표시합니다.',
    quota_notice_detail:
      '아래 컨디션 점수·VO₂max·추천 워크아웃은 정상적으로 계산된 값입니다. ' + waitLine,
    quota_retry_after_sec: sec,
  };
}

/**
 * Gemini 없이 컨디션·TSS·규칙 엔진만으로 코치 카드 데이터 생성 (할당량 초과·API 실패 시)
 */
function buildDeterministicCoachResponse(ctx) {
  ctx = ctx || {};
  var isRun = ctx.sportCategory === 'run';
  var userName = (ctx.userProfile && ctx.userProfile.name) || '사용자';
  var defaultWorkouts = isRun
    ? ['Easy Run (Z2)']
    : ['Endurance (Z2)'];
  var workoutDecision = ctx.workoutDecision || {
    category: isRun ? 'endurance' : 'endurance',
    allowedWorkouts: defaultWorkouts,
    reason: isRun ? '오늘 컨디션에 맞는 지구력 러닝을 권장합니다.' : '오늘 컨디션에 맞는 지구력 훈련을 권장합니다.'
  };
  var recommended = isRun
    ? resolveRunRecommendedWorkout(workoutDecision, workoutDecision.allowedWorkouts && workoutDecision.allowedWorkouts[0])
    : normalizeCoachRecommendedWorkout(workoutDecision.allowedWorkouts[0], workoutDecision);
  var loadLabel = isRun ? 'rTSS' : 'TSS';
  var comment =
    userName +
    '님, 최근 7일 ' + loadLabel + ' ' +
    (ctx.last7DaysTSS != null ? ctx.last7DaysTSS : 0) +
    '점·주간 평균 ' +
    (ctx.weeklyTSS != null ? ctx.weeklyTSS : 0) +
    '점·컨디션 ' +
    (ctx.conditionScore != null ? ctx.conditionScore : 50) +
    '점입니다. ' +
    workoutDecision.reason;
  if (isRun && ctx.thresholdPace) {
    comment = userName + '님, 역치 페이스 ' + ctx.thresholdPace + ' 기준으로 ' + comment.replace(/^[^,]+님, /, '');
  }
  var trainingStatusFn = isRun ? trainingStatusFromRunWorkoutCategory : trainingStatusFromWorkoutCategory;
  var out = {
    condition_score: ctx.conditionScore != null ? ctx.conditionScore : 50,
    training_status: trainingStatusFn(workoutDecision.category),
    vo2max_estimate: ctx.calculatedVO2Max != null ? ctx.calculatedVO2Max : 40,
    coach_comment: comment,
    recommended_workout: recommended,
    workout_category: workoutDecision.category,
    workout_category_reason: workoutDecision.reason,
    training_zone: workoutDecision.training_zone || workoutDecision.primaryZone || null,
    sport_category: isRun ? 'run' : undefined,
    analysis_source: ctx.quotaExceeded ? 'deterministic_quota' : 'deterministic'
  };
  if (ctx.quotaExceeded) {
    var quotaUi = buildGeminiQuotaUserNotice(ctx.retryAfterSec);
    Object.keys(quotaUi).forEach(function (k) {
      out[k] = quotaUi[k];
    });
  } else if (ctx.apiFailed) {
    out.coach_comment += ' (AI 서버 연결이 잠시 불안정하여 규칙 기반 안내로 표시합니다.)';
  }
  return out;
}

/** 저사양/모바일 감지: 타임아웃·재시도 연장용 */
function isLowSpecOrMobile() {
  if (typeof window !== 'undefined' && typeof window.isMobile === 'function' && window.isMobile()) return true;
  var ua = (navigator && navigator.userAgent) || '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  var mem = navigator.deviceMemory;
  var cores = navigator.hardwareConcurrency;
  if (typeof mem === 'number' && mem > 0 && mem <= 4) return true;
  if (typeof cores === 'number' && cores > 0 && cores <= 4) return true;
  return false;
}

async function callGeminiCoach(userProfile, recentLogs, last7DaysTSSFromDashboard, options) {
  var opts = options || {};
  var isRun = resolveCoachSportCategory(userProfile, opts) === 'run';
  var isLowSpec = isLowSpecOrMobile();
  var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : (isLowSpec ? 150000 : 60000);
  var maxRetries = opts.maxRetries != null ? opts.maxRetries : (isLowSpec ? 3 : 2);
  const apiKey = localStorage.getItem('geminiApiKey');
  
  if (!apiKey) {
    throw new Error('Gemini API 키가 설정되지 않았습니다. 환경 설정에서 API 키를 입력해주세요.');
  }

  // 훈련 횟수·TSS/rTSS: 같은 날 Strava 있으면 Strava만, 없으면 Stelvio만
  recentLogs = (typeof window.buildHistoryWithTSSRuleByDate === 'function')
    ? window.buildHistoryWithTSSRuleByDate(recentLogs || [])
    : oneLogPerDayPreferStravaForCoach(recentLogs || []);

  if (isRun && typeof window.isRunTrainingLog === 'function') {
    recentLogs = recentLogs.filter(window.isRunTrainingLog);
  }

  // 최근 7일 TSS: 대시보드에서 전달한 주간 실적이 있으면 그대로 사용(화면과 코멘트 일치), 없으면 여기서 계산
  var today = new Date(); // 컨디션 점수(todayStrScore)에서 항상 사용하므로 if 밖에서 정의
  var last7DaysTSS;
  if (typeof last7DaysTSSFromDashboard === 'number' && !isNaN(last7DaysTSSFromDashboard)) {
    last7DaysTSS = Math.round(last7DaysTSSFromDashboard);
  } else {
    function getLocalDateStrFromLog(log) {
      var d = null;
      if (log.completed_at) {
        d = typeof log.completed_at === 'string' ? new Date(log.completed_at) : log.completed_at;
      } else if (log.date) {
        var d2 = log.date;
        if (d2 && typeof d2.toDate === 'function') d2 = d2.toDate();
        d = d2 ? new Date(d2) : null;
      }
      if (!d || !d.getFullYear) return '';
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    var todayStrForTSS = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    var start7 = new Date(today);
    start7.setDate(start7.getDate() - 6);
    var start7Str = start7.getFullYear() + '-' + String(start7.getMonth() + 1).padStart(2, '0') + '-' + String(start7.getDate()).padStart(2, '0');
    var logsLast7 = (recentLogs || []).filter(function (log) {
      var d = getLocalDateStrFromLog(log);
      return d && d >= start7Str && d <= todayStrForTSS;
    });
    last7DaysTSS = Math.round(logsLast7.reduce(function (sum, l) {
      var t = Number(l.tss) || 0; return sum + ((t > 0 && t < 1200) ? t : 0);
    }, 0));
  }
  var totalTSS = Math.round((recentLogs || []).reduce(function (sum, l) {
    var t = Number(l.tss) || 0; return sum + ((t > 0 && t < 1200) ? t : 0);
  }, 0));
  var weeklyTSS = Math.round(totalTSS / 4.3);

  // 컨디션 점수: API 호출 전에 공통 모듈로 산출해 프롬프트에 주입 — 코멘트에 표시되는 점수와 화면 표시(93점)가 일치하도록
  var conditionScoreForPrompt = 50;
  if (typeof window.computeConditionScore === 'function') {
    var userForScore = {
      age: userProfile?.age,
      gender: userProfile?.gender,
      challenge: userProfile?.challenge,
      ftp: userProfile?.ftp,
      weight: userProfile?.weight,
      sportCategory: isRun ? 'run' : 'cycle',
      category: isRun ? 'RUN' : (userProfile?.category || 'CYCLE')
    };
    var logsForScore = (recentLogs || []).slice();
    var deduped = typeof window.dedupeLogsForConditionScore === 'function' ? window.dedupeLogsForConditionScore(logsForScore) : logsForScore;
    var todayStrScore = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    var csResult = window.computeConditionScore(userForScore, deduped, todayStrScore);
    conditionScoreForPrompt = Math.max(50, Math.min(100, csResult.score));
  }

  var calculatedVO2Max = 40;
  if (isRun) {
    var tpSec = userProfile && (userProfile.threshold_pace_sec != null
      ? Number(userProfile.threshold_pace_sec)
      : null);
    if (tpSec == null && userProfile && userProfile.threshold_pace) {
      if (window.runDashboardPace && typeof window.runDashboardPace.parsePaceToSecPerKm === 'function') {
        var disp = String(userProfile.threshold_pace).replace(/\s*min\/1km\s*$/i, '').trim();
        tpSec = window.runDashboardPace.parsePaceToSecPerKm(disp);
      }
    }
    if (window.runDashboardPace && typeof window.runDashboardPace.computeRunVo2maxFromThresholdPace === 'function') {
      calculatedVO2Max = window.runDashboardPace.computeRunVo2maxFromThresholdPace(tpSec);
    }
  } else {
    var vo2FromLogs =
      typeof window.calculateStelvioVO2Max === 'function' ? window.calculateStelvioVO2Max(userProfile, recentLogs) : null;
    calculatedVO2Max =
      vo2FromLogs != null
        ? vo2FromLogs
        : typeof window.computeVo2maxEstimate === 'function'
          ? window.computeVo2maxEstimate(userProfile)
          : 40;
  }

  var weeklyRtssGoal = opts.weeklyRtssGoal != null ? Number(opts.weeklyRtssGoal) : 0;
  if (!weeklyRtssGoal && isRun && typeof window.getWeeklyTargetRtss === 'function') {
    var rtssInfo = window.getWeeklyTargetRtss(userProfile?.challenge || 'Fitness');
    if (rtssInfo && rtssInfo.target != null) weeklyRtssGoal = rtssInfo.target;
  }
  var hexagonContext = opts.hexagonContext || null;
  var thresholdPaceDisplay = (userProfile && userProfile.threshold_pace) ||
    (opts.thresholdPaceDisplay) || '산출 불가';

  var workoutDecision;
  try {
    if (isRun) {
      workoutDecision = determineDeterministicRunWorkoutCategory(
        conditionScoreForPrompt, last7DaysTSS, weeklyTSS, hexagonContext, recentLogs, weeklyRtssGoal
      );
    } else {
      workoutDecision = determineDeterministicWorkoutCategory(
        conditionScoreForPrompt, last7DaysTSS, weeklyTSS, recentLogs
      );
    }
  } catch (wdErr) {
    console.warn('[callGeminiCoach] workout category 오류 (기본값 사용):', wdErr);
    workoutDecision = isRun
      ? { category: 'endurance', allowedWorkouts: ['Easy Run (Z2)'], reason: '기본 지구력 러닝을 권장합니다.' }
      : { category: 'endurance', allowedWorkouts: ['Endurance (Z2)'], reason: '카테고리 결정 중 오류가 발생하여 기본 지구력 훈련을 권장합니다.' };
  }

  var deterministicCtx = {
    userProfile: userProfile,
    workoutDecision: workoutDecision,
    last7DaysTSS: last7DaysTSS,
    weeklyTSS: weeklyTSS,
    conditionScore: conditionScoreForPrompt,
    calculatedVO2Max: calculatedVO2Max,
    sportCategory: isRun ? 'run' : 'cycle',
    thresholdPace: thresholdPaceDisplay,
    weeklyRtssGoal: weeklyRtssGoal
  };

  var quotaRemainSec = getGeminiQuotaCooldownRemainingSec();
  if (quotaRemainSec > 0 && opts.forceApi !== true) {
    console.warn('[callGeminiCoach] Gemini 할당량 쿨다운 중 — 규칙 기반 분석으로 표시 (' + quotaRemainSec + 's)');
    return buildDeterministicCoachResponse(
      Object.assign({}, deterministicCtx, {
        quotaExceeded: true,
        retryAfterSec: quotaRemainSec,
      })
    );
  }

  // 시스템 프롬프트
  var systemPrompt = isRun
    ? (window.GEMINI_RUN_COACH_SYSTEM_PROMPT || window.GEMINI_COACH_SYSTEM_PROMPT)
    : (window.GEMINI_COACH_SYSTEM_PROMPT || `
Role: 당신은 'Stelvio AI'의 수석 사이클링 코치이자 데이터 분석가입니다.
Context: 사용자의 프로필({{userProfile}})과 최근 30일간의 훈련 로그({{recentLogs}})를 분석하여 JSON 형식으로 인사이트를 제공해야 합니다.
훈련 로그는 날짜별로 **Strava 로그를 우선** 사용하고, 해당 날짜에 Strava가 없으면 **Stelvio 로그**를 사용한 결과입니다.

**TSS 수치 (반드시 이 값을 사용하세요):**
- 최근 7일 TSS 누적: {{last7DaysTSS}}점 (오늘 포함, 오늘 기준 -6일 ~ 오늘, 7일간 합계)
- 주간 평균 TSS: {{weeklyTSS}}점 (최근 30일 기준)
Coach Comment에서 TSS를 언급할 때 위 수치를 **그대로** 사용하세요. 자체 계산하지 마세요.

**컨디션 점수 (반드시 이 값을 사용하세요):**
- 현재 컨디션 점수: {{conditionScore}}점 (화면에 표시되는 점수와 동일)
Coach Comment에서 "컨디션 점수" 또는 "현재 컨디션"을 언급할 때 반드시 **{{conditionScore}}점**이라고만 쓰세요. 다른 숫자를 쓰지 마세요.

**VO2 Max (반드시 이 값을 사용하세요):**
- 현재 추정 VO2 Max: {{calculatedVO2Max}}
Coach Comment에서 VO2 Max를 언급할 때 반드시 **{{calculatedVO2Max}}** 수치를 사용하세요. 자체 계산하지 마세요.

Task Requirements:
1. **Condition Score (0~100):** JSON의 condition_score는 반드시 **{{conditionScore}}** 로 설정하세요. (위에 제공된 값)
2. **Training Status:** 현재 상태를 한 단어로 정의하세요 (예: "Ready to Race", "Recovery Needed", "Building Base", "Peaking").
3. **Coach Comment:** 사용자의 이름을 부르며, 최근 7일 TSS, 주간 평균 TSS, 현재 컨디션 점수와 함께 **현재 추정 VO2 Max({{calculatedVO2Max}})** 수치를 활용하여 훈련 성과를 언급하고 동기를 부여하는 조언을 한국어(경어체)로 작성하세요. 3~4문장 분량으로 상세하고 충분히 작성하고, 절대 문장을 도중에 끊지 마세요.
4. **Recommended Workout:** 오늘 수행해야 할 추천 훈련 타입을 제안하세요.
   - **반드시** 시스템이 결정한 허용 목록 중 하나를 **Zone 포함 전체 문자열**로 출력하세요: {{allowedWorkoutTypes}}
   - 예: "VO2 Max (Z5)", "Active Recovery (Z1)" — "VO2 Max"처럼 Zone 없이 단독 출력 금지
   - 규칙 기반 권장 카테고리: {{determinedWorkoutCategory}} ({{workoutCategoryReason}})

Output Format (JSON Only):
- vo2max_estimate는 시스템에서 제공한 값 **{{calculatedVO2Max}}**를 그대로 사용하세요. AI가 계산하지 않습니다.
{
  "condition_score": 85,
  "training_status": "Ready to Race",
  "vo2max_estimate": {{calculatedVO2Max}},
  "coach_comment": "지성님, 이번 주 TSS 목표를 거의 달성하셨네요! 현재 추정 VO2 Max는 {{calculatedVO2Max}}로, 컨디션과 잘 맞습니다. 오늘은 가벼운 리커버리로 조절하세요.",
  "recommended_workout": "VO2 Max (Z5)"
}
`);

  // 프롬프트에 데이터 삽입
  const userName = userProfile?.name || '사용자';
  var hexagonJson = hexagonContext
    ? JSON.stringify(hexagonContext.hexagon || hexagonContext, null, 2)
    : '{}';
  const prompt = systemPrompt
    .replace('{{userProfile}}', JSON.stringify(userProfile, null, 2))
    .replace('{{recentLogs}}', JSON.stringify(recentLogs, null, 2))
    .replace('{{userName}}', userName)
    .replace(/\{\{last7DaysTSS\}\}/g, String(last7DaysTSS))
    .replace(/\{\{last7DaysRTSS\}\}/g, String(last7DaysTSS))
    .replace(/\{\{weeklyTSS\}\}/g, String(weeklyTSS))
    .replace(/\{\{weeklyRTSS\}\}/g, String(weeklyTSS))
    .replace(/\{\{weeklyRtssGoal\}\}/g, String(weeklyRtssGoal || 0))
    .replace(/\{\{thresholdPace\}\}/g, String(thresholdPaceDisplay))
    .replace(/\{\{hexagonPaceData\}\}/g, hexagonJson)
    .replace(/\{\{conditionScore\}\}/g, String(conditionScoreForPrompt))
    .replace(/\{\{calculatedVO2Max\}\}/g, String(calculatedVO2Max))
    .replace(/\{\{determinedWorkoutCategory\}\}/g, workoutDecision.category)
    .replace(/\{\{workoutCategoryReason\}\}/g, workoutDecision.reason)
    .replace(/\{\{determinedRecommendedWorkout\}\}/g, workoutDecision.recommendedWorkout || (workoutDecision.allowedWorkouts && workoutDecision.allowedWorkouts[0]) || 'Recovery Jog (Z1)')
    .replace(/\{\{allowedWorkoutTypes\}\}/g, workoutDecision.allowedWorkouts.map(function(w){ return '"' + w + '"'; }).join(', '));

  // 모델 설정
  let modelName = localStorage.getItem('geminiModelName') || 'gemini-2.5-flash';
  let apiVersion = localStorage.getItem('geminiApiVersion') || 'v1beta';

  // [저사양/안드로이드 대응] 스트리밍(SSE) 우선: 연결 유지로 OS 네트워크 끊김 방지
  const useStreaming = opts.useStreaming !== false;
  const streamApiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const restApiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.2,   // 0.7 → 0.2: 추천 일관성 확보 (코치 코멘트는 랜덤성이 낮아야 신뢰도 유지)
      topP: 0.85,
      topK: 20
    }
  };
  const onChunk = opts.onChunk || null;

  function isCommentTruncated(str) {
    if (!str || typeof str !== 'string') return true;
    var t = str.trim();
    if (t.length < 10) return true;
    return !/(세요|습니다|니다|합니다|해요|네요|죠|조|요|다|음|함)[.!?~]*\s*$/.test(t);
  }

  var lastError = null;
  var lastErrInfo = null;
  var RETRYABLE_STATUS = [503, 500, 502];
  var hasAbortController = typeof AbortController !== 'undefined';

  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) {
      var backoffMs = lastErrInfo && lastErrInfo.isQuotaExceeded && lastErrInfo.retryAfterSec
        ? Math.min((lastErrInfo.retryAfterSec + 2) * 1000, 120000)
        : Math.min(1500 * Math.pow(2, attempt - 2), 20000);
      console.warn('[callGeminiCoach] 재시도 ' + attempt + '/' + maxRetries + ' (' + backoffMs + 'ms 대기)');
      await new Promise(function (r) { setTimeout(r, backoffMs); });
    }
    try {
      var controller = null;
      var timeoutId = null;
      var responseText = '';
      var usedStreaming = false;
      var candidate = null;

      function buildFetchOptions() {
        var opt = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) };
        if (hasAbortController) {
          controller = new AbortController();
          timeoutId = setTimeout(function () {
            if (controller) controller.abort();
          }, timeoutMs);
          opt.signal = controller.signal;
          if (opts.signal && opts.signal.aborted) {
            controller.abort();
          } else if (opts.signal) {
            opts.signal.addEventListener('abort', function () {
              if (controller) controller.abort();
            });
          }
        }
        return opt;
      }

      // 1) 스트리밍 시도 (저사양/안드로이드: 연결 유지로 타임아웃 방지)
      if (useStreaming && attempt === 1) {
        try {
          var streamRes = await fetch(streamApiUrl, buildFetchOptions()).catch(function (err) {
            if (timeoutId) clearTimeout(timeoutId);
            if (err && err.name === 'AbortError') {
              var e = new Error('요청 시간 초과 (' + Math.round(timeoutMs / 1000) + '초). 네트워크가 불안정할 수 있습니다. 다시 시도해 주세요.');
              e.code = 'TIMEOUT';
              throw e;
            }
            if (err && (err.message || '').indexOf('Failed to fetch') !== -1) {
              var ne = new Error('네트워크 오류: 연결이 끊어졌거나 서버에 도달할 수 없습니다.');
              ne.code = 'NETWORK';
              throw ne;
            }
            throw err;
          });
          if (timeoutId) clearTimeout(timeoutId);

          if (!streamRes.ok) {
            var streamErrText = await streamRes.text().catch(function () {
              return '';
            });
            var streamErrInfo = parseGeminiApiError(streamErrText, streamRes.status);
            lastErrInfo = streamErrInfo;
            if (streamErrInfo.isQuotaExceeded) {
              setGeminiQuotaCooldown(streamErrInfo.retryAfterSec || 30);
              console.warn('[callGeminiCoach] 스트리밍 429 할당량 초과 — REST 추가 호출 없이 규칙 기반 폴백');
              return buildDeterministicCoachResponse(
                Object.assign({}, deterministicCtx, {
                  quotaExceeded: true,
                  retryAfterSec: streamErrInfo.retryAfterSec || getGeminiQuotaCooldownRemainingSec(),
                })
              );
            }
            if (streamRes.status === 429 && streamErrInfo.retryAfterSec > 0 && attempt < maxRetries) {
              lastError = new Error('Gemini API rate limit: ' + streamErrInfo.message);
              continue;
            }
            console.warn('[callGeminiCoach] 스트리밍 HTTP ' + streamRes.status + ', REST 폴백 시도');
          } else if (streamRes.ok && streamRes.body) {
            usedStreaming = true;
            var reader = streamRes.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';
            var lastFinishReason = '';
            while (true) {
              var done = false;
              var value = null;
              try {
                var result = await reader.read();
                done = result.done;
                value = result.value;
              } catch (readErr) {
                if (readErr && readErr.name === 'AbortError') {
                  var te = new Error('요청 시간 초과 (' + Math.round(timeoutMs / 1000) + '초)');
                  te.code = 'TIMEOUT';
                  throw te;
                }
                throw readErr;
              }
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              var lines = buffer.split(/\r?\n/);
              buffer = lines.pop() || '';
              for (var li = 0; li < lines.length; li++) {
                var line = lines[li].trim();
                if (line.startsWith('data: ')) {
                  var jsonStr = line.slice(6);
                  if (jsonStr === '[DONE]' || jsonStr === '') continue;
                  try {
                    var chunkData = JSON.parse(jsonStr);
                    var cand = chunkData.candidates?.[0];
                    if (cand && cand.finishReason) lastFinishReason = cand.finishReason;
                    var delta = cand?.content?.parts?.[0]?.text || '';
                    if (delta) {
                      responseText += delta;
                      if (typeof onChunk === 'function') onChunk(delta, responseText);
                    }
                  } catch (parseChunkErr) { /* ignore malformed chunk */ }
                }
              }
            }
            if (buffer.trim().startsWith('data: ')) {
              try {
                var tailJson = buffer.trim().slice(6);
                if (tailJson && tailJson !== '[DONE]') {
                  var tailData = JSON.parse(tailJson);
                  var tailCand = tailData.candidates?.[0];
                  if (tailCand && tailCand.finishReason) lastFinishReason = tailCand.finishReason;
                  var tailDelta = tailCand?.content?.parts?.[0]?.text || '';
                  if (tailDelta) {
                    responseText += tailDelta;
                    if (typeof onChunk === 'function') onChunk(tailDelta, responseText);
                  }
                }
              } catch (e) { /* ignore */ }
            }
            candidate = { finishReason: lastFinishReason };
          }
        } catch (streamErr) {
          if (streamErr.code === 'TIMEOUT' || streamErr.code === 'NETWORK') throw streamErr;
          console.warn('[callGeminiCoach] 스트리밍 실패, REST 폴백:', streamErr && streamErr.message);
          usedStreaming = false;
        }
      }

      // 2) REST 폴백 (스트리밍 미사용 또는 실패 시)
      if (!usedStreaming) {
        controller = null;
        timeoutId = null;
        var fetchOptions = buildFetchOptions();
        var response = await fetch(restApiUrl, fetchOptions).catch(function (err) {
          if (timeoutId) clearTimeout(timeoutId);
          if (err && err.name === 'AbortError') {
            var e = new Error('요청 시간 초과 (' + Math.round(timeoutMs / 1000) + '초)');
            e.code = 'TIMEOUT';
            throw e;
          }
          if (err && (err.message || '').indexOf('Failed to fetch') !== -1) {
            var ne = new Error('네트워크 오류: 연결이 끊어졌거나 서버에 도달할 수 없습니다.');
            ne.code = 'NETWORK';
            throw ne;
          }
          throw err;
        });
        if (timeoutId) clearTimeout(timeoutId);

        if (!response.ok) {
          var errorText = await response.text().catch(function () {
            return '';
          });
          var errInfo = parseGeminiApiError(errorText, response.status);
          lastErrInfo = errInfo;
          lastError = new Error('Gemini API 오류: ' + (errInfo.message || errorText));
          if (errInfo.isQuotaExceeded) {
            setGeminiQuotaCooldown(errInfo.retryAfterSec || 30);
            console.warn('[callGeminiCoach] REST 429 할당량 초과 — 규칙 기반 폴백');
            return buildDeterministicCoachResponse(
              Object.assign({}, deterministicCtx, {
                quotaExceeded: true,
                retryAfterSec: errInfo.retryAfterSec || getGeminiQuotaCooldownRemainingSec(),
              })
            );
          }
          if (
            errInfo.isRateLimited &&
            errInfo.retryAfterSec > 0 &&
            errInfo.retryAfterSec <= 90 &&
            attempt < maxRetries
          ) {
            console.warn('[callGeminiCoach] 429 rate limit, ' + errInfo.retryAfterSec + '초 후 1회 재시도');
            continue;
          }
          if (RETRYABLE_STATUS.indexOf(response.status) !== -1 && attempt < maxRetries) {
            console.warn('[callGeminiCoach] 서버 일시 오류(' + response.status + '), 재시도 예정');
            continue;
          }
          break;
        }

        var data = await response.json();
        var candidate = data.candidates?.[0];
        responseText = candidate?.content?.parts?.[0]?.text || '';
      }

      var finishReason = (candidate && (candidate.finishReason || candidate.finish_reason)) || '';
      if (!responseText) {
        lastError = new Error('Gemini API 응답이 비어있습니다.');
        continue;
      }

      var responseWasTruncated = (finishReason === 'MAX_TOKENS' || finishReason === 'max_tokens');
      var jsonText = responseText.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }

      var result = null;
      try {
        result = JSON.parse(jsonText);
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError && jsonText.indexOf('"coach_comment"') !== -1) {
          var repaired = jsonText;
          if (!/"\s*}\s*$/.test(repaired)) {
            if (/"[^"]*$/.test(repaired)) repaired = repaired + '"';
            if (!/\}\s*$/.test(repaired)) repaired = repaired + ' }';
          }
          try {
            result = JSON.parse(repaired);
          } catch (e2) {
            var coachCommentMatch = jsonText.match(/"coach_comment"\s*:\s*"((?:[^"\\]|\\.)*)"?\s*[,}]/);
            if (!coachCommentMatch) coachCommentMatch = jsonText.match(/"coach_comment"\s*:\s*"((?:[^"\\]|\\.)*)/);
            var statusMatch = jsonText.match(/"training_status"\s*:\s*"([^"]+)"/);
            var vo2Match = jsonText.match(/"vo2max_estimate"\s*:\s*(\d+)/);
            var workoutMatch = jsonText.match(/"recommended_workout"\s*:\s*"([^"]+)"/);
            var commentStr = (coachCommentMatch && coachCommentMatch[1]) ? coachCommentMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim() : '';
            result = {
              training_status: (statusMatch && statusMatch[1]) ? statusMatch[1] : 'Building Base',
              vo2max_estimate: (vo2Match && vo2Match[1]) ? Math.max(20, Math.min(100, parseInt(vo2Match[1], 10))) : 40,
              coach_comment: commentStr,
              recommended_workout: (workoutMatch && workoutMatch[1]) ? workoutMatch[1] : 'Active Recovery (Z1)'
            };
            if (!result.coach_comment) result.coach_comment = userName + '님, 오늘도 화이팅하세요!';
          }
        }
        if (!result) {
          lastError = parseErr;
          continue;
        }
      }

      if (responseWasTruncated || isCommentTruncated(result.coach_comment)) {
        if (result.coach_comment && result.coach_comment.trim().length >= 30 && attempt >= maxRetries - 1) {
          result.coach_comment = result.coach_comment.trim() + ' (응답이 길어 일부 잘렸을 수 있습니다.)';
          var statusFnTrunc = isRun ? trainingStatusFromRunWorkoutCategory : trainingStatusFromWorkoutCategory;
          return attachCoachWorkoutMetadata({
            condition_score: conditionScoreForPrompt,
            training_status: result.training_status || statusFnTrunc(workoutDecision.category),
            vo2max_estimate: calculatedVO2Max,
            coach_comment: result.coach_comment,
            recommended_workout: isRun
              ? resolveRunRecommendedWorkout(workoutDecision, result.recommended_workout)
              : normalizeCoachRecommendedWorkout(result.recommended_workout, workoutDecision),
          }, workoutDecision, isRun);
        }
        lastError = new Error('응답이 잘렸거나 코멘트가 불완전합니다.');
        continue;
      }
      if (!result.coach_comment) {
        result.coach_comment = userName + '님, 오늘도 화이팅하세요!';
      }

      var conditionScore = conditionScoreForPrompt;
      // VO2 Max: AI 응답에 의존하지 않고, 프롬프트 생성 전 산출한 STELVIO 자체 값으로 확정
      var trainingStatusFn = isRun ? trainingStatusFromRunWorkoutCategory : function(c) { return trainingStatusFromWorkoutCategory(c); };
      return attachCoachWorkoutMetadata({
        condition_score: conditionScore,
        training_status: result.training_status || trainingStatusFn(workoutDecision.category),
        vo2max_estimate: calculatedVO2Max,
        coach_comment: result.coach_comment || (userName + '님, 오늘도 화이팅하세요!'),
        recommended_workout: isRun
          ? resolveRunRecommendedWorkout(workoutDecision, result.recommended_workout)
          : normalizeCoachRecommendedWorkout(result.recommended_workout, workoutDecision),
      }, workoutDecision, isRun);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        continue;
      }
      break;
    }
  }

  if (lastError) {
    console.error('Gemini Coach API 오류 (재시도 ' + maxRetries + '회 후 실패):', lastError);
  }
  return buildDeterministicCoachResponse(
    Object.assign({}, deterministicCtx, {
      apiFailed: true,
      quotaExceeded: !!(lastErrInfo && lastErrInfo.isQuotaExceeded),
      retryAfterSec:
        lastErrInfo && lastErrInfo.retryAfterSec
          ? lastErrInfo.retryAfterSec
          : getGeminiQuotaCooldownRemainingSec(),
    })
  );
}

window.determineDeterministicWorkoutCategory = determineDeterministicWorkoutCategory;
window.buildDeterministicCoachResponse = buildDeterministicCoachResponse;
window.buildGeminiQuotaUserNotice = buildGeminiQuotaUserNotice;
window.getGeminiQuotaCooldownRemainingSec = getGeminiQuotaCooldownRemainingSec;

// 전역으로 노출
if (typeof window !== 'undefined') {
  window.callGeminiCoach = callGeminiCoach;
  window.determineDeterministicWorkoutCategory = determineDeterministicWorkoutCategory;
  window.determineDeterministicRunWorkoutCategory = determineDeterministicRunWorkoutCategory;
  window.resolveCoachSportCategory = resolveCoachSportCategory;
}
