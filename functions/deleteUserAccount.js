/**
 * 계정 및 연동 개인정보 영구 삭제 (앱 스토어·개인정보보호법 대응)
 * Firebase Auth · Firestore users · Supabase(auth+public) · 프로필 Storage
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

async function deleteFirestoreUserTree(db, firebaseUid) {
  const userRef = db.collection("users").doc(firebaseUid);
  const userSnap = await userRef.get();
  let phoneDigits = "";
  if (userSnap.exists) {
    const data = userSnap.data() || {};
    phoneDigits = digitsOnly(data.contact || data.phone || data.phoneNumber || "");
  }

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
  } else if (userSnap.exists) {
    await userRef.delete();
  }

  if (phoneDigits) {
    try {
      await db.collection("login_account_flags").doc(phoneDigits).delete();
    } catch (eFlag) {
      console.warn("[deleteUserAccount] login_account_flags 삭제 스킵:", eFlag.message || eFlag);
    }
  }

  return { firestoreUserDeleted: true, subDocsDeleted: subDeleted, phoneDigits };
}

async function deleteSupabaseUser(firebaseUid) {
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

  try {
    const { error } = await supabase.auth.admin.deleteUser(supabaseUserId);
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("not found") || msg.includes("User not found")) {
        const { error: delErr } = await supabase.from("users").delete().eq("id", supabaseUserId);
        if (!delErr) {
          result.deleted = true;
          result.method = "public_users_only";
          return result;
        }
      }
      throw error;
    }
    result.deleted = true;
    result.method = "auth_admin_cascade";
    return result;
  } catch (e) {
    console.warn("[deleteUserAccount] Supabase 삭제:", e.message || e);
    result.error = e.message || String(e);
    return result;
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
  const firestoreResult = await deleteFirestoreUserTree(db, uid);
  const supabaseResult = await deleteSupabaseUser(uid);
  const storageResult = await deleteProfileStorage(admin, uid);

  try {
    await admin.auth().deleteUser(uid);
  } catch (eAuth) {
    const code = eAuth && eAuth.code ? String(eAuth.code) : "";
    if (code !== "auth/user-not-found") {
      throw eAuth;
    }
  }

  return {
    success: true,
    firebaseUid: uid,
    firestore: firestoreResult,
    supabase: supabaseResult,
    storage: storageResult,
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
