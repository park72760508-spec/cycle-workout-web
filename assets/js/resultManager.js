/* ==========================================================
   훈련 결과 관리 모듈 (trainingResults.js)
   - 훈련 완료 시 결과 저장
   - 사용자별 결과 조회 및 분석
   - CSV 내보내기 기능
========================================================== */

const GAS_URL = (window.CONFIG && window.CONFIG.GAS_WEB_APP_URL) || '';

// 현재 훈련 세션 데이터
let currentTrainingSession = {
  startTime: null,
  endTime: null,
  powerData: [],
  hrData: [],
  cadenceData: [],
  segmentResults: []
};

/**
 * 훈련 시작 시 세션 초기화
 */
function initializeTrainingSession() {
  currentTrainingSession = {
    startTime: new Date().toISOString(),
    endTime: null,
    powerData: [],
    hrData: [],
    cadenceData: [],
    segmentResults: []
  };
  
  console.log('훈련 세션 시작:', currentTrainingSession.startTime);
}

/**
 * 실시간 데이터 수집 (1초마다 호출)
 */
function collectTrainingData() {
  if (!currentTrainingSession.startTime) return;
  
  const timestamp = new Date().toISOString();
  const power = window.liveData?.power || 0;
  const heartRate = window.liveData?.heartRate || 0;
  const cadence = window.liveData?.cadence || 0;
  
  // 데이터 저장
  currentTrainingSession.powerData.push({ timestamp, value: power });
  currentTrainingSession.hrData.push({ timestamp, value: heartRate });
  currentTrainingSession.cadenceData.push({ timestamp, value: cadence });
}

/**
 * 세그먼트 완료 시 결과 저장
 */
function recordSegmentResult(segmentIndex, segmentData) {
  if (!currentTrainingSession.startTime) return;
  
  const segmentResult = {
    segmentIndex,
    label: segmentData.label,
    duration: segmentData.duration_sec,
    targetPower: segmentData.target_value,
    actualAvgPower: calculateSegmentAverage('power', segmentIndex),
    actualAvgHR: calculateSegmentAverage('heartRate', segmentIndex),
    actualAvgCadence: calculateSegmentAverage('cadence', segmentIndex),
    completedAt: new Date().toISOString()
  };
  
  currentTrainingSession.segmentResults.push(segmentResult);
}

/**
 * 세그먼트별 평균 계산
 */
function calculateSegmentAverage(dataType, segmentIndex) {
  // 실제 구현에서는 세그먼트 시작/종료 시간을 기준으로 계산
  const data = currentTrainingSession[`${dataType}Data`] || [];
  if (data.length === 0) return 0;
  
  // 최근 데이터의 평균 (간단한 구현)
  const recentData = data.slice(-60); // 최근 60초
  const sum = recentData.reduce((acc, item) => acc + item.value, 0);
  return Math.round(sum / recentData.length);
}

/**
 * 훈련 완료 시 결과 저장
 */
async function saveTrainingResult() {
  if (!currentTrainingSession.startTime || !window.currentUser || !window.currentWorkout) {
    console.error('훈련 세션 데이터가 불완전합니다.');
    return { success: false, error: '훈련 데이터가 불완전합니다.' };
  }
  
  currentTrainingSession.endTime = new Date().toISOString();
  
  // 통계 계산
  const stats = calculateTrainingStats();
  
  const trainingResult = {
    user_id: window.currentUser.id,
    workout_id: window.currentWorkout.id,
    started_at: currentTrainingSession.startTime,
    completed_at: currentTrainingSession.endTime,
    avg_power: stats.avgPower,
    max_power: stats.maxPower,
    avg_hr: stats.avgHR,
    max_hr: stats.maxHR,
    total_energy: stats.totalEnergy,
    tss: stats.tss,
    notes: `${window.currentWorkout.name || 'Unknown'} 완료`,
    detailed_data: JSON.stringify({
      segments: currentTrainingSession.segmentResults,
      powerCurve: stats.powerCurve,
      zones: stats.zones
    })
  };
  
  try {
    const response = await fetch(`${GAS_URL}?action=saveTrainingResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trainingResult)
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('훈련 결과 저장 완료:', result.id);
      updateResultScreen(stats);
      return result;
    } else {
      console.error('훈련 결과 저장 실패:', result.error);
      return result;
    }
    
  } catch (error) {
    console.error('훈련 결과 저장 중 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 훈련 통계 계산
 */
function calculateTrainingStats() {
  const powerData = currentTrainingSession.powerData.map(d => d.value);
  const hrData = currentTrainingSession.hrData.map(d => d.value);
  
  // 기본 통계
  const avgPower = powerData.length > 0 ? Math.round(powerData.reduce((a, b) => a + b, 0) / powerData.length) : 0;
  const maxPower = powerData.length > 0 ? Math.max(...powerData) : 0;
  const avgHR = hrData.length > 0 ? Math.round(hrData.reduce((a, b) => a + b, 0) / hrData.length) : 0;
  const maxHR = hrData.length > 0 ? Math.max(...hrData) : 0;
  
  // 에너지 계산 (kJ)
  const durationSeconds = powerData.length;
  const totalEnergy = Math.round((avgPower * durationSeconds) / 1000);
  
  // TSS 계산 (간단한 버전)
  const ftp = window.currentUser?.ftp || 200;
  const intensityFactor = avgPower / ftp;
  const tss = Math.round((durationSeconds / 3600) * intensityFactor * intensityFactor * 100);
  
  // 파워 커브 (5초, 30초, 1분, 5분, 20분 최대값)
  const powerCurve = calculatePowerCurve(powerData);
  
  // 파워 존 분포
  const zones = calculatePowerZones(powerData, ftp);
  
  return {
    avgPower,
    maxPower,
    avgHR,
    maxHR,
    totalEnergy,
    tss,
    powerCurve,
    zones,
    duration: durationSeconds
  };
}

/**
 * 파워 커브 계산
 */
function calculatePowerCurve(powerData) {
  const intervals = [5, 30, 60, 300, 1200]; // 5초, 30초, 1분, 5분, 20분
  const curve = {};
  
  intervals.forEach(seconds => {
    let maxAvg = 0;
    for (let i = 0; i <= powerData.length - seconds; i++) {
      const slice = powerData.slice(i, i + seconds);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      maxAvg = Math.max(maxAvg, avg);
    }
    curve[`${seconds}s`] = Math.round(maxAvg);
  });
  
  return curve;
}

/**
 * 파워 존 분포 계산
 */
function calculatePowerZones(powerData, ftp) {
  const zones = {
    zone1: 0, // <55% FTP
    zone2: 0, // 55-75% FTP
    zone3: 0, // 76-90% FTP
    zone4: 0, // 91-105% FTP
    zone5: 0, // 106-120% FTP
    zone6: 0  // >120% FTP
  };
  
  powerData.forEach(power => {
    const percentage = (power / ftp) * 100;
    if (percentage < 55) zones.zone1++;
    else if (percentage < 76) zones.zone2++;
    else if (percentage < 91) zones.zone3++;
    else if (percentage < 106) zones.zone4++;
    else if (percentage < 121) zones.zone5++;
    else zones.zone6++;
  });
  
  return zones;
}

/**
 * 결과 화면 업데이트
 */
function updateResultScreen(stats) {
  // 기본 결과 표시
  document.getElementById('resultAvgPower').textContent = stats.avgPower;
  document.getElementById('resultMaxPower').textContent = stats.maxPower;
  document.getElementById('resultAvgHR').textContent = stats.avgHR;
  document.getElementById('resultCalories').textContent = stats.totalEnergy;
  
  // 달성률 계산 및 표시
  const targetTSS = window.currentWorkout?.tss || 100;
  const achievement = Math.round((stats.tss / targetTSS) * 100);
  document.getElementById('finalAchievement').textContent = achievement + '%';
  
  // 워크아웃 이름 표시
  document.getElementById('workoutCompletedName').textContent = 
    `${window.currentWorkout?.name || 'Unknown'} - ${Math.round(stats.duration / 60)}분 완주`;
  
  // AI 분석 생성
  generateAIAnalysis(stats);
}

/**
 * AI 분석 생성 (간단한 버전)
 */
function generateAIAnalysis(stats) {
  const ftp = window.currentUser?.ftp || 200;
  const intensityFactor = stats.avgPower / ftp;
  
  let analysis = '';
  
  if (intensityFactor > 1.05) {
    analysis = '🔥 높은 강도로 훌륭한 훈련을 완료했습니다! FTP 향상에 도움이 될 것입니다.';
  } else if (intensityFactor > 0.85) {
    analysis = '💪 적절한 강도로 좋은 훈련이었습니다. 지구력 향상에 효과적입니다.';
  } else if (intensityFactor > 0.65) {
    analysis = '🚴‍♂️ 유산소 기초 체력 향상에 도움이 되는 훈련이었습니다.';
  } else {
    analysis = '😊 회복 훈련 또는 워밍업 세션이었습니다. 꾸준한 훈련이 중요합니다.';
  }
  
  if (stats.tss > 150) {
    analysis += ' 높은 TSS로 인해 내일은 가벼운 훈련이나 휴식을 권장합니다.';
  } else if (stats.tss > 100) {
    analysis += ' 적절한 훈련 부하입니다.';
  }
  
  document.getElementById('aiAnalysis').textContent = analysis;
}

/**
 * 사용자별 훈련 결과 조회
 */
async function getTrainingResults(userId, startDate, endDate) {
  try {
    const params = new URLSearchParams({
      action: 'getTrainingResults',
      userId: userId || '',
      startDate: startDate || '',
      endDate: endDate || ''
    });
    
    const response = await fetch(`${GAS_URL}?${params}`);
    const result = await response.json();
    
    return result;
    
  } catch (error) {
    console.error('훈련 결과 조회 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 결과 화면의 사용자 선택 처리
 */
async function handleUserSelect(userId) {
  if (!userId) return;
  
  try {
    const result = await getTrainingResults(userId);
    
    if (result.success) {
      displayTrainingHistory(result.items);
    } else {
      console.error('훈련 기록 조회 실패:', result.error);
    }
    
  } catch (error) {
    console.error('사용자 선택 처리 실패:', error);
  }
}

/**
 * 훈련 기록 표시
 */
function displayTrainingHistory(results) {
  // 간단한 통계 표시
  if (results.length === 0) {
    showToast('훈련 기록이 없습니다.');
    return;
  }
  
  const totalSessions = results.length;
  const totalTSS = results.reduce((sum, r) => sum + (r.tss || 0), 0);
  const avgPower = Math.round(results.reduce((sum, r) => sum + (r.avg_power || 0), 0) / totalSessions);
  
  console.log(`총 ${totalSessions}회 훈련, 평균 파워: ${avgPower}W, 총 TSS: ${totalTSS}`);
  
  // UI에 표시 (필요에 따라 구현)
}

/**
 * 날짜 필터 적용
 */
async function applyDateFilter() {
  const startDate = document.getElementById('startDate').value;
  const endDate = document.getElementById('endDate').value;
  const userId = document.getElementById('resultUserSelect').value;
  
  if (!userId) {
    showToast('사용자를 먼저 선택해주세요.');
    return;
  }
  
  try {
    const result = await getTrainingResults(userId, startDate, endDate);
    
    if (result.success) {
      displayTrainingHistory(result.items);
      showToast(`${result.items.length}개의 훈련 기록을 찾았습니다.`);
    } else {
      showToast('데이터 조회 실패: ' + result.error);
    }
    
  } catch (error) {
    console.error('날짜 필터 적용 실패:', error);
    showToast('날짜 필터 적용 중 오류가 발생했습니다.');
  }
}

/**
 * CSV 내보내기
 */
async function exportResults() {
  const userId = document.getElementById('resultUserSelect').value;
  
  if (!userId) {
    showToast('사용자를 먼저 선택해주세요.');
    return;
  }
  
  try {
    const result = await getTrainingResults(userId);
    
    if (!result.success) {
      showToast('데이터 조회 실패: ' + result.error);
      return;
    }
    
    const csvData = convertToCSV(result.items);
    downloadCSV(csvData, `training_results_${userId}_${new Date().toISOString().split('T')[0]}.csv`);
    
  } catch (error) {
    console.error('CSV 내보내기 실패:', error);
    showToast('CSV 내보내기 중 오류가 발생했습니다.');
  }
}

/**
 * 데이터를 CSV 형식으로 변환
 */
function convertToCSV(data) {
  if (data.length === 0) return '';
  
  const headers = [
    '날짜', '워크아웃', '시작시간', '완료시간', '평균파워(W)', '최대파워(W)',
    '평균심박(BPM)', '최대심박(BPM)', '에너지(kJ)', 'TSS', '메모'
  ];
  
  const rows = data.map(item => [
    new Date(item.started_at).toLocaleDateString(),
    item.workout_id,
    new Date(item.started_at).toLocaleTimeString(),
    new Date(item.completed_at).toLocaleTimeString(),
    item.avg_power || 0,
    item.max_power || 0,
    item.avg_hr || 0,
    item.max_hr || 0,
    item.total_energy || 0,
    item.tss || 0,
    item.notes || ''
  ]);
  
  return [headers, ...rows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');
}

/**
 * CSV 파일 다운로드
 */
function downloadCSV(csvData, filename) {
  const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * 결과 화면 초기화 시 사용자 목록 로드
 */
async function initializeResultScreen() {
  try {
    const userSelect = document.getElementById('resultUserSelect');
    if (!userSelect) return;
    
    const result = await fetch(`${GAS_URL}?action=listUsers`).then(r => r.json());
    
    if (result.success) {
      userSelect.innerHTML = '<option value="">-- 사용자 선택 --</option>' +
        result.items.map(user => `<option value="${user.id}">${user.name}</option>`).join('');
    }
    
  } catch (error) {
    console.error('사용자 목록 로드 실패:', error);
  }
}

// 전역 함수로 내보내기
window.initializeTrainingSession = initializeTrainingSession;
window.collectTrainingData = collectTrainingData;
window.recordSegmentResult = recordSegmentResult;
window.saveTrainingResult = saveTrainingResult;
window.handleUserSelect = handleUserSelect;
window.applyDateFilter = applyDateFilter;
window.exportResults = exportResults;
window.initializeResultScreen = initializeResultScreen;

// 기존 app.js와 연동을 위한 훅
document.addEventListener('DOMContentLoaded', () => {
  // 결과 화면으로 전환 시 초기화
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.target.id === 'resultScreen' && mutation.target.classList.contains('active')) {
        initializeResultScreen();
      }
    });
  });
  
  const resultScreen = document.getElementById('resultScreen');
  if (resultScreen) {
    observer.observe(resultScreen, { attributes: true, attributeFilter: ['class'] });
  }
});

// 1초마다 데이터 수집 (훈련 중일 때만)
setInterval(() => {
  if (document.getElementById('trainingScreen')?.classList.contains('active')) {
    collectTrainingData();
  }
}, 1000);
