-- 중고랜드 택배 조회 주기 보정(2026-10-29)
-- 예전: 30분마다(7,37분) 호출 + 함수 안에서 '마지막 조회 후 30분 이내면 건너뛰기' →
--       앞 조회가 몇 초 늦게 끝나면 다음 회차가 29분 59초로 건너뛰어 실제로는 1시간마다 조회(배송완료 1시간+ 지연).
-- 지금: 10분마다 호출. 함수가 송장별로 판단 — 배송 출발(오늘 도착 예정)은 10분마다, 그 밖의 배송 중은 30분마다,
--       배송완료는 다시 조회하지 않는다(외부 API 호출 수는 배송 출발 구간에서만 늘어남).
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'market-check-delivery-tracker'),
  schedule := '*/10 * * * *'
);

-- 응답 대기 30초(pg_net 기본 5초) — 함수가 새로 켜질 때·송장 여러 건 조회 시 5초를 넘어 '시간 초과'로 기록되던 것 방지
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'market-check-delivery-tracker'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://eacrwhtbdqanaxpicqsm.supabase.co/functions/v1/market-check-delivery-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'market_cron_auth_token' LIMIT 1
      )
    ),
    body := '{"mode":"tracker"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cmd$
);
