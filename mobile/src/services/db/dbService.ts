import {
  executeParallelDualWrite,
  executePrimaryThenSecondaryDualWrite,
  type DualWriteReporter,
} from "./dualWrite";
import { createDefaultErrorReporter } from "./errorReporter";
import {
  mapStravaActivityToRideRow,
  mapTrainingSessionToRideRow,
  mapUserPatchToSupabase,
} from "./mappers";
import {
  getSupabaseClient,
  type SupabaseClientOptions,
  type StelvioSupabase,
} from "./supabaseClient";
import {
  insertRide,
  isBenignSupabaseSkip,
  syncUserAfterTrainingSession,
  updateUserRow,
} from "./supabaseWriter";
import type {
  DbServiceConfig,
  FirebasePorts,
  FirebaseUserId,
  LogQueryOptions,
  SaveStravaActivityResult,
  SaveTrainingSessionResult,
  StravaActivityInput,
  TrainingLogRecord,
  TrainingSessionInput,
  UserProfile,
  UserProfilePatch,
} from "./types";
import { DEFAULT_UID_NAMESPACE } from "./uid";
import type { UidResolverConfig } from "./uid";

export interface InitDbServiceOptions extends SupabaseClientOptions {
  firebase: FirebasePorts;
  config: DbServiceConfig;
}

let firebasePorts: FirebasePorts | null = null;
let serviceConfig: DbServiceConfig | null = null;
let uidConfig: UidResolverConfig | null = null;
let supabase: StelvioSupabase | null = null;
let reporter: DualWriteReporter | null = null;

function requireInit(): {
  firebase: FirebasePorts;
  config: DbServiceConfig;
  uid: UidResolverConfig;
  supabase: StelvioSupabase;
  reporter: DualWriteReporter;
} {
  if (!firebasePorts || !serviceConfig || !uidConfig || !supabase || !reporter) {
    throw new Error(
      "dbService not initialized. Call initDbService() at app startup."
    );
  }
  return {
    firebase: firebasePorts,
    config: serviceConfig,
    uid: uidConfig,
    supabase,
    reporter,
  };
}

function buildReporter(config: DbServiceConfig): DualWriteReporter {
  const errorReporter =
    config.errorReporter ?? createDefaultErrorReporter();

  return {
    onSecondaryFailure(operation, error) {
      if (isBenignSupabaseSkip(error)) {
        return;
      }
      errorReporter.captureSecondaryFailure({
        operation,
        error,
      });
    },
  };
}

/**
 * 앱 시작 시 1회 호출. Firebase 포트(기존 Firestore 로직)를 주입합니다.
 */
export function initDbService(options: InitDbServiceOptions): void {
  firebasePorts = options.firebase;
  serviceConfig = options.config;
  uidConfig = {
    uidMode: options.config.uidMode ?? "v5",
    uidNamespace: options.config.uidNamespace ?? DEFAULT_UID_NAMESPACE,
  };
  supabase = getSupabaseClient(options.config, options);
  reporter = buildReporter(options.config);
}

/** 테스트/핫리로드용 */
export function resetDbServiceForTests(): void {
  firebasePorts = null;
  serviceConfig = null;
  uidConfig = null;
  supabase = null;
  reporter = null;
}

// -----------------------------------------------------------------------------
// Write API (Dual-Write — 읽기는 Firebase 전용)
// -----------------------------------------------------------------------------

/**
 * Stelvio 훈련 저장. Firestore 트랜잭션 후 Supabase rides/users 동기화.
 * (트랜잭션 특성상 병렬 allSettled 대신 primary-then-secondary)
 */
export async function saveTrainingSession(
  userId: FirebaseUserId,
  trainingData: TrainingSessionInput
): Promise<SaveTrainingSessionResult> {
  const { firebase, config, uid, supabase: sb, reporter: rpt } =
    requireInit();

  return executePrimaryThenSecondaryDualWrite(
    "saveTrainingSession",
    () => firebase.saveTrainingSession(userId, trainingData),
    async (result) => {
      const rideRow = mapTrainingSessionToRideRow(
        userId,
        result.trainingLogId,
        trainingData,
        result,
        uid
      );
      if (!rideRow) {
        throw new Error("mapTrainingSessionToRideRow failed");
      }
      await insertRide(sb, userId, rideRow, uid);

      const expiry =
        result.newExpiryDate != null
          ? String(result.newExpiryDate).slice(0, 10)
          : null;

      await syncUserAfterTrainingSession(
        sb,
        userId,
        {
          rem_points: result.newRemPoints,
          acc_points: result.newAccPoints,
          expiry_date: expiry,
          last_training_date: rideRow.ride_date,
        },
        uid
      );
    },
    rpt,
    config.dualWriteEnabled
  );
}

/**
 * Strava 활동 저장. Firestore와 Supabase rides에 병렬 기록.
 */
export async function saveStravaActivity(
  activity: StravaActivityInput
): Promise<SaveStravaActivityResult> {
  const { firebase, config, uid, supabase: sb, reporter: rpt } =
    requireInit();

  const firebaseUid = String(activity.user_id);
  const activityId = String(
    activity.activity_id || activity.id || ""
  ).trim();

  return executeParallelDualWrite(
    "saveStravaActivity",
    () => firebase.saveStravaActivity(activity),
    async () => {
      const rideRow = mapStravaActivityToRideRow(
        activity,
        activityId,
        uid
      );
      if (!rideRow) {
        throw new Error("mapStravaActivityToRideRow failed");
      }
      await insertRide(sb, firebaseUid, rideRow, uid);
    },
    rpt,
    config.dualWriteEnabled
  );
}

/**
 * 사용자 프로필 패치. Firestore 업데이트 + Supabase users 병렬.
 */
export async function updateUserProfile(
  userId: FirebaseUserId,
  patch: UserProfilePatch
): Promise<void> {
  const { firebase, config, uid, supabase: sb, reporter: rpt } =
    requireInit();

  const mapped = mapUserPatchToSupabase(userId, patch, uid);

  return executeParallelDualWrite(
    "updateUserProfile",
    () => firebase.updateUserProfile(userId, patch),
    async () => {
      if (!mapped) {
        throw new Error("mapUserPatchToSupabase failed");
      }
      await updateUserRow(sb, userId, mapped.id, mapped.row, uid);
    },
    rpt,
    config.dualWriteEnabled
  );
}

// -----------------------------------------------------------------------------
// Read API (Firebase only — Strangler 1단계)
// -----------------------------------------------------------------------------

export async function getUserTrainingLogs(
  userId: FirebaseUserId,
  options?: LogQueryOptions
): Promise<TrainingLogRecord[]> {
  const { firebase } = requireInit();
  return firebase.getUserTrainingLogs(userId, options);
}

export async function getUserProfile(
  userId: FirebaseUserId
): Promise<UserProfile | null> {
  const { firebase } = requireInit();
  return firebase.getUserProfile(userId);
}