/**
 * Firebase Auth → Supabase Auth Bridge (Custom JWT minting)
 *
 * 배포 전 Secret / 환경 변수:
 *   SUPABASE_JWT_SECRET  — Dashboard → Settings → API → JWT Secret (Legacy)
 *   SUPABASE_URL         — https://<project-ref>.supabase.co
 *   STELVIO_UID_NAMESPACE — 마이그레이션과 동일 (기본 DNS namespace UUID)
 *   FIREBASE_UID_UUID_MODE — v5 | literal (기본 v5)
 *
 * firebase functions:secrets:set SUPABASE_JWT_SECRET
 * firebase functions:config:set (또는 .env) SUPABASE_URL=...
 */
const jwt = require("jsonwebtoken");
const { v4: uuidv4, v5: uuidv5 } = require("uuid");
const { defineSecret, defineString } = require("firebase-functions/params");

const supabaseJwtSecret = defineSecret("SUPABASE_JWT_SECRET");
const supabaseUrlParam = defineString("SUPABASE_URL", {
  description: "Supabase project URL (iss claim)",
});
const uidNamespaceParam = defineString("STELVIO_UID_NAMESPACE", {
  default: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
});
const uidModeParam = defineString("FIREBASE_UID_UUID_MODE", {
  default: "v5",
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_ACCESS_TTL_SEC = 3600;
const DEFAULT_REFRESH_TTL_SEC = 60 * 60 * 24 * 7;

function isUuidString(value) {
  return UUID_RE.test(String(value || ""));
}

/**
 * @param {string} firebaseUid
 * @param {string} uidNamespace
 * @param {"v5"|"literal"} uidMode
 */
function resolveUserUuid(firebaseUid, uidNamespace, uidMode) {
  const raw = String(firebaseUid || "").trim();
  if (!raw) return null;
  if (uidMode === "literal" || isUuidString(raw)) {
    return raw.toLowerCase();
  }
  return uuidv5(raw, uidNamespace);
}

/**
 * @param {string} supabaseUrl
 */
function buildSupabaseIssuer(supabaseUrl) {
  const base = String(supabaseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) {
    throw new Error("SUPABASE_URL is required");
  }
  return `${base}/auth/v1`;
}

/**
 * @param {object} p
 * @param {string} p.sub
 * @param {string} p.email
 * @param {string} p.jwtSecret
 * @param {string} p.iss
 * @param {number} p.expiresInSec
 * @param {string} [p.sessionId]
 */
function mintSupabaseJwt(p) {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = p.sessionId || uuidv4();
  /** @type {Record<string, unknown>} */
  const payload = {
    sub: p.sub,
    role: "authenticated",
    aud: "authenticated",
    iss: p.iss,
    iat: now,
    exp: now + p.expiresInSec,
    session_id: sessionId,
    aal: "aal1",
    is_anonymous: false,
  };
  if (p.email) {
    payload.email = p.email;
  }
  return jwt.sign(payload, p.jwtSecret, { algorithm: "HS256" });
}

/**
 * @param {import('firebase-admin').auth.DecodedIdToken} decoded
 * @param {string} uidNamespace
 * @param {"v5"|"literal"} uidMode
 * @param {string} jwtSecret
 * @param {string} iss
 */
function mintSessionTokens(decoded, uidNamespace, uidMode, jwtSecret, iss) {
  const firebaseUid = decoded.uid;
  const sub = resolveUserUuid(firebaseUid, uidNamespace, uidMode);
  if (!sub) {
    throw Object.assign(new Error("Invalid Firebase UID"), { code: "invalid-uid" });
  }

  const sessionId = uuidv4();
  const email =
    (typeof decoded.email === "string" && decoded.email) ||
    (decoded.firebase && decoded.firebase.identities && decoded.firebase.identities.email && decoded.firebase.identities.email[0]) ||
    undefined;

  const access_token = mintSupabaseJwt({
    sub,
    email,
    jwtSecret,
    iss,
    expiresInSec: DEFAULT_ACCESS_TTL_SEC,
    sessionId,
  });

  const refresh_token = mintSupabaseJwt({
    sub,
    email,
    jwtSecret,
    iss,
    expiresInSec: DEFAULT_REFRESH_TTL_SEC,
    sessionId,
  });

  return {
    access_token,
    refresh_token,
    token_type: "bearer",
    expires_in: DEFAULT_ACCESS_TTL_SEC,
    supabase_user_id: sub,
    firebase_uid: firebaseUid,
  };
}

/**
 * HTTP handler — Authorization: Bearer <Firebase ID Token>
 * @param {import('firebase-functions/v2/https').Request} req
 * @param {import('firebase-functions/v2/https').Response} res
 * @param {import('firebase-admin')} admin
 * @param {(req: import('firebase-functions/v2/https').Request, res: import('firebase-functions/v2/https').Response) => void} setCorsHeaders
 */
async function handleMintSupabaseSession(req, res, admin, setCorsHeaders) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({
      error: { code: "method-not-allowed", message: "POST만 허용됩니다." },
    });
    return;
  }

  const sendError = (code, message, status = 400) => {
    res.status(status).json({ error: { code, message } });
  };

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      sendError(
        "unauthenticated",
        "Firebase ID 토큰이 필요합니다 (Authorization: Bearer).",
        401
      );
      return;
    }

    const idToken = authHeader.slice("Bearer ".length).trim();
    if (!idToken) {
      sendError("unauthenticated", "Firebase ID 토큰이 비어 있습니다.", 401);
      return;
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken, true);
    } catch (e) {
      console.warn("[mintSupabaseSession] verifyIdToken failed:", e.message);
      sendError(
        "unauthenticated",
        "Firebase ID 토큰이 유효하지 않거나 만료되었습니다.",
        401
      );
      return;
    }

    const jwtSecret = supabaseJwtSecret.value();
    if (!jwtSecret || !String(jwtSecret).trim()) {
      console.error("[mintSupabaseSession] SUPABASE_JWT_SECRET not configured");
      sendError(
        "failed-precondition",
        "서버 JWT 설정이 완료되지 않았습니다.",
        503
      );
      return;
    }

    const supabaseUrl = supabaseUrlParam.value();
    const uidNamespace = uidNamespaceParam.value();
    const uidMode =
      String(uidModeParam.value() || "v5").toLowerCase() === "literal"
        ? "literal"
        : "v5";

    const iss = buildSupabaseIssuer(supabaseUrl);
    const session = mintSessionTokens(
      decoded,
      uidNamespace,
      uidMode,
      String(jwtSecret).trim(),
      iss
    );

    res.status(200).json({ success: true, session });
  } catch (err) {
    console.error("[mintSupabaseSession] error:", err);
    if (err && err.code === "invalid-uid") {
      sendError("invalid-argument", "Firebase UID를 Supabase UUID로 변환할 수 없습니다.");
      return;
    }
    sendError("internal", "Supabase 세션 발급에 실패했습니다.", 500);
  }
}

module.exports = {
  supabaseJwtSecret,
  supabaseUrlParam,
  uidNamespaceParam,
  uidModeParam,
  resolveUserUuid,
  mintSessionTokens,
  handleMintSupabaseSession,
  DEFAULT_ACCESS_TTL_SEC,
};
