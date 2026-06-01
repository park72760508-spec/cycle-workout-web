/**
 * login_account_flags 백필 — 로그인 사전·오류 분기용
 * - active: 등록 회원 (비밀번호 오류 vs 미등록 구분)
 * - withdrawn: 탈퇴 회원 (비밀번호 검증 전 차단)
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
  let activeWritten = 0;
  let withdrawnWritten = 0;
  let skipped = 0;
  const batchSize = 400;
  let batch = db.batch();
  let batchCount = 0;

  async function flush() {
    if (batchCount > 0) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const digits = phoneDigits(data.contact);
    if (digits.length < 10) {
      skipped++;
      continue;
    }
    const withdrawn = isWithdrawn(data);
    const ref = db.collection("login_account_flags").doc(digits);
    batch.set(
      ref,
      {
        account_status: withdrawn ? "withdrawn" : "active",
        uid: doc.id,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );
    if (withdrawn) withdrawnWritten++;
    else activeWritten++;
    batchCount++;
    if (batchCount >= batchSize) await flush();
  }
  await flush();

  console.log(
    "완료 — active:",
    activeWritten,
    "withdrawn:",
    withdrawnWritten,
    "스킵(연락처 없음):",
    skipped
  );
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
