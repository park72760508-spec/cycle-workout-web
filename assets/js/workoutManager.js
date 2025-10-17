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

// 데이터 검증 헬퍼 함수들
function validateWorkoutData(workout) {
  if (!workout || typeof workout !== 'object') {
    return false;
  }
  if (workout.id === null || workout.id === undefined) {
    return false;
  }
  return true;
}

function normalizeWorkoutData(workout) {
  return {
    id: workout.id,
    title: String(workout.title || '제목 없음'),
    description: String(workout.description || ''),
    author: String(workout.author || '미상'),
    status: String(workout.status || '보이기'),
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
    console.error('GAS_URL이 설정되지 않았습니다.');
    console.log('CONFIG:', window.CONFIG);
    window.GAS_URL = window.CONFIG?.GAS_WEB_APP_URL || '';
    
    if (!window.GAS_URL) {
      console.error('CONFIG에서도 GAS_URL을 찾을 수 없습니다.');
      window.GAS_URL = '';
      return;
    }
  }
  
  console.log('GAS_URL 설정됨:', window.GAS_URL);
  
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
    
    const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const script = document.createElement('script');
    let isResolved = false;
    
    console.log('JSONP request to:', url, 'with params:', params);
    
    window[callbackName] = function(data) {
      if (isResolved) return;
      isResolved = true;
      
      console.log('JSONP response received:', data);
      cleanup();
      resolve(data);
    };
    
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
      const urlParams = new URLSearchParams();
      Object.keys(params).forEach(key => {
        if (params[key] !== null && params[key] !== undefined) {
          urlParams.set(key, String(params[key]));
        }
      });
      urlParams.set('callback', callbackName);
      
      const finalUrl = `${url}?${urlParams.toString()}`;
      
      if (finalUrl.length > 2000) {
        throw new Error('요청 URL이 너무 깁니다. 데이터를 줄여주세요.');
      }
      
      console.log('Final JSONP URL length:', finalUrl.length);
      
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
  
  return `
    <div class="segment-item ${segmentTypeClass}">
      <h4>${escapeHtml(segment.label || '세그먼트')}</h4>
      <div class="ftp-percent">${Number(segment.target_value) || 0}%</div>
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
       // 60초 미만일 경우 초단위로 표시
       duration = `${totalSeconds}s`;
     } else if (seconds > 0) {
       // 분과 초가 모두 있을 경우
       duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
     } else {
       // 정확히 분 단위일 경우
       duration = `${minutes}분`;
     }
     
     return `FTP ${segment.target_value}% ${duration}`;
   }).join(' '); // <br> 대신 공백으로 1줄 표기
  
  const mainSegmentTypeClass = getSegmentTypeClass(pattern[0].segment_type);
  
  return `
    <div class="segment-item grouped-segment ${mainSegmentTypeClass}">
      <div class="group-header">
        <h4>${escapeHtml(groupLabel)}</h4>
        <span class="repeat-badge">× ${repeatCount}회</span>
      </div>
      <div class="group-pattern">
        ${patternInfo}
      </div>
      <div class="group-total">
        <strong>${totalMinutes}분</strong>
      </div>
    </div>
  `;
}

/**
 * 개선된 세그먼트 프리뷰 업데이트 (그룹화 적용)
 */
function updateSegmentPreviewGrouped(segments) {
  const segDiv = safeGetElement('segmentPreview');
  if (!segDiv) return;

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    segDiv.innerHTML = '<div class="text-center muted">세그먼트 정보가 없습니다.</div>';
    return;
  }

  const groupedSegments = detectAndGroupSegments(segments);
  
  segDiv.innerHTML = groupedSegments.map(item => {
    if (item.type === 'single') {
      return createSingleSegmentPreview(item.segment);
    } else {
      return createGroupedSegmentPreview(item);
    }
  }).filter(Boolean).join('');
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
    return await jsonpRequest(window.GAS_URL, { action: 'listWorkouts' });
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
    const segments = workoutData.segments || [];
    if (segments.length > 0) {
      console.log(`2단계: ${segments.length}개 세그먼트를 배치별로 추가 중...`);
      
      const addResult = await addSegmentsBatch(workoutId, segments);
      
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
  const batchSize = segments.length > 50 ? 3 : 2;
  const batchDelay = segments.length > 50 ? 1500 : 1000;
  const maxRetries = 3;
  
  console.log(`처리 설정: 배치크기 ${batchSize}, 지연 ${batchDelay}ms`);
  
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
            l: String(seg.label || '세그먼트').substring(0, 12),
            t: seg.segment_type || 'interval',
            d: parseInt(seg.duration_sec) || 300,
            v: parseInt(seg.target_value) || 100,
            r: seg.ramp === 'linear' ? 1 : 0,
            rv: seg.ramp === 'linear' ? parseInt(seg.ramp_to_value) || null : null
          }));
          
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
    console.log('Raw workouts received:', rawWorkouts);
    
    const validWorkouts = rawWorkouts
      .filter(validateWorkoutData)
      .map(normalizeWorkoutData);
    
    console.log('Normalized workouts:', validWorkouts);
    
    if (validWorkouts.length === 0) {
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

    workoutList.innerHTML = validWorkouts.map(workout => {
      if (!workout || typeof workout !== 'object' || !workout.id) {
        return '';
      }
      
      const safeTitle = String(workout.title || '제목 없음');
      const safeDescription = String(workout.description || '');
      const safeAuthor = String(workout.author || '미상');
      
      const totalMinutes = Math.round((workout.total_seconds || 0) / 60);
      const statusBadge = workout.status === '보이기' ? 
        '<span class="status-badge visible">공개</span>' : 
        '<span class="status-badge hidden">비공개</span>';
      
      return `
        <div class="workout-card" data-workout-id="${workout.id}">
          <div class="workout-header">
            <div class="workout-title">${escapeHtml(safeTitle)}</div>
            <div class="workout-actions">
              <button class="btn-edit" onclick="editWorkout(${workout.id})" title="수정">✏️</button>
              <button class="btn-delete" onclick="deleteWorkout(${workout.id})" title="삭제">🗑️</button>
            </div>
          </div>
          <div class="workout-details">
            <div class="workout-meta">
              <span class="author">작성자: ${escapeHtml(safeAuthor)}</span>
              <span class="duration">${totalMinutes}분</span>
              ${statusBadge}
            </div>
            <div class="workout-description">${escapeHtml(safeDescription)}</div>
            ${workout.publish_date ? `<div class="publish-date">게시일: ${new Date(workout.publish_date).toLocaleDateString()}</div>` : ''}
          </div>
          <button class="btn btn-primary" id="selectWorkoutBtn-${workout.id}" onclick="selectWorkout(${workout.id})">선택</button>
        </div>
      `;
    }).filter(Boolean).join('');

    window.workouts = validWorkouts;
    window.showToast(`${validWorkouts.length}개의 워크아웃을 불러왔습니다.`);
    
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
    window.showScreen('trainingReadyScreen');
    
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
    ).map(segment => ({
      label: String(segment.label || '세그먼트'),
      segment_type: String(segment.segment_type || 'interval'),
      duration_sec: Number(segment.duration_sec) || 300,
      target_type: String(segment.target_type || 'ftp_percent'),
      target_value: Number(segment.target_value) || 100,
      ramp: String(segment.ramp || 'none'),
      ramp_to_value: segment.ramp !== 'none' ? Number(segment.ramp_to_value) || null : null
    }));

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
    
    isWorkoutEditMode = true;
    currentEditWorkoutId = workoutId;
    console.log('Edit mode activated for workout:', workoutId);
    
    showAddWorkoutForm(false);
    
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
    
    const saveBtn = safeGetElement('btnSaveWorkout');
    if (saveBtn) {
      saveBtn.textContent = '수정';
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

  try {
    const workoutData = { title, description, author, status, publish_date: publishDate };
    console.log('Updating workout:', currentEditWorkoutId, 'with data:', workoutData);
    
    const result = await apiUpdateWorkout(currentEditWorkoutId, workoutData);
    
    if (result && result.success) {
      window.showToast('워크아웃 정보가 수정되었습니다.');
      resetWorkoutFormMode();
      loadWorkouts();
    } else {
      window.showToast('워크아웃 수정 실패: ' + (result?.error || '알 수 없는 오류'));
    }
    
  } catch (error) {
    console.error('워크아웃 업데이트 실패:', error);
    window.showToast('워크아웃 수정 중 오류가 발생했습니다.');
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

  const estimatedTSS = Math.round((totalMinutes * avgIntensity * avgIntensity) / 10000);
  if (tssEl) tssEl.textContent = String(estimatedTSS);

  // 그룹화된 세그먼트 프리뷰 사용
  updateSegmentPreviewGrouped(workout.segments || []);
}

// ==========================================================
// 최적화된 세그먼트 렌더링 (40개+ 세그먼트 대응)
// ==========================================================

function renderSegments() {
  const container = safeGetElement('wbSegments');
  const emptyState = safeGetElement('segmentsEmpty');
  
  if (!container) return;
  
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
  
  const intensityText = segment.ramp !== 'none' 
    ? `${segment.target_value}% → ${segment.ramp_to_value}%`
    : `${segment.target_value}%`;
  
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
  
  if (modalTitle) modalTitle.textContent = '새 세그먼트 추가';
  if (segmentLabel) segmentLabel.value = '';
  if (segmentType) segmentType.value = 'interval';
  if (segmentMinutes) segmentMinutes.value = '5';
  if (segmentSeconds) segmentSeconds.value = '0';
  if (segmentIntensity) segmentIntensity.value = '100';
  if (segmentRamp) segmentRamp.checked = false;
  if (rampEndIntensity) rampEndIntensity.value = '120';
  
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
  
  if (segmentIntensity) segmentIntensity.value = segment.target_value || 100;
  
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
  const segmentRamp = safeGetElement('segmentRamp');
  const rampEndIntensity = safeGetElement('rampEndIntensity');
  
  if (!segmentLabel || !segmentType || !segmentMinutes || !segmentSeconds || !segmentIntensity) {
    window.showToast('세그먼트 폼 요소를 찾을 수 없습니다.');
    return;
  }
  
  const label = segmentLabel.value.trim();
  const type = segmentType.value;
  const minutes = parseInt(segmentMinutes.value) || 0;
  const seconds = parseInt(segmentSeconds.value) || 0;
  const intensity = parseInt(segmentIntensity.value) || 100;
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
  
  if (intensity < 30 || intensity > 200) {
    window.showToast('목표 강도는 30-200% 범위여야 합니다.');
    return;
  }
  
  const segment = {
    id: currentEditingSegmentIndex !== null ? workoutSegments[currentEditingSegmentIndex].id : Date.now(),
    label: label,
    segment_type: type,
    duration_sec: totalSeconds,
    target_type: 'ftp_percent',
    target_value: intensity,
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
            ${segment.segment_type} · ${duration} · ${segment.target_value}% FTP
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
  
  if (modalTitle) modalTitle.textContent = '반복 세그먼트 편집';
  if (segmentLabel) segmentLabel.value = segment.label || '';
  if (segmentType) segmentType.value = segment.segment_type || 'interval';
  
  const minutes = Math.floor((segment.duration_sec || 0) / 60);
  const seconds = (segment.duration_sec || 0) % 60;
  if (segmentMinutes) segmentMinutes.value = minutes;
  if (segmentSeconds) segmentSeconds.value = seconds;
  
  if (segmentIntensity) segmentIntensity.value = segment.target_value || 100;
  
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
  const segmentRamp = safeGetElement('segmentRamp');
  const rampEndIntensity = safeGetElement('rampEndIntensity');
  
  if (!segmentLabel || !segmentType || !segmentMinutes || !segmentSeconds || !segmentIntensity) {
    window.showToast('세그먼트 폼 요소를 찾을 수 없습니다.');
    return;
  }
  
  const label = segmentLabel.value.trim();
  const type = segmentType.value;
  const minutes = parseInt(segmentMinutes.value) || 0;
  const seconds = parseInt(segmentSeconds.value) || 0;
  const intensity = parseInt(segmentIntensity.value) || 100;
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
  
  if (intensity < 30 || intensity > 200) {
    window.showToast('목표 강도는 30-200% 범위여야 합니다.');
    return;
  }
  
  if (currentEditingRepeatIndex !== null && repeatSegments[currentEditingRepeatIndex]) {
    repeatSegments[currentEditingRepeatIndex] = {
      id: repeatSegments[currentEditingRepeatIndex].id,
      label: label,
      segment_type: type,
      duration_sec: totalSeconds,
      target_type: 'ftp_percent',
      target_value: intensity,
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
});

// ==========================================================
// 전역 함수로 내보내기
// ==========================================================

// 워크아웃 관리
window.loadWorkouts = loadWorkouts;
window.selectWorkout = selectWorkout;
window.editWorkout = editWorkout;
window.deleteWorkout = deleteWorkout;
window.saveWorkout = saveWorkout;
window.updateWorkoutPreview = updateWorkoutPreview;
window.showAddWorkoutForm = showAddWorkoutForm;
window.resetWorkoutFormMode = resetWorkoutFormMode;
window.performWorkoutUpdate = performWorkoutUpdate;

// 세그먼트 관리
window.addQuickSegment = addQuickSegment;
window.showAddSegmentModal = showAddSegmentModal;
window.showEditSegmentModal = showEditSegmentModal;
window.deleteSegment = deleteSegment;
window.saveSegment = saveSegment;
window.closeSegmentModal = closeSegmentModal;
window.deleteCurrentSegment = deleteCurrentSegment;
window.toggleRampSettings = toggleRampSettings;
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
