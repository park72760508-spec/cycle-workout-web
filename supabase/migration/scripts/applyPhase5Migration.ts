import { config as loadDotenv } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
loadDotenv({ path: join(root, ".env") });

async function main() {
  const sql = readFileSync(
    join(root, "../migrations/20260609120000_phase5_point_history_indoor.sql"),
    "utf8"
  );
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
  });
  try {
    await pool.query(sql);
    console.log("[phase5] migration applied OK");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
