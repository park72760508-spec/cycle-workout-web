/* ==========================================================
   훈련 결과 Firebase 관리 모듈 (trainingResultsManager.js)
   - Firebase Firestore로 훈련 결과 저장/조회
   - Google Sheets 구조와 동일한 필드 유지
========================================================== */

// Firestore 컬렉션 참조 헬퍼 함수들
function getTrainingResultsCollection() {
  if (!window.firestore) {
    throw new Error('Firestore가 초기화되지 않았습니다. firebaseConfig.js가 먼저 로드되어야 합니다.');
  }
  return window.firestore.collection('training_results');
}

function getScheduleResultsCollection() {
  if (!window.firestore) {
    throw new Error('Firestore가 초기화되지 않았습니다. firebaseConfig.js가 먼저 로드되어야 합니다.');
  }
  return window.firestore.collection('schedule_results');
}

function getTrainingLogCollection() {
  if (!window.firestore) {
    throw new Error('Firestore가 초기화되지 않았습니다. firebaseConfig.js가 먼저 로드되어야 합니다.');
  }
  return window.firestore.collection('training_log');
}

/**
 * 훈련 결과 저장 (Firebase Firestore)
 * Google Sheets 구조와 동일한 필드:
 * ['id', 'user_id', 'workout_id', 'started_at', 'completed_at', 'avg_power', 'max_power', 'avg_hr', 'max_hr', 'total_energy', 'tss', 'notes']
 */
async function saveTrainingResultToFirebase(data) {
  try {
    const collection = getTrainingResultsCollection();
    
    // ID 생성 (문서 ID로 사용)
    const id = data.id || `tr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Google Sheets 구조와 동일한 필드로 변환
    const trainingResult = {
      id: id,
      user_id: data.user_id || data.userId || '',
      workout_id: data.workout_id || data.workoutId || '',
      started_at: data.started_at || data.startTime || '',
      completed_at: data.completed_at || data.endTime || '',
      avg_power: Number(data.avg_power || data.avgPower || 0),
      max_power: Number(data.max_power || data.maxPower || 0),
      avg_hr: Number(data.avg_hr || data.avgHR || data.avgHr || 0),
      max_hr: Number(data.max_hr || data.maxHR || data.maxHr || 0),
      total_energy: Number(data.total_energy || data.totalEnergy || data.calories || 0),
      tss: Number(data.tss || 0),
      notes: String(data.notes || ''),
      created_at: data.created_at || new Date().toISOString()
    };
    
    // Firestore에 저장 (id를 문서 ID로 사용)
    await collection.doc(id).set(trainingResult);
    
    console.log('[saveTrainingResultToFirebase] ✅ 저장 완료:', id);
    return { success: true, id: id };
  } catch (error) {
    console.error('[saveTrainingResultToFirebase] ❌ 저장 실패:', error);
    throw error;
  }
}

/**
 * 스케줄 결과 저장 (Firebase Firestore)
 * Google Sheets 구조와 동일한 필드:
 * ['id', 'schedule_day_id', 'user_id', 'actual_workout_id', 'status', 'duration_min', 'avg_power', 'np', 'tss', 'hr_avg', 'rpe', 'completed_at', 'created_at', 'updated_at']
 */
async function saveScheduleResultToFirebase(data) {
  try {
    const collection = getScheduleResultsCollection();
    
    // scheduleDayId 처리: 빈 문자열이거나 null이면 null로 저장
    const scheduleDayId = (data.scheduleDayId && String(data.scheduleDayId).trim() !== '') 
      ? String(data.scheduleDayId).trim() 
      : null;
    
    // 기존 결과 확인 (schedule_day_id와 user_id로 찾기)
    let existingResult = null;
    let existingDocId = null;
    
    if (scheduleDayId) {
      // schedule_day_id가 있는 경우: 기존 로직 사용
      const querySnapshot = await collection
        .where('schedule_day_id', '==', scheduleDayId)
        .where('user_id', '==', data.userId || '')
        .limit(1)
        .get();
      
      if (!querySnapshot.empty) {
        existingResult = querySnapshot.docs[0].data();
        existingDocId = querySnapshot.docs[0].id;
      }
    } else {
      // schedule_day_id가 null인 경우: user_id와 completed_at 날짜로 찾기 (같은 날 같은 사용자의 결과)
      const today = new Date().toISOString().split('T')[0];
      const querySnapshot = await collection
        .where('schedule_day_id', '==', null)
        .where('user_id', '==', data.userId || '')
        .where('completed_at', '>=', `${today}T00:00:00`)
        .where('completed_at', '<=', `${today}T23:59:59`)
        .orderBy('completed_at', 'desc')
        .limit(1)
        .get();
      
      if (!querySnapshot.empty) {
        existingResult = querySnapshot.docs[0].data();
        existingDocId = querySnapshot.docs[0].id;
      }
    }
    
    // 한국 시간대(Asia/Seoul)로 현재 시간 변환
    const now = new Date();
    const koreaTimeZone = 'Asia/Seoul';
    const currentTime = new Date(now.toLocaleString('en-US', { timeZone: koreaTimeZone })).toISOString();
    
    // ID 생성 또는 기존 ID 사용
    const id = existingResult ? existingResult.id : `sr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Google Sheets 구조와 동일한 필드로 변환
    const scheduleResult = {
      id: id,
      schedule_day_id: scheduleDayId,
      user_id: data.userId || null,
      actual_workout_id: data.actualWorkoutId || null,
      status: data.status || 'completed',
      duration_min: Number(data.duration_min || 0),
      avg_power: Number(data.avg_power || 0),
      np: Number(data.np || 0),
      tss: Number(data.tss || 0),
      hr_avg: Number(data.hr_avg || 0),
      rpe: Number(data.rpe || 0),
      completed_at: currentTime,
      created_at: existingResult ? (existingResult.created_at || currentTime) : currentTime,
      updated_at: currentTime
    };
    
    // Firestore에 저장 또는 업데이트
    if (existingDocId) {
      await collection.doc(existingDocId).update(scheduleResult);
      console.log('[saveScheduleResultToFirebase] ✅ 업데이트 완료:', id);
    } else {
      await collection.doc(id).set(scheduleResult);
      console.log('[saveScheduleResultToFirebase] ✅ 저장 완료:', id);
    }
    
    return { success: true, id: id, message: 'Schedule result saved successfully' };
  } catch (error) {
    console.error('[saveScheduleResultToFirebase] ❌ 저장 실패:', error);
    throw error;
  }
}

/**
 * 훈련 결과 조회 (Firebase Firestore)
 */
async function getTrainingResultsFromFirebase(userId, startDate, endDate) {
  try {
    const collection = getTrainingResultsCollection();
    let query = collection;
    
    // 사용자 필터
    if (userId) {
      query = query.where('user_id', '==', userId);
    }
    
    // 날짜 필터 (started_at 필드 기준)
    // Firestore는 복합 쿼리 인덱스가 필요할 수 있으므로, 필터링은 클라이언트에서도 수행
    if (startDate || endDate) {
      // 날짜 필터가 있는 경우 started_at 기준 정렬 필요
      query = query.orderBy('started_at', 'desc');
    } else {
      // 날짜 필터가 없으면 기본 정렬
      query = query.orderBy('started_at', 'desc');
    }
    
    const querySnapshot = await query.get();
    let results = querySnapshot.docs.map(doc => doc.data());
    
    // 클라이언트 측 날짜 필터링 (Firestore 쿼리 제한 보완)
    if (startDate) {
      results = results.filter(r => {
        const startedAt = r.started_at || '';
        return startedAt >= startDate;
      });
    }
    if (endDate) {
      results = results.filter(r => {
        const startedAt = r.started_at || '';
        return startedAt <= endDate;
      });
    }
    
    return { success: true, items: results };
  } catch (error) {
    console.error('[getTrainingResultsFromFirebase] ❌ 조회 실패:', error);
    // 인덱스 오류인 경우 안내 메시지 추가
    if (error.message && error.message.includes('index')) {
      console.warn('[getTrainingResultsFromFirebase] ⚠️ Firestore 인덱스가 필요할 수 있습니다. Firebase 콘솔에서 인덱스를 생성하세요.');
    }
    return { success: false, error: error.message, items: [] };
  }
}

/**
 * 스트라바 활동 저장 (Firebase Firestore)
 * Subcollection 구조: users/{userId}/logs/{logId}
 * Google Sheets 구조와 동일한 필드:
 * ['activity_id', 'date', 'title', 'distance_km', 'time', 'tss', 'user_id']
 */
async function saveStravaActivityToFirebase(activity) {
  try {
    console.log('[saveStravaActivityToFirebase] 저장 시작:', activity);
    
    const userId = String(activity.user_id || '');
    if (!userId) {
      throw new Error('user_id가 필요합니다.');
    }
    
    // Firestore 초기화 확인
    if (!window.firestore) {
      throw new Error('Firestore가 초기화되지 않았습니다.');
    }
    
    // 현재 로그인한 사용자 확인
    const currentUser = window.firebase?.auth()?.currentUser;
    if (!currentUser) {
      throw new Error('로그인한 사용자가 없습니다.');
    }
    
    console.log('[saveStravaActivityToFirebase] 사용자 정보:', {
      targetUserId: userId,
      currentUserId: currentUser.uid,
      isSameUser: currentUser.uid === userId
    });
    
    // users/{userId}/logs 서브컬렉션 참조
    const userLogsRef = window.firestore.collection('users').doc(userId).collection('logs');
    const activityId = String(activity.activity_id || activity.id);
    
    if (!activityId) {
      throw new Error('activity_id가 필요합니다.');
    }
    
    console.log('[saveStravaActivityToFirebase] 중복 확인 시작:', { userId, activityId });
    
    // 중복 확인 (activity_id로 검색)
    const existingQuery = await userLogsRef
      .where('activity_id', '==', activityId)
      .limit(1)
      .get();
    
    if (!existingQuery.empty) {
      console.log('[saveStravaActivityToFirebase] ⚠️ 이미 존재하는 활동:', activityId);
      return { success: true, id: activityId, isNew: false };
    }
    
    // Google Sheets 구조와 동일한 필드로 변환
    const trainingLog = {
      activity_id: activityId,
      date: activity.date || '',
      title: String(activity.title || ''),
      distance_km: Number(activity.distance_km || 0),
      time: Number(activity.time || 0),
      tss: Number(activity.tss || 0),
      user_id: userId,
      // 추가 필드: Strava 활동임을 표시
      source: 'strava',
      created_at: new Date().toISOString()
    };
    
    console.log('[saveStravaActivityToFirebase] 저장할 데이터:', trainingLog);
    console.log('[saveStravaActivityToFirebase] Firestore 저장 시도...');
    
    // Firestore에 저장 (자동 생성된 문서 ID 사용)
    const docRef = await userLogsRef.add(trainingLog);
    
    console.log('[saveStravaActivityToFirebase] ✅ 저장 완료:', { 
      userId, 
      activityId, 
      logId: docRef.id,
      path: docRef.path
    });
    
    return { success: true, id: docRef.id, activityId: activityId, isNew: true };
  } catch (error) {
    console.error('[saveStravaActivityToFirebase] ❌ 저장 실패:', error);
    console.error('[saveStravaActivityToFirebase] 에러 상세:', {
      errorCode: error.code,
      errorMessage: error.message,
      errorStack: error.stack,
      activity: activity
    });
    
    // 권한 오류인 경우 더 명확한 메시지
    if (error.code === 'permission-denied') {
      throw new Error(`권한 오류: 사용자 ${activity.user_id}의 활동을 저장할 권한이 없습니다. Firestore 규칙을 확인하세요.`);
    }
    
    throw error;
  }
}

/**
 * 스트라바 활동 목록 조회 (중복 확인용)
 * Subcollection 구조: users/{userId}/logs에서 activity_id 조회
 */
async function getExistingStravaActivityIds() {
  try {
    console.log('[getExistingStravaActivityIds] 기존 활동 ID 조회 시작');
    const existingIds = new Set();
    
    // Firestore 초기화 확인
    if (!window.firestore) {
      console.warn('[getExistingStravaActivityIds] ⚠️ Firestore가 초기화되지 않았습니다.');
      return new Set();
    }
    
    // 모든 사용자의 logs 서브컬렉션에서 activity_id 조회
    const usersCollection = window.firestore.collection('users');
    console.log('[getExistingStravaActivityIds] 사용자 목록 조회 중...');
    const usersSnapshot = await usersCollection.get();
    
    console.log(`[getExistingStravaActivityIds] 총 ${usersSnapshot.size}명의 사용자 발견`);
    
    // 각 사용자의 logs 서브컬렉션 조회
    let processedUsers = 0;
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userLogsRef = userDoc.ref.collection('logs');
      
      try {
        const logsSnapshot = await userLogsRef
          .where('source', '==', 'strava')
          .select('activity_id')
          .get();
        
        const userActivityCount = logsSnapshot.size;
        if (userActivityCount > 0) {
          console.log(`[getExistingStravaActivityIds] 사용자 ${userId}: ${userActivityCount}개의 활동 발견`);
        }
        
        logsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.activity_id) {
            existingIds.add(String(data.activity_id));
          }
        });
        
        processedUsers++;
      } catch (error) {
        console.warn(`[getExistingStravaActivityIds] 사용자 ${userId}의 logs 조회 실패:`, error);
        console.warn(`[getExistingStravaActivityIds] 에러 상세:`, {
          errorCode: error.code,
          errorMessage: error.message,
          userId: userId
        });
        // 계속 진행
      }
    }
    
    console.log(`[getExistingStravaActivityIds] ✅ 조회 완료: ${processedUsers}명 처리, 총 ${existingIds.size}개의 기존 활동 ID 발견`);
    return existingIds;
  } catch (error) {
    console.error('[getExistingStravaActivityIds] ❌ 조회 실패:', error);
    console.error('[getExistingStravaActivityIds] 에러 상세:', {
      errorCode: error.code,
      errorMessage: error.message,
      errorStack: error.stack
    });
    return new Set();
  }
}

// 전역 함수로 등록
window.saveTrainingResultToFirebase = saveTrainingResultToFirebase;
window.saveScheduleResultToFirebase = saveScheduleResultToFirebase;
window.getTrainingResultsFromFirebase = getTrainingResultsFromFirebase;
window.saveStravaActivityToFirebase = saveStravaActivityToFirebase;
window.getExistingStravaActivityIds = getExistingStravaActivityIds;
