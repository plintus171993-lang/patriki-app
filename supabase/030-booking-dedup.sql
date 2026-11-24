-- 030 · Бронь стола: защита от дублей (24.11.2026)
--  • запросы одного гостя выполняются по очереди (двойное нажатие больше не создаёт две брони)
--  • есть бронь «ждёт подтверждения» → «Вы уже забронировали стол… Ожидайте подтверждения»
--  • есть подтверждённая бронь в этом пабе на ±3 ч → «У вас уже есть подтверждённая бронь…»
create or replace function public.place_reservation(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v public.venues; r public.reservations; ex public.reservations; ts timestamptz; g int; ph text; nm text;
begin
  if auth.uid() is null then raise exception 'Нет входа'; end if;
  if coalesce((p->>'pd_consent')::boolean, false) is not true then raise exception 'Нужно согласие на обработку персональных данных'; end if;
  select * into v from public.venues where id = p->>'venue_id';
  if not found then raise exception 'Заведение не найдено'; end if;
  if not v.booking_enabled or v.accepting = false then raise exception 'Бронирование в этом заведении пока недоступно'; end if;
  ts := (p->>'starts_at')::timestamptz;
  if ts is null or ts < now() + interval '30 minutes' then raise exception 'Выберите время хотя бы через 30 минут'; end if;
  if ts > now() + interval '60 days' then raise exception 'Бронь — не дальше чем на 60 дней вперёд'; end if;
  g := coalesce((p->>'guests')::int, 0);
  if g < 1 or g > v.booking_max_guests then raise exception 'Гостей: от 1 до %. Для большой компании позвоните в паб', v.booking_max_guests; end if;
  nm := left(trim(coalesce(p->>'name', '')), 80);
  ph := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  if nm = '' then raise exception 'Укажите имя'; end if;
  if length(ph) < 11 then raise exception 'Укажите телефон'; end if;

  -- Защита от дублей: параллельные запросы одного гостя выполняются строго по очереди
  perform pg_advisory_xact_lock(hashtextextended('reservation:' || auth.uid()::text, 0));

  -- 1) Есть бронь в обработке → не создаём новую
  select * into ex from public.reservations
   where (user_id = auth.uid() or phone = '+' || ph)
     and status = 'new' and starts_at > now()
   order by created_at desc limit 1;
  if found then
    raise exception 'Вы уже забронировали стол — бронь №% на %. Ожидайте подтверждения, мы скоро свяжемся с вами',
      ex.number, to_char(ex.starts_at at time zone 'Europe/Moscow', 'DD.MM в HH24:MI');
  end if;

  -- 2) Уже есть подтверждённая бронь в этом заведении примерно на это же время (±3 ч)
  select * into ex from public.reservations
   where (user_id = auth.uid() or phone = '+' || ph)
     and venue_id = v.id and status = 'confirmed'
     and starts_at between ts - interval '3 hours' and ts + interval '3 hours'
   order by starts_at limit 1;
  if found then
    raise exception 'У вас уже есть подтверждённая бронь №% на %. Если нужно что-то изменить — позвоните в паб',
      ex.number, to_char(ex.starts_at at time zone 'Europe/Moscow', 'DD.MM в HH24:MI');
  end if;

  if (select count(*) from public.reservations where user_id = auth.uid() and status in ('new','confirmed') and starts_at > now()) >= 3 then
    raise exception 'У вас уже 3 активные брони. Отмените лишнюю или позвоните в паб';
  end if;
  insert into public.reservations (venue_id, starts_at, guests, name, phone, comment, deposit, payment_status, pd_consent_version)
  values (v.id, ts, g, nm, '+' || ph, left(coalesce(p->>'comment', ''), 300),
          v.booking_deposit * g, case when v.booking_deposit > 0 then 'pending' else 'none' end, p->>'pd_consent_version')
  returning * into r;
  if r.deposit = 0 then perform public.reservation_notify(r, '🍺 Новая бронь'); end if;   -- с депозитом — после оплаты
  return jsonb_build_object('id', r.id, 'number', r.number, 'deposit', r.deposit, 'status', r.status, 'payment_status', r.payment_status);
end $function$;
