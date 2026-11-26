-- 033: «только по QR» для штампов.
-- Плагин при закрытии чека шлёт номер карты (QR к тому времени устарел), поэтому проверка
-- PK1 в pos_lunch_close (032) отсекала все штампы. Теперь: pos_lunch_info запоминает, что гость
-- был отсканирован по QR (lunch_qr_scans), а pos_lunch_close засчитывает штамп, если такой скан
-- был за последние 12 часов. Код функций — как применён миграцией 033_lunch_qr_scans в Supabase.
create table if not exists public.lunch_qr_scans (
  user_id uuid primary key,
  scanned_at timestamptz not null default now()
);
alter table public.lunch_qr_scans enable row level security;
-- pos_lunch_info: при p_code like 'PK1:%' — upsert в lunch_qr_scans
-- pos_lunch_close: вместо «p_code like 'PK1:%'» — «PK1 или скан этого гостя за 12 часов»
