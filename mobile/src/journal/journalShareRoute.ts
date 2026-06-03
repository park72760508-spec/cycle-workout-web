import {
  decodePolyline,
  decodePolylineSegments,
  latLngSegmentsToSvgPaths,
  latLngsToSvgPath,
} from "./stravaPolyline";
import type {
  DailyRouteDoc,
  RouteProfileMerged,
  ShareLog,
  ShareOverlayOpts,
} from "./journalShareTypes";

export type RouteProfile = {
  segments: [number, number][][];
  segmentCount: number;
  latlngs: [number, number][];
  hasRoute: boolean;
};

function downsampleLatLngs(pts: [number, number][], max: number): [number, number][] {
  if (pts.length <= max) return pts;
  const step = Math.ceil(pts.length / max);
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function logSortKeyRoute(log: ShareLog): number {
  const t = log.start_time || log.start_date_local || log.start_date;
  if (t) {
    const ms = Date.parse(String(t));
    if (!isNaN(ms)) return ms;
  }
  const aid = Number(log.activity_id || 0);
  return isFinite(aid) ? aid : 0;
}

function normalizeLogPolyline(log: ShareLog): ShareLog {
  const poly =
    log.summary_polyline != null ? String(log.summary_polyline).trim() : "";
  if (!poly) return log;
  return log;
}

export function routeProfileFromLogs(
  logs: ShareLog[],
  dailyDoc?: DailyRouteDoc | null
): RouteProfile {
  if (dailyDoc?.route_segments?.length) {
    const segs = dailyDoc.route_segments.filter((s) => s && s.length >= 2);
    return {
      segments: segs,
      segmentCount: segs.length,
      latlngs: [],
      hasRoute: segs.length > 0,
    };
  }

  if (!logs.length) {
    return { segments: [], segmentCount: 0, latlngs: [], hasRoute: false };
  }

  const sorted = [...logs].sort((a, b) => logSortKeyRoute(a) - logSortKeyRoute(b));
  const segments: [number, number][][] = [];
  for (const raw of sorted) {
    const l = normalizeLogPolyline(raw);
    const poly =
      l.summary_polyline != null ? String(l.summary_polyline).trim() : "";
    if (!poly) continue;
    const pts = downsampleLatLngs(decodePolyline(poly), 320);
    if (pts.length >= 2) segments.push(pts);
  }

  return {
    segments: segments.slice(0, 8),
    segmentCount: segments.length,
    latlngs: [],
    hasRoute: segments.length > 0,
  };
}

export function routeProfileFromLog(log: ShareLog): RouteProfile {
  const poly = log.summary_polyline ? String(log.summary_polyline).trim() : "";
  const pts = poly ? downsampleLatLngs(decodePolyline(poly), 900) : [];
  return {
    segments: pts.length >= 2 ? [pts] : [],
    segmentCount: pts.length >= 2 ? 1 : 0,
    latlngs: pts,
    hasRoute: pts.length >= 2,
  };
}

export function resolveRouteProfileForShare(
  log: ShareLog,
  opts?: ShareOverlayOpts
): RouteProfile | null {
  if (!log) return null;
  const logs = opts?.logs || log._logsForShare;
  const dailyDoc = opts?.dailyRouteDoc ?? log._dailyRouteDoc ?? null;

  if (logs?.length) {
    return routeProfileFromLogs(logs, dailyDoc);
  }
  if (log._routeProfileMerged?.segments?.length) {
    const m = log._routeProfileMerged;
    return {
      segments: m.segments!.filter((s) => s && s.length >= 2),
      segmentCount: m.segmentCount || m.segments!.length,
      latlngs: m.latlngs || [],
      hasRoute: true,
    };
  }
  return routeProfileFromLog(log);
}

/** buildShareSvgMarkup — 코스 path 문자열 배열 */
export function coursePathStringsFromRoute(
  route: RouteProfile,
  viewW: number,
  viewH: number,
  padRatio = 0.12
): string[] {
  const segs = route.segments;
  const out: string[] = [];

  if (segs.length > 1) {
    const drawn = latLngSegmentsToSvgPaths(segs, viewW, viewH, padRatio);
    for (const d of drawn) {
      if (d.pathD) out.push(d.pathD);
    }
    return out;
  }

  if (segs.length === 1) {
    const d = latLngsToSvgPath(segs[0], viewW, viewH, padRatio);
    if (d) out.push(d);
    return out;
  }

  if ((route.segmentCount || 0) > 1) return [];

  if (route.hasRoute && route.latlngs.length >= 2) {
    const d = latLngsToSvgPath(route.latlngs, viewW, viewH, padRatio);
    if (d) out.push(d);
  }

  return out;
}

export function buildCoursePathsForOverlay(
  log: ShareLog,
  opts?: ShareOverlayOpts
): string[] {
  const w = opts?.width || 1080;
  const h = opts?.height || 1350;
  const route = resolveRouteProfileForShare(log, opts);
  if (!route?.hasRoute) return [];
  return coursePathStringsFromRoute(route, w - 96, 480, 0.1);
}
