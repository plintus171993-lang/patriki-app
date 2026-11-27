-- 038: ночная резервная копия базы на хостинг Reg.ru (на бесплатном тарифе Supabase своих копий нет).
-- Хостинг раз в сутки по очереди вызывает rpc backup_tables / backup_table и сохраняет ответ (данные всех таблиц public
-- + список гостей из auth.users) в сжатый файл вне папки сайта, храня последние 14 копий.
-- Ключ придумывает сам хостинг и один раз регистрирует его через backup_register — ключ нигде не пересылается.
-- В копию НЕ входят: app_secrets (ключи iiko/Telegram/телефонии), кэш waiter_cache, файлы (фото) из Storage.
-- Структура таблиц и функции — в файлах supabase/*.sql этого репозитория.

create or replace function public.backup_register(p_key text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_key), 0) < 32 then raise exception 'Слишком короткий ключ'; end if;
  if exists (select 1 from app_secrets where key = 'backup_key') then
    return exists (select 1 from app_secrets where key = 'backup_key' and value = p_key);  -- уже зарегистрирован
  end if;
  insert into app_secrets(key, value) values ('backup_key', p_key);
  return true;
end $$;

-- список таблиц для копии (по одной таблице за запрос — укладываемся в лимит времени запроса)
create or replace function public.backup_tables(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_key, '') = '' or not exists (select 1 from app_secrets where key = 'backup_key' and value = p_key) then
    raise exception 'Неверный ключ резервной копии';
  end if;
  return (select jsonb_agg(tablename order by tablename) from pg_tables where schemaname = 'public'
           and tablename not in ('app_secrets', 'waiter_cache')) || '["_auth_users"]'::jsonb;
end $$;

create or replace function public.backup_table(p_key text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rows jsonb;
begin
  if coalesce(p_key, '') = '' or not exists (select 1 from app_secrets where key = 'backup_key' and value = p_key) then
    raise exception 'Неверный ключ резервной копии';
  end if;
  if p_name = '_auth_users' then
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'phone', phone, 'email', email, 'created_at', created_at,
                                                 'last_sign_in_at', last_sign_in_at, 'meta', raw_user_meta_data)), '[]')
      into rows from auth.users;
    return rows;
  end if;
  if p_name in ('app_secrets', 'waiter_cache')
     or not exists (select 1 from pg_tables where schemaname = 'public' and tablename = p_name) then
    raise exception 'Нет такой таблицы: %', p_name;
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', p_name) into rows;
  return rows;
end $$;

revoke all on function public.backup_register(text) from public;
revoke all on function public.backup_tables(text) from public;
revoke all on function public.backup_table(text, text) from public;
grant execute on function public.backup_register(text) to anon;
grant execute on function public.backup_tables(text) to anon;
grant execute on function public.backup_table(text, text) to anon;
