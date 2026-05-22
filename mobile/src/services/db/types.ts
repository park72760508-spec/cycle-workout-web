/** Firebase Auth UID (28자) 또는 이미 이관된 uuid */
export type FirebaseUserId = string;

export type ActivitySource = "strava" | "stelvio" | "other";

export type GenderCode = "male" | "female" | "unknown";

export type ChallengeGoal =
  | "Fitness"
  | "GranFondo"
  | "Racing"
  | "Elite"
  | "PRO";

export type UserGrade = "admin" | "member" | "sub_admin";

export type AccountStatus = "active" | "withdrawn" | "suspended";

/** Firestore users/{uid}/logs 문서와 1:1 대응하는 입력 */
export interface TrainingLogInput {
  source?: ActivitySource;
  activity_id?: string;
  activity_type?: string | null;
  date: string;
  title?: string | null;
  workout_id?: string | null;
  duration_sec: number;
  distance_km?: number | null;
  elevation_gain?: number | null;
  avg_speed_kmh?: number | null;
  weight?: number | null;
  ftp_at_time?: number | null;
  avg_watts?: number | null;
  weighted_watts?: number | null;
  max_watts?: number | null;
  tss?: number;
  if?: number | null;
  kilojoules?: number | null;
  earned_points?: number;
  avg_hr?: number | null;
  max_hr?: number | null;
  avg_cadence?: number | null;
  efficiency_factor?: number | null;
  rpe?: number | null;
  max_1min_watts?: number | null;
  max_5min_watts?: number | null;
  max_10min_watts?: number | null;
  max_20min_watts?: number | null;
  max_30min_watts?: number | null;
  max_40min_watts?: number | null;
  max_60min_watts?: number | null;
  max_hr_1min?: number | null;
  max_hr_5min?: number | null;
  max_hr_10min?: number | null;
  max_hr_20min?: number | null;
  max_hr_40min?: number | null;
  max_hr_60min?: number | null;
  tss_applied?: boolean;
  created_at?: string;
}

/** Stelvio 앱 훈련 저장 (trainingResultService.saveTrainingSession) */
export interface TrainingSessionInput {
  duration: number;
  weighted_watts?: number | null;
  avg_watts?: number | null;
  distance_km?: number | null;
  elevation_gain?: number | null;
  workout_id?: string | null;
  title?: string | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  avg_cadence?: number | null;
  kilojoules?: number | null;
  rpe?: number | null;
  powerData?: number[];
  date?: string;
  [key: string]: unknown;
}

export interface SaveTrainingSessionResult {
  success: boolean;
  earnedPoints: number;
  extendedDays: number;
  newRemPoints: number;
  newAccPoints: number;
  newExpiryDate: string | null;
  trainingLogId: string;
}

export interface StravaActivityInput extends TrainingLogInput {
  user_id: FirebaseUserId;
  id?: string;
}

export interface SaveStravaActivityResult {
  success: boolean;
  id: string;
  activityId?: string;
  isNew: boolean;
}

export interface UserProfilePatch {
  name?: string;
  display_name?: string;
  ftp?: number;
  weight_kg?: number;
  rem_points?: number;
  acc_points?: number;
  expiry_date?: string | null;
  last_training_date?: string | null;
  challenge?: ChallengeGoal;
  is_private?: boolean;
  profile_image_url?: string | null;
  max_hr?: number | null;
  [key: string]: unknown;
}

export interface UserProfile {
  id: FirebaseUserId;
  name?: string;
  display_name?: string;
  ftp?: number;
  weight?: number;
  rem_points?: number;
  acc_points?: number;
  expiry_date?: string | null;
  [key: string]: unknown;
}

export interface TrainingLogRecord extends TrainingLogInput {
  id: string;
  user_id?: FirebaseUserId;
}

export interface LogQueryOptions {
  limit?: number;
  startAfter?: unknown;
}

/** Supabase public.rides INSERT 행 (클라이언트 dual-write) */
export interface RideInsertRow {
  user_id: string;
  source: ActivitySource;
  activity_id: string;
  activity_type?: string | null;
  title?: string | null;
  ride_date: string;
  workout_id?: string | null;
  duration_sec: number;
  distance_km?: number | null;
  elevation_gain_m?: number | null;
  avg_speed_kmh?: number | null;
  weight_at_ride_kg?: number | null;
  ftp_at_time?: number | null;
  avg_watts?: number | null;
  weighted_watts?: number | null;
  max_watts?: number | null;
  tss: number;
  intensity_factor?: number | null;
  kilojoules?: number | null;
  earned_points: number;
  avg_hr?: number | null;
  max_hr?: number | null;
  avg_cadence?: number | null;
  efficiency_factor?: number | null;
  rpe?: number | null;
  max_1min_watts?: number | null;
  max_5min_watts?: number | null;
  max_10min_watts?: number | null;
  max_20min_watts?: number | null;
  max_30min_watts?: number | null;
  max_40min_watts?: number | null;
  max_60min_watts?: number | null;
  max_hr_1min?: number | null;
  max_hr_5min?: number | null;
  max_hr_10min?: number | null;
  max_hr_20min?: number | null;
  max_hr_40min?: number | null;
  max_hr_60min?: number | null;
  tss_applied?: boolean;
}

/** Supabase public.users UPDATE (RLS: auth.uid() = id) */
export interface UserUpdateRow {
  ftp?: number;
  weight_kg?: number;
  rem_points?: number;
  acc_points?: number;
  expiry_date?: string | null;
  last_training_date?: string | null;
  name?: string;
  display_name?: string;
  challenge?: ChallengeGoal;
  is_private?: boolean;
  profile_image_url?: string | null;
  max_hr?: number | null;
  updated_at?: string;
}

export type DualWriteOperation =
  | "saveTrainingSession"
  | "saveStravaActivity"
  | "updateUserProfile"
  | "upsertTrainingLog";

export interface SecondaryWriteFailureContext {
  operation: DualWriteOperation;
  error: unknown;
  firebaseUserId?: string;
  supabaseUserId?: string | null;
}

export interface ErrorReporter {
  captureSecondaryFailure: (ctx: SecondaryWriteFailureContext) => void;
}

export interface DbServiceConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** 마이그레이션과 동일 (기본 DNS namespace) */
  uidNamespace?: string;
  uidMode?: "v5" | "literal";
  errorReporter?: ErrorReporter;
}

/** 앱이 주입하는 Firestore 쓰기/읽기 포트 */
export interface FirebasePorts {
  saveTrainingSession: (
    userId: FirebaseUserId,
    data: TrainingSessionInput
  ) => Promise<SaveTrainingSessionResult>;
  saveStravaActivity: (
    activity: StravaActivityInput
  ) => Promise<SaveStravaActivityResult>;
  updateUserProfile: (
    userId: FirebaseUserId,
    patch: UserProfilePatch
  ) => Promise<void>;
  getUserTrainingLogs: (
    userId: FirebaseUserId,
    options?: LogQueryOptions
  ) => Promise<TrainingLogRecord[]>;
  getUserProfile: (
    userId: FirebaseUserId
  ) => Promise<UserProfile | null>;
}
