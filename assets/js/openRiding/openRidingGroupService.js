/**
 * 라이딩 모임 — 소모임(그룹) Firestore 서비스
 * 컬렉션: stelvio_riding_groups / members 서브컬렉션
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  increment,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js';

export const RIDING_GROUP_COLLECTION = 'stelvio_riding_groups';

export const GROUP_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

/** @param {unknown} v */
function trimLen(v, max) {
  var t = String(v != null ? v : '').trim();
  if (t.length > max) return t.slice(0, max);
  return t;
}

/** @param {unknown} v */
function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map(function (x) {
    return String(x || '').trim();
  }).filter(Boolean);
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {boolean} isAdmin
 * @param {function(any[]): void} onUpdate
 * @returns {function(): void}
 */
export function subscribeRidingGroups(db, isAdmin, onUpdate) {
  if (!db || typeof onUpdate !== 'function') return function () {};
  var unsubs = [];

  function merge() {}

  if (isAdmin) {
    var qPend = query(
      collection(db, RIDING_GROUP_COLLECTION),
      where('status', '==', GROUP_STATUS.PENDING),
      orderBy('createdAt', 'desc')
    );
    var qApp = query(
      collection(db, RIDING_GROUP_COLLECTION),
      where('status', '==', GROUP_STATUS.APPROVED),
      orderBy('createdAt', 'desc')
    );
    var pend = [];
    var app = [];
    function emit() {
      var merged = pend.concat(app);
      onUpdate(merged);
    }
    unsubs.push(
      onSnapshot(qPend, function (snap) {
        pend = [];
        snap.forEach(function (d) {
          pend.push({ id: d.id, ...d.data() });
        });
        emit();
      })
    );
    unsubs.push(
      onSnapshot(qApp, function (snap) {
        app = [];
        snap.forEach(function (d) {
          app.push({ id: d.id, ...d.data() });
        });
        emit();
      })
    );
    return function () {
      unsubs.forEach(function (u) {
        try {
          u();
        } catch (e) {}
      });
    };
  }

  var qUser = query(
    collection(db, RIDING_GROUP_COLLECTION),
    where('status', '==', GROUP_STATUS.APPROVED),
    orderBy('createdAt', 'desc')
  );
  unsubs.push(
    onSnapshot(qUser, function (snap) {
      var rows = [];
      snap.forEach(function (d) {
        rows.push({ id: d.id, ...d.data() });
      });
      onUpdate(rows);
    })
  );
  return function () {
    unsubs.forEach(function (u) {
      try {
        u();
      } catch (e) {}
    });
  };
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} groupId
 * @param {function(any|null): void} cb
 */
export function subscribeRidingGroupDetail(db, groupId, cb) {
  if (!db || !groupId || typeof cb !== 'function') return function () {};
  var id = String(groupId).trim();
  var ref = doc(db, RIDING_GROUP_COLLECTION, id);
  return onSnapshot(ref, function (snap) {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    cb({ id: snap.id, ...snap.data() });
  });
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} groupId
 * @param {function(any[]): void} cb
 */
export function subscribeRidingGroupMembers(db, groupId, cb) {
  if (!db || !groupId || typeof cb !== 'function') return function () {};
  var id = String(groupId).trim();
  var ref = collection(db, RIDING_GROUP_COLLECTION, id, 'members');
  var qy = query(ref, orderBy('joinedAt', 'asc'));
  return onSnapshot(qy, function (snap) {
    var rows = [];
    snap.forEach(function (d) {
      rows.push({ userId: d.id, ...d.data() });
    });
    cb(rows);
  });
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @param {{ name: string; regions: string[]; intro: string; isPublic: boolean; joinPassword?: string; photoUrl?: string|null }} payload
 */
export async function createRidingGroupPending(db, uid, payload) {
  if (!db || !uid) throw new Error('로그인이 필요합니다.');
  var u = String(uid).trim();
  var name = trimLen(payload.name, 24);
  if (!name) throw new Error('그룹명을 입력해 주세요.');
  var regions = asStringArray(payload.regions);
  var intro = trimLen(payload.intro, 500);
  var isPublic = !!payload.isPublic;
  var joinPassword = isPublic ? '' : trimLen(payload.joinPassword, 32);
  if (!isPublic && (!joinPassword || joinPassword.length < 4)) throw new Error('비공개 그룹은 비밀번호(4자 이상)를 설정해 주세요.');

  var col = collection(db, RIDING_GROUP_COLLECTION);
  var ref = doc(col);
  var batch = writeBatch(db);
  var now = serverTimestamp();
  batch.set(ref, {
    name,
    regions,
    intro,
    isPublic,
    joinPassword: isPublic ? '' : joinPassword,
    photoUrl: payload.photoUrl != null ? String(payload.photoUrl) : null,
    status: GROUP_STATUS.PENDING,
    createdBy: u,
    memberCount: 1,
    createdAt: now,
    updatedAt: now
  });
  var memRef = doc(db, RIDING_GROUP_COLLECTION, ref.id, 'members', u);
  batch.set(memRef, {
    joinedAt: now,
    displayName: '',
    profileImageUrl: null,
    role: 'owner'
  });
  await batch.commit();
  return ref.id;
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @param {string} groupId
 * @param {{ name: string; regions: string[]; intro: string; isPublic: boolean; joinPassword?: string; photoUrl?: string|null }} payload
 */
export async function updateRidingGroupByOwner(db, uid, groupId, payload) {
  if (!db || !uid || !groupId) throw new Error('요청이 올바르지 않습니다.');
  var ref = doc(db, RIDING_GROUP_COLLECTION, String(groupId).trim());
  var snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('그룹을 찾을 수 없습니다.');
  var d = snap.data() || {};
  if (String(d.createdBy || '') !== String(uid)) throw new Error('수정 권한이 없습니다.');
  if (String(d.status || '') !== GROUP_STATUS.PENDING && String(d.status || '') !== GROUP_STATUS.APPROVED) {
    throw new Error('이 그룹은 수정할 수 없습니다.');
  }
  var name = trimLen(payload.name, 24);
  if (!name) throw new Error('그룹명을 입력해 주세요.');
  var regions = asStringArray(payload.regions);
  var intro = trimLen(payload.intro, 500);
  var isPublic = !!payload.isPublic;
  var joinPassword = isPublic ? '' : trimLen(payload.joinPassword, 32);
  if (!isPublic) {
    var prev = String(d.joinPassword || '');
    if (!joinPassword && prev) joinPassword = prev;
    if (!joinPassword || joinPassword.length < 4) throw new Error('비공개 그룹은 비밀번호(4자 이상)가 필요합니다.');
  }
  await updateDoc(ref, {
    name,
    regions,
    intro,
    isPublic,
    joinPassword: isPublic ? '' : joinPassword,
    photoUrl: payload.photoUrl != null ? String(payload.photoUrl) : null,
    updatedAt: serverTimestamp()
  });
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} adminUid
 * @param {string} groupId
 * @param {'APPROVED'|'REJECTED'} nextStatus
 */
export async function setRidingGroupStatusByAdmin(db, adminUid, groupId, nextStatus) {
  if (!db || !adminUid || !groupId) throw new Error('요청이 올바르지 않습니다.');
  if (nextStatus !== GROUP_STATUS.APPROVED && nextStatus !== GROUP_STATUS.REJECTED) throw new Error('상태가 올바르지 않습니다.');
  var ref = doc(db, RIDING_GROUP_COLLECTION, String(groupId).trim());
  await updateDoc(ref, {
    status: nextStatus,
    reviewedAt: serverTimestamp(),
    reviewedBy: String(adminUid).trim(),
    updatedAt: serverTimestamp()
  });
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @param {string} groupId
 * @param {string} [passwordGuess]
 * @param {{ displayName?: string; profileImageUrl?: string|null }} [profileHints]
 */
export async function joinRidingGroup(db, uid, groupId, passwordGuess, profileHints) {
  if (!db || !uid || !groupId) throw new Error('로그인이 필요합니다.');
  var ref = doc(db, RIDING_GROUP_COLLECTION, String(groupId).trim());
  var snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('그룹을 찾을 수 없습니다.');
  var d = snap.data() || {};
  if (String(d.status || '') !== GROUP_STATUS.APPROVED) throw new Error('가입할 수 없는 그룹입니다.');
  if (!d.isPublic) {
    var need = String(d.joinPassword || '');
    if (!need || String(passwordGuess || '') !== need) throw new Error('비밀번호가 일치하지 않습니다.');
  }
  var memRef = doc(db, RIDING_GROUP_COLLECTION, String(groupId).trim(), 'members', String(uid).trim());
  var ex = await getDoc(memRef);
  if (ex.exists()) return;
  var batch = writeBatch(db);
  var ph = profileHints || {};
  batch.set(memRef, {
    joinedAt: serverTimestamp(),
    displayName: ph.displayName != null ? String(ph.displayName) : '',
    profileImageUrl: ph.profileImageUrl != null ? ph.profileImageUrl : null,
    role: 'member'
  });
  batch.update(ref, {
    memberCount: increment(1),
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @param {string} groupId
 */
export async function leaveRidingGroup(db, uid, groupId) {
  if (!db || !uid || !groupId) throw new Error('요청이 올바르지 않습니다.');
  var gid = String(groupId).trim();
  var ref = doc(db, RIDING_GROUP_COLLECTION, gid);
  var snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('그룹을 찾을 수 없습니다.');
  var d = snap.data() || {};
  if (String(d.createdBy || '') === String(uid)) throw new Error('방장은 탈퇴할 수 없습니다. 그룹 삭제는 별도 메뉴에서 진행해 주세요.');
  var memRef = doc(db, RIDING_GROUP_COLLECTION, gid, 'members', String(uid).trim());
  var ex = await getDoc(memRef);
  if (!ex.exists()) return;
  var batch = writeBatch(db);
  batch.delete(memRef);
  batch.update(ref, {
    memberCount: increment(-1),
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}

/**
 * @param {import('firebase/storage').FirebaseStorage} storage
 * @param {string} groupId
 * @param {File|Blob} file
 * @returns {Promise<string>}
 */
export async function uploadRidingGroupCover(storage, groupId, file) {
  if (!storage || !groupId || !file) throw new Error('요청이 올바르지 않습니다.');
  var gid = String(groupId).trim();
  var orig = typeof File !== 'undefined' && file instanceof File && file.name ? String(file.name) : '';
  var ext = 'jpg';
  if (orig && orig.indexOf('.') >= 0) {
    var e = orig.split('.').pop();
    if (e && /^[a-z0-9]{1,8}$/i.test(e)) ext = e.toLowerCase();
  }
  var name = 'cover_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9) + '.' + ext;
  var path = 'stelvio_riding_groups/' + gid + '/' + name;
  var r = storageRef(storage, path);
  var ct = typeof File !== 'undefined' && file instanceof File && file.type ? file.type : 'image/jpeg';
  await uploadBytes(r, file, { contentType: ct });
  return getDownloadURL(r);
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} groupId
 */
export async function fetchRidingGroupById(db, groupId) {
  if (!db || !groupId) return null;
  var snap = await getDoc(doc(db, RIDING_GROUP_COLLECTION, String(groupId).trim()));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

if (typeof window !== 'undefined') {
  window.openRidingGroupService = {
    RIDING_GROUP_COLLECTION,
    GROUP_STATUS,
    subscribeRidingGroups,
    subscribeRidingGroupDetail,
    subscribeRidingGroupMembers,
    createRidingGroupPending,
    updateRidingGroupByOwner,
    setRidingGroupStatusByAdmin,
    joinRidingGroup,
    leaveRidingGroup,
    fetchRidingGroupById,
    uploadRidingGroupCover
  };
}
