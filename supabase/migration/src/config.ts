import "dotenv/config";

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

export function loadConfig(argv: string[]): MigrationConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 환경 변수가 필요합니다.");
  }

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
