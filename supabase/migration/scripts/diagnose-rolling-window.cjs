'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');
const { v5: uuidv5 } = require('uuid');

(async function main() {
  const pgUid = uuidv5('Ys8GQZYyf3ZoEunSVGKnWNbtSkv2', process.env.STELVIO_UID_NAMESPACE);
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const r28 = await c.query('SELECT start_date::text, end_date::text FROM public.fn_seoul_rolling_range(28)');
  console.log('rolling28', r28.rows[0]);

  const incl = await c.query(
    `SELECT summary_date::text AS d, max_watts,
            (summary_date BETWEEN (SELECT start_date FROM public.fn_seoul_rolling_range(28))
                           AND (SELECT end_date FROM public.fn_seoul_rolling_range(28))) AS in_window
     FROM daily_summaries
     WHERE user_id = $1 AND max_watts >= 560
     ORDER BY max_watts DESC`,
    [pgUid]
  );
  console.log('high max rows with in_window flag', incl.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
