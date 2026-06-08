/**
 * Phase 4 FULL + useSupabaseLogsRead=false 구간 Read 갭 진단.
 * 최근 Strava rides 중 Firestore logs 미존재·스텁(핵심 필드 null) 비율.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getRemoteConfig } from "firebase-admin/remote-config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
loadDotenv({ path: join(root, ".env") });

const SAMPLE = Math.min(
  30,
  Math.max(5, parseInt(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] || "20", 10) || 20)
);

function initFirebase() {
  if (getApps().length) return;
  const cred =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || join(root, "serviceAccountKey.json");
  if (!existsSync(cred)) throw new Error(`Firebase credentials 없음: ${cred}`);
  initializeApp({ credential: cert(cred) });
}

async function main() {
  initFirebase();
  const db = getFirestore();
  const rc = getRemoteConfig();
  const template = await rc.getTemplate();
  const dualStatus = String(template.parameters?.dual_write_status?.defaultValue?.value || "OFF").toUpperCase();
  const routingSnap = await db.collection("appConfig").doc("supabase_read_routing").get();
  const routing = routingSnap.exists ? routingSnap.data() : {};

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const ridesRes = await pool.query(
    `SELECT r.activity_id, u.firebase_uid, r.distance_km, r.tss
     FROM public.rides r
     JOIN public.users u ON u.id = r.user_id
     WHERE r.source = 'strava' AND u.firebase_uid IS NOT NULL
     ORDER BY r.updated_at DESC NULLS LAST
     LIMIT $1`,
    [SAMPLE]
  );
  await pool.end();

  let noDoc = 0;
  let stubDoc = 0;
  let fullDoc = 0;

  for (const row of ridesRes.rows) {
    const uid = String(row.firebase_uid).trim();
    const actId = String(row.activity_id || "").trim();
    if (!uid || !actId) continue;
    const snap = await db.collection("users").doc(uid).collection("logs").doc(actId).get();
    if (!snap.exists) {
      noDoc++;
      continue;
    }
    const d = snap.data() || {};
    if (d.distance_km != null && d.tss != null) fullDoc++;
    else stubDoc++;
  }

  const readGapRisk = noDoc + stubDoc;
  const useSupabaseLogsRead = routing?.useSupabaseLogsRead === true;
  const critical =
    dualStatus === "FULL" && !useSupabaseLogsRead && readGapRisk > 0;

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        sample: SAMPLE,
        dual_write_status: dualStatus,
        useSupabaseLogsRead,
        noFirestoreDoc: noDoc,
        stubFirestoreDoc: stubDoc,
        fullFirestoreDoc: fullDoc,
        readGapRisk,
        criticalReadGap: critical,
        recommendation: critical
          ? "useSupabaseLogsRead=true Publish + hosting 배포 즉시 필요"
          : "Read 경로 정상",
      },
      null,
      2
    )
  );
  if (critical) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
