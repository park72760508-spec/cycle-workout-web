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

/** 전화번호 비교용 정규화 (숫자만, +82 → 0) */
export function normalizePhoneDigits(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 10) d = `0${d.slice(2)}`;
  return d.slice(0, 15);
}

/**
 * 비공개 방 초대 목록과 사용자 연락처 일치 여부 (방장은 항상 true 아님 — UI에서 제외, 트랜잭션에서 방장 예외)
 * @param {string} userPhone
 * @param {string[]} invitedList Firestore invited_list
 */
export function isUserPhoneInvitedToRide(userPhone, invitedList) {
  const u = normalizePhoneDigits(userPhone);
  if (!u || u.length < 9) return false;
  const list = Array.isArray(invitedList) ? invitedList : [];
  return list.some((inv) => {
    const n = normalizePhoneDigits(inv);
    return n && (n === u || n.slice(-10) === u.slice(-10));
  });
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

/** Firestore map: uid -> 참가 신청 시 공개 연락처(방장만 목록에서 확인) */
function asParticipantContact(/** @type {unknown} */ v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  Object.keys(v).forEach((k) => {
    out[String(k)] = String(v[k] != null ? v[k] : '');
  });
  return out;
}

function omitParticipantContact(/** @type {unknown} */ pc, /** @type {string} */ uid) {
  const o = { ...asParticipantContact(pc) };
  delete o[String(uid)];
  return o;
}

/** uid -> 참석자 간 연락처 공개 여부(true면 전체 표시) */
function asParticipantContactPublic(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  Object.keys(v).forEach((k) => {
    out[String(k)] = !!v[k];
  });
  return out;
}

function omitParticipantContactPublic(/** @type {unknown} */ m, /** @type {string} */ uid) {
  const o = { ...asParticipantContactPublic(m) };
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
  const isPrivate = !!input.isPrivate;
  const invitedRaw = isPrivate && Array.isArray(input.invitedList) ? input.invitedList : [];
  const invitedList = invitedRaw
    .map((x) => normalizePhoneDigits(typeof x === 'string' ? x : (x && x.phone) != null ? x.phone : x))
    .filter((d) => d.length >= 9);
  const rideJoinPassword = isPrivate
    ? String(input.rideJoinPassword != null ? input.rideJoinPassword : '')
        .replace(/\D/g, '')
        .slice(0, 4)
    : '';

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
    isPrivate,
    invitedList,
    rideJoinPassword: rideJoinPassword.length === 4 ? rideJoinPassword : '',
    participantContactPublic: {},
    participants: asStringArray(input.participants),
    waitlist: [],
    participantDisplay,
    hostUserId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    rideStatus: 'active'
  };
  const ref = await addDoc(collection(db, 'rides'), payload);
  return ref.id;
}

/**
 * 방장 라이딩 수정 (참가자 명단 필드는 변경하지 않음)
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} hostUserId
 * @param {Record<string, unknown>} input
 */
export async function updateRideByHost(db, rideId, hostUserId, input) {
  const rideRef = doc(db, 'rides', rideId);
  const snap = await getDoc(rideRef);
  if (!snap.exists()) throw new Error('RIDE_NOT_FOUND');
  const data = snap.data();
  if (String(data.hostUserId || '') !== String(hostUserId)) throw new Error('FORBIDDEN');
  if (String(data.rideStatus || 'active') === 'cancelled') throw new Error('RIDE_CANCELLED');
  const isPrivate = !!input.isPrivate;
  const invitedRaw = isPrivate && Array.isArray(input.invitedList) ? input.invitedList : [];
  const invitedList = isPrivate
    ? invitedRaw
        .map((x) => normalizePhoneDigits(typeof x === 'string' ? x : (x && x.phone) != null ? x.phone : x))
        .filter((d) => d.length >= 9)
    : [];
  const rideJoinPassword = isPrivate
    ? String(input.rideJoinPassword != null ? input.rideJoinPassword : '')
        .replace(/\D/g, '')
        .slice(0, 4)
    : '';

  const patch = {
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
    gpxUrl: input.gpxUrl != null ? String(input.gpxUrl) : data.gpxUrl != null ? String(data.gpxUrl) : null,
    region: String(input.region || ''),
    isPrivate,
    invitedList,
    rideJoinPassword: isPrivate && rideJoinPassword.length === 4 ? rideJoinPassword : '',
    updatedAt: serverTimestamp()
  };
  await updateDoc(rideRef, patch);
}

/**
 * 방장 폭파(취소) — 목록에 폭파 상태로 표시
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} hostUserId
 */
export async function cancelRideByHost(db, rideId, hostUserId) {
  const rideRef = doc(db, 'rides', rideId);
  const snap = await getDoc(rideRef);
  if (!snap.exists()) throw new Error('RIDE_NOT_FOUND');
  const data = snap.data();
  if (String(data.hostUserId || '') !== String(hostUserId)) throw new Error('FORBIDDEN');
  await updateDoc(rideRef, {
    rideStatus: 'cancelled',
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

/**
 * GPX 업로드 후 다운로드 URL
 * @param {import('firebase/storage').FirebaseStorage} storage
 * @param {File|Blob} file
 * @param {string} rideId 임시 폴더면 'draft/{uid}/{timestamp}'
 */
export async function uploadRideGpx(storage, file, rideId) {
  const safeSeg = String(rideId || 'draft').replace(/[/\\]/g, '_').slice(0, 180);
  const path = `open_riding_gpx/${safeSeg}/${Date.now()}.gpx`;
  const ref = storageRef(storage, path);
  const contentType =
    file && file.type && String(file.type).trim() ? String(file.type).trim() : 'application/gpx+xml';
  await uploadBytes(ref, file, { contentType });
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
 * @param {string} [participantPhone] 방장에게만 공개되는 신청자 연락처
 * @param {{ contactPublicToParticipants?: boolean, joinPasswordAttempt?: string }} [joinOpts]
 * @returns {Promise<{ status: string, role?: string, position?: number }>}
 */
export async function joinRideTransaction(db, rideId, userId, displayName, participantPhone, joinOpts) {
  const opt = joinOpts && typeof joinOpts === 'object' ? joinOpts : {};
  const contactPublicToParticipants =
    joinOpts === undefined || joinOpts === null ? true : !!opt.contactPublicToParticipants;
  const joinPasswordAttempt = String(opt.joinPasswordAttempt != null ? opt.joinPasswordAttempt : '')
    .replace(/\D/g, '')
    .slice(0, 4);
  const nameLabel = String(displayName != null ? displayName : '라이더').trim().slice(0, 80) || '라이더';
  const phoneLabel = String(participantPhone != null ? participantPhone : '').trim().slice(0, 80);
  const rideRef = doc(db, 'rides', rideId);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(rideRef);
    if (!snap.exists()) throw new Error('RIDE_NOT_FOUND');
    const data = snap.data();
    if (String(data.rideStatus || 'active') === 'cancelled') throw new Error('RIDE_CANCELLED');
    const isPrivate = !!data.isPrivate;
    const invitedList = asStringArray(data.invitedList);
    const hostUid = String(data.hostUserId || '');
    const pwdStored = String(data.rideJoinPassword != null ? data.rideJoinPassword : '')
      .replace(/\D/g, '')
      .slice(0, 4);
    if (isPrivate && hostUid !== String(userId)) {
      const invited = isUserPhoneInvitedToRide(phoneLabel, invitedList);
      const pwdOk = pwdStored.length === 4 && joinPasswordAttempt === pwdStored;
      if (!invited && !pwdOk) {
        throw new Error('INVITE_ONLY');
      }
    }
    let participants = asStringArray(data.participants);
    let waitlist = asStringArray(data.waitlist);
    let participantDisplay = { ...asParticipantDisplay(data.participantDisplay) };
    let participantContact = { ...asParticipantContact(data.participantContact) };
    let participantContactPublic = { ...asParticipantContactPublic(data.participantContactPublic) };
    const max = Math.max(1, Number(data.maxParticipants) || 1);

    if (participants.includes(userId)) {
      return { status: 'already', role: 'participant' };
    }
    const wIdx = waitlist.indexOf(userId);
    if (wIdx >= 0) {
      return { status: 'already', role: 'waitlist', position: wIdx + 1 };
    }

    participantDisplay = Object.assign({}, participantDisplay, { [String(userId)]: nameLabel });
    if (phoneLabel) participantContact[String(userId)] = phoneLabel;
    participantContactPublic[String(userId)] = contactPublicToParticipants;

    if (participants.length < max) {
      participants = [...participants, userId];
      transaction.update(rideRef, {
        participants,
        participantDisplay,
        participantContact,
        participantContactPublic,
        updatedAt: serverTimestamp()
      });
      return { status: 'joined', role: 'participant' };
    }

    waitlist = [...waitlist, userId];
    transaction.update(rideRef, {
      waitlist,
      participantDisplay,
      participantContact,
      participantContactPublic,
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
        participantContact: omitParticipantContact(data.participantContact, userId),
        participantContactPublic: omitParticipantContactPublic(data.participantContactPublic, userId),
        updatedAt: serverTimestamp()
      });
      return { status: 'left_waitlist', promotedUserId: null };
    }

    if (inPart) {
      participants = participants.filter((id) => id !== userId);
      let participantDisplay = omitParticipantDisplay(data.participantDisplay, userId);
      let participantContact = omitParticipantContact(data.participantContact, userId);
      let participantContactPublic = omitParticipantContactPublic(data.participantContactPublic, userId);
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
        participantContact,
        participantContactPublic,
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
    updateRideByHost,
    cancelRideByHost,
    computeMatchingRideDates,
    computeHostRideDateKeys,
    normalizePhoneDigits,
    isUserPhoneInvitedToRide
  };
}
