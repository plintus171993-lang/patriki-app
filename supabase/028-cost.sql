-- =====================================================================
--  Обновление 028: «Себестоимость» в «Патрики Офис» — контроль техкарт и цен поставщиков
--
--  Каждую ночь функция cost-check читает из iiko (iikoServer API, те же доступы
--  app_secrets.iiko_server_url / _login / _password, только чтение):
--    номенклатуру и группы, действующие техкарты, продажи блюд за 30 дней (OLAP),
--    приходные накладные за 120 дней — и записывает найденные проблемы в cost_issues:
--      no_chart            блюдо продаётся, а техкарты нет (продажа ничего не списывает)
--      deleted_ingredient  в техкарте удалённый товар
--      stale_ingredient    ингредиент техкарты давно не закупался (заменили, а карту не поправили)
--      price_jump          закупочная цена выросла к прошлой поставке
--      foodcost            себестоимость по последним ценам выше порога к средней цене продажи
--  Проблема, которой больше нет, закрывается сама (resolved_at). Управляющий может пометить
--  «не проблема» (muted) — тогда она не попадает в сводку.
--  Утром — одно сообщение управляющему в Telegram: telegram_chat_id:cost,
--  иначе чат заведения telegram_chat_id:petrogradka, иначе общий telegram_chat_id.
--
--  Права: владелец — всё; управляющий — галочка «Себестоимость» (cost.view) во вкладке «Доступы».
--  Можно запускать повторно.
-- =====================================================================

create table if not exists public.cost_issues (
  id          bigint generated always as identity primary key,
  key         text not null unique,                 -- вид:товар[:ингредиент] — по нему проблема узнаётся при следующей проверке
  venue_id    text references public.venues(id),
  kind        text not null,
  severity    text not null default 'warn' check (severity in ('info', 'warn', 'crit')),
  product_id  uuid,                                 -- блюдо / заготовка / товар iiko
  product_name text,
  section     text,                                 -- «Бар» / «Кухня» (по группе номенклатуры iiko)
  details     jsonb not null default '{}',
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  resolved_at timestamptz,                          -- null — проблема есть сейчас
  muted       boolean not null default false,       -- «не проблема» — не показывать в сводке
  note        text,
  updated_by  uuid
);
create index if not exists cost_issues_open on public.cost_issues (kind) where resolved_at is null;

create table if not exists public.cost_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  trigger     text,                                 -- cron / manual
  ok          boolean,
  stats       jsonb,
  error       text
);

create table if not exists public.cost_settings (
  id         text primary key default 'main' check (id = 'main'),
  params     jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.cost_settings (id, params) values ('main', jsonb_build_object(
  'price_jump_pct', 10,          -- рост цены к прошлой поставке: сигнал
  'price_jump_crit_pct', 25,     -- …срочно
  'price_window_days', 14,       -- смотреть поставки последних N дней
  'foodcost_kitchen_pct', 35,
  'foodcost_bar_pct', 30,        -- разлив, коктейли
  'foodcost_bottle_pct', 50,     -- бутылочное / штучное (техкарта из одного товара)
  'stale_days', 60,              -- ингредиент не закупался
  'sales_days', 30               -- «продаётся» = были продажи за N дней
)) on conflict (id) do nothing;

alter table public.cost_issues   enable row level security;
alter table public.cost_runs     enable row level security;
alter table public.cost_settings enable row level security;

drop policy if exists "cost read" on public.cost_issues;
drop policy if exists "cost mute" on public.cost_issues;
drop policy if exists "cost runs read" on public.cost_runs;
drop policy if exists "cost settings read" on public.cost_settings;
drop policy if exists "cost settings owner" on public.cost_settings;
create policy "cost read" on public.cost_issues for select using (public.crm_can('cost.view') and (venue_id is null or public.can_manage(venue_id)));
create policy "cost mute" on public.cost_issues for update using (public.crm_can('cost.view') and (venue_id is null or public.can_manage(venue_id)))
  with check (public.crm_can('cost.view') and (venue_id is null or public.can_manage(venue_id)));
create policy "cost runs read" on public.cost_runs for select using (public.crm_can('cost.view'));
create policy "cost settings read" on public.cost_settings for select using (public.crm_can('cost.view'));
create policy "cost settings owner" on public.cost_settings for update using (public.is_owner()) with check (public.is_owner());

-- управляющий меняет только «не проблема» и заметку, остальное пишет функция
revoke update on public.cost_issues from authenticated;
grant select on public.cost_issues, public.cost_runs, public.cost_settings to authenticated;
grant update (muted, note, updated_by) on public.cost_issues to authenticated;
grant update (params, updated_at, updated_by) on public.cost_settings to authenticated;

-- ---------- расписание (время сервера — UTC) ----------
-- 04:20 МСК — проверка; 09:10 МСК — сводка в Telegram
select cron.unschedule('cost-check-nightly') where exists (select 1 from cron.job where jobname = 'cost-check-nightly');
select cron.schedule('cost-check-nightly', '20 1 * * *', $cron$
  select net.http_post(
    url := 'https://ozbdmczmpejyctezxrdk.supabase.co/functions/v1/cost-check',
    headers := jsonb_build_object('Content-Type','application/json','x-pos-key',(select value from public.app_secrets where key = 'pos_api_key')),
    body := '{"action":"check","venue":"petrogradka","trigger":"cron"}'::jsonb,
    timeout_milliseconds := 150000);
$cron$);
select cron.unschedule('cost-digest-morning') where exists (select 1 from cron.job where jobname = 'cost-digest-morning');
select cron.schedule('cost-digest-morning', '10 6 * * *', $cron$
  select net.http_post(
    url := 'https://ozbdmczmpejyctezxrdk.supabase.co/functions/v1/cost-check',
    headers := jsonb_build_object('Content-Type','application/json','x-pos-key',(select value from public.app_secrets where key = 'pos_api_key')),
    body := '{"action":"digest","venue":"petrogradka"}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
