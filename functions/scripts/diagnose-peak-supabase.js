'use strict';

const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../../supabase/migration/.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    });
}
const { Client } = require('pg');
const { v5: uuidv5 } = require('uuid');

const fbUid = process.argv[2] || 'Ys8GQZYyf3ZoEunSVGKnWNbtSkv2';

(async function main() {
  const pgUid = uuidv5(fbUid, process.env.STELVIO_UID_NAMESPACE);
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const u = await c.query('SELECT id, name, weight_kg FROM users WHERE firebase_uid = $1', [fbUid]);
  console.log('user', u.rows[0]);

  const m = await c.query(
    `SELECT peak_window_start, peak_window_end, peak_max_wkg, peak_1min_wkg, peak_5min_wkg,
            peak_10min_wkg, metrics_updated_at
     FROM user_ranking_metrics WHERE user_id = $1`,
    [pgUid]
  );
  console.log('user_ranking_metrics', m.rows[0]);

  const mv = await c.query(
    'SELECT peak_max_wkg, peak_1min_wkg, peak_5min_wkg FROM mv_leaderboard_peak_28d WHERE user_id = $1',
    [pgUid]
  );
  console.log('mv_leaderboard_peak_28d', mv.rows[0]);

  const gc = await c.query(
    `SELECT filter_category, filter_gender, board_rank, rank_sum, gc_score, axis_ranks, as_of_seoul
     FROM heptagon_cohort_ranks
     WHERE user_id = $1 AND month_key = '2026-06'
     ORDER BY filter_category, filter_gender`,
    [pgUid]
  );
  console.log('heptagon 2026-06 count', gc.rows.length);
  gc.rows.forEach((r) => console.log(JSON.stringify(r)));

  const days = await c.query(
    `SELECT summary_date, max_watts, max_1min_watts, max_5min_watts
     FROM daily_summaries
     WHERE user_id = $1 AND summary_date BETWEEN '2026-05-31' AND '2026-06-27'
     ORDER BY max_1min_watts DESC NULLS LAST
     LIMIT 8`,
    [pgUid]
  );
  console.log('top 1min daily_summaries', days.rows);

  const d530 = await c.query(
    `SELECT summary_date, max_watts, max_1min_watts, max_5min_watts
     FROM daily_summaries WHERE user_id = $1 AND summary_date = '2026-05-30'`,
    [pgUid]
  );
  console.log('daily 2026-05-30', d530.rows[0] || null);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
