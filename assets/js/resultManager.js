/* ==========================================================
   훈련 결과 관리 모듈 (trainingResults.js / resultManager.js)
   - 훈련 완료 시 결과 저장
   - 사용자별 결과 조회 및 분석
   - CSV 내보내기 기능
   - ✅ 전역 GAS_URL 재선언 금지(전역 window.GAS_URL만 참조)
========================================================== */

(function () {
  'use strict';

  // ---------------------------
  // 내부 상태
  // ---------------------------
  const state = {
    currentTrainingSession: {
      userId: null,
      startTime: null,
      endTime: null,
      segmentResults: [],
      // 스트림 데이터 버퍼
      powerData: [],   // {t: ISOString, v: Number}
      hrData: [],      // {t: ISOString, v: Number}
      cadenceData: [], // {t: ISOString, v: Number}
      notes: ''
    }
  };

// (옵션) 남아있는 코드가 postJSONWithProxy를 호출해도 터지지 않도록 폴백
if (typeof postJSONWithProxy !== 'function') {
  function postJSONWithProxy(baseUrl, action, payload) {
    const target = `${baseUrl}?action=${encodeURIComponent(action)}`;
    return fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
  }
}
   

   
  // ---------------------------
  // 유틸
  // ---------------------------
  function ensureBaseUrl() {
    const base = window.GAS_URL;
    if (!base) {
      throw new Error('GAS_URL is not set (전역에서 window.GAS_URL을 먼저 설정하세요)');
    }
    return base;
  }

  function toISO(d) {
    try {
      return (d instanceof Date ? d : new Date(d)).toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  function avg(arr) {
    if (!arr || arr.length === 0) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return Math.round((s / arr.length) * 10) / 10;
  }

  // ---------------------------
  // 세션 제어
  // ---------------------------
  function startSession(userId, notes = '') {
    state.currentTrainingSession = {
      userId: userId ?? null,
      startTime: new Date().toISOString(),
      endTime: null,
      segmentResults: [],
      powerData: [],
      hrData: [],
      cadenceData: [],
      notes
    };
  }

  function endSession() {
    state.currentTrainingSession.endTime = new Date().toISOString();
  }

  function appendStreamSample(type, value, time = new Date()) {
    const keyMap = { power: 'powerData', heartRate: 'hrData', hr: 'hrData', cadence: 'cadenceData' };
    const key = keyMap[type] || `${type}Data`;
    if (!state.currentTrainingSession[key]) state.currentTrainingSession[key] = [];
    state.currentTrainingSession[key].push({ t: toISO(time), v: Number(value) || 0 });
  }

  // ---------------------------
  // 세그먼트 결과 기록
  // ---------------------------
  function calculateSegmentAverage(dataType /* 'power' | 'hr'|'heartRate' | 'cadence' */, segmentIndex) {
    // 실제 구현에서는 segmentIndex로 세그먼트 시간 범위를 얻어 그 구간 데이터만 평균 계산할 수 있습니다.
    // (여기서는 안전 기본값: 세션의 전체 스트림 평균)
    const map = { power: 'powerData', hr: 'hrData', heartRate: 'hrData', cadence: 'cadenceData' };
    const key = map[dataType] || `${dataType}Data`;
    const data = state.currentTrainingSession[key] || [];
    if (!data.length) return 0;
    return avg(data.map(d => d.v));
  }

  function recordSegmentResult(segmentIndex, segmentData) {
    if (!state.currentTrainingSession.startTime) return;

    const segmentResult = {
      segmentIndex,
      label: segmentData?.label ?? `SEG-${segmentIndex}`,
      duration: Number(segmentData?.duration_sec) || 0,
      targetPower: Number(segmentData?.target_value) || 0,
      actualAvgPower: calculateSegmentAverage('power', segmentIndex),
      actualAvgHR: calculateSegmentAverage('hr', segmentIndex),        // ← heartRate → hr 매핑 처리
      actualAvgCadence: calculateSegmentAverage('cadence', segmentIndex),
      completedAt: new Date().toISOString()
    };

    state.currentTrainingSession.segmentResults.push(segmentResult);
    return segmentResult;
  }

  // ---------------------------
  // 저장 / 조회
  // ---------------------------
   /* ===== 저장(프록시 대응 버전) — 교체 ===== */
async function saveTrainingResult(extra = {}) {
     console.log('[saveTrainingResult] 시작');
     
     if (!state.currentTrainingSession || !state.currentTrainingSession.startTime) {
       throw new Error('세션이 시작되지 않았습니다. startSession(userId) 먼저 호출하세요.');
     }
     if (!state.currentTrainingSession.endTime) {
       // 자동 종료 시간 보정
       endSession();
     }
   
     const trainingResult = {
       ...state.currentTrainingSession,
       ...extra
     };

     // 로컬 스토리지에 백업 저장
     try {
       const localKey = `training_result_${Date.now()}`;
       localStorage.setItem(localKey, JSON.stringify(trainingResult));
       console.log('[saveTrainingResult] 로컬 백업 저장 완료:', localKey);
     } catch (e) {
       console.warn('[saveTrainingResult] 로컬 백업 저장 실패:', e);
     }

     // GAS 저장 시도 (실패해도 계속 진행)
     try {
       const base = ensureBaseUrl();
       const target = `${base}?action=saveTrainingResult`;
       
       console.log('[saveTrainingResult] GAS 저장 시도:', target);
       
       const res = await fetch(target, {
         method: 'POST',
         headers: { 'Content-Type': 'text/plain' },
         body: JSON.stringify(trainingResult)
       });
   
       if (res && res.ok) {
         const data = await res.json().catch(() => ({}));
         console.log('[saveTrainingResult] GAS 저장 성공');
         return { success: true, data, source: 'gas' };
       } else {
         console.warn('[saveTrainingResult] GAS 응답 오류:', res?.status);
       }
     } catch (err) {
       console.warn('[saveTrainingResult] GAS 저장 실패 (CORS/네트워크):', err.message);
     }

     // GAS 저장 실패 시에도 성공으로 처리 (로컬 데이터 사용)
     console.log('[saveTrainingResult] 로컬 데이터로 계속 진행');
     return { success: true, data: trainingResult, source: 'local' };
   }



  async function getTrainingResults(userId, startDate, endDate) {
    const base = ensureBaseUrl();
    const params = new URLSearchParams({
      action: 'getTrainingResults',
      userId: userId || '',
      startDate: startDate || '',
      endDate: endDate || ''
    });
    const res = await fetch(`${base}?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`getTrainingResults 실패: ${res.status} ${text}`);
    }
    return res.json();
  }

  // ---------------------------
  // 결과 화면 초기화(사용자 목록 불러오기 등)
  // ---------------------------
  async function initializeResultScreen() {
    const base = ensureBaseUrl();
    // 사용자 셀렉트 채우기
    const userSelect = document.querySelector('#resultUserSelect');
    if (userSelect) {
      const result = await fetch(`${base}?action=listUsers`).then(r => r.json());
      if (result?.success && Array.isArray(result.items)) {
        userSelect.innerHTML = '<option value="">사용자 선택</option>';
        result.items.forEach(u => {
          const opt = document.createElement('option');
          opt.value = u.id;
          opt.textContent = `${u.name || '이름없음'} (${u.id})`;
          userSelect.appendChild(opt);
        });
      }
    }
  }

  // ---------------------------
  // CSV 내보내기
  // ---------------------------
  function exportSessionCsv(filename = 'training_result.csv') {
    const s = state.currentTrainingSession;
    const rows = [
      ['userId', s.userId ?? ''],
      ['startTime', s.startTime ?? ''],
      ['endTime', s.endTime ?? ''],
      ['notes', s.notes ?? '']
    ];

    rows.push([]);
    rows.push(['segmentIndex', 'label', 'duration', 'targetPower', 'actualAvgPower', 'actualAvgHR', 'actualAvgCadence', 'completedAt']);
    (s.segmentResults || []).forEach(r => {
      rows.push([
        r.segmentIndex ?? '',
        r.label ?? '',
        r.duration ?? '',
        r.targetPower ?? '',
        r.actualAvgPower ?? '',
        r.actualAvgHR ?? '',
        r.actualAvgCadence ?? '',
        r.completedAt ?? ''
      ]);
    });

    rows.push([]);
    rows.push(['powerData (t,v)']);
    (s.powerData || []).forEach(d => rows.push([d.t, d.v]));
    rows.push([]);
    rows.push(['hrData (t,v)']);
    (s.hrData || []).forEach(d => rows.push([d.t, d.v]));
    rows.push([]);
    rows.push(['cadenceData (t,v)']);
    (s.cadenceData || []).forEach(d => rows.push([d.t, d.v]));

    const csv = rows.map(row => row.map(cell => {
      const val = (cell ?? '').toString().replace(/"/g, '""');
      return /[",\n]/.test(val) ? `"${val}"` : val;
    }).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  }


// ---------------------------
  // 외부 접근용 API 추가
  // ---------------------------
  function getCurrentSessionData() {
    return state.currentTrainingSession;
  }

  function calculateSessionStats() {
    const session = state.currentTrainingSession;
    if (!session || !session.powerData?.length) {
      return {
        avgPower: 0,
        maxPower: 0,
        avgHR: 0,
        calories: 0,
        achievement: 0,
        totalTime: 0
      };
    }

    const powerValues = session.powerData.map(d => d.v).filter(v => v > 0);
    const hrValues = session.hrData?.map(d => d.v).filter(v => v > 0) || [];
    
    const avgPower = powerValues.length ? Math.round(avg(powerValues)) : 0;
    const maxPower = powerValues.length ? Math.max(...powerValues) : 0;
    const avgHR = hrValues.length ? Math.round(avg(hrValues)) : 0;
    
    // 칼로리 계산 (간단한 공식: 평균파워 * 시간(분) * 0.06)
    const startTime = session.startTime ? new Date(session.startTime) : null;
    const endTime = session.endTime ? new Date(session.endTime) : new Date();
    const totalMinutes = startTime ? (endTime - startTime) / (1000 * 60) : 0;
    const calories = Math.round(avgPower * totalMinutes * 0.06);
    
    // 달성도 계산 (세그먼트별 목표 대비 실제 파워 비율의 평균)
    let totalAchievement = 0;
    if (session.segmentResults?.length) {
      const achievements = session.segmentResults.map(seg => {
        if (seg.targetPower > 0 && seg.actualAvgPower > 0) {
          return Math.min((seg.actualAvgPower / seg.targetPower) * 100, 150); // 최대 150%
        }
        return 0;
      });
      totalAchievement = achievements.length ? Math.round(avg(achievements)) : 0;
    }

    return {
      avgPower,
      maxPower,
      avgHR,
      calories,
      achievement: totalAchievement,
      totalTime: Math.round(totalMinutes)
    };
  }



   
  // ---------------------------
  // 호환용 래퍼 (기존 코드에서 trainingResults.*로 부를 수 있게)
  // ---------------------------
  const api = {
    // 세션
    startSession,
    endSession,
    appendStreamSample,
    // 세그먼트 기록
    recordSegmentResult,
    // 저장/조회
    saveTrainingResult,
    getTrainingResults,
    // UI 초기화
    initializeResultScreen,
    // CSV
    exportSessionCsv,
    // 새로 추가된 API
    getCurrentSessionData,
    calculateSessionStats,

    // 별칭(호환)
    save: saveTrainingResult,
    showSummary: function () {
      // 필요 시 요약 모달 구현 지점
      // 현재는 자리표시자
      console.info('[trainingResults.showSummary] 요약 모달은 아직 구현되지 않았습니다.');
    }
  };

  // 전역 네임스페이스
  window.trainingResults = Object.assign(window.trainingResults || {}, api);

})();

//결과 요약 즉시 바인딩용 최소 텍스트 출력

(function attachResultSummaryRenderer(){
  window.renderCurrentSessionSummary = function(){
    console.log('[renderCurrentSessionSummary] 시작');
    
    try {
      // 세션 데이터 가져오기
      const sessionData = window.trainingResults?.getCurrentSessionData?.();
      if (!sessionData) {
        console.warn('[renderCurrentSessionSummary] 세션 데이터를 찾을 수 없습니다.');
        return;
      }

      console.log('[renderCurrentSessionSummary] 세션 데이터:', sessionData);

      // 통계 계산
      const stats = window.trainingResults?.calculateSessionStats?.();
      console.log('[renderCurrentSessionSummary] 계산된 통계:', stats);

      // 결과 화면 엘리먼트들 업데이트
      updateResultElement('finalAchievement', `${stats?.achievement || 0}%`);
      updateResultElement('resultAvgPower', stats?.avgPower || '-');
      updateResultElement('resultMaxPower', stats?.maxPower || '-');
      updateResultElement('resultAvgHR', stats?.avgHR || '-');
      updateResultElement('resultCalories', stats?.calories || '-');
      
      // 워크아웃 이름 표시
      if (window.currentWorkout?.title) {
        updateResultElement('workoutCompletedName', window.currentWorkout.title);
      }

      // resultSummary 박스가 있으면 업데이트
      const box = document.getElementById('resultSummary');
      if (box) {
        const segN = (sessionData.segmentResults||[]).length;
        box.innerHTML = `
          <div class="result-mini">
            <div>사용자: ${sessionData.userId ?? '-'}</div>
            <div>시작: ${sessionData.startTime ?? '-'}</div>
            <div>종료: ${sessionData.endTime ?? '-'}</div>
            <div>세그먼트 수: ${segN}</div>
            <div>평균 파워: ${stats?.avgPower || 0}W</div>
            <div>최대 파워: ${stats?.maxPower || 0}W</div>
            <div>달성도: ${stats?.achievement || 0}%</div>
          </div>`;
      }

      console.log('[renderCurrentSessionSummary] 결과 화면 업데이트 완료');
      
    } catch (error) {
      console.error('[renderCurrentSessionSummary] 오류:', error);
    }
  };

  function updateResultElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
      console.log(`[renderCurrentSessionSummary] ${id} 업데이트: ${value}`);
    } else {
      console.warn(`[renderCurrentSessionSummary] 엘리먼트를 찾을 수 없습니다: ${id}`);
    }
  }
})();

