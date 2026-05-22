import type {
  ActivitySource,
  RideInsertRow,
  SaveTrainingSessionResult,
  StravaActivityInput,
  TrainingLogInput,
  TrainingSessionInput,
  UserProfilePatch,
  UserUpdateRow,
} from "./types";
import type { UidResolverConfig } from "./uid";
import { resolveUserUuid } from "./uid";

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

export function mapActivitySource(raw: unknown): ActivitySource {
  const s = str(raw)?.toLowerCase();
  if (s === "strava") return "strava";
  if (s === "stelvio") return "stelvio";
  return "other";
}

/** YYYY-MM-DD (Firestore date 필드·ISO 문자열) */
export function toRideDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1] ?? null;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
    return null;
  }
  if (typeof raw === "object" && raw !== null && "toDate" in raw) {
    const d = (raw as { toDate: () => Date }).toDate();
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export function buildStelvioActivityId(logDocId: string): string {
  return `stelvio:${logDocId}`;
}

export function mapTrainingLogToRideRow(
  firebaseUid: string,
  logDocId: string,
  log: TrainingLogInput,
  uidConfig: UidResolverConfig
): RideInsertRow | null {
  const userId = resolveUserUuid(firebaseUid, uidConfig);
  const rideDate = toRideDate(log.date);
  if (!userId || !rideDate) return null;

  const source = mapActivitySource(log.source ?? "stelvio");
  let activityId = str(log.activity_id);
  if (!activityId) {
    activityId =
      source === "strava" ? logDocId : buildStelvioActivityId(logDocId);
  }

  const duration =
    int(log.duration_sec) ||
    int((log as { time?: number }).time) ||
    0;

  return {
    user_id: userId,
    source,
    activity_id: activityId,
    activity_type: str(log.activity_type),
    title: str(log.title),
    ride_date: rideDate,
    workout_id: str(log.workout_id),
    duration_sec: duration,
    distance_km: num(log.distance_km),
    elevation_gain_m: num(log.elevation_gain),
    avg_speed_kmh: num(log.avg_speed_kmh),
    weight_at_ride_kg: num(log.weight),
    ftp_at_time: num(log.ftp_at_time),
    avg_watts: num(log.avg_watts),
    weighted_watts: num(log.weighted_watts),
    max_watts: num(log.max_watts),
    tss: num(log.tss) ?? 0,
    intensity_factor: num(log.if),
    kilojoules: num(log.kilojoules),
    earned_points: int(log.earned_points, 0),
    avg_hr: int(log.avg_hr, 0) || null,
    max_hr: int(log.max_hr, 0) || null,
    avg_cadence: int(log.avg_cadence, 0) || null,
    efficiency_factor: num(log.efficiency_factor),
    rpe: int(log.rpe, 0) || null,
    max_1min_watts: num(log.max_1min_watts),
    max_5min_watts: num(log.max_5min_watts),
    max_10min_watts: num(log.max_10min_watts),
    max_20min_watts: num(log.max_20min_watts),
    max_30min_watts: num(log.max_30min_watts),
    max_40min_watts: num(log.max_40min_watts),
    max_60min_watts: num(log.max_60min_watts),
    max_hr_1min: int(log.max_hr_1min, 0) || null,
    max_hr_5min: int(log.max_hr_5min, 0) || null,
    max_hr_10min: int(log.max_hr_10min, 0) || null,
    max_hr_20min: int(log.max_hr_20min, 0) || null,
    max_hr_40min: int(log.max_hr_40min, 0) || null,
    max_hr_60min: int(log.max_hr_60min, 0) || null,
    tss_applied: Boolean(log.tss_applied),
  };
}

export function mapStravaActivityToRideRow(
  activity: StravaActivityInput,
  logDocId: string,
  uidConfig: UidResolverConfig
): RideInsertRow | null {
  const userId = String(activity.user_id || "").trim();
  if (!userId) return null;
  return mapTrainingLogToRideRow(userId, logDocId, activity, uidConfig);
}

export function mapTrainingSessionToRideRow(
  firebaseUid: string,
  trainingLogId: string,
  data: TrainingSessionInput,
  result: SaveTrainingSessionResult,
  uidConfig: UidResolverConfig
): RideInsertRow | null {
  const rideDate =
    toRideDate(data.date) ?? toRideDate(new Date().toISOString());
  if (!rideDate) return null;

  const log: TrainingLogInput = {
    source: "stelvio",
    date: rideDate,
    duration_sec: Number(data.duration) || 0,
    distance_km: num(data.distance_km),
    elevation_gain: num(data.elevation_gain),
    weighted_watts: num(data.weighted_watts) ?? 0,
    avg_watts: num(data.avg_watts),
    workout_id: str(data.workout_id),
    title: str(data.title),
    tss: result.earnedPoints,
    earned_points: result.earnedPoints,
    activity_id: buildStelvioActivityId(trainingLogId),
    tss_applied: false,
    created_at: new Date().toISOString(),
  };

  return mapTrainingLogToRideRow(firebaseUid, trainingLogId, log, uidConfig);
}

export function mapUserPatchToSupabase(
  firebaseUid: string,
  patch: UserProfilePatch,
  uidConfig: UidResolverConfig
): { id: string; row: UserUpdateRow } | null {
  const id = resolveUserUuid(firebaseUid, uidConfig);
  if (!id) return null;

  const row: UserUpdateRow = { updated_at: new Date().toISOString() };

  if (patch.name !== undefined) row.name = String(patch.name);
  if (patch.display_name !== undefined) {
    row.display_name = str(patch.display_name) ?? undefined;
  }
  if (patch.ftp !== undefined) row.ftp = num(patch.ftp) ?? undefined;
  if (patch.weight_kg !== undefined) {
    row.weight_kg = num(patch.weight_kg) ?? undefined;
  } else if (patch.weight !== undefined) {
    row.weight_kg = num(patch.weight) ?? undefined;
  }
  if (patch.rem_points !== undefined) row.rem_points = int(patch.rem_points);
  if (patch.acc_points !== undefined) row.acc_points = int(patch.acc_points);
  if (patch.expiry_date !== undefined) {
    row.expiry_date = patch.expiry_date
      ? toRideDate(patch.expiry_date)
      : null;
  }
  if (patch.last_training_date !== undefined) {
    row.last_training_date = patch.last_training_date
      ? toRideDate(patch.last_training_date)
      : null;
  }
  if (patch.challenge !== undefined) row.challenge = patch.challenge;
  if (patch.is_private !== undefined) row.is_private = Boolean(patch.is_private);
  if (patch.profile_image_url !== undefined) {
    row.profile_image_url = patch.profile_image_url;
  }
  if (patch.max_hr !== undefined) {
    row.max_hr = patch.max_hr == null ? null : int(patch.max_hr);
  }

  return { id, row };
}
