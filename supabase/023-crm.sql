-- CRM «Патрики Офис» (patrikipab.ru/office/): сотрудники, кассы, перемещения, выручка по дням,
-- табель смен с привязкой к точке, зарплатные ведомости, правила мотивации, журнал действий.
-- Права: владелец (admins.venue_id is null) — всё; управляющий — своя точка + права из crm_manager_perms:
--   cash.view, cash.add, cash.transfer, revenue.view, payroll.view
-- Уже применено к базе 20.11.2026 (миграции crm_core, crm_import_official, crm_transfer_receive_policy).

create table public.crm_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position text,
  dept text check (dept in ('bar','kitchen','dish','hall','admin')),
  home_venue text references public.venues(id),
  iiko_employee_id uuid,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create table public.crm_cashboxes (
  id uuid primary key default gen_random_uuid(),
  venue_id text references public.venues(id),
  name text not null,
  kind text not null default 'cash' check (kind in ('cash','bank','accountable','safe','other')),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.crm_transfers (
  id uuid primary key default gen_random_uuid(),
  from_cashbox uuid not null references public.crm_cashboxes(id),
  to_cashbox uuid not null references public.crm_cashboxes(id),
  amount numeric(14,2) not null check (amount > 0),
  op_date date not null default current_date,
  status text not null default 'sent' check (status in ('sent','received','cancelled')),
  comment text,
  created_by uuid default auth.uid(),
  received_by uuid,
  received_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.crm_cash_ops (
  id uuid primary key default gen_random_uuid(),
  cashbox_id uuid not null references public.crm_cashboxes(id),
  op_date date not null,
  direction text not null check (direction in ('in','out')),
  amount numeric(14,2) not null check (amount > 0),
  category text,
  comment text,
  items jsonb,
  employee_id uuid references public.crm_employees(id),
  transfer_id uuid references public.crm_transfers(id),
  source text not null default 'manual',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.crm_cash_ops(cashbox_id, op_date);

create table public.crm_daily_revenue (
  venue_id text not null references public.venues(id),
  day date not null,
  day_type text,
  cashless numeric(14,2), cash numeric(14,2),
  loyalty numeric(14,2), yandex numeric(14,2),
  kitchen_turnover numeric(14,2), bar_turnover numeric(14,2),
  service_fee numeric(14,2),
  source text not null default 'manual',
  updated_at timestamptz not null default now(),
  total numeric(14,2) generated always as (coalesce(cashless,0)+coalesce(cash,0)) stored,
  primary key (venue_id, day)
);

create table public.crm_shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.crm_employees(id) on delete cascade,
  venue_id text not null references public.venues(id),
  day date not null,
  hours numeric(5,2),
  amount numeric(12,2),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, venue_id, day)
);
create index on public.crm_shifts(venue_id, day);

create table public.crm_payroll (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.crm_employees(id) on delete cascade,
  venue_id text not null references public.venues(id),
  month date not null,
  hours numeric(7,2), rate numeric(12,2), base numeric(14,2),
  plan_bonus numeric(14,2), motivation numeric(14,2), fines numeric(14,2), service numeric(14,2),
  total numeric(14,2), adv_official numeric(14,2), advance numeric(14,2), salary_official numeric(14,2),
  to_pay numeric(14,2), paid numeric(14,2), balance numeric(14,2),
  status text not null default 'draft' check (status in ('draft','closed')),
  source text not null default 'manual',
  unique (employee_id, venue_id, month)
);

create table public.crm_motivation_rules (
  id uuid primary key default gen_random_uuid(),
  venue_id text references public.venues(id),
  kind text not null,
  name text not null,
  params jsonb not null default '{}',
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.crm_manager_perms (
  user_id uuid not null,
  perm text not null,
  primary key (user_id, perm)
);

create table public.crm_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  tbl text, op text, row_id text, data jsonb
);

alter table public.crm_employees enable row level security;
alter table public.crm_cashboxes enable row level security;
alter table public.crm_transfers enable row level security;
alter table public.crm_cash_ops enable row level security;
alter table public.crm_daily_revenue enable row level security;
alter table public.crm_shifts enable row level security;
alter table public.crm_payroll enable row level security;
alter table public.crm_motivation_rules enable row level security;
alter table public.crm_manager_perms enable row level security;
alter table public.crm_audit enable row level security;

create or replace function public.crm_can(p_perm text) returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_owner() or exists (select 1 from public.crm_manager_perms where user_id = auth.uid() and perm = p_perm);
$$;

create or replace function public.crm_me() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('uid', auth.uid(), 'owner', is_owner(),
    'venues', coalesce((select jsonb_agg(venue_id) from admins where user_id = auth.uid()), '[]'),
    'name', (select name from admins where user_id = auth.uid() limit 1),
    'perms', coalesce((select jsonb_agg(perm) from crm_manager_perms where user_id = auth.uid()), '[]'));
$$;
grant execute on function public.crm_me() to authenticated;

create policy "owner all" on public.crm_employees for all using (is_owner()) with check (is_owner());
create policy "manager read" on public.crm_employees for select using (exists (select 1 from admins where user_id = auth.uid()));

create policy "owner all" on public.crm_cashboxes for all using (is_owner()) with check (is_owner());
create policy "manager read" on public.crm_cashboxes for select using (can_manage(venue_id) and crm_can('cash.view'));

create policy "owner all" on public.crm_cash_ops for all using (is_owner()) with check (is_owner());
create policy "manager read" on public.crm_cash_ops for select using (crm_can('cash.view') and exists (select 1 from crm_cashboxes c where c.id = cashbox_id and can_manage(c.venue_id)));
create policy "manager add" on public.crm_cash_ops for insert with check (crm_can('cash.add') and exists (select 1 from crm_cashboxes c where c.id = cashbox_id and can_manage(c.venue_id)));

create policy "owner all" on public.crm_transfers for all using (is_owner()) with check (is_owner());
create policy "manager read" on public.crm_transfers for select using (exists (select 1 from crm_cashboxes c where c.id in (from_cashbox, to_cashbox) and can_manage(c.venue_id)));
create policy "manager send" on public.crm_transfers for insert with check (crm_can('cash.transfer') and exists (select 1 from crm_cashboxes c where c.id = from_cashbox and can_manage(c.venue_id)));
create policy "manager receive" on public.crm_transfers for update
  using (status = 'sent' and exists (select 1 from crm_cashboxes c where c.id = to_cashbox and can_manage(c.venue_id)))
  with check (status in ('received') and exists (select 1 from crm_cashboxes c where c.id = to_cashbox and can_manage(c.venue_id)));

create policy "owner all" on public.crm_daily_revenue for all using (is_owner()) with check (is_owner());
create policy "manager read" on public.crm_daily_revenue for select using (can_manage(venue_id) and crm_can('revenue.view'));

create policy "owner all" on public.crm_shifts for all using (is_owner()) with check (is_owner());
create policy "manager rw" on public.crm_shifts for all using (can_manage(venue_id)) with check (can_manage(venue_id));

create policy "owner all" on public.crm_payroll for all using (is_owner()) with check (is_owner());
create policy "manager read" on public.crm_payroll for select using (can_manage(venue_id) and crm_can('payroll.view'));

create policy "owner all" on public.crm_motivation_rules for all using (is_owner()) with check (is_owner());
create policy "owner all" on public.crm_manager_perms for all using (is_owner()) with check (is_owner());
create policy "self read" on public.crm_manager_perms for select using (user_id = auth.uid());
create policy "owner read" on public.crm_audit for select using (is_owner());

-- журнал действий
create or replace function public.crm_audit_trg() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.crm_audit(tbl, op, row_id, data)
  values (tg_table_name, tg_op, coalesce((case when tg_op='DELETE' then old else new end).id::text, ''),
          case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return null;
end $$;
create trigger audit after insert or update or delete on public.crm_cash_ops for each row execute function crm_audit_trg();
create trigger audit after insert or update or delete on public.crm_transfers for each row execute function crm_audit_trg();
create trigger audit after insert or update or delete on public.crm_shifts for each row execute function crm_audit_trg();
create trigger audit after insert or update or delete on public.crm_payroll for each row execute function crm_audit_trg();
create trigger audit after insert or update or delete on public.crm_employees for each row execute function crm_audit_trg();

-- перемещение: при отправке деньги уходят, при подтверждении получения — приходят
create or replace function public.crm_transfer_trg() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    insert into crm_cash_ops(cashbox_id, op_date, direction, amount, category, comment, transfer_id, source, created_by)
    values (new.from_cashbox, new.op_date, 'out', new.amount, 'Перемещение', new.comment, new.id, 'transfer', new.created_by);
    if new.status = 'received' then
      insert into crm_cash_ops(cashbox_id, op_date, direction, amount, category, comment, transfer_id, source, created_by)
      values (new.to_cashbox, new.op_date, 'in', new.amount, 'Перемещение', new.comment, new.id, 'transfer', new.created_by);
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'received' then
    insert into crm_cash_ops(cashbox_id, op_date, direction, amount, category, comment, transfer_id, source, created_by)
    values (new.to_cashbox, coalesce(new.received_at::date, current_date), 'in', new.amount, 'Перемещение', new.comment, new.id, 'transfer', new.received_by);
  elsif tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'cancelled' then
    delete from crm_cash_ops where transfer_id = new.id;
  end if;
  return null;
end $$;
create trigger transfer_ops after insert or update on public.crm_transfers for each row execute function crm_transfer_trg();

-- остатки касс
create or replace view public.crm_cashbox_balances with (security_invoker = on) as
select c.id, c.venue_id, c.name, c.kind, c.sort,
  coalesce(sum(case when o.direction='in' then o.amount else -o.amount end),0) as balance,
  max(o.op_date) as last_op
from public.crm_cashboxes c left join public.crm_cash_ops o on o.cashbox_id = c.id
group by c.id;
