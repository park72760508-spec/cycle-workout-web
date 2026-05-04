/**
 * 오픈 라이딩 모임 생성 시 — 초대된 연락처(라이딩 친구)에게 카카오 알림톡(알리고) 발송.
 * 카카오 채널: @stelvio_ai · 승인 템플릿 코드: UH_5528 · 템플릿명: [STELVIO 오프라인 라이딩 모임 안내]
 * 대체문자: 미사용(failover N)
 *
 * tpl_code 기본값 UH_5528 — 다른 값이 필요하면 ALIGO_MEETUP_OPEN_TPL_CODE 또는 appConfig/aligo.meetup_open_tpl_code
 * 그 외 ALIGO_SENDER_KEY, ALIGO_SENDER, ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_TOKEN
 * 선택: OPEN_RIDING_MEETUP_ALIMTALK=0 으로 비활성화
 */

"use strict";

const aligoapi = require("aligoapi");
const { scrubAligoCredential, logAligoAuthShape, aligoApiFailureHint } = require("./lib/aligoCredentials");

const APP_CONFIG_COLLECTION = "appConfig";
const ALIGO_CONFIG_DOC = "aligo";

/** 알리고 subject_1 / 본문 첫 줄 검수 템플릿명(대괄호 없음) — 카카오 승인명과 동일 */
const MEETUP_ALIM_SUBJECT_KO = "STELVIO 오프라인 라이딩 모임 안내";
const MEETUP_HEADER_LINE = `[${MEETUP_ALIM_SUBJECT_KO}]`;

/** 승인 템플릿 코드(운영 기본). env·Firestore로 덮어쓰기 가능 */
const DEFAULT_MEETUP_OPEN_TPL_CODE = "UH_5528";

function normalizeReceiverPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizePhoneDigitsServer(input) {
  let d = String(input || "").replace(/\D/g, "");
  if (d.startsWith("82") && d.length >= 10) d = `0${d.slice(2)}`;
  return d.slice(0, 15);
}

/** PointRewardService.getReceiverPhoneFromUserData 와 동일 필드 순서 */
function getReceiverPhoneFromUserData(userData) {
  if (!userData || typeof userData !== "object") return "";
  return String(
    userData.contact ??
      userData.phoneNumber ??
      userData.phone ??
      userData.tel ??
      userData.mobile ??
      userData.phone_number ??
      ""
  ).trim();
}

/** 빈·이상 recvname 방지 (PointRewardService와 동일 의도) */
function safeAlimtalkDisplayName(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return "회원";
  if (t.length === 1 && /[^\p{L}\p{N}]/u.test(t)) return "회원";
  return t;
}

function isAligoAlimtalkApiSuccess(data) {
  if (data.code !== undefined && data.code !== null) {
    const c = Number(data.code);
    return c === 0 && !Number.isNaN(c);
  }
  if (data.result_code !== undefined && data.result_code !== null) {
    return String(data.result_code) === "1";
  }
  return false;
}

/** Firestore Timestamp | Date | string → 서울 달력 YYYY-MM-DD */
function toYmdSeoulFromRideDate(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(value);
  }
  return "";
}

/**
 * 카카오 수신 예시와 동일: 5/5/26 9:00 (M/D/YY H:mm 또는 HH:mm)
 */
function formatMeetupDatetimeForTemplate(rideDateRaw, departureTimeRaw) {
  const ymd = toYmdSeoulFromRideDate(rideDateRaw);
  let m = 1;
  let day = 1;
  let yFull = 2026;
  if (/^(\d{4})-(\d{2})-(\d{2})$/.test(ymd)) {
    const p = ymd.split("-").map(Number);
    yFull = p[0];
    m = p[1];
    day = p[2];
  }
  const yy = yFull % 100;
  const timeStr = String(departureTimeRaw || "").trim() || "00:00";
  return `${m}/${day}/${yy} ${timeStr}`;
}

function formatRidingDistanceKm(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return "0km";
  if (Number.isInteger(x)) return `${x}km`;
  return `${Math.round(x * 10) / 10}km`;
}

/**
 * meetup_level: 폼에 저장된 문자열 그대로 (예: 중급(28~32km/h))
 */
function buildMeetupOpenAlimtalkMessage(vars) {
  const userName = safeAlimtalkDisplayName(vars.userName);
  const meetupName = String(vars.meetupName || "").trim() || "라이딩 모임";
  const meetupDatetime = String(vars.meetupDatetime || "").trim();
  const meetingPlace = String(vars.meetingPlace || "").trim() || "-";
  const meetupLevel = String(vars.meetupLevel || "").trim() || "-";
  const ridingDistance = String(vars.ridingDistance || "").trim() || "0km";

  const raw = `${MEETUP_HEADER_LINE}

안녕하세요 ${userName}님,
요청하신 STELVIO 오프라인 라이딩 모임 일정이 오픈되어 안내해 드립니다.

▶ 라이딩 모임 상세 정보
모임명 : ${meetupName}
일시 : ${meetupDatetime}
집결지 : ${meetingPlace}
레벨 : ${meetupLevel}
라이딩 거리 : ${ridingDistance}

${userName}님께서 요청하신 일정에 맞춰 안전하게 라이딩을 준비해 주시기 바랍니다. 상세한 참석 방법은 STELVIO 앱/웹에서 확인 가능합니다.

※ 본 메시지는 'STELVIO 오프라인 라이딩 모임 오픈 알림'을 사전 신청하신 회원님께만 발송되는 정보성 안내 메시지입니다.`;

  return raw.replace(/\r?\n/g, "\r\n");
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 */
async function loadAligoConfigForMeetupOpen(db) {
  const appConfigSnap = await db.collection(APP_CONFIG_COLLECTION).doc(ALIGO_CONFIG_DOC).get();
  const appConfig = appConfigSnap.exists ? appConfigSnap.data() || {} : {};

  const senderkey = scrubAligoCredential(String(process.env.ALIGO_SENDER_KEY || appConfig.senderkey || ""));
  const sender = scrubAligoCredential(String(process.env.ALIGO_SENDER || appConfig.sender || ""));
  const meetupTpl = scrubAligoCredential(
    String(
      process.env.ALIGO_MEETUP_OPEN_TPL_CODE ||
        appConfig.meetup_open_tpl_code ||
        appConfig.meetupOpenTplCode ||
        DEFAULT_MEETUP_OPEN_TPL_CODE
    )
  );

  const apikey = scrubAligoCredential(process.env.ALIGO_API_KEY);
  const userid = scrubAligoCredential(process.env.ALIGO_USER_ID);
  const token = scrubAligoCredential(process.env.ALIGO_TOKEN);

  if (!meetupTpl) {
    throw new Error(
      "오프라인 모임 알림톡 템플릿 코드가 없습니다. ALIGO_MEETUP_OPEN_TPL_CODE 또는 appConfig/aligo.meetup_open_tpl_code 를 확인하세요."
    );
  }

  const missing = [];
  if (!senderkey) missing.push("senderkey(ALIGO_SENDER_KEY 또는 appConfig/aligo.senderkey)");
  if (!sender) missing.push("sender(ALIGO_SENDER 또는 appConfig/aligo.sender)");
  if (!apikey) missing.push("ALIGO_API_KEY(Secret, 함수 secrets 연결 필요)");
  if (!userid) missing.push("ALIGO_USER_ID(Secret)");
  if (!token) missing.push("ALIGO_TOKEN(Secret)");
  if (missing.length) {
    throw new Error(`알리고 기본 설정 누락: ${missing.join(" · ")}`);
  }

  logAligoAuthShape("loadAligoConfigForMeetupOpen", apikey, userid, token);

  console.log(
    `[meetupAlimtalk] 설정: tpl_code=${meetupTpl}(미션 tpl과 별도) • sender 존재=${!!sender} • 테스트모드(ALIGO_ALIMTALK_TEST_MODE)=${String(process.env.ALIGO_ALIMTALK_TEST_MODE || "").toUpperCase() || "미설정"}`
  );

  return {
    senderkey,
    tpl_code: meetupTpl,
    sender,
    apikey,
    userid,
    token,
  };
}

async function sendOneMeetupOpenAlimtalk(cfg, receiverPhone, recvName, message) {
  const receiver = normalizeReceiverPhone(receiverPhone);
  if (!receiver) {
    throw new Error("수신 번호 없음");
  }
  const messageOut = message.replace(/\r?\n/g, "\r\n");

  const body = {
    senderkey: cfg.senderkey,
    tpl_code: cfg.tpl_code,
    sender: cfg.sender,
    receiver_1: receiver,
    recvname_1: safeAlimtalkDisplayName(recvName || ""),
    subject_1: MEETUP_ALIM_SUBJECT_KO,
    message_1: messageOut,
    failover: "N",
  };

  if (String(process.env.ALIGO_ALIMTALK_TEST_MODE || "").toUpperCase() === "Y") {
    body.testMode = "Y";
  }
  // 미션(UH_2120 등)용 ALIGO_ALIMTALK_EMTITLE_1 / BUTTON_1 폴백 금지 — 템플릿·버튼 개수 불일치 시 발송 실패·알리고 창 미표시 원인
  const em = String(process.env.ALIGO_MEETUP_ALIMTALK_EMTITLE_1 || "").trim();
  if (em) body.emtitle_1 = em;
  const btn = String(process.env.ALIGO_MEETUP_OPEN_BUTTON_1 || "").trim();
  if (btn) body.button_1 = btn;

  const req = { body, headers: { "content-type": "application/json" } };
  const authData = { apikey: cfg.apikey, userid: cfg.userid, token: cfg.token };
  const raw = await aligoapi.alimtalkSend(req, authData);

  if (!isAligoAlimtalkApiSuccess(raw)) {
    let detail = "";
    try {
      detail = JSON.stringify(raw);
    } catch {
      detail = String(raw);
    }
    const msg = String(raw?.message ?? raw?.Message ?? "알 수 없는 응답");
    const c = raw?.code ?? raw?.result_code;
    const hint = aligoApiFailureHint(c, msg);
    console.error("[meetupAlimtalk] alimtalkSend 실패:", detail, hint || "");
    throw new Error(`알림톡 API 실패(code=${String(c)}): ${msg}${hint}`);
  }
  const info = raw && raw.info ? raw.info : null;
  if (info != null && info.mid != null) {
    console.log(
      `[meetupAlimtalk] 전송요청 수신 tpl=${cfg.tpl_code} type=${String(info.type ?? "AT")} mid=${String(info.mid)} scnt=${info.scnt ?? ""} fcnt=${info.fcnt ?? ""}`
    );
  }
}

/**
 * inviteDisplayByPhone 키(정규화 전화번호)에서 표시 이름 조회
 */
function resolveInviteDisplayName(inviteDisplayByPhone, normalizedPhoneDigits) {
  const map = inviteDisplayByPhone && typeof inviteDisplayByPhone === "object" ? inviteDisplayByPhone : {};
  const keys = Object.keys(map);
  if (keys.length === 0) return "";
  const want = normalizedPhoneDigits;
  if (map[want] != null) return String(map[want]);
  const w8 = want.length >= 8 ? want.slice(-8) : want;
  for (const k of keys) {
    const nk = normalizePhoneDigitsServer(k);
    if (nk === want || (nk.length >= 8 && want.length >= 8 && nk.slice(-8) === w8)) {
      return String(map[k] != null ? map[k] : "");
    }
  }
  return "";
}

function resolveFriendUidFromInviteMap(inviteFriendUidByPhone, normalizedPhoneDigits) {
  const map =
    inviteFriendUidByPhone && typeof inviteFriendUidByPhone === "object"
      ? inviteFriendUidByPhone
      : {};
  const keys = Object.keys(map);
  if (keys.length === 0) return "";
  const want = normalizedPhoneDigits;
  if (map[want] != null) return String(map[want]).trim();
  const w8 = want.length >= 8 ? want.slice(-8) : want;
  for (const k of keys) {
    const nk = normalizePhoneDigitsServer(k);
    if (nk === want || (nk.length >= 8 && want.length >= 8 && nk.slice(-8) === w8)) {
      return String(map[k] != null ? map[k] : "").trim();
    }
  }
  return "";
}

/**
 * 등록 친구 UID가 있으면 users 문서의 연락처로 수신 번호 결정, 없으면 invitedList 값 사용
 */
async function resolveMeetupInviteReceiverPhone(db, normalizedDigits, inviteFriendUidByPhone) {
  const uid = resolveFriendUidFromInviteMap(inviteFriendUidByPhone, normalizedDigits);
  if (uid) {
    try {
      const snap = await db.collection("users").doc(uid).get();
      const d = snap.exists ? snap.data() : null;
      if (d) {
        const fromUser = normalizePhoneDigitsServer(getReceiverPhoneFromUserData(d));
        if (fromUser.length >= 8) return { phone: fromUser, source: "users_profile" };
      }
    } catch (e) {
      console.warn("[meetupAlimtalk] users 전화 해석 실패 uid=%s %s", uid, e && e.message ? e.message : e);
    }
  }
  if (normalizedDigits.length >= 8) return { phone: normalizedDigits, source: "invite_list" };
  return { phone: normalizedDigits, source: "invalid" };
}

/**
 * rides 문서 스냅샷 데이터로 초대 목록에게 알림톡 순차 발송
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} rideId
 * @param {Record<string, unknown>} rideData
 * @returns {Promise<{ skipped: boolean, reason?: string, attempts: Array<{ phoneTail: string, phoneLookup: string, ok: boolean, error?: string }> }>}
 */
async function sendMeetupInviteAlimtalksForNewRide(db, rideId, rideData) {
  const off = String(process.env.OPEN_RIDING_MEETUP_ALIMTALK || "1").toLowerCase();
  if (off === "0" || off === "false" || off === "no") {
    console.log("[meetupAlimtalk] OPEN_RIDING_MEETUP_ALIMTALK=0 — 건너뜀", rideId);
    return { skipped: true, reason: "disabled_by_env", attempts: [] };
  }

  const invitedList = Array.isArray(rideData.invitedList) ? rideData.invitedList : [];
  const seen = new Set();
  const phones = [];
  invitedList.forEach((x) => {
    const d = normalizePhoneDigitsServer(typeof x === "string" ? x : x && x.phone != null ? x.phone : "");
    if (d.length < 8 || seen.has(d)) return;
    seen.add(d);
    phones.push(d);
  });

  if (phones.length === 0) {
    console.log("[meetupAlimtalk] 초대 번호 없음 — 스킵", rideId);
    return { skipped: true, reason: "no_invited_phones", attempts: [] };
  }

  let cfg;
  try {
    cfg = await loadAligoConfigForMeetupOpen(db);
  } catch (e) {
    console.error("[meetupAlimtalk] 설정 로드 실패:", e && e.message ? e.message : e);
    return { skipped: true, reason: "aligo_config_error", error: e && e.message ? e.message : String(e), attempts: [] };
  }

  const meetupName = String(rideData.title || "").trim() || "라이딩 모임";
  const meetupDatetime = formatMeetupDatetimeForTemplate(rideData.date, rideData.departureTime);
  const meetingPlace = String(rideData.departureLocation || "").trim();
  const meetupLevel = String(rideData.level || "중급").trim();
  const ridingDistance = formatRidingDistanceKm(rideData.distance);
  const inviteDisplayByPhone = rideData.inviteDisplayByPhone;
  const inviteFriendUidByPhone = rideData.inviteFriendUidByPhone;

  const attempts = [];
  for (let i = 0; i < phones.length; i++) {
    const phone = phones[i];
    const resolved = await resolveMeetupInviteReceiverPhone(db, phone, inviteFriendUidByPhone);
    const recvDigits = normalizePhoneDigitsServer(resolved.phone);
    const displayFromMap = resolveInviteDisplayName(inviteDisplayByPhone, phone);
    const userName = displayFromMap || "회원";
    const message = buildMeetupOpenAlimtalkMessage({
      userName,
      meetupName,
      meetupDatetime,
      meetingPlace,
      meetupLevel,
      ridingDistance,
    });
    const attemptTail = recvDigits.length >= 4 ? recvDigits.slice(-4) : "?";
    try {
      await sendOneMeetupOpenAlimtalk(cfg, recvDigits, userName, message);
      attempts.push({
        phoneTail: attemptTail,
        phoneLookup: resolved.source,
        ok: true,
      });
      console.log(
        "[meetupAlimtalk] 전송 요청 완료 rideId=%s lookup=%s to=***%s (inviteKey …%s)",
        rideId,
        resolved.source,
        attemptTail,
        phone.slice(-4)
      );
    } catch (err) {
      const m = err && err.message ? err.message : String(err);
      attempts.push({
        phoneTail: attemptTail,
        phoneLookup: resolved.source,
        ok: false,
        error: m,
      });
      console.error("[meetupAlimtalk] 전송 실패 rideId=%s lookup=%s:", rideId, resolved.source, m);
    }
    if (i < phones.length - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const okCount = attempts.filter((a) => a.ok).length;
  return { skipped: false, attempts, sent: okCount, total: attempts.length };
}

module.exports = {
  sendMeetupInviteAlimtalksForNewRide,
  buildMeetupOpenAlimtalkMessage,
  MEETUP_ALIM_SUBJECT_KO,
  DEFAULT_MEETUP_OPEN_TPL_CODE,
};
