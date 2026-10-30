-- ============================================================
-- Патрики Паб — обновление 006: Telegram-группа с темами
-- Чат можно указать как "-100123456789" (обычная группа)
-- или как "-100123456789/42" — группа с темами, 42 = номер темы (message_thread_id).
--   telegram_chat_id             → тема «Все заказы» (копии всех заказов + коды входа в тестовом режиме)
--   telegram_chat_id:petrogradka → тема «Заказы Петроградка»
--   telegram_chat_id:murino      → тема «Заказы Мурино»
-- Можно запускать повторно.
-- ============================================================

create or replace function public.tg_send(p_chat text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare token text; chat text; thread text; body jsonb;
begin
  select value into token from public.app_secrets where key = 'telegram_bot_token';
  if token is null or coalesce(p_chat,'') = '' then return; end if;
  chat   := split_part(p_chat, '/', 1);
  thread := nullif(split_part(p_chat, '/', 2), '');
  body := jsonb_build_object('chat_id', chat, 'text', p_text);
  if thread is not null then body := body || jsonb_build_object('message_thread_id', thread::bigint); end if;
  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
    body    := body,
    headers := '{"Content-Type": "application/json"}'::jsonb);
exception when others then null;
end $$;

-- код входа (тестовый режим SMS) — в общую тему
create or replace function public.pk_send_sms(event jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ph text := event->'user'->>'phone';
  code text := event->'sms'->>'otp';
  chat text;
begin
  ph := coalesce(nullif(event->'user'->>'phone_change', ''), nullif(event->'sms'->>'phone', ''), ph);
  insert into public.sms_outbox (phone, otp) values (coalesce(ph, ''), coalesce(code, ''));
  delete from public.sms_outbox where created_at < now() - interval '1 day';
  select value into chat from public.app_secrets where key = 'telegram_chat_id';
  if chat is not null then perform public.tg_send(chat, format('🔑 Код входа для +%s: %s', ph, code)); end if;
  return '{}'::jsonb;
end $$;
revoke execute on function public.pk_send_sms(jsonb) from public, anon, authenticated;
grant execute on function public.pk_send_sms(jsonb) to supabase_auth_admin;
revoke execute on function public.tg_send(text, text) from public, anon, authenticated;
