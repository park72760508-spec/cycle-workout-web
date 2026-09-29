/**
 * 워크아웃 훈련 난이도(별 1~5) — 아마추어(FTP 2.0~4.0 W/kg) 기준. 순수 함수(브라우저·Node 테스트 공용).
 *
 * 세그먼트의 목표 %FTP 만으로 판별한다(개인 FTP 와 무관 — 같은 워크아웃은 누구에게나 같은 별 수).
 * 세 가지 축을 각각 1~5 로 매긴 뒤 가중 평균:
 *  1) 강도 IF (40%)   : 4제곱 평균 %FTP(정규화 파워와 같은 방식) ÷ 100.
 *                       아마추어가 1시간을 버틸 수 있는 한계가 IF 0.85~0.90 부근이라 이 구간을 4~5단계로 둔다.
 *  2) 고강도 누적 (35%): 강도별 가중 분 — 템포 82~87% ×0.25, 스위트스팟 88~94% ×0.5, 역치 95~105% ×1,
 *                       VO2max 106~120% ×1.6, 무산소 120% 초과 ×2.2 를 합산.
 *                       아마추어는 역치 누적 20분·VO2max 누적 12~15분 부근에서 한계에 닿고,
 *                       SST 30분(=15점)도 확실히 "힘든" 세션이라 4·12·22·32 경계로 나눈다.
 *  3) 부하 TSS (25%)  : 시간(h) × IF² × 100. 주 300~500 TSS 를 소화하는 아마추어의 한 세션 기준.
 */
(function (root) {
  'use strict';

  /** %FTP → 고강도 누적 가중치 */
  function hardWeight(p) {
    if (p > 120) return 2.2;
    if (p > 105) return 1.6;
    if (p >= 95) return 1;
    if (p >= 88) return 0.5;
    if (p >= 82) return 0.25;
    return 0;
  }

  function num(v) {
    var n = Number(String(v == null ? '' : v).trim());
    return isFinite(n) ? n : NaN;
  }

  /** 난이도 판별용 대표 %FTP — 구간(ftp_pctz)은 중앙값, dual 은 앞값(FTP%), 램프는 시작·끝 평균, rpm 전용은 60% */
  function segmentPct(seg) {
    if (!seg) return NaN;
    var type = String(seg.target_type || 'ftp_pct').toLowerCase();
    if (type === 'cadence_rpm') return 60;
    var raw = seg.target_value;
    var pct;
    if (type === 'ftp_pctz' || type === 'dual') {
      var parts = String(raw == null ? '' : raw).split(/[~/]/).map(num).filter(function (n) { return isFinite(n); });
      if (!parts.length) return NaN;
      pct = type === 'ftp_pctz' && parts.length >= 2 ? (parts[0] + parts[1]) / 2 : parts[0];
    } else {
      pct = num(raw);
    }
    if (!(pct > 0)) return NaN;
    if (seg.ramp === 'linear') {
      var to = num(seg.ramp_to_value);
      if (to > 0) pct = (pct + to) / 2;
    }
    return pct;
  }

  function segmentSec(seg) {
    var d = Number(seg && (seg.duration_sec != null ? seg.duration_sec : seg.duration));
    return isFinite(d) && d > 0 ? d : 0;
  }

  function band(v, cuts) {
    // cuts: 오름차순 경계 4개 → 1~5
    for (var i = 0; i < cuts.length; i++) if (v < cuts[i]) return i + 1;
    return 5;
  }

  /**
   * @param {object[]} segments
   * @returns {{ stars: number, if: number, tss: number, hardLoad: number,
   *   parts: { intensity: number, density: number, load: number } } | null}
   */
  function computeWorkoutDifficulty(segments) {
    if (!Array.isArray(segments) || !segments.length) return null;
    var total = 0;
    var p4 = 0;
    var hardLoad = 0;
    for (var i = 0; i < segments.length; i++) {
      var d = segmentSec(segments[i]);
      if (!d) continue;
      var p = segmentPct(segments[i]);
      if (!(p > 0)) p = 50;
      total += d;
      p4 += d * Math.pow(p / 100, 4);
      hardLoad += (d / 60) * hardWeight(p);
    }
    if (!total) return null;
    var IF = Math.pow(p4 / total, 0.25);
    var tss = (total / 3600) * IF * IF * 100;

    var intensity = band(IF, [0.7, 0.77, 0.84, 0.9]);
    var density = band(hardLoad, [4, 12, 22, 32]);
    var load = band(tss, [40, 60, 80, 100]);

    var stars = Math.round(0.4 * intensity + 0.35 * density + 0.25 * load);
    stars = Math.max(1, Math.min(5, stars));
    return {
      stars: stars,
      if: Math.round(IF * 100) / 100,
      tss: Math.round(tss),
      hardLoad: Math.round(hardLoad * 10) / 10,
      parts: { intensity: intensity, density: density, load: load }
    };
  }

  var api = { computeWorkoutDifficulty: computeWorkoutDifficulty, segmentPct: segmentPct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.stelvioWorkoutDifficulty = api;
})(typeof window !== 'undefined' ? window : null);
