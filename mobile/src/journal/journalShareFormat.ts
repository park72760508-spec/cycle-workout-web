import type { ShareLog } from "./journalShareTypes";

const KOR_WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

export type StatCell = { label: string; value: string; valueLatin: boolean };

function logSortKey(log: ShareLog): number {
  const t = log.start_time || log.start_date_local || log.start_date;
  if (t) {
    const ms = Date.parse(String(t));
    if (!isNaN(ms)) return ms;
  }
  const aid = Number(log.activity_id || 0);
  return isFinite(aid) ? aid : 0;
}

function stravaRideTitlesFromLogs(logs: ShareLog[]): string {
  const sorted = [...logs].sort((a, b) => logSortKey(a) - logSortKey(b));
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const l of sorted) {
    const title = l.title != null ? String(l.title).trim() : "";
    if (!title || seen.has(title)) continue;
    seen.add(title);
    parts.push(title);
  }
  return parts.join(" · ");
}

/** 예: 2026년 6월 3일(수) · Morning Ride */
export function formatShareImageTitle(log: ShareLog, logs?: ShareLog[] | null): string {
  if (!log) return "STELVIO Ride";
  const shareLogs = logs?.length ? logs : log._logsForShare?.length ? log._logsForShare! : [log];

  const dateKey = log.date ? String(log.date) : "";
  let datePart = "";
  if (dateKey.length >= 10) {
    const [y, m, d] = dateKey.split("-").map((x) => parseInt(x, 10));
    if (isFinite(y) && isFinite(m) && isFinite(d)) {
      const dow = new Date(y, m - 1, d).getDay();
      datePart = `${y}년 ${m}월 ${d}일(${KOR_WEEKDAY[dow]})`;
    }
  }

  let titles = stravaRideTitlesFromLogs(shareLogs);
  if (!titles && log.title) titles = String(log.title).trim();
  if (datePart && titles) return `${datePart} · ${titles}`;
  if (datePart) return datePart;
  return titles || "STELVIO Ride";
}

export function formatDuration(sec: number): string {
  if (sec == null || !isFinite(Number(sec))) return "-";
  const s = Math.floor(Number(sec));
  let m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  m = m % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

/** 웹 summaryLinesFromLog — 세로 요약 5줄 (기능·순서 동일) */
export function summaryLinesFromLog(log: ShareLog): string[] {
  const dist = log.distance_km != null ? Number(log.distance_km) : 0;
  const sec =
    Number(log.duration_sec != null ? log.duration_sec : log.time != null ? log.time : 0) ||
    0;
  const elev = log.elevation_gain != null ? Number(log.elevation_gain) : null;
  const watts = log.avg_watts != null ? Number(log.avg_watts) : null;
  let spd = log.avg_speed_kmh != null ? Number(log.avg_speed_kmh) : null;
  if ((!spd || spd <= 0) && dist > 0 && sec > 0) {
    spd = Math.round((dist / (sec / 3600)) * 10) / 10;
  }
  return [
    dist > 0 ? `${dist.toFixed(1)} km` : "-",
    formatDuration(sec),
    elev != null && elev > 0 ? `${Math.round(elev)} m ↑` : "-",
    watts != null && watts > 0 ? `${Math.round(watts)} W` : "-",
    spd != null && spd > 0 ? `${spd.toFixed(1)} km/h` : "-",
  ];
}

/** @deprecated 디자인 전용 그리드 — Composer 기능과 무관 */
export function buildShareStatGrid(log: ShareLog): StatCell[] {
  const dist = log.distance_km != null ? Number(log.distance_km) : 0;
  const sec =
    Number(log.duration_sec != null ? log.duration_sec : log.time != null ? log.time : 0) ||
    0;
  let elev = log.elevation_gain != null ? Number(log.elevation_gain) : null;
  let watts = log.avg_watts != null ? Number(log.avg_watts) : null;
  let spd = log.avg_speed_kmh != null ? Number(log.avg_speed_kmh) : null;
  if ((!spd || spd <= 0) && dist > 0 && sec > 0) {
    spd = Math.round((dist / (sec / 3600)) * 10) / 10;
  }

  return [
    {
      label: "DISTANCE",
      value: dist > 0 ? `${dist.toFixed(1)} km` : "-",
      valueLatin: true,
    },
    {
      label: "TIME",
      value: sec > 0 ? formatDuration(sec) : "-",
      valueLatin: false,
    },
    {
      label: "SPEED",
      value: spd != null && spd > 0 ? `${spd.toFixed(1)} km/h` : "-",
      valueLatin: true,
    },
    {
      label: "ELEVATION",
      value: elev != null && elev > 0 ? `${Math.round(elev)} m ↑` : "-",
      valueLatin: true,
    },
    {
      label: "WATTS",
      value: watts != null && watts > 0 ? `${Math.round(watts)} W` : "-",
      valueLatin: true,
    },
  ];
}

export function isKoreanChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3131 && c <= 0x318e);
}

export function isLatinOrDigitChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

export type TextToken = { kind: "lat" | "ko"; text: string };

export function tokenizeShareText(text: string): TextToken[] {
  const s = String(text || "");
  const tokens: TextToken[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (isLatinOrDigitChar(ch)) {
      let j = i + 1;
      while (j < s.length) {
        const cj = s.charAt(j);
        if (
          isLatinOrDigitChar(cj) ||
          cj === "." ||
          cj === "," ||
          cj === "/" ||
          cj === "-" ||
          cj === "+"
        ) {
          j++;
        } else break;
      }
      tokens.push({ kind: "lat", text: s.slice(i, j) });
      i = j;
    } else if (isKoreanChar(ch)) {
      let jk = i + 1;
      while (jk < s.length && isKoreanChar(s.charAt(jk))) jk++;
      tokens.push({ kind: "ko", text: s.slice(i, jk) });
      i = jk;
    } else {
      tokens.push({ kind: "ko", text: ch });
      i++;
    }
  }
  return tokens;
}
