import pg from "pg";
import type { MigrationConfig } from "./config.js";
import { resolveUserUuid } from "./uid.js";

const { Pool } = pg;

/** connection string 대신 URL 파싱 — 비밀번호의 ! @ # 등 특수문자 오류 방지 */
function poolConfigFromDatabaseUrl(databaseUrl: string): pg.PoolConfig {
  const u = new URL(databaseUrl);
  const database = u.pathname.replace(/^\//, "") || "postgres";
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    max: 4,
    ssl: u.hostname.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  };
}

export function createPool(config: MigrationConfig): pg.Pool {
  return new Pool(poolConfigFromDatabaseUrl(config.databaseUrl));
}

/** auth.users에 존재하는 UUID 집합 (마이그레이션 대상 필터) */
export async function loadAuthUserIdSet(
  pool: pg.Pool,
  config: MigrationConfig
): Promise<Set<string>> {
  const res = await pool.query(`SELECT id::text AS id FROM auth.users`);
  const set = new Set<string>();
  for (const row of res.rows as { id: string }[]) {
    set.add(row.id.toLowerCase());
  }
  console.log(`[auth] auth.users count: ${set.size}`);
  return set;
}

export function isUserMigratable(
  firebaseUid: string,
  authIds: Set<string>,
  config: MigrationConfig
): boolean {
  const uuid = resolveUserUuid(firebaseUid, config);
  return uuid != null && authIds.has(uuid.toLowerCase());
}

export async function setTriggerEnabled(
  client: pg.PoolClient,
  table: string,
  triggerName: string,
  enabled: boolean
): Promise<void> {
  const mode = enabled ? "ENABLE" : "DISABLE";
  await client.query(
    `ALTER TABLE ${table} ${mode} TRIGGER ${triggerName}`
  );
}

export async function refreshRankingMetricsBatch(
  pool: pg.Pool,
  userIds: string[],
  dryRun: boolean
): Promise<void> {
  if (dryRun || userIds.length === 0) return;
  const client = await pool.connect();
  try {
    for (const uid of userIds) {
      await client.query(`SELECT public.fn_refresh_user_ranking_metrics($1::uuid)`, [
        uid,
      ]);
    }
  } finally {
    client.release();
  }
}

export async function refreshMaterializedViews(
  pool: pg.Pool,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;
  await pool.query(`SELECT public.fn_refresh_ranking_materialized_views()`);
}
