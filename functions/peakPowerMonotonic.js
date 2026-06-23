/**
 * 피크 파워 프로파일 — 짧은 구간 ≥ 긴 구간 (W).
 * fn_validate_peak_power 로 짧은 구간만 0이 되고 긴 구간이 남으면 랭킹 역전(20분 > 10분)이 발생한다.
 */
const PEAK_POWER_LIMITS = {
  max: { wkg: 25.0, watts: 2200 },
  "1min": { wkg: 12.0, watts: 900 },
  "5min": { wkg: 8.0, watts: 700 },
  "10min": { wkg: 7.0, watts: 600 },
  "20min": { wkg: 6.5, watts: 550 },
  "40min": { wkg: 6.0, watts: 500 },
  "60min": { wkg: 5.8, watts: 450 },
};

const PEAK_POWER_WATT_FIELDS = [
  "max_watts",
  "max_1min_watts",
  "max_5min_watts",
  "max_10min_watts",
  "max_20min_watts",
  "max_40min_watts",
  "max_60min_watts",
];

/** 1분~60분: 앞 구간이 0이면 뒤 구간도 동일 라이드/일 프로파일에서 무효 */
const PEAK_POWER_CASCADE_FIELDS = PEAK_POWER_WATT_FIELDS.filter((f) => f !== "max_watts");

/**
 * @param {Record<string, number|null|undefined>} peaks
 * @param {string[]} [fieldKeys]
 */
function capPeakPowerMonotonicInPlace(peaks, fieldKeys) {
  const keys = fieldKeys || PEAK_POWER_WATT_FIELDS;
  for (let i = 1; i < keys.length; i++) {
    const prev = Number(peaks[keys[i - 1]]) || 0;
    const cur = Number(peaks[keys[i]]) || 0;
    if (prev > 0 && cur > prev) peaks[keys[i]] = prev;
  }
  return peaks;
}

/**
 * 검증 탈락(0) 구간 이후의 긴 구간도 0 — 동일 활동 MMP 프로파일 일관성
 * @param {Record<string, number|null|undefined>} peaks
 */
function cascadeZeroPeakPowerAfterValidationGap(peaks) {
  let hitGap = false;
  for (let i = 0; i < PEAK_POWER_CASCADE_FIELDS.length; i++) {
    const key = PEAK_POWER_CASCADE_FIELDS[i];
    const v = Number(peaks[key]) || 0;
    if (hitGap) {
      peaks[key] = 0;
    } else if (v <= 0) {
      hitGap = true;
    }
  }
  return peaks;
}

/**
 * @param {Record<string, number|null|undefined>} peaks — durationType 키(max, 1min, …) 또는 watt 필드명
 * @param {number} weightKg
 * @param {(durationType: string, watts: number, weightKg: number) => boolean} validateFn
 * @param {{ useWattFieldKeys?: boolean }} [opts]
 * @returns {Record<string, number>}
 */
function sanitizePeakPowerProfile(peaks, weightKg, validateFn, opts) {
  opts = opts || {};
  const w = Number(weightKg) > 0 ? Math.max(Number(weightKg), 45) : 0;
  const out = Object.assign({}, peaks);
  const fieldToDur = {
    max_watts: "max",
    max_1min_watts: "1min",
    max_5min_watts: "5min",
    max_10min_watts: "10min",
    max_20min_watts: "20min",
    max_40min_watts: "40min",
    max_60min_watts: "60min",
    max: "max",
    "1min": "1min",
    "5min": "5min",
    "10min": "10min",
    "20min": "20min",
    "40min": "40min",
    "60min": "60min",
  };

  const keys = opts.useWattFieldKeys
    ? PEAK_POWER_WATT_FIELDS
    : ["max", "1min", "5min", "10min", "20min", "40min", "60min"];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const dur = fieldToDur[key] || key;
    let watts = Number(out[key]) || 0;
    if (w > 0 && watts > 0 && typeof validateFn === "function" && !validateFn(dur, watts, w)) {
      watts = 0;
    }
    out[key] = watts > 0 ? watts : 0;
  }

  if (opts.useWattFieldKeys) {
    cascadeZeroPeakPowerAfterValidationGap(out);
    capPeakPowerMonotonicInPlace(out);
  } else {
    const asWatts = {
      max_watts: Number(out.max) || 0,
      max_1min_watts: Number(out["1min"]) || 0,
      max_5min_watts: Number(out["5min"]) || 0,
      max_10min_watts: Number(out["10min"]) || 0,
      max_20min_watts: Number(out["20min"]) || 0,
      max_40min_watts: Number(out["40min"]) || 0,
      max_60min_watts: Number(out["60min"]) || 0,
    };
    cascadeZeroPeakPowerAfterValidationGap(asWatts);
    capPeakPowerMonotonicInPlace(asWatts);
    out.max = asWatts.max_watts;
    out["1min"] = asWatts.max_1min_watts;
    out["5min"] = asWatts.max_5min_watts;
    out["10min"] = asWatts.max_10min_watts;
    out["20min"] = asWatts.max_20min_watts;
    out["40min"] = asWatts.max_40min_watts;
    out["60min"] = asWatts.max_60min_watts;
  }

  return out;
}

/**
 * 랭킹 집계용 W/kg — 긴 구간이 짧은 구간보다 클 수 없음
 * @param {Record<string, number>} wkgByDur — keys: max, 1min, …, 60min
 */
function capPeakWkgMonotonicInPlace(wkgByDur) {
  const order = ["max", "1min", "5min", "10min", "20min", "40min", "60min"];
  for (let i = 1; i < order.length; i++) {
    const prev = Number(wkgByDur[order[i - 1]]) || 0;
    const cur = Number(wkgByDur[order[i]]) || 0;
    if (prev > 0 && cur > prev) wkgByDur[order[i]] = prev;
  }
  return wkgByDur;
}

function validatePeakPowerRecord(durationType, watts, weightKg) {
  const limit = PEAK_POWER_LIMITS[durationType];
  if (!limit || !weightKg || weightKg <= 0) return true;
  const wkg = watts / weightKg;
  if (wkg > limit.wkg) return false;
  if (watts > limit.watts) return false;
  return true;
}

/**
 * logDoc / ride 행의 MMP 필드 — 검증·cascade·단조 보정 (in-place)
 * @param {Record<string, unknown>} row
 * @param {number} weightKg
 */
function sanitizePeakPowerWattsOnRow(row, weightKg) {
  if (!row || !(Number(weightKg) > 0)) return row;
  const peaks = {
    max_watts: Number(row.max_watts) || 0,
    max_1min_watts: Number(row.max_1min_watts) || 0,
    max_5min_watts: Number(row.max_5min_watts) || 0,
    max_10min_watts: Number(row.max_10min_watts) || 0,
    max_20min_watts: Number(row.max_20min_watts) || 0,
    max_40min_watts: Number(row.max_40min_watts) || 0,
    max_60min_watts: Number(row.max_60min_watts) || 0,
  };
  const clean = sanitizePeakPowerProfile(peaks, weightKg, validatePeakPowerRecord, {
    useWattFieldKeys: true,
  });
  row.max_watts = clean.max_watts || null;
  row.max_1min_watts = clean.max_1min_watts || null;
  row.max_5min_watts = clean.max_5min_watts || null;
  row.max_10min_watts = clean.max_10min_watts || null;
  row.max_20min_watts = clean.max_20min_watts || null;
  row.max_40min_watts = clean.max_40min_watts || null;
  row.max_60min_watts = clean.max_60min_watts || null;
  return row;
}

module.exports = {
  PEAK_POWER_LIMITS,
  PEAK_POWER_WATT_FIELDS,
  PEAK_POWER_CASCADE_FIELDS,
  capPeakPowerMonotonicInPlace,
  cascadeZeroPeakPowerAfterValidationGap,
  sanitizePeakPowerProfile,
  capPeakWkgMonotonicInPlace,
  validatePeakPowerRecord,
  sanitizePeakPowerWattsOnRow,
};
