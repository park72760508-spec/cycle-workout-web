/**
 * 투명 PNG 오버레이 (1080×1350) — 웹 journalTransparentShare 레이아웃·기능 동일, 디자인만 보강
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
  formatShareImageTitle,
  summaryLinesFromLog,
  tokenizeShareText,
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

const SHARE_TEXT_X = 60;
const SHARE_TITLE_Y = 80;
const SHARE_LINE_STEP = 52;
const SHARE_LOGO_GAP_BELOW_SPEED = 14;
const COURSE_OFFSET_Y = OVERLAY_H - 780;
const COURSE_VIEW_W = OVERLAY_W - 120;
const COURSE_VIEW_H = 520;

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
): { family: string; weight?: "600" | "700" } {
  if (usingSystemFallback) {
    return { family: "System", weight: kind === "lat" ? "700" : "600" };
  }
  return {
    family: kind === "lat" ? FONT_LATIN : FONT_KOREAN,
    weight: undefined,
  };
}

function TokenizedLine({
  text,
  fontSize,
  usingSystemFallback,
}: {
  text: string;
  fontSize: number;
  usingSystemFallback: boolean;
}) {
  const tokens = tokenizeShareText(text);
  return (
    <Text style={[overlayStyles.textBase, TEXT_SHADOW, { fontSize }]}>
      {tokens.map((tok, i) => {
        const f = fontForToken(tok.kind, usingSystemFallback);
        return (
          <Text
            key={`${i}-${tok.text}`}
            style={{
              fontFamily: f.family,
              fontWeight: f.weight,
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

export function ShareOverlayArtboard({
  log,
  opts,
  logoSource,
  usingSystemFallback = false,
}: Props) {
  const shareLogs = opts?.logs || log._logsForShare || null;
  const title = formatShareImageTitle(log, shareLogs).slice(0, 96);
  const lines = summaryLinesFromLog(log);
  const speedLineText = lines[lines.length - 1] || "-";
  const pathDs = useMemo(
    () => buildCoursePathsForOverlay(log, { ...opts, width: OVERLAY_W, height: OVERLAY_H }),
    [log, opts]
  );

  const logoTop =
    SHARE_TITLE_Y + lines.length * SHARE_LINE_STEP + SHARE_LOGO_GAP_BELOW_SPEED;

  return (
    <View style={[overlayStyles.root, { width: OVERLAY_W, height: OVERLAY_H }]}>
      <View
        style={[
          overlayStyles.courseWrap,
          { left: SHARE_TEXT_X, top: COURSE_OFFSET_Y, width: COURSE_VIEW_W, height: COURSE_VIEW_H },
        ]}
      >
        <Svg width={COURSE_VIEW_W} height={COURSE_VIEW_H} viewBox={`0 0 ${COURSE_VIEW_W} ${COURSE_VIEW_H}`}>
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
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </G>
        </Svg>
      </View>

      <View style={[overlayStyles.titleWrap, { left: SHARE_TEXT_X, top: SHARE_TITLE_Y }]}>
        <TokenizedLine text={title} fontSize={42} usingSystemFallback={usingSystemFallback} />
      </View>

      {lines.map((line, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: SHARE_TEXT_X,
            top: SHARE_TITLE_Y + (i + 1) * SHARE_LINE_STEP,
          }}
        >
          <TokenizedLine text={line} fontSize={36} usingSystemFallback={usingSystemFallback} />
        </View>
      ))}

      {logoSource ? (
        <Image
          source={logoSource}
          style={[
            overlayStyles.logoImg,
            { top: logoTop, width: speedLineText.length * 14 + 40 },
          ]}
          resizeMode="contain"
        />
      ) : (
        <Text
          style={[
            overlayStyles.logoText,
            TEXT_SHADOW,
            { top: logoTop, fontFamily: usingSystemFallback ? "System" : FONT_LATIN },
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
  courseWrap: {
    position: "absolute",
  },
  titleWrap: {
    position: "absolute",
    maxWidth: OVERLAY_W - SHARE_TEXT_X * 2,
  },
  textBase: {
    color: "#FFFFFF",
  },
  logoImg: {
    position: "absolute",
    left: SHARE_TEXT_X,
    height: 36,
    opacity: 0.95,
  },
  logoText: {
    position: "absolute",
    left: SHARE_TEXT_X,
    color: "#FFFFFF",
    fontSize: 28,
    letterSpacing: 4,
  },
});
