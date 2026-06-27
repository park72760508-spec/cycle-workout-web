'use strict';

/**
 * cap 제거 후 user_ranking_metrics 전 사용자 재집계 + MV/heptagon 스냅샷 갱신.
 *
 * Usage:
 *   node scripts/backfill-cap-uncap-ranking-metrics.cjs
 *   node scripts/backfill-cap-uncap-ranking-metrics.cjs --dry-run
 *   node scripts/backfill-cap-uncap-ranking-metrics.cjs --skip-mv
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const { Client } = require('pg');

const dryRun = process.argv.includes('--dry-run');
const skipMv = process.argv.includes('--skip-mv');
const batchSize = Number(process.env.BACKFILL_BATCH_SIZE || 50);

const USER_SQL = `
  SELECT DISTINCT u.user_id
  FROM (
    SELECT m.user_id FROM public.user_ranking_metrics m
    UNION
    SELECT d.user_id
    FROM public.daily_summaries d,
         LATERAL (SELECT * FROM public.fn_seoul_rolling_range(28)) r28
    WHERE d.summary_date BETWEEN r28.start_date AND r28.end_date
  ) u
  JOIN public.users usr ON usr.id = u.user_id
  WHERE usr.weight_kg > 0
  ORDER BY u.user_id
`;

(async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const users = await c.query(USER_SQL);
  const ids = users.rows.map((r) => r.user_id);
  console.log('[backfill] users to refresh:', ids.length, dryRun ? '(dry-run)' : '');

  if (dryRun) {
    console.log('[backfill] sample ids:', ids.slice(0, 5));
    await c.end();
    return;
  }

  let done = 0;
  let failed = 0;
  const started = Date.now();

  for (let i = 0; i < ids.length; i += 1) {
    const uid = ids[i];
    try {
      await c.query('SELECT public.fn_refresh_user_ranking_metrics($1::uuid)', [uid]);
      done += 1;
    } catch (err) {
      failed += 1;
      console.warn('[backfill] fail', uid, err.message || err);
    }
    if (done % batchSize === 0 || i === ids.length - 1) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[backfill] progress ${done}/${ids.length} failed=${failed} elapsed=${elapsed}s`);
    }
  }

  if (!skipMv) {
    const hasMv = await c.query(
      `SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'fn_refresh_ranking_materialized_views'`
    );
    if (hasMv.rowCount) {
      console.log('[backfill] refreshing materialized views...');
      await c.query('SELECT public.fn_refresh_ranking_materialized_views()');
      console.log('[backfill] fn_refresh_ranking_materialized_views OK');
    }

    const hasSnap = await c.query(
      `SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'fn_rebuild_peak_rank_board_snapshots'`
    );
    if (hasSnap.rowCount) {
      console.log('[backfill] rebuilding peak rank board snapshots...');
      await c.query('SELECT public.fn_rebuild_peak_rank_board_snapshots()');
      console.log('[backfill] fn_rebuild_peak_rank_board_snapshots OK');
    }
  }

  const sample = await c.query(
    `SELECT COUNT(*)::int AS changed
     FROM user_ranking_metrics m
     WHERE m.metrics_updated_at >= now() - interval '10 minutes'`
  );

  console.log('[backfill] done', {
    refreshed: done,
    failed,
    recentlyUpdatedMetrics: sample.rows[0].changed,
    totalSeconds: ((Date.now() - started) / 1000).toFixed(1),
  });

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
