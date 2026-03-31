/**
 * 훈련 결과 저장 및 보상 처리 서비스
 * Firebase Firestore v9 SDK (Modular) 사용
 * Google Sheets에서 Firebase Firestore로 마이그레이션
 * 
 * @module trainingResultService
 */

import { 
  getFirestore, 
  doc, 
  getDoc, 
  updateDoc, 
  collection, 
  addDoc,
  runTransaction,
  Timestamp,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

/**
 * TSS (Training Stress Score) 계산
 * 공식: (duration_sec * NP * IF) / (FTP * 3600) * 100
 * 
 * @param {number} durationSec - 훈련 시간(초)
 * @param {number} weightedWatts - Normalized Power (NP)
 * @param {number} ftp - Functional Threshold Power
 * @returns {number} 계산된 TSS (정수로 반올림)
 */
function calculateTSS(durationSec, weightedWatts, ftp) {
  if (!ftp || ftp <= 0) {
    console.warn('[calculateTSS] FTP가 없거나 0입니다. 기본값 200 사용');
    ftp = 200;
  }
  
  if (!durationSec || durationSec <= 0) {
    return 0;
  }
  
  if (!weightedWatts || weightedWatts <= 0) {
    return 0;
  }
  
  // IF (Intensity Factor) = NP / FTP
  const intensityFactor = weightedWatts / ftp;
  
  // TSS = (duration_sec * NP * IF) / (FTP * 3600) * 100
  const tss = (durationSec * weightedWatts * intensityFactor) / (ftp * 3600) * 100;
  
  // 정수로 반올림하여 반환 (earned_points로 사용)
  return Math.round(tss);
}

/**
 * 날짜에 일수 추가 (구독 연장)
 * 
 * @param {Date} currentDate - 현재 만료일
 * @param {number} days - 추가할 일수
 * @returns {Date} 연장된 날짜
 */
function addDaysToDate(currentDate, days) {
  const newDate = new Date(currentDate);
  newDate.setDate(newDate.getDate() + days);
  return newDate;
}

/** 노이즈 필터 상수 */
const POWER_SPIKE_THRESHOLD_W = 2000;
const POWER_SPIKE_JUMP_W = 1000;
const HR_MAX_BPM = 220;
/** 심박 스파이크: 1초 만에 25bpm 이상 튀는 값 → 인접 평균으로 대체 */
const HR_SPIKE_JUMP_BPM = 25;
const DEFAULT_FTP_W = 150;
const DEFAULT_MAX_HR = 190;

/**
 * 결과 버퍼는 BLE/UI 갱신마다 append되어 초당 여러 샘플이 쌓일 수 있음.
 * 존 시간·MMP·HR 피크는 1Hz를 가정하므로, timestamp가 있으면 초 단위로 병합한다.
 * 각 정수 초에는 해당 구간의 마지막 샘플을 쓰고, 샘플이 없는 초는 직전 값을 유지한다.
 *
 * @param {Array<{t: string|Date, v: number}|number>} samples
 * @param {number} durationSec - 훈련 기록 duration(초). 0이면 샘플 시계열 범위만큼만 생성
 * @returns {number[]}
 */
function streamSamplesToOneHzSeconds(samples, durationSec) {
  if (!samples || samples.length === 0) return [];
  const dur = Math.max(0, Math.floor(Number(durationSec) || 0));
  const pickV = (d) => Number(typeof d === 'object' && d != null && d.v !== undefined ? d.v : d) || 0;
  const first = samples[0];
  const hasTime = first && typeof first === 'object' && first !== null && first.t != null;

  if (!hasTime) {
    const vals = samples.map(pickV);
    if (dur > 0 && vals.length > Math.ceil(dur * 1.2)) {
      const out = [];
      const n = vals.length;
      for (let sec = 0; sec < dur; sec++) {
        const idx = dur <= 1 ? 0 : Math.min(n - 1, Math.round((sec * (n - 1)) / (dur - 1)));
        out.push(vals[idx]);
      }
      return out;
    }
    return vals;
  }

  const t0 = new Date(first.t).getTime();
  if (Number.isNaN(t0)) return samples.map(pickV);

  const lastInSec = new Map();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s || s.t == null) continue;
    const ms = new Date(s.t).getTime();
    if (Number.isNaN(ms)) continue;
    const secIdx = Math.floor((ms - t0) / 1000);
    if (secIdx < 0) continue;
    lastInSec.set(secIdx, Number(s.v) || 0);
  }

  let limit = dur;
  if (limit <= 0) {
    const keys = Array.from(lastInSec.keys());
    limit = keys.length ? Math.max(...keys) + 1 : 0;
  }
  if (limit <= 0) return [];

  const out = [];
  let hold = 0;
  for (let i = 0; i < limit; i++) {
    if (lastInSec.has(i)) hold = lastInSec.get(i);
    out.push(hold);
  }
  return out;
}

/**
 * Coggan 7-Zone: 파워(W) → 존 인덱스 (0=Coasting, 1~7)
 * Z0: 0W, Z1: <55%, Z2: 56-75%, Z3: 76-90%, Z4: 91-105%, Z5: 106-120%, Z6: 121-150%, Z7: >150%
 */
function getPowerZoneIndex(powerW, ftp) {
  const p = Number(powerW) || 0;
  if (p <= 0) return 0;
  if (!ftp || ftp <= 0) return 1;
  const pct = (p / ftp) * 100;
  if (pct < 55) return 1;
  if (pct <= 75) return 2;
  if (pct <= 90) return 3;
  if (pct <= 105) return 4;
  if (pct <= 120) return 5;
  if (pct <= 150) return 6;
  return 7;
}

/**
 * 심박 존: Max HR 기준 5존
 * Z1: 50-60%, Z2: 60-70%, Z3: 70-80%, Z4: 80-90%, Z5: 90-100%
 */
function getHRZoneIndex(hrBpm, maxHr) {
  const hr = Number(hrBpm) || 0;
  if (hr <= 0 || !maxHr || maxHr <= 0) return null;
  const pct = (hr / maxHr) * 100;
  if (pct < 50) return null;
  if (pct < 60) return 1;
  if (pct < 70) return 2;
  if (pct < 80) return 3;
  if (pct < 90) return 4;
  if (pct <= 100) return 5;
  return null;
}

/**
 * 파워 스트림에서 존별 누적 시간(초) 계산. 노이즈 필터 적용.
 * @param {number[]} wattsArray - 1초당 1개 파워 값 배열 (노이즈 필터 적용됨)
 * @param {number} ftp - Functional Threshold Power
 * @returns {Object} { z0, z1, z2, z3, z4, z5, z6, z7 }
 */
function calculateTimeInPowerZones(wattsArray, ftp) {
  const zones = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
  if (!wattsArray || wattsArray.length === 0 || !ftp || ftp <= 0) return zones;
  wattsArray.forEach((w) => {
    const idx = getPowerZoneIndex(w, ftp);
    zones[`z${idx}`] = (zones[`z${idx}`] || 0) + 1;
  });
  return zones;
}

/**
 * 심박 스트림에서 존별 누적 시간(초) 계산. 220bpm 초과 무시.
 * @param {Array} hrData - [{t, v}, ...] 또는 number[]
 * @param {number} maxHr - 최대 심박수
 * @returns {Object} { z1, z2, z3, z4, z5 }
 */
function calculateTimeInHRZones(hrData, maxHr) {
  const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  if (!hrData || hrData.length === 0 || !maxHr || maxHr <= 0) return zones;
  const arr = Array.isArray(hrData) && typeof hrData[0] === 'object' && hrData[0]?.v != null
    ? hrData.map((d) => Number(d.v) || 0)
    : hrData.map((v) => Number(v) || 0);
  arr.forEach((hr) => {
    if (hr <= 0 || hr > HR_MAX_BPM) return;
    const idx = getHRZoneIndex(hr, maxHr);
    if (idx != null) zones[`z${idx}`] = (zones[`z${idx}`] || 0) + 1;
  });
  return zones;
}

/**
 * 1초 단위 Raw Data에서 2000W 초과 스파이크 및 1초 만에 1000W 이상 튀는 값을 직전 3초·직후 3초 평균으로 대체
 * @param {number[]} rawDataArray - 1초당 1개 파워 값 배열
 * @returns {number[]} 스파이크 보간된 배열 (원본 변경 없음)
 */
function smoothPowerSpikes(rawDataArray) {
  if (!rawDataArray || rawDataArray.length === 0) return rawDataArray;
  const arr = rawDataArray.map((v) => Number(v) || 0);
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const prev = i > 0 ? arr[i - 1] : arr[i];
    const isOverThreshold = arr[i] > POWER_SPIKE_THRESHOLD_W;
    const isSpikeJump = i > 0 && Math.abs(arr[i] - prev) > POWER_SPIKE_JUMP_W;
    if (!isOverThreshold && !isSpikeJump) continue;
    const before = [];
    for (let b = 1; b <= 3; b++) {
      if (i - b >= 0) before.push(arr[i - b]);
    }
    const after = [];
    for (let a = 1; a <= 3; a++) {
      if (i + a < len) after.push(arr[i + a]);
    }
    const combined = [...before, ...after];
    arr[i] = combined.length > 0
      ? Math.round(combined.reduce((s, v) => s + v, 0) / combined.length)
      : POWER_SPIKE_THRESHOLD_W;
  }
  return arr;
}

/**
 * 심박 스트림에서 평균 대비 갑자기 튀는 값(스파이크) 제거 → 인접값 평균으로 대체
 * - 1초 만에 HR_SPIKE_JUMP_BPM(25) 이상 변동 시 스파이크로 간주
 * - 220bpm 초과도 스파이크로 간주
 * @param {number[]} rawHrArray - 1초당 1개 심박 값 배열
 * @returns {number[]} 스파이크 보간된 배열
 */
function smoothHeartRateSpikes(rawHrArray) {
  if (!rawHrArray || rawHrArray.length === 0) return rawHrArray || [];
  const arr = rawHrArray.map((v) => Number(v) || 0);
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const prev = i > 0 ? arr[i - 1] : arr[i];
    const isOverMax = arr[i] > HR_MAX_BPM;
    const isSpikeJump = i > 0 && Math.abs(arr[i] - prev) > HR_SPIKE_JUMP_BPM;
    if (!isOverMax && !isSpikeJump) continue;
    const before = [];
    for (let b = 1; b <= 3; b++) {
      if (i - b >= 0 && arr[i - b] > 0 && arr[i - b] <= HR_MAX_BPM) before.push(arr[i - b]);
    }
    const after = [];
    for (let a = 1; a <= 3; a++) {
      if (i + a < len && arr[i + a] > 0 && arr[i + a] <= HR_MAX_BPM) after.push(arr[i + a]);
    }
    const combined = [...before, ...after];
    arr[i] = combined.length > 0
      ? Math.round(combined.reduce((s, v) => s + v, 0) / combined.length)
      : (prev > 0 && prev <= HR_MAX_BPM ? prev : 0);
  }
  return arr;
}

/**
 * 슬라이딩 윈도우로 최대 평균 파워(MMP) 계산
 * @param {Array} wattsArray - 1초당 1개 파워 값 배열
 * @param {number} seconds - 구간(초)
 * @returns {number} 최대 평균 파워 (정수)
 */
function calculateMaxAveragePower(wattsArray, seconds) {
  if (!wattsArray || wattsArray.length < seconds) return 0;
  const arr = wattsArray;
  const len = arr.length;
  let sum = 0;
  for (let i = 0; i < seconds; i++) sum += Number(arr[i]) || 0;
  let maxAvg = sum / seconds;
  for (let i = seconds; i < len; i++) {
    sum -= Number(arr[i - seconds]) || 0;
    sum += Number(arr[i]) || 0;
    const avg = sum / seconds;
    if (avg > maxAvg) maxAvg = avg;
  }
  return Math.round(maxAvg);
}

/**
 * 심박 스트림 배열에서 구간별 최대 평균 심박 계산 (저장 시 1회만 실행, 훈련 루프 영향 없음)
 * STELVIO: max_hr = 5초 롤링 평균의 최대 (스파이크 제거 후, 신뢰도 향상)
 * @param {number[]} heartrateArray - 1초당 1개 심박 값 배열
 * @returns {Object|null} { max_hr_5sec, max_hr_1min, ..., max_hr } 또는 null
 */
function calculateMaxHeartRatePeaks(heartrateArray) {
  if (!heartrateArray || heartrateArray.length === 0) return null;
  const raw = heartrateArray.map((v) => Number(v) || 0);
  const arr = smoothHeartRateSpikes(raw);
  const maxHr5sec = arr.length >= 5 ? Math.round(calculateMaxAveragePower(arr, 5)) : 0;
  const maxHrInstant = arr.length > 0 ? Math.max(...arr.filter((v) => v > 0), 0) : 0;
  const maxHr = maxHr5sec > 0 ? maxHr5sec : (maxHrInstant > 0 ? maxHrInstant : 0);
  if (maxHr <= 0) return null;
  return {
    max_hr_5sec: arr.length >= 5 ? maxHr5sec : null,
    max_hr_1min: arr.length >= 60 ? Math.round(calculateMaxAveragePower(arr, 60)) : null,
    max_hr_5min: arr.length >= 300 ? Math.round(calculateMaxAveragePower(arr, 300)) : null,
    max_hr_10min: arr.length >= 600 ? Math.round(calculateMaxAveragePower(arr, 600)) : null,
    max_hr_20min: arr.length >= 1200 ? Math.round(calculateMaxAveragePower(arr, 1200)) : null,
    max_hr_40min: arr.length >= 2400 ? Math.round(calculateMaxAveragePower(arr, 2400)) : null,
    max_hr_60min: arr.length >= 3600 ? Math.round(calculateMaxAveragePower(arr, 3600)) : null,
    max_hr: maxHr
  };
}

/**
 * 훈련 세션 저장 및 보상 처리
 * Firestore Transaction을 사용하여 데이터 무결성 보장
 * 
 * @param {string} userId - 사용자 UID
 * @param {Object} trainingData - 훈련 데이터
 * @param {number} trainingData.duration - 훈련 시간(초)
 * @param {number} trainingData.weighted_watts - Normalized Power (NP)
 * @param {number} [trainingData.avg_watts] - 평균 파워 (선택사항)
 * @param {number} [trainingData.max_watts] - 최대 파워
 * @param {number} [trainingData.avg_hr] - 평균 심박수
 * @param {number} [trainingData.max_hr] - 최대 심박수
 * @param {number} [trainingData.avg_cadence] - 평균 케이던스
 * @param {number} [trainingData.kilojoules] - 일량 (kJ)
 * @param {string} [trainingData.workout_id] - 워크아웃 ID
 * @param {string} [trainingData.title] - 훈련 제목
 * @param {number} [trainingData.distance_km] - 거리 (km)
 * @param {number} [trainingData.elevation_gain] - 획득 고도 (m)
 * @param {number} [trainingData.rpe] - 주관적 운동 강도 (90-110%)
 * @param {Array} [trainingData.powerData] - 파워 데이터 배열 (존 분포 계산용)
 * @param {Object} [firestoreInstance] - Firestore 인스턴스 (선택사항, 없으면 window.firestoreV9 사용)
 * @returns {Promise<Object>} 저장 결과
 */
export async function saveTrainingSession(userId, trainingData, firestoreInstance = null) {
  if (!userId) {
    throw new Error('userId는 필수입니다.');
  }
  
  if (!trainingData || !trainingData.duration) {
    throw new Error('trainingData에 duration이 필요합니다.');
  }
  
  // Firestore 인스턴스 확인
  const db = firestoreInstance || window.firestoreV9;
  if (!db) {
    throw new Error('Firestore 인스턴스가 없습니다. window.firestoreV9를 확인하세요.');
  }
  
  var td = trainingData || {};
  var duration = td.duration;
  var weighted_watts = td.weighted_watts;
  var avg_watts = td.avg_watts;
  const durationSec = Number(duration);
  // weighted_watts 0 허용 → TSS 0, earned_points 0으로 저장 (워크아웃만 구동된 경우)
  const np = trainingData.weighted_watts != null ? Number(trainingData.weighted_watts) : 0;
  const avgWatts = avg_watts ? Number(avg_watts) : np; // avg_watts가 없으면 NP 사용
  
  console.log('[saveTrainingSession] 시작:', {
    userId,
    durationSec,
    np,
    avgWatts,
    inputData: trainingData
  });
  
  // 입력값 검증 및 경고
  if (durationSec <= 0) {
    console.warn('[saveTrainingSession] ⚠️ duration이 0 이하입니다:', durationSec);
  }
  if (np <= 0) {
    console.warn('[saveTrainingSession] ⚠️ weighted_watts(NP)가 0 이하입니다:', np);
  }
  
  try {
    // Transaction 실행
    const result = await runTransaction(db, async (transaction) => {
      // 1. 사용자 정보 가져오기 (Transaction 내에서)
      const userRef = doc(db, 'users', userId);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists()) {
        throw new Error(`사용자를 찾을 수 없습니다: ${userId}`);
      }
      
      var rawUserData = userDoc.data() || {};
      const userData = rawUserData;
      
      // 현재 값 가져오기 (기본값 설정)
      const currentFTP = userData.ftp || 200;
      const currentRemPoints = Number(userData.rem_points || 0);
      const currentAccPoints = Number(userData.acc_points || 0);
      const currentExpiryDate = userData.expiry_date;
      
      // FTP Fallback: 프로필에 없으면 20분 MMP의 95% 또는 150W (TSS/존 계산에 사용)
      // powerData는 BLE/UI마다 여러 번 append될 수 있음 → duration_sec 길이로 1Hz 정규화
      const rawWattsForFtp = trainingData.powerData && trainingData.powerData.length > 0
        ? streamSamplesToOneHzSeconds(trainingData.powerData, durationSec)
        : [];
      const smoothedForFtp = rawWattsForFtp.length > 0 ? smoothPowerSpikes(rawWattsForFtp) : [];
      const effectiveFTP = currentFTP > 0 ? currentFTP : (
        smoothedForFtp.length >= 1200
          ? Math.round(calculateMaxAveragePower(smoothedForFtp, 1200) * 0.95)
          : DEFAULT_FTP_W
      );
      
      console.log('[saveTrainingSession] 사용자 현재 상태:', {
        ftp: effectiveFTP,
        rem_points: currentRemPoints,
        acc_points: currentAccPoints,
        expiry_date: currentExpiryDate?.toDate?.() || currentExpiryDate
      });
      
      // 2. TSS 계산 (effectiveFTP 사용)
      const tss = calculateTSS(durationSec, np, effectiveFTP);
      const earnedPoints = tss; // TSS가 획득 포인트 (정수로 반올림)
      
      console.log('[saveTrainingSession] TSS 계산 결과:', {
        tss,
        earnedPoints,
        durationSec,
        np,
        effectiveFTP,
        intensityFactor: np / effectiveFTP,
        formula: `(${durationSec} * ${np} * ${np / effectiveFTP}) / (${effectiveFTP} * 3600) * 100`,
        calculatedValue: (durationSec * np * (np / effectiveFTP)) / (effectiveFTP * 3600) * 100
      });
      
      if (tss === 0) {
        console.warn('[saveTrainingSession] ⚠️ TSS가 0으로 계산되었습니다. 원인 확인:', {
          durationSec,
          np,
          effectiveFTP,
          reason: durationSec <= 0 ? 'duration이 0 이하' : (np <= 0 ? 'NP가 0 이하' : '알 수 없음')
        });
      }
      
      // 3. 포인트 적립 및 보상 로직
      // 총 누적 포인트: 기존 값 + earned_points
      const newAccPoints = currentAccPoints + earnedPoints;
      
      // 잔여 포인트: 기존 값 + earned_points
      let newRemPoints = currentRemPoints + earnedPoints;
      
      // 4. 구독 연장 처리
      let newExpiryDate = currentExpiryDate;
      let extendedDays = 0;
      
      // expiry_date가 Timestamp인 경우 Date로 변환
      let expiryDateAsDate;
      if (currentExpiryDate) {
        if (currentExpiryDate.toDate) {
          // Firestore Timestamp
          expiryDateAsDate = currentExpiryDate.toDate();
        } else if (currentExpiryDate instanceof Date) {
          expiryDateAsDate = currentExpiryDate;
        } else if (typeof currentExpiryDate === 'string') {
          expiryDateAsDate = new Date(currentExpiryDate);
        } else {
          // 기본값: 오늘부터 3개월
          expiryDateAsDate = new Date();
          expiryDateAsDate.setMonth(expiryDateAsDate.getMonth() + 3);
        }
      } else {
        // expiry_date가 없으면 오늘부터 3개월로 설정
        expiryDateAsDate = new Date();
        expiryDateAsDate.setMonth(expiryDateAsDate.getMonth() + 3);
      }
      
      // 이미 만료된 사용자: 오늘 기준으로 연장. 미만료: 기존 만료일 기준
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const expiryStart = new Date(expiryDateAsDate);
      expiryStart.setHours(0, 0, 0, 0);
      if (expiryStart.getTime() < todayStart.getTime()) {
        expiryDateAsDate = new Date(todayStart.getTime());
      }
      
      // 구독 연장 루프: rem_points가 500 이상인 경우
      // 500 포인트당 1일 연장, 연장한 만큼 rem_points에서 500씩 차감
      while (newRemPoints >= 500) {
        extendedDays += 1;
        newRemPoints -= 500;
        expiryDateAsDate = addDaysToDate(expiryDateAsDate, 1);
      }
      
      // YYYY-MM-DD 형식으로 변환 (Timestamp 대신 문자열 형식 사용)
      newExpiryDate = expiryDateAsDate.toISOString().split('T')[0];
      
      console.log('[saveTrainingSession] 포인트 및 구독 연장:', {
        earnedPoints,
        newAccPoints,
        newRemPoints,
        extendedDays,
        newExpiryDate: newExpiryDate
      });
      
      // 5. 사용자 정보 업데이트 (Transaction 내에서)
      const userUpdateData = {
        acc_points: newAccPoints,
        rem_points: newRemPoints,
        expiry_date: newExpiryDate
      };
      
      transaction.update(userRef, userUpdateData);
      
      // 6. 훈련 로그 데이터 준비 및 트랜잭션 내에서 로그 저장 (권한 오류 시 포인트 중복 적립 방지)
      // 로그 쓰기가 실패하면 트랜잭션 전체 롤백 → 재시도 시 포인트 이중 적립 없음
      
      // Intensity Factor 계산 (effectiveFTP 사용)
      const intensityFactor = np / effectiveFTP;
      
      // Efficiency Factor 계산 (NP / Avg HR)
      const efficiencyFactor = trainingData.avg_hr && trainingData.avg_hr > 0 
        ? (np / trainingData.avg_hr) 
        : null;
      
      // Max HR: yearly_peaks/{year} 존재 시 반드시 사용, 없을 때만 스트림 최대값 → 기본 190
      const now = new Date();
      const dateStrForLog = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const year = now.getFullYear();
      let maxHr = DEFAULT_MAX_HR;
      let usedYearlyPeaks = false;
      if (userId) {
        try {
          const yearlyPeakRef = doc(db, 'users', userId, 'yearly_peaks', String(year));
          const yearlySnap = await transaction.get(yearlyPeakRef);
          if (yearlySnap.exists()) {
            const yp = yearlySnap.data() || {};
            const v = Number(yp?.max_hr ?? yp?.max_heartrate ?? 0);
            if (v > 0) {
              maxHr = v;
              usedYearlyPeaks = true;
            }
          }
        } catch (e) {
          console.warn('[saveTrainingSession] yearly_peaks 조회 실패:', e.message);
        }
      }
      const hrOneHz = trainingData.hrData && trainingData.hrData.length > 0
        ? streamSamplesToOneHzSeconds(trainingData.hrData, durationSec)
        : [];

      if (!usedYearlyPeaks && hrOneHz.length > 0) {
        const fromStream = Math.max(...hrOneHz.filter((v) => v > 0 && v <= HR_MAX_BPM));
        if (fromStream > 0) maxHr = fromStream;
      }
      
      // 존 분포 계산 (Power: z0~z7, HR: z1~z5)
      const powerZones = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
      const hrZones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
      if (rawWattsForFtp.length > 0) {
        Object.assign(powerZones, calculateTimeInPowerZones(smoothedForFtp, effectiveFTP));
      }
      if (hrOneHz.length > 0) {
        Object.assign(hrZones, calculateTimeInHRZones(hrOneHz, maxHr));
      }
      const timeInZones = { power: powerZones, hr: hrZones };

      // MMP 계산 (powerData가 있으면 1/5/10/20/30/40/60분 피크 파워, 스파이크 보간 적용)
      const wattsArray = smoothedForFtp.length > 0 ? smoothedForFtp : null;
      const max1minWatts = wattsArray && wattsArray.length >= 60 ? calculateMaxAveragePower(wattsArray, 60) : null;
      const max5minWatts = wattsArray && wattsArray.length >= 300 ? calculateMaxAveragePower(wattsArray, 300) : null;
      const max10minWatts = wattsArray && wattsArray.length >= 600 ? calculateMaxAveragePower(wattsArray, 600) : null;
      const max20minWatts = wattsArray && wattsArray.length >= 1200 ? calculateMaxAveragePower(wattsArray, 1200) : null;
      const max30minWatts = wattsArray && wattsArray.length >= 1800 ? calculateMaxAveragePower(wattsArray, 1800) : null;
      const max40minWatts = wattsArray && wattsArray.length >= 2400 ? calculateMaxAveragePower(wattsArray, 2400) : null;
      const max60minWatts = wattsArray && wattsArray.length >= 3600 ? calculateMaxAveragePower(wattsArray, 3600) : null;

      // 심박 피크 계산 (저장 시 1회만, 훈련 루프 영향 없음) — 1Hz 시계열 기준
      const hrPeaks = hrOneHz.length > 0 ? calculateMaxHeartRatePeaks(hrOneHz) : null;

      const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
        ? Number(userData.weight ?? userData.weightKg)
        : null;
      const trainingLogData = {
        // 기본 정보
        userId: userId, // 쿼리 편의성을 위해 유지
        source: "stelvio",
        activity_type: "Stelvio", // 실내 사이클링, MMP/로그분석 시 구분용
        date: dateStrForLog,
        earned_points: earnedPoints,
        workout_id: trainingData.workout_id || null,
        title: trainingData.title || null,
        
        // 기본 정보 (Context)
        duration_sec: durationSec,
        distance_km: trainingData.distance_km || null,
        elevation_gain: trainingData.elevation_gain || null,
        weight: userWeight,
        
        // 파워 & 부하 (Power & Load)
        ftp_at_time: effectiveFTP, // 훈련 당시의 FTP (Fallback: 20분 MMP 95% 또는 150W)
        avg_watts: avgWatts,
        weighted_watts: np, // NP (Normalized Power)
        max_watts: trainingData.max_watts || null,
        tss: tss,
        if: Math.round(intensityFactor * 100) / 100, // Intensity Factor (소수점 2자리)
        kilojoules: trainingData.kilojoules || null,
        
        // 심박 & 효율 (Heart Rate & Efficiency)
        avg_hr: trainingData.avg_hr || null,
        max_hr: trainingData.max_hr || (hrPeaks ? hrPeaks.max_hr : null),
        efficiency_factor: efficiencyFactor ? Math.round(efficiencyFactor * 100) / 100 : null,
        // 심박 피크 (5초, 1분, 5분, 10분, 20분, 40분, 60분)
        ...(hrPeaks && hrPeaks.max_hr_5sec != null && { max_hr_5sec: hrPeaks.max_hr_5sec }),
        ...(hrPeaks && hrPeaks.max_hr_1min != null && { max_hr_1min: hrPeaks.max_hr_1min }),
        ...(hrPeaks && hrPeaks.max_hr_5min != null && { max_hr_5min: hrPeaks.max_hr_5min }),
        ...(hrPeaks && hrPeaks.max_hr_10min != null && { max_hr_10min: hrPeaks.max_hr_10min }),
        ...(hrPeaks && hrPeaks.max_hr_20min != null && { max_hr_20min: hrPeaks.max_hr_20min }),
        ...(hrPeaks && hrPeaks.max_hr_40min != null && { max_hr_40min: hrPeaks.max_hr_40min }),
        ...(hrPeaks && hrPeaks.max_hr_60min != null && { max_hr_60min: hrPeaks.max_hr_60min }),
        
        // 케이던스 (Technique)
        avg_cadence: trainingData.avg_cadence || null,
        
        // MMP (피크 파워)
        ...(max1minWatts != null && { max_1min_watts: max1minWatts }),
        ...(max5minWatts != null && { max_5min_watts: max5minWatts }),
        ...(max10minWatts != null && { max_10min_watts: max10minWatts }),
        ...(max20minWatts != null && { max_20min_watts: max20minWatts }),
        ...(max30minWatts != null && { max_30min_watts: max30minWatts }),
        ...(max40minWatts != null && { max_40min_watts: max40minWatts }),
        ...(max60minWatts != null && { max_60min_watts: max60minWatts }),
        
        // 존 분포 (Zone Distribution)
        time_in_zones: timeInZones,
        
        // 주관적 느낌 (RPE)
        rpe: trainingData.rpe || null // 90% ~ 110% 몸상태
      };
      
      // 7. 트랜잭션 내에서 로그 문서 저장 (실패 시 user 업데이트도 롤백 → 재시도 시 포인트 중복 없음)
      const userLogsRef = collection(db, 'users', userId, 'logs');
      const logRef = doc(userLogsRef);
      transaction.set(logRef, trainingLogData);
      
      return {
        success: true,
        userUpdateData,
        trainingLogData,
        extendedDays,
        earnedPoints,
        trainingLogId: logRef.id
      };
    });
    
    console.log('[saveTrainingSession] ✅ 저장 완료:', {
      userId,
      earnedPoints: result.earnedPoints,
      extendedDays: result.extendedDays,
      newRemPoints: result.userUpdateData.rem_points,
      newAccPoints: result.userUpdateData.acc_points,
      newExpiryDate: result.userUpdateData.expiry_date,
      trainingLogId: result.trainingLogId
    });
    
    return {
      success: true,
      earnedPoints: result.earnedPoints,
      extendedDays: result.extendedDays,
      newRemPoints: result.userUpdateData.rem_points,
      newAccPoints: result.userUpdateData.acc_points,
      newExpiryDate: result.userUpdateData.expiry_date,
      trainingLogId: result.trainingLogId
    };
    
  } catch (error) {
    console.error('[saveTrainingSession] ❌ 저장 실패:', error);
    console.error('[saveTrainingSession] 오류 상세:', {
      message: error.message,
      stack: error.stack,
      userId,
      trainingData
    });
    throw error;
  }
}

/**
 * 사용자의 훈련 로그 조회 (Subcollection 구조)
 * 
 * @param {string} userId - 사용자 UID
 * @param {Object} [options] - 조회 옵션
 * @param {number} [options.limit] - 최대 조회 개수 (기본값: 50)
 * @param {Object} [options.startAfter] - 페이지네이션용 시작 문서
 * @param {Object} [firestoreInstance] - Firestore 인스턴스 (선택사항)
 * @returns {Promise<Array>} 훈련 로그 배열
 */
/**
 * 사용자의 훈련 로그 조회 (Subcollection 구조)
 * 
 * @param {string} userId - 사용자 UID
 * @param {Object} [options] - 조회 옵션
 * @param {number} [options.limit] - 최대 조회 개수 (기본값: 50)
 * @param {Object} [options.startAfter] - 페이지네이션용 시작 문서
 * @param {Object} [firestoreInstance] - Firestore 인스턴스 (선택사항)
 * @returns {Promise<Array>} 훈련 로그 배열
 */
export async function getUserTrainingLogs(userId, options = {}, firestoreInstance = null) {
  if (!userId) {
    throw new Error('userId는 필수입니다.');
  }
  
  const db = firestoreInstance || window.firestoreV9;
  if (!db) {
    throw new Error('Firestore 인스턴스가 없습니다. window.firestoreV9를 확인하세요.');
  }
  
  try {
    var opt = options || {};
    var limitValue = opt.limit != null ? opt.limit : 50;
    var startAfterDoc = opt.startAfter != null ? opt.startAfter : null;
    
    // users/{userId}/logs 서브컬렉션 참조
    const userLogsRef = collection(db, 'users', userId, 'logs');
    
    // 쿼리 빌더 생성 (날짜 내림차순 정렬)
    let q = query(userLogsRef, orderBy('date', 'desc'), limit(limitValue));
    
    // 페이지네이션 지원
    if (startAfterDoc) {
      q = query(q, startAfter(startAfterDoc));
    }
    
    const querySnapshot = await getDocs(q);
    const logs = [];
    
    querySnapshot.forEach((doc) => {
      var dd = doc.data() || {};
      var o = { id: doc.id };
      if (dd && typeof dd === 'object') { for (var k in dd) { if (dd.hasOwnProperty(k)) o[k] = dd[k]; } }
      logs.push(o);
    });
    
    console.log(`[getUserTrainingLogs] ${logs.length}개의 로그 조회 완료 (userId: ${userId})`);
    
    return logs;
  } catch (error) {
    console.error('[getUserTrainingLogs] ❌ 조회 실패:', error);
    throw error;
  }
}

/**
 * 특정 연·월의 훈련 로그 조회 (훈련일지 달력 월별 표시용)
 * date 필드가 Firestore Timestamp 또는 문자열 "YYYY-MM-DD" 모두 지원
 *
 * @param {string} userId - 사용자 UID
 * @param {number} year - 연도 (예: 2025)
 * @param {number} month - 월 (0-11, 1월=0)
 * @param {Object} [firestoreInstance] - Firestore 인스턴스 (선택)
 * @returns {Promise<Array>} 해당 월의 훈련 로그 배열
 */
export async function getTrainingLogsByDateRange(userId, year, month, firestoreInstance = null) {
  if (!userId) {
    throw new Error('userId는 필수입니다.');
  }

  const db = firestoreInstance || window.firestoreV9;
  if (!db) {
    throw new Error('Firestore 인스턴스가 없습니다.');
  }

  // 해당 월의 첫 날 00:00:00과 마지막 날 23:59:59
  const startDate = new Date(year, month, 1, 0, 0, 0, 0);
  const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
  
  // 문자열 형식: YYYY-MM-DD (로컬 시간 기준)
  const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

  console.log(`[getTrainingLogsByDateRange] 조회 시작: ${year}년 ${month + 1}월`, {
    userId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    startStr,
    endStr
  });

  const userLogsRef = collection(db, 'users', userId, 'logs');
  const seen = new Set();
  const logs = [];

  try {
    // 1) date가 Timestamp로 저장된 문서 조회
    const startTs = Timestamp.fromDate(startDate);
    const endTs = Timestamp.fromDate(endDate);
    const qTimestamp = query(
      userLogsRef,
      where('date', '>=', startTs),
      where('date', '<=', endTs)
    );
    const snapTs = await getDocs(qTimestamp);
    console.log(`[getTrainingLogsByDateRange] Timestamp 쿼리 결과: ${snapTs.size}건`);
    snapTs.forEach((docSnap) => {
      seen.add(docSnap.id);
      var data = docSnap.data() || {};
      var o = { id: docSnap.id };
      if (data && typeof data === 'object') { for (var k in data) { if (data.hasOwnProperty(k)) o[k] = data[k]; } }
      logs.push(o);
    });
  } catch (e) {
    console.warn('[getTrainingLogsByDateRange] Timestamp 범위 쿼리 실패 (무시):', e.message, e.code);
  }

  try {
    // 2) date가 문자열 "YYYY-MM-DD"로 저장된 문서 조회
    const qStr = query(
      userLogsRef,
      where('date', '>=', startStr),
      where('date', '<=', endStr)
    );
    const snapStr = await getDocs(qStr);
    console.log(`[getTrainingLogsByDateRange] 문자열 쿼리 결과: ${snapStr.size}건`);
    snapStr.forEach((docSnap) => {
      if (seen.has(docSnap.id)) return;
      seen.add(docSnap.id);
      var data = docSnap.data() || {};
      var o = { id: docSnap.id };
      if (data && typeof data === 'object') { for (var k in data) { if (data.hasOwnProperty(k)) o[k] = data[k]; } }
      logs.push(o);
    });
  } catch (e) {
    console.warn('[getTrainingLogsByDateRange] 문자열 date 범위 쿼리 실패 (무시):', e.message, e.code);
  }

  console.log(`[getTrainingLogsByDateRange] ${year}년 ${month + 1}월: 총 ${logs.length}건 조회 완료 (userId: ${userId})`, {
    sampleDates: logs.slice(0, 5).map(log => ({
      id: log.id,
      date: log.date,
      dateType: typeof log.date,
      hasToDate: log.date && typeof log.date.toDate === 'function',
      title: log.title || '제목 없음'
    }))
  });
  
  return logs;
}

/**
 * TSS 계산 함수를 전역으로 노출 (디버깅/테스트용)
 */
if (typeof window !== 'undefined') {
  window.calculateTSS = calculateTSS;
  window.getUserTrainingLogs = getUserTrainingLogs;
  window.getTrainingLogsByDateRange = getTrainingLogsByDateRange;
}
