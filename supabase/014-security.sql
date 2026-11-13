-- =====================================================================
--  Обновление 014: закрываем найденные уязвимости
--  • списать баллы гостя приложения можно только по живому QR-коду (PK1:…).
--    По номеру телефона или карты — только начислить. Так бармен не потратит
--    баллы гостя, которого нет рядом. Гости, перенесённые из MACE и ещё не
--    установившие приложение (loyalty_imports), по-прежнему обслуживаются по телефону.
--  • управляющий не может поменять сумму, состав и баллы в заказе —
--    раньше так можно было «нарисовать» лишние баллы. Из приложения меняется только статус.
--  Выполняется после 001–013. Можно запускать повторно.
-- =====================================================================

-- ---------- 1. списание баллов — только по QR ----------
create or replace function public.loyalty_redeem_guard(p_code text, p_redeem int) returns void
language plpgsql immutable as $$
begin
  if coalesce(p_redeem, 0) > 0 and trim(coalesce(p_code, '')) not like 'PK1:%' then
    raise exception 'Списать баллы можно только по QR-коду из приложения гостя. По телефону или номеру карты — только начислить';
  end if;
end $$;

create or replace function public.staff_accrue(p_code text, p_amount int, p_redeem int, p_venue text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; ip text;
begin
  if not public.can_manage(p_venue) then raise exception 'Нет доступа к этому заведению'; end if;
  u := public.loyalty_find(p_code);
  if u is not null then
    perform public.loyalty_redeem_guard(p_code, p_redeem);
    return public.loyalty_check(u, p_amount, p_redeem, p_venue, 'venue', null, auth.uid(), p_note);
  end if;
  ip := public.loyalty_find_import(p_code);
  if ip is not null then return public.loyalty_check_import(ip, p_amount, p_redeem, p_venue, 'venue', null, auth.uid(), p_note); end if;
  raise exception 'Гость не найден';
end $$;

create or replace function public.pos_accrue(p_key text, p_code text, p_amount int, p_redeem int, p_venue text, p_check_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; ip text;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  if coalesce(p_check_id, '') = '' then raise exception 'Нужен номер чека'; end if;
  u := public.loyalty_find(p_code);
  if u is not null then
    perform public.loyalty_redeem_guard(p_code, p_redeem);
    return public.loyalty_check(u, p_amount, p_redeem, p_venue, 'pos', p_check_id, null, 'Касса');
  end if;
  ip := public.loyalty_find_import(p_code);
  if ip is not null then return public.loyalty_check_import(ip, p_amount, p_redeem, p_venue, 'pos', p_check_id, null, 'Касса'); end if;
  raise exception 'Гость не найден';
end $$;

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
    perform public.loyalty_redeem_guard(p_code, p_redeem);
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

grant execute on function public.staff_accrue(text, int, int, text, text) to authenticated;
grant execute on function public.pos_accrue(text, text, int, int, text, text) to anon, authenticated;
revoke all on function public.iiko_apply(text, text, text, int, int, int, text, uuid) from public, anon, authenticated;
grant execute on function public.iiko_apply(text, text, text, int, int, int, text, uuid) to service_role;

-- ---------- 2. сумма, состав и баллы заказа — только сервер ----------
-- Управляющий из приложения меняет только статус. Передача заказа в другую точку,
-- оплата и перенос гостя идут через серверные функции и этой проверкой не затрагиваются.
create or replace function public.guard_payment_fields() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.payment_status  is distinct from old.payment_status  or
       new.sber_order_id   is distinct from old.sber_order_id   or
       new.paid_at         is distinct from old.paid_at         or
       new.total           is distinct from old.total           or
       new.subtotal        is distinct from old.subtotal        or
       new.delivery_fee    is distinct from old.delivery_fee    or
       new.points_redeemed is distinct from old.points_redeemed or
       new.items           is distinct from old.items           or
       new.payment         is distinct from old.payment         or
       new.user_id         is distinct from old.user_id         or
       new.venue_id        is distinct from old.venue_id        or
       new.number          is distinct from old.number) then
    raise exception 'Сумма, состав и оплата заказа меняются только сервером';
  end if;
  return new;
end $$;
drop trigger if exists orders_guard_payment on public.orders;
create trigger orders_guard_payment before update on public.orders
  for each row execute function public.guard_payment_fields();
