/**
 * Firestore strava_webhook_retries → Supabase public.strava_webhook_retries 1회성 백필.
 * strava_webhook_retries를 Supabase 전용으로 전환하기 전, 이관 시점에 남아있던(특히 pending)
 * 문서를 이어받기 위한 스크립트 — 전환 이후에는 이 컬렉션에 Firestore write가 더 이상 없으므로
 * 반복 실행할 필요는 없다(1회 실행 후 폐기 가능).
 *
 * npm run backfill:strava-webhook-retries
 * npm run backfill:strava-webhook-retries:dry
 */
import { loadConfig } from "../src/config.js";
import { initFirestore, paginateCollection } from "../src/firestore.js";
import { createPool } from "../src/pg.js";

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

type Row = {
  id: string;
  owner_id: number | null;
  object_id: number | null;
  user_id: string | null;
  reason: string | null;
  status: number | null;
  status_queue: string;
  error: string | null;
  failed_at: string | null;
  processed_at: string | null;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dry = hasFlag(argv, "--dry-run") || hasFlag(argv, "--dry");
  const config = loadConfig(argv);
  const db = initFirestore();
  const pool = createPool(config);

  let scanned = 0;
  let upserted = 0;

  console.log(dry ? "*** DRY RUN — INSERT 없음 ***\n" : "");
  console.log("[backfill:strava-webhook-retries] Firestore strava_webhook_retries → Supabase");

  await paginateCollection<Row>(
    db,
    (d) => d.collection("strava_webhook_retries"),
    config.batchSize,
    (doc) => {
      const d = doc.data() || {};
      return {
        id: doc.id,
        owner_id: d.owner_id != null ? Number(d.owner_id) : null,
        object_id: d.object_id != null ? Number(d.object_id) : null,
        user_id: d.user_id ? String(d.user_id) : null,
        reason: d.reason ? String(d.reason) : null,
        status: d.status != null ? Number(d.status) : null,
        status_queue: String(d.status_queue || "pending"),
        error: d.error ? String(d.error).slice(0, 500) : null,
        failed_at: d.failed_at ? String(d.failed_at) : null,
        processed_at: d.processed_at ? String(d.processed_at) : null,
      };
    },
    async (batch) => {
      scanned += batch.length;
      if (dry) return;

      for (const row of batch) {
        /* eslint-disable no-await-in-loop */
        await pool.query(
          `INSERT INTO public.strava_webhook_retries
             (id, owner_id, object_id, user_id, reason, status, status_queue, error, failed_at, processed_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
           ON CONFLICT (id) DO UPDATE SET
             owner_id = EXCLUDED.owner_id,
             object_id = EXCLUDED.object_id,
             user_id = EXCLUDED.user_id,
             reason = EXCLUDED.reason,
             status = EXCLUDED.status,
             status_queue = EXCLUDED.status_queue,
             error = EXCLUDED.error,
             failed_at = EXCLUDED.failed_at,
             processed_at = EXCLUDED.processed_at,
             updated_at = now()`,
          [
            row.id,
            row.owner_id,
            row.object_id,
            row.user_id,
            row.reason,
            row.status,
            row.status_queue,
            row.error,
            row.failed_at,
            row.processed_at,
          ]
        );
        /* eslint-enable no-await-in-loop */
        upserted += 1;
      }
    }
  );

  console.log(`\n[backfill:strava-webhook-retries] 완료 — scanned=${scanned}, upserted=${upserted}`);
  await pool.end();
}

main().catch((err) => {
  console.error("[backfill:strava-webhook-retries] 실패:", err);
  process.exit(1);
});
