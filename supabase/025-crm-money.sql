-- CRM «Патрики Офис», часть 2 (применено к базе 20–23.11.2026):
-- кассы по способам оплаты iiko, система лояльности в CRM, мотивация сотрудников,
-- выплаты зарплаты, банковская выписка (1С), раскладка банковской зарплаты по сотрудникам,
-- ежечасная выгрузка выручки из iiko (pg_cron → функция crm-sync).
-- Требует 023-crm.sql.

-- ---------- Выручка и кассы по способам оплаты iiko ----------
alter table public.crm_daily_revenue drop column if exists total;
alter table public.crm_daily_revenue drop column if exists rubliki;
alter table public.crm_daily_revenue add column total numeric(14,2) generated always as (coalesce(cashless,0)+coalesce(cash,0)) stored;
alter table public.crm_daily_revenue add column if not exists by_pay_type jsonb;

alter table public.crm_cashboxes add column if not exists iiko_pay_type text;
create unique index if not exists crm_cashboxes_paytype on public.crm_cashboxes(venue_id, iiko_pay_type) where iiko_pay_type is not null;
alter table public.crm_cashboxes add column if not exists account_no text;
create unique index if not exists crm_cashboxes_account on public.crm_cashboxes(account_no) where account_no is not null;

-- ---------- Операции: выплаты зарплаты и банковская выписка ----------
alter table public.crm_cash_ops add column if not exists pay_month date;
alter table public.crm_cash_ops add column if not exists pay_kind text;
alter table public.crm_cash_ops drop constraint if exists crm_cash_ops_pay_kind_check;
alter table public.crm_cash_ops add constraint crm_cash_ops_pay_kind_check check (pay_kind in ('advance','salary','bonus','vacation'));
create index if not exists crm_cash_ops_emp_month on public.crm_cash_ops(employee_id, pay_month) where employee_id is not null;
alter table public.crm_cash_ops add column if not exists ext_id text;
alter table public.crm_cash_ops add column if not exists counterparty text;
alter table public.crm_cash_ops add column if not exists counterparty_inn text;
create unique index if not exists crm_cash_ops_ext on public.crm_cash_ops(cashbox_id, ext_id) where ext_id is not null;
alter table public.crm_cash_ops add column if not exists salary_bank boolean;
alter table public.crm_cash_ops add column if not exists registry_no text;
create or replace function public.crm_cash_ops_defaults() returns trigger language plpgsql as $$
begin new.salary_bank := coalesce(new.salary_bank, false); return new; end $$;
drop trigger if exists cash_ops_defaults on public.crm_cash_ops;
create trigger cash_ops_defaults before insert or update on public.crm_cash_ops for each row execute function crm_cash_ops_defaults();

create or replace view public.crm_cashbox_balances with (security_invoker = on) as
select c.id, c.venue_id, c.name, c.kind, c.sort,
  coalesce(sum(case when o.direction='in' then o.amount else -o.amount end),0) as balance,
  max(o.op_date) as last_op, c.iiko_pay_type, c.account_no
from public.crm_cashboxes c left join public.crm_cash_ops o on o.cashbox_id = c.id
group by c.id;

-- запомненные категории банковских платежей по контрагенту
create table if not exists public.crm_bank_rules (
  id uuid primary key default gen_random_uuid(),
  inn text, name text,
  direction text check (direction in ('in','out')),
  category text not null,
  created_at timestamptz not null default now(),
  unique (inn, direction)
);
alter table public.crm_bank_rules enable row level security;
create policy "owner all" on public.crm_bank_rules for all using (is_owner()) with check (is_owner());

-- ---------- Сотрудники: ФИО и мотивация ----------
alter table public.crm_employees add column if not exists full_name text;

create table if not exists public.crm_employee_motivation (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.crm_employees(id) on delete cascade,
  valid_from date not null,
  pay_type text not null check (pay_type in ('hourly','per_shift','monthly')),
  rate numeric(12,2) not null default 0,
  revenue_bonus boolean not null default false,
  service_fee boolean not null default false,
  kitchen_pct numeric(5,2), kitchen_threshold numeric(14,2),
  revenue_pct numeric(5,2), revenue_base text check (revenue_base in ('total','bar','kitchen')),
  fixed_bonus numeric(12,2), note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, valid_from)
);
alter table public.crm_employee_motivation enable row level security;
create policy "owner all" on public.crm_employee_motivation for all using (is_owner()) with check (is_owner());
create trigger audit after insert or update or delete on public.crm_employee_motivation for each row execute function crm_audit_trg();
create or replace view public.crm_employee_motivation_current with (security_invoker = on) as
select distinct on (employee_id) * from public.crm_employee_motivation
where valid_from <= (now() at time zone 'Europe/Moscow')::date
order by employee_id, valid_from desc;

-- ---------- Банковская зарплата: раскладка платежа по сотрудникам ----------
create table if not exists public.crm_salary_alloc (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null references public.crm_cash_ops(id) on delete cascade,
  employee_id uuid not null references public.crm_employees(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  pay_month date not null,
  pay_kind text not null default 'salary' check (pay_kind in ('advance','salary','bonus','vacation')),
  source text not null default 'manual',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists crm_salary_alloc_emp on public.crm_salary_alloc(employee_id, pay_month);
create index if not exists crm_salary_alloc_op on public.crm_salary_alloc(op_id);
alter table public.crm_salary_alloc enable row level security;
create policy "owner all" on public.crm_salary_alloc for all using (is_owner()) with check (is_owner());
create trigger audit after insert or update or delete on public.crm_salary_alloc for each row execute function crm_audit_trg();
create or replace view public.crm_salary_bank_ops with (security_invoker = on) as
select o.id, o.cashbox_id, o.op_date, o.amount, o.comment, o.registry_no, o.pay_kind, o.pay_month,
  coalesce((select sum(a.amount) from public.crm_salary_alloc a where a.op_id = o.id),0) as allocated
from public.crm_cash_ops o where o.salary_bank;

-- ---------- Система лояльности в CRM (только владелец) ----------
create or replace function public.crm_loyalty_list() returns table(
  kind text, id text, name text, phone text, card_no text, balance int, spent int, level text,
  birthday date, created_at timestamptz, last_activity_at timestamptz, verified boolean)
language sql stable security definer set search_path to 'public' as $$
  select 'app', a.user_id::text, p.name, p.phone, a.card_no, a.balance, a.spent_total,
         coalesce(a.fixed_level, to_jsonb(public.loyalty_tier_for(a.fixed_level, a.spent_total))->>'name'), p.birthday, a.created_at, a.last_activity_at,
         public.loyalty_verified(a.user_id)
  from public.loyalty_accounts a left join public.profiles p on p.id = a.user_id
  where public.is_owner()
  union all
  select 'import', i.phone, i.name, i.phone, i.card_no, i.balance, i.spent, coalesce(i.fixed_level, i.level), i.birth_date, i.created_at, null, null
  from public.loyalty_imports i where i.claimed_by is null and public.is_owner()
$$;
grant execute on function public.crm_loyalty_list() to authenticated;

create or replace function public.crm_loyalty_edit(p_kind text, p_id text, p_name text, p_birthday date, p_delta int, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_bal int;
begin
  if not public.is_owner() then raise exception 'Нет доступа'; end if;
  if p_kind = 'app' then
    update public.profiles set name = coalesce(nullif(trim(p_name),''), name), birthday = coalesce(p_birthday, birthday), updated_at = now() where id = p_id::uuid;
    if coalesce(p_delta,0) <> 0 then
      update public.loyalty_accounts set balance = balance + p_delta, last_activity_at = now() where user_id = p_id::uuid;
      insert into public.loyalty_tx(user_id, kind, points, source, note) values (p_id::uuid, 'adjust', p_delta, 'admin', coalesce(nullif(p_note,''),'Корректировка в CRM'));
    end if;
    select balance into v_bal from public.loyalty_accounts where user_id = p_id::uuid;
  elsif p_kind = 'import' then
    update public.loyalty_imports set name = coalesce(nullif(trim(p_name),''), name), birth_date = coalesce(p_birthday, birth_date),
      balance = balance + coalesce(p_delta,0) where phone = p_id returning balance into v_bal;
    if v_bal < 0 then raise exception 'Баланс не может стать отрицательным'; end if;
    if coalesce(p_delta,0) <> 0 then
      insert into public.loyalty_tx(import_phone, kind, points, source, note) values (p_id, 'adjust', p_delta, 'admin', coalesce(nullif(p_note,''),'Корректировка в CRM'));
    end if;
  else raise exception 'Неизвестный тип карты'; end if;
  return jsonb_build_object('balance', v_bal);
end $$;
grant execute on function public.crm_loyalty_edit(text,text,text,date,int,text) to authenticated;

create or replace function public.crm_loyalty_history(p_kind text, p_id text) returns setof public.loyalty_tx
language sql stable security definer set search_path to 'public' as $$
  select * from public.loyalty_tx where public.is_owner() and
    ((p_kind='app' and user_id = p_id::uuid) or (p_kind='import' and import_phone = p_id))
  order by created_at desc limit 200
$$;
grant execute on function public.crm_loyalty_history(text,text) to authenticated;

-- ---------- Ежечасная выгрузка выручки из iiko (вчера + сегодня, Петроградка) ----------
-- Для Мурино после открытия: такая же задача с 'venue','murino' (и доступ к серверу iiko Мурино в app_secrets).
select cron.schedule('crm-sync-hourly', '5 * * * *', $cron$
  select net.http_post(
    url := 'https://ozbdmczmpejyctezxrdk.supabase.co/functions/v1/crm-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-pos-key',(select value from public.app_secrets where key='pos_api_key')),
    body := jsonb_build_object('action','save','venue','petrogradka',
      'from', ((now() at time zone 'Europe/Moscow')::date - 1)::text,
      'to', ((now() at time zone 'Europe/Moscow')::date)::text),
    timeout_milliseconds := 120000);
$cron$);
