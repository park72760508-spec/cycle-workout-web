/**
 * 오픈 라이딩 — 친구 요청·친구 목록 (Firestore)
 * friendRequests/{fromUid}_{toUid}, users/{uid}/friends/{friendUid}
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { normalizePhoneDigits } from './openRidingService.js';

/** @param {string} a @param {string} b */
export function friendRequestDocId(fromUid, toUid) {
  return `${String(fromUid)}_${String(toUid)}`;
}

function contactFromUserData(data) {
  if (!data || typeof data !== 'object') return '';
  const c =
    data.contact ||
    data.phone ||
    data.phoneNumber ||
    data.tel ||
    '';
  return String(c || '').trim();
}

function nameFromUserData(data) {
  if (!data) return '';
  return String(data.name || data.displayName || '').trim() || '회원';
}

/**
 * 수락 전 검색·요청 목록 표시용(끝 4자리 마스킹). 010-xxxx-yyyy → 010-xxxx-****
 * @param {string} contact
 * @returns {string}
 */
export function maskContactPrivacy(contact) {
  const raw = String(contact || '').trim();
  if (!raw) return '-';
  const d = normalizePhoneDigits(raw);
  if (d.length < 8) {
    if (/\d/.test(raw)) return '****';
    return raw;
  }
  if (d.length === 11 && d.startsWith('010')) {
    return `010-${d.slice(3, 7)}-****`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-****`;
  }
  if (d.length === 10) {
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-****`;
  }
  const head = d.slice(0, Math.max(0, d.length - 4));
  return head ? `${head}-****` : '****';
}

function buildPhoneQueryCandidates(digits) {
  const d = normalizePhoneDigits(digits);
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
  }
  if (d.length >= 10 && d[0] === '0') {
    add(`82${d.slice(1)}`);
    add(`+82${d.slice(1)}`);
  }
  return candidates;
}

/**
 * 뒤 4자리 — Firestore equality용 010-xxxx-yyyy 대표 후보(여러 중간 4자리 시도)
 */
function buildSampleContactCandidatesForSuffix(last4) {
  const s = String(last4 || '').replace(/\D/g, '');
  if (s.length !== 4) return [];
  const mids = [
    1000, 1234, 2000, 2345, 3000, 3456, 4000, 4321, 5000, 5555, 6000, 6543, 7000, 7654, 8000, 8765, 9000, 9876
  ];
  const out = [];
  mids.forEach((mid) => {
    const m = String(mid).padStart(4, '0');
    out.push(`010-${m}-${s}`);
    out.push(`010${m}${s}`);
  });
  return out;
}

async function firestoreQueryUsersByNameAndDisplay(db, term, me, pushRow, getLen, errorSink) {
  const t = String(term || '').trim();
  if (!t) return;
  if (/^[\d\s\-+()]+$/.test(t) && /\d/.test(t) && t.replace(/\D/g, '').length > 0) return;
  const col = collection(db, 'users');
  const label = '이름·표시명 Firestore';

  async function runField(field) {
    if (getLen() >= 30) return;
    try {
      const q1 = query(col, where(field, '==', t), limit(20));
      const s1 = await getDocs(q1);
      s1.forEach((d) => {
        if (getLen() >= 30) return;
        if (!d.id || d.id === me) return;
        const data = d.data();
        pushRow(d.id, nameFromUserData(data), contactFromUserData(data));
      });
    } catch (e) {
      if (errorSink && e && e.message) errorSink.push(`[${label} ${field} 일치] ${e.message}`);
    }
    try {
      const end = t + '\uf8ff';
      const q2 = query(col, where(field, '>=', t), where(field, '<=', end), limit(20));
      const s2 = await getDocs(q2);
      s2.forEach((d) => {
        if (getLen() >= 30) return;
        if (!d.id || d.id === me) return;
        const data = d.data();
        pushRow(d.id, nameFromUserData(data), contactFromUserData(data));
      });
    } catch (e) {
      if (errorSink && e && e.message) {
        errorSink.push(`[${label} ${field} 접두] ${e.message}(인덱스 필요할 수 있음)`);
      }
    }
  }

  await runField('name');
  await runField('displayName');
}

async function firestoreQueryUsersByContactFields(db, candidates, me, pushRow, getLen, errorSink) {
  const col = collection(db, 'users');
  const fields = ['contact', 'phone', 'phoneNumber', 'tel'];
  for (const c of candidates) {
    if (!c || getLen() >= 30) break;
    for (const field of fields) {
      if (getLen() >= 30) break;
      try {
        const q = query(col, where(field, '==', c), limit(8));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          if (getLen() >= 30) return;
          if (!d.id || d.id === me) return;
          const data = d.data();
          pushRow(d.id, nameFromUserData(data), contactFromUserData(data));
        });
      } catch (e) {
        if (errorSink && e && e.message && errorSink.length < 6) {
          errorSink.push(`[전화 ${field}=${c}] ${e.message}`);
        }
      }
    }
  }
}

/**
 * 로컬(메모리) 사용자 목록만으로 검색 — Firestore 실패와 무관하게 표시
 */
function searchUsersInMemoryLists(term, myUid, pushRow, getLen) {
  const me = String(myUid || '').trim();
  const t = String(term || '').trim();
  if (!me || !t) return;
  const digitsOnly = t.replace(/\D/g, '');
  const looksLikePhone = /^[\d\s\-+()]+$/.test(t) && /\d/.test(t);
  const lists = [];
  if (typeof window !== 'undefined') {
    if (Array.isArray(window.users)) lists.push(window.users);
    if (Array.isArray(window.userProfiles)) lists.push(window.userProfiles);
  }
  const tLower = t.toLowerCase();
  for (let li = 0; li < lists.length; li++) {
    const arr = lists[li];
    for (let i = 0; i < arr.length; i++) {
      if (getLen() >= 30) break;
      const u = arr[i];
      if (!u) continue;
      const uid = String(u.id != null ? u.id : u.uid != null ? u.uid : '');
      if (!uid || uid === me) continue;
      const nm = String(u.name != null ? u.name : u.displayName != null ? u.displayName : '').trim();
      const rowData = u && typeof u === 'object' ? u : {};
      const ph = contactFromUserData(rowData);
      const nd = normalizePhoneDigits(ph);
      const matchName = nm && nm.toLowerCase().indexOf(tLower) >= 0 && !looksLikePhone;
      const matchTail4 = digitsOnly.length === 4 && nd.length >= 4 && nd.slice(-4) === digitsOnly;
      const matchFull = digitsOnly.length >= 8 && nd && nd === digitsOnly;
      if (matchName || matchTail4 || matchFull) pushRow(uid, nm || '회원', ph);
    }
  }
}

/** 검색 행 — 버튼·상태 표시용 */
export function getFriendSearchRowStatus(uid, friends, outgoing, incoming) {
  const fu = String(uid || '').trim();
  if (!fu) return '—';
  if (
    (friends || []).some(function (f) {
      return String(f.friendUid || f.id || '') === fu;
    })
  ) {
    return '이미 친구';
  }
  var oi;
  var o;
  for (oi = 0; oi < (outgoing || []).length; oi++) {
    o = outgoing[oi];
    if (String(o.toUid || '') === fu && String(o.status || '') !== 'accepted') {
      var ost = String(o.status || '');
      if (ost === 'pending') return '요청 보냄(대기)';
      if (ost === 'rejected') return '거절됨';
      if (ost === 'cancelled') return '요청 취소됨';
      return ost;
    }
  }
  var inc;
  for (oi = 0; oi < (incoming || []).length; oi++) {
    inc = incoming[oi];
    if (String(inc.fromUid || '') === fu && String(inc.status || '') === 'pending') {
      return '상대가 나에게 요청';
    }
  }
  return '친구 요청 가능';
}

/**
 * Firestore users: name·displayName(일치·접두), contact·phone·phoneNumber·tel(전화·뒤4자리 대표 패턴)
 * 로컬(window.users) 검색을 먼저 수행해 UI에 즉시 후보가 보이게 함.
 * @returns {Promise<{ rows: Array<{ uid: string; name: string; contact: string }>; errors: string[]; hints: string[] }>}
 */
export async function searchUsersForFriendRequest(db, term, myUid) {
  const me = String(myUid || '').trim();
  const t = String(term || '').trim();
  const errors = [];
  const hints = [];

  if (!me || !t) {
    return { rows: [], errors: ['로그인·검색어를 확인해 주세요.'], hints };
  }

  const dbMissing = !db;
  const out = [];
  const seen = {};

  function pushRow(uid, name, contact) {
    const u = String(uid || '').trim();
    if (!u || u === me) return;
    if (seen[u]) return;
    seen[u] = true;
    out.push({ uid: u, name: name || '회원', contact: String(contact || '').trim() });
  }

  const getLen = function () {
    return out.length;
  };

  const digitsOnly = t.replace(/\D/g, '');

  searchUsersInMemoryLists(t, me, pushRow, getLen);

  if (db) {
    await firestoreQueryUsersByNameAndDisplay(db, t, me, pushRow, getLen, errors);

    if (digitsOnly.length >= 8) {
      const candidates = buildPhoneQueryCandidates(digitsOnly);
      await firestoreQueryUsersByContactFields(db, candidates, me, pushRow, getLen, errors);
    } else if (digitsOnly.length === 4) {
      const sample = buildSampleContactCandidatesForSuffix(digitsOnly);
      await firestoreQueryUsersByContactFields(db, sample, me, pushRow, getLen, errors);
    }
  }

  const after = getLen();
  const permRe = /insufficient permissions|permission-denied|missing or insufficient permissions/i;

  function stripPermissionNoise(arr) {
    return (arr || []).filter(function (m) {
      return !permRe.test(String(m || ''));
    });
  }

  errors.splice(0, errors.length, ...stripPermissionNoise(errors));
  hints.length = 0;
  if (after > 0) {
    /* 성공 시 진단 문구 숨김 */
  } else {
    if (dbMissing) {
      hints.push('Firestore 연결이 없어 메모리 목록만 검색했습니다.');
    }
    hints.push('일치하는 사용자가 없습니다. 검색어를 바꿔 보세요.');
  }

  return { rows: out.slice(0, 30), errors, hints };
}

/**
 * 수락된 요청을 양쪽 friends 문서에 반영(본인 쪽만 쓰기)
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} userId
 */
export async function syncFriendsFromAcceptedRequests(db, userId) {
  const uid = String(userId || '').trim();
  if (!db || !uid) return;

  const q1 = query(collection(db, 'friendRequests'), where('fromUid', '==', uid), where('status', '==', 'accepted'));
  const q2 = query(collection(db, 'friendRequests'), where('toUid', '==', uid), where('status', '==', 'accepted'));
  const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
  /** @type {Map<string, { displayName: string; contact: string }>} */
  const merged = new Map();

  function addEdge(otherUid, displayName, contact) {
    const ou = String(otherUid || '').trim();
    if (!ou) return;
    merged.set(ou, {
      displayName: String(displayName != null ? displayName : '').slice(0, 80),
      contact: String(contact != null ? contact : '').slice(0, 80)
    });
  }

  s1.forEach((ds) => {
    const d = ds.data();
    const other = String(d.toUid || '');
    if (!other) return;
    addEdge(other, d.toDisplayName, d.toContact);
  });
  s2.forEach((ds) => {
    const d = ds.data();
    const other = String(d.fromUid || '');
    if (!other) return;
    addEdge(other, d.fromDisplayName, d.fromContact);
  });

  if (merged.size === 0) return;
  const batch = writeBatch(db);
  merged.forEach((v, ou) => {
    const ref = doc(db, 'users', uid, 'friends', ou);
    batch.set(
      ref,
      {
        friendUid: ou,
        displayName: v.displayName,
        contact: v.contact,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });
  await batch.commit();
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} fromUid
 * @param {string} toUid
 * @param {{ fromDisplayName: string; fromContact: string }} profile
 * @param {{ targetName?: string; targetContact?: string }} [targetPreview] 검색 결과 요약(발신 목록 표시)
 */
export async function sendFriendRequest(db, fromUid, toUid, profile, targetPreview) {
  const a = String(fromUid || '').trim();
  const b = String(toUid || '').trim();
  if (!db || !a || !b || a === b) throw new Error('INVALID_FRIEND_REQUEST');
  const rid = friendRequestDocId(a, b);
  const ref = doc(db, 'friendRequests', rid);
  const snap = await getDoc(ref);
  const nm = String(profile && profile.fromDisplayName != null ? profile.fromDisplayName : '').slice(0, 80);
  const ct = String(profile && profile.fromContact != null ? profile.fromContact : '').slice(0, 80);
  if (!nm || !ct) throw new Error('PROFILE_INCOMPLETE');
  const tpNm = String((targetPreview && targetPreview.targetName) || '').slice(0, 80);
  const tpCt = String((targetPreview && targetPreview.targetContact) || '').slice(0, 80);

  if (!snap.exists()) {
    await setDoc(ref, {
      fromUid: a,
      toUid: b,
      status: 'pending',
      fromDisplayName: nm,
      fromContact: ct,
      targetPreviewName: tpNm,
      targetPreviewContact: tpCt,
      toDisplayName: '',
      toContact: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return;
  }

  const cur = snap.data();
  const st = String(cur.status || '');
  if (st === 'pending') throw new Error('REQUEST_ALREADY_PENDING');
  if (st === 'accepted') throw new Error('ALREADY_FRIENDS');
  if (st === 'rejected' || st === 'cancelled') {
    await updateDoc(ref, {
      status: 'pending',
      fromDisplayName: nm,
      fromContact: ct,
      targetPreviewName: tpNm,
      targetPreviewContact: tpCt,
      toDisplayName: '',
      toContact: '',
      updatedAt: serverTimestamp()
    });
    return;
  }
  throw new Error('REQUEST_STATE_UNKNOWN');
}

export async function cancelFriendRequest(db, fromUid, toUid) {
  const ref = doc(db, 'friendRequests', friendRequestDocId(fromUid, toUid));
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const d = snap.data();
  if (String(d.fromUid) !== String(fromUid)) throw new Error('FORBIDDEN');
  if (String(d.status) !== 'pending') throw new Error('NOT_PENDING');
  await updateDoc(ref, { status: 'cancelled', updatedAt: serverTimestamp() });
}

/** 발신자만: 취소·거절된 요청을 목록에서 제거(문서 삭제) */
export async function deleteFriendRequestForSender(db, fromUid, toUid) {
  const ref = doc(db, 'friendRequests', friendRequestDocId(fromUid, toUid));
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const d = snap.data();
  if (String(d.fromUid) !== String(fromUid)) throw new Error('FORBIDDEN');
  const st = String(d.status || '');
  if (st !== 'cancelled' && st !== 'rejected') throw new Error('CANNOT_DELETE');
  await deleteDoc(ref);
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} fromUid
 * @param {string} toUid
 * @param {{ toDisplayName: string; toContact: string }} accepterProfile
 */
export async function acceptFriendRequest(db, fromUid, toUid, accepterProfile) {
  const ref = doc(db, 'friendRequests', friendRequestDocId(fromUid, toUid));
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('NOT_FOUND');
  const d = snap.data();
  if (String(d.toUid) !== String(toUid)) throw new Error('FORBIDDEN');
  const st = String(d.status || '');
  if (st !== 'pending' && st !== 'rejected') throw new Error('CANNOT_ACCEPT');

  const tnm = String(accepterProfile && accepterProfile.toDisplayName != null ? accepterProfile.toDisplayName : '').slice(0, 80);
  const tct = String(accepterProfile && accepterProfile.toContact != null ? accepterProfile.toContact : '').slice(0, 80);

  const batch = writeBatch(db);
  batch.update(ref, {
    status: 'accepted',
    toDisplayName: tnm,
    toContact: tct,
    updatedAt: serverTimestamp()
  });
  const friendRef = doc(db, 'users', toUid, 'friends', String(fromUid));
  batch.set(
    friendRef,
    {
      friendUid: String(fromUid),
      displayName: String(d.fromDisplayName != null ? d.fromDisplayName : '').slice(0, 80),
      contact: String(d.fromContact != null ? d.fromContact : '').slice(0, 80),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  await batch.commit();
  // 상대(fromUid)의 users/.../friends 는 본인 인증으로만 쓸 수 있음. 수락자 클라이언트에서 동기화하면 권한 오류(Missing or insufficient permissions).
  // 발신자는 친구 관리·초대 목록 로드 시 fetchFriendManagementSnapshot / loadFriendsForInviteMerge 가 자신 uid로 syncFriendsFromAcceptedRequests 를 수행함.
}

export async function rejectFriendRequest(db, fromUid, toUid) {
  const ref = doc(db, 'friendRequests', friendRequestDocId(fromUid, toUid));
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('NOT_FOUND');
  const d = snap.data();
  if (String(d.toUid) !== String(toUid)) throw new Error('FORBIDDEN');
  if (String(d.status) !== 'pending') throw new Error('CANNOT_REJECT');
  await updateDoc(ref, { status: 'rejected', updatedAt: serverTimestamp() });
}

/** 수신자가 거절했던 요청을 다시 검토 대기로 — 상대 재요청 없이 내가 먼저 열어둘 때 */
export async function reopenFriendRequestToPending(db, fromUid, toUid) {
  const ref = doc(db, 'friendRequests', friendRequestDocId(fromUid, toUid));
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('NOT_FOUND');
  const d = snap.data();
  if (String(d.toUid) !== String(toUid)) throw new Error('FORBIDDEN');
  if (String(d.status) !== 'rejected') throw new Error('NOT_REJECTED');
  await updateDoc(ref, { status: 'pending', updatedAt: serverTimestamp() });
}

/**
 * 라이딩 초대 폼용 친구 벌크
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} userId
 * @returns {Promise<Array<{ key: string; name: string; phone: string; friendUid?: string }>>}
 */
/**
 * 친구 관리 화면 일괄 로드
 * @returns {Promise<{ friends: object[]; outgoing: object[]; incoming: object[] }>}
 */
export async function fetchFriendManagementSnapshot(db, userId) {
  const uid = String(userId || '').trim();
  if (!db || !uid) return { friends: [], outgoing: [], incoming: [] };
  await syncFriendsFromAcceptedRequests(db, uid);

  const friends = [];
  const fsnap = await getDocs(collection(db, 'users', uid, 'friends'));
  fsnap.forEach((d) => {
    friends.push(Object.assign({ id: d.id }, d.data()));
  });
  friends.sort(function (a, b) {
    return String(a.displayName || '').localeCompare(String(b.displayName || ''), 'ko');
  });

  const outgoing = [];
  const incoming = [];
  const [osnap, isnap] = await Promise.all([
    getDocs(query(collection(db, 'friendRequests'), where('fromUid', '==', uid))),
    getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', uid)))
  ]);
  osnap.forEach((d) => outgoing.push(Object.assign({ id: d.id }, d.data())));
  isnap.forEach((d) => incoming.push(Object.assign({ id: d.id }, d.data())));
  outgoing.sort(function (a, b) {
    var am = a.updatedAt && typeof a.updatedAt.toMillis === 'function' ? a.updatedAt.toMillis() : 0;
    var bm = b.updatedAt && typeof b.updatedAt.toMillis === 'function' ? b.updatedAt.toMillis() : 0;
    return bm - am;
  });
  incoming.sort(function (a, b) {
    var am = a.updatedAt && typeof a.updatedAt.toMillis === 'function' ? a.updatedAt.toMillis() : 0;
    var bm = b.updatedAt && typeof b.updatedAt.toMillis === 'function' ? b.updatedAt.toMillis() : 0;
    return bm - am;
  });

  return { friends, outgoing, incoming };
}

/** 라이딩 모임 헤더 배지: 나에게 온 pending 친구 요청 건수 */
export async function countPendingIncomingFriendRequests(db, userId) {
  const uid = String(userId || '').trim();
  if (!db || !uid) return 0;
  const q = query(collection(db, 'friendRequests'), where('toUid', '==', uid), where('status', '==', 'pending'));
  const snap = await getDocs(q);
  return snap.size;
}

export async function loadFriendsForInviteMerge(db, userId) {
  const uid = String(userId || '').trim();
  if (!db || !uid) return [];
  await syncFriendsFromAcceptedRequests(db, uid);
  const col = collection(db, 'users', uid, 'friends');
  const snap = await getDocs(col);
  const norm = normalizePhoneDigits;
  const rows = [];
  snap.forEach((d) => {
    const x = d.data();
    const phone = String(x.contact != null ? x.contact : '').trim();
    const key = norm(phone);
    if (key.length < 8) return;
    rows.push({
      key,
      name: String(x.displayName != null ? x.displayName : '').trim() || '친구',
      phone,
      friendUid: String(x.friendUid != null ? x.friendUid : d.id)
    });
  });
  return rows;
}

if (typeof window !== 'undefined') {
  window.openRidingFriendsService = {
    friendRequestDocId,
    maskContactPrivacy,
    searchUsersForFriendRequest,
    getFriendSearchRowStatus,
    sendFriendRequest,
    cancelFriendRequest,
    deleteFriendRequestForSender,
    acceptFriendRequest,
    rejectFriendRequest,
    reopenFriendRequestToPending,
    syncFriendsFromAcceptedRequests,
    fetchFriendManagementSnapshot,
    countPendingIncomingFriendRequests,
    loadFriendsForInviteMerge,
    normalizePhoneDigits
  };
}
