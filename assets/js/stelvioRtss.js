/**
 * STELVIO 글로벌 개정 TSS (rTSS) — W/kg 가중치
 * 체중 미설정 시 호출부에서 STELVIO_RTSS_DEFAULT_WEIGHT_KG(70)를 넘기도록 사용합니다.
 *
 * [수정 이력]
 * - kJ 가드레일 재설계:
 *   구버전의 wPerKg > 4.0 구간 floor(최솟값) 6.0 TSS/kJ는
 *   정상 라이딩의 실제 TSS/kJ(0.05~0.8 범위)보다 10~100배 높아
 *   FTP ÷ 체중 > 4.0 W/kg 사용자의 TSS를 수십 배 과대 계산하는 치명적 버그였음.
 *   (예: FTP 290W / 70kg → 1시간 FTP 라이딩 시 TSS 6264 → 정상값 100)
 *   구버전의 wPerKg < 2.5 구간 cap 15.0 TSS/kJ도 지나치게 높아 함께 수정.
 *   변경 후: 1.5 TSS/kJ 단일 상한(실제 최대 허용치) + 500 TSS 절대 상한 적용.
 */
(function (global) {
  'use strict';

  var STELVIO_RTSS_DEFAULT_WEIGHT_KG = 70;

  /**
   * 지속시간별 생리학적으로 타당한 IF(강도계수=NP/FTP) 상한 — functions/index.js와 동일 로직.
   * FTP는 "약 60분간 유지 가능한 최대 파워"로 정의되므로, 60~90분을 넘어서는 라이딩에서
   * IF 1.0 이상을 수 시간 유지하는 것은 생리학적으로 불가능하다(가능하다면 그 라이딩의
   * NP가 실제 FTP에 더 가깝다는 뜻). FTP가 실제보다 낮게 설정된 사용자의 장시간 라이딩에서
   * TSS가 IF²에 비례해 폭증하는 문제를 막기 위해 라이딩 시간별 IF 상한을 둔다.
   */
  function maxPlausibleIntensityFactorForDuration(durationSec) {
    var min = Number(durationSec) / 60;
    if (min <= 20) return 1.3;
    if (min <= 60) return 1.1;
    if (min <= 90) return 0.98;
    if (min <= 180) return 0.88;
    if (min <= 300) return 0.8;
    return 0.72;
  }

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

    var rawIfFactor = npN / ftpN;
    var ifCap = maxPlausibleIntensityFactorForDuration(d);
    var ifFactor = Math.min(rawIfFactor, ifCap);
    var baseTSS = (d / 3600) * ifFactor * ifFactor * 100;
    var totalKJ = (avgN * d) / 1000;
    if (totalKJ <= 0) return 0;

    // W/kg 가중치 보정 (±20% 범위 내 미세 조정)
    var wPerKg = ftpN / w;
    var wFactor = Math.pow(3.0 / wPerKg, 0.15);
    wFactor = Math.max(0.8, Math.min(1.2, wFactor));

    var adjustedTSS = baseTSS * wFactor;

    // TSS/kJ 상한 — 정상 라이딩 최대 허용치(1.5 TSS/kJ)를 초과하면 보정
    // (비정상 FTP 입력값에 의한 폭발적 TSS 계산 방지)
    var tssPerKJ = adjustedTSS / totalKJ;
    if (tssPerKJ > 1.5) {
      adjustedTSS = totalKJ * 1.5;
    }

    // 단일 세션 절대 상한: 약 8시간 극한 레이스 기준 500 TSS
    if (adjustedTSS > 500) {
      adjustedTSS = 500;
    }

    return Math.round(adjustedTSS * 10) / 10;
  }

  global.STELVIO_RTSS_DEFAULT_WEIGHT_KG = STELVIO_RTSS_DEFAULT_WEIGHT_KG;
  global.calculateStelvioRevisedTSS = calculateStelvioRevisedTSS;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
