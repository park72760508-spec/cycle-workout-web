'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizePeakPowerProfile,
  validatePeakPowerRecord,
  capPeakWkgMonotonicInPlace,
} = require('./peakPowerMonotonic');

test('cascade: 5min·10min 검증 탈락 시 20min+ 무효', () => {
  const peaks = {
    max_watts: 1208,
    max_1min_watts: 1090,
    max_5min_watts: 848,
    max_10min_watts: 675,
    max_20min_watts: 454,
    max_40min_watts: 362,
    max_60min_watts: 317,
  };
  const out = sanitizePeakPowerProfile(peaks, 75, validatePeakPowerRecord, { useWattFieldKeys: true });
  assert.equal(out.max_20min_watts, 0);
  assert.equal(out.max_40min_watts, 0);
  assert.equal(out.max_60min_watts, 0);
  assert.ok(out.max_watts > 0);
});

test('capPeakWkgMonotonic: 20min > 10min 보정', () => {
  const wkg = { max: 8, '1min': 4.5, '5min': 4.01, '10min': 3.24, '20min': 6.05, '40min': 4.83, '60min': 4.23 };
  capPeakWkgMonotonicInPlace(wkg);
  assert.equal(wkg['20min'], 3.24);
  assert.equal(wkg['40min'], 3.24);
  assert.equal(wkg['60min'], 3.24);
});
