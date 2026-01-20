/* ==========================================================
   ERG Mode Module - AI 기반 스마트로라 ERG 모드
   - FTMS Control Point를 통한 ERG 모드 설정
   - AI 기반 개인화 PID 튜닝
   - 피로도 기반 자동 조정 (Gemini API 연동)
========================================================== */

// ERG 모드 상태 관리
window.ergModeState = window.ergModeState || {
  enabled: false,
  targetPower: 0,
  currentPower: 0,
  pidParams: { Kp: 0.5, Ki: 0.1, Kd: 0.05 }, // 기본 PID 파라미터
  pedalingStyle: 'smooth', // 'smooth' 또는 'aggressive'
  fatigueLevel: 0, // 0-100
  autoAdjustmentEnabled: true
};

// FTMS Control Point UUID
const FTMS_CONTROL_POINT_UUID = '00002ad9-0000-1000-8000-00805f9b34fb';
const FTMS_SERVICE_UUID = '00001826-0000-1000-8000-00805f9b34fb';

// ERG 모드 Op Codes
const ERG_OP_CODES = {
  REQUEST_CONTROL: 0x00,
  RESET: 0x01,
  SET_TARGET_POWER: 0x05,
  START_OR_RESUME: 0x07,
  STOP_OR_PAUSE: 0x08,
  SET_TARGETED_INDOOR_BIKE_SIMULATION_PARAMETERS: 0x11,
  SET_TARGETED_RESISTANCE_LEVEL: 0x12,
  SET_WIND_RESISTANCE: 0x13,
  SET_TRACK_RESISTANCE: 0x14,
  SET_TARGETED_POWER: 0x05 // ERG 모드용
};

/**
 * ERG 모드 UI 초기화 (훈련 화면 진입 시 호출)
 */
function initializeErgMode() {
  // Indoor Training 화면에서만 동작하도록 체크
  const trainingScreen = document.getElementById('trainingScreen');
  const isIndoorTrainingActive = trainingScreen && 
    (trainingScreen.classList.contains('active') || 
     window.getComputedStyle(trainingScreen).display !== 'none');
  
  if (!isIndoorTrainingActive) {
    // Indoor Training 화면이 아니면 실행하지 않음 (Bluetooth Coach와 분리)
    return;
  }
  
  const ergContainer = document.getElementById('ergModeContainer');
  const ergToggle = document.getElementById('ergModeToggle');
  const ergStatus = document.getElementById('ergModeStatus');
  
  if (!ergContainer || !ergToggle || !ergStatus) {
    console.warn('[ERG] ERG 모드 UI 요소를 찾을 수 없습니다');
    return;
  }
  
  // 스마트로라 연결 상태 확인
  const isTrainerConnected = window.connectedDevices?.trainer && 
                             window.connectedDevices.trainer.controlPoint;
  
  // updateErgModeUI를 호출하여 UI 상태 업데이트 (이벤트 리스너 포함)
  updateErgModeUI(isTrainerConnected);
  
  console.log('[ERG] ERG 모드 UI 초기화 완료, 스마트로라 연결 상태:', isTrainerConnected);
}

/**
 * ERG 모드 UI 업데이트 (스마트로라 연결/해제 시 호출)
 */
function updateErgModeUI(isConnected) {
  const ergContainer = document.getElementById('ergModeContainer');
  const ergToggle = document.getElementById('ergModeToggle');
  const ergStatus = document.getElementById('ergModeStatus');
  
  if (!ergContainer) {
    console.warn('[ERG] ERG 모드 컨테이너를 찾을 수 없습니다');
    return;
  }
  
  // 스마트로라 연결 상태 확인 (controlPoint 존재 여부)
  const hasControlPoint = window.connectedDevices?.trainer?.controlPoint;
  const shouldShow = isConnected && hasControlPoint;
  
  // 디버깅 로그
  console.log('[ERG] UI 업데이트:', {
    isConnected: isConnected,
    hasTrainer: !!window.connectedDevices?.trainer,
    hasControlPoint: hasControlPoint,
    shouldShow: shouldShow,
    connectedDevices: window.connectedDevices
  });
  
  if (shouldShow) {
    ergContainer.style.display = 'flex';
    console.log('[ERG] 스마트로라 연결됨 - ERG 모드 UI 표시');
    
    // 이벤트 리스너가 없으면 설정 (중복 방지)
    if (ergToggle && !ergToggle.hasAttribute('data-erg-listener-attached')) {
      ergToggle.setAttribute('data-erg-listener-attached', 'true');
      ergToggle.addEventListener('change', function(e) {
        const enabled = e.target.checked;
        toggleErgMode(enabled);
      });
      console.log('[ERG] ERG 모드 토글 이벤트 리스너 설정');
    }
    
    // 초기 상태 설정
    if (ergToggle) {
      ergToggle.checked = window.ergModeState.enabled;
    }
    updateErgModeStatus();
  } else {
    ergContainer.style.display = 'none';
    console.log('[ERG] 스마트로라 미연결 또는 Control Point 없음 - ERG 모드 UI 숨김');
    
    // 연결 해제 시 ERG 모드 비활성화
    if (!isConnected && window.ergModeState && window.ergModeState.enabled) {
      toggleErgMode(false);
    }
  }
}

/**
 * ERG 모드 상태 표시 업데이트
 */
function updateErgModeStatus() {
  const ergStatus = document.getElementById('ergModeStatus');
  const ergContainer = document.getElementById('ergModeContainer');
  
  if (ergStatus) {
    ergStatus.textContent = window.ergModeState.enabled ? 'ON' : 'OFF';
  }
  
  if (ergContainer) {
    if (window.ergModeState.enabled) {
      ergContainer.classList.add('active');
    } else {
      ergContainer.classList.remove('active');
    }
  }
  
  // 블루투스 개인훈련 대시보드 연결 버튼 색상 업데이트
  if (typeof updateBluetoothConnectionButtonColor === 'function') {
    updateBluetoothConnectionButtonColor();
  }
}

/**
 * ERG 모드 토글
 */
async function toggleErgMode(enabled) {
  try {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer || !trainer.controlPoint) {
      console.warn('[ERG] 스마트로라 또는 Control Point를 찾을 수 없습니다');
      if (typeof showToast === 'function') {
        showToast('스마트로라가 연결되지 않았습니다');
      }
      return;
    }
    
    window.ergModeState.enabled = enabled;
    updateErgModeStatus();
    
    if (enabled) {
      // ERG 모드 활성화
      await enableErgMode();
      console.log('[ERG] ERG 모드 활성화됨');
      if (typeof showToast === 'function') {
        showToast('ERG 모드 활성화');
      }
    } else {
      // ERG 모드 비활성화
      await disableErgMode();
      console.log('[ERG] ERG 모드 비활성화됨');
      if (typeof showToast === 'function') {
        showToast('ERG 모드 비활성화');
      }
    }
  } catch (error) {
    console.error('[ERG] ERG 모드 토글 오류:', error);
    window.ergModeState.enabled = false;
    updateErgModeStatus();
    if (typeof showToast === 'function') {
      showToast('ERG 모드 전환 실패: ' + error.message);
    }
  }
}

/**
 * ERG 모드 활성화
 */
async function enableErgMode() {
  const trainer = window.connectedDevices?.trainer;
  if (!trainer || !trainer.controlPoint) {
    throw new Error('스마트로라 Control Point를 찾을 수 없습니다');
  }
  
  try {
    // 1. Control 요청 (Op Code 0x00)
    const requestControl = new Uint8Array([ERG_OP_CODES.REQUEST_CONTROL]);
    await trainer.controlPoint.writeValue(requestControl);
    console.log('[ERG] Control 요청 전송');
    
    // 2. 현재 목표 파워 가져오기
    const targetPower = window.liveData?.targetPower || 0;
    if (targetPower > 0) {
      await setErgTargetPower(targetPower);
    }
    
    // 3. AI 기반 PID 파라미터 초기화
    await initializeAIPID();
    
  } catch (error) {
    console.error('[ERG] ERG 모드 활성화 오류:', error);
    throw error;
  }
}

/**
 * ERG 모드 비활성화
 */
async function disableErgMode() {
  const trainer = window.connectedDevices?.trainer;
  if (!trainer || !trainer.controlPoint) {
    return; // 이미 해제된 상태
  }
  
  try {
    // ERG 모드 해제 (Reset 또는 Stop)
    const reset = new Uint8Array([ERG_OP_CODES.RESET]);
    await trainer.controlPoint.writeValue(reset);
    console.log('[ERG] ERG 모드 해제');
    
    window.ergModeState.targetPower = 0;
  } catch (error) {
    console.error('[ERG] ERG 모드 비활성화 오류:', error);
  }
}

/**
 * ERG 목표 파워 설정
 */
async function setErgTargetPower(targetPowerW) {
  const trainer = window.connectedDevices?.trainer;
  if (!trainer || !trainer.controlPoint) {
    console.warn('[ERG] Control Point를 찾을 수 없습니다');
    return;
  }
  
  if (!window.ergModeState.enabled) {
    return; // ERG 모드가 비활성화되어 있으면 무시
  }
  
  if (targetPowerW <= 0) {
    console.warn('[ERG] 유효하지 않은 목표 파워:', targetPowerW);
    return;
  }
  
  try {
    // 목표 파워를 와트 단위로 변환 (0.1W 단위)
    const targetPowerValue = Math.round(targetPowerW * 10); // 0.1W 단위
    
    // Op Code 0x05: Set Target Power
    // 데이터 형식: [Op Code (1 byte), Power (2 bytes, little-endian)]
    const buffer = new ArrayBuffer(3);
    const view = new DataView(buffer);
    view.setUint8(0, ERG_OP_CODES.SET_TARGET_POWER);
    view.setUint16(1, targetPowerValue, true); // little-endian
    
    await trainer.controlPoint.writeValue(buffer);
    
    window.ergModeState.targetPower = targetPowerW;
    console.log('[ERG] 목표 파워 설정:', targetPowerW, 'W (값:', targetPowerValue, ')');
    
    // AI 기반 PID 튜닝 적용
    await applyAIPIDTuning(targetPowerW);
    
  } catch (error) {
    console.error('[ERG] 목표 파워 설정 오류:', error);
    // 오류 발생 시 ERG 모드 비활성화 고려
    if (error.message && error.message.includes('not supported')) {
      console.warn('[ERG] ERG 모드가 지원되지 않는 기기일 수 있습니다');
    }
  }
}

/**
 * AI 기반 PID 파라미터 초기화
 */
async function initializeAIPID() {
  try {
    // 사용자 페달링 스타일 분석 (최근 데이터 기반)
    const pedalingStyle = await analyzePedalingStyle();
    window.ergModeState.pedalingStyle = pedalingStyle;
    
    // 페달링 스타일에 따른 기본 PID 파라미터 설정
    if (pedalingStyle === 'smooth') {
      // 부드러운 회전형: 낮은 Kp, 높은 Ki
      window.ergModeState.pidParams = { Kp: 0.4, Ki: 0.15, Kd: 0.03 };
    } else {
      // 강한 찍어누르기형: 높은 Kp, 낮은 Ki
      window.ergModeState.pidParams = { Kp: 0.6, Ki: 0.08, Kd: 0.08 };
    }
    
    console.log('[ERG AI] PID 파라미터 초기화:', {
      style: pedalingStyle,
      params: window.ergModeState.pidParams
    });
    
  } catch (error) {
    console.error('[ERG AI] PID 초기화 오류:', error);
    // 기본값 사용
    window.ergModeState.pidParams = { Kp: 0.5, Ki: 0.1, Kd: 0.05 };
  }
}

/**
 * 페달링 스타일 분석 (AI 기반)
 */
async function analyzePedalingStyle() {
  try {
    // 최근 파워 데이터 분석 (케이던스 변동성, 파워 변동성)
    // window._powerSeries가 없으면 liveData에서 수집
    let recentPowerData = [];
    let recentCadenceData = [];
    
    if (window._powerSeries && typeof window._powerSeries.getRecentData === 'function') {
      recentPowerData = window._powerSeries.getRecentData(30) || [];
    } else if (window.liveData && window.liveData.power) {
      // liveData에서 최근 데이터 수집 (간단한 버퍼 사용)
      if (!window._recentPowerBuffer) window._recentPowerBuffer = [];
      window._recentPowerBuffer.push(window.liveData.power);
      if (window._recentPowerBuffer.length > 30) {
        window._recentPowerBuffer.shift();
      }
      recentPowerData = window._recentPowerBuffer;
    }
    
    if (window._hrSeries && typeof window._hrSeries.getRecentData === 'function') {
      // cadence는 power series와 함께 수집되거나 별도로 관리될 수 있음
      recentCadenceData = [];
    } else if (window.liveData && window.liveData.cadence) {
      if (!window._recentCadenceBuffer) window._recentCadenceBuffer = [];
      window._recentCadenceBuffer.push(window.liveData.cadence);
      if (window._recentCadenceBuffer.length > 30) {
        window._recentCadenceBuffer.shift();
      }
      recentCadenceData = window._recentCadenceBuffer;
    }
    
    if (recentPowerData.length < 10) {
      return 'smooth'; // 기본값
    }
    
    // 파워 변동성 계산 (표준편차)
    const powerMean = recentPowerData.reduce((a, b) => a + b, 0) / recentPowerData.length;
    const powerVariance = recentPowerData.reduce((sum, val) => sum + Math.pow(val - powerMean, 2), 0) / recentPowerData.length;
    const powerStdDev = Math.sqrt(powerVariance);
    const powerCV = powerMean > 0 ? powerStdDev / powerMean : 0; // 변동계수
    
    // 케이던스 변동성 계산
    const cadenceMean = recentCadenceData.length > 0 
      ? recentCadenceData.reduce((a, b) => a + b, 0) / recentCadenceData.length 
      : 0;
    const cadenceVariance = recentCadenceData.length > 0
      ? recentCadenceData.reduce((sum, val) => sum + Math.pow(val - cadenceMean, 2), 0) / recentCadenceData.length
      : 0;
    const cadenceStdDev = Math.sqrt(cadenceVariance);
    
    // 페달링 스타일 판단
    // 파워 변동성이 크고 케이던스 변동성도 크면 → aggressive
    // 파워 변동성이 작고 케이던스가 안정적이면 → smooth
    if (powerCV > 0.15 || cadenceStdDev > 5) {
      return 'aggressive';
    } else {
      return 'smooth';
    }
    
  } catch (error) {
    console.error('[ERG AI] 페달링 스타일 분석 오류:', error);
    return 'smooth'; // 기본값
  }
}

/**
 * AI 기반 PID 튜닝 적용
 */
async function applyAIPIDTuning(targetPower) {
  try {
    // 실시간으로 페달링 스타일 재분석
    const currentStyle = await analyzePedalingStyle();
    
    // 스타일이 변경되었으면 PID 파라미터 업데이트
    if (currentStyle !== window.ergModeState.pedalingStyle) {
      window.ergModeState.pedalingStyle = currentStyle;
      await initializeAIPID();
    }
    
    // 목표 파워에 따른 PID 파라미터 미세 조정
    const ftp = Number(window.currentUser?.ftp) || 200;
    const powerRatio = targetPower / ftp;
    
    // 높은 강도일수록 더 빠른 반응 필요
    if (powerRatio > 1.2) {
      // 고강도: 더 빠른 반응
      window.ergModeState.pidParams.Kp *= 1.1;
      window.ergModeState.pidParams.Kd *= 1.2;
    } else if (powerRatio < 0.7) {
      // 저강도: 더 부드러운 반응
      window.ergModeState.pidParams.Kp *= 0.9;
      window.ergModeState.pidParams.Ki *= 1.1;
    }
    
    console.log('[ERG AI] PID 튜닝 적용:', {
      targetPower: targetPower,
      powerRatio: powerRatio.toFixed(2),
      pidParams: window.ergModeState.pidParams
    });
    
  } catch (error) {
    console.error('[ERG AI] PID 튜닝 오류:', error);
  }
}

/**
 * 피로도 기반 자동 조정 (Gemini API 연동)
 */
async function checkFatigueAndAdjust() {
  if (!window.ergModeState.enabled || !window.ergModeState.autoAdjustmentEnabled) {
    return;
  }
  
  try {
    // 최근 데이터 수집
    let recentPower = [];
    let recentCadence = [];
    let recentHR = [];
    
    // 우선순위: _powerSeries > _recentPowerBuffer
    if (window._powerSeries && typeof window._powerSeries.getRecentData === 'function') {
      recentPower = window._powerSeries.getRecentData(60) || [];
    } else if (window._recentPowerBuffer && window._recentPowerBuffer.length > 0) {
      recentPower = window._recentPowerBuffer.slice(-60);
    }
    
    if (window._hrSeries && typeof window._hrSeries.getRecentData === 'function') {
      recentHR = window._hrSeries.getRecentData(60) || [];
    } else if (window._recentHRBuffer && window._recentHRBuffer.length > 0) {
      recentHR = window._recentHRBuffer.slice(-60);
    }
    
    if (window._recentCadenceBuffer && window._recentCadenceBuffer.length > 0) {
      recentCadence = window._recentCadenceBuffer.slice(-60);
    }
    
    if (recentPower.length < 30 || recentHR.length < 30) {
      return; // 데이터 부족
    }
    
    // Gemini API를 통한 피로도 분석
    const fatigueAnalysis = await analyzeFatigueWithGemini({
      power: recentPower,
      cadence: recentCadence,
      heartRate: recentHR,
      targetPower: window.ergModeState.targetPower,
      elapsedTime: window.trainingState?.elapsedSec || 0
    });
    
    if (fatigueAnalysis.shouldReduce && fatigueAnalysis.reductionPercent > 0) {
      // 목표 파워 자동 감소
      const currentTarget = window.ergModeState.targetPower;
      const newTarget = currentTarget * (1 - fatigueAnalysis.reductionPercent / 100);
      
      console.log('[ERG AI] 피로도 감지 - 목표 파워 자동 조정:', {
        current: currentTarget,
        new: newTarget,
        reduction: fatigueAnalysis.reductionPercent + '%',
        reason: fatigueAnalysis.reason
      });
      
      await setErgTargetPower(newTarget);
      
      if (typeof showToast === 'function') {
        showToast(`피로도 감지: 목표 파워 ${fatigueAnalysis.reductionPercent}% 감소`);
      }
    }
    
    window.ergModeState.fatigueLevel = fatigueAnalysis.fatigueLevel || 0;
    
  } catch (error) {
    console.error('[ERG AI] 피로도 분석 오류:', error);
  }
}

/**
 * Gemini API를 통한 피로도 분석
 */
async function analyzeFatigueWithGemini(data) {
  try {
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) {
      console.warn('[ERG AI] Gemini API 키가 설정되지 않았습니다 - 휴리스틱 분석 사용');
      return analyzeFatigueHeuristic(data);
    }
    
    // 데이터 요약
    const avgPower = data.power && data.power.length > 0 
      ? data.power.reduce((a, b) => a + b, 0) / data.power.length 
      : (window.liveData?.power || 0);
    const avgCadence = data.cadence && data.cadence.length > 0
      ? data.cadence.reduce((a, b) => a + b, 0) / data.cadence.length
      : (window.liveData?.cadence || 0);
    const avgHR = data.heartRate && data.heartRate.length > 0
      ? data.heartRate.reduce((a, b) => a + b, 0) / data.heartRate.length
      : (window.liveData?.heartRate || 0);
    
    // 케이던스 유지 능력 분석
    const cadenceVariance = data.cadence && data.cadence.length > 1
      ? data.cadence.reduce((sum, val) => sum + Math.pow(val - avgCadence, 2), 0) / data.cadence.length
      : 0;
    const cadenceStability = Math.max(0, 100 - (Math.sqrt(cadenceVariance) * 2)); // 안정성 점수 (0-100)
    
    // 목표 대비 달성도
    const powerAchievement = data.targetPower > 0 
      ? (avgPower / data.targetPower) * 100 
      : 100;
    
    // Gemini API 요청
    const prompt = `사이클 훈련 중 피로도 분석 요청:

현재 상태:
- 목표 파워: ${data.targetPower.toFixed(0)}W
- 평균 파워: ${avgPower.toFixed(0)}W (달성도: ${powerAchievement.toFixed(1)}%)
- 평균 케이던스: ${avgCadence.toFixed(0)}rpm (안정성: ${cadenceStability.toFixed(1)}%)
- 평균 심박수: ${avgHR.toFixed(0)}bpm
- 경과 시간: ${Math.floor(data.elapsedTime / 60)}분 ${data.elapsedTime % 60}초

분석 요청:
1. 사용자가 한계에 도달했는지 판단 (케이던스 유지 능력 저하, 심박수 급상승, 파워 달성도 하락 등)
2. 한계 도달 시 ERG 목표 파워를 -5% 낮춰야 하는지 결정
3. 피로도 수준 (0-100)

응답 형식 (JSON):
{
  "shouldReduce": true/false,
  "reductionPercent": 5 (또는 0),
  "fatigueLevel": 0-100,
  "reason": "이유 설명"
}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });
    
    if (!response.ok) {
      throw new Error(`Gemini API 오류: ${response.status}`);
    }
    
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // JSON 파싱
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      return {
        shouldReduce: analysis.shouldReduce || false,
        reductionPercent: analysis.reductionPercent || 0,
        fatigueLevel: analysis.fatigueLevel || 0,
        reason: analysis.reason || ''
      };
    }
    
    // JSON 파싱 실패 시 기본값
    return { shouldReduce: false, fatigueLevel: 0 };
    
  } catch (error) {
    console.error('[ERG AI] Gemini API 호출 오류:', error);
    // 오류 시 간단한 휴리스틱 분석
    return analyzeFatigueHeuristic(data);
  }
}

/**
 * 휴리스틱 기반 피로도 분석 (Gemini API 실패 시 폴백)
 */
function analyzeFatigueHeuristic(data) {
  const avgPower = (data.power && data.power.length > 0)
    ? data.power.reduce((a, b) => a + b, 0) / data.power.length 
    : (window.liveData?.power || 0);
  const avgCadence = (data.cadence && data.cadence.length > 0)
    ? data.cadence.reduce((a, b) => a + b, 0) / data.cadence.length
    : (window.liveData?.cadence || 0);
  const avgHR = (data.heartRate && data.heartRate.length > 0)
    ? data.heartRate.reduce((a, b) => a + b, 0) / data.heartRate.length
    : (window.liveData?.heartRate || 0);
  
  // 케이던스 안정성
  const cadenceVariance = data.cadence.length > 1
    ? data.cadence.reduce((sum, val) => sum + Math.pow(val - avgCadence, 2), 0) / data.cadence.length
    : 0;
  const cadenceStdDev = Math.sqrt(cadenceVariance);
  
  // 목표 대비 달성도
  const powerAchievement = data.targetPower > 0 
    ? (avgPower / data.targetPower) * 100 
    : 100;
  
  // 피로도 판단 기준
  const shouldReduce = (
    powerAchievement < 85 || // 파워 달성도 85% 미만
    cadenceStdDev > 8 || // 케이던스 변동성 큼
    (avgHR > 0 && avgHR > 180) // 심박수 과도
  );
  
  const fatigueLevel = shouldReduce ? 70 : 30;
  
  return {
    shouldReduce: shouldReduce,
    reductionPercent: shouldReduce ? 5 : 0,
    fatigueLevel: fatigueLevel,
    reason: shouldReduce ? '파워 달성도 저하 또는 케이던스 불안정' : '정상 상태'
  };
}

// 전역 함수로 등록
window.initializeErgMode = initializeErgMode;
window.updateErgModeUI = updateErgModeUI;
window.toggleErgMode = toggleErgMode;
window.setErgTargetPower = setErgTargetPower;
window.checkFatigueAndAdjust = checkFatigueAndAdjust;
