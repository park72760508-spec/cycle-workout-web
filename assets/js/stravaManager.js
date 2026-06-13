/* ==========================================================
   스트라바 관리 모듈 (stravaManager.js)
   - Firebase Firestore로 스트라바 토큰 관리
   - 스트라바 활동 동기화
========================================================== */

/** Strava API Rate Limit 방지를 위한 딜레이 (ms) */
const STRAVA_SYNC_DELAY_MS = 1500;
/** v2 onRequest 함수는 run.app URL이 Cloud Functions 호환 URL보다 CORS/게이트웨이 안정성이 높다. */
const MANUAL_STRAVA_SYNC_WITH_MMP_URL =
  (typeof window !== 'undefined' && window.MANUAL_STRAVA_SYNC_WITH_MMP_URL) ||
  'https://manualstravasyncwithmmp-hkwksbqhjq-uc.a.run.app';

/** 딜레이 유틸리티 함수 (ms) */
function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Firestore users 컬렉션 참조 (compat v8 우선, v9 doc 조회 폴백)
function getStravaAuthUser() {
  if (typeof window.getCurrentUserForTrainingRooms === 'function') {
    var fromHelper = window.getCurrentUserForTrainingRooms();
    if (fromHelper) return fromHelper;
  }
  if (window.authV9 && window.authV9.currentUser) return window.authV9.currentUser;
  if (window.firebase && typeof window.firebase.auth === 'function') {
    var compat = window.firebase.auth().currentUser;
    if (compat) return compat;
  }
  if (window.auth && window.auth.currentUser) return window.auth.currentUser;
  return null;
}

function getUsersCollection() {
  if (window.firestore) {
    return window.firestore.collection('users');
  }
  if (window.firestoreV9 && window._firebaseFirestoreFns) {
    var fns = window._firebaseFirestoreFns;
    var db = window.firestoreV9;
    return {
      doc: function (id) {
        var ref = fns.doc(db, 'users', id);
        return {
          get: function () {
            return fns.getDoc(ref).then(function (snap) {
              return {
                exists: snap.exists(),
                id: snap.id,
                data: function () { return snap.data(); },
              };
            });
          },
        };
      },
      where: function () {
        throw new Error('Firestore v9 bulk query는 compat(window.firestore)가 필요합니다. (관리자 MMP)');
      },
    };
  }
  throw new Error('Firestore가 초기화되지 않았습니다. firebaseConfig.js가 먼저 로드되어야 합니다.');
}

/**
 * 스트라바 토큰 갱신 (Firebase Firestore)
 * Cloud Function이 있으면 서버에서 갱신(Client Secret 비노출), 없으면 기존 클라이언트 방식 폴백
 */
async function refreshStravaTokenForUser(userId, refreshToken) {
  if (!userId) {
    return { success: false, error: 'userId가 필요합니다.' };
  }

  // Cloud Function으로 토큰 갱신 (서버에서만 Client Secret 사용)
  // onRequest로 변경되어 fetch로 호출
  const functionsV9 = typeof window !== 'undefined' && window.functionsV9;
  if (functionsV9) {
    try {
      // Functions URL 구성 (onRequest는 직접 HTTP 엔드포인트)
      const url = `https://us-central1-stelvio-ai.cloudfunctions.net/refreshStravaToken`;
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, accessToken: data.accessToken };
      }
      return { success: false, error: data.error || '토큰 갱신 실패' };
    } catch (err) {
      console.error('[refreshStravaTokenForUser] Cloud Function 오류:', err);
      return { success: false, error: err.message || '알 수 없는 오류' };
    }
  }

  // 폴백: 클라이언트에서 직접 Strava API 호출 (config.local.js 필요)
  if (!refreshToken) {
    return { success: false, error: 'userId와 refresh_token이 필요합니다.' };
  }
  const STRAVA_CLIENT_ID = (typeof window !== 'undefined' && window.STRAVA_CLIENT_ID) || '';
  const STRAVA_CLIENT_SECRET = (typeof window !== 'undefined' && window.STRAVA_CLIENT_SECRET) || '';
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    console.warn('[Strava] STRAVA_CLIENT_ID 또는 STRAVA_CLIENT_SECRET이 없습니다. config.local.js 또는 Firestore appConfig/strava를 설정하세요.');
    return { success: false, error: 'Strava 설정이 없습니다. config.local.js를 설정하세요.' };
  }
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
      const userDocRef = usersCollection.doc(userId);
      
      // 문서 존재 여부 확인
      const userDoc = await userDocRef.get();
      
      if (!userDoc.exists) {
        console.error('[refreshStravaTokenForUser] ❌ 사용자 문서가 존재하지 않습니다:', userId);
        return { success: false, error: 'User not found' };
      }
      
      // 문서가 존재하면 토큰 업데이트
      await userDocRef.update({
        strava_access_token: accessToken,
        strava_refresh_token: newRefreshToken,
        strava_expires_at: expiresAt
      });

      console.log('[refreshStravaTokenForUser] ✅ 토큰 갱신 및 저장 완료:', userId);
      return { success: true, accessToken: accessToken };
    } catch (firebaseError) {
      console.error('[refreshStravaTokenForUser] ❌ Firebase 저장 실패:', firebaseError);
      
      // "User not found" 오류를 명확히 전달
      if (firebaseError.code === 'not-found' || 
          firebaseError.code === 'permission-denied' ||
          firebaseError.message?.includes('not found') ||
          firebaseError.message?.includes('No document to update')) {
        return { success: false, error: 'User not found' };
      }
      
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
 * @param {string} accessToken - Strava access token
 * @param {number} perPage - 페이지당 항목 수 (기본값: 200, Strava 최대값)
 * @param {number} after - Unix timestamp (활동 시작 시간이 이 값 이후인 활동만 반환, 선택사항)
 * @param {number} before - Unix timestamp (활동 시작 시간이 이 값 이전인 활동만 반환, 선택사항)
 */
async function fetchStravaActivities(accessToken, perPage = 200, after = null, before = null) {
  const params = new URLSearchParams();
  params.append('per_page', String(perPage));
  
  if (after !== null && after !== undefined) {
    params.append('after', String(after));
  }
  
  if (before !== null && before !== undefined) {
    params.append('before', String(before));
  }
  
  const url = `https://www.strava.com/api/v3/athlete/activities?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      const status = response.status;
      try {
        const errJson = JSON.parse(errorText);
        return { success: false, error: errJson.message || `Strava activities error: ${status}`, status: status };
      } catch (e) {
        return { success: false, error: `Strava activities error: ${status} ${errorText}`, status: status };
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
 * 스트라바 상세 활동 데이터 가져오기
 * @param {string} accessToken - Strava access token
 * @param {string|number} activityId - Strava activity ID
 * @returns {Promise<{success: boolean, activity?: object, error?: string}>}
 */
async function fetchStravaActivityDetail(accessToken, activityId) {
  const url = `https://www.strava.com/api/v3/activities/${activityId}`;

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
        return { success: false, error: errJson.message || `Strava activity detail error: ${response.status}` };
      } catch (e) {
        return { success: false, error: `Strava activity detail error: ${response.status} ${errorText}` };
      }
    }

    const activity = await response.json();
    return { success: true, activity: activity };
  } catch (error) {
    console.error('[fetchStravaActivityDetail] ❌ 상세 활동 요청 실패:', error);
    return { success: false, error: 'Strava 상세 활동 요청 실패: ' + (error.message || error) };
  }
}

/**
 * Strava 활동에서 TSS 계산
 * Code.gs의 computeTssFromActivity를 프론트엔드로 마이그레이션
 * @param {number} [weightKg] - 체중(kg), rTSS용
 */
function computeTssFromActivity(activity, ftp, weightKg) {
  const durationSec = Number(activity.moving_time) || 0;
  if (durationSec <= 0) return 0;

  let np = Number(activity.weighted_average_watts) || Number(activity.average_watts) || 0;
  if (np <= 0) return 0;

  ftp = Number(ftp) || 0;
  if (ftp <= 0) return 0;

  const avgW = Number(activity.average_watts) || 0;
  const avgForTss = avgW > 0 ? avgW : np;
  const defW = (typeof window !== 'undefined' && window.STELVIO_RTSS_DEFAULT_WEIGHT_KG) || 70;
  const wEff = (Number(weightKg) > 0) ? Number(weightKg) : defW;

  if (typeof window !== 'undefined' && typeof window.calculateStelvioRevisedTSS === 'function') {
    return Math.max(0, window.calculateStelvioRevisedTSS(durationSec, avgForTss, np, ftp, wEff));
  }

  const ifVal = np / ftp;
  const tss = (durationSec * np * ifVal) / (ftp * 3600) * 100;
  return Math.max(0, Math.round(tss * 100) / 100);
}

/** 활동 JSON에서 첫 번째 유한 숫자 필드 (파트너·확장 필드 대비) */
function pickFirstFiniteNumberFromActivity(obj, keys) {
  if (!obj || !keys || !keys.length) return null;
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Strava average_speed(m/s) 또는 거리·시간으로 평균 시속 km/h */
function computeAvgSpeedKmhFromActivity(activity, distanceKm, durationSec) {
  const avgMs = Number(activity && activity.average_speed);
  if (Number.isFinite(avgMs) && avgMs > 0) {
    return Math.round(avgMs * 3.6 * 100) / 100;
  }
  const d = Number(distanceKm) || 0;
  const t = Number(durationSec) || 0;
  if (d > 0 && t > 0) {
    return Math.round((d / (t / 3600)) * 100) / 100;
  }
  return null;
}

/**
 * 좌·우 밸런스 / 페달 평활도 / 토크 유효성 — 공개 API에 없을 수 있음, 수집 시 저장
 */
function extractStravaPedalingExtras(activity) {
  if (!activity || typeof activity !== 'object') {
    return {
      left_right_balance: null,
      pedal_smoothness_left: null,
      pedal_smoothness_right: null,
      torque_effectiveness_left: null,
      torque_effectiveness_right: null
    };
  }
  return {
    left_right_balance: pickFirstFiniteNumberFromActivity(activity, [
      'left_right_balance',
      'average_left_right_balance',
      'avg_left_right_balance'
    ]),
    pedal_smoothness_left: pickFirstFiniteNumberFromActivity(activity, [
      'average_pedal_smoothness_left',
      'pedal_smoothness_left',
      'avg_pedal_smoothness_left'
    ]),
    pedal_smoothness_right: pickFirstFiniteNumberFromActivity(activity, [
      'average_pedal_smoothness_right',
      'pedal_smoothness_right',
      'avg_pedal_smoothness_right'
    ]),
    torque_effectiveness_left: pickFirstFiniteNumberFromActivity(activity, [
      'average_torque_effectiveness_left',
      'torque_effectiveness_left',
      'avg_torque_effectiveness_left'
    ]),
    torque_effectiveness_right: pickFirstFiniteNumberFromActivity(activity, [
      'average_torque_effectiveness_right',
      'torque_effectiveness_right',
      'avg_torque_effectiveness_right'
    ])
  };
}

/**
 * Strava 활동 데이터를 Target Schema에 맞게 변환
 * @param {object} activity - Strava Activity 객체 (상세 또는 요약)
 * @param {string} userId - 사용자 ID
 * @param {number} ftpAtTime - 해당 시점의 FTP 값
 * @param {number} [weightKg] - 체중(kg), rTSS 가중치용
 * @returns {object} 변환된 활동 데이터
 */
function mapStravaActivityToSchema(activity, userId, ftpAtTime, weightKg) {
  if (!activity || !userId) {
    throw new Error('activity와 userId가 필요합니다.');
  }

  // 1. Direct Mapping (직접 매핑)
  const title = activity.name || '';
  const startDateLocal = activity.start_date_local || activity.start_date || '';
  let dateStr = '';
  if (startDateLocal) {
    try {
      const d = new Date(startDateLocal);
      dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
    } catch (e) {
      dateStr = startDateLocal.split('T')[0] || '';
    }
  }

  const distanceMeters = Number(activity.distance) || 0;
  const distanceKm = Math.round((distanceMeters / 1000) * 100) / 100; // m -> km 변환, 소수점 2자리

  const durationSec = Math.round(Number(activity.moving_time) || 0);
  const avgCadence = Number(activity.average_cadence) || null;
  const avgHr = Number(activity.average_heartrate) || null;
  const maxHr = Number(activity.max_heartrate) || null;
  const avgWatts = Number(activity.average_watts) || null;
  const maxWatts = Number(activity.max_watts) || null;
  const weightedWatts = Number(activity.weighted_average_watts) || null; // Normalized Power
  const kilojoules = Number(activity.kilojoules) || null;
  const elevationGain = Number(activity.total_elevation_gain) || null;
  const rpe = Number(activity.perceived_exertion) || null;

  // 2. Calculated Fields (계산 필요)
  const ftp = Number(ftpAtTime) || 0;
  
  // weighted_watts가 없으면 avg_watts를 대신 사용 (fallback)
  const np = weightedWatts !== null ? weightedWatts : (avgWatts !== null ? avgWatts : 0);
  const avgForTss = (avgWatts !== null && avgWatts > 0) ? avgWatts : np;
  const defW = (typeof window !== 'undefined' && window.STELVIO_RTSS_DEFAULT_WEIGHT_KG) || 70;
  const wEff = (Number(weightKg) > 0) ? Number(weightKg) : defW;
  
  // IF (Intensity Factor) 계산
  let ifValue = null;
  if (ftp > 0 && np > 0) {
    ifValue = Math.round((np / ftp) * 1000) / 1000; // 소수점 3자리
  }

  // TSS (rTSS)
  let tss = null;
  if (ftp > 0 && np > 0 && durationSec > 0) {
    if (typeof window !== 'undefined' && typeof window.calculateStelvioRevisedTSS === 'function') {
      tss = window.calculateStelvioRevisedTSS(durationSec, avgForTss, np, ftp, wEff);
    } else if (ifValue !== null) {
      tss = Math.round(((durationSec * np * ifValue) / (ftp * 36)) * 100) / 100;
    } else {
      const ifVal = np / ftp;
      tss = Math.round(((durationSec * np * ifVal) / (ftp * 36)) * 100) / 100;
    }
    tss = Math.max(0, tss);
  }

  // Efficiency Factor 계산 (weighted_watts / avg_hr, 심박 데이터가 0보다 클 때만)
  let efficiencyFactor = null;
  if (np > 0 && avgHr !== null && avgHr > 0) {
    efficiencyFactor = Math.round((np / avgHr) * 100) / 100;
  }

  // 3. Complex Mapping (존 데이터) - TODO: 추후 구현
  // time_in_zones는 Strava의 /activities/{id}/zones 엔드포인트를 통해 가져와야 함
  // 현재는 null로 설정하고 주석으로 TODO 남김
  const timeInZones = null; // TODO: Strava /activities/{id}/zones API 호출하여 Z1~Z7 매핑

  const avgSpeedKmh = computeAvgSpeedKmhFromActivity(activity, distanceKm, durationSec);
  const pedaling = extractStravaPedalingExtras(activity);

  // 4. Internal Fields (기본값)
  const source = 'strava';
  const earnedPoints = 0; // 비즈니스 로직이므로 일단 0
  const workoutId = null; // 워크아웃 매칭 로직은 추후 구현
  const activityType = String(activity.sport_type || activity.type || '').trim() || null;

  // 변환된 데이터 반환
  return {
    activity_id: String(activity.id || ''),
    user_id: userId,
    source: source,
    activity_type: activityType,
    title: title,
    date: dateStr,
    distance_km: distanceKm,
    duration_sec: durationSec,
    avg_cadence: avgCadence,
    avg_hr: avgHr,
    max_hr: maxHr,
    avg_watts: avgWatts,
    max_watts: maxWatts,
    weighted_watts: weightedWatts,
    kilojoules: kilojoules,
    elevation_gain: elevationGain,
    avg_speed_kmh: avgSpeedKmh,
    left_right_balance: pedaling.left_right_balance,
    pedal_smoothness_left: pedaling.pedal_smoothness_left,
    pedal_smoothness_right: pedaling.pedal_smoothness_right,
    torque_effectiveness_left: pedaling.torque_effectiveness_left,
    torque_effectiveness_right: pedaling.torque_effectiveness_right,
    rpe: rpe,
    ftp_at_time: ftp > 0 ? ftp : null,
    if: ifValue,
    tss: tss,
    efficiency_factor: efficiencyFactor,
    time_in_zones: timeInZones,
    earned_points: earnedPoints,
    workout_id: workoutId,
    // 기존 필드 호환성 유지
    time: durationSec, // duration_sec와 동일
    created_at: new Date().toISOString()
  };
}

/**
 * 스트라바 활동 동기화 및 포인트 적립 (Firebase)
 * Code.gs의 fetchAndProcessStravaData를 Firebase로 마이그레이션
 * @param {object} options - 옵션 객체
 * @param {number} options.after - Unix timestamp (활동 시작 시간이 이 값 이후인 활동만 반환, 선택사항)
 * @param {number} options.before - Unix timestamp (활동 시작 시간이 이 값 이전인 활동만 반환, 선택사항)
 */
async function fetchAndProcessStravaData(options = {}) {
  const errors = [];
  let processed = 0;
  let newActivitiesTotal = 0;
  const totalTssByUser = {};

  try {
    // 현재 로그인한 사용자 확인 (authV9 + compat)
    const currentAuthUser = getStravaAuthUser();
    const currentUserId = currentAuthUser?.uid || window.currentUser?.id;
    
    if (!currentUserId) {
      return {
        success: false,
        error: '로그인한 사용자가 없습니다.',
        processed: 0,
        newActivities: 0,
        totalTssByUser: {}
      };
    }

    // 사용자 등급 확인 (관리자인지 확인)
    let isAdmin = false;
    try {
      const viewerGrade = typeof getViewerGrade === 'function' ? getViewerGrade() : '2';
      isAdmin = viewerGrade === '1';
    } catch (e) {
      console.warn('[fetchAndProcessStravaData] 사용자 등급 확인 실패:', e);
    }

    let usersToProcess = [];
    const todayOnlyCurrentUser = !!options.todayOnlyCurrentUser;

    if (todayOnlyCurrentUser) {
      // 오늘 기록: 관리자여도 본인만 처리 (진행 0/1 또는 1/1, 메시지 0개 또는 1개)
      isAdmin = false;
      console.log('[fetchAndProcessStravaData] 오늘 기록: 본인만 처리');
    }

    if (isAdmin) {
      // 관리자인 경우: 모든 사용자 조회
      console.log('[fetchAndProcessStravaData] 관리자 모드: 모든 사용자 처리');
      const usersCollection = getUsersCollection();
      const usersSnapshot = await usersCollection
        .where('strava_refresh_token', '!=', '')
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

      usersToProcess = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        data: doc.data()
      }));
    } else {
      // 일반 사용자인 경우: 자신만 처리
      console.log('[fetchAndProcessStravaData] 일반 사용자 모드: 자신만 처리');
      try {
        const usersCollection = getUsersCollection();
        const userDoc = await usersCollection.doc(currentUserId).get();
        
        if (!userDoc.exists) {
          return {
            success: false,
            error: '사용자 정보를 찾을 수 없습니다.',
            processed: 0,
            newActivities: 0,
            totalTssByUser: {}
          };
        }

        var rawUserDoc = userDoc.data() || {};
        const userData = rawUserDoc;
        const refreshToken = userData.strava_refresh_token;
        
        if (!refreshToken || refreshToken === '' || refreshToken === null) {
          return {
            success: false,
            error: 'Strava 연결이 되어 있지 않습니다.',
            processed: 0,
            newActivities: 0,
            totalTssByUser: {}
          };
        }

        usersToProcess = [{
          id: currentUserId,
          data: userData
        }];
      } catch (userError) {
        console.error('[fetchAndProcessStravaData] 사용자 정보 조회 실패:', userError);
        return {
          success: false,
          error: `사용자 정보 조회 실패: ${userError.message}`,
          processed: 0,
          newActivities: 0,
          totalTssByUser: {}
        };
      }
    }

    // 각 사용자별로 순차 처리 (Rate Limit 방지: 병렬 대신 for...of)
    for (const userInfo of usersToProcess) {
      const userData = userInfo.data;
      const userId = userInfo.id;

      try {
      // 각 사용자별로 기존 활동 ID 목록 조회 (권한 오류 방지)
      let existingIds = new Set();
      try {
        if (typeof window.getExistingStravaActivityIds === 'function') {
          // 현재 사용자의 로그만 조회하도록 수정된 함수 사용
          const userLogsRef = window.firestore?.collection('users').doc(userId).collection('logs');
          if (userLogsRef) {
            const logsSnapshot = await userLogsRef
              .where('source', '==', 'strava')
              .get();
            logsSnapshot.docs.forEach(doc => {
              const data = doc.data() || {};
              if (data.activity_id) {
                existingIds.add(String(data.activity_id));
              }
            });
            console.log(`[fetchAndProcessStravaData] 사용자 ${userId}의 기존 활동 ID ${existingIds.size}개 발견`);
          }
        }
      } catch (existingIdsError) {
        console.warn(`[fetchAndProcessStravaData] 사용자 ${userId}의 기존 활동 ID 조회 실패:`, existingIdsError);
        // 조회 실패해도 계속 진행 (빈 Set 사용)
        existingIds = new Set();
      }
      const refreshToken = userData.strava_refresh_token;
      const ftp = Number(userData.ftp) || 0;
      const createdAt = userData.created_at || '';

      // 클라이언트 측에서 null과 빈 문자열 필터링
      if (!refreshToken || refreshToken === null || refreshToken === '' || !userId) continue;

      // 1년 초과 로그 삭제 (STRAVA/Stelvio 로그 저장 기준 최대 1년, DB 공간 활용)
      try {
        if (typeof window.deleteLogsOlderThanOneYear === 'function') {
          const pruneResult = await window.deleteLogsOlderThanOneYear(userId);
          if (pruneResult.deleted > 0) {
            console.log('[fetchAndProcessStravaData] 사용자', userId, '1년 초과 로그', pruneResult.deleted, '건 삭제');
          }
        }
      } catch (pruneError) {
        console.warn('[fetchAndProcessStravaData] 1년 초과 로그 삭제 실패(무시하고 계속):', pruneError);
      }

      // 가입일 확인 (YYYY-MM-DD 형식으로 변환)
      let userCreatedDate = '';
      if (createdAt) {
        try {
          const createdDate = new Date(createdAt);
          userCreatedDate = createdDate.toISOString().split('T')[0];
        } catch (e) {
          console.warn(`[fetchAndProcessStravaData] 사용자 ${userId}의 가입일 파싱 실패:`, createdAt);
        }
      }

      let totalTss = 0;
      let newCount = 0;

      // 토큰 갱신 (실패 시 해당 유저만 에러에 담고 다음 유저로)
      const tokenResult = await refreshStravaTokenForUser(userId, refreshToken);
      if (!tokenResult.success) {
        errors.push(`사용자 ${userId}: 토큰 갱신 실패 - ${tokenResult.error || ''}`);
        continue;
      }

      // 활동 조회 (날짜 범위가 지정된 경우 사용)
      const afterTimestamp = options.after || null;
      const beforeTimestamp = options.before || null;
      
      const actResult = await fetchStravaActivities(
        tokenResult.accessToken, 
        200, // per_page를 200으로 증가 (Strava 최대값)
        afterTimestamp,
        beforeTimestamp
      );

      // 429 Rate Limit: 즉시 중단하고 사용자 메시지 반환
      if (!actResult.success && (actResult.status === 429 || (actResult.error && String(actResult.error).includes('429')))) {
        console.warn('[fetchAndProcessStravaData] 429 Rate Limit 감지, 동기화 중단');
        return {
          success: false,
          error: 'API 호출 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
          processed: processed,
          newActivities: newActivitiesTotal,
          totalTssByUser: totalTssByUser,
          errors: errors
        };
      }
      if (!actResult.success) {
        errors.push(`사용자 ${userId}: 활동 조회 실패 - ${actResult.error || ''}`);
        continue;
      }

      processed += 1;
      const activities = actResult.activities || [];

      if (options.onProgress && typeof options.onProgress === 'function') {
        options.onProgress(0, activities.length);
      }

      // 해당 사용자의 스텔비오(앱) 훈련 로그 날짜 조회 (users/{userId}/logs 기준, TSS 중복 적립 방지)
      let stelvioLogDates = new Set();
      try {
        if (typeof window.getStelvioLogDatesFromUserLogs === 'function') {
          stelvioLogDates = await window.getStelvioLogDatesFromUserLogs(userId);
          console.log(`[fetchAndProcessStravaData] 사용자 ${userId}의 stelvio 로그 날짜 ${stelvioLogDates.size}개 발견`);
        }
      } catch (logError) {
        console.warn(`[fetchAndProcessStravaData] 사용자 ${userId}의 stelvio 로그 조회 실패:`, logError);
        // 로그 조회 실패해도 계속 진행
      }

      // 이미 저장된 스트라바 활동 중 TSS가 아직 적립되지 않은 활동 조회 (중복 적립 방지)
      // 사용자 생성일(created_at) 이후 활동만 조회하도록 userCreatedDate 전달
      let unappliedActivities = new Map();
      try {
        if (typeof window.getUnappliedStravaActivities === 'function') {
          unappliedActivities = await window.getUnappliedStravaActivities(userId, userCreatedDate);
          console.log(`[fetchAndProcessStravaData] 사용자 ${userId}의 TSS 미적립 활동 ${unappliedActivities.size}개 발견 (생성일: ${userCreatedDate || '미설정'})`);
        }
      } catch (unappliedError) {
        console.warn(`[fetchAndProcessStravaData] 사용자 ${userId}의 TSS 미적립 활동 조회 실패:`, unappliedError);
        // 조회 실패해도 계속 진행
      }

      // 같은 날 Stelvio 로그가 있는 날짜별 Strava TSS 합산 (차액 추가 적립용)
      const stelvioDateStravaTssAccumulator = new Map();

      // 각 활동 처리
      let activityIndex = 0;
      for (const act of activities) {
        const actId = String(act.id);
        if (existingIds.has(actId)) {
          activityIndex++;
          if (options.onProgress && typeof options.onProgress === 'function') {
            options.onProgress(activityIndex, activities.length);
          }
          continue;
        }

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

        // ✅ 수정: 가입일과 무관하게 모든 활동을 저장 (포인트 적립만 가입일 이후로 제한)
        // 가입일 이전 활동도 저장하되, 포인트 적립은 가입일 이후만 적용됨 (아래 로직에서 처리)

        // 같은 날짜에 stelvio 로그가 있는지 확인
        if (stelvioLogDates.has(dateStr)) {
          console.log(`[fetchAndProcessStravaData] ⚠️ 같은 날짜에 stelvio 로그 존재, 스트라바 TSS 제외: ${actId} (${dateStr})`);
          // 로그는 저장하되 TSS는 누적하지 않음
        }

        // 상세 활동 데이터 가져오기 (더 많은 필드를 위해)
        let detailedActivity = act; // 기본값으로 요약 데이터 사용
        try {
          const detailResult = await fetchStravaActivityDetail(tokenResult.accessToken, actId);
          if (detailResult.success && detailResult.activity) {
            detailedActivity = detailResult.activity;
            console.log(`[fetchAndProcessStravaData] ✅ 상세 데이터 가져옴: ${actId}`);
          } else {
            console.warn(`[fetchAndProcessStravaData] ⚠️ 상세 데이터 가져오기 실패 (요약 데이터 사용): ${actId} - ${detailResult.error || ''}`);
          }
        } catch (detailError) {
          console.warn(`[fetchAndProcessStravaData] ⚠️ 상세 데이터 요청 중 오류 (요약 데이터 사용): ${actId} - ${detailError.message || detailError}`);
          // 상세 데이터 가져오기 실패해도 요약 데이터로 계속 진행
        }

        // Strava 활동 데이터를 Target Schema에 맞게 변환
        let mappedActivity;
        try {
          mappedActivity = mapStravaActivityToSchema(detailedActivity, userId, ftp, userData.weight ?? userData.weightKg);
          console.log(`[fetchAndProcessStravaData] ✅ 활동 데이터 매핑 완료: ${actId}`);
        } catch (mapError) {
          console.error(`[fetchAndProcessStravaData] ❌ 활동 데이터 매핑 실패: ${actId} - ${mapError.message || mapError}`);
          // 매핑 실패 시 기본 필드만 사용하여 저장 시도
          const title = detailedActivity.name || '';
          const distanceKm = (Number(detailedActivity.distance) || 0) / 1000;
          const movingTime = Math.round(Number(detailedActivity.moving_time) || 0);
          const tss = computeTssFromActivity(detailedActivity, ftp, userData.weight ?? userData.weightKg);
          
          mappedActivity = {
            activity_id: actId,
            date: dateStr,
            title: title,
            distance_km: Math.round(distanceKm * 100) / 100,
            time: movingTime,
            duration_sec: movingTime,
            tss: tss,
            user_id: userId,
            source: 'strava',
            activity_type: String(detailedActivity.sport_type || detailedActivity.type || '').trim() || null
          };
        }

        // 사용자 몸무게 추가 (weight 필드)
        const userWeight = Number(userData.weight ?? userData.weightKg ?? 0);
        if (userWeight > 0) mappedActivity.weight = userWeight;

        // Firebase에 저장
        if (typeof window.saveStravaActivityToFirebase === 'function') {
          try {
            console.log(`[fetchAndProcessStravaData] 활동 저장 시도:`, {
              activity_id: actId,
              userId: userId,
              title: mappedActivity.title,
              date: mappedActivity.date,
              hasStelvioLog: stelvioLogDates.has(dateStr),
              tss: mappedActivity.tss
            });
            
            const saveResult = await window.saveStravaActivityToFirebase(mappedActivity, {
              markTssApplied: true
            });

            console.log(`[fetchAndProcessStravaData] 저장 결과:`, saveResult);

            if (saveResult && saveResult.isNew) {
              existingIds.add(actId);
              newCount += 1;
              
              // ✅ 수정: 포인트 적립은 가입일 이후 활동만 적용
              const activityTss = mappedActivity.tss || 0;
              const isAfterCreatedDate = !userCreatedDate || !dateStr || dateStr >= userCreatedDate;
              const distanceKm = mappedActivity.distance_km || 0;
              const isStravaSource = mappedActivity.source === 'strava';
              
              // 포인트 적립 조건:
              // 1. 같은 날짜에 stelvio 로그가 없고
              // 2. 가입일 이후 활동이고
              // 3. source가 'strava'이고 distance_km이 0이 아닌 경우에만 TSS 누적
              const shouldAccumulateTss = !stelvioLogDates.has(dateStr) && 
                                         isAfterCreatedDate && 
                                         !(isStravaSource && distanceKm === 0);
              
              if (shouldAccumulateTss) {
                totalTss += activityTss;
                console.log(`[fetchAndProcessStravaData] ✅ 새 활동 저장 및 TSS 누적: ${actId} (TSS: ${activityTss}, 날짜: ${dateStr}, 거리: ${distanceKm}km, 생성일: ${userCreatedDate || '미설정'})`);
              } else {
                if (!isAfterCreatedDate) {
                  console.log(`[fetchAndProcessStravaData] ✅ 새 활동 저장 완료 (TSS 제외 - 가입일 이전): ${actId} (${dateStr} < ${userCreatedDate})`);
                } else if (stelvioLogDates.has(dateStr)) {
                  // 같은 날 Stelvio 있음 → Strava TSS는 나중에 차액만 추가 적립하도록 합산만 해 둠
                  if (isAfterCreatedDate && !(isStravaSource && distanceKm === 0)) {
                    const prev = stelvioDateStravaTssAccumulator.get(dateStr) || 0;
                    stelvioDateStravaTssAccumulator.set(dateStr, prev + activityTss);
                  }
                  console.log(`[fetchAndProcessStravaData] ✅ 새 활동 저장 완료 (TSS는 차액 적립 대상으로 합산): ${actId} (${dateStr})`);
                } else if (isStravaSource && distanceKm === 0) {
                  console.log(`[fetchAndProcessStravaData] ✅ 새 활동 저장 완료 (TSS 제외 - source가 'strava'이고 distance_km이 0): ${actId} (거리: ${distanceKm}km)`);
                }
              }
            } else {
              console.log(`[fetchAndProcessStravaData] ⚠️ 이미 존재하는 활동: ${actId}`);
              
              // 이미 저장된 활동 중 TSS가 아직 적립되지 않은 경우 확인
              const unapplied = unappliedActivities.get(actId);
              if (unapplied) {
                // ✅ 수정: 포인트 적립은 가입일 이후 활동만 적용
                const isAfterCreatedDate = !userCreatedDate || !dateStr || dateStr >= userCreatedDate;
                const distanceKm = unapplied.distance_km || 0;
                const isStravaSource = unapplied.source === 'strava';
                
                if (!isAfterCreatedDate) {
                  console.log(`[fetchAndProcessStravaData] ⚠️ 기존 활동 TSS 제외 (가입일 이전): ${actId} (${dateStr} < ${userCreatedDate})`);
                  // 가입일 이전 활동은 TSS 적립하지 않으므로 tss_applied를 true로 표시 (중복 체크 방지)
                  if (typeof window.markStravaActivityTssApplied === 'function') {
                    try {
                      await window.markStravaActivityTssApplied(userId, actId);
                    } catch (markError) {
                      console.warn(`[fetchAndProcessStravaData] TSS 적립 표시 실패 (${actId}):`, markError);
                    }
                  }
                  continue;
                }
                
                // 포인트 적립 조건:
                // 1. 같은 날짜에 stelvio 로그가 없고
                // 2. source가 'strava'이고 distance_km이 0이 아닌 경우에만 TSS 누적
                const shouldAccumulateTss = !stelvioLogDates.has(dateStr) && 
                                           !(isStravaSource && distanceKm === 0);
                
                if (shouldAccumulateTss) {
                  totalTss += unapplied.tss;
                  console.log(`[fetchAndProcessStravaData] ✅ 기존 활동 TSS 누적: ${actId} (TSS: ${unapplied.tss}, 날짜: ${dateStr}, 거리: ${distanceKm}km)`);
                  
                  // TSS 적립 완료 표시
                  if (typeof window.markStravaActivityTssApplied === 'function') {
                    try {
                      await window.markStravaActivityTssApplied(userId, actId);
                    } catch (markError) {
                      console.warn(`[fetchAndProcessStravaData] TSS 적립 표시 실패 (${actId}):`, markError);
                    }
                  }
                } else {
                  if (stelvioLogDates.has(dateStr)) {
                    // 같은 날 Stelvio 있음 → Strava TSS는 나중에 차액만 추가 적립하도록 합산만 해 둠
                    if (isAfterCreatedDate && !(isStravaSource && distanceKm === 0)) {
                      const prev = stelvioDateStravaTssAccumulator.get(dateStr) || 0;
                      stelvioDateStravaTssAccumulator.set(dateStr, prev + (unapplied.tss || 0));
                    }
                    console.log(`[fetchAndProcessStravaData] ⚠️ 기존 활동 TSS는 차액 적립 대상으로 합산: ${actId} (${dateStr})`);
                  } else if (isStravaSource && distanceKm === 0) {
                    console.log(`[fetchAndProcessStravaData] ⚠️ 기존 활동 TSS 제외: ${actId} - source가 'strava'이고 distance_km이 0 (거리: ${distanceKm}km)`);
                  }
                  // TSS를 적립하지 않으므로 tss_applied를 true로 표시
                  if (typeof window.markStravaActivityTssApplied === 'function') {
                    try {
                      await window.markStravaActivityTssApplied(userId, actId);
                    } catch (markError) {
                      console.warn(`[fetchAndProcessStravaData] TSS 적립 표시 실패 (${actId}):`, markError);
                    }
                  }
                }
              }
            }
          } catch (saveError) {
            console.error(`[fetchAndProcessStravaData] ❌ 활동 저장 실패 (${actId}):`, saveError);
            console.error(`[fetchAndProcessStravaData] 에러 상세:`, {
              errorCode: saveError.code,
              errorMessage: saveError.message,
              errorStack: saveError.stack,
              activityId: actId,
              userId: userId
            });
            errors.push(`활동 ${actId} 저장 실패: ${saveError.message || saveError.code || '알 수 없는 오류'}`);
          }
        } else {
          console.error(`[fetchAndProcessStravaData] ❌ saveStravaActivityToFirebase 함수가 정의되지 않았습니다.`);
          errors.push(`saveStravaActivityToFirebase 함수가 없습니다.`);
        }
        activityIndex++;
        if (options.onProgress && typeof options.onProgress === 'function') {
          options.onProgress(activityIndex, activities.length);
        }
      }

      // 같은 날 Stelvio 로그가 있는 날짜: Strava TSS 합계 - Stelvio 적립 포인트 = 차액만 추가 적립
      if (stelvioDateStravaTssAccumulator.size > 0 && typeof window.getStelvioPointsForDate === 'function') {
        for (const [dateStr, stravaSum] of stelvioDateStravaTssAccumulator) {
          try {
            const stelvioPoints = await window.getStelvioPointsForDate(userId, dateStr);
            const diff = Math.max(0, (stravaSum || 0) - (stelvioPoints || 0));
            if (diff > 0) {
              totalTss += diff;
              console.log(`[fetchAndProcessStravaData] ✅ 같은 날 Stelvio 존재 → 차액 추가 적립: ${dateStr} Stelvio ${stelvioPoints} + Strava합 ${stravaSum} → 추가 ${diff}`);
            }
          } catch (e) {
            console.warn(`[fetchAndProcessStravaData] 차액 적립 처리 실패 (${dateStr}):`, e);
          }
        }
      }

      newActivitiesTotal += newCount;
      if (totalTss > 0) {
        totalTssByUser[userId] = (totalTssByUser[userId] || 0) + totalTss;
      }

      } catch (userError) {
        console.warn(`[fetchAndProcessStravaData] 사용자 ${userId} 처리 중 오류 (다음 유저로 진행):`, userError);
        errors.push(`사용자 ${userId}: ${userError.message || userError}`);
      }

      // Rate Limit 방지: 다음 유저 요청 전 딜레이
      await sleep(STRAVA_SYNC_DELAY_MS);
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
 * Cloud Function이 있으면 서버에서 교환(Client Secret 비노출), 없으면 기존 클라이언트 방식 폴백
 */
async function exchangeStravaCode(code, userId) {
  if (!code || !userId) {
    return { success: false, error: 'code와 user_id가 필요합니다.' };
  }

  // Cloud Function으로 토큰 교환 (서버에서만 Client Secret 사용)
  // onRequest로 변경되어 fetch로 호출
  const functionsV9 = typeof window !== 'undefined' && window.functionsV9;
  if (functionsV9) {
    try {
      // Functions URL (onRequest는 직접 HTTP 엔드포인트)
      const url = 'https://us-central1-stelvio-ai.cloudfunctions.net/exchangeStravaCode';
      console.log('[exchangeStravaCode] Functions 호출 시작:', url);
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, userId })
      });
      
      console.log('[exchangeStravaCode] 응답 상태:', res.status, res.statusText);
      
      if (!res.ok) {
        const errorText = await res.text().catch(() => '응답 읽기 실패');
        console.error('[exchangeStravaCode] HTTP 오류:', res.status, errorText);
        return { success: false, error: `HTTP ${res.status}: ${errorText}` };
      }
      
      const data = await res.json().catch(err => {
        console.error('[exchangeStravaCode] JSON 파싱 실패:', err);
        return { success: false, error: '응답 파싱 실패' };
      });
      
      if (data.success) {
        console.log('[exchangeStravaCode] ✅ 성공');
        return { success: true };
      }
      return { success: false, error: data.error || '토큰 교환 실패' };
    } catch (err) {
      console.error('[exchangeStravaCode] Cloud Function 오류:', {
        message: err.message,
        name: err.name,
        stack: err.stack,
        fullError: err
      });
      return { success: false, error: err.message || '네트워크 오류: ' + String(err) };
    }
  }

  // 폴백: 클라이언트에서 직접 Strava API 호출 (config.local.js 필요)
  const STRAVA_CLIENT_ID = (typeof window !== 'undefined' && window.STRAVA_CLIENT_ID) || '';
  const STRAVA_CLIENT_SECRET = (typeof window !== 'undefined' && window.STRAVA_CLIENT_SECRET) || '';
  const STRAVA_REDIRECT_URI = (typeof window !== 'undefined' && (window.STRAVA_REDIRECT_URI || window.CONFIG?.STRAVA_REDIRECT_URI)) || 'https://example.com/callback.html';
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    console.warn('[Strava] STRAVA_CLIENT_ID 또는 STRAVA_CLIENT_SECRET이 없습니다. config.local.js 또는 Firestore appConfig/strava + Cloud Function을 설정하세요.');
    return { success: false, error: 'Strava 설정이 없습니다. config.local.js를 설정하세요.' };
  }

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
      const userDocRef = usersCollection.doc(userId);
      
      // 문서 존재 여부 확인
      const userDoc = await userDocRef.get();
      
      if (!userDoc.exists) {
        // 문서가 존재하지 않으면 "User not found" 오류 반환
        console.error('[exchangeStravaCode] ❌ 사용자 문서가 존재하지 않습니다:', userId);
        console.error('[exchangeStravaCode] 디버깅 정보:', {
          userId: userId,
          userIdType: typeof userId,
          currentUser: window.currentUser ? {
            id: window.currentUser.id,
            name: window.currentUser.name
          } : 'null'
        });
        return { success: false, error: 'User not found' };
      }
      
      // 문서가 존재하면 토큰 업데이트
      await userDocRef.update({
        strava_access_token: accessToken,
        strava_refresh_token: refreshToken,
        strava_expires_at: expiresAt
      });

      console.log('[exchangeStravaCode] ✅ 토큰 저장 완료:', userId);
      return { success: true };
    } catch (firebaseError) {
      console.error('[exchangeStravaCode] ❌ Firebase 저장 실패:', firebaseError);
      console.error('[exchangeStravaCode] 디버깅 정보:', {
        userId: userId,
        userIdType: typeof userId,
        errorCode: firebaseError.code,
        errorMessage: firebaseError.message,
        currentUser: window.currentUser ? {
          id: window.currentUser.id,
          name: window.currentUser.name
        } : 'null'
      });
      
      // "User not found" 오류를 명확히 전달
      if (firebaseError.code === 'not-found' || 
          firebaseError.code === 'permission-denied' ||
          firebaseError.message?.includes('not found') ||
          firebaseError.message?.includes('No document to update')) {
        return { success: false, error: 'User not found' };
      }
      
      return { success: false, error: 'Firebase 저장 실패: ' + firebaseError.message };
    }
  } catch (error) {
    console.error('[exchangeStravaCode] ❌ 토큰 요청 실패:', error);
    return { success: false, error: 'Strava 토큰 요청 실패: ' + (error.message || error) };
  }
}

/**
 * 스트라바 데이터 동기화 (UI에서 호출용)
 * 진행 상태 표시 및 결과 알림 포함
 * @param {Date} startDate - 시작일 (선택사항)
 * @param {Date} endDate - 종료일 (선택사항)
 * @param {object} opts - 옵션 (todayOnlyCurrentUser: true면 오늘 기록·본인만 동기화)
 */
async function syncStravaData(startDate = null, endDate = null, opts = {}) {
  const btn = document.getElementById('btnSyncStrava');
  const originalText = btn ? btn.textContent : '🔄 스트라바 동기화';
  const progressOverlay = document.getElementById('stravaSyncProgressOverlay');
  const progressText = document.getElementById('stravaSyncProgressText');
  const progressCenter = document.getElementById('stravaSyncProgressCenter');

  function updateStravaProgressCenter(current, total) {
    if (!progressCenter) return;
    if (typeof total === 'number' && total > 0 && typeof current === 'number') {
      const cur = Math.max(0, current);
      const pct = Math.min(100, Math.max(0, Math.round((cur / total) * 100)));
      progressCenter.innerHTML =
        '<span class="scp-line">' +
        cur +
        ' / ' +
        total +
        '</span><span class="scp-pct">(' +
        pct +
        '%)</span>';
      return;
    }
    if (typeof total === 'number' && total === 0) {
      progressCenter.innerHTML =
        '<span class="scp-line">0 / 0</span><span class="scp-pct">(0%)</span>';
      return;
    }
    progressCenter.textContent = '준비 중…';
  }

  function showProgress(current, total) {
    updateStravaProgressCenter(current, total);
    if (progressText) {
      if (typeof total === 'number' && total > 0 && typeof current === 'number') {
        const cur = Math.max(0, current);
        const pct = Math.min(100, Math.max(0, Math.round((cur / total) * 100)));
        progressText.textContent = `${cur} / ${total} (${pct}%)`;
      } else if (typeof total === 'number' && total === 0) {
        progressText.textContent = '처리할 Strava 활동이 없습니다.';
      } else if (typeof total === 'number' && total < 0) {
        progressText.textContent = 'Strava 활동을 불러오는 중입니다…';
      } else {
        progressText.textContent = '준비 중…';
      }
    }
    if (progressOverlay) {
      progressOverlay.classList.remove('hidden');
      progressOverlay.style.display = 'flex';
    }
  }
  function hideProgress() {
    if (progressOverlay) {
      progressOverlay.classList.add('hidden');
      progressOverlay.style.display = 'none';
    }
  }

  const isTodayAll = !!opts.todayAll;

  try {
    // 버튼 비활성화 및 로딩 상태
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ 동기화 중...';
    }

    if (isTodayAll) {
      // 오늘 기록(ALL): 녹색 큰 원 스피너만 표시 (진행 0/0 숨김)
      const todayAllOverlay = document.getElementById('stravaTodayAllOverlay');
      if (todayAllOverlay) {
        todayAllOverlay.classList.remove('hidden');
        todayAllOverlay.style.setProperty('display', 'flex', 'important');
      }
    } else {
      showProgress(0, -1);
    }

    console.log('[syncStravaData] 🚀 스트라바 동기화 시작', opts.todayOnlyCurrentUser ? '(오늘 기록·본인만)' : isTodayAll ? '(오늘 기록 ALL)' : '');

    // 날짜를 Unix timestamp로 변환
    const options = { todayOnlyCurrentUser: !!opts.todayOnlyCurrentUser, todayAll: isTodayAll };
    if (startDate) {
      options.after = Math.floor(startDate.getTime() / 1000);
      console.log('[syncStravaData] 시작일:', startDate.toISOString(), '→ after:', options.after);
    }
    if (endDate) {
      // 종료일은 해당 날짜의 23:59:59까지 포함하도록 설정
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      options.before = Math.floor(endOfDay.getTime() / 1000);
      console.log('[syncStravaData] 종료일:', endDate.toISOString(), '→ before:', options.before);
    }
    options.onProgress = isTodayAll ? function () {} : function (current, total) {
      showProgress(current, total);
    };

    // 동기화 실행
    const result = await fetchAndProcessStravaData(options);
    
    console.log('[syncStravaData] ✅ 동기화 완료:', result);
    
    // 결과 메시지 구성
    let message = '';
    if (result.success) {
      const newActivities = result.newActivities || 0;
      const processed = result.processed || 0;
      const totalTss = Object.values(result.totalTssByUser || {}).reduce((sum, tss) => sum + tss, 0);
      
      if (newActivities > 0) {
        message = `✅ 동기화 완료: ${newActivities}개의 새 활동이 추가되었습니다.`;
        if (totalTss > 0) {
          message += ` (총 ${Math.round(totalTss)} TSS 적립)`;
        }
      } else {
        message = `✅ 동기화 완료: 새로운 활동이 없습니다.`;
      }
      
      if (processed === 0) {
        message = '⚠️ Strava에 연결된 사용자가 없습니다.';
      }
      
      // 오류가 있으면 추가 표시
      if (result.errors && result.errors.length > 0) {
        console.warn('[syncStravaData] ⚠️ 동기화 중 일부 오류 발생:', result.errors);
        message += ` (일부 오류: ${result.errors.length}개)`;
      }
    } else {
      message = `❌ 동기화 실패: ${result.error || '알 수 없는 오류'}`;
    }
    
    // 토스트 메시지 표시
    if (typeof window.showToast === 'function') {
      window.showToast(message, result.success ? 'success' : 'error');
    } else {
      alert(message);
    }

    // 훈련일지 달력 새로고침 (동기화된 로그 반영)
    if (result.success && typeof window.loadTrainingJournalCalendar === 'function') {
      try {
        window.loadTrainingJournalCalendar();
        console.log('[syncStravaData] 훈련일지 달력 새로고침 완료');
      } catch (refreshErr) {
        console.warn('[syncStravaData] 훈련일지 달력 새로고침 실패:', refreshErr);
      }
    }

    if (result.success && typeof window.backfillStravaRouteProfileForDateClient === 'function') {
      window.backfillStravaRouteProfileForDateClient().catch(function (eBf) {
        console.warn('[syncStravaData] 코스 프로파일 백필:', eBf && eBf.message ? eBf.message : eBf);
      });
    }
    
    return result;
  } catch (error) {
    console.error('[syncStravaData] ❌ 동기화 중 오류:', error);
    
    const errorMessage = `❌ 동기화 중 오류가 발생했습니다: ${error.message || error}`;
    if (typeof window.showToast === 'function') {
      window.showToast(errorMessage, 'error');
    } else {
      alert(errorMessage);
    }
    
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  } finally {
    // 진행 오버레이 숨기기
    const progressOverlay = document.getElementById('stravaSyncProgressOverlay');
    if (progressOverlay) {
      progressOverlay.classList.add('hidden');
      progressOverlay.style.display = 'none';
    }
    // 오늘 기록(ALL) 녹색 큰 스피너 숨기기
    if (isTodayAll) {
      const todayAllOverlay = document.getElementById('stravaTodayAllOverlay');
      if (todayAllOverlay) {
        todayAllOverlay.classList.add('hidden');
        todayAllOverlay.style.display = 'none';
      }
    }
    // 버튼 복원
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

/**
 * MMP 포함 서버 동기화 (manualStravaSyncWithMmp Cloud Function 호출)
 * - 과거 1~6개월 또는 N일 Strava 활동 + 5/10/30분 파워(MMP) 계산·저장
 * - Firebase 로그인 필요 (Authorization Bearer 토큰)
 * @param {number} [months=1] - 동기화할 개월 수 (1~6). options.days / options.maxActivities 가 없을 때만 사용
 * @param {Object} [options] - 선택 옵션
 * @param {number} [options.days] - 동기화할 일 수. 지정 시 months 대신 사용 (maxActivities 없을 때)
 * @param {number} [options.maxActivities] - 최근 windowMonths개월 안에서 최신 활동 최대 N개만 처리 (일 수 기준이 아님)
 * @param {number} [options.windowMonths=3] - maxActivities 사용 시 Strava after 구간(개월)
 * @param {string} [options.overlayId] - 진행 오버레이 요소 ID
 * @param {string} [options.textId] - 진행 텍스트 요소 ID
 * @param {string} [options.progressMessage] - 표시할 메시지
 */
async function syncStravaDataWithMmp(months = 1, options) {
  var opts = options || {};
  var overlayId = opts.overlayId || 'stravaSyncProgressOverlay';
  var textId = opts.textId || 'stravaSyncProgressText';
  var progressMessage = opts.progressMessage;
  var targetUsersVal = opts.targetUsers && String(opts.targetUsers).toLowerCase();
  var targetUidVal = opts.targetUid != null ? String(opts.targetUid).trim() : '';
  var maxActivitiesVal =
    opts.maxActivities != null && opts.maxActivities !== ''
      ? Math.max(1, Math.min(200, parseInt(String(opts.maxActivities), 10) || 30))
      : null;
  var windowMonthsVal =
    opts.windowMonths != null && opts.windowMonths !== ''
      ? Math.max(1, Math.min(12, parseInt(String(opts.windowMonths), 10) || 3))
      : 3;
  var daysVal =
    maxActivitiesVal != null
      ? null
      : opts.days != null
        ? Math.max(1, parseInt(opts.days, 10) || 10)
        : null;
  var startDateVal = opts.startDate && String(opts.startDate).trim();
  var endDateVal = opts.endDate && String(opts.endDate).trim();
  var monthsVal =
    startDateVal && endDateVal
      ? 0
      : daysVal && daysVal > 0
        ? 0
        : maxActivitiesVal != null
          ? 0
          : Math.min(6, Math.max(1, parseInt(months, 10) || 1));
  var btnId = opts.btnId || 'btnStravaMmpAllUsers';
  var btn = document.getElementById(btnId) || document.getElementById('btnStravaMmpAdmin');
  var originalText = btn ? btn.textContent : 'MMP 포함 동기화';
  var progressOverlay = document.getElementById(overlayId);
  var progressText = document.getElementById(textId);
  var defaultMsg = (startDateVal && endDateVal)
    ? 'MMP 포함 동기화 중(데이타 가공을 위해 장시간 소요됩니다)'
    : maxActivitiesVal != null
      ? 'MMP 포함 동기화 중(데이타 가공을 위해 장시간 소요됩니다)'
      : daysVal
        ? 'MMP 포함 동기화 중(데이타 가공을 위해 장시간 소요됩니다)'
        : 'MMP 포함 동기화 중(데이타 가공을 위해 장시간 소요됩니다)';
  var msg = (typeof progressMessage === 'string' && progressMessage) ? progressMessage : defaultMsg;

  // 가짜 진행률 타이머 (서버 처리 중 0% → ~88% 비선형 증가, 완료 시 정리)
  var _mmpPctTimer = null;
  var _mmpPct = 0;
  // innerHTML 대신 기존 span의 textContent만 교체 → DOM 노드 재생성 없음 → 스피너 animation 유지
  function _updatePctDisplay() {
    var c = document.getElementById('stravaSyncProgressCenter');
    if (!c) return;
    var span = c.querySelector('.scp-pct');
    if (!span) {
      // 최초 1회만 span 생성 (HTML에 초기값 있으므로 일반적으로 이 경로는 타지 않음)
      span = document.createElement('span');
      span.className = 'scp-pct';
      c.textContent = '';
      c.appendChild(span);
    }
    span.textContent = Math.round(_mmpPct) + '%';
  }

  function showProgress(m) {
    if (progressText) progressText.textContent = m || '준비 중...';
    _mmpPct = 0;
    _updatePctDisplay();
    if (progressOverlay) {
      progressOverlay.classList.remove('hidden');
      progressOverlay.style.display = 'flex';
    }
    if (_mmpPctTimer) clearInterval(_mmpPctTimer);
    _mmpPctTimer = setInterval(function () {
      var gap = 88 - _mmpPct;
      if (gap <= 0) return;
      // 처음엔 빠르게, 88% 가까워질수록 느리게
      _mmpPct += Math.max(0.4, gap * 0.045);
      _mmpPct = Math.min(88, _mmpPct);
      _updatePctDisplay();
    }, 500);
  }
  function hideProgress() {
    if (_mmpPctTimer) { clearInterval(_mmpPctTimer); _mmpPctTimer = null; }
    if (progressOverlay) {
      progressOverlay.classList.add('hidden');
      progressOverlay.style.display = 'none';
    }
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ 동기화 중...';
    }
    closeStravaSyncModal();
    showProgress(msg);

    const auth = window.authV9 || window.auth || window.firebase?.auth?.();
    // auth.currentUser는 Firebase SDK 초기화 타이밍이나 SESSION persistence 세션 복원 중에
    // 잠시 null이 될 수 있으므로, onAuthStateChanged로 확정될 때까지 최대 5초 대기
    const currentUser = await (function waitForCurrentUser() {
      return new Promise(function (resolve) {
        if (!auth) { resolve(null); return; }
        if (auth.currentUser) { resolve(auth.currentUser); return; }
        var settled = false;
        var timer = setTimeout(function () {
          if (!settled) { settled = true; if (typeof unsub === 'function') unsub(); resolve(auth.currentUser); }
        }, 5000);
        var unsub;
        try {
          unsub = auth.onAuthStateChanged(function (user) {
            if (!settled) { settled = true; clearTimeout(timer); resolve(user); }
          });
        } catch (e) {
          clearTimeout(timer);
          resolve(auth.currentUser);
        }
      });
    })();
    if (!currentUser) {
      throw new Error('로그인이 필요합니다. Firebase Auth로 로그인 후 다시 시도해 주세요.');
    }
    const idToken = await currentUser.getIdToken();
    var authUid = currentUser && currentUser.uid ? String(currentUser.uid) : '';
    if (!targetUidVal) {
      try {
        var selectedUid =
          (window.currentUser && (window.currentUser.id || window.currentUser.uid) && String(window.currentUser.id || window.currentUser.uid)) ||
          '';
        var loginGrade =
          typeof getLoginUserGrade === 'function'
            ? String(getLoginUserGrade())
            : (typeof getViewerGrade === 'function' ? String(getViewerGrade()) : '');
        var isLoginAdmin =
          typeof window.isStelvioAdminGrade === 'function'
            ? window.isStelvioAdminGrade(loginGrade)
            : (loginGrade === '1' || Number(loginGrade) === 1);
        if (isLoginAdmin && selectedUid && authUid && selectedUid !== authUid) {
          targetUidVal = selectedUid;
        }
      } catch (targetErr) {
        console.warn('[syncStravaDataWithMmp] targetUid 자동 판정 실패:', targetErr && targetErr.message ? targetErr.message : targetErr);
      }
    }

    var url = MANUAL_STRAVA_SYNC_WITH_MMP_URL + '?forceRecalcTimeInZones=true';
    if (startDateVal && endDateVal) {
      url += '&startDate=' + encodeURIComponent(startDateVal) + '&endDate=' + encodeURIComponent(endDateVal);
    } else if (maxActivitiesVal != null) {
      url += '&maxActivities=' + maxActivitiesVal + '&windowMonths=' + windowMonthsVal;
    } else if (daysVal) {
      url += '&days=' + daysVal;
    } else {
      url += '&months=' + monthsVal;
    }
    if (targetUsersVal === 'all' || targetUsersVal === 'admin') {
      url += '&targetUsers=' + encodeURIComponent(targetUsersVal);
    } else if (targetUidVal && targetUidVal !== authUid) {
      url += '&targetUid=' + encodeURIComponent(targetUidVal);
    }
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` }
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    if (!data.success) {
      throw new Error(data.error || '동기화 실패');
    }

    var procData = data || {};
    var processedCount = procData.processedCount != null ? procData.processedCount : 0;
    var updatedCount = procData.updatedCount != null ? procData.updatedCount : 0;
    var createdCount = procData.createdCount != null ? procData.createdCount : 0;
    var hasMore = procData.hasMore;
    let message = `✅ MMP 포함 동기화 완료: 처리 ${processedCount}건 (신규 ${createdCount}, 업데이트 ${updatedCount})`;
    if (processedCount === 0 && Array.isArray(procData.userResults) && procData.userResults.length > 0) {
      var firstResult = procData.userResults[0] || {};
      var found = firstResult.activitiesFound != null ? Number(firstResult.activitiesFound) : null;
      if (found === 0 && firstResult.hint) {
        message += ` - ${firstResult.hint}`;
      } else if (found === 0) {
        message += ' - 조회 기간의 Strava 활동이 0건입니다. 연결 계정과 조회 기간을 확인해 주세요.';
      }
    }
    if (hasMore) {
      message += '. 일부 활동이 남아있을 수 있습니다. 다시 실행해 보세요.';
    }
    if (typeof window.showToast === 'function') {
      window.showToast(message, 'success');
    } else {
      alert(message);
    }
    if (typeof window.loadTrainingJournalCalendar === 'function') {
      try { window.loadTrainingJournalCalendar(); } catch (e) {}
    }
    if (typeof window.backfillStravaRouteProfileForDateClient === 'function') {
      window.backfillStravaRouteProfileForDateClient().catch(function (eBf) {
        console.warn('[syncStravaDataWithMmp] 코스 프로파일 백필:', eBf && eBf.message ? eBf.message : eBf);
      });
    }
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('journal-training-logs-refresh', { detail: { force: true } })
      );
    }
    return data;
  } catch (err) {
    const msg = err.message || '알 수 없는 오류';
    if (typeof window.showToast === 'function') {
      window.showToast(`❌ MMP 동기화 실패: ${msg}`, 'error');
    } else {
      alert(`❌ MMP 동기화 실패: ${msg}`);
    }
    return { success: false, error: msg };
  } finally {
    hideProgress();
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

/**
 * Strava 동기화 날짜 선택 모달 열기
 * grade=1: 관리자용 - 2개 버튼(모든 사용자 MMP, 관리자 MMP), 시작일/종료일 적용
 * grade=2,3: 일괄 수집(최대 10개) + 선택 날짜 1일 수집
 */
function openStravaSyncModal() {
  const modal = document.getElementById('stravaSyncModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    var grade = '2';
    try {
      grade = typeof getViewerGrade === 'function' ? String(getViewerGrade()) : '2';
    } catch (e) {}

    var isGrade1 = (grade === '1');
    var dateRangeSection = document.getElementById('stravaSyncDateRangeSection');
    var singleDateSection = document.getElementById('stravaSyncSingleDateSection');
    var adminFooter = document.getElementById('stravaSyncAdminFooter');
    var userFooter = document.getElementById('stravaSyncUserFooter');
    var descEl = document.getElementById('stravaSyncDesc');
    var btnAllUsers = document.getElementById('btnStravaMmpAllUsers');
    var btnAdmin = document.getElementById('btnStravaMmpAdmin');
    var btnBulk10 = document.getElementById('btnStravaMmpBulk10');
    var btnSingleDay = document.getElementById('btnStravaMmpSingleDay');
    var adminHint = document.getElementById('stravaMmpAdminHint');

    if (isGrade1) {
      if (dateRangeSection) dateRangeSection.style.display = '';
      if (singleDateSection) singleDateSection.style.display = 'none';
      if (adminFooter) adminFooter.style.display = 'flex';
      if (userFooter) userFooter.style.display = 'none';
      if (descEl) descEl.textContent = '동기화할 기간을 선택하세요. MMP 포함 Strava 로그를 일단위로 수집합니다.';
      if (btnAllUsers) { btnAllUsers.style.display = ''; btnAllUsers.textContent = '모든 사용자(MMP)'; btnAllUsers.disabled = false; }
      if (btnAdmin) { btnAdmin.style.display = ''; btnAdmin.textContent = '관리자 MMP'; btnAdmin.disabled = false; }
      if (adminHint) adminHint.style.display = '';
    } else {
      if (dateRangeSection) dateRangeSection.style.display = 'none';
      if (singleDateSection) singleDateSection.style.display = '';
      if (adminFooter) adminFooter.style.display = 'none';
      if (userFooter) userFooter.style.display = 'flex';
      if (descEl) {
        descEl.textContent =
          '최근 3개월 이내 Strava 활동을 MMP와 함께 가져옵니다. 일괄 수집은 최대 10개까지 처리하며, 실패한 날짜는 아래에서 날짜를 지정해 1일씩 다시 수집할 수 있습니다.';
      }
      if (btnBulk10) {
        btnBulk10.disabled = false;
        btnBulk10.textContent = '일괄 수집 (최근 3개월·최대 10개)';
      }
      if (btnSingleDay) {
        btnSingleDay.disabled = false;
        btnSingleDay.textContent = '선택 날짜 수집 (1일)';
      }
      if (btnAllUsers) btnAllUsers.style.display = 'none';
      if (btnAdmin) btnAdmin.style.display = 'none';
      if (adminHint) adminHint.style.display = 'none';
    }

    // 날짜 입력 초기화 (grade=1 관리자용)
    const startDateInput = document.getElementById('stravaSyncStartDate');
    const endDateInput = document.getElementById('stravaSyncEndDate');
    if (startDateInput && endDateInput) {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const oneMonthAgo = new Date(today);
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const oneMonthAgoStr = oneMonthAgo.toISOString().split('T')[0];
      startDateInput.value = oneMonthAgoStr;
      endDateInput.value = todayStr;
      const minDateStr = (new Date(today.getFullYear() - 5, 0, 1)).toISOString().split('T')[0];
      startDateInput.min = minDateStr;
      endDateInput.min = minDateStr;
      startDateInput.max = todayStr;
      endDateInput.max = todayStr;
      // 시작일 ≤ 종료일 제약: 시작일 변경 시 종료일 min 갱신, 종료일 변경 시 시작일 max 갱신
      startDateInput.onchange = function () {
        if (startDateInput.value && endDateInput.value && startDateInput.value > endDateInput.value) {
          endDateInput.value = startDateInput.value;
        }
        endDateInput.min = startDateInput.value || minDateStr;
      };
      endDateInput.onchange = function () {
        if (startDateInput.value && endDateInput.value && startDateInput.value > endDateInput.value) {
          startDateInput.value = endDateInput.value;
        }
        startDateInput.max = endDateInput.value || todayStr;
      };
    }

    // 단일 날짜 입력 초기화 (grade=2,3 일반 사용자용)
    var singleDateInput = document.getElementById('stravaSyncSingleDate');
    if (singleDateInput) {
      var todayForSingle = new Date();
      var todayForSingleStr = todayForSingle.toISOString().split('T')[0];
      var minDateForSingleStr = (new Date(todayForSingle.getFullYear() - 5, 0, 1)).toISOString().split('T')[0];
      if (!singleDateInput.value) singleDateInput.value = todayForSingleStr;
      singleDateInput.min = minDateForSingleStr;
      singleDateInput.max = todayForSingleStr;
    }
  }
}

/**
 * Strava 동기화 날짜 선택 모달 닫기
 */
function closeStravaSyncModal() {
  const modal = document.getElementById('stravaSyncModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

/**
 * Strava 동기화 날짜 범위 빠른 설정 (grade=1 관리자용)
 */
function setStravaSyncMonthRange(range) {
  const startDateInput = document.getElementById('stravaSyncStartDate');
  const endDateInput = document.getElementById('stravaSyncEndDate');
  if (!startDateInput || !endDateInput) return;

  const today = new Date();
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let startDate = new Date(endDate);

  switch (range) {
    case '1month':
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case '3months':
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case '6months':
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    default:
      return;
  }

  startDateInput.value = startDate.toISOString().split('T')[0];
  endDateInput.value = endDate.toISOString().split('T')[0];
  endDateInput.min = startDateInput.value;
}

/**
 * Strava 동기화 날짜 범위 초기화 (grade=1 관리자용)
 */
function clearStravaSyncMonthRange() {
  const startDateInput = document.getElementById('stravaSyncStartDate');
  const endDateInput = document.getElementById('stravaSyncEndDate');
  if (startDateInput && endDateInput) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const oneMonthAgo = new Date(today);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    startDateInput.value = oneMonthAgo.toISOString().split('T')[0];
    endDateInput.value = todayStr;
  }
}

/**
 * 오늘 기록: 오늘 날짜 1일분 Strava 로그만 동기화 (본인만, 관리자도 본인만)
 * (로컬 기준 오늘 00:00:00 ~ 23:59:59)
 */
function startStravaSyncToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const startDate = new Date(y, m, d, 0, 0, 0, 0);   // 오늘 00:00:00
  const endDate = new Date(y, m, d, 23, 59, 59, 999); // 오늘 23:59:59
  closeStravaSyncModal();
  syncStravaData(startDate, endDate, { todayOnlyCurrentUser: true });
}

/**
 * 오늘 기록(ALL): 스트라바 연결 모든 사용자의 오늘 기록 동기화 (관리자 전용, 녹색 큰 원 스피너)
 */
function startStravaSyncTodayAll() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const startDate = new Date(y, m, d, 0, 0, 0, 0);
  const endDate = new Date(y, m, d, 23, 59, 59, 999);
  closeStravaSyncModal();
  syncStravaData(startDate, endDate, { todayOnlyCurrentUser: false, todayAll: true });
}

/**
 * 일반 사용자 MMP 일괄 수집 (grade=2,3)
 * 최근 3개월 이내 최신 활동 최대 10개
 */
function syncStravaMmpUserBulk10() {
  closeStravaSyncModal();
  syncStravaDataWithMmp(0, {
    maxActivities: 10,
    windowMonths: 3,
    btnId: 'btnStravaMmpBulk10',
    progressMessage: 'MMP 일괄 수집 중 (최대 10개, 장시간 소요될 수 있습니다)'
  });
}

/**
 * 일반 사용자 MMP 단일 날짜 수집 (grade=2,3)
 * 선택한 1일 구간만 수집 (일괄 수집 실패 시 개별 재시도용)
 */
function syncStravaMmpUserSingleDay() {
  var dateEl = document.getElementById('stravaSyncSingleDate');
  if (!dateEl) {
    (window.showToast || alert)('수집 날짜를 선택해 주세요.');
    return;
  }
  var dateStr = (dateEl.value || '').trim();
  if (!dateStr) {
    (window.showToast || alert)('수집 날짜를 선택해 주세요.');
    return;
  }
  closeStravaSyncModal();
  syncStravaDataWithMmp(0, {
    startDate: dateStr,
    endDate: dateStr,
    btnId: 'btnStravaMmpSingleDay',
    progressMessage: dateStr + ' MMP 수집 중 (1일)'
  });
}

/**
 * 모든 사용자(MMP) 수집 (grade=1 관리자용)
 * 시작일/종료일 기간 적용, Strava 인증 완료 모든 사용자 MMP 수집
 */
function syncStravaMmpAllUsers() {
  var startEl = document.getElementById('stravaSyncStartDate');
  var endEl = document.getElementById('stravaSyncEndDate');
  if (!startEl || !endEl) {
    (window.showToast || alert)('시작일과 종료일을 선택해 주세요.');
    return;
  }
  var startStr = (startEl.value || '').trim();
  var endStr = (endEl.value || '').trim();
  if (!startStr || !endStr) {
    (window.showToast || alert)('시작일과 종료일을 모두 선택해 주세요.');
    return;
  }
  if (startStr > endStr) {
    (window.showToast || alert)('시작일이 종료일보다 늦을 수 없습니다.');
    return;
  }
  closeStravaSyncModal();
  syncStravaDataWithMmp(0, { startDate: startStr, endDate: endStr, targetUsers: 'all', btnId: 'btnStravaMmpAllUsers' });
}

/**
 * 관리자 MMP 수집 (grade=1 사용자만)
 * 시작일/종료일 기간 적용, 일반 사용자 MMP는 수집하지 않음
 */
function syncStravaMmpAdminOnly() {
  var startEl = document.getElementById('stravaSyncStartDate');
  var endEl = document.getElementById('stravaSyncEndDate');
  if (!startEl || !endEl) {
    (window.showToast || alert)('시작일과 종료일을 선택해 주세요.');
    return;
  }
  var startStr = (startEl.value || '').trim();
  var endStr = (endEl.value || '').trim();
  if (!startStr || !endStr) {
    (window.showToast || alert)('시작일과 종료일을 모두 선택해 주세요.');
    return;
  }
  if (startStr > endStr) {
    (window.showToast || alert)('시작일이 종료일보다 늦을 수 없습니다.');
    return;
  }
  closeStravaSyncModal();
  syncStravaDataWithMmp(0, { startDate: startStr, endDate: endStr, targetUsers: 'admin', btnId: 'btnStravaMmpAdmin' });
}

/**
 * Strava 동기화 확인 및 실행 (grade=1 관리자용, 레거시)
 * 동기화 시작 → MMP 로그 수집으로 동작
 */
async function confirmStravaSync() {
  const startDateInput = document.getElementById('stravaSyncStartDate');
  const endDateInput = document.getElementById('stravaSyncEndDate');
  if (!startDateInput || !endDateInput) {
    if (typeof window.showToast === 'function') {
      window.showToast('시작일과 종료일을 선택해 주세요.', 'error');
    } else {
      alert('시작일과 종료일을 선택해 주세요.');
    }
    return;
  }

  const startStr = startDateInput.value && startDateInput.value.trim();
  const endStr = endDateInput.value && endDateInput.value.trim();
  if (!startStr || !endStr) {
    if (typeof window.showToast === 'function') {
      window.showToast('시작일과 종료일을 모두 선택해 주세요.', 'error');
    } else {
      alert('시작일과 종료일을 모두 선택해 주세요.');
    }
    return;
  }

  // 시작일 ≤ 종료일 검증
  if (startStr > endStr) {
    if (typeof window.showToast === 'function') {
      window.showToast('시작일이 종료일보다 늦을 수 없습니다.', 'error');
    } else {
      alert('시작일이 종료일보다 늦을 수 없습니다.');
    }
    return;
  }

  closeStravaSyncModal();
  await syncStravaDataWithMmp(0, { startDate: startStr, endDate: endStr });
}

// 전역 함수로 등록
window.refreshStravaTokenForUser = refreshStravaTokenForUser;
window.fetchStravaActivities = fetchStravaActivities;
window.fetchStravaActivityDetail = fetchStravaActivityDetail;
window.computeTssFromActivity = computeTssFromActivity;
window.mapStravaActivityToSchema = mapStravaActivityToSchema;
window.fetchAndProcessStravaData = fetchAndProcessStravaData;
window.exchangeStravaCode = exchangeStravaCode;
window.syncStravaData = syncStravaData;
window.openStravaSyncModal = openStravaSyncModal;
window.closeStravaSyncModal = closeStravaSyncModal;
window.setStravaSyncMonthRange = setStravaSyncMonthRange;
window.clearStravaSyncMonthRange = clearStravaSyncMonthRange;
window.startStravaSyncToday = startStravaSyncToday;
window.startStravaSyncTodayAll = startStravaSyncTodayAll;
window.confirmStravaSync = confirmStravaSync;
window.syncStravaDataWithMmp = syncStravaDataWithMmp;
window.syncStravaMmpUserBulk10 = syncStravaMmpUserBulk10;
window.syncStravaMmpUserSingleDay = syncStravaMmpUserSingleDay;
window.syncStravaMmpAllUsers = syncStravaMmpAllUsers;
window.syncStravaMmpAdminOnly = syncStravaMmpAdminOnly;
