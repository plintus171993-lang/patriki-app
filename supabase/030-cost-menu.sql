-- =====================================================================
--  Обновление 030: «Себестоимость» → вкладка «Все блюда»
--
--  Каждая проверка (ночью и по кнопке «Проверить сейчас») пересчитывает по всем блюдам iiko:
--  средняя цена продажи за 30 дней, себестоимость по техкарте и последним ценам прихода,
--  фудкост, маржа с порции и за 30 дней, и что с блюдом не так (severity crit / warn / ok + причины).
--  В Офисе: сначала срочные, потом «внимание», потом остальные — от самых невыгодных к самым выгодным.
--  Можно запускать повторно.
-- =====================================================================
create table if not exists public.cost_menu (
  venue_id     text not null references public.venues(id),
  product_id   uuid not null,
  name         text not null,
  section      text,                      -- «Бар» / «Кухня»
  grp          text,                      -- группа номенклатуры iiko
  price        numeric,                   -- средняя цена продажи за 30 дней (с учётом скидок)
  cost         numeric,                   -- себестоимость порции
  cost_full    boolean not null default false, -- у всех ингредиентов есть цена
  foodcost_pct numeric,
  limit_pct    numeric,                   -- норма фудкоста для раздела
  margin       numeric,                   -- цена − себестоимость, ₽ с порции
  sold_qty     numeric not null default 0,
  sold_sum     numeric not null default 0,
  margin_total numeric,                   -- маржа за 30 дней
  severity     text not null default 'ok' check (severity in ('crit', 'warn', 'ok')),
  reasons      jsonb not null default '[]',
  updated_at   timestamptz not null default now(),
  primary key (venue_id, product_id)
);
alter table public.cost_menu enable row level security;
drop policy if exists "cost menu read" on public.cost_menu;
create policy "cost menu read" on public.cost_menu for select using (public.crm_can('cost.view') and public.can_manage(venue_id));
grant select on public.cost_menu to authenticated;
