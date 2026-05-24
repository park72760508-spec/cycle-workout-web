/**
 * 오픈 라이딩·소모임 — Firestore Primary 성공 후 Supabase Secondary (Fault Isolated).
 * @see assets/js/supabaseDualWrite.js, functions/supabaseGroupDualWriteServer.js
 */
import {
  evaluateSecondaryIngestWrite,
  refreshDualRunFromRemoteConfig,
  shouldRunSupabaseDualWrite,
  syncSupabaseSessionFromBridge,
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

function getConfig() {
  const c = (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
  return {
    authBridgeUrl: String(c.authBridgeUrl || '').trim(),
  };
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

  try {
    await syncSupabaseSessionFromBridge();
  } catch (bridgeErr) {
    console.warn(
      '[openRidingDualWrite] Auth Bridge 스킵(relay는 서버 service role):',
      bridgeErr && bridgeErr.message ? bridgeErr.message : bridgeErr
    );
  }

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
  return import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js').then(
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
  if (!db || !rideId) return;
  fetchRideDocForDualWrite(db, rideId, 0)
    .then(function (snap) {
      if (!snap || !snap.exists()) {
        console.warn('[openRidingDualWrite] rides doc 없음 — secondary 스킵', rideId);
        return;
      }
      const data = snap.data();
      fireSecondaryTasksIsolated([
        runSecondaryAfterOpenRideSave(
          actorUid || data.hostUserId,
          String(rideId).trim(),
          data
        ),
      ]);
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
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js').then(function (fs) {
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
  window.runSecondaryAfterRidingGroupSave = runSecondaryAfterRidingGroupSave;
  window.fireSecondaryTasksIsolated = fireSecondaryTasksIsolated;
  window.scheduleOpenRideDualWriteFromFirestore = scheduleOpenRideDualWriteFromFirestore;
  window.scheduleRidingGroupDualWriteFromFirestore = scheduleRidingGroupDualWriteFromFirestore;
  window.shouldRunSupabaseOpenRidingDualWrite = shouldRunSupabaseDualWrite;
}
