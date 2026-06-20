/**
 * Andrew Coggan PMC (Performance Management Chart) — RUN Strava 로그 파이프라인
 * CTL(체력) · ATL(피로) · TSB(컨디션) · 일일 TSS/rTSS/hrTSS
 */

export interface PeakPerformanceSegment {
  pace?: string | null;
  calculated_pace?: string | null;
}

export interface StravaRunLog {
  /** YYYY-MM-DD 또는 ISO datetime */
  date?: string | null;
  completed_at?: string | null;
  activity_type?: string | null;
  tss?: number | null;
  /** 초 */
  duration_sec?: number | null;
  moving_time?: number | null;
  /** 미터 */
  distance_m?: number | null;
  distance?: number | null;
  /** m/s */
  average_speed?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  peak_performances?: Record<string, PeakPerformanceSegment | null> | null;
}

export interface PmcUserProfile {
  /** 역치 페이스 (초/km) */
  threshold_pace_sec?: number | null;
  threshold_pace?: string | null;
  /** LTHR (bpm) */
  lthr?: number | null;
  threshold_hr?: number | null;
  max_hr?: number | null;
  /** 90일 peak — fTP 추정용 */
  peak_performances?: Record<string, PeakPerformanceSegment | null> | null;
}

export interface PmcCalculatorOptions {
  /** 차트에 노출할 일수 (기본 30) */
  chartDays?: number;
  /** CTL 수렴용 선행 누적 일수 (기본 42) */
  buildupDays?: number;
  /** CTL 시상수 (기본 42) */
  ctlTimeConstant?: number;
  /** ATL 시상수 (기본 7) */
  atlTimeConstant?: number;
  /** 기준일 (기본: 오늘 KST 자정) */
  endDate?: Date;
  /** 동일일 Strava 우선 dedupe 후 합산 — 호출 전 처리 권장 */
  maxDailyTss?: number;
}

export interface PmcChartPoint {
  date: string;
  fitness_ctl: number;
  fatigue_atl: number;
  form_tsb: number;
  daily_tss: number;
}

export type TsbZoneId =
  | 'freshness'
  | 'optimal'
  | 'overreaching'
  | 'overtraining';

export interface TsbTrainingFeedback {
  zone: TsbZoneId;
  title: string;
  message: string;
  tsb: number;
}

const DEFAULT_CTL_TAU = 42;
const DEFAULT_ATL_TAU = 7;
const DEFAULT_BUILDUP = 42;
const DEFAULT_CHART_DAYS = 30;
const DEFAULT_MAX_TSS = 1200;
const RIEGEL_K = 1.06;
const INFER_WEIGHTS: Record<string, number> = { '7k': 0.5, '5k': 0.35, '3k': 0.15 };
const INFER_DIST_KM: Record<string, number> = { '3k': 3, '5k': 5, '7k': 7, '10k': 10 };

const RUN_TYPES = new Set(['run', 'trailrun', 'virtualrun']);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** KST 기준 YYYY-MM-DD */
export function toSeoulYmd(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
  } catch {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
}

function addDaysYmd(ymd: string, delta: number): string {
  const p = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0]!, p[1]! - 1, p[2]!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function parseLogYmd(log: StravaRunLog): string | null {
  const raw = log.date ?? log.completed_at;
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return toSeoulYmd(d);
}

export function isRunActivity(log: StravaRunLog): boolean {
  const t = String(log.activity_type ?? 'run').trim().toLowerCase();
  return RUN_TYPES.has(t);
}

/** "5:30" / "5:30 min/km" → sec/km */
export function parsePaceToSecPerKm(pace: string | null | undefined): number | null {
  if (pace == null) return null;
  const s = String(pace).replace(/\s*min\/1?km\s*$/i, '').trim();
  if (!s || s === '—' || s === '-') return null;
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.length >= 2 && parts.every((x) => isFinite(x))) {
      return parts[0]! * 60 + parts[1]!;
    }
  }
  const n = Number(s);
  return isFinite(n) && n > 0 ? n : null;
}

function getPaceSecFromSegment(seg: PeakPerformanceSegment | null | undefined): number | null {
  if (!seg) return null;
  return parsePaceToSecPerKm(seg.pace ?? seg.calculated_pace ?? null);
}

function riegelPredictTotalSec(timeSec: number, fromKm: number, toKm: number): number | null {
  if (!isFinite(timeSec) || timeSec <= 0 || fromKm <= 0 || toKm <= 0) return null;
  return timeSec * Math.pow(toKm / fromKm, RIEGEL_K);
}

/** 10k 직접 → 없으면 7k/5k/3k 리겔 가중(50/35/15%) */
export function inferThresholdPaceSecPerKm(
  peaks: Record<string, PeakPerformanceSegment | null> | null | undefined,
): number | null {
  const pp = peaks ?? {};
  const direct10k = getPaceSecFromSegment(pp['10k'] ?? null);
  if (direct10k != null && direct10k > 0) return direct10k;

  const parts: { weight: number; predicted10kSec: number }[] = [];
  for (const distKey of ['7k', '5k', '3k'] as const) {
    const paceSec = getPaceSecFromSegment(pp[distKey] ?? null);
    const distKm = INFER_DIST_KM[distKey];
    if (paceSec == null || !distKm) continue;
    const predicted = riegelPredictTotalSec(paceSec * distKm, distKm, 10);
    if (predicted == null || !isFinite(predicted) || predicted <= 0) continue;
    parts.push({ weight: INFER_WEIGHTS[distKey]!, predicted10kSec: predicted });
  }
  if (!parts.length) return null;
  const wSum = parts.reduce((a, p) => a + p.weight, 0);
  const t10 = parts.reduce((a, p) => a + p.predicted10kSec * (p.weight / wSum), 0);
  return t10 / 10;
}

export function resolveThresholdPaceSec(
  profile: PmcUserProfile | null | undefined,
  logs: StravaRunLog[],
): number | null {
  const p = profile ?? {};
  if (p.threshold_pace_sec != null && isFinite(Number(p.threshold_pace_sec)) && Number(p.threshold_pace_sec) > 0) {
    return Number(p.threshold_pace_sec);
  }
  if (p.threshold_pace) {
    const parsed = parsePaceToSecPerKm(p.threshold_pace);
    if (parsed != null && parsed > 0) return parsed;
  }
  const fromProfilePeaks = inferThresholdPaceSecPerKm(p.peak_performances ?? null);
  if (fromProfilePeaks != null) return fromProfilePeaks;

  for (const log of logs) {
    const fromLog = inferThresholdPaceSecPerKm(log.peak_performances ?? null);
    if (fromLog != null) return fromLog;
  }
  return null;
}

export function resolveLthr(profile: PmcUserProfile | null | undefined): number | null {
  const p = profile ?? {};
  if (p.lthr != null && isFinite(Number(p.lthr)) && Number(p.lthr) > 0) return Number(p.lthr);
  if (p.threshold_hr != null && isFinite(Number(p.threshold_hr)) && Number(p.threshold_hr) > 0) {
    return Number(p.threshold_hr);
  }
  if (p.max_hr != null && isFinite(Number(p.max_hr)) && Number(p.max_hr) > 0) {
    return Math.round(Number(p.max_hr) * 0.92);
  }
  return null;
}

function sanitizeTss(val: number | null | undefined, maxDaily: number): number {
  const n = Number(val);
  if (!isFinite(n) || n <= 0 || n >= maxDaily) return 0;
  return round1(n);
}

function logDurationSec(log: StravaRunLog): number {
  const d = Number(log.duration_sec ?? log.moving_time ?? 0);
  return isFinite(d) && d > 0 ? d : 0;
}

function logAvgSpeedMps(log: StravaRunLog): number | null {
  const direct = Number(log.average_speed);
  if (isFinite(direct) && direct > 0) return direct;
  const dur = logDurationSec(log);
  let distM = Number(log.distance_m ?? log.distance ?? 0);
  if ((!distM || distM <= 0) && log.distance != null) {
    distM = Number(log.distance) * 1000;
  }
  if (dur > 0 && distM > 0) return distM / dur;
  return null;
}

/** fTP 역치 페이스(m/s) */
export function thresholdPaceToSpeedMps(secPerKm: number): number {
  return 1000 / secPerKm;
}

/**
 * rTSS = (duration * avgSpeed * IF) / (fTP_speed * 3600) * 100
 * IF = avgSpeed / fTP_speed
 */
export function calculateRtssFromPace(
  durationSec: number,
  avgSpeedMps: number,
  ftpSpeedMps: number,
): number {
  if (durationSec <= 0 || avgSpeedMps <= 0 || ftpSpeedMps <= 0) return 0;
  const intensityFactor = avgSpeedMps / ftpSpeedMps;
  const rtss = (durationSec * avgSpeedMps * intensityFactor) / (ftpSpeedMps * 3600) * 100;
  return round1(Math.max(0, Math.min(500, rtss)));
}

/**
 * hrTSS = (duration * avgHR * IF) / (LTHR * 3600) * 100
 * IF = avgHR / LTHR
 */
export function calculateHrTss(durationSec: number, avgHr: number, lthr: number): number {
  if (durationSec <= 0 || avgHr <= 0 || lthr <= 0) return 0;
  const intensityFactor = avgHr / lthr;
  const hrTss = (durationSec * avgHr * intensityFactor) / (lthr * 3600) * 100;
  return round1(Math.max(0, Math.min(500, hrTss)));
}

/** 단일 세션 TSS — 정식 TSS → rTSS → hrTSS 순 fallback */
export function resolveSessionTss(
  log: StravaRunLog,
  profile: PmcUserProfile | null | undefined,
  thresholdPaceSec: number | null,
  lthr: number | null,
  maxDaily: number,
): number {
  const official = sanitizeTss(log.tss, maxDaily);
  if (official > 0) return official;

  const durationSec = logDurationSec(log);
  if (durationSec <= 0) return 0;

  const avgSpeed = logAvgSpeedMps(log);
  if (avgSpeed != null && thresholdPaceSec != null && thresholdPaceSec > 0) {
    const ftpSpeed = thresholdPaceToSpeedMps(thresholdPaceSec);
    const rtss = calculateRtssFromPace(durationSec, avgSpeed, ftpSpeed);
    if (rtss > 0) return sanitizeTss(rtss, maxDaily);
  }

  const avgHr = Number(log.average_heartrate);
  if (isFinite(avgHr) && avgHr > 0 && lthr != null && lthr > 0) {
    const hrTss = calculateHrTss(durationSec, avgHr, lthr);
    if (hrTss > 0) return sanitizeTss(hrTss, maxDaily);
  }

  return 0;
}

/** 일별 TSS 합산 (동일일 다중 세션 합) */
export function buildDailyTssMap(
  logs: StravaRunLog[],
  profile: PmcUserProfile | null | undefined,
  opts: PmcCalculatorOptions = {},
): Record<string, number> {
  const maxDaily = opts.maxDailyTss ?? DEFAULT_MAX_TSS;
  const thresholdPaceSec = resolveThresholdPaceSec(profile, logs);
  const lthr = resolveLthr(profile);
  const byDate: Record<string, number> = {};

  for (const log of logs) {
    if (!isRunActivity(log)) continue;
    const ymd = parseLogYmd(log);
    if (!ymd) continue;
    const tss = resolveSessionTss(log, profile, thresholdPaceSec, lthr, maxDaily);
    if (tss <= 0) continue;
    byDate[ymd] = round1((byDate[ymd] ?? 0) + tss);
  }
  return byDate;
}

function enumerateDates(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  let cur = startYmd;
  while (cur <= endYmd) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

/**
 * Coggan EWMA PMC 시계열 (buildup + chart 구간 전체)
 * TSB_today = CTL_yesterday - ATL_yesterday
 */
export function computePmcSeries(
  dailyTss: Record<string, number>,
  opts: PmcCalculatorOptions = {},
): PmcChartPoint[] {
  const chartDays = opts.chartDays ?? DEFAULT_CHART_DAYS;
  const buildupDays = opts.buildupDays ?? DEFAULT_BUILDUP;
  const ctlTau = opts.ctlTimeConstant ?? DEFAULT_CTL_TAU;
  const atlTau = opts.atlTimeConstant ?? DEFAULT_ATL_TAU;
  const endYmd = opts.endDate ? toSeoulYmd(opts.endDate) : toSeoulYmd();
  const startYmd = addDaysYmd(endYmd, -(chartDays + buildupDays - 1));

  const dates = enumerateDates(startYmd, endYmd);
  let ctl = 0;
  let atl = 0;
  const series: PmcChartPoint[] = [];

  for (const ymd of dates) {
    const tsb = round1(ctl - atl);
    const tssToday = round1(dailyTss[ymd] ?? 0);
    ctl = round1(ctl + (tssToday - ctl) / ctlTau);
    atl = round1(atl + (tssToday - atl) / atlTau);
    series.push({
      date: ymd,
      fitness_ctl: ctl,
      fatigue_atl: atl,
      form_tsb: tsb,
      daily_tss: tssToday,
    });
  }
  return series;
}

/** 최근 chartDays(기본 30일) PMC 포인트 */
export function buildPmcChartData(
  logs: StravaRunLog[],
  profile?: PmcUserProfile | null,
  opts: PmcCalculatorOptions = {},
): PmcChartPoint[] {
  const chartDays = opts.chartDays ?? DEFAULT_CHART_DAYS;
  const endYmd = opts.endDate ? toSeoulYmd(opts.endDate) : toSeoulYmd();
  const daily = buildDailyTssMap(logs, profile ?? null, opts);
  const full = computePmcSeries(daily, opts);
  const chartStart = addDaysYmd(endYmd, -(chartDays - 1));
  return full.filter((row) => row.date >= chartStart && row.date <= endYmd);
}

/** TSB 구간별 훈련 상태 피드백 */
export function getTsbTrainingStatusFeedback(tsb: number): TsbTrainingFeedback {
  const t = round1(tsb);
  if (t > 5) {
    return {
      zone: 'freshness',
      title: '회복 · 최적 경기력 구간',
      message: '체력 대비 피로가 낮습니다. 레이스나 고강도 세션에 유리한 Freshness Zone입니다.',
      tsb: t,
    };
  }
  if (t >= -10) {
    return {
      zone: 'optimal',
      title: '최적 훈련 효율 구간',
      message: '훈련 부하와 회복의 균형이 양호합니다. 계획된 러닝을 유지하세요 (Optimal Training Zone).',
      tsb: t,
    };
  }
  if (t >= -30) {
    return {
      zone: 'overreaching',
      title: '과부하 · 부상 주의',
      message: '피로가 누적 중입니다. Z1~Z2 회복 러닝과 수면·영양 관리를 강화하세요 (Overreaching Zone).',
      tsb: t,
    };
  }
  return {
    zone: 'overtraining',
    title: '위험 · 훈련 중단 권고',
    message: '과훈련 위험이 높습니다. 강도 훈련을 중단하고 회복을 우선하세요 (Overtraining Zone).',
    tsb: t,
  };
}

/** 기존 Chart.js TrainingTrendChart 호환 { date, fitness, fatigue } */
export function toLegacyFitnessTrendRows(
  pmcRows: PmcChartPoint[],
  today: Date = new Date(),
): { date: string; fitness: number; fatigue: number; form_tsb?: number; daily_tss?: number }[] {
  const todayYmd = toSeoulYmd(today);
  const todayMs = new Date(`${todayYmd}T00:00:00`).getTime();
  return pmcRows.map((row) => {
    const rowMs = new Date(`${row.date}T00:00:00`).getTime();
    const daysDiff = Math.round((todayMs - rowMs) / 86400000);
    const label = daysDiff === 0 ? '오늘' : `-${daysDiff}일`;
    return {
      date: label,
      fitness: row.fitness_ctl,
      fatigue: row.fatigue_atl,
      form_tsb: row.form_tsb,
      daily_tss: row.daily_tss,
    };
  });
}
