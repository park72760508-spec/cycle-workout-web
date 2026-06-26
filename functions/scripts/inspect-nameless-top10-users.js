/**
 * 주간 TOP10 (이름 없음) 사용자 Firestore 프로필 조회
 * node scripts/inspect-nameless-top10-users.js [uid...]
 */
const path = require("path");
const admin = require("firebase-admin");

const defaultIds = [
  "SwELrHuJPtRYCewxracovPKuFkc2",
  "3EaW0mN9B1ZXlxyvy1JJX6QcIQX2",
];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : defaultIds;

const saPath = path.join(__dirname, "../../supabase/migration/serviceAccountKey.json");
const sa = require(saPath);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

async function main() {
  for (const id of ids) {
    const snap = await db.collection("users").doc(id).get();
    console.log("\n---", id, "---");
    if (!snap.exists) {
      console.log("users 문서 없음 (비실사용자/삭제 가능)");
      continue;
    }
    const d = snap.data() || {};
    const name = String(d.name || d.display_name || "").trim();
    console.log({
      name: d.name || null,
      display_name: d.display_name || null,
      contact: d.contact || null,
      grade: d.grade,
      account_status: d.account_status,
      is_active: d.is_active,
      is_private: d.is_private,
      category: d.category || d.sport_category,
      created_at: d.created_at || d.createdAt || null,
      expiry_date: d.expiry_date || null,
      hasValidName: name.length >= 2,
      likelyRealUser:
        d.is_active !== false &&
        String(d.account_status || "active").toLowerCase() !== "withdrawn" &&
        !!(d.contact || d.ftp || d.weight),
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
