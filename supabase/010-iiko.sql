-- =====================================================================
--  Обновление 010: баллы по чекам iiko
--  • iiko_checks — какие чеки iiko уже проведены (один чек — один гость, один раз)
--  • loyalty_settings.iiko_excluded — позиции и группы меню iiko «без баллов» (акции)
--  • iiko_apply — проводит чек (вызывает только серверная функция iiko)
-- =====================================================================

alter table public.loyalty_settings add column if not exists iiko_excluded jsonb not null default '[]'::jsonb;

create table if not exists public.iiko_checks (
  check_id   text primary key,              -- 'iiko:<id заказа iiko>'
  number     text,
  venue_id   text,
  sum        int not null default 0,        -- сумма чека в iiko
  amount     int not null default 0,        -- из неё за баллы (без акций)
  redeemed   int not null default 0,
  points     int not null default 0,
  user_id    uuid,
  import_phone text,
  guest_name text,
  staff_id   uuid,
  created_at timestamptz not null default now()
);
alter table public.iiko_checks enable row level security;
drop policy if exists iiko_checks_admin on public.iiko_checks;
create policy iiko_checks_admin on public.iiko_checks for select using (public.can_manage(venue_id));

create or replace function public.iiko_apply(p_code text, p_check_id text, p_number text, p_sum int, p_amount int, p_redeem int, p_venue text, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; ip text; r jsonb; prev public.iiko_checks;
begin
  select * into prev from public.iiko_checks where check_id = p_check_id;
  if found then
    raise exception 'Этот чек уже проведён: % (+% баллов)', coalesce(prev.guest_name, 'гость'), prev.points;
  end if;
  u := public.loyalty_find(p_code);
  if u is not null then
    r := public.loyalty_check(u, p_amount, p_redeem, p_venue, 'pos', p_check_id, p_staff, 'Чек iiko №' || coalesce(p_number, ''));
  else
    ip := public.loyalty_find_import(p_code);
    if ip is null then raise exception 'Гость не найден — попросите обновить QR в приложении'; end if;
    r := public.loyalty_check_import(ip, p_amount, p_redeem, p_venue, 'pos', p_check_id, p_staff, 'Чек iiko №' || coalesce(p_number, ''));
  end if;
  insert into public.iiko_checks (check_id, number, venue_id, sum, amount, redeemed, points, user_id, import_phone, guest_name, staff_id)
  values (p_check_id, p_number, p_venue, coalesce(p_sum, 0), p_amount, coalesce((r->>'redeemed')::int, 0), coalesce((r->>'points')::int, 0), u, ip, r->>'name', p_staff);
  return r;
end $$;
revoke all on function public.iiko_apply(text, text, text, int, int, int, text, uuid) from public, anon, authenticated;
grant execute on function public.iiko_apply(text, text, text, int, int, int, text, uuid) to service_role;
