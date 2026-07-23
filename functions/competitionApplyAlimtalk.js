/**
 * 대회(CYCLE·RUN) 신청 접수 — 카카오 알림톡(알리고) 발송.
 * 카카오 채널: @stelvio_ai · 승인 템플릿 코드: UJ_6279 · 템플릿명: STELVIO 대회 신청 접수 안내
 * 대체문자: 미사용(failover N) — openRidingMeetupAlimtalk.js와 동일 규칙(모임 알림톡)을 참고해 구현.
 *
 * tpl_code 기본값 UJ_6279 — 다른 값이 필요하면 ALIGO_COMPETITION_TPL_CODE 또는
 * appConfig/aligo.competition_tpl_code 로 덮어쓴다.
 * 그 외 계정 정보(ALIGO_SENDER_KEY, ALIGO_SENDER, ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_TOKEN)는
 * 모임·미션 알림톡과 동일한 알리고 계정을 공유한다.
 */

"use strict";

const { scrubAligoCredential } = require("./lib/aligoCredentials");

const APP_CONFIG_COLLECTION = "appConfig";
const ALIGO_CONFIG_DOC = "aligo";

/** 알리고에 등록된 카카오 승인 템플릿 제목(대괄호 없음) — 본문 첫 줄과는 별도로 관리 */
const COMPETITION_APPLY_ALIM_SUBJECT_KO = "STELVIO 대회 신청 접수 안내";
/** 승인 템플릿 message_1 첫 줄 */
const COMPETITION_APPLY_ALIM_HEADER_LINE = "[STELVIO 대회 신청 접수 안내]";
/** 승인 템플릿 코드(운영 기본). env·Firestore로 덮어쓰기 가능 */
const DEFAULT_COMPETITION_APPLY_TPL_CODE = "UJ_6279";

/**
 * 승인 템플릿 하단 버튼("대회 접수 확인") — 카카오 알림톡은 등록된 템플릿에 버튼이 있으면
 * 발송 메시지에도 동일 버튼이 실려야 통과된다(버튼 누락 시 "메시지가 템플릿과 일치하지않음").
 * ⚠️ name은 카카오 채널 관리자 센터에 등록된 버튼명과 한 글자도 다르면 안 된다("대회 접수 확인" 그대로).
 * linkType·URL은 실제 등록값과 다를 수 있으니, 다르면 ALIGO_COMPETITION_BUTTON_1(env) 또는
 * appConfig/aligo.competition_button_1(Firestore, JSON 문자열)로 정확한 값을 덮어쓴다.
 */
const DEFAULT_COMPETITION_APPLY_BUTTON_1 = JSON.stringify({
  button: [
    {
      name: "대회 접수 확인",
      linkType: "WL",
      linkTypeName: "웹링크",
      linkMo: "https://stelvio.ai.kr",
      linkPc: "https://stelvio.ai.kr",
    },
  ],
});

/**
 * Toss 가상계좌 발급 은행 코드 → 한글명. https://docs.tosspayments.com/codes/org-codes 공식 표 기준.
 * assets/js/competition/competitionBottomSheet.js의 BANK_OPTIONS와 동일 목록(단일 출처 아님 — 함께 유지 필요).
 * Toss 응답(virtualAccount)에는 은행 "이름" 필드가 없고 bankCode만 내려오므로 여기서 직접 매핑한다.
 */
const TOSS_BANK_CODE_NAME_KO = {
  "20": "우리은행",
  "81": "KEB하나은행",
  "88": "신한은행",
  "06": "KB국민은행",
  "11": "NH농협은행",
  "90": "카카오뱅크",
  "92": "토스뱅크",
  "03": "IBK기업은행",
};

/** bankCode → 한글 은행명. 알 수 없는 코드는 코드 그대로 반환(빈 문자열보다 원인 파악에 유리) */
function resolveBankNameKo(bankCode) {
  const code = String(bankCode || "").trim();
  if (!code) return "";
  return TOSS_BANK_CODE_NAME_KO[code] || code;
}

const RACE_DIVISION_LABEL_KO = {
  FULL: "풀코스",
  HALF: "하프코스",
  "10K": "10K",
  "5K": "5K",
  GRANFONDO: "그란폰도",
  MEDIOFONDO: "메디오폰도",
};

/** 종목/부문 표시 — 예: "RUN 풀코스", "CYCLE 그란폰도" */
function formatCompetitionDivisionKo(category, division) {
  const cat = String(category || "").toUpperCase() === "CYCLE" ? "CYCLE" : "RUN";
  const label = RACE_DIVISION_LABEL_KO[String(division || "").toUpperCase()] || String(division || "").trim();
  return label ? `${cat} ${label}` : cat;
}

function formatCompetitionAmountKo(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString("ko-KR");
}

/** 입금 기한 — Toss issueVirtualAccount 응답의 dueDate(ISO)를 한국어 표기로 변환 */
function formatPaymentDueDateKo(dueDateRaw) {
  if (!dueDateRaw) return "";
  const d = new Date(dueDateRaw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 승인 템플릿 본문(message_1) 조립 — #{변수} 값만 실제 데이터로 치환, 문구 자체는 그대로 유지.
 * @param {{
 *   userName: string, competitionName: string, competitionDivision: string, applicantName: string,
 *   paymentAmount: number|string, bankName: string, accountNumber: string, accountHolderName: string,
 *   paymentDueDate: string
 * }} p
 */
function buildCompetitionApplyAlimtalkMessage(p) {
  const userName = String(p.userName || "회원").trim();
  const competitionName = String(p.competitionName || "").trim();
  const competitionDivision = String(p.competitionDivision || "").trim();
  const applicantName = String(p.applicantName || "").trim();
  const paymentAmount = formatCompetitionAmountKo(p.paymentAmount);
  const bankName = String(p.bankName || "").trim();
  const accountNumber = String(p.accountNumber || "").trim();
  const accountHolderName = String(p.accountHolderName || "").trim();
  const paymentDueDate = String(p.paymentDueDate || "").trim();

  return (
    `${COMPETITION_APPLY_ALIM_HEADER_LINE}\n\n` +
    `안녕하세요 ${userName}님,\n` +
    `STELVIO를 통해 신청해 주신 대회 접수가 정상적으로 완료되어 안내해 드립니다.\n\n` +
    `▶ 신청 대회 정보\n` +
    `대회명 : ${competitionName}\n` +
    `종목/부문 : ${competitionDivision}\n` +
    `참가자명 : ${applicantName}\n\n` +
    `▶ 결제(가상계좌) 정보\n` +
    `결제 금액 : ${paymentAmount}원\n` +
    `입금 은행 : ${bankName}\n` +
    `계좌 번호 : ${accountNumber}\n` +
    `예금주 : ${accountHolderName}\n\n` +
    `▶ 입금 기한\n` +
    `${paymentDueDate}까지 입금이 확인되지 않으면 위 가상계좌는 자동으로 소멸되며, 대회 신청은 자동 취소 처리됩니다.\n\n` +
    `입금 시에는 반드시 안내된 결제 금액과 동일한 금액을 정확히 입금해 주시기 바랍니다. 금액이 다를 경우 입금 확인이 지연되거나 처리되지 않을 수 있습니다.\n\n` +
    `신청 내역 및 입금 확인 상태는 STELVIO 앱/웹에서 확인 가능합니다.\n\n` +
    `※ 본 메시지는 STELVIO 대회 참가를 신청하신 회원님께 발송되는 정보성 안내입니다.`
  );
}

/**
 * 대회 신청 알림톡 전용 알리고 설정 로드 — 미션·모임과 계정(senderkey/sender/apikey/userid/token)은 공유하고
 * tpl_code만 별도(UJ_6279 계열)로 관리한다. button_1은 DEFAULT_COMPETITION_APPLY_BUTTON_1이 기본 적용되며,
 * 실제 등록된 버튼 정보와 다르면 ALIGO_COMPETITION_BUTTON_1(env) 또는
 * appConfig/aligo.competition_button_1(Firestore)로 덮어쓴다.
 */
async function loadCompetitionAlimtalkConfig(db) {
  const appConfigSnap = await db.collection(APP_CONFIG_COLLECTION).doc(ALIGO_CONFIG_DOC).get();
  const appConfig = appConfigSnap.exists ? appConfigSnap.data() || {} : {};

  const senderkey = scrubAligoCredential(
    process.env.ALIGO_SENDER_KEY || appConfig.senderkey || appConfig.senderKey || ""
  );
  const sender = scrubAligoCredential(process.env.ALIGO_SENDER || appConfig.sender || "");
  const useridCfg = scrubAligoCredential(appConfig.userid ?? appConfig.userId ?? appConfig.identifier ?? "");
  const apikey = scrubAligoCredential(process.env.ALIGO_API_KEY);
  const useridEnv = scrubAligoCredential(process.env.ALIGO_USER_ID);
  const token = scrubAligoCredential(process.env.ALIGO_TOKEN);
  const userid = useridEnv || useridCfg;

  const tplCode = scrubAligoCredential(
    process.env.ALIGO_COMPETITION_TPL_CODE ||
      appConfig.competition_tpl_code ||
      appConfig.competitionTplCode ||
      DEFAULT_COMPETITION_APPLY_TPL_CODE
  );

  const button1 = String(
    process.env.ALIGO_COMPETITION_BUTTON_1 ||
      appConfig.competition_button_1 ||
      appConfig.competitionButton1 ||
      DEFAULT_COMPETITION_APPLY_BUTTON_1
  ).trim();

  const missing = [];
  if (!senderkey) missing.push("senderkey(ALIGO_SENDER_KEY 또는 appConfig/aligo.senderkey)");
  if (!sender) missing.push("sender(ALIGO_SENDER 또는 appConfig/aligo.sender)");
  if (!tplCode) missing.push("tpl_code(ALIGO_COMPETITION_TPL_CODE 또는 appConfig/aligo.competition_tpl_code)");
  if (!apikey) missing.push("ALIGO_API_KEY(Secret, 카카오톡 API 발급키)");
  if (!userid) missing.push("ALIGO_USER_ID(Secret 또는 appConfig/aligo.identifier)");
  if (!token) missing.push("ALIGO_TOKEN(Secret, 카카오톡 API token)");
  if (missing.length) {
    throw new Error(`대회 신청 알림톡 설정 누락: ${missing.join(" · ")}`);
  }

  return {
    senderkey,
    tpl_code: tplCode,
    sender,
    apikey,
    userid,
    token,
    ...(button1 ? { button_1: button1 } : {}),
  };
}

module.exports = {
  COMPETITION_APPLY_ALIM_SUBJECT_KO,
  COMPETITION_APPLY_ALIM_HEADER_LINE,
  DEFAULT_COMPETITION_APPLY_TPL_CODE,
  resolveBankNameKo,
  formatCompetitionDivisionKo,
  formatCompetitionAmountKo,
  formatPaymentDueDateKo,
  buildCompetitionApplyAlimtalkMessage,
  loadCompetitionAlimtalkConfig,
};
