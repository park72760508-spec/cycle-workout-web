/**
 * Phase 8/9 — appConfig/supabase_groups_read_routing 설정 (오픈라이딩·소모임 Read 라우팅).
 * 스키마는 functions/groupReadConfig.js 와 동일: useSupabaseGlobal / whitelistUids / parityFallbackToFirebase.
 * logs 라우팅(setLogsReadRouting.ts)과 달리 canary용 whitelistUids를 지원한다 — 카나리 UID로
 * 며칠 검증 후 --enable 로 전체 전환하는 순서를 권장.
 *
 *   cd supabase/migration
 *   npx tsx scripts/setGroupsReadRouting.ts --status
 *   npx tsx scripts/setGroupsReadRouting.ts --whitelist-add uid1,uid2 --dry-run
 *   npx tsx scripts/setGroupsReadRouting.ts --whitelist-add uid1,uid2
 *   npx tsx scripts/setGroupsReadRouting.ts --enable
 *   npx tsx scripts/setGroupsReadRouting.ts --disable
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
  const status = process.argv.includes("--status");
  const enable = process.argv.includes("--enable");
  const disable = process.argv.includes("--disable");
  const whitelistClear = process.argv.includes("--whitelist-clear");
  const addIdx = process.argv.indexOf("--whitelist-add");
  const whitelistAdd = addIdx !== -1 ? String(process.argv[addIdx + 1] || "") : "";

  if (!status && !enable && !disable && !whitelistClear && !whitelistAdd) {
    throw new Error(
      "--status | --enable | --disable | --whitelist-add <uid1,uid2> | --whitelist-clear 중 하나를 지정하세요."
    );
  }
  if (enable && disable) {
    throw new Error("--enable 과 --disable 은 동시에 지정할 수 없습니다.");
  }
  return { dryRun, status, enable, disable, whitelistClear, whitelistAdd };
}

function initFirebase() {
  if (getApps().length) return;
  const cred =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || join(root, "serviceAccountKey.json");
  if (!existsSync(cred)) throw new Error(`Firebase credentials 없음: ${cred}`);
  initializeApp({ credential: cert(cred) });
}

async function main() {
  const { dryRun, status, enable, disable, whitelistClear, whitelistAdd } = parseArgs();
  initFirebase();
  const db = getFirestore();
  const ref = db.collection("appConfig").doc("supabase_groups_read_routing");
  const before = await ref.get();
  const prev: any = before.exists ? before.data() : {};

  if (status) {
    console.log(
      JSON.stringify(
        {
          exists: before.exists,
          useSupabaseGlobal: prev?.useSupabaseGlobal ?? false,
          whitelistUids: prev?.whitelistUids ?? [],
          parityFallbackToFirebase: prev?.parityFallbackToFirebase ?? true,
        },
        null,
        2
      )
    );
    return;
  }

  let whitelistUids: string[] = Array.isArray(prev?.whitelistUids) ? prev.whitelistUids.slice() : [];
  if (whitelistClear) {
    whitelistUids = [];
  } else if (whitelistAdd) {
    const addList = whitelistAdd
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    whitelistUids = Array.from(new Set([...whitelistUids, ...addList]));
  }

  const payload = {
    useSupabaseGlobal: enable ? true : disable ? false : prev?.useSupabaseGlobal ?? false,
    whitelistUids,
    parityFallbackToFirebase: prev?.parityFallbackToFirebase ?? true,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: "setGroupsReadRouting.ts",
  };

  console.log(
    JSON.stringify(
      {
        dryRun,
        before: {
          useSupabaseGlobal: prev?.useSupabaseGlobal ?? false,
          whitelistUids: prev?.whitelistUids ?? [],
        },
        after: payload,
      },
      null,
      2
    )
  );

  if (!dryRun) {
    await ref.set(payload, { merge: true });
    console.log("appConfig/supabase_groups_read_routing 업데이트 완료");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
