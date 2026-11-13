-- =====================================================================
--  Обновление 015: заявки из приложения на кассе iikoFront
--  Плагин «Карта Патрики» на главной кассе раз в 15 секунд спрашивает у функции iiko
--  новые брони и заказы своей точки и показывает их окном поверх экрана кассы.
--  Официант звонит гостю и нажимает «Подтвердить» или «Отклонить»:
--   • бронь → резерв стола в iiko, статус брони «подтверждена» / «отклонена»;
--   • заказ → заказ на стол «Доставка» в iiko и на кухню, статус «готовим» / «отменён».
--  Здесь только поля для связи с iiko; логика — в функции iiko (действия front-*).
--  Можно запускать повторно.
-- =====================================================================

alter table public.reservations add column if not exists iiko_reserve_id text;
alter table public.reservations add column if not exists handled_at timestamptz;
alter table public.reservations add column if not exists handled_by text;

alter table public.orders add column if not exists iiko_order_id text;
alter table public.orders add column if not exists handled_at timestamptz;
alter table public.orders add column if not exists handled_by text;

-- быстрый поиск новых заявок точки
create index if not exists reservations_inbox_idx on public.reservations (venue_id, created_at) where status = 'new';
create index if not exists orders_inbox_idx on public.orders (venue_id, created_at) where status = 'new';

-- поля связи с iiko меняет только сервер (функция iiko)
create or replace function public.guard_iiko_fields() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.iiko_order_id is distinct from old.iiko_order_id or
       new.handled_by    is distinct from old.handled_by) then
    raise exception 'Связь с iiko меняет только сервер';
  end if;
  return new;
end $$;
drop trigger if exists orders_guard_iiko on public.orders;
create trigger orders_guard_iiko before update on public.orders
  for each row execute function public.guard_iiko_fields();
