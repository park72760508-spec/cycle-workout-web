/**
 * 오픈 라이딩·소모임 — Firestore Primary 성공 후 Supabase Secondary (Fault Isolated).
 * @see assets/js/supabaseDualWrite.js, functions/supabaseGroupDualWriteServer.js
 */
import {
  evaluateSupabaseDualWrite,
  shouldRunSupabaseDualWrite,
  syncSupabaseSessionFromBridge,
} from './supabaseDualWrite.js';

const OPEN_RIDE_DUAL_WRITE_RELAY =
  'https://us-central1-stelvio-ai.cloudfunctions.net/ingestOpenRideDualWriteRelay';

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
  const decision = evaluateSupabaseDualWrite(actorUid);
  if (!decision.execute) {
    console.log('[openRidingDualWrite] open ride secondary 스킵:', decision.reason);
    return { skipped: true, reason: decision.reason };
  }
  if (!firestoreDocId || !rideData) {
    return { skipped: true, reason: 'missing_payload' };
  }

  try {
    await syncSupabaseSessionFromBridge();
  } catch (bridgeErr) {
    console.warn(
      '[openRidingDualWrite] Auth Bridge 스킵(트리거가 서버 Secondary 처리):',
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
        rideData,
        actorUid,
      }),
    });
    if (!res.ok) {
      console.warn('[openRidingDualWrite] relay HTTP', res.status);
      return { skipped: true, reason: 'relay_http_' + res.status };
    }
    const json = await res.json().catch(function () {
      return {};
    });
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
  const decision = evaluateSupabaseDualWrite(actorUid);
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
    if (!res.ok) {
      console.warn('[openRidingDualWrite] group relay HTTP', res.status);
      return { skipped: true, reason: 'relay_http_' + res.status };
    }
    return await res.json().catch(function () {
      return { skipped: false };
    });
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
export function scheduleOpenRideDualWriteFromFirestore(db, rideId, actorUid) {
  if (!db || !rideId) return;
  Promise.allSettled([
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js').then(function (fs) {
      return fs.getDoc(fs.doc(db, 'rides', String(rideId).trim()));
    }),
  ])
    .then(function (results) {
      const snap = results[0].status === 'fulfilled' ? results[0].value : null;
      if (!snap || !snap.exists()) return;
      const data = snap.data();
      fireSecondaryTasksIsolated([
        runSecondaryAfterOpenRideSave(
          actorUid || data.hostUserId,
          String(rideId).trim(),
          data
        ),
      ]);
    })
    .catch(function () {});
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
