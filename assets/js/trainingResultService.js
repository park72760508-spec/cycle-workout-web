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

/**
 * 훈련 세션 저장 및 보상 처리
 * Firestore Transaction을 사용하여 데이터 무결성 보장
 * 
 * @param {string} userId - 사용자 UID
 * @param {Object} trainingData - 훈련 데이터
 * @param {number} trainingData.duration - 훈련 시간(초)
 * @param {number} trainingData.weighted_watts - Normalized Power (NP)
 * @param {number} [trainingData.avg_watts] - 평균 파워 (선택사항)
 * @param {Object} [firestoreInstance] - Firestore 인스턴스 (선택사항, 없으면 window.firestoreV9 사용)
 * @returns {Promise<Object>} 저장 결과
 */
export async function saveTrainingSession(userId, trainingData, firestoreInstance = null) {
  if (!userId) {
    throw new Error('userId는 필수입니다.');
  }
  
  if (!trainingData || !trainingData.duration || !trainingData.weighted_watts) {
    throw new Error('trainingData에 duration과 weighted_watts가 필요합니다.');
  }
  
  // Firestore 인스턴스 확인
  const db = firestoreInstance || window.firestoreV9;
  if (!db) {
    throw new Error('Firestore 인스턴스가 없습니다. window.firestoreV9를 확인하세요.');
  }
  
  const { duration, weighted_watts, avg_watts } = trainingData;
  const durationSec = Number(duration);
  const np = Number(weighted_watts);
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
      
      const userData = userDoc.data();
      
      // 현재 값 가져오기 (기본값 설정)
      const currentFTP = userData.ftp || 200;
      const currentRemPoints = Number(userData.rem_points || 0);
      const currentAccPoints = Number(userData.acc_points || 0);
      const currentExpiryDate = userData.expiry_date;
      
      console.log('[saveTrainingSession] 사용자 현재 상태:', {
        ftp: currentFTP,
        rem_points: currentRemPoints,
        acc_points: currentAccPoints,
        expiry_date: currentExpiryDate?.toDate?.() || currentExpiryDate
      });
      
      // 2. TSS 계산
      const tss = calculateTSS(durationSec, np, currentFTP);
      const earnedPoints = tss; // TSS가 획득 포인트 (정수로 반올림)
      
      console.log('[saveTrainingSession] TSS 계산 결과:', {
        tss,
        earnedPoints,
        durationSec,
        np,
        currentFTP,
        intensityFactor: np / currentFTP,
        formula: `(${durationSec} * ${np} * ${np / currentFTP}) / (${currentFTP} * 3600) * 100`,
        calculatedValue: (durationSec * np * (np / currentFTP)) / (currentFTP * 3600) * 100
      });
      
      if (tss === 0) {
        console.warn('[saveTrainingSession] ⚠️ TSS가 0으로 계산되었습니다. 원인 확인:', {
          durationSec,
          np,
          currentFTP,
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
      
      // 구독 연장 루프: rem_points가 500 이상인 경우
      // 500 포인트당 1일 연장, 연장한 만큼 rem_points에서 500씩 차감
      while (newRemPoints >= 500) {
        extendedDays += 1;
        newRemPoints -= 500;
        expiryDateAsDate = addDaysToDate(expiryDateAsDate, 1);
      }
      
      // Firestore Timestamp로 변환
      newExpiryDate = Timestamp.fromDate(expiryDateAsDate);
      
      console.log('[saveTrainingSession] 포인트 및 구독 연장:', {
        earnedPoints,
        newAccPoints,
        newRemPoints,
        extendedDays,
        newExpiryDate: expiryDateAsDate.toISOString()
      });
      
      // 5. 사용자 정보 업데이트 (Transaction 내에서)
      const userUpdateData = {
        acc_points: newAccPoints,
        rem_points: newRemPoints,
        expiry_date: newExpiryDate
      };
      
      transaction.update(userRef, userUpdateData);
      
      // 6. 훈련 로그 데이터 준비 (트랜잭션 외부에서 저장)
      // userId는 서브컬렉션 경로에 포함되므로 중복 저장 불필요하지만, 
      // 쿼리 편의성을 위해 유지 (선택사항)
      const trainingLogData = {
        userId: userId, // 쿼리 편의성을 위해 유지
        date: Timestamp.now(),
        duration_sec: durationSec,
        avg_watts: avgWatts,
        tss: tss,
        earned_points: earnedPoints
      };
      
      return {
        success: true,
        userUpdateData,
        trainingLogData,
        extendedDays,
        earnedPoints
      };
    });
    
    // 7. 트랜잭션 완료 후 users/{userId}/logs 서브컬렉션에 저장
    // Subcollection 구조: users/{userId}/logs/{logId}
    const userLogsRef = collection(db, 'users', userId, 'logs');
    const trainingLogDocRef = await addDoc(userLogsRef, result.trainingLogData);
    
    console.log('[saveTrainingSession] ✅ 저장 완료:', {
      userId,
      earnedPoints: result.earnedPoints,
      extendedDays: result.extendedDays,
      newRemPoints: result.userUpdateData.rem_points,
      newAccPoints: result.userUpdateData.acc_points,
      newExpiryDate: result.userUpdateData.expiry_date.toDate().toISOString(),
      trainingLogId: trainingLogDocRef.id
    });
    
    return {
      success: true,
      earnedPoints: result.earnedPoints,
      extendedDays: result.extendedDays,
      newRemPoints: result.userUpdateData.rem_points,
      newAccPoints: result.userUpdateData.acc_points,
      newExpiryDate: result.userUpdateData.expiry_date.toDate().toISOString(),
      trainingLogId: trainingLogDocRef.id
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
    const { limit: limitValue = 50, startAfter: startAfterDoc = null } = options;
    
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
      logs.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log(`[getUserTrainingLogs] ${logs.length}개의 로그 조회 완료 (userId: ${userId})`);
    
    return logs;
  } catch (error) {
    console.error('[getUserTrainingLogs] ❌ 조회 실패:', error);
    throw error;
  }
}

/**
 * TSS 계산 함수를 전역으로 노출 (디버깅/테스트용)
 */
if (typeof window !== 'undefined') {
  window.calculateTSS = calculateTSS;
  window.getUserTrainingLogs = getUserTrainingLogs;
}
