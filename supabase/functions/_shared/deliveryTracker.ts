// 중고랜드 — Delivery Tracker(tracker.delivery) V2 GraphQL 어댑터.
//
// 2026-10-09 도입. 기존 deliveryapi.co.kr(송장 1건당 구독 과금)을 점진적으로 대체하기 위한 1차
// 조회 공급자다. 기존 화면·에스크로 로직은 market_orders의 delivery_status(DELIVERED 등 내부
// 코드)·delivery_status_text·delivered_at만 보므로, 여기서 V2 응답을 그 내부 규격으로 변환한다.
//
// - 엔드포인트: {DELIVERY_TRACKER_BASE_URL}/graphql (기본 https://apis.tracker.delivery)
//   자체 호스팅(Docker) 전환 시 Base URL만 바꾸면 된다. 자체 호스팅 서버는 인증이 없으므로
//   Client ID/Secret이 비어 있어도 Base URL이 기본값이 아니면 활성으로 본다.
// - 인증: Authorization: TRACKQL-API-KEY {CLIENT_ID}:{CLIENT_SECRET}
//   (Edge Function secrets: DELIVERY_TRACKER_CLIENT_ID / DELIVERY_TRACKER_CLIENT_SECRET)
// - 구 V1 REST(apis.tracker.delivery/carriers/{id}/tracks/{no})는 공식 deprecated(테스트 전용)라
//   사용하지 않는다.
// - 설정이 없거나 조회가 실패하면 호출 측이 기존 deliveryapi.co.kr 경로로 폴백한다.

export const DEFAULT_DELIVERY_TRACKER_BASE_URL = "https://apis.tracker.delivery";

/** 배송 중 송장 재조회 최소 간격(외부 API rate limit·과호출 방지). */
export const TRACKER_CACHE_TTL_MS = 30 * 60 * 1000;

/** 중고랜드 택배사 코드(판매자 선택값) → Delivery Tracker carrierId. */
export const MARKET_TO_TRACKER_CARRIER: Record<string, string> = {
  cj: "kr.cjlogistics",
  post: "kr.epost",
  hanjin: "kr.hanjin",
  logen: "kr.logen",
  lotte: "kr.lotte",
  daesin: "kr.daesin",
  kyungdong: "kr.kdexp",
  hapdong: "kr.hdexp",
  coupang: "kr.coupangls",
  woori: "kr.cway",
};

export function toTrackerCarrierId(courierCode: string): string | null {
  return MARKET_TO_TRACKER_CARRIER[String(courierCode || "").trim()] || null;
}

/** V2 TrackEventStatusCode → 기존 내부 delivery_status 코드(deliveryapi 규격과 동일 집합). */
const STATUS_MAP: Record<string, string> = {
  UNKNOWN: "UNKNOWN",
  INFORMATION_RECEIVED: "REGISTERED",
  AT_PICKUP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  ATTEMPT_FAIL: "FAILED",
  DELIVERED: "DELIVERED",
  AVAILABLE_FOR_PICKUP: "HOLD",
  EXCEPTION: "HOLD",
};

const STATUS_TEXT_FALLBACK: Record<string, string> = {
  UNKNOWN: "상태 확인 중",
  REGISTERED: "송장 접수",
  PICKED_UP: "집하 완료",
  IN_TRANSIT: "배송 중",
  OUT_FOR_DELIVERY: "배송 출발",
  FAILED: "배달 실패",
  DELIVERED: "배달 완료",
  HOLD: "보관·확인 필요",
};

export type TrackerEvent = { time: string | null; code: string; status: string; text: string; location: string; description: string };
export type TrackerResult = {
  status: string;
  statusText: string;
  isDelivered: boolean;
  lastEventAt: string | null;
  events: TrackerEvent[];
};

// 관리자가 중고랜드 마이페이지 "환경" 탭에서 등록한 키(Vault) — 환경변수보다 우선한다.
let dbClientId = "";
let dbClientSecret = "";
let dbLoadedAt = 0;

/** Vault 키를 읽어 둔다(인스턴스당 5분 캐시). 호출 측은 isTrackerEnabled() 전에 한 번 부른다. */
// deno-lint-ignore no-explicit-any
export async function loadTrackerCredentials(admin: any): Promise<void> {
  if (Date.now() - dbLoadedAt < 5 * 60 * 1000) return;
  try {
    const { data } = await admin.rpc("get_delivery_tracker_credentials").maybeSingle();
    dbClientId = String(data?.client_id || "").trim();
    dbClientSecret = String(data?.client_secret || "").trim();
    dbLoadedAt = Date.now();
  } catch (_e) {
    // Vault 조회 실패 시 환경변수만 사용
  }
}

/** 실제 호출 결과를 관리자 화면 상태에 남긴다(만료·인증 실패 감지). */
// deno-lint-ignore no-explicit-any
export async function reportTrackerVerify(admin: any, ok: boolean, error?: string): Promise<void> {
  try {
    await admin.rpc("mark_delivery_tracker_verify", { p_ok: ok, p_error: error || null });
  } catch (_e) {
    // best-effort
  }
}

function config() {
  const baseUrl = (Deno.env.get("DELIVERY_TRACKER_BASE_URL") || DEFAULT_DELIVERY_TRACKER_BASE_URL).replace(/\/+$/, "");
  const clientId = dbClientId || (Deno.env.get("DELIVERY_TRACKER_CLIENT_ID") || "").trim();
  const clientSecret = dbClientSecret || (Deno.env.get("DELIVERY_TRACKER_CLIENT_SECRET") || "").trim();
  const selfHosted = baseUrl !== DEFAULT_DELIVERY_TRACKER_BASE_URL;
  return { baseUrl, clientId, clientSecret, enabled: selfHosted || !!(clientId && clientSecret) };
}

/** Client ID/Secret(또는 자체 호스팅 Base URL)이 설정돼 있을 때만 true. */
export function isTrackerEnabled(): boolean {
  return config().enabled;
}

const TRACK_QUERY = `query Track($carrierId: ID!, $trackingNumber: String!) {
  track(carrierId: $carrierId, trackingNumber: $trackingNumber) {
    lastEvent { time status { code name } description location { name } }
    events(last: 30) { edges { node { time status { code name } description location { name } } } }
  }
}`;

function mapEvent(node: Record<string, any> | null | undefined): TrackerEvent | null {
  if (!node) return null;
  const code = String(node.status?.code || "UNKNOWN");
  const status = STATUS_MAP[code] || "UNKNOWN";
  return {
    time: node.time ? String(node.time) : null,
    code,
    status,
    text: String(node.status?.name || "").trim() || STATUS_TEXT_FALLBACK[status] || "",
    location: String(node.location?.name || "").trim(),
    description: String(node.description || "").trim(),
  };
}

export class TrackerNotFoundError extends Error {}
/** 키 만료(무료 플랜 21일)·잘못된 키 — 관리자 재등록이 필요하다. */
export class TrackerAuthError extends Error {}

/**
 * 송장 1건 조회 → 내부 규격으로 변환. 미설정이면 null(호출 측 폴백), 송장 미존재는
 * TrackerNotFoundError, 그 외 네트워크·인증 오류는 일반 Error를 던진다.
 */
export async function trackShipment(courierCode: string, trackingNumber: string): Promise<TrackerResult | null> {
  const cfg = config();
  if (!cfg.enabled) return null;
  const carrierId = toTrackerCarrierId(courierCode);
  if (!carrierId) return null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.clientId && cfg.clientSecret) {
    headers.Authorization = `TRACKQL-API-KEY ${cfg.clientId}:${cfg.clientSecret}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000); // 문서 권장 최대 timeout 15초
  let json: Record<string, any>;
  try {
    const res = await fetch(`${cfg.baseUrl}/graphql`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: TRACK_QUERY, variables: { carrierId, trackingNumber } }),
      signal: ctrl.signal,
    });
    json = await res.json().catch(() => ({}));
    if ((res.status === 401 || res.status === 403) && !json?.errors) throw new TrackerAuthError(`Delivery Tracker HTTP ${res.status}`);
    if (!res.ok && !json?.errors) throw new Error(`Delivery Tracker HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }

  const errors = Array.isArray(json?.errors) ? json.errors : [];
  if (errors.length) {
    const code = String(errors[0]?.extensions?.code || "");
    const msg = String(errors[0]?.message || code || "Delivery Tracker 오류");
    if (code === "NOT_FOUND") throw new TrackerNotFoundError(msg);
    if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") throw new TrackerAuthError(`Delivery Tracker 인증 실패(${code}): ${msg}`);
    throw new Error(`Delivery Tracker: ${msg}`);
  }
  const track = json?.data?.track;
  if (!track) throw new TrackerNotFoundError("tracking number not found");

  const events = ((track.events?.edges || []) as Record<string, any>[])
    .map((e) => mapEvent(e?.node))
    .filter((e): e is TrackerEvent => !!e);
  // lastEvent는 이상 순서(배달완료 뒤 배송출발 등)에서도 DELIVERED를 우선하는 공식 "현재 상태" 필드.
  const last = mapEvent(track.lastEvent) || events[events.length - 1] || null;
  const status = last ? last.status : "REGISTERED";
  return {
    status,
    statusText: last ? (last.location ? `${last.text} (${last.location})` : last.text) : STATUS_TEXT_FALLBACK.REGISTERED,
    isDelivered: status === "DELIVERED",
    lastEventAt: last?.time || null,
    events,
  };
}

/**
 * 캐시 판단: 배달완료는 영구 확정(재조회 금지), 배송 중은 마지막 조회 후 30분 이내면 생략.
 */
export function shouldSkipTrackerCheck(status: string | null | undefined, checkedAt: string | null | undefined, now = Date.now()): boolean {
  if (status === "DELIVERED") return true;
  const t = checkedAt ? Date.parse(checkedAt) : NaN;
  return Number.isFinite(t) && now - t < TRACKER_CACHE_TTL_MS;
}
