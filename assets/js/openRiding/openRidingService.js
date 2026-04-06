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

/** @param {unknown} v @param {number} maxLen */
function trimPackText(v, maxLen) {
  const t = String(v != null ? v : '').trim();
  if (!t) return '';
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/**
 * 팩 라이딩 룰(운영 방식) — 옵션 필드만 저장, 빈 값 허용
 * @param {unknown} input
 * @returns {{ rotation: string; nodrop: string; gear: { helmet: boolean; lights: boolean; puncture: boolean; water: boolean }; minorsAllowed: string; openSectionText: string; supplySectionText: string; feeText: string; cancelConditionText: string }}
 */
export function normalizePackRidingRules(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const gearIn = src.gear && typeof src.gear === 'object' && !Array.isArray(src.gear) ? src.gear : {};
  const rot = String(src.rotation || '');
  const rotation = rot === 'maalseon' || rot === 'rotation' ? rot : '';
  const nd = String(src.nodrop || '');
  const nodrop = nd === 'together' || nd === 'ownpace' ? nd : '';
  const minors = String(src.minorsAllowed || '');
  const minorsAllowed = minors === 'yes' || minors === 'no' ? minors : '';
  return {
    rotation,
    nodrop,
    gear: {
      helmet: !!gearIn.helmet,
      lights: !!gearIn.lights,
      puncture: !!gearIn.puncture,
      water: !!gearIn.water
    },
    minorsAllowed,
    openSectionText: trimPackText(src.openSectionText, 1000),
    supplySectionText: trimPackText(src.supplySectionText, 1000),
    feeText: trimPackText(src.feeText, 500),
    cancelConditionText: trimPackText(src.cancelConditionText, 1000)
  };
}

/** 전화번호 비교용 정규화 (숫자만, +82 → 0) */
export function normalizePhoneDigits(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 10) d = `0${d.slice(2)}`;
  return d.slice(0, 15);
}

/**
 * 비공개·공개(초대 지정) 방 초대 목록과 사용자 연락처 일치 여부
 * 국가코드 등 표기 차이는 정규화 후 뒤 8자리 일치로 판별 (예: 8210… vs 010…)
 * @param {string} userPhone
 * @param {string[]} invitedList Firestore invited_list
 */
export function isUserPhoneInvitedToRide(userPhone, invitedList) {
  const u = normalizePhoneDigits(userPhone);
  if (!u || u.length < 8) return false;
  const list = Array.isArray(invitedList) ? invitedList : [];
  return list.some((inv) => {
    const n = normalizePhoneDigits(inv);
    if (!n || n.length < 8) return false;
    if (n === u) return true;
    return n.slice(-8) === u.slice(-8);
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

/** 정규화된 전화 키 → 초대 시 방장이 지정한 표시 이름(상세 화면 전체 공개) */
function sanitizeInviteDisplayByPhone(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  Object.keys(v).forEach((k) => {
    const key = normalizePhoneDigits(k);
    const label = String(v[k] != null ? v[k] : '')
      .trim()
      .slice(0, 40);
    /** UI 자리표시어 '초대'는 저장하지 않음(상세에서 실명 조회가 막힘) */
    if (key.length >= 8 && label && label !== '초대') out[key] = label;
  });
  return out;
}

/**
 * 정규화 전화 키 → 참석 신청한 UID (비방장은 participantContact로 전화↔UID 매칭 불가 시 사용)
 */
function sanitizeInviteJoinedUidByPhone(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  Object.keys(v).forEach((k) => {
    const key = normalizePhoneDigits(k);
    const uid = String(v[k] != null ? v[k] : '')
      .trim()
      .slice(0, 128);
    if (key.length >= 8 && uid) out[key] = uid;
  });
  return out;
}

function mergeInviteJoinedUidOnJoin(inviteUidMap, phoneRaw, userId) {
  const base = sanitizeInviteJoinedUidByPhone(inviteUidMap);
  const key = normalizePhoneDigits(phoneRaw);
  const uid = String(userId != null ? userId : '').trim();
  if (key.length < 8 || !uid) return base;
  return Object.assign({}, base, { [key]: uid });
}

function omitInviteJoinedUidByPhoneForPhone(inviteUidMap, phoneRaw) {
  const base = sanitizeInviteJoinedUidByPhone(inviteUidMap);
  const key = normalizePhoneDigits(phoneRaw);
  if (key.length < 8) return base;
  const o = { ...base };
  if (Object.prototype.hasOwnProperty.call(o, key)) {
    delete o[key];
    return o;
  }
  for (const k of Object.keys(o)) {
    const nk = normalizePhoneDigits(k);
    if (nk === key || (key.length >= 8 && nk.slice(-8) === key.slice(-8))) {
      delete o[k];
      break;
    }
  }
  return o;
}

/** 참석 신청 시: 초대 명단 공개 맵에 표시명 병합 (비방장도 읽기 가능한 필드) */
function mergeInviteDisplayOnJoin(inviteMap, phoneRaw, nameLabel) {
  const base = sanitizeInviteDisplayByPhone(inviteMap);
  const key = normalizePhoneDigits(phoneRaw);
  const nm = String(nameLabel != null ? nameLabel : '')
    .trim()
    .slice(0, 40);
  if (key.length < 8 || !nm || nm === '초대') return base;
  return Object.assign({}, base, { [key]: nm });
}

function omitInviteDisplayByPhoneForPhone(inviteMap, phoneRaw) {
  const base = sanitizeInviteDisplayByPhone(inviteMap);
  const key = normalizePhoneDigits(phoneRaw);
  if (key.length < 8) return base;
  const o = { ...base };
  if (Object.prototype.hasOwnProperty.call(o, key)) {
    delete o[key];
    return o;
  }
  for (const k of Object.keys(o)) {
    const nk = normalizePhoneDigits(k);
    if (nk === key || (key.length >= 8 && nk.slice(-8) === key.slice(-8))) {
      delete o[k];
      break;
    }
  }
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
  /** Firestore·클라이언트 비교 일관성을 위해 방장 UID는 항상 trim 문자열 */
  const hostKey = String(hostUserId != null ? hostUserId : '').trim();
  const hostLabel = String(input.hostName || '').trim().slice(0, 80);
  const hostPhone = String(input.contactInfo || '').trim().slice(0, 80);
  const participantDisplay = {};
  if (hostKey && hostLabel) participantDisplay[hostKey] = hostLabel;
  /** 방장 기본값: 1번 참석 확정 + 참석자 간 연락처 공개(신청 시 공개와 동일 정책) */
  let participants = asStringArray(input.participants).map((id) => String(id).trim()).filter(Boolean);
  if (hostKey) {
    participants = [hostKey, ...participants.filter((id) => id !== hostKey)];
  }
  const participantContact = {};
  const participantContactPublic = {};
  if (hostKey) {
    if (hostPhone) participantContact[hostKey] = hostPhone;
    participantContactPublic[hostKey] = true;
  }
  const isPrivate = !!input.isPrivate;
  const invitedRaw = Array.isArray(input.invitedList) ? input.invitedList : [];
  const invitedList = invitedRaw
    .map((x) => normalizePhoneDigits(typeof x === 'string' ? x : (x && x.phone) != null ? x.phone : x))
    .filter((d) => d.length >= 8);
  const inviteDisplayByPhone = sanitizeInviteDisplayByPhone(input.inviteDisplayByPhone);
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
    inviteDisplayByPhone,
    rideJoinPassword: rideJoinPassword.length === 4 ? rideJoinPassword : '',
    participantContact,
    participantContactPublic,
    participants,
    waitlist: [],
    participantDisplay,
    hostUserId: hostKey || hostUserId,
    packRidingRules: normalizePackRidingRules(input.packRidingRules),
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
  const invitedRaw = Array.isArray(input.invitedList) ? input.invitedList : [];
  const invitedList = invitedRaw
    .map((x) => normalizePhoneDigits(typeof x === 'string' ? x : (x && x.phone) != null ? x.phone : x))
    .filter((d) => d.length >= 8);
  const existingIdp = sanitizeInviteDisplayByPhone(data.inviteDisplayByPhone);
  const fromForm = sanitizeInviteDisplayByPhone(input.inviteDisplayByPhone);
  const inviteDisplayByPhone = Object.assign({}, existingIdp, fromForm);
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
    inviteDisplayByPhone,
    rideJoinPassword: isPrivate && rideJoinPassword.length === 4 ? rideJoinPassword : '',
    packRidingRules: normalizePackRidingRules(input.packRidingRules),
    updatedAt: serverTimestamp()
  };
  await updateDoc(rideRef, patch);
}

/**
 * 방장 전용: inviteDisplayByPhone 부분 병합 (프로필 DB에서 조회한 실명을 저장해 초대받은 사용자도 동일 문서로 표시)
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} hostUserId
 * @param {Record<string, unknown>} partialMap 정규화 전화 키 → 표시 이름
 */
export async function mergeInviteDisplayByPhoneForHost(db, rideId, hostUserId, partialMap) {
  const rideRef = doc(db, 'rides', rideId);
  const snap = await getDoc(rideRef);
  if (!snap.exists()) throw new Error('RIDE_NOT_FOUND');
  const data = snap.data();
  if (String(data.hostUserId || '') !== String(hostUserId)) throw new Error('FORBIDDEN');
  const existing = sanitizeInviteDisplayByPhone(data.inviteDisplayByPhone);
  const incoming = sanitizeInviteDisplayByPhone(partialMap);
  const merged = Object.assign({}, existing, incoming);
  await updateDoc(rideRef, {
    inviteDisplayByPhone: merged,
    updatedAt: serverTimestamp()
  });
}

/**
 * 방장 폭파(취소)
 * - 참석 확정(participants) 0명: 문서 삭제
 * - 1명 이상: 기존처럼 rideStatus= cancelled 유지
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} hostUserId
 * @returns {Promise<{ deleted: boolean }>}
 */
export async function cancelRideByHost(db, rideId, hostUserId) {
  const rideRef = doc(db, 'rides', rideId);
  const deleted = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(rideRef);
    if (!snap.exists()) throw new Error('RIDE_NOT_FOUND');
    const data = snap.data();
    if (String(data.hostUserId || '') !== String(hostUserId)) throw new Error('FORBIDDEN');
    const parts = Array.isArray(data.participants) ? data.participants : [];
    if (parts.length === 0) {
      transaction.delete(rideRef);
      return true;
    }
    transaction.update(rideRef, {
      rideStatus: 'cancelled',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return false;
  });
  return { deleted: !!deleted };
}

/**
 * 방장 전용: 등록 라이딩 문서 영구 삭제 (참가자 수와 무관)
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} hostUserId
 * @returns {Promise<{ deleted: boolean }>}
 */
export async function deleteRideByHost(db, rideId, hostUserId) {
  const rideRef = doc(db, 'rides', rideId);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(rideRef);
    if (!snap.exists()) throw new Error('RIDE_NOT_FOUND');
    const data = snap.data();
    if (String(data.hostUserId || '') !== String(hostUserId)) throw new Error('FORBIDDEN');
    transaction.delete(rideRef);
  });
  return { deleted: true };
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
    const inviteJoinedUidByPhone = mergeInviteJoinedUidOnJoin(data.inviteJoinedUidByPhone, phoneLabel, userId);
    const inviteDisplayByPhone = mergeInviteDisplayOnJoin(data.inviteDisplayByPhone, phoneLabel, nameLabel);

    if (participants.length < max) {
      participants = [...participants, userId];
      transaction.update(rideRef, {
        participants,
        participantDisplay,
        participantContact,
        participantContactPublic,
        inviteJoinedUidByPhone,
        inviteDisplayByPhone,
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
      inviteJoinedUidByPhone,
      inviteDisplayByPhone,
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
      const prevPc = asParticipantContact(data.participantContact);
      const leavingPhone = prevPc[String(userId)] || '';
      const inviteJoinedUidByPhone = omitInviteJoinedUidByPhoneForPhone(data.inviteJoinedUidByPhone, leavingPhone);
      const inviteDisplayByPhone = omitInviteDisplayByPhoneForPhone(data.inviteDisplayByPhone, leavingPhone);
      waitlist = waitlist.filter((id) => id !== userId);
      transaction.update(rideRef, {
        waitlist,
        participantDisplay: omitParticipantDisplay(data.participantDisplay, userId),
        participantContact: omitParticipantContact(data.participantContact, userId),
        participantContactPublic: omitParticipantContactPublic(data.participantContactPublic, userId),
        inviteJoinedUidByPhone,
        inviteDisplayByPhone,
        updatedAt: serverTimestamp()
      });
      return { status: 'left_waitlist', promotedUserId: null };
    }

    if (inPart) {
      const prevPc = asParticipantContact(data.participantContact);
      const leavingPhone = prevPc[String(userId)] || '';
      const inviteJoinedUidByPhone = omitInviteJoinedUidByPhoneForPhone(data.inviteJoinedUidByPhone, leavingPhone);
      const inviteDisplayByPhone = omitInviteDisplayByPhoneForPhone(data.inviteDisplayByPhone, leavingPhone);
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
        inviteJoinedUidByPhone,
        inviteDisplayByPhone,
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
    mergeInviteDisplayByPhoneForHost,
    cancelRideByHost,
    deleteRideByHost,
    computeMatchingRideDates,
    computeHostRideDateKeys,
    normalizePhoneDigits,
    isUserPhoneInvitedToRide,
    normalizePackRidingRules
  };
}
