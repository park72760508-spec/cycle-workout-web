/* ==========================================================
   workoutManager.js - 실제 스키마 기반 최종 구현
   실제 Google Apps Script URL과 스키마에 맞춰 구현
========================================================== */

// 실제 GAS URL 사용 (현재 코드에서 가져옴)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwp6v4zwoRi0qQekKQZr4bCs8s2wUolHtLNKgq_uX8pIHck1XllibKgzCZ64w6Z7Wrw/exec';

// 표준 세그먼트 타입 정의 (스키마 문서와 동일)
const SEGMENT_TYPES = {
  warmup: { label: '워밍업', color: '#22c55e', typical_ftp: [40, 70] },
  endurance: { label: '지구력', color: '#38bdf8', typical_ftp: [56, 75] },
  tempo: { label: '템포', color: '#3b82f6', typical_ftp: [76, 90] },
  sweetspot: { label: '스윗스팟', color: '#8b5cf6', typical_ftp: [88, 94] },
  threshold: { label: '임계', color: '#dc2626', typical_ftp: [95, 105] },
  interval: { label: '인터벌', color: '#ef4444', typical_ftp: [106, 130] },
  over_under: { label: '오버/언더', color: '#f97316', typical_ftp: [90, 105] },
  rest: { label: '휴식', color: '#eab308', typical_ftp: [40, 60] },
  cooldown: { label: '쿨다운', color: '#6b7280', typical_ftp: [40, 60] },
  cadence_drill: { label: '케이던스드릴', color: '#06b6d4', typical_ftp: [70, 90] },
  sprint: { label: '스프린트', color: '#ec4899', typical_ftp: [200, 400] },
  test: { label: '테스트', color: '#1e40af', typical_ftp: [50, 120] },
  free_ride: { label: '프리라이드', color: '#64748b', typical_ftp: [60, 80] }
};

const TARGET_TYPES = [
  { value: 'ftp_percent', label: 'FTP %' },
  { value: 'watts', label: 'Watts' },
  { value: 'cadence', label: 'Cadence (RPM)' },
  { value: 'heart_rate', label: 'Heart Rate (BPM)' }
];

const RAMP_TYPES = [
  { value: 'none', label: '없음' },
  { value: 'linear', label: '선형' }
];

// API 호출 함수들
async function apiRequest(method, action, data = {}) {
  try {
    let url = `${GAS_URL}?action=${action}`;
    let options = {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (method === 'GET' && Object.keys(data).length > 0) {
      const params = new URLSearchParams(data);
      url += `&${params.toString()}`;
    } else if (method === 'POST' && Object.keys(data).length > 0) {
      options.body = JSON.stringify(data);
    }
    
    console.log(`${method} 요청:`, url, data);
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log(`${method} 응답:`, result);
    
    return result;
  } catch (error) {
    console.error(`${method} 요청 실패:`, error);
    throw error;
  }
}

// 연결 테스트
async function testGASConnection() {
  try {
    console.log('Google Apps Script 연결 테스트 시작...');
    showToast('Google Sheets 연결 테스트 중...');
    
    const result = await apiRequest('GET', 'test');
    
    if (result.success) {
      showToast('Google Sheets 연결 성공!');
      console.log('스키마 버전:', result.schema_version);
      console.log('시트 ID:', result.sheet_id);
      return true;
    } else {
      throw new Error(result.error || '알 수 없는 오류');
    }
  } catch (error) {
    console.error('연결 실패:', error);
    showToast('Google Sheets 연결 실패: ' + error.message);
    return false;
  }
}

/* ==========================================================
   워크아웃 관련 함수들
========================================================== */

// 워크아웃 목록 로드
window.loadWorkouts = async function() {
  try {
    showToast('워크아웃을 불러오는 중...');
    
    const result = await apiRequest('GET', 'listWorkouts');
    
    if (!result.success) {
      throw new Error(result.error || '워크아웃 목록 조회 실패');
    }
    
    displayWorkouts(result.items || []);
    console.log('워크아웃 목록 로드 완료:', result.count || 0, '개');
    
  } catch (error) {
    console.error('워크아웃 로드 실패:', error);
    showToast('워크아웃을 불러올 수 없습니다: ' + error.message);
    displayWorkouts([]);
  }
};

// 워크아웃 목록 표시
window.displayWorkouts = function(workouts) {
  const list = document.getElementById('workoutList');
  if (!list) return;
  
  list.innerHTML = '';
  
  if (!workouts || workouts.length === 0) {
    list.innerHTML = `
      <div class="card text-center">
        <p class="muted">저장된 워크아웃이 없습니다.</p>
        <button class="btn btn-success mt-10" onclick="openBuilderForCreate()">첫 워크아웃 만들기</button>
      </div>
    `;
    return;
  }
  
  workouts.forEach(workout => {
    const card = document.createElement('div');
    card.className = 'card workout-card';
    
    const duration = Math.round((workout.total_seconds || 0) / 60);
    const createdDate = workout.created_at ? new Date(workout.created_at).toLocaleDateString() : '';
    const segmentCount = workout.segments ? workout.segments.length : 0;
    
    // 세그먼트 미리보기 생성
    let segmentPreview = '';
    if (workout.segments && workout.segments.length > 0) {
      const previewSegments = workout.segments.slice(0, 3);
      segmentPreview = previewSegments.map(seg => {
        const typeInfo = SEGMENT_TYPES[seg.segment_type] || SEGMENT_TYPES.interval;
        return `<span class="segment-tag" style="background-color: ${typeInfo.color}20; color: ${typeInfo.color};">${typeInfo.label}</span>`;
      }).join(' ');
      
      if (workout.segments.length > 3) {
        segmentPreview += ` <span class="muted">+${workout.segments.length - 3}개</span>`;
      }
    }
    
    card.innerHTML = `
      <div class="workout-header">
        <div class="workout-title">${workout.title || '(무제)'}</div>
        <div class="workout-duration">${duration}분 · ${segmentCount}개 구간</div>
      </div>
      <div class="muted" style="margin:6px 0;">
        ${workout.author || ''} ${createdDate ? '· ' + createdDate : ''}
      </div>
      ${workout.description ? `<div class="workout-description" style="margin:6px 0; font-size:14px;">${workout.description}</div>` : ''}
      <div class="segment-preview" style="margin:8px 0;">${segmentPreview}</div>
      <div class="btn-row">
        <button class="btn" onclick="editWorkout('${workout.id}')">수정</button>
        <button class="btn btn-secondary" onclick="deleteWorkout('${workout.id}')">삭제</button>
        <button class="btn btn-success" onclick="selectWorkout('${workout.id}')">선택</button>
      </div>
    `;
    
    list.appendChild(card);
  });
};

// 워크아웃 선택
window.selectWorkout = async function(id) {
  try {
    showToast('워크아웃을 불러오는 중...');
    
    const result = await apiRequest('GET', 'getWorkout', { id });
    
    if (!result.success) {
      throw new Error(result.error || '워크아웃 조회 실패');
    }
    
    if (result.item) {
      window.currentWorkout = convertApiWorkout(result.item);
      localStorage.setItem('currentWorkout', JSON.stringify(window.currentWorkout));
      
      showToast('워크아웃이 선택되었습니다');
      window.showScreen('trainingReadyScreen');
      
      // 미리보기 업데이트
      updateWorkoutPreview(window.currentWorkout);
    }
    
  } catch (error) {
    console.error('워크아웃 선택 실패:', error);
    showToast('워크아웃을 불러올 수 없습니다: ' + error.message);
  }
};

// 워크아웃 삭제
window.deleteWorkout = async function(id) {
  if (!confirm('이 워크아웃을 삭제할까요?')) return;
  
  try {
    showToast('삭제 중...');
    
    const result = await apiRequest('POST', 'deleteWorkout', { id });
    
    if (result.success) {
      showToast('워크아웃이 삭제되었습니다');
      loadWorkouts(); // 목록 새로고침
    } else {
      throw new Error(result.error || '삭제 실패');
    }
    
  } catch (error) {
    console.error('워크아웃 삭제 실패:', error);
    showToast('삭제 실패: ' + error.message);
  }
};

// 워크아웃 검색
window.searchWorkouts = async function() {
  try {
    const query = document.getElementById('qWorkout')?.value?.trim() || '';
    
    showToast('검색 중...');
    
    const result = await apiRequest('GET', 'searchWorkouts', { q: query });
    
    if (result.success) {
      displayWorkouts(result.items || []);
      
      if (query) {
        showToast(`"${query}" 검색 결과: ${result.count || 0}개`);
      }
    } else {
      throw new Error(result.error || '검색 실패');
    }
    
  } catch (error) {
    console.error('워크아웃 검색 실패:', error);
    showToast('검색 실패: ' + error.message);
  }
};

/* ==========================================================
   워크아웃 빌더 관련
========================================================== */

let __builderEditingId = null;

// 새 워크아웃 작성
function openBuilderForCreate() {
  __builderEditingId = null;
  
  document.getElementById('wbTitle').value = '';
  document.getElementById('wbDesc').value = '';
  document.getElementById('wbAuthor').value = '';
  
  // 기본 세그먼트 추가
  renderSegmentRows([
    {
      label: '워밍업',
      segment_type: 'warmup',
      duration_sec: 300,
      target_type: 'ftp_percent',
      target_value: 50,
      ramp: 'none',
      ramp_to_value: null
    },
    {
      label: '메인 세트',
      segment_type: 'interval',
      duration_sec: 1200,
      target_type: 'ftp_percent',
      target_value: 105,
      ramp: 'none',
      ramp_to_value: null
    },
    {
      label: '쿨다운',
      segment_type: 'cooldown',
      duration_sec: 300,
      target_type: 'ftp_percent',
      target_value: 40,
      ramp: 'none',
      ramp_to_value: null
    }
  ]);
  
  window.showScreen('workoutBuilderScreen');
}

// 워크아웃 수정
window.editWorkout = async function(id) {
  try {
    showToast('워크아웃 정보를 불러오는 중...');
    
    const result = await apiRequest('GET', 'getWorkout', { id });
    
    if (!result.success) {
      throw new Error(result.error || '워크아웃 조회 실패');
    }
    
    const item = result.item;
    __builderEditingId = item.id;
    
    document.getElementById('wbTitle').value = item.title || '';
    document.getElementById('wbDesc').value = item.description || '';
    document.getElementById('wbAuthor').value = item.author || '';
    
    renderSegmentRows(item.segments || []);
    
    window.showScreen('workoutBuilderScreen');
    showToast('워크아웃 수정 모드');
    
  } catch (error) {
    console.error('워크아웃 수정 실패:', error);
    showToast('워크아웃을 불러올 수 없습니다: ' + error.message);
  }
};

// 세그먼트 행 렌더링
function renderSegmentRows(segments) {
  const container = document.getElementById('wbSegments');
  if (!container) return;
  
  container.innerHTML = segments.map((seg, idx) => createSegmentRowHTML(seg, idx)).join('');
  updateTotalDuration();
}

function createSegmentRowHTML(seg = {}, idx) {
  const segmentTypeOptions = Object.entries(SEGMENT_TYPES).map(([key, info]) => 
    `<option value="${key}" ${seg.segment_type === key ? 'selected' : ''}>${info.label}</option>`
  ).join('');
  
  const targetTypeOptions = TARGET_TYPES.map(type => 
    `<option value="${type.value}" ${seg.target_type === type.value ? 'selected' : ''}>${type.label}</option>`
  ).join('');
  
  const rampOptions = RAMP_TYPES.map(type => 
    `<option value="${type.value}" ${seg.ramp === type.value ? 'selected' : ''}>${type.label}</option>`
  ).join('');
  
  // 권장 강도 표시
  const segmentInfo = SEGMENT_TYPES[seg.segment_type] || SEGMENT_TYPES.interval;
  const recommendedRange = `권장: ${segmentInfo.typical_ftp[0]}-${segmentInfo.typical_ftp[1]}%`;
  
  return `
    <div class="card segment-row" data-row="${idx}" style="border-left: 4px solid ${segmentInfo.color};">
      <div class="form-row">
        <div class="form-group" style="flex:2;">
          <label>라벨</label>
          <input type="text" data-k="label" value="${seg.label || ''}" placeholder="세그먼트 이름">
        </div>
        <div class="form-group" style="flex:1;">
          <label>타입</label>
          <select data-k="segment_type" onchange="updateSegmentTypeColor(${idx})">
            ${segmentTypeOptions}
          </select>
        </div>
        <div class="form-group" style="flex:1;">
          <label>지속(초)</label>
          <input type="number" data-k="duration_sec" min="1" value="${seg.duration_sec || 60}" onchange="updateTotalDuration()">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>타겟 기준</label>
          <select data-k="target_type" onchange="updateTargetHelp(${idx})">
            ${targetTypeOptions}
          </select>
        </div>
        <div class="form-group" style="flex:1;">
          <label>타겟 값</label>
          <input type="number" data-k="target_value" value="${seg.target_value || 60}" min="0" onchange="validateTargetValue(${idx})">
          <small class="target-help">${seg.target_type === 'ftp_percent' ? recommendedRange : ''}</small>
        </div>
        <div class="form-group" style="flex:1;">
          <label>램프</label>
          <select data-k="ramp" onchange="toggleRampValue(${idx})">
            ${rampOptions}
          </select>
        </div>
        <div class="form-group" style="flex:1;">
          <label>램프 종료값</label>
          <input type="number" data-k="ramp_to_value" value="${seg.ramp_to_value || ''}" 
                 placeholder="선택사항" ${seg.ramp === 'none' ? 'disabled' : ''}>
        </div>
      </div>

      <div class="btn-row">
        <button type="button" class="btn btn-secondary" onclick="removeSegmentRow(${idx})">삭제</button>
        <button type="button" class="btn" onclick="moveSegmentUp(${idx})" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn" onclick="moveSegmentDown(${idx})">↓</button>
        <button type="button" class="btn" onclick="duplicateSegment(${idx})">복사</button>
      </div>
    </div>
  `;
}

// 세그먼트 관리 함수들
window.removeSegmentRow = function(idx) {
  const row = document.querySelector(`[data-row="${idx}"]`);
  if (row) {
    row.remove();
    reindexSegmentRows();
    updateTotalDuration();
  }
};

window.moveSegmentUp = function(idx) {
  const row = document.querySelector(`[data-row="${idx}"]`);
  const prevRow = document.querySelector(`[data-row="${idx - 1}"]`);
  
  if (row && prevRow) {
    row.parentNode.insertBefore(row, prevRow);
    reindexSegmentRows();
  }
};

window.moveSegmentDown = function(idx) {
  const row = document.querySelector(`[data-row="${idx}"]`);
  const nextRow = document.querySelector(`[data-row="${idx + 1}"]`);
  
  if (row && nextRow) {
    row.parentNode.insertBefore(nextRow, row);
    reindexSegmentRows();
  }
};

window.duplicateSegment = function(idx) {
  const row = document.querySelector(`[data-row="${idx}"]`);
  if (!row) return;
  
  // 현재 세그먼트 데이터 복사
  const segmentData = {
    label: row.querySelector('[data-k="label"]').value + ' (복사)',
    segment_type: row.querySelector('[data-k="segment_type"]').value,
    duration_sec: row.querySelector('[data-k="duration_sec"]').value,
    target_type: row.querySelector('[data-k="target_type"]').value,
    target_value: row.querySelector('[data-k="target_value"]').value,
    ramp: row.querySelector('[data-k="ramp"]').value,
    ramp_to_value: row.querySelector('[data-k="ramp_to_value"]').value
  };
  
  const container = document.getElementById('wbSegments');
  const newIdx = container.querySelectorAll('.segment-row').length;
  const newRowHTML = createSegmentRowHTML(segmentData, newIdx);
  
  container.insertAdjacentHTML('beforeend', newRowHTML);
  updateTotalDuration();
};

// UI 헬퍼 함수들
window.updateSegmentTypeColor = function(idx) {
  const row = document.querySelector(`[data-row="${idx}"]`);
  if (!row) return;
  
  const segmentType = row.querySelector('[data-k="segment_type"]').value;
  const segmentInfo = SEGMENT_TYPES[segmentType] || SEGMENT_TYPES.interval;
  
  row.style.borderLeftColor = segmentInfo.color;
  
  // 타겟 값 도움말 업데이트
  const targetType = row.querySelector('[data-k="target_type"]').value;
  const helpElement = row.querySelector('.target-help');
  
  if (helpElement && targetType === 'ftp_percent') {
    helpElement.textContent = `권장: ${segmentInfo.typical_ftp[0]}-${segmentInfo.typical_ftp[1]}%`;
  }
};

window.updateTargetHelp = function(idx) {
  const row = document.querySelector(`[data-row="${idx}"]`);
  if (!row) return;
  
  const targetType = row.querySelector('[data-k="target_type"]').value;
  const segmentType = row.querySelector('[data-k="segment_type"]').value;
  const helpElement = row.querySelector('.target-help');
  
  if (helpElement) {
    if (targetType === 'ftp_percent') {
      const segmentInfo = SEGMENT_TYPES[segmentType] || SEGMENT_TYPES.interval;
      helpElement.textContent = `권장: ${segmentInfo.typical_ftp[0]}-${segmentInfo.typical_ftp[1]}%`;
    } else {
      helpElement.textContent = '';
    }
  }
};

window.validateTargetValue = function(idx) {
  const row = document.querySelector(`[data-row="${idx}"]`);
  if (!row) return;
  
  const targetType = row.querySelector('[data-k="target_type"]').value;
  const targetValue = Number(row.querySelector('[data-k="target_value"]').value);
  const input = row.querySelector('[data-k="target_value"]');
  
  // 범위 검증
  if (targetType === 'ftp_percent' && (targetValue < 0 || targetValue > 300)) {
    input.style.borderColor = '#ef4444';
    showToast('FTP %는 0-300 범위로 입력하세요');
  } else if (targetType === 'cadence' && (targetValue < 30 || targetValue > 150)) {
    input.style.borderColor = '#ef4444';
    showToast('케이던스는 30-150 RPM 범위로 입력하세요');
  } else if (targetType === 'heart_rate' && (targetValue < 50 || targetValue > 220)) {
    input.style.borderColor = '#ef4444';
    showToast('심박수는 50-220 BPM 범위로 입력하세요');
  } else {
    input.style.borderColor = '';
  }
};

window.toggleRampValue = function(idx) {
  const row = document.querySelector(`[data-row="${idx}"]`);
  if (!row) return;
  
  const ramp = row.querySelector('[data-k="ramp"]').value;
  const rampValueInput = row.querySelector('[data-k="ramp_to_value"]');
  
  rampValueInput.disabled = (ramp === 'none');
  if (ramp === 'none') {
    rampValueInput.value = '';
  }
};

function updateTotalDuration() {
  const rows = document.querySelectorAll('#wbSegments .segment-row');
  let total = 0;
  
  rows.forEach(row => {
    const duration = Number(row.querySelector('[data-k="duration_sec"]').value) || 0;
    total += duration;
  });
  
  const totalMinutes = Math.round(total / 60);
  const durationDisplay = document.getElementById('totalDuration');
  
  if (durationDisplay) {
    durationDisplay.textContent = `총 ${totalMinutes}분 (${rows.length}개 구간)`;
  }
}

function reindexSegmentRows() {
  const rows = document.querySelectorAll('#wbSegments .segment-row');
  rows.forEach((row, idx) => {
    row.setAttribute('data-row', idx);
    
    // 버튼 이벤트 업데이트
    row.querySelector('button[onclick*="removeSegmentRow"]')?.setAttribute('onclick', `removeSegmentRow(${idx})`);
    row.querySelector('button[onclick*="moveSegmentUp"]')?.setAttribute('onclick', `moveSegmentUp(${idx})`);
    row.querySelector('button[onclick*="moveSegmentDown"]')?.setAttribute('onclick', `moveSegmentDown(${idx})`);
    row.querySelector('button[onclick*="duplicateSegment"]')?.setAttribute('onclick', `duplicateSegment(${idx})`);
    
    // 위로 버튼 활성화/비활성화
    const upBtn = row.querySelector('button[onclick*="moveSegmentUp"]');
    if (upBtn) upBtn.disabled = (idx === 0);
  });
}

/* ==========================================================
   워크아웃 저장
========================================================== */

window.saveWorkout = async function() {
  try {
    // 폼 데이터 수집
    const title = document.getElementById('wbTitle').value.trim();
    const description = document.getElementById('wbDesc').value.trim();
    const author = document.getElementById('wbAuthor').value.trim();
    
    if (!title) {
      alert('워크아웃 제목을 입력하세요');
      return;
    }
    
    // 세그먼트 데이터 수집
    const segments = [...document.querySelectorAll('#wbSegments .segment-row')].map((row, i) => {
      const getValue = key => row.querySelector(`[data-k="${key}"]`)?.value;
      
      return {
        label: getValue('label') || `세그먼트 ${i + 1}`,
        segment_type: getValue('segment_type') || 'interval',
        duration_sec: Number(getValue('duration_sec')) || 60,
        target_type: getValue('target_type') || 'ftp_percent',
        target_value: Number(getValue('target_value')) || 60,
        ramp: getValue('ramp') || 'none',
        ramp_to_value: getValue('ramp_to_value') ? Number(getValue('ramp_to_value')) : null
      };
    });
    
    if (segments.length === 0) {
      alert('최소 하나의 세그먼트를 추가하세요');
      return;
    }
    
    showToast('저장 중...');
    
    let result;
    const workoutData = { title, description, author, segments };
    
    if (__builderEditingId) {
      // 수정 모드
      result = await apiRequest('POST', 'updateWorkout', { 
        id: __builderEditingId, 
        ...workoutData 
      });
    } else {
      // 생성 모드
      result = await apiRequest('POST', 'createWorkout', workoutData);
    }
    
    if (result && result.success) {
      const totalMinutes = Math.round(result.total_duration / 60);
      showToast(`워크아웃이 저장되었습니다! (${result.segments_count}개 구간, ${totalMinutes}분)`);
      window.showScreen('workoutScreen');
      loadWorkouts();
    } else {
      throw new Error(result?.error || '저장 실패');
    }
    
  } catch (error) {
    console.error('워크아웃 저장 실패:', error);
    alert('저장 중 오류가 발생했습니다: ' + error.message);
  }
};

/* ==========================================================
   유틸리티 함수들
========================================================== */

// API 응답을 프론트엔드 형식으로 변환 (기존 app.js와 호환)
function convertApiWorkout(apiWorkout) {
  return {
    id: apiWorkout.id,
    name: apiWorkout.title,
    description: apiWorkout.description || '',
    totalMinutes: Math.round((apiWorkout.total_seconds || 0) / 60),
    intensity: calculateAverageIntensity(apiWorkout.segments || []),
    tss: calculateEstimatedTSS(apiWorkout.segments || []),
    segments: (apiWorkout.segments || []).map(seg => ({
      label: seg.label,
      segment_type: seg.segment_type,
      duration: Number(seg.duration_sec) || 0,
      duration_sec: Number(seg.duration_sec) || 0,
      ftp_percent: seg.target_type === 'ftp_percent' ? Number(seg.target_value) : 60,
      target: seg.target_type === 'ftp_percent' ? (Number(seg.target_value) / 100) : 0.6,
      target_type: seg.target_type,
      target_value: seg.target_value,
      ramp: seg.ramp,
      ramp_to_value: seg.ramp_to_value
    }))
  };
}

// 평균 강도 계산
function calculateAverageIntensity(segments) {
  if (!segments || segments.length === 0) return 0;
  
  let totalIntensity = 0;
  let totalDuration = 0;
  
  segments.forEach(seg => {
    const duration = Number(seg.duration_sec) || 0;
    const intensity = seg.target_type === 'ftp_percent' ? Number(seg.target_value) : 60;
    
    totalIntensity += intensity * duration;
    totalDuration += duration;
  });
  
  return totalDuration > 0 ? Math.round(totalIntensity / totalDuration) : 0;
}

// 예상 TSS 계산
function calculateEstimatedTSS(segments) {
  if (!segments || segments.length === 0) return 0;
  
  const totalSeconds = segments.reduce((sum, seg) => sum + (Number(seg.duration_sec) || 0), 0);
  const avgIntensity = calculateAverageIntensity(segments);
  
  // TSS = (시간(시) × (강도/100)²) × 100
  const hours = totalSeconds / 3600;
  const intensityFactor = avgIntensity / 100;
  
  return Math.round(hours * Math.pow(intensityFactor, 2) * 100);
}

// 워크아웃 미리보기 업데이트
function updateWorkoutPreview(workout) {
  const nameEl = document.getElementById('previewWorkoutName');
  const durationEl = document.getElementById('previewDuration');
  const intensityEl = document.getElementById('previewIntensity');
  const tssEl = document.getElementById('previewTSS');
  const segmentPreviewEl = document.getElementById('segmentPreview');
  
  if (nameEl) nameEl.textContent = workout.name || '무제';
  if (durationEl) durationEl.textContent = `${workout.totalMinutes || 0}분`;
  if (intensityEl) intensityEl.textContent = `${workout.intensity || 0}%`;
  if (tssEl) tssEl.textContent = workout.tss || 0;
  
  // 세그먼트 미리보기
  if (segmentPreviewEl && workout.segments) {
    const previewHTML = workout.segments.map((seg, idx) => {
      const typeInfo = SEGMENT_TYPES[seg.segment_type] || SEGMENT_TYPES.interval;
      const duration = Math.round((seg.duration_sec || 0) / 60);
      return `
        <div class="segment-item ${seg.segment_type}" style="background: ${typeInfo.color};">
          <h4>${seg.label || `구간 ${idx + 1}`}</h4>
          <div class="ftp-percent">${seg.ftp_percent || 60}%</div>
          <div class="duration">${duration}분</div>
        </div>
      `;
    }).join('');
    
    segmentPreviewEl.innerHTML = previewHTML;
  }
}

/* ==========================================================
   이벤트 바인딩
========================================================== */

(function bindWorkoutManagerEvents() {
  const onReady = () => {
    // 검색 버튼
    const btnSearch = document.getElementById('btnSearchWorkout');
    if (btnSearch && !btnSearch.__bound) {
      btnSearch.addEventListener('click', searchWorkouts);
      btnSearch.__bound = true;
    }
    
    // 새 워크아웃 버튼
    const btnOpenBuilder = document.getElementById('btnOpenBuilder');
    if (btnOpenBuilder && !btnOpenBuilder.__bound) {
      btnOpenBuilder.addEventListener('click', openBuilderForCreate);
      btnOpenBuilder.__bound = true;
    }
    
    // 세그먼트 추가 버튼
    const btnAddSegment = document.getElementById('btnAddSegment');
    if (btnAddSegment && !btnAddSegment.__bound) {
      btnAddSegment.addEventListener('click', () => {
        const container = document.getElementById('wbSegments');
        if (container) {
          const idx = container.querySelectorAll('.segment-row').length;
          const newSegmentHTML = createSegmentRowHTML({
            label: `세그먼트 ${idx + 1}`,
            segment_type: 'interval',
            duration_sec: 60,
            target_type: 'ftp_percent',
            target_value: 80,
            ramp: 'none',
            ramp_to_value: null
          }, idx);
          container.insertAdjacentHTML('beforeend', newSegmentHTML);
          updateTotalDuration();
        }
      });
      btnAddSegment.__bound = true;
    }
    
    // 저장 버튼
    const btnSave = document.getElementById('btnSaveWorkout');
    if (btnSave && !btnSave.__bound) {
      btnSave.addEventListener('click', saveWorkout);
      btnSave.__bound = true;
    }
    
    // 취소 버튼
    const btnCancel = document.getElementById('btnCancelBuilder');
    if (btnCancel && !btnCancel.__bound) {
      btnCancel.addEventListener('click', () => {
        if (typeof window.showScreen === 'function') {
          window.showScreen('workoutScreen');
        }
      });
      btnCancel.__bound = true;
    }
    
    // 총 시간 표시 엘리먼트 추가
    const segmentContainer = document.getElementById('wbSegments');
    if (segmentContainer && !document.getElementById('totalDuration')) {
      const durationDiv = document.createElement('div');
      durationDiv.id = 'totalDuration';
      durationDiv.className = 'text-center muted mt-10';
      durationDiv.textContent = '총 0분 (0개 구간)';
      segmentContainer.parentNode.insertBefore(durationDiv, segmentContainer.nextSibling);
    }
    
    // 연결 테스트 버튼 추가
    if (!document.getElementById('btnTestConnection')) {
      const workoutScreen = document.getElementById('workoutScreen');
      if (workoutScreen) {
        const testBtn = document.createElement('button');
        testBtn.id = 'btnTestConnection';
        testBtn.className = 'btn btn-secondary';
        testBtn.textContent = 'Google Sheets 연결 테스트';
        testBtn.onclick = testGASConnection;
        
        const searchCard = workoutScreen.querySelector('.card');
        if (searchCard) {
          searchCard.appendChild(testBtn);
        }
      }
    }
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();

// 전역 함수로 export
window.openBuilderForCreate = openBuilderForCreate;
window.testGASConnection = testGASConnection;
