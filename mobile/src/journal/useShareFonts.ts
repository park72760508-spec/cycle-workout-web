/**
 * Bebas Neue (라틴·숫자) + Pretendard (한글)
 *
 *   npx expo install expo-font @expo-google-fonts/bebas-neue
 */
import { useCallback, useEffect, useState } from "react";
import * as Font from "expo-font";
import { BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue";

export const FONT_LATIN = "BebasNeue-Regular";
export const FONT_KOREAN = "Pretendard";
export const FONT_KOREAN_BOLD = "Pretendard-Bold";

function pretendardMap(): Record<string, number> | null {
  try {
    return {
      [FONT_KOREAN]: require("../../../assets/fonts/Pretendard-Regular.otf"),
      [FONT_KOREAN_BOLD]: require("../../../assets/fonts/Pretendard-Bold.otf"),
    };
  } catch {
    return null;
  }
}

export function useShareFonts(): {
  fontsReady: boolean;
  fontError: Error | null;
  usingSystemFallback: boolean;
} {
  const [fontsReady, setFontsReady] = useState(false);
  const [fontError, setFontError] = useState<Error | null>(null);
  const [usingSystemFallback, setUsingSystemFallback] = useState(false);

  const load = useCallback(async () => {
    const map: Record<string, number> = {
      [FONT_LATIN]: BebasNeue_400Regular,
    };
    const ko = pretendardMap();
    if (ko) Object.assign(map, ko);

    try {
      await Font.loadAsync(map);
      setFontsReady(true);
    } catch (e: unknown) {
      setFontError(e instanceof Error ? e : new Error("폰트 로드 실패"));
      try {
        await Font.loadAsync({ [FONT_LATIN]: BebasNeue_400Regular });
      } catch {
        /* ignore */
      }
      setUsingSystemFallback(true);
      setFontsReady(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { fontsReady, fontError, usingSystemFallback };
}
