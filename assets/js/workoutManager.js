/* ==========================================================
   완전 통합 워크아웃 관리 모듈 (completeWorkoutManager.js) - 최종 버전
   - 세그먼트 개수 무제한 통합 저장
   - 반복 패턴 감지 및 그룹화 표시
   - 최적화된 렌더링 (대용량 세그먼트 지원)
   - 모든 버그 수정 및 성능 최적화
========================================================== */

// 안전한 초기화 체크
if (typeof window === 'undefined') {
  throw new Error('이 스크립트는 브라우저 환경에서만 실행할 수 있습니다.');
}

// HTML 이스케이프 함수 (XSS 방지)
// HTML 이스케이프 함수 (XSS 방지)
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) {
    return '';
  }
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 안전한 문자열 처리 (URI 인코딩용) - 특수문자 허용 범위 확대
function safeStringForUri(str) {
  if (!str) return '';
  return String(str)
    .replace(/[<>]/g, '') // 위험한 HTML 태그만 제거
    .trim()
    .substring(0, 50); // 길이 제한 확대
}


// 세그먼트 타입 정규화 함수 추가
function normalizeSegmentType(type) {
  if (!type) return 'interval';
  
  const typeMap = {
    'warmup': 'warmup',
    'warm-up': 'warmup',
    'warm_up': 'warmup',
    'interval': 'interval',
    'work': 'interval',
    'rest': 'rest',
    'recovery': 'rest',
    'cooldown': 'cooldown',
    'cool-down': 'cooldown',
    'cool_down': 'cooldown'
  };
  
  const normalized = typeMap[String(type).toLowerCase()];
  return normalized || 'interval';
}



// 데이터 검증 헬퍼 함수들
// 데이터 검증 헬퍼 함수들
function validateWorkoutData(workout) {
  if (!workout || typeof workout !== 'object') {
    console.warn('워크아웃 데이터가 객체가 아님:', workout);
    return false;
  }
  // id가 null이거나 undefined인 경우 제외 (빈 문자열이나 0은 허용)
  if (workout.id === null || workout.id === undefined) {
    console.warn('워크아웃 ID가 없음:', workout);
    return false;
  }
  // id가 빈 문자열인 경우도 제외하지 않음 (필요시 추가)
  return true;
}

function normalizeWorkoutData(workout) {
  // status 처리: '보이기' 또는 '숨기기' 값이 있으면 그대로 사용, 없으면 기본값 '보이기'
  let status = '보이기';
  if (workout.status !== null && workout.status !== undefined && workout.status !== '') {
    const statusStr = String(workout.status).trim();
    if (statusStr === '보이기' || statusStr === '숨기기') {
      status = statusStr;
    }
  }
  
  return {
    id: workout.id,
    title: String(workout.title || '제목 없음'),
    description: String(workout.description || ''),
    author: String(workout.author || '미상'),
    status: status,
    total_seconds: Number(workout.total_seconds) || 0,
    publish_date: workout.publish_date || null,
    segments: Array.isArray(workout.segments) ? workout.segments : []
  };
}

// 안전한 DOM 요소 접근 헬퍼
function safeGetElement(id, required = false) {
  const element = document.getElementById(id);
  if (!element && required) {
    console.error(`필수 요소를 찾을 수 없습니다: ${id}`);
    throw new Error(`Required element not found: ${id}`);
  }
  return element;
}

// 전역 변수로 현재 모드 추적
let isWorkoutEditMode = false;
let currentEditWorkoutId = null;

// 세그먼트 관련 전역 변수
let workoutSegments = [];
let currentEditingSegmentIndex = null;

// 반복용 세그먼트 임시 저장소
let repeatSegments = [];
let currentEditingRepeatIndex = null;

// 세그먼트 분할 전송 설정 (최적화된 버전)
const SEGMENT_BATCH_SIZE = 2;
const MAX_URL_LENGTH = 1800;
const MAX_RETRIES = 3;
const BATCH_DELAY = 1000;
const JSONP_TIMEOUT = 60000; // 60초 타임아웃

// 필수 설정 확인 및 초기화
function initializeWorkoutManager() {
  if (!window.GAS_URL) {
    // GAS_URL이 없어도 경고만 출력하고 계속 진행 (개인 대시보드 등에서 세그먼트 그래프만 필요한 경우)
    console.warn('GAS_URL이 설정되지 않았습니다. 워크아웃 저장/로드 기능은 사용할 수 없습니다.');
    console.log('CONFIG:', window.CONFIG);
    window.GAS_URL = window.CONFIG?.GAS_WEB_APP_URL || '';
    
    if (!window.GAS_URL) {
      console.warn('CONFIG에서도 GAS_URL을 찾을 수 없습니다. 세그먼트 그래프 표시 기능만 사용 가능합니다.');
      window.GAS_URL = '';
      // GAS_URL이 없어도 계속 진행 (drawSegmentGraph 등은 GAS_URL이 필요 없음)
    } else {
      console.log('GAS_URL 설정됨:', window.GAS_URL);
    }
  } else {
    console.log('GAS_URL 설정됨:', window.GAS_URL);
  }
  
  if (typeof window.showToast !== 'function') {
    window.showToast = function(message) {
      console.log('Toast:', message);
    };
  }
  
  if (typeof window.showScreen !== 'function') {
    window.showScreen = function(screenId) {
      console.log('Navigate to:', screenId);
    };
  }
}

// 개선된 JSONP 요청 함수 (60초 타임아웃)
function jsonpRequest(url, params = {}) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string') {
      reject(new Error('유효하지 않은 URL입니다.'));
      return;
    }
    
    // 고유한 콜백 이름 생성 (타임스탬프 + 랜덤)
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const callbackName = 'jsonp_callback_' + timestamp + '_' + random;
    const script = document.createElement('script');
    let isResolved = false;
    
    // 콜백 함수를 먼저 정의 (스크립트 로드 전에 반드시 정의되어야 함)
    window[callbackName] = function(data) {
      if (isResolved) return;
      isResolved = true;
      
      console.log('JSONP response received:', data);
      cleanup();
      resolve(data);
    };
    
    // 콜백 함수가 제대로 정의되었는지 확인
    if (typeof window[callbackName] !== 'function') {
      reject(new Error('JSONP 콜백 함수 생성 실패'));
      return;
    }
    
    function cleanup() {
      try {
        if (window[callbackName]) {
          delete window[callbackName];
        }
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      } catch (e) {
        console.warn('JSONP cleanup warning:', e);
      }
    }
    
    script.onerror = function() {
      if (isResolved) return;
      isResolved = true;
      
      console.error('JSONP script loading failed');
      cleanup();
      reject(new Error('네트워크 연결 오류'));
    };
    
    try {
      // 안전한 수동 인코딩 방식 사용
      const urlParts = [];
      Object.keys(params).forEach(key => {
        if (params[key] !== null && params[key] !== undefined) {
          const value = String(params[key]);
          // segments 데이터는 Base64로 인코딩하여 안전하게 전송
          if (key === 'segments') {
            try {
              const base64Data = btoa(unescape(encodeURIComponent(value)));
              urlParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(base64Data)}`);
            } catch (e) {
              console.warn('Base64 인코딩 실패, 일반 인코딩 사용:', e);
              urlParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
            }
          } else {
            urlParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
          }
        }
      });
      urlParts.push(`callback=${encodeURIComponent(callbackName)}`);
      
      const finalUrl = `${url}?${urlParts.join('&')}`;
    
      if (finalUrl.length > 2000) {
        throw new Error('요청 URL이 너무 깁니다. 데이터를 줄여주세요.');
      }
      
      // 콜백 함수가 정의된 후 스크립트 추가
      script.src = finalUrl;
      document.head.appendChild(script);
      
      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          console.warn('JSONP request timeout for URL:', url);
          cleanup();
          reject(new Error(`요청 시간 초과: ${url}`));
        }
      }, JSONP_TIMEOUT); // 60초 타임아웃
      
    } catch (error) {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        reject(error);
      }
    }
  });
}

// 재시도 로직이 포함된 JSONP 요청 함수
async function jsonpRequestWithRetry(url, params = {}, maxRetries = MAX_RETRIES) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`API 요청 시도 ${attempt}/${maxRetries}:`, params.action);
      const result = await jsonpRequest(url, params);
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`시도 ${attempt} 실패:`, error.message);
      
      if (attempt < maxRetries) {
        const delay = attempt * 2000;
        console.log(`${delay/1000}초 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// ==========================================================
// 반복 패턴 감지 및 그룹화 시스템
// ==========================================================

/**
 * 세그먼트 배열에서 반복 패턴을 감지하고 그룹화
 */
function detectAndGroupSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }
  
  console.log('세그먼트 그룹화 시작:', segments.length, '개');
  
  const groupedSegments = [];
  let currentIndex = 0;
  
  while (currentIndex < segments.length) {
    const patternResult = findRepeatingPattern(segments, currentIndex);
    
    if (patternResult.found && patternResult.repeatCount >= 2) {
      const groupedSegment = createGroupedSegment(patternResult);
      groupedSegments.push(groupedSegment);
      currentIndex = patternResult.endIndex;
      
      console.log(`반복 패턴 감지: ${patternResult.pattern.length}개 세그먼트 × ${patternResult.repeatCount}회`);
    } else {
      groupedSegments.push({
        type: 'single',
        segment: segments[currentIndex],
        originalIndex: currentIndex
      });
      currentIndex++;
    }
  }
  
  console.log('그룹화 완료:', groupedSegments.length, '개 그룹');
  return groupedSegments;
}

/**
 * 특정 위치에서 반복 패턴 찾기
 */
function findRepeatingPattern(segments, startIndex) {
  const maxPatternLength = Math.min(10, Math.floor((segments.length - startIndex) / 2));
  
  for (let patternLength = 1; patternLength <= maxPatternLength; patternLength++) {
    const pattern = segments.slice(startIndex, startIndex + patternLength);
    const repeatResult = checkPatternRepeat(segments, startIndex, pattern);
    
    if (repeatResult.repeatCount >= 2) {
      return {
        found: true,
        pattern: pattern,
        repeatCount: repeatResult.repeatCount,
        startIndex: startIndex,
        endIndex: repeatResult.endIndex,
        totalDuration: repeatResult.totalDuration
      };
    }
  }
  
  return { found: false };
}

/**
 * 패턴이 몇 번 반복되는지 확인
 */
function checkPatternRepeat(segments, startIndex, pattern) {
  let repeatCount = 0;
  let currentIndex = startIndex;
  let totalDuration = 0;
  
  while (currentIndex + pattern.length <= segments.length) {
    const currentSegment = segments.slice(currentIndex, currentIndex + pattern.length);
    
    if (isPatternMatch(pattern, currentSegment)) {
      repeatCount++;
      totalDuration += pattern.reduce((sum, seg) => sum + (seg.duration_sec || 0), 0);
      currentIndex += pattern.length;
    } else {
      break;
    }
  }
  
  return {
    repeatCount: repeatCount,
    endIndex: currentIndex,
    totalDuration: totalDuration
  };
}

/**
 * 두 패턴이 일치하는지 확인 (라벨 제외)
 */
function isPatternMatch(pattern1, pattern2) {
  if (pattern1.length !== pattern2.length) {
    return false;
  }
  
  for (let i = 0; i < pattern1.length; i++) {
    const seg1 = pattern1[i];
    const seg2 = pattern2[i];
    
    if (
      seg1.segment_type !== seg2.segment_type ||
      seg1.duration_sec !== seg2.duration_sec ||
      seg1.target_value !== seg2.target_value ||
      seg1.ramp !== seg2.ramp ||
      seg1.ramp_to_value !== seg2.ramp_to_value
    ) {
      return false;
    }
  }
  
  return true;
}

/**
 * 그룹화된 세그먼트 객체 생성
 */
function createGroupedSegment(patternResult) {
  const { pattern, repeatCount, totalDuration } = patternResult;
  
  const groupLabel = pattern[0].label || '반복 세그먼트';
  
  return {
    type: 'group',
    groupLabel: groupLabel,
    pattern: pattern,
    repeatCount: repeatCount,
    totalDuration: totalDuration,
    totalMinutes: Math.round(totalDuration / 60),
    startIndex: patternResult.startIndex,
    endIndex: patternResult.endIndex
  };
}

/**
 * 개별 세그먼트 프리뷰 생성
 */
function createSingleSegmentPreview(segment) {
  if (!segment || typeof segment !== 'object') {
    return '';
  }
  
  const minutes = Math.floor((Number(segment.duration_sec) || 0) / 60);
  const seconds = (Number(segment.duration_sec) || 0) % 60;
  const duration = seconds > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${minutes}분`;
  
  const segmentTypeClass = getSegmentTypeClass(segment.segment_type);
  const targetType = segment.target_type || 'ftp_pct';
  
  // target_type에 따라 표시 형식 변경
  let targetDisplay = '';
  if (targetType === 'ftp_pct') {
    const ftpValue = Number(segment.target_value) || 0;
    targetDisplay = `${ftpValue}% FTP`;
  } else if (targetType === 'cadence_rpm') {
    const rpmValue = Number(segment.target_value) || 0;
    targetDisplay = `${rpmValue} rpm`;
  } else if (targetType === 'dual') {
    // dual 타입: "100/120" 형식 파싱
    const targetValue = segment.target_value;
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim());
      if (parts.length >= 2) {
        targetDisplay = `${parts[0]}% FTP / ${parts[1]} rpm`;
      } else {
        targetDisplay = `${parts[0]}% FTP`;
      }
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      targetDisplay = `${targetValue[0]}% FTP / ${targetValue[1]} rpm`;
    } else {
      const numValue = Number(targetValue);
      if (numValue > 1000 && numValue < 1000000) {
        const str = String(numValue);
        if (str.length >= 4) {
          const rpmPart = str.slice(-3);
          const ftpPart = str.slice(0, -3);
          targetDisplay = `${ftpPart}% FTP / ${rpmPart} rpm`;
        } else {
          targetDisplay = `${numValue}% FTP`;
        }
      } else {
        targetDisplay = `${numValue || 100}% FTP`;
      }
    }
  } else {
    targetDisplay = `${Number(segment.target_value) || 0}% FTP`;
  }
  
  return `
    <div class="segment-item ${segmentTypeClass}">
      <h4>${escapeHtml(segment.label || '세그먼트')}</h4>
      <div class="ftp-percent">${targetDisplay}</div>
      <div class="duration">${duration}</div>
    </div>
  `;
}

/**
 * 그룹화된 세그먼트 프리뷰 생성
 */
function createGroupedSegmentPreview(groupedItem) {
  const { groupLabel, pattern, repeatCount, totalMinutes } = groupedItem;
  
  const patternInfo = pattern.map(segment => {
    const totalSeconds = segment.duration_sec || 0;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    let duration;
    if (totalSeconds < 60) {
      duration = `${totalSeconds}s`;
    } else if (seconds > 0) {
      duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } else {
      duration = `${minutes}분`;
    }
    
    // target_type에 따라 표시 형식 변경
    const targetType = segment.target_type || 'ftp_pct';
    let targetDisplay = '';
    if (targetType === 'ftp_pct') {
      const ftpValue = Number(segment.target_value) || 0;
      targetDisplay = `FTP ${ftpValue}%`;
    } else if (targetType === 'cadence_rpm') {
      const rpmValue = Number(segment.target_value) || 0;
      targetDisplay = `${rpmValue} rpm`;
    } else if (targetType === 'dual') {
      // dual 타입: "100/120" 형식 파싱
      const targetValue = segment.target_value;
      if (typeof targetValue === 'string' && targetValue.includes('/')) {
        const parts = targetValue.split('/').map(s => s.trim());
        if (parts.length >= 2) {
          targetDisplay = `FTP ${parts[0]}% / ${parts[1]} rpm`;
        } else {
          targetDisplay = `FTP ${parts[0]}%`;
        }
      } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
        targetDisplay = `FTP ${targetValue[0]}% / ${targetValue[1]} rpm`;
      } else {
        targetDisplay = `FTP ${Number(targetValue) || 100}%`;
      }
    } else {
      targetDisplay = `FTP ${Number(segment.target_value) || 0}%`;
    }
    
    // 줄바꿈 적용: 공백 대신 \n 사용
    return `${targetDisplay}\n${duration}`;
  }).join('\n'); // 세그먼트 간에도 줄바꿈 적용
  
  const mainSegmentTypeClass = getSegmentTypeClass(pattern[0].segment_type);
  
  return `
    <div class="segment-item grouped-segment ${mainSegmentTypeClass}">
      <div class="group-header">
        <h4>${escapeHtml(groupLabel)}</h4>
      </div>
      <div class="group-pattern">
        ${patternInfo} <span class="repeat-badge-inline">× ${repeatCount}회</span>
      </div>
      <div class="group-total">
        <strong>${totalMinutes}분</strong>
      </div>
    </div>
  `;
}

/**
 * 개선된 세그먼트 프리뷰 업데이트 (그래프 형식)
 */
function updateSegmentPreviewGrouped(segments) {
  const segDiv = safeGetElement('segmentPreview');
  if (!segDiv) return;

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    segDiv.innerHTML = '<div class="text-center muted">세그먼트 정보가 없습니다.</div>';
    return;
  }

  // 반복 훈련은 개별 그래프로 표시 (그룹화하지 않음)
  // 모든 세그먼트를 평탄화하여 개별 표시
  const flatSegments = [];
  segments.forEach(seg => {
    flatSegments.push(seg);
  });

  // Canvas 그래프 생성
  segDiv.innerHTML = createSegmentGraph(flatSegments);
  
  // Canvas에 실제로 그리기 (DOM이 준비된 후)
  setTimeout(() => {
    drawSegmentGraph(flatSegments);
  }, 100);
}

/**
 * 세그먼트 그래프 HTML 생성
 */
function createSegmentGraph(segments) {
  if (!segments || segments.length === 0) return '';
  
  const canvasId = 'segmentPreviewGraph';
  return `
    <div class="segment-graph-container">
      <canvas id="${canvasId}"></canvas>
    </div>
  `;
}

/**
 * 세그먼트 그래프 그리기 (Canvas 기반)
 * @param {Array} segments - 세그먼트 배열
 * @param {number} currentSegmentIndex - 현재 진행 중인 세그먼트 인덱스 (옵션)
 * @param {string} canvasId - Canvas ID (기본값: 'segmentPreviewGraph')
 */
function drawSegmentGraph(segments, currentSegmentIndex = -1, canvasId = 'segmentPreviewGraph') {
  if (!segments || segments.length === 0) return;
  
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  // 사용자 FTP 가져오기
  // 개인 대시보드의 경우 individual.js의 userFTP 변수 사용
  let ftp = 200;
  if (canvasId === 'individualSegmentGraph') {
    // individual.js에서 전역 변수로 설정된 userFTP 사용
    ftp = Number(window.userFTP) || Number(window.currentUser?.ftp) || 200;
  } else {
    ftp = Number(window.currentUser?.ftp) || 200;
  }
  
  // 총 시간 계산
  const totalSeconds = segments.reduce((sum, seg) => sum + (seg.duration_sec || 0), 0);
  if (totalSeconds <= 0) return;
  
  // 그래프 크기 설정 (개인 대시보드용으로 작은 크기)
  let graphHeight, graphWidth, padding;
  if (canvasId === 'individualSegmentGraph') {
    // 개인 대시보드용: 컨테이너 높이에 맞춰 동적으로 설정
    const container = canvas.parentElement;
    let containerHeight = 100; // 기본값
    
    if (container) {
      // 컨테이너의 실제 높이 측정 (여러 시도로 정확도 향상)
      containerHeight = container.clientHeight || container.offsetHeight || 100;
      
      // 만약 높이가 0이면 부모 요소에서 측정 시도
      if (containerHeight === 0 && container.parentElement) {
        containerHeight = container.parentElement.clientHeight || 100;
      }
    }
    
    // 컨테이너 높이를 활용 (최소 100px, 최대 400px로 제한하여 적절한 크기 유지)
    graphHeight = Math.max(100, Math.min(400, containerHeight));
    graphWidth = Math.max(400, Math.min(600, totalSeconds * 2)); // 가로축 너비 (시간에 비례, 최소 400px, 최대 600px)
    padding = { 
      top: Math.max(8, Math.floor(graphHeight * 0.08)), // 높이에 비례한 패딩
      right: 20, 
      bottom: Math.max(20, Math.floor(graphHeight * 0.12)), 
      left: 35 
    };
  } else {
    // 기본 크기
    graphHeight = 300; // 세로축 높이 (파워)
    graphWidth = Math.max(800, Math.min(1200, totalSeconds * 3)); // 가로축 너비 (시간에 비례, 최소 800px, 최대 1200px)
    padding = { top: 20, right: 40, bottom: 50, left: 70 };
  }
  const chartWidth = graphWidth - padding.left - padding.right;
  const chartHeight = graphHeight - padding.top - padding.bottom;
  
  // Canvas 실제 픽셀 크기 설정 (그래프가 이 크기로 그려짐)
  canvas.width = graphWidth;
  canvas.height = graphHeight;
  
  // CSS 크기 설정 (컨테이너에 맞춤)
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.maxWidth = '100%';
  
  const ctx = canvas.getContext('2d');
  
  // 배경 그리기
  if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph') {
    // 훈련 화면용 및 개인 대시보드용: 검정 투명 배경
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, graphWidth, graphHeight);
  } else {
    // 훈련 준비 화면용: 부드러운 그라데이션 배경
    const bgGradient = ctx.createLinearGradient(0, 0, 0, graphHeight);
    bgGradient.addColorStop(0, '#ffffff');
    bgGradient.addColorStop(1, '#f8f9fa');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, graphWidth, graphHeight);
    
    // 그림자 효과
    ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
  }
  
  // 축 그리기 (부드러운 색상)
  ctx.shadowColor = 'transparent'; // 축에는 그림자 제거
  if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // 훈련 화면 및 개인 대시보드: 밝은 색상
  } else {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)'; // 훈련 준비 화면: 어두운 색상
  }
  ctx.lineWidth = 2;
  
  // 세로축 (파워)
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartHeight);
  ctx.stroke();
  
  // 가로축 (시간)
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + chartHeight);
  ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  ctx.stroke();
  
  // 최대 파워 계산 (세그먼트 중 최대값의 1.2배 또는 FTP의 1.5배 중 큰 값)
  let maxTargetPower = ftp * 1.5;
  segments.forEach(seg => {
    const ftpPercent = getSegmentFtpPercentForPreview(seg);
    const targetPower = ftp * (ftpPercent / 100);
    if (targetPower > maxTargetPower) {
      maxTargetPower = targetPower * 1.1;
    }
  });
  
  // FTP 가이드 라인 (부드러운 색상)
  const ftpPower = ftp;
  const ftpY = padding.top + chartHeight - (chartHeight * (ftpPower / maxTargetPower));
  
  // FTP Y 위치를 전역 변수로 저장 (마스코트 위치 계산용)
  if (canvasId === 'trainingSegmentGraph') {
    window._segmentGraphFtpY = ftpY;
    window._segmentGraphPadding = padding;
    window._segmentGraphChartWidth = chartWidth;
    window._segmentGraphTotalSeconds = totalSeconds;
  }
  if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph') {
    ctx.shadowColor = 'rgba(234, 179, 8, 0.5)';
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.9)'; // 훈련 화면 및 개인 대시보드: 더 밝은 노란색
  } else {
    ctx.shadowColor = 'rgba(234, 179, 8, 0.3)';
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.7)'; // 훈련 준비 화면
  }
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(padding.left, ftpY);
  ctx.lineTo(padding.left + chartWidth, ftpY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowColor = 'transparent';
  
  // FTP 라벨 (부드러운 배경)
  const labelText = `FTP ${ftp}W`;
  const metrics = ctx.measureText(labelText);
  const labelWidth = metrics.width + 8;
  const labelHeight = 18;
  const labelX = padding.left - 10 - labelWidth;
  const labelY = ftpY - labelHeight / 2;
  
  if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph') {
    // 훈련 화면 및 개인 대시보드: 밝은 배경과 텍스트
    ctx.fillStyle = 'rgba(251, 191, 36, 0.3)';
    ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
    ctx.fillStyle = '#fbbf24'; // 밝은 노란색
  } else {
    // 훈련 준비 화면
    ctx.fillStyle = 'rgba(251, 191, 36, 0.2)';
    ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
    ctx.fillStyle = '#f59e0b';
  }
  // 개인 대시보드용 폰트 크기 조정
  const ftpLabelFontSize = (canvasId === 'individualSegmentGraph') ? 'bold 8px sans-serif' : 'bold 12px sans-serif';
  ctx.font = ftpLabelFontSize;
  ctx.textAlign = 'right';
  ctx.fillText(labelText, padding.left - 10, ftpY + 4);
  
  // 세로축 눈금 (파워)
  const powerSteps = 5;
  for (let i = 0; i <= powerSteps; i++) {
    const power = (maxTargetPower * i) / powerSteps;
    const y = padding.top + chartHeight - (chartHeight * (power / maxTargetPower));
    
    // 격자선 (부드러운 색상)
    if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; // 훈련 화면 및 개인 대시보드: 밝은 색상
    } else {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'; // 훈련 준비 화면: 어두운 색상
    }
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // 눈금 표시
    if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // 훈련 화면 및 개인 대시보드: 밝은 색상
    } else {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)'; // 훈련 준비 화면: 어두운 색상
    }
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left - 5, y);
    ctx.lineTo(padding.left, y);
    ctx.stroke();
    
    // 파워 값 표시 (개인 대시보드의 경우 FTP 기준 값으로 표시)
    if (canvasId === 'individualSegmentGraph') {
      // 개인 대시보드: FTP 기준 백분율로 표시 (예: 50%, 100%, 150%)
      const ftpPercent = Math.round((power / ftp) * 100);
      if (canvasId === 'individualSegmentGraph') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // 개인 대시보드: 밝은 색상
      } else {
        ctx.fillStyle = '#374151';
      }
      const powerFontSize = '8px sans-serif';
      ctx.font = powerFontSize;
      ctx.textAlign = 'right';
      ctx.fillText(`${ftpPercent}%`, padding.left - 10, y + 4);
    } else {
      // 기존 로직 (다른 화면)
      if (canvasId === 'trainingSegmentGraph') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // 훈련 화면: 밝은 색상
      } else {
        ctx.fillStyle = '#374151'; // 훈련 준비 화면: 어두운 색상
      }
      const powerFontSize = '11px sans-serif';
      ctx.font = powerFontSize;
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(power) + 'W', padding.left - 10, y + 4);
    }
  }
  
  // 세그먼트 막대 그리기
  let currentTime = 0;
  segments.forEach((seg, index) => {
    const duration = seg.duration_sec || 0;
    if (duration <= 0) return;
    
    // 세그먼트 타겟 파워 계산
    const ftpPercent = getSegmentFtpPercentForPreview(seg);
    const targetPower = ftp * (ftpPercent / 100);
    
    // 막대 위치 및 크기
    const x = padding.left + (currentTime / totalSeconds) * chartWidth;
    const barWidth = (duration / totalSeconds) * chartWidth;
    let barHeight = Math.max(2, (targetPower / maxTargetPower) * chartHeight); // 최소 2px 높이 (let으로 변경)
    let y = padding.top + chartHeight - barHeight;
    
    // 세그먼트 타입 확인
    const segType = (seg.segment_type || '').toLowerCase();
    const isRest = segType === 'rest';
    const isWarmup = segType === 'warmup';
    const isCooldown = segType === 'cooldown';
    const isInterval = segType === 'interval';
    
    // 색상 결정
    let color;
    if (isRest) {
      // 휴식: 연한 투명 회색
      color = 'rgba(156, 163, 175, 0.4)';
      // 휴식은 파워가 0이거나 매우 낮을 수 있으므로 최소 높이로 표시
      barHeight = Math.max(barHeight, 3);
      y = padding.top + chartHeight - barHeight;
    } else if (targetPower >= ftp) {
      // FTP 초과: 빨강 (투명도 적용)
      color = 'rgba(239, 68, 68, 0.6)';
    } else if (targetPower >= ftp * 0.8) {
      // FTP 80% 이상 100% 미만: 주황 (투명도 적용)
      color = 'rgba(249, 115, 22, 0.6)';
    } else if (isInterval || isWarmup || isCooldown) {
      // FTP 80% 미만 (인터벌, 워밍업, 쿨다운): 녹색 (투명도 적용)
      color = 'rgba(34, 197, 94, 0.6)';
    } else {
      // 기본: 녹색 (투명도 적용)
      color = 'rgba(34, 197, 94, 0.6)';
    }
    
    // 막대 그리기 (부드러운 그라데이션)
    const barGradient = ctx.createLinearGradient(x, y, x, y + barHeight);
    const baseColor = color.replace('rgba(', '').replace(')', '').split(',');
    const r = parseInt(baseColor[0]);
    const g = parseInt(baseColor[1]);
    const b = parseInt(baseColor[2]);
    const a = parseFloat(baseColor[3]);
    
    barGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${a})`);
    barGradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${a * 0.7})`);
    
    ctx.fillStyle = barGradient;
    
    // 둥근 모서리를 위한 경로 생성
    const radius = Math.min(4, barWidth / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + barWidth - radius, y);
    ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
    ctx.lineTo(x + barWidth, y + barHeight);
    ctx.lineTo(x, y + barHeight);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
    
    // 막대 테두리 (부드러운 색상)
    ctx.shadowColor = 'transparent';
    
    // 현재 진행 중인 세그먼트인지 확인
    const isCurrentSegment = (currentSegmentIndex >= 0 && index === currentSegmentIndex);
    
    if (isCurrentSegment) {
      // 현재 세그먼트: 흰색 네온 애니메이션 효과
      const animationPhase = (Date.now() / 1000) % 2; // 2초 주기
      const neonIntensity = 0.5 + 0.5 * Math.sin(animationPhase * Math.PI);
      const whiteColor = `rgba(255, 255, 255, ${0.6 + 0.4 * neonIntensity})`; // 흰색
      
      // 네온 효과를 위한 여러 레이어
      ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
      ctx.shadowBlur = 10 * neonIntensity;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = whiteColor;
      ctx.lineWidth = 3;
      
      // 외곽 네온 효과
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + barWidth - radius, y);
      ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
      ctx.lineTo(x + barWidth, y + barHeight);
      ctx.lineTo(x, y + barHeight);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.stroke();
      
      // 내부 네온 효과 (더 강한)
      ctx.shadowBlur = 15 * neonIntensity;
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // 그림자 초기화
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    } else {
      // 일반 세그먼트: 기본 테두리
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a * 0.3})`;
      ctx.lineWidth = 1;
      
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + barWidth - radius, y);
      ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
      ctx.lineTo(x + barWidth, y + barHeight);
      ctx.lineTo(x, y + barHeight);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.stroke();
    }
    
    // 세그먼트 라벨 제거 (가로축에는 시간 표시만 남김)
    
    currentTime += duration;
  });
  
  // 가로축 시간 표시
  const timeSteps = Math.min(10, Math.max(5, Math.floor(totalSeconds / 60))); // 1분 단위 또는 최대 10개
  for (let i = 0; i <= timeSteps; i++) {
    const time = (totalSeconds * i) / timeSteps;
    const x = padding.left + (time / totalSeconds) * chartWidth;
    
    // 눈금선
    if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; // 훈련 화면 및 개인 대시보드: 밝은 색상
    } else {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)'; // 훈련 준비 화면: 어두운 색상
    }
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, padding.top + chartHeight);
    ctx.lineTo(x, padding.top + chartHeight + 5);
    ctx.stroke();
    
    // 시간 표시
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'; // 훈련 화면 및 개인 대시보드: 밝은 색상
    } else {
      ctx.fillStyle = '#6b7280'; // 훈련 준비 화면: 어두운 색상
    }
    const timeFontSize = (canvasId === 'individualSegmentGraph') ? '8px sans-serif' : '10px sans-serif';
    const timeLabelY = (canvasId === 'individualSegmentGraph') ? padding.top + chartHeight + 12 : padding.top + chartHeight + 18;
    ctx.font = timeFontSize;
    ctx.textAlign = 'center';
    ctx.fillText(
      `${minutes}:${seconds.toString().padStart(2, '0')}`,
      x,
      timeLabelY
    );
  }
  
  // 축 라벨 (개인 대시보드는 제거)
  if (canvasId !== 'individualSegmentGraph') {
    // 개인 대시보드가 아닌 경우에만 축 라벨 표시
    if (canvasId === 'trainingSegmentGraph') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // 훈련 화면: 밝은 색상
    } else {
      ctx.fillStyle = '#374151'; // 훈련 준비 화면: 어두운 색상
    }
    const axisLabelFontSize = 'bold 12px sans-serif';
    const axisLabelY = graphHeight - 10;
    ctx.font = axisLabelFontSize;
    ctx.textAlign = 'center';
    ctx.fillText('시간 (분:초)', padding.left + chartWidth / 2, axisLabelY);
    
    // 세로축 라벨 (파워)
    const verticalLabelFontSize = 'bold 12px sans-serif';
    ctx.font = verticalLabelFontSize;
    ctx.save();
    ctx.translate(15, padding.top + chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('파워 (W)', 0, 0);
    ctx.restore();
  }
  
  // 개인 대시보드: Y축 120%와 150% 중간 위치에 민트색 둥근네모 상자에 워크아웃 총시간 표기
  if (canvasId === 'individualSegmentGraph') {
    const totalMinutes = Math.round(totalSeconds / 60);
    const totalTimeText = `${totalMinutes}m`;
    
    // Y축 120%와 150% 중간 위치 계산 (135%)
    const targetFtpPercent = 135; // 120%와 150%의 중간
    const targetPower = ftp * (targetFtpPercent / 100); // FTP의 135%
    const targetY = padding.top + chartHeight - (chartHeight * (targetPower / maxTargetPower));
    
    // 크기와 폰트 30% 증가
    const baseFontSize = 12;
    const baseBoxHeight = 24;
    const baseBoxPadding = 8;
    const fontSize = Math.round(baseFontSize * 1.3); // 30% 증가: 15.6px → 16px
    const boxHeight = Math.round(baseBoxHeight * 1.3); // 30% 증가: 31.2px → 31px
    const boxPadding = Math.round(baseBoxPadding * 1.3); // 30% 증가: 10.4px → 10px
    
    // 텍스트 크기 측정
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textMetrics = ctx.measureText(totalTimeText);
    const textWidth = textMetrics.width;
    const boxWidth = textWidth + boxPadding * 2;
    const boxX = padding.left + chartWidth / 2 - boxWidth / 2; // 그래프 중간
    const boxY = targetY - boxHeight / 2; // Y축 135% 위치 (120%와 150% 중간)
    
    // 민트색 둥근네모 상자 그리기
    const borderRadius = Math.round(6 * 1.3); // 30% 증가: 7.8px → 8px
    ctx.fillStyle = 'rgba(0, 212, 170, 0.9)'; // 민트색 (#00d4aa)
    ctx.beginPath();
    ctx.moveTo(boxX + borderRadius, boxY);
    ctx.lineTo(boxX + boxWidth - borderRadius, boxY);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + borderRadius);
    ctx.lineTo(boxX + boxWidth, boxY + boxHeight - borderRadius);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - borderRadius, boxY + boxHeight);
    ctx.lineTo(boxX + borderRadius, boxY + boxHeight);
    ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - borderRadius);
    ctx.lineTo(boxX, boxY + borderRadius);
    ctx.quadraticCurveTo(boxX, boxY, boxX + borderRadius, boxY);
    ctx.closePath();
    ctx.fill();
    
    // 텍스트 표시
    ctx.fillStyle = '#fff'; // 흰색 텍스트
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(totalTimeText, padding.left + chartWidth / 2, targetY);
  }
}

/**
 * 세그먼트 FTP 백분율 추출 (프리뷰용)
 */
function getSegmentFtpPercentForPreview(seg) {
  if (!seg) return 0;
  
  const targetType = seg.target_type || 'ftp_pct';
  
  if (targetType === 'ftp_pct') {
    return Number(seg.target_value) || 100;
  } else if (targetType === 'dual') {
    const targetValue = seg.target_value;
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim());
      return Number(parts[0]) || 100;
    } else if (Array.isArray(targetValue) && targetValue.length > 0) {
      return Number(targetValue[0]) || 100;
    } else {
      // 숫자로 저장된 경우 (예: 100120)
      const numValue = Number(targetValue);
      if (numValue > 1000 && numValue < 1000000) {
        const str = String(numValue);
        if (str.length >= 4) {
          const ftpPart = str.slice(0, -3);
          return Number(ftpPart) || 100;
        }
      }
      return numValue <= 1000 ? numValue : 100;
    }
  } else if (targetType === 'cadence_rpm') {
    return 0; // RPM만 있는 경우 파워는 0
  }
  
  return 100;
}

/**
 * 훈련 화면용 그룹화된 세그먼트 표시
 */
function updateTrainingProgressGrouped(segments, currentSegmentIndex = 0) {
  const progressDiv = safeGetElement('trainingProgress');
  if (!progressDiv) return;

  if (!segments || segments.length === 0) {
    progressDiv.innerHTML = '<div class="text-center muted">진행할 세그먼트가 없습니다.</div>';
    return;
  }

  const groupedSegments = detectAndGroupSegments(segments);
  let segmentOffset = 0;
  
  progressDiv.innerHTML = groupedSegments.map((item, groupIndex) => {
    let isCurrentGroup = false;
    let groupProgress = '';
    
    if (item.type === 'single') {
      isCurrentGroup = (segmentOffset === currentSegmentIndex);
      segmentOffset += 1;
      
      return createSingleTrainingSegment(item.segment, isCurrentGroup);
    } else {
      const groupStartIndex = segmentOffset;
      const groupEndIndex = segmentOffset + (item.pattern.length * item.repeatCount);
      
      isCurrentGroup = (currentSegmentIndex >= groupStartIndex && currentSegmentIndex < groupEndIndex);
      
      if (isCurrentGroup) {
        const relativeIndex = currentSegmentIndex - groupStartIndex;
        const currentRound = Math.floor(relativeIndex / item.pattern.length) + 1;
        const segmentInRound = relativeIndex % item.pattern.length;
        groupProgress = `${currentRound}/${item.repeatCount}회차 - ${item.pattern[segmentInRound].label}`;
      }
      
      segmentOffset += (item.pattern.length * item.repeatCount);
      
      return createGroupedTrainingSegment(item, isCurrentGroup, groupProgress);
    }
  }).filter(Boolean).join('');
}

/**
 * 개별 훈련 세그먼트 생성
 */
function createSingleTrainingSegment(segment, isCurrent) {
  const minutes = Math.floor((segment.duration_sec || 0) / 60);
  const seconds = (segment.duration_sec || 0) % 60;
  const duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  
  const segmentTypeClass = getSegmentTypeClass(segment.segment_type);
  const currentClass = isCurrent ? 'current-segment' : '';
  
  return `
    <div class="training-segment ${segmentTypeClass} ${currentClass}">
      <div class="segment-label">${escapeHtml(segment.label)}</div>
      <div class="segment-stats">
        <span class="ftp-value">FTP ${segment.target_value}%</span>
        <span class="duration">${duration}</span>
      </div>
    </div>
  `;
}

/**
 * 그룹화된 훈련 세그먼트 생성
 */
function createGroupedTrainingSegment(groupedItem, isCurrent, groupProgress) {
  const { groupLabel, pattern, repeatCount, totalMinutes } = groupedItem;
  
  const patternInfo = pattern.map(segment => {
    const minutes = Math.floor((segment.duration_sec || 0) / 60);
    const seconds = (segment.duration_sec || 0) % 60;
    const duration = seconds > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${minutes}분`;
    
    return `<div class="pattern-item">FTP ${segment.target_value}% ${duration}</div>`;
  }).join('');
  
  const mainSegmentTypeClass = getSegmentTypeClass(pattern[0].segment_type);
  const currentClass = isCurrent ? 'current-segment' : '';
  
  return `
    <div class="training-segment grouped-training-segment ${mainSegmentTypeClass} ${currentClass}">
      <div class="group-header">
        <div class="group-label">${escapeHtml(groupLabel)}</div>
        <div class="repeat-info">× ${repeatCount}회</div>
      </div>
      <div class="group-pattern-training">
        ${patternInfo}
      </div>
      <div class="group-total-training">
        <strong>총 ${totalMinutes}분</strong>
      </div>
      ${isCurrent && groupProgress ? `<div class="group-progress">${groupProgress}</div>` : ''}
    </div>
  `;
}

// 세그먼트 타입에 따른 CSS 클래스 반환
function getSegmentTypeClass(segmentType) {
  const typeMapping = {
    'warmup': 'warmup',
    'rest': 'rest', 
    'interval': 'interval',
    'cooldown': 'rest',
    'tempo': 'interval',
    'sweetspot': 'interval',
    'threshold': 'interval',
    'vo2max': 'interval'
  };
  
  return typeMapping[segmentType] || 'interval';
}

// ==========================================================
// API 함수들
// ==========================================================

async function apiGetWorkouts() {
  try {
    // 모든 워크아웃 조회 (필터링은 프론트엔드에서 처리)
    return await jsonpRequest(window.GAS_URL, { 
      action: 'listWorkouts'
    });
  } catch (error) {
    console.error('apiGetWorkouts 실패:', error);
    return { success: false, error: error.message };
  }
}

async function apiGetWorkout(id) {
  if (!id) {
    return { success: false, error: '워크아웃 ID가 필요합니다.' };
  }
  
  try {
    return await jsonpRequest(window.GAS_URL, { action: 'getWorkout', id: String(id) });
  } catch (error) {
    console.error('apiGetWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 워크아웃 ID로 그룹방 조회
 */
async function getRoomsByWorkoutId(workoutId) {
  if (!workoutId) {
    return [];
  }
  
  try {
    if (!window.GAS_URL) {
      console.warn('GAS_URL이 설정되지 않았습니다.');
      return [];
    }
    
    const result = await jsonpRequest(window.GAS_URL, {
      action: 'listGroupRooms',
      workoutId: String(workoutId)
    });
    
    if (result && result.success) {
      return result.items || result.rooms || [];
    }
    
    return [];
  } catch (error) {
    console.error('getRoomsByWorkoutId 실패:', error);
    return [];
  }
}

/**
 * 워크아웃별 그룹방 상태를 백그라운드에서 비동기로 로드 (점진적 UI 업데이트)
 */
async function loadWorkoutRoomStatusesAsync(workouts, workoutRoomStatusMap, workoutRoomCodeMap, grade) {
  if (!workouts || workouts.length === 0) return;
  
  // 배치 크기 증가 (성능 최적화)
  const BATCH_SIZE = 15; // 한 번에 처리할 워크아웃 수 증가
  const batches = [];
  for (let i = 0; i < workouts.length; i += BATCH_SIZE) {
    batches.push(workouts.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`그룹방 상태 로딩 시작: ${workouts.length}개 워크아웃, ${batches.length}개 배치`);
  
  // 배치별로 병렬 처리 (지연 시간 최소화)
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    
    // 배치 내에서 병렬 처리
    await Promise.all(batch.map(async (workout) => {
      try {
        const rooms = await getRoomsByWorkoutId(workout.id);
        
        if (rooms && rooms.length > 0) {
          workoutRoomStatusMap[workout.id] = 'available';
          const firstRoom = rooms[0];
          const roomCode = firstRoom.code || firstRoom.Code || firstRoom.roomCode;
          if (roomCode) {
            workoutRoomCodeMap[workout.id] = roomCode;
          }
        } else {
          workoutRoomStatusMap[workout.id] = 'none';
        }
        
        // 점진적 UI 업데이트 (각 워크아웃마다 즉시 반영)
        updateWorkoutRowRoomStatus(workout.id, workoutRoomStatusMap[workout.id], workoutRoomCodeMap[workout.id], grade);
        
      } catch (error) {
        workoutRoomStatusMap[workout.id] = 'none';
        updateWorkoutRowRoomStatus(workout.id, 'none', null, grade);
      }
    }));
    
    // 배치 간 최소 지연 (JSONP 콜백 정리 시간만 확보)
    if (batchIndex < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 50)); // 100ms → 50ms로 감소
    }
  }
  
  console.log('그룹방 상태 로딩 완료');
  
  // 전역 변수 업데이트
  window.workoutRoomStatusMap = workoutRoomStatusMap;
  window.workoutRoomCodeMap = workoutRoomCodeMap;
}

/**
 * 특정 워크아웃 행의 그룹방 상태만 업데이트 (점진적 UI 업데이트)
 */
function updateWorkoutRowRoomStatus(workoutId, status, roomCode, grade) {
  const workoutList = safeGetElement('workoutList');
  if (!workoutList) return;
  
  // 해당 워크아웃 행 찾기
  const row = workoutList.querySelector(`tr[data-workout-id="${workoutId}"]`);
  if (!row) return;
  
  // 그룹훈련 셀 찾기 (3번째 열)
  const groupCell = row.querySelector('td:nth-child(3)');
  if (!groupCell) return;
  
  // 상태에 따라 아이콘 업데이트 (기존 renderWorkoutTable 구조와 동일하게)
  if (status === 'available' && roomCode) {
    // 그룹방이 있으면 클릭 가능한 아이콘 표시
    const escapedRoomCode = escapeHtml(roomCode);
    groupCell.innerHTML = `
      <span class="group-room-open-icon clickable" data-room-code="${escapedRoomCode}" title="그룹 훈련방 개설됨 (클릭하여 참가)">
        <img src="assets/img/network (1).png" alt="그룹 훈련방 개설" style="width: 24px; height: 24px; vertical-align: middle;">
      </span>
    `;
    
    // 클릭 이벤트 리스너 재연결 (새로 추가된 요소에 대해)
    const iconElement = groupCell.querySelector('.group-room-open-icon.clickable');
    if (iconElement && typeof attachTableEventListeners === 'function') {
      // 기존 이벤트 리스너가 자동으로 처리하도록 (전역 이벤트 위임 사용)
    }
  } else {
    // 그룹방 없음 (빈 문자열)
    groupCell.innerHTML = '';
  }
}

/**
 * 통합 워크아웃 생성 함수 (개선된 버전)
 */
async function apiCreateWorkoutWithSegments(workoutData) {
  console.log('=== 통합 워크아웃 생성 시작 ===');
  console.log('워크아웃 데이터:', workoutData);
  
  if (!workoutData || typeof workoutData !== 'object') {
    return { success: false, error: '유효하지 않은 워크아웃 데이터입니다.' };
  }
  
  try {
    // 1단계: 워크아웃 기본 정보만으로 먼저 생성
    const baseParams = {
      action: 'createWorkout',
      title: String(workoutData.title || ''),
      description: String(workoutData.description || ''),
      author: String(workoutData.author || ''),
      status: String(workoutData.status || '보이기'),
      publish_date: String(workoutData.publish_date || '')
    };
    
    console.log('1단계: 기본 워크아웃 생성...');
    const createResult = await jsonpRequestWithRetry(window.GAS_URL, baseParams);
    
    if (!createResult.success) {
      throw new Error(createResult.error || '워크아웃 생성 실패');
    }
    
    const workoutId = createResult.workoutId || createResult.id;
    console.log('워크아웃 생성 완료. ID:', workoutId);
    
    // 2단계: 세그먼트가 있으면 배치별로 추가
   // 2단계: 세그먼트가 있으면 배치별로 추가
   const segments = workoutData.segments || [];
   if (segments.length > 0) {
     console.log(`2단계: ${segments.length}개 세그먼트를 배치별로 추가 중...`);
     
     // 세그먼트 데이터 정규화 및 검증
     const normalizedSegments = segments.map((seg, index) => {
       const targetType = String(seg.target_type || 'ftp_pct');
       let targetValue = seg.target_value;
       
       // target_type에 따라 target_value 처리
       if (targetType === 'dual') {
         // dual 타입: target_value는 "100/120" 형식의 문자열로 저장
         targetValue = String(targetValue || '100/90');
       } else if (targetType === 'cadence_rpm') {
         // cadence_rpm 타입: 숫자로 저장 (50-200 범위)
         targetValue = Math.max(50, Math.min(200, Number(targetValue) || 90));
       } else {
         // ftp_pct 타입: 숫자로 저장 (30-200 범위)
         targetValue = Math.max(30, Math.min(200, Number(targetValue) || 100));
       }
       
       const normalized = {
         label: String(seg.label || `세그먼트 ${index + 1}`).trim(),
         segment_type: normalizeSegmentType(seg.segment_type),
         duration_sec: Math.max(1, Number(seg.duration_sec) || 300),
         target_type: targetType,
         target_value: targetValue,
         ramp: seg.ramp === 'linear' ? 'linear' : 'none',
         ramp_to_value: seg.ramp === 'linear' ? Number(seg.ramp_to_value) : null
       };
       
       console.log(`세그먼트 ${index + 1} 정규화:`, normalized);
       return normalized;
     });
     
     const addResult = await addSegmentsBatch(workoutId, normalizedSegments);
      
      if (!addResult.success) {
        console.warn('세그먼트 추가 중 일부 실패:', addResult.error);
        return {
          success: true,
          workoutId: workoutId,
          warning: '일부 세그먼트 추가 실패: ' + addResult.error,
          addedSegments: addResult.addedCount || 0,
          totalSegments: segments.length
        };
      }
      
      console.log(`모든 세그먼트 추가 완료: ${addResult.addedCount}/${segments.length}`);
      return {
        success: true,
        workoutId: workoutId,
        addedSegments: addResult.addedCount,
        totalSegments: segments.length
      };
    }
    
    console.log('세그먼트 없는 워크아웃 생성 완료');
    return {
      success: true,
      workoutId: workoutId,
      addedSegments: 0,
      totalSegments: 0
    };
    
  } catch (error) {
    console.error('통합 워크아웃 생성 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 세그먼트 배치별 추가 함수 (대용량 최적화 버전)
 */
async function addSegmentsBatch(workoutId, segments) {
  console.log(`배치별 세그먼트 추가 시작: 워크아웃 ID ${workoutId}, 세그먼트 ${segments.length}개`);
  
  // 대용량 세그먼트 감지 및 설정 동적 조정
   // 세그먼트 수에 따른 보수적 배치 크기 설정
   let batchSize, batchDelay;
   if (segments.length > 100) {
     batchSize = 1; // 초대용량: 1개씩
     batchDelay = 3000;
   } else if (segments.length > 50) {
     batchSize = 1; // 대용량: 1개씩 (안전성 우선)
     batchDelay = 2000;
   } else if (segments.length > 20) {
     batchSize = 2; // 중간: 2개씩
     batchDelay = 1500;
   } else {
     batchSize = 3; // 소량: 3개씩
     batchDelay = 1000;
   }
   const maxRetries = 3;
   
   console.log(`처리 설정: 배치크기 ${batchSize}, 지연 ${batchDelay}ms (총 ${segments.length}개 세그먼트)`);
  
  let totalAddedCount = 0;
  let successfulBatches = 0;
  let failedBatches = 0;
  
  try {
    for (let i = 0; i < segments.length; i += batchSize) {
      const batch = segments.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(segments.length / batchSize);
      
      const remainingBatches = totalBatches - batchNumber;
      const avgTimePerBatch = 4;
      const eta = Math.round(remainingBatches * avgTimePerBatch);
      
      console.log(`배치 ${batchNumber}/${totalBatches} 처리 중... (${batch.length}개 세그먼트, 약 ${eta}초 남음)`);
      
      let batchSuccess = false;
      let lastError = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const compressedBatch = batch.map(seg => ({
              label: seg.label,                             // 전체 라벨 보존 (압축하지 않음)
              segment_type: seg.segment_type,               // 전체 타입 보존 (압축하지 않음)
              duration_sec: seg.duration_sec,
              target_type: seg.target_type,
              target_value: seg.target_value,
              ramp: seg.ramp,
              ramp_to_value: seg.ramp_to_value
            }));
            
            // 추가 압축: 배열 형태로 변환하여 더욱 압축
            const ultraCompressed = compressedBatch.map(seg => [
              seg.l, seg.t, seg.d, seg.v, seg.r, seg.rv
            ]);
          
          const segmentsJson = JSON.stringify(compressedBatch);
          
          const params = {
            action: 'addSegments',
            workoutId: String(workoutId),
            segments: segmentsJson
          };
          
          const result = await jsonpRequestWithRetry(window.GAS_URL, params, 2);
          
          if (result.success) {
            const addedCount = result.addedCount || batch.length;
            totalAddedCount += addedCount;
            successfulBatches++;
            batchSuccess = true;
            
            console.log(`배치 ${batchNumber} 성공 (시도 ${attempt}): ${addedCount}개 세그먼트 추가`);
            
            if (typeof window.showToast === 'function') {
              const progress = Math.round((totalAddedCount / segments.length) * 100);
              const status = eta > 60 ? `약 ${Math.round(eta/60)}분 남음` : `약 ${eta}초 남음`;
              window.showToast(`세그먼트 추가 ${progress}% (${totalAddedCount}/${segments.length}) - ${status}`);
            }
            
            break;
            
          } else {
            lastError = new Error(result.error || '배치 전송 실패');
            console.warn(`배치 ${batchNumber} 시도 ${attempt} 실패:`, result.error);
            
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            }
          }
          
        } catch (batchError) {
          lastError = batchError;
          console.error(`배치 ${batchNumber} 시도 ${attempt} 오류:`, batchError);
          
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          }
        }
      }
      
      if (!batchSuccess) {
        failedBatches++;
        console.error(`배치 ${batchNumber} 모든 시도 실패:`, lastError?.message);
      }
      
      if (i + batchSize < segments.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }
    
    console.log(`배치 처리 완료: 성공 ${successfulBatches}, 실패 ${failedBatches}`);
    console.log(`총 세그먼트 추가: ${totalAddedCount}/${segments.length}`);
    
    if (typeof window.showToast === 'function') {
      if (failedBatches === 0) {
        window.showToast(`모든 세그먼트 추가 완료! (${totalAddedCount}개)`);
      } else {
        window.showToast(`세그먼트 추가 완료: ${totalAddedCount}/${segments.length}개 (${failedBatches}개 배치 실패)`);
      }
    }
    
    if (totalAddedCount === 0) {
      return { 
        success: false, 
        error: '세그먼트를 추가할 수 없었습니다.',
        addedCount: 0
      };
    }
    
    if (failedBatches > 0) {
      return {
        success: true,
        addedCount: totalAddedCount,
        warning: `${failedBatches}개 배치 실패. ${totalAddedCount}/${segments.length}개 세그먼트 추가됨`
      };
    }
    
    return {
      success: true,
      addedCount: totalAddedCount,
      message: `${totalAddedCount}개 세그먼트가 성공적으로 추가되었습니다.`
    };
    
  } catch (error) {
    console.error('배치 추가 중 전체 오류:', error);
    return { 
      success: false, 
      error: error.message,
      addedCount: totalAddedCount
    };
  }
}

async function apiUpdateWorkout(id, workoutData) {
  if (!id || !workoutData) {
    return { success: false, error: '워크아웃 ID와 데이터가 필요합니다.' };
  }
  
  const params = {
    action: 'updateWorkout',
    id: String(id),
    title: String(workoutData.title || ''),
    description: String(workoutData.description || ''),
    author: String(workoutData.author || ''),
    status: String(workoutData.status || '보이기'),
    publish_date: String(workoutData.publish_date || '')
  };
  
  try {
    return await jsonpRequest(window.GAS_URL, params);
  } catch (error) {
    console.error('apiUpdateWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

async function apiDeleteWorkout(id) {
  if (!id) {
    return { success: false, error: '워크아웃 ID가 필요합니다.' };
  }
  
  try {
    return await jsonpRequest(window.GAS_URL, { action: 'deleteWorkout', id: String(id) });
  } catch (error) {
    console.error('apiDeleteWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

// ==========================================================
// 워크아웃 목록 및 선택 관리
// ==========================================================

async function loadWorkouts() {
  const workoutList = safeGetElement('workoutList');
  if (!workoutList) {
    console.warn('workoutList 요소를 찾을 수 없습니다.');
    return;
  }

  try {
    workoutList.innerHTML = `
      <div class="loading-container">
        <div class="spinner"></div>
        <div style="color: #666; font-size: 14px;">워크아웃 목록을 불러오는 중...</div>
      </div>
    `;
    
    const result = await apiGetWorkouts();
    
    if (!result || !result.success) {
      const errorMsg = result?.error || '알 수 없는 오류';
      workoutList.innerHTML = `
        <div class="error-state">
          <div class="error-state-icon">⚠️</div>
          <div class="error-state-title">워크아웃 목록을 불러올 수 없습니다</div>
          <div class="error-state-description">오류: ${escapeHtml(errorMsg)}</div>
          <button class="retry-button" onclick="loadWorkouts()">다시 시도</button>
        </div>
      `;
      return;
    }

    const rawWorkouts = result.items || [];
    console.log('Raw workouts received:', rawWorkouts.length, '개');
    
    // 원본 데이터의 status 확인 (디버깅용)
    const rawStatusCount = {
      '보이기': 0,
      '숨기기': 0,
      '기타': 0,
      'null/undefined': 0,
      '빈문자열': 0
    };
    rawWorkouts.forEach(w => {
      if (w.status === null || w.status === undefined) {
        rawStatusCount['null/undefined']++;
      } else if (w.status === '') {
        rawStatusCount['빈문자열']++;
      } else {
        const statusStr = String(w.status).trim();
        if (statusStr === '보이기') {
          rawStatusCount['보이기']++;
        } else if (statusStr === '숨기기') {
          rawStatusCount['숨기기']++;
        } else {
          rawStatusCount['기타']++;
        }
      }
    });
    console.log('📊 원본 데이터 status 분포:', rawStatusCount);
    
    // 숨기기 상태인 원본 워크아웃 확인
    const rawPrivateWorkouts = rawWorkouts.filter(w => {
      if (w.status === null || w.status === undefined || w.status === '') return false;
      return String(w.status).trim() === '숨기기';
    });
    if (rawPrivateWorkouts.length > 0) {
      console.log('🔍 원본 데이터의 숨기기 워크아웃:', rawPrivateWorkouts.map(w => ({
        id: w.id,
        title: w.title,
        status: w.status
      })));
    }
    
    // 필터링 전 원본 데이터 상태 확인
    const invalidWorkouts = rawWorkouts.filter(w => !validateWorkoutData(w));
    if (invalidWorkouts.length > 0) {
      console.warn('유효하지 않은 워크아웃 제외됨:', invalidWorkouts.length, '개', invalidWorkouts);
    }
    
    const validWorkouts = rawWorkouts
      .filter(validateWorkoutData)
      .map(normalizeWorkoutData);
    
    console.log('Normalized workouts:', validWorkouts.length, '개');
    
    // 정규화 후 status 확인
    const normalizedStatusCount = {
      '보이기': 0,
      '숨기기': 0,
      '기타': 0
    };
    validWorkouts.forEach(w => {
      const statusStr = String(w.status || '').trim();
      if (statusStr === '보이기') {
        normalizedStatusCount['보이기']++;
      } else if (statusStr === '숨기기') {
        normalizedStatusCount['숨기기']++;
      } else {
        normalizedStatusCount['기타']++;
      }
    });
    console.log('📊 정규화 후 status 분포:', normalizedStatusCount);
    
    // 정규화 후 숨기기 워크아웃 확인
    const normalizedPrivateWorkouts = validWorkouts.filter(w => {
      const statusStr = String(w.status || '').trim();
      return statusStr === '숨기기';
    });
    if (normalizedPrivateWorkouts.length > 0) {
      console.log('🔍 정규화 후 숨기기 워크아웃:', normalizedPrivateWorkouts.map(w => ({
        id: w.id,
        title: w.title,
        status: w.status
      })));
    }
    
    // 프론트엔드에서 사용자 등급 확인하여 필터링
    // grade 확인: 여러 소스에서 확인
    let grade = '2';
    try {
      if (typeof getViewerGrade === 'function') {
        grade = String(getViewerGrade());
      } else {
        // getViewerGrade가 없으면 직접 확인
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
    
    // grade=1 또는 grade=3이면 관리자
    const isAdmin = (grade === '1' || grade === '3');
    
    console.log('🔍 사용자 등급 확인:', {
      grade: grade,
      isAdmin: isAdmin,
      currentUser: window.currentUser,
      localStorage_currentUser: localStorage.getItem('currentUser'),
      localStorage_authUser: localStorage.getItem('authUser')
    });
    
    // 상태별 개수 계산 (필터링 전)
    const publicWorkouts = validWorkouts.filter(w => {
      const workoutStatus = String(w.status || '').trim();
      return workoutStatus === '보이기';
    });
    const privateWorkouts = validWorkouts.filter(w => {
      const workoutStatus = String(w.status || '').trim();
      return workoutStatus !== '보이기';
    });
    
    // 프론트엔드에서 필터링: 관리자는 모든 워크아웃 표시, 일반 사용자는 공개 워크아웃만 표시
    let filteredWorkouts;
    if (isAdmin) {
      // 관리자: 필터 없이 모든 워크아웃 표시 (공개 + 비공개 모두)
      filteredWorkouts = [...validWorkouts];
      console.log('✅ 관리자 모드: 모든 워크아웃 표시 (필터 없음)', {
        total: filteredWorkouts.length,
        public: publicWorkouts.length,
        private: privateWorkouts.length
      });
    } else {
      // 일반 사용자: 공개 워크아웃만 표시
      filteredWorkouts = validWorkouts.filter(workout => {
        const workoutStatus = String(workout.status || '').trim();
        const isPublic = workoutStatus === '보이기';
        return isPublic;
      });
      console.log('✅ 일반 사용자 모드: 공개 워크아웃만 표시', {
        total: filteredWorkouts.length,
        public: filteredWorkouts.length
      });
    }
    
    console.log('워크아웃 필터링 결과:', {
      rawWorkoutsCount: rawWorkouts.length,
      validWorkoutsCount: validWorkouts.length,
      invalidWorkoutsCount: invalidWorkouts.length,
      grade: grade,
      isAdmin: isAdmin,
      filteredWorkoutsCount: filteredWorkouts.length,
      publicCount: publicWorkouts.length,
      privateCount: privateWorkouts.length,
      expectedTotalForAdmin: validWorkouts.length,
      statusBreakdown: {
        '보이기': publicWorkouts.length,
        '숨기기': privateWorkouts.filter(w => String(w.status || '').trim() === '숨기기').length,
        '기타': validWorkouts.length - publicWorkouts.length - privateWorkouts.length
      }
    });
    
    // 관리자인데 필터링된 개수가 전체와 다르면 경고 및 강제 수정
    if (isAdmin && filteredWorkouts.length !== validWorkouts.length) {
      console.error('⚠️ 관리자 모드인데 필터링된 워크아웃 개수가 다릅니다! 강제로 모든 워크아웃 포함', {
        expected: validWorkouts.length,
        actual: filteredWorkouts.length,
        difference: validWorkouts.length - filteredWorkouts.length
      });
      // 관리자 모드에서는 무조건 모든 워크아웃 포함
      filteredWorkouts = [...validWorkouts];
      console.log('✅ 관리자 모드: 모든 워크아웃 강제 포함 완료', filteredWorkouts.length);
    }
    
    // 최종 확인: 관리자 모드에서 비공개 워크아웃이 포함되어 있는지 확인
    if (isAdmin) {
      const hasPrivateWorkouts = filteredWorkouts.some(w => {
        const workoutStatus = String(w.status || '').trim();
        return workoutStatus !== '보이기';
      });
      console.log('🔍 관리자 모드 최종 확인:', {
        totalWorkouts: filteredWorkouts.length,
        hasPrivateWorkouts: hasPrivateWorkouts,
        privateWorkoutIds: filteredWorkouts
          .filter(w => String(w.status || '').trim() !== '보이기')
          .map(w => ({ id: w.id, title: w.title, status: w.status }))
      });
    }
    
    if (filteredWorkouts.length === 0) {
      workoutList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">등록된 워크아웃이 없습니다</div>
          <div class="empty-state-description">새로운 워크아웃을 만들어 훈련을 시작해보세요.</div>
          <div class="empty-state-action">
            <button class="btn btn-primary" onclick="showAddWorkoutForm(true)">
              ➕ 첫 번째 워크아웃 만들기
            </button>
          </div>
        </div>
      `;
      return;
    }

    const workoutRoomStatusMap = {}; // 초기값: 모두 'none'
    const workoutRoomCodeMap = {};
    
    // 모든 워크아웃에 대해 기본값 설정
    filteredWorkouts.forEach(workout => {
      workoutRoomStatusMap[workout.id] = 'none';
    });
    
    // 먼저 테이블 렌더링 (빠른 사용자 경험)
    renderWorkoutTable(filteredWorkouts, workoutRoomStatusMap, workoutRoomCodeMap, grade);
    
    // 전역 변수에 저장 (검색 기능에서 사용)
    window.workouts = filteredWorkouts;
    window.workoutRoomStatusMap = workoutRoomStatusMap;
    window.workoutRoomCodeMap = workoutRoomCodeMap;
    
    window.showToast(`${filteredWorkouts.length}개의 워크아웃을 불러왔습니다.`);
    
    // 그룹방 상태는 백그라운드에서 비동기로 로드 (블로킹 없음)
    loadWorkoutRoomStatusesAsync(filteredWorkouts, workoutRoomStatusMap, workoutRoomCodeMap, grade);
    
  } catch (error) {
    console.error('워크아웃 목록 로드 실패:', error);
    
    let errorMessage = '알 수 없는 오류가 발생했습니다.';
    if (error.message) {
      errorMessage = error.message;
    }
    
    workoutList.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">🌐</div>
        <div class="error-state-title">연결 오류</div>
        <div class="error-state-description">
          서버 연결에 문제가 발생했습니다.<br>
          오류: ${escapeHtml(errorMessage)}
        </div>
        <button class="retry-button" onclick="loadWorkouts()">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 워크아웃 테이블 렌더링 함수
 */
function renderWorkoutTable(workouts, workoutRoomStatusMap = {}, workoutRoomCodeMap = {}, grade = '2') {
  const workoutList = safeGetElement('workoutList');
  if (!workoutList) {
    console.warn('workoutList 요소를 찾을 수 없습니다.');
    return;
  }
  
  if (!workouts || workouts.length === 0) {
    workoutList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">등록된 워크아웃이 없습니다</div>
        <div class="empty-state-description">새로운 워크아웃을 만들어 훈련을 시작해보세요.</div>
        <div class="empty-state-action">
          <button class="btn btn-primary" onclick="showAddWorkoutForm(true)">
            ➕ 첫 번째 워크아웃 만들기
          </button>
        </div>
      </div>
    `;
    return;
  }
  
  // 테이블 헤더 생성
  const tableHeader = `
    <table class="workout-table">
      <thead>
        <tr>
          <th style="width: 50px;">순번</th>
          <th style="width: 200px;">제목</th>
          <th style="width: 120px;">그룹훈련</th>
          <th style="width: 80px;">시간</th>
          <th style="width: 80px;">상태</th>
          <th>설명</th>
          <th style="width: 120px;">게시일</th>
          <th style="width: 220px;">작업</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  // 테이블 행 생성
  const tableRows = workouts.map((workout, index) => {
      if (!workout || typeof workout !== 'object' || !workout.id) {
        return '';
      }
      
      const safeTitle = String(workout.title || '제목 없음');
      const safeDescription = String(workout.description || '');
      
      const totalMinutes = Math.round((workout.total_seconds || 0) / 60);
      // status가 '보이기'인 경우만 공개로 간주, 그 외는 모두 비공개
      const workoutStatus = String(workout.status || '').trim();
      const isPublic = workoutStatus === '보이기';
      // 비공개 워크아웃은 붉은 둥근 상자로 표시
      const statusBadge = isPublic ? 
        '<span class="status-badge visible">공개</span>' : 
        '<span class="status-badge hidden private">비공개</span>';
      
      // 그룹 훈련방 개설 상태 확인 (waiting 상태)
      const hasWaitingRoom = workoutRoomStatusMap[workout.id] === 'available';
      const roomCode = workoutRoomCodeMap[workout.id] || '';
      const groupRoomImage = hasWaitingRoom 
        ? `<span class="group-room-open-icon clickable" data-room-code="${escapeHtml(roomCode)}" title="그룹 훈련방 개설됨 (클릭하여 참가)"><img src="assets/img/network (1).png" alt="그룹 훈련방 개설" style="width: 24px; height: 24px; vertical-align: middle;"></span>` 
        : '';
      
      const publishDate = workout.publish_date ? new Date(workout.publish_date).toLocaleDateString() : '-';
      
      const rowNumber = index + 1;
      const isAdmin = (grade === '1' || grade === '3');
      
      return `
        <tr class="workout-row" data-workout-id="${workout.id}">
          <td class="text-center">${rowNumber}</td>
          <td>
            <div class="workout-title-cell">
              ${escapeHtml(safeTitle)}
            </div>
          </td>
          <td class="text-center">${groupRoomImage}</td>
          <td class="text-center">${totalMinutes}분</td>
          <td class="text-center">${statusBadge}</td>
          <td class="workout-description-cell">${escapeHtml(safeDescription)}</td>
          <td class="text-center">${publishDate}</td>
          <td class="workout-actions-cell">
            <div class="workout-actions-wrapper">
              <button class="btn-edit" onclick="editWorkout(${workout.id})" title="수정">✏️</button>
              <button class="btn-delete" onclick="deleteWorkout(${workout.id})" title="삭제">🗑️</button>
              <button class="btn btn-primary btn-sm" id="selectWorkoutBtn-${workout.id}" onclick="selectWorkout(${workout.id})">선택</button>
              ${isAdmin ? `<button class="btn btn-image btn-sm" id="createGroupRoomBtn-${workout.id}" data-workout-id="${workout.id}" data-workout-title="${escapeHtml(safeTitle)}" title="이 워크아웃으로 그룹훈련방 생성"><img src="assets/img/network (2).png" alt="그룹훈련방 생성" style="width: 20px; height: 20px; vertical-align: middle;"></button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).filter(Boolean).join('');
    
    const tableFooter = `
        </tbody>
      </table>
    `;
    
    workoutList.innerHTML = tableHeader + tableRows + tableFooter;

    // [권한 적용: 등급별 버튼 처리 - 이미 넣으셨다면 유지]
    applyWorkoutPermissions?.();
    
    // [만료일 점검: grade=2 만료 시 알림]
    checkExpiryAndWarn();  // ← 이 한 줄을 추가

    // 이벤트 리스너 연결
    attachTableEventListeners();
}

/**
 * 워크아웃 검색 함수 (제목, 시간으로 검색)
 */
function searchWorkouts() {
  const searchInput = safeGetElement('qWorkout');
  if (!searchInput) {
    console.warn('qWorkout 검색 입력 필드를 찾을 수 없습니다.');
    return;
  }
  
  const searchQuery = (searchInput.value || '').trim();
  
  // 검색어가 없으면 전체 목록 표시
  if (!searchQuery) {
    if (window.workouts && window.workouts.length > 0) {
      const grade = (typeof getViewerGrade === 'function') ? getViewerGrade() : '2';
      renderWorkoutTable(
        window.workouts,
        window.workoutRoomStatusMap || {},
        window.workoutRoomCodeMap || {},
        grade
      );
      attachTableEventListeners();
      window.showToast(`전체 ${window.workouts.length}개의 워크아웃을 표시합니다.`);
    } else {
      loadWorkouts();
    }
    return;
  }
  
  // 전체 워크아웃 목록이 없으면 로드
  if (!window.workouts || window.workouts.length === 0) {
    window.showToast('워크아웃 목록을 먼저 불러와주세요.');
    loadWorkouts();
    return;
  }
  
  // 검색어가 숫자인지 확인 (시간 검색)
  const isNumeric = /^\d+$/.test(searchQuery);
  const searchNumber = isNumeric ? parseInt(searchQuery, 10) : null;
  
  // 검색 필터링
  const filteredWorkouts = window.workouts.filter(workout => {
    if (!workout || typeof workout !== 'object') {
      return false;
    }
    
    const title = String(workout.title || '').toLowerCase();
    const searchLower = searchQuery.toLowerCase();
    
    // 제목 검색
    const titleMatch = title.includes(searchLower);
    
    // 시간 검색 (분 단위)
    let timeMatch = false;
    if (isNumeric && searchNumber !== null) {
      const totalMinutes = Math.round((workout.total_seconds || 0) / 60);
      timeMatch = totalMinutes === searchNumber;
    }
    
    // 제목 또는 시간 중 하나라도 일치하면 표시
    return titleMatch || timeMatch;
  });
  
  // 검색 결과 렌더링
  const grade = (typeof getViewerGrade === 'function') ? getViewerGrade() : '2';
  renderWorkoutTable(
    filteredWorkouts,
    window.workoutRoomStatusMap || {},
    window.workoutRoomCodeMap || {},
    grade
  );
  attachTableEventListeners();
  
  // 검색 결과 메시지
  if (filteredWorkouts.length === 0) {
    window.showToast(`'${searchQuery}'에 대한 검색 결과가 없습니다.`, 'warning');
  } else {
    window.showToast(`검색 결과: ${filteredWorkouts.length}개의 워크아웃을 찾았습니다.`);
  }
}

/**
 * 테이블 이벤트 리스너 연결 (재사용 함수)
 */
function attachTableEventListeners() {
  // 그룹훈련 버튼에 이벤트 리스너 추가
  document.querySelectorAll('[id^="createGroupRoomBtn-"]').forEach(btn => {
    const workoutId = btn.dataset.workoutId;
    const workoutTitle = btn.dataset.workoutTitle;
    if (workoutId && workoutTitle) {
      btn.addEventListener('click', async () => {
        if (typeof window.createGroupRoomFromWorkout === 'function') {
          await window.createGroupRoomFromWorkout(workoutId, workoutTitle);
        } else if (typeof createGroupRoomFromWorkout === 'function') {
          await createGroupRoomFromWorkout(workoutId, workoutTitle);
        } else {
          console.error('createGroupRoomFromWorkout 함수를 찾을 수 없습니다.');
          if (typeof showToast === 'function') {
            showToast('그룹훈련방 생성 기능을 찾을 수 없습니다', 'error');
          }
        }
      });
    }
  });
  
  // 그룹훈련 칼럼 이미지 클릭 시 그룹훈련방 입장
  document.querySelectorAll('.group-room-open-icon.clickable').forEach(icon => {
    const roomCode = icon.dataset.roomCode;
    if (roomCode) {
      icon.addEventListener('click', async () => {
        console.log('그룹훈련방 입장 시도:', roomCode);
        if (typeof window.joinRoomByCode === 'function') {
          await window.joinRoomByCode(roomCode);
        } else if (typeof joinRoomByCode === 'function') {
          await joinRoomByCode(roomCode);
        } else {
          console.error('joinRoomByCode 함수를 찾을 수 없습니다.');
          if (typeof showToast === 'function') {
            showToast('그룹훈련방 입장 기능을 찾을 수 없습니다', 'error');
          }
        }
      });
    }
  });
}

function applyWorkoutPermissions() {
     // 등급 판정: userManager의 getViewerGrade() 사용 (없으면 기본 '2')
     const grade = (typeof getViewerGrade === 'function') ? getViewerGrade() : '2';
   
     // 1) 새 워크아웃 버튼
     const newBtn = document.getElementById('btnOpenBuilder'); // index.html에 존재
     // (+ 새 워크아웃) 버튼 id 확인: id="btnOpenBuilder" :contentReference[oaicite:1]{index=1}
     if (newBtn) {
       if (grade === '2') {
         newBtn.disabled = true;
         newBtn.classList.add('is-disabled');
         newBtn.title = '권한이 없습니다 (등급 2)';
         newBtn.onclick = null;
       } else {
         newBtn.disabled = false;
         newBtn.classList.remove('is-disabled');
         newBtn.title = '';
         // 기존 onclick은 index.html에 바인딩되어 있으므로 그대로 유지
       }
     }
   
     // 2) 각 워크아웃 테이블 행의 수정/삭제 버튼
     // loadWorkouts가 렌더하는 클래스: .btn-edit, .btn-delete
     const editBtns = document.querySelectorAll('.workout-actions-cell .btn-edit');
     const delBtns  = document.querySelectorAll('.workout-actions-cell .btn-delete');
   
     const setDisabled = (btn, disabled) => {
       if (!btn) return;
       if (disabled) {
         btn.setAttribute('data-original-onclick', btn.getAttribute('onclick') || '');
         btn.removeAttribute('onclick');
         btn.classList.add('is-disabled');
         btn.setAttribute('aria-disabled', 'true');
         btn.title = '권한이 없습니다 (등급 2)';
       } else {
         // 복원
         const oc = btn.getAttribute('data-original-onclick');
         if (oc) btn.setAttribute('onclick', oc);
         btn.classList.remove('is-disabled');
         btn.removeAttribute('aria-disabled');
         btn.title = '';
       }
     };
   
     const disable = (grade === '2');
     editBtns.forEach(b => setDisabled(b, disable));
     delBtns.forEach(b  => setDisabled(b, disable));
}

/* ===== 만료일 점검: grade=2 → D-7~D-1 사전 알림 + 만료일/만료 후 알림 ===== */
function checkExpiryAndWarn() {
  // 중복 표시 방지 (한 화면 로딩당 1회)
  if (window.__expiryWarnShown) return;
  
  const grade = (typeof getViewerGrade === 'function') ? getViewerGrade() : '2';
  if (grade !== '2') return; // 등급 1은 알림 불필요
  
  // 현재 사용자 정보 (currentUser → localStorage 폴백)
  let user = null;
  try {
    user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (e) { user = null; }
  
  const exp = user?.expiry_date;
  if (!exp) return; // 만료일 미설정이면 종료
  
  // 날짜 파싱 (YYYY-MM-DD 권장, 실패 시 Date.parse 폴백)
  const today = new Date(); today.setHours(0,0,0,0);
  const expDate = new Date(exp);
  if (isNaN(expDate.getTime())) {
    const alt = Date.parse(String(exp));
    if (isNaN(alt)) return;
    expDate.setTime(alt);
  }
  expDate.setHours(0,0,0,0);
  
  // 남은 일수 계산 (exp - today)
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((expDate.getTime() - today.getTime()) / msPerDay);
  
  let msg = null;
  if (diffDays < 0) {
    // 만료 후
    msg = '만료일이 지났습니다. 만료일 갱신 메세지를 띄워주세요';
  } else if (diffDays === 0) {
    // D-day
    msg = '오늘이 만료일입니다. 만료일 갱신 메세지를 띄워주세요';
  } else if (diffDays <= 7) {
    // D-7 ~ D-1 사전 알림
    msg = `만료일까지 D-${diffDays}일 남았습니다. 만료일 갱신 메세지를 띄워주세요`;
  }
  
  if (msg) {
    window.__expiryWarnShown = true;
    if (typeof window.showToast === 'function') {
      window.showToast(msg);
    } else {
      alert(msg);
    }
  }
}



async function selectWorkout(workoutId) {
  if (!workoutId) {
    window.showToast('유효하지 않은 워크아웃 ID입니다.');
    return;
  }
  
  const selectButton = document.getElementById(`selectWorkoutBtn-${workoutId}`);
  let originalButtonText = '';
  
  if (selectButton) {
    originalButtonText = selectButton.textContent;
    selectButton.textContent = '워크아웃 정보 연결 중...';
    selectButton.disabled = true;
    selectButton.classList.add('loading');
  }
  
  try {
    console.log('Selecting workout with ID:', workoutId);
    const result = await apiGetWorkout(workoutId);
    
    if (!result || !result.success) {
      console.error('Failed to get workout:', result?.error);
      window.showToast('워크아웃 정보를 불러올 수 없습니다.');
      return;
    }

    const workout = result.item;
    if (!workout) {
      window.showToast('워크아웃 데이터가 비어있습니다.');
      return;
    }
    
    console.log('Retrieved workout:', workout);
    
    window.currentWorkout = workout;
    
    try {
      localStorage.setItem('currentWorkout', JSON.stringify(workout));
    } catch (e) {
      console.warn('로컬 스토리지 저장 실패:', e);
    }

    window.showToast(`${workout.title || '워크아웃'}이 선택되었습니다.`);
    
    // 현재 활성화된 화면을 히스토리에 추가 (훈련 준비 화면으로 이동하기 전)
    // startScheduleTraining에서 이미 추가했을 수 있으므로, 중복 체크
    if (!window.screenHistory) {
      window.screenHistory = [];
    }
    
    // 현재 활성화된 화면 찾기
    const currentActive = document.querySelector(".screen.active") || 
                          Array.from(document.querySelectorAll(".screen")).find(s => 
                            s.style.display === "block" || window.getComputedStyle(s).display === "block"
                          );
    
    if (currentActive && currentActive.id && currentActive.id !== 'trainingReadyScreen') {
      // 마지막 히스토리와 다를 때만 추가 (중복 방지)
      const lastHistory = window.screenHistory.length > 0 ? window.screenHistory[window.screenHistory.length - 1] : null;
      if (lastHistory !== currentActive.id) {
        window.screenHistory.push(currentActive.id);
        console.log(`[selectWorkout] Added to history: ${currentActive.id}, History:`, window.screenHistory);
        // 히스토리 크기 제한
        if (window.screenHistory.length > 10) {
          window.screenHistory.shift();
        }
      }
    }
    
    // skipHistory를 false로 설정하여 showScreen 내부에서도 히스토리 체크 (이중 방지)
    window.showScreen('trainingReadyScreen', false);
    
    if (typeof updateWorkoutPreview === 'function') {
      updateWorkoutPreview();
    }
    
  } catch (error) {
    console.error('워크아웃 선택 실패:', error);
    window.showToast('워크아웃 선택 중 오류가 발생했습니다.');
  } finally {
    if (selectButton && originalButtonText) {
      selectButton.textContent = originalButtonText;
      selectButton.disabled = false;
      selectButton.classList.remove('loading');
    }
  }
}

// ==========================================================
// 워크아웃 폼 관리
// ==========================================================

function showAddWorkoutForm(clearForm = true) {
  window.showScreen('workoutBuilderScreen');
  
  if (clearForm) {
    const titleEl = safeGetElement('wbTitle');
    const descEl = safeGetElement('wbDesc');
    const authorEl = safeGetElement('wbAuthor');
    const statusEl = safeGetElement('wbStatus');
    const publishDateEl = safeGetElement('wbPublishDate');
    
    if (titleEl) titleEl.value = '';
    if (descEl) descEl.value = '';
    if (authorEl) authorEl.value = '';
    if (statusEl) statusEl.value = '보이기';
    if (publishDateEl) publishDateEl.value = '';
    
    workoutSegments = [];
    if (typeof renderSegments === 'function') {
      renderSegments();
    }
    if (typeof updateSegmentSummary === 'function') {
      updateSegmentSummary();
    }
  }
}

async function saveWorkout() {
  if (isWorkoutEditMode) {
    console.log('Edit mode active - saveWorkout blocked');
    return;
  }

  const titleEl = safeGetElement('wbTitle');
  const descEl = safeGetElement('wbDesc');
  const authorEl = safeGetElement('wbAuthor');
  const statusEl = safeGetElement('wbStatus');
  const publishDateEl = safeGetElement('wbPublishDate');
  const saveBtn = safeGetElement('btnSaveWorkout');

  if (!titleEl || !descEl || !authorEl || !statusEl || !publishDateEl) {
    window.showToast('필수 입력 요소를 찾을 수 없습니다. 페이지를 새로고침해주세요.');
    return;
  }

  const title = (titleEl.value || '').trim();
  const description = (descEl.value || '').trim();
  const author = (authorEl.value || '').trim();
  const status = statusEl.value || '보이기';
  const publishDate = publishDateEl.value || null;

  if (!title) {
    window.showToast('제목을 입력해주세요.');
    titleEl.focus();
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('btn-saving', 'saving-state');
    saveBtn.innerHTML = '<span class="saving-spinner"></span>저장 중...';
  }

  try {
    console.log('=== 통합 워크아웃 저장 시작 ===');
    console.log('Title:', title);
    console.log('Segments count:', workoutSegments.length);

    const validSegments = workoutSegments.filter(segment => 
      segment && typeof segment === 'object' && segment.label
    ).map(segment => {
      const targetType = String(segment.target_type || 'ftp_pct');
      let targetValue = segment.target_value;
      
      // target_type에 따라 target_value 처리
      if (targetType === 'dual') {
        // dual 타입: target_value는 "100/120" 형식의 문자열로 저장
        targetValue = String(targetValue || '100/90');
      } else {
        // ftp_pct 또는 cadence_rpm 타입: 숫자로 저장
        targetValue = Number(targetValue) || (targetType === 'cadence_rpm' ? 90 : 100);
      }
      
      return {
        label: String(segment.label || '세그먼트'),
        segment_type: String(segment.segment_type || 'interval'),
        duration_sec: Number(segment.duration_sec) || 300,
        target_type: targetType,
        target_value: targetValue,
        ramp: String(segment.ramp || 'none'),
        ramp_to_value: segment.ramp !== 'none' ? Number(segment.ramp_to_value) || null : null
      };
    });

    const workoutData = { 
      title, 
      description, 
      author, 
      status, 
      publish_date: publishDate,
      segments: validSegments
    };

    console.log('Final workout data:', workoutData);
    
    if (validSegments.length > 0) {
      window.showToast(`워크아웃(${validSegments.length}개 세그먼트)을 저장하는 중입니다...`);
    } else {
      window.showToast('워크아웃을 저장하는 중입니다...');
    }
    
    const result = await apiCreateWorkoutWithSegments(workoutData);
    
    console.log('API result:', result);
    
    if (result && result.success) {
      let message = `${title} 워크아웃이 성공적으로 저장되었습니다!`;
      
      if (result.addedSegments !== undefined) {
        message += ` (${result.addedSegments}개 세그먼트)`;
      }
      
      if (result.warning) {
        message += `\n주의: ${result.warning}`;
      }
      
      window.showToast(message);
      
      workoutSegments = [];
      if (typeof renderSegments === 'function') {
        renderSegments();
      }
      if (typeof updateSegmentSummary === 'function') {
        updateSegmentSummary();
      }
      
      window.showScreen('workoutScreen');
      
      setTimeout(() => {
        loadWorkouts();
      }, 500);
      
    } else {
      throw new Error(result?.error || '알 수 없는 오류가 발생했습니다.');
    }
    
  } catch (error) {
    console.error('워크아웃 저장 실패:', error);
    window.showToast('워크아웃 저장 중 오류가 발생했습니다: ' + error.message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('btn-saving', 'saving-state');
      saveBtn.innerHTML = '💾 저장';
    }
  }
}

// 기존 editWorkout 함수를 이렇게 수정하세요
async function editWorkout(workoutId) {
  if (!workoutId) {
    window.showToast('유효하지 않은 워크아웃 ID입니다.');
    return;
  }
  
  try {
    const result = await apiGetWorkout(workoutId);
    
    if (!result || !result.success) {
      window.showToast('워크아웃 정보를 불러올 수 없습니다.');
      return;
    }

    const workout = result.item;
    if (!workout) {
      window.showToast('워크아웃 데이터가 없습니다.');
      return;
    }
    
    // 수정 모드 활성화
    isWorkoutEditMode = true;
    currentEditWorkoutId = workoutId;
    console.log('Edit mode activated for workout:', workoutId);
    
    // 워크아웃 빌더 화면으로 이동 (폼 초기화 안함)
    showAddWorkoutForm(false);
    
    // 기본 정보 채우기
    const titleEl = safeGetElement('wbTitle');
    const descEl = safeGetElement('wbDesc');
    const authorEl = safeGetElement('wbAuthor');
    const statusEl = safeGetElement('wbStatus');
    const publishDateEl = safeGetElement('wbPublishDate');
    
    if (titleEl) titleEl.value = workout.title || '';
    if (descEl) descEl.value = workout.description || '';
    if (authorEl) authorEl.value = workout.author || '';
    if (statusEl) statusEl.value = workout.status || '보이기';
    if (publishDateEl) publishDateEl.value = workout.publish_date ? workout.publish_date.split('T')[0] : '';
    
    // 🔥 핵심 추가: 세그먼트 데이터 로드
    if (workout.segments && Array.isArray(workout.segments)) {
      // 기존 세그먼트 배열 초기화 후 새 데이터로 채우기
      workoutSegments = workout.segments.map((segment, index) => ({
        id: segment.id || (Date.now() + index), // ID가 없으면 임시 ID 생성
        label: segment.label || '세그먼트',
        segment_type: segment.segment_type || 'interval',
        duration_sec: Number(segment.duration_sec) || 300,
        target_type: segment.target_type || 'ftp_percent',
        target_value: Number(segment.target_value) || 100,
        ramp: segment.ramp || 'none',
        ramp_to_value: segment.ramp !== 'none' ? Number(segment.ramp_to_value) || null : null
      }));
      
      console.log('Loaded segments for editing:', workoutSegments);
      
      // 세그먼트 목록 화면에 표시
      if (typeof renderSegments === 'function') {
        renderSegments();
      }
      
      // 세그먼트 요약 정보 업데이트
      if (typeof updateSegmentSummary === 'function') {
        updateSegmentSummary();
      }
      
      window.showToast(`${workoutSegments.length}개의 세그먼트가 로드되었습니다. 개별 수정이 가능합니다.`);
    } else {
      // 세그먼트가 없는 경우
      workoutSegments = [];
      if (typeof renderSegments === 'function') {
        renderSegments();
      }
      if (typeof updateSegmentSummary === 'function') {
        updateSegmentSummary();
      }
      console.log('No segments found in workout');
    }
    
    // UI 수정 모드로 변경
    const saveBtn = safeGetElement('btnSaveWorkout');
    if (saveBtn) {
      saveBtn.textContent = '수정 완료';
      saveBtn.onclick = performWorkoutUpdate;
    }
    
    const formTitle = document.querySelector('#workoutBuilderScreen .header h1');
    if (formTitle) {
      formTitle.textContent = '워크아웃 수정';
    }
    
  } catch (error) {
    console.error('워크아웃 수정 실패:', error);
    window.showToast('워크아웃 정보 로드 중 오류가 발생했습니다.');
  }
}

// performWorkoutUpdate 세그먼트 업데이트 함수 수정
async function performWorkoutUpdate() {
  if (!isWorkoutEditMode || !currentEditWorkoutId) {
    console.error('Invalid edit mode state');
    return;
  }

  const titleEl = safeGetElement('wbTitle');
  const descEl = safeGetElement('wbDesc');
  const authorEl = safeGetElement('wbAuthor');
  const statusEl = safeGetElement('wbStatus');
  const publishDateEl = safeGetElement('wbPublishDate');
  const saveBtn = safeGetElement('btnSaveWorkout');

  if (!titleEl || !descEl || !authorEl || !statusEl || !publishDateEl) {
    window.showToast('폼 요소를 찾을 수 없습니다.');
    return;
  }

  const title = (titleEl.value || '').trim();
  const description = (descEl.value || '').trim();
  const author = (authorEl.value || '').trim();
  const status = statusEl.value || '보이기';
  const publishDate = publishDateEl.value || null;

  if (!title) {
    window.showToast('제목을 입력해주세요.');
    return;
  }

  // 저장 중 UI 표시
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('btn-saving', 'saving-state');
    saveBtn.innerHTML = '<span class="saving-spinner"></span>수정 중...';
  }

  try {
    // 1단계: 기본 정보 업데이트
    const workoutData = { title, description, author, status, publish_date: publishDate };
    console.log('Updating workout:', currentEditWorkoutId, 'with data:', workoutData);
    
    const basicUpdateResult = await apiUpdateWorkout(currentEditWorkoutId, workoutData);
    
    if (!basicUpdateResult || !basicUpdateResult.success) {
      throw new Error(basicUpdateResult?.error || '워크아웃 기본 정보 업데이트 실패');
    }

    // 2단계: 세그먼트가 수정되었다면 새로 생성된 워크아웃으로 교체
    if (workoutSegments && workoutSegments.length > 0) {
      console.log(`세그먼트 ${workoutSegments.length}개와 함께 워크아웃 재생성 중...`);
      
      // 세그먼트 데이터 정규화
      const validSegments = workoutSegments.filter(segment => 
        segment && typeof segment === 'object' && segment.label
      ).map(segment => {
        const targetType = String(segment.target_type || 'ftp_pct');
        let targetValue = segment.target_value;
        
        // target_type에 따라 target_value 처리
        if (targetType === 'dual') {
          // dual 타입: target_value는 "100/120" 형식의 문자열로 저장
          targetValue = String(targetValue || '100/90');
        } else if (targetType === 'cadence_rpm') {
          // cadence_rpm 타입: 숫자로 저장 (50-200 범위)
          targetValue = Math.max(50, Math.min(200, Number(targetValue) || 90));
        } else {
          // ftp_pct 타입: 숫자로 저장 (30-200 범위)
          targetValue = Math.max(30, Math.min(200, Number(targetValue) || 100));
        }
        
        return {
          label: String(segment.label || '세그먼트'),
          segment_type: String(segment.segment_type || 'interval'),
          duration_sec: Number(segment.duration_sec) || 300,
          target_type: targetType,
          target_value: targetValue,
          ramp: String(segment.ramp || 'none'),
          ramp_to_value: segment.ramp !== 'none' ? Number(segment.ramp_to_value) || null : null
        };
      });

      // 기존 워크아웃 삭제
      const deleteResult = await apiDeleteWorkout(currentEditWorkoutId);
      if (!deleteResult || !deleteResult.success) {
        console.warn('기존 워크아웃 삭제 실패, 계속 진행:', deleteResult?.error);
      }

      // 새 워크아웃 생성 (세그먼트 포함)
      const newWorkoutData = { 
        title, 
        description, 
        author, 
        status, 
        publish_date: publishDate,
        segments: validSegments
      };

      const createResult = await apiCreateWorkoutWithSegments(newWorkoutData);
      
      if (!createResult || !createResult.success) {
        throw new Error(createResult?.error || '세그먼트 포함 워크아웃 재생성 실패');
      }

      let message = `워크아웃이 성공적으로 수정되었습니다!`;
      if (createResult.addedSegments !== undefined) {
        message += ` (${createResult.addedSegments}개 세그먼트 포함)`;
      }
      
      if (createResult.warning) {
        message += `\n주의: ${createResult.warning}`;
      }
      
      window.showToast(message);
    } else {
      // 세그먼트가 없는 경우 기본 정보만 업데이트
      window.showToast('워크아웃 정보가 수정되었습니다.');
    }
    
    // 수정 모드 해제 및 목록 새로고침
    resetWorkoutFormMode();
    setTimeout(() => {
      loadWorkouts();
    }, 500);
    
  } catch (error) {
    console.error('워크아웃 업데이트 실패:', error);
    window.showToast('워크아웃 수정 중 오류가 발생했습니다: ' + error.message);
  } finally {
    // UI 복원
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('btn-saving', 'saving-state');
      saveBtn.innerHTML = '수정 완료';
    }
  }
}

async function deleteWorkout(workoutId) {
  if (!workoutId) {
    window.showToast('유효하지 않은 워크아웃 ID입니다.');
    return;
  }
  
  if (!confirm('정말로 이 워크아웃을 삭제하시겠습니까?\n삭제된 워크아웃의 훈련 기록도 함께 삭제됩니다.')) {
    return;
  }

  try {
    const result = await apiDeleteWorkout(workoutId);
    
    if (result && result.success) {
      window.showToast('워크아웃이 삭제되었습니다.');
      loadWorkouts();
    } else {
      window.showToast('워크아웃 삭제 실패: ' + (result?.error || '알 수 없는 오류'));
    }
    
  } catch (error) {
    console.error('워크아웃 삭제 실패:', error);
    window.showToast('워크아웃 삭제 중 오류가 발생했습니다.');
  }
}

function resetWorkoutFormMode() {
  isWorkoutEditMode = false;
  currentEditWorkoutId = null;
  
  window.showScreen('workoutScreen');
  
  const saveBtn = safeGetElement('btnSaveWorkout');
  if (saveBtn) {
    saveBtn.textContent = '💾 저장';
    saveBtn.onclick = saveWorkout;
  }
  
  const formTitle = document.querySelector('#workoutBuilderScreen .header h1');
  if (formTitle) {
    formTitle.textContent = '✏️ 워크아웃 작성';
  }
  
  console.log('Workout form mode reset to add mode');
}

// 워크아웃 프리뷰 업데이트 (그룹화 적용)
function updateWorkoutPreview() {
  const workout = window.currentWorkout;
  if (!workout) {
    console.warn('currentWorkout이 설정되지 않았습니다.');
    return;
  }

  console.log('Updating workout preview with:', workout);

  const nameEl = safeGetElement('previewWorkoutName');
  const durationEl = safeGetElement('previewDuration');
  const intensityEl = safeGetElement('previewIntensity');
  const tssEl = safeGetElement('previewTSS');

  if (nameEl) nameEl.textContent = workout.title || '워크아웃';
  
  const totalMinutes = Math.round((workout.total_seconds || 0) / 60);
  if (durationEl) durationEl.textContent = `${totalMinutes}분`;

  let avgIntensity = 0;
  let totalDuration = 0;
  
  if (workout.segments && Array.isArray(workout.segments) && workout.segments.length > 0) {
    let weightedSum = 0;
    
    workout.segments.forEach(segment => {
      const duration = Number(segment.duration_sec) || 0;
      const intensity = Number(segment.target_value) || 0;
      weightedSum += (duration * intensity);
      totalDuration += duration;
    });
    
    if (totalDuration > 0) {
      avgIntensity = Math.round(weightedSum / totalDuration);
    }
  }
  
  if (intensityEl) intensityEl.textContent = `${avgIntensity}%`;

   // === TSS (NP 근사 기반) ===
   const T = totalDuration; // 총 지속시간(초)
   let sumI4t = 0;
   
   (workout.segments || []).forEach(seg => {
     const t = Number(seg.duration_sec) || 0;
     let I1 = (Number(seg.target_value) || 0) / 100; // 시작 강도(비율)
   
     // 램프가 있으면 끝 강도 보정
     if (seg.ramp && seg.ramp_to_value != null) {
       const I2 = (Number(seg.ramp_to_value) || I1 * 100) / 100;
       // 선형 램프 구간의 I^4 평균 근사: (I1^4 + I2^4)/2
       const i4avg = (Math.pow(I1, 4) + Math.pow(I2, 4)) / 2;
       sumI4t += i4avg * t;
     } else {
       sumI4t += Math.pow(I1, 4) * t;
     }
   });
   
   const IF = T > 0 ? Math.pow(sumI4t / T, 0.25) : 0;
   const estimatedTSS = Math.round((T / 3600) * (IF * IF) * 100);
   
   if (tssEl) tssEl.textContent = String(estimatedTSS);


  // 그룹화된 세그먼트 프리뷰 사용
  updateSegmentPreviewGrouped(workout.segments || []);
}

// ==========================================================
// 최적화된 세그먼트 렌더링 (40개+ 세그먼트 대응)
// ==========================================================

function renderSegments() {
  // 필수 메인 컨테이너: 없으면 즉시 에러로 잡아내고 반환
  const container = safeGetElement('wbSegments', { required: true, quiet: false });

  // 빈상태 표시용 보조 요소: 없을 수도 있으므로 조용히 조회
  const emptyState = safeGetElement('segmentsEmpty', { quiet: true });

  if (workoutSegments.length > 20) {
    renderSegmentsVirtualized(container, emptyState);
    return;
  }

  if (workoutSegments.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    container.innerHTML = '';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  const fragment = document.createDocumentFragment();
  workoutSegments.forEach((segment, index) => {
    const card = createSegmentCard(segment, index);
    fragment.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(fragment);
}


function renderSegmentsVirtualized(container, emptyState) {
  if (emptyState) emptyState.style.display = 'none';
  
  const ITEMS_PER_PAGE = 15;
  const currentPage = window.segmentPage || 0;
  const totalPages = Math.ceil(workoutSegments.length / ITEMS_PER_PAGE);
  
  const startIndex = currentPage * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, workoutSegments.length);
  const visibleSegments = workoutSegments.slice(startIndex, endIndex);
  
  container.innerHTML = `
    <div class="segments-header">
      <div class="segments-summary">
        <span>총 ${workoutSegments.length}개 세그먼트</span>
        <span>|</span>
        <span>${startIndex + 1}-${endIndex} 표시 중</span>
      </div>
      <div class="segments-pagination">
        <button 
          class="btn btn-sm" 
          onclick="changeSegmentPage(${currentPage - 1})"
          ${currentPage === 0 ? 'disabled' : ''}>
          ← 이전
        </button>
        <span class="page-info">${currentPage + 1} / ${totalPages}</span>
        <button 
          class="btn btn-sm" 
          onclick="changeSegmentPage(${currentPage + 1})"
          ${currentPage >= totalPages - 1 ? 'disabled' : ''}>
          다음 →
        </button>
      </div>
    </div>
    <div class="segments-container" id="segmentsContainer"></div>
  `;
  
  const segmentsContainer = document.getElementById('segmentsContainer');
  const fragment = document.createDocumentFragment();
  
  visibleSegments.forEach((segment, localIndex) => {
    const globalIndex = startIndex + localIndex;
    const card = createSegmentCard(segment, globalIndex);
    fragment.appendChild(card);
  });
  
  segmentsContainer.appendChild(fragment);
  
  setTimeout(() => {
    const saveBtn = safeGetElement('btnSaveWorkout');
    const cancelBtn = safeGetElement('btnCancelBuilder');
    if (saveBtn) saveBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }, 100);
}

function changeSegmentPage(newPage) {
  const totalPages = Math.ceil(workoutSegments.length / 15);
  if (newPage >= 0 && newPage < totalPages) {
    window.segmentPage = newPage;
    renderSegments();
  }
}

function createSegmentCard(segment, index) {
  const card = document.createElement('div');
  card.className = 'segment-card';
  card.setAttribute('data-index', index);
  
  const minutes = Math.floor((segment.duration_sec || 0) / 60);
  const seconds = (segment.duration_sec || 0) % 60;
  const duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  
  // target_type에 따라 표시 형식 변경
  const targetType = segment.target_type || 'ftp_pct';
  let intensityText = '';
  
  if (targetType === 'ftp_pct') {
    const ftpValue = Number(segment.target_value) || 0;
    intensityText = segment.ramp !== 'none' 
      ? `${ftpValue}% → ${segment.ramp_to_value}%`
      : `${ftpValue}% FTP`;
  } else if (targetType === 'cadence_rpm') {
    const rpmValue = Number(segment.target_value) || 0;
    intensityText = `${rpmValue} rpm`;
  } else if (targetType === 'dual') {
    // dual 타입: "100/120" 형식 파싱
    const targetValue = segment.target_value;
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim());
      if (parts.length >= 2) {
        intensityText = `${parts[0]}% FTP / ${parts[1]} rpm`;
      } else {
        intensityText = `${parts[0]}% FTP`;
      }
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      intensityText = `${targetValue[0]}% FTP / ${targetValue[1]} rpm`;
    } else {
      const numValue = Number(targetValue);
      if (numValue > 1000 && numValue < 1000000) {
        const str = String(numValue);
        if (str.length >= 4) {
          const rpmPart = str.slice(-3);
          const ftpPart = str.slice(0, -3);
          intensityText = `${ftpPart}% FTP / ${rpmPart} rpm`;
        } else {
          intensityText = `${numValue}% FTP`;
        }
      } else {
        intensityText = `${numValue || 100}% FTP`;
      }
    }
  } else {
    intensityText = `${Number(segment.target_value) || 0}% FTP`;
  }
  
  card.innerHTML = `
    <div class="segment-info">
      <div class="segment-details">
        <div class="segment-label" title="${escapeHtml(segment.label)}">${escapeHtml(segment.label)}</div>
        <div class="segment-meta">
          <span class="segment-type-badge ${segment.segment_type}">${segment.segment_type}</span>
          <span>${duration}</span>
          <span class="segment-intensity">${intensityText}</span>
        </div>
      </div>
    </div>
    <div class="segment-actions">
      <button class="segment-edit-btn" onclick="showEditSegmentModal(${index})" title="편집">✏️</button>
      <button class="segment-delete-btn" onclick="deleteSegment(${index})" title="삭제">🗑️</button>
    </div>
  `;
  
  return card;
}

function updateSegmentSummary() {
  if (window.updateSummaryTimeout) {
    clearTimeout(window.updateSummaryTimeout);
  }
  
  window.updateSummaryTimeout = setTimeout(() => {
    const totalSeconds = workoutSegments.reduce((sum, seg) => sum + (seg.duration_sec || 0), 0);
    const totalMinutes = Math.round(totalSeconds / 60);
    const segmentCount = workoutSegments.length;
    
    const durationEl = safeGetElement('totalDuration');
    const countEl = safeGetElement('segmentCount');
    
    if (durationEl) durationEl.textContent = `${totalMinutes}분`;
    if (countEl) countEl.textContent = `${segmentCount}개`;
  }, 200);
}

// ==========================================================
// 세그먼트 관리 함수들
// ==========================================================

function addQuickSegment(type) {
  const templates = {
    warmup: { label: '워밍업', type: 'warmup', duration: 600, intensity: 60 },
    interval: { label: '인터벌', type: 'interval', duration: 300, intensity: 120 },
    rest: { label: '휴식', type: 'rest', duration: 120, intensity: 50 },
    cooldown: { label: '쿨다운', type: 'cooldown', duration: 600, intensity: 60 }
  };
  
  const template = templates[type];
  if (template) {
    const segment = {
      id: Date.now(),
      label: template.label,
      segment_type: template.type,
      duration_sec: template.duration,
      target_type: 'ftp_percent',
      target_value: template.intensity,
      ramp: 'none',
      ramp_to_value: null
    };
    
    workoutSegments.push(segment);
    renderSegments();
    updateSegmentSummary();
    
    if (typeof window.showToast === 'function') {
      window.showToast(`${template.label} 세그먼트가 추가되었습니다.`);
    }
  }
}

function showAddSegmentModal() {
  currentEditingSegmentIndex = null;
  
  const modalTitle = safeGetElement('segmentModalTitle');
  const segmentLabel = safeGetElement('segmentLabel');
  const segmentType = safeGetElement('segmentType');
  const segmentMinutes = safeGetElement('segmentMinutes');
  const segmentSeconds = safeGetElement('segmentSeconds');
  const segmentIntensity = safeGetElement('segmentIntensity');
  const segmentRamp = safeGetElement('segmentRamp');
  const rampEndIntensity = safeGetElement('rampEndIntensity');
  const btnDeleteSegment = safeGetElement('btnDeleteSegment');
  const rampSettings = safeGetElement('rampSettings');
  const segmentModal = safeGetElement('segmentModal');
  
  const segmentTargetType = safeGetElement('segmentTargetType');
  const segmentTargetRpm = safeGetElement('segmentTargetRpm');
  
  if (modalTitle) modalTitle.textContent = '새 세그먼트 추가';
  if (segmentLabel) segmentLabel.value = '';
  if (segmentType) segmentType.value = 'interval';
  if (segmentMinutes) segmentMinutes.value = '5';
  if (segmentSeconds) segmentSeconds.value = '0';
  if (segmentIntensity) segmentIntensity.value = '100';
  if (segmentTargetType) segmentTargetType.value = 'ftp_pct';
  if (segmentTargetRpm) segmentTargetRpm.value = '90';
  if (segmentRamp) segmentRamp.checked = false;
  if (rampEndIntensity) rampEndIntensity.value = '120';
  
  // target_type에 따라 필드 업데이트
  updateTargetTypeFields();
  
  if (btnDeleteSegment) btnDeleteSegment.style.display = 'none';
  if (rampSettings) rampSettings.classList.add('hidden');
  if (segmentModal) segmentModal.classList.remove('hidden');
}

function showEditSegmentModal(index) {
  const segment = workoutSegments[index];
  if (!segment) return;
  
  currentEditingSegmentIndex = index;
  
  const modalTitle = safeGetElement('segmentModalTitle');
  const segmentLabel = safeGetElement('segmentLabel');
  const segmentType = safeGetElement('segmentType');
  const segmentMinutes = safeGetElement('segmentMinutes');
  const segmentSeconds = safeGetElement('segmentSeconds');
  const segmentIntensity = safeGetElement('segmentIntensity');
  const segmentRamp = safeGetElement('segmentRamp');
  const rampEndIntensity = safeGetElement('rampEndIntensity');
  const btnDeleteSegment = safeGetElement('btnDeleteSegment');
  const rampSettings = safeGetElement('rampSettings');
  const segmentModal = safeGetElement('segmentModal');
  
  if (modalTitle) modalTitle.textContent = '세그먼트 편집';
  if (segmentLabel) segmentLabel.value = segment.label || '';
  if (segmentType) segmentType.value = segment.segment_type || 'interval';
  
  const minutes = Math.floor((segment.duration_sec || 0) / 60);
  const seconds = (segment.duration_sec || 0) % 60;
  if (segmentMinutes) segmentMinutes.value = minutes;
  if (segmentSeconds) segmentSeconds.value = seconds;
  
  // target_type 설정
  const segmentTargetType = safeGetElement('segmentTargetType');
  const segmentTargetRpm = safeGetElement('segmentTargetRpm');
  const targetType = segment.target_type || 'ftp_pct';
  
  if (segmentTargetType) {
    segmentTargetType.value = targetType;
  }
  
  // target_value 파싱 및 설정
  if (targetType === 'dual') {
    // dual 타입: "100/120" 형식
    const targetValue = segment.target_value;
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim());
      if (parts.length >= 2) {
        if (segmentIntensity) segmentIntensity.value = parts[0] || 100;
        if (segmentTargetRpm) segmentTargetRpm.value = parts[1] || 90;
      } else {
        if (segmentIntensity) segmentIntensity.value = parts[0] || 100;
        if (segmentTargetRpm) segmentTargetRpm.value = 90;
      }
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      if (segmentIntensity) segmentIntensity.value = targetValue[0] || 100;
      if (segmentTargetRpm) segmentTargetRpm.value = targetValue[1] || 90;
    } else {
      // 숫자로 저장된 경우 복원 시도
      const numValue = Number(targetValue);
      if (numValue > 1000 && numValue < 1000000) {
        const str = String(numValue);
        if (str.length >= 4) {
          const rpmPart = str.slice(-3);
          const ftpPart = str.slice(0, -3);
          if (segmentIntensity) segmentIntensity.value = ftpPart || 100;
          if (segmentTargetRpm) segmentTargetRpm.value = rpmPart || 90;
        } else {
          if (segmentIntensity) segmentIntensity.value = segment.target_value || 100;
          if (segmentTargetRpm) segmentTargetRpm.value = 90;
        }
      } else {
        if (segmentIntensity) segmentIntensity.value = segment.target_value || 100;
        if (segmentTargetRpm) segmentTargetRpm.value = 90;
      }
    }
  } else {
    // ftp_pct 또는 cadence_rpm 타입
    if (segmentIntensity) segmentIntensity.value = segment.target_value || (targetType === 'cadence_rpm' ? 90 : 100);
    if (segmentTargetRpm) segmentTargetRpm.value = 90;
  }
  
  // target_type에 따라 필드 업데이트
  updateTargetTypeFields();
  
  const hasRamp = segment.ramp && segment.ramp !== 'none';
  if (segmentRamp) segmentRamp.checked = hasRamp;
  if (rampEndIntensity) rampEndIntensity.value = segment.ramp_to_value || 120;
  
  if (btnDeleteSegment) btnDeleteSegment.style.display = 'inline-block';
  
  if (rampSettings) {
    if (hasRamp) {
      rampSettings.classList.remove('hidden');
    } else {
      rampSettings.classList.add('hidden');
    }
  }
  
  if (segmentModal) segmentModal.classList.remove('hidden');
}

function toggleRampSettings() {
  const segmentRamp = safeGetElement('segmentRamp');
  const rampSettings = safeGetElement('rampSettings');
  
  if (segmentRamp && rampSettings) {
    const isChecked = segmentRamp.checked;
    if (isChecked) {
      rampSettings.classList.remove('hidden');
    } else {
      rampSettings.classList.add('hidden');
    }
  }
}

// target_type에 따라 입력 필드 동적 변경
function updateTargetTypeFields() {
  const targetType = safeGetElement('segmentTargetType');
  const targetValueGroup = safeGetElement('targetValueGroup');
  const targetRpmGroup = safeGetElement('targetRpmGroup');
  const targetValueLabel = safeGetElement('targetValueLabel');
  const targetValueSuffix = safeGetElement('targetValueSuffix');
  const segmentIntensity = safeGetElement('segmentIntensity');
  const segmentTargetRpm = safeGetElement('segmentTargetRpm');
  
  if (!targetType) return;
  
  const type = targetType.value;
  
  if (type === 'ftp_pct') {
    // % FTP 타입
    if (targetValueLabel) targetValueLabel.textContent = '목표 강도 *';
    if (targetValueSuffix) targetValueSuffix.textContent = '% FTP';
    if (segmentIntensity) {
      segmentIntensity.min = '30';
      segmentIntensity.max = '200';
      if (!segmentIntensity.value || segmentIntensity.value < 30) {
        segmentIntensity.value = '100';
      }
    }
    if (targetValueGroup) targetValueGroup.style.display = 'block';
    if (targetRpmGroup) targetRpmGroup.classList.add('hidden');
    
  } else if (type === 'cadence_rpm') {
    // rpm 타입
    if (targetValueLabel) targetValueLabel.textContent = '목표 강도 *';
    if (targetValueSuffix) targetValueSuffix.textContent = 'rpm';
    if (segmentIntensity) {
      segmentIntensity.min = '50';
      segmentIntensity.max = '200';
      if (!segmentIntensity.value || segmentIntensity.value < 50) {
        segmentIntensity.value = '90';
      }
    }
    if (targetValueGroup) targetValueGroup.style.display = 'block';
    if (targetRpmGroup) targetRpmGroup.classList.add('hidden');
    
  } else if (type === 'dual') {
    // dual 타입: %FTP와 rpm 모두 입력
    if (targetValueLabel) targetValueLabel.textContent = '목표 FTP% *';
    if (targetValueSuffix) targetValueSuffix.textContent = '% FTP';
    if (segmentIntensity) {
      segmentIntensity.min = '30';
      segmentIntensity.max = '200';
      if (!segmentIntensity.value || segmentIntensity.value < 30) {
        segmentIntensity.value = '100';
      }
    }
    if (targetValueGroup) targetValueGroup.style.display = 'block';
    if (targetRpmGroup) {
      targetRpmGroup.classList.remove('hidden');
      if (segmentTargetRpm && (!segmentTargetRpm.value || segmentTargetRpm.value < 50)) {
        segmentTargetRpm.value = '90';
      }
    }
  }
}

function saveSegment() {
  if (typeof currentEditingRepeatIndex === 'number' && currentEditingRepeatIndex !== null) {
    console.log('Saving repeat segment at index:', currentEditingRepeatIndex);
    saveRepeatSegment();
    return;
  }
  
  console.log('Saving regular segment');
  
  const segmentLabel = safeGetElement('segmentLabel');
  const segmentType = safeGetElement('segmentType');
  const segmentMinutes = safeGetElement('segmentMinutes');
  const segmentSeconds = safeGetElement('segmentSeconds');
  const segmentIntensity = safeGetElement('segmentIntensity');
  const segmentTargetType = safeGetElement('segmentTargetType');
  const segmentTargetRpm = safeGetElement('segmentTargetRpm');
  const segmentRamp = safeGetElement('segmentRamp');
  const rampEndIntensity = safeGetElement('rampEndIntensity');
  
  if (!segmentLabel || !segmentType || !segmentMinutes || !segmentSeconds || !segmentIntensity || !segmentTargetType) {
    window.showToast('세그먼트 폼 요소를 찾을 수 없습니다.');
    return;
  }
  
  const label = segmentLabel.value.trim();
  const type = segmentType.value;
  const minutes = parseInt(segmentMinutes.value) || 0;
  const seconds = parseInt(segmentSeconds.value) || 0;
  const targetType = segmentTargetType.value || 'ftp_pct';
  const intensity = parseInt(segmentIntensity.value) || (targetType === 'cadence_rpm' ? 90 : 100);
  const targetRpm = segmentTargetRpm ? parseInt(segmentTargetRpm.value) || 90 : 90;
  const hasRamp = segmentRamp ? segmentRamp.checked : false;
  const rampEndIntensityValue = rampEndIntensity ? parseInt(rampEndIntensity.value) || 120 : 120;
  
  if (!label) {
    window.showToast('세그먼트 이름을 입력해주세요.');
    return;
  }
  
  const totalSeconds = minutes * 60 + seconds;
  if (totalSeconds <= 0) {
    window.showToast('지속 시간은 0보다 커야 합니다.');
    return;
  }
  
  // target_type에 따른 유효성 검사
  let targetValue;
  if (targetType === 'ftp_pct') {
    if (intensity < 30 || intensity > 200) {
      window.showToast('목표 강도는 30-200% 범위여야 합니다.');
      return;
    }
    targetValue = intensity;
  } else if (targetType === 'cadence_rpm') {
    if (intensity < 50 || intensity > 200) {
      window.showToast('목표 RPM은 50-200 범위여야 합니다.');
      return;
    }
    targetValue = intensity;
  } else if (targetType === 'dual') {
    if (intensity < 30 || intensity > 200) {
      window.showToast('목표 FTP%는 30-200% 범위여야 합니다.');
      return;
    }
    if (targetRpm < 50 || targetRpm > 200) {
      window.showToast('목표 RPM은 50-200 범위여야 합니다.');
      return;
    }
    // dual 타입: "100/120" 형식으로 저장
    targetValue = `${intensity}/${targetRpm}`;
  } else {
    window.showToast('올바른 목표 강도 카테고리를 선택해주세요.');
    return;
  }
  
  const segment = {
    id: currentEditingSegmentIndex !== null ? workoutSegments[currentEditingSegmentIndex].id : Date.now(),
    label: label,
    segment_type: type,
    duration_sec: totalSeconds,
    target_type: targetType,
    target_value: targetValue,
    ramp: hasRamp ? 'linear' : 'none',
    ramp_to_value: hasRamp ? rampEndIntensityValue : null
  };
  
  if (currentEditingSegmentIndex !== null) {
    workoutSegments[currentEditingSegmentIndex] = segment;
  } else {
    workoutSegments.push(segment);
  }
  
  renderSegments();
  updateSegmentSummary();
  closeSegmentModal();
  
  window.showToast(currentEditingSegmentIndex !== null ? '세그먼트가 수정되었습니다.' : '세그먼트가 추가되었습니다.');
}

function deleteCurrentSegment() {
  if (currentEditingSegmentIndex === null) return;
  
  if (confirm('이 세그먼트를 삭제하시겠습니까?')) {
    workoutSegments.splice(currentEditingSegmentIndex, 1);
    renderSegments();
    updateSegmentSummary();
    closeSegmentModal();
    window.showToast('세그먼트가 삭제되었습니다.');
  }
}

function closeSegmentModal() {
  const segmentModal = safeGetElement('segmentModal');
  if (segmentModal) {
    segmentModal.classList.add('hidden');
  }
  
  if (currentEditingRepeatIndex !== null) {
    const repeatModal = safeGetElement('repeatModal');
    if (repeatModal) {
      repeatModal.classList.remove('hidden');
    }
    currentEditingRepeatIndex = null;
  }
  
  currentEditingSegmentIndex = null;
}

function deleteSegment(index) {
  if (confirm('이 세그먼트를 삭제하시겠습니까?')) {
    workoutSegments.splice(index, 1);
    renderSegments();
    updateSegmentSummary();
    window.showToast('세그먼트가 삭제되었습니다.');
  }
}

// ==========================================================
// 반복 세그먼트 관리
// ==========================================================

function showRepeatModal() {
  const repeatCount = safeGetElement('repeatCount');
  const repeatModal = safeGetElement('repeatModal');
  
  if (repeatCount) repeatCount.value = '3';
  repeatSegments = [];
  renderRepeatSegments();
  if (repeatModal) repeatModal.classList.remove('hidden');
}

function closeRepeatModal() {
  const repeatModal = safeGetElement('repeatModal');
  if (repeatModal) repeatModal.classList.add('hidden');
  repeatSegments = [];
  currentEditingRepeatIndex = null;
}

function addRepeatSegment() {
  const newSegment = {
    id: Date.now(),
    label: '새 세그먼트',
    segment_type: 'interval',
    duration_sec: 300,
    target_type: 'ftp_percent',
    target_value: 100,
    ramp: 'none',
    ramp_to_value: null
  };
  
  repeatSegments.push(newSegment);
  renderRepeatSegments();
}

function renderRepeatSegments() {
  const container = safeGetElement('repeatSegmentsList');
  if (!container) return;
  
  if (repeatSegments.length === 0) {
    container.innerHTML = '<div class="repeat-segments-empty">반복할 세그먼트를 추가하세요</div>';
    return;
  }
  
  container.innerHTML = repeatSegments.map((segment, index) => {
    const minutes = Math.floor(segment.duration_sec / 60);
    const seconds = segment.duration_sec % 60;
    const duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    return `
      <div class="repeat-segment-item" data-index="${index}">
        <div class="repeat-segment-info">
          <div class="repeat-segment-label">${escapeHtml(segment.label)}</div>
          <div class="repeat-segment-details">
            ${(() => {
              const targetType = segment.target_type || 'ftp_pct';
              if (targetType === 'ftp_pct') {
                return `${segment.segment_type} · ${duration} · ${Number(segment.target_value) || 0}% FTP`;
              } else if (targetType === 'cadence_rpm') {
                return `${segment.segment_type} · ${duration} · ${Number(segment.target_value) || 0} rpm`;
              } else if (targetType === 'dual') {
                const targetValue = segment.target_value;
                if (typeof targetValue === 'string' && targetValue.includes('/')) {
                  const parts = targetValue.split('/').map(s => s.trim());
                  if (parts.length >= 2) {
                    return `${segment.segment_type} · ${duration} · ${parts[0]}% FTP / ${parts[1]} rpm`;
                  } else {
                    return `${segment.segment_type} · ${duration} · ${parts[0]}% FTP`;
                  }
                } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
                  return `${segment.segment_type} · ${duration} · ${targetValue[0]}% FTP / ${targetValue[1]} rpm`;
                } else {
                  return `${segment.segment_type} · ${duration} · ${Number(targetValue) || 100}% FTP`;
                }
              } else {
                return `${segment.segment_type} · ${duration} · ${Number(segment.target_value) || 0}% FTP`;
              }
            })()}
          </div>
        </div>
        <div class="repeat-segment-actions">
          <button class="btn btn-secondary btn-sm" onclick="editRepeatSegment(${index})">편집</button>
          <button class="repeat-segment-remove" onclick="removeRepeatSegment(${index})" title="삭제">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function editRepeatSegment(index) {
  console.log('editRepeatSegment called with index:', index);
  
  const segment = repeatSegments[index];
  if (!segment) {
    console.error('Segment not found at index:', index);
    window.showToast('세그먼트를 찾을 수 없습니다.');
    return;
  }
  
  currentEditingRepeatIndex = index;
  currentEditingSegmentIndex = null;
  
  const modalTitle = safeGetElement('segmentModalTitle');
  const segmentLabel = safeGetElement('segmentLabel');
  const segmentType = safeGetElement('segmentType');
  const segmentMinutes = safeGetElement('segmentMinutes');
  const segmentSeconds = safeGetElement('segmentSeconds');
  const segmentIntensity = safeGetElement('segmentIntensity');
  const segmentRamp = safeGetElement('segmentRamp');
  const rampEndIntensity = safeGetElement('rampEndIntensity');
  const btnDeleteSegment = safeGetElement('btnDeleteSegment');
  const rampSettings = safeGetElement('rampSettings');
  const repeatModal = safeGetElement('repeatModal');
  const segmentModal = safeGetElement('segmentModal');
  
  const segmentTargetType = safeGetElement('segmentTargetType');
  const segmentTargetRpm = safeGetElement('segmentTargetRpm');
  
  if (modalTitle) modalTitle.textContent = '반복 세그먼트 편집';
  if (segmentLabel) segmentLabel.value = segment.label || '';
  if (segmentType) segmentType.value = segment.segment_type || 'interval';
  
  const minutes = Math.floor((segment.duration_sec || 0) / 60);
  const seconds = (segment.duration_sec || 0) % 60;
  if (segmentMinutes) segmentMinutes.value = minutes;
  if (segmentSeconds) segmentSeconds.value = seconds;
  
  // target_type 설정
  const targetType = segment.target_type || 'ftp_pct';
  if (segmentTargetType) {
    segmentTargetType.value = targetType;
  }
  
  // target_value 파싱 및 설정
  if (targetType === 'dual') {
    // dual 타입: "100/120" 형식
    const targetValue = segment.target_value;
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim());
      if (parts.length >= 2) {
        if (segmentIntensity) segmentIntensity.value = parts[0] || 100;
        if (segmentTargetRpm) segmentTargetRpm.value = parts[1] || 90;
      } else {
        if (segmentIntensity) segmentIntensity.value = parts[0] || 100;
        if (segmentTargetRpm) segmentTargetRpm.value = 90;
      }
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      if (segmentIntensity) segmentIntensity.value = targetValue[0] || 100;
      if (segmentTargetRpm) segmentTargetRpm.value = targetValue[1] || 90;
    } else {
      if (segmentIntensity) segmentIntensity.value = segment.target_value || 100;
      if (segmentTargetRpm) segmentTargetRpm.value = 90;
    }
  } else {
    // ftp_pct 또는 cadence_rpm 타입
    if (segmentIntensity) segmentIntensity.value = segment.target_value || (targetType === 'cadence_rpm' ? 90 : 100);
    if (segmentTargetRpm) segmentTargetRpm.value = 90;
  }
  
  // target_type에 따라 필드 업데이트
  updateTargetTypeFields();
  
  const hasRamp = segment.ramp && segment.ramp !== 'none';
  if (segmentRamp) segmentRamp.checked = hasRamp;
  if (rampEndIntensity) rampEndIntensity.value = segment.ramp_to_value || 120;
  
  if (rampSettings) {
    if (hasRamp) {
      rampSettings.classList.remove('hidden');
    } else {
      rampSettings.classList.add('hidden');
    }
  }
  
  if (btnDeleteSegment) btnDeleteSegment.style.display = 'none';
  
  if (repeatModal) repeatModal.classList.add('hidden');
  if (segmentModal) segmentModal.classList.remove('hidden');
}

function removeRepeatSegment(index) {
  if (confirm('이 세그먼트를 제거하시겠습니까?')) {
    repeatSegments.splice(index, 1);
    renderRepeatSegments();
  }
}

function applyRepeat() {
  const repeatCountEl = safeGetElement('repeatCount');
  if (!repeatCountEl) return;
  
  const repeatCount = parseInt(repeatCountEl.value);
  
  if (!repeatCount || repeatCount < 1 || repeatCount > 20) {
    window.showToast('반복 횟수는 1-20 사이여야 합니다.');
    return;
  }
  
  if (repeatSegments.length === 0) {
    window.showToast('반복할 세그먼트를 최소 1개 이상 추가해주세요.');
    return;
  }
  
  for (let i = 0; i < repeatCount; i++) {
    repeatSegments.forEach(segment => {
      const newSegment = {
        id: Date.now() + Math.random(),
        label: segment.label, // 회차 라벨링 제거
        segment_type: segment.segment_type,
        duration_sec: segment.duration_sec,
        target_type: segment.target_type,
        target_value: segment.target_value,
        ramp: segment.ramp,
        ramp_to_value: segment.ramp_to_value
      };
      
      workoutSegments.push(newSegment);
    });
  }
  
  renderSegments();
  updateSegmentSummary();
  closeRepeatModal();
  
  const totalAdded = repeatSegments.length * repeatCount;
  window.showToast(`${totalAdded}개의 세그먼트가 추가되었습니다.`);
}

function saveRepeatSegment() {
  console.log('saveRepeatSegment called');
  
  const segmentLabel = safeGetElement('segmentLabel');
  const segmentType = safeGetElement('segmentType');
  const segmentMinutes = safeGetElement('segmentMinutes');
  const segmentSeconds = safeGetElement('segmentSeconds');
  const segmentIntensity = safeGetElement('segmentIntensity');
  const segmentTargetType = safeGetElement('segmentTargetType');
  const segmentTargetRpm = safeGetElement('segmentTargetRpm');
  const segmentRamp = safeGetElement('segmentRamp');
  const rampEndIntensity = safeGetElement('rampEndIntensity');
  
  if (!segmentLabel || !segmentType || !segmentMinutes || !segmentSeconds || !segmentIntensity || !segmentTargetType) {
    window.showToast('세그먼트 폼 요소를 찾을 수 없습니다.');
    return;
  }
  
  const label = segmentLabel.value.trim();
  const type = segmentType.value;
  const minutes = parseInt(segmentMinutes.value) || 0;
  const seconds = parseInt(segmentSeconds.value) || 0;
  const targetType = segmentTargetType.value || 'ftp_pct';
  const intensity = parseInt(segmentIntensity.value) || (targetType === 'cadence_rpm' ? 90 : 100);
  const targetRpm = segmentTargetRpm ? parseInt(segmentTargetRpm.value) || 90 : 90;
  const hasRamp = segmentRamp ? segmentRamp.checked : false;
  const rampEndIntensityValue = rampEndIntensity ? parseInt(rampEndIntensity.value) || 120 : 120;
  
  if (!label) {
    window.showToast('세그먼트 이름을 입력해주세요.');
    return;
  }
  
  const totalSeconds = minutes * 60 + seconds;
  if (totalSeconds <= 0) {
    window.showToast('지속 시간은 0보다 커야 합니다.');
    return;
  }
  
  // target_type에 따른 유효성 검사
  let targetValue;
  if (targetType === 'ftp_pct') {
    if (intensity < 30 || intensity > 200) {
      window.showToast('목표 강도는 30-200% 범위여야 합니다.');
      return;
    }
    targetValue = intensity;
  } else if (targetType === 'cadence_rpm') {
    if (intensity < 50 || intensity > 200) {
      window.showToast('목표 RPM은 50-200 범위여야 합니다.');
      return;
    }
    targetValue = intensity;
  } else if (targetType === 'dual') {
    if (intensity < 30 || intensity > 200) {
      window.showToast('목표 FTP%는 30-200% 범위여야 합니다.');
      return;
    }
    if (targetRpm < 50 || targetRpm > 200) {
      window.showToast('목표 RPM은 50-200 범위여야 합니다.');
      return;
    }
    // dual 타입: "100/120" 형식으로 저장
    targetValue = `${intensity}/${targetRpm}`;
  } else {
    window.showToast('올바른 목표 강도 카테고리를 선택해주세요.');
    return;
  }
  
  if (currentEditingRepeatIndex !== null && repeatSegments[currentEditingRepeatIndex]) {
    repeatSegments[currentEditingRepeatIndex] = {
      id: repeatSegments[currentEditingRepeatIndex].id,
      label: label,
      segment_type: type,
      duration_sec: totalSeconds,
      target_type: targetType,
      target_value: targetValue,
      ramp: hasRamp ? 'linear' : 'none',
      ramp_to_value: hasRamp ? rampEndIntensityValue : null
    };
    
    const segmentModal = safeGetElement('segmentModal');
    const repeatModal = safeGetElement('repeatModal');
    
    if (segmentModal) segmentModal.classList.add('hidden');
    if (repeatModal) repeatModal.classList.remove('hidden');
    renderRepeatSegments();
    currentEditingRepeatIndex = null;
    
    window.showToast('반복 세그먼트가 수정되었습니다.');
  } else {
    console.error('Invalid currentEditingRepeatIndex:', currentEditingRepeatIndex);
    window.showToast('저장 중 오류가 발생했습니다.');
  }
}

// ==========================================================
// 세그먼트 관리자 초기화
// ==========================================================

function initializeSegmentManager() {
  const btnAddSegment = safeGetElement('btnAddSegment');
  if (btnAddSegment) {
    btnAddSegment.addEventListener('click', showAddSegmentModal);
  }
  
  const segmentRamp = safeGetElement('segmentRamp');
  if (segmentRamp) {
    segmentRamp.addEventListener('change', toggleRampSettings);
  }
  
  const segmentModal = safeGetElement('segmentModal');
  if (segmentModal) {
    segmentModal.addEventListener('click', (e) => {
      if (e.target === segmentModal) {
        closeSegmentModal();
      }
    });
  }
  
  const repeatModal = safeGetElement('repeatModal');
  if (repeatModal) {
    repeatModal.addEventListener('click', (e) => {
      if (e.target === repeatModal) {
        closeRepeatModal();
      }
    });
  }
}

// ==========================================================
// 초기화 및 이벤트 바인딩
// ==========================================================

document.addEventListener('DOMContentLoaded', () => {
  initializeWorkoutManager();
  initializeSegmentManager();
  
  const btnOpenBuilder = safeGetElement('btnOpenBuilder');
  if (btnOpenBuilder) {
    btnOpenBuilder.addEventListener('click', () => showAddWorkoutForm(true));
  }
  
  const btnCancel = safeGetElement('btnCancelBuilder');
  if (btnCancel) {
    btnCancel.addEventListener('click', resetWorkoutFormMode);
  }
  
  const btnSave = safeGetElement('btnSaveWorkout');
  if (btnSave) {
    btnSave.addEventListener('click', saveWorkout);
  }
  
  // 검색 버튼 이벤트 리스너 추가
  const btnSearchWorkout = safeGetElement('btnSearchWorkout');
  if (btnSearchWorkout) {
    btnSearchWorkout.addEventListener('click', searchWorkouts);
  }
  
  // 검색 입력 필드에서 Enter 키 눌렀을 때 검색
  const qWorkout = safeGetElement('qWorkout');
  if (qWorkout) {
    qWorkout.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchWorkouts();
      }
    });
  }
});

// ==========================================================
// 전역 함수로 내보내기
// ==========================================================

// 워크아웃 관리
window.loadWorkouts = loadWorkouts;
window.searchWorkouts = searchWorkouts;
window.selectWorkout = selectWorkout;
window.editWorkout = editWorkout;
window.deleteWorkout = deleteWorkout;
window.saveWorkout = saveWorkout;
window.updateWorkoutPreview = updateWorkoutPreview;
window.showAddWorkoutForm = showAddWorkoutForm;
window.resetWorkoutFormMode = resetWorkoutFormMode;
window.performWorkoutUpdate = performWorkoutUpdate;

// 워크아웃 관련
window.getRoomsByWorkoutId = getRoomsByWorkoutId;

// 세그먼트 관리
window.addQuickSegment = addQuickSegment;
window.showAddSegmentModal = showAddSegmentModal;
window.showEditSegmentModal = showEditSegmentModal;
window.deleteSegment = deleteSegment;
window.saveSegment = saveSegment;
window.closeSegmentModal = closeSegmentModal;
window.deleteCurrentSegment = deleteCurrentSegment;
window.toggleRampSettings = toggleRampSettings;
window.updateTargetTypeFields = updateTargetTypeFields;
window.renderSegments = renderSegments;
window.updateSegmentSummary = updateSegmentSummary;
window.changeSegmentPage = changeSegmentPage;

// 반복 기능
window.showRepeatModal = showRepeatModal;
window.closeRepeatModal = closeRepeatModal;
window.addRepeatSegment = addRepeatSegment;
window.editRepeatSegment = editRepeatSegment;
window.removeRepeatSegment = removeRepeatSegment;
window.applyRepeat = applyRepeat;
window.saveRepeatSegment = saveRepeatSegment;

// 그룹화 기능
window.detectAndGroupSegments = detectAndGroupSegments;
window.updateSegmentPreviewGrouped = updateSegmentPreviewGrouped;
window.updateTrainingProgressGrouped = updateTrainingProgressGrouped;

// API 함수
window.apiCreateWorkoutWithSegments = apiCreateWorkoutWithSegments;
window.apiGetWorkouts = apiGetWorkouts;
window.apiGetWorkout = apiGetWorkout;
window.apiUpdateWorkout = apiUpdateWorkout;
window.apiDeleteWorkout = apiDeleteWorkout;

// 유틸리티 함수
window.escapeHtml = escapeHtml;
window.validateWorkoutData = validateWorkoutData;
window.normalizeWorkoutData = normalizeWorkoutData;
window.safeGetElement = safeGetElement;

console.log('완전 통합 워크아웃 매니저 (최종 버전) 로드 완료');


GAS_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbzF8br63uD3ziNxCFkp0UUSpP49zURthDsEVZ6o3uRu47pdS5uXE5S1oJ3d7AKHFouJ/exec"
