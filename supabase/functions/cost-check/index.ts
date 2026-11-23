// Патрики Офис — «Себестоимость»: ночная проверка техкарт и цен поставщиков по данным iiko.
// Только чтение iiko. Схема и расписание — supabase/028-cost.sql. Деплой: verify_jwt = false (своя проверка доступа).
//
// body:
//   { action: 'check',  venue?: 'petrogradka', trigger?: 'cron'|'manual' } → {stats}   — проверить и обновить cost_issues
//   { action: 'digest', venue? }                                            → {sent}    — сводка управляющему в Telegram
//   { action: 'card_parse', text?, image? (base64 jpeg), media? }            → {card, catalog} — техкарта «с листочка» (ИИ, ключ app_secrets.anthropic_api_key)
//   { action: 'card_catalog' }                                              → {catalog} — товары и заготовки iiko с последней ценой прихода
// Доступ: service-role, x-pos-key = app_secrets.pos_api_key (pg_cron), либо вход в Офис с правом cost.view (или владелец).
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pos-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const DAY = 864e5;
const mskDate = (shift = 0) => new Date(Date.now() + 3 * 3600e3 + shift * DAY).toISOString().slice(0, 10);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

async function secret(key: string) {
  const { data } = await db.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return ((data?.value as string) || '').trim();
}

async function allowed(req: Request) {
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (auth && auth === SERVICE_KEY) return true;
  const pk = req.headers.get('x-pos-key');
  if (pk && pk === await secret('pos_api_key')) return true;
  if (!auth) return false;
  const u = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: 'Bearer ' + auth } }, auth: { persistSession: false } });
  const { data } = await u.rpc('crm_me');
  const me = data as any;
  return !!(me && (me.owner || (me.perms || []).includes('cost.view')));
}

// ---------- iikoServer: вход → запросы → выход (вход занимает лицензию) ----------
type Get = (path: string, q?: Record<string, string>) => Promise<string>;
type Post = (path: string, body: unknown) => Promise<string>;
async function iikoServer<T>(work: (get: Get, post: Post) => Promise<T>): Promise<T> {
  const [url, login, pass] = await Promise.all([secret('iiko_server_url'), secret('iiko_server_login'), secret('iiko_server_password')]);
  if (!url || !login || !pass) throw new Error('Не заданы доступы к серверу iiko (app_secrets.iiko_server_url / _login / _password)');
  const base = url.replace(/\/+$/, '').replace(/\/api$/, '') + '/api/';
  const sha1 = /^[0-9a-f]{40}$/i.test(pass) ? pass.toLowerCase()
    : [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pass)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const check = async (r: Response, path: string) => {
    const t = await r.text();
    if (r.status === 403) {
      const right = (t.match(/Permission denied:\s*([A-Z_0-9]+)/) || [])[1];
      throw new Error(`У пользователя iiko «${login}» нет права${right ? ' ' + right : ''} (запрос ${path}). Выдайте его в iikoOffice: Сотрудники → ${login} → права`);
    }
    if (!r.ok) throw new Error(`Сервер iiko ${path}: ${r.status} ${t.slice(0, 200)}`);
    return t;
  };
  const call = async (path: string, q: Record<string, string> = {}) =>
    check(await fetch(base + path + '?' + new URLSearchParams(q), { signal: AbortSignal.timeout(60000) }), path);
  const key = (await call('auth', { login, pass: sha1 })).trim();
  if (!key || key.length > 100) throw new Error('Сервер iiko не пустил: проверьте логин и пароль');
  try {
    return await work(
      (path, q = {}) => call(path, { ...q, key }),
      async (path, body) => check(await fetch(base + path + '?key=' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) }), path),
    );
  } finally {
    await call('logout', { key }).catch(() => { /* лицензия освободится сама */ });
  }
}

const xmlText = (x: string) => x.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'");
const tag = (x: string, t: string) => (x.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1];

type Product = { id: string; name: string; type: string; deleted: boolean; parent: string | null };
type Chart = { product: string; amount: number; items: { product: string; amountIn: number; amountOut: number }[] };
type Delivery = { at: string; supplier: string; price: number; amount: number; doc: string };

async function loadIiko(salesDays: number) {
  const today = mskDate(), from = mskDate(-salesDays), invFrom = mskDate(-120);
  return iikoServer(async (get, post) => {
    const [prods, groups, charts, sup, inv] = await Promise.all([
      get('v2/entities/products/list', { includeDeleted: 'true' }),
      get('v2/entities/products/group/list', { includeDeleted: 'false' }).catch(() => '[]'),
      get('v2/assemblyCharts/getAll', { dateFrom: today, dateTo: today, includeDeletedProducts: 'false', includePreparedCharts: 'false' }),
      get('suppliers').catch(() => ''),
      get('documents/export/incomingInvoice', { from: invFrom, to: today }),
    ]);
    // продажи блюд — отдельно: если OLAP упадёт (другие имена полей в версии iiko), проверки без продаж всё равно работают
    let sales: Record<string, { qty: number; sum: number }> | null = null, salesError: string | null = null;
    try {
      const body = {
        reportType: 'SALES', buildSummary: false,
        groupByRowFields: ['DishId', 'DishName'],
        aggregateFields: ['DishAmountInt', 'DishSumInt'],
        filters: {
          'OpenDate.Typed': { filterType: 'DateRange', periodType: 'CUSTOM', from, to: today, includeLow: true, includeHigh: false },
          'OrderDeleted': { filterType: 'IncludeValues', values: ['NOT_DELETED'] },
          'DeletedWithWriteoff': { filterType: 'IncludeValues', values: ['NOT_DELETED'] },
        },
      };
      const rows = (JSON.parse(await post('v2/reports/olap', body)).data || []) as any[];
      sales = {};
      for (const r of rows) {
        const id = String(r.DishId || '');
        if (!id) continue;
        const s = sales[id] ||= { qty: 0, sum: 0 };
        s.qty += Number(r.DishAmountInt || 0); s.sum += Number(r.DishSumInt || 0);
      }
    } catch (e) { salesError = String((e as Error).message || e); }
    return { prods, groups, charts, sup, inv, sales, salesError };
  });
}

function parseProducts(prods: string, groups: string) {
  const products = new Map<string, Product>();
  for (const p of JSON.parse(prods) as any[]) {
    products.set(p.id, { id: p.id, name: String(p.name || '').trim(), type: String(p.type || '').toUpperCase(), deleted: !!p.deleted, parent: p.parent || null });
  }
  const grp = new Map<string, { name: string; parent: string | null }>();
  for (const g of JSON.parse(groups || '[]') as any[]) grp.set(g.id, { name: String(g.name || ''), parent: g.parent || null });
  // раздел — по цепочке групп снизу вверх: первая группа со словом «бар»/«кух»
  const sectionOf = (id: string): string | null => {
    let g = products.get(id)?.parent || null, guard = 0;
    while (g && guard++ < 20) {
      const n = grp.get(g); if (!n) break;
      if (/бар/i.test(n.name)) return 'Бар';
      if (/кух/i.test(n.name)) return 'Кухня';
      g = n.parent;
    }
    return null;
  };
  const groupPath = (id: string) => {
    const out: string[] = []; let g = products.get(id)?.parent || null, guard = 0;
    while (g && guard++ < 20) { const n = grp.get(g); if (!n) break; out.unshift(n.name); g = n.parent; }
    return out.join(' / ');
  };
  return { products, sectionOf, groupPath };
}

function parseCharts(raw: string) {
  const d = JSON.parse(raw);
  const charts = new Map<string, Chart>();
  for (const c of [...(d.assemblyCharts || []), ...(d.preparedCharts || [])] as any[]) {
    const pid = c.assembledProductId || c.productId;
    if (!pid || charts.has(pid)) continue;
    charts.set(pid, {
      product: pid, amount: Number(c.assembledAmount || 1) || 1,
      items: (c.items || []).map((i: any) => ({ product: i.productId, amountIn: Number(i.amountIn || 0), amountOut: Number(i.amountOut || 0) })).filter((i: any) => i.product),
    });
  }
  return charts;
}

function parseInvoices(inv: string, sup: string) {
  const names = new Map<string, string>();
  for (const m of sup.matchAll(/<employee>([\s\S]*?)<\/employee>/g)) {
    const id = tag(m[1], 'id'); if (id) names.set(id, xmlText(tag(m[1], 'name') || ''));
  }
  const byProduct = new Map<string, Delivery[]>();
  for (const m of inv.matchAll(/<(document|incomingInvoiceDto)>([\s\S]*?)<\/\1>/g)) {
    const doc = m[2];
    if (tag(doc, 'status') === 'DELETED') continue;
    const at = (tag(doc, 'dateIncoming') || '').slice(0, 10);
    const supplier = names.get(tag(doc, 'supplier') || '') || '';
    const num = xmlText(tag(doc, 'incomingDocumentNumber') || tag(doc, 'documentNumber') || '');
    for (const it of doc.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const x = it[1];
      const product = tag(x, 'product') || tag(x, 'productId');
      const amount = Number(tag(x, 'amount') || tag(x, 'actualAmount') || 0);
      const sum = Number(tag(x, 'sum') || 0);
      const price = amount > 0 && sum > 0 ? sum / amount : Number(tag(x, 'price') || 0);
      if (!product || !(price > 0)) continue;
      (byProduct.get(product) || byProduct.set(product, []).get(product)!).push({ at, supplier, price, amount, doc: num });
    }
  }
  for (const list of byProduct.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  return byProduct;
}

type Issue = { key: string; kind: string; severity: 'info' | 'warn' | 'crit'; product_id: string | null; product_name: string; section: string | null; details: Record<string, unknown> };

async function check(venue: string, trigger: string) {
  const { data: st } = await db.from('cost_settings').select('params').eq('id', 'main').maybeSingle();
  const P = { price_jump_pct: 10, price_jump_crit_pct: 25, price_window_days: 14, foodcost_kitchen_pct: 35, foodcost_bar_pct: 30, foodcost_bottle_pct: 50, stale_days: 60, sales_days: 30, ...((st?.params as any) || {}) };
  const run = (await db.from('cost_runs').insert({ trigger }).select('id').single()).data!;
  try {
    const raw = await loadIiko(P.sales_days);
    const { products, sectionOf, groupPath } = parseProducts(raw.prods, raw.groups);
    const charts = parseCharts(raw.charts);
    const deliveries = parseInvoices(raw.inv, raw.sup);
    const sales = raw.sales;
    const name = (id: string) => products.get(id)?.name || id;
    const lastPrice = (id: string) => { const l = deliveries.get(id); return l && l.length ? l[l.length - 1].price : null; };

    // себестоимость единицы: товар — последняя цена прихода; блюдо/заготовка — по техкарте (рекурсивно)
    const memo = new Map<string, { cost: number | null; missing: string[] }>();
    const unitCost = (id: string, depth = 0): { cost: number | null; missing: string[] } => {
      if (memo.has(id)) return memo.get(id)!;
      const p = products.get(id);
      let res: { cost: number | null; missing: string[] };
      if (!p || depth > 6) res = { cost: null, missing: [name(id)] };
      else if (p.type === 'GOODS') { const c = lastPrice(id); res = c == null ? { cost: null, missing: [p.name] } : { cost: c, missing: [] }; }
      else {
        const ch = charts.get(id);
        if (!ch || !ch.items.length) res = { cost: null, missing: [p.name + ' (нет техкарты)'] };
        else {
          let sum = 0; const missing: string[] = [];
          for (const it of ch.items) { const c = unitCost(it.product, depth + 1); if (c.cost == null) missing.push(...c.missing); else sum += c.cost * it.amountIn; }
          res = { cost: sum / ch.amount, missing };
        }
      }
      memo.set(id, res); return res;
    };

    const issues: Issue[] = [];
    const today = mskDate();
    const dishes = [...products.values()].filter((p) => !p.deleted && (p.type === 'DISH' || p.type === 'PREPARED'));
    const sold = (id: string) => !sales || (sales[id]?.qty || 0) > 0;

    for (const p of dishes) {
      const section = sectionOf(p.id);
      const ch = charts.get(p.id);
      const s = sales?.[p.id];
      // 1. продаётся без техкарты
      if (!ch || !ch.items.length) {
        if (p.type === 'DISH' && sales && !(s?.qty)) continue; // не продавалось — не шумим
        issues.push({ key: `no_chart:${p.id}`, kind: 'no_chart', severity: s?.qty ? 'crit' : 'warn', product_id: p.id, product_name: p.name, section,
          details: { group: groupPath(p.id), sold_qty: s ? round(s.qty) : null, sold_sum: s ? Math.round(s.sum) : null, days: P.sales_days } });
        continue;
      }
      for (const it of ch.items) {
        const ing = products.get(it.product);
        // 2. удалённый / неизвестный ингредиент
        if (!ing || ing.deleted) {
          issues.push({ key: `deleted_ingredient:${p.id}:${it.product}`, kind: 'deleted_ingredient', severity: 'crit', product_id: p.id, product_name: p.name, section,
            details: { ingredient: ing?.name || it.product, amount: it.amountIn } });
          continue;
        }
        // 3. ингредиент давно не закупался (только товары; только у продаваемых позиций)
        if (ing.type === 'GOODS' && sold(p.id)) {
          const l = deliveries.get(ing.id);
          const last = l && l.length ? l[l.length - 1].at : null;
          const age = last ? Math.floor((Date.parse(today) - Date.parse(last)) / DAY) : null;
          if (age == null || age > P.stale_days) {
            issues.push({ key: `stale_ingredient:${p.id}:${ing.id}`, kind: 'stale_ingredient', severity: 'warn', product_id: p.id, product_name: p.name, section,
              details: { ingredient: ing.name, last_delivery: last, days: age, window: 120 } });
          }
        }
      }
      // 4. фудкост по последним ценам к средней цене продажи
      if (p.type === 'DISH' && s && s.qty > 0 && s.sum > 0) {
        const c = unitCost(p.id);
        const price = s.sum / s.qty;
        if (c.cost != null && !c.missing.length && price > 0) {
          const pct = c.cost / price * 100;
          const bottle = section === 'Бар' && ch.items.length === 1 && products.get(ch.items[0].product)?.type === 'GOODS';
          const lim = section === 'Бар' ? (bottle ? P.foodcost_bottle_pct : P.foodcost_bar_pct) : P.foodcost_kitchen_pct;
          if (pct > lim) {
            issues.push({ key: `foodcost:${p.id}`, kind: 'foodcost', severity: pct > lim * 1.3 ? 'crit' : 'warn', product_id: p.id, product_name: p.name, section,
              details: { cost: round(c.cost), price: round(price), pct: round(pct, 1), limit: lim, bottle, sold_qty: round(s.qty) } });
          }
        }
      }
    }

    // 5. рост закупочной цены к прошлой поставке (поставки последних N дней)
    const winFrom = mskDate(-P.price_window_days);
    const usedIn = new Map<string, string[]>();
    for (const [pid, ch] of charts) for (const it of ch.items) (usedIn.get(it.product) || usedIn.set(it.product, []).get(it.product)!).push(name(pid));
    for (const [pid, list] of deliveries) {
      if (list.length < 2) continue;
      const last = list[list.length - 1];
      if (last.at < winFrom) continue;
      // прошлая поставка — последняя с другой датой (в один день бывает несколько строк)
      const prev = [...list].reverse().find((d) => d.at < last.at);
      if (!prev) continue;
      const pct = (last.price / prev.price - 1) * 100;
      if (pct >= P.price_jump_pct) {
        const p = products.get(pid);
        issues.push({ key: `price_jump:${pid}:${last.at}`, kind: 'price_jump', severity: pct >= P.price_jump_crit_pct ? 'crit' : 'warn', product_id: pid, product_name: p?.name || pid, section: sectionOf(pid),
          details: { supplier: last.supplier, at: last.at, doc: last.doc, price: round(last.price), prev_price: round(prev.price), prev_at: prev.at, prev_supplier: prev.supplier, pct: round(pct, 1), used_in: (usedIn.get(pid) || []).slice(0, 8) } });
      }
    }

    // ---------- запись: новые / ещё есть / исчезли ----------
    const now = new Date().toISOString();
    const { data: open } = await db.from('cost_issues').select('id,key').eq('venue_id', venue).is('resolved_at', null);
    const seen = new Set(issues.map((i) => i.key));
    for (let i = 0; i < issues.length; i += 200) {
      const chunk = issues.slice(i, i + 200).map((x) => ({ ...x, venue_id: venue, last_seen: now, resolved_at: null }));
      const { error } = await db.from('cost_issues').upsert(chunk, { onConflict: 'key', ignoreDuplicates: false });
      if (error) throw new Error(error.message);
    }
    const gone = (open || []).filter((o: any) => !seen.has(o.key)).map((o: any) => o.id);
    for (let i = 0; i < gone.length; i += 200) await db.from('cost_issues').update({ resolved_at: now }).in('id', gone.slice(i, i + 200));

    const by: Record<string, number> = {};
    issues.forEach((x) => by[x.kind] = (by[x.kind] || 0) + 1);
    const stats = { issues: issues.length, by, resolved: gone.length, products: products.size, charts: charts.size, dishes: dishes.length,
      priced_goods: deliveries.size, sales: sales ? Object.keys(sales).length : null, sales_error: raw.salesError };
    await db.from('cost_runs').update({ finished_at: new Date().toISOString(), ok: true, stats }).eq('id', run.id);
    return stats;
  } catch (e) {
    await db.from('cost_runs').update({ finished_at: new Date().toISOString(), ok: false, error: String((e as Error).message || e) }).eq('id', run.id);
    throw e;
  }
}

// ---------- техкарта «с листочка» ----------
// Каталог для сопоставления: товары и заготовки iiko с единицей и последней ценой прихода; блюда — с ценой продажи.
async function cardCatalog() {
  const today = mskDate(), invFrom = mskDate(-120), salesFrom = mskDate(-30);
  const raw = await iikoServer(async (get, post) => {
    const [prods, units, inv, charts] = await Promise.all([
      get('v2/entities/products/list', { includeDeleted: 'false' }),
      get('v2/entities/list', { rootType: 'MeasureUnit', includeDeleted: 'false' }).catch(() => '[]'),
      get('documents/export/incomingInvoice', { from: invFrom, to: today }),
      get('v2/assemblyCharts/getAll', { dateFrom: today, dateTo: today, includeDeletedProducts: 'false', includePreparedCharts: 'false' }).catch(() => '{}'),
    ]);
    let sales: any[] = [];
    try {
      sales = JSON.parse(await post('v2/reports/olap', {
        reportType: 'SALES', buildSummary: false, groupByRowFields: ['DishId'], aggregateFields: ['DishAmountInt', 'DishSumInt'],
        filters: {
          'OpenDate.Typed': { filterType: 'DateRange', periodType: 'CUSTOM', from: salesFrom, to: today, includeLow: true, includeHigh: false },
          'OrderDeleted': { filterType: 'IncludeValues', values: ['NOT_DELETED'] },
        },
      })).data || [];
    } catch { /* без цены продажи — её введут руками */ }
    return { prods, units, inv, sales, charts };
  });
  const unitName = new Map<string, string>((JSON.parse(raw.units) as any[]).map((u) => [u.id, String(u.name || '')]));
  const deliveries = parseInvoices(raw.inv, '');
  const salePrice = new Map<string, number>();
  for (const r of raw.sales) { const q = Number(r.DishAmountInt || 0), s = Number(r.DishSumInt || 0); if (r.DishId && q > 0 && s > 0) salePrice.set(r.DishId, s / q); }
  // заготовка (п/ф) не закупается — её цена считается по её техкарте из последних цен прихода
  const charts = parseCharts(raw.charts || '{}');
  const lastOf = (id: string) => { const l = deliveries.get(id); return l && l.length ? l[l.length - 1] : null; };
  const memo = new Map<string, number | null>();
  const prepCost = (id: string, depth = 0): number | null => {
    if (memo.has(id)) return memo.get(id)!;
    const last = lastOf(id);
    let v: number | null = last ? last.price : null;
    if (v == null && depth < 6) {
      const ch = charts.get(id);
      if (ch && ch.items.length) {
        let sum = 0;
        for (const it of ch.items) { const c = prepCost(it.product, depth + 1); if (c == null) { sum = NaN; break; } sum += c * it.amountIn; }
        v = Number.isFinite(sum) ? sum / ch.amount : null;
      }
    }
    memo.set(id, v); return v;
  };
  const goods: { id: string; name: string; type: string; unit: string; price: number | null; at: string | null }[] = [];
  const dishes: { id: string; name: string; price: number | null }[] = [];
  for (const p of JSON.parse(raw.prods) as any[]) {
    if (p.deleted) continue;
    const t = String(p.type || '').toUpperCase(), name = String(p.name || '').trim();
    if (t === 'GOODS' || t === 'PREPARED') {
      const last = lastOf(p.id);
      const price = last ? last.price : t === 'PREPARED' ? prepCost(p.id) : null;
      goods.push({ id: p.id, name, type: t, unit: unitName.get(p.mainUnit) || '', price: price != null ? round(price) : null, at: last?.at || (price != null ? 'техкарта' : null) });
    } else if (t === 'DISH') dishes.push({ id: p.id, name, price: salePrice.has(p.id) ? round(salePrice.get(p.id)!) : null });
  }
  return { goods, dishes };
}

const CARD_TOOL = {
  name: 'techcard',
  description: 'Структурированная технологическая карта, распознанная с листка шеф-повара',
  input_schema: {
    type: 'object',
    properties: {
      dish: { type: 'string', description: 'Название блюда, как на листке' },
      dish_id: { type: ['string', 'null'], description: 'id блюда из списка «Блюда iiko», если это то же блюдо; иначе null' },
      output_g: { type: ['number', 'null'], description: 'Выход готового блюда, г (если указан или однозначно следует из состава)' },
      text: { type: 'string', description: 'Дословная расшифровка листка' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            raw: { type: 'string', description: 'Ингредиент как написан на листке' },
            product_id: { type: ['string', 'null'], description: 'id из списка «Номенклатура iiko»; null, если подходящего нет' },
            qty: { type: 'number', description: 'Количество, как на листке' },
            qty_unit: { type: 'string', enum: ['г', 'кг', 'мл', 'л', 'шт'] },
            qty_is: { type: 'string', enum: ['нетто', 'брутто'], description: 'Что указал шеф: нетто (что идёт в блюдо) или брутто (что берётся со склада). Если не сказано — нетто' },
            process: { type: 'string', description: 'Обработка: без обработки, очистка, разделка, варка, жарка, фритюр, тушение, запекание, гриль, су-вид и т.п.' },
            loss_cold: { type: 'number', description: 'Потери при холодной обработке, % (очистка, разделка, разморозка) — по Сборнику рецептур; 0 для готовых покупных продуктов' },
            loss_hot: { type: 'number', description: 'Потери при тепловой обработке, % (ужарка, уварка) — по Сборнику рецептур; 0 если без тепловой обработки' },
            note: { type: ['string', 'null'], description: 'Сомнение по этой строке для шефа, если есть' },
          },
          required: ['raw', 'product_id', 'qty', 'qty_unit', 'qty_is', 'process', 'loss_cold', 'loss_hot'],
        },
      },
      questions: { type: 'array', items: { type: 'string' }, description: 'Что уточнить у шефа (неразборчиво, неясные граммовки, нет в номенклатуре)' },
    },
    required: ['dish', 'items', 'questions', 'text'],
  },
};

async function cardParse(b: any) {
  const key = await secret('anthropic_api_key');
  if (!key) throw new Error('Не задан ключ ИИ: app_secrets.anthropic_api_key');
  const text = String(b.text || '').slice(0, 4000);
  const image = typeof b.image === 'string' && b.image.length < 6_000_000 ? b.image : null;
  if (!text && !image) throw new Error('Пришлите фото листка или текст техкарты');
  const cat = await cardCatalog();
  const goodsList = cat.goods.map((g) => `${g.id};${g.name};${g.unit || '?'};${g.type === 'PREPARED' ? 'заготовка' : 'товар'}`).join('\n');
  const dishList = cat.dishes.map((d) => `${d.id};${d.name}`).join('\n');
  const system = `Ты — калькулятор (технолог) общепита в пабе. Тебе дают листок шеф-повара с составом блюда.
Задача: расшифровать листок, разложить состав по строкам и сопоставить каждый ингредиент с номенклатурой iiko.
Правила:
- product_id бери ТОЛЬКО из списка «Номенклатура iiko». Предпочитай заготовку (п/ф), если шеф пишет про готовый полуфабрикат («соус BBQ», «котлета»), и товар — если про сырьё. Если сомневаешься между вариантами — выбери лучший и напиши note. Если подходящего нет — null и вопрос в questions.
- Количество переписывай как на листке, без пересчёта. «Булка 1» — 1 шт.
- Потери при обработке ставь по Сборнику рецептур и здравому смыслу кухни паба: сырое мясо, рыба, овощи с очисткой, жарка, варка — с потерями; покупные готовые продукты (булки, соусы в упаковке, сыр ломтиками, замороженный картофель фри) — 0 холодных потерь. Не выдумывай потери там, где их нет.
- Если блюдо уже есть в списке «Блюда iiko» — укажи dish_id.
- Всё, что неразборчиво или вызывает сомнение, — в questions, коротко, по-русски.`;
  const content: any[] = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: b.media || 'image/jpeg', data: image } });
  content.push({ type: 'text', text: `${text ? 'Текст от шефа:\n' + text + '\n\n' : ''}Номенклатура iiko (id;название;единица;вид):\n${goodsList}\n\nБлюда iiko (id;название):\n${dishList}` });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: (await secret('anthropic_model')) || 'claude-sonnet-5-5', max_tokens: 4000, system, tools: [CARD_TOOL], tool_choice: { type: 'tool', name: 'techcard' }, messages: [{ role: 'user', content }] }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('ИИ не ответил: ' + (out?.error?.message || r.status));
  const card = (out.content || []).find((c: any) => c.type === 'tool_use')?.input;
  if (!card) throw new Error('ИИ не вернул техкарту');

  const goods = new Map(cat.goods.map((g) => [g.id, g]));
  const items = (card.items || []).map((it: any) => {
    const g = it.product_id ? goods.get(it.product_id) : undefined;
    return { raw: it.raw, product_id: g ? g.id : null, product_name: g?.name || null, unit: g?.unit || null, qty: Number(it.qty) || 0, qty_unit: it.qty_unit, qty_is: it.qty_is || 'нетто',
      process: it.process || '', loss_cold: Number(it.loss_cold) || 0, loss_hot: Number(it.loss_hot) || 0, price: g?.price ?? null, price_at: g?.at ?? null,
      note: it.note || (it.product_id && !g ? 'ИИ указал товар, которого нет в номенклатуре' : null) };
  });
  const dish = card.dish_id ? cat.dishes.find((d) => d.id === card.dish_id) : null;
  return { card: { name: card.dish || '', product_id: dish?.id || null, price: dish?.price ?? null, output: card.output_g ?? null, source_text: card.text || text, items, notes: card.questions || [] },
    catalog: cat.goods.map((g) => ({ id: g.id, name: g.name, unit: g.unit, price: g.price, at: g.at })) };
}

// ---------- утренняя сводка ----------
const KIND: Record<string, string> = {
  no_chart: 'Продаётся без техкарты', deleted_ingredient: 'Удалённый товар в техкарте', stale_ingredient: 'Ингредиент давно не закупался',
  price_jump: 'Подорожание у поставщика', foodcost: 'Фудкост выше нормы',
};
const h = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function line(i: any) {
  const d = i.details || {};
  switch (i.kind) {
    case 'no_chart': return `${h(i.product_name)}${d.sold_qty ? ` — продано ${d.sold_qty} шт за ${d.days} дн.` : ''}`;
    case 'deleted_ingredient': return `${h(i.product_name)} → ${h(d.ingredient)}`;
    case 'stale_ingredient': return `${h(i.product_name)} → ${h(d.ingredient)} (${d.last_delivery ? 'посл. приход ' + d.last_delivery : 'приходов не было'})`;
    case 'price_jump': return `${h(i.product_name)}: ${d.prev_price} → ${d.price} ₽ (+${d.pct}%), ${h(d.supplier)}`;
    case 'foodcost': return `${h(i.product_name)}: ${d.pct}% (норма ${d.limit}%), себест. ${d.cost} ₽ при цене ${d.price} ₽`;
    default: return h(i.product_name);
  }
}
async function digest(venue: string) {
  const { data } = await db.from('cost_issues').select('*').eq('venue_id', venue).is('resolved_at', null).eq('muted', false).order('severity').order('first_seen', { ascending: false });
  const list = (data || []) as any[];
  const { data: lastRun } = await db.from('cost_runs').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle();
  const since = Date.now() - 26 * 3600e3;
  const fresh = list.filter((i) => Date.parse(i.first_seen) > since);
  const parts: string[] = ['<b>Себестоимость · утренняя сводка</b>'];
  if (lastRun && lastRun.ok === false) parts.push(`⚠️ Ночная проверка не прошла: ${h(lastRun.error)}`);
  if (!list.length) parts.push('Проблем нет ✅');
  else {
    const cnt: Record<string, number> = {};
    list.forEach((i) => cnt[i.kind] = (cnt[i.kind] || 0) + 1);
    parts.push(Object.entries(cnt).map(([k, n]) => `• ${KIND[k] || k}: ${n}`).join('\n'));
    const crit = list.filter((i) => i.severity === 'crit');
    const show = (fresh.length ? fresh : crit).slice(0, 12);
    if (show.length) {
      parts.push(fresh.length ? `\n<b>Новое за сутки (${fresh.length}):</b>` : '\n<b>Срочное:</b>');
      parts.push(show.map((i) => `${i.severity === 'crit' ? '🔴' : '🟡'} ${line(i)}`).join('\n'));
      const more = (fresh.length ? fresh.length : crit.length) - show.length;
      if (more > 0) parts.push(`…и ещё ${more}`);
    }
  }
  parts.push('\nПодробно: patrikipab.ru/office/#cost');
  const tok = await secret('telegram_bot_token');
  const chat = (await secret('telegram_chat_id:cost')) || (await secret('telegram_chat_id:' + venue)) || (await secret('telegram_chat_id'));
  if (!tok || !chat) return { sent: false, reason: 'нет telegram_bot_token / chat id' };
  const [chatId, thread] = chat.split('/');
  const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, ...(thread ? { message_thread_id: Number(thread) } : {}), text: parts.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true }) });
  return { sent: r.ok, open: list.length, fresh: fresh.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!(await allowed(req))) return json({ error: 'Нет доступа' }, 403);
    const b = await req.json().catch(() => ({}));
    const venue = String(b.venue || 'petrogradka');
    if (b.action === 'digest') return json(await digest(venue));
    if (b.action === 'card_parse') return json(await cardParse(b));
    if (b.action === 'card_catalog') { const c = await cardCatalog(); return json({ catalog: c.goods.map((g) => ({ id: g.id, name: g.name, unit: g.unit, price: g.price, at: g.at })) }); }
    return json({ venue, stats: await check(venue, b.trigger === 'cron' ? 'cron' : 'manual') });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
