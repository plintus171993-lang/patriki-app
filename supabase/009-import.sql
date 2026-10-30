-- ============================================================
-- Патрики Паб — обновление 009: перенос гостей из MACE Loyalty и правила как в MACE
--  • loyalty_imports — гости из старой системы (телефон, баланс, сумма покупок, уровень).
--    Баллы переходят на карту, когда гость подтверждает этот номер в приложении.
--    Пока приложения нет — бармен начисляет/списывает по телефону прямо на эту запись.
--  • особые уровни с фиксированным % (Директора, Сотрудники) — назначаются гостю вручную
--  • не начислять, если в чеке списаны баллы; начисление с задержкой N дней
-- Можно запускать повторно.
-- ============================================================

create table if not exists public.loyalty_imports (
  phone       text primary key,            -- последние 10 цифр
  name        text not null default '',
  birth_date  date,
  card_no     text not null default '',    -- номер карты в старой системе
  level       text not null default '',
  fixed_level text,                        -- особый уровень (Директора / Сотрудники)
  balance     int  not null default 0,
  spent       int  not null default 0,
  source      text not null default 'mace',
  claimed_by  uuid,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.loyalty_imports enable row level security;
drop policy if exists "imports admin read" on public.loyalty_imports;
create policy "imports admin read" on public.loyalty_imports for select to authenticated using (public.is_admin());

alter table public.loyalty_settings add column if not exists fixed_levels jsonb not null default '[]';
alter table public.loyalty_settings add column if not exists accrue_if_redeem boolean not null default true;
alter table public.loyalty_settings add column if not exists accrue_delay_days int not null default 0;
alter table public.loyalty_accounts add column if not exists fixed_level text;

alter table public.loyalty_tx alter column user_id drop not null;
alter table public.loyalty_tx add column if not exists import_phone text;
alter table public.loyalty_tx add column if not exists available_at timestamptz;   -- для отложенного начисления
alter table public.loyalty_tx drop constraint if exists loyalty_tx_kind_check;
alter table public.loyalty_tx add constraint loyalty_tx_kind_check
  check (kind in ('accrue','pending','redeem','refund','bonus','adjust','expire','reverse','import'));

-- правила, перенесённые из MACE Loyalty
update public.loyalty_settings set
  tiers = '[{"name":"Silver","from":0,"pct":3},{"name":"Gold","from":50000,"pct":5},{"name":"Platinum","from":120000,"pct":7},{"name":"Crypto","from":200000,"pct":10}]',
  fixed_levels = '[{"name":"Директора","pct":30},{"name":"Сотрудники","pct":20}]',
  max_redeem_pct = 20, welcome_bonus = 300, accrue_if_redeem = false, accrue_delay_days = 2, burn_after_days = 0, updated_at = now()
where id = 1;

-- уровень конкретного гостя: особый уровень важнее суммы покупок
create or replace function public.loyalty_tier_for(p_fixed text, p_spent int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.loyalty_settings := public.loyalty_cfg(); f jsonb;
begin
  if p_fixed is not null then
    select value into f from jsonb_array_elements(c.fixed_levels) where value->>'name' = p_fixed;
    if f is not null then return jsonb_build_object('name', f->>'name', 'from', 0, 'pct', (f->>'pct')::int, 'fixed', true, 'next_name', null, 'next_from', null); end if;
  end if;
  return public.loyalty_tier(p_spent);
end $$;

-- счёт гостя: + перенос из старой системы и созревание отложенных начислений
create or replace function public.loyalty_account(p_user uuid) returns public.loyalty_accounts
language plpgsql security definer set search_path = public, auth as $$
declare a public.loyalty_accounts; c public.loyalty_settings := public.loyalty_cfg(); bd date; no text; i int := 0; ph text; imp public.loyalty_imports; ripe int;
begin
  select * into a from public.loyalty_accounts where user_id = p_user for update;
  if not found then
    loop
      no := lpad((floor(random() * 90000000) + 10000000)::bigint::text, 8, '0');
      begin
        insert into public.loyalty_accounts (user_id, card_no) values (p_user, no) returning * into a;
        exit;
      exception when unique_violation then i := i + 1; if i > 20 then raise; end if;
      end;
    end loop;
  end if;

  -- перенос из старой системы: только по подтверждённому номеру
  if public.loyalty_verified(p_user) then
    select right(phone, 10) into ph from auth.users where id = p_user;
    select * into imp from public.loyalty_imports where phone = ph and claimed_by is null for update;
    if found then
      insert into public.loyalty_tx (user_id, kind, points, amount, source, note)
      values (p_user, 'import', imp.balance, imp.spent, 'system', 'Перенос баллов из прежней карты' || case when imp.card_no <> '' then ' № ' || imp.card_no else '' end);
      update public.loyalty_tx set user_id = p_user where import_phone = ph and user_id is null;
      update public.loyalty_accounts set balance = balance + imp.balance, spent_total = spent_total + imp.spent,
             fixed_level = coalesce(fixed_level, imp.fixed_level), welcome_given = true, last_activity_at = now()
       where user_id = p_user returning * into a;
      update public.loyalty_imports set claimed_by = p_user, claimed_at = now() where phone = ph;
      insert into public.profiles (id, name, birthday) values (p_user, imp.name, imp.birth_date)
      on conflict (id) do update set name = case when public.profiles.name = '' then excluded.name else public.profiles.name end,
                                     birthday = coalesce(public.profiles.birthday, excluded.birthday);
    end if;
  end if;

  -- отложенные начисления, срок которых наступил
  select coalesce(sum(points), 0) into ripe from public.loyalty_tx where user_id = p_user and kind = 'pending' and available_at <= now();
  if ripe > 0 then
    update public.loyalty_tx set kind = 'accrue' where user_id = p_user and kind = 'pending' and available_at <= now();
    update public.loyalty_accounts set balance = balance + ripe where user_id = p_user returning * into a;
  end if;

  if not c.enabled or (c.verified_only and not public.loyalty_verified(p_user)) then return a; end if;
  if c.burn_after_days > 0 and a.balance > 0 and a.last_activity_at < now() - make_interval(days => c.burn_after_days) then
    insert into public.loyalty_tx (user_id, kind, points, source, note) values (p_user, 'expire', -a.balance, 'system', 'Сгорели: давно не было покупок');
    update public.loyalty_accounts set balance = 0 where user_id = p_user returning * into a;
  end if;
  if c.welcome_bonus > 0 and not a.welcome_given then
    insert into public.loyalty_tx (user_id, kind, points, source, note) values (p_user, 'bonus', c.welcome_bonus, 'system', 'Приветственные баллы');
    update public.loyalty_accounts set balance = balance + c.welcome_bonus, welcome_given = true where user_id = p_user returning * into a;
  end if;
  select birthday into bd from public.profiles where id = p_user;
  if c.birthday_bonus > 0 and bd is not null and coalesce(a.birthday_year, 0) < extract(year from now())::int
     and abs(extract(doy from now()) - extract(doy from make_date(extract(year from now())::int, extract(month from bd)::int, least(extract(day from bd)::int, 28)))) <= 3 then
    insert into public.loyalty_tx (user_id, kind, points, source, note) values (p_user, 'bonus', c.birthday_bonus, 'system', 'С днём рождения!');
    update public.loyalty_accounts set balance = balance + c.birthday_bonus, birthday_year = extract(year from now())::int where user_id = p_user returning * into a;
  end if;
  return a;
end $$;

-- начисление: особый уровень, задержка
create or replace function public.loyalty_add(p_user uuid, p_amount int, p_source text, p_venue text, p_order uuid, p_ext text, p_staff uuid, p_note text default '')
returns int language plpgsql security definer set search_path = public as $$
declare c public.loyalty_settings := public.loyalty_cfg(); a public.loyalty_accounts; t jsonb; pts int; delayed boolean;
begin
  if not c.enabled or p_amount <= 0 then return 0; end if;
  if c.verified_only and not public.loyalty_verified(p_user) then return 0; end if;
  a := public.loyalty_account(p_user);
  t := public.loyalty_tier_for(a.fixed_level, public.loyalty_spent(p_user));
  pts := floor(p_amount * (t->>'pct')::numeric / 100);
  delayed := c.accrue_delay_days > 0;
  insert into public.loyalty_tx (user_id, kind, points, amount, pct, source, venue_id, order_id, ext_id, staff_id, note, available_at)
  values (p_user, case when delayed then 'pending' else 'accrue' end, pts, p_amount, (t->>'pct')::int, p_source, p_venue, p_order, p_ext, p_staff, coalesce(p_note, ''),
          case when delayed then now() + make_interval(days => c.accrue_delay_days) end);
  update public.loyalty_accounts set balance = balance + case when delayed then 0 else pts end, spent_total = spent_total + p_amount, last_activity_at = now() where user_id = p_user;
  return pts;
end $$;

-- сумма покупок за период: учитываем и отложенные
create or replace function public.loyalty_spent(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare c public.loyalty_settings := public.loyalty_cfg(); s int;
begin
  if c.period_days > 0 then
    select coalesce(sum(case when kind = 'reverse' then -amount else amount end), 0) into s
      from public.loyalty_tx where user_id = p_user and kind in ('accrue','pending','reverse','import') and created_at > now() - make_interval(days => c.period_days);
  else
    select spent_total into s from public.loyalty_accounts where user_id = p_user;
  end if;
  return coalesce(s, 0);
end $$;

-- для гостя: + отложенные баллы и особый уровень
create or replace function public.my_loyalty() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); a public.loyalty_accounts; c public.loyalty_settings := public.loyalty_cfg(); sp int; hist jsonb; pend int;
begin
  if me is null then raise exception 'Нет сессии'; end if;
  a := public.loyalty_account(me);
  sp := public.loyalty_spent(me);
  select coalesce(sum(points), 0) into pend from public.loyalty_tx where user_id = me and kind = 'pending';
  select coalesce(jsonb_agg(h order by h.created_at desc), '[]') into hist from (
    select t.kind, t.points, t.amount, t.pct, t.source, t.note, t.created_at, t.available_at, v.name as venue
    from public.loyalty_tx t left join public.venues v on v.id = t.venue_id
    where t.user_id = me order by t.created_at desc limit 30) h;
  return jsonb_build_object(
    'card_no', a.card_no, 'secret', a.secret, 'balance', a.balance, 'pending', pend, 'spent', sp,
    'tier', public.loyalty_tier_for(a.fixed_level, sp), 'verified', public.loyalty_verified(me), 'history', hist,
    'settings', jsonb_build_object('enabled', c.enabled, 'verified_only', c.verified_only, 'tiers', c.tiers, 'period_days', c.period_days,
      'max_redeem_pct', c.max_redeem_pct, 'app_enabled', c.app_enabled, 'venue_enabled', c.venue_enabled, 'app_min_order', c.app_min_order,
      'burn_after_days', c.burn_after_days, 'welcome_bonus', c.welcome_bonus, 'birthday_bonus', c.birthday_bonus, 'rules_text', c.rules_text,
      'accrue_if_redeem', c.accrue_if_redeem, 'accrue_delay_days', c.accrue_delay_days));
end $$;

-- поиск гостя: + гости из старой системы, ещё не установившие приложение
create or replace function public.loyalty_find_import(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select phone from public.loyalty_imports
   where claimed_by is null and length(regexp_replace(coalesce(p_code,''), '\D', '', 'g')) >= 10
     and phone = right(regexp_replace(p_code, '\D', '', 'g'), 10);
$$;

create or replace function public.loyalty_card_info(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare a public.loyalty_accounts; sp int; nm text; ph text; c public.loyalty_settings := public.loyalty_cfg();
begin
  a := public.loyalty_account(p_user); sp := public.loyalty_spent(p_user);
  select name into nm from public.profiles where id = p_user;
  select phone into ph from auth.users where id = p_user;
  return jsonb_build_object('card_no', a.card_no, 'name', coalesce(nullif(nm, ''), 'Гость'), 'phone_last4', right(coalesce(ph, ''), 4),
    'balance', a.balance, 'tier', public.loyalty_tier_for(a.fixed_level, sp), 'max_redeem_pct', c.max_redeem_pct,
    'active', c.enabled and (not c.verified_only or public.loyalty_verified(p_user)));
end $$;

create or replace function public.loyalty_import_info(p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.loyalty_imports; c public.loyalty_settings := public.loyalty_cfg();
begin
  select * into i from public.loyalty_imports where phone = p_phone;
  return jsonb_build_object('card_no', coalesce(nullif(i.card_no, ''), 'старая карта'), 'name', coalesce(nullif(i.name, ''), 'Гость'), 'phone_last4', right(i.phone, 4),
    'balance', i.balance, 'tier', public.loyalty_tier_for(i.fixed_level, i.spent), 'max_redeem_pct', c.max_redeem_pct, 'active', c.enabled, 'legacy', true);
end $$;

-- чек в заведении для гостя без приложения (запись из старой системы)
create or replace function public.loyalty_check_import(p_phone text, p_amount int, p_redeem int, p_venue text, p_source text, p_ext text, p_staff uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.loyalty_settings := public.loyalty_cfg(); i public.loyalty_imports; red int := greatest(coalesce(p_redeem, 0), 0); t jsonb; pts int := 0; base int;
begin
  if p_ext is not null and exists (select 1 from public.loyalty_tx where source = p_source and ext_id = p_ext) then
    return jsonb_build_object('duplicate', true, 'points', 0) || public.loyalty_import_info(p_phone);
  end if;
  if not c.enabled or not c.venue_enabled then raise exception 'Начисление в заведении выключено в настройках'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Укажите сумму чека'; end if;
  select * into i from public.loyalty_imports where phone = p_phone and claimed_by is null for update;
  if not found then raise exception 'Гость не найден'; end if;
  if red > i.balance then raise exception 'У гостя только % баллов', i.balance; end if;
  if red > floor(p_amount * c.max_redeem_pct / 100.0) then raise exception 'Баллами можно оплатить не больше % %% чека', c.max_redeem_pct; end if;
  if red > 0 then
    insert into public.loyalty_tx (import_phone, kind, points, amount, source, venue_id, ext_id, staff_id, note)
    values (p_phone, 'redeem', -red, p_amount, p_source, p_venue, case when p_ext is null then null else p_ext || ':r' end, p_staff, coalesce(p_note, ''));
  end if;
  base := p_amount - red;
  if base > 0 and (red = 0 or c.accrue_if_redeem) then
    t := public.loyalty_tier_for(i.fixed_level, i.spent);
    pts := floor(base * (t->>'pct')::numeric / 100);
    -- для гостей без приложения начисляем сразу (созревание отслеживается только на карте приложения)
    insert into public.loyalty_tx (import_phone, kind, points, amount, pct, source, venue_id, ext_id, staff_id, note)
    values (p_phone, 'accrue', pts, base, (t->>'pct')::int, p_source, p_venue, p_ext, p_staff, coalesce(p_note, ''));
  end if;
  update public.loyalty_imports set balance = balance - red + pts, spent = spent + case when pts > 0 then base else 0 end where phone = p_phone;
  return jsonb_build_object('points', pts, 'redeemed', red) || public.loyalty_import_info(p_phone);
end $$;

-- чек в заведении: правило «не начислять при списании»
create or replace function public.loyalty_check(p_user uuid, p_amount int, p_redeem int, p_venue text, p_source text, p_ext text, p_staff uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.loyalty_settings := public.loyalty_cfg(); a public.loyalty_accounts; red int := greatest(coalesce(p_redeem, 0), 0); pts int := 0; old public.loyalty_tx;
begin
  if p_ext is not null then
    select * into old from public.loyalty_tx where source = p_source and ext_id = p_ext and kind in ('accrue','pending');
    if found then return jsonb_build_object('duplicate', true, 'points', old.points) || public.loyalty_card_info(p_user); end if;
  end if;
  if not c.enabled or not c.venue_enabled then raise exception 'Начисление в заведении выключено в настройках'; end if;
  if c.verified_only and not public.loyalty_verified(p_user) then raise exception 'У гостя не подтверждён номер — баллы не копятся'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Укажите сумму чека'; end if;
  a := public.loyalty_account(p_user);
  if red > a.balance then raise exception 'У гостя только % баллов', a.balance; end if;
  if red > floor(p_amount * c.max_redeem_pct / 100.0) then raise exception 'Баллами можно оплатить не больше % %% чека', c.max_redeem_pct; end if;
  if red > 0 then
    insert into public.loyalty_tx (user_id, kind, points, amount, source, venue_id, ext_id, staff_id, note)
    values (p_user, 'redeem', -red, p_amount, p_source, p_venue, case when p_ext is null then null else p_ext || ':r' end, p_staff, coalesce(p_note, ''));
    update public.loyalty_accounts set balance = balance - red, last_activity_at = now() where user_id = p_user;
  end if;
  if red = 0 or c.accrue_if_redeem then
    pts := public.loyalty_add(p_user, p_amount - red, p_source, p_venue, null, p_ext, p_staff, p_note);
  end if;
  return jsonb_build_object('points', pts, 'redeemed', red, 'delay_days', c.accrue_delay_days) || public.loyalty_card_info(p_user);
end $$;

create or replace function public.staff_lookup(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; ip text;
begin
  if not public.is_admin() then raise exception 'Нет прав'; end if;
  u := public.loyalty_find(p_code);
  if u is not null then return public.loyalty_card_info(u) || jsonb_build_object('code', p_code); end if;
  ip := public.loyalty_find_import(p_code);
  if ip is not null then return public.loyalty_import_info(ip) || jsonb_build_object('code', p_code); end if;
  raise exception 'Гость не найден';
end $$;

create or replace function public.staff_accrue(p_code text, p_amount int, p_redeem int, p_venue text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; ip text;
begin
  if not public.can_manage(p_venue) then raise exception 'Нет доступа к этому заведению'; end if;
  u := public.loyalty_find(p_code);
  if u is not null then return public.loyalty_check(u, p_amount, p_redeem, p_venue, 'venue', null, auth.uid(), p_note); end if;
  ip := public.loyalty_find_import(p_code);
  if ip is not null then return public.loyalty_check_import(ip, p_amount, p_redeem, p_venue, 'venue', null, auth.uid(), p_note); end if;
  raise exception 'Гость не найден';
end $$;

create or replace function public.pos_lookup(p_key text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; ip text;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  u := public.loyalty_find(p_code);
  if u is not null then return public.loyalty_card_info(u); end if;
  ip := public.loyalty_find_import(p_code);
  if ip is not null then return public.loyalty_import_info(ip); end if;
  raise exception 'Гость не найден';
end $$;

create or replace function public.pos_accrue(p_key text, p_code text, p_amount int, p_redeem int, p_venue text, p_check_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; ip text;
begin
  if not public.pos_key_ok(p_key) then raise exception 'Неверный ключ кассы'; end if;
  if coalesce(p_check_id, '') = '' then raise exception 'Нужен номер чека'; end if;
  u := public.loyalty_find(p_code);
  if u is not null then return public.loyalty_check(u, p_amount, p_redeem, p_venue, 'pos', p_check_id, null, 'Касса'); end if;
  ip := public.loyalty_find_import(p_code);
  if ip is not null then return public.loyalty_check_import(ip, p_amount, p_redeem, p_venue, 'pos', p_check_id, null, 'Касса'); end if;
  raise exception 'Гость не найден';
end $$;

-- заказ из приложения: правило «не начислять при оплате баллами»
create or replace function public.orders_loyalty() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.loyalty_settings := public.loyalty_cfg(); base int; acc public.loyalty_tx;
begin
  if new.user_id is null or new.status is not distinct from old.status then return new; end if;
  if new.status = 'done' and c.enabled and c.app_enabled and (new.points_redeemed = 0 or c.accrue_if_redeem) then
    base := new.subtotal - new.points_redeemed + case when c.accrue_delivery then new.delivery_fee else 0 end;
    if base >= greatest(c.app_min_order, 1) and not exists (select 1 from public.loyalty_tx where order_id = new.id and kind in ('accrue','pending')) then
      perform public.loyalty_add(new.user_id, base, 'app', new.venue_id, new.id, null, null, 'Заказ №' || new.number);
    end if;
  elsif new.status = 'cancelled' then
    if new.points_redeemed > 0 and not exists (select 1 from public.loyalty_tx where order_id = new.id and kind = 'refund') then
      insert into public.loyalty_tx (user_id, kind, points, source, venue_id, order_id, note)
      values (new.user_id, 'refund', new.points_redeemed, 'app', new.venue_id, new.id, 'Возврат баллов: заказ №' || new.number || ' отменён');
      update public.loyalty_accounts set balance = balance + new.points_redeemed where user_id = new.user_id;
    end if;
    select * into acc from public.loyalty_tx where order_id = new.id and kind in ('accrue','pending');
    if found and not exists (select 1 from public.loyalty_tx where order_id = new.id and kind = 'reverse') then
      if acc.kind = 'pending' then
        update public.loyalty_tx set kind = 'reverse', points = 0, note = 'Отмена начисления: заказ №' || new.number where id = acc.id;
        update public.loyalty_accounts set spent_total = greatest(spent_total - acc.amount, 0) where user_id = new.user_id;
      else
        insert into public.loyalty_tx (user_id, kind, points, amount, source, venue_id, order_id, note)
        values (new.user_id, 'reverse', -least(acc.points, (select balance from public.loyalty_accounts where user_id = new.user_id)), acc.amount, 'app', new.venue_id, new.id, 'Отмена начисления: заказ №' || new.number);
        update public.loyalty_accounts set balance = greatest(balance - acc.points, 0), spent_total = greatest(spent_total - acc.amount, 0) where user_id = new.user_id;
      end if;
    end if;
  end if;
  return new;
end $$;

-- особый уровень гостю (владелец): по телефону или номеру карты
create or replace function public.set_fixed_level(p_code text, p_level text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; ip text;
begin
  if not public.is_owner() then raise exception 'Только владелец'; end if;
  u := public.loyalty_find(p_code);
  if u is not null then
    perform public.loyalty_account(u);
    update public.loyalty_accounts set fixed_level = nullif(p_level, '') where user_id = u;
    return public.loyalty_card_info(u);
  end if;
  ip := public.loyalty_find_import(p_code);
  if ip is not null then update public.loyalty_imports set fixed_level = nullif(p_level, '') where phone = ip; return public.loyalty_import_info(ip); end if;
  raise exception 'Гость не найден';
end $$;
grant execute on function public.set_fixed_level(text, text) to authenticated;

revoke execute on function public.loyalty_check_import(text, int, int, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.loyalty_import_info(text) from public, anon, authenticated;
revoke execute on function public.loyalty_find_import(text) from public, anon, authenticated;
revoke execute on function public.loyalty_account(uuid) from public, anon, authenticated;
revoke execute on function public.loyalty_add(uuid, int, text, text, uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.loyalty_check(uuid, int, int, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.loyalty_card_info(uuid) from public, anon, authenticated;

create or replace function public.loyalty_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then jsonb_build_object(
    'guests', (select count(*) from public.loyalty_accounts where spent_total > 0 or balance > 0),
    'balance', (select coalesce(sum(balance), 0) from public.loyalty_accounts) + (select coalesce(sum(balance), 0) from public.loyalty_imports where claimed_by is null),
    'accrued_30', (select coalesce(sum(points), 0) from public.loyalty_tx where kind in ('accrue','pending','bonus') and created_at > now() - interval '30 days'),
    'redeemed_30', (select coalesce(-sum(points), 0) from public.loyalty_tx where kind = 'redeem' and created_at > now() - interval '30 days'),
    'imported', (select count(*) from public.loyalty_imports),
    'imported_claimed', (select count(*) from public.loyalty_imports where claimed_by is not null))
  else null end;
$$;
