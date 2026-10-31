// Слой данных: Supabase (боевой режим) или localStorage (демо-режим).
import { CONFIG, isDemo } from './config.js';
import { SEED_CATEGORIES, SEED_ITEMS, SEED_VENUES } from './seed.js';
import { tierFor, otp, DEFAULT_SETTINGS } from './loyalty.js';

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
let sb = null;

function loadSupabase() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/supabase.js', import.meta.url).href;
    s.onload = () => (window.supabase?.createClient ? resolve(window.supabase.createClient) : reject(new Error('vendor')));
    s.onerror = () => reject(new Error('vendor'));
    document.head.appendChild(s);
  }).catch(async () => (await import(SUPABASE_CDN)).createClient);
}

/* ---------------- демо-режим ---------------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('patriki.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('patriki.' + k, JSON.stringify(v)); } catch { /* память недоступна */ } },
};
// ---- демо-лояльность (в браузере) ----
const demoLoy = {
  st: () => ({ ...DEFAULT_SETTINGS, ...LS.get('loy_settings', {}) }),
  acc() {
    let a = LS.get('loy_acc', null);
    if (!a) { a = { card_no: String(10000000 + Math.floor(Math.random() * 89999999)), secret: uid().replace(/-/g, ''), balance: 0, spent: 0 }; LS.set('loy_acc', a); }
    return a;
  },
  verified: () => !!LS.get('me', {}).verified,
  tx(t) {
    const a = this.acc(); a.balance += t.points; if (t.kind === 'accrue') a.spent += t.amount; LS.set('loy_acc', a);
    const h = LS.get('loy_tx', []); h.unshift({ ...t, created_at: new Date().toISOString() }); LS.set('loy_tx', h.slice(0, 50));
  },
  add(amount, source, note, venue) {
    const st = this.st(); if (!st.enabled || amount <= 0 || (st.verified_only && !this.verified())) return 0;
    const t = tierFor(st.tiers, this.acc().spent); const pts = Math.floor(amount * t.pct / 100);
    this.tx({ kind: 'accrue', points: pts, amount, pct: t.pct, source, note, venue }); return pts;
  },
  my() {
    const a = this.acc(), st = this.st();
    return { card_no: a.card_no, secret: a.secret, balance: a.balance, spent: a.spent, tier: tierFor(st.tiers, a.spent), verified: this.verified(), history: LS.get('loy_tx', []), settings: st };
  },
  onStatus(o) {
    const st = this.st();
    if (o.status === 'done' && st.app_enabled && !o.loy_done) {
      const base = o.subtotal - (o.points_redeemed || 0) + (st.accrue_delivery ? o.delivery_fee || 0 : 0);
      if (base >= Math.max(st.app_min_order, 1)) this.add(base, 'app', `Заказ №${o.number}`); o.loy_done = true;
    }
    if (o.status === 'cancelled' && o.points_redeemed && !o.loy_refund) { this.tx({ kind: 'refund', points: o.points_redeemed, amount: 0, source: 'app', note: `Возврат баллов: заказ №${o.number} отменён` }); o.loy_refund = true; }
  },
  find(code) {
    const a = this.acc(), s = String(code || '').trim();
    if (s.startsWith('PK1:')) { const [, card, c] = s.split(':'); if (card !== a.card_no) return null; const w = Math.floor(Date.now() / 30000); if (![w, w - 1, w - 2, w + 1].some((x) => otp(a.secret, x) === c)) throw new Error('QR-код устарел — попросите гостя открыть карту заново'); return a; }
    const d = s.replace(/\D/g, ''); const me = LS.get('me', {});
    if (d === a.card_no || (d.length >= 10 && me.phone && me.phone.slice(-10) === d.slice(-10))) return a;
    return null;
  },
  info() { const a = this.acc(), st = this.st(), p = LS.get('profile', {}), me = LS.get('me', {});
    return { card_no: a.card_no, name: p.name || 'Гость', phone_last4: (me.phone || '').slice(-4), balance: a.balance, tier: tierFor(st.tiers, a.spent), max_redeem_pct: st.max_redeem_pct, active: st.enabled && (!st.verified_only || this.verified()) }; },
  lookup(code) { if (!this.find(code)) throw new Error('Гость не найден'); return { ...this.info(), code }; },
  check(code, amount, redeem, venue, note) {
    if (!this.find(code)) throw new Error('Гость не найден');
    const st = this.st(), a = this.acc(); redeem = Math.max(0, redeem | 0);
    if (!st.enabled || !st.venue_enabled) throw new Error('Начисление в заведении выключено в настройках');
    if (st.verified_only && !this.verified()) throw new Error('У гостя не подтверждён номер — баллы не копятся');
    if (!(amount > 0)) throw new Error('Укажите сумму чека');
    if (redeem > a.balance) throw new Error(`У гостя только ${a.balance} баллов`);
    if (redeem > Math.floor(amount * st.max_redeem_pct / 100)) throw new Error(`Баллами можно оплатить не больше ${st.max_redeem_pct}% чека`);
    if (redeem) this.tx({ kind: 'redeem', points: -redeem, amount, source: 'venue', note, venue });
    const pts = this.add(amount - redeem, 'venue', note, venue);
    return { points: pts, redeemed: redeem, ...this.info() };
  },
};

const demoInit = () => {
  if (!LS.get('categories')) LS.set('categories', SEED_CATEGORIES);
  if (!LS.get('items')) LS.set('items', SEED_ITEMS);
  if (!LS.get('venues')) LS.set('venues', SEED_VENUES);
  if (!LS.get('orders')) LS.set('orders', []);
};
const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);

// Имитация функции sber для демо-режима (логика та же, что на сервере)
function demoSber(b) {
  const os = LS.get('orders', []); const o = os.find((x) => x.id === b.order_id);
  const save = () => LS.set('orders', os);
  if (b.action === 'ping') return { ok: true, mode: 'mock' };
  if (!o) throw new Error('Заказ не найден');
  if (b.action === 'create') {
    if (o.payment !== 'online') throw new Error('Заказ не для онлайн-оплаты');
    o.payment_status = 'pending'; save();
    return { formUrl: `${b.return_base}#/pay-test/${o.id}`, mode: 'mock' };
  }
  if (b.action === 'status') return { payment_status: o.payment_status, status: o.status, number: o.number };
  if (b.action === 'mock-pay') { if (o.payment_status === 'pending') o.payment_status = b.result === 'ok' ? 'held' : 'failed'; save(); return { payment_status: o.payment_status }; }
  if (b.action === 'capture') { if (o.payment_status !== 'held' && o.payment_status !== 'paid') throw new Error('Деньги не заблокированы — списать нельзя'); o.payment_status = 'paid'; save(); return { payment_status: 'paid' }; }
  if (b.action === 'cancel') { o.payment_status = o.payment_status === 'held' ? 'cancelled' : o.payment_status === 'paid' ? 'refunded' : o.payment_status; save(); return { payment_status: o.payment_status }; }
  throw new Error('unknown');
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

/* ---------------- общий API ---------------- */
export const store = {
  demo: isDemo(),

  async init() {
    if (this.demo) { demoInit(); return; }
    // Библиотеку кладёт внутрь приложения сборка в GitHub (www/vendor), CDN — запасной вариант
    const createClient = await loadSupabase();
    sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, storageKey: 'patriki-auth' } });
    await this.ensureGuest();
  },

  // Каждый гость сразу получает профиль (анонимный, без регистрации).
  // Если анонимный вход в Supabase выключен — приложение просто работает без профиля.
  async ensureGuest() {
    if (this.demo) return true;
    const { data } = await sb.auth.getSession();
    if (data.session) return true;
    const { error } = await sb.auth.signInAnonymously();
    this.guestOff = !!error;
    if (error) console.warn('Анонимный вход недоступен:', error.message);
    return !error;
  },

  async getMenu() {
    if (this.demo) {
      return {
        categories: LS.get('categories', []).sort(bySort),
        items: LS.get('items', []).sort(bySort),
        venues: LS.get('venues', []).sort(bySort),
      };
    }
    const [c, i, v] = await Promise.all([
      sb.from('categories').select('*').order('sort'),
      sb.from('items').select('*').order('sort'),
      sb.from('venues').select('*').order('sort'),
    ]);
    for (const r of [c, i, v]) if (r.error) throw r.error;
    return { categories: c.data, items: i.data, venues: v.data };
  },

  // Заказ: сервер сам пересчитывает цены по меню, чтобы их нельзя было подменить.
  async placeOrder(order) {
    if (this.demo) {
      const items = LS.get('items', []);
      const venue = LS.get('venues', []).find((v) => v.id === order.venue_id) || {};
      const lines = order.items.map((l) => {
        const src = items.find((x) => x.id === l.item_id);
        return { item_id: l.item_id, name: src?.name ?? l.name, price: src?.price ?? l.price, qty: l.qty };
      });
      const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
      const orders = LS.get('orders', []);
      const me = LS.get('me', { verified: false, phone: '' });
      if (order.payment === 'online' && !venue.pay_online) throw new Error('Онлайн-оплата недоступна');
      const red = Math.max(0, order.redeem | 0);
      if (red) { const a = demoLoy.acc(); if (red > a.balance) throw new Error('Недостаточно баллов'); }
      const rec = {
        ...order, items: lines, id: uid(), number: 1000 + orders.length + 1, status: 'new', user_id: 'demo-user',
        payment_status: order.payment === 'online' ? 'pending' : 'none',
        phone_verified: me.verified && order.phone.replace(/\D/g, '').slice(-10) === me.phone.slice(-10),
        subtotal, delivery_fee: venue.delivery_fee || 0, total: subtotal + (venue.delivery_fee || 0) - red, points_redeemed: red,
        created_at: new Date().toISOString(),
      };
      orders.unshift(rec);
      LS.set('orders', orders);
      if (red) demoLoy.tx({ kind: 'redeem', points: -red, amount: subtotal, source: 'app', note: `Оплата заказа №${rec.number}` });
      return { id: rec.id, number: rec.number, total: rec.total };
    }
    const { data, error } = await sb.rpc('place_order', { p_order: order });
    if (error) throw error;
    return data;
  },

  /* ---------------- онлайн-оплата (Сбер) ---------------- */
  // Вызов серверной функции sber. В демо-режиме — имитация прямо в браузере.
  async sberCall(body) {
    if (this.demo) return demoSber(body);
    const { data, error } = await sb.functions.invoke('sber', { body });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* нет тела */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  },
  // Начать оплату: вернёт адрес платёжной страницы Сбера (или тестовой страницы)
  startPayment(orderId, returnBase) { return this.sberCall({ action: 'create', order_id: orderId, return_base: returnBase }); },
  paymentStatus(orderId) { return this.sberCall({ action: 'status', order_id: orderId }); },
  mockPay(orderId, result) { return this.sberCall({ action: 'mock-pay', order_id: orderId, result }); },
  capturePayment(orderId) { return this.sberCall({ action: 'capture', order_id: orderId }); },
  cancelPayment(orderId) { return this.sberCall({ action: 'cancel', order_id: orderId }); },

  async getOrderStatus(id) {
    if (this.demo) { const o = LS.get('orders', []).find((x) => x.id === id); return o ? { status: o.status, number: o.number, payment: o.payment, payment_status: o.payment_status, total: o.total } : null; }
    const { data, error } = await sb.rpc('order_status', { p_id: id });
    if (error) throw error;
    return data;
  },

  /* ---------------- профиль гостя ---------------- */
  // Кто сейчас в приложении: { id, phone ('79…' если подтверждён), verified }
  async me() {
    if (this.demo) {
      const d = LS.get('me', { id: 'demo-user', phone: '', verified: false });
      return d;
    }
    if (this.guestOff) return null;
    const { data } = await sb.auth.getUser();
    const u = data?.user;
    if (!u) return null;
    return { id: u.id, phone: u.phone || '', verified: !!(u.phone && u.phone_confirmed_at), anonymous: !!u.is_anonymous };
  },

  async getProfile() {
    const empty = { name: '', phone: '', birthday: null, pd_consent_version: null, marketing_consent: false };
    if (this.demo) return { ...empty, ...LS.get('profile', {}) };
    const me = await this.me(); if (!me) return empty;
    const { data } = await sb.from('profiles').select('*').eq('id', me.id).maybeSingle();
    return { ...empty, ...(data || {}) };
  },

  // Согласия: kind = 'pd' (обработка персональных данных) или 'marketing' (рекламные рассылки).
  // Сервер пишет журнал согласий: кто, когда, какая редакция.
  async recordConsent(kind, granted, version, source) {
    if (this.demo) {
      const p = LS.get('profile', {});
      if (kind === 'pd') { p.pd_consent_version = granted ? version : null; p.pd_consent_at = granted ? new Date().toISOString() : null; }
      else { p.marketing_consent = granted; p.marketing_consent_at = new Date().toISOString(); }
      LS.set('profile', p);
      const log = LS.get('consent_log', []); log.unshift({ kind, granted, version, source, created_at: new Date().toISOString() }); LS.set('consent_log', log.slice(0, 50));
      return;
    }
    if (!(await this.me())) return;
    const { error } = await sb.rpc('record_consent', { p_kind: kind, p_granted: granted, p_version: version, p_source: source });
    if (error) throw error;
  },

  // Удалить профиль: профиль, адреса и коды входа стираются, в заказах — имя, телефон и адрес.
  async deleteAccount() {
    if (this.demo) {
      const os = LS.get('orders', []);
      if (os.some((o) => o.user_id === 'demo-user' && ['new', 'cooking', 'delivering'].includes(o.status) && !(o.payment === 'online' && ['pending', 'failed'].includes(o.payment_status)))) throw new Error('ACTIVE_ORDER');
      LS.set('orders', os.map((o) => (o.user_id === 'demo-user' ? { ...o, user_id: null, customer_name: 'Профиль удалён', phone: '', address: 'удалено', comment: '' } : o)));
      LS.set('me', { id: 'demo-user', phone: '', verified: false });
      LS.set('profile', {}); LS.set('addresses', []);
      return;
    }
    const { error } = await sb.rpc('delete_my_account');
    if (error) throw new Error(/ACTIVE_ORDER/.test(error.message) ? 'ACTIVE_ORDER' : error.message);
    await sb.auth.signOut();
    await this.ensureGuest();
  },

  async saveProfile(p) {
    const row = { name: (p.name || '').trim(), phone: p.phone || '', birthday: p.birthday || null };
    if (this.demo) { const all = { ...LS.get('profile', {}), ...row }; LS.set('profile', all); return { ...p, ...all }; }
    const me = await this.me(); if (!me) return { ...p, ...row };
    const { error } = await sb.from('profiles').upsert({ id: me.id, ...row, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { ...p, ...row };
  },

  async listAddresses() {
    if (this.demo) return LS.get('addresses', []).sort((a, b) => (b.last_used_at || '').localeCompare(a.last_used_at || ''));
    if (!(await this.me())) return [];
    const { data, error } = await sb.from('addresses').select('*').order('last_used_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async saveAddress(a) {
    const row = {
      label: a.label || '', street: (a.street || '').trim(), flat: a.flat || '', entrance: a.entrance || '',
      floor: a.floor || '', intercom: a.intercom || '', comment: a.comment || '', last_used_at: new Date().toISOString(),
    };
    if (this.demo) {
      const list = LS.get('addresses', []);
      if (a.id) { const i = list.findIndex((x) => x.id === a.id); list[i] = { ...list[i], ...row }; }
      else list.push({ id: uid(), ...row });
      LS.set('addresses', list); return;
    }
    if (!(await this.me())) return;
    const q = a.id ? sb.from('addresses').update(row).eq('id', a.id) : sb.from('addresses').insert(row);
    const { error } = await q;
    if (error) throw error;
  },

  async touchAddress(id) {
    const at = new Date().toISOString();
    if (this.demo) { const l = LS.get('addresses', []); const x = l.find((y) => y.id === id); if (x) x.last_used_at = at; LS.set('addresses', l); return; }
    await sb.from('addresses').update({ last_used_at: at }).eq('id', id);
  },

  async deleteAddress(id) {
    if (this.demo) { LS.set('addresses', LS.get('addresses', []).filter((x) => x.id !== id)); return; }
    const { error } = await sb.from('addresses').delete().eq('id', id);
    if (error) throw error;
  },

  async myOrders() {
    if (this.demo) return LS.get('orders', []).filter((o) => o.user_id === 'demo-user').slice(0, 50);
    const me = await this.me(); if (!me) return [];
    const { data, error } = await sb.from('orders').select('*').eq('user_id', me.id).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return data;
  },

  /* ---------------- бронирование столов ---------------- */
  async placeReservation(r) {
    if (this.demo) {
      const v = LS.get('venues', []).find((x) => x.id === r.venue_id) || {};
      const dep = (v.booking_deposit || 0) * r.guests;
      const list = LS.get('reservations', []);
      const row = { id: uid(), number: 501 + list.length, user_id: 'demo-user', status: 'new', deposit: dep, payment_status: dep ? 'pending' : 'none', created_at: new Date().toISOString(), comment: '', ...r };
      list.unshift(row); LS.set('reservations', list);
      return { id: row.id, number: row.number, deposit: dep, status: 'new', payment_status: row.payment_status };
    }
    await this.ensureGuest();
    const { data, error } = await sb.rpc('place_reservation', { p: r });
    if (error) throw new Error(error.message);
    return data;
  },
  async myReservations() {
    if (this.demo) return LS.get('reservations', []).filter((x) => x.user_id === 'demo-user');
    const me = await this.me(); if (!me) return [];
    const { data, error } = await sb.from('reservations').select('*').eq('user_id', me.id).order('starts_at', { ascending: false }).limit(30);
    if (error) throw error;
    return data;
  },
  async cancelReservation(id) {
    if (this.demo) { const l = LS.get('reservations', []); const x = l.find((y) => y.id === id); if (x) x.status = 'cancelled'; LS.set('reservations', l); return; }
    const { error } = await sb.rpc('cancel_reservation', { p_id: id });
    if (error) throw new Error(error.message);
  },
  async listReservations() {
    if (this.demo) return LS.get('reservations', []);
    const since = new Date(Date.now() - 12 * 3600e3).toISOString();
    const { data, error } = await sb.from('reservations').select('*').gte('starts_at', since).order('starts_at').limit(200);
    if (error) throw error;
    return data;
  },
  async setReservationStatus(id, status, note = '') {
    if (this.demo) { const l = LS.get('reservations', []); const x = l.find((y) => y.id === id); if (x) { x.status = status; if (note) x.staff_note = note; } LS.set('reservations', l); return; }
    const { error } = await sb.rpc('set_reservation_status', { p_id: id, p_status: status, p_note: note });
    if (error) throw new Error(error.message);
  },

  /* ---------------- подтверждение номера: Telegram-бот или звонок ---------------- */
  async verifyCall(body) {
    const { data, error } = await sb.functions.invoke('verify', { body });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* нет тела */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  },
  // 1) Telegram: { token, url } — открыть url, затем опрашивать tgStatus
  async tgStart() {
    if (this.demo) { LS.set('demo_tg', { token: uid(), at: Date.now() }); return { ...LS.get('demo_tg'), url: 'https://t.me/PatrikiPubBot', demo: true }; }
    return this.verifyCall({ action: 'tg-start' });
  },
  async tgStatus(token) {
    if (this.demo) {
      const d = LS.get('demo_tg', {});
      if (d.token !== token) return { status: 'failed' };
      if (Date.now() - d.at < 4000) return { status: 'pending' };
      LS.set('me', { id: 'demo-user', phone: '79990000000', verified: true });
      return { status: 'done', phone: '79990000000' };
    }
    return this.verifyCall({ action: 'tg-status', token });
  },
  // 2) Звонок-сброс: код — последние 4 цифры входящего номера
  async callStart(phone10, channel = 'call') {
    if (this.demo) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      LS.set('demo_code', { phone: '7' + phone10, code });
      const out = LS.get('sms_outbox', []); out.unshift({ phone: '7' + phone10, otp: code, created_at: new Date().toISOString() }); LS.set('sms_outbox', out.slice(0, 20));
      return { ok: true, test: true, demoCode: code };
    }
    return this.verifyCall({ action: 'call-start', phone: '7' + phone10, channel });
  },
  async callCheck(phone10, code) {
    if (this.demo) {
      const d = LS.get('demo_code', {});
      if (d.phone !== '7' + phone10 || d.code !== String(code).trim()) throw new Error('Неверный код — это последние 4 цифры номера, с которого звонили');
      LS.set('me', { id: 'demo-user', phone: '7' + phone10, verified: true });
      return { status: 'done', phone: '7' + phone10 };
    }
    return this.verifyCall({ action: 'call-check', phone: '7' + phone10, code });
  },
  // 3) Гость звонит сам: { id, number } — показать номер, гость звонит, опрашиваем inCheck
  async inStart(phone10) {
    if (this.demo) { LS.set('demo_in', { id: uid(), phone: '7' + phone10, at: Date.now() }); return { ...LS.get('demo_in'), number: '78000000000', timeout: 120, test: true }; }
    return this.verifyCall({ action: 'in-start', phone: '7' + phone10 });
  },
  async inCheck(id, called = false) {
    if (this.demo) {
      const d = LS.get('demo_in', {});
      if (d.id !== id) return { status: 'failed', message: 'Заявка не найдена' };
      if (!called || Date.now() - d.at < 4000) return { status: 'pending' };
      LS.set('me', { id: 'demo-user', phone: d.phone, verified: true });
      return { status: 'done', phone: d.phone };
    }
    return this.verifyCall({ action: 'in-check', id, called });
  },
  // номер уже был у другого профиля — входим в него одноразовым ключом
  async applyLogin(hash) {
    if (this.demo || !hash) return;
    const { error } = await sb.auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
    if (error) throw new Error('Не удалось войти в профиль, попробуйте ещё раз');
  },
  async refreshUser() { if (!this.demo) await sb.auth.refreshSession(); },

  // Выйти из профиля гостя: дальше он снова анонимный гость на этом устройстве
  async guestSignOut() {
    if (this.demo) { LS.set('me', { id: 'demo-user', phone: '', verified: false }); return; }
    await sb.auth.signOut();
    await this.ensureGuest();
  },

  async listSmsCodes() {
    if (this.demo) return LS.get('sms_outbox', []);
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data } = await sb.from('sms_outbox').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(20);
    return data || [];
  },

  /* ---------------- карта гостя (лояльность) ---------------- */
  async myLoyalty() {
    if (this.demo) return demoLoy.my();
    const { data, error } = await sb.rpc('my_loyalty');
    if (error) throw error;
    return data;
  },
  async loyaltySettings() {
    if (this.demo) return { ...DEFAULT_SETTINGS, ...LS.get('loy_settings', {}) };
    const { data, error } = await sb.from('loyalty_settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    return { ...DEFAULT_SETTINGS, ...(data || {}) };
  },
  async saveLoyaltySettings(st) {
    const row = { ...st }; delete row.id; delete row.updated_at;
    if (this.demo) { LS.set('loy_settings', row); return row; }
    const { error } = await sb.from('loyalty_settings').update({ ...row, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) throw error;
    return row;
  },
  async loyaltyStats() {
    if (this.demo) { const a = demoLoy.acc(); return { guests: a.spent ? 1 : 0, balance: a.balance, accrued_30: 0, redeemed_30: 0 }; }
    const { data } = await sb.rpc('loyalty_stats');
    return data || {};
  },
  // касса: найти гостя по QR / номеру карты / телефону и провести чек
  async staffLookup(code) {
    if (this.demo) return demoLoy.lookup(code);
    const { data, error } = await sb.rpc('staff_lookup', { p_code: code });
    if (error) throw new Error(error.message);
    return data;
  },
  async setFixedLevel(code, level) {
    if (this.demo) { const a = demoLoy.acc(); a.fixed_level = level || null; LS.set('loy_acc', a); return demoLoy.info(); }
    const { data, error } = await sb.rpc('set_fixed_level', { p_code: code, p_level: level || '' });
    if (error) throw new Error(error.message);
    return data;
  },
  async staffAccrue(code, amount, redeem, venueId, note = '') {
    if (this.demo) return demoLoy.check(code, amount, redeem, venueId, note);
    const { data, error } = await sb.rpc('staff_accrue', { p_code: code, p_amount: amount, p_redeem: redeem, p_venue: venueId, p_note: note });
    if (error) throw new Error(error.message);
    return data;
  },

  /* ---------------- управляющий ---------------- */
  // demoVenue — только для демо: войти как управляющий конкретного заведения ('' = владелец)
  async adminSignIn(email, password, demoVenue = '') {
    if (this.demo) {
      if (password !== CONFIG.DEMO_ADMIN_PASSWORD) throw new Error('Неверный пароль');
      sessionStorage.setItem('patriki.admin', '1');
      sessionStorage.setItem('patriki.adminVenue', demoVenue);
      return true;
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Неверный email или пароль');
    const { data: ok, error: e2 } = await sb.rpc('is_admin');
    if (e2 || !ok) { await sb.auth.signOut(); throw new Error('У этой учётной записи нет прав управляющего'); }
    return true;
  },

  async adminSignOut() {
    if (this.demo) { sessionStorage.removeItem('patriki.admin'); sessionStorage.removeItem('patriki.adminVenue'); return; }
    await sb.auth.signOut();
    await this.ensureGuest();
  },

  // Кто я: { venue_id: null|'petrogradka'|…, owner: true|false }
  async myAdmin() {
    if (this.demo) { const v = sessionStorage.getItem('patriki.adminVenue') || null; return { venue_id: v, owner: !v, name: '' }; }
    const { data, error } = await sb.rpc('my_admin');
    if (error) throw error;
    return data || { venue_id: null, owner: true };
  },

  // Стоп-лист конкретного заведения
  async setStop(itemId, venueId, stopped) {
    if (this.demo) {
      const items = LS.get('items', []); const x = items.find((i) => i.id === itemId);
      const cur = new Set(x.stop_in || []); stopped ? cur.add(venueId) : cur.delete(venueId); x.stop_in = [...cur];
      LS.set('items', items); return x.stop_in;
    }
    const { data, error } = await sb.rpc('set_stop', { p_item: itemId, p_venue: venueId, p_stopped: stopped });
    if (error) throw error;
    return data;
  },

  // Передать новый заказ в другое заведение
  async transferOrder(id, toVenue) {
    if (this.demo) {
      const os = LS.get('orders', []); const o = os.find((x) => x.id === id);
      const from = LS.get('venues', []).find((v) => v.id === o.venue_id)?.name || o.venue_id;
      o.transferred_from = o.venue_id; o.venue_id = toVenue; o.comment = (`⇄ Передан из «${from}». ` + (o.comment || '')).trim();
      LS.set('orders', os); return;
    }
    const { error } = await sb.rpc('transfer_order', { p_id: id, p_to: toVenue });
    if (error) throw error;
  },

  async isAdmin() {
    if (this.demo) return sessionStorage.getItem('patriki.admin') === '1';
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return false;
    const { data } = await sb.rpc('is_admin');
    return !!data;
  },

  async saveItem(item) {
    if (this.demo) {
      const items = LS.get('items', []);
      if (!item.id) { item.id = uid(); item.sort = items.length + 1; items.push(item); }
      else { const i = items.findIndex((x) => x.id === item.id); items[i] = { ...items[i], ...item }; }
      LS.set('items', items); return item;
    }
    const { id, ...row } = item;
    const q = id ? sb.from('items').update(row).eq('id', id) : sb.from('items').insert(row);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  },

  async deleteItem(id) {
    if (this.demo) { LS.set('items', LS.get('items', []).filter((x) => x.id !== id)); return; }
    const { error } = await sb.from('items').delete().eq('id', id);
    if (error) throw error;
  },

  async saveCategory(cat) {
    if (this.demo) {
      const cats = LS.get('categories', []);
      if (!cat.id) { cat.id = uid(); cat.sort = cats.length + 1; cats.push(cat); }
      else { const i = cats.findIndex((x) => x.id === cat.id); cats[i] = { ...cats[i], ...cat }; }
      LS.set('categories', cats); return cat;
    }
    const { id, ...row } = cat;
    const q = id ? sb.from('categories').update(row).eq('id', id) : sb.from('categories').insert({ id: uid(), ...row });
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  },

  async deleteCategory(id) {
    if (this.demo) {
      LS.set('categories', LS.get('categories', []).filter((x) => x.id !== id));
      LS.set('items', LS.get('items', []).filter((x) => x.category_id !== id));
      return;
    }
    const { error } = await sb.from('categories').delete().eq('id', id);
    if (error) throw error;
  },

  async saveVenue(v) {
    if (this.demo) {
      const vs = LS.get('venues', []); const i = vs.findIndex((x) => x.id === v.id);
      vs[i] = { ...vs[i], ...v }; LS.set('venues', vs); return vs[i];
    }
    const { data, error } = await sb.from('venues').update(v).eq('id', v.id).select().single();
    if (error) throw error;
    return data;
  },

  async listOrders() {
    if (this.demo) { const v = sessionStorage.getItem('patriki.adminVenue'); return LS.get('orders', []).filter((o) => !v || o.venue_id === v).slice(0, 100); }
    const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data;
  },

  async setOrderStatus(id, status) {
    if (this.demo) {
      const os = LS.get('orders', []); const o = os.find((x) => x.id === id);
      if (o) { o.status = status; demoLoy.onStatus(o); } LS.set('orders', os); return;
    }
    const { error } = await sb.from('orders').update({ status }).eq('id', id);
    if (error) throw error;
  },

  // Подписка на новые заказы. Возвращает функцию отписки.
  onOrdersChange(cb) {
    if (this.demo) {
      let last = JSON.stringify(LS.get('orders', []).map((o) => o.id + o.status));
      const t = setInterval(() => {
        const now = JSON.stringify(LS.get('orders', []).map((o) => o.id + o.status));
        if (now !== last) { last = now; cb(); }
      }, 3000);
      return () => clearInterval(t);
    }
    const ch = sb.channel('orders-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => cb())
      .subscribe();
    return () => sb.removeChannel(ch);
  },

  async uploadImage(file) {
    if (this.demo) {
      // В демо фото хранится прямо в браузере
      return await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
      });
    }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `items/${uid()}.${ext}`;
    const { error } = await sb.storage.from('menu').upload(path, file, { cacheControl: '31536000', upsert: false });
    if (error) throw error;
    return sb.storage.from('menu').getPublicUrl(path).data.publicUrl;
  },
};
