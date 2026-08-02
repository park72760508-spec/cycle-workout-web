/**
 * Firestore rides.category → Supabase open_rides.category 백필.
 * 2026-08 회귀: open_rides에 category 컬럼이 없어 Supabase Read 경로에서 모든 라이딩이
 * CYCLE로 취급되어 RUN(러닝 크루) 캘린더가 항상 비어 보였다. 스키마 마이그레이션
 * (20260802120000_open_rides_category.sql) 적용 후, 이미 마이그레이션된 기존 행들의
 * 실제 종목값을 Firestore 원본에서 다시 읽어 채운다. 새 라이딩은 dual-write에서 이미
 * category를 함께 기록하므로 이 스크립트는 과거분 1회성 보정용이다.
 *
 *   cd supabase/migration
 *   npx tsx scripts/backfillOpenRideCategory.ts --dry-run
 *   npx tsx scripts/backfillOpenRideCategory.ts
 */
import { loadConfig } from "../src/config.js";
import { initFirestore } from "../src/firestore.js";
import { createPool } from "../src/pg.js";

async function main(): Promise<void> {
  const config = loadConfig(process.argv);
  const dryRun = process.argv.includes("--dry-run");
  const db = initFirestore();
  const pool = createPool(config);

  console.log("[backfill:open-ride-category] Firestore rides.category → Supabase open_rides.category", {
    dryRun,
  });

  const ridesSnap = await db.collection("rides").get();
  let scanned = 0;
  let updated = 0;
  let skippedNoChange = 0;
  let skippedNotFound = 0;

  for (const rideDoc of ridesSnap.docs) {
    scanned++;
    const raw = String(rideDoc.data()?.category || "").trim().toUpperCase();
    const category = raw === "RUN" ? "RUN" : "CYCLE";

    const current = await pool.query(
      `SELECT category FROM public.open_rides WHERE firestore_doc_id = $1`,
      [rideDoc.id]
    );
    if (current.rowCount === 0) {
      skippedNotFound++;
      continue;
    }
    if (current.rows[0].category === category) {
      skippedNoChange++;
      continue;
    }

    if (!dryRun) {
      await pool.query(`UPDATE public.open_rides SET category = $1 WHERE firestore_doc_id = $2`, [
        category,
        rideDoc.id,
      ]);
    }
    updated++;
    if (updated % 200 === 0) console.log(`progress: ${updated} updated / ${scanned} scanned`);
  }

  console.log("[backfill:open-ride-category] 완료", {
    scanned,
    updated,
    skippedNoChange,
    skippedNotFound,
    dryRun,
  });
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
