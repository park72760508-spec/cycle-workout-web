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
     console.log('[saveTrainingResult] 시작 - 강화된 오류 처리');
     
     if (!state.currentTrainingSession || !state.currentTrainingSession.startTime) {
       throw new Error('세션이 시작되지 않았습니다. startSession(userId) 먼저 호출하세요.');
     }
     if (!state.currentTrainingSession.endTime) {
       // 자동 종료 시간 보정
       endSession();
     }
   
     const trainingResult = {
       ...state.currentTrainingSession,
       ...extra,
       saveAttemptTime: new Date().toISOString(),
       clientInfo: {
         userAgent: navigator.userAgent,
         origin: window.location.origin
       }
     };

     // 1. 로컬 스토리지에 즉시 백업 (최우선)
     let localSaveSuccess = false;
     try {
       const localKey = `training_result_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
       localStorage.setItem(localKey, JSON.stringify(trainingResult));
       localStorage.setItem('latest_training_result', JSON.stringify(trainingResult));
       console.log('[saveTrainingResult] ✅ 로컬 백업 저장 완료:', localKey);
       localSaveSuccess = true;
     } catch (e) {
       console.error('[saveTrainingResult] ❌ 로컬 백업 저장 실패:', e);
     }

     // 2. GAS 저장 시도 (여러 방법으로 시도)
     let gasSuccess = false;
     let gasError = null;

     try {
       const base = ensureBaseUrl();
       
       // 방법 1: 기본 POST 요청
       await attemptGasSave(base, trainingResult, 'POST');
       gasSuccess = true;
       console.log('[saveTrainingResult] ✅ GAS 저장 성공 (POST)');
       
     } catch (error1) {
       console.warn('[saveTrainingResult] POST 방식 실패:', error1.message);
       
       try {
         // 방법 2: GET 방식으로 재시도 (URL 파라미터)
         await attemptGasSaveAsGet(ensureBaseUrl(), trainingResult);
         gasSuccess = true;
         console.log('[saveTrainingResult] ✅ GAS 저장 성공 (GET)');
         
       } catch (error2) {
         console.warn('[saveTrainingResult] GET 방식도 실패:', error2.message);
         gasError = error2;
         
         try {
           // 방법 3: JSONP 방식으로 최종 시도
           await attemptGasSaveAsJsonp(ensureBaseUrl(), trainingResult);
           gasSuccess = true;
           console.log('[saveTrainingResult] ✅ GAS 저장 성공 (JSONP)');
           
         } catch (error3) {
           console.warn('[saveTrainingResult] JSONP 방식도 실패:', error3.message);
           gasError = error3;
         }
       }
     }

     // 3. 스케줄 결과 저장 (모든 훈련에 대해 SCHEDULE_RESULTS에 저장)
     //    - 스케줄 훈련: schedule_day_id는 window.currentScheduleDayId 사용
     //    - 일반 훈련: schedule_day_id는 null로 저장
     try {
       // 세션 통계 계산
       const stats = calculateSessionStats();
       
       // 훈련 시간 계산 (초 단위)
       // 1순위: extra.elapsedTime 사용 (Firebase에서 받은 실제 경과 시간 - 세그먼트 그래프 상단 시간값)
       // 2순위: window.lastElapsedTime 사용 (전역 변수에 저장된 값)
       // 3순위: startTime과 endTime으로 계산
       let totalSeconds = 0;
       let duration_min = 0;
       
       if (extra.elapsedTime !== undefined && extra.elapsedTime !== null) {
         // Firebase에서 받은 elapsedTime 사용 (가장 정확)
         totalSeconds = Math.max(0, Math.floor(extra.elapsedTime));
         duration_min = Math.floor(totalSeconds / 60);
         console.log('[saveTrainingResult] elapsedTime 사용 (extra):', { elapsedTime: extra.elapsedTime, totalSeconds, duration_min });
       } else if (window.lastElapsedTime !== undefined && window.lastElapsedTime !== null) {
         // 전역 변수에 저장된 elapsedTime 사용
         totalSeconds = Math.max(0, Math.floor(window.lastElapsedTime));
         duration_min = Math.floor(totalSeconds / 60);
         console.log('[saveTrainingResult] elapsedTime 사용 (window.lastElapsedTime):', { lastElapsedTime: window.lastElapsedTime, totalSeconds, duration_min });
       } else {
         // 대체: startTime과 endTime으로 계산
         const startTime = trainingResult.startTime ? new Date(trainingResult.startTime) : null;
         const endTime = trainingResult.endTime ? new Date(trainingResult.endTime) : null;
         
         // startTime이 없으면 powerData의 첫 번째 시간 사용
         let actualStartTime = startTime;
         if (!actualStartTime && trainingResult.powerData && trainingResult.powerData.length > 0) {
           const firstPowerData = trainingResult.powerData[0];
           if (firstPowerData && firstPowerData.t) {
             actualStartTime = new Date(firstPowerData.t);
             console.log('[saveTrainingResult] startTime 복구 (powerData):', actualStartTime);
           }
         }
         
         // endTime이 없으면 현재 시간 사용
         const actualEndTime = endTime || new Date();
         
         // 훈련 시간 계산
         totalSeconds = actualStartTime ? Math.floor((actualEndTime - actualStartTime) / 1000) : 0;
         duration_min = Math.max(0, Math.floor(totalSeconds / 60));
         
         console.log('[saveTrainingResult] 훈련 시간 계산 (startTime/endTime):', {
           startTime: actualStartTime,
           endTime: actualEndTime,
           totalSeconds: totalSeconds,
           duration_min: duration_min,
           powerDataLength: trainingResult.powerData?.length || 0
         });
       }
       
       // TSS 계산 - app.js의 updateTrainingMetrics()와 동일한 공식 사용
       let tss = trainingResult.tss || 0;
       let np = trainingResult.normalizedPower || 0;
       
       // trainingMetrics에서 계산된 값이 있으면 사용 (가장 정확)
       if (window.trainingMetrics && window.trainingMetrics.elapsedSec > 0) {
         const elapsedSec = window.trainingMetrics.elapsedSec;
         const np4sum = window.trainingMetrics.np4sum || 0;
         const count = window.trainingMetrics.count || 1;
         
         if (count > 0 && np4sum > 0) {
           // Normalized Power 계산
           np = Math.pow(np4sum / count, 0.25);
           
           // Intensity Factor 계산
           const userFtp = window.currentUser?.ftp || 200;
           const IF = userFtp > 0 ? (np / userFtp) : 0;
           
           // TSS 계산: (시간(시간) * IF^2 * 100)
           tss = (elapsedSec / 3600) * (IF * IF) * 100;
           console.log('[saveTrainingResult] TSS 계산 (trainingMetrics 사용):', { elapsedSec, np, IF, tss, userFtp });
         }
       }
       
       // trainingMetrics가 없거나 값이 0인 경우 대체 계산
       if (!tss || tss === 0) {
         const userFtp = window.currentUser?.ftp || 200;
         
         // NP가 없으면 평균 파워 * 1.05로 근사 (일반적인 근사치)
         if (!np || np === 0) {
           np = Math.round(stats.avgPower * 1.05) || stats.avgPower || 0;
         }
         
         // IF 계산
         const IF = userFtp > 0 ? (np / userFtp) : 0;
         
         // TSS 계산: (시간(시간) * IF^2 * 100)
         // totalSeconds가 계산된 값 사용 (elapsedTime 우선)
         const timeForTss = totalSeconds > 0 ? totalSeconds : (duration_min * 60);
         tss = (timeForTss / 3600) * (IF * IF) * 100;
         console.log('[saveTrainingResult] TSS 계산 (대체 계산):', { 
           totalSeconds, 
           duration_min, 
           timeForTss, 
           np, 
           IF, 
           tss, 
           userFtp, 
           avgPower: stats.avgPower,
           powerDataCount: trainingResult.powerData?.length || 0
         });
       }
       
       // TSS가 여전히 0이면 경고
       if (tss === 0 && totalSeconds > 0) {
         console.warn('[saveTrainingResult] ⚠️ TSS가 0입니다. 계산값 확인 필요:', {
           totalSeconds,
           duration_min,
           np,
           avgPower: stats.avgPower,
           userFtp: window.currentUser?.ftp || 200
         });
       }
       
       // 값 반올림
       tss = Math.round(tss * 100) / 100;
       np = Math.round(np * 10) / 10;
       
       // 최소값 보장 (0보다 작으면 0)
       tss = Math.max(0, tss);
       np = Math.max(0, np);
       
       // 현재 사용자 ID 가져오기
       const currentUserId = trainingResult.userId || window.currentUser?.id || extra.userId || null;
       
       // schedule_day_id: 스케줄 훈련이면 window.currentScheduleDayId, 일반 훈련이면 null
       const scheduleDayId = window.currentScheduleDayId || null;
       
       const scheduleResultData = {
         scheduleDayId: scheduleDayId,
         userId: currentUserId,
         actualWorkoutId: trainingResult.workoutId || extra.workoutId || null,
         status: 'completed',
         duration_min: duration_min,
         avg_power: stats.avgPower || 0,
         np: np,
         tss: tss,
         hr_avg: stats.avgHR || 0,
         rpe: 0 // RPE는 사용자 입력 필요
       };
       
       console.log('[saveTrainingResult] 📅 스케줄 결과 저장 시도:', scheduleResultData);
       console.log('[saveTrainingResult] 세션 데이터 확인:', {
         startTime: trainingResult.startTime,
         endTime: trainingResult.endTime,
         powerDataCount: trainingResult.powerData?.length || 0,
         hrDataCount: trainingResult.hrData?.length || 0,
         elapsedTime: extra.elapsedTime,
         lastElapsedTime: window.lastElapsedTime
       });
       
       // GAS_URL 확인
       const gasUrl = ensureBaseUrl();
       if (!gasUrl) {
         console.error('[saveTrainingResult] ❌ GAS_URL이 설정되지 않았습니다.');
         throw new Error('GAS_URL is not set');
       }
       console.log('[saveTrainingResult] GAS_URL 확인:', gasUrl);
       
       // scheduleDayId가 null인 경우 빈 문자열로 전송 (Code.gs에서 null로 처리)
       const scheduleDayIdParam = scheduleDayId ? encodeURIComponent(scheduleDayId) : '';
       
       // URL 파라미터 검증 및 로깅
       const urlParams = {
         action: 'saveScheduleResult',
         scheduleDayId: scheduleDayIdParam,
         userId: String(scheduleResultData.userId || ''),
         actualWorkoutId: String(scheduleResultData.actualWorkoutId || ''),
         status: scheduleResultData.status,
         duration_min: scheduleResultData.duration_min,
         avg_power: scheduleResultData.avg_power,
         np: scheduleResultData.np,
         tss: scheduleResultData.tss,
         hr_avg: scheduleResultData.hr_avg,
         rpe: scheduleResultData.rpe
       };
       
       console.log('[saveTrainingResult] URL 파라미터:', urlParams);
       
       // URL 생성 (모든 파라미터 인코딩)
       const scheduleUrl = `${gasUrl}?action=saveScheduleResult&scheduleDayId=${scheduleDayIdParam}&userId=${encodeURIComponent(urlParams.userId)}&actualWorkoutId=${encodeURIComponent(urlParams.actualWorkoutId)}&status=${encodeURIComponent(urlParams.status)}&duration_min=${urlParams.duration_min}&avg_power=${urlParams.avg_power}&np=${urlParams.np}&tss=${urlParams.tss}&hr_avg=${urlParams.hr_avg}&rpe=${urlParams.rpe}`;
       
       console.log('[saveTrainingResult] 저장 URL:', scheduleUrl);
       console.log('[saveTrainingResult] 저장 데이터 상세:', {
         duration_min: urlParams.duration_min,
         avg_power: urlParams.avg_power,
         np: urlParams.np,
         tss: urlParams.tss,
         hr_avg: urlParams.hr_avg,
         userId: urlParams.userId,
         actualWorkoutId: urlParams.actualWorkoutId
       });
       
       try {
         console.log('[saveTrainingResult] fetch 요청 시작...');
         const scheduleResponse = await fetch(scheduleUrl, {
           method: 'GET',
           headers: {
             'Accept': 'application/json'
           }
         });
         
         console.log('[saveTrainingResult] fetch 응답 상태:', scheduleResponse.status, scheduleResponse.statusText);
         
         if (!scheduleResponse.ok) {
           const errorText = await scheduleResponse.text();
           console.error('[saveTrainingResult] HTTP 오류:', scheduleResponse.status, errorText);
           throw new Error(`HTTP ${scheduleResponse.status}: ${errorText}`);
         }
         
         const responseText = await scheduleResponse.text();
         console.log('[saveTrainingResult] 응답 텍스트:', responseText);
         
         let scheduleResult;
         try {
           scheduleResult = JSON.parse(responseText);
         } catch (parseError) {
           console.error('[saveTrainingResult] JSON 파싱 오류:', parseError, '응답:', responseText);
           throw new Error(`JSON 파싱 실패: ${responseText}`);
         }
         
         console.log('[saveTrainingResult] 서버 응답:', scheduleResult);
         
         if (scheduleResult.success) {
           console.log('[saveTrainingResult] ✅ 스케줄 결과 저장 성공, ID:', scheduleResult.id);
           // 스케줄 결과 저장 후 currentScheduleDayId 초기화 (스케줄 훈련인 경우만)
           if (window.currentScheduleDayId) {
             window.currentScheduleDayId = null;
           }
         } else {
           console.error('[saveTrainingResult] ⚠️ 스케줄 결과 저장 실패:', scheduleResult.error);
           throw new Error(scheduleResult.error || 'Unknown error');
         }
       } catch (fetchError) {
         console.error('[saveTrainingResult] ❌ fetch 오류:', fetchError);
         console.error('[saveTrainingResult] 오류 스택:', fetchError.stack);
         throw fetchError;
       }
     } catch (scheduleError) {
       console.error('[saveTrainingResult] ❌ 스케줄 결과 저장 중 오류:', scheduleError);
       // 스케줄 결과 저장 실패해도 계속 진행
     }

     // 4. 결과 처리 및 반환
     if (gasSuccess) {
       console.log('[saveTrainingResult] 🎉 서버 저장 성공 + 로컬 백업 완료');
       return { 
         success: true, 
         data: trainingResult, 
         source: 'gas',
         localBackup: localSaveSuccess
       };
     } else if (localSaveSuccess) {
       console.log('[saveTrainingResult] 📱 서버 저장 실패, 로컬 데이터로 계속 진행');
       return { 
         success: true, 
         data: trainingResult, 
         source: 'local',
         gasError: gasError?.message || 'Unknown error',
         warning: 'CORS 오류로 서버 저장 실패, 로컬에만 저장됨'
       };
     } else {
       console.error('[saveTrainingResult] ❌ 모든 저장 방식 실패');
       throw new Error('로컬 및 서버 저장 모두 실패');
     }
   }

   // GAS 저장 시도 헬퍼 함수들
   async function attemptGasSave(baseUrl, data, method = 'POST') {
     const target = `${baseUrl}?action=saveTrainingResult&t=${Date.now()}`;
     
     const options = {
       method: method,
       headers: { 
         'Content-Type': 'text/plain',
         'Cache-Control': 'no-cache'
       },
       body: JSON.stringify(data),
       mode: 'cors',
       credentials: 'omit'
     };

     const response = await fetch(target, options);
     
     if (!response.ok) {
       throw new Error(`HTTP ${response.status}: ${response.statusText}`);
     }
     
     return await response.json().catch(() => ({ success: true }));
   }

   async function attemptGasSaveAsGet(baseUrl, data) {
     // 중요 데이터만 GET 파라미터로 전송
     const params = new URLSearchParams({
       action: 'saveTrainingResult',
       userId: data.userId || '',
       startTime: data.startTime || '',
       endTime: data.endTime || '',
       method: 'GET_FALLBACK',
       t: Date.now()
     });
     
     const target = `${baseUrl}?${params.toString()}`;
     const response = await fetch(target, { 
       method: 'GET',
       mode: 'cors',
       credentials: 'omit'
     });
     
     if (!response.ok) {
       throw new Error(`GET HTTP ${response.status}`);
     }
     
     return await response.json().catch(() => ({ success: true }));
   }

   async function attemptGasSaveAsJsonp(baseUrl, data) {
     return new Promise((resolve, reject) => {
       const callbackName = `gasCallback_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
       const script = document.createElement('script');
       
       // 타임아웃 설정
       const timeout = setTimeout(() => {
         cleanup();
         reject(new Error('JSONP timeout'));
       }, 10000);
       
       const cleanup = () => {
         clearTimeout(timeout);
         delete window[callbackName];
         if (script.parentNode) {
           script.parentNode.removeChild(script);
         }
       };
       
       window[callbackName] = (result) => {
         cleanup();
         resolve(result);
       };
       
       const params = new URLSearchParams({
         action: 'saveTrainingResult',
         callback: callbackName,
         userId: data.userId || '',
         startTime: data.startTime || '',
         endTime: data.endTime || '',
         method: 'JSONP_FALLBACK'
       });
       
       script.src = `${baseUrl}?${params.toString()}`;
       script.onerror = () => {
         cleanup();
         reject(new Error('JSONP script load failed'));
       };
       
       document.head.appendChild(script);
     });
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

  /**
   * 세션 PDF 내보내기
   */
  function exportSessionPdf(filename = 'training_result.pdf') {
    const jsPdfFactory = window.jspdf?.jsPDF;
    if (typeof jsPdfFactory !== 'function') {
      window.showToast?.('PDF 생성 도구가 준비되지 않았습니다', 'error');
      console.warn('jsPDF not available on window.jspdf.jsPDF');
      return;
    }

    const session = state.currentTrainingSession || {};
    const stats = calculateSessionStats();
    const doc = new jsPdfFactory({ unit: 'mm', format: 'a4' });
    const margin = 15;
    let cursorY = margin;

    const addSectionTitle = (text) => {
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(text, margin, cursorY);
      cursorY += 8;
    };

    const addKeyValue = (label, value) => {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text(`${label}:`, margin, cursorY);
      doc.text(String(value ?? '-'), margin + 35, cursorY);
      cursorY += 6;
    };

    const addTableHeader = (headers) => {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      let x = margin;
      headers.forEach(({ text, width }) => {
        doc.text(text, x, cursorY);
        x += width;
      });
      cursorY += 5;
      doc.setDrawColor(200);
      doc.line(margin, cursorY, margin + headers.reduce((s, h) => s + h.width, 0), cursorY);
      cursorY += 4;
    };

    const addTableRow = (cells) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      let x = margin;
      cells.forEach(({ text, width }) => {
        doc.text(String(text ?? '-'), x, cursorY);
        x += width;
      });
      cursorY += 5;
    };

    addSectionTitle('그룹 훈련 결과 요약');
    addKeyValue('사용자', session.userId ?? window.currentUser?.name ?? '-');
    addKeyValue('세션 시작', session.startTime ? new Date(session.startTime).toLocaleString() : '-');
    addKeyValue('세션 종료', session.endTime ? new Date(session.endTime).toLocaleString() : '-');
    addKeyValue('워크아웃', window.currentWorkout?.title || session.workoutName || '-');
    addKeyValue('평균 파워', `${stats.avgPower || 0} W`);
    addKeyValue('최대 파워', `${stats.maxPower || 0} W`);
    addKeyValue('평균 심박수', `${stats.avgHR || 0} bpm`);
    addKeyValue('칼로리', `${stats.calories || 0} kcal`);
    addKeyValue('달성도', `${stats.achievement || 0}%`);
    cursorY += 4;

    const segments = Array.isArray(session.segmentResults) ? session.segmentResults : [];
    if (segments.length) {
      addSectionTitle('세그먼트 상세');
      const headers = [
        { text: '세그먼트', width: 35 },
        { text: '목표(W)', width: 25 },
        { text: '평균(W)', width: 25 },
        { text: '평균HR', width: 25 },
        { text: '완료 시간', width: 40 }
      ];
      addTableHeader(headers);
      segments.forEach(seg => {
        if (cursorY > 270) {
          doc.addPage();
          cursorY = margin;
          addTableHeader(headers);
        }
        addTableRow([
          { text: `${seg.segmentIndex ?? 0} · ${seg.label || ''}`, width: 35 },
          { text: seg.targetPower ?? '-', width: 25 },
          { text: seg.actualAvgPower ?? '-', width: 25 },
          { text: seg.actualAvgHR ?? '-', width: 25 },
          { text: seg.completedAt ? new Date(seg.completedAt).toLocaleTimeString() : '-', width: 40 }
        ]);
      });
      cursorY += 4;
    }

    addSectionTitle('메모');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const notes = session.notes || '—';
    const wrapped = doc.splitTextToSize(notes, 180);
    wrapped.forEach(line => {
      if (cursorY > 280) {
        doc.addPage();
        cursorY = margin;
      }
      doc.text(line, margin, cursorY);
      cursorY += 5;
    });

    doc.save(filename);
    window.showToast?.('PDF 결과 보고서를 내려받았습니다', 'success');
  }


// ---------------------------
  // 외부 접근용 API 추가
  // ---------------------------
  function getCurrentSessionData() {
    return state.currentTrainingSession;
  }

  function calculateSessionStats() {
    const session = state.currentTrainingSession;
    
    // startTime과 endTime으로 시간 계산 (powerData가 없어도 가능)
    const startTime = session.startTime ? new Date(session.startTime) : null;
    const endTime = session.endTime ? new Date(session.endTime) : null;
    
    // powerData가 없으면 startTime의 첫 번째 데이터 시간 사용
    let actualStartTime = startTime;
    if (!actualStartTime && session.powerData && session.powerData.length > 0) {
      const firstPowerData = session.powerData[0];
      if (firstPowerData && firstPowerData.t) {
        actualStartTime = new Date(firstPowerData.t);
      }
    }
    
    const actualEndTime = endTime || new Date();
    const totalMinutes = actualStartTime ? (actualEndTime - actualStartTime) / (1000 * 60) : 0;
    
    // powerData가 없으면 기본값 반환 (하지만 시간은 계산)
    if (!session || !session.powerData || session.powerData.length === 0) {
      console.warn('[calculateSessionStats] powerData가 없습니다. 기본값 반환.');
      return {
        avgPower: 0,
        maxPower: 0,
        avgHR: 0,
        calories: 0,
        achievement: 0,
        totalTime: Math.max(0, Math.round(totalMinutes))
      };
    }

    const powerValues = session.powerData.map(d => d.v).filter(v => v > 0);
    const hrValues = session.hrData?.map(d => d.v).filter(v => v > 0) || [];
    
    const avgPower = powerValues.length ? Math.round(avg(powerValues)) : 0;
    const maxPower = powerValues.length ? Math.max(...powerValues) : 0;
    const avgHR = hrValues.length ? Math.round(avg(hrValues)) : 0;
    
    // 칼로리 계산 (간단한 공식: 평균파워 * 시간(분) * 0.06)
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

    console.log('[calculateSessionStats] 계산 결과:', {
      avgPower,
      maxPower,
      avgHR,
      calories,
      achievement: totalAchievement,
      totalTime: Math.round(totalMinutes),
      powerDataCount: session.powerData.length,
      hrDataCount: session.hrData?.length || 0
    });

    return {
      avgPower,
      maxPower,
      avgHR,
      calories,
      achievement: totalAchievement,
      totalTime: Math.max(0, Math.round(totalMinutes))
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
    exportSessionPdf,
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

document.addEventListener('DOMContentLoaded', () => {
  const shareBtn = document.getElementById('btnShareResult');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      window.trainingResults?.exportSessionPdf?.();
    });
  }

  const exportCsvBtn = document.getElementById('btnExportResultCsv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      window.trainingResults?.exportSessionCsv?.();
    });
  }
});

