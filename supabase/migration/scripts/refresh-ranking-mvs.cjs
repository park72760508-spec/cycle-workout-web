'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');

(async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const hasFn = await c.query(
    `SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_refresh_ranking_materialized_views'`
  );
  if (hasFn.rowCount) {
    await c.query('SELECT public.fn_refresh_ranking_materialized_views()');
    console.log('fn_refresh_ranking_materialized_views OK');
  } else {
    await c.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_leaderboard_peak_28d');
    console.log('REFRESH mv_leaderboard_peak_28d OK');
  }
  const hasSnap = await c.query(
    `SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_rebuild_peak_rank_board_snapshots'`
  );
  if (hasSnap.rowCount) {
    await c.query('SELECT public.fn_rebuild_peak_rank_board_snapshots()');
    console.log('fn_rebuild_peak_rank_board_snapshots OK');
  }
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
