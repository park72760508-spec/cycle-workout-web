/**
 * 라이딩 모임 — 소모임(그룹) Firestore 서비스
 * 컬렉션: stelvio_riding_groups / members 서브컬렉션
 */
import {
  collection,
  collectionGroup,
  doc,
  documentId,
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
  writeBatch,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

export const RIDING_GROUP_COLLECTION = 'stelvio_riding_groups';

/** 승인된 그룹 가입 신청 큐 — 문서 ID = 신청자 UID */
export const RIDING_GROUP_JOIN_REQUESTS_SUB = 'joinRequests';

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
 * 내 UID가 멤버로 등록된 승인(APPROVED) 소모임만 실시간 수집(랭킹보드 「그룹」탭 등).
 * collectionGroup `members` 중 타 컬렉션과 혼선을 막기 위해 경로 접두만 사용합니다.
 *
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @param {function(Array<{ id: string; groupId: string; name: string; photoUrl: string; memberCount: number|null }>): void} onUpdate
 * @returns {function(): void}
 */
export function subscribeMyRidingGroupsAsMember(db, uid, onUpdate) {
  if (!db || !uid || typeof onUpdate !== 'function') return function () {};
  var u = String(uid).trim();
  if (!u) return function () {};

  var metaByGid = Object.create(null);
  var unsubByGid = Object.create(null);
  var membUnsub = null;

  function sortedList() {
    return Object.keys(metaByGid)
      .map(function (gid) {
        return metaByGid[gid];
      })
      .filter(Boolean)
      .sort(function (a, b) {
        var mcA = a.memberCount != null ? Number(a.memberCount) : 0;
        var mcB = b.memberCount != null ? Number(b.memberCount) : 0;
        if (mcB !== mcA) return mcB - mcA;
        var na = String(a.name || '').toLowerCase();
        var nb = String(b.name || '').toLowerCase();
        if (na < nb) return -1;
        if (na > nb) return 1;
        return 0;
      });
  }

  function emit() {
    onUpdate(sortedList());
  }

  function unsubGroupDoc(gid) {
    var fn = unsubByGid[gid];
    if (fn) {
      try {
        fn();
      } catch (e) {}
      delete unsubByGid[gid];
    }
    delete metaByGid[gid];
  }

  function subGroupDoc(gid) {
    if (unsubByGid[gid]) return;
    var gRef = doc(db, RIDING_GROUP_COLLECTION, gid);
    unsubByGid[gid] = onSnapshot(gRef, function (snap) {
      if (!snap.exists()) {
        unsubGroupDoc(gid);
        emit();
        return;
      }
      var gd = snap.data() || {};
      var st = String(gd.status || '');
      if (st !== GROUP_STATUS.APPROVED) {
        unsubGroupDoc(gid);
        emit();
        return;
      }
      metaByGid[gid] = {
        id: gid,
        groupId: gid,
        name: gd.name != null ? String(gd.name) : '(이름 없음)',
        photoUrl: gd.photoUrl != null ? String(gd.photoUrl).trim() : '',
        memberCount: gd.memberCount != null ? Number(gd.memberCount) : null
      };
      emit();
    });
  }

  /** @param {string} path */
  function parseStelvioGroupIdFromMemberPath(path) {
    var p = String(path || '');
    var prefix = RIDING_GROUP_COLLECTION + '/';
    if (p.indexOf(prefix) !== 0) return null;
    var rest = p.slice(prefix.length).split('/');
    if (rest.length !== 3 || rest[2] !== u) return null;
    if (rest[1] !== 'members') return null;
    return rest[0] || null;
  }

  var qMem = query(collectionGroup(db, 'members'), where(documentId(), '==', u));
  membUnsub = onSnapshot(qMem, function (snap) {
    var want = Object.create(null);
    snap.forEach(function (d) {
      var gid = parseStelvioGroupIdFromMemberPath(d.ref.path);
      if (gid) want[gid] = true;
    });
    Object.keys(unsubByGid).forEach(function (gid) {
      if (!want[gid]) unsubGroupDoc(gid);
    });
    Object.keys(want).forEach(function (gid) {
      subGroupDoc(gid);
    });
    if (snap.empty) {
      emit();
    }
  });

  return function () {
    if (membUnsub) {
      try {
        membUnsub();
      } catch (e2) {}
      membUnsub = null;
    }
    Object.keys(unsubByGid).slice().forEach(unsubGroupDoc);
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
 * @param {string} groupId
 * @param {function(any[]): void} cb
 */
export function subscribeRidingGroupJoinRequests(db, groupId, cb) {
  if (!db || !groupId || typeof cb !== 'function') return function () {};
  var id = String(groupId).trim();
  var ref = collection(db, RIDING_GROUP_COLLECTION, id, RIDING_GROUP_JOIN_REQUESTS_SUB);
  var qy = query(ref, orderBy('requestedAt', 'asc'));
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
 * @param {string} groupId
 * @param {string} uid
 * @param {function(any|null): void} cb
 */
export function subscribeRidingGroupMyJoinRequest(db, groupId, uid, cb) {
  if (!db || !groupId || !uid || typeof cb !== 'function') return function () {};
  var id = String(groupId).trim();
  var u = String(uid).trim();
  var ref = doc(db, RIDING_GROUP_COLLECTION, id, RIDING_GROUP_JOIN_REQUESTS_SUB, u);
  return onSnapshot(ref, function (snap) {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    cb({ userId: snap.id, ...snap.data() });
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
 * 승인된 그룹 가입 신청(방장·관리자 수락 후 멤버 등록)
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @param {string} groupId
 * @param {string} [passwordGuess]
 * @param {{ displayName?: string; profileImageUrl?: string|null }} [profileHints]
 */
export async function joinRidingGroup(db, uid, groupId, passwordGuess, profileHints) {
  if (!db || !uid || !groupId) throw new Error('로그인이 필요합니다.');
  var gid = String(groupId).trim();
  var u = String(uid).trim();
  var ref = doc(db, RIDING_GROUP_COLLECTION, gid);
  var snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('그룹을 찾을 수 없습니다.');
  var d = snap.data() || {};
  if (String(d.status || '') !== GROUP_STATUS.APPROVED) throw new Error('가입할 수 없는 그룹입니다.');
  if (!d.isPublic) {
    var need = String(d.joinPassword || '');
    if (!need || String(passwordGuess || '') !== need) throw new Error('비밀번호가 일치하지 않습니다.');
  }
  var memRef = doc(db, RIDING_GROUP_COLLECTION, gid, 'members', u);
  var ex = await getDoc(memRef);
  if (ex.exists()) throw new Error('이미 이 그룹 멤버입니다.');
  var jRef = doc(db, RIDING_GROUP_COLLECTION, gid, RIDING_GROUP_JOIN_REQUESTS_SUB, u);
  var jEx = await getDoc(jRef);
  if (jEx.exists()) throw new Error('이미 가입 신청이 접수되었습니다.');
  var ph = profileHints || {};
  await setDoc(jRef, {
    requestedAt: serverTimestamp(),
    displayName: ph.displayName != null ? String(ph.displayName) : '',
    profileImageUrl: ph.profileImageUrl != null ? ph.profileImageUrl : null
  });
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} moderatorUid — 방장 또는 grade=1 (규칙과 일치해야 함)
 * @param {string} groupId
 * @param {string} applicantUid
 */
export async function approveRidingGroupJoinRequest(db, moderatorUid, groupId, applicantUid) {
  if (!db || !moderatorUid || !groupId || !applicantUid) throw new Error('요청이 올바르지 않습니다.');
  var gid = String(groupId).trim();
  var app = String(applicantUid).trim();
  var gRef = doc(db, RIDING_GROUP_COLLECTION, gid);
  var jRef = doc(db, RIDING_GROUP_COLLECTION, gid, RIDING_GROUP_JOIN_REQUESTS_SUB, app);
  var mRef = doc(db, RIDING_GROUP_COLLECTION, gid, 'members', app);
  await runTransaction(db, function (transaction) {
    return transaction.get(gRef).then(function (gSnap) {
      if (!gSnap.exists()) throw new Error('그룹을 찾을 수 없습니다.');
      var gd = gSnap.data() || {};
      if (String(gd.status || '') !== GROUP_STATUS.APPROVED) throw new Error('이 그룹은 가입을 수락할 수 없습니다.');
      return transaction.get(jRef).then(function (jSnap) {
        if (!jSnap.exists()) throw new Error('가입 신청을 찾을 수 없습니다.');
        return transaction.get(mRef).then(function (mSnap) {
          if (mSnap.exists()) throw new Error('이미 멤버입니다.');
          var jd = jSnap.data() || {};
          transaction.delete(jRef);
          transaction.set(mRef, {
            joinedAt: serverTimestamp(),
            displayName: jd.displayName != null ? String(jd.displayName) : '',
            profileImageUrl: jd.profileImageUrl != null ? jd.profileImageUrl : null,
            role: 'member'
          });
          transaction.update(gRef, {
            memberCount: increment(1),
            updatedAt: serverTimestamp()
          });
        });
      });
    });
  });
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} moderatorUid
 * @param {string} groupId
 * @param {string} applicantUid
 */
export async function rejectRidingGroupJoinRequest(db, moderatorUid, groupId, applicantUid) {
  if (!db || !moderatorUid || !groupId || !applicantUid) throw new Error('요청이 올바르지 않습니다.');
  var jRef = doc(
    db,
    RIDING_GROUP_COLLECTION,
    String(groupId).trim(),
    RIDING_GROUP_JOIN_REQUESTS_SUB,
    String(applicantUid).trim()
  );
  await deleteDoc(jRef);
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
 * 방장 이관: 현재 방장(createdBy)만 호출. 새 방장은 이미 그룹 멤버여야 함.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} ownerUid
 * @param {string} groupId
 * @param {string} newOwnerUid
 */
export async function transferRidingGroupOwnership(db, ownerUid, groupId, newOwnerUid) {
  if (!db || !ownerUid || !groupId || !newOwnerUid) throw new Error('요청이 올바르지 않습니다.');
  var gid = String(groupId).trim();
  var oldO = String(ownerUid).trim();
  var newO = String(newOwnerUid).trim();
  if (oldO === newO) throw new Error('같은 회원입니다.');
  var gRef = doc(db, RIDING_GROUP_COLLECTION, gid);
  var oldMemRef = doc(db, RIDING_GROUP_COLLECTION, gid, 'members', oldO);
  var newMemRef = doc(db, RIDING_GROUP_COLLECTION, gid, 'members', newO);
  await runTransaction(db, function (transaction) {
    return transaction.get(gRef).then(function (gSnap) {
      if (!gSnap.exists()) throw new Error('그룹을 찾을 수 없습니다.');
      var gd = gSnap.data() || {};
      if (String(gd.createdBy || '') !== oldO) throw new Error('방장만 이관할 수 있습니다.');
      var st = String(gd.status || '');
      if (st !== GROUP_STATUS.PENDING && st !== GROUP_STATUS.APPROVED) throw new Error('이 그룹은 이관할 수 없습니다.');
      return Promise.all([transaction.get(newMemRef), transaction.get(oldMemRef)]).then(function (snaps) {
        var newMSnap = snaps[0];
        var oldMSnap = snaps[1];
        if (!newMSnap.exists()) {
          throw new Error('선택한 회원이 이 그룹 멤버가 아닙니다. 먼저 그룹에 가입시킨 뒤 이관해 주세요.');
        }
        if (!oldMSnap.exists()) throw new Error('멤버 정보가 올바르지 않습니다.');
        transaction.update(gRef, {
          createdBy: newO,
          updatedAt: serverTimestamp()
        });
        transaction.update(oldMemRef, { role: 'member' });
        transaction.update(newMemRef, { role: 'owner' });
      });
    });
  });
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
    RIDING_GROUP_JOIN_REQUESTS_SUB,
    GROUP_STATUS,
    subscribeMyRidingGroupsAsMember,
    subscribeRidingGroups,
    subscribeRidingGroupDetail,
    subscribeRidingGroupMembers,
    subscribeRidingGroupJoinRequests,
    subscribeRidingGroupMyJoinRequest,
    createRidingGroupPending,
    updateRidingGroupByOwner,
    setRidingGroupStatusByAdmin,
    joinRidingGroup,
    approveRidingGroupJoinRequest,
    rejectRidingGroupJoinRequest,
    leaveRidingGroup,
    transferRidingGroupOwnership,
    fetchRidingGroupById,
    uploadRidingGroupCover
  };
}
