-- 031: «Ланч-карта» — каждый N-й ланч в подарок (по умолчанию 5-й).
-- Отдельно от баллов: свои настройки, свой счётчик штампов, свой журнал.
--
-- Как работает:
--  • гость показывает QR приложения, бармен нажимает «Карта Патрики» — как для баллов;
--  • при закрытии чека плагин отправляет позиции (front-close) → pos_lunch_close ставит штампы
--    за оплаченные ланчи (позиции из lunch_settings.product_ids), не больше max_per_day в день;
--  • набрал goal−1 штампов (оплаченных ланчей) → goal-й ланч на кассе «в подарок»: pos_lunch_gift списывает их и
--    держит подарок за заказом iiko; закрыли заказ — подарок проведён, удалили / убрали скидку — штампы вернулись.
-- Повторный запуск безопасен.

create table if not exists public.lunch_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  goal int not null default 5 check (goal between 2 and 20),          -- каждый goal-й ланч в подарок: goal−1 оплаченных, goal-й бесплатно
  max_per_day int not null default 1 check (max_per_day >= 0),       -- штампов в день на гостя (0 — без ограничения)
  product_ids text[] not null default '{}',                          -- id позиций iiko, которые считаются ланчем
  title text not null default 'Каждый 5-й ланч в подарок',
  rules_text text,
  expire_days int check (expire_days is null or expire_days > 0),    -- штампы сгорают, если столько дней не было ланчей
  updated_at timestamptz not null default now()
);
insert into public.lunch_settings (id, enabled, product_ids)
values (1, false, array['0b0306bd-730a-4c15-a285-0331a3904406'])   -- «Ланч» 590 ₽, Блюда Кухня
on conflict (id) do nothing;

create table if not exists public.lunch_cards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stamps int not null default 0 check (stamps >= 0),
  paid_total int not null default 0,     -- всего оплаченных ланчей по акции
  gifts_total int not null default 0,    -- всего подаренных
  last_stamp_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.lunch_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('stamp', 'gift', 'adjust', 'expire')),
  qty int not null,                       -- штампы: + за ланчи, − за подарок / сгорание
  status text check (status in ('held', 'closed', 'returned')),   -- только для подарка
  check_id text,                          -- 'iiko:<id заказа>' для штампов
  iiko_order text,
  venue_id text,
  note text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists lunch_log_stamp_check on public.lunch_log (check_id) where kind = 'stamp';
create index if not exists lunch_log_user on public.lunch_log (user_id, created_at desc);
create index if not exists lunch_log_order on public.lunch_log (iiko_order) where kind = 'gift';

alter table public.lunch_settings enable row level security;
alter table public.lunch_cards enable row level security;
alter table public.lunch_log enable row level security;
drop policy if exists "lunch settings read" on public.lunch_settings;
create policy "lunch settings read" on public.lunch_settings for select to anon, authenticated using (true);
drop policy if exists "lunch settings owner" on public.lunch_settings;
create policy "lunch settings owner" on public.lunch_settings for update to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "lunch cards own" on public.lunch_cards;
create policy "lunch cards own" on public.lunch_cards for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "lunch log own" on public.lunch_log;
create policy "lunch log own" on public.lunch_log for select to authenticated using (user_id = auth.uid() or public.is_admin());

create or replace function public.lunch_cfg() returns public.lunch_settings
language sql stable security definer set search_path = public as $$
  select * from public.lunch_settings where id = 1;
$$;

-- карточка гостя (создаёт пустую при первом обращении); сгорание штампов по expire_days
create or replace function public.lunch_card(p_user uuid) returns public.lunch_cards
language plpgsql security definer set search_path = public as $$
declare c public.lunch_settings := public.lunch_cfg(); k public.lunch_cards;
begin
  insert into public.lunch_cards (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into k from public.lunch_cards where user_id = p_user for update;
  if c.expire_days is not null and k.stamps > 0 and k.last_stamp_at < now() - make_interval(days => c.expire_days) then
    insert into public.lunch_log (user_id, kind, qty, note) values (p_user, 'expire', -k.stamps, 'Штампы сгорели: давно не было ланчей');
    update public.lunch_cards set stamps = 0, updated_at = now() where user_id = p_user returning * into k;
  end if;
  return k;
end $$;

-- состояние для кассы и приложения
create or replace function public.lunch_state(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.lunch_settings := public.lunch_cfg(); k public.lunch_cards; held int;
begin
  if p_user is null or not coalesce(c.enabled, false) then return jsonb_build_object('enabled', false); end if;
  k := public.lunch_card(p_user);
  select count(*) into held from public.lunch_log where user_id = p_user and kind = 'gift' and status = 'held';
  return jsonb_build_object('enabled', true, 'goal', c.goal, 'stamps', k.stamps,
    'ready', k.stamps >= c.goal - 1, 'left', greatest(c.goal - k.stamps, 1),
    'paid_total', k.paid_total, 'gifts_total', k.gifts_total, 'held', held,
    'max_per_day', c.max_per_day, 'title', c.title, 'product_ids', to_jsonb(c.product_ids));
end $$;

-- подарок не проведён за сутки (заказ закрыли на кассе без плагина) — считаем выданным
create or replace function public.lunch_gift_expire() returns void
language sql security definer set search_path = public as $$
  update public.lunch_log set status = 'closed', finished_at = now(), note = coalesce(note, '') || ' · закрыт автоматически'
  where kind = 'gift' and status = 'held' and created_at < now() - interval '24 hours';
$$;

/* ---------- касса (ключ кассы) ---------- */

create or replace function public.pos_lunch_info(p_key text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  begin
    return public.lunch_state(public.loyalty_find(p_code));
  exception when others then
    return jsonb_build_object('enabled', false);   -- ланч-карта не должна ломать поиск гостя
  end;
end $$;

-- «Ланч в подарок»: только по свежему QR из приложения; списывает goal штампов и держит подарок за заказом
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
  k := public.lunch_card(u);
  if k.stamps < c.goal - 1 then raise exception 'До подарка ещё % оплаченных ланч(а)', c.goal - 1 - k.stamps; end if;
  insert into public.lunch_log (user_id, kind, qty, status, iiko_order, venue_id, note)
  values (u, 'gift', -(c.goal - 1), 'held', p_order, p_venue, 'Ланч в подарок') returning * into g;
  update public.lunch_cards set stamps = stamps - (c.goal - 1), gifts_total = gifts_total + 1, updated_at = now() where user_id = u;
  return jsonb_build_object('id', g.id) || public.lunch_state(u);
end $$;

create or replace function public.pos_lunch_gift_cancel(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.lunch_log;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  update public.lunch_log set status = 'returned', finished_at = now() where id = p_id and kind = 'gift' and status = 'held' returning * into g;
  if not found then return jsonb_build_object('returned', false); end if;
  update public.lunch_cards set stamps = stamps - g.qty, gifts_total = greatest(gifts_total - 1, 0), updated_at = now() where user_id = g.user_id;
  return jsonb_build_object('returned', true) || public.lunch_state(g.user_id);
end $$;

-- закрытие чека: проводим / возвращаем подарок, ставим штампы за оплаченные ланчи.
-- p_items — позиции чека [{productId, amount, sum}], p_gift — в заказе осталась скидка «Ланч в подарок» (null — неизвестно, старый плагин)
create or replace function public.pos_lunch_close(p_key text, p_code text, p_order text, p_venue text, p_items jsonb, p_gift boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.lunch_settings := public.lunch_cfg(); u uuid; k public.lunch_cards; g record;
  gifts int := 0; v_qty int; v_today int; v_allow int; v_add int; chk text := 'iiko:' || coalesce(p_order, '');
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  if coalesce(p_order, '') = '' then return jsonb_build_object('enabled', false); end if;
  -- подарки, удержанные за этим заказом
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
  -- ланчи в чеке минус подаренные
  select coalesce(sum(floor((x->>'amount')::numeric)), 0)::int into v_qty
  from jsonb_array_elements(coalesce(p_items, '[]')) x
  where (x->>'productId') = any(c.product_ids) and coalesce((x->>'amount')::numeric, 0) > 0;
  v_qty := greatest(v_qty - gifts, 0);
  if v_qty = 0 then return public.lunch_state(u) || jsonb_build_object('added', 0, 'gifts', gifts); end if;
  select coalesce(sum(l.qty), 0) into v_today from public.lunch_log l
  where l.user_id = u and kind = 'stamp' and (created_at at time zone 'Europe/Moscow')::date = (now() at time zone 'Europe/Moscow')::date;
  v_allow := case when c.max_per_day = 0 then v_qty else greatest(c.max_per_day - v_today, 0) end;
  v_add := least(v_qty, v_allow);
  if v_add > 0 then
    insert into public.lunch_log (user_id, kind, qty, check_id, iiko_order, venue_id, note)
    values (u, 'stamp', v_add, chk, p_order, p_venue, 'Ланч на кассе');
    update public.lunch_cards set stamps = stamps + v_add, paid_total = paid_total + v_add, last_stamp_at = now(), updated_at = now() where user_id = u;
  end if;
  return public.lunch_state(u) || jsonb_build_object('added', v_add, 'gifts', gifts,
    'note', case when v_add < v_qty then 'штамп за ланч — не больше ' || c.max_per_day || ' в день' end);
end $$;

/* ---------- приложение гостя ---------- */
create or replace function public.my_lunch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.lunch_settings := public.lunch_cfg(); hist jsonb;
begin
  if me is null then raise exception 'Нет сессии'; end if;
  if not coalesce(c.enabled, false) then return jsonb_build_object('enabled', false); end if;
  select coalesce(jsonb_agg(h order by h.created_at desc), '[]') into hist from (
    select l.kind, l.qty, l.status, l.note, l.created_at, v.name as venue
    from public.lunch_log l left join public.venues v on v.id = l.venue_id
    where l.user_id = me and not (l.kind = 'gift' and l.status = 'returned')
    order by l.created_at desc limit 20) h;
  return public.lunch_state(me) || jsonb_build_object('history', hist, 'rules_text', c.rules_text, 'expire_days', c.expire_days);
end $$;

-- управляющий: сводка по акции (для админки и утренней сводки)
create or replace function public.lunch_stats(p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Нет прав'; end if;
  return jsonb_build_object(
    'stamps', (select coalesce(sum(qty), 0) from public.lunch_log where kind = 'stamp' and created_at >= p_from and created_at < p_to),
    'gifts', (select count(*) from public.lunch_log where kind = 'gift' and status in ('held', 'closed') and created_at >= p_from and created_at < p_to),
    'guests', (select count(distinct user_id) from public.lunch_log where kind = 'stamp' and created_at >= p_from and created_at < p_to),
    'ready', (select count(*) from public.lunch_cards k where k.stamps >= (select goal - 1 from public.lunch_settings where id = 1)));
end $$;

revoke all on function public.lunch_card(uuid), public.lunch_state(uuid), public.lunch_gift_expire() from public, anon, authenticated;
grant execute on function public.pos_lunch_info(text, text), public.pos_lunch_gift(text, text, text, text),
  public.pos_lunch_gift_cancel(text, uuid), public.pos_lunch_close(text, text, text, text, jsonb, boolean) to anon, authenticated;
grant execute on function public.my_lunch() to authenticated;
grant execute on function public.lunch_stats(timestamptz, timestamptz) to authenticated;
