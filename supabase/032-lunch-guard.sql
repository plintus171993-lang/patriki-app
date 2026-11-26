-- 032: защита ланч-карты от «хитрецов»
--  • штамп ставится ТОЛЬКО по QR из приложения гостя (PK1:…), не по номеру карты/телефону
--  • в календарный день (по Москве) — одна акционная операция на аккаунт: ИЛИ штамп, ИЛИ подарок
--    (нельзя в один день и получить подарок, и сразу заработать новый штамп)

create or replace function public.lunch_today_ops(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when l.kind = 'stamp' then l.qty else 1 end), 0)::int
  from public.lunch_log l
  where l.user_id = p_user
    and l.kind in ('stamp', 'gift')
    and coalesce(l.status, 'closed') <> 'returned'
    and (l.created_at at time zone 'Europe/Moscow')::date = (now() at time zone 'Europe/Moscow')::date
$$;

create or replace function public.pos_lunch_gift(p_key text, p_code text, p_order text, p_venue text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.lunch_settings := public.lunch_cfg(); u uuid; k public.lunch_cards; g public.lunch_log;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  if not coalesce(c.enabled, false) then raise exception 'Акция «Ланч в подарок» выключена'; end if;
  if coalesce(p_order, '') = '' then raise exception 'Нет заказа iiko'; end if;
  if coalesce(p_code, '') not like 'PK1:%' then raise exception 'Подарок — только по QR-коду из приложения гостя'; end if;
  perform public.lunch_gift_expire();
  u := public.loyalty_find(p_code);
  if u is null then raise exception 'Гость не найден — попросите обновить QR в приложении'; end if;
  if exists (select 1 from public.lunch_log where iiko_order = p_order and kind = 'gift' and status = 'held') then
    raise exception 'В этом заказе уже есть ланч в подарок';
  end if;
  if c.max_per_day > 0 and public.lunch_today_ops(u) >= c.max_per_day then
    raise exception 'Сегодня по этому аккаунту уже был акционный ланч — подарок можно взять завтра';
  end if;
  k := public.lunch_card(u);
  if k.stamps < c.goal - 1 then raise exception 'До подарка ещё % оплаченных ланч(а)', c.goal - 1 - k.stamps; end if;
  insert into public.lunch_log (user_id, kind, qty, status, iiko_order, venue_id, note)
  values (u, 'gift', -(c.goal - 1), 'held', p_order, p_venue, 'Ланч в подарок') returning * into g;
  update public.lunch_cards set stamps = stamps - (c.goal - 1), gifts_total = gifts_total + 1, updated_at = now() where user_id = u;
  return jsonb_build_object('id', g.id) || public.lunch_state(u);
end $$;

create or replace function public.pos_lunch_close(p_key text, p_code text, p_order text, p_venue text, p_items jsonb, p_gift boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.lunch_settings := public.lunch_cfg(); u uuid; k public.lunch_cards; g record;
  gifts int := 0; v_qty int; v_today int; v_allow int; v_add int; chk text := 'iiko:' || coalesce(p_order, '');
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  if coalesce(p_order, '') = '' then return jsonb_build_object('enabled', false); end if;
  for g in select * from public.lunch_log where iiko_order = p_order and kind = 'gift' and status = 'held' loop
    if coalesce(p_gift, true) then
      update public.lunch_log set status = 'closed', finished_at = now() where id = g.id;
      gifts := gifts + 1;
    else
      update public.lunch_log set status = 'returned', finished_at = now(), note = 'Скидку убрали из заказа' where id = g.id;
      update public.lunch_cards set stamps = stamps - g.qty, gifts_total = greatest(gifts_total - 1, 0), updated_at = now() where user_id = g.user_id;
    end if;
  end loop;
  if not coalesce(c.enabled, false) then return jsonb_build_object('enabled', false); end if;
  begin u := public.loyalty_find(p_code); exception when others then u := null; end;
  if u is null then return jsonb_build_object('enabled', true, 'added', 0, 'gifts', gifts); end if;
  k := public.lunch_card(u);
  if exists (select 1 from public.lunch_log where check_id = chk and kind = 'stamp') then
    return public.lunch_state(u) || jsonb_build_object('added', 0, 'gifts', gifts, 'note', 'чек уже учтён');
  end if;
  select coalesce(sum(floor((x->>'amount')::numeric)), 0)::int into v_qty
  from jsonb_array_elements(coalesce(p_items, '[]')) x
  where (x->>'productId') = any(c.product_ids) and coalesce((x->>'amount')::numeric, 0) > 0;
  v_qty := greatest(v_qty - gifts, 0);
  if v_qty = 0 then return public.lunch_state(u) || jsonb_build_object('added', 0, 'gifts', gifts); end if;
  if coalesce(p_code, '') not like 'PK1:%' then
    return public.lunch_state(u) || jsonb_build_object('added', 0, 'gifts', gifts,
      'note', 'ланч-карта — только по QR из приложения');
  end if;
  v_today := public.lunch_today_ops(u);   -- подарок, закрытый в этом же чеке, тоже считается
  v_allow := case when c.max_per_day = 0 then v_qty else greatest(c.max_per_day - v_today, 0) end;
  v_add := least(v_qty, v_allow);
  if v_add > 0 then
    insert into public.lunch_log (user_id, kind, qty, check_id, iiko_order, venue_id, note)
    values (u, 'stamp', v_add, chk, p_order, p_venue, 'Ланч на кассе');
    update public.lunch_cards set stamps = stamps + v_add, paid_total = paid_total + v_add, last_stamp_at = now(), updated_at = now() where user_id = u;
  end if;
  return public.lunch_state(u) || jsonb_build_object('added', v_add, 'gifts', gifts,
    'note', case when v_add < v_qty then 'по акции — один ланч в день на аккаунт' end);
end $$;

revoke execute on function public.lunch_today_ops(uuid) from public, anon, authenticated;
