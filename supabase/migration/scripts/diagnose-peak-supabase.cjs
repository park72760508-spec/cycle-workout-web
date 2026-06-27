'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
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
    `SELECT filter_category, filter_gender, board_rank, as_of_seoul
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
  console.log('daily 2026-05-30 (outside current 28d if start=5/31)', d530.rows[0] || null);

  const maxDays = await c.query(
    `SELECT summary_date, max_watts, max_1min_watts, max_5min_watts
     FROM daily_summaries WHERE user_id = $1
       AND summary_date BETWEEN '2026-05-31' AND '2026-06-27'
     ORDER BY max_watts DESC NULLS LAST LIMIT 5`,
    [pgUid]
  );
  console.log('top max daily_summaries', maxDays.rows);

  const d531 = await c.query(
    'SELECT summary_date, max_watts, max_1min_watts, max_5min_watts FROM daily_summaries WHERE user_id = $1 AND summary_date = $2',
    [pgUid, '2026-05-31']
  );
  console.log('daily 2026-05-31', d531.rows[0] || null);

  const d613 = await c.query(
    'SELECT summary_date, max_watts, max_1min_watts, max_5min_watts FROM daily_summaries WHERE user_id = $1 AND summary_date = $2',
    [pgUid, '2026-06-13']
  );
  console.log('daily 2026-06-13', d613.rows[0] || null);

  const rides613 = await c.query(
    `SELECT ride_date, max_watts, max_1min_watts, max_5min_watts, title
     FROM rides WHERE user_id = $1 AND ride_date BETWEEN '2026-06-10' AND '2026-06-15'
     ORDER BY ride_date`,
    [pgUid]
  );
  console.log('rides 6/10-6/15', rides613.rows);

  const allDays = await c.query(
    `SELECT summary_date::text AS d, max_watts, max_1min_watts, max_5min_watts
     FROM daily_summaries WHERE user_id = $1
       AND summary_date BETWEEN '2026-05-31' AND '2026-06-27'
     ORDER BY summary_date`,
    [pgUid]
  );
  console.log('all daily count', allDays.rows.length);
  allDays.rows.forEach((r) => {
    if ((Number(r.max_1min_watts) || 0) >= 280 || (Number(r.max_watts) || 0) >= 560) {
      console.log(' notable', r);
    }
  });

  const r28 = await c.query('SELECT (public.fn_seoul_rolling_range(28)).*');
  console.log('fn_seoul_rolling_range(28)', r28.rows[0]);

  const sim = await c.query(
    `WITH r AS (SELECT (public.fn_seoul_rolling_range(28)).*)
     SELECT (SELECT MAX(max_watts) FROM daily_summaries d, r
             WHERE d.user_id = $1 AND d.summary_date BETWEEN r.start_date AND r.end_date) AS raw_max_watts,
            (SELECT MAX(max_1min_watts) FROM daily_summaries d, r
             WHERE d.user_id = $1 AND d.summary_date BETWEEN r.start_date AND r.end_date) AS raw_max_1min,
            (SELECT MAX(max_5min_watts) FROM daily_summaries d, r
             WHERE d.user_id = $1 AND d.summary_date BETWEEN r.start_date AND r.end_date) AS raw_max_5min`,
    [pgUid]
  );
  console.log('raw window max watts', sim.rows[0]);

  await c.query('SELECT public.fn_refresh_user_ranking_metrics($1)', [pgUid]);
  const m2 = await c.query(
    'SELECT peak_max_wkg, peak_1min_wkg, peak_5min_wkg, metrics_updated_at FROM user_ranking_metrics WHERE user_id = $1',
    [pgUid]
  );
  console.log('after fn_refresh', m2.rows[0]);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
