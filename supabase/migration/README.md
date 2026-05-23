# Firestore → Supabase 마이그레이션

`migrateData.ts`는 Firestore 데이터를 1단계 스키마(`public.users`, `rides`, `daily_summaries` 등)로 **배치 이관**합니다.

## 사전 조건 (필수)

### 1. `auth.users` 이관 (`migrateAuthUsers.ts`)

`public.users.id`는 `auth.users(id)` FK입니다. **Firebase Auth → Supabase Auth를 먼저** 실행하세요.

Firebase UID(28자) → `FIREBASE_UID_UUID_MODE=v5`로 **deterministic UUID** (`migrateData.ts`와 동일).

```bash
# .env 에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 추가 (service_role secret)
npm run migrate:auth:dry   # 생성 없이 시뮬레이션
npm run migrate:auth       # Supabase Auth 사용자 생성
```

- Firebase **로그인 비밀번호는 이관 불가** → 임의 비밀번호 생성 후, 앱에서 **비밀번호 재설정/매직링크** 필요
- 이메일 없는 계정: `{firebaseUid}@firebase-migrate.stelvio.local` (고유)
- 실패 로그: `migration_auth_errors.log`

### 2. 환경 변수

```bash
cd supabase/migration
cp .env.example .env
# DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_APPLICATION_CREDENTIALS
npm install
```

`DATABASE_URL`은 Supabase **Direct connection** (Session mode, port 5432) 권장. Pooler도 가능.

### 3. Firestore 인덱스

`collectionGroup` 쿼리(`logs`, `ranking_day_totals` 등)에 필요한 복합 인덱스가 Firebase 콘솔에 있어야 합니다. 없으면 콘솔 링크로 인덱스 생성 후 재실행.

## 소모임·미디어 이관 (`migrate:riding-groups`)

Firestore `stelvio_riding_groups`, `rides` GPX/커버 URL → `riding_groups`, `media_assets`.

**사전:** `migrate` / `migrate:auth`로 `public.users`·`open_rides`가 있어야 합니다.

```bash
npm run schema:riding-groups   # ON CONFLICT용 PK·UNIQUE 복구 (선택, migrate 시 자동 실행)
npm run migrate:riding-groups
```

구버전 `riding_groups`만 있을 때 `firestore_doc_id` / `ON CONFLICT` 오류가 나면 Supabase SQL Editor에서  
`supabase/migrations/20260522140300_riding_groups_migrate_constraints_repair.sql` 실행 후 재시도.

## 실행 순서 (권장)

```bash
npm install
npm run test:db              # DATABASE_URL
npm run migrate:auth:dry     # ① Auth
npm run migrate:auth         # ① Auth 실제 생성
npm run test:db              # auth.users count ↑ 확인
npm run migrate:dry          # ② Firestore 데이터
npm run migrate              # ② Firestore 데이터 실제 이관
```

```bash
# 연결·매핑만 검증 (DB 쓰기 없음)
npm run migrate:dry

# 전체 이관
npm run migrate

# 단계만 실행
MIGRATION_PHASES=users,rides,daily_summaries,refresh_metrics npm run migrate
```

## 처리 순서

| Phase | Firestore | PostgreSQL |
|-------|-----------|------------|
| users | `users/{uid}` | `public.users` |
| strava | users 문서 내 토큰 | `strava_connections` |
| processed_orders | `processed_orders` | `processed_orders` |
| point_history | `point_history` | `point_history` |
| daily_summaries | `users/{uid}/ranking_day_totals` | `daily_summaries` |
| rides | `users/{uid}/logs` | `rides` |
| yearly_peaks | `users/{uid}/yearly_peaks` | `yearly_peaks` |
| friends | `users/{uid}/friends` | `user_friends` |
| orders | `users/{uid}/orders` | `user_orders` |
| open_rides | `rides/{id}` (오픈 라이딩) | `open_rides`, `open_ride_participants` |
| refresh_metrics | — | `fn_refresh_user_ranking_metrics` + MV refresh |

- 배치 크기: `MIGRATION_BATCH_SIZE` (기본 1000)
- `rides` / `daily_summaries` 대량 적재 시 트리거 비활성화 후 마지막에 `refresh_metrics`로 집계

## 에러 로그

실패 건은 `migration_errors.log`에 기록되고 **다음 배치는 계속** 진행됩니다.

## 성능

- 기본: PostgreSQL `COPY FROM STDIN` (고속)
- `ON CONFLICT` 필요 시: 다중 `INSERT` 폴백

## 주의

- `gemini_api_key` 등 민감 필드는 이관하지 않습니다.
- `ranking_aggregates`, `cache` 등 랭킹 캐시 컬렉션은 제외합니다 (DB MV로 대체).
- 재실행 시 `ON CONFLICT` / `DO NOTHING`으로 중복 최소화.
