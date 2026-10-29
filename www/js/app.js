import { store } from './store.js';
import { CONFIG } from './config.js';
import { HERO_IMG } from './seed.js';
import { logoMark, logoEmblem } from './logo.js';
import { renderAdmin } from './admin.js';

/* ---------- утилиты ---------- */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rub = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/,/g, ' ')} ₽`;
const keep = {
  get(k, d) { try { const v = localStorage.getItem('patriki.ui.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('patriki.ui.' + k, JSON.stringify(v)); } catch { /* недоступно */ } },
};
export function toast(msg, ms = 2200) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
const icon = {
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  menu: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  bag: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 7h14l-1.5 12h-11z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
  card: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></svg>',
  info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  phone: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
};
const photo = (url, cls = '', alt = '') => url
  ? `<div class="photo ph ${cls}"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" onerror="this.remove()"></div>`
  : `<div class="photo ph ${cls}" aria-hidden="true"></div>`;

/* ---------- состояние ---------- */
const S = {
  categories: [], items: [], venues: [],
  venueId: keep.get('venue', 'petrogradka'),
  cart: keep.get('cart', {}),
  customer: keep.get('customer', { name: '', phone: '', address: '', flat: '', comment: '' }),
  orders: keep.get('orders', []),
  checkout: { when: 'asap', time: '', payment: 'card' },
  infoTaps: [],
};
const venue = () => S.venues.find((v) => v.id === S.venueId) || S.venues[0] || {};
const itemById = (id) => S.items.find((x) => x.id === id);
const cartLines = () => Object.entries(S.cart)
  .map(([id, qty]) => ({ item: itemById(id), qty }))
  .filter((l) => l.item && l.item.available !== false && l.qty > 0);
const cartCount = () => cartLines().reduce((s, l) => s + l.qty, 0);
const cartSum = () => cartLines().reduce((s, l) => s + l.qty * l.item.price, 0);
function setQty(id, qty) {
  if (qty <= 0) delete S.cart[id]; else S.cart[id] = Math.min(qty, 50);
  keep.set('cart', S.cart);
}

/* ---------- маршрутизация ---------- */
const app = document.getElementById('app');
const route = () => (location.hash.replace(/^#/, '') || '/');

async function render() {
  const r = route();
  app.classList.toggle('wide', r.startsWith('/admin'));
  if (r.startsWith('/admin')) { await renderAdmin(app, { reloadMenu, esc, rub, toast, photo }); return; }
  let html = '';
  if (r === '/') html = Home();
  else if (r === '/menu') html = Menu();
  else if (r === '/cart') html = Cart();
  else if (r === '/checkout') html = Checkout();
  else if (r.startsWith('/order/')) html = OrderStatus(r.split('/')[2]);
  else if (r === '/card') html = GuestCard();
  else if (r === '/info') html = Info();
  else html = Home();
  app.innerHTML = html + TabBar(r) + CartBar(r);
  app.classList.toggle('has-cartbar', !!CartBar(r));
  if (r.startsWith('/order/')) pollOrder(r.split('/')[2]);
}

function TabBar(r) {
  const tab = (href, label, ic, active, extra = '') => `<a href="#${href}" ${active ? 'aria-current="page"' : ''}>${ic}${label}${extra}</a>`;
  const n = cartCount();
  return `<nav class="tabbar" aria-label="Разделы">
    ${tab('/', 'Главная', icon.home, r === '/' || r === '/info')}
    ${tab('/menu', 'Меню', icon.menu, r === '/menu')}
    ${tab('/cart', 'Корзина', icon.bag, r === '/cart' || r === '/checkout', n ? `<span class="badge">${n}</span>` : '')}
    ${tab('/card', 'Карта', icon.card, r === '/card')}
  </nav>`;
}
function CartBar(r) {
  if (r !== '/menu' || !cartCount()) return '';
  return `<a class="cartbar" href="#/cart"><span class="row"><span class="count">${cartCount()}</span>Корзина</span><span class="price">${rub(cartSum())}</span></a>`;
}

function VenueSwitch() {
  return `<div class="seg" role="group" aria-label="Откуда доставка">
    ${S.venues.map((v) => `<button type="button" data-act="venue" data-id="${esc(v.id)}" aria-pressed="${v.id === S.venueId}">
      <span>${esc(v.name)}</span><small>${esc(v.address)}</small></button>`).join('')}
  </div>`;
}

/* ---------- экраны ---------- */
function Home() {
  const v = venue();
  const hits = S.items.filter((x) => x.popular && x.available !== false).slice(0, 8);
  return `<main class="screen">
    <header class="between">
      <div class="brand">${logoMark(48)}<div><div class="brand-name">ПАТРИКИ ПАБ</div><div class="brand-sub">САНКТ-ПЕТЕРБУРГ</div></div></div>
      <a class="icon-btn" href="#/info" aria-label="Информация">${icon.info}</a>
    </header>
    ${VenueSwitch()}
    <section class="hero photo ph">
      <img src="${HERO_IMG}" alt="" onerror="this.remove()">
      <div class="hero-cap">
        <span class="eyebrow accent">Доставка из паба · ${esc(v.hours || '')}</span>
        <h1 class="hero-title">МЯСО ИЗ СМОКЕРА<br>ПРЯМО К ДВЕРИ</h1>
        <div class="between">
          <span style="font-size:13px;color:var(--text-2)">${v.accepting === false ? 'Скоро открытие' : `${esc(v.zone || '')} · ~${esc(v.eta_minutes || 45)} мин`}</span>
          <a class="btn btn-accent btn-sm" href="#/menu">В меню</a>
        </div>
      </div>
    </section>
    <a class="card card-link between" href="#/card">
      <div class="stack" style="gap:4px"><span class="eyebrow">Карта гостя</span><span style="font-size:15px;font-weight:600">Баллы за заказы и визиты</span></div>
      <span class="row muted" style="font-size:13px">Открыть ${icon.chev}</span>
    </a>
    ${hits.length ? `<section class="stack" style="gap:12px">
      <div class="between"><h2 class="h2">Хиты паба</h2><a href="#/menu" style="font-size:13px;text-decoration:none">Всё меню</a></div>
      <div class="hscroll">${hits.map((x) => `<button type="button" class="mini" data-act="open" data-id="${esc(x.id)}">
        ${photo(x.image_url, '', x.name)}<span class="mini-name">${esc(x.name)}</span><span class="price" style="font-size:16px">${rub(x.price)}</span></button>`).join('')}</div>
    </section>` : ''}
  </main>`;
}

function Menu() {
  const cats = S.categories.filter((c) => S.items.some((x) => x.category_id === c.id));
  return `<main class="screen" style="gap:0">
    <div class="between" style="padding-bottom:6px"><h1 class="h1">Меню</h1><span class="muted" style="font-size:13px">${esc(venue().name || '')}</span></div>
    <nav class="chips" aria-label="Категории">${cats.map((c, i) => `<button type="button" class="chip" data-act="jump" data-id="${esc(c.id)}" ${i === 0 ? 'aria-current="true"' : ''}>${esc(c.name)}</button>`).join('')}</nav>
    <div class="stack" style="gap:28px;padding-top:18px">
    ${cats.map((c) => `<section class="cat-block" id="cat-${esc(c.id)}" data-cat="${esc(c.id)}">
      <h2 class="eyebrow accent" style="margin:0">${esc(c.name)}</h2>
      ${S.items.filter((x) => x.category_id === c.id).map(Dish).join('')}
    </section>`).join('')}
    </div>
  </main>`;
}

function Dish(x) {
  const off = x.available === false;
  const q = S.cart[x.id] || 0;
  const desc = [x.weight, x.description].filter(Boolean).join(' · ');
  return `<article class="dish ${off ? 'off' : ''}">
    <button type="button" data-act="open" data-id="${esc(x.id)}" style="padding:0;border:none;background:none" aria-label="Подробнее: ${esc(x.name)}">${photo(x.image_url, '', '')}</button>
    <div class="dish-body">
      <span class="dish-name">${esc(x.name)}</span>
      ${desc ? `<span class="dish-desc">${esc(desc)}</span>` : ''}
      <div class="dish-foot">
        <span class="price">${rub(x.price)}</span>
        ${off ? '<span class="muted" style="font-size:12px">Нет в наличии</span>' : Stepper(x.id, q)}
      </div>
    </div>
  </article>`;
}
const Stepper = (id, q) => q > 0
  ? `<span class="qty"><button type="button" data-act="dec" data-id="${esc(id)}" aria-label="Убрать одну">−</button><span aria-live="polite">${q}</span><button type="button" data-act="inc" data-id="${esc(id)}" aria-label="Добавить ещё">+</button></span>`
  : `<button type="button" class="add" data-act="inc" data-id="${esc(id)}" aria-label="В корзину">+</button>`;

function Cart() {
  const lines = cartLines();
  if (!lines.length) return `<main class="screen"><h1 class="h1">Корзина</h1>
    <div class="empty">${icon.bag}<span>Пока пусто. Загляните в меню — там брискет и крылья из смокера.</span><a class="btn btn-accent" href="#/menu">Открыть меню</a></div></main>`;
  const v = venue();
  return `<main class="screen">
    <h1 class="h1">Корзина</h1>
    ${VenueSwitch()}
    <div class="stack" style="gap:0">
      ${lines.map(({ item: x, qty }) => `<div class="dish">
        ${photo(x.image_url, '', '')}
        <div class="dish-body"><span class="dish-name">${esc(x.name)}</span>
          <div class="dish-foot"><span class="price">${rub(x.price * qty)}</span>${Stepper(x.id, qty)}</div></div>
      </div>`).join('')}
    </div>
    <div class="stack">
      <div class="sum-row"><span>Блюда</span><span>${rub(cartSum())}</span></div>
      <div class="sum-row"><span>Доставка</span><span>${v.delivery_fee ? rub(v.delivery_fee) : 'бесплатно'}</span></div>
      <div class="total"><span class="h2">Итого</span><b>${rub(cartSum() + (v.delivery_fee || 0))}</b></div>
    </div>
    ${v.min_order && cartSum() < v.min_order ? `<p class="error" style="margin:0">Минимальный заказ — ${rub(v.min_order)}. Добавьте ещё на ${rub(v.min_order - cartSum())}.</p>` : ''}
    ${v.accepting === false ? `<p class="error" style="margin:0">${esc(v.name)}: приём заказов скоро откроется.</p>` : ''}
    <a class="btn btn-accent btn-block" href="#/checkout" ${canOrder() ? '' : 'aria-disabled="true" style="opacity:.45;pointer-events:none"'}>Оформить заказ</a>
  </main>`;
}
const canOrder = () => cartCount() > 0 && venue().accepting !== false && !(venue().min_order && cartSum() < venue().min_order);

function Checkout() {
  if (!canOrder()) { setTimeout(() => (location.hash = '#/cart')); return ''; }
  const c = S.customer, k = S.checkout, v = venue();
  return `<main class="screen">
    <div class="row"><a class="icon-btn" href="#/cart" aria-label="Назад в корзину">${icon.back}</a><h1 class="h1" style="font-size:26px">Оформление</h1></div>
    <form id="checkout" class="stack" style="gap:18px" novalidate>
      <div class="stack">
        <span class="eyebrow">Доставка · ${esc(v.zone || v.name)}</span>
        <label class="field">Имя<input class="input" name="name" autocomplete="name" required value="${esc(c.name)}"></label>
        <label class="field">Телефон<input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="+7 900 000-00-00" value="${esc(c.phone)}"></label>
        <label class="field">Адрес<input class="input" name="address" autocomplete="street-address" required placeholder="Улица, дом" value="${esc(c.address)}"></label>
        <label class="field">Квартира, подъезд, этаж<input class="input" name="flat" value="${esc(c.flat)}"></label>
        <label class="field">Комментарий<textarea class="textarea" name="comment" placeholder="Домофон, приборы, пожелания">${esc(c.comment)}</textarea></label>
      </div>
      <div class="stack">
        <span class="eyebrow">Когда</span>
        <div class="grid-2">
          <button type="button" class="opt" data-act="when" data-v="asap" aria-pressed="${k.when === 'asap'}">Как можно скорее</button>
          <button type="button" class="opt" data-act="when" data-v="time" aria-pressed="${k.when === 'time'}">Ко времени</button>
        </div>
        ${k.when === 'time' ? `<label class="field">Время доставки<input class="input" name="time" type="time" value="${esc(k.time)}" required></label>` : ''}
      </div>
      <div class="stack">
        <span class="eyebrow">Оплата при получении</span>
        <div class="grid-2">
          <button type="button" class="opt" data-act="pay" data-v="card" aria-pressed="${k.payment === 'card'}">Картой курьеру</button>
          <button type="button" class="opt" data-act="pay" data-v="cash" aria-pressed="${k.payment === 'cash'}">Наличными</button>
        </div>
      </div>
      <div class="card stack">
        <div class="sum-row"><span>Блюда (${cartCount()})</span><span>${rub(cartSum())}</span></div>
        <div class="sum-row"><span>Доставка</span><span>${v.delivery_fee ? rub(v.delivery_fee) : 'бесплатно'}</span></div>
        <div class="total"><span class="h2">Итого</span><b>${rub(cartSum() + (v.delivery_fee || 0))}</b></div>
      </div>
      <p class="muted" style="font-size:12px;margin:0;line-height:1.5">Нажимая «Отправить заказ», вы соглашаетесь на обработку имени, телефона и адреса для доставки. Мы перезвоним для подтверждения.</p>
      <p id="co-err" class="error" role="alert" style="margin:0"></p>
      <button class="btn btn-accent btn-block" type="submit">Отправить заказ · ${rub(cartSum() + (v.delivery_fee || 0))}</button>
    </form>
  </main>`;
}

const STATUS = [
  ['new', 'Заказ принят'], ['cooking', 'Готовим'], ['delivering', 'Курьер в пути'], ['done', 'Доставлен'],
];
function OrderStatus(id) {
  const o = S.orders.find((x) => x.id === id) || { id, number: '…', status: 'new' };
  const idx = Math.max(0, STATUS.findIndex(([k]) => k === o.status));
  return `<main class="screen">
    <h1 class="h1">Заказ №${esc(o.number)}</h1>
    ${o.status === 'cancelled'
      ? `<div class="card"><span class="error">Заказ отменён. Если это ошибка — позвоните нам.</span></div>`
      : `<div class="card status-steps" aria-live="polite">${STATUS.map(([k, label], i) => `<div class="step ${i <= idx ? 'done' : ''}"><span class="dot"></span>${label}</div>`).join('')}</div>`}
    <p class="muted" style="margin:0;line-height:1.5">Мы перезвоним для подтверждения. Статус обновляется сам.</p>
    <a class="btn btn-ghost btn-block" href="tel:${esc((venue().phone || '').replace(/[^+\d]/g, ''))}">${icon.phone}Позвонить в паб</a>
    <a class="btn btn-accent btn-block" href="#/menu">Вернуться в меню</a>
  </main>`;
}
let pollTimer = null;
function pollOrder(id) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (route() !== '/order/' + id) return;
    try {
      const s = await store.getOrderStatus(id);
      const o = S.orders.find((x) => x.id === id);
      if (s && o && s.status !== o.status) { o.status = s.status; keep.set('orders', S.orders); render(); return; }
    } catch { /* сеть */ }
    pollOrder(id);
  }, 15000);
}

function GuestCard() {
  const last = S.orders[0];
  return `<main class="screen">
    <h1 class="h1">Карта гостя</h1>
    <div class="guest-card">
      <div class="between"><div class="stack" style="gap:4px"><span style="font-family:var(--display);font-weight:700;font-size:18px;letter-spacing:2px">ПАТРИКИ ПАБ</span><span class="eyebrow">Программа лояльности</span></div>${logoMark(44)}</div>
      <span style="font-size:15px;line-height:1.5">Скоро здесь будет баланс баллов — тот же, что на вашей карте в Wallet. Копите в зале и в доставке, списывайте при заказе.</span>
    </div>
    <div class="card stack">
      <span class="eyebrow">Уже есть карта в Wallet?</span>
      <span style="font-size:14px;line-height:1.5;color:var(--text-2)">Покажите её бармену в зале, а в заказе доставки укажите тот же номер телефона — баллы начислим.</span>
    </div>
    ${last ? `<a class="card card-link between" href="#/order/${esc(last.id)}"><div class="stack" style="gap:4px"><span class="eyebrow">Последний заказ</span><span style="font-weight:600">№${esc(last.number)} · ${rub(last.total)}</span></div>${icon.chev}</a>` : ''}
  </main>`;
}

function Info() {
  return `<main class="screen">
    <div class="row"><a class="icon-btn" href="#/" aria-label="На главную">${icon.back}</a><h1 class="h1" style="font-size:26px">Информация</h1></div>
    <div style="display:flex;justify-content:center;color:var(--text);padding:8px 0">${logoEmblem(220)}</div>
    ${S.venues.map((v) => `<section class="card stack">
      <div class="between"><span class="h2" style="font-size:18px">${esc(v.name)}</span>${v.accepting === false ? '<span class="status-pill">скоро</span>' : ''}</div>
      <span style="color:var(--text-2)">${esc(v.address)}</span>
      <span class="muted" style="font-size:13px">Ежедневно ${esc(v.hours)} · доставка: ${esc(v.zone)}</span>
      ${v.phone ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(v.phone.replace(/[^+\d]/g, ''))}" style="align-self:flex-start">${icon.phone}${esc(v.phone)}</a>` : ''}
    </section>`).join('')}
    <section class="card stack">
      <span class="eyebrow">О доставке</span>
      <span style="font-size:14px;line-height:1.6;color:var(--text-2)">Доставляем еду и безалкогольные напитки. Алкоголь по закону продаётся только в зале. Оплата картой или наличными курьеру.</span>
    </section>
    <footer class="info-foot">
      © 2026 «<span data-act="secret">Патрики</span> Паб» · Санкт-Петербург<br>версия ${esc(CONFIG.APP_VERSION)}${store.demo ? ' · демо' : ''}
    </footer>
  </main>`;
}

/* ---------- лист с блюдом ---------- */
function openItem(id) {
  const x = itemById(id); if (!x) return;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  const draw = () => {
    const q = S.cart[x.id] || 0;
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(x.name)}">
      <span class="grab"></span>
      ${photo(x.image_url, '', x.name)}
      <div class="stack" style="gap:6px"><h2 class="h2" style="text-transform:none;font-size:24px;letter-spacing:.3px">${esc(x.name)}</h2>
        ${x.weight ? `<span class="muted">${esc(x.weight)}</span>` : ''}
        ${x.description ? `<span style="color:var(--text-2);line-height:1.5">${esc(x.description)}</span>` : ''}</div>
      <div class="between"><span class="price" style="font-size:26px">${rub(x.price)}</span>
        ${x.available === false ? '<span class="muted">Нет в наличии</span>' : Stepper(x.id, q)}</div>
      <button type="button" class="btn btn-ghost btn-block" data-close>Закрыть</button>
    </div>`;
  };
  draw();
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) { wrap.remove(); render(); return; }
    const b = e.target.closest('[data-act]');
    if (b?.dataset.act === 'inc') { setQty(x.id, (S.cart[x.id] || 0) + 1); draw(); }
    if (b?.dataset.act === 'dec') { setQty(x.id, (S.cart[x.id] || 0) - 1); draw(); }
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { wrap.remove(); render(); document.removeEventListener('keydown', onKey); }
  });
  document.body.appendChild(wrap);
  wrap.querySelector('[data-close]').focus();
}

/* ---------- события ---------- */
app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const { act, id, v } = b.dataset;
  if (act === 'venue') { S.venueId = id; keep.set('venue', id); render(); }
  if (act === 'inc' || act === 'dec') {
    setQty(id, (S.cart[id] || 0) + (act === 'inc' ? 1 : -1));
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }
  if (act === 'open') openItem(id);
  if (act === 'jump') {
    document.getElementById('cat-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    app.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-current', String(c === b)));
  }
  if (act === 'when') { saveForm(); S.checkout.when = v; render(); }
  if (act === 'pay') { saveForm(); S.checkout.payment = v; render(); }
  if (act === 'secret') {
    const now = Date.now();
    S.infoTaps = [...S.infoTaps.filter((t) => now - t < 3000), now];
    if (S.infoTaps.length >= CONFIG.ADMIN_TAPS) { S.infoTaps = []; location.hash = '#/admin'; }
  }
});

function saveForm() {
  const f = document.getElementById('checkout'); if (!f) return;
  const d = Object.fromEntries(new FormData(f));
  S.customer = { name: d.name || '', phone: d.phone || '', address: d.address || '', flat: d.flat || '', comment: d.comment || '' };
  if (d.time !== undefined) S.checkout.time = d.time;
  keep.set('customer', S.customer);
}

app.addEventListener('submit', async (e) => {
  if (e.target.id !== 'checkout') return;
  e.preventDefault();
  saveForm();
  const c = S.customer, k = S.checkout, err = document.getElementById('co-err');
  const digits = c.phone.replace(/\D/g, '');
  if (!c.name.trim()) return (err.textContent = 'Укажите имя');
  if (digits.length < 10 || digits.length > 12) return (err.textContent = 'Проверьте номер телефона');
  if (!c.address.trim()) return (err.textContent = 'Укажите адрес доставки');
  if (k.when === 'time' && !k.time) return (err.textContent = 'Выберите время доставки');
  const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Отправляем…';
  try {
    const res = await store.placeOrder({
      venue_id: S.venueId,
      customer_name: c.name.trim(), phone: c.phone.trim(),
      address: [c.address.trim(), c.flat.trim()].filter(Boolean).join(', '),
      comment: c.comment.trim(),
      when_text: k.when === 'asap' ? 'Как можно скорее' : `К ${k.time}`,
      payment: k.payment,
      items: cartLines().map(({ item, qty }) => ({ item_id: item.id, name: item.name, price: item.price, qty })),
    });
    S.orders.unshift({ id: res.id, number: res.number, total: res.total, status: 'new', at: Date.now() });
    S.orders = S.orders.slice(0, 20); keep.set('orders', S.orders);
    S.cart = {}; keep.set('cart', S.cart);
    location.hash = '#/order/' + res.id;
  } catch (ex) {
    console.error(ex);
    err.textContent = 'Не получилось отправить заказ. Проверьте интернет или позвоните нам.';
    btn.disabled = false; btn.textContent = 'Отправить заказ';
  }
});

// Подсветка категории при прокрутке меню
let spyRaf = 0;
window.addEventListener('scroll', () => {
  if (route() !== '/menu') return;
  cancelAnimationFrame(spyRaf);
  spyRaf = requestAnimationFrame(() => {
    const blocks = [...document.querySelectorAll('.cat-block')];
    const cur = blocks.filter((b) => b.getBoundingClientRect().top < 120).pop() || blocks[0];
    if (!cur) return;
    document.querySelectorAll('.chip').forEach((c) => {
      const on = c.dataset.id === cur.dataset.cat;
      if (on && c.getAttribute('aria-current') !== 'true') c.scrollIntoView({ inline: 'center', block: 'nearest' });
      c.setAttribute('aria-current', String(on));
    });
  });
}, { passive: true });

/* ---------- запуск ---------- */
export async function reloadMenu() {
  const m = await store.getMenu();
  S.categories = m.categories; S.items = m.items; S.venues = m.venues;
  if (!S.venues.find((v) => v.id === S.venueId) && S.venues[0]) S.venueId = S.venues[0].id;
}

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

(async () => {
  try {
    await store.init();
    await reloadMenu();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<main class="screen"><div class="empty">Не удалось загрузить меню. Проверьте интернет и откройте приложение снова.<button class="btn btn-accent" onclick="location.reload()">Обновить</button></div></main>`;
    return;
  }
  render();
})();

// В Android-приложении (Capacitor) файлы уже лежат внутри APK — service worker не нужен
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
