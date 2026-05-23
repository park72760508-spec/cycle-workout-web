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
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationDir = resolve(__dirname, "../supabase/migration");
const requireFromMigration = createRequire(join(migrationDir, "package.json"));

const { config: loadDotenv } = requireFromMigration("dotenv");
const admin = requireFromMigration("firebase-admin");
const pg = requireFromMigration("pg");
const { v5: uuidv5 } = requireFromMigration("uuid");

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

/** @returns {'pass'|'fail'|'skip'} */
function boardStatus(ok, skipped) {
  if (skipped) return "skip";
  return ok ? "pass" : "fail";
}

function skipBoard(board, reason, hint, extra = {}) {
  return {
    board,
    status: "skip",
    ok: false,
    skipped: true,
    reason,
    hint,
    ...extra,
  };
}

function failBoard(board, mismatches, extra = {}) {
  return {
    board,
    status: "fail",
    ok: false,
    skipped: false,
    mismatches,
    ...extra,
  };
}

function passBoard(board, compared, extra = {}) {
  return {
    board,
    status: "pass",
    ok: true,
    skipped: false,
    compared,
    mismatches: [],
    ...extra,
  };
}

async function relationExists(pool, qualifiedName) {
  const r = await pool.query(`SELECT to_regclass($1::text) IS NOT NULL AS exists`, [
    qualifiedName,
  ]);
  return r.rows[0]?.exists === true;
}

async function pgSelect(pool, sql, params) {
  try {
    const res = await pool.query(sql, params);
    return { ok: true, rows: res.rows };
  } catch (e) {
    if (e && e.code === "42P01") {
      return { ok: false, code: "42P01", message: e.message };
    }
    throw e;
  }
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

  if (!(await relationExists(pool, "public.mv_leaderboard_weekly_tss"))) {
    return skipBoard(
      "weekly_tss",
      "supabase_mv_missing",
      "스키마 마이그레이션(20260522000000) 적용 후 fn_refresh_ranking_materialized_views() 실행"
    );
  }

  const agg = await readAggregate(db, cacheKey);
  if (!agg?.rows?.length) {
    return skipBoard(
      "weekly_tss",
      "no_firestore_aggregate",
      "Cloud Functions 랭킹 집계 배치 후 재시도, 또는 --boards=peak_60min 만 지정",
      { cacheKey }
    );
  }

  const fsTop = agg.rows
    .slice()
    .sort((a, b) => (b.totalTss ?? b.total_tss ?? 0) - (a.totalTss ?? a.total_tss ?? 0))
    .slice(0, sample);

  const pgRes = await pgSelect(
    pool,
    `SELECT user_id::text, weekly_tss::float8 AS weekly_tss
     FROM public.mv_leaderboard_weekly_tss
     ORDER BY weekly_tss DESC
     LIMIT $1`,
    [sample]
  );
  if (!pgRes.ok) {
    return skipBoard("weekly_tss", "supabase_query_error", pgRes.message);
  }
  const pgRows = pgRes.rows;

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

  if (mismatches.length) {
    return failBoard("weekly_tss", mismatches, { cacheKey, compared: fsTop.length });
  }
  return passBoard("weekly_tss", fsTop.length, { cacheKey });
}

async function comparePeak60min(db, pool, sample) {
  const { startStr, endStr } = rolling28Seoul();
  const cacheKey = `peakRanking_v2_monthly_60min_all_${startStr}_${endStr}`;

  if (!(await relationExists(pool, "public.mv_leaderboard_peak_28d"))) {
    return skipBoard(
      "peak_60min",
      "supabase_mv_missing",
      "스키마 마이그레이션 적용 후 MV refresh 실행"
    );
  }

  const agg = await readAggregate(db, cacheKey);
  if (!agg?.rows?.length) {
    return skipBoard(
      "peak_60min",
      "no_firestore_aggregate",
      "피크 28일 집계(ranking_aggregates) 생성 후 재시도",
      { cacheKey, range: { startStr, endStr } }
    );
  }

  const fsTop = agg.rows
    .slice()
    .sort((a, b) => (b.wkg ?? 0) - (a.wkg ?? 0))
    .slice(0, sample);

  const pgRes = await pgSelect(
    pool,
    `SELECT user_id::text, peak_60min_wkg::float8 AS wkg
     FROM public.mv_leaderboard_peak_28d
     ORDER BY peak_60min_wkg DESC NULLS LAST
     LIMIT $1`,
    [sample]
  );
  if (!pgRes.ok) {
    return skipBoard("peak_60min", "supabase_query_error", pgRes.message);
  }
  const pgRows = pgRes.rows;

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

  if (mismatches.length) {
    return failBoard("peak_60min", mismatches, {
      cacheKey,
      range: { startStr, endStr },
      compared: fsTop.length,
    });
  }
  return passBoard("peak_60min", fsTop.length, { cacheKey, range: { startStr, endStr } });
}

async function compareHeptagon(db, pool, sample) {
  const monthKey = monthKeyKst();
  const filterCategory = "Supremo";
  const filterGender = "all";

  if (!(await relationExists(pool, "public.heptagon_cohort_ranks"))) {
    return skipBoard(
      "heptagon",
      "supabase_table_missing",
      "Supabase SQL Editor 또는 CLI로 supabase/migrations/20260522120100_heptagon_cohort_ranks.sql 적용 후 SELECT fn_rebuild_heptagon_cohort_ranks();"
    );
  }

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
    return skipBoard(
      "heptagon",
      "no_firestore_heptagon",
      "Firestore heptagon_cohort_ranks(03:20 배치) 또는 수동 rebuild 후 재시도",
      { monthKey, filterCategory, filterGender }
    );
  }

  const pgRes = await pgSelect(
    pool,
    `SELECT user_id::text, board_rank, sum_position_scores::float8 AS sum_position_scores
     FROM public.heptagon_cohort_ranks
     WHERE month_key = $1 AND filter_category = $2 AND filter_gender = $3
     ORDER BY board_rank
     LIMIT $4`,
    [monthKey, filterCategory, filterGender, sample]
  );
  if (!pgRes.ok) {
    return skipBoard("heptagon", "supabase_query_error", pgRes.message);
  }
  const pgRows = pgRes.rows;

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

  if (mismatches.length) {
    return failBoard("heptagon", mismatches, { monthKey, compared: fsDocs.length });
  }
  return passBoard("heptagon", fsDocs.length, { monthKey });
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
    let hasFail = false;
    let hasSkip = false;
    for (const r of results) {
      if (!r) continue;
      const label = (r.status || boardStatus(r.ok, r.skipped)).toUpperCase();
      if (label === "FAIL") hasFail = true;
      if (label === "SKIP") hasSkip = true;

      if (label === "PASS") {
        console.log(`[PASS] ${r.board} (n=${r.compared})`);
        continue;
      }
      if (label === "SKIP") {
        console.log(`[SKIP] ${r.board} — ${r.reason}`);
        if (r.hint) console.log(`       → ${r.hint}`);
        if (r.cacheKey) console.log(`       cacheKey: ${r.cacheKey}`);
        continue;
      }
      console.log(`[FAIL] ${r.board}`, { compared: r.compared, cacheKey: r.cacheKey });
      if (r.mismatches?.length) {
        console.log("  mismatches:", JSON.stringify(r.mismatches.slice(0, 10), null, 2));
        if (r.mismatches.length > 10) {
          console.log(`  ... 외 ${r.mismatches.length - 10}건`);
        }
      }
    }

    if (hasFail) {
      console.log("\nFAIL — Firestore vs Supabase 값 불일치. Dual-Write·MV refresh 확인.");
      process.exit(1);
    }
    if (hasSkip) {
      console.log(
        "\nSKIP — 선행 조건 미충족(집계·마이그레이션). 위 안내 후 재실행. exit code 2."
      );
      process.exit(2);
    }
    console.log("\n전체 PASS — 읽기 전환 검토 가능");
    process.exit(0);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
