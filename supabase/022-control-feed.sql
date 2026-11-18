-- 022: лента для сервера «Патрики Контроль» (только чтение).
-- Отдаёт заказы официантов (стол, время, состав, статус в iiko), брони (время, гости, статус —
-- без имён и телефонов) и схему зала. Доступ — по ключу control_feed_key (лежит в app_secrets).
-- Уже применено в базе 18.11.2026. Значение ключа = sha256("patriki-control-feed:" + apiToken сервера «Контроль»);
-- в репозиторий оно не кладётся — при повторной установке подставьте его вместо KEY_PLACEHOLDER.
-- Номер 022, чтобы не пересечься с 021, если он появится в работе над приложением.
insert into public.app_secrets (key, value) values ('control_feed_key', 'KEY_PLACEHOLDER')
on conflict (key) do nothing;

create or replace function public.control_feed(p_key text, p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  select value into v_key from public.app_secrets where key = 'control_feed_key';
  if v_key is null or p_key is null or p_key <> v_key then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'now', now(),
    'waiter_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'venue', o.venue, 'kind', o.kind, 'status', o.status, 'error', o.error,
        'table_id', o.table_id, 'table', o.table_label, 'guests', o.guests,
        'waiter', s.name, 'waiter_iiko_id', coalesce(o.waiter_iiko_id, s.iiko_employee_id),
        'sent_at', o.created_at, 'taken_at', o.taken_at, 'updated_at', o.updated_at,
        'iiko_number', o.iiko_number, 'iiko_order_id', o.iiko_order_id, 'total', o.total,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i->>'name', 'amount', i->'amount', 'price', i->'price', 'product_id', i->>'productId')), '[]'::jsonb)
                  from jsonb_array_elements(case when jsonb_typeof(o.payload) = 'array' then o.payload else '[]'::jsonb end) i)
      ) order by o.updated_at)
      from (select * from public.waiter_orders where updated_at >= p_since order by updated_at limit 2000) o
      left join public.waiter_staff s on s.id = o.staff_id
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.number, 'venue', r.venue_id, 'starts_at', r.starts_at,
        'guests', r.guests, 'status', r.status, 'created_at', r.created_at, 'updated_at', r.updated_at
      ) order by r.updated_at)
      from (select * from public.reservations where updated_at >= p_since or starts_at >= now() - interval '1 day' order by updated_at limit 2000) r
    ), '[]'::jsonb),
    'layout', (select jsonb_object_agg(key, data) from public.waiter_cache where key like 'pos_layout:%')
  );
end;
$$;

revoke all on function public.control_feed(text, timestamptz) from public;
grant execute on function public.control_feed(text, timestamptz) to anon, authenticated;
