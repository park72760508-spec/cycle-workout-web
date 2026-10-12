/**
 * 라이딩 모임 — 참석자별 Garmin LiveTrack 링크 (2026-10-12)
 *
 * Garmin Connect는 LiveTrack 세션을 조회하는 공개 API가 없어(Connect Developer Program의 Activity/Health
 * API에도 없음) 참석자가 라이딩 시작 시 Garmin Connect 앱 → LiveTrack → "링크 공유"로 받은 URL을
 * 직접 등록한다. 링크는 rides/{rideId}/liveTrack/{uid} 에 본인만 쓰고, 로그인 사용자는 읽을 수 있다.
 * (보안 규칙: docs/firestore.rules — livetrack.garmin.com / gar.mn 주소만 허용)
 */
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp
} from '/assets/js/vendor/firebasejs/10.14.1/firebase-firestore.js';

/** LiveTrack 링크는 활동 종료 후 일정 시간만 유효 — 오래된 등록은 표시하지 않는다. */
export const LIVETRACK_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** 붙여넣은 텍스트(공유 문구 포함)에서 LiveTrack URL만 추출. 유효하지 않으면 ''. */
export function extractLiveTrackUrl(text) {
  const s = String(text || '');
  const m = s.match(/https:\/\/(?:livetrack\.garmin\.com|gar\.mn)\/[^\s<>"']+/i);
  if (!m) return '';
  const url = m[0].replace(/[).,]+$/, '').replace(/^https:\/\/[^/]+/i, (h) => h.toLowerCase());
  return url.length <= 500 ? url : '';
}

/** @returns {Promise<Record<string, { url: string, updatedAtMs: number }>>} uid → 유효 링크 */
export async function fetchRideLiveTrackLinks(db, rideId) {
  const out = {};
  if (!db || !rideId) return out;
  const snap = await getDocs(collection(db, 'rides', String(rideId).trim(), 'liveTrack'));
  const now = Date.now();
  snap.forEach((d) => {
    const data = d.data() || {};
    const url = extractLiveTrackUrl(data.url);
    const ts = data.updatedAt && typeof data.updatedAt.toMillis === 'function' ? data.updatedAt.toMillis() : now;
    if (url && now - ts <= LIVETRACK_MAX_AGE_MS) out[d.id] = { url, updatedAtMs: ts };
  });
  return out;
}

export async function saveMyRideLiveTrackLink(db, rideId, uid, rawText) {
  const url = extractLiveTrackUrl(rawText);
  if (!url) throw new Error('Garmin LiveTrack 링크(https://livetrack.garmin.com/… 또는 https://gar.mn/…)를 붙여넣어 주세요.');
  await setDoc(doc(db, 'rides', String(rideId).trim(), 'liveTrack', String(uid).trim()), {
    url,
    uid: String(uid).trim(),
    updatedAt: serverTimestamp()
  });
  return url;
}

export async function deleteMyRideLiveTrackLink(db, rideId, uid) {
  await deleteDoc(doc(db, 'rides', String(rideId).trim(), 'liveTrack', String(uid).trim()));
}

if (typeof window !== 'undefined') {
  window.openRidingLiveTrack = {
    extractLiveTrackUrl,
    fetchRideLiveTrackLinks,
    saveMyRideLiveTrackLink,
    deleteMyRideLiveTrackLink
  };
}
