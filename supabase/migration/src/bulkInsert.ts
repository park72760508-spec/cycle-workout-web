import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PoolClient } from "pg";
import { from as copyFrom } from "pg-copy-streams";

function escapeCsvCell(value: unknown): string {
  if (value == null) return "\\N";
  if (typeof value === "boolean") return value ? "t" : "f";
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  if (/[",\n\r\\]/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsvLine(row: unknown[]): string {
  return row.map(escapeCsvCell).join(",") + "\n";
}

/** PostgreSQL COPY FROM STDIN (고속 bulk) */
export async function copyBulk(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[]
): Promise<number> {
  if (rows.length === 0) return 0;

  const colList = columns.map((c) => `"${c}"`).join(", ");
  const sql = `COPY ${table} (${colList}) FROM STDIN WITH (FORMAT csv, NULL '\\N')`;
  const stream = client.query(copyFrom(sql));

  const lines = rows.map((r) =>
    rowToCsvLine(columns.map((col) => r[col] ?? null))
  );
  const readable = Readable.from(lines);
  await pipeline(readable, stream);
  return rows.length;
}

/** COPY 실패 시 폴백 — 다중 VALUES INSERT */
export async function insertBatch(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  conflictSql = ""
): Promise<number> {
  if (rows.length === 0) return 0;

  const values: unknown[] = [];
  const tupleParts: string[] = [];
  let param = 1;

  for (const row of rows) {
    const ph: string[] = [];
    for (const col of columns) {
      values.push(row[col] ?? null);
      ph.push(`$${param++}`);
    }
    tupleParts.push(`(${ph.join(",")})`);
  }

  const colList = columns.map((c) => `"${c}"`).join(", ");
  const sql = `INSERT INTO ${table} (${colList}) VALUES ${tupleParts.join(",")} ${conflictSql}`;
  await client.query(sql, values);
  return rows.length;
}

export async function upsertBatch(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  conflictTarget: string,
  updateCols: string[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const setClause = updateCols
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(", ");
  const conflict = `ON CONFLICT (${conflictTarget}) DO UPDATE SET ${setClause}`;
  return insertBatch(client, table, columns, rows, conflict);
}

/** COPY 시도 → 실패 시 INSERT 폴백 */
export async function bulkWrite(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  options?: { conflictSql?: string; useCopy?: boolean }
): Promise<number> {
  if (rows.length === 0) return 0;
  const useCopy = options?.useCopy !== false && !options?.conflictSql;

  if (useCopy) {
    try {
      return await copyBulk(client, table, columns, rows);
    } catch (err) {
      console.warn(`[bulk] COPY failed for ${table}, falling back to INSERT:`, err);
    }
  }

  return insertBatch(client, table, columns, rows, options?.conflictSql ?? "");
}
