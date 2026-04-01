/**
 * 오픈 라이딩방 — Firestore + Storage 서비스 (모듈러 v9)
 * 참석/취소는 runTransaction 필수.
 */
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  runTransaction,
  Timestamp,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js';

/** @param {unknown} v */
function asStringArray(v) {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** Firestore map: uid -> 표시 이름 */
function asParticipantDisplay(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  Object.keys(v).forEach((k) => {
    out[String(k)] = String(v[k] != null ? v[k] : '');
  });
  return out;
}

function omitParticipantDisplay(/** @type {unknown} */ pd, /** @type {string} */ uid) {
  const o = { ...asParticipantDisplay(pd) };
  delete o[String(uid)];
  return o;
}

/**
 * 사용자 선호 저장 (users 문서 merge)
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} userId
 * @param {{ activeRegions: string[], preferredLevels: string[] }} prefs
 */
export async function saveUserOpenRidingPreferences(db, userId, prefs) {
  const uref = doc(db, 'users', userId);
  await setDoc(
    uref,
    {
      activeRegions: prefs.activeRegions || [],
      preferredLevels: prefs.preferredLevels || [],
      openRidingPrefsUpdatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} userId
 */
export async function getUserOpenRidingPreferences(db, userId) {
  const snap = await getDoc(doc(db, 'users', userId));
  const d = snap.exists() ? snap.data() : {};
  return {
    activeRegions: asStringArray(d.activeRegions),
    preferredLevels: asStringArray(d.preferredLevels)
  };
}

/**
 * 라이딩 생성 (participants/waitlist 기본값)
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} hostUserId
 * @param {Record<string, unknown>} input
 */
export async function createRide(db, hostUserId, input) {
  const hostLabel = String(input.hostName || '').trim().slice(0, 80);
  const participantDisplay = {};
  if (hostUserId && hostLabel) participantDisplay[String(hostUserId)] = hostLabel;
  const payload = {
    title: String(input.title || ''),
    date: input.date instanceof Timestamp ? input.date : Timestamp.fromDate(new Date(input.date)),
    departureTime: String(input.departureTime || ''),
    departureLocation: String(input.departureLocation || ''),
    distance: Number(input.distance) || 0,
    course: String(input.course || ''),
    level: String(input.level || '중급'),
    maxParticipants: Math.max(1, Number(input.maxParticipants) || 10),
    hostName: String(input.hostName || ''),
    contactInfo: String(input.contactInfo || ''),
    isContactPublic: !!input.isContactPublic,
    gpxUrl: input.gpxUrl != null ? String(input.gpxUrl) : null,
    region: String(input.region || ''),
    participants: asStringArray(input.participants),
    waitlist: [],
    participantDisplay,
    hostUserId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const ref = await addDoc(collection(db, 'rides'), payload);
  return ref.id;
}

/**
 * GPX 업로드 후 다운로드 URL
 * @param {import('firebase/storage').FirebaseStorage} storage
 * @param {File|Blob} file
 * @param {string} rideId 임시 폴더면 'draft/{uid}/{timestamp}'
 */
export async function uploadRideGpx(storage, file, rideId) {
  const path = `open_riding_gpx/${rideId}/${Date.now()}.gpx`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file);
  return getDownloadURL(ref);
}

/**
 * 기간 내 라이딩 목록 (날짜 오름차순)
 * @param {import('firebase/firestore').Firestore} db
 * @param {Date} from
 * @param {Date} to
 */
export async function fetchRidesInDateRange(db, from, to) {
  const fromTs = Timestamp.fromDate(from);
  const toTs = Timestamp.fromDate(to);
  const q = query(
    collection(db, 'rides'),
    where('date', '>=', fromTs),
    where('date', '<=', toTs),
    orderBy('date', 'asc')
  );
  const snap = await getDocs(q);
  /** @type {Array<Record<string, unknown> & { id: string }>} */
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

/**
 * 단일 라이딩
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 */
export async function fetchRideById(db, rideId) {
  const snap = await getDoc(doc(db, 'rides', rideId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * 참석 신청: 정원이 차면 대기열 끝에 추가
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} userId
 * @param {string} [displayName] 참가자 목록 표시용 이름(프로필)
 * @returns {Promise<{ status: string, role?: string, position?: number }>}
 */
export async function joinRideTransaction(db, rideId, userId, displayName) {
  const nameLabel = String(displayName != null ? displayName : '라이더').trim().slice(0, 80) || '라이더';
  const rideRef = doc(db, 'rides', rideId);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(rideRef);
    if (!snap.exists()) throw new Error('RIDE_NOT_FOUND');
    const data = snap.data();
    let participants = asStringArray(data.participants);
    let waitlist = asStringArray(data.waitlist);
    let participantDisplay = { ...asParticipantDisplay(data.participantDisplay) };
    const max = Math.max(1, Number(data.maxParticipants) || 1);

    if (participants.includes(userId)) {
      return { status: 'already', role: 'participant' };
    }
    const wIdx = waitlist.indexOf(userId);
    if (wIdx >= 0) {
      return { status: 'already', role: 'waitlist', position: wIdx + 1 };
    }

    participantDisplay = Object.assign({}, participantDisplay, { [String(userId)]: nameLabel });

    if (participants.length < max) {
      participants = [...participants, userId];
      transaction.update(rideRef, {
        participants,
        participantDisplay,
        updatedAt: serverTimestamp()
      });
      return { status: 'joined', role: 'participant' };
    }

    waitlist = [...waitlist, userId];
    transaction.update(rideRef, {
      waitlist,
      participantDisplay,
      updatedAt: serverTimestamp()
    });
    return { status: 'joined', role: 'waitlist', position: waitlist.length };
  });
}

/**
 * 취소: 대기면 제거만. 참석확정이면 제거 후 대기1명 자동 승급.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} userId
 */
export async function leaveRideTransaction(db, rideId, userId) {
  const rideRef = doc(db, 'rides', rideId);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(rideRef);
    if (!snap.exists()) throw new Error('RIDE_NOT_FOUND');
    const data = snap.data();
    let participants = asStringArray(data.participants);
    let waitlist = asStringArray(data.waitlist);

    const inWait = waitlist.includes(userId);
    const inPart = participants.includes(userId);

    if (inWait) {
      waitlist = waitlist.filter((id) => id !== userId);
      transaction.update(rideRef, {
        waitlist,
        participantDisplay: omitParticipantDisplay(data.participantDisplay, userId),
        updatedAt: serverTimestamp()
      });
      return { status: 'left_waitlist', promotedUserId: null };
    }

    if (inPart) {
      participants = participants.filter((id) => id !== userId);
      let participantDisplay = omitParticipantDisplay(data.participantDisplay, userId);
      /** @type {string | null} */
      let promotedUserId = null;
      if (waitlist.length > 0) {
        promotedUserId = waitlist[0];
        waitlist = waitlist.slice(1);
        participants = [...participants, promotedUserId];
      }
      transaction.update(rideRef, {
        participants,
        waitlist,
        participantDisplay,
        updatedAt: serverTimestamp()
      });
      return { status: 'left_participant', promotedUserId };
    }

    return { status: 'noop', promotedUserId: null };
  });
}

/**
 * 달력용: 기간 내 라이딩 중 사용자 필터에 맞는 날짜 집합 (YYYY-MM-DD)
 * @param {Array<Record<string, unknown>>} rides fetchRidesInDateRange 결과
 * @param {{ activeRegions: string[], preferredLevels: string[] }} prefs
 */
export function computeMatchingRideDates(rides, prefs) {
  const regions = (prefs.activeRegions || []).map((r) => String(r).trim()).filter(Boolean);
  const levels = (prefs.preferredLevels || []).map((l) => String(l));
  const dates = new Set();

  rides.forEach((ride) => {
    // 선호 지역이 비어 있으면 전체 지역 허용; 있으면 정확 일치(권장: region 필드와 activeRegions 값 통일)
    const regionOk = regions.length === 0 || regions.includes(String(ride.region || '').trim());
    const levelOk = levels.length === 0 || levels.includes(String(ride.level || ''));
    if (!regionOk || !levelOk) return;

    const ts = ride.date;
    let d;
    if (ts && typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else return;
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    dates.add(key);
  });

  return dates;
}

/**
 * 달력용: 기간 내 내가 방장으로 올린 라이딩이 있는 날짜 (YYYY-MM-DD) — 맞춤 필터보다 우선 보라 표시
 * @param {Array<Record<string, unknown>>} rides
 * @param {string | null} userId
 */
export function computeHostRideDateKeys(rides, userId) {
  const uid = String(userId || '').trim();
  if (!uid) return new Set();
  const dates = new Set();
  rides.forEach((ride) => {
    if (String(ride.hostUserId || '').trim() !== uid) return;
    const ts = ride.date;
    let d;
    if (ts && typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else return;
    const key =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    dates.add(key);
  });
  return dates;
}

if (typeof window !== 'undefined') {
  window.openRidingService = {
    saveUserOpenRidingPreferences,
    getUserOpenRidingPreferences,
    createRide,
    uploadRideGpx,
    fetchRidesInDateRange,
    fetchRideById,
    joinRideTransaction,
    leaveRideTransaction,
    computeMatchingRideDates,
    computeHostRideDateKeys
  };
}
