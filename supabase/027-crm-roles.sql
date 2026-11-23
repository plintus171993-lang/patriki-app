-- 027: управляющие заведений в «Патрики Офис».
-- Учётку создаёт владелец во вкладке «Доступы» (функция crm-users): admins.venue_id = заведение, права — crm_manager_perms.
-- Табель своего заведения управляющий ведёт всегда. Остальное — по галочкам:
--   revenue.view  — «Сводка»: выручка своего заведения
--   cash.view / cash.add / cash.transfer — кассы своего заведения: смотреть / приход-расход / перемещения
--   staff.edit    — «Сотрудники»: добавлять и редактировать (без зарплат и мотивации)
-- Зарплата, мотивация, лояльность, журнал, доступы — только владелец.

drop policy if exists "manager add" on public.crm_employees;
drop policy if exists "manager edit" on public.crm_employees;
create policy "manager add" on public.crm_employees for insert
  with check (public.crm_can('staff.edit') and public.can_manage(home_venue));
create policy "manager edit" on public.crm_employees for update
  using (public.crm_can('staff.edit') and public.can_manage(home_venue))
  with check (public.crm_can('staff.edit') and public.can_manage(home_venue));

-- поиск существующей учётки по email (только для серверной функции)
create or replace function public.crm_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke all on function public.crm_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.crm_user_id_by_email(text) to service_role;
