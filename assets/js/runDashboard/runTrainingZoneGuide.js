/**
 * STELVIO RUN — 5단계 트레이닝 존(Z1~Z5) 가이드 · 헥사곤 처방 · 추천 훈련 팝업
 * CYCLE 파워 존과 분리된 러닝 페이스·심박 기준 매트릭스
 */
(function () {
  'use strict';

  var HEXAGON_AXES = ['1k', '3k', '5k', '7k', '10k', '20k'];

  /** 체육학 표준 RUN 5단계 트레이닝 존 매트릭스 */
  var RUN_TRAINING_ZONES = {
    Z1: {
      zone: 'Z1',
      title: 'Recovery Jog',
      subtitle: '회복 조깅',
      category: 'recovery',
      workouts: ['Recovery Jog (Z1)'],
      physiology: '젖산 제거, 고강도 훈련 후 근육 내 혈류 공급 촉진.',
      sessionGuide: '대화가 완벽히 가능한 아주 느린 페이스로 20~30분간 가볍게 뛰기. 심박수는 최대심박수의 60% 이하 유지.',
      hrHint: '≤ 60% HRmax',
      duration: '20~30분',
      accent: '#3F51B5',
      accentBg: 'linear-gradient(135deg, #E8EAF6 0%, #C5CAE9 100%)',
      emoji: '🌿'
    },
    Z2: {
      zone: 'Z2',
      title: 'Easy Run / Long Run',
      subtitle: '일반 조깅 · LSD',
      category: 'endurance',
      workouts: ['Easy Run (Z2)', 'Long Run (Z2)'],
      physiology: '미토콘드리아 밀도 증가, 지방 대사 효율 극대화.',
      sessionGuide: '40분에서 2시간 사이의 지속주(LSD). 마라톤 완주 능력을 기르는 핵심 존이며, STELVIO 헥사곤의 장거리(10k, 20k) 축을 다지는 기본 베이스 훈련.',
      hrHint: '60~70% HRmax',
      duration: '40분 ~ 2시간',
      accent: '#2196F3',
      accentBg: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 100%)',
      emoji: '🏃'
    },
    Z3: {
      zone: 'Z3',
      title: 'Steady Run / Tempo Run',
      subtitle: '템포런',
      category: 'tempo',
      workouts: ['Steady Run (Z3)', 'Tempo Run (Z3)'],
      physiology: '유산소 한계 능력 확장 및 지속 속도 향상.',
      sessionGuide: '제법 힘이 들지만 멈추지 않고 유지할 수 있는 강도로 30~50분간 일정하게 달리기. 5k, 7k 중거리 기량 향상에 핵심적인 세션.',
      hrHint: '70~80% HRmax',
      duration: '30~50분',
      accent: '#4CAF50',
      accentBg: 'linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 100%)',
      emoji: '⚡'
    },
    Z4: {
      zone: 'Z4',
      title: 'Threshold Intervals',
      subtitle: '크루즈 인터벌 · 역치런',
      category: 'high_intensity',
      workouts: ['Threshold Intervals (Z4)'],
      physiology: '젖산 역치(LT) 지점 확장. 신체가 젖산을 축적하지 않고 버틸 수 있는 한계 속도(TP)를 끌어올림.',
      sessionGuide: '5~10분 전력 질주 후 1~2분 휴식을 3~4회 반복하는 크루즈 인터벌(Cruise Intervals). STELVIO 대시보드의 메인 역치 페이스를 직접적으로 성장시키는 핵심 훈련.',
      hrHint: '80~90% HRmax',
      duration: '3~4 × (5~10분)',
      accent: '#F9A825',
      accentBg: 'linear-gradient(135deg, #FFF8E1 0%, #FFECB3 100%)',
      emoji: '🎯'
    },
    Z5: {
      zone: 'Z5',
      title: 'VO₂max Intervals',
      subtitle: '고강도 인터벌',
      category: 'high_intensity',
      workouts: ['VO₂max Intervals (Z5)'],
      physiology: '최대산소섭취량 확대, 심폐 한계 극복 및 신경근 유연성(스피드) 향상.',
      sessionGuide: '3~4분간 숨이 턱 끝까지 차오르는 최대 한계 속도로 달린 후, 2~3분 완전 휴식(또는 가벼운 조깅)을 4~5회 반복. 1k, 3k 단거리 축의 피크를 찍기 위한 필수 훈련.',
      hrHint: '90~100% HRmax',
      duration: '4~5 × (3~4분)',
      accent: '#FF5722',
      accentBg: 'linear-gradient(135deg, #FBE9E7 0%, #FFCCBC 100%)',
      emoji: '🔥'
    }
  };

  var CATEGORY_DEFAULTS = {
    recovery: {
      category: 'recovery',
      primaryZone: 'Z1',
      allowedWorkouts: ['Recovery Jog (Z1)', 'Easy Run (Z2)'],
      reason: '컨디션 점수 또는 최근 RUN 부하를 고려해 Z1 회복 조깅을 권장합니다.'
    },
    endurance: {
      category: 'endurance',
      primaryZone: 'Z2',
      allowedWorkouts: ['Easy Run (Z2)', 'Long Run (Z2)'],
      reason: '중간 수준의 컨디션에 알맞은 Z2 지구력 러닝을 권장합니다.'
    },
    tempo: {
      category: 'tempo',
      primaryZone: 'Z3',
      allowedWorkouts: ['Steady Run (Z3)', 'Tempo Run (Z3)'],
      reason: '안정적인 컨디션으로 Z3 템포런이 적합합니다.'
    },
    high_intensity: {
      category: 'high_intensity',
      primaryZone: 'Z4',
      allowedWorkouts: ['Threshold Intervals (Z4)', 'VO₂max Intervals (Z5)'],
      reason: '컨디션이 우수하고 rTSS 부하에 여유가 있어 Z4~Z5 고강도 러닝을 권장합니다.'
    }
  };

  var HEXAGON_PRESCRIPTION = {
    long_distance_gap: {
      category: 'endurance',
      primaryZone: 'Z2',
      allowedWorkouts: ['Long Run (Z2)', 'Easy Run (Z2)'],
      recommendedWorkout: 'Long Run (Z2)',
      reason:
        '최근 90일간 10k/20k 장거리 마일리지 기록이 비어 있어 헥사곤 그래프의 유산소 베이스 축이 무너져 있습니다. 이번 주에는 미토콘드리아 밀도를 높이고 초지구력을 보완할 수 있도록 Z2 등급의 장거리 지속주를 통해 프로필을 확장해 보세요.'
    },
    short_speed_gap: {
      category: 'high_intensity',
      primaryZone: 'Z5',
      allowedWorkouts: ['VO₂max Intervals (Z5)'],
      recommendedWorkout: 'VO₂max Intervals (Z5)',
      reason:
        '현재 6축 헥사곤 프로필 중 단거리(1k/3k) 스피드 영역의 데이터가 공백 상태입니다. 장거리 지구력과 밸런스를 맞추기 위해, 향후 컨디션이 회복되는 대로 최대산소섭취량(VO₂max) 자극을 위한 단거리 피크 기록 갱신을 추천합니다.'
    },
    threshold_pace: {
      category: 'high_intensity',
      primaryZone: 'Z4',
      allowedWorkouts: ['Threshold Intervals (Z4)'],
      recommendedWorkout: 'Threshold Intervals (Z4)',
      reason:
        '회원님의 메인 역치 페이스(Threshold Pace)를 직접적으로 끌어올릴 타이밍입니다. 신체가 젖산을 축적하지 않고 버티는 한계를 확장하기 위해 Z4 등급의 Threshold Intervals(크루즈 인터벌) 훈련을 추천합니다.'
    }
  };

  function isHexSegmentMissing(hexagon, key) {
    var seg = hexagon && hexagon[key];
    if (!seg) return true;
    return !!(seg.missing || seg.is_penalty_applied || seg.calculated_pace == null || seg.calculated_pace === '');
  }

  function analyzeRunHexagonGaps(hexagonContext) {
    var hex = (hexagonContext && hexagonContext.hexagon) || {};
    var missingAxes = [];
    HEXAGON_AXES.forEach(function (key) {
      if (isHexSegmentMissing(hex, key)) missingAxes.push(key);
    });
    return {
      missingLong: isHexSegmentMissing(hex, '10k') || isHexSegmentMissing(hex, '20k'),
      missingShort: isHexSegmentMissing(hex, '1k') || isHexSegmentMissing(hex, '3k'),
      missingMid: isHexSegmentMissing(hex, '5k') || isHexSegmentMissing(hex, '7k'),
      missingAxes: missingAxes,
      missingCount: missingAxes.length
    };
  }

  /**
   * 6축 헥사곤 공백 기반 맞춤 처방 (Task B)
   * @returns {object|null}
   */
  function resolveRunHexagonPrescription(gaps, conditionScore, baseCategory) {
    if (!gaps) return null;
    if (baseCategory === 'recovery') return null;

    if (gaps.missingLong && conditionScore >= 73) {
      return Object.assign({ hexagonOverride: 'long_distance_gap' }, HEXAGON_PRESCRIPTION.long_distance_gap);
    }
    if (gaps.missingShort && conditionScore >= 82 && !gaps.missingLong) {
      return Object.assign({ hexagonOverride: 'short_speed_gap' }, HEXAGON_PRESCRIPTION.short_speed_gap);
    }
    if (gaps.missingMid && conditionScore >= 73 && !gaps.missingLong && !gaps.missingShort) {
      if (conditionScore >= 82) {
        return Object.assign({ hexagonOverride: 'threshold_pace' }, HEXAGON_PRESCRIPTION.threshold_pace);
      }
      return {
        hexagonOverride: 'threshold_pace',
        category: 'tempo',
        primaryZone: 'Z4',
        allowedWorkouts: ['Threshold Intervals (Z4)', 'Tempo Run (Z3)'],
        recommendedWorkout: 'Threshold Intervals (Z4)',
        reason: HEXAGON_PRESCRIPTION.threshold_pace.reason
      };
    }
    return null;
  }

  /**
   * 3단계 통합 헥사곤 진단 문장 (결측 4+ / 1~3 / rTSS 연동)
   * @param {{ hexagonContext?: object, last7DaysRtss?: number, weeklyRtssGoal?: number, baseReason?: string, hexagonOverride?: string, conditionScore?: number }} opts
   * @returns {string}
   */
  function buildIntegratedRunWorkoutReason(opts) {
    opts = opts || {};
    var gaps = analyzeRunHexagonGaps(opts.hexagonContext || {});
    var missingCount = gaps.missingCount || 0;
    var parts = [];
    var hexDiag = '';

    if (missingCount >= 4) {
      hexDiag =
        '현재 최근 90일 슬라이딩 윈도우 내에 수행된 러닝 데이터가 부족하여, 6축 헥사곤(Hexagon) 기량 프로필이 전반적으로 비활성화된 상태입니다. ' +
        '현재 회원님의 정확한 역치 페이스(Threshold Pace)와 맞춤형 트레이닝 존을 정밀 측정하기 위해, 이번 주에는 신체 부담이 적은 Z1 회복 조깅으로 컨디션을 조율한 뒤 ' +
        '가벼운 거리별 베이스라인 테스트(Baseline Test)를 수행하여 헥사곤 프로필을 하나씩 채워보시는 것을 강력히 추천합니다.';
    } else if (missingCount >= 1 && missingCount <= 3) {
      if (opts.hexagonOverride === 'long_distance_gap' || gaps.missingLong) {
        hexDiag = HEXAGON_PRESCRIPTION.long_distance_gap.reason;
      } else if (opts.hexagonOverride === 'short_speed_gap' || gaps.missingShort) {
        hexDiag = HEXAGON_PRESCRIPTION.short_speed_gap.reason;
      } else if (opts.hexagonOverride === 'threshold_pace' || gaps.missingMid) {
        hexDiag = HEXAGON_PRESCRIPTION.threshold_pace.reason;
      }
    }

    if (hexDiag) {
      parts.push(hexDiag);
    } else if (opts.baseReason) {
      parts.push(String(opts.baseReason).trim());
    }

    var weeklyGoal = Number(opts.weeklyRtssGoal) || 0;
    var currentRtss = Math.round(Number(opts.last7DaysRtss) || 0);
    if (weeklyGoal > 0 && currentRtss < weeklyGoal) {
      if (currentRtss < weeklyGoal * 0.7) {
        parts.push(
          '현재 주간 rTSS 목표량(' + weeklyGoal + '점) 대비 누적 스코어가 ' + currentRtss +
          '점으로 절대적으로 부족한 상태이므로, 부상 위험을 최소화하면서 주간 마일리지를 점진적으로 쌓아 올릴 수 있는 Z1/Z2 기반의 유산소 볼륨 빌드업이 시급합니다.'
        );
      } else {
        parts.push(
          '주간 rTSS 목표(' + weeklyGoal + '점) 대비 현재 ' + currentRtss +
          '점으로, Jack Daniels 훈련 부하 곡선에 맞춰 유산소 볼륨을 점진적으로 보강하시면 대사 시스템 밸런스 유지에 도움이 됩니다.'
        );
      }
    }

    return parts.filter(function (p) { return p && String(p).trim(); }).join(' ');
  }

  /** @deprecated — buildIntegratedRunWorkoutReason 사용 */
  function buildMissingAxesNote(missingAxes) {
    if (!missingAxes || !missingAxes.length) return '';
    if (missingAxes.length >= 4) {
      return buildIntegratedRunWorkoutReason({ hexagonContext: { hexagon: {}, missingAxes: missingAxes } });
    }
    return buildIntegratedRunWorkoutReason({
      hexagonContext: {
        hexagon: (function () {
          var h = {};
          missingAxes.forEach(function (k) {
            h[k] = { missing: true, calculated_pace: null };
          });
          return h;
        })()
      }
    });
  }

  function logRunCoachReasonVerification(result, gaps) {
    if (!gaps || gaps.missingCount < 6) return;
    if (typeof console === 'undefined' || !console.log) return;
    console.log('[STELVIO RUN Coach] ===== 6축 전체 결측 검증 샘플 =====');
    console.log('[STELVIO RUN Coach] missing_count:', gaps.missingCount);
    console.log('[STELVIO RUN Coach] workout_category:', result && result.category);
    console.log('[STELVIO RUN Coach] recommended_workout:', result && result.recommendedWorkout);
    console.log('[STELVIO RUN Coach] workoutCategoryReason:\n', result && result.reason);
    console.log('[STELVIO RUN Coach] ===================================');
  }

  function parseRunWorkoutZone(workoutName) {
    var raw = String(workoutName || '').trim();
    var m = raw.match(/\(Z([1-5])\)/i);
    if (m) return 'Z' + m[1];
    if (/recovery/i.test(raw)) return 'Z1';
    if (/long run|easy run/i.test(raw)) return 'Z2';
    if (/steady|tempo/i.test(raw)) return 'Z3';
    if (/threshold|cruise/i.test(raw)) return 'Z4';
    if (/vo2|vo₂|intervals/i.test(raw) && /max/i.test(raw)) return 'Z5';
    return 'Z2';
  }

  function getRunZoneGuide(zoneKey) {
    return RUN_TRAINING_ZONES[zoneKey] || RUN_TRAINING_ZONES.Z2;
  }

  /**
   * 동일 입력 → 동일 출력. 허용 목록 중 AI·UI·팝업이 항상 같은 1개를 쓰도록 확정.
   * @param {{ category?: string, primaryZone?: string, training_zone?: string, hexagonOverride?: string, allowedWorkouts?: string[], recommendedWorkout?: string }} workoutDecision
   * @returns {string}
   */
  function pickDeterministicRunRecommendedWorkout(workoutDecision) {
    workoutDecision = workoutDecision || {};
    if (workoutDecision.recommendedWorkout) {
      return String(workoutDecision.recommendedWorkout);
    }

    var override = workoutDecision.hexagonOverride;
    if (override === 'long_distance_gap') return 'Long Run (Z2)';
    if (override === 'short_speed_gap') return 'VO₂max Intervals (Z5)';
    if (override === 'threshold_pace') return 'Threshold Intervals (Z4)';

    var category = workoutDecision.category;
    var zone = workoutDecision.primaryZone || workoutDecision.training_zone;

    if (category === 'recovery') return 'Recovery Jog (Z1)';
    if (category === 'endurance') return 'Easy Run (Z2)';
    if (category === 'tempo') return 'Tempo Run (Z3)';
    if (category === 'high_intensity') {
      if (zone === 'Z5') return 'VO₂max Intervals (Z5)';
      return 'Threshold Intervals (Z4)';
    }

    if (workoutDecision.allowedWorkouts && workoutDecision.allowedWorkouts.length) {
      return workoutDecision.allowedWorkouts[0];
    }
    return 'Recovery Jog (Z1)';
  }

  function finalizeRunWorkoutDecision(workoutDecision) {
    workoutDecision = workoutDecision || {};
    var workout = pickDeterministicRunRecommendedWorkout(workoutDecision);
    workoutDecision.recommendedWorkout = workout;
    workoutDecision.training_zone = parseRunWorkoutZone(workout);
    workoutDecision.primaryZone = workoutDecision.training_zone;
    return workoutDecision;
  }

  function zoneIllustrationSvg(zoneKey) {
    var z = getRunZoneGuide(zoneKey);
    var accent = z.accent;
    var paths = {
      Z1: '<path d="M20 70 Q35 55 50 62 Q65 68 80 58" stroke="' + accent + '" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.5"/><circle cx="50" cy="38" r="10" fill="' + accent + '" opacity="0.85"/><path d="M44 48 L46 62 M56 48 L54 62 M46 62 L42 72 M54 62 L58 72" stroke="' + accent + '" stroke-width="3" stroke-linecap="round"/>',
      Z2: '<path d="M12 68 Q28 58 44 64 Q60 70 76 60 Q88 52 92 58" stroke="' + accent + '" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="44" cy="36" r="10" fill="' + accent + '"/><path d="M38 46 L40 62 M50 46 L48 62 M40 62 L36 74 M48 62 L52 74" stroke="' + accent + '" stroke-width="3" stroke-linecap="round"/>',
      Z3: '<path d="M10 66 L30 58 L50 62 L70 54 L90 58" stroke="' + accent + '" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="50" cy="34" r="10" fill="' + accent + '"/><path d="M44 44 L46 60 M56 44 L54 60 M46 60 L42 70 M54 60 L58 70" stroke="' + accent + '" stroke-width="3" stroke-linecap="round"/>',
      Z4: '<rect x="14" y="52" width="18" height="8" rx="2" fill="' + accent + '" opacity="0.35"/><rect x="38" y="44" width="18" height="8" rx="2" fill="' + accent + '" opacity="0.55"/><rect x="62" y="36" width="18" height="8" rx="2" fill="' + accent + '" opacity="0.75"/><circle cx="50" cy="22" r="9" fill="' + accent + '"/><path d="M45 31 L47 44 M55 31 L53 44" stroke="' + accent + '" stroke-width="2.5" stroke-linecap="round"/>',
      Z5: '<path d="M16 62 L28 50 L40 58 L52 42 L64 52 L76 38 L88 48" stroke="' + accent + '" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="52" cy="24" r="9" fill="' + accent + '"/><path d="M47 33 L49 44 M57 33 L55 44" stroke="' + accent + '" stroke-width="2.5" stroke-linecap="round"/>'
    };
    return (
      '<svg viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg" class="run-zone-guide-svg" aria-hidden="true">' +
      (paths[zoneKey] || paths.Z2) +
      '</svg>'
    );
  }

  function injectRunWorkoutGuideStyles() {
    if (document.getElementById('runWorkoutGuideStyles')) return;
    var style = document.createElement('style');
    style.id = 'runWorkoutGuideStyles';
    style.textContent =
      '.run-workout-guide-modal{position:fixed;inset:0;z-index:100020;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;pointer-events:none;transition:opacity .25s ease}' +
      '.run-workout-guide-modal.is-open{opacity:1;pointer-events:auto}' +
      '.run-workout-guide-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px)}' +
      '.run-workout-guide-panel{position:relative;width:100%;max-width:440px;max-height:92vh;overflow-y:auto;border-radius:24px;background:#fff;box-shadow:0 24px 64px rgba(15,23,42,.22);animation:runGuideSlideUp .35s ease}' +
      '@keyframes runGuideSlideUp{from{transform:translateY(24px);opacity:0}to{transform:translateY(0);opacity:1}}' +
      '.run-workout-guide-close{position:absolute;top:14px;right:14px;width:36px;height:36px;border:none;border-radius:50%;background:rgba(255,255,255,.9);color:#475569;font-size:22px;cursor:pointer;z-index:2;box-shadow:0 2px 8px rgba(0,0,0,.08)}' +
      '.run-workout-guide-hero{padding:28px 24px 20px;text-align:center;border-radius:24px 24px 0 0}' +
      '.run-workout-guide-zone-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;color:#fff;margin-bottom:12px}' +
      '.run-workout-guide-title{font-size:22px;font-weight:800;color:#0f172a;margin:0 0 4px;line-height:1.25}' +
      '.run-workout-guide-subtitle{font-size:14px;color:#64748b;margin:0 0 16px}' +
      '.run-zone-guide-svg{width:120px;height:96px;margin:0 auto;display:block}' +
      '.run-workout-guide-body{padding:0 24px 24px}' +
      '.run-workout-guide-card{border-radius:16px;padding:16px;margin-bottom:12px;background:#f8fafc;border:1px solid #e2e8f0}' +
      '.run-workout-guide-card h4{margin:0 0 8px;font-size:13px;font-weight:700;color:#334155;display:flex;align-items:center;gap:6px}' +
      '.run-workout-guide-card p{margin:0;font-size:13px;line-height:1.65;color:#475569}' +
      '.run-workout-guide-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}' +
      '.run-workout-guide-meta-item{background:#f1f5f9;border-radius:12px;padding:10px 12px;text-align:center}' +
      '.run-workout-guide-meta-item span{display:block;font-size:11px;color:#64748b;margin-bottom:2px}' +
      '.run-workout-guide-meta-item strong{font-size:14px;color:#0f172a}' +
      '.run-workout-guide-reason{background:linear-gradient(135deg,#eff6ff 0%,#f0fdf4 100%);border:1px solid #bfdbfe;border-radius:16px;padding:16px;margin-bottom:16px}' +
      '.run-workout-guide-reason p{margin:0;font-size:13px;line-height:1.7;color:#1e3a5f}' +
      '.run-workout-guide-cta{width:100%;padding:14px;border:none;border-radius:14px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,#059669 0%,#0891b2 100%);box-shadow:0 4px 14px rgba(5,150,105,.3)}' +
      '.run-workout-guide-workout-name{font-size:17px;font-weight:800;color:#0f172a;margin-top:8px}';
    document.head.appendChild(style);
  }

  function ensureRunWorkoutGuideModal() {
    injectRunWorkoutGuideStyles();
    var modal = document.getElementById('runWorkoutGuideModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'runWorkoutGuideModal';
    modal.className = 'run-workout-guide-modal';
    modal.innerHTML =
      '<div class="run-workout-guide-backdrop" data-run-guide-close="1"></div>' +
      '<div class="run-workout-guide-panel" role="dialog" aria-modal="true" aria-labelledby="runWorkoutGuideTitle">' +
      '<button type="button" class="run-workout-guide-close" data-run-guide-close="1" aria-label="닫기">&times;</button>' +
      '<div id="runWorkoutGuideContent"></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) {
      if (e.target && e.target.getAttribute('data-run-guide-close') === '1') {
        closeRunWorkoutGuideModal();
      }
    });
    return modal;
  }

  function buildRunWorkoutGuideHtml(opts) {
    opts = opts || {};
    var zoneKey = opts.zoneKey || 'Z2';
    var zone = getRunZoneGuide(zoneKey);
    var workoutName = opts.workoutName || zone.workouts[0];
    var reason = opts.reason || zone.sessionGuide;
    var thresholdPace = opts.thresholdPace;
    var conditionScore = opts.conditionScore;

    var html =
      '<div class="run-workout-guide-hero" style="background:' + zone.accentBg + '">' +
      '<div class="run-workout-guide-zone-badge" style="background:' + zone.accent + '">' +
      zone.emoji + ' ' + zone.zone + ' · ' + zone.subtitle +
      '</div>' +
      '<h2 class="run-workout-guide-title" id="runWorkoutGuideTitle">' + zone.title + '</h2>' +
      '<p class="run-workout-guide-subtitle">오늘의 추천 RUN 세션</p>' +
      zoneIllustrationSvg(zoneKey) +
      '<div class="run-workout-guide-workout-name">' + workoutName + '</div>' +
      (conditionScore != null
        ? '<p style="margin:8px 0 0;font-size:12px;color:#64748b">컨디션 ' + Math.round(conditionScore) + '점 · rTSS 기반 처방</p>'
        : '') +
      '</div>' +
      '<div class="run-workout-guide-body">' +
      '<div class="run-workout-guide-meta">' +
      '<div class="run-workout-guide-meta-item"><span>권장 시간</span><strong>' + zone.duration + '</strong></div>' +
      '<div class="run-workout-guide-meta-item"><span>심박 가이드</span><strong>' + zone.hrHint + '</strong></div>' +
      '</div>';

    if (thresholdPace) {
      html +=
        '<div class="run-workout-guide-meta" style="grid-template-columns:1fr">' +
        '<div class="run-workout-guide-meta-item"><span>역치 페이스 (90일 10k 기준)</span><strong>' + thresholdPace + '</strong></div>' +
        '</div>';
    }

    html +=
      '<div class="run-workout-guide-card"><h4>🧬 생리학적 목표</h4><p>' + zone.physiology + '</p></div>' +
      '<div class="run-workout-guide-card"><h4>📋 세션 가이드</h4><p>' + zone.sessionGuide + '</p></div>' +
      '<div class="run-workout-guide-reason"><h4 style="margin:0 0 8px;font-size:13px;color:#1e40af">💬 AI 코치 처방 근거</h4><p>' + reason.replace(/\*\*/g, '') + '</p></div>' +
      '<button type="button" class="run-workout-guide-cta" data-run-guide-close="1">확인했습니다</button>' +
      '</div>';

    return html;
  }

  function showRunWorkoutGuideModal(userProfile, coachData, stats) {
    coachData = coachData || {};
    stats = stats || {};
    userProfile = userProfile || {};

    var workoutName =
      coachData.recommended_workout ||
      (typeof pickDeterministicRunRecommendedWorkout === 'function'
        ? pickDeterministicRunRecommendedWorkout({
            category: coachData.workout_category,
            primaryZone: coachData.training_zone,
            hexagonOverride: coachData.hexagon_override
          })
        : 'Recovery Jog (Z1)');
    var zoneKey = parseRunWorkoutZone(workoutName);
    var reason =
      coachData.workout_category_reason ||
      coachData.coach_comment ||
      getRunZoneGuide(zoneKey).sessionGuide;

    var modal = ensureRunWorkoutGuideModal();
    var content = document.getElementById('runWorkoutGuideContent');
    if (!content) return;

    content.innerHTML = buildRunWorkoutGuideHtml({
      zoneKey: zoneKey,
      workoutName: workoutName,
      reason: reason,
      thresholdPace: stats.thresholdPaceDisplay || userProfile.threshold_pace || null,
      conditionScore: coachData.condition_score
    });

    modal.classList.add('is-open');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeRunWorkoutGuideModal() {
    var modal = document.getElementById('runWorkoutGuideModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  window.RUN_TRAINING_ZONES = RUN_TRAINING_ZONES;
  window.RUN_TRAINING_ZONE_GUIDE = {
    RUN_TRAINING_ZONES: RUN_TRAINING_ZONES,
    CATEGORY_DEFAULTS: CATEGORY_DEFAULTS,
    HEXAGON_PRESCRIPTION: HEXAGON_PRESCRIPTION,
    analyzeRunHexagonGaps: analyzeRunHexagonGaps,
    resolveRunHexagonPrescription: resolveRunHexagonPrescription,
    buildMissingAxesNote: buildMissingAxesNote,
    buildIntegratedRunWorkoutReason: buildIntegratedRunWorkoutReason,
    logRunCoachReasonVerification: logRunCoachReasonVerification,
    parseRunWorkoutZone: parseRunWorkoutZone,
    getRunZoneGuide: getRunZoneGuide,
    pickDeterministicRunRecommendedWorkout: pickDeterministicRunRecommendedWorkout,
    finalizeRunWorkoutDecision: finalizeRunWorkoutDecision
  };
  window.showRunWorkoutGuideModal = showRunWorkoutGuideModal;
  window.closeRunWorkoutGuideModal = closeRunWorkoutGuideModal;
  window.parseRunWorkoutZone = parseRunWorkoutZone;
  window.pickDeterministicRunRecommendedWorkout = pickDeterministicRunRecommendedWorkout;
  window.finalizeRunWorkoutDecision = finalizeRunWorkoutDecision;
  window.buildIntegratedRunWorkoutReason = buildIntegratedRunWorkoutReason;
})();
