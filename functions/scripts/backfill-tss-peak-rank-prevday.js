/**
 * TSS 주간 peak_rank_board_snapshots — prev_day_ranks 비어 있을 때 전일(전주) 기준 복구·저장.
 *
 * 사용 (functions 디렉터리):
 *   node scripts/backfill-tss-peak-rank-prevday.js
 *
 * 필요: supabase/migration/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *       supabase/migration/serviceAccountKey.json
 */
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "../../supabase/migration/.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    });
}

const admin = require("firebase-admin");
const saPath = path.join(__dirname, "../../supabase/migration/serviceAccountKey.json");
const sa = require(saPath);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const peakMv = require("../rankingPeakMovementSupabase");
const peakMovement = require("../rankingPeakMovement");
const supabaseRankingReader = require("../supabaseRankingReader");

function getWeekRangeSeoul() {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [y, m, d] = todayStr.split("-").map(Number);
  const today = new Date(y, m - 1, d);
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  const pad = (n) => String(n).padStart(2, "0");
  const startStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  const endStr = `${y}-${pad(m)}-${pad(d)}`;
  return { startStr, endStr };
}

async function backfillGender(gender, historyKey) {
  const { startStr, endStr } = getWeekRangeSeoul();
  const payload = await supabaseRankingReader.fetchWeeklyTssRanking(admin, startStr, endStr, gender);
  if (!payload || !payload.byCategory) {
    console.warn("[backfill] skip empty payload", historyKey);
    return;
  }
  const todayYmd = peakMovement.seoulTodayYmd();
  let prevNorm = await peakMv.readPeakRankNormForHydrate(admin, historyKey, todayYmd);
  prevNorm = await peakMv.ensurePrevDayBaselineForTssWeekly(admin, prevNorm, historyKey, todayYmd);
  const snapFields = peakMovement.computePeakRankMovementFields(
    payload.byCategory,
    prevNorm,
    todayYmd
  );
  await peakMv.writePeakRankSnapshotSupabase(historyKey, snapFields);
  peakMovement.computePeakRankMovementFields(payload.byCategory, prevNorm, todayYmd);
  let withRc = 0;
  for (const cat of peakMovement.PEAK_RANK_BOARD_CATEGORIES) {
    for (const row of payload.byCategory[cat] || []) {
      if (row.rankChange != null) withRc++;
    }
  }
  const snap = await peakMv.readPeakRankSnapshotSupabase(historyKey);
  const prevN = Object.keys((snap.prevDayRanksByCategory || {}).Supremo || {}).length;
  console.log("[backfill] ok", historyKey, "rankChange rows", withRc, "prevDay Supremo uids", prevN);
}

(async () => {
  const keys = [
    ["all", "peak_tss_weekly_all"],
    ["M", "peak_tss_weekly_M"],
    ["F", "peak_tss_weekly_F"],
  ];
  for (const [g, hk] of keys) {
    await backfillGender(g, hk);
  }
  console.log("[backfill] done");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
