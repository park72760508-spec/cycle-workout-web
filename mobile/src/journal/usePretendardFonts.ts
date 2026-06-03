/**
 * Pretendard 임베딩 — expo-font
 *
 *   npx expo install expo-font expo-splash-screen
 *
 * 앱 루트 App.tsx 예시:
 *   const { fontsReady } = usePretendardFonts();
 *   if (!fontsReady) return null;
 */
import { useCallback, useEffect, useState } from "react";
import * as Font from "expo-font";

export const PRETENDARD = {
  regular: "Pretendard",
  bold: "Pretendard-Bold",
  extraBold: "Pretendard-ExtraBold",
} as const;

type FontMap = Record<string, number | import("expo-font").FontResource>;

/** 번들에 폰트가 없을 때 require 실패를 막기 위한 optional 로더 */
function pretendardFontMap(): FontMap | null {
  try {
    return {
      [PRETENDARD.regular]: require("../../../assets/fonts/Pretendard-Regular.otf"),
      [PRETENDARD.bold]: require("../../../assets/fonts/Pretendard-Bold.otf"),
      [PRETENDARD.extraBold]: require("../../../assets/fonts/Pretendard-ExtraBold.otf"),
    };
  } catch {
    return null;
  }
}

export function usePretendardFonts(): {
  fontsReady: boolean;
  fontError: Error | null;
  usingSystemFallback: boolean;
} {
  const [fontsReady, setFontsReady] = useState(false);
  const [fontError, setFontError] = useState<Error | null>(null);
  const [usingSystemFallback, setUsingSystemFallback] = useState(false);

  const load = useCallback(async () => {
    const map = pretendardFontMap();
    if (!map) {
      setUsingSystemFallback(true);
      setFontsReady(true);
      return;
    }
    try {
      await Font.loadAsync(map);
      setFontsReady(true);
    } catch (e: unknown) {
      setFontError(e instanceof Error ? e : new Error("Pretendard 로드 실패"));
      setUsingSystemFallback(true);
      setFontsReady(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { fontsReady, fontError, usingSystemFallback };
}
