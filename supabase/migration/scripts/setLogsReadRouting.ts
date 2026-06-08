/**
 * Phase 6 — appConfig/supabase_read_routing.useSupabaseLogsRead 설정.
 *
 *   cd supabase/migration
 *   npx tsx scripts/setLogsReadRouting.ts --enable
 *   npx tsx scripts/setLogsReadRouting.ts --disable --dry-run
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
loadDotenv({ path: join(root, ".env") });

function parseArgs() {
  const dryRun = process.argv.includes("--dry-run");
  const enable = process.argv.includes("--enable");
  const disable = process.argv.includes("--disable");
  if (enable === disable) {
    throw new Error("--enable 또는 --disable 중 하나를 지정하세요.");
  }
  return { dryRun, useSupabaseLogsRead: enable };
}

function initFirebase() {
  if (getApps().length) return;
  const cred =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || join(root, "serviceAccountKey.json");
  if (!existsSync(cred)) throw new Error(`Firebase credentials 없음: ${cred}`);
  initializeApp({ credential: cert(cred) });
}

async function main() {
  const { dryRun, useSupabaseLogsRead } = parseArgs();
  initFirebase();
  const db = getFirestore();
  const ref = db.collection("appConfig").doc("supabase_read_routing");
  const before = await ref.get();
  const prev = before.exists ? before.data() : {};

  const payload = {
    useSupabaseLogsRead,
    useSupabaseGlobal: prev?.useSupabaseGlobal ?? true,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: "setLogsReadRouting.ts",
  };

  console.log(
    JSON.stringify(
      {
        dryRun,
        before: {
          useSupabaseLogsRead: prev?.useSupabaseLogsRead ?? false,
          useSupabaseGlobal: prev?.useSupabaseGlobal ?? null,
        },
        after: payload,
      },
      null,
      2
    )
  );

  if (!dryRun) {
    await ref.set(payload, { merge: true });
    console.log("appConfig/supabase_read_routing 업데이트 완료");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
