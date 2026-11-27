-- 037: опрос кассы без серверных функций (Edge Functions).
-- Плагин 2.2 спрашивает «есть ли новые заявки / заказы официантов» напрямую у базы:
--   rpc pos_inbox(p_key, p_venue)                     — вместо функции iiko, action front-inbox
--   rpc pos_poll(p_key, p_venue, p_tables, p_menu, p_version) — вместо функции waiter, action pos_poll
-- Запросы к базе не входят в лимит вызовов функций Supabase (на бесплатном тарифе — 500 000 в месяц),
-- а опрос каждые 2 секунды давал ~2 млн вызовов в месяц. Логика — та же, что в функциях.

create or replace function public.pos_inbox(p_key text, p_venue text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare since timestamptz := now() - interval '2 days'; rs jsonb; os jsonb;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  if not exists (select 1 from venues where id = p_venue) then raise exception 'Неизвестное заведение: %', p_venue; end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]') into rs from (
    select id, number, starts_at, guests, name, phone, comment, deposit, payment_status, created_at
    from reservations
    where venue_id = p_venue and status = 'new' and created_at >= since
      and (coalesce(deposit, 0) = 0 or payment_status in ('held', 'paid'))
  ) r;

  -- онлайн-заказ показываем, только когда деньги уже заблокированы
  select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at), '[]') into os from (
    select id, number, customer_name, phone, address, comment, when_text, payment, payment_status, items,
           subtotal, delivery_fee, total, points_redeemed, created_at,
           case when payment = 'online' then
                  case when payment_status = 'paid' then 'ОПЛАЧЕН онлайн'
                       else 'ОПЛАЧЕН онлайн (деньги заблокированы, спишутся при принятии)' end
                when payment = 'cash' then 'наличными курьеру'
                when payment = 'card' then 'картой курьеру'
                else payment end as payment_text
    from orders
    where venue_id = p_venue and status = 'new' and created_at >= since
      and (payment <> 'online' or payment_status in ('held', 'paid'))
  ) o;

  return jsonb_build_object('reservations', rs, 'orders', os);
end $$;

create or replace function public.pos_poll(p_key text, p_venue text, p_tables jsonb default null,
                                           p_menu jsonb default null, p_version text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text := coalesce(nullif(p_venue, ''), 'petrogradka'); t jsonb := p_tables; lay jsonb;
        stale timestamptz := now() - interval '3 minutes'; ids uuid[]; res jsonb;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;

  -- пульс кассы и снимок открытых заказов по столам
  insert into waiter_cache(key, data, updated_at)
  values ('pos_seen:' || v, jsonb_build_object('at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'version', p_version), now())
  on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;

  if t is not null and jsonb_typeof(t) = 'object' then
    lay := t -> '_layout';
    t := t - '_layout';
    if lay is not null and jsonb_typeof(lay) = 'array' and jsonb_array_length(lay) > 0 then
      insert into waiter_cache(key, data, updated_at) values ('pos_layout:' || v, lay, now())
      on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
    end if;
    insert into waiter_cache(key, data, updated_at) values ('pos_tables:' || v, t, now())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  end if;

  if p_menu is not null and jsonb_typeof(p_menu -> 'groups') = 'array' and jsonb_array_length(p_menu -> 'groups') > 0 then
    insert into waiter_cache(key, data, updated_at) values ('pos_menu:' || v, p_menu, now())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  end if;

  -- новые заказы официантов (и «взятые» больше 3 минут назад — касса могла перезапуститься)
  select array_agg(id order by created_at) into ids from (
    select id, created_at from waiter_orders
    where venue = v and (status = 'queued' or (status = 'taken' and taken_at < stale))
      and created_at >= now() - interval '6 hours'
    order by created_at limit 20
    for update skip locked
  ) q;

  if ids is null then return jsonb_build_object('orders', '[]'::jsonb); end if;

  update waiter_orders set status = 'taken', taken_at = now(), updated_at = now() where id = any(ids);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id, 'tableId', w.table_id, 'table', w.table_label, 'guests', w.guests,
           'waiterId', w.waiter_iiko_id, 'waiter', coalesce(s.name, ''), 'items', coalesce(w.payload, '[]'::jsonb),
           'created', w.created_at) order by w.created_at), '[]')
    into res
  from waiter_orders w left join waiter_staff s on s.id = w.staff_id
  where w.id = any(ids);

  return jsonb_build_object('orders', res);
end $$;

revoke all on function public.pos_inbox(text, text) from public;
revoke all on function public.pos_poll(text, text, jsonb, jsonb, text) from public;
grant execute on function public.pos_inbox(text, text) to anon, authenticated;
grant execute on function public.pos_poll(text, text, jsonb, jsonb, text) to anon, authenticated;
