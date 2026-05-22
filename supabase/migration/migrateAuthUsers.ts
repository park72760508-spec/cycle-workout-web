/**
 * Firebase Auth → Supabase Auth 이관
 * - UID: FIREBASE_UID_UUID_MODE=v5 (migrateData.ts 와 동일)
 * - 비밀번호: Firebase에서보낼 수 없음 → 임의 비밀번호 + 앱에서 비밀번호 재설정/매직링크
 *
 * 실행:
 *   npm run migrate:auth:dry
 *   npm run migrate:auth
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  authConfigAsMigrationConfig,
  loadAuthMigrateConfig,
} from "./src/authConfig.js";
import { initFirestore } from "./src/firestore.js";
import { resolveUserUuid } from "./src/uid.js";

type Stats = { created: number; skipped: number; failed: number };

function logError(logPath: string, ctx: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const line = `[${new Date().toISOString()}] ${ctx} | ${msg}\n`;
  try {
    appendFileSync(logPath, line, "utf8");
  } catch {
    /* ignore */
  }
  console.error(ctx, msg);
}

function syntheticEmail(firebaseUid: string): string {
  return `${firebaseUid}@firebase-migrate.stelvio.local`;
}

function normalizePhone(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).replace(/[^\d+]/g, "");
  if (!s) return undefined;
  if (s.startsWith("+")) return s;
  if (s.startsWith("0")) return `+82${s.slice(1)}`;
  return `+${s}`;
}

function pickEmail(
  authUser: UserRecord,
  firestore?: Record<string, unknown>
): string | undefined {
  const fromAuth = authUser.email?.trim();
  if (fromAuth) return fromAuth;
  const fs =
    (firestore?.email as string) ||
    (firestore?.contact as string) ||
    undefined;
  if (fs && fs.includes("@")) return fs.trim();
  return undefined;
}

function pickPhone(
  authUser: UserRecord,
  firestore?: Record<string, unknown>
): string | undefined {
  const fromAuth = authUser.phoneNumber?.trim();
  if (fromAuth) return normalizePhone(fromAuth);
  const fs =
    firestore?.phone ||
    firestore?.phoneNumber ||
    firestore?.contact ||
    firestore?.tel;
  return normalizePhone(fs);
}

async function loadFirestoreUserMap(
  firebaseUids: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const db = initFirestore();
  const map = new Map<string, Record<string, unknown>>();
  const chunk = 100;
  for (let i = 0; i < firebaseUids.length; i += chunk) {
    const slice = firebaseUids.slice(i, i + chunk);
    const refs = slice.map((uid) => db.collection("users").doc(uid));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap) => {
      if (snap.exists) map.set(snap.id, snap.data() || {});
    });
  }
  return map;
}

async function countSupabaseAuthUsers(
  supabase: SupabaseClient
): Promise<number> {
  let total = 0;
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    total += data.users.length;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return total;
}

async function listAllFirebaseUsers(): Promise<UserRecord[]> {
  const auth = getAuth();
  const out: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const res = await auth.listUsers(1000, pageToken);
    out.push(...res.users);
    pageToken = res.pageToken;
    console.log(`  Firebase Auth listed: ${out.length}`);
  } while (pageToken);
  return out;
}

async function userExists(
  supabase: SupabaseClient,
  id: string
): Promise<boolean> {
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error && error.message?.includes("not found")) return false;
  return Boolean(data?.user);
}

async function createSupabaseAuthUser(
  supabase: SupabaseClient,
  authUser: UserRecord,
  supabaseId: string,
  firestore: Record<string, unknown> | undefined,
  dryRun: boolean
): Promise<"created" | "skipped"> {
  if (await userExists(supabase, supabaseId)) {
    return "skipped";
  }

  const email = pickEmail(authUser, firestore) ?? syntheticEmail(authUser.uid);
  const phone = pickPhone(authUser, firestore);
  const displayName =
    (firestore?.name as string) ||
    (firestore?.displayName as string) ||
    authUser.displayName ||
    "";

  if (dryRun) {
    return "created";
  }

  const randomPassword = randomBytes(24).toString("base64url");

  const { error } = await supabase.auth.admin.createUser({
    id: supabaseId,
    email,
    password: randomPassword,
    email_confirm: true,
    phone,
    phone_confirm: phone ? true : undefined,
    user_metadata: {
      firebase_uid: authUser.uid,
      display_name: displayName,
      migrated_from: "firebase_auth",
      migrated_at: new Date().toISOString(),
    },
    app_metadata: {
      provider: "firebase_migration",
      providers: ["firebase_migration"],
    },
  });

  if (error) {
    if (
      error.message.includes("already been registered") ||
      error.message.includes("already exists")
    ) {
      return "skipped";
    }
    throw error;
  }

  return "created";
}

async function processBatch(
  supabase: SupabaseClient,
  users: UserRecord[],
  firestoreMap: Map<string, Record<string, unknown>>,
  migConfig: ReturnType<typeof authConfigAsMigrationConfig>,
  logPath: string,
  dryRun: boolean,
  stats: Stats
): Promise<void> {
  for (const authUser of users) {
    const firebaseUid = authUser.uid;
    const supabaseId = resolveUserUuid(firebaseUid, migConfig);
    if (!supabaseId) {
      stats.failed += 1;
      logError(logPath, `invalid uid ${firebaseUid}`, new Error("empty uid"));
      continue;
    }

    try {
      const result = await createSupabaseAuthUser(
        supabase,
        authUser,
        supabaseId,
        firestoreMap.get(firebaseUid),
        dryRun
      );
      if (result === "created") stats.created += 1;
      else stats.skipped += 1;
    } catch (e) {
      stats.failed += 1;
      logError(
        logPath,
        `createUser firebase=${firebaseUid} supabase=${supabaseId}`,
        e
      );
    }
  }
}

async function main(): Promise<void> {
  const config = loadAuthMigrateConfig(process.argv);
  const migConfig = authConfigAsMigrationConfig(config);

  if (config.dryRun) {
    console.log("*** AUTH DRY RUN — Supabase Auth 생성 없음 ***\n");
  }

  initFirestore();

  const supabase = createClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const beforeCount = await countSupabaseAuthUsers(supabase);
  console.log(`[supabase] auth.users (before): ${beforeCount}`);

  console.log("[firebase] listing all Auth users...");
  const firebaseUsers = await listAllFirebaseUsers();
  console.log(`[firebase] total: ${firebaseUsers.length}`);

  let firestoreMap = new Map<string, Record<string, unknown>>();
  if (config.enrichFromFirestore && firebaseUsers.length > 0) {
    console.log("[firestore] enriching email/phone from users/{uid}...");
    firestoreMap = await loadFirestoreUserMap(
      firebaseUsers.map((u) => u.uid)
    );
  }

  const stats: Stats = { created: 0, skipped: 0, failed: 0 };
  const batchSize = config.batchSize;

  for (let i = 0; i < firebaseUsers.length; i += batchSize) {
    const batch = firebaseUsers.slice(i, i + batchSize);
    await processBatch(
      supabase,
      batch,
      firestoreMap,
      migConfig,
      config.logPath,
      config.dryRun,
      stats
    );
    console.log(
      `  progress ${Math.min(i + batchSize, firebaseUsers.length)} / ${firebaseUsers.length} (created=${stats.created}, skipped=${stats.skipped}, failed=${stats.failed})`
    );
  }

  if (!config.dryRun) {
    const afterCount = await countSupabaseAuthUsers(supabase);
    console.log(`[supabase] auth.users (after): ${afterCount}`);
  }

  console.log("\n=== Auth migration summary ===");
  console.log(`  would create / created: ${stats.created}`);
  console.log(`  skipped (already exists): ${stats.skipped}`);
  console.log(`  failed: ${stats.failed}`);
  if (stats.failed > 0) {
    console.log(`  errors: ${config.logPath}`);
  }

  console.log(
    "\n다음: npm run test:db → auth.users count 확인 → npm run migrate:dry → npm run migrate"
  );
  console.log(
    "※ Firebase 비밀번호는 이관되지 않습니다. 로그인은 비밀번호 재설정·매직링크·소셜 재연동이 필요합니다."
  );
}

main().catch((e) => {
  console.error("Auth migration fatal:", e);
  process.exit(1);
});
