/**
 * Firestore stelvio_riding_groups + rides(오픈) + Storage URL → Supabase
 * npm run migrate:riding-groups
 */
import { loadConfig } from "../src/config.js";
import { initFirestore } from "../src/firestore.js";
import { createPool, loadAuthUserIdSet, loadPublicUserIdSet } from "../src/pg.js";
import { resolveUserUuid, resolveOpenRideUuid } from "../src/uid.js";
import { v5 as uuidv5 } from "uuid";
import { applyRidingGroupsSchemaRepair } from "./ensureRidingGroupsSchema.js";
import type { Pool } from "pg";

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

function inferStoragePath(url: string | null, fallback: string): string {
  if (!url) return fallback;
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\/o\/(.+)$/);
    if (m) return decodeURIComponent(m[1].split("?")[0]);
  } catch (_) {}
  return fallback;
}

async function runQuery(
  pool: Pool,
  label: string,
  sql: string,
  params?: unknown[]
): Promise<void> {
  try {
    await pool.query(sql, params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[${label}] ${msg}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.argv);
  const db = initFirestore();
  const pool = createPool(config);
  const authIds = await loadAuthUserIdSet(pool, config);
  const publicUserIds = await loadPublicUserIdSet(pool);
  const ns = config.uidNamespace;

  function canMigrateUser(firebaseUid: string): boolean {
    const uuid = resolveUserUuid(firebaseUid, config);
    if (!uuid) return false;
    const key = uuid.toLowerCase();
    if (config.skipUsersWithoutAuth && !authIds.has(key)) return false;
    return publicUserIds.has(key);
  }

  console.log("[migrate:riding-groups] 스키마 복구·검증...");
  await applyRidingGroupsSchemaRepair(pool);

  console.log("[migrate:riding-groups] groups + open_rides media 시작");

  const groupsSnap = await db.collection("stelvio_riding_groups").get();
  let gCount = 0;
  for (const doc of groupsSnap.docs) {
    const d = doc.data();
    const createdBy = str(d.createdBy);
    if (!createdBy) continue;
    const createdUuid = resolveUserUuid(createdBy, config);
    if (!createdUuid || !canMigrateUser(createdBy)) continue;

    const groupUuid = resolveRidingGroupUuid(doc.id, ns);
    const photoUrl = str(d.photoUrl);
    const reviewedByRaw = d.reviewedBy ? String(d.reviewedBy) : null;
    const reviewedByUuid =
      reviewedByRaw && canMigrateUser(reviewedByRaw)
        ? resolveUserUuid(reviewedByRaw, config)
        : null;

    await runQuery(
      pool,
      `riding_groups insert ${doc.id}`,
      `INSERT INTO public.riding_groups (
        id, firestore_doc_id, name, regions, intro, is_public, join_password,
        photo_url, photo_storage_path, status, created_by, member_count,
        ranking_notice, reviewed_at, reviewed_by, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (id) DO UPDATE SET
        firestore_doc_id=EXCLUDED.firestore_doc_id,
        name=EXCLUDED.name, photo_url=EXCLUDED.photo_url,
        photo_storage_path=EXCLUDED.photo_storage_path,
        status=EXCLUDED.status, member_count=EXCLUDED.member_count,
        ranking_notice=EXCLUDED.ranking_notice, updated_at=EXCLUDED.updated_at`,
      [
        groupUuid,
        doc.id,
        str(d.name) || "",
        Array.isArray(d.regions) ? d.regions.map(String) : [],
        str(d.intro) || "",
        Boolean(d.isPublic),
        str(d.joinPassword) || "",
        photoUrl,
        photoUrl
          ? inferStoragePath(photoUrl, `stelvio_riding_groups/${doc.id}/cover`)
          : null,
        String(d.status || "PENDING").toUpperCase(),
        createdUuid,
        Number(d.memberCount) || 0,
        JSON.stringify(d.rankingNotice || {}),
        d.reviewedAt ? toIso(d.reviewedAt) : null,
        reviewedByUuid,
        toIso(d.createdAt),
        toIso(d.updatedAt),
      ]
    );

    if (photoUrl) {
      await runQuery(
        pool,
        `media_assets group_cover ${doc.id}`,
        `INSERT INTO public.media_assets (
          entity_type, entity_id, owner_user_id, storage_path, public_url, content_type
        ) VALUES ('group_cover',$1,$2,$3,$4,'image/jpeg')
        ON CONFLICT (entity_type, entity_id, storage_path) DO UPDATE SET
          public_url=EXCLUDED.public_url, updated_at=now()`,
        [
          doc.id,
          createdUuid,
          inferStoragePath(photoUrl, `stelvio_riding_groups/${doc.id}/cover`),
          photoUrl,
        ]
      );
    }

    const memSnap = await doc.ref.collection("members").get();
    for (const m of memSnap.docs) {
      const md = m.data();
      const uid = resolveUserUuid(m.id, config);
      if (!uid || !canMigrateUser(m.id)) continue;
      await runQuery(
        pool,
        `riding_group_members ${doc.id}/${m.id}`,
        `INSERT INTO public.riding_group_members (
          group_id, user_id, role, display_name, profile_image_url, joined_at
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (group_id, user_id) DO UPDATE SET
          display_name=EXCLUDED.display_name,
          profile_image_url=EXCLUDED.profile_image_url`,
        [
          groupUuid,
          uid,
          str(md.role) === "owner" ? "owner" : "member",
          str(md.displayName) || "",
          str(md.profileImageUrl),
          toIso(md.joinedAt),
        ]
      );
      const avatar = str(md.profileImageUrl);
      if (avatar) {
        await runQuery(
          pool,
          `media_assets user_avatar ${m.id}`,
          `INSERT INTO public.media_assets (
            entity_type, entity_id, owner_user_id, storage_path, public_url, content_type
          ) VALUES ('user_avatar',$1,$2,$3,$4,'image/jpeg')
          ON CONFLICT (entity_type, entity_id, storage_path) DO NOTHING`,
          [m.id, uid, inferStoragePath(avatar, `users/${m.id}/avatar`), avatar]
        );
      }
    }

    const reqSnap = await doc.ref.collection("joinRequests").get();
    for (const r of reqSnap.docs) {
      const rd = r.data();
      const uid = resolveUserUuid(r.id, config);
      if (!uid || !canMigrateUser(r.id)) continue;
      await runQuery(
        pool,
        `riding_group_join_requests ${doc.id}/${r.id}`,
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
    gCount++;
  }

  const ridesSnap = await db.collection("rides").get();
  let rCount = 0;
  for (const doc of ridesSnap.docs) {
    const d = doc.data();
    const host = str(d.hostUserId);
    if (!host) continue;
    const hostUuid = resolveUserUuid(host, config);
    if (!hostUuid || !canMigrateUser(host)) continue;
    const rideUuid = resolveOpenRideUuid(doc.id, config);
    const gpxUrl = str(d.gpxUrl);
    await runQuery(
      pool,
      `open_rides gpx ${doc.id}`,
      `UPDATE public.open_rides SET
        gpx_url = COALESCE($2, gpx_url),
        gpx_storage_path = COALESCE($3, gpx_storage_path),
        firestore_doc_id = COALESCE(firestore_doc_id, $4)
       WHERE id = $1 OR firestore_doc_id = $4`,
      [
        rideUuid,
        gpxUrl,
        gpxUrl ? inferStoragePath(gpxUrl, `rides/${doc.id}/course.gpx`) : null,
        doc.id,
      ]
    );
    if (gpxUrl) {
      await runQuery(
        pool,
        `media_assets open_ride_gpx ${doc.id}`,
        `INSERT INTO public.media_assets (
          entity_type, entity_id, owner_user_id, storage_path, public_url, content_type
        ) VALUES ('open_ride_gpx',$1,$2,$3,$4,'application/gpx+xml')
        ON CONFLICT (entity_type, entity_id, storage_path) DO UPDATE SET
          public_url=EXCLUDED.public_url`,
        [
          doc.id,
          hostUuid,
          inferStoragePath(gpxUrl, `rides/${doc.id}/course.gpx`),
          gpxUrl,
        ]
      );
    }
    rCount++;
  }

  console.log(`[migrate:riding-groups] 완료 — groups=${gCount}, open_ride_media=${rCount}`);
  await pool.end();
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
