// Патрики Паб — онлайн-оплата через интернет-эквайринг Сбера (Supabase Edge Function «sber»).
//
// Двухстадийная оплата: при оформлении деньги БЛОКИРУЮТСЯ (registerPreAuth),
// при «Принять и готовить» — СПИСЫВАЮТСЯ (deposit), при отмене — блокировка СНИМАЕТСЯ (reverse),
// после списания — ВОЗВРАТ (refund).
//
// Секреты (Supabase → Edge Functions → Secrets):
//   SBER_MODE      mock | test | prod   (mock — имитация без Сбера, для проверки до договора)
//   SBER_USERNAME  логин API-пользователя из личного кабинета Сбера (обычно оканчивается на -api)
//   SBER_PASSWORD  пароль API-пользователя
//   SBER_API_URL   необязательно: адрес шлюза, если Сбер выдал другой
//   APP_RETURN_URLS необязательно: разрешённые адреса возврата через запятую
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
//
// Функция разворачивается с выключенной проверкой JWT (Сбер присылает уведомления без токена);
// права проверяются внутри: управляющий — по таблице admins.

import { createClient } from 'npm:@supabase/supabase-js@2';

const MODE = (Deno.env.get('SBER_MODE') || 'mock').toLowerCase();
const API_URL = (Deno.env.get('SBER_API_URL') ||
  (MODE === 'prod' ? 'https://securepayments.sberbank.ru/payment/rest/' : 'https://3dsec.sberbank.ru/payment/rest/')).replace(/\/?$/, '/');
const USERNAME = Deno.env.get('SBER_USERNAME') || '';
const PASSWORD = Deno.env.get('SBER_PASSWORD') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const RETURN_OK = (Deno.env.get('APP_RETURN_URLS') ||
  'https://plintus171993-lang.github.io/patriki-app/,https://localhost/,http://localhost:8765/,capacitor://localhost/')
  .split(',').map((s) => s.trim()).filter(Boolean);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// orderStatus Сбера → наш статус оплаты
const SBER_STATUS: Record<number, string> = { 0: 'pending', 1: 'held', 2: 'paid', 3: 'cancelled', 4: 'refunded', 5: 'pending', 6: 'failed' };

/* ---------------- запрос к шлюзу Сбера ---------------- */
async function sber(method: string, params: Record<string, string | number>) {
  const isJson = API_URL.includes('/ecomm/');            // новый шлюз ecomm принимает JSON, классический — форму
  const body: Record<string, string> = { userName: USERNAME, password: PASSWORD };
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') body[k] = String(v);
  const res = await fetch(API_URL + method, {
    method: 'POST',
    headers: { 'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: isJson ? JSON.stringify(body) : new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  const code = Number(data.errorCode ?? 0);
  if (code !== 0) throw new Error(`Сбер ${method}: ${data.errorMessage || 'ошибка ' + code}`);
  return data;
}

/* ---------------- вспомогательное ---------------- */
async function getOrder(id: string) {
  const { data, error } = await db.from('orders').select('*').eq('id', id).maybeSingle();
  if (error || !data) throw new Error('Заказ не найден');
  return data;
}
async function setPayment(id: string, patch: Record<string, unknown>) {
  const { error } = await db.from('orders').update(patch).eq('id', id);
  if (error) throw error;
}
async function requireAdmin(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Нет входа');
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) throw new Error('Нет входа');
  const { data } = await db.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle();
  if (!data) throw new Error('Нет прав управляющего');
}
// Узнаём реальный статус у Сбера (уведомлениям на слово не верим)
async function syncFromSber(order: Record<string, any>) {
  if (MODE === 'mock' || !order.sber_order_id) return order.payment_status;
  const st = await sber('getOrderStatusExtended.do', { orderId: order.sber_order_id });
  const ps = SBER_STATUS[Number(st.orderStatus)] ?? order.payment_status;
  if (ps !== order.payment_status) {
    await setPayment(order.id, { payment_status: ps, ...(ps === 'held' || ps === 'paid' ? { paid_at: new Date().toISOString() } : {}) });
  }
  return ps;
}

/* ---------------- действия ---------------- */
async function create(body: any) {
  const order = await getOrder(body.order_id);
  if (order.payment !== 'online') throw new Error('Заказ не для онлайн-оплаты');
  if (!['pending', 'failed'].includes(order.payment_status)) return { already: order.payment_status };
  const base = String(body.return_base || '');
  if (!RETURN_OK.some((ok) => base.startsWith(ok))) throw new Error('Недопустимый адрес возврата');
  const back = (paid: boolean) => `${base}#/order/${order.id}?pay=${paid ? 'ok' : 'fail'}`;

  if (MODE === 'mock') {
    await setPayment(order.id, { sber_order_id: 'mock-' + order.number, payment_status: 'pending' });
    return { formUrl: `${base}#/pay-test/${order.id}`, mode: 'mock' };
  }
  // повторная попытка после неудачи — новый номер для Сбера
  const attempt = order.payment_status === 'failed' ? '-' + Date.now().toString(36) : '';
  // Уведомления: адрес функции указывается в кабинете Сбера (статический callback).
  // Даже без них статус сверяется со Сбером при возврате гостя, в админке и при списании.
  const r = await sber('registerPreAuth.do', {
    orderNumber: `PTR-${order.number}${attempt}`,
    amount: Math.round(Number(order.total) * 100),          // в копейках
    currency: 643,
    returnUrl: back(true),
    failUrl: back(false),
    description: `Патрики Паб, заказ №${order.number}`,
    language: 'ru',
    sessionTimeoutSecs: 1200,
  });
  await setPayment(order.id, { sber_order_id: r.orderId, payment_status: 'pending' });
  return { formUrl: r.formUrl, mode: MODE };
}

async function status(body: any) {
  const order = await getOrder(body.order_id);
  const ps = await syncFromSber(order).catch(() => order.payment_status);
  return { payment_status: ps, status: order.status, number: order.number };
}

// Только в режиме имитации: «оплатил» / «отказался» на тестовой странице
async function mockPay(body: any) {
  if (MODE !== 'mock') throw new Error('Только в режиме имитации');
  const order = await getOrder(body.order_id);
  if (order.payment_status !== 'pending') return { payment_status: order.payment_status };
  const ps = body.result === 'ok' ? 'held' : 'failed';
  await setPayment(order.id, { payment_status: ps, ...(ps === 'held' ? { paid_at: new Date().toISOString() } : {}) });
  return { payment_status: ps };
}

async function capture(req: Request, body: any) {
  await requireAdmin(req);
  const order = await getOrder(body.order_id);
  const ps = await syncFromSber(order);
  if (ps === 'paid') return { payment_status: 'paid' };
  if (ps !== 'held') throw new Error('Деньги не заблокированы — списать нельзя');
  if (MODE !== 'mock') await sber('deposit.do', { orderId: order.sber_order_id, amount: 0 });   // 0 — вся сумма
  await setPayment(order.id, { payment_status: 'paid' });
  return { payment_status: 'paid' };
}

async function cancel(req: Request, body: any) {
  await requireAdmin(req);
  const order = await getOrder(body.order_id);
  const ps = await syncFromSber(order);
  if (ps === 'held') {
    if (MODE !== 'mock') await sber('reverse.do', { orderId: order.sber_order_id });
    await setPayment(order.id, { payment_status: 'cancelled' });
    return { payment_status: 'cancelled' };
  }
  if (ps === 'paid') {
    if (MODE !== 'mock') await sber('refund.do', { orderId: order.sber_order_id, amount: Math.round(Number(order.total) * 100) });
    await setPayment(order.id, { payment_status: 'refunded' });
    return { payment_status: 'refunded' };
  }
  return { payment_status: ps };
}

// Уведомление от Сбера (GET или POST с mdOrder, orderNumber, operation, status)
async function callback(params: URLSearchParams) {
  const md = params.get('mdOrder');
  if (!md) return new Response('no mdOrder', { status: 400 });
  const { data: order } = await db.from('orders').select('*').eq('sber_order_id', md).maybeSingle();
  if (order) await syncFromSber(order);
  return new Response('OK', { status: 200, headers: CORS });
}

/* ---------------- маршрутизация ---------------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') return await callback(url.searchParams);
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return await callback(new URLSearchParams(await req.text()));
    const body = await req.json();
    if (body.mdOrder) return await callback(new URLSearchParams(body));
    switch (body.action) {
      case 'create': return json(await create(body));
      case 'status': return json(await status(body));
      case 'mock-pay': return json(await mockPay(body));
      case 'capture': return json(await capture(req, body));
      case 'cancel': return json(await cancel(req, body));
      case 'ping': return json({ ok: true, mode: MODE, configured: MODE === 'mock' || !!(USERNAME && PASSWORD) });
      default: return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 400);
  }
});
