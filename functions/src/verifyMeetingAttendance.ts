/**
 * 라이딩 모임 참석 검증: Strava 활동 스트림(latlng, time) + 집결지 반경 200m + 모임 시각 ±1시간
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
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

/** rides 문서: 집결 좌표 (선택 필드 — 없으면 검증 불가) */
function extractRideDepartureLatLng(data: FirebaseFirestore.DocumentData): { lat: number; lng: number } | null {
  const la = Number(data?.departureLatitude ?? data?.departureLat ?? data?.verificationStartLat);
  const lo = Number(data?.departureLongitude ?? data?.departureLng ?? data?.verificationStartLng);
  if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
    return { lat: la, lng: lo };
  }
  const geo = data?.departureGeo ?? data?.verificationStartLatLng ?? data?.startLatLng;
  if (geo == null) return null;
  if (typeof (geo as { latitude?: number }).latitude === "number" && typeof (geo as { longitude?: number }).longitude === "number") {
    return { lat: (geo as { latitude: number }).latitude, lng: (geo as { longitude: number }).longitude };
  }
  return null;
}

/** Firestore date 필드 → 서울 달력 YYYY-MM-DD */
function getRideDateSeoulYmdFromFirestoreDate(dateField: unknown): string | null {
  const ms = meetingTimeToMs(dateField as FirebaseFirestore.Timestamp);
  if (ms == null) return null;
  const d = new Date(ms);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    let y = "";
    let m = "";
    let day = "";
    for (const p of parts) {
      if (p.type === "year") y = p.value;
      if (p.type === "month") m = p.value;
      if (p.type === "day") day = p.value;
    }
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {
    /* ignore */
  }
  return null;
}

/** "7:30", "07:30", "7:30:00" 등 → 시·분 */
function parseDepartureTimeToHourMinute(departureTime: unknown): { h: number; min: number } | null {
  const s = String(departureTime != null ? departureTime : "").trim();
  if (!s) return { h: 9, min: 0 };
  const m = s.match(/^(\d{1,2})\s*:\s*(\d{2})(?::(\d{2}))?/);
  if (!m) return { h: 9, min: 0 };
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return { h, min };
}

/**
 * 라이딩 일정일(서울) + 출발 시각 → 집결 기준 UTC epoch(ms). 한국은 UTC+9 고정으로 계산.
 */
function combineRideMeetingTimeMs(rideData: FirebaseFirestore.DocumentData): number | null {
  const ymd = getRideDateSeoulYmdFromFirestoreDate(rideData.date);
  if (!ymd) return null;
  const parts = ymd.split("-").map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const { h, min } = parseDepartureTimeToHourMinute(rideData.departureTime) || { h: 9, min: 0 };
  const [y, mo, day] = parts;
  return Date.UTC(y, mo - 1, day, h - 9, min, 0, 0);
}

async function findStravaActivityIdForUserOnRideDate(
  db: admin.firestore.Firestore,
  userId: string,
  rideDateYmd: string
): Promise<string | null> {
  const logsRef = db.collection("users").doc(userId).collection("logs");
  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    snap = await logsRef.where("date", "==", rideDateYmd).limit(25).get();
  } catch (e) {
    console.warn(`[verifyMeetingAttendance] logs 조회 실패 uid=${userId}:`, (e as Error).message);
    return null;
  }
  for (const d of snap.docs) {
    const data = d.data();
    const src = String(data.source || "").toLowerCase();
    if (src !== "strava") continue;
    if (data.activity_id) return String(data.activity_id);
    if (/^\d+$/.test(d.id)) return d.id;
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

interface AttendanceBatchWrite {
  ref: FirebaseFirestore.DocumentReference;
  status: MeetingParticipantStatus;
  meetingId: string;
  userId: string;
}

async function verifyOneParticipant(
  db: admin.firestore.Firestore,
  p: ParticipantDoc,
  meetingMs: number,
  meetLat: number,
  meetLng: number,
  clientSecret: string,
  eventIdForDocs: string
): Promise<{
  batchUpdate: AttendanceBatchWrite | null;
  detail: VerifyMeetingAttendanceUserDetail;
}> {
  const baseDetail = { userId: p.userId, participantDocId: p.docId } as const;
  const docMeta = { meetingId: eventIdForDocs, userId: p.userId };

  if (!p.stravaActivityId) {
    return {
      batchUpdate: { ref: p.ref, status: "MISSED", ...docMeta },
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
        batchUpdate: { ref: p.ref, status: "MISSED", ...docMeta },
        detail: { ...baseDetail, outcome: "MISSED", note: "NO_LATLNG_STREAMS" },
      };
    }

    const ok = wasNearMeetingStartDuringWindow(meetingMs, start.startMs, streams, meetLat, meetLng);
    if (ok) {
      return {
        batchUpdate: { ref: p.ref, status: "ATTENDED", ...docMeta },
        detail: { ...baseDetail, outcome: "ATTENDED" },
      };
    }
    return {
      batchUpdate: { ref: p.ref, status: "MISSED", ...docMeta },
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

/**
 * Strava API로 직접 해당 서울 날짜의 활동 ID 조회 (Firestore 로그 미동기화 시 폴백).
 * 서울 날짜 YYYY-MM-DD → UTC epoch 범위: 전날 15:00 UTC ~ 당일 15:00 UTC.
 */
async function findStravaActivityIdViaApi(
  accessToken: string,
  rideDateYmd: string
): Promise<string | null> {
  try {
    const parts = rideDateYmd.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [y, m, d] = parts;
    /* 서울 자정(KST 00:00) = UTC 전날 15:00 */
    const afterSec = Math.floor(Date.UTC(y, m - 1, d - 1, 15, 0, 0) / 1000);
    const beforeSec = Math.floor(Date.UTC(y, m - 1, d, 15, 0, 0) / 1000);
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${afterSec}&before=${beforeSec}&per_page=10`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const activities = (await res.json()) as Array<{ id?: number | string }>;
    if (!Array.isArray(activities) || activities.length === 0) return null;
    const first = activities[0];
    return first?.id != null ? String(first.id) : null;
  } catch {
    return null;
  }
}

/**
 * 집결 좌표가 없을 때 시각만으로 참석 검증.
 * Strava 로그가 앱에 동기화되지 않은 경우 Strava API 직접 조회로 폴백.
 * 활동 시작 시각이 모임 시각 ±1시간 이내 → ATTENDED, 없거나 범위 초과 → MISSED.
 */
async function verifyOneParticipantTimeOnly(
  db: admin.firestore.Firestore,
  p: ParticipantDoc,
  rideYmd: string | null,
  meetingMs: number,
  clientSecret: string,
  eventIdForDocs: string
): Promise<{
  batchUpdate: AttendanceBatchWrite | null;
  detail: VerifyMeetingAttendanceUserDetail;
}> {
  const baseDetail = { userId: p.userId, participantDocId: p.docId } as const;
  const docMeta = { meetingId: eventIdForDocs, userId: p.userId };

  /* 먼저 액세스 토큰 확보 (Strava API 폴백에도 필요) */
  let accessToken: string | null = null;
  try {
    accessToken = await getValidStravaAccessToken(db, p.userId, clientSecret);
  } catch (e) {
    console.warn(`[verifyMeetingAttendance] 토큰 조회 예외(시각검증) user=${p.userId}:`, (e as Error).message);
  }

  /* 활동 ID: Firestore 로그 우선, 없으면 Strava API 직접 조회 */
  let stravaActivityId = p.stravaActivityId;
  if (!stravaActivityId && accessToken && rideYmd) {
    stravaActivityId = await findStravaActivityIdViaApi(accessToken, rideYmd);
    if (stravaActivityId) {
      console.log(`[verifyMeetingAttendance] Strava API 폴백으로 활동 발견 user=${p.userId} activityId=${stravaActivityId}`);
    }
  }

  if (!stravaActivityId) {
    /* 토큰도 없고 Firestore 로그도 없으면 SKIPPED, 그 외엔 MISSED */
    if (!accessToken) {
      return {
        batchUpdate: null,
        detail: { ...baseDetail, outcome: "SKIPPED", note: "NO_STRAVA_ACCESS_TOKEN" },
      };
    }
    return {
      batchUpdate: { ref: p.ref, status: "MISSED", ...docMeta },
      detail: { ...baseDetail, outcome: "MISSED", note: "NO_STRAVA_ACTIVITY_FOUND" },
    };
  }

  if (!accessToken) {
    return {
      batchUpdate: null,
      detail: { ...baseDetail, outcome: "SKIPPED", note: "NO_STRAVA_ACCESS_TOKEN" },
    };
  }

  try {
    const start = await fetchStravaActivityStart(accessToken, stravaActivityId);
    if (!start) {
      return {
        batchUpdate: null,
        detail: { ...baseDetail, outcome: "SKIPPED", note: "ACTIVITY_DETAIL_FAILED" },
      };
    }
    const windowStart = meetingMs - MEETING_TIME_WINDOW_MS;
    const windowEnd = meetingMs + MEETING_TIME_WINDOW_MS;
    if (start.startMs >= windowStart && start.startMs <= windowEnd) {
      return {
        batchUpdate: { ref: p.ref, status: "ATTENDED", ...docMeta },
        detail: { ...baseDetail, outcome: "ATTENDED", note: "TIME_ONLY_VERIFIED" },
      };
    }
    return {
      batchUpdate: { ref: p.ref, status: "MISSED", ...docMeta },
      detail: { ...baseDetail, outcome: "MISSED", note: "OUTSIDE_TIME_WINDOW" },
    };
  } catch (e) {
    const msg = (e as Error).message || "UNKNOWN";
    console.warn(`[verifyMeetingAttendance] 시각검증 실패 user=${p.userId}:`, msg);
    return {
      batchUpdate: null,
      detail: { ...baseDetail, outcome: "SKIPPED", note: `ERROR:${msg}` },
    };
  }
}

function getTodaySeoulYmdString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  let y = "";
  let m = "";
  let day = "";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    if (p.type === "month") m = p.value;
    if (p.type === "day") day = p.value;
  }
  if (y && m && day) return `${y}-${m}-${day}`;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** 서울 달력 "오늘" 00:00:00 시각을 Firestore Timestamp (UTC 저장) */
function getStartOfTodaySeoulTimestamp(): admin.firestore.Timestamp {
  const ymd = getTodaySeoulYmdString();
  const [y, mo, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const ms = Date.UTC(y, mo - 1, d, -9, 0, 0, 0);
  return admin.firestore.Timestamp.fromMillis(ms);
}

function commitInChunks(db: admin.firestore.Firestore, updates: AttendanceBatchWrite[]): Promise<void> {
  const chunkSize = 450;
  const chunks: AttendanceBatchWrite[][] = [];
  for (let i = 0; i < updates.length; i += chunkSize) {
    chunks.push(updates.slice(i, i + chunkSize));
  }
  return (async () => {
    for (const chunk of chunks) {
      const batch = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();
      for (const u of chunk) {
        batch.set(
          u.ref,
          {
            meetingId: u.meetingId,
            userId: u.userId,
            status: u.status,
            attendanceVerifiedAt: now,
          },
          { merge: true }
        );
      }
      await batch.commit();
    }
  })();
}

/**
 * meetings 또는 rides(eventId)에 대한 참석 검증 실행.
 * @param callerUid null 이면 방장 검사 생략(자정 스케줄러 전용). 문자열이면 해당 uid 가 방장과 일치해야 함.
 */
export async function executeVerifyAttendanceForEventId(
  db: admin.firestore.Firestore,
  eventId: string,
  clientSecretTrim: string,
  callerUid: string | null
): Promise<VerifyMeetingAttendanceResult> {
  const meetingId = String(eventId || "").trim();
  if (!meetingId) {
    throw new HttpsError("invalid-argument", "meetingId 가 필요합니다.");
  }

  const meetingRef = db.collection("meetings").doc(meetingId);
  const meetingSnap = await meetingRef.get();
  const rideRef = db.collection("rides").doc(meetingId);
  const rideSnap = await rideRef.get();

  let hostUserId = "";
  let meetingMs: number | null = null;
  let startLL: { lat: number; lng: number } | null = null;
  let participants: ParticipantDoc[] = [];
  let noGeoMode = false; /* rides 문서에 집결 좌표가 없을 때 true → 시각만 검증 */
  let ridesDateYmd: string | null = null; /* rides 날짜 (시각만 검증 폴백에 전달) */

  if (meetingSnap.exists) {
    const meetingData = meetingSnap.data() || {};
    hostUserId = String(meetingData.hostUserId || "").trim();
    meetingMs = meetingTimeToMs(meetingData.meetingTime);
    startLL = extractMeetingLatLng(meetingData);

    const participantsSnap = await db
      .collection("meeting_participants")
      .where("meetingId", "==", meetingId)
      .where("status", "==", "APPLIED")
      .get();

    participants = participantsSnap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          ref: doc.ref,
          docId: doc.id,
          userId: String(d.userId || ""),
          stravaActivityId:
            d.stravaActivityId != null && String(d.stravaActivityId).trim() !== "" ? String(d.stravaActivityId) : null,
        };
      })
      .filter((p) => p.userId);
  } else if (rideSnap.exists) {
    const rideData = rideSnap.data() || {};
    hostUserId = String(rideData.hostUserId || "").trim();
    meetingMs = combineRideMeetingTimeMs(rideData);
    startLL = extractRideDepartureLatLng(rideData);
    const rideYmd = getRideDateSeoulYmdFromFirestoreDate(rideData.date);
    if (!rideYmd) {
      throw new HttpsError("failed-precondition", "rides 문서의 date 필드가 유효하지 않습니다.");
    }
    ridesDateYmd = rideYmd;
    if (!startLL) {
      /* 집결 좌표 없음 → 시각만 검증 모드로 전환 (에러 없이 계속 진행) */
      console.warn(`[verifyMeetingAttendance] rides/${meetingId}: 집결 좌표 없음 → 시각만 검증 모드로 진행`);
      noGeoMode = true;
    }
    const uidList = (Array.isArray(rideData.participants) ? rideData.participants : [])
      .map((x: unknown) => String(x != null ? x : "").trim())
      .filter(Boolean);

    const withActs = await Promise.all(
      uidList.map(async (userId) => {
        const stravaActivityId = await findStravaActivityIdForUserOnRideDate(db, userId, rideYmd);
        return { userId, stravaActivityId };
      })
    );

    participants = withActs.map(({ userId, stravaActivityId }) => {
      const docKey = `${meetingId}__${userId}`;
      return {
        ref: db.collection("meeting_participants").doc(docKey),
        docId: docKey,
        userId,
        stravaActivityId,
      };
    });
  } else {
    throw new HttpsError("not-found", "meetings 또는 rides 문서를 찾을 수 없습니다.");
  }

  if (!hostUserId) {
    throw new HttpsError("failed-precondition", "hostUserId 가 없습니다.");
  }
  if (callerUid != null && String(callerUid).trim() !== hostUserId) {
    throw new HttpsError("permission-denied", "모임 방장만 참석 검증을 실행할 수 있습니다.");
  }

  if (meetingMs == null) {
    throw new HttpsError("failed-precondition", "모임(또는 라이딩) 기준 시각을 계산할 수 없습니다.");
  }
  if (!startLL && !noGeoMode) {
    throw new HttpsError("failed-precondition", "집결 좌표(startLatLng 등)가 유효하지 않습니다.");
  }

  const results = await Promise.all(
    participants.map((p) =>
      startLL
        ? verifyOneParticipant(db, p, meetingMs!, startLL.lat, startLL.lng, clientSecretTrim, meetingId)
        : verifyOneParticipantTimeOnly(db, p, ridesDateYmd, meetingMs!, clientSecretTrim, meetingId)
    )
  );

  const batchUpdates: AttendanceBatchWrite[] = [];
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

  const result: VerifyMeetingAttendanceResult = {
    success: true,
    meetingId,
    processedCount: batchUpdates.length,
    attendedCount,
    missedCount,
    skippedCount,
    details,
  };

  if (rideSnap.exists && !meetingSnap.exists) {
    /* 개인별 결과를 rides 문서에 직접 저장 → 클라이언트 별도 쿼리 불필요 */
    const attendanceResults: Record<string, string> = {};
    for (const d of result.details) {
      if (d.userId) {
        attendanceResults[d.userId] =
          d.outcome === "ATTENDED" ? "ATTENDED"
          : d.outcome === "MISSED" ? "MISSED"
          : "SKIPPED";
      }
    }
    await rideRef.set(
      {
        attendanceVerificationRan: true,
        attendanceVerificationAt: admin.firestore.FieldValue.serverTimestamp(),
        attendanceVerificationSummary: {
          processedCount: result.processedCount,
          attendedCount: result.attendedCount,
          missedCount: result.missedCount,
          skippedCount: result.skippedCount,
        },
        attendanceResults,
      },
      { merge: true }
    );
  }

  return result;
}

/**
 * Callable 팩토리: Strava client secret 파라미터를 엔트리(index.ts)와 공유
 * - 호출자는 로그인 필수, 모임 `hostUserId` 와 동일한 uid 만 실행 가능
 */
export function createVerifyMeetingAttendance(stravaClientSecret: SecretParam) {
  return onCall(
    {
      region: "asia-northeast3",
      cors: true,          /* stelvio.ai.kr 등 모든 오리진 허용 — CORS preflight 오류 방지 */
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
      return executeVerifyAttendanceForEventId(db, meetingId, clientSecret.trim(), uid);
    }
  );
}

/**
 * 매일 서울 자정 직후: 전날 이전 일정의 rides 중 미검증 건에 대해 참석 검증(방장 없이 서버 실행)
 */
export function createScheduledRideAttendanceVerification(stravaClientSecret: SecretParam) {
  return onSchedule(
    {
      schedule: "5 0 * * *",
      timeZone: "Asia/Seoul",
      region: "asia-northeast3",
      secrets: [stravaClientSecret],
      timeoutSeconds: 540,
      memory: "512MiB",
    },
    async () => {
      const clientSecret = stravaClientSecret.value() || process.env.STRAVA_CLIENT_SECRET || "";
      if (!clientSecret.trim()) {
        console.error("[scheduledRideAttendanceVerification] STRAVA_CLIENT_SECRET 없음");
        return;
      }
      const db = admin.firestore();
      const startToday = getStartOfTodaySeoulTimestamp();
      let snap: admin.firestore.QuerySnapshot;
      try {
        snap = await db.collection("rides").where("date", "<", startToday).limit(400).get();
      } catch (e) {
        console.error("[scheduledRideAttendanceVerification] rides 조회 실패:", (e as Error).message);
        return;
      }
      let ok = 0;
      let fail = 0;
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data.attendanceVerificationRan === true) continue;
        if (String(data.rideStatus || "active") === "cancelled") continue;
        try {
          await executeVerifyAttendanceForEventId(db, doc.id, clientSecret.trim(), null);
          ok++;
        } catch (err) {
          fail++;
          console.warn("[scheduledRideAttendanceVerification] 건너뜀/실패:", doc.id, (err as Error).message);
        }
      }
      console.log("[scheduledRideAttendanceVerification] 완료", { ok, fail, scanned: snap.size });
    }
  );
}
