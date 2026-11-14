-- 019: оплата баллами на кассе iiko (плагин «Карта Патрики» 1.2)
-- Баллы списываются сразу при применении скидки «Баллы Патрики» (по свежему QR гостя) и
-- «держатся» за заказом iiko. При закрытии заказа списание фиксируется, при удалении заказа
-- или отмене на кассе — возвращаются. Незакрытые списания старше 48 часов возвращаются сами.

create table if not exists public.iiko_redeems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  venue_id text not null,
  iiko_order text not null,
  points int not null check (points > 0),
  order_sum int not null default 0,
  status text not null default 'held' check (status in ('held','closed','returned')),
  check_id text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists iiko_redeems_order on public.iiko_redeems (iiko_order) where status = 'held';
alter table public.iiko_redeems enable row level security;
revoke all on public.iiko_redeems from anon, authenticated;

-- вернуть баллы по удержанию (внутренняя)
create or replace function public.iiko_redeem_return(p_id uuid, p_note text)
returns int language plpgsql security definer set search_path = public as $$
declare h public.iiko_redeems;
begin
  update public.iiko_redeems set status = 'returned', finished_at = now()
   where id = p_id and status = 'held' returning * into h;
  if not found then return 0; end if;
  insert into public.loyalty_tx (user_id, kind, points, source, venue_id, ext_id, note)
  values (h.user_id, 'refund', h.points, 'pos', h.venue_id, 'iiko-hold:' || h.id || ':ret', p_note);
  update public.loyalty_accounts set balance = balance + h.points where user_id = h.user_id;
  return h.points;
end $$;

create or replace function public.iiko_redeem_expire()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.iiko_redeems where status = 'held' and created_at < now() - interval '48 hours' loop
    perform public.iiko_redeem_return(r.id, 'Возврат: заказ на кассе не закрыт за 48 часов');
  end loop;
end $$;

-- Списание на кассе. p_sum — сумма заказа до скидки баллами.
create or replace function public.pos_redeem(p_key text, p_code text, p_points int, p_sum int, p_venue text, p_order text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.loyalty_settings := public.loyalty_cfg(); u uuid; a public.loyalty_accounts; held int; h public.iiko_redeems;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  perform public.iiko_redeem_expire();
  if coalesce(p_points, 0) <= 0 then raise exception 'Укажите, сколько баллов списать'; end if;
  if coalesce(p_order, '') = '' then raise exception 'Нет заказа iiko'; end if;
  if not exists (select 1 from public.venues where id = p_venue) then raise exception 'Неизвестное заведение'; end if;
  perform public.loyalty_redeem_guard(p_code, p_points);           -- только по QR из приложения
  u := public.loyalty_find(p_code);                                 -- QR должен быть свежим
  if u is null then raise exception 'Гость не найден — попросите обновить QR в приложении'; end if;
  if not c.enabled or not c.venue_enabled then raise exception 'Программа лояльности в заведении выключена'; end if;
  if c.verified_only and not public.loyalty_verified(u) then raise exception 'У гостя не подтверждён номер — баллы списывать нельзя'; end if;
  if coalesce(p_sum, 0) <= 0 then raise exception 'Сумма заказа пустая'; end if;
  select coalesce(sum(points), 0) into held from public.iiko_redeems where iiko_order = p_order and status = 'held';
  if held + p_points > floor(p_sum * c.max_redeem_pct / 100.0) then
    raise exception 'Баллами можно оплатить не больше % %% чека (до % баллов)', c.max_redeem_pct, greatest(floor(p_sum * c.max_redeem_pct / 100.0)::int - held, 0);
  end if;
  a := public.loyalty_account(u);
  if p_points > a.balance then raise exception 'У гостя только % баллов', a.balance; end if;
  insert into public.iiko_redeems (user_id, venue_id, iiko_order, points, order_sum)
  values (u, p_venue, p_order, p_points, p_sum) returning * into h;
  insert into public.loyalty_tx (user_id, kind, points, amount, source, venue_id, ext_id, note)
  values (u, 'redeem', -p_points, p_sum, 'pos', p_venue, 'iiko-hold:' || h.id, 'Оплата баллами на кассе');
  update public.loyalty_accounts set balance = balance - p_points, last_activity_at = now() where user_id = u;
  return jsonb_build_object('id', h.id, 'points', p_points) || public.loyalty_card_info(u);
end $$;

create or replace function public.pos_redeem_cancel(p_key text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  n := public.iiko_redeem_return(p_id, 'Возврат: оплата баллами отменена на кассе');
  return jsonb_build_object('returned', n);
end $$;

-- При закрытии заказа: фиксируем все удержания по заказу. Возвращает сколько списано и можно ли начислять.
create or replace function public.pos_redeem_close(p_key text, p_order text, p_check text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.loyalty_settings := public.loyalty_cfg(); n int;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  with x as (
    update public.iiko_redeems set status = 'closed', finished_at = now(), check_id = p_check
     where iiko_order = p_order and status = 'held' returning points)
  select coalesce(sum(points), 0) into n from x;
  if n = 0 then select coalesce(sum(points), 0) into n from public.iiko_redeems where iiko_order = p_order and status = 'closed'; end if;
  return jsonb_build_object('redeemed', n, 'accrue', n = 0 or c.accrue_if_redeem);
end $$;

-- Заказ доставки из приложения закрыт на кассе → заказ выполнен (баллы начислит триггер orders_loyalty)
create or replace function public.pos_delivery_done(p_key text, p_venue text, p_iiko_order text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  update public.orders set status = 'done'
   where iiko_order_id = p_iiko_order and venue_id = p_venue and status in ('cooking', 'delivering')
   returning number into o;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'number', o.number);
end $$;

revoke all on function public.iiko_redeem_return(uuid, text) from public, anon, authenticated;
revoke all on function public.iiko_redeem_expire() from public, anon, authenticated;
revoke all on function public.pos_redeem(text, text, int, int, text, text) from public, anon, authenticated;
revoke all on function public.pos_redeem_cancel(text, uuid) from public, anon, authenticated;
revoke all on function public.pos_redeem_close(text, text, text) from public, anon, authenticated;
revoke all on function public.pos_delivery_done(text, text, text) from public, anon, authenticated;
