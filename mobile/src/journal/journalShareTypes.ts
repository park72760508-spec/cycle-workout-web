import type { RideRouteLog } from "./RidingCourseSvgBackground";

export type ShareLog = RideRouteLog & {
  title?: string;
  date?: string;
  distance_km?: number;
  duration_sec?: number;
  time?: number;
  elevation_gain?: number;
  avg_watts?: number;
  avg_speed_kmh?: number;
  start_time?: string;
  start_date_local?: string;
  start_date?: string;
  activity_id?: number | string;
  _logsForShare?: ShareLog[];
  _dailyRouteDoc?: DailyRouteDoc;
  _routeProfileMerged?: RouteProfileMerged;
};

export type DailyRouteDoc = {
  route_segments?: [number, number][][];
  merged_elevation_profile?: number[];
  activity_ids?: string[];
};

export type RouteProfileMerged = {
  segments?: [number, number][][];
  segmentCount?: number;
  latlngs?: [number, number][];
  hasRoute?: boolean;
};

export type ShareOverlayOpts = {
  width?: number;
  height?: number;
  logs?: ShareLog[];
  dailyRouteDoc?: DailyRouteDoc | null;
};

export const OVERLAY_W = 1080;
export const OVERLAY_H = 1350;
export const OVERLAY_ASPECT = OVERLAY_H / OVERLAY_W;
