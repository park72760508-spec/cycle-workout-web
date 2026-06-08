/**
 * Phase 6-3 — Firestore users/{uid}/logs 30일 이전 문서 아카이브(삭제) 드라이런/실행.
 *
 * 전제: useSupabaseLogsRead=true, Supabase rides parity OK, 백업 완료.
 *
 *   cd supabase/migration
 *   npx tsx scripts/archiveFirestoreLogs30d.ts --dry-run
 *   npx tsx scripts/archiveFirestoreLogs30d.ts --execute --max-users=50
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
loadDotenv({ path: join(root, ".env") });

const DRY = process.argv.includes("--dry-run");
const EXECUTE = process.argv.includes("--execute");
const MAX_USERS = Math.min(
  500,
  Math.max(1, parseInt(process.argv.find((a) => a.startsWith("--max-users="))?.split("=")[1] || "50", 10) || 50)
);
const RETENTION_DAYS = Math.max(
  7,
  parseInt(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] || "30", 10) || 30
);

function initFirebase() {
  if (getApps().length) return;
  const cred =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || join(root, "serviceAccountKey.json");
  if (!existsSync(cred)) throw new Error(`Firebase credentials 없음: ${cred}`);
  initializeApp({ credential: cert(cred) });
}

function cutoffYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() - RETENTION_DAYS);
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (!DRY && !EXECUTE) {
    console.error("Specify --dry-run or --execute");
    process.exit(1);
  }
  initFirebase();
  const db = getFirestore();
  const cutoff = cutoffYmd();
  let usersScanned = 0;
  let logsScanned = 0;
  let logsArchived = 0;

  const usersSnap = await db.collection("users").limit(MAX_USERS).get();
  for (const userDoc of usersSnap.docs) {
    usersScanned++;
    const logsSnap = await userDoc.ref.collection("logs").where("date", "<", cutoff).limit(500).get();
    for (const logDoc of logsSnap.docs) {
      logsScanned++;
      if (EXECUTE) {
        await logDoc.ref.delete();
        logsArchived++;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: EXECUTE ? "execute" : "dry-run",
        retentionDays: RETENTION_DAYS,
        cutoffBefore: cutoff,
        usersScanned,
        logsScanned,
        logsArchived,
        note: "30일 cutover 후 주 1회 실행 권장. Supabase rides 백업 선행 필수.",
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
