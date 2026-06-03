/**
 * 오프스크린 ViewShot — 상단·하단 투명 PNG 2장
 */
import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import ViewShot from "react-native-view-shot";
import { ShareOverlayBottomArtboard } from "./ShareOverlayBottomArtboard";
import { ShareOverlayHeaderArtboard } from "./ShareOverlayHeaderArtboard";
import { buildCoursePathsForOverlay } from "./journalShareRoute";
import { SHARE_LAYOUT } from "./journalShareFormat";
import type { ShareLog, ShareOverlayOpts } from "./journalShareTypes";
import { useShareFonts } from "./useShareFonts";
import type { ImageSourcePropType } from "react-native";

export type OverlayBlobPair = {
  headerUri: string;
  bottomUri: string;
  splitMeta: { fullW: number; headerH: number; bottomH: number };
};

type Props = {
  log: ShareLog;
  opts?: ShareOverlayOpts;
  logoSource?: ImageSourcePropType;
  onReady: (result: OverlayBlobPair) => void;
  onError: (message: string) => void;
};

export function ShareOverlayOffscreen({
  log,
  opts,
  logoSource,
  onReady,
  onError,
}: Props) {
  const headerShotRef = useRef<ViewShot>(null);
  const bottomShotRef = useRef<ViewShot>(null);
  const { fontsReady, usingSystemFallback } = useShareFonts();
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
  }, [log, opts?.logs, opts?.dailyRouteDoc]);

  useEffect(() => {
    if (!fontsReady || firedRef.current) return;
    const paths = buildCoursePathsForOverlay(log, opts);
    if (!paths.length) {
      onError("코스 데이터가 없어 공유 이미지를 만들 수 없습니다.");
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const headerUri = await headerShotRef.current?.capture?.({
          format: "png",
          quality: 1,
          result: "tmpfile",
        });
        const bottomUri = await bottomShotRef.current?.capture?.({
          format: "png",
          quality: 1,
          result: "tmpfile",
        });
        if (!headerUri || !bottomUri) throw new Error("오버레이 캡처 실패");
        firedRef.current = true;
        onReady({
          headerUri,
          bottomUri,
          splitMeta: {
            fullW: 1080,
            headerH: SHARE_LAYOUT.headerH,
            bottomH: SHARE_LAYOUT.bottomH,
          },
        });
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : "오버레이 생성 실패");
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [fontsReady, log, opts, onReady, onError, usingSystemFallback]);

  if (!fontsReady) return null;

  return (
    <View style={styles.offscreen} pointerEvents="none" collapsable={false}>
      <ViewShot ref={headerShotRef} options={{ format: "png", quality: 1 }}>
        <ShareOverlayHeaderArtboard
          log={log}
          opts={opts}
          logoSource={logoSource}
          usingSystemFallback={usingSystemFallback}
        />
      </ViewShot>
      <ViewShot ref={bottomShotRef} options={{ format: "png", quality: 1 }}>
        <ShareOverlayBottomArtboard log={log} opts={opts} usingSystemFallback={usingSystemFallback} />
      </ViewShot>
    </View>
  );
}

const styles = StyleSheet.create({
  offscreen: {
    position: "absolute",
    left: -20000,
    top: 0,
    opacity: 1,
  },
});
