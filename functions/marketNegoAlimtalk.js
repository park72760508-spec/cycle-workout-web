/**
 * 중고랜드 — "거래 진행 상황 안내" 카카오 알림톡(알리고) 발송. 판매자 수신.
 * 카카오 채널: @stelvio_ai · 승인 템플릿 코드: UK_6794 · 템플릿명: STELVIO 중고랜드 거래 진행 상황 안내
 * 대체문자: 미사용(failover N) — competitionApplyAlimtalk.js와 동일 규칙을 참고해 구현.
 *
 * 이 템플릿은 "거래 진행 상황 안내"라는 범용 제목으로 승인되어 #{진행내용} 한 슬롯에 여러 단계
 * 안내문을 갈아끼우는 구조다. 현재 구현된 진행내용: 가격 조정 요구(buildMarketNegoProgressLine),
 * 직거래 요청 접수(MARKET_DIRECT_DEAL_PROGRESS_LINE), 안전결제 입금 확인
 * (MARKET_PAYMENT_CONFIRMED_PROGRESS_LINE), 가격 조정 요구 수락/거절(buildMarketNegoDecisionProgressLine).
 * 새 단계(구매확정 등)를 추가하려면 그 단계 전용 progressContent만 만들어 buildMarketAlimtalkMessage에
 * 넘기면 된다.
 *
 * tpl_code 기본값 UK_6794 — 다른 값이 필요하면 ALIGO_MARKET_NEGO_TPL_CODE 또는
 * appConfig/aligo.market_nego_tpl_code 로 덮어쓴다.
 * 그 외 계정 정보(ALIGO_SENDER_KEY, ALIGO_SENDER, ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_TOKEN)는
 * 대회·모임·미션 알림톡과 동일한 알리고 계정을 공유한다.
 */

"use strict";

const { scrubAligoCredential } = require("./lib/aligoCredentials");

const APP_CONFIG_COLLECTION = "appConfig";
const ALIGO_CONFIG_DOC = "aligo";

/** 알리고에 등록된 카카오 승인 템플릿 제목(대괄호 없음) — 본문 첫 줄과는 별도로 관리 */
const MARKET_NEGO_ALIM_SUBJECT_KO = "STELVIO 중고랜드 거래 진행 상황 안내";
/** 승인 템플릿 message_1 첫 줄 */
const MARKET_NEGO_ALIM_HEADER_LINE = "[STELVIO 중고랜드 거래 진행 상황 안내]";
/** 승인 템플릿 코드(운영 기본). env·Firestore로 덮어쓰기 가능 */
const DEFAULT_MARKET_NEGO_TPL_CODE = "UK_6794";

/**
 * 승인 템플릿 하단 버튼("거래 내역 확인") — 카카오 알림톡은 등록된 템플릿에 버튼이 있으면
 * 발송 메시지에도 동일 버튼이 실려야 통과된다(버튼 누락 시 "메시지가 템플릿과 일치하지않음").
 * ⚠️ name은 카카오 채널 관리자 센터에 등록된 버튼명과 한 글자도 다르면 안 된다("거래 내역 확인" 그대로).
 * linkType·URL은 실제 등록값과 다를 수 있으니(중고랜드는 URL 딥링크를 지원하지 않아 우선 사이트
 * 루트로 둠), 다르면 ALIGO_MARKET_NEGO_BUTTON_1(env) 또는 appConfig/aligo.market_nego_button_1
 * (Firestore, JSON 문자열)로 정확한 값을 덮어쓴다.
 */
const DEFAULT_MARKET_NEGO_BUTTON_1 = JSON.stringify({
  button: [
    {
      name: "거래 내역 확인",
      linkType: "WL",
      linkTypeName: "웹링크",
      linkMo: "https://stelvio.ai.kr",
      linkPc: "https://stelvio.ai.kr",
    },
  ],
});

function formatMarketAmountKo(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString("ko-KR");
}

/** 카테고리 표시 — 예: "CYCLE / 완차", "RUN / 러닝화" */
function formatMarketCategoryKo(category, subCategory) {
  const cat = String(category || "").toUpperCase() === "RUN" ? "RUN" : "CYCLE";
  const sub = String(subCategory || "").trim();
  return sub ? `${cat} / ${sub}` : cat;
}

/** 거래 방식 표시 — deal_method(택배거래/직거래) + negotiable(네고 가능) 중 실제 선택된 항목만 나열 */
function formatMarketDealTypeKo(dealMethod, negotiable) {
  const parts = (Array.isArray(dealMethod) ? dealMethod : []).filter(Boolean);
  if (negotiable) parts.push("네고 가능");
  return parts.join(", ");
}

/** #{진행내용} — 가격 조정 요구 단계 전용 한 줄. "판매가격 >> 희망가격" 형식 */
function buildMarketNegoProgressLine(originalPrice, requestedPrice) {
  return `가격 조정 요구 : ${formatMarketAmountKo(originalPrice)}원 >> ${formatMarketAmountKo(requestedPrice)}원`;
}

/** #{진행내용} — 직거래 요청 접수 단계 전용 고정 문구 */
const MARKET_DIRECT_DEAL_PROGRESS_LINE = "직거래 요청이 접수 되었습니다.";

/** #{진행내용} — 안전결제 가상계좌 입금 확인 단계 전용 고정 문구(공백 포함 등록 문구 그대로) */
const MARKET_PAYMENT_CONFIRMED_PROGRESS_LINE =
  "입금이 정상적으로 확인되었습니다.    판매상품에 대해서 택배발송을 진행해 주시고, 송장정보를 입력해주세요.";

/** #{진행내용} — 택배 배송완료 단계 전용 고정 문구(공백 포함 등록 문구 그대로), 구매자 수신 */
const MARKET_DELIVERY_COMPLETED_PROGRESS_LINE =
  "상품 배송이 완료되었습니다. \n상품 수령 후 상품 상세 화면에서 [구매 확정]을 진행해 주세요.";

/** #{진행내용} — 판매자가 가격 조정 요구를 수락/거절한 직후 단계(공백 포함 등록 문구 그대로) */
function buildMarketNegoDecisionProgressLine(accept) {
  if (accept) {
    return (
      "요청하신 가격 조정요구가 수락되었습니다.    \n" +
      "조정된 가격에 대해 가상계좌에 입금을 진행해 주시기 바랍니다."
    );
  }
  return (
    "요청하신 가격 조정요구가 거절되었습니다.    \n" +
    "가격 조정 요구를 변경하여 재요청 하시기 바랍니다."
  );
}

/**
 * 승인 템플릿(UK_6794) 본문(message_1) 조립 — #{변수} 값만 실제 데이터로 치환, 문구 자체는 그대로
 * 유지. #{진행내용}(progressContent)은 이벤트 종류별로 호출측이 만들어 넘긴다 — 가격 조정 요구는
 * buildMarketNegoProgressLine, 직거래 요청 접수는 MARKET_DIRECT_DEAL_PROGRESS_LINE 등. 이 템플릿은
 * "거래 진행 상황 안내"라는 범용 제목으로 승인되어 있어, 새 단계(수락/거절/구매확정 등)를 추가하려면
 * 그 단계 전용 progressContent만 만들어 이 함수에 그대로 넘기면 된다.
 * #{고객명}(recipientName)은 이 알림톡을 받는 사람의 이름이다 — 이벤트에 따라 판매자일 수도(가격
 * 조정 요구/직거래 요청 접수/입금 확인) 구매자일 수도(가격 조정 수락/거절) 있다.
 * @param {{
 *   recipientName: string, itemName: string, category: string, subCategory: string,
 *   dealMethod: string[], negotiable: boolean, progressContent: string
 * }} p
 */
function buildMarketAlimtalkMessage(p) {
  const recipientName = String(p.recipientName || "회원").trim();
  const itemName = String(p.itemName || "").trim();
  const categoryText = formatMarketCategoryKo(p.category, p.subCategory);
  const dealTypeText = formatMarketDealTypeKo(p.dealMethod, p.negotiable);
  const progressContent = String(p.progressContent || "").trim();

  return (
    `${MARKET_NEGO_ALIM_HEADER_LINE}\n\n` +
    `${recipientName}님, 안전하고 스마트한 STELVIO 중고랜드입니다.\n` +
    `요청하신 거래의 진행 상황을 안내해 드립니다.\n\n` +
    `■ 상품 및 거래 정보\n` +
    `- 상품명: ${itemName}\n` +
    `- 카테고리: ${categoryText}\n` +
    `- 거래 방식: ${dealTypeText}\n\n` +
    `■ 단계별 안내 내용\n` +
    `${progressContent}\n\n` +
    `자세한 내역 및 상세 확인은 하단 버튼을 통해  확인하실 수 있습니다.\n\n` +
    `감사합니다.`
  );
}

/**
 * 중고랜드 알림톡 전용 알리고 설정 로드 — 대회·모임·미션과 계정(senderkey/sender/apikey/userid/token)은
 * 공유하고 tpl_code만 별도(UK_6794 계열)로 관리한다. button_1은 DEFAULT_MARKET_NEGO_BUTTON_1이 기본
 * 적용되며, 실제 등록된 버튼 정보와 다르면 ALIGO_MARKET_NEGO_BUTTON_1(env) 또는
 * appConfig/aligo.market_nego_button_1(Firestore)로 덮어쓴다.
 */
async function loadMarketAlimtalkConfig(db) {
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
    process.env.ALIGO_MARKET_NEGO_TPL_CODE ||
      appConfig.market_nego_tpl_code ||
      appConfig.marketNegoTplCode ||
      DEFAULT_MARKET_NEGO_TPL_CODE
  );

  const button1 = String(
    process.env.ALIGO_MARKET_NEGO_BUTTON_1 ||
      appConfig.market_nego_button_1 ||
      appConfig.marketNegoButton1 ||
      DEFAULT_MARKET_NEGO_BUTTON_1
  ).trim();

  const missing = [];
  if (!senderkey) missing.push("senderkey(ALIGO_SENDER_KEY 또는 appConfig/aligo.senderkey)");
  if (!sender) missing.push("sender(ALIGO_SENDER 또는 appConfig/aligo.sender)");
  if (!tplCode) missing.push("tpl_code(ALIGO_MARKET_NEGO_TPL_CODE 또는 appConfig/aligo.market_nego_tpl_code)");
  if (!apikey) missing.push("ALIGO_API_KEY(Secret, 카카오톡 API 발급키)");
  if (!userid) missing.push("ALIGO_USER_ID(Secret 또는 appConfig/aligo.identifier)");
  if (!token) missing.push("ALIGO_TOKEN(Secret, 카카오톡 API token)");
  if (missing.length) {
    throw new Error(`중고랜드 알림톡 설정 누락: ${missing.join(" · ")}`);
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
  MARKET_NEGO_ALIM_SUBJECT_KO,
  MARKET_NEGO_ALIM_HEADER_LINE,
  DEFAULT_MARKET_NEGO_TPL_CODE,
  MARKET_DIRECT_DEAL_PROGRESS_LINE,
  MARKET_PAYMENT_CONFIRMED_PROGRESS_LINE,
  MARKET_DELIVERY_COMPLETED_PROGRESS_LINE,
  buildMarketNegoDecisionProgressLine,
  formatMarketAmountKo,
  formatMarketCategoryKo,
  formatMarketDealTypeKo,
  buildMarketNegoProgressLine,
  buildMarketAlimtalkMessage,
  loadMarketAlimtalkConfig,
};
