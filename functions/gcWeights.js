/**
 * GC(헵타곤) 종합 점수 — 7축 차등 가중 합(0~100).
 *
 * 축 순서: HEPTAGON_DURATIONS 와 동일 ['max','1min','5min','10min','20min','40min','60min']
 * 가중치는 Supabase `fn_gc_axis_weights()`, 대시보드 `StelvioOctagonRanksCard.jsx` 의 GC_AXIS_WEIGHTS 와 반드시 동일.
 * 축별 점수 S_k 는 기존 positionScore100FromRank(100·(n−r)/(n−1), 미측정 0점)를 그대로 사용한다.
 */

const GC_AXIS_KEYS = Object.freeze(["max", "1min", "5min", "10min", "20min", "40min", "60min"]);

const GC_AXIS_WEIGHTS = Object.freeze({
  max: 0.05,
  "1min": 0.1,
  "5min": 0.2,
  "10min": 0.15,
  "20min": 0.25,
  "40min": 0.15,
  "60min": 0.1,
});

/** GC_AXIS_KEYS 순서 배열 */
const GC_AXIS_WEIGHT_LIST = Object.freeze(GC_AXIS_KEYS.map((k) => GC_AXIS_WEIGHTS[k]));

/** 동점 처리용 축 인덱스 */
const GC_TIEBREAK_AXIS_INDEX = Object.freeze({ min20: 4, min5: 2 });

/** SQL round(x, 4) 와 동일 자릿수 — JS·SQL 간 동점 판정 일치 */
function roundGcScore(v) {
  return Math.round(Number(v) * 1e4) / 1e4;
}

/**
 * @param {number[]} positionScores100 축별 0~100 점수(7개, GC_AXIS_KEYS 순서)
 * @returns {number|null} 0~100 가중 점수, 입력이 잘못되면 null
 */
function computeGcWeightedScore(positionScores100) {
  if (!Array.isArray(positionScores100) || positionScores100.length !== GC_AXIS_WEIGHT_LIST.length) {
    return null;
  }
  let sum = 0;
  for (let i = 0; i < GC_AXIS_WEIGHT_LIST.length; i++) {
    const s = Number(positionScores100[i]);
    sum += GC_AXIS_WEIGHT_LIST[i] * (isFinite(s) ? s : 0);
  }
  return roundGcScore(sum);
}

function axisScoreAt(row, idx) {
  const arr = row && row.positionScores100;
  const v = Array.isArray(arr) ? Number(arr[idx]) : NaN;
  return isFinite(v) ? v : 0;
}

/**
 * GC 보드 정렬: GC ↓ → 20분 축 ↓ → 5분 축 ↓ → userId
 * @param {{ sumPositionScores?: number, gcScore?: number, positionScores100?: number[], userId?: string }} a
 */
function compareGcRows(a, b) {
  const sa = Number(a && (a.sumPositionScores != null ? a.sumPositionScores : a.gcScore)) || 0;
  const sb = Number(b && (b.sumPositionScores != null ? b.sumPositionScores : b.gcScore)) || 0;
  if (sb !== sa) return sb - sa;
  const i20 = GC_TIEBREAK_AXIS_INDEX.min20;
  const d20 = axisScoreAt(b, i20) - axisScoreAt(a, i20);
  if (d20 !== 0) return d20;
  const i5 = GC_TIEBREAK_AXIS_INDEX.min5;
  const d5 = axisScoreAt(b, i5) - axisScoreAt(a, i5);
  if (d5 !== 0) return d5;
  return String((a && a.userId) || "").localeCompare(String((b && b.userId) || ""));
}

module.exports = {
  GC_AXIS_KEYS,
  GC_AXIS_WEIGHTS,
  GC_AXIS_WEIGHT_LIST,
  GC_TIEBREAK_AXIS_INDEX,
  roundGcScore,
  computeGcWeightedScore,
  compareGcRows,
};
