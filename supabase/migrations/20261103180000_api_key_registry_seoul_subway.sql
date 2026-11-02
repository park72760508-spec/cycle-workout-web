-- 2026-11-03 서울 열린데이터광장 '실시간 지하철 인증키'(열차 위치·도착정보) 칸 추가 — 루트맵 메뉴 'API 인증키'에서 저장
INSERT INTO public.api_key_registry (name, label) VALUES ('seoul_subway', '서울 실시간 지하철(열린데이터광장)') ON CONFLICT (name) DO NOTHING;
