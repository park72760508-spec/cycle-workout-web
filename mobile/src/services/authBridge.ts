/** Auth Bridge re-export (앱 진입 편의) */
export {
  syncSupabaseAuth,
  fetchSupabaseSessionFromBridge,
  createSupabaseAuthSyncOnLogin,
  SupabaseAuthBridgeError,
} from "../auth/syncSupabaseAuth";
export type { SyncSupabaseAuthConfig } from "../auth/syncSupabaseAuth";
