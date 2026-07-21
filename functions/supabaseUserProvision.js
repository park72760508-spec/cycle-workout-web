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
  const allowed = [
    "Fitness", "GranFondo", "IronMan", "Racing", "Elite", "PRO",
    "PR", "MastersRace", "CityRunner", "Challenger", "Sub3Club",
  ];
  if (s && allowed.includes(s)) return s;
  return "Fitness";
}

function mapSportCategory(raw) {
  const s = str(raw)?.toUpperCase()?.replace(/\s+/g, "");
  if (s === "RUN") return "RUN";
  if (s === "CYCLE+RUN" || s === "CYCLE_RUN" || s === "CYCLERUN") return "CYCLE_RUN";
  return "CYCLE";
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

function mapRankingFavoriteUserIds(raw) {
  const src = Array.isArray(raw?.rankingFavoriteUserIds)
    ? raw.rankingFavoriteUserIds
    : Array.isArray(raw?.starredUsers)
      ? raw.starredUsers
      : Array.isArray(raw)
        ? raw
        : [];
  const out = [];
  const seen = new Set();
  for (const item of src) {
    const id = String(item || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 500) break;
  }
  return out;
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
    firebase_uid: firebaseUid,
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
    run_challenge: d.run_challenge != null ? mapChallenge(d.run_challenge) : null,
    sport_category: mapSportCategory(d.category ?? d.sport_category),
    grade: mapGrade(d.grade),
    account_status: mapAccountStatus(d.account_status),
    // rankingEligibility.isRankingEligibleUserData()를 Supabase 쪽에서도 재현하기 위한 원본 미러
    // (account_status enum만으로는 is_active===false·레거시 status를 표현할 수 없음)
    is_active: d.is_active === false ? false : true,
    legacy_status: str(d.status),
    expiry_date: toDateOnly(d.expiry_date ?? d.subscription_end_date),
    acc_points: int(d.acc_points, 0),
    rem_points: int(d.rem_points, 0),
    last_training_date: toDateOnly(d.last_training_date),
    is_private: Boolean(d.is_private),
    profile_image_url: str(d.profileImageUrl) ?? str(d.profile_image_url),
    max_hr: int(d.max_hr ?? d.maxHr, 0) || null,
    ranking_favorite_user_ids: mapRankingFavoriteUserIds(d),
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

/** PostgREST PGRST204 메시지에서 없는 컬럼명 추출. 예: "Could not find the 'x' column of 'users' ..." */
function parseMissingColumnFromPgrstError(message) {
  const m = /find the '([^']+)' column/i.exec(String(message || ""));
  return m ? m[1] : null;
}

async function upsertPublicUser(supabase, row) {
  // 스키마 드리프트 대비: 특정 컬럼이 Supabase에 아직 없거나 PostgREST 스키마 캐시가 오래되어
  // PGRST204("...column ... in the schema cache")가 나면, 그 컬럼만 제외하고 재시도한다.
  // 미지의 컬럼 하나 때문에 전체 upsert(핵심 필드 is_private·gender·name 등)가 막히는 것을 방지.
  const payload = { ...row };
  const droppedColumns = [];
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await supabase.from("users").upsert(payload, {
      onConflict: "id",
      ignoreDuplicates: false,
    });
    if (!error) {
      return droppedColumns.length
        ? { action: "upserted", droppedColumns }
        : { action: "upserted" };
    }
    lastError = error;
    const missingCol =
      error && error.code === "PGRST204"
        ? parseMissingColumnFromPgrstError(error.message)
        : null;
    if (!missingCol || !(missingCol in payload)) break;
    delete payload[missingCol];
    droppedColumns.push(missingCol);
    console.warn("[upsertPublicUser] Supabase users 컬럼 미존재 → 제외 후 재시도:", missingCol);
  }
  throw lastError;
}

/**
 * Firestore users/{uid} 기준 Supabase 사용자 프로비저닝.
 * @param {import('firebase-admin')} admin
 * @param {string} firebaseUid
 */
function getUidConfigFromParams() {
  return {
    uidNamespace: supabaseDualWriteServer.uidNamespaceParam.value(),
    uidMode:
      String(supabaseDualWriteServer.uidModeParam.value() || "v5").toLowerCase() === "literal"
        ? "literal"
        : "v5",
  };
}

/**
 * Firestore users/{uid} → public.users upsert (가입·프로필 수정·백필 공통).
 * @param {import('firebase-admin')} admin
 * @param {string} firebaseUid
 * @param {{ ensureAuth?: boolean, requireNameContact?: boolean }} [opts]
 */
async function upsertSupabaseUserProfileFromFirestore(admin, firebaseUid, opts = {}) {
  const uid = String(firebaseUid || "").trim();
  if (!uid) {
    throw Object.assign(new Error("firebaseUid required"), { code: "invalid-uid" });
  }

  const snap = await admin.firestore().collection("users").doc(uid).get();
  if (!snap.exists) {
    throw Object.assign(new Error("Firestore users 문서 없음"), { code: "firestore-missing" });
  }

  const uidConfig = getUidConfigFromParams();
  const row = mapFirestoreUserToRow(uid, snap.data() || {}, uidConfig);
  if (!row) {
    throw Object.assign(new Error("Supabase UUID 변환 실패"), { code: "invalid-uid" });
  }

  const requireNameContact = opts.requireNameContact !== false;
  if (requireNameContact && (!str(row.name) || !row.contact)) {
    throw Object.assign(new Error("프로필 필수값(이름·연락처) 미완료"), {
      code: "profile-incomplete",
    });
  }

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  let authResult = { action: "skipped", reason: "ensureAuth=false" };
  if (opts.ensureAuth !== false) {
    authResult = await ensureSupabaseAuthUser(
      supabase,
      admin,
      uid,
      row.id,
      snap.data() || {}
    );
  }
  const profileResult = await upsertPublicUser(supabase, row);

  return {
    success: true,
    firebaseUid: uid,
    supabaseUserId: row.id,
    gender: row.gender,
    auth: authResult,
    profile: profileResult,
  };
}

async function provisionSupabaseUserAfterProfile(admin, firebaseUid) {
  return upsertSupabaseUserProfileFromFirestore(admin, firebaseUid, {
    ensureAuth: true,
    requireNameContact: true,
  });
}

/**
 * Firestore의 랭킹 공개용 프로필 필드(gender/sex, is_private, 프로필 이미지)를
 * Supabase users에 경량 동기화한다. 기존에 비공개로 설정된 사용자가 트리거 배포 이전이라
 * Supabase에 반영되지 못한 경우를 백필로 정정하기 위함.
 */
async function syncSupabaseUserGenderFromFirestore(admin, firebaseUid) {
  const uid = String(firebaseUid || "").trim();
  if (!uid) return { skipped: true, reason: "invalid-uid" };

  const snap = await admin.firestore().collection("users").doc(uid).get();
  if (!snap.exists) return { skipped: true, reason: "firestore-missing" };

  const uidConfig = getUidConfigFromParams();
  const row = mapFirestoreUserToRow(uid, snap.data() || {}, uidConfig);
  if (!row) return { skipped: true, reason: "invalid-uuid" };

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { data: existing, error: readErr } = await supabase
    .from("users")
    .select("id, gender, is_private, profile_image_url")
    .eq("id", row.id)
    .maybeSingle();
  if (readErr) throw readErr;

  if (!existing) {
    const full = await upsertSupabaseUserProfileFromFirestore(admin, uid, {
      ensureAuth: true,
      requireNameContact: false,
    });
    return {
      action: "upserted_full",
      firebaseUid: uid,
      gender: full.gender,
      previousGender: null,
    };
  }

  const nextIsPrivate = row.is_private === true;
  const nextProfileImageUrl = row.profile_image_url || null;
  const genderChanged = existing.gender !== row.gender;
  const privacyChanged = Boolean(existing.is_private) !== nextIsPrivate;
  const profileImageChanged = (existing.profile_image_url || null) !== nextProfileImageUrl;

  if (!genderChanged && !privacyChanged && !profileImageChanged) {
    return {
      action: "unchanged",
      firebaseUid: uid,
      gender: row.gender,
      previousGender: existing.gender,
      isPrivate: nextIsPrivate,
    };
  }

  const { error: updErr } = await supabase
    .from("users")
    .update({
      gender: row.gender,
      is_private: nextIsPrivate,
      profile_image_url: nextProfileImageUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (updErr) throw updErr;

  return {
    action: "updated",
    firebaseUid: uid,
    gender: row.gender,
    previousGender: existing.gender,
    isPrivate: nextIsPrivate,
    previousIsPrivate: Boolean(existing.is_private),
  };
}

/**
 * @param {import('firebase-admin')} admin
 * @param {{ startAfterUid?: string, maxUsers?: number, dryRun?: boolean }} [opts]
 */
async function backfillSupabaseUserGenderFromFirestore(admin, opts = {}) {
  const db = admin.firestore();
  const startAfterUid = String(opts.startAfterUid || "").trim();
  const maxUsers = Math.max(1, Math.min(5000, Number(opts.maxUsers) || 500));
  const dryRun = opts.dryRun === true;

  let query = db.collection("users").orderBy(admin.firestore.FieldPath.documentId()).limit(maxUsers);
  if (startAfterUid) query = query.startAfter(startAfterUid);

  const snap = await query.get();
  const stats = {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    upsertedFull: 0,
    skipped: 0,
    male: 0,
    female: 0,
    unknown: 0,
    errors: [],
    lastUid: "",
    dryRun,
  };

  for (const doc of snap.docs) {
    stats.scanned += 1;
    stats.lastUid = doc.id;
    const mapped = mapGender((doc.data() || {}).gender ?? (doc.data() || {}).sex);
    if (mapped === "male") stats.male += 1;
    else if (mapped === "female") stats.female += 1;
    else stats.unknown += 1;

    if (dryRun) continue;

    try {
      const result = await syncSupabaseUserGenderFromFirestore(admin, doc.id);
      if (result.action === "updated") stats.updated += 1;
      else if (result.action === "upserted_full") stats.upsertedFull += 1;
      else if (result.action === "unchanged") stats.unchanged += 1;
      else stats.skipped += 1;
    } catch (err) {
      stats.errors.push({
        userId: doc.id,
        message: err && err.message ? err.message : String(err),
      });
    }
  }

  stats.hasMore = snap.size >= maxUsers;
  return stats;
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
  mapGender,
  mapFirestoreUserToRow,
  provisionSupabaseUserAfterProfile,
  upsertSupabaseUserProfileFromFirestore,
  syncSupabaseUserGenderFromFirestore,
  backfillSupabaseUserGenderFromFirestore,
  handleProvisionSupabaseUserAfterProfile,
};
