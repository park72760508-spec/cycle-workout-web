/**
 * 라이딩 모임 Read Canary — 서비스 레이어 라우팅 (UI·JSX 무수정).
 * Supabase Read ON → Cloud Functions HTTP (Firestore JSON Adapter)
 * 그 외 → Firestore 직접 조회/구독
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const API_BASE = 'https://us-central1-stelvio-ai.cloudfunctions.net';
const GROUPS_READ_ROUTING_URL = API_BASE + '/getGroupsReadRoutingPublic';
const READ_SOURCE_CACHE_MS = 60 * 1000;
const SUPABASE_POLL_MS = 15000;

/** @type {{ source: 'firebase'|'supabase', loadedAt: number, loading: Promise<string>|null }} */
const groupsReadState = {
  source: 'firebase',
  loadedAt: 0,
  loading: null,
};

export function stelvioGetGroupsReadSourceSync() {
  return groupsReadState.source === 'supabase' ? 'supabase' : 'firebase';
}

export async function stelvioEnsureGroupsReadSource(force) {
  const now = Date.now();
  if (!force && groupsReadState.loadedAt > 0 && now - groupsReadState.loadedAt < READ_SOURCE_CACHE_MS) {
    return stelvioGetGroupsReadSourceSync();
  }
  if (groupsReadState.loading && !force) return groupsReadState.loading;

  groupsReadState.loading = (async function () {
    try {
      const res = await fetch(GROUPS_READ_ROUTING_URL, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
      });
      const json = res.ok ? await res.json().catch(function () { return null; }) : null;
      if (json && json.success && json.readSource === 'supabase') {
        groupsReadState.source = 'supabase';
      } else {
        groupsReadState.source = 'firebase';
      }
    } catch (e) {
      /* 오프라인 시 마지막 값 유지 */
    }
    groupsReadState.loadedAt = Date.now();
    return stelvioGetGroupsReadSourceSync();
  })();

  try {
    return await groupsReadState.loading;
  } finally {
    groupsReadState.loading = null;
  }
}

function viewerUid() {
  return (
    (typeof window !== 'undefined' && window.currentUser && window.currentUser.id) ||
    (typeof window !== 'undefined' &&
      window.authV9 &&
      window.authV9.currentUser &&
      window.authV9.currentUser.uid) ||
    ''
  );
}

async function httpGetJson(path, params) {
  const p = new URLSearchParams(params || {});
  const uid = viewerUid();
  if (uid && !p.has('uid')) p.set('uid', uid);
  const res = await fetch(path + '?' + p.toString(), {
    method: 'GET',
    mode: 'cors',
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json().catch(function () { return null; });
}

function membersFromGroupPayload(group) {
  if (!group || !Array.isArray(group._members)) return [];
  return group._members.map(function (m) {
    if (!m) return null;
    return {
      id: m.id,
      userId: m.id,
      joinedAt: m.joinedAt,
      displayName: m.displayName || '',
      profileImageUrl: m.profileImageUrl != null ? m.profileImageUrl : null,
      role: m.role || 'member',
    };
  }).filter(Boolean);
}

function joinRequestsFromGroupPayload(group) {
  if (!group || !Array.isArray(group._joinRequests)) return [];
  return group._joinRequests.map(function (r) {
    if (!r) return null;
    return {
      id: r.id,
      userId: r.id,
      requestedAt: r.requestedAt,
      displayName: r.displayName || '',
      profileImageUrl: r.profileImageUrl != null ? r.profileImageUrl : null,
    };
  }).filter(Boolean);
}

/** ---------- 오픈 라이딩 Read ---------- */

export async function fetchRideByIdRouted(db, rideId) {
  await stelvioEnsureGroupsReadSource();
  const id = String(rideId || '').trim();
  if (!id) return null;

  if (stelvioGetGroupsReadSourceSync() === 'supabase') {
    const json = await httpGetJson(API_BASE + '/getOpenRideForRead', { rideId: id });
    if (json && json.success && json.ride) return json.ride;
  }

  const snap = await getDoc(doc(db, 'rides', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function fetchRidesInDateRangeRouted(db, from, to) {
  await stelvioEnsureGroupsReadSource();
  const fromTs = Timestamp.fromDate(from);
  const toTs = Timestamp.fromDate(to);

  if (stelvioGetGroupsReadSourceSync() === 'supabase') {
    const startStr = from.toISOString().slice(0, 10);
    const endStr = to.toISOString().slice(0, 10);
    const json = await httpGetJson(API_BASE + '/getOpenRidesInDateRangeForRead', {
      startStr,
      endStr,
    });
    if (json && json.success && Array.isArray(json.rides)) return json.rides;
  }

  const q = query(
    collection(db, 'rides'),
    where('date', '>=', fromTs),
    where('date', '<=', toTs),
    orderBy('date', 'asc')
  );
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(function (d) {
    list.push({ id: d.id, ...d.data() });
  });
  return list;
}

export function subscribeRideByIdRouted(db, rideId, onNext, onError) {
  const id = String(rideId || '').trim();
  if (!db || !id) {
    onNext(null);
    return function () {};
  }

  var stopped = false;
  var pollTimer = null;
  var fsUnsub = null;

  function apply(data) {
    if (!stopped && typeof onNext === 'function') onNext(data);
  }

  stelvioEnsureGroupsReadSource().then(function () {
    if (stopped) return;

    if (stelvioGetGroupsReadSourceSync() === 'supabase') {
      function poll() {
        fetchRideByIdRouted(db, id)
          .then(apply)
          .catch(
            onError ||
              function (err) {
                if (typeof console !== 'undefined' && console.warn) {
                  console.warn('[openRidingRead] poll ride', err);
                }
              }
          );
      }
      poll();
      pollTimer = setInterval(poll, SUPABASE_POLL_MS);
      return;
    }

    fsUnsub = onSnapshot(
      doc(db, 'rides', id),
      function (snap) {
        if (!snap.exists()) apply(null);
        else apply({ id: snap.id, ...snap.data() });
      },
      onError ||
        function (err) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[openRidingRead] subscribeRideById', err);
          }
        }
    );
  });

  return function () {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    if (fsUnsub) {
      try {
        fsUnsub();
      } catch (e) {}
    }
  };
}

/** ---------- 소모임 Read ---------- */

export async function fetchRidingGroupByIdRouted(db, groupId, opts) {
  opts = opts || {};
  await stelvioEnsureGroupsReadSource();
  const gid = String(groupId || '').trim();
  if (!gid) return null;

  if (stelvioGetGroupsReadSourceSync() === 'supabase') {
    const json = await httpGetJson(API_BASE + '/getRidingGroupForRead', {
      groupId: gid,
      includeJoinRequests: opts.includeJoinRequests ? '1' : '0',
    });
    if (json && json.success && json.group) {
      var g = json.group;
      delete g._members;
      delete g._joinRequests;
      return g;
    }
  }

  const snap = await getDoc(doc(db, 'stelvio_riding_groups', gid));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function fetchRidingGroupMembersListRouted(db, groupId) {
  await stelvioEnsureGroupsReadSource();
  const gid = String(groupId || '').trim();
  if (!gid) return [];

  if (stelvioGetGroupsReadSourceSync() === 'supabase') {
    const json = await httpGetJson(API_BASE + '/getRidingGroupForRead', {
      groupId: gid,
      includeJoinRequests: '0',
    });
    if (json && json.success && json.group) return membersFromGroupPayload(json.group);
  }

  const snap = await getDocs(collection(db, 'stelvio_riding_groups', gid, 'members'));
  const list = [];
  snap.forEach(function (d) {
    list.push({ id: d.id, ...d.data() });
  });
  return list;
}

export async function fetchRidingGroupJoinRequestsListRouted(db, groupId) {
  await stelvioEnsureGroupsReadSource();
  const gid = String(groupId || '').trim();
  if (!gid) return [];

  if (stelvioGetGroupsReadSourceSync() === 'supabase') {
    const json = await httpGetJson(API_BASE + '/getRidingGroupForRead', {
      groupId: gid,
      includeJoinRequests: '1',
    });
    if (json && json.success && json.group) return joinRequestsFromGroupPayload(json.group);
  }

  const snap = await getDocs(collection(db, 'stelvio_riding_groups', gid, 'joinRequests'));
  const list = [];
  snap.forEach(function (d) {
    list.push({ id: d.id, ...d.data() });
  });
  return list;
}

export function subscribeRidingGroupDetailRouted(db, groupId, cb) {
  const gid = String(groupId || '').trim();
  if (!db || !gid || typeof cb !== 'function') return function () {};

  var stopped = false;
  var pollTimer = null;
  var fsUnsub = null;

  stelvioEnsureGroupsReadSource().then(function () {
    if (stopped) return;

    if (stelvioGetGroupsReadSourceSync() === 'supabase') {
      function poll() {
        fetchRidingGroupByIdRouted(db, gid).then(function (g) {
          if (!stopped) cb(g);
        });
      }
      poll();
      pollTimer = setInterval(poll, SUPABASE_POLL_MS);
      return;
    }

    fsUnsub = onSnapshot(doc(db, 'stelvio_riding_groups', gid), function (snap) {
      if (!snap.exists()) cb(null);
      else cb({ id: snap.id, ...snap.data() });
    });
  });

  return function () {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    if (fsUnsub) {
      try {
        fsUnsub();
      } catch (e) {}
    }
  };
}

export function subscribeRidingGroupMembersRouted(db, groupId, cb) {
  const gid = String(groupId || '').trim();
  if (!db || !gid || typeof cb !== 'function') return function () {};

  var stopped = false;
  var pollTimer = null;
  var fsUnsub = null;

  stelvioEnsureGroupsReadSource().then(function () {
    if (stopped) return;

    if (stelvioGetGroupsReadSourceSync() === 'supabase') {
      function poll() {
        fetchRidingGroupMembersListRouted(db, gid).then(function (rows) {
          if (!stopped) cb(rows);
        });
      }
      poll();
      pollTimer = setInterval(poll, SUPABASE_POLL_MS);
      return;
    }

    fsUnsub = onSnapshot(collection(db, 'stelvio_riding_groups', gid, 'members'), function (snap) {
      var list = [];
      snap.forEach(function (d) {
        list.push({ id: d.id, ...d.data() });
      });
      cb(list);
    });
  });

  return function () {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    if (fsUnsub) {
      try {
        fsUnsub();
      } catch (e) {}
    }
  };
}

export function subscribeRidingGroupJoinRequestsRouted(db, groupId, cb) {
  const gid = String(groupId || '').trim();
  if (!db || !gid || typeof cb !== 'function') return function () {};

  var stopped = false;
  var pollTimer = null;
  var fsUnsub = null;

  stelvioEnsureGroupsReadSource().then(function () {
    if (stopped) return;

    if (stelvioGetGroupsReadSourceSync() === 'supabase') {
      function poll() {
        fetchRidingGroupJoinRequestsListRouted(db, gid).then(function (rows) {
          if (!stopped) cb(rows);
        });
      }
      poll();
      pollTimer = setInterval(poll, SUPABASE_POLL_MS);
      return;
    }

    fsUnsub = onSnapshot(
      collection(db, 'stelvio_riding_groups', gid, 'joinRequests'),
      function (snap) {
        var list = [];
        snap.forEach(function (d) {
          list.push({ id: d.id, ...d.data() });
        });
        cb(list);
      }
    );
  });

  return function () {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    if (fsUnsub) {
      try {
        fsUnsub();
      } catch (e) {}
    }
  };
}

/**
 * 승인된 소모임 목록 — Supabase HTTP 또는 Firestore onSnapshot.
 * 관리자 PENDING 목록은 Firestore 유지(복합 쿼리).
 */
export function subscribeRidingGroupsRouted(db, isAdmin, onUpdate, viewerUid) {
  if (!db || typeof onUpdate !== 'function') return function () {};

  if (isAdmin) {
    return subscribeRidingGroupsFirestoreAdmin(db, onUpdate);
  }

  var stopped = false;
  var pollTimer = null;
  var fsPendingUnsub = null;
  var fsViewerUnsub = null;
  var approvedCache = [];
  var myPendingCache = [];

  function emit() {
    if (stopped) return;
    var vu = viewerUid != null ? String(viewerUid).trim() : '';
    var merged = approvedCache.slice();
    if (vu) {
      myPendingCache.forEach(function (row) {
        if (String(row.createdBy || '') === vu) merged.push(row);
      });
    }
    merged.sort(function (a, b) {
      var ta = (a.createdAt && a.createdAt.seconds) || 0;
      var tb = (b.createdAt && b.createdAt.seconds) || 0;
      return tb - ta;
    });
    onUpdate(merged);
  }

  stelvioEnsureGroupsReadSource().then(function () {
    if (stopped) return;

    if (stelvioGetGroupsReadSourceSync() === 'supabase') {
      function pollApproved() {
        httpGetJson(API_BASE + '/getApprovedRidingGroupsForRead', { limit: '200' }).then(
          function (json) {
            if (json && json.success && Array.isArray(json.groups)) {
              approvedCache = json.groups;
              emit();
            }
          }
        );
      }
      pollApproved();
      pollTimer = setInterval(pollApproved, SUPABASE_POLL_MS);

      var vu = viewerUid != null ? String(viewerUid).trim() : '';
      if (vu) {
        fsPendingUnsub = onSnapshot(
          query(collection(db, 'stelvio_riding_groups'), where('createdBy', '==', vu)),
          function (snap) {
            myPendingCache = [];
            snap.forEach(function (d) {
              var data = d.data() || {};
              if (String(data.status || '') !== 'PENDING') return;
              myPendingCache.push({ id: d.id, ...data });
            });
            emit();
          }
        );
      }
      return;
    }

    fsViewerUnsub = subscribeRidingGroupsFirestoreViewer(db, onUpdate, viewerUid);
  });

  return function () {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    if (fsPendingUnsub) {
      try {
        fsPendingUnsub();
      } catch (e) {}
    }
    if (fsViewerUnsub) {
      try {
        fsViewerUnsub();
      } catch (e) {}
    }
  };
}

function subscribeRidingGroupsFirestoreAdmin(db, onUpdate) {
  var unsubs = [];
  var pend = [];
  var app = [];
  function emit() {
    onUpdate(pend.concat(app));
  }
  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'stelvio_riding_groups'),
        where('status', '==', 'PENDING'),
        orderBy('createdAt', 'desc')
      ),
      function (snap) {
        pend = [];
        snap.forEach(function (d) {
          pend.push({ id: d.id, ...d.data() });
        });
        emit();
      }
    )
  );
  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'stelvio_riding_groups'),
        where('status', '==', 'APPROVED'),
        orderBy('createdAt', 'desc')
      ),
      function (snap) {
        app = [];
        snap.forEach(function (d) {
          app.push({ id: d.id, ...d.data() });
        });
        emit();
      }
    )
  );
  return function () {
    unsubs.forEach(function (u) {
      try {
        u();
      } catch (e) {}
    });
  };
}

function subscribeRidingGroupsFirestoreViewer(db, onUpdate, viewerUid) {
  var unsubs = [];
  var approved = [];
  var myPending = [];
  function emit() {
    var map = Object.create(null);
    approved.forEach(function (r) {
      if (r && r.id) map[r.id] = r;
    });
    myPending.forEach(function (r) {
      if (r && r.id) map[r.id] = r;
    });
    onUpdate(
      Object.keys(map)
        .map(function (k) {
          return map[k];
        })
        .sort(function (a, b) {
          var ta = (a.createdAt && a.createdAt.seconds) || 0;
          var tb = (b.createdAt && b.createdAt.seconds) || 0;
          return tb - ta;
        })
    );
  }
  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'stelvio_riding_groups'),
        where('status', '==', 'APPROVED'),
        orderBy('createdAt', 'desc')
      ),
      function (snap) {
        approved = [];
        snap.forEach(function (d) {
          approved.push({ id: d.id, ...d.data() });
        });
        emit();
      }
    )
  );
  var vu = viewerUid != null ? String(viewerUid).trim() : '';
  if (vu) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'stelvio_riding_groups'), where('createdBy', '==', vu)),
        function (snap) {
          myPending = [];
          snap.forEach(function (d) {
            var data = d.data() || {};
            if (String(data.status || '') !== 'PENDING') return;
            myPending.push({ id: d.id, ...data });
          });
          emit();
        }
      )
    );
  }
  return function () {
    unsubs.forEach(function (u) {
      try {
        u();
      } catch (e) {}
    });
  };
}

if (typeof window !== 'undefined') {
  window.stelvioEnsureGroupsReadSource = stelvioEnsureGroupsReadSource;
  window.stelvioGetGroupsReadSourceSync = stelvioGetGroupsReadSourceSync;
  window.openRidingReadClient = {
    stelvioEnsureGroupsReadSource,
    stelvioGetGroupsReadSourceSync,
    fetchRideByIdRouted,
    fetchRidesInDateRangeRouted,
    subscribeRideByIdRouted,
    fetchRidingGroupByIdRouted,
    fetchRidingGroupMembersListRouted,
    fetchRidingGroupJoinRequestsListRouted,
    subscribeRidingGroupDetailRouted,
    subscribeRidingGroupMembersRouted,
    subscribeRidingGroupJoinRequestsRouted,
    subscribeRidingGroupsRouted,
  };
}
