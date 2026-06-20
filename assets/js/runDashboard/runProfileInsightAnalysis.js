/**
 * RUN 프로필 인사이트 — STELVIO 헥사곤(6축) + Riegel p 기반 Gemini/규칙 분석
 * Riegel (1981), Daniels Running Formula, Seiler polarized training, Banister TRIMP 개념 반영
 */
(function () {
  'use strict';

  var FALLBACK_RUN_INSIGHT =
    '현재 AI 분석 서버가 혼잡하여 코멘트를 불러올 수 없습니다. 헥사곤 역량 점수와 Riegel p 지수를 통해 강·약점을 확인해 보세요.';

  function isLowSpecOrMobile() {
    if (typeof navigator === 'undefined') return false;
    var ua = navigator.userAgent || '';
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
    if (navigator.deviceMemory && navigator.deviceMemory <= 4) return true;
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return true;
    return false;
  }

  function buildRunInsightSignature(analysis) {
    if (!analysis || !analysis.scores) return '';
    var s = analysis.scores;
    var p = analysis.fatigueFactorP != null ? analysis.fatigueFactorP.toFixed(3) : 'na';
    return ['k1', 'k3', 'k5', 'k7', 'k10', 'k20']
      .map(function (k) {
        return s[k] != null ? Number(s[k]).toFixed(1) : '0';
      })
      .join('_') + '_p' + p;
  }

  function buildDeterministicRunInsight(analysis, userProfile) {
    if (!analysis || analysis.runnerTypeId === 'insufficient_data') {
      return '6축 Peak 페이스(1k~20k) 기록이 부족합니다. 1k·5k·10k 구간 PR을 등록하면 러닝 인사이트 분석이 가능합니다.';
    }
    var name = (userProfile && userProfile.name) || '러너';
    var parts = [];
    parts.push(name + '님의 STELVIO 헥사곤 분석 결과, 유형은 「' + (analysis.runnerType || '올라운더') + '」입니다.');
    if (analysis.description) parts.push(analysis.description);
    if (analysis.fatigueFactorP != null) {
      var p = analysis.fatigueFactorP;
      if (p < 1.05) {
        parts.push('Riegel 피로 지수 p=' + p.toFixed(3) + '은 장거리 페이스 유지력이 우수한 지구력형 패턴입니다(Riegel, 1981).');
      } else if (p > 1.08) {
        parts.push('p=' + p.toFixed(3) + '은 단거리 대비 장거리 페이스 저하가 큰 스피드 편향 패턴입니다. LSD·Tempo 비중 확대를 검토하세요.');
      } else {
        parts.push('p=' + p.toFixed(3) + '은 균형 잡힌 거리-속도 프로필(기준 1.06 근접)입니다.');
      }
    }
    if (analysis.recommendations && analysis.recommendations.length) {
      parts.push('훈련 제안: ' + analysis.recommendations.join(' '));
    }
    return parts.join('\n\n');
  }

  function buildRunInsightPrompt(analysis, userProfile) {
    var s = analysis.scores || {};
    var ds = analysis.hexagonDataset || [];
    var axisLines = ds
      .map(function (pt) {
        return pt.label + ': ' + (pt.paceDisplay || '—') + ' min/km, 역량 ' + (pt.score != null ? Math.round(pt.score) : '—') + '/100';
      })
      .join('\n');
    var vo2 =
      userProfile && userProfile.vo2max_estimate != null
        ? userProfile.vo2max_estimate
        : userProfile && userProfile.vo2maxEstimate != null
          ? userProfile.vo2maxEstimate
          : null;
    return (
      '러너 프로필:\n' +
      '- 이름: ' + ((userProfile && userProfile.name) || '러너') + '\n' +
      (vo2 != null ? '- VO₂max 추정: ' + vo2 + ' ml/kg/min\n' : '') +
      '- 역치 페이스(10k): ' + ((userProfile && userProfile.threshold_pace) || '미등록') + '\n' +
      '- Riegel p: ' + (analysis.fatigueFactorP != null ? analysis.fatigueFactorP.toFixed(3) : 'N/A') + ' (균형 기준 1.06)\n' +
      '- 유형: ' + (analysis.runnerType || '') + '\n\n' +
      '6축 Peak 페이스 역량(0~100, 빠를수록 높음):\n' +
      axisLines + '\n\n' +
      'k1=' + (s.k1 != null ? Math.round(s.k1) : '—') +
      ', k3=' + (s.k3 != null ? Math.round(s.k3) : '—') +
      ', k5=' + (s.k5 != null ? Math.round(s.k5) : '—') +
      ', k7=' + (s.k7 != null ? Math.round(s.k7) : '—') +
      ', k10=' + (s.k10 != null ? Math.round(s.k10) : '—') +
      ', k20=' + (s.k20 != null ? Math.round(s.k20) : '—')
    );
  }

  /**
   * @param {Object} analysis - analyzeStelvioHexagon() 결과
   * @param {Object} [userProfile]
   * @param {{ timeoutMs?: number, maxRetries?: number, forceApi?: boolean }} [options]
   * @returns {Promise<string>}
   */
  async function fetchRunProfileInsightAnalysis(analysis, userProfile, options) {
    options = options || {};
    if (!analysis || analysis.runnerTypeId === 'insufficient_data') {
      return buildDeterministicRunInsight(analysis, userProfile);
    }

    var apiKey = '';
    try {
      apiKey = (localStorage.getItem('geminiApiKey') || '').trim();
    } catch (e) {}

    if (!apiKey || options.forceApi === false) {
      if (!apiKey) return buildDeterministicRunInsight(analysis, userProfile);
    }

    var isLowSpec = isLowSpecOrMobile();
    var timeoutMs = options.timeoutMs != null ? options.timeoutMs : isLowSpec ? 25000 : 12000;
    var maxRetries = options.maxRetries != null ? options.maxRetries : isLowSpec ? 3 : 2;

    var systemPrompt =
      '당신은 운동생리학·러닝 코칭 전문가입니다. STELVIO 헥사곤 6축(1k~20k Peak 페이스)과 Riegel 피로 지수 p를 바탕으로 러너의 강점·약점·훈련 처방을 한국어로 작성하세요.\n\n' +
      '[과학적 근거]\n' +
      '- Riegel (1981): T2=T1×(D2/D1)^p — p≈1.06이 균형, p<1.05 지구력 우위, p>1.08 단거리 편향\n' +
      '- Daniels: VDOT·역치 페이스 구간별 에너지 시스템(VO₂max·LT·경제성)\n' +
      '- Seiler: 80/20 polarized — 지구력 기반 주간 rTSS 배분\n' +
      '- Banister: 급격한 부하 증가 시 회복·Easy Run 우선\n\n' +
      '[출력 규칙]\n' +
      '- 4~6문장, 완전한 문장으로 마무리\n' +
      '- ① 강점(상위 구간) ② 약점(저하 구간·p 해석) ③ 구체적 훈련 제안(존·세션 유형)\n' +
      '- 사이클링 용어(RSPT, FTP, W/kg) 사용 금지\n' +
      '- JSON 없이 코멘트 텍스트만 반환';

    var userPrompt = buildRunInsightPrompt(analysis, userProfile);

    var modelName = localStorage.getItem('geminiModelName') || 'gemini-2.5-flash';
    var apiVersion = localStorage.getItem('geminiApiVersion') || 'v1beta';
    var url =
      'https://generativelanguage.googleapis.com/' +
      apiVersion +
      '/models/' +
      modelName +
      ':generateContent?key=' +
      apiKey;

    var body = {
      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.35,
        topP: 0.92,
        topK: 40
      }
    };

    var lastErr = null;
    var attempt;
    for (attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        var controller = new AbortController();
        var timeoutId = setTimeout(function () {
          controller.abort();
        }, timeoutMs);

        var res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          var errBody = await res.text();
          throw new Error('Gemini API (' + res.status + '): ' + errBody.slice(0, 200));
        }

        var data = await res.json();
        var candidate = data && data.candidates && data.candidates[0];
        var parts = candidate && candidate.content && candidate.content.parts;
        var fullText = '';
        if (parts && parts.length) {
          for (var i = 0; i < parts.length; i++) {
            if (parts[i] && parts[i].text) fullText += parts[i].text;
          }
        }
        if (!fullText.trim()) throw new Error('빈 응답');
        return fullText.trim();
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          await new Promise(function (r) {
            setTimeout(r, isLowSpec ? 1500 * (attempt + 1) : 800 * (attempt + 1));
          });
        }
      }
    }

    console.warn('[fetchRunProfileInsightAnalysis]', lastErr && lastErr.message);
    return buildDeterministicRunInsight(analysis, userProfile);
  }

  window.FALLBACK_RUN_INSIGHT = FALLBACK_RUN_INSIGHT;
  window.buildRunHexagonInsightSignature = buildRunInsightSignature;
  window.buildDeterministicRunInsight = buildDeterministicRunInsight;
  window.fetchRunProfileInsightAnalysis = fetchRunProfileInsightAnalysis;
})();
