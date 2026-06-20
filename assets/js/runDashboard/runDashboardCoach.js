/**
 * RUN 대시보드 AI 컨디션·워크아웃 — CYCLE callGeminiCoach와 분리된 진입점
 * sportCategory·프로필 category를 항상 RUN으로 고정
 */
(function () {
  'use strict';

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
    if (result && typeof window.pickDeterministicRunRecommendedWorkout === 'function') {
      result.sport_category = 'run';
      result.recommended_workout = window.pickDeterministicRunRecommendedWorkout({
        category: result.workout_category,
        primaryZone: result.training_zone,
        hexagonOverride: result.hexagon_override,
        recommendedWorkout: result.recommended_workout
      });
    }
    return result;
  }

  window.callRunGeminiCoach = callRunGeminiCoach;
})();
