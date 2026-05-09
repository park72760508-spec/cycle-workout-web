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
  var isLowSpec = isLowSpecOrMobile();
  var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : (isLowSpec ? 150000 : 60000);
  var maxRetries = opts.maxRetries != null ? opts.maxRetries : (isLowSpec ? 6 : 5);
  const apiKey = localStorage.getItem('geminiApiKey');
  
  if (!apiKey) {
    throw new Error('Gemini API 키가 설정되지 않았습니다. 환경 설정에서 API 키를 입력해주세요.');
  }

  // 훈련 횟수·TSS: 같은 날 Strava 있으면 Strava만, 없으면 Stelvio만 (TSS 규칙과 동일)
  recentLogs = (typeof window.buildHistoryWithTSSRuleByDate === 'function')
    ? window.buildHistoryWithTSSRuleByDate(recentLogs || [])
    : oneLogPerDayPreferStravaForCoach(recentLogs || []);

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
    var userForScore = { age: userProfile?.age, gender: userProfile?.gender, challenge: userProfile?.challenge, ftp: userProfile?.ftp, weight: userProfile?.weight };
    var logsForScore = (recentLogs || []).slice();
    var deduped = typeof window.dedupeLogsForConditionScore === 'function' ? window.dedupeLogsForConditionScore(logsForScore) : logsForScore;
    var todayStrScore = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    var csResult = window.computeConditionScore(userForScore, deduped, todayStrScore);
    conditionScoreForPrompt = Math.max(50, Math.min(100, csResult.score));
  }

  // VO2 Max: STELVIO 자체 산출값으로 확정 — 대시보드 표시 및 AI 코멘트에 동일 값 반영
  var vo2FromLogs =
    typeof window.calculateStelvioVO2Max === 'function' ? window.calculateStelvioVO2Max(userProfile, recentLogs) : null;
  var calculatedVO2Max =
    vo2FromLogs != null
      ? vo2FromLogs
      : typeof window.computeVo2maxEstimate === 'function'
        ? window.computeVo2maxEstimate(userProfile)
        : 40;

  // ── 규칙 기반 워크아웃 카테고리 선결정 ─────────────────────────
  // AI가 자유롭게 카테고리를 선택하지 못하도록 클라이언트 측에서 먼저 결정
  var workoutDecision;
  try {
    workoutDecision = determineDeterministicWorkoutCategory(
      conditionScoreForPrompt, last7DaysTSS, weeklyTSS, recentLogs
    );
  } catch (wdErr) {
    console.warn('[callGeminiCoach] determineDeterministicWorkoutCategory 오류 (기본값 사용):', wdErr);
    workoutDecision = {
      category: 'endurance',
      allowedWorkouts: ['Endurance (Z2)', 'Sweet Spot (Low)', 'Tempo (Z3)'],
      reason: '카테고리 결정 중 오류가 발생하여 기본 지구력 훈련을 권장합니다.'
    };
  }

  // 시스템 프롬프트 가져오기
  const systemPrompt = window.GEMINI_COACH_SYSTEM_PROMPT || `
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

Output Format (JSON Only):
- vo2max_estimate는 시스템에서 제공한 값 **{{calculatedVO2Max}}**를 그대로 사용하세요. AI가 계산하지 않습니다.
{
  "condition_score": 85,
  "training_status": "Ready to Race",
  "vo2max_estimate": {{calculatedVO2Max}},
  "coach_comment": "지성님, 이번 주 TSS 목표를 거의 달성하셨네요! 현재 추정 VO2 Max는 {{calculatedVO2Max}}로, 컨디션과 잘 맞습니다. 오늘은 가벼운 리커버리로 조절하세요.",
  "recommended_workout": "Active Recovery (Z1)"
}
`;

  // 프롬프트에 데이터 삽입
  const userName = userProfile?.name || '사용자';
  const prompt = systemPrompt
    .replace('{{userProfile}}', JSON.stringify(userProfile, null, 2))
    .replace('{{recentLogs}}', JSON.stringify(recentLogs, null, 2))
    .replace('{{userName}}', userName)
    .replace(/\{\{last7DaysTSS\}\}/g, String(last7DaysTSS))
    .replace(/\{\{weeklyTSS\}\}/g, String(weeklyTSS))
    .replace(/\{\{conditionScore\}\}/g, String(conditionScoreForPrompt))
    .replace(/\{\{calculatedVO2Max\}\}/g, String(calculatedVO2Max))
    .replace(/\{\{determinedWorkoutCategory\}\}/g, workoutDecision.category)
    .replace(/\{\{workoutCategoryReason\}\}/g, workoutDecision.reason)
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
  var RETRYABLE_STATUS = [429, 503, 500, 502]; // Rate limit, Service Unavailable, Server errors
  var hasAbortController = typeof AbortController !== 'undefined';

  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) {
      var backoffMs = Math.min(1500 * Math.pow(2, attempt - 2), 20000);
      console.warn('[callGeminiCoach] 재시도 ' + attempt + '/' + maxRetries + ' (' + backoffMs + 'ms 대기, 저사양:' + isLowSpec + ')');
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

          if (streamRes.ok && streamRes.body) {
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
          var errorText = await response.text();
          var errorMessage = '';
          try {
            var errorData = JSON.parse(errorText);
            errorMessage = errorData.error?.message || errorText;
          } catch (e) {
            errorMessage = errorText;
          }
          lastError = new Error('Gemini API 오류: ' + errorMessage);
          if (RETRYABLE_STATUS.indexOf(response.status) !== -1 && attempt < maxRetries) {
            console.warn('[callGeminiCoach] 서버 과부하/일시 오류(' + response.status + '), 재시도 예정:', errorMessage);
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
          return {
            condition_score: conditionScoreForPrompt,
            training_status: result.training_status || 'Building Base',
            vo2max_estimate: calculatedVO2Max,
            coach_comment: result.coach_comment,
            recommended_workout: result.recommended_workout || 'Active Recovery (Z1)'
          };
        }
        lastError = new Error('응답이 잘렸거나 코멘트가 불완전합니다.');
        continue;
      }
      if (!result.coach_comment) {
        result.coach_comment = userName + '님, 오늘도 화이팅하세요!';
      }

      var conditionScore = conditionScoreForPrompt;
      // VO2 Max: AI 응답에 의존하지 않고, 프롬프트 생성 전 산출한 STELVIO 자체 값으로 확정
      return {
        condition_score: conditionScore,
        training_status: result.training_status || 'Building Base',
        vo2max_estimate: calculatedVO2Max,
        coach_comment: result.coach_comment || (userName + '님, 오늘도 화이팅하세요!'),
        recommended_workout: result.recommended_workout || 'Active Recovery (Z1)'
      };
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
  var vo2Fb = typeof window.calculateStelvioVO2Max === 'function' ? window.calculateStelvioVO2Max(userProfile, recentLogs) : null;
  var fallbackVo2 =
    vo2Fb != null
      ? vo2Fb
      : typeof window.computeVo2maxEstimate === 'function'
        ? window.computeVo2maxEstimate(userProfile)
        : 40;
  var conditionScoreFallback = conditionScoreForPrompt;
  var dataRichFallback = userName + '님, 최근 7일 TSS ' + last7DaysTSS + '점, 주간 평균 ' + weeklyTSS + '점, 컨디션 ' + conditionScoreFallback + '점입니다. AI 분석이 일시적으로 지연되고 있습니다. 아래 \'다시 분석\' 버튼을 눌러 재시도해 주세요.';
  return {
    condition_score: conditionScoreFallback,
    training_status: 'Building Base',
    vo2max_estimate: fallbackVo2,
    coach_comment: dataRichFallback,
    recommended_workout: 'Active Recovery (Z1)',
    error_reason: '분석이 완료되지 않았습니다. "다시 분석"을 눌러 재시도해 주세요.'
  };
}

// 전역으로 노출
if (typeof window !== 'undefined') {
  window.callGeminiCoach = callGeminiCoach;
  window.determineDeterministicWorkoutCategory = determineDeterministicWorkoutCategory;
}
