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
 * 훈련 스케줄 목록 로드
 */
async function loadTrainingSchedules() {
  const userId = window.currentUser?.id || '';
  if (!userId) {
    showToast('사용자를 먼저 선택해주세요', 'error');
    return;
  }
  
  const listContainer = document.getElementById('scheduleList');
  if (!listContainer) return;
  
  listContainer.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>스케줄 목록을 불러오는 중...</p></div>';
  
  try {
    const url = `${window.GAS_URL}?action=listTrainingSchedules&userId=${userId}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || '스케줄 목록을 불러오는데 실패했습니다');
    }
    
    if (result.items.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📅</div>
          <div class="empty-state-title">아직 스케줄이 없습니다</div>
          <div class="empty-state-description">새로운 훈련 스케줄을 만들어보세요!</div>
          <div class="empty-state-action">
            <button class="btn btn-success" onclick="typeof showScreen === 'function' ? showScreen('scheduleCreateScreen') : (typeof window.showScreen === 'function' ? window.showScreen('scheduleCreateScreen') : console.error('showScreen not found'))">➕ 새 스케줄 만들기</button>
          </div>
        </div>
      `;
      return;
    }
    
    renderScheduleList(result.items);
    
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
 * 스케줄 목록 렌더링 (동기부여 디자인)
 */
function renderScheduleList(schedules) {
  const listContainer = document.getElementById('scheduleList');
  if (!listContainer) return;
  
  listContainer.innerHTML = schedules.map(schedule => {
    const progress = schedule.progress || 0;
    const progressColor = progress >= 80 ? '#10b981' : progress >= 50 ? '#f59e0b' : '#ef4444';
    const statusIcon = progress === 100 ? '🏆' : progress >= 50 ? '🔥' : '📅';
    
    return `
      <div class="schedule-card" onclick="openScheduleCalendar('${schedule.id}')">
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
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openScheduleCalendar('${schedule.id}')">
            📅 캘린더 보기
          </button>
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openScheduleDays('${schedule.id}')">
            ✏️ 일별 지정
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 훈련 스케줄 생성
 */
async function createTrainingSchedule() {
  const userId = window.currentUser?.id || '';
  if (!userId) {
    showToast('사용자를 먼저 선택해주세요', 'error');
    return;
  }
  
  const title = document.getElementById('scheduleTitle')?.value?.trim();
  const totalWeeks = parseInt(document.getElementById('scheduleTotalWeeks')?.value) || 12;
  const weeklyFrequency = parseInt(document.getElementById('scheduleWeeklyFrequency')?.value) || 3;
  const startDate = document.getElementById('scheduleStartDate')?.value;
  
  if (!title) {
    showToast('스케줄 훈련명을 입력해주세요', 'error');
    return;
  }
  
  if (!startDate) {
    showToast('시작일을 선택해주세요', 'error');
    return;
  }
  
  try {
    const url = `${window.GAS_URL}?action=createTrainingSchedule&userId=${encodeURIComponent(userId)}&title=${encodeURIComponent(title)}&totalWeeks=${totalWeeks}&weeklyFrequency=${weeklyFrequency}&startDate=${startDate}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || '스케줄 생성에 실패했습니다');
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
    showToast(error.message, 'error');
  }
}

/**
 * 일별 워크아웃 지정 화면 열기
 */
async function openScheduleDays(scheduleId) {
  currentScheduleId = scheduleId;
  
  // 스케줄 정보 로드
  try {
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
  } catch (error) {
    console.error('Error loading schedule:', error);
  }
  
  showScheduleScreen('scheduleDaysScreen');
  await loadScheduleDays();
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
    
    scheduleDays = result.items || [];
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
    const date = new Date(day.date);
    const dayName = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
    const isPast = date < new Date();
    const isToday = date.toDateString() === new Date().toDateString();
    
    return `
      <div class="schedule-day-card ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}">
        <div class="day-header">
          <div class="day-date">
            <span class="day-number">${date.getDate()}</span>
            <span class="day-name">${dayName}</span>
          </div>
          <div class="day-label">
            ${isToday ? '<span class="badge today-badge">오늘</span>' : ''}
            ${isPast ? '<span class="badge past-badge">과거</span>' : ''}
          </div>
        </div>
        
        <div class="day-workout-section">
          <label>워크아웃 선택</label>
          <select class="workout-select" data-day-id="${day.id}" onchange="updateDayWorkout('${day.id}', this.value)">
            <option value="">워크아웃 선택...</option>
            ${workouts.map(w => `
              <option value="${w.id}" ${w.id == day.plannedWorkoutId ? 'selected' : ''}>${w.title} (${Math.floor((w.total_seconds || 0) / 60)}분)</option>
            `).join('')}
          </select>
        </div>
        
        <div class="day-note-section">
          <label>메모</label>
          <textarea class="day-note" data-day-id="${day.id}" placeholder="예: FTP 95% 유지, 후반에 케이던스 90 이상" onchange="updateDayNote('${day.id}', this.value)">${day.plannedNote || ''}</textarea>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 일별 워크아웃 업데이트
 */
function updateDayWorkout(dayId, workoutId) {
  const day = scheduleDays.find(d => d.id === dayId);
  if (day) {
    day.plannedWorkoutId = workoutId || null;
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
 * 일별 계획 저장
 */
async function saveScheduleDays() {
  if (!currentScheduleId) return;
  
  const trainingDays = scheduleDays.filter(day => day.isTrainingDay);
  let savedCount = 0;
  let errorCount = 0;
  
  showToast('저장 중...', 'info');
  
  for (const day of trainingDays) {
    try {
      const url = `${window.GAS_URL}?action=updateScheduleDay&scheduleDayId=${day.id}&plannedWorkoutId=${day.plannedWorkoutId || ''}&plannedNote=${encodeURIComponent(day.plannedNote || '')}`;
      const response = await fetch(url);
      const result = await response.json();
      
      if (result.success) {
        savedCount++;
      } else {
        errorCount++;
      }
    } catch (error) {
      console.error(`Error saving day ${day.id}:`, error);
      errorCount++;
    }
  }
  
  if (errorCount === 0) {
    showToast(`${savedCount}개의 일별 계획이 저장되었습니다!`, 'success');
    setTimeout(() => {
      if (typeof showScreen === 'function') {
        showScreen('scheduleListScreen');
      } else {
        showScheduleScreen('scheduleListScreen');
      }
    }, 1000);
  } else {
    showToast(`${savedCount}개 저장, ${errorCount}개 실패`, 'error');
  }
}

/**
 * 캘린더 화면 열기
 */
async function openScheduleCalendar(scheduleId) {
  currentScheduleId = scheduleId;
  
  // 스케줄 정보 로드
  try {
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
  } catch (error) {
    console.error('Error loading schedule:', error);
  }
  
  showScheduleScreen('scheduleCalendarScreen');
  await loadScheduleCalendar();
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
    const url = `${window.GAS_URL}?action=getScheduleCalendar&scheduleId=${currentScheduleId}`;
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
 * 캘린더 렌더링 (동기부여 디자인)
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
  
  container.innerHTML = monthKeys.map(monthKey => {
    const days = months[monthKey];
    const firstDay = new Date(days[0].date);
    const monthName = `${firstDay.getFullYear()}년 ${firstDay.getMonth() + 1}월`;
    
    return `
      <div class="calendar-month">
        <h3 class="calendar-month-title">${monthName}</h3>
        <div class="calendar-grid">
          ${days.map(day => renderCalendarDay(day)).join('')}
        </div>
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
  const isToday = day.date === new Date().toISOString().split('T')[0];
  const isPast = date < new Date();
  const isTrainingDay = day.isTrainingDay;
  
  // 결과 상태에 따른 스타일
  let statusClass = '';
  let statusIcon = '';
  let statusText = '';
  
  if (day.result) {
    if (day.result.status === 'completed') {
      statusClass = 'completed';
      statusIcon = '✅';
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
    if (isPast) {
      statusClass = 'missed';
      statusIcon = '❌';
      statusText = '미실시';
    } else {
      statusClass = 'planned';
      statusIcon = '📅';
      statusText = '예정';
    }
  } else {
    statusClass = 'rest';
    statusIcon = '😌';
    statusText = '휴식';
  }
  
  const dayDataAttr = isTrainingDay && !isPast ? `data-day-id="${day.id}" data-day-data='${JSON.stringify(day).replace(/'/g, "&apos;")}'` : '';
  const clickHandler = isTrainingDay && !isPast ? 'onclick="handleCalendarDayClick(this)"' : '';
  
  return `
    <div class="calendar-day ${statusClass} ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}" 
         ${dayDataAttr} ${clickHandler}>
      <div class="calendar-day-header">
        <span class="calendar-day-number">${date.getDate()}</span>
        <span class="calendar-day-name">${dayName}</span>
      </div>
      
      ${isTrainingDay ? `
        <div class="calendar-day-content">
          <div class="calendar-status-icon">${statusIcon}</div>
          ${day.plannedWorkout ? `
            <div class="calendar-workout-title">${day.plannedWorkout.title}</div>
            <div class="calendar-workout-duration">${Math.floor((day.plannedWorkout.total_seconds || 0) / 60)}분</div>
          ` : '<div class="calendar-no-workout">워크아웃 미지정</div>'}
          
          ${day.result ? `
            <div class="calendar-result-stats">
              <div class="result-stat-item">
                <span class="result-label">파워</span>
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
          <div class="rest-day-text">휴식일</div>
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
 * 스케줄 훈련 시작
 */
function startScheduleTraining(day) {
  if (!day.plannedWorkout) {
    showToast('워크아웃이 지정되지 않았습니다', 'error');
    return;
  }
  
  // 워크아웃 선택 및 훈련 시작
  if (typeof window.selectWorkout === 'function') {
    // scheduleDayId를 전역 변수에 저장 (훈련 완료 시 사용)
    window.currentScheduleDayId = day.id;
    window.selectWorkout(day.plannedWorkout.id);
  } else if (typeof selectWorkout === 'function') {
    window.currentScheduleDayId = day.id;
    selectWorkout(day.plannedWorkout.id);
  } else {
    showToast('워크아웃을 불러올 수 없습니다', 'error');
  }
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
  window.loadScheduleDays = loadScheduleDays;
  window.saveScheduleDays = saveScheduleDays;
  window.openScheduleCalendar = openScheduleCalendar;
  window.loadScheduleCalendar = loadScheduleCalendar;
  window.startScheduleTraining = startScheduleTraining;
  window.handleCalendarDayClick = handleCalendarDayClick;
  window.updateDayWorkout = updateDayWorkout;
  window.updateDayNote = updateDayNote;
  
  // showScreen이 없으면 scheduleManager의 것을 사용
  if (typeof window.showScreen === 'undefined') {
    window.showScreen = showScheduleScreen;
  }
}

