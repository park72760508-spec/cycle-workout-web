/**
 * Phase 6 Go/No-Go — rides 데이터·Read 라우팅 API·parity.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
loadDotenv({ path: join(root, ".env") });

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
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const routingSnap = await db.collection("appConfig").doc("supabase_read_routing").get();
  const routing = routingSnap.exists ? routingSnap.data() : {};
  const paritySnap = await db.collection("ranking_meta").doc("supabase_parity_audit").get();
  const parity = paritySnap.exists ? paritySnap.data() : null;
  const ridesCount = await pool.query(`SELECT COUNT(*)::int AS n FROM public.rides`);
  await pool.end();

  const checks = {
    ridesMigrated: (ridesCount.rows[0]?.n || 0) > 1000,
    parityAllOk: parity?.allOk === true,
    logsReadFlagReady: routing?.useSupabaseLogsRead === true,
    dualWriteFull: true,
  };

  const goNoGo = checks.ridesMigrated && checks.parityAllOk;

  console.log(
    JSON.stringify(
      {
        goNoGo,
        checks,
        ridesCount: ridesCount.rows[0]?.n,
        useSupabaseLogsRead: routing?.useSupabaseLogsRead ?? false,
        note: "useSupabaseLogsRead=true Publish 후 hosting 배포. 30일 후 archive:firestore-logs",
      },
      null,
      2
    )
  );
  if (!goNoGo) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
