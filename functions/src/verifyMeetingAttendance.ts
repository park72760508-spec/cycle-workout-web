/**
 * 라이딩 모임 참석 검증: Strava 활동 스트림(latlng, time) + 집결지 반경 200m + 모임 시각 ±1시간
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { SecretParam } from "firebase-functions/lib/params/types";

/** 집결지 반경 (미터) */
const MEETING_START_RADIUS_M = 200;
/** 모임 시각 기준 앞뒤 허용 구간 (밀리초) = 1시간 */
const MEETING_TIME_WINDOW_MS = 60 * 60 * 1000;
/** Strava 429 시 대기 상한 (ms) */
const STRAVA_RATE_LIMIT_MAX_WAIT_MS = 900_000;
/** Strava 호출 재시도 간격 (기존 index.js와 동일 계열) */
const STRAVA_CALL_DELAY_MS = 9000;
const STRAVA_STREAMS_MAX_RETRIES = 5;
const STRAVA_DETAIL_MAX_RETRIES = 5;

export type MeetingParticipantStatus = "APPLIED" | "ATTENDED" | "MISSED";

export interface VerifyMeetingAttendanceUserDetail {
  userId: string;
  participantDocId: string;
  outcome: "ATTENDED" | "MISSED" | "SKIPPED";
  note?: string;
}

export interface VerifyMeetingAttendanceResult {
  success: true;
  meetingId: string;
  processedCount: number;
  attendedCount: number;
  missedCount: number;
  skippedCount: number;
  details: VerifyMeetingAttendanceUserDetail[];
}

/**
 * Haversine 공식: 두 위경도 좌표 간 거리 (미터)
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // 지구 평균 반경 (m)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function waitForStravaRateLimit(res: Response): Promise<void> {
  if (res.status !== 429) return;
  const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
  const waitMs = Math.min(retryAfter * 1000, STRAVA_RATE_LIMIT_MAX_WAIT_MS);
  console.warn(`[verifyMeetingAttendance] Strava 429, ${waitMs / 1000}s 대기`);
  await new Promise((r) => setTimeout(r, waitMs));
}

interface StravaStreamSet {
  latlng: [number, number][];
  timeSec: number[];
}

interface ActivityStartResult {
  startMs: number;
}

/**
 * Strava Activity 상세에서 활동 시작 시각(UTC ms) 조회
 */
async function fetchStravaActivityStart(accessToken: string, activityId: string): Promise<ActivityStartResult | null> {
  const url = `https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}`;
  for (let attempt = 0; attempt <= STRAVA_DETAIL_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
      let res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 429) {
        await waitForStravaRateLimit(res);
        continue;
      }
      if (!res.ok) {
        console.warn(`[verifyMeetingAttendance] activity detail ${res.status} id=${activityId}`);
        return null;
      }
      const body = (await res.json()) as { start_date?: string };
      const sd = body?.start_date;
      if (!sd) return null;
      const startMs = Date.parse(sd);
      if (Number.isNaN(startMs)) return null;
      return { startMs };
    } catch (e) {
      console.warn("[verifyMeetingAttendance] fetchStravaActivityStart:", (e as Error).message);
      if (attempt === STRAVA_DETAIL_MAX_RETRIES) return null;
    }
  }
  return null;
}

/**
 * Strava Activity Streams: latlng, time (초 단위, 활동 시작 기준)
 */
export async function fetchActivityLatLngTimeStreams(
  accessToken: string,
  activityId: string
): Promise<StravaStreamSet | null> {
  const url = `https://www.strava.com/api/v3/activities/${encodeURIComponent(
    activityId
  )}/streams?keys=latlng,time&key_by_type=true`;

  for (let attempt = 0; attempt <= STRAVA_STREAMS_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
      let res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 429) {
        await waitForStravaRateLimit(res);
        continue;
      }
      if (!res.ok) {
        console.warn(`[verifyMeetingAttendance] streams ${res.status} id=${activityId}`);
        return null;
      }
      const raw = await res.json();

      // key_by_type=true → { latlng: {...}, time: {...} }
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const latlngStream = raw.latlng as { data?: [number, number][] } | undefined;
        const timeStream = raw.time as { data?: number[] } | undefined;
        const latlng = Array.isArray(latlngStream?.data) ? latlngStream!.data! : null;
        const timeSec = Array.isArray(timeStream?.data) ? timeStream!.data! : null;
        if (latlng && timeSec && latlng.length > 0) {
          return { latlng, timeSec };
        }
      }

      // 배열 응답 (key_by_type 미사용 호환)
      const streamArray = Array.isArray(raw) ? raw : [];
      const findData = (type: string): number[] | [number, number][] | null => {
        const s = streamArray.find((x: { type?: string }) => String(x?.type || "").toLowerCase() === type);
        return s && Array.isArray(s.data) ? s.data : null;
      };
      const latlng = findData("latlng") as [number, number][] | null;
      const timeSec = findData("time") as number[] | null;
      if (latlng && timeSec && latlng.length > 0) {
        return { latlng, timeSec };
      }
      return null;
    } catch (e) {
      console.warn("[verifyMeetingAttendance] fetchActivityLatLngTimeStreams:", (e as Error).message);
      if (attempt === STRAVA_STREAMS_MAX_RETRIES) return null;
    }
  }
  return null;
}

function readExpiresAtSeconds(data: FirebaseFirestore.DocumentData): number {
  const v = data?.strava_expires_at;
  if (v == null) return 0;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "object" && typeof v.toMillis === "function") {
    return Math.floor(v.toMillis() / 1000);
  }
  return 0;
}

async function refreshStravaTokenForUser(
  db: admin.firestore.Firestore,
  userId: string,
  clientSecret: string
): Promise<string> {
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new Error("사용자를 찾을 수 없습니다.");
  const userData = userSnap.data() || {};
  const refreshToken = String(userData.strava_refresh_token || "");
  if (!refreshToken) throw new Error("Strava 리프레시 토큰이 없습니다.");

  const appConfigSnap = await db.collection("appConfig").doc("strava").get();
  if (!appConfigSnap.exists) throw new Error("Strava 앱 설정(appConfig/strava)이 없습니다.");
  const appData = appConfigSnap.data() || {};
  const clientId = String(appData.strava_client_id || "");
  if (!clientId || !clientSecret) throw new Error("Strava client 설정이 불완전합니다.");

  const tokenUrl = "https://www.strava.com/api/v3/oauth/token";
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    message?: string;
    error?: string;
  };
  if (!tokenRes.ok) {
    throw new Error(tokenData.message || tokenData.error || `Strava token ${tokenRes.status}`);
  }
  const accessToken = String(tokenData.access_token || "");
  const newRefreshToken = String(tokenData.refresh_token || refreshToken);
  const expiresAt = tokenData.expires_at != null ? Number(tokenData.expires_at) : 0;
  if (!accessToken) throw new Error("Strava에서 access_token을 받지 못했습니다.");

  await userRef.update({
    strava_access_token: accessToken,
    strava_refresh_token: newRefreshToken,
    strava_expires_at: expiresAt,
  });
  return accessToken;
}

async function getValidStravaAccessToken(
  db: admin.firestore.Firestore,
  userId: string,
  clientSecret: string
): Promise<string | null> {
  const userRef = db.collection("users").doc(userId);
  const snap = await userRef.get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  let accessToken = String(d.strava_access_token || "");
  const expSec = readExpiresAtSeconds(d);
  const nowSec = Math.floor(Date.now() / 1000);
  const needsRefresh = !accessToken || expSec < nowSec + 120;

  if (needsRefresh) {
    try {
      accessToken = await refreshStravaTokenForUser(db, userId, clientSecret);
    } catch (e) {
      console.warn(`[verifyMeetingAttendance] 토큰 갱신 실패 user=${userId}:`, (e as Error).message);
      return accessToken || null;
    }
  }
  return accessToken || null;
}

function extractMeetingLatLng(data: FirebaseFirestore.DocumentData): { lat: number; lng: number } | null {
  const g = data?.startLatLng;
  if (g == null) return null;
  if (typeof g.latitude === "number" && typeof g.longitude === "number") {
    return { lat: g.latitude, lng: g.longitude };
  }
  if (typeof g.lat === "number" && typeof g.lng === "number") {
    return { lat: g.lat, lng: g.lng };
  }
  if (typeof g._latitude === "number" && typeof g._longitude === "number") {
    return { lat: g._latitude, lng: g._longitude };
  }
  return null;
}

function meetingTimeToMs(meetingTime: unknown): number | null {
  if (meetingTime == null) return null;
  if (typeof meetingTime === "object" && meetingTime !== null && "toMillis" in meetingTime) {
    return (meetingTime as FirebaseFirestore.Timestamp).toMillis();
  }
  if (typeof meetingTime === "object" && meetingTime !== null && "toDate" in meetingTime) {
    const d = (meetingTime as FirebaseFirestore.Timestamp).toDate();
    return d.getTime();
  }
  if (meetingTime instanceof Date) return meetingTime.getTime();
  return null;
}

function wasNearMeetingStartDuringWindow(
  meetingMs: number,
  startMs: number,
  streams: StravaStreamSet,
  meetLat: number,
  meetLng: number
): boolean {
  const windowStart = meetingMs - MEETING_TIME_WINDOW_MS;
  const windowEnd = meetingMs + MEETING_TIME_WINDOW_MS;
  const n = Math.min(streams.latlng.length, streams.timeSec.length);
  for (let i = 0; i < n; i++) {
    const tOff = Number(streams.timeSec[i]) || 0;
    const pointMs = startMs + tOff * 1000;
    if (pointMs < windowStart || pointMs > windowEnd) continue;
    const pair = streams.latlng[i];
    if (!pair || pair.length < 2) continue;
    const lat = Number(pair[0]);
    const lng = Number(pair[1]);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const dist = calculateDistance(lat, lng, meetLat, meetLng);
    if (dist <= MEETING_START_RADIUS_M) return true;
  }
  return false;
}

interface ParticipantDoc {
  ref: FirebaseFirestore.DocumentReference;
  docId: string;
  userId: string;
  stravaActivityId: string | null;
}

async function verifyOneParticipant(
  db: admin.firestore.Firestore,
  p: ParticipantDoc,
  meetingMs: number,
  meetLat: number,
  meetLng: number,
  clientSecret: string
): Promise<{
  batchUpdate: { ref: FirebaseFirestore.DocumentReference; status: MeetingParticipantStatus } | null;
  detail: VerifyMeetingAttendanceUserDetail;
}> {
  const baseDetail = { userId: p.userId, participantDocId: p.docId } as const;

  if (!p.stravaActivityId) {
    return {
      batchUpdate: { ref: p.ref, status: "MISSED" },
      detail: { ...baseDetail, outcome: "MISSED", note: "NO_STRAVA_ACTIVITY_ID" },
    };
  }

  let accessToken: string | null = null;
  try {
    accessToken = await getValidStravaAccessToken(db, p.userId, clientSecret);
  } catch (e) {
    console.warn(`[verifyMeetingAttendance] 토큰 조회 예외 user=${p.userId}:`, (e as Error).message);
  }
  if (!accessToken) {
    return {
      batchUpdate: null,
      detail: { ...baseDetail, outcome: "SKIPPED", note: "NO_STRAVA_ACCESS_TOKEN" },
    };
  }

  try {
    const start = await fetchStravaActivityStart(accessToken, p.stravaActivityId);
    if (!start) {
      return {
        batchUpdate: null,
        detail: { ...baseDetail, outcome: "SKIPPED", note: "ACTIVITY_DETAIL_FAILED" },
      };
    }

    const streams = await fetchActivityLatLngTimeStreams(accessToken, p.stravaActivityId);
    if (!streams || streams.latlng.length === 0) {
      return {
        batchUpdate: { ref: p.ref, status: "MISSED" },
        detail: { ...baseDetail, outcome: "MISSED", note: "NO_LATLNG_STREAMS" },
      };
    }

    const ok = wasNearMeetingStartDuringWindow(meetingMs, start.startMs, streams, meetLat, meetLng);
    if (ok) {
      return {
        batchUpdate: { ref: p.ref, status: "ATTENDED" },
        detail: { ...baseDetail, outcome: "ATTENDED" },
      };
    }
    return {
      batchUpdate: { ref: p.ref, status: "MISSED" },
      detail: { ...baseDetail, outcome: "MISSED", note: "OUTSIDE_RADIUS_OR_TIME_WINDOW" },
    };
  } catch (e) {
    const msg = (e as Error).message || "UNKNOWN";
    console.warn(`[verifyMeetingAttendance] 검증 실패 user=${p.userId}:`, msg);
    return {
      batchUpdate: null,
      detail: { ...baseDetail, outcome: "SKIPPED", note: `ERROR:${msg}` },
    };
  }
}

function commitInChunks(
  db: admin.firestore.Firestore,
  updates: Array<{ ref: FirebaseFirestore.DocumentReference; status: MeetingParticipantStatus }>
): Promise<void> {
  const chunkSize = 450;
  const chunks: typeof updates[] = [];
  for (let i = 0; i < updates.length; i += chunkSize) {
    chunks.push(updates.slice(i, i + chunkSize));
  }
  return (async () => {
    for (const chunk of chunks) {
      const batch = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();
      for (const u of chunk) {
        batch.update(u.ref, {
          status: u.status,
          attendanceVerifiedAt: now,
        });
      }
      await batch.commit();
    }
  })();
}

/**
 * Callable 팩토리: Strava client secret 파라미터를 엔트리(index.ts)와 공유
 * - 호출자는 로그인 필수, 모임 `hostUserId` 와 동일한 uid 만 실행 가능
 */
export function createVerifyMeetingAttendance(stravaClientSecret: SecretParam) {
  return onCall(
    {
      region: "asia-northeast3",
      secrets: [stravaClientSecret],
      timeoutSeconds: 540,
      memory: "512MiB",
    },
    async (request): Promise<VerifyMeetingAttendanceResult> => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const meetingId = String((request.data as { meetingId?: string })?.meetingId || "").trim();
    if (!meetingId) {
      throw new HttpsError("invalid-argument", "meetingId 가 필요합니다.");
    }

    const clientSecret = stravaClientSecret.value() || process.env.STRAVA_CLIENT_SECRET || "";
    if (!clientSecret.trim()) {
      throw new HttpsError("failed-precondition", "STRAVA_CLIENT_SECRET 이 설정되지 않았습니다.");
    }

    const db = admin.firestore();
    const meetingRef = db.collection("meetings").doc(meetingId);
    const meetingSnap = await meetingRef.get();
    if (!meetingSnap.exists) {
      throw new HttpsError("not-found", "모임을 찾을 수 없습니다.");
    }
    const meetingData = meetingSnap.data() || {};
    const hostUserId = String(meetingData.hostUserId || "").trim();
    if (!hostUserId) {
      throw new HttpsError("failed-precondition", "모임 문서에 hostUserId 가 없습니다.");
    }
    if (hostUserId !== uid) {
      throw new HttpsError("permission-denied", "모임 방장만 참석 검증을 실행할 수 있습니다.");
    }

    const meetingMs = meetingTimeToMs(meetingData.meetingTime);
    if (meetingMs == null) {
      throw new HttpsError("failed-precondition", "meetingTime 이 유효하지 않습니다.");
    }
    const startLL = extractMeetingLatLng(meetingData);
    if (!startLL) {
      throw new HttpsError("failed-precondition", "startLatLng 가 유효하지 않습니다.");
    }

    const participantsSnap = await db
      .collection("meeting_participants")
      .where("meetingId", "==", meetingId)
      .where("status", "==", "APPLIED")
      .get();

    const participants: ParticipantDoc[] = participantsSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        ref: doc.ref,
        docId: doc.id,
        userId: String(d.userId || ""),
        stravaActivityId: d.stravaActivityId != null && String(d.stravaActivityId).trim() !== "" ? String(d.stravaActivityId) : null,
      };
    }).filter((p) => p.userId);

    const results = await Promise.all(
      participants.map((p) => verifyOneParticipant(db, p, meetingMs, startLL.lat, startLL.lng, clientSecret.trim()))
    );

    const batchUpdates: Array<{ ref: FirebaseFirestore.DocumentReference; status: MeetingParticipantStatus }> = [];
    const details: VerifyMeetingAttendanceUserDetail[] = [];

    let attendedCount = 0;
    let missedCount = 0;
    let skippedCount = 0;

    for (const r of results) {
      details.push(r.detail);
      if (r.detail.outcome === "ATTENDED") attendedCount++;
      else if (r.detail.outcome === "MISSED") missedCount++;
      else skippedCount++;

      if (r.batchUpdate) batchUpdates.push(r.batchUpdate);
    }

    if (batchUpdates.length > 0) {
      await commitInChunks(db, batchUpdates);
    }

    return {
      success: true,
      meetingId,
      processedCount: batchUpdates.length,
      attendedCount,
      missedCount,
      skippedCount,
      details,
    };
    }
  );
}
