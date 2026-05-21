/**
 * Firestore → Supabase PostgreSQL 마이그레이션
 *
 * 실행: npm install && npm run migrate
 * 사전 조건: auth.users 이관 완료 (FIREBASE_UID_UUID_MODE=v5 시 동일 UUID 규칙)
 */
import type { Firestore } from "firebase-admin/firestore";
import { loadConfig, type MigrationPhase } from "./src/config.js";
import { bulkWrite, upsertBatch } from "./src/bulkInsert.js";
import { initFirestore, paginateCollection } from "./src/firestore.js";
import { MigrationLogger } from "./src/logger.js";
import {
  mapDailySummaryRow,
  mapFriendRow,
  mapOpenRideRow,
  mapPointHistoryRow,
  mapProcessedOrderRow,
  mapRideRow,
  mapStravaConnectionRow,
  mapUserOrderRow,
  mapUserRow,
  mapYearlyPeakRow,
} from "./src/mappers.js";
import {
  createPool,
  loadAuthUserIdSet,
  refreshMaterializedViews,
  refreshRankingMetricsBatch,
  setTriggerEnabled,
} from "./src/pg.js";
import { parseUserIdFromPath, resolveUserUuid } from "./src/uid.js";

const USER_COLUMNS = [
  "id",
  "name",
  "display_name",
  "contact",
  "phone",
  "email",
  "ftp",
  "ftp_updated_at",
  "weight_kg",
  "birth_year",
  "gender",
  "challenge",
  "grade",
  "account_status",
  "expiry_date",
  "acc_points",
  "rem_points",
  "last_training_date",
  "is_private",
  "profile_image_url",
  "max_hr",
  "created_at",
  "updated_at",
] as const;

const RIDE_COLUMNS = [
  "user_id",
  "source",
  "activity_id",
  "activity_type",
  "title",
  "ride_date",
  "workout_id",
  "duration_sec",
  "distance_km",
  "elevation_gain_m",
  "avg_speed_kmh",
  "weight_at_ride_kg",
  "ftp_at_time",
  "avg_watts",
  "weighted_watts",
  "max_watts",
  "tss",
  "intensity_factor",
  "kilojoules",
  "earned_points",
  "avg_hr",
  "max_hr",
  "avg_cadence",
  "efficiency_factor",
  "rpe",
  "max_1min_watts",
  "max_5min_watts",
  "max_10min_watts",
  "max_20min_watts",
  "max_30min_watts",
  "max_40min_watts",
  "max_60min_watts",
  "max_hr_1min",
  "max_hr_5min",
  "max_hr_10min",
  "max_hr_20min",
  "max_hr_40min",
  "max_hr_60min",
  "tss_applied",
  "tss_applied_at",
  "created_at",
  "updated_at",
] as const;

async function main(): Promise<void> {
  const config = loadConfig(process.argv);
  const log = new MigrationLogger(config.logPath);
  const dry = config.dryRun;

  if (dry) console.log("*** DRY RUN — DB 쓰기 없음 ***\n");

  const db = initFirestore();
  const pool = createPool(config);
  const authIds = await loadAuthUserIdSet(pool, config);

  const migratedUserIds = new Set<string>();

  const shouldRun = (p: MigrationPhase) => config.phases.has(p);

  try {
    if (shouldRun("users")) {
      await migrateUsers(db, pool, config, log, authIds, migratedUserIds, dry);
    }

    if (shouldRun("strava")) {
      await migrateStravaFromUsers(db, pool, config, log, authIds, dry);
    }

    if (shouldRun("processed_orders")) {
      await migrateProcessedOrders(db, pool, config, log, authIds, dry);
    }

    if (shouldRun("point_history")) {
      await migratePointHistory(db, pool, config, log, authIds, dry);
    }

    const client = dry ? null : await pool.connect();

    try {
      if (client && config.disableTriggersDuringBulk) {
        await setTriggerEnabled(client, "public.rides", "trg_rides_refresh_stats", false);
      }

      if (shouldRun("daily_summaries")) {
        await migrateDailySummaries(db, client, pool, config, log, authIds, dry);
      }

      if (shouldRun("rides")) {
        await migrateRides(db, client, pool, config, log, authIds, dry);
      }

      if (client && config.disableTriggersDuringBulk) {
        await setTriggerEnabled(client, "public.rides", "trg_rides_refresh_stats", true);
      }
    } finally {
      client?.release();
    }

    if (shouldRun("yearly_peaks")) {
      await migrateYearlyPeaks(db, pool, config, log, authIds, dry);
    }

    if (shouldRun("friends")) {
      await migrateFriends(db, pool, config, log, authIds, dry);
    }

    if (shouldRun("orders")) {
      await migrateUserOrders(db, pool, config, log, authIds, dry);
    }

    if (shouldRun("open_rides")) {
      await migrateOpenRides(db, pool, config, log, authIds, dry);
    }

    if (shouldRun("refresh_metrics")) {
      await refreshAllMetrics(pool, config, log, migratedUserIds, dry);
    }
  } finally {
    await pool.end();
    log.summary();
  }
}

async function migrateUsers(
  db: Firestore,
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  authIds: Set<string>,
  migratedUserIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "users";
  console.log(`\n[${phase}] Firestore users → public.users`);

  await paginateCollection(
    db,
    (d) => d.collection("users"),
    config.batchSize,
    (doc) => {
      try {
        const row = mapUserRow(doc.id, doc.data(), config);
        if (!row) return null;
        const id = String(row.id);
        if (config.skipUsersWithoutAuth && !authIds.has(id.toLowerCase())) {
          log.error(phase, `skip no auth.users: ${doc.id}`, new Error("auth missing"));
          return null;
        }
        migratedUserIds.add(id);
        return row;
      } catch (e) {
        log.error(phase, `map ${doc.ref.path}`, e);
        return null;
      }
    },
    async (batch) => {
      if (dry) {
        log.ok(phase, batch.length);
        return;
      }
      const client = await pool.connect();
      try {
        await upsertBatch(
          client,
          "public.users",
          [...USER_COLUMNS],
          batch,
          "id",
          USER_COLUMNS.filter((c) => c !== "id")
        );
        log.ok(phase, batch.length);
      } catch (e) {
        log.error(phase, `upsert batch (${batch.length})`, e);
      } finally {
        client.release();
      }
    }
  );
}

async function migrateStravaFromUsers(
  db: Firestore,
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  authIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "strava";
  console.log(`\n[${phase}] users.strava_* → strava_connections`);

  await paginateCollection(
    db,
    (d) => d.collection("users"),
    config.batchSize,
    (doc) => {
      try {
        if (config.skipUsersWithoutAuth && !authIds.has(resolveUserUuid(doc.id, config)?.toLowerCase() ?? "")) {
          return null;
        }
        return mapStravaConnectionRow(doc.id, doc.data(), config);
      } catch (e) {
        log.error(phase, doc.ref.path, e);
        return null;
      }
    },
    async (batch) => {
      const rows = batch.filter(Boolean) as Record<string, unknown>[];
      if (!rows.length) return;
      if (dry) {
        log.ok(phase, rows.length);
        return;
      }
      const client = await pool.connect();
      try {
        await upsertBatch(
          client,
          "public.strava_connections",
          [
            "user_id",
            "strava_athlete_id",
            "access_token",
            "refresh_token",
            "expires_at",
            "connected_at",
            "updated_at",
          ],
          rows,
          "user_id",
          ["strava_athlete_id", "access_token", "refresh_token", "expires_at", "updated_at"]
        );
        log.ok(phase, rows.length);
      } catch (e) {
        log.error(phase, "upsert", e);
      } finally {
        client.release();
      }
    }
  );
}

async function migrateProcessedOrders(
  db: Firestore,
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  authIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "processed_orders";
  console.log(`\n[${phase}] processed_orders`);

  await paginateCollection(
    db,
    (d) => d.collection("processed_orders"),
    config.batchSize,
    (doc) => {
      try {
        const row = mapProcessedOrderRow(doc.data(), config);
        if (!row) return null;
        if (config.skipUsersWithoutAuth && !authIds.has(String(row.user_id).toLowerCase())) {
          return null;
        }
        return row;
      } catch (e) {
        log.error(phase, doc.ref.path, e);
        return null;
      }
    },
    async (batch) => {
      if (dry) {
        log.ok(phase, batch.length);
        return;
      }
      const client = await pool.connect();
      try {
        await bulkWrite(
          client,
          "public.processed_orders",
          [
            "product_order_id",
            "user_id",
            "added_days",
            "order_type",
            "processed_at",
            "revoked",
            "revoked_at",
          ],
          batch,
          {
            conflictSql: `ON CONFLICT (product_order_id) DO NOTHING`,
            useCopy: false,
          }
        );
        log.ok(phase, batch.length);
      } catch (e) {
        log.error(phase, "insert", e);
      } finally {
        client.release();
      }
    }
  );
}

async function migratePointHistory(
  db: Firestore,
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  authIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "point_history";
  console.log(`\n[${phase}] point_history`);

  const cols = [
    "user_id",
    "source",
    "is_strava",
    "tss",
    "earned_points",
    "points_before",
    "points_after",
    "ride_id",
    "created_at",
  ];

  await paginateCollection(
    db,
    (d) => d.collection("point_history"),
    config.batchSize,
    (doc) => {
      try {
        const row = mapPointHistoryRow(doc.id, doc.data(), config);
        if (!row) return null;
        if (config.skipUsersWithoutAuth && !authIds.has(String(row.user_id).toLowerCase())) {
          return null;
        }
        delete row._firestore_id;
        return row;
      } catch (e) {
        log.error(phase, doc.ref.path, e);
        return null;
      }
    },
    async (batch) => {
      if (dry) {
        log.ok(phase, batch.length);
        return;
      }
      const client = await pool.connect();
      try {
        await bulkWrite(client, "public.point_history", cols, batch);
        log.ok(phase, batch.length);
      } catch (e) {
        log.error(phase, "copy", e);
      } finally {
        client.release();
      }
    }
  );
}

async function migrateDailySummaries(
  db: Firestore,
  client: import("pg").PoolClient | null,
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  authIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "daily_summaries";
  console.log(`\n[${phase}] collectionGroup ranking_day_totals → daily_summaries`);

  const cols = [
    "user_id",
    "summary_date",
    "tss_strava_sum",
    "tss_stelvio_sum",
    "km_strava_sum",
    "km_stelvio_sum",
    "weight_used_kg",
    "max_1min_watts",
    "max_5min_watts",
    "max_10min_watts",
    "max_20min_watts",
    "max_40min_watts",
    "max_60min_watts",
    "max_watts",
    "max_hr_1min",
    "max_hr_5min",
    "max_hr_10min",
    "max_hr_20min",
    "max_hr_40min",
    "max_hr_60min",
    "reconciled_at",
  ];

  await paginateCollection(
    db,
    (d) => d.collectionGroup("ranking_day_totals"),
    config.batchSize,
    (doc) => {
      try {
        const firebaseUid = parseUserIdFromPath(doc.ref.path);
        if (!firebaseUid) return null;
        if (config.skipUsersWithoutAuth && !authIds.has(resolveUserUuid(firebaseUid, config)?.toLowerCase() ?? "")) {
          return null;
        }
        return mapDailySummaryRow(firebaseUid, doc.id, doc.data(), config);
      } catch (e) {
        log.error(phase, doc.ref.path, e);
        return null;
      }
    },
    async (batch) => {
      if (dry) {
        log.ok(phase, batch.length);
        return;
      }
      const c = client ?? (await pool.connect());
      try {
        await bulkWrite(c, "public.daily_summaries", cols, batch, {
          conflictSql: `ON CONFLICT (user_id, summary_date) DO UPDATE SET
            tss_strava_sum = EXCLUDED.tss_strava_sum,
            tss_stelvio_sum = EXCLUDED.tss_stelvio_sum,
            km_strava_sum = EXCLUDED.km_strava_sum,
            km_stelvio_sum = EXCLUDED.km_stelvio_sum,
            weight_used_kg = EXCLUDED.weight_used_kg,
            max_1min_watts = EXCLUDED.max_1min_watts,
            max_5min_watts = EXCLUDED.max_5min_watts,
            max_10min_watts = EXCLUDED.max_10min_watts,
            max_20min_watts = EXCLUDED.max_20min_watts,
            max_40min_watts = EXCLUDED.max_40min_watts,
            max_60min_watts = EXCLUDED.max_60min_watts,
            max_watts = EXCLUDED.max_watts,
            max_hr_1min = EXCLUDED.max_hr_1min,
            max_hr_5min = EXCLUDED.max_hr_5min,
            max_hr_10min = EXCLUDED.max_hr_10min,
            max_hr_20min = EXCLUDED.max_hr_20min,
            max_hr_40min = EXCLUDED.max_hr_40min,
            max_hr_60min = EXCLUDED.max_hr_60min,
            reconciled_at = EXCLUDED.reconciled_at`,
          useCopy: false,
        });
        log.ok(phase, batch.length);
      } catch (e) {
        log.error(phase, "bulk", e);
      } finally {
        if (!client) c.release();
      }
    }
  );
}

async function migrateRides(
  db: Firestore,
  client: import("pg").PoolClient | null,
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  authIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "rides";
  console.log(`\n[${phase}] collectionGroup logs → rides`);

  await paginateCollection(
    db,
    (d) => d.collectionGroup("logs"),
    config.batchSize,
    (doc) => {
      try {
        const firebaseUid = parseUserIdFromPath(doc.ref.path);
        if (!firebaseUid) return null;
        if (config.skipUsersWithoutAuth && !authIds.has(resolveUserUuid(firebaseUid, config)?.toLowerCase() ?? "")) {
          return null;
        }
        return mapRideRow(firebaseUid, doc.id, doc.data(), config);
      } catch (e) {
        log.error(phase, doc.ref.path, e);
        return null;
      }
    },
    async (batch) => {
      if (dry) {
        log.ok(phase, batch.length);
        return;
      }
      const c = client ?? (await pool.connect());
      try {
        await bulkWrite(c, "public.rides", [...RIDE_COLUMNS], batch, {
          conflictSql: `ON CONFLICT (user_id, activity_id) DO NOTHING`,
          useCopy: false,
        });
        log.ok(phase, batch.length);
      } catch (e) {
        log.error(phase, "bulk", e);
      } finally {
        if (!client) c.release();
      }
    }
  );
}

async function migrateYearlyPeaks(
  db: Firestore,
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  authIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "yearly_peaks";
  console.log(`\n[${phase}] collectionGroup yearly_peaks`);

  const cols = [
    "user_id",
    "year",
    "weight_kg",
    "max_hr",
    "max_hr_date",
    "max_1min_watts",
    "max_1min_wkg",
    "max_5min_watts",
    "max_5min_wkg",
    "max_10min_watts",
    "max_10min_wkg",
    "max_20min_watts",
    "max_20min_wkg",
    "max_40min_watts",
    "max_40min_wkg",
    "max_60min_watts",
    "max_60min_wkg",
    "max_watts",
    "max_wkg",
    "updated_at",
  ];

  await paginateCollection(
    db,
    (d) => d.collectionGroup("yearly_peaks"),
    config.batchSize,
    (doc) => {
      try {
        const firebaseUid = parseUserIdFromPath(doc.ref.path);
        if (!firebaseUid) return null;
        if (config.skipUsersWithoutAuth && !authIds.has(resolveUserUuid(firebaseUid, config)?.toLowerCase() ?? "")) {
          return null;
        }
        return mapYearlyPeakRow(firebaseUid, doc.id, doc.data(), config);
      } catch (e) {
        log.error(phase, doc.ref.path, e);
        return null;
      }
    },
    async (batch) => {
      if (dry) {
        log.ok(phase, batch.length);
        return;
      }
      const client = await pool.connect();
      try {
        await bulkWrite(client, "public.yearly_peaks", cols, batch, {
          conflictSql: `ON CONFLICT (user_id, year) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
          useCopy: false,
        });
        log.ok(phase, batch.length);
      } catch (e) {
        log.error(phase, "bulk", e);
      } finally {
        client.release();
      }
    }
  );
}

async function migrateFriends(
  db: Firestore,
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  authIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "friends";
  console.log(`\n[${phase}] collectionGroup friends`);

  const cols = ["user_id", "friend_user_id", "display_name", "contact", "created_at"];

  await paginateCollection(
    db,
    (d) => d.collectionGroup("friends"),
    config.batchSize,
    (doc) => {
      try {
        const firebaseUid = parseUserIdFromPath(doc.ref.path);
        if (!firebaseUid) return null;
        if (config.skipUsersWithoutAuth && !authIds.has(resolveUserUuid(firebaseUid, config)?.toLowerCase() ?? "")) {
          return null;
        }
        return mapFriendRow(firebaseUid, doc.id, doc.data(), config);
      } catch (e) {
        log.error(phase, doc.ref.path, e);
        return null;
      }
    },
    async (batch) => {
      if (dry) {
        log.ok(phase, batch.length);
        return;
      }
      const client = await pool.connect();
      try {
        await bulkWrite(client, "public.user_friends", cols, batch, {
          conflictSql: `ON CONFLICT (user_id, friend_user_id) DO NOTHING`,
          useCopy: false,
        });
        log.ok(phase, batch.length);
      } catch (e) {
        log.error(phase, "bulk", e);
      } finally {
        client.release();
      }
    }
  );
}

async function migrateUserOrders(
  db: Firestore,
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  authIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "orders";
  console.log(`\n[${phase}] collectionGroup orders`);

  const cols = [
    "user_id",
    "product_order_id",
    "product_name",
    "product_option",
    "quantity",
    "payment_date",
    "status",
    "claim_date",
    "claim_reason",
    "created_at",
  ];

  await paginateCollection(
    db,
    (d) => d.collectionGroup("orders"),
    config.batchSize,
    (doc) => {
      try {
        const firebaseUid = parseUserIdFromPath(doc.ref.path);
        if (!firebaseUid) return null;
        if (config.skipUsersWithoutAuth && !authIds.has(resolveUserUuid(firebaseUid, config)?.toLowerCase() ?? "")) {
          return null;
        }
        return mapUserOrderRow(firebaseUid, doc.id, doc.data(), config);
      } catch (e) {
        log.error(phase, doc.ref.path, e);
        return null;
      }
    },
    async (batch) => {
      if (dry) {
        log.ok(phase, batch.length);
        return;
      }
      const client = await pool.connect();
      try {
        await bulkWrite(client, "public.user_orders", cols, batch, {
          conflictSql: `ON CONFLICT (user_id, product_order_id) DO NOTHING`,
          useCopy: false,
        });
        log.ok(phase, batch.length);
      } catch (e) {
        log.error(phase, "bulk", e);
      } finally {
        client.release();
      }
    }
  );
}

async function migrateOpenRides(
  db: Firestore,
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  authIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "open_rides";
  console.log(`\n[${phase}] rides (오픈 라이딩) → open_rides`);

  const rideCols = [
    "id",
    "host_user_id",
    "title",
    "ride_date",
    "departure_time",
    "departure_location",
    "distance_km",
    "course",
    "level",
    "max_participants",
    "host_name",
    "contact_info",
    "is_contact_public",
    "gpx_url",
    "region",
    "status",
    "created_at",
    "updated_at",
  ];

  await paginateCollection(
    db,
    (d) => d.collection("rides"),
    config.batchSize,
    (doc) => {
      try {
        const row = mapOpenRideRow(doc.id, doc.data(), config);
        if (!row) return null;
        if (config.skipUsersWithoutAuth && !authIds.has(String(row.host_user_id).toLowerCase())) {
          return null;
        }
        return row;
      } catch (e) {
        log.error(phase, doc.ref.path, e);
        return null;
      }
    },
    async (batch) => {
      if (dry) {
        log.ok(phase, batch.length);
        return;
      }

      const rideRows: Record<string, unknown>[] = [];
      const participants: Record<string, unknown>[] = [];

      for (const raw of batch) {
        const participantsRaw = raw._participants as string[] | undefined;
        const waitlistRaw = raw._waitlist as string[] | undefined;
        delete raw._participants;
        delete raw._waitlist;
        rideRows.push(raw);

        const rideId = raw.id as string;
        (participantsRaw ?? []).forEach((uid) => {
          const u = resolveUserUuid(String(uid), config);
          if (!u || !authIds.has(u.toLowerCase())) return;
          participants.push({
            ride_id: rideId,
            user_id: u,
            is_waitlist: false,
            waitlist_position: null,
            joined_at: new Date().toISOString(),
          });
        });
        (waitlistRaw ?? []).forEach((uid, i) => {
          const u = resolveUserUuid(String(uid), config);
          if (!u || !authIds.has(u.toLowerCase())) return;
          participants.push({
            ride_id: rideId,
            user_id: u,
            is_waitlist: true,
            waitlist_position: i + 1,
            joined_at: new Date().toISOString(),
          });
        });
      }

      const client = await pool.connect();
      try {
        await bulkWrite(client, "public.open_rides", rideCols, rideRows, {
          conflictSql: `ON CONFLICT (id) DO NOTHING`,
          useCopy: false,
        });
        if (participants.length) {
          await bulkWrite(
            client,
            "public.open_ride_participants",
            ["ride_id", "user_id", "is_waitlist", "waitlist_position", "joined_at"],
            participants,
            {
              conflictSql: `ON CONFLICT (ride_id, user_id) DO NOTHING`,
              useCopy: false,
            }
          );
        }
        log.ok(phase, rideRows.length);
      } catch (e) {
        log.error(phase, "bulk", e);
      } finally {
        client.release();
      }
    }
  );
}

async function refreshAllMetrics(
  pool: ReturnType<typeof createPool>,
  config: ReturnType<typeof loadConfig>,
  log: MigrationLogger,
  migratedUserIds: Set<string>,
  dry: boolean
): Promise<void> {
  const phase = "refresh_metrics";
  console.log(`\n[${phase}] user_ranking_metrics + materialized views`);

  if (dry) return;

  let ids = [...migratedUserIds];
  if (ids.length === 0) {
    const res = await pool.query(`SELECT id::text FROM public.users`);
    ids = res.rows.map((r: { id: string }) => r.id);
  }

  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    try {
      await refreshRankingMetricsBatch(pool, slice, false);
      log.ok(phase, slice.length);
      console.log(`  refreshed metrics ${Math.min(i + chunk, ids.length)} / ${ids.length}`);
    } catch (e) {
      log.error(phase, `batch ${i}-${i + chunk}`, e);
    }
  }

  try {
    await refreshMaterializedViews(pool, false);
    console.log("  materialized views refreshed");
  } catch (e) {
    log.error(phase, "mv_refresh", e);
  }
}

main().catch((e) => {
  console.error("Migration fatal error:", e);
  process.exit(1);
});
