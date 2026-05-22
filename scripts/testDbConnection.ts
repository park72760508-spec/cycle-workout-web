/**
 * DB 연결만 검증 (Firestore 없음)
 * npm run test:db
 */
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/pg.js";

async function main(): Promise<void> {
  const config = loadConfig(process.argv);
  const u = new URL(config.databaseUrl);
  console.log("host:", u.hostname, "| port:", u.port, "| user:", u.username);
  const pool = createPool(config);
  try {
    const r = await pool.query(
      "SELECT current_user, current_database(), now() AS ts"
    );
    console.log("OK:", r.rows[0]);
    const auth = await pool.query("SELECT count(*)::int AS n FROM auth.users");
    console.log("auth.users:", auth.rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  console.error(
    "\n체크: 1) Supabase Database password Reset 후 .env 반영  2) Direct 5432 URI  3) 비밀번호 특수문자 URL 인코딩 (! → %21)"
  );
  process.exit(1);
});
