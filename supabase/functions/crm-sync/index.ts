// Патрики Офис — выгрузка выручки из сервера iiko в CRM.
// Каждому типу оплаты iiko соответствует своя касса (crm_cashboxes.iiko_pay_type), касса создаётся сама при первой оплате.
// В CRM НЕ попадают: тип оплаты «Рубли» и оплата баллами (баллы — не деньги, они в разделе «Система лояльности»; сумма пишется в crm_daily_revenue.loyalty).
// Доступ: владелец (JWT из панели) или x-pos-key = app_secrets.pos_api_key, либо service-role.
// body: { from, to, venue:'petrogradka', action:'preview'|'save'|'types' } — по умолчанию вчера, preview.
//   types — создать кассы по всем типам оплат, встречавшимся за 90 дней (без операций, остаток 0).
// Запускается каждый час задачей pg_cron «crm-sync-hourly» (см. supabase/025-crm-money.sql). Деплой: verify_jwt = false.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pos-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const SKIP = (name: string) => /^рубл/i.test(name.trim());
const IS_POINTS = (name: string) => /балл|loyalty/i.test(name);

async function secret(key: string) {
  const { data } = await db.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return ((data?.value as string) || '').trim();
}
async function sha1(s: string) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const addDay = (d: string, n = 1) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
const mskToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

async function allowed(req: Request) {
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (auth && auth === SERVICE_KEY) return true;
  const pk = req.headers.get('x-pos-key');
  if (pk && pk === await secret('pos_api_key')) return true;
  if (!auth) return false;
  const u = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: 'Bearer ' + auth } }, auth: { persistSession: false } });
  const { data } = await u.rpc('crm_me');
  return !!(data && (data as any).owner);
}

async function olap(from: string, to: string) {
  const base = (await secret('iiko_server_url')).replace(/\/+$/, '');
  const login = await secret('iiko_server_login'), pass = await secret('iiko_server_password');
  if (!base || !login || !pass) throw new Error('нет доступа к серверу iiko');
  const a = await fetch(`${base}/api/auth?login=${encodeURIComponent(login)}&pass=${await sha1(pass)}`);
  const key = (await a.text()).trim();
  if (!a.ok || key.length > 100 || key.includes('<')) throw new Error(`сервер iiko не принял логин (${a.status})`);
  try {
    const body = {
      reportType: 'SALES', buildSummary: false,
      groupByRowFields: ['OpenDate.Typed', 'PayTypes', 'PayTypes.Group'],
      aggregateFields: ['DishDiscountSumInt'],
      filters: {
        'OpenDate.Typed': { filterType: 'DateRange', periodType: 'CUSTOM', from, to: addDay(to), includeLow: true, includeHigh: false },
        'OrderDeleted': { filterType: 'IncludeValues', values: ['NOT_DELETED'] },
        'DeletedWithWriteoff': { filterType: 'IncludeValues', values: ['NOT_DELETED'] },
      },
    };
    const r = await fetch(`${base}/api/v2/reports/olap?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const txt = await r.text();
    if (!r.ok) throw new Error(`OLAP ${r.status}: ${txt.slice(0, 200)}`);
    return ((JSON.parse(txt).data || []) as any[]).map((x) => ({
      day: String(x['OpenDate.Typed'] || '').slice(0, 10), name: String(x['PayTypes'] || '').trim(),
      grp: String(x['PayTypes.Group'] || ''), sum: Number(x['DishDiscountSumInt'] || 0),
    })).filter((x) => x.day && x.name && x.name !== '(без оплаты)' && !SKIP(x.name));
  } finally {
    await fetch(`${base}/api/logout?key=${key}`).catch(() => {});
  }
}

const kindFor = (grp: string) => grp === 'CASH' ? 'cash' : grp === 'CARD' ? 'bank' : 'other';

async function cashboxFor(venue: string, name: string, grp: string, cache: Map<string, string>) {
  if (cache.has(name)) return cache.get(name)!;
  let { data } = await db.from('crm_cashboxes').select('id').eq('venue_id', venue).eq('iiko_pay_type', name).maybeSingle();
  if (!data) {
    const { count } = await db.from('crm_cashboxes').select('id', { count: 'exact', head: true }).eq('venue_id', venue);
    const ins = await db.from('crm_cashboxes').insert({ venue_id: venue, name, kind: kindFor(grp), iiko_pay_type: name, sort: (count || 0) + 1 }).select('id').single();
    if (ins.error) throw new Error(ins.error.message);
    data = ins.data;
  }
  cache.set(name, data!.id);
  return data!.id as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!(await allowed(req))) return json({ error: 'Нет доступа' }, 403);
    const b = await req.json().catch(() => ({}));
    const venue = b.venue || 'petrogradka';
    const cache = new Map<string, string>();

    if (b.action === 'types') {
      const to = mskToday(), from = addDay(to, -90);
      const rows = await olap(from, to);
      const types = new Map<string, string>();
      rows.forEach((r) => { if (!IS_POINTS(r.name)) types.set(r.name, r.grp); });
      for (const [name, grp] of types) await cashboxFor(venue, name, grp, cache);
      return json({ venue, types: [...types].map(([name, grp]) => ({ name, grp })) });
    }

    const yesterday = addDay(mskToday(), -1);
    const from = b.from || yesterday, to = b.to || from;
    if (to < from || (new Date(to).getTime() - new Date(from).getTime()) > 62 * 864e5) return json({ error: 'Период до 62 дней' }, 400);

    const rows = await olap(from, to);
    const days: Record<string, any> = {};
    for (const r of rows) {
      const t = days[r.day] = days[r.day] || { day: r.day, cashless: 0, cash: 0, loyalty: 0, yandex: 0, types: {} as Record<string, { grp: string; sum: number }> };
      if (IS_POINTS(r.name)) { t.loyalty += r.sum; continue; }
      if (/яндекс|yandex/i.test(r.name)) t.yandex += r.sum;
      else if (r.grp === 'CASH') t.cash += r.sum;
      else if (r.grp === 'CARD') t.cashless += r.sum;
      const ty = t.types[r.name] = t.types[r.name] || { grp: r.grp, sum: 0 };
      ty.sum += r.sum;
    }
    const list = Object.values(days).sort((a: any, z: any) => a.day.localeCompare(z.day));
    if (b.action !== 'save') return json({ from, to, venue, days: list });

    let saved = 0;
    for (const t of list as any[]) {
      const by: Record<string, number> = {};
      for (const [n, v] of Object.entries(t.types) as any) by[n] = v.sum;
      const { error } = await db.from('crm_daily_revenue').upsert({ venue_id: venue, day: t.day, cashless: t.cashless, cash: t.cash, loyalty: t.loyalty || null, yandex: t.yandex || null, by_pay_type: by, source: 'iiko', updated_at: new Date().toISOString() }, { onConflict: 'venue_id,day' });
      if (error) throw new Error(error.message);
      for (const [name, v] of Object.entries(t.types) as any) {
        const cb = await cashboxFor(venue, name, v.grp, cache);
        await db.from('crm_cash_ops').delete().eq('cashbox_id', cb).eq('op_date', t.day).eq('source', 'iiko');
        if (v.sum > 0) await db.from('crm_cash_ops').insert({ cashbox_id: cb, op_date: t.day, direction: 'in', amount: v.sum, category: 'Выручка', comment: `${name} за день (iiko)`, source: 'iiko' });
      }
      saved++;
    }
    return json({ from, to, venue, saved, days: list });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
