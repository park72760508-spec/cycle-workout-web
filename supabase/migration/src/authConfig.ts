import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);
const ENV_FILE = resolve(MIGRATION_ROOT, ".env");
if (existsSync(ENV_FILE)) {
  loadDotenv({ path: ENV_FILE });
} else {
  loadDotenv();
}

export interface AuthMigrateConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  uidMode: "v5" | "literal";
  uidNamespace: string;
  batchSize: number;
  dryRun: boolean;
  logPath: string;
  /** Firestore users 문서에서 email/phone 보강 */
  enrichFromFirestore: boolean;
}

export function loadAuthMigrateConfig(argv: string[]): AuthMigrateConfig {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.\n" +
        "Dashboard → Settings → API Keys → service_role (secret)\n" +
        "Publishable key(sb_publishable_...)는 사용할 수 없습니다."
    );
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    uidMode:
      process.env.FIREBASE_UID_UUID_MODE === "literal" ? "literal" : "v5",
    uidNamespace:
      process.env.STELVIO_UID_NAMESPACE ||
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    batchSize: Math.max(1, Number(process.env.AUTH_MIGRATE_BATCH_SIZE) || 100),
    dryRun: argv.includes("--dry-run"),
    logPath: process.env.MIGRATION_AUTH_ERROR_LOG || "migration_auth_errors.log",
    enrichFromFirestore: process.env.AUTH_ENRICH_FIRESTORE !== "false",
  };
}

/** migrateData.ts 와 동일한 UID 규칙용 최소 설정 */
export function authConfigAsMigrationConfig(
  c: AuthMigrateConfig
): import("./config.js").MigrationConfig {
  return {
    databaseUrl: process.env.DATABASE_URL || "",
    batchSize: c.batchSize,
    dryRun: c.dryRun,
    uidMode: c.uidMode,
    uidNamespace: c.uidNamespace,
    skipUsersWithoutAuth: true,
    disableTriggersDuringBulk: true,
    phases: new Set(),
    logPath: c.logPath,
  };
}
