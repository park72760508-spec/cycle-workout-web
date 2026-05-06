/**
 * STELVIO 글로벌 개정 TSS (rTSS) — W/kg 가중치 + kJ 가드레일
 * 체중 미설정 시 호출부에서 STELVIO_RTSS_DEFAULT_WEIGHT_KG(70)를 넘기도록 사용합니다.
 */
(function (global) {
  'use strict';

  var STELVIO_RTSS_DEFAULT_WEIGHT_KG = 70;

  /**
   * @param {number} durationSec
   * @param {number} avgPower - 평균 파워 (W)
   * @param {number} np - Normalized Power (W)
   * @param {number} ftp
   * @param {number} weight - 체중 (kg)
   * @returns {number} rTSS 소수 첫째 자리
   */
  function calculateStelvioRevisedTSS(durationSec, avgPower, np, ftp, weight) {
    var d = Number(durationSec);
    var npN = Number(np);
    var ftpN = Number(ftp);
    var w = Number(weight);
    var avgN = Number(avgPower);
    if (!ftpN || !w || ftpN <= 0 || w <= 0) return 0;
    if (npN <= 0 || avgN <= 0) return 0;
    if (!d || d <= 0) return 0;

    var ifFactor = npN / ftpN;
    var baseTSS = ((d * npN * ifFactor) / (ftpN * 3600)) * 100;
    var totalKJ = (avgN * d) / 1000;
    if (totalKJ <= 0) return 0;

    var wPerKg = ftpN / w;
    var wFactor = Math.pow(3.0 / wPerKg, 0.15);
    wFactor = Math.max(0.8, Math.min(1.2, wFactor));

    var adjustedTSS = baseTSS * wFactor;
    var tssPerKJ = adjustedTSS / totalKJ;

    if (wPerKg < 2.5) {
      if (tssPerKJ > 15.0) adjustedTSS = totalKJ * 15.0;
    } else if (wPerKg > 4.0) {
      if (tssPerKJ < 6.0) adjustedTSS = totalKJ * 6.0;
    }

    return Math.round(adjustedTSS * 10) / 10;
  }

  global.STELVIO_RTSS_DEFAULT_WEIGHT_KG = STELVIO_RTSS_DEFAULT_WEIGHT_KG;
  global.calculateStelvioRevisedTSS = calculateStelvioRevisedTSS;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
