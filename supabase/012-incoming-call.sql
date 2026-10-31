-- =====================================================================
--  Обновление 012: подтверждение номера входящим звонком от гостя
--  Гость звонит на выданный номер (звонок бесплатный, сбрасывается сам),
--  провайдер (New-Tel CallPassword ID) сообщает, с какого номера звонили.
--  Таблицу читает и пишет только функция verify (service_role), гостям доступа нет.
-- =====================================================================
create table if not exists public.phone_incoming (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  phone          text not null,
  call_id        text,
  confirm_number text,
  status         text not null default 'pending' check (status in ('pending','done','login','failed')),
  login_hash     text,
  message        text,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);
create index if not exists phone_incoming_call on public.phone_incoming (call_id);
create index if not exists phone_incoming_user on public.phone_incoming (user_id, created_at);
alter table public.phone_incoming enable row level security;
revoke all on public.phone_incoming from anon, authenticated;
