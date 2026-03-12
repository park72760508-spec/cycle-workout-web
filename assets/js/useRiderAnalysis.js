/**
 * useRiderAnalysis - 라이더 파워 프로필 분석 훅
 * 체중, FTP, MMP 데이터 기반 0~10점 정규화 및 AI 코치 코멘트 생성
 * @module useRiderAnalysis
 */

/** 정규화 상수 (W/kg 기준) */
const NORM = {
  RSPT: 20.0,   // Max Power
  TSPT: 10.5,   // 1min
  PCH: 6.5,     // 5min
  CLMB: 5.5,    // 20min
  TTST: 5.0     // FTP
};

/**
 * 로그 배열에서 기간별 MMP 집계 (각 duration별 최대값)
 * @param {Array} logs - 훈련 로그 배열
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @returns {{ max_watts, max_1min_watts, max_5min_watts, max_20min_watts }}
 */
function aggregateMMPFromLogs(logs, fromDate, toDate) {
  const inRange = (dateStr) => dateStr && dateStr >= fromDate && dateStr <= toDate;
  const parseDate = (d) => {
    if (!d) return null;
    if (d.toDate && typeof d.toDate === 'function') return d.toDate().toISOString().slice(0, 10);
    if (typeof d === 'string') return d.slice(0, 10);
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return null;
  };

  let max_watts = 0, max_1min = 0, max_5min = 0, max_20min = 0;
  logs.forEach((log) => {
    const ds = parseDate(log.date);
    if (!inRange(ds)) return;
    const mw = Number(log.max_watts) || 0;
    const m1 = Number(log.max_1min_watts) || 0;
    const m5 = Number(log.max_5min_watts) || 0;
    const m20 = Number(log.max_20min_watts) || 0;
    if (mw > max_watts) max_watts = mw;
    if (m1 > max_1min) max_1min = m1;
    if (m5 > max_5min) max_5min = m5;
    if (m20 > max_20min) max_20min = m20;
  });

  return { max_watts, max_1min_watts: max_1min, max_5min_watts: max_5min, max_20min_watts: max_20min };
}

/**
 * 6가지 파워 프로필 점수 계산 (0~10점, Math.min 적용)
 * @param {number} userWeight - kg
 * @param {number} userFTP - W
 * @param {{ max_watts, max_1min_watts, max_5min_watts, max_20min_watts }} mmp
 * @returns {{ RSPT, TSPT, PCH, CLMB, TTST, ALLR }}
 */
function calculateRiderScores(userWeight, userFTP, mmp) {
  if (!userWeight || userWeight <= 0) {
    return { RSPT: 0, TSPT: 0, PCH: 0, CLMB: 0, TTST: 0, ALLR: 0 };
  }
  const w = userWeight;
  const f = (val, norm) => Math.min(10, ((val / w) / norm) * 10);

  const RSPT = f(mmp.max_watts || 0, NORM.RSPT);
  const TSPT = f(mmp.max_1min_watts || 0, NORM.TSPT);
  const PCH = f(mmp.max_5min_watts || 0, NORM.PCH);
  const CLMB = f(mmp.max_20min_watts || 0, NORM.CLMB);
  const TTST = f(userFTP || 0, NORM.TTST);
  const ALLR = (RSPT + TSPT + PCH + CLMB + TTST) / 5;

  return {
    RSPT: Math.round(RSPT * 100) / 100,
    TSPT: Math.round(TSPT * 100) / 100,
    PCH: Math.round(PCH * 100) / 100,
    CLMB: Math.round(CLMB * 100) / 100,
    TTST: Math.round(TTST * 100) / 100,
    ALLR: Math.round(ALLR * 100) / 100
  };
}

/**
 * AI 프로필 분석 코멘트 (Gemini API)
 * @param {Object} scores - { RSPT, TSPT, PCH, CLMB, TTST, ALLR }
 * @param {Object} options - { timeoutMs, maxRetries }
 * @returns {Promise<string>} AI 코멘트 텍스트
 */
async function fetchAIProfileAnalysis(scores, options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  const maxRetries = options.maxRetries ?? 2;

  let apiKey;
  try {
    apiKey = localStorage.getItem('geminiApiKey');
  } catch (e) {
    apiKey = null;
  }
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  const { RSPT, TSPT, PCH, CLMB, TTST, ALLR } = scores;
  const systemPrompt = '당신은 전문 사이클링 코치입니다. 주어진 6가지 파워 프로필 점수(0~10점)를 바탕으로 라이더의 현재 강점과 보완해야 할 점을 분석해 주세요. 전문 용어를 최소화하고 누구나 이해하기 쉽게 작성하세요. 너무 장황하지 않게 3~4문장으로 간결하게 요약하세요.';
  const userPrompt = `현재 내 사이클링 점수는 RSPT: ${RSPT}, TSPT: ${TSPT}, PCH: ${PCH}, CLMB: ${CLMB}, TTST: ${TTST}, ALLR: ${ALLR} 입니다. 코멘트 부탁합니다.`;

  const modelName = localStorage.getItem('geminiModelName') || 'gemini-2.5-flash';
  const apiVersion = localStorage.getItem('geminiApiVersion') || 'v1beta';
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
    ],
    generationConfig: {
      maxOutputTokens: 500,
      temperature: 0.3,
      topP: 0.95,
      topK: 40
    }
  };

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errBody = await res.text();
        let errMsg = errBody;
        try {
          const ed = JSON.parse(errBody);
          errMsg = (ed.error && ed.error.message) || errBody;
        } catch (e2) {}
        throw new Error(`Gemini API 오류 (${res.status}): ${errMsg}`);
      }

      const data = await res.json();
      if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Gemini API 응답에 텍스트가 없습니다.');
      }

      return data.candidates[0].content.parts[0].text.trim();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }

  throw lastErr || new Error('AI 분석 요청 실패');
}

/** 폴백 메시지 */
const FALLBACK_AI_COMMENT = '현재 AI 분석 서버가 혼잡하여 코멘트를 불러올 수 없습니다. 점수를 통해 나의 강점을 확인해 보세요.';

if (typeof window !== 'undefined') {
  window.calculateRiderScores = calculateRiderScores;
  window.aggregateMMPFromLogs = aggregateMMPFromLogs;
  window.fetchAIProfileAnalysis = fetchAIProfileAnalysis;
  window.FALLBACK_AI_COMMENT = FALLBACK_AI_COMMENT;
}
