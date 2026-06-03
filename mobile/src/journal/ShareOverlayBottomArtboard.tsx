/**
 * 투명 PNG — 하단(맵·통계) 1080×830
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, FeDropShadow, Filter, G, Path } from "react-native-svg";
import { SHARE_LAYOUT, buildShareStatCells, shareCourseY } from "./journalShareFormat";
import { buildCoursePathsForOverlay } from "./journalShareRoute";
import { OVERLAY_H, OVERLAY_W, type ShareLog, type ShareOverlayOpts } from "./journalShareTypes";
import { FONT_KOREAN, FONT_LATIN } from "./useShareFonts";
import type { ShareStatCell } from "./journalShareFormat";

const L = SHARE_LAYOUT;
const W = 1080;
const H = L.bottomH;
const COURSE_X = (W - L.courseW) / 2;
const COURSE_Y = shareCourseY() - L.splitY;

const TEXT_SHADOW = {
  textShadowColor: "rgba(0,0,0,0.55)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 6,
};

function StatColumn({
  cell,
  usingSystemFallback,
}: {
  cell: ShareStatCell;
  usingSystemFallback: boolean;
}) {
  const valueFont = usingSystemFallback ? "System" : FONT_LATIN;
  const labelFont = usingSystemFallback ? "System" : FONT_KOREAN;
  return (
    <View style={styles.statCol}>
      <Text style={[styles.statLabel, TEXT_SHADOW, { fontFamily: labelFont, fontSize: L.fontLabel }]}>
        {cell.label}
      </Text>
      <View style={styles.valueRow}>
        <Text
          style={[
            styles.statValue,
            TEXT_SHADOW,
            { fontFamily: valueFont, fontSize: L.fontValue, fontWeight: "800" },
          ]}
        >
          {cell.value}
        </Text>
        {cell.unit ? (
          <Text
            style={[styles.statUnit, TEXT_SHADOW, { fontFamily: valueFont, fontSize: L.fontUnit }]}
          >
            {cell.unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

type Props = {
  log: ShareLog;
  opts?: ShareOverlayOpts;
  usingSystemFallback?: boolean;
};

export function ShareOverlayBottomArtboard({ log, opts, usingSystemFallback = false }: Props) {
  const cells = buildShareStatCells(log);
  const pathDs = useMemo(
    () => buildCoursePathsForOverlay(log, { ...opts, width: OVERLAY_W, height: OVERLAY_H }),
    [log, opts]
  );
  const statsTop = L.statsLabelY - L.splitY;

  return (
    <View style={[styles.root, { width: W, height: H }]}>
      <View
        style={{
          position: "absolute",
          left: COURSE_X,
          top: COURSE_Y,
          width: L.courseW,
          height: L.courseH,
        }}
      >
        <Svg width={L.courseW} height={L.courseH} viewBox={`0 0 ${L.courseW} ${L.courseH}`}>
          <Defs>
            <Filter id="courseShadow" x="-25%" y="-25%" width="150%" height="150%">
              <FeDropShadow dx={0} dy={0} stdDeviation={4} floodColor="#000000" floodOpacity={0.5} />
            </Filter>
          </Defs>
          <G filter="url(#courseShadow)">
            {pathDs.map((d, i) => (
              <Path
                key={i}
                d={d}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </G>
        </Svg>
      </View>
      <View style={[styles.statsRow, { top: statsTop }]}>
        {cells.map((cell) => (
          <StatColumn key={cell.label} cell={cell} usingSystemFallback={usingSystemFallback} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "transparent", overflow: "hidden" },
  statsRow: {
    position: "absolute",
    left: L.padX,
    right: L.padX,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statCol: { flex: 1, alignItems: "center", minWidth: 0 },
  statLabel: {
    color: "#FFFFFF",
    opacity: 0.72,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  valueRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center" },
  statValue: { color: "#FFFFFF", lineHeight: L.fontValue * 1.02 },
  statUnit: { color: "#FFFFFF", opacity: 0.9, marginLeft: 3, marginBottom: 10 },
});
