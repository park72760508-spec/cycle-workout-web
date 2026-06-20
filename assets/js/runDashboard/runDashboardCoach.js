/**
 * RUN 대시보드 AI 컨디션·워크아웃 — CYCLE callGeminiCoach와 분리된 진입점
 * sportCategory·프로필 category를 항상 RUN으로 고정
 */
(function () {
  'use strict';

  function isRunCoachPayload(data) {
    if (!data || data.condition_score == null) return false;
    if (data.sport_category === 'run') return true;
    if (data.error_reason) return false;
    var rw = String(data.recommended_workout || '');
    if (typeof window.isRunWorkoutLabel === 'function' && window.isRunWorkoutLabel(rw)) return true;
    if (typeof window.mapCycleWorkoutLabelToRun === 'function' && window.mapCycleWorkoutLabelToRun(rw)) {
      return false;
    }
    var cat = String(data.workout_category || '');
    if (cat === 'recovery' || cat === 'endurance' || cat === 'tempo' || cat === 'high_intensity') {
      return true;
    }
    return false;
  }

  function normalizeRunCoachPayload(analysis) {
    if (!analysis) return analysis;
    var next = Object.assign({}, analysis);
    next.sport_category = 'run';
    if (typeof window.pickDeterministicRunRecommendedWorkout === 'function') {
      next.recommended_workout = window.pickDeterministicRunRecommendedWorkout({
        category: next.workout_category,
        primaryZone: next.training_zone,
        hexagonOverride: next.hexagon_override,
        recommendedWorkout: next.recommended_workout
      });
    }
    if (typeof window.parseRunWorkoutZone === 'function') {
      next.training_zone = window.parseRunWorkoutZone(next.recommended_workout);
    }
    if (next.coach_comment && typeof next.coach_comment === 'string') {
      next.coach_comment = next.coach_comment
        .replace(/\brTSS\b/g, '__RTSS__')
        .replace(/\bTSS\b/g, 'rTSS')
        .replace(/__RTSS__/g, 'rTSS');
    }
    if (next.training_status === 'Building Base') {
      next.training_status = '기초 강화';
    }
    return next;
  }

  async function callRunGeminiCoach(userProfile, recentLogs, last7DaysRtss, options) {
    if (typeof window.callGeminiCoach !== 'function') {
      throw new Error('callGeminiCoach 함수 없음');
    }
    var profile = Object.assign({}, userProfile || {}, {
      sport_category: 'RUN',
      category: 'RUN'
    });
    var opts = Object.assign({}, options || {}, { sportCategory: 'run' });
    var result = await window.callGeminiCoach(profile, recentLogs, last7DaysRtss, opts);
    return normalizeRunCoachPayload(result);
  }

  window.callRunGeminiCoach = callRunGeminiCoach;
  window.normalizeRunCoachPayload = normalizeRunCoachPayload;
  window.isRunCoachPayload = isRunCoachPayload;
})();
