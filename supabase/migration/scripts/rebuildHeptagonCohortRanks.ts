/**
 * Supabase heptagon_cohort_ranks 재빌드 (users.gender 반영)
 * npm run rebuild:heptagon
 */
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  console.log("[rebuild:heptagon] fn_rebuild_heptagon_cohort_ranks …");
  const t0 = Date.now();
  await pool.query("SELECT public.fn_rebuild_heptagon_cohort_ranks()");
  console.log("[rebuild:heptagon] done in", Math.round((Date.now() - t0) / 1000), "s");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
