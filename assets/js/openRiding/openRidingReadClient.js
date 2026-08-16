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
/** 내 소mo임·멤버십 — 변경 빈도 낮음, Firestore reads 절감 */
const MY_GROUPS_POLL_MS = 45000;
const MY_MEMBERSHIPS_POLL_MS = 30000;

/**
 * 화면(탭)이 백그라운드/화면 꺼짐 상태일 때는 폴링을 건너뛴다 — 라이딩 모임·러닝 크루 화면을
 * 켜둔 채 다른 앱으로 전환하거나 화면이 꺼져도, 이 모듈이 mount돼 있는 한 라이딩 상세·소모임
 * 목록·가입 신청 배지 등 여러 구독이 각자 독립적으로 15~45초마다 계속 HTTP 폴링을 돌려 배터리·
 * 발열 부담을 주던 부분을 줄인다(2026-08). visible로 돌아오면 바로 다음 tick부터 정상 재개된다.
 * @param {() => void} fn
 */
function stelvioVisibilityGatedPoll(fn) {
  return function () {
    if (typeof document !== 'undefined' && document.hidden) return;
    fn();
  };
}

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

async function httpGetJsonAuthed(path, params) {
  const p = new URLSearchParams(params || {});
  const token =
    typeof window !== 'undefined' &&
    window.authV9 &&
    window.authV9.currentUser &&
    typeof window.authV9.currentUser.getIdToken === 'function'
      ? await window.authV9.currentUser.getIdToken()
      : '';
  const res = await fetch(path + '?' + p.toString(), {
    method: 'GET',
    mode: 'cors',
    cache: 'no-store',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  if (!res.ok) return null;
  return res.json().catch(function () { return null; });
}

/**
 * 인증된 POST — 가입/승인/거절/탈퇴처럼 Supabase에 먼저 쓰고 Firestore를 서버가 동기
 * 미러링하는 쓰기 전용 Cloud Function 호출용. GET과 달리 실패를 삼키지 않고 그대로
 * 던져서(throw) 호출부(openRidingGroupService.js)가 사용자에게 에러를 보여줄 수 있게 한다.
 */
async function httpPostJsonAuthed(path, body) {
  const token =
    typeof window !== 'undefined' &&
    window.authV9 &&
    window.authV9.currentUser &&
    typeof window.authV9.currentUser.getIdToken === 'function'
      ? await window.authV9.currentUser.getIdToken()
      : '';
  if (!token) throw new Error('로그인이 필요합니다.');
  const res = await fetch(path, {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(function () { return null; });
  if (!res.ok || !json || json.success === false) {
    const msg = (json && json.error && (json.error.message || json.error)) || '요청을 처리하지 못했습니다.';
    throw new Error(String(msg));
  }
  return json;
}

/**
 * 가입/승인/거절/탈퇴 — Supabase-우선 쓰기 Cloud Function 공용 호출부.
 * @param {'join'|'approve'|'reject'|'leave'} action
 * @param {object} body
 */
export async function postRidingGroupWriteRouted(action, body) {
  const endpoints = {
    join: API_BASE + '/joinRidingGroupSupabase',
    approve: API_BASE + '/approveRidingGroupJoinRequestSupabase',
    reject: API_BASE + '/rejectRidingGroupJoinRequestSupabase',
    leave: API_BASE + '/leaveRidingGroupSupabase',
  };
  const url = endpoints[action];
  if (!url) throw new Error('알 수 없는 요청입니다.');
  return httpPostJsonAuthed(url, body);
}

/**
 * Supabase 어댑터(functions/groupResponseAdapter.js의 tsFromIso)가 만드는 날짜 필드는
 * 순수 JSON {seconds, nanoseconds} 객체라 Firestore Timestamp의 .toDate()가 없다.
 * 캘린더 등 클라이언트 코드는 전부 ts.toDate()(또는 instanceof Date)로 날짜를 판별하므로,
 * HTTP 응답을 받는 시점에 한 번 폴리필해두면 이후 모든 소비 지점이 그대로 동작한다.
 * (2026-08 회귀: 이 폴리필 없이 라우팅을 켰더니 캘린더에 모임 표시가 전부 사라졌었음 —
 * 데이터 마이그레이션 문제가 아니라 날짜 필드 형태 불일치였음.)
 */
function stelvioHydrateTimestampLikeFields(obj, fields) {
  if (!obj) return obj;
  fields.forEach(function (f) {
    var v = obj[f];
    if (v && typeof v === 'object' && typeof v.seconds === 'number' && typeof v.toDate !== 'function') {
      var seconds = v.seconds;
      var nanoseconds = typeof v.nanoseconds === 'number' ? v.nanoseconds : 0;
      obj[f] = {
        seconds: seconds,
        nanoseconds: nanoseconds,
        toDate: function () {
          return new Date(seconds * 1000 + Math.round(nanoseconds / 1e6));
        },
      };
    }
  });
  return obj;
}

export async function fetchTrainingLogsByDateRangeForReviewRouted(userId, year, month) {
  const uid = String(userId || '').trim();
  const y = Number(year);
  const m = Number(month);
  if (!uid || !Number.isFinite(y) || !Number.isFinite(m)) return [];
  const json = await httpGetJsonAuthed(API_BASE + '/getOpenRideReviewLogsForRead', {
    uid,
    year: String(y),
    month: String(m),
  });
  return json && json.success && Array.isArray(json.logs) ? json.logs : [];
}

function membersFromGroupPayload(group) {
  if (!group || !Array.isArray(group._members)) return [];
  return group._members.map(function (m) {
    if (!m) return null;
    var uid = m.userId != null ? String(m.userId) : m.id != null ? String(m.id) : '';
    if (!uid) return null;
    return {
      id: uid,
      userId: uid,
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
    if (json && json.success && json.ride) {
      return stelvioHydrateTimestampLikeFields(json.ride, ['date', 'createdAt', 'updatedAt']);
    }
  }

  const snap = await getDoc(doc(db, 'rides', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** 로컬(기기) 날짜 → YYYY-MM-DD. toISOString()은 UTC로 변환되어 한국시간 자정 근처에서
 *  하루 밀리는 문제가 있어, from/to(로컬 시각 Date)는 로컬 getter로 직접 포맷한다. */
function stelvioLocalDateToYmd(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export async function fetchRidesInDateRangeRouted(db, from, to) {
  await stelvioEnsureGroupsReadSource();
  const fromTs = Timestamp.fromDate(from);
  const toTs = Timestamp.fromDate(to);

  if (stelvioGetGroupsReadSourceSync() === 'supabase') {
    const startStr = stelvioLocalDateToYmd(from);
    const endStr = stelvioLocalDateToYmd(to);
    const json = await httpGetJson(API_BASE + '/getOpenRidesInDateRangeForRead', {
      startStr,
      endStr,
    });
    if (json && json.success && Array.isArray(json.rides)) {
      return json.rides.map(function (r) {
        return stelvioHydrateTimestampLikeFields(r, ['date', 'createdAt', 'updatedAt']);
      });
    }
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
      pollTimer = setInterval(stelvioVisibilityGatedPoll(poll), SUPABASE_POLL_MS);
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

async function fetchRidingGroupMembersFromFirestore(db, groupId) {
  const gid = String(groupId || '').trim();
  if (!db || !gid) return [];
  const snap = await getDocs(collection(db, 'stelvio_riding_groups', gid, 'members'));
  const list = [];
  snap.forEach(function (d) {
    list.push({ id: d.id, userId: d.id, ...d.data() });
  });
  return list;
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
    if (json && json.success && json.group) {
      const fromSb = membersFromGroupPayload(json.group);
      if (fromSb.length > 0) return fromSb;
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[openRidingRead] Supabase 멤버 0건 → Firestore parity fallback',
          gid
        );
      }
    }
  }

  return fetchRidingGroupMembersFromFirestore(db, groupId);
}

async function fetchRidingGroupJoinRequestsFromFirestore(db, groupId) {
  const gid = String(groupId || '').trim();
  if (!db || !gid) return [];
  const snap = await getDocs(collection(db, 'stelvio_riding_groups', gid, 'joinRequests'));
  const list = [];
  snap.forEach(function (d) {
    list.push({ id: d.id, userId: d.id, ...d.data() });
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
    if (json && json.success && json.group) {
      const fromSb = joinRequestsFromGroupPayload(json.group);
      if (fromSb.length > 0) return fromSb;
    }
  }

  return fetchRidingGroupJoinRequestsFromFirestore(db, groupId);
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
      pollTimer = setInterval(stelvioVisibilityGatedPoll(poll), SUPABASE_POLL_MS);
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
      pollTimer = setInterval(stelvioVisibilityGatedPoll(poll), SUPABASE_POLL_MS);
      return;
    }

    fsUnsub = onSnapshot(collection(db, 'stelvio_riding_groups', gid, 'members'), function (snap) {
      var list = [];
      snap.forEach(function (d) {
        list.push({ id: d.id, userId: d.id, ...d.data() });
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
      pollTimer = setInterval(stelvioVisibilityGatedPoll(poll), SUPABASE_POLL_MS);
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
      pollTimer = setInterval(stelvioVisibilityGatedPoll(pollApproved), SUPABASE_POLL_MS);

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

/**
 * 내 소mo임 목록 — Supabase HTTP 폴링 (Firestore 승인 전체×members/{uid} 리스너 대체).
 * Canary 무관: getMyRidingGroupsForRead 가 Supabase 우선.
 */
export function subscribeMyRidingGroupsAsMemberRouted(db, uid, onUpdate) {
  if (!uid || typeof onUpdate !== 'function') return function () {};
  var u = String(uid).trim();
  if (!u) return function () {};

  var stopped = false;
  var pollTimer = null;

  function poll() {
    httpGetJson(API_BASE + '/getMyRidingGroupsForRead', { uid: u, userId: u }).then(function (json) {
      if (stopped) return;
      if (json && json.success && Array.isArray(json.groups)) {
        onUpdate(json.groups);
      }
    });
  }

  poll();
  pollTimer = setInterval(stelvioVisibilityGatedPoll(poll), MY_GROUPS_POLL_MS);

  return function () {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
  };
}

/**
 * 클럽 UI — 보이는 그룹 중 내 멤버십 Set (G개 onSnapshot 대체).
 */
export function subscribeUserGroupMembershipsRouted(db, userId, groupIds, onUpdate) {
  if (typeof onUpdate !== 'function') return function () {};
  var u = String(userId || '').trim();
  var ids = (groupIds || [])
    .map(function (g) {
      return String(g || '').trim();
    })
    .filter(Boolean);
  if (!u || !ids.length) {
    onUpdate(new Set());
    return function () {};
  }

  var stopped = false;
  var pollTimer = null;

  function poll() {
    httpGetJson(API_BASE + '/getMyGroupMembershipsForRead', {
      uid: u,
      userId: u,
      groupIds: ids.join(','),
    }).then(function (json) {
      if (stopped) return;
      if (json && json.success && Array.isArray(json.memberGroupIds)) {
        onUpdate(new Set(json.memberGroupIds));
      }
    });
  }

  poll();
  pollTimer = setInterval(stelvioVisibilityGatedPoll(poll), MY_MEMBERSHIPS_POLL_MS);

  return function () {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
  };
}

/**
 * 오픈라이딩 룸 — 내가 방장인 소mo임들의 가입신청 대기 건수(총합 + 그룹별 breakdown).
 * G개 그룹별 joinRequests fan-out onSnapshot 대체(그룹 목록 리스너 1개 + 그룹당 리스너 1개씩).
 */
export function subscribeMyManagedGroupsJoinRequestCountsRouted(db, userId, onUpdate) {
  if (!userId || typeof onUpdate !== 'function') return function () {};
  var u = String(userId).trim();
  if (!u) return function () {};

  var stopped = false;
  var pollTimer = null;

  function poll() {
    httpGetJsonAuthed(API_BASE + '/getManagedGroupsPendingJoinRequestCountForRead', { uid: u }).then(function (json) {
      if (stopped) return;
      if (json && json.success) {
        onUpdate(
          typeof json.total === 'number' ? json.total : 0,
          json.countMap && typeof json.countMap === 'object' ? json.countMap : {}
        );
      }
    });
  }

  /* 배지 카운트는 라이딩 모임·러닝 크루 화면이 열려있는 동안(어느 하위 화면이든) 항상 켜져
     있는 백그라운드 구독이라, 실시간성이 필요한 상세 화면 폴링(SUPABASE_POLL_MS=15초)과 같은
     주기로 돌 필요가 없다 — MY_GROUPS_POLL_MS(45초)로 늦춰 상시 폴링 부담을 줄인다(2026-08). */
  poll();
  pollTimer = setInterval(stelvioVisibilityGatedPoll(poll), MY_GROUPS_POLL_MS);

  return function () {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
  };
}

/**
 * 라이딩 모임·러닝 크루 하단 네비 "라이딩/러닝" 메뉴 배지 — 오늘 기준 초대받은(참석 확정 전) 건수.
 * getBasecampBadgeCountsForRead가 이미 KST 자정 기준으로 만료된 초대를 제외하므로 그대로 재사용한다.
 * onUpdate(personalCount, crewInviteCount, crewInviteMap, hostedInCrewMap) — 크루(그룹)가 생성한
 * 모임 초대는 personalCount에서 제외되어 크루 배지 쪽에서만 세도록 서버가 이미 분리해서 응답한다
 * (중복 카운트 방지). crewInviteMap/hostedInCrewMap은 { groupId: count } — 크루 리스트 화면에서
 * 그룹별 배지에 쓴다.
 */
export function subscribeMyInvitedRidesCountRouted(userId, category, onUpdate) {
  if (!userId || typeof onUpdate !== 'function') return function () {};
  var u = String(userId).trim();
  if (!u) return function () {};
  var isRun = String(category || 'CYCLE').trim().toUpperCase() === 'RUN';

  var stopped = false;
  var pollTimer = null;

  function poll() {
    httpGetJsonAuthed(API_BASE + '/getBasecampBadgeCountsForRead', { uid: u }).then(function (json) {
      if (stopped) return;
      if (json && json.success) {
        var n = isRun ? json.ridesRun : json.ridesCycle;
        var crewN = isRun ? json.crewInviteRun : json.crewInviteCycle;
        var crewMap = json.crewInviteMap && typeof json.crewInviteMap === 'object' ? json.crewInviteMap : {};
        var hostedMap = json.hostedInCrewMap && typeof json.hostedInCrewMap === 'object' ? json.hostedInCrewMap : {};
        onUpdate(typeof n === 'number' ? n : 0, typeof crewN === 'number' ? crewN : 0, crewMap, hostedMap);
      }
    });
  }

  poll();
  pollTimer = setInterval(stelvioVisibilityGatedPoll(poll), MY_GROUPS_POLL_MS);

  return function () {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
  };
}

/**
 * 오픈라이딩 룸 — 특정 소mo임에 대한 내 가입신청 대기 상태(단건).
 * 단건 joinRequests/{uid} onSnapshot 대체.
 */
export function subscribeRidingGroupMyJoinRequestRouted(db, groupId, uid, cb) {
  if (!groupId || !uid || typeof cb !== 'function') return function () {};
  var gid = String(groupId).trim();
  var u = String(uid).trim();
  if (!gid || !u) return function () {};

  var stopped = false;
  var pollTimer = null;

  function poll() {
    httpGetJsonAuthed(API_BASE + '/getMyGroupJoinRequestStatusForRead', { uid: u, groupId: gid }).then(function (json) {
      if (stopped) return;
      if (json && json.success) {
        cb(json.row || null);
      }
    });
  }

  poll();
  pollTimer = setInterval(stelvioVisibilityGatedPoll(poll), SUPABASE_POLL_MS);

  return function () {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
  };
}

/**
 * 랭킹 소셜 — 내 소mo임 멤버 UID·프로필 (M×K getDocs 대체).
 * @returns {Promise<{ uids: string[], map: object }|null>}
 */
export async function fetchMyGroupContactSetRouted(db, uid, groupIds) {
  var u = String(uid || '').trim();
  var ids = (groupIds || [])
    .map(function (g) {
      return String(g || '').trim();
    })
    .filter(Boolean);
  if (!u || !ids.length) return { uids: [], map: {} };

  var json = await httpGetJson(API_BASE + '/getMyGroupContactSetForRead', {
    uid: u,
    userId: u,
    groupIds: ids.join(','),
  });
  if (!json || !json.success) return null;
  return {
    uids: Array.isArray(json.uids) ? json.uids : [],
    map: json.map && typeof json.map === 'object' ? json.map : {},
    readBackend: json.readBackend || json.readSource || '',
  };
}

/**
 * 라이딩/러닝 모임 생성 "GPX 파일(선택) → 즐겨찾기 코스" 팝업 —
 * 내가 host로 만든 모임 중 GPX가 등록된 것들을 gpx_url 기준 중복 제외한 목록.
 * @returns {Promise<Array<{id:string,title:string,course:string,gpxUrl:string,createdAt:string|null}>>}
 */
export async function fetchMyGpxCoursesRouted(uid, category) {
  var u = String(uid || '').trim();
  if (!u) return [];
  var json = await httpGetJsonAuthed(API_BASE + '/getMyGpxCoursesForRead', {
    uid: u,
    userId: u,
    category: category === 'RUN' ? 'RUN' : 'CYCLE',
  });
  if (!json || !json.success) return [];
  return Array.isArray(json.courses) ? json.courses : [];
}

/**
 * 라이딩/러닝 모임 생성 시 방금 첨부한 GPX(원문 텍스트)가 내 기존 코스 라이브러리와
 * 지오메트리상 같은 코스인지 서버에 확인 — 매치되면 그 코스의 gpxUrl을 돌려받아
 * 새로 업로드하지 않고 재사용한다(중복 코스맵 누적 방지).
 * 실패해도 예외를 던지지 않고 null을 반환 — 호출부는 그냥 평소대로 새로 업로드하면 됨.
 * @returns {Promise<{id:string,title:string,gpxUrl:string,gpxStoragePath:string}|null>}
 */
export async function matchExistingGpxCourseRouted(uid, category, gpxText) {
  var u = String(uid || '').trim();
  var text = String(gpxText || '');
  if (!u || !text.trim()) return null;
  try {
    var json = await httpPostJsonAuthed(API_BASE + '/matchExistingGpxCourse', {
      uid: u,
      category: category === 'RUN' ? 'RUN' : 'CYCLE',
      gpxText: text,
    });
    return json && json.matched && json.course ? json.course : null;
  } catch (e) {
    console.warn('[openRidingReadClient] matchExistingGpxCourseRouted 실패(새로 업로드 진행):', e && e.message);
    return null;
  }
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
    subscribeMyRidingGroupsAsMemberRouted,
    subscribeUserGroupMembershipsRouted,
    fetchMyGpxCoursesRouted,
    matchExistingGpxCourseRouted,
    fetchMyGroupContactSetRouted,
    subscribeMyManagedGroupsJoinRequestCountsRouted,
    subscribeRidingGroupMyJoinRequestRouted,
  };
}
