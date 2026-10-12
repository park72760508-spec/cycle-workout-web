/**
 * 라이딩 모임 — 참석자별 Garmin LiveTrack 링크 (2026-10-12)
 *
 * Garmin Connect는 LiveTrack 세션을 조회하는 공개 API가 없어(Connect Developer Program의 Activity/Health
 * API에도 없음) 참석자가 Garmin Connect 앱에서 받은 LiveTrack 공유 링크를 직접 등록한다.
 * 링크는 사용자 단위(garminLiveTrack/{uid})로 한 번 저장해 이후 참석하는 모든 라이딩에서 그대로 쓴다.
 * - Garmin Connect+ 의 개인 LiveTrack 고정 주소: 한 번 등록으로 계속 사용
 * - 일반 LiveTrack 링크: 활동마다 새 주소가 발급되므로 바뀐 날 "변경"으로 갱신
 * 본인만 쓰고 로그인 사용자는 읽을 수 있다(보안 규칙: docs/firestore.rules — livetrack.garmin.com / gar.mn 만 허용).
 */
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  documentId,
  serverTimestamp
} from '/assets/js/vendor/firebasejs/10.14.1/firebase-firestore.js';

const COL = 'garminLiveTrack';

/** 붙여넣은 텍스트(공유 문구 포함)에서 LiveTrack URL만 추출. 유효하지 않으면 ''. */
export function extractLiveTrackUrl(text) {
  const s = String(text || '');
  const m = s.match(/https:\/\/(?:livetrack\.garmin\.com|gar\.mn)\/[^\s<>"']+/i);
  if (!m) return '';
  const url = m[0].replace(/[).,]+$/, '').replace(/^https:\/\/[^/]+/i, (h) => h.toLowerCase());
  return url.length <= 500 ? url : '';
}

/** @returns {Promise<Record<string, { url: string, updatedAtMs: number }>>} uid → 등록 링크 */
export async function fetchLiveTrackLinksForUids(db, uids) {
  const out = {};
  const list = Array.from(new Set((uids || []).map((u) => String(u || '').trim()).filter(Boolean)));
  if (!db || !list.length) return out;
  const chunks = [];
  for (let i = 0; i < list.length; i += 30) chunks.push(list.slice(i, i + 30));
  const snaps = await Promise.all(chunks.map((c) => getDocs(query(collection(db, COL), where(documentId(), 'in', c)))));
  snaps.forEach((snap) => {
    snap.forEach((d) => {
      const data = d.data() || {};
      const url = extractLiveTrackUrl(data.url);
      const ts = data.updatedAt && typeof data.updatedAt.toMillis === 'function' ? data.updatedAt.toMillis() : 0;
      if (url) out[d.id] = { url, updatedAtMs: ts };
    });
  });
  return out;
}

export async function saveMyLiveTrackLink(db, uid, rawText) {
  const url = extractLiveTrackUrl(rawText);
  if (!url) throw new Error('Garmin LiveTrack 링크(https://livetrack.garmin.com/… 또는 https://gar.mn/…)를 붙여넣어 주세요.');
  await setDoc(doc(db, COL, String(uid).trim()), {
    url,
    uid: String(uid).trim(),
    updatedAt: serverTimestamp()
  });
  return url;
}

export async function deleteMyLiveTrackLink(db, uid) {
  await deleteDoc(doc(db, COL, String(uid).trim()));
}

if (typeof window !== 'undefined') {
  window.openRidingLiveTrack = {
    extractLiveTrackUrl,
    fetchLiveTrackLinksForUids,
    saveMyLiveTrackLink,
    deleteMyLiveTrackLink
  };
}
