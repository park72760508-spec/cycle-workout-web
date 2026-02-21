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

async function callGeminiCoach(userProfile, recentLogs, last7DaysTSSFromDashboard) {
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
    last7DaysTSS = Math.round(logsLast7.reduce(function (sum, l) { return sum + (Number(l.tss) || 0); }, 0));
  }
  var totalTSS = Math.round((recentLogs || []).reduce(function (sum, l) { return sum + (Number(l.tss) || 0); }, 0));
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

Task Requirements:
1. **Condition Score (0~100):** JSON의 condition_score는 반드시 **{{conditionScore}}** 로 설정하세요. (위에 제공된 값)
2. **Training Status:** 현재 상태를 한 단어로 정의하세요 (예: "Ready to Race", "Recovery Needed", "Building Base", "Peaking").
3. **Coach Comment:** 사용자의 이름을 부르며, 최근 7일 TSS, 주간 평균 TSS, 현재 컨디션 점수 데이터를 활용해 사용자의 현재 상태를 심도있게 분석하고, 앞으로 어떻게 훈련해야 하는지 3~4문장 분량의 상세하고 충분한 코멘트를 경어체로 작성해주세요. 절대 문장을 도중에 끊지 마세요.
4. **VO2max Estimate:** 파워 데이터를 기반으로 추정된 VO2max 값을 정수로 반환하세요.
5. **Recommended Workout:** 오늘 수행해야 할 추천 훈련 타입을 제안하세요.

Output Format (JSON Only):
{
  "condition_score": 85,
  "training_status": "Ready to Race",
  "vo2max_estimate": 54,
  "coach_comment": "지성님, 이번 주 TSS 목표를 거의 달성하셨네요! 오늘은 가벼운 리커버리로 컨디션을 조절하세요.",
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
    .replace(/\{\{conditionScore\}\}/g, String(conditionScoreForPrompt));

  // 모델 설정
  let modelName = localStorage.getItem('geminiModelName') || 'gemini-2.5-flash';
  let apiVersion = localStorage.getItem('geminiApiVersion') || 'v1beta';

  // API 호출 (최대 3회 재시도)
  const apiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.7,
      topP: 0.8,
      topK: 40
    }
  };

  function isCommentTruncated(str) {
    if (!str || typeof str !== 'string') return true;
    var t = str.trim();
    if (t.length < 10) return true;
    return !/(세요|습니다|니다|합니다|해요|네요|죠|조|요|다|음|함)[.!?~]*\s*$/.test(t);
  }

  var lastError = null;
  const MAX_RETRIES = 3;

  for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      await new Promise(function (r) { setTimeout(r, 1000 * (attempt - 1)); });
    }
    try {
      var response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

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
        continue;
      }

      var data = await response.json();
      var candidate = data.candidates?.[0];
      var responseText = candidate?.content?.parts?.[0]?.text || '';
      var finishReason = candidate?.finishReason || candidate?.finish_reason || '';
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
        lastError = new Error('응답이 잘렸거나 코멘트가 불완전합니다.');
        continue;
      }
      if (!result.coach_comment) {
        result.coach_comment = userName + '님, 오늘도 화이팅하세요!';
      }

      var conditionScore = conditionScoreForPrompt;
      return {
        condition_score: conditionScore,
        training_status: result.training_status || 'Building Base',
        vo2max_estimate: result.vo2max_estimate || 40,
        coach_comment: result.coach_comment || (userName + '님, 오늘도 화이팅하세요!'),
        recommended_workout: result.recommended_workout || 'Active Recovery (Z1)'
      };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        continue;
      }
      break;
    }
  }

  if (lastError) {
    console.error('Gemini Coach API 오류 (재시도 ' + MAX_RETRIES + '회 후 실패):', lastError);
  }
  return {
    condition_score: 50,
    training_status: 'Building Base',
    vo2max_estimate: 40,
    coach_comment: userName + '님, 분석이 완료되지 않았습니다. 잠시 후 다시 시도해주세요.',
    recommended_workout: 'Active Recovery (Z1)'
  };
}

// 전역으로 노출
if (typeof window !== 'undefined') {
  window.callGeminiCoach = callGeminiCoach;
}
