/**
 * Supabase public.rides 건수·source별 집계
 * npm run count:rides
 */
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/pg.js";

async function main(): Promise<void> {
  const config = loadConfig(process.argv);
  const pool = createPool(config);
  try {
    const bySource = await pool.query(
      `SELECT source, COUNT(*)::int AS n FROM public.rides GROUP BY source ORDER BY source`
    );
    const total = await pool.query(
      `SELECT COUNT(*)::int AS n, MIN(ride_date) AS earliest, MAX(ride_date) AS latest FROM public.rides`
    );
    console.log("rides by source:", bySource.rows);
    console.log("rides total:", total.rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
