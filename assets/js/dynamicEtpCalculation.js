/**
 * 동적 eTP 산출 (Multi-Point Dynamic Weighted Model — Running)
 * 6개 거리 구간(1k, 3k, 5k, 7k, 10k, 20k) PR 페이스 기반 10k 역치 페이스 추정
 * @module dynamicEtpCalculation
 */

var RUN_ACTIVITY_TYPES = { run: 1, virtualrun: 1, trailrun: 1 };

/** 구간별 설정: 거리 라벨, speed 필드, 10k 역치 환산계수(C), 신뢰도(W) */
var ETP_INTERVAL_CONFIG = [
  { label: '1k', speedField: 'speed_1k', convertFactor: 1.18, weight: 0.05 },
  { label: '3k', speedField: 'speed_3k', convertFactor: 1.12, weight: 0.05 },
  { label: '5k', speedField: 'speed_5k', convertFactor: 1.06, weight: 0.20 },
  { label: '7k', speedField: 'speed_7k', convertFactor: 1.03, weight: 0.20 },
  { label: '10k', speedField: 'speed_10k', convertFactor: 1.00, weight: 0.40 },
  { label: '20k', speedField: 'speed_20k', convertFactor: 0.98, weight: 0.10 }
];

function parseActivityDate(d) {
  if (!d) return null;
  if (d.toDate && typeof d.toDate === 'function') return d.toDate().toISOString().slice(0, 10);
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return null;
}

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

function speedMsToSecPerKm(speedMs) {
  var s = Number(speedMs);
  if (!isFinite(s) || s <= 0) return null;
  return 1000 / s;
}

function formatPaceMmSs(secPerKm) {
  var sec = Math.round(Number(secPerKm));
  if (!isFinite(sec) || sec <= 0) return '-';
  var min = Math.floor(sec / 60);
  var s = sec % 60;
  return min + ':' + (s < 10 ? '0' : '') + s;
}

function formatPaceSummary(secPerKm) {
  var sec = Math.round(Number(secPerKm));
  if (!isFinite(sec) || sec <= 0) return '-';
  var min = Math.floor(sec / 60);
  var s = sec % 60;
  return min + '분 ' + (s < 10 ? '0' : '') + s + '초/km';
}

function isRunEffortRecord(row) {
  if (!row) return false;
  var type = String(row.activity_type || '').trim().toLowerCase();
  if (type && RUN_ACTIVITY_TYPES[type]) return true;
  if (row.source && String(row.source).toLowerCase() === 'strava' && !type) return true;
  return !type;
}

/**
 * effort 레코드 배열에서 구간별 PR(최단 페이스 sec/km + 달성일) 추출
 * @param {Array} efforts
 * @returns {Array}
 */
function getPacePrWithDatesFromEfforts(efforts) {
  var result = [];
  for (var i = 0; i < ETP_INTERVAL_CONFIG.length; i++) {
    var cfg = ETP_INTERVAL_CONFIG[i];
    var bestSec = null;
    var achievedDate = null;
    for (var j = 0; j < efforts.length; j++) {
      var row = efforts[j];
      if (!isRunEffortRecord(row)) continue;
      var sec = speedMsToSecPerKm(row[cfg.speedField]);
      if (sec == null) continue;
      if (bestSec == null || sec < bestSec) {
        bestSec = sec;
        achievedDate = parseActivityDate(row.activity_date || row.date);
      }
    }
    result.push({
      label: cfg.label,
      speedField: cfg.speedField,
      paceSec: bestSec,
      dateStr: achievedDate,
      convertFactor: cfg.convertFactor,
      weight: cfg.weight
    });
  }
  return result;
}

/**
 * 동적 eTP 산출
 * eTP = Sum((P_i * C_i) * W_i * D_i) / Sum(W_i * D_i)  [sec/km]
 * @param {Array} efforts - run_activity_efforts + activity_date
 * @returns {{ success: boolean, newEtpSec?: number, newEtpDisplay?: string, newEtpSummary?: string, details?: Array, error?: string }}
 */
function calculateDynamicEtp(efforts) {
  if (!Array.isArray(efforts) || efforts.length === 0) {
    return { success: false, error: '러닝 구간 기록이 없습니다. Strava 러닝 활동을 먼저 동기화해 주세요.' };
  }
  var runEfforts = efforts.filter(isRunEffortRecord);
  if (runEfforts.length === 0) {
    return { success: false, error: '러닝(Run) 활동 구간 데이터가 없습니다.' };
  }
  var prRows = getPacePrWithDatesFromEfforts(runEfforts);
  var sumWeighted = 0;
  var sumWeights = 0;
  var usedCount = 0;
  var details = [];
  for (var i = 0; i < prRows.length; i++) {
    var row = prRows[i];
    if (row.paceSec == null || row.paceSec <= 0) {
      details.push({
        label: row.label,
        paceDisplay: '-',
        paceSec: 0,
        dateStr: row.dateStr,
        adjustedPaceSec: 0,
        convertFactor: row.convertFactor,
        weight: row.weight,
        timeDecay: 0,
        appliedWeight: 0,
        used: false
      });
      continue;
    }
    var adjustedPaceSec = row.paceSec * row.convertFactor;
    var timeDecay = getTimeDecayWeight(row.dateStr);
    var appliedWeight = row.weight * timeDecay;
    sumWeighted += adjustedPaceSec * row.weight * timeDecay;
    sumWeights += appliedWeight;
    usedCount++;
    details.push({
      label: row.label,
      paceDisplay: formatPaceMmSs(row.paceSec),
      paceSec: Math.round(row.paceSec),
      dateStr: row.dateStr,
      adjustedPaceSec: Math.round(adjustedPaceSec),
      adjustedPaceDisplay: formatPaceMmSs(adjustedPaceSec),
      convertFactor: row.convertFactor,
      weight: row.weight,
      timeDecay: timeDecay,
      appliedWeight: Math.round(appliedWeight * 100) / 100,
      used: true
    });
  }
  if (sumWeights <= 0 || usedCount === 0) {
    return {
      success: false,
      error: '6개 구간(1k, 3k, 5k, 7k, 10k, 20k) 중 유효한 PR 페이스 데이터가 없습니다. 러닝 기록을 동기화해 주세요.'
    };
  }
  var newEtpSec = Math.round(sumWeighted / sumWeights);
  return {
    success: true,
    newEtpSec: newEtpSec,
    newEtpDisplay: formatPaceMmSs(newEtpSec) + '/km',
    newEtpSummary: formatPaceSummary(newEtpSec),
    details: details
  };
}

if (typeof window !== 'undefined') {
  window.calculateDynamicEtp = calculateDynamicEtp;
  window.getPacePrWithDatesFromEfforts = getPacePrWithDatesFromEfforts;
  window.ETP_INTERVAL_CONFIG = ETP_INTERVAL_CONFIG;
  window.getEtpTimeDecayWeight = getTimeDecayWeight;
}
