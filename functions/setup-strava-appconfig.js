/**
 * Firestore appConfig/strava 문서를 한 번에 생성·갱신하는 스크립트
 * 사용: cd functions && node setup-strava-appconfig.js
 * (환경 변수로 덮어쓰기 가능: STRAVA_CLIENT_ID, STRAVA_REDIRECT_URI)
 * 인증: GOOGLE_APPLICATION_CREDENTIALS 또는 gcloud auth application-default login
 */
const admin = require("firebase-admin");

// 적용된 기본값 (환경 변수로 덮어쓰기 가능)
const clientId = process.env.STRAVA_CLIENT_ID || "197363";
const redirectUri = process.env.STRAVA_REDIRECT_URI || "https://stelvio.ai.kr/callback.html";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function main() {
  try {
    await db.collection("appConfig").doc("strava").set(
      {
        strava_client_id: clientId,
        strava_redirect_uri: redirectUri,
      },
      { merge: true }
    );
    console.log("✅ appConfig/strava 설정 완료.");
  } catch (err) {
    console.error("❌ 실패:", err.message);
    process.exit(1);
  }
  process.exit(0);
}

main();
