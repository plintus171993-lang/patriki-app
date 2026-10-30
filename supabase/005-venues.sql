-- ============================================================
-- Патрики Паб — обновление 005: два заведения без неразберихи
--  • управляющий привязан к своему заведению и видит только его заказы
--    (admins.venue_id пустой = владелец, видит всё и правит меню)
--  • у каждого заведения свой Telegram-чат: telegram_chat_id:<id заведения>
--    + общий чат владельца telegram_chat_id (копия всех заказов)
--  • свой стоп-лист у каждого заведения (items.stop_in)
--  • передача заказа в другое заведение (если гость ошибся точкой)
-- Выполняется после 001–004. Можно запускать повторно.
-- ============================================================

alter table public.admins add column if not exists venue_id text references public.venues(id) on delete set null;
alter table public.admins add column if not exists name text not null default '';
alter table public.items  add column if not exists stop_in text[] not null default '{}';
alter table public.orders add column if not exists transferred_from text;

-- ---------- права ----------
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and venue_id is null);
$$;
create or replace function public.can_manage(p_venue text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and (venue_id is null or venue_id = p_venue));
$$;
-- кто я в админке: { venue_id, name, owner }
create or replace function public.my_admin() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('venue_id', venue_id, 'name', name, 'owner', venue_id is null)
  from public.admins where user_id = auth.uid();
$$;
grant execute on function public.is_owner(), public.can_manage(text), public.my_admin() to authenticated;

-- заказы: управляющий — только своего заведения
drop policy if exists "orders admin read" on public.orders;
drop policy if exists "orders admin update" on public.orders;
create policy "orders admin read"   on public.orders for select to authenticated using (public.can_manage(venue_id));
create policy "orders admin update" on public.orders for update to authenticated
  using (public.can_manage(venue_id)) with check (public.can_manage(venue_id));

-- меню и категории правит владелец; заведение — владелец или его управляющий
drop policy if exists "items admin write" on public.items;
drop policy if exists "categories admin write" on public.categories;
drop policy if exists "venues admin write" on public.venues;
drop policy if exists "venues manager update" on public.venues;
create policy "items admin write"      on public.items      for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "categories admin write" on public.categories for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "venues admin write"     on public.venues     for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "venues manager update"  on public.venues     for update to authenticated using (public.can_manage(id)) with check (public.can_manage(id));

-- стоп-лист своего заведения (управляющему можно, даже без права править меню)
create or replace function public.set_stop(p_item text, p_venue text, p_stopped boolean) returns text[]
language plpgsql security definer set search_path = public as $$
declare r text[];
begin
  if not public.can_manage(p_venue) then raise exception 'Нет доступа к этому заведению'; end if;
  update public.items
     set stop_in = case when p_stopped then array(select distinct unnest(stop_in || p_venue))
                        else array_remove(stop_in, p_venue) end
   where id = p_item returning stop_in into r;
  return r;
end $$;
grant execute on function public.set_stop(text, text, boolean) to authenticated;

-- ---------- Telegram ----------
create or replace function public.tg_send(p_chat text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare token text;
begin
  select value into token from public.app_secrets where key = 'telegram_bot_token';
  if token is null or coalesce(p_chat,'') = '' then return; end if;
  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
    body    := jsonb_build_object('chat_id', p_chat, 'text', p_text),
    headers := '{"Content-Type": "application/json"}'::jsonb);
exception when others then null;
end $$;

-- текст заказа для Telegram
create or replace function public.order_tg_text(o public.orders, p_head text) returns text
language plpgsql stable security definer set search_path = public as $$
declare msg text; vn text; line jsonb; pay_text text;
begin
  select name into vn from public.venues where id = o.venue_id;
  pay_text := case o.payment when 'cash' then 'наличные' when 'online' then '💳 ОПЛАЧЕН ОНЛАЙН (заблокировано)' else 'карта курьеру' end;
  msg := format(E'%s №%s\n📍 %s\n%s\n\n', p_head, o.number, upper(coalesce(vn, o.venue_id)), o.when_text);
  for line in select * from jsonb_array_elements(o.items) loop
    msg := msg || format(E'• %s × %s = %s ₽\n', line->>'name', line->>'qty', (line->>'price')::int * (line->>'qty')::int);
  end loop;
  msg := msg || format(E'\nИтого: %s ₽ (%s)\n%s, %s\n%s', o.total, pay_text, o.customer_name, o.phone, o.address);
  if o.comment <> '' then msg := msg || E'\nКомментарий: ' || o.comment; end if;
  return msg;
end $$;

-- новый заказ → в чат СВОЕГО заведения (+ копия в общий чат владельца, если он задан и отличается)
create or replace function public.notify_telegram() returns trigger
language plpgsql security definer set search_path = public as $$
declare venue_chat text; owner_chat text; msg text;
begin
  if tg_op = 'INSERT' and new.payment = 'online' then return new; end if;     -- ждём оплату
  if tg_op = 'UPDATE' and not (new.payment = 'online' and new.payment_status = 'held'
                               and old.payment_status is distinct from 'held') then return new; end if;
  select value into venue_chat from public.app_secrets where key = 'telegram_chat_id:' || new.venue_id;
  select value into owner_chat from public.app_secrets where key = 'telegram_chat_id';
  msg := public.order_tg_text(new, '🍖 Новый заказ');
  if venue_chat is not null then perform public.tg_send(venue_chat, msg); end if;
  if owner_chat is not null and owner_chat is distinct from venue_chat then perform public.tg_send(owner_chat, msg); end if;
  return new;
exception when others then
  return new;   -- заказ не теряем, даже если Telegram недоступен
end $$;

-- ---------- передача заказа в другое заведение ----------
create or replace function public.transfer_order(p_id uuid, p_to text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; from_name text; to_chat text; owner_chat text;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if not public.can_manage(o.venue_id) then raise exception 'Нет доступа к этому заказу'; end if;
  if o.status <> 'new' then raise exception 'Передать можно только новый, ещё не принятый заказ'; end if;
  if o.venue_id = p_to then return; end if;
  if not exists (select 1 from public.venues where id = p_to) then raise exception 'Нет такого заведения'; end if;
  if o.payment = 'online' and o.payment_status in ('held','paid') then
    raise exception 'Онлайн-оплаченный заказ не передаётся: отмените его (деньги вернутся) и попросите гостя оформить заново';
  end if;
  select name into from_name from public.venues where id = o.venue_id;
  update public.orders set venue_id = p_to, transferred_from = o.venue_id,
         comment = trim(both ' ' from '⇄ Передан из «' || coalesce(from_name, o.venue_id) || '». ' || comment)
   where id = p_id returning * into o;
  select value into to_chat from public.app_secrets where key = 'telegram_chat_id:' || p_to;
  select value into owner_chat from public.app_secrets where key = 'telegram_chat_id';
  perform public.tg_send(coalesce(to_chat, owner_chat), public.order_tg_text(o, '⇄ Передан вам заказ'));
end $$;
grant execute on function public.transfer_order(uuid, text) to authenticated;

-- ---------- оформление заказа: учитываем стоп-лист заведения ----------
create or replace function public.place_order(p_order jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v        public.venues;
  line     jsonb;
  it       public.items;
  qty      int;
  lines    jsonb := '[]'::jsonb;
  subtotal int := 0;
  o        public.orders;
  digits   text := regexp_replace(coalesce(p_order->>'phone',''), '\D', '', 'g');
  verified boolean := false;
  pay      text := coalesce(p_order->>'payment', 'card');
  consent  text := left(coalesce(p_order->>'pd_consent', ''), 40);
begin
  if consent = '' then raise exception 'Нужно согласие на обработку персональных данных'; end if;
  select * into v from public.venues where id = p_order->>'venue_id';
  if not found then raise exception 'Неизвестное заведение'; end if;
  if not v.accepting then raise exception 'Заведение сейчас не принимает заказы'; end if;
  if pay not in ('card','cash','online') then pay := 'card'; end if;
  if pay = 'online' and not v.pay_online then raise exception 'Онлайн-оплата недоступна'; end if;

  if length(coalesce(trim(p_order->>'customer_name'),'')) not between 1 and 80 then raise exception 'Имя'; end if;
  if length(digits) not between 10 and 12 then raise exception 'Телефон'; end if;
  if length(coalesce(trim(p_order->>'address'),'')) not between 3 and 300 then raise exception 'Адрес'; end if;
  if jsonb_typeof(p_order->'items') <> 'array' or jsonb_array_length(p_order->'items') not between 1 and 60 then raise exception 'Состав заказа'; end if;

  for line in select * from jsonb_array_elements(p_order->'items') loop
    qty := least(greatest(coalesce((line->>'qty')::int, 0), 0), 50);
    continue when qty = 0;
    select * into it from public.items where id = line->>'item_id' and available and not (v.id = any(stop_in));
    continue when not found;
    lines := lines || jsonb_build_object('item_id', it.id, 'name', it.name, 'price', it.price, 'qty', qty);
    subtotal := subtotal + it.price * qty;
  end loop;

  if jsonb_array_length(lines) = 0 then raise exception 'Позиции недоступны'; end if;
  if subtotal < v.min_order then raise exception 'Меньше минимального заказа'; end if;

  if auth.uid() is not null then
    select (u.phone_confirmed_at is not null and right(u.phone, 10) = right(digits, 10))
      into verified from auth.users u where u.id = auth.uid();
  end if;

  insert into public.orders (venue_id, customer_name, phone, address, comment, when_text, payment, payment_status,
                             items, subtotal, delivery_fee, total, user_id, phone_verified, pd_consent_version)
  values (
    v.id, left(trim(p_order->>'customer_name'), 80), left(trim(p_order->>'phone'), 30), left(trim(p_order->>'address'), 300),
    left(coalesce(p_order->>'comment', ''), 500), left(coalesce(p_order->>'when_text', ''), 50),
    pay, case when pay = 'online' then 'pending' else 'none' end,
    lines, subtotal, v.delivery_fee, subtotal + v.delivery_fee, auth.uid(), coalesce(verified, false), consent
  ) returning * into o;

  return jsonb_build_object('id', o.id, 'number', o.number, 'total', o.total);
end $$;

-- ---------- как назначить управляющего (выполняет владелец в SQL Editor) ----------
-- 1) Authentication → Users → Add user (email + пароль управляющего)
-- 2) insert into public.admins (user_id, venue_id, name)
--      select id, 'petrogradka', 'Управляющий Петроградка' from auth.users where email = 'manager1@example.com';
--    для Мурино — venue_id = 'murino'; владелец — venue_id = null (видит оба заведения и правит меню)
-- 3) Telegram-чаты: insert into public.app_secrets values ('telegram_chat_id:petrogradka', '-100…'), ('telegram_chat_id:murino', '-100…')
--    on conflict (key) do update set value = excluded.value;

-- управляющий может менять у своего заведения только «оперативное»: приём заказов, часы, время доставки, телефон;
-- цены доставки, минимальный заказ, онлайн-оплату, название, адрес и зону — только владелец
create or replace function public.guard_venue_fields() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_owner() and (
       new.name is distinct from old.name or new.address is distinct from old.address or new.zone is distinct from old.zone or
       new.delivery_fee is distinct from old.delivery_fee or new.min_order is distinct from old.min_order or
       new.pay_online is distinct from old.pay_online or new.id is distinct from old.id) then
    raise exception 'Эти настройки меняет только владелец';
  end if;
  return new;
end $$;
drop trigger if exists venues_guard on public.venues;
create trigger venues_guard before update on public.venues for each row execute function public.guard_venue_fields();
