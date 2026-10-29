// Слой данных: Supabase (боевой режим) или localStorage (демо-режим).
import { CONFIG, isDemo } from './config.js';
import { SEED_CATEGORIES, SEED_ITEMS, SEED_VENUES } from './seed.js';

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
const demoInit = () => {
  if (!LS.get('categories')) LS.set('categories', SEED_CATEGORIES);
  if (!LS.get('items')) LS.set('items', SEED_ITEMS);
  if (!LS.get('venues')) LS.set('venues', SEED_VENUES);
  if (!LS.get('orders')) LS.set('orders', []);
};
const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

/* ---------------- общий API ---------------- */
export const store = {
  demo: isDemo(),

  async init() {
    if (this.demo) { demoInit(); return; }
    // Библиотеку кладёт внутрь приложения сборка в GitHub (www/vendor), CDN — запасной вариант
    const createClient = await loadSupabase();
    sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true } });
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
      const rec = {
        ...order, items: lines, id: uid(), number: 1000 + orders.length + 1, status: 'new',
        subtotal, delivery_fee: venue.delivery_fee || 0, total: subtotal + (venue.delivery_fee || 0),
        created_at: new Date().toISOString(),
      };
      orders.unshift(rec);
      LS.set('orders', orders);
      return { id: rec.id, number: rec.number, total: rec.total };
    }
    const { data, error } = await sb.rpc('place_order', { p_order: order });
    if (error) throw error;
    return data;
  },

  async getOrderStatus(id) {
    if (this.demo) { const o = LS.get('orders', []).find((x) => x.id === id); return o ? { status: o.status, number: o.number } : null; }
    const { data, error } = await sb.rpc('order_status', { p_id: id });
    if (error) throw error;
    return data;
  },

  /* ---------------- управляющий ---------------- */
  async adminSignIn(email, password) {
    if (this.demo) {
      if (password !== CONFIG.DEMO_ADMIN_PASSWORD) throw new Error('Неверный пароль');
      sessionStorage.setItem('patriki.admin', '1');
      return true;
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Неверный email или пароль');
    const { data: ok, error: e2 } = await sb.rpc('is_admin');
    if (e2 || !ok) { await sb.auth.signOut(); throw new Error('У этой учётной записи нет прав управляющего'); }
    return true;
  },

  async adminSignOut() {
    if (this.demo) { sessionStorage.removeItem('patriki.admin'); return; }
    await sb.auth.signOut();
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
    if (this.demo) return LS.get('orders', []).slice(0, 100);
    const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data;
  },

  async setOrderStatus(id, status) {
    if (this.demo) {
      const os = LS.get('orders', []); const o = os.find((x) => x.id === id);
      if (o) o.status = status; LS.set('orders', os); return;
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
