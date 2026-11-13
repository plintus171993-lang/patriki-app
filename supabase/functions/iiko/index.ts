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
//   probe — по ключу кассы app_secrets.pos_api_key (диагностика из SQL-редактора);
//   front-lookup / front-close — для плагина кассы iikoFront, по ключу кассы (заголовок x-pos-key);
//   front-inbox / front-reserve / front-order — заявки из приложения на главной кассе (тоже по ключу кассы):
//     новые брони и заказы точки, решение официанта «подтвердить / отклонить».

import { createClient } from 'npm:@supabase/supabase-js@2';

const IIKO = 'https://api-ru.iiko.services/api/1/';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pos-key',
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


/* ---------------- заявки из приложения на кассе ---------------- */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Онлайн-оплата: списать заблокированные деньги / снять блокировку — через функцию sber (служебный вызов)
async function sberAction(action: 'capture' | 'cancel', orderId: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/sber`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SERVICE_KEY, apikey: SERVICE_KEY },
    body: JSON.stringify({ action, order_id: orderId }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `оплата: ошибка ${r.status}`);
  return d as { payment_status: string };
}

async function venueChatNotify(venue: string, text: string) {
  try {
    const chat = (await secret('telegram_chat_id:' + venue)) || (await secret('telegram_chat_id'));
    if (chat) await db.rpc('tg_send', { p_chat: chat, p_text: text });
  } catch { /* уведомление не обязательно */ }
}

const PAY_TEXT: Record<string, string> = { cash: 'наличными курьеру', card: 'картой курьеру', online: 'онлайн' };

async function frontInbox(venue: string) {
  const since = new Date(Date.now() - 2 * 86400e3).toISOString();
  const { data: rs, error: e1 } = await db.from('reservations')
    .select('id, number, starts_at, guests, name, phone, comment, deposit, payment_status, created_at')
    .eq('venue_id', venue).eq('status', 'new').gte('created_at', since).order('created_at');
  if (e1) throw new Error(e1.message);
  const { data: os, error: e2 } = await db.from('orders')
    .select('id, number, customer_name, phone, address, comment, when_text, payment, payment_status, items, subtotal, delivery_fee, total, points_redeemed, created_at')
    .eq('venue_id', venue).eq('status', 'new').gte('created_at', since).order('created_at');
  if (e2) throw new Error(e2.message);
  return {
    reservations: (rs || []).filter((r: any) => !r.deposit || ['held', 'paid'].includes(r.payment_status)),
    // онлайн-заказ показываем, только когда деньги уже заблокированы
    orders: (os || []).filter((o: any) => o.payment !== 'online' || ['held', 'paid'].includes(o.payment_status))
      .map((o: any) => ({ ...o, payment_text: o.payment === 'online' ? (o.payment_status === 'paid' ? 'ОПЛАЧЕН онлайн' : 'ОПЛАЧЕН онлайн (деньги заблокированы, спишутся при принятии)') : (PAY_TEXT[o.payment] || o.payment) })),
  };
}

async function frontReserve(venue: string, b: any) {
  const confirm = b.decision === 'confirm';
  const staff = String(b.staff || '').slice(0, 80);
  const patch: Record<string, unknown> = {
    status: confirm ? 'confirmed' : 'declined', updated_at: new Date().toISOString(),
    handled_at: new Date().toISOString(), handled_by: staff,
    staff_note: confirm ? `Касса iiko: ${b.table ? 'стол ' + String(b.table).slice(0, 60) : 'подтверждена'}` : 'Касса iiko: отклонена',
  };
  if (b.iiko_id) patch.iiko_reserve_id = String(b.iiko_id).slice(0, 64);
  const { data, error } = await db.from('reservations').update(patch)
    .eq('id', b.id).eq('venue_id', venue).eq('status', 'new').select('number').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Эту бронь уже обработали или гость её отменил');
  await venueChatNotify(venue, confirm
    ? `✅ Бронь №${data.number} подтверждена на кассе${b.table ? ` — стол ${b.table}` : ''}${staff ? ` (${staff})` : ''}`
    : `❌ Бронь №${data.number} отклонена на кассе${staff ? ` (${staff})` : ''}`);
  return { ok: true, number: data.number };
}

async function frontOrder(venue: string, b: any) {
  const accept = b.decision === 'accept';
  const staff = String(b.staff || '').slice(0, 80);
  const { data: o, error } = await db.from('orders').select('id, number, status, payment, payment_status')
    .eq('id', b.id).eq('venue_id', venue).maybeSingle();
  if (error) throw new Error(error.message);
  if (!o || o.status !== 'new') throw new Error('Этот заказ уже обработали или гость его отменил');

  // сначала деньги: если списать не удалось — заказ не принимаем
  let pay = o.payment_status;
  if (o.payment === 'online' && ['held', 'paid'].includes(o.payment_status)) {
    pay = (await sberAction(accept ? 'capture' : 'cancel', o.id)).payment_status;
  }
  const patch: Record<string, unknown> = {
    status: accept ? 'cooking' : 'cancelled', handled_at: new Date().toISOString(), handled_by: staff,
  };
  if (b.iiko_id) patch.iiko_order_id = String(b.iiko_id).slice(0, 64);
  const { data: upd, error: e2 } = await db.from('orders').update(patch).eq('id', o.id).eq('status', 'new').select('number').maybeSingle();
  if (e2) throw new Error(e2.message);
  if (!upd) throw new Error('Этот заказ уже обработали');
  await venueChatNotify(venue, accept
    ? `✅ Заказ №${o.number} принят на кассе и отправлен на кухню${b.iiko_number ? ` (iiko №${b.iiko_number})` : ''}${staff ? ` — ${staff}` : ''}`
    : `❌ Заказ №${o.number} отклонён на кассе${staff ? ` — ${staff}` : ''}${o.payment === 'online' ? `. Оплата: ${pay}` : ''}`);
  return { ok: true, number: o.number, payment_status: pay };
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

    /* ---------- плагин кассы iikoFront (ключ кассы в заголовке x-pos-key) ---------- */
    if (act === 'front-lookup' || act === 'front-close') {
      const key = req.headers.get('x-pos-key') || b.key || '';
      if (!key || key !== await secret('pos_api_key')) return json({ error: 'Неверный ключ кассы' }, 403);
      const code = String(b.code || '').trim();
      if (!code) throw new Error('Нет QR-кода гостя');
      if (act === 'front-lookup') {
        const { data, error } = await db.rpc('pos_lookup', { p_key: key, p_code: code });
        if (error) throw new Error(error.message);
        return json(data);
      }
      const o = b.order || {};
      if (!o.id) throw new Error('Нет id заказа iiko');
      const ex = await excluded();
      let total = 0, eligible = 0;
      const lines = (o.items || []).map((it: any) => {
        const sum = Number(it.sum ?? it.resultSum ?? 0);
        const off = ex.has(String(it.productId || '')) || ex.has(String(it.productGroupId || ''));
        total += sum; if (!off) eligible += sum;
        return { name: it.name || '', sum: Math.round(sum), off };
      });
      const orderSum = Number(o.sum ?? total);
      if (total > 0 && Math.abs(orderSum - total) > 0.5) eligible = eligible * orderSum / total; // скидки на весь чек
      eligible = Math.floor(eligible);
      if (eligible <= 0) return json({ points: 0, eligible: 0, note: 'В чеке нет позиций, за которые начисляются баллы', lines });
      const { data, error } = await db.rpc('iiko_apply', {
        p_code: code, p_check_id: 'iiko:' + o.id, p_number: String(o.number ?? ''), p_sum: Math.round(orderSum),
        p_amount: eligible, p_redeem: Number(b.redeem || 0), p_venue: String(b.venue || 'petrogradka'), p_staff: null,
      });
      if (error) throw new Error(error.message);
      return json({ ...data, eligible, lines });
    }

    /* ---------- заявки из приложения на главной кассе ---------- */
    if (act === 'front-inbox' || act === 'front-reserve' || act === 'front-order') {
      const key = req.headers.get('x-pos-key') || b.key || '';
      if (!key || key !== await secret('pos_api_key')) return json({ error: 'Неверный ключ кассы' }, 403);
      const venue = String(b.venue || '');
      const { data: v } = await db.from('venues').select('id').eq('id', venue).maybeSingle();
      if (!v) throw new Error('Неизвестное заведение: ' + venue);
      if (act === 'front-inbox') return json(await frontInbox(venue));
      if (!b.id) throw new Error('Нет id заявки');
      if (act === 'front-reserve') return json(await frontReserve(venue, b));
      return json(await frontOrder(venue, b));
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
