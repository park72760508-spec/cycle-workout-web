/**
 * Firebase Auth → Supabase Auth Bridge (RS256 Custom JWT)
 *
 * Legacy HS256(JWT Secret) 미사용 — Supabase JWT Signing Keys(RS256)와 페어링.
 *
 * Secrets / Params:
 *   SUPABASE_CUSTOM_PRIVATE_KEY — RSA PEM (BEGIN ... PRIVATE KEY)
 *   SUPABASE_JWT_KEY_ID         — JWT header `kid` (Dashboard 등록값과 동일)
 *   SUPABASE_URL                — iss = {url}/auth/v1
 *   STELVIO_UID_NAMESPACE       — UUID v5 namespace (마이그레이션 동일)
 *   FIREBASE_UID_UUID_MODE      — v5 | literal
 */
const jwt = require("jsonwebtoken");
const { v4: uuidv4, v5: uuidv5 } = require("uuid");
const { defineSecret, defineString } = require("firebase-functions/params");

const supabaseCustomPrivateKey = defineSecret("SUPABASE_CUSTOM_PRIVATE_KEY");
const jwtKeyIdParam = defineString("SUPABASE_JWT_KEY_ID", {
  description: "JWT kid — Supabase Dashboard JWT Signing Keys 등록 kid와 일치",
});
const supabaseUrlParam = defineString("SUPABASE_URL", {
  description: "Supabase project URL (iss claim)",
});
const uidNamespaceParam = defineString("STELVIO_UID_NAMESPACE", {
  default: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
});
const uidModeParam = defineString("FIREBASE_UID_UUID_MODE", {
  default: "v5",
});

const JWT_ALGORITHM = "RS256";

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
 * Secret Manager에 저장된 PEM 정규화 (한 줄 \\n → 실제 줄바꿈)
 * @param {string} raw
 */
function normalizePrivateKeyPem(raw) {
  let pem = String(raw || "").trim();
  if (!pem) {
    throw Object.assign(new Error("Empty private key"), { code: "missing-key" });
  }
  if (pem.includes("\\n")) {
    pem = pem.replace(/\\n/g, "\n");
  }
  if (
    !pem.includes("BEGIN RSA PRIVATE KEY") &&
    !pem.includes("BEGIN PRIVATE KEY")
  ) {
    throw Object.assign(new Error("Invalid PEM format"), { code: "invalid-pem" });
  }
  return pem;
}

/**
 * @param {object} p
 * @param {string} p.sub
 * @param {string} [p.email]
 * @param {string} p.privateKeyPem
 * @param {string} p.kid
 * @param {string} p.iss
 * @param {number} p.expiresInSec
 * @param {string} [p.sessionId]
 */
function mintSupabaseJwtRs256(p) {
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

  return jwt.sign(payload, p.privateKeyPem, {
    algorithm: JWT_ALGORITHM,
    header: {
      alg: JWT_ALGORITHM,
      typ: "JWT",
      kid: p.kid,
    },
  });
}

/**
 * @param {import('firebase-admin').auth.DecodedIdToken} decoded
 * @param {string} uidNamespace
 * @param {"v5"|"literal"} uidMode
 * @param {string} privateKeyPem
 * @param {string} kid
 * @param {string} iss
 */
function mintSessionTokens(decoded, uidNamespace, uidMode, privateKeyPem, kid, iss) {
  const firebaseUid = decoded.uid;
  const sub = resolveUserUuid(firebaseUid, uidNamespace, uidMode);
  if (!sub) {
    throw Object.assign(new Error("Invalid Firebase UID"), { code: "invalid-uid" });
  }

  const sessionId = uuidv4();
  const email =
    (typeof decoded.email === "string" && decoded.email) ||
    (decoded.firebase &&
      decoded.firebase.identities &&
      decoded.firebase.identities.email &&
      decoded.firebase.identities.email[0]) ||
    undefined;

  const signOpts = {
    sub,
    email,
    privateKeyPem,
    kid,
    iss,
    sessionId,
  };

  const access_token = mintSupabaseJwtRs256({
    ...signOpts,
    expiresInSec: DEFAULT_ACCESS_TTL_SEC,
  });

  const refresh_token = mintSupabaseJwtRs256({
    ...signOpts,
    expiresInSec: DEFAULT_REFRESH_TTL_SEC,
  });

  return {
    access_token,
    refresh_token,
    token_type: "bearer",
    expires_in: DEFAULT_ACCESS_TTL_SEC,
    signing_algorithm: JWT_ALGORITHM,
    jwt_kid: kid,
    supabase_user_id: sub,
    firebase_uid: firebaseUid,
  };
}

/**
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

    let privateKeyPem;
    try {
      privateKeyPem = normalizePrivateKeyPem(
        supabaseCustomPrivateKey.value()
      );
    } catch (e) {
      console.error("[mintSupabaseSession] private key:", e.message);
      sendError(
        "failed-precondition",
        "SUPABASE_CUSTOM_PRIVATE_KEY가 설정되지 않았거나 PEM 형식이 아닙니다.",
        503
      );
      return;
    }

    const kid = String(jwtKeyIdParam.value() || "").trim();
    if (!kid) {
      console.error("[mintSupabaseSession] SUPABASE_JWT_KEY_ID missing");
      sendError(
        "failed-precondition",
        "SUPABASE_JWT_KEY_ID 파라미터가 필요합니다 (JWT kid).",
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
      privateKeyPem,
      kid,
      iss
    );

    res.status(200).json({ success: true, session });
  } catch (err) {
    console.error("[mintSupabaseSession] error:", err);
    if (err && err.code === "invalid-uid") {
      sendError("invalid-argument", "Firebase UID를 Supabase UUID로 변환할 수 없습니다.");
      return;
    }
    if (err && err.code === "invalid-pem") {
      sendError("failed-precondition", "Private Key PEM 형식 오류.", 503);
      return;
    }
    sendError("internal", "Supabase 세션 발급에 실패했습니다.", 500);
  }
}

module.exports = {
  supabaseCustomPrivateKey,
  jwtKeyIdParam,
  supabaseUrlParam,
  uidNamespaceParam,
  uidModeParam,
  JWT_ALGORITHM,
  resolveUserUuid,
  normalizePrivateKeyPem,
  mintSupabaseJwtRs256,
  mintSessionTokens,
  handleMintSupabaseSession,
  DEFAULT_ACCESS_TTL_SEC,
};
