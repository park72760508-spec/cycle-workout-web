/**
 * STELVIO 성장 추이 · 헵타곤 — 상위 랭킹 퍼센트(%) 기반 세로 10단계 레벨 인디케이터
 * - 낮은 퍼센트(상위 랭킹)일수록 인디케이터가 아래→위로 많이 채워짐(구간 최대값=바닥, 최소값=꼭대기).
 * - 기존 Firestore/`heptagonLevelPercentForRankN` 산출 값을 그대로 percentile로 넘기면 됨.
 */

export type LevelLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export interface CalculateLevelProgressResult {
  /** 예: `'레벨C'` — 화면 문구와 동일 */
  currentLevel: string;
  levelLetter: LevelLetter;
  /** 10칸 기준 채워진 칸 수(반올림, 0~10) */
  filledSteps: number;
  /** 0~1, 연속 비율(해당 레벨 구간 내 채움 비율 = (구간 최대 - p)/(구간 최대 - 구간 최소)) */
  fillRatio: number;
  /** 디버깅·검증용 */
  segmentMin: number;
  segmentMax: number;
}

interface BandDef {
  letter: LevelLetter;
  /** 구간 표시 최소값(명세의 "구간 최소") */
  min: number;
  /** 구간 표시 최대값(명세의 "구간 최대") */
  max: number;
  /** true면 `min < p ≤ max`, false면 `min ≤ p ≤ max` */
  minExclusive: boolean;
}

/**
 * 등급표 (상위 랭킹 %)
 * A: 0~5, B: 5초과~10, C: 10초과~20, D: 20초과~40, E: 40초과~60, F: 60초과~80, G: 80초과~100
 */
const BANDS: BandDef[] = [
  { letter: 'A', min: 0, max: 5, minExclusive: false },
  { letter: 'B', min: 5, max: 10, minExclusive: true },
  { letter: 'C', min: 10, max: 20, minExclusive: true },
  { letter: 'D', min: 20, max: 40, minExclusive: true },
  { letter: 'E', min: 40, max: 60, minExclusive: true },
  { letter: 'F', min: 60, max: 80, minExclusive: true },
  { letter: 'G', min: 80, max: 100, minExclusive: true },
];

function clampPercentile(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 100) return 100;
  return p;
}

function percentileInBand(p: number, b: BandDef): boolean {
  const loOk = b.minExclusive ? p > b.min : p >= b.min;
  const hiOk = p <= b.max;
  return loOk && hiOk;
}

function findBand(p: number): BandDef | null {
  for (let i = 0; i < BANDS.length; i++) {
    if (percentileInBand(p, BANDS[i])) return BANDS[i];
  }
  return null;
}

/**
 * @param percentile 상위 랭킹 퍼센트(0~100). 낮을수록 상위 랭킹.
 */
export function calculateLevelProgress(percentile: number): CalculateLevelProgressResult {
  const p = clampPercentile(percentile);
  const band = findBand(p);

  if (!band) {
    return {
      currentLevel: '레벨G',
      levelLetter: 'G',
      filledSteps: 0,
      fillRatio: 0,
      segmentMin: 80,
      segmentMax: 100,
    };
  }

  const segMin = band.min;
  const segMax = band.max;
  const width = segMax - segMin;
  /** 연속 채움 단계 수 (바닥에서부터) — 예: 12.69% 레벨C → 7.31 */
  let rawSteps = 0;
  let fillRatio = 0;
  if (width <= 0) {
    rawSteps = 10;
    fillRatio = 1;
  } else {
    fillRatio = (segMax - p) / width;
    if (fillRatio < 0) fillRatio = 0;
    if (fillRatio > 1) fillRatio = 1;
    rawSteps = fillRatio * 10;
  }

  const filledSteps = Math.min(10, Math.max(0, Math.round(rawSteps)));

  return {
    currentLevel: `레벨${band.letter}`,
    levelLetter: band.letter,
    filledSteps,
    fillRatio,
    segmentMin: segMin,
    segmentMax: segMax,
  };
}
