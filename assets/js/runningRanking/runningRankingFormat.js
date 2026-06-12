/**
 * 러닝 페이스 포맷·정렬용 유틸 (MM'SS" / MM:SS → 초/km)
 */
(function () {
  'use strict';

  /**
   * @param {string|null|undefined} paceStr — 예: 4'35", 4:35, 04'35"
   * @returns {number|null} 초/km (빠를수록 작음)
   */
  function parsePaceToSecPerKm(paceStr) {
    if (paceStr == null || paceStr === '' || paceStr === '—' || paceStr === '-') return null;
    var s = String(paceStr).trim();
    var m = s.match(/^(\d+)[':](\d{1,2})"?$/);
    if (m) {
      var min = parseInt(m[1], 10);
      var sec = parseInt(m[2], 10);
      if (!isFinite(min) || !isFinite(sec)) return null;
      return min * 60 + sec;
    }
    var m2 = s.match(/^(\d+):(\d{2})$/);
    if (m2) return parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10);
    return null;
  }

  /**
   * @param {number|null} secPerKm
   * @returns {string}
   */
  function formatPaceSecPerKm(secPerKm) {
    if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return '—';
    var min = Math.floor(secPerKm / 60);
    var sec = Math.round(secPerKm % 60);
    if (sec === 60) { min += 1; sec = 0; }
    return min + "'" + (sec < 10 ? '0' : '') + sec + '"';
  }

  /**
   * @param {number|null|undefined} kmh — m/s 또는 km/h (API speed_* 는 m/s)
   * @param {boolean} [isMetersPerSec=true]
   */
  function speedToPaceSecPerKm(speed, isMetersPerSec) {
    if (speed == null || !isFinite(speed) || speed <= 0) return null;
    var mps = isMetersPerSec !== false ? speed : speed / 3.6;
    if (mps <= 0) return null;
    return 1000 / mps;
  }

  function formatDistanceKm(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return '0.0';
    return n.toFixed(n >= 100 ? 0 : 1);
  }

  function formatScore(v) {
    var n = Number(v);
    if (!isFinite(n)) return '—';
    return n % 1 === 0 ? String(n) : n.toFixed(1);
  }

  function formatTss(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return '0';
    return n % 1 === 0 ? String(n) : n.toFixed(1);
  }

  function normalizeGender(g) {
    if (g == null) return '';
    var s = String(g).trim().toUpperCase();
    if (s === 'M' || s === 'MALE' || s === '남' || s === '남성') return 'M';
    if (s === 'F' || s === 'FEMALE' || s === '여' || s === '여성') return 'F';
    return s;
  }

  function formatPaceMmSs(secPerKm) {
    if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return '—';
    var min = Math.floor(secPerKm / 60);
    var sec = Math.round(secPerKm % 60);
    if (sec === 60) { min += 1; sec = 0; }
    return min + ':' + (sec < 10 ? '0' : '') + sec;
  }

  /** 아바타 오버레이용 — 05:10 형식 */
  function formatPaceOverlayMmSs(secPerKm) {
    if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return '—';
    var min = Math.floor(secPerKm / 60);
    var sec = Math.round(secPerKm % 60);
    if (sec === 60) { min += 1; sec = 0; }
    var minStr = min < 10 ? '0' + min : String(min);
    var secStr = sec < 10 ? '0' + sec : String(sec);
    return minStr + ':' + secStr;
  }

  window.runningRankingFormat = {
    parsePaceToSecPerKm: parsePaceToSecPerKm,
    formatPaceSecPerKm: formatPaceSecPerKm,
    formatPaceMmSs: formatPaceMmSs,
    formatPaceOverlayMmSs: formatPaceOverlayMmSs,
    speedToPaceSecPerKm: speedToPaceSecPerKm,
    formatDistanceKm: formatDistanceKm,
    formatScore: formatScore,
    formatTss: formatTss,
    normalizeGender: normalizeGender
  };
})();
