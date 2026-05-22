export {
  initDbService,
  resetDbServiceForTests,
  saveTrainingSession,
  saveStravaActivity,
  updateUserProfile,
  getUserTrainingLogs,
  getUserProfile,
} from "./dbService";
export type { InitDbServiceOptions } from "./dbService";

export {
  initDualRunManager,
  getDualRunManager,
  resetDualRunManagerForTests,
  shouldRunSupabaseDualWrite,
  parseDualWriteStatus,
  REMOTE_CONFIG_KEY_STATUS,
  REMOTE_CONFIG_KEY_SHADOW_UIDS,
  REMOTE_CONFIG_KEY_CANARY_PERCENT,
} from "./DualRunManager";
export type {
  DualWriteStatus,
  DualRunManagerConfig,
  DualWriteDecision,
  RemoteConfigAdapter,
} from "./DualRunManager";

export { createDefaultErrorReporter } from "./errorReporter";
export { resolveUserUuid, DEFAULT_UID_NAMESPACE } from "./uid";
export { getSupabaseClient, resetSupabaseClientForTests } from "./supabaseClient";
export { isBenignSupabaseSkip, SupabaseWriteSkippedError } from "./supabaseWriter";

export type {
  DbServiceConfig,
  FirebasePorts,
  FirebaseUserId,
  TrainingSessionInput,
  TrainingLogInput,
  TrainingLogRecord,
  StravaActivityInput,
  SaveTrainingSessionResult,
  SaveStravaActivityResult,
  UserProfile,
  UserProfilePatch,
  LogQueryOptions,
  ErrorReporter,
  RideInsertRow,
} from "./types";
