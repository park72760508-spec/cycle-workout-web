/**
 * React Native — 코스 라인 + 고도 SVG 배경 (지도 타일 없음)
 *
 * 설치:
 *   npm install react-native-svg
 *   npx expo install react-native-svg
 */
import React, { useMemo } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { decodePolyline, latLngsToSvgPath } from "./stravaPolyline";

export type RideRouteLog = {
  summary_polyline?: string | null;
  elevation_profile?: number[] | null;
};

type Props = {
  log: RideRouteLog | null;
  opacity?: number;
  variant?: "muted" | "white";
  style?: ViewStyle;
  showElevation?: boolean;
};

function elevationPath(elev: number[], viewW = 400, viewH = 56): string {
  if (!elev || elev.length < 2) return "";
  const minE = Math.min(...elev);
  const maxE = Math.max(...elev);
  const span = maxE - minE || 1;
  const padX = viewW * 0.06;
  const padY = viewH * 0.06;
  const innerW = viewW - padX * 2;
  const innerH = viewH - padY * 2;
  const n = elev.length - 1;
  let d = "";
  elev.forEach((v, i) => {
    const x = padX + (n > 0 ? (i / n) * innerW : 0);
    const y = padY + innerH - ((v - minE) / span) * innerH;
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
  });
  return d.trim();
}

export function RidingCourseSvgBackground({
  log,
  opacity = 0.22,
  variant = "muted",
  style,
  showElevation = true,
}: Props) {
  const stroke = variant === "white" ? "#FFFFFF" : "#7c3aed";
  const { courseD, elevD } = useMemo(() => {
    const poly = log?.summary_polyline ? String(log.summary_polyline).trim() : "";
    const latlngs = poly ? decodePolyline(poly) : [];
    const elev = Array.isArray(log?.elevation_profile) ? log!.elevation_profile! : [];
    return {
      courseD: latlngs.length >= 2 ? latLngsToSvgPath(latlngs, 400, 160) : "",
      elevD: showElevation && elev.length >= 2 ? elevationPath(elev) : "",
    };
  }, [log, showElevation]);

  if (!courseD && !elevD) return null;

  return (
    <View style={[styles.wrap, style]} pointerEvents="none">
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 400 220"
        preserveAspectRatio="xMidYMid meet"
        style={{ opacity }}
      >
        {courseD ? (
          <Path
            d={courseD}
            stroke={stroke}
            strokeWidth={variant === "white" ? 3 : 2.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {elevD ? (
          <Path
            d={elevD}
            transform="translate(0, 164)"
            stroke={stroke}
            strokeWidth={variant === "white" ? 2 : 1.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
});
