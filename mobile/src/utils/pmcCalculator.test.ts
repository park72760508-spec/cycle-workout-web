import {
  buildPmcChartData,
  calculateHrTss,
  calculateRtssFromPace,
  computePmcSeries,
  getTsbTrainingStatusFeedback,
  inferThresholdPaceSecPerKm,
  parsePaceToSecPerKm,
  resolveSessionTss,
  toLegacyFitnessTrendRows,
} from './pmcCalculator';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- pace / fTP ---
const sec10k = parsePaceToSecPerKm('4:30');
assert(sec10k === 270, 'pace parse 4:30');

const inferred = inferThresholdPaceSecPerKm({
  '10k': { pace: '4:00' },
});
assert(inferred === 240, '10k threshold inference');

// --- rTSS @ threshold 1h ≈ 100 ---
const ftpSpeed = 1000 / 270;
const rtss100 = calculateRtssFromPace(3600, ftpSpeed, ftpSpeed);
assert(Math.abs(rtss100 - 100) < 0.2, 'rTSS at FTP 1h ≈ 100');

// --- hrTSS @ LTHR 1h ≈ 100 ---
const hr100 = calculateHrTss(3600, 170, 170);
assert(Math.abs(hr100 - 100) < 0.2, 'hrTSS at LTHR 1h ≈ 100');

// --- fallback chain ---
const tssOfficial = resolveSessionTss(
  { date: '2026-06-01', activity_type: 'run', tss: 85, moving_time: 3600 },
  { threshold_pace_sec: 270 },
  270,
  170,
  1200,
);
assert(tssOfficial === 85, 'official TSS preferred');

const tssRtss = resolveSessionTss(
  {
    date: '2026-06-02',
    activity_type: 'run',
    moving_time: 3600,
    average_speed: ftpSpeed,
  },
  { threshold_pace_sec: 270 },
  270,
  170,
  1200,
);
assert(tssRtss > 95 && tssRtss < 105, 'rTSS fallback');

// --- EWMA ---
const daily = { '2026-06-01': 100, '2026-06-02': 0 };
const series = computePmcSeries(daily, {
  chartDays: 2,
  buildupDays: 0,
  endDate: new Date('2026-06-02T12:00:00'),
});
assert(series.length === 2, 'series length');
assert(series[0]!.form_tsb === 0, 'day1 TSB before load');
assert(series[0]!.daily_tss === 100, 'day1 TSS');
assert(series[1]!.form_tsb < 0, 'day2 TSB negative after load');

const chart = buildPmcChartData(
  [
    { date: '2026-06-01', activity_type: 'run', tss: 100 },
    { date: '2026-06-02', activity_type: 'run', tss: 50 },
  ],
  { threshold_pace_sec: 270 },
  { chartDays: 2, buildupDays: 0, endDate: new Date('2026-06-02') },
);
assert(chart.length === 2, 'chart 2 days');
assert(chart.every((r) => Number.isFinite(r.fitness_ctl)), 'ctl finite');

const legacy = toLegacyFitnessTrendRows(chart);
assert(legacy[1]!.date === '6/2', 'legacy md label');
assert(legacy[1]!.dateYmd === '2026-06-02', 'legacy ymd preserved');

const fresh = getTsbTrainingStatusFeedback(8);
assert(fresh.zone === 'freshness', 'fresh zone');
const danger = getTsbTrainingStatusFeedback(-35);
assert(danger.zone === 'overtraining', 'overtraining zone');

console.log('[pmcCalculator.test] all assertions passed');
