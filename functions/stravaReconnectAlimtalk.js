/**
 * Strava 재연결 안내 — 카카오 알림톡(알리고) 발송.
 * 카카오 채널: @stelvio_ai · 승인 템플릿 코드: UO_3097 · 템플릿명: Strava 재연결 안내 (대체문자 미사용)
 *
 * 변수는 #{이름} 하나뿐이고 버튼 없음. 본문은 승인 문구와 한 글자도 달라선 안 된다.
 * tpl_code 는 ALIGO_STRAVA_RECONNECT_TPL_CODE 또는 appConfig/aligo.strava_reconnect_tpl_code 로 덮어쓸 수 있다.
 * 계정 정보(senderkey/sender/apikey/userid/token)는 다른 알림톡과 공유한다.
 */
"use strict";

const { scrubAligoCredential } = require("./lib/aligoCredentials");

const APP_CONFIG_COLLECTION = "appConfig";
const ALIGO_CONFIG_DOC = "aligo";

const STRAVA_RECONNECT_ALIM_SUBJECT_KO = "Strava 재연결 안내";
const DEFAULT_STRAVA_RECONNECT_TPL_CODE = "UO_3097";

/** 승인 템플릿 본문 조립 — #{이름} 만 치환 */
function buildStravaReconnectAlimtalkMessage(name) {
  const n = String(name || "").trim() || "회원";
  return (
    `${n}님, STELVIO와 Strava 연동이 만료되어 라이딩 기록이 자동으로 반영되지 않고 있습니다.\n\n` +
    `■ 다시 연결하는 방법\n` +
    `1. STELVIO 접속 후 로그인\n` +
    `2. 설정 > Strava 연결 버튼 선택\n` +
    `3. Strava 승인 화면에서 '승인'\n\n` +
    `연결 후에는 끊겨 있던 기간의 활동도 자동으로 수집됩니다.\n\n` +
    `※ 본 메시지는 STELVIO에서 Strava 연동을 설정하신 회원님께 발송되는 서비스 안내입니다.`
  );
}

async function loadStravaReconnectAlimtalkConfig(db) {
  const snap = await db.collection(APP_CONFIG_COLLECTION).doc(ALIGO_CONFIG_DOC).get();
  const appConfig = snap.exists ? snap.data() || {} : {};

  const senderkey = scrubAligoCredential(
    process.env.ALIGO_SENDER_KEY || appConfig.senderkey || appConfig.senderKey || ""
  );
  const sender = scrubAligoCredential(process.env.ALIGO_SENDER || appConfig.sender || "");
  const useridCfg = scrubAligoCredential(appConfig.userid ?? appConfig.userId ?? appConfig.identifier ?? "");
  const apikey = scrubAligoCredential(process.env.ALIGO_API_KEY);
  const userid = scrubAligoCredential(process.env.ALIGO_USER_ID) || useridCfg;
  const token = scrubAligoCredential(process.env.ALIGO_TOKEN);
  const tplCode = scrubAligoCredential(
    process.env.ALIGO_STRAVA_RECONNECT_TPL_CODE ||
      appConfig.strava_reconnect_tpl_code ||
      DEFAULT_STRAVA_RECONNECT_TPL_CODE
  );

  const missing = [];
  if (!senderkey) missing.push("senderkey");
  if (!sender) missing.push("sender");
  if (!apikey) missing.push("ALIGO_API_KEY");
  if (!userid) missing.push("ALIGO_USER_ID");
  if (!token) missing.push("ALIGO_TOKEN");
  if (missing.length) throw new Error(`Strava 재연결 알림톡 설정 누락: ${missing.join(" · ")}`);

  return { senderkey, tpl_code: tplCode, sender, apikey, userid, token };
}

module.exports = {
  STRAVA_RECONNECT_ALIM_SUBJECT_KO,
  DEFAULT_STRAVA_RECONNECT_TPL_CODE,
  buildStravaReconnectAlimtalkMessage,
  loadStravaReconnectAlimtalkConfig,
};
