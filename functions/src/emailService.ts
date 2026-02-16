/**
 * STELVIO AI - 실패 건 이메일 알림
 * 매칭 실패 등 에러 리포트를 stelvio.ai.kr@gmail.com 으로 발송
 */
import * as nodemailer from "nodemailer";

const ERROR_REPORT_TO = "stelvio.ai.kr@gmail.com";
const DEFAULT_FROM = "stelvio.ai.kr@gmail.com";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const user = process.env.SMTP_USER || process.env.NAVER_MAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.NAVER_MAIL_PASS;

  if (!user || !pass) {
    console.warn(
      "[emailService] SMTP 미설정: SMTP_USER/SMTP_PASS 또는 NAVER_MAIL_USER/NAVER_MAIL_PASS 를 설정하면 에러 리포트 메일이 발송됩니다."
    );
    return null;
  }

  const useNaverMail = !!process.env.NAVER_MAIL_USER && !process.env.SMTP_HOST;
  const host = process.env.SMTP_HOST || (useNaverMail ? "smtp.naver.com" : "smtp.gmail.com");
  const port = Number(process.env.SMTP_PORT) || 587;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });

  return transporter;
}

export interface ErrorReportPayload {
  subject: string;
  body: string;
  to?: string;
}

/**
 * 에러 리포트 메일 발송.
 * SMTP 설정이 없으면 로그만 남기고 완료 처리.
 */
export async function sendErrorReport(payload: ErrorReportPayload): Promise<boolean> {
  const to = payload.to || ERROR_REPORT_TO;
  const trans = getTransporter();

  if (!trans) {
    console.error("[emailService] 에러 리포트(메일 미발송):", payload.subject, payload.body);
    return false;
  }

  try {
    await trans.sendMail({
      from: process.env.SMTP_FROM || DEFAULT_FROM,
      to,
      subject: payload.subject,
      text: payload.body,
      html: payload.body.replace(/\n/g, "<br>\n"),
    });
    console.log("[emailService] 에러 리포트 발송 완료:", payload.subject);
    return true;
  } catch (err) {
    console.error("[emailService] 메일 발송 실패:", err);
    return false;
  }
}

/** 실패한 주문 번호·시도한 연락처·사유를 포함한 알림 이메일 (stelvio.ai.kr@gmail.com) */
export interface FailureEmailPayload {
  productOrderId: string;
  orderId?: string;
  ordererName?: string | null;
  ordererTel?: string | null;
  shippingMemo?: string | null;
  triedNumbers?: string[];
  reason: string;
}

/**
 * 유저 매칭 실패 시 stelvio.ai.kr@gmail.com 으로 실패한 주문 번호·옵션 정보 알림 발송
 */
export async function sendFailureEmail(failures: FailureEmailPayload[]): Promise<boolean> {
  if (failures.length === 0) return true;

  const lines = failures.map((f) => {
    const triedLabel =
      f.triedNumbers && f.triedNumbers.length >= 3
        ? `시도 번호: [1순위: ${f.triedNumbers[0]}, 2순위: ${f.triedNumbers[1]}, 3순위: ${f.triedNumbers[2]}]`
        : f.triedNumbers && f.triedNumbers.length > 0
          ? `시도 번호: ${f.triedNumbers.join(", ")}`
          : "시도 번호: -";
    return `- 주문번호(productOrderId): ${f.productOrderId}, orderId: ${f.orderId || "-"}\n  주문자: ${f.ordererName || "-"}, 주문자연락처: ${f.ordererTel || "-"}, 배송메모: ${f.shippingMemo || "-"}\n  ${triedLabel}\n  사유: ${f.reason}`;
  });

  return sendErrorReport({
    subject: `[STELVIO AI] 네이버 구독 매칭 실패 ${failures.length}건`,
    to: ERROR_REPORT_TO,
    body: `다음 주문에서 사용자 매칭에 실패했습니다.\n\n${lines.join("\n\n")}\n\n발생 시각: ${new Date().toISOString()}`,
  });
}

/** @deprecated sendFailureEmail 사용 권장 */
export async function sendMatchingFailureReport(
  failures: Array<{
    productOrderId: string;
    orderId?: string;
    optionPhoneOrId: string | null;
    ordererTel: string | null;
    reason: string;
  }>
): Promise<boolean> {
  return sendFailureEmail(failures);
}
