'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client } = require('pg');

const migrationPath = path.join(
  __dirname,
  '../../migrations/20260626220000_ranking_metrics_backfill_chunk_cron.sql'
);

(async function main() {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(sql);

  const jobs = await c.query(
    "SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname = 'stelvio_ranking_metrics_backfill_chunk'"
  );
  console.log('cron job:', jobs.rows);

  const run = await c.query('SELECT public.fn_run_ranking_metrics_backfill_chunk(80) AS result');
  console.log('first chunk:', run.rows[0].result);

  const meta = await c.query(
    "SELECT meta_key, status, date_kst FROM ranking_build_meta WHERE meta_key = 'ranking_metrics_backfill_chunk'"
  );
  console.log('meta:', meta.rows);

  const st = await c.query('SELECT * FROM ranking_metrics_backfill_state');
  console.log('state:', st.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
