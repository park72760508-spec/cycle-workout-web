/**
 * Remote Config dual_write_status 설정 (Phase 3-4 FULL 전환).
 *
 * 사용:
 *   cd supabase/migration
 *   npx tsx scripts/setDualWriteRemoteConfig.ts --status=FULL
 *   npx tsx scripts/setDualWriteRemoteConfig.ts --dry-run --status=FULL
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getRemoteConfig } from "firebase-admin/remote-config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
loadDotenv({ path: join(root, ".env") });

const KEY_STATUS = "dual_write_status";
const KEY_INDOOR_STATUS = "indoor_write_status";
const ALLOWED = new Set(["OFF", "SHADOW", "CANARY", "FULL"]);

function parseArgs() {
  const dryRun = process.argv.includes("--dry-run");
  const statusArg = process.argv.find((a) => a.startsWith("--status="));
  const indoorArg = process.argv.find((a) => a.startsWith("--indoor-status="));
  const status = String(statusArg?.split("=")[1] || "FULL")
    .trim()
    .toUpperCase();
  const indoorStatus = indoorArg
    ? String(indoorArg.split("=")[1] || "OFF").trim().toUpperCase()
    : null;
  if (!ALLOWED.has(status)) {
    throw new Error(`--status must be one of ${[...ALLOWED].join(", ")}`);
  }
  if (indoorStatus && !ALLOWED.has(indoorStatus)) {
    throw new Error(`--indoor-status must be one of ${[...ALLOWED].join(", ")}`);
  }
  return { dryRun, status, indoorStatus };
}

function initFirebase() {
  if (getApps().length) return;
  const cred =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || join(root, "serviceAccountKey.json");
  if (!existsSync(cred)) throw new Error(`Firebase credentials 없음: ${cred}`);
  initializeApp({ credential: cert(cred) });
}

function readParamValue(
  template: Awaited<ReturnType<ReturnType<typeof getRemoteConfig>["getTemplate"]>>,
  key: string
): string | undefined {
  const param = template.parameters?.[key];
  if (!param) return undefined;
  const dv = param.defaultValue;
  if (dv?.value != null) return String(dv.value);
  const cv = param.conditionalValues;
  if (cv && typeof cv === "object") {
    for (const k of Object.keys(cv)) {
      const entry = cv[k];
      if (entry?.value != null) return String(entry.value);
    }
  }
  return undefined;
}

async function main() {
  const { dryRun, status, indoorStatus } = parseArgs();
  initFirebase();
  const rc = getRemoteConfig();
  const before = await rc.getTemplate();
  const prev = readParamValue(before, KEY_STATUS) ?? "(missing)";

  for (const key of [
    KEY_STATUS,
    KEY_INDOOR_STATUS,
    "dual_write_canary_percent",
    "indoor_write_canary_percent",
    "dual_write_shadow_uids",
  ]) {
    console.log(`[remote-config] ${key}=${readParamValue(before, key) ?? "(missing)"}`);
  }
  console.log(
    `[remote-config] template version=${before.version?.versionNumber ?? "?"} updateTime=${before.version?.updateTime ?? "?"}`
  );

  console.log(`[remote-config] before ${KEY_STATUS}=${prev}`);

  let changed = String(prev).toUpperCase() !== status;
  if (!before.parameters) before.parameters = {};

  const existing = before.parameters[KEY_STATUS];
  before.parameters[KEY_STATUS] = {
    ...existing,
    defaultValue: { value: status },
  };

  if (indoorStatus) {
    const prevIndoor = readParamValue(before, KEY_INDOOR_STATUS) ?? "(missing)";
    console.log(`[remote-config] before ${KEY_INDOOR_STATUS}=${prevIndoor}`);
    if (String(prevIndoor).toUpperCase() !== indoorStatus) changed = true;
    const existingIndoor = before.parameters[KEY_INDOOR_STATUS];
    before.parameters[KEY_INDOOR_STATUS] = {
      ...existingIndoor,
      defaultValue: { value: indoorStatus },
    };
  }

  if (!changed) {
    console.log(`[remote-config] already target status — publish skipped`);
    return;
  }

  if (dryRun) {
    console.log(`[remote-config] dry-run — would publish ${KEY_STATUS}=${status}`);
    return;
  }

  const published = await rc.publishTemplate(before, {
    force: true,
  });
  const after = await rc.getTemplate();
  const next = readParamValue(after, KEY_STATUS);

  console.log(`[remote-config] published version=${published.version?.versionNumber ?? "?"}`);
  console.log(`[remote-config] after ${KEY_STATUS}=${next}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
