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
