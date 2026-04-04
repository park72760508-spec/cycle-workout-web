# 오픈 라이딩 GPX — 정적 미리보기 + 상호작용 지도 (발열 최소화) 설계

문서 목적: 상세·생성·수정 화면의 코스 블록에서 **기본은 저부하 정적 미리보기**, 사용자가 원할 때만 **Leaflet 상호작용 지도**를 켜는 구현을 위한 필드·흐름·스냅샷 시점을 코드 수준으로 고정한다.

---

## 1. 원칙

| 모드 | 지도 | 고도 | 부하 |
|------|------|------|------|
| **기본(권장)** | 정적 이미지 1장 (`<img>` 또는 CSS `background`) | 정적 이미지 1장 또는 인라인 SVG | 타일·Canvas 애니메이션 없음 → 발열 최소 |
| **옵션** | Leaflet + OSM (현행과 동일) | Chart.js 라인 (현행과 동일) | 사용자가 「상호작용 지도」 탭/버튼으로 전환 시에만 마운트 |

- **한 번 업로드/저장 후**: 서버 또는 클라이언트가 **미리보기 자산**을 생성·저장해 두고, 조회 시에는 **URL만 로드**한다.
- **레거시 라이딩**: 미리보기 필드가 없으면 **현재 동작(즉시 Leaflet)** 또는 “미리보기 생성 중” 폴백 정책을 택한다(구현 시 플래그로 제어).

---

## 2. Firestore `rides` 문서 필드 (제안)

기존 `gpxUrl` / Storage 경로는 유지. 아래는 **추가·옵션** 필드(카멜케이스, `openRidingService` normalize와 동일 스타일 권장).

| 필드명 | 타입 | 설명 |
|--------|------|------|
| `gpxUrl` | string | 기존: GPX 또는 파생물의 **원본 링크**(현행 유지). |
| `coursePreviewMapUrl` | string | **코스 오버레이가 포함된 정적 지도** 이미지 HTTPS URL (Storage download URL 또는 CDN). |
| `coursePreviewMapPath` | string | Storage 내 경로 (예: `openRiding/{rideId}/preview_map.webp`). URL 재발급용. |
| `coursePreviewElevUrl` | string | **고도 프로파일** 정적 이미지 URL (PNG/WebP). |
| `coursePreviewElevPath` | string | Storage 경로. |
| `coursePreviewUpdatedAt` | timestamp | 미리보기 마지막 생성 시각 (디버깅·무효화). |
| `coursePreviewBounds` | map | 선택: `{ north, south, east, west }` (WGS84). 정적 타일/리프레시 검증용. |
| `coursePreviewMeta` | map | 선택: `{ mapWidthPx, mapHeightPx, elevWidthPx, elevHeightPx }`. |

**클라이언트 전용(저장 불필요)**

- `showInteractiveMap`: 로컬 state 또는 `sessionStorage` — “이번 세션에서 상호작용 지도 열어둠” 정도만.

---

## 3. Storage 레이아웃 (제안)

버킷은 기존 오픈 라이딩 GPX와 동일 프로젝트 사용.

```
openRiding/
  {rideId}/
    course.gpx              ← 기존 GPX (또는 기존 규칙 유지)
    preview_map.webp        ← 정적 지도 (권장: WebP, 가로 800~1200px)
    preview_elevation.webp  ← 고도 그래프
```

- **파일명 규칙**: 위 고정 또는 `preview_v1_map.webp` 형태로 버전 접두사 가능(캐시 무효화).

---

## 4. 스냅샷을 “어디서” 찍을지

### A. 서버 측 (권장, 일관성·보안)

- **트리거**: GPX 업로드 완료 후 Cloud Storage `onFinalize` 또는 `createRide` / `updateRideByHost` 내 비동기 작업.
- **처리**:
  1. GPX 파싱(백엔드는 `parseGpxToTrack`와 동일 알고리즘 또는 라이브러리).
  2. bbox 계산 → **정적 맵 API** 한 번 호출(예: Mapbox Static Images, Google Static Maps, 자체 Mapnik)에 폴리라인 인코딩.
  3. 고도:** 서버에서 SVG/Canvas 렌더 후 `png`/`webp` 업로드 (또는 클라이언트와 동일 차트 로직을 headless로 실행).
  4. `coursePreviewMapUrl` 등 Firestore 업데이트.

**장점**: 모바일 CPU 0, 재방문 시 항상 가벼움. **단점**: 외부 정적맵 API 키·과금.

### B. 클라이언트 측 (업로드 직후 1회)

- **시점**: 호스트가 **생성/수정 화면에서 GPX 선택 후**, Leaflet이 **한 번** `fitBounds`까지 끝난 뒤 `requestAnimationFrame` 2프레임 지연 뒤.
- **방법**:
  - **`html2canvas(map.getContainer())`**: 의존성·품질 이슈.
  - **Leaflet `map.dragging` 끄고 `leaflet-image` / `dom-to-image`**: 실험적.
  - **가장 단순**: 숨겨진 canvas에 polyline만 그리고 배경은 단색 또는 1장 static 타일 합성(구현 비용 중간).

생성된 Blob을 `uploadBytes`로 Storage에 올리고, 저장 API에서 `coursePreviewMapPath`만 기록.

**장점**: 서버 인프라 최소. **단점**: 호스트 기기에서 1회 발열·실패 시 재시도 UX 필요.

### C. 온디맨드(비권장)

- 상세 진입마다 스냅샷 → 발열·지연 반복. **기본 정책으로는 사용하지 않음.**

---

## 5. UI/상태 머신 (상세·생성·수정 공통)

1. `coursePreviewMapUrl` **있음** → 기본 UI: 지도 영역 `<img src={coursePreviewMapUrl}>` + 고도 `<img>` + 보조 문구 “정적 미리보기 · 데이터 절약”.
2. **「상호작용 지도로 보기」** 클릭 → `showInteractiveMap = true` → `OpenRidingGpxCoursePanel`의 **Leaflet + Chart** 경로 마운트(현재 구현 재사용).
3. **「정적 미리보기로 돌아가기」** → Leaflet `remove()`, Chart `destroy()`, state false → 이미지만 유지.
4. 미리보기 URL **없고** GPX만 있음 → 정책: (a) 즉시 상호작용만 표시(현행), 또는 (b) “미리보기 생성 중” 스켈레톤 후 백그라운드 생성.

---

## 6. `openRidingService.js` / API

- **`normalizeRide`**: 위 신규 필드를 그대로 통과.
- **`createRide` / `updateRideByHost`**: GPX 변경 시 `coursePreview*` 무효화(필드 삭제 또는 `coursePreviewUpdatedAt`만 갱신 후 백그라운드 재생성).
- **선택 함수**: `scheduleCoursePreviewGeneration(rideId)` — Cloud Task.

---

## 7. 보안·캐시

- Storage 규칙: 기존 GPX와 동일 주체(인증 사용자/규칙)로 읽기 허용.
- 미리보기 이미지는 **공개 URL이어도** 코스 정보만 노출(민감성 낮음). 필요 시 signed URL + 짧은 TTL.

---

## 8. 구현 단계(권장 순서)

1. Firestore·타입·normalize에 필드 추가(읽기만).
2. 상세 UI: 미리보기 있으면 `<img>` 분기 + 토글 state.
3. 클라이언트 1회 캡처 업로드(또는 Functions) 중 택1.
4. 레거시 라이딩 마이그레이션 스크립트(선택).

---

## 9. 관련 코드 위치 (현행)

- GPX 패널: `OpenRidingScreens.jsx` — `OpenRidingGpxCoursePanel`
- 파싱: `openRidingGpx.js` — `parseGpxToTrack`
- 업로드/문서 필드: `openRidingService.js`

이 문서는 구현 시 동료 리뷰·API 계약의 단일 참조로 사용한다.
