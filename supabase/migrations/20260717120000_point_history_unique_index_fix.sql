-- point_history upsert가 ON CONFLICT (user_id, firebase_log_id)로 42P10을 던지는 문제 수정.
-- 원인: 기존 인덱스가 partial(WHERE firebase_log_id IS NOT NULL AND firebase_log_id <> '')이라
-- 조건 없는 ON CONFLICT와 매칭되지 않음. 이 테이블을 쓰는 유일한 코드(supabaseIndoorWriteServer.js)는
-- firebase_log_id가 없으면 항상 NULL로 정규화해서 쓰므로(빈 문자열 '' 사용 안 함),
-- 다른 테이블들과 동일하게 non-partial unique index로 바꿔도 기존 동작에 영향 없음
-- (Postgres는 NULL끼리 유니크 충돌시키지 않음).
DROP INDEX IF EXISTS public.uq_point_history_user_firebase_log;
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_history_user_firebase_log
  ON public.point_history (user_id, firebase_log_id);
