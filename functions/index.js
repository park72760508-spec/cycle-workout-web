/**
 * 관리자 비밀번호 초기화 Callable Function (v2)
 * Strava 토큰 교환/갱신 Callable (v2) - Client Secret은 서버에서만 사용
 * Strava 전날 로그 동기화 스케줄 함수 (Firebase 기반, 매일 새벽 2시 Asia/Seoul)
 */
const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
/** v1 전용(runWith · firestore.document). v7 패키지 루트는 v2라 runWith 미제공 → /v1 필요 */
const functions = require("firebase-functions/v1");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

// Secret Manager에서 STRAVA_CLIENT_SECRET 읽기
// 임시: Secret 설정 문제로 인해 하드코딩된 값 사용 (보안상 권장하지 않음, 나중에 Secret으로 변경 필요)
const STRAVA_CLIENT_SECRET_VALUE = "6cd67a28f1c516c0f004f1c7f97f4d74be187d85";

// Secret 사용 시도 (실패하면 하드코딩된 값 사용)
let STRAVA_CLIENT_SECRET;
try {
  STRAVA_CLIENT_SECRET = defineSecret("STRAVA_CLIENT_SECRET");
} catch (e) {
  console.warn("[Functions] Secret 정의 실패, 하드코딩된 값 사용:", e.message);
  STRAVA_CLIENT_SECRET = null; // Secret 없음
}

/** 알리고 카카오 API — Secret Manager. 이 키를 읽으려면 각 함수 옵션에 `secrets`로 연결해야 함 (v2). */
const aligoApiKeySecret = defineSecret("ALIGO_API_KEY");
const aligoUserIdSecret = defineSecret("ALIGO_USER_ID");
const aligoTokenSecret = defineSecret("ALIGO_TOKEN");

if (!admin.apps.length) {
  admin.initializeApp();
}

const rankingDayRollup = require("./rankingDayRollup");

/** Firestore users 문서의 프로필 사진 URL (랭킹·클라이언트 표시용, 없으면 null) */
function profileImageUrlFromUserData(data) {
  if (!data || typeof data !== "object") return null;
  const v = data.profileImageUrl;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** uid 목록으로 users 문서 배치 조회 → profileImageUrl 맵 (랭킹 스냅샷·집계 행 보강용) */
async function fetchProfileImageUrlsMapForUsers(db, userIds) {
  const urlById = new Map();
  const unique = [...new Set((userIds || []).map((x) => String(x).trim()).filter(Boolean))];
  /** Firestore getAll은 한 번에 최대 10문서 — RTT·연결 수를 줄이기 위해 10묶음 병렬 여러 개 */
  const CHUNK = 10;
  const PARALLEL_GROUPS = Math.min(
    Math.max(1, Number(process.env.RANK_PROFILE_IMAGE_GETALL_PARALLEL) || 6),
    12
  );
  for (let i = 0; i < unique.length; i += CHUNK * PARALLEL_GROUPS) {
    const wave = [];
    for (let g = 0; g < PARALLEL_GROUPS && i + g * CHUNK < unique.length; g++) {
      const slice = unique.slice(i + g * CHUNK, i + (g + 1) * CHUNK);
      if (!slice.length) break;
      const refs = slice.map((id) => db.collection("users").doc(id));
      wave.push(
        db.getAll(...refs).then((snaps) => ({ slice, snaps }))
      );
    }
    const settled = await Promise.all(wave);
    for (let w = 0; w < settled.length; w++) {
      const { slice, snaps } = settled[w];
      for (let j = 0; j < slice.length; j++) {
        const id = slice[j];
        const docSnap = snaps[j];
        if (docSnap && docSnap.exists) urlById.set(id, profileImageUrlFromUserData(docSnap.data()));
        else urlById.set(id, null);
      }
    }
  }
  return urlById;
}

/**
 * users·heptagon_cohort_ranks 등 문서에서 비공개 동의어를 통일 (집계 캐시 스냅샷에 플래그가 누락·구형인 경우 대비)
 */
function privacyFlagFromFirestoreDoc(data) {
  if (!data || typeof data !== "object") return false;
  const v =
    data.is_private !== undefined && data.is_private !== null
      ? data.is_private
      : data.isPrivate;
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * 집계본/캐시 행에 최신 users.is_private 반영 (TSS·거리·피크 탭이 GC 대비 스냅샷을 쓰는 경로에서 비공개가 풀리는 문제 방지)
 */
async function hydrateRankingBoardPrivacyFromUsers(db, byCategory, entries) {
  if (!byCategory || typeof byCategory !== "object" || !db) return;
  const idSet = new Set();
  const addFromRow = (r) => {
    if (r && r.userId != null) idSet.add(String(r.userId).trim());
  };
  for (const k of Object.keys(byCategory)) {
    const rows = byCategory[k];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) addFromRow(r);
  }
  if (Array.isArray(entries)) {
    for (const r of entries) addFromRow(r);
  }
  const ids = [...idSet].filter((x) => x.length > 0);
  if (!ids.length) return;

  const privMap = new Map();
  const FieldPath = admin.firestore.FieldPath;
  const CHUNK = 30;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    chunk.forEach((id) => privMap.set(id, false));
    try {
      const qSnap = await db.collection("users").where(FieldPath.documentId(), "in", chunk).get();
      qSnap.forEach((doc) => {
        privMap.set(doc.id, privacyFlagFromFirestoreDoc(doc.data()));
      });
    } catch (e) {
      console.warn("[hydrateRankingBoardPrivacyFromUsers]", e && e.message ? e.message : e);
    }
  }

  const apply = (r) => {
    if (!r || r.userId == null) return;
    const id = String(r.userId).trim();
    if (!privMap.has(id)) return;
    r.is_private = privMap.get(id);
  };
  for (const k of Object.keys(byCategory)) {
    const rows = byCategory[k];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) apply(r);
  }
  if (Array.isArray(entries)) {
    for (const r of entries) apply(r);
  }
}

/**
 * 랭킹 응답의 byCategory(및 선택적 entries)에 users.profileImageUrl 최신값 반영.
 * 집계 캐시(ranking_aggregates 등)에는 필드가 없거나 오래된 경우가 있어 GC와 동일하게 HTTP 응답 직전에 보강.
 */
async function hydrateRankingBoardProfileImages(db, byCategory, entries) {
  if (!byCategory || typeof byCategory !== "object") return;
  const ids = [];
  const pushIfNeedsHydration = (r) => {
    if (!r || !r.userId) return;
    const u = String(r.userId);
    const cur = r.profileImageUrl;
    if (typeof cur === "string" && cur.trim().length > 0) return;
    ids.push(u);
  };
  for (const k of Object.keys(byCategory)) {
    const rows = byCategory[k];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) pushIfNeedsHydration(r);
  }
  if (Array.isArray(entries)) {
    for (const r of entries) pushIfNeedsHydration(r);
  }
  if (!ids.length) return;
  const urlMap = await fetchProfileImageUrlsMapForUsers(db, ids);
  const hydratedUids = new Set(ids.map((x) => String(x).trim()).filter(Boolean));
  for (const k of Object.keys(byCategory)) {
    const rows = byCategory[k];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      if (!r || !r.userId) continue;
      const u = String(r.userId);
      if (!hydratedUids.has(u)) continue;
      r.profileImageUrl = urlMap.has(u) ? urlMap.get(u) : null;
    }
  }
  if (Array.isArray(entries)) {
    for (const r of entries) {
      if (!r || !r.userId) continue;
      const u = String(r.userId);
      if (!hydratedUids.has(u)) continue;
      r.profileImageUrl = urlMap.has(u) ? urlMap.get(u) : null;
    }
  }
}

// CORS 설정: Firebase Functions v2 onCall - 허용할 출처 (localhost는 개발/테스트용)
const CORS_ORIGINS = [
  "https://stelvio.ai.kr",
  "https://www.stelvio.ai.kr",
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://localhost:8080",
  "http://127.0.0.1",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5000",
  "http://127.0.0.1:8080",
];

/** 1일 500 이상 TSS: 치팅으로 간주, 합산·포인트 적립 제외 (주간 TOP10, Strava 동기화 공통) */
const TSS_PER_DAY_CHEAT_THRESHOLD = 500;

/** Strava에서 TSS·포인트·FTP·MMP 제외할 활동 타입. Run, Swim, Walk, TrailRun, WeightTraining */
const EXCLUDED_ACTIVITY_TYPES = new Set(["run", "swim", "walk", "trailrun", "weighttraining"]);

/** Strava 로그가 MMP/수집 대상인지. source가 strava가 아니면 true(Stelvio 등).
 *  Strava: Run, Swim, Walk, TrailRun, WeightTraining 제외, 나머지(Ride, VirtualRide 등) 수집 */
function isCyclingForMmp(logData) {
  const source = String(logData.source || "").toLowerCase();
  if (source !== "strava") return true; // Stelvio 등: 항상 수집
  const type = String(logData.activity_type || "").trim().toLowerCase();
  if (!type) return true; // activity_type 없음: 수집 (마이그레이션 전 legacy 포함)
  return !EXCLUDED_ACTIVITY_TYPES.has(type); // Run/Swim/Walk만 제외
}

// CORS 헤더 설정 헬퍼 (preflight 및 실제 응답에 사용)
function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  const allowed = CORS_ORIGINS.some(
    (o) => (typeof o === "string" ? origin === o : o.test(origin))
  );
  if (allowed && origin) {
    res.set("Access-Control-Allow-Origin", origin);
  } else if (CORS_ORIGINS.indexOf("*") !== -1) {
    res.set("Access-Control-Allow-Origin", "*");
  } else if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

// 관리자 비밀번호 초기화: onRequest로 CORS preflight(OPTIONS) 수동 처리 (새 이름으로 배포, 기존 callable과 구분)
exports.adminResetUserPasswordHttp = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: { code: "method-not-allowed", message: "POST만 허용됩니다." } });
      return;
    }

    const sendError = (code, message, status = 400) => {
      res.status(status).json({ error: { code, message } });
    };

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        sendError("unauthenticated", "로그인한 후에만 비밀번호 초기화를 할 수 있습니다.", 401);
        return;
      }
      const idToken = authHeader.split("Bearer ")[1];
      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (e) {
        sendError("unauthenticated", "로그인이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.", 401);
        return;
      }
      const callerUid = decodedToken.uid;

      let body = {};
      try {
        body = typeof req.body === "object" && req.body !== null ? req.body : {};
      } catch (e) {
        sendError("invalid-argument", "요청 본문이 올바르지 않습니다.");
        return;
      }
      const targetUserId = body.targetUserId ? String(body.targetUserId).trim() : null;
      const newPassword = body.newPassword ? String(body.newPassword) : null;

      if (!targetUserId) {
        sendError("invalid-argument", "대상 사용자 ID(targetUserId)가 필요합니다.");
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        sendError("invalid-argument", "새 비밀번호는 6자 이상이어야 합니다.");
        return;
      }

      const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
      if (!callerDoc.exists) {
        sendError("permission-denied", "호출자 정보를 찾을 수 없습니다.", 403);
        return;
      }
      const grade = callerDoc.data().grade;
      const isAdmin = grade === 1 || grade === "1";
      if (!isAdmin) {
        sendError("permission-denied", "관리자(grade=1)만 다른 사용자의 비밀번호를 초기화할 수 있습니다.", 403);
        return;
      }

      const targetUserRef = admin.firestore().collection("users").doc(targetUserId);
      const targetUserSnap = await targetUserRef.get();
      if (!targetUserSnap.exists) {
        sendError("not-found", "대상 사용자 정보를 찾을 수 없습니다. 사용자 목록에서 선택한 계정인지 확인해 주세요.", 404);
        return;
      }
      const targetData = targetUserSnap.data() || {};
      const authUid =
        (targetData.uid && String(targetData.uid).trim()) ||
        (targetData.id && String(targetData.id).trim()) ||
        targetUserId;
      if (!authUid || authUid.length > 128) {
        sendError("invalid-argument", "대상 사용자 ID가 올바르지 않습니다.");
        return;
      }

      let resolvedAuthUid = null;
      try {
        await admin.auth().getUser(authUid);
        resolvedAuthUid = authUid;
      } catch (getUserErr) {
        const code = getUserErr.code || (getUserErr.errorInfo && getUserErr.errorInfo.code);
        if (code === "auth/user-not-found") {
          const email = targetData.email && String(targetData.email).trim();
          if (email) {
            try {
              const userRecord = await admin.auth().getUserByEmail(email);
              resolvedAuthUid = userRecord.uid;
              console.log("[adminResetUserPassword] 이메일로 Auth UID 조회 성공:", { email, uid: resolvedAuthUid });
            } catch (emailErr) {
              console.error("[adminResetUserPassword] getUserByEmail 실패:", emailErr);
              sendError("not-found", "해당 사용자는 Firebase 로그인 계정이 없습니다. 이메일/비밀번호로 가입한 사용자만 비밀번호 초기화가 가능합니다.", 404);
              return;
            }
          } else {
            sendError("not-found", "해당 사용자는 Firebase 로그인 계정이 없습니다. 이메일/비밀번호로 가입한 사용자만 비밀번호 초기화가 가능합니다.", 404);
            return;
          }
        } else {
          console.error("[adminResetUserPassword] getUser 실패:", getUserErr);
          sendError("internal", "대상 사용자 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
          return;
        }
      }

      if (!resolvedAuthUid) {
        sendError("not-found", "대상 사용자를 Firebase Auth에서 찾을 수 없습니다.", 404);
        return;
      }

      console.log("[adminResetUserPassword] 비밀번호 변경 시도:", { targetUserId, resolvedAuthUid });
      await admin.auth().updateUser(resolvedAuthUid, { password: newPassword });
      console.log("[adminResetUserPassword] 비밀번호 변경 완료:", resolvedAuthUid);
      res.status(200).json({ result: { success: true, message: "비밀번호가 초기화되었습니다." } });
    } catch (err) {
      const code = err.code || (err.errorInfo && err.errorInfo.code);
      const rawMessage = (err && err.message) ? String(err.message).trim() : "";
      console.error("[adminResetUserPassword] 오류 code=", code, "message=", rawMessage, "err=", err);

      if (code === "auth/user-not-found") {
        sendError("not-found", "대상 사용자를 Firebase Auth에서 찾을 수 없습니다.", 404);
        return;
      }
      if (code === "auth/weak-password") {
        sendError("invalid-argument", "비밀번호가 너무 약합니다. 6자 이상 입력해 주세요.");
        return;
      }
      if (code === "auth/invalid-uid" || code === "auth/argument-error") {
        sendError("invalid-argument", "대상 사용자 ID가 올바르지 않습니다. 사용자 목록에서 다시 선택해 주세요.");
        return;
      }
      if (code === "auth/operation-not-allowed") {
        sendError("failed-precondition", "비밀번호 변경이 허용되지 않은 로그인 방식입니다.", 412);
        return;
      }

      const userMessage =
        /^internal$/i.test(rawMessage) || !rawMessage
          ? "비밀번호 변경 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
          : rawMessage;
      sendError("internal", userMessage, 500);
    }
  }
);

/** 본인 확인용: 전화번호(contact)·생년(birth_year) 일치 시 이메일/비밀번호 계정 비밀번호만 변경 (로그인 불필요) */
function selfResetDigitsOnly(raw) {
  return String(raw || "").replace(/\D+/g, "");
}
function selfResetFormatContactForDb(digitsRaw) {
  const d = selfResetDigitsOnly(digitsRaw);
  if (!d) return "";
  if (d.length < 7) return d;
  const head = d.slice(0, 3);
  const tail = d.slice(-4);
  const mid = d.slice(head.length, d.length - tail.length);
  return `${head}-${mid}-${tail}`;
}

const SELF_SERVICE_RESET_GENERIC =
  "등록된 정보와 일치하지 않습니다. 전화번호·생년·비밀번호를 다시 확인해 주세요.";

exports.selfServiceResetPasswordHttp = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: { code: "method-not-allowed", message: "POST만 허용됩니다." } });
      return;
    }

    const sendError = (code, message, status = 400) => {
      res.status(status).json({ error: { code, message } });
    };

    try {
      let body = {};
      try {
        const raw = req.body;
        if (typeof raw === "string") {
          try {
            body = JSON.parse(raw) || {};
          } catch (eParse) {
            body = {};
          }
        } else if (typeof raw === "object" && raw !== null) {
          body = raw;
        }
      } catch (e) {
        sendError("invalid-argument", "요청 본문이 올바르지 않습니다.");
        return;
      }

      const contactRaw = body.contact != null ? String(body.contact).trim() : "";
      const birthYearRaw = body.birthYear != null ? String(body.birthYear).trim() : "";
      const newPassword = body.newPassword != null ? String(body.newPassword) : "";
      const newPasswordConfirm = body.newPasswordConfirm != null ? String(body.newPasswordConfirm) : "";

      const phoneDigits = selfResetDigitsOnly(contactRaw);
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        sendError("invalid-argument", "ID(전화번호)를 올바르게 입력해 주세요.");
        return;
      }
      if (!birthYearRaw || !/^\d{4}$/.test(birthYearRaw)) {
        sendError("invalid-argument", "생년(4자리)을 입력해 주세요.");
        return;
      }
      const birthYearNum = parseInt(birthYearRaw, 10);
      if (!Number.isFinite(birthYearNum) || birthYearNum < 1900 || birthYearNum > 2100) {
        sendError("invalid-argument", "생년(4자리)을 올바르게 입력해 주세요.");
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        sendError("invalid-argument", "비밀번호 초기화 번호는 6자 이상이어야 합니다.");
        return;
      }
      if (newPassword !== newPasswordConfirm) {
        sendError("invalid-argument", "비밀번호 초기화 번호와 확인 입력이 일치하지 않습니다.");
        return;
      }

      const db = admin.firestore();
      const formattedContact = selfResetFormatContactForDb(contactRaw);

      let snaps = await db.collection("users").where("contact", "==", formattedContact).limit(5).get();
      if (snaps.empty && phoneDigits !== formattedContact) {
        snaps = await db.collection("users").where("contact", "==", phoneDigits).limit(5).get();
      }

      if (snaps.empty || snaps.size !== 1) {
        sendError("permission-denied", SELF_SERVICE_RESET_GENERIC, 403);
        return;
      }

      const doc = snaps.docs[0];
      const data = doc.data() || {};
      const storedBirth = data.birth_year;
      const storedBirthNum =
        storedBirth == null || storedBirth === "" ? NaN : parseInt(String(storedBirth), 10);
      if (!Number.isFinite(storedBirthNum) || storedBirthNum !== birthYearNum) {
        sendError("permission-denied", SELF_SERVICE_RESET_GENERIC, 403);
        return;
      }

      const authUidFromDoc =
        (data.uid && String(data.uid).trim()) ||
        (data.id && String(data.id).trim()) ||
        doc.id;

      let resolvedAuthUid = null;
      try {
        await admin.auth().getUser(authUidFromDoc);
        resolvedAuthUid = authUidFromDoc;
      } catch (getUserErr) {
        const code = getUserErr.code || (getUserErr.errorInfo && getUserErr.errorInfo.code);
        if (code === "auth/user-not-found") {
          const email =
            (data.email && String(data.email).trim()) || `${phoneDigits}@stelvio.ai`;
          try {
            const userRecord = await admin.auth().getUserByEmail(email);
            resolvedAuthUid = userRecord.uid;
          } catch (emailErr) {
            sendError("permission-denied", SELF_SERVICE_RESET_GENERIC, 403);
            return;
          }
        } else {
          console.error("[selfServiceResetPassword] getUser 실패:", getUserErr);
          sendError("internal", "계정 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
          return;
        }
      }

      if (!resolvedAuthUid) {
        sendError("permission-denied", SELF_SERVICE_RESET_GENERIC, 403);
        return;
      }

      try {
        await admin.auth().updateUser(resolvedAuthUid, { password: newPassword });
      } catch (updErr) {
        const code = updErr.code || (updErr.errorInfo && updErr.errorInfo.code);
        const rawMessage = (updErr && updErr.message) ? String(updErr.message).trim() : "";
        console.error("[selfServiceResetPassword] updateUser 오류 code=", code, "message=", rawMessage);
        if (code === "auth/weak-password") {
          sendError("invalid-argument", "비밀번호가 너무 약합니다. 6자 이상으로 다시 입력해 주세요.");
          return;
        }
        if (code === "auth/user-not-found") {
          sendError("permission-denied", SELF_SERVICE_RESET_GENERIC, 403);
          return;
        }
        if (code === "auth/operation-not-allowed") {
          sendError(
            "failed-precondition",
            "이 계정은 비밀번호 로그인을 사용할 수 없습니다. 관리자에게 문의해 주세요.",
            412
          );
          return;
        }
        sendError("internal", "비밀번호 변경 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
        return;
      }

      res.status(200).json({
        result: { success: true, message: "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요." },
      });
    } catch (err) {
      console.error("[selfServiceResetPassword] 오류:", err);
      sendError("internal", "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
    }
  }
);

/**
 * Strava 인증 코드를 액세스/리프레시 토큰으로 교환하고 users/{userId}에 저장.
 * Client Secret은 서버(Secret Manager)에서만 사용. appConfig/strava에서 client_id, redirect_uri 읽음.
 * onRequest로 변경하여 CORS 수동 처리
 */
// Secret이 있으면 secrets 배열에 포함, 없으면 Secret 없이 배포
const exchangeStravaCodeConfig = { cors: CORS_ORIGINS };
if (STRAVA_CLIENT_SECRET) {
  exchangeStravaCodeConfig.secrets = [STRAVA_CLIENT_SECRET];
}

exports.exchangeStravaCode = onRequest(
  exchangeStravaCodeConfig,
  async (req, res) => {
    // OPTIONS preflight 요청 처리 (Firebase Functions v2의 cors 옵션과 함께 사용)
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }

    // CORS 헤더 설정 (실제 요청에 대해)
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.some(allowed => 
      typeof allowed === 'string' ? origin === allowed : allowed.test(origin)
    )) {
      res.set("Access-Control-Allow-Origin", origin);
    } else if (CORS_ORIGINS.length === 0) {
      res.set("Access-Control-Allow-Origin", "*");
    }
    res.set("Access-Control-Allow-Credentials", "true");

    try {
      const data = req.method === "POST" ? req.body : {};
      const code = typeof data.code === "string" ? data.code.trim() : "";
      const userId = data.userId != null ? String(data.userId).trim() : "";

      if (!code || !userId) {
        throw new HttpsError(
          "invalid-argument",
          "code와 userId가 필요합니다."
        );
      }

      const db = admin.firestore();
      const appConfigSnap = await db.collection("appConfig").doc("strava").get();
      if (!appConfigSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Strava 앱 설정(appConfig/strava)이 없습니다. Firestore에 strava_client_id, strava_redirect_uri를 설정하세요."
        );
      }

      const appConfig = appConfigSnap.data();
      const clientId = appConfig.strava_client_id || "";
      const redirectUri = appConfig.strava_redirect_uri || "";
      
      // Secret에서 값을 가져오되, 없거나 빈 값이면 하드코딩된 값 사용
      let clientSecret;
      if (STRAVA_CLIENT_SECRET) {
        try {
          let secretValue = STRAVA_CLIENT_SECRET.value();
          // Secret 값에서 따옴표 제거 (JSON 파싱 오류 방지)
          if (secretValue && typeof secretValue === 'string') {
            secretValue = secretValue.trim();
            // 앞뒤 따옴표 제거
            if ((secretValue.startsWith('"') && secretValue.endsWith('"')) ||
                (secretValue.startsWith("'") && secretValue.endsWith("'"))) {
              secretValue = secretValue.slice(1, -1);
            }
          }
          clientSecret = secretValue && secretValue.trim() ? secretValue : STRAVA_CLIENT_SECRET_VALUE;
        } catch (e) {
          console.warn("[exchangeStravaCode] Secret 값 읽기 실패, 하드코딩된 값 사용:", e.message);
          clientSecret = STRAVA_CLIENT_SECRET_VALUE;
        }
      } else {
        clientSecret = STRAVA_CLIENT_SECRET_VALUE;
      }

      // Secret 값 검증 (앞부분만 로그)
      const expectedSecretPrefix = "6cd67a28f1"; // 실제 Secret의 앞 10자
      const actualSecretPrefix = clientSecret ? clientSecret.substring(0, 10) : "";
      const secretMatches = actualSecretPrefix === expectedSecretPrefix;
      
      console.log("[exchangeStravaCode] 설정 확인:", {
        hasClientId: !!clientId,
        hasRedirectUri: !!redirectUri,
        hasClientSecret: !!clientSecret,
        clientId: clientId,
        redirectUri: redirectUri,
        clientIdLength: clientId.length,
        redirectUriLength: redirectUri.length,
        clientSecretLength: clientSecret ? clientSecret.length : 0,
        clientSecretPrefix: actualSecretPrefix + "...", // Secret 일부만 로그
        secretMatches: secretMatches, // Secret 값이 올바른지 확인
        codeLength: code ? code.length : 0,
        codePrefix: code ? code.substring(0, 10) + "..." : "없음"
      });
      
      if (!secretMatches && clientSecret) {
        console.warn("[exchangeStravaCode] ⚠️ Secret 값이 예상과 다릅니다. Secret Manager 값을 확인하세요.");
      }

      if (!clientId || !clientSecret || !redirectUri) {
        const missing = [];
        if (!clientId) missing.push("strava_client_id");
        if (!clientSecret) missing.push("STRAVA_CLIENT_SECRET");
        if (!redirectUri) missing.push("strava_redirect_uri");
        throw new HttpsError(
          "failed-precondition",
          `Strava 설정이 불완전합니다. 누락된 항목: ${missing.join(", ")}`
        );
      }

      const tokenUrl = "https://www.strava.com/api/v3/oauth/token";
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      });

      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        const errorDetails = {
          status: tokenRes.status,
          statusText: tokenRes.statusText,
          response: tokenData,
          requestBody: {
            client_id: clientId,
            redirect_uri: redirectUri,
            code: code ? code.substring(0, 10) + "..." : "없음",
            grant_type: "authorization_code",
            hasClientSecret: !!clientSecret,
            clientSecretLength: clientSecret ? clientSecret.length : 0
          }
        };
        console.error("[exchangeStravaCode] Strava API 오류:", JSON.stringify(errorDetails, null, 2));
        
        // 더 자세한 오류 메시지
        let errorMsg = "Strava 토큰 교환 실패: ";
        if (tokenData.error) {
          errorMsg += tokenData.error;
          if (tokenData.error_description) {
            errorMsg += " - " + tokenData.error_description;
          }
        } else if (tokenData.message) {
          errorMsg += tokenData.message;
        } else {
          errorMsg += `HTTP ${tokenRes.status}`;
        }
        
        throw new HttpsError("internal", errorMsg);
      }

      const accessToken = tokenData.access_token || "";
      const refreshToken = tokenData.refresh_token || "";
      const expiresAt = tokenData.expires_at != null ? Number(tokenData.expires_at) : 0;
      const athleteId = tokenData.athlete != null && tokenData.athlete.id != null ? Number(tokenData.athlete.id) : null;

      if (!accessToken || !refreshToken) {
        throw new HttpsError(
          "internal",
          "Strava에서 access_token 또는 refresh_token을 받지 못했습니다."
        );
      }

      const userRef = db.collection("users").doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        throw new HttpsError("not-found", "해당 사용자를 찾을 수 없습니다.");
      }

      const updateData = {
        strava_access_token: accessToken,
        strava_refresh_token: refreshToken,
        strava_expires_at: expiresAt,
      };
      if (athleteId != null) updateData.strava_athlete_id = athleteId;
      await userRef.update(updateData);

      res.status(200).json({ success: true });
    } catch (err) {
      console.error("[exchangeStravaCode]", err);
      if (!res.headersSent) {
        const statusCode = (err && err.code === "invalid-argument") ? 400 :
          (err && err.code === "not-found") ? 404 :
          (err && err.code === "failed-precondition") ? 412 : 500;
        res.status(statusCode).json({
          success: false,
          error: (err && err.message) || "Strava 토큰 교환 중 오류가 발생했습니다."
        });
      }
    }
  }
);

/**
 * Strava 리프레시 토큰으로 액세스 토큰 갱신 후 users/{userId} 업데이트.
 * 클라이언트는 userId만 전달; 리프레시 토큰은 서버가 Firestore에서 읽음.
 * onRequest로 변경하여 CORS 수동 처리
 */
// refreshStravaToken도 동일한 설정 사용
const refreshStravaTokenConfig = { cors: CORS_ORIGINS };
if (STRAVA_CLIENT_SECRET) {
  refreshStravaTokenConfig.secrets = [STRAVA_CLIENT_SECRET];
}

exports.refreshStravaToken = onRequest(
  refreshStravaTokenConfig,
  async (req, res) => {
    // OPTIONS preflight 요청 처리 (Firebase Functions v2의 cors 옵션과 함께 사용)
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }

    // CORS 헤더 설정 (실제 요청에 대해)
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.some(allowed => 
      typeof allowed === 'string' ? origin === allowed : allowed.test(origin)
    )) {
      res.set("Access-Control-Allow-Origin", origin);
    } else if (CORS_ORIGINS.length === 0) {
      res.set("Access-Control-Allow-Origin", "*");
    }
    res.set("Access-Control-Allow-Credentials", "true");

    try {
      const data = req.method === "POST" ? req.body : {};
      const userId = data.userId != null ? String(data.userId).trim() : "";

      if (!userId) {
        throw new HttpsError(
          "invalid-argument",
          "userId가 필요합니다."
        );
      }

      const db = admin.firestore();
      const userRef = db.collection("users").doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        throw new HttpsError("not-found", "해당 사용자를 찾을 수 없습니다.");
      }

      const refreshToken = userSnap.data().strava_refresh_token || "";
      if (!refreshToken) {
        throw new HttpsError(
          "failed-precondition",
          "해당 사용자에게 Strava 리프레시 토큰이 없습니다."
        );
      }

      const appConfigSnap = await db.collection("appConfig").doc("strava").get();
      if (!appConfigSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Strava 앱 설정(appConfig/strava)이 없습니다."
        );
      }

      const appConfig = appConfigSnap.data();
      const clientId = appConfig.strava_client_id || "";
      
      // Secret에서 값을 가져오되, 없거나 빈 값이면 하드코딩된 값 사용
      let clientSecret;
      if (STRAVA_CLIENT_SECRET) {
        try {
          let secretValue = STRAVA_CLIENT_SECRET.value();
          // Secret 값에서 따옴표 제거 (JSON 파싱 오류 방지)
          if (secretValue && typeof secretValue === 'string') {
            secretValue = secretValue.trim();
            // 앞뒤 따옴표 제거
            if ((secretValue.startsWith('"') && secretValue.endsWith('"')) ||
                (secretValue.startsWith("'") && secretValue.endsWith("'"))) {
              secretValue = secretValue.slice(1, -1);
            }
          }
          clientSecret = secretValue && secretValue.trim() ? secretValue : STRAVA_CLIENT_SECRET_VALUE;
        } catch (e) {
          console.warn("[refreshStravaToken] Secret 값 읽기 실패, 하드코딩된 값 사용:", e.message);
          clientSecret = STRAVA_CLIENT_SECRET_VALUE;
        }
      } else {
        clientSecret = STRAVA_CLIENT_SECRET_VALUE;
      }

      if (!clientId || !clientSecret) {
        throw new HttpsError(
          "failed-precondition",
          "Strava 설정이 불완전합니다."
        );
      }

      const tokenUrl = "https://www.strava.com/api/v3/oauth/token";
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        const msg = tokenData.message || tokenData.error || `Strava ${tokenRes.status}`;
        throw new HttpsError("internal", "Strava 토큰 갱신 실패: " + msg);
      }

      const accessToken = tokenData.access_token || "";
      const newRefreshToken = tokenData.refresh_token || refreshToken;
      const expiresAt = tokenData.expires_at != null ? Number(tokenData.expires_at) : 0;

      if (!accessToken) {
        throw new HttpsError(
          "internal",
          "Strava에서 access_token을 받지 못했습니다."
        );
      }

      await userRef.update({
        strava_access_token: accessToken,
        strava_refresh_token: newRefreshToken,
        strava_expires_at: expiresAt,
      });

      res.status(200).json({ success: true, accessToken });
    } catch (err) {
      console.error("[refreshStravaToken]", err);
      if (!res.headersSent) {
        const statusCode = (err && err.code === "invalid-argument") ? 400 :
          (err && err.code === "not-found") ? 404 :
          (err && err.code === "failed-precondition") ? 412 : 500;
        res.status(statusCode).json({
          success: false,
          error: (err && err.message) || "Strava 토큰 갱신 중 오류가 발생했습니다."
        });
      }
    }
  }
);

// ---------- Strava 전날 로그 동기화 (Firebase 기반, 수동 동기화와 동일한 Firestore 사용자/로그/포인트 사용) ----------
function getStravaClientSecret() {
  let clientSecret = STRAVA_CLIENT_SECRET_VALUE;
  if (STRAVA_CLIENT_SECRET) {
    try {
      let v = STRAVA_CLIENT_SECRET.value();
      if (v && typeof v === "string") {
        v = v.trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (v) clientSecret = v;
      }
    } catch (e) {
      console.warn("[stravaSyncPreviousDay] Secret 읽기 실패, 기본값 사용:", e.message);
    }
  }
  return clientSecret;
}

/** STELVIO rTSS: 프로필 체중 없을 때 가정 체중 (kJ 가드레일·W/kg 가중치용) */
const STELVIO_RTSS_DEFAULT_WEIGHT_KG = 70;

/**
 * STELVIO 글로벌 개정 TSS (rTSS) — W/kg 가중치
 * [수정] kJ 가드레일 재설계 (클라이언트 stelvioRtss.js와 동일한 로직 적용)
 *  구버전 wPerKg < 2.5 → tssPerKJ > 15.0, wPerKg > 4.0 → tssPerKJ < 6.0 로직은
 *  정상 범위(0.05~0.8 TSS/kJ)보다 10~100배 높아 비정상 파워 데이터 입력 시 수천~수만 TSS 발생.
 *  (예: 2026-05-09~12 기간 TSS 4173·9927·9927.2 버그의 원인)
 *  변경 후: 1.5 TSS/kJ 단일 상한 + 500 TSS 절대 상한으로 통일.
 */
function calculateStelvioRevisedTSS(durationSec, avgPower, np, ftp, weight) {
  const d = Number(durationSec);
  // 비정상 파워 데이터 방어: 최대 2500W (세계 최고 스프린터 피크 파워 수준)
  const npN = Math.min(Number(np), 2500);
  const ftpN = Number(ftp);
  const w = Number(weight);
  const avgN = Math.min(Number(avgPower), 2500);
  if (!ftpN || !w || ftpN <= 0 || w <= 0) return 0;
  if (npN <= 0 || avgN <= 0) return 0;
  if (!d || d <= 0) return 0;
  const ifFactor = npN / ftpN;
  const baseTSS = ((d * npN * ifFactor) / (ftpN * 3600)) * 100;
  const totalKJ = (avgN * d) / 1000;
  if (totalKJ <= 0) return 0;
  const wPerKg = ftpN / w;
  let wFactor = Math.pow(3.0 / wPerKg, 0.15);
  wFactor = Math.max(0.8, Math.min(1.2, wFactor));
  let adjustedTSS = baseTSS * wFactor;
  // TSS/kJ 상한: 정상 라이딩 최대 허용치(1.5 TSS/kJ) 초과 시 보정
  const tssPerKJ = adjustedTSS / totalKJ;
  if (tssPerKJ > 1.5) {
    adjustedTSS = totalKJ * 1.5;
  }
  // 단일 세션 절대 상한: 약 8시간 극한 레이스 기준 500 TSS
  if (adjustedTSS > 500) {
    adjustedTSS = 500;
  }
  return Math.round(adjustedTSS * 10) / 10;
}

function computeTssFromActivity(activity, ftp, weightKg) {
  const durationSec = Number(activity.moving_time) || 0;
  if (durationSec <= 0) return 0;
  const np = Number(activity.weighted_average_watts) || Number(activity.average_watts) || 0;
  if (np <= 0) return 0;
  ftp = Number(ftp) || 0;
  if (ftp <= 0) return 0;
  const avgW = Number(activity.average_watts) || 0;
  const avgForTss = avgW > 0 ? avgW : np;
  const wEff = (Number(weightKg) > 0) ? Number(weightKg) : STELVIO_RTSS_DEFAULT_WEIGHT_KG;
  return Math.max(0, calculateStelvioRevisedTSS(durationSec, avgForTss, np, ftp, wEff));
}

/** Strava API Rate Limit: 15분당 100회. 429 시 Retry-After(또는 60초) 대기, 최대 15분(900초)까지 대기 */
async function waitForStravaRateLimit(res) {
  if (res.status !== 429) return;
  const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
  const waitMs = Math.min(retryAfter * 1000, 900000); // 최대 15분 (Strava 15분 단위 리셋)
  console.log(`[Strava] 429 Rate Limit, ${waitMs / 1000}초 대기 후 재시도`);
  await new Promise((r) => setTimeout(r, waitMs));
}

/** Strava API 호출 간 딜레이 (Rate Limit 예방: 15분당 100회 → 9초 간격 필요) */
const STRAVA_CALL_DELAY_MS = 9000;

/** Strava 상세 활동 API 호출. 429 시 최대 5회 재시도 */
async function fetchStravaActivityDetail(accessToken, activityId) {
  const url = `https://www.strava.com/api/v3/activities/${activityId}`;
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
      let res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 429) {
        await waitForStravaRateLimit(res);
        continue;
      }
      if (!res.ok) return { success: false, error: `Strava ${res.status}` };
      const activity = await res.json().catch(() => null);
      return activity ? { success: true, activity } : { success: false, error: "Invalid response" };
    } catch (e) {
      if (attempt === maxRetries) return { success: false, error: e.message || "Request failed" };
    }
  }
  return { success: false, error: "Strava 429 retries exhausted" };
}

/** Strava Streams API 호출 (watts, heartrate). 429 시 최대 5회 재시도 */
async function fetchStravaStreams(accessToken, activityId) {
  const url = `https://www.strava.com/api/v3/activities/${activityId}/streams/time,watts,heartrate`;
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
      let res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 429) {
        await waitForStravaRateLimit(res);
        continue;
      }
      if (!res.ok) return { success: false, watts: null, heartrate: null };
      const raw = await res.json().catch(() => null);
      const streamArray = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : []);
      const wattsStream = streamArray.find((s) => s && String(s.type || "").toLowerCase() === "watts");
      const heartrateStream = streamArray.find((s) => s && String(s.type || "").toLowerCase() === "heartrate");
      const wattsArray = wattsStream && Array.isArray(wattsStream.data) ? wattsStream.data : null;
      const heartrateArray = heartrateStream && Array.isArray(heartrateStream.data) ? heartrateStream.data : null;
      return { success: true, watts: wattsArray, heartrate: heartrateArray };
    } catch (e) {
      if (attempt === maxRetries) return { success: false, watts: null, heartrate: null };
    }
  }
  return { success: false, watts: null, heartrate: null };
}

/**
 * O(N) 슬라이딩 윈도우로 최대 평균 파워(MMP) 계산.
 * watts 배열: 인덱스 1초당 1개 값. seconds 구간의 최대 평균 파워 반환.
 */
function calculateMaxAveragePower(wattsArray, seconds) {
  if (!wattsArray || wattsArray.length < seconds) return 0;
  const arr = wattsArray;
  const len = arr.length;
  let sum = 0;
  for (let i = 0; i < seconds; i++) sum += Number(arr[i]) || 0;
  let maxAvg = sum / seconds;
  for (let i = seconds; i < len; i++) {
    sum -= Number(arr[i - seconds]) || 0;
    sum += Number(arr[i]) || 0;
    const avg = sum / seconds;
    if (avg > maxAvg) maxAvg = avg;
  }
  return Math.round(maxAvg);
}

/** 심박 스트림 배열에서 구간별 최대 평균 심박 및 전체 최대 심박 계산 (MMP와 동일한 구간)
 *  - 스파이크 제거(smoothHeartRateSpikes) 후 5초 롤링 평균의 최대를 max_hr로 사용 (신뢰도 향상)
 *  - 5초 미만이면 순간 최대 사용 */
function calculateMaxHeartRatePeaks(heartrateArray) {
  if (!heartrateArray || heartrateArray.length === 0) return null;
  const raw = heartrateArray.map((v) => Number(v) || 0);
  const arr = smoothHeartRateSpikes(raw);
  const maxHr5sec = arr.length >= 5 ? Math.round(calculateMaxAveragePower(arr, 5)) : 0;
  const maxHrInstant = arr.length > 0 ? Math.max(...arr.filter((v) => v > 0)) : 0;
  const maxHr = maxHr5sec > 0 ? maxHr5sec : (maxHrInstant > 0 ? maxHrInstant : 0);
  if (maxHr <= 0) return null;
  return {
    max_hr_5sec: arr.length >= 5 ? maxHr5sec : null,
    max_hr_1min: arr.length >= 60 ? Math.round(calculateMaxAveragePower(arr, 60)) : null,
    max_hr_5min: arr.length >= 300 ? Math.round(calculateMaxAveragePower(arr, 300)) : null,
    max_hr_10min: arr.length >= 600 ? Math.round(calculateMaxAveragePower(arr, 600)) : null,
    max_hr_20min: arr.length >= 1200 ? Math.round(calculateMaxAveragePower(arr, 1200)) : null,
    max_hr_40min: arr.length >= 2400 ? Math.round(calculateMaxAveragePower(arr, 2400)) : null,
    max_hr_60min: arr.length >= 3600 ? Math.round(calculateMaxAveragePower(arr, 3600)) : null,
    max_hr: maxHr,
  };
}

/** MMP/심박 필드가 비어있는지 (null, undefined, '', NaN) 체크. 값이 없으면 true */
function isEmptyMmpValue(v) {
  if (v == null || v === undefined || v === "") return true;
  if (typeof v === "number" && isNaN(v)) return true;
  return false;
}

/**
 * Strava Webhook 활동 생성 이벤트 처리 (비동기 호출용).
 * owner_id(Strava athlete ID)로 유저 조회 → Activity 상세 + Streams 병렬 호출 → MMP 계산 → TSS/포인트 정산 → 저장.
 */
async function processStravaActivity(db, ownerId, objectId, options = {}) {
  const skipPointUpdate = Boolean(options && options.skipPointUpdate);
  const ownerIdNum = Number(ownerId);
  const activityId = String(objectId);
  if (!ownerIdNum || !activityId) {
    console.warn("[processStravaActivity] owner_id 또는 object_id 없음:", { ownerId, objectId });
    return null;
  }
  const usersSnap = await db.collection("users").where("strava_athlete_id", "==", ownerIdNum).limit(1).get();
  if (usersSnap.empty) {
    console.warn("[processStravaActivity] strava_athlete_id=", ownerIdNum, "에 해당하는 유저 없음");
    return null;
  }
  const userDoc = usersSnap.docs[0];
  const userId = userDoc.id;
  const userData = userDoc.data();
  const ftp = Number(userData.ftp) || 0;

  // 만료 5분 전 이내거나 토큰 없을 때만 갱신 (무조건 갱신 시 Rotating Refresh Token 경쟁 조건 방지)
  let accessToken = userData.strava_access_token || "";
  const tokenExpiresAt = Number(userData.strava_expires_at || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!accessToken || tokenExpiresAt < nowSec + 300) {
    try {
      const tokenResult = await refreshStravaTokenForUser(db, userId);
      accessToken = tokenResult.accessToken;
    } catch (e) {
      console.error("[processStravaActivity] 토큰 갱신 실패:", userId, e.message);
      return null;
    }
  }

  const [detailRes, streamsRes] = await Promise.all([
    fetchStravaActivityDetail(accessToken, activityId),
    fetchStravaStreams(accessToken, activityId),
  ]);

  if (!detailRes.success || !detailRes.activity) {
    console.warn("[processStravaActivity] 활동 상세 조회 실패:", activityId, detailRes.error);
    return null;
  }

  const activity = detailRes.activity;
  const mapped = mapStravaActivityToLogSchema(activity, userId, ftp, userData.weight ?? userData.weightKg);

  let max1minWatts = null;
  let max5minWatts = null;
  let max10minWatts = null;
  let max20minWatts = null;
  let max30minWatts = null;
  let max40minWatts = null;
  let max60minWatts = null;
  if (streamsRes.success && Array.isArray(streamsRes.watts) && streamsRes.watts.length > 0) {
    const watts = smoothPowerSpikes(streamsRes.watts);
    max1minWatts = calculateMaxAveragePower(watts, 60);
    max5minWatts = calculateMaxAveragePower(watts, 300);
    max10minWatts = calculateMaxAveragePower(watts, 600);
    max20minWatts = calculateMaxAveragePower(watts, 1200);
    max30minWatts = calculateMaxAveragePower(watts, 1800);
    max40minWatts = calculateMaxAveragePower(watts, 2400);
    max60minWatts = calculateMaxAveragePower(watts, 3600);
  }

  const hrPeaks = streamsRes.success && Array.isArray(streamsRes.heartrate) && streamsRes.heartrate.length > 0
    ? calculateMaxHeartRatePeaks(streamsRes.heartrate)
    : null;

  let timeInZones = null;
  if (streamsRes.success && (streamsRes.watts?.length > 0 || streamsRes.heartrate?.length > 0)) {
    const effectiveFtp = getFTPWithFallback(userData, streamsRes.watts || []);
    timeInZones = await calculateZoneTimesFromStreams({
      wattsArray: streamsRes.watts || [],
      hrArray: streamsRes.heartrate || [],
      ftp: effectiveFtp,
      userId,
      db,
      dateStr: mapped.date || "",
    });
  }

  const tssAppliedAt = new Date().toISOString();
  const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
    ? Number(userData.weight ?? userData.weightKg)
    : null;
  const logDoc = {
    activity_id: mapped.activity_id,
    user_id: mapped.user_id,
    source: mapped.source,
    activity_type: mapped.activity_type ?? null,
    date: mapped.date,
    title: mapped.title,
    distance_km: mapped.distance_km,
    duration_sec: mapped.duration_sec,
    time: mapped.time,
    avg_cadence: mapped.avg_cadence,
    avg_hr: mapped.avg_hr,
    max_hr: mapped.max_hr,
    avg_watts: mapped.avg_watts,
    max_watts: mapped.max_watts,
    weighted_watts: mapped.weighted_watts,
    kilojoules: mapped.kilojoules,
    elevation_gain: mapped.elevation_gain,
    avg_speed_kmh: mapped.avg_speed_kmh ?? null,
    left_right_balance: mapped.left_right_balance ?? null,
    pedal_smoothness_left: mapped.pedal_smoothness_left ?? null,
    pedal_smoothness_right: mapped.pedal_smoothness_right ?? null,
    torque_effectiveness_left: mapped.torque_effectiveness_left ?? null,
    torque_effectiveness_right: mapped.torque_effectiveness_right ?? null,
    rpe: mapped.rpe,
    ftp_at_time: mapped.ftp_at_time,
    if: mapped.if,
    tss: mapped.tss,
    efficiency_factor: mapped.efficiency_factor,
    time_in_zones: timeInZones || mapped.time_in_zones,
    earned_points: mapped.earned_points,
    workout_id: mapped.workout_id,
    tss_applied: true,
    tss_applied_at: tssAppliedAt,
    created_at: mapped.created_at,
  };
  if (userWeight != null) logDoc.weight = userWeight;
  if (max1minWatts != null) logDoc.max_1min_watts = max1minWatts;
  if (max5minWatts != null) logDoc.max_5min_watts = max5minWatts;
  if (max10minWatts != null) logDoc.max_10min_watts = max10minWatts;
  if (max20minWatts != null) logDoc.max_20min_watts = max20minWatts;
  if (max30minWatts != null) logDoc.max_30min_watts = max30minWatts;
  if (max40minWatts != null) logDoc.max_40min_watts = max40minWatts;
  if (max60minWatts != null) logDoc.max_60min_watts = max60minWatts;
  if (hrPeaks) {
    if (hrPeaks.max_hr_5sec != null) logDoc.max_hr_5sec = hrPeaks.max_hr_5sec;
    if (hrPeaks.max_hr_1min != null) logDoc.max_hr_1min = hrPeaks.max_hr_1min;
    if (hrPeaks.max_hr_5min != null) logDoc.max_hr_5min = hrPeaks.max_hr_5min;
    if (hrPeaks.max_hr_10min != null) logDoc.max_hr_10min = hrPeaks.max_hr_10min;
    if (hrPeaks.max_hr_20min != null) logDoc.max_hr_20min = hrPeaks.max_hr_20min;
    if (hrPeaks.max_hr_40min != null) logDoc.max_hr_40min = hrPeaks.max_hr_40min;
    if (hrPeaks.max_hr_60min != null) logDoc.max_hr_60min = hrPeaks.max_hr_60min;
    if (hrPeaks.max_hr != null) logDoc.max_hr = hrPeaks.max_hr;
  }

  // Run/Swim/Walk/TrailRun/WeightTraining 등 비라이딩 활동은 라이딩 기록 컬렉션에 저장하지 않음
  if (!isCyclingForMmp(mapped)) {
    console.log(`[processStravaActivity] 비라이딩 활동 저장 제외: userId=${userId} activityId=${activityId} activity_type=${mapped.activity_type}`);
    return { userId, activityId, userTss: 0, isNew: false };
  }

  const existingIds = await getExistingStravaActivityIds(db, userId);
  const isNew = !existingIds.has(activityId);

  const logsRef = db.collection("users").doc(userId).collection("logs");
  await logsRef.doc(activityId).set(logDoc, { merge: true });

  let userTss = 0;
  if (isCyclingForMmp(mapped) && isNew && mapped.tss > 0 && (mapped.distance_km || 0) !== 0) {
    const dateStr = mapped.date || "";
    const dayTotal = await getTotalTssForDate(db, userId, dateStr);
    if (dayTotal >= TSS_PER_DAY_CHEAT_THRESHOLD) {
      userTss = 0; // 1일 500+ TSS 치팅: 포인트 적립 제외
    } else {
      const stelvioDates = await getStelvioLogDates(db, userId);
      if (stelvioDates.has(dateStr)) {
        const stelvioPoints = await getStelvioPointsForDate(db, userId, dateStr);
        const diff = Math.max(0, (mapped.tss || 0) - (stelvioPoints || 0));
        userTss = diff;
      } else {
        userTss = mapped.tss || 0;
      }
    }
  }

  if (userTss > 0 && !skipPointUpdate) {
    try {
      await updateUserMileageInFirestore(db, userId, userTss);
    } catch (e) {
      console.error("[processStravaActivity] 포인트 업데이트 실패:", userId, e.message);
    }
  }

  console.log("[processStravaActivity] 완료:", { userId, activityId, isNew, userTss, max5minWatts, max10minWatts, max30minWatts });
  return { userId, activityId, userTss, isNew };
}

function pickFirstFiniteNumberFromStravaActivity(obj, keys) {
  if (!obj || !keys || !keys.length) return null;
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function computeAvgSpeedKmhFromStravaActivity(activity, distanceKm, durationSec) {
  const avgMs = Number(activity && activity.average_speed);
  if (Number.isFinite(avgMs) && avgMs > 0) {
    return Math.round(avgMs * 3.6 * 100) / 100;
  }
  const d = Number(distanceKm) || 0;
  const t = Number(durationSec) || 0;
  if (d > 0 && t > 0) {
    return Math.round((d / (t / 3600)) * 100) / 100;
  }
  return null;
}

function extractStravaPedalingExtrasFromActivity(activity) {
  if (!activity || typeof activity !== "object") {
    return {
      left_right_balance: null,
      pedal_smoothness_left: null,
      pedal_smoothness_right: null,
      torque_effectiveness_left: null,
      torque_effectiveness_right: null,
    };
  }
  return {
    left_right_balance: pickFirstFiniteNumberFromStravaActivity(activity, [
      "left_right_balance",
      "average_left_right_balance",
      "avg_left_right_balance",
    ]),
    pedal_smoothness_left: pickFirstFiniteNumberFromStravaActivity(activity, [
      "average_pedal_smoothness_left",
      "pedal_smoothness_left",
      "avg_pedal_smoothness_left",
    ]),
    pedal_smoothness_right: pickFirstFiniteNumberFromStravaActivity(activity, [
      "average_pedal_smoothness_right",
      "pedal_smoothness_right",
      "avg_pedal_smoothness_right",
    ]),
    torque_effectiveness_left: pickFirstFiniteNumberFromStravaActivity(activity, [
      "average_torque_effectiveness_left",
      "torque_effectiveness_left",
      "avg_torque_effectiveness_left",
    ]),
    torque_effectiveness_right: pickFirstFiniteNumberFromStravaActivity(activity, [
      "average_torque_effectiveness_right",
      "torque_effectiveness_right",
      "avg_torque_effectiveness_right",
    ]),
  };
}

/**
 * Strava 활동 → 로그 스키마 매핑 (수동 동기화 mapStravaActivityToSchema와 동일한 필드)
 * 상세 API 응답 기준으로 avg_hr, max_hr, avg_cadence, elevation_gain, kilojoules 등 포함.
 * @param {number} [weightKg] - 체중(kg), rTSS
 */
function mapStravaActivityToLogSchema(activity, userId, ftpAtTime, weightKg) {
  const title = activity.name || "";
  const startDateLocal = activity.start_date_local || activity.start_date || "";
  let dateStr = "";
  if (startDateLocal) {
    try {
      dateStr = new Date(startDateLocal).toISOString().split("T")[0];
    } catch (e) {
      dateStr = String(startDateLocal).split("T")[0] || "";
    }
  }
  const distanceMeters = Number(activity.distance) || 0;
  const distanceKm = Math.round((distanceMeters / 1000) * 100) / 100;
  const durationSec = Math.round(Number(activity.moving_time) || 0);
  const avgCadence = activity.average_cadence != null ? Number(activity.average_cadence) : null;
  const avgHr = activity.average_heartrate != null ? Number(activity.average_heartrate) : null;
  const maxHr = activity.max_heartrate != null ? Number(activity.max_heartrate) : null;
  const avgWatts = activity.average_watts != null ? Number(activity.average_watts) : null;
  const maxWatts = activity.max_watts != null ? Number(activity.max_watts) : null;
  const weightedWatts = activity.weighted_average_watts != null ? Number(activity.weighted_average_watts) : null;
  const kilojoules = activity.kilojoules != null ? Number(activity.kilojoules) : null;
  const elevationGain = activity.total_elevation_gain != null ? Number(activity.total_elevation_gain) : null;
  const rpe = activity.perceived_exertion != null ? Number(activity.perceived_exertion) : null;
  const ftp = Number(ftpAtTime) || 0;
  const np = weightedWatts != null ? weightedWatts : (avgWatts != null ? avgWatts : 0);
  const avgForTss = (avgWatts != null && avgWatts > 0) ? avgWatts : np;
  const wEff = (Number(weightKg) > 0) ? Number(weightKg) : STELVIO_RTSS_DEFAULT_WEIGHT_KG;
  let ifValue = null;
  if (ftp > 0 && np > 0) ifValue = Math.round((np / ftp) * 1000) / 1000;
  let tss = 0;
  if (ftp > 0 && np > 0 && durationSec > 0) {
    tss = Math.max(0, calculateStelvioRevisedTSS(durationSec, avgForTss, np, ftp, wEff));
  }
  let efficiencyFactor = null;
  if (np > 0 && avgHr != null && avgHr > 0) efficiencyFactor = Math.round((np / avgHr) * 100) / 100;
  const now = new Date().toISOString();
  const activityType = String(activity.sport_type || activity.type || "").trim() || null;
  const avgSpeedKmh = computeAvgSpeedKmhFromStravaActivity(activity, distanceKm, durationSec);
  const pedaling = extractStravaPedalingExtrasFromActivity(activity);
  return {
    activity_id: String(activity.id || ""),
    user_id: userId,
    source: "strava",
    activity_type: activityType,
    title,
    date: dateStr,
    distance_km: distanceKm,
    duration_sec: durationSec,
    time: durationSec,
    avg_cadence: avgCadence,
    avg_hr: avgHr,
    max_hr: maxHr,
    avg_watts: avgWatts,
    max_watts: maxWatts,
    weighted_watts: weightedWatts,
    kilojoules: kilojoules,
    elevation_gain: elevationGain,
    avg_speed_kmh: avgSpeedKmh,
    left_right_balance: pedaling.left_right_balance,
    pedal_smoothness_left: pedaling.pedal_smoothness_left,
    pedal_smoothness_right: pedaling.pedal_smoothness_right,
    torque_effectiveness_left: pedaling.torque_effectiveness_left,
    torque_effectiveness_right: pedaling.torque_effectiveness_right,
    rpe: rpe,
    ftp_at_time: ftp > 0 ? ftp : null,
    if: ifValue,
    tss: tss,
    efficiency_factor: efficiencyFactor,
    time_in_zones: null,
    earned_points: 0,
    workout_id: null,
    created_at: now,
  };
}

/**
 * 한국(Asia/Seoul) 기준 "전날" 00:00~23:59 구간을 반환.
 * Cloud Functions 서버는 UTC이므로, 서버 시간이 아닌 서울 시간 기준으로 계산해야
 * 한국 사용자 기준 "어제" 로그를 올바르게 가져온다.
 */
function getYesterdayAfterBefore() {
  const now = new Date();
  // 오늘 날짜를 서울 시간 기준 YYYY-MM-DD로 얻기
  const todaySeoulStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [y, m, d] = todaySeoulStr.split("-").map(Number);
  // 전날(서울 기준) 날짜 계산
  const todaySeoul = new Date(y, m - 1, d);
  todaySeoul.setDate(todaySeoul.getDate() - 1);
  const yesterY = todaySeoul.getFullYear();
  const yesterM = todaySeoul.getMonth() + 1;
  const yesterD = todaySeoul.getDate();
  const pad = (n) => String(n).padStart(2, "0");
  const dateFrom = `${yesterY}-${pad(yesterM)}-${pad(yesterD)}`;
  const dateTo = dateFrom;
  // 서울 시간 00:00:00, 23:59:59.999 를 Unix 타임스탬프로 (Strava API는 UTC Unix 사용)
  const startSeoul = new Date(`${dateFrom}T00:00:00+09:00`);
  const endSeoul = new Date(`${dateTo}T23:59:59.999+09:00`);
  const afterUnix = Math.floor(startSeoul.getTime() / 1000);
  const beforeUnix = Math.floor(endSeoul.getTime() / 1000);
  return { afterUnix, beforeUnix, dateFrom, dateTo };
}

/**
 * 한국(Asia/Seoul) 기준 "오늘" 00:00~23:59 구간을 반환.
 * 일요일 19시 당일 Strava 수집 스케줄에서 사용.
 */
function getTodayAfterBefore() {
  const now = new Date();
  const todaySeoulStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [y, m, d] = todaySeoulStr.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const dateFrom = `${y}-${pad(m)}-${pad(d)}`;
  const dateTo = dateFrom;
  const startSeoul = new Date(`${dateFrom}T00:00:00+09:00`);
  const endSeoul = new Date(`${dateTo}T23:59:59.999+09:00`);
  const afterUnix = Math.floor(startSeoul.getTime() / 1000);
  const beforeUnix = Math.floor(endSeoul.getTime() / 1000);
  return { afterUnix, beforeUnix, dateFrom, dateTo };
}

async function getStelvioLogDates(db, userId) {
  const dates = new Set();
  // [비용절감] 전체 로그 스캔 대신 최근 1년치만 조회 (Strava 비교는 최근 데이터만 필요)
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];
  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("date", ">=", cutoffStr)
    .get();
  snapshot.docs.forEach((doc) => {
    const log = doc.data();
    if (log.source === "strava") return;
    let dateStr = "";
    if (log.date) {
      if (typeof log.date === "string") dateStr = log.date;
      else if (log.date.toDate) dateStr = log.date.toDate().toISOString().split("T")[0];
      else if (log.date instanceof Date) dateStr = log.date.toISOString().split("T")[0];
    }
    if (dateStr) dates.add(dateStr);
  });
  return dates;
}

/** 해당 날짜의 1일 총 TSS (Strava 우선, 없으면 Stelvio). 500+ 치팅 제외 판단용. */
async function getTotalTssForDate(db, userId, dateStr) {
  if (!userId || !dateStr) return 0;
  try {
    const snapshot = await db.collection("users").doc(userId).collection("logs").where("date", "==", dateStr).get();
    let strava = 0;
    let stelvio = 0;
    snapshot.docs.forEach((doc) => {
      const d = doc.data();
      if (!isCyclingForMmp(d)) return; // Run, Swim, Walk, TrailRun 제외
      const tss = Number(d.tss) || 0;
      const isStrava = String(d.source || "").toLowerCase() === "strava";
      if (isStrava) strava += tss;
      else stelvio += tss;
    });
    return strava > 0 ? strava : stelvio;
  } catch (e) {
    console.warn("[getTotalTssForDate]", dateStr, e.message);
    return 0;
  }
}

/** 해당 날짜의 Stelvio(앱) 적립 포인트 합계 조회. 차액 적립 시 사용. */
async function getStelvioPointsForDate(db, userId, dateStr) {
  if (!userId || !dateStr) return 0;
  try {
    const snapshot = await db.collection("users").doc(userId).collection("logs").where("date", "==", dateStr).get();
    let sum = 0;
    snapshot.docs.forEach((doc) => {
      const log = doc.data();
      if (log.source === "strava") return;
      const pts = Number(log.earned_points != null ? log.earned_points : log.tss) || 0;
      sum += pts;
    });
    return sum;
  } catch (e) {
    console.warn("[getStelvioPointsForDate]", dateStr, e.message);
    return 0;
  }
}

async function getExistingStravaActivityIds(db, userId) {
  const ids = new Set();
  // [비용절감] 최근 1년치 Strava 로그만 조회 (중복 체크는 최근 데이터만 필요)
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];
  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("source", "==", "strava")
    .where("date", ">=", cutoffStr)
    .get();
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (data.activity_id) ids.add(String(data.activity_id));
  });
  return ids;
}

/** 기존 Strava 로그 조회 (activity_id → { ref, data }). MMP 보완용. */
async function getExistingStravaLogsMap(db, userId) {
  const ids = new Set();
  const docMap = new Map();
  // [비용절감] 최근 1년치 Strava 로그만 조회 (MMP 보완도 최근 데이터 위주)
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];
  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("source", "==", "strava")
    .where("date", ">=", cutoffStr)
    .get();
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const actId = data.activity_id ? String(data.activity_id) : null;
    if (actId) {
      ids.add(actId);
      docMap.set(actId, { ref: doc.ref, data });
    }
  });
  return { ids, docMap };
}

async function refreshStravaTokenForUser(db, userId) {
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new Error("사용자를 찾을 수 없습니다.");
  const refreshToken = userSnap.data().strava_refresh_token || "";
  if (!refreshToken) throw new Error("Strava 리프레시 토큰이 없습니다.");
  const appConfigSnap = await db.collection("appConfig").doc("strava").get();
  if (!appConfigSnap.exists) throw new Error("Strava 앱 설정이 없습니다.");
  const clientId = appConfigSnap.data().strava_client_id || "";
  const clientSecret = getStravaClientSecret();
  if (!clientId || !clientSecret) throw new Error("Strava 설정이 불완전합니다.");
  const tokenUrl = "https://www.strava.com/api/v3/oauth/token";
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) throw new Error(tokenData.message || tokenData.error || `Strava ${tokenRes.status}`);
  const accessToken = tokenData.access_token || "";
  const newRefreshToken = tokenData.refresh_token || refreshToken;
  const expiresAt = tokenData.expires_at != null ? Number(tokenData.expires_at) : 0;
  if (!accessToken) throw new Error("Strava에서 access_token을 받지 못했습니다.");
  await userRef.update({
    strava_access_token: accessToken,
    strava_refresh_token: newRefreshToken,
    strava_expires_at: expiresAt,
  });
  return { accessToken };
}

async function updateUserMileageInFirestore(db, userId, todayTss) {
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new Error("사용자를 찾을 수 없습니다.");
  const userData = userSnap.data();
  let accPoints = Number(userData.acc_points || 0);
  let remPoints = Number(userData.rem_points || 0);
  const expiryDate = userData.expiry_date || "";
  const lastTrainingDate = userData.last_training_date || "";
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentDate = today.toISOString().split("T")[0];
  let shouldResetAccPoints = false;
  if (lastTrainingDate) {
    try {
      const lastYear = new Date(lastTrainingDate).getFullYear();
      if (lastYear < currentYear) shouldResetAccPoints = true;
    } catch (e) { /* ignore */ }
  } else {
    shouldResetAccPoints = true;
  }
  if (shouldResetAccPoints) accPoints = 0;
  const calcPool = remPoints + todayTss;
  const addDays = Math.floor(calcPool / 500);
  const newRemPoints = calcPool % 500;
  const newAccPoints = accPoints + todayTss;
  let newExpiryDate = expiryDate;
  // 이미 만료된 사용자: 오늘 기준 + addDays 적용. 미만료: 기존 만료일 + addDays
  if (addDays > 0) {
    try {
      let baseDate;
      if (expiryDate) {
        const expiry = new Date(expiryDate);
        expiry.setHours(0, 0, 0, 0);
        const todayStart = new Date(today);
        todayStart.setHours(0, 0, 0, 0);
        baseDate = expiry.getTime() < todayStart.getTime()
          ? new Date(today.getTime())
          : new Date(expiry.getTime());
      } else {
        baseDate = new Date(today.getTime());
      }
      baseDate.setDate(baseDate.getDate() + addDays);
      newExpiryDate = baseDate.toISOString().split("T")[0];
    } catch (e) { /* ignore */ }
  }
  const updateData = {
    acc_points: newAccPoints,
    rem_points: newRemPoints,
    last_training_date: currentDate,
  };
  if (addDays > 0 && newExpiryDate) updateData.expiry_date = newExpiryDate;
  await userRef.update(updateData);
  return { acc_points: newAccPoints, rem_points: newRemPoints, expiry_date: newExpiryDate };
}

// ---------- 1000명 규모 설계 상수 ----------
const STRAVA_SYNC_CHUNK_SIZE = 50;        // 청크당 사용자 수 (팬아웃)
const STRAVA_SYNC_CONCURRENCY = 10;      // 청크 내 동시 처리 사용자 수
const STRAVA_SYNC_CHUNK_THRESHOLD = 100; // 이 인원 초과 시 청크 팬아웃 사용
const INTERNAL_SYNC_SECRET = "stelvio-internal-sync-v1"; // 청크 HTTP 인증 (필요 시 Secret으로 교체)

/** 단일 사용자 Strava 동기화 (병렬 배치용). Webhook 실패 보완: MMP(5/10/30분 파워) 없으면 Streams로 보완. */
async function processOneUserStravaSync(db, userId, userData, { afterUnix, beforeUnix }) {
  const ftp = Number(userData.ftp) || 0;
  // 만료 5분 전 이내거나 토큰 없을 때만 갱신 (무조건 갱신 시 Rotating Refresh Token 경쟁 조건 방지)
  let accessToken = userData.strava_access_token || "";
  const tokenExpiresAt = Number(userData.strava_expires_at || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!accessToken || tokenExpiresAt < nowSec + 300) {
    try {
      const tokenResult = await refreshStravaTokenForUser(db, userId);
      accessToken = tokenResult.accessToken;
    } catch (e) {
      return { userId, processed: 0, newActivities: 0, userTss: 0, error: `토큰 갱신 실패: ${e.message}` };
    }
  }
  const actRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${afterUnix}&before=${beforeUnix}&per_page=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const activities = await actRes.json().catch(() => []);
  const actCount = Array.isArray(activities) ? activities.length : 0;
  console.log(`[stravaSync] userId=${userId} athlete_id=${userData.strava_athlete_id || "?"} activities=${actCount} status=${actRes.status}`);
  if (!actRes.ok) {
    return { userId, processed: 0, newActivities: 0, userTss: 0, error: `활동 조회 실패: ${actRes.status}` };
  }
  const { ids: existingIds, docMap: existingDocMap } = await getExistingStravaLogsMap(db, userId);
  const stelvioDates = await getStelvioLogDates(db, userId);
  const logsRef = db.collection("users").doc(userId).collection("logs");
  /** 같은 날 Stelvio가 있는 날짜별 Strava TSS 합산 → 차액만 추가 적립 */
  const stelvioDateStravaTssAccumulator = new Map();
  /** Stelvio 없는 날짜별 Strava TSS 합산 (1일 500+ 치팅 제외용) */
  const dateOnlyStravaTss = new Map();
  let userTss = 0;
  let newActivities = 0;
  for (const act of Array.isArray(activities) ? activities : []) {
    const actId = String(act.id);
    if (existingIds.has(actId)) {
      const entry = existingDocMap.get(actId);
      const d = entry ? entry.data : {};
      const powerFields = ['max_1min_watts', 'max_5min_watts', 'max_10min_watts', 'max_20min_watts', 'max_30min_watts', 'max_40min_watts', 'max_60min_watts', 'max_watts'];
      const hrFields = ['max_hr_5sec', 'max_hr_1min', 'max_hr_5min', 'max_hr_10min', 'max_hr_20min', 'max_hr_40min', 'max_hr_60min', 'max_hr'];
      const needsMmp = powerFields.some((f) => isEmptyMmpValue(d[f]));
      const needsHrPeaks = hrFields.some((f) => isEmptyMmpValue(d[f]));
      const needsTimeInZones = !d.time_in_zones || !d.time_in_zones.power;
      const needsWeight = d.weight == null;
      const needsActivityType = !String(d.activity_type || "").trim();
      if ((needsMmp || needsHrPeaks || needsTimeInZones || needsWeight || needsActivityType) && entry) {
        const streamsRes = await fetchStravaStreams(accessToken, actId);
        const updateData = {};
        if (needsActivityType) {
          const at = String(act.sport_type || act.type || "").trim() || null;
          if (at) updateData.activity_type = at;
        }
        const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
          ? Number(userData.weight ?? userData.weightKg)
          : null;
        if (needsWeight && userWeight != null) updateData.weight = userWeight;
        if (streamsRes.success && Array.isArray(streamsRes.watts) && streamsRes.watts.length > 0) {
          const watts = smoothPowerSpikes(streamsRes.watts);
          updateData.max_1min_watts = calculateMaxAveragePower(watts, 60);
          updateData.max_5min_watts = calculateMaxAveragePower(watts, 300);
          updateData.max_10min_watts = calculateMaxAveragePower(watts, 600);
          updateData.max_20min_watts = calculateMaxAveragePower(watts, 1200);
          updateData.max_30min_watts = calculateMaxAveragePower(watts, 1800);
          updateData.max_40min_watts = calculateMaxAveragePower(watts, 2400);
          updateData.max_60min_watts = calculateMaxAveragePower(watts, 3600);
          const streamMax = Math.max(...watts.map((w) => Number(w) || 0));
          if (streamMax > 0) updateData.max_watts = Math.round(streamMax);
          else if (act.max_watts != null) updateData.max_watts = Number(act.max_watts);
        }
        const hrPeaks = streamsRes.success && Array.isArray(streamsRes.heartrate) && streamsRes.heartrate.length > 0 ? calculateMaxHeartRatePeaks(streamsRes.heartrate) : null;
        if (hrPeaks) {
          if (hrPeaks.max_hr_5sec != null) updateData.max_hr_5sec = hrPeaks.max_hr_5sec;
          if (hrPeaks.max_hr_1min != null) updateData.max_hr_1min = hrPeaks.max_hr_1min;
          if (hrPeaks.max_hr_5min != null) updateData.max_hr_5min = hrPeaks.max_hr_5min;
          if (hrPeaks.max_hr_10min != null) updateData.max_hr_10min = hrPeaks.max_hr_10min;
          if (hrPeaks.max_hr_20min != null) updateData.max_hr_20min = hrPeaks.max_hr_20min;
          if (hrPeaks.max_hr_40min != null) updateData.max_hr_40min = hrPeaks.max_hr_40min;
          if (hrPeaks.max_hr_60min != null) updateData.max_hr_60min = hrPeaks.max_hr_60min;
          if (hrPeaks.max_hr != null) updateData.max_hr = hrPeaks.max_hr;
        }
        if (streamsRes.success && (streamsRes.watts?.length > 0 || streamsRes.heartrate?.length > 0)) {
          const effectiveFtp = getFTPWithFallback(userData, streamsRes.watts || []);
          const timeInZones = await calculateZoneTimesFromStreams({
            wattsArray: streamsRes.watts || [],
            hrArray: streamsRes.heartrate || [],
            ftp: effectiveFtp,
            userId,
            db,
            dateStr: d.date || "",
          });
          updateData.time_in_zones = timeInZones;
        }
        if (Object.keys(updateData).length > 0) await entry.ref.update(updateData);
      }
      continue;
    }
    let detailedActivity = act;
    const detailRes = await fetchStravaActivityDetail(accessToken, actId);
    if (detailRes.success && detailRes.activity) detailedActivity = detailRes.activity;
    const mapped = mapStravaActivityToLogSchema(detailedActivity, userId, ftp, userData.weight ?? userData.weightKg);
    const streamsRes = await fetchStravaStreams(accessToken, actId);
    let max1minWatts = null;
    let max5minWatts = null;
    let max10minWatts = null;
    let max20minWatts = null;
    let max30minWatts = null;
    let max40minWatts = null;
    let max60minWatts = null;
    let maxWattsFromStream = null;
    if (streamsRes.success && Array.isArray(streamsRes.watts) && streamsRes.watts.length > 0) {
      const watts = smoothPowerSpikes(streamsRes.watts);
      max1minWatts = calculateMaxAveragePower(watts, 60);
      max5minWatts = calculateMaxAveragePower(watts, 300);
      max10minWatts = calculateMaxAveragePower(watts, 600);
      max20minWatts = calculateMaxAveragePower(watts, 1200);
      max30minWatts = calculateMaxAveragePower(watts, 1800);
      max40minWatts = calculateMaxAveragePower(watts, 2400);
      max60minWatts = calculateMaxAveragePower(watts, 3600);
      const streamMax = Math.max(...watts.map((w) => Number(w) || 0));
      if (streamMax > 0) maxWattsFromStream = Math.round(streamMax);
    }
    const hrPeaks = streamsRes.success && Array.isArray(streamsRes.heartrate) && streamsRes.heartrate.length > 0 ? calculateMaxHeartRatePeaks(streamsRes.heartrate) : null;
    let timeInZones = null;
    if (streamsRes.success && (streamsRes.watts?.length > 0 || streamsRes.heartrate?.length > 0)) {
      const effectiveFtp = getFTPWithFallback(userData, streamsRes.watts || []);
      timeInZones = await calculateZoneTimesFromStreams({
        wattsArray: streamsRes.watts || [],
        hrArray: streamsRes.heartrate || [],
        ftp: effectiveFtp,
        userId,
        db,
        dateStr: mapped.date || "",
      });
    }
    const dateStr = mapped.date || "";
    const activityTss = mapped.tss || 0;
    const distanceKm = mapped.distance_km || 0;
    const tssAppliedAt = new Date().toISOString();
    const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
      ? Number(userData.weight ?? userData.weightKg)
      : null;
    const logDoc = {
      activity_id: mapped.activity_id,
      user_id: mapped.user_id,
      source: mapped.source,
      activity_type: mapped.activity_type ?? null,
      date: mapped.date,
      title: mapped.title,
      distance_km: mapped.distance_km,
      duration_sec: mapped.duration_sec,
      time: mapped.time,
      avg_cadence: mapped.avg_cadence,
      avg_hr: mapped.avg_hr,
      max_hr: mapped.max_hr,
      avg_watts: mapped.avg_watts,
      max_watts: maxWattsFromStream ?? mapped.max_watts,
      weighted_watts: mapped.weighted_watts,
      kilojoules: mapped.kilojoules,
      elevation_gain: mapped.elevation_gain,
      avg_speed_kmh: mapped.avg_speed_kmh ?? null,
      left_right_balance: mapped.left_right_balance ?? null,
      pedal_smoothness_left: mapped.pedal_smoothness_left ?? null,
      pedal_smoothness_right: mapped.pedal_smoothness_right ?? null,
      torque_effectiveness_left: mapped.torque_effectiveness_left ?? null,
      torque_effectiveness_right: mapped.torque_effectiveness_right ?? null,
      rpe: mapped.rpe,
      ftp_at_time: mapped.ftp_at_time,
      if: mapped.if,
      tss: mapped.tss,
      efficiency_factor: mapped.efficiency_factor,
      time_in_zones: timeInZones || mapped.time_in_zones,
      earned_points: mapped.earned_points,
      workout_id: mapped.workout_id,
      tss_applied: true,
      tss_applied_at: tssAppliedAt,
      created_at: mapped.created_at,
    };
    if (userWeight != null) logDoc.weight = userWeight;
    if (max1minWatts != null) logDoc.max_1min_watts = max1minWatts;
    if (max5minWatts != null) logDoc.max_5min_watts = max5minWatts;
    if (max10minWatts != null) logDoc.max_10min_watts = max10minWatts;
    if (max20minWatts != null) logDoc.max_20min_watts = max20minWatts;
    if (max30minWatts != null) logDoc.max_30min_watts = max30minWatts;
    if (max40minWatts != null) logDoc.max_40min_watts = max40minWatts;
    if (max60minWatts != null) logDoc.max_60min_watts = max60minWatts;
    if (hrPeaks) {
      if (hrPeaks.max_hr_5sec != null) logDoc.max_hr_5sec = hrPeaks.max_hr_5sec;
      if (hrPeaks.max_hr_1min != null) logDoc.max_hr_1min = hrPeaks.max_hr_1min;
      if (hrPeaks.max_hr_5min != null) logDoc.max_hr_5min = hrPeaks.max_hr_5min;
      if (hrPeaks.max_hr_10min != null) logDoc.max_hr_10min = hrPeaks.max_hr_10min;
      if (hrPeaks.max_hr_20min != null) logDoc.max_hr_20min = hrPeaks.max_hr_20min;
      if (hrPeaks.max_hr_40min != null) logDoc.max_hr_40min = hrPeaks.max_hr_40min;
      if (hrPeaks.max_hr_60min != null) logDoc.max_hr_60min = hrPeaks.max_hr_60min;
      if (hrPeaks.max_hr != null) logDoc.max_hr = hrPeaks.max_hr;
    }
    // Run/Swim/Walk/TrailRun/WeightTraining 등 비라이딩 활동은 저장하지 않음
    if (!isCyclingForMmp(mapped)) {
      console.log(`[processOneUserStravaSync] 비라이딩 활동 저장 제외: userId=${userId} actId=${actId} activity_type=${mapped.activity_type}`);
      continue;
    }
    await logsRef.doc(actId).set(logDoc, { merge: true });
    existingIds.add(actId);
    newActivities += 1;
    if (isCyclingForMmp(mapped)) {
      if (stelvioDates.has(dateStr)) {
        if (distanceKm !== 0) {
          const prev = stelvioDateStravaTssAccumulator.get(dateStr) || 0;
          stelvioDateStravaTssAccumulator.set(dateStr, prev + activityTss);
        }
      } else {
        if (distanceKm !== 0) {
          const prev = dateOnlyStravaTss.get(dateStr) || 0;
          dateOnlyStravaTss.set(dateStr, prev + activityTss);
        }
      }
    }
  }
  for (const [dateStr, tss] of dateOnlyStravaTss) {
    if (tss < TSS_PER_DAY_CHEAT_THRESHOLD) userTss += tss;
  }
  for (const [dateStr, stravaSum] of stelvioDateStravaTssAccumulator) {
    const stelvioPoints = await getStelvioPointsForDate(db, userId, dateStr);
    const dayTotal = stelvioPoints + (stravaSum || 0);
    if (dayTotal >= TSS_PER_DAY_CHEAT_THRESHOLD) continue; // 1일 500+ TSS 치팅: 포인트 적립 제외
    const diff = Math.max(0, (stravaSum || 0) - (stelvioPoints || 0));
    if (diff > 0) {
      userTss += diff;
      console.log(`[processOneUserStravaSync] 차액 추가 적립: ${userId} ${dateStr} Stelvio ${stelvioPoints} + Strava합 ${stravaSum} → 추가 ${diff}`);
    }
  }
  return { userId, processed: 1, newActivities, userTss, error: null };
}

/**
 * 지정 구간에 대해 Strava 로그 수집 및 Firestore 반영.
 * userIdsFilter 있으면 해당 사용자만 처리(청크 워커용). 없으면 전체.
 * 1000명 대비: 사용자별 병렬 배치(STRAVA_SYNC_CONCURRENCY) 처리.
 */
async function runStravaSyncForRange(db, { afterUnix, beforeUnix, dateFrom, dateTo }, logPrefix, userIdsFilter) {
  const prefix = logPrefix || "[stravaSync]";
  const errors = [];
  let processed = 0;
  let newActivitiesTotal = 0;
  const totalTssByUser = {};
  console.log(`${prefix} 시작`, { dateFrom, dateTo, userCount: userIdsFilter ? userIdsFilter.length : "all" });

  let docs;
  if (userIdsFilter && userIdsFilter.length > 0) {
    const snapshots = await Promise.all(userIdsFilter.map((id) => db.collection("users").doc(id).get()));
    docs = snapshots.filter((s) => s.exists).map((s) => ({ id: s.id, data: () => s.data() }));
  } else {
    const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
    docs = usersSnap.docs;
  }
  if (docs.length === 0) {
    console.log(`${prefix} 처리 대상 사용자 없음`);
    return;
  }

  for (let i = 0; i < docs.length; i += STRAVA_SYNC_CONCURRENCY) {
    const batch = docs.slice(i, i + STRAVA_SYNC_CONCURRENCY);
    const results = await Promise.all(
      batch.map((doc) => processOneUserStravaSync(db, doc.id, doc.data(), { afterUnix, beforeUnix }))
    );
    for (const r of results) {
      if (r.error) errors.push(`사용자 ${r.userId}: ${r.error}`);
      if (r.processed) processed += 1;
      newActivitiesTotal += r.newActivities || 0;
      if (r.userTss > 0) totalTssByUser[r.userId] = (totalTssByUser[r.userId] || 0) + r.userTss;
    }
  }

  for (const uid of Object.keys(totalTssByUser)) {
    const tss = totalTssByUser[uid];
    if (tss <= 0) continue;
    try {
      await updateUserMileageInFirestore(db, uid, tss);
    } catch (e) {
      errors.push(`사용자 ${uid}: 포인트 업데이트 실패 - ${e.message}`);
    }
  }

  console.log(`${prefix} 완료`, {
    processed,
    newActivities: newActivitiesTotal,
    errors: errors.length,
    dateFrom,
    dateTo,
  });
  if (errors.length) console.warn(`${prefix} 오류:`, errors);
}

/** 1000명 대비: Strava 동기화 청크 워커 (50명/요청). 스케줄러가 팬아웃 호출. */
const runStravaSyncChunkOptions = { cors: false, timeoutSeconds: 540 };
if (STRAVA_CLIENT_SECRET) {
  runStravaSyncChunkOptions.secrets = [STRAVA_CLIENT_SECRET];
}
exports.runStravaSyncChunk = onRequest(
  runStravaSyncChunkOptions,
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST only" });
      return;
    }
    const secret = req.headers["x-internal-secret"] || req.query.secret;
    if (secret !== INTERNAL_SYNC_SECRET) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    let body;
    try {
      body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    } catch (e) {
      res.status(400).json({ success: false, error: "Invalid JSON" });
      return;
    }
    const { startStr, endStr, dateFrom, dateTo, userIds } = body;
    const ids = Array.isArray(userIds) ? userIds.slice(0, STRAVA_SYNC_CHUNK_SIZE) : [];
    if (ids.length === 0) {
      res.status(200).json({ success: true, processed: 0 });
      return;
    }
    const pad = (n) => String(n).padStart(2, "0");
    const from = dateFrom || startStr;
    const to = dateTo || endStr;
    const startSeoul = new Date(`${from}T00:00:00+09:00`);
    const endSeoul = new Date(`${to}T23:59:59.999+09:00`);
    const afterUnix = Math.floor(startSeoul.getTime() / 1000);
    const beforeUnix = Math.floor(endSeoul.getTime() / 1000);
    const db = admin.firestore();
    await runStravaSyncForRange(
      db,
      { afterUnix, beforeUnix, dateFrom: from, dateTo: to },
      "[stravaSyncChunk]",
      ids
    );
    res.status(200).json({ success: true, userIds: ids.length });
  }
);

/**
 * Strava Athlete ID 마이그레이션 (1회성).
 * strava_refresh_token은 있으나 strava_athlete_id가 없는 유저에 대해 /athlete API로 ID 조회 후 업데이트.
 * Rate Limit 방어: 순차 처리 + 유저당 500ms 대기.
 */
const migrateStravaAthleteIdsOptions = { cors: false, timeoutSeconds: 540 };
if (STRAVA_CLIENT_SECRET) {
  migrateStravaAthleteIdsOptions.secrets = [STRAVA_CLIENT_SECRET];
}
exports.migrateStravaAthleteIds = onRequest(
  migrateStravaAthleteIdsOptions,
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const secret = req.headers["x-internal-secret"] || req.query.secret;
    if (secret !== INTERNAL_SYNC_SECRET) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    const db = admin.firestore();
    const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
    const candidates = [];
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      if (data.strava_athlete_id == null || data.strava_athlete_id === undefined) {
        candidates.push({ userId: doc.id, data });
      }
    }
    const total = candidates.length;
    let successCount = 0;
    let failCount = 0;
    for (const { userId, data } of candidates) {
      try {
        const tokenResult = await refreshStravaTokenForUser(db, userId);
        const accessToken = tokenResult.accessToken;
        const athleteRes = await fetch("https://www.strava.com/api/v3/athlete", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!athleteRes.ok) {
          failCount += 1;
          console.warn("[migrateStravaAthleteIds] /athlete 실패:", userId, athleteRes.status);
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        const athlete = await athleteRes.json().catch(() => ({}));
        const athleteId = athlete && athlete.id != null ? Number(athlete.id) : null;
        if (athleteId == null) {
          failCount += 1;
          console.warn("[migrateStravaAthleteIds] athlete.id 없음:", userId);
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        await db.collection("users").doc(userId).update({ strava_athlete_id: athleteId });
        successCount += 1;
        console.log("[migrateStravaAthleteIds] 성공:", userId, "→", athleteId);
      } catch (e) {
        failCount += 1;
        console.warn("[migrateStravaAthleteIds] 실패:", userId, e.message);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    res.status(200).json({
      success: true,
      total,
      successCount,
      failCount,
    });
  }
);

/** Strava API Rate Limit: 15분당 100회. 85회에서 중단하여 여유 확보. */
const STRAVA_API_CALL_LIMIT = 85;

/**
 * 수동 Strava 동기화 (과거 1~6개월, MMP 포함).
 * months / days / maxActivities+windowMonths / startDate~endDate 로 기간·건수 설정.
 * maxActivities: Strava after~before 구간(기본 최근 windowMonths개월)에서 최신순 최대 N개 활동만 처리.
 * Rate Limit: 활동당 1초 대기, API 85회 도달 시 중단, hasMore 반환.
 */
const manualStravaSyncWithMmpOptions = { cors: true, timeoutSeconds: 3600, memory: "1GiB" };
if (STRAVA_CLIENT_SECRET) {
  manualStravaSyncWithMmpOptions.secrets = [STRAVA_CLIENT_SECRET];
}
function setManualSyncCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  const allowed = CORS_ORIGINS.some((o) => (typeof o === "string" ? origin === o : o.test(origin)));
  res.set("Access-Control-Allow-Origin", (allowed && origin) ? origin : "https://stelvio.ai.kr");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

exports.manualStravaSyncWithMmp = onRequest(
  manualStravaSyncWithMmpOptions,
  async (req, res) => {
    setManualSyncCorsHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const forceRecalcTimeInZones = String(req.query?.forceRecalcTimeInZones || req.body?.forceRecalcTimeInZones || "").toLowerCase() === "true";
    const daysParam = req.query?.days || req.body?.days;
    const monthsParam = req.query?.months || req.body?.months;
    const maxActivitiesParam = req.query?.maxActivities ?? req.body?.maxActivities;
    const windowMonthsParam = req.query?.windowMonths ?? req.body?.windowMonths;
    const startDateParam = req.query?.startDate || req.body?.startDate;
    const endDateParam = req.query?.endDate || req.body?.endDate;
    const targetUsersParam = String(req.query?.targetUsers || req.body?.targetUsers || "").toLowerCase();
    let maxActivitiesCap = null;
    console.log("[manualStravaSyncWithMmp] 요청 수신:", req.method, "months=", monthsParam, "days=", daysParam, "maxActivities=", maxActivitiesParam, "windowMonths=", windowMonthsParam, "startDate=", startDateParam, "endDate=", endDateParam, "targetUsers=", targetUsersParam, "forceRecalcTimeInZones=", forceRecalcTimeInZones);

    try {
    const uid = await getUidFromRequest(req, res);
    if (!uid) {
      console.warn("[manualStravaSyncWithMmp] 인증 실패: Authorization Bearer 토큰 없음 또는 유효하지 않음");
      return;
    }
    console.log("[manualStravaSyncWithMmp] 인증 성공, userId:", uid);

    const db = admin.firestore();
    let userIdsToProcess = [uid];
    if (targetUsersParam === "all" || targetUsersParam === "admin") {
      if (!startDateParam || !endDateParam || !String(startDateParam).trim() || !String(endDateParam).trim()) {
        res.status(400).json({ success: false, error: "targetUsers=all|admin 사용 시 startDate와 endDate가 필요합니다." });
        return;
      }
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.exists ? callerSnap.data() : {};
      const callerGrade = String(callerData.grade ?? "2");
      if (callerGrade !== "1") {
        res.status(403).json({ success: false, error: "관리자(grade=1)만 사용할 수 있습니다." });
        return;
      }
      const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
      if (targetUsersParam === "admin") {
        userIdsToProcess = [uid];
        console.log("[manualStravaSyncWithMmp] 관리자 MMP: 현재 로그인 관리자 1명 대상");
      } else {
        userIdsToProcess = usersSnap.docs.map((d) => d.id);
      }
      console.log("[manualStravaSyncWithMmp] targetUsers=" + targetUsersParam + ", 대상 " + userIdsToProcess.length + "명");
    }

    let afterUnix;
    let beforeUnix;
    if (startDateParam && endDateParam && String(startDateParam).trim() && String(endDateParam).trim()) {
      const start = new Date(String(startDateParam).trim() + "T00:00:00");
      const end = new Date(String(endDateParam).trim() + "T23:59:59");
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ success: false, error: "startDate 또는 endDate 형식이 올바르지 않습니다. (YYYY-MM-DD)" });
        return;
      }
      if (start > end) {
        res.status(400).json({ success: false, error: "시작일이 종료일보다 늦을 수 없습니다." });
        return;
      }
      afterUnix = Math.floor(start.getTime() / 1000);
      beforeUnix = Math.floor(end.getTime() / 1000);
    } else {
      const now = new Date();
      beforeUnix = Math.floor(now.getTime() / 1000);
      const afterDate = new Date(now);
      const isBulkTarget = targetUsersParam === "all" || targetUsersParam === "admin";
      if (
        !isBulkTarget &&
        maxActivitiesParam != null &&
        maxActivitiesParam !== ""
      ) {
        maxActivitiesCap = Math.max(1, Math.min(200, parseInt(String(maxActivitiesParam), 10) || 30));
        const wm = Math.max(1, Math.min(12, parseInt(String(windowMonthsParam ?? "3"), 10) || 3));
        afterDate.setMonth(afterDate.getMonth() - wm);
      } else if (daysParam != null && daysParam !== "") {
        const days = Math.max(1, parseInt(daysParam, 10) || 10);
        afterDate.setDate(afterDate.getDate() - days);
      } else {
        const months = Math.min(6, Math.max(1, parseInt(monthsParam || "1", 10) || 1));
        afterDate.setMonth(afterDate.getMonth() - months);
      }
      afterUnix = Math.floor(afterDate.getTime() / 1000);
    }

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalCreated = 0;
    let globalApiCallCount = 0;

    for (const targetUid of userIdsToProcess) {
      if (globalApiCallCount >= STRAVA_API_CALL_LIMIT) {
        console.log("[manualStravaSyncWithMmp] API 한도 도달, 조기 종료");
        break;
      }
      try {
        const uid = targetUid;
        const userRef = db.collection("users").doc(uid);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
          console.warn("[manualStravaSyncWithMmp] 사용자 없음, 건너뜀:", uid);
          continue;
        }
    const userData = userSnap.data();
    const ftp = Number(userData.ftp) || 0;

    let accessToken;
    try {
      const tokenResult = await refreshStravaTokenForUser(db, uid);
      accessToken = tokenResult.accessToken;
    } catch (e) {
      console.warn("[manualStravaSyncWithMmp] 토큰 갱신 실패, 건너뜀:", uid, e.message);
      continue;
    }

    let apiCallCount = globalApiCallCount;
    const allActivities = [];
    let page = 1;
    const fetchActivitiesWithRetry = async (retriesLeft = 5) => {
      const actRes = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${afterUnix}&before=${beforeUnix}&per_page=200&page=${page}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (actRes.status === 429 && retriesLeft > 0) {
        await waitForStravaRateLimit(actRes);
        console.log(`[manualStravaSyncWithMmp] 429 재시도 (${retriesLeft}회 남음)`);
        return fetchActivitiesWithRetry(retriesLeft - 1);
      }
      return actRes;
    };
    while (apiCallCount < STRAVA_API_CALL_LIMIT) {
      if (page > 1) await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
      const actRes = await fetchActivitiesWithRetry();
      apiCallCount += 1;
      if (!actRes.ok) {
        throw new Error(`활동 조회 실패: ${actRes.status}`);
      }
      const pageActivities = await actRes.json().catch(() => []);
      if (page === 1) {
        console.log(`[manualStravaSyncWithMmp] userId=${uid} athlete_id=${userData.strava_athlete_id || "?"} 1st_page_activities=${Array.isArray(pageActivities) ? pageActivities.length : 0} status=${actRes.status}`);
      }
      if (!Array.isArray(pageActivities) || pageActivities.length === 0) break;
      allActivities.push(...pageActivities);
      if (maxActivitiesCap != null && allActivities.length >= maxActivitiesCap) break;
      if (pageActivities.length < 200) break;
      page += 1;
    }

    const activitiesToProcess =
      maxActivitiesCap != null ? allActivities.slice(0, maxActivitiesCap) : allActivities;
    if (maxActivitiesCap != null) {
      console.log(
        `[manualStravaSyncWithMmp] userId=${uid} maxActivitiesCap=${maxActivitiesCap} fetched=${allActivities.length} process=${activitiesToProcess.length}`
      );
    }

    const logsRef = db.collection("users").doc(uid).collection("logs");
    const stelvioDates = await getStelvioLogDates(db, uid);
    const stelvioDateStravaTssAccumulator = new Map();
    const dateOnlyStravaTss = new Map();
    let processedCount = 0;
    let updatedCount = 0;
    let createdCount = 0;
    let userTss = 0;

    for (const act of activitiesToProcess) {
      if (apiCallCount >= STRAVA_API_CALL_LIMIT) break;
      const actId = String(act.id);
      let logDocRef = logsRef.doc(actId);
      let logSnap = await logDocRef.get();
      if (!logSnap.exists) {
        const qSnap = await logsRef.where("activity_id", "==", actId).limit(1).get();
        if (!qSnap.empty) {
          logDocRef = qSnap.docs[0].ref;
          logSnap = qSnap.docs[0];
        }
      }
      const exists = logSnap.exists;

      if (exists) {
        const existingData = logSnap.data();
        const powerFields = ['max_1min_watts', 'max_5min_watts', 'max_10min_watts', 'max_20min_watts', 'max_30min_watts', 'max_40min_watts', 'max_60min_watts', 'max_watts'];
        const hrFields = ['max_hr_5sec', 'max_hr_1min', 'max_hr_5min', 'max_hr_10min', 'max_hr_20min', 'max_hr_40min', 'max_hr_60min', 'max_hr'];
        const needsMmp = powerFields.some((f) => isEmptyMmpValue(existingData[f]));
        const needsHrPeaks = hrFields.some((f) => isEmptyMmpValue(existingData[f]));
        const needsTimeInZones = forceRecalcTimeInZones || !existingData.time_in_zones || !existingData.time_in_zones.power;
        const needsWeight = existingData.weight == null;
        const needsActivityType = !String(existingData.activity_type || "").trim();
        if (needsMmp || needsHrPeaks || needsTimeInZones || needsWeight || needsActivityType) {
          if (apiCallCount >= STRAVA_API_CALL_LIMIT) break;
          const updateData = {};
          if (needsActivityType) {
            const at = String(act.sport_type || act.type || "").trim() || null;
            if (at) updateData.activity_type = at;
          }
          await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
          const streamsRes = await fetchStravaStreams(accessToken, actId);
          apiCallCount += 1;
          const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
            ? Number(userData.weight ?? userData.weightKg)
            : null;
          if (needsWeight && userWeight != null) updateData.weight = userWeight;
          const rawWatts = streamsRes.success && Array.isArray(streamsRes.watts) ? streamsRes.watts : null;
          const wattsArray = rawWatts && rawWatts.length > 0 ? smoothPowerSpikes(rawWatts) : null;
          console.log(`[manualStravaSyncWithMmp] [Activity ID: ${actId}] Watts Array Length:`, wattsArray?.length || 0);
          if (wattsArray && wattsArray.length > 0) {
            updateData.max_1min_watts = calculateMaxAveragePower(wattsArray, 60);
            updateData.max_5min_watts = calculateMaxAveragePower(wattsArray, 300);
            updateData.max_10min_watts = calculateMaxAveragePower(wattsArray, 600);
            updateData.max_20min_watts = calculateMaxAveragePower(wattsArray, 1200);
            updateData.max_30min_watts = calculateMaxAveragePower(wattsArray, 1800);
            updateData.max_40min_watts = calculateMaxAveragePower(wattsArray, 2400);
            updateData.max_60min_watts = calculateMaxAveragePower(wattsArray, 3600);
            const streamMax = Math.max(...wattsArray.map((w) => Number(w) || 0));
            if (streamMax > 0) updateData.max_watts = Math.round(streamMax);
            else if (act.max_watts != null) updateData.max_watts = Number(act.max_watts);
            console.log(`[manualStravaSyncWithMmp] [Activity ID: ${actId}] Calculated MMP: 1m=${updateData.max_1min_watts}, 5m=${updateData.max_5min_watts}, 10m=${updateData.max_10min_watts}, 20m=${updateData.max_20min_watts}, 30m=${updateData.max_30min_watts}, 40m=${updateData.max_40min_watts}, 60m=${updateData.max_60min_watts}, max=${updateData.max_watts || "?"}`);
          }
          const hrPeaks = streamsRes.success && Array.isArray(streamsRes.heartrate) && streamsRes.heartrate.length > 0 ? calculateMaxHeartRatePeaks(streamsRes.heartrate) : null;
          if (hrPeaks) {
            if (hrPeaks.max_hr_5sec != null) updateData.max_hr_5sec = hrPeaks.max_hr_5sec;
            if (hrPeaks.max_hr_1min != null) updateData.max_hr_1min = hrPeaks.max_hr_1min;
            if (hrPeaks.max_hr_5min != null) updateData.max_hr_5min = hrPeaks.max_hr_5min;
            if (hrPeaks.max_hr_10min != null) updateData.max_hr_10min = hrPeaks.max_hr_10min;
            if (hrPeaks.max_hr_20min != null) updateData.max_hr_20min = hrPeaks.max_hr_20min;
            if (hrPeaks.max_hr_40min != null) updateData.max_hr_40min = hrPeaks.max_hr_40min;
            if (hrPeaks.max_hr_60min != null) updateData.max_hr_60min = hrPeaks.max_hr_60min;
            if (hrPeaks.max_hr != null) updateData.max_hr = hrPeaks.max_hr;
          }
          if (streamsRes.success && (streamsRes.watts?.length > 0 || streamsRes.heartrate?.length > 0)) {
            const effectiveFtp = getFTPWithFallback(userData, streamsRes.watts || []);
            const timeInZones = await calculateZoneTimesFromStreams({
              wattsArray: streamsRes.watts || [],
              hrArray: streamsRes.heartrate || [],
              ftp: effectiveFtp,
              userId: uid,
              db,
              dateStr: existingData.date || "",
            });
            updateData.time_in_zones = timeInZones;
          }
          if (Object.keys(updateData).length > 0) {
            await logDocRef.update(updateData);
            updatedCount += 1;
          }
          processedCount += 1;
        }
      } else {
        if (apiCallCount >= STRAVA_API_CALL_LIMIT - 1) break;
        await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
        const detailRes = await fetchStravaActivityDetail(accessToken, actId);
        apiCallCount += 1;
        if (!detailRes.success || !detailRes.activity) {
          await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
          continue;
        }
        await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
        const streamsRes = await fetchStravaStreams(accessToken, actId);
        apiCallCount += 1;
        const activity = detailRes.activity;
        const mapped = mapStravaActivityToLogSchema(activity, uid, ftp, userData.weight ?? userData.weightKg);
        const rawWatts = streamsRes.success && Array.isArray(streamsRes.watts) ? streamsRes.watts : null;
        const wattsArray = rawWatts && rawWatts.length > 0 ? smoothPowerSpikes(rawWatts) : null;
        console.log(`[manualStravaSyncWithMmp] [Activity ID: ${actId}] Watts Array Length:`, wattsArray?.length || 0);
        let max1minWatts = null;
        let max5minWatts = null;
        let max10minWatts = null;
        let max20minWatts = null;
        let max30minWatts = null;
        let max40minWatts = null;
        let max60minWatts = null;
        let maxWattsFromStream = null;
        if (wattsArray && wattsArray.length > 0) {
          max1minWatts = calculateMaxAveragePower(wattsArray, 60);
          max5minWatts = calculateMaxAveragePower(wattsArray, 300);
          max10minWatts = calculateMaxAveragePower(wattsArray, 600);
          max20minWatts = calculateMaxAveragePower(wattsArray, 1200);
          max30minWatts = calculateMaxAveragePower(wattsArray, 1800);
          max40minWatts = calculateMaxAveragePower(wattsArray, 2400);
          max60minWatts = calculateMaxAveragePower(wattsArray, 3600);
          const streamMax = Math.max(...wattsArray.map((w) => Number(w) || 0));
          if (streamMax > 0) maxWattsFromStream = Math.round(streamMax);
          console.log(`[manualStravaSyncWithMmp] [Activity ID: ${actId}] Calculated MMP: 1m=${max1minWatts}, 5m=${max5minWatts}, 10m=${max10minWatts}, 20m=${max20minWatts}, 30m=${max30minWatts}, 40m=${max40minWatts}, 60m=${max60minWatts}, max=${maxWattsFromStream}`);
        }
        const hrPeaks = streamsRes.success && Array.isArray(streamsRes.heartrate) && streamsRes.heartrate.length > 0 ? calculateMaxHeartRatePeaks(streamsRes.heartrate) : null;
        let timeInZones = mapped.time_in_zones;
        if (streamsRes.success && (streamsRes.watts?.length > 0 || streamsRes.heartrate?.length > 0)) {
          const effectiveFtp = getFTPWithFallback(userData, streamsRes.watts || []);
          timeInZones = await calculateZoneTimesFromStreams({
            wattsArray: streamsRes.watts || [],
            hrArray: streamsRes.heartrate || [],
            ftp: effectiveFtp,
            userId: uid,
            db,
            dateStr: mapped.date || "",
          });
        }
        const tssAppliedAt = new Date().toISOString();
        const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
          ? Number(userData.weight ?? userData.weightKg)
          : null;
        const logDoc = {
          activity_id: mapped.activity_id,
          user_id: mapped.user_id,
          source: mapped.source,
          activity_type: mapped.activity_type ?? null,
          date: mapped.date,
          title: mapped.title,
          distance_km: mapped.distance_km,
          duration_sec: mapped.duration_sec,
          time: mapped.time,
          avg_cadence: mapped.avg_cadence,
          avg_hr: mapped.avg_hr,
          max_hr: mapped.max_hr,
          avg_watts: mapped.avg_watts,
          max_watts: maxWattsFromStream ?? mapped.max_watts,
          weighted_watts: mapped.weighted_watts,
          kilojoules: mapped.kilojoules,
          elevation_gain: mapped.elevation_gain,
          avg_speed_kmh: mapped.avg_speed_kmh ?? null,
          left_right_balance: mapped.left_right_balance ?? null,
          pedal_smoothness_left: mapped.pedal_smoothness_left ?? null,
          pedal_smoothness_right: mapped.pedal_smoothness_right ?? null,
          torque_effectiveness_left: mapped.torque_effectiveness_left ?? null,
          torque_effectiveness_right: mapped.torque_effectiveness_right ?? null,
          rpe: mapped.rpe,
          ftp_at_time: mapped.ftp_at_time,
          if: mapped.if,
          tss: mapped.tss,
          efficiency_factor: mapped.efficiency_factor,
          time_in_zones: timeInZones,
          earned_points: mapped.earned_points,
          workout_id: mapped.workout_id,
          tss_applied: true,
          tss_applied_at: tssAppliedAt,
          created_at: mapped.created_at,
          max_1min_watts: max1minWatts,
          max_5min_watts: max5minWatts,
          max_10min_watts: max10minWatts,
          max_20min_watts: max20minWatts,
          max_30min_watts: max30minWatts,
          max_40min_watts: max40minWatts,
          max_60min_watts: max60minWatts,
        };
        if (hrPeaks) {
          if (hrPeaks.max_hr_5sec != null) logDoc.max_hr_5sec = hrPeaks.max_hr_5sec;
          if (hrPeaks.max_hr_1min != null) logDoc.max_hr_1min = hrPeaks.max_hr_1min;
          if (hrPeaks.max_hr_5min != null) logDoc.max_hr_5min = hrPeaks.max_hr_5min;
          if (hrPeaks.max_hr_10min != null) logDoc.max_hr_10min = hrPeaks.max_hr_10min;
          if (hrPeaks.max_hr_20min != null) logDoc.max_hr_20min = hrPeaks.max_hr_20min;
          if (hrPeaks.max_hr_40min != null) logDoc.max_hr_40min = hrPeaks.max_hr_40min;
          if (hrPeaks.max_hr_60min != null) logDoc.max_hr_60min = hrPeaks.max_hr_60min;
          if (hrPeaks.max_hr != null) logDoc.max_hr = hrPeaks.max_hr;
        }
        if (userWeight != null) logDoc.weight = userWeight;
        // Run/Swim/Walk/TrailRun/WeightTraining 등 비라이딩 활동은 저장하지 않음
        if (!isCyclingForMmp(mapped)) {
          console.log(`[manualStravaSyncWithMmp] 비라이딩 활동 저장 제외: uid=${uid} actId=${actId} activity_type=${mapped.activity_type}`);
          continue;
        }
        await logDocRef.set(logDoc, { merge: true });
        createdCount += 1;
        processedCount += 1;
        const dateStr = mapped.date || "";
        const activityTss = mapped.tss || 0;
        const distanceKm = mapped.distance_km || 0;
        if (isCyclingForMmp(mapped) && activityTss > 0 && distanceKm !== 0) {
          if (stelvioDates.has(dateStr)) {
            const prev = stelvioDateStravaTssAccumulator.get(dateStr) || 0;
            stelvioDateStravaTssAccumulator.set(dateStr, prev + activityTss);
          } else {
            const prev = dateOnlyStravaTss.get(dateStr) || 0;
            dateOnlyStravaTss.set(dateStr, prev + activityTss);
          }
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    for (const [dateStr, tss] of dateOnlyStravaTss) {
      if (tss < TSS_PER_DAY_CHEAT_THRESHOLD) userTss += tss;
    }
    for (const [dateStr, stravaSum] of stelvioDateStravaTssAccumulator) {
      const stelvioPoints = await getStelvioPointsForDate(db, uid, dateStr);
      const dayTotal = stelvioPoints + (stravaSum || 0);
      if (dayTotal >= TSS_PER_DAY_CHEAT_THRESHOLD) continue; // 1일 500+ TSS 치팅: 포인트 적립 제외
      const diff = Math.max(0, (stravaSum || 0) - (stelvioPoints || 0));
      if (diff > 0) userTss += diff;
    }
    if (userTss > 0) {
      try {
        await updateUserMileageInFirestore(db, uid, userTss);
      } catch (e) {
        console.warn("[manualStravaSyncWithMmp] 포인트 업데이트 실패:", e.message);
      }
    }

    globalApiCallCount = apiCallCount;
    totalProcessed += processedCount;
    totalUpdated += updatedCount;
    totalCreated += createdCount;
    } catch (userErr) {
      console.warn("[manualStravaSyncWithMmp] 사용자 처리 실패:", targetUid, userErr.message);
    }
    }

    const hasMore = globalApiCallCount >= STRAVA_API_CALL_LIMIT;
    res.status(200).json({
      success: true,
      processedCount: totalProcessed,
      updatedCount: totalUpdated,
      createdCount: totalCreated,
      hasMore,
      apiCallCount: globalApiCallCount,
    });
    } catch (err) {
      console.error("[manualStravaSyncWithMmp] 오류:", err);
      res.status(500).json({ success: false, error: err.message || "동기화 중 오류가 발생했습니다." });
    }
  }
);

/** 스케줄 실행 시 1000명 대비: 인원 > 100이면 청크 URL로 팬아웃, 아니면 in-process 병렬 처리 */
async function runStravaSyncWithFanOut(db, range, logPrefix, getChunkUrl) {
  const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
  const userIds = usersSnap.docs.map((d) => d.id);
  if (userIds.length === 0) {
    console.log(`${logPrefix} Strava 연결 사용자 없음`);
    return;
  }
  if (userIds.length <= STRAVA_SYNC_CHUNK_THRESHOLD) {
    await runStravaSyncForRange(db, range, logPrefix, null);
    return;
  }
  const chunkUrl = typeof getChunkUrl === "function" ? await getChunkUrl() : null;
  if (!chunkUrl) {
    console.warn(`${logPrefix} 청크 URL 미설정(appConfig/sync.runStravaSyncChunkUrl), in-process로 진행 (${userIds.length}명)`);
    await runStravaSyncForRange(db, range, logPrefix, null);
    return;
  }
  const chunks = [];
  for (let i = 0; i < userIds.length; i += STRAVA_SYNC_CHUNK_SIZE) {
    chunks.push(userIds.slice(i, i + STRAVA_SYNC_CHUNK_SIZE));
  }
  const { dateFrom, dateTo, afterUnix, beforeUnix } = range;
  const results = await Promise.all(
    chunks.map((userIdsChunk) =>
      fetch(chunkUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": INTERNAL_SYNC_SECRET,
        },
        body: JSON.stringify({
          startStr: dateFrom,
          endStr: dateTo,
          dateFrom,
          dateTo,
          userIds: userIdsChunk,
        }),
      })
    )
  );
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.warn(`${logPrefix} 청크 실패 ${failed.length}/${chunks.length}`, failed.map((r) => r.status));
  }
  console.log(`${logPrefix} 팬아웃 완료`, { chunks: chunks.length, totalUsers: userIds.length });
}

/**
 * 매일 새벽 2시(Asia/Seoul)에 전날 Strava 활동 수집. 1000명 대비 청크 팬아웃.
 */
const stravaSyncScheduleOptions = {
  schedule: "0 2 * * *",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 540,
};
if (STRAVA_CLIENT_SECRET) {
  stravaSyncScheduleOptions.secrets = [STRAVA_CLIENT_SECRET];
}
exports.stravaSyncPreviousDay = onSchedule(
  stravaSyncScheduleOptions,
  async (event) => {
    const db = admin.firestore();
    const range = getYesterdayAfterBefore();
    const getChunkUrl = async () => {
      const snap = await db.collection("appConfig").doc("sync").get();
      return snap.exists ? snap.data().runStravaSyncChunkUrl || null : null;
    };
    await runStravaSyncWithFanOut(db, range, "[stravaSyncPreviousDay]", getChunkUrl);
  }
);

/**
 * 일요일 19시(Asia/Seoul)에 당일(일요일) Strava 로그 수집. 1000명 대비 청크 팬아웃.
 */
const stravaSyncSundayOptions = {
  schedule: "0 19 * * 0",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 540,
};
if (STRAVA_CLIENT_SECRET) {
  stravaSyncSundayOptions.secrets = [STRAVA_CLIENT_SECRET];
}
exports.stravaSyncSunday = onSchedule(
  stravaSyncSundayOptions,
  async (event) => {
    const db = admin.firestore();
    const range = getTodayAfterBefore();
    const getChunkUrl = async () => {
      const snap = await db.collection("appConfig").doc("sync").get();
      return snap.exists ? snap.data().runStravaSyncChunkUrl || null : null;
    };
    await runStravaSyncWithFanOut(db, range, "[stravaSyncSunday]", getChunkUrl);
  }
);

/**
 * 수동/긴급: Asia/Seoul 기준 오늘(00:00~23:59) Strava 로그 재수집.
 * 새벽 배치·웹훅 누락 보완 시 사용. stravaSyncSunday와 동일한 기간 로직 및 청크 팬아웃.
 * 인증: X-Internal-Secret(STELVIO 내부, runStravaSyncChunk 동일) 또는 관리자(grade=1) Firebase Bearer.
 */
const manualStravaSyncTodaySeoulOptions = {
  region: "asia-northeast3",
  cors: false,
  timeoutSeconds: 540,
};
if (STRAVA_CLIENT_SECRET) {
  manualStravaSyncTodaySeoulOptions.secrets = [STRAVA_CLIENT_SECRET];
}
exports.manualStravaSyncTodaySeoul = onRequest(
  manualStravaSyncTodaySeoulOptions,
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST only" });
      return;
    }
    try {
      const db = admin.firestore();
      const rawSecret =
        req.headers["x-internal-secret"] ||
        req.headers["X-Internal-Secret"] ||
        req.query.secret;
      let authorized = rawSecret === INTERNAL_SYNC_SECRET;

      if (!authorized) {
        const uid = await getUidFromRequest(req, res);
        if (!uid) return;
        const callerSnap = await db.collection("users").doc(uid).get();
        const grade = callerSnap.exists ? String((callerSnap.data() || {}).grade ?? "2") : "2";
        if (grade !== "1") {
          res.status(403).json({
            success: false,
            error: "관리자(grade=1) 또는 X-Internal-Secret 헤더가 필요합니다.",
          });
          return;
        }
        authorized = true;
      }

      const range = getTodayAfterBefore();
      const getChunkUrl = async () => {
        const snap = await db.collection("appConfig").doc("sync").get();
        return snap.exists ? snap.data().runStravaSyncChunkUrl || null : null;
      };
      await runStravaSyncWithFanOut(db, range, "[manualStravaSyncTodaySeoul]", getChunkUrl);
      res.status(200).json({
        success: true,
        message:
          "오늘(Asia/Seoul) 구간 Strava 동기화를 실행했습니다. Functions 로그 [manualStravaSyncTodaySeoul] / 청크 [stravaSyncChunk] 를 확인하세요.",
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        afterUnix: range.afterUnix,
        beforeUnix: range.beforeUnix,
      });
    } catch (err) {
      console.error("[manualStravaSyncTodaySeoul]", err);
      res.status(500).json({
        success: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }
);

// ---------- 주간 마일리지 TOP10 랭킹 (Choose Your Path 입장 시 팝업) ----------
/** 현재 주 월요일 00:00 ~ 오늘 23:59 (Asia/Seoul) 날짜 문자열 반환. weekOffset: 0=현재주, -1=전주 */
function getWeekRangeSeoul(weekOffset = 0) {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [y, m, d] = todayStr.split("-").map(Number);
  const today = new Date(y, m - 1, d);
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  if (weekOffset < 0) {
    monday.setDate(monday.getDate() + weekOffset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const pad = (n) => String(n).padStart(2, "0");
    const startStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
    const endStr = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
    return { startStr, endStr };
  }
  const pad = (n) => String(n).padStart(2, "0");
  const startStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  const endStr = `${y}-${pad(m)}-${pad(d)}`;
  return { startStr, endStr };
}

/** 사용자 로그에서 주간 TSS 합계 (날짜별: strava 우선, 없으면 stelvio) — ranking_day_totals 일 버킹 집계 */
async function getWeeklyTssForUser(db, userId, startStr, endStr, userDataCached = null) {
  try {
    const userData = userDataCached
      ?? (await db.collection("users").doc(userId).get()).data()
      ?? {};
    return await rankingDayRollup.weeklyTssSumFromDayBuckets(db, userId, userData, startStr, endStr);
  } catch (e) {
    console.warn("[getWeeklyTssForUser]", userId, e.message);
    return 0;
  }
}

/** 사용자 로그에서 기간 내 라이딩 거리 합계(km) — ranking_day_totals 기반 */
async function getRolling30dCyclingKmForUser(db, userId, startStr, endStr, userDataCached = null) {
  try {
    const userData = userDataCached
      ?? (await db.collection("users").doc(userId).get()).data()
      ?? {};
    return await rankingDayRollup.rollingKmSumFromDayBuckets(db, userId, userData, startStr, endStr);
  } catch (e) {
    console.warn("[getRolling30dCyclingKmForUser]", userId, e.message);
    return 0;
  }
}

/** 해당 주간에 1일 500 이상 TSS가 있는지 여부 (포인트 적립 제외 판단용) */
async function hasWeeklyTssCheatDay(db, userId, startStr, endStr) {
  try {
    const us = await db.collection("users").doc(userId).get();
    const userData = us.exists ? us.data() : {};
    return await rankingDayRollup.cheatDayPresentFromBuckets(db, userId, userData, startStr, endStr);
  } catch (e) {
    console.warn("[hasWeeklyTssCheatDay]", userId, e.message);
    return false;
  }
}

const WEEKLY_RANKING_CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const WEEKLY_TSS_BATCH_SIZE = 50; // 1000명 대비: 20배치로 완료

/**
 * 주간 마일리지 TOP10 / getWeeklyRanking — TSS 랭킹보드 탭과 동일 풀·정렬
 * (리그 분류 가능 사용자만, getWeeklyTssForUser 동일, gender=all)
 */
async function getWeeklyRankingEntries(db, startStr, endStr, usersSnap = null) {
  const { entries } = await getWeeklyTssRankingBoardEntries(db, startStr, endStr, "all", usersSnap);
  return entries.map((e) => ({
    userId: e.userId,
    name: e.name,
    totalTss: e.totalTss,
    is_private: privacyFlagFromFirestoreDoc(e),
  }));
}

/** 주간 랭킹 TOP10 조회 (캐시 5분 + 병렬 50명/배치, 1000명 대비 타임아웃 9분)
 * 쿼리: week=prev → 전주 랭킹 (새 주 시작 후 현재주 순위자 없을 때 사용) */
exports.getWeeklyRanking = onRequest(
  { cors: true, timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const db = admin.firestore();
    const weekParam = (req.query && req.query.week) || "";
    const userIdParam = (req.query && req.query.userId) || "";
    const usePrevWeek = weekParam === "prev";
    const { startStr, endStr } = usePrevWeek ? getWeekRangeSeoul(-1) : getWeekRangeSeoul();
    const weeklyAggKey = `weekly_ranking_full_${startStr}_${endStr}`;
    const weeklyAgg = await readRankingAggregatePayloadIfFresh(db, weeklyAggKey);
    const aggMatchesWeek =
      weeklyAgg &&
      weeklyAgg.startStr === startStr &&
      weeklyAgg.endStr === endStr &&
      Array.isArray(weeklyAgg.fullEntries) &&
      weeklyAgg.fullEntries.length > 0;

    const buildWeeklyRankingResponse = (entries, precomputed) => {
      const top10 = entries.slice(0, 10).map((e, i) => ({
        rank: i + 1,
        userId: e.userId,
        name: e.name,
        totalTss: Math.round(e.totalTss * 100) / 100,
        is_private: e.is_private === true,
        profileImageUrl: e.profileImageUrl || null,
      }));
      let myRank = null;
      if (userIdParam) {
        const userIdx = entries.findIndex((e) => e.userId === userIdParam);
        if (userIdx >= 10) {
          const e = entries[userIdx];
          myRank = {
            rank: userIdx + 1,
            userId: e.userId,
            name: e.name,
            totalTss: Math.round(e.totalTss * 100) / 100,
            is_private: e.is_private === true,
            profileImageUrl: e.profileImageUrl || null,
          };
        }
      }
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cache-Control", "public, max-age=120");
      const rankBody = {
        success: true,
        ranking: top10,
        startStr,
        endStr,
        myRank: myRank || undefined,
      };
      if (precomputed === true) rankBody.precomputed = true;
      else if (precomputed === false) rankBody.liveComputed = true;
      return res.status(200).json(rankBody);
    };

    if (aggMatchesWeek) {
      await hydrateRankingBoardPrivacyFromUsers(db, { Supremo: weeklyAgg.fullEntries }, weeklyAgg.fullEntries);
      await hydrateRankingBoardProfileImages(db, { Supremo: weeklyAgg.fullEntries }, weeklyAgg.fullEntries);
      return buildWeeklyRankingResponse(weeklyAgg.fullEntries, true);
    }

    // 구버전 cache/* 문서는 startStr/endStr가 일치할 때만 사용 (집계 주간과 불일치 시 잘못된 주차 데이터 노출 방지)
    const cacheRef = db.collection("cache").doc(usePrevWeek ? "weeklyRankingPrev" : "weeklyRanking");
    const cacheSnap = await cacheRef.get();
    const nowMs = Date.now();
    if (cacheSnap.exists) {
      const data = cacheSnap.data() || {};
      const legacyStart = data.startStr != null ? String(data.startStr) : "";
      const legacyEnd = data.endStr != null ? String(data.endStr) : "";
      const ranking = Array.isArray(data.ranking) ? data.ranking : [];
      const legacyMatches = legacyStart === startStr && legacyEnd === endStr && ranking.length > 0;
      if (legacyMatches) {
        const fullEntries = Array.isArray(data.fullEntries) ? data.fullEntries : [];
        const mergeHydrate = ranking.concat(fullEntries);
        if (mergeHydrate.length) {
          await hydrateRankingBoardPrivacyFromUsers(db, { Supremo: mergeHydrate }, null);
          await hydrateRankingBoardProfileImages(db, { Supremo: mergeHydrate }, null);
        }
        const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
        const ageMin = updatedAt ? Math.round((nowMs - updatedAt) / 60000) : null;
        let myRank = null;
        if (userIdParam && fullEntries.length) {
          const userIdx = fullEntries.findIndex((e) => e.userId === userIdParam);
          if (userIdx >= 10) {
            const e = fullEntries[userIdx];
            myRank = {
              rank: userIdx + 1,
              userId: e.userId,
              name: e.name,
              totalTss: Math.round((e.totalTss || 0) * 100) / 100,
              is_private: e.is_private === true,
              profileImageUrl: e.profileImageUrl || null,
            };
          }
        }
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Cache-Control", "public, max-age=120");
        return res.status(200).json({
          success: true,
          ranking: ranking.map((e) => ({
            rank: e.rank,
            userId: e.userId,
            name: e.name,
            totalTss: e.totalTss,
            is_private: e.is_private === true,
            profileImageUrl: e.profileImageUrl || null,
          })),
          startStr,
          endStr,
          myRank: myRank || undefined,
          cached: true,
          stale: true,
          cacheAgeMin: ageMin,
          rebuilding: true,
        });
      }
    }

    // 사전 집계 miss·구캐시 불일치: 요청 주간 구간으로 즉시 산출 (신규 주 월요일 아침·집계 stale 구간 등)
    try {
      const liveEntries = await getWeeklyRankingEntries(db, startStr, endStr);
      if (liveEntries.length > 0) {
        try {
          await writeRankingAggregatePayload(db, weeklyAggKey, {
            fullEntries: liveEntries,
            ranking: liveEntries.slice(0, 10).map((e, i) => ({
              rank: i + 1,
              userId: e.userId,
              name: e.name,
              totalTss: Math.round(e.totalTss * 100) / 100,
              is_private: e.is_private === true,
            })),
            startStr,
            endStr,
          });
        } catch (writeErr) {
          console.warn("[getWeeklyRanking] aggregate write after live compute:", writeErr && writeErr.message ? writeErr.message : writeErr);
        }
        return buildWeeklyRankingResponse(liveEntries, false);
      }
    } catch (liveErr) {
      console.error("[getWeeklyRanking] live getWeeklyRankingEntries failed:", liveErr && liveErr.message ? liveErr.message : liveErr);
    }

    res.set("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      success: true,
      ranking: [],
      startStr,
      endStr,
      rebuilding: true,
      message: "랭킹 집계 준비 중입니다. 잠시 후 다시 시도해주세요.",
    });
  }
);

/** 일요일 21:00 Asia/Seoul 주간 랭킹 확정 및 1/2/3등 포인트 지급 (1000명 대비 타임아웃 9분)
 * 1일 500+ TSS 치팅: 합산 제외 + 포인트 적립 대상에서도 제외 (hasWeeklyTssCheatDay) */
const finalizeWeeklyOptions = {
  schedule: "0 21 * * 0",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 540,
};
exports.finalizeWeeklyRanking = onSchedule(
  finalizeWeeklyOptions,
  async (event) => {
    const db = admin.firestore();
    const { startStr, endStr } = getWeekRangeSeoul();
    const entries = await getWeeklyRankingEntries(db, startStr, endStr); // 500+ TSS/일 제외된 합산 기준
    const pointRecipients = [];
    for (const e of entries) {
      if (pointRecipients.length >= 3) break;
      const hasCheat = await hasWeeklyTssCheatDay(db, e.userId, startStr, endStr);
      if (!hasCheat) pointRecipients.push({ ...e, rank: pointRecipients.length + 1 });
    }
    const points = [100, 50, 30]; // 1등 100SP, 2등 50SP, 3등 30SP
    for (let i = 0; i < pointRecipients.length; i++) {
      const u = pointRecipients[i];
      const userRef = db.collection("users").doc(u.userId);
      const snap = await userRef.get();
      if (!snap.exists) continue;
      const data = snap.data();
      const add = points[i];
      const rem = Number(data.rem_points || 0) + add;
      const acc = Number(data.acc_points || 0) + add;
      await userRef.update({ rem_points: rem, acc_points: acc });
      console.log("[finalizeWeeklyRanking] 포인트 지급:", (i + 1) + "등", u.name, "+" + add + "SP → rem_points:", rem, ", acc_points:", acc);
    }
    console.log("[finalizeWeeklyRanking] 완료", { startStr, endStr, pointRecipients: pointRecipients.map((e) => e.name) });
  }
);

// ---------- STELVIO 랭킹 보드 (피크 파워 W/kg 기반) ----------
const DURATION_FIELDS = {
  "1min": "max_1min_watts",
  "5min": "max_5min_watts",
  "10min": "max_10min_watts",
  "20min": "max_20min_watts",
  "40min": "max_40min_watts",
  "60min": "max_60min_watts",
  max: "max_watts",
};

/** 구간별 심박 피크 필드 (로그 집계·코호트 평균 심박용) */
const DURATION_HR_FIELDS = {
  "1min": "max_hr_1min",
  "5min": "max_hr_5min",
  "10min": "max_hr_10min",
  "20min": "max_hr_20min",
  "40min": "max_hr_40min",
  "60min": "max_hr_60min",
};

/** Andrew Coggan World Class 한계치 - 초과 시 센서 오류(이상치)로 간주. W/kg OR 절대 W 중 하나라도 초과하면 제외 */
const PEAK_POWER_LIMITS = {
  max: { wkg: 25.0, watts: 2200 },
  "1min": { wkg: 12.0, watts: 900 },
  "5min": { wkg: 8.0, watts: 700 },
  "10min": { wkg: 7.0, watts: 600 },
  "20min": { wkg: 6.5, watts: 550 },
  "40min": { wkg: 6.0, watts: 500 },
  "60min": { wkg: 5.8, watts: 450 },
};

const POWER_SPIKE_THRESHOLD_W = 2000;
const POWER_SPIKE_JUMP_W = 1000;
const HR_MAX_BPM = 220;
/** 심박 스파이크: 1초 만에 HR_SPIKE_JUMP_BPM 이상 튀는 값 → 인접 평균으로 대체 */
const HR_SPIKE_JUMP_BPM = 25;
const DEFAULT_FTP_W = 150;
const DEFAULT_MAX_HR = 190;

/**
 * 1초 단위 Raw Data에서 2000W 초과 스파이크 및 1초 만에 1000W 이상 튀는 값을 직전 3초·직후 3초 평균으로 대체
 * @param {number[]} rawDataArray - 1초당 1개 파워 값 배열
 * @returns {number[]} 스파이크 보간된 배열 (원본 변경 없음)
 */
function smoothPowerSpikes(rawDataArray) {
  if (!rawDataArray || rawDataArray.length === 0) return rawDataArray;
  const arr = rawDataArray.map((v) => Number(v) || 0);
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const prev = i > 0 ? arr[i - 1] : arr[i];
    const isOverThreshold = arr[i] > POWER_SPIKE_THRESHOLD_W;
    const isSpikeJump = i > 0 && Math.abs(arr[i] - prev) > POWER_SPIKE_JUMP_W;
    if (!isOverThreshold && !isSpikeJump) continue;
    const before = [];
    for (let b = 1; b <= 3; b++) {
      if (i - b >= 0) before.push(arr[i - b]);
    }
    const after = [];
    for (let a = 1; a <= 3; a++) {
      if (i + a < len) after.push(arr[i + a]);
    }
    const combined = [...before, ...after];
    arr[i] = combined.length > 0
      ? Math.round(combined.reduce((s, v) => s + v, 0) / combined.length)
      : POWER_SPIKE_THRESHOLD_W;
  }
  return arr;
}

/**
 * 심박 스트림에서 평균 대비 갑자기 튀는 값(스파이크) 제거 → 인접값 평균으로 대체
 * - 1초 만에 HR_SPIKE_JUMP_BPM(25) 이상 변동 시 스파이크로 간주
 * - 220bpm 초과도 스파이크로 간주
 * @param {number[]} rawHrArray - 1초당 1개 심박 값 배열
 * @returns {number[]} 스파이크 보간된 배열
 */
function smoothHeartRateSpikes(rawHrArray) {
  if (!rawHrArray || rawHrArray.length === 0) return rawHrArray || [];
  const arr = rawHrArray.map((v) => Number(v) || 0);
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const prev = i > 0 ? arr[i - 1] : arr[i];
    const isOverMax = arr[i] > HR_MAX_BPM;
    const isSpikeJump = i > 0 && Math.abs(arr[i] - prev) > HR_SPIKE_JUMP_BPM;
    if (!isOverMax && !isSpikeJump) continue;
    const before = [];
    for (let b = 1; b <= 3; b++) {
      if (i - b >= 0 && arr[i - b] > 0 && arr[i - b] <= HR_MAX_BPM) before.push(arr[i - b]);
    }
    const after = [];
    for (let a = 1; a <= 3; a++) {
      if (i + a < len && arr[i + a] > 0 && arr[i + a] <= HR_MAX_BPM) after.push(arr[i + a]);
    }
    const combined = [...before, ...after];
    arr[i] = combined.length > 0
      ? Math.round(combined.reduce((s, v) => s + v, 0) / combined.length)
      : (prev > 0 && prev <= HR_MAX_BPM ? prev : 0);
  }
  return arr;
}

/**
 * users/yearly_peaks/{year}에서 max_hr 조회. 없으면 null.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} userId
 * @param {number|string} year - 라이딩 연도 (스트림 날짜에서 파싱)
 * @returns {Promise<number|null>}
 */
async function getMaxHRForYear(db, userId, year) {
  if (!db || !userId || year == null) return null;
  try {
    const yearStr = String(year);
    const ref = db.collection("users").doc(userId).collection("yearly_peaks").doc(yearStr);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data();
    const maxHr = data && (data.max_hr != null || data.max_heartrate != null)
      ? Number(data.max_hr ?? data.max_heartrate)
      : null;
    return maxHr != null && maxHr > 0 ? maxHr : null;
  } catch (e) {
    console.warn("[getMaxHRForYear] 조회 실패:", userId, year, e.message);
    return null;
  }
}

/** Max HR from user logs in the last 365 days (server local date). */
async function getMaxHRRolling365FromLogs(db, userId) {
  if (!db || !userId) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const localYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const end = new Date();
  const start = new Date(end.getTime());
  start.setDate(start.getDate() - 365);
  const startStr = localYmd(start);
  const endStr = localYmd(end);
  const coll = db.collection("users").doc(userId).collection("logs");
  const seen = new Set();
  let bestHr = 0;
  const consider = (docSnap) => {
    const d = docSnap.data() || {};
    const hr = Math.max(
      Number(d.max_hr_5sec) || 0,
      Number(d.max_hr) || 0,
      Number(d.max_heartrate) || 0
    );
    if (hr > 0 && hr <= HR_MAX_BPM && hr > bestHr) bestHr = hr;
  };
  try {
    const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
    const snap1 = await coll
      .where("date", ">=", admin.firestore.Timestamp.fromDate(startDate))
      .where("date", "<=", admin.firestore.Timestamp.fromDate(endDate))
      .get();
    snap1.forEach((doc) => {
      seen.add(doc.id);
      consider(doc);
    });
  } catch (e) {
    console.warn("[getMaxHRRolling365FromLogs] Timestamp query:", e.message);
  }
  try {
    const snap2 = await coll.where("date", ">=", startStr).where("date", "<=", endStr).get();
    snap2.forEach((doc) => {
      if (seen.has(doc.id)) return;
      consider(doc);
    });
  } catch (e) {
    console.warn("[getMaxHRRolling365FromLogs] string query:", e.message);
  }
  return bestHr > 0 ? bestHr : null;
}

/**
 * FTP Fallback: 사용자 프로필 FTP 없으면 20분 MMP의 95% 또는 기본값 150W
 * @param {Object} userData - users 문서 데이터
 * @param {number[]} [wattsArray] - 파워 스트림 (20분 MMP 계산용)
 * @returns {number} FTP (W)
 */
function getFTPWithFallback(userData, wattsArray) {
  const ftp = Number(userData?.ftp) || 0;
  if (ftp > 0) return ftp;
  if (wattsArray && wattsArray.length >= 1200) {
    const smoothed = smoothPowerSpikes(wattsArray);
    const max20min = calculateMaxAveragePower(smoothed, 1200);
    if (max20min > 0) return Math.round(max20min * 0.95);
  }
  return DEFAULT_FTP_W;
}

/**
 * 심박 스트림 노이즈 필터: 220bpm 초과 무시 (null로 대체하여 해당 초는 HR 존 계산에서 제외)
 * @param {number[]} hrArray
 * @returns {number[]} 필터된 배열 (무효값은 -1로 표시하여 무시)
 */
function filterHRWithNoise(hrArray) {
  if (!hrArray || hrArray.length === 0) return [];
  return hrArray.map((v) => {
    const n = Number(v) || 0;
    if (n <= 0 || n > HR_MAX_BPM) return -1;
    return n;
  });
}

/**
 * Coggan 7-Zone: 파워(W) → 존 인덱스 (0=Coasting, 1~7)
 * Z0: 0W, Z1: <55%, Z2: 56-75%, Z3: 76-90%, Z4: 91-105%, Z5: 106-120%, Z6: 121-150%, Z7: >150%
 */
function getPowerZoneIndex(powerW, ftp) {
  const p = Number(powerW) || 0;
  if (p <= 0) return 0;
  if (!ftp || ftp <= 0) return 1;
  const pct = (p / ftp) * 100;
  if (pct < 55) return 1;
  if (pct <= 75) return 2;
  if (pct <= 90) return 3;
  if (pct <= 105) return 4;
  if (pct <= 120) return 5;
  if (pct <= 150) return 6;
  return 7;
}

/**
 * 심박 존: Max HR 기준 5존
 * Z1: 50-60%, Z2: 60-70%, Z3: 70-80%, Z4: 80-90%, Z5: 90-100%
 */
function getHRZoneIndex(hrBpm, maxHr) {
  const hr = Number(hrBpm) || 0;
  if (hr <= 0 || !maxHr || maxHr <= 0) return null;
  const pct = (hr / maxHr) * 100;
  if (pct < 50) return null;
  if (pct < 60) return 1;
  if (pct < 70) return 2;
  if (pct < 80) return 3;
  if (pct < 90) return 4;
  if (pct <= 100) return 5;
  return null;
}

/**
 * 파워 스트림에서 존별 누적 시간(초) 계산. 노이즈 필터 적용된 smoothPowerSpikes 결과 사용.
 */
function calculateTimeInPowerZones(wattsArray, ftp) {
  const zones = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
  if (!wattsArray || wattsArray.length === 0 || !ftp || ftp <= 0) return zones;
  wattsArray.forEach((w) => {
    const idx = getPowerZoneIndex(w, ftp);
    zones[`z${idx}`] = (zones[`z${idx}`] || 0) + 1;
  });
  return zones;
}

/**
 * 심박 스트림에서 존별 누적 시간(초) 계산. 220bpm 초과 무시.
 */
function calculateTimeInHRZones(hrArray, maxHr) {
  const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  if (!hrArray || hrArray.length === 0 || !maxHr || maxHr <= 0) return zones;
  const filtered = filterHRWithNoise(hrArray);
  filtered.forEach((hr) => {
    if (hr < 0) return;
    const idx = getHRZoneIndex(hr, maxHr);
    if (idx != null) zones[`z${idx}`] = (zones[`z${idx}`] || 0) + 1;
  });
  return zones;
}

/**
 * 스트림 데이터로 Power/HR 존 시간 계산.
 * HR max: rolling 365d from user logs; current stream can raise it.
 * @param {Object} opts - { wattsArray, hrArray, ftp, userId, db, dateStr }
 * @returns {Promise<{ power: Object, hr: Object }>}
 */
async function calculateZoneTimesFromStreams(opts) {
  const { wattsArray, hrArray, ftp, userId, db } = opts;
  const powerZones = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
  const hrZones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

  const effectiveFtp = ftp > 0 ? ftp : DEFAULT_FTP_W;
  const smoothedWatts = wattsArray && wattsArray.length > 0 ? smoothPowerSpikes(wattsArray) : [];
  if (smoothedWatts.length > 0) {
    Object.assign(powerZones, calculateTimeInPowerZones(smoothedWatts, effectiveFtp));
  }

  let maxHr = DEFAULT_MAX_HR;
  let rollingHr = 0;
  if (userId && db) {
    const fromRolling = await getMaxHRRolling365FromLogs(db, userId);
    if (fromRolling != null && fromRolling > 0) rollingHr = fromRolling;
  }
  if (rollingHr > 0) maxHr = rollingHr;
  if (hrArray && hrArray.length > 0) {
    const fromStream = Math.max(...hrArray.map((v) => Number(v) || 0).filter((v) => v > 0 && v <= HR_MAX_BPM));
    if (fromStream > maxHr) maxHr = fromStream;
  }
  if (hrArray && hrArray.length > 0) {
    Object.assign(hrZones, calculateTimeInHRZones(hrArray, maxHr));
  }

  return { power: powerZones, hr: hrZones };
}

/**
 * 피크 파워 기록 검증 (World Class 한계치 초과 시 false)
 * @param {string} durationType - "5min"|"10min"|"20min"|"40min"|"60min"|"max"
 * @param {number} watts - 절대 파워 (W)
 * @param {number} weightKg - 체중 (kg), Floor 45 적용 후
 * @returns {boolean} true=유효, false=이상치
 */
function validatePeakPowerRecord(durationType, watts, weightKg) {
  const limit = PEAK_POWER_LIMITS[durationType];
  if (!limit || !weightKg || weightKg <= 0) return true;
  const wkg = watts / weightKg;
  if (wkg > limit.wkg) return false;
  if (watts > limit.watts) return false;
  return true;
}

/** 의심 기록을 suspicious_power_records에 Pending으로 저장 */
async function saveSuspiciousPowerRecord(db, { userId, year, date, durationType, watts, wkg, weightKg, source, activityId, logId, activityType }) {
  try {
    await db.collection("suspicious_power_records").add({
      userId,
      year,
      date: date || null,
      durationType,
      watts,
      wkg,
      weightKg,
      source: source || "unknown",
      activity_type: activityType ?? null, // 로그분석 시 다른 데이터 유입 확인용
      activity_id: activityId || null,
      log_id: logId || null,
      status: "pending",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn("[saveSuspiciousPowerRecord] 저장 실패:", e.message);
  }
}

/** 로그의 피크 파워를 검증 후 연간 최고 기록에 업서트. 무효 시 suspicious_power_records에 Pending 저장
 * weight: log.weight 우선, 없으면 userData.weight 사용 (W/kg 산출 정확도) */
async function upsertYearlyPeakFromLog(db, userId, userData, logData, logId) {
  if (!isCyclingForMmp(logData)) return; // Run 등 비사이클링 Strava 로그는 MMP 제외
  const rawWeight = Number(logData.weight || userData.weight || userData.weightKg || 0);
  if (rawWeight <= 0) return;
  const weightKg = Math.max(rawWeight, 45);
  const dateStr = logData.date || "";
  const year = dateStr ? parseInt(dateStr.substring(0, 4), 10) : new Date().getFullYear();
  if (isNaN(year)) return;
  const source = String(logData.source || "stelvio").toLowerCase();

  const validRecords = {};
  for (const [durationType, field] of Object.entries(DURATION_FIELDS)) {
    const watts = Number(logData[field]) || 0;
    if (watts <= 0) continue;
    const valid = validatePeakPowerRecord(durationType, watts, weightKg);
    if (!valid) {
      const wkg = Math.round((watts / weightKg) * 100) / 100;
      await saveSuspiciousPowerRecord(db, {
        userId,
        year,
        date: dateStr,
        durationType,
        watts,
        wkg,
        weightKg,
        source,
        activityId: logData.activity_id || null,
        logId,
        activityType: logData.activity_type ?? (source === "strava" ? "Unknown" : "Stelvio"),
      });
      continue;
    }
    const wkg = Math.round((watts / weightKg) * 100) / 100;
    validRecords[field] = { watts, wkg };
  }

  const activityTypeForMmp = String(logData.activity_type || (source === "strava" ? "Unknown" : "Stelvio")).trim() || null;

  const yearlyRef = db.collection("users").doc(userId).collection("yearly_peaks").doc(String(year));
  const snap = await yearlyRef.get();
  const current = snap.exists ? snap.data() : {};
  const merged = {
    year,
    weight_kg: weightKg,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    activity_type: activityTypeForMmp, // 로그분석 시 다른 데이터 유입 확인용
  };
  let changed = false;
  for (const [field, { watts, wkg }] of Object.entries(validRecords)) {
    const prevWatts = Number(current[field]) || 0;
    if (watts > prevWatts) {
      merged[field] = watts;
      merged[field.replace("_watts", "_wkg")] = wkg;
      changed = true;
    }
  }
  // max_hr: 5초 평균 최대 우선(max_hr_5sec), 없으면 max_hr/max_heartrate (프로필 화면 표시용)
  // max_hr_date: 해당 max_hr 달성일
  const logMaxHr = Number(logData.max_hr_5sec ?? logData.max_hr ?? logData.max_heartrate) || 0;
  if (logMaxHr > 0) {
    const prevMaxHr = Number(current.max_hr) || 0;
    if (logMaxHr > prevMaxHr) {
      merged.max_hr = logMaxHr;
      merged.max_hr_date = dateStr || null;
      changed = true;
    }
  }
  if (changed) await yearlyRef.set(merged, { merge: true });
}

/** Asia/Seoul 기준 월간 구간 (YYYY-MM-DD) */
function getMonthRangeSeoul(year, month) {
  const y = year != null ? year : new Date().getFullYear();
  const m = month != null ? month : new Date().getMonth() + 1;
  const pad = (n) => String(n).padStart(2, "0");
  const startStr = `${y}-${pad(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const endStr = `${y}-${pad(m)}-${pad(lastDay)}`;
  return { startStr, endStr };
}

/** Asia/Seoul 기준 연간 구간 (YYYY-MM-DD) */
function getYearRangeSeoul(year) {
  const y = year != null ? year : new Date().getFullYear();
  const pad = (n) => String(n).padStart(2, "0");
  return { startStr: `${y}-01-01`, endStr: `${y}-12-31` };
}

/**
 * 서울 달력 YYYY-MM-DD에 delta일 가감 (Asia/Seoul 고정, 한국 DST 없음).
 * Cloud Functions 런타임 타임존과 무관하게 start/end 와 listInclusiveYmdsSeoul 일수를 맞춤.
 */
function addDaysSeoulYmd(ymdStr, deltaDays) {
  const msPerDay = 86400000;
  const t = new Date(`${ymdStr}T12:00:00+09:00`).getTime() + deltaDays * msPerDay;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** Asia/Seoul 달력 기준 오늘 포함 역산 최근 30일 (YYYY-MM-DD). 거리 등 비피크 랭킹용. */
function getRolling30DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -29);
  return { startStr, endStr };
}

/** Asia/Seoul 달력 기준 오늘 포함 역산 최근 28일(7×4주). GC·헵타곤·피크(rolling/monthly 탭) 공통 창 — 추가 로그 조회 없이 일 버킹만 사용. */
function getRolling28DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -27);
  return { startStr, endStr };
}

/** Asia/Seoul 달력 기준 오늘 포함 역산 최근 약 6개월(183일, YYYY-MM-DD). 1시간 항속·맞춤 필터 60분 피크와 동일. */
function getRolling183DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -182);
  return { startStr, endStr };
}

/** Asia/Seoul 달력 기준 오늘 포함 역산 최근 365일 (YYYY-MM-DD). 명예의 전당(연간 탭) 피크 집계용. */
function getRolling365DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -364);
  return { startStr, endStr };
}

/** 생년월일 기준 연령대: Bianco(≤39), Rosa(40~49), Infinito(50~59), Leggenda(≥60) - 일반부용 */
function getAgeCategory(birthYear) {
  if (birthYear == null || birthYear === "") return null;
  const y = Number(birthYear);
  if (isNaN(y)) return null;
  const thisYear = new Date().getFullYear();
  const age = thisYear - y;
  if (age <= 39) return "Bianco";
  if (age <= 49) return "Rosa";
  if (age <= 59) return "Infinito";
  return "Leggenda";
}

/** challenge 기준 리그 분류: Elite/PRO → Assoluto(선수부), Fitness/GranFondo/Racing → Bianco/Rosa/Infinito/Leggenda(일반부) */
function getLeagueCategory(challenge, birthYear) {
  const ch = String(challenge || "").trim();
  if (ch === "Elite" || ch === "PRO") return "Assoluto";
  const ageCat = getAgeCategory(birthYear);
  return ageCat; // Bianco, Rosa, Infinito, Leggenda
}

/** 연간 구간 여부 (YYYY-01-01 ~ YYYY-12-31) */
function isYearlyRange(startStr, endStr) {
  if (!startStr || !endStr) return false;
  const m = startStr.match(/^(\d{4})-01-01$/);
  const m2 = endStr.match(/^(\d{4})-12-31$/);
  return m && m2 && m[1] === m2[1];
}

/** 사용자별 해당 기간 내 최고 피크 파워(W) 및 W/kg. Weight Floor 45kg, validatePeakPowerRecord 적용.
 *  연간(명예의 전당)일 때는 yearly_peaks에서 조회(사전 집계 데이터, 서버 부하 최소화)
 *  보안: 현재 연도는 yearly_peaks와 logs를 재검증하여 yearly_peaks 누락 시 logs 최대치 반영 */
async function getPeakPowerForUser(db, userId, userData, startStr, endStr, durationType) {
  const field = DURATION_FIELDS[durationType];
  if (!field) return null;
  const rawWeight = Number(userData.weight || userData.weightKg || 0);
  if (rawWeight <= 0) return null;
  const weightKg = Math.max(rawWeight, 45);

  if (isYearlyRange(startStr, endStr)) {
    const year = startStr.substring(0, 4);
    const yearlyRef = db.collection("users").doc(userId).collection("yearly_peaks").doc(year);
    const yearlySnap = await yearlyRef.get();
    let watts = 0;
    let wkgVal = 0;
    if (yearlySnap.exists) {
      const d = yearlySnap.data();
      watts = Number(d[field]) || 0;
      wkgVal = Number(d[field.replace("_watts", "_wkg")]) || (watts > 0 ? Math.round((watts / weightKg) * 100) / 100 : 0);
    }
    // 보안: 현재 연도는 logs와 재검증 (onUserLogWritten 누락·트리거 배포 전 로그 등 방지)
    const isCurrentYear = year === String(new Date().getFullYear());
    if (isCurrentYear) {
      const logsSnap = await db.collection("users").doc(userId).collection("logs")
        .where("date", ">=", startStr)
        .where("date", "<=", endStr)
        .get();
      let maxWattsFromLogs = 0;
      let maxHrFromLogs = 0;
      let maxHrDateFromLogs = null;
      let contributingActivityType = null;
      logsSnap.docs.forEach((doc) => {
        const d = doc.data();
        if (!isCyclingForMmp(d)) return;
        const w = Number(d[field]) || 0;
        if (w > 0 && validatePeakPowerRecord(durationType, w, weightKg) && w > maxWattsFromLogs) {
          maxWattsFromLogs = w;
          contributingActivityType = d.activity_type ?? (String(d.source || "").toLowerCase() === "strava" ? "Unknown" : "Stelvio");
        }
        const hr = Number(d.max_hr_5sec ?? d.max_hr ?? d.max_heartrate) || 0;
        if (hr > 0 && hr > maxHrFromLogs) {
          maxHrFromLogs = hr;
          maxHrDateFromLogs = (d.date && String(d.date).trim()) || null;
        }
      });
      const currentMaxHr = yearlySnap.exists ? Number(yearlySnap.data().max_hr) || 0 : 0;
      const shouldUpdateMaxHr = maxHrFromLogs > currentMaxHr;
      const powerNeedsCorrection = maxWattsFromLogs > watts;
      if (powerNeedsCorrection) {
        watts = maxWattsFromLogs;
        wkgVal = Math.round((maxWattsFromLogs / weightKg) * 100) / 100;
      }
      if (powerNeedsCorrection || shouldUpdateMaxHr) {
        // yearly_peaks 보정 (향후 조회 시 로그 스캔 불필요, max_hr 포함)
        try {
          const wkgField = field.replace("_watts", "_wkg");
          const updateData = {
            year: parseInt(year, 10),
            [field]: watts,
            [wkgField]: wkgVal,
            weight_kg: weightKg,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
            activity_type: contributingActivityType ?? null,
          };
          if (shouldUpdateMaxHr) {
            updateData.max_hr = maxHrFromLogs;
            if (maxHrDateFromLogs) updateData.max_hr_date = maxHrDateFromLogs;
          }
          await yearlyRef.set(updateData, { merge: true });
        } catch (e) {
          console.warn("[getPeakPowerForUser] yearly_peaks 보정 실패:", userId, year, e.message);
        }
      }
    }
    if (watts <= 0 || wkgVal <= 0) return null;
    return { watts, wkg: wkgVal, weightKg };
  }

  const weekRanges = rankingDayRollup.splitInclusiveRangeIntoFourWeeks(startStr, endStr);

  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("date", ">=", startStr)
    .where("date", "<=", endStr)
    .get();

  if (weekRanges) {
    const maxWW = [0, 0, 0, 0];
    snapshot.docs.forEach((doc) => {
      const d = doc.data();
      if (!isCyclingForMmp(d)) return;
      const dateStr = normalizeLogDateToSeoulYmd(d.date);
      if (!dateStr) return;
      let wi = -1;
      for (let i = 0; i < 4; i++) {
        if (dateStr >= weekRanges[i].startStr && dateStr <= weekRanges[i].endStr) {
          wi = i;
          break;
        }
      }
      if (wi < 0) return;
      const watts = Number(d[field]) || 0;
      if (watts <= 0) return;
      if (!validatePeakPowerRecord(durationType, watts, weightKg)) return;
      if (watts > maxWW[wi]) maxWW[wi] = watts;
    });
    const weeklyWkg = maxWW.map((mw) =>
      (mw > 0 ? Math.round((mw / weightKg) * 100) / 100 : 0)
    );
    const { finalWkg } = rankingDayRollup.calculateGcRankingFromWeeklyMaxWkg(weeklyWkg);
    if (finalWkg <= 0) return null;
    const wattsOut = Math.round(finalWkg * weightKg);
    return { watts: wattsOut, wkg: finalWkg, weightKg };
  }

  let maxWatts = 0;
  snapshot.docs.forEach((doc) => {
    const d = doc.data();
    if (!isCyclingForMmp(d)) return;
    const watts = Number(d[field]) || 0;
    if (watts <= 0) return;
    if (!validatePeakPowerRecord(durationType, watts, weightKg)) return;
    if (watts > maxWatts) maxWatts = watts;
  });
  if (maxWatts <= 0) return null;
  const wkg = Math.round((maxWatts / weightKg) * 100) / 100;
  return { watts: maxWatts, wkg, weightKg };
}

const PEAK_POWER_BATCH_SIZE = 50;

/** 기간 내 싸이클링 로그에서 duration별 최고 심박(bpm) */
async function getPeakHrForUser(db, userId, startStr, endStr, durationType) {
  const field = DURATION_HR_FIELDS[durationType];
  if (!field) return null;
  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("date", ">=", startStr)
    .where("date", "<=", endStr)
    .get();
  let maxHr = 0;
  snapshot.docs.forEach((doc) => {
    const d = doc.data();
    if (!isCyclingForMmp(d)) return;
    const dateStr = normalizeLogDateToSeoulYmd(d.date);
    if (!dateStr || dateStr < startStr || dateStr > endStr) return;
    const hr = Number(d[field]) || 0;
    if (hr < 40 || hr > HR_MAX_BPM) return;
    if (hr > maxHr) maxHr = hr;
  });
  if (maxHr <= 0) return null;
  return { hr: maxHr };
}

/** 전체 사용자 대상 duration별 피크 심박 산술평균 (랭킹과 동일 성별·리그 필터)
 * [비용절감] usersSnap을 외부에서 주입받아 중복 users.get() 방지 */
async function getCohortAvgPeakHrBpm(db, startStr, endStr, durationType, genderFilter, usersSnap = null) {
  if (!DURATION_HR_FIELDS[durationType]) return null;
  const snap = usersSnap ?? await db.collection("users").get();
  const docs = snap.docs;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < docs.length; i += PEAK_POWER_BATCH_SIZE) {
    const batch = docs.slice(i, i + PEAK_POWER_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (doc) => {
        const userId = doc.id;
        const data = doc.data();
        const gender = String(data.gender || data.sex || "").toLowerCase();
        if (genderFilter && genderFilter !== "all") {
          const g = genderFilter === "M" || genderFilter === "male" || genderFilter === "남" ? "male" : "female";
          const match = gender === "m" || gender === "male" || gender === "남" ? "male" : (gender === "f" || gender === "female" || gender === "여" ? "female" : null);
          if (match !== g) return null;
        }
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return null;
        const peak = await getPeakHrForUser(db, userId, startStr, endStr, durationType);
        if (!peak || peak.hr <= 0) return null;
        return peak.hr;
      })
    );
    results.forEach((h) => { if (h != null) { sum += h; n++; } });
  }
  if (n === 0) return null;
  return Math.round((sum / n) * 10) / 10;
}

/** 현재 사용자 조회 순서: 연령·선수부 리그 우선(동기부여·추월은 부문 내 상대), Supremo(전체)는 폴백 */
const PEAK_RANKING_USER_LOOKUP_ORDER = ["Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda", "Supremo"];

/** 피크 파워 랭킹 엔트리 (기간·종목·성별·연령대별)
 * [비용절감] usersSnap을 외부에서 주입받아 중복 users.get() 방지 */
async function getPeakPowerRankingEntries(db, startStr, endStr, durationType, genderFilter, usersSnap = null) {
  const snap = usersSnap ?? await db.collection("users").get();
  const docs = snap.docs;
  const entries = [];
  for (let i = 0; i < docs.length; i += PEAK_POWER_BATCH_SIZE) {
    const batch = docs.slice(i, i + PEAK_POWER_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (doc) => {
        const userId = doc.id;
        const data = doc.data();
        const name = data.name || "(이름 없음)";
        const gender = String(data.gender || data.sex || "").toLowerCase();
        if (genderFilter && genderFilter !== "all") {
          const g = genderFilter === "M" || genderFilter === "male" || genderFilter === "남" ? "male" : "female";
          const match = gender === "m" || gender === "male" || gender === "남" ? "male" : (gender === "f" || gender === "female" || gender === "여" ? "female" : null);
          if (match !== g) return null;
        }
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return null;
        const peak = await getPeakPowerForUser(db, userId, data, startStr, endStr, durationType);
        if (!peak || peak.wkg <= 0) return null;
        return {
          userId,
          name,
          wkg: peak.wkg,
          watts: peak.watts,
          weightKg: peak.weightKg,
          ageCategory: leagueCategory,
          gender,
          is_private: privacyFlagFromFirestoreDoc(data),
          profileImageUrl: profileImageUrlFromUserData(data),
        };
      })
    );
    results.forEach((r) => { if (r) entries.push(r); });
  }
  entries.sort((a, b) => b.wkg - a.wkg);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  withRank.forEach((e) => {
    if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
  });
  return { entries: withRank, byCategory };
}

/** 주간 TSS 랭킹 보드: 주간 마일리지 TOP10과 동일한 TSS 합산 규칙(getWeeklyTssForUser), 성별·리그 분류는 피크 파워와 동일
 * [비용절감] usersSnap을 외부에서 주입받아 중복 users.get() 방지 */
async function getWeeklyTssRankingBoardEntries(db, startStr, endStr, genderFilter, usersSnap = null) {
  const snap = usersSnap ?? await db.collection("users").get();
  const docs = snap.docs;
  const entries = [];
  for (let i = 0; i < docs.length; i += WEEKLY_TSS_BATCH_SIZE) {
    const batch = docs.slice(i, i + WEEKLY_TSS_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (doc) => {
        const userId = doc.id;
        const data = doc.data();
        const name = data.name || "(이름 없음)";
        const gender = String(data.gender || data.sex || "").toLowerCase();
        if (genderFilter && genderFilter !== "all") {
          const g = genderFilter === "M" || genderFilter === "male" || genderFilter === "남" ? "male" : "female";
          const match = gender === "m" || gender === "male" || gender === "남" ? "male" : (gender === "f" || gender === "female" || gender === "여" ? "female" : null);
          if (match !== g) return null;
        }
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return null;
        const totalTssRaw = await getWeeklyTssForUser(db, userId, startStr, endStr, data);
        if (totalTssRaw <= 0) return null;
        const totalTss = Math.round(totalTssRaw * 100) / 100;
        return {
          userId,
          name,
          totalTss,
          ageCategory: leagueCategory,
          gender,
          is_private: privacyFlagFromFirestoreDoc(data),
          profileImageUrl: profileImageUrlFromUserData(data),
        };
      })
    );
    results.forEach((r) => { if (r) entries.push(r); });
  }
  entries.sort((a, b) => b.totalTss - a.totalTss);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  withRank.forEach((e) => {
    if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
  });
  return { entries: withRank, byCategory };
}

/** 개인: 최근 30일(서울) 라이딩 거리 합 — 성별·리그 분류는 주간 TSS 랭킹과 동일
 * [비용절감] usersSnap을 외부에서 주입받아 중복 users.get() 방지 */
async function getRolling30dDistanceRankingBoardEntries(db, startStr, endStr, genderFilter, usersSnap = null) {
  const snap = usersSnap ?? await db.collection("users").get();
  const docs = snap.docs;
  const entries = [];
  for (let i = 0; i < docs.length; i += WEEKLY_TSS_BATCH_SIZE) {
    const batch = docs.slice(i, i + WEEKLY_TSS_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (doc) => {
        const userId = doc.id;
        const data = doc.data();
        const name = data.name || "(이름 없음)";
        const gender = String(data.gender || data.sex || "").toLowerCase();
        if (genderFilter && genderFilter !== "all") {
          const g = genderFilter === "M" || genderFilter === "male" || genderFilter === "남" ? "male" : "female";
          const match = gender === "m" || gender === "male" || gender === "남" ? "male" : (gender === "f" || gender === "female" || gender === "여" ? "female" : null);
          if (match !== g) return null;
        }
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return null;
        const totalKmRaw = await getRolling30dCyclingKmForUser(db, userId, startStr, endStr, data);
        if (totalKmRaw <= 0) return null;
        const totalKm = Math.round(totalKmRaw * 100) / 100;
        return {
          userId,
          name,
          totalKm,
          ageCategory: leagueCategory,
          gender,
          is_private: privacyFlagFromFirestoreDoc(data),
          profileImageUrl: profileImageUrlFromUserData(data),
        };
      })
    );
    results.forEach((r) => { if (r) entries.push(r); });
  }
  entries.sort((a, b) => b.totalKm - a.totalKm);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  withRank.forEach((e) => {
    if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
  });
  return { entries: withRank, byCategory };
}

/** rides.date → 서울 YYYY-MM-DD */
function rideDocDateToSeoulYmd(rideDate) {
  if (!rideDate) return "";
  try {
    let d;
    if (typeof rideDate.toDate === "function") d = rideDate.toDate();
    else if (rideDate instanceof admin.firestore.Timestamp) d = rideDate.toDate();
    else if (rideDate instanceof Date) d = rideDate;
    else if (typeof rideDate === "string") return String(rideDate).slice(0, 10);
    else return "";
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  } catch (_e) {
    return "";
  }
}

/** users/{uid}/logs 문서 date를 서울 YYYY-MM-DD로 정규화 */
function normalizeLogDateToSeoulYmd(logDate) {
  if (!logDate) return "";
  try {
    if (typeof logDate === "string") {
      const s = String(logDate).trim();
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) return s.slice(0, 10);
      return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
    }
    let d = null;
    if (typeof logDate.toDate === "function") d = logDate.toDate();
    else if (logDate instanceof admin.firestore.Timestamp) d = logDate.toDate();
    else if (logDate instanceof Date) d = logDate;
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  } catch (_e) {
    return "";
  }
}

/** 로그 거리 km 추출 (legacy distance meters 가능성 보정) */
function extractLogDistanceKm(logData) {
  const km = Number(logData && logData.distance_km);
  if (Number.isFinite(km) && km > 0) return km;
  const raw = Number(logData && logData.distance);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // legacy 필드가 m 단위인 경우를 보정
  if (raw >= 300) return Math.round((raw / 1000) * 100) / 100;
  return raw;
}

function pickHostRepresentativeDistanceKm(logs, plannedKm) {
  const p = Number(plannedKm) || 0;
  if (!(p > 0)) {
    let maxKm = 0;
    for (const l of logs) {
      const d = extractLogDistanceKm(l);
      if (d > maxKm) maxKm = d;
    }
    return maxKm;
  }
  const lo = p * 0.9;
  const hi = p * 1.1;
  const cands = [];
  for (const l of logs) {
    const d = extractLogDistanceKm(l);
    if (d <= 0) continue;
    if ((d >= lo && d <= hi) || d > p) cands.push(d);
  }
  if (cands.length === 0) return 0;
  cands.sort((a, b) => Math.abs(a - p) - Math.abs(b - p));
  return cands[0] || 0;
}

async function getUserStravaDistanceKmForRideDate(db, userId, ymd, rideData) {
  const logsSnap = await db.collection("users").doc(String(userId).trim()).collection("logs")
    .where("date", "==", ymd)
    .where("source", "==", "strava")
    .get();
  if (logsSnap.empty) return 0;
  const logs = [];
  logsSnap.docs.forEach((doc) => {
    const d = doc.data() || {};
    if (!isCyclingForMmp(d)) return;
    const km = extractLogDistanceKm(d);
    if (km > 0) logs.push(d);
  });
  if (logs.length === 0) return 0;

  const hostUid = String(rideData && rideData.hostUserId ? rideData.hostUserId : "").trim();
  const uid = String(userId).trim();
  if (hostUid && uid === hostUid) {
    return pickHostRepresentativeDistanceKm(logs, Number(rideData && rideData.distance) || 0);
  }

  let sum = 0;
  logs.forEach((l) => {
    sum += extractLogDistanceKm(l);
  });
  return Math.round(sum * 100) / 100;
}

/**
 * users/{uid}/logs 쓰기 시 오픈 라이딩 합산용 participantStravaReview 자동 동기화.
 * 앱 로그인/상세 진입 여부와 무관하게 서버(Admin SDK)에서 반영.
 */
async function syncOpenRidingParticipantDistanceByLog(db, userId, logData) {
  const source = String(logData && logData.source ? logData.source : "").toLowerCase();
  if (source !== "strava") return;
  if (!isCyclingForMmp(logData || {})) return;
  const ymd = normalizeLogDateToSeoulYmd(logData && logData.date);
  if (!ymd) return;
  const startTs = admin.firestore.Timestamp.fromDate(new Date(`${ymd}T00:00:00+09:00`));
  const endTs = admin.firestore.Timestamp.fromDate(new Date(`${ymd}T23:59:59.999+09:00`));
  const ridesSnap = await db.collection("rides")
    .where("participants", "array-contains", String(userId))
    .where("date", ">=", startTs)
    .where("date", "<=", endTs)
    .get();
  if (ridesSnap.empty) return;

  let batch = db.batch();
  let writes = 0;
  for (const rideDoc of ridesSnap.docs) {
    const ride = rideDoc.data() || {};
    if (String(ride.rideStatus || "active") === "cancelled") continue;
    const rideYmd = rideDocDateToSeoulYmd(ride.date);
    if (!rideYmd || rideYmd !== ymd) continue;
    const participants = Array.isArray(ride.participants) ? ride.participants : [];
    const hasUser = participants.some((p) => String(p || "").trim() === String(userId).trim());
    if (!hasUser) continue;
    const distKm = await getUserStravaDistanceKmForRideDate(db, userId, ymd, ride);
    if (!(distKm > 0)) continue;
    const partRef = db.collection("rides").doc(rideDoc.id).collection("participantStravaReview").doc(String(userId).trim());
    batch.set(partRef, {
      rideDateYmd: ymd,
      distanceKm: distKm,
      source: "strava",
      syncedBy: "functions_onUserLogWritten",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    writes++;
    if (writes % 450 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (writes % 450 !== 0) {
    await batch.commit();
  }
}

/**
 * 과거 오픈 라이딩 participantStravaReview 백필.
 * GET/POST ?secret=INTERNAL_SYNC_SECRET&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&rideId=선택&dryRun=1&cleanMissing=1&limit=300
 */
exports.backfillOpenRidingParticipantStravaReview = onRequest(
  { cors: true, timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    res.set("Access-Control-Allow-Origin", "*");
    const secret = req.query.secret || req.body?.secret || "";
    if (secret !== INTERNAL_SYNC_SECRET) {
      return res.status(403).json({ success: false, error: "인증 필요" });
    }

    const rideId = String(req.query.rideId || req.body?.rideId || "").trim();
    const dryRun = String(req.query.dryRun || req.body?.dryRun || "0") === "1";
    const cleanMissing = String(req.query.cleanMissing || req.body?.cleanMissing || "0") === "1";
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit || req.body?.limit || "300", 10) || 300));
    const startDate = String(req.query.startDate || req.body?.startDate || "").trim();
    const endDate = String(req.query.endDate || req.body?.endDate || "").trim();
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;

    const db = admin.firestore();
    /** @type {admin.firestore.QuerySnapshot<admin.firestore.DocumentData>} */
    let ridesSnap;
    if (rideId) {
      const one = await db.collection("rides").doc(rideId).get();
      ridesSnap = {
        docs: one.exists ? [one] : [],
        size: one.exists ? 1 : 0,
        empty: !one.exists,
      };
    } else {
      let s = startDate;
      let e = endDate;
      if (!dateRe.test(s) || !dateRe.test(e)) {
        const now = new Date();
        const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
        const d = new Date(`${today}T00:00:00+09:00`);
        const past = new Date(d.getTime() - (120 * 24 * 60 * 60 * 1000));
        const pad = (n) => String(n).padStart(2, "0");
        s = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`;
        e = today;
      }
      const tsStart = admin.firestore.Timestamp.fromDate(new Date(`${s}T00:00:00+09:00`));
      const tsEnd = admin.firestore.Timestamp.fromDate(new Date(`${e}T23:59:59.999+09:00`));
      ridesSnap = await db.collection("rides")
        .where("date", ">=", tsStart)
        .where("date", "<=", tsEnd)
        .limit(limit)
        .get();
    }

    let scannedRides = 0;
    let processedRides = 0;
    let participantScans = 0;
    let writtenDocs = 0;
    let deletedDocs = 0;
    let skippedCancelled = 0;
    let errors = 0;
    let batch = db.batch();
    let batchOps = 0;

    for (const rideDoc of ridesSnap.docs) {
      scannedRides++;
      const ride = rideDoc.data() || {};
      if (String(ride.rideStatus || "active") === "cancelled") {
        skippedCancelled++;
        continue;
      }
      const rideYmd = rideDocDateToSeoulYmd(ride.date);
      if (!rideYmd) continue;
      const participants = Array.isArray(ride.participants) ? ride.participants : [];
      const uniqParticipants = [...new Set(participants.map((x) => String(x || "").trim()).filter(Boolean))];
      if (uniqParticipants.length === 0) continue;
      processedRides++;

      for (const uid of uniqParticipants) {
        participantScans++;
        try {
          const km = await getUserStravaDistanceKmForRideDate(db, uid, rideYmd, ride);
          const partRef = db.collection("rides").doc(rideDoc.id).collection("participantStravaReview").doc(uid);
          if (km > 0) {
            if (!dryRun) {
              batch.set(partRef, {
                rideDateYmd: rideYmd,
                distanceKm: km,
                source: "strava",
                syncedBy: "functions_backfillOpenRidingParticipantStravaReview",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });
              batchOps++;
            }
            writtenDocs++;
          } else if (cleanMissing) {
            if (!dryRun) {
              batch.delete(partRef);
              batchOps++;
            }
            deletedDocs++;
          }
        } catch (e) {
          errors++;
          console.warn("[backfillOpenRidingParticipantStravaReview] participant 처리 실패:", rideDoc.id, uid, e.message);
        }

        if (!dryRun && batchOps >= 450) {
          await batch.commit();
          batch = db.batch();
          batchOps = 0;
        }
      }
    }

    if (!dryRun && batchOps > 0) {
      await batch.commit();
    }

    return res.status(200).json({
      success: true,
      dryRun,
      cleanMissing,
      rideId: rideId || null,
      scannedRides,
      processedRides,
      participantScans,
      writtenDocs,
      deletedDocs,
      skippedCancelled,
      errors,
    });
  }
);

/**
 * 그룹: 최근 30일 내 오픈 라이딩을 방장(hostUserId)별로 합산.
 * 각 일정의 점수 = 해당 일정일에 확정 참가자 각각의 라이딩 거리(일별 규칙 동일) 합.
 */
async function getRolling30dGroupDistanceByHostEntries(db, startStr, endStr, viewerUid) {
  const memo = new Map();
  async function dailyKmCached(uid, ymd) {
    const key = `${uid}|${ymd}`;
    if (memo.has(key)) return memo.get(key);
    const v = await getRolling30dCyclingKmForUser(db, uid, ymd, ymd);
    memo.set(key, v);
    return v;
  }
  const tsStart = admin.firestore.Timestamp.fromDate(new Date(`${startStr}T00:00:00+09:00`));
  const tsEnd = admin.firestore.Timestamp.fromDate(new Date(`${endStr}T23:59:59.999+09:00`));
  const ridesSnap = await db.collection("rides")
    .where("date", ">=", tsStart)
    .where("date", "<=", tsEnd)
    .get();
  const byHost = new Map();
  const viewer = viewerUid ? String(viewerUid).trim() : "";
  for (const doc of ridesSnap.docs) {
    const r = doc.data();
    if (String(r.rideStatus || "active") === "cancelled") continue;
    const hostKey = String(r.hostUserId || "").trim();
    if (!hostKey) continue;
    const ymd = rideDocDateToSeoulYmd(r.date);
    if (!ymd || ymd < startStr || ymd > endStr) continue;
    const partsRaw = Array.isArray(r.participants) ? r.participants : [];
    const parts = [...new Set(partsRaw.map((x) => String(x).trim()).filter(Boolean))];
    let rideScore = 0;
    for (const pUid of parts) {
      rideScore += await dailyKmCached(pUid, ymd);
    }
    if (rideScore <= 0) continue;
    if (!byHost.has(hostKey)) {
      byHost.set(hostKey, {
        hostUserId: hostKey,
        name: String(r.hostName || "(이름 없음)").trim().slice(0, 80) || "(이름 없음)",
        totalKm: 0,
        participated: false,
      });
    }
    const agg = byHost.get(hostKey);
    agg.totalKm += rideScore;
    if (viewer && parts.includes(viewer)) agg.participated = true;
  }
  const entries = [];
  const hostKeys = Array.from(byHost.keys());
  const profileSnaps = await Promise.all(
    hostKeys.map((hid) => db.collection("users").doc(hid).get().catch(() => null)),
  );
  const urlByHostId = new Map();
  hostKeys.forEach((hid, i) => {
    const sn = profileSnaps[i];
    if (sn && sn.exists) urlByHostId.set(hid, profileImageUrlFromUserData(sn.data()));
    else urlByHostId.set(hid, null);
  });
  for (const [, v] of byHost) {
    entries.push({
      userId: v.hostUserId,
      hostUserId: v.hostUserId,
      name: v.name,
      totalKm: Math.round(v.totalKm * 100) / 100,
      ageCategory: "Supremo",
      gender: "",
      is_private: false,
      rankingKind: "group",
      currentUserParticipated: !!v.participated,
      profileImageUrl: urlByHostId.get(v.hostUserId) || null,
    });
  }
  entries.sort((a, b) => b.totalKm - a.totalKm);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  return { entries: withRank, byCategory };
}

// ---------- 랭킹 사전 집계 (스케줄러) + ranking_aggregates (HTTP 빠른 읽기) ----------
const RANKING_AGGREGATES_COLLECTION = "ranking_aggregates";
/** ranking_aggregates 읽기 허용 최대 경과 시간. 집계 cron 간격보다 길게 두어 사용자 요청 시 전체 재스캔 빈도를 줄임 */
const RANKING_AGG_MAX_STALE_MS = 26 * 60 * 60 * 1000; // 26시간 (하루 1회 22:00 기준 최대 24h 공백 + 여유)
/** KST 22:00 정시 집계 하루 1회 */
const RANKING_REBUILD_CRON = "0 22 * * *";
const RANKING_ONE_PASS_BATCH = 50;

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} cacheKey
 * @returns {Promise<object|null>} payload
 */
async function readRankingAggregatePayloadIfFresh(db, cacheKey) {
  if (!db || !cacheKey) return null;
  try {
    const ref = db.collection(RANKING_AGGREGATES_COLLECTION).doc(cacheKey);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    const updatedAt = d.updatedAt && (d.updatedAt.toMillis ? d.updatedAt.toMillis() : d.updatedAt);
    if (!updatedAt || (Date.now() - updatedAt > RANKING_AGG_MAX_STALE_MS)) return null;
    return d.payload && typeof d.payload === "object" ? d.payload : null;
  } catch (e) {
    console.warn("[readRankingAggregatePayloadIfFresh]", cacheKey, e.message);
    return null;
  }
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} cacheKey
 * @param {object} payload
 */
async function writeRankingAggregatePayload(db, cacheKey, payload) {
  if (!db || !cacheKey || !payload) return;
  const ref = db.collection(RANKING_AGGREGATES_COLLECTION).doc(cacheKey);
  await ref.set({
    payload,
    version: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * 기간·로그 스냅샷에서 구간별 최고 W(동시 계산) — getPeakPowerForUser(로그 경로)와 동일 규칙
 * @param {string} startStr
 * @param {string} endStr
 */
function computeUserPeaksAllDurationsFromSnapshot(userData, snapshot, startStr, endStr) {
  const rawWeight = Number(userData.weight || userData.weightKg || 0);
  if (rawWeight <= 0) return null;
  const weightKg = Math.max(rawWeight, 45);
  const maxW = {};
  for (const dt of Object.keys(DURATION_FIELDS)) maxW[dt] = 0;
  snapshot.docs.forEach((doc) => {
    const d = doc.data();
    if (!isCyclingForMmp(d)) return;
    const dateStr = normalizeLogDateToSeoulYmd(d.date);
    if (!dateStr || dateStr < startStr || dateStr > endStr) return;
    for (const dt of Object.keys(DURATION_FIELDS)) {
      const field = DURATION_FIELDS[dt];
      const watts = Number(d[field]) || 0;
      if (watts <= 0) continue;
      if (!validatePeakPowerRecord(dt, watts, weightKg)) continue;
      if (watts > maxW[dt]) maxW[dt] = watts;
    }
  });
  const peaks = {};
  for (const dt of Object.keys(DURATION_FIELDS)) {
    const mw = maxW[dt];
    if (mw > 0) {
      peaks[dt] = { watts: mw, wkg: Math.round((mw / weightKg) * 100) / 100, weightKg };
    }
  }
  return Object.keys(peaks).length ? { weightKg, peaks } : null;
}

/** 코호트 평균 심박(구간별): 동일 기간·로그에서 HR 필드 최댓값 */
function maxHrByDurationFromSnapshot(snapshot, startStr, endStr) {
  const out = {};
  for (const dt of Object.keys(DURATION_HR_FIELDS)) out[dt] = 0;
  snapshot.docs.forEach((doc) => {
    const d = doc.data();
    if (!isCyclingForMmp(d)) return;
    const dateStr = normalizeLogDateToSeoulYmd(d.date);
    if (!dateStr || dateStr < startStr || dateStr > endStr) return;
    for (const dt of Object.keys(DURATION_HR_FIELDS)) {
      const field = DURATION_HR_FIELDS[dt];
      const hr = Number(d[field]) || 0;
      if (hr < 40 || hr > HR_MAX_BPM) continue;
      if (hr > out[dt]) out[dt] = hr;
    }
  });
  return out;
}

function genderKeyFromUserData(data) {
  const gender = String(data.gender || data.sex || "").toLowerCase();
  return gender === "m" || gender === "male" || gender === "남" ? "M" : (gender === "f" || gender === "female" || gender === "여" ? "F" : null);
}

/**
 * 성별 3종(all, M, F) 동시·로그 1회/사용자 (스케줄러 부하 절감)
 * @returns {Promise<Record<string, Record<string, { entries: any[], byCategory: object, cohortAvgHrBpm: number|null }>>>}
 *         outer: gender "all"|"M"|"F", inner: durationType
 */
/** [비용절감] usersSnap을 외부에서 주입받아 중복 users.get() 방지 */
async function buildPeakPowerAllDurationsForRangeAllGendersOnePass(db, startStr, endStr, usersSnap = null) {
  const genders = ["all", "M", "F"];
  const byGenderDur = {};
  genders.forEach((g) => {
    byGenderDur[g] = {};
    for (const dt of Object.keys(DURATION_FIELDS)) {
      byGenderDur[g][dt] = { raw: [] };
    }
  });
  const cohortSum = { all: {}, M: {}, F: {} };
  const cohortN = { all: {}, M: {}, F: {} };
  genders.forEach((g) => {
    for (const dt of Object.keys(DURATION_HR_FIELDS)) {
      cohortSum[g][dt] = 0;
      cohortN[g][dt] = 0;
    }
  });

  const snap = usersSnap ?? await db.collection("users").get();
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += RANKING_ONE_PASS_BATCH) {
    const batch = docs.slice(i, i + RANKING_ONE_PASS_BATCH);
    await Promise.all(
      batch.map(async (udoc) => {
        const userId = udoc.id;
        const data = udoc.data();
        const name = data.name || "(이름 없음)";
        const gKey = genderKeyFromUserData(data);
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return;

        await rankingDayRollup.ensureRankingBucketsFilledForRange(db, userId, data, startStr, endStr);
        const dates = rankingDayRollup.listInclusiveYmdsSeoul(startStr, endStr);
        const refs = dates.map((ymd) => rankingDayRollup.bucketRef(db, userId, ymd));
        const bucketSnaps = await rankingDayRollup.chunkedGetAll(db, refs, 30);
        const canFourWeek = !!rankingDayRollup.splitInclusiveRangeIntoFourWeeks(startStr, endStr);
        let peakMap = null;
        if (canFourWeek) {
          peakMap = rankingDayRollup.computeFourWeekGcStylePeaksFromBucketSnaps(data, bucketSnaps, startStr, endStr);
        }
        if (!peakMap) {
          peakMap = rankingDayRollup.computeUserPeaksAllDurationsFromBucketSnaps(data, bucketSnaps, startStr, endStr);
        }
        const hrMax = rankingDayRollup.maxHrByDurationFromBucketSnaps(bucketSnaps, startStr, endStr);
        for (const slot of genders) {
          if (slot === "M" && gKey !== "M") continue;
          if (slot === "F" && gKey !== "F") continue;
          for (const dth of Object.keys(DURATION_HR_FIELDS)) {
            if (hrMax[dth] > 0) {
              cohortSum[slot][dth] += hrMax[dth];
              cohortN[slot][dth] += 1;
            }
          }
        }
        if (!peakMap) return;
        for (const dt of Object.keys(peakMap.peaks)) {
          const p = peakMap.peaks[dt];
          if (!p || p.wkg <= 0) continue;
          const row = {
            userId,
            name,
            wkg: p.wkg,
            watts: p.watts,
            weightKg: p.weightKg,
            ageCategory: leagueCategory,
            gender: String(data.gender || data.sex || "").toLowerCase(),
            is_private: privacyFlagFromFirestoreDoc(data),
            profileImageUrl: profileImageUrlFromUserData(data),
          };
          for (const slot of genders) {
            if (slot === "M" && gKey !== "M") continue;
            if (slot === "F" && gKey !== "F") continue;
            byGenderDur[slot][dt].raw.push({ ...row });
          }
        }
      })
    );
  }

  const out = { all: {}, M: {}, F: {} };
  genders.forEach((g) => {
    for (const dt of Object.keys(DURATION_FIELDS)) {
      const raw = byGenderDur[g][dt].raw;
      raw.sort((a, b) => b.wkg - a.wkg);
      const withRank = raw.map((e, j) => ({ ...e, rank: j + 1 }));
      const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
      withRank.forEach((e) => {
        if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
      });
      let cohortAvgHrBpm = null;
      if (DURATION_HR_FIELDS[dt] && cohortN[g][dt] > 0) {
        cohortAvgHrBpm = Math.round((cohortSum[g][dt] / cohortN[g][dt]) * 10) / 10;
      }
      out[g][dt] = { entries: withRank, byCategory, cohortAvgHrBpm: cohortAvgHrBpm != null && !isNaN(cohortAvgHrBpm) ? cohortAvgHrBpm : null };
    }
  });
  return out;
}

/**
 * uid가 참가한 방장 id 집합(최근 30일·서울, rides 스캔 1회)
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid
 */
async function getHostUserIdsForOpenRidesParticipation(db, uid, startStr, endStr) {
  const out = new Set();
  if (!uid) return out;
  const tsStart = admin.firestore.Timestamp.fromDate(new Date(`${startStr}T00:00:00+09:00`));
  const tsEnd = admin.firestore.Timestamp.fromDate(new Date(`${endStr}T23:59:59.999+09:00`));
  const uidStr = String(uid).trim();
  const ridesSnap = await db.collection("rides")
    .where("date", ">=", tsStart)
    .where("date", "<=", tsEnd)
    .get();
  ridesSnap.forEach((rdoc) => {
    const r = rdoc.data() || {};
    if (String(r.rideStatus || "active") === "cancelled") return;
    const ymd = rideDocDateToSeoulYmd(r.date);
    if (!ymd || ymd < startStr || ymd > endStr) return;
    const parts = Array.isArray(r.participants) ? r.participants : [];
    if (!parts.some((p) => String(p || "").trim() === uidStr)) return;
    const h = String(r.hostUserId || "").trim();
    if (h) out.add(h);
  });
  return out;
}

/**
 * 그룹 랭킹 응답(집계본)에 참가 여부·랭크만 뷰어에 맞게 덮어쓰기
 * @param {string|null} uid
 */
async function applyGroupRankingParticipationForViewer(db, byCategory, entries, startStr, endStr, uid) {
  if (!byCategory || !Array.isArray(entries)) return;
  const hostSet = await getHostUserIdsForOpenRidesParticipation(db, uid, startStr, endStr);
  const sup = byCategory.Supremo;
  if (Array.isArray(sup)) {
    for (const row of sup) {
      if (row && row.userId) {
        row.currentUserParticipated = hostSet.has(String(row.userId).trim());
      }
    }
  }
  for (const row of entries) {
    if (row && row.userId) {
      row.currentUserParticipated = hostSet.has(String(row.userId).trim());
    }
  }
}

/**
 * 주간 마일리지 TOP10 전용 집계만 갱신 (피크 타임 15~23시 매시).
 * `runRebuildRankingAggregatesCore` 전체 대비 부하가 작고, 운동 직후 TSS가 TOP10에 빨리 반영되도록 함.
 * @param {FirebaseFirestore.Firestore} db
 */
async function refreshWeeklyMileageTop10AggregatesOnly(db) {
  const t0 = Date.now();
  const { startStr: wStart, endStr: wEnd } = getWeekRangeSeoul();
  const { startStr: wPrevS, endStr: wPrevE } = getWeekRangeSeoul(-1);
  const sharedUsersSnap = await db.collection("users").get();
  console.log("[refreshWeeklyMileageTop10AggregatesOnly] start", {
    userCount: sharedUsersSnap.size,
    wStart,
    wEnd,
    wPrevS,
    wPrevE,
  });

  /** TSS 랭킹보드 탭과 동일 집계를 피크 시간대에도 갱신 → TOP10 팝업과 표시·순위 동기 */
  let entriesCurrent = null;
  for (const gender of ["all", "M", "F"]) {
    const tss = await getWeeklyTssRankingBoardEntries(db, wStart, wEnd, gender, sharedUsersSnap);
    if (gender === "all") {
      entriesCurrent = tss.entries.map((e) => ({
        userId: e.userId,
        name: e.name,
        totalTss: e.totalTss,
        is_private: e.is_private === true,
      }));
    }
    const keyTss = `peakRanking_weekly_tss_v2_${gender}_${wStart}_${wEnd}`;
    await writeRankingAggregatePayload(db, keyTss, {
      byCategory: tss.byCategory,
      entries: tss.entries,
      startStr: wStart,
      endStr: wEnd,
    });
  }

  const top10Current = (entriesCurrent || []).slice(0, 10).map((e, i) => ({
    rank: i + 1,
    userId: e.userId,
    name: e.name,
    totalTss: Math.round(e.totalTss * 100) / 100,
    is_private: e.is_private === true,
  }));
  const weeklyKey = `weekly_ranking_full_${wStart}_${wEnd}`;
  await writeRankingAggregatePayload(db, weeklyKey, {
    fullEntries: entriesCurrent || [],
    ranking: top10Current,
    startStr: wStart,
    endStr: wEnd,
  });

  const entriesPrev = await getWeeklyRankingEntries(db, wPrevS, wPrevE, sharedUsersSnap);
  const top10Prev = entriesPrev.slice(0, 10).map((e, i) => ({
    rank: i + 1,
    userId: e.userId,
    name: e.name,
    totalTss: Math.round(e.totalTss * 100) / 100,
    is_private: e.is_private === true,
  }));
  const weeklyKeyPrev = `weekly_ranking_full_${wPrevS}_${wPrevE}`;
  await writeRankingAggregatePayload(db, weeklyKeyPrev, {
    fullEntries: entriesPrev,
    ranking: top10Prev,
    startStr: wPrevS,
    endStr: wPrevE,
  });

  console.log("[refreshWeeklyMileageTop10AggregatesOnly] done", { ms: Date.now() - t0 });
}

/** @param {FirebaseFirestore.Firestore} db */
async function runRebuildRankingAggregatesCore(db) {
  const t0 = Date.now();
  let wrote = 0;
  const { startStr: wStart, endStr: wEnd } = getWeekRangeSeoul();
  const { startStr: wPrevS, endStr: wPrevE } = getWeekRangeSeoul(-1);
  const { startStr: r28s, endStr: r28e } = getRolling28DaysRangeSeoul();
  const { startStr: r30s, endStr: r30e } = getRolling30DaysRangeSeoul();
  const { startStr: r365s, endStr: r365e } = getRolling365DaysRangeSeoul();

  // [비용절감] users 컬렉션을 단 1회만 읽어 모든 랭킹 함수에 공유 주입 (기존 10회 → 1회)
  const sharedUsersSnap = await db.collection("users").get();
  console.log("[runRebuildRankingAggregatesCore] users snapshot fetched once, docs:", sharedUsersSnap.size);

  let weeklyRankingFullCurrent = null;
  for (const gender of ["all", "M", "F"]) {
    const tss = await getWeeklyTssRankingBoardEntries(db, wStart, wEnd, gender, sharedUsersSnap);
    if (gender === "all") {
      weeklyRankingFullCurrent = tss.entries.map((e) => ({
        userId: e.userId,
        name: e.name,
        totalTss: e.totalTss,
        is_private: e.is_private === true,
      }));
    }
    const keyTss = `peakRanking_weekly_tss_v2_${gender}_${wStart}_${wEnd}`;
    await writeRankingAggregatePayload(db, keyTss, {
      byCategory: tss.byCategory,
      entries: tss.entries,
      startStr: wStart,
      endStr: wEnd,
    });
    wrote++;

    const dist = await getRolling30dDistanceRankingBoardEntries(db, r30s, r30e, gender, sharedUsersSnap);
    const keyD = `peakRanking_personal_dist_30d_${gender}_${r30s}_${r30e}`;
    await writeRankingAggregatePayload(db, keyD, {
      byCategory: dist.byCategory,
      entries: dist.entries,
      startStr: r30s,
      endStr: r30e,
    });
    wrote++;
  }

  const group = await getRolling30dGroupDistanceByHostEntries(db, r30s, r30e, null);
  const keyG = `peakRanking_group_dist_30d_${r30s}_${r30e}`;
  await writeRankingAggregatePayload(db, keyG, {
    byCategory: group.byCategory,
    entries: group.entries,
    startStr: r30s,
    endStr: r30e,
  });
  wrote++;

  const allDurMonthly = await buildPeakPowerAllDurationsForRangeAllGendersOnePass(db, r28s, r28e, sharedUsersSnap);
  for (const gender of ["all", "M", "F"]) {
    for (const durationType of Object.keys(DURATION_FIELDS)) {
      const pack = allDurMonthly[gender][durationType];
      const ckey = `peakRanking_v2_monthly_${durationType}_${gender}_${r28s}_${r28e}`;
      await writeRankingAggregatePayload(db, ckey, {
        byCategory: pack.byCategory,
        entries: pack.entries,
        startStr: r28s,
        endStr: r28e,
        cohortAvgHrBpm: pack.cohortAvgHrBpm,
      });
      wrote++;
    }
  }

  const allDurYear = await buildPeakPowerAllDurationsForRangeAllGendersOnePass(db, r365s, r365e, sharedUsersSnap);
  for (const gender of ["all", "M", "F"]) {
    for (const durationType of Object.keys(DURATION_FIELDS)) {
      const pack = allDurYear[gender][durationType];
      const ckey = `peakRanking_v2_yearly_${durationType}_${gender}_${r365s}_${r365e}`;
      await writeRankingAggregatePayload(db, ckey, {
        byCategory: pack.byCategory,
        entries: pack.entries,
        startStr: r365s,
        endStr: r365e,
        cohortAvgHrBpm: pack.cohortAvgHrBpm,
      });
      wrote++;
    }
  }

  const entriesCurrent = weeklyRankingFullCurrent || [];
  const top10Current = entriesCurrent.slice(0, 10).map((e, i) => ({
    rank: i + 1,
    userId: e.userId,
    name: e.name,
    totalTss: Math.round(e.totalTss * 100) / 100,
    is_private: e.is_private === true,
  }));
  const weeklyKey = `weekly_ranking_full_${wStart}_${wEnd}`;
  await writeRankingAggregatePayload(db, weeklyKey, {
    fullEntries: entriesCurrent,
    ranking: top10Current,
    startStr: wStart,
    endStr: wEnd,
  });
  wrote++;

  const entriesPrev = await getWeeklyRankingEntries(db, wPrevS, wPrevE, sharedUsersSnap);
  const top10Prev = entriesPrev.slice(0, 10).map((e, i) => ({
    rank: i + 1,
    userId: e.userId,
    name: e.name,
    totalTss: Math.round(e.totalTss * 100) / 100,
    is_private: e.is_private === true,
  }));
  const weeklyKeyPrev = `weekly_ranking_full_${wPrevS}_${wPrevE}`;
  await writeRankingAggregatePayload(db, weeklyKeyPrev, {
    fullEntries: entriesPrev,
    ranking: top10Prev,
    startStr: wPrevS,
    endStr: wPrevE,
  });
  wrote++;

  const ms = Date.now() - t0;
  console.log("[runRebuildRankingAggregatesCore] done", { wrote, ms });
  return { wrote, ms };
}

/** KST 22:00 랭킹 집계 갱신 (하루 1회) */
exports.rebuildRankingAggregates = onSchedule(
  {
    schedule: RANKING_REBUILD_CRON,
    timeZone: "Asia/Seoul",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    try {
      await runRebuildRankingAggregatesCore(db);
    } catch (e) {
      console.error("[rebuildRankingAggregates]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

/** KST 15~23시 매 정시 — 주간 마일리지 TOP10 집계만 갱신 (운동 직후 TSS 반영 지연 완화) */
exports.scheduledWeeklyTop10PeakRefresh = onSchedule(
  {
    schedule: "0 15-23 * * *",
    timeZone: "Asia/Seoul",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    try {
      await refreshWeeklyMileageTop10AggregatesOnly(db);
    } catch (e) {
      console.error("[scheduledWeeklyTop10PeakRefresh]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

// ---------- STELVIO 헵타곤·GC 랭킹: 전원 코호트 순위 → heptagon_cohort_ranks (일 1회 22:30 갱신, 조회는 스냅샷 읽기) ----------
const heptagonCohortRanks = require("./heptagonCohortRanks");

/** 스케줄·수동 배치 공통 — `scheduledHeptagonCohortRanks` / `manualRebuildHeptagonCohortRanks` */
async function runHeptagonCohortRanksRebuildJob() {
  const db = admin.firestore();
  return heptagonCohortRanks.runRebuildHeptagonCohortRanks(db, {
    getPeakPowerRankingEntries,
    getLeagueCategory,
    getRolling28DaysRangeSeoul,
    admin,
    readRankingAggregatePayloadIfFresh,
    buildPeakPowerAllDurationsForRangeAllGendersOnePass,
  });
}

exports.scheduledHeptagonCohortRanks = onSchedule(
  {
    /** 매일 22:30 KST — 22:00 rebuildRankingAggregates 완료 후 rolling28 피크 집계를 바탕으로 스냅샷 재빌드(랭킹 GC는 이 문서만 읽음) */
    schedule: "30 22 * * *",
    timeZone: "Asia/Seoul",
    memory: "2GiB",
    timeoutSeconds: 540,
  },
  async () => {
    try {
      const r = await runHeptagonCohortRanksRebuildJob();
      console.log("[scheduledHeptagonCohortRanks] ok", r);
    } catch (e) {
      console.error("[scheduledHeptagonCohortRanks]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

/**
 * 수동: 헵타곤 코호트 스냅샷 + GC 랭킹용 `heptagon_cohort_ranks` 재빌드 (스케줄 본과 동일).
 * 인증:
 * - POST: `X-Internal-Secret`(INTERNAL_SYNC_SECRET) 또는 `?secret=` 또는 grade=1 Firebase Bearer.
 * - GET: `?secret=INTERNAL_SYNC_SECRET` 만 허용 (주소창·즐겨찾기용 — 시크릿이 URL/이력에 남음).
 * GET/POST https://<region>-stelvio-ai.cloudfunctions.net/manualRebuildHeptagonCohortRanks
 */
exports.manualRebuildHeptagonCohortRanks = onRequest(
  {
    cors: false,
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const runOk = async () => {
      const r = await runHeptagonCohortRanksRebuildJob();
      console.log("[manualRebuildHeptagonCohortRanks] ok", r);
      res.status(200).json({
        success: true,
        message: "heptagon_cohort_ranks 스냅샷을 갱신했습니다. 랭킹 GC 조회는 이 데이터를 사용합니다.",
        ...r,
      });
    };

    if (req.method === "GET") {
      if (req.query.secret !== INTERNAL_SYNC_SECRET) {
        res.status(403).json({
          success: false,
          error:
            "주소창은 GET 요청만 보냅니다. 내부용 시크릿이 필요합니다: URL에 ?secret=(INTERNAL_SYNC_SECRET과 동일 값) 추가, 또는 POST로 X-Internal-Secret 헤더를 보내세요.",
        });
        return;
      }
      try {
        await runOk();
      } catch (err) {
        console.error("[manualRebuildHeptagonCohortRanks]", err);
        res.status(500).json({
          success: false,
          error: err && err.message ? err.message : String(err),
        });
      }
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        error: "GET(?secret=) 또는 POST 로 호출하세요. Bearer 관리자는 POST 전용입니다.",
      });
      return;
    }
    try {
      const db = admin.firestore();
      const rawSecret =
        req.headers["x-internal-secret"] ||
        req.headers["X-Internal-Secret"] ||
        req.query.secret;
      let authorized = rawSecret === INTERNAL_SYNC_SECRET;

      if (!authorized) {
        const uid = await getUidFromRequest(req, res);
        if (!uid) return;
        const callerSnap = await db.collection("users").doc(uid).get();
        const grade = callerSnap.exists ? String((callerSnap.data() || {}).grade ?? "2") : "2";
        if (grade !== "1") {
          res.status(403).json({
            success: false,
            error: "관리자(grade=1) 또는 X-Internal-Secret 헤더가 필요합니다.",
          });
          return;
        }
        authorized = true;
      }

      await runOk();
    } catch (err) {
      console.error("[manualRebuildHeptagonCohortRanks]", err);
      res.status(500).json({
        success: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }
);

/**
 * [1회성 검증] 순위 등락 미리보기 — 읽기 전용, Firestore 쓰기 없음.
 *
 * 현재 `heptagon_cohort_ranks` 의 sumPositionScores 로 새 순위를 재계산해
 * "rebuildHeptagonCohortRanks 실행 시 어떤 rankChange 가 기록될지" 미리 확인합니다.
 *
 * GET https://<region>-stelvio-ai.cloudfunctions.net/previewHeptagonRankChanges
 *   ?secret=stelvio-internal-sync-v1
 *   &gender=all          (all|M|F, 기본 all)
 *   &category=Supremo    (Supremo|Assoluto|Bianco|Rosa|Infinito|Leggenda, 기본 Supremo)
 *   &limit=50            (최대 200, 기본 50)
 */
exports.previewHeptagonRankChanges = onRequest(
  { cors: false, timeoutSeconds: 120, memory: "512MiB" },
  async (req, res) => {
    const secret = req.query.secret || req.headers["x-internal-secret"] || req.headers["X-Internal-Secret"];
    if (secret !== INTERNAL_SYNC_SECRET) {
      res.status(403).json({ success: false, error: "?secret= 값이 올바르지 않습니다." });
      return;
    }

    const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    const monthKey = heptagonCohortRanks.getMonthKeyKstNow();
    const filterGender = req.query.gender || "all";
    const filterCategory = req.query.category || "Supremo";
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    try {
      const db = admin.firestore();

      const snap = await db
        .collection(heptagonCohortRanks.HEPTAGON_COHORT_COL)
        .where("monthKey", "==", monthKey)
        .where("filterGender", "==", filterGender)
        .where("filterCategory", "==", filterCategory)
        .get();

      if (snap.empty) {
        res.status(200).json({
          success: true,
          message: "해당 조건의 문서가 없습니다.",
          monthKey, filterGender, filterCategory,
        });
        return;
      }

      // sumPositionScores 기준 재정렬 → 신규 순위 계산 (rebuildHeptagonCohortRanks 와 동일 정렬)
      const rows = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          docId: doc.id,
          userId: d.userId || "",
          displayName: (d.displayName || "(이름없음)").toString().trim(),
          boardRank: d.boardRank != null && isFinite(Number(d.boardRank)) ? Math.floor(Number(d.boardRank)) : null,
          sumPositionScores: d.sumPositionScores != null && isFinite(Number(d.sumPositionScores)) ? Number(d.sumPositionScores) : 0,
          asOfSeoul: d.asOfSeoul || "",
          storedPreviousBoardRank: d.previousBoardRank != null ? Number(d.previousBoardRank) : null,
          storedRankChange: d.rankChange != null ? Number(d.rankChange) : null,
        };
      });

      rows.sort((a, b) => {
        if (b.sumPositionScores !== a.sumPositionScores) return b.sumPositionScores - a.sumPositionScores;
        return String(a.userId).localeCompare(String(b.userId));
      });

      const docsAsOf = rows.length > 0 ? rows[0].asOfSeoul : null;
      const isNewDay = docsAsOf !== todayYmd;

      const samples = rows.slice(0, limit).map((r, i) => {
        const newRank = i + 1;
        const prevRank = r.boardRank; // 어제 집계된 순위
        const change = prevRank != null ? prevRank - newRank : null;
        return {
          newRank,
          prevRank,
          rankChange: change,
          direction: change == null ? "신규" : change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : "-",
          userId: r.userId,
          displayName: r.displayName,
          sumPositionScores: Number(r.sumPositionScores.toFixed(2)),
          asOfSeoul: r.asOfSeoul,
          storedPreviousBoardRank: r.storedPreviousBoardRank,
          storedRankChange: r.storedRankChange,
        };
      });

      const summary = {
        total: rows.length,
        shown: samples.length,
        isNewDay,
        todayYmd,
        docsAsOf,
        improved: samples.filter((r) => r.rankChange != null && r.rankChange > 0).length,
        declined: samples.filter((r) => r.rankChange != null && r.rankChange < 0).length,
        same: samples.filter((r) => r.rankChange === 0).length,
        newEntry: samples.filter((r) => r.rankChange == null).length,
      };

      res.status(200).json({
        success: true,
        monthKey,
        filterGender,
        filterCategory,
        note: isNewDay
          ? "✅ 문서가 어제 기준입니다. 아래 samples 의 rankChange 가 실제 갱신 시 저장될 값입니다. manualApplyRankChanges 로 지금 바로 적용할 수 있습니다."
          : "ℹ️ 오늘 이미 갱신된 문서입니다. storedRankChange 에 저장된 값을 확인하세요.",
        summary,
        samples,
      });
    } catch (err) {
      console.error("[previewHeptagonRankChanges]", err);
      res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
    }
  }
);

/**
 * [1회성 수동 적용] 순위 등락(rankChange / previousBoardRank) 을 지금 즉시 계산·저장.
 * — 스케줄 본(`scheduledHeptagonCohortRanks`) 과 완전히 동일한 코드 경로 실행.
 * — 먼저 `previewHeptagonRankChanges` 로 예상 변동을 확인한 뒤 실행 권장.
 *
 * GET  https://<region>-stelvio-ai.cloudfunctions.net/manualApplyRankChanges?secret=stelvio-internal-sync-v1
 * POST X-Internal-Secret: stelvio-internal-sync-v1
 *
 * 응답: { success, monthKey, startStr, endStr, wrote, ms, peakSource }
 */
exports.manualApplyRankChanges = onRequest(
  { cors: false, timeoutSeconds: 540, memory: "2GiB" },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const secret =
      req.query.secret ||
      req.headers["x-internal-secret"] ||
      req.headers["X-Internal-Secret"];

    if (secret !== INTERNAL_SYNC_SECRET) {
      res.status(403).json({
        success: false,
        error: "인증 실패 — GET: ?secret=stelvio-internal-sync-v1 / POST: X-Internal-Secret 헤더 사용",
      });
      return;
    }

    // 프록시 타임아웃 대응: 202 를 먼저 응답하고 Cloud Run 인스턴스가 백그라운드에서 작업을 계속 실행.
    // Cloud Run(Firebase Functions v2)은 res.json() 이후에도 timeoutSeconds(540s)까지 핸들러가 실행됨.
    const startedAt = new Date().toISOString();
    console.log("[manualApplyRankChanges] 수동 1회 실행 시작", startedAt);
    res.status(202).json({
      success: true,
      status: "started",
      message:
        "작업이 시작되었습니다. 약 2~4분 후 Firebase Console → Functions → 로그에서 " +
        "'[manualApplyRankChanges] 완료' 메시지를 확인하세요.",
      startedAt,
      logKeyword: "[manualApplyRankChanges] 완료",
    });

    // 응답 후 실행 — 프록시가 연결을 끊어도 Cloud Run 인스턴스는 계속 동작
    try {
      const r = await runHeptagonCohortRanksRebuildJob();
      console.log("[manualApplyRankChanges] 완료", JSON.stringify({ ...r, startedAt }));
    } catch (err) {
      console.error("[manualApplyRankChanges] 오류", err && err.message ? err.message : String(err));
    }
  }
);

/** 동기부여 메시지 (주간 TSS 랭킹) */
function buildMotivationMessageTss(currentUser, nextUser) {
  if (!currentUser || !nextUser || currentUser.rank >= nextUser.rank) return null;
  const diffTss = Number(nextUser.totalTss) - Number(currentUser.totalTss);
  if (diffTss <= 0) return null;
  const need = Math.ceil(diffTss);
  return `${currentUser.name}님 현재 ${currentUser.rank}위! 앞선 사용자와의 차이는 ${diffTss.toFixed(1)} TSS입니다. 주간 합계를 ${need} TSS 이상 더 올리면 추월할 수 있습니다. 도전해 보세요!`;
}

/** 동기부여 메시지 (30일 거리 랭킹 — 개인·그룹 공통) */
function buildMotivationMessageKm(currentUser, nextUser) {
  if (!currentUser || !nextUser || currentUser.rank >= nextUser.rank) return null;
  const diffKm = Number(nextUser.totalKm) - Number(currentUser.totalKm);
  if (diffKm <= 0) return null;
  const need = Math.ceil(diffKm * 10) / 10;
  return `${currentUser.name}님 현재 ${currentUser.rank}위! 앞선 사용자와의 차이는 ${diffKm.toFixed(1)} km입니다. ${need.toFixed(1)} km 이상 더 올리면 추월할 수 있습니다. 도전해 보세요!`;
}

/** 훈련일지 5주차 구간 (오늘-6일 ~ 오늘, Asia/Seoul) — Weekly TSS Load와 동일 */
function getWeek5RangeSeoul(todayStr) {
  const pad = (n) => String(n).padStart(2, "0");
  let y, m, d;
  if (todayStr && /^\d{4}-\d{2}-\d{2}$/.test(todayStr)) {
    const parts = todayStr.split("-").map(Number);
    y = parts[0]; m = parts[1]; d = parts[2];
  } else {
    const now = new Date();
    const koreaStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    [y, m, d] = koreaStr.split("-").map(Number);
  }
  const today = new Date(y, m - 1, d);
  const start = new Date(today);
  start.setDate(today.getDate() - 6);
  const startStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const endStr = `${y}-${pad(m)}-${pad(d)}`;
  return { startStr, endStr };
}

/** 추월하기 분석: TSS 차이 및 목표 파워(W) 향상치 계산 (시스템 계산, AI 의존 없음) */
function computeOvertakeMetrics(myData, rivalData, myWeightKg) {
  const myWkg = Number(myData?.wkg) || 0;
  const rivalWkg = Number(rivalData?.wkg) || 0;
  const myTSS = Number(myData?.weeklyTss) ?? 0;
  const rivalTSS = Number(rivalData?.weeklyTss) ?? 0;
  const weightKg = Math.max(Number(myWeightKg) || 0, 45);
  const diffWkg = Math.max(0, rivalWkg - myWkg);
  const targetPowerIncrease = Math.ceil(diffWkg * weightKg);
  const tssDiff = rivalTSS - myTSS;
  return {
    myPower: Number(myData?.watts) || 0,
    rivalPower: Number(rivalData?.watts) || 0,
    myWkg,
    rivalWkg,
    myTSS,
    rivalTSS,
    tssDiff,
    targetPowerIncrease,
  };
}

/** 동기부여 메시지 생성 */
function buildMotivationMessage(currentUser, nextUser) {
  if (!currentUser || !nextUser || currentUser.rank >= nextUser.rank) return null;
  if (currentUser.gcScore != null && nextUser.gcScore != null) {
    const diff = Number(nextUser.gcScore) - Number(currentUser.gcScore);
    if (!(diff > 0)) return null;
    return `${currentUser.name}님 현재 ${currentUser.rank}위! 바로 앞 순위와의 환산 점수 차는 약 ${diff.toFixed(1)}점입니다.`;
  }
  if (currentUser.totalKm != null && nextUser.totalKm != null) {
    return buildMotivationMessageKm(currentUser, nextUser);
  }
  if (currentUser.totalTss != null && nextUser.totalTss != null) {
    return buildMotivationMessageTss(currentUser, nextUser);
  }
  const diffWkg = nextUser.wkg - currentUser.wkg;
  if (diffWkg <= 0) return null;
  const weightKg = Number(currentUser.weightKg) || 0;
  if (weightKg <= 0) return null;
  const requiredWatts = Math.ceil(diffWkg * weightKg);
  const targetWatts = (currentUser.watts || 0) + requiredWatts;
  return `${currentUser.name}님 현재 ${currentUser.rank}위! 앞선 사용자와의 차이는 ${diffWkg.toFixed(2)} W/kg로, ${requiredWatts}W 향상 시키면(목표 파워: ${targetWatts}W) 추월할 수 있습니다. 도전해 보세요!`;
}

/** GC 헵타곤: 부문·성별별 최대 포함 행(단일 Firestore 조회 한도 초과분은 페이지로 이어받음). */
const GC_RANKING_MAX_ROWS_PER_CATEGORY = 10000;
/** 한 번 페이지 조회 크기(Firestore 1 라운드트립당 문서 상한을 완만히 둠). */
const GC_RANKING_FETCH_PAGE_SIZE = 2500;
/** M/F 순위 통일용 Supremo·gender=all 참조 사용자 수 상한(부문 상한과 정렬 유지 위해 동일 크기). */
const GC_RANKING_SUPERMO_ALL_FETCH_CAP = 10000;

/**
 * GC(헵타곤 환산): `heptagon_cohort_ranks` 읽기. 행 순서·표시 순위는 `sumPositionScores` desc 쿼리 결과와 일치시킴
 * (`boardRank`는 스냅샷 필드라 점수만 먼저 갱신될 때 헵타곤 카드와 숫자가 어긋날 수 있음).
 * 성별 M/F: 전체(all)·Supremo 환산 합으로 점수 통일 후 해당 성별 부문 재정렬·순위 부여.
 */
async function buildStelvioGcRankingPayload(db, monthKey, filterGender) {
  const col = db.collection(heptagonCohortRanks.HEPTAGON_COHORT_COL);
  const categories = heptagonCohortRanks.HEPTAGON_CATEGORIES;
  const byCategory = { Supremo: [], Assoluto: [], Bianco: [], Rosa: [], Infinito: [], Leggenda: [] };

  let snapshotRangeStart = "";
  let snapshotRangeEnd = "";
  let snapshotAsOfSeoul = "";
  function captureSnapshotMeta(d) {
    if (!d || snapshotRangeStart) return;
    if (d.rangeStart == null || String(d.rangeStart).trim() === "") return;
    snapshotRangeStart = String(d.rangeStart).trim();
    snapshotRangeEnd = d.rangeEnd != null ? String(d.rangeEnd).trim() : "";
    snapshotAsOfSeoul = d.asOfSeoul != null ? String(d.asOfSeoul).trim() : "";
  }

  const applyGenderScoreUnify = filterGender === "M" || filterGender === "F";
  let supreAllScores = null;
  if (applyGenderScoreUnify) {
    supreAllScores = new Map();
    let curLast = null;
    let supFetched = 0;
    while (supFetched < GC_RANKING_SUPERMO_ALL_FETCH_CAP) {
      const need = GC_RANKING_SUPERMO_ALL_FETCH_CAP - supFetched;
      let qAll = col
        .where("monthKey", "==", monthKey)
        .where("filterCategory", "==", "Supremo")
        .where("filterGender", "==", "all")
        .orderBy("sumPositionScores", "desc")
        .limit(Math.min(GC_RANKING_FETCH_PAGE_SIZE, need));
      if (curLast) qAll = qAll.startAfter(curLast);
      const snapAll = await qAll.get();
      if (!snapAll || snapAll.empty || !snapAll.docs.length) break;
      for (let ai = 0; ai < snapAll.docs.length; ai++) {
        const docSnap = snapAll.docs[ai];
        const d = docSnap.data();
        captureSnapshotMeta(d);
        if (d && d.userId != null && d.sumPositionScores != null && isFinite(Number(d.sumPositionScores))) {
          supreAllScores.set(String(d.userId), Number(d.sumPositionScores));
        }
      }
      supFetched += snapAll.docs.length;
      if (snapAll.docs.length < Math.min(GC_RANKING_FETCH_PAGE_SIZE, need)) break;
      curLast = snapAll.docs[snapAll.docs.length - 1];
    }
  }

  const categoryRowsLists = await Promise.all(
    categories.map(async (cat) => {
      const rows = [];
      let seq = 0;
      let cursor = null;
      while (rows.length < GC_RANKING_MAX_ROWS_PER_CATEGORY) {
        const room = GC_RANKING_MAX_ROWS_PER_CATEGORY - rows.length;
        let q = col
          .where("monthKey", "==", monthKey)
          .where("filterCategory", "==", cat)
          .where("filterGender", "==", filterGender)
          .orderBy("sumPositionScores", "desc")
          .limit(Math.min(GC_RANKING_FETCH_PAGE_SIZE, room));
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.get();
        if (!snap || snap.empty || !snap.docs.length) break;
        for (let di = 0; di < snap.docs.length; di++) {
          const docSnap = snap.docs[di];
          const d = docSnap.data();
          captureSnapshotMeta(d);
          if (!d || !d.userId) continue;
          seq += 1;
          const uid = String(d.userId);
          let gcScore = d.sumPositionScores != null && isFinite(Number(d.sumPositionScores)) ? Number(d.sumPositionScores) : 0;
          if (applyGenderScoreUnify && supreAllScores.has(uid)) {
            gcScore = supreAllScores.get(uid);
          }
          const g = filterGender === "F" ? "female" : filterGender === "M" ? "male" : "male";
          rows.push({
            userId: uid,
            name: (d.displayName && String(d.displayName).trim()) || "(이름 없음)",
            ageCategory: d.ageCategory != null ? String(d.ageCategory) : "",
            gender: g,
            is_private: privacyFlagFromFirestoreDoc(d),
            rank: seq,
            gcScore,
            rankChange: d.rankChange != null && isFinite(Number(d.rankChange)) ? Math.round(Number(d.rankChange)) : null,
            previousBoardRank: d.previousBoardRank != null && isFinite(Number(d.previousBoardRank)) ? Math.floor(Number(d.previousBoardRank)) : null,
          });
        }
        const got = snap.docs.length;
        if (got < Math.min(GC_RANKING_FETCH_PAGE_SIZE, room)) break;
        cursor = snap.docs[snap.docs.length - 1];
        if (!cursor) break;
      }
      if (applyGenderScoreUnify) {
        rows.sort((a, b) => {
          if (b.gcScore !== a.gcScore) return b.gcScore - a.gcScore;
          return String(a.userId).localeCompare(String(b.userId));
        });
        for (let ri = 0; ri < rows.length; ri++) {
          rows[ri].rank = ri + 1;
        }
      }
      return { cat, rows };
    })
  );
  for (let cri = 0; cri < categoryRowsLists.length; cri++) {
    const pr = categoryRowsLists[cri];
    byCategory[pr.cat] = pr.rows;
  }
  await hydrateRankingBoardProfileImages(db, byCategory);
  const entries = (byCategory.Supremo || []).slice();
  await hydrateRankingBoardPrivacyFromUsers(db, byCategory, entries);
  return { byCategory, entries, snapshotRangeStart, snapshotRangeEnd, snapshotAsOfSeoul };
}

const PEAK_RANKING_CACHE_TTL_MS = 5 * 60 * 1000;

/** 피크 파워 랭킹 API */
exports.getPeakPowerRanking = onRequest(
  { cors: true, timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    try {
    const period = req.query.period || "monthly";
    const durationType = req.query.duration || "5min";
    const gender = req.query.gender || "all";
    const uid = req.query.uid || null;
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month, 10) : new Date().getMonth() + 1;

    const db = admin.firestore();
    /** 집계/캐시 행은 스냅샷 시점의 is_private일 수 있음 → 응답 직전 users 기준 비공개·프로필 URL 보강 */
    const finalizeRankingProfileUrls = async (payload) => {
      if (!payload || !payload.byCategory) return;
      await hydrateRankingBoardPrivacyFromUsers(db, payload.byCategory, payload.entries);
      await hydrateRankingBoardProfileImages(db, payload.byCategory, payload.entries);
    };

    /** 주간 TSS 랭킹 탭: 기간은 주간 마일리지 TOP10과 동일(월~오늘), 월간/명예 필터 미적용 */
    if (durationType === "tss") {
      const { startStr, endStr } = getWeekRangeSeoul();
      const cacheKey = `peakRanking_weekly_tss_v2_${gender}_${startStr}_${endStr}`;
      const aggTss = await readRankingAggregatePayloadIfFresh(db, cacheKey);
      if (aggTss && aggTss.byCategory) {
        let out = {
          success: true,
          byCategory: aggTss.byCategory,
          startStr,
          endStr,
          period: "weekly",
          durationType: "tss",
          gender,
          precomputed: true,
        };
        if (uid) {
          const cat = aggTss.byCategory;
          let current = null; let nextUser = null;
          for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
            const arr = cat?.[c] || [];
            const idx = arr.findIndex((e) => e.userId === uid);
            if (idx >= 0) {
              current = arr[idx];
              nextUser = idx > 0 ? arr[idx - 1] : null;
              break;
            }
          }
          if (current) {
            out.currentUser = current;
            out.motivationMessage = buildMotivationMessage(current, nextUser);
          }
        }
        await finalizeRankingProfileUrls(out);
        return res.status(200).json(out);
      }
      const cacheRef = db.collection("cache").doc(cacheKey);
      const cacheSnap = await cacheRef.get();
      const nowMs = Date.now();
      if (cacheSnap.exists) {
        const data = cacheSnap.data();
        const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
        if (updatedAt && nowMs - updatedAt < PEAK_RANKING_CACHE_TTL_MS) {
          let out = {
            success: true,
            byCategory: data.byCategory,
            startStr,
            endStr,
            period: "weekly",
            durationType: "tss",
            gender,
            cached: true,
          };
          const entries = Array.isArray(data.entries) ? data.entries : [];
          if (uid) {
            const cat = data.byCategory;
            let current = null; let nextUser = null;
            for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
              const arr = cat?.[c] || [];
              const idx = arr.findIndex((e) => e.userId === uid);
              if (idx >= 0) {
                current = arr[idx];
                nextUser = idx > 0 ? arr[idx - 1] : null;
                break;
              }
            }
            if (current) {
              out.currentUser = current;
              out.motivationMessage = buildMotivationMessage(current, nextUser);
            }
          }
          await finalizeRankingProfileUrls(out);
          return res.status(200).json(out);
        }
      }

      const { entries, byCategory } = await getWeeklyTssRankingBoardEntries(db, startStr, endStr, gender);
      await writeRankingAggregatePayload(db, cacheKey, { byCategory, entries, startStr, endStr });
      await hydrateRankingBoardProfileImages(db, byCategory, entries);
      await cacheRef.set({
        byCategory,
        entries,
        startStr,
        endStr,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      let out = { success: true, byCategory, startStr, endStr, period: "weekly", durationType: "tss", gender };
      if (uid) {
        let current = null; let nextUser = null;
        for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
          const arr = byCategory[c] || [];
          const idx = arr.findIndex((e) => e.userId === uid);
          if (idx >= 0) {
            current = arr[idx];
            nextUser = idx > 0 ? arr[idx - 1] : null;
            break;
          }
        }
        if (current) {
          out.currentUser = current;
          out.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      await finalizeRankingProfileUrls(out);
      return res.status(200).json(out);
    }

    /** 개인: 최근 30일(서울) 라이딩 거리(km) 랭킹 */
    if (durationType === "personal_dist") {
      const { startStr, endStr } = getRolling30DaysRangeSeoul();
      const cacheKey = `peakRanking_personal_dist_30d_${gender}_${startStr}_${endStr}`;
      const aggPd = await readRankingAggregatePayloadIfFresh(db, cacheKey);
      if (aggPd && aggPd.byCategory) {
        let out = {
          success: true,
          byCategory: aggPd.byCategory,
          entries: Array.isArray(aggPd.entries) ? aggPd.entries : [],
          startStr,
          endStr,
          period: "rolling30",
          durationType: "personal_dist",
          gender,
          precomputed: true,
        };
        if (uid) {
          const cat = aggPd.byCategory;
          let current = null; let nextUser = null;
          for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
            const arr = cat?.[c] || [];
            const idx = arr.findIndex((e) => e.userId === uid);
            if (idx >= 0) {
              current = arr[idx];
              nextUser = idx > 0 ? arr[idx - 1] : null;
              break;
            }
          }
          if (current) {
            out.currentUser = current;
            out.motivationMessage = buildMotivationMessage(current, nextUser);
          }
        }
        await finalizeRankingProfileUrls(out);
        return res.status(200).json(out);
      }
      const cacheRef = db.collection("cache").doc(cacheKey);
      const cacheSnap = await cacheRef.get();
      const nowMs = Date.now();
      if (cacheSnap.exists) {
        const data = cacheSnap.data();
        const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
        if (updatedAt && nowMs - updatedAt < PEAK_RANKING_CACHE_TTL_MS) {
          const out = {
            success: true,
            byCategory: data.byCategory,
            entries: Array.isArray(data.entries) ? data.entries : [],
            startStr,
            endStr,
            period: "rolling30",
            durationType: "personal_dist",
            gender,
            cached: true,
          };
          if (uid) {
            let current = null; let nextUser = null;
            const cat = data.byCategory;
            for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
              const arr = cat?.[c] || [];
              const idx = arr.findIndex((e) => e.userId === uid);
              if (idx >= 0) {
                current = arr[idx];
                nextUser = idx > 0 ? arr[idx - 1] : null;
                break;
              }
            }
            if (current) {
              out.currentUser = current;
              out.motivationMessage = buildMotivationMessage(current, nextUser);
            }
          }
          await finalizeRankingProfileUrls(out);
          return res.status(200).json(out);
        }
      }

      const { entries, byCategory } = await getRolling30dDistanceRankingBoardEntries(db, startStr, endStr, gender);
      await writeRankingAggregatePayload(db, cacheKey, { byCategory, entries, startStr, endStr });
      await hydrateRankingBoardProfileImages(db, byCategory, entries);
      await cacheRef.set({
        byCategory,
        entries,
        startStr,
        endStr,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const out = { success: true, byCategory, entries, startStr, endStr, period: "rolling30", durationType: "personal_dist", gender };
      if (uid) {
        let current = null; let nextUser = null;
        for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
          const arr = byCategory[c] || [];
          const idx = arr.findIndex((e) => e.userId === uid);
          if (idx >= 0) {
            current = arr[idx];
            nextUser = idx > 0 ? arr[idx - 1] : null;
            break;
          }
        }
        if (current) {
          out.currentUser = current;
          out.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      await finalizeRankingProfileUrls(out);
      return res.status(200).json(out);
    }

    /** 그룹: 방장별 최근 30일 오픈 라이딩 합산(일정당 참가자 당일 라이딩 거리 합) */
    if (durationType === "group_dist") {
      const { startStr, endStr } = getRolling30DaysRangeSeoul();
      const cacheKey = `peakRanking_group_dist_30d_${startStr}_${endStr}`;
      const aggG = await readRankingAggregatePayloadIfFresh(db, cacheKey);
      if (aggG && aggG.byCategory) {
        const byCategory = JSON.parse(JSON.stringify(aggG.byCategory));
        const entries = JSON.parse(JSON.stringify(Array.isArray(aggG.entries) ? aggG.entries : []));
        await applyGroupRankingParticipationForViewer(db, byCategory, entries, startStr, endStr, uid);
        const arrAll = byCategory?.Supremo || [];
        const out = {
          success: true,
          byCategory,
          entries,
          startStr,
          endStr,
          period: "rolling30",
          durationType: "group_dist",
          gender: "all",
          precomputed: true,
        };
        if (uid) {
          const participated = arrAll.filter((e) => e.currentUserParticipated || e.userId === uid);
          let current = null;
          if (participated.length) {
            current = participated.reduce((best, e) => (!best || e.rank < best.rank ? e : best));
          }
          let nextUser = null;
          if (current && current.rank > 1) {
            nextUser = arrAll.find((e) => e.rank === current.rank - 1) || null;
          }
          if (current) {
            out.currentUser = current;
            out.motivationMessage = buildMotivationMessage(current, nextUser);
          }
        }
        await finalizeRankingProfileUrls(out);
        return res.status(200).json(out);
      }
      const cacheRef = db.collection("cache").doc(cacheKey);
      const cacheSnap = await cacheRef.get();
      const nowMs = Date.now();
      if (cacheSnap.exists) {
        const data = cacheSnap.data();
        const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
        if (updatedAt && nowMs - updatedAt < PEAK_RANKING_CACHE_TTL_MS) {
          const byCategory = JSON.parse(JSON.stringify(data.byCategory || {}));
          const entries = JSON.parse(JSON.stringify(Array.isArray(data.entries) ? data.entries : []));
          await applyGroupRankingParticipationForViewer(db, byCategory, entries, startStr, endStr, uid);
          const arrAll = byCategory?.Supremo || [];
          const out = {
            success: true,
            byCategory,
            entries,
            startStr,
            endStr,
            period: "rolling30",
            durationType: "group_dist",
            gender: "all",
            cached: true,
          };
          if (uid) {
            const participated = arrAll.filter((e) => e.currentUserParticipated || e.userId === uid);
            let current = null;
            if (participated.length) {
              current = participated.reduce((best, e) => (!best || e.rank < best.rank ? e : best));
            }
            let nextUser = null;
            if (current && current.rank > 1) {
              nextUser = arrAll.find((e) => e.rank === current.rank - 1) || null;
            }
            if (current) {
              out.currentUser = current;
              out.motivationMessage = buildMotivationMessage(current, nextUser);
            }
          }
          await finalizeRankingProfileUrls(out);
          return res.status(200).json(out);
        }
      }

      const { entries, byCategory } = await getRolling30dGroupDistanceByHostEntries(db, startStr, endStr, null);
      const byCategoryAgg = JSON.parse(JSON.stringify(byCategory));
      const entriesAgg = JSON.parse(JSON.stringify(entries));
      await applyGroupRankingParticipationForViewer(db, byCategoryAgg, entriesAgg, startStr, endStr, null);
      await writeRankingAggregatePayload(db, cacheKey, { byCategory: byCategoryAgg, entries: entriesAgg, startStr, endStr });
      await hydrateRankingBoardProfileImages(db, byCategory, entries);
      await cacheRef.set({
        byCategory,
        entries,
        startStr,
        endStr,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const byCatOut = JSON.parse(JSON.stringify(byCategory));
      const entriesOut = JSON.parse(JSON.stringify(entries));
      await applyGroupRankingParticipationForViewer(db, byCatOut, entriesOut, startStr, endStr, uid);
      const out = { success: true, byCategory: byCatOut, entries: entriesOut, startStr, endStr, period: "rolling30", durationType: "group_dist", gender: "all" };
      if (uid) {
        const arrAll = byCatOut.Supremo || [];
        const participated = arrAll.filter((e) => e.currentUserParticipated || e.userId === uid);
        let current = null;
        if (participated.length) {
          current = participated.reduce((best, e) => (!best || e.rank < best.rank ? e : best));
        }
        let nextUser = null;
        if (current && current.rank > 1) {
          nextUser = arrAll.find((e) => e.rank === current.rank - 1) || null;
        }
        if (current) {
          out.currentUser = current;
          out.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      await finalizeRankingProfileUrls(out);
      return res.status(200).json(out);
    }

    /** GC: 헵타곤 7축 환산 합 — `heptagon_cohort_ranks` 일일 스냅샷(22:30 `scheduledHeptagonCohortRanks` 갱신) */
    if (durationType === "gc") {
      const monthKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).slice(0, 7);
      const fg = gender === "M" || gender === "F" ? gender : "all";
      let byCategory;
      let entries;
      let snap;
      try {
        snap = await buildStelvioGcRankingPayload(db, monthKey, fg);
        byCategory = snap.byCategory;
        entries = snap.entries;
      } catch (eGc) {
        console.warn("[getPeakPowerRanking gc]", eGc && eGc.message ? eGc.message : eGc);
        return res.status(500).json({ success: false, error: "gc_ranking_failed" });
      }
      const rollingFallback = getRolling28DaysRangeSeoul();
      const out = {
        success: true,
        byCategory,
        entries,
        startStr: snap.snapshotRangeStart || rollingFallback.startStr,
        endStr: snap.snapshotRangeEnd || rollingFallback.endStr,
        period: "monthly",
        durationType: "gc",
        gender: fg,
        gcMonthKey: monthKey,
        gcSnapshotAsOf: snap.snapshotAsOfSeoul || null,
        gcSnapshotDaily: true,
      };
      if (uid) {
        let current = null;
        let nextUser = null;
        for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
          const arr = byCategory[c] || [];
          const idx = arr.findIndex((e) => e.userId === uid);
          if (idx >= 0) {
            current = arr[idx];
            nextUser = idx > 0 ? arr[idx - 1] : null;
            break;
          }
        }
        if (current) {
          out.currentUser = current;
          out.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      return res.status(200).json(out);
    }

    let startStr, endStr;
    if (period === "yearly") {
      const r = getRolling365DaysRangeSeoul();
      startStr = r.startStr;
      endStr = r.endStr;
    } else if (period === "rolling6m" || period === "rolling183") {
      const r = getRolling183DaysRangeSeoul();
      startStr = r.startStr;
      endStr = r.endStr;
    } else if (period === "rolling30" || period === "monthly") {
      const r = getRolling28DaysRangeSeoul();
      startStr = r.startStr;
      endStr = r.endStr;
    } else {
      const r = getMonthRangeSeoul(year, month);
      startStr = r.startStr;
      endStr = r.endStr;
    }

    const cacheKey = `peakRanking_v2_${period}_${durationType}_${gender}_${startStr}_${endStr}`;
    const aggPeak = await readRankingAggregatePayloadIfFresh(db, cacheKey);
    if (aggPeak && aggPeak.byCategory) {
      let out = {
        success: true,
        byCategory: aggPeak.byCategory,
        startStr,
        endStr,
        period,
        durationType,
        gender,
        precomputed: true,
      };
      if (aggPeak.cohortAvgHrBpm != null && !isNaN(Number(aggPeak.cohortAvgHrBpm))) {
        out.cohortAvgHrBpm = Number(aggPeak.cohortAvgHrBpm);
      }
      if (uid) {
        const cat = aggPeak.byCategory;
        let current = null, nextUser = null;
        for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
          const arr = cat?.[c] || [];
          const idx = arr.findIndex((e) => e.userId === uid);
          if (idx >= 0) {
            current = arr[idx];
            nextUser = idx > 0 ? arr[idx - 1] : null;
            break;
          }
        }
        if (current) {
          out.currentUser = current;
          out.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      await finalizeRankingProfileUrls(out);
      return res.status(200).json(out);
    }
    const cacheRef = db.collection("cache").doc(cacheKey);
    const cacheSnap = await cacheRef.get();
    const nowMs = Date.now();
    if (cacheSnap.exists) {
      const data = cacheSnap.data();
      const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
      if (updatedAt && nowMs - updatedAt < PEAK_RANKING_CACHE_TTL_MS) {
        let out = { success: true, byCategory: data.byCategory, startStr, endStr, period, durationType, gender, cached: true };
        if (data.cohortAvgHrBpm != null && !isNaN(Number(data.cohortAvgHrBpm))) {
          out.cohortAvgHrBpm = Number(data.cohortAvgHrBpm);
        }
        const entries = Array.isArray(data.entries) ? data.entries : [];
        if (uid) {
          const cat = data.byCategory;
          let current = null, nextUser = null;
          for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
            const arr = cat?.[c] || [];
            const idx = arr.findIndex((e) => e.userId === uid);
            if (idx >= 0) {
              current = arr[idx];
              nextUser = idx > 0 ? arr[idx - 1] : null;
              break;
            }
          }
          if (current) {
            out.currentUser = current;
            out.motivationMessage = buildMotivationMessage(current, nextUser);
          }
        }
        await finalizeRankingProfileUrls(out);
        return res.status(200).json(out);
      }
    }

    const { entries, byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, durationType, gender);
    let cohortAvgHrBpm = null;
    if (
      (period === "rolling30" || period === "monthly" || period === "rolling6m" || period === "rolling183") &&
      DURATION_HR_FIELDS[durationType]
    ) {
      cohortAvgHrBpm = await getCohortAvgPeakHrBpm(db, startStr, endStr, durationType, gender);
    }
    await writeRankingAggregatePayload(db, cacheKey, {
      byCategory,
      entries,
      startStr,
      endStr,
      cohortAvgHrBpm: cohortAvgHrBpm != null ? cohortAvgHrBpm : null,
    });
    await hydrateRankingBoardProfileImages(db, byCategory, entries);
    await cacheRef.set({
      byCategory,
      entries,
      startStr,
      endStr,
      cohortAvgHrBpm: cohortAvgHrBpm != null ? cohortAvgHrBpm : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let out = { success: true, byCategory, startStr, endStr, period, durationType, gender, cohortAvgHrBpm };
    if (uid) {
      let current = null, nextUser = null;
      for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
        const arr = byCategory[c] || [];
        const idx = arr.findIndex((e) => e.userId === uid);
        if (idx >= 0) {
          current = arr[idx];
          nextUser = idx > 0 ? arr[idx - 1] : null;
          break;
        }
      }
      if (current) {
        out.currentUser = current;
        out.motivationMessage = buildMotivationMessage(current, nextUser);
      }
    }
    await finalizeRankingProfileUrls(out);
    res.status(200).json(out);
    } catch (errPeak) {
      console.error("[getPeakPowerRanking] unhandled", errPeak && errPeak.stack ? errPeak.stack : errPeak);
      res.set("Access-Control-Allow-Origin", "*");
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "peak_ranking_internal",
          message: errPeak && errPeak.message ? String(errPeak.message) : String(errPeak),
        });
      }
    }
  }
);

const DURATION_LABELS = {
  "1min": "1분",
  "5min": "5분",
  "10min": "10분",
  "20min": "20분",
  "40min": "40분",
  "60min": "60분",
  max: "Max",
};

/** 추월하기 분석 API: 바로 앞 순위자와 TSS·W/kg 비교, 목표 파워(W) 향상치 산출 */
exports.getOvertakeAnalysis = onRequest(
  { cors: true, timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const uid = req.query.uid || req.body?.uid || null;
    const period = req.query.period || req.body?.period || "monthly";
    const gender = req.query.gender || req.body?.gender || "all";

    if (!uid) {
      return res.status(400).json({ success: false, error: "uid 필수" });
    }

    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month, 10) : new Date().getMonth() + 1;
    let startStr, endStr;
    if (period === "yearly") {
      const r = getRolling365DaysRangeSeoul();
      startStr = r.startStr;
      endStr = r.endStr;
    } else {
      const r = getRolling28DaysRangeSeoul();
      startStr = r.startStr;
      endStr = r.endStr;
    }

    const db = admin.firestore();
    const todayStr = req.query.today || req.body?.today || null;
    const { startStr: week5StartStr, endStr: week5EndStr } = getWeek5RangeSeoul(todayStr);

    const results = [];

    for (const durationType of Object.keys(DURATION_FIELDS)) {
      const { byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, durationType, gender);
      let current = null;
      let rival = null;
      for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
        const arr = byCategory[c] || [];
        const idx = arr.findIndex((e) => e.userId === uid);
        if (idx >= 0) {
          current = arr[idx];
          rival = idx > 0 ? arr[idx - 1] : null;
          break;
        }
      }

      if (!current) {
        results.push({
          category: durationType,
          categoryLabel: DURATION_LABELS[durationType] || durationType,
          hasRival: false,
          myPower: 0,
          rivalPower: 0,
          myWkg: 0,
          rivalWkg: 0,
          myTSS: 0,
          rivalTSS: 0,
          tssDiff: 0,
          targetPowerIncrease: 0,
        });
        continue;
      }

      const myWeeklyTss = Math.round(await getWeeklyTssForUser(db, uid, week5StartStr, week5EndStr));
      const rivalWeeklyTss = rival ? Math.round(await getWeeklyTssForUser(db, rival.userId, week5StartStr, week5EndStr)) : 0;

      const myData = { ...current, weeklyTss: myWeeklyTss };
      const rivalData = rival ? { ...rival, weeklyTss: rivalWeeklyTss } : null;

      let metrics;
      if (rivalData) {
        metrics = computeOvertakeMetrics(myData, rivalData, current.weightKg);
      } else {
        const myPower = current.watts || 0;
        const myWkg = current.wkg || 0;
        const myTSS = myWeeklyTss;
        const targetPower3Pct = Math.ceil(myPower * 0.03);
        const targetPower = myPower + targetPower3Pct;
        const targetWkg3Pct = Math.round(myWkg * 1.03 * 100) / 100;
        const targetTSS3Pct = Math.ceil(myTSS * 1.03);
        const tssIncrease3Pct = targetTSS3Pct - myTSS;
        metrics = {
          myPower,
          rivalPower: 0,
          myWkg,
          rivalWkg: 0,
          myTSS,
          rivalTSS: 0,
          tssDiff: 0,
          targetPowerIncrease: targetPower3Pct,
          selfImprovement3Pct: true,
          targetPower,
          targetWkg3Pct,
          targetTSS3Pct,
          tssIncrease3Pct,
        };
      }

      results.push({
        category: durationType,
        categoryLabel: DURATION_LABELS[durationType] || durationType,
        hasRival: !!rival,
        rivalName: rival ? rival.name : null,
        ...metrics,
      });
    }

    res.status(200).json({
      success: true,
      period,
      startStr,
      endStr,
      week5TssRange: { startStr: week5StartStr, endStr: week5EndStr },
      items: results,
    });
  }
);

/** 사용자 로그 생성/갱신 시 연간 최고 기록(yearly_peaks) 업서트. 검증 실패 시 suspicious_power_records에 Pending 저장.
 *  1st gen 트리거 사용 (Eventarc 권한 이슈 회피) */
exports.onUserLogWritten = functions
  .runWith({ timeoutSeconds: 120 })
  .firestore.document("users/{userId}/logs/{logId}")
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    const logId = context.params.logId;
    if (!userId || !logId) return;
    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) return;
    const userData = userSnap.data();
    try {
      await rankingDayRollup.reconcileRankingDayTotalsOnLogWrite(db, userId, userData, change);
    } catch (e) {
      console.warn("[onUserLogWritten] ranking_day_totals 버킹 실패:", userId, logId, e.message);
    }
    const snap = change.after;
    if (!snap || !snap.exists) return;
    const logData = snap.data();
    try {
      await upsertYearlyPeakFromLog(db, userId, userData, logData, logId);
    } catch (e) {
      console.warn("[onUserLogWritten] upsertYearlyPeakFromLog 실패:", userId, logId, e.message);
    }
    try {
      await syncOpenRidingParticipantDistanceByLog(db, userId, logData);
    } catch (e) {
      console.warn("[onUserLogWritten] syncOpenRidingParticipantDistanceByLog 실패:", userId, logId, e.message);
    }
  });

/** 기존 로그에 사용자 현재 몸무게(weight) 일괄 적용. weight 필드가 없거나 사용자 몸무게로 갱신 */
exports.backfillWeightToLogs = onRequest(
  { cors: true, timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const db = admin.firestore();
    const usersSnap = await db.collection("users").get();
    let processedUsers = 0;
    let updatedLogs = 0;
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const userWeight = Number(userData.weight ?? userData.weightKg ?? 0);
      if (userWeight <= 0) continue;
      processedUsers++;
      const logsSnap = await db.collection("users").doc(userId).collection("logs").get();
      let batch = db.batch();
      let batchCount = 0;
      for (const logDoc of logsSnap.docs) {
        batch.update(logDoc.ref, { weight: userWeight });
        batchCount++;
        updatedLogs++;
        if (batchCount >= 500) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
      if (batchCount > 0) await batch.commit();
    }
    res.status(200).json({ success: true, processedUsers, updatedLogs });
  }
);

/** yearly_peaks 재계산 (Run/Swim/Walk/TrailRun 제외). 기존 데이터 삭제 후 사이클링 로그만으로 재계산
 *  ?year=2026&secret=INTERNAL_SYNC_SECRET (year 없으면 현재 연도)
 *  ?all=1&secret=... → 2020~현재 연도 전체 실행 */
exports.migrateYearlyPeaksExcludeRunSwimWalk = onRequest(
  { cors: true, timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    res.set("Access-Control-Allow-Origin", "*");
    const secret = req.query.secret || req.body?.secret || "";
    if (secret !== INTERNAL_SYNC_SECRET) {
      return res.status(403).json({ success: false, error: "인증 필요" });
    }
    const runAll = req.query.all === "1" || req.query.all === "true";
    const currentYear = new Date().getFullYear();
    const years = runAll
      ? Array.from({ length: currentYear - 2020 + 1 }, (_, i) => 2020 + i)
      : [req.query.year ? parseInt(req.query.year, 10) : currentYear];
    if (!runAll && (isNaN(years[0]) || years[0] < 2020 || years[0] > 2100)) {
      return res.status(400).json({ success: false, error: "year 파라미터 필요 (2020~2100)" });
    }
    const db = admin.firestore();
    const usersSnap = await db.collection("users").get();
    const results = {};
    for (const year of years) {
      const { startStr, endStr } = getYearRangeSeoul(year);
      let usersUpdated = 0;
      let usersDeleted = 0;
      for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        const rawWeight = Number(userData.weight ?? userData.weightKg ?? 0);
        if (rawWeight <= 0) continue;
        const weightKg = Math.max(rawWeight, 45);
        const logsSnap = await db.collection("users").doc(userId).collection("logs")
          .where("date", ">=", startStr)
          .where("date", "<=", endStr)
          .get();
        const cyclingLogs = logsSnap.docs.filter((d) => isCyclingForMmp(d.data()));
        const maxByField = {};
        let maxHr = 0;
        let maxHrDate = null;
        let contributingActivityType = null;
        for (const logDoc of cyclingLogs) {
          const d = logDoc.data();
          const logWeight = Number(d.weight || userData.weight || userData.weightKg || 0);
          const w = logWeight > 0 ? Math.max(logWeight, 45) : weightKg;
          for (const [durationType, field] of Object.entries(DURATION_FIELDS)) {
            const watts = Number(d[field]) || 0;
            if (watts <= 0) continue;
            if (!validatePeakPowerRecord(durationType, watts, w)) continue;
            const prev = maxByField[field] || 0;
            if (watts > prev) {
              maxByField[field] = watts;
              contributingActivityType = d.activity_type ?? (String(d.source || "").toLowerCase() === "strava" ? "Unknown" : "Stelvio");
            }
          }
          const hr = Number(d.max_hr_5sec ?? d.max_hr ?? d.max_heartrate) || 0;
          if (hr > maxHr) {
            maxHr = hr;
            maxHrDate = (d.date && String(d.date).trim()) || null;
          }
        }
        const yearlyRef = db.collection("users").doc(userId).collection("yearly_peaks").doc(String(year));
        if (Object.keys(maxByField).length === 0 && maxHr <= 0) {
          await yearlyRef.delete();
          usersDeleted++;
          continue;
        }
        const merged = { year, weight_kg: weightKg, updated_at: admin.firestore.FieldValue.serverTimestamp(), activity_type: contributingActivityType ?? null };
        for (const [field, watts] of Object.entries(maxByField)) {
          merged[field] = watts;
          merged[field.replace("_watts", "_wkg")] = Math.round((watts / weightKg) * 100) / 100;
        }
        if (maxHr > 0) {
          merged.max_hr = maxHr;
          if (maxHrDate) merged.max_hr_date = maxHrDate;
        }
        await yearlyRef.set(merged, { merge: true });
        usersUpdated++;
      }
      results[year] = { usersUpdated, usersDeleted };
    }
    res.status(200).json({ success: true, years, results });
  }
);

/** 기존 로그 기반 연간 최고 기록 백필 (관리자 수동 호출).
 *  ?year=2026 - 대상 연도
 *  ?userId=xxx - 특정 사용자만 처리 (선택)
 *  ?rebuildMaxHr=1 - userId와 함께 사용 시, yearly_peaks의 max_hr를 로그 기반으로 재계산하여 덮어씀 (5초평균 우선, 날짜 포함)
 *  ?userLimit=30 - 요청당 처리 사용자 수 (기본 30, userId 없을 때만)
 *  ?startAfterUserId=xxx - 이전 응답의 lastUserId로 이어서 실행 (배치 연속 처리) */
exports.backfillYearlyPeaks = onRequest(
  { cors: true, timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    if (isNaN(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ success: false, error: "year 파라미터 필요 (2020~2100)" });
    }
    const userIdFilter = (req.query.userId || "").trim() || null;
    const rebuildMaxHr = req.query.rebuildMaxHr === "1" || req.query.rebuildMaxHr === "true";
    const userLimit = Math.min(100, Math.max(1, parseInt(req.query.userLimit || "30", 10) || 30));
    const startAfterUserId = (req.query.startAfterUserId || "").trim() || null;
    const { startStr, endStr } = getYearRangeSeoul(year);
    const db = admin.firestore();

    const doRebuildMaxHrForUser = async (uid) => {
      const logsSnap = await db.collection("users").doc(uid).collection("logs")
        .where("date", ">=", startStr)
        .where("date", "<=", endStr)
        .get();
      let bestMaxHr = 0;
      let bestDate = null;
      logsSnap.docs.forEach((doc) => {
        const d = doc.data();
        if (!isCyclingForMmp(d)) return;
        const hr = Number(d.max_hr_5sec ?? d.max_hr ?? d.max_heartrate) || 0;
        if (hr > bestMaxHr) {
          bestMaxHr = hr;
          bestDate = (d.date && String(d.date).trim()) || null;
        }
      });
      if (bestMaxHr > 0) {
        const yearlyRef = db.collection("users").doc(uid).collection("yearly_peaks").doc(String(year));
        await yearlyRef.set({
          max_hr: bestMaxHr,
          max_hr_date: bestDate || null,
          year: parseInt(String(year), 10),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return { bestMaxHr, bestDate, logsScanned: logsSnap.size };
    };

    if (userIdFilter && rebuildMaxHr) {
      const result = await doRebuildMaxHrForUser(userIdFilter);
      return res.status(200).json({
        success: true,
        mode: "rebuildMaxHr",
        year,
        userId: userIdFilter,
        max_hr: result.bestMaxHr,
        max_hr_date: result.bestDate,
        logsScanned: result.logsScanned,
      });
    }

    let usersSnap;
    if (userIdFilter) {
      const userDoc = await db.collection("users").doc(userIdFilter).get();
      usersSnap = userDoc.exists ? { docs: [userDoc] } : { docs: [] };
    } else {
      let usersQuery = db.collection("users").orderBy(admin.firestore.FieldPath.documentId()).limit(userLimit);
      if (startAfterUserId) {
        const startDoc = await db.collection("users").doc(startAfterUserId).get();
        if (startDoc.exists) usersQuery = usersQuery.startAfter(startDoc);
      }
      usersSnap = await usersQuery.get();
    }
    let processed = 0;
    let updated = 0;
    let lastUserId = null;
    if (rebuildMaxHr && !userIdFilter) {
      for (const userDoc of usersSnap.docs) {
        lastUserId = userDoc.id;
        try {
          const r = await doRebuildMaxHrForUser(lastUserId);
          processed++;
          if (r.bestMaxHr > 0) updated++;
        } catch (e) {
          console.warn("[backfillYearlyPeaks] rebuildMaxHr", lastUserId, e.message);
        }
      }
    } else {
      for (const userDoc of usersSnap.docs) {
        lastUserId = userDoc.id;
        const userData = userDoc.data();
        const logsSnap = await db.collection("users").doc(lastUserId).collection("logs")
          .where("date", ">=", startStr)
          .where("date", "<=", endStr)
          .get();
        for (const logDoc of logsSnap.docs) {
          processed++;
          try {
            await upsertYearlyPeakFromLog(db, lastUserId, userData, logDoc.data(), logDoc.id);
            updated++;
          } catch (e) {
            console.warn("[backfillYearlyPeaks]", lastUserId, logDoc.id, e.message);
          }
        }
      }
    }
    const hasMore = usersSnap.docs.length >= userLimit;
    let nextUrl = null;
    if (hasMore && lastUserId) {
      nextUrl = `?year=${year}&userLimit=${userLimit}&startAfterUserId=${encodeURIComponent(lastUserId)}`;
      if (rebuildMaxHr && !userIdFilter) nextUrl += "&rebuildMaxHr=1";
    }
    res.status(200).json({
      success: true,
      ...(rebuildMaxHr && !userIdFilter && { mode: "rebuildMaxHr" }),
      year, startStr, endStr, processed, updated,
      lastUserId, hasMore,
      nextUrl,
    });
  }
);

/** 의심 기록(Pending) 승인 → yearly_peaks에 반영. recordId: suspicious_power_records 문서 ID */
exports.approveSuspiciousPowerRecord = onRequest(
  { cors: true, timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const recordId = req.query.recordId || req.body?.recordId;
    if (!recordId) {
      return res.status(400).json({ success: false, error: "recordId 필요" });
    }
    const db = admin.firestore();
    const recRef = db.collection("suspicious_power_records").doc(recordId);
    const recSnap = await recRef.get();
    if (!recSnap.exists) {
      return res.status(404).json({ success: false, error: "기록 없음" });
    }
    const rec = recSnap.data();
    if (rec.status !== "pending") {
      return res.status(400).json({ success: false, error: "이미 처리됨" });
    }
    const { userId, year, durationType, watts, wkg, weightKg } = rec;
    const field = DURATION_FIELDS[durationType];
    if (!field) {
      return res.status(400).json({ success: false, error: "잘못된 durationType" });
    }
    const yearlyRef = db.collection("users").doc(userId).collection("yearly_peaks").doc(String(year));
    const yearlySnap = await yearlyRef.get();
    const current = yearlySnap.exists ? yearlySnap.data() : {};
    const prevWatts = Number(current[field]) || 0;
    if (watts <= prevWatts) {
      await recRef.update({ status: "rejected", updated_at: admin.firestore.FieldValue.serverTimestamp() });
      return res.status(200).json({ success: true, message: "기존 기록이 더 높아 반영하지 않음" });
    }
    await yearlyRef.set({
      [field]: watts,
      [field.replace("_watts", "_wkg")]: wkg,
      year,
      weight_kg: weightKg,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await recRef.update({ status: "approved", updated_at: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).json({ success: true, message: "승인 완료" });
  }
);

/** 월간 랭킹 확정 (매월 말일 23:00 Asia/Seoul) - Cloud Scheduler는 L(말일) 미지원 → 매일 23시 실행 후 말일만 처리 */
const finalizeMonthlyPeakOptions = {
  schedule: "0 23 * * *",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 540,
};
exports.finalizeMonthlyPeakRanking = onSchedule(
  finalizeMonthlyPeakOptions,
  async (event) => {
    const now = new Date();
    const seoulDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const today = seoulDate.getDate();
    const lastDay = new Date(seoulDate.getFullYear(), seoulDate.getMonth() + 1, 0).getDate();
    if (today !== lastDay) {
      console.log("[finalizeMonthlyPeakRanking] 오늘은 말일이 아님, 스킵", { today, lastDay });
      return;
    }
    const db = admin.firestore();
    const { startStr, endStr } = getMonthRangeSeoul(seoulDate.getFullYear(), seoulDate.getMonth() + 1);
    const points = [100, 50, 30];
    for (const durationType of Object.keys(DURATION_FIELDS)) {
      for (const gender of ["all", "M", "F"]) {
        const { byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, durationType, gender);
        for (const cat of ["Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"]) {
          const arr = byCategory[cat] || [];
          const top3 = arr.slice(0, 3);
          for (let i = 0; i < top3.length; i++) {
            const u = top3[i];
            const userRef = db.collection("users").doc(u.userId);
            const snap = await userRef.get();
            if (!snap.exists) continue;
            const data = snap.data();
            const add = points[i];
            const rem = Number(data.rem_points || 0) + add;
            const acc = Number(data.acc_points || 0) + add;
            await userRef.update({ rem_points: rem, acc_points: acc });
            console.log("[finalizeMonthlyPeakRanking]", durationType, gender, cat, (i + 1) + "등", u.name, "+" + add + "SP");
          }
        }
      }
    }
    console.log("[finalizeMonthlyPeakRanking] 완료", { startStr, endStr });
  }
);

/** 연간 랭킹 확정 (매년 12월 31일 23:00 Asia/Seoul) */
const finalizeYearlyPeakOptions = {
  schedule: "0 23 31 12 *",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 540,
};
exports.finalizeYearlyPeakRanking = onSchedule(
  finalizeYearlyPeakOptions,
  async (event) => {
    const db = admin.firestore();
    const year = new Date().getFullYear();
    const { startStr, endStr } = getYearRangeSeoul(year);
    const points = [100, 50, 30];
    for (const durationType of Object.keys(DURATION_FIELDS)) {
      for (const gender of ["all", "M", "F"]) {
        const { byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, durationType, gender);
        for (const cat of ["Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"]) {
          const arr = byCategory[cat] || [];
          const top3 = arr.slice(0, 3);
          for (let i = 0; i < top3.length; i++) {
            const u = top3[i];
            const userRef = db.collection("users").doc(u.userId);
            const snap = await userRef.get();
            if (!snap.exists) continue;
            const data = snap.data();
            const add = points[i];
            const rem = Number(data.rem_points || 0) + add;
            const acc = Number(data.acc_points || 0) + add;
            await userRef.update({ rem_points: rem, acc_points: acc });
            console.log("[finalizeYearlyPeakRanking]", durationType, gender, cat, (i + 1) + "등", u.name, "+" + add + "SP");
          }
        }
      }
    }
    console.log("[finalizeYearlyPeakRanking] 완료", { startStr, endStr });
  }
);

// ---------- STELVIO AI 사용자 선택형 FTP 갱신: 제안 API (계산만, DB 미수정) ----------
/** Firebase ID 토큰 검증 헬퍼 */
async function getUidFromRequest(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "unauthenticated", message: "Authorization Bearer 토큰이 필요합니다." } });
    return null;
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch (e) {
    res.status(401).json({ error: { code: "unauthenticated", message: "유효하지 않거나 만료된 토큰입니다." } });
    return null;
  }
}

/** 최근 N일 날짜 문자열 (로컬 YYYY-MM-DD, Asia/Seoul 기준) */
function getDateStrDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** FTP 제안 계산: 로그·CTL 기반. DB 수정 없음. */
exports.getFtpSuggestion = onRequest(
  { cors: true, timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.some((o) => (typeof o === "string" ? origin === o : o.test(origin)))) {
      res.set("Access-Control-Allow-Origin", origin);
    }
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    const uid = await getUidFromRequest(req, res);
    if (!uid) return;

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({ error: { code: "not-found", message: "사용자를 찾을 수 없습니다." } });
      return;
    }
    const userData = userSnap.data() || {};
    const previousFtp = Math.round(Number(userData.ftp) || 200);
    const userName = (userData.name && String(userData.name).trim()) || "사용자";

    const todayStr = getDateStrDaysAgo(0);
    const start42Str = getDateStrDaysAgo(42);
    const start30Str = getDateStrDaysAgo(30);
    const start14Str = getDateStrDaysAgo(14);

    const logsSnap = await db.collection("users").doc(uid).collection("logs")
      .where("date", ">=", start42Str)
      .where("date", "<=", todayStr)
      .get();

    const byDate = {};
    logsSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (!isCyclingForMmp(d)) return; // Run 등 비사이클링 Strava 로그는 FTP 제안에서 제외
      const dateStr = normalizeLogDateToSeoulYmd(d.date);
      if (!dateStr) return;
      const tss = Number(d.tss) || 0;
      const np = Number(d.np) || Number(d.avg_power) || Number(d.weighted_watts) || 0;
      const durationMin = Number(d.duration_min) || Math.round(Number(d.duration_sec || 0) / 60) || 0;
      const max30minWatts = Number(d.max_30min_watts) || 0;
      const isStrava = String(d.source || "").toLowerCase() === "strava";
      if (!byDate[dateStr]) byDate[dateStr] = { tss: 0, np: 0, durationMin: 0, max_30min_watts: 0, isStrava: false };
      const row = byDate[dateStr];
      row.max_30min_watts = Math.max(row.max_30min_watts || 0, max30minWatts);
      if (isStrava && row.tss === 0) {
        row.tss = tss;
        row.np = np;
        row.durationMin = durationMin;
        row.isStrava = true;
      } else if (!row.isStrava) {
        row.tss = tss;
        row.np = np;
        row.durationMin = durationMin;
      }
    });

    const sortedDates = Object.keys(byDate).sort();
    let last7Tss = 0;
    let last14Tss = 0;
    let last30Tss = 0;
    let last42Tss = 0;
    let lastTrainingDateStr = null;
    let bestMmp30ForFtp = 0;
    let bestNpForFtp = 0;

    sortedDates.forEach((dateStr) => {
      const row = byDate[dateStr];
      const tss = row.tss || 0;
      if (dateStr >= start14Str) last14Tss += tss;
      if (dateStr >= start30Str) last30Tss += tss;
      last42Tss += tss;
      if (dateStr >= start42Str) {
        const daysAgo = Math.floor((new Date(todayStr) - new Date(dateStr)) / 86400000);
        if (daysAgo <= 7) last7Tss += tss;
      }
      if (tss > 0) lastTrainingDateStr = dateStr;
      if (dateStr >= start30Str) {
        const mmp30 = Number(row.max_30min_watts) || 0;
        if (mmp30 > bestMmp30ForFtp) bestMmp30ForFtp = mmp30;
      }
      if (row.durationMin >= 15 && row.np > 0 && dateStr >= start30Str) {
        const estimatedFtp = Math.round(row.np * 0.95);
        if (estimatedFtp > bestNpForFtp) bestNpForFtp = estimatedFtp;
      }
    });

    const candidateFtp = Math.round(Math.max(bestMmp30ForFtp, bestNpForFtp));
    const upgradeSource = bestMmp30ForFtp >= bestNpForFtp ? "MMP30" : "NP";

    const daysSinceLastTraining = lastTrainingDateStr
      ? Math.floor((new Date(todayStr) - new Date(lastTrainingDateStr)) / 86400000)
      : 999;

    let hasSuggestion = false;
    let suggestionType = null;
    let suggestedFtp = previousFtp;
    let message = "제안 없음";
    let upgradeSourceOut = undefined;

    if (candidateFtp >= previousFtp * 1.02 && candidateFtp > previousFtp) {
      hasSuggestion = true;
      suggestionType = "UPGRADE";
      suggestedFtp = Math.min(candidateFtp, previousFtp + 30);
      suggestedFtp = Math.round(suggestedFtp);
      upgradeSourceOut = upgradeSource;
      message = upgradeSource === "MMP30"
        ? "최근 고강도 훈련(30분 MMP 기반)으로 상승 제안"
        : "최근 고강도 훈련(NP 기반)으로 상승 제안";
    } else if (daysSinceLastTraining >= 14 || (last7Tss < 20 && last42Tss < 150)) {
      const decayed = Math.round(previousFtp * 0.9);
      if (decayed < previousFtp && decayed >= 100) {
        hasSuggestion = true;
        suggestionType = "DECAY";
        suggestedFtp = Math.round(decayed / 5) * 5;
        message = "휴식/저부하 기간으로 보수적 하락 제안";
      }
    }

    const json = {
      hasSuggestion: !!hasSuggestion,
      suggestionType: suggestionType || undefined,
      previousFtp,
      suggestedFtp,
      message,
      userName,
    };
    if (upgradeSourceOut) json.upgradeSource = upgradeSourceOut;
    res.status(200).json(json);
  }
);

/** 사용자 FTP 승인 반영 API (POST). '예' 선택 시에만 호출. current_ftp 및 ftp_updated_at 갱신 */
exports.confirmFtp = onRequest(
  { cors: true, timeoutSeconds: 30 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: { code: "method-not-allowed", message: "POST만 허용됩니다." } });
      return;
    }
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.some((o) => (typeof o === "string" ? origin === o : o.test(origin)))) {
      res.set("Access-Control-Allow-Origin", origin);
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    const uid = await getUidFromRequest(req, res);
    if (!uid) return;

    let body = {};
    try {
      body = typeof req.body === "object" && req.body !== null ? req.body : {};
    } catch (e) {
      res.status(400).json({ error: { code: "invalid-argument", message: "요청 본문이 올바르지 않습니다." } });
      return;
    }
    const suggestedFtp = Math.round(Number(body.suggestedFtp) || 0);
    if (suggestedFtp < 100 || suggestedFtp > 500) {
      res.status(400).json({ error: { code: "invalid-argument", message: "suggestedFtp는 100~500 범위여야 합니다." } });
      return;
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({ error: { code: "not-found", message: "사용자를 찾을 수 없습니다." } });
      return;
    }

    await userRef.update({
      ftp: suggestedFtp,
      ftp_updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ success: true, ftp: suggestedFtp });
  }
);

// ---------- Strava activity_type 마이그레이션 (기존 로그에 activity_type 채우기) ----------
/** Strava Rate Limit: 100 req/15min, 1000/day. 호출 간 1초 딜레이 */
const MIGRATION_API_DELAY_MS = 1000;
/** 배치당 로그 수. hasMore 시 자동으로 다음 배치 호출(체이닝) */
const MIGRATION_BATCH_SIZE = 30;

/** 기존 Strava 로그에 activity_type 필드 채우기.
 *  한 번 호출하면 hasMore일 때 자동으로 다음 배치를 호출해 전체 마이그레이션 완료.
 *  GET/POST ?secret=INTERNAL_SYNC_SECRET&userId=선택&noChain=1 (체이닝 비활성화) */
exports.migrateStravaActivityType = onRequest(
  { cors: true, timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const secret = req.query.secret || req.body?.secret || "";
    if (secret !== INTERNAL_SYNC_SECRET) {
      return res.status(403).json({ success: false, error: "인증 필요" });
    }
    const targetUserId = (req.query.userId || req.body?.userId || "").trim() || null;
    const noChain = req.query.noChain === "1" || req.body?.noChain === "1";
    const limitParam = parseInt(req.query.limit || req.body?.limit || String(MIGRATION_BATCH_SIZE), 10);
    const limit = isNaN(limitParam) || limitParam < 1 ? MIGRATION_BATCH_SIZE : Math.min(limitParam, 100);

    const db = admin.firestore();
    const userQuery = db.collection("users").where("strava_refresh_token", ">", "");
    const usersSnap = await (targetUserId
      ? db.collection("users").doc(targetUserId).get().then((s) => ({ docs: s.exists ? [s] : [] }))
      : userQuery.get());

    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      let accessToken = userData.strava_access_token || "";
      const expiresAt = Number(userData.strava_expires_at || 0);
      const now = Math.floor(Date.now() / 1000);
      if (!accessToken || expiresAt < now + 300) {
        try {
          const { accessToken: token } = await refreshStravaTokenForUser(db, userId);
          accessToken = token;
        } catch (e) {
          console.warn("[migrateStravaActivityType] 토큰 갱신 실패:", userId, e.message);
          totalErrors++;
          continue;
        }
      }

      const logsSnap = await db.collection("users").doc(userId).collection("logs")
        .where("source", "==", "strava")
        .get();

      const toUpdate = logsSnap.docs.filter((d) => {
        const t = String(d.data().activity_type || "").trim();
        return !t;
      });

      for (const logDoc of toUpdate) {
        if (totalUpdated >= limit) break; // limit 도달 시 조기 종료
        const data = logDoc.data();
        let activityId = data.activity_id ? String(data.activity_id) : null;
        if (!activityId) activityId = String(logDoc.id);
        if (!activityId) {
          totalSkipped++;
          continue;
        }
        if (totalUpdated + totalErrors > 0 && MIGRATION_API_DELAY_MS > 0) {
          await new Promise((r) => setTimeout(r, MIGRATION_API_DELAY_MS));
        }
        let result = await fetchStravaActivityDetail(accessToken, activityId);
        if (!result.success && data.activity_id !== logDoc.id && String(logDoc.id).match(/^\d+$/)) {
          result = await fetchStravaActivityDetail(accessToken, String(logDoc.id));
          if (result.success) activityId = String(logDoc.id);
        }
        let activityType;
        if (!result.success || !result.activity) {
          console.warn("[migrateStravaActivityType] API 실패:", userId, activityId, result.error);
          totalErrors++;
          activityType = "Unknown"; // 재시도 방지: 실패한 로그도 표시해 다음 실행에서 제외
        } else {
          activityType = String(result.activity.sport_type || result.activity.type || "").trim() || null;
        }
        await db.collection("users").doc(userId).collection("logs").doc(logDoc.id).update({
          activity_type: activityType,
        });
        totalUpdated++;
      }
      if (totalUpdated >= limit) break; // 사용자 루프도 종료
    }

    const hasMore = totalUpdated >= limit;
    const payload = {
      success: true,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors: totalErrors,
      hasMore,
      chained: false,
    };

    // hasMore일 때 자동으로 다음 배치 호출 (체이닝)
    if (hasMore && !noChain) {
      try {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers.host || req.get?.("host");
        const path = (req.url && req.url.split("?")[0]) || "/migrateStravaActivityType";
        const params = new URLSearchParams({ secret, limit: String(limit) });
        if (targetUserId) params.set("userId", targetUserId);
        const nextUrl = `${protocol}://${host}${path}?${params.toString()}`;
        fetch(nextUrl).catch((e) => console.warn("[migrateStravaActivityType] 체이닝 호출 실패:", e.message));
        payload.chained = true;
      } catch (e) {
        console.warn("[migrateStravaActivityType] 체이닝 URL 생성 실패:", e.message);
      }
    }

    res.status(200).json(payload);
  }
);

/** 전체 사용자 로그에 activity_type 채우기 (Strava+Stelvio 통합).
 *  Strava: 토큰 있으면 API 조회, 없으면 Unknown. Stelvio: Stelvio.
 *  ?secret=INTERNAL_SYNC_SECRET (선택: userId, limit, noChain) */
exports.migrateAllLogsActivityType = onRequest(
  { cors: true, timeoutSeconds: 300 },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    res.set("Access-Control-Allow-Origin", "*");
    const secret = req.query.secret || req.body?.secret || "";
    if (secret !== INTERNAL_SYNC_SECRET) {
      return res.status(403).json({ success: false, error: "인증 필요" });
    }
    const targetUserId = (req.query.userId || req.body?.userId || "").trim() || null;
    const limitParam = parseInt(req.query.limit || req.body?.limit || "100", 10);
    const limit = isNaN(limitParam) || limitParam < 1 ? 100 : Math.min(limitParam, 500);
    const noChain = req.query.noChain === "1" || req.body?.noChain === "1";

    const db = admin.firestore();
    const usersSnap = targetUserId
      ? await db.collection("users").doc(targetUserId).get().then((s) => ({ docs: s.exists ? [s] : [] }))
      : await db.collection("users").get();

    let stravaUpdated = 0;
    let stelvioUpdated = 0;
    let stravaErrors = 0;

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const logsSnap = await db.collection("users").doc(userId).collection("logs").get();
      const toUpdate = logsSnap.docs.filter((d) => !String(d.data().activity_type || "").trim());
      if (toUpdate.length === 0) continue;

      const hasStravaToken = !!(userData.strava_refresh_token && String(userData.strava_refresh_token).trim());
      let accessToken = null;
      if (hasStravaToken) {
        try {
          const { accessToken: token } = await refreshStravaTokenForUser(db, userId);
          accessToken = token;
        } catch (e) {
          console.warn("[migrateAllLogsActivityType] 토큰 갱신 실패:", userId, e.message);
        }
      }

      for (const logDoc of toUpdate) {
        if (stravaUpdated + stelvioUpdated >= limit) break;
        const d = logDoc.data();
        const src = String(d.source || "").toLowerCase();
        let activityType;

        if (src === "strava") {
          let activityId = d.activity_id ? String(d.activity_id) : String(logDoc.id);
          if (accessToken && activityId) {
            if (stravaUpdated + stravaErrors > 0 && MIGRATION_API_DELAY_MS > 0) {
              await new Promise((r) => setTimeout(r, MIGRATION_API_DELAY_MS));
            }
            let result = await fetchStravaActivityDetail(accessToken, activityId);
            if (!result.success && d.activity_id !== logDoc.id && String(logDoc.id).match(/^\d+$/)) {
              result = await fetchStravaActivityDetail(accessToken, String(logDoc.id));
            }
            if (result.success && result.activity) {
              activityType = String(result.activity.sport_type || result.activity.type || "").trim() || null;
            }
            if (!activityType) {
              stravaErrors++;
              activityType = "Unknown";
            }
          } else {
            activityType = "Unknown";
          }
          await logDoc.ref.update({ activity_type: activityType });
          stravaUpdated++;
        } else {
          activityType = d.activity_type || "Stelvio";
          await logDoc.ref.update({ source: src || "stelvio", activity_type: activityType });
          stelvioUpdated++;
        }
      }
      if (stravaUpdated + stelvioUpdated >= limit) break;
    }

    const hasMore = stravaUpdated + stelvioUpdated >= limit;
    const payload = { success: true, stravaUpdated, stelvioUpdated, stravaErrors, hasMore, chained: false };

    if (hasMore && !noChain) {
      try {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers.host || req.get?.("host");
        const params = new URLSearchParams({ secret, limit: String(limit) });
        if (targetUserId) params.set("userId", targetUserId);
        const nextUrl = `${protocol}://${host}/?${params.toString()}`;
        fetch(nextUrl).catch((e) => console.warn("[migrateAllLogsActivityType] 체이닝 실패:", e.message));
        payload.chained = true;
      } catch (e) { /* ignore */ }
    }
    res.status(200).json(payload);
  }
);

/** 기존 Stelvio 로그에 source, activity_type 추가. ?secret=INTERNAL_SYNC_SECRET */
exports.migrateStelvioLogActivityType = onRequest(
  { cors: true, timeoutSeconds: 300 },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    res.set("Access-Control-Allow-Origin", "*");
    const secret = req.query.secret || req.body?.secret || "";
    if (secret !== INTERNAL_SYNC_SECRET) {
      return res.status(403).json({ success: false, error: "인증 필요" });
    }
    const db = admin.firestore();
    const usersSnap = await db.collection("users").get();
    let updated = 0;
    let batch = db.batch();
    let batchCount = 0;
    for (const userDoc of usersSnap.docs) {
      const logsSnap = await db.collection("users").doc(userDoc.id).collection("logs").get();
      for (const logDoc of logsSnap.docs) {
        const d = logDoc.data();
        const src = String(d.source || "").toLowerCase();
        if (src === "strava") continue; // Strava는 migrateStravaActivityType에서 처리
        const hasType = String(d.activity_type || "").trim();
        if (hasType && src) continue; // 이미 있으면 스킵
        batch.update(logDoc.ref, {
          source: src || "stelvio",
          activity_type: d.activity_type || "Stelvio",
        });
        updated++;
        batchCount++;
        if (batchCount >= 500) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }
    if (batchCount > 0) await batch.commit();
    res.status(200).json({ success: true, updated });
  }
);

// ---------- Strava Webhook 비동기 처리 (processStravaActivity는 lib에서 호출) ----------
exports.processStravaActivity = processStravaActivity;

// ---------- VO₂max 연령·성별 Stelvio 실제 평균 집계 (샘플 기여 → 일별 롤링 통계) ----------
const { rebuildVo2StelvioRollingStats } = require("./vo2DemographicStats");
exports.rebuildVo2StelvioRollingStats = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    try {
      const r = await rebuildVo2StelvioRollingStats(db);
      console.log("[rebuildVo2StelvioRollingStats] ok", r);
    } catch (e) {
      console.error("[rebuildVo2StelvioRollingStats]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

// ---------- 훈련 트렌드 Fitness(Fitness) 전 사용자 평균 (샘플 → stats_fitness_stelvio_rolling) ----------
const { rebuildFitnessStelvioRollingStats } = require("./fitnessDemographicStats");
exports.rebuildFitnessStelvioRollingStats = onSchedule(
  {
    schedule: "30 4 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    try {
      const r = await rebuildFitnessStelvioRollingStats(db);
      console.log("[rebuildFitnessStelvioRollingStats] ok", r);
    } catch (e) {
      console.error("[rebuildFitnessStelvioRollingStats]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

// ---------- 주간 TSS(30주 창) 전 사용자 평균 (샘플 → stats_weekly_tss_stelvio_rolling) ----------
const { rebuildWeeklyTssStelvioRollingStats } = require("./weeklyTssDemographicStats");
exports.rebuildWeeklyTssStelvioRollingStats = onSchedule(
  {
    schedule: "45 4 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    try {
      const r = await rebuildWeeklyTssStelvioRollingStats(db);
      console.log("[rebuildWeeklyTssStelvioRollingStats] ok", r);
    } catch (e) {
      console.error("[rebuildWeeklyTssStelvioRollingStats]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

// ---------- Strava TSS 일괄 재계산 (잘못 저장된 기간의 TSS 정정) ----------
/**
 * HTTP Callable: 특정 날짜 범위의 모든 사용자 Strava 로그 TSS 재계산·정정
 * 용도: 2026-05-09~05-12 기간 TSS 계산 버그(tssPerKJ 가드레일 미적용으로 4173·9927 등 과대값)
 *       로 저장된 데이터를 올바른 값으로 정정.
 *
 * 호출 파라미터 (HTTPS onCall):
 *   startDate: "YYYY-MM-DD"  (기본값: "2026-05-09")
 *   endDate:   "YYYY-MM-DD"  (기본값: "2026-05-12")
 *   dryRun:    boolean       (true이면 실제 쓰기 없이 리포트만 반환)
 *
 * 보안: Firebase Auth 어드민 토큰 필요 (customClaims.admin === true)
 */
exports.fixStravaTssBatch = functions
  .runWith({ timeoutSeconds: 540, memory: "1GiB" })
  .https.onCall(async (data, context) => {
    // 어드민 권한 확인
    if (!context.auth || !context.auth.token || context.auth.token.admin !== true) {
      throw new functions.https.HttpsError("permission-denied", "어드민 권한이 필요합니다.");
    }

    const db = admin.firestore();
    const startDate = (data && data.startDate) || "2026-05-09";
    const endDate   = (data && data.endDate)   || "2026-05-12";
    const dryRun    = !!(data && data.dryRun);

    console.log(`[fixStravaTssBatch] 시작: ${startDate} ~ ${endDate}, dryRun=${dryRun}`);

    // 모든 사용자 목록
    const usersSnap = await db.collection("users").get();
    const results = { total: 0, updated: 0, skipped: 0, errors: 0, details: [] };

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data() || {};
      // 체중: 프로필에서 읽기 (없으면 기본값 70kg)
      const weightKg = (Number(userData.weight) > 0 ? Number(userData.weight)
        : (Number(userData.weightKg) > 0 ? Number(userData.weightKg) : STELVIO_RTSS_DEFAULT_WEIGHT_KG));

      let logsSnap;
      try {
        logsSnap = await db.collection("users").doc(userId).collection("logs")
          .where("source", "==", "strava")
          .where("date", ">=", startDate)
          .where("date", "<=", endDate)
          .get();
      } catch (e) {
        results.errors++;
        console.error(`[fixStravaTssBatch] 사용자 ${userId} 조회 오류:`, e.message);
        continue;
      }

      if (logsSnap.empty) continue;

      let batch = db.batch();
      let batchCount = 0;

      for (const logDoc of logsSnap.docs) {
        results.total++;
        const log = logDoc.data() || {};

        const durationSec = Number(log.duration_sec || log.time) || 0;
        const avgWatts    = log.avg_watts != null ? Number(log.avg_watts) : null;
        const weightedWatts = log.weighted_watts != null ? Number(log.weighted_watts) : null;
        const ftpAtTime   = Number(log.ftp_at_time) || 0;
        const oldTss      = Number(log.tss) || 0;

        // 재계산에 필요한 데이터가 없으면 건너뜀
        if (durationSec <= 0 || ftpAtTime <= 0) {
          results.skipped++;
          continue;
        }

        const np = weightedWatts != null ? weightedWatts : (avgWatts != null ? avgWatts : 0);
        const avgForTss = (avgWatts != null && avgWatts > 0) ? avgWatts : np;
        if (np <= 0 || avgForTss <= 0) {
          results.skipped++;
          continue;
        }

        const newTss = Math.max(0, calculateStelvioRevisedTSS(durationSec, avgForTss, np, ftpAtTime, weightKg));

        // TSS 값이 바뀐 경우만 업데이트
        if (Math.abs(newTss - oldTss) < 0.05) {
          results.skipped++;
          continue;
        }

        results.details.push({
          userId,
          logId: logDoc.id,
          date: log.date,
          oldTss,
          newTss,
          durationSec,
          np: Math.round(np),
          ftp: ftpAtTime,
        });

        if (!dryRun) {
          batch.update(logDoc.ref, { tss: newTss, tss_recalculated_at: new Date().toISOString() });
          batchCount++;
          if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        }
        results.updated++;
      }

      if (!dryRun && batchCount > 0) {
        await batch.commit();
      }
    }

    console.log(`[fixStravaTssBatch] 완료: total=${results.total}, updated=${results.updated}, skipped=${results.skipped}, errors=${results.errors}`);
    return {
      success: true,
      dryRun,
      startDate,
      endDate,
      total: results.total,
      updated: results.updated,
      skipped: results.skipped,
      errors: results.errors,
      details: results.details.slice(0, 200), // 최대 200건 리포트
    };
  });

// ---------- STELVIO AI 네이버 구독 자동화 (30분 스케줄, TypeScript 빌드 결과 사용) ----------
const path = require("path");
const fs = require("fs");
const libPath = path.join(__dirname, "lib", "index.js");
if (fs.existsSync(libPath)) {
  try {
    const naverSubscription = require("./lib/index.js");
    if (naverSubscription && naverSubscription.naverSubscriptionSyncSchedule) {
      exports.naverSubscriptionSyncSchedule = naverSubscription.naverSubscriptionSyncSchedule;
    }
    if (naverSubscription && naverSubscription.naverSubscriptionSyncTest) {
      exports.naverSubscriptionSyncTest = naverSubscription.naverSubscriptionSyncTest;
    }
    if (naverSubscription && naverSubscription.stravaWebhook) {
      exports.stravaWebhook = naverSubscription.stravaWebhook;
    }
    if (naverSubscription && naverSubscription.meetupInviteAlimtalkHttpsRelay) {
      exports.meetupInviteAlimtalkHttpsRelay = naverSubscription.meetupInviteAlimtalkHttpsRelay;
    }
    if (naverSubscription && naverSubscription.missionSubscriptionAlimtalkHttpsRelay) {
      exports.missionSubscriptionAlimtalkHttpsRelay = naverSubscription.missionSubscriptionAlimtalkHttpsRelay;
    }
    if (naverSubscription && naverSubscription.onRideCreatedMeetupInviteAlimtalk) {
      exports.onRideCreatedMeetupInviteAlimtalk = naverSubscription.onRideCreatedMeetupInviteAlimtalk;
    }
    if (naverSubscription && naverSubscription.onIndoorLogCreatedReward) {
      exports.onIndoorLogCreatedReward = naverSubscription.onIndoorLogCreatedReward;
    }
    if (naverSubscription && naverSubscription.verifyMeetingAttendance) {
      exports.verifyMeetingAttendance = naverSubscription.verifyMeetingAttendance;
    }
    if (naverSubscription && naverSubscription.scheduledRideAttendanceVerification) {
      exports.scheduledRideAttendanceVerification = naverSubscription.scheduledRideAttendanceVerification;
    }
  } catch (e) {
    console.warn("[Functions] Naver 구독 모듈 로드 실패:", e.message);
  }
}
