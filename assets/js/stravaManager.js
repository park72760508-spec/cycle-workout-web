/* ==========================================================
   스트라바 관리 모듈 (stravaManager.js)
   - Firebase Firestore로 스트라바 토큰 관리
   - 스트라바 활동 동기화
========================================================== */

// Firestore users 컬렉션 참조
function getUsersCollection() {
  if (!window.firestore) {
    throw new Error('Firestore가 초기화되지 않았습니다. firebaseConfig.js가 먼저 로드되어야 합니다.');
  }
  return window.firestore.collection('users');
}

/**
 * 스트라바 토큰 갱신 (Firebase Firestore)
 * Code.gs의 refreshStravaTokenForUser를 Firebase로 마이그레이션
 */
async function refreshStravaTokenForUser(userId, refreshToken) {
  if (!refreshToken || !userId) {
    return { success: false, error: 'userId와 refresh_token이 필요합니다.' };
  }

  const STRAVA_CLIENT_ID = '197363';
  const STRAVA_CLIENT_SECRET = '6cd67a28f1c516c0f004f1c7f97f4d74be187d85';
  const tokenUrl = 'https://www.strava.com/api/v3/oauth/token';
  
  const payload = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: payload.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errJson = JSON.parse(errorText);
        return { success: false, error: errJson.message || `Strava token error: ${response.status}` };
      } catch (e) {
        return { success: false, error: `Strava token error: ${response.status} ${errorText}` };
      }
    }

    const tokenData = await response.json();
    const accessToken = tokenData.access_token || '';
    const newRefreshToken = tokenData.refresh_token || refreshToken;
    const expiresAt = tokenData.expires_at != null ? Number(tokenData.expires_at) : 0;

    if (!accessToken) {
      return { success: false, error: 'Strava에서 access_token을 받지 못했습니다.' };
    }

    // Firebase Firestore에 새 토큰 저장
    try {
      const usersCollection = getUsersCollection();
      await usersCollection.doc(userId).update({
        strava_access_token: accessToken,
        strava_refresh_token: newRefreshToken,
        strava_expires_at: expiresAt
      });

      console.log('[refreshStravaTokenForUser] ✅ 토큰 갱신 및 저장 완료:', userId);
      return { success: true, accessToken: accessToken };
    } catch (firebaseError) {
      console.error('[refreshStravaTokenForUser] ❌ Firebase 저장 실패:', firebaseError);
      return { success: false, error: 'Firebase 저장 실패: ' + firebaseError.message };
    }
  } catch (error) {
    console.error('[refreshStravaTokenForUser] ❌ 토큰 요청 실패:', error);
    return { success: false, error: 'Strava 토큰 요청 실패: ' + (error.message || error) };
  }
}

/**
 * 스트라바 활동 목록 가져오기
 * Code.gs의 fetchStravaActivities를 프론트엔드로 마이그레이션
 */
async function fetchStravaActivities(accessToken, perPage = 30) {
  const url = `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errJson = JSON.parse(errorText);
        return { success: false, error: errJson.message || `Strava activities error: ${response.status}` };
      } catch (e) {
        return { success: false, error: `Strava activities error: ${response.status} ${errorText}` };
      }
    }

    const activities = await response.json();
    return { success: true, activities: Array.isArray(activities) ? activities : [] };
  } catch (error) {
    console.error('[fetchStravaActivities] ❌ 활동 요청 실패:', error);
    return { success: false, error: 'Strava 활동 요청 실패: ' + (error.message || error) };
  }
}

/**
 * Strava 활동에서 TSS 계산
 * Code.gs의 computeTssFromActivity를 프론트엔드로 마이그레이션
 */
function computeTssFromActivity(activity, ftp) {
  const durationSec = Number(activity.moving_time) || 0;
  if (durationSec <= 0) return 0;

  let np = Number(activity.weighted_average_watts) || Number(activity.average_watts) || 0;
  if (np <= 0) return 0;

  ftp = Number(ftp) || 0;
  if (ftp <= 0) return 0;

  const ifVal = np / ftp;
  const tss = (durationSec * np * ifVal) / (ftp * 3600) * 100;
  return Math.max(0, Math.round(tss * 100) / 100);
}

/**
 * 스트라바 활동 동기화 및 포인트 적립 (Firebase)
 * Code.gs의 fetchAndProcessStravaData를 Firebase로 마이그레이션
 */
async function fetchAndProcessStravaData() {
  const errors = [];
  let processed = 0;
  let newActivitiesTotal = 0;
  const totalTssByUser = {};

  try {
    // Firebase에서 strava_refresh_token이 있는 사용자 조회
    const usersCollection = getUsersCollection();
    const usersSnapshot = await usersCollection
      .where('strava_refresh_token', '!=', '')
      .where('strava_refresh_token', '!=', null)
      .get();

    if (usersSnapshot.empty) {
      return { 
        success: true, 
        processed: 0, 
        newActivities: 0, 
        totalTssByUser: {}, 
        errors: ['Strava refresh_token이 있는 사용자가 없습니다.'] 
      };
    }

    // 기존 활동 ID 목록 조회
    const existingIds = await (typeof window.getExistingStravaActivityIds === 'function' 
      ? window.getExistingStravaActivityIds() 
      : Promise.resolve(new Set()));

    // 각 사용자별로 처리
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      const refreshToken = userData.strava_refresh_token;
      const ftp = Number(userData.ftp) || 0;

      if (!refreshToken || !userId) continue;

      let totalTss = 0;
      let newCount = 0;

      // 토큰 갱신
      const tokenResult = await refreshStravaTokenForUser(userId, refreshToken);
      if (!tokenResult.success) {
        errors.push(`사용자 ${userId}: 토큰 갱신 실패 - ${tokenResult.error || ''}`);
        continue;
      }

      // 활동 조회
      const actResult = await fetchStravaActivities(tokenResult.accessToken, 30);
      if (!actResult.success) {
        errors.push(`사용자 ${userId}: 활동 조회 실패 - ${actResult.error || ''}`);
        continue;
      }

      processed += 1;
      const activities = actResult.activities || [];

      // 각 활동 처리
      for (const act of activities) {
        const actId = String(act.id);
        if (existingIds.has(actId)) continue;

        const startDate = act.start_date || act.start_date_local || '';
        let dateStr = '';
        if (startDate) {
          try {
            const d = new Date(startDate);
            dateStr = d.toISOString().split('T')[0];
          } catch (e) {
            dateStr = startDate;
          }
        }
        const title = act.name || '';
        const distanceKm = (Number(act.distance) || 0) / 1000;
        const movingTime = Math.round(Number(act.moving_time) || 0);
        const tss = computeTssFromActivity(act, ftp);

        // Firebase에 저장
        if (typeof window.saveStravaActivityToFirebase === 'function') {
          try {
            const saveResult = await window.saveStravaActivityToFirebase({
              activity_id: actId,
              date: dateStr,
              title: title,
              distance_km: Math.round(distanceKm * 100) / 100,
              time: movingTime,
              tss: tss,
              user_id: userId
            });

            if (saveResult.isNew) {
              existingIds.add(actId);
              newCount += 1;
              totalTss += tss;
            }
          } catch (saveError) {
            console.error(`[fetchAndProcessStravaData] 활동 저장 실패 (${actId}):`, saveError);
            errors.push(`활동 ${actId} 저장 실패: ${saveError.message}`);
          }
        }
      }

      newActivitiesTotal += newCount;
      if (totalTss > 0) {
        totalTssByUser[userId] = (totalTssByUser[userId] || 0) + totalTss;
      }
    }

    // 저장된 활동의 TSS만큼 포인트 적립 및 rem_points 500 이상 시 만료일 연장
    for (const uid in totalTssByUser) {
      const tss = totalTssByUser[uid];
      if (tss <= 0) continue;
      
      try {
        // 마일리지 업데이트 (userManager.js의 함수 사용)
        if (typeof window.updateUserMileage === 'function') {
          const mileageResult = await window.updateUserMileage(uid, tss);
          if (mileageResult.success) {
            console.log(`[fetchAndProcessStravaData] ✅ 사용자 ${uid} 포인트 업데이트:`, mileageResult);
          } else {
            errors.push(`사용자 ${uid}: 포인트 업데이트 실패 - ${mileageResult.error}`);
          }
        } else {
          errors.push(`사용자 ${uid}: updateUserMileage 함수가 없습니다.`);
        }
      } catch (updateError) {
        errors.push(`사용자 ${uid}: 포인트 업데이트 실패 - ${updateError.message}`);
      }
    }

    return {
      success: true,
      processed: processed,
      newActivities: newActivitiesTotal,
      totalTssByUser: totalTssByUser,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('[fetchAndProcessStravaData] ❌ 오류 발생:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
      processed: processed,
      newActivities: newActivitiesTotal,
      totalTssByUser: totalTssByUser,
      errors: errors
    };
  }
}

/**
 * 스트라바 인증 코드를 액세스/리프레시 토큰으로 교환하고, Firebase에 저장
 * Code.gs의 exchangeStravaCode를 Firebase로 마이그레이션
 */
async function exchangeStravaCode(code, userId) {
  if (!code || !userId) {
    return { success: false, error: 'code와 user_id가 필요합니다.' };
  }

  const STRAVA_CLIENT_ID = '197363';
  const STRAVA_CLIENT_SECRET = '6cd67a28f1c516c0f004f1c7f97f4d74be187d85';
  const STRAVA_REDIRECT_URI = window.STRAVA_REDIRECT_URI || window.CONFIG?.STRAVA_REDIRECT_URI || 'https://stelvio.ai.kr/callback.html';
  
  const tokenUrl = 'https://www.strava.com/api/v3/oauth/token';
  const payload = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
    code: code,
    grant_type: 'authorization_code',
    redirect_uri: STRAVA_REDIRECT_URI
  });

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: payload.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errJson = JSON.parse(errorText);
        return { success: false, error: errJson.message || `Strava token error: ${response.status}` };
      } catch (e) {
        return { success: false, error: `Strava token error: ${response.status} ${errorText}` };
      }
    }

    const tokenData = await response.json();
    const accessToken = tokenData.access_token || '';
    const refreshToken = tokenData.refresh_token || '';
    const expiresAt = tokenData.expires_at != null ? Number(tokenData.expires_at) : 0;

    if (!accessToken || !refreshToken) {
      return { success: false, error: 'Strava에서 access_token 또는 refresh_token을 받지 못했습니다.' };
    }

    // Firebase Firestore에 토큰 저장
    try {
      const usersCollection = getUsersCollection();
      await usersCollection.doc(userId).update({
        strava_access_token: accessToken,
        strava_refresh_token: refreshToken,
        strava_expires_at: expiresAt
      });

      console.log('[exchangeStravaCode] ✅ 토큰 저장 완료:', userId);
      return { success: true };
    } catch (firebaseError) {
      console.error('[exchangeStravaCode] ❌ Firebase 저장 실패:', firebaseError);
      return { success: false, error: 'Firebase 저장 실패: ' + firebaseError.message };
    }
  } catch (error) {
    console.error('[exchangeStravaCode] ❌ 토큰 요청 실패:', error);
    return { success: false, error: 'Strava 토큰 요청 실패: ' + (error.message || error) };
  }
}

// 전역 함수로 등록
window.refreshStravaTokenForUser = refreshStravaTokenForUser;
window.fetchStravaActivities = fetchStravaActivities;
window.computeTssFromActivity = computeTssFromActivity;
window.fetchAndProcessStravaData = fetchAndProcessStravaData;
window.exchangeStravaCode = exchangeStravaCode;
