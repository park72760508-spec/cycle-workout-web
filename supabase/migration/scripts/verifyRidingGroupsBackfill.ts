/**
 * migrate:riding-groups 백필 결과 검증
 * npm run verify:riding-groups
 */
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/pg.js";

async function main(): Promise<void> {
  const pool = createPool(loadConfig(process.argv));

  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM riding_groups) AS groups,
      (SELECT COUNT(*)::int FROM riding_group_members) AS members,
      (SELECT COUNT(*)::int FROM riding_group_join_requests) AS join_requests,
      (SELECT COUNT(*)::int FROM media_assets WHERE entity_type = 'group_cover') AS group_covers,
      (SELECT COUNT(*)::int FROM media_assets WHERE entity_type = 'open_ride_gpx') AS gpx_assets
  `);
  const c = counts.rows[0] as Record<string, number>;
  console.log("[verify:riding-groups] counts", c);

  const fk = await pool.query(`
    SELECT ref.relname AS ref_table
    FROM pg_constraint con
    JOIN pg_class t ON con.conrelid = t.oid
    JOIN pg_class ref ON con.confrelid = ref.oid
    WHERE t.relname = 'riding_groups' AND con.conname = 'riding_groups_created_by_fkey'
  `);
  console.log(
    "[verify:riding-groups] created_by FK →",
    (fk.rows[0] as { ref_table: string } | undefined)?.ref_table || "?"
  );

  const samples = await pool.query(`
    SELECT id, firestore_doc_id, name, status, created_by
    FROM riding_groups
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 5
  `);
  console.log("[verify:riding-groups] sample groups:");
  for (const row of samples.rows) {
    console.log(" ", row);
  }

  const orphanMembers = await pool.query(`
    SELECT COUNT(*)::int AS n
    FROM riding_group_members m
    WHERE NOT EXISTS (SELECT 1 FROM riding_groups g WHERE g.id = m.group_id)
  `);
  if ((orphanMembers.rows[0] as { n: number }).n > 0) {
    console.warn("[verify:riding-groups] WARN orphan members");
  }

  await pool.end();
  console.log("[verify:riding-groups] OK");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
