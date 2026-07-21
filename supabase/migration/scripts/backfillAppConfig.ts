/**
 * Firestore appConfig/* → Supabase public.app_config 1회성 백필.
 * onAppConfigWritten 트리거는 이후 "변경분"만 미러링하므로, 이미 존재하는 기존 설정 문서
 * (strava/sync/supabase_read_routing/supabase_groups_read_routing/ranking_aggregation_control 등)를
 * 최초 1회 옮겨줘야 한다.
 *
 * npm run backfill:app-config
 * npm run backfill:app-config:dry
 */
import { loadConfig } from "../src/config.js";
import { initFirestore } from "../src/firestore.js";
import { createPool } from "../src/pg.js";

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dry = hasFlag(argv, "--dry-run") || hasFlag(argv, "--dry");
  const config = loadConfig(argv);
  const db = initFirestore();
  const pool = createPool(config);

  console.log(dry ? "*** DRY RUN — UPSERT 없음 ***\n" : "");
  console.log("[backfill:app-config] Firestore appConfig → Supabase app_config");

  const snap = await db.collection("appConfig").get();
  let upserted = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    console.log(`  - ${doc.id}: ${Object.keys(data).join(", ")}`);
    if (dry) continue;

    /* eslint-disable no-await-in-loop */
    await pool.query(
      `INSERT INTO public.app_config (config_key, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (config_key) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = now()`,
      [doc.id, JSON.stringify(data)]
    );
    /* eslint-enable no-await-in-loop */
    upserted += 1;
  }

  console.log(`\n[backfill:app-config] 완료 — scanned=${snap.size}, upserted=${upserted}`);
  await pool.end();
}

main().catch((err) => {
  console.error("[backfill:app-config] 실패:", err);
  process.exit(1);
});
