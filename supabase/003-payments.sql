-- =====================================================================
--  Патрики Паб — обновление 003: онлайн-оплата через Сбер
--  Деньги блокируются при оформлении и списываются, когда управляющий
--  принимает заказ. Отмена — блокировка снимается. Повторный запуск безопасен.
-- =====================================================================

-- ---------- поля оплаты в заказе ----------
alter table public.orders drop constraint if exists orders_payment_check;
alter table public.orders add constraint orders_payment_check check (payment in ('card','cash','online'));

alter table public.orders add column if not exists payment_status text not null default 'none';
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('none','pending','held','paid','cancelled','refunded','failed'));
alter table public.orders add column if not exists sber_order_id text;
alter table public.orders add column if not exists paid_at timestamptz;

-- онлайн-оплата включается для каждого заведения отдельно (в админке)
alter table public.venues add column if not exists pay_online boolean not null default false;

-- ---------- оформление заказа: способ «online» ----------
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
begin
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
    select * into it from public.items where id = line->>'item_id' and available;
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
                             items, subtotal, delivery_fee, total, user_id, phone_verified)
  values (
    v.id, left(trim(p_order->>'customer_name'), 80), left(trim(p_order->>'phone'), 30), left(trim(p_order->>'address'), 300),
    left(coalesce(p_order->>'comment', ''), 500), left(coalesce(p_order->>'when_text', ''), 50),
    pay, case when pay = 'online' then 'pending' else 'none' end,
    lines, subtotal, v.delivery_fee, subtotal + v.delivery_fee, auth.uid(), coalesce(verified, false)
  ) returning * into o;

  return jsonb_build_object('id', o.id, 'number', o.number, 'total', o.total);
end $$;

-- статус для гостя: + статус оплаты
create or replace function public.order_status(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', status, 'number', number, 'payment', payment,
                            'payment_status', payment_status, 'total', total)
  from public.orders where id = p_id;
$$;

-- ---------- Telegram: онлайн-заказ сообщаем только когда деньги заблокированы ----------
create or replace function public.notify_telegram() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  token text; chat text; msg text; venue_name text; line jsonb; pay_text text;
begin
  if tg_op = 'INSERT' and new.payment = 'online' then return new; end if;     -- ждём оплату
  if tg_op = 'UPDATE' and not (new.payment = 'online' and new.payment_status = 'held'
                               and old.payment_status is distinct from 'held') then return new; end if;

  select value into token from public.app_secrets where key = 'telegram_bot_token';
  select value into chat  from public.app_secrets where key = 'telegram_chat_id';
  if token is null or chat is null then return new; end if;

  select name into venue_name from public.venues where id = new.venue_id;
  pay_text := case new.payment when 'cash' then 'наличные' when 'online' then '💳 ОПЛАЧЕН ОНЛАЙН (заблокировано)' else 'карта курьеру' end;
  msg := format(E'🍖 Новый заказ №%s — %s\n%s\n\n', new.number, coalesce(venue_name, new.venue_id), new.when_text);
  for line in select * from jsonb_array_elements(new.items) loop
    msg := msg || format(E'• %s × %s = %s ₽\n', line->>'name', line->>'qty', (line->>'price')::int * (line->>'qty')::int);
  end loop;
  msg := msg || format(E'\nИтого: %s ₽ (%s)\n%s, %s\n%s', new.total, pay_text, new.customer_name, new.phone, new.address);
  if new.comment <> '' then msg := msg || E'\nКомментарий: ' || new.comment; end if;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
    body    := jsonb_build_object('chat_id', chat, 'text', msg),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists orders_notify_telegram on public.orders;
create trigger orders_notify_telegram after insert on public.orders
  for each row execute function public.notify_telegram();
drop trigger if exists orders_notify_telegram_paid on public.orders;
create trigger orders_notify_telegram_paid after update of payment_status on public.orders
  for each row execute function public.notify_telegram();

-- управляющий не может вручную «нарисовать» оплату: поля оплаты меняет только сервер (функция sber)
create or replace function public.guard_payment_fields() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.payment_status is distinct from old.payment_status or
       new.sber_order_id  is distinct from old.sber_order_id  or
       new.paid_at        is distinct from old.paid_at        or
       new.total          is distinct from old.total) then
    raise exception 'Поля оплаты меняются только платёжным сервером';
  end if;
  return new;
end $$;
drop trigger if exists orders_guard_payment on public.orders;
create trigger orders_guard_payment before update on public.orders
  for each row execute function public.guard_payment_fields();
