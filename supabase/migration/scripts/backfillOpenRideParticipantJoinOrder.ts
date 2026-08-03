/**
 * Firestore rides.participants 배열 인덱스 → Supabase open_ride_participants.join_order 백필.
 * 2026-08 회귀: open_ride_participants에 순서 컬럼이 없어 정원 목록 조회 시 Postgres가 행
 * 순서를 보장하지 않았고, dual-write가 반복 upsert되며 "1번=방장, 이후 참가 순" 표시 순서가
 * 화면에서 뒤섞여 보였다. join_order 컬럼 추가(20260803130000 마이그레이션)와 dual-write
 * 코드 수정(supabaseGroupDualWriteServer.js) 이후로는 새 참가/취소/수정 시 자동으로 채워지지만,
 * 그 시점 이후 한 번도 다시 쓰이지 않은 기존 라이딩은 join_order가 계속 NULL로 남아 순서
 * 문제가 재현된다. 이 스크립트는 그런 과거분을 Firestore 원본 순서로 1회성 보정한다.
 *
 *   cd supabase/migration
 *   npx tsx scripts/backfillOpenRideParticipantJoinOrder.ts --dry-run
 *   npx tsx scripts/backfillOpenRideParticipantJoinOrder.ts
 */
import { loadConfig } from "../src/config.js";
import { initFirestore } from "../src/firestore.js";
import { createPool } from "../src/pg.js";
import { resolveOpenRideUuid, resolveUserUuid } from "../src/uid.js";

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const config = loadConfig(process.argv);
  const dryRun = process.argv.includes("--dry-run");
  const db = initFirestore();
  const pool = createPool(config);

  console.log(
    "[backfill:open-ride-participant-join-order] Firestore participants 순서 → Supabase join_order",
    { dryRun }
  );

  const ridesSnap = await db.collection("rides").get();
  let scanned = 0;
  let ridesUpdated = 0;
  let rowsUpdated = 0;
  let skippedNoParticipants = 0;

  for (const rideDoc of ridesSnap.docs) {
    scanned++;
    const data = rideDoc.data() || {};
    const confirmed = asStringArray(data.participants);
    if (confirmed.length === 0) {
      skippedNoParticipants++;
      continue;
    }

    const rideId = resolveOpenRideUuid(rideDoc.id, config);
    let rideTouched = false;

    for (let idx = 0; idx < confirmed.length; idx++) {
      const userId = resolveUserUuid(confirmed[idx], config);
      if (!userId) continue;

      if (!dryRun) {
        const res = await pool.query(
          `UPDATE public.open_ride_participants
             SET join_order = $1
           WHERE ride_id = $2 AND user_id = $3
             AND is_waitlist = false
             AND (join_order IS DISTINCT FROM $1)`,
          [idx, rideId, userId]
        );
        if ((res.rowCount ?? 0) > 0) {
          rowsUpdated++;
          rideTouched = true;
        }
      } else {
        rowsUpdated++;
        rideTouched = true;
      }
    }

    if (rideTouched) {
      ridesUpdated++;
      if (ridesUpdated % 200 === 0) {
        console.log(`progress: ${ridesUpdated} rides updated / ${scanned} scanned`);
      }
    }
  }

  console.log("[backfill:open-ride-participant-join-order] 완료", {
    scanned,
    ridesUpdated,
    rowsUpdated,
    skippedNoParticipants,
    dryRun,
  });
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
