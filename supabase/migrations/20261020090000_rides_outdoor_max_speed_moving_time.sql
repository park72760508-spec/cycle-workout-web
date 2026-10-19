-- 2026-10-20: 아웃도어 라이딩(GPS) 기록 — 최고 속도·이동 시간(멈춘 시간 제외)
alter table public.rides add column if not exists max_speed_kmh numeric;
alter table public.rides add column if not exists moving_time_sec integer;
comment on column public.rides.max_speed_kmh is '최고 속도(km/h) — STELVIO 아웃도어 라이딩 GPS 기록';
comment on column public.rides.moving_time_sec is '이동 시간(초, 멈춘 시간 제외) — STELVIO 아웃도어 라이딩 GPS 기록';
