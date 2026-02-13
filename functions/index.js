/**
 * 관리자 비밀번호 초기화 Callable Function (v2)
 * Strava 토큰 교환/갱신 Callable (v2) - Client Secret은 서버에서만 사용
 * Strava 전날 로그 동기화 스케줄 함수 (Firebase 기반, 매일 새벽 2시 Asia/Seoul)
 */
const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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

      await userRef.update({
        strava_access_token: accessToken,
        strava_refresh_token: refreshToken,
        strava_expires_at: expiresAt,
      });

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

async function getExistingStravaActivityIds(db, userId) {
  const ids = new Set();
  const snapshot = await db.collection("users").doc(userId).collection("logs").where("source", "==", "strava").get();
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (data.activity_id) ids.add(String(data.activity_id));
  });
  return ids;
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
  if (addDays > 0 && expiryDate) {
    try {
      const expiry = new Date(expiryDate);
      expiry.setDate(expiry.getDate() + addDays);
      newExpiryDate = expiry.toISOString().split("T")[0];
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

/**
 * 매일 새벽 2시(Asia/Seoul)에 Firestore users 중 strava_refresh_token이 있는 사용자에 대해
 * 전날 Strava 활동을 조회해 users/{userId}/logs에 저장하고 포인트(acc_points, rem_points)를 반영.
 * 수동 동기화(최근 1/3/6개월, 오늘)와 동일하게 Firebase(Firestore)만 사용.
 */
const stravaSyncScheduleOptions = { schedule: "0 2 * * *", timeZone: "Asia/Seoul" };
if (STRAVA_CLIENT_SECRET) {
  stravaSyncScheduleOptions.secrets = [STRAVA_CLIENT_SECRET];
}
exports.stravaSyncPreviousDay = onSchedule(
  stravaSyncScheduleOptions,
  async (event) => {
    const db = admin.firestore();
    const errors = [];
    let processed = 0;
    let newActivitiesTotal = 0;
    const totalTssByUser = {};
    const { afterUnix, beforeUnix, dateFrom, dateTo } = getYesterdayAfterBefore();
    console.log("[stravaSyncPreviousDay] 시작", { dateFrom, dateTo, afterUnix, beforeUnix });

    const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
    if (usersSnap.empty) {
      console.log("[stravaSyncPreviousDay] Strava 연결 사용자 없음");
      return;
    }

    for (const doc of usersSnap.docs) {
      const userId = doc.id;
      const userData = doc.data();
      const ftp = Number(userData.ftp) || 0;
      let accessToken;
      try {
        const tokenResult = await refreshStravaTokenForUser(db, userId);
        accessToken = tokenResult.accessToken;
      } catch (e) {
        errors.push(`사용자 ${userId}: 토큰 갱신 실패 - ${e.message}`);
        continue;
      }

      const actRes = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${afterUnix}&before=${beforeUnix}&per_page=50`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const activities = await actRes.json().catch(() => []);
      if (!actRes.ok) {
        errors.push(`사용자 ${userId}: 활동 조회 실패 - ${actRes.status}`);
        continue;
      }

      processed += 1;
      const existingIds = await getExistingStravaActivityIds(db, userId);
      const stelvioDates = await getStelvioLogDates(db, userId);
      const logsRef = db.collection("users").doc(userId).collection("logs");
      let userTss = 0;

      for (const act of Array.isArray(activities) ? activities : []) {
        const actId = String(act.id);
        if (existingIds.has(actId)) continue;

        const startDate = act.start_date || act.start_date_local || "";
        let dateStr = "";
        if (startDate) {
          try {
            dateStr = new Date(startDate).toISOString().split("T")[0];
          } catch (e) {
            dateStr = String(startDate).split("T")[0] || "";
          }
        }
        const title = act.name || "";
        const distanceKm = Math.round(((Number(act.distance) || 0) / 1000) * 100) / 100;
        const movingTime = Math.round(Number(act.moving_time) || 0);
        const tss = computeTssFromActivity(act, ftp);

        const logDoc = {
          activity_id: actId,
          user_id: userId,
          source: "strava",
          date: dateStr,
          title,
          distance_km: distanceKm,
          duration_sec: movingTime,
          time: movingTime,
          tss,
          tss_applied: true,
          created_at: new Date().toISOString(),
        };
        await logsRef.add(logDoc);
        existingIds.add(actId);
        newActivitiesTotal += 1;
        if (!stelvioDates.has(dateStr)) userTss += tss;
      }

      if (userTss > 0) {
        totalTssByUser[userId] = (totalTssByUser[userId] || 0) + userTss;
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

    console.log("[stravaSyncPreviousDay] 완료", {
      processed,
      newActivities: newActivitiesTotal,
      errors: errors.length,
      dateFrom,
      dateTo,
    });
    if (errors.length) console.warn("[stravaSyncPreviousDay] 오류:", errors);
  }
);
