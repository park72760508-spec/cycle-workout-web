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
 * 이름(부분 일치)·전화 뒤 4자리·전화 전체 정규화로 후보 조회
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} term
 * @param {string} myUid
 * @returns {Promise<Array<{ uid: string; name: string; contact: string }>>}
 */
export async function searchUsersForFriendRequest(db, term, myUid) {
  const me = String(myUid || '').trim();
  const t = String(term || '').trim();
  if (!db || !me || !t) return [];
  const out = [];
  const seen = {};

  function pushRow(uid, name, contact) {
    const u = String(uid || '').trim();
    if (!u || u === me) return;
    if (seen[u]) return;
    seen[u] = true;
    out.push({ uid: u, name: name || '회원', contact: String(contact || '').trim() });
  }

  const lists = [];
  if (typeof window !== 'undefined') {
    if (Array.isArray(window.users)) lists.push(window.users);
    if (Array.isArray(window.userProfiles)) lists.push(window.userProfiles);
  }
  const tLower = t.toLowerCase();
  for (let li = 0; li < lists.length; li++) {
    const arr = lists[li];
    for (let i = 0; i < arr.length; i++) {
      const u = arr[i];
      if (!u) continue;
      const uid = String(u.id != null ? u.id : u.uid != null ? u.uid : '');
      if (!uid || uid === me) continue;
      const nm = String(u.name != null ? u.name : u.displayName != null ? u.displayName : '').trim();
      const ph = contactFromUserData(u);
      const nd = normalizePhoneDigits(ph);
      const matchName = nm && nm.toLowerCase().indexOf(tLower) >= 0;
      const matchTail4 = /^\d{4}$/.test(t) && nd.length >= 4 && nd.slice(-4) === t;
      const matchFull = t.replace(/\D/g, '').length >= 8 && nd && nd === normalizePhoneDigits(t);
      if (matchName || matchTail4 || matchFull) pushRow(uid, nm || '회원', ph);
    }
  }

  const digitsOnly = t.replace(/\D/g, '');
  if (digitsOnly.length >= 8) {
    const candidates = buildPhoneQueryCandidates(digitsOnly);
    const fields = ['contact', 'phone', 'phoneNumber', 'tel'];
    const col = collection(db, 'users');
    for (const field of fields) {
      for (const c of candidates) {
        if (out.length >= 12) break;
        try {
          const q = query(col, where(field, '==', c), limit(5));
          const snap = await getDocs(q);
          snap.forEach((d) => {
            if (!d.id || d.id === me) return;
            const data = d.data();
            pushRow(d.id, nameFromUserData(data), contactFromUserData(data));
          });
        } catch {
          /* 규칙·인덱스 */
        }
      }
    }
  }

  return out.slice(0, 20);
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
  await syncFriendsFromAcceptedRequests(db, String(fromUid));
}

export async function rejectFriendRequest(db, fromUid, toUid) {
  const ref = doc(db, 'friendRequests', friendRequestDocId(fromUid, toUid));
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('NOT_FOUND');
  const d = snap.data();
  if (String(d.toUid) !== String(toUid)) throw new Error('FORBIDDEN');
  if (String(d.status) !== 'pending' && String(d.status) !== 'rejected') throw new Error('CANNOT_REJECT');
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
    searchUsersForFriendRequest,
    sendFriendRequest,
    cancelFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    reopenFriendRequestToPending,
    syncFriendsFromAcceptedRequests,
    fetchFriendManagementSnapshot,
    loadFriendsForInviteMerge,
    normalizePhoneDigits
  };
}
