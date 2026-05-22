# Stelvio React Native — Dual-Write DB Layer

Strangler Fig Pattern **3단계**: Firestore(Primary) + Supabase(Secondary) 동시 기록, 읽기는 Firestore만.

## 구조

```
mobile/src/services/db/
  dbService.ts       # 공개 API
  dualWrite.ts       # Promise.allSettled 격리
  supabaseWriter.ts  # rides / users INSERT·UPDATE
  mappers.ts         # Firestore 필드 → PostgreSQL (마이그레이션 mappers와 동일 규칙)
  firebasePorts.example.ts
```

## 설치 (RN 앱 루트)

```bash
npm install @supabase/supabase-js @react-native-async-storage/async-storage uuid
# 이 폴더를 앱에 복사하거나 workspace 패키지로 링크
```

## 초기화

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  initDbService,
  saveTrainingSession,
  getUserTrainingLogs,
  createDefaultErrorReporter,
} from "./services/db";
import { createFirebasePorts } from "./services/db/firebasePorts.example";

initDbService({
  firebase: createFirebasePorts(),
  authStorage: AsyncStorage,
  config: {
    dualWriteEnabled: true,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    uidNamespace: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    uidMode: "v5",
    errorReporter: createDefaultErrorReporter({
      sentry: Sentry, // @sentry/react-native 설치 시
    }),
  },
});
```

## Dual-Write 동작

| API | Firebase | Supabase | 패턴 |
|-----|----------|----------|------|
| `saveTrainingSession` | 트랜잭션 (logs + users) | `rides` upsert + `users` patch | Primary → Secondary |
| `saveStravaActivity` | logs.add | `rides` upsert | `Promise.allSettled` 병렬 |
| `updateUserProfile` | users.update | `users` update | 병렬 |
| `getUserTrainingLogs` | only | — | 읽기 Firebase |
| `getUserProfile` | only | — | 읽기 Firebase |

- **Supabase 실패**: UI/ Firebase 결과에 영향 없음. `errorReporter` → 콘솔 + Sentry/Crashlytics.
- **Supabase 세션 없음**: `SupabaseWriteSkippedError` — 리포트 없이 스킵 (Firebase Auth만 쓰는 구간).

## Supabase Auth (RLS)

클라이언트 dual-write는 **Publishable(anon) 키 + 로그인된 Supabase 세션**이 필요합니다.

- 마이그레이션된 `auth.users.id` = `uuidv5(firebaseUid, STELVIO_UID_NAMESPACE)`
- 앱에서 Supabase `signInWithPassword` / 매직링크 등으로 동일 사용자 세션 확보 후 dual-write 활성화
- Service Role 키는 **앱에 넣지 마세요**

## 환경 변수 (앱)

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...   # Publishable key
EXPO_PUBLIC_DUAL_WRITE_ENABLED=true
```

## 타입 검사

```bash
cd mobile && npm install && npm run typecheck
```
