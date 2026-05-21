import type { Timestamp } from "firebase-admin/firestore";

/** Firestore Timestamp / Date / ISO string / unix → ISO timestamptz 문자열 */
export function toTimestamptz(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === "object" && value !== null) {
    const ts = value as Timestamp;
    if (typeof ts.toDate === "function") {
      const d = ts.toDate();
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return `${s}T00:00:00+09:00`;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

/** YYYY-MM-DD (Seoul) — 로그 date 필드용 */
export function toRideDate(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === "object" && value !== null) {
    const ts = value as Timestamp;
    if (typeof ts.toDate === "function") {
      return formatSeoulYmd(ts.toDate());
    }
    if (value instanceof Date) {
      return formatSeoulYmd(value);
    }
  }

  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    }
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return formatSeoulYmd(d);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return formatSeoulYmd(new Date(ms));
  }

  return null;
}

function formatSeoulYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function pad2(n: string): string {
  return String(Number(n)).padStart(2, "0");
}

/** date 컬럼 (YYYY-MM-DD) */
export function toDateOnly(value: unknown): string | null {
  const ymd = toRideDate(value);
  return ymd;
}

/** time 컬럼 HH:MM:SS */
export function toTimeOnly(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      return `${pad2(m[1])}:${m[2]}:${m[3] ?? "00"}`;
    }
  }
  return null;
}
