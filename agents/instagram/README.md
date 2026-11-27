# STELVIO 인스타그램 주간 에이전트 (@stelvioai)

매주 월요일 09:00 KST 에 자동으로 **기획 → 앱 화면 녹화+자막 릴스 제작 → 승인 요청**까지 하고, 사람이 승인하면 **예약 시각에 게시**합니다.

```
월 09:00  instagram-weekly  지난주 성과 수집 → Claude 가 릴스 2개 기획 → Playwright 로 실제 앱 화면 녹화
                            → ffmpeg 로 9:16 + 자막 → Supabase 공개 버킷 업로드 → "[인스타 초안] 2026-W49" Issue 생성
승인      Issue 에 `ig-approved` 라벨 → 해당 주차 승인
화·금 19:00  instagram-publish  (3시간마다 확인) 승인 + 게시 시각 도래 → 릴스 게시 → queue/*.json 에 링크 기록
```

## 운영 방식: 반자동(기본) / 자동 게시(선택)
- **반자동(인스타 연결 정보 없음)**: 월요일 09:00 에 기획 → 영상 제작 → GitHub Issue 에 영상 미리보기·캡션 업로드까지만 합니다. **Issue 의 링크에서 영상을 폰에 저장해 Instagram 앱에서 직접 올리세요.** 게시 워크플로(`instagram-publish`)는 연결 정보가 없으면 아무것도 하지 않고 정상 종료합니다. 필요한 비밀값: `ANTHROPIC_API_KEY`, Supabase 2개, GitHub 토큰.
- **자동 게시**: `IG_USER_ID`·`IG_ACCESS_TOKEN` 을 등록하면 켜집니다(아래 Meta 설정 참고). 이후엔 Issue 승인(`ig-approved`) 후 예약 시각에 자동 게시됩니다.
- 2026-11 기준 `stelvioai` 의 Meta 비즈니스 포트폴리오가 "자동화 사용" 으로 제한돼(검토 기각) Facebook 페이지 연결이 막혀 있어 반자동으로 운영합니다. 제한이 풀리거나 제한 없는 새 인스타 계정을 쓰게 되면 자동 게시로 전환하세요.

## 앱에서 관리하기 (권장)
STELVIO **관리자 로그인 → 환경설정 → 인스타그램 업로드 → "인스타그램 설정·영상 게시하기"** 에서 아래를 모두 할 수 있습니다.
- **연결 정보 입력**: GitHub 토큰 + 비밀값 5개(Claude 키, 인스타 계정 ID·토큰, Supabase URL·서비스 키). 서버가 실제 연결을 확인한 뒤 GitHub 저장소 비밀값으로 암호화 등록합니다(저장 후 화면에 다시 표시되지 않음).
- **영상 게시하기**: 이번 주 기획·영상 만들기 / 샘플 영상 시험 / 게시 시각 확인·게시
- **게시 현황·승인**: 주차별 영상 미리보기·캡션·상태, **승인 버튼**(= Issue 에 `ig-approved` 라벨)
- GitHub 토큰은 Fine-grained 토큰(저장소 cycle-workout-web · Actions·Secrets·Issues 읽기/쓰기, Contents·Metadata 읽기)이며 서버 전용 컬렉션 `adminSecrets` 에만 저장됩니다.

아래는 같은 일을 수동으로 하는 방법입니다.

## 처음 한 번 설정

### 1. Meta(Instagram Graph API) — 페이지 연결 프로 계정 기준
1. <https://developers.facebook.com> → 앱 만들기(유형: 비즈니스) → 제품 **Instagram Graph API** 추가
2. [Graph API 탐색기](https://developers.facebook.com/tools/explorer)에서 권한 선택 후 사용자 토큰 발급:
   `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`
3. 장기 토큰으로 교환: `GET /oauth/access_token?grant_type=fb_exchange_token&client_id={앱ID}&client_secret={앱시크릿}&fb_exchange_token={사용자토큰}`
4. **만료 없는 페이지 토큰**: 위 장기 토큰으로 `GET /me/accounts` → 해당 페이지의 `access_token` → 이 값이 `IG_ACCESS_TOKEN`
5. 인스타 계정 ID: `GET /{페이지ID}?fields=instagram_business_account` → `IG_USER_ID`
6. 동작 확인: `IG_USER_ID=… IG_ACCESS_TOKEN=… node -e "import('./lib/graph.mjs').then(m=>m.checkToken()).then(console.log)"` → `username: stelvioai` 가 나오면 성공

> Instagram 로그인 방식 토큰(graph.instagram.com)을 쓴다면 `GRAPH_HOST=https://graph.instagram.com/v23.0` 를 지정하세요. 이 토큰은 60일마다 갱신해야 하는데 갱신 기능은 아직 없습니다 — 페이지 토큰 방식을 권장합니다.

### 2. 저장소 비밀값 (GitHub → Settings → Secrets, 또는 `gh secret set 이름`)
| 이름 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | 주간 기획용 Claude API 키 |
| `IG_USER_ID` / `IG_ACCESS_TOKEN` | 위 5·4 단계 값 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | 영상 업로드용(서비스 롤 키는 절대 공개 금지) |
| `STELVIO_STORAGE_STATE` | (선택) 촬영용 로그인 세션(아래 3) — 로그인 없이 보이는 화면만 쓰면 불필요 |

### 3. (선택) 촬영용 로그인 세션
워크아웃 목록·그래프·작성 화면은 **로그인 없이도** 공개 데이터로 녹화됩니다(dry-run 으로 확인). 훈련일지처럼 로그인이 필요한 장면을 쓸 때만 설정하세요.
영상에는 **그 계정의 화면이 그대로** 찍힙니다. 개인정보가 없는 **촬영 전용 테스트 계정**을 쓰세요(관리자·개인 계정 금지).
```bash
cd agents/instagram && npm install && npx playwright install chromium
npm run login          # 열린 브라우저에서 로그인 → 터미널에서 Enter
base64 -i storage-state.json | gh secret set STELVIO_STORAGE_STATE
```
세션이 만료되면(영상에 로그인 화면이 찍힘) 다시 실행하세요.

### 4. 영상 파이프라인 시험
Actions → **Instagram weekly agent** → Run workflow → `mode = dry-run` : 샘플 기획으로 녹화·합성만 하고 mp4 를 아티팩트로 받아 확인합니다(게시·업로드·Issue 없음).

## 운영
- **승인**: 월요일 Issue 의 캡션·영상 미리보기를 확인하고 `ig-approved` 라벨. 올리지 않을 주차는 `queue/<주차>.json` 의 `status` 를 `rejected` 로.
- **수정**: 캡션·게시 시각은 `queue/<주차>.json` 에서 직접 고칠 수 있습니다(승인 전).
- **게시 이력·링크**: `queue/<주차>.json` (`status`, `permalink`, 실패 시 `error`)
- **설정**: `config.json` — 주당 릴스 수(`reelsPerWeek`), 게시 요일·시각(`slots`, KST), 톤, 공통 해시태그, 장면 카탈로그
- **새 화면 장면 추가**: `config.json` 의 `catalog` 에 `id/title/summary/steps` 추가. 기획은 이 카탈로그의 장면만 사용합니다.
  steps: `{screen}` `{eval}` `{click}` `{wait}` `{scroll}`

## 안전장치
- **개인정보**: 랭킹·중고랜드처럼 다른 회원의 이름·프로필·판매글이 보이는 장면은 `enabled:false` 로 기본 제외. 켜기 전에 반드시 노출 범위를 검토하세요.
- **사람 승인 필수**: 승인 전에는 어떤 것도 게시되지 않습니다.
- **카탈로그 밖 장면·기능 단정 금지**: 기획 결과가 카탈로그에 없는 장면을 쓰거나 자막이 비면 거부하고 재시도합니다.
- 게시 직후 상태를 바로 저장하고 워크플로를 하나씩만 실행(concurrency)해 중복 게시를 막습니다.

## 한계
- 릴스(영상)만 지원합니다. 이미지 카드·스토리는 미구현.
- 영상은 540×960 으로 녹화해 1080×1920 으로 확대합니다(선명도 한계). 배경음악 없음(무음 트랙).
- Instagram API 는 하루 게시 한도(24시간 100건)·릴스 길이/용량 제한이 있습니다.
