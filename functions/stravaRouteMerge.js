/**
 * 하루에 Strava 활동이 여러 건(일시정지 후 재시작 등)으로 나뉘어 기록된 경우,
 * 각 활동의 코스(polyline)·고도 프로파일을 모아 하나의 "일일 경로 문서"로 저장한다.
 *
 * 저장 위치: users/{uid}/daily_route_profiles/{date} (Firestore)
 * 프론트엔드 assets/js/journal/stravaPolylineUtils.js의 routeProfileFromLogs()가
 * 이 문서 구조(route_segments/merged_elevation_profile/activity_ids)를 그대로 소비하므로,
 * 필드명·세그먼트 다운샘플링 기준(320점/구간, 최대 8구간, 고도 200점)을 그 파일과 동일하게 맞춘다.
 * (활동 사이를 직선으로 잇지 않기 위해 구간을 하나로 합치지 않고 배열로 유지)
 */

const MAX_SEGMENTS = 8;
const MAX_SEGMENT_POINTS = 320;
const MAX_ELEVATION_POINTS = 200;
const DEFAULT_POLYLINE_PRECISION = 5;

function decodePolyline(encoded, precision) {
  const enc = String(encoded || "").trim();
  if (!enc) return [];
  const factor = Math.pow(10, precision != null ? precision : DEFAULT_POLYLINE_PRECISION);
  let index = 0;
  let lat = 0;
  let lng = 0;
  const out = [];
  while (index < enc.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = enc.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = enc.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

function pickIndices(n, maxN) {
  if (n <= maxN) return null;
  const step = Math.ceil(n / maxN);
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return idx;
}

function downsample(arr, maxN) {
  if (!arr || arr.length <= maxN) return arr || [];
  const idxs = pickIndices(arr.length, maxN);
  if (!idxs) return arr;
  return idxs.map((i) => arr[i]);
}

function normalizeElevationProfile(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(Number).filter((v) => Number.isFinite(v));
  }
  if (typeof raw === "string") {
    try {
      return normalizeElevationProfile(JSON.parse(raw));
    } catch (e) {
      return [];
    }
  }
  return [];
}

/** 활동 정렬 키 — start_time/start_date_local/start_date가 없으면(CYCLE 로그 실제 상태) activity_id로 대체 (프론트엔드와 동일 규칙) */
function logSortKeyForRouteMerge(log) {
  if (!log) return 0;
  const t = log.start_time || log.start_date_local || log.start_date;
  if (t) {
    const ms = Date.parse(String(t));
    if (!Number.isNaN(ms)) return ms;
  }
  const aid = Number(log.activity_id || 0);
  return Number.isFinite(aid) ? aid : 0;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} uid Firebase UID
 * @param {string} dateStr YYYY-MM-DD
 * @param {Array<object>} logs 해당 날짜의 Strava 활동 목록 (summary_polyline, activity_id, elevation_profile 필드 보유)
 * @returns {Promise<{saved:boolean, segmentCount:number, hasElevation?:boolean, activityIds?:string[], reason?:string}>}
 */
async function saveMergedDailyRouteProfile(db, uid, dateStr, logs) {
  if (!db || !uid || !dateStr) {
    return { saved: false, reason: "invalid_args", segmentCount: 0 };
  }
  const sorted = (Array.isArray(logs) ? logs : []).slice().sort(
    (a, b) => logSortKeyForRouteMerge(a) - logSortKeyForRouteMerge(b)
  );

  const segments = [];
  const activityIds = [];
  let mergedElev = [];

  for (const log of sorted) {
    if (!log) continue;
    const poly = log.summary_polyline != null ? String(log.summary_polyline).trim() : "";
    if (poly) {
      const pts = downsample(decodePolyline(poly), MAX_SEGMENT_POINTS);
      if (pts.length >= 2) {
        segments.push(pts);
        if (log.activity_id) activityIds.push(String(log.activity_id));
      }
    }
    const elevRaw = log.elevation_profile != null ? log.elevation_profile : log.elevation_profile_json;
    const elevArr = normalizeElevationProfile(elevRaw);
    if (elevArr.length) mergedElev = mergedElev.concat(elevArr);
  }

  const cappedSegments = segments.length > MAX_SEGMENTS ? segments.slice(0, MAX_SEGMENTS) : segments;
  const cappedElev = downsample(mergedElev, MAX_ELEVATION_POINTS);
  const hasRoute = cappedSegments.length > 0;
  const hasElevation = cappedElev.length >= 2;

  const docRef = db
    .collection("users")
    .doc(String(uid))
    .collection("daily_route_profiles")
    .doc(String(dateStr));

  if (!hasRoute && !hasElevation) {
    await docRef.delete().catch(() => {});
    return { saved: false, reason: "no_route_data", segmentCount: 0 };
  }

  const payload = {
    route_segments: cappedSegments,
    activity_ids: activityIds,
    segment_count: cappedSegments.length,
    merged_at: new Date().toISOString(),
  };
  if (hasElevation) payload.merged_elevation_profile = cappedElev;

  await docRef.set(payload, { merge: true });
  return { saved: true, segmentCount: cappedSegments.length, hasElevation, activityIds };
}

module.exports = {
  decodePolyline,
  downsample,
  saveMergedDailyRouteProfile,
};
