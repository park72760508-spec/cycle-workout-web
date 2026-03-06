// Updated: 2025-11-16 12:30 (KST) - Change header auto-stamped per edit

/* ==========================================================
   app.js (v1.3 fixed) - 모든 오류 수정이 반영된 통합 버전
========================================================== */

/* ==========================================================================
   [긴급 패치] CycleOps/Legacy 장치 권한 강제 주입 스크립트 (v2.0)
   - 설명: navigator.bluetooth.requestDevice 함수를 래핑하여
          Legacy(CycleOps/Wahoo) 제어용 UUID를 자동으로 목록에 추가합니다.
   - 위치: app.js 최상단에 위치해야 합니다.
   ========================================================================== */
(function() {
    // 브라우저에 블루투스 기능이 있을 때만 동작
    if (navigator.bluetooth && navigator.bluetooth.requestDevice) {
        
        const originalRequestDevice = navigator.bluetooth.requestDevice;
        
        // CycleOps Hammer 및 구형 기기들이 사용하는 필수 UUID 목록
        const LEGACY_UUIDS = [
            'a026ee01-0a1d-4335-9d7f-245f24e1a229', // Wahoo/CycleOps 표준 제어
            '347b0001-7635-408b-8918-8ff3949ce592', // 아주 오래된 CycleOps 기기용
            '00001826-0000-1000-8000-00805f9b34fb'  // FTMS (표준)
        ];

        // 연결 함수 가로채기 (Override)
        navigator.bluetooth.requestDevice = function(options) {
            console.log('[System] 블루투스 연결 요청을 감지하여 권한을 검사합니다...');
            
            if (!options) options = {};
            if (!options.optionalServices) options.optionalServices = [];
            
            // 필수 UUID가 빠져있으면 강제로 추가
            LEGACY_UUIDS.forEach(uuid => {
                if (!options.optionalServices.includes(uuid)) {
                    options.optionalServices.push(uuid);
                    console.log(`[System] 권한 자동 추가됨: ${uuid}`);
                }
            });

            // 기본 필수 서비스도 보장
            const basicServices = ['cycling_power', 'cycling_speed_and_cadence', 'fitness_machine'];
            basicServices.forEach(srv => {
                if (!options.optionalServices.includes(srv)) options.optionalServices.push(srv);
            });

            // 원래 함수 실행
            return originalRequestDevice.call(navigator.bluetooth, options);
        };
        console.log('[System] CycleOps 권한 자동 주입 패치가 활성화되었습니다.');
    }
})();
/* ========================================================================== */

/* ==========================================================================
   [모바일 뷰포트] VisualViewport 기반 --vvh 설정
   - 100vh는 모바일에서 주소창·하단 메뉴를 제외한 "큰 뷰포트" 기준이라,
     브라우저 UI가 보일 때 화면 하단이 가려지고 스크롤이 고정되는 현상 발생.
   - 100dvh 미지원 구형 브라우저용 폴백: --vvh(보이는 높이)를 설정하여
     CSS에서 height: var(--vvh, 100vh) 사용 가능.
   ========================================================================== */
(function setVisualViewportHeight() {
  function updateVvh() {
    var vv = window.visualViewport;
    var h = vv ? vv.height : window.innerHeight;
    /* iOS/Bluefy: 화면 확장 — layout/visual viewport 중 큰 값 사용 (하단 회색 바 제거) */
    var inner = window.innerHeight || 0;
    var docClient = document.documentElement ? document.documentElement.clientHeight : 0;
    var h2 = Math.max(h, inner, docClient || 0);
    if (document.documentElement) document.documentElement.style.setProperty('--vvh', h2 + 'px');
  }
  updateVvh();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateVvh);
    window.visualViewport.addEventListener('scroll', updateVvh);
  }
  window.addEventListener('resize', updateVvh);
  window.addEventListener('orientationchange', function() { setTimeout(updateVvh, 150); });
})();

// ... (여기서부터 원래 app.js의 코드가 시작됩니다) ...




// ========== 전역 변수 안전 초기화 (파일 최상단) ==========
(function initializeGlobals() {
  // liveData 객체 안전 초기화
  if (!window.liveData) {
    window.liveData = {
      power: 0,
      cadence: 0,
      heartRate: 0,
      targetPower: 0
    };
  }

  // currentUser 안전 초기화
  if (!window.currentUser) {
    window.currentUser = null;
  }

  // currentWorkout 안전 초기화
  if (!window.currentWorkout) {
    window.currentWorkout = null;
  }

  // trainingState 안전 초기화
  if (!window.trainingState) {
    window.trainingState = {
      timerId: null,
      paused: false,
      elapsedSec: 0,
      segIndex: 0,
      segElapsedSec: 0,
      segEnds: [],
      totalSec: 0
    };
  }

  // connectedDevices 안전 초기화
// connectedDevices 안전 초기화
  if (!window.connectedDevices) {
    window.connectedDevices = {
      trainer: null,
      powerMeter: null,
      heartRate: null
    };
  }

  // RPE 강도 보정값 초기화 (로컬 스토리지에서 복원)
  if (window.trainingIntensityAdjustment === undefined) {
    try {
      const saved = localStorage.getItem('trainingIntensityAdjustment');
      window.trainingIntensityAdjustment = saved ? parseFloat(saved) : 1.0;
    } catch (e) {
      window.trainingIntensityAdjustment = 1.0;
    }
  }

  // workoutData 전역 초기화 (그룹 훈련용)
// workoutData 전역 초기화 (그룹 훈련용)
  if (!window.workoutData) {
    window.workoutData = [
      {
        id: 'basic-endurance',
        name: '기본 지구력 훈련',
        duration: 60,
        description: '중강도 지구력 향상을 위한 기본 훈련'
      },
      {
        id: 'interval-training', 
        name: '인터벌 훈련',
        duration: 45,
        description: '고강도 인터벌 훈련으로 심폐 능력 향상'
      },
      {
        id: 'recovery-ride',
        name: '회복 라이딩', 
        duration: 30,
        description: '저장소 회복 라이딩'
      },
      {
        id: 'tempo-training',
        name: '템포 훈련',
        duration: 50,
        description: '중고강도 템포 훈련'
      },
      {
        id: 'hill-climbing',
        name: '언덕 오르기',
        duration: 40,
        description: '언덕 오르기 시뮬레이션 훈련'
      }
    ];
  }

  // 3초 평균 파워 계산을 위한 버퍼 초기화
  if (!window._powerAverageBuffer) {
    window._powerAverageBuffer = [];
  }

  /**
   * 3초 평균 파워값 계산 함수
   * @returns {number} 3초 평균 파워값 (W)
   */
  window.get3SecondAveragePower = function() {
    const now = Date.now();
    const threeSecondsAgo = now - 3000; // 3초 전
    
    // 3초 이전의 데이터 제거
    window._powerAverageBuffer = window._powerAverageBuffer.filter(item => item.timestamp >= threeSecondsAgo);
    
    // 현재 파워값 추가
    const currentPower = Number(window.liveData?.power ?? 0);
    if (currentPower >= 0) { // 유효한 파워값만 추가
      window._powerAverageBuffer.push({
        timestamp: now,
        power: currentPower
      });
    }
    
    // 3초 이전의 데이터 다시 제거 (방금 추가한 값이 포함된 상태에서)
    window._powerAverageBuffer = window._powerAverageBuffer.filter(item => item.timestamp >= threeSecondsAgo);
    
    // 평균값 계산
    if (window._powerAverageBuffer.length === 0) {
      return currentPower; // 버퍼가 비어있으면 현재값 반환
    }
    
    const sum = window._powerAverageBuffer.reduce((acc, item) => acc + item.power, 0);
    const average = Math.round(sum / window._powerAverageBuffer.length);
    
    return average;
  };


  // GAS_URL 전역 초기화
  if (!window.GAS_URL) {
    window.GAS_URL = 'https://script.google.com/macros/s/AKfycbzF8br63uD3ziNxCFkp0UUSpP49zURthDsEVZ6o3uRu47pdS5uXE5S1oJ3d7AKHFouJ/exec'; // 실제 URL로 변경 필요
  }

  // 저장된 워크아웃 계획들 초기화
  if (!window.workoutPlans) {
    window.workoutPlans = [];
  }

// === 인증 폼 초기화 유틸 ===
// 인증 화면의 전화번호 입력/버튼/상태를 모두 초기 상태로 되돌린다.
function resetAuthForm() {
  // 입력칸(프로젝트에 따라 id가 phoneInput 또는 loginPhone 등일 수 있어 둘 다 처리)
  const phoneInput = document.getElementById('phoneInput') || document.getElementById('loginPhone');
  if (phoneInput) {
    phoneInput.value = '';
    phoneInput.classList.remove('error', 'valid', 'invalid');
  }

  // 상태 텍스트
  const authStatus = document.getElementById('phoneAuthStatus');
  if (authStatus) {
    authStatus.textContent = '';
    authStatus.className = 'auth-status'; // 기본 클래스로 되돌림
  }

  // 인증 버튼
  const authBtn = document.getElementById('phoneAuthBtn');
  if (authBtn) {
    authBtn.disabled = false;
    authBtn.setAttribute('aria-disabled', 'false');
    authBtn.textContent = '전화번호 인증'; // 프로젝트 UX에 맞게 초기 라벨
  }

  // 내부 상태 변수들(있다면)
  try {
    if (typeof window.currentPhoneNumber !== 'undefined') window.currentPhoneNumber = '';
    if (typeof window.isPhoneAuthenticated !== 'undefined') window.isPhoneAuthenticated = false;
  } catch (_) {}
}



   
window.userPanelNeonMode = 'static';  // 'static' 고정 (동적 계산 끔)

   
  console.log('Global variables initialized safely');
})();

// ========== 안전 접근 헬퍼 함수들 ==========
// ========== 안전 접근 헬퍼 함수들 ==========
/**
 * safeGetElement(id, opts?)
 *  - opts.required: true면 없을 때 throw
 *  - opts.quiet:    true면 없을 때 콘솔 로그/경고 안 찍음
 *  - 2번째 인자를 boolean으로 넘기던 기존 코드도 그대로 허용(뒤로호환)
 */
function safeGetElement(id, opts) {
  let required = false, quiet = false, silent = false;

  // 뒤로호환: safeGetElement(id, true/false) 형태 지원
  if (typeof opts === 'boolean') {
    required = !!opts;
  } else if (opts && typeof opts === 'object') {
    required = !!opts.required;
    quiet   = !!opts.quiet;
    silent  = !!opts.silent; // silent 옵션 추가
  }
  
  // silent가 true면 quiet도 true로 설정
  if (silent) {
    quiet = true;
  }

  const el = document.getElementById(id);

  if (!el) {
    if (required) {
      const msg = `Required element with id '${id}' not found`;
      if (!quiet) console.error(msg);
      throw new Error(msg);
    } else {
      // btnCancelBuilder: workoutBuilderScreen 내 버튼 — 스크립트 순서/환경에 따라 아직 DOM에 없을 수 있음, 경고 생략
      if (!quiet && id !== 'btnCancelBuilder') console.warn(`Element with id '${id}' not found`);
    }
  }
  return el || null;
}


function safeSetText(id, text) {
  const element = safeGetElement(id);
  if (element) {
    element.textContent = text;
  }
}

// === 현재 세그먼트명 진행바 채움 폭을 CSS 변수로 지정 ===
function setNameProgress(ratio){
  const el = document.getElementById("currentSegmentName");
  if (!el) return;
  const pct = Math.max(0, Math.min(1, Number(ratio) || 0)) * 100;
  el.style.setProperty("--name-progress", pct + "%");
}

// ============ Mini Line Chart (Sparkline) ============
// 고정 길이 링버퍼 유틸
function makeRingBuffer(maxLen = 1200) {
  const arr = [];
  return {
    push(v) { arr.push({ t: Date.now(), v: Number(v) || 0 }); if (arr.length > maxLen) arr.shift(); },
    data() { return arr; },
    clear() { arr.length = 0; }
  };
}

// 라인차트 그리기
// 라인차트 그리기 (통합: 평균/최대 라벨 + 평균 가이드라인 + 누적모드)
function drawSparkline(canvas, series, opts = {}) {
  if (!canvas || !series || typeof series.data !== 'function') return;

  const ctx = canvas.getContext('2d');
  // Retina 스케일 보정(캔버스 크기 조정은 initTrainingCharts에서 1회 수행)
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  const pad = 10;
  const windowSec = (opts.windowSec ?? 600); // null/0 이면 전체 누적
  const d = series.data();
  if (!d.length) return;

  const now = Date.now();
  const vis = (windowSec && windowSec > 0)
    ? d.filter(p => now - p.t <= windowSec * 1000)
    : d.slice(); // 누적(전체)

  if (!vis.length) return;

  // 값 스케일 계산
  const values = vis.map(p => Number(p.v) || 0);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const sumV = values.reduce((s, v) => s + v, 0);
  const avgV = sumV / values.length;

  // Sweep 시간축
  const tMin = vis[0].t, tMax = vis[vis.length - 1].t;
  const tSpan = Math.max(1, tMax - tMin);
  const vSpan = Math.max(1e-6, maxV - minV); // 0인 경우 방지

  // 그래프 영역 높이 (시간 표시는 별도 블록으로 이동)
  const graphHeight = H - pad * 2;

  // 배경 그라디언트
  const g = ctx.createLinearGradient(0, 0, 0, graphHeight + pad);
  g.addColorStop(0, (opts.bgTop   ?? 'rgba(59,130,246,0.10)'));
  g.addColorStop(1, (opts.bgBottom?? 'rgba(59,130,246,0.00)'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, graphHeight + pad);

  // 메인 라인
  ctx.beginPath();
  vis.forEach((p, i) => {
    const x = pad + ((p.t - tMin) / tSpan) * (W - pad * 2);
    const y = pad + (1 - ((p.v - minV) / vSpan)) * graphHeight;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineWidth = opts.lineWidth ?? 2;
  ctx.strokeStyle = opts.stroke ?? 'rgba(0,215,200,0.9)'; // 민트
  ctx.stroke();

  // 영역 채움(선택)
  if (opts.fill !== false) {
    ctx.lineTo(pad + (vis[vis.length - 1].t - tMin) / tSpan * (W - pad * 2), pad + graphHeight);
    ctx.lineTo(pad, pad + graphHeight);
    ctx.closePath();
    ctx.fillStyle = opts.fill ?? 'rgba(0,215,200,0.15)';
    ctx.fill();
  }

  // 평균 가이드라인(선택)
  if (opts.avgLine) {
    const avgY = pad + (1 - ((avgV - minV) / vSpan)) * graphHeight;
    ctx.save();
    if (opts.avgLineStyle === 'dashed') {
      ctx.setLineDash([8, 6]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(pad, avgY);
    ctx.lineTo(W - pad, avgY);
    ctx.lineWidth = opts.avgLineWidth ?? 1.5;
    ctx.strokeStyle = opts.avgStroke ?? 'rgba(255,255,255,0.65)';
    ctx.stroke();
    ctx.restore();
  }

  // 보조 숫자(최대/평균) 라벨 그리기(선택)
  if (opts.showStats) {
    const unit = opts.unit || '';
    ctx.save();
    ctx.font = (opts.statsFont || '16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto');
    ctx.fillStyle = (opts.statsColor || 'rgba(255,255,255,0.85)');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // AVG 좌상단
    const avgText = (opts.labelAvg || 'AVG') + ' ' + Math.round(avgV) + (unit ? ' ' + unit : '');
    ctx.fillText(avgText, pad + 2, pad + 2);

    // MAX 우상단
    ctx.textAlign = 'right';
    const maxText = (opts.labelMax || 'MAX') + ' ' + Math.round(maxV) + (unit ? ' ' + unit : '');
    ctx.fillText(maxText, W - pad - 2, pad + 2);
    ctx.restore();
  }

  // 그래프 내부 시간 표시 제거 (별도 블록으로 이동)
}

// 시리즈에서 AVG/MAX 계산 (windowSec=0 이면 누적 전체)
function getSeriesStats(series, windowSec = 0){
  if (!series || typeof series.data !== 'function') return {avg:0, max:0};
  const now = Date.now();
  const raw = series.data();
  const vis = (windowSec && windowSec>0) ? raw.filter(p => now - p.t <= windowSec*1000) : raw;
  if (!vis.length) return {avg:0, max:0};
  const vals = vis.map(p => Number(p.v)||0);
  const avg = Math.round(vals.reduce((s,v)=>s+v,0) / vals.length);
  const max = Math.round(Math.max(...vals));
  return {avg, max};
}




// 세그먼트 총시간(초) 계산: 현재 워크아웃 기준, 그룹/중첩 지원
function getPlannedTotalSecondsFromSegments(workout) {
  const w = workout || window.currentWorkout || window.selectedWorkout || window.activeWorkout || null;
  if (!w) return 0;

  function sumSegments(list) {
    if (!Array.isArray(list)) return 0;
    let total = 0;
    for (const seg of list) {
      // 일반 세그먼트
      const d =
        Number(seg?.duration_sec) ||
        Number(seg?.duration) ||
        0;
      if (d > 0) total += d;

      // 그룹/반복 세그먼트 (children / segments / sets 등)
      if (Array.isArray(seg?.children)) total += sumSegments(seg.children);
      if (Array.isArray(seg?.segments)) total += sumSegments(seg.segments);
      if (Array.isArray(seg?.sets))     total += sumSegments(seg.sets);
    }
    return total;
  }

  // 워크아웃 루트에서 세그먼트 배열 찾아 합산
  if (Array.isArray(w?.segments)) return sumSegments(w.segments);
  if (Array.isArray(w?.children)) return sumSegments(w.children);
  if (Array.isArray(w?.sets))     return sumSegments(w.sets);
  return 0;
}




// 그래프 초기화
// 세그먼트 합으로 버퍼 용량을 유동 계산
(function configureChartBuffers() {
  const fallback = 10800; // 3h 기본 (워크아웃 정보 없을 때)
  const plannedSec = getPlannedTotalSecondsFromSegments(window.currentWorkout);
  const totalSec = plannedSec > 0 ? plannedSec : (Number(window.currentWorkout?.total_seconds) || fallback);

  // 여유 5분(300초) + 최소 1h 보장
  const capacity = Math.max(totalSec + 300, 3600);

  if (!window._powerSeries) window._powerSeries = makeRingBuffer(capacity);
  if (!window._hrSeries)    window._hrSeries    = makeRingBuffer(capacity);

  // 디버깅 로그(선택)
  // console.log('[Charts] capacity set =', capacity, 'seconds (planned=', plannedSec, ')');
})();


// === [RESULT] 세션 종료 + 저장
async function saveTrainingResultAtEnd() {
  console.log('[saveTrainingResultAtEnd] 🚀 시작 - 강화된 저장 프로세스');
  
  try {
    // 0. 훈련 종료 전 포인트 값 저장 (결과 화면 표시용)
    const beforeAccPoints = window.currentUser?.acc_points || 0;
    const beforeRemPoints = window.currentUser?.rem_points || 0;
    window.beforeTrainingPoints = {
      acc_points: beforeAccPoints,
      rem_points: beforeRemPoints
    };
    console.log('[saveTrainingResultAtEnd] 0️⃣ 훈련 전 포인트 저장:', window.beforeTrainingPoints);
    
    // 1. 세션 종료 처리
    console.log('[saveTrainingResultAtEnd] 1️⃣ 세션 종료 처리');
    window.trainingResults?.endSession?.();
    
    // 2. 추가 메타데이터 준비
    const extra = {
      workoutId: window.currentWorkout?.id || '',
      workoutName: window.currentWorkout?.title || window.currentWorkout?.name || '',
      completionType: 'normal',
      appVersion: '1.0.0',
      timestamp: new Date().toISOString()
    };
    
    console.log('[saveTrainingResultAtEnd] 2️⃣ 저장 시도 시작, 추가 데이터:', extra);
    
    // 3. 강화된 저장 시도
    let saveResult = null;
    try {
      saveResult = await window.trainingResults?.saveTrainingResult?.(extra);
      console.log('[saveTrainingResultAtEnd] 3️⃣ 저장 결과:', saveResult);
    } catch (saveError) {
      console.error('[saveTrainingResultAtEnd] ❌ 저장 중 오류:', saveError);
      // 저장 실패해도 계속 진행
      saveResult = { 
        success: false, 
        error: saveError.message,
        fallback: true
      };
    }
    
    // 4. 결과 검증 및 로컬 데이터 확인
    const sessionData = window.trainingResults?.getCurrentSessionData?.();
    if (sessionData) {
      console.log('[saveTrainingResultAtEnd] 4️⃣ 세션 데이터 확인 완료');
    } else {
      console.warn('[saveTrainingResultAtEnd] ⚠️ 세션 데이터가 없습니다!');
    }
    
    // 5. 항상 성공으로 처리하여 결과 화면으로 진행
    const finalResult = {
      success: true,
      saveResult: saveResult,
      hasSessionData: !!sessionData,
      canShowResults: true,
      message: saveResult?.source === 'local' ? '로컬 저장으로 결과 표시' : '정상 저장 완료'
    };
    
    console.log('[saveTrainingResultAtEnd] 5️⃣ 최종 결과:', finalResult);
    return finalResult;
    
  } catch (criticalError) {
    console.error('[saveTrainingResultAtEnd] 💥 치명적 오류 발생:', criticalError);
    
    // 치명적 오류가 발생해도 결과 화면으로 진행
    // 로컬 데이터라도 있으면 표시할 수 있도록
    return { 
      success: true, 
      error: criticalError.message,
      fallback: true,
      canShowResults: true,
      message: '오류 발생했지만 결과 화면으로 진행'
    };
  }
}




window.initTrainingCharts = function initTrainingCharts() {
  // 화면 진입 시 1회 호출
  const pc = document.getElementById('powerChart');
  const hc = document.getElementById('hrChart');

  // 레티나 보정
  [pc, hc].forEach(cv => {
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    cv.width = Math.max(600, Math.floor(rect.width * dpr));
    cv.height = Math.max(140, Math.floor(rect.height * dpr));
  });

  // 첫 렌더
  // 파워
  drawSparkline(
     pc,
     window._powerSeries,
     {
       // ⬇ 누적 표시를 원하면 0 또는 null (10분만 보려면 600 유지)
       windowSec: 0,
       stroke: 'rgba(0,215,200,0.9)',
       fill: 'rgba(0,215,200,0.15)',
       showStats: false,
       unit: 'W',
       avgLine: true,
       avgLineStyle: 'solid', // 'solid' 로 바꿔도 됨
       avgStroke: 'rgba(255,255,255,0.65)'
     }
   );
   
   // 심박
   drawSparkline(
     hc,
     window._hrSeries,
     {
       windowSec: 0, // 누적
       stroke: 'rgba(0,215,200,0.9)',
       fill: 'rgba(0,215,200,0.10)',
       showStats: false,
       unit: 'bpm',
       avgLine: true,
       avgLineStyle: 'solid',
       avgStroke: 'rgba(255,255,255,0.65)'
     }
   );
};

// 창 크기 변경 시 리사이즈
window.addEventListener('resize', () => {
  if (document.getElementById('trainingScreen')?.classList.contains('active')) {
    window.initTrainingCharts?.();
    // 화면 크기 변경 시 마스코트 위치 재계산
    if (typeof updateSegmentGraphMascot === 'function') {
      updateSegmentGraphMascot();
    }
  }
});




// ========== DB 기반 전화번호 인증 함수 (올바른 구현) ==========
function authenticatePhoneWithDB(phoneNumber) {
    console.log('🔍 DB 인증 시작:', phoneNumber);
    
    return new Promise((resolve) => {
        try {
            // 입력값 정규화
            const normalizedInput = normalizePhoneNumber(phoneNumber);
            console.log('📱 정규화된 번호:', normalizedInput);
            
            if (!normalizedInput || normalizedInput.length < 11) {
                resolve({
                    success: false,
                    message: '올바른 전화번호를 입력해주세요',
                    user: null
                });
                return;
            }
            
            // DB 연결 상태 확인
            if (!isDBConnected || !dbUsers || dbUsers.length === 0) {
                console.warn('⚠️ DB가 연결되지 않았거나 사용자 데이터가 없습니다');
                resolve({
                    success: false,
                    message: 'DB 연결이 필요합니다. 잠시 후 다시 시도해주세요.',
                    user: null
                });
                return;
            }
            
            // DB에서 사용자 검색
            const matchedUser = dbUsers.find(user => {
                const userPhone = normalizePhoneNumber(user.contact || '');
                const matches = userPhone === normalizedInput;
                console.log(`👤 ${user.name}: ${userPhone} === ${normalizedInput} ? ${matches}`);
                return matches;
            });
            
            if (matchedUser) {
              console.log('✅ 사용자 찾음:', matchedUser.name);
              resolve({
                success: true,
                message: `${matchedUser.name}님 인증 완료!`,
                user: {
                  id: matchedUser.id,
                  name: matchedUser.name,
                  contact: matchedUser.contact,
                  ftp: parseInt(matchedUser.ftp) || 0,
                  weight: parseFloat(matchedUser.weight) || 0,
                  grade: String(matchedUser.grade ?? '2'),            // ★ 등급 포함
                  expiry_date: matchedUser.expiry_date ?? ''          // (선택) 만료일도 함께 보존
                }
              });
            } else {
                console.log('❌ 사용자를 찾을 수 없음');
                resolve({
                    success: false,
                    message: '등록되지 않은 전화번호입니다. 회원가입을 해주세요.',
                    user: null
                });
            }
            
        } catch (error) {
            console.error('❌ DB 인증 오류:', error);
            resolve({
                success: false,
                message: '인증 중 오류가 발생했습니다',
                user: null
            });
        }
    });
}

// ... 나머지 코드
// ... 3688줄: authenticatePhoneWithDB() 호출

// ===== Auth 복구 & 로그아웃 유틸 =====

// 앱 초기 진입 시 한 번 호출: authUser → currentUser 안정 복원
function checkAuthStatus() {
  const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
  const current  = JSON.parse(localStorage.getItem('currentUser') || 'null');
  const restored = authUser || current;

  if (restored) {
    window.currentUser = restored;
    localStorage.setItem('currentUser', JSON.stringify(restored));
  }
}


// ===== 로그아웃 & 화면 유틸 =====

// 모든 화면 숨기기 (이미 있다면 중복 추가하지 말고 기존 것 사용)
function hideAllScreens() {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
    screen.style.display = 'none';
    screen.style.opacity = '0';
    screen.style.visibility = 'hidden';
  });
}

// 인증 화면 표시 (이미 showAuthScreen이 있으면 그걸 쓰세요)
function showAuthScreen() {
  hideAllScreens();
  const authScreen = document.getElementById('authScreen');
  if (authScreen) {
    authScreen.classList.add('active');
    authScreen.style.display = 'block';
    authScreen.style.opacity = '1';
    authScreen.style.visibility = 'visible';
    /* body 스크롤 잠금 사용 안 함 — 모든 화면 인증과 동일하게 화면 단위 스크롤 */
    if ((window.PULL_TO_REFRESH_BLOCKED_SCREENS || []).includes('authScreen') && window.__pullToRefreshBlockerCleanup) {
      window.__pullToRefreshBlockerCleanup();
      window.__pullToRefreshBlockerCleanup = null;
    }
  }
}

// ★ 로그아웃: 권한/세션 완전 초기화
function logout() {
   // ✅ 전화번호 인증 폼 완전 초기화
      // 전체 새로고침
      window.location.reload();
   
  //resetAuthForm();
   
  try {
    // 1) 등급/세션 정보 전부 제거
    localStorage.removeItem('authUser');
    localStorage.removeItem('currentUser');
    window.currentUser = null;

    // 2) 임시 관리자 오버라이드 삭제(개발 중 사용했다면)
    if (typeof window.__TEMP_ADMIN_OVERRIDE__ !== 'undefined') {
      try { delete window.__TEMP_ADMIN_OVERRIDE__; } catch (e) { window.__TEMP_ADMIN_OVERRIDE__ = false; }
    }

    // 3) 화면 인증 화면으로 전환
    showAuthScreen();

    // 4) 사용자 목록/상태 뷰가 남아있다면 정리(선택)
    const userList = document.getElementById('userList');
    if (userList) userList.innerHTML = `<div class="muted">로그아웃되었습니다. 다시 로그인해주세요.</div>`;

    // 토스트 안내(선택)
    if (typeof showToast === 'function') showToast('로그아웃 되었습니다.');
  } catch (e) {
    console.error('로그아웃 처리 중 오류:', e);
  }
}


// ✅ 페이지 전체 새로고침 함수
function refreshPage() {
  try {
    // BLE 등 연결 장치 해제 후 완전 리로드
    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
      navigator.bluetooth.getDevices().then(devs => {
        devs.forEach(d => d.gatt?.disconnect?.());
      });
    }
  } catch (_) {}
  // 실제 새로고침
  window.location.reload();
}






// (공용) 모든 화면 숨기기
function hideAllScreens() {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
    screen.style.display = 'none';
    screen.style.opacity = '0';
    screen.style.visibility = 'hidden';
  });
}






/* ================================
   Screen Wake Lock (화면 항상 켜짐)
   ================================ */
const ScreenAwake = (() => {
  let wakeLock = null;

  async function acquire() {
    if (!('wakeLock' in navigator)) {
      console.warn('[ScreenAwake] Wake Lock API not supported in this browser.');
      return; // iOS 일부/구형 브라우저는 미지원
    }
    try {
      // 이미 있으면 재요청하지 않음
      if (wakeLock) return;
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('[ScreenAwake] acquired');

      // 시스템이 임의로 해제했을 때 플래그 정리
      wakeLock.addEventListener('release', () => {
        console.log('[ScreenAwake] released by system');
        wakeLock = null;
      });
    } catch (err) {
      console.warn('[ScreenAwake] acquire failed:', err);
      wakeLock = null;
    }
  }

  async function release() {
    try {
      if (wakeLock) {
        await wakeLock.release();
        console.log('[ScreenAwake] released by app');
      }
    } catch (err) {
      console.warn('[ScreenAwake] release failed:', err);
    } finally {
      wakeLock = null;
    }
  }

  // 탭/앱이 다시 보이면(복귀) 필요 시 자동 재획득
  async function reAcquireIfNeeded() {
    // 훈련 중인 상태에서만 재요청 (isRunning은 아래 훅에서 관리)
    if (document.visibilityState === 'visible' && window?.trainingState?.isRunning) {
      await acquire();
    }
  }

  function init() {
    document.addEventListener('visibilitychange', reAcquireIfNeeded);
    window.addEventListener('pageshow', reAcquireIfNeeded);
    window.addEventListener('focus', reAcquireIfNeeded);

    ScreenAwake.init();

    // 백그라운드/페이지 전환 시에는 안전하게 해제 (브라우저가 자동 해제해도 무방)
    window.addEventListener('pagehide', release);
  }

  return { acquire, release, init };
})();




// ========== 기존 변수들 유지 ==========
window.currentUser = window.currentUser || null;
window.currentWorkout = window.currentWorkout || null;

function normalizeType(seg){
  const t = (seg.segment_type || seg.label || "").toString().toLowerCase();
  if (t.includes("warm")) return "warmup";
  if (t.includes("cool")) return "cooldown";
  if (t.includes("rest") || t.includes("recover")) return "rest";
  if (t.includes("sweet")) return "sweetspot";
  if (t.includes("tempo")) return "tempo";
  return "interval"; // 기본값
}

// 세그먼트 카운트다운 상태 관리 (전역)
let segmentCountdownActive = false;
let segmentCountdownTimer = null;
let countdownTriggered = []; // 세그먼트별 카운트다운 트리거 상태




// [PATCH] Edge-Driven 카운트다운 표시 컨트롤러
const CountdownDisplay = {
  active: false,
  overlay: null,
  num: null,
  infoDiv: null,
  ensure(nextSegment) {
    if (!this.overlay) this.overlay = document.getElementById("countdownOverlay");
    if (!this.num) this.num = document.getElementById("countdownNumber");
    if (!this.overlay || !this.num) return false;

    // 다음 세그먼트 안내
    if (!this.infoDiv) {
      this.infoDiv = document.createElement('div');
      this.infoDiv.id = 'nextSegmentInfo';
      this.infoDiv.style.cssText = `
        position:absolute; bottom:30%; left:50%; transform:translateX(-50%);
        color:#fff; font-size:18px; font-weight:600; text-align:center;
        text-shadow:0 2px 4px rgba(0,0,0,.5); opacity:.9;`;
      this.overlay.appendChild(this.infoDiv);
    }
    const nextInfo = nextSegment
      ? `다음: ${(nextSegment.label || nextSegment.segment_type || '세그먼트')} FTP ${getSegmentFtpPercent(nextSegment)}%`
      : '훈련 완료';
    this.infoDiv.textContent = nextInfo;

    this.overlay.classList.remove("hidden");
    this.overlay.style.display = "flex";
    this.active = true;
    return true;
  },
  render(n) {
    if (!this.overlay || !this.num) return;
    this.num.textContent = String(n);
  },
  finish(delayMs = 800) {
    if (!this.overlay) return;
    setTimeout(() => {
      this.overlay.classList.add("hidden");
      this.overlay.style.display = "none";
      this.active = false;
    }, delayMs);
  },
  hideImmediate() {
    if (!this.overlay) return;
    this.overlay.classList.add("hidden");
    this.overlay.style.display = "none";
    this.active = false;
  }
};

// 모바일 대시보드용 카운트다운 표시 컨트롤러
const MobileCountdownDisplay = {
  active: false,
  overlay: null,
  num: null,
  infoDiv: null,
  ensure(nextSegment) {
    if (!this.overlay) this.overlay = document.getElementById("mobileCountdownOverlay");
    if (!this.num) this.num = document.getElementById("mobileCountdownNumber");
    if (!this.overlay || !this.num) return false;

    // 다음 세그먼트 안내
    if (!this.infoDiv) {
      this.infoDiv = document.createElement('div');
      this.infoDiv.id = 'mobileNextSegmentInfo';
      this.infoDiv.style.cssText = `
        position:absolute; bottom:30%; left:50%; transform:translateX(-50%);
        color:#fff; font-size:24px; font-weight:600; text-align:center;
        text-shadow:0 2px 4px rgba(0,0,0,.5); opacity:.9;`;
      this.overlay.appendChild(this.infoDiv);
    }
    const nextInfo = nextSegment
      ? `다음: ${(nextSegment.label || nextSegment.segment_type || '세그먼트')} FTP ${getSegmentFtpPercent(nextSegment)}%`
      : '훈련 완료';
    this.infoDiv.textContent = nextInfo;

    this.overlay.classList.remove("hidden");
    this.overlay.style.display = "flex";
    this.overlay.style.zIndex = "10000";
    this.num.style.fontSize = "300px"; // 크게 표시
    this.active = true;
    return true;
  },
  render(n) {
    if (!this.overlay || !this.num) return;
    this.num.textContent = String(n);
    this.num.style.fontSize = "300px"; // 크게 표시
  },
  finish(delayMs = 800) {
    if (!this.overlay) return;
    setTimeout(() => {
      this.overlay.classList.add("hidden");
      this.overlay.style.display = "none";
      this.active = false;
    }, delayMs);
  },
  hideImmediate() {
    if (!this.overlay) return;
    this.overlay.classList.add("hidden");
    this.overlay.style.display = "none";
    this.active = false;
  }
};

// 경과 시간 텍스트를 형식 변경
function formatHMS(totalSeconds){
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map(v => String(v).padStart(2,"0")).join(":");
}



// 세그먼트 카운트다운 함수 (수정된 버전)
// [PATCH] 내부 타이머 없는 표시 전용 카운트다운
function startSegmentCountdown(initialNumber, nextSegment) {
  // 블루투스 개인 훈련 대시보드에서는 카운트다운 실행하지 않음
  const isBluetoothIndividualScreen = window.location.pathname.includes('bluetoothIndividual.html');
  if (isBluetoothIndividualScreen) {
    console.log('[startSegmentCountdown] 블루투스 개인 훈련 대시보드에서는 카운트다운 실행하지 않음');
    return;
  }
  
  // initialNumber 는 보통 5 (6초 시점에서 5 표시)
  if (segmentCountdownActive) return;
  segmentCountdownActive = true;

  const ok = CountdownDisplay.ensure(nextSegment);
  if (!ok) {
    segmentCountdownActive = false;
    return;
  }

  // 처음 숫자와 짧은 비프
  CountdownDisplay.render(initialNumber);
  playBeep(880, 120, 0.25);
  
  // 모바일 대시보드용 카운트다운도 표시
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  if (mobileScreen && 
      (mobileScreen.classList.contains('active') || 
       window.getComputedStyle(mobileScreen).display !== 'none')) {
    MobileCountdownDisplay.ensure(nextSegment);
    MobileCountdownDisplay.render(initialNumber);
  }
}

// [PATCH] 카운트다운 강제 정지도 표시 컨트롤러 사용
function stopSegmentCountdown() {
  console.log('카운트다운 강제 정지');
  CountdownDisplay.hideImmediate();
  
  // 모바일 대시보드용 카운트다운도 정지
  MobileCountdownDisplay.hideImmediate();
  
  segmentCountdownActive = false;     // [PATCH] 상태 리셋
   
  if (segmentCountdownTimer) {
    clearInterval(segmentCountdownTimer);
    segmentCountdownTimer = null;
  }
  segmentCountdownActive = false;
}



// 참고: 기존 훈련 시작 카운트다운도 동일한 방식으로 개선 (선택적)
function startWithCountdown(sec = 5) {
  const overlay = document.getElementById("countdownOverlay");
  const num = document.getElementById("countdownNumber");
  
  if (!overlay || !num) {
    console.warn('Countdown elements not found, starting workout directly');
    return startWorkoutTraining();
  }

  console.log(`Starting ${sec}s countdown...`);

  // 오버레이 확실히 표시
  overlay.classList.remove("hidden");
  overlay.style.display = "flex";

  let remain = sec;
  
  // 초기 표시 및 첫 번째 삐 소리
  num.textContent = remain;
  playBeep(880, 120, 0.25);

  const timer = setInterval(async () => {
    remain -= 1;

    if (remain > 0) {
      // 1, 2, 3, 4초일 때 - 일반 삐 소리
      num.textContent = remain;
      playBeep(880, 120, 0.25);
    } else if (remain === 0) {
      // 0초일 때 - 화면에 "0" 표시하고 강조 삐 소리
      num.textContent = "0";
      
      try {
        await playBeep(1500, 700, 0.35, "square");
      } catch (e) {
        console.warn('Failed to play beep:', e);
      }
      
      // 0.5초 추가 대기 후 오버레이 닫기 및 훈련 시작
      setTimeout(() => {
        overlay.classList.add("hidden");
        overlay.style.display = "none";
        console.log('Countdown finished, starting workout...');
        startWorkoutTraining();
      }, 500);
      
      // 타이머 정리
      clearInterval(timer);
      
    } else {
      // remain < 0일 때 - 안전장치
      console.warn('Countdown safety mechanism triggered');
      clearInterval(timer);
      overlay.classList.add("hidden");
      overlay.style.display = "none";
      startWorkoutTraining();
    }
  }, 1000);
}




// 카운트다운 강제 정지 함수
function stopSegmentCountdown() {
  console.log('카운트다운 강제 정지');
  if (segmentCountdownTimer) {
    clearInterval(segmentCountdownTimer);
    segmentCountdownTimer = null;
  }
  
  const overlay = document.getElementById("countdownOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.style.display = "none";
  }
  
  segmentCountdownActive = false;
}

// 세그먼트 건너뛰기 시에도 카운트다운 정리
function skipCurrentSegment() {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  try {
    const w = window.currentWorkout;
    if (!w || !w.segments) {
      console.warn('No workout or segments available for skipping');
      return;
    }
    
    // 활성 카운트다운 정지
    if (segmentCountdownActive) {
      stopSegmentCountdown();
    }
    
    // 해당 세그먼트의 카운트다운 트리거 상태도 리셋
    if (countdownTriggered && window.trainingState.segIndex < countdownTriggered.length) {
      countdownTriggered[window.trainingState.segIndex] = true; // 건너뛴 것으로 표시
    }

    // 🔽 현재 세그먼트를 '완료'로 처리
    let avgW_now = 0;
    const avgEl = document.getElementById('avgSegmentPowerValue');
    if (avgEl) {
      const n = parseFloat(avgEl.textContent);
      if (!Number.isNaN(n)) avgW_now = n;
    }
     
       const cur = window.trainingState?.segIndex || 0;
      finalizeSegmentCompletion(cur, avgW_now);

     
    // 다음 세그먼트로 이동
    const newIndex = Math.min(w.segments.length - 1, (window.trainingState?.segIndex || 0) + 1);
    if (window.trainingState) {
      window.trainingState.segIndex = newIndex;
      window.trainingState.segElapsedSec = 0;
       
      // 🔵 핵심: 전체 경과시간을 '새 세그먼트 시작 시각'으로 점프
      const jumpTo = getCumulativeStartSec(newIndex);
      // window.trainingState.elapsedSec = jumpTo;  // ❌ 이건 이제 비추천
      window.setElapsedSecSafely?.(jumpTo);          // ✅ startMs까지 보정

       
      // (참고) 그룹 타임라인을 쓰는 경우 start time을 가진 객체가 따로 있으면 그것도 갱신
      if (window.trainingSession && window.trainingSession.startTime) {
        // startTime을 과거로 재조정해서 now-startTime ≈ jumpTo 가 되도록 보정할 수도 있음
        // 필요 없다면 생략 가능
      }
       
    }
    
    if (typeof applySegmentTarget === 'function') {
      applySegmentTarget(newIndex);
    }
    if (typeof updateTimeUI === 'function') {
      updateTimeUI();
    }

    // 🔵 타임라인 즉시 반영
    if (typeof updateSegmentBarTick === 'function') updateSegmentBarTick();
    if (typeof updateTimelineByTime === 'function') updateTimelineByTime();
     
    console.log(`세그먼트 건너뛰기: ${newIndex + 1}번째 세그먼트로 이동`);
    
    if (typeof showToast === 'function') {
      showToast(`세그먼트 ${newIndex + 1}로 건너뛰기`);
    }
    
  } catch (error) {
    console.error('Error in skipCurrentSegment:', error);
  }
}

// 훈련 화면의 세그먼트에서 FTP 백분율 추출하는 헬퍼 함수 추가
function getSegmentFtpPercent(seg) {
  if (!seg) return 0;
  
  const targetType = seg.target_type || 'ftp_pct';
  
  // dual 타입: target_value 구분자 "~" (저장 규칙), 파싱 시 "~" 또는 "/" 호환
  if (targetType === 'dual') {
    const targetValue = seg.target_value;
    if (targetValue != null) {
      if (Array.isArray(targetValue) && targetValue.length > 0) {
        return Math.round(Number(targetValue[0]) || 100);
      }
      const targetValueStr = String(targetValue).trim();
      const delim = targetValueStr.includes('~') ? '~' : (targetValueStr.includes('/') ? '/' : null);
      if (delim) {
        const parts = targetValueStr.split(delim).map(s => s.trim()).filter(s => s.length > 0);
        if (parts.length > 0) {
          const ftpPercent = Number(parts[0]) || 100;
          return Math.round(ftpPercent);
        }
      } else {
        // 구분자(~ 또는 /)가 없는 경우: 숫자로 저장된 경우일 수 있음
        // DB에서 "100/120"이 숫자 100120으로 변환된 경우 처리
        const numValue = Number(targetValueStr);
        if (!isNaN(numValue) && numValue > 0) {
          // 숫자가 1000보다 크면 (예: 100120) "100/120"이 숫자로 변환된 것으로 간주
          if (numValue > 1000 && numValue < 1000000) {
            // 100120을 100과 120으로 분리 시도
            // 마지막 3자리가 RPM일 가능성이 높음 (예: 100120 → 100/120)
            const str = String(numValue);
            if (str.length >= 4) {
              // 마지막 3자리를 RPM으로, 나머지를 FTP%로 추정
              const rpmPart = str.slice(-3);
              const ftpPart = str.slice(0, -3);
              const estimatedFtp = Number(ftpPart);
              const estimatedRpm = Number(rpmPart);
              
              // 유효성 검사: FTP%는 30-200, RPM은 50-200 범위
              if (estimatedFtp >= 30 && estimatedFtp <= 200 && estimatedRpm >= 50 && estimatedRpm <= 200) {
                console.warn('[getSegmentFtpPercent] 숫자로 변환된 값을 복원 시도:', numValue, '→', estimatedFtp, '/', estimatedRpm);
                return Math.round(estimatedFtp);
              }
            }
            console.error('[getSegmentFtpPercent] dual 타입의 target_value가 잘못된 형식입니다. "100~120" 형식이어야 합니다:', targetValue);
            return 100;
          } else if (numValue <= 1000) {
            return Math.round(numValue);
          } else {
            console.error('[getSegmentFtpPercent] dual 타입의 target_value가 잘못된 형식입니다:', targetValue);
            return 100; // 기본값 반환
          }
        }
      }
    }
    // 기본값 반환
    return 100;
  }
  
  // cadence_rpm 타입인 경우: FTP%가 없으므로 0 반환
  if (targetType === 'cadence_rpm') {
    return 0;
  }
  
  // 1순위: target_value (이미 퍼센트)
  if (typeof seg.target_value === "number") {
    return Math.round(seg.target_value);
  }
  
  // 2순위: ftp_percent (이미 퍼센트)
  if (typeof seg.ftp_percent === "number") {
    return Math.round(seg.ftp_percent);
  }
  
  // 3순위: target (0~1 비율을 퍼센트로 변환)
  if (typeof seg.target === "number") {
    return Math.round(seg.target * 100);
  }
  
  // 4순위: target_value가 문자열이고 숫자로 변환 가능한 경우
  if (seg.target_value != null) {
    const numValue = Number(seg.target_value);
    if (!isNaN(numValue) && numValue > 0 && numValue <= 200) {
      // 200 이하는 FTP%로 간주
      return Math.round(numValue);
    }
  }
  
  // 경고는 디버그 모드에서만 출력 (너무 많은 경고 방지)
  if (window.DEBUG_MODE) {
    console.warn('FTP 백분율을 찾을 수 없습니다:', seg);
  }
  return 100; // 기본값
}

// 훈련 지표 상태 (TSS / kcal / NP 근사)
const trainingMetrics = {
  elapsedSec: 0,      // 전체 경과(초)
  joules: 0,          // 누적 일(줄). 1초마다 W(=J/s)를 더해줌
  ra30: 0,            // 30초 롤링 평균 파워(근사: 1차 IIR)
  np4sum: 0,          // (ra30^4)의 누적 합
  count: 0,           // 표본 개수(초 단위)
  distanceKm: 0       // 속도 적산 거리(km). 속도(km/h) * 시간(초)/3600
};

// 전역으로 노출 (resultManager.js에서 TSS 계산 시 사용)
window.trainingMetrics = trainingMetrics;

// 훈련화면의 건너뛰기에서 활용 >>> 새 세그먼트의 누적 시작 시각(초) 구하기
function getCumulativeStartSec(index) {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    // Bluetooth Coach에서는 bluetoothCoachState.currentWorkout을 사용해야 함
    return 0;
  }
  
  const w = window.currentWorkout;
  if (!w || !Array.isArray(w.segments)) return 0;

  let acc = 0;
  for (let i = 0; i < index; i++) {
    const seg = w.segments[i];
    const dur = segDurationSec(seg); // 이미 파일 내에 존재하는 함수 사용
    acc += dur;
  }
  return acc;
}


// 세그먼트 누적 시작초
// function getCumulativeStartSec(index) {
  // const w = window.currentWorkout;
  // if (!w || !Array.isArray(w.segments)) return 0;
  // let acc = 0;
  // for (let i = 0; i < index; i++) {
    // acc += segDurationSec(w.segments[i]); // 기존 함수 그대로 사용
  // }
  // return acc;
// }



// 세그먼트 목표 파워(W) 계산 (RPE 강도 보정 적용)
function getSegmentTargetW(i) {
  const w = window.currentWorkout;
  const seg = w?.segments?.[i];
  if (!seg) return 0;
  const ftp = Number(window.currentUser?.ftp) || 200;
  const ftpPercent = getSegmentFtpPercent(seg); // 기존 로직 활용
  const basePower = ftp * (ftpPercent / 100);
  
  // RPE 강도 보정 적용 (기본값 1.0 = 100%)
  const intensityAdjustment = window.trainingIntensityAdjustment || 1.0;
  return Math.round(basePower * intensityAdjustment);
}

// 세그먼트 타입(휴식/쿨다운 여부 확인용)
function getSegmentType(i) {
  const w = window.currentWorkout;
  const seg = w?.segments?.[i];
  const t = (seg?.segment_type || seg?.type || "").toLowerCase();
  return t; // e.g., "rest", "cooldown", "interval" 등
}


// 세그 평균 파워 → 달성도(%) → 색상 등급 → 타임라인에 적용
function finalizeSegmentCompletion(i, avgW) {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  try {
    // 휴식/쿨다운은 회색 고정
    const segType = getSegmentType(i);
    const isGray = (segType.includes('rest') || segType.includes('cooldown'));
    
    // 타임라인 세그 컨테이너 찾기 (data-index 또는 id 둘 다 시도)
    let segEl = document.querySelector(`.timeline-segment[data-index="${i}"]`);
    if (!segEl) segEl = document.getElementById(`seg-${i}`); // 프로젝트 구조에 맞춰 폴백
    if (!segEl) return;

    // 기존 done-* 클래스 제거
    segEl.classList.remove(
      'done-mint','done-green','done-lime','done-yellow','done-orange','done-red','done-gray'
    );

    if (isGray) {
      segEl.classList.add('done-gray');
      return;
    }

    // 달성도 계산
    const targetW = getSegmentTargetW(i);
    const avg = Number(avgW);
    const ratioPct = (targetW > 0 && Number.isFinite(avg)) ? (avg / targetW) * 100 : 0;

    // 버킷 분기
    let cls = 'done-red'; // 기본: 75% 미만
    if (ratioPct >= 115)       cls = 'done-mint';
    else if (ratioPct >= 105)  cls = 'done-green';
    else if (ratioPct >= 95)   cls = 'done-lime';
    else if (ratioPct >= 85)   cls = 'done-yellow';
    else if (ratioPct >= 75)   cls = 'done-orange';

    segEl.classList.add(cls);
  } catch (e) {
    console.error('finalizeSegmentCompletion error:', e);
  }

   // 세그먼트 종료 시 결과 기록
   try {
     const idx = Number(window.trainingState?.segIndex) || 0;
     const seg = (window.currentWorkout?.segments || [])[idx] || null;
     window.trainingResults?.recordSegmentResult?.(idx, seg);
   } catch (e) {
     console.warn('[result] recordSegmentResult failed:', e);
   }   
   
}





// 타임라인 생성/업데이트 함수 추가
function secToMinStr(sec){
  const m = Math.floor(sec/60);
  return `${m}분`;
}

// Beep 사운드 (Web Audio) — window에 보관해 다른 스크립트(bluetoothIndividual.js 등)와 전역 선언 충돌 방지
if (typeof window.__beepCtx === 'undefined') window.__beepCtx = null;

// 오디오 컨텍스트 초기화 함수 개선
async function ensureBeepContext() {
  try {
    if (!window.AudioContext && !window.webkitAudioContext) {
      console.warn('Web Audio API not supported');
      return false;
    }

    if (!window.__beepCtx) {
      window.__beepCtx = new (window.AudioContext || window.webkitAudioContext)();
      console.log('New audio context created');
    }
    
    if (window.__beepCtx.state === "suspended") {
      await window.__beepCtx.resume();
      console.log('Audio context resumed');
    }
    
    return window.__beepCtx.state === "running";
    
  } catch (error) {
    console.error('Audio context initialization failed:', error);
    window.__beepCtx = null;
    return false;
  }
}

// 향상된 playBeep 함수 (더 안정적인 오디오 재생)
async function playBeep(freq = 880, durationMs = 120, volume = 0.2, type = "sine") {
  try {
    console.log(`Beep 재생 시도: ${freq}Hz, ${durationMs}ms, ${volume} 볼륨, ${type} 타입`);
    
    const contextReady = await ensureBeepContext();
    if (!contextReady) {
      console.warn('Audio context not available for beep');
      return;
    }

    const osc = window.__beepCtx.createOscillator();
    const gain = window.__beepCtx.createGain();
    
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;

    osc.connect(gain);
    gain.connect(window.__beepCtx.destination);

    const now = window.__beepCtx.currentTime;
    
    // 볼륨 페이드 아웃 설정
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    // 오실레이터 시작 및 정지
    osc.start(now);
    osc.stop(now + durationMs / 1000);
    
    console.log(`Beep 재생 성공: ${freq}Hz`);
    
    // Promise로 재생 완료 시점 반환
    return new Promise(resolve => {
      setTimeout(resolve, durationMs);
    });
    
  } catch (error) {
    console.error('Beep 재생 실패:', error);
  }
}

// 시간 포맷: 75 -> "01:15"
function formatMMSS(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

// 훈련 상태 => 타임라인 생성 (initializeTraining 내부에서 호출)
// 훈련 상태 => 타임라인 생성 (initializeTraining 내부에서 호출)
function createTimeline() {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  const cont = document.getElementById("timelineSegments");
  const w = window.currentWorkout;
  if (!cont || !w || !Array.isArray(w.segments)) return;

  const segs = w.segments;
  const total = segs.reduce((sum, seg) => sum + (seg.duration_sec || seg.duration || 0), 0) || 1;

  // 누적 종료시각(초) 계산 → window.trainingState.segEnds 에 저장
  const segEnds = [];
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const dur = (typeof segs[i].duration_sec === "number" ? segs[i].duration_sec
               : typeof segs[i].duration === "number" ? segs[i].duration : 0);
    acc += dur;
    segEnds[i] = acc;
  }
  if (window.trainingState) window.trainingState.segEnds = segEnds;

  // 타임라인 DOM 렌더
  cont.innerHTML = segs.map((seg, i) => {
    const dur = (typeof seg.duration_sec === "number" ? seg.duration_sec
               : typeof seg.duration === "number" ? seg.duration : 0);
    const widthPct = (dur / total) * 100;
    const label = seg.segment_type || seg.label || "세그먼트";
    const timeMin = Math.floor(dur / 60);
    const timeSec = dur % 60;
    const timeLabel = timeSec > 0 ? `${timeMin}:${String(timeSec).padStart(2, "0")}` : `${timeMin}분`;

   const type = (typeof normalizeType === "function") ? normalizeType(seg) : (seg.segment_type || seg.label || "interval").toLowerCase();
   return `
     <div class="timeline-segment" data-index="${i}" id="seg-${i}" data-type="${type}" style="width:${widthPct}%">
       <div class="progress-fill" id="segFill-${i}"></div>
       <span class="segment-label">${label}</span>
       <span class="segment-time">${timeLabel}</span>
     </div>
   `;
  }).join("");
  
        // 세그먼트 그래프 초기화 (훈련 화면용)
        if (typeof drawSegmentGraph === 'function' && segs.length > 0) {
          setTimeout(() => {
            drawSegmentGraph(segs, -1, 'trainingSegmentGraph');
            // 마스코트 위치 초기화
            if (typeof updateSegmentGraphMascot === 'function') {
              updateSegmentGraphMascot();
            }
          }, 100);
        }
}



// 훈련 상태 => 세그먼트별 달성도를 시간 기준 달성도(=진행률)로 표현
// === PATCH: robust timeline updater (no hard dependency on trainingSession) ===
function updateTimelineByTime() {
  try {
    const ts = window.trainingState || {};
    const w  = window.currentWorkout;
    if (!w || !Array.isArray(w.segments)) return;

    // 1) 경과초 결정: trainingState.elapsedSec 우선, 없으면 trainingSession.startTime 보조
    let elapsed = Number(ts.elapsedSec);
    if (!Number.isFinite(elapsed)) {
      const session = window.trainingSession;
      if (session && session.startTime) {
        elapsed = Math.floor((Date.now() - session.startTime) / 1000);
      } else {
        elapsed = 0;
      }
    }

    // 2) 세그먼트 경계(누적 종료시각) 이용해 진행률 계산
    const segEnds = ts.segEnds || [];
    let startAt = 0;
    for (let i = 0; i < w.segments.length; i++) {
      const endAt = (segEnds[i] != null)
        ? segEnds[i]
        : startAt + (segDurationSec(w.segments[i]) || 0);
      const dur = Math.max(1, endAt - startAt);

      // 타임라인 DOM
      const segEl  = document.querySelector(`.timeline-segment[data-index="${i}"]`)
                   || document.getElementById(`seg-${i}`);
      const fillEl = segEl?.querySelector('.progress-fill');

      if (fillEl) {
        let ratio = 0;
        if (elapsed >= endAt) {
          ratio = 1; // 완료된 세그먼트
        } else if (elapsed >= startAt && elapsed < endAt) {
          // 현재 진행 중인 세그먼트: 해당 세그먼트 내에서의 경과 시간 기준
          const segElapsed = elapsed - startAt;
          ratio = Math.min(1, Math.max(0, segElapsed / dur));
        }
        // else ratio = 0 (아직 시작 안 된 세그먼트)

        fillEl.style.width = (ratio * 100) + "%";

        // 현재 세그먼트 색상은 CSS의 .is-current 클래스로 처리 (주황색)
        // 인라인 스타일로 색상을 강제 설정하지 않음
      }

      startAt = endAt;
    }
  } catch (e) {
    console.error("updateTimelineByTime error:", e);
  }
}


// 훈련 상태 => 현재 세그먼트 전환 시 색/타이틀 업데이트
function onSegmentChanged(newIndex){
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  const seg = currentWorkout.segments[newIndex];
  if (!seg) return;
  const ftp = currentUser?.ftp || 200;
  liveData.targetPower = Math.round(ftp * (seg.ftp_percent/100));
  const nameEl = document.getElementById("currentSegmentName");
  if (nameEl) nameEl.textContent = `${seg.segment_type || "세그먼트"} - FTP ${seg.ftp_percent}%`;
  updateTrainingDisplay();
}

// 훈련 상태 => 시간 달성도
function colorFillByPower(i, avg, target){
  const el = document.getElementById(`segFill-${i}`);
  if (!el) return;
  const ratio = target>0 ? (avg/target) : 0;
  // 90% 미만 주황, 110% 초과 빨강, 그 외 파랑 등 자유롭게
  if (ratio < 0.9) el.style.background = "#F56500";
  else if (ratio > 1.1) el.style.background = "#DC3545";
  else el.style.background = "#2E74E8";
}

// 달성도 색상: 목표 대비 평균 파워 비율(ratio)
function colorByAchievement(ratio){
  if (!isFinite(ratio) || ratio <= 0) return "#3b82f6"; // 기본 파랑
  if (ratio < 0.9)  return "#f59e0b"; // 부족(주황)
  if (ratio > 1.1)  return "#ef4444"; // 과도(빨강)
  return "#22c55e";                   // 적정(초록)
}

// 세그먼트 바 상태(전역)
const segBar = {
  totalSec: 0,     // 전체 운동 시간(초)
  ends: [],        // 각 세그먼트의 누적 종료시각(초)
  sumPower: [],    // 세그먼트별 평균 파워 계산용 합
  sumCadence: [],  // 세그먼트별 평균 RPM 계산용 합
  samples: [],     // 세그먼트별 표본 수(초)
};

// 전역에서 접근 가능하도록 window에 노출 (그룹 훈련 실시간 데이터 동기화용)
window.segBar = segBar;

// 초 → "m분" 짧은 표기
function secToMinShort(sec){ return `${Math.floor((sec||0)/60)}분`; }

// 세그먼트 duration(초) 추출
// 1. 세그먼트 지속시간 추출 함수 수정 (통일된 방식)
function segDurationSec(seg) {
  if (!seg) return 0;
  
  // duration_sec 우선, 없으면 duration 사용
  if (typeof seg.duration_sec === "number") {
    return Math.max(0, Math.floor(seg.duration_sec));
  }
  if (typeof seg.duration === "number") {
    return Math.max(0, Math.floor(seg.duration));
  }
  
  console.warn('세그먼트 지속시간을 찾을 수 없습니다:', seg);
  return 300; // 기본값 5분
}

// 목표 파워(W)
function segTargetW(seg, ftp) {
  const ftpPercent = getSegmentFtpPercent(seg);
  return Math.round(ftp * (ftpPercent / 100));
}

// 세그먼트 바 생성
// app.js의 buildSegmentBar 함수를 대체
// app.js의 buildSegmentBar 함수 대체
function buildSegmentBar(){
  const cont = document.getElementById("timelineSegments");
  const w = window.currentWorkout;
  if (!cont || !w) return;

  const segs = w.segments || [];
  const total = segs.reduce((s, seg)=> s + segDurationSec(seg), 0) || 1;

  // 그룹화된 세그먼트 생성 (workoutManager.js 함수 활용)
  const groupedSegments = typeof window.detectAndGroupSegments === 'function' 
    ? window.detectAndGroupSegments(segs) 
    : segs.map((seg, i) => ({ type: 'single', segment: seg, originalIndex: i }));

  segBar.totalSec = total;
  segBar.ends = [];
  segBar.sumPower = Array(segs.length).fill(0);
  segBar.sumCadence = Array(segs.length).fill(0);
  segBar.samples  = Array(segs.length).fill(0);

  // 누적 종료시각 계산 (원본 세그먼트 기준)
  let acc = 0;
  segs.forEach((seg, i) => {
    const dur = segDurationSec(seg);
    acc += dur; 
    segBar.ends[i] = acc;
  });

  // 그룹화된 세그먼트를 렌더링
  cont.innerHTML = groupedSegments.map((item, groupIndex) => {
    if (item.type === 'single') {
      const seg = item.segment;
      const dur = segDurationSec(seg);
      const widthPct = (dur / total) * 100;
      const type = normalizeType(seg);
      const segmentNumber = item.originalIndex + 1; // 순번
      const timeMinutes = Math.floor(dur / 60);
      const timeSeconds = dur % 60;
      const timeLabel = timeSeconds > 0 ? `${timeMinutes}:${timeSeconds.toString().padStart(2, '0')}` : `${timeMinutes}분`;
      
      return `
        <div class="timeline-segment" data-index="${item.originalIndex}" data-type="${type}" 
             data-group-type="single" style="width:${widthPct}%"
             aria-label="세그먼트 ${segmentNumber} · ${timeLabel}">
          <div class="progress-fill" id="segFill-${item.originalIndex}"></div>
          <div class="segment-labels">
            <span class="segment-number">#${segmentNumber}</span>
            <span class="segment-time">${timeLabel}</span>
          </div>
        </div>
      `;
    } else {
      // 그룹화된 세그먼트 (반복)
      const { pattern, repeatCount, totalDuration, startIndex, endIndex } = item;
      const widthPct = (totalDuration / total) * 100;
      const mainType = normalizeType(pattern[0]);
      const timeMinutes = Math.round(totalDuration / 60);
      const timeLabel = `${timeMinutes}분`;
      const groupNumber = `G${groupIndex + 1}`; // 그룹 번호
      
      return `
        
        <div class="timeline-segment timeline-group" data-group-index="${groupIndex}"
             data-type="${mainType}" data-group-type="grouped" style="width:${widthPct}%"
             data-start-index="${startIndex}" data-end-index="${endIndex}"
             aria-label="반복 그룹 ${groupNumber} × ${repeatCount}회 · ${timeLabel}">
          <div class="progress-fill" id="groupFill-${groupIndex}"></div>
          <div class="segment-labels">
            <span class="segment-number">${groupNumber}</span>
            <span class="repeat-count">×${repeatCount}</span>
            <span class="segment-time">${timeLabel}</span>
          </div>
        </div>
      `;
    }
  }).filter(Boolean).join('');
}

// 메인 업데이트 함수(1초마다 호출):
// app.js의 updateSegmentBarTick 함수를 대체
// app.js의 updateSegmentBarTick 함수 대체 - 달성도 기반 색상 적용
function updateSegmentBarTick(){
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  const w = window.currentWorkout;
  const ftp = (window.currentUser?.ftp) || 200;
  if (!w || !w.segments) return;

  const elapsed = window.trainingState.elapsedSec || 0;
  const segIndex = window.trainingState.segIndex || 0;

  // 1) 개별 세그먼트 진행률 업데이트
  // 각 세그먼트의 진행률은 해당 세그먼트 내에서의 경과 시간 기준으로 계산
  let startAt = 0;
  for (let i = 0; i < w.segments.length; i++) {
    const seg = w.segments[i];
    const dur = segDurationSec(seg);
    const endAt = startAt + dur;
    const fill = document.getElementById(`segFill-${i}`);
    
    if (fill) {
      let ratio = 0;
      if (elapsed >= endAt) {
        ratio = 1; // 완료된 세그먼트
      } else if (elapsed >= startAt && elapsed < endAt) {
        // 현재 진행 중인 세그먼트: 해당 세그먼트 내에서의 경과 시간 기준
        const segElapsed = elapsed - startAt;
        ratio = Math.min(1, Math.max(0, segElapsed / dur));
      }
      // else ratio = 0 (아직 시작 안 된 세그먼트)
      
      fill.style.width = (ratio * 100) + "%";
       
        // 현재 세그먼트인 경우 투명 노란색 배경 강제 적용
        const segEl = document.querySelector(`.timeline-segment[data-index="${i}"]`);
        if (segEl && segEl.classList.contains('is-current')) {
          // CSS가 적용되지 않는 경우를 대비해 인라인 스타일로도 설정
          fill.style.background = 'linear-gradient(90deg, rgba(255,255,0,0.3) 0%, rgba(255,255,0,0.2) 100%)';
          fill.style.backgroundColor = 'rgba(255,255,0,0.25)';
          fill.style.opacity = '1';
          fill.style.borderRight = '1px solid rgba(255,255,0,0.4)';
        } else if (elapsed < startAt) {
          // 아직 시작하지 않은 세그먼트는 기본 스타일로 리셋
          fill.style.background = '';
          fill.style.backgroundColor = '';
          fill.style.opacity = '';
          fill.style.borderRight = '';
        }
       
    }
    startAt = endAt;
  }

  // 2) 그룹화된 세그먼트 진행률 업데이트
  const groupedElements = document.querySelectorAll('.timeline-group');
  groupedElements.forEach(groupEl => {
    const startIndex = parseInt(groupEl.dataset.startIndex) || 0;
    const endIndex = parseInt(groupEl.dataset.endIndex) || 0;
    const groupIndex = parseInt(groupEl.dataset.groupIndex) || 0;
    
    // 그룹 내 전체 시간 계산
    let groupStartTime = 0;
    let groupTotalTime = 0;
    
    for (let i = 0; i < startIndex; i++) {
      groupStartTime += segDurationSec(w.segments[i]);
    }
    
    for (let i = startIndex; i < endIndex; i++) {
      groupTotalTime += segDurationSec(w.segments[i]);
    }
    
    // 그룹 진행률 계산
    const groupElapsed = Math.max(0, elapsed - groupStartTime);
    const groupRatio = Math.min(1, Math.max(0, groupElapsed / groupTotalTime));
    
    // 그룹 경계
    const groupStart = groupStartTime;
    const groupEnd   = groupStartTime + groupTotalTime;
    
    const groupFill = document.getElementById(`groupFill-${groupIndex}`);
    if (groupFill) {
      groupFill.style.width = (groupRatio * 100) + "%";
    }

      // 상태/달성도 클래스 초기화
      // [변경 후] 그룹세그먼트 왼쪽 라인 유지 보장
      groupEl.classList.remove(
        "is-complete","is-current","is-upcoming",
        "timeline-ach-low","timeline-ach-good"
      );
     
      
      
      // 달성도 계산: 그룹 내 인터벌 세그먼트들의 평균 달성율
      let achievementSum = 0;
      let achievementCount = 0;
      for (let i = startIndex; i < endIndex; i++) {
        const seg = w.segments[i];
        const tgt = segTargetW(seg, ftp);
        const samples = segBar.samples[i] || 0;
        const avgW = samples ? (segBar.sumPower[i] / samples) : 0;
        
        // 각 인터벌 세그먼트의 달성율 계산
        if (tgt > 0) {
          const achievement = avgW / tgt;
          achievementSum += achievement;
          achievementCount++;
        }
      }
      const groupAch = achievementCount > 0 ? (achievementSum / achievementCount) : 0;
      
      // 상태 + 달성도 클래스 부여 (인터벌 세그먼트와 동일한 클래스명 사용)
      if (elapsed >= groupEnd) {
        groupEl.classList.add("is-complete");
        // 인터벌 세그먼트와 동일한 기준 사용 (0.95 이상이면 good, 미만이면 low)
        if (groupAch >= 0.95) {
          groupEl.classList.add("timeline-ach-good");
        } else {
          groupEl.classList.add("timeline-ach-low");
        }
        // 완료된 그룹은 기본 스타일로 리셋
        if (groupFill) {
          groupFill.style.background = '';
          groupFill.style.backgroundColor = '';
          groupFill.style.opacity = '';
          groupFill.style.borderRight = '';
        }
      } else if (elapsed >= groupStart && elapsed < groupEnd) {
        groupEl.classList.add("is-current");
        // 현재 그룹 세그먼트인 경우 투명 노란색 배경 강제 적용
        if (groupFill) {
          groupFill.style.background = 'linear-gradient(90deg, rgba(255,255,0,0.3) 0%, rgba(255,255,0,0.2) 100%)';
          groupFill.style.backgroundColor = 'rgba(255,255,0,0.25)';
          groupFill.style.opacity = '1';
          groupFill.style.borderRight = '1px solid rgba(255,255,0,0.4)';
        }
      } else {
        groupEl.classList.add("is-upcoming");
        // 아직 시작하지 않은 그룹은 기본 스타일로 리셋
        if (groupFill) {
          groupFill.style.background = '';
          groupFill.style.backgroundColor = '';
          groupFill.style.opacity = '';
          groupFill.style.borderRight = '';
        }
      }
   
  });

  // 3) 세그먼트 상태 클래스 업데이트 + 달성도 기반 색상 적용
  let startAt2 = 0;
  for (let i = 0; i < w.segments.length; i++) {
    const seg = w.segments[i];
    const dur = segDurationSec(seg);
    const endAt2 = startAt2 + dur;

    const el = document.querySelector(`.timeline-segment[data-index="${i}"]`);
    if (el) {
      el.classList.remove(
        "is-complete",
        "is-current",
        "is-upcoming",
        "achievement-low",
        "achievement-good",
        "achievement-high",
        "achievement-over",
        "timeline-ach-low",
        "timeline-ach-good"
      );
      
      if (elapsed >= endAt2) {
        // 완료된 세그먼트 - 달성도 기반 색상 적용
        el.classList.add("is-complete");
        
        // 달성도 계산 및 색상 적용
        const targetW = segTargetW(seg, ftp);
        const avgW = segBar.samples[i] ? (segBar.sumPower[i] / segBar.samples[i]) : 0;
        const achievement = targetW > 0 ? (avgW / targetW) : 0;
        
        // 달성도에 따른 CSS 클래스 추가
        const segType = (typeof normalizeType === "function")
          ? normalizeType(seg)
          : (seg.segment_type || seg.label || "").toLowerCase();
        const isRecovery = segType === "rest" || segType === "cooldown";
        
        if (!isRecovery) {
          if (achievement >= 0.95) {
            el.classList.add("timeline-ach-good");
          } else {
            el.classList.add("timeline-ach-low");
          }
        }
        
      } else if (elapsed >= startAt2 && elapsed < endAt2) {
        el.classList.add("is-current");
      } else {
        el.classList.add("is-upcoming");
      }
    }
    startAt2 = endAt2;
  }

  // 4) 그룹 상태 클래스는 2번 섹션에서 이미 처리됨 (달성도 포함)
   // 2번 섹션에서 그룹 세그먼트의 진행률, 상태, 달성도가 모두 계산되고 클래스가 추가됨
   // 따라서 여기서는 추가 작업이 필요 없음



   
  // 5) 평균 파워 및 RPM 누적
  const p = Math.max(0, Number(window.liveData?.power) || 0);
  const c = Math.max(0, Number(window.liveData?.cadence) || 0);
  if (w.segments[segIndex]) {
    segBar.sumPower[segIndex] = (segBar.sumPower[segIndex] || 0) + p;
    segBar.sumCadence[segIndex] = (segBar.sumCadence[segIndex] || 0) + c;
    segBar.samples[segIndex] = (segBar.samples[segIndex] || 0) + 1;

    const curSamples = segBar.samples[segIndex] || 0;
    const curAvgPower = curSamples > 0 ? Math.round(segBar.sumPower[segIndex] / curSamples) : 0;
    const curAvgCadence = curSamples > 0 ? Math.round(segBar.sumCadence[segIndex] / curSamples) : 0;
    
    // target_type에 따라 세그먼트 평균 표시 변경
    const seg = w.segments[segIndex];
    const targetType = seg?.target_type || 'ftp_pct';
    
    const elAvg = document.getElementById("avgSegmentPowerValue");
    const elAvgUnit = document.getElementById("avgSegmentPowerUnit");
    const elAvgRpmSection = document.getElementById("avgSegmentRpmSection");
    const elAvgRpmValue = document.getElementById("avgSegmentRpmValue");
    
    if (targetType === 'cadence_rpm') {
      if (elAvg) elAvg.textContent = String(curAvgPower);
      if (elAvgUnit) elAvgUnit.textContent = "";
      if (elAvgRpmSection) elAvgRpmSection.style.display = "none";
    } else if (targetType === 'dual') {
      if (elAvg) elAvg.textContent = String(curAvgPower);
      if (elAvgUnit) elAvgUnit.textContent = "";
      if (elAvgRpmSection) elAvgRpmSection.style.display = "none";
    } else {
      if (elAvg) elAvg.textContent = String(curAvgPower);
      if (elAvgUnit) elAvgUnit.textContent = "";
      if (elAvgRpmSection) elAvgRpmSection.style.display = "none";
    }
  }
  
  // 세그먼트 그래프 업데이트 (현재 세그먼트 강조)
  if (typeof drawSegmentGraph === 'function' && w.segments && w.segments.length > 0) {
    // 애니메이션을 위해 주기적으로 다시 그리기 (약 100ms마다)
    const now = Date.now();
    if (!window._lastGraphUpdate || (now - window._lastGraphUpdate) > 100) {
      window._lastGraphUpdate = now;
      drawSegmentGraph(w.segments, segIndex, 'trainingSegmentGraph');
      
      // 마스코트 위치 업데이트 (세그먼트 그래프 기준)
      // 화면 크기 변경 시에도 위치가 자동으로 재계산됨
      updateSegmentGraphMascot();
    }
  }
  
  // 모바일 대시보드 세그먼트 그래프 업데이트 (개인훈련 대시보드 로직 반영)
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  if (mobileScreen && 
      (mobileScreen.classList.contains('active') || 
       window.getComputedStyle(mobileScreen).display !== 'none')) {
      // 모바일 개인훈련 대시보드는 startMobileTrainingTimerLoop()에서 독립적으로 관리됨
      // 이 함수는 모바일 화면의 세그먼트 그래프를 업데이트하지 않음 (다른 화면과의 간섭 방지)
  }
  
  // ERG 모드 피로도 체크 (약 10초마다)
  if (window.ergModeState && window.ergModeState.enabled && typeof checkFatigueAndAdjust === 'function') {
    const now = Date.now();
    if (!window._lastFatigueCheck || (now - window._lastFatigueCheck) > 10000) {
      window._lastFatigueCheck = now;
      checkFatigueAndAdjust();
    }
  }
}

// 2. 훈련 상태 객체 통일 (window.trainingState 사용 - Indoor Training 전용)
window.trainingState = window.trainingState || {
  timerId: null,
  paused: false,
  elapsedSec: 0,
  segIndex: 0,
  segElapsedSec: 0,
  segEnds: [],
  totalSec: 0
};

// [추가] 모바일 개인훈련 대시보드 전용 독립적인 상태 관리 (Firebase와 무관)
window.mobileTrainingState = window.mobileTrainingState || {
  timerId: null,
  paused: false,
  elapsedSec: 0,
  segIndex: 0,
  segElapsedSec: 0,
  segEnds: [],
  totalSec: 0,
  workoutStartMs: null,
  pauseAccumMs: 0,
  pausedAtMs: null,
  _countdownFired: {},
  _prevRemainMs: {},
  _lastProcessedSegIndex: 0
};

// 훈련 상태 => 시간/세그먼트 UI 갱신 함수
// 수정된 updateTimeUI 함수 (다음 세그먼트 부분만)
function updateTimeUI() {
  try {
    // Indoor Training 화면에서만 동작하도록 체크
    const trainingScreen = document.getElementById('trainingScreen');
    const isIndoorTrainingActive = trainingScreen && 
      (trainingScreen.classList.contains('active') || 
       window.getComputedStyle(trainingScreen).display !== 'none');
    
    if (!isIndoorTrainingActive) {
      // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
      return;
    }
    
    const w = window.currentWorkout;
    if (!w) {
      console.warn('No current workout in updateTimeUI');
      return;
    }

    const elapsed = Math.max(0, Number(window.trainingState?.elapsedSec) || 0);
    const total = Math.max(1, Number(window.trainingState?.totalSec) || 1);
    const totalPct = Math.min(100, Math.floor((elapsed / total) * 100));

    // 안전한 요소 업데이트
    safeSetText("elapsedTime", formatHMS(elapsed));
    safeSetText("elapsedPercent", totalPct);

    // 현재 세그먼트
    const i = Math.max(0, Number(window.trainingState?.segIndex) || 0);
    const seg = w.segments?.[i];

    // 세그먼트 남은 시간 (0으로 클램프)
    if (seg) {
      const segDur = Math.max(0, segDurationSec(seg) || 0);
      const segRemain = Math.max(0, segDur - (Number(window.trainingState?.segElapsedSec) || 0));
      safeSetText("segmentTime", formatMMSS(segRemain));
    }

    // 다음 세그먼트 안내 - 수정된 부분
    const nextEl = safeGetElement("nextSegment");
    if (nextEl) {
      const next = w.segments?.[i + 1];
      if (next) {
        const ftpPercent = getSegmentFtpPercent(next);
        const segmentName = next.label || next.segment_type || "세그먼트";
        nextEl.textContent = `다음: ${segmentName} FTP ${ftpPercent}%`;
      } else {
        nextEl.textContent = `다음: (마지막)`;
      }
    }

    // 세그먼트 진행률 (0~100 클램프)
    if (seg) {
      const segDur = Math.max(1, segDurationSec(seg) || 1);
      const segElapsed = Math.max(0, Number(window.trainingState?.segElapsedSec) || 0);
      const sp = Math.min(100, Math.floor((segElapsed / segDur) * 100));
      // safeSetText("segmentProgress", String(sp)); // 진행율 표시 제거됨
      //safeSetText("segmentProgressLegend", String(sp)); // ← 범례에도 동일 % 표시
      // safeSetText("segmentProgressLegend", String(totalPct)); // 진행율 표시 제거됨
       
      // updateMascotProgress 제거됨 (세그먼트 그래프 마스코트로 대체)
       
       
     // ⬇⬇⬇ 여기에 "이 한 줄" 추가 ⬇⬇⬇
     setNameProgress(segElapsed / segDur);
       
    }
    
  } catch (error) {
    console.error('Error in updateTimeUI:', error);
  }
}

// 훈련 상태 ==> 세그먼트 전환 + 타겟파워 갱신 
function applySegmentTarget(i) {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  try {
    const w   = window.currentWorkout;
    const ftp = Number(window.currentUser?.ftp) || 200;
    const seg = w?.segments?.[i];
    if (!seg) return;

    const targetType = seg.target_type || 'ftp_pct';
    const targetValue = seg.target_value;
    
    // 엘리트/PRO 선수 확인
    const userChallenge = String(window.currentUser?.challenge || '').trim();
    const isElite = userChallenge === 'Elite';
    const isPRO = userChallenge === 'PRO';
    
    window.liveData = window.liveData || {};
    
    // 파싱된 값들을 저장할 변수 (세그먼트 이름 표시에 사용)
    let parsedFtpPercent = 100;
    let parsedTargetRpm = 0;
    
    // target_type에 따라 목표 값 설정 및 표시
    const targetLabelEl = safeGetElement("targetLabel");
    const targetValueEl = safeGetElement("targetPowerValue");
    const targetUnitEl = safeGetElement("targetUnit");
    const targetRpmSectionEl = safeGetElement("targetRpmSection");
    const targetRpmValueEl = safeGetElement("targetRpmValue");
    
    if (targetType === 'cadence_rpm') {
      // cadence_rpm 타입: target_value는 RPM 값
      const baseRpm = Number(targetValue) || 0;
      // 강도 조절 비율 적용
      const intensityAdjustment = window.trainingIntensityAdjustment || 1.0;
      const targetRpm = Math.round(baseRpm * intensityAdjustment);
      parsedTargetRpm = targetRpm;
      
      if (targetLabelEl) targetLabelEl.textContent = "목표 RPM";
      if (targetValueEl) targetValueEl.textContent = String(targetRpm);
      if (targetUnitEl) targetUnitEl.textContent = "rpm";
      if (targetRpmSectionEl) targetRpmSectionEl.style.display = "none";
      
      // 목표 파워는 계산하지 않음 (RPM만 표시)
      window.liveData.targetPower = 0;
      window.liveData.targetRpm = targetRpm;
      
      console.log('[cadence_rpm] 목표 RPM 표시:', targetRpm, 'rpm (기본:', baseRpm, '* 강도조절:', intensityAdjustment, ')');
      
      // ERG 모드는 파워 기반이므로 RPM만 있는 세그먼트에서는 ERG 모드 비활성화 권장
      if (window.ergModeState && window.ergModeState.enabled) {
        console.warn('[ERG] RPM만 있는 세그먼트 - ERG 모드 비활성화 권장');
      }
      
    } else if (targetType === 'dual') {
      // dual 타입: target_value 구분자 "~" (저장 규칙), 파싱 시 "~" 또는 "/" 호환
      let ftpPercent = 100;
      let targetRpm = 0;
      
      let targetValueStr = '';
      console.log('[dual] 원본 target_value:', targetValue, '타입:', typeof targetValue);
      
      if (targetValue == null || targetValue === '') {
        targetValueStr = '';
        console.warn('[dual] target_value가 null이거나 빈 문자열입니다');
      } else if (Array.isArray(targetValue)) {
        ftpPercent = Number(targetValue[0]) || 100;
        targetRpm = Number(targetValue[1]) || 0;
        targetValueStr = `${targetValue[0]}~${targetValue[1]}`;
      } else {
        targetValueStr = String(targetValue).trim();
        console.log('[dual] 문자열로 변환된 target_value:', targetValueStr);
      }
      
      const dualDelim = (targetValueStr.includes('~') ? '~' : (targetValueStr.includes('/') ? '/' : null));
      if (!Array.isArray(targetValue) && dualDelim) {
        const parts = targetValueStr.split(dualDelim).map(s => s.trim()).filter(s => s.length > 0);
          console.log('[dual] 슬래시로 분리된 parts:', parts, '길이:', parts.length);
          
          if (parts.length >= 2) {
            // 첫 번째 값: FTP% (100)
            const parsedFtp = Number(parts[0]);
            // 두 번째 값: RPM (120)
            const parsedRpm = Number(parts[1]);
            
            // 파싱 결과 검증
            if (!isNaN(parsedFtp) && parsedFtp > 0) {
              ftpPercent = parsedFtp;
            } else {
              console.warn('[dual] 첫 번째 값 파싱 실패:', parts[0], '기본값 100 사용');
              ftpPercent = 100;
            }
            
            if (!isNaN(parsedRpm) && parsedRpm >= 0) {
              targetRpm = parsedRpm;
            } else {
              console.warn('[dual] 두 번째 값 파싱 실패:', parts[1], '기본값 0 사용');
              targetRpm = 0;
            }
            
            console.log('[dual] 파싱 성공 - ftpPercent:', ftpPercent, 'targetRpm:', targetRpm);
          } else if (parts.length === 1) {
            // 슬래시는 있지만 값이 하나만 있는 경우
            console.warn('[dual] 슬래시는 있지만 값이 하나만 있습니다:', parts);
            ftpPercent = Number(parts[0]) || 100;
            targetRpm = 0;
          } else {
            console.error('[dual] 구분자로 분리했지만 parts가 비어있습니다:', parts);
            ftpPercent = 100;
            targetRpm = 0;
          }
        } else if (targetValueStr.length > 0) {
          console.warn('[dual] target_value에 구분자(~ 또는 /)가 없습니다. 문자열:', targetValueStr);
          const numValue = Number(targetValueStr);
          if (!isNaN(numValue) && numValue > 0) {
            // 숫자가 1000보다 크고 1000000보다 작으면 (예: 100120) "100/120"이 숫자로 변환된 것으로 간주
            if (numValue > 1000 && numValue < 1000000) {
              // 100120을 100과 120으로 분리 시도
              // 마지막 3자리가 RPM일 가능성이 높음 (예: 100120 → 100/120)
              const str = String(numValue);
              if (str.length >= 4) {
                // 마지막 3자리를 RPM으로, 나머지를 FTP%로 추정
                const rpmPart = str.slice(-3);
                const ftpPart = str.slice(0, -3);
                const estimatedFtp = Number(ftpPart);
                const estimatedRpm = Number(rpmPart);
                
                // 유효성 검사: FTP%는 30-200, RPM은 50-200 범위
                if (estimatedFtp >= 30 && estimatedFtp <= 200 && estimatedRpm >= 50 && estimatedRpm <= 200) {
                  console.log('[dual] 숫자로 변환된 값을 복원:', numValue, '→ FTP%:', estimatedFtp, 'RPM:', estimatedRpm);
                  ftpPercent = estimatedFtp;
                  targetRpm = estimatedRpm;
                } else {
                  console.error('[dual] 복원 시도 실패. 유효하지 않은 값:', estimatedFtp, estimatedRpm);
                  ftpPercent = 100;
                  targetRpm = 0;
                }
              } else {
                console.error('[dual] target_value가 잘못된 형식입니다. "100~120" 형식이어야 합니다. 현재 값:', targetValueStr);
                ftpPercent = 100;
                targetRpm = 0;
              }
            } else if (numValue <= 1000) {
              console.warn('[dual] target_value에 구분자가 없습니다. "100~120" 형식이어야 합니다. 현재 값:', targetValueStr);
              ftpPercent = numValue;
              targetRpm = 0;
            } else {
              console.error('[dual] target_value가 잘못된 형식입니다. 현재 값:', targetValueStr);
              ftpPercent = 100;
              targetRpm = 0;
            }
          }
        } else {
          console.warn('[dual] target_value가 빈 문자열입니다');
        }
      // 값 검증
      if (isNaN(ftpPercent) || ftpPercent <= 0) {
        console.warn('[dual] 유효하지 않은 FTP%:', ftpPercent, '기본값 100 사용');
        ftpPercent = 100;
      }
      if (isNaN(targetRpm) || targetRpm < 0) {
        console.warn('[dual] 유효하지 않은 RPM:', targetRpm, '기본값 0 사용');
        targetRpm = 0;
      }
      
      // 파싱된 값 저장 (세그먼트 이름 표시에 사용)
      parsedFtpPercent = ftpPercent;
      parsedTargetRpm = targetRpm;
      
      if (targetRpm === 0 && (targetValueStr.includes('~') || targetValueStr.includes('/'))) {
        console.error('[dual] 경고: 구분자가 있는데 RPM이 0입니다. target_value:', targetValue, 'targetValueStr:', targetValueStr);
        const retryDelim = targetValueStr.includes('~') ? '~' : '/';
        const parts = targetValueStr.split(retryDelim).map(s => s.trim()).filter(s => s.length > 0);
        if (parts.length >= 2) {
          const retryFtpPercent = Number(parts[0]) || 100;
          const retryTargetRpm = Number(parts[1]) || 0;
          if (retryTargetRpm > 0) {
            console.log('[dual] 재파싱 성공 - ftpPercent:', retryFtpPercent, 'targetRpm:', retryTargetRpm);
            ftpPercent = retryFtpPercent;
            targetRpm = retryTargetRpm;
            parsedFtpPercent = ftpPercent;
            parsedTargetRpm = targetRpm;
          }
        }
      }
      
      // 디버깅 로그
      console.log('[dual] 최종 파싱 결과 - target_value:', targetValue, '→ ftpPercent:', ftpPercent, 'targetRpm:', targetRpm);
      
      // 목표 파워 계산: 첫 번째 값(ftp%)을 사용하여 W로 변환 (강도 조절 비율 적용)
      // 엘리트/PRO 선수는 별도 워크아웃이 작성되므로 강도 자동 증가 없음
      const basePower = ftp * (ftpPercent / 100);
      const intensityAdjustment = window.trainingIntensityAdjustment || 1.0;
      const targetW = Math.round(basePower * intensityAdjustment);
      
      // 목표 RPM 계산: 두 번째 값(rpm)에 강도 조절 비율 적용
      const baseRpm = targetRpm;
      const adjustedTargetRpm = Math.round(baseRpm * intensityAdjustment);
      
      // 목표 파워 표시: 첫 번째 값(ftp%)을 파워(W)로 변환하여 표시
      if (targetLabelEl) {
        targetLabelEl.textContent = "목표파워";
      }
      if (targetValueEl) {
        targetValueEl.textContent = String(targetW);
        console.log('[dual] 목표 파워 표시:', targetW, 'W (FTP%:', ftpPercent, '→', ftp, '*', ftpPercent, '/ 100 *', intensityAdjustment, ')');
      }
      if (targetUnitEl) {
        targetUnitEl.textContent = "W";
      }
      
      // RPM 표시: 두 번째 값(rpm)을 아랫줄에 표시 (강도 조절 비율 적용)
      if (targetRpmSectionEl) {
        targetRpmSectionEl.style.display = "block"; // block으로 설정하여 아랫줄에 표시
        if (targetRpmValueEl) {
          targetRpmValueEl.textContent = String(adjustedTargetRpm);
          console.log('[dual] 목표 RPM 표시:', adjustedTargetRpm, 'rpm (기본:', baseRpm, '* 강도조절:', intensityAdjustment, ')');
        } else {
          console.error('[dual] targetRpmValueEl을 찾을 수 없습니다');
        }
      } else {
        console.error('[dual] targetRpmSectionEl을 찾을 수 없습니다');
      }
      
      // liveData에 저장
      window.liveData.targetPower = targetW;
      window.liveData.targetRpm = adjustedTargetRpm;
      
      console.log('[dual] 최종 설정 - targetPower:', targetW, 'W, targetRpm:', adjustedTargetRpm, 'rpm (강도조절:', intensityAdjustment, ')');
      
      if (window.ergController && window.ergController.state.enabled && targetW > 0) {
        window.ergController.setTargetPower(targetW).catch(err => {
          console.warn('[applySegmentTarget] ErgController 목표 파워 설정 실패:', err);
        });
      }
      if (window.ergModeState && window.ergModeState.enabled && typeof setErgTargetPower === 'function') {
        setErgTargetPower(targetW);
      }
      
    } else if (targetType === 'ftp_pctz') {
      // ftp_pctz 타입: target_value 구분자 "~" (하한~상한), 파싱 시 "~" 또는 "/" 호환, 속도계에는 하한 파워 표시
      let minPercent = 60;
      const pctzDelim = (typeof targetValue === 'string' && (targetValue.includes('~') || targetValue.includes('/'))) ? (targetValue.includes('~') ? '~' : '/') : null;
      if (pctzDelim && typeof targetValue === 'string') {
        const parts = String(targetValue).split(pctzDelim).map(s => s.trim()).filter(s => s.length > 0);
        if (parts.length >= 1) minPercent = Number(parts[0]) || 60;
      } else if (Array.isArray(targetValue) && targetValue.length > 0) {
        minPercent = Number(targetValue[0]) || 60;
      } else if (targetValue != null) {
        minPercent = Number(targetValue) || 60;
      }
      const basePower = ftp * (minPercent / 100);
      const intensityAdjustment = window.trainingIntensityAdjustment || 1.0;
      const targetW = Math.round(basePower * intensityAdjustment);
      if (targetLabelEl) targetLabelEl.textContent = "목표 파워";
      if (targetValueEl) targetValueEl.textContent = String(targetW || 0);
      if (targetUnitEl) targetUnitEl.textContent = "W";
      if (targetRpmSectionEl) targetRpmSectionEl.style.display = "none";
      window.liveData.targetPower = targetW;
      window.liveData.targetRpm = 0;
      if (window.ergController && window.ergController.state.enabled && targetW > 0) {
        window.ergController.setTargetPower(targetW).catch(err => { console.warn('[applySegmentTarget] ErgController 실패:', err); });
      }
      if (window.ergModeState && window.ergModeState.enabled && typeof setErgTargetPower === 'function') setErgTargetPower(targetW);
      
    } else {
      // ftp_pct 타입 (기본): 기존 로직 유지 (RPE 보정 적용)
      // 엘리트/PRO 선수는 별도 워크아웃이 작성되므로 강도 자동 증가 없음
      const ftpPercent = getSegmentFtpPercent(seg);
      parsedFtpPercent = ftpPercent;
      const basePower = ftp * (ftpPercent / 100);
      const intensityAdjustment = window.trainingIntensityAdjustment || 1.0;
      const targetW = Math.round(basePower * intensityAdjustment);
      
      if (targetLabelEl) targetLabelEl.textContent = "목표 파워";
      if (targetValueEl) targetValueEl.textContent = String(targetW || 0);
      if (targetUnitEl) targetUnitEl.textContent = "W";
      if (targetRpmSectionEl) targetRpmSectionEl.style.display = "none";
      
      window.liveData.targetPower = targetW;
      window.liveData.targetRpm = 0;
      
      // ErgController를 사용하여 목표 파워 자동 설정 (ERG 모드 활성화 시)
      if (window.ergController && window.ergController.state.enabled && targetW > 0) {
        window.ergController.setTargetPower(targetW).catch(err => {
          console.warn('[applySegmentTarget] ErgController 목표 파워 설정 실패:', err);
        });
      }
    }
    
    // ErgController를 사용하여 목표 파워 자동 설정 (ERG 모드 활성화 시)
    // cadence_rpm 타입이 아닌 경우에만 (targetPower > 0)
    if (window.liveData.targetPower > 0) {
      if (window.ergController && window.ergController.state.enabled) {
        window.ergController.setTargetPower(window.liveData.targetPower).catch(err => {
          console.warn('[applySegmentTarget] ErgController 목표 파워 설정 실패:', err);
        });
      }
    }
    
    // 기존 ERG 모드 호환성 유지
    if (window.ergModeState && window.ergModeState.enabled && typeof setErgTargetPower === 'function') {
      setErgTargetPower(window.liveData.targetPower);
    }
    
    const nameEl = safeGetElement("currentSegmentName");
    if (nameEl) {
      const segmentName = seg.label || seg.segment_type || `세그먼트 ${i + 1}`;
      if (targetType === 'cadence_rpm') {
        nameEl.textContent = `${segmentName} - RPM ${parsedTargetRpm || 0}`;
      } else if (targetType === 'dual') {
        // dual 타입: 이미 파싱한 값 사용
        nameEl.textContent = `${segmentName} - FTP ${parsedFtpPercent}% / RPM ${parsedTargetRpm || 0}`;
      } else {
        nameEl.textContent = `${segmentName} - FTP ${parsedFtpPercent}%`;
      }
     // ⬇⬇⬇ 새 세그먼트 진입 시 진행바 0%로 리셋
     setNameProgress(0);       
    }
    
    // safeSetText("segmentProgress", "0"); // 진행율 표시 제거됨
    safeSetText("avgSegmentPowerValue", "—");
    
    // 세그먼트 평균 RPM 초기화
    const avgSegmentRpmValueEl = safeGetElement("avgSegmentRpmValue");
    if (avgSegmentRpmValueEl) avgSegmentRpmValueEl.textContent = "—";

    // 첫 프레임 즉시 반영
    if (typeof window.updateTrainingDisplay === "function") {
      window.updateTrainingDisplay();
    }
    
  } catch (error) {
    console.error('Error in applySegmentTarget:', error);
  }
}

// 시작/루프
// 수정된 startSegmentLoop 함수 (카운트다운 로직 추가)
function startSegmentLoop() {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    console.log('[startSegmentLoop] Indoor Training 화면이 아니므로 실행하지 않음');
    return;
  }
  
  const w = window.currentWorkout;
   // 오버레이 카운트다운 시작 여부(세그먼트별)
   window.trainingState._overlayLaunched = {};
     
  if (!w || !w.segments || w.segments.length === 0) {
    console.error('워크아웃 또는 세그먼트가 없습니다:', w);
    return;
  }

  console.log('세그먼트 루프 시작', '워크아웃:', w.title, '세그먼트 수:', w.segments.length);

  // 누적 종료시각 배열 계산
  window.trainingState.segEnds = [];
  let acc = 0;
  for (let i = 0; i < w.segments.length; i++) {
    const durSec = segDurationSec(w.segments[i]);
    acc += durSec;
    window.trainingState.segEnds.push(acc);
    console.log(`세그먼트 ${i + 1}: ${durSec}초, 누적: ${acc}초`);
  }
  window.trainingState.totalSec = acc;

  // 초기 상태 설정
  window.trainingState.elapsedSec = 0;
  window.trainingState.segIndex = 0;
  window.trainingState.segElapsedSec = 0;
  window.trainingState.paused = false;

   window._powerSeries?.clear?.();
   window._hrSeries?.clear?.();
   
   // (선택) 세그먼트 통계 캐시도 초기화
   window.segmentStats = {};
   
  // 속도 적산 거리 초기화 (노트북 훈련 데이터 블럭)
  if (window.trainingMetrics) window.trainingMetrics.distanceKm = 0;

  // ⬇️⬇️⬇️ 여기 "초기 상태 설정" 바로 아래에 추가 ⬇️⬇️⬇️
  // — 벽시계 기반 타이밍 상태(추가) —
  window.trainingState.workoutStartMs = Date.now(); // 훈련 시작 시각(ms)
  window.trainingState.pauseAccumMs   = 0;          // 일시정지 누적(ms)
  window.trainingState.pausedAtMs     = null;       // 일시정지 시작 시각(ms)

  // 전체 경과초를 강제로 세팅할 때(예: 스킵 점프) 사용할 헬퍼
  window.setElapsedSecSafely = function(newSec) {
    const ts = window.trainingState;
    ts.elapsedSec = Math.max(0, Math.floor(newSec));
    // 다음 틱의 벽시계 계산과 일치하도록 startMs 재보정
    ts.workoutStartMs = Date.now() - (ts.elapsedSec * 1000 + ts.pauseAccumMs);
  };
  // ⬆️⬆️⬆️ 여기까지 추가 ⬆️⬆️⬆️


   
  // 세그먼트별 카운트다운 트리거 상태 초기화
  countdownTriggered = Array(w.segments.length).fill(false);
  
  // 세그먼트 전환 추적 변수 초기화
  window.trainingState._lastProcessedSegIndex = 0;

  // 첫 번째 세그먼트 타겟 적용
  applySegmentTarget(0);
  
  // 강도 조절 슬라이더 초기화
  initializeIntensitySlider();
  
  // ERG 모드 UI 초기화
  initializeErgMode();
  
  // 화면 크기 변경 시 마스코트 위치 재계산
  if (!window._mascotResizeHandler) {
    window._mascotResizeHandler = function() {
      if (typeof updateSegmentGraphMascot === 'function') {
        updateSegmentGraphMascot();
      }
    };
    window.addEventListener('resize', window._mascotResizeHandler);
  }
  updateTimeUI();
  
  // 세그먼트 바 초기화
  if (typeof buildSegmentBar === "function") {
    buildSegmentBar();
  }

  console.log('[Timer] 타이머 시작', '총 시간:', window.trainingState.totalSec, '초');
  console.log('[Timer] workoutStartMs 설정:', window.trainingState.workoutStartMs);

  // 기존 타이머 정리
  if (window.trainingState.timerId) {
    console.log('[Timer] 기존 타이머 정리:', window.trainingState.timerId);
    clearInterval(window.trainingState.timerId);
  }

  // 1초마다 실행되는 메인 루프
  console.log('[Timer] setInterval 시작 전...');
  window.trainingState.timerId = setInterval(() => {
    // Indoor Training 화면에서만 동작하도록 체크
    const trainingScreen = document.getElementById('trainingScreen');
    const isIndoorTrainingActive = trainingScreen && 
      (trainingScreen.classList.contains('active') || 
       window.getComputedStyle(trainingScreen).display !== 'none');
    
    if (!isIndoorTrainingActive) {
      // Indoor Training 화면이 아니면 타이머 정지 (Bluetooth Coach와 분리)
      console.log('[Timer] Indoor Training 화면이 아니므로 타이머 정지');
      if (window.trainingState.timerId) {
        clearInterval(window.trainingState.timerId);
        window.trainingState.timerId = null;
      }
      return;
    }
    
    const ts = window.trainingState;
    if (!ts) {
      console.error('[Timer] trainingState가 없습니다!');
      return;
    }
    
    if (ts.paused) {
      console.log('[Timer] 일시정지 중이므로 스킵');
      return; // 일시정지 중이면 스킵
    }

   // === 시간 진행(벽시계 기반) ===
   const nowMs = Date.now();
   
   // workoutStartMs가 설정되지 않았으면 현재 시간으로 설정
   if (!ts.workoutStartMs) {
     console.warn('[Timer] workoutStartMs가 없어서 현재 시간으로 설정합니다.');
     ts.workoutStartMs = nowMs;
     ts.pauseAccumMs = 0;
     ts.pausedAtMs = null;
   }
   
   // 일시정지 누적 반영: pauseAccumMs + (일시정지 중이라면 지금까지 경과)
   const pausedMs = ts.pauseAccumMs + (ts.pausedAtMs ? (nowMs - ts.pausedAtMs) : 0);
   // 시작시각/일시정지 보정으로 경과초를 직접 계산
   const newElapsedSec = Math.floor((nowMs - ts.workoutStartMs - pausedMs) / 1000);
   
   // 음수 방지
   if (newElapsedSec < 0) {
     console.warn('[Timer] 경과 시간이 음수입니다. workoutStartMs를 재설정합니다.');
     ts.workoutStartMs = nowMs;
     ts.pauseAccumMs = 0;
     ts.elapsedSec = 0;
   } else {
     ts.elapsedSec = newElapsedSec;
   }
   
   // 시간 경과 로그 (매 초마다)
   console.log(`[Timer] 시간 경과: ${ts.elapsedSec}초, 세그먼트: ${ts.segIndex}, 세그 경과: ${ts.segElapsedSec}초, workoutStartMs: ${ts.workoutStartMs}, nowMs: ${nowMs}, 차이: ${nowMs - ts.workoutStartMs}ms`);
   
   // 현재 세그 경과초 = 전체경과초 - 해당 세그 누적시작초
   const cumStart = getCumulativeStartSec(ts.segIndex);
   ts.segElapsedSec = Math.max(0, ts.elapsedSec - cumStart);
   
   // 이후 로직은 기존과 동일하게 진행 (currentSegIndex/segDur/segRemaining 계산 등)
   const w = window.currentWorkout;
   if (!w || !w.segments) {
     console.error('[Timer] 워크아웃 또는 세그먼트가 없습니다.');
     return;
   }
   
   const currentSegIndex = ts.segIndex;
   const currentSeg = w.segments[currentSegIndex];
   if (!currentSeg) {
     console.error('현재 세그먼트가 없습니다. 인덱스:', currentSegIndex);
     return;
   }
   const segDur = segDurationSec(currentSeg);
   const segRemaining = segDur - ts.segElapsedSec;

    
    // 디버깅 로그 (5초 주변에서만 출력)
     
      // ── 카운트다운/벨: 경계(엣지) 기반 트리거 ──
      // 벽시계 기반으로 '이전 남은 ms' → '현재 남은 ms'가
      // 5s,4s,3s,2s,1s,0s 경계를 '넘었는지' 판정해서 정확히 한 번씩만 울림.
      // ── [교체] 카운트다운/벨: 경계(엣지) 기반 트리거 (세그 끝나기 5초 전부터) ──
      // 남은시간은 '초 단위 상태'만으로 계산(절대 ms 혼용 금지)
      // 블루투스 개인 훈련 대시보드 화면에서는 카운트다운 실행하지 않음
      const isBluetoothIndividualScreen = window.location.pathname.includes('bluetoothIndividual.html');
      const isMobileDashboardScreen = document.getElementById('mobileDashboardScreen') && 
        (document.getElementById('mobileDashboardScreen').classList.contains('active') || 
         window.getComputedStyle(document.getElementById('mobileDashboardScreen')).display !== 'none');
      
      // 블루투스 개인 훈련 대시보드나 모바일 대시보드가 아닐 때만 카운트다운 실행
      if (segRemaining > 0 && !isBluetoothIndividualScreen && !isMobileDashboardScreen) {
        // 다음 세그(마지막이면 null)
        const nextSeg = (currentSegIndex < w.segments.length - 1) ? w.segments[currentSegIndex + 1] : null;
      
        ts._countdownFired = ts._countdownFired || {};   // 세그먼트별 발화 기록
        ts._prevRemainMs   = ts._prevRemainMs   || {};   // 세그먼트별 이전 남은 ms
        const key = String(currentSegIndex);
      
        // 종료 누적초(초 단위 SSOT)와 남은 ms
        const endAtSec      = getCumulativeStartSec(currentSegIndex) + segDur; // 세그 끝나는 '절대 초'
        const remainMsPrev  = ts._prevRemainMs[key] ?? Math.round(segRemaining * 1000); // 바로 직전 남은 ms
        const remainMsNow   = Math.round((endAtSec - ts.elapsedSec) * 1000);           // 현재 남은 ms (초 기반)
      
        // remainMsNow가 0 이하이면 카운트다운 실행하지 않음 (반복 방지)
        if (remainMsNow <= 0) {
          // 이미 종료된 세그먼트이므로 카운트다운 로직 건너뛰기
          // 카운트다운이 활성화되어 있으면 즉시 종료
          if (segmentCountdownActive) {
            segmentCountdownActive = false;
            CountdownDisplay.hideImmediate();
            MobileCountdownDisplay.hideImmediate();
          }
          // firedMap에 모든 숫자를 기록하여 더 이상 실행되지 않도록 함
          ts._countdownFired[key] = { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true };
          return;
        }
      
        // 0초는 살짝 일찍(200ms) 울리기
        const EPS_0_MS = 200;
      
      // === 수정된 코드(세그먼트 종료 6초 부터 카운트다운) ===
      // [PATCH] Edge-Driven 카운트다운: 6초(표시 5) → 1초(표시 0)에서 끝
      function maybeFire(n) {
        // 블루투스 개인 훈련 대시보드나 모바일 대시보드에서는 카운트다운 실행하지 않음
        if (isBluetoothIndividualScreen || isMobileDashboardScreen) {
          return;
        }
        
        const firedMap = ts._countdownFired[key] || {};
        if (firedMap[n]) return;
      
        // 경계: 6→5, 5→4, ..., 2→1 은 (n+1)*1000ms, 1→0 은 1000ms
        const boundary = (n > 0) ? (n + 1) * 1000 : 1000;
        const crossed = (remainMsPrev > boundary && remainMsNow <= boundary);
        if (!crossed) return;
      
        // remainMsNow가 0 이하이면 더 이상 카운트다운 실행하지 않음 (0초 반복 방지)
        if (remainMsNow <= 0) {
          // 이미 종료된 세그먼트이므로 카운트다운 종료 및 상태 초기화
          if (segmentCountdownActive) {
            segmentCountdownActive = false;
            CountdownDisplay.hideImmediate();
            MobileCountdownDisplay.hideImmediate();
          }
          // firedMap에 기록하여 더 이상 실행되지 않도록 함
          ts._countdownFired[key] = { ...firedMap, [n]: true };
          return;
        }
      
        // remainMsNow가 6000ms(6초) 이상이면 카운트다운 시작 전이므로 실행하지 않음
        if (remainMsNow > 6000 && n === 5) {
          return;
        }
      
        // 오버레이 표시 시작(6초 시점에 "5" 표시)
        if (n === 5 && !segmentCountdownActive && nextSeg) {
          startSegmentCountdown(5, nextSeg); // 오버레이 켜고 5 표시 + 짧은 비프
        } else if (segmentCountdownActive) {
          // 진행 중이면 숫자 업데이트만(내부 타이머 없음)
          CountdownDisplay.render(n);
          
          // 모바일 대시보드용 카운트다운도 업데이트
          const mobileScreen = document.getElementById('mobileDashboardScreen');
          if (mobileScreen && 
              (mobileScreen.classList.contains('active') || 
               window.getComputedStyle(mobileScreen).display !== 'none')) {
            MobileCountdownDisplay.render(n);
          }
          
          // 4, 3, 2, 1초일 때 벨소리 재생
          if (n > 0) {
            playBeep(880, 120, 0.25);
          }
        }
      
        // 0은 "세그먼트 종료 1초 전"에 표시 + 강조 벨소리, 그리고 오버레이 닫기 예약
        if (n === 0) {
          // 강조 벨소리 (조금 더 강한 톤)
          playBeep(1500, 700, 0.35, "square");
          // 오버레이는 약간의 여유를 두고 닫기
          CountdownDisplay.finish(800);
          
          // 모바일 대시보드용 카운트다운도 닫기
          const mobileScreen = document.getElementById('mobileDashboardScreen');
          if (mobileScreen && 
              (mobileScreen.classList.contains('active') || 
               window.getComputedStyle(mobileScreen).display !== 'none')) {
            MobileCountdownDisplay.finish(800);
          }
          
          segmentCountdownActive = false;
        }
      
        ts._countdownFired[key] = { ...firedMap, [n]: true };
      }


      
        // 블루투스 개인 훈련 대시보드나 모바일 대시보드가 아닐 때만 카운트다운 실행
        if (!isBluetoothIndividualScreen && !isMobileDashboardScreen) {
          // 5→0 모두 확인(틱이 건너뛰어도 놓치지 않음)
          maybeFire(5);
          maybeFire(4);
          maybeFire(3);
          maybeFire(2);
          maybeFire(1);
          maybeFire(0);
        }
      
        // 다음 비교를 위해 현재 값 저장
        ts._prevRemainMs[key] = remainMsNow;
      }


    // TSS / kcal 누적 및 표시
    updateTrainingMetrics();

    // UI 먼저 갱신
    if (typeof updateTimeUI === "function") updateTimeUI();
    if (typeof window.updateTrainingDisplay === "function") window.updateTrainingDisplay();
    if (typeof updateSegmentBarTick === "function") updateSegmentBarTick();
    
    // 그래프 하단 시간 표시 업데이트
    if (typeof updateChartTimeLabels === "function") updateChartTimeLabels();
    
    // 모바일 대시보드 타이머 업데이트 제거 (모바일은 독립적인 타이머 루프 사용)
    // 모바일 개인훈련 대시보드는 startMobileTrainingTimerLoop()에서 독립적으로 관리됨

    // 전체 종료 판단
   // 전체 종료 판단
   // 전체 종료 판단
   if (window.trainingState.elapsedSec >= window.trainingState.totalSec) {
     console.log('훈련 완료!');
     clearInterval(window.trainingState.timerId);
     window.trainingState.timerId = null;
   
     // 활성 카운트다운 정지
     stopSegmentCountdown();
   
     if (typeof setPaused === "function") setPaused(false);
     if (typeof showToast === "function") showToast("훈련이 완료되었습니다!");
   
     // 모바일 대시보드가 활성화된 경우 결과 모달 표시 (훈련일지로 이동하지 않음)
     const mobileScreen = document.getElementById('mobileDashboardScreen');
     if (mobileScreen && 
         (mobileScreen.classList.contains('active') || 
          window.getComputedStyle(mobileScreen).display !== 'none')) {
       // ✅ await 없이 순차 실행(저장 → 초기화 → 결과 모달 표시)
       Promise.resolve()
         .then(() => window.saveTrainingResultAtEnd?.())
         .catch((e) => { console.warn('[result] saveTrainingResultAtEnd error', e); })
         .then(() => window.trainingResults?.initializeResultScreen?.())
         .catch((e) => { console.warn('[result] initializeResultScreen error', e); })
         .then(() => { 
           // 모바일 대시보드 결과 모달 표시
           if (typeof showMobileTrainingResultModal === 'function') {
             showMobileTrainingResultModal();
           }
         });
     } else {
       // 노트북 훈련 화면: 저장 후 훈련결과 팝업만 표시 (훈련일지 이동 없음)
       const trainingScreenEl = document.getElementById('trainingScreen');
       const isLaptopTraining = trainingScreenEl && (trainingScreenEl.classList.contains('active') || window.getComputedStyle(trainingScreenEl).display !== 'none');
      if (isLaptopTraining && typeof window.saveLaptopTrainingResultAtEnd === 'function') {
        var tabletLoadingModal = document.getElementById('tabletTrainingLoadingModal');
        if (tabletLoadingModal) {
          if (tabletLoadingModal.parentNode !== document.body) document.body.appendChild(tabletLoadingModal);
          tabletLoadingModal.classList.remove('hidden');
          tabletLoadingModal.style.display = 'flex';
        }
        Promise.resolve()
          .then(() => window.saveLaptopTrainingResultAtEnd())
          .catch((e) => { console.warn('[result] saveLaptopTrainingResultAtEnd error', e); })
          .then((saveResult) => {
            if (tabletLoadingModal) {
              tabletLoadingModal.classList.add('hidden');
              tabletLoadingModal.style.display = 'none';
            }
            if (typeof window.showMobileTrainingResultModal === 'function') {
              window.__laptopResultModalOpen = true;
              window.showMobileTrainingResultModal();
            } else if (typeof window.showLaptopTrainingResultPopup === 'function') {
              window.showLaptopTrainingResultPopup(saveResult);
            } else {
              if (typeof showToast === 'function') showToast('수고하셨습니다. 훈련 결과가 저장되었습니다.');
              if (typeof showScreen === 'function') showScreen('trainingReadyScreen');
            }
          });
      } else {
         // 기존 화면(개인훈련 대시보드 등)의 경우 훈련일지로 이동
         Promise.resolve()
           .then(() => window.saveTrainingResultAtEnd?.())
           .catch((e) => { console.warn('[result] saveTrainingResultAtEnd error', e); })
           .then(() => window.trainingResults?.initializeResultScreen?.())
           .catch((e) => { console.warn('[result] initializeResultScreen error', e); })
           .then(() => { try { window.renderCurrentSessionSummary?.(); } catch (e) { console.warn(e); } })
           .then(() => { if (typeof showScreen === "function") showScreen("trainingJournalScreen"); });
       }
     }
   
     return;
   }




   // 세그먼트 경계 통과 → 다음 세그먼트로 전환
   // 중복 전환 방지를 위해 이전 세그먼트 인덱스를 추적
   const prevSegIndex = ts._lastProcessedSegIndex ?? currentSegIndex;
   
   // 세그먼트 전환 조건: 세그먼트 경과 시간이 세그먼트 지속 시간을 초과했고, 아직 전환되지 않은 경우
   // 또는 누적 경과 시간이 세그먼트 종료 시각을 초과한 경우
   const segEndAtSec = getCumulativeStartSec(currentSegIndex) + segDur;
   const shouldTransition = (ts.segElapsedSec >= segDur || ts.elapsedSec >= segEndAtSec) && prevSegIndex === currentSegIndex;
   
   console.log(`[Segment Transition] currentSegIndex: ${currentSegIndex}, segElapsedSec: ${ts.segElapsedSec}, segDur: ${segDur}, elapsedSec: ${ts.elapsedSec}, segEndAtSec: ${segEndAtSec}, shouldTransition: ${shouldTransition}`);
   
   if (shouldTransition) {
     // (변경) 소리와 전환을 분리: 전환은 즉시, 소리는 비동기로 마무리
     if (segmentCountdownActive && typeof stopSegmentCountdown === "function") {
       setTimeout(() => { try { stopSegmentCountdown(); } catch(_){} }, 750);
     }
   
     // ✅ [완료처리 삽입 지점] 현재 세그먼트의 달성도 색 확정
     // 평균파워는 통계값이 있으면 그 값을, 없으면 화면의 평균 표시에서 가져옵니다.
     let avgW_now = 0;
     if (window.segmentStats && window.segmentStats[currentSegIndex] && Number.isFinite(window.segmentStats[currentSegIndex].avg)) {
       avgW_now = window.segmentStats[currentSegIndex].avg;
     } else {
       const avgEl = document.getElementById('avgSegmentPowerValue');
       if (avgEl) {
         const n = parseFloat(avgEl.textContent);
         if (!Number.isNaN(n)) avgW_now = n;
       }
     }
     // 현재 세그먼트 완료 색상 확정(휴식/쿨다운은 내부에서 회색 처리)
     if (typeof finalizeSegmentCompletion === 'function') {
       finalizeSegmentCompletion(currentSegIndex, avgW_now);
     }
   
     console.log(`세그먼트 ${currentSegIndex + 1} 완료, 다음 세그먼트로 이동`);
   
     // 다음 세그먼트로 인덱스 전환
     const nextSegIndex = currentSegIndex + 1;
     window.trainingState.segIndex = nextSegIndex;
     window.trainingState.segElapsedSec = 0;
     ts._lastProcessedSegIndex = nextSegIndex;  // 전환 완료 표시

      // 다음 세그먼트의 카운트다운 상태 초기화
      if (nextSegIndex < w.segments.length) {
        const nextSeg = w.segments[nextSegIndex];
        const nextSegDur = segDurationSec(nextSeg);
        ts._countdownFired[String(nextSegIndex)] = {};
        ts._prevRemainMs[String(nextSegIndex)] = nextSegDur * 1000; // 새 세그 초기 남은 ms
      }
   
     if (nextSegIndex < w.segments.length) {
       console.log(`세그먼트 ${nextSegIndex + 1}로 전환`);
       applySegmentTarget(nextSegIndex);
   
       // 남아있을 수 있는 카운트다운 정리
       if (segmentCountdownActive) {
         stopSegmentCountdown();
       }
   
       // 진행바 즉시 반영(선택)
       if (typeof updateSegmentBarTick === "function") updateSegmentBarTick();
       if (typeof updateTimelineByTime === "function") updateTimelineByTime();
       
       // 모바일 대시보드 UI 업데이트
       const mobileScreen = document.getElementById('mobileDashboardScreen');
       if (mobileScreen && 
           (mobileScreen.classList.contains('active') || 
            window.getComputedStyle(mobileScreen).display !== 'none')) {
         if (typeof updateMobileDashboardUI === 'function') {
           updateMobileDashboardUI();
         }
       }
   
     } else {
       console.log('모든 세그먼트 완료');
     }
   } else if (prevSegIndex !== currentSegIndex) {
     // 세그먼트가 이미 전환된 경우, 추적 변수만 업데이트
     ts._lastProcessedSegIndex = currentSegIndex;
   }

  }, 1000);
}

// 6. stopSegmentLoop 함수 수정
// 수정된 stopSegmentLoop 함수 (카운트다운도 함께 정지)
function stopSegmentLoop() {
  if (window.trainingState.timerId) {
    clearInterval(window.trainingState.timerId);
    window.trainingState.timerId = null;
    console.log('세그먼트 루프 정지됨');
  }
  
  // 활성 카운트다운도 정지
  stopSegmentCountdown();

     /* ⬇⬇⬇ B) 훈련 정지/종료 지점 — 여기 추가 ⬇⬇⬇ */
     window.trainingState = window.trainingState || {};
     window.trainingState.isRunning = false;   // 훈련 상태 off
   
     if (typeof window.updateGroupTrainingControlButtons === "function") {
       window.updateGroupTrainingControlButtons();
     }

     if (typeof ScreenAwake !== "undefined" && ScreenAwake.release) {
       ScreenAwake.release();                  // 화면 항상 켜짐 해제(원복)
     } else {
       console.warn("[ScreenAwake] util not found or release missing");
     }
     /* ⬆⬆⬆ B) 훈련 정지/종료 지점 — 여기까지 ⬆⬆⬆ */

    // ★ 자동 종료/수동 종료 공통 저장 지점 (노트북 훈련 화면은 제외 — 종료 버튼/자동완료 시 saveLaptopTrainingResultAtEnd + 팝업으로 처리)
    var trainingScreenEl = document.getElementById('trainingScreen');
    var isLaptopTrainingActive = trainingScreenEl && (trainingScreenEl.classList.contains('active') || window.getComputedStyle(trainingScreenEl).display !== 'none');
    if (!isLaptopTrainingActive) {
      window.saveTrainingResultAtEnd?.();
    }

   // 진행바 초기화
  setNameProgress(0);
}

// 일시정지 시에도 카운트다운 정지
function setPaused(isPaused) {
  const ts = window.trainingState;
  const wantPause = !!isPaused;
  ts.paused = wantPause;

  if (wantPause) {
    // 일시정지 시작
    if (!ts.pausedAtMs) ts.pausedAtMs = Date.now();
  } else {
    // 일시정지 해제 → 누적 일시정지 시간 더해주기
    if (ts.pausedAtMs) {
      ts.pauseAccumMs += (Date.now() - ts.pausedAtMs);
      ts.pausedAtMs = null;
    }
  }

  // 카운트다운 정지
  if (wantPause && segmentCountdownActive) stopSegmentCountdown();

  const btn = safeGetElement("btnTogglePause");
  if (btn) {
    btn.classList.remove("pause", "play");
    btn.classList.add(wantPause ? "play" : "pause");
    btn.setAttribute("aria-label", wantPause ? "재생" : "일시정지");
  }
  
  // 모바일 대시보드 버튼 이미지 업데이트 (SVG <image> 요소는 href 속성 사용)
  const mobileBtnImg = document.getElementById('imgMobileToggle');
  if (mobileBtnImg) {
    // 일시정지 상태면 play0.png, 실행 중이면 pause0.png
    mobileBtnImg.setAttribute('href', wantPause ? 'assets/img/play0.png' : 'assets/img/pause0.png');
    console.log('[Mobile Dashboard] setPaused에서 버튼 이미지 업데이트:', wantPause ? 'play0.png' : 'pause0.png');
  }
  
  showToast?.(wantPause ? "일시정지됨" : "재개됨");

  if (typeof window.updateGroupTrainingControlButtons === "function") {
    window.updateGroupTrainingControlButtons();
  }
}


// 중복 선언 방지
// 화면 히스토리 관리
if (!window.screenHistory) {
  window.screenHistory = [];
}

// Pull-to-refresh 차단 적용 화면 ID 목록 (한 줄 추가로 확장 가능)
if (!window.PULL_TO_REFRESH_BLOCKED_SCREENS) {
  window.PULL_TO_REFRESH_BLOCKED_SCREENS = ['authScreen', 'basecampScreen', 'bluetoothIndividualScreen'];
}

/**
 * showScreen 없이 화면을 직접 표시한 뒤 호출 — body/document 스크롤 잠금 + PTR 블로커 적용 (Bluefy 등 당김 새로고침·줌 방지)
 * 직접 DOM으로 basecampScreen 등을 띄우는 경로(앱 로드 시, 신규 사용자 등록 후 등)에서 반드시 호출해야 동작 적용됨.
 * @param {string} screenId - 예: 'basecampScreen'
 */
function applyScrollContainmentForScreen(screenId) {
  if (!screenId || screenId === 'mobileDashboardScreen') return;
  document.body.style.overflow = 'hidden';
  document.body.style.height = '100%';
  if (document.documentElement) {
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.height = '100%';
  }
  if ((window.PULL_TO_REFRESH_BLOCKED_SCREENS || []).includes(screenId) && screenId !== 'authScreen' && typeof enableForScreen === 'function') {
    if (window.__pullToRefreshBlockerCleanup) {
      window.__pullToRefreshBlockerCleanup();
      window.__pullToRefreshBlockerCleanup = null;
    }
    window.__pullToRefreshBlockerCleanup = screenId === 'basecampScreen'
      ? enableForScreen(screenId, { documentCapture: true })
      : enableForScreen(screenId);
    console.log('✅ applyScrollContainmentForScreen:', screenId);
  }
}
window.applyScrollContainmentForScreen = applyScrollContainmentForScreen;

if (!window.showScreen) {
  window.showScreen = function(id, skipHistory) {
    try {
      console.log(`Switching to screen: ${id}`);
      
      // 현재 활성화된 화면을 히스토리에 추가 (skipHistory가 true가 아니고, 다른 화면으로 이동할 때)
      if (!skipHistory) {
        // 현재 활성화된 화면 찾기 (active 클래스 또는 display: block인 화면)
        const currentActive = document.querySelector(".screen.active") || 
                              Array.from(document.querySelectorAll(".screen")).find(s => 
                                s.style.display === "block" || window.getComputedStyle(s).display === "block"
                              );
        
        if (currentActive && currentActive.id && currentActive.id !== id) {
          // 같은 화면으로 이동하는 경우는 히스토리에 추가하지 않음
          // 마지막 히스토리와 다를 때만 추가 (중복 방지)
          const lastHistory = window.screenHistory.length > 0 ? window.screenHistory[window.screenHistory.length - 1] : null;
          if (lastHistory !== currentActive.id) {
            window.screenHistory.push(currentActive.id);
            console.log(`Added to history: ${currentActive.id}, History:`, window.screenHistory);
            // 히스토리 크기 제한 (최대 10개)
            if (window.screenHistory.length > 10) {
              window.screenHistory.shift();
            }
          }
        }
      }
      
      // 1) 모든 화면 숨김 (스플래시 화면 및 환영 오버레이 제외 및 보호)
      const splashScreen = document.getElementById('splashScreen');
      const isSplashActive = window.isSplashActive || (splashScreen && (splashScreen.classList.contains('active') || window.getComputedStyle(splashScreen).display !== 'none'));
      
      // 환영 오버레이가 표시되어 있으면 화면 전환 차단
      const welcomeModal = document.getElementById('userWelcomeModal');
      const isWelcomeModalActive = welcomeModal && 
                                   !welcomeModal.classList.contains('hidden') && 
                                   window.getComputedStyle(welcomeModal).display !== 'none' &&
                                   window.userWelcomeModalShown === true;
      
      if (isWelcomeModalActive) {
        console.log('⏸️ 환영 오버레이 활성화 중 - 화면 전환 차단');
        return; // 화면 전환 자체를 차단
      }
      
      // 스플래시 화면이 활성화되어 있으면 화면 전환 차단
      if (isSplashActive) {
        console.log('⏸️ 스플래시 화면 활성화 중 - 화면 전환 차단');
        return; // 화면 전환 자체를 차단
      }
      
      // Pull-to-refresh 차단 적용 화면에서 나갈 때 클린업
      const currentActiveScreen = document.querySelector(".screen.active") ||
        Array.from(document.querySelectorAll(".screen")).find(s => s.style.display === "block" || window.getComputedStyle(s).display === "block");
      if (currentActiveScreen && (window.PULL_TO_REFRESH_BLOCKED_SCREENS || []).includes(currentActiveScreen.id) && window.__pullToRefreshBlockerCleanup) {
        window.__pullToRefreshBlockerCleanup();
        window.__pullToRefreshBlockerCleanup = null;
      }
      
      document.querySelectorAll(".screen").forEach(s => {
        if (s.id !== 'splashScreen') {
          s.style.display = "none";
          s.style.opacity = "0";
          s.style.visibility = "hidden";
          s.classList.remove("active");
        }
      });
      
      // 2) 대상 화면만 표시
      const el = safeGetElement(id);
      if (el) {
        // 베이스캠프 등으로 전환 시 인증 화면 완전 숨김 (반투명 잔상 방지)
        if (id !== 'authScreen' && typeof hideAuthScreen === 'function') {
          hideAuthScreen();
        }
        // flex 레이아웃이 필요한 화면 (Coach 대시보드: 헤더·전광판·그리드·목록 세로 배치)
        if (id === 'mobileDashboardScreen' || id === 'workoutScreen' || id === 'bluetoothTrainingCoachScreen') {
          el.style.display = "flex";
        } else {
          el.style.display = "block";
        }
        el.style.visibility = "visible";
        el.style.opacity = "1";
        el.classList.add("active");
        // 대시보드 화면: body에 클래스 추가 (다른 화면 완전 숨김 → 흰색 화면 덮임 방지)
        if (id === 'performanceDashboardScreen') {
          document.body.classList.add('performance-dashboard-active');
        } else {
          document.body.classList.remove('performance-dashboard-active');
        }
        // 화면 전환 시 스크롤 위치 초기화 (프로필↔대시보드 전환 시 흰색 화면만 보이는 오류 방지)
        function resetScrollForScreen() {
          try {
            el.scrollTop = 0;
            if (id === 'performanceDashboardScreen') {
              const container = document.getElementById('performance-dashboard-container');
              if (container) container.scrollTop = 0;
            }
            window.scrollTo(0, 0);
            if (document.documentElement) document.documentElement.scrollTop = 0;
            if (document.body) document.body.scrollTop = 0;
          } catch (scrollErr) { /* 무시 */ }
        }
        resetScrollForScreen();
        requestAnimationFrame(function() { resetScrollForScreen(); });
        console.log(`Successfully switched to: ${id}`);
        
        // body 스크롤 잠금/고정 사용 안 함 — 모든 화면 인증과 동일하게 화면 단위 스크롤
        if ((window.PULL_TO_REFRESH_BLOCKED_SCREENS || []).includes(id) && window.__pullToRefreshBlockerCleanup) {
          window.__pullToRefreshBlockerCleanup();
          window.__pullToRefreshBlockerCleanup = null;
        }
        if ((window.PULL_TO_REFRESH_BLOCKED_SCREENS || []).includes(id) && id !== 'authScreen' && typeof enableForScreen === 'function') {
          // basecampScreen, bluetoothIndividualScreen: Bluefy 등에서 당김 새로고침·줌 방지 위해 document 캡처 단계 + 해당 화면 scrollTop 기준 차단
          var useDocCapture = (id === 'basecampScreen' || id === 'bluetoothIndividualScreen');
          window.__pullToRefreshBlockerCleanup = useDocCapture
            ? enableForScreen(id, { documentCapture: true })
            : enableForScreen(id);
        }
        
        // 모바일 대시보드 화면이 활성화되면 다른 모든 화면 숨기기
        if (id === 'mobileDashboardScreen') {
          document.body.classList.remove('bluetooth-individual-screen-active');
          document.querySelectorAll(".screen").forEach(s => {
            if (s.id !== 'mobileDashboardScreen' && s.id !== 'splashScreen') {
              s.style.display = "none";
              s.style.visibility = "hidden";
              s.style.opacity = "0";
              s.classList.remove("active");
            }
          });
        }
        
        // 모바일/블루투스 개인훈련 대시보드가 아닌 화면: body/document 스크롤 비활성화 → 화면 단위 스크롤만 사용 (Bluefy 등 당김 새로고침·줌 메뉴 방지)
        if (id !== 'mobileDashboardScreen') {
          document.body.classList.remove('mobile-dashboard-active');
          if (id === 'bluetoothIndividualScreen') {
            document.body.classList.add('bluetooth-individual-screen-active');
          } else {
            document.body.classList.remove('bluetooth-individual-screen-active');
          }
          document.body.style.overflow = 'hidden';
          document.body.style.height = '100%';
          document.body.style.position = '';
          document.body.style.width = '';
          if (document.documentElement) {
            document.documentElement.style.overflow = 'hidden';
            document.documentElement.style.height = '100%';
            document.documentElement.style.position = '';
          }
          console.log('✅ Body/document scroll locked for screen (scroll-contained):', id);
        }
        
      // 연결 화면이 표시될 때 버튼 이미지 업데이트 및 ANT+ 버튼 활성화 상태 확인
      if (id === "connectionScreen") {
        if (typeof updateDeviceButtonImages === "function") {
          updateDeviceButtonImages();
        }
        
        // "다음 단계로" 버튼 활성화
        setTimeout(() => {
          const btnToProfile = safeGetElement("btnToProfile");
          if (btnToProfile) {
            btnToProfile.disabled = false;
            btnToProfile.removeAttribute('aria-disabled');
            btnToProfile.style.opacity = '1';
            btnToProfile.style.cursor = 'pointer';
          }
        }, 100);
        
        // ANT+ 버튼 비활성화 (클릭 기능 제거)
        setTimeout(() => {
          const btnANT = safeGetElement("btnConnectANT");
          if (btnANT) {
            btnANT.disabled = true;
            btnANT.classList.add('is-disabled');
            btnANT.setAttribute('aria-disabled', 'true');
            btnANT.title = '';
            btnANT.style.opacity = '0.6';
            btnANT.style.cursor = 'default';
            btnANT.style.pointerEvents = 'none';
          }
          
          // Indoor Race 버튼 등급 제한 해제 (모든 등급 사용 가능)
          const btnIndoorRace = safeGetElement('btnIndoorRace');
          if (btnIndoorRace) {
            btnIndoorRace.disabled = false;
            btnIndoorRace.classList.remove('is-disabled');
            btnIndoorRace.removeAttribute('aria-disabled');
            btnIndoorRace.style.opacity = '1';
            btnIndoorRace.style.cursor = 'pointer';
            btnIndoorRace.title = '';
          }
        }, 100);
        }
      } else {
        console.error(`Screen element '${id}' not found`);
        return;
      }
      
      // 3) 화면별 특별 처리
      if (id === 'workoutScreen') {
        const initFn = window.workoutViewInit || (typeof workoutViewInit === 'function' ? workoutViewInit : null);
        if (initFn) {
          setTimeout(() => { try { initFn(); } catch (e) { console.warn('workoutViewInit error:', e); if (typeof loadWorkouts === 'function') loadWorkouts('all'); } }, 150);
        } else if (typeof loadWorkouts === 'function') {
          setTimeout(() => loadWorkouts('all'), 150);
        }
      }

       //프로필 선택 화면: "새 사용자 추가" 메뉴 제거(간단)
      if (id === 'profileScreen') {
        console.log('Loading users for profile screen.');
        setTimeout(() => {
          if (typeof window.loadUsers === 'function') {
            window.loadUsers();
          } else {
            console.error('loadUsers function not available');
          }
          // ✅ 프로필 화면 진입 시 "새 사용자 추가" 카드 제거(간단)
          const addCard = document.getElementById('cardAddUser');
          if (addCard) addCard.remove();
          // loadUsers DOM 갱신 후 스크롤 재초기화
          try {
            const profEl = document.getElementById('profileScreen');
            if (profEl) profEl.scrollTop = 0;
            window.scrollTo(0, 0);
          } catch (e) {}
        }, 100);
      }
      
      // Performance Dashboard 화면 처리
      if (id === 'performanceDashboardScreen') {
        // 스크롤 상단 고정 (대시보드 본 화면만 표시, 빈화면 제거)
        function fixDashboardScroll() {
          try {
            const container = document.getElementById('performance-dashboard-container');
            if (container) {
              container.scrollTop = 0;
              container.scrollTo(0, 0);
            }
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
          } catch (e) {}
        }
        fixDashboardScroll();
        requestAnimationFrame(fixDashboardScroll);
        [50, 150, 350, 600].forEach(function(delay) {
          setTimeout(fixDashboardScroll, delay);
        });
      }

      // Training Room 화면: 훈련방 목록 자동 로딩
      if (id === 'trainingRoomScreen') {
        console.log('Loading training rooms for training room screen.');
        setTimeout(() => {
          if (typeof loadTrainingRooms === 'function') {
            loadTrainingRooms();
          } else {
            console.error('loadTrainingRooms function not available');
          }
        }, 200);
      }

      // 훈련 준비 화면: 그룹 훈련 카드 상태 업데이트
      // 훈련 화면으로 전환 시 ERG 모드 UI 초기화
      if (id === 'trainingScreen') {
        setTimeout(() => {
          if (typeof initializeErgMode === 'function') {
            initializeErgMode();
          }
        }, 100);
      }
      
      if (id === 'trainingReadyScreen') {
        setTimeout(() => {
          if (typeof window.updateGroupTrainingCardStatus === 'function') {
            window.updateGroupTrainingCardStatus();
          }
          
          // 워크아웃 미선택 시 placeholder 표시
          const segmentPreview = safeGetElement('segmentPreview');
          const placeholder = safeGetElement('segmentPreviewPlaceholder');
          const existingCanvas = document.getElementById('segmentPreviewGraph');
          
          // 현재 워크아웃이 없으면 placeholder 표시 (flex-direction: column 유지)
          if (!window.currentWorkout) {
            if (placeholder) {
              placeholder.style.display = 'flex';
            }
            if (existingCanvas) {
              existingCanvas.remove();
            }
            // Select Dashboard 버튼 비활성화
            const btnStart = document.getElementById('btnStartTraining');
            const btnMobile = document.getElementById('btnMobileDashboard');
            if (btnStart) { btnStart.disabled = true; }
            if (btnMobile) { btnMobile.disabled = true; }
          } else {
            // 워크아웃이 있으면 placeholder만 숨김, Select Dashboard 버튼 활성화
            if (placeholder && !existingCanvas) {
              placeholder.style.display = 'none';
            }
            const btnStart = document.getElementById('btnStartTraining');
            const btnMobile = document.getElementById('btnMobileDashboard');
            if (btnStart) { btnStart.disabled = false; }
            if (btnMobile) { btnMobile.disabled = false; }
            // 스케줄 등에서 진입 시 지정된 워크아웃·세그먼트 그래프 로딩
            if (window.currentWorkout && window.currentWorkout.segments && window.currentWorkout.segments.length > 0 && typeof updateTrainingReadyScreenWithWorkout === 'function') {
              updateTrainingReadyScreenWithWorkout(window.currentWorkout);
            }
          }
        }, 200);
      }
      
      // 모바일 대시보드 화면 전환 시 초기화
      if (id === 'mobileDashboardScreen') {
        setTimeout(() => {
          if (typeof startMobileDashboard === 'function') {
            startMobileDashboard();
          }
        }, 100);
      }

      // Bluetooth Training Coach 화면 전환 시 초기화
      if (id === 'bluetoothTrainingCoachScreen') {
        console.log('🚀 [showScreen] Bluetooth Coach 화면 전환 감지');
        if (el) {
          el.style.position = 'fixed';
          el.style.top = '0';
          el.style.left = '0';
          el.style.right = '0';
          el.style.bottom = '0';
          el.style.zIndex = '100';
          el.style.width = '100%';
          el.style.height = '100%';
        }
        
        // 1. 기존 리스너 정리
        if (window.bluetoothCoachState && window.bluetoothCoachState.firebaseSubscriptions) {
          console.log('🧹 [showScreen] 기존 Firebase 구독 정리 중...');
          Object.values(window.bluetoothCoachState.firebaseSubscriptions).forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
              unsubscribe();
            }
          });
          window.bluetoothCoachState.firebaseSubscriptions = {};
        }
        
        // 2. DOM 렌더링 대기 후 초기화
        setTimeout(() => {
          const targetDiv = document.getElementById('bluetoothCoachPowerMeterGrid');
          if (!targetDiv) {
            console.error('❌ [showScreen] 치명적 오류: #bluetoothCoachPowerMeterGrid 요소를 찾을 수 없습니다.');
            return;
          }
          
          if (typeof window.initBluetoothCoachDashboard === 'function') {
            console.log('✅ [showScreen] 초기화 함수 실행');
            window.initBluetoothCoachDashboard();
          } else {
            console.error('❌ [showScreen] initBluetoothCoachDashboard 함수가 로드되지 않았습니다.');
          }
        }, 200);
      }

      // 훈련 스케줄 목록 화면: initializeCurrentScreen에서 처리하므로 여기서는 제거
      // (중복 호출 방지를 위해 initializeCurrentScreen에서만 처리)
      
    } catch (error) {
      console.error('Error in showScreen:', error);
    }
  };
}



if (!window.showConnectionStatus) {
  window.showConnectionStatus = function(show) {
    const el = safeGetElement("connectionStatus");
    if (el) {
      el.classList.toggle("hidden", !show);
    }
  };
}

if (!window.showToast) {
  window.showToast = function(msg) {
    const t = safeGetElement("toast");
    if (!t) return alert(msg);
    t.classList.remove("hidden");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2400);
  };
}

//진행률에 맞춰 X 위치만 갱신
function updateMascotProgress(percent) {
  // percent: 0 ~ 100
  const layer = document.getElementById("timelineMascotLayer");
  const mascot = document.getElementById("progressMascot");
  const bar = document.querySelector("#trainingScreen .timeline-progress.timeline--xl");
  if (!layer || !mascot || !bar) return;

  // 진행바의 내부 가로폭 기준으로 픽셀 위치 계산
  const w = bar.clientWidth;
  const px = Math.max(0, Math.min(w, Math.round((percent / 100) * w)));

  // CSS 변수로 전달 → translateX(var(--mascot-x))
  layer.style.setProperty("--mascot-x", px + "px");
}

/**
 * 세그먼트 그래프 위에서 마스코트 위치 업데이트 (FTP 라인 위)
 * 화면 크기 변경 시 자동으로 재계산됨
 */
function updateSegmentGraphMascot() {
  const mascotLayer = document.getElementById('segmentGraphMascotLayer');
  const mascot = document.getElementById('segmentGraphMascot');
  const canvas = document.getElementById('trainingSegmentGraph');
  const container = document.querySelector('#trainingScreen .segment-graph-container');
  
  if (!mascotLayer || !mascot || !canvas || !container) return;
  
  // 세그먼트 그래프 정보 확인
  const ftpY = window._segmentGraphFtpY;
  const padding = window._segmentGraphPadding;
  const chartWidth = window._segmentGraphChartWidth;
  const totalSeconds = window._segmentGraphTotalSeconds;
  
  if (!ftpY || !padding || !chartWidth || !totalSeconds) {
    // 그래프 정보가 없으면 숨김
    mascotLayer.style.display = 'none';
    return;
  }
  
  // 컨테이너와 Canvas의 실제 크기 가져오기
  const containerRect = container.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  
  // 로딩 중 체크: 컨테이너나 Canvas 크기가 0이거나 아직 렌더링되지 않았으면 숨김
  if (containerRect.width === 0 || containerRect.height === 0 || 
      canvasRect.width === 0 || canvasRect.height === 0) {
    mascotLayer.style.display = 'none';
    return;
  }
  
  const scaleX = canvasRect.width / canvas.width;
  const scaleY = canvasRect.height / canvas.height;
  
  // 현재 경과 시간 가져오기
  const elapsedSec = window.trainingState?.elapsedSec || 0;
  
  // 마스코트 레이어를 컨테이너 전체 크기로 설정 (검정 바탕 그래프를 둘러싼 다크 레이어 블럭)
  // 로딩 완료 후에만 표시
  mascotLayer.style.display = 'block';
  mascotLayer.style.position = 'absolute';
  mascotLayer.style.left = '0';
  mascotLayer.style.top = '0';
  mascotLayer.style.width = containerRect.width + 'px';
  mascotLayer.style.height = containerRect.height + 'px';
  mascotLayer.style.pointerEvents = 'none';
  
  // 마스코트 크기 (높이만 90%로 조정)
  const baseMascotHeight = 40; // 기본 높이
  const mascotHeight = baseMascotHeight * 0.9; // 90%로 조정
  const mascotWidth = mascotHeight; // 정사각형 가정 (필요시 조정)
  
  // 컨테이너 padding (CSS에서 20px로 설정됨)
  const containerPadding = 20;
  
  // 시간 표시 위치 계산 (0:00과 마지막 시간의 중심 위치)
  // Canvas 내부 좌표를 컨테이너 좌표로 변환 (scaleX 적용)
  // 첫 번째 시간 표시(0:00)의 X 위치: 컨테이너 padding + Canvas 내부 padding.left * scaleX
  // 마지막 시간 표시의 X 위치: 컨테이너 padding + Canvas 내부 (padding.left + chartWidth) * scaleX
  const startTimeX = containerPadding + (padding.left * scaleX); // 0:00 시간 표시 중심 (컨테이너 기준)
  const endTimeX = containerPadding + ((padding.left + chartWidth) * scaleX); // 마지막 시간 표시 중심 (컨테이너 기준)
  
  // 마스코트 이동 범위: 시작점(0:00 시간 중앙) ~ 종료점(마지막 시간 중앙)
  const startX = startTimeX; // 시작점: 0:00 시간 문자 중앙
  const endX = endTimeX; // 종료점: 마지막 시간 문자 중앙
  
  // X 위치 계산 (경과 시간에 비례) - 시작점과 종료점 사이를 경과 시간 비율로 이동
  const progressRatio = Math.min(1, Math.max(0, elapsedSec / totalSeconds));
  const xPosition = startX + (progressRatio * (endX - startX));
  
  // Y 위치: 컨테이너(다크 레이어 블럭)의 하단 라인에 마스코트가 위치하도록
  // 컨테이너 높이는 Canvas 표시 높이 + padding (20px top + 20px bottom)
  const containerHeight = containerRect.height; // 컨테이너 실제 높이
  // 마스코트가 컨테이너 밖으로 나가지 않도록 하단에 약간의 여유 공간 확보
  // translate(-50%, -100%)로 인해 마스코트의 하단이 yPosition에 맞춰지므로, yPosition을 약간 위로 조정
  const yPosition = containerHeight - 2; // 컨테이너 하단에서 2px 위로 조정하여 스크롤바 방지
  
  // X 위치도 컨테이너 내부에 완전히 포함되도록 제한
  const minX = mascotWidth / 2; // 마스코트 중심이 컨테이너 왼쪽 경계를 넘지 않도록
  const maxX = containerRect.width - (mascotWidth / 2); // 마스코트 중심이 컨테이너 오른쪽 경계를 넘지 않도록
  const clampedXPosition = Math.max(minX, Math.min(maxX, xPosition));
  
  // 마스코트 이미지 위치 설정
  // X축: 시작 시간(0:00) 중앙에 마스코트 중심이 위치하여 시작, 종료 시간 중앙까지 이동
  // Y축: 컨테이너(다크 레이어 블럭) 하단 라인에 마스코트가 위치 (하단 기준)
  mascot.style.position = 'absolute';
  mascot.style.left = clampedXPosition + 'px';
  mascot.style.top = yPosition + 'px';
  // 마스코트 크기는 고정 크기 사용
  mascot.style.width = mascotWidth + 'px';
  mascot.style.height = mascotHeight + 'px';
  mascot.style.transform = 'translate(-50%, -100%)'; // X는 중심 정렬 (0:00 시간 중앙에 맞춰짐), Y는 하단 기준 (컨테이너 하단 라인에 붙도록)
  mascot.style.zIndex = '10';
  
  // 깃발 이미지 제거됨
  
  // 디버깅 로그 (필요시 주석 해제)
  // console.log('[마스코트] 세그먼트 그래프 위치 업데이트:', {
  //   elapsedSec: elapsedSec,
  //   totalSeconds: totalSeconds,
  //   progressRatio: progressRatio.toFixed(3),
  //   xPosition: xPosition.toFixed(1),
  //   yPosition: yPosition.toFixed(1),
  //   containerHeight: containerHeight.toFixed(1),
  //   mascotHeight: mascotHeight.toFixed(1)
  // });
}

/**
 * 모바일 대시보드 세그먼트 그래프 위에서 마스코트 위치 업데이트 (FTP 라인 위)
 * 주의: 모바일 대시보드는 Canvas에 직접 마스코트를 그리므로 이 함수는 더 이상 사용하지 않음
 * 마스코트는 drawSegmentGraph 함수에서 펄스 애니메이션과 함께 Canvas에 직접 그려짐
 */
function updateMobileSegmentGraphMascot() {
  // 모바일 대시보드는 Canvas에 직접 마스코트를 그리므로 HTML 마스코트 업데이트 불필요
  // drawSegmentGraph 함수에서 mobileIndividualSegmentGraph에 대해 펄스 애니메이션과 함께 그려짐
  return;
}





// *** 핵심 수정: updateTrainingDisplay 함수 - currentPower 변수 초기화 문제 해결 ***
window.updateTrainingDisplay = function () {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  // *** 중요: currentPower 변수를 맨 앞에서 정의 ***
  // 3초 평균 파워값 사용
  const currentPower = window.get3SecondAveragePower ? window.get3SecondAveragePower() : Number(window.liveData?.power ?? 0);
  const currentCadence = Number(window.liveData?.cadence ?? 0);
  // targetPower가 0일 수 있으므로 ?? 로 기본값을 설정
  const targetPower = Number(window.liveData?.targetPower ?? 0);
  const targetRpm = Number(window.liveData?.targetRpm ?? 0);
  const hr = window.liveData?.heartRate || 0;

   // ▼▼ 추가: 실시간 데이터 누적
   try {
     // 차트용
     window._powerSeries?.push(currentPower);
     window._hrSeries?.push(hr);
   
     // ✅ 결과 저장용(세션 스트림)
     window.trainingResults?.appendStreamSample?.('power', currentPower);
     window.trainingResults?.appendStreamSample?.('hr', hr);
     if (!Number.isNaN(currentCadence)) {
       window.trainingResults?.appendStreamSample?.('cadence', currentCadence);
     }
   } catch (_) {}

  // 현재 세그먼트의 target_type 확인
  const segIndex = window.trainingState?.segIndex || 0;
  const seg = window.currentWorkout?.segments?.[segIndex];
  const targetType = seg?.target_type || 'ftp_pct';
   
  const p = safeGetElement("currentPowerValue");
  const h = safeGetElement("heartRateValue");
  const bar = safeGetElement("powerProgressBar");
  const t = safeGetElement("targetPowerValue");
  const currentPowerUnitEl = safeGetElement("currentPowerUnit");
  const currentRpmSectionEl = safeGetElement("currentRpmSection");
  const currentRpmValueEl = safeGetElement("currentRpmValue");

  // 노트북 파워 속도계: 바늘/중앙 텍스트/목표 텍스트 동기화
  if (typeof updateLaptopGaugeNeedle === "function") updateLaptopGaugeNeedle(currentPower);
  const laptopCurrentEl = safeGetElement("laptop-ui-current-power");
  const laptopTargetEl = safeGetElement("laptop-ui-target-power");
  if (laptopCurrentEl) laptopCurrentEl.textContent = String(Math.round(currentPower));
  // laptopTargetEl은 아래 TARGET 타입별 업데이트 블록에서 설정

  // target_type에 따라 현재 파워/RPM 표시 변경
  if (targetType === 'cadence_rpm') {
    // cadence_rpm 타입: 현재 W (현재 RPM) 형식
    if (p) {
      p.textContent = Math.round(currentPower);
      p.classList.remove("power-low","power-mid","power-high","power-max");
      // RPM 기준으로 색상 변경
      const rpmRatio = targetRpm > 0 ? (currentCadence / targetRpm) : 0;
      if (rpmRatio < 0.8) p.classList.add("power-low");
      else if (rpmRatio < 1.0) p.classList.add("power-mid");
      else if (rpmRatio < 1.2) p.classList.add("power-high");
      else p.classList.add("power-max");
    }
    if (currentPowerUnitEl) currentPowerUnitEl.textContent = "W";
    if (currentRpmSectionEl) {
      currentRpmSectionEl.style.display = "inline";
      if (currentRpmValueEl) currentRpmValueEl.textContent = String(Math.round(currentCadence));
    }
    
    // 프로그레스 바는 RPM 기준 / 달성도 = (현재값/타겟)*100 (100% 초과 허용, 바는 100%까지 채움)
    if (bar && targetRpm > 0) {
      const pct = (currentCadence / targetRpm) * 100;
      bar.style.width = Math.min(100, pct) + "%";
      if (pct < 90) bar.style.background = "linear-gradient(90deg,#ffb400,#ff9000)";
      else if (pct < 105) bar.style.background = "linear-gradient(90deg,#3cff4e,#00ff88)";
      else if (pct < 120) bar.style.background = "linear-gradient(90deg,#5eead4,#2dd4bf)";
      else bar.style.background = "linear-gradient(90deg,#a855f7,#7c3aed)";
    }
    const achievementEl = safeGetElement("achievementValueBar");
    if (achievementEl && targetRpm > 0) {
      achievementEl.textContent = String(Math.round((currentCadence / targetRpm) * 100));
    }
    
  } else if (targetType === 'dual') {
    // dual 타입: 현재 W (현재 RPM) 형식
    if (p) {
      p.textContent = Math.round(currentPower);
      p.classList.remove("power-low","power-mid","power-high","power-max");
      const ratio = targetPower > 0 ? (currentPower / targetPower) : 0;
      if (ratio < 0.8) p.classList.add("power-low");
      else if (ratio < 1.0) p.classList.add("power-mid");
      else if (ratio < 1.2) p.classList.add("power-high");
      else p.classList.add("power-max");
    }
    if (currentPowerUnitEl) currentPowerUnitEl.textContent = "W";
    if (currentRpmSectionEl) {
      currentRpmSectionEl.style.display = "inline";
      if (currentRpmValueEl) currentRpmValueEl.textContent = String(Math.round(currentCadence));
    }
    
    // 프로그레스 바는 파워 기준 / 달성도 = (현재 파워/타겟)*100 (100% 초과 허용, 바는 100%까지 채움)
    if (bar) {
      const pct = targetPower > 0 ? (currentPower / targetPower) * 100 : 0;
      bar.style.width = Math.min(100, pct) + "%";
      if (pct < 90) bar.style.background = "linear-gradient(90deg,#ffb400,#ff9000)";
      else if (pct < 105) bar.style.background = "linear-gradient(90deg,#3cff4e,#00ff88)";
      else if (pct < 120) bar.style.background = "linear-gradient(90deg,#5eead4,#2dd4bf)";
      else bar.style.background = "linear-gradient(90deg,#a855f7,#7c3aed)";
    }
    const achievementElDual = safeGetElement("achievementValueBar");
    if (achievementElDual && targetPower > 0) {
      achievementElDual.textContent = String(Math.round((currentPower / targetPower) * 100));
    }
    
  } else {
    // ftp_pct 타입 (기본): 기존 로직 유지
    if (p) {
      p.textContent = Math.round(currentPower);
      p.classList.remove("power-low","power-mid","power-high","power-max");
      const ratio = targetPower > 0 ? (currentPower / targetPower) : 0;
      if (ratio < 0.8) p.classList.add("power-low");
      else if (ratio < 1.0) p.classList.add("power-mid");
      else if (ratio < 1.2) p.classList.add("power-high");
      else p.classList.add("power-max");
    }
    if (currentPowerUnitEl) currentPowerUnitEl.textContent = "WATTS";
    if (currentRpmSectionEl) currentRpmSectionEl.style.display = "none";
    
    // 프로그레스 바는 파워 기준 / 달성도 = (현재 파워/타겟)*100 (100% 초과 허용, 바는 100%까지 채움)
    if (bar) {
      const pct = targetPower > 0 ? (currentPower / targetPower) * 100 : 0;
      bar.style.width = Math.min(100, pct) + "%";
      if (pct < 90) bar.style.background = "linear-gradient(90deg,#ffb400,#ff9000)";
      else if (pct < 105) bar.style.background = "linear-gradient(90deg,#3cff4e,#00ff88)";
      else if (pct < 120) bar.style.background = "linear-gradient(90deg,#5eead4,#2dd4bf)";
      else bar.style.background = "linear-gradient(90deg,#a855f7,#7c3aed)";
    }
    const achievementElFtp = safeGetElement("achievementValueBar");
    if (achievementElFtp && targetPower > 0) {
      achievementElFtp.textContent = String(Math.round((currentPower / targetPower) * 100));
    }
  }

  // ftp_pctz일 때 상한값 저장 (노트북 원호 상한 표시용) — 모바일과 동일하게 ~ / , 배열 지원
  if (targetType === 'ftp_pctz' && seg?.target_value != null) {
    const tv = seg.target_value;
    let maxPct = null;
    const pctzD = typeof tv === 'string' ? (tv.includes('~') ? '~' : (tv.includes('/') ? '/' : (tv.includes(',') ? ',' : null))) : null;
    if (pctzD && typeof tv === 'string') {
      const parts = tv.split(pctzD).map(s => s.trim());
      if (parts.length >= 2) maxPct = Number(parts[1]) || 75;
    } else if (typeof tv === 'string' && tv.includes(',')) {
      const parts = tv.split(',').map(s => s.trim());
      if (parts.length >= 2) maxPct = Number(parts[1]) || 75;
    } else if (Array.isArray(tv) && tv.length >= 2) {
      maxPct = Number(tv[1]) || 75;
    }
    if (maxPct != null) {
      const ftp = window.userFTP || 200;
      window.currentSegmentMaxPower = Math.round(ftp * (maxPct / 100));
    } else {
      window.currentSegmentMaxPower = null;
    }
  } else if (targetType !== 'ftp_pctz') {
    window.currentSegmentMaxPower = null;
  }

  // 속도계 TARGET 텍스트 업데이트 (ftp_pct, ftp_pctz, cadence_rpm, dual 타입별 독립 표시)
  if (t) {
    if (targetType === 'dual' || targetType === 'cadence_rpm') {
      if (targetRpm > 0) {
        t.textContent = String(Math.round(targetRpm));
        t.style.color = '#ef4444';
      } else {
        t.textContent = '';
        t.style.color = '';
      }
    } else if (targetType === 'ftp_pctz' || targetType === 'ftp_pct') {
      if (targetPower > 0) {
        t.textContent = String(Math.round(targetPower));
        t.style.color = '';
      } else {
        t.textContent = '';
      }
    } else {
      if (targetPower > 0) {
        t.textContent = String(Math.round(targetPower));
        t.style.color = '';
      } else {
        t.textContent = '';
      }
    }
  }

  // 노트북(태블릿) 속도계: 목표값 위에 라벨 표기 — 주황 목표파워 시 TARGET, 빨강 케이던스 시 RPM
  const laptopTargetLabelEl = safeGetElement("laptop-ui-target-label");
  const laptopTargetRpmUnitEl = safeGetElement("laptop-ui-target-rpm-unit");
  if (laptopTargetLabelEl) {
    laptopTargetLabelEl.removeAttribute('fill');
    laptopTargetLabelEl.removeAttribute('font-size');
    laptopTargetLabelEl.removeAttribute('y');
    while (laptopTargetLabelEl.firstChild) laptopTargetLabelEl.removeChild(laptopTargetLabelEl.firstChild);
  }
  if (laptopTargetRpmUnitEl) laptopTargetRpmUnitEl.style.display = 'none';
  if (targetType === 'cadence_rpm') {
    if (laptopTargetLabelEl) {
      laptopTargetLabelEl.textContent = 'RPM';
      laptopTargetLabelEl.setAttribute('fill', '#888');
      laptopTargetLabelEl.setAttribute('y', '90');
      laptopTargetLabelEl.setAttribute('font-size', '8.4'); /* WATTS와 동일 */
    }
    if (laptopTargetEl) {
      laptopTargetEl.textContent = targetRpm > 0 ? String(Math.round(targetRpm)) : '0';
      laptopTargetEl.setAttribute('fill', targetRpm > 0 ? '#ef4444' : '#ff8c00');
    }
  } else if (targetType === 'dual') {
    if (targetRpm > 0 && laptopTargetLabelEl) {
      laptopTargetLabelEl.textContent = '';
      laptopTargetLabelEl.setAttribute('fill', '#ef4444');
      laptopTargetLabelEl.setAttribute('font-size', '8.4'); /* WATTS와 동일 */
      laptopTargetLabelEl.setAttribute('y', '90');
      const tspanNum = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspanNum.setAttribute('fill', '#ef4444');
      tspanNum.textContent = String(Math.round(targetRpm));
      laptopTargetLabelEl.appendChild(tspanNum);
      const tspanUnit = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspanUnit.setAttribute('fill', '#888');
      tspanUnit.textContent = ' RPM';
      laptopTargetLabelEl.appendChild(tspanUnit);
    } else if (laptopTargetLabelEl) {
      laptopTargetLabelEl.textContent = 'TARGET';
      laptopTargetLabelEl.setAttribute('fill', '#888');
      laptopTargetLabelEl.setAttribute('font-size', '8.4'); /* WATTS와 동일 */
    }
    if (laptopTargetEl) {
      laptopTargetEl.textContent = String(Math.round(targetPower));
      laptopTargetEl.setAttribute('fill', '#ff8c00');
    }
  } else {
    if (laptopTargetLabelEl) {
      laptopTargetLabelEl.textContent = 'TARGET';
      laptopTargetLabelEl.setAttribute('fill', '#888');
      laptopTargetLabelEl.setAttribute('y', '90');
      laptopTargetLabelEl.setAttribute('font-size', '8.4'); /* WATTS와 동일 */
    }
    if (laptopTargetEl) {
      laptopTargetEl.textContent = targetPower > 0 ? String(Math.round(targetPower)) : '0';
      laptopTargetEl.setAttribute('fill', '#ff8c00');
    }
  }
  if (typeof updateLaptopTargetPowerArc === 'function') updateLaptopTargetPowerArc();

  if (h) {
    h.textContent = Math.round(hr);
    h.classList.remove("hr-zone1","hr-zone2","hr-zone3","hr-zone4","hr-zone5");
    if (hr < 100) h.classList.add("hr-zone1");
    else if (hr < 120) h.classList.add("hr-zone2");
    else if (hr < 140) h.classList.add("hr-zone3");
    else if (hr < 160) h.classList.add("hr-zone4");
    else h.classList.add("hr-zone5");
  }

  // *** 케이던스 표시 개선 - 0 표시 오류 개선 ***
   const cadenceElement = safeGetElement("cadenceValue");
   if (cadenceElement) {
     const cadence = window.liveData?.cadence;
     if (typeof cadence === "number" && !isNaN(cadence)) {
       // 숫자 값이면 0 포함해서 모두 표시
       cadenceElement.textContent = Math.round(cadence).toString();
     } else {
       // 값이 없거나 유효하지 않으면 0으로 표시
       cadenceElement.textContent = "0";
     }
   }

  // 훈련 데이터 블럭 속도(km/h) 실시간 반영 — speedData 수신 시 즉시 표시
  var speedValueEl = safeGetElement("speedValue");
  if (speedValueEl && window.liveData) {
    var speedKmh = window.liveData.speed;
    speedValueEl.textContent = (speedKmh != null && !Number.isNaN(Number(speedKmh))) ? Number(speedKmh).toFixed(1) : "-";
  }

  // 중앙 디스플레이에 펄스 애니메이션 추가
   // === 중앙 패널 네온 클래스 갱신 ===
   (function updateCenterPanelNeon(){
           const panel = document.querySelector(
        '.enhanced-metric-panel.enhanced-center-panel.enhanced-main-power-display'
      );
     if (!panel) return;
   
     // 현재 파워/타깃
      // === 평균 파워 기반 네온 평가로 변경 ===
      
      // 1) 타깃 파워
      const tgt = Number(window.liveData?.targetPower) || 0;
      
      // 2) 세그먼트 평균 파워 가져오기(우선순위: segmentStats → 화면표시 → 현재파워 폴백)
      let avgNow = NaN;
      const segIdx = Number(window.trainingState?.segIndex) || 0;
      
      if (window.segmentStats && window.segmentStats[segIdx] && Number.isFinite(window.segmentStats[segIdx].avg)) {
        avgNow = Number(window.segmentStats[segIdx].avg);
      }
      if (!Number.isFinite(avgNow)) {
        const avgEl = document.getElementById('avgSegmentPowerValue');
        if (avgEl) {
          const n = parseFloat(avgEl.textContent);
          if (!Number.isNaN(n)) avgNow = n;
        }
      }
      if (!Number.isFinite(avgNow)) {
        avgNow = Number(window.liveData?.power) || 0; // 최후 폴백
      }
      
      // 3) 유효성 체크
      panel.classList.remove('neon-active', 'achievement-bad', 'achievement-low', 'achievement-good', 'achievement-high', 'achievement-over');
      if (tgt <= 0 || avgNow <= 0) return;
      
      // 4) 평균 파워 vs 타깃으로 달성도 등급 산정
      let ach;
      const ratio = avgNow / tgt;
      if (ratio < 0.80)       ach = 'achievement-bad';
      else if (ratio < 0.90)  ach = 'achievement-low';
      else if (ratio <= 1.10) ach = 'achievement-good';
      else if (ratio <= 1.20) ach = 'achievement-high';
      else                    ach = 'achievement-over';
      
      // 5) 중앙 패널에만 네온/등급 적용
      panel.classList.add('neon-active', ach);

   })();


   // 사용자 등급 표기(상급~입문)
   // === 사용자 패널 W/kg 네온 동적 갱신 ===
   (function applyWkgNeon(){
     if (window.userPanelNeonMode === 'static') return; // 🔧 정적 모드일 땐 아무것도 하지 않음
   
     const power  = Number(window.liveData?.power) || 0;
     const weight = Number(window.userProfile?.weightKg || window.user?.weightKg) || 0;
     const wkg = (weight > 0) ? (power / weight) : NaN;
     updateUserPanelNeonByWkg(wkg);
   })();

   // ▼▼ 추가: 차트 다시 그리기
      // ▼▼ 추가: 차트 다시 그리기 + 헤더(AVG/MAX) 갱신
      try {
        const pc = document.getElementById('powerChart');
        const hc = document.getElementById('hrChart');
      
        if (pc || hc) {
          // 1) 차트 렌더 (기준: 최근 10분 창 = 600초)
          drawSparkline(pc, window._powerSeries, {
            windowSec: 0,
            stroke: 'rgba(0,215,200,0.9)',
            fill:   'rgba(0,215,200,0.15)',
            showStats: false,
            unit: 'W',
            avgLine: true,
            avgLineStyle: 'dashed',
            avgStroke: 'rgba(255,255,255,0.65)'
          });
      
          drawSparkline(hc, window._hrSeries, {
            windowSec: 0,
            stroke: 'rgba(0,215,200,0.9)',
            fill:   'rgba(0,215,200,0.10)',
            showStats: false,
            unit: 'bpm',
            avgLine: true,
            avgLineStyle: 'dashed',
            avgStroke: 'rgba(255,255,255,0.65)'
          });
      
          // 2) 헤더 우측 실시간 수치(AVG/MAX) 갱신
          //    ※ 동일한 시간창(600초) 기준으로 맞춰줍니다.
          const pStats = getSeriesStats(window._powerSeries, 0);
          const hStats = getSeriesStats(window._hrSeries,    0);
          const pEl = document.getElementById('powerHeaderStats');
          const hEl = document.getElementById('hrHeaderStats');
          if (pEl) pEl.textContent = `AVG ${pStats.avg} · MAX ${pStats.max}`;
          if (hEl) hEl.textContent = `AVG ${hStats.avg} · MAX ${hStats.max}`;
          
          // 3) 그래프 하단 시간 표시 업데이트
          updateChartTimeLabels();
        }
      } catch (e) {
        console.warn('chart render skipped:', e);
      }

};

// 그래프 하단 시간 표시 업데이트 함수
function updateChartTimeLabels() {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  try {
    // 시간 포맷팅 함수 (초를 MM:SS 형식으로)
    function formatMMSS(seconds) {
      const totalSec = Math.floor(seconds);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }

    // 현재 누적 시간 계산 (훈련 시작 후 경과 시간)
    const elapsedSec = window.trainingState?.elapsedSec || 0;
    const startTime = 0;
    const midTime = elapsedSec / 2;
    const endTime = elapsedSec;

    // 파워 그래프 시간 표시
    const powerTimeStart = document.getElementById('powerTimeStart');
    const powerTimeMid = document.getElementById('powerTimeMid');
    const powerTimeEnd = document.getElementById('powerTimeEnd');
    
    if (powerTimeStart) powerTimeStart.textContent = formatMMSS(startTime);
    if (powerTimeMid) powerTimeMid.textContent = formatMMSS(midTime);
    if (powerTimeEnd) powerTimeEnd.textContent = formatMMSS(endTime);

    // 심박 그래프 시간 표시
    const hrTimeStart = document.getElementById('hrTimeStart');
    const hrTimeMid = document.getElementById('hrTimeMid');
    const hrTimeEnd = document.getElementById('hrTimeEnd');
    
    if (hrTimeStart) hrTimeStart.textContent = formatMMSS(startTime);
    if (hrTimeMid) hrTimeMid.textContent = formatMMSS(midTime);
    if (hrTimeEnd) hrTimeEnd.textContent = formatMMSS(endTime);
  } catch (e) {
    console.warn('chart time labels update failed:', e);
  }
}


// *** 개인 훈련 화면 준비 상태 (노트북 클릭 시: 카운트다운 없이 로딩, 훈련 미시작) ***
function initTrainingScreenForReady() {
  try {
    if (!window.currentWorkout) {
      if (typeof showToast === "function") showToast("워크아웃을 먼저 선택하세요");
      if (typeof showScreen === "function") showScreen("trainingReadyScreen");
      return;
    }
    window.trainingState = window.trainingState || {};
    window.trainingState.isRunning = false;

    if (typeof buildSegmentBar === "function") {
      try { buildSegmentBar(); } catch (e) { console.warn('buildSegmentBar failed:', e); }
    }
    // 노트북 훈련 화면 세그먼트 그래프(캔버스)에 워크아웃 세그먼트 로딩
    var segs = (window.currentWorkout && window.currentWorkout.segments) || [];
    if (segs.length > 0 && typeof drawSegmentGraph === "function") {
      setTimeout(function () {
        try {
          drawSegmentGraph(segs, -1, "trainingSegmentGraph");
          if (typeof updateSegmentGraphMascot === "function") {
            updateSegmentGraphMascot();
          }
        } catch (e) {
          console.warn("drawSegmentGraph (노트북 준비) failed:", e);
        }
      }, 100);
    }
    if (typeof applySegmentTarget === "function") {
      try { applySegmentTarget(0); } catch (e) { console.warn('applySegmentTarget failed:', e); }
    }
    if (typeof updateTimeUI === "function") {
      try { updateTimeUI(); } catch (e) { console.warn('updateTimeUI failed:', e); }
    }
    if (typeof renderUserInfo === "function") {
      try { renderUserInfo(); } catch (e) { console.warn('renderUserInfo failed:', e); }
    }
    if (typeof window.updateTrainingDisplay === "function") {
      try { window.updateTrainingDisplay(); } catch (e) { console.warn('updateTrainingDisplay failed:', e); }
    }
    if (typeof initializeLaptopGauge === "function") {
      try { initializeLaptopGauge(); } catch (e) { console.warn('initializeLaptopGauge failed:', e); }
    }

    var startWrap = document.getElementById("trainingScreenStartWrap");
    var controlBtns = document.getElementById("trainingScreenControlBtns");
    if (startWrap) startWrap.style.display = "flex";
    if (controlBtns) controlBtns.style.display = "none";

    if (typeof updateMobileBluetoothConnectionStatus === "function") {
      updateMobileBluetoothConnectionStatus();
    }
    if (typeof initMobileErgController === "function") {
      initMobileErgController();
    }
    console.log('[initTrainingScreenForReady] 개인 훈련 화면 준비 완료 (연결 후 시작 버튼으로 훈련 시작)');
  } catch (e) {
    console.error('initTrainingScreenForReady error:', e);
    if (typeof showToast === "function") showToast("화면 준비 중 오류가 발생했습니다");
  }
}
window.initTrainingScreenForReady = initTrainingScreenForReady;

// *** 시작 시 복구 시도 및 오류 처리 강화 ***
function startWorkoutTraining() {

   // 개인 훈련 화면: 시작 버튼 숨기고 일시정지/건너뛰기/종료 버튼 표시
   var startWrap = document.getElementById("trainingScreenStartWrap");
   var controlBtns = document.getElementById("trainingScreenControlBtns");
   if (startWrap) startWrap.style.display = "none";
   if (controlBtns) controlBtns.style.display = "flex";

   // 새 워크아웃 로드 완료 후: 버퍼 재설정 그래프 용량 설정
   (function reconfigureBuffersForNewWorkout() {
     const plannedSec = getPlannedTotalSecondsFromSegments(window.currentWorkout);
     const fallback = 10800;
     const totalSec = plannedSec > 0 ? plannedSec : (Number(window.currentWorkout?.total_seconds) || fallback);
     const capacity = Math.max(totalSec + 300, 3600);
   
     // 기존 누적과 분리해서 새 세션을 시작할 때는 재생성(권장)
     window._powerSeries = makeRingBuffer(capacity);
     window._hrSeries    = makeRingBuffer(capacity);
   })();
   
  try {
    console.log('Starting workout training...');

    // === [RESULT] 세션 시작 (사용자/워크아웃 메타 함께)
   // === [RESULT] 세션 시작 보장 ===
   try {
     const userId =
       window.currentUser?.id ||
       (JSON.parse(localStorage.getItem('currentUser') || 'null')?.id) ||
       null;
     window.trainingResults?.startSession?.(userId || undefined);
     console.log('[result] session started for user:', userId);
   } catch (e) {
     console.warn('[result] startSession failed:', e);
   }


     
    // 훈련 시작 직전 리셋
    Object.assign(trainingMetrics, {
      elapsedSec: 0, joules: 0, ra30: 0, np4sum: 0, count: 0
    });

    // liveData 초기화 강화
    if (!window.liveData) {
      window.liveData = {};
    }
    window.liveData.cadence = 0;  // 케이던스 명시적 초기화
     
    // (A) 워크아웃 보장: 캐시 복구 포함
    if (!window.currentWorkout) {
      try {
        const cached = localStorage.getItem("currentWorkout");
        if (cached) window.currentWorkout = JSON.parse(cached);
      } catch (e) {
        console.warn('Failed to load cached workout:', e);
      }
    }
    
    if (!window.currentWorkout) {
      console.error('No workout selected');
      if (typeof showToast === "function") showToast("워크아웃을 먼저 선택하세요");
      if (typeof showScreen === "function") showScreen("workoutScreen");
      return;
    }

    console.log('Current workout:', window.currentWorkout.title);

    // (B) 상태 초기화 (일시정지 해제 + 타이머 변수 초기화)
    if (typeof setPaused === "function") setPaused(false);
    if (window.trainingState) {
      window.trainingState.elapsedSec = 0;
      window.trainingState.segElapsedSec = 0;
      window.trainingState.segIndex = 0;
    }

    // (C) 세그먼트 타임라인 생성 (안전 장치 추가)
    if (typeof buildSegmentBar === "function") {
      try {
        buildSegmentBar();
      } catch (e) {
        console.warn('Failed to build segment bar:', e);
      }
    }

    // (D) 첫 세그먼트 타겟/이름 적용 + 시간 UI 1회 갱신 (안전 장치 추가)
    if (typeof applySegmentTarget === "function") {
      try {
        applySegmentTarget(0);
      } catch (e) {
        console.error('Failed to apply segment target:', e);
        // 기본값으로 설정
        window.liveData.targetPower = 200;
      }
    }
    
    if (typeof updateTimeUI === "function") {
      try {
        updateTimeUI();
      } catch (e) {
        console.warn('Failed to update time UI:', e);
      }
    }

    // (E) 화면 전환
    if (typeof showScreen === "function") {
      showScreen("trainingScreen");
      console.log('Switched to training screen');
      if (typeof initializeLaptopGauge === "function") {
        try { initializeLaptopGauge(); } catch (e) { console.warn('initializeLaptopGauge failed:', e); }
      }

      // ERG 모드 UI 초기화 (스마트로라 연결 상태 확인)
      if (typeof initializeErgMode === 'function') {
        setTimeout(() => {
          initializeErgMode();
        }, 100);
      }
    }

      // ⬇ 차트 초기화 1회
      window.initTrainingCharts?.();     

      /* ⬇⬇⬇ A) 훈련 시작 지점 — 여기 추가 ⬇⬇⬇ */
      window.trainingState = window.trainingState || {};
      window.trainingState.isRunning = true;           // 훈련 진행 상태 on
      
      if (typeof ScreenAwake !== "undefined" && ScreenAwake.acquire) {
        ScreenAwake.acquire();                         // 화면 항상 켜짐 요청
      } else {
        console.warn("[ScreenAwake] util not found or acquire missing");
      }
      // 노트북 훈련 전용 화면 꺼짐 방지 (모바일과 독립)
      setTimeout(function () {
        if (typeof window.laptopTrainingWakeLockControl !== 'undefined' && window.laptopTrainingWakeLockControl.request) {
          window.laptopTrainingWakeLockControl.request();
        }
      }, 100);

  if (typeof window.updateGroupTrainingControlButtons === "function") {
    window.updateGroupTrainingControlButtons();
  }
      /* ⬆⬆⬆ A) 훈련 시작 지점 — 여기까지 ⬆⬆⬆ */

     
    // 사용자 정보 출력 (안전 장치 추가)
    if (typeof renderUserInfo === "function") {
      try {
        renderUserInfo();
      } catch (e) {
        console.warn('Failed to render user info:', e);
      }
    }

    // (F) 첫 프레임 즉시 렌더 (깜빡임 방지)
    if (typeof window.updateTrainingDisplay === "function") {
      try {
        window.updateTrainingDisplay();
      } catch (e) {
        console.error('Failed to update training display:', e);
      }
    }

    // (G) 1Hz 루프 시작 (세그먼트/시간 진행)
    if (typeof startSegmentLoop === "function") {
      try {
        startSegmentLoop();
        console.log('Segment loop started');
      } catch (e) {
        console.error('Failed to start segment loop:', e);
      }
    }

    if (typeof showToast === "function") showToast("훈련을 시작합니다");
    
  } catch (error) {
    console.error('Critical error in startWorkoutTraining:', error);
    if (typeof showToast === "function") {
      showToast("훈련 시작 중 오류가 발생했습니다: " + error.message);
    }
    // 오류 발생 시 워크아웃 선택 화면으로 돌아가기
    if (typeof showScreen === "function") {
      showScreen("workoutScreen");
    }
  }
}


// 케이던스 강제 리셋
window.resetCadence = function() {
  console.log("케이던스 강제 리셋 실행");
  
  window.liveData = window.liveData || {};
  window.liveData.cadence = 0;
  
  const cadenceElement = safeGetElement("cadenceValue");
  if (cadenceElement) {
    cadenceElement.textContent = "0";
    console.log("케이던스 값을 0으로 리셋 완료");
  }
  
  // 화면 업데이트
  if (typeof window.updateTrainingDisplay === "function") {
    window.updateTrainingDisplay();
  }
};



function backToWorkoutSelection() {
  if (typeof showScreen === "function") {
    showScreen("workoutScreen");
  }
}

// 이전 화면으로 이동하는 함수
function goBackToPreviousScreen() {
  console.log('goBackToPreviousScreen called, History:', window.screenHistory);
  
  if (!window.screenHistory || window.screenHistory.length === 0) {
    // 히스토리가 없으면 기본적으로 워크아웃 화면으로 이동
    console.log('No history, going to workoutScreen');
    if (typeof showScreen === "function") {
      showScreen("workoutScreen", true);
    }
    return;
  }
  
  // 히스토리에서 마지막 화면 가져오기
  const previousScreen = window.screenHistory.pop();
  console.log(`Going back to: ${previousScreen}`);
  
  if (previousScreen && typeof showScreen === "function") {
    // skipHistory를 true로 설정하여 이전 화면으로 이동할 때는 히스토리에 추가하지 않음
    showScreen(previousScreen, true);
  } else {
    // 이전 화면이 없거나 유효하지 않으면 워크아웃 화면으로 이동
    console.log('Invalid previous screen, going to workoutScreen');
    if (typeof showScreen === "function") {
      showScreen("workoutScreen", true);
    }
  }
}

// 전역 함수로 export
window.goBackToPreviousScreen = goBackToPreviousScreen;

// 훈련 화면 상단에 사용자 정보가 즉시 표시
// 사용자 정보 렌더 + W/kg 네온(정적) 적용
function renderUserInfo() {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  try {
    const box = document.getElementById("userInfo");
    if (!box) return;
    const gradeIconEl = document.getElementById("trainingScreenGradeIcon");

    const u = window.currentUser;
    if (!u) {
      box.textContent = "사용자 미선택";
      if (gradeIconEl) gradeIconEl.innerHTML = "";
      if (typeof updateUserPanelNeonByWkg === "function") updateUserPanelNeonByWkg(0);
      return;
    }

    // 표시값 구성
    const cleanName = String(u.name || "").replace(/^👤+/g, "").trim();
    const ftp = Number(u.ftp);
    const wt  = Number(u.weight ?? u.weightKg); // 둘 중 하나 쓰는 구조면 병행 지원
    const wkgNum = (Number.isFinite(ftp) && Number.isFinite(wt) && wt > 0) ? (ftp / wt) : NaN;

    const ftpDisp = Number.isFinite(ftp) ? String(ftp) : "-";
    const wkgDisp = Number.isFinite(wkgNum) ? wkgNum.toFixed(2) : "-";

    // 훈련 목표(등급)에 따른 아이콘
    const challenge = String(u.challenge || 'Fitness').trim();
    let challengeImage = 'yellow.png';
    if (challenge === 'GranFondo') challengeImage = 'green.png';
    else if (challenge === 'Racing') challengeImage = 'blue.png';
    else if (challenge === 'Elite') challengeImage = 'orenge.png';
    else if (challenge === 'PRO') challengeImage = 'red.png';

    // 훈련등급 아이콘과 사용자 정보를 나란히 한 줄로 표시
    if (gradeIconEl) {
      gradeIconEl.innerHTML = '<img src="assets/img/' + challengeImage + '" alt="" class="training-user-challenge-icon">';
    }
    box.innerHTML = '<span class="training-user-name-clickable" style="cursor: pointer; text-decoration: underline;" onclick="if (typeof showScreen === \'function\') { showScreen(\'groupRoomScreen\'); if (typeof selectRole === \'function\') { setTimeout(function(){ selectRole(\'participant\'); }, 200); } }" title="훈련 참가 화면으로 이동">' + cleanName + '</span> · FTP ' + ftpDisp + 'W · ' + wkgDisp + ' W/kg';

    // ★ 사용자 판넬 네온은 "한 번만" 적용 (동적 갱신 안 함)
    if (typeof updateUserPanelNeonByWkg === "function") {
      updateUserPanelNeonByWkg(Number.isFinite(wkgNum) ? wkgNum : 0);
    }

  } catch (error) {
    console.error('Error in renderUserInfo:', error);
  }
}



// ---------------------------------------------

function togglePause() {
  setPaused(!window.trainingState.paused);
}

// 스플래시 화면 보호를 가장 먼저 실행 (DOM 로드 전에도 실행 가능)
(function protectSplashScreenImmediately() {
  // 즉시 실행하여 다른 코드보다 먼저 실행되도록 보장
  function protectSplash() {
    const splashScreen = document.getElementById("splashScreen");
    if (splashScreen) {
      // 즉시 스플래시 화면 보호 설정
      splashScreen.style.setProperty('display', 'block', 'important');
      splashScreen.style.setProperty('opacity', '1', 'important');
      splashScreen.style.setProperty('visibility', 'visible', 'important');
      splashScreen.style.setProperty('z-index', '10000', 'important');
      splashScreen.style.setProperty('transition', 'none', 'important');
      splashScreen.classList.add("active");
      
      // 다른 모든 화면 즉시 숨기기
      document.querySelectorAll(".screen").forEach(screen => {
        if (screen.id !== 'splashScreen') {
          screen.style.setProperty('display', 'none', 'important');
          screen.style.setProperty('opacity', '0', 'important');
          screen.style.setProperty('visibility', 'hidden', 'important');
          screen.classList.remove("active");
        }
      });
      
      // 전역 플래그 설정
      window.isSplashActive = true;
    }
  }
  
  // 즉시 실행
  protectSplash();
  
  // DOM이 준비되면 다시 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', protectSplash);
  } else {
    protectSplash();
  }
  
  // 추가 보호: 주기적으로 확인 (매우 빠른 간격)
  const protectionInterval = setInterval(() => {
    if (window.isSplashActive) {
      protectSplash();
    } else {
      clearInterval(protectionInterval);
    }
  }, 16); // 약 60fps로 확인
  
  // 5초 후 자동 정리 (스플래시 화면이 완료되어야 함)
  setTimeout(() => {
    clearInterval(protectionInterval);
    // 스플래시 화면이 완료되면 보호 중단
    window.isSplashActive = false;
  }, 5000);
})();

// DOMContentLoaded 이벤트
document.addEventListener("DOMContentLoaded", () => {
  console.log("===== APP INIT =====");

  // 블루투스 개인훈련 화면 연결 버튼에서 센서연결만 열기 위해 온 경우: 스플래시 건너뛰기
  if (window.location.search.indexOf('openDeviceSettings=1') !== -1) {
    window._openDeviceSettingsFromBluetooth = true;
  }
  // iframe으로 센서연결 오버레이만 띄울 때 (모바일과 동일하게 팝업만 표시) — head에서 이미 설정될 수 있음
  if (window.location.search.indexOf('openDeviceSettingsOnly=1') !== -1) {
    window._openDeviceSettingsOnly = true;
  }

  // openDeviceSettingsOnly=1 이면 초기로딩·인증·베이스캠프 진행 없이 센서연결 오버레이만 띄움 (블루투스 훈련화면 연결버튼)
  if (window._openDeviceSettingsOnly) {
    var splashEl = document.getElementById('splashScreen');
    if (splashEl) {
      splashEl.style.setProperty('display', 'none', 'important');
      splashEl.classList.remove('active');
    }
    document.querySelectorAll('.screen').forEach(function (s) {
      s.style.setProperty('display', 'none', 'important');
      s.classList.remove('active');
    });
    function openDeviceSettingsOverlayOnly() {
      if (typeof window.openDeviceSettingPopup === 'function') {
        window.openDeviceSettingPopup();
      } else {
        setTimeout(openDeviceSettingsOverlayOnly, 100);
      }
    }
    setTimeout(openDeviceSettingsOverlayOnly, 150);
    window.isSplashActive = false;
    // 이하 Strava/해시/베이스캠프 등 다른 화면 전환 로직은 실행하지 않음 (return 아님, 아래 조건으로 스킵)
  }

  // Strava 콜백에서 돌아온 경우 베이스캠프 화면으로 이동 (센서연결 오버레이 전용 모드가 아닐 때만)
  if (!window._openDeviceSettingsOnly) {
  const stravaCallbackReturn = localStorage.getItem('stravaCallbackReturn');
  if (stravaCallbackReturn === 'basecampScreen') {
    localStorage.removeItem('stravaCallbackReturn');
    // 약간의 지연 후 베이스캠프 화면으로 이동 (다른 초기화 완료 대기)
    setTimeout(function() {
      if (typeof showScreen === 'function') {
        showScreen('basecampScreen');
      }
    }, 500);
  }
  
  // URL 해시 확인 (#profileScreen)
  if (window.location.hash === '#profileScreen') {
    setTimeout(function() {
      if (typeof showScreen === 'function') {
        showScreen('profileScreen');
        if (typeof window.loadUsers === 'function') {
          setTimeout(() => window.loadUsers(), 200);
        }
      }
    }, 500);
  }

  // 블루투스 개인훈련 화면에서 돌아올 때: #basecampScreen → 베이스캠프 표시
  if (window.location.hash === '#basecampScreen') {
    setTimeout(function() {
      if (typeof showScreen === 'function') showScreen('basecampScreen');
    }, 500);
  }

  // 블루투스 개인훈련 화면 연결 버튼에서 이동 시: openDeviceSettings=1 → 스플래시 없이 베이스캠프 + 센서 연결 오버레이만 열기 (주간 마일리지 TOP10은 이 경로에서는 표시하지 않음)
  if (window.location.search.indexOf('openDeviceSettings=1') !== -1) {
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + (window.location.hash || ''));
      }
    } catch (e) {}
    window.__basecampShownAfterAuth = false; // 센서연결만 띄우는 흐름이므로 TOP10 미표시
    function openBasecampAndDeviceSettingsPopup() {
      if (typeof showScreen === 'function') showScreen('basecampScreen');
      if (typeof window.openDeviceSettingPopup === 'function') {
        window.openDeviceSettingPopup();
      } else {
        setTimeout(openBasecampAndDeviceSettingsPopup, 100);
      }
    }
    setTimeout(openBasecampAndDeviceSettingsPopup, 200);
  }
  } // end if (!window._openDeviceSettingsOnly) — 센서연결 오버레이 전용 모드에서는 Strava/해시/베이스캠프 전환 없음

  // 노트북 훈련 화면: 좌측 베이스캠프 이동 버튼 (STELVIO 종료 확인 팝업 후 이동)
  var trainingScreenExitBtn = document.getElementById('trainingScreenExitToBasecamp');
  if (trainingScreenExitBtn) {
    trainingScreenExitBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof showStelvioExitConfirmPopup === 'function') {
        showStelvioExitConfirmPopup(function() {
          if (typeof showScreen === 'function') showScreen('basecampScreen');
        });
      } else if (typeof showScreen === 'function') {
        showScreen('basecampScreen');
      }
    });
  }

  // 스플래시 화면 처리 (최우선 실행 - 다른 모든 초기화보다 먼저)
  const splashScreen = document.getElementById("splashScreen");
  const splashVideo = document.getElementById("splashVideo");
  const splashLoaderProgress = document.getElementById("splashLoaderProgress");
  
  // 블루투스 연결 버튼에서 센서연결만 열려고 온 경우 스플래시 비활성화 (초기 로딩 화면 건너뛰기)
  const skipSplashForDeviceSettings = !!window._openDeviceSettingsFromBluetooth || !!window._openDeviceSettingsOnly;
  const isSplashActive = !skipSplashForDeviceSettings && splashScreen && (splashScreen.classList.contains("active") || window.getComputedStyle(splashScreen).display !== "none");
  
  // 스플래시 화면 보호 플래그 (전역)
  window.isSplashActive = isSplashActive || window.isSplashActive;
  
  if (skipSplashForDeviceSettings && splashScreen) {
    splashScreen.style.setProperty('display', 'none', 'important');
    splashScreen.classList.remove('active');
  }
  if (window._openDeviceSettingsOnly) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.style.setProperty('display', 'none', 'important');
      s.classList.remove('active');
    });
    function openDeviceSettingsOverlayOnly() {
      if (typeof window.openDeviceSettingPopup === 'function') {
        window.openDeviceSettingPopup();
      } else {
        setTimeout(openDeviceSettingsOverlayOnly, 100);
      }
    }
    setTimeout(openDeviceSettingsOverlayOnly, 250);
  }
  
  // 스플래시 화면이 활성화되어 있으면 다른 초기화 코드 실행 방지
  if (window.isSplashActive) {
    // 즉시 다른 모든 화면 숨기기 - !important 사용
    document.querySelectorAll(".screen").forEach(screen => {
      if (screen.id !== 'splashScreen') {
        screen.style.setProperty('display', 'none', 'important');
        screen.style.setProperty('opacity', '0', 'important');
        screen.style.setProperty('visibility', 'hidden', 'important');
        screen.classList.remove("active");
      }
    });
    
    // 스플래시 화면도 다시 한번 보호
    if (splashScreen) {
      splashScreen.style.setProperty('display', 'block', 'important');
      splashScreen.style.setProperty('opacity', '1', 'important');
      splashScreen.style.setProperty('visibility', 'visible', 'important');
      splashScreen.style.setProperty('z-index', '10000', 'important');
      splashScreen.style.setProperty('transition', 'none', 'important');
      splashScreen.classList.add("active");
    }
  }

  // iOS용 처리 프로세스
  function isIOS() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  // Bluefy 브라우저 감지 (iOS에서 Web Bluetooth 지원)
  function isBluefy() {
    const ua = navigator.userAgent || "";
    return /Bluefy/i.test(ua);
  }

  function enableIOSMode() {
    const info = safeGetElement("iosInfo");
    // Bluefy를 사용 중이거나 Web Bluetooth를 지원하면 iOS 안내 메시지 숨김
    if (info) {
      if (isBluefy() || navigator.bluetooth) {
        // Bluefy 사용 중이거나 Web Bluetooth 지원 → 안내 메시지 숨김
        info.classList.add("hidden");
        console.log("✅ Bluefy 또는 Web Bluetooth 지원 브라우저 감지 - iOS 안내 메시지 숨김");
      } else {
        // iOS Safari 등 Web Bluetooth 미지원 → 안내 메시지 표시
        info.classList.remove("hidden");
        console.log("⚠️ iOS Safari 감지 - Web Bluetooth 미지원 안내 메시지 표시");
      }
    }

    // 블루투스 미지원 브라우저 확인 (navigator.bluetooth가 없으면 미지원)
    if (!navigator.bluetooth) {
      // 블루투스 미지원 브라우저(Safari, PC 구형 브라우저 등)인 경우
      ["btnConnectPM","btnConnectTrainer","btnConnectHR"].forEach(id => {
        const el = safeGetElement(id);
        if (el) {
          el.classList.add("is-disabled");
          el.setAttribute("aria-disabled","true");
          el.title = "블루투스 미지원 브라우저입니다. Bluefy 앱을 사용하세요";
        }
      });

      // iOS 기기이면서 블루투스 미지원인 경우 안내 메시지
      if (isIOS() && !isBluefy()) {
        console.log("iOS 기기에서 블루투스 미지원 브라우저 감지 - Bluefy 앱 사용 권장");
      }
    } else {
      // 블루투스 지원 브라우저 (Chrome, Bluefy 등) - 버튼 활성화
      ["btnConnectPM","btnConnectTrainer","btnConnectHR"].forEach(id => {
        const el = safeGetElement(id);
        if (el) {
          el.classList.remove("is-disabled");
          el.removeAttribute("aria-disabled");
          el.title = "";
        }
      });
    }

    // null 체크 강화
    const btn = safeGetElement("btnIosContinue");
    if (btn) {
      btn.addEventListener("click", () => {
        console.log("iOS continue button clicked");
        if (typeof showScreen === "function" && !window.isSplashActive) {
          showScreen("profileScreen");
        } else {
          console.error("showScreen function not available or splash active");
        }
      });
    } else {
      console.warn("btnIosContinue element not found in DOM");
    }
  }

  // 브라우저 지원 확인 (스플래시 화면이 활성화되어 있으면 지연)
  if (!window.isSplashActive) {
  if (!navigator.bluetooth) {
    if (typeof showToast === "function") {
      showToast("이 브라우저는 Web Bluetooth를 지원하지 않습니다.");
    }
    console.error("Web Bluetooth not supported");
  }
  
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    if (typeof showToast === "function") {
      showToast("BLE를 사용하려면 HTTPS가 필요합니다.");
    }
    console.warn("HTTPS required for BLE");
  }
  }
  
  if (window.isSplashActive && splashScreen) {
    // 즉시 다른 모든 화면 숨기기 (가장 먼저 실행) - 동기적으로 실행
    document.querySelectorAll(".screen").forEach(screen => {
      if (screen.id !== 'splashScreen') {
        screen.style.setProperty('display', 'none', 'important');
        screen.style.setProperty('opacity', '0', 'important');
        screen.style.setProperty('visibility', 'hidden', 'important');
        screen.classList.remove("active");
      }
    });
    
    // 스플래시 화면 강제 표시 보호 (깜빡임 방지) - !important 사용
    splashScreen.style.setProperty('display', 'block', 'important');
    splashScreen.style.setProperty('opacity', '1', 'important');
    splashScreen.style.setProperty('visibility', 'visible', 'important');
    splashScreen.style.setProperty('z-index', '10000', 'important');
    splashScreen.style.setProperty('transition', 'none', 'important');
    splashScreen.classList.add("active");
  
    // MutationObserver로 스플래시 화면 변경 감지 및 즉시 복구 (더 빠른 반응)
    const splashObserver = new MutationObserver((mutations) => {
      if (window.isSplashActive && splashScreen) {
        // requestAnimationFrame으로 즉시 복구 (다음 프레임에서 실행)
        requestAnimationFrame(() => {
          const computedStyle = window.getComputedStyle(splashScreen);
          const needsFix = 
            splashScreen.style.display === "none" || 
            computedStyle.display === "none" ||
            !splashScreen.classList.contains("active") || 
            splashScreen.style.opacity === "0" ||
            computedStyle.opacity === "0" ||
            splashScreen.style.zIndex !== "10000" ||
            computedStyle.zIndex !== "10000";
          
          if (needsFix) {
            // 즉시 복구 - !important 사용
            splashScreen.style.setProperty('display', 'block', 'important');
            splashScreen.style.setProperty('opacity', '1', 'important');
            splashScreen.style.setProperty('visibility', 'visible', 'important');
            splashScreen.style.setProperty('z-index', '10000', 'important');
            splashScreen.style.setProperty('transition', 'none', 'important');
    splashScreen.classList.add("active");
    
            // 다른 화면들도 강제로 숨김
            document.querySelectorAll(".screen").forEach(screen => {
              if (screen.id !== 'splashScreen') {
                screen.style.setProperty('display', 'none', 'important');
                screen.style.setProperty('opacity', '0', 'important');
                screen.style.setProperty('visibility', 'hidden', 'important');
                screen.classList.remove("active");
              }
            });
          }
        });
      }
    });
    
    // 스플래시 화면 속성 변경 감지 시작
    splashObserver.observe(splashScreen, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      childList: false,
      subtree: false
    });
    
    // 전역에 observer 저장 (나중에 정리용)
    window.splashObserver = splashObserver;
    
    console.log("🎬 스플래시 화면 시작 - 4초 후 인증 화면으로 전환");
    
    // 스플래시 화면이 활성화되어 있으면 처리
    let elapsedTime = 0;
    const totalDuration = 4000; // 4초
    
    // 동영상 재생 시작
    if (splashVideo) {
      splashVideo.currentTime = 0; // 동영상 처음부터 재생
      splashVideo.play().catch(err => {
        console.warn("동영상 자동 재생 실패:", err);
      });
    }
    
    // 페이드 아웃 시작 여부 추적
    let isFadingOut = false;
    
    // 로딩 바 애니메이션 (4초 동안 완료되도록 정확한 간격 설정)
    // 50ms마다 실행하고 50ms씩 증가 = 정확히 4초(4000ms)에 100% 도달
    // setInterval의 두 번째 인자를 명시적으로 50ms로 설정
    const progressInterval = setInterval(() => {
      elapsedTime += 50; // 50ms씩 증가
      const progress = Math.min((elapsedTime / totalDuration) * 100, 100);
      
      if (splashLoaderProgress) {
        splashLoaderProgress.style.width = progress + "%";
      }
      
      // 스플래시 화면이 숨겨지지 않도록 주기적으로 확인 및 복구 (페이드 아웃 중이 아닐 때만)
      // 더 빠른 체크를 위해 50ms마다 실행 (기존 100ms보다 빠름)
      if (!isFadingOut && splashScreen && window.isSplashActive) {
        // 깜빡임 방지를 위해 항상 최상위 유지 (더 강력한 체크)
        const computedStyle = window.getComputedStyle(splashScreen);
        const needsFix = 
          splashScreen.style.display === "none" || 
          computedStyle.display === "none" ||
          !splashScreen.classList.contains("active") || 
          splashScreen.style.opacity === "0" ||
          computedStyle.opacity === "0" ||
          splashScreen.style.zIndex !== "10000" ||
          computedStyle.zIndex !== "10000";
          
        if (needsFix) {
          // 즉시 복구 (동기적으로 실행하여 깜빡임 최소화) - !important 사용
          splashScreen.style.setProperty('display', 'block', 'important');
          splashScreen.style.setProperty('opacity', '1', 'important');
          splashScreen.style.setProperty('visibility', 'visible', 'important');
          splashScreen.style.setProperty('z-index', '10000', 'important');
          splashScreen.style.setProperty('transition', 'none', 'important');
        splashScreen.classList.add("active");
          
          // 다른 화면들이 나타나지 않도록 강제로 숨김
          document.querySelectorAll(".screen").forEach(screen => {
            if (screen.id !== 'splashScreen') {
              screen.style.setProperty('display', 'none', 'important');
              screen.style.setProperty('opacity', '0', 'important');
              screen.style.setProperty('visibility', 'hidden', 'important');
              screen.classList.remove("active");
            }
          });
        }
      }
      
      // 진행바가 100%에 도달했는지 확인
      if (elapsedTime >= totalDuration) {
        clearInterval(progressInterval);
        isFadingOut = true;
        elapsedTime = totalDuration; // 정확히 100%로 설정
        
        // 진행바를 100%로 설정
        if (splashLoaderProgress) {
          splashLoaderProgress.style.width = "100%";
        }
        
        console.log("✅ 스플래시 화면 완료 (정확히 4초) - 진행바와 텍스트 숨기기 시작");
        
        // 진행바와 흰색 글씨 먼저 즉시 숨기기 (!important 사용) - 페이드 아웃 전에 실행
        const splashLoader = document.querySelector('.splash-loader');
        const splashTagline = document.querySelector('.splash-tagline');
        const splashContent = document.querySelector('.splash-content');
        const splashLogoContainer = document.querySelector('.splash-logo-container');
        
        // 즉시 숨기기 (애니메이션 없이)
        if (splashLoader) {
          splashLoader.style.setProperty('display', 'none', 'important');
          splashLoader.style.setProperty('opacity', '0', 'important');
          splashLoader.style.setProperty('visibility', 'hidden', 'important');
          splashLoader.style.setProperty('transition', 'none', 'important');
        }
        if (splashTagline) {
          splashTagline.style.setProperty('display', 'none', 'important');
          splashTagline.style.setProperty('opacity', '0', 'important');
          splashTagline.style.setProperty('visibility', 'hidden', 'important');
          splashTagline.style.setProperty('transition', 'none', 'important');
        }
        if (splashContent) {
          splashContent.style.setProperty('opacity', '0', 'important');
          splashContent.style.setProperty('visibility', 'hidden', 'important');
          splashContent.style.setProperty('display', 'none', 'important');
          splashContent.style.setProperty('transition', 'none', 'important');
        }
        if (splashLogoContainer) {
          splashLogoContainer.style.setProperty('opacity', '0', 'important');
          splashLogoContainer.style.setProperty('visibility', 'hidden', 'important');
          splashLogoContainer.style.setProperty('display', 'none', 'important');
          splashLogoContainer.style.setProperty('transition', 'none', 'important');
        }
        
        // 진행바 내부 요소도 숨기기
        if (splashLoaderProgress) {
          splashLoaderProgress.style.setProperty('display', 'none', 'important');
          splashLoaderProgress.style.setProperty('opacity', '0', 'important');
          splashLoaderProgress.style.setProperty('visibility', 'hidden', 'important');
          splashLoaderProgress.style.setProperty('width', '0%', 'important');
          splashLoaderProgress.style.setProperty('transition', 'none', 'important');
        }
        
        // Observer 정리 및 플래그 해제
        window.isSplashActive = false;
        if (window.splashObserver) {
          window.splashObserver.disconnect();
          window.splashObserver = null;
        }
        
        // 짧은 딜레이 후 스플래시 화면 페이드 아웃 (50ms 후)
        setTimeout(() => {
          console.log("✅ 진행바와 텍스트 숨김 완료 - 스플래시 화면 페이드 아웃 시작");
        
          // 페이드 아웃 애니메이션 (짧게)
          splashScreen.style.transition = "opacity 0.3s ease-out";
        splashScreen.style.opacity = "0";
        
          // 인증 화면으로 전환 (페이드 아웃 시간 단축 - 300ms)
        setTimeout(() => {
            // 진행바와 텍스트 다시 한번 확실하게 숨기기
            if (splashLoader) {
              splashLoader.style.setProperty('display', 'none', 'important');
              splashLoader.style.setProperty('opacity', '0', 'important');
              splashLoader.style.setProperty('visibility', 'hidden', 'important');
            }
            if (splashTagline) {
              splashTagline.style.setProperty('display', 'none', 'important');
              splashTagline.style.setProperty('opacity', '0', 'important');
              splashTagline.style.setProperty('visibility', 'hidden', 'important');
            }
            if (splashContent) {
              splashContent.style.setProperty('display', 'none', 'important');
              splashContent.style.setProperty('opacity', '0', 'important');
              splashContent.style.setProperty('visibility', 'hidden', 'important');
            }
            if (splashLogoContainer) {
              splashLogoContainer.style.setProperty('display', 'none', 'important');
              splashLogoContainer.style.setProperty('opacity', '0', 'important');
              splashLogoContainer.style.setProperty('visibility', 'hidden', 'important');
            }
            if (splashLoaderProgress) {
              splashLoaderProgress.style.setProperty('display', 'none', 'important');
              splashLoaderProgress.style.setProperty('opacity', '0', 'important');
              splashLoaderProgress.style.setProperty('visibility', 'hidden', 'important');
            }
            
            // 스플래시 화면 완전히 숨기기
          splashScreen.classList.remove("active");
            splashScreen.style.setProperty('display', 'none', 'important');
            splashScreen.style.setProperty('opacity', '0', 'important');
            splashScreen.style.setProperty('visibility', 'hidden', 'important');
            splashScreen.style.setProperty('z-index', '-1', 'important');
            splashScreen.style.setProperty('transition', 'none', 'important');
            splashScreen.style.setProperty('background', 'transparent', 'important'); // 배경색 제거
            
            // body 배경색 원복 (원래 배경색으로 복원)
            document.body.style.setProperty('background-color', '#f6f8fa', 'important');
            document.body.style.setProperty('background-attachment', 'fixed', 'important');
            
            // 스플래시 화면의 모든 자식 요소도 숨기기 (!important 사용)
            const splashContainer = document.querySelector('.splash-container');
            if (splashContainer) {
              splashContainer.style.setProperty('display', 'none', 'important');
              splashContainer.style.setProperty('opacity', '0', 'important');
              splashContainer.style.setProperty('visibility', 'hidden', 'important');
            }
            
            // body 배경색 원복 (원래 배경색으로 복원)
            document.body.style.setProperty('background-color', '#f6f8fa', 'important');
            document.body.style.setProperty('background-attachment', 'fixed', 'important');
          
          // 인증 화면 직접 표시 (showScreen 함수는 인증 체크를 하므로 우회)
          const authScreen = document.getElementById("authScreen");
          if (authScreen) {
            // 다른 모든 화면 숨기기
            document.querySelectorAll(".screen").forEach(screen => {
              if (screen.id !== 'splashScreen') {
                screen.classList.remove("active");
                screen.style.display = "none";
              }
            });
            
            // 인증 화면 표시
            authScreen.style.display = "block";
            authScreen.classList.add("active");
            authScreen.style.opacity = "1";
            authScreen.style.visibility = "visible";
            
            // 인증 시스템 초기화 (스플래시 후 실행)
            setTimeout(() => {
              // 인증 시스템 이벤트 리스너 초기화
              if (typeof initializeAuthenticationSystem === 'function') {
                console.log('🔧 인증 시스템 초기화 시작');
                initializeAuthenticationSystem();
              } else {
                console.warn('⚠️ initializeAuthenticationSystem 함수를 찾을 수 없습니다');
              }
              
              // 전화번호 입력 필드 포커스
              const phoneInput = document.getElementById('phoneInput');
              if (phoneInput) {
                phoneInput.focus();
              }
            }, 200);
          }
          }, 300); // 페이드 아웃 시간에 맞춰 300ms로 조정
        }, 50); // 진행바와 텍스트 숨김 후 50ms 딜레이
      }
    }, 50); // 50ms마다 실행하여 정확히 4초(4000ms)에 100% 도달
  } else {
    // 스플래시 화면이 없거나 비활성화되어 있으면 바로 인증 화면 표시
    // body 배경색 원복 (원래 배경색으로 복원)
    document.body.style.setProperty('background-color', '#f6f8fa', 'important');
    document.body.style.setProperty('background-attachment', 'fixed', 'important');
    
    const authScreen = document.getElementById("authScreen");
    if (authScreen) {
      // 다른 모든 화면 숨기기
      document.querySelectorAll(".screen").forEach(screen => {
        screen.classList.remove("active");
        screen.style.display = "none";
      });
      
      // 인증 화면 표시
      authScreen.style.display = "block";
      authScreen.classList.add("active");
      authScreen.style.opacity = "1";
      authScreen.style.visibility = "visible";
    }
  }
  
  // 연결 화면 표시 시 버튼 이미지 초기화 (스플래시 후에 실행될 수 있도록)
    if (typeof updateDeviceButtonImages === "function") {
      setTimeout(() => updateDeviceButtonImages(), 100);
  }

  // 훈련 준비 → 노트북 클릭 시 개인 훈련 화면만 로딩 (initTrainingScreenForReady에서 시작 버튼 표시).
  // 훈련 시작은 개인 훈련 화면의 "시작" 버튼 → 5초 카운트다운 → startWorkoutTraining() 으로 진행.
  const btnStartTrainingFromScreen = document.getElementById("btnStartTrainingFromScreen");
  if (btnStartTrainingFromScreen) {
    btnStartTrainingFromScreen.addEventListener("click", function () {
      var cu = window.currentUser || (function(){ try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(e){ return null; } })();
      if (typeof isUserExpired === 'function' && cu && isUserExpired(cu)) {
        if (typeof showExpiryRestrictionModal === 'function') showExpiryRestrictionModal();
        return;
      }
      startWithCountdown(5);
    });
  }

  // trainingModeScreen의 카드들에 이벤트 리스너 추가
  const individualTrainingCard = safeGetElement("individualTrainingCard");
  if (individualTrainingCard) {
    individualTrainingCard.addEventListener("click", async () => {
      if (typeof selectTrainingMode === 'function') {
        await selectTrainingMode('individual');
      } else {
        console.warn('selectTrainingMode function not found');
        if (typeof showToast === 'function') {
          showToast('개인 훈련 기능을 찾을 수 없습니다', 'error');
        }
      }
    });
  }

  const groupTrainingCard = safeGetElement("groupTrainingCard");
  if (groupTrainingCard) {
    groupTrainingCard.addEventListener("click", async () => {
      if (typeof selectTrainingMode === 'function') {
        await selectTrainingMode('group');
      } else {
        console.warn('selectTrainingMode function not found');
        if (typeof showToast === 'function') {
          showToast('그룹 훈련 기능을 찾을 수 없습니다', 'error');
        }
      }
    });
  }

  // loadUsers()가 userProfiles도 인식하게(방어)
  function loadUsers() {
    const box = safeGetElement("userList");
    if (!box) return;

    // 전역 데이터: window.users → window.userProfiles 순으로 폴백
    const list =
      (Array.isArray(window.users) && window.users.length ? window.users :
       Array.isArray(window.userProfiles) && window.userProfiles.length ? window.userProfiles :
       []);

    if (!Array.isArray(list) || list.length === 0) {
      box.innerHTML = `<div class="muted">등록된 사용자가 없습니다.</div>`;
      box.onclick = null; // 이전 위임 핸들러 제거
      // grade=1(관리자)인 경우 프로필 선택 화면 부제목에 "현재 가입자 수 : 0 명" 표시
      const profileSubtitleEmpty = document.getElementById("profileScreenSubtitle");
      if (profileSubtitleEmpty) {
        const currentUser = window.currentUser || JSON.parse(localStorage.getItem("currentUser") || "null");
        const grade = currentUser?.grade;
        if (grade === "1" || grade === 1) {
          profileSubtitleEmpty.textContent = "현재 가입자 수 : 0 명";
          profileSubtitleEmpty.style.display = "";
        } else {
          profileSubtitleEmpty.textContent = "";
          profileSubtitleEmpty.style.display = "none";
        }
      }
      return;
    }

    // AI 페어링 표시등: API 키 등록 여부(전역)
    let hasAiKey = false;
    try {
      const key = typeof localStorage !== 'undefined' ? localStorage.getItem('geminiApiKey') : null;
      hasAiKey = !!(key && String(key).trim());
    } catch (e) {}

    // 카드 렌더 (이름, FTP, W/kg, 표시등 A/S 포함)
    box.innerHTML = list.map((u) => {
      const name = (u?.name ?? "").toString();
      const ftp  = Number(u?.ftp);
      const wt   = Number(u?.weight);
      const wkg  = (Number.isFinite(ftp) && Number.isFinite(wt) && wt > 0)
        ? (ftp / wt).toFixed(2)
        : "-";
      const hasStrava = !!(u?.strava_refresh_token || u?.strava_access_token);
      const aiDot = hasAiKey ? 'background:#22c55e' : 'background:#d1d5db';
      const stravaDot = hasStrava ? 'background:#22c55e' : 'background:#d1d5db';

      return `
        <div class="user-card" data-id="${u.id}">
          <div class="user-name user-name-with-indicators">
            <span class="user-name-text"><img src="assets/img/add-user3.gif" alt="" class="user-name-icon"> ${name}</span>
            <span class="user-name-badges" title="AI 페어링 / Strava 연결">
              <span class="profile-indicator-dot" style="width:8px;height:8px;border-radius:50%;${aiDot}" title="AI 페어링" aria-label="AI 페어링"></span>
              <span class="profile-indicator-dot" style="width:8px;height:8px;border-radius:50%;${stravaDot}" title="Strava 연결" aria-label="Strava 연결"></span>
            </span>
          </div>
          <div class="user-meta">FTP ${Number.isFinite(ftp) ? ftp : "-"}W · ${wkg} W/kg</div>
          <button class="btn btn-primary" data-action="select" aria-label="${name} 선택">선택</button>
        </div>
      `;
    }).join("");

    // 선택 버튼 위임(매번 새로 바인딩되도록 on*로 설정)
    box.onclick = (e) => {
      const btn = e.target.closest('[data-action="select"]');
      if (!btn) return;
      const card = btn.closest(".user-card");
      const id = card?.getAttribute("data-id");
      const user = list.find((x) => String(x.id) === String(id));
      if (user && typeof window.selectProfile === "function") {
        window.selectProfile(user.id);
      }
    };

    // grade=1(관리자)인 경우 프로필 선택 화면 부제목에 "현재 가입자 수 : N 명" 표시
    const profileSubtitle = document.getElementById("profileScreenSubtitle");
    if (profileSubtitle) {
      const currentUser = window.currentUser || JSON.parse(localStorage.getItem("currentUser") || "null");
      const grade = currentUser?.grade;
      if (grade === "1" || grade === 1) {
        profileSubtitle.textContent = "현재 가입자 수 : " + list.length + " 명";
        profileSubtitle.style.display = "";
      } else {
        profileSubtitle.textContent = "";
        profileSubtitle.style.display = "none";
      }
    }
  }

  // 블루투스 연결 버튼들
  const btnHR = safeGetElement("btnConnectHR");
  const btnTrainer = safeGetElement("btnConnectTrainer");
  const btnPM = safeGetElement("btnConnectPM");
  const btnANT = safeGetElement("btnConnectANT");
  
  console.log("Button elements found:", {
    HR: !!btnHR,
    Trainer: !!btnTrainer,
    PM: !!btnPM,
    ANT: !!btnANT
  });
  
  // ANT+ 버튼 비활성화 (클릭 기능 제거)
  if (btnANT) {
    btnANT.disabled = true;
    btnANT.classList.add('is-disabled');
    btnANT.setAttribute('aria-disabled', 'true');
    btnANT.title = '';
    btnANT.style.opacity = '0.6';
    btnANT.style.cursor = 'default';
    btnANT.style.pointerEvents = 'none';
  }
  
  // 심박계 버튼 (신규 검색: 즉시 전체 검색창 오픈)
  if (btnHR) {
    btnHR.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("HR button clicked!");
      
      if (!window.connectHeartRate) {
        console.error("connectHeartRate function not found!");
        if (typeof showToast === "function") {
          showToast("심박계 연결 함수를 찾을 수 없습니다.");
        }
        return;
      }
      
      btnHR.disabled = true;
      
      try {
        await window.connectHeartRate(true);
      } catch (err) {
        console.error("HR connection error:", err);
      } finally {
        btnHR.disabled = false;
      }
    });
  }
  
  // 트레이너 버튼 (신규 검색: 즉시 전체 검색창 오픈)
  if (btnTrainer) {
    btnTrainer.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("Trainer button clicked!");
      if (window.connectTrainer) {
        await window.connectTrainer(true);
      }
    });
  }
  
  // 파워미터 버튼 (신규 검색: 즉시 전체 검색창 오픈)
  if (btnPM) {
    btnPM.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("PM button clicked!");
      if (window.connectPowerMeter) {
        await window.connectPowerMeter(true);
      }
    });
  }
  
  // ANT+ 버튼 - 클릭 이벤트 제거 (비활성화)
  // 클릭 기능 제거됨

  // ========== Indoor 모드 선택 모달 함수 ==========
  window.showIndoorModeSelectionModal = function() {
    const modal = document.getElementById('indoorModeSelectionModal');
    if (modal) {
      modal.classList.remove('hidden');
      
      // Indoor Race 버튼 등급 제한 해제 (모든 등급 사용 가능)
      const btnIndoorRace = document.getElementById('btnIndoorRace');
      if (btnIndoorRace) {
        btnIndoorRace.disabled = false;
        btnIndoorRace.classList.remove('is-disabled');
        btnIndoorRace.removeAttribute('aria-disabled');
        btnIndoorRace.style.opacity = '1';
        btnIndoorRace.style.cursor = 'pointer';
        btnIndoorRace.title = '';
      }
    }
  };

  window.closeIndoorModeSelectionModal = function() {
    const modal = document.getElementById('indoorModeSelectionModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  };

  window.selectIndoorMode = function(mode) {
    closeIndoorModeSelectionModal();
    if (mode === 'race') {
      // INDOOR RACE 선택 시 rollerRaceDashboardScreen으로 이동
      if (typeof showScreen === 'function') {
        showScreen('rollerRaceDashboardScreen');
      }
      // rollerRaceDashboard 초기화 (showScreen에서 자동으로 호출되지만 명시적으로 호출)
      if (typeof initRollerRaceDashboard === 'function') {
        setTimeout(() => {
          initRollerRaceDashboard();
        }, 100);
      }
    } else if (mode === 'training') {
      if (typeof showScreen === 'function') {
        showScreen('indoorTrainingDashboardScreen');
      }
    }
  };

  // 다른 파워소스 우선순위도 같이 표기
  function updateDevicesList() {
    const box = safeGetElement("connectedDevicesList");
    if (!box) return;

    const pm = window.connectedDevices?.powerMeter;
    const tr = window.connectedDevices?.trainer;
    const hr = window.connectedDevices?.heartRate;

    const active = typeof getActivePowerSource === 'function' ? getActivePowerSource() : 'none';
    const pmBadge = pm ? (active==="powermeter" ? " <span class='badge'>POWER SOURCE</span>" : "") : "";
    const trBadge = tr ? (active==="trainer" ? " <span class='badge'>POWER SOURCE</span>" : "") : "";

    box.innerHTML = `
      ${pm ? `<div class="dev">⚡ 파워미터: ${pm.name}${pmBadge}</div>` : ""}
      ${tr ? `<div class="dev">🚲 스마트 트레이너: ${tr.name}${trBadge}</div>` : ""}
      ${hr ? `<div class="dev">❤️ 심박계: ${hr.name}</div>` : ""}
    `;
     // ✅ "다음 단계로" 버튼은 항상 활성화 (기기 연결과 무관하게)
     const nextBtn = safeGetElement("btnToProfile");
     if (nextBtn) {
       nextBtn.disabled = false;
       nextBtn.removeAttribute('aria-disabled');
       nextBtn.title = '';
     }
     
  }

  // 일시정지/재개
  const btnPause = safeGetElement("btnTogglePause");
  if (btnPause) {
    btnPause.addEventListener("click", togglePause);
  }

  // 구간 건너뛰기 - 기존 코드 교체
  const btnSkipSegment = safeGetElement("btnSkipSegment");
  if (btnSkipSegment) {
    btnSkipSegment.addEventListener("click", skipCurrentSegment);
  }

  /**
   * 노트북 훈련 종료 후 "수고하셨습니다. 훈련결과" 팝업 표시 (훈련일지 이동 없음)
   * 확인 클릭 시 훈련 준비 화면으로 이동
   */
  function showLaptopTrainingResultPopup(saveResult) {
    var mileage = window.lastMileageUpdate || null;
    var earned = mileage && (mileage.earned_points != null) ? mileage.earned_points : null;
    var saveSource = saveResult?.saveResult?.source;
    var msg = '수고하셨습니다.\n훈련 결과가 저장되었습니다.';
    if (earned != null && earned > 0) {
      msg += '\n획득 포인트: ' + earned + ' P';
    }
    if (saveSource === 'local') {
      msg += '\n(서버 연결 불가로 기기에만 저장됨)';
    }

    var overlay = document.createElement('div');
    overlay.id = 'laptopTrainingResultPopupOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'laptopTrainingResultPopupTitle');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
    overlay.innerHTML = [
      '<div style="background:#fff;border-radius:16px;padding:24px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);">',
      '<h3 id="laptopTrainingResultPopupTitle" style="margin:0 0 16px;font-size:1.25rem;text-align:center;color:#333;">훈련 결과</h3>',
      '<p style="margin:0 0 20px;font-size:1rem;line-height:1.5;color:#555;white-space:pre-line;text-align:center;">' + (msg.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</p>',
      '<button type="button" id="laptopTrainingResultPopupOk" style="display:block;width:100%;padding:12px 20px;background:#2e74e8;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:bold;cursor:pointer;">확인</button>',
      '</div>'
    ].join('');

    function closeAndGoReady() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (typeof showScreen === 'function') {
        showScreen('trainingReadyScreen');
        console.log('[훈련완료] 훈련 결과 팝업 확인 → 훈련 준비 화면 전환');
      }
    }

    var btn = overlay.querySelector('#laptopTrainingResultPopupOk');
    if (btn) btn.addEventListener('click', closeAndGoReady);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeAndGoReady();
    });
    document.body.appendChild(overlay);
  }
  if (typeof window !== 'undefined') {
    window.showLaptopTrainingResultPopup = showLaptopTrainingResultPopup;
  }

  // 훈련 종료 (확인 후 종료 → 저장·포인트 적립 → 훈련결과 팝업 → 확인 시 훈련 준비 화면)
  const btnStopTraining = safeGetElement("btnStopTraining");
   if (btnStopTraining) {
     btnStopTraining.addEventListener("click", () => {
       const ok = window.confirm("정말 종료하시겠습니까?\n진행 중인 훈련이 종료됩니다.");
       if (!ok) return;

       // 확인: 종료 처리
       stopSegmentLoop();
       // 노트북 훈련 전용 화면 꺼짐 방지 해제 (모바일과 독립)
       if (typeof window.laptopTrainingWakeLockControl !== 'undefined' && window.laptopTrainingWakeLockControl.release) {
         window.laptopTrainingWakeLockControl.release();
       }

       // 노트북 훈련 문맥: 경과 시간 저장 (저장/포인트 계산에 사용, 모바일과 동일 정책)
       if (window.trainingState && window.trainingState.elapsedSec !== undefined) {
         window.lastElapsedTime = window.trainingState.elapsedSec;
         console.log('[훈련완료] 노트북 훈련 종료 시 elapsedTime 저장:', window.lastElapsedTime);
       }

       // 훈련결과 저장 중 스피너 표시 → 저장 완료 시 훈련 결과 화면 표시
       var tabletLoadingModal = document.getElementById('tabletTrainingLoadingModal');
       if (tabletLoadingModal) {
         if (tabletLoadingModal.parentNode !== document.body) document.body.appendChild(tabletLoadingModal);
         tabletLoadingModal.classList.remove('hidden');
         tabletLoadingModal.style.display = 'flex';
       }
       Promise.resolve()
         .then(function () {
           console.log('[훈련완료] 🚀 결과 저장 및 포인트 적립 시작 (노트북)');
           return (typeof window.saveLaptopTrainingResultAtEnd === 'function')
             ? window.saveLaptopTrainingResultAtEnd()
             : window.saveTrainingResultAtEnd?.();
         })
         .then(function (saveResult) {
           console.log('[훈련완료] ✅ 저장 완료:', saveResult);
           if (tabletLoadingModal) {
             tabletLoadingModal.classList.add('hidden');
             tabletLoadingModal.style.display = 'none';
           }
           if (typeof window.showMobileTrainingResultModal === 'function') {
             window.__laptopResultModalOpen = true;
             window.showMobileTrainingResultModal();
           } else if (typeof window.showLaptopTrainingResultPopup === 'function') {
             window.showLaptopTrainingResultPopup(saveResult);
           } else {
             if (typeof showToast === 'function') showToast('수고하셨습니다. 훈련 결과가 저장되었습니다.');
             if (typeof showScreen === 'function') showScreen('trainingReadyScreen');
           }
         })
         .catch(function (err) {
           console.error('[훈련완료] 💥 오류:', err);
           if (tabletLoadingModal) {
             tabletLoadingModal.classList.add('hidden');
             tabletLoadingModal.style.display = 'none';
           }
           if (typeof showToast === 'function') showToast('오류가 발생했습니다. 훈련 결과를 확인해 주세요.', 'error');
           if (typeof window.showMobileTrainingResultModal === 'function') {
             window.__laptopResultModalOpen = true;
             window.showMobileTrainingResultModal();
           } else if (typeof window.showLaptopTrainingResultPopup === 'function') {
             window.showLaptopTrainingResultPopup({ saveResult: { source: 'error' } });
           } else if (typeof showScreen === 'function') {
             showScreen('trainingReadyScreen');
           }
         });
     });
   }

  // 노트북 훈련 화면 전용 화면 꺼짐 방지 초기화 (모바일과 독립, 한 번만 호출)
  if (typeof initializeLaptopTrainingWakeLock === "function") {
    try { initializeLaptopTrainingWakeLock(); } catch (e) { console.warn("initializeLaptopTrainingWakeLock failed:", e); }
  }

  console.log("App initialization complete!");

  if (isIOS()) enableIOSMode();
  
  // 초기화 실행 (약간의 지연을 두어 DOM이 완전히 로드된 후 실행)
  setTimeout(() => {
    console.log('🔧 버튼 피드백 초기화 시작...');
    const useSound = typeof window.shouldUseSound === 'function' ? window.shouldUseSound() : false;
    const isIOS = typeof window.isIOSDevice === 'function' ? window.isIOSDevice() : false;
    const isAndroidTab = typeof window.isAndroidTablet === 'function' ? window.isAndroidTablet() : false;
  
  if (useSound) {
    const deviceType = isIOS ? 'iOS' : isAndroidTab ? 'Android 태블릿' : '기타';
    const ua = navigator.userAgent || '';
    const browserType = /CriOS/i.test(ua) ? 'Chrome' : 
                       /Safari/i.test(ua) && !/CriOS/i.test(ua) ? 'Safari' : 
                       /Firefox/i.test(ua) ? 'Firefox' : 'Chrome/기타';
    console.log(`   - ${deviceType} 기기: 예 (사운드 효과 사용)`);
    console.log(`   - 브라우저: ${browserType}`);
    console.log(`   - 사운드: Type A (Tick) - 1200Hz, sine, 0.05s`);
    console.log(`   - AudioContext 지원: ${(window.AudioContext || window.webkitAudioContext) ? '예' : '아니오'}`);
    // iOS에서는 사용자 이벤트(touchstart)에서 AudioContext 생성/활성화가 더 확실함
    // 사전 초기화는 선택사항 (사용자 이벤트에서 생성되도록 함)
    if (!isIOS && typeof window.initAudioContext === 'function') {
      // 안드로이드 태블릿은 사전 초기화 가능
      window.initAudioContext();
    } else if (isIOS) {
      console.log(`   - iOS: 사용자 터치 이벤트에서 AudioContext 활성화됨`);
    }
  } else {
    console.log(`   - 모바일 기기: 아니오 (진동 효과 사용)`);
    console.log(`   - Vibration API 지원: ${'vibrate' in navigator ? '예' : '아니오'}`);
  }
    
    // 뒤로 가기 버튼 개선 (소리 효과 제거, 클릭 인식 강화) - 먼저 처리
    if (typeof window.enhanceBackButton === 'function') {
      window.enhanceBackButton('btnBackFromMyCareer');
    } else {
      console.warn('⚠️ enhanceBackButton 함수를 찾을 수 없습니다.');
    }
    
    // 모든 버튼에 진동 피드백 적용 (뒤로 가기 버튼은 제외됨)
    if (typeof window.applyHapticFeedbackToAllButtons === 'function') {
      window.applyHapticFeedbackToAllButtons();
    } else {
      console.warn('⚠️ applyHapticFeedbackToAllButtons 함수를 찾을 수 없습니다.');
    }
    
    // 동적으로 추가되는 버튼에도 적용
    if (typeof window.setupHapticObserver === 'function') {
      window.setupHapticObserver();
    } else {
      console.warn('⚠️ setupHapticObserver 함수를 찾을 수 없습니다.');
    }
    
    console.log('✅ 버튼 피드백 초기화 완료');
  }, 100);
  
  // 화면 전환 시에도 뒤로 가기 버튼 개선 적용 (동적 화면 대응)
  // MutationObserver를 사용하여 화면이 표시될 때마다 확인
  const backButtonObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) { // Element node
          // 추가된 노드가 뒤로 가기 버튼인 경우
          if (node.id === 'btnBackFromMyCareer') {
            if (typeof window.enhanceBackButton === 'function') {
              window.enhanceBackButton(node.id);
            }
          }
          // 추가된 노드 내부의 뒤로 가기 버튼도 확인
          const backButtons = node.querySelectorAll && node.querySelectorAll('#btnBackFromMyCareer');
          if (backButtons) {
            backButtons.forEach(button => {
              if (typeof window.enhanceBackButton === 'function') {
                window.enhanceBackButton(button.id);
              }
            });
          }
        }
      });
    });
  });
  
  // body 전체를 관찰
  backButtonObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
});

// 프로필 화면 이동 & 목록 로드: 단일 핸들러(안전)
(() => {
  const btn = safeGetElement("btnToProfile");
  if (!btn) return;

  btn.addEventListener("click", () => {
    // 컨디션별 강도 보정 모달 열기
    if (typeof window.showRPEModal === "function") {
      window.showRPEModal();
    } else if (typeof showRPEModal === "function") {
      showRPEModal();
    } else {
      console.warn("[btnToProfile] showRPEModal 함수를 찾을 수 없습니다.");
    }
  });
})();

// Export
window.startWorkoutTraining = startWorkoutTraining;
window.backToWorkoutSelection = backToWorkoutSelection;

// app.js 하단에 추가
// 그룹화 기능 통합
window.initializeGroupedTimeline = function() {
  // workoutManager.js의 그룹화 함수들을 app.js에서 사용할 수 있도록 연결
  // 함수가 아직 로드되지 않았을 수 있으므로 경고는 출력하지 않음 (이미 호출부에서 안전하게 처리됨)
  
  // 타임라인 생성 시 그룹화 적용
  if (typeof buildSegmentBar === 'function') {
    buildSegmentBar();
  }
};

// 훈련 시작 시 호출
window.addEventListener('DOMContentLoaded', () => {
  // 기존 초기화 코드 후에 추가
  if (typeof window.initializeGroupedTimeline === 'function') {
    window.initializeGroupedTimeline();
  }
});

// 5. TSS/칼로리 업데이트 함수 분리
function updateTrainingMetrics() {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  try {
    const ftp = Number(window.currentUser?.ftp) || 200;
    const p = Math.max(0, Number(window.liveData?.power) || 0);

    trainingMetrics.elapsedSec += 1;
    trainingMetrics.joules += p;
    trainingMetrics.ra30 += (p - trainingMetrics.ra30) / 30;
    trainingMetrics.np4sum += Math.pow(trainingMetrics.ra30, 4);
    trainingMetrics.count += 1;

    const NP = Math.pow(trainingMetrics.np4sum / trainingMetrics.count, 0.25);
    const IF = ftp ? (NP / ftp) : 0;
    const TSS = (trainingMetrics.elapsedSec / 3600) * (IF * IF) * 100;
    
    // 사이클링 운동 변환 (인체 효율 적용)
    // 1 kJ (Work) ≈ 1 kcal (Burned)
    // trainingMetrics.joules는 총 일(Work)을 줄(J) 단위로 나타낸 것
    // 1 kJ = 1000 J이므로, kJ로 변환 후 kcal로 환산
    const totalWorkKJ = trainingMetrics.joules / 1000; // J → kJ 변환
    const kcal = totalWorkKJ; // 1 kJ (Work) ≈ 1 kcal (Burned)
    
    // 엘리트/PRO 선수 확인
    const userChallenge = String(window.currentUser?.challenge || '').trim();
    const isElite = userChallenge === 'Elite';
    const isPRO = userChallenge === 'PRO';
    
    // TSS와 칼로리는 항상 표시 (칼로리 형식: 항목, 값, 단위)
    safeSetText("tssValue", TSS.toFixed(1));
    safeSetText("kcalValue", Math.round(kcal));

    // 속도(km/h): liveData.speed — 수신 시 실시간 반영, 1초 틱에서도 표시
    var speedKmh = window.liveData && window.liveData.speed;
    if (speedKmh != null && !Number.isNaN(Number(speedKmh))) {
      safeSetText("speedValue", Number(speedKmh).toFixed(1));
    } else {
      safeSetText("speedValue", "-");
    }

    // 거리(km): 속도 적산 — 평로라 대회와 동일하게 속도(km/h)*시간으로 누적
    trainingMetrics.distanceKm = (trainingMetrics.distanceKm || 0) + (Number(window.liveData?.speed) || 0) / 3600;
    safeSetText("distanceValue", (trainingMetrics.distanceKm || 0).toFixed(2));

    // 엘리트/PRO 선수는 칼로리 밑에 NP, IF 표시
    if (isElite || isPRO) {
      // NP, IF 항목 표시
      const npMetricItem = document.getElementById('npMetricItem');
      const ifMetricItem = document.getElementById('ifMetricItem');
      if (npMetricItem) npMetricItem.style.display = 'flex';
      if (ifMetricItem) ifMetricItem.style.display = 'flex';
      
      // NP, IF 값 업데이트
      const npValueEl = document.getElementById('npValue');
      const ifValueEl = document.getElementById('ifValue');
      if (npValueEl) npValueEl.textContent = NP.toFixed(0);
      if (ifValueEl) ifValueEl.textContent = IF.toFixed(2);
      
      // 엘리트 선수 전용 메트릭을 liveData에 저장
      if (window.liveData) {
        window.liveData.np = NP;
        window.liveData.if = IF;
        window.liveData.tss = TSS;
      }
    } else {
      // 일반 사용자는 NP, IF 숨김
      const npMetricItem = document.getElementById('npMetricItem');
      const ifMetricItem = document.getElementById('ifMetricItem');
      if (npMetricItem) npMetricItem.style.display = 'none';
      if (ifMetricItem) ifMetricItem.style.display = 'none';
    }
    
  } catch (error) {
    console.error('Error in updateTrainingMetrics:', error);
  }

   appendResultStreamSamples(new Date()); // ← 매 초 스트림 누적 (결과입력_17시)

}

// 7. 전역 상태 접근을 위한 별칭 (호환성)
window.trainingState = window.trainingState || trainingState;

// 케이던스 상태 확인 함수
window.checkCadenceStatus = function() {
  console.log("=== Cadence Status Check ===");
  console.log("liveData.cadence:", window.liveData.cadence);
  console.log("cadenceValue element exists:", !!safeGetElement("cadenceValue"));
  console.log("cadenceValue current text:", safeGetElement("cadenceValue")?.textContent);
  console.log("__pmPrev state:", window.__pmPrev || "Not accessible");
  
  // 테스트용 케이던스 설정
  console.log("Testing manual cadence update...");
  window.liveData.cadence = 90;
  const el = safeGetElement("cadenceValue");
  if (el) {
    el.textContent = "90";
    console.log("Manual update successful");
  }
};

// 전역에서 __pmPrev 접근 가능하도록
window.__pmPrev = window.__pmPrev || {};

// 네온 효과 수동 테스트 함수
window.testNeonEffect = function(achievementPercent) {
  const panels = document.querySelectorAll('.enhanced-metric-panel');
  const currentPowerEl = safeGetElement("currentPowerValue");
  
  // 기존 클래스 제거
  panels.forEach(panel => {
    //panel.classList.remove('achievement-low', 'achievement-good', 'achievement-high', 'achievement-over', 'neon-active');
     panel.classList.remove('neon-active', 'achievement-bad', 'achievement-low', 'achievement-good', 'achievement-high', 'achievement-over');
  });
  
  if (currentPowerEl) {
    //currentPowerEl.classList.remove('achievement-low', 'achievement-good', 'achievement-high', 'achievement-over');
     currentPowerEl.classList.remove('achievement-bad', 'achievement-low', 'achievement-good', 'achievement-high', 'achievement-over');
  }
  
  // 테스트 클래스 적용
  let testClass = '';
  if (achievementPercent < 85) testClass = 'achievement-low';
  else if (achievementPercent <= 110) testClass = 'achievement-good';
  else if (achievementPercent <= 120) testClass = 'achievement-high';
  else testClass = 'achievement-over';
  
   // === FIX: 중앙 패널에만 네온/달성도 클래스 적용 ===
   // === 중앙 패널 1곳에만 네온/달성도 적용 ===
   const centerPanel = document.querySelector(
     '.enhanced-metric-panel.enhanced-center-panel.enhanced-main-power-display'
   );
     
   // 1) 모든 패널/파워 텍스트에서 이전 효과 제거
   //document.querySelectorAll('.enhanced-metric-panel').forEach(panel => {
     //panel.classList.remove(
       //'neon-active',
       //'achievement-low', 'achievement-good', 'achievement-high', 'achievement-over'
     //);
   //});

   // (예시) 패널 전체 순회 루틴 어딘가에 있다면:
   document.querySelectorAll('.enhanced-metric-panel').forEach(panel => {
     if (panel.id === 'userPanel') return; // 🔧 사용자 패널은 건드리지 않음 (정적 네온 유지)
     panel.classList.remove('neon-active', 'achievement-bad', 'achievement-low', 'achievement-good', 'achievement-high', 'achievement-over');
   });

   
   if (currentPowerEl) {
     currentPowerEl.classList.remove(
       'achievement-bad', 'achievement-low', 'achievement-good', 'achievement-high', 'achievement-over'
     );
   }
   
   // 2) 중앙 패널에만 새 효과 적용
   if (centerPanel && achievementClass) {
     centerPanel.classList.add('neon-active', achievementClass);
   }
   if (currentPowerEl && (achievementClass === 'achievement-good' ||
                          achievementClass === 'achievement-high' ||
                          achievementClass === 'achievement-over')) {
     currentPowerEl.classList.add(achievementClass);
   }
   
   // 3) (선택) 3초 후 “중앙 패널”만 효과 제거
   setTimeout(() => {
     if (centerPanel) centerPanel.classList.remove('neon-active', achievementClass);
     if (currentPowerEl) currentPowerEl.classList.remove(achievementClass);
   }, 3000);


  
  if (currentPowerEl) {
    currentPowerEl.classList.add(testClass);
  }
  
  console.log(`Test neon effect applied: ${testClass} (${achievementPercent}%)`);
  
  // 3초 후 효과 제거
  setTimeout(() => {
    panels.forEach(panel => {
      panel.classList.remove('neon-active', testClass);
    });
    if (currentPowerEl) {
      currentPowerEl.classList.remove(testClass);
    }
    console.log('Test neon effect removed');
  }, 3000);
};

// 전역 에러 핸들러 추가
window.addEventListener('error', function(event) {
  // JSONP 콜백 관련 오류는 조용히 무시 (이미 처리됨)
  if (event.message && typeof event.message === 'string') {
    if (event.message.includes('jsonp_callback_') && event.message.includes('is not defined')) {
      // JSONP 콜백 오류는 조용히 무시 (이미 타임아웃이나 에러 핸들링으로 처리됨)
      return;
    }
    // Script error는 일반적으로 CORS나 외부 스크립트 오류로, 상세 정보가 없음
    if (event.message === 'Script error.' && !event.filename) {
      // 상세 정보가 없는 Script error는 조용히 무시
      return;
    }
  }
  
  // 다른 오류는 정상적으로 로깅
  console.error('Global JavaScript error:', event.error);
  console.error('Error details:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack
  });
});

window.addEventListener('unhandledrejection', function(event) {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault(); // 브라우저 콘솔에 에러가 표시되는 것을 방지
});

console.log('App.js v1.3 loaded successfully with all fixes applied');



// ====== app.js 파일 끝에 추가할 디버깅 함수들 ======

// 케이던스 상태 확인 함수
window.debugCadence = function() {
  console.log("=== Cadence Debug Info ===");
  console.log("liveData.cadence:", window.liveData?.cadence);
  console.log("cadenceValue element:", document.getElementById("cadenceValue"));
  console.log("cadenceValue current text:", document.getElementById("cadenceValue")?.textContent);
  console.log("updateTrainingDisplay function exists:", typeof window.updateTrainingDisplay === "function");
  
  // 수동으로 케이던스 설정 테스트
  if (window.liveData) {
    window.liveData.cadence = 85;
    const cadenceEl = document.getElementById("cadenceValue");
    if (cadenceEl) {
      cadenceEl.textContent = "85";
      console.log("✅ Manual cadence test completed - set to 85 RPM");
    }
    
    if (typeof window.updateTrainingDisplay === "function") {
      window.updateTrainingDisplay();
      console.log("✅ updateTrainingDisplay called manually");
    }
  }
};

// 케이던스 강제 설정 함수 (테스트용)
window.setCadence = function(value) {
  if (window.liveData) {
    window.liveData.cadence = value;
    const cadenceEl = document.getElementById("cadenceValue");
    if (cadenceEl) {
      cadenceEl.textContent = value.toString();
      console.log(`✅ Cadence manually set to ${value} RPM`);
    }
    
    if (typeof window.updateTrainingDisplay === "function") {
      window.updateTrainingDisplay();
    }
  }
};

// 블루투스 상태 확인 함수
window.checkBluetoothStatus = function() {
  console.log("=== Bluetooth Status ===");
  console.log("Connected devices:", window.connectedDevices || "Not available");
  console.log("Live data:", window.liveData || "Not available");
  
  // __pmPrev 상태 확인 (bluetooth.js에서 접근 가능한 경우)
  if (typeof __pmPrev !== 'undefined') {
    console.log("Previous crank data:", __pmPrev);
  }
};


// ====== app.js 파일 끝에 추가할 고급 디버깅 함수들 ======

// 케이던스 강제 테스트
window.testCadence = function(value = 85) {
  console.log(`=== Testing Cadence with ${value} RPM ===`);
  
  // liveData 확인
  if (!window.liveData) {
    window.liveData = {};
    console.log("Created liveData object");
  }
  
  // 케이던스 설정
  window.liveData.cadence = value;
  console.log(`Set liveData.cadence to ${value}`);
  
  // UI 요소 확인 및 업데이트
  const cadenceEl = document.getElementById("cadenceValue");
  if (cadenceEl) {
    cadenceEl.textContent = value.toString();
    console.log(`✅ Updated cadenceValue element to ${value}`);
  } else {
    console.log("❌ cadenceValue element not found");
  }
  
  // updateTrainingDisplay 호출
  if (typeof window.updateTrainingDisplay === "function") {
    window.updateTrainingDisplay();
    console.log("✅ Called updateTrainingDisplay");
  } else {
    console.log("❌ updateTrainingDisplay function not found");
  }
  
  // 결과 확인
  setTimeout(() => {
    const finalEl = document.getElementById("cadenceValue");
    console.log(`Final cadenceValue content: "${finalEl?.textContent}"`);
  }, 100);
};

// 블루투스 상태 상세 확인
window.debugBluetoothState = function() {
  console.log("=== Bluetooth State Debug ===");
  console.log("Connected devices:", window.connectedDevices);
  console.log("Live data:", window.liveData);
  
  // __pmPrev 상태 확인 (전역 변수로 접근 시도)
  try {
    if (typeof __pmPrev !== 'undefined') {
      console.log("__pmPrev state:", __pmPrev);
    } else {
      console.log("__pmPrev not accessible from global scope");
    }
  } catch (e) {
    console.log("Error accessing __pmPrev:", e);
  }
  
  // UI 요소들 확인
  console.log("cadenceValue element:", document.getElementById("cadenceValue"));
  console.log("powerValue element:", document.getElementById("powerValue"));
  console.log("heartRateValue element:", document.getElementById("heartRateValue"));
};

// 케이던스 계산 시뮬레이션
window.simulateCadence = function() {
  console.log("=== Simulating Cadence Calculation ===");
  
  // 가상의 크랭크 데이터로 케이던스 계산 시뮬레이션
  const revolutions = 2; // 2회전
  const timeSeconds = 1.5; // 1.5초
  const cadence = (revolutions / timeSeconds) * 60; // RPM 계산
  
  console.log(`Simulation: ${revolutions} revs in ${timeSeconds}s = ${cadence} RPM`);
  
  if (cadence >= 30 && cadence <= 120) {
    window.liveData = window.liveData || {};
    window.liveData.cadence = Math.round(cadence);
    
    const cadenceEl = document.getElementById("cadenceValue");
    if (cadenceEl) {
      cadenceEl.textContent = Math.round(cadence).toString();
      console.log(`✅ Simulated cadence set to ${Math.round(cadence)} RPM`);
    }
  }
};

// 자동 케이던스 애니메이션 (테스트용)
window.animateCadence = function(duration = 10000) {
  console.log(`=== Starting Cadence Animation for ${duration}ms ===`);
  
  let startTime = Date.now();
  let animationId;
  
  function updateCadence() {
    const elapsed = Date.now() - startTime;
    if (elapsed > duration) {
      console.log("Animation completed");
      return;
    }
    
    // 60-100 RPM 사이에서 sine wave 패턴으로 변화
    const progress = elapsed / duration;
    const cadence = 80 + 20 * Math.sin(progress * Math.PI * 4);
    const roundedCadence = Math.round(cadence);
    
    window.liveData = window.liveData || {};
    window.liveData.cadence = roundedCadence;
    
    const cadenceEl = document.getElementById("cadenceValue");
    if (cadenceEl) {
      cadenceEl.textContent = roundedCadence.toString();
    }
    
    console.log(`Animated cadence: ${roundedCadence} RPM`);
    
    setTimeout(updateCadence, 1000); // 1초마다 업데이트
  }
  
  updateCadence();
};

// 파워미터 데이터 패킷 시뮬레이션
window.simulatePowerMeterData = function() {
  console.log("=== Simulating Power Meter Data ===");
  
  // 가상의 BLE 데이터 패킷 생성
  const flags = 0x23; // crank data present
  const power = 75; // 75W
  const revs = 1000; // 임의의 회전수
  const time = 30000; // 임의의 시간
  
  console.log(`Simulated packet - Flags: 0x${flags.toString(16)}, Power: ${power}W, Revs: ${revs}, Time: ${time}`);
  
  // 실제 handlePowerMeterData 함수가 존재한다면 호출
  if (typeof handlePowerMeterData === "function") {
    // ArrayBuffer 생성하여 시뮬레이션
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint16(0, flags, true);
    view.setInt16(2, power, true);
    view.setUint16(4, revs, true);
    view.setUint16(6, time, true);
    
    const mockEvent = {
      target: {
        value: view
      }
    };
    
    console.log("Calling handlePowerMeterData with simulated data");
    handlePowerMeterData(mockEvent);
  } else {
    console.log("❌ handlePowerMeterData function not found");
  }
};

// W/kg → 네온 등급 클래스 결정 + 사용자 패널에 적용
function updateUserPanelNeonByWkg(wkg) {
  const panel = document.querySelector('#userPanel');
  if (!panel) return;

  // 기존 제거 로직은 유지
  panel.classList.remove('neon-active','wkg-elite','wkg-advanced','wkg-intermediate','wkg-novice','wkg-beginner');

  // 🔧 여기 변경: 값이 없으면 '그냥 아무것도 붙이지 않고' return
  if (!Number.isFinite(wkg) || wkg <= 0) return;

  let tier;
  if (wkg >= 4.0)      tier = 'wkg-elite';
  else if (wkg >= 3.5) tier = 'wkg-advanced';
  else if (wkg >= 3.0) tier = 'wkg-intermediate';
  else if (wkg >= 2.2) tier = 'wkg-novice';
  else                 tier = 'wkg-beginner';

  panel.classList.add('neon-active', tier);
}




/* ========== 전화번호 인증 시스템 - 최종 통합 버전 ========== */


let currentPhoneNumber = '';
let isPhoneAuthenticated = false;
let isNewUserFormVisible = false;

// ========== 전화번호 포맷팅 및 유효성 검사 ==========

// 전화번호 포맷팅 함수 (실시간 하이픈 삽입)
function formatPhoneNumber(value) {
  const numbers = value.replace(/\D/g, '');
  const limitedNumbers = numbers.slice(0, 11);
  
  let formatted = '';
  if (limitedNumbers.length > 0) {
    if (limitedNumbers.length <= 3) {
      formatted = limitedNumbers;
    } else if (limitedNumbers.length <= 7) {
      formatted = limitedNumbers.slice(0, 3) + '-' + limitedNumbers.slice(3);
    } else {
      formatted = limitedNumbers.slice(0, 3) + '-' + limitedNumbers.slice(3, 7) + '-' + limitedNumbers.slice(7, 11);
    }
  }
  
  currentPhoneNumber = formatted;
  
  // 입력 필드 업데이트
  const phoneInput = document.getElementById('phoneInput');
  if (phoneInput && phoneInput.value !== formatted) {
    const cursorPos = phoneInput.selectionStart;
    const prevLength = phoneInput.value.length;
    
    phoneInput.value = formatted;
    
    const newLength = formatted.length;
    const lengthDiff = newLength - prevLength;
    phoneInput.setSelectionRange(cursorPos + lengthDiff, cursorPos + lengthDiff);
  }
  
  validatePhoneNumber(formatted);
  return formatted;
}

// 전화번호 유효성 검사
function validatePhoneNumber(phoneNumber) {
  const phoneInput = document.getElementById('phoneInput');
  const authBtn = document.getElementById('phoneAuthBtn');
  const authStatus = document.getElementById('phoneAuthStatus');
  
  if (!phoneInput || !authBtn) return;
  
  const isValidFormat = /^010-\d{4}-\d{4}$/.test(phoneNumber);
  
  if (phoneNumber.length === 0) {
    phoneInput.className = 'phone-input';
    authBtn.disabled = true;
    if (authStatus) authStatus.textContent = '';
  } else if (isValidFormat) {
    phoneInput.className = 'phone-input valid';
    authBtn.disabled = false;
    if (authStatus) {
      authStatus.textContent = '✓ 올바른 형식입니다';
      authStatus.className = 'auth-status success';
    }
  } else {
    phoneInput.className = 'phone-input error';
    authBtn.disabled = true;
    if (authStatus) {
      const numbers = phoneNumber.replace(/\D/g, '');
      const remaining = 11 - numbers.length;
      authStatus.textContent = `${remaining}자리 더 입력해주세요 (010-XXXX-XXXX)`;
      authStatus.className = 'auth-status error';
    }
  }
}

// 엔터키 처리
// 엔터키 처리 함수 (기존 함수 유지)
function handlePhoneKeyup(event) {
  if (event.key === 'Enter') {
    const authBtn = document.getElementById('phoneAuthBtn');
    if (authBtn && !authBtn.disabled) {
      authenticatePhone();
    }
  }
  
  if (event.key === 'Backspace' || event.key === 'Delete') {
    setTimeout(() => {
      formatPhoneNumber(event.target.value);
    }, 10);
  }
}

// 🔥 핵심: 전역 스코프에 노출 (HTML에서 호출 가능하게 만들기)
window.handlePhoneKeyup = handlePhoneKeyup;
window.formatPhoneNumber = formatPhoneNumber; // HTML에서 사용하므로 함께 노출

console.log('✅ 전화번호 관련 함수들이 전역으로 노출되었습니다');



// ========== 화면 제어 함수 ==========

// 인증 화면 완전히 숨기기 (로그인 성공 후 베이스캠프 전환 시 반투명 잔상 방지)
function hideAuthScreen() {
  const authScreen = document.getElementById('authScreen');
  if (authScreen) {
    authScreen.classList.remove('active');
    authScreen.style.setProperty('display', 'none', 'important');
    authScreen.style.setProperty('opacity', '0', 'important');
    authScreen.style.setProperty('visibility', 'hidden', 'important');
    console.log('✅ 인증 화면 즉시 숨김');
  }
}
if (typeof window !== 'undefined') window.hideAuthScreen = hideAuthScreen;

// 개선된 showScreen 함수
// 개선된 showScreen 함수
if (typeof window.originalShowScreen === 'undefined') {
   window.originalShowScreen = window.showScreen || function(screenId) {
    console.log('🔄 originalShowScreen 호출:', screenId);
    
    // 모든 화면 완전히 숨기기
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
      screen.style.display = 'none';
      screen.style.opacity = '0';
      screen.style.visibility = 'hidden';
    });
    
    // 선택된 화면 완전히 표시 (진단 코드 추가됨)
    console.log(`🔵 [Step 2] 화면 요소 검색 시작: '${screenId}'`);
    const targetScreen = document.getElementById(screenId);
    
    // [진단 로그 1] 화면 요소 탐색 결과 확인
    console.log(`🔵 [Step 2-1] ID 찾기 시도: '${screenId}' -> 결과: ${targetScreen ? '✅ 발견됨' : '❌ NULL (없음)'}`);
    
    if (targetScreen) {
      console.log(`🔵 [Step 2-2] 화면 요소 발견, 스타일 적용 시작...`);
      // [진단 로그 1-1] 요소 발견 시 상세 정보
      console.log(`🔎 [진단] 발견된 요소 상세:`, {
        id: targetScreen.id,
        tagName: targetScreen.tagName,
        className: targetScreen.className,
        currentDisplay: window.getComputedStyle(targetScreen).display,
        currentVisibility: window.getComputedStyle(targetScreen).visibility
      });
      
      targetScreen.classList.add('active');
      
      // connectionScreen 특별 처리
      if (screenId === 'connectionScreen') {
        targetScreen.style.cssText = 'display: block !important; opacity: 1 !important; visibility: visible !important; z-index: 1000 !important; min-height: 100vh !important; min-height: 100dvh !important; min-height: -webkit-fill-available !important; min-height: calc(100vh + env(safe-area-inset-bottom, 0px)) !important; background: #f6f8fa !important; padding: 20px 20px 0 20px !important;';
        console.log('🔗 connectionScreen 특별 처리 적용');
      } else {
        targetScreen.style.display = 'block';
        targetScreen.style.opacity = '1';
        targetScreen.style.visibility = 'visible';
        targetScreen.style.zIndex = '1000';
      }
      
      console.log(`🔵 [Step 2-3] 화면 전환 완료: ${screenId}`);
      
      // [진단 로그 2] 초기화 함수 호출 직전
      console.log(`🔵 [Step 2-4] initializeCurrentScreen('${screenId}') 호출 시작`);
      console.log(`🔵 [Step 2-5] initializeCurrentScreen 함수 존재 여부: ${typeof initializeCurrentScreen === 'function' ? '✅ 있음' : '❌ 없음'}`);
      
      // 화면별 초기화
      if (typeof initializeCurrentScreen === 'function') {
        try {
          console.log(`🔵 [Step 2-6] initializeCurrentScreen 실행 중...`);
          initializeCurrentScreen(screenId);
          console.log(`🔵 [Step 2-7] ✅ initializeCurrentScreen('${screenId}') 호출 완료 (에러 없음)`);
        } catch (error) {
          console.error(`🔵 [Step 2-Error] 💥 initializeCurrentScreen 실행 중 오류 발생:`, error);
          console.error(`🔵 [Step 2-Error] 에러 스택:`, error.stack);
        }
      } else {
        console.error(`🔵 [Step 2-Error] 💥 initializeCurrentScreen 함수가 정의되지 않았습니다!`);
      }
    } else {
      // [진단 로그 3] 치명적 오류 발견
      console.error(`🚨 [Critical Error] HTML에서 id="${screenId}" 요소를 찾을 수 없습니다!`);
      console.error(`👉 해결책: index.html 파일에 <div id="${screenId}"> 태그가 있는지 확인하세요.`);
      
      // 모든 .screen 요소 확인 (디버깅용)
      const allScreens = document.querySelectorAll('.screen');
      console.error(`🔍 [진단] 현재 페이지의 모든 .screen 요소:`, Array.from(allScreens).map(el => ({
        id: el.id,
        tagName: el.tagName,
        display: window.getComputedStyle(el).display
      })));
      
      // 개발자용 강제 알림
      if (screenId === 'bluetoothTrainingCoachScreen') {
        alert(`[오류] index.html에 #${screenId} 요소가 없습니다.\nID 철자를 확인하세요.\n\n현재 페이지의 .screen 요소 ID 목록을 콘솔에서 확인하세요.`);
      }
    }
  };
}

window.showScreen = function(screenId) {
  console.log(`🔵 [Step 1] showScreen 함수 진입: '${screenId}'`);
  // TOP10 등 "인증 후에만 노출" 로직용: 리다이렉트 여부 플래그 (index.html 래퍼에서 사용)
  window.__showScreenRedirectedToAuth = false;

  // Firebase 인증 상태 확인 (우선순위: Firebase Auth > 전화번호 인증)
  const isFirebaseAuthenticated = (window.auth?.currentUser != null || window.authV9?.currentUser != null) || window.currentUser != null;
  const phoneAuth = window.isPhoneAuthenticated === true || isPhoneAuthenticated;
  const isAuthenticated = isFirebaseAuthenticated || phoneAuth;

  console.log('🔵 [Step 1-1] 화면 전환 요청:', screenId, '인증 상태:', isAuthenticated, '(Firebase:', isFirebaseAuthenticated, ', Phone:', phoneAuth, ')');

  // 환영 오버레이가 표시되어 있으면 화면 전환 차단
  const welcomeModal = document.getElementById('userWelcomeModal');
  const isWelcomeModalActive = welcomeModal &&
                               !welcomeModal.classList.contains('hidden') &&
                               window.getComputedStyle(welcomeModal).display !== 'none' &&
                               window.userWelcomeModalShown === true;

  if (isWelcomeModalActive) {
    console.log('⏸️ 환영 오버레이 활성화 중 - 화면 전환 차단:', screenId);
    return; // 화면 전환 자체를 차단
  }

  // 인증이 안 된 상태에서 다른 화면으로 가려고 하면 인증 화면으로 리다이렉트 (태블릿 등에서 TOP10 인증 전 노출 방지)
  if (!isAuthenticated && screenId !== 'authScreen' && screenId !== 'loadingScreen' && screenId !== 'splashScreen') {
    console.log('⚠️ 인증되지 않은 상태 - 인증 화면으로 리다이렉트');
    window.__showScreenRedirectedToAuth = true;
    screenId = 'authScreen';
  }
  
  // 훈련일지 화면을 나갈 때 fetch 카운트/플래그 초기화 (다음에 훈련일지 열 때 로딩 재시도 가능)
  var currentActive = document.querySelector('.screen.active');
  if (currentActive && currentActive.id === 'trainingJournalScreen' && screenId !== 'trainingJournalScreen') {
    if (typeof window !== 'undefined') {
      window.__journalFetchCallCount = 0;
      window.__journalFetchInProgress = false;
    }
    console.log('[훈련일지] 화면 이탈 - fetch 카운트/플래그 초기화');
  }
  // 통합 블루투스 개인훈련 화면 이탈 시 화면 꺼짐 방지 해제 (모바일 대시보드와 동일)
  if (currentActive && currentActive.id === 'bluetoothIndividualScreen' && screenId !== 'bluetoothIndividualScreen') {
    if (typeof window.wakeLockControl !== 'undefined' && typeof window.wakeLockControl.release === 'function') {
      window.wakeLockControl.release();
    }
  }
  
  // 모든 화면 숨기기 (스플래시 화면 제외)
  document.querySelectorAll('.screen').forEach(screen => {
    if (screen.id !== 'splashScreen') {
    screen.classList.remove('active');
    screen.style.display = 'none';
    screen.style.opacity = '0';
    screen.style.visibility = 'hidden';
    }
  });
  // 선택된 화면만 표시
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    // flex 레이아웃이 필요한 화면 (Coach 대시보드, 모바일 대시보드, 워크아웃 화면)
    const flexScreens = ['mobileDashboardScreen', 'workoutScreen', 'bluetoothTrainingCoachScreen'];
    targetScreen.style.display = flexScreens.includes(screenId) ? 'flex' : 'block';
    targetScreen.classList.add('active');
    targetScreen.style.opacity = '1';
    targetScreen.style.visibility = 'visible';

    // bluetoothTrainingCoachScreen: 고정 위치·z-index로 화면 전체 덮기 (흰 화면 방지)
    if (screenId === 'bluetoothTrainingCoachScreen') {
      targetScreen.style.position = 'fixed';
      targetScreen.style.top = '0';
      targetScreen.style.left = '0';
      targetScreen.style.right = '0';
      targetScreen.style.bottom = '0';
      targetScreen.style.zIndex = '100';
      targetScreen.style.width = '100%';
      targetScreen.style.height = '100%';
      targetScreen.style.background = '#0a0e27';
    }

    initializeCurrentScreen(screenId);
  }
};

// 화면별 초기화 함수
function initializeCurrentScreen(screenId) {
  // [진단 1] 들어온 ID가 정확한지 공백/철자 확인
  console.log(`🟢 [Step 3] initializeCurrentScreen 함수 진입: '${screenId}' (길이: ${screenId ? screenId.length : 0}, 타입: ${typeof screenId})`);
  
  switch(screenId) {
    case 'authScreen':
      setTimeout(() => {
        const phoneInput = document.getElementById('phoneInput');
        if (phoneInput) {
          phoneInput.focus();
        }
      }, 300);
      break;
      
    case 'basecampScreen':
      if (typeof window.checkFtpSuggestionAndShow === 'function') {
        setTimeout(function () { window.checkFtpSuggestionAndShow(); }, 1500);
      }
      break;

    case 'connectionScreen':
      console.log('기기 연결 화면 초기화');
      // ANT+ 버튼 비활성화 (클릭 기능 제거)
      setTimeout(() => {
        const btnANT = safeGetElement("btnConnectANT");
        if (btnANT) {
          btnANT.disabled = true;
          btnANT.classList.add('is-disabled');
          btnANT.setAttribute('aria-disabled', 'true');
          btnANT.title = '';
          btnANT.style.opacity = '0.6';
          btnANT.style.cursor = 'default';
          btnANT.style.pointerEvents = 'none';
        }
      }, 100);
      break;

    case 'deviceSettingScreen':
      // 센서 연결 화면: 저장된 기기로 카드 상태 갱신 (deviceSettings.js)
      if (window.StelvioDeviceSettings && typeof window.StelvioDeviceSettings.refreshDeviceSettingCards === 'function') {
        window.StelvioDeviceSettings.refreshDeviceSettingCards();
      }
      break;

    case 'trainingScreen':
    case 'mobileDashboardScreen':
    case 'bluetoothTrainingCoachScreen':
      // 훈련 대시보드 브릿지: AUTO_CONNECT + deviceError/deviceConnected 리스너 (trainingDashboardBridge.js)
      if (window.StelvioTrainingDashboardBridge && typeof window.StelvioTrainingDashboardBridge.mount === 'function') {
        window.StelvioTrainingDashboardBridge.mount();
      }
      // 모바일 훈련화면: TARGET 라벨 폰트·위치 고정 (초기 로딩 시 적용)
      if (screenId === 'mobileDashboardScreen') {
        setTimeout(function () {
          var el = document.getElementById('mobile-ui-target-label');
          if (el) { el.setAttribute('font-size', '6'); el.setAttribute('y', '93'); }
        }, 0);
      }
      break;

    case 'bluetoothIndividualScreen':
      // 통합 블루투스 개인훈련 화면: 연결 버튼 드롭다운·Firebase 리스너·화면 꺼짐 방지 등 초기화
      if (typeof window.initBluetoothIndividualIntegratedScreen === 'function') {
        window.initBluetoothIndividualIntegratedScreen();
      }
      // TARGET 라벨 폰트·위치 고정 (초기 로딩 시 적용)
      setTimeout(function () {
        var el = document.getElementById('indiv-ui-target-label');
        if (el) { el.setAttribute('font-size', '6'); el.setAttribute('y', '93'); }
      }, 0);
      // 화면 복귀 시 이미 훈련 중이면 화면 꺼짐 방지 재요청 (모바일 대시보드와 동일)
      setTimeout(function () {
        var s = window.currentTrainingState;
        if ((s === 'running' || s === 'countdown') && typeof window.wakeLockControl !== 'undefined' && window.wakeLockControl.request) {
          window.wakeLockControl.request();
        }
      }, 400);
      break;
      
    case 'aiScheduleScreen':
      // AI 훈련 스케줄 화면: Firebase RTDB 스케줄 로드
      if (typeof window.loadAIScheduleScreen === 'function') {
        setTimeout(window.loadAIScheduleScreen, 100);
      }
      break;
      
    case 'scheduleListScreen':
      // 훈련 스케줄 목록 화면: 스케줄 목록 자동 로드
      // 함수가 로드될 때까지 재시도
      let retryCount = 0;
      const maxRetries = 10;
      const checkAndLoad = () => {
        if (typeof window.loadTrainingSchedules === 'function') {
          console.log('스케줄 목록 화면 진입 - 자동 로딩 시작');
          window.loadTrainingSchedules();
        } else if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(checkAndLoad, 100);
        } else {
          console.error('loadTrainingSchedules function not available after retries');
        }
      };
      setTimeout(checkAndLoad, 100);
      break;
      
      case 'trainingJournalScreen':
      // 훈련일지 화면: 이전 실패 상태 초기화 후 미니 달력 로드
      console.log('[Journal Init] ========== trainingJournalScreen 케이스 진입 ==========');
      if (typeof window !== 'undefined') {
        window.__journalInitInProgress = false;
        window.__journalFetchInProgress = false;
        window.__journalFetchCallCount = 0;
      }
      (function setJournalSubtitle(t) {
        if (typeof window.updateJournalSubtitle === 'function') window.updateJournalSubtitle(t);
        else { var el = document.getElementById('journalSubtitleCount'); if (el) el.textContent = t || '( )'; }
      })('( )');
      // 로딩 중 문구 제거 (오버레이 스피너로 대체)
      var journalGrid = document.getElementById('miniCalendarGridJournal');
      if (journalGrid) {
        journalGrid.innerHTML = ''; // 로딩 메시지 제거
      }
      console.log('훈련일지 화면 진입 - 미니 달력 로딩 시작');
      console.log('initMiniCalendarJournal 함수 확인:', typeof window.initMiniCalendarJournal);
      console.log('getUserTrainingLogs 함수 확인:', typeof window.getUserTrainingLogs);
      console.log('getTrainingLogsByDateRange 함수 확인:', typeof window.getTrainingLogsByDateRange);

      const checkAndInit = (retryCount = 0) => {
        console.log(`[Journal Init] checkAndInit 호출 (retryCount: ${retryCount})`);
        if (typeof window.initMiniCalendarJournal === 'function') {
          console.log('[Journal Init] ✅ initMiniCalendarJournal 함수 발견');
          const currentUser = window.currentUser || (function() { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; } })();
          // Firebase Auth 사용자는 .uid만 가질 수 있음 → .id || .uid 사용. 없으면 authV9/compat currentUser에서 조회
          let userId = (currentUser && (currentUser.id != null ? currentUser.id : currentUser.uid)) || null;
          // 🔒 보안: window.currentUser를 우선 사용 (authV9는 이전 사용자 상태를 유지할 수 있음)
          var primaryUserId = null;
          if (currentUser && (currentUser.id || currentUser.uid)) {
            primaryUserId = currentUser.id || currentUser.uid;
          }
          
          if (!userId) {
            // window.currentUser 우선 사용
            if (primaryUserId) {
              userId = primaryUserId;
            } else if (typeof window.getCurrentUserForTrainingRooms === 'function') {
              var liveAuth = window.getCurrentUserForTrainingRooms();
              if (liveAuth) userId = liveAuth.uid != null ? liveAuth.uid : liveAuth.id;
            }
          }
          
          console.log('현재 사용자 정보:', { 
            userId, 
            primaryUserId,
            hasCurrentUser: !!currentUser, 
            userName: currentUser?.name,
            currentUserId: currentUser?.id || currentUser?.uid
          });
          
          if (userId) {
            (async function runJournalInit() {
              var jStep = window.setJournalLoadStatus;
              var jShow = window.showJournalLoadStatusBox;
              var jClear = window.clearJournalLoadStatus;
              if (jShow) jShow();
              if (jClear) jClear();
              if (jStep) jStep('0. 훈련일지 로드 시작 (userId: ' + (userId || '').slice(0, 8) + '...)', false);
              if (typeof window !== 'undefined') {
                window.__journalFetchCallCount = 0;
                window.__journalInitInProgress = false;
              }
              const isTablet = typeof window.isTabletOrSlowDeviceForAuth === 'function' && window.isTabletOrSlowDeviceForAuth();
              // 🔒 보안: window.currentUser를 우선 사용
              var journalUserId = primaryUserId || userId;
              try {
                if (jStep) jStep('1. Auth 대기 중... (최대 ' + (isTablet ? 12 : 5) + '초)', false);
                if (typeof window.waitForAuthReady === 'function') {
                  await window.waitForAuthReady(isTablet ? 12000 : 5000);
                }
                if (jStep) jStep('1. Auth 대기 완료', false);
                if (jStep) jStep('2. Firestore V9 대기 중... (최대 ' + (isTablet ? 18 : 6) + '초)', false);
                if (typeof window.ensureFirestoreV9ReadyForJournal === 'function') {
                  await window.ensureFirestoreV9ReadyForJournal(isTablet ? 18000 : 6000);
                }
                if (jStep) jStep('2. Firestore V9 대기 완료', false);
                
                // 🔒 보안: authV9와 window.currentUser 비교
                var authV9UserId = null;
                if (isTablet && typeof window.waitForAuthV9UserForJournal === 'function') {
                  if (jStep) jStep('3. authV9 사용자 대기 중... (최대 15초, 삼성 태블릿)', false);
                  var authV9Result = await window.waitForAuthV9UserForJournal(15000);
                  if (authV9Result && authV9Result.uid) {
                    authV9UserId = authV9Result.uid;
                    // 🔒 보안: window.currentUser와 불일치 시 window.currentUser 우선 사용
                    if (primaryUserId && primaryUserId !== authV9UserId) {
                      console.warn('[Journal Init] ⚠️ 사용자 불일치 감지! window.currentUser를 우선 사용:', {
                        windowCurrentUserId: primaryUserId,
                        authV9UserId: authV9UserId,
                        userName: currentUser?.name || '알 수 없음'
                      });
                      journalUserId = primaryUserId;
                      if (jStep) jStep('3. authV9 불일치 - window.currentUser 사용', false);
                    } else {
                      journalUserId = authV9UserId;
                      if (jStep) jStep('3. authV9 사용자 확인 (uid 사용)', false);
                    }
                  } else {
                    if (jStep) jStep('3. authV9 사용자 대기 타임아웃 (기존 userId 사용)', true);
                  }
                }
                
                // 🔒 보안: getCurrentUserForTrainingRooms도 확인하되, window.currentUser와 불일치 시 무시
                var liveUser = typeof window.getCurrentUserForTrainingRooms === 'function' ? window.getCurrentUserForTrainingRooms() : null;
                if (liveUser) {
                  var uid = liveUser.uid != null ? liveUser.uid : liveUser.id;
                  if (uid) {
                    // window.currentUser와 불일치 시 무시
                    if (primaryUserId && primaryUserId !== uid) {
                      console.warn('[Journal Init] ⚠️ getCurrentUserForTrainingRooms 불일치! window.currentUser 우선 사용:', {
                        windowCurrentUserId: primaryUserId,
                        getCurrentUserForTrainingRoomsUserId: uid
                      });
                    } else if (!primaryUserId) {
                      journalUserId = uid;
                    }
                  }
                }
                if (jStep) jStep('4. getUserTrainingLogs 모듈 대기 중...', false);
                var modulePollMs = isTablet ? 10000 : 6000;
                var moduleStart = Date.now();
                while (typeof window.getUserTrainingLogs !== 'function' && (Date.now() - moduleStart) < modulePollMs) {
                  await new Promise(function(r) { setTimeout(r, 200); });
                }
                if (typeof window.getUserTrainingLogs === 'function') {
                  if (jStep) jStep('4. getUserTrainingLogs 모듈 로드 완료', false);
                } else {
                  if (jStep) jStep('4. getUserTrainingLogs 미로드 → 인라인 폴백 예정', true);
                }
                if (isTablet) {
                  if (jStep) jStep('4-2. 태블릿: 쿼리 전 2초 대기 (인증 안정화)', false);
                  await new Promise(function(r) { setTimeout(r, 2000); });
                }
              } catch (e) {
                if (jStep) jStep('오류 (진입 단계): ' + (e && e.message ? e.message : String(e)), true);
                console.warn('[Journal] Auth/Firestore wait failed', e);
              }
              var initDelay = isTablet ? 500 : 100;
              setTimeout(function() {
                if (jStep) jStep('5. initMiniCalendarJournal 호출 (지연 ' + initDelay + 'ms)', false);
                console.log('[Journal Init] initMiniCalendarJournal 호출 시도 - userId:', journalUserId);
                console.log('[Journal Init] getTrainingLogsByDateRange 함수 확인:', typeof window.getTrainingLogsByDateRange);
                try {
                  window.initMiniCalendarJournal(journalUserId);
                  console.log('[Journal Init] ✅ initMiniCalendarJournal 호출 완료');
                } catch (initError) {
                  console.error('[Journal Init] ❌ initMiniCalendarJournal 호출 실패:', initError);
                  if (jStep) jStep('5. 오류: ' + (initError.message || String(initError)), true);
                }
              }, initDelay);
            })();
          } else {
            console.warn('훈련일지: 사용자 ID를 찾을 수 없습니다.');
            console.warn('currentUser:', currentUser);
            console.warn('localStorage currentUser:', localStorage.getItem('currentUser'));
            (function(t){ if(typeof window.updateJournalSubtitle==='function') window.updateJournalSubtitle(t); else { var e=document.getElementById('journalSubtitleCount'); if(e) e.textContent=t||'( )'; } })('(로그인 필요)');
            if (typeof window.setJournalLoadStatus === 'function') window.setJournalLoadStatus('0. 오류: 사용자 ID 없음', true);
            try {
              window.__journalLoadFailed = true;
              window.__journalLoadErrorMsg = '로그인 상태를 확인해 주세요. 다시 로그인 후 훈련일지를 열어 주세요.';
              var area = document.getElementById('journalRetryArea');
              var msgEl = document.getElementById('journalRetryMsg');
              var stepEl = document.getElementById('journalRetryStep');
              if (area) area.style.display = 'block';
              if (msgEl) msgEl.textContent = window.__journalLoadErrorMsg;
              if (stepEl) stepEl.textContent = '실패 단계: 0. 오류: 사용자 ID 없음';
            } catch (e) {}
          }
        } else if (retryCount < 20) {
          console.log(`[Journal Init] initMiniCalendarJournal 대기 중... (${retryCount + 1}/20)`);
          setTimeout(() => checkAndInit(retryCount + 1), 100);
        } else {
          console.error('[Journal Init] ❌ initMiniCalendarJournal function not available after 2 seconds');
          console.error('window.initMiniCalendarJournal:', window.initMiniCalendarJournal);
          console.error('사용 가능한 window 함수들:', Object.keys(window).filter(k => k.includes('Calendar')));
          (function(t){ if(typeof window.updateJournalSubtitle==='function') window.updateJournalSubtitle(t); else { var e=document.getElementById('journalSubtitleCount'); if(e) e.textContent=t||'( )'; } })('(초기화 실패)');
          if (typeof window.setJournalLoadStatus === 'function') window.setJournalLoadStatus('0. 오류: 초기화 함수 미로드', true);
          try {
            window.__journalLoadFailed = true;
            window.__journalLoadErrorMsg = '훈련일지 초기화를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.';
            var area = document.getElementById('journalRetryArea');
            var msgEl = document.getElementById('journalRetryMsg');
            if (area) area.style.display = 'block';
            if (msgEl) msgEl.textContent = window.__journalLoadErrorMsg;
          } catch (e) {}
        }
      };

      checkAndInit();
      setTimeout(function () {
        if (typeof window.initMiniCalendarJournal !== 'function') checkAndInit(0);
      }, 250);
      break;

    case 'performanceDashboardScreen': {
      // 스크롤 상단 고정 (모바일 하단 배치 문제 해결)
      try {
        var pdContainer = document.getElementById('performance-dashboard-container');
        if (pdContainer) { pdContainer.scrollTop = 0; pdContainer.scrollTo(0, 0); }
      } catch (e) {}
      // 대시보드는 index.html에 통합(No Iframe). performanceDashboard.html 삭제됨 — initPerformanceDashboard가 #dashboard-root에 React 렌더
      const iframe = document.getElementById('performanceDashboardFrame');
      const cu = window.currentUser || null;
      const uid = (cu && cu.id) ? String(cu.id) : '';
      if (iframe) {
        const base = 'performanceDashboard.html';
        const src = uid ? (base + '?userId=' + encodeURIComponent(uid)) : base;
        const userToSend = cu;
        
        // 인증 토큰 가져오기 (iframe에서 인증 상태 복원용)
        var authToken = null;
        if (window.auth && window.auth.currentUser) {
          window.auth.currentUser.getIdToken(false).then(function(token) {
            authToken = token;
            // iframe이 이미 로드되었을 수 있으므로 즉시 전송
            if (iframe.contentWindow) {
              try {
                iframe.contentWindow.postMessage({ 
                  type: 'DASHBOARD_AUTH_TOKEN', 
                  token: token,
                  user: userToSend 
                }, '*');
              } catch (e) {
                console.warn('[Dashboard] 인증 토큰 전송 실패:', e);
              }
            }
          }).catch(function(e) {
            console.warn('[Dashboard] 인증 토큰 가져오기 실패:', e);
          });
        }
        
        iframe.onload = function () {
          try {
            if (userToSend && iframe.contentWindow) {
              iframe.contentWindow.postMessage({ type: 'DASHBOARD_USER', user: userToSend }, '*');
              // 인증 토큰도 전송
              if (authToken) {
                iframe.contentWindow.postMessage({ 
                  type: 'DASHBOARD_AUTH_TOKEN', 
                  token: authToken,
                  user: userToSend 
                }, '*');
              } else if (window.auth && window.auth.currentUser) {
                // onload 시점에 다시 토큰 가져오기 시도
                window.auth.currentUser.getIdToken(false).then(function(token) {
                  if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage({ 
                      type: 'DASHBOARD_AUTH_TOKEN', 
                      token: token,
                      user: userToSend 
                    }, '*');
                  }
                }).catch(function(e) {
                  console.warn('[Dashboard] onload 인증 토큰 가져오기 실패:', e);
                });
              }
            }
          } catch (e) {
            console.warn('[Dashboard] postMessage 실패:', e);
          }
        };
        iframe.src = src;
      }
      break;
    }

    case 'bluetoothTrainingCoachScreen':
      console.log('🟢 [Step 3-1] Switch Case 진입 성공! (ID 일치함)');
      
      // [진단 2] 함수가 메모리에 로드되어 있는지 확인
      console.log(`🟢 [Step 3-2] window.initBluetoothCoachDashboard 타입: ${typeof window.initBluetoothCoachDashboard}`);
      console.log(`🟢 [Step 3-3] window.bluetoothCoachState 존재 여부: ${window.bluetoothCoachState ? '✅ 있음' : '❌ 없음'}`);

      // 1. [강제 청소] 기존 Firebase 구독 및 상태 초기화 (메모리 누수 방지)
      if (window.bluetoothCoachState) {
          console.log('🟢 [Step 3-4] 기존 상태 정리 시작...');
          // Firebase 구독 해제
          if (window.bluetoothCoachState.firebaseSubscriptions) {
              Object.entries(window.bluetoothCoachState.firebaseSubscriptions).forEach(([key, unsubscribe]) => {
                  if (typeof unsubscribe === 'function') {
                      try { unsubscribe(); console.log(`🧹 구독 해제: ${key}`); } catch(e) {}
                  }
              });
              window.bluetoothCoachState.firebaseSubscriptions = {};
          }
          // 주요 상태 리셋
          window.bluetoothCoachState.powerMeters = [];
          window.bluetoothCoachState.trainingState = 'idle';
          window.bluetoothCoachState.countdownTriggered = [];
          console.log('🟢 [Step 3-5] ✅ 상태 정리 완료');
      } else {
          console.warn('🟢 [Step 3-4] ⚠️ window.bluetoothCoachState가 없습니다. 초기화가 필요할 수 있습니다.');
      }

      // 2. [DOM 렌더링 대기]
      console.log('🟢 [Step 3-6] ⏳ setTimeout 시작 (150ms 대기)...');
      setTimeout(() => {
        console.log('🟢 [Step 3-7] ⏰ setTimeout 콜백 실행됨');
        
        const el = document.getElementById('bluetoothCoachPowerMeterGrid');
        // [진단 3] HTML 요소가 존재하는지 확인
        console.log(`🟢 [Step 3-8] HTML 요소(#bluetoothCoachPowerMeterGrid) 발견 여부: ${el ? '✅ 있음' : '❌ 없음'}`);
        
        if (el) {
          const computedStyle = window.getComputedStyle(el);
          console.log(`🟢 [Step 3-9] 요소 스타일 상태:`, {
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity
          });
        }

        // 3. [초기화 실행]
        console.log(`🟢 [Step 3-10] initBluetoothCoachDashboard 함수 확인: ${typeof window.initBluetoothCoachDashboard}`);
        if (typeof window.initBluetoothCoachDashboard === 'function') {
          console.log('🟢 [Step 3-11] 🚀 초기화 함수 실행 시도...');
          try {
            window.initBluetoothCoachDashboard();
            console.log('🟢 [Step 3-12] ✅ initBluetoothCoachDashboard 호출 완료 (에러 없음)');
          } catch (error) {
            console.error('🟢 [Step 3-Error] 💥 initBluetoothCoachDashboard 실행 중 오류:', error);
            console.error('🟢 [Step 3-Error] 에러 스택:', error.stack);
          }
        } else {
          console.error('🟢 [Step 3-Error] 💥 초기화 함수가 없습니다! 스크립트 로드 실패 의심.');
          console.error('🟢 [Step 3-Error] 현재 window 객체 상태:', {
            initBluetoothCoachDashboard: typeof window.initBluetoothCoachDashboard,
            bluetoothCoachState: typeof window.bluetoothCoachState,
            bluetoothCoachDashboard: typeof window.bluetoothCoachDashboard
          });
        }
      }, 150);
      console.log('🟢 [Step 3-13] setTimeout 등록 완료, break 실행');
      break;
      
    default:
      console.log('기타 화면 초기화:', screenId);
  }
}

// ========== 일별 TSS 산출 규칙 (사용자 대시보드 AI 분석·모든 데이터 산출 기준) ==========
// 같은 날 Strava 있으면 Strava만 합산, Strava 없으면 Stelvio만 사용. 같은 날 두 종류 있으면 Stelvio 제외.
function buildHistoryWithTSSRuleByDate(logs) {
  if (!logs || !logs.length) return [];
  function getDateStr(log) {
    var dateStr = '';
    if (log.completed_at) {
      var d = typeof log.completed_at === 'string' ? new Date(log.completed_at) : log.completed_at;
      dateStr = d && d.toISOString ? d.toISOString().split('T')[0] : String(log.completed_at).split('T')[0];
    } else if (log.date) {
      var d2 = log.date;
      if (d2 && typeof d2.toDate === 'function') d2 = d2.toDate();
      dateStr = d2 && d2.toISOString ? d2.toISOString().split('T')[0] : String(d2 || '').split('T')[0];
    }
    return dateStr;
  }
  var byDate = {};
  for (var i = 0; i < logs.length; i++) {
    var log = logs[i];
    var dateStr = getDateStr(log);
    if (!dateStr) continue;
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push(log);
  }
  var result = [];
  var dates = Object.keys(byDate).sort();
  for (var j = 0; j < dates.length; j++) {
    var dateStr = dates[j];
    var arr = byDate[dateStr];
    var stravaLogs = arr.filter(function (l) { return String(l.source || '').toLowerCase() === 'strava'; });
    var stelvioLogs = arr.filter(function (l) { return String(l.source || '').toLowerCase() !== 'strava'; });
    var useStrava = stravaLogs.length > 0;
    var chosen = useStrava ? stravaLogs : stelvioLogs;
    if (chosen.length === 0) continue;
    var tssSum = chosen.reduce(function (s, l) { return s + (Number(l.tss) || 0); }, 0);
    var durationSum = chosen.reduce(function (s, l) { return s + (Number(l.duration_min) || 0); }, 0);
    var first = chosen[0];
    result.push({
      date: dateStr,
      completed_at: dateStr + 'T12:00:00.000Z',
      workout_name: first.workout_name || first.title || '훈련',
      duration_min: Math.round(durationSum),
      duration_sec: Math.round(durationSum) * 60,
      avg_power: Math.round(first.avg_power || first.avg_watts || 0),
      np: Math.round(first.np || first.weighted_watts || first.avg_power || first.avg_watts || 0),
      tss: Math.round(tssSum),
      hr_avg: Math.round(first.hr_avg || first.avg_hr || 0),
      source: first.source || (useStrava ? 'strava' : '')
    });
  }
  return result;
}
window.buildHistoryWithTSSRuleByDate = buildHistoryWithTSSRuleByDate;

// ========== 일별 1건(strava 우선) 폴백 — conditionScoreModule 미로드 시에도 훈련 횟수 정확도 보정 ==========
// 일별 훈련 로그 중 복수개 존재 시 source: "strava" 로그 1개만 분석 대상 (워크아웃 추천·대시보드 공통)
function oneLogPerDayPreferStravaFallback(logs) {
  if (!logs || !logs.length) return [];
  function getDateStr(log) {
    var dateStr = '';
    if (log.completed_at) {
      var d = typeof log.completed_at === 'string' ? new Date(log.completed_at) : log.completed_at;
      dateStr = d && d.toISOString ? d.toISOString().split('T')[0] : String(log.completed_at).split('T')[0];
    } else if (log.date) {
      var d2 = log.date;
      if (d2 && typeof d2.toDate === 'function') d2 = d2.toDate();
      dateStr = d2 && d2.toISOString ? d2.toISOString().split('T')[0] : String(d2 || '').split('T')[0];
    }
    return dateStr;
  }
  var byDate = {};
  for (var i = 0; i < logs.length; i++) {
    var log = logs[i];
    var dateStr = getDateStr(log);
    if (!dateStr) continue;
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push(log);
  }
  var result = [];
  var dates = Object.keys(byDate).sort();
  for (var j = 0; j < dates.length; j++) {
    var arr = byDate[dates[j]];
    var stravaLogs = arr.filter(function (l) { return String(l.source || '').toLowerCase() === 'strava'; });
    var chosen = stravaLogs.length > 0 ? stravaLogs[0] : arr[0];
    result.push(chosen);
  }
  return result;
}

// ========== Data Proxy Fallback: 대시보드(iframe) 로그 요청 처리 ==========
(function initDashboardLogsProxy() {
  window.isSensorConnected = window.isSensorConnected || false;

  function sendToIframes(payload) {
    try {
      var iframes = document.querySelectorAll('iframe');
      iframes.forEach(function(iframe) {
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage(payload, '*');
        }
      });
    } catch (err) {
      console.warn('[MainApp] iframe postMessage 실패:', err);
    }
  }

  window.addEventListener('message', async function(e) {
    if (!e.data || !e.data.type) return;

    // REQUEST_STATUS: AI 연결 상태만 전달
    if (e.data.type === 'REQUEST_STATUS') {
      sendToIframes({
        type: 'AI_CONNECTION_STATUS',
        isConnected: !!window.isSensorConnected
      });
      return;
    }

    if (e.data.type !== 'REQUEST_LOGS') return;
    var userId = e.data.userId;
    console.log('[MainApp] 대시보드로부터 로그 요청 수신:', userId);
    if (!userId) return;

    // AI 연결 상태 먼저 전달 (요청 시마다)
    sendToIframes({
      type: 'AI_CONNECTION_STATUS',
      isConnected: !!window.isSensorConnected
    });

    var auth = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth() : (window.auth || null);
    if (!auth || !auth.currentUser) {
      console.warn('[MainApp] 메인 앱도 비로그인 상태라 데이터 제공 불가');
      return;
    }

    try {
      var fs = (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore() : (window.firestore || null);
      if (!fs) {
        console.warn('[MainApp] Firestore 없음');
        return;
      }

      var thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      var dateStr = thirtyDaysAgo.toISOString().split('T')[0];
      var logsRef = fs.collection('users').doc(userId).collection('logs');

      var snapshot;
      try {
        snapshot = await logsRef.where('date', '>=', dateStr).orderBy('date', 'desc').limit(50).get();
      } catch (idxErr) {
        if (String(idxErr.message || '').indexOf('index') !== -1) {
          snapshot = await logsRef.limit(100).get();
        } else {
          throw idxErr;
        }
      }

      var logs = [];
      snapshot.forEach(function(doc) {
        var d = doc.data();
        if (d.date && d.date < dateStr) return;
        var sec = Number(d.duration_sec ?? d.time ?? 0) || 0;
        if (sec < 60) return;
        logs.push({
          id: doc.id,
          date: d.date,
          completed_at: (d.date || '') + 'T12:00:00.000Z',
          workout_name: d.title || '훈련',
          duration_min: Math.round(sec / 60),
          avg_power: Math.round(d.avg_watts || 0),
          np: Math.round(d.weighted_watts || d.avg_watts || 0),
          tss: Math.round(d.tss || 0),
          hr_avg: Math.round(d.avg_hr || 0),
          source: d.source || '',
          ...d
        });
      });
      logs.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
      // 훈련 횟수·TSS: 같은 날 Strava 있으면 Strava만, 없으면 Stelvio만 (TSS 규칙과 동일)
      logs = (typeof window.buildHistoryWithTSSRuleByDate === 'function')
        ? window.buildHistoryWithTSSRuleByDate(logs)
        : oneLogPerDayPreferStravaFallback(logs);
      logs = logs.slice(0, 50);

      console.log('[MainApp] ' + logs.length + '개 로그 데이터 대시보드로 전송');
      sendToIframes({ type: 'DASHBOARD_LOGS_DATA', logs: logs, userId: userId });
    } catch (error) {
      console.error('[MainApp] 로그 조회 중 오류:', error);
    }
  });
})();

// ========== 새 사용자 등록 시스템 ==========

// 새 사용자 폼 토글
function toggleNewUserForm() {
  const formContainer = document.getElementById('newUserFormContainer');
  const button = document.querySelector('.new-user-btn');
  
  if (!formContainer) return;
  
  if (isNewUserFormVisible) {
    formContainer.classList.add('hiding');
    setTimeout(() => {
      formContainer.style.display = 'none';
      formContainer.classList.remove('hiding');
    }, 300);
    
    if (button) {
      button.textContent = '➕ 새 사용자 추가';
    }
    
    isNewUserFormVisible = false;
  } else {
    formContainer.style.display = 'block';

    // BONUS: 새 사용자 등록 플로우 진입 시 기존 viewer/auth 캐시 제거
    try {
      localStorage.removeItem('authUser');
      localStorage.removeItem('currentUser');
    } catch (_) {}
    window.currentUser = null;
     
    if (button) {
      button.textContent = '❌ 취소';
    }
    
    setTimeout(() => {
      const firstInput = document.getElementById('newUserName');
      if (firstInput) {
        firstInput.focus();
      }
    }, 100);
    
    isNewUserFormVisible = true;
    //updateNewUserPreview(); <---15시에 제거
  }
}

// 새 사용자 전화번호 포맷팅
function formatNewUserPhone(value) {
  const numbers = value.replace(/\D/g, '');
  const limitedNumbers = numbers.slice(0, 11);
  
  let formatted = '';
  if (limitedNumbers.length > 0) {
    if (limitedNumbers.length <= 3) {
      formatted = limitedNumbers;
    } else if (limitedNumbers.length <= 7) {
      formatted = limitedNumbers.slice(0, 3) + '-' + limitedNumbers.slice(3);
    } else {
      formatted = limitedNumbers.slice(0, 3) + '-' + limitedNumbers.slice(3, 7) + '-' + limitedNumbers.slice(7, 11);
    }
  }
  
  const phoneInput = document.getElementById('newUserPhone');
  if (phoneInput && phoneInput.value !== formatted) {
    phoneInput.value = formatted;
  }
  
  validateNewUserPhone(formatted);
  return formatted;
}

// 새 사용자 전화번호 유효성 검사
function validateNewUserPhone(phoneNumber) {
  const phoneInput = document.getElementById('newUserPhone');
  if (!phoneInput) return;
  
  const isValidFormat = /^010-\d{4}-\d{4}$/.test(phoneNumber);
  
  if (isValidFormat) {
    phoneInput.classList.add('valid');
    phoneInput.classList.remove('error');
  } else {
    phoneInput.classList.remove('valid');
    if (phoneNumber.length > 0) {
      phoneInput.classList.add('error');
    } else {
      phoneInput.classList.remove('error');
    }
  }
}

// AI 미리보기 업데이트


// 새 사용자 폼 제출 처리
function handleNewUserSubmit(event) {
  event.preventDefault();

  // BONUS: stale viewer/auth 캐시 제거 (예: '박지성' 고정 노출 방지)
  try {
    localStorage.removeItem('authUser');
    localStorage.removeItem('currentUser');
  } catch (_) {}
  window.currentUser = null;
   
  const formData = {
    name: document.getElementById('newUserName')?.value?.trim(),
    contact: document.getElementById('newUserPhone')?.value?.trim(),
    ftp: parseInt(document.getElementById('newUserFTP')?.value) || 0,
    weight: parseFloat(document.getElementById('newUserWeight')?.value) || 0,
    challenge: document.getElementById('newUserChallenge')?.value || 'Fitness'
  };

  // 1) 필수값/형식
  if (!formData.name || !formData.contact || !formData.ftp || !formData.weight) {
    showToast?.('모든 필수 항목을 입력해주세요! ❌');
    return;
  }
  if (!/^010-\d{4}-\d{4}$/.test(formData.contact)) {
    showToast?.('올바른 전화번호 형식을 입력해주세요! ❌');
    return;
  }

  // 2) 버튼 상태
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '등록 중...';
  }

  // 3) 통합 생성기(중복검사 포함) 호출
  (async () => {
    try {
      const res = await window.unifiedCreateUser?.(formData, 'auth');
      if (res?.success) {
        showToast?.('정상 등록되었습니다.');
        // 필요 시 인증 폼 초기화 등 후속 처리
        document.getElementById('newUserForm')?.reset();
      }
    } catch (err) {
      // unifiedCreateUser에서 중복 시 에러: "이미 등록된 사용자입니다."
      showToast?.(err?.message || '등록 실패');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText || '등록';
      }
    }
  })();
}


// ========== 유틸리티 함수 ==========

// 토스트 메시지 함수
if (typeof window.showToast !== 'function') {
  window.showToast = function(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  };
}

// ========== 이벤트 리스너 및 초기화 ==========

// 통합 초기화 함수
// 6. 이벤트 리스너 초기화 함수 수정
// 🔍 검색: "function initializeAuthenticationSystem"
// 📍 위치: 라인 2994
// ✅ 전체 함수를 아래로 교체:

function initializeAuthenticationSystem() {
  console.log('🔧 인증 시스템 이벤트 리스너 초기화 시작');
  
  // Google 로그인 버튼 확인 (새로운 인증 방식)
  const googleLoginBtn = document.getElementById('googleLoginBtn');
  if (googleLoginBtn) {
    // handleGoogleLogin 함수는 index.html에서 이미 onclick으로 연결됨
  }
  
  // 전화번호 입력 필드 이벤트 설정 (기존 코드 호환성 유지 - 선택사항)
  const phoneInput = document.getElementById('phoneInput');
  if (phoneInput) {
    // input 이벤트 - 실시간 포맷팅
    phoneInput.addEventListener('input', function(e) {
      if (typeof formatPhoneNumber === 'function') {
        formatPhoneNumber(e.target.value);
      }
    });
    
    // keyup 이벤트 - 엔터키, 백스페이스 등
    phoneInput.addEventListener('keyup', function(e) {
      if (typeof handlePhoneKeyup === 'function') {
        handlePhoneKeyup(e);
      }
    });
    
    console.log('✅ 전화번호 입력 이벤트 리스너 설정 완료 (선택사항)');
  } else {
    // Google 로그인 사용 시 phoneInput이 없을 수 있음 (정상)
    console.log('ℹ️ 전화번호 입력 필드가 없습니다 (Google 로그인 사용 중)');
  }
  
  // 인증 버튼 이벤트 설정 (기존 코드 호환성 유지 - 선택사항)
  const authBtn = document.getElementById('phoneAuthBtn');
  if (authBtn) {
    authBtn.addEventListener('click', function() {
      console.log('🔐 인증 버튼 클릭됨');
      if (typeof authenticatePhone === 'function') {
        authenticatePhone();
      }
    });
    console.log('✅ 인증 버튼 이벤트 리스너 설정 완료 (선택사항)');
  } else {
    // Google 로그인 사용 시 phoneAuthBtn이 없을 수 있음 (정상)
    console.log('ℹ️ 전화번호 인증 버튼이 없습니다 (Google 로그인 사용 중)');
  }
  
  // 새 사용자 폼 이벤트 설정
  const newUserForm = document.getElementById('newUserForm');
  if (newUserForm) {
    newUserForm.addEventListener('submit', handleNewUserSubmit);
    console.log('✅ 새 사용자 폼 이벤트 리스너 설정 완료');
  }
  
  // 새 사용자 필드 실시간 유효성 검사
  const requiredFields = ['newUserName', 'newUserPhone', 'newUserFTP', 'newUserWeight', 'newUserChallenge'];
  requiredFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field) {
      field.addEventListener('input', validateNewUserForm);
      field.addEventListener('blur', validateNewUserForm);
    }
  });
  
  console.log('✅ 인증 시스템 모든 이벤트 리스너 초기화 완료');
}

// 전역으로 노출
window.initializeAuthenticationSystem = initializeAuthenticationSystem;

// 실시간 유효성 검사
function validateNewUserForm() {
  const name = document.getElementById('newUserName')?.value?.trim();
  const contact = document.getElementById('newUserPhone')?.value?.trim();
  const ftp = document.getElementById('newUserFTP')?.value;
  const weight = document.getElementById('newUserWeight')?.value;
  const challenge = document.getElementById('newUserChallenge')?.value;
  
  const submitBtn = document.querySelector('#newUserForm button[type="submit"]');
  if (!submitBtn) return;
  
  const isValid = name && contact && ftp && weight && challenge && /^010-\d{4}-\d{4}$/.test(contact);
  
  submitBtn.disabled = !isValid;
  submitBtn.style.opacity = isValid ? '1' : '0.6';
  submitBtn.style.cursor = isValid ? 'pointer' : 'not-allowed';
}

// 페이지 로드 시 초기화
// 🔍 검색: "DOMContentLoaded"
// 📍 위치: 라인 3032+
// ✅ 전체 이벤트를 아래로 교체:

document.addEventListener('DOMContentLoaded', function() {
  console.log('📱 인증 시스템 초기화 시작');
  
  // 스플래시 화면이 활성화되어 있으면 인증 화면 초기화 건너뛰기
  const splashScreen = document.getElementById('splashScreen');
  const isSplashActive = splashScreen && splashScreen.classList.contains('active');
  
  // 스플래시 화면이 활성화되어 있으면 인증 화면 초기화 완전 차단
  const splashScreenCheck = document.getElementById('splashScreen');
  const isSplashActiveCheck = window.isSplashActive || (splashScreenCheck && (splashScreenCheck.classList.contains('active') || window.getComputedStyle(splashScreenCheck).display !== 'none'));
  
  if (isSplashActiveCheck) {
    console.log('⏳ 스플래시 화면 표시 중 - 인증 화면 초기화 대기');
    // 스플래시 화면이 활성화되어 있을 때는 다른 화면들이 나타나지 않도록 강제로 숨김
    document.querySelectorAll('.screen').forEach(screen => {
      if (screen.id !== 'splashScreen') {
        screen.classList.remove('active');
        screen.style.display = 'none';
        screen.style.opacity = '0';
        screen.style.visibility = 'hidden';
      }
    });
    return; // 스플래시 화면이 활성화되어 있으면 여기서 종료
  }
  
  setTimeout(() => {
    // 모든 화면 완전히 숨기기 (스플래시 화면 제외)
    document.querySelectorAll('.screen').forEach(screen => {
      if (screen.id !== 'splashScreen') {
      screen.classList.remove('active');
      screen.style.display = 'none';
      screen.style.opacity = '0';
      screen.style.visibility = 'hidden';
      }
    });
    
    // authScreen만 표시
    const authScreen = document.getElementById('authScreen');
    if (authScreen) {
      authScreen.style.display = 'block';
      authScreen.classList.add('active');
      authScreen.style.opacity = '1';
      authScreen.style.visibility = 'visible';
      
      setTimeout(() => {
        const phoneInput = document.getElementById('phoneInput');
        if (phoneInput) {
          phoneInput.focus();
        }
      }, 500);
    }
  }, 200);
  
  setTimeout(() => {
    initializeAuthenticationSystem();
  }, 500);
});

// 개발자 도구 함수들
window.resetAuth = function() {
  isPhoneAuthenticated = false;
  if (typeof window !== 'undefined') window.isPhoneAuthenticated = false;
  currentPhoneNumber = '';
  console.log('인증 상태가 리셋되었습니다.');
};

// ✅ 교체:
// 🔍 검색: "window.checkAuthStatus = function()"
// ❌ 기존 함수 삭제하고 아래로 교체

window.checkAuthStatus = function() {
  const phoneAuth = window.isPhoneAuthenticated === true || isPhoneAuthenticated;
  console.log('=== 🔐 인증 시스템 상태 ===');
  console.log('현재 인증 상태:', phoneAuth);
  console.log('현재 전화번호:', currentPhoneNumber);
  console.log('현재 사용자:', window.currentUser);
  
  // DB 관련 상태 (안전하게 체크)
  if (typeof dbUsers !== 'undefined') {
    console.log('DB 연결 상태: 연결됨');
    console.log('DB 사용자 수:', dbUsers.length);
  } else {
    console.log('DB 연결 상태: 초기화 중');
  }
  console.log('===========================');
  
  return { 
    authenticated: phoneAuth, 
    phone: currentPhoneNumber,
    user: window.currentUser
  };
};

console.log('📱 DB 연동 전화번호 인증 시스템 로드 완료!');
console.log('🔧 실시간 DB 검색 기반 인증 시스템 활성화');



// 3. API를 통한 새 사용자 등록 함수 (새로 추가)
async function registerNewUserViaAPI(formData, submitBtn, originalText) {
  try {
    if (typeof apiCreateUser !== 'function') {
      throw new Error('apiCreateUser 함수가 없습니다.');
    }
    const result = await apiCreateUser({
      name: formData.name,
      contact: formData.contact,
      ftp: formData.ftp,
      weight: formData.weight,
      challenge: formData.challenge || 'Fitness',
      grade: '2',
      expiry_date: ''
    });

    if (!result.success) {
      throw new Error(result.error || '등록 실패');
    }

    if (typeof showToast === 'function') {
      showToast(`${formData.name}님 등록 완료! 🎉`);
    }

    // 폼 초기화/숨김
    document.getElementById('newUserForm')?.reset();
    toggleNewUserForm?.();

    // 🔑 방금 만든 사용자를 현재 뷰어로 채택(저장+라우팅)
    if (typeof adoptCreatedUserAsViewer === 'function') {
      await adoptCreatedUserAsViewer(formData);
    }

    // (보조) 프로필 화면 대비 목록도 새로고침
    if (typeof loadUsers === 'function') {
      loadUsers();
    }

  } catch (err) {
    console.error('registerNewUserViaAPI error:', err);
    if (typeof showToast === 'function') {
      showToast(`등록 실패: ${err.message || err}`);
    }
  } finally {
    if (submitBtn && originalText != null) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}


// 4. 폴백 localStorage 등록 함수 (새로 추가)
function fallbackLocalStorageRegistration(formData) {
  // 기존 localStorage 방식 (API 실패 시 사용)
  const users = JSON.parse(localStorage.getItem('trainingUsers') || '[]');
  const newUser = {
    id: Date.now().toString(),
    name: formData.name,
    contact: formData.contact,
    ftp: formData.ftp,
    weight: formData.weight,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  localStorage.setItem('trainingUsers', JSON.stringify(users));
  
  if (typeof showToast === 'function') {
    showToast(`${formData.name}님 등록 완료! 🎉`);
  }
}



/*
/*
=== 수정된 DB 연동 인증 시스템 (실제 작동 버전) ===
파일: app.js
위치: 기존 VALID_PHONES 및 authenticatePhone 관련 코드 교체

실제 호출 흐름이 명확하고 작동하는 버전으로 수정
*/

// ========== 1. 기존 제거할 코드들 ==========
/*
❌ 제거 대상:
1. const VALID_PHONES = [...] 배열 (라인 2598-2605)
2. 기존 authenticatePhone() 함수 (라인 2700-2758)
3. VALID_PHONES.includes() 관련 로직들
4. VALID_PHONES.push() 관련 로직들
*/



// ✅ 새로 추가
let isDBConnected = false;
let dbUsers = []; // DB 사용자 목록 캐시
let lastDBSync = null;

// ========== 3. 전화번호 정규화 함수 ==========
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  
  // 숫자만 추출
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  
  // 하이픈 포맷으로 통일 (010-1234-5678)
  if (digitsOnly.length === 11 && digitsOnly.startsWith('010')) {
    return `${digitsOnly.slice(0,3)}-${digitsOnly.slice(3,7)}-${digitsOnly.slice(7,11)}`;
  }
  
  return digitsOnly;
}

// ========== 4. DB 사용자 목록 동기화 ==========
// ========== 4. DB 사용자 목록 동기화 ==========
// 동시 호출 가드 & 쿨다운(스로틀)
let __syncInFlight = null;
let __syncCooldownUntil = 0; // Date.now() 기준(ms)

async function syncUsersFromDB() {
  const now = Date.now();

  // ❶ 최근 1500ms 이내 재호출이면, 진행 중인 Promise 재사용
  if (now < __syncCooldownUntil && __syncInFlight) {
    try {
      return await __syncInFlight;
    } catch (e) {
      // 직전 호출 실패라면 새 시도 허용
    }
  }

  // ❷ 이미 진행 중이면 같은 Promise 반환(중복 방지)
  if (__syncInFlight) {
    return __syncInFlight;
  }

  __syncInFlight = (async () => {
    try {
      // 로그인 상태 확인 (Firebase Auth 사용)
      const currentUser = window.auth?.currentUser;
      if (!currentUser) {
        console.log('ℹ️ 로그인하지 않은 상태 - 사용자 목록 동기화 건너뜀');
        isDBConnected = false;
        return false;
      }

      console.log('🔄 DB에서 사용자 목록 동기화 중...');

      // GAS_URL이 HTTPS인지 확인 (기존 코드 호환성 유지)
      const gasUrl = window.GAS_URL || GAS_URL;
      if (gasUrl && !gasUrl.startsWith('https://')) {
        console.error('❌ Mixed Content 차단: GAS_URL이 HTTPS가 아닙니다:', gasUrl);
        console.error('   HTTPS 사이트에서는 HTTPS API만 사용 가능합니다.');
        isDBConnected = false;
        return false;
      }

      if (typeof apiGetUsers !== 'function') {
        console.warn('apiGetUsers 함수를 찾을 수 없습니다. userManager.js가 로드되었는지 확인하세요.');
        return false;
      }

      const result = await apiGetUsers();

      if (result && result.success && Array.isArray(result.items)) {
        // ✅ 기존 변수/타입 유지
        dbUsers = result.items || [];
        isDBConnected = true;
        lastDBSync = new Date();  // (변경전과 동일: Date 객체)

        console.log(`✅ DB 동기화 완료: ${dbUsers.length}명의 사용자`);
        return true;
      } else {
        console.error('❌ DB 동기화 실패:', result && result.error);
        isDBConnected = false;
        return false;
      }
    } catch (error) {
      console.error('❌ DB 동기화 오류:', error);
      console.error('   에러 상세:', error.message);
      
      // 삼성 안드로이드폰에서의 특별한 처리
      const ua = navigator.userAgent || '';
      if (/Android/i.test(ua) && /Samsung/i.test(ua) && !/Tablet/i.test(ua)) {
        console.warn('⚠️ 삼성 안드로이드폰에서 DB 동기화 실패');
        console.warn('   가능한 원인:');
        console.warn('   1. Mixed Content 차단 (HTTPS → HTTP 호출)');
        console.warn('   2. 삼성 인터넷 브라우저의 보안 정책');
        console.warn('   해결 방법: Chrome 브라우저 사용 또는 GAS_URL이 HTTPS인지 확인');
      }
      
      isDBConnected = false;
      return false;
    } finally {
      // ❸ 완료 직후 1.5초 쿨다운 부여
      __syncCooldownUntil = Date.now() + 1500;
      __syncInFlight = null;
    }
  })();

  return __syncInFlight;
}




// ========== 5. DB 기반 전화번호 인증 함수 ==========
// ========== 5. 수정된 authenticatePhone 함수 (기존 함수 교체) ==========
async function authenticatePhone() {
  const authStatus = document.getElementById('phoneAuthStatus');
  const authBtn = document.getElementById('phoneAuthBtn');
  
  if (!authStatus || !authBtn) {
    console.error('❌ 인증 UI 요소를 찾을 수 없습니다.');
    return;
  }
  
  // UI 상태 업데이트 - 인증 시작
  authBtn.disabled = true;
  authBtn.textContent = '🔍 DB 검색 중...';
  authStatus.textContent = '📡 데이터베이스에서 확인 중입니다...';
  authStatus.className = 'auth-status';
  
  try {
    // DB 연결 상태 확인 및 필요시 동기화
    if (!isDBConnected || !dbUsers || dbUsers.length === 0) {
      console.log('🔄 DB 동기화 필요 - 사용자 목록 가져오는 중...');
      authStatus.textContent = '📡 데이터베이스 연결 중...';
      
      const syncSuccess = await syncUsersFromDB();
      
      if (!syncSuccess) {
        // 삼성 안드로이드폰에서의 특별한 메시지
        const ua = navigator.userAgent || '';
        const isSamsungAndroid = /Android/i.test(ua) && /Samsung/i.test(ua) && !/Tablet/i.test(ua);
        
        authStatus.textContent = isSamsungAndroid 
          ? '⚠️ 네트워크 오류: Chrome 브라우저를 사용하거나 잠시 후 다시 시도해주세요.'
          : '⚠️ DB 연결이 필요합니다. 잠시 후 다시 시도해주세요.';
        authStatus.className = 'auth-status error';
        authBtn.disabled = false;
        authBtn.textContent = '인증하기';
        return;
      }
    }
    
    // DB에서 전화번호 인증
    const authResult = await authenticatePhoneWithDB(currentPhoneNumber);
    
    if (authResult.success) {
      // ✅ 인증 성공
      isPhoneAuthenticated = true;
      authStatus.textContent = '✅ ' + authResult.message;
      authStatus.className = 'auth-status success';
      authBtn.textContent = '인증 완료';

      // ============================== 중요: 인증 주체 보관 ==============================
      // API 응답에서 사용자 객체 필드명(예: user/data/item) 프로젝트에 맞게 선택
      const authUser = authResult.user || authResult.data || authResult.item || authResult; 
      // grade(등급) 누락 대비: 기존 currentUser/ authUser 백업에서 보강
      let prevViewer = null;
      try { prevViewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(e) {}
      if (prevViewer && prevViewer.grade != null && (authUser && authUser.grade == null)) {
        authUser.grade = String(prevViewer.grade);
      }

      // 인증 주체(등급 포함)를 별도로 보관
      localStorage.setItem('authUser', JSON.stringify(authUser));  // ← 등급 보존 백업
      localStorage.setItem('currentUser', JSON.stringify(authUser));
      window.currentUser = authUser;
      // ================================================================================

      // 성공 애니메이션
      const authCard = document.querySelector('.auth-form-card');
      if (authCard) {
        authCard.classList.add('auth-success');
      }
      
      if (typeof showToast === 'function') {
        const nm = (authUser && authUser.name) ? authUser.name : '사용자';
        showToast(`${nm}님 환영합니다! 🎉`);
      }
      
      // 0.5초 후 단순하고 안전한 화면 전환
      setTimeout(() => {
        console.log('🔄 인증 완료 - 다음 화면으로 이동 중...');
        
        try {
          if (typeof window.showScreen === 'function') {
            window.__basecampShownAfterAuth = true;
            window.showScreen('basecampScreen');
            console.log('✅ 다음 화면 표시 완료: basecampScreen');
            if (typeof window.checkFtpSuggestionAndShow === 'function') {
              setTimeout(function () { window.checkFtpSuggestionAndShow(); }, 1500);
            }
            return;
          }
          // 1단계: 인증 화면 완전 숨김 후 모든 화면 숨기기
          if (typeof hideAuthScreen === 'function') hideAuthScreen();
          document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
            screen.style.display = 'none';
            screen.style.opacity = '0';
            screen.style.visibility = 'hidden';
          });

          // === [옵션 A] 프로필 선택 화면으로 이동하려면 이 블록 사용 ===
          // const profileScreen = document.getElementById('profileScreen');
          // if (profileScreen) {
          //   profileScreen.classList.add('active');
          //   profileScreen.style.display = 'block';
          //   profileScreen.style.opacity = '1';
          //   profileScreen.style.visibility = 'visible';
          //   // 프로필 화면 진입 시 사용자 목록 로드 (관리자=전체, 그 외=본인만)
          //   if (typeof loadUsers === 'function') {
          //     loadUsers();  // ← 여기서 이름 오름차순 정렬 및 grade 필터 적용됨
          //   }
          // } else {
          //   console.warn('⚠️ profileScreen 요소가 없어 connectionScreen으로 대체 진입합니다.');
          // }

          // === 베이스캠프 화면으로 이동 ===
          const basecampScreen = document.getElementById('basecampScreen');
          const target = basecampScreen || document.getElementById('connectionScreen'); // 베이스캠프 우선, 없으면 connectionScreen
          
          if (target) {
            target.classList.add('active');
            target.style.display = 'block';
            target.style.opacity = '1';
            target.style.visibility = 'visible';
            target.style.zIndex = '1000';
            if (target.id === 'basecampScreen' && typeof applyScrollContainmentForScreen === 'function') applyScrollContainmentForScreen('basecampScreen');
            console.log('✅ 다음 화면 표시 완료:', target.id);

            // (디버깅 도우미) 내용 존재 확인
            const hasContent = target.innerHTML.trim().length > 0;
            console.log('📄', target.id, '내용 존재:', hasContent);
            if (!hasContent) {
              target.innerHTML = `
                <div style="padding: 20px; text-align: center;">
                  <h2>🔗 기기 연결</h2>
                  <p>기기 연결 화면이 로드되었습니다.</p>
                  <button onclick="console.log('기기 연결 테스트')">연결 테스트</button>
                </div>`;
            }
          } else {
            console.error('❌ connectionScreen 요소가 없습니다');
            // 대체: 사용 가능한 화면들 찾기
            const allScreens = document.querySelectorAll('[id*="Screen"], [id*="screen"]');
            console.log('🔍 발견된 화면들:', Array.from(allScreens).map(s => s.id));
            if (allScreens.length > 0) {
              const firstScreen = allScreens[0];
              firstScreen.style.display = 'block';
              firstScreen.style.opacity = '1';
              firstScreen.style.visibility = 'visible';
              console.log('🔄 대체 화면 표시:', firstScreen.id);
            }
          }
          
        } catch (error) {
          console.error('❌ 화면 전환 오류:', error);
        }
      }, 500);
      
    } else {
      // ❌ 인증 실패
      authStatus.textContent = '❌ ' + authResult.message;
      authStatus.className = 'auth-status error';
      authBtn.textContent = '다시 인증';
      authBtn.disabled = false;
      
      const phoneInput = document.getElementById('phoneInput');
      if (phoneInput) {
        phoneInput.classList.add('error');
        setTimeout(() => { phoneInput.classList.remove('error'); }, 3000);
      }
      
      if (typeof showToast === 'function') {
        showToast(authResult.message + ' ❌');
      }
    }
    
  } catch (error) {
    // ⚠️ 예외 처리
    console.error('❌ 인증 과정 오류:', error);
    authStatus.textContent = '❌ 인증 중 오류가 발생했습니다';
    authStatus.className = 'auth-status error';
    authBtn.textContent = '다시 시도';
    authBtn.disabled = false;
    
    if (typeof showToast === 'function') {
      showToast('인증 중 오류가 발생했습니다. 다시 시도해주세요. ❌');
    }
  }
}




// ========== 7. 새 사용자 등록 후 자동 인증 함수 ==========
// ========== 수정된 handleNewUserSubmit 함수 ==========
async function handleNewUserSubmit(event) {
  event.preventDefault();
  
  // 간소화된 폼 데이터 수집 (이름, 전화번호, FTP, 몸무게, 운동목적)
  const formData = {
    name: document.getElementById('newUserName')?.value?.trim(),
    contact: document.getElementById('newUserPhone')?.value?.trim(),
    ftp: parseInt(document.getElementById('newUserFTP')?.value) || 0,
    weight: parseFloat(document.getElementById('newUserWeight')?.value) || 0,
    challenge: document.getElementById('newUserChallenge')?.value || 'Fitness'
  };
  
  // 유효성 검사
  if (!formData.name || !formData.contact || !formData.ftp || !formData.weight) {
    if (typeof showToast === 'function') {
      showToast('모든 필수 항목을 입력해주세요! ❌');
    }
    return;
  }
  
  // 전화번호 정규화 및 검증
  const normalizedPhone = normalizePhoneNumber(formData.contact);
  if (!normalizedPhone || normalizedPhone.length < 11) {
    if (typeof showToast === 'function') {
      showToast('올바른 전화번호를 입력해주세요! ❌');
    }
    return;
  }
  
  // 정규화된 전화번호로 업데이트
  formData.contact = normalizedPhone;
  
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '등록 중...';
  }
  
  try {
    console.log('👤 새 사용자 등록 시작:', formData);
    
    // ✅ 여기가 핵심: unifiedCreateUser 또는 apiCreateUser 사용
    let registrationResult;
    
    if (typeof unifiedCreateUser === 'function') {
      // userManager의 통합 함수 사용 (권장)
      registrationResult = await unifiedCreateUser({
        name: formData.name,
        contact: formData.contact,
        ftp: formData.ftp,
        weight: formData.weight,
        challenge: formData.challenge || 'Fitness',
        grade: '2',
        expiry_date: ''
      }, 'auth');
      
    } else if (typeof apiCreateUser === 'function') {
      // 직접 API 함수 사용 (폴백)
      registrationResult = await apiCreateUser({
        name: formData.name,
        challenge: formData.challenge || 'Fitness',
        contact: formData.contact,
        ftp: formData.ftp,
        weight: formData.weight,
        grade: '2',
        expiry_date: ''
      });
      
    } else {
      throw new Error('사용자 등록 함수를 찾을 수 없습니다. userManager.js가 로드되었는지 확인하세요.');
    }
    
    if (registrationResult.success) {
      console.log('✅ 정상 등록되었습니다.:', registrationResult);
      
      // 성공 메시지
      if (typeof showToast === 'function') {
        showToast(`${formData.name}님 등록 완료! 🎉`);
      }
      
      // 폼 초기화 및 숨기기
      document.getElementById('newUserForm')?.reset();
      toggleNewUserForm();
      
      // ✅ 핵심: 등록된 사용자 데이터로 자동 인증 실행
      const registeredUserData = {
        id: registrationResult.item?.id || Date.now().toString(),
        name: formData.name,
        contact: formData.contact,
        ftp: formData.ftp,
        weight: formData.weight,
        created_at: new Date().toISOString()
      };
      
      // handleNewUserRegistered 함수 호출
      if (typeof handleNewUserRegistered === 'function') {
        await handleNewUserRegistered(registeredUserData);
      } else {
        console.warn('⚠️ handleNewUserRegistered 함수를 찾을 수 없습니다');
        // 수동 인증 안내
        if (typeof showToast === 'function') {
          showToast('등록 완료! 인증 버튼을 눌러주세요.');
        }
      }
      
    } else {
      throw new Error(registrationResult.error || '등록에 실패했습니다');
    }
    
  } catch (error) {
    console.error('❌ 사용자 등록 실패:', error);
    if (typeof showToast === 'function') {
      showToast('등록 실패: ' + error.message + ' ❌');
    }
  } finally {
    // 버튼 상태 복원
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

// ========== 중복 검사 함수 (선택적 추가) ==========
async function checkPhoneDuplicateBeforeRegistration(phoneNumber) {
  try {
    // DB에서 중복 체크
    if (typeof syncUsersFromDB === 'function') {
      await syncUsersFromDB(); // 최신 데이터로 업데이트
    }
    
    if (dbUsers && dbUsers.length > 0) {
      const normalizedInput = normalizePhoneNumber(phoneNumber);
      const existingUser = dbUsers.find(user => {
        const userPhone = normalizePhoneNumber(user.contact || '');
        return userPhone === normalizedInput;
      });
      
      if (existingUser) {
        return {
          exists: true,
          userName: existingUser.name,
          userId: existingUser.id
        };
      }
    }
    
    return { exists: false };
    
  } catch (error) {
    console.warn('⚠️ 중복 체크 실패:', error);
    return { exists: false }; // 오류 시 중복 체크 스킵
  }
}

// ========== 중복 체크 포함 버전 (고급) ==========
async function handleNewUserSubmitWithDuplicateCheck(event) {
  event.preventDefault();
  
  const formData = {
    name: document.getElementById('newUserName')?.value?.trim(),
    contact: document.getElementById('newUserPhone')?.value?.trim(),
    ftp: parseInt(document.getElementById('newUserFTP')?.value) || 0,
    weight: parseFloat(document.getElementById('newUserWeight')?.value) || 0,
    challenge: document.getElementById('newUserChallenge')?.value || 'Fitness'
  };

  // 유효성 검사
  if (!formData.name || !formData.contact || !formData.ftp || !formData.weight) {
    if (typeof showToast === 'function') {
      showToast('모든 필수 항목을 입력해주세요! ❌');
    }
    return;
  }
  
  const normalizedPhone = normalizePhoneNumber(formData.contact);
  if (!normalizedPhone || normalizedPhone.length < 11) {
    if (typeof showToast === 'function') {
      showToast('올바른 전화번호를 입력해주세요! ❌');
    }
    return;
  }
  
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '중복 확인 중...';
  }
  
  try {
    // 1. 중복 체크
    const duplicateCheck = await checkPhoneDuplicateBeforeRegistration(normalizedPhone);
    if (duplicateCheck.exists) {
      throw new Error(`이미 등록된 전화번호입니다 (${duplicateCheck.userName}님)`);
    }
    
    // 2. 등록 진행 (위의 handleNewUserSubmit 로직과 동일)
    if (submitBtn) {
      submitBtn.textContent = '등록 중...';
    }
    
    formData.contact = normalizedPhone;
    
    // ... (위의 등록 로직과 동일)
    
  } catch (error) {
    console.error('❌ 등록 실패:', error);
    if (typeof showToast === 'function') {
      showToast(error.message + ' ❌');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}


// ========== 8. 개발자 도구 함수들 ==========
window.checkAuthStatus = function() {
  console.log('=== 🔐 인증 시스템 상태 ===');
  console.log('현재 인증 상태:', isPhoneAuthenticated);
  console.log('현재 전화번호:', currentPhoneNumber);
  console.log('현재 사용자:', window.currentUser);
  console.log('DB 연결 상태:', isDBConnected);
  console.log('DB 사용자 수:', dbUsers.length);
  console.log('마지막 DB 동기화:', lastDBSync);
  console.log('===========================');
  
  return { 
    authenticated: isPhoneAuthenticated, 
    phone: currentPhoneNumber,
    user: window.currentUser,
    dbConnected: isDBConnected,
    dbUserCount: dbUsers.length,
    lastSync: lastDBSync
  };
};

window.testDBAuth = async function(phoneNumber) {
  console.log('🧪 DB 인증 테스트 시작:', phoneNumber);
  const result = await authenticatePhoneWithDB(phoneNumber);
  console.log('📊 테스트 결과:', result);
  return result;
};

window.syncDB = async function() {
  console.log('🔄 수동 DB 동기화 시작...');
  const result = await syncUsersFromDB();
  console.log('📊 동기화 결과:', result ? '성공' : '실패');
  return result;
};

window.listRegisteredPhones = function() {
  const phones = dbUsers.map(u => normalizePhoneNumber(u.contact)).filter(p => p);
  console.log('📋 등록된 전화번호 목록:', phones);
  return phones;
};

// ========== 9. 초기화 ==========
document.addEventListener('DOMContentLoaded', async function() {
  if (window.__DB_AUTH_INIT_DONE__) return;  // ★ 가드: 다중 초기화 방지
  window.__DB_AUTH_INIT_DONE__ = true;

  console.log('📱 DB 연동 인증 시스템 초기화 중...');

  // 로그인 상태 확인 (Firebase Auth 사용)
  const currentUser = window.auth?.currentUser;
  if (!currentUser) {
    console.log('ℹ️ 로그인하지 않은 상태 - DB 초기화는 로그인 후 자동으로 진행됩니다');
    console.log('💡 Google 로그인 후 사용자 목록이 자동으로 동기화됩니다');
    return; // 로그인하지 않은 경우 초기화 건너뜀
  }

  const syncSuccess = await syncUsersFromDB();
  if (syncSuccess) {
    console.log('✅ DB 연동 인증 시스템 초기화 완료!');
    console.log('📞 Firebase Firestore에서 사용자 목록을 불러왔습니다');
  } else {
    // 실제 오류인 경우에만 경고 (로그인 상태인데 실패한 경우)
    console.warn('⚠️ DB 초기화 실패 - userManager.js 로드 상태를 확인하세요');
  }
});

// 새 사용자 등록 후 자동 인증 처리 함수
async function handleNewUserRegistered(userData) {
  console.log('📝 새 사용자 등록 완료, 자동 인증 시작:', userData.name);
  
  try {
    // DB 목록 강제 새로고침 (새 사용자 포함)
    if (typeof syncUsersFromDB === 'function') {
      await syncUsersFromDB();
    }
    
    // 등록된 전화번호로 현재 인증 상태 설정
    const normalizedPhone = normalizePhoneNumber(userData.contact);
    currentPhoneNumber = normalizedPhone;
    
    // 전화번호 입력 필드에 자동 입력
    const phoneInput = document.getElementById('phoneInput');
    if (phoneInput) {
      phoneInput.value = normalizedPhone.replace(/\D/g, '');
      if (typeof formatPhoneNumber === 'function') {
        formatPhoneNumber(phoneInput.value);
      }
    }
    
    // 1초 대기 후 자동 인증 실행
    setTimeout(async () => {
      if (typeof authenticatePhoneWithDB === 'function') {
        const authResult = await authenticatePhoneWithDB(normalizedPhone);
        
        if (authResult.success) {
          // 자동 인증 성공
          isPhoneAuthenticated = true;
          window.currentUser = authResult.user;
          localStorage.setItem('currentUser', JSON.stringify(authResult.user));
          
          // UI 업데이트
          const authStatus = document.getElementById('phoneAuthStatus');
          const authBtn = document.getElementById('phoneAuthBtn');
          
          if (authStatus && authBtn) {
            authStatus.textContent = '✅ 등록 및 인증 완료!';
            authStatus.className = 'auth-status success';
            authBtn.textContent = '인증 완료';
            authBtn.disabled = true;
          }
          
          if (typeof showToast === 'function') {
            showToast(`${userData.name}님 등록 및 인증 완료! 🎉`);
          }
          
         // 환영 오버레이가 표시되어 있는지 확인 (약간의 지연 후 확인)
         await new Promise(resolve => setTimeout(resolve, 200));
         
         const welcomeModal = document.getElementById('userWelcomeModal');
         const modalDisplay = welcomeModal ? window.getComputedStyle(welcomeModal).display : 'none';
         const hasWelcomeModal = welcomeModal && 
                                 !welcomeModal.classList.contains('hidden') && 
                                 modalDisplay !== 'none' &&
                                 window.userWelcomeModalShown === true;
         
         console.log('[handleNewUserRegistered] 환영 오버레이 상태:', {
           modalExists: !!welcomeModal,
           hasHiddenClass: welcomeModal ? welcomeModal.classList.contains('hidden') : 'N/A',
           displayStyle: modalDisplay,
           windowFlag: window.userWelcomeModalShown,
           hasWelcomeModal
         });
         
         // 화면 전환 함수 정의 (인증 완료 후 베이스캠프 진입 → TOP10 표시 허용)
         const proceedToNextScreen = () => {
           console.log('🔄 자동 인증 완료 - 기기연결 화면으로 이동');
           
           if (typeof window.showScreen === 'function') {
             window.__basecampShownAfterAuth = true;
             window.showScreen('basecampScreen');
             console.log('✅ basecampScreen 표시 완료');
             return;
           }
           
           // 환영 오버레이가 있으면 먼저 닫기
           const welcomeModal = document.getElementById('userWelcomeModal');
           if (welcomeModal && !welcomeModal.classList.contains('hidden')) {
             if (typeof closeUserWelcomeModal === 'function') {
               closeUserWelcomeModal();
             }
           }
           
           // 인증 화면 완전 숨김 후 나머지 화면 숨기기
           if (typeof hideAuthScreen === 'function') hideAuthScreen();
           document.querySelectorAll('.screen').forEach(screen => {
             screen.classList.remove('active');
             screen.style.display = 'none';
             screen.style.opacity = '0';
             screen.style.visibility = 'hidden';
           });
           
           // basecampScreen 강제 표시
           const basecampScreen = document.getElementById('basecampScreen');
           if (basecampScreen) {
             basecampScreen.classList.add('active');
             basecampScreen.style.display = 'block';
             basecampScreen.style.opacity = '1';
             basecampScreen.style.visibility = 'visible';
             if (typeof applyScrollContainmentForScreen === 'function') applyScrollContainmentForScreen('basecampScreen');
             console.log('✅ basecampScreen 표시 완료');
           } else {
             console.error('❌ basecampScreen을 찾을 수 없습니다');
             // 대체: connectionScreen으로 이동
             const connectionScreen = document.getElementById('connectionScreen');
             if (connectionScreen) {
               connectionScreen.classList.add('active');
               connectionScreen.style.display = 'block';
               connectionScreen.style.opacity = '1';
               connectionScreen.style.visibility = 'visible';
               console.log('✅ connectionScreen 표시 완료 (대체)');
             } else {
               console.error('❌ connectionScreen도 찾을 수 없습니다');
               // 대체 화면 표시
               const allScreens = document.querySelectorAll('[id*="Screen"], [id*="screen"]');
               if (allScreens.length > 0) {
                 const firstScreen = allScreens[0];
                 firstScreen.style.display = 'block';
                 console.log('🔄 대체 화면 표시:', firstScreen.id);
               }
             }
           }
         };
         
         // 환영 오버레이가 있으면 사용자가 닫을 때까지 대기, 없으면 즉시 화면 전환
         if (hasWelcomeModal) {
           console.log('[handleNewUserRegistered] 환영 오버레이가 표시되어 있음 - 사용자가 닫을 때까지 대기');
           // 모달이 닫힐 때까지 대기 (최대 30초)
           let checkCount = 0;
           const maxChecks = 300; // 30초 (100ms * 300)
           
           const checkModalClosed = setInterval(() => {
             checkCount++;
             const modalStillOpen = welcomeModal && 
                                   !welcomeModal.classList.contains('hidden') && 
                                   window.getComputedStyle(welcomeModal).display !== 'none' &&
                                   window.userWelcomeModalShown === true;
             
             if (!modalStillOpen || checkCount >= maxChecks) {
               clearInterval(checkModalClosed);
               if (checkCount >= maxChecks) {
                 console.warn('[handleNewUserRegistered] 모달 닫기 대기 시간 초과, 강제로 화면 전환');
                 if (typeof closeUserWelcomeModal === 'function') {
                   closeUserWelcomeModal();
                 }
               }
               proceedToNextScreen();
             }
           }, 100);
         } else {
           // 환영 오버레이가 없으면 0.5초 후 화면 전환
           setTimeout(() => {
             proceedToNextScreen();
           }, 500);
         }
        } else {
          // 자동 인증 실패 시 수동 인증 안내
          if (typeof showToast === 'function') {
            showToast('등록 완료! 인증 버튼을 눌러주세요.');
          }
        }
      }
    }, 1000);
    
  } catch (error) {
    console.error('❌ 자동 인증 처리 실패:', error);
    if (typeof showToast === 'function') {
      showToast('등록 완료! 인증 버튼을 눌러주세요.');
    }
  }
}

// ========== 10. 전역 함수 내보내기 ==========



// ========== 10. 전역 함수 내보내기 ==========
window.handleNewUserRegistered = handleNewUserRegistered;
window.authenticatePhoneWithDB = authenticatePhoneWithDB;
window.normalizePhoneNumber = normalizePhoneNumber;
window.syncUsersFromDB = syncUsersFromDB;

console.log('📱 수정된 DB 연동 전화번호 인증 시스템 로드 완료!');
console.log('🔧 VALID_PHONES 배열이 제거되고 실시간 DB 검색으로 전환되었습니다.');

// ========== 디버깅 및 응급 복구 함수들 ==========
window.debugScreenState = function() { /* ... */ };
window.emergencyShowConnection = function() { /* ... */ };

console.log('🛠️ 디버깅 함수 로드 완료: debugScreenState(), emergencyShowConnection()');




// 앱 로드 시 인증 복구 → 라우팅
window.addEventListener('load', () => {
  // 1) 인증 상태 복구
  checkAuthStatus();

  // 2) 복구 결과에 따라 초기 화면 결정
  if (window.currentUser) {
    // (A안) 바로 프로필 선택 화면에서 사용자 리스트 보고 싶다면:
    // hideAllScreens();
    // const profileScreen = document.getElementById('profileScreen');
    // if (profileScreen) {
    //   profileScreen.classList.add('active');
    //   profileScreen.style.display = 'block';
    //   profileScreen.style.opacity = '1';
    //   profileScreen.style.visibility = 'visible';
    //   if (typeof loadUsers === 'function') loadUsers(); // grade=1 전체/이름순, 그 외 본인만
    // }

    // 베이스캠프 화면으로 이동
    hideAllScreens();
    const basecampScreen = document.getElementById('basecampScreen');
    if (basecampScreen) {
      basecampScreen.classList.add('active');
      basecampScreen.style.display = 'block';
      basecampScreen.style.opacity = '1';
      basecampScreen.style.visibility = 'visible';
      if (typeof applyScrollContainmentForScreen === 'function') applyScrollContainmentForScreen('basecampScreen');
    } else {
      // 대체: connectionScreen으로 이동
      const connectionScreen = document.getElementById('connectionScreen');
      if (connectionScreen) {
        connectionScreen.classList.add('active');
        connectionScreen.style.display = 'block';
        connectionScreen.style.opacity = '1';
        connectionScreen.style.visibility = 'visible';
      }
    }
  } else {
    // 인증 정보 없으면 인증 화면으로
    if (typeof showAuthScreen === 'function') {
      showAuthScreen();
    } else {
      hideAllScreens();
      const authScreen = document.getElementById('authScreen');
      if (authScreen) {
        authScreen.classList.add('active');
        authScreen.style.display = 'block';
        authScreen.style.opacity = '1';
        authScreen.style.visibility = 'visible';
      }
    }
  }
});


// === [RESULT] 매 초 수집되는 라이브 데이터를 결과 버퍼로 전달 ===
function appendResultStreamSamples(now = new Date()) {
  try {
    const ld = window.liveData || {};
    // power, heartRate, cadence 모두 안전 반영
    window.trainingResults?.appendStreamSample?.('power',     ld.power,     now);
    window.trainingResults?.appendStreamSample?.('heartRate', ld.heartRate, now); // hr 별칭 지원
    window.trainingResults?.appendStreamSample?.('cadence',   ld.cadence,   now);
  } catch (e) {
    console.warn('[result] appendStreamSamples failed:', e);
  }
}


// ===== CORS 및 네트워크 오류 전역 처리기 =====
(function setupGlobalErrorHandlers() {
  // 처리되지 않은 fetch 오류 처리
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    return originalFetch.apply(this, args)
      .catch(error => {
        if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
          console.warn('[Global] CORS/네트워크 오류 감지:', error.message);
          // CORS 오류는 예상된 오류이므로 조용히 처리
          return Promise.reject(new Error(`NETWORK_ERROR: ${error.message}`));
        }
        return Promise.reject(error);
      });
  };

  // 전역 오류 처리
  window.addEventListener('error', (event) => {
    if (event.error?.message?.includes('CORS') || 
        event.error?.message?.includes('Failed to fetch')) {
      console.warn('[Global] 전역 CORS 오류 감지 (무시):', event.error.message);
      event.preventDefault(); // 콘솔 스팸 방지
    }
  });

  // Promise rejection 처리
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason?.message?.includes('CORS') || 
        event.reason?.message?.includes('Failed to fetch') ||
        event.reason?.message?.includes('NETWORK_ERROR')) {
      console.warn('[Global] 처리되지 않은 네트워크 오류 (무시):', event.reason.message);
      event.preventDefault(); // 콘솔 스팸 방지
    }
  });

  console.log('[Global] CORS/네트워크 오류 전역 처리기 설정 완료');



/**
 * 저장된 워크아웃 목록 불러오기
 */
function listWorkouts() {
  try {
    // 1순위: localStorage에서 저장된 워크아웃 불러오기
    const savedWorkouts = localStorage.getItem('workoutPlans');
    if (savedWorkouts) {
      const workouts = JSON.parse(savedWorkouts);
      if (Array.isArray(workouts) && workouts.length > 0) {
        console.log(`✅ localStorage에서 ${workouts.length}개 워크아웃을 로드했습니다`);
        return workouts;
      }
    }

    // 2순위: 전역 workoutPlans 사용
    if (window.workoutPlans && Array.isArray(window.workoutPlans) && window.workoutPlans.length > 0) {
      console.log(`✅ 전역 workoutPlans에서 ${window.workoutPlans.length}개 워크아웃을 로드했습니다`);
      return window.workoutPlans;
    }

    // 3순위: 전역 workoutData 사용
    if (window.workoutData && Array.isArray(window.workoutData)) {
      console.log(`✅ 기본 workoutData에서 ${window.workoutData.length}개 워크아웃을 로드했습니다`);
      return window.workoutData;
    }

    console.warn('⚠️ 저장된 워크아웃이 없습니다');
    return [];
    
  } catch (error) {
    console.error('❌ 워크아웃 로딩 오류:', error);
    return window.workoutData || [];
  }
}

/**
 * 워크아웃 계획 저장
 */
function saveWorkoutPlan(workout) {
  try {
    const savedWorkouts = JSON.parse(localStorage.getItem('workoutPlans') || '[]');
    
    // 중복 ID 체크
    const existingIndex = savedWorkouts.findIndex(w => w.id === workout.id);
    if (existingIndex >= 0) {
      savedWorkouts[existingIndex] = workout; // 업데이트
    } else {
      savedWorkouts.push(workout); // 새로 추가
    }
    
    localStorage.setItem('workoutPlans', JSON.stringify(savedWorkouts));
    window.workoutPlans = savedWorkouts; // 전역 변수도 업데이트
    
    console.log(`✅ 워크아웃 "${workout.title || workout.name}" 저장 완료`);
    return true;
  } catch (error) {
    console.error('❌ 워크아웃 저장 오류:', error);
    return false;
  }
}

/**
 * 워크아웃 계획 삭제
 */
function deleteWorkoutPlan(workoutId) {
  try {
    const savedWorkouts = JSON.parse(localStorage.getItem('workoutPlans') || '[]');
    const filteredWorkouts = savedWorkouts.filter(w => w.id !== workoutId);
    
    localStorage.setItem('workoutPlans', JSON.stringify(filteredWorkouts));
    window.workoutPlans = filteredWorkouts;
    
    console.log(`✅ 워크아웃 ID "${workoutId}" 삭제 완료`);
    return true;
  } catch (error) {
    console.error('❌ 워크아웃 삭제 오류:', error);
    return false;
  }
}

// 전역 함수로 등록
window.listWorkouts = listWorkouts;
window.saveWorkoutPlan = saveWorkoutPlan;
window.deleteWorkoutPlan = deleteWorkoutPlan;

})();

// ========== 훈련일지 캘린더 ==========
let trainingJournalCurrentMonth = new Date().getMonth();
let trainingJournalCurrentYear = new Date().getFullYear();

// 훈련일지 캘린더 로드
async function loadTrainingJournalCalendar(direction) {
  const calendarContainer = document.getElementById('trainingJournalCalendar');
  if (!calendarContainer) return;
  
  try {
    // 월 이동 처리
    if (direction === 'prev') {
      trainingJournalCurrentMonth--;
      if (trainingJournalCurrentMonth < 0) {
        trainingJournalCurrentMonth = 11;
        trainingJournalCurrentYear--;
      }
    } else if (direction === 'next') {
      trainingJournalCurrentMonth++;
      if (trainingJournalCurrentMonth > 11) {
        trainingJournalCurrentMonth = 0;
        trainingJournalCurrentYear++;
      }
    }
    
    calendarContainer.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <div class="loading-text">캘린더를 불러오는 중...</div>
      </div>
    `;
    
    // 현재 사용자 ID 가져오기
    const userId = window.currentUser?.id || JSON.parse(localStorage.getItem('currentUser') || 'null')?.id;
    if (!userId) {
      calendarContainer.innerHTML = '<div class="error-message">사용자 정보를 찾을 수 없습니다.</div>';
      return;
    }
    
    // 해당 월의 시작일과 종료일 계산 (로컬 날짜 사용 - UTC 변환 시 달 경계에서 오늘 누락 방지)
    const startDate = new Date(trainingJournalCurrentYear, trainingJournalCurrentMonth, 1);
    const endDate = new Date(trainingJournalCurrentYear, trainingJournalCurrentMonth + 1, 0);
    const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    
    // Firebase users/{userId}/logs 조회 (날짜별 훈련 유무만 사용)
    // 1) getTrainingLogsByDateRange(firestoreV9) 우선 사용, 2) 없으면 v8 firestore 사용
    const resultsByDate = {};
    const MIN_DURATION_SEC = 600;
    try {
      if (typeof window.getTrainingLogsByDateRange === 'function') {
        const monthLogs = await window.getTrainingLogsByDateRange(userId, trainingJournalCurrentYear, trainingJournalCurrentMonth);
        monthLogs.forEach(function(log) {
          let dateStr = log.date;
          if (dateStr && typeof dateStr.toDate === 'function') {
            var d = dateStr.toDate();
            dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          } else if (dateStr && typeof dateStr !== 'string') {
            dateStr = (log.date && log.date.toISOString) ? log.date.toISOString().slice(0, 10) : null;
          }
          if (!dateStr || dateStr < startDateStr || dateStr > endDateStr) return;
          var sec = Number(log.duration_sec ?? log.time ?? log.duration ?? 0);
          if (sec < MIN_DURATION_SEC) return;
          if (!resultsByDate[dateStr]) resultsByDate[dateStr] = [];
          resultsByDate[dateStr].push(log);
        });
      } else {
        const fs = (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore() : (window.firestore || null);
        if (!fs) {
          console.warn('훈련일지: Firestore를 사용할 수 없습니다. getTrainingLogsByDateRange와 firestore(v8) 모두 없음.');
        } else {
          const logsRef = fs.collection('users').doc(userId).collection('logs');
          let snapshot;
          try {
            snapshot = await logsRef
              .where('date', '>=', startDateStr)
              .where('date', '<=', endDateStr)
              .get();
          } catch (idxErr) {
            console.warn('훈련일지: date 범위 쿼리 실패, limit only 시도:', idxErr);
            snapshot = await logsRef.limit(100).get();
          }
          snapshot.docs.forEach(function(doc) {
            const d = doc.data();
            const dateStr = d.date;
            if (!dateStr || dateStr < startDateStr || dateStr > endDateStr) return;
            const sec = Number(d.duration_sec ?? d.time ?? d.duration ?? 0);
            if (sec < MIN_DURATION_SEC) return;
            if (!resultsByDate[dateStr]) resultsByDate[dateStr] = [];
            resultsByDate[dateStr].push({ id: doc.id, ...d });
          });
        }
      }
      // 같은 날 Strava와 Stelvio가 둘 다 있으면 Stelvio 훈련 로그만 표시
      Object.keys(resultsByDate).forEach(function(dateStr) {
        const arr = resultsByDate[dateStr];
        const hasStelvio = arr.some(function(item) { return item.source !== 'strava'; });
        if (hasStelvio) {
          resultsByDate[dateStr] = arr.filter(function(item) { return item.source !== 'strava'; });
        }
      });
    } catch (error) {
      console.error('훈련일지 Firebase logs 조회 실패:', error);
    }
    
    // 캘린더 렌더링
    renderTrainingJournalCalendar(trainingJournalCurrentYear, trainingJournalCurrentMonth, resultsByDate);
    
    // 월 표시 업데이트
    const monthEl = document.getElementById('trainingJournalMonth');
    if (monthEl) {
      monthEl.textContent = `${trainingJournalCurrentYear}년 ${trainingJournalCurrentMonth + 1}월`;
    }
    
  } catch (error) {
    console.error('훈련일지 캘린더 로드 실패:', error);
    calendarContainer.innerHTML = `
      <div class="error-message">
        <p>캘린더를 불러오는데 실패했습니다.</p>
        <button class="btn" onclick="loadTrainingJournalCalendar()">다시 시도</button>
      </div>
    `;
  }
}

// 한국 공휴일 확인 함수
function isKoreanHoliday(year, month, day) {
  const holidays = [
    // 고정 공휴일 (월은 0부터 시작하므로 -1)
    { month: 0, day: 1 },   // 신정 (1월 1일)
    { month: 2, day: 1 },   // 삼일절 (3월 1일)
    { month: 4, day: 5 },   // 어린이날 (5월 5일)
    { month: 5, day: 6 },   // 현충일 (6월 6일)
    { month: 7, day: 15 },  // 광복절 (8월 15일)
    { month: 9, day: 3 },   // 개천절 (10월 3일)
    { month: 9, day: 9 },   // 한글날 (10월 9일)
    { month: 11, day: 25 }, // 크리스마스 (12월 25일)
  ];
  
  return holidays.some(h => h.month === month && h.day === day);
}

// 훈련일지 캘린더 렌더링
function renderTrainingJournalCalendar(year, month, resultsByDate) {
  const container = document.getElementById('trainingJournalCalendar');
  if (!container) return;
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // 주의 첫날로 조정
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const days = [];
  const currentDate = new Date(startDate);
  
  // 6주치 날짜 생성 (42일)
  for (let i = 0; i < 42; i++) {
    // 훈련 캘린더와 동일한 방식으로 로컬 날짜 문자열 생성
    const year = currentDate.getFullYear();
    const monthNum = String(currentDate.getMonth() + 1).padStart(2, '0');
    const dayNum = String(currentDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${monthNum}-${dayNum}`;
    const isCurrentMonth = currentDate.getMonth() === month;
    const isToday = currentDate.getTime() === today.getTime();
    const result = resultsByDate[dateStr]?.[0]; // 첫 번째 결과만 사용
    
    // 요일 확인 (0: 일요일, 6: 토요일)
    const dayOfWeek = currentDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // 공휴일 확인
    const isHoliday = isKoreanHoliday(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    
    days.push({
      date: dateStr,
      day: currentDate.getDate(),
      isCurrentMonth,
      isToday,
      result,
      isWeekend,
      isHoliday,
      dayOfWeek
    });
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // 요일 헤더
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  
  // 캘린더 HTML 생성
  let html = `
    <div class="calendar-month">
      <table class="calendar-table">
        <thead>
          <tr>
            ${weekdays.map(day => `<th class="calendar-weekday-header">${day}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
  `;
  
  // 주별로 행 생성
  for (let week = 0; week < 6; week++) {
    html += '<tr>';
    for (let day = 0; day < 7; day++) {
      const dayData = days[week * 7 + day];
      html += `<td class="calendar-table-cell">${renderTrainingJournalDay(dayData)}</td>`;
    }
    html += '</tr>';
  }
  
  html += `
        </tbody>
      </table>
    </div>
  `;
  
  container.innerHTML = html;
}

// 훈련일지 날짜 셀 렌더링 (Firebase logs 기반, 날짜만 표시)
function renderTrainingJournalDay(dayData) {
  if (!dayData || !dayData.isCurrentMonth) {
    return '<div class="calendar-day-empty"></div>';
  }
  
  const date = dayData.date || '';
  const day = dayData.day || 0;
  const isToday = dayData.isToday || false;
  const hasTraining = !!dayData.result;
  const isWeekend = dayData.isWeekend || false;
  const isHoliday = dayData.isHoliday || false;
  
  const result = dayData.result || null;
  // Outdoor: source === 'strava' 이고 elevation_gain이 null/undefined가 아니며 실제로 > 0 일 때만 (null이면 Indoor)
  const eg = result && result.elevation_gain;
  const hasElevation = eg != null && eg !== '' && !Number.isNaN(Number(eg)) && Number(eg) > 0;
  const isOutdoor = hasTraining && result && (String(result.source || '') === 'strava') && hasElevation;

  const classes = ['calendar-day', 'journal-day-only'];
  if (isToday) classes.push('today');
  if (hasTraining) {
    classes.push('journal-has-training');  // 투명 녹색 (기본)
    if (isOutdoor) classes.push('journal-outdoor');  // Outdoor: source strava + elevation_gain > 0 → 주황색
  } else {
    classes.push('journal-no-training-day'); // 회색 계열
  }
  if (isWeekend || isHoliday) classes.push('holiday-weekend');
  // 요일/공휴일 폰트 색 (Outdoor 셀에서 평일=검정, 토=파랑, 일/공휴=빨강)
  const dayOfWeek = dayData.dayOfWeek ?? -1;
  if (dayOfWeek === 0) classes.push('journal-day-sun');
  else if (dayOfWeek === 6) classes.push('journal-day-sat');
  if (isHoliday) classes.push('journal-day-holiday');
  
  // 날짜만 표시 (휴대폰에서 잘 보이도록 글자 크기는 CSS에서 확대)
  const content = `<div class="calendar-day-number journal-day-number">${day}</div>`;
  return `<div class="${classes.join(' ')}" data-date="${date || ''}">${content}</div>`;
}

// AI 워크아웃 추천 핸들러
async function handleAIWorkoutRecommendation(event, date) {
  if (event) {
    event.stopPropagation(); // 캘린더 셀 클릭 이벤트 방지
  }
  
  try {
    // API 키 확인
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) {
      if (confirm('Gemini API 키가 설정되지 않았습니다.\n환경 설정에서 API 키를 입력해주세요.\n\n지금 환경 설정을 열까요?')) {
        if (typeof openSettingsModal === 'function') {
          openSettingsModal();
        } else {
          showScreen('myCareerScreen');
        }
      }
      return;
    }
    
    // 확인 대화상자 (재시도인 경우 스킵)
    const isRetry = event && event.isRetry;
    if (!isRetry) {
      // 커스텀 팝업으로 확인 요청
      const confirmed = await showAIRecommendationConfirmModal();
      if (!confirmed) {
        return;
      }
    }
    
    // 사용자 정보 가져오기 (여러 소스에서 확인)
    let currentUser = window.currentUser;
    if (!currentUser) {
      try {
        const stored = localStorage.getItem('currentUser');
        if (stored) {
          currentUser = JSON.parse(stored);
        }
      } catch (e) {
        console.warn('localStorage에서 사용자 정보 파싱 실패:', e);
      }
    }
    
    // 여전히 없으면 authUser에서 시도
    if (!currentUser) {
      try {
        const authUser = localStorage.getItem('authUser');
        if (authUser) {
          currentUser = JSON.parse(authUser);
        }
      } catch (e) {
        console.warn('authUser에서 사용자 정보 파싱 실패:', e);
      }
    }
    
    if (!currentUser) {
      showToast('사용자 정보를 찾을 수 없습니다. 사용자를 선택해주세요.', 'error');
      return;
    }
    
    // 사용자 정보 검증 및 로깅
    console.log('[AI] 사용자 확인:', currentUser.id);
    
    // challenge 값 확인 및 경고
    const challenge = String(currentUser.challenge || 'Fitness').trim();
    if (!challenge || challenge === 'Fitness') {
      console.warn('[AI] 목적 미설정');
    }
    
    // 컨디션별 강도 보정 화면 먼저 띄워 입력 받은 뒤 추천 로직에 반영
    if (typeof showRPEModalForAIRecommendation === 'function') {
      showRPEModalForAIRecommendation(date, currentUser, apiKey);
    } else {
      showWorkoutRecommendationModal();
      await analyzeAndRecommendWorkouts(date, currentUser, apiKey);
    }
    
  } catch (error) {
    console.error('AI 워크아웃 추천 오류:', error);
    // 모달 내에서 오류가 표시되므로 여기서는 토스트만 표시
    if (typeof showToast === 'function') {
      showToast('워크아웃 추천 중 오류가 발생했습니다. 모달에서 자세한 내용을 확인하세요.', 'error');
    }
  }
}

// 훈련일지 날짜 클릭 핸들러
async function handleTrainingDayClick(date, resultData) {
  try {
    // API 키 확인
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) {
      if (confirm('Gemini API 키가 설정되지 않았습니다.\n환경 설정에서 API 키를 입력해주세요.\n\n지금 환경 설정을 열까요?')) {
        if (typeof openSettingsModal === 'function') {
          openSettingsModal();
        } else {
          showScreen('myCareerScreen');
        }
      }
      return;
    }
    
    // 모달 표시
    showTrainingAnalysisModal();
    
    // 사용자 정보 가져오기
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!currentUser) {
      document.getElementById('trainingAnalysisContent').innerHTML = '<div class="error-message">사용자 정보를 찾을 수 없습니다.</div>';
      return;
    }
    
    // 분석 실행
    await analyzeTrainingWithGemini(date, resultData, currentUser, apiKey);
    
  } catch (error) {
    console.error('훈련 분석 오류:', error);
    document.getElementById('trainingAnalysisContent').innerHTML = 
      `<div class="error-message">분석 중 오류가 발생했습니다: ${error.message}</div>`;
  }
}

// Gemini API를 사용한 훈련 분석
async function analyzeTrainingWithGemini(date, resultData, user, apiKey) {
  const contentDiv = document.getElementById('trainingAnalysisContent');
  
  // 초기 로딩 메시지 표시 (원래 디자인)
  if (contentDiv) {
    contentDiv.innerHTML = `
      <div class="ai-loading-container">
        <div class="ai-brain-animation">
          <div class="ai-neural-network">
            <div class="neural-node node-1"></div>
            <div class="neural-node node-2"></div>
            <div class="neural-node node-3"></div>
            <div class="neural-node node-4"></div>
            <div class="neural-node node-5"></div>
            <div class="neural-node node-6"></div>
            <div class="neural-connection conn-1"></div>
            <div class="neural-connection conn-2"></div>
            <div class="neural-connection conn-3"></div>
            <div class="neural-connection conn-4"></div>
            <div class="neural-connection conn-5"></div>
            <div class="neural-connection conn-6"></div>
          </div>
          <div class="ai-particles">
            <div class="particle particle-1"></div>
            <div class="particle particle-2"></div>
            <div class="particle particle-3"></div>
            <div class="particle particle-4"></div>
            <div class="particle particle-5"></div>
            <div class="particle particle-6"></div>
          </div>
        </div>
        <div class="ai-loading-text">
          <div class="ai-title">🤖 AI 최첨단 분석 엔진 가동 중</div>
          <div class="ai-status">
            <span class="ai-status-item active">데이터 전처리 중</span>
            <span class="ai-status-item">머신러닝 모델 적용 중</span>
            <span class="ai-status-item">딥러닝 분석 수행 중</span>
            <span class="ai-status-item">패턴 인식 및 예측 중</span>
            <span class="ai-status-item">종합 평가 생성 중</span>
          </div>
        </div>
      </div>
    `;
    
    // AI 상태 텍스트 순환 애니메이션
    let statusIndex = 0;
    const statusItems = contentDiv.querySelectorAll('.ai-status-item');
    if (statusItems.length > 0) {
      const statusInterval = setInterval(() => {
        statusItems.forEach((item, index) => {
          item.classList.remove('active');
          if (index === statusIndex) {
            item.classList.add('active');
          }
        });
        statusIndex = (statusIndex + 1) % statusItems.length;
      }, 1500);
      
      // 분석 완료 시 인터벌 정리
      window.trainingAnalysisStatusInterval = statusInterval;
    }
  }
  
  // 재시도 설정 (고정 지연: 2초, 4초, 8초)
  const RETRY_DELAYS = [2000, 4000, 8000]; // 2초, 4초, 8초
  const MAX_RETRIES_PER_MODEL = 3; // 모델당 최대 재시도 횟수
  
  // 토큰 제한 설정 (안정적인 응답을 위해 제한)
  const MAX_OUTPUT_TOKENS = 8192; // 최대 출력 토큰 수 (응답 크기 제한) - 완전한 분석을 위해 증가 (4096 -> 8192)
  const MAX_INPUT_TOKENS = 8192; // 최대 입력 토큰 수 (프롬프트 크기 제한) - 과거 데이터 포함으로 증가
  
  try {
    // 훈련 데이터 포맷팅
    const workoutName = resultData.workout_name || resultData.actual_workout_id || '워크아웃';
    const workoutId = resultData.workout_id || resultData.actual_workout_id;
    const durationMin = resultData.duration_min || 0;
    const avgPower = Math.round(resultData.avg_power || 0);
    const np = Math.round(resultData.np || resultData.avg_power || 0);
    const tss = Math.round(resultData.tss || 0);
    const hrAvg = Math.round(resultData.hr_avg || 0);
    const ftp = user.ftp || 0;
    const weight = user.weight || 0;
    
    // 워크아웃 프로그램 상세 정보 조회
    let workoutDetails = null;
    if (workoutId) {
      try {
        const ensureBaseUrl = () => {
          const base = window.GAS_URL;
          if (!base) throw new Error('GAS_URL is not set');
          return base;
        };
        
        const baseUrl = ensureBaseUrl();
        const params = new URLSearchParams({
          action: 'getWorkout',
          id: workoutId
        });
        const response = await fetch(`${baseUrl}?${params.toString()}`);
        const result = await response.json();
        
        if (result?.success && result.item) {
          workoutDetails = result.item;
        }
      } catch (error) {
        console.warn('워크아웃 상세 정보 조회 실패:', error);
      }
    }
    
    // 과거 훈련 데이터 조회 (최근 30일)
    let pastTrainingData = [];
    try {
      const ensureBaseUrl = () => {
        const base = window.GAS_URL;
        if (!base) throw new Error('GAS_URL is not set');
        return base;
      };
      
      const baseUrl = ensureBaseUrl();
      const today = new Date(date);
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 30); // 30일 전부터
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0]; // 어제까지
      
      const params = new URLSearchParams({
        action: 'getScheduleResultsByUser',
        userId: user.id,
        startDate: startDateStr,
        endDate: endDateStr
      });
      const response = await fetch(`${baseUrl}?${params.toString()}`);
      const result = await response.json();
      
      if (result?.success && Array.isArray(result.items)) {
        // 최근 10개만 선택 (토큰 제한 고려)
        pastTrainingData = result.items
          .filter(item => item.completed_at && new Date(item.completed_at).toISOString().split('T')[0] < date)
          .slice(0, 10)
          .map(item => ({
            date: new Date(item.completed_at).toISOString().split('T')[0],
            workout: item.workout_name || '알 수 없음',
            duration: item.duration_min || 0,
            avgPower: Math.round(item.avg_power || 0),
            np: Math.round(item.np || item.avg_power || 0),
            tss: Math.round(item.tss || 0),
            hrAvg: Math.round(item.hr_avg || 0)
          }));
      }
    } catch (error) {
      console.warn('과거 훈련 데이터 조회 실패:', error);
    }
    
    // 워크아웃 프로그램 정보 포맷팅
    let workoutProgramText = '';
    if (workoutDetails && workoutDetails.segments && Array.isArray(workoutDetails.segments)) {
      const segments = workoutDetails.segments.map(seg => {
        const duration = Math.round((seg.duration_sec || 0) / 60);
        const targetType = seg.target_type || 'ftp_pct';
        let targetValue = seg.target_value || 100;
        
        if (targetType === 'dual' && typeof targetValue === 'string') {
          const dualSep = targetValue.includes('~') ? '~' : (targetValue.includes('/') ? '/' : null);
          const parts = dualSep ? targetValue.split(dualSep).map(s => s.trim()) : [targetValue];
          targetValue = parts.length >= 2 ? `${parts[0]}% FTP / ${parts[1]} RPM` : `${targetValue}% FTP`;
        } else if (targetType === 'ftp_pct') {
          targetValue = `${targetValue}% FTP`;
        } else if (targetType === 'cadence_rpm') {
          targetValue = `${targetValue} RPM`;
        }
        
        return `- ${seg.label || seg.segment_type || '세그먼트'}: ${duration}분, ${targetValue} (${seg.segment_type || 'unknown'})`;
      }).join('\n');
      
      workoutProgramText = `\n**워크아웃 프로그램 상세:**
${segments}`;
    }
    
    // 과거 훈련 데이터 포맷팅
    let pastTrainingText = '';
    if (pastTrainingData.length > 0) {
      const pastSummary = pastTrainingData.map(item => 
        `- ${item.date}: ${item.workout} (${item.duration}분, 평균파워: ${item.avgPower}W, NP: ${item.np}W, TSS: ${item.tss}, 심박수: ${item.hrAvg} bpm)`
      ).join('\n');
      
      // 통계 계산
      const avgPowerHistory = pastTrainingData.map(d => d.avgPower).filter(p => p > 0);
      const tssHistory = pastTrainingData.map(d => d.tss).filter(t => t > 0);
      const avgPowerAvg = avgPowerHistory.length > 0 
        ? Math.round(avgPowerHistory.reduce((a, b) => a + b, 0) / avgPowerHistory.length)
        : 0;
      const tssAvg = tssHistory.length > 0
        ? Math.round(tssHistory.reduce((a, b) => a + b, 0) / tssHistory.length)
        : 0;
      
      pastTrainingText = `\n**과거 훈련 이력 (최근 ${pastTrainingData.length}회):**
${pastSummary}

**과거 훈련 통계:**
- 평균 파워 평균: ${avgPowerAvg}W
- TSS 평균: ${tssAvg}
- 현재 훈련 대비: 평균 파워 ${avgPower > avgPowerAvg ? '+' : ''}${avgPower - avgPowerAvg}W (${avgPowerAvg > 0 ? ((avgPower / avgPowerAvg - 1) * 100).toFixed(1) : 0}%), TSS ${tss > tssAvg ? '+' : ''}${tss - tssAvg} (${tssAvg > 0 ? ((tss / tssAvg - 1) * 100).toFixed(1) : 0}%)`;
    }
    
    // 프롬프트 생성 (JSON 형식으로 구조화된 응답 요청)
    // 과거 데이터와 워크아웃 프로그램 정보 포함
    const prompt = `다음은 사이클 훈련 데이터입니다. 전문적인 분석, 평가, 그리고 코칭 피드백을 제공해주세요. 과거 훈련 데이터를 활용하여 더 정밀한 분석을 수행해주세요.

**현재 훈련 정보:**
- 날짜: ${date}
- 워크아웃: ${workoutName}
- 훈련 시간: ${durationMin}분

**현재 훈련 데이터:**
- 평균 파워: ${avgPower}W
- NP (Normalized Power): ${np}W
- TSS (Training Stress Score): ${tss}
- 평균 심박수: ${hrAvg} bpm${workoutProgramText}

**사용자 정보:**
- FTP (Functional Threshold Power): ${ftp}W
- 체중: ${weight}kg
- W/kg: ${weight > 0 ? (ftp / weight).toFixed(2) : 'N/A'}${pastTrainingText}

다음 JSON 형식으로 응답해주세요. 지표는 숫자로, 평가는 0-100 점수로, 텍스트는 한국어로 제공해주세요:

{
  "summary": {
    "intensityLevel": "낮음|보통|높음|매우높음",
    "intensityScore": 0-100,
    "goalAchievement": 0-100,
    "overallRating": 0-100
  },
  "metrics": {
    "powerAnalysis": {
      "avgPowerPercent": ${ftp > 0 ? ((avgPower / ftp) * 100).toFixed(1) : 0},
      "npPercent": ${ftp > 0 ? ((np / ftp) * 100).toFixed(1) : 0},
      "powerZone": "회복|지구력|템포|역치|VO2max|무산소|신경근",
      "powerScore": 0-100
    },
    "tssAnalysis": {
      "tssValue": ${tss},
      "tssCategory": "낮음|보통|높음|매우높음",
      "recoveryTime": "시간",
      "tssScore": 0-100
    },
    "heartRateAnalysis": {
      "hrAvg": ${hrAvg},
      "hrZone": "회복|지구력|역치|무산소",
      "hrScore": 0-100
    }
  },
  "coaching": {
    "strengths": ["강점1", "강점2", "강점3"],
    "improvements": ["개선점1", "개선점2", "개선점3"],
    "recommendations": ["권장사항1", "권장사항2", "권장사항3"]
  },
  "overallAnalysis": "종합적인 훈련 평가와 장기적인 발전 방향에 대한 상세한 서술형 분석 (2-3 문단)"
}

중요: 반드시 유효한 JSON 형식으로만 응답하고, 다른 설명이나 마크다운 없이 순수 JSON만 제공해주세요.`;

    // 모델 우선순위 설정 (최고 분석 능력 기준)
    // 1순위: Gemini 2.5 Pro - 최고 성능, 복잡한 분석 작업에 최적화, 2M 토큰 컨텍스트
    // 2순위: Gemini 1.5 Pro - 강력한 분석 능력, 안정적
    // 3순위: Gemini 2.5 Flash - 빠른 응답, 효율적
    const PRIMARY_MODEL = 'gemini-2.5-pro';
    const SECONDARY_MODEL = 'gemini-1.5-pro';
    const TERTIARY_MODEL = 'gemini-2.5-flash';
    
    // 사용 가능한 모델 목록 가져오기 함수
    const getAvailableModels = async () => {
      try {
        // v1beta API로 사용 가능한 모델 조회
        const modelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const modelsResponse = await fetch(modelsUrl);
        
        if (!modelsResponse.ok) {
          throw new Error('사용 가능한 모델을 조회할 수 없습니다. API 키를 확인해주세요.');
        }
        
        const modelsData = await modelsResponse.json();
        const availableModels = modelsData.models || [];
        
        // generateContent를 지원하는 Gemini 모델 찾기
        const supportedModels = availableModels
          .filter(m => m.name && m.name.includes('gemini') && 
                       (m.supportedGenerationMethods || []).includes('generateContent'))
          .map(m => ({
            name: m.name,
            shortName: m.name.split('/').pop(), // models/gemini-pro -> gemini-pro
            displayName: m.displayName || m.name
          }));
        
        if (supportedModels.length === 0) {
          throw new Error('generateContent를 지원하는 Gemini 모델을 찾을 수 없습니다.');
        }
        
        // 우선순위 정렬: 2.5 Flash -> 2.0 Flash Exp -> 2.5 Pro -> 기타 (속도 우선)
        const prioritizedModels = [];
        const primaryModel = supportedModels.find(m => m.shortName === PRIMARY_MODEL);
        const secondaryModel = supportedModels.find(m => m.shortName === SECONDARY_MODEL);
        const tertiaryModel = supportedModels.find(m => m.shortName === TERTIARY_MODEL);
        
        if (primaryModel) prioritizedModels.push(primaryModel);
        if (secondaryModel) prioritizedModels.push(secondaryModel);
        if (tertiaryModel) prioritizedModels.push(tertiaryModel);
        
        // 나머지 모델 추가
        supportedModels.forEach(m => {
          if (m.shortName !== PRIMARY_MODEL && 
              m.shortName !== SECONDARY_MODEL && 
              m.shortName !== TERTIARY_MODEL) {
            prioritizedModels.push(m);
          }
        });
        
        return prioritizedModels;
      } catch (error) {
        console.error('모델 목록 조회 실패:', error);
        throw error;
      }
    };
    
    // 사용 가능한 모델 및 API 버전 확인
    let modelName = localStorage.getItem('geminiModelName');
    let apiVersion = localStorage.getItem('geminiApiVersion') || 'v1beta';
    let availableModelsList = [];
    let currentModelIndex = 0;
    let modelFailureCount = 0; // 현재 모델 실패 횟수 추적
    let triedModels = []; // 시도한 모델 목록 추적
    const MAX_MODEL_FAILURES = MAX_RETRIES_PER_MODEL; // 모델 전환 전 최대 실패 횟수 (재시도 횟수와 동일)
    
    // 모델 목록 가져오기
    try {
      availableModelsList = await getAvailableModels();
      
        // 1순위 모델(1.5 Pro)로 초기화
        const primaryModelExists = availableModelsList.find(m => m.shortName === PRIMARY_MODEL);
        if (primaryModelExists) {
          modelName = PRIMARY_MODEL;
          currentModelIndex = availableModelsList.findIndex(m => m.shortName === PRIMARY_MODEL);
          console.log(`1순위 모델 설정: ${modelName}`);
        } else {
          // 1순위 모델이 없으면 2순위 모델 시도
          const secondaryModelExists = availableModelsList.find(m => m.shortName === SECONDARY_MODEL);
          if (secondaryModelExists) {
            modelName = SECONDARY_MODEL;
            currentModelIndex = availableModelsList.findIndex(m => m.shortName === SECONDARY_MODEL);
            console.log(`1순위 모델을 사용할 수 없어 2순위 모델 설정: ${modelName}`);
          } else {
            // 2순위도 없으면 3순위 모델 시도
            const tertiaryModelExists = availableModelsList.find(m => m.shortName === TERTIARY_MODEL);
            if (tertiaryModelExists) {
              modelName = TERTIARY_MODEL;
              currentModelIndex = availableModelsList.findIndex(m => m.shortName === TERTIARY_MODEL);
              console.log(`2순위 모델도 사용할 수 없어 3순위 모델 설정: ${modelName}`);
            } else {
              // 모두 없으면 첫 번째 사용 가능한 모델 사용
              modelName = availableModelsList[0].shortName;
              currentModelIndex = 0;
              console.log(`우선순위 모델을 사용할 수 없어 ${modelName} 사용`);
            }
          }
        }
        
        apiVersion = 'v1beta';
        localStorage.setItem('geminiModelName', modelName);
        localStorage.setItem('geminiApiVersion', apiVersion);
        
        // 초기 모델을 시도한 목록에 추가
        triedModels = [modelName];
    } catch (error) {
      console.warn('모델 목록 조회 실패, 1순위 모델 사용:', error);
      // 1순위 모델로 폴백
      modelName = PRIMARY_MODEL;
      apiVersion = 'v1beta';
      availableModelsList = [];
    }
    
    // 모델 전환 함수 (우선순위에 따라 다음 모델로 전환)
    const switchToNextModel = () => {
      if (availableModelsList.length === 0) {
        throw new Error('사용 가능한 모델이 없습니다.');
      }
      
      // 이미 시도한 모델 개수 확인 (최대 3개 모델 시도)
      if (triedModels.length >= 3) {
        throw new Error(`최대 3개 모델까지 시도했지만 모두 실패했습니다.`);
      }
      
      // 현재 모델을 시도한 목록에 추가
      if (modelName && !triedModels.includes(modelName)) {
        triedModels.push(modelName);
      }
      
      // 사용하지 않은 다음 모델 찾기 (우선순위에 따라)
      let nextModel = null;
      
      // 1순위 모델(1.5 Pro)이 시도되지 않았으면 시도
      if (!triedModels.includes(PRIMARY_MODEL)) {
        nextModel = availableModelsList.find(m => m.shortName === PRIMARY_MODEL);
      }
      
      // 2순위 모델(2.0 Flash Exp)이 시도되지 않았으면 시도
      if (!nextModel && !triedModels.includes(SECONDARY_MODEL)) {
        nextModel = availableModelsList.find(m => m.shortName === SECONDARY_MODEL);
      }
      
      // 3순위 모델(1.5 Flash)이 시도되지 않았으면 시도
      if (!nextModel && !triedModels.includes(TERTIARY_MODEL)) {
        nextModel = availableModelsList.find(m => m.shortName === TERTIARY_MODEL);
      }
      
      // 우선순위 모델이 모두 시도되었으면 다른 사용하지 않은 모델 찾기
      if (!nextModel) {
        nextModel = availableModelsList.find(m => !triedModels.includes(m.shortName));
      }
      
      if (!nextModel) {
        throw new Error('사용 가능한 다른 모델이 없습니다.');
      }
      
      modelName = nextModel.shortName;
      currentModelIndex = availableModelsList.findIndex(m => m.shortName === modelName);
      modelFailureCount = 0; // 실패 횟수 리셋
      
      // 저장
      localStorage.setItem('geminiModelName', modelName);
      
      const displayName = nextModel.displayName || modelName;
      console.log(`모델 전환: ${modelName} (${displayName}), 시도한 모델: [${triedModels.join(', ')}]`);
      
      if (contentDiv) {
        const switchMessage = `모델 전환 중... (${displayName})`;
        updateLoadingMessage(switchMessage, 'model-switch');
      }
    };
    
    // 로딩 메시지 업데이트 함수 (원래 디자인)
    const updateLoadingMessage = (message, type = 'default') => {
      if (!contentDiv) return;
      
      // 기존 인터벌 정리
      if (window.trainingAnalysisStatusInterval) {
        clearInterval(window.trainingAnalysisStatusInterval);
        window.trainingAnalysisStatusInterval = null;
      }
      
      const titleText = type === 'model-switch' ? '모델 전환 중' : 
                       type === 'retry' ? '재시도 중' : 
                       type === 'network' ? '네트워크 연결 중' : 
                       'AI 분석 진행 중';
      
      contentDiv.innerHTML = `
        <div class="ai-loading-container">
          <div class="ai-brain-animation">
            <div class="ai-neural-network">
              <div class="neural-node node-1"></div>
              <div class="neural-node node-2"></div>
              <div class="neural-node node-3"></div>
              <div class="neural-node node-4"></div>
              <div class="neural-node node-5"></div>
              <div class="neural-node node-6"></div>
              <div class="neural-connection conn-1"></div>
              <div class="neural-connection conn-2"></div>
              <div class="neural-connection conn-3"></div>
              <div class="neural-connection conn-4"></div>
              <div class="neural-connection conn-5"></div>
              <div class="neural-connection conn-6"></div>
            </div>
            <div class="ai-particles">
              <div class="particle particle-1"></div>
              <div class="particle particle-2"></div>
              <div class="particle particle-3"></div>
              <div class="particle particle-4"></div>
              <div class="particle particle-5"></div>
              <div class="particle particle-6"></div>
            </div>
          </div>
          <div class="ai-loading-text">
            <div class="ai-title">${titleText}</div>
            <div class="ai-status">
              <span class="ai-status-item active">${message}</span>
            </div>
          </div>
        </div>
      `;
    };
    
    // API 호출 함수 (재시도 및 모델 전환 로직 포함)
    const callGeminiAPI = async (retryCount = 0, isModelSwitch = false) => {
      let currentApiVersion = apiVersion;
      let apiUrl = `https://generativelanguage.googleapis.com/${currentApiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
      
      // 모델 전환 시 사용자에게 알림
      if (isModelSwitch && contentDiv) {
        updateLoadingMessage(`모델 변경: ${modelName}로 분석 시도 중...`, 'model-switch');
      }
      
      // 요청 본문 구성 (토큰 제한 포함)
      const requestBody = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.7,
          topP: 0.8,
          topK: 40
        }
      };
      
      try {
        let response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        });
        
        // v1beta가 실패하면 v1 시도 (재시도가 아닌 API 버전 폴백)
        if (!response.ok && currentApiVersion === 'v1beta' && response.status !== 503 && !response.statusText.includes('overloaded')) {
          console.log('v1beta API 실패, v1 시도 중...');
          currentApiVersion = 'v1';
          apiUrl = `https://generativelanguage.googleapis.com/${currentApiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
          response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
          });
          
          // 성공하면 API 버전 저장
          if (response.ok) {
            localStorage.setItem('geminiApiVersion', currentApiVersion);
            apiVersion = currentApiVersion;
            modelFailureCount = 0; // 성공 시 실패 횟수 리셋
          }
        }
        
        // 응답 상태 확인 및 처리
        if (!response.ok) {
          // 에러 응답 body 읽기 (한 번만)
          let errorData = {};
          let errorMessage = '';
          
          try {
            const responseText = await response.text();
            if (responseText) {
              try {
                errorData = JSON.parse(responseText);
                errorMessage = errorData.error?.message || '';
              } catch (e) {
                errorMessage = responseText.substring(0, 200);
              }
            }
          } catch (e) {
            errorMessage = response.statusText || `HTTP ${response.status}`;
          }
          
          // 503/429 오류 처리
          if (response.status === 503 || response.status === 429 || 
              errorMessage.includes('overloaded') || errorMessage.includes('overload')) {
            
            // 모델 실패 횟수 증가
            modelFailureCount++;
            
            // 모델 실패 횟수가 임계값에 도달하면 모델 전환
            if (modelFailureCount >= MAX_MODEL_FAILURES && availableModelsList.length > 0 && triedModels.length < 3) {
              console.log(`모델 ${modelName}이(가) ${modelFailureCount}번 실패했습니다. 다른 모델로 전환합니다. (시도한 모델: ${triedModels.length}/3)`);
              try {
                switchToNextModel();
                // 모델 전환 후 즉시 재시도 (retryCount는 유지)
                return callGeminiAPI(retryCount, true);
              } catch (error) {
                console.error('모델 전환 실패:', error);
                // 전환 실패 시 기존 모델로 계속 재시도
              }
            }
            
            // 최대 재시도 횟수 확인
            if (retryCount >= MAX_RETRIES_PER_MODEL) {
              // 재시도 횟수 초과 시 모델 전환 시도
              if (availableModelsList.length > 0 && !isModelSwitch && triedModels.length < 3) {
                console.log(`재시도 횟수 초과. 다른 모델로 전환 시도... (시도한 모델: ${triedModels.length}/3)`);
                try {
                  switchToNextModel();
                  // 모델 전환 후 재시도 횟수 리셋하여 다시 시도
                  return callGeminiAPI(0, true);
                } catch (error) {
                  console.error('모델 전환 실패:', error);
                }
              }
              throw new Error(`서버가 과부하 상태입니다. ${MAX_RETRIES_PER_MODEL}번 재시도 후에도 응답을 받을 수 없었습니다. (시도한 모델: ${triedModels.join(', ')})`);
            }
            
            // 고정 지연 시간 사용 (2초, 4초, 8초)
            const delay = retryCount < RETRY_DELAYS.length 
              ? RETRY_DELAYS[retryCount] 
              : RETRY_DELAYS[RETRY_DELAYS.length - 1]; // 마지막 지연 시간 반복
            
            console.log(`서버 과부하 감지 (재시도 ${retryCount + 1}/${MAX_RETRIES_PER_MODEL}, 모델 실패: ${modelFailureCount}/${MAX_MODEL_FAILURES}). ${delay}ms 후 재시도...`);
            
            // 사용자에게 진행 상황 표시
            updateLoadingMessage(`서버 과부하 감지. 재시도 중... (${retryCount + 1}/${MAX_RETRIES_PER_MODEL})`, 'retry');
            
            // 지연 후 재시도
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // 재시도
            return callGeminiAPI(retryCount + 1, false);
          }
          
          // 기타 HTTP 오류 처리
          modelFailureCount++;
          
          // 모델 실패 횟수가 임계값에 도달하면 모델 전환
          if (modelFailureCount >= MAX_MODEL_FAILURES && availableModelsList.length > 0 && triedModels.length < MAX_MODEL_ATTEMPTS) {
            console.log(`모델 ${modelName}이(가) ${modelFailureCount}번 실패했습니다. 다른 모델로 전환합니다. (시도한 모델: ${triedModels.length}/${MAX_MODEL_ATTEMPTS})`);
            try {
              switchToNextModel();
              // 모델 전환 후 즉시 재시도
              return callGeminiAPI(0, true);
            } catch (error) {
              console.error('모델 전환 실패:', error);
            }
          }
          
          throw new Error(errorMessage || `API 오류: ${response.status}`);
        }
        
        // 성공 시 JSON 파싱하여 반환 (워크아웃 추천 API와 동일한 패턴)
        const data = await response.json();
        
        // 응답 데이터 검증
        if (!data || !data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
          throw new Error('API 응답에 candidates가 없습니다.');
        }
        
        const candidate = data.candidates[0];
        if (!candidate || !candidate.content) {
          throw new Error('API 응답에 content가 없습니다.');
        }
        
        if (!candidate.content.parts || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
          throw new Error('API 응답에 parts가 없습니다.');
        }
        
        if (!candidate.content.parts[0] || !candidate.content.parts[0].text) {
          throw new Error('API 응답에 text가 없습니다.');
        }
        
        // 응답 완전성 검증 (finishReason 체크)
        const finishReason = candidate.finishReason || candidate.finish_reason;
        const responseText = candidate.content.parts[0].text;
        
        // MAX_TOKENS인 경우 부분 응답이라도 처리 시도
        if (finishReason === 'MAX_TOKENS') {
          console.warn('응답이 토큰 제한에 도달했습니다. 부분 응답을 처리합니다. finishReason:', finishReason);
          // JSON이 완전한지 확인
          const jsonStart = responseText.indexOf('{');
          const jsonEnd = responseText.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1) {
            const jsonText = responseText.substring(jsonStart, jsonEnd + 1);
            const openBraces = (jsonText.match(/{/g) || []).length;
            const closeBraces = (jsonText.match(/}/g) || []).length;
            // JSON이 완전하면 부분 응답이라도 허용
            if (openBraces === closeBraces && responseText.length >= 200) {
              console.log('MAX_TOKENS이지만 JSON이 완전합니다. 부분 응답을 허용합니다.');
              // 부분 응답 허용 - 계속 진행
            } else {
              // JSON이 불완전하면 토큰 제한 증가 후 재시도
              console.warn('MAX_TOKENS이고 JSON이 불완전합니다. 토큰 제한 증가 후 재시도합니다.');
              throw new Error(`API 응답이 토큰 제한에 도달했습니다. finishReason: ${finishReason}`);
            }
          } else if (responseText.length >= 200) {
            // JSON이 없지만 텍스트가 충분히 길면 허용
            console.log('MAX_TOKENS이지만 응답 텍스트가 충분합니다. 부분 응답을 허용합니다.');
            // 부분 응답 허용 - 계속 진행
          } else {
            throw new Error(`API 응답이 토큰 제한에 도달했고 응답이 너무 짧습니다. finishReason: ${finishReason}`);
          }
        } else if (finishReason && finishReason !== 'STOP' && finishReason !== 'END_OF_TURN') {
          console.warn('응답이 불완전합니다. finishReason:', finishReason);
          throw new Error(`API 응답이 불완전합니다. finishReason: ${finishReason}`);
        }
        
        // 텍스트가 완전한지 확인 (최소 길이 체크)
        // responseText는 위에서 이미 추출됨
        if (responseText.length < 50) {
          console.warn('응답 텍스트가 너무 짧습니다:', responseText);
          throw new Error('API 응답이 불완전합니다. 응답이 중간에 잘렸을 수 있습니다.');
        }
        
        // JSON 완전성 사전 검증 (간단한 체크)
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const jsonText = responseText.substring(jsonStart, jsonEnd + 1);
          // 중괄호 균형 확인
          const openBraces = (jsonText.match(/{/g) || []).length;
          const closeBraces = (jsonText.match(/}/g) || []).length;
          if (openBraces !== closeBraces) {
            console.warn('JSON 중괄호 불균형 감지:', { openBraces, closeBraces });
            throw new Error('API 응답이 불완전합니다. JSON 구조가 완전하지 않습니다.');
          }
        }
        
        // 성공 시 실패 횟수 리셋
        modelFailureCount = 0;
        return data;
        
      } catch (error) {
        // 에러 타입별 처리
        const isNetworkError = error.message.includes('Failed to fetch') || 
                              error.message.includes('NetworkError') ||
                              error.message.includes('timeout') ||
                              error.message.includes('network');
        
        const isResponseError = error.message.includes('candidates') ||
                               error.message.includes('content') ||
                               error.message.includes('parts') ||
                               error.message.includes('text') ||
                               error.message.includes('불완전');
        
        // 네트워크 오류나 응답 오류인 경우 재시도
        if (retryCount < MAX_RETRIES_PER_MODEL && (isNetworkError || isResponseError)) {
          // 모델 실패 횟수 증가
          modelFailureCount++;
          
          // 모델 실패 횟수가 임계값에 도달하면 모델 전환
          if (modelFailureCount >= MAX_MODEL_FAILURES && availableModelsList.length > 0 && triedModels.length < 3) {
            console.log(`모델 ${modelName}이(가) ${modelFailureCount}번 실패했습니다. 다른 모델로 전환합니다. (시도한 모델: ${triedModels.length}/3)`);
            try {
              switchToNextModel();
              // 모델 전환 후 즉시 재시도
              return callGeminiAPI(0, true);
            } catch (switchError) {
              console.error('모델 전환 실패:', switchError);
              // 전환 실패 시 기존 모델로 계속 재시도
            }
          }
          
          // 고정 지연 시간 사용 (2초, 4초, 8초)
          const delay = retryCount < RETRY_DELAYS.length 
            ? RETRY_DELAYS[retryCount] 
            : RETRY_DELAYS[RETRY_DELAYS.length - 1]; // 마지막 지연 시간 반복
          
          const errorType = isNetworkError ? '네트워크' : '응답';
          console.log(`${errorType} 오류 감지 (재시도 ${retryCount + 1}/${MAX_RETRIES_PER_MODEL}, 모델 실패: ${modelFailureCount}/${MAX_MODEL_FAILURES}). ${delay}ms 후 재시도...`);
          
          updateLoadingMessage(`${errorType} 오류 발생. 재시도 중... (${retryCount + 1}/${MAX_RETRIES_PER_MODEL})`, isNetworkError ? 'network' : 'retry');
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return callGeminiAPI(retryCount + 1, false);
        }
        
        // 최종 실패 시에도 모델 전환 시도
        if (availableModelsList.length > 0 && !isModelSwitch && modelFailureCount >= MAX_MODEL_FAILURES && triedModels.length < 3) {
          console.log(`최종 실패. 다른 모델로 전환 시도... (시도한 모델: ${triedModels.length}/3)`);
          try {
            switchToNextModel();
            return callGeminiAPI(0, true);
          } catch (switchError) {
            console.error('모델 전환 실패:', switchError);
            // 전환 실패 시 에러를 그대로 throw
          }
        }
        
        throw error;
      }
    };
    
    // API 호출 시작 시 로딩 메시지 업데이트
    if (contentDiv) {
      updateLoadingMessage(`모델 ${modelName}로 분석 요청 중...`, 'default');
    }
    
    // API 호출 실행 (워크아웃 추천 API와 동일한 패턴으로 JSON 데이터 직접 반환)
    const data = await callGeminiAPI();
    
    // 워크아웃 추천 API와 동일한 안전한 접근 방식 사용
    const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!responseText || typeof responseText !== 'string') {
      console.error('API 응답 데이터:', JSON.stringify(data, null, 2));
      throw new Error('API 응답에 유효한 텍스트가 없습니다. 응답 구조를 확인하세요.');
    }
    
    let analysisText = responseText;
    
    // 강화된 JSON 파싱 및 복구 함수
    const parseAndRecoverJSON = (text) => {
      if (!text || typeof text !== 'string') {
        return null;
      }
      
      // 1단계: 마크다운 코드 블록 제거
      let cleanedText = text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      
      // 2단계: JSON 객체 시작/끝 찾기
      const jsonStart = cleanedText.indexOf('{');
      const jsonEnd = cleanedText.lastIndexOf('}');
      
      if (jsonStart === -1) {
        console.warn('JSON 시작 문자({)를 찾을 수 없습니다.');
        return null;
      }
      
      if (jsonEnd === -1 || jsonEnd <= jsonStart) {
        console.warn('JSON 종료 문자(})를 찾을 수 없거나 잘못된 위치입니다.');
        // 불완전한 JSON 복구 시도
        cleanedText = cleanedText.substring(jsonStart);
        // 마지막 불완전한 속성 제거 시도
        cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*[^,}]*$/, '');
        cleanedText = cleanedText.replace(/,\s*$/, '');
        cleanedText += '}';
      } else {
        cleanedText = cleanedText.substring(jsonStart, jsonEnd + 1);
      }
      
      // 3단계: JSON 파싱 시도
      try {
        return JSON.parse(cleanedText);
      } catch (parseError) {
        console.warn('JSON 파싱 실패, 복구 시도 중...', parseError.message);
        
        // 4단계: 불완전한 JSON 복구 시도
        try {
          // 위치 기반 복구: parseError.message에서 position 추출
          const positionMatch = parseError.message.match(/position (\d+)/);
          if (positionMatch) {
            const errorPosition = parseInt(positionMatch[1], 10);
            console.log(`오류 위치: ${errorPosition}, 전체 길이: ${cleanedText.length}`);
            
            // 오류 위치 주변 텍스트 확인
            const beforeError = cleanedText.substring(Math.max(0, errorPosition - 50), errorPosition);
            const atError = cleanedText.substring(errorPosition, Math.min(cleanedText.length, errorPosition + 50));
            console.log('오류 위치 이전:', beforeError);
            console.log('오류 위치:', atError);
            
            // 오류 위치 이전의 마지막 완전한 속성 찾기
            let safePosition = errorPosition;
            
            // 오류 위치 이전에서 마지막 완전한 속성의 끝 찾기
            // 쉼표나 닫는 중괄호를 찾아서 그 이전까지만 사용
            for (let i = errorPosition - 1; i >= 0; i--) {
              const char = cleanedText[i];
              if (char === '}' || char === ']') {
                // 닫는 괄호를 찾았으면 그 이후부터 문제
                safePosition = i + 1;
                break;
              } else if (char === ',' && i < errorPosition - 1) {
                // 쉼표를 찾았으면 그 이전까지만 사용
                // 하지만 이전 문자가 공백이면 더 앞으로
                let j = i - 1;
                while (j >= 0 && /\s/.test(cleanedText[j])) j--;
                if (j >= 0 && cleanedText[j] === '}' || cleanedText[j] === ']') {
                  safePosition = j + 1;
                  break;
                }
              }
            }
            
            // 안전한 위치까지만 사용
            cleanedText = cleanedText.substring(0, safePosition);
            console.log(`안전한 위치까지 자름: ${safePosition} (원래: ${errorPosition})`);
            
            // 마지막 불완전한 속성 제거
            cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*[^,}]*$/, '');
            cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*"[^"]*$/, '');
            cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*\[[^\]]*$/, '');
            cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*\{[^}]*$/, '');
            cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*\d+\.?\d*[^,}\]]*$/, '');
          } else {
            // 위치 정보가 없으면 일반 복구 시도
            // 불완전한 문자열 값 제거
            cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*"[^"]*$/, '');
            cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*[^,}]*$/, '');
            
            // 불완전한 배열 제거
            cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*\[[^\]]*$/, '');
            
            // 불완전한 객체 제거
            cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*\{[^}]*$/, '');
            
            // 불완전한 숫자 값 제거
            cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*\d+\.?\d*[^,}\]]*$/, '');
          }
          
          // 마지막 쉼표 제거
          cleanedText = cleanedText.replace(/,\s*}/g, '}');
          cleanedText = cleanedText.replace(/,\s*]/g, ']');
          
          // 닫는 중괄호 확인
          if (!cleanedText.endsWith('}')) {
            // 중괄호 개수 확인하여 닫기
            const openBraces = (cleanedText.match(/{/g) || []).length;
            const closeBraces = (cleanedText.match(/}/g) || []).length;
            const missingBraces = openBraces - closeBraces;
            for (let i = 0; i < missingBraces; i++) {
              cleanedText += '}';
            }
          }
          
          // 대괄호도 확인
          const openBrackets = (cleanedText.match(/\[/g) || []).length;
          const closeBrackets = (cleanedText.match(/\]/g) || []).length;
          const missingBrackets = openBrackets - closeBrackets;
          for (let i = 0; i < missingBrackets; i++) {
            cleanedText += ']';
          }
          
          // 최종 검증: JSON이 유효한지 확인
          const testParse = JSON.parse(cleanedText);
          console.log('JSON 복구 성공!');
          return testParse;
        } catch (recoverError) {
          console.warn('JSON 복구 실패:', recoverError.message);
          
          // 5단계: 최후의 수단 - 부분 JSON 추출
          try {
            // 최소한의 유효한 JSON 구조 추출
            const summaryMatch = cleanedText.match(/"summary"\s*:\s*\{[^}]*\}/);
            const metricsMatch = cleanedText.match(/"metrics"\s*:\s*\{[^}]*\}/);
            const coachingMatch = cleanedText.match(/"coaching"\s*:\s*\{[^}]*\}/);
            
            if (summaryMatch || metricsMatch || coachingMatch) {
              const partialData = {};
              if (summaryMatch) {
                try {
                  partialData.summary = JSON.parse('{' + summaryMatch[0] + '}').summary;
                } catch (e) {}
              }
              if (metricsMatch) {
                try {
                  partialData.metrics = JSON.parse('{' + metricsMatch[0] + '}').metrics;
                } catch (e) {}
              }
              if (coachingMatch) {
                try {
                  partialData.coaching = JSON.parse('{' + coachingMatch[0] + '}').coaching;
                } catch (e) {}
              }
              
              if (Object.keys(partialData).length > 0) {
                console.warn('부분 JSON 추출 성공');
                return partialData;
              }
            }
          } catch (e) {
            console.warn('부분 JSON 추출 실패:', e);
          }
          
          return null;
        }
      }
    };
    
    // JSON 파싱 시도 (강화된 복구 로직)
    let analysisData = parseAndRecoverJSON(analysisText);
    
    // JSON 파싱 실패 시 1회만 API 재호출 시도 (무한 루프 방지)
    if (!analysisData) {
      console.warn('JSON 파싱 실패, API 재호출 시도 (1회)...');
      updateLoadingMessage('응답 검증 중... (재시도)', 'retry');
      
      // API 재호출 (응답이 불완전했을 가능성) - 1회만 시도
      try {
        // 새로운 API 호출 (기존 재시도 로직과 분리, JSON 파싱 실패 전용)
        const retryData = await callGeminiAPI(0, false);
        const newResponseText = retryData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        if (newResponseText && newResponseText.length > analysisText.length) {
          console.log('새로운 응답이 더 깁니다. 새로운 응답 사용:', newResponseText.length, 'vs', analysisText.length);
          analysisText = newResponseText;
          analysisData = parseAndRecoverJSON(analysisText);
        } else if (newResponseText && newResponseText !== analysisText) {
          console.log('새로운 응답 시도, 길이:', newResponseText.length, '기존:', analysisText.length);
          // 새로운 응답도 시도
          const newAnalysisData = parseAndRecoverJSON(newResponseText);
          if (newAnalysisData) {
            analysisData = newAnalysisData;
            analysisText = newResponseText;
            console.log('새로운 응답으로 JSON 파싱 성공!');
          }
        }
      } catch (retryError) {
        console.error('API 재호출 실패:', retryError);
        // 재호출 실패 시 기존 텍스트로 복구 시도 계속
      }
    }
    
    if (!analysisData) {
      console.error('JSON 파싱 완전 실패 (모든 복구 시도 실패)');
      console.error('원본 텍스트 (처음 1000자):', analysisText.substring(0, 1000));
      console.error('원본 텍스트 (마지막 500자):', analysisText.substring(Math.max(0, analysisText.length - 500)));
      console.error('원본 텍스트 전체 길이:', analysisText.length);
      
      // 최종 폴백: 부분 데이터라도 표시
      throw new Error('JSON 파싱에 실패했습니다. API 응답이 불완전할 수 있습니다. 잠시 후 다시 시도해주세요.');
    }
    
    // 분석 결과 저장 (나중에 내보내기용). SOLO 훈련 시 컨디션별 강도 보정 정보 포함
    var bodyCondition = null;
    var intensityAdjustment = null;
    try {
      bodyCondition = localStorage.getItem('bodyCondition_' + date) || null;
      intensityAdjustment = window.trainingIntensityAdjustment || localStorage.getItem('trainingIntensityAdjustment') || null;
    } catch (e) { /* ignore */ }
    window.currentAnalysisReport = {
      date,
      workoutName,
      durationMin,
      avgPower,
      np,
      tss,
      hrAvg,
      ftp,
      weight,
      bodyCondition: bodyCondition || undefined,
      intensityAdjustment: intensityAdjustment != null ? String(intensityAdjustment) : undefined,
      analysis: analysisData ? JSON.stringify(analysisData, null, 2) : analysisText,
      analysisData: analysisData
    };
    
    // 인터벌 정리
    if (window.trainingAnalysisStatusInterval) {
      clearInterval(window.trainingAnalysisStatusInterval);
      window.trainingAnalysisStatusInterval = null;
    }
    
    // 결과 표시 (구조화된 데이터가 있으면 시각화, 없으면 텍스트). SOLO 시 컨디션 정보 전달
    if (analysisData) {
      contentDiv.innerHTML = renderVisualizedAnalysis(date, workoutName, durationMin, avgPower, np, tss, hrAvg, ftp, weight, analysisData, window.currentAnalysisReport.bodyCondition, window.currentAnalysisReport.intensityAdjustment);
      // 차트 렌더링 (비동기)
      setTimeout(() => renderAnalysisCharts(analysisData, avgPower, np, tss, hrAvg, ftp), 100);
    } else {
      // 폴백: 기존 텍스트 형식 (SOLO 시 컨디션 정보 표시)
      var condMeta = '';
      if (window.currentAnalysisReport && (window.currentAnalysisReport.bodyCondition || window.currentAnalysisReport.intensityAdjustment != null)) {
        var bc = window.currentAnalysisReport.bodyCondition || '선택';
        var adj = window.currentAnalysisReport.intensityAdjustment != null ? (Math.round(parseFloat(window.currentAnalysisReport.intensityAdjustment) * 100)) : '';
        condMeta = '<span>컨디션: ' + bc + (adj !== '' ? ' (' + adj + '%)' : '') + '</span>';
      }
      contentDiv.innerHTML = `
        <div class="analysis-header">
          <h3>${date} - ${workoutName}</h3>
          <div class="analysis-meta">
            <span>훈련 시간: ${durationMin}분</span>
            <span>평균 파워: ${avgPower}W</span>
            <span>NP: ${np}W</span>
            <span>TSS: ${tss}</span>
            <span>평균 심박: ${hrAvg} bpm</span>
            ${condMeta}
          </div>
        </div>
        <div class="analysis-content">
          ${formatAnalysisText(analysisText)}
        </div>
      `;
    }
    
  } catch (error) {
    // 인터벌 정리
    if (window.trainingAnalysisStatusInterval) {
      clearInterval(window.trainingAnalysisStatusInterval);
      window.trainingAnalysisStatusInterval = null;
    }
    
    console.error('Gemini API 오류:', error);
    
    let errorMessage = error.message;
    let helpMessage = '';
    
    // 모델 이름 오류인 경우
    if (errorMessage.includes('not found') || errorMessage.includes('not supported')) {
      helpMessage = `
        <p style="margin-top: 12px; font-size: 0.9em; color: #666;">
          <strong>해결 방법:</strong><br>
          1. API 키가 올바른지 확인해주세요.<br>
          2. Google AI Studio (<a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: #2e74e8;">https://aistudio.google.com/app/apikey</a>)에서 API 키를 발급받으세요.<br>
          3. API 키에 "API 사용" 권한이 있는지 확인하세요.<br>
          4. 훈련일지 상단의 "API 키 확인" 버튼으로 키를 테스트해보세요.
        </p>
      `;
    } else if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('403')) {
      helpMessage = `
        <p style="margin-top: 12px; font-size: 0.9em; color: #666;">
          <strong>API 키 오류:</strong><br>
          - API 키가 유효하지 않거나 만료되었습니다.<br>
          - Google AI Studio에서 새로운 API 키를 발급받아주세요.
        </p>
      `;
    } else if (errorMessage.includes('429') || errorMessage.includes('quota')) {
      helpMessage = `
        <p style="margin-top: 12px; font-size: 0.9em; color: #666;">
          <strong>사용량 초과:</strong><br>
          - API 사용량이 초과되었습니다.<br>
          - Google AI Studio에서 사용량을 확인하거나 잠시 후 다시 시도해주세요.
        </p>
      `;
    } else if (errorMessage.includes('overloaded') || errorMessage.includes('overload') || 
               errorMessage.includes('503') || errorMessage.includes('서버가 과부하')) {
      helpMessage = `
        <p style="margin-top: 12px; font-size: 0.9em; color: #666;">
          <strong>서버 과부하 오류:</strong><br>
          - Gemini API 서버가 일시적으로 과부하 상태입니다.<br>
          - 자동으로 재시도했지만 응답을 받지 못했습니다.<br>
          - 잠시 후(1-2분) 다시 시도해주세요.<br>
          - 토큰 제한을 적용하여 안정성을 개선했습니다.
        </p>
      `;
    } else {
      helpMessage = `
        <p style="margin-top: 12px; font-size: 0.9em; color: #666;">
          API 키가 올바른지 확인하거나, Google AI Studio에서 API 사용량을 확인해주세요.<br>
          <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: #2e74e8; text-decoration: underline;">Google AI Studio에서 API 키 확인하기</a>
        </p>
      `;
    }
    
    contentDiv.innerHTML = `
      <div class="error-message">
        <h3>분석 오류</h3>
        <p>${errorMessage}</p>
        ${helpMessage}
      </div>
    `;
  }
}

// 시각화된 분석 결과 렌더링 (bodyCondition, intensityAdjustment: SOLO 훈련 시 컨디션별 강도 보정 표시용)
function renderVisualizedAnalysis(date, workoutName, durationMin, avgPower, np, tss, hrAvg, ftp, weight, data, bodyCondition, intensityAdjustment) {
  const summary = data.summary || {};
  const metrics = data.metrics || {};
  const coaching = data.coaching || {};
  const overallAnalysis = data.overallAnalysis || '';
  
  // 강도 레벨 색상
  const intensityColors = {
    '낮음': '#10b981',
    '보통': '#3b82f6',
    '높음': '#f59e0b',
    '매우높음': '#ef4444'
  };
  
  // 점수 색상
  function getScoreColor(score) {
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#3b82f6';
    if (score >= 40) return '#f59e0b';
    return '#ef4444';
  }
  
  var conditionMeta = '';
  if (bodyCondition || intensityAdjustment != null) {
    var adjPct = intensityAdjustment != null ? (Math.round(parseFloat(intensityAdjustment) * 100)) : '';
    conditionMeta = '<span>컨디션: ' + (bodyCondition || '선택') + (adjPct !== '' ? ' (' + adjPct + '%)' : '') + '</span>';
  }
  
  return `
    <div class="analysis-header">
      <h3>${date} - ${workoutName}</h3>
      <div class="analysis-meta">
        <span>훈련 시간: ${durationMin}분</span>
        <span>평균 파워: ${avgPower}W</span>
        <span>NP: ${np}W</span>
        <span>TSS: ${tss}</span>
        <span>평균 심박: ${hrAvg} bpm</span>
        ${conditionMeta}
      </div>
    </div>
    
    <div class="analysis-visualized">
      <!-- 요약 지표 카드 -->
      <div class="analysis-section">
        <h3 class="section-title">📊 훈련 요약</h3>
        <div class="metric-cards">
          <div class="metric-card">
            <div class="metric-label">훈련 강도</div>
            <div class="metric-value" style="color: ${intensityColors[summary.intensityLevel] || '#666'}">
              ${summary.intensityLevel || 'N/A'}
            </div>
            <div class="metric-score" style="color: ${getScoreColor(summary.intensityScore || 0)}">
              ${summary.intensityScore || 0}점
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">목표 달성도</div>
            <div class="metric-value" style="color: ${getScoreColor(summary.goalAchievement || 0)}">
              ${summary.goalAchievement || 0}%
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar" style="width: ${summary.goalAchievement || 0}%; background: ${getScoreColor(summary.goalAchievement || 0)}"></div>
            </div>
          </div>
          <div class="metric-card">
            <div class="metric-label">종합 평가</div>
            <div class="metric-value" style="color: ${getScoreColor(summary.overallRating || 0)}">
              ${summary.overallRating || 0}점
            </div>
            <div class="metric-score">/ 100점</div>
          </div>
        </div>
      </div>
      
      <!-- 데이터 분석 -->
      <div class="analysis-section">
        <h3 class="section-title">📈 데이터 분석</h3>
        <div class="analysis-charts-container">
          <div class="chart-wrapper">
            <div id="powerAnalysisChart" style="width: 100%; height: 250px;"></div>
          </div>
          <div class="chart-wrapper">
            <div id="tssAnalysisChart" style="width: 100%; height: 200px;"></div>
          </div>
        </div>
        <div class="metric-details">
          <div class="detail-card">
            <div class="detail-label">파워 분석</div>
            <div class="detail-value">${metrics.powerAnalysis?.powerZone || 'N/A'}</div>
            <div class="detail-sub">평균: ${avgPower}W (FTP의 ${metrics.powerAnalysis?.avgPowerPercent || 0}%)</div>
            <div class="detail-score" style="color: ${getScoreColor(metrics.powerAnalysis?.powerScore || 0)}">
              ${metrics.powerAnalysis?.powerScore || 0}점
            </div>
          </div>
          <div class="detail-card">
            <div class="detail-label">TSS 분석</div>
            <div class="detail-value">${metrics.tssAnalysis?.tssCategory || 'N/A'}</div>
            <div class="detail-sub">회복 예상 시간: ${metrics.tssAnalysis?.recoveryTime || 'N/A'}</div>
            <div class="detail-score" style="color: ${getScoreColor(metrics.tssAnalysis?.tssScore || 0)}">
              ${metrics.tssAnalysis?.tssScore || 0}점
            </div>
          </div>
        </div>
      </div>
      
      <!-- 심박수 분석 (확대된 블록) -->
      <div class="analysis-section hr-analysis-expanded">
        <h3 class="section-title">❤️ 심박수 분석</h3>
        <div class="hr-analysis-container">
          <div class="hr-analysis-left">
            <div class="hr-chart-wrapper">
              <div id="hrAnalysisChart" style="width: 100%; height: 300px;"></div>
            </div>
            <div class="hr-evaluation-result">
              <div class="hr-eval-title">평가 결과</div>
              <div class="hr-eval-content">
                <div class="hr-eval-item">
                  <span class="hr-eval-label">평균 심박수:</span>
                  <span class="hr-eval-value">${hrAvg} bpm</span>
                </div>
                <div class="hr-eval-item">
                  <span class="hr-eval-label">심박 구간:</span>
                  <span class="hr-eval-value">${metrics.heartRateAnalysis?.hrZone || 'N/A'}</span>
                </div>
                <div class="hr-eval-item">
                  <span class="hr-eval-label">추정 최대 심박수:</span>
                  <span class="hr-eval-value" id="hrMaxHRValue">계산 중...</span>
                </div>
                <div class="hr-eval-item">
                  <span class="hr-eval-label">평가 점수:</span>
                  <span class="hr-eval-value" style="color: ${getScoreColor(metrics.heartRateAnalysis?.hrScore || 0)}">
                    ${metrics.heartRateAnalysis?.hrScore || 0}점
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="hr-analysis-right">
            <div id="hrAnalysisGuide" class="hr-chart-guide-expanded"></div>
          </div>
        </div>
      </div>
      
      <!-- 코칭 피드백 -->
      <div class="analysis-section">
        <h3 class="section-title">💡 코칭 피드백</h3>
        <div class="coaching-grid">
          <div class="coaching-card positive">
            <div class="coaching-icon">✅</div>
            <div class="coaching-title">강점</div>
            <ul class="coaching-list">
              ${(coaching.strengths || []).map(s => `<li>${s}</li>`).join('')}
            </ul>
          </div>
          <div class="coaching-card improvement">
            <div class="coaching-icon">🔧</div>
            <div class="coaching-title">개선점</div>
            <ul class="coaching-list">
              ${(coaching.improvements || []).map(i => `<li>${i}</li>`).join('')}
            </ul>
          </div>
          <div class="coaching-card recommendation">
            <div class="coaching-icon">📋</div>
            <div class="coaching-title">권장사항</div>
            <ul class="coaching-list">
              ${(coaching.recommendations || []).map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
      
      <!-- 종합 분석 (서술형) -->
      <div class="analysis-section">
        <h3 class="section-title">📝 종합 평가</h3>
        <div class="overall-analysis-text">
          ${formatAnalysisText(overallAnalysis)}
        </div>
      </div>
    </div>
  `;
}

// 차트 렌더링
function renderAnalysisCharts(data, avgPower, np, tss, hrAvg, ftp) {
  if (typeof google === 'undefined' || !google.charts) {
    console.warn('Google Charts가 로드되지 않았습니다.');
    return;
  }
  
  google.charts.load('current', { packages: ['corechart', 'gauge'] });
  google.charts.setOnLoadCallback(() => {
    renderPowerChart(data, avgPower, np, ftp);
    renderTSSChart(data, tss);
    renderHRChart(data, hrAvg);
  });
}

// 파워 분석 차트
function renderPowerChart(data, avgPower, np, ftp) {
  const powerAnalysis = data.metrics?.powerAnalysis || {};
  const avgPercent = ftp > 0 ? (avgPower / ftp) * 100 : 0;
  const npPercent = ftp > 0 ? (np / ftp) * 100 : 0;
  
  const chartData = google.visualization.arrayToDataTable([
    ['구분', 'FTP 대비 (%)'],
    ['평균 파워', avgPercent],
    ['NP', npPercent]
  ]);
  
  const options = {
    title: '파워 분석 (FTP 대비)',
    titleTextStyle: { fontSize: 16, bold: true },
    hAxis: { title: 'FTP 대비 (%)', min: 0, max: 150 },
    vAxis: { title: '구분' },
    bars: 'horizontal',
    colors: ['#3b82f6'],
    legend: { position: 'none' },
    backgroundColor: 'transparent',
    chartArea: { left: 100, top: 40, width: '70%', height: '70%' }
  };
  
  const chart = new google.visualization.BarChart(document.getElementById('powerAnalysisChart'));
  chart.draw(chartData, options);
}

// TSS 분석 차트
function renderTSSChart(data, tss) {
  const tssAnalysis = data.metrics?.tssAnalysis || {};
  const tssValue = tss || 0;
  
  // TSS 범주별 기준
  const categories = [
    { name: '낮음', max: 50, color: '#10b981' },
    { name: '보통', max: 100, color: '#3b82f6' },
    { name: '높음', max: 150, color: '#f59e0b' },
    { name: '매우높음', max: 300, color: '#ef4444' }
  ];
  
  const chartData = google.visualization.arrayToDataTable([
    ['범주', 'TSS 값'],
    ['낮음 (0-50)', Math.min(tssValue, 50)],
    ['보통 (51-100)', tssValue > 50 ? Math.min(tssValue - 50, 50) : 0],
    ['높음 (101-150)', tssValue > 100 ? Math.min(tssValue - 100, 50) : 0],
    ['매우높음 (151+)', tssValue > 150 ? tssValue - 150 : 0]
  ]);
  
  const options = {
    title: `TSS: ${tssValue} (${tssAnalysis.tssCategory || 'N/A'})`,
    titleTextStyle: { fontSize: 16, bold: true },
    pieHole: 0.4,
    colors: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'],
    legend: { position: 'bottom' },
    backgroundColor: 'transparent',
    pieSliceText: 'none'
  };
  
  const chart = new google.visualization.PieChart(document.getElementById('tssAnalysisChart'));
  chart.draw(chartData, options);
}

// 심박수 분석 차트
function renderHRChart(data, hrAvg) {
  const hrAnalysis = data.metrics?.heartRateAnalysis || {};
  
  // 최대 심박수 추정 (220 - 나이, 또는 평균 심박수 기반 추정)
  // 실제로는 사용자 정보에서 가져와야 하지만, 여기서는 평균 심박수 기반으로 추정
  // 일반적으로 지구력 구간이 60-70%이므로 역산
  let maxHR = 200; // 기본값
  if (hrAnalysis.hrZone === '지구력' && hrAvg > 0) {
    // 지구력 구간이 60-70%이므로 평균값을 65%로 가정
    maxHR = Math.round(hrAvg / 0.65);
  } else if (hrAnalysis.hrZone === '역치' && hrAvg > 0) {
    // 역치 구간이 70-80%이므로 평균값을 75%로 가정
    maxHR = Math.round(hrAvg / 0.75);
  } else if (hrAnalysis.hrZone === '무산소' && hrAvg > 0) {
    // 무산소 구간이 80-90%이므로 평균값을 85%로 가정
    maxHR = Math.round(hrAvg / 0.85);
  } else if (hrAvg > 0) {
    // 회복 구간이 50-60%이므로 평균값을 55%로 가정
    maxHR = Math.round(hrAvg / 0.55);
  }
  
  // 심박수 구간 계산 (최대 심박수의 비율)
  const zones = [
    { name: '회복', min: Math.round(maxHR * 0.50), max: Math.round(maxHR * 0.60), color: '#10b981' },
    { name: '지구력', min: Math.round(maxHR * 0.60), max: Math.round(maxHR * 0.70), color: '#3b82f6' },
    { name: '역치', min: Math.round(maxHR * 0.70), max: Math.round(maxHR * 0.80), color: '#f59e0b' },
    { name: '무산소', min: Math.round(maxHR * 0.80), max: Math.round(maxHR * 0.90), color: '#ef4444' },
    { name: '최대', min: Math.round(maxHR * 0.90), max: maxHR, color: '#dc2626' }
  ];
  
  // 현재 평균 심박수가 속한 구간 찾기
  const currentZone = zones.find(z => hrAvg >= z.min && hrAvg < z.max) || zones[0];
  
  // 구간별 범위 표시 및 현재 심박수 위치 표시
  const chartData = google.visualization.arrayToDataTable([
    ['구간', '최소 심박수', '최대 심박수', '현재 평균'],
    ['회복', zones[0].min, zones[0].max, hrAvg >= zones[0].min && hrAvg < zones[0].max ? hrAvg : null],
    ['지구력', zones[1].min, zones[1].max, hrAvg >= zones[1].min && hrAvg < zones[1].max ? hrAvg : null],
    ['역치', zones[2].min, zones[2].max, hrAvg >= zones[2].min && hrAvg < zones[2].max ? hrAvg : null],
    ['무산소', zones[3].min, zones[3].max, hrAvg >= zones[3].min && hrAvg < zones[3].max ? hrAvg : null],
    ['최대', zones[4].min, zones[4].max, hrAvg >= zones[4].min ? hrAvg : null]
  ]);
  
  const options = {
    title: '',
    hAxis: { title: '심박수 구간', titleTextStyle: { fontSize: 12 } },
    vAxis: { title: '심박수 (bpm)', min: 0, max: Math.max(maxHR + 20, 200), titleTextStyle: { fontSize: 12 } },
    seriesType: 'bars',
    series: {
      0: { type: 'bars', color: '#e5e7eb' }, // 최소 심박수 (회색)
      1: { type: 'bars', color: '#d1d5db' }, // 최대 심박수 (회색)
      2: { type: 'line', color: '#ef4444', lineWidth: 3, pointSize: 8 } // 현재 평균 (빨간 선)
    },
    legend: { position: 'bottom', textStyle: { fontSize: 11 } },
    backgroundColor: 'transparent',
    chartArea: { left: 80, top: 20, width: '70%', height: '75%' },
    annotations: {
      textStyle: {
        fontSize: 10,
        bold: true
      }
    }
  };
  
  const chart = new google.visualization.ComboChart(document.getElementById('hrAnalysisChart'));
  chart.draw(chartData, options);
  
  // 추정 최대 심박수 표시 업데이트
  const maxHRElement = document.getElementById('hrMaxHRValue');
  if (maxHRElement) {
    maxHRElement.textContent = `${maxHR} bpm`;
  }
  
  // 우측에 해석 가이드 추가
  setTimeout(() => {
    const guideElement = document.getElementById('hrAnalysisGuide');
    if (guideElement) {
      guideElement.innerHTML = `
        <div class="hr-guide-title">📊 심박수 구간 해석 가이드</div>
        <div class="hr-guide-content">
          <div class="hr-zone-item">
            <div class="hr-zone-color" style="background: ${zones[0].color};"></div>
            <div class="hr-zone-info">
              <div class="hr-zone-name">회복 구간</div>
              <div class="hr-zone-range">${zones[0].min}-${zones[0].max} bpm</div>
              <div class="hr-zone-desc">가벼운 회복 운동, 활성 회복</div>
            </div>
          </div>
          <div class="hr-zone-item">
            <div class="hr-zone-color" style="background: ${zones[1].color};"></div>
            <div class="hr-zone-info">
              <div class="hr-zone-name">지구력 구간</div>
              <div class="hr-zone-range">${zones[1].min}-${zones[1].max} bpm</div>
              <div class="hr-zone-desc">장시간 지속 가능한 강도, 기초 체력 향상</div>
            </div>
          </div>
          <div class="hr-zone-item">
            <div class="hr-zone-color" style="background: ${zones[2].color};"></div>
            <div class="hr-zone-info">
              <div class="hr-zone-name">역치 구간</div>
              <div class="hr-zone-range">${zones[2].min}-${zones[2].max} bpm</div>
              <div class="hr-zone-desc">유산소 역치 근처, 지구력 향상에 효과적</div>
            </div>
          </div>
          <div class="hr-zone-item">
            <div class="hr-zone-color" style="background: ${zones[3].color};"></div>
            <div class="hr-zone-info">
              <div class="hr-zone-name">무산소 구간</div>
              <div class="hr-zone-range">${zones[3].min}-${zones[3].max} bpm</div>
              <div class="hr-zone-desc">고강도 간격 훈련, 무산소 능력 향상</div>
            </div>
          </div>
          <div class="hr-zone-item">
            <div class="hr-zone-color" style="background: ${zones[4].color};"></div>
            <div class="hr-zone-info">
              <div class="hr-zone-name">최대 구간</div>
              <div class="hr-zone-range">${zones[4].min}-${zones[4].max} bpm</div>
              <div class="hr-zone-desc">최대 강도, 단시간만 유지 가능</div>
            </div>
          </div>
          <div class="hr-current-analysis">
            <div class="hr-current-title">현재 분석</div>
            <div class="hr-current-content">
              <div class="hr-current-value">
                <strong style="color: #ef4444;">${hrAvg} bpm</strong>은 
                <strong>${hrAnalysis.hrZone || 'N/A'}</strong> 구간에 속합니다.
              </div>
              <div class="hr-current-desc">
                ${hrAnalysis.hrZone === '지구력' ? '장시간 지속 가능한 강도로 훈련하셨습니다. 기초 체력 향상에 효과적입니다.' : ''}
                ${hrAnalysis.hrZone === '역치' ? '유산소 역치 근처에서 훈련하셨습니다. 지구력 향상에 매우 효과적입니다.' : ''}
                ${hrAnalysis.hrZone === '무산소' ? '고강도 훈련을 수행하셨습니다. 무산소 능력 향상에 효과적이지만 충분한 회복이 필요합니다.' : ''}
                ${hrAnalysis.hrZone === '회복' ? '가벼운 강도로 훈련하셨습니다. 회복과 기초 체력 유지에 도움이 됩니다.' : ''}
                ${!hrAnalysis.hrZone || hrAnalysis.hrZone === 'N/A' ? '심박수 구간을 분석할 수 없습니다.' : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }, 500);
}

// 분석 텍스트 포맷팅 (마크다운 스타일)
function formatAnalysisText(text) {
  if (!text) return '<p>분석 내용이 없습니다.</p>';
  
  // 마크다운 스타일을 HTML로 변환
  let html = text
    // 헤더 변환
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // 볼드
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // 리스트
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    .replace(/^(\d+)\. (.*$)/gim, '<li>$2</li>')
    // 줄바꿈
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  
  // 리스트 래핑
  html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
  
  return `<p>${html}</p>`;
}

// 분석 모달 표시
function showTrainingAnalysisModal() {
  const modal = document.getElementById('trainingAnalysisModal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('trainingAnalysisContent').innerHTML = `
      <div class="ai-loading-container">
        <div class="ai-brain-animation">
          <div class="ai-neural-network">
            <div class="neural-node node-1"></div>
            <div class="neural-node node-2"></div>
            <div class="neural-node node-3"></div>
            <div class="neural-node node-4"></div>
            <div class="neural-node node-5"></div>
            <div class="neural-node node-6"></div>
            <div class="neural-connection conn-1"></div>
            <div class="neural-connection conn-2"></div>
            <div class="neural-connection conn-3"></div>
            <div class="neural-connection conn-4"></div>
            <div class="neural-connection conn-5"></div>
            <div class="neural-connection conn-6"></div>
          </div>
          <div class="ai-particles">
            <div class="particle particle-1"></div>
            <div class="particle particle-2"></div>
            <div class="particle particle-3"></div>
            <div class="particle particle-4"></div>
            <div class="particle particle-5"></div>
            <div class="particle particle-6"></div>
          </div>
        </div>
        <div class="ai-loading-text">
          <div class="ai-title">🤖 AI 최첨단 분석 엔진 가동 중</div>
          <div class="ai-status">
            <span class="ai-status-item active">데이터 전처리 중</span>
            <span class="ai-status-item">머신러닝 모델 적용 중</span>
            <span class="ai-status-item">딥러닝 분석 수행 중</span>
            <span class="ai-status-item">패턴 인식 및 예측 중</span>
            <span class="ai-status-item">종합 평가 생성 중</span>
          </div>
        </div>
      </div>
    `;
    
    // AI 상태 텍스트 순환 애니메이션
    let statusIndex = 0;
    const statusItems = document.querySelectorAll('.ai-status-item');
    if (statusItems.length > 0) {
      const statusInterval = setInterval(() => {
        statusItems.forEach((item, index) => {
          item.classList.remove('active');
          if (index === statusIndex) {
            item.classList.add('active');
          }
        });
        statusIndex = (statusIndex + 1) % statusItems.length;
      }, 1500);
      
      // 모달이 닫히면 인터벌 정리
      window.currentAnalysisStatusInterval = statusInterval;
    }
  }
}

// 분석 모달 닫기
function closeTrainingAnalysisModal() {
  const modal = document.getElementById('trainingAnalysisModal');
  if (modal) {
    modal.style.display = 'none';
  }
  // AI 상태 애니메이션 인터벌 정리
  if (window.currentAnalysisStatusInterval) {
    clearInterval(window.currentAnalysisStatusInterval);
    window.currentAnalysisStatusInterval = null;
  }
  window.currentAnalysisReport = null;
}

// API 키 저장 및 검증
async function saveGeminiApiKey() {
  const apiKeyInput = document.getElementById('geminiApiKey');
  if (!apiKeyInput) return;
  
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    if (typeof showToast === 'function') {
      showToast('API 키를 입력해주세요.', 'error');
    } else {
      alert('API 키를 입력해주세요.');
    }
    return;
  }
  
  // 저장 버튼 참조 (ID로 정확히 선택)
  const saveBtn = document.getElementById('saveApiKeyBtn');
  const originalSaveBtnText = saveBtn ? saveBtn.innerHTML : '저장';
  
  if (saveBtn) {
    saveBtn.disabled = true;
    // 이미지와 텍스트를 모두 포함한 원본 HTML 저장
    const saveBtnImg = saveBtn.querySelector('img');
    if (saveBtnImg) {
      saveBtn.innerHTML = '<img src="assets/img/save.png" alt="저장" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" /> 확인 중...';
    } else {
      saveBtn.textContent = '확인 중...';
    }
  }
  
  try {
    // 간단한 API 키 검증 (사용 가능한 모델 목록 조회)
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const testResponse = await fetch(testUrl);
    
    if (!testResponse.ok) {
      const errorData = await testResponse.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API 키 검증 실패: ${testResponse.status}`);
    }
    
    const modelsData = await testResponse.json();
    if (!modelsData.models || modelsData.models.length === 0) {
      throw new Error('사용 가능한 모델을 찾을 수 없습니다.');
    }
    
    // API 키 저장
    localStorage.setItem('geminiApiKey', apiKey);
    localStorage.setItem('geminiApiKeyDisabled', 'true'); // 비활성화 상태 저장
    apiKeyInput.type = 'password'; // 보안을 위해 password 타입 유지
    apiKeyInput.disabled = true; // 저장 후 텍스트 상자 비활성화
    
    try {
      window.dispatchEvent(new CustomEvent('stelvio-gemini-apikey-changed', { detail: { hasKey: true } }));
    } catch (e) { console.warn('[saveGeminiApiKey] dispatchEvent failed:', e); }
    
    if (typeof showToast === 'function') {
      showToast('API 키가 확인되고 저장되었습니다.', 'success');
    } else {
      alert('API 키가 확인되고 저장되었습니다.');
    }
    
  } catch (error) {
    console.error('API 키 검증 오류:', error);
    if (typeof showToast === 'function') {
      showToast(`API 키 검증 실패: ${error.message}`, 'error');
    } else {
      alert(`API 키 검증 실패: ${error.message}`);
    }
    return;
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      // 원본 HTML 복원
      saveBtn.innerHTML = originalSaveBtnText;
    }
  }
}

// API 키 확인 (테스트) 및 사용 가능한 모델 조회
async function testGeminiApiKey() {
  const apiKeyInput = document.getElementById('geminiApiKey');
  if (!apiKeyInput) return;
  
  // 텍스트 상자가 비활성화 상태이면 활성화
  if (apiKeyInput.disabled) {
    apiKeyInput.disabled = false;
    localStorage.removeItem('geminiApiKeyDisabled'); // 비활성화 상태 제거
    apiKeyInput.focus(); // 포커스 이동
  }
  
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    if (typeof showToast === 'function') {
      showToast('API 키를 먼저 입력해주세요.', 'error');
    }
    return;
  }
  
  const testBtn = document.getElementById('testApiKeyBtn');
  if (testBtn) {
    testBtn.disabled = true;
    testBtn.textContent = '확인 중...';
  }
  
  try {
    // v1 API로 사용 가능한 모델 목록 조회
    const testUrl = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
    const testResponse = await fetch(testUrl);
    
    if (!testResponse.ok) {
      // v1이 실패하면 v1beta 시도
      const testUrlBeta = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const testResponseBeta = await fetch(testUrlBeta);
      
      if (!testResponseBeta.ok) {
        const errorData = await testResponseBeta.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API 오류: ${testResponseBeta.status}`);
      }
      
      const modelsData = await testResponseBeta.json();
      const availableModels = modelsData.models || [];
      const geminiModels = availableModels
        .filter(m => m.name && m.name.includes('gemini'))
        .map(m => ({
          name: m.name,
          displayName: m.displayName || m.name,
          supportedMethods: m.supportedGenerationMethods || []
        }));
      
      if (geminiModels.length === 0) {
        throw new Error('사용 가능한 Gemini 모델을 찾을 수 없습니다.');
      }
      
      // generateContent를 지원하는 모델 찾기
      const supportedModels = geminiModels.filter(m => 
        m.supportedMethods.includes('generateContent')
      );
      
      if (supportedModels.length === 0) {
        throw new Error('generateContent를 지원하는 모델을 찾을 수 없습니다.');
      }
      
      // 첫 번째 지원 모델을 기본값으로 저장
      const defaultModel = supportedModels[0].name.split('/').pop(); // models/gemini-pro -> gemini-pro
      const apiVersion = testResponse.ok ? 'v1' : 'v1beta';
      localStorage.setItem('geminiModelName', defaultModel);
      localStorage.setItem('geminiApiVersion', apiVersion);
      
      if (typeof showToast === 'function') {
        showToast(`API 키 확인 완료! 사용 가능한 모델: ${supportedModels.length}개`, 'success');
      } else {
        alert(`API 키 확인 완료!\n사용 가능한 모델: ${supportedModels.map(m => m.displayName || m.name).join(', ')}`);
      }
      
      console.log('사용 가능한 모델:', supportedModels);
      return;
    }
    
    // v1 API 성공
    const modelsData = await testResponse.json();
    const availableModels = modelsData.models || [];
    const geminiModels = availableModels
      .filter(m => m.name && m.name.includes('gemini'))
      .map(m => ({
        name: m.name,
        displayName: m.displayName || m.name,
        supportedMethods: m.supportedGenerationMethods || []
      }));
    
    if (geminiModels.length === 0) {
      throw new Error('사용 가능한 Gemini 모델을 찾을 수 없습니다.');
    }
    
    // generateContent를 지원하는 모델 찾기
    const supportedModels = geminiModels.filter(m => 
      m.supportedMethods.includes('generateContent')
    );
    
    if (supportedModels.length === 0) {
      throw new Error('generateContent를 지원하는 모델을 찾을 수 없습니다.');
    }
    
      // 첫 번째 지원 모델을 기본값으로 저장
      const defaultModel = supportedModels[0].name.split('/').pop();
      localStorage.setItem('geminiModelName', defaultModel);
      localStorage.setItem('geminiApiVersion', 'v1');
    
    if (typeof showToast === 'function') {
      showToast(`API 키 확인 완료! 사용 가능한 모델: ${supportedModels.length}개`, 'success');
    } else {
      alert(`API 키 확인 완료!\n사용 가능한 모델: ${supportedModels.map(m => m.displayName || m.name).join(', ')}`);
    }
    
    console.log('사용 가능한 모델:', supportedModels);
    
  } catch (error) {
    console.error('API 키 테스트 오류:', error);
    if (typeof showToast === 'function') {
      showToast(`API 키 확인 실패: ${error.message}`, 'error');
    } else {
      alert(`API 키 확인 실패: ${error.message}\n\nAPI 키 발급 방법:\n1. https://aistudio.google.com/app/apikey 접속\n2. "Create API Key" 클릭\n3. 생성된 API 키를 복사하여 입력`);
    }
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.textContent = 'API 키 확인';
    }
  }
}

// API 키 로드 (페이지 로드 시)
// loadGeminiApiKey 함수는 더 이상 사용되지 않음 (환경 설정으로 이동)
// function loadGeminiApiKey() {
//   const apiKey = localStorage.getItem('geminiApiKey');
//   const apiKeyInput = document.getElementById('geminiApiKey');
//   if (apiKeyInput && apiKey) {
//     apiKeyInput.value = apiKey;
//     // 저장된 비활성화 상태 확인
//     const isDisabled = localStorage.getItem('geminiApiKeyDisabled') === 'true';
//     if (isDisabled) {
//       apiKeyInput.disabled = true;
//     }
//   }
// }

// 보고서 내보내기 (PDF 형식 - html2canvas 사용)
async function exportAnalysisReport() {
  if (!window.currentAnalysisReport) {
    if (typeof showToast === 'function') {
      showToast('내보낼 분석 결과가 없습니다.', 'error');
    }
    return;
  }
  
  if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
    if (typeof showToast === 'function') {
      showToast('PDF 라이브러리를 불러올 수 없습니다.', 'error');
    } else {
      alert('PDF 라이브러리를 불러올 수 없습니다.');
    }
    return;
  }
  
  if (typeof html2canvas === 'undefined') {
    if (typeof showToast === 'function') {
      showToast('html2canvas 라이브러리를 불러올 수 없습니다.', 'error');
    } else {
      alert('html2canvas 라이브러리를 불러올 수 없습니다.');
    }
    return;
  }
  
  const report = window.currentAnalysisReport;
  const { jsPDF } = window.jspdf || window;
  
  try {
    // 로딩 표시
    if (typeof showToast === 'function') {
      showToast('PDF 생성 중...', 'info');
    }
    
    // 분석 결과 콘텐츠 영역 가져오기
    const contentDiv = document.getElementById('trainingAnalysisContent');
    if (!contentDiv) {
      throw new Error('분석 결과 콘텐츠를 찾을 수 없습니다.');
    }
    
    // PDF 생성 (A4 크기, 세로 방향)
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const contentWidth = pageWidth - (margin * 2);
    
    // html2canvas로 HTML을 이미지로 변환
    const canvas = await html2canvas(contentDiv, {
      scale: 2, // 고해상도
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: contentDiv.scrollWidth,
      height: contentDiv.scrollHeight
    });
    
    const imgData = canvas.toDataURL('image/png');
    const imgWidth = pageWidth - (margin * 2);
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    
    let heightLeft = imgHeight;
    let position = margin;
    
    // 첫 페이지에 이미지 추가
    doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - margin * 2);
    
    // 여러 페이지가 필요한 경우
    while (heightLeft > 0) {
      position = heightLeft - imgHeight + margin;
      doc.addPage();
      doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
      heightLeft -= (pageHeight - margin * 2);
    }
    
    // PDF 저장
    const fileName = `훈련분석_${report.date.replace(/-/g, '')}.pdf`;
    doc.save(fileName);
    
    if (typeof showToast === 'function') {
      showToast('PDF 보고서가 다운로드되었습니다.', 'success');
    }
    
  } catch (error) {
    console.error('PDF 생성 오류:', error);
    if (typeof showToast === 'function') {
      showToast('PDF 생성 중 오류가 발생했습니다.', 'error');
    } else {
      alert('PDF 생성 중 오류가 발생했습니다: ' + error.message);
    }
  }
}

// 컨디션 이름 → AI 추천용 컨디션 점수 (55~95, 5 단위). 사용자 입력 반영 시 사용.
const RPE_CONDITION_TO_SCORE = { '최상': 90, '좋음': 80, '보통': 70, '나쁨': 60 };

// ========== Challenge 타입별 컨디션별 강도 보정 표시값 테이블 ==========
const RPE_CONDITION_VALUES = {
  'Fitness': {
    '최상': 1.10,  // 110%
    '좋음': 1.00,  // 100%
    '보통': 0.95,  // 95%
    '나쁨': 0.90   // 90%
  },
  'GranFondo': {
    '최상': 1.08,  // 108%
    '좋음': 1.00,  // 100%
    '보통': 0.95,  // 95%
    '나쁨': 0.92   // 92%
  },
  'Racing': {
    '최상': 1.06,  // 106%
    '좋음': 1.00,  // 100%
    '보통': 0.96,  // 96%
    '나쁨': 0.94   // 94%
  },
  'Elite': {
    '최상': 1.05,  // 105%
    '좋음': 1.00,  // 100%
    '보통': 0.97,  // 97%
    '나쁨': 0.95   // 95%
  },
  'PRO': {
    '최상': 1.04,  // 104%
    '좋음': 1.00,  // 100%
    '보통': 0.98,  // 98%
    '나쁨': 0.96   // 96%
  }
};

// ========== Challenge 타입별 목표값 조절 슬라이드 범위 테이블 ==========
const SLIDER_RANGE_BY_CHALLENGE = {
  'Fitness': { min: -10, max: 10 },      // -10% ~ +10%
  'GranFondo': { min: -8, max: 8 },      // -8% ~ +8%
  'Racing': { min: -6, max: 6 },         // -6% ~ +6%
  'Elite': { min: -5, max: 5 },           // -5% ~ +5%
  'PRO': { min: -4, max: 4 }              // -4% ~ +4%
};

/**
 * 사용자의 challenge 타입 가져오기 (강화된 버전)
 * 1. window.currentUser 확인
 * 2. localStorage.currentUser 확인
 * 3. API에서 직접 가져오기 (필요시)
 */
async function getUserChallenge() {
  let userChallenge = null;
  let currentUser = null;
  
  // 1. window.currentUser 확인
  if (window.currentUser && window.currentUser.challenge) {
    userChallenge = String(window.currentUser.challenge).trim();
    currentUser = window.currentUser;
    console.log('[getUserChallenge] window.currentUser에서 가져옴:', userChallenge);
  }
  
  // 2. localStorage.currentUser 확인
  if (!userChallenge) {
    try {
      const storedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (storedUser && storedUser.challenge) {
        userChallenge = String(storedUser.challenge).trim();
        currentUser = storedUser;
        // window.currentUser도 업데이트
        if (!window.currentUser) {
          window.currentUser = storedUser;
        }
        console.log('[getUserChallenge] localStorage.currentUser에서 가져옴:', userChallenge);
      }
    } catch (e) {
      console.warn('[getUserChallenge] localStorage 파싱 실패:', e);
    }
  }
  
  // 3. API에서 직접 가져오기 (여전히 없으면)
  if (!userChallenge && typeof apiGetUsers === 'function') {
    try {
      const result = await apiGetUsers();
      if (result && result.success && result.items && result.items.length > 0) {
        const userId = window.currentUser?.id || JSON.parse(localStorage.getItem('currentUser') || 'null')?.id;
        if (userId) {
          const user = result.items.find(u => String(u.id) === String(userId));
          if (user && user.challenge) {
            userChallenge = String(user.challenge).trim();
            currentUser = user;
            // window.currentUser와 localStorage 업데이트
            window.currentUser = user;
            try {
              localStorage.setItem('currentUser', JSON.stringify(user));
            } catch (e) {
              console.warn('[getUserChallenge] localStorage 저장 실패:', e);
            }
            console.log('[getUserChallenge] API에서 가져옴:', userChallenge);
          }
        }
      }
    } catch (e) {
      console.warn('[getUserChallenge] API 호출 실패:', e);
    }
  }
  
  // 대소문자 정규화
  if (userChallenge) {
    const normalized = userChallenge.toLowerCase();
    if (normalized === 'fitness') return 'Fitness';
    if (normalized === 'granfondo') return 'GranFondo';
    if (normalized === 'racing') return 'Racing';
    if (normalized === 'elite') return 'Elite';
    if (normalized === 'pro') return 'PRO';
    // 원본 값이 이미 정규화되어 있으면 그대로 반환
    if (['Fitness', 'GranFondo', 'Racing', 'Elite', 'PRO'].includes(userChallenge)) {
      return userChallenge;
    }
  }
  
  console.warn('[getUserChallenge] challenge를 찾을 수 없어 기본값 Fitness 사용');
  return 'Fitness'; // 기본값
}

/**
 * 동기 버전 (비동기 호출이 어려운 경우)
 */
function getUserChallengeSync() {
  let userChallenge = null;
  
  // 1. window.currentUser 확인
  if (window.currentUser && window.currentUser.challenge) {
    userChallenge = String(window.currentUser.challenge).trim();
  }
  
  // 2. localStorage.currentUser 확인
  if (!userChallenge) {
    try {
      const storedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (storedUser && storedUser.challenge) {
        userChallenge = String(storedUser.challenge).trim();
      }
    } catch (e) {
      console.warn('[getUserChallengeSync] localStorage 파싱 실패:', e);
    }
  }
  
  // 대소문자 정규화
  if (userChallenge) {
    const normalized = userChallenge.toLowerCase();
    if (normalized === 'fitness') return 'Fitness';
    if (normalized === 'granfondo') return 'GranFondo';
    if (normalized === 'racing') return 'Racing';
    if (normalized === 'elite') return 'Elite';
    if (normalized === 'pro') return 'PRO';
    if (['Fitness', 'GranFondo', 'Racing', 'Elite', 'PRO'].includes(userChallenge)) {
      return userChallenge;
    }
  }
  
  return 'Fitness'; // 기본값
}

// ========== RPE 컨디션 선택 모달 함수 ==========
function showRPEModal(source) {
  const modal = document.getElementById('rpeConditionModal');
  if (modal) {
    // 모달 출처 저장 (indoor 또는 solo)
    if (source) {
      window.rpeModalSource = source;
    }
    
    modal.style.display = 'flex';
    
    // 먼저 동기 버전으로 빠르게 표시
    let challenge = getUserChallengeSync();
    updateRPEModalContent(modal, challenge);
    
    // 비동기로 정확한 challenge 정보 가져와서 업데이트
    getUserChallenge().then(accurateChallenge => {
      if (accurateChallenge !== challenge) {
        console.log('[RPE Modal] Challenge 타입 업데이트:', challenge, '→', accurateChallenge);
        challenge = accurateChallenge;
        updateRPEModalContent(modal, challenge);
      }
    }).catch(err => {
      console.warn('[RPE Modal] Challenge 타입 가져오기 실패, 동기 버전 사용:', err);
    });
  }
}

/**
 * INDOOR TRAINING용 RPE 모달 표시
 */
function showRPEModalForIndoorTraining() {
  window.rpeModalSource = 'indoor';
  showRPEModal('indoor');
}

/**
 * SOLO TRAINING용 RPE 모달 표시
 */
function showRPEModalForSoloTraining() {
  window.rpeModalSource = 'solo';
  showRPEModal('solo');
}

/**
 * AI 워크아웃 추천용 RPE 모달 표시 (컨디션 입력 후 추천 로직에 반영)
 * @param {string} date - YYYY-MM-DD
 * @param {object} currentUser - 사용자 객체
 * @param {string} apiKey - Gemini API 키
 */
function showRPEModalForAIRecommendation(date, currentUser, apiKey) {
  window.rpeModalSource = 'ai_recommend';
  window.pendingAIRecommend = { date: date, currentUser: currentUser, apiKey: apiKey };
  showRPEModal('ai_recommend');
}

/**
 * RPE 모달 내용 업데이트 (challenge 타입에 따라)
 */
function updateRPEModalContent(modal, challenge) {
  const conditionValues = RPE_CONDITION_VALUES[challenge] || RPE_CONDITION_VALUES['Fitness'];
  
  console.log('[RPE Modal] Challenge 타입:', challenge, '컨디션 값:', conditionValues, 'currentUser:', window.currentUser);
  
  // Challenge 타입별 이미지 가져오기
  let challengeImage = 'yellow.png'; // 기본값: Fitness
  if (challenge === 'GranFondo') {
    challengeImage = 'green.png';
  } else if (challenge === 'Racing') {
    challengeImage = 'blue.png';
  } else if (challenge === 'Elite') {
    challengeImage = 'orenge.png';
  } else if (challenge === 'PRO') {
    challengeImage = 'red.png';
  }
  
  // 모달 헤더에 Challenge 타입별 이미지 업데이트 (이미지와 제목이 같은 라인)
  const challengeIcon = modal.querySelector('#rpeModalChallengeIcon');
  if (challengeIcon) {
    challengeIcon.src = `assets/img/${challengeImage}`;
    challengeIcon.alt = challenge;
  }
    
  // challenge 타입에 따라 버튼 값 업데이트
  const conditionButtons = [
    { name: '최상', selector: '.rpe-condition-btn[data-condition="최상"]' },
    { name: '좋음', selector: '.rpe-condition-btn[data-condition="좋음"]' },
    { name: '보통', selector: '.rpe-condition-btn[data-condition="보통"]' },
    { name: '나쁨', selector: '.rpe-condition-btn[data-condition="나쁨"]' }
  ];
  
  conditionButtons.forEach(({ name, selector }) => {
    const btn = modal.querySelector(selector);
    if (btn) {
      const adjustment = conditionValues[name];
      btn.setAttribute('data-adjustment', adjustment);
      btn.setAttribute('onclick', `selectRPECondition(${adjustment}, '${name}')`);
      
      // 표시값 업데이트
      const valueEl = btn.querySelector('.rpe-condition-value');
      if (valueEl) {
        valueEl.textContent = `${Math.round(adjustment * 100)}%`;
      }
    }
  });
  
  // 기존 선택 해제
  modal.querySelectorAll('.rpe-condition-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  
  // 저장된 값이 있으면 해당 버튼 선택 (가장 가까운 값 찾기)
  const savedAdjustment = window.trainingIntensityAdjustment || 1.0;
  let closestBtn = null;
  let minDiff = Infinity;
  
  modal.querySelectorAll('.rpe-condition-btn').forEach(btn => {
    const btnAdjustment = parseFloat(btn.getAttribute('data-adjustment'));
    const diff = Math.abs(btnAdjustment - savedAdjustment);
    if (diff < minDiff) {
      minDiff = diff;
      closestBtn = btn;
    }
  });
  
  if (closestBtn) {
    closestBtn.classList.add('selected');
  }
}

function closeRPEModal() {
  const modal = document.getElementById('rpeConditionModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function selectRPECondition(adjustment, conditionName) {
  // 모든 버튼에서 selected 클래스 제거
  document.querySelectorAll('.rpe-condition-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  
  // 선택한 버튼에 selected 클래스 추가
  const selectedBtn = event.target.closest('.rpe-condition-btn');
  if (selectedBtn) {
    selectedBtn.classList.add('selected');
  }
  
  // 전역 변수에 강도 보정값 저장
  window.trainingIntensityAdjustment = adjustment;
  
  // 로컬 스토리지에 저장 (세션 유지)
  try {
    localStorage.setItem('trainingIntensityAdjustment', String(adjustment));
    
    // 오늘 날짜의 몸상태도 저장
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    localStorage.setItem(`bodyCondition_${todayStr}`, conditionName);
  } catch (e) {
    console.warn('로컬 스토리지 저장 실패:', e);
  }
  
  console.log(`RPE 컨디션 선택: ${conditionName} (${(adjustment * 100).toFixed(0)}%)`);
  
  // 상태 버튼 클릭 시 바로 확인 기능 실행
  confirmRPESelection();
}

function confirmRPESelection() {
  const adjustment = window.trainingIntensityAdjustment;
  if (!adjustment) {
    if (typeof showToast === 'function') {
      showToast('컨디션을 선택해주세요', 'warning');
    } else {
      alert('컨디션을 선택해주세요');
    }
    return;
  }
  
  // 모달 닫기
  closeRPEModal();
  
  // 모달 출처에 따라 다른 화면으로 이동
  const source = window.rpeModalSource || 'solo'; // 기본값은 solo (기존 동작 유지)
  
  console.log('[RPE Modal] 확인 버튼 클릭, 출처:', source);

  // AI 워크아웃 추천: 컨디션 입력 반영 후 추천 실행
  if (source === 'ai_recommend' && window.pendingAIRecommend) {
    var pending = window.pendingAIRecommend;
    window.pendingAIRecommend = null;
    window.rpeModalSource = null;
    var todayStr = new Date().toISOString().split('T')[0];
    var conditionName = localStorage.getItem('bodyCondition_' + todayStr) || '보통';
    var userConditionScore = RPE_CONDITION_TO_SCORE[conditionName] != null ? RPE_CONDITION_TO_SCORE[conditionName] : 70;
    if (typeof showWorkoutRecommendationModal === 'function') {
      showWorkoutRecommendationModal();
    }
    if (typeof analyzeAndRecommendWorkouts === 'function') {
      if (typeof window.__aiRecommendationInProgress !== 'undefined') {
        window.__aiRecommendationInProgress = true;
      }
      analyzeAndRecommendWorkouts(pending.date, pending.currentUser, pending.apiKey, {
        userConditionScore: userConditionScore,
        userConditionName: conditionName
      }).then(function () {
        if (typeof window.__aiRecommendationInProgress !== 'undefined') {
          window.__aiRecommendationInProgress = false;
        }
      }).catch(function (err) {
        console.error('AI 워크아웃 추천 오류:', err);
        if (typeof window.__aiRecommendationInProgress !== 'undefined') {
          window.__aiRecommendationInProgress = false;
        }
        if (typeof showToast === 'function') {
          showToast('워크아웃 추천 중 오류가 발생했습니다.', 'error');
        }
      });
    }
    return;
  }
  
  // 화면 전환 (인증 체크 우회를 위해 직접 DOM 조작 사용)
  if (source === 'indoor') {
    // INDOOR TRAINING → Live Training Rooms 화면
    const targetScreen = document.getElementById('trainingRoomScreen');
    if (targetScreen) {
      // 모든 화면 숨기기
      document.querySelectorAll('.screen').forEach(screen => {
        if (screen.id !== 'trainingRoomScreen' && screen.id !== 'splashScreen') {
          screen.classList.remove('active');
          screen.style.display = 'none';
          screen.style.opacity = '0';
          screen.style.visibility = 'hidden';
        }
      });
      
      // 대상 화면 표시
      targetScreen.style.display = 'block';
      targetScreen.classList.add('active');
      targetScreen.style.opacity = '1';
      targetScreen.style.visibility = 'visible';
      
      console.log('[RPE Modal] INDOOR TRAINING 경로: Live Training Rooms 화면으로 이동');
      
      if (typeof loadTrainingRooms === 'function') {
        setTimeout(() => loadTrainingRooms(), 200);
      }
    } else {
      // showScreen 함수 사용 (fallback)
      if (typeof showScreen === 'function') {
        showScreen('trainingRoomScreen');
      }
    }
  } else {
    // SOLO TRAINING → 훈련 준비 화면
    const targetScreen = document.getElementById('trainingReadyScreen');
    if (targetScreen) {
      // 모든 화면 숨기기
      document.querySelectorAll('.screen').forEach(screen => {
        if (screen.id !== 'trainingReadyScreen' && screen.id !== 'splashScreen') {
          screen.classList.remove('active');
          screen.style.display = 'none';
          screen.style.opacity = '0';
          screen.style.visibility = 'hidden';
        }
      });
      
      // 대상 화면 표시
      targetScreen.style.display = 'block';
      targetScreen.classList.add('active');
      targetScreen.style.opacity = '1';
      targetScreen.style.visibility = 'visible';
      
      console.log('[RPE Modal] SOLO TRAINING 경로: 훈련 준비 화면으로 이동');
      // 스케줄 등에서 진입 시 훈련날짜 지정 워크아웃·세그먼트 그래프 로딩
      if (window.currentWorkout && window.currentWorkout.segments && window.currentWorkout.segments.length > 0 && typeof updateTrainingReadyScreenWithWorkout === 'function') {
        setTimeout(function () {
          updateTrainingReadyScreenWithWorkout(window.currentWorkout);
        }, 150);
      }
    } else {
      // showScreen 함수 사용 (fallback)
      if (typeof showScreen === 'function') {
        showScreen('trainingReadyScreen');
      }
    }
  }
  
  // 모달 출처 초기화
  window.rpeModalSource = null;
  
  // challenge 타입에 따라 조건 이름 매핑 (토스트 표시용, conditionName은 ai_recommend 블록에서 이미 선언될 수 있음)
  const challenge = getUserChallengeSync();
  const conditionValues = RPE_CONDITION_VALUES[challenge] || RPE_CONDITION_VALUES['Fitness'];
  let toastConditionName = '선택됨';
  let minDiff = Infinity;
  for (const [name, value] of Object.entries(conditionValues)) {
    const diff = Math.abs(value - adjustment);
    if (diff < minDiff) {
      minDiff = diff;
      toastConditionName = name;
    }
  }
  if (typeof showToast === 'function') {
    showToast(`컨디션: ${toastConditionName} (${(adjustment * 100).toFixed(0)}%) 적용됨`, 'success');
  }
}

// 전역 함수로 등록
window.showRPEModal = showRPEModal;
window.showRPEModalForIndoorTraining = showRPEModalForIndoorTraining;
window.showRPEModalForSoloTraining = showRPEModalForSoloTraining;
window.showRPEModalForAIRecommendation = showRPEModalForAIRecommendation;
window.closeRPEModal = closeRPEModal;

/**
 * 강도 조절 슬라이더 초기화 및 이벤트 핸들러
 */
function initializeIntensitySlider() {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  const slider = document.getElementById('intensityAdjustmentSlider');
  const valueDisplay = document.getElementById('intensityAdjustmentValue');
  
  if (!slider || !valueDisplay) {
    console.warn('강도 조절 슬라이더 요소를 찾을 수 없습니다');
    return;
  }
  
  // challenge 타입에 따른 슬라이더 범위 설정 (동기 버전 사용)
  const challenge = getUserChallengeSync();
  const range = SLIDER_RANGE_BY_CHALLENGE[challenge] || SLIDER_RANGE_BY_CHALLENGE['Fitness'];
  slider.min = range.min;
  slider.max = range.max;
  
  // 슬라이더 범위 표시 라벨 업데이트
  const minLabel = document.querySelector('.intensity-adjustment-min');
  const maxLabel = document.querySelector('.intensity-adjustment-max');
  if (minLabel) minLabel.textContent = `${range.min}%`;
  if (maxLabel) maxLabel.textContent = `+${range.max}%`;
  
  console.log('[강도 조절] Challenge 타입:', challenge, '슬라이더 범위:', range);
  
  // 초기값 설정: 컨디션별 강도 보정 값에서 퍼센트로 변환
  let currentAdjustment = window.trainingIntensityAdjustment;
  
  // 로컬 스토리지에서 값 확인 (컨디션별 강도 보정에서 설정한 값)
  if (currentAdjustment === undefined || currentAdjustment === null) {
    try {
      const saved = localStorage.getItem('trainingIntensityAdjustment');
      if (saved) {
        currentAdjustment = parseFloat(saved);
        window.trainingIntensityAdjustment = currentAdjustment;
      } else {
        currentAdjustment = 1.0;
        window.trainingIntensityAdjustment = 1.0;
      }
    } catch (e) {
      currentAdjustment = 1.0;
      window.trainingIntensityAdjustment = 1.0;
    }
  }
  
  // 조정 계수를 슬라이더 값으로 변환 (0.95 → -5, 1.0 → 0, 1.03 → +3)
  const sliderValue = Math.round((currentAdjustment - 1.0) * 100);
  // challenge 타입에 따른 범위로 클램프
  const clampedValue = Math.max(range.min, Math.min(range.max, sliderValue));
  
  console.log('[강도 조절] 초기값 설정:', {
    adjustment: currentAdjustment,
    sliderValue: sliderValue,
    clampedValue: clampedValue
  });
  
  slider.value = clampedValue;
  updateIntensityDisplay(clampedValue);
  
  // 기존 이벤트 리스너 제거 (중복 방지)
  const newSlider = slider.cloneNode(true);
  slider.parentNode.replaceChild(newSlider, slider);
  
  // 슬라이더 이벤트 리스너 (input: 실시간 반영)
  newSlider.addEventListener('input', function(e) {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value)) {
      // 실시간으로 목표 파워와 표시 값 업데이트
      updateIntensityAdjustment(value);
    }
  });
  
  // 슬라이더 변경 완료 시 (마우스 떼거나 터치 종료) - 로컬 스토리지 저장
  newSlider.addEventListener('change', function(e) {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value)) {
      // 한 번 더 업데이트 (확실하게 반영)
      updateIntensityAdjustment(value);
      
      // 로컬 스토리지에 저장
      try {
        localStorage.setItem('trainingIntensityAdjustment', String(window.trainingIntensityAdjustment));
        console.log('[강도 조절] 로컬 스토리지에 저장:', window.trainingIntensityAdjustment);
      } catch (err) {
        console.warn('강도 조절값 저장 실패:', err);
      }
    }
  });
}

/**
 * 강도 조절 값 업데이트 및 실시간 반영
 */
function updateIntensityAdjustment(sliderValue) {
  // 슬라이더 값(-10 ~ +10)을 조정 계수로 변환 (0.9 ~ 1.1)
  const adjustment = 1.0 + (sliderValue / 100);
  window.trainingIntensityAdjustment = adjustment;
  
  console.log('[강도 조절] 값 변경:', {
    sliderValue: sliderValue,
    adjustment: adjustment,
    percentage: (adjustment * 100).toFixed(1) + '%'
  });
  
  // 1. 표시 업데이트 (강도 조절 % 표시) - 즉시 반영
  updateIntensityDisplay(sliderValue);
  
  // 2. 현재 세그먼트의 목표 파워 실시간 업데이트
  const w = window.currentWorkout;
  if (w && w.segments && w.segments.length > 0) {
    // trainingState가 없어도 현재 세그먼트 인덱스 추정 시도
    let currentSegIndex = 0;
    if (window.trainingState && typeof window.trainingState.segIndex === 'number') {
      currentSegIndex = window.trainingState.segIndex;
    }
    
    // 세그먼트 인덱스 유효성 검사
    if (currentSegIndex >= 0 && currentSegIndex < w.segments.length) {
      if (typeof applySegmentTarget === 'function') {
        console.log('[강도 조절] 목표 파워 업데이트 - 세그먼트:', currentSegIndex);
        try {
          applySegmentTarget(currentSegIndex);
          console.log('[강도 조절] 목표 파워 업데이트 완료');
        } catch (err) {
          console.error('[강도 조절] applySegmentTarget 실행 오류:', err);
        }
      } else {
        console.warn('[강도 조절] applySegmentTarget 함수를 찾을 수 없습니다');
      }
    } else {
      console.warn('[강도 조절] 유효하지 않은 세그먼트 인덱스:', currentSegIndex);
    }
  } else {
    console.warn('[강도 조절] 워크아웃 또는 세그먼트를 찾을 수 없습니다');
  }
  
  // 3. ERG 모드가 활성화되어 있으면 목표 파워 전송
  if (window.ergModeState && window.ergModeState.enabled && typeof setErgTargetPower === 'function') {
    const currentTargetPower = window.liveData?.targetPower || 0;
    if (currentTargetPower > 0) {
      setErgTargetPower(currentTargetPower);
    }
  }
}

/**
 * 강도 조절 표시 업데이트
 */
function updateIntensityDisplay(sliderValue) {
  const valueDisplay = document.getElementById('intensityAdjustmentValue');
  if (valueDisplay) {
    const sign = sliderValue >= 0 ? '+' : '';
    valueDisplay.textContent = `${sign}${sliderValue}%`;
    
    // 색상 변경 (음수: 파란색, 0: 회색, 양수: 빨간색)
    if (sliderValue < 0) {
      valueDisplay.style.color = '#3b82f6'; // 파란색
    } else if (sliderValue > 0) {
      valueDisplay.style.color = '#ef4444'; // 빨간색
    } else {
      valueDisplay.style.color = '#9ca3af'; // 회색
    }
    
    console.log('[강도 조절] 표시 업데이트:', `${sign}${sliderValue}%`);
  } else {
    console.warn('[강도 조절] intensityAdjustmentValue 요소를 찾을 수 없습니다');
  }
}
window.selectRPECondition = selectRPECondition;
window.confirmRPESelection = confirmRPESelection;
window.handleAIWorkoutRecommendation = handleAIWorkoutRecommendation;

// ========== AI 워크아웃 추천 기능 ==========

// 추천 워크아웃 모달 표시
function showWorkoutRecommendationModal() {
  const modal = document.getElementById('workoutRecommendationModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.getElementById('workoutRecommendationContent').innerHTML = `
      <div class="ai-loading-container">
        <div class="ai-brain-animation">
          <div class="ai-neural-network">
            <div class="neural-node node-1"></div>
            <div class="neural-node node-2"></div>
            <div class="neural-node node-3"></div>
            <div class="neural-node node-4"></div>
            <div class="neural-node node-5"></div>
            <div class="neural-node node-6"></div>
            <div class="neural-connection conn-1"></div>
            <div class="neural-connection conn-2"></div>
            <div class="neural-connection conn-3"></div>
            <div class="neural-connection conn-4"></div>
            <div class="neural-connection conn-5"></div>
            <div class="neural-connection conn-6"></div>
          </div>
          <div class="ai-particles">
            <div class="particle particle-1"></div>
            <div class="particle particle-2"></div>
            <div class="particle particle-3"></div>
            <div class="particle particle-4"></div>
            <div class="particle particle-5"></div>
            <div class="particle particle-6"></div>
          </div>
        </div>
        <div class="ai-loading-text">
          <div class="ai-title">🤖 AI 최첨단 분석 엔진 가동 중</div>
          <div class="ai-status">
            <span class="ai-status-item active">훈련 목적 분석 중</span>
            <span class="ai-status-item">몸상태 데이터 처리 중</span>
            <span class="ai-status-item">훈련 이력 패턴 분석 중</span>
            <span class="ai-status-item">최적 카테고리 선정 중</span>
            <span class="ai-status-item">워크아웃 프로그램 작성 중</span>
          </div>
        </div>
      </div>
    `;
    
    // AI 상태 텍스트 순환 애니메이션
    let statusIndex = 0;
    const statusItems = document.querySelectorAll('#workoutRecommendationContent .ai-status-item');
    if (statusItems.length > 0) {
      const statusInterval = setInterval(() => {
        statusItems.forEach((item, index) => {
          item.classList.remove('active');
          if (index === statusIndex) {
            item.classList.add('active');
          }
        });
        statusIndex = (statusIndex + 1) % statusItems.length;
      }, 1500);
      
      // 모달이 닫히면 인터벌 정리
      const cleanup = () => {
        clearInterval(statusInterval);
        modal.removeEventListener('click', cleanup);
      };
      
      // 모달 닫기 버튼 클릭 시 정리
      const closeBtn = modal.querySelector('.modal-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', cleanup);
      }
    }
  }
}

// 추천 워크아웃 모달 닫기
function closeWorkoutRecommendationModal() {
  const modal = document.getElementById('workoutRecommendationModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

// ========== AI 추천 확인 팝업 ==========

// AI 추천 확인 팝업 표시 (Promise 반환)
function showAIRecommendationConfirmModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('aiRecommendationConfirmModal');
    if (!modal) {
      resolve(false);
      return;
    }
    
    // 확인 결과를 저장할 변수
    window.aiRecommendationConfirmResult = null;
    window.aiRecommendationConfirmResolve = resolve;
    
    modal.style.display = 'flex';
  });
}

// AI 추천 확인 팝업 닫기
function closeAIRecommendationConfirmModal() {
  const modal = document.getElementById('aiRecommendationConfirmModal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  // 취소 처리
  if (window.aiRecommendationConfirmResolve) {
    window.aiRecommendationConfirmResolve(false);
    window.aiRecommendationConfirmResolve = null;
  }
}

// AI 추천 확인
function confirmAIRecommendation() {
  const modal = document.getElementById('aiRecommendationConfirmModal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  // 확인 처리
  if (window.aiRecommendationConfirmResolve) {
    window.aiRecommendationConfirmResolve(true);
    window.aiRecommendationConfirmResolve = null;
  }
}

// Gemini API를 사용한 워크아웃 분석 및 추천
// options: { basisRecommendedWorkout?: string, userConditionScore?: number, userConditionName?: string } (컨디션별 강도 보정 입력 반영)
async function analyzeAndRecommendWorkouts(date, user, apiKey, options) {
  options = options || {};
  const userConditionScore = options.userConditionScore != null ? Math.max(55, Math.min(95, Math.round(Number(options.userConditionScore)))) : null;
  const userConditionName = options.userConditionName ? String(options.userConditionName).trim() : '';
  const contentDiv = document.getElementById('workoutRecommendationContent');
  
  try {
    // 1. 사용자 기본 정보 수집 (운동 목적 강조)
    const ftp = user.ftp || 0;
    const weight = user.weight || 0;
    const grade = String(user.grade ?? '2').trim();
    // challenge 값 정확히 추출 (대소문자 구분 없이)
    let challenge = String(user.challenge || 'Fitness').trim();
    // 대소문자 정규화 (Racing, GranFondo, Elite, PRO, Fitness)
    if (challenge) {
      const normalized = challenge.toLowerCase();
      if (normalized === 'racing') challenge = 'Racing';
      else if (normalized === 'granfondo') challenge = 'GranFondo';
      else if (normalized === 'elite') challenge = 'Elite';
      else if (normalized === 'pro') challenge = 'PRO';
      else if (normalized === 'fitness') challenge = 'Fitness';
    }
    
    // 사용자 정보 로깅 (디버깅용)
    console.log('[AI] 사용자:', user.id);
    
    // 2. 오늘의 몸상태 확인 (localStorage에서)
    const todayCondition = localStorage.getItem(`bodyCondition_${date}`) || '보통';
    const conditionMap = {
      '최상': 1.03,
      '좋음': 1.00,
      '보통': 0.98,
      '나쁨': 0.95
    };
    const conditionAdjustment = conditionMap[todayCondition] || 0.98;
    
    // 3. 최근 운동 이력 조회 (정확히 30일: today-29 ~ today) — Firebase users/{userId}/logs 우선, 없으면 GAS 폴백
    const today = new Date(date);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 29);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = date;
    
    let recentHistory = [];
    // 3-1. Firebase DB users > user > logs 에서 최근 30일 로그 조회 (대시보드·훈련일지와 동일 소스)
    if (user.id && typeof window.getTrainingLogsByDateRange === 'function') {
      try {
        var firebaseLogs = [];
        var endYear = today.getFullYear();
        var endMonth = today.getMonth();
        var startYear = startDate.getFullYear();
        var startMonth = startDate.getMonth();
        var monthsToFetch = [];
        var d = new Date(startYear, startMonth, 1);
        var endD = new Date(endYear, endMonth, 1);
        while (d <= endD) {
          monthsToFetch.push({ year: d.getFullYear(), month: d.getMonth() });
          d.setMonth(d.getMonth() + 1);
        }
        for (var i = 0; i < monthsToFetch.length; i++) {
          var ym = monthsToFetch[i];
          var monthLogs = await window.getTrainingLogsByDateRange(user.id, ym.year, ym.month);
          monthLogs.forEach(function(log) {
            var dateVal = log.date;
            if (dateVal && typeof dateVal.toDate === 'function') {
              dateVal = dateVal.toDate().toISOString().split('T')[0];
            } else if (dateVal && typeof dateVal !== 'string') {
              dateVal = (dateVal.toISOString && dateVal.toISOString()) ? dateVal.toISOString().split('T')[0] : String(dateVal).slice(0, 10);
            }
            if (!dateVal || dateVal < startDateStr || dateVal > endDateStr) return;
            var sec = Number(log.duration_sec ?? log.time ?? log.duration ?? 0);
            if (sec < 60) return;
            firebaseLogs.push({
              completed_at: dateVal + 'T12:00:00.000Z',
              workout_name: log.title || log.workout_name || '훈련',
              duration_min: Math.round(sec / 60),
              avg_power: Math.round(log.avg_watts ?? log.avg_power ?? 0),
              np: Math.round(log.weighted_watts ?? log.np ?? log.avg_watts ?? log.avg_power ?? 0),
              tss: Math.round(log.tss ?? 0),
              hr_avg: Math.round(log.avg_hr ?? log.hr_avg ?? 0),
              source: log.source || ''
            });
          });
        }
        // TSS 산출 규칙: 같은 날 Strava 있으면 Strava만 합산, 없으면 Stelvio만. 같은 날 두 종류 있으면 Stelvio 제외 (AI 분석·데이터 산출 기준)
        firebaseLogs = (typeof window.buildHistoryWithTSSRuleByDate === 'function')
          ? window.buildHistoryWithTSSRuleByDate(firebaseLogs)
          : buildHistoryWithTSSRuleByDate(firebaseLogs);
        recentHistory = firebaseLogs.sort(function(a, b) { return (b.completed_at || '').localeCompare(a.completed_at || ''); });
        if (typeof window.dedupeLogsForConditionScore === 'function') {
          recentHistory = window.dedupeLogsForConditionScore(recentHistory);
        } else {
          var seen = {};
          recentHistory = recentHistory.filter(function(h) {
            var key = (h.completed_at || '') + '|' + (h.duration_min || 0) + '|' + (h.tss || 0);
            if (seen[key]) return false;
            seen[key] = true;
            return true;
          });
        }
        if (recentHistory.length > 0) {
          console.log('[AI 워크아웃 추천] Firebase users/logs 훈련 이력 사용:', recentHistory.length, '건');
        }
      } catch (err) {
        console.warn('[AI 워크아웃 추천] Firebase 로그 조회 실패, GAS 폴백:', err);
      }
    }
    // 3-2. Firebase에 로그가 없을 때만 GAS getScheduleResultsByUser 사용
    if (recentHistory.length === 0) {
      try {
        const ensureBaseUrl = () => {
          const base = window.GAS_URL;
          if (!base) throw new Error('GAS_URL is not set');
          return base;
        };
        const baseUrl = ensureBaseUrl();
        const params = new URLSearchParams({
          action: 'getScheduleResultsByUser',
          userId: user.id,
          startDate: startDateStr,
          endDate: endDateStr
        });
        const response = await fetch(`${baseUrl}?${params.toString()}`);
        const result = await response.json();
        if (result?.success && Array.isArray(result.items)) {
          var gasLogs = result.items.sort(function(a, b) {
            const dateA = new Date(a.completed_at || 0);
            const dateB = new Date(b.completed_at || 0);
            return dateB - dateA;
          });
          recentHistory = (typeof window.buildHistoryWithTSSRuleByDate === 'function')
            ? window.buildHistoryWithTSSRuleByDate(gasLogs)
            : buildHistoryWithTSSRuleByDate(gasLogs);
          recentHistory = recentHistory.sort(function(a, b) { return (b.completed_at || '').localeCompare(a.completed_at || ''); });
          console.log('[AI 워크아웃 추천] GAS getScheduleResultsByUser 훈련 이력 사용 (TSS 규칙 적용):', recentHistory.length, '건');
        }
      } catch (error) {
        console.warn('최근 운동 이력 조회 실패:', error);
      }
    }
    
    // 4. 워크아웃 목록 조회 (모든 카테고리)
    const categories = ['Endurance', 'Tempo', 'SweetSpot', 'Threshold', 'VO2Max', 'Recovery'];
    let availableWorkouts = [];
    
    try {
      const ensureBaseUrl = () => {
        const base = window.GAS_URL;
        if (!base) throw new Error('GAS_URL is not set');
        return base;
      };
      
      const baseUrl = ensureBaseUrl();
      const params = new URLSearchParams({
        action: 'getWorkoutsByCategory',
        categories: categories.join(',')
      });
      const response = await fetch(`${baseUrl}?${params.toString()}`);
      const result = await response.json();
      
      if (result?.success && Array.isArray(result.items)) {
        const allWorkouts = result.items;
        
        // 프론트엔드에서 사용자 등급 확인하여 필터링
        let grade = '2';
        try {
          if (typeof getViewerGrade === 'function') {
            grade = String(getViewerGrade());
          } else {
            const viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
            const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
            if (viewer && viewer.grade != null) {
              grade = String(viewer.grade);
            } else if (authUser && authUser.grade != null) {
              grade = String(authUser.grade);
            }
          }
        } catch (e) {
          console.warn('grade 확인 실패:', e);
          grade = '2';
        }
        
        const isAdmin = (grade === '1' || grade === '3');
        
        // 관리자는 모든 워크아웃, 일반 사용자는 공개 워크아웃만
        let filteredWorkouts = isAdmin 
          ? allWorkouts 
          : allWorkouts.filter(w => String(w.status || '').trim() === '보이기');
        
        // 운동 목적에 맞는 워크아웃 필터링 (선택적 - 너무 제한적이면 전체 사용)
        // challenge 값이 제대로 설정된 경우에만 필터링 적용
        if (challenge && challenge !== 'Fitness' && challenge !== '') {
          console.log('[AI] 목적 필터링:', challenge);
          // 카테고리 기반 필터링은 AI가 처리하므로 여기서는 전체 워크아웃 사용
          // 다만 challenge 정보를 프롬프트에 강조하여 AI가 적절히 선택하도록 함
        }
        
        availableWorkouts = filteredWorkouts;
      }
    } catch (error) {
      console.warn('워크아웃 목록 조회 실패:', error);
    }
    
    // 5. 워크아웃 상세 정보 조회 (세그먼트 포함) - 병렬 처리로 최적화
    const workoutDetails = [];
    // (Lite) 판별: API는 id, title, description, author, total_seconds, segments 등 반환 (Code.gs getWorkout/getWorkoutsByCategory)
    const getWorkoutTitle = (w) => String(w.title != null ? w.title : (w.name || w.workout_title || w.workout_name || '')).trim();
    const isLiteWorkout = (w) => /\(lite\)/i.test(getWorkoutTitle(w));
    const challengeNormForLite = String(challenge || '').trim();
    const needLiteFirst = (challengeNormForLite === 'Fitness');
    // Fitness만: 1순위용 Lite 소수(최대 5) + 2~3순위용 비-Lite 충분히 포함되도록 섞어서 15개 (GranFondo는 일반 배정)
    const listForDetailFetch = needLiteFirst && availableWorkouts.length > 0
      ? (function () {
          const liteList = availableWorkouts.filter(function (w) { return isLiteWorkout(w); });
          const nonLiteList = availableWorkouts.filter(function (w) { return !isLiteWorkout(w); });
          return liteList.slice(0, 5).concat(nonLiteList).slice(0, 15);
        })()
      : availableWorkouts;
    const workoutIds = listForDetailFetch.slice(0, 15).map(w => w.id); // 최대 15개
    
    // 병렬 처리로 모든 워크아웃 상세 정보를 동시에 조회
    const workoutDetailPromises = workoutIds.map(async (workoutId) => {
      try {
        const ensureBaseUrl = () => {
          const base = window.GAS_URL;
          if (!base) throw new Error('GAS_URL is not set');
          return base;
        };
        
        const baseUrl = ensureBaseUrl();
        const params = new URLSearchParams({
          action: 'getWorkout',
          id: workoutId
        });
        const response = await fetch(`${baseUrl}?${params.toString()}`);
        const result = await response.json();
        
        if (result?.success && result.item) {
          return result.item;
        }
        return null;
      } catch (error) {
        console.warn(`워크아웃 ${workoutId} 상세 조회 실패:`, error);
        return null;
      }
    });
    
    // 모든 요청을 병렬로 실행하고 결과 수집
    const workoutDetailResults = await Promise.all(workoutDetailPromises);
    workoutDetails.push(...workoutDetailResults.filter(w => w !== null));
    
    // 6. Gemini API에 전달할 프롬프트 생성
    // 훈련 이력 분석을 위한 상세 정보 포함
    // 로그 날짜는 로컬 기준 YYYY-MM-DD 사용 (toISOString은 UTC라 타임존 오류 발생)
    function toLocalDateStr(val) {
      if (!val) return '';
      const d = typeof val === 'string' ? new Date(val) : (val && val.toDate ? val.toDate() : val);
      if (!d || !d.getFullYear) return '';
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    const historySummary = recentHistory.map(h => ({
      date: toLocalDateStr(h.completed_at || h.date),
      workout: h.workout_name || '알 수 없음',
      duration: h.duration_min || 0,
      avgPower: Math.round(h.avg_power || 0),
      np: Math.round(h.np || h.avg_power || 0),
      tss: Math.round(h.tss || 0),
      hrAvg: Math.round(h.hr_avg || 0),
      ftpPercent: ftp > 0 ? Math.round((h.avg_power || 0) / ftp * 100) : 0
    }));

    // 훈련 패턴 분석 데이터 계산
    const totalSessions = historySummary.length;
    const totalTSS = historySummary.reduce((sum, h) => sum + h.tss, 0);
    const avgTSS = totalSessions > 0 ? Math.round(totalTSS / totalSessions) : 0;
    const weeklyTSS = Math.round(totalTSS / 4.3); // 30일 기준 주간 평균
    const avgDuration = totalSessions > 0 ? Math.round(historySummary.reduce((sum, h) => sum + h.duration, 0) / totalSessions) : 0;
    const avgPower = totalSessions > 0 ? Math.round(historySummary.reduce((sum, h) => sum + h.avgPower, 0) / totalSessions) : 0;

    // 최근 7일 이력 (단기 패턴) — 오늘 포함: 로컬 날짜 기준 [오늘-6일, 오늘] 7일간 합계 (UTC 사용 시 타임존 오류)
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const sevenDaysAgoStr = sevenDaysAgo.getFullYear() + '-' + String(sevenDaysAgo.getMonth() + 1).padStart(2, '0') + '-' + String(sevenDaysAgo.getDate()).padStart(2, '0');
    const last7Days = historySummary.filter(h => {
      const d = (h.date || '').split('T')[0];
      return d && d >= sevenDaysAgoStr && d <= todayStr;
    });
    const last7DaysTSS = last7Days.reduce((sum, h) => sum + h.tss, 0);
    const last7DaysSessions = last7Days.length;
    
    // 고강도 훈련 비율 (TSS > 50 또는 평균 파워 > FTP의 90%)
    const highIntensitySessions = historySummary.filter(h => h.tss > 50 || h.ftpPercent > 90).length;
    const highIntensityRatio = totalSessions > 0 ? Math.round(highIntensitySessions / totalSessions * 100) : 0;
    
    const workoutsSummary = workoutDetails.map(w => ({
      id: w.id,
      title: w.title,
      author: w.author,
      description: w.description || '',
      totalSeconds: w.total_seconds || 0,
      segments: (w.segments || []).map(s => ({
        label: s.label,
        type: s.segment_type,
        duration: s.duration_sec,
        targetType: s.target_type,
        targetValue: s.target_value
      }))
    }));
    
    // 프롬프트 생성 (워크아웃 정보는 최대 10개로 제한, 이력은 모두 사용)
    const limitedWorkouts = workoutsSummary.slice(0, 10);
    // 이력은 모두 사용하여 정확한 분석 (최대 30개)
    const limitedHistory = historySummary.slice(0, 30);
    
    // 대시보드 '추천: X' 기반 추천 시 타입 → 카테고리 매핑
    const basisRaw = options.basisRecommendedWorkout ? String(options.basisRecommendedWorkout).trim() : '';
    let basisCategory = '';
    if (basisRaw) {
      if (/Z1|Active Recovery|Recovery/i.test(basisRaw)) basisCategory = 'Recovery';
      else if (/Z2|Endurance/i.test(basisRaw)) basisCategory = 'Endurance';
      else if (/Z3|Tempo/i.test(basisRaw)) basisCategory = 'Tempo';
      else if (/Z4|Threshold/i.test(basisRaw)) basisCategory = 'Threshold';
      else if (/Z5|VO2max|VO2Max/i.test(basisRaw)) basisCategory = 'VO2Max';
      else if (/SweetSpot/i.test(basisRaw)) basisCategory = 'SweetSpot';
    }
    const hasBasis = !!basisCategory && !!basisRaw;
    
    // 훈련 목적·등급 가중: Elite/PRO > Racing > GranFondo > Fitness. Grade 1·3 = 관리자(고급 워크아웃 선호)
    const gradeWeightNote = (grade === '1' || grade === '3')
      ? '등급 1·3(관리자/코치): 고급·고강도 워크아웃 선호에 가중을 두세요.'
      : '등급 2(일반): 목적에 맞는 보통 강도 워크아웃에 가중을 두세요.';
    const challengeWeightNote = challenge === 'PRO' || challenge === 'Elite'
      ? `훈련 목적 ${challenge}: 고강도·전문 훈련에 가중.`
      : challenge === 'Racing'
        ? '훈련 목적 Racing: 경기 성능 훈련에 가중.'
        : challenge === 'GranFondo'
          ? '훈련 목적 GranFondo: 장거리 지구력 훈련에 가중.'
          : '훈련 목적 Fitness: 지속 가능한 중강도 훈련에 가중.';
    
    const basisBlock = hasBasis ? `

🎯 **[최우선] 오늘의 AI 컨디션 분석 추천 훈련 타입: "${basisRaw}"**
- 반드시 **${basisCategory}** 카테고리에 부합하는 워크아웃만 3개 추천하세요. 이 타입을 벗어난 훈련은 추천하지 마세요.
- 위 추천 타입을 기준으로, 아래 **훈련 목적·등급 가중**을 적용해 구체 워크아웃을 선정하세요.
- 훈련 목적(challenge): **${challenge}**. ${challengeWeightNote}
- 등급(grade): **${grade}**. ${gradeWeightNote}
` : '';
    
    const prompt = `당신은 전문 사이클 코치입니다. 다음 정보를 바탕으로 오늘 수행할 최적의 워크아웃을 실질적으로 추천해주세요. 형식적인 추천이 아닌, 실제 훈련에 바로 적용할 수 있는 구체적이고 실용적인 추천을 해주세요.
${basisBlock}
⚠️ **중요: 사용자의 운동 목적은 "${challenge}"입니다. 반드시 이 목적에 맞는 훈련을 추천해야 합니다.**

**사용자 정보:**
- FTP: ${ftp}W
- 체중: ${weight}kg
- W/kg: ${weight > 0 ? (ftp / weight).toFixed(2) : 'N/A'}
- ⚠️ **운동 목적: ${challenge}** (Fitness: 일반 피트니스/다이어트, GranFondo: 그란폰도, Racing: 레이싱, Elite: 엘리트 선수, PRO: 프로 선수)
  → **이 목적에 맞는 훈련만 추천해야 합니다. 목적과 무관한 훈련은 추천하지 마세요.**
- **등급(grade): ${grade}** (1·3: 관리자/코치, 2: 일반) → 목적·등급에 따른 가중 적용.
- 오늘의 몸상태: ${todayCondition} (조정 계수: ${(conditionAdjustment * 100).toFixed(0)}%)
${userConditionScore != null && userConditionName ? `
**⚠️ [최우선] 사용자가 선택한 오늘의 컨디션: "${userConditionName}" (${userConditionScore}점).**
- JSON의 condition_score는 반드시 ${userConditionScore}로 설정하세요. (5 단위 정수이면 그대로, 아니면 55~95 범위 5 단위로 맞춤)
- 이 컨디션에 맞는 강도의 워크아웃을 우선 추천하세요.
` : ''}

**과거 훈련 이력 분석 (최근 30일, 총 ${totalSessions}회):**
${JSON.stringify(limitedHistory, null, 2)}

**훈련 패턴 분석:**
- 총 훈련 횟수: ${totalSessions}회 (30일간)
- 평균 훈련 시간: ${avgDuration}분
- 평균 파워: ${avgPower}W (FTP 대비 ${ftp > 0 ? ((avgPower / ftp) * 100).toFixed(1) : 0}%)
- 평균 TSS: ${avgTSS}점
- 주간 평균 TSS: ${weeklyTSS}점
- 최근 7일 훈련: ${last7DaysSessions}회, 총 TSS: ${last7DaysTSS}점
- 고강도 훈련 비율: ${highIntensityRatio}% (TSS > 50 또는 파워 > FTP 90%)
- 훈련 빈도: ${totalSessions > 0 ? (totalSessions / 30).toFixed(1) : 0}회/일

**사용 가능한 워크아웃 목록 (${limitedWorkouts.length}개):**
${JSON.stringify(limitedWorkouts.map(w => ({
  id: w.id,
  title: w.title,
  totalSeconds: w.totalSeconds,
  segmentCount: w.segments?.length || 0,
  // 세그먼트 정보는 간소화 (타입과 목표만)
  segments: (w.segments || []).slice(0, 5).map(s => ({
    type: s.type,
    duration: s.duration,
    targetType: s.targetType,
    targetValue: s.targetValue
  }))
})), null, 2)}

**실질적인 분석 요청사항:**
1. **훈련 부하 분석**: 
   - 최근 7일 TSS(${last7DaysTSS}점)와 주간 평균 TSS(${weeklyTSS}점)를 비교하여 과훈련 위험도를 평가하세요.
   - 고강도 훈련 비율(${highIntensityRatio}%)을 고려하여 회복 필요 여부를 판단하세요.
   - 훈련 빈도(${(totalSessions / 30).toFixed(1)}회/일)를 분석하여 적절한 훈련 간격을 제안하세요.

2. **훈련 패턴 분석**:
   - 최근 30일 훈련 이력을 분석하여 훈련 강도 추세를 파악하세요 (증가/감소/유지).
   - 평균 파워(${avgPower}W, FTP 대비 ${ftp > 0 ? ((avgPower / ftp) * 100).toFixed(1) : 0}%)를 기준으로 현재 체력 수준을 평가하세요.
   - 훈련 일정의 공백이나 연속 훈련 패턴을 확인하여 오늘의 적절한 강도를 결정하세요.

3. **카테고리 선정**:
${hasBasis ? `   - 🎯 **고정**: 오늘의 추천 타입 "${basisRaw}"에 따라 카테고리는 **${basisCategory}** 로 고정합니다. 이 카테고리 내에서만 워크아웃 3개를 추천하세요. 훈련 목적(${challenge})·등급(${grade})에 가중을 두어 구체 워크아웃을 선정하세요.` : `   - ⚠️ **중요**: 사용자의 운동 목적은 "${challenge}"입니다. 이 목적에 맞는 훈련을 반드시 추천해야 합니다.
   - 위 분석을 바탕으로 사용자의 운동 목적(${challenge})과 현재 상태를 종합하여 오늘의 운동 카테고리(Endurance, Tempo, SweetSpot, Threshold, VO2Max, Recovery 중 하나)를 실질적으로 선정하세요.
   - 단순히 목적만 고려하지 말고, 실제 훈련 부하와 회복 상태를 우선 고려하세요.
   - 과훈련 위험이 있으면 Recovery, 충분한 회복이 있었다면 적절한 강도 훈련을 추천하세요.`}
${challenge === 'Racing' ? `
**레이싱 목적 특별 지침:**
- 레이싱 목적의 사용자이므로 경기 성능 향상에 초점을 맞춘 고강도 훈련을 우선 추천하세요.
- Threshold, VO2Max, SweetSpot 카테고리의 워크아웃을 우선 고려하세요.
- 레이싱에 필요한 순발력, 지구력, 회복력 향상을 위한 훈련을 추천하세요.
- 경기 시뮬레이션 훈련이나 인터벌 훈련을 우선 추천하세요.
- 일반 피트니스 목적의 저강도 훈련은 피하세요.
` : ''}
${challenge === 'GranFondo' ? `
**그란폰도 목적 특별 지침:**
- 그란폰도 목적의 사용자이므로 장거리 지구력 향상에 초점을 맞춘 훈련을 우선 추천하세요.
- Endurance, Tempo, SweetSpot 카테고리의 워크아웃을 우선 고려하세요.
- 장거리 라이딩에 필요한 지구력과 회복 능력 향상을 위한 훈련을 추천하세요.
- 일반 피트니스 목적의 저강도 훈련은 피하세요.
` : ''}
${challenge === 'Fitness' ? `
**일반 피트니스/다이어트 목적 특별 지침:**
- 일반 피트니스/다이어트 목적의 사용자이므로 건강과 체중 관리에 초점을 맞춘 훈련을 추천하세요.
- **입문자 접근성**: 워크아웃 title에 **(Lite)**가 포함된 카테고리 워크아웃을 **1순위로 반드시 포함**하여 추천하세요.
- Endurance, Tempo 카테고리의 워크아웃을 우선 고려하세요.
- 과도한 고강도 훈련보다는 지속 가능한 중강도 훈련을 추천하세요.
` : ''}
${challenge === 'GranFondo' ? `
**그란폰도 목적 입문자 접근성:**
- 워크아웃 title에 **(Lite)**가 포함된 카테고리 워크아웃을 **1순위로 반드시 포함**하여 추천하세요.
` : ''}
${challenge === 'Elite' ? `
**엘리트 선수(학생 선수) 특별 지침:**
- 엘리트 선수용으로 작성된 고강도 워크아웃을 우선 추천하세요.
- 훈련/휴식 비율을 최적화하여 과훈련을 방지하세요.
- 주간 TSS(Training Stress Score)를 고려하여 훈련 부하를 분산시키세요.
- 고강도 훈련 후에는 충분한 회복 시간(최소 24-48시간)을 권장합니다.
- 전문적인 메트릭 분석(NP, IF, TSS, TSB)을 제공하여 훈련 효과를 극대화하세요.
- 피크 성능을 위한 주기화(Periodization) 전략을 고려하세요.
- 훈련 소화 능력을 고려하여 적절한 강도의 워크아웃을 추천하세요.
` : ''}
${challenge === 'PRO' ? `
**PRO 선수(프로 선수) 특별 지침:**
- PRO 선수용으로 작성된 최고 강도 워크아웃을 우선 추천하세요.
- 프로 선수는 높은 훈련 부하를 소화할 수 있으므로, 강도가 높은 워크아웃을 추천하세요.
- 훈련/휴식 비율을 최적화하되, 프로 선수의 높은 회복 능력을 고려하세요.
- 주간 TSS(Training Stress Score)를 고려하여 훈련 부하를 분산시키되, 프로 선수 수준의 높은 부하를 감당할 수 있습니다.
- 고강도 훈련 후 회복 시간을 고려하되, 프로 선수는 더 빠른 회복이 가능합니다.
- 전문적인 메트릭 분석(NP, IF, TSS, TSB)을 제공하여 훈련 효과를 극대화하세요.
- 피크 성능을 위한 주기화(Periodization) 전략을 고려하세요.
- 프로 선수의 높은 훈련 소화 능력을 고려하여 강도가 높은 워크아웃을 추천하세요.
- 경기 일정과 시즌을 고려한 훈련 계획을 제안하세요.
` : ''}
4. **워크아웃 추천**:
   - ⚠️⚠️⚠️ **최우선 중요사항**: 사용자의 운동 목적은 "${challenge}"입니다. 
     * 반드시 이 목적에 맞는 워크아웃만 추천해야 합니다.
     * 목적과 무관한 워크아웃은 절대 추천하지 마세요.
     * 예를 들어, Racing 목적 사용자에게 Fitness 목적의 저강도 훈련을 추천하면 안 됩니다.
     * 각 목적에 맞는 특화된 훈련을 추천해야 합니다.
${(challenge === 'Fitness' || challenge === 'GranFondo') ? `
   - **Fitness/GranFondo 입문자 접근성 (필수)**: 훈련 목적이 Fitness 또는 GranFondo인 경우, **워크아웃 title에 (Lite)가 포함된 카테고리 워크아웃을 1순위로 반드시 포함**하여 추천하세요. 최소 1개 이상 (Lite) 워크아웃을 추천에 넣어 입문자 접근성을 높이세요.
` : ''}
   - **추천 순서(강도 순)**: 1번 = 가장 약한 강도(가벼운 훈련), 2번 = 중간 강도, 3번 = 가장 강한 강도(부하가 큰 훈련). 반드시 이 순서로 제시하세요.
   - **서로 다른 워크아웃**: 3개의 추천은 반드시 서로 다른 워크아웃이어야 합니다. 동일한 workoutId를 두 번 이상 추천하지 마세요. 1번·2번·3번 각각 다른 workoutId를 사용하세요.
${hasBasis ? `   - 🎯 **${basisCategory}** 카테고리(추천 타입 "${basisRaw}" 기반) 워크아웃 중에서 **목적(${challenge})·등급(${grade}) 가중**을 적용해, 강도가 약한 순으로 서로 다른 워크아웃 3개를 추천하세요.${(challenge === 'Fitness' || challenge === 'GranFondo') ? ' (Lite) 포함 워크아웃을 1순위로 포함하세요.' : ''}` : `   - 선정된 카테고리에 해당하는 워크아웃 중에서 사용자의 현재 상태와 **목적(${challenge})**에 맞는, 강도가 약한 순으로 서로 다른 워크아웃 3개를 추천하세요.${(challenge === 'Fitness' || challenge === 'GranFondo') ? ' (Lite) 포함 워크아웃을 1순위로 포함하세요.' : ''}`}
   
   - 각 추천 워크아웃에 대해 **구체적이고 실질적인 추천 이유**를 제공하세요:
     * 왜 이 워크아웃이 오늘 적합한지 (훈련 부하, 회복 상태, **목적(${challenge}) 달성 관점**)
     * 이 워크아웃이 사용자의 목적(${challenge}) 달성에 어떻게 도움이 되는지
     * 예상 TSS와 훈련 강도
     * 이 워크아웃을 수행했을 때의 기대 효과
     * 주의사항이나 조정이 필요한 부분
   - 형식적인 설명이 아닌, 실제로 훈련할 때 참고할 수 있는 구체적인 가이드를 제공하세요.
   - 사용자의 목적(${challenge})과 맞지 않는 워크아웃은 추천하지 마세요.

5. **컨디션 점수 (Condition Score) 평가 기준 (필수)**:
   - **의미**: 최근 훈련 부하(TSS)·휴식·피로 누적을 반영한 "오늘의 몸 상태" 지표입니다. 100점은 이상적·극히 드문 경우에만 해당합니다.
   - **반드시 5 단위로만 부여**: 55, 60, 65, 70, 75, 80, 85, 90, 95만 사용하세요. 100점은 **부여하지 마세요** (실질적 상한 95).
   - **기준 (참고)**: 훈련 이력이 거의 없거나 회복 필요 → 55~65. 꾸준한 훈련·적당한 부하 → 70~80. 주간 TSS 달성·피로 없음 → 85~90. 레이스 직전 피크 등 매우 제한적 상황 → 90~95. 95 이상·100은 사용하지 마세요.
   - **현실성**: 같은 훈련 데이터면 비슷한 점수가 나와야 하며, 과도하게 높은 점수(예: 100)는 피하세요.

6. **최종 확인 (필수)**:
   - 추천 개수: 반드시 **정확히 3개**의 워크아웃을 제시하세요.
   - **추천 강도 순서**: 1번(약) → 2번(중) → 3번(강). 1번이 가장 가벼운 훈련, 3번이 가장 부하가 큰 훈련이어야 합니다.
   - **서로 다른 워크아웃**: 1번·2번·3번의 workoutId는 **각각 달라야 합니다**. 같은 workoutId를 두 번 사용하면 안 됩니다.
   - (예상 TSS는 화면에서 자동으로 표시됩니다.)

다음 JSON 형식으로 응답해주세요:
{
  "condition_score": 55~95 (컨디션 점수, 반드시 5 단위 정수: 55,60,65,70,75,80,85,90,95. 100 사용 금지),
  "training_status": "Recovery Needed" | "Building Base" | "Ready to Race" | "Peaking" | "Overreaching",
  "vo2max_estimate": 20~100 (VO2max 추정값 ml/kg/min, 정수),
  "coach_comment": "사용자 훈련 상황을 반영한 한국어 코멘트 (2~3문장)",
  "selectedCategory": "선정된 카테고리 (예: Endurance (Z2))",
  "categoryReason": "카테고리 선정 이유",
  "recommendations": [
    { "rank": 1, "workoutId": 숫자(1번=약한 강도), "reason": "추천 이유" },
    { "rank": 2, "workoutId": 숫자(2번=중간 강도, 1번과 다른 ID), "reason": "추천 이유" },
    { "rank": 3, "workoutId": 숫자(3번=강한 강도, 1·2번과 다른 ID), "reason": "추천 이유" }
  ]
}
중요: recommendations의 workoutId는 1·2·3번 각각 서로 달라야 합니다. rank 1=약, 2=중, 3=강 순서를 반드시 지키세요.
중요: 반드시 유효한 JSON 형식으로만 응답하고, 다른 설명이나 마크다운 없이 순수 JSON만 제공해주세요.`;

    // 7. Gemini API 호출
    // 모델 우선순위 설정 (속도 우선 - 워크아웃 추천은 빠른 응답이 중요)
    // 1순위: Gemini 2.5 Flash - 빠른 응답, 효율적 (워크아웃 추천에 최적)
    // 2순위: Gemini 2.0-flash-exp - 빠른 응답
    // 3순위: Gemini 2.5 Pro - 정확도가 필요한 경우
    const PRIMARY_MODEL = 'gemini-2.5-flash';
    const SECONDARY_MODEL = 'gemini-2.0-flash-exp';
    const TERTIARY_MODEL = 'gemini-2.5-pro';
    
    let modelName = localStorage.getItem('geminiModelName');
    let apiVersion = localStorage.getItem('geminiApiVersion') || 'v1beta';
    let availableModelsList = [];
    
    // 사용 가능한 모델 목록 가져오기 함수
    const getAvailableModels = async () => {
      try {
        const modelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const modelsResponse = await fetch(modelsUrl);
        
        if (!modelsResponse.ok) {
          throw new Error('사용 가능한 모델을 조회할 수 없습니다.');
        }
        
        const modelsData = await modelsResponse.json();
        const availableModels = modelsData.models || [];
        
        const supportedModels = availableModels
          .filter(m => m.name && m.name.includes('gemini') && 
                       (m.supportedGenerationMethods || []).includes('generateContent'))
          .map(m => ({
            name: m.name,
            shortName: m.name.split('/').pop(),
            displayName: m.displayName || m.name
          }));
        
        if (supportedModels.length === 0) {
          throw new Error('generateContent를 지원하는 Gemini 모델을 찾을 수 없습니다.');
        }
        
        // 우선순위 정렬: 2.5 Flash -> 2.0 Flash Exp -> 2.5 Pro -> 기타 (속도 우선)
        const prioritizedModels = [];
        const primaryModel = supportedModels.find(m => m.shortName === PRIMARY_MODEL);
        const secondaryModel = supportedModels.find(m => m.shortName === SECONDARY_MODEL);
        const tertiaryModel = supportedModels.find(m => m.shortName === TERTIARY_MODEL);
        
        if (primaryModel) prioritizedModels.push(primaryModel);
        if (secondaryModel) prioritizedModels.push(secondaryModel);
        if (tertiaryModel) prioritizedModels.push(tertiaryModel);
        
        // 나머지 모델 추가
        supportedModels.forEach(m => {
          if (m.shortName !== PRIMARY_MODEL && 
              m.shortName !== SECONDARY_MODEL && 
              m.shortName !== TERTIARY_MODEL) {
            prioritizedModels.push(m);
          }
        });
        
        return prioritizedModels;
      } catch (error) {
        console.error('모델 목록 조회 실패:', error);
        throw error;
      }
    };
    
    // 모델 목록 가져오기 및 우선순위에 따라 모델 선택
    try {
      availableModelsList = await getAvailableModels();
      
      // 1순위 모델(2.5 Flash)로 초기화 (속도 우선)
      const primaryModelExists = availableModelsList.find(m => m.shortName === PRIMARY_MODEL);
      if (primaryModelExists) {
        modelName = PRIMARY_MODEL;
        console.log(`1순위 모델 설정 (속도 우선): ${modelName}`);
      } else {
        // 1순위 모델이 없으면 2순위 모델 시도
        const secondaryModelExists = availableModelsList.find(m => m.shortName === SECONDARY_MODEL);
        if (secondaryModelExists) {
          modelName = SECONDARY_MODEL;
          console.log(`1순위 모델을 사용할 수 없어 2순위 모델 설정: ${modelName}`);
        } else {
          // 2순위도 없으면 3순위 모델 시도
          const tertiaryModelExists = availableModelsList.find(m => m.shortName === TERTIARY_MODEL);
          if (tertiaryModelExists) {
            modelName = TERTIARY_MODEL;
            console.log(`2순위 모델도 사용할 수 없어 3순위 모델 설정: ${modelName}`);
          } else {
            // 모두 없으면 첫 번째 사용 가능한 모델 사용
            modelName = availableModelsList[0].shortName;
            console.log(`우선순위 모델을 사용할 수 없어 ${modelName} 사용`);
          }
        }
      }
      
      apiVersion = 'v1beta';
      localStorage.setItem('geminiModelName', modelName);
      localStorage.setItem('geminiApiVersion', apiVersion);
    } catch (error) {
      console.warn('모델 목록 조회 실패, 기본 모델 사용:', error);
      // 기본 모델로 폴백
      if (!modelName) {
        modelName = PRIMARY_MODEL;
        apiVersion = 'v1beta';
      }
    }
    
    const apiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
    
    // 재시도 로직이 포함된 API 호출 함수
    const callGeminiAPI = async (url, body, maxRetries = 3) => {
      let lastError;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // 재시도 전 대기 (exponential backoff)
          if (attempt > 1) {
            const waitTime = Math.min(1000 * Math.pow(2, attempt - 2), 10000); // 최대 10초
            contentDiv.innerHTML = `
              <div class="ai-loading-container">
                <div class="ai-brain-animation">
                  <div class="ai-neural-network">
                    <div class="neural-node node-1"></div>
                    <div class="neural-node node-2"></div>
                    <div class="neural-node node-3"></div>
                    <div class="neural-node node-4"></div>
                    <div class="neural-node node-5"></div>
                    <div class="neural-node node-6"></div>
                    <div class="neural-connection conn-1"></div>
                    <div class="neural-connection conn-2"></div>
                    <div class="neural-connection conn-3"></div>
                    <div class="neural-connection conn-4"></div>
                    <div class="neural-connection conn-5"></div>
                    <div class="neural-connection conn-6"></div>
                  </div>
                  <div class="ai-particles">
                    <div class="particle particle-1"></div>
                    <div class="particle particle-2"></div>
                    <div class="particle particle-3"></div>
                    <div class="particle particle-4"></div>
                    <div class="particle particle-5"></div>
                    <div class="particle particle-6"></div>
                  </div>
                </div>
                <div class="ai-loading-text">
                  <div class="ai-title">🔄 AI 분석 엔진 재시도 중</div>
                  <div class="ai-status" id="retryStatusContainer">
                    <span class="ai-status-item active">서버 연결 대기 중 (${attempt}/${maxRetries})</span>
                    <span class="ai-status-item">${Math.ceil(waitTime / 1000)}초 후 재시도합니다...</span>
                    <span class="ai-status-item">분석을 계속 진행합니다</span>
                  </div>
                </div>
              </div>
            `;
            
            // 재시도 중에도 상태 텍스트 순환 애니메이션
            let retryStatusIndex = 0;
            const retryStatusItems = contentDiv.querySelectorAll('#retryStatusContainer .ai-status-item');
            if (retryStatusItems.length > 0) {
              const retryStatusInterval = setInterval(() => {
                retryStatusItems.forEach((item, index) => {
                  item.classList.remove('active');
                  if (index === retryStatusIndex) {
                    item.classList.add('active');
                  }
                });
                retryStatusIndex = (retryStatusIndex + 1) % retryStatusItems.length;
              }, 1000);
              
              // waitTime 후 인터벌 정리
              setTimeout(() => {
                clearInterval(retryStatusInterval);
              }, waitTime);
            }
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
          
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error?.message || `API 오류: ${response.status}`;
            
            // 503 오류 (서비스 과부하) 또는 429 오류 (요청 한도 초과)인 경우 재시도
            if ((response.status === 503 || response.status === 429) && attempt < maxRetries) {
              lastError = new Error(errorMessage);
              console.warn(`API 호출 실패 (시도 ${attempt}/${maxRetries}): ${errorMessage}`);
              continue; // 재시도
            }
            
            // 그 외 오류는 즉시 throw
            throw new Error(errorMessage);
          }
          
          // 성공한 경우 응답 파싱 및 검증
          const responseData = await response.json();
          
          // 응답 데이터 검증
          if (!responseData || !responseData.candidates || !Array.isArray(responseData.candidates) || responseData.candidates.length === 0) {
            throw new Error('API 응답에 candidates가 없습니다.');
          }
          
          const candidate = responseData.candidates[0];
          if (!candidate || !candidate.content) {
            throw new Error('API 응답에 content가 없습니다.');
          }
          
          if (!candidate.content.parts || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
            throw new Error('API 응답에 parts가 없습니다.');
          }
          
          if (!candidate.content.parts[0] || !candidate.content.parts[0].text) {
            throw new Error('API 응답에 text가 없습니다.');
          }
          
          // 응답 완전성 검증 (finishReason 체크)
          const finishReason = candidate.finishReason || candidate.finish_reason;
          const responseText = candidate.content.parts[0].text;
          
          // MAX_TOKENS인 경우 부분 응답이라도 처리 시도
          if (finishReason === 'MAX_TOKENS') {
            console.warn('응답이 토큰 제한에 도달했습니다. 부분 응답을 처리합니다. finishReason:', finishReason);
            // JSON이 완전한지 확인
            const jsonStart = responseText.indexOf('{');
            const jsonEnd = responseText.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
              const jsonText = responseText.substring(jsonStart, jsonEnd + 1);
              const openBraces = (jsonText.match(/{/g) || []).length;
              const closeBraces = (jsonText.match(/}/g) || []).length;
              // JSON이 완전하면 부분 응답이라도 허용
              if (openBraces === closeBraces && responseText.length >= 200) {
                console.log('MAX_TOKENS이지만 JSON이 완전합니다. 부분 응답을 허용합니다.');
                // 부분 응답 허용 - 계속 진행
              } else {
                // JSON이 불완전하면 재시도
                console.warn('MAX_TOKENS이고 JSON이 불완전합니다. 재시도합니다.');
                throw new Error(`API 응답이 토큰 제한에 도달했습니다. finishReason: ${finishReason}`);
              }
            } else if (responseText.length >= 200) {
              // JSON이 없지만 텍스트가 충분히 길면 허용
              console.log('MAX_TOKENS이지만 응답 텍스트가 충분합니다. 부분 응답을 허용합니다.');
              // 부분 응답 허용 - 계속 진행
            } else {
              throw new Error(`API 응답이 토큰 제한에 도달했고 응답이 너무 짧습니다. finishReason: ${finishReason}`);
            }
          } else if (finishReason && finishReason !== 'STOP' && finishReason !== 'END_OF_TURN') {
            console.warn('응답이 불완전합니다. finishReason:', finishReason);
            throw new Error(`API 응답이 불완전합니다. finishReason: ${finishReason}`);
          }
          
          return responseData;
          
        } catch (error) {
          lastError = error;
          
          // 네트워크 오류나 타임아웃인 경우 재시도
          if ((error.message.includes('Failed to fetch') || 
               error.message.includes('network') ||
               error.message.includes('timeout')) && 
              attempt < maxRetries) {
            console.warn(`네트워크 오류 (시도 ${attempt}/${maxRetries}): ${error.message}`);
            continue; // 재시도
          }
          
          // 재시도 불가능한 오류는 즉시 throw
          if (attempt >= maxRetries) {
            throw error;
          }
        }
      }
      
      // 모든 재시도 실패
      throw lastError || new Error('API 호출에 실패했습니다.');
    };
    
    // 토큰 제한 설정 (분석 로직과 동일하게)
    const MAX_OUTPUT_TOKENS = 8192; // 상세한 분석 요청으로 인해 응답이 길어질 수 있으므로 8192로 증가
    
    // API 호출 (재시도 포함)
    let data;
    try {
      data = await callGeminiAPI(apiUrl, {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.7,
          topP: 0.8,
          topK: 40
        }
      });
    } catch (apiError) {
      // API 호출 실패 시 사용자에게 재시도 옵션 제공
      throw new Error(`API 호출 실패: ${apiError.message}\n\n서버가 일시적으로 과부하 상태일 수 있습니다. 잠시 후 다시 시도해주세요.`);
    }
    
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!responseText || typeof responseText !== 'string') {
      console.error('API 응답 데이터:', JSON.stringify(data, null, 2));
      throw new Error('API 응답에 유효한 텍스트가 없습니다. 응답 구조를 확인하세요.');
    }
    
    // 강화된 JSON 파싱 및 복구 함수 (훈련 분석 로직과 동일)
    const parseAndRecoverJSON = (text) => {
      if (!text || typeof text !== 'string') {
        return null;
      }
      
      // 1단계: 마크다운 코드 블록 제거
      let cleanedText = text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      
      // 2단계: JSON 객체 시작/끝 찾기
      const jsonStart = cleanedText.indexOf('{');
      const jsonEnd = cleanedText.lastIndexOf('}');
      
      if (jsonStart === -1) {
        console.warn('JSON 시작 문자({)를 찾을 수 없습니다.');
        return null;
      }
      
      if (jsonEnd === -1 || jsonEnd <= jsonStart) {
        console.warn('JSON 종료 문자(})를 찾을 수 없거나 잘못된 위치입니다.');
        // 불완전한 JSON 복구 시도
        cleanedText = cleanedText.substring(jsonStart);
        // 마지막 불완전한 속성 제거 시도
        cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*[^,}]*$/, '');
        cleanedText = cleanedText.replace(/,\s*$/, '');
        cleanedText += '}';
      } else {
        cleanedText = cleanedText.substring(jsonStart, jsonEnd + 1);
      }
      
      // 3단계: JSON 파싱 시도
      try {
        return JSON.parse(cleanedText);
      } catch (parseError) {
        console.warn('JSON 파싱 실패, 복구 시도 중...', parseError.message);
        
        // 4단계: 복구 시도 - 불완전한 문자열 제거
        // 마지막 불완전한 문자열 속성 제거
        cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*"[^"]*$/, '');
        cleanedText = cleanedText.replace(/,\s*"[^"]*":\s*[^,}]*$/, '');
        
        // 중괄호 균형 확인 및 복구
        const openBraces = (cleanedText.match(/{/g) || []).length;
        const closeBraces = (cleanedText.match(/}/g) || []).length;
        
        if (openBraces > closeBraces) {
          // 닫는 중괄호 추가
          cleanedText += '}'.repeat(openBraces - closeBraces);
        }
        
        // 5단계: 다시 파싱 시도
        try {
          return JSON.parse(cleanedText);
        } catch (secondError) {
          console.error('JSON 복구 실패:', secondError);
          return null;
        }
      }
    };
    
    // JSON 파싱 및 복구
    let recommendationData = parseAndRecoverJSON(responseText);
    
    if (!recommendationData) {
      console.error('JSON 파싱 및 복구 실패. 원본 응답:', responseText);
      throw new Error('AI 응답을 파싱할 수 없습니다. 응답이 불완전하거나 형식이 올바르지 않습니다.');
    }
    
    // 필수 필드 검증
    if (!recommendationData.selectedCategory || !recommendationData.recommendations || !Array.isArray(recommendationData.recommendations)) {
      console.error('필수 필드가 누락되었습니다:', recommendationData);
      throw new Error('AI 응답에 필수 정보가 누락되었습니다.');
    }
    
    // 추천 배열: workoutId 중복 제거(먼저 나온 rank 유지), rank 1·2·3 순 정렬
    const rawRecs = recommendationData.recommendations;
    const seenIds = new Set();
    let deduped = [];
    for (let i = 0; i < rawRecs.length; i++) {
      const r = rawRecs[i];
      const id = r.workoutId != null ? Number(r.workoutId) : null;
      if (id == null || seenIds.has(id)) continue;
      seenIds.add(id);
      deduped.push({ rank: r.rank != null ? Number(r.rank) : i + 1, workoutId: id, reason: r.reason || '' });
    }
    deduped.sort((a, b) => (a.rank || 0) - (b.rank || 0));
    deduped = deduped.slice(0, 3);

    // Fitness일 때만: 1순위 (Lite) 우선배정, 2~3순위는 비-Lite만. GranFondo는 일반 배정 방식 유지
    // workoutDetails 항목: getWorkout API의 item → id, title, description, author, total_seconds, segments 등
    const challengeNorm = String(challenge || '').trim();
    if (challengeNorm === 'Fitness') {
      const getTitle = (w) => String(w.title != null ? w.title : (w.name || w.workout_title || w.workout_name || '')).trim();
      const isLite = (w) => /\(lite\)/i.test(getTitle(w));
      const liteWorkouts = (workoutDetails || []).filter(function (w) { return isLite(w); });
      const liteIds = new Set(liteWorkouts.map(function (w) { return Number(w.id); }).filter(function (id) { return !isNaN(id) && id > 0; }));

      if (liteIds.size > 0) {
        // 1순위: 항상 (Lite) 1개 고정 (AI 1순위가 이미 Lite여도 이 블록은 항상 실행)
        const usedIds = new Set(deduped.map(function (r) { return Number(r.workoutId); }));
        let liteId = null;
        liteIds.forEach(function (id) {
          if (liteId == null && !usedIds.has(id)) liteId = id;
        });
        if (liteId == null) liteId = liteIds.values().next().value;
        const liteWorkout = liteWorkouts.find(function (w) { return Number(w.id) === liteId; });
        const liteTitle = liteWorkout ? getTitle(liteWorkout) || '(Lite)' : '(Lite)';
        const newFirst = { rank: 1, workoutId: liteId, reason: '입문자 접근성을 위해 (Lite) 워크아웃을 1순위로 추천합니다. ' + liteTitle };

        // 2~3순위: Lite 완전 배제 — (1) workoutId가 liteIds에 있으면 무조건 제외, (2) workoutDetails에서도 isLite 아님 확인
        const restCandidates = deduped.filter(function (r) {
          const rid = Number(r.workoutId);
          return rid !== liteId && !liteIds.has(rid);
        });
        const nonLiteRest = restCandidates.filter(function (r) {
          const w = (workoutDetails || []).find(function (wd) { return Number(wd.id) === Number(r.workoutId); });
          return w && !isLite(w) && !liteIds.has(Number(r.workoutId));
        });
        let slot2and3 = nonLiteRest.slice(0, 2);
        if (slot2and3.length < 2) {
          const usedFor2and3 = new Set(slot2and3.map(function (r) { return Number(r.workoutId); }));
          // 보조 풀: workoutDetails 중 Lite id 전부 제외(liteIds), 1순위 liteId 제외, 이미 쓴 id 제외
          const pool = (workoutDetails || []).filter(function (w) {
            const wid = Number(w.id);
            return !liteIds.has(wid) && wid !== liteId && !usedFor2and3.has(wid) && !isLite(w);
          });
          for (var i = slot2and3.length; i < 2 && pool.length > 0; i++) {
            const w = pool.shift();
            usedFor2and3.add(Number(w.id));
            slot2and3.push({ rank: i + 2, workoutId: Number(w.id), reason: getTitle(w) ? '강도 업 선택: ' + getTitle(w) : '추가 추천 워크아웃' });
          }
        }
        deduped = [newFirst].concat(slot2and3.map(function (r, i) { return { rank: i + 2, workoutId: r.workoutId, reason: r.reason || '' }; }));
      }
    }

    recommendationData.recommendations = deduped;
    
    // 컨디션 점수: 사용자 입력(컨디션별 강도 보정)이 있으면 우선 사용, 없으면 공통 모듈로 산출
    if (userConditionScore != null && userConditionScore >= 55 && userConditionScore <= 95) {
      recommendationData.condition_score = userConditionScore;
    } else if (typeof window.computeConditionScore === 'function') {
      const userForScore = { age: user.age, gender: user.gender, challenge: challenge, ftp: Number(ftp) || 200, weight: Number(weight) || 70 };
      const logsForScore = typeof window.dedupeLogsForConditionScore === 'function' ? window.dedupeLogsForConditionScore(recentHistory) : recentHistory;
      const today = new Date();
      const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const csResult = window.computeConditionScore(userForScore, logsForScore, todayStr);
      recommendationData.condition_score = csResult.score;
    }
    
    // 8. 추천 워크아웃 표시
    displayWorkoutRecommendations(recommendationData, workoutDetails, date);
    
  } catch (error) {
    console.error('워크아웃 추천 오류:', error);
    
    // 오류 메시지 파싱
    const errorMessage = error.message || '알 수 없는 오류가 발생했습니다.';
    const isOverloadError = errorMessage.includes('overloaded') || 
                           errorMessage.includes('503') || 
                           errorMessage.includes('Service Unavailable');
    
    let errorHtml = `
      <div class="error-message">
        <h3>${isOverloadError ? '⚠️ 서버 과부하' : '추천 오류'}</h3>
        <p style="margin: 16px 0; line-height: 1.6;">${errorMessage}</p>
    `;
    
    // 과부하 오류인 경우 재시도 버튼 제공
    if (isOverloadError) {
      const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
      const apiKey = localStorage.getItem('geminiApiKey');
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      errorHtml += `
        <div style="margin-top: 20px; padding: 16px; background: #fff3cd; border-radius: 8px; border: 1px solid #ffc107;">
          <p style="margin: 0 0 12px 0; color: #856404; font-weight: 500;">
            💡 해결 방법:
          </p>
          <ul style="margin: 0; padding-left: 20px; color: #856404;">
            <li>잠시 후 다시 시도해주세요 (1-2분 후)</li>
            <li>서버가 일시적으로 과부하 상태일 수 있습니다</li>
            <li>재시도 버튼을 클릭하여 다시 시도할 수 있습니다</li>
          </ul>
        </div>
        <div style="margin-top: 20px; display: flex; gap: 12px; justify-content: center;">
          <button class="result-close-btn" onclick="
            const fakeEvent = { stopPropagation: () => {}, isRetry: true };
            handleAIWorkoutRecommendation(fakeEvent, '${todayStr}');
          " style="min-width: 120px;">🔄 다시 시도</button>
          <button class="result-close-btn result-close-btn-cancel" onclick="closeWorkoutRecommendationModal()" style="min-width: 120px;">닫기</button>
        </div>
      `;
    } else {
      errorHtml += `
        <div style="margin-top: 20px; display: flex; gap: 12px; justify-content: center;">
          <button class="result-close-btn result-close-btn-cancel" onclick="closeWorkoutRecommendationModal()" style="min-width: 120px;">닫기</button>
        </div>
      `;
    }
    
    errorHtml += `</div>`;
    
    contentDiv.innerHTML = errorHtml;
  }
}

/**
 * 워크아웃 예상 TSS 추정 (세그먼트 강도·시간 기반) — 전체 목록·AI 추천과 동일 공식
 * TSS = (duration_h) * (IF)^2 * 100, IF = 가중 평균 강도(FTP 대비). ftp는 사용하지 않음(IF 비율만 사용).
 * 전체 목록은 window.estimateWorkoutTSS(workout) 사용 권장. 없을 때만 이 함수 사용.
 */
function estimateWorkoutTSS(workout, ftp) {
  if (!workout) return 0;
  const segs = workout.segments || [];
  let totalSec = Number(workout.total_seconds) || Number(workout.totalSeconds) || 0;
  if (totalSec <= 0 && segs.length > 0) {
    totalSec = segs.reduce((sum, s) => sum + (segDurationSec(s) || 0), 0);
  }
  if (totalSec <= 0 && (workout.totalMinutes != null || workout.total_minutes != null)) {
    const min = Number(workout.totalMinutes) || Number(workout.total_minutes) || 0;
    if (min > 0) totalSec = min * 60;
  }
  if (totalSec <= 0) return 0;
  var weightedIfSum = 0;
  var totalWeight = 0;
  for (var i = 0; i < segs.length; i++) {
    var dur = segDurationSec(segs[i]) || 0;
    if (dur <= 0) continue;
    var pct = getSegmentFtpPercent(segs[i]) || 0;
    var ifSeg = pct > 0 ? pct / 100 : 0.5;
    weightedIfSum += dur * ifSeg;
    totalWeight += dur;
  }
  var avgIF = totalWeight > 0 ? weightedIfSum / totalWeight : 0.65;
  var hours = totalSec / 3600;
  var tss = hours * (avgIF * avgIF) * 100;
  return Math.round(tss);
}

// 추천 워크아웃 표시 (대시보드와 동일: 점수, 훈련 상태, VO2max, 훈련 코멘트, AI 추천 블록 + 워크아웃 목록)
function displayWorkoutRecommendations(recommendationData, workoutDetails, date) {
  const contentDiv = document.getElementById('workoutRecommendationContent');
  
  const selectedCategory = recommendationData.selectedCategory || '알 수 없음';
  const categoryReason = recommendationData.categoryReason || '';
  const recommendations = recommendationData.recommendations || [];
  // 컨디션 점수: 공통 모듈(conditionScoreModule)에서 50~100 1점 단위로 산출된 값 사용, 없으면 50
  const conditionScore = typeof recommendationData.condition_score === 'number'
    ? Math.max(50, Math.min(100, Math.round(recommendationData.condition_score)))
    : 50;
  const trainingStatus = (recommendationData.training_status && String(recommendationData.training_status).trim()) || 'Building Base';
  const vo2maxEstimate = typeof recommendationData.vo2max_estimate === 'number' ? Math.max(20, Math.min(100, recommendationData.vo2max_estimate)) : 45;
  const coachCommentRaw = (recommendationData.coach_comment && String(recommendationData.coach_comment).trim()) || categoryReason || 'AI 추천';
  const userName = (window.currentUser && window.currentUser.name) ? String(window.currentUser.name).trim() : '사용자';
  const coachComment = coachCommentRaw.replace(/사용자님/g, userName + '님');
  
  const ftp = Number(window.currentUser?.ftp || window.userFTP || 0) || 200;
  
  const workoutMap = {};
  workoutDetails.forEach(w => {
    workoutMap[w.id] = w;
  });
  
  let html = `
    <div class="workout-recommendation-container">
      <div class="ai-recommend-dashboard-blocks" style="margin-bottom: 20px;">
        <div class="coach-comment-block" style="background: rgba(0, 212, 170, 0.1); border: 1px solid rgba(0, 212, 170, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
          <p class="category-reason" style="color: #ffffff; font-size: 0.63em; line-height: 1.6; margin: 0; word-break: break-word; white-space: pre-wrap;">${coachComment.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
        </div>
        <div class="dashboard-stats" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
          <div class="stat-item" style="background: rgba(0, 212, 170, 0.1); border-radius: 8px; padding: 12px; text-align: center;">
            <div style="font-size: 0.65em; color: #aaa; margin-bottom: 4px;">컨디션 점수</div>
            <div style="font-size: 1.2em; font-weight: 700; color: #00d4aa;">${conditionScore}</div>
          </div>
          <div class="stat-item" style="background: rgba(0, 212, 170, 0.1); border-radius: 8px; padding: 12px; text-align: center;">
            <div style="font-size: 0.65em; color: #aaa; margin-bottom: 4px;">훈련 상태</div>
            <div style="font-size: 0.75em; font-weight: 600; color: #00d4aa;">${trainingStatus}</div>
          </div>
          <div class="stat-item" style="background: rgba(0, 212, 170, 0.1); border-radius: 8px; padding: 12px; text-align: center;">
            <div style="font-size: 0.65em; color: #aaa; margin-bottom: 4px;">VO₂max 추정</div>
            <div style="font-size: 0.75em; font-weight: 600; color: #00d4aa;">${vo2maxEstimate} ml/kg/min</div>
          </div>
        </div>
        <div id="aiRecommendCategoryBlock" class="ai-recommend-category-block" style="background: rgba(0, 212, 170, 0.15); border: 1px solid rgba(0, 212, 170, 0.4); border-radius: 8px; padding: 12px 16px; cursor: pointer; text-align: center; margin-bottom: 16px;" onclick="var el = document.getElementById('recommendations-list-anchor'); if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });" title="클릭 시 추천 워크아웃 목록으로 이동">
          <span style="font-size: 1.5em; color: #aaa;">AI 추천: </span><span style="font-size: 1.5em; font-weight: 700; color: #00d4aa;">${selectedCategory}</span>
          <div style="font-size: 0.55em; color: #888; margin-top: 4px;">클릭 시 추천 워크아웃으로 이동</div>
        </div>
      </div>
      <div class="category-info" style="background: rgba(0, 212, 170, 0.1); border: 1px solid rgba(0, 212, 170, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
        <p class="category-reason" style="color: #ffffff; font-size: 0.63em; line-height: 1.6; margin: 0; word-break: break-word; white-space: pre-wrap;">${categoryReason}</p>
      </div>
      <div id="recommendations-list-anchor" class="recommendations-list">
  `;
  
  recommendations.forEach((rec, index) => {
    const workout = workoutMap[rec.workoutId];
    if (!workout) {
      html += `
        <div class="recommendation-item error">
          <p>워크아웃 ID ${rec.workoutId}를 찾을 수 없습니다.</p>
        </div>
      `;
      return;
    }
    
    const totalMinutes = Math.round((workout.total_seconds || workout.totalSeconds || 0) / 60) || Number(workout.totalMinutes) || Number(workout.total_minutes) || 0;
    const rankImages = ['assets/img/first.png', 'assets/img/2nd.png', 'assets/img/3rd.png'];
    const rankAlts = ['1위', '2위', '3위'];
    const rankBadge = index < 3
      ? `<img src="${rankImages[index]}" alt="${rankAlts[index]}" style="width: 1.4em; height: 1.4em; object-fit: contain; vertical-align: middle; flex-shrink: 0;">`
      : `${rec.rank}위`;
    const expectedTSS = (typeof window.estimateWorkoutTSS === 'function')
      ? window.estimateWorkoutTSS(workout)
      : estimateWorkoutTSS(workout, ftp);
    const tssNum = (expectedTSS != null && expectedTSS !== '' && !Number.isNaN(Number(expectedTSS))) ? Number(expectedTSS) : null;
    const tssLabel = tssNum !== null ? `<span class="workout-expected-tss" style="background: rgba(255, 255, 255, 0.1); color: #aaa; padding: 4px 10px; border-radius: 12px;">예상 TSS ${tssNum}</span>` : '';
    
    html += `
      <div class="recommendation-item" data-workout-id="${workout.id}" style="background: rgba(0, 212, 170, 0.05); border: 1px solid rgba(0, 212, 170, 0.2); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div class="recommendation-headline" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <span class="recommendation-rank" style="font-size: 1.4em; flex-shrink: 0; line-height: 1; display: inline-flex; align-items: center;">${rankBadge}</span>
            <h4 class="workout-title" style="color: #00d4aa; font-size: 0.77em; font-weight: bold; margin: 0; text-shadow: 0 0 8px rgba(0, 212, 170, 0.4); word-break: break-word; flex: 1; min-width: 0;">${workout.title || '워크아웃'}</h4>
            <div class="workout-meta" style="display: flex; align-items: center; gap: 8px; flex-shrink: 0; font-size: 0.595em; color: #aaa;">
              <span class="workout-category" style="background: rgba(0, 212, 170, 0.2); color: #00d4aa; padding: 4px 10px; border-radius: 12px;">${workout.author || '카테고리 없음'}</span>
              <span class="workout-duration" style="background: rgba(255, 255, 255, 0.1); color: #aaa; padding: 4px 10px; border-radius: 12px;">${totalMinutes}분</span>
              ${tssLabel}
            </div>
          </div>
          <div class="recommendation-reason-wrapper" style="background: rgba(0, 212, 170, 0.08); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
            <p class="recommendation-reason" style="color: #ffffff; font-size: 0.665em; line-height: 1.7; margin: 0; word-break: break-word; white-space: pre-wrap;">${rec.reason || '추천 이유 없음'}</p>
          </div>
          ${workout.description ? `<p class="workout-description" style="color: #aaa; font-size: 0.63em; line-height: 1.6; margin: 0 0 12px 0; word-break: break-word;">${workout.description}</p>` : ''}
          <div class="recommendation-action" style="display: flex; justify-content: center; width: 100%;">
            <button class="result-close-btn" onclick="selectRecommendedWorkout(${workout.id}, '${date}')" data-workout-id="${workout.id}" style="width: 100%; max-width: 200px; padding: 12px 20px; font-size: 1em; font-weight: bold; border-radius: 8px;">
              선택
            </button>
          </div>
        </div>
      </div>
    `;
  });
  
  html += `
      </div>
    </div>
  `;
  
  contentDiv.innerHTML = html;
}

// 추천된 워크아웃 선택
async function selectRecommendedWorkout(workoutId, date) {
  // 버튼 찾기 및 진행 애니메이션 시작
  let button = null;
  let originalButtonHTML = '';
  
  // 이벤트에서 버튼 찾기
  if (event && event.target) {
    button = event.target.closest('button');
  }
  
  // 버튼을 찾지 못한 경우 데이터 속성으로 찾기
  if (!button) {
    button = document.querySelector(`button[data-workout-id="${workoutId}"]`);
  }
  
  // 여전히 못 찾은 경우 recommendation-item으로 찾기
  if (!button) {
    const recommendationItem = document.querySelector(`.recommendation-item[data-workout-id="${workoutId}"]`);
    if (recommendationItem) {
      button = recommendationItem.querySelector('.recommendation-action .btn');
    }
  }
  
  // 여전히 못 찾은 경우 onclick 속성으로 찾기
  if (!button) {
    const buttons = document.querySelectorAll('.recommendation-action .btn');
    buttons.forEach(btn => {
      const onclickAttr = btn.getAttribute('onclick') || '';
      if (onclickAttr.includes(`selectRecommendedWorkout(${workoutId}`)) {
        button = btn;
      }
    });
  }
  
  if (button) {
    originalButtonHTML = button.innerHTML;
    button.disabled = true;
    button.classList.add('workout-selecting', 'selecting-loading');
    button.innerHTML = `
      <span class="select-progress-spinner"></span>
      <span class="select-progress-text">선택 중...</span>
    `;
  }
  
  try {
    console.log('Selecting recommended workout with ID:', workoutId);
    
    // 진행 상태 업데이트 - 워크아웃 정보 불러오는 중
    if (button) {
      button.classList.remove('selecting-loading');
      button.classList.add('selecting-preparing');
      button.innerHTML = `
        <span class="select-progress-spinner"></span>
        <span class="select-progress-text">워크아웃 정보 불러오는 중...</span>
      `;
    }
    
    // 워크아웃 정보 조회
    const ensureBaseUrl = () => {
      const base = window.GAS_URL;
      if (!base) throw new Error('GAS_URL is not set');
      return base;
    };
    
    const baseUrl = ensureBaseUrl();
    const params = new URLSearchParams({
      action: 'getWorkout',
      id: workoutId
    });
    const response = await fetch(`${baseUrl}?${params.toString()}`);
    const result = await response.json();
    
    if (!result.success || !result.item) {
      throw new Error('워크아웃 정보를 불러올 수 없습니다.');
    }
    
    const workout = result.item;
    console.log('Retrieved workout:', workout);
    
    // 진행 상태 업데이트 - 완료 중
    if (button) {
      button.classList.remove('selecting-preparing');
      button.classList.add('selecting-completing');
      button.innerHTML = `
        <span class="select-progress-spinner"></span>
        <span class="select-progress-text">완료 중...</span>
      `;
    }
    
    // 모달 닫기
    closeWorkoutRecommendationModal();
    
    // 사용자가 해당 워크아웃을 클릭한 것과 동일한 로직 적용: 훈련 준비 화면 워크아웃 선택 경로 사용
    // → currentWorkout 설정, localStorage/Firebase 저장, updateTrainingReadyScreenWithWorkout 호출로
    //    올바른 블럭에 그래프 표시 및 Select Dashboard 버튼 활성화
    if (typeof selectWorkoutForTrainingReady === 'function') {
      await selectWorkoutForTrainingReady(workout, { skipToast: true });
    } else {
      // 폴백: 기존 방식 유지
      const normalizedWorkout = {
        id: workout.id,
        title: String(workout.title || '제목 없음'),
        description: String(workout.description || ''),
        author: String(workout.author || '미상'),
        status: String(workout.status || '보이기'),
        total_seconds: Number(workout.total_seconds) || 0,
        publish_date: workout.publish_date || null,
        segments: Array.isArray(workout.segments) ? workout.segments : []
      };
      window.currentWorkout = normalizedWorkout;
      try { localStorage.setItem('currentWorkout', JSON.stringify(normalizedWorkout)); } catch (e) {}
      if (typeof updateTrainingReadyScreenWithWorkout === 'function') {
        updateTrainingReadyScreenWithWorkout(normalizedWorkout);
      }
    }
    
    // 훈련 준비 화면으로 이동
    if (typeof showScreen === 'function') {
      if (!window.screenHistory) window.screenHistory = [];
      const currentActive = document.querySelector(".screen.active") || 
                            Array.from(document.querySelectorAll(".screen")).find(s => 
                              s.style.display === "block" || window.getComputedStyle(s).display === "block"
                            );
      if (currentActive && currentActive.id && currentActive.id !== 'trainingReadyScreen') {
        const lastHistory = window.screenHistory.length > 0 ? window.screenHistory[window.screenHistory.length - 1] : null;
        if (lastHistory !== currentActive.id) {
          window.screenHistory.push(currentActive.id);
          if (window.screenHistory.length > 10) window.screenHistory.shift();
        }
      }
      showScreen('trainingReadyScreen', false);
    }
    
    showToast(`${(workout && workout.title) || '워크아웃'}이 선택되었습니다. 훈련을 시작하세요!`, 'success');
    
  } catch (error) {
    console.error('워크아웃 선택 오류:', error);
    showToast('워크아웃 선택 중 오류가 발생했습니다: ' + error.message, 'error');
    
    // 오류 시 버튼 상태 복원
    if (button && originalButtonHTML) {
      button.disabled = false;
      button.classList.remove('workout-selecting', 'selecting-loading', 'selecting-preparing', 'selecting-completing');
      button.innerHTML = originalButtonHTML;
    }
  }
}

// 사용자 대시보드용 AI 워크아웃 추천 (확인 팝업 없이 바로 3개 추천)
// coachData.recommended_workout(예: Active Recovery (Z1)) 기반 + 훈련목적·등급 가중 적용
async function runDashboardAIWorkoutRecommendation(userProfile, coachData) {
  try {
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey || !String(apiKey).trim()) {
      if (typeof showToast === 'function') {
        showToast('Gemini API 키가 없습니다. 환경 설정에서 입력해주세요.', 'error');
      } else if (typeof alert === 'function') {
        alert('Gemini API 키가 설정되지 않았습니다. 환경 설정에서 API 키를 입력해주세요.');
      }
      if (typeof openSettingsModal === 'function') { openSettingsModal(); }
      return;
    }
    const user = userProfile || window.currentUser || (() => {
      try {
        const s = localStorage.getItem('currentUser');
        return s ? JSON.parse(s) : null;
      } catch (e) { return null; }
    })();
    if (!user || !user.id) {
      if (typeof showToast === 'function') showToast('사용자 정보가 없습니다. 프로필을 선택해주세요.', 'error');
      return;
    }
    const today = new Date();
    const date = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const options = {};
    if (coachData && coachData.recommended_workout) {
      options.basisRecommendedWorkout = String(coachData.recommended_workout).trim();
    }
    showWorkoutRecommendationModal();
    await analyzeAndRecommendWorkouts(date, user, apiKey, options);
  } catch (e) {
    console.error('[AI] 오류:', e.message);
    if (typeof showToast === 'function') showToast('AI 추천 중 오류가 발생했습니다.', 'error');
  }
}

// 전역 함수로 등록 (워크아웃 화면 AI 추천 카드에서 index.html이 이 흐름을 사용하도록 노출)
window.showWorkoutRecommendationModal = showWorkoutRecommendationModal;
window.closeWorkoutRecommendationModal = closeWorkoutRecommendationModal;
window.analyzeAndRecommendWorkouts = analyzeAndRecommendWorkouts;
window.selectRecommendedWorkout = selectRecommendedWorkout;
window.runDashboardAIWorkoutRecommendation = runDashboardAIWorkoutRecommendation;
window.loadTrainingJournalCalendar = loadTrainingJournalCalendar;
window.handleTrainingDayClick = handleTrainingDayClick;
window.saveGeminiApiKey = saveGeminiApiKey;
window.testGeminiApiKey = testGeminiApiKey;
window.closeTrainingAnalysisModal = closeTrainingAnalysisModal;

// 환경 설정 팝업 관련 함수
function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.style.display = 'flex';
    // 저장된 API 키 로드
    loadGeminiApiKeyToSettings();
  }
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Gemini API 미등록 알림 팝업 (STELVIO 스타일)
function showGeminiApiNotRegisteredModal() {
  const modal = document.getElementById('geminiApiNotRegisteredModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

function closeGeminiApiNotRegisteredModal() {
  const modal = document.getElementById('geminiApiNotRegisteredModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function openGeminiApiSettingsFromModal() {
  closeGeminiApiNotRegisteredModal();
  if (typeof openSettingsModal === 'function') {
    openSettingsModal();
    const apiKeyInput = document.getElementById('settingsGeminiApiKey');
    if (apiKeyInput) {
      setTimeout(function() {
        apiKeyInput.focus();
        apiKeyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }
}

window.showGeminiApiNotRegisteredModal = showGeminiApiNotRegisteredModal;
window.closeGeminiApiNotRegisteredModal = closeGeminiApiNotRegisteredModal;
window.openGeminiApiSettingsFromModal = openGeminiApiSettingsFromModal;

// Privacy Policy 모달 관련 함수
async function openPrivacyPolicyModal() {
  const modal = document.getElementById('privacyPolicyModal');
  const contentDiv = document.getElementById('privacyPolicyContent');
  
  if (!modal || !contentDiv) {
    console.error('Privacy Policy 모달을 찾을 수 없습니다.');
    return;
  }
  
  // 모달 표시
  modal.classList.remove('hidden');
  
  // privacy.html 내용 로드
  try {
    const response = await fetch('/privacy.html');
    if (!response.ok) {
      throw new Error('Privacy Policy 파일을 불러올 수 없습니다.');
    }
    const html = await response.text();
    
    // HTML 파싱하여 body 내용만 추출
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const bodyContent = doc.body.innerHTML;
    
    // 스타일 적용된 컨테이너로 감싸서 표시
    contentDiv.innerHTML = `
      <div style="max-width: 800px; margin: 0 auto;">
        ${bodyContent}
      </div>
    `;
  } catch (error) {
    console.error('Privacy Policy 로드 오류:', error);
    contentDiv.innerHTML = `
      <div style="text-align: center; color: #dc2626; padding: 20px;">
        <p>Privacy Policy를 불러오는 중 오류가 발생했습니다.</p>
        <p style="font-size: 14px; color: #999; margin-top: 10px;">${error.message}</p>
      </div>
    `;
  }
}

function closePrivacyPolicyModal() {
  const modal = document.getElementById('privacyPolicyModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// 전역 함수로 등록
window.openPrivacyPolicyModal = openPrivacyPolicyModal;
window.closePrivacyPolicyModal = closePrivacyPolicyModal;

function loadGeminiApiKeyToSettings() {
  const apiKey = localStorage.getItem('geminiApiKey');
  const apiKeyInput = document.getElementById('settingsGeminiApiKey');
  if (apiKeyInput && apiKey) {
    apiKeyInput.value = apiKey;
    const isDisabled = localStorage.getItem('geminiApiKeyDisabled') === 'true';
    if (isDisabled) {
      apiKeyInput.disabled = true;
    }
  }
}

function resetApiKeyFromSettings() {
  const apiKeyInput = document.getElementById('settingsGeminiApiKey');
  if (!apiKeyInput) return;
  apiKeyInput.disabled = false;
  apiKeyInput.removeAttribute('readonly');
  localStorage.removeItem('geminiApiKeyDisabled');
  apiKeyInput.value = '';
  apiKeyInput.focus();
}

function testGeminiApiKeyFromSettings() {
  const apiKeyInput = document.getElementById('settingsGeminiApiKey');
  if (!apiKeyInput) return;
  
  // 기존 testGeminiApiKey 함수를 재사용하되, 입력 필드만 변경
  const originalInput = document.getElementById('geminiApiKey');
  if (originalInput) {
    const tempValue = originalInput.value;
    originalInput.value = apiKeyInput.value;
    testGeminiApiKey();
    originalInput.value = tempValue;
  } else {
    // geminiApiKey 요소가 없으면 직접 테스트
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      alert('API 키를 입력하세요.');
      return;
    }
    
    // API 키 테스트 로직 (기존 testGeminiApiKey 함수의 로직 재사용)
    const testBtn = document.getElementById('settingsTestApiKeyBtn');
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = '확인 중...';
    }
    
    // API 키 테스트
    fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`)
      .then(response => {
        if (!response.ok) {
          return fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        }
        return response;
      })
      .then(response => response.json())
      .then(data => {
        if (data.error) {
          throw new Error(data.error.message || 'API 키 확인 실패');
        }
        alert('API 키가 유효합니다.');
        if (testBtn) {
          testBtn.disabled = false;
          testBtn.innerHTML = '<img src="assets/img/api.png" alt="API 키 확인" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" /> API 키 확인';
        }
      })
      .catch(error => {
        alert(`API 키 확인 실패: ${error.message}\n\nAPI 키 발급 방법:\n1. https://aistudio.google.com/app/apikey 접속\n2. "Create API Key" 클릭\n3. 생성된 API 키를 복사하여 입력`);
        if (testBtn) {
          testBtn.disabled = false;
          testBtn.innerHTML = '<img src="assets/img/api.png" alt="API 키 확인" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" /> API 키 확인';
        }
      });
  }
}

function saveGeminiApiKeyFromSettings() {
  const apiKeyInput = document.getElementById('settingsGeminiApiKey');
  if (!apiKeyInput) return;
  
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    alert('API 키를 입력하세요.');
    return;
  }
  
  // 기존 saveGeminiApiKey 함수를 재사용하되, 입력 필드만 변경
  const originalInput = document.getElementById('geminiApiKey');
  if (originalInput) {
    const tempValue = originalInput.value;
    originalInput.value = apiKey;
    saveGeminiApiKey();
    originalInput.value = tempValue;
  } else {
    // geminiApiKey 요소가 없으면 직접 저장
    localStorage.setItem('geminiApiKey', apiKey);
    apiKeyInput.type = 'password';
    apiKeyInput.disabled = true;
    localStorage.setItem('geminiApiKeyDisabled', 'true');
    try {
      window.dispatchEvent(new CustomEvent('stelvio-gemini-apikey-changed', { detail: { hasKey: true } }));
    } catch (e) { console.warn('[saveGeminiApiKeyFromSettings] dispatchEvent failed:', e); }
    alert('API 키가 저장되었습니다.');
  }
  
  // 훈련일지 화면의 API 키 입력 필드도 업데이트
  if (originalInput) {
    originalInput.value = apiKey;
    const isDisabled = localStorage.getItem('geminiApiKeyDisabled') === 'true';
    if (isDisabled) {
      originalInput.disabled = true;
    }
  }
}

window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.resetApiKeyFromSettings = resetApiKeyFromSettings;
window.testGeminiApiKeyFromSettings = testGeminiApiKeyFromSettings;
window.saveGeminiApiKeyFromSettings = saveGeminiApiKeyFromSettings;
window.exportAnalysisReport = exportAnalysisReport;
window.showAIRecommendationConfirmModal = showAIRecommendationConfirmModal;
window.closeAIRecommendationConfirmModal = closeAIRecommendationConfirmModal;
window.confirmAIRecommendation = confirmAIRecommendation;

/* ==========================================================
   훈련 준비 화면 워크아웃 선택 기능
   Indoor Training 워크아웃 선택 모달을 사용하여 워크아웃 선택
========================================================== */

/**
 * 워크아웃 화면 선택 팝업 열기 (훈련 준비 그래프 블록 클릭 시, 훈련 결과와 무관한 독립 팝업)
 */
function openWorkoutScreenChoiceModal() {
  var el = document.getElementById('workoutScreenChoiceModal');
  if (el) {
    el.style.display = 'flex';
    el.classList.remove('hidden');
  }
}

/**
 * 워크아웃 화면 선택 팝업 닫기
 */
function closeWorkoutScreenChoiceModal() {
  var el = document.getElementById('workoutScreenChoiceModal');
  if (el) {
    el.style.display = 'none';
    el.classList.add('hidden');
  }
}

/**
 * 워크아웃 화면 타입 선택 (그래프 타잎 → workoutScreen, 리스트 타잎 → workoutSelectionModal)
 * 그래프 타잎: workoutScreen 전환 후 workoutViewInit/loadWorkouts 호출로 워크아웃 목록 API 요청 보장
 * @param {'graph'|'list'} type - 'graph': 전체 화면(그래프), 'list': 모달(리스트)
 */
function chooseWorkoutScreenType(type) {
  closeWorkoutScreenChoiceModal();
  if (type === 'graph') {
    if (typeof showScreen === 'function') {
      showScreen('workoutScreen');
    }
    // workoutScreen 진입 시와 동일하게 워크아웃 목록 API 요청 (워크아웃 목록 API 요청 시작 / listWorkouts JSONP)
    setTimeout(function () {
      var initFn = window.workoutViewInit || (typeof workoutViewInit === 'function' ? workoutViewInit : null);
      if (initFn) {
        try { initFn(); } catch (e) { console.warn('workoutViewInit error:', e); if (typeof loadWorkouts === 'function') loadWorkouts('all'); }
      } else if (typeof loadWorkouts === 'function') {
        loadWorkouts('all');
      }
    }, 150);
  } else if (type === 'list') {
    if (typeof openWorkoutSelectionModal === 'function') {
      window._trainingReadyWorkoutSelectionCallback = selectWorkoutForTrainingReady;
      openWorkoutSelectionModal();
    } else {
      console.error('[Training Ready] openWorkoutSelectionModal 함수를 찾을 수 없습니다.');
      if (typeof showToast === 'function') {
        showToast('워크아웃 선택 기능을 사용할 수 없습니다', 'error');
      }
    }
  }
}

/**
 * 훈련 준비 화면에서 워크아웃 선택: 먼저 화면 타입 선택 팝업을 연다
 */
async function openWorkoutSelectionForTrainingReady() {
  try {
    openWorkoutScreenChoiceModal();
  } catch (error) {
    console.error('[Training Ready] 워크아웃 화면 선택 팝업 열기 오류:', error);
    if (typeof showToast === 'function') {
      showToast('워크아웃 화면 선택을 열 수 없습니다: ' + (error.message || '알 수 없는 오류'), 'error');
    }
  }
}

/**
 * 훈련 준비 화면에서 워크아웃 선택 시 호출되는 함수
 * workout 객체를 직접 받아서 처리
 * options: { skipToast: true } — AI 추천 등에서 호출 시 토스트 중복 방지
 */
async function selectWorkoutForTrainingReady(workout, options) {
  try {
    const skipToast = options && options.skipToast === true;
    if (!workout) {
      console.error('[Training Ready] workout 데이터가 없습니다.');
      if (typeof showToast === 'function') {
        showToast('워크아웃 정보를 불러올 수 없습니다. (데이터 없음)', 'error');
      }
      return;
    }
    
    console.log('[Training Ready] 선택된 워크아웃:', {
      id: workout.id,
      title: workout.title,
      segmentsCount: workout.segments ? workout.segments.length : 0
    });
    
    // 워크아웃 데이터 정규화
    // 주의: 비밀번호 인증은 selectWorkoutForTraining에서 이미 수행되었으므로,
    // 여기서는 인증된 workout 객체를 받아서 처리합니다.
    const normalizedWorkout = {
      id: workout.id,
      title: String(workout.title || '제목 없음'),
      description: String(workout.description || ''),
      author: String(workout.author || '미상'),
      status: String(workout.status || '보이기'),
      total_seconds: Number(workout.total_seconds) || 0,
      publish_date: workout.publish_date || null,
      password: workout.password || null, // password 필드 포함 (보안상 저장하지 않음)
      segments: Array.isArray(workout.segments) ? workout.segments : []
    };
    
    // localStorage에 저장 시 password 필드는 제외 (보안)
    const workoutForStorage = {
      ...normalizedWorkout,
      password: undefined // password 필드 제외
    };
    
    // 전역 워크아웃 데이터 설정
    window.currentWorkout = normalizedWorkout;
    
    // localStorage에 저장 (password 필드 제외)
    try {
      localStorage.setItem('currentWorkout', JSON.stringify(workoutForStorage));
      console.log('[Training Ready] Workout saved to localStorage (password excluded)');
    } catch (e) {
      console.warn('[Training Ready] 로컬 스토리지 저장 실패:', e);
    }
    
    // Realtime Database에 users/{userId}/workout 경로에 저장 (개인훈련용). 타임아웃으로 UI 블로킹 방지.
    // 규칙이 auth.uid 기준이므로 Firebase Auth UID를 우선 사용해야 PERMISSION_DENIED 방지
    (function saveWorkoutToFirebaseWithTimeout() {
      var DB_SAVE_TIMEOUT_MS = 8000;
      var authUser = (typeof window.auth !== 'undefined' && window.auth.currentUser) ? window.auth.currentUser : null;
      var currentUser = window.currentUser || (function () { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; } })();
      var userId = (authUser && authUser.uid) || (currentUser && (currentUser.uid || currentUser.id));
      if (!userId || typeof db === 'undefined' || !db) {
        console.warn('[Training Ready] 사용자 ID가 없거나 Realtime Database가 초기화되지 않아 users/{userId}/workout에 저장하지 않습니다.');
        return;
      }
      if (!authUser && typeof console !== 'undefined' && console.info) {
        console.info('[Training Ready] Firebase Auth 미로그인: 워크아웃은 로컬에 저장됩니다. DB 동기화를 원하면 이메일/구글 로그인 후 이용하세요.');
      }
      var userWorkoutRef = db.ref('users/' + userId + '/workout');
      var savePromise = Promise.resolve();
      if (normalizedWorkout.id) {
        savePromise = savePromise.then(function () { return userWorkoutRef.child('workoutId').set(normalizedWorkout.id); });
      }
      if (normalizedWorkout.segments && Array.isArray(normalizedWorkout.segments) && normalizedWorkout.segments.length > 0) {
        savePromise = savePromise.then(function () { return userWorkoutRef.child('workoutPlan').set(normalizedWorkout.segments); });
      }
      var timeoutPromise = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Firebase 저장 시간 초과')); }, DB_SAVE_TIMEOUT_MS);
      });
      Promise.race([savePromise, timeoutPromise])
        .then(function () {
          if (normalizedWorkout.id) console.log('[Training Ready] workoutId saved to users/' + userId + '/workout/workoutId:', normalizedWorkout.id);
          if (normalizedWorkout.segments && normalizedWorkout.segments.length) console.log('[Training Ready] workoutPlan saved:', normalizedWorkout.segments.length, 'segments');
        })
        .catch(function (dbError) {
          console.error('[Training Ready] Realtime Database 저장 실패:', dbError);
          if (dbError && (dbError.message || '').indexOf('PERMISSION_DENIED') !== -1) {
            console.warn('[Training Ready] Realtime Database 규칙을 설정해 주세요.');
          }
        });
    })();
    
    // 훈련 준비 화면 업데이트
    updateTrainingReadyScreenWithWorkout(normalizedWorkout);
    
    if (!skipToast && typeof showToast === 'function') {
      showToast(`"${normalizedWorkout.title || '워크아웃'}" 워크아웃이 선택되었습니다.`, 'success');
    }
    
  } catch (error) {
    console.error('[Training Ready] 워크아웃 선택 오류:', error, error.stack);
    if (typeof showToast === 'function') {
      showToast(`워크아웃 선택 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`, 'error');
    }
  }
}

/**
 * 훈련 준비 화면에 워크아웃 정보 표시 및 세그먼트 그래프 그리기
 */
function updateTrainingReadyScreenWithWorkout(workout) {
  if (!workout) {
    console.warn('[Training Ready] 워크아웃 데이터가 없습니다.');
    return;
  }
  
  // 워크아웃 정보 표시 영역에 업로드 애니메이션 적용
  const workoutInfoSection = document.querySelector('#trainingReadyScreen .connection-device-section');
  if (workoutInfoSection) {
    workoutInfoSection.classList.add('workout-upload-animation');
    setTimeout(() => {
      workoutInfoSection.classList.remove('workout-upload-animation');
    }, 800);
  }
  
  // 워크아웃 이름 표시 (페이드인 애니메이션)
  const nameEl = safeGetElement('previewWorkoutName');
  if (nameEl) {
    nameEl.style.opacity = '0';
    nameEl.style.transform = 'translateY(-10px)';
    nameEl.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    setTimeout(() => {
      nameEl.textContent = workout.title || '워크아웃';
      nameEl.style.opacity = '1';
      nameEl.style.transform = 'translateY(0)';
    }, 100);
  }
  
  // 총 시간 계산 및 표시 (페이드인 애니메이션, 캐시용 totalMinutes 지원)
  const totalMinutes = Math.round((workout.total_seconds || workout.totalSeconds || 0) / 60) || Number(workout.totalMinutes) || Number(workout.total_minutes) || 0;
  const durationEl = safeGetElement('previewDuration');
  if (durationEl) {
    durationEl.style.opacity = '0';
    durationEl.style.transform = 'scale(0.9)';
    durationEl.style.transition = 'opacity 0.4s ease 0.1s, transform 0.4s ease 0.1s';
    setTimeout(() => {
      durationEl.textContent = `${totalMinutes}분`;
      durationEl.style.opacity = '1';
      durationEl.style.transform = 'scale(1)';
    }, 100);
  }
  
  // 평균 강도 계산 (세그먼트 타입별 FTP% 추출)
  let avgIntensity = 0;
  let totalDuration = 0;
  
  if (workout.segments && Array.isArray(workout.segments) && workout.segments.length > 0) {
    let weightedSum = 0;
    workout.segments.forEach(segment => {
      const duration = segDurationSec(segment) || 0;
      const ftpPercent = typeof getSegmentFtpPercent === 'function'
        ? getSegmentFtpPercent(segment)
        : (Number(segment.target_value) || 0);
      weightedSum += duration * ftpPercent;
      totalDuration += duration;
    });
    if (totalDuration > 0) {
      avgIntensity = Math.round(weightedSum / totalDuration);
    }
  }
  if (totalDuration <= 0 && (workout.total_seconds || workout.totalSeconds)) {
    totalDuration = Number(workout.total_seconds) || Number(workout.totalSeconds) || 0;
  }

  // 평균 강도 표시 (페이드인 애니메이션)
  const intensityEl = safeGetElement('previewIntensity');
  if (intensityEl) {
    intensityEl.style.opacity = '0';
    intensityEl.style.transform = 'scale(0.9)';
    intensityEl.style.transition = 'opacity 0.4s ease 0.2s, transform 0.4s ease 0.2s';
    setTimeout(() => {
      intensityEl.textContent = `${avgIntensity}%`;
      intensityEl.style.opacity = '1';
      intensityEl.style.transform = 'scale(1)';
    }, 100);
  }

  // 예상 TSS — AI 워크아웃 추천·세그먼트 그래프와 동일한 계산 로직 (가중 평균 IF)
  let estimatedTSS = (typeof window.estimateWorkoutTSS === 'function')
    ? window.estimateWorkoutTSS(workout)
    : 0;
  
  // 예상 TSS 표시 (페이드인 애니메이션)
  const expectedIntensityEl = safeGetElement('previewExpectedIntensity');
  if (expectedIntensityEl) {
    expectedIntensityEl.style.opacity = '0';
    expectedIntensityEl.style.transform = 'scale(0.9)';
    expectedIntensityEl.style.transition = 'opacity 0.4s ease 0.3s, transform 0.4s ease 0.3s';
    setTimeout(() => {
      expectedIntensityEl.textContent = String(estimatedTSS);
      expectedIntensityEl.style.opacity = '1';
      expectedIntensityEl.style.transform = 'scale(1)';
    }, 100);
  }
  
  // 예상 TSS 표시 (기존 previewTSS 요소가 있는 경우에도 업데이트)
  const tssEl = safeGetElement('previewTSS', { silent: true });
  if (tssEl) {
    tssEl.textContent = String(estimatedTSS);
  }
  
  // 세그먼트 그래프 그리기
  const segmentPreview = safeGetElement('segmentPreview');
  const placeholder = safeGetElement('segmentPreviewPlaceholder');
  
  if (workout.segments && workout.segments.length > 0) {
    if (segmentPreview) {
      // 컨테이너 높이를 고정 크기로 유지 (일관된 그래프 블록)
      segmentPreview.style.minHeight = '200px';
      segmentPreview.style.height = '200px';
      segmentPreview.style.maxHeight = '200px';
      
      // 기존 캔버스 즉시 제거
      const existingCanvas = document.getElementById('segmentPreviewGraph');
      if (existingCanvas) {
        existingCanvas.remove();
      }
      
      // placeholder 숨기기 (페이드아웃 애니메이션)
      if (placeholder) {
        placeholder.style.transition = 'opacity 0.2s ease';
        placeholder.style.opacity = '0';
        setTimeout(() => {
          placeholder.style.display = 'none';
        }, 200);
      }
      
      // 캔버스 생성 및 그래프 그리기 (placeholder 숨김 후 즉시)
      setTimeout(() => {
        // 캔버스 생성
        const canvas = document.createElement('canvas');
        canvas.id = 'segmentPreviewGraph';
        canvas.style.width = '100%';
        canvas.style.height = '200px';
        canvas.style.maxHeight = '200px';
        canvas.style.opacity = '0';
        canvas.style.transition = 'opacity 0.4s ease';
        segmentPreview.appendChild(canvas);
        
        // 세그먼트 그래프 그리기
        if (typeof drawSegmentGraph === 'function') {
          // DOM이 업데이트된 후 그래프 그리기
          setTimeout(() => {
            try {
              drawSegmentGraph(workout.segments, -1, 'segmentPreviewGraph', null);
              
              // 그래프 그리기 완료 후 페이드인
              setTimeout(() => {
                const drawnCanvas = document.getElementById('segmentPreviewGraph');
                if (drawnCanvas) {
                  // 그래프 페이드인
                  drawnCanvas.style.opacity = '1';
                  
                  // 컨테이너 크기 고정 유지
                  segmentPreview.style.minHeight = '200px';
                  segmentPreview.style.height = '200px';
                  segmentPreview.style.maxHeight = '200px';
                } else {
                  console.error('[Training Ready] segmentPreviewGraph 캔버스를 찾을 수 없습니다.');
                }
              }, 150); // 그래프 그리기 완료 대기
            } catch (error) {
              console.error('[Training Ready] drawSegmentGraph 실행 오류:', error);
            }
          }, 50); // DOM 업데이트 대기
        } else {
          console.warn('[Training Ready] drawSegmentGraph 함수를 찾을 수 없습니다.');
        }
      }, 250); // placeholder 숨김 후 약간의 지연
    }
  } else {
    if (segmentPreview) {
      // 세그먼트가 없으면 placeholder 표시
      if (placeholder) {
        placeholder.style.display = 'flex';
        placeholder.style.opacity = '0.3';
      }
      // 기존 캔버스 제거
      const existingCanvas = document.getElementById('segmentPreviewGraph');
      if (existingCanvas) {
        existingCanvas.remove();
      }
      // 컨테이너 높이 고정 크기 유지
      segmentPreview.style.minHeight = '200px';
      segmentPreview.style.height = '200px';
      segmentPreview.style.maxHeight = '200px';
    }
  }

  // 워크아웃 선택 시 Select Dashboard 버튼 활성화
  const btnStart = document.getElementById('btnStartTraining');
  const btnMobile = document.getElementById('btnMobileDashboard');
  if (btnStart) { btnStart.disabled = false; }
  if (btnMobile) { btnMobile.disabled = false; }
}

// 전역 함수로 등록
window.openWorkoutScreenChoiceModal = openWorkoutScreenChoiceModal;
window.closeWorkoutScreenChoiceModal = closeWorkoutScreenChoiceModal;
window.chooseWorkoutScreenType = chooseWorkoutScreenType;
window.openWorkoutSelectionForTrainingReady = openWorkoutSelectionForTrainingReady;
window.selectWorkoutForTrainingReady = selectWorkoutForTrainingReady;
window.updateTrainingReadyScreenWithWorkout = updateTrainingReadyScreenWithWorkout;

/* ==========================================================
   모바일 대시보드 화면 기능
   individual.html과 동일한 화면 및 블루투스 데이터 표시
========================================================== */

/**
 * 모바일 대시보드 화면 시작
 * individual.html과 동일한 화면 구조 및 블루투스 데이터 표시
 */
// 화면 방향 고정 함수 (세로 모드)
async function lockScreenOrientation() {
  try {
    // Screen Orientation API 사용 (최신 브라우저)
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('portrait');
      console.log('[Screen Orientation] 세로 모드로 고정됨');
      return true;
    }
    // iOS Safari 대응 (구형 API)
    else if (screen.lockOrientation) {
      screen.lockOrientation('portrait');
      console.log('[Screen Orientation] 세로 모드로 고정됨 (구형 API)');
      return true;
    }
    // 더 구형 브라우저 대응
    else if (screen.mozLockOrientation) {
      screen.mozLockOrientation('portrait');
      console.log('[Screen Orientation] 세로 모드로 고정됨 (Mozilla)');
      return true;
    }
    else if (screen.msLockOrientation) {
      screen.msLockOrientation('portrait');
      console.log('[Screen Orientation] 세로 모드로 고정됨 (IE/Edge)');
      return true;
    }
    else {
      console.warn('[Screen Orientation] 화면 방향 고정을 지원하지 않는 브라우저입니다');
      return false;
    }
  } catch (error) {
    // 사용자가 전체화면 모드가 아니거나 권한이 없는 경우 등
    console.warn('[Screen Orientation] 화면 방향 고정 실패:', error);
    return false;
  }
}

// 화면 방향 고정 해제 함수
function unlockScreenOrientation() {
  try {
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
      console.log('[Screen Orientation] 화면 방향 고정 해제됨');
    }
    else if (screen.unlockOrientation) {
      screen.unlockOrientation();
      console.log('[Screen Orientation] 화면 방향 고정 해제됨 (구형 API)');
    }
    else if (screen.mozUnlockOrientation) {
      screen.mozUnlockOrientation();
    }
    else if (screen.msUnlockOrientation) {
      screen.msUnlockOrientation();
    }
  } catch (error) {
    console.warn('[Screen Orientation] 화면 방향 고정 해제 실패:', error);
  }
}

async function startMobileDashboard() {
  console.log('[Mobile Dashboard] 모바일 대시보드 시작');
  
  try {
    // 화면 방향 세로 모드로 고정
    await lockScreenOrientation();
    
    // body에 클래스 추가 (CSS 적용) — 최적화된 스크롤 방지·body 잠금 유지, 건드리지 않음
    document.body.classList.add('mobile-dashboard-active');
    
    // Pull-to-refresh 방지 이벤트 핸들러 추가
    initializeMobileDashboardPullToRefreshPrevention();
    
    // 화면 꺼짐 방지 초기화
    initializeMobileDashboardWakeLock();
    // 사용자 정보 가져오기
    let currentUser = window.currentUser || null;
    if (!currentUser) {
      try {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
          currentUser = JSON.parse(storedUser);
        }
      } catch (e) {
        console.warn('[Mobile Dashboard] 사용자 정보 파싱 실패:', e);
      }
    }
    
    // 사용자 정보가 없으면 API에서 가져오기 시도
    if (!currentUser || !currentUser.ftp) {
      try {
        if (typeof apiGetUsers === 'function') {
          const result = await apiGetUsers();
          if (result && result.success && result.items && result.items.length > 0) {
            // 현재 선택된 사용자 찾기
            const selectedUserId = currentUser?.id || localStorage.getItem('selectedUserId');
            if (selectedUserId) {
              currentUser = result.items.find(u => String(u.id) === String(selectedUserId)) || result.items[0];
            } else {
              currentUser = result.items[0];
            }
            
            // 전역 변수에 저장
            window.currentUser = currentUser;
            try {
              localStorage.setItem('currentUser', JSON.stringify(currentUser));
            } catch (e) {
              console.warn('[Mobile Dashboard] 사용자 정보 저장 실패:', e);
            }
          }
        }
      } catch (error) {
        console.warn('[Mobile Dashboard] API에서 사용자 정보 가져오기 실패:', error);
      }
    }
    
    // 좌측 상단: 녹색 둥근네모(left_a.png) + 사용자 이름 표시 및 뒤로가기
    const mobileUserNameWrap = safeGetElement('mobile-dashboard-user-name-wrap');
    const mobileUserNameEl = safeGetElement('mobile-dashboard-user-name');
    if (mobileUserNameEl) {
      mobileUserNameEl.textContent = (currentUser && currentUser.name) ? currentUser.name : '사용자';
    }
    if (mobileUserNameWrap) {
      mobileUserNameWrap.title = '뒤로 가기';
      mobileUserNameWrap.onclick = function(e) {
        e.stopPropagation();
        if (typeof showStelvioExitConfirmPopup === 'function') {
          showStelvioExitConfirmPopup(function() {
            if (typeof showScreen === 'function') showScreen('basecampScreen');
          });
        } else if (typeof showScreen === 'function') {
          showScreen('basecampScreen');
        }
      };
    }
    
    // FTP 값 초기화 (사용자 정보에서)
    mobileUserFTP = currentUser?.ftp || window.userFTP || 200;
    window.mobileUserFTP = mobileUserFTP;
    window.userFTP = mobileUserFTP; // 전역 변수에도 저장
    
    console.log('[Mobile Dashboard] 사용자 정보:', {
      name: currentUser?.name,
      ftp: mobileUserFTP,
      weight: currentUser?.weight
    });
    
    // 속도계 초기화 (눈금, 레이블, 바늘 애니메이션) - FTP 값 반영
    initializeMobileGauge();
    
    // 시작 버튼 펄스 상태 동기화 (시작 전·재생 중 = 표시, 일시정지 = 숨김)
    if (typeof updateMobileStartPulse === 'function') updateMobileStartPulse();
    
    // 워크아웃이 선택되어 있으면 세그먼트 그래프 그리기
    if (window.currentWorkout && window.currentWorkout.segments && window.currentWorkout.segments.length > 0) {
      const canvas = safeGetElement('mobileIndividualSegmentGraph');
      if (canvas && typeof drawSegmentGraph === 'function') {
        setTimeout(() => {
          drawSegmentGraph(window.currentWorkout.segments, -1, 'mobileIndividualSegmentGraph', null);
          // 마스코트는 Canvas에 직접 그려지므로 별도 초기화 불필요
          // 펄스 애니메이션은 훈련 시작 시 자동으로 시작됨
        }, 100);
      }
    }
    
    // 모바일 대시보드 진입 시에도 펄스 애니메이션 시작 (워크아웃이 있고 훈련 중일 때)
    if (window.currentWorkout && window.currentWorkout.segments && 
        window.trainingState && window.trainingState.timerId) {
      // 훈련이 이미 진행 중이면 펄스 애니메이션 시작
      startMobileMascotPulseAnimation();
    }
    
    // 화면 크기 변경 시 세그먼트 그래프 재그리기 (마스코트 포함)
    if (window.mobileDashboardResizeHandler) {
      window.removeEventListener('resize', window.mobileDashboardResizeHandler);
    }
    window.mobileDashboardResizeHandler = () => {
      const mobileScreen = document.getElementById('mobileDashboardScreen');
      if (mobileScreen && 
          (mobileScreen.classList.contains('active') || 
           window.getComputedStyle(mobileScreen).display !== 'none')) {
        // 모바일 개인훈련 대시보드는 startMobileTrainingTimerLoop()에서 독립적으로 관리됨
        // 이 함수는 모바일 화면의 세그먼트 그래프를 업데이트하지 않음 (다른 화면과의 간섭 방지)
      }
    };
    window.addEventListener('resize', window.mobileDashboardResizeHandler);
    
    // ErgController 초기화 및 구독 설정 (Mobile Dashboard 전용)
    // ergController가 없어도 오류가 발생하지 않도록 안전하게 처리
    if (window.ergController && typeof window.ergController.subscribe === 'function') {
      try {
        // ERG 상태 구독 (반응형 상태 관리)
        window.ergController.subscribe((state, key, value) => {
          if (key === 'fatigueLevel' && value > 70) {
            // 피로도가 높을 때 사용자에게 알림
            if (typeof showToast === 'function') {
              showToast(`⚠️ 피로도 감지! ERG 강도를 낮춥니다.`);
            }
          }
          if (key === 'targetPower') {
            // 목표 파워 변경 시 UI 업데이트
            const targetPowerEl = safeGetElement('mobile-ui-target-power');
            if (targetPowerEl) {
              targetPowerEl.textContent = Math.round(value);
            }
          }
          if (key === 'enabled') {
            // ERG 모드 활성화/비활성화 시 UI 업데이트
            console.log('[Mobile Dashboard] ERG 모드 상태:', value ? 'ON' : 'OFF');
          }
        });

        // 연결 상태 업데이트 (ERG/훈련: 트레이너만. isSensorConnected는 updateMobileBluetoothConnectionStatus에서 any device 기준으로 설정)
        const isTrainerConnected = window.connectedDevices?.trainer?.controlPoint;
        if (isTrainerConnected && typeof window.ergController.updateConnectionStatus === 'function') {
          try {
            window.ergController.updateConnectionStatus('connected');
          } catch (err) {
            console.warn('[Mobile Dashboard] ErgController updateConnectionStatus 오류:', err);
          }
        }

        // 케이던스 업데이트 (Edge AI 분석용) - liveData 업데이트 시마다 호출
        if (window.liveData && window.liveData.cadence && typeof window.ergController.updateCadence === 'function') {
          try {
            window.ergController.updateCadence(window.liveData.cadence);
          } catch (err) {
            console.warn('[Mobile Dashboard] ErgController updateCadence 초기화 오류:', err);
          }
        }
        
        // window.liveData.targetPower 변경 감지 (세그먼트 변경 시 자동 업데이트)
        // 스마트 트레이너가 연결된 경우에만 동작
        if (isTrainerConnected) {
          let lastTargetPower = window.liveData?.targetPower || 0;
          const checkTargetPowerChange = () => {
            try {
              const currentTargetPower = window.liveData?.targetPower || 0;
              if (currentTargetPower !== lastTargetPower && currentTargetPower > 0) {
                // 목표 파워가 변경되었고 ERG 모드가 활성화되어 있으면 자동 업데이트
                if (window.ergController && window.ergController.state && window.ergController.state.enabled) {
                  if (typeof window.ergController.setTargetPower === 'function') {
                    window.ergController.setTargetPower(currentTargetPower).catch(err => {
                      console.warn('[Mobile Dashboard] ErgController 목표 파워 자동 업데이트 실패:', err);
                    });
                  }
                }
                lastTargetPower = currentTargetPower;
              }
            } catch (err) {
              console.warn('[Mobile Dashboard] 목표 파워 변경 감지 오류:', err);
            }
          };
          
          // 1초마다 목표 파워 변경 확인
          setInterval(checkTargetPowerChange, 1000);
        }
      } catch (err) {
        console.warn('[Mobile Dashboard] ErgController 초기화 오류 (무시하고 계속 진행):', err);
      }
    } else {
      // ErgController가 없어도 정상 동작하도록 로그만 출력
      console.log('[Mobile Dashboard] ErgController가 없습니다. ERG 모드 기능은 사용할 수 없습니다.');
    }
    
    // 블루투스 데이터 업데이트 시작
    startMobileDashboardDataUpdate();
    
    // 타이머 업데이트 시작
    startMobileDashboardTimer();
    
    // Firebase status 구독 시작 (랩 카운트다운 동기화용)
    setupMobileDashboardFirebaseStatusSubscription();
    
    // 블루투스 연결 상태 초기 업데이트 (모바일 대시보드 전용)
    setTimeout(() => {
      updateMobileBluetoothConnectionStatus();
      // 주기적으로 연결 상태 업데이트 (5초마다)
      if (window.mobileBluetoothStatusInterval) {
        clearInterval(window.mobileBluetoothStatusInterval);
      }
      window.mobileBluetoothStatusInterval = setInterval(() => {
        updateMobileBluetoothConnectionStatus();
      }, 5000);
    }, 500);
    
    // ErgController UI 초기화 (모바일 대시보드 전용 ERG 메뉴)
    setTimeout(() => {
      initMobileErgController();
    }, 500); // ErgController.js 로드 대기
    
    // 목표값 조절 슬라이더 이벤트 리스너
    const intensitySlider = safeGetElement('mobileIndividualIntensityAdjustmentSlider');
    if (intensitySlider) {
      // 기존 이벤트 리스너 제거 후 추가 (중복 방지)
      intensitySlider.replaceWith(intensitySlider.cloneNode(true));
      const newSlider = safeGetElement('mobileIndividualIntensityAdjustmentSlider');
      if (newSlider) {
        // 몸 상태 체크 값을 슬라이더 초기값에 적용 (훈련화면 로직 참고)
        let currentAdjustment = window.trainingIntensityAdjustment;
        
        // 로컬 스토리지에서 값 확인 (컨디션별 강도 보정에서 설정한 값)
        if (currentAdjustment === undefined || currentAdjustment === null) {
          try {
            const saved = localStorage.getItem('trainingIntensityAdjustment');
            if (saved) {
              currentAdjustment = parseFloat(saved);
              window.trainingIntensityAdjustment = currentAdjustment;
            } else {
              currentAdjustment = 1.0;
              window.trainingIntensityAdjustment = 1.0;
            }
          } catch (e) {
            currentAdjustment = 1.0;
            window.trainingIntensityAdjustment = 1.0;
          }
        }
        
        // challenge 타입에 따른 슬라이더 범위 설정 (동기 버전 사용)
        const challenge = getUserChallengeSync();
        const range = SLIDER_RANGE_BY_CHALLENGE[challenge] || SLIDER_RANGE_BY_CHALLENGE['Fitness'];
        newSlider.min = range.min;
        newSlider.max = range.max;
        
        // 슬라이더 범위 표시 라벨 업데이트
        const minLabel = safeGetElement('mobileIndividualIntensityAdjustmentSlider')?.parentElement?.querySelector('.mobile-individual-intensity-adjustment-min');
        const maxLabel = safeGetElement('mobileIndividualIntensityAdjustmentSlider')?.parentElement?.querySelector('.mobile-individual-intensity-adjustment-max');
        if (minLabel) minLabel.textContent = `${range.min}%`;
        if (maxLabel) maxLabel.textContent = `+${range.max}%`;
        
        console.log('[Mobile Dashboard] Challenge 타입:', challenge, '슬라이더 범위:', range);
        
        // 조정 계수를 슬라이더 값으로 변환 (0.95 → -5, 1.0 → 0, 1.03 → +3)
        const sliderValue = Math.round((currentAdjustment - 1.0) * 100);
        // challenge 타입에 따른 범위로 클램프
        const clampedValue = Math.max(range.min, Math.min(range.max, sliderValue));
        
        // 슬라이더 초기값 설정
        newSlider.value = clampedValue;
        
        // 초기값 표시
        const valueEl = safeGetElement('mobileIndividualIntensityAdjustmentValue');
        if (valueEl) {
          valueEl.textContent = clampedValue > 0 ? `+${clampedValue}%` : `${clampedValue}%`;
        }
        
        // 모바일 강도 조절 값 초기화 (몸 상태 체크 값 반영)
        window.mobileIntensityAdjustment = currentAdjustment;
        
        console.log('[Mobile Dashboard] 몸 상태 체크 값 적용:', {
          adjustment: currentAdjustment,
          sliderValue: sliderValue,
          clampedValue: clampedValue,
          mobileIntensityAdjustment: window.mobileIntensityAdjustment
        });
        
        newSlider.addEventListener('input', (e) => {
          const value = parseFloat(e.target.value);
          const valueEl = safeGetElement('mobileIndividualIntensityAdjustmentValue');
          if (valueEl) {
            valueEl.textContent = value > 0 ? `+${value}%` : `${value}%`;
          }
          window.mobileIntensityAdjustment = 1.0 + (value / 100);
          updateMobileTargetPower();
        });
      }
    }
    
    console.log('[Mobile Dashboard] 모바일 대시보드 초기화 완료');
  } catch (error) {
    console.error('[Mobile Dashboard] 초기화 오류:', error);
    if (typeof showToast === 'function') {
      showToast('모바일 대시보드 초기화 중 오류가 발생했습니다', 'error');
    }
  }
}

/**
 * 모바일 대시보드 Pull-to-refresh 방지 해제 (종료 시 스크롤 복원용)
 * 훈련 종료/다른 화면 이동 시 반드시 호출하여 document/body 스크롤 잠금 해제
 */
function teardownMobileDashboardPullToRefreshPrevention() {
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const refs = window.__mobileDashboardP2RHandlers;
  if (!refs) return;

  if (mobileScreen) {
    if (refs.touchStartHandler) mobileScreen.removeEventListener('touchstart', refs.touchStartHandler, { capture: true });
    if (refs.touchMoveHandler) mobileScreen.removeEventListener('touchmove', refs.touchMoveHandler, { capture: true });
    if (refs.touchEndHandler) mobileScreen.removeEventListener('touchend', refs.touchEndHandler, { capture: true });
  }
  if (refs.documentTouchMoveHandler) document.removeEventListener('touchmove', refs.documentTouchMoveHandler, { capture: true });
  if (refs.beforeUnloadHandler) window.removeEventListener('beforeunload', refs.beforeUnloadHandler);
  
  // Firebase status 구독 해제
  if (window.mobileDashboardFirebaseStatusUnsubscribe) {
    if (typeof window.mobileDashboardFirebaseStatusUnsubscribe === 'function') {
      window.mobileDashboardFirebaseStatusUnsubscribe();
    }
    window.mobileDashboardFirebaseStatusUnsubscribe = null;
    window.mobileDashboardFirebaseLapCountdown = undefined;
    console.log('[Mobile Dashboard] Firebase status 구독 해제 완료');
  }

  window.__mobileDashboardP2RHandlers = null;
  console.log('[Mobile Dashboard] Pull-to-refresh 방지 해제 (스크롤 복원)');
}

/**
 * 모바일 대시보드 Pull-to-refresh 방지 초기화 (Bluefy/iOS 강화 버전)
 * 종료 시 teardownMobileDashboardPullToRefreshPrevention() 호출 필수
 */
function initializeMobileDashboardPullToRefreshPrevention() {
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  if (!mobileScreen) return;

  // 이미 등록된 리스너가 있으면 먼저 해제 (중복 방지)
  teardownMobileDashboardPullToRefreshPrevention();

  // iOS/Bluefy 감지
  function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isBluefy() {
    const ua = navigator.userAgent || '';
    return /Bluefy/i.test(ua);
  }

  const isIOSDevice = isIOS();
  const isBluefyApp = isBluefy();

  let touchStartY = 0;
  let touchStartTime = 0;
  let isScrolling = false;
  let lastScrollY = 0;

  // 훈련 중인지 확인
  function isTrainingActive() {
    return window.trainingState && window.trainingState.timerId !== null;
  }

  // 스크롤 위치 확인 (더 정확한 방법)
  function isAtTop() {
    return (window.scrollY === 0 || window.scrollY <= 1) &&
           (mobileScreen.scrollTop === 0 || mobileScreen.scrollTop <= 1);
  }

  const touchStartHandler = (e) => {
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    isScrolling = false;
    lastScrollY = window.scrollY || mobileScreen.scrollTop || 0;
  };

  const touchMoveHandler = (e) => {
    if (!e.touches || e.touches.length === 0) return;

    const touchY = e.touches[0].clientY;
    const deltaY = touchY - touchStartY;
    const currentScrollY = window.scrollY || mobileScreen.scrollTop || 0;

    if (Math.abs(currentScrollY - lastScrollY) > 1) {
      isScrolling = true;
    }
    lastScrollY = currentScrollY;

    if (isTrainingActive() && isAtTop() && deltaY > 0 && !isScrolling) {
      const threshold = (isIOSDevice || isBluefyApp) ? 10 : 30;
      if (deltaY > threshold) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return false;
      }
    }

    if ((isIOSDevice || isBluefyApp) && isTrainingActive() && isAtTop() && deltaY > 5) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }
  };

  const touchEndHandler = () => {
    touchStartY = 0;
    touchStartTime = 0;
    isScrolling = false;
  };

  const documentTouchMoveHandler = (e) => {
    const target = e.target;
    if (mobileScreen.contains(target) || target === mobileScreen) {
      if (isTrainingActive() && isAtTop()) {
        const touchY = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
        const deltaY = touchY - touchStartY;
        if (deltaY > 5 && (isIOSDevice || isBluefyApp)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          return false;
        }
      }
    }
  };

  const beforeUnloadHandler = (e) => {
    if (isTrainingActive()) {
      e.preventDefault();
      e.returnValue = '훈련이 진행 중입니다. 정말 나가시겠습니까?';
      return e.returnValue;
    }
  };

  mobileScreen.addEventListener('touchstart', touchStartHandler, { passive: true, capture: true });
  mobileScreen.addEventListener('touchmove', touchMoveHandler, { passive: false, capture: true });
  mobileScreen.addEventListener('touchend', touchEndHandler, { passive: true, capture: true });
  document.addEventListener('touchmove', documentTouchMoveHandler, { passive: false, capture: true });
  window.addEventListener('beforeunload', beforeUnloadHandler);

  window.__mobileDashboardP2RHandlers = {
    touchStartHandler,
    touchMoveHandler,
    touchEndHandler,
    documentTouchMoveHandler,
    beforeUnloadHandler
  };

  console.log('[Mobile Dashboard] Pull-to-refresh 방지 초기화 완료', {
    isIOS: isIOSDevice,
    isBluefy: isBluefyApp,
    trainingActive: isTrainingActive()
  });
}

/**
 * 모바일 대시보드 화면 꺼짐 방지 초기화 (Wake Lock API + 비디오 트릭)
 */
function initializeMobileDashboardWakeLock() {
  // 전역 변수 초기화
  if (!window.mobileDashboardWakeLock) {
    window.mobileDashboardWakeLock = {
      wakeLock: null,
      wakeLockVideo: null,
      videoWakeLockInterval: null,
      wakeLockCheckInterval: null,
      isActive: false
    };
  }
  
  const wakeLockState = window.mobileDashboardWakeLock;
  const wakeLockSupported = 'wakeLock' in navigator;
  const WAKE_LOCK_CHECK_MS = 10000;
  
  // iOS, 안드로이드 및 크롬 브라우저 감지
  function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  
  function isAndroid() {
    const ua = navigator.userAgent || '';
    return /Android/.test(ua);
  }
  
  function isChrome() {
    const ua = navigator.userAgent || '';
    return /Chrome/.test(ua) && !/Edge|OPR|Edg/.test(ua);
  }
  
  function isMobileChrome() {
    return (isIOS() || isAndroid()) && isChrome();
  }
  
  // Bluefy 앱 감지 (iOS)
  function isBluefy() {
    const ua = navigator.userAgent || '';
    return /Bluefy/i.test(ua);
  }
  
  // 훈련 중 주기적으로 Wake Lock 상태 확인 후 해제됐으면 재요청 (통화/문자 복귀 등 대응)
  function startWakeLockPeriodicCheck() {
    if (wakeLockState.wakeLockCheckInterval) return;
    wakeLockState.wakeLockCheckInterval = setInterval(async () => {
      const isTrainingRunning = window.trainingState && window.trainingState.timerId !== null;
      if (!isTrainingRunning || !wakeLockState.isActive || document.visibilityState !== 'visible') return;
      const needReacquire = !wakeLockState.wakeLock ||
        (wakeLockState.wakeLockVideo && (wakeLockState.wakeLockVideo.paused || wakeLockState.wakeLockVideo.ended));
      if (needReacquire) {
        console.log('[Mobile Dashboard Wake Lock] 주기 체크: 화면 꺼짐 방지 재요청');
        await requestWakeLock();
      }
    }, WAKE_LOCK_CHECK_MS);
    console.log('[Mobile Dashboard Wake Lock] 주기적 재요청 체크 시작');
  }

  // Wake Lock API 사용
  async function requestWakeLock() {
    wakeLockState.isActive = true;
    // 모바일 크롬(iOS/안드로이드) 또는 Bluefy에서는 비디오 트릭을 우선 사용 (더 안정적)
    if (isMobileChrome() || (isIOS() && isBluefy())) {
      const deviceType = isIOS() ? 'iOS' : 'Android';
      const appType = isBluefy() ? ' (Bluefy)' : '';
      console.log(`[Mobile Dashboard Wake Lock] ${deviceType}${appType} 감지 - 비디오 트릭 사용`);
      if (!wakeLockState.wakeLockVideo) {
        startVideoWakeLock();
      }
      startWakeLockPeriodicCheck();
      return;
    }
    
    if (wakeLockSupported) {
      try {
        // 이미 활성화되어 있으면 재요청하지 않음
        if (wakeLockState.wakeLock) return;
        
        wakeLockState.wakeLock = await navigator.wakeLock.request('screen');
        console.log('[Mobile Dashboard Wake Lock] Screen Wake Lock 활성화됨');
        
        // 시스템이 해제했을 때 플래그 정리
        wakeLockState.wakeLock.addEventListener('release', () => {
          console.log('[Mobile Dashboard Wake Lock] 시스템에 의해 해제됨');
          wakeLockState.wakeLock = null;
          // 다시 요청 시도 (훈련 중일 때만)
          if (document.visibilityState === 'visible' && wakeLockState.isActive) {
            requestWakeLock();
          }
        });
        
        // 모바일(iOS/안드로이드)에서는 Wake Lock이 성공해도 비디오 트릭도 함께 사용 (이중 보장)
        if ((isIOS() || isAndroid()) && !wakeLockState.wakeLockVideo) {
          startVideoWakeLock();
        }
      } catch (err) {
        console.warn('[Mobile Dashboard Wake Lock] 활성화 실패:', err);
        // Wake Lock이 실패하면 비디오 트릭 사용
        if (!wakeLockState.wakeLockVideo) {
          startVideoWakeLock();
        }
      }
    } else {
      // Wake Lock API 미지원 시 비디오 트릭 사용
      if (!wakeLockState.wakeLockVideo) {
        startVideoWakeLock();
      }
    }
    startWakeLockPeriodicCheck();
  }
  
  // 비디오 트릭 사용 (iOS Safari, Bluefy 및 구형 브라우저 대응)
  function startVideoWakeLock() {
    try {
      // 이미 생성되어 있으면 재생성하지 않음
      if (wakeLockState.wakeLockVideo) return;
      
      // 훈련 진행 중일 때만 비디오 트릭 활성화
      const isTrainingRunning = window.trainingState && window.trainingState.timerId !== null;
      if (!isTrainingRunning) {
        console.log('[Mobile Dashboard Video Wake Lock] 훈련 진행 중이 아니므로 비디오 트릭 비활성화');
        return;
      }
      
      // Canvas로 최소 크기의 비디오 스트림 생성
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 2, 2);
      
      // Canvas를 MediaStream으로 변환 (iOS 크롬/Bluefy 대응을 위해 30fps 사용)
      const stream = canvas.captureStream(30);
      
      // 투명한 비디오 요소 생성
      wakeLockState.wakeLockVideo = document.createElement('video');
      wakeLockState.wakeLockVideo.setAttribute('playsinline', '');
      wakeLockState.wakeLockVideo.setAttribute('muted', '');
      wakeLockState.wakeLockVideo.setAttribute('loop', '');
      wakeLockState.wakeLockVideo.setAttribute('webkit-playsinline', '');
      wakeLockState.wakeLockVideo.setAttribute('autoplay', '');
      wakeLockState.wakeLockVideo.style.position = 'fixed';
      wakeLockState.wakeLockVideo.style.top = '0';
      wakeLockState.wakeLockVideo.style.left = '0';
      wakeLockState.wakeLockVideo.style.width = '1px';
      wakeLockState.wakeLockVideo.style.height = '1px';
      wakeLockState.wakeLockVideo.style.opacity = '0';
      wakeLockState.wakeLockVideo.style.pointerEvents = 'none';
      wakeLockState.wakeLockVideo.style.zIndex = '-9999';
      
      // 스트림을 비디오에 연결
      wakeLockState.wakeLockVideo.srcObject = stream;
      document.body.appendChild(wakeLockState.wakeLockVideo);
      
      // 비디오 재생 함수 (재시도 로직 포함)
      const playVideo = () => {
        const playPromise = wakeLockState.wakeLockVideo.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            console.log('[Mobile Dashboard Video Wake Lock] 화면 잠금 방지 활성화 (비디오 트릭)');
          }).catch(err => {
            console.warn('[Mobile Dashboard Video Wake Lock] 재생 실패, 재시도:', err);
            // 재생 실패 시 잠시 후 재시도
            setTimeout(playVideo, 1000);
          });
        }
      };
      
      // 초기 재생 시도
      playVideo();
      
      // 모바일(iOS/안드로이드)에서는 주기적으로 비디오 재생 상태 확인 및 재시작 (크롬/Bluefy 대응)
      if (isIOS() || isAndroid()) {
        if (wakeLockState.videoWakeLockInterval) {
          clearInterval(wakeLockState.videoWakeLockInterval);
        }
        wakeLockState.videoWakeLockInterval = setInterval(() => {
          if (wakeLockState.wakeLockVideo && (wakeLockState.wakeLockVideo.paused || wakeLockState.wakeLockVideo.ended)) {
            console.log('[Mobile Dashboard Video Wake Lock] 비디오가 일시정지됨, 재시작');
            playVideo();
          }
        }, 5000); // 5초마다 확인
      }
    } catch (err) {
      console.warn('[Mobile Dashboard Video Wake Lock] 초기화 실패:', err);
    }
  }
  
  // 화면 잠금 해제 (훈련 종료·로그 저장 후에만 호출)
  function releaseWakeLock() {
    if (wakeLockState.wakeLockCheckInterval) {
      clearInterval(wakeLockState.wakeLockCheckInterval);
      wakeLockState.wakeLockCheckInterval = null;
      console.log('[Mobile Dashboard Wake Lock] 주기적 재요청 체크 중지');
    }
    if (wakeLockState.wakeLock !== null) {
      wakeLockState.wakeLock.release().then(() => {
        wakeLockState.wakeLock = null;
        console.log('[Mobile Dashboard Wake Lock] Screen Wake Lock 해제됨');
      }).catch(err => {
        console.warn('[Mobile Dashboard Wake Lock] 해제 실패:', err);
        wakeLockState.wakeLock = null;
      });
    }
    
    // 비디오 트릭 주기적 확인 중지
    if (wakeLockState.videoWakeLockInterval !== null) {
      clearInterval(wakeLockState.videoWakeLockInterval);
      wakeLockState.videoWakeLockInterval = null;
    }
    
    if (wakeLockState.wakeLockVideo !== null) {
      try {
        if (wakeLockState.wakeLockVideo.srcObject) {
          wakeLockState.wakeLockVideo.srcObject.getTracks().forEach(track => track.stop());
          wakeLockState.wakeLockVideo.srcObject = null;
        }
        wakeLockState.wakeLockVideo.pause();
        if (wakeLockState.wakeLockVideo.parentNode) {
          wakeLockState.wakeLockVideo.parentNode.removeChild(wakeLockState.wakeLockVideo);
        }
        wakeLockState.wakeLockVideo = null;
        console.log('[Mobile Dashboard Video Wake Lock] 화면 잠금 방지 해제 (비디오 트릭)');
      } catch (err) {
        console.warn('[Mobile Dashboard Video Wake Lock] 해제 실패:', err);
      }
    }
    
    wakeLockState.isActive = false;
  }
  
  // 페이지 가시성 변경 시 재요청 (훈련 진행 중일 때만)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      // 훈련 진행 중일 때만 Wake Lock 재요청
      const isTrainingRunning = window.trainingState && window.trainingState.timerId !== null;
      if (isTrainingRunning && wakeLockState.isActive) {
        // 페이지가 다시 보이면 Wake Lock 재요청
        if (wakeLockSupported && !wakeLockState.wakeLock) {
          await requestWakeLock();
        }
        // 비디오 트릭도 재시작
        if (wakeLockState.wakeLockVideo && wakeLockState.wakeLockVideo.paused) {
          wakeLockState.wakeLockVideo.play().catch(err => {
            console.warn('[Mobile Dashboard Video Wake Lock] 재시작 실패:', err);
          });
        }
      }
    }
  });
  
  // 전역으로 노출 (워크아웃 시작/종료 시 호출)
  window.mobileDashboardWakeLockControl = {
    request: requestWakeLock,
    release: releaseWakeLock,
    isActive: () => wakeLockState.isActive
  };
  
  console.log('[Mobile Dashboard] 화면 꺼짐 방지 초기화 완료');
}

/**
 * 노트북 훈련 화면 전용 화면 꺼짐 방지 (모바일과 동일 로직, 독립 구동)
 * - window.laptopTrainingWakeLock / laptopTrainingWakeLockControl 사용 (모바일 미사용)
 * - 노트북 문맥: #trainingScreen 표시 중 + window.trainingState.timerId 로만 동작
 */
function initializeLaptopTrainingWakeLock() {
  if (!window.laptopTrainingWakeLock) {
    window.laptopTrainingWakeLock = {
      wakeLock: null,
      wakeLockVideo: null,
      videoWakeLockInterval: null,
      wakeLockCheckInterval: null,
      isActive: false
    };
  }

  var wakeLockState = window.laptopTrainingWakeLock;
  var wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  var WAKE_LOCK_CHECK_MS = 10000;

  function isLaptopTrainingScreenActive() {
    var el = document.getElementById('trainingScreen');
    return el && (el.classList.contains('active') || (window.getComputedStyle(el).display !== 'none'));
  }

  function isLaptopTrainingRunning() {
    return isLaptopTrainingScreenActive() && window.trainingState && window.trainingState.timerId != null;
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isAndroid() {
    return /Android/.test(navigator.userAgent || '');
  }
  function isChrome() {
    var ua = navigator.userAgent || '';
    return /Chrome/.test(ua) && !/Edge|OPR|Edg/.test(ua);
  }
  function isMobileChrome() {
    return (isIOS() || isAndroid()) && isChrome();
  }
  function isBluefy() {
    return /Bluefy/i.test(navigator.userAgent || '');
  }

  function startWakeLockPeriodicCheck() {
    if (wakeLockState.wakeLockCheckInterval) return;
    wakeLockState.wakeLockCheckInterval = setInterval(function () {
      if (!isLaptopTrainingRunning() || !wakeLockState.isActive || document.visibilityState !== 'visible') return;
      var needReacquire = !wakeLockState.wakeLock ||
        (wakeLockState.wakeLockVideo && (wakeLockState.wakeLockVideo.paused || wakeLockState.wakeLockVideo.ended));
      if (needReacquire) {
        console.log('[Laptop Training Wake Lock] 주기 체크: 화면 꺼짐 방지 재요청');
        requestWakeLock();
      }
    }, WAKE_LOCK_CHECK_MS);
    console.log('[Laptop Training Wake Lock] 주기적 재요청 체크 시작');
  }

  function requestWakeLock() {
    wakeLockState.isActive = true;
    if (isMobileChrome() || (isIOS() && isBluefy())) {
      if (!wakeLockState.wakeLockVideo) {
        startVideoWakeLock();
      }
      startWakeLockPeriodicCheck();
      return;
    }

    if (wakeLockSupported) {
      try {
        if (wakeLockState.wakeLock) return;
        navigator.wakeLock.request('screen').then(function (wl) {
          wakeLockState.wakeLock = wl;
          console.log('[Laptop Training Wake Lock] Screen Wake Lock 활성화됨');
          wl.addEventListener('release', function () {
            wakeLockState.wakeLock = null;
            if (document.visibilityState === 'visible' && wakeLockState.isActive && isLaptopTrainingRunning()) {
              requestWakeLock();
            }
          });
          if ((isIOS() || isAndroid()) && !wakeLockState.wakeLockVideo) {
            startVideoWakeLock();
          }
        }).catch(function (err) {
          console.warn('[Laptop Training Wake Lock] 활성화 실패:', err);
          if (!wakeLockState.wakeLockVideo) startVideoWakeLock();
        });
      } catch (err) {
        console.warn('[Laptop Training Wake Lock] 활성화 실패:', err);
        if (!wakeLockState.wakeLockVideo) startVideoWakeLock();
      }
    } else {
      if (!wakeLockState.wakeLockVideo) startVideoWakeLock();
    }
    startWakeLockPeriodicCheck();
  }

  function startVideoWakeLock() {
    try {
      if (wakeLockState.wakeLockVideo) return;
      // 요청된 상태이고 노트북 훈련 화면이면 비디오 트릭 시작 (타이머는 아직 없을 수 있음)
      if (!wakeLockState.isActive || !isLaptopTrainingScreenActive()) return;

      var canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 2, 2);
      var stream = canvas.captureStream(30);

      wakeLockState.wakeLockVideo = document.createElement('video');
      wakeLockState.wakeLockVideo.setAttribute('playsinline', '');
      wakeLockState.wakeLockVideo.setAttribute('muted', '');
      wakeLockState.wakeLockVideo.setAttribute('loop', '');
      wakeLockState.wakeLockVideo.setAttribute('webkit-playsinline', '');
      wakeLockState.wakeLockVideo.setAttribute('autoplay', '');
      wakeLockState.wakeLockVideo.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-9999;';
      wakeLockState.wakeLockVideo.srcObject = stream;
      document.body.appendChild(wakeLockState.wakeLockVideo);

      function playVideo() {
        if (!wakeLockState.wakeLockVideo) return;
        var p = wakeLockState.wakeLockVideo.play();
        if (p && p.then) {
          p.then(function () {
            console.log('[Laptop Training Video Wake Lock] 화면 꺼짐 방지 활성화 (비디오 트릭)');
          }).catch(function (err) {
            setTimeout(playVideo, 1000);
          });
        }
      }
      playVideo();

      if (isIOS() || isAndroid()) {
        if (wakeLockState.videoWakeLockInterval) clearInterval(wakeLockState.videoWakeLockInterval);
        wakeLockState.videoWakeLockInterval = setInterval(function () {
          if (wakeLockState.wakeLockVideo && (wakeLockState.wakeLockVideo.paused || wakeLockState.wakeLockVideo.ended)) {
            playVideo();
          }
        }, 5000);
      }
    } catch (err) {
      console.warn('[Laptop Training Video Wake Lock] 초기화 실패:', err);
    }
  }

  function releaseWakeLock() {
    if (wakeLockState.wakeLockCheckInterval) {
      clearInterval(wakeLockState.wakeLockCheckInterval);
      wakeLockState.wakeLockCheckInterval = null;
    }
    if (wakeLockState.wakeLock) {
      wakeLockState.wakeLock.release().then(function () {
        wakeLockState.wakeLock = null;
        console.log('[Laptop Training Wake Lock] Screen Wake Lock 해제됨');
      }).catch(function (err) {
        wakeLockState.wakeLock = null;
      });
    }
    if (wakeLockState.videoWakeLockInterval) {
      clearInterval(wakeLockState.videoWakeLockInterval);
      wakeLockState.videoWakeLockInterval = null;
    }
    if (wakeLockState.wakeLockVideo) {
      try {
        if (wakeLockState.wakeLockVideo.srcObject) {
          wakeLockState.wakeLockVideo.srcObject.getTracks().forEach(function (t) { t.stop(); });
          wakeLockState.wakeLockVideo.srcObject = null;
        }
        wakeLockState.wakeLockVideo.pause();
        if (wakeLockState.wakeLockVideo.parentNode) {
          wakeLockState.wakeLockVideo.parentNode.removeChild(wakeLockState.wakeLockVideo);
        }
        wakeLockState.wakeLockVideo = null;
      } catch (e) {}
    }
    wakeLockState.isActive = false;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!isLaptopTrainingRunning() || !wakeLockState.isActive) return;
    if (wakeLockSupported && !wakeLockState.wakeLock) {
      requestWakeLock();
    }
    if (wakeLockState.wakeLockVideo && wakeLockState.wakeLockVideo.paused) {
      wakeLockState.wakeLockVideo.play().catch(function () {});
    }
  });

  window.laptopTrainingWakeLockControl = {
    request: requestWakeLock,
    release: releaseWakeLock,
    isActive: function () { return wakeLockState.isActive; }
  };
  console.log('[Laptop Training] 화면 꺼짐 방지 초기화 완료');
}

/** 모바일 대시보드 속도 적산용: 마지막 업데이트 시각 */
let mobileLastSpeedUpdateTime = null;

/**
 * 모바일 대시보드 블루투스 데이터 업데이트
 * window.liveData에서 데이터를 읽어서 화면에 표시
 */
function startMobileDashboardDataUpdate() {
  // 블루투스 데이터 업데이트 루프
  function updateMobileDashboardData() {
    const mobileScreen = document.getElementById('mobileDashboardScreen');
    if (!mobileScreen || 
        (!mobileScreen.classList.contains('active') && 
         window.getComputedStyle(mobileScreen).display === 'none')) {
      return;
    }

    // 속도계 센서: 누적 거리 산출 (liveData.speed → km 적산)
    const speedKmh = Number(window.liveData?.speed);
    if (speedKmh != null && !Number.isNaN(speedKmh) && speedKmh >= 0) {
      const now = Date.now() / 1000;
      if (mobileLastSpeedUpdateTime != null) {
        const dt = now - mobileLastSpeedUpdateTime;
        if (dt > 0 && dt < 10) {
          const mts = window.mobileTrainingState || {};
          mts.distanceKm = (mts.distanceKm || 0) + speedKmh * (dt / 3600);
          window.mobileTrainingState = mts;
        }
      }
      mobileLastSpeedUpdateTime = now;
    } else {
      mobileLastSpeedUpdateTime = null;
    }

    // ErgController에 케이던스 업데이트 (Edge AI 분석용)
    // ergController가 없어도 오류가 발생하지 않도록 안전하게 처리
    if (window.ergController && typeof window.ergController.updateCadence === 'function' && 
        window.liveData && window.liveData.cadence > 0) {
      try {
        window.ergController.updateCadence(window.liveData.cadence);
      } catch (err) {
        console.warn('[Mobile Dashboard] ErgController updateCadence 오류:', err);
      }
    }
    
    // window.liveData에서 데이터 읽기
    const liveData = window.liveData || { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    
    // 현재 파워 표시 (3초 평균값 사용)
    const powerValue = window.get3SecondAveragePower ? window.get3SecondAveragePower() : Math.round(liveData.power || 0);
    const powerEl = safeGetElement('mobile-ui-current-power');
    if (powerEl) {
      powerEl.textContent = Math.round(powerValue);
    }
    
    // 속도계 바늘 업데이트 (애니메이션 루프에서 부드럽게 이동)
    updateMobileGaugeNeedle(Math.round(powerValue));
    
    // 모바일 전용 세그먼트 파워 히스토리에 현재 파워 추가 (랩 평균 파워 계산용)
    const mts = window.mobileTrainingState || {};
    if (mts.segIndex !== undefined && mts.segIndex >= 0) {
      if (!mts.segmentPowerHistory) {
        mts.segmentPowerHistory = [];
      }
      // 현재 파워값을 히스토리에 추가 (0이 아닌 경우만)
      if (powerValue > 0) {
        mts.segmentPowerHistory.push(powerValue);
      }
    }
    
    // 케이던스 표시 (블루투스 데이터 - 0 표시 오류 개선)
    const cadence = Math.round(liveData.cadence || 0);
    const cadenceEl = safeGetElement('mobile-ui-cadence');
    if (cadenceEl) {
      cadenceEl.textContent = cadence;
    }
    
    // 심박수 표시 (블루투스 데이터) - hr 변수를 먼저 정의
    const hr = Math.round(liveData.heartRate || 0);
    const hrEl = safeGetElement('mobile-ui-hr');
    if (hrEl) {
      hrEl.textContent = hr;
    }
    
    // ErgController에 데이터 업데이트 (Edge AI 분석용)
    // ergController가 없어도 오류가 발생하지 않도록 안전하게 처리
    if (window.ergController && typeof window.ergController.updateCadence === 'function') {
      if (cadence > 0) {
        try {
          window.ergController.updateCadence(cadence);
        } catch (err) {
          console.warn('[Mobile Dashboard] ErgController updateCadence 오류:', err);
        }
      }
      if (powerValue > 0 && typeof window.ergController.updatePower === 'function') {
        try {
          window.ergController.updatePower(powerValue);
        } catch (err) {
          console.warn('[Mobile Dashboard] ErgController updatePower 오류:', err);
        }
      }
      if (hr > 0 && typeof window.ergController.updateHeartRate === 'function') {
        try {
          window.ergController.updateHeartRate(hr);
        } catch (err) {
          console.warn('[Mobile Dashboard] ErgController updateHeartRate 오류:', err);
        }
      }
    }
    
    // 랩 평균 파워 표시 (모바일 전용 상태 사용 - 독립적으로 구동)
    const lapPowerEl = safeGetElement('mobile-ui-lap-power');
    if (lapPowerEl) {
      // 모바일 전용 상태 사용
      const mts = window.mobileTrainingState || {};
      const segIndex = mts.segIndex !== undefined ? mts.segIndex : -1;
      
      // 모바일 전용 세그먼트 파워 히스토리에서 평균 계산
      let segmentAvgPower = 0;
      if (segIndex >= 0 && mts.segmentPowerHistory && mts.segmentPowerHistory.length > 0) {
        const sumPower = mts.segmentPowerHistory.reduce((sum, power) => sum + power, 0);
        segmentAvgPower = Math.round(sumPower / mts.segmentPowerHistory.length);
      } else {
        // 파워 히스토리가 없으면 liveData에서 가져오기 (폴백)
        segmentAvgPower = Math.round(liveData.segmentAvgPower || liveData.avgPower || 0);
      }
      
      lapPowerEl.textContent = segmentAvgPower;
    }
    
    // 목표 파워 업데이트 (모바일 전용 상태 사용)
    updateMobileTargetPower();
    
    // 속도계 원호 업데이트 (LAP AVG 업데이트 후 달성도 반영)
    if (typeof updateMobileTargetPowerArc === 'function') {
      updateMobileTargetPowerArc();
    }
  }
  
  // 100ms마다 업데이트 (블루투스 데이터는 빠르게 업데이트됨)
  if (window.mobileDashboardUpdateInterval) {
    clearInterval(window.mobileDashboardUpdateInterval);
  }
  window.mobileDashboardUpdateInterval = setInterval(updateMobileDashboardData, 100);
  
  // 즉시 한 번 실행
  updateMobileDashboardData();
}

/**
 * 모바일 대시보드 타이머 업데이트 (비활성화)
 * 모바일 개인훈련 대시보드는 startMobileTrainingTimerLoop()에서 독립적으로 관리됨
 * 이 함수는 더 이상 사용하지 않음 (다른 화면과의 간섭 방지)
 */
function startMobileDashboardTimer() {
  // 모바일 개인훈련 대시보드는 startMobileTrainingTimerLoop()에서 독립적으로 관리됨
  // 이 함수는 호출되어도 아무 작업도 수행하지 않음 (다른 화면과의 간섭 방지)
  console.log('[Mobile Dashboard] startMobileDashboardTimer 호출됨 (비활성화됨 - 모바일 전용 타이머 사용)');
  
  // 기존 인터벌이 있으면 정리
  if (window.mobileDashboardTimerInterval) {
    clearInterval(window.mobileDashboardTimerInterval);
    window.mobileDashboardTimerInterval = null;
  }
}

/**
 * 모바일 대시보드 Firebase status 구독 설정 (랩 카운트다운 동기화용)
 */
function setupMobileDashboardFirebaseStatusSubscription() {
  // SESSION_ID 가져오기 (블루투스 코치와 동일한 방식)
  function getMobileDashboardSessionId() {
    if (typeof window !== 'undefined' && window.SESSION_ID) {
      return window.SESSION_ID;
    }
    if (typeof window !== 'undefined' && window.currentTrainingRoomId) {
      const roomId = String(window.currentTrainingRoomId);
      window.SESSION_ID = roomId;
      return roomId;
    }
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('currentTrainingRoomId');
        if (stored) {
          window.SESSION_ID = String(stored);
          return window.SESSION_ID;
        }
      } catch (e) {
        console.warn('[Mobile Dashboard] localStorage 접근 실패:', e);
      }
    }
    return null;
  }
  
  const sessionId = getMobileDashboardSessionId();
  if (!sessionId) {
    console.warn('[Mobile Dashboard] SESSION_ID가 없어 Firebase status 구독을 시작할 수 없습니다.');
    return;
  }
  
  // db 객체 확인 및 초기화 시도
  let dbInstance = db;
  if (typeof dbInstance === 'undefined') {
    if (typeof window.db !== 'undefined') {
      dbInstance = window.db;
    } else if (typeof firebase !== 'undefined' && firebase.database) {
      try {
        dbInstance = firebase.database();
        window.db = dbInstance;
        console.log('[Mobile Dashboard] Firebase db 객체를 동적으로 초기화했습니다.');
      } catch (e) {
        console.warn('[Mobile Dashboard] Firebase db 초기화 실패:', e);
        return;
      }
    } else {
      console.warn('[Mobile Dashboard] Firebase가 초기화되지 않았습니다.');
      return;
    }
  }
  
  // 기존 구독 해제
  if (window.mobileDashboardFirebaseStatusUnsubscribe) {
    if (typeof window.mobileDashboardFirebaseStatusUnsubscribe === 'function') {
      window.mobileDashboardFirebaseStatusUnsubscribe();
    }
    window.mobileDashboardFirebaseStatusUnsubscribe = null;
  }
  
  // Firebase status 구독 (랩 카운트다운 동기화)
  const statusRef = dbInstance.ref(`sessions/${sessionId}/status`);
  
  // 초기 상태 동기화 (중간 입실 시 현재 상태를 즉시 반영)
  statusRef.once('value').then((snapshot) => {
    try {
      if (!snapshot) return;
      const status = snapshot.val();
      if (status && status.state === 'running') {
        // 훈련이 진행 중이면 즉시 동기화
        const mts = window.mobileTrainingState || {};
        const w = window.currentWorkout;
        
        if (status.elapsedTime !== undefined && status.elapsedTime !== null) {
          mts.elapsedSec = status.elapsedTime;
        }
        
        if (status.segmentIndex !== undefined && status.segmentIndex !== null) {
          mts.segIndex = status.segmentIndex;
          mts.segmentPowerHistory = [];
        }
        
        if (status.lapCountdown !== undefined && status.lapCountdown !== null && w && w.segments) {
          window.mobileDashboardFirebaseLapCountdown = status.lapCountdown;
          const currentSeg = w.segments[status.segmentIndex || 0];
          if (currentSeg) {
            let segDur = 0;
            if (typeof currentSeg.duration_sec === 'number') {
              segDur = Math.max(0, Math.floor(currentSeg.duration_sec));
            } else if (typeof currentSeg.duration === 'number') {
              segDur = Math.max(0, Math.floor(currentSeg.duration));
            }
            if (segDur > 0 && status.lapCountdown >= 0) {
              mts.segElapsedSec = Math.max(0, segDur - status.lapCountdown);
            }
          }
        }
        
        console.log('[Mobile Dashboard] 초기 상태 동기화 완료 (중간 입실):', {
          elapsedTime: status.elapsedTime,
          segmentIndex: status.segmentIndex,
          lapCountdown: status.lapCountdown
        });
      }
    } catch (e) {
      console.warn('[Mobile Dashboard] 초기 상태 동기화 오류:', e);
    }
  }).catch((e) => {
    console.warn('[Mobile Dashboard] 초기 상태 읽기 실패:', e);
  });
  
  const statusUnsubscribe = statusRef.on('value', (snapshot) => {
    try {
      if (!snapshot) return;
      const status = snapshot.val();
      if (status) {
        // 랩 카운트다운 값 동기화 (코치 화면과 동일한 값 사용)
        if (status.lapCountdown !== undefined && status.lapCountdown !== null) {
          window.mobileDashboardFirebaseLapCountdown = status.lapCountdown;
          console.log('[Mobile Dashboard] Firebase 랩 카운트다운 동기화:', status.lapCountdown, '초');
          
          // 랩 카운트다운을 기반으로 세그먼트 경과 시간도 동기화
          const mts = window.mobileTrainingState || {};
          const w = window.currentWorkout;
          if (w && w.segments && status.segmentIndex !== undefined) {
            const currentSegIndex = status.segmentIndex || 0;
            const currentSeg = w.segments[currentSegIndex];
            if (currentSeg) {
              // 세그먼트 duration 계산
              let segDur = 0;
              if (typeof currentSeg.duration_sec === 'number') {
                segDur = Math.max(0, Math.floor(currentSeg.duration_sec));
              } else if (typeof currentSeg.duration === 'number') {
                segDur = Math.max(0, Math.floor(currentSeg.duration));
              }
              
              // 랩 카운트다운(남은 시간)을 기반으로 세그먼트 경과 시간 역산
              if (segDur > 0 && status.lapCountdown >= 0) {
                const segElapsedSec = Math.max(0, segDur - status.lapCountdown);
                mts.segElapsedSec = segElapsedSec;
                console.log('[Mobile Dashboard] 세그먼트 경과 시간 동기화 (랩 카운트다운 기반):', segElapsedSec, '초 (세그먼트:', currentSegIndex, ', duration:', segDur, ', 남은 시간:', status.lapCountdown, ')');
              }
            }
          }
        }
        
        // 경과 시간도 동기화 (이미 동기화되고 있다고 했지만, 확실히 하기 위해)
        if (status.elapsedTime !== undefined && status.elapsedTime !== null) {
          const mts = window.mobileTrainingState || {};
          const prevElapsedSec = mts.elapsedSec || 0;
          if (Math.abs(prevElapsedSec - status.elapsedTime) > 1) {
            // 경과 시간이 1초 이상 차이나면 동기화 (중간에 들어온 경우)
            mts.elapsedSec = status.elapsedTime;
            console.log('[Mobile Dashboard] Firebase 경과 시간 동기화:', status.elapsedTime, '초 (이전:', prevElapsedSec, '초)');
          }
        }
        
        // 세그먼트 인덱스 동기화
        if (status.segmentIndex !== undefined && status.segmentIndex !== null) {
          const mts = window.mobileTrainingState || {};
          const prevSegIndex = mts.segIndex || 0;
          if (mts.segIndex !== status.segmentIndex) {
            mts.segIndex = status.segmentIndex;
            mts.segmentPowerHistory = []; // 세그먼트 변경 시 파워 히스토리 초기화
            
            // 세그먼트가 변경되었으면 세그먼트 경과 시간도 재계산
            if (status.lapCountdown !== undefined && status.lapCountdown !== null) {
              const w = window.currentWorkout;
              if (w && w.segments) {
                const currentSeg = w.segments[status.segmentIndex];
                if (currentSeg) {
                  let segDur = 0;
                  if (typeof currentSeg.duration_sec === 'number') {
                    segDur = Math.max(0, Math.floor(currentSeg.duration_sec));
                  } else if (typeof currentSeg.duration === 'number') {
                    segDur = Math.max(0, Math.floor(currentSeg.duration));
                  }
                  
                  if (segDur > 0 && status.lapCountdown >= 0) {
                    mts.segElapsedSec = Math.max(0, segDur - status.lapCountdown);
                  }
                }
              }
            }
            
            console.log('[Mobile Dashboard] Firebase 세그먼트 인덱스 동기화:', status.segmentIndex, '(이전:', prevSegIndex, ')');
          }
        }
      }
    } catch (e) {
      console.warn('[Mobile Dashboard] Firebase status 구독 오류:', e);
    }
  });
  
  window.mobileDashboardFirebaseStatusUnsubscribe = statusUnsubscribe;
  console.log('[Mobile Dashboard] Firebase status 구독 시작 완료 (랩 카운트다운 동기화)');
}

// 모바일 대시보드 속도계 관련 변수
let mobileCurrentPowerValue = 0; // 블루투스에서 받은 실제 파워값
let mobileDisplayPower = 0; // 화면에 표시되는 부드러운 파워값 (보간 적용)
let mobileGaugeAnimationFrameId = null; // 애니메이션 루프 ID
let mobileUserFTP = 200; // 사용자 FTP 값

/**
 * 모바일 속도계 눈금 생성 함수 (individual.js의 generateGaugeTicks 참고)
 */
function generateMobileGaugeTicks() {
  const centerX = 100;
  const centerY = 140;
  const radius = 80;
  const innerRadius = radius - 10; // 눈금 안쪽 시작점
  
  let ticksHTML = '';
  
  // 모든 눈금 생성 (주눈금 + 보조눈금)
  for (let i = 0; i <= 24; i++) { // 0~24 (주눈금 7개 + 보조눈금 18개 = 총 25개)
    const isMajor = i % 4 === 0; // 4 간격마다 주눈금 (0, 4, 8, 12, 16, 20, 24)
    
    // 각도 계산: 180도에서 시작하여 270도를 거쳐 360도(0도)까지 (위쪽 반원)
    let angle = 180 + (i / 24) * 180; // 180도에서 시작하여 360도까지
    if (angle >= 360) angle = angle % 360; // 360도는 0도로 변환
    const rad = (angle * Math.PI) / 180;
    
    // 눈금 위치 계산
    const x1 = centerX + innerRadius * Math.cos(rad);
    const y1 = centerY + innerRadius * Math.sin(rad);
    
    // 주눈금은 길게, 보조눈금은 짧게
    const tickLength = isMajor ? 14 : 7;
    const x2 = centerX + (innerRadius + tickLength) * Math.cos(rad);
    const y2 = centerY + (innerRadius + tickLength) * Math.sin(rad);
    
    // 흰색 눈금
    ticksHTML += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                        stroke="#ffffff" 
                        stroke-width="${isMajor ? 2.5 : 1.5}"/>`;
  }
  
  return ticksHTML;
}

/**
 * 모바일 속도계 레이블 생성 함수 (individual.js의 generateGaugeLabels 참고)
 */
function generateMobileGaugeLabels() {
  const centerX = 100;
  const centerY = 140;
  const radius = 80;
  const labelRadius = radius + 18; // 레이블 위치 (원 바깥쪽)
  
  let labelsHTML = '';
  
  // FTP 값 확인 (최신 값 사용)
  const ftp = mobileUserFTP || window.userFTP || window.mobileUserFTP || 200;
  
  // FTP 배수 정의
  const multipliers = [
    { index: 0, mult: 0, color: '#ffffff' },
    { index: 1, mult: 0.33, color: '#ffffff' },
    { index: 2, mult: 0.67, color: '#ffffff' },
    { index: 3, mult: 1, color: '#ef4444' }, // 빨강색 (FTP)
    { index: 4, mult: 1.33, color: '#ffffff' },
    { index: 5, mult: 1.67, color: '#ffffff' },
    { index: 6, mult: 2, color: '#ffffff' }
  ];
  
  // 주눈금 레이블 생성 (7개)
  multipliers.forEach((item, i) => {
    // 각도 계산: 180도에서 270도를 거쳐 360도(0도)까지 (위쪽 반원)
    let angle = 180 + (i / 6) * 180; // 180도에서 시작하여 360도까지
    if (angle >= 360) angle = angle % 360; // 360도는 0도로 변환
    const rad = (angle * Math.PI) / 180;
    
    // 레이블 위치 계산
    const x = centerX + labelRadius * Math.cos(rad);
    const y = centerY + labelRadius * Math.sin(rad);
    
    // FTP 값을 곱한 값 계산 (정수만 표기)
    const value = Math.round(ftp * item.mult);
    const labelText = value === 0 ? '0 w' : String(value);
    
    // 레이블 생성 (정수값만 표기, 9시 방향 0 → 0 w)
    labelsHTML += `<text x="${x}" y="${y}" 
                         text-anchor="middle" 
                         dominant-baseline="middle"
                         fill="${item.color}" 
                         font-size="10" 
                         font-weight="600">${labelText}</text>`;
  });
  
  return labelsHTML;
}

/** 속도계 센서 눈금 레이블 (0~120 km/h, 위쪽 반원 안쪽, TARGET 스타일) */
function generateMobileSpeedLabels() {
  const centerX = 100;
  const centerY = 140;
  const innerLabelRadius = 60; // 위쪽 반원 안쪽 곡선
  const speedValues = [0, 20, 40, 60, 80, 100, 120];
  let html = '';
  speedValues.forEach((val, i) => {
    // 위쪽 반원: 우측(3시,0°) → 12시(270°) → 좌측(9시,180°), angle = 360 - (val/120)*180
    const angleDeg = 360 - (i / 6) * 180;
    const rad = (angleDeg * Math.PI) / 180;
    const x = centerX + innerLabelRadius * Math.cos(rad);
    const y = centerY + innerLabelRadius * Math.sin(rad);
    const labelText = val === 0 ? '0 km/h' : String(val);
    html += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="#4595e6" font-size="6">${labelText}</text>`;
  });
  return html;
}

/** 모바일 속도계 원호 업데이트 (0~120 km/h, 우측→좌측 채우기, 끝점 Dot + 속도값) */
function updateMobileSpeedArc() {
  const arc = safeGetElement('mobile-gauge-speed-arc');
  const dot = safeGetElement('mobile-gauge-speed-dot');
  const dotValue = safeGetElement('mobile-gauge-speed-dot-value');
  if (!arc) return;
  const speedKmh = Number(window.liveData?.speed);
  const hasValidSpeed = speedKmh != null && !Number.isNaN(speedKmh) && speedKmh >= 0;
  const displaySpeed = hasValidSpeed ? speedKmh : 0;
  const totalLen = Math.PI * 80;
  const ratio = hasValidSpeed ? Math.min(Math.max(speedKmh / 120, 0), 1) : 0;
  const filledLen = totalLen * ratio;
  arc.style.strokeDasharray = `${totalLen} ${totalLen}`;
  arc.style.strokeDashoffset = String(totalLen - filledLen);
  if (dot && dotValue) {
    const angleDeg = 360 - ratio * 180;
    const rad = (angleDeg * Math.PI) / 180;
    const cx = 100 + 80 * Math.cos(rad);
    const cy = 140 + 80 * Math.sin(rad);
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.style.display = '';
    dotValue.setAttribute('x', cx);
    dotValue.setAttribute('y', cy);
    dotValue.textContent = String(Math.round(displaySpeed));
    dotValue.style.display = '';
  }
}

/**
 * 모바일 속도계 초기화
 */
function initializeMobileGauge() {
  const ticksGroup = safeGetElement('mobile-gauge-ticks');
  const labelsGroup = safeGetElement('mobile-gauge-labels');
  const speedLabelsGroup = safeGetElement('mobile-gauge-speed-labels');
  
  if (!ticksGroup || !labelsGroup) {
    console.warn('[Mobile Dashboard] 속도계 그룹 요소를 찾을 수 없습니다.');
    return;
  }
  
  // FTP 값 가져오기 (최신 값으로 업데이트)
  const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  mobileUserFTP = currentUser?.ftp || window.userFTP || window.mobileUserFTP || 200;
  window.mobileUserFTP = mobileUserFTP;
  window.userFTP = mobileUserFTP; // 전역 변수에도 저장
  
  console.log('[Mobile Dashboard] 속도계 초기화 - FTP:', mobileUserFTP);
  
  // 눈금 및 레이블 생성
  ticksGroup.innerHTML = generateMobileGaugeTicks();
  labelsGroup.innerHTML = generateMobileGaugeLabels();
  if (speedLabelsGroup) speedLabelsGroup.innerHTML = generateMobileSpeedLabels();
  
  // 바늘 애니메이션 루프 시작
  startMobileGaugeAnimationLoop();
}

/**
 * 모바일 속도계 바늘 애니메이션 루프 (individual.js의 startGaugeAnimationLoop 참고)
 */
function startMobileGaugeAnimationLoop() {
  // 이미 실행 중이면 중복 실행 방지
  if (mobileGaugeAnimationFrameId !== null) return;
  
  const loop = () => {
    // 모바일 대시보드 화면이 활성화되어 있는지 확인
    const mobileScreen = document.getElementById('mobileDashboardScreen');
    if (!mobileScreen || 
        (!mobileScreen.classList.contains('active') && 
         window.getComputedStyle(mobileScreen).display === 'none')) {
      // 화면이 비활성화되면 루프 중지
      mobileGaugeAnimationFrameId = null;
      return;
    }
    
    // 1. 목표값(mobileCurrentPowerValue)과 현재표시값(mobileDisplayPower)의 차이 계산
    const target = mobileCurrentPowerValue || 0;
    const current = mobileDisplayPower || 0;
    const diff = target - current;
    
    // 2. 보간(Interpolation) 적용: 거리가 멀면 빠르게, 가까우면 천천히 (감속 효과)
    if (Math.abs(diff) > 0.1) {
      mobileDisplayPower = current + diff * 0.15;
    } else {
      mobileDisplayPower = target; // 차이가 미세하면 목표값으로 고정 (떨림 방지)
    }
    
    // 3. 바늘 각도 계산 및 업데이트 (매 프레임 실행)
    // FTP 기반으로 최대 파워 계산 (FTP × 2)
    const ftp = mobileUserFTP || window.userFTP || window.mobileUserFTP || 200;
    const maxPower = ftp * 2;
    if (maxPower > 0 && !isNaN(maxPower) && isFinite(maxPower)) {
      let ratio = Math.min(Math.max(mobileDisplayPower / maxPower, 0), 1);
      
      // -90도(왼쪽 상단) ~ 90도(오른쪽 상단) - 위쪽 반원
      const angle = -90 + (ratio * 180);
      
      const needle = safeGetElement('mobile-gauge-needle');
      if (needle && !isNaN(angle) && isFinite(angle)) {
        // CSS Transition 간섭 제거하고 직접 제어
        needle.style.transition = 'none';
        needle.setAttribute('transform', `translate(100, 140) rotate(${angle})`);
      }
    }
    
    // 4. 목표 파워 원호 업데이트 (개인훈련 대시보드와 동일)
    if (typeof updateMobileTargetPowerArc === 'function') {
      updateMobileTargetPowerArc();
    }
    
    // 5. 속도계 센서 원호 업데이트 (liveData.speed → 0~120 km/h)
    if (typeof updateMobileSpeedArc === 'function') {
      updateMobileSpeedArc();
    }
    
    // 다음 프레임 요청
    mobileGaugeAnimationFrameId = requestAnimationFrame(loop);
  };
  
  // 루프 시작
  mobileGaugeAnimationFrameId = requestAnimationFrame(loop);
}

/**
 * 모바일 속도계 바늘 업데이트 (블루투스 데이터에서 호출)
 */
function updateMobileGaugeNeedle(power) {
  // 실제 파워값 저장 (애니메이션 루프에서 부드럽게 이동)
  mobileCurrentPowerValue = Math.max(0, Number(power) || 0);
}

/**
 * 모바일 현재 세그먼트 정보 가져오기 (모바일 전용 상태 사용 - 독립적으로 구동)
 */
function getMobileCurrentSegment() {
  // 모바일 전용 상태 사용 (Firebase와 무관, 독립적으로 구동)
  const mts = window.mobileTrainingState || {};
  const currentSegmentIndex = mts.segIndex !== undefined ? mts.segIndex : -1;
  
  if (currentSegmentIndex < 0) {
    return null;
  }
  
  if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
    return null;
  }
  
  if (currentSegmentIndex >= window.currentWorkout.segments.length) {
    return null;
  }
  
  return window.currentWorkout.segments[currentSegmentIndex];
}

/**
 * 모바일 속도계 원호에 목표 파워값만큼 채우기 (세그먼트 달성도에 따라 색상 변경)
 * 개인훈련 대시보드의 updateTargetPowerArc와 동일한 로직
 * - LAP AVG 파워값 / 목표 파워값 비율이 0.985 이상이면 투명 민트색
 * - 미만이면 투명 주황색
 */
function updateMobileTargetPowerArc() {
  // 목표 파워값 가져오기
  const targetPowerEl = safeGetElement('mobile-ui-target-power');
  if (!targetPowerEl) return;
  
  const targetPower = Number(targetPowerEl.textContent) || 0;
  if (targetPower <= 0) {
    // 목표 파워가 없으면 원호 숨김
    const targetArc = safeGetElement('mobile-gauge-target-arc');
    if (targetArc) {
      targetArc.style.display = 'none';
    }
    // 상한 원호도 숨김
    const maxArc = safeGetElement('mobile-gauge-max-arc');
    if (maxArc) {
      maxArc.style.display = 'none';
    }
    return;
  }
  
  // LAP AVG 파워값 가져오기
  const lapPowerEl = safeGetElement('mobile-ui-lap-power');
  const lapPower = lapPowerEl ? Number(lapPowerEl.textContent) || 0 : 0;
  
  // 세그먼트 달성도 계산 (LAP AVG / 목표 파워) - 하한값 기준
  const achievementRatio = targetPower > 0 ? lapPower / targetPower : 0;
  
  // 색상 결정: 비율이 0.985 이상이면 민트색, 미만이면 주황색
  // 개인훈련 대시보드와 동일한 로직 (ftp_pctz 타입도 달성도에 따라 색상 결정)
  const arcColor = achievementRatio >= 0.985 
    ? 'rgba(0, 212, 170, 0.5)'  // 투명 민트색 (#00d4aa)
    : 'rgba(255, 140, 0, 0.5)'; // 투명 주황색
  
  // FTP 기반으로 최대 파워 계산
  const ftp = mobileUserFTP || window.userFTP || window.mobileUserFTP || 200;
  const maxPower = ftp * 2;
  if (maxPower <= 0) return;
  
  // 현재 세그먼트 정보 가져오기
  const seg = getMobileCurrentSegment();
  const targetType = seg?.target_type || 'ftp_pct';
  const isFtpPctz = targetType === 'ftp_pctz';
  
  // cadence_rpm 타입인 경우: 파워값이 없으므로 원호 표시하지 않음
  if (targetType === 'cadence_rpm') {
    const targetArc = safeGetElement('mobile-gauge-target-arc');
    if (targetArc) {
      targetArc.style.display = 'none';
    }
    const maxArc = safeGetElement('mobile-gauge-max-arc');
    if (maxArc) {
      maxArc.style.display = 'none';
    }
    return;
  }
  
  // 목표 파워 비율 계산 (0 ~ 1) - 하한값 기준
  const minRatio = Math.min(Math.max(targetPower / maxPower, 0), 1);
  
  // 각도 계산: 180도(왼쪽 상단)에서 시작하여 각도가 증가하는 방향으로
  const startAngle = 180;
  let minEndAngle = 180 + (minRatio * 180);
  
  // SVG 원호 경로 생성
  const centerX = 100;
  const centerY = 140;
  const radius = 80;
  
  // 하한값 원호 경로 생성
  const startRad = (startAngle * Math.PI) / 180;
  const minEndRad = (minEndAngle * Math.PI) / 180;
  
  const startX = centerX + radius * Math.cos(startRad);
  const startY = centerY + radius * Math.sin(startRad);
  const minEndX = centerX + radius * Math.cos(minEndRad);
  const minEndY = centerY + radius * Math.sin(minEndRad);
  
  const minAngleDiff = minEndAngle - startAngle;
  const minLargeArcFlag = minAngleDiff > 180 ? 1 : 0;
  const minPathData = `M ${startX} ${startY} A ${radius} ${radius} 0 ${minLargeArcFlag} 1 ${minEndX} ${minEndY}`;
  
  // 목표 파워 원호 요소 가져오기 (하한값)
  const targetArc = safeGetElement('mobile-gauge-target-arc');
  if (!targetArc) {
    console.warn('[Mobile Dashboard] mobile-gauge-target-arc 요소를 찾을 수 없습니다.');
    return;
  }
  
  // 하한값 원호 경로 및 색상 업데이트
  targetArc.setAttribute('d', minPathData);
  targetArc.setAttribute('stroke', arcColor);
  targetArc.style.display = 'block';
  
  // 목표 파워값 색상: 원호가 녹색(민트)이면 Lap 타임 색상, 주황이면 원래 주황색
  targetPowerEl.setAttribute('fill', achievementRatio >= 0.985 ? '#00d4aa' : '#ff8c00');
  
  // ftp_pctz 타입인 경우 상한값 원호 추가 (모바일 전용 상태 우선 사용)
  const mts = window.mobileTrainingState || {};
  const maxPowerValue = mts.currentSegmentMaxPower || window.currentSegmentMaxPower;
  if (isFtpPctz && maxPowerValue && maxPowerValue > targetPower) {
    const maxRatio = Math.min(Math.max(maxPowerValue / maxPower, 0), 1);
    const maxEndAngle = 180 + (maxRatio * 180);
    const maxEndRad = (maxEndAngle * Math.PI) / 180;
    const maxEndX = centerX + radius * Math.cos(maxEndRad);
    const maxEndY = centerY + radius * Math.sin(maxEndRad);
    
    const maxAngleDiff = maxEndAngle - minEndAngle;
    const maxLargeArcFlag = maxAngleDiff > 180 ? 1 : 0;
    const maxPathData = `M ${minEndX} ${minEndY} A ${radius} ${radius} 0 ${maxLargeArcFlag} 1 ${maxEndX} ${maxEndY}`;
    
    // 상한값 원호 요소 가져오기
    const maxArc = safeGetElement('mobile-gauge-max-arc');
    if (!maxArc) {
      console.warn('[Mobile Dashboard] mobile-gauge-max-arc 요소를 찾을 수 없습니다.');
    } else {
      // 상한값 원호 경로 및 색상 업데이트 (투명도 낮춘 주황색)
      maxArc.setAttribute('d', maxPathData);
      maxArc.setAttribute('stroke', 'rgba(255, 140, 0, 0.2)'); // 더 투명한 주황색
      maxArc.style.display = 'block';
    }
  } else {
    // ftp_pctz가 아니거나 상한값이 없으면 상한 원호 숨김
    const maxArc = safeGetElement('mobile-gauge-max-arc');
    if (maxArc) {
      maxArc.style.display = 'none';
    }
  }
  
  // 디버깅 로그 (선택사항)
  if (achievementRatio > 0) {
    const mts = window.mobileTrainingState || {};
    const maxPowerValue = mts.currentSegmentMaxPower || window.currentSegmentMaxPower;
    console.log(`[Mobile Dashboard] updateMobileTargetPowerArc 달성도: ${(achievementRatio * 100).toFixed(1)}% (LAP: ${lapPower}W / 목표: ${targetPower}W), 색상: ${achievementRatio >= 0.985 ? '민트색' : '주황색'}${isFtpPctz ? `, 상한: ${maxPowerValue}W` : ''}`);
  }
}

// ----- 노트북 훈련 대시보드용 파워 속도계 (모바일 gauge 이식, namespace 분리) -----
let laptopCurrentPowerValue = 0;
let laptopDisplayPower = 0;
let laptopGaugeAnimationFrameId = null;
let laptopUserFTP = 200;

function generateLaptopGaugeTicks() {
  const centerX = 100;
  const centerY = 140;
  const radius = 80;
  const innerRadius = radius - 10;
  let ticksHTML = '';
  for (let i = 0; i <= 24; i++) {
    const isMajor = i % 4 === 0;
    let angle = 180 + (i / 24) * 180;
    if (angle >= 360) angle = angle % 360;
    const rad = (angle * Math.PI) / 180;
    const x1 = centerX + innerRadius * Math.cos(rad);
    const y1 = centerY + innerRadius * Math.sin(rad);
    const tickLength = isMajor ? 14 : 7;
    const x2 = centerX + (innerRadius + tickLength) * Math.cos(rad);
    const y2 = centerY + (innerRadius + tickLength) * Math.sin(rad);
    ticksHTML += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="${isMajor ? 2.5 : 1.5}"/>`;
  }
  return ticksHTML;
}

function generateLaptopGaugeLabels() {
  const centerX = 100;
  const centerY = 140;
  const radius = 80;
  const labelRadius = radius + 18;
  const ftp = laptopUserFTP || window.userFTP || 200;
  const multipliers = [
    { index: 0, mult: 0, color: '#ffffff' },
    { index: 1, mult: 0.33, color: '#ffffff' },
    { index: 2, mult: 0.67, color: '#ffffff' },
    { index: 3, mult: 1, color: '#ef4444' },
    { index: 4, mult: 1.33, color: '#ffffff' },
    { index: 5, mult: 1.67, color: '#ffffff' },
    { index: 6, mult: 2, color: '#ffffff' }
  ];
  let labelsHTML = '';
  multipliers.forEach((item, i) => {
    let angle = 180 + (i / 6) * 180;
    if (angle >= 360) angle = angle % 360;
    const rad = (angle * Math.PI) / 180;
    const x = centerX + labelRadius * Math.cos(rad);
    const y = centerY + labelRadius * Math.sin(rad);
    const value = Math.round(ftp * item.mult);
    labelsHTML += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="${item.color}" font-size="10" font-weight="600">${value}</text>`;
  });
  return labelsHTML;
}

function initializeLaptopGauge() {
  const ticksGroup = safeGetElement('laptop-gauge-ticks');
  const labelsGroup = safeGetElement('laptop-gauge-labels');
  if (!ticksGroup || !labelsGroup) return;
  const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  laptopUserFTP = currentUser?.ftp || window.userFTP || 200;
  ticksGroup.innerHTML = generateLaptopGaugeTicks();
  labelsGroup.innerHTML = generateLaptopGaugeLabels();
  startLaptopGaugeAnimationLoop();
}

function startLaptopGaugeAnimationLoop() {
  if (laptopGaugeAnimationFrameId !== null) return;
  const loop = () => {
    const trainingScreen = document.getElementById('trainingScreen');
    if (!trainingScreen || (!trainingScreen.classList.contains('active') && window.getComputedStyle(trainingScreen).display === 'none')) {
      laptopGaugeAnimationFrameId = null;
      return;
    }
    const target = laptopCurrentPowerValue || 0;
    const current = laptopDisplayPower || 0;
    const diff = target - current;
    if (Math.abs(diff) > 0.1) {
      laptopDisplayPower = current + diff * 0.15;
    } else {
      laptopDisplayPower = target;
    }
    const ftp = laptopUserFTP || window.userFTP || 200;
    const maxPower = ftp * 2;
    if (maxPower > 0 && !isNaN(maxPower) && isFinite(maxPower)) {
      let ratio = Math.min(Math.max(laptopDisplayPower / maxPower, 0), 1);
      const angle = -90 + (ratio * 180);
      const needle = safeGetElement('laptop-gauge-needle');
      if (needle && !isNaN(angle) && isFinite(angle)) {
        needle.style.transition = 'none';
        needle.setAttribute('transform', `translate(100, 140) rotate(${angle})`);
      }
    }
    const centerText = safeGetElement('laptop-ui-current-power');
    if (centerText) centerText.textContent = String(Math.round(laptopDisplayPower));
    if (typeof updateLaptopTargetPowerArc === 'function') updateLaptopTargetPowerArc();
    laptopGaugeAnimationFrameId = requestAnimationFrame(loop);
  };
  laptopGaugeAnimationFrameId = requestAnimationFrame(loop);
}

function updateLaptopGaugeNeedle(power) {
  laptopCurrentPowerValue = Math.max(0, Number(power) || 0);
}

function getLaptopCurrentSegment() {
  // updateTrainingDisplay와 동일: segIndex 미설정 시 0 사용 (노트북 훈련 화면 일관성)
  const raw = window.trainingState?.segIndex;
  const segIndex = (raw !== undefined && raw >= 0) ? raw : 0;
  if (!window.currentWorkout?.segments?.length || segIndex >= window.currentWorkout.segments.length) return null;
  return window.currentWorkout.segments[segIndex];
}

/**
 * 노트북/태블릿 훈련 화면 속도계 원호 — 모바일 개인훈련 대시보드(updateMobileTargetPowerArc)와 동일 로직
 * - 목표 파워: laptop-ui-target-power (하한 파워)
 * - LAP AVG: avgSegmentPowerValue (세그먼트 평균 파워)
 * - 달성도: LAP AVG / 목표 파워 ≥ 0.985 → 민트, 미만 → 주황
 * - ftp_pctz일 때: 첫 번째 띠(0~하한) + 두 번째 띠(하한~상한, 연한 주황)
 */
function updateLaptopTargetPowerArc() {
  const targetPowerEl = safeGetElement('laptop-ui-target-power');
  if (!targetPowerEl) return;
  const targetPower = Number(targetPowerEl.textContent) || 0;
  if (targetPower <= 0) {
    const targetArc = safeGetElement('laptop-gauge-target-arc');
    const maxArc = safeGetElement('laptop-gauge-max-arc');
    if (targetArc) targetArc.style.display = 'none';
    if (maxArc) maxArc.style.display = 'none';
    return;
  }
  // LAP AVG 파워 (노트북은 avgSegmentPowerValue = 세그먼트 평균)
  const lapPowerEl = safeGetElement('avgSegmentPowerValue');
  const lapPower = lapPowerEl ? Number(lapPowerEl.textContent) || 0 : 0;
  const achievementRatio = targetPower > 0 ? lapPower / targetPower : 0;
  const arcColor = achievementRatio >= 0.985 ? 'rgba(0, 212, 170, 0.5)' : 'rgba(255, 140, 0, 0.5)';
  const ftp = laptopUserFTP || window.userFTP || 200;
  const maxPower = ftp * 2;
  if (maxPower <= 0) return;
  const seg = getLaptopCurrentSegment();
  const targetType = seg?.target_type || 'ftp_pct';
  const isFtpPctz = targetType === 'ftp_pctz';
  if (targetType === 'cadence_rpm') {
    const targetArc = safeGetElement('laptop-gauge-target-arc');
    const maxArc = safeGetElement('laptop-gauge-max-arc');
    if (targetArc) targetArc.style.display = 'none';
    if (maxArc) maxArc.style.display = 'none';
    return;
  }
  const minRatio = Math.min(Math.max(targetPower / maxPower, 0), 1);
  const startAngle = 180;
  let minEndAngle = 180 + (minRatio * 180);
  const centerX = 100, centerY = 140, radius = 80;
  const startRad = (startAngle * Math.PI) / 180;
  const minEndRad = (minEndAngle * Math.PI) / 180;
  const startX = centerX + radius * Math.cos(startRad);
  const startY = centerY + radius * Math.sin(startRad);
  const minEndX = centerX + radius * Math.cos(minEndRad);
  const minEndY = centerY + radius * Math.sin(minEndRad);
  const minAngleDiff = minEndAngle - startAngle;
  const minLargeArcFlag = minAngleDiff > 180 ? 1 : 0;
  const minPathData = `M ${startX} ${startY} A ${radius} ${radius} 0 ${minLargeArcFlag} 1 ${minEndX} ${minEndY}`;
  const targetArc = safeGetElement('laptop-gauge-target-arc');
  if (!targetArc) return;
  targetArc.setAttribute('d', minPathData);
  targetArc.setAttribute('stroke', arcColor);
  targetArc.style.display = 'block';
  // ftp_pctz일 때만 상한 구간 두 번째 띠 (모바일과 동일: rgba(255, 140, 0, 0.2))
  let maxPowerValue = window.currentSegmentMaxPower;
  // 상한값이 없으면 세그먼트 target_value에서 직접 파싱 (updateTrainingDisplay보다 먼저 호출된 경우 대비)
  if (isFtpPctz && (!maxPowerValue || maxPowerValue <= targetPower) && seg?.target_value != null) {
    const tv = seg.target_value;
    let maxPct = null;
    const pctzD = typeof tv === 'string' ? (tv.includes('~') ? '~' : (tv.includes('/') ? '/' : (tv.includes(',') ? ',' : null))) : null;
    if (pctzD && typeof tv === 'string') {
      const parts = tv.split(pctzD).map(s => s.trim());
      if (parts.length >= 2) maxPct = Number(parts[1]) || 75;
    } else if (typeof tv === 'string' && tv.includes(',')) {
      const parts = tv.split(',').map(s => s.trim());
      if (parts.length >= 2) maxPct = Number(parts[1]) || 75;
    } else if (Array.isArray(tv) && tv.length >= 2) {
      maxPct = Number(tv[1]) || 75;
    }
    if (maxPct != null) maxPowerValue = Math.round(ftp * (maxPct / 100));
  }
  if (isFtpPctz && maxPowerValue && maxPowerValue > targetPower) {
    const maxRatio = Math.min(Math.max(maxPowerValue / maxPower, 0), 1);
    const maxEndAngle = 180 + (maxRatio * 180);
    const maxEndRad = (maxEndAngle * Math.PI) / 180;
    const maxEndX = centerX + radius * Math.cos(maxEndRad);
    const maxEndY = centerY + radius * Math.sin(maxEndRad);
    const maxAngleDiff = maxEndAngle - minEndAngle;
    const maxLargeArcFlag = maxAngleDiff > 180 ? 1 : 0;
    const maxPathData = `M ${minEndX} ${minEndY} A ${radius} ${radius} 0 ${maxLargeArcFlag} 1 ${maxEndX} ${maxEndY}`;
    const maxArc = safeGetElement('laptop-gauge-max-arc');
    if (maxArc) {
      maxArc.setAttribute('d', maxPathData);
      maxArc.setAttribute('stroke', 'rgba(255, 140, 0, 0.2)'); // 모바일과 동일: 더 투명한 주황
      maxArc.style.display = 'block';
    }
  } else {
    const maxArc = safeGetElement('laptop-gauge-max-arc');
    if (maxArc) {
      maxArc.setAttribute('d', '');
      maxArc.style.display = 'none';
    }
  }
}

/**
 * 모바일 목표 파워 업데이트 (개인훈련 대시보드의 updateTargetPower와 동일한 로직)
 */
function updateMobileTargetPower() {
  const targetPowerEl = safeGetElement('mobile-ui-target-power');
  if (!targetPowerEl) {
    console.warn('[Mobile Dashboard] mobile-ui-target-power 요소를 찾을 수 없습니다.');
    return;
  }
  
  // 1순위: window.liveData.targetPower (블루투스/훈련 화면에서 계산된 값)
  if (window.liveData && window.liveData.targetPower !== undefined && window.liveData.targetPower !== null && window.liveData.targetPower > 0) {
    const firebaseTargetPower = Number(window.liveData.targetPower);
    if (!isNaN(firebaseTargetPower)) {
      // 강도 조절 비율 적용
      const intensityAdjustment = window.mobileIntensityAdjustment || 1.0;
      const adjustedTargetPower = Math.round(firebaseTargetPower * intensityAdjustment);
      
      console.log('[Mobile Dashboard] window.liveData.targetPower 값 사용:', firebaseTargetPower, 'W');
      console.log('[Mobile Dashboard] 강도 조절 적용:', intensityAdjustment, '→ 조절된 목표 파워:', adjustedTargetPower, 'W');
      
      // TARGET 라벨 업데이트 로직 (Firebase 값 사용 시)
      const targetLabelEl = safeGetElement('mobile-ui-target-label');
      const targetRpmUnitEl = safeGetElement('mobile-ui-target-rpm-unit');
      const seg = getMobileCurrentSegment();
      const targetType = seg?.target_type || 'ftp_pct';
      
      // ftp_pctz 타입인 경우 상한값 저장
      if (targetType === 'ftp_pctz' && seg?.target_value) {
        const targetValue = seg.target_value;
        let minPercent = 60;
        let maxPercent = 75;
        const pctzD = typeof targetValue === 'string' ? (targetValue.includes('~') ? '~' : (targetValue.includes('/') ? '/' : null)) : null;
        if (pctzD && typeof targetValue === 'string') {
          const parts = targetValue.split(pctzD).map(s => s.trim());
          if (parts.length >= 2) {
            minPercent = Number(parts[0]) || 60;
            maxPercent = Number(parts[1]) || 75;
          }
        } else if (typeof targetValue === 'string' && targetValue.includes(',')) {
          const parts = targetValue.split(',').map(s => s.trim());
          if (parts.length >= 2) {
            minPercent = Number(parts[0]) || 60;
            maxPercent = Number(parts[1]) || 75;
          }
        } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
          minPercent = Number(targetValue[0]) || 60;
          maxPercent = Number(targetValue[1]) || 75;
        }
        
        const ftp = mobileUserFTP || window.userFTP || window.mobileUserFTP || 200;
        window.currentSegmentMaxPower = Math.round(ftp * (maxPercent / 100));
        window.currentSegmentMinPower = Math.round(ftp * (minPercent / 100));
        
        // 모바일 전용 상태에도 저장 (독립적으로 구동)
        const mts = window.mobileTrainingState || {};
        mts.currentSegmentMaxPower = window.currentSegmentMaxPower;
        mts.currentSegmentMinPower = window.currentSegmentMinPower;
      } else {
        window.currentSegmentMaxPower = null;
        window.currentSegmentMinPower = null;
      }
      
      // target_type에 따른 TARGET 라벨 및 값 업데이트
      if (targetType === 'dual') {
        const targetValue = seg?.target_value || seg?.target || '0';
        let targetRpm = 0;
        const dualDelimStr = typeof targetValue === 'string' ? (targetValue.includes('~') ? '~' : (targetValue.includes('/') ? '/' : null)) : null;
        if (dualDelimStr && typeof targetValue === 'string') {
          const parts = targetValue.split(dualDelimStr).map(s => s.trim());
          targetRpm = Number(parts[1]) || 0;
        } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
          targetRpm = Number(targetValue[1]) || 0;
        }
        
        if (targetRpm > 0 && targetLabelEl) {
          // 기존 내용 삭제
          targetLabelEl.textContent = '';
          targetLabelEl.setAttribute('fill', '#ef4444'); // 기본 색상 빨강색
          targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93'); // 고정: 폰트 6, y 93
          
          // 숫자는 빨강색, RPM 단위는 그레이로 1줄에 표시
          const rpmNumber = Math.round(targetRpm);
          const tspanNumber = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspanNumber.setAttribute('fill', '#ef4444'); // 빨강색
          tspanNumber.textContent = rpmNumber.toString();
          targetLabelEl.appendChild(tspanNumber);
          
          const tspanUnit = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspanUnit.setAttribute('fill', '#888'); // 그레이
          tspanUnit.textContent = ' RPM';
          targetLabelEl.appendChild(tspanUnit);
          
          // RPM 단위 요소는 숨김 처리
          if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
          }
        } else {
          if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888');
            targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
          }
          if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
          }
        }
        targetPowerEl.textContent = String(adjustedTargetPower);
        targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
      } else if (targetType === 'cadence_rpm') {
        // cadence_rpm 타입: 목표 파워값 자리에 RPM 값 표시, 색상 #ef4444 (빨강색), TARGET 라벨을 'CADENCE'로 변경
        const targetValue = seg?.target_value || seg?.target || '0';
        const targetRpm = Number(targetValue) || 0;
        
        if (targetRpm > 0) {
          if (targetLabelEl) {
            targetLabelEl.textContent = 'CADENCE';
            targetLabelEl.setAttribute('fill', '#888');
            targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
          }
          if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
          }
          targetPowerEl.textContent = Math.round(targetRpm).toString();
          targetPowerEl.setAttribute('fill', '#ef4444'); // 빨강색
        } else {
          if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888');
            targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
          }
          if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
          }
          targetPowerEl.textContent = '0';
          targetPowerEl.setAttribute('fill', '#ff8c00');
        }
      } else if (targetType === 'ftp_pctz') {
        // ftp_pctz 타입: TARGET 라벨 표시, 목표 파워값(주황색) - 하한값 표시
        if (targetLabelEl) {
          targetLabelEl.textContent = 'TARGET';
          targetLabelEl.setAttribute('fill', '#888');
          targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
        }
        if (targetRpmUnitEl) {
          targetRpmUnitEl.style.display = 'none';
        }
        targetPowerEl.textContent = String(adjustedTargetPower);
        targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
      } else {
        // ftp_pct 타입: TARGET 라벨 표시, 목표 파워값(주황색) 원래 색상으로 되돌림
        if (targetLabelEl) {
          targetLabelEl.textContent = 'TARGET';
          targetLabelEl.setAttribute('fill', '#888');
          targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
        }
        if (targetRpmUnitEl) {
          targetRpmUnitEl.style.display = 'none';
        }
        targetPowerEl.textContent = String(adjustedTargetPower);
        targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
      }
      
      // 목표 파워 원호 업데이트
      if (typeof updateMobileTargetPowerArc === 'function') {
        updateMobileTargetPowerArc();
      }
      
      return;
    }
  }
  
  // 2순위: 세그먼트 데이터로 계산 (window.liveData.targetPower가 없을 때만)
  // 워크아웃 데이터 확인
  if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
    const targetLabelEl = safeGetElement('mobile-ui-target-label');
    const targetRpmUnitEl = safeGetElement('mobile-ui-target-rpm-unit');
    if (targetLabelEl) {
      targetLabelEl.textContent = 'TARGET';
      targetLabelEl.setAttribute('fill', '#888');
      targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
    }
    if (targetRpmUnitEl) {
      targetRpmUnitEl.style.display = 'none';
    }
    targetPowerEl.textContent = '0';
    targetPowerEl.setAttribute('fill', '#ff8c00');
    return;
  }
  
  // 현재 세그먼트 정보 가져오기
  const seg = getMobileCurrentSegment();
  if (!seg) {
    const targetLabelEl = safeGetElement('mobile-ui-target-label');
    const targetRpmUnitEl = safeGetElement('mobile-ui-target-rpm-unit');
    if (targetLabelEl) {
      targetLabelEl.textContent = 'TARGET';
      targetLabelEl.setAttribute('fill', '#888');
      targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
    }
    if (targetRpmUnitEl) {
      targetRpmUnitEl.style.display = 'none';
    }
    targetPowerEl.textContent = '0';
    targetPowerEl.setAttribute('fill', '#ff8c00');
    return;
  }
  
  // FTP 값 사용
  const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  const ftp = currentUser?.ftp || mobileUserFTP || window.userFTP || window.mobileUserFTP || 200;
  
  // 세그먼트 목표 파워 계산
  let targetPower = 0;
  
  // target_type에 따라 계산
  const targetType = seg.target_type || 'ftp_pct';
  const targetValue = seg.target_value;
  
  console.log('[Mobile Dashboard] 세그먼트 데이터로 계산 (window.liveData.targetPower 없음)');
  console.log('[Mobile Dashboard] target_type:', targetType, 'target_value:', targetValue, '타입:', typeof targetValue);
  console.log('[Mobile Dashboard] 사용자 FTP 값:', ftp);
  
  if (targetType === 'ftp_pct') {
    const ftpPercent = Number(targetValue) || 100;
    targetPower = Math.round(ftp * (ftpPercent / 100));
    console.log('[Mobile Dashboard] ftp_pct 계산: FTP', ftp, '*', ftpPercent, '% =', targetPower);
  } else if (targetType === 'dual') {
    const dualDelim = typeof targetValue === 'string' ? (targetValue.includes('~') ? '~' : (targetValue.includes('/') ? '/' : null)) : null;
    if (dualDelim && typeof targetValue === 'string') {
      const parts = targetValue.split(dualDelim).map(s => s.trim());
      if (parts.length >= 1) {
        const ftpPercent = Number(parts[0]) || 100;
        targetPower = Math.round(ftp * (ftpPercent / 100));
      }
    } else if (Array.isArray(targetValue) && targetValue.length > 0) {
      const ftpPercent = Number(targetValue[0]) || 100;
      targetPower = Math.round(ftp * (ftpPercent / 100));
    } else {
      // 숫자로 저장된 경우 처리
      const numValue = Number(targetValue);
      if (numValue > 1000 && numValue < 1000000) {
        const str = String(numValue);
        if (str.length >= 4) {
          const ftpPart = str.slice(0, -3);
          const ftpPercent = Number(ftpPart) || 100;
          targetPower = Math.round(ftp * (ftpPercent / 100));
        }
      } else {
        const ftpPercent = numValue <= 1000 ? numValue : 100;
        targetPower = Math.round(ftp * (ftpPercent / 100));
      }
    }
  } else if (targetType === 'cadence_rpm') {
    // RPM만 있는 경우 파워는 0
    targetPower = 0;
  } else if (targetType === 'ftp_pctz') {
    let minPercent = 60;
    let maxPercent = 75;
    const pctzDelimStr = typeof targetValue === 'string' ? (targetValue.includes('~') ? '~' : (targetValue.includes('/') ? '/' : null)) : null;
    if (pctzDelimStr && typeof targetValue === 'string') {
      const parts = targetValue.split(pctzDelimStr).map(s => s.trim());
      if (parts.length >= 2) {
        minPercent = Number(parts[0]) || 60;
        maxPercent = Number(parts[1]) || 75;
      } else {
        minPercent = Number(parts[0]) || 60;
        maxPercent = 75;
      }
    } else if (typeof targetValue === 'string' && targetValue.includes(',')) {
      // 기존 형식(쉼표)도 지원 (하위 호환성)
      const parts = targetValue.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        minPercent = Number(parts[0]) || 60;
        maxPercent = Number(parts[1]) || 75;
      } else {
        minPercent = Number(parts[0]) || 60;
        maxPercent = 75;
      }
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      minPercent = Number(targetValue[0]) || 60;
      maxPercent = Number(targetValue[1]) || 75;
    }
    
    // 하한값을 목표 파워값으로 사용
    targetPower = Math.round(ftp * (minPercent / 100));
    console.log('[Mobile Dashboard] ftp_pctz 계산: FTP', ftp, '* 하한', minPercent, '% =', targetPower, 'W (상한:', maxPercent, '%)');
    
    // 상한값을 전역 변수에 저장 (모바일 전용 상태에도 저장)
    window.currentSegmentMaxPower = Math.round(ftp * (maxPercent / 100));
    window.currentSegmentMinPower = targetPower;
    
    // 모바일 전용 상태에도 저장 (독립적으로 구동)
    const mts = window.mobileTrainingState || {};
    mts.currentSegmentMaxPower = window.currentSegmentMaxPower;
    mts.currentSegmentMinPower = window.currentSegmentMinPower;
  }
  
  // 강도 조절 비율 적용
  const intensityAdjustment = window.mobileIntensityAdjustment || 1.0;
  const adjustedTargetPower = Math.round(targetPower * intensityAdjustment);
  
  console.log('[Mobile Dashboard] 최종 계산된 목표 파워:', targetPower, 'W');
  console.log('[Mobile Dashboard] 강도 조절 적용:', intensityAdjustment, '→ 조절된 목표 파워:', adjustedTargetPower, 'W');
  
  // TARGET 라벨 업데이트 로직
  const targetLabelEl = safeGetElement('mobile-ui-target-label');
  const targetRpmUnitEl = safeGetElement('mobile-ui-target-rpm-unit');
  
  if (targetType === 'dual') {
    let targetRpm = 0;
    const dualD = typeof targetValue === 'string' ? (targetValue.includes('~') ? '~' : (targetValue.includes('/') ? '/' : null)) : null;
    if (dualD && typeof targetValue === 'string') {
      const parts = targetValue.split(dualD).map(s => s.trim());
      targetRpm = Number(parts[1]) || 0;
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      targetRpm = Number(targetValue[1]) || 0;
    }
    
    if (targetRpm > 0 && targetLabelEl) {
      // 기존 내용 삭제
      targetLabelEl.textContent = '';
      targetLabelEl.setAttribute('fill', '#ef4444'); // 기본 색상 빨강색
      targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93'); // 고정: 폰트 6, y 93
      
      // 숫자는 빨강색, RPM 단위는 그레이로 1줄에 표시
      const rpmNumber = Math.round(targetRpm);
      const tspanNumber = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspanNumber.setAttribute('fill', '#ef4444'); // 빨강색
      tspanNumber.textContent = rpmNumber.toString();
      targetLabelEl.appendChild(tspanNumber);
      
      const tspanUnit = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspanUnit.setAttribute('fill', '#888'); // 그레이
      tspanUnit.textContent = ' RPM';
      targetLabelEl.appendChild(tspanUnit);
      
      // RPM 단위 요소는 숨김 처리
      if (targetRpmUnitEl) {
        targetRpmUnitEl.style.display = 'none';
      }
    } else if (targetLabelEl) {
      targetLabelEl.textContent = 'TARGET';
      targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
      targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
      if (targetRpmUnitEl) {
        targetRpmUnitEl.style.display = 'none';
      }
    }
    
    // targetPowerEl은 파워 값 표시 (dual이므로 파워도 있음)
    targetPowerEl.textContent = adjustedTargetPower > 0 ? String(adjustedTargetPower) : '0';
    targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
  } else if (targetType === 'cadence_rpm') {
    // cadence_rpm 타입: 목표 파워값 자리에 RPM 값 표시, 색상 #ef4444 (빨강색), TARGET 라벨을 'CADENCE'로 변경
    const targetRpm = Number(targetValue) || 0;
    
    if (targetRpm > 0) {
      // TARGET 라벨을 CADENCE로 변경
      if (targetLabelEl) {
        targetLabelEl.textContent = 'CADENCE';
        targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
        targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
      }
      // RPM 단위 숨김
      if (targetRpmUnitEl) {
        targetRpmUnitEl.style.display = 'none';
      }
      // 목표 파워값 자리에 RPM 값 표시
      targetPowerEl.textContent = Math.round(targetRpm).toString();
      targetPowerEl.setAttribute('fill', '#ef4444'); // 빨강색
    } else {
      if (targetLabelEl) {
        targetLabelEl.textContent = 'TARGET';
        targetLabelEl.setAttribute('fill', '#888');
        targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
      }
      if (targetRpmUnitEl) {
        targetRpmUnitEl.style.display = 'none';
      }
      targetPowerEl.textContent = '0';
      targetPowerEl.setAttribute('fill', '#ff8c00');
    }
  } else if (targetType === 'ftp_pctz') {
    // ftp_pctz 타입: TARGET 라벨 표시, 목표 파워값(주황색) - 하한값 표시
    if (targetLabelEl) {
      targetLabelEl.textContent = 'TARGET';
      targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
      targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
    }
    if (targetRpmUnitEl) {
      targetRpmUnitEl.style.display = 'none';
    }
    targetPowerEl.textContent = adjustedTargetPower > 0 ? String(adjustedTargetPower) : '0';
    targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
  } else {
    // ftp_pct 타입: TARGET 라벨 표시, 목표 파워값(주황색) 원래 색상으로 되돌림
    if (targetLabelEl) {
      targetLabelEl.textContent = 'TARGET';
      targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
      targetLabelEl.setAttribute('font-size', '6'); targetLabelEl.setAttribute('y', '93');
    }
    if (targetRpmUnitEl) {
      targetRpmUnitEl.style.display = 'none';
    }
    targetPowerEl.textContent = adjustedTargetPower > 0 ? String(adjustedTargetPower) : '0';
    targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
  }
  
  // 목표 파워 원호 업데이트 (애니메이션 루프에서도 호출되지만 여기서도 즉시 업데이트)
  if (typeof updateMobileTargetPowerArc === 'function') {
    updateMobileTargetPowerArc();
  }
}

/**
 * 모바일 훈련 결과 모달 닫기
 */
// 모바일 훈련 결과 모달 표시 함수 (개인훈련 대시보드와 동일한 로직)
function showMobileTrainingResultModal(status = null) {
  const modal = safeGetElement('mobileTrainingResultModal');
  if (!modal) {
    console.warn('[Mobile Dashboard] 훈련 결과 모달을 찾을 수 없습니다.');
    return;
  }
  
  // 결과값 계산
  const sessionData = window.trainingResults?.getCurrentSessionData?.();
  if (!sessionData) {
    console.warn('[Mobile Dashboard] 세션 데이터를 찾을 수 없습니다.');
    return;
  }
  
  // 통계 계산
  const stats = window.trainingResults?.calculateSessionStats?.() || {};
  
  // 훈련 시간 계산 - 노트북 결과 모달이면 lastElapsedTime/trainingState 우선, 그 외 모바일 전용 상태 우선
  let totalSeconds = 0;
  let duration_min = 0;
  
  if (window.__laptopResultModalOpen && (window.lastElapsedTime != null || (window.trainingState && window.trainingState.elapsedSec != null))) {
    totalSeconds = Math.max(0, Math.floor(window.lastElapsedTime != null ? window.lastElapsedTime : window.trainingState.elapsedSec));
    duration_min = Math.max(0, Math.floor(totalSeconds / 60));
    if (totalSeconds > 0 && duration_min === 0) duration_min = 1;
    console.log('[Mobile Dashboard] 노트북 결과 모달: lastElapsedTime/trainingState 사용:', { lastElapsedTime: window.lastElapsedTime, elapsedSec: window.trainingState?.elapsedSec, totalSeconds, duration_min });
  } else if (window.mobileTrainingState && window.mobileTrainingState.elapsedSec !== undefined && window.mobileTrainingState.elapsedSec !== null) {
    // 모바일 전용 상태의 elapsedSec 사용 (가장 정확)
    totalSeconds = Math.max(0, Math.floor(window.mobileTrainingState.elapsedSec));
    duration_min = Math.max(0, Math.floor(totalSeconds / 60)); // 최소 0분 보장
    console.log('[Mobile Dashboard] mobileTrainingState.elapsedSec 사용:', { elapsedSec: window.mobileTrainingState.elapsedSec, totalSeconds, duration_min });
  } else if (status && status.elapsedTime !== undefined && status.elapsedTime !== null) {
    // Firebase에서 받은 elapsedTime 사용
    totalSeconds = Math.max(0, Math.floor(status.elapsedTime));
    duration_min = Math.max(0, Math.floor(totalSeconds / 60));
    console.log('[Mobile Dashboard] elapsedTime 사용:', { elapsedTime: status.elapsedTime, totalSeconds, duration_min });
  } else if (window.lastElapsedTime !== undefined && window.lastElapsedTime !== null) {
    // 전역 변수에 저장된 elapsedTime 사용
    totalSeconds = Math.max(0, Math.floor(window.lastElapsedTime));
    duration_min = Math.max(0, Math.floor(totalSeconds / 60));
    console.log('[Mobile Dashboard] lastElapsedTime 사용:', { lastElapsedTime: window.lastElapsedTime, totalSeconds, duration_min });
  } else if (window.trainingState && window.trainingState.elapsedSec !== undefined) {
    // trainingState의 elapsedSec 사용
    totalSeconds = Math.max(0, Math.floor(window.trainingState.elapsedSec));
    duration_min = Math.max(0, Math.floor(totalSeconds / 60));
    console.log('[Mobile Dashboard] trainingState.elapsedSec 사용:', { elapsedSec: window.trainingState.elapsedSec, totalSeconds, duration_min });
  } else {
    // 대체: startTime과 endTime으로 계산
    const startTime = sessionData.startTime ? new Date(sessionData.startTime) : null;
    const endTime = sessionData.endTime ? new Date(sessionData.endTime) : new Date();
    totalSeconds = startTime ? Math.floor((endTime - startTime) / 1000) : 0;
    duration_min = Math.max(0, Math.floor(totalSeconds / 60));
    console.log('[Mobile Dashboard] startTime/endTime 사용:', { startTime, endTime, totalSeconds, duration_min });
  }
  
  // 1분 미만이어도 최소 1분으로 표시 (사용자 요청: 1분 훈련인데 0분으로 표시되는 문제 해결)
  if (totalSeconds > 0 && duration_min === 0) {
    duration_min = 1;
    console.log('[Mobile Dashboard] 1분 미만 훈련을 1분으로 표시:', { totalSeconds, duration_min });
  }
  
  // TSS 및 NP 계산 (resultManager.js와 동일한 로직)
  let tss = 0;
  let np = 0;
  
  // trainingMetrics가 있으면 사용 (가장 정확)
  if (window.trainingMetrics && window.trainingMetrics.elapsedSec > 0) {
    const elapsedSec = window.trainingMetrics.elapsedSec;
    const np4sum = window.trainingMetrics.np4sum || 0;
    const count = window.trainingMetrics.count || 1;
    
    if (count > 0 && np4sum > 0) {
      np = Math.pow(np4sum / count, 0.25);
      const userFtp = window.currentUser?.ftp || window.userFTP || window.mobileUserFTP || 200;
      const IF = userFtp > 0 ? (np / userFtp) : 0;
      tss = (elapsedSec / 3600) * (IF * IF) * 100;
      console.log('[Mobile Dashboard] TSS 계산 (trainingMetrics):', { elapsedSec, np, IF, tss, userFtp });
    }
  }
  
  // trainingMetrics가 없으면 대체 계산 (elapsedTime 또는 totalSeconds 사용)
  if (!tss || tss === 0) {
    const userFtp = window.currentUser?.ftp || window.userFTP || window.mobileUserFTP || 200;
    
    // NP가 없으면 평균 파워 * 1.05로 근사
    if (!np || np === 0) {
      np = Math.round((stats.avgPower || 0) * 1.05);
    }
    
    // IF 계산
    const IF = userFtp > 0 ? (np / userFtp) : 0;
    
    // TSS 계산: elapsedTime 우선 사용, 없으면 totalSeconds 사용
    const timeForTss = totalSeconds > 0 ? totalSeconds : (duration_min * 60);
    tss = (timeForTss / 3600) * (IF * IF) * 100;
    console.log('[Mobile Dashboard] TSS 계산 (대체):', { totalSeconds, duration_min, timeForTss, np, IF, tss, userFtp, avgPower: stats.avgPower });
  }
  
  // 값 반올림 및 최소값 보장
  tss = Math.max(0, Math.round(tss * 100) / 100);
  np = Math.max(0, Math.round(np * 10) / 10);
  
  // 칼로리 계산 (평균 파워 * 시간(분) * 0.0143)
  const avgPower = stats.avgPower || 0;
  const calories = Math.round(avgPower * duration_min * 0.0143);
  
  // 결과값 표시
  const durationEl = safeGetElement('mobile-result-duration', { silent: true });
  const avgPowerEl = safeGetElement('mobile-result-avg-power', { silent: true });
  const npEl = safeGetElement('mobile-result-np', { silent: true });
  const tssEl = safeGetElement('mobile-result-tss', { silent: true });
  const hrAvgEl = safeGetElement('mobile-result-hr-avg', { silent: true });
  const caloriesEl = safeGetElement('mobile-result-calories', { silent: true });
  
  if (durationEl) durationEl.textContent = `${duration_min}분`;
  if (avgPowerEl) avgPowerEl.textContent = `${stats.avgPower || 0}W`;
  if (npEl) npEl.textContent = `${np}W`;
  if (tssEl) tssEl.textContent = `${tss}`;
  if (hrAvgEl) hrAvgEl.textContent = `${stats.avgHR || 0}bpm`;
  if (caloriesEl) caloriesEl.textContent = `${calories}kcal`;
  
  // 마일리지 정보 표시 (주황색톤)
  const accPointsEl = safeGetElement('mobile-result-acc-points', { silent: true });
  const remPointsEl = safeGetElement('mobile-result-rem-points', { silent: true });
  const earnedPointsEl = safeGetElement('mobile-result-earned-points', { silent: true });
  
  // 훈련 전 포인트 값 가져오기 (훈련 종료 전 저장된 값)
  const beforePoints = window.beforeTrainingPoints || null;
  const beforeAccPoints = beforePoints ? beforePoints.acc_points : (window.currentUser?.acc_points || 0);
  const beforeRemPoints = beforePoints ? beforePoints.rem_points : (window.currentUser?.rem_points || 0);
  
  // 마일리지 업데이트 결과가 있으면 사용 (서버에서 업데이트된 최종 값)
  const mileageUpdate = window.lastMileageUpdate || null;
  if (mileageUpdate && mileageUpdate.success) {
    // 훈련 후 값 = 훈련 전 값 + TSS (획득 포인트)
    const afterAccPoints = beforeAccPoints + tss;
    const afterRemPoints = beforeRemPoints + tss;
    
    // 서버에서 업데이트된 최종 값 사용 (500 이상일 때 차감된 값)
    // ?? (nullish coalescing) 사용: 0도 유효한 값이므로 null/undefined일 때만 fallback 사용
    const finalAccPoints = (mileageUpdate.acc_points !== undefined && mileageUpdate.acc_points !== null) 
      ? mileageUpdate.acc_points 
      : (mileageUpdate.newAccPoints !== undefined && mileageUpdate.newAccPoints !== null)
        ? mileageUpdate.newAccPoints
        : afterAccPoints;
    const finalRemPoints = (mileageUpdate.rem_points !== undefined && mileageUpdate.rem_points !== null)
      ? mileageUpdate.rem_points
      : (mileageUpdate.newRemPoints !== undefined && mileageUpdate.newRemPoints !== null)
        ? mileageUpdate.newRemPoints
        : afterRemPoints;
    
    if (accPointsEl) accPointsEl.textContent = Math.round(finalAccPoints);
    if (remPointsEl) remPointsEl.textContent = Math.round(finalRemPoints);
    if (earnedPointsEl) earnedPointsEl.textContent = Math.round(tss);
    
    console.log('[Mobile Dashboard] 포인트 표시:', {
      mileageUpdate,
      finalAccPoints,
      finalRemPoints,
      tss,
      beforeAccPoints,
      beforeRemPoints
    });
  } else {
    // 마일리지 업데이트가 아직 완료되지 않았거나 실패한 경우: 훈련 전 값 + TSS로 표시
    const afterAccPoints = beforeAccPoints + tss;
    const afterRemPoints = beforeRemPoints + tss;
    if (accPointsEl) accPointsEl.textContent = Math.round(afterAccPoints);
    if (remPointsEl) remPointsEl.textContent = Math.round(afterRemPoints);
    if (earnedPointsEl) earnedPointsEl.textContent = Math.round(tss);
  }
  
  console.log('[Mobile Dashboard] 최종 결과:', { duration_min, avgPower: stats.avgPower, np, tss, hrAvg: stats.avgHR, calories, mileageUpdate });
  
  // 노트북 훈련 종료 시 모달이 mobileDashboardScreen 내부에 있으면 부모가 숨겨져 보이지 않음 → body로 이동하여 항상 표시
  if (modal.parentNode && modal.parentNode !== document.body) {
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.style.visibility = 'visible';
  modal.classList.remove('hidden');
  
  // 축하 오버레이 표시 (보유포인트 500 이상일 때 또는 마일리지 연장 시)
  console.log('[Mobile Dashboard] 축하 화면 표시 조건 확인:', {
    mileageUpdate: mileageUpdate,
    hasMileageUpdate: !!mileageUpdate,
    success: mileageUpdate?.success,
    add_days: mileageUpdate?.add_days,
    extended_days: mileageUpdate?.extended_days,
    rem_points: mileageUpdate?.rem_points,
    tss: tss
  });
  
  const addDays = mileageUpdate?.add_days || mileageUpdate?.extended_days || 0;
  const remPoints = mileageUpdate?.rem_points || 0;
  
  const shouldShowCelebration = (mileageUpdate && mileageUpdate.success && addDays > 0) ||
                                 (mileageUpdate && mileageUpdate.success && remPoints >= 500);
  
  console.log('[Mobile Dashboard] 축하 화면 표시 여부:', {
    shouldShowCelebration: shouldShowCelebration,
    condition1: (mileageUpdate && mileageUpdate.success && addDays > 0),
    condition2: (mileageUpdate && mileageUpdate.success && remPoints >= 500),
    addDays: addDays,
    remPoints: remPoints
  });
  
  if (shouldShowCelebration) {
    // 노트북(태블릿) 훈련 종료 시: 전용 세레머니 사용 (모바일 대시보드와 독립)
    if (window.__laptopResultModalOpen) {
      console.log('[Tablet Training] ✅ 500점 달성 축하 세레머니 표시 (노트북 전용)');
      showTabletMileageCelebration(mileageUpdate, tss);
    } else {
      console.log('[Mobile Dashboard] ✅ 축하 화면 표시 시작');
      showMobileMileageCelebration(mileageUpdate, tss);
    }
  } else {
    console.log('[Mobile Dashboard] ⚠️ 축하 화면 표시 조건 미충족');
  }
}

/**
 * 모바일 대시보드 마일리지 축하 오버레이 표시
 */
function showMobileMileageCelebration(mileageUpdate, earnedTss) {
  const modal = safeGetElement('mobileMileageCelebrationModal');
  const messageEl = safeGetElement('mobile-celebration-message', { silent: true });
  
  if (!modal || !messageEl) {
    console.warn('[Mobile Dashboard] 축하 오버레이 요소를 찾을 수 없습니다.');
    return;
  }
  
  // 이전 보유 포인트 계산: 현재 잔액 + 사용한 포인트 - 획득 포인트
  // 예: 잔액 100 + 사용 500 - 획득 120 = 이전 보유 480
  const currentRemPoints = Math.round(mileageUpdate.rem_points || 0);
  const earnedPoints = Math.round(earnedTss);
  const addDays = mileageUpdate.add_days || mileageUpdate.extended_days || 0; // 두 필드 모두 지원 (하위 호환성)
  const usedPoints = addDays * 500;
  const previousRemPoints = Math.round(currentRemPoints + usedPoints - earnedPoints);
  const totalAfterEarned = previousRemPoints + earnedPoints;
  
  // 축하 메시지 생성
  const message = `
    <div style="margin-bottom: 12px; font-size: 1.1em; font-weight: 600;">
      오늘의 훈련으로 ${earnedPoints} S-Point 획득!
    </div>
    <div style="margin-bottom: 12px; font-size: 0.95em;">
      💰 (현재 보유: ${previousRemPoints} SP + ${earnedPoints} SP = ${totalAfterEarned} SP)
    </div>
    <div style="font-size: 0.95em; font-weight: 600;">
      🎉 ${usedPoints} SP를 사용하여 구독 기간이 ${addDays}일 연장되었습니다! (잔액: ${currentRemPoints} SP)
    </div>
  `;
  
  messageEl.innerHTML = message;
  
  // 오버레이 표시 (결과 모달 위에 표시)
  // hidden 클래스 제거 및 display 스타일 명시적 설정 (!important 우회)
  modal.classList.remove('hidden');
  modal.style.display = 'flex'; // !important를 우회하기 위해 인라인 스타일로 명시적 설정
  modal.style.visibility = 'visible';
  modal.style.opacity = '1';
  
  console.log('[Mobile Dashboard] 축하 오버레이 표시:', { 
    mileageUpdate, 
    earnedTss,
    addDays: addDays,
    usedPoints: usedPoints,
    modalDisplay: modal.style.display,
    hasHiddenClass: modal.classList.contains('hidden')
  });
}

/**
 * 모바일 대시보드 마일리지 축하 오버레이 닫기
 */
function closeMobileMileageCelebration() {
  const modal = safeGetElement('mobileMileageCelebrationModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

/**
 * 노트북(태블릿) 훈련 화면 전용: 500점 이상 달성 시 축하 세레머니 표시
 * 모바일 개인훈련 대시보드와 동일한 조건·메시지, 별도 모달로 서로 영향 없음
 */
function showTabletMileageCelebration(mileageUpdate, earnedTss) {
  const modal = document.getElementById('tabletMileageCelebrationModal');
  const messageEl = document.getElementById('tablet-celebration-message');
  if (!modal || !messageEl) {
    console.warn('[Tablet Training] 축하 오버레이 요소를 찾을 수 없습니다.');
    return;
  }
  if (modal.parentNode && modal.parentNode !== document.body) {
    document.body.appendChild(modal);
  }
  const currentRemPoints = Math.round(mileageUpdate.rem_points || 0);
  const earnedPoints = Math.round(earnedTss);
  const addDays = mileageUpdate.add_days || mileageUpdate.extended_days || 0;
  const usedPoints = addDays * 500;
  const previousRemPoints = Math.round(currentRemPoints + usedPoints - earnedPoints);
  const totalAfterEarned = previousRemPoints + earnedPoints;
  const message = `
    <div style="margin-bottom: 12px; font-size: 1.1em; font-weight: 600;">
      오늘의 훈련으로 ${earnedPoints} S-Point 획득!
    </div>
    <div style="margin-bottom: 12px; font-size: 0.95em;">
      💰 (현재 보유: ${previousRemPoints} SP + ${earnedPoints} SP = ${totalAfterEarned} SP)
    </div>
    <div style="font-size: 0.95em; font-weight: 600;">
      🎉 ${usedPoints} SP를 사용하여 구독 기간이 ${addDays}일 연장되었습니다! (잔액: ${currentRemPoints} SP)
    </div>
  `;
  messageEl.innerHTML = message;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.style.visibility = 'visible';
  modal.style.opacity = '1';
  console.log('[Tablet Training] 축하 오버레이 표시:', { mileageUpdate, earnedTss, addDays, usedPoints });
}

/**
 * 노트북(태블릿) 훈련 화면 전용 축하 오버레이 닫기
 */
function closeTabletMileageCelebration() {
  const modal = document.getElementById('tabletMileageCelebrationModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function closeMobileTrainingResultModal() {
  const modal = safeGetElement('mobileTrainingResultModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  // 노트북 훈련 결과로 열었을 때: 축하 모달도 닫고, 확인 클릭 시 훈련 준비 화면으로 이동
  if (window.__laptopResultModalOpen) {
    window.__laptopResultModalOpen = false;
    if (typeof closeTabletMileageCelebration === 'function') closeTabletMileageCelebration();
    if (typeof showScreen === 'function') {
      showScreen('trainingReadyScreen');
      console.log('[훈련완료] 훈련 결과 모달 확인 → 훈련 준비 화면 전환');
    }
  }
}

/** 구독하기 안내 오버레이 열기 (Manage Your Career > 구독하기, 훈련결과 팝업 동일 디자인) */
function openSubscribeOverlay() {
  const modal = document.getElementById('subscribeOverlayModal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

/** 구독하기 안내 오버레이 닫기 */
function closeSubscribeOverlay() {
  const modal = document.getElementById('subscribeOverlayModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

/** 사용자 만료일 체크 (grade=2만 적용, 관리자 제외) */
function isUserExpired(user) {
  if (!user) return false;
  var grade = String(user.grade || '2');
  if (grade === '1') return false; // 관리자는 제한 없음
  var exp = user.expiry_date;
  if (!exp) return false;
  var expiryDate = new Date(exp);
  var today = new Date();
  expiryDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return expiryDate.getTime() < today.getTime();
}

/** 구독 만료 제한 팝업 표시 */
function showExpiryRestrictionModal() {
  var modal = document.getElementById('expiryRestrictionModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

/** 구독 만료 제한 팝업 닫기 */
function closeExpiryRestrictionModal() {
  var modal = document.getElementById('expiryRestrictionModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

window.isUserExpired = isUserExpired;
window.showExpiryRestrictionModal = showExpiryRestrictionModal;
window.closeExpiryRestrictionModal = closeExpiryRestrictionModal;

/**
 * 모바일 대시보드 마스코트 펄스 애니메이션 시작
 */
function startMobileMascotPulseAnimation() {
  // 기존 인터벌이 있으면 제거
  if (window.mobileMascotAnimationInterval) {
    clearInterval(window.mobileMascotAnimationInterval);
    window.mobileMascotAnimationInterval = null;
  }
  
  // 모바일 대시보드가 활성화되어 있고 워크아웃이 있을 때만 애니메이션 시작
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  if (!mobileScreen || 
      (!mobileScreen.classList.contains('active') && 
       window.getComputedStyle(mobileScreen).display === 'none')) {
    return;
  }
  
  if (!window.currentWorkout || !window.currentWorkout.segments) {
    return;
  }
  
  // 100ms마다 그래프를 다시 그려서 펄스 애니메이션 효과 (개인훈련 대시보드와 동일)
  window.mobileMascotAnimationInterval = setInterval(() => {
    const mobileScreen = document.getElementById('mobileDashboardScreen');
    if (!mobileScreen || 
        (!mobileScreen.classList.contains('active') && 
         window.getComputedStyle(mobileScreen).display === 'none')) {
      // 모바일 대시보드가 비활성화되면 애니메이션 중지
      if (window.mobileMascotAnimationInterval) {
        clearInterval(window.mobileMascotAnimationInterval);
        window.mobileMascotAnimationInterval = null;
      }
      return;
    }
    
    // 워크아웃이 없으면 애니메이션 중지
    if (!window.currentWorkout || !window.currentWorkout.segments) {
      if (window.mobileMascotAnimationInterval) {
        clearInterval(window.mobileMascotAnimationInterval);
        window.mobileMascotAnimationInterval = null;
      }
      return;
    }
    
    // 모바일 훈련 상태 확인
    const mts = window.mobileTrainingState;
    if (!mts) {
      return;
    }
    
    // 펄스 애니메이션을 위해 세그먼트 그래프를 주기적으로 다시 그리기
    // drawSegmentGraph 함수가 펄스 애니메이션을 포함하여 그려줌
    // 훈련이 시작되었는지 확인 (workoutStartMs가 있으면 시작됨)
    if (typeof drawSegmentGraph === 'function') {
      const currentSegIndex = (mts.workoutStartMs && mts.segIndex !== undefined) ? mts.segIndex : 0;
      const elapsedTime = (mts.workoutStartMs && mts.elapsedSec !== undefined) ? mts.elapsedSec : 0;
      drawSegmentGraph(window.currentWorkout.segments, currentSegIndex, 'mobileIndividualSegmentGraph', elapsedTime);
    }
  }, 100);
  
  console.log('[Mobile Dashboard] 마스코트 펄스 애니메이션 시작');
}

/**
 * 모바일 대시보드 마스코트 펄스 애니메이션 중지
 */
function stopMobileMascotPulseAnimation() {
  if (window.mobileMascotAnimationInterval) {
    clearInterval(window.mobileMascotAnimationInterval);
    window.mobileMascotAnimationInterval = null;
    console.log('[Mobile Dashboard] 마스코트 펄스 애니메이션 중지');
  }
}

/**
 * 모바일 대시보드 화면 정리 (화면 닫힐 때 호출)
 */
function cleanupMobileDashboard() {
  // 인터벌 정리
  if (window.mobileDashboardUpdateInterval) {
    clearInterval(window.mobileDashboardUpdateInterval);
    window.mobileDashboardUpdateInterval = null;
  }
  if (window.mobileDashboardTimerInterval) {
    clearInterval(window.mobileDashboardTimerInterval);
    window.mobileDashboardTimerInterval = null;
  }
  
  // 마스코트 펄스 애니메이션 정리
  stopMobileMascotPulseAnimation();
  
  // 애니메이션 프레임 정리
  if (mobileGaugeAnimationFrameId !== null) {
    cancelAnimationFrame(mobileGaugeAnimationFrameId);
    mobileGaugeAnimationFrameId = null;
  }
  
  // 화면 꺼짐 방지 해제 (화면 닫힐 때)
  if (window.mobileDashboardWakeLockControl && typeof window.mobileDashboardWakeLockControl.release === 'function') {
    window.mobileDashboardWakeLockControl.release();
  }
  
  // 화면 방향 고정 해제
  unlockScreenOrientation();

  // Pull-to-refresh / 터치 스크롤 방지 리스너 해제 (다른 화면에서 스크롤 잠금 해제)
  if (typeof teardownMobileDashboardPullToRefreshPrevention === 'function') {
    teardownMobileDashboardPullToRefreshPrevention();
  }

  // body 클래스 제거
  document.body.classList.remove('mobile-dashboard-active');

  // iOS/Bluefy: 다른 화면에서 스크롤 복원을 위해 overflow 명시적 해제
  document.body.style.overflow = '';
  document.body.style.position = '';
  if (document.documentElement) {
    document.documentElement.style.overflow = '';
    document.documentElement.style.position = '';
  }

  console.log('[Mobile Dashboard] 정리 완료 (스크롤 방지 해제)');
}

// 화면 전환 시 정리
if (typeof showScreen === 'function') {
  const originalShowScreen = window.showScreen;
  window.showScreen = function(id, skipHistory) {
    // 모바일 대시보드 화면에서 나갈 때 정리
    const mobileScreen = document.getElementById('mobileDashboardScreen');
    if (mobileScreen && (mobileScreen.classList.contains('active') || window.getComputedStyle(mobileScreen).display !== 'none')) {
      if (id !== 'mobileDashboardScreen') {
        cleanupMobileDashboard();
      }
    }
    // 원래 showScreen 함수 호출
    return originalShowScreen.call(this, id, skipHistory);
  };
}

// 전역 함수로 등록
window.startMobileDashboard = startMobileDashboard;
window.showMobileTrainingResultModal = showMobileTrainingResultModal;
window.closeMobileTrainingResultModal = closeMobileTrainingResultModal;
window.openSubscribeOverlay = openSubscribeOverlay;
window.closeSubscribeOverlay = closeSubscribeOverlay;
window.showMobileMileageCelebration = showMobileMileageCelebration;
window.closeMobileMileageCelebration = closeMobileMileageCelebration;
window.showTabletMileageCelebration = showTabletMileageCelebration;
window.closeTabletMileageCelebration = closeTabletMileageCelebration;
window.cleanupMobileDashboard = cleanupMobileDashboard;

/* ==========================================================
   터치 이벤트 및 피드백 개선 유틸리티
   모바일에서 버튼 클릭 반응성 향상
========================================================== */

// iOS 감지 함수 (Safari, Chrome, 기타 iOS 브라우저 모두 포함)


/* ==========================================================
   [FINAL SYSTEM v2.3] Sound, Haptic & Navigation Controller
   - DTMF (듀얼 톤) 기능 추가: 실제 전화기 키패드 소리 구현
   - Android/iOS 모두 작동
========================================================== */

// 1. 기기 감지 유틸리티
const DeviceUtils = {
  isIOS: function() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },
  isAndroid: function() {
    return /Android/.test(navigator.userAgent);
  }
};

// 2. 사운드 컨트롤러 (싱글 톤 + 듀얼 톤 지원)
const SoundController = {
  ctx: null,
  isUnlocked: false,

  init: function() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    this.setupUnlock();
  },

  setupUnlock: function() {
    if (this.isUnlocked) return;
    const unlockHandler = () => {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state !== 'running') {
        this.ctx.resume().then(() => {
          const buffer = this.ctx.createBuffer(1, 1, 22050);
          const source = this.ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(this.ctx.destination);
          source.start(0);
          this.isUnlocked = true;
          document.removeEventListener('touchstart', unlockHandler);
          document.removeEventListener('click', unlockHandler);
        }).catch(e => console.warn(e));
      }
    };
    document.addEventListener('touchstart', unlockHandler, { capture: true, once: true });
    document.addEventListener('click', unlockHandler, { capture: true, once: true });
  },

  // [기존] 싱글 틱 소리
  playTick: function(freq = 600, vol = 0.15) {
    this._playSound(freq, null, vol);
  },

  // [신규] 듀얼 톤 (DTMF) 재생 함수
  // freq1: 저음, freq2: 고음
  playDTMF: function(freq1, freq2, vol = 0.25) {
    this._playSound(freq1, freq2, vol);
  },

  // 내부 소리 재생 로직 (통합)
  _playSound: function(freq1, freq2, vol) {
    if (!this.ctx) this.init();
    if (this.ctx.state !== 'running') this.ctx.resume().catch(()=>{});

    try {
      const t = this.ctx.currentTime;
      const gain = this.ctx.createGain();
      
      // 메인 볼륨 설정
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1); // 약간 더 길게 (100ms)

      gain.connect(this.ctx.destination);

      // 첫 번째 주파수 (저음)
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq1, t);
      osc1.connect(gain);
      osc1.start(t);
      osc1.stop(t + 0.11);

      // 두 번째 주파수 (고음) - DTMF일 때만 생성
      if (freq2) {
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq2, t);
        osc2.connect(gain);
        osc2.start(t);
        osc2.stop(t + 0.11);
      }

    } catch (e) {}
  }
};

// 3. 통합 트리거 함수 (설정 적용)
window.triggerHapticFeedback = function() {
  // ▼▼▼ '0'번 키패드 소리 적용 (941Hz + 1336Hz 믹스) ▼▼▼
  //SoundController.playDTMF(941, 1336, 0.25); 
  SoundController.playDTMF(500, 0, 0.05);
  // 안드로이드 진동 (지원 기기만)
  if (navigator.vibrate) {
    try { navigator.vibrate(10); } catch(e) {}
  }
};

// 4. 일반 버튼 자동 적용 로직
function addHapticToElement(el) {
  if (el.dataset.hapticApplied === 'true' || el.disabled) return;
  el.dataset.hapticApplied = 'true';

  let lastTrigger = 0;
  const handleInteract = () => {
    const now = Date.now();
    if (now - lastTrigger < 50) return;
    lastTrigger = now;
    window.triggerHapticFeedback();
  };

  el.addEventListener('touchstart', handleInteract, { passive: true });
  el.addEventListener('mousedown', (e) => {
    if (!('ontouchstart' in window)) handleInteract(e);
  }, { passive: true });
}

// 5. 뒤로 가기 버튼 전용 함수
window.enhanceBackButton = function(buttonId) {
  const button = document.getElementById(buttonId);
  if (!button) return;

  if (button.dataset.backButtonEnhanced === 'true') return;
  button.dataset.backButtonEnhanced = 'true';
  button.dataset.hapticApplied = 'true';

  const originalOnClick = button.onclick;
  const originalOnClickAttr = button.getAttribute('onclick');
  
  button.onclick = null;
  button.removeAttribute('onclick');

  const handleBackAction = (e) => {
    window.triggerHapticFeedback();
    setTimeout(() => {
      if (originalOnClick) {
        originalOnClick.call(button, e);
      } else if (originalOnClickAttr) {
        try { new Function('event', originalOnClickAttr).call(button, e); } catch(err) {}
      } else {
        if (typeof showScreen === 'function') showScreen('basecampScreen');
      }
    }, 10);
  };

  button.addEventListener('touchstart', (e) => { e.preventDefault(); handleBackAction(e); }, { passive: false });
  button.addEventListener('click', (e) => { if (!('ontouchstart' in window)) handleBackAction(e); });
};

// 6. 시스템 초기화
function initHapticSystem() {
  SoundController.init();
  document.querySelectorAll('button, .btn, .clickable').forEach(addHapticToElement);
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          if (node.matches('button, .btn')) addHapticToElement(node);
          node.querySelectorAll('button, .btn').forEach(addHapticToElement);
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHapticSystem);
} else {
  initHapticSystem();
}

window.isIOSDevice = DeviceUtils.isIOS;
window.shouldUseSound = () => true;
window.playClickSound = window.triggerHapticFeedback;
window.playTickSound = window.triggerHapticFeedback;
window.addHapticFeedbackToButton = addHapticToElement;
window.applyHapticFeedbackToAllButtons = () => {}; 
window.setupHapticObserver = () => {};


/* ==========================================================
   [모바일 대시보드 컨트롤 로직]
   - 건너뛰기, 토글(시작/일시정지), 종료 기능 구현
   - 상태에 따른 이미지 스와핑 (play0.png <-> pause0.png)
========================================================== */

/**
 * 1. 시작/일시정지 토글 핸들러
 * - 화면 로딩 시 play0.png (대기 상태)
 * - 클릭 시: 실행 중이면 일시정지(play0.png), 정지 중이면 재개(pause0.png)
 */
/**
 * 모바일 대시보드에서 워크아웃 시작 (Indoor Training 로직 참고)
 */
function startMobileWorkout() {
  console.log('[Mobile Dashboard] Starting workout...');
  
  // 모바일 개인훈련 대시보드 화면에서만 동작하도록 체크
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const isMobileActive = mobileScreen && 
    (mobileScreen.classList.contains('active') || 
     window.getComputedStyle(mobileScreen).display !== 'none');
  
  if (!isMobileActive) {
    console.log('[Mobile Dashboard] 모바일 화면이 아니므로 실행하지 않음');
    return;
  }
  
  // 워크아웃이 선택되어 있는지 확인
  if (!window.currentWorkout) {
    if (typeof showToast === 'function') {
      showToast('워크아웃을 먼저 선택하세요', 'error');
    }
    return;
  }

  // 모바일 전용 훈련 상태 초기화 (Firebase와 무관한 독립적인 상태)
  const mts = window.mobileTrainingState;
  const w = window.currentWorkout;
  
  // 기존 타이머가 있으면 정리
  if (mts.timerId) {
    clearInterval(mts.timerId);
    mts.timerId = null;
  }
  
  // 누적 종료시각 배열 계산
  mts.segEnds = [];
  let acc = 0;
  for (let i = 0; i < w.segments.length; i++) {
    const durSec = segDurationSec(w.segments[i]);
    acc += durSec;
    mts.segEnds.push(acc);
  }
  mts.totalSec = acc;
  
  // 초기 상태 설정
  mts.elapsedSec = 0;
  mts.segIndex = 0;
  mts.segElapsedSec = 0;
  mts.paused = false;
  mts.workoutStartMs = Date.now();
  mts.pauseAccumMs = 0;
  mts.pausedAtMs = null;
  mts._countdownFired = {};
  mts._prevRemainMs = {};
  mts._lastProcessedSegIndex = 0;
  mts.segmentPowerHistory = []; // 세그먼트별 파워 히스토리 (랩 평균 파워 계산용)

  // 훈련 세션 시작 (개인훈련 대시보드와 동일한 로직)
  const currentUser = window.currentUser || null;
  const userId = currentUser?.id || currentUser?.Id || null;
  if (window.trainingResults && typeof window.trainingResults.startSession === 'function' && userId) {
    window.trainingResults.startSession(userId);
    console.log('[Mobile Dashboard] 훈련 세션 시작:', { userId: userId, workoutId: window.currentWorkout?.id });
  } else if (!userId) {
    console.warn('[Mobile Dashboard] 사용자 ID가 없어 세션을 시작할 수 없습니다.');
  }
  
  // 모바일 전용 독립적인 타이머 루프 시작 (Firebase와 무관)
  startMobileTrainingTimerLoop();

  // 모바일 대시보드 UI 초기 업데이트
  updateMobileDashboardUI();
  
  // 초기 세그먼트 그래프 그리기 (펄스 애니메이션 포함)
  if (typeof drawSegmentGraph === 'function' && w.segments && w.segments.length > 0) {
    drawSegmentGraph(w.segments, 0, 'mobileIndividualSegmentGraph', 0);
  }
  
  // 마스코트 펄스 애니메이션을 위한 주기적 그래프 재그리기 시작
  startMobileMascotPulseAnimation();

  // 버튼 상태 업데이트 (SVG <image> 요소는 href 속성 사용)
  const btnImg = document.getElementById('imgMobileToggle');
  if(btnImg) btnImg.setAttribute('href', 'assets/img/pause0.png');

  // 시작 버튼 펄스: 훈련 시작 후에는 펄스 중지·숨김
  if (typeof updateMobileStartPulse === 'function') updateMobileStartPulse();

  // 화면 꺼짐 방지 활성화 (워크아웃 시작 시) — 주기적 재요청 체크도 함께 시작
  if (window.mobileDashboardWakeLockControl && typeof window.mobileDashboardWakeLockControl.request === 'function') {
    // 사용자 상호작용 후 활성화 (브라우저 정책)
    setTimeout(() => {
      window.mobileDashboardWakeLockControl.request();
    }, 100);
  }

  if (typeof showToast === "function") showToast("훈련을 시작합니다");
}

/**
 * 모바일 개인훈련 대시보드 전용 독립적인 타이머 루프 (Firebase와 무관)
 * Indoor Training의 startSegmentLoop와 유사하지만 모바일 전용 상태를 사용
 */
function startMobileTrainingTimerLoop() {
  console.log('[Mobile Dashboard] 모바일 전용 타이머 루프 시작');
  
  // 모바일 개인훈련 대시보드 화면에서만 동작하도록 체크
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const isMobileActive = mobileScreen && 
    (mobileScreen.classList.contains('active') || 
     window.getComputedStyle(mobileScreen).display !== 'none');
  
  if (!isMobileActive) {
    console.log('[Mobile Dashboard] 모바일 화면이 아니므로 타이머 루프 실행하지 않음');
    return;
  }
  
  const w = window.currentWorkout;
  if (!w || !w.segments || w.segments.length === 0) {
    console.error('[Mobile Dashboard] 워크아웃 또는 세그먼트가 없습니다:', w);
    return;
  }
  
  const mts = window.mobileTrainingState;
  
  // 기존 타이머가 있으면 정리
  if (mts.timerId) {
    clearInterval(mts.timerId);
    mts.timerId = null;
  }
  
  console.log('[Mobile Dashboard] 타이머 시작, 총 시간:', mts.totalSec, '초');
  
  // 1초마다 실행되는 메인 루프
  mts.timerId = setInterval(() => {
    // 모바일 화면 체크
    const mobileScreen = document.getElementById('mobileDashboardScreen');
    const isMobileActive = mobileScreen && 
      (mobileScreen.classList.contains('active') || 
       window.getComputedStyle(mobileScreen).display !== 'none');
    
    if (!isMobileActive) {
      // 모바일 화면이 아니면 타이머 정지
      console.log('[Mobile Dashboard] 모바일 화면이 아니므로 타이머 정지');
      if (mts.timerId) {
        clearInterval(mts.timerId);
        mts.timerId = null;
      }
      return;
    }
    
    if (!mts) {
      console.error('[Mobile Dashboard] mobileTrainingState가 없습니다!');
      return;
    }
    
    if (mts.paused) {
      // 일시정지 중이면 pausedAtMs 업데이트만 하고 스킵
      if (!mts.pausedAtMs) {
        mts.pausedAtMs = Date.now();
      }
      return;
    }
    
    // === 시간 진행(벽시계 기반) ===
    const nowMs = Date.now();
    
    if (!mts.workoutStartMs) {
      console.warn('[Mobile Dashboard] workoutStartMs가 없어서 현재 시간으로 설정합니다.');
      mts.workoutStartMs = nowMs;
      mts.pauseAccumMs = 0;
      mts.pausedAtMs = null;
    }
    
    // 일시정지 누적 반영
    const pausedMs = mts.pauseAccumMs + (mts.pausedAtMs ? (nowMs - mts.pausedAtMs) : 0);
    const newElapsedSec = Math.floor((nowMs - mts.workoutStartMs - pausedMs) / 1000);
    
    // 음수 방지
    if (newElapsedSec < 0) {
      console.warn('[Mobile Dashboard] 경과 시간이 음수입니다. workoutStartMs를 재설정합니다.');
      mts.workoutStartMs = nowMs;
      mts.pauseAccumMs = 0;
      mts.elapsedSec = 0;
    } else {
      mts.elapsedSec = newElapsedSec;
    }
    
    // 세그먼트 정보
    const currentSegIndex = mts.segIndex;
    const currentSeg = w.segments[currentSegIndex];
    if (!currentSeg) {
      console.error('[Mobile Dashboard] 현재 세그먼트가 없습니다. 인덱스:', currentSegIndex);
      return;
    }
    const segDur = segDurationSec(currentSeg);
    
    // Firebase에서 받은 랩 카운트다운 값이 있으면 우선 사용 (코치 화면과 동기화)
    if (window.mobileDashboardFirebaseLapCountdown !== undefined && window.mobileDashboardFirebaseLapCountdown !== null) {
      // Firebase에서 받은 랩 카운트다운 값 사용 (코치 화면과 동기화)
      const firebaseLapCountdown = Math.max(0, Math.floor(window.mobileDashboardFirebaseLapCountdown));
      
      // 랩 카운트다운을 기반으로 세그먼트 경과 시간 역산
      const segElapsedSec = Math.max(0, segDur - firebaseLapCountdown);
      mts.segElapsedSec = Math.min(segElapsedSec, segDur);
      
      // 랩 카운트다운 값 사용
      var segRemaining = firebaseLapCountdown;
    } else {
      // Firebase 값이 없으면 로컬 계산 (폴백)
      // 이전 세그먼트들의 누적 시간 계산
      let cumStart = 0;
      for (let i = 0; i < mts.segIndex; i++) {
        const seg = w.segments[i];
        if (seg) {
          cumStart += segDurationSec(seg);
        }
      }
      
      // 세그먼트 경과 시간 계산 (전체 경과 시간 - 이전 세그먼트들의 누적 시간)
      const calculatedSegElapsed = Math.max(0, mts.elapsedSec - cumStart);
      
      // 세그먼트 경과 시간 저장 (전환 조건 확인을 위해 제한하지 않음)
      // UI 표시용으로는 segDur로 제한하지만, 실제 값은 calculatedSegElapsed 사용
      mts.segElapsedSec = calculatedSegElapsed;
      
      // 랩 카운트다운 계산 (세그먼트 남은 시간, 0 이하로 내려가지 않도록)
      var segRemaining = Math.max(0, segDur - Math.min(calculatedSegElapsed, segDur));
    }
    
    // UI 업데이트
    // 1. 경과 시간 표시
    const timerEl = safeGetElement('mobile-main-timer');
    if (timerEl) {
      const hours = Math.floor(mts.elapsedSec / 3600);
      const minutes = Math.floor((mts.elapsedSec % 3600) / 60);
      const seconds = Math.floor(mts.elapsedSec % 60);
      timerEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    // 2. 랩 카운트다운 표시 (Firebase 값 우선 사용)
    const lapTimeEl = safeGetElement('mobile-ui-lap-time');
    if (lapTimeEl) {
      // segRemaining이 유효한 값인지 확인 (null이 아니고 숫자이며 0 이상)
      if (segRemaining !== null && segRemaining !== undefined && !isNaN(segRemaining) && segRemaining >= 0) {
        const lapMinutes = Math.floor(segRemaining / 60);
        const lapSeconds = Math.floor(segRemaining % 60);
        lapTimeEl.textContent = `${String(lapMinutes).padStart(2, '0')}:${String(lapSeconds).padStart(2, '0')}`;
        lapTimeEl.setAttribute('fill', segRemaining <= 10 ? '#ff4444' : '#00d4aa');
      } else {
        // 유효하지 않은 값이면 기본값 표시
        lapTimeEl.textContent = '00:00';
        lapTimeEl.setAttribute('fill', '#00d4aa');
        console.warn('[Mobile Dashboard] 랩 카운트다운 값이 유효하지 않음:', segRemaining);
      }
    }
    
    // 3. 세그먼트 그래프 업데이트 (마스코트 위치)
    if (typeof drawSegmentGraph === 'function') {
      drawSegmentGraph(w.segments, currentSegIndex, 'mobileIndividualSegmentGraph', mts.elapsedSec);
    }
    
    // 4. 세그먼트 정보 업데이트
    if (typeof updateMobileDashboardUI === 'function') {
      updateMobileDashboardUI();
    }
    
    // 5. 목표 파워 및 원호 업데이트 (세그먼트별 목표값 표시 및 달성율에 따른 색상 반영)
    if (typeof updateMobileTargetPower === 'function') {
      updateMobileTargetPower();
    }
    if (typeof updateMobileTargetPowerArc === 'function') {
      updateMobileTargetPowerArc();
    }
    
    // 6. 모바일 전용 데이터 수집 (3초 평균 파워값 사용, 1초마다 기록)
    const powerValue = window.get3SecondAveragePower ? window.get3SecondAveragePower() : Math.round(window.liveData?.power || 0);
    const hrValue = Math.round(window.liveData?.heartRate || 0);
    const cadenceValue = Math.round(window.liveData?.cadence || 0);
    
    if (window.trainingResults && typeof window.trainingResults.appendStreamSample === 'function') {
      const now = new Date();
      if (powerValue > 0) {
        window.trainingResults.appendStreamSample('power', powerValue, now);
      }
      if (hrValue > 0) {
        window.trainingResults.appendStreamSample('hr', hrValue, now);
      }
      if (cadenceValue > 0) {
        window.trainingResults.appendStreamSample('cadence', cadenceValue, now);
      }
    }
    
    // 전체 종료 판단
    if (mts.elapsedSec >= mts.totalSec) {
      console.log('[Mobile Dashboard] 훈련 완료!');
      clearInterval(mts.timerId);
      mts.timerId = null;
      
      // 카운트다운 오버레이 닫기
      MobileCountdownDisplay.hideImmediate();
      
      if (typeof showToast === "function") showToast("훈련이 완료되었습니다!");
      
      // 로딩 애니메이션 표시
      const loadingModal = safeGetElement('mobileTrainingLoadingModal');
      if (loadingModal) {
        loadingModal.classList.remove('hidden');
        loadingModal.style.display = 'flex';
      }
      
      // 모바일 전용 결과 저장 (독립적으로 구동)
      Promise.resolve()
        .then(() => {
          console.log('[Mobile Dashboard] 결과 저장 시작');
          
          // 세션 종료
          if (window.trainingResults && typeof window.trainingResults.endSession === 'function') {
            window.trainingResults.endSession();
          }
          
          // 추가 메타데이터 준비
          const extra = {
            workoutId: window.currentWorkout?.id || '',
            workoutName: window.currentWorkout?.title || window.currentWorkout?.name || '',
            elapsedTime: mts.elapsedSec, // 모바일 전용 경과 시간
            completionType: 'normal',
            appVersion: '1.0.0',
            timestamp: new Date().toISOString(),
            source: 'mobile_dashboard' // 모바일 대시보드에서 저장됨을 표시
          };
          
          // 결과 저장
          if (window.trainingResults && typeof window.trainingResults.saveTrainingResult === 'function') {
            return window.trainingResults.saveTrainingResult(extra);
          }
          return Promise.resolve({ success: true });
        })
        .catch((e) => { 
          console.warn('[Mobile Dashboard] 결과 저장 오류:', e);
          return { success: false, error: e.message };
        })
        .then(() => window.trainingResults?.initializeResultScreen?.())
        .catch((e) => { console.warn('[Mobile Dashboard] initializeResultScreen error', e); })
        .then(() => { 
          // 로딩 애니메이션 숨기기
          if (loadingModal) {
            loadingModal.classList.add('hidden');
            loadingModal.style.display = 'none';
          }
          
          // 결과 모달 표시
          if (typeof showMobileTrainingResultModal === 'function') {
            showMobileTrainingResultModal();
          }
        });
      return;
    }
    
    // 세그먼트 카운트다운 체크 (세그먼트 종료 6초 전부터 5초 카운트다운)
    const segRemainingMs = (segDur - mts.segElapsedSec) * 1000;
    const nextSeg = currentSegIndex < w.segments.length - 1 ? w.segments[currentSegIndex + 1] : null;
    
    // segRemainingMs가 0 이하이면 카운트다운 실행하지 않음 (0초 반복 방지)
    if (nextSeg && segRemainingMs > 0 && segRemainingMs <= 6000) {
      // 남은 시간을 초 단위로 변환 (6초 이하일 때만)
      const remainSec = Math.ceil(segRemainingMs / 1000);
      const n = Math.max(0, remainSec - 1); // 6초 → 5, 5초 → 4, ..., 1초 → 0
      
      // 카운트다운 상태 초기화
      if (!mts._countdownFired) mts._countdownFired = {};
      if (!mts._prevRemainMs) mts._prevRemainMs = {};
      
      const key = String(currentSegIndex);
      const firedMap = mts._countdownFired[key] || {};
      const remainMsPrev = mts._prevRemainMs[key] || segDur * 1000;
      const remainMsNow = segRemainingMs;
      
      // remainMsNow가 0 이하이면 카운트다운 실행하지 않음 (0초 반복 방지)
      if (remainMsNow <= 0) {
        // 이미 종료된 세그먼트이므로 카운트다운 종료 및 상태 초기화
        if (MobileCountdownDisplay.active) {
          MobileCountdownDisplay.hideImmediate();
        }
        // firedMap에 모든 숫자를 기록하여 더 이상 실행되지 않도록 함
        mts._countdownFired[key] = { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true };
        // prevRemainMs는 업데이트하지 않음 (이미 종료된 상태)
        return; // 더 이상 카운트다운 로직 실행하지 않음
      }
      
      mts._prevRemainMs[key] = remainMsNow;
      
      // 경계: 6→5, 5→4, ..., 2→1 은 (n+1)*1000ms, 1→0 은 1000ms
      const boundary = (n > 0) ? (n + 1) * 1000 : 1000;
      const crossed = (remainMsPrev > boundary && remainMsNow <= boundary);
      
      if (crossed && !firedMap[n]) {
        // remainMsNow가 0 이하이면 더 이상 카운트다운 실행하지 않음 (0초 반복 방지)
        if (remainMsNow <= 0) {
          // 이미 종료된 세그먼트이므로 카운트다운 종료
          if (MobileCountdownDisplay.active) {
            MobileCountdownDisplay.hideImmediate();
          }
          // firedMap에 기록하여 더 이상 실행되지 않도록 함
          mts._countdownFired[key] = { ...firedMap, [n]: true };
          return;
        }
        
        // 오버레이 표시 시작(6초 시점에 "5" 표시)
        if (n === 5 && !MobileCountdownDisplay.active) {
          MobileCountdownDisplay.ensure(nextSeg);
          MobileCountdownDisplay.render(5);
          playBeep(880, 120, 0.25);
        } else if (MobileCountdownDisplay.active) {
          // 진행 중이면 숫자 업데이트만
          MobileCountdownDisplay.render(n);
          
          // 4, 3, 2, 1초일 때 벨소리 재생
          if (n > 0) {
            playBeep(880, 120, 0.25);
          }
        }
        
        // 0은 "세그먼트 종료 1초 전"에 표시 + 강조 벨소리, 그리고 오버레이 닫기 예약
        if (n === 0) {
          // 강조 벨소리 (조금 더 강한 톤)
          playBeep(1500, 700, 0.35, "square");
          // 오버레이는 약간의 여유를 두고 닫기
          MobileCountdownDisplay.finish(800);
        }
        
        mts._countdownFired[key] = { ...firedMap, [n]: true };
      }
    } else if (segRemainingMs <= 0) {
      // 세그먼트가 이미 종료된 경우 카운트다운 오버레이 닫기
      if (MobileCountdownDisplay.active) {
        MobileCountdownDisplay.hideImmediate();
      }
    }
    
    // 세그먼트 경계 통과 → 다음 세그먼트로 전환
    const prevSegIndex = mts._lastProcessedSegIndex ?? currentSegIndex;
    
    // 이전 세그먼트들의 누적 시간 계산 (세그먼트 종료 시각 계산용)
    let cumStart = 0;
    for (let i = 0; i < currentSegIndex; i++) {
      const seg = w.segments[i];
      if (seg) {
        cumStart += segDurationSec(seg);
      }
    }
    
    // 세그먼트 전환 조건: 
    // 1. 세그먼트 경과 시간이 세그먼트 지속 시간과 같거나 초과 (또는 전체 경과 시간이 세그먼트 종료 시각 초과)
    // 2. 아직 전환되지 않은 경우 (prevSegIndex === currentSegIndex)
    // 3. 마지막 세그먼트가 아닌 경우
    const segEndAtSec = cumStart + segDur;
    // 세그먼트 경과 시간이 segDur 이상이거나, 전체 경과 시간이 세그먼트 종료 시각을 초과한 경우 전환
    const shouldTransition = ((mts.segElapsedSec >= segDur) || (mts.elapsedSec >= segEndAtSec)) && 
                             (prevSegIndex === currentSegIndex) && 
                             (currentSegIndex < w.segments.length - 1);
    
    // 디버깅 로그
    if (mts.segElapsedSec >= segDur * 0.9) { // 세그먼트가 90% 이상 진행되었을 때만 로그
      console.log(`[Mobile Dashboard] 세그먼트 전환 체크: segElapsedSec=${mts.segElapsedSec.toFixed(1)}, segDur=${segDur}, elapsedSec=${mts.elapsedSec}, segEndAtSec=${segEndAtSec}, prevSegIndex=${prevSegIndex}, currentSegIndex=${currentSegIndex}, shouldTransition=${shouldTransition}`);
    }
    
    if (shouldTransition) {
      // 카운트다운 오버레이 닫기
      MobileCountdownDisplay.hideImmediate();
      console.log(`[Mobile Dashboard] 세그먼트 ${currentSegIndex + 1} 완료 (경과: ${mts.segElapsedSec}초/${segDur}초, 전체: ${mts.elapsedSec}초), 다음 세그먼트로 이동`);
      
      const nextSegIndex = currentSegIndex + 1;
      mts.segIndex = nextSegIndex;
      mts._lastProcessedSegIndex = nextSegIndex;
      
      // 세그먼트 전환 직후 다음 세그먼트의 경과 시간 즉시 계산 (다음 틱까지 기다리지 않음)
      // 이전 세그먼트들의 누적 시간 재계산
      let nextCumStart = 0;
      for (let i = 0; i < nextSegIndex; i++) {
        const seg = w.segments[i];
        if (seg) {
          nextCumStart += segDurationSec(seg);
        }
      }
      // 다음 세그먼트의 경과 시간 계산
      const nextSegElapsed = Math.max(0, mts.elapsedSec - nextCumStart);
      mts.segElapsedSec = nextSegElapsed;
      
      console.log(`[Mobile Dashboard] 세그먼트 전환 직후 경과 시간 업데이트: segIndex=${nextSegIndex}, elapsedSec=${mts.elapsedSec}, cumStart=${nextCumStart}, segElapsedSec=${nextSegElapsed.toFixed(1)}`);
      
      // 다음 세그먼트의 카운트다운 상태 초기화
      if (nextSegIndex < w.segments.length) {
        const nextSeg = w.segments[nextSegIndex];
        const nextSegDur = segDurationSec(nextSeg);
        mts._countdownFired[String(nextSegIndex)] = {};
        mts._prevRemainMs[String(nextSegIndex)] = nextSegDur * 1000;
      }
      
      if (nextSegIndex < w.segments.length) {
        console.log(`[Mobile Dashboard] 세그먼트 ${nextSegIndex + 1}로 전환 (전체 경과: ${mts.elapsedSec}초)`);
        
        // 이전 세그먼트 결과 기록
        if (window.trainingResults && typeof window.trainingResults.recordSegmentResult === 'function') {
          const prevSeg = w.segments[currentSegIndex];
          if (prevSeg) {
            window.trainingResults.recordSegmentResult(currentSegIndex, prevSeg);
            console.log('[Mobile Dashboard] 세그먼트 결과 기록:', currentSegIndex);
          }
        }
        
        // 세그먼트 파워 히스토리 초기화 (새 세그먼트 시작)
        mts.segmentPowerHistory = [];
        
        // UI 업데이트
        if (typeof updateMobileDashboardUI === 'function') {
          updateMobileDashboardUI();
        }
        
        // 목표 파워 및 원호 업데이트 (새 세그먼트의 목표값 표시)
        if (typeof updateMobileTargetPower === 'function') {
          updateMobileTargetPower();
        }
        if (typeof updateMobileTargetPowerArc === 'function') {
          updateMobileTargetPowerArc();
        }
      } else {
        console.log('[Mobile Dashboard] 모든 세그먼트 완료');
        
        // 마지막 세그먼트 결과 기록
        if (window.trainingResults && typeof window.trainingResults.recordSegmentResult === 'function') {
          const lastSeg = w.segments[currentSegIndex];
          if (lastSeg) {
            window.trainingResults.recordSegmentResult(currentSegIndex, lastSeg);
            console.log('[Mobile Dashboard] 마지막 세그먼트 결과 기록:', currentSegIndex);
          }
        }
      }
    } else if (prevSegIndex !== currentSegIndex) {
      // 세그먼트가 이미 전환된 경우, 추적 변수만 업데이트
      mts._lastProcessedSegIndex = currentSegIndex;
    }
    
  }, 1000); // 1초마다 실행
}

/**
 * 모바일 대시보드용 세그먼트 정보를 표시 형식으로 변환 (예: FTP 60%, RPM 90 등)
 * individual.js의 formatSegmentInfo와 동일한 로직 (독립적으로 구동)
 */
function formatMobileSegmentInfo(targetType, targetValue, segmentIndex) {
  if (!targetType || targetValue === undefined || targetValue === null) {
    return '준비 중';
  }
  
  // target_type에 따라 표시 형식 결정
  if (targetType === 'ftp_pct') {
    // FTP 퍼센트: "FTP 60%"
    const percent = Number(targetValue) || 100;
    return `FTP ${percent}%`;
  } else if (targetType === 'ftp_pctz') {
    let minPercent = 60;
    let maxPercent = 75;
    if (typeof targetValue === 'string') {
      const pctzDelimF = targetValue.includes('~') ? '~' : (targetValue.includes('/') ? '/' : null);
      if (pctzDelimF) {
        const parts = targetValue.split(pctzDelimF).map(s => s.trim());
        if (parts.length >= 2) {
          minPercent = Number(parts[0]) || 60;
          maxPercent = Number(parts[1]) || 75;
        } else if (parts.length >= 1) {
          minPercent = Number(parts[0]) || 60;
        }
      } else if (targetValue.includes(',')) {
        const parts = targetValue.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          minPercent = Number(parts[0]) || 60;
          maxPercent = Number(parts[1]) || 75;
        } else if (parts.length >= 1) {
          minPercent = Number(parts[0]) || 60;
        }
      } else {
        minPercent = Number(targetValue) || 60;
      }
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      minPercent = Number(targetValue[0]) || 60;
      maxPercent = Number(targetValue[1]) || 75;
    } else if (typeof targetValue === 'number') {
      minPercent = targetValue;
    }
    
    return `FTP ${minPercent}%/${maxPercent}%`;
  } else if (targetType === 'dual') {
    let ftpPercent = 100;
    let rpm = 90;
    const dualDelimF = typeof targetValue === 'string' ? (targetValue.includes('~') ? '~' : (targetValue.includes('/') ? '/' : null)) : null;
    if (dualDelimF && typeof targetValue === 'string') {
      const parts = targetValue.split(dualDelimF).map(s => s.trim());
      if (parts.length >= 1) {
        ftpPercent = Number(parts[0].replace('%', '')) || 100;
      }
      if (parts.length >= 2) {
        rpm = Number(parts[1]) || 90;
      }
    } else if (Array.isArray(targetValue) && targetValue.length > 0) {
      ftpPercent = Number(targetValue[0]) || 100;
      if (targetValue.length >= 2) {
        rpm = Number(targetValue[1]) || 90;
      }
    } else if (typeof targetValue === 'number') {
      // 숫자로 저장된 경우 처리
      const numValue = targetValue;
      if (numValue > 1000 && numValue < 1000000) {
        const str = String(numValue);
        if (str.length >= 4) {
          const ftpPart = str.slice(0, -3);
          ftpPercent = Number(ftpPart) || 100;
        }
      } else {
        ftpPercent = numValue <= 1000 ? numValue : 100;
      }
    }
    
    return `FTP ${ftpPercent}% / RPM ${rpm}`;
  } else if (targetType === 'cadence_rpm') {
    // RPM: "RPM 90"
    const rpm = Number(targetValue) || 0;
    return `RPM ${rpm}`;
  } else {
    // 알 수 없는 타입: 기본값 표시
    const segIdx = (segmentIndex >= 0 ? segmentIndex + 1 : 1);
    return `Segment ${segIdx}`;
  }
}

/**
 * 모바일 전용 일시정지/재개 함수 (Firebase와 무관, 독립적으로 동작)
 */
function setMobilePaused(isPaused) {
  // 모바일 개인훈련 대시보드 화면에서만 동작하도록 체크
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const isMobileActive = mobileScreen && 
    (mobileScreen.classList.contains('active') || 
     window.getComputedStyle(mobileScreen).display !== 'none');
  
  if (!isMobileActive) {
    return;
  }
  
  const mts = window.mobileTrainingState;
  if (!mts) {
    console.warn('[Mobile Dashboard] mobileTrainingState가 없습니다.');
    return;
  }
  
  const wantPause = !!isPaused;
  mts.paused = wantPause;
  
  const nowMs = Date.now();
  
  if (wantPause) {
    // 일시정지 시작
    if (!mts.pausedAtMs) {
      mts.pausedAtMs = nowMs;
    }
  } else {
    // 일시정지 해제 → 누적 일시정지 시간 더해주기
    if (mts.pausedAtMs) {
      mts.pauseAccumMs += (nowMs - mts.pausedAtMs);
      mts.pausedAtMs = null;
    }
  }
  
  // 버튼 이미지 업데이트
  const btnImg = document.getElementById('imgMobileToggle');
  if (btnImg) {
    btnImg.setAttribute('href', wantPause ? 'assets/img/play0.png' : 'assets/img/pause0.png');
  }
  
  // 시작 버튼 펄스: 트레이너/파워미터 연결 시에만, 일시정지=재생·표시 / 재개=중지·숨김 (updateMobileStartPulse에서 일괄 처리)
  if (typeof updateMobileStartPulse === 'function') updateMobileStartPulse();
  
  if (typeof showToast === "function") {
    showToast(wantPause ? "일시정지됨" : "재개됨");
  }
  
  console.log('[Mobile Dashboard] 일시정지 상태 변경:', wantPause ? '일시정지' : '재개');
}

/**
 * 모바일 대시보드: 시작 버튼 펄스 표시 여부
 * 조건: 연결 버튼에 스마트 트레이너 또는 파워미터가 연결된 경우에만 펄스 구동.
 * - 시작 전 또는 일시정지 = 펄스 재생·표시 / 시작 후 재생 중 = 펄스 중지·숨김
 * - 트레이너·파워미터 미연결 시 펄스 미동작(숨김)
 */
function updateMobileStartPulse() {
  const pulseWrap = document.getElementById('mobileStartPulseWrap');
  if (!pulseWrap) return;
  var hasTrainerOrPm = !!(window.connectedDevices?.trainer || window.connectedDevices?.powerMeter);
  if (!hasTrainerOrPm) {
    pulseWrap.classList.remove('pulse-active');
    pulseWrap.classList.add('pulse-hidden');
    return;
  }
  const mts = window.mobileTrainingState;
  const showPulse = !mts || !mts.timerId || mts.paused === true;
  if (showPulse) {
    pulseWrap.classList.add('pulse-active');
    pulseWrap.classList.remove('pulse-hidden');
  } else {
    pulseWrap.classList.remove('pulse-active');
    pulseWrap.classList.add('pulse-hidden');
  }
}

/**
 * 모바일 대시보드 UI 업데이트 (세그먼트 정보 등)
 */
function updateMobileDashboardUI() {
  // 모바일 개인훈련 대시보드 화면에서만 동작하도록 체크
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const isMobileActive = mobileScreen && 
    (mobileScreen.classList.contains('active') || 
     window.getComputedStyle(mobileScreen).display !== 'none');
  
  if (!isMobileActive) {
    return;
  }
  
  const w = window.currentWorkout;
  if (!w || !w.segments) return;

  // 모바일 전용 상태 사용 (Firebase와 무관)
  const mts = window.mobileTrainingState || {};
  const currentSegIndex = mts.segIndex || 0;
  const currentSeg = w.segments[currentSegIndex];

  // 세그먼트 정보 표시 (기존 로직 적용 - individual.js와 동일)
  const segmentInfoEl = safeGetElement('mobile-segment-info');
  if (segmentInfoEl && currentSeg) {
    // 세그먼트 이름과 목표 값을 조합하여 표시
    const segmentName = currentSeg.label || currentSeg.name || currentSeg.segment_type || '';
    const targetType = currentSeg.target_type || 'ftp_pct';
    const targetValue = currentSeg.target_value;
    
    // 세그먼트 목표값을 표시 형식으로 변환
    const targetText = formatMobileSegmentInfo(targetType, targetValue, currentSegIndex);
    
    // 세그먼트 이름이 있으면 "세그먼트 이름(목표 값)" 형식, 없으면 "목표 값"만 표시
    const segmentText = segmentName 
      ? `${segmentName}(${targetText})`
      : targetText;
    
    segmentInfoEl.textContent = segmentText;
  } else if (segmentInfoEl) {
    segmentInfoEl.textContent = '준비 중';
  }

  // 세그먼트 그래프 업데이트
  if (typeof drawSegmentGraph === 'function') {
    const elapsedTime = mts.elapsedSec || 0;
    drawSegmentGraph(w.segments, currentSegIndex, 'mobileIndividualSegmentGraph', elapsedTime);
  }
}

/**
 * 모바일 대시보드용 5초 카운트다운 후 워크아웃 시작
 */
function startMobileWorkoutWithCountdown(sec = 5) {
  const overlay = document.getElementById("mobileCountdownOverlay");
  const num = document.getElementById("mobileCountdownNumber");
  
  if (!overlay || !num) {
    console.warn('Mobile countdown elements not found, starting workout directly');
    startMobileWorkout();
    return;
  }

  // 워크아웃이 선택되어 있는지 확인
  if (!window.currentWorkout) {
    if (typeof showToast === 'function') {
      showToast('워크아웃을 먼저 선택하세요', 'error');
    }
    return;
  }

  console.log(`[Mobile Dashboard] Starting ${sec}s countdown...`);

  // 오버레이 확실히 표시 (크게 표시)
  overlay.classList.remove("hidden");
  overlay.style.display = "flex";
  overlay.style.zIndex = "10000";

  let remain = sec;
  
  // 초기 표시 및 첫 번째 삐 소리
  num.textContent = remain;
  num.style.fontSize = "300px"; // 더 크게 표시
  playBeep(880, 120, 0.25);

  const timer = setInterval(async () => {
    remain -= 1;

    if (remain > 0) {
      // 1, 2, 3, 4초일 때 - 일반 삐 소리
      num.textContent = remain;
      playBeep(880, 120, 0.25);
    } else if (remain === 0) {
      // 0초일 때 - 화면에 "0" 표시하고 강조 삐 소리
      num.textContent = "0";
      
      try {
        await playBeep(1500, 700, 0.35, "square");
      } catch (e) {
        console.warn('Failed to play beep:', e);
      }
      
      // 0.5초 추가 대기 후 오버레이 닫기 및 훈련 시작
      setTimeout(() => {
        overlay.classList.add("hidden");
        overlay.style.display = "none";
        console.log('[Mobile Dashboard] Countdown finished, starting workout...');
        startMobileWorkout();
      }, 500);
      
      // 타이머 정리
      clearInterval(timer);
      
    } else {
      clearInterval(timer);
    }
  }, 1000);
}

function handleMobileToggle() {
  // 모바일 개인훈련 대시보드 화면에서만 동작하도록 체크
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const isMobileActive = mobileScreen && 
    (mobileScreen.classList.contains('active') || 
     window.getComputedStyle(mobileScreen).display !== 'none');
  
  if (!isMobileActive) {
    return;
  }
  
  const btnImg = document.getElementById('imgMobileToggle');
  const ts = window.mobileTrainingState; // 모바일 전용 상태 사용
  
  // 훈련이 아예 시작되지 않은 경우 (타이머 없음) -> 워크아웃 확인 후 5초 카운트다운
  if (!ts || !ts.timerId) {
    // 워크아웃이 선택되어 있는지 확인
    if (!window.currentWorkout) {
      // 워크아웃 미선택 시 팝업 표시
      alert('워크아웃을 선택한 후 훈련을 시작하세요');
      return;
    }
    
    // 구독 만료 사용자 제한
    var cu = window.currentUser || (function(){ try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(e){ return null; } })();
    if (typeof isUserExpired === 'function' && cu && isUserExpired(cu)) {
      if (typeof showExpiryRestrictionModal === 'function') showExpiryRestrictionModal();
      return;
    }
    
    // 시작 버튼 클릭 시 즉시 일시정지 버튼으로 변경 (토글 기능)
    // SVG <image> 요소는 href 속성 사용
    if(btnImg) btnImg.setAttribute('href', 'assets/img/pause0.png');
    
    // 5초 카운트다운 후 워크아웃 시작
    startMobileWorkoutWithCountdown(5);
    return;
  }

  // 현재 일시정지 상태 확인 (명확한 상태 체크)
  const isCurrentlyPaused = ts.paused === true;

  console.log('[Mobile Toggle] 현재 상태:', {
    paused: ts.paused,
    timerId: ts.timerId,
    isCurrentlyPaused: isCurrentlyPaused
  });

  // 토글: 일시정지 상태면 재개, 실행 중이면 일시정지
  // setMobilePaused 함수 내부에서 버튼 이미지도 업데이트하므로 여기서는 호출만 함
  if (isCurrentlyPaused) {
    // [현재 일시정지 상태] -> 재개(Resume)
    console.log('[Mobile Toggle] 일시정지 → 재개');
    setMobilePaused(false);
  } else {
    // [현재 실행 상태] -> 일시정지(Pause)
    console.log('[Mobile Toggle] 실행 → 일시정지');
    setMobilePaused(true);
  }
  
  // 추가 안전 장치: syncMobileToggleIcon 호출하여 버튼 상태 동기화
  if (typeof syncMobileToggleIcon === 'function') {
    setTimeout(() => syncMobileToggleIcon(), 100);
  }
}

/**
 * 2. 건너뛰기 핸들러
 */
function handleMobileSkip() {
  // 모바일 개인훈련 대시보드 화면에서만 동작하도록 체크
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const isMobileActive = mobileScreen && 
    (mobileScreen.classList.contains('active') || 
     window.getComputedStyle(mobileScreen).display !== 'none');
  
  if (!isMobileActive) {
    return;
  }
  
  // 모바일 전용 세그먼트 스킵
  const mts = window.mobileTrainingState;
  const w = window.currentWorkout;
  
  if (!w || !w.segments || !mts) {
    console.warn('[Mobile Dashboard] 워크아웃 또는 상태가 없습니다.');
    return;
  }
  
  const currentSegIndex = mts.segIndex || 0;
  if (currentSegIndex < w.segments.length - 1) {
    // 다음 세그먼트로 이동
    const nextSegIndex = currentSegIndex + 1;
    mts.segIndex = nextSegIndex;
    mts.segElapsedSec = 0;
    mts._lastProcessedSegIndex = nextSegIndex;
    
    // 세그먼트 카운트다운 상태 초기화
    if (nextSegIndex < w.segments.length) {
      const nextSeg = w.segments[nextSegIndex];
      const nextSegDur = segDurationSec(nextSeg);
      mts._countdownFired[String(nextSegIndex)] = {};
      mts._prevRemainMs[String(nextSegIndex)] = nextSegDur * 1000;
    }
    
    // UI 업데이트
    if (typeof updateMobileDashboardUI === 'function') {
      updateMobileDashboardUI();
    }
    
    console.log('[Mobile Dashboard] 세그먼트 스킵:', currentSegIndex, '→', nextSegIndex);
  }
  
  // 버튼 클릭 피드백 (진동 등)
  if (navigator.vibrate) navigator.vibrate(50);
}

/**
 * 3. 종료 핸들러
 */
function handleMobileStop() {
  // 모바일 개인훈련 대시보드 화면에서만 동작하도록 체크
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const isMobileActive = mobileScreen && 
    (mobileScreen.classList.contains('active') || 
     window.getComputedStyle(mobileScreen).display !== 'none');
  
  if (!isMobileActive) {
    return;
  }
  
  if (confirm('훈련을 종료하시겠습니까?')) {
    // 모바일 전용 타이머 정지
    const mts = window.mobileTrainingState;
    if (mts && mts.timerId) {
      clearInterval(mts.timerId);
      mts.timerId = null;
    }
    
    // elapsedTime을 전역 변수에 저장 (저장 시 사용)
    if (mts && mts.elapsedSec !== undefined) {
      window.lastElapsedTime = mts.elapsedSec;
      console.log('[Mobile Dashboard] 훈련 종료 시 elapsedTime 저장:', window.lastElapsedTime);
    }
    
    // 모바일 대시보드 전용: 결과 저장 → 초기화 → 결과 모달 표시 (개인훈련 대시보드와 동일한 로직)
    Promise.resolve()
      .then(() => {
        console.log('[Mobile Dashboard] 🚀 1단계: 결과 저장 시작');
        return window.saveTrainingResultAtEnd?.();
      })
      .then((saveResult) => {
        console.log('[Mobile Dashboard] ✅ 1단계 완료:', saveResult);
        return window.trainingResults?.initializeResultScreen?.();
      })
      .then(() => {
        console.log('[Mobile Dashboard] ✅ 2단계 완료: 결과 화면 초기화');
        // 모바일 대시보드 결과 모달 표시
        if (typeof showMobileTrainingResultModal === 'function') {
          showMobileTrainingResultModal();
          console.log('[Mobile Dashboard] ✅ 3단계 완료: 결과 모달 표시');
        }
      })
      .catch((error) => {
        console.error('[Mobile Dashboard] ❌ 결과 저장/표시 중 오류:', error);
        // 오류 발생 시에도 사용자에게 알림
        if (typeof showToast === 'function') {
          showToast('훈련 결과 저장 중 오류가 발생했습니다', 'error');
        }
      });
    
    // 훈련 종료 후 초기 상태(Play 버튼)로 복구 (SVG <image> 요소는 href 속성 사용)
    const btnImg = document.getElementById('imgMobileToggle');
    if(btnImg) btnImg.setAttribute('href', 'assets/img/play0.png');
    
    // 화면 꺼짐 방지 해제 (워크아웃 종료 시)
    if (window.mobileDashboardWakeLockControl && typeof window.mobileDashboardWakeLockControl.release === 'function') {
      window.mobileDashboardWakeLockControl.release();
    }
  }
}

// [상태 동기화] 외부 요인(자동 일시정지 등)으로 상태 변경 시 버튼 이미지 동기화
// 모바일 개인훈련 대시보드 전용: window.mobileTrainingState 사용
function syncMobileToggleIcon() {
  const btnImg = document.getElementById('imgMobileToggle');
  if (!btnImg) return;
  
  // 모바일 개인훈련 대시보드 화면에서만 동작하도록 체크
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const isMobileActive = mobileScreen && 
    (mobileScreen.classList.contains('active') || 
     window.getComputedStyle(mobileScreen).display !== 'none');
  
  if (!isMobileActive) {
    return;
  }
  
  // 모바일 전용 상태 사용 (window.mobileTrainingState)
  const mts = window.mobileTrainingState;
  
  if (!mts) {
    // 상태가 없으면 기본값으로 처리
    btnImg.setAttribute('href', 'assets/img/play0.png');
    return;
  }
  
  // 타이머가 돌고 있고, 일시정지 상태가 아니면 -> pause0.png (멈출 수 있음)
  // 그 외(일시정지 중이거나 훈련 전) -> play0.png (시작/재개 할 수 있음)
  const isRunning = mts.timerId !== null && mts.timerId !== undefined;
  const isPaused = mts.paused === true;
  
  // SVG <image> 요소는 href 속성 사용 (src가 아님)
  const currentHref = btnImg.getAttribute('href') || '';
  
  console.log('[Mobile Toggle Sync] 상태 확인:', {
    isRunning,
    isPaused,
    timerId: mts.timerId,
    currentHref
  });
  
  if (isRunning && !isPaused) {
    // 실행 중: pause0.png
    if (!currentHref.includes('pause0.png')) {
      btnImg.setAttribute('href', 'assets/img/pause0.png');
      console.log('[Mobile Dashboard] 버튼 이미지 업데이트: pause0.png (실행 중)');
    }
  } else {
    // 일시정지 중이거나 훈련 전: play0.png
    if (!currentHref.includes('play0.png')) {
      btnImg.setAttribute('href', 'assets/img/play0.png');
      console.log('[Mobile Dashboard] 버튼 이미지 업데이트: play0.png (일시정지/대기)');
    }
  }
}

// 훈련 상태 업데이트 루프에 동기화 함수 등록 (안전 장치)
if (typeof window.updateTimeUI === 'function') {
  const originalUpdateTimeUI = window.updateTimeUI;
  window.updateTimeUI = function() {
    originalUpdateTimeUI();
    syncMobileToggleIcon(); // UI 갱신 시 버튼 상태도 동기화
  };
}

// ========== 블루투스 연결 기능 (모바일 대시보드 + 개인 훈련 화면 공통) ==========
// context: 'mobile' | 'trainingScreen' — 어느 쪽 드롭다운을 토글할지 지정
function toggleBluetoothDropdown(context) {
  var mobileDropdown = document.getElementById('mobileBluetoothDropdown');
  var trainingDropdown = document.getElementById('trainingScreenBluetoothDropdown');
  var dropdown = context === 'trainingScreen' ? trainingDropdown : mobileDropdown;
  var button = context === 'trainingScreen' ? document.getElementById('trainingScreenBluetoothConnectBtn') : document.getElementById('mobileBluetoothConnectBtn');
  if (!dropdown || !button) return;
  if (context === 'trainingScreen' && mobileDropdown) mobileDropdown.classList.remove('show');
  if (context === 'mobile' && trainingDropdown) trainingDropdown.classList.remove('show');
  
  const isOpening = !dropdown.classList.contains('show');
  dropdown.classList.toggle('show');
  
  // 드롭다운 열 때 저장된 기기 목록 업데이트 (모바일 / 훈련 화면 각각)
  if (isOpening && context === 'mobile') {
    updateMobileBluetoothDropdownWithSavedDevices();
  }
  if (isOpening && context === 'trainingScreen') {
    if (typeof updateTrainingScreenBluetoothDropdownWithSavedDevices === 'function') updateTrainingScreenBluetoothDropdownWithSavedDevices();
  }
  
  if (dropdown.classList.contains('show')) {
    setTimeout(function () {
      document.addEventListener('click', closeBluetoothDropdownOnOutsideClick);
    }, 0);
  } else {
    document.removeEventListener('click', closeBluetoothDropdownOnOutsideClick);
  }
}

function closeBluetoothDropdownOnOutsideClick(event) {
  var mobileDropdown = document.getElementById('mobileBluetoothDropdown');
  var mobileBtn = document.getElementById('mobileBluetoothConnectBtn');
  var trainingDropdown = document.getElementById('trainingScreenBluetoothDropdown');
  var trainingBtn = document.getElementById('trainingScreenBluetoothConnectBtn');
  var insideAny = (mobileDropdown && mobileDropdown.contains(event.target)) ||
    (mobileBtn && mobileBtn.contains(event.target)) ||
    (trainingDropdown && trainingDropdown.contains(event.target)) ||
    (trainingBtn && trainingBtn.contains(event.target));
  if (!insideAny) {
    if (mobileDropdown) mobileDropdown.classList.remove('show');
    if (trainingDropdown) trainingDropdown.classList.remove('show');
    document.removeEventListener('click', closeBluetoothDropdownOnOutsideClick);
  }
}

function toggleMobileBluetoothDropdown() {
  toggleBluetoothDropdown('mobile');
}

// 블루투스 디바이스 연결 함수 (모바일 + 개인 훈련 화면 공통, 연결 후 두 UI 모두 갱신)
// 저장된 기기 재연결: getDevices 1회 시도 후 즉시 connectToSavedDeviceById(저장된 이름으로 requestDevice) 시도
// 원인: 20초 폴링 후 requestDevice 호출 시 사용자 제스처가 소진되어 모바일에서 requestDevice()가 차단됨 → 폴링 제거, 클릭 직후 requestDevice 호출
async function connectMobileBluetoothDeviceToSaved(deviceId, deviceType) {
  try {
    const reconnectFn = typeof reconnectToSavedDevice === 'function' ? reconnectToSavedDevice : (typeof window.reconnectToSavedDevice === 'function' ? window.reconnectToSavedDevice : null);
    if (!reconnectFn) {
      throw new Error('재연결 함수를 찾을 수 없습니다. bluetooth.js가 로드되었는지 확인하세요.');
    }

    let result = null;
    if (typeof showConnectionStatus === 'function') showConnectionStatus(true);
    if (typeof showToast === 'function') showToast('저장된 기기 검색 중…');
    result = await reconnectFn(deviceId, deviceType);
    if (typeof showConnectionStatus === 'function') showConnectionStatus(false);

    if (!result) {
      const connectById = typeof connectToSavedDeviceById === 'function' ? connectToSavedDeviceById : (typeof window.connectToSavedDeviceById === 'function' ? window.connectToSavedDeviceById : null);
      if (connectById) {
        try {
          if (typeof showConnectionStatus === 'function') showConnectionStatus(true);
          if (typeof showToast === 'function') showToast('저장된 기기 이름으로 연결 시도 중…');
          const out = await connectById(deviceId, deviceType);
          if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
          if (out) {
            if (typeof updateMobileBluetoothConnectionStatus === 'function') setTimeout(function () { updateMobileBluetoothConnectionStatus(); }, 200);
            return;
          }
        } catch (byIdErr) {
          if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
          console.warn('[Mobile Dashboard] connectToSavedDeviceById 실패:', byIdErr);
        }
      }
      if (typeof showToast === 'function') showToast('저장된 기기를 찾을 수 없습니다. 전원과 연결 상태를 확인해주세요.');
      return;
    }

    const { device, server } = result;
    
    // 디바이스 타입별 연결 로직 실행
    if (deviceType === 'heartRate') {
      let service;
      try { 
        service = await server.getPrimaryService('heart_rate'); 
      } catch (e) { 
        service = await server.getPrimaryService('0000180d-0000-1000-8000-00805f9b34fb'); 
      }
      
      let characteristic;
      try { 
        characteristic = await service.getCharacteristic('heart_rate_measurement'); 
      } catch (e) { 
        characteristic = await service.getCharacteristic(0x2A37); 
      }
      
      await characteristic.startNotifications();
      const hrHandler = typeof handleHeartRateData === 'function' ? handleHeartRateData : (typeof window.handleHeartRateData === 'function' ? window.handleHeartRateData : null);
      if (hrHandler) {
        characteristic.addEventListener("characteristicvaluechanged", hrHandler);
      }
      
      window.connectedDevices.heartRate = { 
        name: device.name || '알 수 없는 기기', 
        device, 
        server, 
        characteristic 
      };
      
      window.isSensorConnected = true;
      try { 
        window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { 
          detail: { connected: true, deviceType: 'heartRate' } 
        })); 
      } catch (e) {}
      
      const disconnectHandler = typeof handleDisconnect === 'function' ? handleDisconnect : (typeof window.handleDisconnect === 'function' ? window.handleDisconnect : null);
      if (disconnectHandler) {
        device.addEventListener("gattserverdisconnected", () => disconnectHandler('heartRate', device));
      }
      
      // 저장된 기기 정보 업데이트
      const saved = (typeof loadSavedDevices === 'function' ? loadSavedDevices() : window.loadSavedDevices ? window.loadSavedDevices() : []).find(d => d.deviceId === deviceId && d.deviceType === 'heartRate');
      if (saved && (typeof saveDevice === 'function' || typeof window.saveDevice === 'function')) {
        const saveFn = typeof saveDevice === 'function' ? saveDevice : window.saveDevice;
        saveFn(deviceId, device.name || saved.name, 'heartRate', saved.nickname);
      }
      
      if (typeof updateDevicesList === 'function') updateDevicesList();
      if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
      if (typeof showToast === 'function') {
        showToast(`✅ ${saved?.nickname || device.name || '알 수 없는 기기'} 연결 성공`);
      }
      
    } else if (deviceType === 'trainer') {
      // 트레이너 연결 로직 (bluetooth.js의 connectTrainer 로직과 동일)
      const UUIDS = {
        FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb',
        FTMS_DATA: '00002ad2-0000-1000-8000-00805f9b34fb',
        FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb',
        CPS_SERVICE: '00001818-0000-1000-8000-00805f9b34fb',
        CPS_DATA: '00002a63-0000-1000-8000-00805f9b34fb',
        CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
        CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592',
        WAHOO_SERVICE: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
        WAHOO_CONTROL: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
      };
      
      const _safeGetService = async (uuid) => { 
        try { return await server.getPrimaryService(uuid); } 
        catch (e) { return null; } 
      };
      const _safeGetChar = async (svc, uuid) => { 
        if(!svc) return null; 
        try { return await svc.getCharacteristic(uuid); } 
        catch (e) { return null; } 
      };
      
      let dataChar = null;
      let dataProtocol = 'UNKNOWN';
      
      if (!dataChar) {
        const svc = await _safeGetService(UUIDS.FTMS_SERVICE);
        dataChar = await _safeGetChar(svc, UUIDS.FTMS_DATA);
        if(dataChar) dataProtocol = 'FTMS';
      }
      if (!dataChar) {
        const svc = await _safeGetService(UUIDS.CPS_SERVICE);
        dataChar = await _safeGetChar(svc, UUIDS.CPS_DATA);
        if(dataChar) dataProtocol = 'CPS';
      }
      if (!dataChar) {
        const svc = await _safeGetService(UUIDS.CYCLEOPS_SERVICE);
        if (svc) {
          try {
            const chars = await svc.getCharacteristics();
            if (chars.length > 0) { 
              dataChar = chars[0]; 
              dataProtocol = 'CYCLEOPS_LEGACY'; 
            }
          } catch(e) {}
        }
      }
      
      if (!dataChar) throw new Error("데이터 전송 서비스를 찾을 수 없습니다.");
      
      await dataChar.startNotifications();
      const trainerHandler = typeof handleTrainerData === 'function' ? handleTrainerData : (typeof window.handleTrainerData === 'function' ? window.handleTrainerData : null);
      const powerHandler = typeof handlePowerMeterData === 'function' ? handlePowerMeterData : (typeof window.handlePowerMeterData === 'function' ? window.handlePowerMeterData : null);
      const parser = (dataProtocol === 'FTMS') ? (trainerHandler || (() => {})) : (powerHandler || (() => {})); 
      if (parser) {
        dataChar.addEventListener("characteristicvaluechanged", parser);
      }
      
      let controlChar = null;
      let controlProtocol = 'NONE';
      
      if (!controlChar) {
        const svc = await _safeGetService(UUIDS.FTMS_SERVICE);
        controlChar = await _safeGetChar(svc, UUIDS.FTMS_CONTROL);
        if(controlChar) controlProtocol = 'FTMS';
      }
      if (!controlChar) {
        const svc = await _safeGetService(UUIDS.CYCLEOPS_SERVICE);
        controlChar = await _safeGetChar(svc, UUIDS.CYCLEOPS_CONTROL);
        if(controlChar) controlProtocol = 'CYCLEOPS';
      }
      if (!controlChar) {
        const svc = await _safeGetService(UUIDS.WAHOO_SERVICE);
        controlChar = await _safeGetChar(svc, UUIDS.WAHOO_CONTROL);
        if(controlChar) controlProtocol = 'WAHOO';
      }
      
      const saved = (typeof loadSavedDevices === 'function' ? loadSavedDevices() : window.loadSavedDevices ? window.loadSavedDevices() : []).find(d => d.deviceId === deviceId && d.deviceType === 'trainer');
      
      window.connectedDevices.trainer = { 
        name: device.name || saved?.name || '알 수 없는 기기', 
        device, 
        server, 
        characteristic: dataChar, 
        controlPoint: controlChar,
        protocol: controlProtocol, 
        dataProtocol: dataProtocol, 
        realProtocol: controlProtocol
      };
      
      window.isSensorConnected = true;
      try { 
        window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { 
          detail: { connected: true, deviceType: 'trainer' } 
        })); 
      } catch (e) {}
      
      const disconnectHandler = typeof handleDisconnect === 'function' ? handleDisconnect : (typeof window.handleDisconnect === 'function' ? window.handleDisconnect : null);
      if (disconnectHandler) {
        device.addEventListener("gattserverdisconnected", () => disconnectHandler('trainer', device));
      }
      
      if (saved && (typeof saveDevice === 'function' || typeof window.saveDevice === 'function')) {
        const saveFn = typeof saveDevice === 'function' ? saveDevice : window.saveDevice;
        saveFn(deviceId, device.name || saved.name, 'trainer', saved.nickname);
      }
      
      if (typeof updateDevicesList === 'function') updateDevicesList();
      if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
      
      let statusMsg = `✅ ${saved?.nickname || device.name || '알 수 없는 기기'} 연결됨 [${dataProtocol}]`;
      if (controlChar) statusMsg += `\n⚡ ERG 제어 가능 [${controlProtocol}]`;
      else statusMsg += `\n⚠️ 파워미터 모드 (제어 불가)`;
      if (typeof showToast === 'function') showToast(statusMsg);
      
      if (window.ergController) setTimeout(() => window.ergController.initializeTrainer(), 500);
      
    } else if (deviceType === 'powerMeter') {
      // 파워미터 연결 로직
      const UUIDS = {
        CPS_SERVICE: '00001818-0000-1000-8000-00805f9b34fb',
        CPS_DATA: '00002a63-0000-1000-8000-00805f9b34fb',
        CSC_SERVICE: '00001816-0000-1000-8000-00805f9b34fb',
      };
      
      let service, characteristic;
      try {
        service = await server.getPrimaryService(UUIDS.CPS_SERVICE);
        characteristic = await service.getCharacteristic(UUIDS.CPS_DATA);
      } catch (e) {
        service = await server.getPrimaryService(UUIDS.CSC_SERVICE);
        characteristic = await service.getCharacteristic(0x2A5B);
      }
      
      await characteristic.startNotifications();
      const powerHandler = typeof handlePowerMeterData === 'function' ? handlePowerMeterData : (typeof window.handlePowerMeterData === 'function' ? window.handlePowerMeterData : null);
      if (powerHandler) {
        characteristic.addEventListener("characteristicvaluechanged", powerHandler);
      }
      
      const saved = (typeof loadSavedDevices === 'function' ? loadSavedDevices() : window.loadSavedDevices ? window.loadSavedDevices() : []).find(d => d.deviceId === deviceId && d.deviceType === 'powerMeter');
      
      window.connectedDevices.powerMeter = { 
        name: device.name || saved?.name || '알 수 없는 기기', 
        device, 
        server, 
        characteristic 
      };
      
      window.isSensorConnected = true;
      try { 
        window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { 
          detail: { connected: true, deviceType: 'powerMeter' } 
        })); 
      } catch (e) {}
      
      const disconnectHandler = typeof handleDisconnect === 'function' ? handleDisconnect : (typeof window.handleDisconnect === 'function' ? window.handleDisconnect : null);
      if (disconnectHandler) {
        device.addEventListener("gattserverdisconnected", () => disconnectHandler('powerMeter', device));
      }
      
      if (saved && (typeof saveDevice === 'function' || typeof window.saveDevice === 'function')) {
        const saveFn = typeof saveDevice === 'function' ? saveDevice : window.saveDevice;
        saveFn(deviceId, device.name || saved.name, 'powerMeter', saved.nickname);
      }
      
      if (typeof updateDevicesList === 'function') updateDevicesList();
      if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
      if (typeof showToast === 'function') {
        showToast(`✅ ${saved?.nickname || device.name || '알 수 없는 기기'} 연결 성공`);
      }
    } else if (deviceType === 'speed') {
      const CSC_SERVICE = '00001816-0000-1000-8000-00805f9b34fb';
      const service = await server.getPrimaryService(CSC_SERVICE);
      const characteristic = await service.getCharacteristic(0x2A5B);
      await characteristic.startNotifications();
      const speedHandler = typeof handleSpeedSensorData === 'function' ? handleSpeedSensorData : (typeof window.handleSpeedSensorData === 'function' ? window.handleSpeedSensorData : null);
      if (speedHandler) {
        characteristic.addEventListener('characteristicvaluechanged', speedHandler);
      }
      const saved = (typeof loadSavedDevices === 'function' ? loadSavedDevices() : window.loadSavedDevices ? window.loadSavedDevices() : []).find(d => d.deviceId === deviceId && d.deviceType === 'speed');
      window.connectedDevices.speed = { name: device.name || saved?.name || '알 수 없는 기기', device, server, characteristic };
      window.isSensorConnected = true;
      try { window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: true, deviceType: 'speed' } })); } catch (e) {}
      const disconnectHandler = typeof handleDisconnect === 'function' ? handleDisconnect : (typeof window.handleDisconnect === 'function' ? window.handleDisconnect : null);
      if (disconnectHandler) device.addEventListener('gattserverdisconnected', () => disconnectHandler('speed', device));
      if (saved && (typeof saveDevice === 'function' || typeof window.saveDevice === 'function')) {
        const saveFn = typeof saveDevice === 'function' ? saveDevice : window.saveDevice;
        saveFn(deviceId, device.name || saved.name, 'speed', saved.nickname);
      }
      if (typeof updateDevicesList === 'function') updateDevicesList();
      if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
      if (typeof showToast === 'function') showToast(`✅ ${saved?.nickname || device.name || '알 수 없는 기기'} 연결 성공`);
    }
    
    // 연결 성공 후 상태 업데이트
    setTimeout(() => {
      updateMobileBluetoothConnectionStatus();
    }, 200);
    
  } catch (error) {
    console.error('[Mobile Dashboard] 저장된 기기 재연결 실패:', error);
    if (typeof showConnectionStatus === 'function') showConnectionStatus(false);
    
    // 재연결 실패 시 사용자에게 알리고 새 기기 검색 제안
    const errorMessage = error.message || '알 수 없는 오류';
    if (typeof showToast === 'function') {
      showToast(`저장된 기기를 찾을 수 없습니다.\n기기가 켜져 있고 범위 내에 있는지 확인하세요.\n\n새 기기 검색을 시도합니다...`);
    }
    
    // 자동으로 새 기기 검색으로 폴백
    try {
      const connectFunction = deviceType === 'trainer' ? window.connectTrainer 
        : deviceType === 'heartRate' ? window.connectHeartRate 
        : deviceType === 'powerMeter' ? window.connectPowerMeter 
        : deviceType === 'speed' ? window.connectSpeedometer 
        : null;
      
      if (connectFunction && typeof connectFunction === 'function') {
        console.log('[Mobile Dashboard] 새 기기 검색으로 폴백:', deviceType);
        await connectFunction();
        // 연결 성공 시 stelvio-bluetooth-connected로 즉시 UI 갱신
        return;
      }
    } catch (fallbackError) {
      console.error('[Mobile Dashboard] 새 기기 검색도 실패:', fallbackError);
      if (typeof showToast === 'function') {
        showToast('기기 연결에 실패했습니다: ' + (fallbackError.message || '알 수 없는 오류'));
      }
    }
  }
}

async function connectMobileBluetoothDevice(deviceType, savedDeviceId) {
  var mobileDropdown = document.getElementById('mobileBluetoothDropdown');
  var trainingDropdown = document.getElementById('trainingScreenBluetoothDropdown');
  if (mobileDropdown) mobileDropdown.classList.remove('show');
  if (trainingDropdown) trainingDropdown.classList.remove('show');
  document.removeEventListener('click', closeBluetoothDropdownOnOutsideClick);
  
  // 저장된 기기 ID가 제공된 경우 재연결 시도
  if (savedDeviceId) {
    await connectMobileBluetoothDeviceToSaved(savedDeviceId, deviceType);
    return;
  }
  
  // 연결 함수가 있는지 확인
  let connectFunction;
  switch (deviceType) {
    case 'trainer':
      connectFunction = window.connectTrainer;
      break;
    case 'heartRate':
      connectFunction = window.connectHeartRate;
      break;
    case 'powerMeter':
      connectFunction = window.connectPowerMeter;
      break;
    case 'speed':
      connectFunction = window.connectSpeedometer;
      break;
    default:
      console.error('[Mobile Dashboard] 알 수 없는 디바이스 타입:', deviceType);
      return;
  }
  
  if (!connectFunction || typeof connectFunction !== 'function') {
    await new Promise(function (r) { setTimeout(r, 300); });
    connectFunction = deviceType === 'trainer' ? window.connectTrainer : deviceType === 'heartRate' ? window.connectHeartRate : deviceType === 'powerMeter' ? window.connectPowerMeter : deviceType === 'speed' ? window.connectSpeedometer : null;
  }
  if (!connectFunction || typeof connectFunction !== 'function') {
    console.error('[Mobile Dashboard] 블루투스 연결 함수를 찾을 수 없습니다:', deviceType);
    if (typeof showToast === 'function') {
      showToast('블루투스 연결 기능이 로드되지 않았습니다. 페이지를 새로고침해 주세요.');
    } else {
      alert('블루투스 연결 기능이 로드되지 않았습니다. 페이지를 새로고침해 주세요.');
    }
    return;
  }

  try {
    console.log('[Mobile Dashboard] 블루투스 디바이스 연결 시도 (신규 검색):', deviceType);
    await connectFunction(true);
    // 연결 성공 시 UI 갱신은 bluetooth.js에서 stelvio-bluetooth-connected 이벤트로 즉시 호출됨 (setTimeout 없음)
  } catch (error) {
    console.error('[Mobile Dashboard] 블루투스 디바이스 연결 실패:', deviceType, error);
    // 에러는 bluetooth.js의 showToast에서 표시됨
  }
}

// 연결 성공 시 대시보드 UI(드롭다운·연결 상태) 즉시 갱신 (bluetooth.js에서 dispatch, setTimeout 없음)
(function initBluetoothConnectedListener() {
  if (typeof window.addEventListener !== 'function') return;
  window.addEventListener('stelvio-bluetooth-connected', function () {
    if (typeof updateMobileBluetoothConnectionStatus === 'function') updateMobileBluetoothConnectionStatus();
  });
})();

// 모바일 개인훈련 대시보드 전용: 신규 디바이스 저장 화면 (bluetooth.js에서 이벤트로만 호출 → 같은 문서/컨텍스트에서 모달 표시 보장)
(function initNewDeviceSaveModalListener() {
  if (typeof window.addEventListener !== 'function') return;
  window.addEventListener('stelvio-show-new-device-save-modal', function (e) {
    var d = e.detail || {};
    var deviceId = d.deviceId;
    var deviceName = (d.deviceName && String(d.deviceName).trim()) || '알 수 없는 기기';
    var deviceType = d.deviceType || 'trainer';
    var overlay = document.createElement('div');
    overlay.id = 'stelvio-new-device-save-modal';
    overlay.setAttribute('aria-label', '신규 디바이스 저장');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:360px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,0.35);';
    var title = document.createElement('p');
    title.textContent = '신규 디바이스 저장';
    title.style.cssText = 'margin:0 0 8px;font-size:18px;font-weight:600;color:#111;';
    var desc = document.createElement('p');
    desc.textContent = '기기 검색 시 사용될 이름으로 저장됩니다. (변경 불가)';
    desc.style.cssText = 'margin:0 0 16px;font-size:13px;color:#666;line-height:1.4;';
    var label = document.createElement('p');
    label.textContent = '저장 디바이스 이름';
    label.style.cssText = 'margin:0 0 6px;font-size:12px;color:#888;';
    var nameDisplay = document.createElement('div');
    nameDisplay.textContent = deviceName;
    nameDisplay.style.cssText = 'padding:12px 14px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:8px;font-size:15px;color:#111;margin-bottom:20px;';
    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    var cancel = document.createElement('button');
    cancel.textContent = '취소';
    cancel.style.cssText = 'padding:10px 18px;border:1px solid #ccc;background:#fff;border-radius:8px;cursor:pointer;font-size:14px;';
    var ok = document.createElement('button');
    ok.textContent = '확인';
    ok.style.cssText = 'padding:10px 18px;border:none;background:#2e74e8;color:#fff;border-radius:8px;cursor:pointer;font-size:14px;';
    function close(doSave) {
      if (overlay.parentNode) overlay.remove();
      if (!doSave) return;
      if (typeof window.saveDevice === 'function') window.saveDevice(deviceId, deviceName, deviceType, deviceName);
      if (typeof showToast === 'function') showToast('✅ ' + deviceName + ' 저장 완료');
      if (typeof updateMobileBluetoothDropdownWithSavedDevices === 'function') updateMobileBluetoothDropdownWithSavedDevices();
      if (typeof updateTrainingScreenBluetoothDropdownWithSavedDevices === 'function') updateTrainingScreenBluetoothDropdownWithSavedDevices();
      if (typeof updateMobileBluetoothConnectionStatus === 'function') updateMobileBluetoothConnectionStatus();
      if (typeof window.updateDevicesList === 'function') window.updateDevicesList();
    }
    cancel.onclick = function () { close(false); };
    ok.onclick = function () { close(true); };
    overlay.onclick = function (ev) { if (ev.target === overlay) close(false); };
    btns.appendChild(cancel);
    btns.appendChild(ok);
    box.appendChild(title);
    box.appendChild(desc);
    box.appendChild(label);
    box.appendChild(nameDisplay);
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
})();

// 블루투스 연결 상태 업데이트 (모바일 대시보드 + 개인 훈련 화면 두 UI 모두 갱신)
// 모바일 대시보드 드롭다운에 저장된 기기 목록 표시 (bluetooth.js 미로드 시 localStorage 직접 사용)
var STELVIO_SAVED_DEVICES_KEY = 'stelvio_saved_devices';

function updateMobileBluetoothDropdownWithSavedDevices() {
  var dropdown = document.getElementById('mobileBluetoothDropdown');
  if (!dropdown) return;

  var getSavedDevicesByTypeFn = typeof getSavedDevicesByType === 'function'
    ? getSavedDevicesByType
    : (typeof window.getSavedDevicesByType === 'function' ? window.getSavedDevicesByType : null);

  if (!getSavedDevicesByTypeFn) {
    getSavedDevicesByTypeFn = function (deviceType) {
      try {
        var stored = localStorage.getItem(STELVIO_SAVED_DEVICES_KEY);
        var all = stored ? JSON.parse(stored) : [];
        return all.filter(function (d) { return String(d.deviceType) === String(deviceType); });
      } catch (e) { return []; }
    };
  }

  var deviceTypes = ['trainer', 'heartRate', 'powerMeter', 'speed'];
  var deviceTypeLabels = {
    trainer: '스마트 트레이너',
    heartRate: '심박계',
    powerMeter: '파워미터',
    speed: '속도계 센서'
  };

  deviceTypes.forEach(function (deviceType) {
    var savedDevices = getSavedDevicesByTypeFn(deviceType);
    if (savedDevices.length === 0) return;
    
    // 기존 아이템 찾기
    let itemId = '';
    switch(deviceType) {
      case 'trainer':
        itemId = 'mobileBluetoothTrainerItem';
        break;
      case 'heartRate':
        itemId = 'mobileBluetoothHRItem';
        break;
      case 'powerMeter':
        itemId = 'mobileBluetoothPMItem';
        break;
      case 'speed':
        itemId = 'mobileBluetoothSpeedItem';
        break;
    }
    
    const mainItem = document.getElementById(itemId);
    if (!mainItem) return;
    
    // 저장된 기기 목록 컨테이너 ID
    const savedListId = `mobileBluetoothSaved${deviceType.charAt(0).toUpperCase() + deviceType.slice(1)}List`;
    
    // 기존 저장된 기기 목록 제거
    const existingList = document.getElementById(savedListId);
    if (existingList) {
      existingList.remove();
    }
    
    // 저장된 기기 목록 컨테이너 (구분선은 디바이스+저장 목록 아래에, 글자는 디바이스 텍스트 시작 위치에 맞춤)
    const savedListContainer = document.createElement('div');
    savedListContainer.id = savedListId;
    savedListContainer.style.cssText = 'padding-top: 4px; margin-top: 4px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 8px; margin-bottom: 8px;';
    
    // 저장된 기기 목록 헤더 (디바이스 글자 시작 위치와 맞춤: 아이콘 24px + gap 10px = 34px)
    const header = document.createElement('div');
    header.style.cssText = 'font-size: 11px; color: #888; padding: 4px 12px 4px 34px; margin-bottom: 4px; text-align: left;';
    header.textContent = `⭐ 저장된 ${deviceTypeLabels[deviceType]}`;
    savedListContainer.appendChild(header);
    
    // 각 저장된 기기 항목 추가 (닉네임(디바이스코드) 왼쪽, 오른쪽 끝에 "삭제" — 블루투스 개인훈련 대시보드와 동일)
    savedDevices.forEach(saved => {
      const savedItem = document.createElement('div');
      savedItem.className = 'mobile-bluetooth-dropdown-item';
      savedItem.style.cssText = 'padding: 8px 12px 8px 34px; font-size: 13px; cursor: pointer; text-align: left; display: flex; align-items: center; justify-content: space-between; gap: 8px;';
      
      const labelWrap = document.createElement('span');
      labelWrap.style.cssText = 'flex: 1; min-width: 0;';
      labelWrap.onclick = (e) => {
        e.stopPropagation();
        console.log('[Mobile Dashboard] 저장된 기기 클릭:', { 
          deviceType, 
          deviceId: saved.deviceId, 
          nickname: saved.nickname,
          name: saved.name 
        });
        connectMobileBluetoothDevice(deviceType, saved.deviceId);
      };
      
      const nickname = document.createElement('span');
      nickname.textContent = saved.nickname || saved.name || '알 수 없는 기기';
      nickname.style.cssText = 'color: #fff;';
      
      const deviceName = document.createElement('span');
      deviceName.textContent = ' (' + (saved.name || '') + ')';
      deviceName.style.cssText = 'color: #888; font-size: 11px;';
      
      labelWrap.appendChild(nickname);
      labelWrap.appendChild(deviceName);
      savedItem.appendChild(labelWrap);
      
      const deleteBtn = document.createElement('span');
      deleteBtn.textContent = '삭제';
      deleteBtn.style.cssText = 'color: #f87171; font-size: 12px; flex-shrink: 0; cursor: pointer;';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if (!confirm('저장된 기기를 목록에서 삭제할까요?')) return;
        var removed = false;
        if (typeof window.removeSavedDevice === 'function') {
          removed = window.removeSavedDevice(saved.deviceId, deviceType);
        }
        if (removed && typeof showToast === 'function') {
          showToast('저장된 기기가 목록에서 삭제되었습니다.');
        }
        if (removed) {
          if (typeof updateMobileBluetoothDropdownWithSavedDevices === 'function') updateMobileBluetoothDropdownWithSavedDevices();
          if (typeof updateTrainingScreenBluetoothDropdownWithSavedDevices === 'function') updateTrainingScreenBluetoothDropdownWithSavedDevices();
        }
      };
      savedItem.appendChild(deleteBtn);
      savedListContainer.appendChild(savedItem);
    });
    
    // 메인 아이템 다음에 삽입
    mainItem.parentNode.insertBefore(savedListContainer, mainItem.nextSibling);
  });
}

// 훈련 화면(trainingScreen) 드롭다운에 저장된 기기 목록 표시 (bluetooth.js 미로드 시 localStorage 직접 사용)
function updateTrainingScreenBluetoothDropdownWithSavedDevices() {
  var dropdown = document.getElementById('trainingScreenBluetoothDropdown');
  if (!dropdown) return;
  var getSavedDevicesByTypeFn = typeof getSavedDevicesByType === 'function' ? getSavedDevicesByType : (typeof window.getSavedDevicesByType === 'function' ? window.getSavedDevicesByType : null);
  if (!getSavedDevicesByTypeFn) {
    getSavedDevicesByTypeFn = function (deviceType) {
      try {
        var stored = localStorage.getItem(STELVIO_SAVED_DEVICES_KEY || 'stelvio_saved_devices');
        var all = stored ? JSON.parse(stored) : [];
        return all.filter(function (d) { return String(d.deviceType) === String(deviceType); });
      } catch (e) { return []; }
    };
  }
  var deviceTypes = ['trainer', 'heartRate', 'powerMeter', 'speed'];
  var deviceTypeLabels = { trainer: '스마트 트레이너', heartRate: '심박계', powerMeter: '파워미터', speed: '속도계 센서' };
  deviceTypes.forEach(function (deviceType) {
    var savedDevices = getSavedDevicesByTypeFn(deviceType);
    if (savedDevices.length === 0) return;
    var itemId = '';
    if (deviceType === 'trainer') itemId = 'trainingScreenBluetoothTrainerItem';
    else if (deviceType === 'heartRate') itemId = 'trainingScreenBluetoothHRItem';
    else if (deviceType === 'powerMeter') itemId = 'trainingScreenBluetoothPMItem';
    else if (deviceType === 'speed') itemId = 'trainingScreenBluetoothSpeedItem';
    var mainItem = document.getElementById(itemId);
    if (!mainItem) return;
    var savedListId = 'trainingScreenBluetoothSaved' + deviceType.charAt(0).toUpperCase() + deviceType.slice(1) + 'List';
    var existingList = document.getElementById(savedListId);
    if (existingList) existingList.remove();
    var savedListContainer = document.createElement('div');
    savedListContainer.id = savedListId;
    savedListContainer.style.cssText = 'padding-top: 4px; margin-top: 4px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 8px; margin-bottom: 8px;';
    var header = document.createElement('div');
    header.style.cssText = 'font-size: 11px; color: #888; padding: 4px 12px 4px 34px; margin-bottom: 4px; text-align: left;';
    header.textContent = '⭐ 저장된 ' + deviceTypeLabels[deviceType];
    savedListContainer.appendChild(header);
    savedDevices.forEach(function (saved) {
      var savedItem = document.createElement('div');
      savedItem.className = 'mobile-bluetooth-dropdown-item';
      savedItem.style.cssText = 'padding: 8px 12px 8px 34px; font-size: 13px; cursor: pointer; text-align: left; display: flex; align-items: center; justify-content: space-between; gap: 8px;';
      var labelWrap = document.createElement('span');
      labelWrap.style.cssText = 'flex: 1; min-width: 0;';
      labelWrap.onclick = function (e) {
        e.stopPropagation();
        connectMobileBluetoothDevice(deviceType, saved.deviceId);
      };
      var nickname = document.createElement('span');
      nickname.textContent = saved.nickname || saved.name || '알 수 없는 기기';
      nickname.style.cssText = 'color: #fff;';
      var deviceName = document.createElement('span');
      deviceName.textContent = ' (' + (saved.name || '') + ')';
      deviceName.style.cssText = 'color: #888; font-size: 11px;';
      labelWrap.appendChild(nickname);
      labelWrap.appendChild(deviceName);
      savedItem.appendChild(labelWrap);
      var deleteBtn = document.createElement('span');
      deleteBtn.textContent = '삭제';
      deleteBtn.style.cssText = 'color: #f87171; font-size: 12px; flex-shrink: 0; cursor: pointer;';
      deleteBtn.onclick = function (e) {
        e.stopPropagation();
        if (!confirm('저장된 기기를 목록에서 삭제할까요?')) return;
        var removed = false;
        if (typeof window.removeSavedDevice === 'function') removed = window.removeSavedDevice(saved.deviceId, deviceType);
        if (removed && typeof showToast === 'function') showToast('저장된 기기가 목록에서 삭제되었습니다.');
        if (removed) {
          if (typeof updateMobileBluetoothDropdownWithSavedDevices === 'function') updateMobileBluetoothDropdownWithSavedDevices();
          if (typeof updateTrainingScreenBluetoothDropdownWithSavedDevices === 'function') updateTrainingScreenBluetoothDropdownWithSavedDevices();
        }
      };
      savedItem.appendChild(deleteBtn);
      savedListContainer.appendChild(savedItem);
    });
    mainItem.parentNode.insertBefore(savedListContainer, mainItem.nextSibling);
  });
}

/**
 * 연결 상태 UI 동기화 (하이브리드: 앱/웹 공통, window.connectedDevices 기준)
 * 적용 화면: 모바일 개인훈련 대시보드, 노트북(태블릿) 훈련 화면 — 동일 연결 버튼/목록 반영
 */
function updateMobileBluetoothConnectionStatus() {
  var hrItem = document.getElementById('mobileBluetoothHRItem');
  var hrStatus = document.getElementById('mobileHeartRateStatus');
  var trainerItem = document.getElementById('mobileBluetoothTrainerItem');
  var trainerStatus = document.getElementById('mobileTrainerStatus');
  var pmItem = document.getElementById('mobileBluetoothPMItem');
  var pmStatus = document.getElementById('mobilePowerMeterStatus');
  var speedItem = document.getElementById('mobileBluetoothSpeedItem');
  var speedStatus = document.getElementById('mobileSpeedStatus');
  var connectBtn = document.getElementById('mobileBluetoothConnectBtn');
  
  // 저장된 기기 목록 업데이트 (모바일 + 훈련 화면 드롭다운 즉시 반영)
  updateMobileBluetoothDropdownWithSavedDevices();
  if (typeof updateTrainingScreenBluetoothDropdownWithSavedDevices === 'function') updateTrainingScreenBluetoothDropdownWithSavedDevices();

  function setStatus(item, statusEl, connected, disconnectKey) {
    if (item) item.classList.toggle('connected', !!connected);
    if (statusEl) {
      var isRecentlyDisconnected = disconnectKey && window._stelvioDisconnectedTypes && window._stelvioDisconnectedTypes[disconnectKey];
      statusEl.textContent = connected ? '연결됨' : (isRecentlyDisconnected ? '연결해제' : '미연결');
      statusEl.style.color = connected ? '#00d4aa' : '#888';
    }
  }

  var hasHr = !!window.connectedDevices?.heartRate;
  var hasTrainer = !!window.connectedDevices?.trainer;
  var hasPm = !!window.connectedDevices?.powerMeter;
  var hasSpeed = !!window.connectedDevices?.speed;

  setStatus(hrItem, hrStatus, hasHr, 'heartRate');
  setStatus(trainerItem, trainerStatus, hasTrainer, 'trainer');
  setStatus(pmItem, pmStatus, hasPm, 'powerMeter');
  setStatus(speedItem, speedStatus, hasSpeed, 'speed');

  var mobileErgMenu = document.getElementById('mobileBluetoothErgMenu');
  if (mobileErgMenu) mobileErgMenu.style.display = hasTrainer ? 'block' : 'none';
  if (window.ergController) {
    window.ergController.updateConnectionStatus(hasTrainer ? 'connected' : 'disconnected');
  }

  if (connectBtn) {
    var any = hasHr || hasTrainer || hasPm || hasSpeed;
    connectBtn.classList.toggle('has-connection', !!any);
    if (!any) connectBtn.classList.remove('erg-mode-active');
  }

  // 개인 훈련 화면 연결 버튼/드롭다운 UI 동기화 (같은 연결 상태 공유)
  var tsHrItem = document.getElementById('trainingScreenBluetoothHRItem');
  var tsHrStatus = document.getElementById('trainingScreenHeartRateStatus');
  var tsTrainerItem = document.getElementById('trainingScreenBluetoothTrainerItem');
  var tsTrainerStatus = document.getElementById('trainingScreenTrainerStatus');
  var tsPmItem = document.getElementById('trainingScreenBluetoothPMItem');
  var tsPmStatus = document.getElementById('trainingScreenPowerMeterStatus');
  var tsSpeedItem = document.getElementById('trainingScreenBluetoothSpeedItem');
  var tsSpeedStatus = document.getElementById('trainingScreenSpeedStatus');
  var tsConnectBtn = document.getElementById('trainingScreenBluetoothConnectBtn');
  var tsErgMenu = document.getElementById('trainingScreenBluetoothErgMenu');
  var tsErgStatus = document.getElementById('trainingScreenBluetoothErgStatus');
  var tsErgToggle = document.getElementById('trainingScreenBluetoothErgToggle');
  var tsErgTarget = document.getElementById('trainingScreenBluetoothErgTargetPower');

  setStatus(tsHrItem, tsHrStatus, hasHr, 'heartRate');
  setStatus(tsTrainerItem, tsTrainerStatus, hasTrainer, 'trainer');
  setStatus(tsPmItem, tsPmStatus, hasPm, 'powerMeter');
  setStatus(tsSpeedItem, tsSpeedStatus, hasSpeed, 'speed');
  if (tsErgMenu) tsErgMenu.style.display = hasTrainer ? 'block' : 'none';
  if (hasTrainer && window.ergController) {
    if (tsErgToggle) tsErgToggle.checked = window.ergController.state.enabled;
    if (tsErgStatus) {
      tsErgStatus.textContent = window.ergController.state.enabled ? 'ON' : 'OFF';
      tsErgStatus.style.color = window.ergController.state.enabled ? '#00d4aa' : '#888';
    }
    if (tsErgTarget) tsErgTarget.value = Math.round(window.ergController.state.targetPower || 0);
  }
  if (tsConnectBtn) {
    var anyTs = hasHr || hasTrainer || hasPm || hasSpeed;
    tsConnectBtn.classList.toggle('has-connection', !!anyTs);
    if (!anyTs) tsConnectBtn.classList.remove('erg-mode-active');
  }

  var anyConnected = hasHr || hasTrainer || hasPm || hasSpeed;
  if (window.isSensorConnected !== anyConnected) {
    window.isSensorConnected = anyConnected;
    console.log('[Mobile Debug] [BLE] Global Flag SET: isSensorConnected =', anyConnected);
    try {
      window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: anyConnected } }));
    } catch (e) {
      console.warn('[BLE] dispatchEvent stelvio-sensor-update failed:', e);
    }
  }

  updateMobileConnectionButtonColor();

  // 연결 상태 변경 시 시작 버튼 펄스 갱신 (트레이너/파워미터 연결 시에만 펄스 구동)
  if (typeof updateMobileStartPulse === 'function') updateMobileStartPulse();
}

/**
 * 연결 버튼 색상 업데이트 (모바일 + 개인 훈련 화면, ERG 모드 상태에 따라)
 */
function updateMobileConnectionButtonColor() {
  var isTrainerConnected = !!window.connectedDevices?.trainer;
  var isErgModeActive = (window.ergController && window.ergController.state.enabled) ||
    (window.ergModeState && window.ergModeState.enabled);
  var addErg = isTrainerConnected && isErgModeActive;

  var mobileBtn = document.getElementById('mobileBluetoothConnectBtn');
  if (mobileBtn) {
    if (addErg) mobileBtn.classList.add('erg-mode-active');
    else mobileBtn.classList.remove('erg-mode-active');
  }
  var tsBtn = document.getElementById('trainingScreenBluetoothConnectBtn');
  if (tsBtn) {
    if (addErg) tsBtn.classList.add('erg-mode-active');
    else tsBtn.classList.remove('erg-mode-active');
  }
}

/**
 * 모바일 개인 훈련 대시보드 종료 (초기화면으로 이동)
 * 훈련 중이면 종료 전까지의 훈련 로그를 저장한 뒤 종료
 */
function exitMobileIndividualTraining() {
  // 모바일 개인 훈련 대시보드 화면인지 확인 (독립적 구동 보장)
  const mobileScreen = document.getElementById('mobileDashboardScreen');
  const isMobileActive = mobileScreen && 
    (mobileScreen.classList.contains('active') || 
     window.getComputedStyle(mobileScreen).display !== 'none');
  
  if (!isMobileActive) {
    return; // 다른 화면에서는 실행하지 않음
  }
  
  var mobileDropdown = document.getElementById('mobileBluetoothDropdown');
  var trainingDropdown = document.getElementById('trainingScreenBluetoothDropdown');
  if (mobileDropdown) mobileDropdown.classList.remove('show');
  if (trainingDropdown) trainingDropdown.classList.remove('show');
  document.removeEventListener('click', closeBluetoothDropdownOnOutsideClick);

  if (!confirm('초기화면으로 나가시겠습니까?')) {
    return;
  }

  var mts = window.mobileTrainingState;
  var isTrainingRunning = mts && (mts.timerId || mts.running || mts.started);

  function doExit() {
    if (typeof cleanupMobileDashboard === 'function') {
      cleanupMobileDashboard();
    }
    if (typeof showScreen === 'function') {
      showScreen('basecampScreen');
      console.log('[Mobile Dashboard] 초기화면으로 이동');
    } else {
      window.location.href = '#basecampScreen';
    }
  }

  if (isTrainingRunning) {
    // 훈련 중: 타이머 정지 → 경과시간 저장 → 결과 저장 후 종료
    if (mts.timerId) {
      clearInterval(mts.timerId);
      mts.timerId = null;
    }
    if (mts && mts.elapsedSec !== undefined) {
      window.lastElapsedTime = mts.elapsedSec;
      console.log('[Mobile Dashboard] 연결>종료 시 훈련 로그 저장 후 종료, elapsedTime:', window.lastElapsedTime);
    }
    Promise.resolve()
      .then(function () { return window.saveTrainingResultAtEnd?.(); })
      .then(function () {
        if (window.trainingResults && typeof window.trainingResults.initializeResultScreen === 'function') {
          return window.trainingResults.initializeResultScreen();
        }
      })
      .then(doExit)
      .catch(function (err) {
        console.error('[Mobile Dashboard] 종료 시 저장 오류:', err);
        if (typeof showToast === 'function') showToast('훈련 로그 저장 중 오류가 났습니다. 초기화면으로 이동합니다.');
        doExit();
      });
  } else {
    doExit();
  }
}

/**
 * 노트북/태블릿 훈련 화면 종료 → 훈련 준비 화면으로 이동
 * 훈련 중이면 종료 전까지의 훈련 로그를 저장한 뒤 이동
 */
function exitLaptopTrainingToReady() {
  const trainingScreenEl = document.getElementById('trainingScreen');
  const isTrainingScreenActive = trainingScreenEl &&
    (trainingScreenEl.classList.contains('active') ||
     window.getComputedStyle(trainingScreenEl).display !== 'none');

  if (!isTrainingScreenActive) {
    return;
  }

  var trainingDropdown = document.getElementById('trainingScreenBluetoothDropdown');
  if (trainingDropdown) trainingDropdown.classList.remove('show');
  document.removeEventListener('click', closeBluetoothDropdownOnOutsideClick);

  if (!confirm('훈련 준비 화면으로 이동하시겠습니까?')) {
    return;
  }

  var ts = window.trainingState;
  var isTrainingRunning = ts && ts.timerId != null;

  function doExit() {
    if (typeof showScreen === 'function') {
      showScreen('trainingReadyScreen');
      console.log('[Laptop Training] 훈련 준비 화면으로 이동');
    }
  }

  if (isTrainingRunning) {
    if (typeof stopSegmentLoop === 'function') stopSegmentLoop();
    if (ts && ts.elapsedSec !== undefined) {
      window.lastElapsedTime = ts.elapsedSec;
      console.log('[Laptop Training] 연결>종료 시 훈련 로그 저장 후 이동, elapsedTime:', window.lastElapsedTime);
    }
    if (typeof window.laptopTrainingWakeLockControl !== 'undefined' && window.laptopTrainingWakeLockControl.release) {
      window.laptopTrainingWakeLockControl.release();
    }
    Promise.resolve()
      .then(function () {
        return (typeof window.saveLaptopTrainingResultAtEnd === 'function')
          ? window.saveLaptopTrainingResultAtEnd()
          : window.saveTrainingResultAtEnd?.();
      })
      .then(doExit)
      .catch(function (err) {
        console.error('[Laptop Training] 종료 시 저장 오류:', err);
        if (typeof showToast === 'function') showToast('훈련 로그 저장 중 오류가 났습니다. 훈련 준비 화면으로 이동합니다.');
        doExit();
      });
  } else {
    doExit();
  }
}

/**
 * ErgController 초기화 함수 (모바일 대시보드 전용, 독립적 구동)
 */
function initMobileErgController() {
  if (!window.ergController) {
    console.warn('[Mobile Dashboard] ErgController를 찾을 수 없습니다');
    return;
  }

  console.log('[Mobile Dashboard] ErgController 초기화 시작');

  // ERG 상태 구독 (반응형 상태 관리) — 모바일 대시보드 + 개인 훈련 화면 연결 버튼 UI 동기화
  window.ergController.subscribe((state, key, value) => {
    if (key === 'enabled') {
      const ergToggle = document.getElementById('mobileBluetoothErgToggle');
      const ergStatus = document.getElementById('mobileBluetoothErgStatus');
      if (ergToggle) ergToggle.checked = value;
      if (ergStatus) { ergStatus.textContent = value ? 'ON' : 'OFF'; ergStatus.style.color = value ? '#00d4aa' : '#888'; }
      var tsErgToggle = document.getElementById('trainingScreenBluetoothErgToggle');
      var tsErgStatus = document.getElementById('trainingScreenBluetoothErgStatus');
      if (tsErgToggle) tsErgToggle.checked = value;
      if (tsErgStatus) { tsErgStatus.textContent = value ? 'ON' : 'OFF'; tsErgStatus.style.color = value ? '#00d4aa' : '#888'; }
      console.log('[Mobile Dashboard] ERG 모드 상태:', value ? 'ON' : 'OFF');
      updateMobileConnectionButtonColor();
      updateMobileBluetoothConnectionStatus();
    }
    if (key === 'targetPower') {
      const targetPowerInput = document.getElementById('mobileBluetoothErgTargetPower');
      if (targetPowerInput) targetPowerInput.value = Math.round(value);
      var tsTargetInput = document.getElementById('trainingScreenBluetoothErgTargetPower');
      if (tsTargetInput) tsTargetInput.value = Math.round(value);
      if (window.liveData) window.liveData.targetPower = value;
      console.log('[Mobile Dashboard] 목표 파워 변경:', value, 'W');
    }
    if (key === 'fatigueLevel' && value > 70) {
      // 피로도가 높을 때 사용자에게 알림
      console.warn('[Mobile Dashboard] 피로도 감지:', value);
      if (typeof showToast === 'function') {
        showToast(`⚠️ 피로도 감지! ERG 강도를 낮춥니다.`);
      }
    }
  });

  // window.liveData.targetPower 변경 감지 (세그먼트 변경 시 자동 업데이트)
  let lastTargetPower = window.liveData?.targetPower || 0;
  const checkTargetPowerChange = () => {
    const currentTargetPower = window.liveData?.targetPower || 0;
    if (currentTargetPower !== lastTargetPower && currentTargetPower > 0) {
      // 목표 파워가 변경되었고 ERG 모드가 활성화되어 있으면 자동 업데이트
      if (window.ergController.state.enabled) {
        window.ergController.setTargetPower(currentTargetPower).catch(err => {
          console.warn('[Mobile Dashboard] ErgController 목표 파워 자동 업데이트 실패:', err);
        });
      }
      lastTargetPower = currentTargetPower;
    }
  };
  
  // 1초마다 목표 파워 변경 확인
  setInterval(checkTargetPowerChange, 1000);

  // ERG 토글 버튼 이벤트 리스너
  const ergToggle = document.getElementById('mobileBluetoothErgToggle');
  if (ergToggle) {
    // 기존 이벤트 리스너 제거 (중복 방지)
    const newErgToggle = ergToggle.cloneNode(true);
    ergToggle.parentNode.replaceChild(newErgToggle, ergToggle);
    
    newErgToggle.addEventListener('change', async (e) => {
      try {
        await window.ergController.toggleErgMode(e.target.checked);
      } catch (err) {
        console.error('[Mobile Dashboard] ERG 모드 토글 오류:', err);
        if (typeof showToast === 'function') {
          // ErgController에서 던진 구체적인 에러 메시지 표시
          const errorMessage = err.message || '스마트로라 연결을 확인해주세요.';
          showToast(errorMessage);
        }
        e.target.checked = !e.target.checked; // 실패 시 UI 원복
      }
    });
  }

  // 목표 파워 설정 버튼 이벤트 리스너
  const ergSetBtn = document.getElementById('mobileBluetoothErgSetBtn');
  const ergTargetPowerInput = document.getElementById('mobileBluetoothErgTargetPower');
  if (ergSetBtn && ergTargetPowerInput) {
    // 기존 이벤트 리스너 제거 (중복 방지)
    const newErgSetBtn = ergSetBtn.cloneNode(true);
    const newErgTargetPowerInput = ergTargetPowerInput.cloneNode(true);
    ergSetBtn.parentNode.replaceChild(newErgSetBtn, ergSetBtn);
    ergTargetPowerInput.parentNode.replaceChild(newErgTargetPowerInput, ergTargetPowerInput);
    
    newErgSetBtn.addEventListener('click', () => {
      const targetPower = Number(newErgTargetPowerInput.value) || 0;
      if (targetPower > 0) {
        window.ergController.setTargetPower(targetPower).catch(err => {
          console.error('[Mobile Dashboard] 목표 파워 설정 실패:', err);
          if (typeof showToast === 'function') {
            showToast('목표 파워 설정에 실패했습니다.');
          }
        });
        if (typeof showToast === 'function') {
          showToast(`목표 파워 ${targetPower}W로 설정되었습니다.`);
        }
      } else {
        if (typeof showToast === 'function') {
          showToast('유효한 목표 파워를 입력해주세요.');
        }
      }
    });

    // Enter 키로도 설정 가능
    newErgTargetPowerInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        newErgSetBtn.click();
      }
    });
  }

  // 개인 훈련 화면 ERG 토글/설정 버튼 (모바일과 동일 로직, 동일 ergController)
  var tsErgToggle = document.getElementById('trainingScreenBluetoothErgToggle');
  var tsErgSetBtn = document.getElementById('trainingScreenBluetoothErgSetBtn');
  var tsErgTargetPowerInput = document.getElementById('trainingScreenBluetoothErgTargetPower');
  if (tsErgToggle) {
    var newTsErgToggle = tsErgToggle.cloneNode(true);
    tsErgToggle.parentNode.replaceChild(newTsErgToggle, tsErgToggle);
    newTsErgToggle.addEventListener('change', async function (e) {
      try {
        await window.ergController.toggleErgMode(e.target.checked);
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message || '스마트로라 연결을 확인해주세요.');
        e.target.checked = !e.target.checked;
      }
    });
  }
  if (tsErgSetBtn && tsErgTargetPowerInput) {
    var newTsErgSetBtn = tsErgSetBtn.cloneNode(true);
    var newTsErgTargetPowerInput = tsErgTargetPowerInput.cloneNode(true);
    tsErgSetBtn.parentNode.replaceChild(newTsErgSetBtn, tsErgSetBtn);
    tsErgTargetPowerInput.parentNode.replaceChild(newTsErgTargetPowerInput, tsErgTargetPowerInput);
    newTsErgSetBtn.addEventListener('click', function () {
      var targetPower = Number(newTsErgTargetPowerInput.value) || 0;
      if (targetPower > 0) {
        window.ergController.setTargetPower(targetPower).catch(function (err) {
          if (typeof showToast === 'function') showToast('목표 파워 설정에 실패했습니다.');
        });
        if (typeof showToast === 'function') showToast('목표 파워 ' + targetPower + 'W로 설정되었습니다.');
      } else {
        if (typeof showToast === 'function') showToast('유효한 목표 파워를 입력해주세요.');
      }
    });
    newTsErgTargetPowerInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') newTsErgSetBtn.click();
    });
  }

  // 연결 상태 업데이트 (ERG/훈련 로직: 트레이너만. AI Pairing 플래그: any device)
  const isTrainerConnected = window.connectedDevices?.trainer?.controlPoint;
  if (isTrainerConnected) {
    window.ergController.updateConnectionStatus('connected');
  } else {
    window.ergController.updateConnectionStatus('disconnected');
  }
  var anyConnected = !!(window.connectedDevices?.heartRate || window.connectedDevices?.trainer || window.connectedDevices?.powerMeter);
  if (window.isSensorConnected !== anyConnected) {
    window.isSensorConnected = anyConnected;
    console.log('[Mobile Debug] [BLE] Global Flag SET: isSensorConnected =', anyConnected);
    try {
      window.dispatchEvent(new CustomEvent('stelvio-sensor-update', { detail: { connected: anyConnected } }));
    } catch (e) {
      console.warn('[BLE] dispatchEvent stelvio-sensor-update failed:', e);
    }
  }

  // 케이던스 업데이트 (Edge AI 분석용)
  if (window.liveData && window.liveData.cadence) {
    window.ergController.updateCadence(window.liveData.cadence);
  }

  console.log('[Mobile Dashboard] ErgController 초기화 완료');
}

// 전역 함수로 노출 (모바일 + 개인 훈련 화면 공통)
window.toggleBluetoothDropdown = toggleBluetoothDropdown;
window.toggleMobileBluetoothDropdown = toggleMobileBluetoothDropdown;
window.connectMobileBluetoothDevice = connectMobileBluetoothDevice;
window.updateMobileBluetoothConnectionStatus = updateMobileBluetoothConnectionStatus;
window.exitMobileIndividualTraining = exitMobileIndividualTraining;
window.exitLaptopTrainingToReady = exitLaptopTrainingToReady;
window.initMobileErgController = initMobileErgController;
window.updateMobileConnectionButtonColor = updateMobileConnectionButtonColor;

// 모바일 대시보드 초기화는 startMobileDashboard 함수 내부에서 직접 처리됨
// (위의 startMobileDashboard 함수 내부에 이미 추가됨)
// Data Proxy (REQUEST_LOGS, REQUEST_STATUS) → initDashboardLogsProxy에서 처리

/* ==========================================================
   화면 꺼짐 방지 (Wake Lock API)
   iOS (Bluefy) / Android (Google App) 환경 지원
========================================================== */

// Wake Lock 상태 관리
window.wakeLock = {
  wakeLockInstance: null,
  isActive: false,
  
  // 기기 감지
  isIOS: function() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },
  
  isAndroid: function() {
    return /android/i.test(navigator.userAgent);
  },
  
  // Wake Lock 활성화
  request: async function() {
    try {
      // Wake Lock API 지원 확인
      if ('wakeLock' in navigator) {
        this.wakeLockInstance = await navigator.wakeLock.request('screen');
        this.isActive = true;
        console.log('✅ Wake Lock activated (Native API)');
        
        // Wake Lock 해제 이벤트 리스너
        this.wakeLockInstance.addEventListener('release', () => {
          console.log('⚠️ Wake Lock released');
          this.isActive = false;
        });
        
        return true;
      }
      
      // iOS (Bluefy) 환경: NoSleep.js 방식 (비디오 재생)
      if (this.isIOS()) {
        console.log('📱 iOS detected - using NoSleep.js fallback');
        await this.enableNoSleep();
        return true;
      }
      
      // Android (Google App) 환경: 백업 방법
      if (this.isAndroid()) {
        console.log('🤖 Android detected - using visibility API fallback');
        this.enableVisibilityFallback();
        return true;
      }
      
      console.warn('⚠️ Wake Lock not supported on this device');
      return false;
      
    } catch (err) {
      console.error('❌ Wake Lock request failed:', err);
      
      // Fallback: NoSleep.js 방식 시도
      if (this.isIOS() || this.isAndroid()) {
        try {
          await this.enableNoSleep();
          return true;
        } catch (fallbackErr) {
          console.error('❌ NoSleep.js fallback failed:', fallbackErr);
        }
      }
      
      return false;
    }
  },
  
  // Wake Lock 해제
  release: async function() {
    try {
      if (this.wakeLockInstance) {
        await this.wakeLockInstance.release();
        this.wakeLockInstance = null;
        this.isActive = false;
        console.log('✅ Wake Lock released (Native API)');
      }
      
      // NoSleep 비디오 정리
      if (this.noSleepVideo) {
        this.noSleepVideo.pause();
        this.noSleepVideo.remove();
        this.noSleepVideo = null;
        console.log('✅ NoSleep video removed');
      }
      
      // Visibility fallback 정리
      if (this.visibilityHandler) {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
        this.visibilityHandler = null;
        console.log('✅ Visibility handler removed');
      }
      
      this.isActive = false;
      return true;
      
    } catch (err) {
      console.error('❌ Wake Lock release failed:', err);
      return false;
    }
  },
  
  // NoSleep.js 방식 (iOS/Android 폴백)
  noSleepVideo: null,
  enableNoSleep: async function() {
    if (this.noSleepVideo) {
      return; // 이미 활성화됨
    }
    
    // 무음 비디오 생성 (1x1 픽셀, 투명, 무한 루프)
    const video = document.createElement('video');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.style.position = 'fixed';
    video.style.top = '-1px';
    video.style.left = '-1px';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.loop = true;
    
    // 무음 WebM 비디오 데이터 (1초, 무음, 1x1 픽셀)
    video.src = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua7+uvdeBAXPFh4EBY3Jvbm9zBAAAACCsAQAA//////////EqAQAAAbJFh0EEQoWBAhhTgGcB//////////9UaZpZpktq17NDi4EASqxsJ0gCAVEA//////////YEQqxsJ0kCAUEA//////////YEQqxsJ0kCAUEA//////////YEQqxsJ0kCAUEA//////////YEQqxsJ0kCAUEA//////////YEQqxsJ0kCAUEA//////////YEQqxsJ0gCAVEA//////////YEQqxsJ0hGU4BnAf//////////VGmaWaZLatezQ4eBQoKDaWQgAf//////////BWmaWaZLatezQ4dBT8+BFUmpZpkq17EBI4ODQ4ODA4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4PDgQKB4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OPAgSBA===';
    
    document.body.appendChild(video);
    
    try {
      await video.play();
      this.noSleepVideo = video;
      this.isActive = true;
      console.log('✅ NoSleep video activated');
    } catch (err) {
      console.error('❌ NoSleep video play failed:', err);
      video.remove();
      throw err;
    }
  },
  
  // Visibility API 폴백 (Android 웹뷰 환경)
  visibilityHandler: null,
  enableVisibilityFallback: function() {
    if (this.visibilityHandler) {
      return; // 이미 활성화됨
    }
    
    // 페이지가 백그라운드로 가면 자동으로 Wake Lock 재요청
    this.visibilityHandler = async () => {
      if (document.visibilityState === 'visible') {
        console.log('🔄 Page visible - re-requesting Wake Lock');
        if ('wakeLock' in navigator) {
          try {
            this.wakeLockInstance = await navigator.wakeLock.request('screen');
            console.log('✅ Wake Lock re-acquired');
          } catch (err) {
            console.warn('⚠️ Wake Lock re-request failed:', err);
          }
        }
      }
    };
    
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.isActive = true;
    console.log('✅ Visibility fallback enabled');
  }
};

// 모바일 대시보드 시작 시 Wake Lock 활성화
const originalStartMobileDashboard = window.startMobileDashboard;
if (originalStartMobileDashboard) {
  window.startMobileDashboard = async function() {
    // 원래 함수 호출
    const result = originalStartMobileDashboard.apply(this, arguments);
    
    // Wake Lock 활성화
    setTimeout(async () => {
      const activated = await window.wakeLock.request();
      if (activated) {
        console.log('✅ Wake Lock activated for mobile dashboard');
      } else {
        console.warn('⚠️ Wake Lock activation failed for mobile dashboard');
      }
    }, 500);
    
    return result;
  };
}

// cleanupMobileDashboard에서 Wake Lock 해제
const originalCleanupMobileDashboard = window.cleanupMobileDashboard;
if (originalCleanupMobileDashboard) {
  window.cleanupMobileDashboard = async function() {
    // Wake Lock 해제
    await window.wakeLock.release();
    console.log('✅ Wake Lock released for mobile dashboard cleanup');
    
    // 원래 함수 호출
    return originalCleanupMobileDashboard.apply(this, arguments);
  };
}

// 전역으로 노출
window.wakeLock = window.wakeLock;

