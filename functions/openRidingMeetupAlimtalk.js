/**
 * 오픈 라이딩 모임 생성 시 — 초대된 연락처(라이딩 친구)에게 카카오 알림톡(알리고) 발송.
 * 카카오 채널: @stelvio_ai · 승인 템플릿 코드: UH_5528 · 템플릿명: [STELVIO 오프라인 라이딩 모임 오픈 안내]
 * 대체문자: 미사용(failover N)
 *
 * tpl_code 기본값 UH_5528 — 다른 값이 필요하면 ALIGO_MEETUP_OPEN_TPL_CODE 또는 appConfig/aligo.meetup_open_tpl_code
 * 그 외 ALIGO_SENDER_KEY, ALIGO_SENDER, ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_TOKEN
 * 선택: OPEN_RIDING_MEETUP_ALIMTALK=0 으로 비활성화
 */

"use strict";

const {
  ALIMTALK_TEMPLATE,
  loadAligoAlimtalkConfig,
  safeAlimtalkDisplayNameUnified,
  sendAlimtalkUnified,
} = require("./lib/aligoAlimtalkUnified");

/**
 * 알리고 subject_1 — 알리고에 등록된 카카오 승인 템플릿 제목(대괄호 없음).
 * ※ 알리고 UH_5528 등록 제목은 "STELVIO 오프라인 라이딩 모임 안내" (오픈 없음).
 *    message_1 첫 줄(MEETUP_OPEN_HEADER_LINE)은 별도로 "[...오픈 안내]" 형식 유지.
 */
const MEETUP_ALIM_SUBJECT_KO = "STELVIO 오프라인 라이딩 모임 안내";
/**
 * 승인 템플릿 message_1 첫 줄.
 * 알리고 등록 본문 첫 줄: "[STELVIO 오프라인 라이딩 모임 오픈 안내]"
 * subject_1 과 달리 본문에는 "오픈"이 포함되어 있음 — 둘을 일치시키면 안 됨.
 */
const MEETUP_OPEN_HEADER_LINE = "[STELVIO 오프라인 라이딩 모임 오픈 안내]";

/** 승인 템플릿 코드(운영 기본). env·Firestore로 덮어쓰기 가능 */
const DEFAULT_MEETUP_OPEN_TPL_CODE = "UH_5528";

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

/** Firestore Timestamp | Date | string | 직렬화된 {_seconds} → 서울 달력 YYYY-MM-DD */
function toYmdSeoulFromRideDate(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const s = value.trim();
    // YYYY-MM-DD
    const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
    // M/D/YY, MM/DD/YYYY, M/D/YYYY
    const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m2) {
      const yyyy = m2[3].length === 2 ? `20${m2[3]}` : m2[3];
      return `${yyyy}-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}`;
    }
  }
  // Firestore Timestamp 직렬화 형태 { _seconds: number, _nanoseconds: number }
  if (value && typeof value === "object" && typeof value._seconds === "number") {
    const d = new Date(value._seconds * 1000);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
    }
  }
  // Firestore Timestamp (live 인스턴스)
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
    }
  }
  // JS Date 객체
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
  // "40km" 처럼 단위가 붙은 문자열 → 숫자만 추출 후 파싱
  const raw = String(n ?? "").replace(/[^\d.]/g, "");
  const x = raw !== "" ? Number(raw) : Number(n);
  if (!Number.isFinite(x) || x <= 0) return "0km";
  if (Number.isInteger(x)) return `${x}km`;
  return `${Math.round(x * 10) / 10}km`;
}

/**
 * 카카오 승인 본문을 문자·공백·줄바꿈까지 완벽히 재현.
 * 헤더 문자열은 변수를 거치지 않고 리터럴에 직접 삽입하여 인코딩 오염 차단.
 * meetup_level: 폼에 저장된 문자열 그대로 (예: 중급(28~32km/h))
 */
function buildMeetupOpenAlimtalkMessage(vars) {
  const userName = safeAlimtalkDisplayNameUnified(vars.userName);
  const meetupName = String(vars.meetupName || "").trim() || "라이딩 모임";
  const meetupDatetime = String(vars.meetupDatetime || "").trim();
  const meetingPlace = String(vars.meetingPlace || "").trim() || "-";
  const meetupLevel = String(vars.meetupLevel || "").trim() || "-";
  const ridingDistance = String(vars.ridingDistance || "").trim() || "0km";

  // ─────────────────────────────────────────────────────────────────
  // 아래 리터럴은 카카오 승인 템플릿(UH_5528) 본문과 1:1 대응.
  // 들여쓰기·공백·줄바꿈을 절대 변경하지 말 것.
  // ─────────────────────────────────────────────────────────────────
  const raw = `[STELVIO 오프라인 라이딩 모임 오픈 안내]

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

  // \r\n → \n 정규화 (Windows 환경 소스 저장 시 CRLF 혼입 방지)
  // 최종 줄바꿈 형식(LF/CRLF)은 sendAlimtalkUnified 에서 templateKind별로 결정
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
 * 등록 친구 UID가 있으면 users 문서의 연락처·성명으로 수신 번호·표시 이름 결정,
 * 없으면 invitedList 값 사용.
 * @returns {{ phone: string, source: string, nameFromProfile: string }}
 */
async function resolveMeetupInviteReceiverPhone(db, normalizedDigits, inviteFriendUidByPhone) {
  const uid = resolveFriendUidFromInviteMap(inviteFriendUidByPhone, normalizedDigits);
  if (uid) {
    try {
      const snap = await db.collection("users").doc(uid).get();
      const d = snap.exists ? snap.data() : null;
      if (d) {
        const fromUser = normalizePhoneDigitsServer(getReceiverPhoneFromUserData(d));
        const nameFromProfile = String(d.name || d.user_name || d.displayName || "").trim();
        if (fromUser.length >= 8) {
          return { phone: fromUser, source: "users_profile", nameFromProfile };
        }
      }
    } catch (e) {
      console.warn("[meetupAlimtalk] users 전화 해석 실패 uid=%s %s", uid, e && e.message ? e.message : e);
    }
  }
  if (normalizedDigits.length >= 8) return { phone: normalizedDigits, source: "invite_list", nameFromProfile: "" };
  return { phone: normalizedDigits, source: "invalid", nameFromProfile: "" };
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
    cfg = await loadAligoAlimtalkConfig(db, ALIMTALK_TEMPLATE.MEETUP_OFFLINE_OPEN);
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
    // 이름 우선순위: ① inviteDisplayByPhone(초대 시 입력) ② users 프로필 성명 ③ "회원"
    const displayFromMap = resolveInviteDisplayName(inviteDisplayByPhone, phone);
    const userName = displayFromMap || resolved.nameFromProfile || "회원";
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
      await sendAlimtalkUnified(cfg, {
        receiverPhone: recvDigits,
        displayName: userName,
        subject: MEETUP_ALIM_SUBJECT_KO,
        message,
        templateKind: ALIMTALK_TEMPLATE.MEETUP_OFFLINE_OPEN,
        logTag: "[meetupAlimtalk]",
      });
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
