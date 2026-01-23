/**
 * 훈련 결과 저장 및 보상 처리 서비스
 * Firebase Firestore v9 SDK (Modular) 사용
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
  Timestamp
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
  
  // 정수로 반올림하여 반환 (earned_sp로 사용)
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
    avgWatts
  });
  
  try {
    // Transaction 실행
    const result = await runTransaction(db, async (transaction) => {
      // 1. 사용자 정보 가져오기
      const userRef = doc(db, 'users', userId);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists()) {
        throw new Error(`사용자를 찾을 수 없습니다: ${userId}`);
      }
      
      const userData = userDoc.data();
      
      // 현재 값 가져오기 (기본값 설정)
      const currentFTP = userData.ftp || 200;
      const currentSpBalance = userData.sp_balance || 0;
      const currentSpTotal = userData.sp_total || 0;
      const currentExpiryDate = userData.expiry_date;
      
      console.log('[saveTrainingSession] 사용자 현재 상태:', {
        ftp: currentFTP,
        sp_balance: currentSpBalance,
        sp_total: currentSpTotal,
        expiry_date: currentExpiryDate?.toDate?.() || currentExpiryDate
      });
      
      // 2. TSS 계산
      const tss = calculateTSS(durationSec, np, currentFTP);
      const earnedSp = tss; // TSS가 획득 포인트
      
      console.log('[saveTrainingSession] TSS 계산 결과:', {
        tss,
        earnedSp,
        formula: `(${durationSec} * ${np} * ${np / currentFTP}) / (${currentFTP} * 3600) * 100`
      });
      
      // 3. 포인트 적립
      const newSpTotal = currentSpTotal + earnedSp;
      let newSpBalance = currentSpBalance + earnedSp;
      
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
      
      // 500 포인트당 1일 연장 루프
      while (newSpBalance >= 500) {
        extendedDays += 1;
        newSpBalance -= 500;
        expiryDateAsDate = addDaysToDate(expiryDateAsDate, 1);
      }
      
      // Firestore Timestamp로 변환
      newExpiryDate = Timestamp.fromDate(expiryDateAsDate);
      
      console.log('[saveTrainingSession] 포인트 및 구독 연장:', {
        earnedSp,
        newSpTotal,
        newSpBalance,
        extendedDays,
        newExpiryDate: expiryDateAsDate.toISOString()
      });
      
      // 5. 사용자 정보 업데이트
      const userUpdateData = {
        sp_total: newSpTotal,
        sp_balance: newSpBalance,
        expiry_date: newExpiryDate
      };
      
      transaction.update(userRef, userUpdateData);
      
      // 6. 훈련 로그 저장 (트랜잭션 외부에서 처리 - addDoc은 트랜잭션에서 사용 불가)
      // 대신 트랜잭션 완료 후 별도로 저장
      const trainingLogData = {
        userId,
        date: Timestamp.now(),
        duration_sec: durationSec,
        avg_watts: avgWatts,
        tss,
        earned_sp: earnedSp
      };
      
      return {
        success: true,
        userUpdateData,
        trainingLogData,
        extendedDays,
        earnedSp
      };
    });
    
    // 트랜잭션 완료 후 training_logs에 저장
    const trainingLogsRef = collection(db, 'training_logs');
    await addDoc(trainingLogsRef, result.trainingLogData);
    
    console.log('[saveTrainingSession] ✅ 저장 완료:', {
      userId,
      earnedSp: result.earnedSp,
      extendedDays: result.extendedDays,
      newSpBalance: result.userUpdateData.sp_balance,
      newExpiryDate: result.userUpdateData.expiry_date.toDate().toISOString()
    });
    
    return {
      success: true,
      earnedSp: result.earnedSp,
      extendedDays: result.extendedDays,
      newSpBalance: result.userUpdateData.sp_balance,
      newSpTotal: result.userUpdateData.sp_total,
      newExpiryDate: result.userUpdateData.expiry_date.toDate().toISOString(),
      trainingLogId: 'saved' // addDoc의 결과는 반환하지 않지만 성공했음을 표시
    };
    
  } catch (error) {
    console.error('[saveTrainingSession] ❌ 저장 실패:', error);
    throw error;
  }
}

/**
 * TSS 계산 함수를 전역으로 노출 (디버깅/테스트용)
 */
if (typeof window !== 'undefined') {
  window.calculateTSS = calculateTSS;
}
