/**
 * 계정 및 연동 개인정보 영구 삭제 (앱 스토어·개인정보보호법 대응)
 * Firebase Auth · Firestore users · Supabase(auth+public) · 프로필 Storage
 *
 * 여러 저장소(Firestore/Supabase/Storage/Firebase Auth)에 걸쳐 있어 전체를 하나의
 * 트랜잭션으로 묶을 수 없다. 그래서 "재가입에 실제로 영향을 주는 두 자원" —
 * Firebase Auth 계정(전화번호 파생 이메일을 계속 점유)과 login_account_flags 문서
 * (재가입 여부 판별의 유일한 근거) — 은 반드시 함께, 가장 먼저 지운다. 이 단계가
 * 실패하면 그 무엇도 지우지 않은 채 요청 전체를 실패 처리해 재시도가 항상 안전하도록
 * 한다. 나머지(프로필 하위 데이터, Supabase, Storage)는 재가입 가능 여부와 무관한
 * 뒷정리이므로 best-effort로 처리하고, 일부가 실패해도 요청은 성공으로 응답하되
 * warnings로 무엇이 남았는지 알려준다.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

function digitsOnly(raw) {
  return String(raw || "").replace(/\D+/g, "");
}

function getUidConfig() {
  return {
    uidNamespace: String(supabaseDualWriteServer.uidNamespaceParam.value() || "").trim(),
    uidMode:
      String(supabaseDualWriteServer.uidModeParam.value() || "v5").toLowerCase() === "literal"
        ? "literal"
        : "v5",
  };
}

async function readPhoneDigitsForUid(db, firebaseUid) {
  const userSnap = await db.collection("users").doc(firebaseUid).get();
  if (!userSnap.exists) return "";
  const data = userSnap.data() || {};
  return digitsOnly(data.contact || data.phone || data.phoneNumber || "");
}

/**
 * 재가입을 막는 두 자원(Firebase Auth 계정, login_account_flags 문서)을 함께 지운다.
 * 어느 한쪽이라도 예상치 못한 예외로 실패하면 그대로 throw해 상위에서 요청 전체를 실패
 * 처리하게 한다 — 이 함수가 끝나기 전까지는 다른 데이터를 전혀 건드리지 않으므로,
 * 실패한 뒤 재시도해도 이미 지운 것을 다시 지우려다 꼬이는 일이 없다.
 */
async function deleteIdentityRecords(db, admin, firebaseUid, phoneDigits) {
  try {
    await admin.auth().deleteUser(firebaseUid);
  } catch (eAuth) {
    const code = eAuth && eAuth.code ? String(eAuth.code) : "";
    if (code !== "auth/user-not-found") {
      throw eAuth;
    }
  }

  if (phoneDigits) {
    await db.collection("login_account_flags").doc(phoneDigits).delete();
  }
}

async function deleteSubcollectionDocs(querySnap) {
  const batchSize = 400;
  const docs = querySnap.docs || [];
  if (!docs.length) return 0;
  let deleted = 0;
  let i = 0;
  while (i < docs.length) {
    const batch = docs[0].ref.firestore.batch();
    const slice = docs.slice(i, i + batchSize);
    slice.forEach((d) => {
      batch.delete(d.ref);
    });
    await batch.commit();
    deleted += slice.length;
    i += batchSize;
  }
  return deleted;
}

/** 재가입을 막던 자원(Auth 계정, login_account_flags)은 이미 지워진 뒤 호출된다 — 나머지 프로필 데이터 정리. */
async function deleteFirestoreProfileTree(db, firebaseUid) {
  const userRef = db.collection("users").doc(firebaseUid);
  const subcollections = ["logs", "yearly_peaks", "daily_route_profiles"];
  let subDeleted = 0;
  for (const subName of subcollections) {
    const subRef = userRef.collection(subName);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const snap = await subRef.limit(400).get();
      if (snap.empty) break;
      subDeleted += await deleteSubcollectionDocs(snap);
    }
  }

  if (typeof db.recursiveDelete === "function") {
    await db.recursiveDelete(userRef);
  } else {
    await userRef.delete().catch(() => {});
  }

  return { firestoreUserDeleted: true, subDocsDeleted: subDeleted };
}

async function deleteSupabaseUser(firebaseUid) {
  try {
    const uidConfig = getUidConfig();
    const supabaseUserId = supabaseDualWriteServer.resolveUserUuid(
      firebaseUid,
      uidConfig.uidNamespace,
      uidConfig.uidMode
    );
    if (!supabaseUserId) {
      return { deleted: false, reason: "no_supabase_uuid" };
    }

    const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
    const result = { supabaseUserId, deleted: false };

    const { error } = await supabase.auth.admin.deleteUser(supabaseUserId);
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("not found") || msg.includes("User not found")) {
        const { error: delErr } = await supabase.from("users").delete().eq("id", supabaseUserId);
        if (delErr) throw delErr;
        result.deleted = true;
        result.method = "public_users_only";
        return result;
      }
      throw error;
    }
    result.deleted = true;
    result.method = "auth_admin_cascade";
    return result;
  } catch (e) {
    console.warn("[deleteUserAccount] Supabase 삭제 실패(재가입에는 영향 없음, 계속 진행):", e.message || e);
    return { deleted: false, error: e.message || String(e) };
  }
}

async function deleteProfileStorage(admin, firebaseUid) {
  try {
    const bucket = admin.storage().bucket();
    const [files] = await bucket.getFiles({ prefix: `profile_images/${firebaseUid}` });
    if (!files || !files.length) return { deletedFiles: 0 };
    await Promise.all(
      files.map((f) =>
        f.delete().catch((e) => {
          console.warn("[deleteUserAccount] storage file skip:", f.name, e.message || e);
        })
      )
    );
    return { deletedFiles: files.length };
  } catch (e) {
    console.warn("[deleteUserAccount] storage skip:", e.message || e);
    return { deletedFiles: 0, error: e.message || String(e) };
  }
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string} firebaseUid
 */
async function purgeUserAccountAndData(admin, firebaseUid) {
  const uid = String(firebaseUid || "").trim();
  if (!uid) {
    throw Object.assign(new Error("uid required"), { code: "invalid-uid" });
  }

  const db = admin.firestore();
  const phoneDigits = await readPhoneDigitsForUid(db, uid);

  // 1) 재가입을 막는 자원부터 함께 제거. 실패 시 아무 것도 지우지 않은 채 그대로 throw되어
  //    핸들러가 500으로 응답하고, 사용자는 안전하게 재시도할 수 있다.
  await deleteIdentityRecords(db, admin, uid, phoneDigits);

  // 2) 나머지는 재가입 가능 여부와 무관한 뒷정리 — best-effort. 일부가 실패해도 위 1)이
  //    이미 끝난 상태이므로 전체 요청은 성공으로 응답하고, 남은 항목은 warnings로 알린다.
  const warnings = [];
  const firestoreResult = await deleteFirestoreProfileTree(db, uid).catch((e) => {
    console.warn("[deleteUserAccount] Firestore 프로필 정리 실패:", e.message || e);
    warnings.push({ step: "firestore", message: e.message || String(e) });
    return { firestoreUserDeleted: false, subDocsDeleted: 0, error: e.message || String(e) };
  });
  const supabaseResult = await deleteSupabaseUser(uid);
  if (supabaseResult && supabaseResult.error) {
    warnings.push({ step: "supabase", message: supabaseResult.error });
  }
  const storageResult = await deleteProfileStorage(admin, uid);
  if (storageResult && storageResult.error) {
    warnings.push({ step: "storage", message: storageResult.error });
  }

  return {
    success: true,
    firebaseUid: uid,
    phoneDigits: phoneDigits || undefined,
    firestore: firestoreResult,
    supabase: supabaseResult,
    storage: storageResult,
    warnings: warnings.length ? warnings : undefined,
  };
}

/**
 * @param {import('firebase-functions/v2/https').Request} req
 * @param {import('firebase-functions/v2/https').Response} res
 * @param {import('firebase-admin')} admin
 * @param {(req: import('firebase-functions/v2/https').Request, res: import('firebase-functions/v2/https').Response) => void} setCorsHeaders
 */
async function handleDeleteUserAccountHttp(req, res, admin, setCorsHeaders) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: { code: "method-not-allowed", message: "POST만 지원합니다." } });
    return;
  }

  const sendError = (code, message, status = 400) => {
    res.status(status).json({ success: false, error: { code, message } });
  };

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      sendError("unauthenticated", "Firebase ID 토큰이 필요합니다.", 401);
      return;
    }

    const idToken = authHeader.slice("Bearer ".length).trim();
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken, true);
    } catch (e) {
      sendError("unauthenticated", "Firebase ID 토큰이 유효하지 않습니다.", 401);
      return;
    }

    let body = {};
    try {
      const raw = req.body;
      if (typeof raw === "string") body = JSON.parse(raw) || {};
      else if (typeof raw === "object" && raw !== null) body = raw;
    } catch (eParse) {
      body = {};
    }

    const confirmPhrase = body.confirmPhrase != null ? String(body.confirmPhrase).trim() : "";
    if (confirmPhrase !== "삭제") {
      sendError("invalid-argument", '확인 문구 "삭제"를 입력해 주세요.', 400);
      return;
    }

    const targetUid = decoded.uid;
    const payload = await purgeUserAccountAndData(admin, targetUid);
    res.status(200).json(payload);
  } catch (err) {
    console.error("[deleteUserAccount]", err);
    sendError(err.code || "internal", err.message || "계정 삭제 실패", 500);
  }
}

module.exports = {
  purgeUserAccountAndData,
  handleDeleteUserAccountHttp,
};
