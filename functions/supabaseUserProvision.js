/**
 * 프로필 입력 완료 후 Supabase auth.users + public.users 생성·갱신 (Service Role).
 * Firebase Auth / Firestore users 가 Primary.
 */
const { randomBytes } = require("node:crypto");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v, fallback = null) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v, fallback = 0) {
  const n = num(v, fallback);
  return n == null ? fallback : Math.trunc(n);
}

function toTimestamptz(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && raw !== null && typeof raw.toDate === "function") {
    return raw.toDate().toISOString();
  }
  if (typeof raw === "object" && raw !== null && raw._seconds != null) {
    return new Date(raw._seconds * 1000).toISOString();
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDateOnly(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const t = toTimestamptz(raw);
  return t ? t.slice(0, 10) : null;
}

function mapGender(raw) {
  const s = str(raw)?.toLowerCase() ?? "";
  if (["m", "male", "남", "남성"].includes(s)) return "male";
  if (["f", "female", "여", "여성"].includes(s)) return "female";
  return "unknown";
}

function mapChallenge(raw) {
  const s = str(raw);
  const allowed = ["Fitness", "GranFondo", "Racing", "Elite", "PRO"];
  if (s && allowed.includes(s)) return s;
  return "Fitness";
}

function mapGrade(raw) {
  const g = String(raw ?? "2");
  if (g === "1") return "admin";
  if (g === "3") return "sub_admin";
  return "member";
}

function mapAccountStatus(raw) {
  const s = str(raw)?.toLowerCase();
  if (s === "withdrawn") return "withdrawn";
  if (s === "suspended") return "suspended";
  return "active";
}

function syntheticEmail(firebaseUid) {
  return `${firebaseUid}@firebase-migrate.stelvio.local`;
}

function normalizePhone(raw) {
  if (raw == null) return undefined;
  const s = String(raw).replace(/[^\d+]/g, "");
  if (!s) return undefined;
  if (s.startsWith("+")) return s;
  if (s.startsWith("0")) return `+82${s.slice(1)}`;
  return `+${s}`;
}

function pickEmail(authUser, firestore) {
  const fromAuth = authUser?.email?.trim();
  if (fromAuth) return fromAuth;
  const fs = str(firestore?.email) || (str(firestore?.contact)?.includes("@") ? str(firestore.contact) : null);
  return fs || undefined;
}

function pickPhone(authUser, firestore) {
  const fromAuth = authUser?.phoneNumber?.trim();
  if (fromAuth) return normalizePhone(fromAuth);
  return normalizePhone(
    firestore?.phone || firestore?.phoneNumber || firestore?.contact || firestore?.tel
  );
}

function mapFirestoreUserToRow(firebaseUid, d, uidConfig) {
  const id = supabaseDualWriteServer.resolveUserUuid(
    firebaseUid,
    uidConfig.uidNamespace,
    uidConfig.uidMode
  );
  if (!id) return null;

  const weight = num(d.weight) ?? num(d.weightKg) ?? num(d.weight_kg) ?? 0;

  return {
    id,
    name: str(d.name) ?? str(d.displayName) ?? str(d.user_name) ?? "",
    display_name: str(d.displayName) ?? str(d.display_name),
    contact: str(d.contact) ?? str(d.phone) ?? str(d.phoneNumber) ?? str(d.tel),
    phone: str(d.phone) ?? str(d.phoneNumber) ?? str(d.tel),
    email: str(d.email),
    ftp: num(d.ftp) ?? 0,
    ftp_updated_at: toTimestamptz(d.ftp_updated_at),
    weight_kg: weight,
    birth_year: int(d.birth_year ?? d.birthYear, 0) || null,
    gender: mapGender(d.gender ?? d.sex),
    challenge: mapChallenge(d.challenge),
    grade: mapGrade(d.grade),
    account_status: mapAccountStatus(d.account_status),
    expiry_date: toDateOnly(d.expiry_date ?? d.subscription_end_date),
    acc_points: int(d.acc_points, 0),
    rem_points: int(d.rem_points, 0),
    last_training_date: toDateOnly(d.last_training_date),
    is_private: Boolean(d.is_private),
    profile_image_url: str(d.profileImageUrl) ?? str(d.profile_image_url),
    max_hr: int(d.max_hr ?? d.maxHr, 0) || null,
    created_at: toTimestamptz(d.created_at) ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function supabaseAuthUserExists(supabase, supabaseId) {
  const { data, error } = await supabase.auth.admin.getUserById(supabaseId);
  if (error && String(error.message || "").toLowerCase().includes("not found")) {
    return false;
  }
  if (error) {
    throw error;
  }
  return Boolean(data?.user);
}

async function ensureSupabaseAuthUser(supabase, admin, firebaseUid, supabaseId, firestore) {
  if (await supabaseAuthUserExists(supabase, supabaseId)) {
    return { action: "skipped", reason: "auth_exists" };
  }

  let authUser;
  try {
    authUser = await admin.auth().getUser(firebaseUid);
  } catch (e) {
    throw Object.assign(new Error("Firebase Auth 사용자 없음: " + firebaseUid), {
      code: "firebase-auth-missing",
    });
  }

  const email = pickEmail(authUser, firestore) ?? syntheticEmail(firebaseUid);
  const phone = pickPhone(authUser, firestore);
  const displayName =
    str(firestore?.name) || authUser.displayName || str(authUser.email?.split("@")[0]) || "";

  const randomPassword = randomBytes(24).toString("base64url");
  const { error } = await supabase.auth.admin.createUser({
    id: supabaseId,
    email,
    password: randomPassword,
    email_confirm: true,
    phone,
    phone_confirm: phone ? true : undefined,
    user_metadata: {
      firebase_uid: firebaseUid,
      display_name: displayName,
      provisioned_from: "profile_complete",
      provisioned_at: new Date().toISOString(),
    },
    app_metadata: {
      provider: "firebase",
      providers: ["firebase"],
    },
  });

  if (error) {
    const msg = String(error.message || "");
    if (
      msg.includes("already been registered") ||
      msg.includes("already exists") ||
      msg.includes("duplicate")
    ) {
      return { action: "skipped", reason: "auth_exists_race" };
    }
    throw error;
  }

  return { action: "created" };
}

async function upsertPublicUser(supabase, row) {
  const { error } = await supabase.from("users").upsert(row, {
    onConflict: "id",
    ignoreDuplicates: false,
  });
  if (error) throw error;
  return { action: "upserted" };
}

/**
 * Firestore users/{uid} 기준 Supabase 사용자 프로비저닝.
 * @param {import('firebase-admin')} admin
 * @param {string} firebaseUid
 */
async function provisionSupabaseUserAfterProfile(admin, firebaseUid) {
  const uid = String(firebaseUid || "").trim();
  if (!uid) {
    throw Object.assign(new Error("firebaseUid required"), { code: "invalid-uid" });
  }

  const snap = await admin.firestore().collection("users").doc(uid).get();
  if (!snap.exists) {
    throw Object.assign(new Error("Firestore users 문서 없음"), { code: "firestore-missing" });
  }

  const uidConfig = {
    uidNamespace: supabaseDualWriteServer.uidNamespaceParam.value(),
    uidMode:
      String(supabaseDualWriteServer.uidModeParam.value() || "v5").toLowerCase() === "literal"
        ? "literal"
        : "v5",
  };

  const row = mapFirestoreUserToRow(uid, snap.data() || {}, uidConfig);
  if (!row) {
    throw Object.assign(new Error("Supabase UUID 변환 실패"), { code: "invalid-uid" });
  }

  if (!str(row.name) || !row.contact) {
    throw Object.assign(new Error("프로필 필수값(이름·연락처) 미완료"), {
      code: "profile-incomplete",
    });
  }

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const authResult = await ensureSupabaseAuthUser(
    supabase,
    admin,
    uid,
    row.id,
    snap.data() || {}
  );
  const profileResult = await upsertPublicUser(supabase, row);

  return {
    success: true,
    firebaseUid: uid,
    supabaseUserId: row.id,
    auth: authResult,
    profile: profileResult,
  };
}

/**
 * @param {import('firebase-functions/v2/https').Request} req
 * @param {import('firebase-functions/v2/https').Response} res
 * @param {import('firebase-admin')} admin
 * @param {(req: import('firebase-functions/v2/https').Request, res: import('firebase-functions/v2/https').Response) => void} setCorsHeaders
 */
async function handleProvisionSupabaseUserAfterProfile(req, res, admin, setCorsHeaders) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "POST만 지원합니다." });
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

    const payload = await provisionSupabaseUserAfterProfile(admin, decoded.uid);
    res.status(200).json(payload);
  } catch (err) {
    console.warn("[provisionSupabaseUserAfterProfile]", err.message || err);
    const code = err && err.code ? err.code : "internal";
    if (code === "profile-incomplete") {
      sendError(code, err.message, 400);
      return;
    }
    if (code === "firestore-missing") {
      sendError(code, err.message, 404);
      return;
    }
    if (String(err.message || "").includes("SUPABASE_URL")) {
      sendError("failed-precondition", err.message, 503);
      return;
    }
    sendError(code, err.message || "프로비저닝 실패", 500);
  }
}

module.exports = {
  mapFirestoreUserToRow,
  provisionSupabaseUserAfterProfile,
  handleProvisionSupabaseUserAfterProfile,
};
