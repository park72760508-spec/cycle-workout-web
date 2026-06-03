/**
 * 투명 PNG — 상단(로고·날짜·제목) 1080×520
 */
import React, { useState } from "react";
import { Image, ImageSourcePropType, StyleSheet, Text, View } from "react-native";
import {
  SHARE_LAYOUT,
  estimateShareLogoWidth,
  formatShareHeaderSub,
  formatShareHeaderTitle,
  tokenizeShareText,
  type TextToken,
} from "./journalShareFormat";
import type { ShareLog, ShareOverlayOpts } from "./journalShareTypes";
import { FONT_KOREAN, FONT_LATIN } from "./useShareFonts";

const L = SHARE_LAYOUT;
const W = 1080;
const H = L.headerH;

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

function fontForToken(kind: TextToken["kind"], fb: boolean) {
  if (fb) return { family: "System", weight: kind === "lat" ? ("700" as const) : ("600" as const) };
  return { family: kind === "lat" ? FONT_LATIN : FONT_KOREAN, weight: undefined };
}

function CenteredLine({
  text,
  top,
  fontSize,
  opacity = 1,
  extraBold,
  usingSystemFallback,
}: {
  text: string;
  top: number;
  fontSize: number;
  opacity?: number;
  extraBold?: boolean;
  usingSystemFallback: boolean;
}) {
  const tokens = tokenizeShareText(text);
  return (
    <View style={[styles.line, { top }]}>
      <Text style={[styles.center, TEXT_SHADOW, { fontSize, opacity }]}>
        {tokens.map((tok, i) => {
          const f = fontForToken(tok.kind, usingSystemFallback);
          return (
            <Text
              key={i}
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

export function ShareOverlayHeaderArtboard({
  log,
  opts,
  logoSource,
  usingSystemFallback = false,
}: Props) {
  const shareLogs = opts?.logs || log._logsForShare || null;
  const sub = formatShareHeaderSub(log);
  const title = formatShareHeaderTitle(log, shareLogs);
  const logoW = estimateShareLogoWidth(log);
  const [logoH, setLogoH] = useState(Math.max(32, Math.round(logoW * 0.2)));
  const subY = L.logoTop + logoH + L.subGapBelowLogo;
  const titleY = subY + L.titleGapBelowSub;

  return (
    <View style={[styles.root, { width: W, height: H }]}>
      {logoSource ? (
        <Image
          source={logoSource}
          style={{
            position: "absolute",
            top: L.logoTop,
            left: (W - logoW) / 2,
            width: logoW,
            height: logoH,
          }}
          resizeMode="contain"
          onLoad={(e) => {
            const { width, height } = e.nativeEvent.source;
            if (width > 0 && height > 0) setLogoH(Math.round(logoW * (height / width)));
          }}
        />
      ) : null}
      {sub ? (
        <CenteredLine
          text={sub}
          top={subY}
          fontSize={L.fontSub}
          opacity={0.78}
          usingSystemFallback={usingSystemFallback}
        />
      ) : null}
      <CenteredLine
        text={title}
        top={titleY}
        fontSize={L.fontTitle}
        extraBold
        usingSystemFallback={usingSystemFallback}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "transparent", overflow: "hidden" },
  line: { position: "absolute", left: L.padX, right: L.padX, alignItems: "center" },
  center: { color: "#FFFFFF", textAlign: "center" },
});
