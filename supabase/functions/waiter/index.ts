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
//   occupied                            → {occ: {tableId: {mins, sum, bill, n, waiter}} | null, alive}
//   table_orders {tableId}              → {orders}
//   send {clientId, tableId, tableLabel, orderId?, guests?, items[]} → {correlationId, orderId, logId}
//   status {correlationId}              → {state, error?}
//   history                             → {orders}
//   staff_list / staff_iiko / staff_save {id?, name, pin, role, iikoEmployeeId?} / staff_disable {id} — только управляющий
//   (staff_iiko — сотрудники из iiko; уволенный в iiko сотрудник отключается в приложении сам)
//   staff_update {id, role, perms} — роль и права без смены ПИН (только управляющий)
//
// Склад (024-stock.sql) — остатки с сервера iiko (iiko_server_url / _login / _password):
//   stock {force?}                → {items, stores, at, perms, sections} — права stock_view / stock_order / stock_setup,
//                                    разделы stock_bar / stock_kitchen (шеф — только кухня; управляющий — всё)
//   stock_catalog {q}             → {products}                    — товары iiko для добавления (stock_setup)
//   stock_all {force?}            → {items, supplyError, at}      — все закупаемые товары с остатками и поставщиком
//   stock_item_save {productId, …} / stock_item_delete {productId}   (stock_setup)
//   stock_order {items, supplier?, note?} → {id, telegram}        (stock_order)
//   stock_orders                  → {orders}                      (stock_view)
//   stock_order_status {id, status}                               (stock_order)
//
// Как заказ попадает на кассу (app_secrets.waiter_mode):
//   plugin (по умолчанию) — заказ встаёт в очередь waiter_orders, плагин «Карта Патрики» на главной
//     кассе забирает его, создаёт на столе в iikoFront от имени официанта и печатает на кухню.
//     Облако iiko (iikoTransport) для этого не нужно. Плагин ходит сюда с ключом кассы (x-pos-key):
//       pos_poll {venue, tables?, menu?}  → {orders}   — пульс кассы + снимок открытых заказов столов
//         + меню кассы (плагин 1.8+): все блюда, как их видит кассир в iikoFront, — приложение показывает именно его
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
// Кэш «отдай сразу, обнови в фоне»: официант не ждёт iiko (меню из облака грузится до 10–20 с).
// Свежие данные — сразу; устаревшие — тоже сразу, а обновление идёт в фоне. Ждём iiko, только если
// в кэше ничего нет или явно попросили (кнопка ↻).
const refreshing = new Set<string>();
async function cached<T>(key: string, maxAgeSec: number, load: () => Promise<T>, force = false): Promise<T> {
  const save = async () => {
    const v = await load();
    await db.from('waiter_cache').upsert({ key, data: v as unknown as object, updated_at: new Date().toISOString() });
    return v;
  };
  if (force) return save();
  const { data } = await db.from('waiter_cache').select('data, updated_at').eq('key', key).maybeSingle();
  if (!data) return save();
  if (Date.now() - new Date(data.updated_at).getTime() >= maxAgeSec * 1000 && !refreshing.has(key)) {
    refreshing.add(key);
    const job = save().catch((e) => console.error('cache ' + key, e)).finally(() => refreshing.delete(key));
    try { (globalThis as any).EdgeRuntime?.waitUntil?.(job); } catch { /* */ }
  }
  return data.data as T;
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

// столы с кассы (плагин присылает схему залов) — их id совпадают с кассой, в отличие от облака
async function posLayout() {
  if ((await mode()) !== 'plugin') return null;
  const { data } = await db.from('waiter_cache').select('data').eq('key', 'pos_layout:' + await venue()).maybeSingle();
  const l = data?.data as any[] | undefined;
  if (!Array.isArray(l) || !l.length) return null;
  return l.map((s: any) => ({ id: s.id, name: s.name, tables: (s.tables || []).map((t: any) => ({ id: t.id, number: t.number, name: t.name || String(t.number) })) }))
    .filter((s: any) => s.tables.length);
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

// меню с кассы (плагин 1.8+) — один в один как на кассе, включая «свободные» блюда; облачное меню — запасной вариант
async function posMenu() {
  if ((await mode()) !== 'plugin') return null;
  const { data } = await db.from('waiter_cache').select('data, updated_at').eq('key', 'pos_menu:' + await venue()).maybeSingle();
  const m = data?.data as any;
  if (!m || !Array.isArray(m.groups) || !m.groups.length) return null;
  if (Date.now() - new Date(data!.updated_at).getTime() > 3 * 24 * 3600 * 1000) return null; // касса давно не присылала
  return m;
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
type Staff = { id: string; name: string; role: string; perms: string[] };
async function session(req: Request): Promise<Staff> {
  const t = req.headers.get('x-waiter-token') || '';
  if (!t) throw new HttpError(401, 'Нужен вход по ПИН');
  const { data } = await db.from('waiter_sessions').select('expires_at, waiter_staff(id, name, role, active, perms)').eq('token', t).maybeSingle();
  const s: any = data?.waiter_staff;
  if (!data || !s?.active || new Date(data.expires_at).getTime() < Date.now()) throw new HttpError(401, 'Сессия закончилась, войдите снова');
  return { id: s.id, name: s.name, role: s.role, perms: s.perms || [] };
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
  const { data: me } = await db.from('waiter_staff').select('perms').eq('id', s.id).maybeSingle();
  return { token: tok, name: s.name, role: s.role, perms: effPerms({ ...s, perms: me?.perms || [] }) };
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
  if (prev && prev.status !== 'error') return { correlationId: prev.correlation_id || prev.id, orderId: prev.iiko_order_id, logId: prev.id, repeated: true };
  if (await mode() === 'plugin') {
    orderItems(b.items); // проверка
    const items = b.items.map((i: any) => ({
      productId: i.productId, name: String(i.name || '').slice(0, 120), amount: Number(i.amount), price: Number(i.price || 0),
      open: i.open ? true : undefined, // свободная цена — касса ставит цену, введённую официантом
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

/* ---------- занятые столы (по снимку открытых заказов с кассы) ---------- */
// время открытия заказа касса присылает по своим часам (Москва) без пояса
async function occupied() {
  if (await mode() !== 'plugin') return { tables: null, age: null };
  const { data } = await db.from('waiter_cache').select('data, updated_at').eq('key', 'pos_tables:' + await venue()).maybeSingle();
  if (!data) return { tables: null, age: null };
  const age = Math.round((Date.now() - new Date(data.updated_at).getTime()) / 1000);
  if (age > 300) return { tables: null, age }; // касса давно молчит — не знаем
  const out: Record<string, unknown> = {};
  for (const [tid, list] of Object.entries((data.data || {}) as Record<string, any[]>)) {
    if (tid.startsWith('_') || !Array.isArray(list) || !list.length) continue;
    let since = Infinity, sum = 0, bill = false, waiter = '';
    for (const o of list) {
      const t = Date.parse(String(o.created || '') + '+03:00');
      if (t < since) { since = t; waiter = o.waiter || ''; }
      sum += Number(o.sum || 0);
      if (o.status === 'Bill') bill = true;
    }
    out[tid] = { mins: Number.isFinite(since) ? Math.max(0, Math.round((Date.now() - since) / 60000)) : null, sum: Math.round(sum), bill, n: list.length, waiter };
  }
  return { tables: out, age };
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
  if (b.tables && typeof b.tables === 'object') {
    // плагин 1.4+: схема залов кассы (id столов кассы) — приложение берёт столы отсюда
    const layout = b.tables._layout;
    delete b.tables._layout;
    if (Array.isArray(layout) && layout.length) await db.from('waiter_cache').upsert({ key: 'pos_layout:' + v, data: layout, updated_at: now });
    await db.from('waiter_cache').upsert({ key: 'pos_tables:' + v, data: b.tables, updated_at: now });
  }
  if (b.menu && typeof b.menu === 'object' && Array.isArray(b.menu.groups) && b.menu.groups.length) {
    await db.from('waiter_cache').upsert({ key: 'pos_menu:' + v, data: b.menu, updated_at: now });
  }
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

/* ---------------- склад: остатки с сервера iiko ---------------- */
// Права: управляющий — всё; остальным управляющий выдаёт в карточке сотрудника.
// stock_order и stock_setup включают stock_view. Разделы: stock_bar / stock_kitchen — шеф видит
// только кухню, бар-менеджер только бар; без раздела склад не виден вовсе.
const SECTIONS: Record<string, string> = { stock_bar: 'Бар', stock_kitchen: 'Кухня' };
const PERMS = ['stock_view', 'stock_order', 'stock_setup', ...Object.keys(SECTIONS)];
function effPerms(s: { role: string; perms?: string[] }) {
  if (s.role === 'manager') return [...PERMS];
  const p = new Set((s.perms || []).filter((x) => PERMS.includes(x)));
  if (p.has('stock_order') || p.has('stock_setup')) p.add('stock_view');
  if (!Object.keys(SECTIONS).some((k) => p.has(k))) return []; // нет раздела — нет и склада
  return [...p];
}
// разделы, которые видит сотрудник; null — все (управляющий)
function mySections(s: Staff): string[] | null {
  if (s.role === 'manager') return null;
  return Object.entries(SECTIONS).filter(([k]) => effPerms(s).includes(k)).map(([, v]) => v);
}
const inMine = (s: Staff, section: string | null) => { const m = mySections(s); return m === null || (!!section && m.includes(section)); };
function need(s: Staff, perm: string) {
  if (!effPerms(s).includes(perm)) throw new HttpError(403, 'Нет доступа к складу. Права выдаёт управляющий');
}

// iikoServer API: каждый вход занимает лицензию — поэтому вход → запросы → выход сразу.
async function iikoServer<T>(work: (get: (path: string, q?: Record<string, string>) => Promise<string>) => Promise<T>): Promise<T> {
  const [url, login, pass] = await Promise.all([secret('iiko_server_url'), secret('iiko_server_login'), secret('iiko_server_password')]);
  if (!url || !login || !pass) throw new Error('Не заданы доступы к серверу iiko (app_secrets.iiko_server_url / _login / _password)');
  const base = url.replace(/\/+$/, '').replace(/\/api$/, '') + '/api/';
  const sha1 = /^[0-9a-f]{40}$/i.test(pass) ? pass.toLowerCase()
    : [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pass)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const call = async (path: string, q: Record<string, string> = {}) => {
    const r = await fetch(base + path + '?' + new URLSearchParams(q), { signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    if (r.status === 403) {
      const right = (t.match(/Permission denied:\s*([A-Z_0-9]+)/) || [])[1];
      throw Object.assign(new Error(`У пользователя iiko «${login}» нет права${right ? ' ' + right : ''} (запрос ${path}). Выдайте его в iikoOffice: Сотрудники → ${login} → права`), { denied: true });
    }
    if (!r.ok) throw new Error(`Сервер iiko ${path}: ${r.status} ${t.slice(0, 200)}`);
    return t;
  };
  const key = (await call('auth', { login, pass: sha1 })).trim();
  if (!key || key.length > 100) throw new Error('Сервер iiko не пустил: проверьте логин и пароль');
  try {
    return await work((path, q = {}) => call(path, { ...q, key }));
  } finally {
    await call('logout', { key }).catch(() => { /* лицензия освободится сама через несколько минут */ });
  }
}

// справочник: товары, единицы, склады (меняется редко — кэш 6 часов).
// Сначала с сервера iiko; если у пользователя нет права на номенклатуру — из облака iiko
// (ключ официантов): id товаров там те же самые.
type Catalog = { products: Record<string, { name: string; unit: string; type: string; group: string }>; stores: { id: string; name: string }[]; source?: string };
async function loadCatalogServer(): Promise<Catalog> {
  return iikoServer(async (get) => {
    const [pr, un, gr, st] = await Promise.all([
      get('v2/entities/products/list', { includeDeleted: 'false' }),
      get('v2/entities/list', { rootType: 'MeasureUnit', includeDeleted: 'false' }).catch(() => '[]'),
      get('v2/entities/products/group/list', { includeDeleted: 'false' }).catch(() => '[]'),
      get('corporation/stores').catch(() => ''),
    ]);
    const units = new Map<string, string>((JSON.parse(un) as any[]).map((u) => [u.id, u.name]));
    const groups = new Map<string, string>((JSON.parse(gr) as any[]).map((g) => [g.id, g.name]));
    const products: Catalog['products'] = {};
    for (const p of JSON.parse(pr) as any[]) {
      if (p.deleted) continue;
      products[p.id] = { name: String(p.name || '').trim(), unit: units.get(p.mainUnit) || '', type: String(p.type || ''), group: groups.get(p.parent) || '' };
    }
    return { products, stores: parseStores(st), source: 'server' };
  });
}
// склады отдаются в XML: <corporateItemDto><id>…</id><name>…</name><type>STORE</type>
function parseStores(st: string) {
  return [...st.matchAll(/<corporateItemDto>([\s\S]*?)<\/corporateItemDto>/g)]
    .map((m) => ({ id: (m[1].match(/<id>([^<]+)<\/id>/) || [])[1], name: (m[1].match(/<name>([^<]*)<\/name>/) || [])[1], type: (m[1].match(/<type>([^<]+)<\/type>/) || [])[1] }))
    .filter((x) => x.id && (!x.type || x.type === 'STORE'))
    .map((x) => ({ id: x.id!, name: (x.name || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&') }));
}
async function loadCatalogCloud(): Promise<Catalog> {
  const c = await ctx();
  const n = await iiko('1/nomenclature', { organizationId: c.org }, 60);
  const groups = new Map<string, string>((n.groups || []).map((g: any) => [g.id, g.name]));
  const products: Catalog['products'] = {};
  for (const p of n.products || []) {
    if (p.isDeleted) continue;
    const t = String(p.type || '').toUpperCase();
    products[p.id] = { name: String(p.name || '').trim(), unit: String(p.measureUnit || ''), type: t === 'GOOD' ? 'GOODS' : t, group: groups.get(p.parentGroup) || '' };
  }
  // склады — с сервера, если пустит; нет — считаем «все склады вместе»
  const stores = await iikoServer((get) => get('corporation/stores')).then(parseStores).catch(() => []);
  return { products, stores, source: 'cloud' };
}
async function loadCatalog(): Promise<Catalog> {
  try { return await loadCatalogServer(); }
  catch (e) { if (!(e as any).denied) throw e; return await loadCatalogCloud(); }
}

// остатки на сейчас: {productId: {storeId: amount}}
async function loadBalance(): Promise<Record<string, Record<string, number>>> {
  const now = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 19); // время сервера — Москва
  const t = await iikoServer((get) => get('v2/reports/balance/stores', { timestamp: now }));
  const out: Record<string, Record<string, number>> = {};
  for (const r of JSON.parse(t) as any[]) {
    if (!r.product) continue;
    (out[r.product] ||= {})[r.store || '_'] = (out[r.product][r.store || '_'] || 0) + Number(r.amount || 0);
  }
  return out;
}

// поставщики: кто последним привозил товар (приходные накладные за 90 дней) — кэш 6 часов
const xmlText = (x: string) => x.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'");
async function loadSupply(): Promise<Record<string, { supplier: string; at: string }>> {
  return iikoServer(async (get) => {
    const to = new Date(Date.now() + 3 * 3600 * 1000), from = new Date(to.getTime() - 90 * 24 * 3600 * 1000);
    const d = (x: Date) => x.toISOString().slice(0, 10);
    const [sup, inv] = await Promise.all([get('suppliers').catch(() => ''), get('documents/export/incomingInvoice', { from: d(from), to: d(to) })]);
    const names = new Map<string, string>();
    for (const m of sup.matchAll(/<employee>([\s\S]*?)<\/employee>/g)) {
      const id = (m[1].match(/<id>([^<]+)<\/id>/) || [])[1], nm = (m[1].match(/<name>([^<]*)<\/name>/) || [])[1];
      if (id) names.set(id, xmlText(nm || ''));
    }
    const out: Record<string, { supplier: string; at: string }> = {};
    for (const m of inv.matchAll(/<(document|incomingInvoiceDto)>([\s\S]*?)<\/\1>/g)) {
      const doc = m[2];
      if ((doc.match(/<status>([^<]+)<\/status>/) || [])[1] === 'DELETED') continue;
      const sid = (doc.match(/<supplier>([^<]+)<\/supplier>/) || [])[1] || '';
      const at = (doc.match(/<dateIncoming>([^<]+)<\/dateIncoming>/) || [])[1] || '';
      for (const p of doc.matchAll(/<product(?:Id)?>([0-9a-f-]{36})<\/product(?:Id)?>/gi)) {
        const prev = out[p[1]];
        if (!prev || at > prev.at) out[p[1]] = { supplier: names.get(sid) || '', at };
      }
    }
    return out;
  });
}
// раздел склада по названию: «Склад бар» → Бар, «Склад кухня» → Кухня
const storeSection = (name: string) => (/бар/i.test(name) ? 'Бар' : /кух/i.test(name) ? 'Кухня' : null);

// все закупаемые товары с остатками (вкладка «Склад iiko»)
async function stockAll(staff: Staff, force: boolean) {
  const [cat, bal, supply, { data: items }] = await Promise.all([
    cached('stock_catalog', 6 * 3600, loadCatalog),
    cached('stock_balance', 60, loadBalance, force),
    cached('stock_supply', 6 * 3600, loadSupply, force).catch((e) => ({ _error: (e as Error).message } as any)),
    db.from('stock_items').select('product_id, section').eq('active', true),
  ]);
  const supplyError = (supply as any)._error || null;
  const watched = new Map((items || []).map((x: any) => [x.product_id, x.section]));
  const stores = new Map(cat.stores.map((x) => [x.id, x.name]));
  const ms = mySections(staff);
  const ids = new Set([...Object.keys(bal), ...(supplyError ? [] : Object.keys(supply)), ...watched.keys()]);
  const list: any[] = [];
  for (const id of ids) {
    const p = cat.products[id];
    if (!p || !['GOODS', 'PREPARED'].includes(p.type)) continue;
    const by = Object.entries(bal[id] || {}).map(([sid, q]) => ({ id: sid, name: stores.get(sid) || 'склад', qty: round(q), section: storeSection(stores.get(sid) || '') }))
      .filter((x) => Math.abs(x.qty) > 1e-9 && (ms === null || (x.section && ms.includes(x.section))));
    if (ms !== null && !by.length && !(watched.get(id) && ms.includes(watched.get(id)))) continue;
    const main = by.slice().sort((a, b2) => b2.qty - a.qty)[0];
    list.push({
      id, name: p.name, unit: p.unit, group: p.group || 'Без группы', type: p.type,
      qty: round(by.reduce((a, x) => a + x.qty, 0)), byStore: by.map(({ name, qty }) => ({ name, qty })),
      storeId: main?.id || null, section: watched.get(id) || main?.section || null,
      supplier: (supply as any)[id]?.supplier || '', lastAt: (supply as any)[id]?.at || null, watched: watched.has(id),
    });
  }
  list.sort((a, b2) => a.group.localeCompare(b2.group, 'ru') || a.name.localeCompare(b2.name, 'ru'));
  const { data: at } = await db.from('waiter_cache').select('updated_at').eq('key', 'stock_balance').maybeSingle();
  return { items: list, supplyError, at: at?.updated_at || null };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
async function stockView(staff: Staff, force: boolean) {
  const [cat, bal, { data: items }] = await Promise.all([
    cached('stock_catalog', 6 * 3600, loadCatalog, force),
    cached('stock_balance', 60, loadBalance, force),
    db.from('stock_items').select('*').eq('active', true).order('name'),
  ]);
  const mine = (items || []).filter((it: any) => inMine(staff, it.section));
  const { data: at } = await db.from('waiter_cache').select('updated_at').eq('key', 'stock_balance').maybeSingle();
  const storeName = new Map(cat.stores.map((s) => [s.id, s.name]));
  const list = mine.map((it: any) => {
    const by = bal[it.product_id] || {};
    const qty = round(it.store_id ? (by[it.store_id] || 0) : Object.values(by).reduce((a, b) => a + b, 0));
    const min = Number(it.min_qty || 0), max = it.max_qty != null ? Number(it.max_qty) : null, pack = it.pack ? Number(it.pack) : null;
    // сколько заказать: до «заказывать до», иначе до двух минимумов; округляем вверх до упаковки
    let suggest = 0;
    if (qty <= min) {
      const target = max != null && max > min ? max : Math.max(min * 2, min + (pack || 0));
      suggest = Math.max(target - qty, pack || 0);
      if (pack) suggest = Math.ceil(suggest / pack - 1e-9) * pack;
      suggest = round(suggest);
    }
    return {
      productId: it.product_id, name: cat.products[it.product_id]?.name || it.name, unit: it.unit || cat.products[it.product_id]?.unit || '',
      qty, min, max, portion: it.portion ? Number(it.portion) : null, portionName: it.portion_name, pack, packName: it.pack_name,
      supplier: it.supplier, section: it.section, storeId: it.store_id, store: it.store_id ? storeName.get(it.store_id) || 'склад' : null,
      byStore: Object.entries(by).filter(([, v]) => Math.abs(v) > 1e-9).map(([id, v]) => ({ name: storeName.get(id) || 'склад', qty: round(v) })),
      low: qty <= min, suggest, missing: !cat.products[it.product_id],
    };
  });
  return { items: list, stores: cat.stores, at: at?.updated_at || null, perms: effPerms(staff), sections: mySections(staff) || Object.values(SECTIONS) };
}

async function stockCatalog(b: any) {
  const cat = await cached('stock_catalog', 6 * 3600, loadCatalog, !!b.force);
  const q = String(b.q || '').trim().toLowerCase();
  const { data: watched } = await db.from('stock_items').select('product_id').eq('active', true);
  const w = new Set((watched || []).map((x: any) => x.product_id));
  const products = Object.entries(cat.products)
    // блюда и модификаторы не лежат на складе — показываем товары и заготовки
    .filter(([, p]) => !['DISH', 'MODIFIER', 'SERVICE'].includes(p.type))
    .filter(([, p]) => !q || p.name.toLowerCase().includes(q) || p.group.toLowerCase().includes(q))
    .map(([id, p]) => ({ id, name: p.name, unit: p.unit, group: p.group, watched: w.has(id) }))
    .sort((a, b2) => a.name.localeCompare(b2.name, 'ru'))
    .slice(0, 80);
  return { products, stores: cat.stores };
}

const num = (v: any) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
async function stockItemSave(staff: Staff, b: any) {
  if (!b.productId) throw new HttpError(400, 'Не выбран товар');
  const min = num(b.min);
  if (min == null || min < 0) throw new HttpError(400, 'Укажите минимальный остаток');
  if (!Object.values(SECTIONS).includes(b.section)) throw new HttpError(400, 'Выберите раздел: бар или кухня');
  if (!inMine(staff, b.section)) throw new HttpError(403, 'Нет доступа к разделу «' + b.section + '»');
  const { data: was } = await db.from('stock_items').select('section, active').eq('product_id', b.productId).maybeSingle();
  if (was?.active && !inMine(staff, was.section)) throw new HttpError(403, 'Эта позиция в разделе «' + (was.section || 'без раздела') + '»');
  const row = {
    product_id: b.productId, name: String(b.name || '').slice(0, 120) || 'Товар', unit: b.unit ? String(b.unit).slice(0, 20) : null,
    store_id: b.storeId || null, min_qty: min, max_qty: num(b.max),
    portion: num(b.portion) || null, portion_name: b.portionName ? String(b.portionName).slice(0, 30) : null,
    pack: num(b.pack) || null, pack_name: b.packName ? String(b.packName).slice(0, 30) : null,
    supplier: b.supplier ? String(b.supplier).slice(0, 80) : null, section: b.section,
    active: true, updated_by: staff.id, updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('stock_items').upsert(row);
  if (error) throw new HttpError(400, error.message);
  return { ok: true };
}

const fmt = (n: number) => String(round(n)).replace('.', ',');
async function stockOrder(staff: Staff, b: any) {
  const raw = (Array.isArray(b.items) ? b.items : []).map((i: any) => ({
    productId: i.productId, name: String(i.name || '').slice(0, 120), qty: Number(i.qty), unit: String(i.unit || '').slice(0, 20),
    packs: i.packs != null ? Number(i.packs) : null, packName: i.packName ? String(i.packName).slice(0, 30) : null,
  })).filter((i: any) => i.productId && i.qty > 0 && i.qty < 100000);
  if (!raw.length) throw new HttpError(400, 'В заказе нет позиций');
  // раздел позиции берём из базы, а не из запроса: шеф не закажет барные позиции
  const { data: rows } = await db.from('stock_items').select('product_id, section').in('product_id', raw.map((i: any) => i.productId));
  const sec = new Map((rows || []).map((r: any) => [r.product_id, r.section || 'Без раздела']));
  const bySec = new Map<string, any[]>();
  for (const i of raw) {
    const s2 = sec.get(i.productId) || 'Без раздела';
    if (!inMine(staff, s2 === 'Без раздела' ? null : s2)) throw new HttpError(403, `«${i.name}» — не ваш раздел`);
    if (!bySec.has(s2)) bySec.set(s2, []);
    bySec.get(s2)!.push(i);
  }
  const supplier = b.supplier ? String(b.supplier).slice(0, 80) : null;
  const note = b.note ? String(b.note).slice(0, 500) : null;
  const tok = await secret('telegram_bot_token');
  const ids: string[] = []; let telegram = false;
  for (const [section, items] of bySec) {
    const { data: saved, error } = await db.from('stock_orders').insert({ staff_id: staff.id, supplier, items, note, sections: [section] }).select('id').single();
    if (error) throw new Error(error.message);
    ids.push(saved.id);
    // чат: закупки раздела → закупки вообще → чат заведения
    try {
      const key = section === 'Бар' ? 'stock_bar' : section === 'Кухня' ? 'stock_kitchen' : 'stock';
      const chat = (await secret('telegram_chat_id:' + key)) || (await secret('telegram_chat_id:stock')) || (await secret('telegram_chat_id:' + await venue())) || (await secret('telegram_chat_id'));
      if (tok && chat) {
        const esc = (x: string) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
        const lines = items.map((i: any) => `• ${esc(i.name)} — ${i.packs ? `${fmt(i.packs)} ${esc(i.packName || 'уп.')} (${fmt(i.qty)} ${esc(i.unit)})` : `${fmt(i.qty)} ${esc(i.unit)}`}`);
        const text = `🧾 <b>Заказ на закупку · ${esc(section)}</b>${supplier ? ' · ' + esc(supplier) : ''}\n${lines.join('\n')}${note ? '\n\n' + esc(note) : ''}\n\nОформил: ${esc(staff.name)}`;
        const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML' }) });
        if (r.ok) { telegram = true; await db.from('stock_orders').update({ telegram: true }).eq('id', saved.id); }
      }
    } catch (e) { console.error('stock telegram', e); }
  }
  return { id: ids[0], ids, telegram };
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
      case 'me': return json({ staff: { ...staff, perms: effPerms(staff) } });
      case 'bootstrap': {
        const c = await ctx();
        const [tables, menu, stop, isAlive, occ] = await Promise.all([
          posLayout().then((l) => l || cached('tables', 600, () => loadTables(c), !!b.force)),
          posMenu().then((m) => m || cached('menu', 600, () => loadMenu(c), !!b.force)),
          cached('stop', 60, () => loadStop(c), !!b.force).catch(() => ({})),
          alive(c),
          occupied(),
        ]);
        return json({ staff: { ...staff, perms: effPerms(staff) }, tables, menu, stop, alive: isAlive, occ: occ.tables });
      }
      case 'stop': {
        const c = await ctx();
        const [stop, isAlive] = await Promise.all([cached('stop', 30, () => loadStop(c)).catch(() => ({})), alive(c)]);
        return json({ stop, alive: isAlive });
      }
      case 'occupied': {
        const [occ, isAlive] = await Promise.all([occupied(), alive({ org: '', tg: '' })]);
        return json({ occ: occ.tables, age: occ.age, alive: isAlive });
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
        const { data } = await db.from('waiter_staff').select('id, name, role, active, created_at, iiko_employee_id, iiko_name, perms').order('active', { ascending: false }).order('name');
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
        if (Array.isArray(b.perms)) await db.from('waiter_staff').update({ perms: b.perms.filter((x: string) => PERMS.includes(x)) }).eq('id', data);
        return json({ id: data });
      }
      case 'staff_update': {
        // роль и права без смены ПИН
        manager(staff);
        if (!b.id) throw new HttpError(400, 'Нет сотрудника');
        const upd: any = {};
        if (b.role === 'manager' || b.role === 'waiter') {
          if (b.id === staff.id && b.role !== 'manager') throw new HttpError(400, 'Нельзя снять с себя управляющего');
          upd.role = b.role;
        }
        if (Array.isArray(b.perms)) upd.perms = b.perms.filter((x: string) => PERMS.includes(x));
        if (b.name) upd.name = String(b.name).trim().slice(0, 60);
        const { error } = await db.from('waiter_staff').update(upd).eq('id', b.id);
        if (error) throw new HttpError(400, error.message);
        return json({ ok: true });
      }

      /* ---------- склад ---------- */
      case 'stock': need(staff, 'stock_view'); return json(await stockView(staff, !!b.force));
      case 'stock_catalog': need(staff, 'stock_setup'); return json(await stockCatalog(b));
      case 'stock_all': need(staff, 'stock_view'); return json(await stockAll(staff, !!b.force));
      case 'stock_item_save': need(staff, 'stock_setup'); return json(await stockItemSave(staff, b));
      case 'stock_item_delete': {
        need(staff, 'stock_setup');
        const { data: it } = await db.from('stock_items').select('section').eq('product_id', b.productId).maybeSingle();
        if (it && !inMine(staff, it.section)) throw new HttpError(403, 'Это позиция другого раздела');
        await db.from('stock_items').update({ active: false, updated_by: staff.id, updated_at: new Date().toISOString() }).eq('product_id', b.productId);
        return json({ ok: true });
      }
      case 'stock_order': need(staff, 'stock_order'); return json(await stockOrder(staff, b));
      case 'stock_orders': {
        need(staff, 'stock_view');
        let q = db.from('stock_orders').select('id, supplier, items, note, status, telegram, sections, created_at, waiter_staff(name)')
          .gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()).order('created_at', { ascending: false }).limit(50);
        const ms = mySections(staff);
        if (ms) q = q.overlaps('sections', ms);
        const { data } = await q;
        return json({ orders: data || [] });
      }
      case 'stock_order_status': {
        need(staff, 'stock_order');
        if (!['new', 'received', 'cancelled'].includes(b.status)) throw new HttpError(400, 'Неверный статус');
        const { data: o } = await db.from('stock_orders').select('sections').eq('id', b.id).maybeSingle();
        const ms = mySections(staff);
        if (!o || (ms && !(o.sections || []).some((x: string) => ms.includes(x)))) throw new HttpError(403, 'Это заказ другого раздела');
        await db.from('stock_orders').update({ status: b.status, updated_at: new Date().toISOString() }).eq('id', b.id);
        return json({ ok: true });
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
