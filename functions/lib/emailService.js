"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendErrorReport = sendErrorReport;
exports.sendMatchingFailureReport = sendMatchingFailureReport;
/**
 * STELVIO AI - 실패 건 이메일 알림
 * 매칭 실패 등 에러 리포트를 stelvio.ai.kr@gmail.com 으로 발송
 */
const nodemailer = __importStar(require("nodemailer"));
const ERROR_REPORT_TO = "stelvio.ai.kr@gmail.com";
const DEFAULT_FROM = "stelvio.ai.kr@gmail.com";
let transporter = null;
function getTransporter() {
    if (transporter)
        return transporter;
    const user = process.env.SMTP_USER || process.env.NAVER_MAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.NAVER_MAIL_PASS;
    if (!user || !pass) {
        console.warn("[emailService] SMTP 미설정: SMTP_USER/SMTP_PASS 또는 NAVER_MAIL_USER/NAVER_MAIL_PASS 를 설정하면 에러 리포트 메일이 발송됩니다.");
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
/**
 * 에러 리포트 메일 발송.
 * SMTP 설정이 없으면 로그만 남기고 완료 처리.
 */
async function sendErrorReport(payload) {
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
    }
    catch (err) {
        console.error("[emailService] 메일 발송 실패:", err);
        return false;
    }
}
/**
 * 네이버 구독 매칭 실패 건 요약 리포트
 */
async function sendMatchingFailureReport(failures) {
    if (failures.length === 0)
        return true;
    const lines = failures.map((f) => `- productOrderId: ${f.productOrderId}, orderId: ${f.orderId || "-"}\n  옵션입력: ${f.optionPhoneOrId || "-"}, 주문자연락처: ${f.ordererTel || "-"}\n  사유: ${f.reason}`);
    return sendErrorReport({
        subject: `[STELVIO AI] 네이버 구독 매칭 실패 ${failures.length}건`,
        to: ERROR_REPORT_TO,
        body: `다음 주문에서 사용자 매칭에 실패했습니다.\n\n${lines.join("\n\n")}\n\n발생 시각: ${new Date().toISOString()}`,
    });
}
