-- =====================================================================
--  Обновление 017: карточку «Подтверждение номера гостей» видят и управляющие точек
--  (раньше — только владелец). Можно запускать повторно.
-- =====================================================================
create or replace function public.verify_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - interval '24 hours';
begin
  if not public.is_admin() then raise exception 'Только для управляющих'; end if;
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
