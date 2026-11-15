-- ============================================================
-- Патрики Паб — обновление 020: сайт веселый-патрик.рф
--  • news — новости, акции и мероприятия (афиша) для сайта; правит владелец в админке → «Сайт»
--  • event_requests — заявки на банкеты: дни рождения, корпоративы, свадьбы, аренда зала.
--    Заявка уходит в Telegram-чат паба и в общий чат владельца.
-- Можно запускать повторно.
-- ============================================================

create table if not exists public.news (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'news' check (kind in ('news','promo','event')),
  title       text not null,
  body        text not null default '',
  image_url   text not null default '',
  venue_id    text references public.venues(id) on delete set null,   -- пусто = оба паба
  event_at    timestamptz,                                           -- для мероприятий: когда
  starts_on   date,                                                  -- показывать с
  ends_on     date,                                                  -- показывать по (включительно); пусто = без срока
  published   boolean not null default true,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists news_pub_idx on public.news (published, pinned desc, created_at desc);
alter table public.news enable row level security;

drop policy if exists "news public read" on public.news;
drop policy if exists "news owner all" on public.news;
create policy "news public read" on public.news for select to anon, authenticated
  using (published and (starts_on is null or starts_on <= (now() at time zone 'Europe/Moscow')::date)
                   and (ends_on is null or ends_on >= (now() at time zone 'Europe/Moscow')::date));
create policy "news owner all" on public.news for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select on public.news to anon, authenticated;
grant insert, update, delete on public.news to authenticated;

-- ---------- заявки на мероприятия ----------
create sequence if not exists public.event_requests_number_seq start 101;
create table if not exists public.event_requests (
  id          uuid primary key default gen_random_uuid(),
  number      int not null default nextval('public.event_requests_number_seq'),
  user_id     uuid references auth.users(id) on delete set null,
  venue_id    text references public.venues(id) on delete set null,
  kind        text not null default 'other' check (kind in ('birthday','corporate','wedding','banquet','rent','other')),
  event_date  date,
  guests      int,
  format      text not null default '',     -- часть зала / весь зал / закрытие паба
  budget      text not null default '',
  name        text not null,
  phone       text not null,
  comment     text not null default '',
  status      text not null default 'new' check (status in ('new','in_work','done','cancelled')),
  staff_note  text not null default '',
  source      text not null default 'site',
  pd_consent_version text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists event_requests_created_idx on public.event_requests (created_at desc);
alter table public.event_requests enable row level security;

drop policy if exists "event_requests own read" on public.event_requests;
drop policy if exists "event_requests admin read" on public.event_requests;
create policy "event_requests own read" on public.event_requests for select to authenticated using (user_id = auth.uid());
create policy "event_requests admin read" on public.event_requests for select to authenticated
  using (public.can_manage(coalesce(venue_id, '')) or public.is_owner());
grant select on public.event_requests to authenticated;

create or replace function public.event_kind_ru(k text) returns text language sql immutable as $$
  select case k when 'birthday' then 'День рождения' when 'corporate' then 'Корпоратив' when 'wedding' then 'Свадьба'
    when 'banquet' then 'Банкет' when 'rent' then 'Аренда зала' else 'Мероприятие' end;
$$;

create or replace function public.event_request_notify(r public.event_requests, p_head text) returns void
language plpgsql security definer set search_path = public as $$
declare venue_chat text; owner_chat text; msg text;
begin
  msg := format(E'%s №%s · %s\n📍 %s\n🗓 %s\n👥 %s\n%s%s%s, %s%s',
    p_head, r.number, public.event_kind_ru(r.kind),
    coalesce(upper((select name from public.venues where id = r.venue_id)), 'Паб не выбран'),
    coalesce(to_char(r.event_date, 'DD.MM.YYYY'), 'дата не выбрана'),
    coalesce(r.guests::text || ' гостей', 'гостей не указано'),
    case when r.format <> '' then 'Формат: ' || r.format || E'\n' else '' end,
    case when r.budget <> '' then 'Бюджет: ' || r.budget || E'\n' else '' end,
    r.name, r.phone,
    case when r.comment <> '' then E'\nПожелания: ' || r.comment else '' end);
  if r.venue_id is not null then select value into venue_chat from public.app_secrets where key = 'telegram_chat_id:' || r.venue_id; end if;
  select value into owner_chat from public.app_secrets where key = 'telegram_chat_id';
  if venue_chat is not null then perform public.tg_send(venue_chat, msg); end if;
  if owner_chat is not null and owner_chat is distinct from venue_chat then perform public.tg_send(owner_chat, msg); end if;
exception when others then null;
end $$;
revoke execute on function public.event_request_notify(public.event_requests, text) from public, anon, authenticated;

-- заявка от гостя (анонимный профиль подходит)
create or replace function public.submit_event_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.event_requests; ph text; nm text; d date; g int; recent int;
begin
  if auth.uid() is null then raise exception 'Нет входа — обновите страницу'; end if;
  if coalesce((p->>'pd_consent')::boolean, false) is not true then raise exception 'Нужно согласие на обработку персональных данных'; end if;
  nm := left(trim(coalesce(p->>'name', '')), 80);
  ph := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  if nm = '' then raise exception 'Укажите имя'; end if;
  if length(ph) < 10 then raise exception 'Укажите телефон полностью'; end if;
  select count(*) into recent from public.event_requests where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent >= 5 then raise exception 'Заявок слишком много — позвоните нам, пожалуйста'; end if;
  d := nullif(p->>'event_date', '')::date;
  if d is not null and (d < (now() at time zone 'Europe/Moscow')::date or d > (now() at time zone 'Europe/Moscow')::date + 400) then
    raise exception 'Проверьте дату мероприятия';
  end if;
  g := nullif(p->>'guests', '')::int;
  if g is not null and (g < 1 or g > 500) then raise exception 'Проверьте число гостей'; end if;
  insert into public.event_requests (user_id, venue_id, kind, event_date, guests, format, budget, name, phone, comment, source, pd_consent_version)
  values (auth.uid(),
    (select id from public.venues where id = nullif(p->>'venue_id', '')),
    case when p->>'kind' in ('birthday','corporate','wedding','banquet','rent') then p->>'kind' else 'other' end,
    d, g, left(coalesce(p->>'format', ''), 80), left(coalesce(p->>'budget', ''), 80), nm, left(coalesce(p->>'phone', ''), 30),
    left(coalesce(p->>'comment', ''), 1000), left(coalesce(p->>'source', 'site'), 20), p->>'pd_consent_version')
  returning * into r;
  perform public.event_request_notify(r, '🎉 Заявка на мероприятие');
  return jsonb_build_object('id', r.id, 'number', r.number);
end $$;
grant execute on function public.submit_event_request(jsonb) to authenticated;

create or replace function public.set_event_request(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.event_requests;
begin
  select * into r from public.event_requests where id = p_id;
  if not found then raise exception 'Заявка не найдена'; end if;
  if not (public.is_owner() or public.can_manage(coalesce(r.venue_id, ''))) then raise exception 'Нет прав'; end if;
  if p_status not in ('new','in_work','done','cancelled') then raise exception 'Неверный статус'; end if;
  update public.event_requests set status = p_status, staff_note = coalesce(p_note, staff_note), updated_at = now() where id = p_id;
end $$;
grant execute on function public.set_event_request(uuid, text, text) to authenticated;

-- стартовые записи (только если новостей ещё нет); дальше владелец правит их в админке → «Сайт»
insert into public.news (kind, title, body, pinned)
select * from (values
  ('promo', '300 баллов за карту гостя', E'Войдите по номеру телефона на сайте или в приложении — за выпуск карты гостя дарим 300 приветственных баллов. Дальше копите 3% с каждого заказа и посещения, а баллами оплачивайте до 20% счёта.', true),
  ('promo', 'Доставка из паба — бесплатно', E'Привезём брискет, крылья из смокера, бургеры и закуски к пиву примерно за 45 минут. Доставляем по Петроградской стороне каждый день с 12:00 до 01:00.', false),
  ('news',  'Скоро открываемся в Мурино', E'Второй «Патрики» — на Екатерининской, 16/5. Уже принимаем заявки на банкеты и праздники после открытия: оставьте заявку в разделе «Мероприятия».', false)
) v(kind, title, body, pinned)
where not exists (select 1 from public.news);
