/**
 * 관리자 비밀번호 초기화 Callable Function (v2)
 * Strava 토큰 교환/갱신 Callable (v2) - Client Secret은 서버에서만 사용
 */
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");

// 환경 변수에서 STRAVA_CLIENT_SECRET 읽기 (Blaze 플랜 불필요)
const STRAVA_CLIENT_SECRET = defineString("STRAVA_CLIENT_SECRET");

if (!admin.apps.length) {
  admin.initializeApp();
}

// CORS 설정: Firebase Functions v2 onCall은 기본적으로 모든 origin 허용
// 특정 origin만 허용하려면 배열로 지정 (문자열 또는 정규식)
const CORS_ORIGINS = [
  "https://stelvio.ai.kr",
  "https://www.stelvio.ai.kr",
];

exports.adminResetUserPassword = onCall(
  { cors: CORS_ORIGINS },
  async (request) => {
    try {
      // 인증 필수
      if (!request.auth || !request.auth.uid) {
        throw new HttpsError(
          "unauthenticated",
          "로그인한 후에만 비밀번호 초기화를 할 수 있습니다."
        );
      }

      const callerUid = request.auth.uid;
      const data = request.data || {};
      const targetUserId = data.targetUserId ? String(data.targetUserId).trim() : null;
      const newPassword = data.newPassword ? String(data.newPassword) : null;

      if (!targetUserId) {
        throw new HttpsError(
          "invalid-argument",
          "대상 사용자 ID(targetUserId)가 필요합니다."
        );
      }

      if (!newPassword || newPassword.length < 6) {
        throw new HttpsError(
          "invalid-argument",
          "새 비밀번호는 6자 이상이어야 합니다."
        );
      }

      // Firestore에서 호출자 등급 확인 (관리자만 허용)
      const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
      if (!callerDoc.exists) {
        throw new HttpsError(
          "permission-denied",
          "호출자 정보를 찾을 수 없습니다."
        );
      }

      const grade = callerDoc.data().grade;
      const isAdmin = grade === 1 || grade === "1";
      if (!isAdmin) {
        throw new HttpsError(
          "permission-denied",
          "관리자(grade=1)만 다른 사용자의 비밀번호를 초기화할 수 있습니다."
        );
      }

      // Firebase Auth에서 대상 사용자 비밀번호 변경
      await admin.auth().updateUser(targetUserId, { password: newPassword });
      return { success: true, message: "비밀번호가 초기화되었습니다." };
    } catch (err) {
      // 이미 HttpsError면 그대로 재throw (CORS 포함 응답 전달)
      if (err instanceof HttpsError) {
        throw err;
      }
      // Auth API 오류 변환
      if (err.code === "auth/user-not-found") {
        throw new HttpsError("not-found", "대상 사용자를 Firebase Auth에서 찾을 수 없습니다.");
      }
      if (err.code === "auth/weak-password") {
        throw new HttpsError("invalid-argument", "비밀번호가 너무 약합니다. 6자 이상 입력해주세요.");
      }
      console.error("[adminResetUserPassword]", err);
      throw new HttpsError(
        "internal",
        err.message || "비밀번호 변경 중 오류가 발생했습니다."
      );
    }
  }
);

/**
 * Strava 인증 코드를 액세스/리프레시 토큰으로 교환하고 users/{userId}에 저장.
 * Client Secret은 서버(Secret Manager)에서만 사용. appConfig/strava에서 client_id, redirect_uri 읽음.
 * onRequest로 변경하여 CORS 수동 처리
 */
exports.exchangeStravaCode = onRequest(
  { cors: CORS_ORIGINS },
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
      const clientSecret = STRAVA_CLIENT_SECRET.value();

      console.log("[exchangeStravaCode] 설정 확인:", {
        hasClientId: !!clientId,
        hasRedirectUri: !!redirectUri,
        hasClientSecret: !!clientSecret,
        clientIdLength: clientId.length,
        redirectUriLength: redirectUri.length,
        clientSecretLength: clientSecret ? clientSecret.length : 0
      });

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
        const msg = tokenData.message || tokenData.error || `Strava ${tokenRes.status}`;
        throw new HttpsError("internal", "Strava 토큰 교환 실패: " + msg);
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
      const statusCode = err.code === "invalid-argument" ? 400 : 
                         err.code === "not-found" ? 404 :
                         err.code === "failed-precondition" ? 412 : 500;
      res.status(statusCode).json({
        success: false,
        error: err.message || "Strava 토큰 교환 중 오류가 발생했습니다."
      });
    }
  }
);

/**
 * Strava 리프레시 토큰으로 액세스 토큰 갱신 후 users/{userId} 업데이트.
 * 클라이언트는 userId만 전달; 리프레시 토큰은 서버가 Firestore에서 읽음.
 * onRequest로 변경하여 CORS 수동 처리
 */
exports.refreshStravaToken = onRequest(
  { cors: CORS_ORIGINS },
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
      const clientSecret = STRAVA_CLIENT_SECRET.value();

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
      const statusCode = err.code === "invalid-argument" ? 400 : 
                         err.code === "not-found" ? 404 :
                         err.code === "failed-precondition" ? 412 : 500;
      res.status(statusCode).json({
        success: false,
        error: err.message || "Strava 토큰 갱신 중 오류가 발생했습니다."
      });
    }
  }
);
