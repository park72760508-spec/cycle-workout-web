/**
 * Stelvio AI 분석 공통 — 컨디션 점수 모듈
 * 훈련 부하·휴식·피로·연령·성별·훈련목적·최근 30일 로그를 반영하여 50~100점(1점 단위) 객관 산출
 * 체육학·역학·신체 연구 기반 참고 지표: TSS, ACWR, 일관성, 회복, 트렌드
 * @see docs/컨디션_점수_반영_기준.md
 */
(function (global) {
  'use strict';

  var MIN_SCORE = 50;
  var MAX_SCORE = 100;

  /**
   * 로그 항목을 공통 형식으로 정규화
   * @param {Object} log - { completed_at|date, duration_min|duration_sec, tss, avg_power|avg_watts, np|weighted_watts }
   * @returns {{ dateStr: string, durationMin: number, tss: number, avgPower: number, np: number }}
   */
  function normalizeLog(log) {
    var dateStr = '';
    if (log.completed_at) {
      var d = typeof log.completed_at === 'string' ? new Date(log.completed_at) : log.completed_at;
      dateStr = d.toISOString ? d.toISOString().split('T')[0] : String(log.completed_at).split('T')[0];
    } else if (log.date) {
      var d2 = log.date;
      if (d2 && typeof d2.toDate === 'function') d2 = d2.toDate();
      dateStr = d2 && d2.toISOString ? d2.toISOString().split('T')[0] : String(d2 || '').split('T')[0];
    }
    var durationMin = Number(log.duration_min) || Math.round(Number(log.duration_sec || log.duration || 0) / 60) || 0;
    var tss = Math.round(Number(log.tss || 0));
    var avgPower = Math.round(Number(log.avg_power || log.avg_watts || 0));
    var np = Math.round(Number(log.np || log.weighted_watts || log.avg_power || log.avg_watts || 0));
    return { dateStr: dateStr, durationMin: durationMin, tss: tss, avgPower: avgPower, np: np };
  }

  /**
   * 컨디션 점수용 로그 중복 제거 (1번·2번 동일 규칙)
   * 동일 세션 = 같은 날짜 + 같은 시간 + 같은 TSS → workout_name이 달라도 1회로 카운트 (훈련일지와 일치)
   * @param {Array} logs - 원본 로그 배열 (completed_at|date, duration_min|duration_sec, tss, workout_name|title 등)
   * @returns {Array} - 중복 제거된 로그 배열 (첫 번째 발생만 유지)
   */
  function dedupeLogsForConditionScore(logs) {
    if (!logs || !logs.length) return [];
    var seen = {};
    return logs.filter(function (log) {
      var dateStr = '';
      if (log.completed_at) {
        var d = typeof log.completed_at === 'string' ? new Date(log.completed_at) : log.completed_at;
        dateStr = d && d.toISOString ? d.toISOString().split('T')[0] : String(log.completed_at).split('T')[0];
      } else if (log.date) {
        var d2 = log.date;
        if (d2 && typeof d2.toDate === 'function') d2 = d2.toDate();
        dateStr = d2 && d2.toISOString ? d2.toISOString().split('T')[0] : String(d2 || '').split('T')[0];
      }
      var durationMin = Number(log.duration_min) || Math.round(Number(log.duration_sec || log.duration || 0) / 60) || 0;
      var tss = Math.round(Number(log.tss || 0));
      var key = dateStr + '|' + durationMin + '|' + tss;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  /**
   * 최근 30일 로그만 필터(날짜 문자열 YYYY-MM-DD 기준, 정확히 30일: today-29 ~ today)
   */
  function filterLast30Days(logs, todayStr) {
    if (!todayStr || !logs.length) return logs;
    var d = new Date(todayStr + 'T12:00:00');
    var start = new Date(d);
    start.setDate(start.getDate() - 29);
    var startStr = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0');
    return logs.filter(function (l) {
      var ds = l.dateStr || '';
      return ds >= startStr && ds <= todayStr;
    });
  }

  /**
   * 주별 TSS 배열 계산 (4주: [week1, week2, week3, week4], week4가 최근)
   */
  function weeklyTSSFromLogs(logs, todayStr) {
    var weeks = [0, 0, 0, 0];
    if (!todayStr || !logs.length) return weeks;
    var base = new Date(todayStr + 'T12:00:00');
    for (var i = 0; i < logs.length; i++) {
      var ds = logs[i].dateStr;
      if (!ds) continue;
      var logDate = new Date(ds + 'T12:00:00');
      var diffDays = Math.floor((base - logDate) / 86400000);
      if (diffDays < 0) continue;
      if (diffDays <= 7) weeks[3] += logs[i].tss || 0;
      else if (diffDays <= 14) weeks[2] += logs[i].tss || 0;
      else if (diffDays <= 21) weeks[1] += logs[i].tss || 0;
      else if (diffDays <= 30) weeks[0] += logs[i].tss || 0;
    }
    return weeks;
  }

  /**
   * 컨디션 점수 산출 (50~100, 1점 단위)
   * @param {Object} user - { age, gender, challenge, ftp, weight } (선택)
   * @param {Array} recentLogs - 최근 30일 훈련 로그 (completed_at|date, duration_min|duration_sec, tss, avg_power, np 등)
   * @param {string} [todayStr] - 기준일 YYYY-MM-DD (미지정 시 오늘)
   * @returns {{ score: number, details: Object }}
   */
  function computeConditionScore(user, recentLogs, todayStr) {
    user = user || {};
    recentLogs = recentLogs || [];
    var today = todayStr ? new Date(todayStr + 'T12:00:00') : new Date();
    todayStr = todayStr || (today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0'));

    var normalized = recentLogs.map(normalizeLog);
    var logs = filterLast30Days(normalized, todayStr);
    var totalSessions = logs.length;
    var totalTSS = logs.reduce(function (sum, l) { return sum + (l.tss || 0); }, 0);
    var weeklyTSS = totalTSS / 4.3;
    var sessionsPerWeek = totalSessions / 4.3;

    var sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    var start7Str = sevenDaysAgo.getFullYear() + '-' + String(sevenDaysAgo.getMonth() + 1).padStart(2, '0') + '-' + String(sevenDaysAgo.getDate()).padStart(2, '0');
    var last7 = logs.filter(function (l) { var d = l.dateStr || ''; return d >= start7Str && d <= todayStr; });
    var last7DaysTSS = last7.reduce(function (sum, l) { return sum + (l.tss || 0); }, 0);
    var last7DaysSessions = last7.length;

    var weeks = weeklyTSSFromLogs(logs, todayStr);
    var chronic28 = totalTSS - last7DaysTSS;
    var chronicWeekly = chronic28 / 23 * 7;
    var acwr = chronicWeekly >= 1 ? last7DaysTSS / chronicWeekly : (last7DaysTSS > 0 ? 1.5 : 0.5);

    var restDaysPerWeek = Math.max(0, (30 - totalSessions) / 4.3);

    var age = Number(user.age) || null;
    var gender = (user.gender && String(user.gender).trim()) || '';
    var challenge = (user.challenge && String(user.challenge).trim()) || 'Fitness';
    var ftp = Number(user.ftp) || 200;

    // --- 1. 일관성 (0~12): 주당 훈련 횟수
    var consistencyScore = 0;
    if (sessionsPerWeek >= 3 && sessionsPerWeek <= 5) consistencyScore = 12;
    else if (sessionsPerWeek >= 2 && sessionsPerWeek < 3) consistencyScore = 8;
    else if (sessionsPerWeek >= 1 && sessionsPerWeek < 2) consistencyScore = 5;
    else if (sessionsPerWeek >= 5 && sessionsPerWeek <= 7) consistencyScore = 10;
    else if (sessionsPerWeek > 7) consistencyScore = 6;
    else if (totalSessions > 0) consistencyScore = 3;

    // --- 2. 부하 적정성 (0~12): 주간 TSS (목적별 참고)
    var loadScore = 0;
    var loadOptimalLow = 100;
    var loadOptimalHigh = 400;
    if (challenge === 'PRO' || challenge === 'Elite') {
      loadOptimalLow = 200;
      loadOptimalHigh = 600;
    } else if (challenge === 'Racing') {
      loadOptimalLow = 150;
      loadOptimalHigh = 500;
    } else if (challenge === 'GranFondo') {
      loadOptimalLow = 120;
      loadOptimalHigh = 450;
    }
    if (weeklyTSS >= loadOptimalLow && weeklyTSS <= loadOptimalHigh) loadScore = 12;
    else if (weeklyTSS >= loadOptimalLow * 0.7 && weeklyTSS < loadOptimalLow) loadScore = 8;
    else if (weeklyTSS > loadOptimalHigh && weeklyTSS <= loadOptimalHigh * 1.5) loadScore = 8;
    else if (weeklyTSS >= 50 && weeklyTSS < loadOptimalLow * 0.7) loadScore = 5;
    else if (weeklyTSS > loadOptimalHigh * 1.5) loadScore = 4;
    else if (weeklyTSS > 0 && weeklyTSS < 50) loadScore = 3;
    else if (totalSessions > 0) loadScore = 2;

    // --- 3. 회복 (0~8): 주당 휴식일
    var recoveryScore = 0;
    if (restDaysPerWeek >= 1 && restDaysPerWeek <= 2) recoveryScore = 8;
    else if (restDaysPerWeek >= 2.5 && restDaysPerWeek <= 4) recoveryScore = 6;
    else if (restDaysPerWeek > 4) recoveryScore = 4;
    else if (restDaysPerWeek > 0 && restDaysPerWeek < 1) recoveryScore = 5;
    else if (totalSessions > 0) recoveryScore = 2;

    // --- 4. ACWR / 피로 (0~8 또는 패널티)
    var acwrScore = 0;
    if (acwr >= 0.8 && acwr <= 1.3) acwrScore = 8;
    else if (acwr >= 0.5 && acwr < 0.8) acwrScore = 5;
    else if (acwr > 1.3 && acwr <= 1.5) acwrScore = 4;
    else if (acwr > 1.5) acwrScore = -5;
    else if (acwr < 0.5 && totalSessions > 0) acwrScore = 2;
    else if (acwr < 0.5) acwrScore = 0;

    // --- 5. 트렌드 (0~5): 최근 주 vs 이전 주
    var trendScore = 3;
    if (weeks[3] > 0 && weeks[2] > 0) {
      var trend = (weeks[3] - weeks[2]) / Math.max(weeks[2], 1);
      if (trend >= 0 && trend <= 0.2) trendScore = 5;
      else if (trend > 0.2 && trend <= 0.5) trendScore = 4;
      else if (trend > 0.5) trendScore = 2;
      else if (trend >= -0.2) trendScore = 3;
      else trendScore = 1;
    } else if (totalSessions > 0) trendScore = 2;

    // --- 6. 연령 보정 (회복 강조)
    var agePenalty = 0;
    if (age >= 50) agePenalty = 2;
    else if (age >= 45) agePenalty = 1;

    // --- 7. 로그 없음 시 기본 50
    var raw = MIN_SCORE;
    if (totalSessions > 0) {
      raw = MIN_SCORE + consistencyScore + loadScore + recoveryScore + acwrScore + trendScore - agePenalty;
    }
    var score = Math.round(Math.max(MIN_SCORE, Math.min(MAX_SCORE, raw)));

    var details = {
      totalSessions: totalSessions,
      totalTSS: totalTSS,
      weeklyTSS: Math.round(weeklyTSS),
      last7DaysTSS: last7DaysTSS,
      sessionsPerWeek: Math.round(sessionsPerWeek * 10) / 10,
      restDaysPerWeek: Math.round(restDaysPerWeek * 10) / 10,
      acwr: Math.round(acwr * 100) / 100,
      consistencyScore: consistencyScore,
      loadScore: loadScore,
      recoveryScore: recoveryScore,
      acwrScore: acwrScore,
      trendScore: trendScore,
      agePenalty: agePenalty
    };

    return { score: score, details: details };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeConditionScore: computeConditionScore, dedupeLogsForConditionScore: dedupeLogsForConditionScore, MIN_SCORE: MIN_SCORE, MAX_SCORE: MAX_SCORE };
  }
  if (typeof global !== 'undefined') {
    global.computeConditionScore = computeConditionScore;
    global.dedupeLogsForConditionScore = dedupeLogsForConditionScore;
    global.StelvioConditionScore = { computeConditionScore: computeConditionScore, dedupeLogsForConditionScore: dedupeLogsForConditionScore, MIN_SCORE: MIN_SCORE, MAX_SCORE: MAX_SCORE };
  }
})(typeof window !== 'undefined' ? window : this);
