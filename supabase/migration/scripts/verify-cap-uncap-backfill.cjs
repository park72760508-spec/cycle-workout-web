'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');

(async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const summary = await c.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE peak_10min_wkg > peak_20min_wkg AND peak_20min_wkg > 0)::int AS min10_gt_20,
      COUNT(*) FILTER (WHERE peak_5min_wkg > peak_10min_wkg AND peak_10min_wkg > 0)::int AS min5_gt_10,
      COUNT(*) FILTER (WHERE peak_1min_wkg > peak_5min_wkg AND peak_5min_wkg > 0)::int AS min1_gt_5,
      COUNT(*) FILTER (WHERE peak_max_wkg > peak_1min_wkg AND peak_1min_wkg > 0)::int AS max_gt_1min
    FROM user_ranking_metrics
    WHERE peak_max_wkg > 0 OR peak_1min_wkg > 0
  `);
  console.log('user_ranking_metrics cross-duration (cap would have flattened):', summary.rows[0]);

  const mv = await c.query(`
    SELECT COUNT(*)::int AS mv_users
    FROM mv_leaderboard_peak_28d
    WHERE peak_max_wkg > 0 OR peak_1min_wkg > 0
  `);
  console.log('mv_leaderboard_peak_28d users:', mv.rows[0]);

  const park = await c.query(`
    SELECT u.name, m.peak_max_wkg, m.peak_1min_wkg, m.peak_5min_wkg, m.metrics_updated_at
    FROM users u
    JOIN user_ranking_metrics m ON m.user_id = u.id
    WHERE u.firebase_uid = 'Ys8GQZYyf3ZoEunSVGKnWNbtSkv2'
  `);
  console.log('박지성 verify:', park.rows[0]);

  const hept = await c.query(`
    SELECT h.filter_category, h.filter_gender, h.board_rank, h.as_of_seoul
    FROM heptagon_cohort_ranks h
    JOIN users u ON u.id = h.user_id
    WHERE u.firebase_uid = 'Ys8GQZYyf3ZoEunSVGKnWNbtSkv2'
      AND h.month_key = '2026-06'
    ORDER BY h.filter_category, h.filter_gender
  `);
  console.log('박지성 heptagon:', hept.rows);

  const heptAll = await c.query(`
    SELECT COUNT(*)::int AS n, MAX(as_of_seoul) AS latest
    FROM heptagon_cohort_ranks
    WHERE month_key = '2026-06'
  `);
  console.log('heptagon 2026-06 total:', heptAll.rows[0]);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
