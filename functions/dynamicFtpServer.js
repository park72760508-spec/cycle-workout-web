/**
 * 동적 FTP 산출 (서버) — assets/js/dynamicFtpCalculation.js와 동일한 Multi-Point Dynamic
 * Weighted Model의 Node 포트.
 *
 * 왜 필요한가: TSS 계산에 프로필 FTP만 쓰면, 프로필 FTP를 낮게 설정(또는 갱신을 안 함)해둔
 * 사용자의 TSS가 과다 산정된다(TSS는 FTP 제곱에 반비례). 클라이언트 쪽엔 "나의 기록" 화면에
 * 진입할 때 사용자 FTP와 동적 FTP가 다르면 알려주는 안내 모달만 있고(수동 갱신 유도), TSS 계산
 * 자체엔 반영되지 않았다. 이 모듈은 라이딩을 서버에서 처리할 때 프로필 FTP와 "그 라이딩 시점
 * 기준" 동적 FTP 중 더 높은 값을 실제 TSS 산출에 사용하기 위한 것.
 *
 * 시점 정합성: 동적 FTP는 반드시 해당 라이딩 "이전(포함)" 기록만으로 계산해야 한다 — 미래에
 * 달성한 PR을 과거 라이딩에 소급 적용하면 그 라이딩 자체보다 더 나중에 나온 정보로 과거를
 * 다시 쓰는 셈이라 시점 정합성이 깨진다. 클라이언트 버전은 "오늘" 기준 감쇠만 계산하므로
 * 그대로 재사용할 수 없어 참조일(referenceDateStr)을 파라미터로 받도록 재작성했다.
 */

/** FTP/MMP 산출에서 제외할 활동 타입 (Run, Swim, Walk, TrailRun, WeightTraining) */
const EXCLUDED_ACTIVITY_TYPES = { run: 1, swim: 1, walk: 1, trailrun: 1, weighttraining: 1 };

/** 구간별 설정: 분, 환산계수(eFTP), 신뢰도 가중치(W) — 클라이언트 dynamicFtpCalculation.js와 동일 */
const INTERVAL_CONFIG = [
  { minutes: 1, field: "max_1min_watts", eFtpFactor: 0.45, weight: 0.05 },
  { minutes: 5, field: "max_5min_watts", eFtpFactor: 0.82, weight: 0.10 },
  { minutes: 10, field: "max_10min_watts", eFtpFactor: 0.90, weight: 0.15 },
  { minutes: 20, field: "max_20min_watts", eFtpFactor: 0.95, weight: 0.40 },
  { minutes: 40, field: "max_40min_watts", eFtpFactor: 0.98, weight: 0.20 },
  { minutes: 60, field: "max_60min_watts", eFtpFactor: 1.00, weight: 0.10 },
];

/**
 * 로그가 사이클링(FTP 산출 대상)인지 판별 — 클라이언트 isCyclingForFtp와 동일 규칙.
 * @param {object} logData
 * @returns {boolean}
 */
function isCyclingForFtp(logData) {
  const source = String(logData.source || "").toLowerCase();
  if (source !== "strava") return true;
  const type = String(logData.activity_type || "").trim().toLowerCase();
  if (!type) return true;
  return !EXCLUDED_ACTIVITY_TYPES[type];
}

function parseLogDate(d) {
  if (!d) return null;
  if (d.toDate && typeof d.toDate === "function") return d.toDate().toISOString().slice(0, 10);
  if (typeof d === "string") return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * referenceDateStr(라이딩 시점) 기준 경과일에 따른 시간 감쇠 가중치 (D).
 * - 30일 이내: 1.0 / 31~90일: 0.8 / 91~180일: 0.5 / 180일 초과: 0.2
 * @param {string} dateStr PR 달성일
 * @param {string} referenceDateStr 기준일(라이딩 날짜)
 */
function getTimeDecayWeight(dateStr, referenceDateStr) {
  if (!dateStr || !referenceDateStr) return 0.2;
  const ref = new Date(`${referenceDateStr}T00:00:00`);
  const date = new Date(`${dateStr}T00:00:00`);
  const daysDiff = Math.floor((ref.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (daysDiff < 0) return 0; // 라이딩 시점 이후 기록은 애초에 호출부에서 걸러지지만, 방어적으로 0 처리
  if (daysDiff <= 30) return 1.0;
  if (daysDiff <= 90) return 0.8;
  if (daysDiff <= 180) return 0.5;
  return 0.2;
}

/**
 * 로그 배열에서 구간별 PR (최대 파워 + 달성일) 추출.
 * @param {object[]} logs
 */
function getPrWithDatesFromLogs(logs) {
  const result = [];
  for (const cfg of INTERVAL_CONFIG) {
    let maxPower = 0;
    let achievedDate = null;
    for (const log of logs) {
      const p = Number(log[cfg.field]) || 0;
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
      weight: cfg.weight,
    });
  }
  return result;
}

/**
 * 동적 FTP 산출 (Multi-Point Dynamic Weighted Model)
 * New_FTP = Sum(eFTP_t * W_t * D_t) / Sum(W_t * D_t)
 * @param {object[]} logs referenceDateStr 이전(포함) 훈련 로그 배열
 * @param {string} referenceDateStr 기준일(YYYY-MM-DD) — 이 날짜 기준으로 시간 감쇠 계산
 * @returns {{ success: boolean, newFtp?: number, error?: string }}
 */
function calculateDynamicFtp(logs, referenceDateStr) {
  if (!Array.isArray(logs) || logs.length === 0) {
    return { success: false, error: "훈련 로그가 없습니다." };
  }
  const cyclingLogs = logs.filter(isCyclingForFtp);
  if (cyclingLogs.length === 0) {
    return { success: false, error: "사이클링 훈련 로그가 없습니다." };
  }
  const prRows = getPrWithDatesFromLogs(cyclingLogs);
  let sumWeighted = 0;
  let sumWeights = 0;
  let usedCount = 0;
  for (const row of prRows) {
    if (row.power <= 0) continue;
    const eFtp = row.power * row.eFtpFactor;
    const timeDecay = getTimeDecayWeight(row.dateStr, referenceDateStr);
    const w = row.weight * timeDecay;
    sumWeighted += eFtp * row.weight * timeDecay;
    sumWeights += w;
    usedCount++;
  }
  if (sumWeights <= 0 || usedCount === 0) {
    return { success: false, error: "유효한 PR 파워 데이터가 없습니다." };
  }
  return { success: true, newFtp: Math.round(sumWeighted / sumWeights) };
}

module.exports = {
  EXCLUDED_ACTIVITY_TYPES,
  INTERVAL_CONFIG,
  isCyclingForFtp,
  getTimeDecayWeight,
  getPrWithDatesFromLogs,
  calculateDynamicFtp,
};
