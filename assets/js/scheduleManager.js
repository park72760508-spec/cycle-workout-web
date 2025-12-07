/**
 * 훈련 스케줄 관리 모듈
 * 동기부여를 위한 최고의 디자인 적용
 */

// 전역 변수
let currentScheduleId = null;
let currentSchedule = null;
let scheduleDays = [];
let scheduleCalendar = [];

/**
 * 진행 표시 업데이트 헬퍼 함수 (부드러운 애니메이션 포함)
 */
function updateLoadingProgress(container, progress, message) {
  if (!container) return;
  
  const progressBar = container.querySelector('.loading-progress-bar');
  const progressText = container.querySelector('.loading-progress-text');
  const progressMessage = container.querySelector('.loading-progress-message');
  
  if (progressBar) {
    // 부드러운 진행률 애니메이션
    const targetWidth = Math.min(100, Math.max(0, progress));
    progressBar.style.transition = 'width 0.3s ease-out';
    progressBar.style.width = `${targetWidth}%`;
  }
  
  if (progressText) {
    // 숫자 카운트업 애니메이션
    const targetPercent = Math.round(progress);
    animateNumber(progressText, parseInt(progressText.textContent) || 0, targetPercent, 200);
  }
  
  if (progressMessage) {
    // 메시지 페이드 효과
    progressMessage.style.opacity = '0';
    setTimeout(() => {
      progressMessage.textContent = message || '처리 중...';
      progressMessage.style.transition = 'opacity 0.3s ease-in';
      progressMessage.style.opacity = '1';
    }, 150);
  }
}

/**
 * 숫자 카운트업 애니메이션
 */
function animateNumber(element, start, end, duration) {
  if (start === end) {
    element.textContent = `${end}%`;
    return;
  }
  
  const range = end - start;
  const increment = range > 0 ? 1 : -1;
  const stepTime = Math.abs(Math.floor(duration / range));
  let current = start;
  
  const timer = setInterval(() => {
    current += increment;
    element.textContent = `${current}%`;
    
    if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
      element.textContent = `${end}%`;
      clearInterval(timer);
    }
  }, stepTime);
}

/**
 * 훈련 스케줄 목록 로드 (진행 표시 포함)
 */
async function loadTrainingSchedules() {
  const userId = window.currentUser?.id || '';
  if (!userId) {
    showToast('사용자를 먼저 선택해주세요', 'error');
    return;
  }
  
  const listContainer = document.getElementById('scheduleList');
  if (!listContainer) return;
  
  // 진행 표시 UI 생성
  listContainer.innerHTML = `
    <div class="loading-container-with-progress">
      <div class="loading-spinner">
        <div class="spinner"></div>
      </div>
      <div class="loading-progress-section">
        <div class="loading-progress-header">
          <span class="loading-progress-message">스케줄 목록을 불러오는 중...</span>
          <span class="loading-progress-text">0%</span>
        </div>
        <div class="loading-progress-bar-container">
          <div class="loading-progress-bar" style="width: 0%"></div>
        </div>
      </div>
    </div>
  `;
  
  const progressContainer = listContainer.querySelector('.loading-container-with-progress');
  
  try {
    // 1단계: 서버 연결 중 (20%)
    updateLoadingProgress(progressContainer, 20, '서버에 연결하는 중...');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 2단계: 요청 전송 중 (40%)
    updateLoadingProgress(progressContainer, 40, '데이터 요청 중...');
    // userId와 상관없이 모든 스케줄 표시
    const url = `${window.GAS_URL}?action=listTrainingSchedules`;
    
    // 3단계: 응답 대기 중 (60%)
    updateLoadingProgress(progressContainer, 60, '서버 응답 대기 중...');
    const response = await fetch(url);
    
    // 4단계: 데이터 파싱 중 (80%)
    updateLoadingProgress(progressContainer, 80, '데이터 처리 중...');
    const result = await response.json();
    
    // 5단계: 완료 (100%)
    updateLoadingProgress(progressContainer, 100, '완료!');
    await new Promise(resolve => setTimeout(resolve, 200));
    
    if (!result.success) {
      throw new Error(result.error || '스케줄 목록을 불러오는데 실패했습니다');
    }
    
    if (result.items.length === 0) {
      // 페이드아웃 후 빈 상태 표시
      if (progressContainer) {
        progressContainer.style.transition = 'opacity 0.3s ease-out';
        progressContainer.style.opacity = '0';
        setTimeout(() => {
          listContainer.innerHTML = `
            <div class="empty-state" style="opacity: 0; animation: fadeIn 0.5s ease-in forwards;">
              <div class="empty-state-icon"><img src="assets/img/business.png" alt="캘린더" style="width: 48px; height: 48px;" /></div>
              <div class="empty-state-title">아직 스케줄이 없습니다</div>
              <div class="empty-state-description">새로운 훈련 스케줄을 만들어보세요!</div>
              <div class="empty-state-action">
                <button class="btn btn-success" onclick="typeof showScreen === 'function' ? showScreen('scheduleCreateScreen') : (typeof window.showScreen === 'function' ? window.showScreen('scheduleCreateScreen') : console.error('showScreen not found'))">➕ 새 스케줄 만들기</button>
              </div>
            </div>
          `;
        }, 300);
      } else {
        listContainer.innerHTML = `
          <div class="empty-state" style="opacity: 0; animation: fadeIn 0.5s ease-in forwards;">
            <div class="empty-state-icon"><img src="assets/img/business.png" alt="캘린더" style="width: 48px; height: 48px;" /></div>
            <div class="empty-state-title">아직 스케줄이 없습니다</div>
            <div class="empty-state-description">새로운 훈련 스케줄을 만들어보세요!</div>
            <div class="empty-state-action">
              <button class="btn btn-success" onclick="typeof showScreen === 'function' ? showScreen('scheduleCreateScreen') : (typeof window.showScreen === 'function' ? window.showScreen('scheduleCreateScreen') : console.error('showScreen not found'))">➕ 새 스케줄 만들기</button>
            </div>
          </div>
        `;
      }
      return;
    }
    
    // 페이드아웃 후 목록 표시
    if (progressContainer) {
      progressContainer.style.transition = 'opacity 0.3s ease-out';
      progressContainer.style.opacity = '0';
      setTimeout(() => {
        renderScheduleList(result.items);
      }, 300);
    } else {
      renderScheduleList(result.items);
    }
    
  } catch (error) {
    console.error('Error loading schedules:', error);
    listContainer.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️</div>
        <div class="error-state-title">오류 발생</div>
        <div class="error-state-description">${error.message}</div>
        <button class="retry-button" onclick="loadTrainingSchedules()">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 스케줄 목록 렌더링 (동기부여 디자인 + 페이드인 애니메이션)
 */
function renderScheduleList(schedules) {
  const listContainer = document.getElementById('scheduleList');
  if (!listContainer) return;
  
  // 현재 사용자 ID 확인
  const currentUserId = window.currentUser?.id || '';
  
  // 페이드인 애니메이션과 함께 목록 렌더링
  listContainer.innerHTML = schedules.map((schedule, index) => {
    const progress = schedule.progress || 0;
    // 녹색/민트 톤으로 진행률 색상 조정
    const progressColor = progress >= 80 ? '#10b981' : progress >= 50 ? '#34d399' : '#6ee7b7';
    const statusIcon = progress === 100 ? '🏆' : progress >= 50 ? '🔥' : '<img src="assets/img/business.png" alt="캘린더" style="width: 24px; height: 24px;" />';
    const animationDelay = index * 0.1; // 각 카드마다 순차적 애니메이션
    
    // 삭제 권한 확인 (생성자만 삭제 가능)
    const canDelete = currentUserId && String(schedule.userId) === String(currentUserId);
    const canEdit = canDelete; // 수정 권한도 생성자만
    
    return `
      <div class="schedule-card" onclick="openScheduleCalendar('${schedule.id}')" 
           style="opacity: 0; animation: fadeInUp 0.5s ease-out ${animationDelay}s forwards;">
        <div class="schedule-card-header">
          <div class="schedule-icon">${statusIcon}</div>
          <div class="schedule-title-section">
            <h3 class="schedule-title">${schedule.title || '무제목'}</h3>
            <div class="schedule-meta">
              <span class="schedule-period">${schedule.totalWeeks}주 프로그램</span>
              <span class="schedule-frequency">주 ${schedule.weeklyFrequency}회</span>
            </div>
          </div>
        </div>
        
        <div class="schedule-progress-section">
          <div class="progress-header">
            <span class="progress-label">진행률</span>
            <span class="progress-percentage" style="color: ${progressColor}">${progress}%</span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar" style="width: ${progress}%; background: ${progressColor};"></div>
          </div>
          <div class="progress-stats">
            <span>완료: ${schedule.completedDays || 0}일</span>
            <span>전체: ${schedule.totalTrainingDays || 0}일</span>
          </div>
        </div>
        
        <div class="schedule-dates">
          <span>📆 ${formatDate(schedule.startDate)} ~ ${formatDate(schedule.endDate)}</span>
        </div>
        
        <div class="schedule-actions">
          <button class="btn btn-primary btn-sm btn-default-style" onclick="event.stopPropagation(); openScheduleCalendar('${schedule.id}', event)">
            <img src="assets/img/business.png" alt="캘린더" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" /> 캘린더 보기
          </button>
          <button class="btn btn-secondary btn-sm btn-default-style" onclick="event.stopPropagation(); openScheduleDays('${schedule.id}', event)" ${!canEdit ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
            ✏️ 일별 지정
          </button>
          ${canDelete ? `
          <button class="btn btn-danger btn-sm btn-default-style" onclick="event.stopPropagation(); deleteTrainingSchedule('${schedule.id}', '${(schedule.title || '무제목').replace(/'/g, "&#39;")}')" style="margin-left: 4px;">
            🗑️ 삭제
          </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// 스케줄 생성 중복 호출 방지
let isCreatingSchedule = false;

/**
 * 훈련 스케줄 생성 (진행 애니메이션 포함)
 */
async function createTrainingSchedule() {
  // 중복 호출 방지
  if (isCreatingSchedule) {
    console.log('스케줄 생성이 이미 진행 중입니다.');
    return;
  }
  
  const userId = window.currentUser?.id || '';
  if (!userId) {
    showToast('사용자를 먼저 선택해주세요', 'error');
    return;
  }
  
  const title = document.getElementById('scheduleTitle')?.value?.trim();
  const totalWeeks = parseInt(document.getElementById('scheduleTotalWeeks')?.value) || 12;
  const startDate = document.getElementById('scheduleStartDate')?.value;
  
  // 선택된 요일 가져오기
  const weekdayCheckboxes = document.querySelectorAll('input[name="scheduleWeekdays"]:checked');
  const selectedDaysOfWeek = Array.from(weekdayCheckboxes).map(cb => parseInt(cb.value));
  
  if (!title) {
    showToast('스케줄 훈련명을 입력해주세요', 'error');
    return;
  }
  
  if (!startDate) {
    showToast('시작일을 선택해주세요', 'error');
    return;
  }
  
  if (selectedDaysOfWeek.length === 0) {
    showToast('최소 1개 이상의 훈련 요일을 선택해주세요', 'error');
    return;
  }
  
  // 생성 버튼 찾기 및 진행 표시
  const createBtn = document.querySelector('#scheduleCreateScreen .btn-success[onclick*="createTrainingSchedule"]');
  const originalBtnText = createBtn ? createBtn.innerHTML : '';
  
  // 진행 표시 오버레이 생성
  const screen = document.getElementById('scheduleCreateScreen');
  let progressOverlay = null;
  if (screen) {
    progressOverlay = document.createElement('div');
    progressOverlay.className = 'schedule-create-progress-overlay';
    progressOverlay.innerHTML = `
      <div class="schedule-create-progress-container">
        <div class="loading-spinner">
          <div class="spinner"></div>
        </div>
        <div class="loading-progress-section">
          <div class="loading-progress-header">
            <span class="loading-progress-message">스케줄을 생성하는 중...</span>
            <span class="loading-progress-text">0%</span>
          </div>
          <div class="loading-progress-bar-container">
            <div class="loading-progress-bar" style="width: 0%"></div>
          </div>
        </div>
      </div>
    `;
    screen.appendChild(progressOverlay);
    
    // 버튼 비활성화
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.style.opacity = '0.6';
      createBtn.style.cursor = 'not-allowed';
    }
  }
  
  isCreatingSchedule = true;
  
  try {
    // 1단계: 데이터 검증 (20%)
    updateScheduleCreateProgress(progressOverlay, 20, '데이터 검증 중...');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 2단계: 서버 요청 전송 (40%)
    updateScheduleCreateProgress(progressOverlay, 40, '서버에 전송 중...');
    // 선택된 요일을 쉼표로 구분하여 전송
    const selectedDaysStr = selectedDaysOfWeek.join(',');
    const url = `${window.GAS_URL}?action=createTrainingSchedule&userId=${encodeURIComponent(userId)}&title=${encodeURIComponent(title)}&totalWeeks=${totalWeeks}&selectedDaysOfWeek=${selectedDaysStr}&startDate=${startDate}`;
    
    // 3단계: 서버 응답 대기 (60%)
    updateScheduleCreateProgress(progressOverlay, 60, '서버 응답 대기 중...');
    const response = await fetch(url);
    
    // 4단계: 데이터 처리 (80%)
    updateScheduleCreateProgress(progressOverlay, 80, '데이터 처리 중...');
    const result = await response.json();
    
    // 5단계: 완료 (100%)
    updateScheduleCreateProgress(progressOverlay, 100, '완료!');
    await new Promise(resolve => setTimeout(resolve, 300));
    
    if (!result.success) {
      throw new Error(result.error || '스케줄 생성에 실패했습니다');
    }
    
    // 진행 오버레이 페이드아웃
    if (progressOverlay) {
      progressOverlay.style.transition = 'opacity 0.3s ease-out';
      progressOverlay.style.opacity = '0';
      setTimeout(() => {
        if (progressOverlay && progressOverlay.parentNode) {
          progressOverlay.parentNode.removeChild(progressOverlay);
        }
      }, 300);
    }
    
    showToast('스케줄이 생성되었습니다!', 'success');
    
    // 일별 워크아웃 지정 화면으로 이동
    if (result.schedule && result.schedule.id) {
      setTimeout(() => {
        openScheduleDays(result.schedule.id);
      }, 500);
    }
    
  } catch (error) {
    console.error('Error creating schedule:', error);
    
    // 오류 시 진행 오버레이 제거
    if (progressOverlay && progressOverlay.parentNode) {
      progressOverlay.parentNode.removeChild(progressOverlay);
    }
    
    showToast(error.message, 'error');
  } finally {
    isCreatingSchedule = false;
    
    // 버튼 복원
    if (createBtn) {
      createBtn.disabled = false;
      createBtn.style.opacity = '1';
      createBtn.style.cursor = 'pointer';
    }
  }
}

/**
 * 스케줄 생성 진행 표시 업데이트
 */
function updateScheduleCreateProgress(overlay, progress, message) {
  if (!overlay) return;
  
  const progressBar = overlay.querySelector('.loading-progress-bar');
  const progressText = overlay.querySelector('.loading-progress-text');
  const progressMessage = overlay.querySelector('.loading-progress-message');
  
  if (progressBar) {
    progressBar.style.transition = 'width 0.3s ease-out';
    progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  }
  
  if (progressText) {
    const targetPercent = Math.round(progress);
    animateNumber(progressText, parseInt(progressText.textContent) || 0, targetPercent, 200);
  }
  
  if (progressMessage) {
    progressMessage.style.opacity = '0';
    setTimeout(() => {
      progressMessage.textContent = message || '처리 중...';
      progressMessage.style.transition = 'opacity 0.3s ease-in';
      progressMessage.style.opacity = '1';
    }, 150);
  }
}

/**
 * 일별 워크아웃 지정 화면 열기 (버튼 진행 애니메이션 포함)
 */
async function openScheduleDays(scheduleId, event) {
  // 버튼 찾기 및 진행 애니메이션 시작
  let button = null;
  let originalText = '✏️ 일별 지정';
  
  if (event && event.target) {
    button = event.target.closest('button');
  } else {
    // 이벤트가 없으면 스케줄 카드의 버튼 찾기
    button = document.querySelector(`button[onclick*="openScheduleDays('${scheduleId}')"]`);
  }
  
  if (button) {
    button.disabled = true;
    button.style.opacity = '0.6';
    button.style.cursor = 'not-allowed';
    originalText = button.innerHTML;
    button.innerHTML = '<span class="btn-loading-spinner"></span> 로딩 중...';
  }
  
  currentScheduleId = scheduleId;
  
  try {
    // 스케줄 정보 로드
    const url = `${window.GAS_URL}?action=getTrainingSchedule&id=${scheduleId}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.success && result.item) {
      currentSchedule = result.item;
      const subtitle = document.getElementById('scheduleDaysSubtitle');
      if (subtitle) {
        subtitle.textContent = `${result.item.title} - 일별 워크아웃 지정`;
      }
    }
    
    showScheduleScreen('scheduleDaysScreen');
    await loadScheduleDays();
    
  } catch (error) {
    console.error('Error loading schedule:', error);
    showToast('일별 지정 화면을 불러오는데 실패했습니다', 'error');
  } finally {
    // 버튼 복원
    if (button) {
      button.disabled = false;
      button.style.opacity = '1';
      button.style.cursor = 'pointer';
      button.innerHTML = originalText;
    }
  }
}

/**
 * 일별 계획 로드
 */
async function loadScheduleDays() {
  if (!currentScheduleId) return;
  
  const listContainer = document.getElementById('scheduleDaysList');
  if (!listContainer) return;
  
  listContainer.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>일별 계획을 불러오는 중...</p></div>';
  
  try {
    const url = `${window.GAS_URL}?action=getScheduleDays&scheduleId=${currentScheduleId}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || '일별 계획을 불러오는데 실패했습니다');
    }
    
    // 기존 scheduleDays에서 사용자가 선택한 워크아웃 ID 유지
    const existingWorkoutIds = {};
    if (Array.isArray(scheduleDays)) {
      scheduleDays.forEach(day => {
        if (day.plannedWorkoutId !== null && day.plannedWorkoutId !== undefined) {
          existingWorkoutIds[day.id] = day.plannedWorkoutId;
        }
      });
    }
    
    // 서버에서 받은 데이터와 기존 선택값 병합
    const newDays = result.items || [];
    scheduleDays = newDays.map(day => {
      // 기존에 사용자가 선택한 워크아웃 ID가 있으면 유지
      if (existingWorkoutIds[day.id]) {
        day.plannedWorkoutId = existingWorkoutIds[day.id];
      }
      return day;
    });
    
    renderScheduleDays(scheduleDays);
    
  } catch (error) {
    console.error('Error loading schedule days:', error);
    listContainer.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️</div>
        <div class="error-state-title">오류 발생</div>
        <div class="error-state-description">${error.message}</div>
        <button class="retry-button" onclick="loadScheduleDays()">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 일별 계획 렌더링
 */
async function renderScheduleDays(days) {
  const listContainer = document.getElementById('scheduleDaysList');
  if (!listContainer) return;
  
  // 워크아웃 목록 로드
  let workouts = [];
  try {
    const workoutUrl = `${window.GAS_URL}?action=listAllWorkouts`;
    const workoutResponse = await fetch(workoutUrl);
    const workoutResult = await workoutResponse.json();
    if (workoutResult.success) {
      workouts = workoutResult.items || [];
      // 전역 변수에 저장 (엑셀 업로드 기능에서 사용)
      window.allWorkouts = workouts;
    }
  } catch (error) {
    console.error('Error loading workouts:', error);
  }
  
  // 훈련일만 필터링
  const trainingDays = days.filter(day => day.isTrainingDay);
  
  if (trainingDays.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div class="empty-state-title">훈련일이 없습니다</div>
      </div>
    `;
    return;
  }
  
  listContainer.innerHTML = trainingDays.map((day, index) => {
    // 날짜 파싱 (타임존 문제 완전 해결)
    let dateObj;
    let dateInputValue;
    
    if (typeof day.date === 'string') {
      // 문자열인 경우 YYYY-MM-DD 형식으로 파싱 (로컬 시간대로 처리)
      let dateStr = day.date;
      
      // ISO 형식인 경우 날짜만 추출
      if (dateStr.includes('T')) {
        dateStr = dateStr.split('T')[0];
      }
      
      // YYYY-MM-DD 형식인지 확인
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [year, month, dayNum] = dateStr.split('-');
        // 로컬 시간대로 Date 객체 생성 (타임존 문제 방지)
        dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(dayNum));
        dateInputValue = dateStr; // 이미 YYYY-MM-DD 형식
      } else {
        // 다른 형식인 경우 Date 객체로 파싱 후 변환
        dateObj = new Date(day.date);
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dayNum = String(dateObj.getDate()).padStart(2, '0');
        dateInputValue = `${year}-${month}-${dayNum}`;
      }
    } else if (day.date instanceof Date) {
      // Date 객체인 경우
      dateObj = day.date;
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dayNum = String(dateObj.getDate()).padStart(2, '0');
      dateInputValue = `${year}-${month}-${dayNum}`;
    } else {
      // 날짜가 없는 경우 오늘 날짜 사용
      dateObj = new Date();
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dayNum = String(dateObj.getDate()).padStart(2, '0');
      dateInputValue = `${year}-${month}-${dayNum}`;
    }
    
    const dayName = ['일', '월', '화', '수', '목', '금', '토'][dateObj.getDay()];
    
    // 오늘 날짜 확인 (날짜만 비교, 시간 제외)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayDate = new Date(dateObj);
    dayDate.setHours(0, 0, 0, 0);
    const isToday = dayDate.getTime() === today.getTime();
    
    // 과거 날짜 확인 (오늘 날짜는 과거가 아님)
    const isPast = !isToday && dayDate < today;
    
    return `
      <div class="schedule-day-card ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}">
        <div class="day-header">
          <div class="day-date">
            <span class="day-number">${dateObj.getDate()}</span>
            <span class="day-name">${dayName}</span>
          </div>
          <div class="day-label">
            ${isToday ? '<span class="badge today-badge">오늘</span>' : ''}
            ${isPast ? '<span class="badge past-badge">과거</span>' : ''}
          </div>
        </div>
        
        <div class="day-date-section">
          <label>훈련 날짜</label>
          <input type="date" class="day-date-input" data-day-id="${day.id}" value="${dateInputValue}" onchange="updateDayDate('${day.id}', this.value)" />
        </div>
        
        <div class="day-workout-section">
          <label>워크아웃 선택</label>
          <div class="workout-select-container">
            <div class="workout-select-list" data-day-id="${day.id}">
              ${workouts.map(w => {
                const isSelected = w.id == day.plannedWorkoutId;
                const duration = Math.floor((w.total_seconds || 0) / 60);
                const title = (w.title || '제목 없음').replace(/'/g, "&#39;").replace(/"/g, "&quot;");
                return `
                  <div class="workout-option-item ${isSelected ? 'selected' : ''}" 
                       data-workout-id="${w.id}" 
                       data-day-id="${day.id}"
                       onclick="selectWorkoutForDay('${day.id}', '${w.id}')">
                    <div class="workout-option-content">
                      <div class="workout-option-title">${title}</div>
                      <div class="workout-option-duration">${duration}분</div>
                    </div>
                    ${isSelected ? '<div class="workout-option-check">✓</div>' : ''}
                  </div>
                `;
              }).join('')}
            </div>
            <input type="hidden" class="workout-select-hidden" data-day-id="${day.id}" value="${day.plannedWorkoutId || ''}" />
          </div>
        </div>
        
        <div class="day-note-section">
          <label>메모</label>
          <textarea class="day-note" data-day-id="${day.id}" placeholder="예: FTP 95% 유지, 후반에 케이던스 90 이상" onchange="updateDayNote('${day.id}', this.value)">${day.plannedNote || ''}</textarea>
        </div>
      </div>
    `;
  }).join('');
  
  // 그리드 컨테이너로 감싸기
  const cardsHtml = listContainer.innerHTML;
  listContainer.innerHTML = `<div class="schedule-days-grid">${cardsHtml}</div>`;
}

/**
 * 일별 워크아웃 업데이트
 */
/**
 * 워크아웃 선택 (그리드 UI용)
 */
function selectWorkoutForDay(dayId, workoutId) {
  console.log(`[selectWorkoutForDay] 호출: dayId=${dayId}, workoutId=${workoutId}`);
  
  const day = scheduleDays.find(d => d.id == dayId || String(d.id) === String(dayId));
  if (!day) {
    console.warn(`[selectWorkoutForDay] Day를 찾을 수 없음: dayId=${dayId}`);
    return;
  }
  
  // workoutId가 유효한지 확인
  if (!workoutId || String(workoutId).trim() === '' || String(workoutId).trim() === 'null' || String(workoutId).trim() === 'undefined') {
    console.warn(`[selectWorkoutForDay] 유효하지 않은 workoutId: ${workoutId}`);
    return;
  }
  
  const workoutIdStr = String(workoutId).trim();
  
  // 이전 선택 해제
  const previousSelected = document.querySelector(`.workout-option-item.selected[data-day-id="${dayId}"]`);
  if (previousSelected) {
    previousSelected.classList.remove('selected');
    const checkMark = previousSelected.querySelector('.workout-option-check');
    if (checkMark) checkMark.remove();
  }
  
  // 새 선택 적용
  const newSelected = document.querySelector(`.workout-option-item[data-day-id="${dayId}"][data-workout-id="${workoutIdStr}"]`);
  if (newSelected) {
    newSelected.classList.add('selected');
    if (!newSelected.querySelector('.workout-option-check')) {
      const checkMark = document.createElement('div');
      checkMark.className = 'workout-option-check';
      checkMark.textContent = '✓';
      newSelected.appendChild(checkMark);
    }
    console.log(`[selectWorkoutForDay] UI 업데이트 완료: dayId=${dayId}, workoutId=${workoutIdStr}`);
  } else {
    console.warn(`[selectWorkoutForDay] 워크아웃 옵션을 찾을 수 없음: dayId=${dayId}, workoutId=${workoutIdStr}`);
    // DOM이 아직 렌더링되지 않았을 수 있으므로 강제로 스크롤하여 렌더링 유도
    const targetCard = Array.from(document.querySelectorAll('.schedule-day-card')).find(card => {
      const workoutList = card.querySelector(`.workout-select-list[data-day-id="${dayId}"]`);
      return workoutList !== null;
    });
    if (targetCard) {
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 잠시 후 다시 시도
      setTimeout(() => {
        const retrySelected = document.querySelector(`.workout-option-item[data-day-id="${dayId}"][data-workout-id="${workoutIdStr}"]`);
        if (retrySelected) {
          retrySelected.classList.add('selected');
          if (!retrySelected.querySelector('.workout-option-check')) {
            const checkMark = document.createElement('div');
            checkMark.className = 'workout-option-check';
            checkMark.textContent = '✓';
            retrySelected.appendChild(checkMark);
          }
          console.log(`[selectWorkoutForDay] 재시도 성공: dayId=${dayId}, workoutId=${workoutIdStr}`);
        }
      }, 300);
    }
  }
  
  // hidden input 업데이트
  const hiddenInput = document.querySelector(`.workout-select-hidden[data-day-id="${dayId}"]`);
  if (hiddenInput) {
    hiddenInput.value = workoutIdStr;
  }
  
  // scheduleDays 배열 업데이트
  day.plannedWorkoutId = workoutIdStr;
  console.log(`[selectWorkoutForDay] 완료: dayId=${dayId}, workoutId=${day.plannedWorkoutId}`);
  
  // 기존 함수도 호출 (호환성)
  updateDayWorkout(dayId, workoutIdStr);
}

/**
 * 일별 워크아웃 업데이트 (기존 함수 유지 - 호환성)
 */
function updateDayWorkout(dayId, workoutId) {
  const day = scheduleDays.find(d => d.id == dayId || String(d.id) === String(dayId));
  if (day) {
    // 워크아웃 ID 처리 (명확한 값 검증)
    if (workoutId && String(workoutId).trim() !== '' && String(workoutId).trim() !== 'null') {
      day.plannedWorkoutId = String(workoutId).trim();
      console.log(`[updateDayWorkout] 워크아웃 선택: dayId=${dayId}, workoutId=${day.plannedWorkoutId}, day 객체:`, day);
      
      // UI에서도 즉시 반영 (리스트 UI)
      const selectedCard = document.querySelector(`.workout-option-item[data-day-id="${dayId}"][data-workout-id="${day.plannedWorkoutId}"]`);
      if (selectedCard) {
        // 이전 선택 해제
        const previousSelected = document.querySelector(`.workout-option-item.selected[data-day-id="${dayId}"]`);
        if (previousSelected) {
          previousSelected.classList.remove('selected');
          previousSelected.querySelector('.workout-option-check')?.remove();
        }
        
        // 새 선택 적용
        selectedCard.classList.add('selected');
        if (!selectedCard.querySelector('.workout-option-check')) {
          const checkMark = document.createElement('div');
          checkMark.className = 'workout-option-check';
          checkMark.textContent = '✓';
          selectedCard.appendChild(checkMark);
        }
      }
      
      // hidden input 업데이트
      const hiddenInput = document.querySelector(`.workout-select-hidden[data-day-id="${dayId}"]`);
      if (hiddenInput) {
        hiddenInput.value = day.plannedWorkoutId;
      }
    } else {
      day.plannedWorkoutId = null;
      console.log(`[updateDayWorkout] 워크아웃 제거: dayId=${dayId}`);
      
      // UI에서도 즉시 반영
      const selectedCard = document.querySelector(`.workout-option-item.selected[data-day-id="${dayId}"]`);
      if (selectedCard) {
        selectedCard.classList.remove('selected');
        selectedCard.querySelector('.workout-option-check')?.remove();
      }
      
      // hidden input 업데이트
      const hiddenInput = document.querySelector(`.workout-select-hidden[data-day-id="${dayId}"]`);
      if (hiddenInput) {
        hiddenInput.value = '';
      }
    }
  } else {
    console.error(`[updateDayWorkout] day를 찾을 수 없음: dayId=${dayId}, scheduleDays 길이: ${scheduleDays.length}`);
    console.log(`[updateDayWorkout] scheduleDays:`, scheduleDays.map(d => ({ id: d.id, date: d.date })));
  }
}

/**
 * 일별 메모 업데이트
 */
function updateDayNote(dayId, note) {
  const day = scheduleDays.find(d => d.id === dayId);
  if (day) {
    day.plannedNote = note || '';
  }
}

/**
 * 일별 날짜 업데이트
 */
function updateDayDate(dayId, newDate) {
  const day = scheduleDays.find(d => d.id === dayId);
  if (day) {
    // 날짜를 YYYY-MM-DD 형식으로 저장 (타임존 문제 방지)
    day.date = newDate; // 이미 YYYY-MM-DD 형식
    // 날짜 변경 시 UI 업데이트
    const dayCard = document.querySelector(`.schedule-day-card .day-date-input[data-day-id="${dayId}"]`)?.closest('.schedule-day-card');
    if (dayCard) {
      // 로컬 시간대로 파싱 (타임존 문제 방지)
      const [year, month, dayNum] = newDate.split('-');
      const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(dayNum));
      const dayName = ['일', '월', '화', '수', '목', '금', '토'][dateObj.getDay()];
      const dayNumberEl = dayCard.querySelector('.day-number');
      const dayNameEl = dayCard.querySelector('.day-name');
      
      if (dayNumberEl) dayNumberEl.textContent = dateObj.getDate();
      if (dayNameEl) dayNameEl.textContent = dayName;
      
      // 과거/오늘 배지 업데이트 (날짜만 비교, 시간 제외)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dayDate = new Date(dateObj);
      dayDate.setHours(0, 0, 0, 0);
      const isToday = dayDate.getTime() === today.getTime();
      const isPast = !isToday && dayDate < today;
      
      dayCard.classList.toggle('past', isPast);
      dayCard.classList.toggle('today', isToday);
      
      const labelDiv = dayCard.querySelector('.day-label');
      if (labelDiv) {
        labelDiv.innerHTML = `
          ${isToday ? '<span class="badge today-badge">오늘</span>' : ''}
          ${isPast ? '<span class="badge past-badge">과거</span>' : ''}
        `;
      }
    }
  }
}

/**
 * 일별 계획 저장 (진행 애니메이션 포함)
 */
async function saveScheduleDays() {
  if (!currentScheduleId) return;
  
  const trainingDays = scheduleDays.filter(day => day.isTrainingDay);
  if (trainingDays.length === 0) {
    showToast('저장할 훈련일이 없습니다', 'warning');
    return;
  }
  
  // 저장 버튼 찾기 및 비활성화
  const saveBtn = document.querySelector('#scheduleDaysScreen .btn-success, #scheduleDaysScreen button[onclick*="saveScheduleDays"]');
  const originalBtnText = saveBtn ? saveBtn.innerHTML : '';
  
  // 진행 표시 오버레이 생성
  const screen = document.getElementById('scheduleDaysScreen');
  let progressOverlay = null;
  if (screen) {
    progressOverlay = document.createElement('div');
    progressOverlay.className = 'schedule-save-progress-overlay';
    progressOverlay.innerHTML = `
      <div class="schedule-save-progress-container">
        <div class="loading-spinner">
          <div class="spinner"></div>
        </div>
        <div class="loading-progress-section">
          <div class="loading-progress-header">
            <span class="loading-progress-message">일별 계획을 저장하는 중...</span>
            <span class="loading-progress-text">0%</span>
          </div>
          <div class="loading-progress-bar-container">
            <div class="loading-progress-bar" style="width: 0%"></div>
          </div>
          <div class="loading-progress-detail" style="margin-top: 10px; font-size: 12px; color: #666;">
            <span class="progress-detail-text">0 / ${trainingDays.length}개 저장 중...</span>
          </div>
        </div>
      </div>
    `;
    screen.appendChild(progressOverlay);
    
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.6';
      saveBtn.style.cursor = 'not-allowed';
    }
  }
  
  let savedCount = 0;
  let errorCount = 0;
  
  try {
    for (let i = 0; i < trainingDays.length; i++) {
      const day = trainingDays[i];
      const progress = Math.round(((i + 1) / trainingDays.length) * 100);
      
      // 진행률 업데이트
      updateScheduleSaveProgress(progressOverlay, progress, `저장 중... (${i + 1}/${trainingDays.length})`, i + 1, trainingDays.length);
      
      try {
        // 날짜를 YYYY-MM-DD 형식으로 변환 (타임존 문제 방지)
        // UI에서 직접 날짜 입력 필드의 값을 읽어옴 (날짜 변경 반영)
        let dateStr = '';
        const dateInput = document.querySelector(`.day-date-input[data-day-id="${day.id}"]`);
        
        if (dateInput && dateInput.value) {
          // UI에서 직접 읽은 값 사용 (사용자가 변경한 날짜 반영)
          dateStr = dateInput.value.trim();
          console.log(`[saveScheduleDays] UI에서 날짜 읽기: dayId=${day.id}, date=${dateStr}`);
        } else if (day.date) {
          // UI에서 값을 읽을 수 없으면 day 객체의 값 사용
          if (typeof day.date === 'string') {
            // 이미 문자열인 경우 YYYY-MM-DD 형식인지 확인
            if (day.date.includes('T')) {
              // ISO 형식인 경우 날짜만 추출
              dateStr = day.date.split('T')[0];
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
              // 이미 YYYY-MM-DD 형식
              dateStr = day.date;
            } else {
              // 다른 형식인 경우 Date 객체로 파싱 후 변환
              const dateObj = new Date(day.date);
              const year = dateObj.getFullYear();
              const month = String(dateObj.getMonth() + 1).padStart(2, '0');
              const dayNum = String(dateObj.getDate()).padStart(2, '0');
              dateStr = `${year}-${month}-${dayNum}`;
            }
          } else {
            // Date 객체인 경우
            const dateObj = new Date(day.date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dayNum = String(dateObj.getDate()).padStart(2, '0');
            dateStr = `${year}-${month}-${dayNum}`;
          }
        }
        
        // 날짜가 없으면 오류 처리
        if (!dateStr) {
          console.error(`[saveScheduleDays] 날짜를 찾을 수 없음: dayId=${day.id}`);
          errorCount++;
          continue;
        }
        
        // 워크아웃 ID 처리 (명확한 값 검증)
        let workoutIdParam = 'null'; // 기본값: null
        
        // day 객체에서 워크아웃 ID 확인
        console.log(`[saveScheduleDays] day 객체 확인: dayId=${day.id}, plannedWorkoutId=${day.plannedWorkoutId}, type=${typeof day.plannedWorkoutId}`);
        
        if (day.plannedWorkoutId !== null && day.plannedWorkoutId !== undefined) {
          const workoutIdStr = String(day.plannedWorkoutId).trim();
          // 유효한 워크아웃 ID인 경우에만 전송 (숫자 또는 숫자 문자열)
          if (workoutIdStr !== '' && workoutIdStr !== 'null' && workoutIdStr !== 'undefined') {
            // 숫자인지 확인 (워크아웃 ID는 숫자여야 함)
            const workoutIdNum = parseInt(workoutIdStr, 10);
            if (!isNaN(workoutIdNum) && workoutIdNum > 0) {
              workoutIdParam = String(workoutIdNum);
              console.log(`[saveScheduleDays] ✅ 워크아웃 ID 저장: dayId=${day.id}, workoutId=${workoutIdParam}`);
            } else {
              console.log(`[saveScheduleDays] ⚠️ 워크아웃 ID가 숫자가 아님: dayId=${day.id}, value="${workoutIdStr}"`);
            }
          } else {
            console.log(`[saveScheduleDays] ⚠️ 워크아웃 ID 무효: dayId=${day.id}, value="${workoutIdStr}"`);
          }
        } else {
          console.log(`[saveScheduleDays] ⚠️ 워크아웃 ID 없음: dayId=${day.id}, plannedWorkoutId=${day.plannedWorkoutId}`);
          
          // UI에서 선택된 값 확인 (백업 - 그리드 UI)
          const hiddenInput = document.querySelector(`.workout-select-hidden[data-day-id="${day.id}"]`);
          if (hiddenInput && hiddenInput.value) {
            const uiValue = hiddenInput.value.trim();
            if (uiValue !== '' && uiValue !== 'null') {
              const workoutIdNum = parseInt(uiValue, 10);
              if (!isNaN(workoutIdNum) && workoutIdNum > 0) {
                workoutIdParam = String(workoutIdNum);
                console.log(`[saveScheduleDays] ✅ UI에서 워크아웃 ID 복구: dayId=${day.id}, workoutId=${workoutIdParam}`);
                // day 객체에도 저장
                day.plannedWorkoutId = workoutIdParam;
              }
            }
          }
          
          // 기존 select 요소도 확인 (호환성)
          const selectElement = document.querySelector(`select.workout-select[data-day-id="${day.id}"]`);
          if (selectElement && selectElement.value) {
            const uiValue = selectElement.value.trim();
            if (uiValue !== '' && uiValue !== 'null') {
              const workoutIdNum = parseInt(uiValue, 10);
              if (!isNaN(workoutIdNum) && workoutIdNum > 0) {
                workoutIdParam = String(workoutIdNum);
                console.log(`[saveScheduleDays] ✅ 기존 select에서 워크아웃 ID 복구: dayId=${day.id}, workoutId=${workoutIdParam}`);
                day.plannedWorkoutId = workoutIdParam;
              }
            }
          }
        }
        
        const note = day.plannedNote || '';
        
        const url = `${window.GAS_URL}?action=updateScheduleDay&scheduleDayId=${day.id}&date=${encodeURIComponent(dateStr)}&plannedWorkoutId=${workoutIdParam}&plannedNote=${encodeURIComponent(note)}`;
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.success) {
          savedCount++;
        } else {
          errorCount++;
          console.error(`Failed to save day ${day.id}:`, result.error);
        }
      } catch (error) {
        console.error(`Error saving day ${day.id}:`, error);
        errorCount++;
      }
      
      // 짧은 지연 (UI 업데이트를 위해)
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // 완료 (100%)
    updateScheduleSaveProgress(progressOverlay, 100, '저장 완료!', trainingDays.length, trainingDays.length);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 진행 오버레이 페이드아웃
    if (progressOverlay) {
      progressOverlay.style.transition = 'opacity 0.3s ease-out';
      progressOverlay.style.opacity = '0';
      setTimeout(() => {
        if (progressOverlay && progressOverlay.parentNode) {
          progressOverlay.parentNode.removeChild(progressOverlay);
        }
      }, 300);
    }
    
    if (errorCount === 0) {
      showToast(`${savedCount}개의 일별 계획이 저장되었습니다!`, 'success');
      setTimeout(() => {
        if (typeof showScreen === 'function') {
          showScreen('scheduleListScreen');
        } else {
          showScheduleScreen('scheduleListScreen');
        }
      }, 800);
    } else {
      showToast(`${savedCount}개 저장, ${errorCount}개 실패`, 'error');
    }
    
  } catch (error) {
    console.error('Error in saveScheduleDays:', error);
    
    if (progressOverlay && progressOverlay.parentNode) {
      progressOverlay.parentNode.removeChild(progressOverlay);
    }
    
    showToast('저장 중 오류가 발생했습니다', 'error');
  } finally {
    // 버튼 복원
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.style.opacity = '1';
      saveBtn.style.cursor = 'pointer';
    }
  }
}

/**
 * 일별 계획 저장 진행 표시 업데이트
 */
function updateScheduleSaveProgress(overlay, progress, message, current, total) {
  if (!overlay) return;
  
  const progressBar = overlay.querySelector('.loading-progress-bar');
  const progressText = overlay.querySelector('.loading-progress-text');
  const progressMessage = overlay.querySelector('.loading-progress-message');
  const progressDetail = overlay.querySelector('.progress-detail-text');
  
  if (progressBar) {
    progressBar.style.transition = 'width 0.3s ease-out';
    progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  }
  
  if (progressText) {
    const targetPercent = Math.round(progress);
    animateNumber(progressText, parseInt(progressText.textContent) || 0, targetPercent, 200);
  }
  
  if (progressMessage) {
    progressMessage.style.opacity = '0';
    setTimeout(() => {
      progressMessage.textContent = message || '저장 중...';
      progressMessage.style.transition = 'opacity 0.3s ease-in';
      progressMessage.style.opacity = '1';
    }, 150);
  }
  
  if (progressDetail && current !== undefined && total !== undefined) {
    progressDetail.textContent = `${current} / ${total}개 저장 중...`;
  }
}

/**
 * 캘린더 화면 열기 (버튼 진행 애니메이션 포함)
 */
async function openScheduleCalendar(scheduleId, event) {
  // 버튼 찾기 및 진행 애니메이션 시작
  let button = null;
  let originalText = '<img src="assets/img/business.png" alt="캘린더" class="btn-icon-image" style="width: 21px; height: 21px; margin-right: 6px; vertical-align: middle;" /> 캘린더 보기';
  
  if (event && event.target) {
    button = event.target.closest('button');
  } else {
    // 이벤트가 없으면 스케줄 카드의 버튼 찾기
    button = document.querySelector(`button[onclick*="openScheduleCalendar('${scheduleId}')"]`);
  }
  
  if (button) {
    button.disabled = true;
    button.style.opacity = '0.6';
    button.style.cursor = 'not-allowed';
    originalText = button.innerHTML;
    button.innerHTML = '<span class="btn-loading-spinner"></span> 로딩 중...';
  }
  
  currentScheduleId = scheduleId;
  
  try {
    // 스케줄 정보 로드
    const url = `${window.GAS_URL}?action=getTrainingSchedule&id=${scheduleId}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.success && result.item) {
      currentSchedule = result.item;
      const subtitle = document.getElementById('calendarSubtitle');
      if (subtitle) {
        subtitle.textContent = `${result.item.title} - 훈련 캘린더`;
      }
    }
    
    showScheduleScreen('scheduleCalendarScreen');
    await loadScheduleCalendar();
    
  } catch (error) {
    console.error('Error loading schedule:', error);
    showToast('캘린더를 불러오는데 실패했습니다', 'error');
  } finally {
    // 버튼 복원
    if (button) {
      button.disabled = false;
      button.style.opacity = '1';
      button.style.cursor = 'pointer';
      button.innerHTML = originalText;
    }
  }
}

/**
 * 캘린더 데이터 로드
 */
async function loadScheduleCalendar() {
  if (!currentScheduleId) return;
  
  const calendarContainer = document.getElementById('scheduleCalendar');
  if (!calendarContainer) return;
  
  calendarContainer.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>캘린더를 불러오는 중...</p></div>';
  
  try {
    // 현재 사용자 ID 가져오기
    const userId = window.currentUser?.id || '';
    const url = `${window.GAS_URL}?action=getScheduleCalendar&scheduleId=${currentScheduleId}${userId ? `&userId=${userId}` : ''}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || '캘린더를 불러오는데 실패했습니다');
    }
    
    scheduleCalendar = result.items || [];
    renderCalendar(scheduleCalendar);
    
    // 오늘 날짜 확인
    const today = new Date().toISOString().split('T')[0];
    const todayDay = scheduleCalendar.find(d => d.date === today && d.isTrainingDay);
    const startBtn = document.getElementById('btnStartTodayTraining');
    if (startBtn && todayDay && todayDay.plannedWorkout) {
      startBtn.style.display = 'block';
      startBtn.onclick = () => startScheduleTraining(todayDay);
    } else if (startBtn) {
      startBtn.style.display = 'none';
    }
    
  } catch (error) {
    console.error('Error loading calendar:', error);
    calendarContainer.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️</div>
        <div class="error-state-title">오류 발생</div>
        <div class="error-state-description">${error.message}</div>
        <button class="retry-button" onclick="loadScheduleCalendar()">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 캘린더 렌더링 (표 형식 - 정사각형 셀)
 */
function renderCalendar(calendar) {
  const container = document.getElementById('scheduleCalendar');
  if (!container) return;
  
  // 월별로 그룹화
  const months = {};
  calendar.forEach(day => {
    const date = new Date(day.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!months[monthKey]) {
      months[monthKey] = [];
    }
    months[monthKey].push(day);
  });
  
  const monthKeys = Object.keys(months).sort();
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  
  container.innerHTML = monthKeys.map(monthKey => {
    const days = months[monthKey];
    
    // 날짜 순서대로 정렬
    days.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateA - dateB;
    });
    
    if (days.length === 0) return '';
    
    const firstDay = new Date(days[0].date);
    const lastDay = new Date(days[days.length - 1].date);
    const monthName = `${firstDay.getFullYear()}년 ${firstDay.getMonth() + 1}월`;
    
    // 첫 번째 날짜의 요일 확인 (일=0, 월=1, 화=2, 수=3, 목=4, 금=5, 토=6)
    const firstDayWeekday = firstDay.getDay();
    
    // 날짜를 맵으로 변환 (빠른 검색을 위해)
    const daysMap = {};
    days.forEach(day => {
      const date = new Date(day.date);
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      daysMap[dateKey] = day;
    });
    
    // 주별로 그룹화 (7일씩)
    const weeks = [];
    
    // 첫 번째 주의 빈칸 처리
    const firstWeek = [];
    for (let i = 0; i < firstDayWeekday; i++) {
      firstWeek.push(null); // 빈칸
    }
    
    // 첫 번째 날짜부터 마지막 날짜까지 주별로 구성
    let currentWeek = [...firstWeek];
    let dateCounter = new Date(firstDay);
    
    while (dateCounter <= lastDay) {
      const dateKey = `${dateCounter.getFullYear()}-${String(dateCounter.getMonth() + 1).padStart(2, '0')}-${String(dateCounter.getDate()).padStart(2, '0')}`;
      const day = daysMap[dateKey] || null;
      currentWeek.push(day);
      
      // 주가 완성되면 (7일)
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      
      // 다음 날짜로 이동
      dateCounter.setDate(dateCounter.getDate() + 1);
    }
    
    // 마지막 주 처리 (7일이 안 되면 빈칸으로 채움)
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }
    
    return `
      <div class="calendar-month">
        <h3 class="calendar-month-title">${monthName}</h3>
        <table class="calendar-table">
          <thead>
            <tr>
              ${weekdays.map(weekday => `<th class="calendar-table-header">${weekday}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${weeks.map(week => `
              <tr>
                ${week.map(day => {
                  if (day === null) {
                    return '<td class="calendar-table-cell calendar-day-empty"></td>';
                  }
                  return `<td class="calendar-table-cell">${renderCalendarDay(day)}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }).join('');
}

/**
 * 캘린더 일별 셀 렌더링
 */
function renderCalendarDay(day) {
  const date = new Date(day.date);
  const dayName = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  
  // 오늘 날짜 확인 (날짜만 비교, 시간 제외)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayDate = new Date(date);
  dayDate.setHours(0, 0, 0, 0);
  const isToday = dayDate.getTime() === today.getTime();
  
  // 과거 날짜 확인 (오늘 날짜는 과거가 아님)
  const isPast = !isToday && dayDate < today;
  const isTrainingDay = day.isTrainingDay;
  
  // 결과 상태에 따른 스타일
  let statusClass = '';
  let statusIcon = '';
  let statusText = '';
  
  if (day.result) {
    if (day.result.status === 'completed') {
      statusClass = 'completed';
      // 완료된 날짜에는 아이콘 없음
      statusIcon = '';
      statusText = '완료';
    } else if (day.result.status === 'partial') {
      statusClass = 'partial';
      statusIcon = '⚠️';
      statusText = '부분완료';
    } else if (day.result.status === 'skipped') {
      statusClass = 'skipped';
      statusIcon = '⏭️';
      statusText = '건너뜀';
    }
  } else if (isTrainingDay) {
    // 오늘 날짜에 워크아웃이 있으면 주황색톤으로 표시 (과거가 아님)
    if (isToday) {
      statusClass = 'planned';
      // 현재 날짜에는 주황색톤 이미지 적용
      statusIcon = '<img src="assets/img/business.png" alt="캘린더" style="width: 20px; height: 20px; filter: hue-rotate(-20deg) saturate(1.3) brightness(1.1);" />';
      statusText = '예정';
    } else if (isPast) {
      statusClass = 'missed';
      statusIcon = '<img src="assets/img/cancel.png" alt="미실시" style="width: 48px; height: 48px;" />';
      statusText = '미실시';
    } else {
      statusClass = 'planned';
      statusIcon = '<img src="assets/img/business.png" alt="캘린더" style="width: 20px; height: 20px;" />';
      statusText = '예정';
    }
  } else {
    statusClass = 'rest';
    statusIcon = '<img src="assets/img/rest.png" alt="휴식" style="width: 33px; height: 33px;" />';
    statusText = '휴식';
  }
  
  // 오늘 날짜는 클릭 가능하도록 설정 (과거가 아니므로)
  const dayDataAttr = isTrainingDay && (!isPast || isToday) ? `data-day-id="${day.id}" data-day-data='${JSON.stringify(day).replace(/'/g, "&apos;")}'` : '';
  const clickHandler = isTrainingDay && (!isPast || isToday) ? 'onclick="handleCalendarDayClick(this)"' : '';
  
  return `
    <div class="calendar-day ${statusClass} ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}" 
         ${dayDataAttr} ${clickHandler}>
      <div class="calendar-day-number">${date.getDate()}</div>
      
      ${isTrainingDay ? `
        <div class="calendar-day-content">
          <div class="calendar-status-icon">${statusIcon}</div>
          ${day.plannedWorkout ? `
            <div class="calendar-workout-title">
              ${day.plannedWorkout.title}
            </div>
            <div class="calendar-workout-duration">${Math.floor((day.plannedWorkout.total_seconds || 0) / 60)}분</div>
          ` : '<div class="calendar-no-workout">미지정</div>'}
          
          ${day.result ? `
            <div class="calendar-result-stats">
              <div class="result-stat-item">
                <span class="result-label">평균파워</span>
                <span class="result-value">${Math.round(day.result.avg_power || 0)}W</span>
              </div>
              <div class="result-stat-item">
                <span class="result-label">TSS</span>
                <span class="result-value">${Math.round(day.result.tss || 0)}</span>
              </div>
            </div>
          ` : ''}
          
          ${day.plannedNote ? `
            <div class="calendar-note">💬 ${day.plannedNote}</div>
          ` : ''}
        </div>
      ` : `
        <div class="calendar-day-content rest-day">
          <div class="calendar-status-icon">${statusIcon}</div>
          <div class="rest-day-text">휴식</div>
        </div>
      `}
    </div>
  `;
}

/**
 * 캘린더 일별 셀 클릭 핸들러
 */
function handleCalendarDayClick(element) {
  const dayDataStr = element.getAttribute('data-day-data');
  if (!dayDataStr) return;
  
  try {
    const day = JSON.parse(dayDataStr.replace(/&apos;/g, "'"));
    startScheduleTraining(day);
  } catch (error) {
    console.error('Error parsing day data:', error);
    showToast('데이터를 불러올 수 없습니다', 'error');
  }
}

/**
 * 스케줄 훈련 시작 (진행 애니메이션 포함)
 */
function startScheduleTraining(day) {
  if (!day.plannedWorkout) {
    showToast('워크아웃이 지정되지 않았습니다', 'error');
    return;
  }
  
  // 진행 표시 오버레이 생성
  const calendarContainer = document.getElementById('scheduleCalendar');
  let progressOverlay = null;
  
  if (calendarContainer) {
    progressOverlay = document.createElement('div');
    progressOverlay.className = 'schedule-training-progress-overlay';
    progressOverlay.innerHTML = `
      <div class="schedule-training-progress-container">
        <div class="loading-spinner">
          <div class="spinner"></div>
        </div>
        <div class="loading-progress-section">
          <div class="loading-progress-header">
            <span class="loading-progress-message">훈련을 준비하는 중...</span>
            <span class="loading-progress-text">0%</span>
          </div>
          <div class="loading-progress-bar-container">
            <div class="loading-progress-bar" style="width: 0%"></div>
          </div>
        </div>
      </div>
    `;
    calendarContainer.appendChild(progressOverlay);
  }
  
  // 진행 애니메이션 시작
  let progress = 0;
  const progressInterval = setInterval(() => {
    progress += 10;
    if (progress > 90) {
      clearInterval(progressInterval);
      return;
    }
    updateScheduleTrainingProgress(progressOverlay, progress, getProgressMessage(progress));
  }, 200);
  
  // 워크아웃 선택 및 훈련 시작
  setTimeout(async () => {
    try {
      updateScheduleTrainingProgress(progressOverlay, 50, '워크아웃 로딩 중...');
      
      if (typeof window.selectWorkout === 'function') {
        // scheduleDayId를 전역 변수에 저장 (훈련 완료 시 사용)
        window.currentScheduleDayId = day.id;
        updateScheduleTrainingProgress(progressOverlay, 80, '워크아웃 준비 중...');
        await new Promise(resolve => setTimeout(resolve, 300));
        window.selectWorkout(day.plannedWorkout.id);
      } else if (typeof selectWorkout === 'function') {
        window.currentScheduleDayId = day.id;
        updateScheduleTrainingProgress(progressOverlay, 80, '워크아웃 준비 중...');
        await new Promise(resolve => setTimeout(resolve, 300));
        selectWorkout(day.plannedWorkout.id);
      } else {
        throw new Error('워크아웃을 불러올 수 없습니다');
      }
      
      clearInterval(progressInterval);
      updateScheduleTrainingProgress(progressOverlay, 100, '완료!');
      
      // 진행 오버레이 페이드아웃
      setTimeout(() => {
        if (progressOverlay && progressOverlay.parentNode) {
          progressOverlay.style.transition = 'opacity 0.3s ease-out';
          progressOverlay.style.opacity = '0';
          setTimeout(() => {
            if (progressOverlay && progressOverlay.parentNode) {
              progressOverlay.parentNode.removeChild(progressOverlay);
            }
          }, 300);
        }
      }, 500);
      
    } catch (error) {
      clearInterval(progressInterval);
      if (progressOverlay && progressOverlay.parentNode) {
        progressOverlay.parentNode.removeChild(progressOverlay);
      }
      showToast(error.message || '워크아웃을 불러올 수 없습니다', 'error');
    }
  }, 100);
}

/**
 * 스케줄 훈련 진행 표시 업데이트
 */
function updateScheduleTrainingProgress(overlay, progress, message) {
  if (!overlay) return;
  
  const progressBar = overlay.querySelector('.loading-progress-bar');
  const progressText = overlay.querySelector('.loading-progress-text');
  const progressMessage = overlay.querySelector('.loading-progress-message');
  
  if (progressBar) {
    progressBar.style.transition = 'width 0.3s ease-out';
    progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  }
  
  if (progressText) {
    const targetPercent = Math.round(progress);
    animateNumber(progressText, parseInt(progressText.textContent) || 0, targetPercent, 200);
  }
  
  if (progressMessage) {
    progressMessage.style.opacity = '0';
    setTimeout(() => {
      progressMessage.textContent = message || '처리 중...';
      progressMessage.style.transition = 'opacity 0.3s ease-in';
      progressMessage.style.opacity = '1';
    }, 150);
  }
}

/**
 * 진행률에 따른 메시지 반환
 */
function getProgressMessage(progress) {
  if (progress < 30) return '훈련을 준비하는 중...';
  if (progress < 60) return '워크아웃 정보 확인 중...';
  if (progress < 90) return '워크아웃 로딩 중...';
  return '거의 완료!';
}

/**
 * 날짜 포맷팅
 */
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 훈련 스케줄 삭제
 */
async function deleteTrainingSchedule(scheduleId, scheduleTitle) {
  // 확인 메시지
  if (!confirm(`정말 삭제하시겠습니까?\n\n스케줄: ${scheduleTitle || '무제목'}\n\n이 작업은 되돌릴 수 없습니다.`)) {
    return;
  }
  
  try {
    const url = `${window.GAS_URL}?action=deleteTrainingSchedule&id=${scheduleId}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.success) {
      showToast('스케줄이 삭제되었습니다', 'success');
      // 목록 새로고침
      await loadTrainingSchedules();
    } else {
      showToast(result.error || '스케줄 삭제에 실패했습니다', 'error');
    }
  } catch (error) {
    console.error('Error deleting schedule:', error);
    showToast('스케줄 삭제 중 오류가 발생했습니다', 'error');
  }
}

/**
 * 토스트 메시지 표시
 */
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

/**
 * 화면 전환 (기존 함수가 있으면 사용, 없으면 새로 정의)
 */
function showScheduleScreen(screenId) {
  // 스케줄 생성 화면이 열릴 때 체크박스 초기화
  if (screenId === 'scheduleCreateScreen') {
    // DOM이 완전히 로드된 후 체크박스 초기화
    setTimeout(() => {
      initializeWeekdayCheckboxes();
    }, 100);
  }
  if (typeof showScreen === 'function') {
    showScreen(screenId);
  } else {
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
    });
    
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
      targetScreen.classList.add('active');
    }
  }
}

// 전역 함수로 노출 (HTML에서 직접 호출 가능하도록)
if (typeof window !== 'undefined') {
  window.loadTrainingSchedules = loadTrainingSchedules;
  window.createTrainingSchedule = createTrainingSchedule;
  window.openScheduleDays = openScheduleDays;
  window.deleteTrainingSchedule = deleteTrainingSchedule;
  window.loadScheduleDays = loadScheduleDays;
  window.saveScheduleDays = saveScheduleDays;
  window.openScheduleCalendar = openScheduleCalendar;
  window.loadScheduleCalendar = loadScheduleCalendar;
  window.startScheduleTraining = startScheduleTraining;
  window.handleCalendarDayClick = handleCalendarDayClick;
  window.updateDayWorkout = updateDayWorkout;
  window.selectWorkoutForDay = selectWorkoutForDay;
  window.updateDayNote = updateDayNote;
  window.updateDayDate = updateDayDate;
  
  // showScreen이 없으면 scheduleManager의 것을 사용
  if (typeof window.showScreen === 'undefined') {
    window.showScreen = showScheduleScreen;
  }
  
  // 훈련 요일 체크박스 이벤트 핸들러 초기화
  initializeWeekdayCheckboxes();
  
  // 엑셀 업로드 관련 전역 함수 노출
  window.handleExcelUpload = handleExcelUpload;
  window.applyExcelWorkout = applyExcelWorkout;
}

/**
 * 훈련 요일 체크박스 초기화 및 이벤트 핸들러
 */
function initializeWeekdayCheckboxes() {
  const checkboxes = document.querySelectorAll('input[name="scheduleWeekdays"]');
  checkboxes.forEach(checkbox => {
    // 초기 체크 상태에 따라 스타일 적용
    updateWeekdayCheckboxStyle(checkbox);
    
    // 체크박스 변경 이벤트
    checkbox.addEventListener('change', function() {
      updateWeekdayCheckboxStyle(this);
    });
  });
}

/**
 * 체크박스 상태에 따라 스타일 업데이트
 */
function updateWeekdayCheckboxStyle(checkbox) {
  const label = checkbox.closest('.weekday-checkbox-label');
  if (!label) return;
  
  if (checkbox.checked) {
    label.style.borderColor = '#3b82f6';
    label.style.background = '#dbeafe';
    label.style.boxShadow = '0 2px 4px rgba(59, 130, 246, 0.1)';
    const span = label.querySelector('span');
    if (span) {
      span.style.fontWeight = '600';
      span.style.color = '#3b82f6';
    }
  } else {
    label.style.borderColor = '#ddd';
    label.style.background = '#f9fafb';
    label.style.boxShadow = 'none';
    const span = label.querySelector('span');
    if (span) {
      span.style.fontWeight = 'normal';
      span.style.color = '#374151';
    }
  }
}

/**
 * 엑셀 파일 업로드 처리
 */
function handleExcelUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      
      // 첫 번째 시트 읽기
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // B열 데이터 읽기 (B2부터)
      const workoutNumbers = [];
      let rowIndex = 2; // B2부터 시작
      
      while (true) {
        const cellAddress = XLSX.utils.encode_cell({ r: rowIndex - 1, c: 1 }); // B열은 1번째 컬럼
        const cell = worksheet[cellAddress];
        
        if (!cell || cell.v === undefined || cell.v === null || cell.v === '') {
          break; // 빈 셀이면 종료
        }
        
        // 숫자로 변환
        const num = parseFloat(cell.v);
        if (!isNaN(num) && num > 0) {
          workoutNumbers.push(Math.floor(num)); // 정수로 변환
        }
        
        rowIndex++;
      }
      
      // 데이터 저장
      window.excelWorkoutData = workoutNumbers;
      
      console.log(`[handleExcelUpload] ${workoutNumbers.length}개 워크아웃 번호 읽음 (B열):`, workoutNumbers);
      showToast(`엑셀 파일에서 ${workoutNumbers.length}개의 워크아웃 번호를 읽었습니다. "적용" 버튼을 클릭하세요.`, 'success');
      
    } catch (error) {
      console.error('[handleExcelUpload] 엑셀 파일 읽기 오류:', error);
      showToast('엑셀 파일을 읽는 중 오류가 발생했습니다.', 'error');
    }
  };
  
  reader.readAsArrayBuffer(file);
}

/**
 * 엑셀 데이터를 기반으로 워크아웃 자동 선택 (진행 애니메이션 포함)
 */
async function applyExcelWorkout() {
  if (!window.excelWorkoutData || window.excelWorkoutData.length === 0) {
    showToast('먼저 엑셀 파일을 선택해주세요.', 'error');
    return;
  }
  
  const workoutNumbers = window.excelWorkoutData;
  
  // 현재 스케줄의 모든 날짜 가져오기
  const days = scheduleDays || [];
  const sortedDays = days
    .filter(d => d.isTrainingDay)
    .sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateA - dateB;
    });
  
  if (sortedDays.length === 0) {
    showToast('훈련일이 없습니다.', 'error');
    return;
  }
  
  // 워크아웃 목록 가져오기
  const workouts = window.allWorkouts || [];
  if (workouts.length === 0) {
    showToast('워크아웃 목록을 불러오는 중입니다. 잠시 후 다시 시도해주세요.', 'error');
    return;
  }
  
  // 진행 애니메이션 오버레이 생성
  const screen = document.getElementById('scheduleDaysScreen');
  let progressOverlay = null;
  if (screen) {
    progressOverlay = document.createElement('div');
    progressOverlay.className = 'schedule-create-progress-overlay';
    progressOverlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.7); z-index: 9999; display: flex; align-items: center; justify-content: center;';
    progressOverlay.innerHTML = `
      <div class="schedule-create-progress-container" style="background: white; padding: 30px; border-radius: 12px; max-width: 400px; width: 90%;">
        <div class="loading-spinner">
          <div class="spinner" style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #2e74e8; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
        </div>
        <div class="loading-progress-section">
          <div class="loading-progress-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <span class="loading-progress-message" style="font-weight: 600; color: #333;">워크아웃 적용 중...</span>
            <span class="loading-progress-text" style="font-weight: 600; color: #2e74e8;">0%</span>
          </div>
          <div class="loading-progress-bar-container" style="width: 100%; height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden;">
            <div class="loading-progress-bar" style="height: 100%; background: #2e74e8; width: 0%; transition: width 0.3s ease;"></div>
          </div>
        </div>
      </div>
    `;
    screen.appendChild(progressOverlay);
  }
  
  // 진행률 업데이트 함수
  const updateProgress = (percent, message) => {
    if (progressOverlay) {
      const progressBar = progressOverlay.querySelector('.loading-progress-bar');
      const progressText = progressOverlay.querySelector('.loading-progress-text');
      const progressMessage = progressOverlay.querySelector('.loading-progress-message');
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = `${Math.round(percent)}%`;
      if (progressMessage) progressMessage.textContent = message || '워크아웃 적용 중...';
    }
  };
  
  try {
    let appliedCount = 0;
    let skippedCount = 0;
    const totalCount = Math.min(workoutNumbers.length, sortedDays.length);
    
    // 각 날짜에 워크아웃 번호 매칭 (순차적으로 처리)
    for (let index = 0; index < workoutNumbers.length; index++) {
      const workoutNum = workoutNumbers[index];
      const progress = ((index + 1) / totalCount) * 100;
      
      if (index >= sortedDays.length) {
        skippedCount++;
        updateProgress(progress, `처리 중... (${index + 1}/${totalCount})`);
        await new Promise(resolve => setTimeout(resolve, 50));
        continue; // 날짜가 부족하면 스킵
      }
      
      const day = sortedDays[index];
      const workoutIndex = workoutNum - 1; // 1-based to 0-based (엑셀의 1번 = 배열의 0번)
      
      updateProgress(progress, `워크아웃 적용 중... (${index + 1}/${totalCount})`);
      
      if (workoutIndex >= 0 && workoutIndex < workouts.length) {
        const workout = workouts[workoutIndex];
        
        // 워크아웃 선택
        selectWorkoutForDay(day.id, workout.id);
        
        // UI 업데이트를 위한 약간의 딜레이
        await new Promise(resolve => setTimeout(resolve, 100));
        
        appliedCount++;
        console.log(`[applyExcelWorkout] Day ${day.date}: 워크아웃 ${workoutNum} (${workout.title}) 선택`);
      } else {
        skippedCount++;
        console.warn(`[applyExcelWorkout] 워크아웃 번호 ${workoutNum}이 범위를 벗어남 (총 ${workouts.length}개, 요청 인덱스: ${workoutIndex})`);
      }
    }
    
    // 완료 애니메이션
    updateProgress(100, '완료!');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 결과 메시지
    if (appliedCount > 0) {
      showToast(`${appliedCount}개의 워크아웃이 자동 선택되었습니다.${skippedCount > 0 ? ` (${skippedCount}개 건너뜀)` : ''}`, 'success');
    } else {
      showToast('적용된 워크아웃이 없습니다. 엑셀 파일의 번호를 확인해주세요.', 'error');
    }
    
  } catch (error) {
    console.error('[applyExcelWorkout] 오류 발생:', error);
    showToast('워크아웃 적용 중 오류가 발생했습니다.', 'error');
  } finally {
    // 진행 오버레이 제거
    if (progressOverlay && progressOverlay.parentNode) {
      progressOverlay.parentNode.removeChild(progressOverlay);
    }
    
    // 사용한 데이터 초기화
    window.excelWorkoutData = null;
  }
}

