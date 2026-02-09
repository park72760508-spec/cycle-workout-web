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
  // status 처리: 원본 값을 그대로 유지 (null/undefined/빈 문자열만 기본값 '보이기' 사용)
  let status = '보이기';
  if (workout.status !== null && workout.status !== undefined && workout.status !== '') {
    const statusStr = String(workout.status).trim();
    // 공백이 아닌 경우 원본 값 유지 (TrainingSchedules의 title 값 등도 그대로 유지)
    if (statusStr !== '') {
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

// 개선된 JSONP 요청 함수 (60초 타임아웃) - groupTrainingManager의 jsonpRequest와 분리
function jsonpRequest(url, params = {}) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string') {
      reject(new Error('유효하지 않은 URL입니다.'));
      return;
    }
    // 고유 콜백명 (워크아웃매니저 전용 접두사로 다른 스크립트와 충돌 방지)
    const callbackName = 'wm_jsonp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
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
          // segments 데이터는 Base64로 인코딩하여 안전하게 전송 (URIError 방지)
          if (key === 'segments') {
            try {
              let base64Data;
              if (typeof TextEncoder !== 'undefined') {
                const bytes = new TextEncoder().encode(value);
                let binary = '';
                bytes.forEach(b => { binary += String.fromCharCode(b); });
                base64Data = btoa(binary);
              } else {
                base64Data = btoa(unescape(encodeURIComponent(value)));
              }
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
// workoutManager 전용 참조 (groupTrainingManager 로드 시 jsonpRequest 덮어쓰기 방지)
var wmJsonpRequest = jsonpRequest;

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
  } else if (targetType === 'ftp_pctz') {
    // ftp_pctz 타입: "56/75" 형식 (하한, 상한)
    const targetValue = segment.target_value;
    let minPercent = 60;
    let maxPercent = 75;
    
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim());
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
    
    targetDisplay = `${minPercent}% FTP, ${maxPercent}% FTP`;
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
    } else if (targetType === 'ftp_pctz') {
      // ftp_pctz 타입: "56, 75" 형식 (하한, 상한)
      const targetValue = segment.target_value;
      let minPercent = 60;
      let maxPercent = 75;
      
      if (typeof targetValue === 'string' && targetValue.includes(',')) {
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
      
      targetDisplay = `FTP ${minPercent}%, ${maxPercent}%`;
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
function drawSegmentGraph(segments, currentSegmentIndex = -1, canvasId = 'segmentPreviewGraph', elapsedTime = null) {
  if (!segments || segments.length === 0) return;
  
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  // 사용자 FTP 가져오기
  // 개인 대시보드의 경우 individual.js의 userFTP 변수 사용
  let ftp = 200;
  if (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'segmentPreviewGraph') {
    // individual.js에서 전역 변수로 설정된 userFTP 사용 (모바일 대시보드 및 훈련 준비 화면도 동일)
    ftp = Number(window.userFTP) || Number(window.mobileUserFTP) || Number(window.currentUser?.ftp) || 200;
  } else {
    ftp = Number(window.currentUser?.ftp) || 200;
  }
  
  // 총 시간 계산
  const totalSeconds = segments.reduce((sum, seg) => sum + (seg.duration_sec || 0), 0);
  if (totalSeconds <= 0) return;
  
  // 그래프 크기 설정 (개인 대시보드용으로 작은 크기)
  let graphHeight, graphWidth, padding;
  if (canvasId === 'segmentPreviewGraph') {
    // 훈련 준비 화면: 고정 크기로 일관된 그래프 블록 유지
    graphHeight = 200; // 고정 높이
    graphWidth = 600; // 고정 너비
    padding = { 
      top: 16, 
      right: 20, 
      bottom: 24, 
      left: 35 
    };
  } else if (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph') {
    // 개인 대시보드용: 컨테이너 높이에 맞춰 동적으로 설정 (모바일 대시보드도 동일)
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
    // trainingSegmentGraph 또는 selectedWorkoutSegmentGraphCanvas일 때는 오른쪽에 RPM Y축을 위한 여백 추가 (Indoor Training: 우측 Y축 표시)
    // individualSegmentGraph와 mobileIndividualSegmentGraph는 FTP 100% = 90 RPM 1:1 매칭이므로 오른쪽 Y축 없음
    if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
      padding = { top: 20, right: 60, bottom: 50, left: 70 }; // Indoor Training: 오른쪽 패딩 증가 (Y축 표시용)
    } else if (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'segmentPreviewGraph') {
      padding = { top: 20, right: 40, bottom: 50, left: 70 }; // 개인훈련 대시보드 및 훈련 준비 화면: 오른쪽 패딩 기본값
    } else {
      padding = { top: 20, right: 40, bottom: 50, left: 70 };
    }
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
  if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
    // 훈련 화면용 및 개인 대시보드용: 검정 투명 배경
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, graphWidth, graphHeight);
  } else if (canvasId === 'segmentPreviewGraph') {
    // 훈련 준비 화면용: 흰색 배경 (전체 배경과 통일)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, graphWidth, graphHeight);
  } else {
    // 기타: 부드러운 그라데이션 배경
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
  if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // 훈련 화면 및 개인 대시보드: 밝은 색상
  } else if (canvasId === 'segmentPreviewGraph') {
    ctx.strokeStyle = '#E5E7EB'; // 훈련 준비 화면: 아주 연한 회색 가이드선
  } else {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)'; // 기타: 어두운 색상
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
  // 훈련 준비 화면(segmentPreviewGraph)은 Y축 범위를 0 ~ 1.5 비율로 고정
  if (canvasId !== 'segmentPreviewGraph') {
    segments.forEach(seg => {
      const ftpPercent = getSegmentFtpPercentForPreview(seg);
      const targetPower = ftp * (ftpPercent / 100);
      if (targetPower > maxTargetPower) {
        maxTargetPower = targetPower * 1.1;
      }
    });
  }
  
  // 최대 RPM 계산 (세그먼트 중 최대값, 기본값 120)
  let maxRpm = 120;
  segments.forEach(seg => {
    const rpm = getSegmentRpmForPreview(seg);
    if (rpm > 0 && rpm > maxRpm) {
      maxRpm = Math.ceil(rpm / 10) * 10; // 10 단위로 올림
    }
  });
  // 최소 120, 최대 200으로 제한
  maxRpm = Math.max(120, Math.min(200, maxRpm));
  
  // 디버깅: RPM 값이 있는 세그먼트 확인
  if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas' || canvasId === 'segmentPreviewGraph') {
    console.log('[drawSegmentGraph] 전체 세그먼트 분석 시작:', {
      totalSegments: segments.length,
      canvasId
    });
    
    // 모든 세그먼트의 target_type 확인
    segments.forEach((seg, index) => {
      const targetType = seg.target_type || 'ftp_pct';
      const targetValue = seg.target_value;
      console.log(`[drawSegmentGraph] 세그먼트 ${index + 1}:`, {
        targetType,
        targetValue,
        type: typeof targetValue,
        segment: seg
      });
    });
    
    const rpmSegments = segments.filter(seg => {
      const targetType = seg.target_type || 'ftp_pct';
      return (targetType === 'dual' || targetType === 'cadence_rpm');
    });
    if (rpmSegments.length > 0) {
      console.log('[drawSegmentGraph] RPM 세그먼트 발견:', {
        count: rpmSegments.length,
        maxRpm,
        segments: rpmSegments.map((seg, idx) => {
          const originalIndex = segments.indexOf(seg);
          return {
            originalIndex: originalIndex + 1,
            targetType: seg.target_type,
            targetValue: seg.target_value,
            rpm: getSegmentRpmForPreview(seg),
            fullSegment: seg
          };
        })
      });
    }
    // RPM 세그먼트가 없는 것은 정상적인 경우이므로 경고 제거
    // (모든 워크아웃이 RPM 세그먼트를 포함할 필요는 없음)
  }
  
  // FTP 가이드 라인 (부드러운 색상)
  const ftpPower = ftp;
  const ftpY = padding.top + chartHeight - (chartHeight * (ftpPower / maxTargetPower));
  
  // FTP Y 위치를 전역 변수로 저장 (마스코트 위치 계산용)
  if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
    window._segmentGraphFtpY = ftpY;
    window._segmentGraphPadding = padding;
    window._segmentGraphChartWidth = chartWidth;
    window._segmentGraphTotalSeconds = totalSeconds;
  }
  // 모바일 대시보드용 전역 변수도 설정 (마스코트 위치 계산용)
  if (canvasId === 'mobileIndividualSegmentGraph') {
    window._segmentGraphFtpY = ftpY;
    window._segmentGraphPadding = padding;
    window._segmentGraphChartWidth = chartWidth;
    window._segmentGraphTotalSeconds = totalSeconds;
  }
  if (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph') {
    // 개인 대시보드 및 모바일 대시보드: 흰색 얇은 실선, 투명도 50%
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]); // 실선
  } else if (canvasId === 'segmentPreviewGraph') {
    // 훈련 준비 화면: 투명 주황색 점선, 두께 1
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.5)'; // 투명 주황색
    ctx.lineWidth = 1; // 두께 1
    ctx.setLineDash([4, 3]); // 점선 (4px 점, 3px 간격)
  } else if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
    // Indoor Training: 흰색 얇은 점선
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; // 흰색, 투명도 50%
    ctx.lineWidth = 1; // 얇은 선
    ctx.setLineDash([4, 3]); // 점선 (4px 점, 3px 간격)
  } else {
    ctx.shadowColor = 'rgba(234, 179, 8, 0.3)';
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.7)'; // 훈련 준비 화면
    ctx.shadowBlur = 4;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]); // 점선
  }
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.beginPath();
  ctx.moveTo(padding.left, ftpY);
  ctx.lineTo(padding.left + chartWidth, ftpY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowColor = 'transparent';
  
  // FTP 가이드 라인 오른쪽 끝에 "90" 빨강색 바탕 표시 (개인훈련 대시보드 및 Indoor Training, 훈련 준비 화면)
  if (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas' || canvasId === 'segmentPreviewGraph') {
    const rpm90Text = '90';
    ctx.font = 'bold 10px sans-serif';
    const textMetrics = ctx.measureText(rpm90Text);
    const textWidth = textMetrics.width;
    const textHeight = 12;
    const boxPadding = 4;
    const boxWidth = textWidth + boxPadding * 2;
    const boxHeight = textHeight + boxPadding * 2;
    
    // Indoor Training 화면: 점선 오른쪽 끝에 배치
    if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
      const boxX = padding.left + chartWidth - boxWidth - 2; // 오른쪽 끝에서 약간 여백
      const boxY = ftpY - boxHeight / 2; // 점선 중앙에 배치 (ftpY가 점선의 Y 위치)
      
      // 빨강색 바탕 둥근 상자 그리기
      ctx.fillStyle = 'rgba(239, 68, 68, 0.9)'; // 빨강색 바탕
      ctx.beginPath();
      const radius = 3;
      ctx.moveTo(boxX + radius, boxY);
      ctx.lineTo(boxX + boxWidth - radius, boxY);
      ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
      ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
      ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
      ctx.lineTo(boxX + radius, boxY + boxHeight);
      ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
      ctx.lineTo(boxX, boxY + radius);
      ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
      ctx.closePath();
      ctx.fill();
      
      // 흰색 텍스트 표시
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rpm90Text, boxX + boxWidth / 2, boxY + boxHeight / 2);
      ctx.textAlign = 'right'; // 원래 정렬 복원
      ctx.textBaseline = 'alphabetic'; // 원래 기준선 복원
    } else {
      // 개인훈련 대시보드: 기존 로직 유지
      const boxX = padding.left + chartWidth - boxWidth - 2;
      const boxY = ftpY - boxHeight / 2;
      
      // 빨강색 바탕 상자 그리기
      ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.beginPath();
      const radius = 3;
      ctx.moveTo(boxX + radius, boxY);
      ctx.lineTo(boxX + boxWidth - radius, boxY);
      ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
      ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
      ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
      ctx.lineTo(boxX + radius, boxY + boxHeight);
      ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
      ctx.lineTo(boxX, boxY + radius);
      ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
      ctx.closePath();
      ctx.fill();
      
      // 흰색 텍스트 표시
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rpm90Text, boxX + boxWidth / 2, boxY + boxHeight / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
    }
  }
  
  // FTP 라벨 (부드러운 배경)
  // trainingSegmentGraph일 때는 RPM 값도 함께 표시
  let labelText = `FTP ${ftp}W`;
  if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas' || canvasId === 'segmentPreviewGraph') {
    // 세그먼트 중 RPM 값이 있는 경우 기본 RPM 값 표시 (가장 많이 사용되는 값 또는 평균)
    const rpmValues = segments.map(seg => getSegmentRpmForPreview(seg)).filter(rpm => rpm > 0);
    if (rpmValues.length > 0) {
      // 가장 많이 사용되는 RPM 값 또는 평균값 사용
      const avgRpm = Math.round(rpmValues.reduce((sum, rpm) => sum + rpm, 0) / rpmValues.length);
      labelText = `FTP ${ftp}W RPM${avgRpm}`;
    }
  }
  const metrics = ctx.measureText(labelText);
  const labelWidth = metrics.width + 8;
  const labelHeight = 18;
  const labelX = padding.left - 10 - labelWidth;
  const labelY = ftpY - labelHeight / 2;
  
  if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas' || canvasId === 'segmentPreviewGraph') {
    // 훈련 화면 및 개인 대시보드: 밝은 배경과 텍스트
    if (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph') {
      // 개인훈련 대시보드 및 모바일 대시보드: 빨강색 네모 상자 제거, 텍스트만 표시
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // 흰색 텍스트 (배경 없음)
    } else if (canvasId === 'segmentPreviewGraph') {
      // 훈련 준비 화면: 진한 회색 텍스트
      ctx.fillStyle = '#374151'; // 진한 회색 텍스트
    } else {
      // 훈련 화면: 기존 노란색 바탕
      ctx.fillStyle = 'rgba(251, 191, 36, 0.3)';
      ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
      ctx.fillStyle = '#fbbf24'; // 밝은 노란색
    }
  } else {
    // 훈련 준비 화면
    ctx.fillStyle = 'rgba(251, 191, 36, 0.2)';
    ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
    ctx.fillStyle = '#f59e0b';
  }
  // 개인 대시보드용 폰트 크기 조정
  const ftpLabelFontSize = (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'segmentPreviewGraph') ? 'bold 8px sans-serif' : 'bold 12px sans-serif';
  ctx.font = ftpLabelFontSize;
  ctx.textAlign = 'right';
  // 개인훈련 대시보드 및 모바일 대시보드, 훈련 준비 화면에서는 FTP 라벨 텍스트 표시하지 않음
  if (canvasId !== 'individualSegmentGraph' && canvasId !== 'mobileIndividualSegmentGraph' && canvasId !== 'segmentPreviewGraph') {
    ctx.fillText(labelText, padding.left - 10, ftpY + 4);
  }
  
  // 세로축 눈금 (파워)
  if (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas' || canvasId === 'segmentPreviewGraph') {
    // 개인 대시보드 및 Indoor Training: 특정 FTP 백분율 값들 표시 (0, 0.3, 0.6, 0.9, 1.0, 1.2, 1.5)
    const ftpPercentValues = [0, 0.3, 0.6, 0.9, 1.0, 1.2, 1.5];
    
    ftpPercentValues.forEach(ftpRatio => {
      const power = ftp * ftpRatio;
      // maxTargetPower를 넘지 않는 경우만 표시
      if (power <= maxTargetPower) {
        const y = padding.top + chartHeight - (chartHeight * (power / maxTargetPower));
        
        // 격자선
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // 눈금 표시
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(padding.left - 5, y);
        ctx.lineTo(padding.left, y);
        ctx.stroke();
        
        // 라벨 표시
        if (ftpRatio === 1.0) {
          // FTP 값: 둥근 상자에 파워값만 표시 (바탕 민트, 폰트 검정)
          const powerText = Math.round(ftp).toString();
          const metrics = ctx.measureText(powerText);
          const boxWidth = metrics.width + 12;
          const boxHeight = 18;
          // Y축 오른쪽 바로 옆에 배치 (FTP 가이드 실선에 상자가 중앙에 걸치게)
          const boxX = padding.left + 10; // Y축 오른쪽 바로 옆
          const boxY = y - boxHeight / 2; // FTP 가이드 실선 중앙에 걸치게
          
          // 민트색 둥근 상자 그리기
          const borderRadius = 6;
          ctx.fillStyle = '#10b981'; // 민트색
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
          
          // 검정색 폰트로 파워값 표시
          ctx.fillStyle = '#000000'; // 검정색
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(powerText, boxX + boxWidth / 2, boxY + boxHeight / 2 + 3);
        } else {
          // 일반 라벨: 소수점 형식 (0, 0.3, 0.6, 0.9, 1.2, 1.5)
          // 훈련 준비 화면(segmentPreviewGraph)은 진한 회색, 그 외는 흰색
          if (canvasId === 'segmentPreviewGraph') {
            ctx.fillStyle = '#4B5563'; // 진한 회색
          } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          }
          ctx.font = '8px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(ftpRatio.toString(), padding.left - 10, y + 4);
        }
      }
    });
  } else {
    // 기존 로직 (다른 화면)
    const powerSteps = 5;
    for (let i = 0; i <= powerSteps; i++) {
      const power = (maxTargetPower * i) / powerSteps;
      const y = padding.top + chartHeight - (chartHeight * (power / maxTargetPower));
      
      // 격자선 (부드러운 색상)
      if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; // 훈련 화면: 밝은 색상
        ctx.setLineDash([2, 4]); // 점선
      } else if (canvasId === 'segmentPreviewGraph') {
        ctx.strokeStyle = '#D1D5DB'; // 훈련 준비 화면: 얇은 그레이 실선
        ctx.setLineDash([]); // 실선
      } else {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'; // 기타: 어두운 색상
        ctx.setLineDash([2, 4]); // 점선
      }
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 눈금 표시
      if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // 훈련 화면: 밝은 색상
      } else {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)'; // 훈련 준비 화면: 어두운 색상
      }
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padding.left - 5, y);
      ctx.lineTo(padding.left, y);
      ctx.stroke();
      
      // 파워 값 표시
      if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // 훈련 화면: 밝은 색상
      } else if (canvasId === 'segmentPreviewGraph') {
        ctx.fillStyle = '#374151'; // 훈련 준비 화면: 진한 회색
      } else {
        ctx.fillStyle = '#374151'; // 기타: 진한 회색
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
    
    // 디버깅: 각 세그먼트 정보 출력 (trainingSegmentGraph일 때만)
    if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
      console.log(`[drawSegmentGraph] 세그먼트 ${index + 1} 처리 시작:`, {
        index: index + 1,
        targetType: seg.target_type,
        targetValue: seg.target_value,
        duration,
        segment: seg
      });
    }
    
    // 세그먼트 타입 확인 (target_type)
    const targetType = seg.target_type || 'ftp_pct';
    
    // 세그먼트 타겟 파워 계산
    const ftpPercent = getSegmentFtpPercentForPreview(seg);
    const targetPower = ftp * (ftpPercent / 100);
    
    // 막대 위치 및 크기
    const x = padding.left + (currentTime / totalSeconds) * chartWidth;
    const barWidth = (duration / totalSeconds) * chartWidth;
    
    // 세그먼트별 막대 높이 계산
    let barHeight;
    let minPower = 0;
    let maxPower = 0;
    let isFtpPctz = false;
    
    if (targetType === 'cadence_rpm') {
      // cadence_rpm: 파워값이 없으므로 막대 높이는 0
      barHeight = 0;
    } else if (targetType === 'dual') {
      // dual: FTP % 값의 비율에 따라 막대 높이 적용
      barHeight = Math.max(2, (targetPower / maxTargetPower) * chartHeight);
    } else if (targetType === 'ftp_pct') {
      // ftp_pct: 오른쪽 Y축의 비율에 따라 높이 비율 적용
      barHeight = Math.max(2, (targetPower / maxTargetPower) * chartHeight);
    } else if (targetType === 'ftp_pctz') {
      // ftp_pctz: 하한과 상한을 구분하여 막대 높이 계산
      isFtpPctz = true;
      const targetValue = seg.target_value;
      let minPercent = 60;
      let maxPercent = 75;
      
      // 하한/상한 파싱
      if (typeof targetValue === 'string' && targetValue.includes('/')) {
        const parts = targetValue.split('/').map(s => s.trim());
        if (parts.length >= 2) {
          minPercent = Number(parts[0]) || 60;
          maxPercent = Number(parts[1]) || 75;
        } else {
          minPercent = Number(parts[0]) || 60;
          maxPercent = 75;
        }
      } else if (typeof targetValue === 'string' && targetValue.includes(',')) {
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
      
      // 하한값과 상한값 파워 계산
      minPower = ftp * (minPercent / 100);
      maxPower = ftp * (maxPercent / 100);
      
      // 상한값까지의 높이로 설정
      barHeight = Math.max(2, (maxPower / maxTargetPower) * chartHeight);
    } else {
      // 기타: 기본 로직
      barHeight = Math.max(2, (targetPower / maxTargetPower) * chartHeight);
    }
    
    let y = padding.top + chartHeight - barHeight;
    
    // 세그먼트 타입 확인 (segment_type)
    const segType = (seg.segment_type || '').toLowerCase();
    const isRest = segType === 'rest';
    const isWarmup = segType === 'warmup';
    const isCooldown = segType === 'cooldown';
    const isInterval = segType === 'interval';
    
    // cadence_rpm 타입일 때는 막대를 그리지 않음 (높이가 0)
    if (targetType !== 'cadence_rpm' && barHeight > 0) {
      // 색상 결정 (FTP 백분율 기준)
      // ftp_pctz 타입일 때는 하한값 기준으로 색상 결정
      const powerForColor = isFtpPctz ? minPower : targetPower;
      const ftpPercentValue = (powerForColor / ftp) * 100;
      let color;
      if (ftpPercentValue < 50) {
        // 휴식 (FTP 50% 미만): 흰색, 투명도 50%
        if (canvasId === 'segmentPreviewGraph') {
          color = 'rgba(229, 231, 235, 0.5)'; // #E5E7EB 기반, 투명도 50% (밝은 배경에 맞춤)
        } else {
          color = 'rgba(255, 255, 255, 0.5)';
        }
        // 휴식은 파워가 0이거나 매우 낮을 수 있으므로 최소 높이로 표시
        if (!isFtpPctz) {
          barHeight = Math.max(barHeight, 3);
          y = padding.top + chartHeight - barHeight;
        }
      } else if (ftpPercentValue < 60) {
        // 워밍업/쿨다운 (FTP 50% 이상 < 60%): 민트색, 투명도 80%
        if (canvasId === 'segmentPreviewGraph') {
          color = 'rgba(5, 150, 105, 0.8)'; // #059669 기반, 투명도 80%
        } else {
          color = 'rgba(16, 185, 129, 0.8)';
        }
      } else if (powerForColor >= ftp) {
        // 고강도 인터벌 (FTP 100% 이상): 민트색, 투명도 20%
        if (canvasId === 'segmentPreviewGraph') {
          color = 'rgba(5, 150, 105, 0.2)'; // #059669 기반, 투명도 20%
        } else {
          color = 'rgba(16, 185, 129, 0.2)';
        }
      } else if (powerForColor >= ftp * 0.8) {
        // 인터벌 (FTP 80% 이상 ~ <100%): 민트색, 투명도 40%
        if (canvasId === 'segmentPreviewGraph') {
          color = 'rgba(5, 150, 105, 0.4)'; // #059669 기반, 투명도 40%
        } else {
          color = 'rgba(16, 185, 129, 0.4)';
        }
      } else if (ftpPercentValue >= 60) {
        // 저강도 인터벌 (FTP 60% 이상 < 80%): 민트색, 투명도 60%
        if (canvasId === 'segmentPreviewGraph') {
          color = 'rgba(5, 150, 105, 0.6)'; // #059669 기반, 투명도 60%
        } else {
          color = 'rgba(16, 185, 129, 0.6)';
        }
      } else {
        // 기본: 민트색, 투명도 60%
        if (canvasId === 'segmentPreviewGraph') {
          color = 'rgba(5, 150, 105, 0.6)'; // #059669 기반, 투명도 60%
        } else {
          color = 'rgba(16, 185, 129, 0.6)';
        }
      }
      
      // ftp_pctz 타입일 때는 하한과 상한을 구분하여 그리기
      if (isFtpPctz && minPower > 0 && maxPower > minPower) {
        // 하한값까지의 높이 계산
        const minBarHeight = Math.max(2, (minPower / maxTargetPower) * chartHeight);
        const minY = padding.top + chartHeight - minBarHeight;
        
        // 하한~상한 구간의 높이 계산
        const maxBarHeight = barHeight;
        const maxY = padding.top + chartHeight - maxBarHeight;
        const zoneHeight = maxBarHeight - minBarHeight;
        
        // 하한값까지 막대 그리기 (기존 색상 로직)
        const baseColor = color.replace('rgba(', '').replace(')', '').split(',');
        let r = parseInt(baseColor[0]);
        let g = parseInt(baseColor[1]);
        let b = parseInt(baseColor[2]);
        const a = parseFloat(baseColor[3]);
        
        // segmentPreviewGraph일 때는 #059669 기반 색상 사용 (하한 구간)
        if (canvasId === 'segmentPreviewGraph' && !color.includes('229, 231, 235')) {
          // 휴식 구간이 아닌 경우에만 #059669 적용
          r = 5;
          g = 150;
          b = 105;
        }
        
        const minBarGradient = ctx.createLinearGradient(x, minY, x, minY + minBarHeight);
        minBarGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${a})`);
        minBarGradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${a * 0.7})`);
        
        ctx.fillStyle = minBarGradient;
        
        const radius = Math.min(4, barWidth / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, minY);
        ctx.lineTo(x + barWidth - radius, minY);
        ctx.quadraticCurveTo(x + barWidth, minY, x + barWidth, minY + radius);
        ctx.lineTo(x + barWidth, minY + minBarHeight);
        ctx.lineTo(x, minY + minBarHeight);
        ctx.lineTo(x, minY + radius);
        ctx.quadraticCurveTo(x, minY, x + radius, minY);
        ctx.closePath();
        ctx.fill();
        
        // 하한~상한 구간 막대 그리기 (같은 색상톤에 투명도 적용)
        const zoneAlpha = a * 0.3; // 기존 투명도의 30%로 설정
        // segmentPreviewGraph일 때는 #059669 기반 색상 사용
        let zoneR = r, zoneG = g, zoneB = b;
        if (canvasId === 'segmentPreviewGraph') {
          zoneR = 5;
          zoneG = 150;
          zoneB = 105;
        }
        const zoneBarGradient = ctx.createLinearGradient(x, maxY, x, maxY + zoneHeight);
        zoneBarGradient.addColorStop(0, `rgba(${zoneR}, ${zoneG}, ${zoneB}, ${zoneAlpha})`);
        zoneBarGradient.addColorStop(1, `rgba(${zoneR}, ${zoneG}, ${zoneB}, ${zoneAlpha * 0.7})`);
        
        ctx.fillStyle = zoneBarGradient;
        
        ctx.beginPath();
        ctx.moveTo(x, maxY + zoneHeight);
        ctx.lineTo(x + barWidth, maxY + zoneHeight);
        ctx.lineTo(x + barWidth, maxY);
        ctx.lineTo(x, maxY);
        ctx.closePath();
        ctx.fill();
      } else {
        // 기존 로직: 일반 막대 그리기 (부드러운 그라데이션)
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
      }
      
      // 막대 테두리 (부드러운 색상)
      ctx.shadowColor = 'transparent';
      
      // 현재 진행 중인 세그먼트인지 확인
      const isCurrentSegment = (currentSegmentIndex >= 0 && index === currentSegmentIndex);
      
      // ftp_pctz 타입일 때는 하한과 상한 구간 모두에 테두리 그리기
      if (isFtpPctz && minPower > 0 && maxPower > minPower) {
        const minBarHeight = Math.max(2, (minPower / maxTargetPower) * chartHeight);
        const minY = padding.top + chartHeight - minBarHeight;
        const maxBarHeight = barHeight;
        const maxY = padding.top + chartHeight - maxBarHeight;
        const zoneHeight = maxBarHeight - minBarHeight;
        const baseColor = color.replace('rgba(', '').replace(')', '').split(',');
        const r = parseInt(baseColor[0]);
        const g = parseInt(baseColor[1]);
        const b = parseInt(baseColor[2]);
        const a = parseFloat(baseColor[3]);
        const radius = Math.min(4, barWidth / 2);
        
        if (isCurrentSegment) {
          // 현재 세그먼트: 흰색 네온 애니메이션 효과
          const animationPhase = (Date.now() / 1000) % 2; // 2초 주기
          const neonIntensity = 0.5 + 0.5 * Math.sin(animationPhase * Math.PI);
          const whiteColor = `rgba(255, 255, 255, ${0.6 + 0.4 * neonIntensity})`;
          
          // 하한 막대 네온 효과
          ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
          ctx.shadowBlur = 10 * neonIntensity;
          ctx.strokeStyle = whiteColor;
          ctx.lineWidth = 3;
          
          ctx.beginPath();
          ctx.moveTo(x + radius, minY);
          ctx.lineTo(x + barWidth - radius, minY);
          ctx.quadraticCurveTo(x + barWidth, minY, x + barWidth, minY + radius);
          ctx.lineTo(x + barWidth, minY + minBarHeight);
          ctx.lineTo(x, minY + minBarHeight);
          ctx.lineTo(x, minY + radius);
          ctx.quadraticCurveTo(x, minY, x + radius, minY);
          ctx.closePath();
          ctx.stroke();
          
          // 상한 구간 네온 효과
          ctx.beginPath();
          ctx.moveTo(x, maxY + zoneHeight);
          ctx.lineTo(x + barWidth, maxY + zoneHeight);
          ctx.lineTo(x + barWidth, maxY);
          ctx.lineTo(x, maxY);
          ctx.closePath();
          ctx.stroke();
          
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        } else {
          // 일반 세그먼트: 기본 테두리
          // 하한 막대 테두리
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a * 0.3})`;
          ctx.lineWidth = 1;
          
          ctx.beginPath();
          ctx.moveTo(x + radius, minY);
          ctx.lineTo(x + barWidth - radius, minY);
          ctx.quadraticCurveTo(x + barWidth, minY, x + barWidth, minY + radius);
          ctx.lineTo(x + barWidth, minY + minBarHeight);
          ctx.lineTo(x, minY + minBarHeight);
          ctx.lineTo(x, minY + radius);
          ctx.quadraticCurveTo(x, minY, x + radius, minY);
          ctx.closePath();
          ctx.stroke();
          
          // 상한 구간 테두리
          ctx.beginPath();
          ctx.moveTo(x, maxY + zoneHeight);
          ctx.lineTo(x + barWidth, maxY + zoneHeight);
          ctx.lineTo(x + barWidth, maxY);
          ctx.lineTo(x, maxY);
          ctx.closePath();
          ctx.stroke();
        }
      } else {
        // 기존 로직: 일반 막대 테두리
        const baseColor = color.replace('rgba(', '').replace(')', '').split(',');
        const r = parseInt(baseColor[0]);
        const g = parseInt(baseColor[1]);
        const b = parseInt(baseColor[2]);
        const a = parseFloat(baseColor[3]);
        const radius = Math.min(4, barWidth / 2);
        
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
      }
    }
    
    // 세그먼트 라벨 제거 (가로축에는 시간 표시만 남김)
    
    // dual 또는 cadence_rpm 타입일 때 RPM 점선 표시
    
    // 디버깅: 모든 세그먼트의 targetType 확인
    if (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas' || canvasId === 'segmentPreviewGraph') {
      console.log(`[drawSegmentGraph] 세그먼트 ${index + 1} targetType 확인:`, {
        index: index + 1,
        targetType,
        isDual: targetType === 'dual',
        isCadenceRpm: targetType === 'cadence_rpm',
        condition: (targetType === 'dual' || targetType === 'cadence_rpm') && (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas'),
        canvasId
      });
    }
    
    if ((targetType === 'dual' || targetType === 'cadence_rpm') && (canvasId === 'trainingSegmentGraph' || canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas' || canvasId === 'segmentPreviewGraph')) {
      console.log(`[drawSegmentGraph] 세그먼트 ${index + 1} RPM 점선 그리기 시작:`, {
        index: index + 1,
        targetType,
        targetValue: seg.target_value
      });
      
      const targetRpm = getSegmentRpmForPreview(seg);
      
      // 디버깅: dual 타입일 때 로그 출력
      if (targetType === 'dual') {
        const ftpPercent = getSegmentFtpPercentForPreview(seg);
        console.log(`[drawSegmentGraph] 세그먼트 ${index + 1} dual 세그먼트:`, {
          index: index + 1,
          targetType,
          targetValue: seg.target_value,
          extractedFtpPercent: ftpPercent,
          extractedRpm: targetRpm,
          maxRpm,
          canvasId,
          willDraw: targetRpm > 0 && maxRpm > 0
        });
      } else if (targetType === 'cadence_rpm') {
        console.log(`[drawSegmentGraph] 세그먼트 ${index + 1} cadence_rpm 세그먼트:`, {
          index: index + 1,
          targetType,
          targetValue: seg.target_value,
          extractedRpm: targetRpm,
          maxRpm,
          canvasId,
          willDraw: targetRpm > 0 && maxRpm > 0
        });
      }
      
      // Indoor Training 및 개인훈련 대시보드, 훈련 준비 화면: 스케일링 공식 사용하므로 maxRpm 불필요
      // 기타 화면: maxRpm 필요
      const shouldDrawRpm = (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas' || canvasId === 'segmentPreviewGraph') 
        ? targetRpm > 0 
        : (targetRpm > 0 && maxRpm > 0);
      
      if (shouldDrawRpm) {
        console.log(`[drawSegmentGraph] 세그먼트 ${index + 1} RPM 점선 그리기 실행:`, {
          index: index + 1,
          targetRpm,
          maxRpm,
          canvasId,
          x,
          barWidth
        });
        // RPM 값에 해당하는 Y 위치 계산
        // 개인훈련 대시보드 및 모바일 대시보드, Indoor Training, 훈련 준비 화면: FTP 100% = 90 RPM 1:1 매칭 스케일링 공식 적용
        let rpmY;
        if (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas' || canvasId === 'segmentPreviewGraph') {
          // RPM_scaled = (RPM_real / 90) * 100
          // 기준값 90을 기준으로 위 아래에 바로 표시
          // 예: 110 RPM → FTP 122% 높이 (110/90*100 = 122.2%)
          // 예: 60 RPM → FTP 66% 높이 (60/90*100 = 66.7%)
          const rpmScaled = (targetRpm / 90) * 100; // FTP %로 변환
          const rpmFtpPercent = Math.min(200, Math.max(0, rpmScaled)); // 최대 200%로 제한
          // FTP %를 Y 위치로 변환 (maxTargetPower 기준)
          const rpmPower = ftp * (rpmFtpPercent / 100);
          rpmY = padding.top + chartHeight - (chartHeight * (rpmPower / maxTargetPower));
          
          console.log(`[drawSegmentGraph] RPM 스케일링 적용 (${canvasId}):`, {
            targetRpm,
            rpmScaled,
            rpmFtpPercent: `${rpmFtpPercent.toFixed(1)}%`,
            rpmPower: `${rpmPower.toFixed(0)}W`,
            ftp,
            maxTargetPower
          });
        } else {
          // 기타 화면: 기존 로직 유지
          rpmY = padding.top + chartHeight - (chartHeight * (targetRpm / maxRpm));
        }
        
        // 빨강색 실선 그리기 (세그먼트 막대 넓이만큼)
        ctx.strokeStyle = '#FF4D4D'; // 밝은 레드
        ctx.lineWidth = 2; // 선명한 두께
        ctx.setLineDash([]); // 실선 (점선 해제)
        ctx.beginPath();
        ctx.moveTo(x, rpmY);
        ctx.lineTo(x + barWidth, rpmY);
        ctx.stroke();
        
        // RPM 값 라벨 표시 (세그먼트 막대 중앙 상단)
        ctx.fillStyle = '#FF3B30'; // 숫자 색상
        ctx.font = 'bold 10px sans-serif'; // Medium 이상 두께
        ctx.textAlign = 'center';
        const labelY = rpmY - 5; // 점선 위에 표시
        ctx.fillText(`${Math.round(targetRpm)}`, x + barWidth / 2, labelY);
      } else if (targetType === 'dual' && targetRpm === 0) {
        console.warn('[drawSegmentGraph] dual 세그먼트에서 RPM 값 추출 실패:', {
          targetValue: seg.target_value,
          targetType: seg.target_type,
          seg
        });
      } else if (targetType === 'cadence_rpm' && targetRpm === 0) {
        console.warn('[drawSegmentGraph] cadence_rpm 세그먼트에서 RPM 값 추출 실패:', seg);
      }
    }
    
    currentTime += duration;
  });
  
  // 가로축 시간 표시 (개인 대시보드 및 모바일 대시보드, 훈련 준비 화면은 제거)
  if (canvasId !== 'individualSegmentGraph' && canvasId !== 'mobileIndividualSegmentGraph' && canvasId !== 'segmentPreviewGraph') {
    const timeSteps = Math.min(10, Math.max(5, Math.floor(totalSeconds / 60))); // 1분 단위 또는 최대 10개
    for (let i = 0; i <= timeSteps; i++) {
      const time = (totalSeconds * i) / timeSteps;
      const x = padding.left + (time / totalSeconds) * chartWidth;
      
      // 눈금선
      if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; // 훈련 화면: 밝은 색상
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
      const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
        // Indoor Training 화면: 민트색 둥근 박스에 검정색 텍스트
        const timeFontSize = 10;
        ctx.font = `bold ${timeFontSize}px sans-serif`;
        const textMetrics = ctx.measureText(timeText);
        const textWidth = textMetrics.width;
        const boxPadding = 6;
        const boxHeight = 20;
        const boxWidth = textWidth + boxPadding * 2;
        const boxX = x - boxWidth / 2;
        const boxY = padding.top + chartHeight + 10;
        const borderRadius = 4;
        
        // 민트색 둥근 박스 그리기
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
        
        // 검정색 텍스트 표시
        ctx.fillStyle = '#000000'; // 검정색 텍스트 (시인성 향상)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(timeText, x, boxY + boxHeight / 2);
      } else if (canvasId === 'segmentPreviewGraph') {
        // 훈련 준비 화면: 진한 회색 텍스트
        ctx.fillStyle = '#374151'; // 진한 회색
        const timeFontSize = '10px sans-serif';
        const timeLabelY = padding.top + chartHeight + 18;
        ctx.font = timeFontSize;
        ctx.textAlign = 'center';
        ctx.fillText(timeText, x, timeLabelY);
      } else {
        // 기타: 기존 스타일 유지
        ctx.fillStyle = '#6b7280'; // 어두운 색상
        const timeFontSize = '10px sans-serif';
        const timeLabelY = padding.top + chartHeight + 18;
        ctx.font = timeFontSize;
        ctx.textAlign = 'center';
        ctx.fillText(timeText, x, timeLabelY);
      }
    }
  }
  
  // 개인 대시보드 및 모바일 대시보드, Bluetooth Coach 대시보드 마스코트 그리기
  if (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'bluetoothCoachSegmentGraphCanvas') {
    // 경과시간 가져오기 (함수 파라미터 또는 전역 변수)
    let currentElapsedTime = 0;
    if (canvasId === 'bluetoothCoachSegmentGraphCanvas') {
      // Bluetooth Coach의 경우 bluetoothCoachState에서 경과시간 가져오기
      currentElapsedTime = (window.bluetoothCoachState && window.bluetoothCoachState.totalElapsedTime) ? window.bluetoothCoachState.totalElapsedTime : 0;
    } else if (canvasId === 'mobileIndividualSegmentGraph') {
      // 모바일 대시보드의 경우 mobileTrainingState에서 경과시간 가져오기 (우선순위: 함수 파라미터 > mobileTrainingState > 전역 변수)
      if (elapsedTime !== null && elapsedTime !== undefined) {
        currentElapsedTime = elapsedTime;
      } else if (window.mobileTrainingState && window.mobileTrainingState.elapsedSec !== undefined) {
        currentElapsedTime = window.mobileTrainingState.elapsedSec;
      } else {
        currentElapsedTime = window.lastElapsedTime || 0;
      }
    } else {
      // 개인 대시보드의 경우 함수 파라미터 또는 전역 변수 사용
      currentElapsedTime = (elapsedTime !== null && elapsedTime !== undefined) ? elapsedTime : (window.lastElapsedTime || 0);
    }
    
    // 경과시간/총시간 비율 계산
    const progressRatio = totalSeconds > 0 ? Math.min(1, Math.max(0, currentElapsedTime / totalSeconds)) : 0;
    
    // 마스코트 X 위치 계산 (X축 라인 중앙)
    const mascotX = padding.left + (progressRatio * chartWidth);
    const mascotY = padding.top + chartHeight; // X축 라인 Y 위치
    
    // 마스코트 크기 (X축 폰트 크기의 2배에서 50% 축소)
    const timeFontSize = 8; // individualSegmentGraph의 timeFontSize
    const mascotSize = timeFontSize * 2 * 0.5; // 8px (50% 축소)
    const mascotRadius = mascotSize / 2;
    
    // 펄스 애니메이션 효과 (원 테두리에서 퍼져나가는 효과)
    const currentTime = Date.now() / 1000;
    const pulseDuration = 1.5; // 펄스 한 사이클 시간 (초)
    const pulsePhase = currentTime % pulseDuration;
    const normalizedPhase = pulsePhase / pulseDuration; // 0 ~ 1
    
    // 마스코트 그리기
    ctx.save();
    
    // 원 테두리에서 퍼져나가는 흰색 펄스 효과 (여러 개의 원)
    const pulseCount = 3; // 동시에 표시될 펄스 원의 개수
    for (let i = 0; i < pulseCount; i++) {
      const pulseOffset = (i / pulseCount) * pulseDuration;
      const pulseTime = (pulsePhase + pulseOffset) % pulseDuration;
      const pulseNormalized = pulseTime / pulseDuration;
      
      // 펄스가 퍼져나가는 크기 (원 테두리에서 시작하여 점점 커짐)
      const pulseRadius = mascotRadius + (pulseNormalized * mascotRadius * 2); // 원 테두리에서 3배까지 확장
      
      // 펄스 투명도 (시작할 때는 불투명, 끝날 때는 투명)
      const pulseAlpha = 1 - pulseNormalized;
      
      // 흰색 펄스 원 그리기
      ctx.beginPath();
      ctx.arc(mascotX, mascotY, pulseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${pulseAlpha * 0.8})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    
    // 메인 빨간색 원
    ctx.beginPath();
    ctx.arc(mascotX, mascotY, mascotRadius * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444'; // 빨간색
    ctx.fill();
    
    ctx.restore();
  }
  
  // 축 라벨 (개인 대시보드 및 모바일 대시보드, 훈련 준비 화면은 제거)
  if (canvasId !== 'individualSegmentGraph' && canvasId !== 'mobileIndividualSegmentGraph' && canvasId !== 'segmentPreviewGraph') {
    // 개인 대시보드가 아닌 경우에만 축 라벨 표시
    if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // 훈련 화면: 밝은 색상
    } else {
      ctx.fillStyle = '#374151'; // 훈련 준비 화면: 어두운 색상
    }
    const axisLabelFontSize = 'bold 12px sans-serif';
    const axisLabelY = graphHeight - 10;
    ctx.font = axisLabelFontSize;
    ctx.textAlign = 'center';
    ctx.fillText('시간 (분:초)', padding.left + chartWidth / 2, axisLabelY);
    
    // 세로축 라벨 (파워 - 왼쪽)
    const verticalLabelFontSize = 'bold 12px sans-serif';
    ctx.font = verticalLabelFontSize;
    ctx.save();
    ctx.translate(15, padding.top + chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('파워 (W)', 0, 0);
    ctx.restore();
    
    // 세로축 라벨 (RPM - 오른쪽, trainingSegmentGraph 또는 selectedWorkoutSegmentGraphCanvas일 때만 표시)
    // Indoor Training은 우측 Y축을 유지하면서 케이던스 기준값(90 RPM)을 표시
    // 개인훈련 대시보드(individualSegmentGraph)는 FTP 100% = 90 RPM 1:1 매칭이므로 오른쪽 Y축 없음
    if (canvasId === 'trainingSegmentGraph' || canvasId === 'selectedWorkoutSegmentGraphCanvas') {
      // 오른쪽 Y축 그리기
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padding.left + chartWidth, padding.top);
      ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
      ctx.stroke();
      
      ctx.font = verticalLabelFontSize;
      ctx.save();
      ctx.translate(padding.left + chartWidth + 15, padding.top + chartHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('RPM', 0, 0);
      ctx.restore();
      
      // 세그먼트에서 사용되는 RPM 값들 추출 (케이던스 기준값 90 RPM 강조 표시용)
      const segmentRpmValues = segments.map(seg => getSegmentRpmForPreview(seg)).filter(rpm => rpm > 0);
      // 개인 훈련 대시보드 로직: 90 RPM을 기준값으로 강조 표시 (FTP 100% = 90 RPM 1:1 매칭)
      const targetRpmForHighlight = 90; // 항상 90 RPM을 기준값으로 표시
      
      // 오른쪽 Y축 눈금 (RPM) - FTP 100% = 90 RPM 1:1 매칭 기준으로 표시
      // FTP %를 RPM으로 변환: RPM = (FTP% / 100) * 90
      const ftpPercentValues = [0, 0.3, 0.6, 0.9, 1.0, 1.2, 1.5]; // 개인 훈련 대시보드와 동일한 FTP 백분율
      
      ftpPercentValues.forEach(ftpRatio => {
        // FTP %를 RPM으로 변환 (90 RPM = FTP 100%)
        const rpm = ftpRatio * 90;
        const roundedRpm = Math.round(rpm);
        
        // RPM을 Y 위치로 변환 (FTP % 기반으로 계산)
        const rpmFtpPercent = (rpm / 90) * 100; // RPM을 FTP %로 변환
        const rpmPower = ftp * (rpmFtpPercent / 100); // FTP %를 파워로 변환
        const y = padding.top + chartHeight - (chartHeight * (rpmPower / maxTargetPower));
        
        // 90 RPM(ftpRatio === 1.0)인 경우 빨강색으로 강조 표시
        const isTargetRpm = Math.abs(roundedRpm - targetRpmForHighlight) < 1; // 90 RPM인 경우
        
        if (isTargetRpm) {
          // 빨강색 실선 (케이던스 기준값 90 RPM 강조)
          ctx.strokeStyle = '#ef4444'; // 빨강색
          ctx.lineWidth = 2;
          ctx.setLineDash([]); // 실선
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(padding.left + chartWidth, y);
          ctx.stroke();
          
          // 오른쪽 눈금 표시 (빨강색)
          ctx.strokeStyle = '#ef4444'; // 빨강색
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(padding.left + chartWidth, y);
          ctx.lineTo(padding.left + chartWidth + 5, y);
          ctx.stroke();
          
          // RPM 값 표시 (빨강색, 굵게)
          ctx.fillStyle = '#ef4444'; // 빨강색
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(roundedRpm.toString(), padding.left + chartWidth + 10, y + 4);
        } else {
          // 일반 격자선 (점선) - FTP 기준선과 일치하도록
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(padding.left + chartWidth, y);
          ctx.stroke();
          ctx.setLineDash([]);
          
          // 오른쪽 눈금 표시
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(padding.left + chartWidth, y);
          ctx.lineTo(padding.left + chartWidth + 5, y);
          ctx.stroke();
          
          // RPM 값 표시 (오른쪽)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(roundedRpm.toString(), padding.left + chartWidth + 10, y + 4);
        }
      });
    }
  }
  
  // 개인 대시보드 및 모바일 대시보드, 훈련 준비 화면: Y축 120%와 150% 중간 위치에 민트색 둥근네모 상자에 워크아웃 총시간 표기
  if (canvasId === 'individualSegmentGraph' || canvasId === 'mobileIndividualSegmentGraph' || canvasId === 'segmentPreviewGraph') {
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
    
    // 위아래 여백 30% 감소
    const currentVerticalPadding = (boxHeight - fontSize) / 2; // 현재 위아래 여백
    const newVerticalPadding = currentVerticalPadding * 0.7; // 30% 감소
    const adjustedBoxHeight = fontSize + (newVerticalPadding * 2); // 조정된 상자 높이
    
    // 텍스트 크기 측정
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textMetrics = ctx.measureText(totalTimeText);
    const textWidth = textMetrics.width;
    const boxWidth = textWidth + boxPadding * 2;
    const boxX = padding.left + chartWidth / 2 - boxWidth / 2; // 그래프 중간
    const boxY = targetY - adjustedBoxHeight / 2; // Y축 135% 위치 (120%와 150% 중간)
    
    // 민트색 둥근네모 상자 그리기
    const borderRadius = Math.round(6 * 1.3); // 30% 증가: 7.8px → 8px
    ctx.fillStyle = 'rgba(0, 212, 170, 0.9)'; // 민트색 (#00d4aa)
    ctx.beginPath();
    ctx.moveTo(boxX + borderRadius, boxY);
    ctx.lineTo(boxX + boxWidth - borderRadius, boxY);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + borderRadius);
    ctx.lineTo(boxX + boxWidth, boxY + adjustedBoxHeight - borderRadius);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY + adjustedBoxHeight, boxX + boxWidth - borderRadius, boxY + adjustedBoxHeight);
    ctx.lineTo(boxX + borderRadius, boxY + adjustedBoxHeight);
    ctx.quadraticCurveTo(boxX, boxY + adjustedBoxHeight, boxX, boxY + adjustedBoxHeight - borderRadius);
    ctx.lineTo(boxX, boxY + borderRadius);
    ctx.quadraticCurveTo(boxX, boxY, boxX + borderRadius, boxY);
    ctx.closePath();
    ctx.fill();
    
    // 텍스트 표시
    ctx.fillStyle = '#000'; // 검정색 텍스트
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
    // dual 타입: target_value는 "85/100" 형식 (앞값: ftp%, 뒤값: rpm) 또는 배열 [ftp%, rpm]
    const targetValue = seg.target_value;
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim()).filter(s => s.length > 0);
      if (parts.length >= 2) {
        const ftpPercent = Number(parts[0]);
        if (!isNaN(ftpPercent) && ftpPercent > 0) {
          return ftpPercent;
        }
      } else if (parts.length === 1) {
        // 슬래시는 있지만 값이 하나만 있는 경우
        const ftpPercent = Number(parts[0]);
        if (!isNaN(ftpPercent) && ftpPercent > 0) {
          return ftpPercent;
        }
      }
      console.warn('[getSegmentFtpPercentForPreview] dual 타입에서 FTP % 추출 실패:', {
        targetValue,
        parts
      });
      return 100;
    } else if (Array.isArray(targetValue) && targetValue.length > 0) {
      const ftpPercent = Number(targetValue[0]);
      if (!isNaN(ftpPercent) && ftpPercent > 0) {
        return ftpPercent;
      }
      return 100;
    } else {
      // 숫자로 저장된 경우 (예: 85100 → 85/100)
      const numValue = Number(targetValue);
      if (numValue > 1000 && numValue < 1000000) {
        const str = String(numValue);
        if (str.length >= 4) {
          // 앞부분을 FTP%로 추정 (예: 85100 → 85/100)
          const ftpPart = str.slice(0, -3);
          const ftpPercent = Number(ftpPart);
          if (!isNaN(ftpPercent) && ftpPercent > 0) {
            return ftpPercent;
          }
        }
      }
      // 1000 이하인 경우 FTP%로 간주
      if (numValue > 0 && numValue <= 1000) {
        return numValue;
      }
      console.warn('[getSegmentFtpPercentForPreview] dual 타입에서 FTP % 추출 실패 (숫자 형식):', {
        targetValue,
        numValue,
        type: typeof targetValue
      });
      return 100;
    }
  } else if (targetType === 'cadence_rpm') {
    // cadence_rpm 타입: 파워값이 없으므로 막대 높이는 0
    // RPM 값은 별도로 표시되므로 FTP %는 0 반환
    return 0;
  } else if (targetType === 'ftp_pctz') {
    // ftp_pctz 타입: "56/75" 형식 (하한, 상한) - 평균값 사용
    const targetValue = seg.target_value;
    let minPercent = 60;
    let maxPercent = 75;
    
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim());
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
    
    // 평균값 반환 (막대 높이 계산용)
    return (minPercent + maxPercent) / 2;
  }
  
  return 100;
}

/**
 * 세그먼트에서 RPM 값 추출
 * @param {Object} seg - 세그먼트 객체
 * @returns {number} RPM 값 (없으면 0)
 */
function getSegmentRpmForPreview(seg) {
  if (!seg) {
    console.warn('[getSegmentRpmForPreview] 세그먼트가 없습니다');
    return 0;
  }
  
  const targetType = seg.target_type || 'ftp_pct';
  const targetValue = seg.target_value;
  
  console.log('[getSegmentRpmForPreview] 호출:', {
    targetType,
    targetValue,
    type: typeof targetValue,
    fullSegment: seg
  });
  
  if (targetType === 'cadence_rpm') {
    // cadence_rpm 타입: target_value가 RPM 값
    const rpm = Number(targetValue);
    console.log('[getSegmentRpmForPreview] cadence_rpm 처리:', {
      targetValue,
      parsed: rpm,
      isNaN: isNaN(rpm),
      result: isNaN(rpm) ? 0 : rpm
    });
    // 디버깅: cadence_rpm 타입일 때 로그 출력
    if (isNaN(rpm) || rpm <= 0) {
      console.warn('[getSegmentRpmForPreview] cadence_rpm 타입에서 RPM 값 추출 실패:', {
        targetType,
        targetValue,
        type: typeof targetValue,
        parsed: rpm
      });
      return 0;
    }
    return rpm;
  } else if (targetType === 'dual') {
    // dual 타입: target_value는 "85/100" 형식 (앞값: ftp%, 뒤값: rpm) 또는 배열 [ftp%, rpm]
    console.log('[getSegmentRpmForPreview] dual 타입 처리 시작:', {
      targetValue,
      type: typeof targetValue,
      isString: typeof targetValue === 'string',
      includesSlash: typeof targetValue === 'string' && targetValue.includes('/')
    });
    
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim()).filter(s => s.length > 0);
      console.log('[getSegmentRpmForPreview] dual 문자열 분리:', {
        original: targetValue,
        parts,
        partsLength: parts.length
      });
      
      if (parts.length >= 2) {
        const rpm = Number(parts[1]);
        console.log('[getSegmentRpmForPreview] dual RPM 추출:', {
          parts,
          rpmPart: parts[1],
          parsed: rpm,
          isValid: !isNaN(rpm) && rpm > 0
        });
        if (!isNaN(rpm) && rpm > 0) {
          return rpm;
        }
      }
      // 슬래시는 있지만 값이 하나만 있는 경우
      console.warn('[getSegmentRpmForPreview] dual 타입에서 RPM 값 추출 실패:', {
        targetValue,
        parts,
        extracted: parts.length >= 2 ? Number(parts[1]) : null
      });
      return 0;
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      const rpm = Number(targetValue[1]);
      if (!isNaN(rpm) && rpm > 0) {
        return rpm;
      }
      return 0;
    } else {
      // 숫자로 저장된 경우
      const numValue = Number(targetValue);
      if (numValue > 1000 && numValue < 1000000) {
        const str = String(numValue);
        if (str.length >= 4) {
          // 마지막 3자리를 RPM으로 추정 (예: 85100 → 85/100)
          const rpmPart = str.slice(-3);
          const rpm = Number(rpmPart);
          if (!isNaN(rpm) && rpm > 0) {
            return rpm;
          }
        }
      }
      // 단일 숫자 (50~200): RPM으로 해석 (cadence 일반 범위)
      if (!isNaN(numValue) && numValue >= 50 && numValue <= 200) {
        return numValue;
      }
      return 0;
    }
  }
  
  return 0;
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
  
  // target_type에 따라 표시 형식 변경
  const targetType = segment.target_type || 'ftp_pct';
  let ftpDisplay = '';
  if (targetType === 'ftp_pct') {
    ftpDisplay = `FTP ${Number(segment.target_value) || 0}%`;
  } else if (targetType === 'ftp_pctz') {
    // ftp_pctz 타입: "56, 75" 형식 (하한, 상한)
    const targetValue = segment.target_value;
    let minPercent = 60;
    let maxPercent = 75;
    
    if (typeof targetValue === 'string' && targetValue.includes(',')) {
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
    
    ftpDisplay = `FTP ${minPercent}%, ${maxPercent}%`;
  } else if (targetType === 'cadence_rpm') {
    ftpDisplay = `${Number(segment.target_value) || 0} rpm`;
  } else if (targetType === 'dual') {
    // dual 타입: "100/120" 형식 파싱
    const targetValue = segment.target_value;
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim());
      if (parts.length >= 2) {
        ftpDisplay = `FTP ${parts[0]}% / ${parts[1]} rpm`;
      } else {
        ftpDisplay = `FTP ${parts[0]}%`;
      }
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      ftpDisplay = `FTP ${targetValue[0]}% / ${targetValue[1]} rpm`;
    } else {
      ftpDisplay = `FTP ${Number(targetValue) || 100}%`;
    }
  } else {
    ftpDisplay = `FTP ${Number(segment.target_value) || 0}%`;
  }
  
  return `
    <div class="training-segment ${segmentTypeClass} ${currentClass}">
      <div class="segment-label">${escapeHtml(segment.label)}</div>
      <div class="segment-stats">
        <span class="ftp-value">${ftpDisplay}</span>
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
    
    // target_type에 따라 표시 형식 변경
    const targetType = segment.target_type || 'ftp_pct';
    let ftpDisplay = '';
    if (targetType === 'ftp_pct') {
      ftpDisplay = `FTP ${Number(segment.target_value) || 0}%`;
    } else if (targetType === 'ftp_pctz') {
      // ftp_pctz 타입: "56, 75" 형식 (하한, 상한)
      const targetValue = segment.target_value;
      let minPercent = 60;
      let maxPercent = 75;
      
      if (typeof targetValue === 'string' && targetValue.includes(',')) {
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
      
      ftpDisplay = `FTP ${minPercent}%, ${maxPercent}%`;
    } else if (targetType === 'cadence_rpm') {
      ftpDisplay = `${Number(segment.target_value) || 0} rpm`;
    } else if (targetType === 'dual') {
      // dual 타입: "100/120" 형식 파싱
      const targetValue = segment.target_value;
      if (typeof targetValue === 'string' && targetValue.includes('/')) {
        const parts = targetValue.split('/').map(s => s.trim());
        if (parts.length >= 2) {
          ftpDisplay = `FTP ${parts[0]}% / ${parts[1]} rpm`;
        } else {
          ftpDisplay = `FTP ${parts[0]}%`;
        }
      } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
        ftpDisplay = `FTP ${targetValue[0]}% / ${targetValue[1]} rpm`;
      } else {
        ftpDisplay = `FTP ${Number(targetValue) || 100}%`;
      }
    } else {
      ftpDisplay = `FTP ${Number(segment.target_value) || 0}%`;
    }
    
    return `<div class="pattern-item">${ftpDisplay} ${duration}</div>`;
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

// 워크아웃 캐시 키
const WORKOUT_CACHE_KEY = 'stelvio_workouts_cache';
const WORKOUT_CACHE_TIMESTAMP_KEY = 'stelvio_workouts_cache_timestamp';
const WORKOUT_CACHE_COUNT_KEY = 'stelvio_workouts_cache_count';

/**
 * 워크아웃 캐시에서 데이터 가져오기
 */
function getWorkoutCache() {
  try {
    const cached = localStorage.getItem(WORKOUT_CACHE_KEY);
    const timestamp = localStorage.getItem(WORKOUT_CACHE_TIMESTAMP_KEY);
    const count = parseInt(localStorage.getItem(WORKOUT_CACHE_COUNT_KEY) || '0', 10);
    
    if (cached && timestamp) {
      const workouts = JSON.parse(cached);
      
      // 세그먼트 캐시에서 세그먼트 복원
      try {
        const segmentsCache = localStorage.getItem('stelvio_workouts_segments_cache');
        if (segmentsCache) {
          const segmentsMap = JSON.parse(segmentsCache);
          workouts.forEach(workout => {
            if (segmentsMap[workout.id]) {
              workout.segments = segmentsMap[workout.id];
            }
          });
          console.log('[Workout Cache] 세그먼트 캐시에서 복원 완료');
        }
      } catch (segError) {
        console.warn('[Workout Cache] 세그먼트 캐시 읽기 실패 (무시):', segError);
      }
      
      return {
        workouts: workouts,
        timestamp: parseInt(timestamp, 10),
        count: count
      };
    }
  } catch (e) {
    console.warn('[Workout Cache] 캐시 읽기 실패:', e);
    // 캐시 손상 시 삭제
    try {
      clearWorkoutCache();
    } catch (clearError) {
      console.warn('[Workout Cache] 손상된 캐시 삭제 실패:', clearError);
    }
  }
  return null;
}

/**
 * 워크아웃 캐시에 데이터 저장
 * 세그먼트 용량을 고려하여 최적화된 저장 전략 사용
 */
function setWorkoutCache(workouts) {
  try {
    const timestamp = Date.now();
    const count = Array.isArray(workouts) ? workouts.length : 0;
    
    // 세그먼트가 포함된 워크아웃과 없는 워크아웃 분리
    const workoutsWithoutSegments = workouts.map(workout => {
      // 세그먼트를 제외한 워크아웃 데이터만 저장 (용량 절약)
      const { segments, ...workoutWithoutSegments } = workout;
      return workoutWithoutSegments;
    });
    
    // 먼저 세그먼트 없이 저장 시도
    try {
      const dataToStore = JSON.stringify(workoutsWithoutSegments);
      const dataSize = new Blob([dataToStore]).size;
      const maxSize = 5 * 1024 * 1024; // 5MB 제한
      
      if (dataSize > maxSize) {
        console.warn('[Workout Cache] 데이터 크기가 너무 큼:', dataSize, 'bytes (제한:', maxSize, 'bytes)');
        // 용량 초과 시 세그먼트가 많은 워크아웃부터 세그먼트 제거
        const sortedWorkouts = [...workoutsWithoutSegments].sort((a, b) => {
          const aSegCount = workouts.find(w => w.id === a.id)?.segments?.length || 0;
          const bSegCount = workouts.find(w => w.id === b.id)?.segments?.length || 0;
          return bSegCount - aSegCount;
        });
        
        // 점진적으로 세그먼트 제거하여 용량 내로 맞춤
        let reducedWorkouts = sortedWorkouts;
        let reducedSize = new Blob([JSON.stringify(reducedWorkouts)]).size;
        
        while (reducedSize > maxSize && reducedWorkouts.length > 0) {
          reducedWorkouts = reducedWorkouts.slice(0, -1);
          reducedSize = new Blob([JSON.stringify(reducedWorkouts)]).size;
        }
        
        localStorage.setItem(WORKOUT_CACHE_KEY, JSON.stringify(reducedWorkouts));
        console.log('[Workout Cache] 용량 초과로 일부 워크아웃 제외하여 저장:', reducedWorkouts.length, '/', count, '개');
      } else {
        localStorage.setItem(WORKOUT_CACHE_KEY, dataToStore);
      }
      
      localStorage.setItem(WORKOUT_CACHE_TIMESTAMP_KEY, String(timestamp));
      localStorage.setItem(WORKOUT_CACHE_COUNT_KEY, String(count));
      console.log('[Workout Cache] 캐시 저장 완료:', count, '개 워크아웃 (세그먼트 제외)');
      
      // 세그먼트는 별도 키로 저장 (선택적, 용량 허용 시)
      try {
        const segmentsMap = {};
        workouts.forEach(workout => {
          if (workout.segments && Array.isArray(workout.segments) && workout.segments.length > 0) {
            segmentsMap[workout.id] = workout.segments;
          }
        });
        
        if (Object.keys(segmentsMap).length > 0) {
          const segmentsData = JSON.stringify(segmentsMap);
          const segmentsSize = new Blob([segmentsData]).size;
          const segmentsMaxSize = 2 * 1024 * 1024; // 세그먼트는 2MB 제한
          
          if (segmentsSize <= segmentsMaxSize) {
            localStorage.setItem('stelvio_workouts_segments_cache', segmentsData);
            console.log('[Workout Cache] 세그먼트 캐시 저장 완료:', Object.keys(segmentsMap).length, '개 워크아웃의 세그먼트');
          } else {
            console.warn('[Workout Cache] 세그먼트 용량 초과로 저장하지 않음:', segmentsSize, 'bytes');
            localStorage.removeItem('stelvio_workouts_segments_cache');
          }
        }
      } catch (segError) {
        console.warn('[Workout Cache] 세그먼트 캐시 저장 실패 (무시):', segError);
      }
      
    } catch (storageError) {
      // QuotaExceededError 처리
      if (storageError.name === 'QuotaExceededError' || storageError.code === 22) {
        console.warn('[Workout Cache] localStorage 용량 초과 - 세그먼트 없이 재시도');
        // 세그먼트 없이 다시 시도
        localStorage.setItem(WORKOUT_CACHE_KEY, JSON.stringify(workoutsWithoutSegments));
        localStorage.setItem(WORKOUT_CACHE_TIMESTAMP_KEY, String(timestamp));
        localStorage.setItem(WORKOUT_CACHE_COUNT_KEY, String(count));
        localStorage.removeItem('stelvio_workouts_segments_cache'); // 세그먼트 캐시 삭제
        console.log('[Workout Cache] 세그먼트 제외하여 캐시 저장 완료:', count, '개 워크아웃');
      } else {
        throw storageError;
      }
    }
  } catch (e) {
    console.error('[Workout Cache] 캐시 저장 실패:', e);
    // 저장 실패해도 앱은 계속 동작하도록 함
  }
}

/**
 * 워크아웃 캐시 삭제
 */
function clearWorkoutCache() {
  try {
    localStorage.removeItem(WORKOUT_CACHE_KEY);
    localStorage.removeItem(WORKOUT_CACHE_TIMESTAMP_KEY);
    localStorage.removeItem(WORKOUT_CACHE_COUNT_KEY);
    localStorage.removeItem('stelvio_workouts_segments_cache'); // 세그먼트 캐시도 삭제
    console.log('[Workout Cache] 캐시 삭제 완료');
  } catch (e) {
    console.warn('[Workout Cache] 캐시 삭제 실패:', e);
  }
}

async function apiGetWorkouts(forceRefresh = false) {
  try {
    // 강제 새로고침이 아니고 캐시가 있으면 먼저 서버의 목록 수만 확인
    if (!forceRefresh) {
      const cache = getWorkoutCache();
      if (cache && cache.workouts && Array.isArray(cache.workouts) && cache.workouts.length > 0) {
        console.log('[Workout Cache] 캐시된 워크아웃:', cache.count, '개');
        
        // 서버에서 목록 수만 확인 (간단한 요청)
        // 실제로는 전체 목록을 가져와서 비교하는 것이 더 정확하지만,
        // API가 목록 수만 반환하는 기능이 없으므로 전체 목록을 가져와서 비교
        // 다만, 캐시된 데이터를 먼저 반환하고 백그라운드에서 업데이트하는 방식 사용
        try {
          if (!window.GAS_URL) {
            console.warn('[Workout Cache] GAS_URL이 없어 캐시 사용');
            return {
              success: true,
              items: cache.workouts,
              fromCache: true
            };
          }
          
          const serverResult = await jsonpRequest(window.GAS_URL, { 
            action: 'listWorkouts'
          });
          
          if (serverResult && serverResult.success) {
            const serverWorkouts = serverResult.items || serverResult.data || serverResult.workouts || (Array.isArray(serverResult) ? serverResult : []);
            const serverCount = Array.isArray(serverWorkouts) ? serverWorkouts.length : 0;
            
            // 서버의 목록 수가 캐시와 같으면 캐시 반환
            if (serverCount === cache.count) {
              console.log('[Workout Cache] 목록 수 동일 - 캐시 사용:', serverCount, '개');
              return {
                success: true,
                items: cache.workouts,
                fromCache: true
              };
            } else {
              // 목록 수가 다르면 서버 데이터 사용 및 캐시 업데이트
              console.log('[Workout Cache] 목록 수 변경 감지 - 서버 데이터 사용:', {
                cached: cache.count,
                server: serverCount
              });
              
              // 서버 데이터 캐시에 저장 (기존 세그먼트 병합)
              if (Array.isArray(serverWorkouts) && serverWorkouts.length > 0) {
                try {
                  // 기존 캐시의 세그먼트를 새 워크아웃에 병합
                  const workoutsWithSegments = serverWorkouts.map(workout => {
                    const cachedWorkout = cache.workouts.find(w => String(w.id) === String(workout.id));
                    if (cachedWorkout && cachedWorkout.segments && Array.isArray(cachedWorkout.segments) && cachedWorkout.segments.length > 0) {
                      return {
                        ...workout,
                        segments: cachedWorkout.segments  // 기존 캐시된 세그먼트 유지
                      };
                    }
                    return workout;
                  });
                  setWorkoutCache(workoutsWithSegments);
                } catch (mergeError) {
                  console.warn('[Workout Cache] 세그먼트 병합 실패, 기본 저장:', mergeError);
                  setWorkoutCache(serverWorkouts);
                }
              }
              
              return {
                success: true,
                items: serverWorkouts,
                fromCache: false
              };
            }
          }
        } catch (checkError) {
          console.warn('[Workout Cache] 서버 확인 실패, 캐시 사용:', checkError);
          // 서버 확인 실패 시 캐시 반환
          return {
            success: true,
            items: cache.workouts,
            fromCache: true
          };
        }
      } else {
        // 캐시가 없거나 비어있으면 서버에서 가져오기
        console.log('[Workout Cache] 캐시 없음 - 서버에서 로드');
      }
    }
    
    // 캐시가 없거나 강제 새로고침인 경우 서버에서 가져오기
    if (!window.GAS_URL) {
      console.error('[Workout Cache] GAS_URL이 없어 워크아웃을 가져올 수 없습니다.');
      return { 
        success: false, 
        error: 'GAS_URL이 설정되지 않았습니다.' 
      };
    }
    
    const result = await jsonpRequest(window.GAS_URL, { 
      action: 'listWorkouts'
    });
    
    if (result && result.success) {
      const workouts = result.items || result.data || result.workouts || (Array.isArray(result) ? result : []);
      if (Array.isArray(workouts) && workouts.length > 0) {
        // 기존 캐시에서 세그먼트가 있는 워크아웃은 세그먼트 유지
        try {
          const existingCache = getWorkoutCache();
          if (existingCache && existingCache.workouts && Array.isArray(existingCache.workouts)) {
            // 기존 캐시의 세그먼트를 새 워크아웃에 병합
            const workoutsWithSegments = workouts.map(workout => {
              const cachedWorkout = existingCache.workouts.find(w => String(w.id) === String(workout.id));
              if (cachedWorkout && cachedWorkout.segments && Array.isArray(cachedWorkout.segments) && cachedWorkout.segments.length > 0) {
                return {
                  ...workout,
                  segments: cachedWorkout.segments  // 기존 캐시된 세그먼트 유지
                };
              }
              return workout;  // 세그먼트 없이 저장 (나중에 로드 시 추가됨)
            });
            setWorkoutCache(workoutsWithSegments);
            console.log('[Workout Cache] 워크아웃 목록 캐시 저장 완료 (기존 세그먼트 유지)');
          } else {
            setWorkoutCache(workouts);
            console.log('[Workout Cache] 워크아웃 목록 캐시 저장 완료');
          }
        } catch (mergeError) {
          console.warn('[Workout Cache] 세그먼트 병합 실패, 기본 저장:', mergeError);
          setWorkoutCache(workouts);
        }
      } else {
        console.warn('[Workout Cache] 서버에서 빈 목록 반환');
      }
    } else {
      console.warn('[Workout Cache] 서버 응답 실패:', result);
    }
    
    return result;
  } catch (error) {
    console.error('[Workout Cache] apiGetWorkouts 실패:', error);
    
    // 에러 발생 시 캐시에서 시도
    if (!forceRefresh) {
      const cache = getWorkoutCache();
      if (cache && cache.workouts && Array.isArray(cache.workouts) && cache.workouts.length > 0) {
        console.warn('[Workout Cache] 서버 오류 - 캐시 사용:', cache.count, '개');
        return {
          success: true,
          items: cache.workouts,
          fromCache: true
        };
      }
    }
    
    return { 
      success: false, 
      error: error.message 
    };
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
 * WorkoutSegments 시트에서 workout id로 세그먼트 목록 조회
 */
async function apiGetWorkoutSegments(workoutId, forceRefresh = false) {
  if (!workoutId) return [];
  
  // 캐시에서 세그먼트 확인 (워크아웃 캐시에 세그먼트가 포함되어 있을 수 있음)
  if (!forceRefresh) {
    try {
      const cache = getWorkoutCache();
      if (cache && cache.workouts && Array.isArray(cache.workouts)) {
        const cachedWorkout = cache.workouts.find(w => String(w.id) === String(workoutId));
        if (cachedWorkout && cachedWorkout.segments && Array.isArray(cachedWorkout.segments) && cachedWorkout.segments.length > 0) {
          console.log('[Segment Cache] 캐시에서 세그먼트 로드:', workoutId, cachedWorkout.segments.length, '개');
          return cachedWorkout.segments;
        }
      }
    } catch (cacheError) {
      console.warn('[Segment Cache] 캐시 확인 실패:', cacheError);
    }
  }
  
  // 캐시에 없거나 강제 새로고침인 경우 서버에서 가져오기
  if (!window.GAS_URL) {
    console.warn('[Segment Cache] GAS_URL이 없어 세그먼트를 가져올 수 없습니다.');
    return [];
  }
  
  const doFetch = async () => {
    const result = await (typeof wmJsonpRequest === 'function' ? wmJsonpRequest : jsonpRequest)(window.GAS_URL, { action: 'getWorkoutSegments', workoutId: String(workoutId) });
    if (!result || !result.success) return [];
    const segs = result.segments || result.items || (Array.isArray(result) ? result : []);
    return Array.isArray(segs) ? segs : [];
  };
  
  try {
    let segs = await doFetch();
    if (segs.length === 0 && /android/i.test(navigator.userAgent)) {
      await new Promise(r => setTimeout(r, 150));
      segs = await doFetch();
    }
    
    // 세그먼트를 가져온 후 워크아웃 캐시에 업데이트
    if (segs.length > 0) {
      try {
        const cache = getWorkoutCache();
        if (cache && cache.workouts && Array.isArray(cache.workouts)) {
          const workoutIndex = cache.workouts.findIndex(w => String(w.id) === String(workoutId));
          if (workoutIndex !== -1) {
            // 캐시된 워크아웃에 세그먼트 추가
            const updatedWorkouts = [...cache.workouts];
            updatedWorkouts[workoutIndex] = {
              ...updatedWorkouts[workoutIndex],
              segments: segs
            };
            setWorkoutCache(updatedWorkouts);
            console.log('[Segment Cache] 세그먼트 캐시 업데이트:', workoutId, segs.length, '개');
          }
        }
      } catch (updateError) {
        console.warn('[Segment Cache] 캐시 업데이트 실패 (용량 제한 가능):', updateError);
        // 용량 제한으로 인한 실패는 무시하고 계속 진행
      }
    }
    
    return segs;
  } catch (error) {
    console.warn('apiGetWorkoutSegments 실패:', workoutId, error);
    
    // 오류 발생 시 캐시에서 다시 시도
    if (!forceRefresh) {
      try {
        const cache = getWorkoutCache();
        if (cache && cache.workouts && Array.isArray(cache.workouts)) {
          const cachedWorkout = cache.workouts.find(w => String(w.id) === String(workoutId));
          if (cachedWorkout && cachedWorkout.segments && Array.isArray(cachedWorkout.segments) && cachedWorkout.segments.length > 0) {
            console.log('[Segment Cache] 오류 발생 - 캐시에서 세그먼트 사용:', workoutId, cachedWorkout.segments.length, '개');
            return cachedWorkout.segments;
          }
        }
      } catch (cacheError) {
        // 캐시 확인도 실패하면 빈 배열 반환
      }
    }
    
    return [];
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

// loadWorkoutRoomStatusesAsync 제거됨 (그룹훈련 정보 미사용)

// 레거시: updateWorkoutRowRoomStatus 대체용 빈 함수 (호환성)
function updateWorkoutRowRoomStatus(workoutId, status, roomCode, grade) {
  // 그룹훈련 정보 미사용 - no-op
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
      publish_date: String(workoutData.publish_date || ''),
      password: String(workoutData.password || '')
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
       } else if (targetType === 'ftp_pctz') {
         // ftp_pctz 타입: target_value는 "56/75" 형식의 문자열로 저장 (하한, 상한)
         targetValue = String(targetValue || '60/75');
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
      // 워크아웃 생성 성공 시 캐시 무효화
      clearWorkoutCache();
      console.log('[apiCreateWorkoutWithSegments] 워크아웃 생성 완료 - 캐시 무효화');
      return {
        success: true,
        workoutId: workoutId,
        addedSegments: addResult.addedCount,
        totalSegments: segments.length
      };
    }
    
    console.log('세그먼트 없는 워크아웃 생성 완료');
    // 워크아웃 생성 성공 시 캐시 무효화
    clearWorkoutCache();
    console.log('[apiCreateWorkoutWithSegments] 워크아웃 생성 완료 - 캐시 무효화');
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
    publish_date: String(workoutData.publish_date || ''),
    password: String(workoutData.password || '')
  };
  
  try {
    const result = await jsonpRequest(window.GAS_URL, params);
    // 성공 시 캐시 무효화
    if (result && result.success) {
      clearWorkoutCache();
      console.log('[apiUpdateWorkout] 워크아웃 수정 완료 - 캐시 무효화');
    }
    return result;
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
    const result = await jsonpRequest(window.GAS_URL, { action: 'deleteWorkout', id: String(id) });
    // 성공 시 캐시 무효화
    if (result && result.success) {
      clearWorkoutCache();
      console.log('[apiDeleteWorkout] 워크아웃 삭제 완료 - 캐시 무효화');
    }
    return result;
  } catch (error) {
    console.error('apiDeleteWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

// ==========================================================
// 워크아웃 목록 및 선택 관리
// ==========================================================

async function loadWorkouts(categoryId, forceRefresh = false) {
  const workoutList = safeGetElement('workoutList');
  const loadingOverlay = document.getElementById('workoutLoadingOverlay');
  const loadingProgress = document.getElementById('workoutLoadingProgress');

  if (!workoutList) {
    console.warn('workoutList 요소를 찾을 수 없습니다.');
    return;
  }

  function showLoading(total, loaded) {
    if (loadingOverlay) {
      loadingOverlay.style.display = 'flex';
    }
    if (loadingProgress) {
      const source = forceRefresh ? '서버' : (loaded === 0 ? '캐시' : '서버');
      loadingProgress.textContent = (loaded || 0) + '/' + (total || 0) + ' ' + (source === '캐시' ? '캐시에서 로딩중...' : '갱신중.....');
    }
  }
  function hideLoading() {
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }
  }

  try {
    // apiGetWorkouts가 캐시 로직을 포함하고 있으므로, 여기서는 단순히 호출만 함
    // forceRefresh가 false이면 캐시를 먼저 확인하고, 목록 수가 같으면 캐시 반환
    // forceRefresh가 true이면 항상 서버에서 새로 가져옴
    showLoading(0, 0);
    
    const result = await apiGetWorkouts(forceRefresh);
    
    // 캐시 모드 확인 및 로그
    const isFromCache = result && result.fromCache;
    console.log('[loadWorkouts] 데이터 소스 확인:', {
      fromCache: isFromCache,
      forceRefresh: forceRefresh,
      itemsCount: result && result.items ? result.items.length : 0
    });
    
    // 캐시에서 로드된 경우 로딩 표시 업데이트
    if (isFromCache && result.items) {
      const cacheCount = Array.isArray(result.items) ? result.items.length : 0;
      showLoading(cacheCount, cacheCount);
      console.log('[loadWorkouts] ✅ 캐시에서 워크아웃 목록 로드됨:', cacheCount, '개');
    }

    if (!result || !result.success) {
      hideLoading();
      const errorMsg = result?.error || '알 수 없는 오류';
      
      // 서버 오류인 경우에도 캐시가 있으면 표시
      const cache = getWorkoutCache();
      if (cache && cache.workouts && Array.isArray(cache.workouts) && cache.workouts.length > 0) {
        console.warn('[loadWorkouts] 서버 오류 - 캐시 데이터 사용:', cache.count, '개');
        rawWorkouts = cache.workouts;
        // 캐시 데이터로 계속 진행
      } else {
        workoutList.innerHTML = `
          <div class="error-state">
            <div class="error-state-icon">⚠️</div>
            <div class="error-state-title">워크아웃 목록을 불러올 수 없습니다</div>
            <div class="error-state-description">오류: ${escapeHtml(errorMsg)}</div>
            <button class="retry-button" onclick="loadWorkouts('${categoryId || 'all'}', true)">다시 시도</button>
          </div>
        `;
        return;
      }
    }

    let rawWorkouts = result.items || result.data || result.workouts || (Array.isArray(result) ? result : []);
    if (!Array.isArray(rawWorkouts)) rawWorkouts = [];
    
    // 빈 목록인 경우에도 캐시 확인
    if (rawWorkouts.length === 0 && !forceRefresh) {
      const cache = getWorkoutCache();
      if (cache && cache.workouts && Array.isArray(cache.workouts) && cache.workouts.length > 0) {
        console.warn('[loadWorkouts] 서버에서 빈 목록 반환 - 캐시 데이터 사용:', cache.count, '개');
        rawWorkouts = cache.workouts;
      }
    }

    // 캐시가 아닌 경우에만 재시도 로직 실행
    if (!result.fromCache && rawWorkouts.length <= 5 && (categoryId === 'all' || !categoryId)) {
      try {
        const retryResult = await apiGetWorkouts(forceRefresh);
        if (retryResult && retryResult.success) {
          const retryItems = retryResult.items || retryResult.data || retryResult.workouts || (Array.isArray(retryResult) ? retryResult : []);
          if (Array.isArray(retryItems) && retryItems.length > rawWorkouts.length) {
            rawWorkouts = retryItems;
            console.log('워크아웃 목록 재요청으로 더 많은 데이터 수신:', rawWorkouts.length, '개');
          }
        }
      } catch (retryErr) {
        console.warn('워크아웃 목록 재요청 실패:', retryErr);
      }
    }

    const totalWorkouts = rawWorkouts.length;
    // isFromCache는 이미 위에서 선언되었으므로 재사용
    
    // 로딩 표시: 캐시 모드인지 서버 모드인지 명확히 표시
    if (isFromCache) {
      console.log('[loadWorkouts] ✅ 캐시 모드: 워크아웃 목록 로드됨:', totalWorkouts, '개');
      showLoading(totalWorkouts, totalWorkouts);  // 캐시 모드: 즉시 완료 표시
    } else {
      console.log('[loadWorkouts] 🌐 서버 모드: 워크아웃 목록 로드 중:', totalWorkouts, '개');
      showLoading(totalWorkouts, 0);
    }
    
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

    // 카테고리 필터 적용 전 전체 목록 (카테고리 개수 표시용, author 기준)
    const allWorkoutsForCount = filteredWorkouts;

    // 카테고리 필터 (구글 시트 author 필드 기준)
    if (categoryId && categoryId !== 'all') {
      filteredWorkouts = allWorkoutsForCount.filter(w => {
        const cat = getWorkoutCategoryId(w);
        return cat === categoryId;
      });
      console.log('📂 카테고리 필터 적용 (author 기준):', { categoryId, count: filteredWorkouts.length });
    }

    if (filteredWorkouts.length === 0) {
      hideLoading();
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
      if (typeof renderWorkoutCategories === 'function') renderWorkoutCategories(allWorkoutsForCount);
      return;
    }

    // WorkoutSegments에서 세그먼트 조회 (그래프 표시용, 표시할 워크아웃만)
    const isAndroid = /android/i.test(navigator.userAgent);
    // result 객체가 이 스코프에서 접근 가능한지 확인 (위에서 이미 정의됨)
    const isFromCacheForSegments = result && result.fromCache;
    console.log('[loadWorkouts] 세그먼트 조회 모드:', {
      isFromCache: isFromCacheForSegments,
      filteredWorkoutsCount: filteredWorkouts.length
    });
    
    // 세그먼트가 없는 워크아웃만 필터링
    let workoutsNeedingSegments = filteredWorkouts.filter(w => {
      // 세그먼트가 없거나 빈 배열인 경우만 포함
      if (!w.segments || !Array.isArray(w.segments) || w.segments.length === 0) {
        return true;
      }
      return false;
    });
    
    const totalToFetch = workoutsNeedingSegments.length;
    
    // 캐시 모드에서 세그먼트가 필요한 워크아웃이 없으면 세그먼트 조회 완전히 건너뛰기
    if (isFromCacheForSegments && totalToFetch === 0) {
      console.log('[loadWorkouts] ✅ 캐시 모드: 세그먼트가 이미 포함되어 있음 - 세그먼트 조회 건너뛰기');
    } else if (isFromCacheForSegments && totalToFetch > 0) {
      // 캐시 모드이지만 세그먼트가 필요한 경우: 빠른 배치 처리 (100개씩, 지연 없음)
      console.log('[loadWorkouts] ⚡ 캐시 모드: 세그먼트 빠른 로딩 시작 (', totalToFetch, '개, 배치 크기: 100개, 지연: 없음)');
      showLoading(totalToFetch, 0);
      
      // 캐시 모드: 모든 세그먼트를 큰 배치로 빠르게 처리 (지연 없음)
      const largeBatchSize = 100;  // 캐시 모드에서는 100개씩
      for (let i = 0; i < workoutsNeedingSegments.length; i += largeBatchSize) {
        const batch = workoutsNeedingSegments.slice(i, i + largeBatchSize);
        console.log('[loadWorkouts] 캐시 모드: 세그먼트 배치 처리 중...', i + 1, '-', Math.min(i + largeBatchSize, totalToFetch), '/', totalToFetch);
        await Promise.all(batch.map(async (workout) => {
          const segments = await apiGetWorkoutSegments(workout.id);
          workout.segments = segments;
        }));
        const loadedCount = Math.min(i + batch.length, totalToFetch);
        showLoading(totalToFetch, loadedCount);
        // 캐시 모드에서는 지연 없음 (즉시 다음 배치 처리)
      }
      console.log('[loadWorkouts] ✅ 캐시 모드: 세그먼트 로딩 완료 (', totalToFetch, '개)');
    } else if (!isFromCacheForSegments && totalToFetch > 0) {
      // 서버 모드: 기존 배치 처리 유지 (20개씩, 지연 있음)
      console.log('[loadWorkouts] 🌐 서버 모드: 세그먼트 배치 로딩 시작 (', totalToFetch, '개, 배치 크기: 20개, 지연: ', (isAndroid ? 250 : 100), 'ms)');
      showLoading(totalToFetch, 0);
      
      const SEGMENT_BATCH_SIZE = 20;  // 서버 모드: 20개씩
      const SEGMENT_BATCH_DELAY = isAndroid ? 250 : 100;  // 서버 모드: 지연 있음
      
      for (let i = 0; i < workoutsNeedingSegments.length; i += SEGMENT_BATCH_SIZE) {
        const batch = workoutsNeedingSegments.slice(i, i + SEGMENT_BATCH_SIZE);
        console.log('[loadWorkouts] 서버 모드: 세그먼트 배치 처리 중...', i + 1, '-', Math.min(i + SEGMENT_BATCH_SIZE, totalToFetch), '/', totalToFetch);
        await Promise.all(batch.map(async (workout) => {
          const segments = await apiGetWorkoutSegments(workout.id);
          workout.segments = segments;
        }));
        const loadedCount = Math.min(i + batch.length, totalToFetch);
        showLoading(totalToFetch, loadedCount);
        if (i + SEGMENT_BATCH_SIZE < workoutsNeedingSegments.length && SEGMENT_BATCH_DELAY > 0) {
          await new Promise(r => setTimeout(r, SEGMENT_BATCH_DELAY));
        }
      }
      console.log('[loadWorkouts] ✅ 서버 모드: 세그먼트 로딩 완료 (', totalToFetch, '개)');
    }

    // 전역 변수에 저장 (검색·신규 추가 시 기존 목록 유지용)
    window.workouts = filteredWorkouts;
    window.workoutsFull = allWorkoutsForCount;

    // 세그먼트를 가져온 후 캐시 업데이트 (다음 로드 시 세그먼트 조회 건너뛰기)
    // 캐시 모드든 서버 모드든 세그먼트를 가져온 경우 캐시 업데이트
    if (totalToFetch > 0) {
      try {
        const cache = getWorkoutCache();
        if (cache && cache.workouts && Array.isArray(cache.workouts)) {
          // 세그먼트가 추가된 워크아웃으로 캐시 업데이트
          const updatedWorkouts = cache.workouts.map(cachedWorkout => {
            const updatedWorkout = filteredWorkouts.find(w => String(w.id) === String(cachedWorkout.id));
            if (updatedWorkout && updatedWorkout.segments && Array.isArray(updatedWorkout.segments) && updatedWorkout.segments.length > 0) {
              // 세그먼트가 포함된 워크아웃으로 교체
              return {
                ...updatedWorkout,
                segments: updatedWorkout.segments  // 세그먼트 포함
              };
            }
            // 세그먼트가 없는 경우 기존 워크아웃 유지 (또는 캐시된 세그먼트가 있으면 유지)
            if (cachedWorkout.segments && Array.isArray(cachedWorkout.segments) && cachedWorkout.segments.length > 0) {
              return cachedWorkout;  // 기존 캐시된 세그먼트 유지
            }
            return cachedWorkout;  // 기존 워크아웃 유지
          });
          setWorkoutCache(updatedWorkouts);
          console.log('[Workout Cache] 세그먼트 포함하여 캐시 업데이트 완료 (', totalToFetch, '개 워크아웃의 세그먼트 추가됨)');
        } else {
          // 캐시가 없으면 현재 워크아웃 목록을 세그먼트 포함하여 캐시 저장
          setWorkoutCache(filteredWorkouts);
          console.log('[Workout Cache] 워크아웃 목록 및 세그먼트 캐시 저장 완료');
        }
      } catch (cacheUpdateError) {
        console.warn('[Workout Cache] 세그먼트 캐시 업데이트 실패:', cacheUpdateError);
      }
    } else if (isFromCacheForSegments) {
      // 세그먼트가 이미 모두 포함되어 있는 경우에도 캐시 확인
      console.log('[Workout Cache] 모든 워크아웃에 세그먼트가 이미 포함되어 있음');
    }

    renderWorkoutTable(filteredWorkouts, {}, {}, grade);

    if (typeof renderWorkoutCategories === 'function') {
      renderWorkoutCategories(allWorkoutsForCount);
    }
    const sourceText = result.fromCache ? ' (캐시)' : '';
    window.showToast(`${filteredWorkouts.length}개의 워크아웃을 불러왔습니다${sourceText}.`);
    hideLoading();

  } catch (error) {
    console.error('워크아웃 목록 로드 실패:', error);
    
    let errorMessage = '알 수 없는 오류가 발생했습니다.';
    if (error.message) {
      errorMessage = error.message;
    }
    
    hideLoading();
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
 * 신규 저장된 워크아웃만 목록에 추가 (전체 재로딩 없이)
 * - 기존 window.workouts / window.workoutsFull 이 있으면 새 항목만 fetch 후 추가·재렌더
 * - 없으면 loadWorkouts()로 폴백
 */
async function appendNewWorkoutToList(workoutId) {
  if (!workoutId) return;
  let grade = '2';
  try {
    if (typeof getViewerGrade === 'function') {
      grade = String(getViewerGrade());
    } else {
      const viewer = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
      const authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
      if (viewer && viewer.grade != null) grade = String(viewer.grade);
      else if (authUser && authUser.grade != null) grade = String(authUser.grade);
    }
  } catch (e) {
    grade = '2';
  }
  const isAdmin = (grade === '1' || grade === '3');

  try {
    const getResult = await apiGetWorkout(workoutId);
    if (!getResult || !getResult.success || !getResult.item) {
      if (window.workoutsFull && window.workoutsFull.length > 0) {
        window.showToast('저장된 워크아웃을 목록에 반영하지 못했습니다. 목록을 새로고침합니다.');
        loadWorkouts(window.workoutViewState && window.workoutViewState.selectedCategory ? window.workoutViewState.selectedCategory : 'all');
      } else {
        loadWorkouts('all');
      }
      return;
    }
    const raw = getResult.item;
    if (!validateWorkoutData(raw)) {
      loadWorkouts(window.workoutViewState && window.workoutViewState.selectedCategory ? window.workoutViewState.selectedCategory : 'all');
      return;
    }
    const segments = await apiGetWorkoutSegments(workoutId);
    raw.segments = Array.isArray(segments) ? segments : [];
    const newWorkout = normalizeWorkoutData(raw);

    const statusStr = String(newWorkout.status || '').trim();
    const isPublic = statusStr === '보이기';
    if (!isAdmin && !isPublic) {
      if (!window.workoutsFull || window.workoutsFull.length === 0) {
        loadWorkouts('all');
        return;
      }
      if (window.workoutsFull.some(function(w) { return w.id === newWorkout.id; })) return;
      window.workoutsFull = window.workoutsFull.slice();
      window.workoutsFull.push(newWorkout);
      if (typeof renderWorkoutCategories === 'function') renderWorkoutCategories(window.workoutsFull);
      return;
    }

    if (!window.workoutsFull || !Array.isArray(window.workoutsFull)) {
      loadWorkouts('all');
      return;
    }
    if (window.workoutsFull.some(function(w) { return w.id === newWorkout.id; })) {
      if (window.workouts && window.workouts.length > 0 && typeof renderWorkoutTable === 'function') {
        renderWorkoutTable(window.workouts, {}, {}, grade);
        if (typeof attachTableEventListeners === 'function') attachTableEventListeners();
      }
      return;
    }
    window.workoutsFull = window.workoutsFull.slice();
    window.workoutsFull.push(newWorkout);

    const selectedCategory = (window.workoutViewState && window.workoutViewState.selectedCategory) ? window.workoutViewState.selectedCategory : 'all';
    const newCat = typeof getWorkoutCategoryId === 'function' ? getWorkoutCategoryId(newWorkout) : '';
    const matchesCategory = selectedCategory === 'all' || newCat === selectedCategory;

    if (window.workouts && Array.isArray(window.workouts)) {
      if (matchesCategory && !window.workouts.some(function(w) { return w.id === newWorkout.id; })) {
        window.workouts = window.workouts.slice();
        window.workouts.push(newWorkout);
      }
      if (typeof renderWorkoutTable === 'function') {
        renderWorkoutTable(window.workouts, {}, {}, grade);
        if (typeof attachTableEventListeners === 'function') attachTableEventListeners();
      }
    } else if (matchesCategory) {
      window.workouts = [newWorkout];
      if (typeof renderWorkoutTable === 'function') {
        renderWorkoutTable(window.workouts, {}, {}, grade);
        if (typeof attachTableEventListeners === 'function') attachTableEventListeners();
      }
    }

    if (typeof renderWorkoutCategories === 'function') renderWorkoutCategories(window.workoutsFull);
  } catch (e) {
    console.warn('appendNewWorkoutToList 실패, 전체 로딩으로 폴백:', e);
    loadWorkouts(window.workoutViewState && window.workoutViewState.selectedCategory ? window.workoutViewState.selectedCategory : 'all');
  }
}

/** 구글 시트 Workouts.author 필드 → 카테고리 매핑 (대소문자 무시) */
var AUTHOR_CATEGORY_MAP = [
  'Active Recovery', 'Endurance', 'Sweet Spot', 'Tempo', 'Threshold', 'VO2 Max'
];

/**
 * 워크아웃의 카테고리 계산 (구글 시트 Workouts.author 필드 기준)
 * @param {Object} workout - workout 객체 (author 필드 포함)
 * @returns {string} 'Active Recovery'|'Endurance'|'Sweet Spot'|'Tempo'|'Threshold'|'VO2 Max'|'기타'
 */
function getWorkoutCategoryId(workout) {
  if (!workout) return '기타';
  const authorVal = String(workout.author || '').trim();
  if (!authorVal) return '기타';
  const authorLower = authorVal.toLowerCase();
  for (let i = 0; i < AUTHOR_CATEGORY_MAP.length; i++) {
    if (authorLower === AUTHOR_CATEGORY_MAP[i].toLowerCase()) {
      return AUTHOR_CATEGORY_MAP[i];
    }
  }
  return '기타';
}

/**
 * 워크아웃의 주된 Zone 계산 (세그먼트 시간 가중, 하위 호환)
 * @returns {string} 'z1'|'z2'|'z3'|'z4'|'z5'|null
 */
function getWorkoutDominantZone(workout) {
  const catId = getWorkoutCategoryId(workout);
  const catToZone = { 'Active Recovery': 'z1', 'Endurance': 'z2', 'Tempo': 'z3', 'Sweet Spot': 'z3', 'Threshold': 'z4', 'VO2 Max': 'z5', '기타': null };
  return catToZone[catId] || null;
}

/**
 * 세그먼트 지속시간(초) 추출 - duration_sec / duration 모두 지원 (API·캐시 필드명 통일)
 */
function getSegmentDurationSec(seg) {
  if (!seg) return 0;
  var sec = Number(seg.duration_sec);
  if (sec > 0) return Math.floor(sec);
  sec = Number(seg.duration);
  if (sec > 0) return Math.floor(sec);
  return 0;
}

/**
 * 워크아웃 TSS 추정 — AI 워크아웃 추천과 동일 로직 (가중 평균 IF)
 * TSS = (duration_h) * (IF)^2 * 100, IF = 세그먼트 구간별 지속시간 가중 평균 강도(FTP 대비)
 * ftp_pct, ftp_pctz, dual 등 target_type 지원 (getSegmentFtpPercentForPreview 사용)
 * 캐시/목록용: total_seconds, totalSeconds 없을 때 totalMinutes * 60 사용
 */
function estimateWorkoutTSS(workout) {
  if (!workout) return 0;
  var segs = workout.segments || [];
  var totalSec = Number(workout.total_seconds) || Number(workout.totalSeconds) || 0;
  if (totalSec <= 0 && segs.length > 0) {
    for (var i = 0; i < segs.length; i++) totalSec += getSegmentDurationSec(segs[i]);
  }
  if (totalSec <= 0 && (workout.totalMinutes != null || workout.total_minutes != null)) {
    var min = Number(workout.totalMinutes) || Number(workout.total_minutes) || 0;
    if (min > 0) totalSec = min * 60;
  }
  if (totalSec <= 0) return 0;
  var weightedIfSum = 0;
  var totalWeight = 0;
  for (var j = 0; j < segs.length; j++) {
    var dur = getSegmentDurationSec(segs[j]);
    if (dur <= 0) continue;
    var pct = getSegmentFtpPercentForPreview(segs[j]) || 0;
    var ifSeg = pct > 0 ? pct / 100 : 0.5;
    weightedIfSum += dur * ifSeg;
    totalWeight += dur;
  }
  var avgIF = totalWeight > 0 ? weightedIfSum / totalWeight : 0.65;
  var hours = totalSec / 3600;
  var tss = hours * (avgIF * avgIF) * 100;
  return Math.round(tss);
}

/**
 * WorkoutCard 컴포넌트 렌더 (단일 카드 HTML)
 * 카드 블럭 클릭 시 선택·훈련준비 로딩, 선택된 카드는 훈련명 앞에 체크 표시
 */
function renderWorkoutCard(workout, _roomStatusMap = {}, _roomCodeMap = {}, grade = '2') {
  if (!workout || typeof workout !== 'object' || !workout.id) return '';
  const safeTitle = escapeHtml(String(workout.title || '제목 없음'));
  const totalMinutes = Math.round((workout.total_seconds || workout.totalSeconds || 0) / 60) || Number(workout.totalMinutes) || Number(workout.total_minutes) || 0;
  const tss = estimateWorkoutTSS(workout);
  const graphId = 'workout-card-graph-' + workout.id;
  const isAdmin = (grade === '1' || grade === '3');
  const categoryLabel = typeof getWorkoutCategoryId === 'function' ? getWorkoutCategoryId(workout) : '';
  const isSelected = window.currentWorkout && String(window.currentWorkout.id) === String(workout.id);
  const selectedCheck = isSelected ? '<img src="assets/img/check2.png" alt="선택됨" class="workout-card__title-check" />' : '';
  const selectedClass = isSelected ? ' workout-card--selected' : '';
  return `
    <div class="workout-card workout-card--clickable${selectedClass}" data-workout-id="${workout.id}" onclick="handleWorkoutCardClick(event, ${workout.id})" role="button" tabindex="0" aria-label="워크아웃 선택: ${safeTitle}">
      <div class="workout-card__header">
        <h3 class="workout-card__title">${selectedCheck}<span class="workout-card__title-text">${safeTitle}</span></h3>
        <div class="workout-card__actions">
          <button type="button" class="workout-card__select-btn" id="selectWorkoutBtn-${workout.id}" onclick="event.stopPropagation(); selectWorkout(${workout.id})" title="선택" aria-label="선택">
            <img src="assets/img/check2.png" alt="선택" class="workout-card__select-icon" />
          </button>
          ${isAdmin ? `
            <button type="button" class="workout-card__action-btn" onclick="event.stopPropagation(); editWorkout(${workout.id})" title="수정">
              <img src="assets/img/edit2.png" alt="수정" />
            </button>
            <button type="button" class="workout-card__action-btn" onclick="event.stopPropagation(); deleteWorkout(${workout.id})" title="삭제">
              <img src="assets/img/delete2.png" alt="삭제" />
            </button>
          ` : ''}
        </div>
      </div>
      <div class="workout-card__graph" id="${graphId}"></div>
      <div class="workout-card__footer">
        <span class="workout-card__meta"><span class="workout-card__meta-icon">⏱</span> ${totalMinutes}분</span>
        <span class="workout-card__meta"><img src="assets/img/tss.png" alt="TSS" class="workout-card__meta-icon-img" /> TSS ${tss}</span>
        ${categoryLabel ? `<span class="workout-card__category">${escapeHtml(categoryLabel)}</span>` : ''}
      </div>
    </div>
  `;
}

/**
 * WorkoutCard 그리드 렌더링 (workoutList에 카드 표시)
 */
function renderWorkoutCards(workouts, workoutRoomStatusMap = {}, workoutRoomCodeMap = {}, grade = '2') {
  const workoutList = safeGetElement('workoutList');
  if (!workoutList) return;
  if (!workouts || workouts.length === 0) {
    workoutList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">등록된 워크아웃이 없습니다</div>
        <div class="empty-state-description">새로운 워크아웃을 만들어 훈련을 시작해보세요.</div>
        <div class="empty-state-action">
          <button class="btn btn-primary" onclick="showAddWorkoutForm(true)">➕ 첫 번째 워크아웃 만들기</button>
        </div>
      </div>
    `;
    return;
  }
  workoutList.innerHTML = `
    <div class="workout-cards-grid">
      ${workouts.map(w => renderWorkoutCard(w, workoutRoomStatusMap, workoutRoomCodeMap, grade)).join('')}
    </div>
  `;
  workouts.forEach(workout => {
    const graphEl = document.getElementById('workout-card-graph-' + workout.id);
    if (graphEl && workout.segments && workout.segments.length > 0 && typeof renderSegmentedWorkoutGraph === 'function') {
      renderSegmentedWorkoutGraph(graphEl, workout.segments, { maxHeight: 100 });
    } else if (graphEl && (!workout.segments || workout.segments.length === 0)) {
      graphEl.innerHTML = '<div class="segmented-workout-graph-empty">세그먼트 없음</div>';
    }
  });
  applyWorkoutPermissions?.();
  checkExpiryAndWarn?.();
}

/**
 * 워크아웃 테이블 렌더링 함수 (WorkoutCard 그리드 뷰)
 */
function renderWorkoutTable(workouts, workoutRoomStatusMap = {}, workoutRoomCodeMap = {}, grade = '2') {
  const workoutList = safeGetElement('workoutList');
  if (!workoutList) {
    console.warn('workoutList 요소를 찾을 수 없습니다.');
    return;
  }
  renderWorkoutCards(workouts, workoutRoomStatusMap, workoutRoomCodeMap, grade);
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
        {},
        {},
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
  // 그룹훈련 버튼 (레거시 테이블 뷰용 - 사용 안 함)
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
   
     // 2) 각 워크아웃 테이블 행의 수정/삭제 버튼 (이제는 행 클릭으로 선택하므로 버튼이 없음)
     // 기존 코드는 유지하되, 버튼이 없을 수 있으므로 안전하게 처리
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



/**
 * 카드 블럭 클릭 시 호출 (선택 버튼이 아닌 카드 영역 클릭)
 * event.stopPropagation은 내부 버튼에서 처리하므로 여기서는 선택만 실행
 */
function handleWorkoutCardClick(event, workoutId) {
  if (event && event.target && event.target.closest && (event.target.closest('button') || event.target.closest('a'))) {
    return;
  }
  if (workoutId) selectWorkout(workoutId);
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
  
  var workoutLoadingOverlay = document.getElementById('workoutLoadingOverlay');
  var workoutLoadingProgress = document.getElementById('workoutLoadingProgress');
  if (workoutLoadingOverlay) { workoutLoadingOverlay.style.display = 'flex'; }
  if (workoutLoadingProgress) { workoutLoadingProgress.textContent = 'Workout Loading ....'; }
  
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

    // AI 추천 워크아웃 선택과 동일한 로직 사용 (selectWorkoutForTrainingReady)
    if (typeof selectWorkoutForTrainingReady === 'function') {
      await selectWorkoutForTrainingReady(workout, { skipToast: true });
    } else {
      window.currentWorkout = workout;
      try {
        localStorage.setItem('currentWorkout', JSON.stringify(workout));
      } catch (e) {
        console.warn('로컬 스토리지 저장 실패:', e);
      }
      if (typeof updateTrainingReadyScreenWithWorkout === 'function') {
        updateTrainingReadyScreenWithWorkout(workout);
      }
    }

    window.showToast(`${workout.title || '워크아웃'}이 선택되었습니다.`);
    
    // 현재 활성화된 화면을 히스토리에 추가 (훈련 준비 화면으로 이동하기 전)
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
    
    window.showScreen('trainingReadyScreen', false);
    
  } catch (error) {
    console.error('워크아웃 선택 실패:', error);
    window.showToast('워크아웃 선택 중 오류가 발생했습니다.');
  } finally {
    if (workoutLoadingOverlay) { workoutLoadingOverlay.style.display = 'none'; }
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

async function showAddWorkoutForm(clearForm = true) {
  window.showScreen('workoutBuilderScreen');
  
  // TrainingSchedules 목록 로드 및 상태 콤보박스에 추가
  await loadTrainingSchedulesForWorkoutForm();
  
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
    
    // 비밀번호 필드 초기화 및 숨김
    const passwordEl = safeGetElement('wbPassword');
    const passwordGroup = safeGetElement('wbPasswordGroup');
    if (passwordEl) passwordEl.value = '';
    if (passwordGroup) passwordGroup.style.display = 'none';
    
    workoutSegments = [];
    if (typeof renderSegments === 'function') {
      renderSegments();
    }
    if (typeof updateSegmentSummary === 'function') {
      updateSegmentSummary();
    }
  }
}

/**
 * 워크아웃 작성 화면용 TrainingSchedules 목록 로드
 * 구글 시트의 TrainingSchedules > title 리스트를 가져와서 상태 콤보박스에 추가
 */
async function loadTrainingSchedulesForWorkoutForm() {
  const statusEl = safeGetElement('wbStatus');
  if (!statusEl) {
    console.warn('[loadTrainingSchedulesForWorkoutForm] wbStatus 요소를 찾을 수 없습니다.');
    return;
  }
  
  try {
    // 기본 옵션 유지: "보이기 (공개)"
    const baseOption = '<option value="보이기">보이기 (공개)</option>';
    
    // TrainingSchedules 목록 가져오기
    const url = `${window.GAS_URL}?action=listTrainingSchedules`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'TrainingSchedules 목록을 불러오는데 실패했습니다');
    }
    
    // 상태 콤보박스 업데이트
    let optionsHtml = baseOption;
    
    if (result.items && result.items.length > 0) {
      // TrainingSchedules의 title 목록 추가 (중복 제거)
      const uniqueTitles = [...new Set(result.items.map(schedule => schedule.title).filter(title => title && title.trim() !== ''))];
      
      uniqueTitles.forEach(title => {
        optionsHtml += `<option value="${escapeHtml(title)}">${escapeHtml(title)}</option>`;
      });
    }
    
    statusEl.innerHTML = optionsHtml;
    
    // status 변경 시 비밀번호 필드 활성화/비활성화 이벤트 리스너 추가
    statusEl.addEventListener('change', function() {
      const passwordGroup = safeGetElement('wbPasswordGroup');
      const passwordInput = safeGetElement('wbPassword');
      const selectedStatus = this.value;
      
      if (passwordGroup && passwordInput) {
        if (selectedStatus && selectedStatus !== '보이기') {
          // "보이기" 이외 선택 시 비밀번호 필드 표시 및 필수로 설정
          passwordGroup.style.display = 'block';
          passwordInput.required = true;
        } else {
          // "보이기" 선택 시 비밀번호 필드 숨김 및 필수 해제
          passwordGroup.style.display = 'none';
          passwordInput.required = false;
          passwordInput.value = '';
        }
      }
    });
    
    console.log(`[loadTrainingSchedulesForWorkoutForm] ${result.items?.length || 0}개의 스케줄 목록을 로드했습니다.`);
    
  } catch (error) {
    console.error('[loadTrainingSchedulesForWorkoutForm] 오류:', error);
    // 오류 발생 시 기본 옵션만 유지
    statusEl.innerHTML = baseOption;
    
    // 이벤트 리스너는 여전히 추가
    statusEl.addEventListener('change', function() {
      const passwordGroup = safeGetElement('wbPasswordGroup');
      const passwordInput = safeGetElement('wbPassword');
      const selectedStatus = this.value;
      
      if (passwordGroup && passwordInput) {
        if (selectedStatus && selectedStatus !== '보이기') {
          passwordGroup.style.display = 'block';
          passwordInput.required = true;
        } else {
          passwordGroup.style.display = 'none';
          passwordInput.required = false;
          passwordInput.value = '';
        }
      }
    });
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
  const passwordEl = safeGetElement('wbPassword');
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
  // 비공개 워크아웃인 경우 비밀번호 저장
  const password = (status !== '보이기' && passwordEl) ? (passwordEl.value || '').trim() : '';

  if (!title) {
    window.showToast('제목을 입력해주세요.');
    titleEl.focus();
    return;
  }

  if (!author) {
    window.showToast('카테고리를 선택해주세요.');
    authorEl.focus();
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
      } else if (targetType === 'ftp_pctz') {
        // ftp_pctz 타입: target_value는 "50/70" 형식의 문자열로 저장 (하한, 상한)
        // 이미 "50/70" 형식이면 그대로 사용, 아니면 문자열로 변환
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
          targetValue = targetValue; // 이미 올바른 형식
        } else {
          // 숫자나 다른 형식이면 기본값 사용
          targetValue = String(targetValue || '60/75');
        }
      } else if (targetType === 'cadence_rpm') {
        // cadence_rpm 타입: 숫자로 저장
        targetValue = Number(targetValue) || 90;
      } else {
        // ftp_pct 타입: 숫자로 저장
        targetValue = Number(targetValue) || 100;
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

    // 비공개 워크아웃인 경우 비밀번호 검증
    if (status !== '보이기' && !password) {
      window.showToast('비공개 워크아웃은 비밀번호를 입력해야 합니다.');
      if (passwordEl) {
        passwordEl.focus();
      }
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.classList.remove('btn-saving', 'saving-state');
        saveBtn.innerHTML = '💾 저장';
      }
      return;
    }
    
    const workoutData = { 
      title, 
      description, 
      author, 
      status, 
      publish_date: publishDate,
      password: password,
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
      
      if (typeof appendNewWorkoutToList === 'function') {
        setTimeout(function() { appendNewWorkoutToList(result.workoutId); }, 100);
      } else {
        setTimeout(function() { loadWorkouts(window.workoutViewState && window.workoutViewState.selectedCategory ? window.workoutViewState.selectedCategory : 'all'); }, 500);
      }
      
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
    
    // 워크아웃 빌더 화면으로 이동 (폼 초기화 안함, TrainingSchedules 목록 로드)
    await showAddWorkoutForm(false);
    
    // 기본 정보 채우기 (TrainingSchedules 목록 로드 완료 후)
    const titleEl = safeGetElement('wbTitle');
    const descEl = safeGetElement('wbDesc');
    const authorEl = safeGetElement('wbAuthor');
    const statusEl = safeGetElement('wbStatus');
    const publishDateEl = safeGetElement('wbPublishDate');
    
    if (titleEl) titleEl.value = workout.title || '';
    if (descEl) descEl.value = workout.description || '';
    if (authorEl) authorEl.value = workout.author || '';
    // TrainingSchedules 목록이 로드된 후 상태 값 설정
    if (statusEl) {
      // 로드된 옵션 중에서 일치하는 값이 있으면 선택, 없으면 "보이기"로 설정
      const savedStatus = workout.status || '보이기';
      const hasOption = Array.from(statusEl.options).some(opt => opt.value === savedStatus);
      statusEl.value = hasOption ? savedStatus : '보이기';
      
      // status에 따라 비밀번호 필드 표시/숨김
      const passwordEl = safeGetElement('wbPassword');
      const passwordGroup = safeGetElement('wbPasswordGroup');
      if (passwordGroup && passwordEl) {
        if (savedStatus && savedStatus !== '보이기') {
          passwordGroup.style.display = 'block';
          passwordEl.required = true;
          // 비공개 워크아웃인 경우 password 필드에 저장된 비밀번호 표시
          if (workout.password) {
            passwordEl.value = workout.password;
          } else {
            passwordEl.value = '';
          }
          if (publishDateEl) publishDateEl.value = workout.publish_date ? workout.publish_date.split('T')[0] : '';
        } else {
          passwordGroup.style.display = 'none';
          passwordEl.required = false;
          passwordEl.value = '';
          if (publishDateEl) publishDateEl.value = workout.publish_date ? workout.publish_date.split('T')[0] : '';
        }
      }
    } else {
      if (publishDateEl) publishDateEl.value = workout.publish_date ? workout.publish_date.split('T')[0] : '';
    }
    
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
      saveBtn.title = '수정 완료';
      saveBtn.setAttribute('aria-label', '수정 완료');
      saveBtn.onclick = performWorkoutUpdate;
    }
    
    const formTitle = document.querySelector('#workoutBuilderScreen .workout-builder-title');
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
  const passwordEl = safeGetElement('wbPassword');
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
  // 비공개 워크아웃인 경우 비밀번호 저장
  const password = (status !== '보이기' && passwordEl) ? (passwordEl.value || '').trim() : '';

  if (!title) {
    window.showToast('제목을 입력해주세요.');
    return;
  }

  if (!author) {
    window.showToast('카테고리를 선택해주세요.');
    return;
  }

  // 저장 중 UI 표시
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('btn-saving', 'saving-state');
    saveBtn.innerHTML = '<span class="saving-spinner"></span>수정 중...';
  }

  // 비공개 워크아웃인 경우 비밀번호 검증
  if (status !== '보이기' && !password) {
    window.showToast('비공개 워크아웃은 비밀번호를 입력해야 합니다.');
    if (passwordEl) {
      passwordEl.focus();
    }
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('btn-saving', 'saving-state');
      saveBtn.innerHTML = '수정 완료';
    }
    return;
  }

  try {
    // 1단계: 기본 정보 업데이트
    const workoutData = { title, description, author, status, publish_date: publishDate, password: password };
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
    saveBtn.title = '저장';
    saveBtn.setAttribute('aria-label', '저장');
    saveBtn.onclick = saveWorkout;
  }
  
  const formTitle = document.querySelector('#workoutBuilderScreen .workout-builder-title');
  if (formTitle) {
    formTitle.textContent = '워크아웃 작성';
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
  const expectedIntensityEl = safeGetElement('previewExpectedIntensity');
  const tssEl = safeGetElement('previewTSS');

  if (nameEl) nameEl.textContent = workout.title || '워크아웃';
  
  const totalMinutes = Math.round((workout.total_seconds || 0) / 60);
  if (durationEl) durationEl.textContent = `${totalMinutes}분`;

  let avgIntensity = 0;
  let totalDuration = 0;
  
  if (workout.segments && Array.isArray(workout.segments) && workout.segments.length > 0) {
    let weightedSum = 0;
    workout.segments.forEach(segment => {
      const duration = getSegmentDurationSec(segment);
      const intensity = typeof getSegmentFtpPercentForPreview === 'function'
        ? getSegmentFtpPercentForPreview(segment)
        : (Number(segment.target_value) || 0);
      weightedSum += duration * intensity;
      totalDuration += duration;
    });
    if (totalDuration > 0) {
      avgIntensity = Math.round(weightedSum / totalDuration);
    }
  }
  if (intensityEl) intensityEl.textContent = `${avgIntensity}%`;

  // === TSS — AI 워크아웃 추천과 동일한 예상 TSS 계산 로직 (가중 평균 IF) ===
  var estimatedTSS = estimateWorkoutTSS(workout);

  if (expectedIntensityEl) expectedIntensityEl.textContent = String(estimatedTSS);
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
  } else if (targetType === 'ftp_pctz') {
    // ftp_pctz 타입: "56/75" 형식 (하한, 상한)
    const targetValue = segment.target_value;
    let minPercent = 60;
    let maxPercent = 75;
    
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim());
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
    
    intensityText = `${minPercent}% FTP, ${maxPercent}% FTP`;
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
  const segmentFtpZoneMin = safeGetElement('segmentFtpZoneMin');
  const segmentFtpZoneMax = safeGetElement('segmentFtpZoneMax');
  
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
  } else if (targetType === 'ftp_pctz') {
    // ftp_pctz 타입: "56/75" 형식 (하한, 상한)
    const targetValue = segment.target_value;
    const segmentFtpZone = safeGetElement('segmentFtpZone');
    let minValue = 60;
    let maxValue = 75;
    
    if (typeof targetValue === 'string' && targetValue.includes('/')) {
      const parts = targetValue.split('/').map(s => s.trim());
      if (parts.length >= 2) {
        minValue = parseInt(parts[0]) || 60;
        maxValue = parseInt(parts[1]) || 75;
      } else {
        minValue = parseInt(parts[0]) || 60;
        maxValue = 75;
      }
    } else if (typeof targetValue === 'string' && targetValue.includes(',')) {
      // 기존 형식(쉼표)도 지원 (하위 호환성)
      const parts = targetValue.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        minValue = parseInt(parts[0]) || 60;
        maxValue = parseInt(parts[1]) || 75;
      } else {
        minValue = parseInt(parts[0]) || 60;
        maxValue = 75;
      }
    } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
      minValue = parseInt(targetValue[0]) || 60;
      maxValue = parseInt(targetValue[1]) || 75;
    }
    
    // 하한/상한 값 설정
    if (segmentFtpZoneMin) segmentFtpZoneMin.value = minValue;
    if (segmentFtpZoneMax) segmentFtpZoneMax.value = maxValue;
    
    // Zone 자동 선택 (하한/상한 값에 맞는 Zone 찾기)
    if (segmentFtpZone) {
      const zoneValues = {
        '1': { min: 40, max: 55 },
        '2': { min: 56, max: 75 },
        '3': { min: 76, max: 90 },
        '4': { min: 91, max: 105 },
        '5': { min: 106, max: 120 },
        '6': { min: 121, max: 150 },
        '7': { min: 151, max: 300 }
      };
      
      // 정확히 일치하는 Zone 찾기
      let matchedZone = '';
      for (const [zone, values] of Object.entries(zoneValues)) {
        if (minValue === values.min && maxValue === values.max) {
          matchedZone = zone;
          break;
        }
      }
      
      segmentFtpZone.value = matchedZone || '';
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
  const targetFtpZoneGroup = safeGetElement('targetFtpZoneGroup');
  const targetRpmGroup = safeGetElement('targetRpmGroup');
  const targetValueLabel = safeGetElement('targetValueLabel');
  const targetValueSuffix = safeGetElement('targetValueSuffix');
  const segmentIntensity = safeGetElement('segmentIntensity');
  const segmentFtpZoneMin = safeGetElement('segmentFtpZoneMin');
  const segmentFtpZoneMax = safeGetElement('segmentFtpZoneMax');
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
    if (targetFtpZoneGroup) targetFtpZoneGroup.classList.add('hidden');
    if (targetRpmGroup) targetRpmGroup.classList.add('hidden');
    
  } else if (type === 'ftp_pctz') {
    // %FTP Zone 타입
    if (targetValueGroup) targetValueGroup.style.display = 'none';
    if (targetFtpZoneGroup) {
      targetFtpZoneGroup.classList.remove('hidden');
      const segmentFtpZone = safeGetElement('segmentFtpZone');
      if (segmentFtpZoneMin) {
        segmentFtpZoneMin.min = '30';
        segmentFtpZoneMin.max = '300';
      }
      if (segmentFtpZoneMax) {
        segmentFtpZoneMax.min = '30';
        segmentFtpZoneMax.max = '300';
      }
      // Zone 콤보박스가 비어있으면 기본값 설정하지 않음 (사용자가 선택하도록)
    }
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
    if (targetFtpZoneGroup) targetFtpZoneGroup.classList.add('hidden');
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
    if (targetFtpZoneGroup) targetFtpZoneGroup.classList.add('hidden');
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
  const segmentFtpZoneMin = safeGetElement('segmentFtpZoneMin');
  const segmentFtpZoneMax = safeGetElement('segmentFtpZoneMax');
  const ftpZoneMin = segmentFtpZoneMin ? parseInt(segmentFtpZoneMin.value) || 60 : 60;
  const ftpZoneMax = segmentFtpZoneMax ? parseInt(segmentFtpZoneMax.value) || 75 : 75;
  
  if (targetType === 'ftp_pct') {
    if (intensity < 30 || intensity > 200) {
      window.showToast('목표 강도는 30-200% 범위여야 합니다.');
      return;
    }
    targetValue = intensity;
  } else if (targetType === 'ftp_pctz') {
    // %FTP Zone 타입: 하한과 상한 검증
    if (ftpZoneMin < 30 || ftpZoneMin > 200) {
      window.showToast('목표 하한 FTP%는 30-200% 범위여야 합니다.');
      return;
    }
    if (ftpZoneMax < 30 || ftpZoneMax > 200) {
      window.showToast('목표 상한 FTP%는 30-200% 범위여야 합니다.');
      return;
    }
    if (ftpZoneMin > ftpZoneMax) {
      window.showToast('목표 하한 FTP%는 상한 FTP%보다 클 수 없습니다.');
      return;
    }
    // ftp_pctz 타입: "56/75" 형식으로 저장 (하한, 상한)
    targetValue = `${ftpZoneMin}/${ftpZoneMax}`;
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
  const segmentFtpZoneMin = safeGetElement('segmentFtpZoneMin');
  const segmentFtpZoneMax = safeGetElement('segmentFtpZoneMax');
  const segmentRamp = safeGetElement('segmentRamp');
  const rampEndIntensity = safeGetElement('rampEndIntensity');
  
  if (!segmentLabel || !segmentType || !segmentMinutes || !segmentSeconds || !segmentTargetType) {
    window.showToast('세그먼트 폼 요소를 찾을 수 없습니다.');
    return;
  }
  
  const label = segmentLabel.value.trim();
  const type = segmentType.value;
  const minutes = parseInt(segmentMinutes.value) || 0;
  const seconds = parseInt(segmentSeconds.value) || 0;
  const targetType = segmentTargetType.value || 'ftp_pct';
  const intensity = segmentIntensity ? parseInt(segmentIntensity.value) || (targetType === 'cadence_rpm' ? 90 : 100) : 100;
  const targetRpm = segmentTargetRpm ? parseInt(segmentTargetRpm.value) || 90 : 90;
  const ftpZoneMin = segmentFtpZoneMin ? parseInt(segmentFtpZoneMin.value) || 60 : 60;
  const ftpZoneMax = segmentFtpZoneMax ? parseInt(segmentFtpZoneMax.value) || 75 : 75;
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
  } else if (targetType === 'ftp_pctz') {
    // %FTP Zone 타입: 하한과 상한 검증
    if (ftpZoneMin < 30 || ftpZoneMin > 200) {
      window.showToast('목표 하한 FTP%는 30-200% 범위여야 합니다.');
      return;
    }
    if (ftpZoneMax < 30 || ftpZoneMax > 200) {
      window.showToast('목표 상한 FTP%는 30-200% 범위여야 합니다.');
      return;
    }
    if (ftpZoneMin > ftpZoneMax) {
      window.showToast('목표 하한 FTP%는 상한 FTP%보다 클 수 없습니다.');
      return;
    }
    // ftp_pctz 타입: "56/75" 형식으로 저장 (하한, 상한)
    targetValue = `${ftpZoneMin}/${ftpZoneMax}`;
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
  
  // btnOpenBuilder: 검색 블록에서 제거됨, 새 워크아웃은 헤더 workoutScreenNewBtn으로 대체
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
// SegmentedWorkoutGraph - 세그먼트 막대 그래프 컴포넌트
// 워크아웃 데이터를 MyWhoosh 스타일 막대 그래프로 시각화
// ==========================================================

/** FTP% → Zone 1~7 매핑 (Zone 7이 가장 높음) */
const ZONE_FTP_BOUNDS = [
  { min: 0, max: 55, zone: 1 },   // Zone 1: Active Recovery
  { min: 56, max: 75, zone: 2 },  // Zone 2: Endurance
  { min: 76, max: 90, zone: 3 },  // Zone 3: Tempo
  { min: 91, max: 105, zone: 4 }, // Zone 4: Threshold
  { min: 106, max: 120, zone: 5 },// Zone 5: VO2max
  { min: 121, max: 150, zone: 6 },// Zone 6
  { min: 151, max: 300, zone: 7 } // Zone 7
];

/**
 * Zone/색상 결정용 FTP% 추출 (훈련 준비 화면 drawSegmentGraph와 동일)
 * ftp_pctz: 하한값 사용, dual: FTP% 부분, cadence_rpm: 0
 */
function getSegmentFtpPercentForZone(seg) {
  if (!seg) return 0;
  const targetType = seg.target_type || 'ftp_pct';
  if (targetType === 'ftp_pct') {
    return Number(seg.target_value) || 100;
  }
  if (targetType === 'dual') {
    const tv = seg.target_value;
    if (typeof tv === 'string' && tv.includes('/')) {
      const p = tv.split('/').map(s => s.trim());
      return Number(p[0]) || 100;
    }
    if (Array.isArray(tv) && tv.length > 0) return Number(tv[0]) || 100;
    return 100;
  }
  if (targetType === 'cadence_rpm') return 0;
  if (targetType === 'ftp_pctz') {
    const tv = seg.target_value;
    let minPercent = 60;
    if (typeof tv === 'string') {
      const parts = (tv.includes('/') ? tv.split('/') : tv.split(',')).map(s => s.trim());
      minPercent = Number(parts[0]) || 60;
    } else if (Array.isArray(tv) && tv.length > 0) {
      minPercent = Number(tv[0]) || 60;
    }
    return minPercent;
  }
  return getSegmentFtpPercentForPreview(seg);
}

function getSegmentZoneFromFtpPercent(seg) {
  if (!seg) return 1;
  const segType = (seg.segment_type || '').toLowerCase();
  if (segType === 'rest' || segType === 'recovery') return 1;
  if (segType === 'warmup' || segType === 'cooldown') {
    const pct = getSegmentFtpPercentForZone(seg);
    return pct < 56 ? 1 : (pct < 76 ? 2 : 3);
  }
  const targetType = seg.target_type || 'ftp_pct';
  if (targetType === 'cadence_rpm') return 1;
  const ftpPercent = getSegmentFtpPercentForZone(seg);
  return getZoneFromFtpPercentValue(ftpPercent);
}

/**
 * FTP% 수치 → Zone 1~7 (훈련 준비 화면과 동일한 ZONE_FTP_BOUNDS 사용)
 * 막대 높이 계산용으로 사용 (ftp_pctz는 상한 기준 높이 적용)
 */
function getZoneFromFtpPercentValue(ftpPercent) {
  if (ftpPercent == null || isNaN(ftpPercent)) return 1;
  const pct = Number(ftpPercent);
  for (let i = ZONE_FTP_BOUNDS.length - 1; i >= 0; i--) {
    if (pct >= ZONE_FTP_BOUNDS[i].min && pct <= ZONE_FTP_BOUNDS[i].max) {
      return ZONE_FTP_BOUNDS[i].zone;
    }
  }
  return pct < 56 ? 1 : 7;
}

/**
 * 막대 높이 계산용 FTP% (훈련 준비 화면 로직 반영)
 * ftp_pctz: 상한값 사용(막대는 상한까지 표시), dual/ftp_pct: 기존과 동일, cadence_rpm: 0
 */
function getSegmentFtpPercentForBarHeight(seg) {
  if (!seg) return 0;
  const targetType = seg.target_type || 'ftp_pct';
  if (targetType === 'ftp_pct') {
    return Number(seg.target_value) || 100;
  }
  if (targetType === 'dual') {
    const tv = seg.target_value;
    if (typeof tv === 'string' && tv.includes('/')) {
      const p = tv.split('/').map(s => s.trim());
      return Number(p[0]) || 100;
    }
    if (Array.isArray(tv) && tv.length > 0) return Number(tv[0]) || 100;
    return 100;
  }
  if (targetType === 'cadence_rpm') return 0;
  if (targetType === 'ftp_pctz') {
    const tv = seg.target_value;
    let maxPercent = 75;
    if (typeof tv === 'string') {
      const parts = (tv.includes('/') ? tv.split('/') : tv.split(',')).map(s => s.trim());
      maxPercent = parts.length >= 2 ? (Number(parts[1]) || 75) : (Number(parts[0]) || 75);
    } else if (Array.isArray(tv) && tv.length >= 2) {
      maxPercent = Number(tv[1]) || 75;
    } else if (Array.isArray(tv) && tv.length === 1) {
      maxPercent = Number(tv[0]) || 75;
    }
    return maxPercent;
  }
  return getSegmentFtpPercentForZone(seg);
}

/**
 * SegmentedWorkoutGraph 렌더
 * @param {HTMLElement|string} container - 컨테이너 요소 또는 ID
 * @param {Array} segments - 세그먼트 배열 [{duration_sec, target_type, target_value, segment_type}]
 * @param {Object} options - { maxHeight: 120, ftp: 200, classPrefix: 'swg' }
 */
function renderSegmentedWorkoutGraph(container, segments, options) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return;
  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    el.innerHTML = '<div class="segmented-workout-graph-empty">세그먼트가 없습니다</div>';
    return;
  }
  const opts = options || {};
  const maxHeight = opts.maxHeight || 120;
  const totalSeconds = segments.reduce((s, seg) => s + (seg.duration_sec || seg.duration || 0), 0);
  if (totalSeconds <= 0) {
    el.innerHTML = '<div class="segmented-workout-graph-empty">유효한 세그먼트가 없습니다</div>';
    return;
  }
  const prefix = opts.classPrefix || 'swg';
  const RPM_BASELINE = 90;
  function getRpmFromSegment(seg) {
    const r = getSegmentRpmForPreview(seg);
    if (r > 0) return r;
    if (seg.target_type === 'cadence_rpm') return Number(seg.target_value) || 0;
    return 0;
  }
  
  // 세그먼트 데이터 생성
  const bars = segments.map(seg => {
    const duration = seg.duration_sec || seg.duration || 0;
    if (duration <= 0) return null;
    const targetType = seg.target_type || 'ftp_pct';
    const zone = getSegmentZoneFromFtpPercent(seg);
    const flexGrow = duration;
    let heightPercent;
    let isCadence = false;
    let isDual = false;
    let cadenceRpm = 0;
    let cadenceLineBottom = 0;
    if (targetType === 'cadence_rpm') {
      isCadence = true;
      cadenceRpm = getRpmFromSegment(seg);
      cadenceLineBottom = 50;
      heightPercent = 100;
    } else if (targetType === 'dual') {
      isDual = true;
      cadenceRpm = getRpmFromSegment(seg);
      cadenceLineBottom = 100; /* dual: RPM 바를 FTP 막대 상단 끝에 맞춤 */
      const ftpForHeight = getSegmentFtpPercentForBarHeight(seg);
      const zoneForHeight = getZoneFromFtpPercentValue(ftpForHeight);
      heightPercent = Math.max(15, (zoneForHeight / 7) * 100);
    } else {
      const ftpForHeight = getSegmentFtpPercentForBarHeight(seg);
      const zoneForHeight = getZoneFromFtpPercentValue(ftpForHeight);
      heightPercent = Math.max(15, (zoneForHeight / 7) * 100);
    }
    const cadenceClass = isCadence ? ' segmented-workout-graph__bar--cadence' : '';
    return { duration, zone, flexGrow, heightPercent, cadenceClass, isCadence, isDual, cadenceRpm, cadenceLineBottom };
  }).filter(Boolean);
  
  // RPM 값 표시 여부: rpm 바 너비 vs rpm 숫자폭 기준
  // 1) rpm 바 길이 > rpm 값 숫자폭 → 표시
  // 2) 작은 rpm 바 여러 개인 경우: (rpm 바 길이 + rpm 바 사이 폭/2) > rpm 값 숫자폭 → 표시
  const totalFlexGrow = bars.reduce((sum, b) => sum + b.flexGrow, 0);
  const RPM_TEXT_WIDTH_PERCENT = 8;   // rpm 숫자폭에 해당하는 그래프 대비 % (2~3자리, 10px 폰트 기준)
  const HALF_GAP_PERCENT = 0.5;        // rpm 바 사이 폭의 절반 (%)
  
  bars.forEach((bar) => {
    const widthPercent = totalFlexGrow > 0 ? (bar.flexGrow / totalFlexGrow) * 100 : 0;
    const hasCadence = bar.isCadence || (bar.isDual && bar.cadenceRpm > 0);
    
    if (hasCadence) {
      // 조건1: 바 길이 >= 숫자폭 → 표시
      // 조건2: (바 길이 + 바 사이 폭/2) >= 숫자폭 → 표시 (effectiveWidth = widthPercent + HALF_GAP_PERCENT)
      const effectiveWidth = widthPercent + HALF_GAP_PERCENT;
      bar.showRpmValue = effectiveWidth >= RPM_TEXT_WIDTH_PERCENT;
    } else {
      bar.showRpmValue = false;
    }
  });
  
  el.innerHTML = `
    <div class="segmented-workout-graph" role="img" aria-label="워크아웃 세그먼트 그래프">
      <div class="segmented-workout-graph__bars">
        ${bars.map(b => {
          if (b.isCadence) {
            return `
          <div class="segmented-workout-graph__bar segmented-workout-graph__bar--cadence" style="flex: ${b.flexGrow} 1 0; --bar-height: 100%; --cadence-line-bottom: ${b.cadenceLineBottom}%;" title="RPM ${b.cadenceRpm} · ${Math.round(b.duration)}초">
            <div class="segmented-workout-graph__cadence-line"></div>
            ${(b.cadenceRpm > 0 && b.showRpmValue) ? `<span class="segmented-workout-graph__cadence-value">${b.cadenceRpm}</span>` : ''}
          </div>`;
          }
          if (b.isDual && b.cadenceRpm > 0) {
            return `
          <div class="segmented-workout-graph__bar segmented-workout-graph__bar--zone-${b.zone} segmented-workout-graph__bar--dual" style="flex: ${b.flexGrow} 1 0; --bar-height: ${b.heightPercent}%; --cadence-line-bottom: ${b.cadenceLineBottom}%;" title="Zone ${b.zone} · RPM ${b.cadenceRpm} · ${Math.round(b.duration)}초">
            <div class="segmented-workout-graph__cadence-line segmented-workout-graph__cadence-line--dual"></div>
            ${b.showRpmValue ? `<span class="segmented-workout-graph__cadence-value segmented-workout-graph__cadence-value--dual">${b.cadenceRpm}</span>` : ''}
          </div>`;
          }
          return `
          <div class="segmented-workout-graph__bar segmented-workout-graph__bar--zone-${b.zone}" style="flex: ${b.flexGrow} 1 0; --bar-height: ${b.heightPercent}%;" title="Zone ${b.zone} · ${Math.round(b.duration)}초"></div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// 전역 노출
window.renderSegmentedWorkoutGraph = renderSegmentedWorkoutGraph;
window.getSegmentZoneFromFtpPercent = getSegmentZoneFromFtpPercent;
window.getWorkoutDominantZone = getWorkoutDominantZone;
window.getWorkoutCategoryId = getWorkoutCategoryId;
window.estimateWorkoutTSS = estimateWorkoutTSS;
window.getSegmentFtpPercentForPreview = getSegmentFtpPercentForPreview;

// ==========================================================
// 전역 함수로 내보내기
// ==========================================================

// 워크아웃 관리
window.loadWorkouts = loadWorkouts;
window.clearWorkoutCache = clearWorkoutCache;
window.getWorkoutCache = getWorkoutCache;
window.setWorkoutCache = setWorkoutCache;
window.searchWorkouts = searchWorkouts;
window.handleWorkoutCardClick = handleWorkoutCardClick;
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

// Zone 선택 시 하한/상한 FTP% 값 자동 입력
function updateFtpZoneValues() {
  const segmentFtpZone = safeGetElement('segmentFtpZone');
  const segmentFtpZoneMin = safeGetElement('segmentFtpZoneMin');
  const segmentFtpZoneMax = safeGetElement('segmentFtpZoneMax');
  
  if (!segmentFtpZone || !segmentFtpZoneMin || !segmentFtpZoneMax) return;
  
  const zoneValue = segmentFtpZone.value;
  
  // Zone별 하한/상한 값 매핑
  const zoneValues = {
    '1': { min: 40, max: 55 },
    '2': { min: 56, max: 75 },
    '3': { min: 76, max: 90 },
    '4': { min: 91, max: 105 },
    '5': { min: 106, max: 120 },
    '6': { min: 121, max: 150 },
    '7': { min: 151, max: 300 }
  };
  
  if (zoneValue && zoneValues[zoneValue]) {
    const values = zoneValues[zoneValue];
    segmentFtpZoneMin.value = values.min;
    segmentFtpZoneMax.value = values.max;
  }
}

window.updateFtpZoneValues = updateFtpZoneValues;
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
