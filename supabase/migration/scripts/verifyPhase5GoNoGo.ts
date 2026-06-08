/**
 * Phase 5 Go/No-Go — Phase 4 완료 + indoor_write_status + point_history 스키마.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getRemoteConfig } from "firebase-admin/remote-config";

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
  const rc = getRemoteConfig();
  const template = await rc.getTemplate();
  const indoorStatus =
    template.parameters?.indoor_write_status?.defaultValue?.value ?? "OFF";
  const dualStatus =
    template.parameters?.dual_write_status?.defaultValue?.value ?? "OFF";

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='point_history'
       AND column_name IN ('firebase_log_id','extended_days','points_used_for_subscription')`
  );
  await pool.end();

  const checks = {
    dualWriteFull: String(dualStatus).toUpperCase() === "FULL",
    pointHistorySchemaOk: cols.rowCount === 3,
    indoorWriteConfigured: String(indoorStatus).toUpperCase() !== "",
  };
  const goNoGo = checks.dualWriteFull && checks.pointHistorySchemaOk;

  console.log(
    JSON.stringify(
      {
        goNoGo,
        checks,
        dual_write_status: dualStatus,
        indoor_write_status: indoorStatus,
        note: "Phase 5 활성화: indoor_write_status=FULL Publish 후 onIndoorLogCreatedReward 재배포",
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
