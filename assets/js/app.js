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
        description: '저강도 회복 라이딩'
      }
    ];
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

  // 배경 그라디언트
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, (opts.bgTop   ?? 'rgba(59,130,246,0.10)'));
  g.addColorStop(1, (opts.bgBottom?? 'rgba(59,130,246,0.00)'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 메인 라인
  ctx.beginPath();
  vis.forEach((p, i) => {
    const x = pad + ((p.t - tMin) / tSpan) * (W - pad * 2);
    const y = pad + (1 - ((p.v - minV) / vSpan)) * (H - pad * 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineWidth = opts.lineWidth ?? 2;
  ctx.strokeStyle = opts.stroke ?? 'rgba(0,215,200,0.9)'; // 민트
  ctx.stroke();

  // 영역 채움(선택)
  if (opts.fill !== false) {
    ctx.lineTo(pad + (vis[vis.length - 1].t - tMin) / tSpan * (W - pad * 2), H - pad);
    ctx.lineTo(pad, H - pad);
    ctx.closePath();
    ctx.fillStyle = opts.fill ?? 'rgba(0,215,200,0.15)';
    ctx.fill();
  }

  // 평균 가이드라인(선택)
  if (opts.avgLine) {
    const avgY = pad + (1 - ((avgV - minV) / vSpan)) * (H - pad * 2);
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



// 세그먼트 목표 파워(W) 계산
function getSegmentTargetW(i) {
  const w = window.currentWorkout;
  const seg = w?.segments?.[i];
  if (!seg) return 0;
  const ftp = Number(window.currentUser?.ftp) || 200;
  const ftpPercent = getSegmentFtpPercent(seg); // 기존 로직 활용
  return Math.round(ftp * (ftpPercent / 100));
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
        if (elapsed >= endAt)      ratio = 1;
        else if (elapsed > startAt) ratio = (elapsed - startAt) / dur;

        ratio = Math.max(0, Math.min(1, ratio));
        fillEl.style.width = (ratio * 100) + "%";

        // 현재 세그먼트면 파랑으로 강제
        if (elapsed > startAt && elapsed < endAt) {
          fillEl.style.background = "#2E74E8";
        }
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
  samples: [],     // 세그먼트별 표본 수(초)
};

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
      } else if (elapsed > startAt) {
        ratio = (elapsed - startAt) / dur; // 진행 중인 세그먼트
      }
      // else ratio = 0 (아직 시작 안 된 세그먼트)
      
      ratio = Math.min(1, Math.max(0, ratio));
      fill.style.width = (ratio * 100) + "%";
       
        // 🔵 현재 세그먼트면 파랑색으로 강제
        if (elapsed > startAt && elapsed < endAt) {
          fill.style.background = "#2E74E8";
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
    
    const groupFill = document.getElementById(`groupFill-${groupIndex}`);
    if (groupFill) {
      groupFill.style.width = (groupRatio * 100) + "%";
    }

      // 상태/달성도 클래스 초기화
      // [변경 후] 그룹세그먼트 왼쪽 라인 유지 보장
      groupEl.classList.remove(
        "is-complete","is-current","is-upcoming",
        "achievement-low","achievement-good","achievement-high","achievement-over"
      );
     
      
      // 그룹 경계
      const groupStart = groupStartTime;
      const groupEnd   = groupStartTime + groupTotalTime;
      
      // 달성도 계산: (가중평균 실제W) / (가중평균 타깃W)
      let targetSum = 0, actualSum = 0;
      for (let i = startIndex; i < endIndex; i++) {
        const seg = w.segments[i];
        const dur = segDurationSec(seg);
        const tgt = segTargetW(seg, ftp);                          // 기존 함수 사용
        const samples = segBar.samples[i] || 0;
        const avgW    = samples ? (segBar.sumPower[i] / samples) : 0;
      
        targetSum += (tgt * dur);
        actualSum += (avgW * dur);
      }
      const groupAch = targetSum > 0 ? (actualSum / targetSum) : 0;
      
      // 상태 + 달성도 클래스 부여
      if (elapsed >= groupEnd) {
        groupEl.classList.add("is-complete");
        if (groupAch < 0.85)              groupEl.classList.add("achievement-low");
        else if (groupAch <= 1.15)        groupEl.classList.add("achievement-good");
        else if (groupAch <= 1.30)        groupEl.classList.add("achievement-high");
        else                              groupEl.classList.add("achievement-over");
      } else if (elapsed >= groupStart && elapsed < groupEnd) {
        groupEl.classList.add("is-current");
      } else {
        groupEl.classList.add("is-upcoming");
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
      el.classList.remove("is-complete", "is-current", "is-upcoming");
      el.classList.remove("achievement-low", "achievement-good", "achievement-high", "achievement-over");
      
      if (elapsed >= endAt2) {
        // 완료된 세그먼트 - 달성도 기반 색상 적용
        el.classList.add("is-complete");
        
        // 달성도 계산 및 색상 적용
        const targetW = segTargetW(seg, ftp);
        const avgW = segBar.samples[i] ? (segBar.sumPower[i] / segBar.samples[i]) : 0;
        const achievement = targetW > 0 ? (avgW / targetW) : 0;
        
        // 달성도에 따른 CSS 클래스 추가
        if (achievement < 0.85) {
          el.classList.add("achievement-low");
        } else if (achievement >= 0.85 && achievement <= 1.15) {
          el.classList.add("achievement-good");
        } else if (achievement > 1.15 && achievement <= 1.3) {
          el.classList.add("achievement-high");
        } else if (achievement > 1.3) {
          el.classList.add("achievement-over");
        }
        
      } else if (elapsed >= startAt2 && elapsed < endAt2) {
        el.classList.add("is-current");
      } else {
        el.classList.add("is-upcoming");
      }
    }
    startAt2 = endAt2;
  }

  // 4) 그룹 상태 클래스 업데이트는 기존과 동일...
  // (생략 - 기존 코드와 동일)
   // 4) 그룹 상태 클래스 업데이트
   document.querySelectorAll('.timeline-group').forEach(groupEl => {
     const startIndex = parseInt(groupEl.dataset.startIndex) || 0;
     const endIndex   = parseInt(groupEl.dataset.endIndex)   || 0;
   
     // 그룹의 누적 시작/총 시간 계산
     let groupStartTime = 0;
     for (let i = 0; i < startIndex; i++) groupStartTime += segDurationSec(w.segments[i]);
   
     let groupTotalTime = 0;
     for (let i = startIndex; i < endIndex; i++) groupTotalTime += segDurationSec(w.segments[i]);
   
     const groupEndTime = groupStartTime + groupTotalTime;
   
     // 상태 클래스 초기화
     groupEl.classList.remove('is-complete','is-current','is-upcoming');
   
     if (elapsed >= groupEndTime) {
       groupEl.classList.add('is-complete');
     } else if (elapsed >= groupStartTime && elapsed < groupEndTime) {
       groupEl.classList.add('is-current');
     } else {
       groupEl.classList.add('is-upcoming'); // ⬅ 미진행(업커밍)
     }
   });



   
  // 5) 평균 파워 누적
  const p = Math.max(0, Number(window.liveData?.power) || 0);
  if (w.segments[segIndex]) {
    segBar.sumPower[segIndex] = (segBar.sumPower[segIndex] || 0) + p;
    segBar.samples[segIndex] = (segBar.samples[segIndex] || 0) + 1;

    const curSamples = segBar.samples[segIndex] || 0;
    const curAvg = curSamples > 0 ? Math.round(segBar.sumPower[segIndex] / curSamples) : 0;
    const elAvg = document.getElementById("avgSegmentPowerValue");
    if (elAvg) elAvg.textContent = String(curAvg);
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

    // 목표 파워 계산 - 통일된 방식 사용
    const ftpPercent = getSegmentFtpPercent(seg);
    const targetW = Math.round(ftp * (ftpPercent / 100));
    
    window.liveData = window.liveData || {};
    window.liveData.targetPower = targetW;

    // DOM 즉시 반영
    safeSetText("targetPowerValue", String(targetW || 0));
    
    const nameEl = safeGetElement("currentSegmentName");
    if (nameEl) {
      const segmentName = seg.label || seg.segment_type || `세그먼트 ${i + 1}`;
      nameEl.textContent = `${segmentName} - FTP ${ftpPercent}%`;
     // ⬇⬇⬇ 새 세그먼트 진입 시 진행바 0%로 리셋
     setNameProgress(0);       
    }
    
    safeSetText("segmentProgress", "0");
    safeSetText("avgSegmentPowerValue", "—");

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
       .then(() => { if (typeof showScreen === "function") showScreen("resultScreen"); });
   
     return;
   }




   // 세그먼트 경계 통과 → 다음 세그먼트로 전환
   if (window.trainingState.segElapsedSec >= segDur) {
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
     window.trainingState.segIndex += 1;
     window.trainingState.segElapsedSec = 0;

      // 다음 세그먼트의 카운트다운 상태 초기화
      ts._countdownFired[String(ts.segIndex)] = {};
      ts._prevRemainMs[String(ts.segIndex)]   = segDur * 1000; // 새 세그 초기 남은 ms      
   
     if (window.trainingState.segIndex < w.segments.length) {
       console.log(`세그먼트 ${window.trainingState.segIndex + 1}로 전환`);
       applySegmentTarget(window.trainingState.segIndex);
   
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
}


// 중복 선언 방지
if (!window.showScreen) {
  window.showScreen = function(id) {
    try {
      console.log(`Switching to screen: ${id}`);
      
      // 1) 모든 화면 숨김
      document.querySelectorAll(".screen").forEach(s => {
        s.style.display = "none";
        s.classList.remove("active");
      });
      
      // 2) 대상 화면만 표시
      const el = safeGetElement(id);
      if (el) {
        el.style.display = "block";
        el.classList.add("active");
        console.log(`Successfully switched to: ${id}`);
      } else {
        console.error(`Screen element '${id}' not found`);
        return;
      }
      
      // 3) 화면별 특별 처리
      if (id === 'workoutScreen' && typeof loadWorkouts === 'function') {
        setTimeout(() => loadWorkouts(), 100);
      }

       //프로필 선택 화면: “새 사용자 추가” 메뉴 제거(간단)
      if (id === 'profileScreen') {
        console.log('Loading users for profile screen.');
        setTimeout(() => {
          if (typeof window.loadUsers === 'function') {
            window.loadUsers();
          } else {
            console.error('loadUsers function not available');
          }
          // ✅ 프로필 화면 진입 시 “새 사용자 추가” 카드 제거(간단)
          const addCard = document.getElementById('cardAddUser');
          if (addCard) addCard.remove();
        }, 100);
      }

      
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
  const currentPower = window.liveData?.power || 0;
  const target = window.liveData?.targetPower || 200;
  const hr = window.liveData?.heartRate || 0;

   // ▼▼ 추가: 실시간 데이터 누적
   try {
     // 차트용
     window._powerSeries?.push(currentPower);
     window._hrSeries?.push(hr);
   
     // ✅ 결과 저장용(세션 스트림)
     window.trainingResults?.appendStreamSample?.('power', currentPower);
     window.trainingResults?.appendStreamSample?.('hr', hr);
     const cad = Number(window.liveData?.cadence || 0);
     if (!Number.isNaN(cad)) {
       window.trainingResults?.appendStreamSample?.('cadence', cad);
     }
   } catch (_) {}

   
  const p = safeGetElement("currentPowerValue");
  const h = safeGetElement("heartRateValue");
  const bar = safeGetElement("powerProgressBar");
  const t = safeGetElement("targetPowerValue");

  if (p) {
    p.textContent = Math.round(currentPower);
    p.classList.remove("power-low","power-mid","power-high","power-max");
    const ratio = currentPower / target;
    if (ratio < 0.8) p.classList.add("power-low");
    else if (ratio < 1.0) p.classList.add("power-mid");
    else if (ratio < 1.2) p.classList.add("power-high");
    else p.classList.add("power-max");
  }

  if (bar) {
    const pct = target > 0 ? Math.min(100, (currentPower / target) * 100) : 0;
    bar.style.width = pct + "%";
    if (pct < 80) bar.style.background = "linear-gradient(90deg,#00b7ff,#0072ff)";
    else if (pct < 100) bar.style.background = "linear-gradient(90deg,#3cff4e,#00ff88)";
    else if (pct < 120) bar.style.background = "linear-gradient(90deg,#ffb400,#ff9000)";
    else bar.style.background = "linear-gradient(90deg,#ff4c4c,#ff1a1a)";
  }

  if (t) t.textContent = String(Math.round(target));

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
            showStats: true,
            unit: 'W',
            avgLine: true,
            avgLineStyle: 'dashed',
            avgStroke: 'rgba(255,255,255,0.65)'
          });
      
          drawSparkline(hc, window._hrSeries, {
            windowSec: 0,
            stroke: 'rgba(0,215,200,0.9)',
            fill:   'rgba(0,215,200,0.10)',
            showStats: true,
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
        }
      } catch (e) {
        console.warn('chart render skipped:', e);
      }

};


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

    box.textContent = `${cleanName} · FTP ${ftpDisp}W · ${wkgDisp} W/kg`;

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

// DOMContentLoaded 이벤트
document.addEventListener("DOMContentLoaded", () => {
  console.log("===== APP INIT =====");

  // iOS용 처리 프로세스
  function isIOS() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function enableIOSMode() {
    const info = safeGetElement("iosInfo");
    if (info) info.classList.remove("hidden");

    ["btnConnectPM","btnConnectTrainer","btnConnectHR"].forEach(id => {
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
        if (typeof showScreen === "function") {
          showScreen("profileScreen");
        } else {
          console.error("showScreen function not available");
        }
      });
    } else {
      console.warn("btnIosContinue element not found in DOM");
    }
  }

  // 브라우저 지원 확인
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
  
  if (typeof showScreen === "function") {
    showScreen("connectionScreen");
  }

  // 훈련 준비 → 훈련 시작
  const btnStartTraining = safeGetElement("btnStartTraining");
  if (btnStartTraining) {
    btnStartTraining.addEventListener("click", () => startWithCountdown(5));
  }

  // 그룹 훈련 버튼 이벤트 핸들러 추가
  const btnGroupTraining = safeGetElement("btnGroupTraining");
  if (btnGroupTraining) {
    btnGroupTraining.addEventListener("click", () => {
      console.log('Group training button clicked');
      if (typeof selectTrainingMode === 'function') {
        selectTrainingMode('group');
      } else {
        console.warn('selectTrainingMode function not found');
        showToast('그룹 훈련 기능을 찾을 수 없습니다', 'error');
      }
    });
  }

  // 훈련 준비 → 워크아웃 변경
  const btnBackToWorkouts = safeGetElement("btnBackToWorkouts");
  if (btnBackToWorkouts) {
    btnBackToWorkouts.addEventListener("click", () => {
      backToWorkoutSelection();
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
          <div class="user-name">👤 ${name}</div>
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
  
  console.log("Button elements found:", {
    HR: !!btnHR,
    Trainer: !!btnTrainer,
    PM: !!btnPM
  });
  
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
      const originalText = btnHR.textContent;
      btnHR.textContent = "검색 중...";
      
      try {
        await window.connectHeartRate();
      } catch (err) {
        console.error("HR connection error:", err);
      } finally {
        btnHR.disabled = false;
        btnHR.textContent = originalText;
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
     // ✅ "다음 단계로" 버튼 활성/비활성 제어
     const nextBtn = safeGetElement("btnToProfile");
     if (nextBtn) {
       // 규칙: 파워 소스(트레이너 또는 파워미터) 중 하나 이상 연결되면 진행 가능
       const readyPower = !!(pm || tr);
   
       // (옵션) 심박계도 필수로 요구하려면 아래 주석 해제:
       const ready = readyPower || !!hr;  // 파워소스, 심박계중 하나만 연결되면 
   
       //const ready = readyPower; // 기본: 파워 소스만 필수
       nextBtn.disabled = !ready;
       nextBtn.setAttribute('aria-disabled', String(!ready));
       nextBtn.title = ready ? '' : '블루투스 기기를 먼저 연결하세요';
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
                  console.log('[훈련완료] 🎯 4단계: 결과 화면으로 전환');
                  
                  // 화면 전환 전 추가 검증
                  const hasSession = !!window.trainingResults?.getCurrentSessionData?.();
                  console.log('[훈련완료] 세션 데이터 존재:', hasSession);
                  
                  if (typeof showScreen === "function") {
                    showScreen("resultScreen");
                    console.log('[훈련완료] 🎉 결과 화면 전환 완료');
                  } else {
                    console.error('[훈련완료] showScreen 함수를 찾을 수 없습니다');
                  }
                })
                .catch((criticalError) => {
                  console.error('[훈련완료] 💥 치명적 오류 발생:', criticalError);
                  
                  // 그래도 결과 화면으로 이동 시도
                  try {
                    if (typeof showToast === "function") {
                      showToast("오류가 발생했지만 결과를 표시합니다", "error");
                    }
                    if (typeof showScreen === "function") {
                      showScreen("resultScreen");
                    }
                  } catch (finalError) {
                    console.error('[훈련완료] 🔥 최종 복구도 실패:', finalError);
                    alert('결과 화면 표시 중 오류가 발생했습니다. 페이지를 새로고침해주세요.');
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

    safeSetText("tssValue", TSS.toFixed(1));
    safeSetText("kcalValue", Math.round(kcal));
    
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
  
  // 모든 화면 숨기기
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
    screen.style.display = 'none';
    screen.style.opacity = '0';
    screen.style.visibility = 'hidden';
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
    weight: parseFloat(document.getElementById('newUserWeight')?.value) || 0
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
  const requiredFields = ['newUserName', 'newUserPhone', 'newUserFTP', 'newUserWeight'];
  requiredFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field) {
      field.addEventListener('input', validateNewUserForm);
      field.addEventListener('blur', validateNewUserForm);
    }
  });
  
  console.log('✅ 인증 시스템 모든 이벤트 리스너 초기화 완료');
}

// 실시간 유효성 검사
function validateNewUserForm() {
  const name = document.getElementById('newUserName')?.value?.trim();
  const contact = document.getElementById('newUserPhone')?.value?.trim();
  const ftp = document.getElementById('newUserFTP')?.value;
  const weight = document.getElementById('newUserWeight')?.value;
  
  const submitBtn = document.querySelector('#newUserForm button[type="submit"]');
  if (!submitBtn) return;
  
  const isValid = name && contact && ftp && weight && /^010-\d{4}-\d{4}$/.test(contact);
  
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
  
  setTimeout(() => {
    // 모든 화면 완전히 숨기기
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
      screen.style.display = 'none';
      screen.style.opacity = '0';
      screen.style.visibility = 'hidden';
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
  
  // 간소화된 폼 데이터 수집 (이름, 전화번호, FTP, 몸무게만)
  const formData = {
    name: document.getElementById('newUserName')?.value?.trim(),
    contact: document.getElementById('newUserPhone')?.value?.trim(),
    ftp: parseInt(document.getElementById('newUserFTP')?.value) || 0,
    weight: parseFloat(document.getElementById('newUserWeight')?.value) || 0
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
        grade: '2',
        expiry_date: ''
      }, 'auth');
      
    } else if (typeof apiCreateUser === 'function') {
      // 직접 API 함수 사용 (폴백)
      registrationResult = await apiCreateUser({
        name: formData.name,
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
    weight: parseFloat(document.getElementById('newUserWeight')?.value) || 0
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
})();
