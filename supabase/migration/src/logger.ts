import { appendFileSync } from "node:fs";

export class MigrationLogger {
  private counts = new Map<string, { ok: number; err: number }>();

  constructor(private readonly logPath: string) {}

  ok(phase: string, n = 1): void {
    this.bump(phase, "ok", n);
  }

  error(phase: string, context: string, err: unknown): void {
    this.bump(phase, "err", 1);
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    const line = `[${new Date().toISOString()}] [${phase}] ${context} | ${msg}${stack ? `\n${stack}` : ""}\n`;
    try {
      appendFileSync(this.logPath, line, "utf8");
    } catch (e) {
      console.error("migration_errors.log 기록 실패:", e);
    }
    console.error(`[${phase}] ${context}:`, msg);
  }

  summary(): void {
    console.log("\n=== Migration summary ===");
    for (const [phase, { ok, err }] of this.counts) {
      console.log(`  ${phase}: ok=${ok}, errors=${err}`);
    }
    const totalErr = [...this.counts.values()].reduce((s, c) => s + c.err, 0);
    if (totalErr > 0) {
      console.log(`\nErrors logged to: ${this.logPath}`);
    }
  }

  private bump(phase: string, key: "ok" | "err", n: number): void {
    const cur = this.counts.get(phase) ?? { ok: 0, err: 0 };
    cur[key] += n;
    this.counts.set(phase, cur);
  }
}
