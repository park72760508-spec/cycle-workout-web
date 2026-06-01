/**
 * 탈퇴 사용자 login_account_flags 백필 — 로그인 비밀번호 검증 전 탈퇴 감지용
 *
 * 사용 (functions 디렉터리):
 *   node scripts/backfill-login-account-flags.js
 *
 * 필요: supabase/migration/serviceAccountKey.json
 */
const path = require("path");
const admin = require("firebase-admin");

const saPath = path.join(__dirname, "../../supabase/migration/serviceAccountKey.json");
const sa = require(saPath);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const db = admin.firestore();

function phoneDigits(contact) {
  return String(contact || "").replace(/\D/g, "");
}

function isWithdrawn(data) {
  if (!data || typeof data !== "object") return false;
  const st = String(data.account_status || "").trim().toLowerCase();
  if (st === "withdrawn") return true;
  if (data.is_active === false && st !== "active") return true;
  return false;
}

async function main() {
  const snap = await db.collection("users").get();
  let written = 0;
  let skipped = 0;
  const batchSize = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (!isWithdrawn(data)) {
      skipped++;
      continue;
    }
    const digits = phoneDigits(data.contact);
    if (digits.length < 10) {
      console.warn("[skip] contact 없음:", doc.id);
      skipped++;
      continue;
    }
    const ref = db.collection("login_account_flags").doc(digits);
    batch.set(
      ref,
      {
        account_status: "withdrawn",
        uid: doc.id,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );
    written++;
    batchCount++;
    if (batchCount >= batchSize) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();

  console.log("완료 — login_account_flags 작성:", written, "건별, 스킵:", skipped);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
