import type { ShareLog } from "./journalShareTypes";

const KOR_WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

export const STELVIO_SHARE_LOGO_ASSET = "assets/img/stelvio_w.png";

/** 오버레이 레이아웃 (1080×1350) — 상단 로고·제목, 하단 맵·통계 */
export const SHARE_LAYOUT = {
  padX: 48,
  logoTop: 24,
  logoMeasureFont: 36,
  subGapBelowLogo: 14,
  titleGapBelowSub: 44,
  courseW: 984,
  courseH: 480,
  courseGapAboveStats: 36,
  statsLabelY: 1070,
  statsValueY: 1130,
  splitY: 520,
  headerH: 520,
  bottomH: 830,
  fontSub: 28,
  fontTitle: 48,
  fontLabel: 26,
  fontValue: 68,
  fontUnit: 26,
} as const;

export function shareCourseY(): number {
  return (
    SHARE_LAYOUT.statsLabelY -
    SHARE_LAYOUT.courseGapAboveStats -
    SHARE_LAYOUT.courseH
  );
}

/** 속도 요약 문자열 (로고 너비 산정용, 웹 measureShareLogoWidth 와 동일 기준) */
export function speedLineTextForLogo(log: ShareLog): string {
  const cells = buildShareStatCells(log);
  const spd = cells.find((c) => c.label === "SPEED");
  if (!spd) return "-";
  return spd.unit ? `${spd.value} ${spd.unit}` : spd.value;
}

/** Bebas 36px 기준 로고 가로(px) — 웹 measureShareLogoWidth 근사 */
export function estimateShareLogoWidth(log: ShareLog): number {
  const text = speedLineTextForLogo(log);
  return Math.max(120, Math.round(text.length * 17.2));
}

export type ShareStatCell = {
  label: string;
  value: string;
  unit: string;
  valueIsLatin: boolean;
};

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

/** 상단 작은 줄 (날짜) */
export function formatShareHeaderSub(log: ShareLog): string {
  const dateKey = log.date ? String(log.date) : "";
  if (dateKey.length >= 10) {
    const parts = dateKey.split("-");
    const y = parseInt(parts[0] ?? "", 10);
    const m = parseInt(parts[1] ?? "", 10);
    const d = parseInt(parts[2] ?? "", 10);
    if (isFinite(y) && isFinite(m) && isFinite(d)) {
      const dow = KOR_WEEKDAY[new Date(y, m - 1, d).getDay()];
      return `${y}. ${String(m).padStart(2, "0")}. ${String(d).padStart(2, "0")} (${dow})`;
    }
  }
  return "";
}

/** 상단 큰 제목 (라이딩명) */
export function formatShareHeaderTitle(log: ShareLog, logs?: ShareLog[] | null): string {
  const shareLogs = logs?.length ? logs : log._logsForShare?.length ? log._logsForShare! : [log];
  let titles = stravaRideTitlesFromLogs(shareLogs);
  if (!titles && log.title) titles = String(log.title).trim();
  return (titles || "STELVIO RIDE").slice(0, 64);
}

/** 예: 2026년 6월 3일(수) · Morning Ride — Composer 외 호환 */
export function formatShareImageTitle(log: ShareLog, logs?: ShareLog[] | null): string {
  const sub = formatShareHeaderSub(log);
  const title = formatShareHeaderTitle(log, logs);
  if (sub && title) return `${sub.replace(/ \(.+\)$/, "")} · ${title}`;
  return title || sub || "STELVIO Ride";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** TIME: 시·분 만 (예: 3:41, 0:52) */
export function formatDurationClock(sec: number): { value: string; unit: string } {
  if (!sec || !isFinite(sec)) return { value: "-", unit: "" };
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return { value: `${h}:${pad2(m)}`, unit: "" };
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

/** 맵 하단 가로 그리드 — 라벨(작게) / 값(크게) / 단위(작게) */
export function buildShareStatCells(log: ShareLog): ShareStatCell[] {
  const dist = log.distance_km != null ? Number(log.distance_km) : 0;
  const sec =
    Number(log.duration_sec != null ? log.duration_sec : log.time != null ? log.time : 0) ||
    0;
  const elev = log.elevation_gain != null ? Number(log.elevation_gain) : null;
  let spd = log.avg_speed_kmh != null ? Number(log.avg_speed_kmh) : null;
  if ((!spd || spd <= 0) && dist > 0 && sec > 0) {
    spd = Math.round((dist / (sec / 3600)) * 10) / 10;
  }
  const time = formatDurationClock(sec);

  return [
    {
      label: "DISTANCE",
      value: dist > 0 ? dist.toFixed(1) : "-",
      unit: dist > 0 ? "km" : "",
      valueIsLatin: true,
    },
    {
      label: "TIME",
      value: time.value,
      unit: time.unit,
      valueIsLatin: true,
    },
    {
      label: "SPEED",
      value: spd != null && spd > 0 ? spd.toFixed(1) : "-",
      unit: spd != null && spd > 0 ? "km/h" : "",
      valueIsLatin: true,
    },
    {
      label: "ELEVATION",
      value: elev != null && elev > 0 ? String(Math.round(elev)) : "-",
      unit: elev != null && elev > 0 ? "m" : "",
      valueIsLatin: true,
    },
  ];
}

/** @deprecated */
export function summaryLinesFromLog(log: ShareLog): string[] {
  return buildShareStatCells(log).map((c) =>
    c.unit ? `${c.value} ${c.unit}`.trim() : c.value
  );
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
          cj === "+" ||
          cj === ":"
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
