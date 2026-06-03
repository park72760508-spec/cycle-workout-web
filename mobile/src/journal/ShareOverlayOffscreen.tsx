/**
 * 오프스크린 ViewShot — 투명 PNG 오버레이 생성 (createOverlayPngBlob 대응)
 */
import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import ViewShot from "react-native-view-shot";
import { ShareOverlayArtboard } from "./ShareOverlayArtboard";
import { buildCoursePathsForOverlay } from "./journalShareRoute";
import type { ShareLog, ShareOverlayOpts } from "./journalShareTypes";
import { OVERLAY_H, OVERLAY_W } from "./journalShareTypes";
import { useShareFonts } from "./useShareFonts";
import type { ImageSourcePropType } from "react-native";

type Props = {
  log: ShareLog;
  opts?: ShareOverlayOpts;
  logoSource?: ImageSourcePropType;
  onReady: (uri: string) => void;
  onError: (message: string) => void;
};

export function ShareOverlayOffscreen({
  log,
  opts,
  logoSource,
  onReady,
  onError,
}: Props) {
  const shotRef = useRef<ViewShot>(null);
  const { fontsReady, usingSystemFallback } = useShareFonts();
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
  }, [log, opts?.logs, opts?.dailyRouteDoc]);

  useEffect(() => {
    if (!fontsReady || firedRef.current) return;

    const paths = buildCoursePathsForOverlay(log, {
      ...opts,
      width: OVERLAY_W,
      height: OVERLAY_H,
    });
    if (!paths.length) {
      onError("코스 데이터가 없어 공유 이미지를 만들 수 없습니다.");
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const uri = await shotRef.current?.capture?.({
          format: "png",
          quality: 1,
          result: "tmpfile",
        });
        if (!uri) throw new Error("오버레이 캡처 실패");
        firedRef.current = true;
        onReady(uri);
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : "오버레이 생성 실패");
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [fontsReady, log, opts, onReady, onError, usingSystemFallback]);

  if (!fontsReady) return null;

  return (
    <View style={styles.offscreen} pointerEvents="none" collapsable={false}>
      <ViewShot
        ref={shotRef}
        options={{ format: "png", quality: 1 }}
        style={{ backgroundColor: "transparent" }}
      >
        <ShareOverlayArtboard
          log={log}
          opts={opts}
          logoSource={logoSource}
          usingSystemFallback={usingSystemFallback}
        />
      </ViewShot>
    </View>
  );
}

const styles = StyleSheet.create({
  offscreen: {
    position: "absolute",
    left: -20000,
    top: 0,
    width: OVERLAY_W,
    height: OVERLAY_H,
    opacity: 1,
  },
});
