/**
 * Phase 4 Go/No-Go — dual_write_status=FULL, parity audit, Remote Config 확인.
 *
 * 전제: Phase 3 FULL + parity 7일 연속 OK (이 스크립트는 최신 audit 1건 + RC만 검증).
 *
 *   cd supabase/migration
 *   npx tsx scripts/verifyPhase4GoNoGo.ts
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
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

function readRcParam(
  template: Awaited<ReturnType<ReturnType<typeof getRemoteConfig>["getTemplate"]>>,
  key: string
): string | undefined {
  const p = template.parameters?.[key];
  if (!p?.defaultValue?.value) return undefined;
  return String(p.defaultValue.value);
}

async function main() {
  initFirebase();
  const db = getFirestore();
  const rc = getRemoteConfig();
  const template = await rc.getTemplate();

  const dualStatus = (readRcParam(template, "dual_write_status") || "OFF").toUpperCase();
  const paritySnap = await db.collection("ranking_meta").doc("supabase_parity_audit").get();
  const parity = paritySnap.exists ? paritySnap.data() : null;
  const readSnap = await db.collection("appConfig").doc("supabase_read_routing").get();
  const readRouting = readSnap.exists ? readSnap.data() : null;

  const checks = {
    dualWriteFull: dualStatus === "FULL",
    parityAllOk: parity?.allOk === true,
    useSupabaseGlobal: readRouting?.useSupabaseGlobal === true,
    onUserLogWrittenDefaultOff: process.env.ON_USER_LOG_WRITTEN_ENABLED !== "true",
  };

  const goNoGo = Object.values(checks).every(Boolean);

  console.log(
    JSON.stringify(
      {
        goNoGo,
        checks,
        dual_write_status: dualStatus,
        parityDateKst: parity?.dateKst ?? null,
        parityCheckedAt: parity?.checkedAt ?? null,
        note:
          "7일 연속 parity는 ranking_meta/supabase_parity_audit 히스토리가 없어 수동 확인 필요. Phase 4 배포 후 onUserLogWritten 함수가 제거됩니다.",
      },
      null,
      2
    )
  );

  if (!goNoGo) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
