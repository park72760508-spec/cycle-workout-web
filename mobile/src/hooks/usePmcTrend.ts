/**
 * RUN PMC 트렌드 — React Native / Web 공통 상태 매핑 (React 비의존)
 * React Hook 예시는 파일 하단 주석 참고.
 */
import {
  buildPmcChartData,
  getTsbTrainingStatusFeedback,
  toLegacyFitnessTrendRows,
  type PmcCalculatorOptions,
  type PmcChartPoint,
  type PmcUserProfile,
  type StravaRunLog,
  type TsbTrainingFeedback,
} from '../utils/pmcCalculator';

export interface PmcTrendState {
  chartSeries: PmcChartPoint[];
  latest: PmcChartPoint | null;
  latestCtl: number | null;
  latestAtl: number | null;
  latestTsb: number | null;
  feedback: TsbTrainingFeedback | null;
  legacyChartData: ReturnType<typeof toLegacyFitnessTrendRows>;
}

/** 컴포넌트 setState / useMemo 에 그대로 바인딩 */
export function computePmcTrendState(
  logs: StravaRunLog[],
  profile?: PmcUserProfile | null,
  opts?: PmcCalculatorOptions,
): PmcTrendState {
  const chartSeries = buildPmcChartData(logs ?? [], profile ?? null, opts);
  const latest = chartSeries.length ? chartSeries[chartSeries.length - 1]! : null;
  const feedback = latest != null ? getTsbTrainingStatusFeedback(latest.form_tsb) : null;
  const legacyChartData = toLegacyFitnessTrendRows(chartSeries);
  return {
    chartSeries,
    latest,
    latestCtl: latest?.fitness_ctl ?? null,
    latestAtl: latest?.fatigue_atl ?? null,
    latestTsb: latest?.form_tsb ?? null,
    feedback,
    legacyChartData,
  };
}

/*
 * --- React Native 통합 예시 (Gifted Charts / Victory Native) ---
 *
 * import { useMemo } from 'react';
 * import { computePmcTrendState } from '../hooks/usePmcTrend';
 *
 * function RunTrainingTrendScreen({ logs, profile }) {
 *   const { chartSeries, feedback, legacyChartData } = useMemo(
 *     () => computePmcTrendState(logs, profile, { chartDays: 30 }),
 *     [logs, profile],
 *   );
 *
 *   return (
 *     <>
 *       <LineChart
 *         data={chartSeries.map((p) => ({
 *           value: p.fitness_ctl,
 *           dataPointText: String(p.fitness_ctl),
 *           label: p.date.slice(5),
 *         }))}
 *       />
 *       {feedback && (
 *         <View>
 *           <Text style={{ fontWeight: '600' }}>{feedback.title}</Text>
 *           <Text>{feedback.message}</Text>
 *         </View>
 *       )}
 *     </>
 *   );
 * }
 */
