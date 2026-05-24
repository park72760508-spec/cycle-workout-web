/**
 * Firestore members/joinRequests → Supabase (전체 그룹, public.users 있는 UID만)
 * npm run sync:group-members
 */
import { loadConfig } from "../src/config.js";
import { initFirestore } from "../src/firestore.js";
import { createPool, loadPublicUserIdSet } from "../src/pg.js";
import { resolveUserUuid } from "../src/uid.js";
import { v5 as uuidv5 } from "uuid";

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function toIso(raw: unknown): string {
  if (!raw) return new Date().toISOString();
  if (typeof raw === "string") return raw;
  const r = raw as { toDate?: () => Date; seconds?: number };
  if (typeof r.toDate === "function") return r.toDate().toISOString();
  if (typeof r.seconds === "number") return new Date(r.seconds * 1000).toISOString();
  return new Date().toISOString();
}

function resolveRidingGroupUuid(firestoreDocId: string, ns: string): string {
  return uuidv5("riding_group:" + firestoreDocId, ns);
}

async function main(): Promise<void> {
  const config = loadConfig(process.argv);
  const db = initFirestore();
  const pool = createPool(config);
  const publicUserIds = await loadPublicUserIdSet(pool);
  const ns = config.uidNamespace;

  console.log("[sync:group-members] Firestore → Supabase members/joinRequests");

  const groupsSnap = await db.collection("stelvio_riding_groups").get();
  let memOk = 0;
  let memSkip = 0;

  for (const groupDoc of groupsSnap.docs) {
    const groupUuid = resolveRidingGroupUuid(groupDoc.id, ns);
    const memSnap = await groupDoc.ref.collection("members").get();

    for (const m of memSnap.docs) {
      const md = m.data();
      const uid = resolveUserUuid(m.id, config);
      if (!uid || !publicUserIds.has(uid.toLowerCase())) {
        memSkip++;
        continue;
      }
      await pool.query(
        `INSERT INTO public.riding_group_members (
          group_id, user_id, role, display_name, profile_image_url, joined_at
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (group_id, user_id) DO UPDATE SET
          display_name=EXCLUDED.display_name,
          profile_image_url=EXCLUDED.profile_image_url,
          role=EXCLUDED.role`,
        [
          groupUuid,
          uid,
          str(md.role) === "owner" ? "owner" : "member",
          str(md.displayName) || "",
          str(md.profileImageUrl),
          toIso(md.joinedAt),
        ]
      );
      memOk++;
    }

    const reqSnap = await groupDoc.ref.collection("joinRequests").get();
    for (const r of reqSnap.docs) {
      const rd = r.data();
      const uid = resolveUserUuid(r.id, config);
      if (!uid || !publicUserIds.has(uid.toLowerCase())) continue;
      await pool.query(
        `INSERT INTO public.riding_group_join_requests (
          group_id, user_id, display_name, profile_image_url, requested_at
        ) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (group_id, user_id) DO NOTHING`,
        [
          groupUuid,
          uid,
          str(rd.displayName) || "",
          str(rd.profileImageUrl),
          toIso(rd.requestedAt),
        ]
      );
    }
  }

  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM riding_group_members`);
  console.log(
    `[sync:group-members] 완료 — upserted_members=${memOk}, skipped_no_user=${memSkip}, total_in_db=${(count.rows[0] as { n: number }).n}`
  );
  await pool.end();
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
