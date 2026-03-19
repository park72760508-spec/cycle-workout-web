/**
 * 관리자 비밀번호 초기화 Callable Function (v2)
 * Strava 토큰 교환/갱신 Callable (v2) - Client Secret은 서버에서만 사용
 * Strava 전날 로그 동기화 스케줄 함수 (Firebase 기반, 매일 새벽 2시 Asia/Seoul)
 */
const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const functions = require("firebase-functions");
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

if (!admin.apps.length) {
  admin.initializeApp();
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

/** Strava에서 MMP/수집 제외할 활동 타입. Run, Swim, Walk만 제외, 나머지는 모두 수집 */
const EXCLUDED_ACTIVITY_TYPES = new Set(["run", "swim", "walk"]);

/** Strava 로그가 MMP/수집 대상인지. source가 strava가 아니면 true(Stelvio 등).
 *  Strava: Run, Swim, Walk만 제외, 나머지(Ride, VirtualRide, Unknown 등) 모두 수집 */
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

function computeTssFromActivity(activity, ftp) {
  const durationSec = Number(activity.moving_time) || 0;
  if (durationSec <= 0) return 0;
  const np = Number(activity.weighted_average_watts) || Number(activity.average_watts) || 0;
  if (np <= 0) return 0;
  ftp = Number(ftp) || 0;
  if (ftp <= 0) return 0;
  const ifVal = np / ftp;
  const tss = (durationSec * np * ifVal) / (ftp * 3600) * 100;
  return Math.max(0, Math.round(tss * 100) / 100);
}

/** Strava 상세 활동 API 호출 (수동 동기화와 동일한 상세 필드 확보) */
async function fetchStravaActivityDetail(accessToken, activityId) {
  const url = `https://www.strava.com/api/v3/activities/${activityId}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return { success: false, error: `Strava ${res.status}` };
    const activity = await res.json().catch(() => null);
    return activity ? { success: true, activity } : { success: false, error: "Invalid response" };
  } catch (e) {
    return { success: false, error: e.message || "Request failed" };
  }
}

/** Strava Streams API 호출 (watts, heartrate). 파워미터/심박계 없으면 해당 스트림이 없을 수 있음. */
async function fetchStravaStreams(accessToken, activityId) {
  const url = `https://www.strava.com/api/v3/activities/${activityId}/streams/time,watts,heartrate`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return { success: false, watts: null, heartrate: null };
    const raw = await res.json().catch(() => null);
    const streamArray = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : []);
    const wattsStream = streamArray.find((s) => s && String(s.type || "").toLowerCase() === "watts");
    const heartrateStream = streamArray.find((s) => s && String(s.type || "").toLowerCase() === "heartrate");
    const wattsArray = wattsStream && Array.isArray(wattsStream.data) ? wattsStream.data : null;
    const heartrateArray = heartrateStream && Array.isArray(heartrateStream.data) ? heartrateStream.data : null;
    return { success: true, watts: wattsArray, heartrate: heartrateArray };
  } catch (e) {
    return { success: false, watts: null, heartrate: null };
  }
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

/** 심박 스트림 배열에서 구간별 최대 평균 심박 및 전체 최대 심박 계산 (MMP와 동일한 구간) */
function calculateMaxHeartRatePeaks(heartrateArray) {
  if (!heartrateArray || heartrateArray.length === 0) return null;
  const arr = heartrateArray.map((v) => Number(v) || 0);
  const maxHr = Math.max(...arr);
  if (maxHr <= 0) return null;
  return {
    max_hr_5sec: arr.length >= 5 ? Math.round(calculateMaxAveragePower(arr, 5)) : null,
    max_hr_1min: arr.length >= 60 ? Math.round(calculateMaxAveragePower(arr, 60)) : null,
    max_hr_5min: arr.length >= 300 ? Math.round(calculateMaxAveragePower(arr, 300)) : null,
    max_hr_10min: arr.length >= 600 ? Math.round(calculateMaxAveragePower(arr, 600)) : null,
    max_hr_20min: arr.length >= 1200 ? Math.round(calculateMaxAveragePower(arr, 1200)) : null,
    max_hr_40min: arr.length >= 2400 ? Math.round(calculateMaxAveragePower(arr, 2400)) : null,
    max_hr_60min: arr.length >= 3600 ? Math.round(calculateMaxAveragePower(arr, 3600)) : null,
    max_hr: maxHr,
  };
}

/**
 * Strava Webhook 활동 생성 이벤트 처리 (비동기 호출용).
 * owner_id(Strava athlete ID)로 유저 조회 → Activity 상세 + Streams 병렬 호출 → MMP 계산 → TSS/포인트 정산 → 저장.
 */
async function processStravaActivity(db, ownerId, objectId) {
  const ownerIdNum = Number(ownerId);
  const activityId = String(objectId);
  if (!ownerIdNum || !activityId) {
    console.warn("[processStravaActivity] owner_id 또는 object_id 없음:", { ownerId, objectId });
    return;
  }
  const usersSnap = await db.collection("users").where("strava_athlete_id", "==", ownerIdNum).limit(1).get();
  if (usersSnap.empty) {
    console.warn("[processStravaActivity] strava_athlete_id=", ownerIdNum, "에 해당하는 유저 없음");
    return;
  }
  const userDoc = usersSnap.docs[0];
  const userId = userDoc.id;
  const userData = userDoc.data();
  const ftp = Number(userData.ftp) || 0;

  let accessToken;
  try {
    const tokenResult = await refreshStravaTokenForUser(db, userId);
    accessToken = tokenResult.accessToken;
  } catch (e) {
    console.error("[processStravaActivity] 토큰 갱신 실패:", userId, e.message);
    return;
  }

  const [detailRes, streamsRes] = await Promise.all([
    fetchStravaActivityDetail(accessToken, activityId),
    fetchStravaStreams(accessToken, activityId),
  ]);

  if (!detailRes.success || !detailRes.activity) {
    console.warn("[processStravaActivity] 활동 상세 조회 실패:", activityId, detailRes.error);
    return;
  }

  const activity = detailRes.activity;
  const mapped = mapStravaActivityToLogSchema(activity, userId, ftp);

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

  const existingIds = await getExistingStravaActivityIds(db, userId);
  const isNew = !existingIds.has(activityId);

  const logsRef = db.collection("users").doc(userId).collection("logs");
  await logsRef.doc(activityId).set(logDoc, { merge: true });

  let userTss = 0;
  if (isNew && mapped.tss > 0 && (mapped.distance_km || 0) !== 0) {
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

  if (userTss > 0) {
    try {
      await updateUserMileageInFirestore(db, userId, userTss);
    } catch (e) {
      console.error("[processStravaActivity] 포인트 업데이트 실패:", userId, e.message);
    }
  }

  console.log("[processStravaActivity] 완료:", { userId, activityId, isNew, userTss, max5minWatts, max10minWatts, max30minWatts });
}

/**
 * Strava 활동 → 로그 스키마 매핑 (수동 동기화 mapStravaActivityToSchema와 동일한 필드)
 * 상세 API 응답 기준으로 avg_hr, max_hr, avg_cadence, elevation_gain, kilojoules 등 포함.
 */
function mapStravaActivityToLogSchema(activity, userId, ftpAtTime) {
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
  let ifValue = null;
  if (ftp > 0 && np > 0) ifValue = Math.round((np / ftp) * 1000) / 1000;
  let tss = null;
  if (ftp > 0 && np > 0 && durationSec > 0 && ifValue != null) {
    tss = Math.round(((durationSec * np * ifValue) / (ftp * 36)) * 100) / 100;
    tss = Math.max(0, tss);
  } else if (ftp > 0 && np > 0 && durationSec > 0) {
    const ifVal = np / ftp;
    tss = Math.round(((durationSec * np * ifVal) / (ftp * 36)) * 100) / 100;
    tss = Math.max(0, tss);
  }
  let efficiencyFactor = null;
  if (np > 0 && avgHr != null && avgHr > 0) efficiencyFactor = Math.round((np / avgHr) * 100) / 100;
  const now = new Date().toISOString();
  const activityType = String(activity.sport_type || activity.type || "").trim() || null;
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
    rpe: rpe,
    ftp_at_time: ftp > 0 ? ftp : null,
    if: ifValue,
    tss: tss != null ? tss : 0,
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
  const snapshot = await db.collection("users").doc(userId).collection("logs").get();
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
  const snapshot = await db.collection("users").doc(userId).collection("logs").where("source", "==", "strava").get();
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
  const snapshot = await db.collection("users").doc(userId).collection("logs").where("source", "==", "strava").get();
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
  let accessToken;
  try {
    const tokenResult = await refreshStravaTokenForUser(db, userId);
    accessToken = tokenResult.accessToken;
  } catch (e) {
    return { userId, processed: 0, newActivities: 0, userTss: 0, error: `토큰 갱신 실패: ${e.message}` };
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
      const needsMmp = d.max_1min_watts == null || d.max_5min_watts == null || d.max_10min_watts == null || d.max_20min_watts == null || d.max_30min_watts == null || d.max_40min_watts == null || d.max_60min_watts == null;
      const needsHrPeaks = d.max_hr_5sec == null && d.max_hr_1min == null && d.max_hr_5min == null;
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
    const mapped = mapStravaActivityToLogSchema(detailedActivity, userId, ftp);
    const streamsRes = await fetchStravaStreams(accessToken, actId);
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
      max_watts: mapped.max_watts,
      weighted_watts: mapped.weighted_watts,
      kilojoules: mapped.kilojoules,
      elevation_gain: mapped.elevation_gain,
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
    await logsRef.doc(actId).set(logDoc, { merge: true });
    existingIds.add(actId);
    newActivities += 1;
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
 * months 파라미터로 기간 설정. DB 존재 시 파워만 업데이트, 미존재 시 전체 생성+TSS 정산.
 * Rate Limit: 활동당 1초 대기, API 85회 도달 시 중단, hasMore 반환.
 */
const manualStravaSyncWithMmpOptions = { cors: true, timeoutSeconds: 540 };
if (STRAVA_CLIENT_SECRET) {
  manualStravaSyncWithMmpOptions.secrets = [STRAVA_CLIENT_SECRET];
}
exports.manualStravaSyncWithMmp = onRequest(
  manualStravaSyncWithMmpOptions,
  async (req, res) => {
    const forceRecalcTimeInZones = String(req.query?.forceRecalcTimeInZones || req.body?.forceRecalcTimeInZones || "").toLowerCase() === "true";
    console.log("[manualStravaSyncWithMmp] 요청 수신:", req.method, "months=", req.query?.months || req.body?.months, "forceRecalcTimeInZones=", forceRecalcTimeInZones);
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
    if (!uid) {
      console.warn("[manualStravaSyncWithMmp] 인증 실패: Authorization Bearer 토큰 없음 또는 유효하지 않음");
      return;
    }
    console.log("[manualStravaSyncWithMmp] 인증 성공, userId:", uid);

    const months = Math.min(6, Math.max(1, parseInt(req.query.months || req.body?.months || "1", 10) || 1));
    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({ success: false, error: "사용자를 찾을 수 없습니다." });
      return;
    }
    const userData = userSnap.data();
    const ftp = Number(userData.ftp) || 0;

    const now = new Date();
    const beforeUnix = Math.floor(now.getTime() / 1000);
    const afterDate = new Date(now);
    afterDate.setMonth(afterDate.getMonth() - months);
    const afterUnix = Math.floor(afterDate.getTime() / 1000);

    let accessToken;
    try {
      const tokenResult = await refreshStravaTokenForUser(db, uid);
      accessToken = tokenResult.accessToken;
    } catch (e) {
      res.status(500).json({ success: false, error: `토큰 갱신 실패: ${e.message}` });
      return;
    }

    let apiCallCount = 1;
    const allActivities = [];
    let page = 1;
    while (apiCallCount < STRAVA_API_CALL_LIMIT) {
      const actRes = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${afterUnix}&before=${beforeUnix}&per_page=200&page=${page}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      apiCallCount += 1;
      if (!actRes.ok) {
        res.status(500).json({ success: false, error: `활동 조회 실패: ${actRes.status}` });
        return;
      }
      const pageActivities = await actRes.json().catch(() => []);
      if (page === 1) {
        console.log(`[manualStravaSyncWithMmp] userId=${uid} athlete_id=${userData.strava_athlete_id || "?"} 1st_page_activities=${Array.isArray(pageActivities) ? pageActivities.length : 0} status=${actRes.status}`);
      }
      if (!Array.isArray(pageActivities) || pageActivities.length === 0) break;
      allActivities.push(...pageActivities);
      if (pageActivities.length < 200) break;
      page += 1;
    }

    const logsRef = db.collection("users").doc(uid).collection("logs");
    const stelvioDates = await getStelvioLogDates(db, uid);
    const stelvioDateStravaTssAccumulator = new Map();
    const dateOnlyStravaTss = new Map();
    let processedCount = 0;
    let updatedCount = 0;
    let createdCount = 0;
    let userTss = 0;

    for (const act of allActivities) {
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
        const needsMmp = existingData.max_1min_watts == null || existingData.max_5min_watts == null || existingData.max_10min_watts == null || existingData.max_20min_watts == null || existingData.max_30min_watts == null || existingData.max_40min_watts == null || existingData.max_60min_watts == null;
        const needsHrPeaks = existingData.max_hr_5sec == null && existingData.max_hr_1min == null && existingData.max_hr_5min == null;
        const needsTimeInZones = forceRecalcTimeInZones || !existingData.time_in_zones || !existingData.time_in_zones.power;
        const needsWeight = existingData.weight == null;
        const needsActivityType = !String(existingData.activity_type || "").trim();
        if (needsMmp || needsHrPeaks || needsTimeInZones || needsWeight || needsActivityType) {
          if (apiCallCount >= STRAVA_API_CALL_LIMIT) break;
          const updateData = {};
          if (needsActivityType) {
            const detailRes = await fetchStravaActivityDetail(accessToken, actId);
            apiCallCount += 1;
            if (detailRes.success && detailRes.activity) {
              updateData.activity_type = String(detailRes.activity.sport_type || detailRes.activity.type || "").trim() || null;
            }
          }
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
            console.log(`[manualStravaSyncWithMmp] [Activity ID: ${actId}] Calculated MMP: 1m=${updateData.max_1min_watts}, 5m=${updateData.max_5min_watts}, 10m=${updateData.max_10min_watts}, 20m=${updateData.max_20min_watts}, 30m=${updateData.max_30min_watts}, 40m=${updateData.max_40min_watts}, 60m=${updateData.max_60min_watts}`);
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
        const detailRes = await fetchStravaActivityDetail(accessToken, actId);
        apiCallCount += 1;
        if (!detailRes.success || !detailRes.activity) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const streamsRes = await fetchStravaStreams(accessToken, actId);
        apiCallCount += 1;
        const activity = detailRes.activity;
        const mapped = mapStravaActivityToLogSchema(activity, uid, ftp);
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
        if (wattsArray && wattsArray.length > 0) {
          max1minWatts = calculateMaxAveragePower(wattsArray, 60);
          max5minWatts = calculateMaxAveragePower(wattsArray, 300);
          max10minWatts = calculateMaxAveragePower(wattsArray, 600);
          max20minWatts = calculateMaxAveragePower(wattsArray, 1200);
          max30minWatts = calculateMaxAveragePower(wattsArray, 1800);
          max40minWatts = calculateMaxAveragePower(wattsArray, 2400);
          max60minWatts = calculateMaxAveragePower(wattsArray, 3600);
          console.log(`[manualStravaSyncWithMmp] [Activity ID: ${actId}] Calculated MMP: 1m=${max1minWatts}, 5m=${max5minWatts}, 10m=${max10minWatts}, 20m=${max20minWatts}, 30m=${max30minWatts}, 40m=${max40minWatts}, 60m=${max60minWatts}`);
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
          max_watts: mapped.max_watts,
          weighted_watts: mapped.weighted_watts,
          kilojoules: mapped.kilojoules,
          elevation_gain: mapped.elevation_gain,
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
        await logDocRef.set(logDoc, { merge: true });
        createdCount += 1;
        processedCount += 1;
        const dateStr = mapped.date || "";
        const activityTss = mapped.tss || 0;
        const distanceKm = mapped.distance_km || 0;
        if (activityTss > 0 && distanceKm !== 0) {
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

    const hasMore = apiCallCount >= STRAVA_API_CALL_LIMIT;
    res.status(200).json({
      success: true,
      processedCount,
      updatedCount,
      createdCount,
      hasMore,
      apiCallCount,
    });
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

/** 사용자 로그에서 주간 TSS 합계 (날짜별: strava 우선, 없으면 stelvio) */
async function getWeeklyTssForUser(db, userId, startStr, endStr) {
  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("date", ">=", startStr)
    .where("date", "<=", endStr)
    .get();
  const byDate = {};
  snapshot.docs.forEach((doc) => {
    const d = doc.data();
    const dateStr = typeof d.date === "string" ? d.date : (d.date && d.date.toDate ? d.date.toDate().toISOString().slice(0, 10) : "");
    if (!dateStr || dateStr < startStr || dateStr > endStr) return;
    const tss = Number(d.tss) || 0;
    const isStrava = String(d.source || "").toLowerCase() === "strava";
    if (!byDate[dateStr]) byDate[dateStr] = { strava: 0, stelvio: 0 };
    if (isStrava) byDate[dateStr].strava += tss;
    else byDate[dateStr].stelvio += tss;
  });
  let total = 0;
  Object.keys(byDate).forEach((dateStr) => {
    const o = byDate[dateStr];
    const dayTss = o.strava > 0 ? o.strava : o.stelvio;
    if (dayTss >= TSS_PER_DAY_CHEAT_THRESHOLD) return; // 해당 날짜 합산 제외
    total += dayTss;
  });
  return total;
}

/** 해당 주간에 1일 500 이상 TSS가 있는지 여부 (포인트 적립 제외 판단용) */
async function hasWeeklyTssCheatDay(db, userId, startStr, endStr) {
  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("date", ">=", startStr)
    .where("date", "<=", endStr)
    .get();
  const byDate = {};
  snapshot.docs.forEach((doc) => {
    const d = doc.data();
    const dateStr = typeof d.date === "string" ? d.date : (d.date && d.date.toDate ? d.date.toDate().toISOString().slice(0, 10) : "");
    if (!dateStr || dateStr < startStr || dateStr > endStr) return;
    const tss = Number(d.tss) || 0;
    const isStrava = String(d.source || "").toLowerCase() === "strava";
    if (!byDate[dateStr]) byDate[dateStr] = { strava: 0, stelvio: 0 };
    if (isStrava) byDate[dateStr].strava += tss;
    else byDate[dateStr].stelvio += tss;
  });
  for (const dateStr of Object.keys(byDate)) {
    const o = byDate[dateStr];
    const dayTss = o.strava > 0 ? o.strava : o.stelvio;
    if (dayTss >= TSS_PER_DAY_CHEAT_THRESHOLD) return true;
  }
  return false;
}

const WEEKLY_RANKING_CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const WEEKLY_TSS_BATCH_SIZE = 50; // 1000명 대비: 20배치로 완료

/** 여러 사용자 주간 TSS 병렬 조회 (배치 단위로 실행해 Firestore 부하 완화) */
async function getWeeklyRankingEntries(db, startStr, endStr) {
  const usersSnap = await db.collection("users").get();
  const docs = usersSnap.docs;
  const entries = [];
  for (let i = 0; i < docs.length; i += WEEKLY_TSS_BATCH_SIZE) {
    const batch = docs.slice(i, i + WEEKLY_TSS_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (doc) => {
        const userId = doc.id;
        const name = doc.data().name || "(이름 없음)";
        const totalTss = await getWeeklyTssForUser(db, userId, startStr, endStr);
        return totalTss > 0 ? { userId, name, totalTss } : null;
      })
    );
    results.forEach((r) => { if (r) entries.push(r); });
  }
  entries.sort((a, b) => b.totalTss - a.totalTss);
  return entries;
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
    const usePrevWeek = weekParam === "prev";
    const { startStr, endStr } = usePrevWeek ? getWeekRangeSeoul(-1) : getWeekRangeSeoul();
    const cacheRef = db.collection("cache").doc(usePrevWeek ? "weeklyRankingPrev" : "weeklyRanking");
    const cacheSnap = await cacheRef.get();
    const nowMs = Date.now();
    if (cacheSnap.exists) {
      const data = cacheSnap.data();
      const cachedStart = data.startStr;
      const cachedEnd = data.endStr;
      const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
      if (cachedStart === startStr && cachedEnd === endStr && updatedAt && nowMs - updatedAt < WEEKLY_RANKING_CACHE_TTL_MS) {
        const ranking = Array.isArray(data.ranking) ? data.ranking : [];
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Cache-Control", "public, max-age=120"); // 클라이언트 캐시 2분
        return res.status(200).json({ success: true, ranking, startStr, endStr, cached: true });
      }
    }
    const entries = await getWeeklyRankingEntries(db, startStr, endStr);
    const top10 = entries.slice(0, 10).map((e, i) => ({
      rank: i + 1,
      userId: e.userId,
      name: e.name,
      totalTss: Math.round(e.totalTss * 100) / 100,
    }));
    await cacheRef.set({
      ranking: top10,
      startStr,
      endStr,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.set("Access-Control-Allow-Origin", "*");
    res.status(200).json({ success: true, ranking: top10, startStr, endStr });
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
 * yearly_peaks/{year} max_hr 존재 시 반드시 사용 (스트림 값으로 덮어쓰지 않음).
 * @param {Object} opts - { wattsArray, hrArray, ftp, userId, db, dateStr }
 * @returns {Promise<{ power: Object, hr: Object }>}
 */
async function calculateZoneTimesFromStreams(opts) {
  const { wattsArray, hrArray, ftp, userId, db, dateStr } = opts;
  const powerZones = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
  const hrZones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

  const effectiveFtp = ftp > 0 ? ftp : DEFAULT_FTP_W;
  const smoothedWatts = wattsArray && wattsArray.length > 0 ? smoothPowerSpikes(wattsArray) : [];
  if (smoothedWatts.length > 0) {
    Object.assign(powerZones, calculateTimeInPowerZones(smoothedWatts, effectiveFtp));
  }

  let maxHr = DEFAULT_MAX_HR;
  let usedYearlyPeaks = false;
  if (dateStr && userId && db) {
    const year = parseInt(String(dateStr).substring(0, 4), 10);
    if (!isNaN(year)) {
      const fromDb = await getMaxHRForYear(db, userId, year);
      if (fromDb != null && fromDb > 0) {
        maxHr = fromDb;
        usedYearlyPeaks = true;
      }
    }
  }
  if (!usedYearlyPeaks && hrArray && hrArray.length > 0) {
    const fromStream = Math.max(...hrArray.map((v) => Number(v) || 0).filter((v) => v > 0 && v <= HR_MAX_BPM));
    if (fromStream > 0) maxHr = fromStream;
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
  // max_hr: 훈련 로그의 최대 심박수를 yearly_peaks에 반영 (max_hr 또는 max_heartrate 필드 지원)
  const logMaxHr = Number(logData.max_hr ?? logData.max_heartrate) || 0;
  if (logMaxHr > 0) {
    const prevMaxHr = Number(current.max_hr) || 0;
    if (logMaxHr > prevMaxHr) {
      merged.max_hr = logMaxHr;
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
      let contributingActivityType = null;
      logsSnap.docs.forEach((doc) => {
        const d = doc.data();
        if (!isCyclingForMmp(d)) return;
        const w = Number(d[field]) || 0;
        if (w > 0 && validatePeakPowerRecord(durationType, w, weightKg) && w > maxWattsFromLogs) {
          maxWattsFromLogs = w;
          contributingActivityType = d.activity_type ?? (String(d.source || "").toLowerCase() === "strava" ? "Unknown" : "Stelvio");
        }
        const hr = Number(d.max_hr) || 0;
        if (hr > 0 && hr > maxHrFromLogs) maxHrFromLogs = hr;
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
          if (shouldUpdateMaxHr) updateData.max_hr = maxHrFromLogs;
          await yearlyRef.set(updateData, { merge: true });
        } catch (e) {
          console.warn("[getPeakPowerForUser] yearly_peaks 보정 실패:", userId, year, e.message);
        }
      }
    }
    if (watts <= 0 || wkgVal <= 0) return null;
    return { watts, wkg: wkgVal, weightKg };
  }

  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("date", ">=", startStr)
    .where("date", "<=", endStr)
    .get();
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

/** 피크 파워 랭킹 엔트리 (기간·종목·성별·연령대별) */
async function getPeakPowerRankingEntries(db, startStr, endStr, durationType, genderFilter) {
  const usersSnap = await db.collection("users").get();
  const docs = usersSnap.docs;
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
        };
      })
    );
    results.forEach((r) => { if (r) entries.push(r); });
  }
  entries.sort((a, b) => b.wkg - a.wkg);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = { Supremo: withRank.slice(0, 10), Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  withRank.forEach((e) => {
    if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
  });
  return { entries: withRank, byCategory };
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
  const diffWkg = nextUser.wkg - currentUser.wkg;
  if (diffWkg <= 0) return null;
  const weightKg = Number(currentUser.weightKg) || 0;
  if (weightKg <= 0) return null;
  const requiredWatts = Math.ceil(diffWkg * weightKg);
  const targetWatts = (currentUser.watts || 0) + requiredWatts;
  return `${currentUser.name}님 현재 ${currentUser.rank}위! 앞선 사용자와의 차이는 ${diffWkg.toFixed(2)} W/kg로, ${requiredWatts}W 향상 시키면(목표 파워: ${targetWatts}W) 추월할 수 있습니다. 도전해 보세요!`;
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
    const period = req.query.period || "monthly";
    const durationType = req.query.duration || "5min";
    const gender = req.query.gender || "all";
    const uid = req.query.uid || null;
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month, 10) : new Date().getMonth() + 1;

    let startStr, endStr;
    if (period === "yearly") {
      const r = getYearRangeSeoul(year);
      startStr = r.startStr;
      endStr = r.endStr;
    } else {
      const r = getMonthRangeSeoul(year, month);
      startStr = r.startStr;
      endStr = r.endStr;
    }

    const db = admin.firestore();
    const cacheKey = `peakRanking_${period}_${durationType}_${gender}_${startStr}_${endStr}`;
    const cacheRef = db.collection("cache").doc(cacheKey);
    const cacheSnap = await cacheRef.get();
    const nowMs = Date.now();
    if (cacheSnap.exists) {
      const data = cacheSnap.data();
      const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
      if (updatedAt && nowMs - updatedAt < PEAK_RANKING_CACHE_TTL_MS) {
        let out = { success: true, byCategory: data.byCategory, startStr, endStr, period, durationType, gender, cached: true };
        if (uid) {
          const cat = data.byCategory;
          const cats = ["Supremo", "Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"];
          let current = null, nextUser = null;
          for (const c of cats) {
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
        return res.status(200).json(out);
      }
    }

    const { entries, byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, durationType, gender);
    await cacheRef.set({
      byCategory,
      startStr,
      endStr,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let out = { success: true, byCategory, startStr, endStr, period, durationType, gender };
    if (uid) {
      const cats = ["Supremo", "Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"];
      let current = null, nextUser = null;
      for (const c of cats) {
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
    res.status(200).json(out);
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
      const r = getYearRangeSeoul(year);
      startStr = r.startStr;
      endStr = r.endStr;
    } else {
      const r = getMonthRangeSeoul(year, month);
      startStr = r.startStr;
      endStr = r.endStr;
    }

    const db = admin.firestore();
    const todayStr = req.query.today || req.body?.today || null;
    const { startStr: week5StartStr, endStr: week5EndStr } = getWeek5RangeSeoul(todayStr);

    const results = [];

    for (const durationType of Object.keys(DURATION_FIELDS)) {
      const { byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, durationType, gender);
      const cats = ["Supremo", "Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"];
      let current = null;
      let rival = null;
      for (const c of cats) {
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
    const snap = change.after;
    if (!snap || !snap.exists) return;
    const logData = snap.data();
    const userId = context.params.userId;
    const logId = context.params.logId;
    if (!userId || !logId) return;
    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) return;
    const userData = userSnap.data();
    try {
      await upsertYearlyPeakFromLog(db, userId, userData, logData, logId);
    } catch (e) {
      console.warn("[onUserLogWritten] upsertYearlyPeakFromLog 실패:", userId, logId, e.message);
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

/** 기존 로그 기반 연간 최고 기록 백필 (관리자 수동 호출). year 파라미터로 대상 연도 지정 */
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
    const { startStr, endStr } = getYearRangeSeoul(year);
    const db = admin.firestore();
    const usersSnap = await db.collection("users").get();
    let processed = 0;
    let updated = 0;
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const logsSnap = await db.collection("users").doc(userId).collection("logs")
        .where("date", ">=", startStr)
        .where("date", "<=", endStr)
        .get();
      for (const logDoc of logsSnap.docs) {
        processed++;
        try {
          await upsertYearlyPeakFromLog(db, userId, userData, logDoc.data(), logDoc.id);
          updated++;
        } catch (e) {
          console.warn("[backfillYearlyPeaks]", userId, logDoc.id, e.message);
        }
      }
    }
    res.status(200).json({ success: true, year, startStr, endStr, processed, updated });
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
      const dateStr = typeof d.date === "string" ? d.date : (d.date && d.date.toDate ? d.date.toDate().toISOString().slice(0, 10) : "");
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
  } catch (e) {
    console.warn("[Functions] Naver 구독 모듈 로드 실패:", e.message);
  }
}
