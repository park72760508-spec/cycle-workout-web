/**
 * STELVIO 헥사곤(6축) — 유산소 역량·주주 성향 분석 엔진
 * Pete Riegel 모델 + 거리별 페이스 벤치마크 정규화 (0~100)
 *
 * @module analyzeStelvioHexagon
 */

export type HexagonAxisKey = '1k' | '3k' | '5k' | '7k' | '10k' | '20k';

/** 구간별 페이스(초/km). null/undefined = 해당 축 데이터 없음 */
export type PaceDataInput = Partial<Record<HexagonAxisKey, number | null>>;

export type HexagonScoreMap = {
  k1: number | null;
  k3: number | null;
  k5: number | null;
  k7: number | null;
  k10: number | null;
  k20: number | null;
};

export type HexagonChartPoint = {
  key: HexagonAxisKey;
  label: string;
  score: number | null;
  /** 차트 반지름 0.08~0.99 (score/100 기반) */
  radiusNorm: number;
  paceSecPerKm: number | null;
  paceDisplay: string | null;
  missing: boolean;
};

export type RunnerTypeId =
  | 'aerobic_diesel'
  | 'endurance_base'
  | 'balanced_allrounder'
  | 'short_bias_allrounder'
  | 'long_bias_allrounder'
  | 'speed_monster'
  | 'speed_oriented'
  | 'distance_specialist'
  | 'insufficient_data';

export type StelvioHexagonAnalysis = {
  scores: HexagonScoreMap;
  fatigueFactorP: number | null;
  fatigueFactorSource: string;
  runnerType: string;
  runnerTypeId: RunnerTypeId;
  shortAxisAvg: number | null;
  longAxisAvg: number | null;
  axisImbalance: number | null;
  description: string;
  recommendations: string[];
  /** UI 차트 주입용 — 12시부터 시계방향 1k→3k→…→20k */
  hexagonDataset: HexagonChartPoint[];
  /** radarPolygon용 score 배열 (동일 순서) */
  radarScoreNorms: number[];
  availableAxes: HexagonAxisKey[];
  missingAxes: HexagonAxisKey[];
};

type BenchmarkRow = { eliteSecPerKm: number; floorSecPerKm: number };

const AXES: HexagonAxisKey[] = ['1k', '3k', '5k', '7k', '10k', '20k'];

const SCORE_KEY: Record<HexagonAxisKey, keyof HexagonScoreMap> = {
  '1k': 'k1',
  '3k': 'k3',
  '5k': 'k5',
  '7k': 'k7',
  '10k': 'k10',
  '20k': 'k20',
};

/** 일반~엘리트 벤치마크 (초/km). 빠를수록 100점 */
const PACE_BENCHMARKS: Record<HexagonAxisKey, BenchmarkRow> = {
  '1k': { eliteSecPerKm: 180, floorSecPerKm: 420 },
  '3k': { eliteSecPerKm: 195, floorSecPerKm: 450 },
  '5k': { eliteSecPerKm: 210, floorSecPerKm: 480 },
  '7k': { eliteSecPerKm: 218, floorSecPerKm: 510 },
  '10k': { eliteSecPerKm: 240, floorSecPerKm: 540 },
  '20k': { eliteSecPerKm: 255, floorSecPerKm: 570 },
};

const RIEGEL_STANDARD_P = 1.06;

const RIEGEL_PAIRS: { from: HexagonAxisKey; to: HexagonAxisKey; weight: number }[] = [
  { from: '1k', to: '10k', weight: 0.35 },
  { from: '1k', to: '20k', weight: 0.25 },
  { from: '3k', to: '10k', weight: 0.2 },
  { from: '5k', to: '20k', weight: 0.2 },
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isValidPace(sec: unknown): sec is number {
  return sec != null && typeof sec === 'number' && isFinite(sec) && sec > 0;
}

function formatPaceDisplay(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  const ss = sec < 10 ? '0' + sec : String(sec);
  return min + ':' + ss;
}

/** 페이스(초/km) → 0~100 역량 점수 (빠를수록 높음) */
export function paceSecToAxisScore(axis: HexagonAxisKey, paceSecPerKm: number): number {
  const bench = PACE_BENCHMARKS[axis];
  const span = bench.floorSecPerKm - bench.eliteSecPerKm;
  if (!(span > 0)) return 0;
  const raw = ((bench.floorSecPerKm - paceSecPerKm) / span) * 100;
  return round2(clamp(raw, 0, 100));
}

/** Riegel: T2 = T1 * (D2/D1)^p  →  p = ln(T2/T1) / ln(D2/D1) */
export function riegelExponentFromPaces(
  paceFromSecPerKm: number,
  distFromKm: number,
  paceToSecPerKm: number,
  distToKm: number
): number | null {
  if (!isValidPace(paceFromSecPerKm) || !isValidPace(paceToSecPerKm)) return null;
  if (distFromKm <= 0 || distToKm <= distFromKm) return null;
  const t1 = paceFromSecPerKm * distFromKm;
  const t2 = paceToSecPerKm * distToKm;
  if (!(t1 > 0 && t2 > 0)) return null;
  const ratio = t2 / t1;
  const distRatio = distToKm / distFromKm;
  if (!(ratio > 0 && distRatio > 1)) return null;
  return Math.log(ratio) / Math.log(distRatio);
}

function distKm(key: HexagonAxisKey): number {
  return parseInt(key, 10);
}

export function estimateFatigueFactorP(paceData: PaceDataInput): {
  p: number | null;
  source: string;
} {
  const parts: { p: number; weight: number; label: string }[] = [];

  RIEGEL_PAIRS.forEach(function (pair) {
    const pFrom = paceData[pair.from];
    const pTo = paceData[pair.to];
    if (!isValidPace(pFrom) || !isValidPace(pTo)) return;
    const pExp = riegelExponentFromPaces(pFrom, distKm(pair.from), pTo, distKm(pair.to));
    if (pExp == null || !isFinite(pExp) || pExp < 0.9 || pExp > 1.25) return;
    parts.push({
      p: pExp,
      weight: pair.weight,
      label: pair.from + '→' + pair.to,
    });
  });

  if (!parts.length) {
    return { p: null, source: 'insufficient_pairs' };
  }

  const wSum = parts.reduce(function (s, x) {
    return s + x.weight;
  }, 0);
  const pAvg =
    parts.reduce(function (s, x) {
      return s + x.p * (x.weight / wSum);
    }, 0);

  return {
    p: round2(pAvg),
    source: parts.map(function (x) {
      return x.label + '=' + round2(x.p);
    }).join(', '),
  };
}

function classifyRunnerType(
  p: number | null,
  shortAvg: number | null,
  longAvg: number | null
): { id: RunnerTypeId; label: string } {
  if (shortAvg == null || longAvg == null || p == null) {
    return { id: 'insufficient_data', label: '데이터 부족 (분석 불가)' };
  }
  const imbalance = shortAvg - longAvg;

  if (p < 1.05 && imbalance < 5) {
    return { id: 'aerobic_diesel', label: '지구력형 러너 (Aerobic Diesel)' };
  }
  if (p < 1.05) {
    return { id: 'endurance_base', label: '유산소 기반형 (Endurance Base)' };
  }
  if (p > 1.08 && imbalance >= 10) {
    return { id: 'speed_monster', label: '스피드 파워형 러너 (Speed Monster)' };
  }
  if (p > 1.08) {
    return { id: 'speed_oriented', label: '스프린터형 (Speed-Oriented)' };
  }
  if (p > 1.07 && imbalance <= -10) {
    return { id: 'distance_specialist', label: '장거리 특화형 (Distance Specialist)' };
  }
  if (p >= 1.05 && p <= 1.07 && Math.abs(imbalance) < 8) {
    return { id: 'balanced_allrounder', label: '올라운더 러너 (Balanced All-Rounder)' };
  }
  if (imbalance >= 8) {
    return { id: 'short_bias_allrounder', label: '단거리 편중 올라운더 (Short-Bias)' };
  }
  if (imbalance <= -8) {
    return { id: 'long_bias_allrounder', label: '장거리 편중 올라운더 (Long-Bias)' };
  }
  return { id: 'balanced_allrounder', label: '올라운더 러너 (Balanced All-Rounder)' };
}

function buildDescription(
  typeId: RunnerTypeId,
  scores: HexagonScoreMap,
  p: number | null,
  shortAvg: number | null,
  longAvg: number | null,
  available: HexagonAxisKey[]
): { description: string; recommendations: string[] } {
  const recs: string[] = [];
  const k1 = scores.k1;
  const k10 = scores.k10;
  const k20 = scores.k20;

  if (typeId === 'insufficient_data') {
    return {
      description:
        '6축 Peak 페이스(1k~20k) 중 3개 이상 구간 기록이 필요합니다. 최근 90일 구간 PR을 쌓으면 성향 분석이 가능합니다.',
      recommendations: ['1k·5k·10k 템포런 또는 레이스 기록을 등록해 주세요.'],
    };
  }

  const pText =
    p != null
      ? '피로 지수 p=' +
        p.toFixed(3) +
        (p < 1.05
          ? ' (표준 1.06 대비 지구력 우위)'
          : p > 1.08
            ? ' (표준 1.06 대비 단거리 편향)'
            : ' (표준 1.06 근접·균형)')
      : '';

  let body = '';

  if (typeId === 'speed_monster' || typeId === 'speed_oriented') {
    const topPct =
      k1 != null && k1 >= 80
        ? '상위 ' + Math.max(5, Math.round(100 - k1)) + '%'
        : '단기 구간';
    body =
      '1k~3k 구간 페이스 역량은 ' +
      topPct +
      ' 수준으로 우수하나, 7k 이상에서 유산소 패널티(페이스 저하)가 두드러집니다. ' +
      pText;
    recs.push('주 1~2회 Z2 LSD(60~90분)로 유산소 베이스를 보강하세요.');
    recs.push('10k 페이스 ±5% 템포런 비중을 전체 훈련의 20% 이상 유지하세요.');
  } else if (typeId === 'aerobic_diesel' || typeId === 'endurance_base') {
    body =
      '장거리(10k~20k) 구간에서 페이스 유지력이 뛰어나 지구력·유산소 역량이 강점입니다. ' +
      '단거리 폭발력은 상대적으로 낮을 수 있습니다. ' +
      pText;
    recs.push('5k~7k 구간 VO₂max 인터벌(3~5분)로 상위 속도 역치를 끌어올리세요.');
    recs.push('1k~3k 스트라이드·짧은 템포런으로 neuromuscular 파워를 보완하세요.');
  } else if (typeId === 'distance_specialist' || typeId === 'long_bias_allrounder') {
    body =
      '7k~20k 장거리 축 점수가 단거리 대비 높아 마라톤·하프 지구력형 프로필입니다. ' + pText;
    recs.push('하프~풀 목표 시 장거리 Z2+ 롱런 비중을 유지하세요.');
    recs.push('역치(T) 구간 훈련으로 후반 페이스 붕괴를 줄이세요.');
  } else if (typeId === 'short_bias_allrounder') {
    body =
      '단거리(1k~5k) 역량이 장거리보다 두드러지나, p 지수상 전반적 균형은 유지됩니다. ' + pText;
    recs.push('5k→10k 연결 훈련(크루즈 인터벌)으로 지구력 전환을 보완하세요.');
  } else {
    body =
      '6축 페이스 프로필이 비교적 균형 잡혀 있어 다양한 거리 대회에 적합한 올라운더형입니다. ' +
      pText;
    if (shortAvg != null && longAvg != null) {
      body += ' 단거리 평균 ' + Math.round(shortAvg) + '점 · 장거리 평균 ' + Math.round(longAvg) + '점.';
    }
    recs.push('약점 축(가장 낮은 구간) 위주로 4주 주기 특화 훈련을 권장합니다.');
  }

  if (available.length < 6) {
    body += ' (참고: ' + available.join(', ') + ' 구간만 분석에 사용됨)';
  }

  return { description: body, recommendations: recs };
}

function scoreToRadiusNorm(score: number | null): number {
  if (score == null || !isFinite(score)) return 0.08;
  const norm = score / 100;
  return clamp(norm, 0.08, 0.99);
}

/**
 * STELVIO 헥사곤 성향·역량 분석 (메인 엔트리)
 */
export function analyzeStelvioHexagon(paceData: PaceDataInput): StelvioHexagonAnalysis {
  const scores: HexagonScoreMap = {
    k1: null,
    k3: null,
    k5: null,
    k7: null,
    k10: null,
    k20: null,
  };
  const availableAxes: HexagonAxisKey[] = [];
  const missingAxes: HexagonAxisKey[] = [];
  const hexagonDataset: HexagonChartPoint[] = [];
  const radarScoreNorms: number[] = [];

  AXES.forEach(function (axis) {
    const pace = paceData[axis];
    const missing = !isValidPace(pace);
    if (missing) {
      missingAxes.push(axis);
      hexagonDataset.push({
        key: axis,
        label: axis,
        score: null,
        radiusNorm: 0.08,
        paceSecPerKm: null,
        paceDisplay: null,
        missing: true,
      });
      radarScoreNorms.push(0.08);
      return;
    }
    availableAxes.push(axis);
    const score = paceSecToAxisScore(axis, pace);
    scores[SCORE_KEY[axis]] = score;
    const radiusNorm = scoreToRadiusNorm(score);
    hexagonDataset.push({
      key: axis,
      label: axis,
      score: score,
      radiusNorm: radiusNorm,
      paceSecPerKm: pace,
      paceDisplay: formatPaceDisplay(pace),
      missing: false,
    });
    radarScoreNorms.push(radiusNorm);
  });

  const shortVals = [scores.k1, scores.k3, scores.k5].filter(function (v) {
    return v != null;
  }) as number[];
  const longVals = [scores.k7, scores.k10, scores.k20].filter(function (v) {
    return v != null;
  }) as number[];

  const shortAxisAvg =
    shortVals.length > 0
      ? round2(shortVals.reduce(function (a, b) {
          return a + b;
        }, 0) / shortVals.length)
      : null;
  const longAxisAvg =
    longVals.length > 0
      ? round2(longVals.reduce(function (a, b) {
          return a + b;
        }, 0) / longVals.length)
      : null;
  const axisImbalance =
    shortAxisAvg != null && longAxisAvg != null ? round2(shortAxisAvg - longAxisAvg) : null;

  const fatigue = estimateFatigueFactorP(paceData);
  const type =
    availableAxes.length >= 3
      ? classifyRunnerType(fatigue.p, shortAxisAvg, longAxisAvg)
      : { id: 'insufficient_data' as RunnerTypeId, label: '데이터 부족 (분석 불가)' };

  const narrative = buildDescription(
    type.id,
    scores,
    fatigue.p,
    shortAxisAvg,
    longAxisAvg,
    availableAxes
  );

  return {
    scores: scores,
    fatigueFactorP: fatigue.p,
    fatigueFactorSource: fatigue.source,
    runnerType: type.label,
    runnerTypeId: type.id,
    shortAxisAvg: shortAxisAvg,
    longAxisAvg: longAxisAvg,
    axisImbalance: axisImbalance,
    description: narrative.description,
    recommendations: narrative.recommendations,
    hexagonDataset: hexagonDataset,
    radarScoreNorms: radarScoreNorms,
    availableAxes: availableAxes,
    missingAxes: missingAxes,
  };
}

/** peak_performances / hexagon 컨텍스트 → PaceDataInput */
export function buildPaceDataInputFromPeakMap(
  peakPerformances: Record<string, { pace?: string; calculated_pace?: string } | null> | null,
  parsePace?: (s: string) => number | null
): PaceDataInput {
  const parse =
    parsePace ||
    function (s: string) {
      if (typeof window !== 'undefined' && window.runDashboardPace && typeof window.runDashboardPace.parsePaceToSecPerKm === 'function') {
        return window.runDashboardPace.parsePaceToSecPerKm(s);
      }
      return null;
    };
  const out: PaceDataInput = {};
  const pp = peakPerformances || {};
  AXES.forEach(function (axis) {
    const seg = pp[axis];
    const paceStr = seg && (seg.pace || seg.calculated_pace);
    if (!paceStr) {
      out[axis] = null;
      return;
    }
    const sec = parse(String(paceStr));
    out[axis] = sec != null && sec > 0 ? sec : null;
  });
  return out;
}
