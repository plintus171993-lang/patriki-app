// Патрики Паб — связка с iiko через Cloud API (Supabase Edge Function «iiko»).
//
// Сценарий «баллы по QR в пабе»: бармен в «Касса · QR» сканирует QR гостя, выбирает чек
// из списка свежих заказов iiko — сумму и состав берём из iiko, позиции «без баллов»
// (акции) исключаем, начисляем гостю. Один чек iiko проводится только один раз.
//
// Доступ к iiko (таблица app_secrets, в приложение не попадает): iiko_api_login — API-ключ из iikoWeb,
// iiko_app_id и iiko_client_secret — приложение на портале разработчика iiko (api.iiko.help).
// Необязательно: app_secrets 'iiko_org:<venue>' — id организации iiko для заведения
// (если не задано — берётся первая организация логина).
//
// Функция разворачивается с выключенной проверкой JWT; права проверяются внутри:
//   checks / accrue / menu — управляющий (таблица admins), menu-save — владелец;
//   probe — по ключу кассы app_secrets.pos_api_key (диагностика из SQL-редактора).

import { createClient } from 'npm:@supabase/supabase-js@2';

const IIKO = 'https://api-ru.iiko.services/api/1/';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function secret(key: string) {
  const { data } = await db.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return (data?.value as string) || '';
}

/* ---------------- iiko Cloud API ---------------- */
let token = '';
async function iiko(method: string, body: unknown) {
  if (!token) {
    const login = await secret('iiko_api_login');
    if (!login) throw new Error('Не задан API-логин iiko (app_secrets.iiko_api_login)');
    // Авторизация iiko v2: apiKey (из iikoWeb) + appId и clientSecret приложения
    // с портала разработчика iiko (api.iiko.help). Старые ключи — /api/1/access_token.
    const apiKey = login.trim(), appId = (await secret('iiko_app_id')).trim(), sec = (await secret('iiko_client_secret')).trim();
    const tries: [string, Record<string, string>][] = [];
    if (appId && sec) tries.push([IIKO.replace('/api/1/', '/api/v2/') + 'access_token', { appId, clientSecret: sec, apiKey }]);
    tries.push([IIKO + 'access_token', { apiLogin: apiKey }]);
    let last = appId && sec ? '' : 'не заданы iiko_app_id / iiko_client_secret. ';
    for (const [url, body] of tries) {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const txt = await r.text();
      let d: any = {}; try { d = JSON.parse(txt); } catch { d = txt; }
      const t = d?.token || d?.accessToken || d?.access_token || (typeof d === 'string' && r.ok ? d : '');
      if (t) { token = t; break; }
      last += `[${url.includes('/v2/') ? 'v2' : 'v1'}] ${r.status} ${d?.errorDescription || d?.error || d?.message || String(txt).slice(0, 200)} `;
    }
    if (!token) throw new Error('iiko не принял API-логин: ' + last);
  }
  const r = await fetch(IIKO + method, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`iiko ${method}: ${d.errorDescription || d.error || r.status}`);
  return d;
}

async function orgId(venue: string) {
  const fixed = venue ? await secret('iiko_org:' + venue) : '';
  if (fixed) return fixed;
  const d = await iiko('organizations', { returnAdditionalInfo: false, includeDisabled: false });
  const id = d.organizations?.[0]?.id;
  if (!id) throw new Error('В iiko нет доступных организаций для этого API-логина');
  return id as string;
}

async function tables(org: string) {
  const tg = await iiko('terminal_groups', { organizationIds: [org], includeDisabled: true });
  const tgIds = (tg.terminalGroups || []).flatMap((g: any) => (g.items || []).map((i: any) => i.id));
  if (!tgIds.length) return { tgIds, tables: [] as any[] };
  const s = await iiko('reserve/available_restaurant_sections', { terminalGroupIds: tgIds, returnSchema: false });
  const list = (s.restaurantSections || []).flatMap((sec: any) => (sec.tables || []).map((t: any) => ({ id: t.id, number: t.number, name: t.name, section: sec.name })));
  return { tgIds, tables: list };
}

// Время в формате iiko (по Москве): yyyy-MM-dd HH:mm:ss.fff
const iikoTime = (d: Date) => new Date(d.getTime() + 3 * 3600e3).toISOString().replace('T', ' ').replace('Z', '');

async function recentOrders(org: string, hours = 14) {
  const { tables: tl } = await tables(org);
  if (!tl.length) return { orders: [] as any[], tables: tl };
  const byId = Object.fromEntries(tl.map((t: any) => [t.id, t]));
  const out: any[] = [];
  for (let i = 0; i < tl.length; i += 100) {
    const d = await iiko('order/by_table', {
      organizationIds: [org], tableIds: tl.slice(i, i + 100).map((t: any) => t.id),
      statuses: ['New', 'Bill', 'Closed'],
      dateFrom: iikoTime(new Date(Date.now() - hours * 3600e3)), dateTo: iikoTime(new Date(Date.now() + 3600e3)),
    });
    out.push(...(d.orders || []));
  }
  return { orders: out, tables: tl, byId };
}

/* ---------------- исключения («без баллов») ---------------- */
async function excluded() {
  const { data } = await db.from('loyalty_settings').select('iiko_excluded').eq('id', 1).maybeSingle();
  return new Set<string>(((data?.iiko_excluded as any[]) || []).map((x: any) => String(x.id || x)));
}

function summarize(o: any, ex: Set<string>, byId: Record<string, any> = {}) {
  const ord = o.order || {};
  const items = (ord.items || []).filter((it: any) => !it.deleted);
  let total = 0, eligible = 0;
  const lines = items.map((it: any) => {
    const sum = Number(it.resultSum ?? it.cost ?? 0);
    const pid = it.product?.id || it.productId || '';
    const gid = it.product?.parentGroup || it.productGroupId || '';
    const off = ex.has(pid) || (gid && ex.has(gid));
    total += sum; if (!off) eligible += sum;
    return { name: it.product?.name || it.name || 'Позиция', amount: Number(it.amount || 1), sum: Math.round(sum), off };
  });
  // если в заказе есть итог от iiko (со скидками на заказ) — пропорционально корректируем
  const iikoSum = Number(ord.sum ?? total);
  if (total > 0 && iikoSum >= 0 && Math.abs(iikoSum - total) > 0.5) eligible = eligible * iikoSum / total;
  const tId = (ord.tableIds || [])[0];
  return {
    id: o.id, number: ord.number ?? o.posId ?? '', status: ord.status || o.creationStatus,
    table: tId && byId[tId] ? (byId[tId].name || byId[tId].number) : '',
    opened: ord.whenCreated || '', closed: ord.whenClosed || '', bill: ord.whenBillPrinted || '',
    sum: Math.round(iikoSum), eligible: Math.floor(eligible), lines,
  };
}

/* ---------------- права ---------------- */
async function requireAdmin(req: Request, venue = '') {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!t) throw new Error('Нет входа');
  const { data: u } = await db.auth.getUser(t);
  if (!u?.user) throw new Error('Нет входа');
  const { data } = await db.from('admins').select('*').eq('user_id', u.user.id).maybeSingle();
  if (!data) throw new Error('Нет прав управляющего');
  if (venue && data.venue_id && data.venue_id !== venue) throw new Error('Это другое заведение');
  return { user: u.user.id, venue: data.venue_id as string | null };
}

/* ---------------- обработчик ---------------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    const act = b.action;

    if (act === 'probe') {
      if (!b.key || b.key !== await secret('pos_api_key')) return json({ error: 'Неверный ключ' }, 403);
      const orgs = await iiko('organizations', { returnAdditionalInfo: false, includeDisabled: true });
      const org = orgs.organizations?.[0]?.id;
      const tg = await iiko('terminal_groups', { organizationIds: [org], includeDisabled: true });
      let tgRaw = ''; try { tgRaw = JSON.stringify(tg).slice(0, 600); } catch { /* */ }
      const { tables: tl } = await tables(org);
      let orders: any[] = [], ordErr = '';
      try { const r = await recentOrders(org, Number(b.hours || 24)); const ex = await excluded(); orders = r.orders.map((o) => summarize(o, ex, r.byId)); } catch (e) { ordErr = String((e as Error).message); }
      // варианты запроса заказов по столам — какие из них iiko отдаёт для заказов с кассы
      const variants: Record<string, unknown> = {};
      const tIds = tl.map((t: any) => t.id);
      const base = { organizationIds: [org], tableIds: tIds };
      const from = iikoTime(new Date(Date.now() - 36 * 3600e3)), to = iikoTime(new Date(Date.now() + 3600e3));
      const vs: Record<string, any> = {
        plain: { ...base },
        dates: { ...base, dateFrom: from, dateTo: to },
        allStatuses: { ...base, statuses: ['New', 'Bill', 'Closed', 'Deleted'], dateFrom: from, dateTo: to },
        srcEmpty: { ...base, sourceKeys: [], dateFrom: from, dateTo: to },
      };
      for (const [k, body] of Object.entries(vs)) {
        try { const d = await iiko('order/by_table', body); variants[k] = { n: (d.orders || []).length, sample: JSON.stringify((d.orders || [])[0] || {}).slice(0, 300) }; }
        catch (e) { variants[k] = String((e as Error).message).slice(0, 200); }
      }
      return json({
        variants,
        organizations: (orgs.organizations || []).map((o: any) => ({ id: o.id, name: o.name })),
        terminalGroups: (tg.terminalGroups || []).flatMap((g: any) => g.items || []).map((i: any) => ({ id: i.id, name: i.name })),
        tables: tl.length, sections: [...new Set(tl.map((t: any) => t.section))],
        orders: orders.slice(0, 15).map((o) => ({ ...o, lines: o.lines.length })), ordersTotal: orders.length, ordErr, tgRaw,
      });
    }

    if (act === 'checks') {
      const venue = String(b.venue || 'petrogradka');
      await requireAdmin(req, venue);
      const org = await orgId(venue);
      const r = await recentOrders(org, Number(b.hours || 14));
      const ex = await excluded();
      const ids = r.orders.map((o: any) => 'iiko:' + o.id);
      const { data: used } = ids.length ? await db.from('iiko_checks').select('check_id, guest_name').in('check_id', ids) : { data: [] };
      const usedMap = Object.fromEntries((used || []).map((u: any) => [u.check_id, u.guest_name]));
      const list = r.orders.map((o: any) => ({ ...summarize(o, ex, r.byId), used: usedMap['iiko:' + o.id] ?? null }))
        .filter((o: any) => o.sum > 0)
        .sort((a: any, z: any) => String(z.bill || z.closed || z.opened).localeCompare(String(a.bill || a.closed || a.opened)));
      return json({ checks: list });
    }

    if (act === 'accrue') {
      const venue = String(b.venue || 'petrogradka');
      const who = await requireAdmin(req, venue);
      if (!b.code || !b.orderId) throw new Error('Нужны QR гостя и чек');
      const org = await orgId(venue);
      const d = await iiko('order/by_id', { organizationIds: [org], orderIds: [b.orderId] });
      const o = (d.orders || [])[0];
      if (!o || !o.order) throw new Error('Чек не найден в iiko');
      const s = summarize(o, await excluded());
      if (s.eligible <= 0) throw new Error('В чеке нет позиций, за которые начисляются баллы');
      const { data, error } = await db.rpc('iiko_apply', {
        p_code: String(b.code), p_check_id: 'iiko:' + o.id, p_number: String(s.number), p_sum: s.sum,
        p_amount: s.eligible, p_redeem: Number(b.redeem || 0), p_venue: venue, p_staff: who.user,
      });
      if (error) throw new Error(error.message);
      return json({ ...data, check: s });
    }

    if (act === 'menu') {
      await requireAdmin(req);
      const org = await orgId(String(b.venue || ''));
      const n = await iiko('nomenclature', { organizationId: org });
      const groups = (n.groups || []).filter((g: any) => !g.isDeleted && g.isIncludedInMenu !== false).map((g: any) => ({ id: g.id, name: g.name, parent: g.parentGroup }));
      const products = (n.products || []).filter((p: any) => !p.isDeleted && (p.type === 'Dish' || p.type === 'Goods' || p.type === 'Modifier' ? p.type !== 'Modifier' : true))
        .map((p: any) => ({ id: p.id, name: p.name, group: p.parentGroup }));
      return json({ groups, products });
    }

    return json({ error: 'Неизвестное действие' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
