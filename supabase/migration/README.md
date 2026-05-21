# Firestore → Supabase 마이그레이션

`migrateData.ts`는 Firestore 데이터를 1단계 스키마(`public.users`, `rides`, `daily_summaries` 등)로 **배치 이관**합니다.

## 사전 조건 (필수)

### 1. `auth.users` 이관

`public.users.id`는 `auth.users(id)` FK입니다. **Firebase Auth 사용자를 Supabase Auth로 먼저 옮긴 뒤** 본 스크립트를 실행하세요.

Firebase UID(28자)는 UUID가 아닙니다. 기본 설정 `FIREBASE_UID_UUID_MODE=v5`는 동일 UID → 동일 UUID로 변환합니다.

**Auth 이관 시에도 같은 v5 규칙**을 써야 합니다. 예: Firebase UID `Ys8GQZYy...` → `uuidv5(uid, STELVIO_UID_NAMESPACE)`.

### 2. 환경 변수

```bash
cd supabase/migration
cp .env.example .env
# DATABASE_URL, GOOGLE_APPLICATION_CREDENTIALS 설정
npm install
```

`DATABASE_URL`은 Supabase **Direct connection** (Session mode, port 5432) 권장. Pooler도 가능.

### 3. Firestore 인덱스

`collectionGroup` 쿼리(`logs`, `ranking_day_totals` 등)에 필요한 복합 인덱스가 Firebase 콘솔에 있어야 합니다. 없으면 콘솔 링크로 인덱스 생성 후 재실행.

## 실행

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
