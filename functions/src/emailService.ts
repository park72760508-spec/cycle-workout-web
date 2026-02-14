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

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
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

/**
 * 네이버 구독 매칭 실패 건 요약 리포트
 */
export async function sendMatchingFailureReport(
  failures: Array<{
    productOrderId: string;
    orderId?: string;
    optionPhoneOrId: string | null;
    ordererTel: string | null;
    reason: string;
  }>
): Promise<boolean> {
  if (failures.length === 0) return true;

  const lines = failures.map(
    (f) =>
      `- productOrderId: ${f.productOrderId}, orderId: ${f.orderId || "-"}\n  옵션입력: ${f.optionPhoneOrId || "-"}, 주문자연락처: ${f.ordererTel || "-"}\n  사유: ${f.reason}`
  );

  return sendErrorReport({
    subject: `[STELVIO AI] 네이버 구독 매칭 실패 ${failures.length}건`,
    to: ERROR_REPORT_TO,
    body: `다음 주문에서 사용자 매칭에 실패했습니다.\n\n${lines.join("\n\n")}\n\n발생 시각: ${new Date().toISOString()}`,
  });
}
