#!/usr/bin/env node
/**
 * Dual-Write(FULL) 이후 Firestore ranking_aggregates / heptagon_cohort_ranks 와
 * Supabase Materialized View·heptagon_cohort_ranks 샘플 대조.
 *
 * 실행 (supabase/migration 의존성·.env 사용):
 *   cd supabase/migration
 *   npm install
 *   node ../../scripts/compare-ranking-firestore-supabase.mjs --sample=30
 *
 * 환경: DATABASE_URL, GOOGLE_APPLICATION_CREDENTIALS, (선택) STELVIO_UID_NAMESPACE
 */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import admin from "firebase-admin";
import pg from "pg";
import { v5 as uuidv5 } from "uuid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationDir = resolve(__dirname, "../supabase/migration");
const requireFromMigration = createRequire(join(migrationDir, "package.json"));
const { config: loadDotenv } = requireFromMigration("dotenv");

function loadEnv() {
  const envPath = join(migrationDir, ".env");
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 없음 — supabase/migration/.env 설정");
  }
  const cred =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    join(migrationDir, "serviceAccountKey.json");
  if (!existsSync(cred)) {
    throw new Error(`Firebase credentials 없음: ${cred}`);
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = cred;
}

function seoulTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function addDaysSeoulYmd(ymd, delta) {
  const t = new Date(`${ymd}T12:00:00+09:00`).getTime() + delta * 86400000;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function rolling28Seoul() {
  const endStr = seoulTodayYmd();
  return { startStr: addDaysSeoulYmd(endStr, -27), endStr };
}

function weekRangeSeoul() {
  const todayStr = seoulTodayYmd();
  const [y, m, d] = todayStr.split("-").map(Number);
  const today = new Date(y, m - 1, d);
  const dow = today.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  const pad = (n) => String(n).padStart(2, "0");
  const startStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  return { startStr, endStr: todayStr };
}

function monthKeyKst() {
  return seoulTodayYmd().slice(0, 7);
}

function firebaseUidToUuid(firebaseUid) {
  const ns = process.env.STELVIO_UID_NAMESPACE || "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  return uuidv5(String(firebaseUid).trim(), ns);
}

function parseArgs(argv) {
  const out = { sample: 25, boards: ["weekly_tss", "peak_60min", "heptagon"] };
  for (const a of argv) {
    if (a.startsWith("--sample=")) out.sample = Math.max(5, Number(a.split("=")[1]) || 25);
    if (a.startsWith("--boards=")) {
      out.boards = a
        .split("=")[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return out;
}

function nearlyEqual(a, b, eps) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function initFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin.firestore();
}

async function readAggregate(db, cacheKey) {
  const snap = await db.collection("ranking_aggregates").doc(cacheKey).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const rows = data.byCategory?.Supremo || data.entries || [];
  return { cacheKey, rows, updatedAt: data.updatedAt };
}

async function compareWeeklyTss(db, pool, sample) {
  const { startStr, endStr } = weekRangeSeoul();
  const cacheKey = `peakRanking_weekly_tss_v2_all_${startStr}_${endStr}`;
  const agg = await readAggregate(db, cacheKey);
  if (!agg?.rows?.length) {
    console.warn("[weekly_tss] Firestore aggregate 없음:", cacheKey);
    return { ok: false, reason: "no_firestore_aggregate" };
  }

  const fsTop = agg.rows
    .slice()
    .sort((a, b) => (b.totalTss ?? b.total_tss ?? 0) - (a.totalTss ?? a.total_tss ?? 0))
    .slice(0, sample);

  const { rows: pgRows } = await pool.query(
    `SELECT user_id::text, weekly_tss::float8 AS weekly_tss
     FROM public.mv_leaderboard_weekly_tss
     ORDER BY weekly_tss DESC
     LIMIT $1`,
    [sample]
  );

  const pgByUid = new Map(pgRows.map((r) => [r.user_id, r.weekly_tss]));
  const mismatches = [];

  for (let i = 0; i < fsTop.length; i++) {
    const e = fsTop[i];
    const uid = String(e.userId);
    const uuid = firebaseUidToUuid(uid);
    const fsTss = Number(e.totalTss ?? e.total_tss ?? 0);
    const pgTss = pgByUid.get(uuid);
    if (pgTss == null) {
      mismatches.push({ rank: i + 1, uid, issue: "missing_in_supabase", fsTss });
      continue;
    }
    if (!nearlyEqual(fsTss, pgTss, 0.05)) {
      mismatches.push({ rank: i + 1, uid, fsTss, pgTss, delta: fsTss - pgTss });
    }
  }

  return {
    ok: mismatches.length === 0,
    board: "weekly_tss",
    cacheKey,
    compared: fsTop.length,
    mismatches,
  };
}

async function comparePeak60min(db, pool, sample) {
  const { startStr, endStr } = rolling28Seoul();
  const cacheKey = `peakRanking_v2_monthly_60min_all_${startStr}_${endStr}`;
  const agg = await readAggregate(db, cacheKey);
  if (!agg?.rows?.length) {
    console.warn("[peak_60min] Firestore aggregate 없음:", cacheKey);
    return { ok: false, reason: "no_firestore_aggregate" };
  }

  const fsTop = agg.rows
    .slice()
    .sort((a, b) => (b.wkg ?? 0) - (a.wkg ?? 0))
    .slice(0, sample);

  const { rows: pgRows } = await pool.query(
    `SELECT user_id::text, peak_60min_wkg::float8 AS wkg
     FROM public.mv_leaderboard_peak_28d
     ORDER BY peak_60min_wkg DESC NULLS LAST
     LIMIT $1`,
    [sample]
  );

  const pgByUid = new Map(pgRows.map((r) => [r.user_id, r.wkg]));
  const mismatches = [];

  for (let i = 0; i < fsTop.length; i++) {
    const e = fsTop[i];
    const uid = String(e.userId);
    const uuid = firebaseUidToUuid(uid);
    const fsW = Number(e.wkg ?? 0);
    const pgW = pgByUid.get(uuid);
    if (pgW == null) {
      mismatches.push({ rank: i + 1, uid, issue: "missing_in_supabase", fsW });
      continue;
    }
    if (!nearlyEqual(fsW, pgW, 0.02)) {
      mismatches.push({ rank: i + 1, uid, fsW, pgW, delta: fsW - pgW });
    }
  }

  return {
    ok: mismatches.length === 0,
    board: "peak_60min",
    cacheKey,
    range: { startStr, endStr },
    compared: fsTop.length,
    mismatches,
  };
}

async function compareHeptagon(db, pool, sample) {
  const monthKey = monthKeyKst();
  const filterCategory = "Supremo";
  const filterGender = "all";

  const fsSnap = await db
    .collection("heptagon_cohort_ranks")
    .where("monthKey", "==", monthKey)
    .where("filterCategory", "==", filterCategory)
    .where("filterGender", "==", filterGender)
    .limit(Math.min(sample * 3, 500))
    .get();

  const fsDocs = fsSnap.docs
    .slice()
    .sort((a, b) => (a.data().boardRank ?? 9999) - (b.data().boardRank ?? 9999))
    .slice(0, sample);

  if (!fsDocs.length) {
    console.warn("[heptagon] Firestore 문서 없음:", { monthKey, filterCategory, filterGender });
    return { ok: false, reason: "no_firestore_heptagon" };
  }

  const { rows: pgRows } = await pool.query(
    `SELECT user_id::text, board_rank, sum_position_scores::float8 AS sum_position_scores
     FROM public.heptagon_cohort_ranks
     WHERE month_key = $1 AND filter_category = $2 AND filter_gender = $3
     ORDER BY board_rank
     LIMIT $4`,
    [monthKey, filterCategory, filterGender, sample]
  );

  const pgByUid = new Map(
    pgRows.map((r) => [r.user_id, { boardRank: r.board_rank, sum: r.sum_position_scores }])
  );

  const mismatches = [];
  for (const doc of fsDocs) {
    const d = doc.data();
    const uid = String(d.userId);
    const uuid = firebaseUidToUuid(uid);
    const pg = pgByUid.get(uuid);
    if (!pg) {
      mismatches.push({
        boardRank: d.boardRank,
        uid,
        issue: "missing_in_supabase",
        fsSum: d.sumPositionScores,
      });
      continue;
    }
    if (pg.boardRank !== d.boardRank) {
      mismatches.push({
        uid,
        fsRank: d.boardRank,
        pgRank: pg.boardRank,
        fsSum: d.sumPositionScores,
        pgSum: pg.sum,
      });
    } else if (!nearlyEqual(d.sumPositionScores, pg.sum, 0.5)) {
      mismatches.push({
        uid,
        boardRank: d.boardRank,
        fsSum: d.sumPositionScores,
        pgSum: pg.sum,
        issue: "sum_position_scores_delta",
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    board: "heptagon",
    monthKey,
    compared: fsDocs.length,
    mismatches,
  };
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  const db = initFirebase();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const results = [];

  try {
    if (opts.boards.includes("weekly_tss")) {
      results.push(await compareWeeklyTss(db, pool, opts.sample));
    }
    if (opts.boards.includes("peak_60min")) {
      results.push(await comparePeak60min(db, pool, opts.sample));
    }
    if (opts.boards.includes("heptagon")) {
      results.push(await compareHeptagon(db, pool, opts.sample));
    }

    console.log("\n=== 랭킹 정합성 샘플 검증 ===\n");
    let allOk = true;
    for (const r of results) {
      if (!r) continue;
      const status = r.ok ? "PASS" : "FAIL";
      if (!r.ok) allOk = false;
      console.log(`[${status}] ${r.board}`, r.ok ? `(n=${r.compared})` : r);
      if (r.mismatches?.length) {
        console.log("  mismatches:", JSON.stringify(r.mismatches.slice(0, 10), null, 2));
        if (r.mismatches.length > 10) {
          console.log(`  ... 외 ${r.mismatches.length - 10}건`);
        }
      }
    }

    console.log(allOk ? "\n전체 PASS — 읽기 전환 검토 가능" : "\nFAIL — Dual-Write·MV refresh·헵타곤 cron 확인");
    process.exit(allOk ? 0 : 1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
