import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** supabase/migration/.env (실행 cwd와 무관하게 로드) */
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MigrationPhase =
  | "users"
  | "strava"
  | "processed_orders"
  | "point_history"
  | "daily_summaries"
  | "rides"
  | "yearly_peaks"
  | "friends"
  | "orders"
  | "open_rides"
  | "refresh_metrics";

const ALL_PHASES: MigrationPhase[] = [
  "users",
  "strava",
  "processed_orders",
  "point_history",
  "daily_summaries",
  "rides",
  "yearly_peaks",
  "friends",
  "orders",
  "open_rides",
  "refresh_metrics",
];

export interface MigrationConfig {
  databaseUrl: string;
  batchSize: number;
  dryRun: boolean;
  uidMode: "v5" | "literal";
  uidNamespace: string;
  skipUsersWithoutAuth: boolean;
  disableTriggersDuringBulk: boolean;
  phases: Set<MigrationPhase>;
  logPath: string;
}

function resolveDatabaseUrl(): string {
  const raw =
    process.env.DATABASE_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    "";
  const stripped = raw.replace(/^["']|["']$/g, "");
  if (!stripped || /\[YOUR-PASSWORD\]/i.test(stripped)) {
    const hint = existsSync(ENV_FILE)
      ? `${ENV_FILE} 에 DATABASE_URL(또는 DIRECT_URL)과 실제 DB 비밀번호를 넣으세요.`
      : `${ENV_FILE} 파일이 없습니다. .env.example 을 복사해 .env 를 만든 뒤 비밀번호를 채우세요.\n  PowerShell: Copy-Item .env.example .env`;
    throw new Error(`DATABASE_URL 환경 변수가 필요합니다. ${hint}`);
  }
  if (/:6543\//.test(stripped) || /pgbouncer=true/i.test(stripped)) {
    console.warn(
      "[config] 경고: 6543/pgbouncer URL 입니다. 마이그레이션은 Direct(5432) URI 를 권장합니다."
    );
  }
  return stripped;
}

export function loadConfig(argv: string[]): MigrationConfig {
  const databaseUrl = resolveDatabaseUrl();

  const rawPhases = process.env.MIGRATION_PHASES?.trim();
  const phases = rawPhases
    ? new Set(
        rawPhases.split(",").map((p) => p.trim()) as MigrationPhase[]
      )
    : new Set(ALL_PHASES);

  const uidMode =
    process.env.FIREBASE_UID_UUID_MODE === "literal" ? "literal" : "v5";

  return {
    databaseUrl,
    batchSize: Math.max(1, Number(process.env.MIGRATION_BATCH_SIZE) || 1000),
    dryRun: argv.includes("--dry-run"),
    uidMode,
    uidNamespace:
      process.env.STELVIO_UID_NAMESPACE ||
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    skipUsersWithoutAuth: process.env.SKIP_USERS_WITHOUT_AUTH !== "false",
    disableTriggersDuringBulk:
      process.env.DISABLE_TRIGGERS_DURING_BULK !== "false",
    phases,
    logPath: process.env.MIGRATION_ERROR_LOG || "migration_errors.log",
  };
}

export function isUuidString(s: string): boolean {
  return UUID_RE.test(s);
}
