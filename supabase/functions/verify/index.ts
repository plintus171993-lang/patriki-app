// Патрики Паб — подтверждение номера телефона гостя.
//  1) Telegram-бот: приложение создаёт заявку → гость открывает @бота → «Поделиться номером».
//     Telegram сам гарантирует, что номер принадлежит этому аккаунту (contact.user_id === from.id).
//  2) Звонок-сброс: на номер поступает звонок, код — последние 4 цифры входящего номера.
//
// Разворачивать С ВЫКЛЮЧЕННОЙ проверкой JWT: Telegram присылает вебхук без токена.
// Запросы приложения проверяются по JWT гостя, вебхук — по секрету в заголовке.
//
// Токен бота и секрет вебхука берутся из таблицы app_secrets (telegram_bot_token, telegram_webhook_secret).
// Звонок: CALL_PROVIDER = mock (по умолчанию: звонка нет, код виден в админке и в Telegram) | smsru
//         SMSRU_API_ID — ключ API SMS.ru (вводит владелец в Edge Functions → Secrets).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CALL_PROVIDER = (Deno.env.get('CALL_PROVIDER') || 'mock').toLowerCase();
const SMSRU_API_ID = Deno.env.get('SMSRU_API_ID') || '';
const LOGIN_DOMAIN = 'phone.patrikipab.ru';     // служебная почта для входа в профиль с другого устройства

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* ---------------- общее ---------------- */
let secretsCache: Record<string, string> | null = null;
async function secrets() {
  if (secretsCache) return secretsCache;
  const { data } = await db.from('app_secrets').select('key,value').in('key', ['telegram_bot_token', 'telegram_webhook_secret', 'telegram_chat_id']);
  secretsCache = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return secretsCache;
}
async function tg(method: string, body: Record<string, unknown>) {
  const { telegram_bot_token: t } = await secrets();
  if (!t) throw new Error('Бот не настроен');
  const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
// чат вида "-100123/4" → chat_id + тема
async function tgToChat(chat: string, text: string) {
  const [chat_id, thread] = chat.split('/');
  return tg('sendMessage', { chat_id, text, ...(thread ? { message_thread_id: Number(thread) } : {}) });
}
const digits = (s: string) => String(s || '').replace(/\D/g, '');
// российский номер → 11 цифр 7XXXXXXXXXX
function ruPhone(s: string) {
  let d = digits(s);
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length === 11 && d[0] === '7' ? d : '';
}
const pretty = (p: string) => `+7 (${p.slice(1, 4)}) ${p.slice(4, 7)}-${p.slice(7, 9)}-${p.slice(9, 11)}`;
async function sha(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function guest(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data } = token ? await db.auth.getUser(token) : { data: null };
  if (!data?.user) throw new Error('Нет сессии — перезапустите приложение');
  return data.user;
}

// Привязать подтверждённый номер к гостю.
// Если номер уже есть у другого профиля — переносим накопленное туда и выдаём одноразовый ключ входа в него.
async function applyPhone(userId: string, phone: string): Promise<{ status: 'done' | 'login'; login_hash?: string }> {
  const { data: owner } = await db.rpc('find_user_by_phone', { p_phone: phone });
  if (!owner || owner === userId) {
    const { error } = await db.auth.admin.updateUserById(userId, { phone, phone_confirm: true });
    if (error) throw error;
    return { status: 'done' };
  }
  await db.rpc('merge_guest', { p_from: userId, p_to: owner });
  const email = `${phone}@${LOGIN_DOMAIN}`;
  const { data: u } = await db.auth.admin.getUserById(owner);
  if (u?.user && u.user.email !== email) await db.auth.admin.updateUserById(owner, { email, email_confirm: true });
  const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  return { status: 'login', login_hash: link.properties.hashed_token };
}

/* ---------------- 1. Telegram ---------------- */
async function tgStart(req: Request) {
  const u = await guest(req);
  await db.rpc('verify_cleanup');
  const { data, error } = await db.from('phone_links').insert({ user_id: u.id }).select('token').single();
  if (error) throw error;
  const me = await tg('getMe', {});
  const bot = me?.result?.username;
  if (!bot) throw new Error('Бот не настроен');
  return { token: data.token, url: `https://t.me/${bot}?start=${data.token}`, bot };
}

async function tgStatus(req: Request, body: any) {
  const u = await guest(req);
  const { data } = await db.from('phone_links').select('*').eq('token', body.token).eq('user_id', u.id).maybeSingle();
  if (!data) return { status: 'failed', message: 'Заявка не найдена' };
  if (data.status === 'pending' && Date.now() - new Date(data.created_at).getTime() > 30 * 60 * 1000) return { status: 'failed', message: 'Время вышло, начните заново' };
  return { status: data.status, phone: data.phone, login_hash: data.login_hash, message: data.message };
}

async function tgWebhook(update: any) {
  const m = update.message;
  if (!m || m.chat?.type !== 'private') return;              // группы с заказами бот не обрабатывает
  const chat = m.chat.id;
  const text: string = m.text || '';

  if (text.startsWith('/start')) {
    const payload = text.split(/\s+/)[1] || '';
    if (/^[0-9a-f-]{36}$/i.test(payload)) {
      const { data: link } = await db.from('phone_links').update({ chat_id: chat }).eq('token', payload).eq('status', 'pending').select('token').maybeSingle();
      if (link) {
        await tg('sendMessage', {
          chat_id: chat,
          text: 'Подтверждение номера для приложения «Патрики Паб».\n\nНажмите кнопку ниже 👇 — Telegram передаст ваш номер, вводить ничего не нужно.',
          reply_markup: { keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
        });
        return;
      }
      await tg('sendMessage', { chat_id: chat, text: 'Ссылка устарела. Вернитесь в приложение и нажмите «Подтвердить через Telegram» ещё раз.' });
      return;
    }
    await tg('sendMessage', { chat_id: chat, text: 'Привет! Это бот паба «Патрики». Здесь подтверждается номер телефона для приложения доставки: откройте приложение → Профиль → «Подтвердить номер» → «Через Telegram».' });
    return;
  }

  if (m.contact) {
    if (m.contact.user_id !== m.from?.id) {
      await tg('sendMessage', { chat_id: chat, text: 'Нужно отправить свой номер — кнопкой «📱 Поделиться номером», а не чужой контакт.' });
      return;
    }
    const { data: link } = await db.from('phone_links').select('*').eq('chat_id', chat).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const off = { reply_markup: { remove_keyboard: true } };
    if (!link) { await tg('sendMessage', { chat_id: chat, text: 'Не нашли заявку. Вернитесь в приложение и начните подтверждение заново.', ...off }); return; }
    const phone = ruPhone(m.contact.phone_number);
    if (!phone) {
      await db.from('phone_links').update({ status: 'failed', message: 'Пока принимаем только российские номера +7' }).eq('token', link.token);
      await tg('sendMessage', { chat_id: chat, text: 'Пока принимаем только российские номера +7.', ...off });
      return;
    }
    try {
      const r = await applyPhone(link.user_id, phone);
      await db.from('phone_links').update({ status: r.status, phone, login_hash: r.login_hash || null }).eq('token', link.token);
      await tg('sendMessage', { chat_id: chat, text: `✅ Номер ${pretty(phone)} подтверждён.\nВернитесь в приложение «Патрики Паб» — всё уже готово.`, ...off });
    } catch (e) {
      console.error(e);
      await db.from('phone_links').update({ status: 'failed', message: 'Не удалось подтвердить, попробуйте позже' }).eq('token', link.token);
      await tg('sendMessage', { chat_id: chat, text: 'Не получилось подтвердить номер. Попробуйте ещё раз чуть позже.', ...off });
    }
    return;
  }

  await tg('sendMessage', { chat_id: chat, text: 'Я умею только подтверждать номер для приложения. Заказать доставку — в приложении «Патрики Паб».' });
}

/* ---------------- 2. Звонок-сброс ---------------- */
async function callStart(req: Request, body: any) {
  const u = await guest(req);
  const phone = ruPhone(body.phone);
  if (!phone) throw new Error('Введите номер полностью: +7 (XXX) XXX-XX-XX');
  await db.rpc('verify_cleanup');
  const minuteAgo = new Date(Date.now() - 30_000).toISOString();
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count: recentUser } = await db.from('phone_calls').select('id', { count: 'exact', head: true }).eq('user_id', u.id).gte('created_at', minuteAgo);
  if (recentUser) throw new Error('Подождите 30 секунд перед повторной попыткой');
  const { count: perHour } = await db.from('phone_calls').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', hourAgo);
  if ((perHour || 0) >= 5) throw new Error('Слишком много попыток для этого номера. Попробуйте через час');

  // channel: 'call' — звонок-сброс (код = последние 4 цифры номера), 'sms' — код в SMS
  const channel = body.channel === 'sms' ? 'sms' : 'call';
  let code = '';
  if (CALL_PROVIDER === 'smsru' && channel === 'call') {
    if (!SMSRU_API_ID) throw new Error('Звонок не настроен');
    const r = await fetch(`https://sms.ru/code/call?phone=${phone}&ip=-1&api_id=${encodeURIComponent(SMSRU_API_ID)}&json=1`);
    const d = await r.json().catch(() => ({}));
    if (d.status !== 'OK' || !d.code) { console.error('sms.ru', d); throw new Error('Не удалось позвонить. Попробуйте получить код в SMS'); }
    code = String(d.code).slice(-4);
  } else if (CALL_PROVIDER === 'smsru' && channel === 'sms') {
    if (!SMSRU_API_ID) throw new Error('SMS не настроены');
    code = String(Math.floor(1000 + Math.random() * 9000));
    const msg = encodeURIComponent(`Патрики Паб: код ${code}. Никому его не сообщайте.`);
    const r = await fetch(`https://sms.ru/sms/send?api_id=${encodeURIComponent(SMSRU_API_ID)}&to=${phone}&msg=${msg}&json=1`);
    const d = await r.json().catch(() => ({}));
    const st = d?.sms?.[phone]?.status;
    if (d.status !== 'OK' || st !== 'OK') { console.error('sms.ru sms', d); throw new Error('Не удалось отправить SMS. Попробуйте позже'); }
  } else {
    // тестовый режим: звонка нет, код видит управляющий (админка и тема «Все заказы»)
    code = String(Math.floor(1000 + Math.random() * 9000));
    await db.from('sms_outbox').insert({ phone, otp: code });
    const { telegram_chat_id: c } = await secrets();
    if (c) await tgToChat(c, `${channel === 'sms' ? '✉️ Тест SMS' : '☎️ Тест звонка'}: код для ${pretty(phone)} — ${code}`).catch(() => {});
  }
  await db.from('phone_calls').insert({ user_id: u.id, phone, code_hash: await sha(phone + ':' + code), expires_at: new Date(Date.now() + 5 * 60_000).toISOString() });
  return { ok: true, provider: CALL_PROVIDER, channel, ...(CALL_PROVIDER === 'mock' ? { test: true } : {}) };
}

async function callCheck(req: Request, body: any) {
  const u = await guest(req);
  const phone = ruPhone(body.phone);
  const code = digits(body.code).slice(-4);
  const { data: c } = await db.from('phone_calls').select('*').eq('user_id', u.id).eq('phone', phone)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!c) throw new Error('Сначала запросите звонок');
  if (new Date(c.expires_at).getTime() < Date.now()) throw new Error('Код устарел, запросите звонок ещё раз');
  if (c.attempts >= 5) throw new Error('Слишком много попыток, запросите звонок ещё раз');
  if (c.code_hash !== await sha(phone + ':' + code)) {
    await db.from('phone_calls').update({ attempts: c.attempts + 1 }).eq('id', c.id);
    throw new Error('Неверный код. Для звонка — это последние 4 цифры номера, с которого звонили; для SMS — код из сообщения');
  }
  await db.from('phone_calls').delete().eq('id', c.id);
  return { phone, ...(await applyPhone(u.id, phone)) };
}

/* ---------------- маршрутизация ---------------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const hook = req.headers.get('x-telegram-bot-api-secret-token');
    if (hook !== null) {
      const { telegram_webhook_secret: s } = await secrets();
      if (!s || hook !== s) return new Response('forbidden', { status: 403 });
      await tgWebhook(await req.json());
      return new Response('ok');
    }
    const body = await req.json();
    switch (body.action) {
      case 'tg-start': return json(await tgStart(req));
      case 'tg-status': return json(await tgStatus(req, body));
      case 'call-start': return json(await callStart(req, body));
      case 'call-check': return json(await callCheck(req, body));
      case 'ping': return json({ ok: true, call: CALL_PROVIDER });
      default: return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 400);
  }
});
