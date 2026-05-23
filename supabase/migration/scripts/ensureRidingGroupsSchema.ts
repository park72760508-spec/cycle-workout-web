/**
 * riding_groups / media_assets 스키마 복구 (ON CONFLICT 제약)
 * npm run schema:riding-groups
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/pg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPAIR_SQL = join(
  __dirname,
  "../../migrations/20260522140300_riding_groups_migrate_constraints_repair.sql"
);

export async function verifyRidingGroupsSchema(
  pool: Awaited<ReturnType<typeof createPool>>
): Promise<void> {
  const checks = await pool.query<{
    ok: boolean;
    label: string;
  }>(`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'riding_groups' AND c.contype = 'p'
    ) AS ok, 'riding_groups PK (id)' AS label
    UNION ALL
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'riding_groups'
        AND column_name = 'firestore_doc_id'
    ), 'riding_groups.firestore_doc_id'
    UNION ALL
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'riding_groups'
        AND column_name = 'photo_storage_path'
    ), 'riding_groups.photo_storage_path'
    UNION ALL
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.media_assets'::regclass
        AND conname = 'media_assets_entity_path_unique'
    ), 'media_assets UNIQUE (entity_type, entity_id, storage_path)'
    UNION ALL
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_class ref ON c.confrelid = ref.oid
      WHERE t.relname = 'riding_groups'
        AND c.conname = 'riding_groups_created_by_fkey'
        AND ref.relname = 'users'
    ), 'riding_groups.created_by → public.users'
  `);

  const failed = checks.rows.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(
      "스키마 검증 실패:\n" +
        failed.map((r) => `  - ${r.label}`).join("\n") +
        "\nSupabase SQL Editor에서 supabase/migrations/20260522140300_riding_groups_migrate_constraints_repair.sql 실행"
    );
  }
}

export async function applyRidingGroupsSchemaRepair(
  pool: Awaited<ReturnType<typeof createPool>>
): Promise<void> {
  const sql = readFileSync(REPAIR_SQL, "utf8");
  await pool.query(sql);
  await verifyRidingGroupsSchema(pool);
}

async function main(): Promise<void> {
  const config = loadConfig(process.argv);
  const pool = createPool(config);

  console.log("[schema:riding-groups] 제약·컬럼 복구 SQL 적용...");
  await applyRidingGroupsSchemaRepair(pool);
  console.log("[schema:riding-groups] OK — migrate:riding-groups 실행 가능");
  await pool.end();
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
