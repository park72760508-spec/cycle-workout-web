/**
 * 투명 PNG 오버레이 — 상단 로고·제목 / 하단 맵·통계(4항목)
 */
import React, { useMemo, useState } from "react";
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
  estimateShareLogoWidth,
  formatShareHeaderSub,
  formatShareHeaderTitle,
  shareCourseY,
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
const COURSE_Y = shareCourseY();

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
  top,
  opacity = 1,
  usingSystemFallback,
  extraBold,
}: {
  text: string;
  fontSize: number;
  top: number;
  opacity?: number;
  usingSystemFallback: boolean;
  extraBold?: boolean;
}) {
  const tokens = tokenizeShareText(text);
  return (
    <View style={[overlayStyles.headerLine, { top }]}>
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
    </View>
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
              { fontFamily: valueFont, fontSize: L.fontUnit },
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

  const logoW = estimateShareLogoWidth(log);
  const [logoH, setLogoH] = useState(Math.max(32, Math.round(logoW * 0.2)));
  const subY = L.logoTop + logoH + L.subGapBelowLogo;
  const titleY = subY + L.titleGapBelowSub;

  return (
    <View style={[overlayStyles.root, { width: OVERLAY_W, height: OVERLAY_H }]}>
      {logoSource ? (
        <Image
          source={logoSource}
          style={[
            overlayStyles.logoImg,
            {
              top: L.logoTop,
              width: logoW,
              height: logoH,
              left: (OVERLAY_W - logoW) / 2,
            },
          ]}
          resizeMode="contain"
          onLoad={(e) => {
            const { width, height } = e.nativeEvent.source;
            if (width > 0 && height > 0) {
              setLogoH(Math.round(logoW * (height / width)));
            }
          }}
        />
      ) : null}

      {sub ? (
        <CenteredText
          text={sub}
          fontSize={L.fontSub}
          top={subY}
          opacity={0.78}
          usingSystemFallback={usingSystemFallback}
        />
      ) : null}

      <CenteredText
        text={title}
        fontSize={L.fontTitle}
        top={titleY}
        usingSystemFallback={usingSystemFallback}
        extraBold
      />

      <View
        style={[
          overlayStyles.courseWrap,
          {
            left: COURSE_X,
            top: COURSE_Y,
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
    </View>
  );
}

const overlayStyles = StyleSheet.create({
  root: {
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  logoImg: {
    position: "absolute",
    opacity: 0.95,
  },
  headerLine: {
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
});
