/**
 * Firestore peak_rank_history → Supabase peak_rank_board_snapshots (1회 백필)
 *
 * npm run sync:peak-rank-snapshots
 * npm run sync:peak-rank-snapshots:dry
 */
import { loadConfig } from "../src/config.js";
import { initFirestore } from "../src/firestore.js";
import { createPool } from "../src/pg.js";

const FIRESTORE_COL = "peak_rank_history";

type JsonMap = Record<string, unknown>;

function asObject(v: unknown): JsonMap {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as JsonMap;
  return {};
}

function seoulYmdFromUnknown(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  const r = raw as { toDate?: () => Date; seconds?: number };
  if (typeof r.toDate === "function") {
    return r.toDate().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  }
  if (typeof r.seconds === "number") {
    return new Date(r.seconds * 1000).toLocaleDateString("en-CA", {
      timeZone: "Asia/Seoul",
    });
  }
  return null;
}

function normalizeFirestorePeakRankDoc(
  historyKey: string,
  d: JsonMap
): {
  history_key: string;
  as_of_seoul: string;
  ranks_by_category: JsonMap;
  rank_changes_by_category: JsonMap;
  previous_ranks_by_category: JsonMap;
  prev_day_ranks_by_category: JsonMap;
  updated_at: string;
} | null {
  let ranksByCategory = asObject(d.ranksByCategory);
  let rankChangesByCategory = asObject(d.rankChangesByCategory);
  let previousRanksByCategory = asObject(d.previousRanksByCategory);
  let prevDayRanksByCategory = asObject(d.prevDayRanksByCategory);

  if (Object.keys(ranksByCategory).length === 0 && d.ranks) {
    ranksByCategory = { Supremo: asObject(d.ranks) };
  }
  if (Object.keys(rankChangesByCategory).length === 0 && d.rankChanges) {
    rankChangesByCategory = { Supremo: asObject(d.rankChanges) };
  }
  if (Object.keys(previousRanksByCategory).length === 0 && d.previousRanks) {
    previousRanksByCategory = { Supremo: asObject(d.previousRanks) };
  }
  if (Object.keys(prevDayRanksByCategory).length === 0 && d.prevDayRanks) {
    prevDayRanksByCategory = { Supremo: asObject(d.prevDayRanks) };
  }

  const asOfSeoul =
    seoulYmdFromUnknown(d.asOfSeoul) ||
    seoulYmdFromUnknown(d.as_of_seoul) ||
    seoulYmdFromUnknown(d.updatedAt) ||
    seoulYmdFromUnknown(d.updated_at);

  if (!asOfSeoul) {
    console.warn("[sync:peak-rank-snapshots] skip (no asOfSeoul):", historyKey);
    return null;
  }

  const updatedAt =
    (typeof d.updatedAt === "string" && d.updatedAt) ||
    seoulYmdFromUnknown(d.updatedAt) ||
    new Date().toISOString();

  return {
    history_key: historyKey,
    as_of_seoul: asOfSeoul,
    ranks_by_category: ranksByCategory,
    rank_changes_by_category: rankChangesByCategory,
    previous_ranks_by_category: previousRanksByCategory,
    prev_day_ranks_by_category: prevDayRanksByCategory,
    updated_at:
      typeof d.updatedAt === "object" && d.updatedAt
        ? new Date(
            (d.updatedAt as { seconds?: number }).seconds
              ? (d.updatedAt as { seconds: number }).seconds * 1000
              : Date.now()
          ).toISOString()
        : new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const config = loadConfig(process.argv);
  const dryRun = config.dryRun;
  const db = initFirestore();
  const pool = createPool(config);

  console.log(
    `[sync:peak-rank-snapshots] Firestore ${FIRESTORE_COL} → peak_rank_board_snapshots` +
      (dryRun ? " (dry-run)" : "")
  );

  const snap = await db.collection(FIRESTORE_COL).get();
  console.log(`[sync:peak-rank-snapshots] Firestore docs: ${snap.size}`);

  let ok = 0;
  let skip = 0;

  for (const doc of snap.docs) {
    const row = normalizeFirestorePeakRankDoc(doc.id, doc.data() as JsonMap);
    if (!row) {
      skip++;
      continue;
    }

    if (dryRun) {
      console.log(
        `  [dry] ${row.history_key} as_of=${row.as_of_seoul} cats=` +
          Object.keys(row.ranks_by_category).join(",")
      );
      ok++;
      continue;
    }

    await pool.query(
      `INSERT INTO public.peak_rank_board_snapshots (
        history_key, as_of_seoul, ranks_by_category, rank_changes_by_category,
        previous_ranks_by_category, prev_day_ranks_by_category, updated_at
      ) VALUES ($1, $2::date, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::timestamptz)
      ON CONFLICT (history_key) DO UPDATE SET
        as_of_seoul = EXCLUDED.as_of_seoul,
        ranks_by_category = EXCLUDED.ranks_by_category,
        rank_changes_by_category = EXCLUDED.rank_changes_by_category,
        previous_ranks_by_category = EXCLUDED.previous_ranks_by_category,
        prev_day_ranks_by_category = EXCLUDED.prev_day_ranks_by_category,
        updated_at = EXCLUDED.updated_at`,
      [
        row.history_key,
        row.as_of_seoul,
        JSON.stringify(row.ranks_by_category),
        JSON.stringify(row.rank_changes_by_category),
        JSON.stringify(row.previous_ranks_by_category),
        JSON.stringify(row.prev_day_ranks_by_category),
        row.updated_at,
      ]
    );
    ok++;
  }

  await pool.end();
  console.log(`[sync:peak-rank-snapshots] done upsert=${ok} skip=${skip}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
