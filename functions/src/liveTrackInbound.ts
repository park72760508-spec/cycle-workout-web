/**
 * Garmin LiveTrack 이메일 자동 수신 (2026-10-12)
 *
 * 무료 Garmin 사용자는 활동마다 LiveTrack 링크가 새로 발급된다. Garmin Connect 앱의 "LiveTrack 자동 시작 +
 * 이메일 초대"에 사용자 전용 주소(STELVIO 수신 Gmail + 개인 코드, 예: stelvio.livetrack+ab12cd34ef@gmail.com)를
 * 한 번 등록해 두면, 활동 시작 때마다 Garmin이 보낸 초대 메일을 수신 Gmail의 Apps Script(1분 주기)가 이 함수로
 * 전달하고, 함수가 링크를 꺼내 garminLiveTrack/{uid} 를 갱신한다 → 앱에서 매번 붙여넣지 않아도 된다.
 *
 * - 개인 코드 → uid: garminLiveTrackInbox/{code} { uid } (클라이언트가 최초 1회 생성, 보안 규칙상 생성만 가능)
 * - 인증: Apps Script와 공유하는 토큰(LIVETRACK_INBOUND_TOKEN, functions/.env.stelvio-ai) — 헤더 X-Stelvio-Token
 * - 비용: Gmail·Apps Script 무료, 이 함수는 새 메일이 있을 때만 호출(무료 할당량 내)
 */
import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";

const liveTrackInboundToken = defineString("LIVETRACK_INBOUND_TOKEN", { default: "" });

const LIVETRACK_RE = /https:\/\/(?:livetrack\.garmin\.com|gar\.mn)\/[^\s<>"'\\)]+/i;
const URL_RE = /https?:\/\/[^\s<>"'\\)]+/gi;

function cleanUrl(u: string): string {
  return u.replace(/&amp;/g, "&").replace(/[).,;]+$/, "").replace(/^https:\/\/[^/]+/i, (h) => h.toLowerCase());
}

function directLiveTrack(text: string): string {
  const m = String(text || "").match(LIVETRACK_RE);
  return m ? cleanUrl(m[0]) : "";
}

/** 클릭 추적 링크로 감싼 경우: 인코딩된 파라미터 해석 → 그래도 없으면 리다이렉트를 최대 4번 따라간다. */
async function resolveLiveTrackUrl(text: string): Promise<string> {
  const direct = directLiveTrack(text);
  if (direct) return direct;
  const decoded = (() => {
    try {
      return decodeURIComponent(text);
    } catch (_e) {
      return "";
    }
  })();
  const fromDecoded = directLiveTrack(decoded);
  if (fromDecoded) return fromDecoded;

  const candidates = Array.from(new Set((String(text || "").match(URL_RE) || []).map(cleanUrl)))
    .filter((u) => /garmin|gar\.mn|livetrack/i.test(u))
    .slice(0, 6);
  for (const start of candidates) {
    let cur = start;
    for (let hop = 0; hop < 4; hop++) {
      try {
        const r = await fetch(cur, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
        const loc = r.headers.get("location");
        if (!loc) break;
        const next = new URL(loc, cur).toString();
        const hit = directLiveTrack(next);
        if (hit) return hit;
        cur = next;
      } catch (_e) {
        break;
      }
    }
  }
  return "";
}

/** 수신 주소에서 개인 코드 추출: <local>+<code>@… */
function extractInboxCode(addresses: string): string {
  const m = String(addresses || "").toLowerCase().match(/\+([a-z0-9]{10})@/);
  return m ? m[1] : "";
}

export const liveTrackInbound = onRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { region: "asia-northeast3", cors: false, invoker: "public", timeoutSeconds: 60, memory: "256MiB", maxInstances: 2 } as any,
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("POST only");
      return;
    }
    const expected = liveTrackInboundToken.value();
    if (!expected || String(req.get("x-stelvio-token") || "") !== expected) {
      res.status(403).send("forbidden");
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const items = Array.isArray(body.messages) ? (body.messages as Record<string, unknown>[]) : [body];
    const db = admin.firestore();
    const results: Array<Record<string, unknown>> = [];

    for (const it of items.slice(0, 20)) {
      const id = String(it.id || "");
      try {
        const from = String(it.from || "");
        if (!/garmin/i.test(from)) {
          results.push({ id, ok: false, reason: "not-garmin" });
          continue;
        }
        const code = extractInboxCode([it.deliveredTo, it.to, it.cc].map((x) => String(x || "")).join(" "));
        if (!code) {
          results.push({ id, ok: false, reason: "no-code" });
          continue;
        }
        const inbox = await db.collection("garminLiveTrackInbox").doc(code).get();
        const uid = inbox.exists ? String(inbox.get("uid") || "") : "";
        if (!uid) {
          results.push({ id, ok: false, reason: "unknown-code" });
          continue;
        }
        const url = await resolveLiveTrackUrl(`${String(it.html || "")}\n${String(it.body || "")}`);
        if (!url || url.length > 500) {
          results.push({ id, ok: false, reason: "no-url" });
          continue;
        }
        await db.collection("garminLiveTrack").doc(uid).set({
          url,
          uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await inbox.ref.set({ lastReceivedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        results.push({ id, ok: true });
      } catch (e) {
        console.warn("[liveTrackInbound]", id, e);
        results.push({ id, ok: false, reason: "error" });
      }
    }
    res.status(200).json({ results });
  }
);
