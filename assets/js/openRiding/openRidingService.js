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
  limit,
  runTransaction,
  onSnapshot,
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

/** @param {number} n */
function pad2Schedule(n) {
  return String(n).padStart(2, '0');
}

function getTodaySeoulYmdSchedule() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    let y = '';
    let m = '';
    let d = '';
    parts.forEach((p) => {
      if (p.type === 'year') y = p.value;
      if (p.type === 'month') m = p.value;
      if (p.type === 'day') d = p.value;
    });
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch (e) {
    /* ignore */
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/** @param {unknown} dateField */
function coerceRideDateToDateSchedule(dateField) {
  if (dateField == null) return null;
  if (dateField instanceof Date && !Number.isNaN(dateField.getTime())) return dateField;
  if (typeof dateField.toDate === 'function') {
    try {
      const t = dateField.toDate();
      if (t instanceof Date && !Number.isNaN(t.getTime())) return t;
    } catch (e) {
      /* ignore */
    }
  }
  const sec = dateField.seconds != null ? dateField.seconds : dateField._seconds;
  if (typeof sec === 'number' && Number.isFinite(sec)) return new Date(sec * 1000);
  return null;
}

/** @param {{ date?: unknown }} ride */
function getRideDateSeoulYmdFromData(ride) {
  if (!ride || ride.date == null) return null;
  const ts = coerceRideDateToDateSchedule(ride.date);
  if (!ts) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(ts);
    let y = '';
    let m = '';
    let d = '';
    parts.forEach((p) => {
      if (p.type === 'year') y = p.value;
      if (p.type === 'month') m = p.value;
      if (p.type === 'day') d = p.value;
    });
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch (e) {
    /* ignore */
  }
  return null;
}

/** @param {unknown} ymd */
function normalizeYmdSchedule(ymd) {
  if (ymd == null) return '';
  const s = String(ymd).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return s;
  return `${m[1]}-${pad2Schedule(parseInt(m[2], 10))}-${pad2Schedule(parseInt(m[3], 10))}`;
}

/** @param {unknown} a @param {unknown} b */
function ymdEqualSchedule(a, b) {
  return normalizeYmdSchedule(a) === normalizeYmdSchedule(b);
}

const HOST_REVIEW_DIST_TOLERANCE = 0.1;
const HOST_REVIEW_MIN_KM_IF_NO_PLANNED = 12;

/**
 * Whether hostPublicReviewSummary counts as completed group ride: same Seoul date as ride,
 * and logged distance within ±10% of ride.distance, or strictly longer than planned km (or min km if distance unset).
 * @param {{ distance?: unknown; date?: unknown }} rideData
 * @param {{ rideDateYmd?: unknown; summary?: unknown }} hostBlock
 */
export function openRidingHostSummaryQualifiesAsGroupRide(rideData, hostBlock) {
  if (!rideData || !hostBlock || typeof hostBlock !== 'object') return false;
  const s = hostBlock.summary;
  if (!s || typeof s !== 'object') return false;
  const rideYmd = getRideDateSeoulYmdFromData(rideData);
  if (!rideYmd || !ymdEqualSchedule(hostBlock.rideDateYmd, rideYmd)) return false;
  const logged = Number(s.distance_km != null ? s.distance_km : 0) || 0;
  if (!(logged > 0)) return false;
  const planned = Number(rideData.distance != null ? rideData.distance : 0) || 0;
  if (planned > 0) {
    const lo = planned * (1 - HOST_REVIEW_DIST_TOLERANCE);
    const hi = planned * (1 + HOST_REVIEW_DIST_TOLERANCE);
    const inToleranceBand = logged >= lo && logged <= hi;
    const longerThanPlanned = logged > planned;
    return inToleranceBand || longerThanPlanned;
  }
  return logged >= HOST_REVIEW_MIN_KM_IF_NO_PLANNED;
}

/**
 * 방장 공개 후기가 해당 일정일에 작성·동기화된 경우(참석·취소 잠금).
 * ±10% 거리 규칙(openRidingHostSummaryQualifiesAsGroupRide)과 별개로, 요약 거리만 있으면 후기 작성으로 본다.
 * @param {{ distance?: unknown; date?: unknown }} rideData
 * @param {{ rideDateYmd?: unknown; summary?: unknown }} hostBlock
 */
export function openRidingHostPublicReviewWritten(rideData, hostBlock) {
  if (!rideData || !hostBlock || typeof hostBlock !== 'object') return false;
  const s = hostBlock.summary;
  if (!s || typeof s !== 'object') return false;
  const rideYmd = getRideDateSeoulYmdFromData(rideData);
  if (!rideYmd || !ymdEqualSchedule(hostBlock.rideDateYmd, rideYmd)) return false;
  const logged = Number(s.distance_km != null ? s.distance_km : 0) || 0;
  return logged > 0;
}

/**
 * Ride is "ended" for join closure and ended-state UI (Seoul calendar date).
 * 1) Cancelled
 * 2) Ride date (Seoul YMD) is before today
 * 3) Ride date is today: hostPublicReviewSummary가 해당 일에 작성되고 거리 기록이 있음(방장 후기 = 라이딩 종료)
 * @param {{ rideStatus?: unknown; date?: unknown; distance?: unknown; hostPublicReviewSummary?: unknown }} rideData
 */
export function isOpenRidingScheduleEnded(rideData) {
  if (!rideData || typeof rideData !== 'object') return false;
  if (String(rideData.rideStatus || 'active') === 'cancelled') return true;
  const rideYmd = getRideDateSeoulYmdFromData(rideData);
  if (!rideYmd) return false;
  const today = getTodaySeoulYmdSchedule();
  if (rideYmd < today) return true;
  if (rideYmd > today) return false;
  const h = rideData.hostPublicReviewSummary;
  if (!h || typeof h !== 'object') return false;
  return openRidingHostPublicReviewWritten(rideData, h);
}

/** @deprecated use isOpenRidingScheduleEnded — join closed === schedule ended */
export function isRideJoinClosedBySchedule(rideData) {
  return isOpenRidingScheduleEnded(rideData);
}

/**
 * Strava 참석 검증 자동 실행 조건: 라이딩 일정일(서울 달력)이 **오늘보다 이전**일 때만 true.
 * 당일 방장 후기 업로드와 무관 — 일정일이 지난 뒤(익일 0시 서울 이후)에만 검증되어, 당일 집 복귀 중인 참가자 활동 반영 시간을 확보한다.
 * 취소된 모임은 검증하지 않음.
 * @param {{ rideStatus?: unknown; date?: unknown }} rideData
 */
export function isRideScheduleDatePastSeoul(rideData) {
  if (!rideData || typeof rideData !== 'object') return false;
  if (String(rideData.rideStatus || 'active') === 'cancelled') return false;
  const rideYmd = getRideDateSeoulYmdFromData(rideData);
  if (!rideYmd) return false;
  const today = getTodaySeoulYmdSchedule();
  return rideYmd < today;
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
  const prev = base[key];
  if (prev) {
    const prevS = String(prev).trim();
    const slash = prevS.indexOf('/');
    if (slash >= 0) {
      const fb = prevS.slice(slash + 1).trim();
      const loc = prevS.slice(0, slash).trim();
      if (nm === fb || nm === prevS || nm === loc) return base;
      return Object.assign({}, base, { [key]: `${loc}/${nm}`.slice(0, 40) });
    }
    if (prevS === nm) return base;
    return Object.assign({}, base, { [key]: `${prevS}/${nm}`.slice(0, 40) });
  }
  return Object.assign({}, base, { [key]: nm });
}

/** users.contact 등 쿼리용 전화 후보(오픈라이딩 상세 조회와 동일 규칙) */
function buildOpenRidingInvitePhoneQueryCandidates(normDigits) {
  const d = normalizePhoneDigits(normDigits);
  const candidates = [];
  const add = (x) => {
    const s = String(x || '').trim();
    if (s && !candidates.includes(s)) candidates.push(s);
  };
  if (d.length < 8) return candidates;
  add(d);
  if (d.length === 11 && d.startsWith('010')) {
    add(`${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`);
    add(`${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7, 11)}`);
    const rest11 = d.slice(3);
    add(`+82-10-${rest11.slice(0, 4)}-${rest11.slice(4, 8)}`);
    add(`+82 10-${rest11.slice(0, 4)}-${rest11.slice(4, 8)}`);
  }
  if (d.length === 11 && d.startsWith('011')) {
    add(`${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`);
  }
  if (d.length === 10 && d[0] === '0') {
    add(`${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 10)}`);
    add(`${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`);
  }
  if (d.length >= 10 && d[0] === '0') {
    add(`82${d.slice(1)}`);
    add(`+82${d.slice(1)}`);
  }
  return candidates;
}

async function fetchUserDisplayNameByPhoneForOpenRiding(db, candidates) {
  if (!db || !candidates.length) return '';
  const col = collection(db, 'users');
  const fields = ['contact', 'phone', 'phoneNumber', 'tel'];
  for (const field of fields) {
    for (const c of candidates) {
      try {
        const q = query(col, where(field, '==', c), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const row = snap.docs[0].data();
          const nm = String((row && row.name) || (row && row.displayName) || '').trim();
          if (nm) return nm;
        }
      } catch {
        /* 규칙·인덱스 등 */
      }
    }
  }
  return '';
}

function inviteDisplayAddressBookPart(stored) {
  const s = String(stored != null ? stored : '').trim();
  if (!s) return '';
  const i = s.indexOf('/');
  return (i >= 0 ? s.slice(0, i) : s).trim();
}

/**
 * 방장 전용: inviteDisplayByPhone 값을 users.name 과 병합 (주소록명/users이름, 미가입은 주소록만 유지)
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} hostUserId
 * @returns {Promise<{ updated: number }>}
 */
export async function enrichInviteDisplayByPhoneFromUsers(db, rideId, hostUserId) {
  const rideRef = doc(db, 'rides', rideId);
  const snap = await getDoc(rideRef);
  if (!snap.exists()) throw new Error('RIDE_NOT_FOUND');
  const data = snap.data();
  if (String(data.hostUserId || '').trim() !== String(hostUserId || '').trim()) throw new Error('FORBIDDEN');
  const idp = sanitizeInviteDisplayByPhone(data.inviteDisplayByPhone);
  const keys = Object.keys(idp);
  if (keys.length === 0) return { updated: 0 };
  const patch = {};
  for (const key of keys) {
    const stored = String(idp[key] != null ? idp[key] : '').trim();
    if (!stored) continue;
    const localOnly = inviteDisplayAddressBookPart(stored);
    if (!localOnly) continue;
    const candidates = buildOpenRidingInvitePhoneQueryCandidates(key);
    const fbName = await fetchUserDisplayNameByPhoneForOpenRiding(db, candidates);
    if (!fbName) continue;
    let next = stored;
    if (fbName !== localOnly) next = `${localOnly}/${fbName}`.slice(0, 40);
    else next = localOnly.slice(0, 40);
    if (next !== stored) patch[key] = next;
  }
  if (Object.keys(patch).length === 0) return { updated: 0 };
  await mergeInviteDisplayByPhoneForHost(db, rideId, hostUserId, patch);
  return { updated: Object.keys(patch).length };
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
 * Ride detail: live subscription so hostPublicReviewSummary updates reach guests without reload.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {(data: (Record<string, unknown> & { id: string }) | null) => void} onNext
 * @param {(err: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeRideById(db, rideId, onNext, onError) {
  if (!db || rideId == null || String(rideId).trim() === '') {
    onNext(null);
    return function () {};
  }
  const ref = doc(db, 'rides', String(rideId).trim());
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) onNext(null);
      else onNext({ id: snap.id, ...snap.data() });
    },
    onError ||
      function (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[openRiding] subscribeRideById', err);
        }
      }
  );
}

/**
 * Persist host ride-review summary on the ride doc for guests (they cannot read users/{hostUid}/logs).
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} rideDateYmd Seoul calendar YYYY-MM-DD
 * @param {object} mergedLog from openRidingMergeLogsForReviewSummary
 */
export function sanitizeHostPublicReviewSummaryPayload(mergedLog) {
  if (!mergedLog || typeof mergedLog !== 'object') return null;
  try {
    const raw = {
      distance_km: mergedLog.distance_km,
      duration_sec: mergedLog.duration_sec,
      tss: mergedLog.tss,
      if: mergedLog.if,
      kilojoules: mergedLog.kilojoules,
      elevation_gain: mergedLog.elevation_gain,
      avg_speed_kmh: mergedLog.avg_speed_kmh,
      avg_cadence: mergedLog.avg_cadence,
      avg_hr: mergedLog.avg_hr,
      max_hr: mergedLog.max_hr,
      avg_watts: mergedLog.avg_watts,
      weighted_watts: mergedLog.weighted_watts,
      max_watts: mergedLog.max_watts,
      time_in_zones: mergedLog.time_in_zones,
      source: mergedLog.source != null ? String(mergedLog.source) : 'strava'
    };
    return JSON.parse(JSON.stringify(raw));
  } catch (e) {
    return null;
  }
}

export async function syncHostPublicReviewSummary(db, rideId, rideDateYmd, mergedLog, chartProfile) {
  const summary = sanitizeHostPublicReviewSummaryPayload(mergedLog);
  if (!db || !rideId || !rideDateYmd || !summary) return;
  const uidForPeak =
    chartProfile && typeof chartProfile === 'object'
      ? String(chartProfile.uid != null ? chartProfile.uid : chartProfile.id != null ? chartProfile.id : '').trim()
      : '';
  let resolvedPeakHr = null;
  if (uidForPeak && typeof globalThis !== 'undefined') {
    const rollFn = globalThis.fetchMaxHrRolling365Days || globalThis.getMaxHrFromLogsRolling365Days;
    if (typeof rollFn === 'function') {
      try {
        const res = await rollFn(uidForPeak);
        const hr = res && res.maxHr != null ? Number(res.maxHr) : NaN;
        if (hr > 0) resolvedPeakHr = hr;
      } catch (_e) {
        /* host-only; chartProfile fallback below */
      }
    }
  }
  if (resolvedPeakHr == null && chartProfile && Number(chartProfile.max_hr) > 0) {
    resolvedPeakHr = Number(chartProfile.max_hr);
  }
  if (resolvedPeakHr != null && resolvedPeakHr > 0) {
    summary.zone_ref_max_hr = resolvedPeakHr;
    summary.zone_ref_window = '365d';
  }
  const block = {
    rideDateYmd: String(rideDateYmd).trim(),
    summary: summary,
    updatedAt: serverTimestamp()
  };
  if (chartProfile && typeof chartProfile === 'object') {
    const uid = String(chartProfile.uid != null ? chartProfile.uid : chartProfile.id != null ? chartProfile.id : '')
      .trim();
    if (uid) {
      const maxHr =
        resolvedPeakHr != null && resolvedPeakHr > 0
          ? resolvedPeakHr
          : Number(chartProfile.max_hr) > 0
            ? Number(chartProfile.max_hr)
            : 190;
      block.chartProfile = {
        uid: uid,
        ftp: Number(chartProfile.ftp) > 0 ? Number(chartProfile.ftp) : 200,
        max_hr: maxHr
      };
    }
  }
  await updateDoc(doc(db, 'rides', rideId), {
    hostPublicReviewSummary: block
  });
}

/** YYYY-M-D / YYYY-MM-DD 등을 YYYY-MM-DD로 맞춤 (합산·저장 시 일자 불일치 방지) */
function normalizeParticipantReviewYmd(ymd) {
  if (ymd == null) return '';
  const s = String(ymd).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return s;
  const pad2 = (n) => String(Number(n)).padStart(2, '0');
  return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
}

/**
 * 라이딩 일정일과 맞는 방장 공개 후기 요약 거리(km). participantStravaReview에 방장 문서가 없을 때 합산에 사용.
 * @param {unknown} rideData rides 문서
 * @param {string} rideDateYmdNorm normalizeParticipantReviewYmd 결과
 */
function hostPublicReviewDistanceKmForRideSchedule(rideData, rideDateYmdNorm) {
  if (!rideDateYmdNorm || !rideData || typeof rideData !== 'object') return 0;
  const h = rideData.hostPublicReviewSummary;
  if (!h || typeof h !== 'object') return 0;
  const s = h.summary;
  if (!s || typeof s !== 'object') return 0;
  const dYmd = normalizeParticipantReviewYmd(String(h.rideDateYmd != null ? h.rideDateYmd : '').trim());
  if (!dYmd || dYmd !== rideDateYmdNorm) return 0;
  const dist = Number(s.distance_km != null ? s.distance_km : 0) || 0;
  return dist > 0 ? dist : 0;
}

/**
 * 참석자(방장 포함) STRAVA 일지 거리를 라이딩별로 저장 — 후기 화면 누적거리 합산용
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} userId
 * @param {string} rideDateYmd Seoul YYYY-MM-DD
 * @param {{ distance_km?: number, source?: string }} mergedLog openRidingMergeLogsForReviewSummary 결과
 */
export async function syncParticipantStravaReviewContribution(db, rideId, userId, rideDateYmd, mergedLog) {
  if (!db || !rideId || !userId || !rideDateYmd || !mergedLog || typeof mergedLog !== 'object') return;
  const src = String(mergedLog.source != null ? mergedLog.source : '').toLowerCase();
  if (src !== 'strava') return;
  const dist = Number(mergedLog.distance_km);
  if (!Number.isFinite(dist) || dist <= 0) return;
  const ref = doc(db, 'rides', String(rideId).trim(), 'participantStravaReview', String(userId).trim());
  const ymdStored = normalizeParticipantReviewYmd(rideDateYmd) || String(rideDateYmd).trim();
  await setDoc(
    ref,
    {
      rideDateYmd: ymdStored,
      distanceKm: dist,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

/**
 * 후기「함께 달린 거리」: 방장 공개 후기 거리(일정일 일치) + participantStravaReview 합계.
 * 방장 문서가 서브컬렉션에도 있으면 공개 후기 거리로 대체해 이중 합산하지 않음.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {string} rideDateYmd
 * @param {string} [hostUserId] 방장 uid (없으면 서브컬렉션 합만). 생략 시 (db, rideId, ymd, onNext, onError) 5인자 호환
 * @param {(sumKm: number) => void} onNext
 * @param {(err: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeParticipantStravaReviewSumKm(db, rideId, rideDateYmd, hostUserId, onNext, onError) {
  const legacy5 = typeof hostUserId === 'function';
  let hostUid = '';
  let onCb = onNext;
  let errCb = onError;
  if (legacy5) {
    onCb = hostUserId;
    errCb = typeof onNext === 'function' ? onNext : undefined;
  } else {
    hostUid = String(hostUserId != null ? hostUserId : '').trim();
    onCb = onNext;
    errCb = onError;
  }
  if (!db || rideId == null || String(rideId).trim() === '' || !rideDateYmd || String(rideDateYmd).trim() === '') {
    if (typeof onCb === 'function') onCb(0);
    return function () {};
  }
  const ymdNorm = normalizeParticipantReviewYmd(rideDateYmd);
  const rideIdTrim = String(rideId).trim();
  const colRef = collection(db, 'rides', rideIdTrim, 'participantStravaReview');

  const errHandler =
    errCb ||
    function (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[openRiding] subscribeParticipantStravaReviewSumKm', err);
      }
      if (typeof onCb === 'function') onCb(0);
    };

  if (legacy5) {
    return onSnapshot(
      colRef,
      (snap) => {
        let sum = 0;
        snap.forEach((d) => {
          const data = d.data();
          const dYmdRaw = String(data.rideDateYmd != null ? data.rideDateYmd : '').trim();
          const dYmd = normalizeParticipantReviewYmd(dYmdRaw);
          const dist = Number(data.distanceKm != null ? data.distanceKm : 0) || 0;
          if (dist <= 0) return;
          if (!dYmdRaw || dYmd === ymdNorm) {
            sum += dist;
          }
        });
        if (typeof onCb === 'function') onCb(sum);
      },
      errHandler
    );
  }

  const rideRef = doc(db, 'rides', rideIdTrim);

  /** @type {import('firebase/firestore').QuerySnapshot | null} */
  let latestColSnap = null;
  /** @type {unknown} */
  let latestRideData = null;

  /** 참석 확정자만 합산(이탈·잔존 문서 혼선 방지). participants 필드가 없으면 필터 생략. */
  function participantsUidSetForStravaSum(rideData) {
    if (!rideData || typeof rideData !== 'object') return null;
    if (!Array.isArray(rideData.participants)) return null;
    const s = new Set();
    rideData.participants.forEach((x) => {
      const u = String(x != null ? x : '').trim();
      if (u) s.add(u);
    });
    return s;
  }

  function emitTogether() {
    if (latestColSnap == null) return;
    let sumAll = 0;
    let hostSubKm = 0;
    const allowedUids = participantsUidSetForStravaSum(latestRideData);
    const hostUidTrim = hostUid ? String(hostUid).trim() : '';
    latestColSnap.forEach((d) => {
      const docUid = String(d.id != null ? d.id : '').trim();
      if (allowedUids != null && docUid && !allowedUids.has(docUid)) return;
      const data = d.data();
      const dYmdRaw = String(data.rideDateYmd != null ? data.rideDateYmd : '').trim();
      const dYmd = normalizeParticipantReviewYmd(dYmdRaw);
      const dist = Number(data.distanceKm != null ? data.distanceKm : 0) || 0;
      if (dist <= 0) return;
      if (!dYmdRaw || dYmd === ymdNorm) {
        sumAll += dist;
        if (hostUidTrim && docUid === hostUidTrim) hostSubKm = dist;
      }
    });
    const hostSummaryKm = hostPublicReviewDistanceKmForRideSchedule(latestRideData, ymdNorm);
    const together = sumAll + Math.max(0, hostSummaryKm - hostSubKm);
    if (typeof onCb === 'function') onCb(together);
  }

  const unsubRide = onSnapshot(
    rideRef,
    (rideSnap) => {
      latestRideData = rideSnap.exists() ? rideSnap.data() : null;
      emitTogether();
    },
    errHandler
  );

  const unsubCol = onSnapshot(
    colRef,
    (snap) => {
      latestColSnap = snap;
      emitTogether();
    },
    errHandler
  );

  return function () {
    unsubCol();
    unsubRide();
  };
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
    if (isOpenRidingScheduleEnded(data)) throw new Error('RIDE_JOIN_CLOSED');
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
    if (isOpenRidingScheduleEnded(data)) throw new Error('RIDE_JOIN_CLOSED');
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

/** 동일 rideId에 대해 방장 단말에서 Callable 중복 호출 방지(스냅샷 연속 갱신 대비) */
const _openRidingAttendanceHostLocks = new Set();
const _openRidingAttendanceHostSucceeded = new Set();

/**
 * 라이딩 일정일(서울)이 오늘보다 지난 뒤(isRideScheduleDatePastSeoul) 방장이 상세를 볼 때
 * 참석 검증 Cloud Function(verifyMeetingAttendance)을 1회 호출합니다.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} rideId
 * @param {Record<string, unknown>} ride
 * @returns {Promise<{ skipped: boolean; reason?: string; result?: unknown; error?: string }>}
 */
export async function triggerVerifyMeetingAttendanceForEndedRideIfHost(db, rideId, ride) {
  if (!db || !rideId || !ride || typeof ride !== 'object') return { skipped: true, reason: 'BAD_ARGS' };
  if (!isRideScheduleDatePastSeoul(ride)) return { skipped: true, reason: 'SCHEDULE_DAY_NOT_PAST' };
  if (ride.attendanceVerificationRan === true) return { skipped: true, reason: 'ALREADY_RAN' };

  const lockKey = String(rideId).trim();
  if (_openRidingAttendanceHostSucceeded.has(lockKey)) return { skipped: true, reason: 'ALREADY_SUCCEEDED_SESSION' };

  var authU =
    typeof window !== 'undefined' && window.authV9 && window.authV9.currentUser
      ? window.authV9.currentUser
      : typeof window !== 'undefined' && window.auth && window.auth.currentUser
        ? window.auth.currentUser
        : null;
  if (!authU || !authU.uid) return { skipped: true, reason: 'NOT_LOGGED_IN' };
  if (String(ride.hostUserId || '').trim() !== String(authU.uid).trim()) return { skipped: true, reason: 'NOT_HOST' };

  if (_openRidingAttendanceHostLocks.has(lockKey)) return { skipped: true, reason: 'IN_FLIGHT' };
  _openRidingAttendanceHostLocks.add(lockKey);

  try {
    var funcs =
      typeof window !== 'undefined' && window.functionsAsiaNortheast3V9
        ? window.functionsAsiaNortheast3V9
        : typeof window !== 'undefined' && window.functionsV9
          ? window.functionsV9
          : null;
    if (!funcs) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[openRiding] Functions 미초기화 — 참석 검증 생략');
      return { skipped: true, reason: 'NO_FUNCTIONS' };
    }
    var funcMod = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-functions.js');
    var httpsCallable = funcMod.httpsCallable;
    if (typeof httpsCallable !== 'function') {
      return { skipped: true, reason: 'NO_HTTPS_CALLABLE' };
    }
    var callable = httpsCallable(funcs, 'verifyMeetingAttendance');
    var res = await callable({ meetingId: String(rideId).trim() });
    var payload = res && res.data != null ? res.data : res;

    await updateDoc(doc(db, 'rides', lockKey), {
      attendanceVerificationRan: true,
      attendanceVerificationAt: serverTimestamp(),
      attendanceVerificationSummary: {
        processedCount: payload && payload.processedCount != null ? payload.processedCount : null,
        attendedCount: payload && payload.attendedCount != null ? payload.attendedCount : null,
        missedCount: payload && payload.missedCount != null ? payload.missedCount : null,
        skippedCount: payload && payload.skippedCount != null ? payload.skippedCount : null
      }
    });
    _openRidingAttendanceHostSucceeded.add(lockKey);
    return { skipped: false, result: payload };
  } catch (err) {
    var msg = err && err.message ? String(err.message) : String(err);
    if (typeof console !== 'undefined' && console.warn) console.warn('[openRiding] 참석 검증 Callable 실패:', msg);
    return { skipped: true, reason: 'CALLABLE_ERROR', error: msg };
  } finally {
    _openRidingAttendanceHostLocks.delete(lockKey);
  }
}

if (typeof window !== 'undefined') {
  window.openRidingService = {
    saveUserOpenRidingPreferences,
    getUserOpenRidingPreferences,
    createRide,
    uploadRideGpx,
    fetchRidesInDateRange,
    fetchRideById,
    subscribeRideById,
    syncHostPublicReviewSummary,
    syncParticipantStravaReviewContribution,
    subscribeParticipantStravaReviewSumKm,
    sanitizeHostPublicReviewSummaryPayload,
    joinRideTransaction,
    leaveRideTransaction,
    updateRideByHost,
    enrichInviteDisplayByPhoneFromUsers,
    mergeInviteDisplayByPhoneForHost,
    cancelRideByHost,
    deleteRideByHost,
    computeMatchingRideDates,
    computeHostRideDateKeys,
    normalizePhoneDigits,
    isUserPhoneInvitedToRide,
    normalizePackRidingRules,
    isRideJoinClosedBySchedule,
    isOpenRidingScheduleEnded,
    isRideScheduleDatePastSeoul,
    openRidingHostPublicReviewWritten,
    openRidingHostSummaryQualifiesAsGroupRide,
    triggerVerifyMeetingAttendanceForEndedRideIfHost
  };
}
