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
 * @returns {{ max_watts, max_1min_watts, max_5min_watts, max_10min_watts, max_20min_watts, max_40min_watts, max_60min_watts }}
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

  let max_watts = 0, max_1min = 0, max_5min = 0, max_10min = 0, max_20min = 0, max_40min = 0, max_60min = 0;
  logs.forEach((log) => {
    const ds = parseDate(log.date);
    if (!inRange(ds)) return;
    const mw = Number(log.max_watts) || 0;
    const m1 = Number(log.max_1min_watts) || 0;
    const m5 = Number(log.max_5min_watts) || 0;
    const m10 = Number(log.max_10min_watts) || 0;
    const m20 = Number(log.max_20min_watts) || 0;
    const m40 = Number(log.max_40min_watts) || 0;
    const m60 = Number(log.max_60min_watts) || 0;
    if (mw > max_watts) max_watts = mw;
    if (m1 > max_1min) max_1min = m1;
    if (m5 > max_5min) max_5min = m5;
    if (m10 > max_10min) max_10min = m10;
    if (m20 > max_20min) max_20min = m20;
    if (m40 > max_40min) max_40min = m40;
    if (m60 > max_60min) max_60min = m60;
  });

  return { max_watts, max_1min_watts: max_1min, max_5min_watts: max_5min, max_10min_watts: max_10min, max_20min_watts: max_20min, max_40min_watts: max_40min, max_60min_watts: max_60min };
}

/**
 * 로그 배열에서 기간별 심박(HR) 집계 (각 duration별 최대값)
 * @param {Array} logs - 훈련 로그 배열
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @returns {{ max_hr, max_hr_5sec, max_hr_1min, max_hr_5min, max_hr_10min, max_hr_20min, max_hr_40min, max_hr_60min }}
 */
function aggregateHRFromLogs(logs, fromDate, toDate) {
  const inRange = (dateStr) => dateStr && dateStr >= fromDate && dateStr <= toDate;
  const parseDate = (d) => {
    if (!d) return null;
    if (d.toDate && typeof d.toDate === 'function') return d.toDate().toISOString().slice(0, 10);
    if (typeof d === 'string') return d.slice(0, 10);
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return null;
  };

  let max_hr = 0, max_5sec = 0, max_1min = 0, max_5min = 0, max_10min = 0, max_20min = 0, max_40min = 0, max_60min = 0;
  logs.forEach((log) => {
    const ds = parseDate(log.date);
    if (!inRange(ds)) return;
    const mh = Number(log.max_hr) || 0;
    const m5s = Number(log.max_hr_5sec) || 0;
    const m1 = Number(log.max_hr_1min) || 0;
    const m5 = Number(log.max_hr_5min) || 0;
    const m10 = Number(log.max_hr_10min) || 0;
    const m20 = Number(log.max_hr_20min) || 0;
    const m40 = Number(log.max_hr_40min) || 0;
    const m60 = Number(log.max_hr_60min) || 0;
    if (mh > max_hr) max_hr = mh;
    if (m5s > max_5sec) max_5sec = m5s;
    if (m1 > max_1min) max_1min = m1;
    if (m5 > max_5min) max_5min = m5;
    if (m10 > max_10min) max_10min = m10;
    if (m20 > max_20min) max_20min = m20;
    if (m40 > max_40min) max_40min = m40;
    if (m60 > max_60min) max_60min = m60;
  });

  return { max_hr, max_hr_5sec: max_5sec, max_hr_1min: max_1min, max_hr_5min: max_5min, max_hr_10min: max_10min, max_hr_20min: max_20min, max_hr_40min: max_40min, max_hr_60min: max_60min };
}

/**
 * 최근 N일간 time_in_zones 집계 (파워 Z0~Z7, 심박 Z1~Z5)
 * @param {Array} logs - 훈련 로그 배열
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @returns {{ power: Object, hr: Object }}
 */
function aggregateTimeInZonesFromLogs(logs, fromDate, toDate) {
  const inRange = (dateStr) => dateStr && dateStr >= fromDate && dateStr <= toDate;
  const parseDate = (d) => {
    if (!d) return null;
    if (d.toDate && typeof d.toDate === 'function') return d.toDate().toISOString().slice(0, 10);
    if (typeof d === 'string') return d.slice(0, 10);
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return null;
  };

  const power = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
  const hr = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

  (logs || []).forEach((log) => {
    const ds = parseDate(log.date);
    if (!inRange(ds)) return;
    const tiz = log.time_in_zones;
    if (!tiz) return;
    if (tiz.power && typeof tiz.power === 'object') {
      ['z0', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'].forEach((k) => {
        power[k] = (power[k] || 0) + (Number(tiz.power[k]) || 0);
      });
    }
    if (tiz.hr && typeof tiz.hr === 'object') {
      ['z1', 'z2', 'z3', 'z4', 'z5'].forEach((k) => {
        hr[k] = (hr[k] || 0) + (Number(tiz.hr[k]) || 0);
      });
    }
  });

  return { power, hr };
}

/**
 * 최근 N주간 주별 MMP 집계 (파워 프로필 트렌드 차트용)
 * @param {Array} logs - 훈련 로그 배열
 * @param {number} numWeeks - 주 수 (기본 4)
 * @returns {Array<{ week, name, max_watts, max_1min_watts, max_5min_watts, max_20min_watts, max_60min_watts }>}
 */
function getWeeklyMMPFromLogs(logs, numWeeks) {
  numWeeks = numWeeks || 4;
  const today = new Date();
  const out = [];
  for (let w = numWeeks - 1; w >= 0; w--) {
    const end = new Date(today);
    end.setDate(today.getDate() - w * 7);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    const startStr = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0');
    const endStr = end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0');
    const agg = aggregateMMPFromLogs(logs, startStr, endStr);
    const name = (end.getMonth() + 1) + '/' + end.getDate();
    out.push({
      week: numWeeks - w,
      name: name,
      max_watts: agg.max_watts,
      max_1min_watts: agg.max_1min_watts,
      max_5min_watts: agg.max_5min_watts,
      max_20min_watts: agg.max_20min_watts,
      max_60min_watts: agg.max_60min_watts
    });
  }
  return out;
}

/**
 * 최근 N일간 구간별 MMP 집계 (최근 1개월 파워 그래프용)
 * 기본: 오늘 0시 기준 역산하여 (numDays)일을 numIntervals개 구간으로 나눔 — 예: 30일·6구간 = 구간당 5일, 각 구간 내 로그의 duration별 최댓값.
 * @param {Array} logs - 훈련 로그 배열
 * @param {number} numDays - 총 일수 (기본 30, 오늘 포함 역산)
 * @param {number} numIntervals - 구간 수 (기본 6)
 * @returns {Array<{ name, max_watts, max_1min_watts, max_5min_watts, max_10min_watts, max_20min_watts, max_40min_watts, max_60min_watts }>}
 */
function getIntervalMMPFromLogs(logs, numDays, numIntervals) {
  numDays = numDays || 30;
  numIntervals = numIntervals || 6;
  const intervalDays = Math.max(1, Math.floor(numDays / numIntervals));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = numIntervals - 1; i >= 0; i--) {
    const end = new Date(today);
    end.setDate(today.getDate() - i * intervalDays);
    const start = new Date(end);
    start.setDate(end.getDate() - intervalDays + 1);
    const startStr = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0');
    const endStr = end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0');
    const agg = aggregateMMPFromLogs(logs, startStr, endStr);
    const name = (start.getMonth() + 1) + '/' + start.getDate() + '~' + (end.getMonth() + 1) + '/' + end.getDate();
    out.push({
      name: name,
      max_watts: agg.max_watts,
      max_1min_watts: agg.max_1min_watts,
      max_5min_watts: agg.max_5min_watts,
      max_10min_watts: agg.max_10min_watts,
      max_20min_watts: agg.max_20min_watts,
      max_40min_watts: agg.max_40min_watts,
      max_60min_watts: agg.max_60min_watts
    });
  }
  return out;
}

/**
 * 최근 N일간 구간별 심박(HR) 집계 (최근 1개월 심박 그래프용)
 * 기본: 30일·6구간·구간당 5일, 구간 내 로그의 duration별 최댓값.
 * @param {Array} logs - 훈련 로그 배열
 * @param {number} numDays - 총 일수 (기본 30)
 * @param {number} numIntervals - 구간 수 (기본 6)
 * @returns {Array<{ name, max_hr, max_hr_5sec, max_hr_1min, max_hr_5min, max_hr_10min, max_hr_20min, max_hr_40min, max_hr_60min }>}
 */
function getIntervalHRFromLogs(logs, numDays, numIntervals) {
  numDays = numDays || 30;
  numIntervals = numIntervals || 6;
  const intervalDays = Math.max(1, Math.floor(numDays / numIntervals));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = numIntervals - 1; i >= 0; i--) {
    const end = new Date(today);
    end.setDate(today.getDate() - i * intervalDays);
    const start = new Date(end);
    start.setDate(end.getDate() - intervalDays + 1);
    const startStr = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0');
    const endStr = end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0');
    const agg = aggregateHRFromLogs(logs, startStr, endStr);
    const name = (start.getMonth() + 1) + '/' + start.getDate() + '~' + (end.getMonth() + 1) + '/' + end.getDate();
    out.push({
      name: name,
      max_hr: agg.max_hr,
      max_hr_5sec: agg.max_hr_5sec,
      max_hr_1min: agg.max_hr_1min,
      max_hr_5min: agg.max_hr_5min,
      max_hr_10min: agg.max_hr_10min,
      max_hr_20min: agg.max_hr_20min,
      max_hr_40min: agg.max_hr_40min,
      max_hr_60min: agg.max_hr_60min
    });
  }
  return out;
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

/** 저사양/모바일 감지: 타임아웃·재시도 연장용 */
function isLowSpecOrMobileForAI() {
  if (typeof navigator === 'undefined') return false;
  var ua = navigator.userAgent || '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  if (navigator.deviceMemory && navigator.deviceMemory <= 4) return true;
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return true;
  return false;
}

/**
 * AI 프로필 분석 코멘트 (Gemini API)
 * @param {Object} scores - { RSPT, TSPT, PCH, CLMB, TTST, ALLR }
 * @param {Object} options - { timeoutMs, maxRetries }
 * @returns {Promise<string>} AI 코멘트 텍스트
 */
async function fetchAIProfileAnalysis(scores, options = {}) {
  var isLowSpec = isLowSpecOrMobileForAI();
  var defaultTimeout = isLowSpec ? 25000 : 10000;
  var defaultRetries = isLowSpec ? 4 : 2;
  const timeoutMs = options.timeoutMs != null ? options.timeoutMs : defaultTimeout;
  const maxRetries = options.maxRetries != null ? options.maxRetries : defaultRetries;

  let apiKey;
  try {
    apiKey = localStorage.getItem('geminiApiKey');
  } catch (e) {
    apiKey = null;
  }
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  var s = scores || {};
  var RSPT = s.RSPT;
  var TSPT = s.TSPT;
  var PCH = s.PCH;
  var CLMB = s.CLMB;
  var TTST = s.TTST;
  var ALLR = s.ALLR;
  const systemPrompt = `당신은 전문 사이클링 코치입니다. 주어진 6가지 파워 프로필 점수(0~10점)를 바탕으로 라이더의 현재 강점과 보완해야 할 점을 분석해 주세요.

[필수 규칙]
- 반드시 완전한 문장으로 끝까지 작성하세요. 문장을 중간에 끊지 마세요.
- 강점 1~2문장, 보완점 1~2문장을 구체적으로 제시하세요. (필요 시 4~6문장까지 가능)
- 전문 용어를 최소화하고 누구나 이해하기 쉽게 작성하세요.
- 예리하고 실용적인 조언으로 사용자가 만족할 수 있도록 충분한 길이로 작성하세요.`;
  const userPrompt = `현재 내 사이클링 점수는 RSPT(로드 스프린트): ${RSPT}, TSPT(트랙 스프린트): ${TSPT}, PCH(펀처): ${PCH}, CLMB(클라이머): ${CLMB}, TTST(타임 트라이얼): ${TTST}, ALLR(올라운더): ${ALLR} 입니다. 강점과 보완점을 분석해 주세요.`;

  const modelName = localStorage.getItem('geminiModelName') || 'gemini-2.5-flash';
  const apiVersion = localStorage.getItem('geminiApiVersion') || 'v1beta';
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
    ],
    generationConfig: {
      maxOutputTokens: 4096,
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
      const candidate = data?.candidates?.[0];
      if (!candidate?.content?.parts?.length) {
        throw new Error('Gemini API 응답에 content가 없습니다.');
      }
      const parts = candidate.content.parts;
      let fullText = '';
      for (let i = 0; i < parts.length; i++) {
        const t = parts[i]?.text;
        if (t && typeof t === 'string') fullText += t;
      }
      if (!fullText.trim()) {
        throw new Error('Gemini API 응답이 비어있습니다.');
      }
      return fullText.trim();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        var delayMs = isLowSpec ? 1500 * (attempt + 1) : 800 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw lastErr || new Error('AI 분석 요청 실패');
}

/** 폴백 메시지 */
const FALLBACK_AI_COMMENT = '현재 AI 분석 서버가 혼잡하여 코멘트를 불러올 수 없습니다. 점수를 통해 나의 강점을 확인해 보세요.';

/** 대시보드 파워/심박 매트릭스: 랭킹 API(최근 30일 rolling, Asia/Seoul) */
const DASHBOARD_PEAK_RANKING_API = 'https://us-central1-stelvio-ai.cloudfunctions.net/getPeakPowerRanking';

function computeAvgWkgFromRankingByCategory(data) {
  if (!data || !data.success || !data.byCategory) return null;
  const cats = ['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];
  const seen = Object.create(null);
  let sum = 0;
  let n = 0;
  for (let c = 0; c < cats.length; c++) {
    const arr = data.byCategory[cats[c]] || [];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (!e || !e.userId) continue;
      if (seen[e.userId]) continue;
      seen[e.userId] = true;
      const wkg = Number(e.wkg);
      if (wkg > 0) {
        sum += wkg;
        n++;
      }
    }
  }
  if (n === 0) return null;
  return sum / n;
}

function fetchRankingForDurationRolling30(dur, userId, userWeightKg) {
  const params = new URLSearchParams({ period: 'rolling30', gender: 'all' });
  if (userId) params.set('uid', userId);
  params.set('duration', dur === 'max' ? 'max' : dur);
  const w = Number(userWeightKg) || 70;
  const uid = userId || null;
  return fetch(DASHBOARD_PEAK_RANKING_API + '?' + params.toString(), { method: 'GET', mode: 'cors' })
    .then(function(res) { return res.json().catch(function() { return {}; }); })
    .then(function(data) {
      const avgWkg = computeAvgWkgFromRankingByCategory(data);
      let cohortAvgHrBpm = null;
      if (data.cohortAvgHrBpm != null && !isNaN(Number(data.cohortAvgHrBpm))) {
        cohortAvgHrBpm = Number(data.cohortAvgHrBpm);
      }
      if (!data.success || !data.byCategory) {
        return { dur: dur, goals: null, avgWkg: avgWkg, cohortAvgHrBpm: cohortAvgHrBpm };
      }
      const cats = ['Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'];
      let firstWkg = 0;
      let shortTermWkg = 0;
      let myIdx = -1;
      let myWatts = 0;
      for (let c = 0; c < cats.length; c++) {
        const arr = data.byCategory[cats[c]] || [];
        if (arr.length === 0) continue;
        const idx = uid ? arr.findIndex(function(e) { return e.userId === uid; }) : -1;
        if (idx >= 0) {
          myIdx = idx;
          myWatts = Number(arr[idx].watts) || 0;
          firstWkg = Number(arr[0].wkg) || 0;
          shortTermWkg = idx > 0 ? (Number(arr[idx - 1].wkg) || 0) : 0;
          break;
        }
        if (arr.length > 0 && firstWkg === 0) firstWkg = Number(arr[0].wkg) || 0;
      }
      let g = null;
      if (myIdx >= 0) {
        const longTerm = firstWkg > 0 ? Math.round(firstWkg * w) : 0;
        let shortTerm = 0;
        const isFirst = myIdx === 0;
        if (isFirst) shortTerm = Math.round(myWatts * 1.03);
        else shortTerm = shortTermWkg > 0 ? Math.round(shortTermWkg * w) : Math.round(longTerm * 0.95);
        g = { longTerm: isFirst ? null : longTerm, shortTerm: shortTerm, myWatts: myWatts, isFirst: isFirst };
      } else if (firstWkg > 0) {
        g = { longTerm: Math.round(firstWkg * w), shortTerm: Math.round(firstWkg * w * 0.95), myWatts: 0, isFirst: false };
      }
      return { dur: dur, goals: g, avgWkg: avgWkg, cohortAvgHrBpm: cohortAvgHrBpm };
    })
    .catch(function(e) {
      console.warn('[fetchRankingForDurationRolling30]', dur, e);
      return { dur: dur, goals: null, avgWkg: null, cohortAvgHrBpm: null };
    });
}

/**
 * 파워 커브 목표 + duration별 코호트 평균 W/kg·심박(bpm). 기간: API period=rolling30 (= 오늘 기준 Seoul 최근 30일).
 */
function fetchDashboardPeakRankingCohort(userId, userWeight) {
  const durations = ['max', '1min', '5min', '10min', '20min', '40min', '60min'];
  const w = Number(userWeight) || 70;
  const uid = userId || null;
  const promises = durations.map(function(dur) { return fetchRankingForDurationRolling30(dur, uid, w); });
  return Promise.all(promises).then(function(results) {
    const goals = { max: {}, '1min': {}, '5min': {}, '10min': {}, '20min': {}, '40min': {}, '60min': {} };
    const avgWkgByDuration = {};
    const avgHrByDuration = {};
    results.forEach(function(r) {
      if (r && r.goals) goals[r.dur] = r.goals;
      if (r && r.avgWkg != null && !isNaN(r.avgWkg)) avgWkgByDuration[r.dur] = r.avgWkg;
      if (r && r.cohortAvgHrBpm != null && !isNaN(r.cohortAvgHrBpm)) avgHrByDuration[r.dur] = r.cohortAvgHrBpm;
    });
    return { goals: goals, avgWkgByDuration: avgWkgByDuration, avgHrByDuration: avgHrByDuration };
  });
}

if (typeof window !== 'undefined') {
  window.calculateRiderScores = calculateRiderScores;
  window.aggregateMMPFromLogs = aggregateMMPFromLogs;
  window.aggregateHRFromLogs = aggregateHRFromLogs;
  window.aggregateTimeInZonesFromLogs = aggregateTimeInZonesFromLogs;
  window.getWeeklyMMPFromLogs = getWeeklyMMPFromLogs;
  window.getIntervalMMPFromLogs = getIntervalMMPFromLogs;
  window.getIntervalHRFromLogs = getIntervalHRFromLogs;
  window.fetchAIProfileAnalysis = fetchAIProfileAnalysis;
  window.FALLBACK_AI_COMMENT = FALLBACK_AI_COMMENT;
  window.fetchDashboardPeakRankingCohort = fetchDashboardPeakRankingCohort;
}
