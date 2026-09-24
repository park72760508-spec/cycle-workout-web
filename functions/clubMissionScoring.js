/**
 * 클럽 챌린지 미션 — 달성 점수 산출(순수 함수, 단위 테스트 대상).
 *
 * 단계(미션 1개) 달성 점수 S (0~100) = 인터벌 달성률 A × W/kg 가중치 F
 *  - A: 워밍업·쿨다운·휴식 세그먼트를 뺀 "인터벌" 세그먼트의 (실제 평균 W ÷ 목표 W)를
 *       세그먼트별 100% 상한으로 자른 뒤 시간(초) 가중 평균. 목표 W = FTP × 목표%.
 *       구간 목표(ftp_pctz "56~75")는 하한을 목표로, 램프는 시작·끝 평균을 목표로 본다.
 *  - F: 인터벌 평균 W/kg 기준 0.80(2.0 W/kg 이하) ~ 1.00(4.0 W/kg 이상) 선형.
 *
 * 순위 점수 T (0~100) = 40 × 수행률(완료 단계 ÷ 전체 단계) + 60 × (단계 점수 합 ÷ 전체 단계)
 *  - 미완료 단계는 0점 → 성실도(수행률)와 변별력(달성 점수)을 함께 반영.
 *  - 동점: 완료 단계 수 ↓ → 평균 달성 점수 ↓ → 마지막 완료 시각 ↑(먼저 끝낸 사람).
 */

const WKG_FLOOR = 2.0;
const WKG_FULL = 4.0;
const WKG_FACTOR_MIN = 0.8;
const RATE_WEIGHT = 40;
const SCORE_WEIGHT = 60;
const EXCLUDED_TYPES = new Set(["warmup", "cooldown", "rest"]);

/** workoutManager.js normalizeSegmentType 과 동일 규칙 */
function normalizeSegmentType(type) {
  const t = String(type || "").toLowerCase();
  if (t === "warmup" || t === "warm-up" || t === "warm_up") return "warmup";
  if (t === "cooldown" || t === "cool-down" || t === "cool_down") return "cooldown";
  if (t === "rest" || t === "recovery") return "rest";
  return "interval";
}

function parseNum(v) {
  const n = Number(String(v == null ? "" : v).trim());
  return isFinite(n) ? n : NaN;
}

/**
 * 세그먼트 목표 FTP% — 파워 목표가 없으면(cadence_rpm 등) NaN.
 * @param {{ target_type?: string, target_value?: any, ramp?: string, ramp_to_value?: any }} seg
 */
function segmentTargetFtpPct(seg) {
  if (!seg) return NaN;
  const type = String(seg.target_type || "ftp_pct").toLowerCase();
  if (type === "cadence_rpm") return NaN;
  const raw = seg.target_value;
  let pct;
  if (type === "dual" || type === "ftp_pctz") {
    const s = String(raw == null ? "" : raw);
    const parts = s.split(/[~/]/).map((p) => parseNum(p)).filter((n) => isFinite(n));
    // dual "100~120" = FTP%·RPM → 앞값, ftp_pctz "56~75" = 구간 → 하한(구간 진입 = 목표 달성)
    pct = parts.length ? parts[0] : NaN;
  } else {
    pct = parseNum(raw);
  }
  if (!(pct > 0)) return NaN;
  if (seg.ramp === "linear") {
    const to = parseNum(seg.ramp_to_value);
    if (to > 0) pct = (pct + to) / 2;
  }
  return pct;
}

function wkgFactor(wkg) {
  if (!(wkg > 0)) return WKG_FACTOR_MIN;
  const t = Math.min(1, Math.max(0, (wkg - WKG_FLOOR) / (WKG_FULL - WKG_FLOOR)));
  return WKG_FACTOR_MIN + (1 - WKG_FACTOR_MIN) * t;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * @param {object[]} segments 워크아웃 세그먼트(순서대로)
 * @param {(number|null)[]|null} segmentAvgWatts 훈련 로그 segment_avg_watts (segments 와 같은 순서)
 * @param {number} ftp 훈련 당시 FTP(W)
 * @param {number} weightKg 체중
 * @param {number} [fallbackAvgWatts] segment_avg_watts 가 없을 때 쓰는 전체 평균 파워
 * @returns {{ intervalAchievement: number, intervalAvgWatts: number, wkg: number, wkgFactor: number,
 *   score: number, method: 'segments'|'overall' } | null}
 */
function computeStepAchievement(segments, segmentAvgWatts, ftp, weightKg, fallbackAvgWatts) {
  const ftpW = Number(ftp);
  if (!Array.isArray(segments) || !segments.length || !(ftpW > 0)) return null;

  const all = segments.map((seg, i) => ({
    type: normalizeSegmentType(seg && seg.segment_type),
    dur: Math.max(0, Number(seg && (seg.duration_sec != null ? seg.duration_sec : seg.duration)) || 0),
    targetW: (segmentTargetFtpPct(seg) / 100) * ftpW,
    actualW: Array.isArray(segmentAvgWatts) ? Number(segmentAvgWatts[i]) : NaN,
  }));
  const powered = all.filter((s) => s.dur > 0 && s.targetW > 0);
  let intervals = powered.filter((s) => !EXCLUDED_TYPES.has(s.type));
  // 인터벌로 분류된 세그먼트가 없으면(전부 휴식형 등) 워밍업·쿨다운만 제외
  if (!intervals.length) intervals = powered.filter((s) => s.type !== "warmup" && s.type !== "cooldown");
  if (!intervals.length) intervals = powered;
  if (!intervals.length) return null;

  const totalDur = intervals.reduce((a, s) => a + s.dur, 0);
  const hasSegmentPower = intervals.some((s) => isFinite(s.actualW) && s.actualW >= 0);
  let achievement;
  let avgW;
  let method;
  if (hasSegmentPower) {
    let ratioSum = 0;
    let wattSum = 0;
    intervals.forEach((s) => {
      const actual = isFinite(s.actualW) && s.actualW >= 0 ? s.actualW : 0;
      ratioSum += s.dur * Math.min(1, actual / s.targetW);
      wattSum += s.dur * actual;
    });
    achievement = ratioSum / totalDur;
    avgW = wattSum / totalDur;
    method = "segments";
  } else {
    const overall = Number(fallbackAvgWatts);
    if (!(overall > 0)) return null;
    const targetAvg = powered.reduce((a, s) => a + s.dur * s.targetW, 0) / powered.reduce((a, s) => a + s.dur, 0);
    achievement = Math.min(1, overall / targetAvg);
    avgW = overall;
    method = "overall";
  }

  const kg = Number(weightKg);
  const wkg = kg > 0 ? avgW / kg : 0;
  const factor = wkgFactor(wkg);
  return {
    intervalAchievement: round1(achievement * 100),
    intervalAvgWatts: Math.round(avgW),
    wkg: Math.round(wkg * 100) / 100,
    wkgFactor: Math.round(factor * 1000) / 1000,
    score: round1(achievement * factor * 100),
    method,
  };
}

/**
 * @param {number} totalSteps 미션 전체 단계 수
 * @param {{ userId: string, stepScores: (number|null)[], lastCompletedAt?: string }[]} users
 * @returns 순위 점수 내림차순 배열(rank 포함)
 */
function rankMissionUsers(totalSteps, users) {
  const n = Math.max(1, Number(totalSteps) || 1);
  const rows = (users || []).map((u) => {
    const scores = (u.stepScores || []).map((s) => (isFinite(Number(s)) ? Number(s) : 0));
    const completed = (u.stepScores || []).length;
    const scoreSum = scores.reduce((a, b) => a + b, 0);
    const rate = Math.min(1, completed / n);
    return Object.assign({}, u, {
      completed,
      completionRate: round1(rate * 100),
      avgStepScore: completed ? round1(scoreSum / completed) : 0,
      total: round1(RATE_WEIGHT * rate + SCORE_WEIGHT * (scoreSum / n / 100)),
    });
  });
  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.completed !== a.completed) return b.completed - a.completed;
    if (b.avgStepScore !== a.avgStepScore) return b.avgStepScore - a.avgStepScore;
    return String(a.lastCompletedAt || "").localeCompare(String(b.lastCompletedAt || ""));
  });
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

module.exports = {
  computeStepAchievement,
  rankMissionUsers,
  segmentTargetFtpPct,
  wkgFactor,
  normalizeSegmentType,
};
