/**
 * Phase 2 — 기존 rides → yearly_peaks 백필 (트리거 배포 전 이력 반영).
 *
 *   npx tsx scripts/backfillYearlyPeaksFromRides.ts
 *   npx tsx scripts/backfillYearlyPeaksFromRides.ts --year=2026 --dry-run
 */
import { config as loadDotenv } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(resolve(__dirname, ".."), ".env") });

const yearArg = process.argv.find((a) => a.startsWith("--year="))?.split("=")[1];
const YEAR = yearArg ? parseInt(yearArg, 10) : new Date().getFullYear();
const DRY = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 없음");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM public.rides r
     WHERE EXTRACT(YEAR FROM r.ride_date)::int = $1
       AND public.fn_is_cycling_ride(r)`,
    [YEAR]
  );
  const total = countRes.rows[0]?.n ?? 0;
  console.log(`year=${YEAR} cycling rides=${total} dryRun=${DRY}`);

  if (DRY) {
    await pool.end();
    return;
  }

  const res = await pool.query(
    `SELECT id FROM public.rides r
     WHERE EXTRACT(YEAR FROM r.ride_date)::int = $1
       AND public.fn_is_cycling_ride(r)
     ORDER BY r.ride_date ASC, r.id ASC`,
    [YEAR]
  );

  let done = 0;
  for (const row of res.rows) {
    await pool.query(`SELECT public.fn_upsert_yearly_peak_from_ride(r) FROM public.rides r WHERE r.id = $1`, [
      row.id,
    ]);
    done++;
    if (done % 500 === 0) console.log(`progress ${done}/${total}`);
  }

  console.log(`backfill complete: ${done} rides processed`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
