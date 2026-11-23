-- 026: редактируемая мотивация (версии правил) + уровни лояльности вручную
-- Ставки по должностям: одно правило kind='position_defaults', params.positions[<должность>] = {pay_type, rate, revenue_bonus, service_fee}
update public.crm_motivation_rules set active = false where kind in ('hourly','daily_amount','monthly_salary');

-- Новая версия правила с даты: прошлая версия закрывается днём раньше, прошлые месяцы не меняются
create or replace function public.crm_rule_new_version(p_venue text, p_kind text, p_name text, p_params jsonb, p_from date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_owner() then raise exception 'Нет доступа'; end if;
  delete from public.crm_motivation_rules where venue_id is not distinct from p_venue and kind = p_kind and valid_from = p_from;
  update public.crm_motivation_rules set valid_to = p_from - 1
    where venue_id is not distinct from p_venue and kind = p_kind and active and valid_from < p_from and (valid_to is null or valid_to >= p_from);
  insert into public.crm_motivation_rules(venue_id, kind, name, params, valid_from)
    values (p_venue, p_kind, p_name, p_params, p_from) returning id into v_id;
  return v_id;
end $$;
grant execute on function public.crm_rule_new_version(text,text,text,jsonb,date) to authenticated;
-- Примечание: crm_loyalty_set_level и fixed_level в crm_loyalty_list применены в БД миграциями из панели Supabase.
