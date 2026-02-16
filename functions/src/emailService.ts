/**
 * STELVIO AI - 시스템 알림 이메일
 * 발송: 네이버 SMTP (dud623@naver.com), 수신: 관리자 Gmail (ADMIN_EMAIL)
 * 네이버 SMTP 보안 정책상 from 필드는 반드시 발송 계정(SMTP_USER)이어야 함.
 */
import * as nodemailer from "nodemailer";

const SMTP_HOST_DEFAULT = "smtp.naver.com";
const SMTP_PORT_DEFAULT = 465;
const ADMIN_EMAIL_DEFAULT = "stelvio.ai.kr@gmail.com";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.warn(
      "[emailService] SMTP 미설정: SMTP_USER, SMTP_PASS, ADMIN_EMAIL 을 설정하면 시스템 알림 메일이 발송됩니다."
    );
    return null;
  }

  const host = process.env.SMTP_HOST || SMTP_HOST_DEFAULT;
  const port = Number(process.env.SMTP_PORT) || SMTP_PORT_DEFAULT;
  const secure = port === 465;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return transporter;
}

/** 수신 계정 (관리자 Gmail). 환경 변수 ADMIN_EMAIL 우선 */
function getAdminEmail(): string {
  return process.env.ADMIN_EMAIL || ADMIN_EMAIL_DEFAULT;
}

/** 발송자 주소. 네이버 정책상 반드시 발송 계정(SMTP_USER) 사용 */
function getFromAddress(): string {
  const user = process.env.SMTP_USER;
  if (user) return `"STELVIO AI" <${user}>`;
  return `"STELVIO AI" <${ADMIN_EMAIL_DEFAULT}>`;
}

export interface ErrorReportPayload {
  /** 제목에 들어갈 에러 유형 (예: 매칭 실패, 취소 처리 실패) */
  errorType: string;
  /** 본문 텍스트 (HTML 없이 사용 시) */
  body?: string;
  /** HTML 본문 (지정 시 body 대신 사용) */
  html?: string;
  /** 수신자 (미지정 시 ADMIN_EMAIL) */
  to?: string;
}

/**
 * 시스템 알림 메일 발송.
 * 제목: [STELVIO AI] 시스템 알림 - {errorType}
 * SMTP 미설정 시 로그만 남기고 완료 처리.
 */
export async function sendErrorReport(payload: ErrorReportPayload): Promise<boolean> {
  const to = payload.to || getAdminEmail();
  const trans = getTransporter();

  if (!trans) {
    console.error("[emailService] 시스템 알림(메일 미발송):", payload.errorType, payload.body ?? payload.html?.slice(0, 200));
    return false;
  }

  const subject = `[STELVIO AI] 시스템 알림 - ${payload.errorType}`;
  const html = payload.html ?? (payload.body ? payload.body.replace(/\n/g, "<br>\n") : "");

  try {
    await trans.sendMail({
      from: getFromAddress(),
      to,
      subject,
      text: payload.body ?? payload.html?.replace(/<[^>]+>/g, " ") ?? "",
      html: html || undefined,
    });
    console.log("[emailService] 시스템 알림 발송 완료:", subject);
    return true;
  } catch (err) {
    console.error("[emailService] 메일 발송 실패:", err);
    return false;
  }
}

/** 실패한 주문 번호·시도한 연락처·사유 (매칭 실패 알림용) */
export interface FailureEmailPayload {
  productOrderId: string;
  orderId?: string;
  ordererName?: string | null;
  ordererTel?: string | null;
  shippingMemo?: string | null;
  triedNumbers?: string[];
  reason: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 유저 매칭 실패 시 관리자에게 HTML 메일 발송.
 * 발생 시각, 주문번호, 시도한 연락처(1~3순위), 매칭 실패 사유 포함.
 */
export async function sendFailureEmail(failures: FailureEmailPayload[]): Promise<boolean> {
  if (failures.length === 0) return true;

  const occurredAt = new Date();
  const occurredStr = occurredAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  const rows = failures.map((f) => {
    const tried =
      f.triedNumbers && f.triedNumbers.length >= 3
        ? `1순위: ${escapeHtml(f.triedNumbers[0])}, 2순위: ${escapeHtml(f.triedNumbers[1])}, 3순위: ${escapeHtml(f.triedNumbers[2])}`
        : f.triedNumbers?.length
          ? escapeHtml(f.triedNumbers.join(", "))
          : "-";
    return `
      <tr>
        <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(f.productOrderId)}</td>
        <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(String(f.orderId ?? "-"))}</td>
        <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(String(f.ordererName ?? "-"))}</td>
        <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(String(f.ordererTel ?? "-"))}</td>
        <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(String(f.shippingMemo ?? "-"))}</td>
        <td style="border:1px solid #ddd;padding:8px;">${tried}</td>
        <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(f.reason)}</td>
      </tr>`;
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: sans-serif; margin: 16px; }
    table { border-collapse: collapse; width: 100%; }
    th { background: #f0f0f0; border: 1px solid #ddd; padding: 8px; text-align: left; }
  </style>
</head>
<body>
  <h2>[STELVIO AI] 네이버 구독 매칭 실패 알림</h2>
  <p><strong>발생 시각:</strong> ${escapeHtml(occurredStr)} (KST)</p>
  <p><strong>실패 건수:</strong> ${failures.length}건</p>
  <table>
    <thead>
      <tr>
        <th>productOrderId</th>
        <th>orderId</th>
        <th>주문자명</th>
        <th>주문자 연락처</th>
        <th>배송 메모</th>
        <th>시도한 연락처 (1~3순위)</th>
        <th>매칭 실패 사유</th>
      </tr>
    </thead>
    <tbody>${rows.join("")}
    </tbody>
  </table>
</body>
</html>`;

  return sendErrorReport({
    errorType: `매칭 실패 ${failures.length}건`,
    html,
    to: getAdminEmail(),
  });
}

/**
 * 취소/반품(구독 회수) 처리 실패 시 관리자에게 알림 발송.
 */
export async function sendRevokeFailureReport(
  productOrderId: string,
  errorMessage: string
): Promise<boolean> {
  const occurredAt = new Date();
  const occurredStr = occurredAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body { font-family: sans-serif; margin: 16px; }</style>
</head>
<body>
  <h2>[STELVIO AI] 취소/반품 처리 실패 알림</h2>
  <p><strong>발생 시각:</strong> ${escapeHtml(occurredStr)} (KST)</p>
  <p><strong>주문번호 (productOrderId):</strong> ${escapeHtml(productOrderId)}</p>
  <p><strong>에러 메시지:</strong></p>
  <pre style="background:#f5f5f5;padding:12px;border-radius:4px;">${escapeHtml(errorMessage)}</pre>
</body>
</html>`;

  return sendErrorReport({
    errorType: "취소/반품 처리 실패",
    html,
    to: getAdminEmail(),
  });
}

/**
 * SMTP 설정 완료 테스트 메일 발송.
 * 수신: ADMIN_EMAIL (관리자 Gmail). 테스트 엔드포인트에서 호출.
 */
export async function sendSmtpTestEmail(): Promise<boolean> {
  const to = getAdminEmail();
  const trans = getTransporter();

  if (!trans) {
    console.warn("[emailService] SMTP 테스트 메일 미발송: SMTP_USER/SMTP_PASS 미설정");
    return false;
  }

  const subject = "[STELVIO AI] 시스템 알림 - SMTP 설정 완료 테스트";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body { font-family: sans-serif; margin: 16px; }</style></head>
<body>
  <h2>SMTP 설정 완료 테스트 메일</h2>
  <p>이 메일은 [STELVIO AI] 시스템 알림 SMTP 설정이 정상적으로 동작하는지 확인하기 위한 테스트 메일입니다.</p>
  <p><strong>발송 시각:</strong> ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)</p>
  <p>발송 서버: 네이버 SMTP (smtp.naver.com) → 수신: ${escapeHtml(to)}</p>
</body>
</html>`;

  try {
    await trans.sendMail({
      from: getFromAddress(),
      to,
      subject,
      text: "SMTP 설정 완료 테스트 메일입니다. HTML을 지원하는 클라이언트에서 본문을 확인하세요.",
      html,
    });
    console.log("[emailService] SMTP 테스트 메일 발송 완료:", to);
    return true;
  } catch (err) {
    console.error("[emailService] SMTP 테스트 메일 발송 실패:", err);
    return false;
  }
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
