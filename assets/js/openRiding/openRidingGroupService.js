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
  writeBatch,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import {
  subscribeRidingGroupsRouted,
  subscribeRidingGroupDetailRouted,
  subscribeRidingGroupMembersRouted,
  subscribeRidingGroupJoinRequestsRouted,
  fetchRidingGroupByIdRouted,
  fetchRidingGroupMembersListRouted,
  fetchRidingGroupJoinRequestsListRouted,
} from './openRidingReadClient.js';
import { scheduleRidingGroupDualWriteFromFirestore } from '../openRidingDualWrite.js';

export const RIDING_GROUP_COLLECTION = 'stelvio_riding_groups';

/** 랭킹보드 그룹 탭 — 방장 메모식 공지(글자 수) */
export const RIDING_GROUP_RANKING_NOTICE_MAX_LEN = 500;

/** 승인된 그룹 가입 신청 큐 — 문서 ID = 신청자 UID */
export const RIDING_GROUP_JOIN_REQUESTS_SUB = 'joinRequests';

export const GROUP_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

/** 클럽 카테고리 — NULL·미지정은 CYCLE */
export const RIDING_GROUP_CATEGORY = {
  CYCLE: 'CYCLE',
  RUN: 'RUN'
};

/** @param {unknown} raw */
export function normalizeRidingGroupCategory(raw) {
  var c = raw != null ? String(raw).trim().toUpperCase() : '';
  return c === RIDING_GROUP_CATEGORY.RUN ? RIDING_GROUP_CATEGORY.RUN : RIDING_GROUP_CATEGORY.CYCLE;
}

/** @param {Record<string, unknown>|null|undefined} d */
function extractRidingGroupCategoryRawFromDoc(d) {
  if (!d || typeof d !== 'object') return null;
  if (d.category != null && String(d.category).trim() !== '') return d.category;
  if (d.sportCategory != null && String(d.sportCategory).trim() !== '') return d.sportCategory;
  if (d.sport_category != null && String(d.sport_category).trim() !== '') return d.sport_category;
  if (d.moimCategory != null && String(d.moimCategory).trim() !== '') return d.moimCategory;
  return null;
}

/** @param {{ category?: unknown }|null|undefined} group @param {unknown} category */
export function ridingGroupMatchesCategory(group, category) {
  return normalizeRidingGroupCategory(group && group.category) === normalizeRidingGroupCategory(category);
}

/** @param {unknown[]} rows @param {unknown} category @param {boolean} [isAdmin] */
export function filterRidingGroupsByCategory(rows, category, isAdmin) {
  var rgCat =
    typeof window !== 'undefined' &&
    window.ridingGroupCategory &&
    typeof window.ridingGroupCategory.filterRidingGroupsByBoardCategory === 'function';
  if (rgCat) {
    return window.ridingGroupCategory.filterRidingGroupsByBoardCategory(rows, category);
  }
  var want = normalizeRidingGroupCategory(category);
  return (rows || []).filter(function (g) {
    return ridingGroupMatchesCategory(g, want);
  });
}

/** 활성 스포츠 화면 → 클럽 카테고리 */
export function resolveRidingGroupCategoryFromActiveSport() {
  if (
    typeof window !== 'undefined' &&
    window.sportCategoryRoutes &&
    typeof window.sportCategoryRoutes.getActiveSport === 'function' &&
    window.sportCategoryRoutes.getActiveSport() === 'run'
  ) {
    return RIDING_GROUP_CATEGORY.RUN;
  }
  return RIDING_GROUP_CATEGORY.CYCLE;
}

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

/** @param {{ id?: string; createdAt?: import('firebase/firestore').Timestamp | { seconds?: number } }} row */
function ridingGroupCreatedAtMs(row) {
  if (!row) return 0;
  var c = row.createdAt;
  if (c && typeof c.toMillis === 'function') return c.toMillis();
  if (c && typeof c.seconds === 'number') return c.seconds * 1000;
  return 0;
}

/** 승인된 전체 목록 + 내가 방장인 승인 대기 그룹 (동일 id는 한 번만) */
function mergeApprovedAndMyPendingRidingGroups(approvedRows, pendingMineRows) {
  var map = Object.create(null);
  function add(row) {
    if (!row || !row.id) return;
    map[String(row.id)] = row;
  }
  (approvedRows || []).forEach(add);
  (pendingMineRows || []).forEach(add);
  return Object.keys(map)
    .map(function (id) {
      return map[id];
    })
    .sort(function (a, b) {
      return ridingGroupCreatedAtMs(b) - ridingGroupCreatedAtMs(a);
    });
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {boolean} isAdmin
 * @param {function(any[]): void} onUpdate
 * @param {string} [viewerUid] 로그인 UID — 일반 사용자일 때 본인이 등록한 승인 전 그룹을 목록에 합침
 * @returns {function(): void}
 */
export function subscribeRidingGroups(db, isAdmin, onUpdate, viewerUid) {
  return subscribeRidingGroupsRouted(db, isAdmin, onUpdate, viewerUid);
}

/**
 * 내 UID가 멤버로 등록된 승인(APPROVED) 소mo임만 실시간 수집
 * collectionGroup + documentId(UID) 쿼리는 Firestore에서 경로 전체가 아니라면 지원되지 않음.
 * 대신 승인된 그룹 목록 스냅샷마다 각 그룹의 `members/{uid}` 문서를 개별 구독합니다.
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
  var unsubGroupByGid = Object.create(null);
  var unsubMemberByGid = Object.create(null);
  var approvedListUnsub = null;

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
    var gfn = unsubGroupByGid[gid];
    if (gfn) {
      try {
        gfn();
      } catch (e) {}
      delete unsubGroupByGid[gid];
    }
    delete metaByGid[gid];
  }

  function unsubMemberSnap(gid) {
    var mfn = unsubMemberByGid[gid];
    if (mfn) {
      try {
        mfn();
      } catch (e2) {}
      delete unsubMemberByGid[gid];
    }
  }

  function subGroupDoc(gid) {
    if (unsubGroupByGid[gid]) return;
    var gRef = doc(db, RIDING_GROUP_COLLECTION, gid);
    unsubGroupByGid[gid] = onSnapshot(gRef, function (snap) {
      if (!snap.exists()) {
        unsubGroupDoc(gid);
        unsubMemberSnap(gid);
        emit();
        return;
      }
      var gd = snap.data() || {};
      var st = String(gd.status || '');
      if (st !== GROUP_STATUS.APPROVED) {
        unsubGroupDoc(gid);
        delete metaByGid[gid];
        emit();
        return;
      }
      var rnRaw = gd.rankingNotice;
      var rankingNotice = null;
      if (rnRaw && typeof rnRaw === 'object') {
        rankingNotice = {
          text: trimLen(rnRaw.text, RIDING_GROUP_RANKING_NOTICE_MAX_LEN),
          updatedAt: rnRaw.updatedAt != null ? rnRaw.updatedAt : null,
          updatedBy: rnRaw.updatedBy != null ? String(rnRaw.updatedBy) : ''
        };
      }
      var catRaw = extractRidingGroupCategoryRawFromDoc(gd);
      var catNorm = normalizeRidingGroupCategory(catRaw);
      metaByGid[gid] = {
        id: gid,
        groupId: gid,
        name: gd.name != null ? String(gd.name) : '(이름 없음)',
        photoUrl: gd.photoUrl != null ? String(gd.photoUrl).trim() : '',
        memberCount: gd.memberCount != null ? Number(gd.memberCount) : null,
        createdBy: gd.createdBy != null ? String(gd.createdBy) : '',
        category: catNorm,
        resolvedCategory: catNorm,
        categoryExplicit: catRaw != null,
        regions: gd.regions != null ? gd.regions : null,
        isPublic: gd.isPublic !== false,
        rankingNotice: rankingNotice
      };
      emit();
    });
  }

  function attachMembershipListener(gid) {
    if (unsubMemberByGid[gid]) return;
    var mRef = doc(db, RIDING_GROUP_COLLECTION, gid, 'members', u);
    unsubMemberByGid[gid] = onSnapshot(mRef, function (memSnap) {
      if (memSnap.exists()) {
        subGroupDoc(gid);
      } else {
        unsubGroupDoc(gid);
        emit();
      }
    });
  }

  function detachMembershipListener(gid) {
    unsubMemberSnap(gid);
    unsubGroupDoc(gid);
  }

  var qApproved = query(
    collection(db, RIDING_GROUP_COLLECTION),
    where('status', '==', GROUP_STATUS.APPROVED),
    orderBy('createdAt', 'desc')
  );

  approvedListUnsub = onSnapshot(qApproved, function (groupSnap) {
    var approvedIds = Object.create(null);
    groupSnap.forEach(function (d) {
      if (d && d.id) approvedIds[String(d.id)] = true;
    });
    Object.keys(unsubMemberByGid).forEach(function (oldGid) {
      if (!approvedIds[oldGid]) detachMembershipListener(oldGid);
    });
    Object.keys(approvedIds).forEach(function (gidOne) {
      attachMembershipListener(gidOne);
    });
    emit();
  });

  return function () {
    if (approvedListUnsub) {
      try {
        approvedListUnsub();
      } catch (e3) {}
      approvedListUnsub = null;
    }
    Object.keys(unsubMemberByGid).slice().forEach(function (gid) {
      unsubMemberSnap(gid);
    });
    Object.keys(unsubGroupByGid).slice().forEach(function (gid) {
      unsubGroupDoc(gid);
    });
    metaByGid = Object.create(null);
  };
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} groupId
 * @param {function(any|null): void} cb
 */
export function subscribeRidingGroupDetail(db, groupId, cb) {
  return subscribeRidingGroupDetailRouted(db, groupId, cb);
}

export async function fetchRidingGroupMembersList(db, groupId) {
  return fetchRidingGroupMembersListRouted(db, groupId);
}

export async function fetchRidingGroupJoinRequestsList(db, groupId) {
  return fetchRidingGroupJoinRequestsListRouted(db, groupId);
}

export function subscribeRidingGroupMembers(db, groupId, cb) {
  return subscribeRidingGroupMembersRouted(db, groupId, cb);
}

export function subscribeRidingGroupJoinRequests(db, groupId, cb) {
  return subscribeRidingGroupJoinRequestsRouted(db, groupId, cb);
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
 * @param {{ name: string; regions: string[]; intro: string; isPublic: boolean; joinPassword?: string; photoUrl?: string|null; category?: string }} payload
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
    category: normalizeRidingGroupCategory(payload.category),
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
  scheduleRidingGroupDualWriteFromFirestore(db, ref.id, u, { syncMembers: true });
  return ref.id;
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @param {string} groupId
 * @param {{ name: string; regions: string[]; intro: string; isPublic: boolean; joinPassword?: string; photoUrl?: string|null; category?: string }} payload
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
    category: normalizeRidingGroupCategory(payload.category),
    updatedAt: serverTimestamp()
  });
  scheduleRidingGroupDualWriteFromFirestore(db, groupId, uid, { syncMembers: true });
}

/**
 * 랭킹보드 그룹 탭 — 방장 공지(500자 이내 메모)
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @param {string} groupId
 * @param {string} text
 */
export async function updateRidingGroupRankingNotice(db, uid, groupId, text) {
  if (!db || !uid || !groupId) throw new Error('요청이 올바르지 않습니다.');
  var ref = doc(db, RIDING_GROUP_COLLECTION, String(groupId).trim());
  var snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('그룹을 찾을 수 없습니다.');
  var d = snap.data() || {};
  if (String(d.createdBy || '') !== String(uid)) throw new Error('방장만 공지를 등록할 수 있습니다.');
  if (String(d.status || '') !== GROUP_STATUS.APPROVED) {
    throw new Error('승인된 소모임만 공지를 등록할 수 있습니다.');
  }
  var body = trimLen(text, RIDING_GROUP_RANKING_NOTICE_MAX_LEN);
  await updateDoc(ref, {
    rankingNotice: {
      text: body,
      updatedAt: serverTimestamp(),
      updatedBy: String(uid).trim()
    },
    updatedAt: serverTimestamp()
  });
  scheduleRidingGroupDualWriteFromFirestore(db, groupId, uid, { syncMembers: false });
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
  scheduleRidingGroupDualWriteFromFirestore(db, groupId, adminUid, { syncMembers: true });
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
  scheduleRidingGroupDualWriteFromFirestore(db, gid, u, { syncJoinRequests: true });
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
  scheduleRidingGroupDualWriteFromFirestore(db, gid, moderatorUid, {
    syncMembers: true,
    syncJoinRequests: true,
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
  scheduleRidingGroupDualWriteFromFirestore(db, groupId, moderatorUid, { syncJoinRequests: true });
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
  scheduleRidingGroupDualWriteFromFirestore(db, gid, uid, { syncMembers: true });
}

/**
 * 방장 전용·승인 대기(PENDING) 그룹만 삭제.
 * 다른 멤버(members 문서)가 방장 외에 없어야 하며, joinRequests 가 있으면 불가(규칙상 PENDING 에는 없음).
 * 본인 members 문서 삭제 후 그룹 문서 삭제(클라이언트 규칙 호환).
 */
export async function deleteRidingGroupByOwner(db, uid, groupId) {
  if (!db || !uid || !groupId) throw new Error('요청이 올바르지 않습니다.');
  var u = String(uid).trim();
  var gid = String(groupId).trim();
  var gRef = doc(db, RIDING_GROUP_COLLECTION, gid);
  var gSnap = await getDoc(gRef);
  if (!gSnap.exists()) throw new Error('그룹을 찾을 수 없습니다.');
  var gd = gSnap.data() || {};
  if (String(gd.createdBy || '') !== u) throw new Error('삭제 권한이 없습니다.');
  if (String(gd.status || '') !== GROUP_STATUS.PENDING) {
    throw new Error('관리자 승인 대기 중인 그룹만 삭제할 수 있습니다.');
  }

  var memCol = collection(db, RIDING_GROUP_COLLECTION, gid, 'members');
  var memSnap = await getDocs(memCol);
  var extra = [];
  memSnap.forEach(function (ds) {
    if (String(ds.id) !== u) extra.push(ds.id);
  });
  if (extra.length > 0) {
    throw new Error('다른 멤버가 있으면 그룹을 삭제할 수 없습니다.');
  }

  var jrCol = collection(db, RIDING_GROUP_COLLECTION, gid, RIDING_GROUP_JOIN_REQUESTS_SUB);
  var jrSnap = await getDocs(jrCol);
  if (!jrSnap.empty) {
    throw new Error('가입 신청 대기자가 있으면 삭제할 수 없습니다.');
  }

  var batch = writeBatch(db);
  memSnap.forEach(function (ds) {
    batch.delete(ds.ref);
  });
  batch.delete(gRef);
  await batch.commit();
}

/**
 * 관리자(grade=1) — 그룹 정보 수정 (방장 여부·상태 무관, Firestore 규칙 stelvioGroupIsAdmin)
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} adminUid
 * @param {string} groupId
 * @param {{ name: string; regions: string[]; intro: string; isPublic: boolean; joinPassword?: string; photoUrl?: string|null; category?: string }} payload
 */
export async function updateRidingGroupByAdmin(db, adminUid, groupId, payload) {
  if (!db || !adminUid || !groupId) throw new Error('요청이 올바르지 않습니다.');
  var ref = doc(db, RIDING_GROUP_COLLECTION, String(groupId).trim());
  var snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('그룹을 찾을 수 없습니다.');
  var d = snap.data() || {};
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
    category: normalizeRidingGroupCategory(payload.category),
    updatedAt: serverTimestamp()
  });
  scheduleRidingGroupDualWriteFromFirestore(db, groupId, adminUid, { syncMembers: true });
}

/**
 * 관리자(grade=1) — 멤버·가입신청 포함 그룹 전체 삭제
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} adminUid
 * @param {string} groupId
 */
export async function deleteRidingGroupByAdmin(db, adminUid, groupId) {
  if (!db || !adminUid || !groupId) throw new Error('요청이 올바르지 않습니다.');
  var gid = String(groupId).trim();
  var gRef = doc(db, RIDING_GROUP_COLLECTION, gid);
  var gSnap = await getDoc(gRef);
  if (!gSnap.exists()) throw new Error('그룹을 찾을 수 없습니다.');

  var memCol = collection(db, RIDING_GROUP_COLLECTION, gid, 'members');
  var jrCol = collection(db, RIDING_GROUP_COLLECTION, gid, RIDING_GROUP_JOIN_REQUESTS_SUB);
  var memSnap = await getDocs(memCol);
  var jrSnap = await getDocs(jrCol);

  var batch = writeBatch(db);
  memSnap.forEach(function (ds) {
    batch.delete(ds.ref);
  });
  jrSnap.forEach(function (ds) {
    batch.delete(ds.ref);
  });
  batch.delete(gRef);
  await batch.commit();
  scheduleRidingGroupDualWriteFromFirestore(db, gid, adminUid, { syncMembers: true });
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
  scheduleRidingGroupDualWriteFromFirestore(db, gid, ownerUid, { syncMembers: true });
}

/** docs/storage.rules stelvio_riding_groups 커버: 2MB 미만 image/* */
const RIDING_GROUP_COVER_MAX_BYTES = 1900 * 1024;
const RIDING_GROUP_COVER_MAX_PX = 1200;

function ridingGroupCoverBlobToFile(blob, baseName) {
  var safe = String(baseName || 'cover').replace(/\.[^.]+$/, '') + '.jpg';
  if (typeof File !== 'undefined') {
    return new File([blob], safe, { type: 'image/jpeg', lastModified: Date.now() });
  }
  return blob;
}

function ridingGroupCoverCanvasToJpegBlob(canvas, quality) {
  return new Promise(function (resolve) {
    if (!canvas || typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob(
      function (blob) {
        resolve(blob);
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * 업로드 전 리사이즈·JPEG 압축 (Storage 2MB·image/* 규칙 준수)
 * @param {File|Blob} file
 * @returns {Promise<File|Blob>}
 */
async function compressRidingGroupCoverInput(file) {
  if (!file) return file;
  if (typeof File !== 'undefined' && file instanceof File && file.type && !String(file.type).startsWith('image/')) {
    throw new Error('이미지 파일만 업로드할 수 있습니다.');
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    if (file.size != null && file.size >= RIDING_GROUP_COVER_MAX_BYTES) {
      throw new Error('그룹 사진은 2MB 미만이어야 합니다. 더 작은 이미지를 선택해 주세요.');
    }
    return file;
  }

  var dataUrl = await new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () {
      reject(new Error('이미지를 읽을 수 없습니다.'));
    };
    reader.onload = function (e) {
      resolve(e.target && e.target.result ? e.target.result : '');
    };
    reader.readAsDataURL(file);
  });

  var img = await new Promise(function (resolve, reject) {
    var image = new Image();
    image.onerror = function () {
      reject(new Error('이미지 형식을 처리할 수 없습니다.'));
    };
    image.onload = function () {
      resolve(image);
    };
    image.src = dataUrl;
  });

  var w = img.naturalWidth || img.width || 0;
  var h = img.naturalHeight || img.height || 0;
  if (!w || !h) throw new Error('이미지 크기를 확인할 수 없습니다.');
  if (w > RIDING_GROUP_COVER_MAX_PX || h > RIDING_GROUP_COVER_MAX_PX) {
    if (w >= h) {
      h = Math.round((h * RIDING_GROUP_COVER_MAX_PX) / w);
      w = RIDING_GROUP_COVER_MAX_PX;
    } else {
      w = Math.round((w * RIDING_GROUP_COVER_MAX_PX) / h);
      h = RIDING_GROUP_COVER_MAX_PX;
    }
  }

  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지 처리를 지원하지 않는 환경입니다.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  var quality = 0.88;
  var blob = null;
  for (var attempt = 0; attempt < 8; attempt++) {
    blob = await ridingGroupCoverCanvasToJpegBlob(canvas, quality);
    if (!blob) break;
    if (blob.size <= RIDING_GROUP_COVER_MAX_BYTES) {
      return ridingGroupCoverBlobToFile(blob, file.name || 'cover');
    }
    quality -= 0.1;
    if (quality < 0.35) break;
  }

  if (blob && blob.size <= RIDING_GROUP_COVER_MAX_BYTES) {
    return ridingGroupCoverBlobToFile(blob, file.name || 'cover');
  }
  throw new Error('그룹 사진 용량이 2MB를 초과합니다. 더 작은 이미지를 선택해 주세요.');
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
  var prepared = await compressRidingGroupCoverInput(file);
  var name = 'cover_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9) + '.jpg';
  var path = 'stelvio_riding_groups/' + gid + '/' + name;
  var r = storageRef(storage, path);
  await uploadBytes(r, prepared, { contentType: 'image/jpeg' });
  return getDownloadURL(r);
}

/**
 * 내가 방장인 APPROVED 그룹들의 가입 요청(joinRequests) 건수를 실시간 구독.
 * onUpdate(totalCount, countMap) 형태로 호출됨.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} userId
 * @param {function(number, Object<string,number>): void} onUpdate
 * @returns {function(): void}
 */
export function subscribeMyManagedGroupsJoinRequestCounts(db, userId, onUpdate) {
  if (!db || !userId || typeof onUpdate !== 'function') return function () {};
  var uid = String(userId).trim();
  var countMap = {};
  var unsubByGroup = {};
  var unsubGroupsList = null;

  function emitTotal() {
    var total = Object.keys(countMap).reduce(function (s, k) { return s + (countMap[k] || 0); }, 0);
    onUpdate(total, Object.assign({}, countMap));
  }

  var q = query(
    collection(db, RIDING_GROUP_COLLECTION),
    where('status', '==', GROUP_STATUS.APPROVED),
    where('createdBy', '==', uid)
  );

  unsubGroupsList = onSnapshot(q, function (snap) {
    var currentIds = {};
    snap.forEach(function (d) { currentIds[d.id] = true; });

    Object.keys(unsubByGroup).forEach(function (gid) {
      if (!currentIds[gid]) {
        try { unsubByGroup[gid](); } catch (e) {}
        delete unsubByGroup[gid];
        delete countMap[gid];
      }
    });

    Object.keys(currentIds).forEach(function (gid) {
      if (unsubByGroup[gid]) return;
      var jRef = collection(db, RIDING_GROUP_COLLECTION, gid, RIDING_GROUP_JOIN_REQUESTS_SUB);
      unsubByGroup[gid] = onSnapshot(jRef, function (jSnap) {
        countMap[gid] = jSnap.size;
        emitTotal();
      }, function () {
        countMap[gid] = 0;
        emitTotal();
      });
    });

    emitTotal();
  }, function () {
    onUpdate(0, {});
  });

  return function () {
    if (unsubGroupsList) { try { unsubGroupsList(); } catch (e) {} }
    Object.keys(unsubByGroup).forEach(function (gid) {
      try { unsubByGroup[gid](); } catch (e) {}
    });
  };
}

/**
 * 현재 사용자가 지정된 그룹들의 members/{userId} 문서를 직접 구독.
 * joinRequests(신청 대기) 상태는 포함하지 않음 — 수락 완료(members 문서 존재)만 true.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} userId
 * @param {string[]} groupIds  구독할 그룹 ID 배열 (화면에 보이는 그룹 목록)
 * @param {function(Set<string>): void} onUpdate  멤버로 등록된 groupId Set
 * @returns {function(): void}  unsubscribe
 */
export function subscribeUserGroupMemberships(db, userId, groupIds, onUpdate) {
  if (!db || !userId || !Array.isArray(groupIds) || !groupIds.length || typeof onUpdate !== 'function') {
    if (typeof onUpdate === 'function') onUpdate(new Set());
    return function () {};
  }
  var uid = String(userId).trim();
  var status = {};
  var unsubs = [];

  function emitSet() {
    var s = new Set();
    Object.keys(status).forEach(function (k) { if (status[k]) s.add(k); });
    onUpdate(s);
  }

  groupIds.forEach(function (groupId) {
    var gid = String(groupId).trim();
    if (!gid) return;
    status[gid] = false;
    var mRef = doc(db, RIDING_GROUP_COLLECTION, gid, 'members', uid);
    var unsub = onSnapshot(
      mRef,
      function (snap) { status[gid] = snap.exists(); emitSet(); },
      function ()     { status[gid] = false;          emitSet(); }
    );
    unsubs.push(unsub);
  });

  return function () {
    unsubs.forEach(function (u) { try { u(); } catch (e) {} });
  };
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} groupId
 */
export async function fetchRidingGroupById(db, groupId) {
  return fetchRidingGroupByIdRouted(db, groupId);
}

if (typeof window !== 'undefined') {
  window.openRidingGroupService = {
    RIDING_GROUP_COLLECTION,
    RIDING_GROUP_JOIN_REQUESTS_SUB,
    GROUP_STATUS,
    RIDING_GROUP_CATEGORY,
    normalizeRidingGroupCategory,
    ridingGroupMatchesCategory,
    filterRidingGroupsByCategory,
    resolveRidingGroupCategoryFromActiveSport,
    subscribeMyRidingGroupsAsMember,
    subscribeRidingGroups,
    subscribeRidingGroupDetail,
    subscribeRidingGroupMembers,
    subscribeRidingGroupJoinRequests,
    subscribeRidingGroupMyJoinRequest,
    createRidingGroupPending,
    updateRidingGroupByOwner,
    updateRidingGroupRankingNotice,
    RIDING_GROUP_RANKING_NOTICE_MAX_LEN,
    setRidingGroupStatusByAdmin,
    joinRidingGroup,
    approveRidingGroupJoinRequest,
    rejectRidingGroupJoinRequest,
    leaveRidingGroup,
    deleteRidingGroupByOwner,
    updateRidingGroupByAdmin,
    deleteRidingGroupByAdmin,
    transferRidingGroupOwnership,
    fetchRidingGroupById,
    fetchRidingGroupMembersList,
    fetchRidingGroupJoinRequestsList,
    uploadRidingGroupCover,
    subscribeMyManagedGroupsJoinRequestCounts,
    subscribeUserGroupMemberships
  };
}
