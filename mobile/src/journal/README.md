# Journal — 투명 공유 사진첩 (React Native)

웹 `JournalTransparentShareComposer` + `journalTransparentShare` 이식.

## 설치

```bash
npx expo install expo-image-picker expo-media-library expo-linear-gradient expo-font
npx expo install @expo-google-fonts/bebas-neue react-native-svg react-native-view-shot
```

Composer UI·버튼 배치는 웹 `JournalTransparentShareComposer.jsx` 와 동일합니다.
투명 PNG 디자인만 `ShareOverlayArtboard` / `journalTransparentShare.js` 에서 변경합니다.

## 사용

```tsx
import { JournalTransparentShareComposer } from "./journal";

const [open, setOpen] = useState(false);

<JournalTransparentShareComposer
  visible={open}
  log={rideLog}
  opts={{ logs: dayLogs, dailyRouteDoc }}
  onClose={() => setOpen(false)}
/>
```

## 파일

| 파일 | 역할 |
|------|------|
| `JournalTransparentShareComposer.tsx` | 배경 선택 · Pan/Pinch · ViewShot 저장 |
| `ShareOverlayOffscreen.tsx` | 오프스크린 투명 PNG 생성 |
| `ShareOverlayArtboard.tsx` | 코스선 + 제목 + 하단 5열 통계 |
| `journalShareRoute.ts` | polyline → SVG path |
| `journalShareFormat.ts` | 제목·통계·토큰 폰트 분리 |
