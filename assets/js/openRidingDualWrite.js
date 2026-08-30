/**
 * 오픈 라이딩·소모임 — Firestore Primary 성공 후 Supabase Secondary (Fault Isolated).
 * @see assets/js/supabaseDualWrite.js, functions/supabaseGroupDualWriteServer.js
 */
import {
  evaluateSecondaryIngestWrite,
  refreshDualRunFromRemoteConfig,
  shouldRunSupabaseDualWrite,
} from './supabaseDualWrite.js';

const OPEN_RIDE_DUAL_WRITE_RELAY =
  'https://us-central1-stelvio-ai.cloudfunctions.net/ingestOpenRideDualWriteRelay';

/** Firestore Timestamp → relay JSON (date 매핑 실패 방지) */
function serializeRideDataForRelay(data) {
  if (!data || typeof data !== 'object') return data;
  const out = Object.assign({}, data);
  const rawDate = out.date;
  if (rawDate != null) {
    if (typeof rawDate.toDate === 'function') {
      out.date = rawDate.toDate().toISOString();
    } else if (typeof rawDate === 'object' && typeof rawDate.seconds === 'number') {
      out.date = new Date(rawDate.seconds * 1000).toISOString();
    } else if (typeof rawDate === 'object' && typeof rawDate._seconds === 'number') {
      out.date = new Date(rawDate._seconds * 1000).toISOString();
    }
  }
  if (out.createdAt != null && typeof out.createdAt.toDate === 'function') {
    out.createdAt = out.createdAt.toDate().toISOString();
  }
  if (out.updatedAt != null && typeof out.updatedAt.toDate === 'function') {
    out.updatedAt = out.updatedAt.toDate().toISOString();
  }
  return out;
}

/**
 * Firestore rides/{id} 저장 후 Secondary — Primary 실패 시 호출하지 않음.
 * @param {string} actorUid
 * @param {string} firestoreDocId
 * @param {object} rideData Firestore 문서 필드
 */
export async function runSecondaryAfterOpenRideSave(actorUid, firestoreDocId, rideData) {
  await refreshDualRunFromRemoteConfig(true);
  const decision = evaluateSecondaryIngestWrite(actorUid);
  if (!decision.execute) {
    console.log('[openRidingDualWrite] open ride secondary 스킵:', decision.reason);
    return { skipped: true, reason: decision.reason };
  }
  if (!firestoreDocId || !rideData) {
    return { skipped: true, reason: 'missing_payload' };
  }

  const payload = serializeRideDataForRelay(rideData);

  // 클라이언트 Supabase 세션 불필요 — relay가 Firebase ID 토큰 검증 후 service role로 upsert
  try {
    const token =
      typeof window !== 'undefined' &&
      window.authV9 &&
      window.authV9.currentUser &&
      typeof window.authV9.currentUser.getIdToken === 'function'
        ? await window.authV9.currentUser.getIdToken()
        : null;
    const res = await fetch(OPEN_RIDE_DUAL_WRITE_RELAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({
        firestoreDocId,
        rideData: payload,
        actorUid,
      }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      console.warn('[openRidingDualWrite] relay HTTP', res.status, json);
      return { skipped: true, reason: 'relay_http_' + res.status, detail: json };
    }
    if (json.skipped) {
      console.warn('[openRidingDualWrite] relay skipped:', json.reason || json);
      return json;
    }
    console.log('[openRidingDualWrite] open ride relay OK', json);
    return json;
  } catch (relayErr) {
    console.warn(
      '[openRidingDualWrite] relay 실패(Primary 유지, Functions onWrite 트리거 백업):',
      relayErr && relayErr.message ? relayErr.message : relayErr
    );
    return { skipped: true, reason: 'relay_error' };
  }
}

/**
 * Firestore rides/{id} 하드 삭제(모임 삭제) 후 Secondary 즉시 정리.
 * onOpenRideWrittenDualWrite 트리거도 동일 작업을 하지만 비동기라 캘린더 재조회가 그보다
 * 먼저 일어나 삭제가 반영 안 된 것처럼 보이던 버그(2026-08) — 삭제 API가 이 relay를
 * await하게 해서 클라이언트가 화면을 되돌아가기 전에 Supabase에서도 삭제가 끝나도록 한다.
 * @param {string} actorUid
 * @param {string} firestoreDocId
 */
export async function runSecondaryAfterOpenRideDelete(actorUid, firestoreDocId) {
  if (!firestoreDocId) return { skipped: true, reason: 'missing_payload' };
  const relayUrl = OPEN_RIDE_DUAL_WRITE_RELAY.replace(
    'ingestOpenRideDualWriteRelay',
    'ingestOpenRideDeleteRelay'
  );
  try {
    const token =
      typeof window !== 'undefined' &&
      window.authV9 &&
      window.authV9.currentUser &&
      typeof window.authV9.currentUser.getIdToken === 'function'
        ? await window.authV9.currentUser.getIdToken()
        : null;
    const res = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({ firestoreDocId, actorUid }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      console.warn('[openRidingDualWrite] delete relay HTTP', res.status, json);
      return { skipped: true, reason: 'relay_http_' + res.status, detail: json };
    }
    return json;
  } catch (relayErr) {
    console.warn(
      '[openRidingDualWrite] delete relay 실패(Functions onWrite 트리거 백업):',
      relayErr && relayErr.message ? relayErr.message : relayErr
    );
    return { skipped: true, reason: 'relay_error' };
  }
}

/**
 * Firestore stelvio_riding_groups/{id} 저장 후 Secondary.
 */
export async function runSecondaryAfterRidingGroupSave(actorUid, firestoreDocId, groupData, opts) {
  opts = opts || {};
  await refreshDualRunFromRemoteConfig(true);
  const decision = evaluateSecondaryIngestWrite(actorUid);
  if (!decision.execute) {
    console.log('[openRidingDualWrite] riding group secondary 스킵:', decision.reason);
    return { skipped: true, reason: decision.reason };
  }
  if (!firestoreDocId || !groupData) {
    return { skipped: true, reason: 'missing_payload' };
  }

  const relayUrl = OPEN_RIDE_DUAL_WRITE_RELAY.replace(
    'ingestOpenRideDualWriteRelay',
    'ingestRidingGroupDualWriteRelay'
  );

  try {
    const token =
      typeof window !== 'undefined' &&
      window.authV9 &&
      window.authV9.currentUser &&
      typeof window.authV9.currentUser.getIdToken === 'function'
        ? await window.authV9.currentUser.getIdToken()
        : null;
    const res = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({
        firestoreDocId,
        groupData,
        actorUid,
        syncMembers: !!opts.syncMembers,
        syncJoinRequests: !!opts.syncJoinRequests,
      }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      console.warn('[openRidingDualWrite] group relay HTTP', res.status, json);
      return { skipped: true, reason: 'relay_http_' + res.status, detail: json };
    }
    if (json.skipped) {
      console.warn('[openRidingDualWrite] group relay skipped:', json.reason || json);
    }
    return json;
  } catch (err) {
    console.warn('[openRidingDualWrite] group relay 실패:', err && err.message ? err.message : err);
    return { skipped: true, reason: 'relay_error' };
  }
}

/**
 * Primary Firestore 성공 후 Fault-Isolated Secondary (Promise.allSettled).
 * @param {Array<Promise<unknown>>} secondaryTasks
 */
export function fireSecondaryTasksIsolated(secondaryTasks) {
  if (!secondaryTasks || !secondaryTasks.length) return;
  Promise.allSettled(secondaryTasks).then(function (results) {
    results.forEach(function (r, i) {
      if (r.status === 'rejected') {
        console.warn('[openRidingDualWrite] secondary task', i, 'rejected:', r.reason);
      }
    });
  });
}

const RIDING_GROUP_COLLECTION = 'stelvio_riding_groups';

/**
 * Firestore commit 후 rides 문서 재조회 → Secondary relay (Fault Isolated).
 */
function fetchRideDocForDualWrite(db, rideId, attempt) {
  return import('/assets/js/vendor/firebasejs/10.14.1/firebase-firestore.js').then(
    function (fs) {
      return fs.getDoc(fs.doc(db, 'rides', String(rideId).trim()));
    }
  ).then(function (snap) {
    if (snap && snap.exists()) return snap;
    if (attempt < 2) {
      return new Promise(function (resolve) {
        setTimeout(resolve, 400);
      }).then(function () {
        return fetchRideDocForDualWrite(db, rideId, attempt + 1);
      });
    }
    return snap;
  });
}

export function scheduleOpenRideDualWriteFromFirestore(db, rideId, actorUid) {
  if (!db || !rideId) return Promise.resolve();
  /* 반환된 Promise는 절대 reject하지 않는다(에러는 내부에서 삼킴) — 호출부가 원하면
     await해서 "다음 화면 이동 전에 Supabase 반영까지 끝났음"을 보장할 수 있고,
     await하지 않아도 기존처럼 fire-and-forget으로 동작한다. */
  return fetchRideDocForDualWrite(db, rideId, 0)
    .then(function (snap) {
      if (!snap || !snap.exists()) {
        console.warn('[openRidingDualWrite] rides doc 없음 — secondary 스킵', rideId);
        return;
      }
      const data = snap.data();
      return runSecondaryAfterOpenRideSave(
        actorUid || data.hostUserId,
        String(rideId).trim(),
        data
      ).catch(function (err) {
        console.warn('[openRidingDualWrite] secondary relay 실패:', err);
      });
    })
    .catch(function (err) {
      console.warn('[openRidingDualWrite] schedule fetch 실패:', err);
    });
}

/**
 * Firestore commit 후 소모임 문서 재조회 → Secondary relay.
 */
export function scheduleRidingGroupDualWriteFromFirestore(db, groupId, actorUid, opts) {
  opts = opts || {};
  if (!db || !groupId) return;
  Promise.allSettled([
    import('/assets/js/vendor/firebasejs/10.14.1/firebase-firestore.js').then(function (fs) {
      return fs.getDoc(fs.doc(db, RIDING_GROUP_COLLECTION, String(groupId).trim()));
    }),
  ])
    .then(function (results) {
      const snap = results[0].status === 'fulfilled' ? results[0].value : null;
      if (!snap || !snap.exists()) return;
      const data = snap.data();
      fireSecondaryTasksIsolated([
        runSecondaryAfterRidingGroupSave(
          actorUid || data.createdBy,
          String(groupId).trim(),
          data,
          {
            syncMembers: !!opts.syncMembers,
            syncJoinRequests: !!opts.syncJoinRequests,
          }
        ),
      ]);
    })
    .catch(function () {});
}

if (typeof window !== 'undefined') {
  window.runSecondaryAfterOpenRideSave = runSecondaryAfterOpenRideSave;
  window.runSecondaryAfterOpenRideDelete = runSecondaryAfterOpenRideDelete;
  window.runSecondaryAfterRidingGroupSave = runSecondaryAfterRidingGroupSave;
  window.fireSecondaryTasksIsolated = fireSecondaryTasksIsolated;
  window.scheduleOpenRideDualWriteFromFirestore = scheduleOpenRideDualWriteFromFirestore;
  window.scheduleRidingGroupDualWriteFromFirestore = scheduleRidingGroupDualWriteFromFirestore;
  window.shouldRunSupabaseOpenRidingDualWrite = shouldRunSupabaseDualWrite;
}
