/* ==========================================================
   app.js (v1.4 FIXED) - 마스코트 이동 문제 수정 버전
   주요 수정사항:
   1. 중복된 updateMascotProgress 함수 제거
   2. 일관된 퍼센트 기반 파라미터 전달
   3. CSS 변수 방식으로 통일
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
  if (!window.connectedDevices) {
    window.connectedDevices = {
      trainer: null,
      powerMeter: null,
      heartRate: null
    };
  }

window.userPanelNeonMode = 'static';  // 'static' 고정 (동적 계산 끔)

   
  console.log('Global variables initialized safely');
})();

// ========== 안전 접근 헬퍼 함수들 ==========
function safeGetElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    console.warn(`Element with id '${id}' not found`);
  }
  return element;
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

    if (remain <= 0) {
      num.textContent = "START!";
      
      // 마지막 삐 소리 (더 길고 강함)
      playBeep(1320, 300, 0.3);

      clearInterval(timer);
      
      setTimeout(() => {
        overlay.classList.add("hidden");
        overlay.style.display = "none";
        
        // 실제 훈련 시작
        startWorkoutTraining();
      }, 800);
    } else {
      num.textContent = remain;
      playBeep(880, 120, 0.25);
    }
  }, 1000);
}


// 기본 beep 사운드 함수
function playBeep(frequency = 800, duration = 200, volume = 0.3, type = "sine") {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = type;
    
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration / 1000);
  } catch (error) {
    console.warn('Audio playback failed:', error);
  }
}


// ========== 타임라인/세그먼트 바 ==========

function segDurationSec(seg) {
  return (Number(seg.duration) || 0) * 60;
}

function segTargetW(seg, ftp) {
  const ftpPercent = getSegmentFtpPercent(seg);
  return Math.round(ftp * (ftpPercent / 100));
}

function getSegmentFtpPercent(seg) {
  // VO2Max를 125%로 변환
  if (String(seg.power_low || seg.ftp_percent || seg.target_power || '').toLowerCase().includes('vo2max')) {
    return 125;
  }
  
  // 기존 로직
  let percent = Number(seg.power_low) || Number(seg.ftp_percent) || Number(seg.target_power) || 50;
  
  // 100 이하면 백분율로 처리
  if (percent <= 100) {
    percent = percent * 1;
  } 
  // 100 초과면 실제 와트값 → FTP 백분율로 변환
  else {
    const ftp = Number(window.currentUser?.ftp) || 200;
    percent = Math.round((percent / ftp) * 100);
  }
  
  return Math.max(30, Math.min(200, percent));
}

// 누적 시작 시간 계산
function getCumulativeStartSec(segIndex) {
  const w = window.currentWorkout;
  if (!w?.segments) return 0;
  
  let cum = 0;
  for (let i = 0; i < segIndex && i < w.segments.length; i++) {
    cum += segDurationSec(w.segments[i]);
  }
  return cum;
}

// 포맷 함수들
function formatMMSS(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// 그룹핑 함수 (연속 휴식 병합)
function groupSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  
  const groups = [];
  let currentGroup = null;
  
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const type = normalizeType(seg);
    const isRest = (type === "rest");
    
    if (isRest && currentGroup && currentGroup.type === "rest") {
      // 연속 휴식: 기존 그룹에 추가
      currentGroup.segments.push(seg);
      currentGroup.endIndex = i + 1;
      currentGroup.duration += segDurationSec(seg);
    } else {
      // 새 그룹 시작
      if (currentGroup) {
        groups.push(currentGroup);
      }
      
      currentGroup = {
        type: isRest ? "rest" : "single",
        startIndex: i,
        endIndex: i + 1,
        segments: [seg],
        duration: segDurationSec(seg)
      };
    }
  }
  
  // 마지막 그룹 추가
  if (currentGroup) {
    groups.push(currentGroup);
  }
  
  return groups;
}

// 세그먼트 바 (타임라인) 구축
// ✅ [핵심수정] 마스코트 진행율을 전체 경과시간 기준으로 정확히 계산
function buildSegmentBar() {
  const container = document.getElementById("timelineSegments");
  if (!container) return;

  const w = window.currentWorkout;
  if (!w?.segments?.length) {
    container.innerHTML = '<p class="text-center muted">세그먼트가 없습니다.</p>';
    return;
  }

  const ftp = Number(window.currentUser?.ftp) || 200;
  
  // 전체 시간 계산
  const totalTime = w.segments.reduce((sum, seg) => sum + segDurationSec(seg), 0);
  
  // 그룹화 (연속 휴식 병합)
  const groups = groupSegments(w.segments);
  
  // HTML 생성
  let html = '';
  
  for (const group of groups) {
    const widthPercent = (group.duration / totalTime) * 100;
    
    if (group.type === "rest" && group.segments.length > 1) {
      // 휴식 그룹 (여러 세그먼트 병합)
      const groupClass = "timeline-group timeline-segment rest-group";
      html += `
        <div class="${groupClass}" 
             data-start-index="${group.startIndex}" 
             data-end-index="${group.endIndex}"
             style="width: ${widthPercent}%;">
          <div class="progress-fill"></div>
          <div class="segment-label">휴식 ${group.segments.length}개 (${formatMMSS(group.duration)})</div>
        </div>
      `;
    } else {
      // 개별 세그먼트들
      for (let i = group.startIndex; i < group.endIndex; i++) {
        const seg = group.segments[i - group.startIndex];
        const segWidthPercent = (segDurationSec(seg) / totalTime) * 100;
        const type = normalizeType(seg);
        const ftpPercent = getSegmentFtpPercent(seg);
        
        const segmentClass = `timeline-segment ${type}`;
        
        html += `
          <div class="${segmentClass}" 
               data-index="${i}" 
               style="width: ${segWidthPercent}%;">
            <div class="progress-fill"></div>
            <div class="segment-label">${seg.label || seg.segment_type || 'N/A'} ${ftpPercent}%</div>
          </div>
        `;
      }
    }
  }
  
  container.innerHTML = html;
  
  // 마스코트 초기 위치 설정 (0%)
  updateMascotProgress(0);
  
  console.log(`세그먼트 바 생성 완료: ${w.segments.length}개 세그먼트, ${groups.length}개 그룹`);
}

// ✅ 마스코트 진행 반영 (0~100 퍼센트 기준으로 통일)
function updateMascotProgress(percent) {
  try {
    const layer = document.getElementById('timelineMascotLayer');
    const mascot = document.getElementById('progressMascot');
    if (!layer || !mascot) return;

    // 0~100 안전 클램프
    const p = Math.max(0, Math.min(100, Number(percent) || 0));

    // 진행바(=layer) 실제 가로폭 기준으로 X 픽셀 산출
    const trackWidth = layer.clientWidth;
    // 마스코트가 살짝 안쪽에서 시작/끝나도록 6px 마진
    const margin = 6;
    const maxX = Math.max(0, trackWidth - mascot.clientWidth - margin * 2);
    const x = margin + (maxX * (p / 100));

    // CSS 변수로 전달 (progressMascot의 transform에서 사용)
    layer.style.setProperty('--mascot-x', `${x}px`);
    
    console.log(`🚴 마스코트 위치 업데이트: ${p.toFixed(1)}% → ${x.toFixed(1)}px`);
  } catch (e) {
    console.warn('updateMascotProgress error:', e);
  }
}

// ✅ 세그먼트 바 1초마다 갱신 (전체 진행율로 마스코트 동기화)
window.segmentStats = {}; // 세그먼트별 통계 저장

function updateSegmentBarTick() {
  const w = window.currentWorkout;
  if (!w?.segments?.length) return;

  const ftp = Number(window.currentUser?.ftp) || 200;
  const elapsed = Math.max(0, Number(window.trainingState?.elapsedSec) || 0);
  const total = Math.max(1, Number(window.trainingState?.totalSec) || 1);
  const segIndex = Math.max(0, Number(window.trainingState?.segIndex) || 0);

  // ✅ 전체 진행율 계산 (0~100)
  const totalPercent = Math.max(0, Math.min(100, (elapsed / total) * 100));

  // 1) 타임라인 그룹들의 완료/진행 상태 업데이트
  document.querySelectorAll('.timeline-group').forEach(groupEl => {
    const startIndex = parseInt(groupEl.dataset.startIndex) || 0;
    const endIndex = parseInt(groupEl.dataset.endIndex) || 0;

    // 그룹 시간 범위 계산
    let groupStart = 0;
    for (let i = 0; i < startIndex; i++) {
      groupStart += segDurationSec(w.segments[i]);
    }
    
    let groupDuration = 0;
    for (let i = startIndex; i < endIndex; i++) {
      groupDuration += segDurationSec(w.segments[i]);
    }
    const groupEnd = groupStart + groupDuration;

    // 상태 클래스 설정
    groupEl.classList.remove("is-complete", "is-current", "is-upcoming");
    if (elapsed >= groupEnd) {
      groupEl.classList.add("is-complete");
    } else if (elapsed >= groupStart && elapsed < groupEnd) {
      groupEl.classList.add("is-current");
    } else {
      groupEl.classList.add("is-upcoming");
    }
 
  });

  // 3) 세그먼트 상태 클래스 업데이트 + 달성도 기반 색상 적용
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


        // ✅ [수정] 마스코트 동기화 - 전체 진행율(퍼센트) 전달
        updateMascotProgress(totalPercent);

         // ⬇⬇ 이 지점 직후에 삽입 (for 루프 닫는 중괄호 다음 줄)  
      /* === 3.5) 전체 진행률 계산 + 전광판 갱신 + 마스코트 이동 === */
        try {
          const total = (window.trainingState && window.trainingState.totalSec) ? window.trainingState.totalSec : 0;
          const elapsedAll = (window.trainingState && window.trainingState.elapsedSec) ? window.trainingState.elapsedSec : 0;
          const percent = total > 0 ? Math.round((elapsedAll / total) * 100) : 0;
      
          const legend = document.getElementById('segmentProgressLegend');
          if (legend) legend.textContent = Math.max(0, Math.min(100, percent));

        } catch (e) {
          console.warn('updateSegmentBarTick: progress/motif update error', e);
        }
      /* === /3.5 === */


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
// ✅ [수정] updateTimeUI 함수 - 전체 진행율로 마스코트 업데이트
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
      safeSetText("segmentProgressLegend", String(totalPct)); // ✅ 전체 %로 변경
       
      // ✅ [수정] 마스코트 위치를 전체 진행율로 동기화 (0~100%)
      updateMascotProgress(totalPct);
       
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
   
  if (!w?.segments?.length) {
    console.error('워크아웃이 없거나 세그먼트가 비어있습니다.');
    return;
  }

  // 1) trainingState 전체 초기화
  const ts = window.trainingState;
  ts.elapsedSec = 0;
  ts.segIndex = 0;
  ts.segElapsedSec = 0;
  ts.paused = false;
  ts.totalSec = w.segments.reduce((sum, seg) => sum + segDurationSec(seg), 0);
  ts.segEnds = [];
  
  let cum = 0;
  for (const seg of w.segments) {
    cum += segDurationSec(seg);
    ts.segEnds.push(cum);
  }

  // === 2) 시간관리 정밀화 (Wall Clock 벽시계 기준) ===
  ts.workoutStartMs  = Date.now();      // 워크아웃 시작 절대시각(ms)
  ts.pauseAccumMs   = 0;          // 일시정지 누적(ms)
  ts.pausedAtMs     = null;       // 일시정지 시작 시각(ms)

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
    if (window.trainingState.elapsedSec >= window.trainingState.totalSec) {
      console.log('훈련 완료!');
      clearInterval(window.trainingState.timerId);
      window.trainingState.timerId = null;

      // 활성 카운트다운 정지
      stopSegmentCountdown();

      if (typeof setPaused === "function") setPaused(false);
      if (typeof showToast === "function") showToast("훈련이 완료되었습니다!");
      if (typeof showScreen === "function") showScreen("resultScreen");
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
     }
     /* ⬆⬆⬆ 여기까지 추가 ⬆⬆⬆ */
}

// 전역에서 segBar 초기화
window.segBar = { sumPower: {}, samples: {} };

// ========== 훈련 관련 함수들 ==========

function startWorkoutTraining() {
  console.log('훈련 시작');
  
  if (!window.currentWorkout) {
    showToast('워크아웃이 선택되지 않았습니다.');
    return;
  }

  // 초기화
  window.segBar = { sumPower: {}, samples: {} };
  resetTrainingMetrics();
  
  if (typeof buildSegmentBar === "function") buildSegmentBar();
  startSegmentLoop();
  
  // 화면 표시
  if (typeof showScreen === "function") showScreen('trainingScreen');
  
  /* ⬇⬇⬇ A) 훈련 시작 지점 — 여기 추가 ⬇⬇⬇ */
  window.trainingState = window.trainingState || {};
  window.trainingState.isRunning = true;    // 훈련 상태 on

  if (typeof ScreenAwake !== "undefined" && ScreenAwake.acquire) {
    ScreenAwake.acquire();                  // 화면 항상 켜짐 요청
  }
  /* ⬆⬆⬆ 여기까지 추가 ⬆⬆⬆ */
  
  showToast('훈련이 시작되었습니다!');
}

// ========== 기타 함수들 (나머지 코드는 기존과 동일) ==========

// 스킵 기능
function skipCurrentSegment() {
  if (!window.currentWorkout?.segments) {
    console.warn('현재 워크아웃이 없습니다.');
    return;
  }

  const currentIndex = window.trainingState?.segIndex || 0;
  
  if (currentIndex >= window.currentWorkout.segments.length - 1) {
    console.log('마지막 세그먼트입니다.');
    showToast('마지막 세그먼트입니다.');
    return;
  }

  // 다음 세그먼트 시작 시점으로 점프
  const nextStartSec = getCumulativeStartSec(currentIndex + 1);
  
  if (typeof window.setElapsedSecSafely === "function") {
    window.setElapsedSecSafely(nextStartSec);
  } else {
    window.trainingState.elapsedSec = nextStartSec;
  }
  
  window.trainingState.segIndex = currentIndex + 1;
  window.trainingState.segElapsedSec = 0;

  // 카운트다운 정리
  if (segmentCountdownActive) {
    stopSegmentCountdown();
  }

  applySegmentTarget(window.trainingState.segIndex);
  
  console.log(`세그먼트 ${currentIndex + 1}에서 ${currentIndex + 2}로 스킵`);
  showToast(`세그먼트 ${currentIndex + 2}로 건너뛰었습니다.`);
}

// 일시정지/재개
function setPaused(paused) {
  const ts = window.trainingState;
  if (!ts) return;

  const nowMs = Date.now();
  
  if (paused && !ts.paused) {
    // 일시정지 시작
    ts.paused = true;
    ts.pausedAtMs = nowMs;
    console.log('훈련 일시정지');
    showToast('훈련이 일시정지되었습니다.');
    
    // 카운트다운 일시중단
    if (segmentCountdownActive) {
      stopSegmentCountdown();
    }
    
  } else if (!paused && ts.paused) {
    // 일시정지 해제
    ts.paused = false;
    
    // 일시정지된 시간을 누적에 더함
    if (ts.pausedAtMs) {
      ts.pauseAccumMs += (nowMs - ts.pausedAtMs);
      ts.pausedAtMs = null;
    }
    
    console.log('훈련 재개');
    showToast('훈련이 재개되었습니다.');
  }
}

// 훈련 완전 중지
function stopTraining() {
  console.log('훈련 중지');
  
  stopSegmentLoop();
  
  if (typeof setPaused === "function") setPaused(false);
  
  showToast('훈련이 중지되었습니다.');
  
  // 결과 화면으로 이동할지 확인
  if (confirm('결과를 확인하시겠습니까?')) {
    if (typeof showScreen === "function") showScreen('resultScreen');
  } else {
    if (typeof showScreen === "function") showScreen('profileScreen');
  }
}

// TSS/칼로리 계산
function updateTrainingMetrics() {
  const power = Number(window.liveData?.power) || 0;
  const ftp = Number(window.currentUser?.ftp) || 200;
  const weight = Number(window.currentUser?.weight) || 70;
  
  // TSS 계산 (간단화된 버전)
  const intensityFactor = power / ftp;
  const tssPerSecond = (intensityFactor * intensityFactor * 100) / 3600;
  
  window.trainingState.totalTSS = (window.trainingState.totalTSS || 0) + tssPerSecond;
  
  // 칼로리 계산 (대략적)
  const caloriesPerSecond = (power * 1.5) / 3600;
  window.trainingState.totalCalories = (window.trainingState.totalCalories || 0) + caloriesPerSecond;
  
  // UI 업데이트
  safeSetText("tssValue", String(Math.round(window.trainingState.totalTSS || 0)));
  safeSetText("kcalValue", String(Math.round(window.trainingState.totalCalories || 0)));
}

function resetTrainingMetrics() {
  window.trainingState.totalTSS = 0;
  window.trainingState.totalCalories = 0;
  safeSetText("tssValue", "0");
  safeSetText("kcalValue", "0");
}

// *** 핵심 수정: updateTrainingDisplay 함수 - currentPower 변수 초기화 문제 해결 ***
function updateTrainingDisplay() {
  try {
    // 기본값 설정
    let currentPower = Number(window.liveData?.power) || 0;
    const targetPower = Number(window.liveData?.targetPower) || 0;
    const heartRate = Number(window.liveData?.heartRate) || 0;
    const cadence = Number(window.liveData?.cadence) || 0;

    // DOM 요소 업데이트
    safeSetText("currentPowerValue", String(currentPower));
    safeSetText("targetPowerValue", String(targetPower));
    safeSetText("heartRateValue", heartRate > 0 ? String(heartRate) : "-");
    safeSetText("cadenceValue", cadence > 0 ? String(cadence) : "-");

    // 달성도 계산
    let achievementPercent = 0;
    if (targetPower > 0) {
      achievementPercent = Math.round((currentPower / targetPower) * 100);
    }

    // 프로그레스 바 업데이트
    const progressBar = document.getElementById("powerProgressBar");
    if (progressBar) {
      const clampedPercent = Math.max(0, Math.min(200, achievementPercent));
      progressBar.style.width = `${clampedPercent}%`;
      
      // 달성도별 색상 적용
      progressBar.className = "enhanced-power-progress-bar";
      if (achievementPercent < 85) {
        progressBar.classList.add("achievement-low");
      } else if (achievementPercent >= 85 && achievementPercent <= 115) {
        progressBar.classList.add("achievement-good");
      } else if (achievementPercent > 115) {
        progressBar.classList.add("achievement-high");
      }
    }

    safeSetText("achievementValueBar", String(achievementPercent));

  } catch (error) {
    console.error('updateTrainingDisplay 오류:', error);
  }
}

// 토스트 메시지 표시
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 350);
  }, duration);
}

// 화면 전환
function showScreen(screenId) {
  // 모든 화면 숨기기
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  
  // 선택된 화면 표시
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.classList.add('active');
  }
}

// ========== 이벤트 리스너 설정 ==========
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM 로드 완료');
  
  // 화면 깨우기 초기화
  if (typeof ScreenAwake !== "undefined" && ScreenAwake.init) {
    ScreenAwake.init();
  }
  
  // 훈련 시작 버튼
  const btnStartTraining = document.getElementById('btnStartTraining');
  if (btnStartTraining) {
    btnStartTraining.addEventListener('click', () => {
      startWithCountdown(5);
    });
  }
  
  // 일시정지/재개 버튼
  const btnTogglePause = document.getElementById('btnTogglePause');
  if (btnTogglePause) {
    btnTogglePause.addEventListener('click', () => {
      const isPaused = window.trainingState?.paused || false;
      setPaused(!isPaused);
      
      // 버튼 텍스트 업데이트
      btnTogglePause.textContent = isPaused ? '⏸️' : '▶️';
    });
  }
  
  // 세그먼트 스킵 버튼
  const btnSkipSegment = document.getElementById('btnSkipSegment');
  if (btnSkipSegment) {
    btnSkipSegment.addEventListener('click', skipCurrentSegment);
  }
  
  // 훈련 중지 버튼
  const btnStopTraining = document.getElementById('btnStopTraining');
  if (btnStopTraining) {
    btnStopTraining.addEventListener('click', () => {
      if (confirm('훈련을 중지하시겠습니까?')) {
        stopTraining();
      }
    });
  }
});

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

console.log('App.js v1.4 loaded successfully - 마스코트 이동 문제 수정 완료');
