/**
 * 투명 PNG 오버레이 — NRC 레퍼런스: 상단 제목 / 중앙 맵 / 맵 하단 통계 그리드
 */
import React, { useMemo } from "react";
import {
  Image,
  ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Defs, FeDropShadow, Filter, G, Path } from "react-native-svg";
import {
  SHARE_LAYOUT,
  buildShareStatCells,
  formatShareHeaderSub,
  formatShareHeaderTitle,
  tokenizeShareText,
  type ShareStatCell,
  type TextToken,
} from "./journalShareFormat";
import { buildCoursePathsForOverlay } from "./journalShareRoute";
import {
  OVERLAY_H,
  OVERLAY_W,
  type ShareLog,
  type ShareOverlayOpts,
} from "./journalShareTypes";
import { FONT_KOREAN, FONT_LATIN } from "./useShareFonts";

const L = SHARE_LAYOUT;
const COURSE_X = (OVERLAY_W - L.courseW) / 2;

const TEXT_SHADOW = {
  textShadowColor: "rgba(0,0,0,0.55)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 6,
};

type Props = {
  log: ShareLog;
  opts?: ShareOverlayOpts;
  logoSource?: ImageSourcePropType;
  usingSystemFallback?: boolean;
};

function fontForToken(
  kind: TextToken["kind"],
  usingSystemFallback: boolean
): { family: string; weight?: "600" | "700" | "800" } {
  if (usingSystemFallback) {
    return { family: "System", weight: kind === "lat" ? "800" : "600" };
  }
  return { family: kind === "lat" ? FONT_LATIN : FONT_KOREAN, weight: undefined };
}

function CenteredText({
  text,
  fontSize,
  opacity = 1,
  usingSystemFallback,
  extraBold,
}: {
  text: string;
  fontSize: number;
  opacity?: number;
  usingSystemFallback: boolean;
  extraBold?: boolean;
}) {
  const tokens = tokenizeShareText(text);
  return (
    <Text
      style={[
        overlayStyles.textCenter,
        TEXT_SHADOW,
        { fontSize, opacity },
        extraBold && overlayStyles.titleWeight,
      ]}
    >
      {tokens.map((tok, i) => {
        const f = fontForToken(tok.kind, usingSystemFallback);
        return (
          <Text
            key={`${i}-${tok.text}`}
            style={{
              fontFamily: f.family,
              fontWeight: extraBold ? "800" : f.weight,
              color: "#FFFFFF",
            }}
          >
            {tok.text}
          </Text>
        );
      })}
    </Text>
  );
}

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
    <View style={overlayStyles.statCol}>
      <Text
        style={[
          overlayStyles.statLabel,
          TEXT_SHADOW,
          { fontFamily: labelFont, fontSize: L.fontLabel },
        ]}
      >
        {cell.label}
      </Text>
      <View style={overlayStyles.valueRow}>
        <Text
          style={[
            overlayStyles.statValue,
            TEXT_SHADOW,
            {
              fontFamily: valueFont,
              fontSize: L.fontValue,
              fontWeight: "800",
            },
          ]}
        >
          {cell.value}
        </Text>
        {cell.unit ? (
          <Text
            style={[
              overlayStyles.statUnit,
              TEXT_SHADOW,
              {
                fontFamily: valueFont,
                fontSize: L.fontUnit,
              },
            ]}
          >
            {cell.unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function ShareOverlayArtboard({
  log,
  opts,
  logoSource,
  usingSystemFallback = false,
}: Props) {
  const shareLogs = opts?.logs || log._logsForShare || null;
  const sub = formatShareHeaderSub(log);
  const title = formatShareHeaderTitle(log, shareLogs);
  const cells = buildShareStatCells(log);
  const pathDs = useMemo(
    () => buildCoursePathsForOverlay(log, { ...opts, width: OVERLAY_W, height: OVERLAY_H }),
    [log, opts]
  );

  return (
    <View style={[overlayStyles.root, { width: OVERLAY_W, height: OVERLAY_H }]}>
      <View style={[overlayStyles.header, { top: L.subY }]}>
        {sub ? (
          <CenteredText
            text={sub}
            fontSize={L.fontSub}
            opacity={0.78}
            usingSystemFallback={usingSystemFallback}
          />
        ) : null}
        <View style={{ marginTop: sub ? 10 : 0 }}>
          <CenteredText
            text={title}
            fontSize={L.fontTitle}
            usingSystemFallback={usingSystemFallback}
            extraBold
          />
        </View>
      </View>

      <View
        style={[
          overlayStyles.courseWrap,
          {
            left: COURSE_X,
            top: L.courseY,
            width: L.courseW,
            height: L.courseH,
          },
        ]}
      >
        <Svg width={L.courseW} height={L.courseH} viewBox={`0 0 ${L.courseW} ${L.courseH}`}>
          <Defs>
            <Filter id="courseShadow" x="-25%" y="-25%" width="150%" height="150%">
              <FeDropShadow
                dx={0}
                dy={0}
                stdDeviation={4}
                floodColor="#000000"
                floodOpacity={0.5}
              />
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

      <View style={[overlayStyles.statsRow, { top: L.statsLabelY }]}>
        {cells.map((cell) => (
          <StatColumn key={cell.label} cell={cell} usingSystemFallback={usingSystemFallback} />
        ))}
      </View>

      {logoSource ? (
        <Image
          source={logoSource}
          style={overlayStyles.logoImg}
          resizeMode="contain"
        />
      ) : (
        <Text
          style={[
            overlayStyles.logoText,
            TEXT_SHADOW,
            { fontFamily: usingSystemFallback ? "System" : FONT_LATIN },
          ]}
        >
          STELVIO
        </Text>
      )}
    </View>
  );
}

const overlayStyles = StyleSheet.create({
  root: {
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  header: {
    position: "absolute",
    left: L.padX,
    right: L.padX,
    alignItems: "center",
  },
  textCenter: {
    color: "#FFFFFF",
    textAlign: "center",
  },
  titleWeight: {
    letterSpacing: 0.5,
  },
  courseWrap: {
    position: "absolute",
  },
  statsRow: {
    position: "absolute",
    left: L.padX,
    right: L.padX,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  statCol: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
  },
  statLabel: {
    color: "#FFFFFF",
    opacity: 0.72,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  statValue: {
    color: "#FFFFFF",
    lineHeight: L.fontValue * 1.02,
  },
  statUnit: {
    color: "#FFFFFF",
    opacity: 0.9,
    marginLeft: 3,
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  logoImg: {
    position: "absolute",
    alignSelf: "center",
    left: OVERLAY_W / 2 - 80,
    top: L.logoY,
    width: 160,
    height: 32,
    opacity: 0.95,
  },
  logoText: {
    position: "absolute",
    width: OVERLAY_W,
    top: L.logoY,
    textAlign: "center",
    color: "#FFFFFF",
    fontSize: 26,
    letterSpacing: 4,
  },
});
