-- =====================================================================
--  Обновление 024: «Склад» в приложении официантов — остатки из iiko и заказ
--
--  Остатки берутся с сервера iiko (iikoServer API, облако *.iiko.it) по ключам
--  app_secrets: iiko_server_url, iiko_server_login, iiko_server_password.
--  Каждый запрос — вход, чтение, выход (вход занимает лицензию iiko, поэтому
--  сессия сразу закрывается). Результат кэшируется на 5 минут.
--
--  Доступ: управляющий (role = manager) видит и умеет всё. Остальным управляющий
--  выдаёт права в карточке сотрудника (waiter_staff.perms):
--    stock_view  — видит остатки и список «надо заказать»
--    stock_order — оформляет заказ поставщику (включает stock_view)
--    stock_setup — выбирает позиции и задаёт минимальные остатки (включает stock_view)
--  Бармен без прав не видит раздел вовсе, сервер ему тоже ничего не отдаёт.
--
--  Telegram для заказов (необязательно): app_secrets.telegram_chat_id:stock,
--  иначе — чат заведения telegram_chat_id:<venue>, иначе telegram_chat_id.
--  Можно запускать повторно.
-- =====================================================================

alter table public.waiter_staff add column if not exists perms text[] not null default '{}';

-- ---------- позиции, за которыми следим ----------
create table if not exists public.stock_items (
  product_id   uuid primary key,             -- товар iiko (ингредиент / товар, не блюдо)
  name         text not null,
  unit         text,                         -- единица iiko: л, кг, шт
  store_id     uuid,                         -- склад iiko; null — все склады вместе
  min_qty      numeric not null default 0,   -- минимальный остаток, в единицах iiko
  max_qty      numeric,                      -- «заказывать до», в единицах iiko
  portion      numeric,                      -- порция в единицах iiko (0.5 л)…
  portion_name text,                         -- …и как она называется («бокал»)
  pack         numeric,                      -- упаковка поставщика (20 л)…
  pack_name    text,                         -- …и её название («кега»)
  supplier     text,
  section      text,                         -- бар / кухня — для фильтра
  active       boolean not null default true,
  updated_by   uuid references public.waiter_staff(id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- ---------- заказы поставщикам ----------
create table if not exists public.stock_orders (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid references public.waiter_staff(id) on delete set null,
  supplier   text,
  items      jsonb not null,                 -- [{productId, name, qty, unit, packs, packName}]
  note       text,
  status     text not null default 'new' check (status in ('new', 'received', 'cancelled')),
  telegram   boolean not null default false, -- ушёл ли в Telegram
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_orders_created on public.stock_orders (created_at desc);

-- закрыто для приложения: читать и писать может только серверная функция waiter
alter table public.stock_items  enable row level security;
alter table public.stock_orders enable row level security;
