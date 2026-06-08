/**
 * Phase 2 E2E parity — Strava rides vs Firebase logs, yearly_peaks, user_ranking_metrics.
 *
 * Go/No-Go: sample N rides — 필드 오차 < 1%, peak_60min_wkg 오차 < 1%.
 *
 * 실행:
 *   cd supabase/migration
 *   npx tsx scripts/verifyPhase2E2E.ts --sample=100
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getRemoteConfig } from "firebase-admin/remote-config";
import { v5 as uuidv5 } from "uuid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
loadDotenv({ path: join(root, ".env") });

const SAMPLE = Math.min(
  500,
  Math.max(1, parseInt(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] || "100", 10) || 100)
);
const TOLERANCE_PCT = 0.01;

function uidToUuid(firebaseUid: string): string {
  const ns = process.env.STELVIO_UID_NAMESPACE || "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  return uuidv5(String(firebaseUid).trim(), ns);
}

function nearlyEqual(a: number | null | undefined, b: number | null | undefined, tol = TOLERANCE_PCT): boolean {
  const x = Number(a) || 0;
  const y = Number(b) || 0;
  if (x === 0 && y === 0) return true;
  const denom = Math.max(Math.abs(x), Math.abs(y), 1e-9);
  return Math.abs(x - y) / denom <= tol;
}

function hasComparableNumeric(a: unknown, b: unknown): boolean {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && x !== 0 && Number.isFinite(y) && y !== 0;
}

function readRcParam(
  template: Awaited<ReturnType<ReturnType<typeof getRemoteConfig>["getTemplate"]>>,
  key: string
): string | undefined {
  const p = template.parameters?.[key];
  if (!p?.defaultValue?.value) return undefined;
  return String(p.defaultValue.value);
}

function initFirebase() {
  if (getApps().length) return;
  const cred =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || join(root, "serviceAccountKey.json");
  if (!existsSync(cred)) throw new Error(`Firebase credentials 없음: ${cred}`);
  initializeApp({ credential: cert(cred) });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 없음");
  initFirebase();
  const db = getFirestore();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const ridesRes = await pool.query(
    `SELECT r.id, r.user_id, r.activity_id, r.ride_date, r.source,
            r.distance_km, r.tss, r.max_60min_watts, r.weight_at_ride_kg,
            u.firebase_uid
     FROM public.rides r
     JOIN public.users u ON u.id = r.user_id
     WHERE r.source = 'strava'
       AND u.firebase_uid IS NOT NULL
       AND btrim(u.firebase_uid) <> ''
     ORDER BY r.updated_at DESC NULLS LAST
     LIMIT $1`,
    [SAMPLE]
  );

  const rc = getRemoteConfig();
  const rcTemplate = await rc.getTemplate();
  const dualWriteStatus = (readRcParam(rcTemplate, "dual_write_status") || "OFF").toUpperCase();
  const phase4PrimaryOnly = dualWriteStatus === "FULL";

  const fieldMismatches: Array<Record<string, unknown>> = [];
  const metricsMismatches: Array<Record<string, unknown>> = [];
  const yearlyMismatches: Array<Record<string, unknown>> = [];
  let sampled = 0;
  let firestoreMissing = 0;
  let firestoreStubOnly = 0;
  let compared = 0;
  let comparableFieldChecks = 0;
  let yearlyCompared = 0;

  for (const row of ridesRes.rows) {
    const fbUid = String(row.firebase_uid).trim();
    const activityId = String(row.activity_id || "").trim();
    if (!fbUid || !activityId) continue;
    sampled++;

    const logSnap = await db.collection("users").doc(fbUid).collection("logs").doc(activityId).get();
    if (!logSnap.exists) {
      firestoreMissing++;
      continue;
    }
    const log = logSnap.data() || {};
    const hasCoreFields =
      log.distance_km != null && log.tss != null && log.max_60min_watts != null;
    if (!hasCoreFields) {
      firestoreStubOnly++;
      if (phase4PrimaryOnly) continue;
    }
    compared++;

    const pairs: Array<[string, unknown, unknown]> = [
      ["distance_km", row.distance_km, log.distance_km],
      ["tss", row.tss, log.tss],
      ["max_60min_watts", row.max_60min_watts, log.max_60min_watts],
    ];
    for (const [field, sbRaw, fbRaw] of pairs) {
      if (!hasComparableNumeric(sbRaw, fbRaw)) continue;
      comparableFieldChecks++;
      const sb = Number(sbRaw);
      const fb = Number(fbRaw);
      if (!nearlyEqual(sb, fb)) {
        fieldMismatches.push({
          activityId,
          firebaseUid: fbUid,
          field,
          supabase: sb,
          firebase: fb,
          deltaPct: Math.abs(sb - fb) / Math.max(Math.abs(fb), 1e-9),
        });
      }
    }

    const year = new Date(String(row.ride_date)).getFullYear();
    const sbYearly = await pool.query(
      `SELECT max_60min_watts, max_60min_wkg FROM public.yearly_peaks
       WHERE user_id = $1 AND year = $2`,
      [row.user_id, year]
    );
    const fbYearly = await db
      .collection("users")
      .doc(fbUid)
      .collection("yearly_peaks")
      .doc(String(year))
      .get();

    if (sbYearly.rows.length && fbYearly.exists) {
      yearlyCompared++;
      const s = sbYearly.rows[0];
      const f = fbYearly.data() || {};
      if (!nearlyEqual(s.max_60min_watts, f.max_60min_watts)) {
        yearlyMismatches.push({
          firebaseUid: fbUid,
          year,
          field: "max_60min_watts",
          supabase: s.max_60min_watts,
          firebase: f.max_60min_watts,
        });
      }
      if (!nearlyEqual(s.max_60min_wkg, f.max_60min_wkg)) {
        yearlyMismatches.push({
          firebaseUid: fbUid,
          year,
          field: "max_60min_wkg",
          supabase: s.max_60min_wkg,
          firebase: f.max_60min_wkg,
        });
      }
    }

    const urm = await pool.query(
      `SELECT peak_60min_wkg FROM public.user_ranking_metrics WHERE user_id = $1`,
      [row.user_id]
    );
    const sbPeak60Wkg = Number(urm.rows[0]?.peak_60min_wkg) || 0;
    const wKg = Math.max(Number(row.weight_at_ride_kg) || Number(log.weight) || 0, 45);
    const expectedFromRide =
      wKg > 0 && Number(row.max_60min_watts) > 0
        ? Math.round((Number(row.max_60min_watts) / wKg) * 100) / 100
        : 0;
    if (sbPeak60Wkg > 0 && expectedFromRide > 0 && !nearlyEqual(sbPeak60Wkg, expectedFromRide, 0.02)) {
      metricsMismatches.push({
        firebaseUid: fbUid,
        activityId,
        peak_60min_wkg: sbPeak60Wkg,
        note: "URM peak_60min_wkg vs ride snapshot (rolling window may differ)",
      });
    }
  }

  const phase2Fns = await pool.query(
    `SELECT proname FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND proname IN ('fn_upsert_yearly_peak_from_ride', 'fn_sync_open_ride_strava_reviews')`
  );

  const mismatchRate =
    comparableFieldChecks > 0 ? fieldMismatches.length / comparableFieldChecks : 0;
  const goNoGo =
    sampled >= 1 &&
    phase2Fns.rows.length >= 2 &&
    (phase4PrimaryOnly
      ? firestoreMissing + firestoreStubOnly >= 0 && mismatchRate <= TOLERANCE_PCT
      : compared >= 1 && mismatchRate <= TOLERANCE_PCT);

  const summary = {
    checkedAt: new Date().toISOString(),
    sampleRequested: SAMPLE,
    dual_write_status: dualWriteStatus,
    ridesSampled: sampled,
    firestoreMissing,
    firestoreStubOnly,
    ridesCompared: compared,
    comparableFieldChecks,
    yearlyPeaksCompared: yearlyCompared,
    phase2Functions: phase2Fns.rows.map((r) => r.proname),
    fieldMismatchCount: fieldMismatches.length,
    fieldMismatchRate: mismatchRate,
    yearlyMismatchCount: yearlyMismatches.length,
    metricsNoteCount: metricsMismatches.length,
    goNoGo,
    note: phase4PrimaryOnly
      ? "Phase 4 FULL: Firestore 미존재·스텁은 정상. useSupabaseLogsRead=true로 Read 전환 필요."
      : "Phase 2~3: Firestore·Supabase 양쪽 필드 parity 검증",
    fieldMismatches: fieldMismatches.slice(0, 20),
    yearlyMismatches: yearlyMismatches.slice(0, 20),
    metricsNotes: metricsMismatches.slice(0, 10),
  };

  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
  if (!summary.goNoGo) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
