/**
 * 동적 FTP 산출 (Multi-Point Dynamic Weighted Model)
 * 6개 구간(1, 5, 10, 20, 40, 60분) PR 파워 데이터 기반 가중 평균 산출
 * @module dynamicFtpCalculation
 */

/** FTP/MMP 산출에서 제외할 활동 타입 (Run, Swim, Walk, TrailRun, WeightTraining) */
var EXCLUDED_ACTIVITY_TYPES = { run: 1, swim: 1, walk: 1, trailrun: 1, weighttraining: 1 };

/**
 * 로그가 사이클링(MMP/FTP 산출 대상)인지 판별
 * @param {Object} logData - 로그 객체
 * @returns {boolean}
 */
function isCyclingForFtp(logData) {
  var source = String(logData.source || '').toLowerCase();
  if (source !== 'strava') return true;
  var type = String(logData.activity_type || '').trim().toLowerCase();
  if (!type) return true;
  return !EXCLUDED_ACTIVITY_TYPES[type];
}

/** 구간별 설정: 분, 환산계수(eFTP), 신뢰도 가중치(W) */
var INTERVAL_CONFIG = [
  { minutes: 1,  field: 'max_1min_watts',  eFtpFactor: 0.45, weight: 0.05 },
  { minutes: 5,  field: 'max_5min_watts',  eFtpFactor: 0.82, weight: 0.10 },
  { minutes: 10, field: 'max_10min_watts', eFtpFactor: 0.90, weight: 0.15 },
  { minutes: 20, field: 'max_20min_watts', eFtpFactor: 0.95, weight: 0.40 },
  { minutes: 40, field: 'max_40min_watts', eFtpFactor: 0.98, weight: 0.20 },
  { minutes: 60, field: 'max_60min_watts', eFtpFactor: 1.00, weight: 0.10 }
];

/**
 * 로그 날짜 파싱 (YYYY-MM-DD)
 * @param {*} d - date 필드 (string, Date, Firestore Timestamp)
 * @returns {string|null}
 */
function parseLogDate(d) {
  if (!d) return null;
  if (d.toDate && typeof d.toDate === 'function') return d.toDate().toISOString().slice(0, 10);
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * 측정일 경과에 따른 시간 감쇠 가중치 (D)
 * - 30일 이내: 1.0
 * - 31~90일: 0.8
 * - 91~180일: 0.5
 * - 180일 초과: 0.2
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {number}
 */
function getTimeDecayWeight(dateStr) {
  if (!dateStr) return 0.2;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  var daysDiff = Math.floor((today - date) / (24 * 60 * 60 * 1000));
  if (daysDiff <= 30) return 1.0;
  if (daysDiff <= 90) return 0.8;
  if (daysDiff <= 180) return 0.5;
  return 0.2;
}

/**
 * 로그 배열에서 구간별 PR (최대 파워 + 달성일) 추출
 * @param {Array} logs - 훈련 로그 배열
 * @returns {Array<{minutes, field, power, dateStr, eFtp, weight, timeDecay}>}
 */
function getPrWithDatesFromLogs(logs) {
  var result = [];
  for (var i = 0; i < INTERVAL_CONFIG.length; i++) {
    var cfg = INTERVAL_CONFIG[i];
    var maxPower = 0;
    var achievedDate = null;
    for (var j = 0; j < logs.length; j++) {
      var log = logs[j];
      var p = Number(log[cfg.field]) || 0;
      if (p > maxPower) {
        maxPower = p;
        achievedDate = parseLogDate(log.date);
      }
    }
    result.push({
      minutes: cfg.minutes,
      field: cfg.field,
      power: maxPower,
      dateStr: achievedDate,
      eFtpFactor: cfg.eFtpFactor,
      weight: cfg.weight
    });
  }
  return result;
}

/**
 * 동적 FTP 산출 (Multi-Point Dynamic Weighted Model)
 * New_FTP = Sum(eFTP_t * W_t * D_t) / Sum(W_t * D_t)
 * @param {Array} logs - 훈련 로그 배열 (max_1min_watts, max_5min_watts 등 포함)
 * @returns {{ success: boolean, newFtp?: number, details?: Array, error?: string }}
 */
function calculateDynamicFtp(logs) {
  if (!Array.isArray(logs) || logs.length === 0) {
    return { success: false, error: '훈련 로그가 없습니다. 파워 데이터가 있는 훈련을 먼저 기록해 주세요.' };
  }
  var cyclingLogs = logs.filter(isCyclingForFtp);
  if (cyclingLogs.length === 0) {
    return { success: false, error: '사이클링 훈련 로그가 없습니다. Run/Swim/Walk/TrailRun은 FTP 산출에서 제외됩니다.' };
  }
  var prRows = getPrWithDatesFromLogs(cyclingLogs);
  var sumWeighted = 0;
  var sumWeights = 0;
  var usedCount = 0;
  var details = [];
  for (var i = 0; i < prRows.length; i++) {
    var row = prRows[i];
    if (row.power <= 0) {
      details.push({ minutes: row.minutes, power: 0, eFtp: 0, eFtpFactor: row.eFtpFactor, weight: row.weight, timeDecay: 0, used: false });
      continue;
    }
    var eFtp = row.power * row.eFtpFactor;
    var timeDecay = getTimeDecayWeight(row.dateStr);
    var w = row.weight * timeDecay;
    sumWeighted += eFtp * row.weight * timeDecay;
    sumWeights += w;
    usedCount++;
    details.push({
      minutes: row.minutes,
      power: row.power,
      dateStr: row.dateStr,
      eFtp: Math.round(eFtp * 10) / 10,
      eFtpFactor: row.eFtpFactor,
      weight: row.weight,
      timeDecay: timeDecay,
      used: true
    });
  }
  if (sumWeights <= 0 || usedCount === 0) {
    return { success: false, error: '6개 구간(1, 5, 10, 20, 40, 60분) 중 유효한 PR 파워 데이터가 없습니다. 파워미터가 있는 훈련을 기록해 주세요.' };
  }
  var newFtp = Math.round(sumWeighted / sumWeights);
  return { success: true, newFtp: newFtp, details: details };
}

if (typeof window !== 'undefined') {
  window.calculateDynamicFtp = calculateDynamicFtp;
  window.getPrWithDatesFromLogs = getPrWithDatesFromLogs;
  window.getTimeDecayWeight = getTimeDecayWeight;
  window.INTERVAL_CONFIG = INTERVAL_CONFIG;
  window.isCyclingForFtp = isCyclingForFtp;
  window.EXCLUDED_ACTIVITY_TYPES_FTP = EXCLUDED_ACTIVITY_TYPES;
}
