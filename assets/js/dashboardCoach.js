/* ==========================================================
   Dashboard AI Coach 모듈
   - Gemini API를 사용한 사용자 대시보드 분석
   - callGeminiCoach 함수 제공
========================================================== */

/**
 * Gemini API를 사용하여 사용자 코치 인사이트 생성
 * @param {Object} userProfile - 사용자 프로필 데이터
 * @param {Array} recentLogs - 최근 30일간의 훈련 로그
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

async function callGeminiCoach(userProfile, recentLogs) {
  const apiKey = localStorage.getItem('geminiApiKey');
  
  if (!apiKey) {
    throw new Error('Gemini API 키가 설정되지 않았습니다. 환경 설정에서 API 키를 입력해주세요.');
  }

  // 훈련 횟수·TSS: 같은 날 Strava 있으면 Strava만, 없으면 Stelvio만 (TSS 규칙과 동일)
  recentLogs = (typeof window.buildHistoryWithTSSRuleByDate === 'function')
    ? window.buildHistoryWithTSSRuleByDate(recentLogs || [])
    : oneLogPerDayPreferStravaForCoach(recentLogs || []);

  // 최근 7일 TSS 누적 산출 (오늘 기준 -6일 ~ 오늘, 로컬 날짜 기준 — AI가 자체 계산하지 않고 이 값을 사용)
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
  var today = new Date();
  var todayStrForTSS = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  var start7 = new Date(today);
  start7.setDate(start7.getDate() - 6);
  var start7Str = start7.getFullYear() + '-' + String(start7.getMonth() + 1).padStart(2, '0') + '-' + String(start7.getDate()).padStart(2, '0');
  var logsLast7 = (recentLogs || []).filter(function (log) {
    var d = getLocalDateStrFromLog(log);
    return d && d >= start7Str && d <= todayStrForTSS;
  });
  var last7DaysTSS = Math.round(logsLast7.reduce(function (sum, l) { return sum + (Number(l.tss) || 0); }, 0));
  var totalTSS = Math.round((recentLogs || []).reduce(function (sum, l) { return sum + (Number(l.tss) || 0); }, 0));
  var weeklyTSS = Math.round(totalTSS / 4.3);

  // 시스템 프롬프트 가져오기
  const systemPrompt = window.GEMINI_COACH_SYSTEM_PROMPT || `
Role: 당신은 'Stelvio AI'의 수석 사이클링 코치이자 데이터 분석가입니다.
Context: 사용자의 프로필({{userProfile}})과 최근 30일간의 훈련 로그({{recentLogs}})를 분석하여 JSON 형식으로 인사이트를 제공해야 합니다.
훈련 로그는 날짜별로 **Strava 로그를 우선** 사용하고, 해당 날짜에 Strava가 없으면 **Stelvio 로그**를 사용한 결과입니다.

**TSS 수치 (반드시 이 값을 사용하세요):**
- 최근 7일 TSS 누적: {{last7DaysTSS}}점 (오늘 포함, 오늘 기준 -6일 ~ 오늘, 7일간 합계)
- 주간 평균 TSS: {{weeklyTSS}}점 (최근 30일 기준)
Coach Comment에서 TSS를 언급할 때 위 수치를 **그대로** 사용하세요. 자체 계산하지 마세요.

Task Requirements:
1. **Condition Score (0~100):** TSB(Training Stress Balance)와 최근 운동 강도를 기반으로 컨디션 점수를 산출하세요.
2. **Training Status:** 현재 상태를 한 단어로 정의하세요 (예: "Ready to Race", "Recovery Needed", "Building Base", "Peaking").
3. **Coach Comment:** 사용자의 이름({{userName}})을 부르며, **최근 7일 TSS({{last7DaysTSS}}점)·주간 평균 TSS({{weeklyTSS}}점)** 등 위에 제공된 수치를 사용해 최근 훈련 성과를 언급하고 동기를 부여하는 따뜻한 조언을 한국어(경어체)로 한 문장 작성하세요.
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
    .replace(/\{\{weeklyTSS\}\}/g, String(weeklyTSS));

  // 모델 설정
  let modelName = localStorage.getItem('geminiModelName') || 'gemini-2.5-flash';
  let apiVersion = localStorage.getItem('geminiApiVersion') || 'v1beta';

  // API 호출
  const apiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
  
  const requestBody = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
      topP: 0.8,
      topK: 40
    }
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = '';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorText;
      } catch (e) {
        errorMessage = errorText;
      }
      throw new Error(`Gemini API 오류: ${errorMessage}`);
    }

    const data = await response.json();
    
    // 응답 파싱
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!responseText) {
      throw new Error('Gemini API 응답이 비어있습니다.');
    }

    // JSON 추출 (마크다운 코드 블록 제거)
    let jsonText = responseText.trim();
    
    // ```json 또는 ``` 제거
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    
    // JSON 파싱
    const result = JSON.parse(jsonText);
    
    // 컨디션 점수: 공통 모듈(conditionScoreModule)로 50~100 1점 단위 객관 산출 (1번·2번 동일: 중복 제거 + 기준일 오늘)
    let conditionScore = result.condition_score || 50;
    if (typeof window.computeConditionScore === 'function') {
      const userForScore = { age: userProfile?.age, gender: userProfile?.gender, challenge: userProfile?.challenge, ftp: userProfile?.ftp, weight: userProfile?.weight };
      const logsForScore = (recentLogs || []).slice();
      const deduped = typeof window.dedupeLogsForConditionScore === 'function' ? window.dedupeLogsForConditionScore(logsForScore) : logsForScore;
      const today = new Date();
      const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const csResult = window.computeConditionScore(userForScore, deduped, todayStr);
      conditionScore = Math.max(50, Math.min(100, csResult.score));
    } else {
      conditionScore = Math.max(50, Math.min(100, Math.round(conditionScore)));
    }
    
    // 기본값 설정
    return {
      condition_score: conditionScore,
      training_status: result.training_status || 'Building Base',
      vo2max_estimate: result.vo2max_estimate || 40,
      coach_comment: result.coach_comment || `${userName}님, 오늘도 화이팅하세요!`,
      recommended_workout: result.recommended_workout || 'Active Recovery (Z1)'
    };
    
  } catch (error) {
    console.error('Gemini Coach API 오류:', error);
    
    // 기본값 반환 (오류 발생 시)
    return {
      condition_score: 50,
      training_status: 'Building Base',
      vo2max_estimate: 40,
      coach_comment: `${userName}님, 데이터 분석 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`,
      recommended_workout: 'Active Recovery (Z1)'
    };
  }
}

// 전역으로 노출
if (typeof window !== 'undefined') {
  window.callGeminiCoach = callGeminiCoach;
}
