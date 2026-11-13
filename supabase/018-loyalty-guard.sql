-- =====================================================================
--  Обновление 018: защита программы лояльности от злоупотреблений
--  1. Лимиты: сумма одного чека, число начислений гостю за сутки (касса, «Касса · QR», iiko).
--  2. Тревога владельцу в Telegram: крупное ручное начисление, крупное начисление/списание баллов.
--  3. Дата рождения гостя указывается один раз (иначе можно «переносить» день рождения ради бонуса).
--  4. Служебные функции нельзя вызвать напрямую из интернета.
--  5. Фиксированный search_path у оставшихся функций (рекомендация Supabase).
--  Лимиты меняет владелец (loyalty_settings). Можно запускать повторно.
-- =====================================================================

-- ---------- 1. лимиты (значения по умолчанию ловят только явные аномалии) ----------
alter table public.loyalty_settings add column if not exists max_check_amount     int not null default 100000; -- ₽, больше — только через владельца
alter table public.loyalty_settings add column if not exists max_accruals_per_day int not null default 5;      -- начислений одному гостю за 24 часа
alter table public.loyalty_settings add column if not exists alert_points         int not null default 1000;   -- начислено/списано за раз ≥ — тревога
alter table public.loyalty_settings add column if not exists manual_alert_amount  int not null default 10000;  -- ручной чек от этой суммы — тревога

create or replace function public.loyalty_guard(p_user uuid, p_import text, p_amount int, p_source text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.loyalty_settings := public.loyalty_cfg(); n int;
begin
  if coalesce(p_amount, 0) > c.max_check_amount then
    raise exception 'Сумма чека % ₽ больше лимита % ₽. Такие чеки проводит владелец', p_amount, c.max_check_amount;
  end if;
  select count(*) into n from public.loyalty_tx
   where kind in ('accrue', 'pending') and source in ('venue', 'pos') and created_at > now() - interval '24 hours'
     and ((p_user is not null and user_id = p_user) or (p_import is not null and import_phone = p_import));
  if n >= c.max_accruals_per_day then
    raise exception 'Гостю уже начисляли баллы % раз за сутки — это лимит. Если всё честно, обратитесь к владельцу', n;
  end if;
end $$;

-- ---------- 2. тревога владельцу ----------
create or replace function public.loyalty_alert(p_res jsonb, p_amount int, p_source text, p_venue text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.loyalty_settings := public.loyalty_cfg(); chat text; who text; pts int; red int; reasons text[] := '{}';
begin
  pts := coalesce((p_res->>'points')::int, 0);
  red := coalesce((p_res->>'redeemed')::int, 0);
  if p_source = 'venue' and p_amount >= c.manual_alert_amount then reasons := reasons || format('ручной чек на %s ₽ (без проверки по iiko)', p_amount); end if;
  if pts >= c.alert_points then reasons := reasons || format('начислено %s баллов', pts); end if;
  if red >= c.alert_points then reasons := reasons || format('списано %s баллов', red); end if;
  if cardinality(reasons) = 0 then return; end if;
  select value into chat from public.app_secrets where key = 'telegram_chat_id';
  if chat is null then return; end if;
  select nullif(name, '') into who from public.admins where user_id = auth.uid();
  perform public.tg_send(chat, format(E'🔔 Баллы: %s\nГость: %s%s\nЧек: %s ₽ · +%s / −%s · %s\n%s',
    array_to_string(reasons, ', '),
    coalesce(p_res->>'name', 'гость'), coalesce(' …' || nullif(p_res->>'phone_last4', ''), ''),
    p_amount, pts, red, coalesce((select name from public.venues where id = p_venue), p_venue, ''),
    case p_source when 'venue' then 'Касса · QR в админке' || coalesce(', сотрудник: ' || who, '') else 'касса iiko' end));
exception when others then null; -- тревога не должна ломать начисление
end $$;

-- ---------- обёртки начислений: лимиты + тревога ----------
create or replace function public.staff_accrue(p_code text, p_amount int, p_redeem int, p_venue text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; ip text; r jsonb;
begin
  if not public.can_manage(p_venue) then raise exception 'Нет доступа к этому заведению'; end if;
  u := public.loyalty_find(p_code);
  if u is not null then
    perform public.loyalty_redeem_guard(p_code, p_redeem);
    perform public.loyalty_guard(u, null, p_amount, 'venue');
    r := public.loyalty_check(u, p_amount, p_redeem, p_venue, 'venue', null, auth.uid(), p_note);
  else
    ip := public.loyalty_find_import(p_code);
    if ip is null then raise exception 'Гость не найден'; end if;
    perform public.loyalty_guard(null, ip, p_amount, 'venue');
    r := public.loyalty_check_import(ip, p_amount, p_redeem, p_venue, 'venue', null, auth.uid(), p_note);
  end if;
  perform public.loyalty_alert(r, p_amount, 'venue', p_venue);
  return r;
end $$;

create or replace function public.pos_accrue(p_key text, p_code text, p_amount int, p_redeem int, p_venue text, p_check_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; ip text; r jsonb;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  if coalesce(p_check_id, '') = '' then raise exception 'Нужен номер чека'; end if;
  if not exists (select 1 from public.venues where id = p_venue) then raise exception 'Неизвестное заведение'; end if;
  u := public.loyalty_find(p_code);
  if u is not null then
    perform public.loyalty_redeem_guard(p_code, p_redeem);
    perform public.loyalty_guard(u, null, p_amount, 'pos');
    r := public.loyalty_check(u, p_amount, p_redeem, p_venue, 'pos', p_check_id, null, 'Касса');
  else
    ip := public.loyalty_find_import(p_code);
    if ip is null then raise exception 'Гость не найден'; end if;
    perform public.loyalty_guard(null, ip, p_amount, 'pos');
    r := public.loyalty_check_import(ip, p_amount, p_redeem, p_venue, 'pos', p_check_id, null, 'Касса');
  end if;
  perform public.loyalty_alert(r, p_amount, 'pos', p_venue);
  return r;
end $$;

create or replace function public.iiko_apply(p_code text, p_check_id text, p_number text, p_sum int, p_amount int, p_redeem int, p_venue text, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; ip text; r jsonb; prev public.iiko_checks;
begin
  select * into prev from public.iiko_checks where check_id = p_check_id;
  if found then
    raise exception 'Этот чек уже проведён: % (+% баллов)', coalesce(prev.guest_name, 'гость'), prev.points;
  end if;
  if not exists (select 1 from public.venues where id = p_venue) then raise exception 'Неизвестное заведение'; end if;
  u := public.loyalty_find(p_code);
  if u is not null then
    perform public.loyalty_redeem_guard(p_code, p_redeem);
    perform public.loyalty_guard(u, null, p_amount, 'pos');
    r := public.loyalty_check(u, p_amount, p_redeem, p_venue, 'pos', p_check_id, p_staff, 'Чек iiko №' || coalesce(p_number, ''));
  else
    ip := public.loyalty_find_import(p_code);
    if ip is null then raise exception 'Гость не найден — попросите обновить QR в приложении'; end if;
    perform public.loyalty_guard(null, ip, p_amount, 'pos');
    r := public.loyalty_check_import(ip, p_amount, p_redeem, p_venue, 'pos', p_check_id, p_staff, 'Чек iiko №' || coalesce(p_number, ''));
  end if;
  insert into public.iiko_checks (check_id, number, venue_id, sum, amount, redeemed, points, user_id, import_phone, guest_name, staff_id)
  values (p_check_id, p_number, p_venue, coalesce(p_sum, 0), p_amount, coalesce((r->>'redeemed')::int, 0), coalesce((r->>'points')::int, 0), u, ip, r->>'name', p_staff);
  perform public.loyalty_alert(r, p_amount, 'pos', p_venue);
  return r;
end $$;

grant execute on function public.staff_accrue(text, int, int, text, text) to authenticated;
grant execute on function public.pos_accrue(text, text, int, int, text, text) to anon, authenticated;
revoke all on function public.iiko_apply(text, text, text, int, int, int, text, uuid) from public, anon, authenticated;
grant execute on function public.iiko_apply(text, text, text, int, int, int, text, uuid) to service_role;

-- ---------- 3. дата рождения — один раз ----------
create or replace function public.guard_profile_birthday() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and old.birthday is not null and new.birthday is distinct from old.birthday then
    raise exception 'Дату рождения можно указать только один раз. Чтобы исправить — напишите в паб';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_birthday on public.profiles;
create trigger profiles_guard_birthday before update on public.profiles
  for each row execute function public.guard_profile_birthday();

-- ---------- 4. служебные функции — не для вызова из интернета ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.loyalty_guard(uuid, text, int, text)',
    'public.loyalty_alert(jsonb, int, text, text)',
    'public.loyalty_redeem_guard(text, int)',
    'public.loyalty_spent(uuid)',
    'public.loyalty_tier(int)',
    'public.loyalty_tier_for(text, int)',
    'public.loyalty_verified(uuid)',
    'public.loyalty_cfg()',
    'public.pos_key_ok(text)',
    'public.notify_telegram()',
    'public.orders_loyalty()',
    'public.order_tg_text(public.orders, text)',
    'public.reservation_tg_text(public.reservations, text)',
    'public.feedback_tg_text(public.feedback)',
    'public.verify_cleanup()'
  ] loop
    begin
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    exception when undefined_function then null;
    end;
  end loop;
end $$;

-- ---------- 5. фиксированный search_path ----------
alter function public.guard_payment_fields() set search_path = public;
alter function public.guard_venue_fields() set search_path = public;
alter function public.loyalty_otp(text, bigint) set search_path = public;
alter function public.loyalty_redeem_guard(text, int) set search_path = public;
