-- =====================================================================
--  Патрики Паб — обновление 002: профили гостей, адреса, история заказов,
--  подтверждение номера кодом (тестовый режим: коды видны в админке).
--  Выполнить один раз после setup-all.sql. Повторный запуск безопасен.
-- =====================================================================

-- ---------- профиль гостя ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  phone       text not null default '',      -- контактный номер (может быть не подтверждён)
  birthday    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- сохранённые адреса ----------
create table if not exists public.addresses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label         text not null default '',     -- «Дом», «Работа»…
  street        text not null,
  flat          text not null default '',
  entrance      text not null default '',
  floor         text not null default '',
  intercom      text not null default '',
  comment       text not null default '',
  last_used_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists addresses_user_idx on public.addresses (user_id, last_used_at desc);

-- ---------- заказы привязываются к профилю ----------
alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists phone_verified boolean not null default false;
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

-- ---------- права ----------
alter table public.profiles  enable row level security;
alter table public.addresses enable row level security;

drop policy if exists "profiles own" on public.profiles;
drop policy if exists "profiles admin read" on public.profiles;
create policy "profiles own" on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles admin read" on public.profiles for select to authenticated using (public.is_admin());

drop policy if exists "addresses own" on public.addresses;
create policy "addresses own" on public.addresses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- гость видит свои заказы (история)
drop policy if exists "orders own read" on public.orders;
create policy "orders own read" on public.orders for select to authenticated using (user_id = auth.uid());

-- ---------- оформление заказа: + профиль и пометка «номер подтверждён» ----------
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
begin
  select * into v from public.venues where id = p_order->>'venue_id';
  if not found then raise exception 'Неизвестное заведение'; end if;
  if not v.accepting then raise exception 'Заведение сейчас не принимает заказы'; end if;

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

  -- номер подтверждён, если совпадает с подтверждённым номером учётной записи
  if auth.uid() is not null then
    select (u.phone_confirmed_at is not null and right(u.phone, 10) = right(digits, 10))
      into verified from auth.users u where u.id = auth.uid();
  end if;

  insert into public.orders (venue_id, customer_name, phone, address, comment, when_text, payment, items, subtotal, delivery_fee, total, user_id, phone_verified)
  values (
    v.id, left(trim(p_order->>'customer_name'), 80), left(trim(p_order->>'phone'), 30), left(trim(p_order->>'address'), 300),
    left(coalesce(p_order->>'comment', ''), 500), left(coalesce(p_order->>'when_text', ''), 50),
    case when p_order->>'payment' = 'cash' then 'cash' else 'card' end,
    lines, subtotal, v.delivery_fee, subtotal + v.delivery_fee, auth.uid(), coalesce(verified, false)
  ) returning * into o;

  return jsonb_build_object('id', o.id, 'number', o.number, 'total', o.total);
end $$;

-- ---------- перенос данных при входе на другом устройстве ----------
-- Гость без подтверждения уже накопил адреса/заказы, а номер числится за старым профилем:
-- до входа он получает одноразовый токен, после входа забирает свои данные.
create table if not exists public.guest_transfers (
  token      uuid primary key default gen_random_uuid(),
  from_user  uuid not null,
  created_at timestamptz not null default now()
);
alter table public.guest_transfers enable row level security;  -- доступ только через функции

create or replace function public.create_transfer() returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.guest_transfers where created_at < now() - interval '1 hour';
  insert into public.guest_transfers (from_user) values (auth.uid()) returning token into t;
  return t;
end $$;

create or replace function public.claim_transfer(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare src uuid; me uuid := auth.uid();
begin
  if me is null then return; end if;
  delete from public.guest_transfers where token = p_token and created_at > now() - interval '30 minutes'
    returning from_user into src;
  if src is null or src = me then return; end if;
  update public.addresses set user_id = me where user_id = src;
  update public.orders set user_id = me where user_id = src;
  insert into public.profiles (id, name, phone, birthday)
    select me, name, phone, birthday from public.profiles where id = src
  on conflict (id) do update set
    name = case when public.profiles.name = '' then excluded.name else public.profiles.name end,
    birthday = coalesce(public.profiles.birthday, excluded.birthday);
end $$;

grant execute on function public.create_transfer() to authenticated;
grant execute on function public.claim_transfer(uuid) to authenticated;

-- ---------- отправка кода подтверждения (Auth Hook «Send SMS») ----------
-- ТЕСТОВЫЙ РЕЖИМ: код не уходит по SMS, а сохраняется в sms_outbox (видно в админке)
-- и дублируется в Telegram-чат заведения, если он настроен.
-- Чтобы подключить настоящий SMS-сервис, достаточно дописать отправку в эту функцию.
create table if not exists public.sms_outbox (
  id         bigint generated by default as identity primary key,
  phone      text not null,
  otp        text not null,
  created_at timestamptz not null default now()
);
alter table public.sms_outbox enable row level security;
drop policy if exists "sms admin read" on public.sms_outbox;
create policy "sms admin read" on public.sms_outbox for select to authenticated using (public.is_admin());

create or replace function public.pk_send_sms(event jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ph text := event->'user'->>'phone';
  code text := event->'sms'->>'otp';
  token text; chat text;
begin
  -- новый номер при привязке приходит в поле phone_change / new_phone
  ph := coalesce(nullif(event->'user'->>'phone_change', ''), nullif(event->'sms'->>'phone', ''), ph);
  insert into public.sms_outbox (phone, otp) values (coalesce(ph, ''), coalesce(code, ''));
  delete from public.sms_outbox where created_at < now() - interval '1 day';

  select value into token from public.app_secrets where key = 'telegram_bot_token';
  select value into chat  from public.app_secrets where key = 'telegram_chat_id';
  if token is not null and chat is not null then
    begin
      perform net.http_post(
        url := 'https://api.telegram.org/bot' || token || '/sendMessage',
        body := jsonb_build_object('chat_id', chat, 'text', format('🔑 Код входа для +%s: %s', ph, code)),
        headers := '{"Content-Type": "application/json"}'::jsonb);
    exception when others then null;
    end;
  end if;
  return '{}'::jsonb;
end $$;

revoke execute on function public.pk_send_sms(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.pk_send_sms(jsonb) to supabase_auth_admin;
