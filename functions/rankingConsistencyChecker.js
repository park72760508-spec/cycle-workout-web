#!/usr/bin/env node
/**
 * Firebase ranking_aggregates vs Supabase MV 샘플 대조 (백엔드 자체 검증).
 *
 * 실행 (functions 디렉터리):
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node rankingConsistencyChecker.js --sample=20
 *
 * Slack: CONSISTENCY_SLACK_WEBHOOK_URL 설정 시 요약 POST (선택).
 */
const admin = require("firebase-admin");
const rankingReadConfig = require("./rankingReadConfig");
const supabaseRankingReader = require("./supabaseRankingReader");

function parseArgs(argv) {
  const out = { sample: 20, boards: ["weekly_tss", "peak_60min"] };
  for (const a of argv) {
    if (a.startsWith("--sample=")) out.sample = Math.max(5, Number(a.split("=")[1]) || 20);
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

function seoulToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function addDaysSeoul(ymd, delta) {
  const t = new Date(`${ymd}T12:00:00+09:00`).getTime() + delta * 86400000;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function weekRangeSeoul() {
  const todayStr = seoulToday();
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

function rolling28() {
  const endStr = seoulToday();
  return { startStr: addDaysSeoul(endStr, -27), endStr };
}

async function readFirestoreAggregate(db, cacheKey) {
  const snap = await db.collection("ranking_aggregates").doc(cacheKey).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const rows = data.byCategory?.Supremo || data.entries || [];
  return rows;
}

function topN(rows, key, n) {
  return (rows || [])
    .slice()
    .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
    .slice(0, n);
}

function nearlyEqual(a, b, eps) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

async function compareBoard(db, adminApp, board, sample) {
  if (board === "weekly_tss") {
    const { startStr, endStr } = weekRangeSeoul();
    const cacheKey = `peakRanking_weekly_tss_v2_all_${startStr}_${endStr}`;
    const fsRows = await readFirestoreAggregate(db, cacheKey);
    if (!fsRows || !fsRows.length) {
      return { board, status: "skip", reason: "no_firestore_aggregate", cacheKey };
    }
    const sb = await supabaseRankingReader.fetchWeeklyTssRanking(
      adminApp,
      startStr,
      endStr,
      "all"
    );
    const fsTop = topN(fsRows, "totalTss", sample);
    const sbMap = new Map((sb.entries || []).map((e) => [e.userId, e.totalTss]));
    const mismatches = [];
    fsTop.forEach((e, i) => {
      const pg = sbMap.get(e.userId);
      if (pg == null) {
        mismatches.push({ rank: i + 1, userId: e.userId, issue: "missing_in_supabase" });
      } else if (!nearlyEqual(e.totalTss, pg, 0.05)) {
        mismatches.push({
          rank: i + 1,
          userId: e.userId,
          fs: e.totalTss,
          sb: pg,
        });
      }
    });
    return {
      board,
      status: mismatches.length ? "fail" : "pass",
      cacheKey,
      compared: fsTop.length,
      mismatches,
    };
  }

  if (board === "peak_60min") {
    const { startStr, endStr } = rolling28();
    const cacheKey = `peakRanking_v2_monthly_60min_all_${startStr}_${endStr}`;
    const fsRows = await readFirestoreAggregate(db, cacheKey);
    if (!fsRows || !fsRows.length) {
      return { board, status: "skip", reason: "no_firestore_aggregate", cacheKey };
    }
    const sb = await supabaseRankingReader.fetchPeakPowerMonthly(
      adminApp,
      startStr,
      endStr,
      "60min",
      "all"
    );
    const fsTop = topN(fsRows, "wkg", sample);
    const sbMap = new Map((sb.entries || []).map((e) => [e.userId, e.wkg]));
    const mismatches = [];
    fsTop.forEach((e, i) => {
      const pg = sbMap.get(e.userId);
      if (pg == null) {
        mismatches.push({ rank: i + 1, userId: e.userId, issue: "missing_in_supabase" });
      } else if (!nearlyEqual(e.wkg, pg, 0.02)) {
        mismatches.push({ rank: i + 1, userId: e.userId, fs: e.wkg, sb: pg });
      }
    });
    return {
      board,
      status: mismatches.length ? "fail" : "pass",
      cacheKey,
      compared: fsTop.length,
      mismatches,
    };
  }

  return { board, status: "skip", reason: "unknown_board" };
}

async function postSlack(webhookUrl, text) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.warn("[rankingConsistencyChecker] Slack post failed:", e.message);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();

  const cfg = await rankingReadConfig.refreshRankingReadConfig(admin, true);
  console.log("[rankingConsistencyChecker] read config", cfg);

  const results = [];
  for (const board of opts.boards) {
    results.push(await compareBoard(db, admin, board, opts.sample));
  }

  const lines = ["*STELVIO 랭킹 정합성 검사*"];
  let exitCode = 0;
  for (const r of results) {
    const label = r.status.toUpperCase();
    lines.push(`• ${r.board}: ${label} (n=${r.compared || 0})`);
    console.log(JSON.stringify(r, null, 2));
    if (r.status === "fail") exitCode = 1;
    if (r.status === "skip") exitCode = Math.max(exitCode, 2);
  }

  const summary = lines.join("\n");
  console.log("\n" + summary);
  await postSlack(process.env.CONSISTENCY_SLACK_WEBHOOK_URL, summary);
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { compareBoard, main };
