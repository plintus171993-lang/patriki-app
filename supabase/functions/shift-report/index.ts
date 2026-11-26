// Патрики — утренняя сводка по смене в группу учредителей (Telegram).
// Деньги по типам оплат — из сервера iiko (OLAP по продажам за учётный день), как в отчёте 48 «Итого по смене».
// Баллы — строка типа оплаты «Баллы Патрики» (плагин 1.7) + сверка с iiko_redeems (данные приложения).
// Ланч-карта (031-lunch.sql) — ланчи по акции и подарки за смену.
// app_secrets: iiko_server_url, iiko_server_login, iiko_server_password (пользователь iikoOffice «Сводка бот», право B_CASR).
// Доступ: x-pos-key = app_secrets.pos_api_key, либо service-role.
// action: 'preview' — вернуть текст; 'send' — отправить в чат учредителей. day = 'YYYY-MM-DD' (по умолчанию вчера по Москве).
// Расписание: pg_cron 'shift-report-daily' в 06:00 UTC (9:00 МСК).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

async function secret(key: string) {
  const { data } = await db.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return ((data?.value as string) || '').trim();
}

const MSK = 3 * 3600e3;
const rub = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ | |,/g, ' ') + ' ₽';
const nextDay = (d: string) => new Date(new Date(d + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10);

async function sha1(s: string) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- сервер iiko: продажи по типам оплат за учётный день ---------- */
async function serverPayments(day: string) {
  const base = (await secret('iiko_server_url')).replace(/\/+$/, '');
  const login = await secret('iiko_server_login'), pass = await secret('iiko_server_password');
  if (!base || !login || !pass) return { ok: false as const, error: 'нет доступа к серверу iiko' };
  const a = await fetch(`${base}/api/auth?login=${encodeURIComponent(login)}&pass=${await sha1(pass)}`);
  const key = (await a.text()).trim();
  if (!a.ok || key.length > 100 || key.includes('<')) return { ok: false as const, error: `сервер iiko не принял логин (${a.status})` };
  try {
    const body = {
      reportType: 'SALES', buildSummary: false,
      groupByRowFields: ['PayTypes', 'PayTypes.Group'],
      aggregateFields: ['DishDiscountSumInt', 'UniqOrderId.OrdersCount'],
      filters: {
        'OpenDate.Typed': { filterType: 'DateRange', periodType: 'CUSTOM', from: day, to: nextDay(day), includeLow: true, includeHigh: false },
        'OrderDeleted': { filterType: 'IncludeValues', values: ['NOT_DELETED'] },
        'DeletedWithWriteoff': { filterType: 'IncludeValues', values: ['NOT_DELETED'] },
      },
    };
    const r = await fetch(`${base}/api/v2/reports/olap?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const txt = await r.text();
    if (!r.ok) return { ok: false as const, error: `OLAP ${r.status}: ${txt.slice(0, 200)}` };
    const d = JSON.parse(txt);
    const rows = (d.data || []).map((x: any) => ({ name: x['PayTypes'] || 'Без оплаты', group: x['PayTypes.Group'] || '', sum: Number(x['DishDiscountSumInt'] || 0), orders: Number(x['UniqOrderId.OrdersCount'] || 0) }));
    return { ok: true as const, rows };
  } finally {
    await fetch(`${base}/api/logout?key=${key}`).catch(() => {}); // освобождаем лицензию
  }
}

const shiftWindow = (day: string) => { const start = new Date(day + 'T06:00:00+03:00'); return { start, end: new Date(start.getTime() + 864e5) }; };

async function points(venue: string, day: string) {
  const { start, end } = shiftWindow(day);
  const { data } = await db.from('iiko_redeems').select('points').eq('venue_id', venue).eq('status', 'closed')
    .gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
  return { points: (data || []).reduce((a: number, r: any) => a + Number(r.points || 0), 0), checks: (data || []).length };
}

// ланч-карта: штампы (оплаченные ланчи по QR) и подарки за смену
async function lunches(venue: string, day: string) {
  const { data: cfg } = await db.from('lunch_settings').select('enabled').eq('id', 1).maybeSingle();
  if (!cfg?.enabled) return null;
  const { start, end } = shiftWindow(day);
  const { data } = await db.from('lunch_log').select('kind, qty, status')
    .eq('venue_id', venue).in('kind', ['stamp', 'gift']).gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
  const rows = data || [];
  return {
    paid: rows.filter((r: any) => r.kind === 'stamp').reduce((a: number, r: any) => a + Number(r.qty || 0), 0),
    gifts: rows.filter((r: any) => r.kind === 'gift' && r.status !== 'returned').length,
  };
}

const isPoints = (r: any) => /балл/i.test(r.name);
const ICON = (r: any) => isPoints(r) ? '⭐' : r.group === 'CASH' ? '💵' : r.group === 'CARD' ? '💳' : '🔄';

function format(day: string, srv: any, pts: { points: number; checks: number }, lun: { paid: number; gifts: number } | null) {
  const dd = new Date(day + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  const lines = [`📊 Петроградка — смена ${dd}`, ''];
  if (srv.ok) {
    const rows = [...srv.rows].filter((r: any) => Math.abs(r.sum) >= 0.5).sort((a: any, b: any) => (isPoints(a) ? 1 : 0) - (isPoints(b) ? 1 : 0) || b.sum - a.sum);
    if (!rows.length) lines.push('Продаж не было');
    for (const r of rows) lines.push(`${ICON(r)} ${r.name}: ${rub(r.sum)} (чеков: ${r.orders})`);
    const total = rows.reduce((a: number, r: any) => a + r.sum, 0);
    lines.push('', `Итого продажи: ${rub(total)}`);
  } else {
    lines.push('⚠️ Суммы из iiko не получены: ' + srv.error);
  }
  lines.push(`⭐ Списано баллами по приложению: ${pts.points}${pts.checks ? ` (чеков: ${pts.checks})` : ''}`);
  if (lun) lines.push(`🍽 Ланч-карта: ланчей по акции ${lun.paid}, подарено ${lun.gifts}`);
  return lines.join('\n');
}

Deno.serve(async (req) => {
  try {
    const b = await req.json().catch(() => ({}));
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const key = req.headers.get('x-pos-key') || '';
    if (auth !== SERVICE_KEY && (!key || key !== await secret('pos_api_key'))) return json({ error: 'Нет доступа' }, 403);
    const day = b.day || new Date(Date.now() + MSK - 864e5).toISOString().slice(0, 10);
    const srv = await serverPayments(day);
    const pts = await points('petrogradka', day);
    const lun = await lunches('petrogradka', day).catch(() => null);
    const text = format(day, srv, pts, lun);
    if (b.action === 'send') {
      const chat = await secret('telegram_chat_id:founders');
      const { error } = await db.rpc('tg_send', { p_chat: chat, p_text: text });
      if (error) throw new Error(error.message);
    }
    return json({ text, day, server: srv, points: pts, lunch: lun });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
