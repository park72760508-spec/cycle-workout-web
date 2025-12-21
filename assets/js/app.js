// Updated: 2025-11-16 12:30 (KST) - Change header auto-stamped per edit

/* ==========================================================
   app.js (v1.3 fixed) - 모든 오류 수정이 반영된 통합 버전
========================================================== */

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
  let required = false, quiet = false;

  // 뒤로호환: safeGetElement(id, true/false) 형태 지원
  if (typeof opts === 'boolean') {
    required = !!opts;
  } else if (opts && typeof opts === 'object') {
    required = !!opts.required;
    quiet   = !!opts.quiet;
  }

  const el = document.getElementById(id);

  if (!el) {
    if (required) {
      const msg = `Required element with id '${id}' not found`;
      if (!quiet) console.error(msg);
      throw new Error(msg);
    } else {
      if (!quiet) console.warn(`Element with id '${id}' not found`);
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
}

// [PATCH] 카운트다운 강제 정지도 표시 컨트롤러 사용
function stopSegmentCountdown() {
  console.log('카운트다운 강제 정지');
  CountdownDisplay.hideImmediate();
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
  
  // dual 타입인 경우: target_value가 "100/120" 형식이면 첫 번째 값(ftp%)만 추출
  if (targetType === 'dual') {
    const targetValue = seg.target_value;
    if (targetValue != null) {
      if (Array.isArray(targetValue) && targetValue.length > 0) {
        // 배열 형식: [100, 120]
        return Math.round(Number(targetValue[0]) || 100);
      }
      
      const targetValueStr = String(targetValue).trim();
      if (targetValueStr.includes('/')) {
        // "100/120" 형식: 슬래시로 분리하여 첫 번째 값만 반환
        const parts = targetValueStr.split('/').map(s => s.trim()).filter(s => s.length > 0);
        if (parts.length > 0) {
          const ftpPercent = Number(parts[0]) || 100;
          return Math.round(ftpPercent);
        }
      } else {
        // 슬래시가 없는 경우: 숫자로 저장된 경우일 수 있음
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
            console.error('[getSegmentFtpPercent] dual 타입의 target_value가 잘못된 형식입니다. "100/120" 형식이어야 합니다:', targetValue);
            return 100; // 기본값 반환
          } else if (numValue <= 1000) {
            // 1000 이하는 FTP%로만 간주
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
  
  console.warn('FTP 백분율을 찾을 수 없습니다:', seg);
  return 100; // 기본값
}

// 훈련 지표 상태 (TSS / kcal / NP 근사)
const trainingMetrics = {
  elapsedSec: 0,      // 전체 경과(초)
  joules: 0,          // 누적 일(줄). 1초마다 W(=J/s)를 더해줌
  ra30: 0,            // 30초 롤링 평균 파워(근사: 1차 IIR)
  np4sum: 0,          // (ra30^4)의 누적 합
  count: 0            // 표본 개수(초 단위)
};

// 전역으로 노출 (resultManager.js에서 TSS 계산 시 사용)
window.trainingMetrics = trainingMetrics;

// 훈련화면의 건너뛰기에서 활용 >>> 새 세그먼트의 누적 시작 시각(초) 구하기
function getCumulativeStartSec(index) {
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

// Beep 사운드 (Web Audio)
let __beepCtx = null;

// 오디오 컨텍스트 초기화 함수 개선
async function ensureBeepContext() {
  try {
    if (!window.AudioContext && !window.webkitAudioContext) {
      console.warn('Web Audio API not supported');
      return false;
    }

    if (!__beepCtx) {
      __beepCtx = new (window.AudioContext || window.webkitAudioContext)();
      console.log('New audio context created');
    }
    
    if (__beepCtx.state === "suspended") {
      await __beepCtx.resume();
      console.log('Audio context resumed');
    }
    
    return __beepCtx.state === "running";
    
  } catch (error) {
    console.error('Audio context initialization failed:', error);
    __beepCtx = null;
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

    const osc = __beepCtx.createOscillator();
    const gain = __beepCtx.createGain();
    
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;

    osc.connect(gain);
    gain.connect(__beepCtx.destination);

    const now = __beepCtx.currentTime;
    
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
      // cadence_rpm 타입: 세그먼트 평균 파워 (세그먼트 평균 RPM)
      if (elAvg) elAvg.textContent = String(curAvgPower);
      if (elAvgUnit) elAvgUnit.textContent = "W";
      if (elAvgRpmSection) {
        elAvgRpmSection.style.display = "inline";
        if (elAvgRpmValue) elAvgRpmValue.textContent = String(curAvgCadence);
      }
    } else if (targetType === 'dual') {
      // dual 타입: 세그먼트 평균 파워 (세그먼트 평균 RPM)
      if (elAvg) elAvg.textContent = String(curAvgPower);
      if (elAvgUnit) elAvgUnit.textContent = "W";
      if (elAvgRpmSection) {
        elAvgRpmSection.style.display = "inline";
        if (elAvgRpmValue) elAvgRpmValue.textContent = String(curAvgCadence);
      }
    } else {
      // ftp_pct 타입 (기본): 세그먼트 평균 파워만 표시
      if (elAvg) elAvg.textContent = String(curAvgPower);
      if (elAvgUnit) elAvgUnit.textContent = "W";
      if (elAvgRpmSection) elAvgRpmSection.style.display = "none";
    }
  }
}

// 2. 훈련 상태 객체 통일 (window.trainingState 사용)
window.trainingState = window.trainingState || {
  timerId: null,
  paused: false,
  elapsedSec: 0,
  segIndex: 0,
  segElapsedSec: 0,
  segEnds: [],
  totalSec: 0
};

// 훈련 상태 => 시간/세그먼트 UI 갱신 함수
// 수정된 updateTimeUI 함수 (다음 세그먼트 부분만)
function updateTimeUI() {
  try {
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
      safeSetText("segmentProgress", String(sp));
      //safeSetText("segmentProgressLegend", String(sp)); // ← 범례에도 동일 % 표시
      safeSetText("segmentProgressLegend", String(totalPct)); // ✅ 전체 %로 변경
       
      updateMascotProgress(totalPct);          // ⭐ 라이더(GIF) 위치 동기화 (0~100%)
       
       
     // ⬇⬇⬇ 여기에 "이 한 줄" 추가 ⬇⬇⬇
     setNameProgress(segElapsed / segDur);
       
    }
    
  } catch (error) {
    console.error('Error in updateTimeUI:', error);
  }
}

// 훈련 상태 ==> 세그먼트 전환 + 타겟파워 갱신 
function applySegmentTarget(i) {
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
      const targetRpm = Number(targetValue) || 0;
      parsedTargetRpm = targetRpm;
      
      if (targetLabelEl) targetLabelEl.textContent = "목표 RPM";
      if (targetValueEl) targetValueEl.textContent = String(targetRpm);
      if (targetUnitEl) targetUnitEl.textContent = "rpm";
      if (targetRpmSectionEl) targetRpmSectionEl.style.display = "none";
      
      // 목표 파워는 계산하지 않음 (RPM만 표시)
      window.liveData.targetPower = 0;
      window.liveData.targetRpm = targetRpm;
      
    } else if (targetType === 'dual') {
      // dual 타입: target_value는 "100/120" 형식 (앞값: ftp%, 뒤값: rpm) 또는 배열 [ftp%, rpm]
      let ftpPercent = 100;
      let targetRpm = 0;
      
      // target_value를 문자열로 변환하여 처리
      let targetValueStr = '';
      console.log('[dual] 원본 target_value:', targetValue, '타입:', typeof targetValue);
      
      if (targetValue == null || targetValue === '') {
        targetValueStr = '';
        console.warn('[dual] target_value가 null이거나 빈 문자열입니다');
      } else if (Array.isArray(targetValue)) {
        // 배열 형식: [100, 120]
        console.log('[dual] 배열 형식으로 파싱:', targetValue);
        ftpPercent = Number(targetValue[0]) || 100;
        targetRpm = Number(targetValue[1]) || 0;
        targetValueStr = `${targetValue[0]}/${targetValue[1]}`;
      } else {
        // 숫자 또는 문자열로 변환
        targetValueStr = String(targetValue).trim();
        console.log('[dual] 문자열로 변환된 target_value:', targetValueStr);
      }
      
      // 배열이 아닌 경우에만 파싱 수행
      if (!Array.isArray(targetValue)) {
        if (targetValueStr.includes('/')) {
          // 문자열 형식: "100/120" (앞값: ftp%, 뒤값: rpm)
          const parts = targetValueStr.split('/').map(s => s.trim()).filter(s => s.length > 0);
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
            console.error('[dual] 슬래시로 분리했지만 parts가 비어있습니다:', parts);
            ftpPercent = 100;
            targetRpm = 0;
          }
        } else if (targetValueStr.length > 0) {
          // 슬래시가 없는 경우: 숫자로 저장된 경우일 수 있음
          // DB에서 "100/120"이 숫자 100120으로 변환된 경우 처리
          console.warn('[dual] target_value에 슬래시가 없습니다. 문자열:', targetValueStr);
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
                console.error('[dual] target_value가 잘못된 형식입니다. "100/120" 형식이어야 합니다. 현재 값:', targetValueStr);
                ftpPercent = 100;
                targetRpm = 0;
              }
            } else if (numValue <= 1000) {
              // 1000 이하의 숫자는 FTP%로만 간주 (RPM은 0)
              console.warn('[dual] target_value에 슬래시가 없습니다. "100/120" 형식이어야 합니다. 현재 값:', targetValueStr);
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
      
      // 최종 검증: 파싱된 값이 올바른지 확인
      if (targetRpm === 0 && targetValueStr.includes('/')) {
        // 슬래시가 있는데 RPM이 0이면 파싱에 문제가 있을 수 있음
        console.error('[dual] 경고: 슬래시가 있는데 RPM이 0입니다. target_value:', targetValue, 'targetValueStr:', targetValueStr);
        // 다시 한 번 파싱 시도
        const parts = targetValueStr.split('/').map(s => s.trim()).filter(s => s.length > 0);
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
      
      // 목표 파워 계산: 첫 번째 값(ftp%)을 사용하여 W로 변환 (RPE 보정 적용)
      // 엘리트/PRO 선수는 별도 워크아웃이 작성되므로 강도 자동 증가 없음
      const basePower = ftp * (ftpPercent / 100);
      const intensityAdjustment = window.trainingIntensityAdjustment || 1.0;
      const targetW = Math.round(basePower * intensityAdjustment);
      
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
      
      // RPM 표시: 두 번째 값(rpm)을 아랫줄에 표시
      if (targetRpmSectionEl) {
        targetRpmSectionEl.style.display = "block"; // block으로 설정하여 아랫줄에 표시
        if (targetRpmValueEl) {
          targetRpmValueEl.textContent = String(targetRpm);
          console.log('[dual] 목표 RPM 표시:', targetRpm, 'rpm');
        } else {
          console.error('[dual] targetRpmValueEl을 찾을 수 없습니다');
        }
      } else {
        console.error('[dual] targetRpmSectionEl을 찾을 수 없습니다');
      }
      
      // liveData에 저장
      window.liveData.targetPower = targetW;
      window.liveData.targetRpm = targetRpm;
      
      console.log('[dual] 최종 설정 - targetPower:', targetW, 'W, targetRpm:', targetRpm, 'rpm');
      
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
    
    safeSetText("segmentProgress", "0");
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
  updateTimeUI();
  
  // 세그먼트 바 초기화
  if (typeof buildSegmentBar === "function") {
    buildSegmentBar();
  }

  console.log('타이머 시작', '총 시간:', window.trainingState.totalSec, '초');

  // 기존 타이머 정리
  if (window.trainingState.timerId) {
    clearInterval(window.trainingState.timerId);
  }

  // 1초마다 실행되는 메인 루프
  window.trainingState.timerId = setInterval(() => {
    if (window.trainingState.paused) {
      return; // 일시정지 중이면 스킵
    }

   // === 시간 진행(벽시계 기반) ===
   const ts = window.trainingState;
   const nowMs = Date.now();
   // 일시정지 누적 반영: pauseAccumMs + (일시정지 중이라면 지금까지 경과)
   const pausedMs = ts.pauseAccumMs + (ts.pausedAtMs ? (nowMs - ts.pausedAtMs) : 0);
   // 시작시각/일시정지 보정으로 경과초를 직접 계산
   const newElapsedSec = Math.floor((nowMs - ts.workoutStartMs - pausedMs) / 1000);
   
   // 같은 초에 중복 처리 방지(선택)
   //if (newElapsedSec === ts.elapsedSec) {
     // 같은 초면 UI만 가볍게 유지하고 빠져도 OK
     // updateSegmentBarTick?.();
     //return;
   //}
   ts.elapsedSec = newElapsedSec;
   
   // 현재 세그 경과초 = 전체경과초 - 해당 세그 누적시작초
   const cumStart = getCumulativeStartSec(ts.segIndex);
   ts.segElapsedSec = Math.max(0, ts.elapsedSec - cumStart);
   
   // 이후 로직은 기존과 동일하게 진행 (currentSegIndex/segDur/segRemaining 계산 등)
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
      if (segRemaining > 0) {
        // 다음 세그(마지막이면 null)
        const nextSeg = (currentSegIndex < w.segments.length - 1) ? w.segments[currentSegIndex + 1] : null;
      
        ts._countdownFired = ts._countdownFired || {};   // 세그먼트별 발화 기록
        ts._prevRemainMs   = ts._prevRemainMs   || {};   // 세그먼트별 이전 남은 ms
        const key = String(currentSegIndex);
      
        // 종료 누적초(초 단위 SSOT)와 남은 ms
        const endAtSec      = getCumulativeStartSec(currentSegIndex) + segDur; // 세그 끝나는 '절대 초'
        const remainMsPrev  = ts._prevRemainMs[key] ?? Math.round(segRemaining * 1000); // 바로 직전 남은 ms
        const remainMsNow   = Math.round((endAtSec - ts.elapsedSec) * 1000);           // 현재 남은 ms (초 기반)
      
        // 0초는 살짝 일찍(200ms) 울리기
        const EPS_0_MS = 200;
      
      // === 수정된 코드(세그먼트 종료 6초 부터 카운트다운) ===
      // [PATCH] Edge-Driven 카운트다운: 6초(표시 5) → 1초(표시 0)에서 끝
      function maybeFire(n) {
        const firedMap = ts._countdownFired[key] || {};
        if (firedMap[n]) return;
      
        // 경계: 6→5, 5→4, ..., 2→1 은 (n+1)*1000ms, 1→0 은 1000ms
        const boundary = (n > 0) ? (n + 1) * 1000 : 1000;
        const crossed = (remainMsPrev > boundary && remainMsNow <= boundary);
        if (!crossed) return;
      
        // 오버레이 표시 시작(6초 시점에 "5" 표시)
        if (n === 5 && !segmentCountdownActive && nextSeg) {
          startSegmentCountdown(5, nextSeg); // 오버레이 켜고 5 표시 + 짧은 비프
        } else if (segmentCountdownActive) {
          // 진행 중이면 숫자 업데이트만(내부 타이머 없음)
          CountdownDisplay.render(n);
          if (n > 0) playBeep(880, 120, 0.25);
        }
      
        // 0은 "세그먼트 종료 1초 전"에 표시 + 강조음, 그리고 오버레이 닫기 예약
        if (n === 0) {
          // 강조음 (조금 더 강한 톤)
          playBeep(1500, 700, 0.35, "square");
          // 오버레이는 약간의 여유를 두고 닫기
          CountdownDisplay.finish(800);
          segmentCountdownActive = false;
        }
      
        ts._countdownFired[key] = { ...firedMap, [n]: true };
      }


      
        // 5→0 모두 확인(틱이 건너뛰어도 놓치지 않음)
        maybeFire(5);
        maybeFire(4);
        maybeFire(3);
        maybeFire(2);
        maybeFire(1);
        maybeFire(0);
      
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
   
     // ✅ await 없이 순차 실행(저장 → 초기화 → 요약 → 화면 전환)
     Promise.resolve()
       .then(() => window.saveTrainingResultAtEnd?.())
       .catch((e) => { console.warn('[result] saveTrainingResultAtEnd error', e); })
       .then(() => window.trainingResults?.initializeResultScreen?.())
       .catch((e) => { console.warn('[result] initializeResultScreen error', e); })
       .then(() => { try { window.renderCurrentSessionSummary?.(); } catch (e) { console.warn(e); } })
       .then(() => { if (typeof showScreen === "function") showScreen("trainingJournalScreen"); });
   
     return;
   }




   // 세그먼트 경계 통과 → 다음 세그먼트로 전환
   // 중복 전환 방지를 위해 이전 세그먼트 인덱스를 추적
   const prevSegIndex = ts._lastProcessedSegIndex ?? currentSegIndex;
   if (window.trainingState.segElapsedSec >= segDur && prevSegIndex === currentSegIndex) {
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


 // ★ 자동 종료/수동 종료 공통 저장 지점
  window.saveTrainingResultAtEnd?.();
   
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
      
      // 1) 모든 화면 숨김 (스플래시 화면 제외 및 보호)
      const splashScreen = document.getElementById('splashScreen');
      const isSplashActive = window.isSplashActive || (splashScreen && (splashScreen.classList.contains('active') || window.getComputedStyle(splashScreen).display !== 'none'));
      
      // 스플래시 화면이 활성화되어 있으면 화면 전환 차단
      if (isSplashActive) {
        console.log('⏸️ 스플래시 화면 활성화 중 - 화면 전환 차단');
        return; // 화면 전환 자체를 차단
      }
      
      document.querySelectorAll(".screen").forEach(s => {
        if (s.id !== 'splashScreen') {
        s.style.display = "none";
        s.classList.remove("active");
        }
      });
      
      // 2) 대상 화면만 표시
      const el = safeGetElement(id);
      if (el) {
        el.style.display = "block";
        el.classList.add("active");
        console.log(`Successfully switched to: ${id}`);
        
      // 연결 화면이 표시될 때 버튼 이미지 업데이트 및 ANT+ 버튼 활성화 상태 확인
      if (id === "connectionScreen") {
        if (typeof updateDeviceButtonImages === "function") {
          updateDeviceButtonImages();
        }
        
        // ANT+ 버튼 활성화/비활성화 상태 업데이트
        setTimeout(() => {
          const btnANT = safeGetElement("btnConnectANT");
          if (btnANT) {
            // 현재 사용자 grade 확인
            let viewerGrade = '2'; // 기본값
            try {
              const viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
              const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
              const mergedViewer = Object.assign({}, viewer || {}, authUser || {});
              viewerGrade = String(mergedViewer?.grade || '2');
            } catch (e) {
              console.warn('사용자 grade 확인 실패:', e);
            }
            
            // grade=1 또는 grade=3만 활성화
            const isANTEnabled = (viewerGrade === '1' || viewerGrade === '3');
            
            if (!isANTEnabled) {
              btnANT.disabled = true;
              btnANT.classList.add('is-disabled');
              btnANT.setAttribute('aria-disabled', 'true');
              btnANT.title = 'ANT+ 연결은 관리자 또는 특정 등급 사용자만 사용할 수 있습니다';
              btnANT.style.opacity = '0.5';
              btnANT.style.cursor = 'not-allowed';
            } else {
              btnANT.disabled = false;
              btnANT.classList.remove('is-disabled');
              btnANT.removeAttribute('aria-disabled');
              btnANT.title = 'ANT+ 기기 연결';
              btnANT.style.opacity = '1';
              btnANT.style.cursor = 'pointer';
            }
          }
        }, 100);
        }
      } else {
        console.error(`Screen element '${id}' not found`);
        return;
      }
      
      // 3) 화면별 특별 처리
      if (id === 'workoutScreen' && typeof loadWorkouts === 'function') {
        setTimeout(() => loadWorkouts(), 100);
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
        }, 100);
      }

      // 훈련 준비 화면: 그룹 훈련 카드 상태 업데이트
      if (id === 'trainingReadyScreen') {
        setTimeout(() => {
          if (typeof window.updateGroupTrainingCardStatus === 'function') {
            window.updateGroupTrainingCardStatus();
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





// *** 핵심 수정: updateTrainingDisplay 함수 - currentPower 변수 초기화 문제 해결 ***
window.updateTrainingDisplay = function () {
  // *** 중요: currentPower 변수를 맨 앞에서 정의 ***
  const currentPower = Number(window.liveData?.power ?? 0);
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
    
    // 프로그레스 바는 RPM 기준
    if (bar && targetRpm > 0) {
      const pct = Math.min(100, (currentCadence / targetRpm) * 100);
      bar.style.width = pct + "%";
      if (pct < 80) bar.style.background = "linear-gradient(90deg,#00b7ff,#0072ff)";
      else if (pct < 100) bar.style.background = "linear-gradient(90deg,#3cff4e,#00ff88)";
      else if (pct < 120) bar.style.background = "linear-gradient(90deg,#ffb400,#ff9000)";
      else bar.style.background = "linear-gradient(90deg,#ff4c4c,#ff1a1a)";
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
    
    // 프로그레스 바는 파워 기준
    if (bar) {
      const pct = targetPower > 0 ? Math.min(100, (currentPower / targetPower) * 100) : 0;
      bar.style.width = pct + "%";
      if (pct < 80) bar.style.background = "linear-gradient(90deg,#00b7ff,#0072ff)";
      else if (pct < 100) bar.style.background = "linear-gradient(90deg,#3cff4e,#00ff88)";
      else if (pct < 120) bar.style.background = "linear-gradient(90deg,#ffb400,#ff9000)";
      else bar.style.background = "linear-gradient(90deg,#ff4c4c,#ff1a1a)";
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
    
    // 프로그레스 바는 파워 기준
    if (bar) {
      const pct = targetPower > 0 ? Math.min(100, (currentPower / targetPower) * 100) : 0;
      bar.style.width = pct + "%";
      if (pct < 80) bar.style.background = "linear-gradient(90deg,#00b7ff,#0072ff)";
      else if (pct < 100) bar.style.background = "linear-gradient(90deg,#3cff4e,#00ff88)";
      else if (pct < 120) bar.style.background = "linear-gradient(90deg,#ffb400,#ff9000)";
      else bar.style.background = "linear-gradient(90deg,#ff4c4c,#ff1a1a)";
    }
  }

  // ftp_pct / dual일 때만 목표 파워 텍스트를 덮어쓴다 (cadence_rpm은 RPM 표시를 유지)
  if (t && (targetType === 'ftp_pct' || targetType === 'dual')) {
    t.textContent = String(Math.round(targetPower));
  }

  if (h) {
    h.textContent = Math.round(hr);
    h.classList.remove("hr-zone1","hr-zone2","hr-zone3","hr-zone4","hr-zone5");
    if (hr < 100) h.classList.add("hr-zone1");
    else if (hr < 120) h.classList.add("hr-zone2");
    else if (hr < 140) h.classList.add("hr-zone3");
    else if (hr < 160) h.classList.add("hr-zone4");
    else h.classList.add("hr-zone5");
  }

  // *** 케이던스 표시 개선 ***
   // *** 케이던스 표시 개선 - 0 값도 표시 ***
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


// *** 시작 시 복구 시도 및 오류 처리 강화 ***
function startWorkoutTraining() {

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
  try {
    const box = document.getElementById("userInfo");
    if (!box) return;

    const u = window.currentUser;
    if (!u) {
      box.textContent = "사용자 미선택";
      // 사용자 패널 네온 제거(선택)
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

    // 훈련 목표에 따른 이미지 선택
    const challenge = String(u.challenge || 'Fitness').trim();
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

    // 이미지와 텍스트를 함께 표시
    box.innerHTML = `<img src="assets/img/${challengeImage}" alt="" class="training-user-challenge-icon"> ${cleanName} · FTP ${ftpDisp}W · ${wkgDisp} W/kg`;

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

  // 스플래시 화면 처리 (최우선 실행 - 다른 모든 초기화보다 먼저)
  const splashScreen = document.getElementById("splashScreen");
  const splashVideo = document.getElementById("splashVideo");
  const splashLoaderProgress = document.getElementById("splashLoaderProgress");
  
  // 스플래시 화면이 활성화되어 있으면 다른 초기화 코드 실행 방지
  const isSplashActive = splashScreen && (splashScreen.classList.contains("active") || window.getComputedStyle(splashScreen).display !== "none");
  
  // 스플래시 화면 보호 플래그 (전역)
  window.isSplashActive = isSplashActive || window.isSplashActive;
  
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

  function enableIOSMode() {
    const info = safeGetElement("iosInfo");
    if (info) info.classList.remove("hidden");

    ["btnConnectPM","btnConnectTrainer","btnConnectHR","btnConnectANT"].forEach(id => {
      const el = safeGetElement(id);
      if (el) {
        el.classList.add("is-disabled");
        el.setAttribute("aria-disabled","true");
        el.title = "iOS Safari에서는 블루투스 연결이 지원되지 않습니다";
      }
    });

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
            document.body.style.setProperty('background', '#f6f8fa', 'important');
            
            // 스플래시 화면의 모든 자식 요소도 숨기기 (!important 사용)
            const splashContainer = document.querySelector('.splash-container');
            if (splashContainer) {
              splashContainer.style.setProperty('display', 'none', 'important');
              splashContainer.style.setProperty('opacity', '0', 'important');
              splashContainer.style.setProperty('visibility', 'hidden', 'important');
            }
            
            // body 배경색 원복 (원래 배경색으로 복원)
            document.body.style.setProperty('background', '#f6f8fa', 'important');
          
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
    document.body.style.setProperty('background', '#f6f8fa', 'important');
    
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

  // 훈련 준비 → 훈련 시작
  const btnStartTraining = safeGetElement("btnStartTraining");
  if (btnStartTraining) {
    btnStartTraining.addEventListener("click", () => startWithCountdown(5));
  }

  // 그룹 훈련 버튼 이벤트 핸들러 추가
  const btnGroupTraining = safeGetElement("btnGroupTraining");
  if (btnGroupTraining) {
    btnGroupTraining.addEventListener("click", async () => {
      // 버튼 눌림 효과
      try {
        btnGroupTraining.style.transition = 'transform 0.15s ease';
        btnGroupTraining.style.transform = 'scale(0.96)';
        setTimeout(() => {
          btnGroupTraining.style.transform = 'scale(1)';
        }, 160);
      } catch (_) {}

      // 접속중 스피너 표시
      let spinner;
      try {
        // 이미 스피너가 없는 경우에만 추가
        if (!btnGroupTraining.querySelector('.btn-inline-spinner')) {
          spinner = document.createElement('span');
          spinner.className = 'btn-inline-spinner';
          spinner.setAttribute('aria-hidden', 'true');
          spinner.style.display = 'inline-block';
          spinner.style.width = '16px';
          spinner.style.height = '16px';
          spinner.style.marginLeft = '8px';
          spinner.style.border = '2px solid rgba(255,255,255,0.35)';
          spinner.style.borderTopColor = '#fff';
          spinner.style.borderRadius = '50%';
          spinner.style.verticalAlign = 'middle';
          spinner.style.animation = 'spinBtn 0.8s linear infinite';

          // 키프레임 주입(중복 방지)
          if (!document.getElementById('btnSpinnerKeyframes')) {
            const style = document.createElement('style');
            style.id = 'btnSpinnerKeyframes';
            style.textContent = '@keyframes spinBtn { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
          }

          btnGroupTraining.appendChild(spinner);
        }
        // 중복 클릭 방지
        btnGroupTraining.disabled = true;
        btnGroupTraining.style.pointerEvents = 'none';
        btnGroupTraining.dataset.loading = 'true';
      } catch (_) {}

      console.log('Group training button clicked');
      try {
        if (typeof selectTrainingMode === 'function') {
          await selectTrainingMode('group');
        } else {
          console.warn('selectTrainingMode function not found');
          showToast('그룹 훈련 기능을 찾을 수 없습니다', 'error');
        }
      } finally {
        // 접속 완료/실패 시 스피너 제거 및 버튼 복구
        try {
          const sp = btnGroupTraining.querySelector('.btn-inline-spinner');
          if (sp) sp.remove();
          btnGroupTraining.disabled = false;
          btnGroupTraining.style.pointerEvents = '';
          delete btnGroupTraining.dataset.loading;
        } catch (_) {}
      }
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

  // 훈련 준비 → 이전 화면으로 이동
  const btnBackToWorkouts = safeGetElement("btnBackToWorkouts");
  if (btnBackToWorkouts) {
    btnBackToWorkouts.addEventListener("click", () => {
      goBackToPreviousScreen();
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
      return;
    }

    // 카드 렌더 (이름, FTP, W/kg 포함)
    box.innerHTML = list.map((u) => {
      const name = (u?.name ?? "").toString();
      const ftp  = Number(u?.ftp);
      const wt   = Number(u?.weight);
      const wkg  = (Number.isFinite(ftp) && Number.isFinite(wt) && wt > 0)
        ? (ftp / wt).toFixed(2)
        : "-";

      return `
        <div class="user-card" data-id="${u.id}">
          <div class="user-name"><img src="assets/img/add-user3.gif" alt="" class="user-name-icon"> ${name}</div>
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
  
  // ANT+ 버튼 활성화/비활성화 (grade=1 또는 grade=3만 활성화)
  if (btnANT) {
    // 현재 사용자 grade 확인
    let viewerGrade = '2'; // 기본값
    try {
      const viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
      const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
      const mergedViewer = Object.assign({}, viewer || {}, authUser || {});
      viewerGrade = String(mergedViewer?.grade || '2');
    } catch (e) {
      console.warn('사용자 grade 확인 실패:', e);
    }
    
    // grade=1 또는 grade=3만 활성화
    const isANTEnabled = (viewerGrade === '1' || viewerGrade === '3');
    
    if (!isANTEnabled) {
      btnANT.disabled = true;
      btnANT.classList.add('is-disabled');
      btnANT.setAttribute('aria-disabled', 'true');
      btnANT.title = 'ANT+ 연결은 관리자 또는 특정 등급 사용자만 사용할 수 있습니다';
      btnANT.style.opacity = '0.5';
      btnANT.style.cursor = 'not-allowed';
    } else {
      btnANT.disabled = false;
      btnANT.classList.remove('is-disabled');
      btnANT.removeAttribute('aria-disabled');
      btnANT.title = 'ANT+ 기기 연결';
      btnANT.style.opacity = '1';
      btnANT.style.cursor = 'pointer';
    }
  }
  
  // 심박계 버튼
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
        await window.connectHeartRate();
      } catch (err) {
        console.error("HR connection error:", err);
      } finally {
        btnHR.disabled = false;
      }
    });
  }
  
  // 트레이너 버튼
  if (btnTrainer) {
    btnTrainer.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("Trainer button clicked!");
      if (window.connectTrainer) {
        await window.connectTrainer();
      }
    });
  }
  
  // 파워미터 버튼
  if (btnPM) {
    btnPM.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("PM button clicked!");
      if (window.connectPowerMeter) {
        await window.connectPowerMeter();
      }
    });
  }
  
  // ANT+ 버튼
  if (btnANT) {
    btnANT.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("ANT+ button clicked!");
      
      // grade 체크 (추가 보안)
      let viewerGrade = '2';
      try {
        const viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
        const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
        const mergedViewer = Object.assign({}, viewer || {}, authUser || {});
        viewerGrade = String(mergedViewer?.grade || '2');
      } catch (e) {
        console.warn('사용자 grade 확인 실패:', e);
      }
      
      if (viewerGrade !== '1' && viewerGrade !== '3') {
        if (typeof showToast === "function") {
          showToast("ANT+ 연결은 관리자 또는 특정 등급 사용자만 사용할 수 있습니다.");
        }
        return;
      }
      
      if (window.connectANT) {
        await window.connectANT();
      } else {
        console.warn("connectANT function not found!");
        if (typeof showToast === "function") {
          showToast("ANT+ 연결 함수를 찾을 수 없습니다.");
        }
      }
    });
  }

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

  // 훈련 종료
   // 훈련 종료 (확인 후 종료)
   const btnStopTraining = safeGetElement("btnStopTraining");
   if (btnStopTraining) {
     btnStopTraining.addEventListener("click", () => {
       const ok = window.confirm("정말 종료하시겠습니까?\n진행 중인 훈련이 종료됩니다.");
       if (!ok) return;
   
       // 확인: 종료 처리
       stopSegmentLoop();
   
       // ✅ await 없이 순차 실행(저장 → 초기화 → 요약 → 화면 전환)
         // ✅ 강화된 결과 처리 파이프라인 (절대 실패하지 않음)
              Promise.resolve()
                .then(() => {
                  console.log('[훈련완료] 🚀 1단계: 결과 저장 시작');
                  return window.saveTrainingResultAtEnd?.();
                })
                .then((saveResult) => {
                  console.log('[훈련완료] ✅ 1단계 완료:', saveResult);
                  
                  // 저장 결과 확인 및 알림
                  if (saveResult?.saveResult?.source === 'local') {
                    console.log('[훈련완료] 📱 로컬 저장 모드 - CORS 오류로 서버 저장 실패');
                    if (typeof showToast === "function") {
                      showToast("훈련 결과가 기기에 저장되었습니다 (서버 연결 불가)", "warning");
                    }
                  } else if (saveResult?.saveResult?.source === 'gas') {
                    console.log('[훈련완료] 🌐 서버 저장 성공');
                    if (typeof showToast === "function") {
                      showToast("훈련 결과가 서버에 저장되었습니다");
                    }
                  }
                  
                  console.log('[훈련완료] 🔧 2단계: 결과 화면 초기화 시작');
                  return window.trainingResults?.initializeResultScreen?.().catch(e => {
                    console.warn('[훈련완료] 초기화 실패 (무시하고 계속):', e);
                    return Promise.resolve();
                  });
                })
                .then(() => {
                  console.log('[훈련완료] 📊 3단계: 세션 요약 렌더링 시작');
                  
                  // 여러 번 시도해서라도 결과 렌더링
                  let renderSuccess = false;
                  for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                      window.renderCurrentSessionSummary?.();
                      console.log(`[훈련완료] ✅ 렌더링 성공 (${attempt}번째 시도)`);
                      renderSuccess = true;
                      break;
                    } catch (e) {
                      console.warn(`[훈련완료] ❌ 렌더링 실패 ${attempt}/3:`, e.message);
                      if (attempt < 3) {
                        // 재시도 전 잠시 대기
                        setTimeout(() => {}, 100);
                      }
                    }
                  }
                  
                  if (!renderSuccess) {
                    console.error('[훈련완료] 🚨 모든 렌더링 시도 실패 - 기본 데이터라도 표시');
                    // 최소한의 데이터라도 표시하도록 강제 설정
                    try {
                      document.getElementById('finalAchievement').textContent = '완료';
                      document.getElementById('resultAvgPower').textContent = '데이터 처리 중';
                    } catch (_) {}
                  }
                })
                .then(() => {
                  console.log('[훈련완료] 🎯 4단계: 훈련일지 화면으로 전환');
                  
                  // 화면 전환 전 추가 검증
                  const hasSession = !!window.trainingResults?.getCurrentSessionData?.();
                  console.log('[훈련완료] 세션 데이터 존재:', hasSession);
                  
                  if (typeof showScreen === "function") {
                    showScreen("trainingJournalScreen");
                    console.log('[훈련완료] 🎉 훈련일지 화면 전환 완료');
                  } else {
                    console.error('[훈련완료] showScreen 함수를 찾을 수 없습니다');
                  }
                })
                .catch((criticalError) => {
                  console.error('[훈련완료] 💥 치명적 오류 발생:', criticalError);
                  
                  // 그래도 훈련일지 화면으로 이동 시도
                  try {
                    if (typeof showToast === "function") {
                      showToast("오류가 발생했지만 훈련일지를 표시합니다", "error");
                    }
                    if (typeof showScreen === "function") {
                      showScreen("trainingJournalScreen");
                    }
                  } catch (finalError) {
                    console.error('[훈련완료] 🔥 최종 복구도 실패:', finalError);
                    alert('훈련일지 화면 표시 중 오류가 발생했습니다. 페이지를 새로고침해주세요.');
                  }
                });
     });
   }




  console.log("App initialization complete!");

  if (isIOS()) enableIOSMode();
});

// 프로필 화면 이동 & 목록 로드: 단일 핸들러(안전)
(() => {
  const btn = safeGetElement("btnToProfile");
  if (!btn) return;

  btn.addEventListener("click", () => {
    // 1) 화면 전환
    if (typeof window.showScreen === "function") {
      window.showScreen("profileScreen");
    }

    // 2) 사용자 목록 렌더
    if (typeof window.loadUsers === "function") {
      // userManager.js의 전역 loadUsers가 있으면 이걸로 불러오기(권장)
      window.loadUsers();
      return;
    }

    // 대체 렌더러 1: renderUserList가 있다면 사용
    if (typeof window.renderUserList === "function") {
      window.renderUserList();
      return;
    }

    // 대체 렌더러 2: renderProfiles만 있을 때 컨테이너를 명시적으로 찾아 전달
    if (typeof window.renderProfiles === "function") {
      const root =
        safeGetElement("profilesContainer") ||
        document.querySelector("[data-profiles]");
      if (root) {
        // users 데이터를 내부에서 읽는 구현이라면 첫 인자는 생략 가능
        window.renderProfiles(undefined, root);
        return;
      }
    }

    console.warn(
      "[btnToProfile] 프로필 렌더러(loadUsers/renderUserList/renderProfiles)가 없습니다."
    );
  });
})();

// Export
window.startWorkoutTraining = startWorkoutTraining;
window.backToWorkoutSelection = backToWorkoutSelection;

// app.js 하단에 추가
// 그룹화 기능 통합
window.initializeGroupedTimeline = function() {
  // workoutManager.js의 그룹화 함수들을 app.js에서 사용할 수 있도록 연결
  if (typeof window.detectAndGroupSegments !== 'function') {
    console.warn('detectAndGroupSegments function not found in workoutManager.js');
  }
  
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
    const kcal = trainingMetrics.joules / 1000;
    
    // 엘리트/PRO 선수 확인
    const userChallenge = String(window.currentUser?.challenge || '').trim();
    const isElite = userChallenge === 'Elite';
    const isPRO = userChallenge === 'PRO';
    
    // 엘리트/PRO 선수는 더 정밀한 메트릭 표시
    if (isElite || isPRO) {
      // 엘리트 선수용 상세 메트릭 표시 (NP, IF 포함)
      safeSetText("tssValue", `${TSS.toFixed(1)} (NP: ${NP.toFixed(0)}W)`);
      safeSetText("kcalValue", `${Math.round(kcal)} (IF: ${IF.toFixed(2)})`);
      
      // 엘리트 선수 전용 메트릭을 liveData에 저장
      if (window.liveData) {
        window.liveData.np = NP;
        window.liveData.if = IF;
        window.liveData.tss = TSS;
      }
    } else {
      safeSetText("tssValue", TSS.toFixed(1));
      safeSetText("kcalValue", Math.round(kcal));
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

// 인증 화면 완전히 숨기기
function hideAuthScreen() {
  const authScreen = document.getElementById('authScreen');
  if (authScreen) {
    // 즉시 숨기기 (애니메이션 제거)
    authScreen.classList.remove('active');
    authScreen.style.display = 'none';
    authScreen.style.opacity = '0';
    authScreen.style.visibility = 'hidden';
    console.log('✅ 인증 화면 즉시 숨김');
  }
}

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
    
    // 선택된 화면 완전히 표시
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
      targetScreen.classList.add('active');
      
      // connectionScreen 특별 처리
      if (screenId === 'connectionScreen') {
        targetScreen.style.cssText = 'display: block !important; opacity: 1 !important; visibility: visible !important; z-index: 1000 !important; min-height: 100vh !important; background: #f6f8fa !important; padding: 20px !important;';
        console.log('🔗 connectionScreen 특별 처리 적용');
      } else {
        targetScreen.style.display = 'block';
        targetScreen.style.opacity = '1';
        targetScreen.style.visibility = 'visible';
        targetScreen.style.zIndex = '1000';
      }
      
      console.log('✅ 화면 전환 완료:', screenId);
      
      // 화면별 초기화
      if (typeof initializeCurrentScreen === 'function') {
        initializeCurrentScreen(screenId);
      }
    } else {
      console.error('❌ 화면을 찾을 수 없습니다:', screenId);
    }
  };
}

window.showScreen = function(screenId) {
  console.log('화면 전환 요청:', screenId, '인증 상태:', isPhoneAuthenticated);
  
  // 인증이 안 된 상태에서 다른 화면으로 가려고 하면 인증 화면으로 리다이렉트
  if (!isPhoneAuthenticated && screenId !== 'authScreen' && screenId !== 'loadingScreen') {
    screenId = 'authScreen';
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
    targetScreen.style.display = 'block';
    targetScreen.classList.add('active');
    targetScreen.style.opacity = '1';
    targetScreen.style.visibility = 'visible';
    
    initializeCurrentScreen(screenId);
  }
};

// 화면별 초기화 함수
function initializeCurrentScreen(screenId) {
  switch(screenId) {
    case 'authScreen':
      setTimeout(() => {
        const phoneInput = document.getElementById('phoneInput');
        if (phoneInput) {
          phoneInput.focus();
        }
      }, 300);
      break;
      
    case 'connectionScreen':
      console.log('기기 연결 화면 초기화');
      // ANT+ 버튼 활성화/비활성화 상태 업데이트
      setTimeout(() => {
        const btnANT = safeGetElement("btnConnectANT");
        if (btnANT) {
          // 현재 사용자 grade 확인
          let viewerGrade = '2'; // 기본값
          try {
            const viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
            const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
            const mergedViewer = Object.assign({}, viewer || {}, authUser || {});
            viewerGrade = String(mergedViewer?.grade || '2');
          } catch (e) {
            console.warn('사용자 grade 확인 실패:', e);
          }
          
          // grade=1 또는 grade=3만 활성화
          const isANTEnabled = (viewerGrade === '1' || viewerGrade === '3');
          
          if (!isANTEnabled) {
            btnANT.disabled = true;
            btnANT.classList.add('is-disabled');
            btnANT.setAttribute('aria-disabled', 'true');
            btnANT.title = 'ANT+ 연결은 관리자 또는 특정 등급 사용자만 사용할 수 있습니다';
            btnANT.style.opacity = '0.5';
            btnANT.style.cursor = 'not-allowed';
          } else {
            btnANT.disabled = false;
            btnANT.classList.remove('is-disabled');
            btnANT.removeAttribute('aria-disabled');
            btnANT.title = 'ANT+ 기기 연결';
            btnANT.style.opacity = '1';
            btnANT.style.cursor = 'pointer';
          }
        }
      }, 100);
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
      // 훈련일지 화면: 캘린더 자동 로드 및 API 키 로드
      console.log('훈련일지 화면 진입 - 캘린더 로딩 시작');
      if (typeof loadGeminiApiKey === 'function') {
        loadGeminiApiKey();
      }
      if (typeof loadTrainingJournalCalendar === 'function') {
        // 현재 월로 초기화
        trainingJournalCurrentMonth = new Date().getMonth();
        trainingJournalCurrentYear = new Date().getFullYear();
        loadTrainingJournalCalendar();
      } else {
        console.warn('loadTrainingJournalCalendar function not available');
      }
      break;
      
    default:
      console.log('기타 화면 초기화:', screenId);
  }
}

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
  
  // 전화번호 입력 필드 이벤트 설정
  const phoneInput = document.getElementById('phoneInput');
  if (phoneInput) {
    // input 이벤트 - 실시간 포맷팅
    phoneInput.addEventListener('input', function(e) {
      formatPhoneNumber(e.target.value);
    });
    
    // keyup 이벤트 - 엔터키, 백스페이스 등
    phoneInput.addEventListener('keyup', function(e) {
      handlePhoneKeyup(e);
    });
    
    // focus 이벤트 - 입력 필드 활성화 시
    phoneInput.addEventListener('focus', function(e) {
      console.log('📱 전화번호 입력 필드 활성화');
    });
    
    console.log('✅ 전화번호 입력 이벤트 리스너 설정 완료');
  } else {
    console.error('❌ phoneInput 요소를 찾을 수 없습니다');
  }
  
  // 인증 버튼 이벤트 설정
  const authBtn = document.getElementById('phoneAuthBtn');
  if (authBtn) {
    authBtn.addEventListener('click', function() {
      console.log('🔐 인증 버튼 클릭됨');
      authenticatePhone();
    });
    console.log('✅ 인증 버튼 이벤트 리스너 설정 완료');
  } else {
    console.error('❌ phoneAuthBtn 요소를 찾을 수 없습니다');
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
  currentPhoneNumber = '';
  console.log('인증 상태가 리셋되었습니다.');
};

// ✅ 교체:
// 🔍 검색: "window.checkAuthStatus = function()"
// ❌ 기존 함수 삭제하고 아래로 교체

window.checkAuthStatus = function() {
  console.log('=== 🔐 인증 시스템 상태 ===');
  console.log('현재 인증 상태:', isPhoneAuthenticated);
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
    authenticated: isPhoneAuthenticated, 
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
      console.log('🔄 DB에서 사용자 목록 동기화 중...');

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
          // 1단계: 모든 화면 완전히 숨기기
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

          // === [옵션 B] 현재 구조 유지: connectionScreen으로 이동 ===
          const connectionScreen = document.getElementById('connectionScreen');
          const target = connectionScreen; // 기본 타겟
          
          if (target) {
            target.classList.add('active');
            target.style.display = 'block';
            target.style.opacity = '1';
            target.style.visibility = 'visible';
            target.style.zIndex = '1000';
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

  const syncSuccess = await syncUsersFromDB();
  if (syncSuccess) {
    console.log('✅ DB 연동 인증 시스템 초기화 완료!');
    console.log('📞 실시간 DB 검색으로 전화번호를 인증합니다');
  } else {
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
          
         // 0.5초 후 기기연결 화면으로 이동
             setTimeout(() => {
               console.log('🔄 자동 인증 완료 - 기기연결 화면으로 이동');
               
               // 모든 화면 숨기기
               document.querySelectorAll('.screen').forEach(screen => {
                 screen.classList.remove('active');
                 screen.style.display = 'none';
               });
               
               // connectionScreen 강제 표시
               const connectionScreen = document.getElementById('connectionScreen');
               if (connectionScreen) {
                 connectionScreen.classList.add('active');
                 connectionScreen.style.display = 'block';
                 connectionScreen.style.opacity = '1';
                 connectionScreen.style.visibility = 'visible';
                 console.log('✅ connectionScreen 표시 완료');
               } else {
                 console.error('❌ connectionScreen을 찾을 수 없습니다');
                 // 대체 화면 표시
                 const allScreens = document.querySelectorAll('[id*="Screen"], [id*="screen"]');
                 if (allScreens.length > 0) {
                   const firstScreen = allScreens[0];
                   firstScreen.style.display = 'block';
                   console.log('🔄 대체 화면 표시:', firstScreen.id);
                 }
               }
             }, 500);
                      
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

    // (B안) 지금 구조 유지: 기기 연결 화면부터
    hideAllScreens();
    const connectionScreen = document.getElementById('connectionScreen');
    if (connectionScreen) {
      connectionScreen.classList.add('active');
      connectionScreen.style.display = 'block';
      connectionScreen.style.opacity = '1';
      connectionScreen.style.visibility = 'visible';
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
    
    // 해당 월의 시작일과 종료일 계산
    const startDate = new Date(trainingJournalCurrentYear, trainingJournalCurrentMonth, 1);
    const endDate = new Date(trainingJournalCurrentYear, trainingJournalCurrentMonth + 1, 0);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    // 훈련 결과 조회 (SCHEDULE_RESULTS에서 조회)
    let trainingResults = [];
    try {
      // ensureBaseUrl 함수 사용 (resultManager.js와 동일)
      const ensureBaseUrl = () => {
        const base = window.GAS_URL;
        if (!base) {
          throw new Error('GAS_URL is not set');
        }
        return base;
      };
      
      const baseUrl = ensureBaseUrl();
      const params = new URLSearchParams({
        action: 'getScheduleResultsByUser',
        userId: userId || '',
        startDate: startDateStr,
        endDate: endDateStr
      });
      const response = await fetch(`${baseUrl}?${params.toString()}`);
      const result = await response.json();
      
      if (result?.success && Array.isArray(result.items)) {
        trainingResults = result.items;
      }
    } catch (error) {
      console.error('훈련 결과 조회 실패:', error);
    }
    
    // 날짜별로 그룹화
    const resultsByDate = {};
    trainingResults.forEach(result => {
      // completed_at 또는 completedAt 사용
      const completedAt = result.completed_at || result.completedAt;
      if (!completedAt) return;
      
      // 타임존 문제 해결: 로컬 날짜로 변환
      const date = new Date(completedAt);
      // 로컬 날짜 문자열 생성 (YYYY-MM-DD)
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      if (!resultsByDate[dateStr]) {
        resultsByDate[dateStr] = [];
      }
      resultsByDate[dateStr].push(result);
    });
    
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
      isHoliday
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
  
  // 훈련 결과가 있는 날짜에 클릭 이벤트 리스너 추가
  container.querySelectorAll('.calendar-day[data-result]').forEach(dayElement => {
    dayElement.addEventListener('click', function() {
      const date = this.getAttribute('data-date');
      const resultDataStr = this.getAttribute('data-result');
      if (date && resultDataStr) {
        try {
          // HTML 이스케이프 해제
          const unescaped = resultDataStr.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
          const resultData = JSON.parse(unescaped);
          handleTrainingDayClick(date, resultData);
        } catch (error) {
          console.error('훈련 데이터 파싱 오류:', error);
          if (typeof showToast === 'function') {
            showToast('훈련 데이터를 불러오는 중 오류가 발생했습니다.', 'error');
          }
        }
      }
    });
  });
}

// 훈련일지 날짜 셀 렌더링
function renderTrainingJournalDay(dayData) {
  // 현재 월이 아닌 날짜는 빈 셀 반환
  if (!dayData || !dayData.isCurrentMonth) {
    return '<div class="calendar-day-empty"></div>';
  }
  
  // dayData에서 필요한 값 추출 (안전하게)
  const date = dayData.date || '';
  const day = dayData.day || 0;
  const isToday = dayData.isToday || false;
  const result = dayData.result || null;
  const isWeekend = dayData.isWeekend || false;
  const isHoliday = dayData.isHoliday || false;
  
  // 모든 날짜에 대해 기본 클래스 설정 (반드시 calendar-day 포함)
  const classes = ['calendar-day'];
  
  // 오늘 날짜 표시
  if (isToday) {
    classes.push('today');
  }
  
  // 과거 날짜 확인 (안전하게)
  let isPast = false;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date && date.includes('-')) {
      const dateParts = date.split('-');
      if (dateParts.length === 3) {
        const dayDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
        dayDate.setHours(0, 0, 0, 0);
        isPast = dayDate < today;
      }
    }
  } catch (e) {
    console.warn('날짜 파싱 오류:', e);
  }
  
  // 훈련 결과에 따른 클래스 추가
  if (result) {
    classes.push('completed');
    classes.push('clickable-training-day'); // 클릭 가능한 훈련일 표시
  }
  
  // 주말 또는 공휴일인 경우 주황색 클래스 추가
  if (isWeekend || isHoliday) {
    classes.push('holiday-weekend');
  }
  
  // 날짜 번호는 항상 표시 (반드시 포함)
  let content = `<div class="calendar-day-number">${day}</div>`;
  
  if (result) {
    // 훈련 완료 데이터 표시 (SCHEDULE_RESULTS 구조 사용)
    const durationMin = result.duration_min || 0;
    const avgPower = Math.round(result.avg_power || 0);
    const np = Math.round(result.np || result.avg_power || 0);
    const tss = Math.round(result.tss || 0);
    const hrAvg = Math.round(result.hr_avg || 0);
    const workoutName = result.workout_name || result.actual_workout_id || '워크아웃';
    
    // HTML 이스케이프 간단 함수
    const escapeHtml = (text) => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };
    
    content += `
      <div class="calendar-day-content">
        <div class="journal-workout-name">${escapeHtml(workoutName)}</div>
        <div class="training-journal-stats">
          <div class="journal-duration-badge">${durationMin}분</div>
          <div class="journal-stat-item"><span class="stat-label">파워</span><span class="stat-value">${avgPower}W</span></div>
          <div class="journal-stat-item"><span class="stat-label">NP</span><span class="stat-value">${np}W</span></div>
          <div class="journal-stat-item"><span class="stat-label">TSS</span><span class="stat-value">${tss}</span></div>
          <div class="journal-stat-item"><span class="stat-label">심박</span><span class="stat-value">${hrAvg}</span></div>
        </div>
      </div>
    `;
  } else {
    // 오늘 날짜이고 훈련 이력이 없는 경우 AI 추천 버튼 표시
    if (isToday) {
      content += `
        <div class="calendar-day-content journal-no-training">
          <button class="ai-recommend-btn" onclick="handleAIWorkoutRecommendation(event, '${date}')" title="AI 최적훈련 추천">
            <img src="assets/img/ai.gif" alt="AI" class="ai-recommend-icon" />
            <img src="assets/img/STELVIO AI.png" alt="STELVIO AI" class="journal-stelvio-logo" />
            <span class="ai-recommend-text">AI 최적훈련 추천</span>
          </button>
        </div>
      `;
    } else {
      // 과거 날짜는 기존처럼 로고만 표시
      content += `
        <div class="calendar-day-content journal-no-training">
          <img src="assets/img/STELVIO AI.png" alt="STELVIO AI" class="journal-stelvio-logo" />
        </div>
      `;
    }
  }
  
  // 훈련 결과가 있는 경우 클릭 이벤트를 위한 data 속성 추가
  const dataResult = result ? `data-result='${JSON.stringify(result).replace(/'/g, "&#39;").replace(/"/g, "&quot;")}'` : '';
  const cursorStyle = result ? 'style="cursor: pointer;"' : '';
  
  // 모든 날짜 블럭 반환 (날짜 번호는 항상 포함됨, calendar-day 클래스는 반드시 포함)
  // date가 없어도 빈 문자열로 처리하여 블럭은 표시
  return `<div class="${classes.join(' ')}" data-date="${date || ''}" ${dataResult} ${cursorStyle}>${content}</div>`;
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
      if (confirm('Gemini API 키가 설정되지 않았습니다.\n훈련일지 상단에서 API 키를 입력해주세요.\n\n지금 설정하시겠습니까?')) {
        const apiKeyInput = document.getElementById('geminiApiKey');
        if (apiKeyInput) {
          apiKeyInput.focus();
          apiKeyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    
    // 사용자 정보 가져오기
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!currentUser) {
      showToast('사용자 정보를 찾을 수 없습니다.', 'error');
      return;
    }
    
    // 추천 모달 표시
    showWorkoutRecommendationModal();
    
    // 분석 및 추천 실행
    await analyzeAndRecommendWorkouts(date, currentUser, apiKey);
    
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
      if (confirm('Gemini API 키가 설정되지 않았습니다.\n훈련일지 상단에서 API 키를 입력해주세요.\n\n지금 설정하시겠습니까?')) {
        const apiKeyInput = document.getElementById('geminiApiKey');
        if (apiKeyInput) {
          apiKeyInput.focus();
          apiKeyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  const MAX_OUTPUT_TOKENS = 4096; // 최대 출력 토큰 수 (응답 크기 제한) - 완전한 분석을 위해 증가
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
          const parts = targetValue.split('/');
          targetValue = `${parts[0]}% FTP / ${parts[1]} RPM`;
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
        
        // 우선순위 정렬: 2.5 Pro -> 1.5 Pro -> 2.5 Flash -> 기타
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
        if (finishReason && finishReason !== 'STOP' && finishReason !== 'END_OF_TURN') {
          console.warn('응답이 불완전합니다. finishReason:', finishReason);
          throw new Error(`API 응답이 불완전합니다. finishReason: ${finishReason}`);
        }
        
        // 텍스트가 완전한지 확인 (최소 길이 체크)
        const responseText = candidate.content.parts[0].text;
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
    
    // 분석 결과 저장 (나중에 내보내기용)
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
      analysis: analysisData ? JSON.stringify(analysisData, null, 2) : analysisText,
      analysisData: analysisData
    };
    
    // 인터벌 정리
    if (window.trainingAnalysisStatusInterval) {
      clearInterval(window.trainingAnalysisStatusInterval);
      window.trainingAnalysisStatusInterval = null;
    }
    
    // 결과 표시 (구조화된 데이터가 있으면 시각화, 없으면 텍스트)
    if (analysisData) {
      contentDiv.innerHTML = renderVisualizedAnalysis(date, workoutName, durationMin, avgPower, np, tss, hrAvg, ftp, weight, analysisData);
      // 차트 렌더링 (비동기)
      setTimeout(() => renderAnalysisCharts(analysisData, avgPower, np, tss, hrAvg, ftp), 100);
    } else {
      // 폴백: 기존 텍스트 형식
      contentDiv.innerHTML = `
        <div class="analysis-header">
          <h3>${date} - ${workoutName}</h3>
          <div class="analysis-meta">
            <span>훈련 시간: ${durationMin}분</span>
            <span>평균 파워: ${avgPower}W</span>
            <span>NP: ${np}W</span>
            <span>TSS: ${tss}</span>
            <span>평균 심박: ${hrAvg} bpm</span>
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

// 시각화된 분석 결과 렌더링
function renderVisualizedAnalysis(date, workoutName, durationMin, avgPower, np, tss, hrAvg, ftp, weight, data) {
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
  
  return `
    <div class="analysis-header">
      <h3>${date} - ${workoutName}</h3>
      <div class="analysis-meta">
        <span>훈련 시간: ${durationMin}분</span>
        <span>평균 파워: ${avgPower}W</span>
        <span>NP: ${np}W</span>
        <span>TSS: ${tss}</span>
        <span>평균 심박: ${hrAvg} bpm</span>
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
function loadGeminiApiKey() {
  const apiKey = localStorage.getItem('geminiApiKey');
  const apiKeyInput = document.getElementById('geminiApiKey');
  if (apiKeyInput && apiKey) {
    apiKeyInput.value = apiKey;
    // 저장된 비활성화 상태 확인
    const isDisabled = localStorage.getItem('geminiApiKeyDisabled') === 'true';
    if (isDisabled) {
      apiKeyInput.disabled = true;
    }
  }
}

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

// ========== RPE 컨디션 선택 모달 함수 ==========
function showRPEModal() {
  const modal = document.getElementById('rpeConditionModal');
  if (modal) {
    modal.style.display = 'flex';
    // 기존 선택 해제
    document.querySelectorAll('.rpe-condition-btn').forEach(btn => {
      btn.classList.remove('selected');
    });
    
    // 저장된 값이 있으면 해당 버튼 선택
    const savedAdjustment = window.trainingIntensityAdjustment || 1.0;
    const savedBtn = document.querySelector(`.rpe-condition-btn[data-adjustment="${savedAdjustment}"]`);
    if (savedBtn) {
      savedBtn.classList.add('selected');
    }
    
    // 확인 버튼 초기화
    const confirmBtn = document.getElementById('rpeConfirmBtn');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
    }
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
  
  // 확인 버튼 활성화
  const confirmBtn = document.getElementById('rpeConfirmBtn');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
  }
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
  
  // 훈련 스케줄 화면으로 이동
  if (typeof showScreen === 'function') {
    showScreen('scheduleListScreen');
    if (typeof loadTrainingSchedules === 'function') {
      loadTrainingSchedules();
    }
  }
  
  const conditionNames = {
    1.03: '최상',
    1.00: '좋음',
    0.98: '보통',
    0.95: '나쁨'
  };
  
  const conditionName = conditionNames[adjustment] || '선택됨';
  if (typeof showToast === 'function') {
    showToast(`컨디션: ${conditionName} (${(adjustment * 100).toFixed(0)}%) 적용됨`, 'success');
  }
}

// 전역 함수로 등록
window.showRPEModal = showRPEModal;
window.closeRPEModal = closeRPEModal;
window.selectRPECondition = selectRPECondition;
window.confirmRPESelection = confirmRPESelection;
window.handleAIWorkoutRecommendation = handleAIWorkoutRecommendation;

// ========== AI 워크아웃 추천 기능 ==========

// 추천 워크아웃 모달 표시
function showWorkoutRecommendationModal() {
  const modal = document.getElementById('workoutRecommendationModal');
  if (modal) {
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
async function analyzeAndRecommendWorkouts(date, user, apiKey) {
  const contentDiv = document.getElementById('workoutRecommendationContent');
  
  try {
    // 1. 사용자 기본 정보 수집
    const ftp = user.ftp || 0;
    const weight = user.weight || 0;
    const challenge = user.challenge || 'Fitness';
    
    // 2. 오늘의 몸상태 확인 (localStorage에서)
    const todayCondition = localStorage.getItem(`bodyCondition_${date}`) || '보통';
    const conditionMap = {
      '최상': 1.03,
      '좋음': 1.00,
      '보통': 0.98,
      '나쁨': 0.95
    };
    const conditionAdjustment = conditionMap[todayCondition] || 0.98;
    
    // 3. 최근 운동 이력 조회 (최근 14일)
    const today = new Date(date);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 14);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = date;
    
    let recentHistory = [];
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
        recentHistory = result.items.slice(0, 10); // 최근 10개만
      }
    } catch (error) {
      console.warn('최근 운동 이력 조회 실패:', error);
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
        availableWorkouts = isAdmin 
          ? allWorkouts 
          : allWorkouts.filter(w => String(w.status || '').trim() === '보이기');
      }
    } catch (error) {
      console.warn('워크아웃 목록 조회 실패:', error);
    }
    
    // 5. 워크아웃 상세 정보 조회 (세그먼트 포함)
    const workoutDetails = [];
    for (const workout of availableWorkouts.slice(0, 20)) { // 최대 20개만
      try {
        const ensureBaseUrl = () => {
          const base = window.GAS_URL;
          if (!base) throw new Error('GAS_URL is not set');
          return base;
        };
        
        const baseUrl = ensureBaseUrl();
        const params = new URLSearchParams({
          action: 'getWorkout',
          id: workout.id
        });
        const response = await fetch(`${baseUrl}?${params.toString()}`);
        const result = await response.json();
        
        if (result?.success && result.item) {
          workoutDetails.push(result.item);
        }
      } catch (error) {
        console.warn(`워크아웃 ${workout.id} 상세 조회 실패:`, error);
      }
    }
    
    // 6. Gemini API에 전달할 프롬프트 생성
    const historySummary = recentHistory.map(h => ({
      date: h.completed_at ? new Date(h.completed_at).toISOString().split('T')[0] : '',
      workout: h.workout_name || '알 수 없음',
      duration: h.duration_min || 0,
      avgPower: h.avg_power || 0,
      tss: h.tss || 0
    }));
    
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
    
    // 프롬프트 생성 (워크아웃 정보는 최대 15개로 제한하여 토큰 수 감소)
    const limitedWorkouts = workoutsSummary.slice(0, 15);
    const limitedHistory = historySummary.slice(0, 7);
    
    const prompt = `당신은 전문 사이클 코치입니다. 다음 정보를 바탕으로 오늘 수행할 최적의 워크아웃을 추천해주세요.

**사용자 정보:**
- FTP: ${ftp}W
- 체중: ${weight}kg
- W/kg: ${weight > 0 ? (ftp / weight).toFixed(2) : 'N/A'}
- 운동 목적: ${challenge} (Fitness: 일반 피트니스/다이어트, GranFondo: 그란폰도, Racing: 레이싱, Elite: 엘리트 선수, PRO: 프로 선수)
- 오늘의 몸상태: ${todayCondition} (조정 계수: ${(conditionAdjustment * 100).toFixed(0)}%)

**최근 운동 이력 (최근 ${limitedHistory.length}회):**
${JSON.stringify(limitedHistory, null, 2)}

**사용 가능한 워크아웃 목록 (${limitedWorkouts.length}개):**
${JSON.stringify(limitedWorkouts.map(w => ({
  id: w.id,
  title: w.title,
  author: w.author,
  totalSeconds: w.totalSeconds,
  segmentCount: w.segments?.length || 0
})), null, 2)}

**분석 요청사항:**
1. 사용자의 운동 목적(${challenge})과 최근 운동 이력을 분석하여 오늘의 운동 카테고리(Endurance, Tempo, SweetSpot, Threshold, VO2Max, Recovery 중 하나)를 선정하세요.
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
2. 선정된 카테고리에 해당하는 워크아웃 중에서 사용자의 현재 상태와 목적에 가장 적합한 워크아웃 3개를 추천 순위로 제시하세요.
3. 각 추천 워크아웃에 대해 추천 이유를 간단히 설명하세요.

다음 JSON 형식으로 응답해주세요:
{
  "selectedCategory": "선정된 카테고리",
  "categoryReason": "카테고리 선정 이유",
  "recommendations": [
    {
      "rank": 1,
      "workoutId": 워크아웃 ID (숫자),
      "reason": "추천 이유"
    },
    {
      "rank": 2,
      "workoutId": 워크아웃 ID (숫자),
      "reason": "추천 이유"
    },
    {
      "rank": 3,
      "workoutId": 워크아웃 ID (숫자),
      "reason": "추천 이유"
    }
  ]
}

중요: 반드시 유효한 JSON 형식으로만 응답하고, 다른 설명이나 마크다운 없이 순수 JSON만 제공해주세요.`;

    // 7. Gemini API 호출
    // 모델 우선순위 설정 (최고 분석 능력 기준)
    // 1순위: Gemini 2.5 Pro - 최고 성능, 복잡한 분석 작업에 최적화, 2M 토큰 컨텍스트
    // 2순위: Gemini 1.5 Pro - 강력한 분석 능력, 안정적
    // 3순위: Gemini 2.5 Flash - 빠른 응답, 효율적
    const PRIMARY_MODEL = 'gemini-2.5-pro';
    const SECONDARY_MODEL = 'gemini-1.5-pro';
    const TERTIARY_MODEL = 'gemini-2.5-flash';
    
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
        
        // 우선순위 정렬: 2.5 Pro -> 1.5 Pro -> 2.5 Flash -> 기타
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
      
      // 1순위 모델(2.5 Pro)로 초기화
      const primaryModelExists = availableModelsList.find(m => m.shortName === PRIMARY_MODEL);
      if (primaryModelExists) {
        modelName = PRIMARY_MODEL;
        console.log(`1순위 모델 설정: ${modelName}`);
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
          
          // 성공한 경우 응답 반환
          return await response.json();
          
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
    
    // API 호출 (재시도 포함)
    let data;
    try {
      data = await callGeminiAPI(apiUrl, {
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      });
    } catch (apiError) {
      // API 호출 실패 시 사용자에게 재시도 옵션 제공
      throw new Error(`API 호출 실패: ${apiError.message}\n\n서버가 일시적으로 과부하 상태일 수 있습니다. 잠시 후 다시 시도해주세요.`);
    }
    
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // JSON 파싱
    let recommendationData;
    try {
      // 마크다운 코드 블록 제거
      const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      recommendationData = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('JSON 파싱 오류:', parseError, responseText);
      throw new Error('AI 응답을 파싱할 수 없습니다.');
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
          <button class="btn btn-primary" onclick="
            const fakeEvent = { stopPropagation: () => {}, isRetry: true };
            handleAIWorkoutRecommendation(fakeEvent, '${todayStr}');
          ">🔄 다시 시도</button>
          <button class="btn btn-secondary" onclick="closeWorkoutRecommendationModal()">닫기</button>
        </div>
      `;
    } else {
      errorHtml += `
        <div style="margin-top: 20px; display: flex; gap: 12px; justify-content: center;">
          <button class="btn btn-secondary" onclick="closeWorkoutRecommendationModal()">닫기</button>
        </div>
      `;
    }
    
    errorHtml += `</div>`;
    
    contentDiv.innerHTML = errorHtml;
  }
}

// 추천 워크아웃 표시
function displayWorkoutRecommendations(recommendationData, workoutDetails, date) {
  const contentDiv = document.getElementById('workoutRecommendationContent');
  
  const selectedCategory = recommendationData.selectedCategory || '알 수 없음';
  const categoryReason = recommendationData.categoryReason || '';
  const recommendations = recommendationData.recommendations || [];
  
  // 워크아웃 ID로 상세 정보 매핑
  const workoutMap = {};
  workoutDetails.forEach(w => {
    workoutMap[w.id] = w;
  });
  
  let html = `
    <div class="workout-recommendation-container">
      <div class="recommendation-header">
        <h3>🤖 AI 추천 워크아웃</h3>
        <p class="recommendation-date">날짜: ${date}</p>
      </div>
      
      <div class="category-info">
        <h4>선정된 카테고리: <span class="category-name">${selectedCategory}</span></h4>
        <p class="category-reason">${categoryReason}</p>
      </div>
      
      <div class="recommendations-list">
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
    
    const totalMinutes = Math.round((workout.total_seconds || 0) / 60);
    const rankBadge = ['🥇', '🥈', '🥉'][index] || `${rec.rank}위`;
    
    html += `
      <div class="recommendation-item" data-workout-id="${workout.id}">
        <div class="recommendation-rank">${rankBadge}</div>
        <div class="recommendation-content">
          <h4 class="workout-title">${workout.title || '워크아웃'}</h4>
          <div class="workout-meta">
            <span class="workout-category">${workout.author || '카테고리 없음'}</span>
            <span class="workout-duration">${totalMinutes}분</span>
          </div>
          <p class="recommendation-reason">${rec.reason || '추천 이유 없음'}</p>
          ${workout.description ? `<p class="workout-description">${workout.description}</p>` : ''}
        </div>
        <div class="recommendation-action">
          <button class="btn btn-primary" onclick="selectRecommendedWorkout(${workout.id}, '${date}')" data-workout-id="${workout.id}">
            선택
          </button>
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
    
    // 진행 상태 업데이트 - 워크아웃 준비 중
    if (button) {
      button.classList.remove('selecting-preparing');
      button.classList.add('selecting-loading');
      button.innerHTML = `
        <span class="select-progress-spinner"></span>
        <span class="select-progress-text">워크아웃 준비 중...</span>
      `;
    }
    
    // 워크아웃 데이터 정규화 (selectWorkout과 동일한 방식)
    // workoutManager.js의 normalizeWorkoutData와 동일한 로직 적용
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
    
    // 전역 워크아웃 데이터 설정 (selectWorkout과 동일한 방식)
    window.currentWorkout = normalizedWorkout;
    
    // localStorage에 저장
    try {
      localStorage.setItem('currentWorkout', JSON.stringify(normalizedWorkout));
      console.log('Workout saved to localStorage');
    } catch (e) {
      console.warn('로컬 스토리지 저장 실패:', e);
    }
    
    // 진행 상태 업데이트 - 완료 중
    if (button) {
      button.classList.remove('selecting-loading');
      button.classList.add('selecting-completing');
      button.innerHTML = `
        <span class="select-progress-spinner"></span>
        <span class="select-progress-text">완료 중...</span>
      `;
    }
    
    // 모달 닫기
    closeWorkoutRecommendationModal();
    
    // 훈련 준비 화면으로 이동 (selectWorkout과 동일한 방식)
    if (typeof showScreen === 'function') {
      // 현재 활성화된 화면을 히스토리에 추가
      if (!window.screenHistory) {
        window.screenHistory = [];
      }
      
      const currentActive = document.querySelector(".screen.active") || 
                            Array.from(document.querySelectorAll(".screen")).find(s => 
                              s.style.display === "block" || window.getComputedStyle(s).display === "block"
                            );
      
      if (currentActive && currentActive.id && currentActive.id !== 'trainingReadyScreen') {
        const lastHistory = window.screenHistory.length > 0 ? window.screenHistory[window.screenHistory.length - 1] : null;
        if (lastHistory !== currentActive.id) {
          window.screenHistory.push(currentActive.id);
          if (window.screenHistory.length > 10) {
            window.screenHistory.shift();
          }
        }
      }
      
      showScreen('trainingReadyScreen', false);
    }
    
    // 워크아웃 미리보기 업데이트 (있는 경우)
    if (typeof updateWorkoutPreview === 'function') {
      setTimeout(() => {
        updateWorkoutPreview();
      }, 100);
    }
    
    showToast(`${normalizedWorkout.title || '워크아웃'}이 선택되었습니다. 훈련을 시작하세요!`, 'success');
    
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

// 전역 함수로 등록
window.showWorkoutRecommendationModal = showWorkoutRecommendationModal;
window.closeWorkoutRecommendationModal = closeWorkoutRecommendationModal;
window.selectRecommendedWorkout = selectRecommendedWorkout;
window.loadTrainingJournalCalendar = loadTrainingJournalCalendar;
window.handleTrainingDayClick = handleTrainingDayClick;
window.saveGeminiApiKey = saveGeminiApiKey;
window.testGeminiApiKey = testGeminiApiKey;
window.closeTrainingAnalysisModal = closeTrainingAnalysisModal;
window.exportAnalysisReport = exportAnalysisReport;
window.showAIRecommendationConfirmModal = showAIRecommendationConfirmModal;
window.closeAIRecommendationConfirmModal = closeAIRecommendationConfirmModal;
window.confirmAIRecommendation = confirmAIRecommendation;
