/**
 * STELVIO — SNS 공유용 ViewShot 캡처 (NRC / Strava 스타일)
 *
 * 설치 (Expo 앱 루트에서):
 *   npx expo install expo-font expo-linear-gradient expo-media-library
 *   npx expo install react-native-svg react-native-view-shot
 *   npm install react-native-view-shot
 *
 * 폰트: mobile/assets/fonts/README.txt 참고 (Pretendard Regular / Bold / ExtraBold)
 */
import React, { useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import ViewShot from "react-native-view-shot";
import { LinearGradient } from "expo-linear-gradient";
import * as MediaLibrary from "expo-media-library";
import Svg, {
  Defs,
  FeDropShadow,
  Filter,
  G,
  Path,
} from "react-native-svg";
import {
  decodePolyline,
  decodePolylineSegments,
  latLngSegmentsToSvgPaths,
  latLngsToSvgPath,
} from "./stravaPolyline";
import { PRETENDARD, usePretendardFonts } from "./usePretendardFonts";
import type { RideRouteLog } from "./RidingCourseSvgBackground";

const CAP_W = 1080;
const CAP_H = 1350;
const DESIGN_W = 390;

export type ShareLog = RideRouteLog & {
  title?: string;
  date?: string;
  region?: string;
  distance_km?: number;
  duration_sec?: number;
  time?: number;
  elevation_gain?: number;
  avg_watts?: number;
  avg_speed_kmh?: number;
  start_time?: string;
  start_date_local?: string;
  activity_id?: number | string;
  _logsForShare?: ShareLog[];
  _routeProfileMerged?: {
    segments?: [number, number][][];
    segmentCount?: number;
    latlngs?: [number, number][];
  };
};

export type DailyRouteDoc = {
  route_segments?: [number, number][][];
  merged_elevation_profile?: number[];
};

export type TransparentShareCaptureProps = {
  log: ShareLog;
  /** 사용자가 고른 배경 사진 URI (file:// 또는 content://) */
  backgroundUri?: string | null;
  logsForShare?: ShareLog[];
  dailyRouteDoc?: DailyRouteDoc | null;
  region?: string;
  logoSource?: ImageSourcePropType;
  onDone?: () => void;
  /** true면 화면에 미리보기, false면 오프스크린 캡처만 */
  preview?: boolean;
  style?: ViewStyle;
};

type StatItem = { label: string; value: string };

function scalePx(n: number, width = CAP_W): number {
  return (n * width) / DESIGN_W;
}

function logSortKey(log: ShareLog): number {
  const t = log.start_time || log.start_date_local;
  if (t) {
    const ms = Date.parse(String(t));
    if (!isNaN(ms)) return ms;
  }
  const aid = Number(log.activity_id || 0);
  return isFinite(aid) ? aid : 0;
}

function stravaTitles(logs: ShareLog[]): string {
  const sorted = [...logs].sort((a, b) => logSortKey(a) - logSortKey(b));
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const l of sorted) {
    const t = l.title != null ? String(l.title).trim() : "";
    if (!t || seen.has(t)) continue;
    seen.add(t);
    parts.push(t);
  }
  return parts.join(" · ");
}

function formatSubLine(log: ShareLog, region?: string): string {
  const dateKey = log.date ? String(log.date) : "";
  let datePart = "";
  if (dateKey.length >= 10) {
    const [y, m, d] = dateKey.split("-").map((x) => parseInt(x, 10));
    if (isFinite(y) && isFinite(m) && isFinite(d)) {
      datePart = `${y}. ${String(m).padStart(2, "0")}. ${String(d).padStart(2, "0")}`;
    }
  }
  const loc = (region || log.region || "STELVIO")
    .toString()
    .trim()
    .toUpperCase();
  if (datePart && loc) return `${datePart} · ${loc}`;
  return datePart || loc || "";
}

function formatTitleLine(log: ShareLog, logs?: ShareLog[]): string {
  const shareLogs = logs?.length ? logs : log._logsForShare?.length ? log._logsForShare! : [log];
  const titles = stravaTitles(shareLogs);
  const raw = titles || log.title || "STELVIO RIDE";
  return String(raw).trim().toUpperCase();
}

function formatDuration(sec: number): string {
  if (!sec || !isFinite(sec)) return "-";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h > 0) return `${h}h ${rm}m`;
  return `${m}m`;
}

function buildStats(log: ShareLog): StatItem[] {
  const dist = Number(log.distance_km) || 0;
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
      value: dist > 0 ? `${dist.toFixed(1)}km` : "-",
    },
    {
      label: "TIME",
      value: sec > 0 ? formatDuration(sec) : "-",
    },
    {
      label: "ELEVATION",
      value: elev != null && elev > 0 ? `${Math.round(elev)}m` : "-",
    },
    {
      label: "WATTS",
      value: watts != null && watts > 0 ? `${Math.round(watts)}W` : "-",
    },
    {
      label: "SPEED",
      value: spd != null && spd > 0 ? `${spd.toFixed(1)}km/h` : "-",
    },
  ];
}

function resolveSegments(
  log: ShareLog,
  logsForShare?: ShareLog[],
  dailyRouteDoc?: DailyRouteDoc | null
): [number, number][][] {
  if (dailyRouteDoc?.route_segments?.length) {
    return dailyRouteDoc.route_segments.filter((s) => s && s.length >= 2);
  }
  const merged = log._routeProfileMerged;
  if (merged?.segments?.length) {
    return merged.segments.filter((s) => s && s.length >= 2);
  }
  const logs = logsForShare?.length
    ? logsForShare
    : log._logsForShare?.length
      ? log._logsForShare!
      : null;
  if (logs && logs.length > 1) {
    const sorted = [...logs].sort((a, b) => logSortKey(a) - logSortKey(b));
    const polys = sorted.map((l) =>
      l.summary_polyline != null ? String(l.summary_polyline).trim() : ""
    );
    const segs = decodePolylineSegments(polys);
    if (segs.length) return segs;
  }
  if ((merged?.segmentCount || 0) > 1) return [];
  const poly = log.summary_polyline ? String(log.summary_polyline).trim() : "";
  const latlngs = poly ? decodePolyline(poly) : [];
  return latlngs.length >= 2 ? [latlngs] : [];
}

function coursePathsForShare(
  log: ShareLog,
  viewW: number,
  viewH: number,
  logsForShare?: ShareLog[],
  dailyRouteDoc?: DailyRouteDoc | null
): string[] {
  const segments = resolveSegments(log, logsForShare, dailyRouteDoc);
  if (segments.length > 1) {
    return latLngSegmentsToSvgPaths(segments, viewW, viewH, 0.1)
      .map((p) => p.pathD)
      .filter(Boolean);
  }
  if (segments.length === 1) {
    const d = latLngsToSvgPath(segments[0], viewW, viewH, 0.1);
    return d ? [d] : [];
  }
  return [];
}

type ArtboardProps = {
  log: ShareLog;
  backgroundUri?: string | null;
  logsForShare?: ShareLog[];
  dailyRouteDoc?: DailyRouteDoc | null;
  region?: string;
  logoSource?: ImageSourcePropType;
  usingSystemFallback: boolean;
  width?: number;
  height?: number;
};

/** ViewShot에 들어가는 실제 아트보드 */
export function ShareCaptureArtboard({
  log,
  backgroundUri,
  logsForShare,
  dailyRouteDoc,
  region,
  logoSource,
  usingSystemFallback,
  width = CAP_W,
  height = CAP_H,
}: ArtboardProps) {
  const s = (n: number) => scalePx(n, width);
  const ff = (weight: "regular" | "bold" | "extraBold") => {
    if (usingSystemFallback) {
      if (weight === "extraBold") return "System";
      if (weight === "bold") return "System";
      return "System";
    }
    if (weight === "extraBold") return PRETENDARD.extraBold;
    if (weight === "bold") return PRETENDARD.bold;
    return PRETENDARD.regular;
  };
  const fw = (weight: "regular" | "bold" | "extraBold") => {
    if (!usingSystemFallback) return undefined;
    if (weight === "extraBold") return "800" as const;
    if (weight === "bold") return "700" as const;
    return "400" as const;
  };

  const subLine = formatSubLine(log, region);
  const titleLine = formatTitleLine(log, logsForShare);
  const stats = buildStats(log);

  const routeBoxW = width - s(48);
  const routeBoxH = Math.round(height * 0.42);
  const pathDs = useMemo(
    () => coursePathsForShare(log, routeBoxW, routeBoxH, logsForShare, dailyRouteDoc),
    [log, routeBoxW, routeBoxH, logsForShare, dailyRouteDoc]
  );

  const padH = s(24);
  const headerTop = s(52);
  const footerBottom = s(36);

  return (
    <View style={[artStyles.root, { width, height }]}>
      {backgroundUri ? (
        <Image
          source={{ uri: backgroundUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, artStyles.fallbackBg]} />
      )}

      <View style={[StyleSheet.absoluteFill, artStyles.dimOverlay]} />

      <LinearGradient
        colors={["rgba(0,0,0,0.55)", "rgba(0,0,0,0)"]}
        style={[artStyles.gradient, { height: height * 0.28 }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.65)"]}
        style={[artStyles.gradient, artStyles.gradientBottom, { height: height * 0.42 }]}
        pointerEvents="none"
      />

      <View
        style={[
          artStyles.contentColumn,
          {
            paddingTop: headerTop,
            paddingBottom: footerBottom,
            paddingHorizontal: padH,
          },
        ]}
      >
        <View style={artStyles.header}>
          {subLine ? (
            <Text
              style={[
                artStyles.sub,
                {
                  fontSize: s(12),
                  letterSpacing: s(1.2),
                  fontFamily: ff("regular"),
                  fontWeight: fw("regular"),
                },
              ]}
            >
              {subLine}
            </Text>
          ) : null}
          <Text
            style={[
              artStyles.title,
              {
                fontSize: s(28),
                letterSpacing: s(0.6),
                marginTop: s(6),
                fontFamily: ff("extraBold"),
                fontWeight: fw("extraBold"),
              },
            ]}
            numberOfLines={2}
          >
            {titleLine}
          </Text>
        </View>

        <View style={artStyles.middle}>
          <Svg
            width={routeBoxW}
            height={routeBoxH}
            viewBox={`0 0 ${routeBoxW} ${routeBoxH}`}
          >
            <Defs>
              <Filter
                id="routeShadow"
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
              >
                <FeDropShadow
                  dx={0}
                  dy={0}
                  stdDeviation={4}
                  floodColor="#000000"
                  floodOpacity={0.55}
                />
              </Filter>
            </Defs>
            <G filter="url(#routeShadow)">
              {pathDs.map((d, i) => (
                <Path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth={2.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </G>
          </Svg>
        </View>

        <View style={artStyles.footer}>
          <View style={artStyles.statsRow}>
            {stats.map((item) => (
              <View key={item.label} style={artStyles.statCell}>
                <Text
                  style={[
                    artStyles.statLabel,
                    {
                      fontSize: s(10),
                      letterSpacing: s(1.4),
                      fontFamily: ff("regular"),
                      fontWeight: fw("regular"),
                    },
                  ]}
                >
                  {item.label}
                </Text>
                <Text
                  style={[
                    artStyles.statValue,
                    {
                      fontSize: s(21),
                      letterSpacing: s(0.2),
                      marginTop: s(4),
                      fontFamily: ff("extraBold"),
                      fontWeight: fw("extraBold"),
                    },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {item.value}
                </Text>
              </View>
            ))}
          </View>

          {logoSource ? (
            <Image
              source={logoSource}
              style={[
                artStyles.logo,
                { marginTop: s(18), height: s(22), width: s(120) },
              ]}
              resizeMode="contain"
            />
          ) : (
            <Text
              style={[
                artStyles.logoText,
                {
                  marginTop: s(18),
                  fontSize: s(11),
                  letterSpacing: s(3),
                  fontFamily: ff("bold"),
                  fontWeight: fw("bold"),
                },
              ]}
            >
              STELVIO
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

export function TransparentShareCapture({
  log,
  backgroundUri,
  logsForShare,
  dailyRouteDoc,
  region,
  logoSource,
  onDone,
  preview = false,
  style,
}: TransparentShareCaptureProps) {
  const shotRef = useRef<ViewShot>(null);
  const { fontsReady, usingSystemFallback } = usePretendardFonts();

  async function save() {
    if (!backgroundUri) {
      Alert.alert("배경 사진", "공유 이미지용 배경 사진을 먼저 선택해 주세요.");
      return;
    }
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("권한 필요", "사진첩 저장 권한을 허용해 주세요.");
        return;
      }
      const uri = await shotRef.current?.capture?.({
        format: "jpg",
        quality: 0.92,
        result: "tmpfile",
      });
      if (!uri) throw new Error("캡처 실패");
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("저장 완료", "공유 이미지가 사진첩에 저장되었습니다.");
      onDone?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "저장 실패";
      Alert.alert("오류", msg);
    }
  }

  const artboard = fontsReady ? (
    <ShareCaptureArtboard
      log={log}
      backgroundUri={backgroundUri}
      logsForShare={logsForShare}
      dailyRouteDoc={dailyRouteDoc}
      region={region}
      logoSource={logoSource}
      usingSystemFallback={usingSystemFallback}
    />
  ) : (
    <View style={[artStyles.root, { width: CAP_W, height: CAP_H, justifyContent: "center" }]}>
      <ActivityIndicator color="#FFFFFF" />
    </View>
  );

  return (
    <View style={style}>
      <Pressable
        style={styles.btn}
        onPress={save}
        disabled={!fontsReady || !backgroundUri}
      >
        <Text style={styles.btnText}>SNS 공유 이미지 저장</Text>
      </Pressable>

      {preview ? (
        <View style={styles.previewWrap}>
          <ViewShot ref={shotRef} options={{ format: "jpg", quality: 0.92 }}>
            {artboard}
          </ViewShot>
        </View>
      ) : (
        <View style={styles.offscreen} pointerEvents="none">
          <ViewShot ref={shotRef} options={{ format: "jpg", quality: 0.92 }}>
            {artboard}
          </ViewShot>
        </View>
      )}
    </View>
  );
}

const artStyles = StyleSheet.create({
  root: {
    overflow: "hidden",
    backgroundColor: "#0a0a0a",
  },
  fallbackBg: {
    backgroundColor: "#1a1a1a",
  },
  dimOverlay: {
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  gradient: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
  },
  gradientBottom: {
    top: undefined,
    bottom: 0,
  },
  contentColumn: {
    flex: 1,
    justifyContent: "space-between",
    zIndex: 2,
  },
  header: {
    alignSelf: "stretch",
  },
  sub: {
    color: "#FFFFFF",
    opacity: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: "#FFFFFF",
  },
  middle: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 120,
  },
  footer: {
    alignSelf: "stretch",
    alignItems: "center",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    width: "100%",
  },
  statCell: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
    paddingHorizontal: 2,
  },
  statLabel: {
    color: "#FFFFFF",
    opacity: 0.7,
    textTransform: "uppercase",
  },
  statValue: {
    color: "#FFFFFF",
  },
  logo: {
    alignSelf: "center",
    opacity: 0.92,
  },
  logoText: {
    color: "#FFFFFF",
    opacity: 0.85,
    textTransform: "uppercase",
  },
});

const styles = StyleSheet.create({
  btn: {
    alignSelf: "flex-end",
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.35)",
  },
  btnText: { color: "#5b21b6", fontWeight: "600", fontSize: 13 },
  previewWrap: {
    marginTop: 12,
    alignSelf: "center",
    borderRadius: 12,
    overflow: "hidden",
    transform: [{ scale: 0.28 }],
    width: CAP_W,
    height: CAP_H,
  },
  offscreen: {
    position: "absolute",
    left: -12000,
    top: 0,
    width: CAP_W,
    height: CAP_H,
    opacity: 1,
  },
});
