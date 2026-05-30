/**
 * Firestore users.gender/sex → Supabase public.users.gender 백필
 *
 * npm run sync:user-gender
 * npm run sync:user-gender:dry
 * npm run sync:user-gender -- --refresh-mv
 */
import { loadConfig } from "../src/config.js";
import { initFirestore, paginateCollection } from "../src/firestore.js";
import { mapGender, mapUserRow } from "../src/mappers.js";
import { createPool, refreshMaterializedViews } from "../src/pg.js";

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dry = hasFlag(argv, "--dry-run") || hasFlag(argv, "--dry");
  const refreshMv = hasFlag(argv, "--refresh-mv");
  const config = loadConfig(argv);
  const db = initFirestore();
  const pool = createPool(config);

  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  let unknownSource = 0;
  let maleSource = 0;
  let femaleSource = 0;
  let missingInSupabase = 0;

  console.log(dry ? "*** DRY RUN — UPDATE 없음 ***\n" : "");
  console.log("[sync:user-gender] Firestore users → Supabase users.gender");

  await paginateCollection(
    db,
    (d) => d.collection("users"),
    config.batchSize,
    (doc) => {
      const row = mapUserRow(doc.id, doc.data(), config);
      if (!row) return null;
      const gender = mapGender(doc.data().gender ?? doc.data().sex);
      return { id: String(row.id), gender, firebaseUid: doc.id };
    },
    async (batch) => {
      const rows = batch.filter(Boolean) as Array<{
        id: string;
        gender: "male" | "female" | "unknown";
        firebaseUid: string;
      }>;
      if (!rows.length) return;

      for (const row of rows) {
        scanned += 1;
        if (row.gender === "male") maleSource += 1;
        else if (row.gender === "female") femaleSource += 1;
        else unknownSource += 1;
      }

      if (dry) {
        console.log(`  [dry] batch ${rows.length} (누적 scanned=${scanned})`);
        return;
      }

      const client = await pool.connect();
      try {
        for (const row of rows) {
          const upd = await client.query(
            `UPDATE public.users
             SET gender = $2::public.gender_code,
                 updated_at = now()
             WHERE id = $1::uuid
               AND gender IS DISTINCT FROM $2::public.gender_code
             RETURNING id`,
            [row.id, row.gender]
          );
          if (upd.rowCount) {
            updated += 1;
            continue;
          }
          const exists = await client.query(
            `SELECT 1 FROM public.users WHERE id = $1::uuid LIMIT 1`,
            [row.id]
          );
          if (!exists.rowCount) {
            missingInSupabase += 1;
            console.warn(`  [skip] Supabase users 없음: ${row.firebaseUid} → ${row.id}`);
            continue;
          }
          unchanged += 1;
        }
      } finally {
        client.release();
      }
      console.log(`  batch OK rows=${rows.length} (누적 scanned=${scanned}, updated=${updated})`);
    }
  );

  console.log("\n--- 결과 ---");
  console.log(`scanned: ${scanned}`);
  console.log(`updated: ${updated}`);
  console.log(`unchanged: ${unchanged}`);
  console.log(`missingInSupabase: ${missingInSupabase}`);
  console.log(`source male/female/unknown: ${maleSource}/${femaleSource}/${unknownSource}`);

  if (!dry && refreshMv) {
    console.log("\n[refresh] ranking materialized views …");
    const client = await pool.connect();
    try {
      await refreshMaterializedViews(client);
      console.log("[refresh] done");
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
