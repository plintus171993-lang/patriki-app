-- 028: выписка банка — исправление категорий и выплаты приставам за сотрудника.
-- Ошибка: правило «комиссия банка» ловило «плата за» внутри «Оплата за …» — в комиссию ушли поставщики, оборудование и др.
-- Приставы (ФССП): удержание по исполнительному листу за сотрудника = его зарплата. Платёж ведёт себя как зарплата
-- с р/с (salary_bank), привязка «номер исполнительного производства → сотрудник» запоминается в crm_bank_salary_links,
-- следующие платежи по тому же ИП засчитываются сотруднику сами.

create table if not exists public.crm_bank_salary_links (
  key text primary key,                 -- 'ip:271574/26/64041-ИП'
  employee_id uuid not null references public.crm_employees(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.crm_bank_salary_links enable row level security;
drop policy if exists "owner all" on public.crm_bank_salary_links;
create policy "owner all" on public.crm_bank_salary_links for all using (is_owner()) with check (is_owner());

-- пересортировка того, что уже загружено с расчётного счёта
with o as (
  select o.id, lower(coalesce(o.counterparty,'')||' '||coalesce(o.comment,'')) t, o.counterparty cp
  from public.crm_cash_ops o join public.crm_cashboxes c on c.id = o.cashbox_id
  where c.account_no is not null and o.direction = 'out' and o.source = 'bank'
    and o.category in ('Комиссия банка','Прочее','Поставщики')
)
update public.crm_cash_ops x set category = case
    when o.t ~ '(фссп|пристав)' then 'Зарплата и авансы'
    when o.t ~ 'дивиденд' then 'Дивиденды'
    when o.t ~ 'комисси' and o.cp ~* 'банк' then 'Комиссия банка'
    when o.t ~ '(климатическ|холодильн|моноблок|гриль|посуд|оборудован|мебел)' then 'Оборудование и инвентарь'
    when o.t ~ '(видео|реклам|маркет)' then 'Маркетинг и печать'
    when o.t ~ '(юридическ|консультац|адвокат)' then 'Налоги, юристы, штрафы'
    when o.t ~ '(водоотвед|водоснаб|теплов|электроэнерг|теплоэнерго)' then 'Коммунальные услуги'
    when o.t ~ '(ккм|домен|интернет|звонки|онлайн офис|связ)' then 'Связь и IT'
    when o.t ~ '(вывоз|утилизац|уборк|охран)' then 'Вывоз, уборка, охрана'
    when o.t ~ '(транспортн|экспедиц|такси)' then 'Транспорт и доставка'
    when o.t ~ 'хозяйствен' then 'Хозтовары и магазин'
    when o.t ~ '(напит|пиво|пивн|продукт|мяс|орех|хлеб|кофе|колбас|пельмен|двуокис|товар)' then 'Поставщики'
    else x.category end
from o where x.id = o.id;

-- платёж приставам = зарплата с р/с, ждёт разнесения на сотрудника (в «Зарплате» → «Не разнесено»)
update public.crm_cash_ops set salary_bank = true, pay_kind = 'salary',
  pay_month = date_trunc('month', op_date - interval '1 month')::date
where source = 'bank' and direction = 'out' and (counterparty ~* 'фссп|пристав') and not salary_bank;
update public.crm_cash_ops set category = 'Коммунальные услуги' where source = 'bank' and category = 'Комиссия банка' and counterparty ilike '%водоканал%';
update public.crm_cash_ops set category = 'Комиссия банка' where source = 'bank' and counterparty ilike '%сбербанк%' and comment ilike 'Плата за продукт%';
