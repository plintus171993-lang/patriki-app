// Серверная функция приложения для официантов (www/waiter/).
// Разворачивается с ВЫКЛЮЧЕННОЙ проверкой JWT: авторизация своя — по ПИН-коду официанта,
// дальше по токену сессии (заголовок x-waiter-token).
//
// Ключи iiko (app_secrets, в приложение не попадают):
//   waiter_iiko_api_key       — API-ключ интеграции «Официант-приложение» из iikoWeb
//   waiter_iiko_app_id        — App ID приложения «Официант-приложение» с портала api.iiko.help
//   waiter_iiko_client_secret — Client Secret того же приложения
//   waiter_iiko_menu          — название внешнего меню iiko (по умолчанию «Официант»)
//
// Все запросы — POST { action, ... }:
//   login {pin}                         → {token, name, role}
//   bootstrap {force?}                  → {staff, tables, menu, stop, alive}
//   stop                                → {stop, alive}
//   table_orders {tableId}              → {orders}
//   send {clientId, tableId, tableLabel, orderId?, guests?, items[]} → {correlationId, orderId, logId}
//   status {correlationId}              → {state, error?}
//   history                             → {orders}
//   staff_list / staff_iiko / staff_save {id?, name, pin, role, iikoEmployeeId?} / staff_disable {id} — только управляющий
//   (staff_iiko — сотрудники из iiko; уволенный в iiko сотрудник отключается в приложении сам)
//
// Как заказ попадает на кассу (app_secrets.waiter_mode):
//   plugin (по умолчанию) — заказ встаёт в очередь waiter_orders, плагин «Карта Патрики» на главной
//     кассе забирает его, создаёт на столе в iikoFront от имени официанта и печатает на кухню.
//     Облако iiko (iikoTransport) для этого не нужно. Плагин ходит сюда с ключом кассы (x-pos-key):
//       pos_poll {venue, tables?}  → {orders}   — пульс кассы + снимок открытых заказов столов
//       pos_result {id, ok, error?, iikoOrderId?, number?}
//   cloud — напрямую через iikoCloud API (нужна касса, подключённая к iikoTransport).
import { createClient } from 'npm:@supabase/supabase-js@2';

const IIKO = 'https://api-ru.iiko.services/api/';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-waiter-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function secret(key: string) {
  const { data } = await db.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return ((data?.value as string) || '').trim();
}

async function mode() { return ((await secret('waiter_mode')) || 'plugin').toLowerCase(); }
async function venue() { return (await secret('waiter_venue')) || 'petrogradka'; }

/* ---------------- iiko Cloud API ---------------- */
let token = '', tokenAt = 0;
async function iikoToken() {
  if (token && Date.now() - tokenAt < 45 * 60 * 1000) return token; // токен iiko живёт час
  const [apiKey, appId, clientSecret] = await Promise.all([secret('waiter_iiko_api_key'), secret('waiter_iiko_app_id'), secret('waiter_iiko_client_secret')]);
  if (!apiKey || !appId || !clientSecret) throw new Error('Не заданы ключи iiko для официантов (app_secrets.waiter_iiko_*)');
  const r = await fetch(IIKO + 'v2/access_token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey, appId, clientSecret }) });
  const d = await r.json().catch(() => ({}));
  if (!d.token) throw new Error('iiko не выдал токен: ' + (d.errorDescription || r.status));
  token = d.token; tokenAt = Date.now();
  return token;
}
async function iiko(method: string, body: unknown, timeout = 15) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await iikoToken();
    const r = await fetch(IIKO + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, Timeout: String(timeout) },
      body: JSON.stringify(body),
    });
    if (r.status === 401 && attempt === 0) { token = ''; continue; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`iiko ${method}: ${d.errorDescription || d.error || r.status}`);
    return d;
  }
  throw new Error('iiko: нет доступа');
}

/* ---------------- кэш ---------------- */
async function cached<T>(key: string, maxAgeSec: number, load: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    const { data } = await db.from('waiter_cache').select('data, updated_at').eq('key', key).maybeSingle();
    if (data && Date.now() - new Date(data.updated_at).getTime() < maxAgeSec * 1000) return data.data as T;
  }
  const v = await load();
  await db.from('waiter_cache').upsert({ key, data: v as unknown as object, updated_at: new Date().toISOString() });
  return v;
}

type Ctx = { org: string; tg: string };
async function ctx(): Promise<Ctx> {
  return cached('ctx', 3600, async () => {
    const o = await iiko('1/organizations', { returnAdditionalInfo: false, includeDisabled: false });
    const org = o.organizations?.[0]?.id;
    if (!org) throw new Error('В iiko нет организации для ключа официантов');
    // касса может числиться в iiko «неактивной» (выключена, нет связи) — берём и такие
    const t = await iiko('1/terminal_groups', { organizationIds: [org], includeDisabled: true });
    const all = [...(t.terminalGroups || []), ...(t.terminalGroupsInSleep || [])].flatMap((g: any) => g.items || []);
    const tg = all[0]?.id;
    if (!tg) throw new Error('В iiko нет терминальной группы');
    return { org, tg };
  });
}

async function loadTables(c: Ctx) {
  const s = await iiko('1/reserve/available_restaurant_sections', { terminalGroupIds: [c.tg], returnSchema: false });
  return (s.restaurantSections || []).map((sec: any) => ({
    id: sec.id, name: sec.name,
    tables: (sec.tables || []).filter((t: any) => !t.isDeleted)
      .map((t: any) => ({ id: t.id, number: t.number, name: t.name || String(t.number) }))
      .sort((a: any, b: any) => a.number - b.number),
  }));
}

async function loadMenu(c: Ctx) {
  const want = (await secret('waiter_iiko_menu')) || 'Официант';
  const list = await iiko('2/menu', {});
  const m = (list.externalMenus || []).find((x: any) => x.name === want) || list.externalMenus?.[0];
  if (!m) throw new Error('В iikoWeb нет внешнего меню «' + want + '», подключённого к ключу официантов');
  const d = await iiko('menu/v3/by_id', { externalMenuId: String(m.id), organizationId: c.org }, 30);
  const modById = new Map<string, any>((d.modifiers || []).map((x: any) => [x.id, x]));
  const groups = (d.itemsGroups || [])
    .filter((g: any) => !/^доставка/i.test(g.name || ''))
    .map((g: any) => ({
      id: g.id, name: g.name,
      items: (g.items || []).map((it: any) => {
        const sp = (it.sizePrices || []).find((s: any) => s.isDefault) || it.sizePrices?.[0] || {};
        return {
          id: it.productId, name: it.name, price: Number(sp.price || 0), sizeId: sp.menuItemSizeId || null,
          sizes: (it.sizePrices || []).length > 1 ? it.sizePrices.map((s: any) => ({ id: s.menuItemSizeId, name: s.sizeName, price: Number(s.price || 0) })) : undefined,
          // группа без id — одиночный модификатор: в заказ уходит без productGroupId
          mods: (it.modifierGroups || []).map((mg: any, gi: number) => ({
            id: mg.id || `single:${mg.items?.[0]?.id || gi}`, group: !!mg.id, name: String(mg.name || '').replace(/^[-\s]+/, ''),
            min: Number(mg.restrictions?.minQuantity || 0), max: Number(mg.restrictions?.maxQuantity || 0),
            def: Number(mg.restrictions?.defaultQuantity || 0),
            items: (mg.items || []).map((mi: any) => {
              const md = modById.get(mi.id) || {};
              return { id: mi.id, name: (md.name || mi.name || '').replace(/^[-\s]+/, ''), price: Number(md.sizePrices?.[0]?.price || 0) };
            }).filter((x: any) => x.name),
          })),
        };
      }),
    }))
    .filter((g: any) => g.items.length);
  return { id: String(m.id), name: m.name, groups };
}

async function loadStop(c: Ctx) {
  const s = await iiko('1/stop_lists', { organizationIds: [c.org], terminalGroupsIds: [c.tg] });
  const out: Record<string, number> = {};
  for (const o of s.terminalGroupStopLists || []) for (const t of o.items || []) for (const i of t.items || []) out[i.productId] = Number(i.balance || 0);
  return out;
}

async function alive(c: Ctx) {
  if (await mode() === 'plugin') {
    const { data } = await db.from('waiter_cache').select('updated_at').eq('key', 'pos_seen:' + await venue()).maybeSingle();
    return !!data && Date.now() - new Date(data.updated_at).getTime() < 90 * 1000;
  }
  try {
    const a = await iiko('1/terminal_groups/is_alive', { organizationIds: [c.org], terminalGroupIds: [c.tg] }, 10);
    const s = (a.isAliveStatus || []).find((x: any) => x.terminalGroupId === c.tg);
    return s ? !!s.isAlive : null; // null — iiko не знает
  } catch { return null; }
}

/* ---------- сотрудники iiko (для привязки официантов) ---------- */
const TECH = /^(пользователь|сотрудник техподдержки|iikoteh|it$|контроль приложение)/i;
async function loadEmployees() {
  const [e, p] = await Promise.all([
    iiko('employees/v1/employee/list', { limit: 1000 }, 30),
    iiko('employees/v1/positions/list', { limit: 500 }, 30).catch(() => ({ items: [] })),
  ]);
  const pos = new Map<string, string>((p.items || []).map((x: any) => [x.id, x.name]));
  return (e.items || [])
    .filter((x: any) => !x.isSystem && !TECH.test(String(x.name || '').trim()))
    .map((x: any) => ({
      id: x.id, name: String(x.name || [x.lastName, x.firstName].filter(Boolean).join(' ')).trim(), fired: !!x.isFired,
      roles: [x.mainRoleId, ...(x.roleIds || [])].filter(Boolean).map((r: string) => pos.get(r)).filter(Boolean)
        .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i),
    }));
}
// уволенный (или удалённый) в iiko сотрудник отключается и в приложении
async function syncStaff(force = false) {
  const emps = await cached('employees', 600, loadEmployees, force);
  if (!emps.length) return emps; // пустой ответ iiko — никого не отключаем
  const byId = new Map(emps.map((x: any) => [x.id, x]));
  const { data } = await db.from('waiter_staff').select('id, iiko_employee_id, iiko_name').eq('active', true).not('iiko_employee_id', 'is', null);
  for (const s of data || []) {
    const e: any = byId.get(s.iiko_employee_id);
    if (!e || e.fired) {
      await db.from('waiter_staff').update({ active: false }).eq('id', s.id);
      await db.from('waiter_sessions').delete().eq('staff_id', s.id);
    } else if (e.name !== s.iiko_name) {
      await db.from('waiter_staff').update({ iiko_name: e.name }).eq('id', s.id);
    }
  }
  return emps;
}

async function waitCommand(org: string, correlationId: string, maxMs = 8000) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const s = await iiko('1/commands/status', { organizationId: org, correlationId });
    if (s.state !== 'InProgress') return s;
    await new Promise((r) => setTimeout(r, 700));
  }
  return { state: 'InProgress' };
}

/* ---------------- авторизация ---------------- */
type Staff = { id: string; name: string; role: string };
async function session(req: Request): Promise<Staff> {
  const t = req.headers.get('x-waiter-token') || '';
  if (!t) throw new HttpError(401, 'Нужен вход по ПИН');
  const { data } = await db.from('waiter_sessions').select('expires_at, waiter_staff(id, name, role, active)').eq('token', t).maybeSingle();
  const s: any = data?.waiter_staff;
  if (!data || !s?.active || new Date(data.expires_at).getTime() < Date.now()) throw new HttpError(401, 'Сессия закончилась, войдите снова');
  return { id: s.id, name: s.name, role: s.role };
}

async function login(req: Request, pin: string) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await db.from('waiter_login_attempts').select('id', { count: 'exact', head: true }).eq('ip', ip).eq('ok', false).gte('created_at', since);
  if ((count || 0) >= 10) throw new HttpError(429, 'Слишком много попыток. Подождите 10 минут');
  if (!/^[0-9]{4,6}$/.test(pin || '')) throw new HttpError(400, 'ПИН — от 4 до 6 цифр');
  try { await syncStaff(); } catch (_) { /* iiko недоступен — входим по сохранённому списку */ }
  const { data, error } = await db.rpc('waiter_check_pin', { p_pin: pin });
  if (error) throw error;
  const s = (data as Staff[])?.[0];
  await db.from('waiter_login_attempts').insert({ ip, ok: !!s });
  if (!s) throw new HttpError(403, 'Неверный ПИН');
  const tok = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '');
  await db.from('waiter_sessions').insert({ token: tok, staff_id: s.id });
  await db.from('waiter_sessions').delete().lt('expires_at', new Date().toISOString());
  return { token: tok, name: s.name, role: s.role };
}

/* ---------------- заказы ---------------- */
function orderItems(items: any[]) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Пустой заказ');
  return items.map((i) => {
    const amount = Number(i.amount);
    if (!i.productId || !(amount > 0) || amount > 99) throw new HttpError(400, 'Неверная позиция заказа');
    return {
      type: 'Product', productId: i.productId, amount, price: Number(i.price || 0),
      productSizeId: i.sizeId || undefined,
      comment: i.comment ? String(i.comment).slice(0, 200) : undefined,
      modifiers: (i.mods || []).map((m: any) => ({ productId: m.id, productGroupId: m.groupId || undefined, amount: Number(m.amount || 1), price: Number(m.price || 0) })),
    };
  });
}

async function send(staff: Staff, b: any) {
  const clientId = String(b.clientId || '');
  if (!clientId) throw new HttpError(400, 'Нет clientId');
  // повторная отправка того же заказа (пропадала связь) — вернуть прежний результат
  const { data: prev } = await db.from('waiter_orders').select('id, correlation_id, iiko_order_id, status, error').eq('client_id', clientId).maybeSingle();
  if (prev && prev.status !== 'error') return { correlationId: prev.correlation_id, orderId: prev.iiko_order_id, logId: prev.id, repeated: true };
  if (await mode() === 'plugin') {
    orderItems(b.items); // проверка
    const items = b.items.map((i: any) => ({
      productId: i.productId, name: String(i.name || '').slice(0, 120), amount: Number(i.amount), price: Number(i.price || 0),
      sizeId: i.sizeId || null, comment: i.comment ? String(i.comment).slice(0, 200) : null,
      mods: (i.mods || []).map((m: any) => ({ id: m.id, groupId: m.groupId || null, name: String(m.name || '').slice(0, 120), amount: Number(m.amount || 1), price: Number(m.price || 0) })),
    }));
    if (!b.tableId) throw new HttpError(400, 'Не выбран стол');
    const total = items.reduce((s: number, i: any) => s + (i.price + i.mods.reduce((a: number, m: any) => a + m.price * m.amount, 0)) * i.amount, 0);
    const { data: me } = await db.from('waiter_staff').select('iiko_employee_id').eq('id', staff.id).maybeSingle();
    const row = {
      client_id: clientId, staff_id: staff.id, kind: 'create', table_id: b.tableId, venue: await venue(),
      table_label: b.tableLabel ? String(b.tableLabel).slice(0, 60) : null, guests: Number(b.guests) > 0 ? Math.min(Number(b.guests), 50) : null,
      waiter_iiko_id: me?.iiko_employee_id || null, status: 'queued', error: null, taken_at: null, payload: items, total, updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = prev
      ? await db.from('waiter_orders').update(row).eq('id', prev.id).select('id').single()
      : await db.from('waiter_orders').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return { correlationId: saved.id, orderId: null, logId: saved.id };
  }
  const c = await ctx();
  const items = orderItems(b.items);
  const total = items.reduce((s, i) => s + i.price * i.amount + (i.modifiers || []).reduce((a: number, m: any) => a + m.price * m.amount * i.amount, 0), 0);
  let correlationId = '', orderId = b.orderId || null;
  if (orderId) {
    const r = await iiko('1/order/add_items', { organizationId: c.org, orderId, items });
    correlationId = r.correlationId;
  } else {
    if (!b.tableId) throw new HttpError(400, 'Не выбран стол');
    const order: any = { tableIds: [b.tableId], items };
    if (Number(b.guests) > 0) order.guests = { count: Math.min(Number(b.guests), 50) };
    const r = await iiko('1/order/create', {
      organizationId: c.org, terminalGroupId: c.tg, order,
      createOrderSettings: { servicePrint: true, checkStopList: true, transportToFrontTimeout: 60 },
    });
    correlationId = r.correlationId; orderId = r.orderInfo?.id || null;
  }
  const row = {
    client_id: clientId, staff_id: staff.id, kind: b.orderId ? 'add' : 'create', table_id: b.tableId || null,
    table_label: b.tableLabel ? String(b.tableLabel).slice(0, 60) : null, iiko_order_id: orderId, correlation_id: correlationId,
    status: 'sent', error: null, payload: b.items, total, updated_at: new Date().toISOString(),
  };
  const { data: saved } = prev
    ? await db.from('waiter_orders').update(row).eq('id', prev.id).select('id').single()
    : await db.from('waiter_orders').insert(row).select('id').single();
  return { correlationId, orderId, logId: saved?.id };
}

async function status(b: any) {
  if (await mode() === 'plugin') {
    const { data } = await db.from('waiter_orders').select('status, error, iiko_number, created_at').eq('id', b.correlationId).maybeSingle();
    if (!data) return { state: 'Error', error: 'Заказ не найден' };
    if (data.status === 'ok') return { state: 'Success', error: null, note: data.error || null, number: data.iiko_number };
    if (data.status === 'error') return { state: 'Error', error: data.error || 'Касса не приняла заказ' };
    return { state: 'InProgress', error: null, waiting: data.status === 'queued' ? 'queued' : 'taken' };
  }
  const c = await ctx();
  const s = await iiko('1/commands/status', { organizationId: c.org, correlationId: b.correlationId });
  const err = s.state === 'Error' ? (s.exception?.message || s.errorReason || 'Касса не приняла заказ') : null;
  if (s.state !== 'InProgress') {
    await db.from('waiter_orders').update({ status: s.state === 'Success' ? 'ok' : 'error', error: err, updated_at: new Date().toISOString() }).eq('correlation_id', b.correlationId);
  }
  return { state: s.state, error: err };
}

async function tableOrders(b: any) {
  if (!b.tableId) throw new HttpError(400, 'Не выбран стол');
  if (await mode() === 'plugin') {
    const { data } = await db.from('waiter_cache').select('data, updated_at').eq('key', 'pos_tables:' + await venue()).maybeSingle();
    const age = data ? Math.round((Date.now() - new Date(data.updated_at).getTime()) / 1000) : null;
    const orders = ((data?.data as any)?.[b.tableId] || []) as any[];
    return { orders, age };
  }
  const c = await ctx();
  // попросить кассу выгрузить заказы стола в облако, затем прочитать
  try {
    const init = await iiko('1/order/init_by_table', { organizationId: c.org, terminalGroupId: c.tg, tableIds: [b.tableId] });
    if (init.correlationId) await waitCommand(c.org, init.correlationId, 6000);
  } catch (_) { /* касса может быть офлайн — читаем то, что есть */ }
  const r = await iiko('1/order/by_table', { organizationIds: [c.org], tableIds: [b.tableId], statuses: ['New', 'Bill'] });
  const orders = (r.orders || []).filter((o: any) => o.creationStatus === 'Success' && o.order).map((o: any) => ({
    id: o.id, number: o.order.number, status: o.order.status, sum: o.order.sum,
    waiter: o.order.waiter?.name || null, created: o.order.whenCreated, guests: o.order.guestsInfo?.count || null,
    items: (o.order.items || []).filter((i: any) => !i.deleted).map((i: any) => ({
      name: i.product?.name || i.primaryComponent?.product?.name || 'Позиция', amount: i.amount, sum: i.resultSum ?? (i.price || 0) * (i.amount || 0),
      status: i.status, comment: i.comment || null,
      mods: (i.modifiers || []).map((m: any) => m.product?.name).filter(Boolean),
    })),
  }));
  return { orders };
}

/* ---------------- плагин кассы ---------------- */
async function pos(req: Request, a: string, b: any) {
  const key = req.headers.get('x-pos-key') || '';
  const want = await secret('pos_api_key');
  if (!key || !want || key !== want) throw new HttpError(403, 'Неверный ключ кассы');
  const v = String(b.venue || await venue());
  const now = new Date().toISOString();
  if (a === 'pos_result') {
    const upd: any = { status: b.ok ? 'ok' : 'error', error: b.ok ? (b.error ? String(b.error).slice(0, 500) : null) : String(b.error || 'Ошибка на кассе').slice(0, 500), updated_at: now };
    if (b.iikoOrderId) upd.iiko_order_id = b.iikoOrderId;
    if (b.number) upd.iiko_number = Number(b.number) || null;
    if (b.kind === 'add' || b.kind === 'create') upd.kind = b.kind;
    await db.from('waiter_orders').update(upd).eq('id', b.id).eq('venue', v);
    return { ok: true };
  }
  // пульс кассы и снимок открытых заказов по столам
  await db.from('waiter_cache').upsert({ key: 'pos_seen:' + v, data: { at: now, version: b.version || null }, updated_at: now });
  if (b.tables && typeof b.tables === 'object') await db.from('waiter_cache').upsert({ key: 'pos_tables:' + v, data: b.tables, updated_at: now });
  // забрать новые заказы (и зависшие «взятые» больше 3 минут назад — касса могла перезапуститься)
  const stale = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data } = await db.from('waiter_orders')
    .select('id, table_id, table_label, guests, waiter_iiko_id, payload, created_at, status, taken_at, waiter_staff(name)')
    .eq('venue', v).or(`status.eq.queued,and(status.eq.taken,taken_at.lt.${stale})`)
    .gte('created_at', new Date(Date.now() - 6 * 3600 * 1000).toISOString())
    .order('created_at').limit(20);
  const list = data || [];
  if (list.length) await db.from('waiter_orders').update({ status: 'taken', taken_at: now, updated_at: now }).in('id', list.map((x: any) => x.id));
  return {
    orders: list.map((x: any) => ({
      id: x.id, tableId: x.table_id, table: x.table_label, guests: x.guests, waiterId: x.waiter_iiko_id,
      waiter: x.waiter_staff?.name || '', items: x.payload || [], created: x.created_at,
    })),
  };
}

/* ---------------- официанты (управляющий) ---------------- */
function manager(s: Staff) { if (s.role !== 'manager') throw new HttpError(403, 'Только для управляющего'); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const a = b.action;
    if (a === 'login') return json(await login(req, String(b.pin || '')));
    if (a === 'pos_poll' || a === 'pos_result') return json(await pos(req, a, b));
    const staff = await session(req);
    switch (a) {
      case 'me': return json({ staff });
      case 'bootstrap': {
        const c = await ctx();
        const [tables, menu, stop, isAlive] = await Promise.all([
          cached('tables', 600, () => loadTables(c), !!b.force),
          cached('menu', 600, () => loadMenu(c), !!b.force),
          cached('stop', 60, () => loadStop(c), !!b.force).catch(() => ({})),
          alive(c),
        ]);
        return json({ staff, tables, menu, stop, alive: isAlive });
      }
      case 'stop': {
        const c = await ctx();
        const [stop, isAlive] = await Promise.all([cached('stop', 30, () => loadStop(c)).catch(() => ({})), alive(c)]);
        return json({ stop, alive: isAlive });
      }
      case 'table_orders': return json(await tableOrders(b));
      case 'send': return json(await send(staff, b));
      case 'status': return json(await status(b));
      case 'history': {
        const since = new Date(Date.now() - 16 * 3600 * 1000).toISOString();
        let q = db.from('waiter_orders').select('id, kind, table_label, status, error, total, created_at, waiter_staff(name)').gte('created_at', since).order('created_at', { ascending: false }).limit(100);
        if (staff.role !== 'manager') q = q.eq('staff_id', staff.id);
        const { data } = await q;
        return json({ orders: data || [] });
      }
      case 'staff_list': {
        manager(staff);
        let iikoError = null;
        try { await syncStaff(!!b.force); } catch (e) { iikoError = (e as Error).message; }
        const { data } = await db.from('waiter_staff').select('id, name, role, active, created_at, iiko_employee_id, iiko_name').order('active', { ascending: false }).order('name');
        return json({ staff: data || [], iikoError });
      }
      case 'staff_iiko': {
        manager(staff);
        const emps = await syncStaff(!!b.force);
        const { data } = await db.from('waiter_staff').select('id, iiko_employee_id, active').not('iiko_employee_id', 'is', null);
        const linked = new Map((data || []).filter((x: any) => x.active).map((x: any) => [x.iiko_employee_id, x.id]));
        return json({ employees: emps.filter((x: any) => !x.fired).map((x: any) => ({ ...x, staffId: linked.get(x.id) || null })).sort((a: any, b2: any) => a.name.localeCompare(b2.name, 'ru')) });
      }
      case 'staff_save': {
        manager(staff);
        const role = b.role === 'manager' ? 'manager' : 'waiter';
        const { data, error } = await db.rpc('waiter_upsert', { p_name: String(b.name || '').slice(0, 60), p_pin: String(b.pin || ''), p_role: role, p_id: b.id || null });
        if (error) throw new HttpError(400, error.message);
        if (b.iikoEmployeeId !== undefined) {
          // отключённый раньше сотрудник с той же привязкой освобождает её
          if (b.iikoEmployeeId) await db.from('waiter_staff').update({ iiko_employee_id: null }).eq('iiko_employee_id', b.iikoEmployeeId).eq('active', false).neq('id', data);
          const { error: e2 } = await db.from('waiter_staff').update({ iiko_employee_id: b.iikoEmployeeId || null, iiko_name: b.iikoEmployeeId ? String(b.iikoName || b.name || '').slice(0, 100) : null }).eq('id', data);
          if (e2) throw new HttpError(400, /unique|duplicate/i.test(e2.message) ? 'Этот сотрудник iiko уже привязан к другому ПИН' : e2.message);
        }
        return json({ id: data });
      }
      case 'staff_disable': {
        manager(staff);
        if (b.id === staff.id) throw new HttpError(400, 'Нельзя отключить себя');
        await db.from('waiter_staff').update({ active: false }).eq('id', b.id);
        await db.from('waiter_sessions').delete().eq('staff_id', b.id);
        return json({ ok: true });
      }
      default: return json({ error: 'Неизвестное действие' }, 400);
    }
  } catch (e) {
    const st = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message || String(e) }, st);
  }
});
