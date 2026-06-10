import type { DocumentData } from "firebase-admin/firestore";
import type { MigrationConfig } from "./config.js";
import { toDateOnly, toRideDate, toTimeOnly, toTimestamptz } from "./timestamp.js";
import { resolveOpenRideUuid, resolveUserUuid } from "./uid.js";

type Doc = DocumentData;

function num(v: unknown, fallback: number | null = null): number | null {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v: unknown, fallback = 0): number {
  const n = num(v, fallback);
  return n == null ? fallback : Math.trunc(n);
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function mapGender(raw: unknown): "male" | "female" | "unknown" {
  const s = str(raw)?.toLowerCase() ?? "";
  if (["m", "male", "남", "남성"].includes(s)) return "male";
  if (["f", "female", "여", "여성"].includes(s)) return "female";
  return "unknown";
}

export function mapChallenge(raw: unknown): string {
  const s = str(raw);
  const allowed = ["Fitness", "GranFondo", "Racing", "Elite", "PRO"];
  if (s && allowed.includes(s)) return s;
  return "Fitness";
}

export function mapGrade(raw: unknown): "admin" | "member" | "sub_admin" {
  const g = String(raw ?? "2");
  if (g === "1") return "admin";
  if (g === "3") return "sub_admin";
  return "member";
}

export function mapAccountStatus(raw: unknown): "active" | "withdrawn" | "suspended" {
  const s = str(raw)?.toLowerCase();
  if (s === "withdrawn") return "withdrawn";
  if (s === "suspended") return "suspended";
  return "active";
}

export function mapActivitySource(raw: unknown): "strava" | "stelvio" | "other" {
  const s = str(raw)?.toLowerCase();
  if (s === "strava") return "strava";
  if (s === "stelvio") return "stelvio";
  return "other";
}

export function mapUserRow(
  firebaseUid: string,
  d: Doc,
  config: MigrationConfig
): Record<string, unknown> | null {
  const id = resolveUserUuid(firebaseUid, config);
  if (!id) return null;

  const weight =
    num(d.weight) ?? num(d.weightKg) ?? num(d.weight_kg) ?? 0;

  return {
    id,
    name: str(d.name) ?? str(d.displayName) ?? str(d.user_name) ?? "",
    display_name: str(d.displayName) ?? str(d.display_name),
    contact: str(d.contact) ?? str(d.phone) ?? str(d.phoneNumber) ?? str(d.tel),
    phone: str(d.phone) ?? str(d.phoneNumber) ?? str(d.tel),
    email: str(d.email),
    ftp: num(d.ftp) ?? 0,
    ftp_updated_at: toTimestamptz(d.ftp_updated_at),
    weight_kg: weight,
    birth_year: int(d.birth_year ?? d.birthYear, 0) || null,
    gender: mapGender(d.gender ?? d.sex),
    challenge: mapChallenge(d.challenge),
    grade: mapGrade(d.grade),
    account_status: mapAccountStatus(d.account_status),
    expiry_date: toDateOnly(d.expiry_date ?? d.subscription_end_date),
    acc_points: int(d.acc_points, 0),
    rem_points: int(d.rem_points, 0),
    last_training_date: toDateOnly(d.last_training_date),
    is_private: Boolean(d.is_private),
    profile_image_url: str(d.profileImageUrl) ?? str(d.profile_image_url),
    max_hr: int(d.max_hr ?? d.maxHr, 0) || null,
    created_at: toTimestamptz(d.created_at) ?? new Date().toISOString(),
    updated_at: toTimestamptz(d.updated_at ?? d.lastLogin) ?? new Date().toISOString(),
  };
}

export function mapStravaConnectionRow(
  firebaseUid: string,
  d: Doc,
  config: MigrationConfig
): Record<string, unknown> | null {
  const userId = resolveUserUuid(firebaseUid, config);
  const access = str(d.strava_access_token);
  const refresh = str(d.strava_refresh_token);
  if (!userId || !access || !refresh) return null;

  const expiresAt =
    toTimestamptz(d.strava_expires_at) ??
    (num(d.strava_expires_at)
      ? new Date(Number(d.strava_expires_at) * 1000).toISOString()
      : new Date().toISOString());

  return {
    user_id: userId,
    strava_athlete_id: num(d.strava_athlete_id) != null ? int(d.strava_athlete_id) : null,
    access_token: access,
    refresh_token: refresh,
    expires_at: expiresAt,
    connected_at: toTimestamptz(d.updated_at) ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function mapRideRow(
  firebaseUid: string,
  logDocId: string,
  d: Doc,
  config: MigrationConfig
): Record<string, unknown> | null {
  const userId = resolveUserUuid(firebaseUid, config);
  const rideDate = toRideDate(d.date);
  if (!userId || !rideDate) return null;

  const source = mapActivitySource(d.source);
  let activityId = str(d.activity_id);
  if (!activityId && source === "strava") {
    activityId = logDocId;
  }
  if (!activityId) {
    activityId = `stelvio:${logDocId}`;
  }

  const duration =
    int(d.duration_sec) ||
    int(d.time) ||
    (num(d.duration_min) != null ? Math.round(Number(d.duration_min) * 60) : 0);

  return {
    user_id: userId,
    source,
    activity_id: activityId,
    activity_type: str(d.activity_type),
    title: str(d.title),
    ride_date: rideDate,
    workout_id: str(d.workout_id),
    duration_sec: duration,
    distance_km: num(d.distance_km),
    elevation_gain_m: num(d.elevation_gain),
    summary_polyline: str(d.summary_polyline),
    elevation_profile_json:
      d.elevation_profile != null
        ? d.elevation_profile
        : d.elevation_profile_json != null
          ? d.elevation_profile_json
          : null,
    route_profile_updated_at: d.route_profile_updated_at || null,
    avg_speed_kmh: num(d.avg_speed_kmh),
    weight_at_ride_kg: num(d.weight),
    ftp_at_time: num(d.ftp_at_time),
    avg_watts: num(d.avg_watts ?? d.avg_power),
    weighted_watts: num(d.weighted_watts ?? d.np),
    max_watts: num(d.max_watts),
    tss: num(d.tss) ?? 0,
    intensity_factor: num(d.if),
    kilojoules: num(d.kilojoules),
    earned_points: int(d.earned_points, 0),
    avg_hr: int(d.avg_hr, 0) || null,
    max_hr: int(d.max_hr ?? d.max_heartrate, 0) || null,
    avg_cadence: int(d.avg_cadence, 0) || null,
    efficiency_factor: num(d.efficiency_factor),
    rpe: int(d.rpe, 0) || null,
    max_1min_watts: num(d.max_1min_watts),
    max_5min_watts: num(d.max_5min_watts),
    max_10min_watts: num(d.max_10min_watts),
    max_20min_watts: num(d.max_20min_watts),
    max_30min_watts: num(d.max_30min_watts),
    max_40min_watts: num(d.max_40min_watts),
    max_60min_watts: num(d.max_60min_watts),
    max_hr_5sec: int(d.max_hr_5sec, 0) || int(d.max_hr ?? d.max_heartrate, 0) || null,
    max_hr_1min: int(d.max_hr_1min, 0) || null,
    max_hr_5min: int(d.max_hr_5min, 0) || null,
    max_hr_10min: int(d.max_hr_10min, 0) || null,
    max_hr_20min: int(d.max_hr_20min, 0) || null,
    max_hr_40min: int(d.max_hr_40min, 0) || null,
    max_hr_60min: int(d.max_hr_60min, 0) || null,
    tss_applied: Boolean(d.tss_applied),
    tss_applied_at: toTimestamptz(d.tss_applied_at),
    time_in_zones_json:
      d.time_in_zones && typeof d.time_in_zones === "object"
        ? d.time_in_zones
        : null,
    created_at: toTimestamptz(d.created_at) ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function mapDailySummaryRow(
  firebaseUid: string,
  ymd: string,
  d: Doc,
  config: MigrationConfig
): Record<string, unknown> | null {
  const userId = resolveUserUuid(firebaseUid, config);
  if (!userId) return null;
  const summaryDate = toRideDate(d.ymd ?? ymd);
  if (!summaryDate) return null;

  return {
    user_id: userId,
    summary_date: summaryDate,
    tss_strava_sum: num(d.tss_strava_sum) ?? 0,
    tss_stelvio_sum: num(d.tss_stelvio_sum) ?? 0,
    km_strava_sum: num(d.km_strava_sum) ?? 0,
    km_stelvio_sum: num(d.km_stelvio_sum) ?? 0,
    weight_used_kg: num(d.weight_used_kg),
    max_1min_watts: num(d.max_1min_watts) ?? 0,
    max_5min_watts: num(d.max_5min_watts) ?? 0,
    max_10min_watts: num(d.max_10min_watts) ?? 0,
    max_20min_watts: num(d.max_20min_watts) ?? 0,
    max_40min_watts: num(d.max_40min_watts) ?? 0,
    max_60min_watts: num(d.max_60min_watts) ?? 0,
    max_watts: num(d.max_watts) ?? 0,
    max_hr_1min: int(d.max_hr_1min, 0),
    max_hr_5min: int(d.max_hr_5min, 0),
    max_hr_10min: int(d.max_hr_10min, 0),
    max_hr_20min: int(d.max_hr_20min, 0),
    max_hr_40min: int(d.max_hr_40min, 0),
    max_hr_60min: int(d.max_hr_60min, 0),
    reconciled_at: toTimestamptz(d.reconciled_at) ?? new Date().toISOString(),
  };
}

export function mapYearlyPeakRow(
  firebaseUid: string,
  yearKey: string,
  d: Doc,
  config: MigrationConfig
): Record<string, unknown> | null {
  const userId = resolveUserUuid(firebaseUid, config);
  const year = int(d.year ?? yearKey, 0);
  if (!userId || year < 1900) return null;

  return {
    user_id: userId,
    year,
    weight_kg: num(d.weight_kg),
    max_hr: int(d.max_hr, 0) || null,
    max_hr_date: toDateOnly(d.max_hr_date),
    max_1min_watts: num(d.max_1min_watts),
    max_1min_wkg: num(d.max_1min_wkg),
    max_5min_watts: num(d.max_5min_watts),
    max_5min_wkg: num(d.max_5min_wkg),
    max_10min_watts: num(d.max_10min_watts),
    max_10min_wkg: num(d.max_10min_wkg),
    max_20min_watts: num(d.max_20min_watts),
    max_20min_wkg: num(d.max_20min_wkg),
    max_40min_watts: num(d.max_40min_watts),
    max_40min_wkg: num(d.max_40min_wkg),
    max_60min_watts: num(d.max_60min_watts),
    max_60min_wkg: num(d.max_60min_wkg),
    max_watts: num(d.max_watts),
    max_wkg: num(d.max_wkg),
    updated_at: toTimestamptz(d.updated_at) ?? new Date().toISOString(),
  };
}

export function mapFriendRow(
  firebaseUid: string,
  friendUid: string,
  d: Doc,
  config: MigrationConfig
): Record<string, unknown> | null {
  const userId = resolveUserUuid(firebaseUid, config);
  const friendUserId = resolveUserUuid(
    str(d.friendUid) ?? friendUid,
    config
  );
  if (!userId || !friendUserId || userId === friendUserId) return null;

  return {
    user_id: userId,
    friend_user_id: friendUserId,
    display_name: str(d.displayName),
    contact: str(d.contact),
    created_at: toTimestamptz(d.updatedAt) ?? new Date().toISOString(),
  };
}

export function mapUserOrderRow(
  firebaseUid: string,
  productOrderId: string,
  d: Doc,
  config: MigrationConfig
): Record<string, unknown> | null {
  const userId = resolveUserUuid(firebaseUid, config);
  if (!userId) return null;

  return {
    user_id: userId,
    product_order_id: str(d.productOrderId) ?? productOrderId,
    product_name: str(d.productName),
    product_option: str(d.productOption),
    quantity: int(d.quantity, 0) || null,
    payment_date: toTimestamptz(d.paymentDate),
    status: str(d.status) ?? "PAYED",
    claim_date: toTimestamptz(d.claimDate),
    claim_reason: str(d.claimReason),
    created_at: new Date().toISOString(),
  };
}

export function mapProcessedOrderRow(
  d: Doc,
  config: MigrationConfig
): Record<string, unknown> | null {
  const userId = resolveUserUuid(String(d.userId ?? ""), config);
  const productOrderId = str(d.productOrderId);
  if (!userId || !productOrderId) return null;

  return {
    product_order_id: productOrderId,
    user_id: userId,
    added_days: int(d.addedDays, 0),
    order_type: str(d.type) ?? "PAYED",
    processed_at: toTimestamptz(d.processedAt) ?? new Date().toISOString(),
    revoked: Boolean(d.revoked),
    revoked_at: toTimestamptz(d.revokedAt),
  };
}

export function mapPointHistoryRow(
  docId: string,
  d: Doc,
  config: MigrationConfig
): Record<string, unknown> | null {
  const userId = resolveUserUuid(String(d.user_id ?? d.userId ?? ""), config);
  if (!userId) return null;

  const src = mapActivitySource(d.source);
  return {
    user_id: userId,
    source: src,
    is_strava: Boolean(d.is_strava ?? src === "strava"),
    tss: num(d.tss) ?? 0,
    earned_points: int(d.earned_points, 0),
    points_before: int(d.points_before, 0),
    points_after: int(d.points_after, 0),
    ride_id: null,
    created_at: toTimestamptz(d.created_at) ?? new Date().toISOString(),
    _firestore_id: docId,
  };
}

export function mapOpenRideRow(
  firestoreDocId: string,
  d: Doc,
  config: MigrationConfig
): Record<string, unknown> | null {
  const hostRaw = str(d.hostUserId) ?? str(d.host_user_id);
  const hostUserId = hostRaw ? resolveUserUuid(hostRaw, config) : null;
  const rideDate = toRideDate(d.date);
  if (!hostUserId || !rideDate) return null;

  const statusRaw = str(d.rideStatus)?.toLowerCase();
  let status = "active";
  if (statusRaw === "cancelled") status = "cancelled";
  else if (statusRaw === "completed") status = "completed";

  return {
    id: resolveOpenRideUuid(firestoreDocId, config),
    host_user_id: hostUserId,
    title: str(d.title) ?? "",
    ride_date: rideDate,
    departure_time: toTimeOnly(d.departureTime) ?? "09:00:00",
    departure_location: str(d.departureLocation) ?? "",
    distance_km: num(d.distance) ?? 0,
    course: str(d.course) ?? "",
    level: str(d.level) ?? "",
    max_participants: int(d.maxParticipants, 0),
    host_name: str(d.hostName) ?? "",
    contact_info: str(d.contactInfo) ?? "",
    is_contact_public: Boolean(d.isContactPublic),
    gpx_url: str(d.gpxUrl),
    region: str(d.region) ?? "",
    status,
    created_at: toTimestamptz(d.createdAt) ?? new Date().toISOString(),
    updated_at: toTimestamptz(d.updatedAt) ?? new Date().toISOString(),
    _participants: Array.isArray(d.participants) ? d.participants : [],
    _waitlist: Array.isArray(d.waitlist) ? d.waitlist : [],
  };
}
