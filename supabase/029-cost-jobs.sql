-- =====================================================================
--  Обновление 029: долгие задачи «Себестоимости» — в фоне, с опросом статуса
--
--  Распознавание техкарты «с листочка» и ручная проверка «Проверить сейчас» идут 30–90 секунд.
--  Раньше браузер держал один запрос всё это время, и любой обрыв связи до Supabase
--  (плохой интернет, VPN, провайдер) превращался в «Failed to fetch», а результат терялся.
--  Теперь функция cost-check сразу отвечает номером задачи, работает в фоне и пишет
--  результат сюда; Офис короткими запросами спрашивает, готово ли, и переживает обрывы.
--
--  Доступ — только у функции (service role), из браузера таблица не читается.
--  Можно запускать повторно.
-- =====================================================================

create table if not exists public.cost_jobs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                        -- card_parse / check
  status      text not null default 'running' check (status in ('running', 'done', 'error')),
  result      jsonb,
  error       text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists cost_jobs_created on public.cost_jobs (created_at);
alter table public.cost_jobs enable row level security;

-- старые задачи не копим: всё, что старше суток, удаляется при создании новой (см. функцию)
