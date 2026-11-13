-- =====================================================================
--  Обновление 016: контроль подтверждения номера гостей
--  • service_health — состояние сервисов подтверждения: 'call' (звонок New-Tel), 'telegram' (бот).
--    Пишет функция verify при каждой попытке гостя: получилось / ошибка сервиса.
--    При первой ошибке — тревога в Telegram владельца (не чаще раза в 30 минут),
--    при восстановлении — «снова работает».
--  • verify_health() — карточка для владельца в админке: состояние + статистика за сутки.
--  Можно запускать повторно.
-- =====================================================================

create table if not exists public.service_health (
  service       text primary key,          -- 'call' | 'telegram'
  ok            boolean not null default true,
  last_ok_at    timestamptz,
  last_error    text,
  last_error_at timestamptz,
  down_since    timestamptz,               -- с какого момента не работает (null — работает)
  fail_streak   int not null default 0,
  alerted_at    timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.service_health enable row level security;
drop policy if exists "service health admin read" on public.service_health;
create policy "service health admin read" on public.service_health for select to authenticated using (public.is_admin());

-- карточка «Подтверждение номера гостей» для владельца
create or replace function public.verify_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - interval '24 hours';
begin
  if not public.is_owner() then raise exception 'Только владелец'; end if;
  return jsonb_build_object(
    'services', coalesce((select jsonb_object_agg(service, jsonb_build_object(
        'ok', ok, 'last_ok_at', last_ok_at, 'last_error', last_error, 'last_error_at', last_error_at,
        'down_since', down_since, 'fail_streak', fail_streak)) from public.service_health), '{}'::jsonb),
    'call', jsonb_build_object(
        'total',   (select count(*) from public.phone_incoming where created_at > since),
        'success', (select count(*) from public.phone_incoming where created_at > since and status in ('done','login')),
        'no_call', (select count(*) from public.phone_incoming where created_at > since and status = 'failed' and coalesce(message,'') like 'Звонок не поступил%'),
        'last_success', (select max(created_at) from public.phone_incoming where status in ('done','login'))),
    'telegram', jsonb_build_object(
        'total',   (select count(*) from public.phone_links where created_at > since),
        'success', (select count(*) from public.phone_links where created_at > since and status in ('done','login')),
        'last_success', (select max(created_at) from public.phone_links where status in ('done','login'))),
    'checked_at', now());
end $$;
grant execute on function public.verify_health() to authenticated;
revoke execute on function public.verify_health() from anon;
