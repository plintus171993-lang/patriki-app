-- =====================================================================
--  Обновление 019: приложение для официантов (www/waiter/)
--  Официант входит по ПИН-коду, видит залы и столы из iiko, меню из
--  внешнего меню iiko «Официант» и отправляет заказ на стол прямо на кассу
--  и кухню (iikoCloud API, сервисная печать включается в каждом заказе).
--
--  Всё работает через серверную функцию `waiter` (проверка JWT выключена,
--  своя авторизация по ПИН). Таблицы ниже закрыты для приложения (RLS без
--  политик) — читать и писать их может только серверная функция.
--
--  Ключи iiko — в app_secrets (свои, отдельно от приложения доставки):
--    waiter_iiko_api_key, waiter_iiko_app_id, waiter_iiko_client_secret
--  Необязательно: waiter_iiko_menu — название внешнего меню (по умолчанию «Официант»).
--  Можно запускать повторно.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- официанты ----------
create table if not exists public.waiter_staff (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  pin_hash   text not null,                 -- crypt(pin, gen_salt('bf'))
  role       text not null default 'waiter' check (role in ('waiter', 'manager')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- сессии (токен выдаётся после входа по ПИН) ----------
create table if not exists public.waiter_sessions (
  token      text primary key,
  staff_id   uuid not null references public.waiter_staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '16 hours'
);

-- ---------- попытки входа (защита от подбора ПИН) ----------
create table if not exists public.waiter_login_attempts (
  id         bigserial primary key,
  ip         text,
  ok         boolean not null,
  created_at timestamptz not null default now()
);

-- ---------- журнал заказов, отправленных из приложения ----------
create table if not exists public.waiter_orders (
  id             uuid primary key default gen_random_uuid(),
  client_id      text unique,               -- id заказа на телефоне: повторная отправка не создаст дубль
  staff_id       uuid references public.waiter_staff(id),
  kind           text not null check (kind in ('create', 'add')),
  table_id       uuid,
  table_label    text,
  iiko_order_id  uuid,
  correlation_id uuid,
  status         text not null default 'sent', -- sent | ok | error
  error          text,
  payload        jsonb,
  total          numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists waiter_orders_created on public.waiter_orders (created_at desc);

-- ---------- кэш данных iiko (меню, столы) ----------
create table if not exists public.waiter_cache (
  key        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.waiter_staff          enable row level security;
alter table public.waiter_sessions       enable row level security;
alter table public.waiter_login_attempts enable row level security;
alter table public.waiter_orders         enable row level security;
alter table public.waiter_cache          enable row level security;

-- ---------- проверка ПИН (вызывается только серверной функцией) ----------
create or replace function public.waiter_check_pin(p_pin text)
returns table (id uuid, name text, role text)
language sql security definer set search_path = public, extensions as $$
  select s.id, s.name, s.role from public.waiter_staff s
  where s.active and s.pin_hash = crypt(p_pin, s.pin_hash)
  limit 1;
$$;

-- ---------- добавить / изменить официанта ----------
-- select public.waiter_upsert('Анна', '1234');            -- новый официант
-- select public.waiter_upsert('Вадим', '9999', 'manager'); -- управляющий
create or replace function public.waiter_upsert(p_name text, p_pin text, p_role text default 'waiter', p_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'ПИН — от 4 до 6 цифр'; end if;
  if exists (select 1 from public.waiter_staff s where s.active and s.pin_hash = crypt(p_pin, s.pin_hash) and s.id is distinct from p_id) then
    raise exception 'Такой ПИН уже занят';
  end if;
  if p_id is null then
    insert into public.waiter_staff (name, pin_hash, role) values (trim(p_name), crypt(p_pin, gen_salt('bf')), p_role) returning id into v;
  else
    update public.waiter_staff set name = trim(p_name), pin_hash = crypt(p_pin, gen_salt('bf')), role = p_role, active = true where id = p_id returning id into v;
  end if;
  return v;
end $$;

-- служебные функции нельзя вызвать из интернета
revoke all on function public.waiter_check_pin(text) from public, anon, authenticated;
revoke all on function public.waiter_upsert(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.waiter_check_pin(text) to service_role;
grant execute on function public.waiter_upsert(text, text, text, uuid) to service_role;

-- ---------- 020: связь официанта с сотрудником iiko ----------
-- Управляющий выбирает сотрудника из списка iiko и задаёт ему ПИН. Уволенный в iiko
-- сотрудник автоматически отключается в приложении (проверка при открытии списка и при входе).
alter table public.waiter_staff add column if not exists iiko_employee_id uuid unique;
alter table public.waiter_staff add column if not exists iiko_name text;

-- ---------- 021: заказы официантов создаёт плагин кассы «Карта Патрики» ----------
-- Приложение кладёт заказ в очередь (status = queued), главная касса с плагином забирает
-- его (taken), создаёт на столе в iikoFront от имени официанта, печатает на кухню и
-- отвечает (ok / error). iikoTransport для этого не нужен.
alter table public.waiter_orders add column if not exists venue text not null default 'petrogradka';
alter table public.waiter_orders add column if not exists guests int;
alter table public.waiter_orders add column if not exists waiter_iiko_id uuid;
alter table public.waiter_orders add column if not exists taken_at timestamptz;
alter table public.waiter_orders add column if not exists iiko_number int;
create index if not exists waiter_orders_queue on public.waiter_orders (venue, status) where status in ('queued','taken');
