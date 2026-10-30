import { store } from './store.js';
import { CONFIG } from './config.js';
import { HERO_IMG } from './seed.js';
import { logoMark, logoEmblem, bulldogLoader } from './logo.js';
import { renderAdmin } from './admin.js';

/* ---------- утилиты ---------- */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rub = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/,/g, ' ')} ₽`;
const keep = {
  get(k, d) { try { const v = localStorage.getItem('patriki.ui.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('patriki.ui.' + k, JSON.stringify(v)); } catch { /* недоступно */ } },
};
export function toast(msg, ms = 2400) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}

/* ---------- телефон: всегда +7 (XXX) XXX-XX-XX ---------- */
// 10 цифр после +7 из любой строки («8 911…», «+7 (911)…», «911…»)
export function phone10(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length > 10 && /^[78]/.test(d)) d = d.slice(1);
  return d.slice(0, 10);
}
export function fmtPhone(s) {
  const d = phone10(s);
  if (!d) return '';
  let r = '+7 (' + d.slice(0, 3);
  if (d.length >= 3) r += ') ' + d.slice(3, 6);
  if (d.length >= 6) r += '-' + d.slice(6, 8);
  if (d.length >= 8) r += '-' + d.slice(8, 10);
  return r;
}
const PHONE_PH = '+7 (___) ___-__-__';
// Маска для всех полей с атрибутом data-phone (работает и в админке)
document.addEventListener('focusin', (e) => {
  const el = e.target; if (!el.matches?.('input[data-phone]')) return;
  if (!el.value) el.value = '+7 (';
  el.dataset.prev = phone10(el.value);
});
document.addEventListener('focusout', (e) => {
  const el = e.target; if (!el.matches?.('input[data-phone]')) return;
  if (!phone10(el.value)) el.value = '';
});
document.addEventListener('input', (e) => {
  const el = e.target; if (!el.matches?.('input[data-phone]')) return;
  const raw = el.value;
  let d = raw.replace(/\D/g, '');
  if (raw.startsWith('+7')) d = d.slice(1);                         // префикс +7 уже в поле
  if (d.length > 10 && /^[78]/.test(d)) d = d.slice(1);             // вставили «8 911…» или «+7 911…» поверх префикса
  d = d.slice(0, 10);
  // стёрли скобку или тире — стираем и цифру перед ними, иначе курсор «застревает»
  if (e.inputType === 'deleteContentBackward' && d === el.dataset.prev) d = d.slice(0, -1);
  el.dataset.prev = d;
  el.value = d ? fmtPhone(d) : '+7 (';
});

const icon = {
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  menu: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  bag: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 7h14l-1.5 12h-11z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
  user: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  card: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></svg>',
  clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pin: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  id: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.5 16a3.5 3.5 0 0 1 7 0M14 10h4M14 13h3"/></svg>',
  info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  phone: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
};
const photo = (url, cls = '', alt = '') => url
  ? `<div class="photo ph ${cls}"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" onerror="this.remove()"></div>`
  : `<div class="photo ph ${cls}" aria-hidden="true"></div>`;
const backBtn = (href, label = 'Назад') => `<a class="icon-btn" href="#${href}" aria-label="${label}">${icon.back}</a>`;

/* ---------- состояние ---------- */
const S = {
  categories: [], items: [], venues: [],
  venueId: keep.get('venue', 'petrogradka'),
  cart: keep.get('cart', {}),
  orders: keep.get('orders', []),                 // заказы с этого устройства (для экрана статуса)
  me: null,                                       // { id, phone, verified }
  profile: { name: '', phone: '', birthday: null },
  addresses: [],
  history: null,                                  // история заказов из базы
  checkout: { when: 'asap', time: '', payment: 'card', noCall: false, addr: null, comment: '' },
  draftAddr: { street: '', flat: '', entrance: '', floor: '', intercom: '', label: '', save: true },
  draftContact: null,                             // { name, phone } пока заполняют форму
  verify: { step: 'phone', phone: '', ctx: null, until: 0, back: '/profile' },
  infoTaps: [],
};
const venue = () => S.venues.find((v) => v.id === S.venueId) || S.venues[0] || {};
const itemById = (id) => S.items.find((x) => x.id === id);
// блюдо доступно: в продаже и не в стоп-листе выбранного заведения
const onSale = (x) => x && x.available !== false && !(x.stop_in || []).includes(S.venueId);
const cartLines = () => Object.entries(S.cart)
  .map(([id, qty]) => ({ item: itemById(id), qty }))
  .filter((l) => onSale(l.item) && l.qty > 0);
const cartCount = () => cartLines().reduce((s, l) => s + l.qty, 0);
const cartSum = () => cartLines().reduce((s, l) => s + l.qty * l.item.price, 0);
function setQty(id, qty) {
  if (qty <= 0) delete S.cart[id]; else S.cart[id] = Math.min(qty, 50);
  keep.set('cart', S.cart);
}
const addrLine = (a) => [a.street, a.flat && `кв. ${a.flat}`, a.entrance && `под. ${a.entrance}`, a.floor && `эт. ${a.floor}`, a.intercom && `домофон ${a.intercom}`].filter(Boolean).join(', ');
const verified = () => !!S.me?.verified;

/* ---------- согласия (152-ФЗ, 38-ФЗ) ---------- */
const CV = CONFIG.LEGAL.CONSENT_VERSION;
const hasPdConsent = () => S.profile.pd_consent_version === CV || keep.get('pdConsent', '') === CV;
const doc = (hash, text) => `<a href="legal/#${hash}" target="_blank" rel="noopener">${text}</a>`;
// Галочка согласия: не отмечена заранее, без неё заказ и вход не отправляются.
// Если гость уже дал согласие этой редакции — галочку не показываем.
const ConsentBox = (checked = false) => hasPdConsent() ? '' : `<label class="check consent">
  <input type="checkbox" name="pdConsent" ${checked ? 'checked' : ''}>
  <span>Даю ${doc('consent', 'согласие на обработку персональных данных')} в соответствии с ${doc('privacy', 'Политикой')}</span></label>`;
async function grantPd(source) {
  keep.set('pdConsent', CV);
  if (S.profile.pd_consent_version === CV) return;
  try { await store.recordConsent('pd', true, CV, source); S.profile = { ...S.profile, pd_consent_version: CV }; }
  catch (e) { console.warn('Согласие не записалось', e); }
}

async function loadGuest() {
  try {
    S.me = await store.me();
    S.profile = await store.getProfile();
    S.addresses = await store.listAddresses();
    // перенос имени и телефона из старой версии приложения
    const old = keep.get('customer', null);
    if (old && !S.profile.name && old.name) { S.profile.name = old.name; S.profile.phone = fmtPhone(old.phone); }
  } catch (e) { console.warn('Профиль не загрузился', e); }
}

/* ---------- маршрутизация ---------- */
const app = document.getElementById('app');
const route = () => (location.hash.replace(/^#/, '').split('?')[0] || '/');
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

async function render() {
  const r = route();
  app.classList.toggle('wide', r.startsWith('/admin'));
  if (r.startsWith('/admin')) { await renderAdmin(app, { reloadMenu, esc, rub, toast, photo, fmtPhone }); return; }
  let html = '';
  if (r === '/') html = Home();
  else if (r === '/menu') html = Menu();
  else if (r === '/cart') html = Cart();
  else if (r === '/checkout') html = Checkout();
  else if (r.startsWith('/order/')) html = OrderStatus(r.split('/')[2]);
  else if (r.startsWith('/pay-test/')) { app.innerHTML = PayTest(r.split('/')[2]); return; }
  else if (r === '/profile') html = Profile();
  else if (r === '/profile/orders') html = History();
  else if (r === '/profile/addresses') html = Addresses();
  else if (r === '/profile/me') html = PersonalData();
  else if (r === '/verify') html = Verify();
  else if (r === '/card') html = GuestCard();
  else if (r === '/info') html = Info();
  else html = Home();
  app.innerHTML = html + TabBar(r) + CartBar(r);
  app.classList.toggle('has-cartbar', !!CartBar(r));
  if (r.startsWith('/order/')) pollOrder(r.split('/')[2]);
  if (r === '/profile/orders' && S.history === null) loadHistory();
  if (r === '/verify') tickVerify();
}

function TabBar(r) {
  const tab = (href, label, ic, active, extra = '') => `<a href="#${href}" ${active ? 'aria-current="page"' : ''}>${ic}${label}${extra}</a>`;
  const n = cartCount();
  const inProfile = r.startsWith('/profile') || r === '/verify' || r === '/card';
  return `<nav class="tabbar" aria-label="Разделы">
    ${tab('/', 'Главная', icon.home, r === '/' || r === '/info')}
    ${tab('/menu', 'Меню', icon.menu, r === '/menu')}
    ${tab('/cart', 'Корзина', icon.bag, r === '/cart' || r === '/checkout', n ? `<span class="badge">${n}</span>` : '')}
    ${tab('/profile', 'Профиль', icon.user, inProfile)}
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

/* ---------- главная и меню ---------- */
function Home() {
  const v = venue();
  const hits = S.items.filter((x) => x.popular && onSale(x)).slice(0, 8);
  const hello = S.profile.name ? `Привет, ${esc(S.profile.name.split(' ')[0])}!` : 'САНКТ-ПЕТЕРБУРГ';
  return `<main class="screen">
    <header class="between">
      <div class="brand">${logoMark(48)}<div><div class="brand-name">ПАТРИКИ ПАБ</div><div class="brand-sub">${hello}</div></div></div>
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
    ${S.history?.length || S.orders.length ? `<a class="card card-link between" href="#/profile/orders">
      <div class="stack" style="gap:4px"><span class="eyebrow">Мои заказы</span><span style="font-size:15px;font-weight:600">Повторить прошлый заказ</span></div>
      <span class="row muted">${icon.chev}</span></a>` : `<a class="card card-link between" href="#/card">
      <div class="stack" style="gap:4px"><span class="eyebrow">Карта гостя</span><span style="font-size:15px;font-weight:600">Баллы за заказы и визиты</span></div>
      <span class="row muted" style="font-size:13px">Открыть ${icon.chev}</span></a>`}
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
    <p class="muted" style="font-size:12px;line-height:1.6;margin:0">Состав, пищевая ценность и аллергены — в карточке блюда (нажмите на фото). Фото блюд иллюстративные. Цены указаны в рублях. Алкоголь доставкой не продаётся.</p>
    </div>
  </main>`;
}

function Dish(x) {
  const off = !onSale(x);
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

/* ---------- корзина и оформление ---------- */
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
  const k = S.checkout, v = venue(), d = S.draftAddr;
  if (k.payment === 'online' && !v.pay_online) k.payment = 'card';
  if (!k.payChosen && v.pay_online) k.payment = 'online';          // онлайн по умолчанию, если доступен
  const c = S.draftContact || { name: S.profile.name, phone: S.profile.phone || (S.me?.phone ? fmtPhone(S.me.phone) : '') };
  if (k.addr === null) k.addr = S.addresses[0]?.id || 'new';            // последний использованный адрес
  const isNew = k.addr === 'new' || !S.addresses.find((a) => a.id === k.addr);
  const total = cartSum() + (v.delivery_fee || 0);
  return `<main class="screen">
    <div class="row">${backBtn('/cart', 'Назад в корзину')}<h1 class="h1" style="font-size:26px">Оформление</h1></div>
    <form id="checkout" class="stack" style="gap:20px" novalidate>
      <section class="stack">
        <span class="eyebrow">Откуда везём</span>
        ${VenueSwitch()}
        <span class="muted" style="font-size:13px;line-height:1.5">Заказ получит паб «${esc(v.name)}» — доставка: ${esc(v.zone || '')}. Если адрес в другой зоне, переключите заведение.</span>
      </section>
      <section class="stack">
        <span class="eyebrow">Куда доставить · ${esc(v.zone || v.name)}</span>
        ${S.addresses.length ? `<div class="stack" role="radiogroup" aria-label="Сохранённые адреса">
          ${S.addresses.slice(0, 5).map((a) => `<button type="button" class="addr-opt" role="radio" aria-checked="${k.addr === a.id}" data-act="pick-addr" data-id="${esc(a.id)}">
            <span class="radio-dot" aria-hidden="true"></span>
            <span class="stack" style="gap:2px;text-align:left">${a.label ? `<span class="eyebrow">${esc(a.label)}</span>` : ''}<span>${esc(addrLine(a))}</span></span>
          </button>`).join('')}
          <button type="button" class="addr-opt" role="radio" aria-checked="${isNew}" data-act="pick-addr" data-id="new"><span class="radio-dot" aria-hidden="true"></span><span>Новый адрес</span></button>
        </div>` : ''}
        ${isNew ? `<div class="stack">
          <label class="field">Улица и дом<input class="input" name="street" autocomplete="street-address" required placeholder="Большая Пушкарская, 10" value="${esc(d.street)}"></label>
          <div class="grid-2">
            <label class="field">Квартира / офис<input class="input" name="flat" inputmode="numeric" value="${esc(d.flat)}"></label>
            <label class="field">Подъезд<input class="input" name="entrance" inputmode="numeric" value="${esc(d.entrance)}"></label>
            <label class="field">Этаж<input class="input" name="floor" inputmode="numeric" value="${esc(d.floor)}"></label>
            <label class="field">Домофон<input class="input" name="intercom" value="${esc(d.intercom)}"></label>
          </div>
          ${store.guestOff ? '' : `<label class="check"><input type="checkbox" name="saveAddr" ${d.save ? 'checked' : ''}><span>Запомнить адрес для следующих заказов</span></label>`}
        </div>` : ''}
      </section>
      <section class="stack">
        <span class="eyebrow">Контакты</span>
        <label class="field">Имя<input class="input" name="name" autocomplete="name" required value="${esc(c.name)}"></label>
        <label class="field">Телефон<input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" data-phone required placeholder="${PHONE_PH}" value="${esc(fmtPhone(c.phone))}"></label>
        ${verified() && phone10(c.phone) === phone10(S.me.phone) ? `<span class="ok-note">${icon.check} Номер подтверждён</span>` : ''}
        <label class="check"><input type="checkbox" name="noCall" ${k.noCall ? 'checked' : ''}><span>Не звонить для подтверждения заказа</span></label>
      </section>
      <section class="stack">
        <span class="eyebrow">Когда</span>
        <div class="grid-2">
          <button type="button" class="opt" data-act="when" data-v="asap" aria-pressed="${k.when === 'asap'}">Как можно скорее</button>
          <button type="button" class="opt" data-act="when" data-v="time" aria-pressed="${k.when === 'time'}">Ко времени</button>
        </div>
        ${k.when === 'time' ? `<label class="field">Время доставки<input class="input" name="time" type="time" value="${esc(k.time)}" required></label>` : `<span class="muted" style="font-size:13px">Привезём примерно за ${esc(v.eta_minutes || 45)} мин</span>`}
      </section>
      <section class="stack">
        <span class="eyebrow">Оплата</span>
        ${v.pay_online ? `<button type="button" class="opt opt-wide" data-act="pay" data-v="online" aria-pressed="${k.payment === 'online'}">
          <span class="stack" style="gap:2px;text-align:left"><b>Онлайн сейчас</b><span class="muted" style="font-size:12px">Карта, СБП, SberPay · спишем, когда паб примет заказ</span></span></button>` : ''}
        <div class="grid-2">
          <button type="button" class="opt" data-act="pay" data-v="card" aria-pressed="${k.payment === 'card'}">Картой курьеру</button>
          <button type="button" class="opt" data-act="pay" data-v="cash" aria-pressed="${k.payment === 'cash'}">Наличными</button>
        </div>
      </section>
      <label class="field">Комментарий к заказу<textarea class="textarea" name="comment" placeholder="Приборы, пожелания">${esc(k.comment)}</textarea></label>
      <div class="card stack">
        <div class="sum-row"><span>Блюда (${cartCount()})</span><span>${rub(cartSum())}</span></div>
        <div class="sum-row"><span>Доставка</span><span>${v.delivery_fee ? rub(v.delivery_fee) : 'бесплатно'}</span></div>
        <div class="total"><span class="h2">К оплате</span><b>${rub(total)}</b></div>
      </div>
      ${ConsentBox(k.pdTick)}
      <p class="muted" style="font-size:12px;margin:0;line-height:1.5">Нажимая «Отправить заказ», вы принимаете условия ${doc('offer', 'публичной оферты')} и ${doc('terms', 'пользовательского соглашения')}.</p>
      <p id="co-err" class="error" role="alert" style="margin:0"></p>
      <button class="btn btn-accent btn-block" type="submit">Отправить заказ · ${rub(total)}</button>
    </form>
  </main>`;
}

function saveCheckoutForm() {
  const f = document.getElementById('checkout'); if (!f) return;
  const d = Object.fromEntries(new FormData(f));
  S.draftContact = { name: d.name || '', phone: d.phone || '' };
  if ('street' in d) S.draftAddr = { ...S.draftAddr, street: d.street || '', flat: d.flat || '', entrance: d.entrance || '', floor: d.floor || '', intercom: d.intercom || '', save: !!d.saveAddr || store.guestOff };
  S.checkout.noCall = !!d.noCall;
  S.checkout.pdTick = !!d.pdConsent;
  S.checkout.comment = d.comment || '';
  if (d.time !== undefined) S.checkout.time = d.time;
}

async function submitCheckout(form) {
  saveCheckoutForm();
  const k = S.checkout, c = S.draftContact, err = document.getElementById('co-err');
  const saved = S.addresses.find((a) => a.id === k.addr);
  const addr = saved || S.draftAddr;
  if (!addr.street?.trim()) return (err.textContent = 'Укажите улицу и дом');
  // защита от ошибки точкой: адрес в Мурино, а выбран паб на Петроградке (и наоборот)
  const where = addrLine(addr).toLowerCase();
  if (S.venueId !== 'murino' && /мурин|девятк/.test(where)) return (err.textContent = 'Похоже, адрес в Мурино — выберите вверху заведение «Мурино»');
  if (S.venueId === 'murino' && !/мурин/.test(where) && /петроград|пушкарск|большой пр|каменноостров|кронверк/.test(where)) return (err.textContent = 'Похоже, адрес на Петроградской стороне — выберите вверху заведение «Петроградка»');
  if (!c.name.trim()) return (err.textContent = 'Укажите имя');
  if (phone10(c.phone).length !== 10) return (err.textContent = 'Введите номер полностью: +7 (XXX) XXX-XX-XX');
  if (k.when === 'time' && !k.time) return (err.textContent = 'Выберите время доставки');
  if (!hasPdConsent() && !k.pdTick) return (err.textContent = 'Отметьте согласие на обработку персональных данных — без него мы не сможем доставить заказ');
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Отправляем…';
  try {
    await grantPd('checkout');
    const comment = [k.noCall ? '⚑ Не звонить для подтверждения' : '', addr.comment || '', k.comment.trim()].filter(Boolean).join('. ');
    const res = await store.placeOrder({
      venue_id: S.venueId,
      customer_name: c.name.trim(), phone: fmtPhone(c.phone),
      address: addrLine(addr), comment,
      when_text: k.when === 'asap' ? 'Как можно скорее' : `К ${k.time}`,
      payment: k.payment,
      pd_consent: CV,
      items: cartLines().map(({ item, qty }) => ({ item_id: item.id, name: item.name, price: item.price, qty })),
    });
    const online = k.payment === 'online';
    S.orders.unshift({ id: res.id, number: res.number, total: res.total, status: 'new', payment: k.payment, payment_status: online ? 'pending' : 'none', at: Date.now() });
    S.orders = S.orders.slice(0, 20); keep.set('orders', S.orders);
    S.cart = {}; keep.set('cart', S.cart);
    // запоминаем гостя: имя, телефон, адрес
    try {
      if (c.name.trim() !== S.profile.name || fmtPhone(c.phone) !== S.profile.phone) {
        S.profile = await store.saveProfile({ ...S.profile, name: c.name, phone: fmtPhone(c.phone) });
      }
      if (saved) await store.touchAddress(saved.id);
      else if (S.draftAddr.save) { await store.saveAddress(S.draftAddr); S.draftAddr = { street: '', flat: '', entrance: '', floor: '', intercom: '', label: '', save: true }; }
      S.addresses = await store.listAddresses();
    } catch (e2) { console.warn('Не сохранили профиль', e2); }
    S.history = null; S.draftContact = null; S.checkout = { ...S.checkout, addr: null, comment: '', noCall: false, pdTick: false };
    location.hash = '#/order/' + res.id;
    if (online) payNow(res.id);                                     // сразу на страницу оплаты
  } catch (ex) {
    console.error(ex);
    err.textContent = 'Не получилось отправить заказ. Проверьте интернет или позвоните нам.';
    btn.disabled = false; btn.textContent = 'Отправить заказ';
  }
}

/* ---------- статус заказа ---------- */
const STATUS = [['new', 'Заказ принят'], ['cooking', 'Готовим'], ['delivering', 'Курьер в пути'], ['done', 'Доставлен']];
const STATUS_RU = { new: 'Принят', cooking: 'Готовим', delivering: 'В пути', done: 'Доставлен', cancelled: 'Отменён' };
function PaymentBlock(o) {
  if (o.payment !== 'online') return '';
  const ps = o.payment_status;
  const box = (cls, title, text, btn = '') => `<div class="card stack pay-box ${cls}" aria-live="polite"><b>${title}</b>${text ? `<span class="muted" style="font-size:13px;line-height:1.5">${text}</span>` : ''}${btn}</div>`;
  const payBtn = (label) => `<button type="button" class="btn btn-accent btn-block" data-act="pay-now" data-id="${esc(o.id)}">${label} · ${rub(o.total)}</button>`;
  if (ps === 'held') return box('ok', '✓ Оплачено', 'Сумма заблокирована на карте. Спишем, когда паб примет заказ. Если заказ отменят — деньги сразу разблокируются.');
  if (ps === 'paid') return box('ok', '✓ Оплачено', 'Деньги списаны. Чек придёт на почту или по SMS.');
  if (ps === 'cancelled') return box('', 'Блокировка снята', 'Деньги снова доступны на карте. Обычно в течение нескольких минут, иногда до нескольких дней — зависит от банка.');
  if (ps === 'refunded') return box('', 'Деньги возвращены', 'Возврат на карту обычно занимает от нескольких минут до 3–5 рабочих дней.');
  if (ps === 'failed') return box('bad', 'Оплата не прошла', 'Попробуйте ещё раз или выберите другую карту.', payBtn('Оплатить снова'));
  return box('wait', 'Ожидаем оплату', 'Заказ уйдёт в паб сразу после оплаты.', payBtn('Оплатить'));
}

// Отправляем гостя на платёжную страницу Сбера
async function payNow(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Открываем оплату…'; }
  try {
    const base = location.origin + location.pathname + location.search;
    const r = await store.startPayment(id, base);
    if (r.formUrl) { location.href = r.formUrl; return; }
    if (r.already) { const o = S.orders.find((x) => x.id === id); if (o) o.payment_status = r.already; render(); }
  } catch (ex) {
    console.error(ex);
    toast('Не удалось открыть оплату: ' + ex.message, 4000);
    if (btn) { btn.disabled = false; btn.textContent = 'Оплатить'; }
  }
}

// Тестовая «платёжная страница» — только пока Сбер в режиме имитации
function PayTest(id) {
  const o = S.orders.find((x) => x.id === id) || {};
  return `<main class="screen" style="min-height:100dvh;justify-content:center">
    <div class="card stack" style="gap:16px;padding:24px">
      <span class="eyebrow accent">Тестовая оплата · имитация Сбера</span>
      <span class="h2" style="text-transform:none">Патрики Паб, заказ №${esc(o.number || '')}</span>
      ${o.total ? `<span class="price" style="font-size:32px">${rub(o.total)}</span>` : ''}
      <span class="muted" style="font-size:13px;line-height:1.5">Здесь будет настоящая страница Сбера с вводом карты, СБП и SberPay. Сейчас деньги не списываются — выберите результат.</span>
      <button type="button" class="btn btn-accent btn-block" data-act="mock-pay" data-id="${esc(id)}" data-v="ok">Оплатить (тест)</button>
      <button type="button" class="btn btn-danger btn-block" data-act="mock-pay" data-id="${esc(id)}" data-v="fail">Отказ банка (тест)</button>
    </div>
  </main>`;
}

function OrderStatus(id) {
  const o = S.orders.find((x) => x.id === id) || S.history?.find((x) => x.id === id) || { id, number: '…', status: 'new' };
  const idx = Math.max(0, STATUS.findIndex(([k]) => k === o.status));
  const waitingPay = o.payment === 'online' && ['pending', 'failed'].includes(o.payment_status);
  return `<main class="screen">
    <h1 class="h1">Заказ №${esc(o.number)}</h1>
    ${PaymentBlock(o)}
    ${waitingPay ? '' : o.status === 'cancelled'
      ? `<div class="card"><span class="error">Заказ отменён. Если это ошибка — позвоните нам.</span></div>`
      : `<div class="card status-steps" aria-live="polite">${STATUS.map(([k, label], i) => `<div class="step ${i <= idx ? 'done' : ''}"><span class="dot"></span>${label}</div>`).join('')}</div>`}
    <p class="muted" style="margin:0;line-height:1.5">Статус обновляется сам.</p>
    <a class="btn btn-ghost btn-block" href="tel:${esc((venue().phone || '').replace(/[^+\d]/g, ''))}">${icon.phone}Позвонить в паб</a>
    <a class="btn btn-accent btn-block" href="#/menu">Вернуться в меню</a>
  </main>`;
}
let pollTimer = null;
function pollOrder(id, now = false) {
  clearTimeout(pollTimer);
  const o0 = S.orders.find((x) => x.id === id);
  const payWait = o0?.payment === 'online' && o0.payment_status === 'pending';
  // сразу после возврата со страницы оплаты — проверяем немедленно, пока ждём оплату — чаще
  const delay = now || hashParams().has('pay') ? 300 : payWait ? 4000 : 15000;
  pollTimer = setTimeout(async () => {
    if (route() !== '/order/' + id) return;
    try {
      const s = await store.getOrderStatus(id);
      let o = S.orders.find((x) => x.id === id);
      if (!o && s) { o = { id, number: s.number, status: s.status, total: s.total, payment: s.payment, payment_status: s.payment_status }; S.orders.unshift(o); }
      let ps = s?.payment_status;
      // ждём оплату — сверяем со Сбером напрямую (не дожидаясь уведомления)
      if (s?.payment === 'online' && ps === 'pending') { try { ps = (await store.paymentStatus(id)).payment_status; } catch { /* сеть */ } }
      if (s && o && (s.status !== o.status || ps !== o.payment_status || !o.payment)) {
        Object.assign(o, { status: s.status, payment: s.payment, payment_status: ps, total: s.total ?? o.total });
        keep.set('orders', S.orders);
        if (hashParams().has('pay')) history.replaceState(null, '', location.pathname + location.search + '#/order/' + id);
        render(); return;
      }
    } catch { /* сеть */ }
    if (hashParams().has('pay')) history.replaceState(null, '', location.pathname + location.search + '#/order/' + id);
    pollOrder(id);
  }, delay);
}

/* ---------- профиль ---------- */
const row = (href, ic, label, extra = '') => `<a class="menu-row" href="${href}"><span class="row">${ic}<span>${label}</span>${extra}</span>${icon.chev}</a>`;

function Profile() {
  const p = S.profile, me = S.me;
  if (store.guestOff) return `<main class="screen"><h1 class="h1">Профиль</h1>
    <div class="card stack"><span style="color:var(--text-2);line-height:1.5">Профиль временно недоступен. Заказы оформляются как обычно.</span></div>
    ${InfoRows()}</main>`;
  const phone = me?.verified ? fmtPhone(me.phone) : p.phone;
  return `<main class="screen">
    <div class="stack" style="gap:6px">
      <h1 class="h1" style="text-transform:none;letter-spacing:.5px">${esc(p.name || 'Гость')}</h1>
      ${phone ? `<span style="font-size:16px;color:var(--text-2)">${esc(phone)}</span>` : ''}
      ${me?.verified
        ? `<span class="ok-note">${icon.check} Номер подтверждён</span>`
        : `<a class="btn btn-outline btn-sm" href="#/verify" style="align-self:flex-start;margin-top:6px">Подтвердить номер телефона</a>
           <span class="muted" style="font-size:12px;line-height:1.5">Необязательно. Подтверждённый номер — это ваши заказы и адреса на любом телефоне и баллы лояльности.</span>`}
    </div>
    <nav class="menu-group" aria-label="Мой профиль">
      ${row('#/profile/orders', icon.clock, 'История заказов')}
      ${row('#/profile/addresses', icon.pin, 'Мои адреса', S.addresses.length ? `<span class="pill">${S.addresses.length}</span>` : '')}
      ${row('#/card', icon.card, 'Баллы', '<span class="pill muted-pill">скоро</span>')}
      ${row('#/profile/me', icon.id, 'Личные данные')}
    </nav>
    ${InfoRows()}
    ${me?.verified ? '<button type="button" class="btn btn-ghost btn-block" data-act="logout">Выйти из профиля</button>' : ''}
  </main>`;
}
const InfoRows = () => `<nav class="menu-group" aria-label="О пабе">
  ${row('#/info', icon.info, 'Адреса и контакты')}
  ${row('legal/', icon.id, 'Документы')}
  <a class="menu-row" href="tel:${esc((venue().phone || '').replace(/[^+\d]/g, ''))}"><span class="row">${icon.phone}<span>Позвонить в паб</span></span>${icon.chev}</a>
</nav>`;

function History() {
  const list = S.history;
  return `<main class="screen">
    <div class="row">${backBtn('/profile')}<h1 class="h1" style="font-size:26px">Мои заказы</h1></div>
    ${list === null ? bulldogLoader('Листаем чеки…')
      : !list.length ? `<div class="empty">${icon.clock}<span>Заказов пока нет. Самое время попробовать брискет.</span><a class="btn btn-accent" href="#/menu">В меню</a></div>`
      : list.map((o) => `<article class="card stack">
        <div class="between"><span class="h2" style="font-size:18px">№${esc(o.number)}</span><span class="status-pill ${esc(o.status)}">${STATUS_RU[o.status] || esc(o.status)}</span></div>
        <span class="muted" style="font-size:13px">${new Date(o.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · ${esc(o.address)}</span>
        <span style="font-size:14px;line-height:1.5;color:var(--text-2)">${(o.items || []).map((l) => `${esc(l.name)} × ${esc(l.qty)}`).join(', ')}</span>
        <div class="between"><span class="price">${rub(o.total)}</span>
          <div class="row"><a class="btn btn-ghost btn-sm" href="#/order/${esc(o.id)}">Статус</a><button type="button" class="btn btn-accent btn-sm" data-act="repeat" data-id="${esc(o.id)}">Повторить</button></div></div>
      </article>`).join('')}
  </main>`;
}
async function loadHistory() {
  try { S.history = await store.myOrders(); } catch (e) { console.warn(e); S.history = []; }
  if (route() === '/profile/orders') render();
}
function repeatOrder(id) {
  const o = S.history?.find((x) => x.id === id); if (!o) return;
  let added = 0, missing = 0;
  for (const l of o.items || []) {
    const it = itemById(l.item_id);
    if (onSale(it)) { setQty(it.id, (S.cart[it.id] || 0) + l.qty); added += l.qty; } else missing++;
  }
  toast(missing ? `Добавили ${added} шт. Некоторых блюд сейчас нет` : 'Заказ добавлен в корзину');
  location.hash = '#/cart';
}

function Addresses() {
  return `<main class="screen">
    <div class="row">${backBtn('/profile')}<h1 class="h1" style="font-size:26px">Мои адреса</h1></div>
    ${S.addresses.length ? `<div class="menu-group">${S.addresses.map((a) => `<button type="button" class="menu-row" data-act="edit-addr" data-id="${esc(a.id)}">
      <span class="row" style="text-align:left">${icon.pin}<span class="stack" style="gap:2px">${a.label ? `<span class="eyebrow">${esc(a.label)}</span>` : ''}<span>${esc(addrLine(a))}</span></span></span>${icon.chev}</button>`).join('')}</div>`
      : `<div class="empty">${icon.pin}<span>Сохранённых адресов нет. Адрес из первого заказа запомнится сам.</span></div>`}
    <button type="button" class="btn btn-accent btn-block" data-act="edit-addr" data-id="">+ Добавить адрес</button>
  </main>`;
}

function addrSheet(a) {
  const x = a || { label: '', street: '', flat: '', entrance: '', floor: '', intercom: '', comment: '' };
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="${a ? 'Изменить адрес' : 'Новый адрес'}">
    <span class="grab"></span>
    <h2 class="h2">${a ? 'Изменить адрес' : 'Новый адрес'}</h2>
    <div class="tabs" role="radiogroup" aria-label="Название">${['Дом', 'Работа', 'Друзья', 'Другое'].map((l) => `<button type="button" class="chip" data-label="${l}" aria-current="${x.label === l}">${l}</button>`).join('')}</div>
    <label class="field">Улица и дом<input class="input" name="street" required value="${esc(x.street)}" placeholder="Большая Пушкарская, 10"></label>
    <div class="grid-2">
      <label class="field">Квартира / офис<input class="input" name="flat" inputmode="numeric" value="${esc(x.flat)}"></label>
      <label class="field">Подъезд<input class="input" name="entrance" inputmode="numeric" value="${esc(x.entrance)}"></label>
      <label class="field">Этаж<input class="input" name="floor" inputmode="numeric" value="${esc(x.floor)}"></label>
      <label class="field">Домофон<input class="input" name="intercom" value="${esc(x.intercom)}"></label>
    </div>
    <label class="field">Комментарий курьеру<input class="input" name="comment" value="${esc(x.comment)}" placeholder="Вход со двора"></label>
    <p class="error" role="alert" style="margin:0"></p>
    <button type="submit" class="btn btn-accent btn-block">Сохранить</button>
    ${a ? '<button type="button" class="btn btn-danger btn-block" data-x="del">Удалить адрес</button>' : ''}
    <button type="button" class="btn btn-ghost btn-block" data-x="close">Отмена</button>
  </form>`;
  let label = x.label;
  const form = wrap.querySelector('form');
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('[data-x=close]')) return wrap.remove();
    const chip = e.target.closest('[data-label]');
    if (chip) { label = label === chip.dataset.label ? '' : chip.dataset.label; wrap.querySelectorAll('[data-label]').forEach((c) => c.setAttribute('aria-current', String(c.dataset.label === label))); }
    if (e.target.closest('[data-x=del]')) {
      await store.deleteAddress(a.id); S.addresses = await store.listAddresses(); wrap.remove(); render(); toast('Адрес удалён');
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    if (!d.street.trim()) return (form.querySelector('.error').textContent = 'Укажите улицу и дом');
    try {
      await store.saveAddress({ ...(a ? { id: a.id } : {}), ...d, label });
      S.addresses = await store.listAddresses(); wrap.remove(); render(); toast('Адрес сохранён');
    } catch (ex) { console.error(ex); form.querySelector('.error').textContent = 'Не удалось сохранить'; }
  });
  document.body.appendChild(wrap);
  form.street.focus();
}

function PersonalData() {
  const p = S.profile;
  const phone = p.phone || (S.me?.phone ? fmtPhone(S.me.phone) : '');
  return `<main class="screen">
    <div class="row">${backBtn('/profile')}<h1 class="h1" style="font-size:26px">Личные данные</h1></div>
    <form id="me-form" class="stack" style="gap:14px">
      <label class="field">Имя<input class="input" name="name" autocomplete="name" value="${esc(p.name)}"></label>
      <label class="field">Телефон<input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" data-phone placeholder="${PHONE_PH}" value="${esc(phone)}"></label>
      ${verified() ? `<span class="ok-note">${icon.check} Подтверждён ${esc(fmtPhone(S.me.phone))}</span>` : '<a href="#/verify" style="font-size:13px">Подтвердить номер</a>'}
      <label class="field">День рождения — пришлём подарок<input class="input" name="birthday" type="date" value="${esc(p.birthday || '')}"></label>
      <p class="error" role="alert" style="margin:0"></p>
      <button type="submit" class="btn btn-accent btn-block">Сохранить</button>
    </form>
    <section class="card stack">
      <div class="between" style="gap:16px">
        <span class="stack" style="gap:4px"><b>Акции и новости</b>
          <span class="muted" style="font-size:12px;line-height:1.5">SMS, push и сообщения в мессенджерах о скидках и событиях паба. ${doc('ads', 'Согласие на рассылку')}. Отключить можно здесь в любой момент.</span></span>
        <button type="button" class="switch" role="switch" data-act="marketing" aria-checked="${!!p.marketing_consent}" aria-label="Акции и новости"></button>
      </div>
    </section>
    <section class="stack" style="gap:8px">
      <span class="eyebrow">Мои данные</span>
      <span class="muted" style="font-size:13px;line-height:1.5">${p.pd_consent_version ? `Согласие на обработку персональных данных дано${p.pd_consent_at ? ' ' + new Date(p.pd_consent_at).toLocaleDateString('ru-RU') : ''}. ` : ''}Удаление профиля = отзыв согласия: сотрём имя, телефон, адреса и день рождения. В истории заказов останутся только суммы — их требует бухгалтерский учёт.</span>
      <button type="button" class="btn btn-danger btn-block" data-act="delete-account">Удалить профиль и мои данные</button>
    </section>
  </main>`;
}

/* ---------- подтверждение номера ---------- */
function Verify() {
  const v = S.verify;
  const pre = v.phone || S.profile.phone || '';
  if (v.step === 'code') {
    const left = Math.max(0, Math.ceil((v.until - Date.now()) / 1000));
    return `<main class="screen">
      <div class="row"><button type="button" class="icon-btn" data-act="verify-back" aria-label="Изменить номер">${icon.back}</button><h1 class="h1" style="font-size:26px">Код из SMS</h1></div>
      <div class="verify-dog" aria-hidden="true">${logoMark(88)}</div>
      <p style="text-align:center;color:var(--text-2);margin:0;line-height:1.5">Отправили код на<br><b style="color:var(--text)">${esc(fmtPhone(v.phone))}</b></p>
      <form id="code-form" class="stack" style="gap:14px">
        <label class="sr-only" for="otp">Код подтверждения</label>
        <input id="otp" class="input otp" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" required>
        <p class="error" role="alert" style="margin:0"></p>
        <button type="submit" class="btn btn-accent btn-block">Подтвердить</button>
      </form>
      ${left > 0 ? `<p class="muted" style="text-align:center;margin:0" id="resend">Отправить ещё раз через ${left} с</p>`
        : '<button type="button" class="btn btn-ghost btn-block" data-act="resend">Отправить код ещё раз</button>'}
      ${CONFIG.SMS_TEST_MODE ? '<p class="demo-banner" style="margin:0">Тестовый режим: SMS пока не отправляются. Код виден управляющему в админке и приходит в чат заведения.</p>' : ''}
    </main>`;
  }
  return `<main class="screen">
    <div class="row">${backBtn(v.back || '/profile')}<h1 class="h1" style="font-size:26px">Вход по номеру</h1></div>
    <div class="verify-dog" aria-hidden="true">${logoMark(88)}</div>
    <p style="text-align:center;color:var(--text-2);margin:0;line-height:1.5">Подтвердите номер — и заказы, адреса и баллы будут с вами на любом телефоне</p>
    <form id="phone-form" class="stack" style="gap:14px">
      <label class="field">Номер мобильного<input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" data-phone required placeholder="${PHONE_PH}" value="${esc(fmtPhone(pre))}"></label>
      ${ConsentBox()}
      <p class="error" role="alert" style="margin:0"></p>
      <button type="submit" class="btn btn-accent btn-block">Получить код</button>
    </form>
  </main>`;
}
let verifyTimer = null;
function tickVerify() {
  clearInterval(verifyTimer);
  if (S.verify.step !== 'code') return;
  verifyTimer = setInterval(() => {
    const el = document.getElementById('resend');
    if (!el || route() !== '/verify') return clearInterval(verifyTimer);
    const left = Math.ceil((S.verify.until - Date.now()) / 1000);
    if (left <= 0) { clearInterval(verifyTimer); render(); } else el.textContent = `Отправить ещё раз через ${left} с`;
  }, 1000);
  document.getElementById('otp')?.focus();
}
async function sendCode(p10, errEl, btn) {
  if (p10.length !== 10) { if (errEl) errEl.textContent = 'Введите номер полностью'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Отправляем…'; }
  try {
    const ctx = await store.sendCode(p10);
    S.verify = { ...S.verify, step: 'code', phone: p10, ctx, until: Date.now() + 60000 };
    render();
    if (ctx.demoCode) toast(`Демо-режим: код ${ctx.demoCode}`, 6000);
  } catch (ex) {
    console.error(ex);
    const m = String(ex.message || '');
    if (errEl) errEl.textContent = /rate|seconds|limit/i.test(m) ? 'Слишком часто. Подождите минуту и попробуйте снова' : 'Не удалось отправить код. Попробуйте позже';
    if (btn) { btn.disabled = false; btn.textContent = 'Получить код'; }
  }
}

/* ---------- карта гостя и информация ---------- */
function GuestCard() {
  return `<main class="screen">
    <div class="row">${backBtn('/profile')}<h1 class="h1" style="font-size:26px">Баллы</h1></div>
    <div class="guest-card">
      <div class="between"><div class="stack" style="gap:4px"><span style="font-family:var(--display);font-weight:700;font-size:18px;letter-spacing:2px">ПАТРИКИ ПАБ</span><span class="eyebrow">Программа лояльности</span></div>${logoMark(44)}</div>
      <span style="font-size:15px;line-height:1.5">Скоро здесь будет баланс баллов — тот же, что на вашей карте в Wallet. Копите в зале и в доставке, списывайте при заказе.</span>
    </div>
    <div class="card stack">
      <span class="eyebrow">Уже есть карта в Wallet?</span>
      <span style="font-size:14px;line-height:1.5;color:var(--text-2)">Подтвердите в профиле тот же номер телефона, что и у карты — так мы свяжем баллы с приложением.</span>
      ${verified() ? '' : '<a class="btn btn-outline btn-sm" href="#/verify" style="align-self:flex-start">Подтвердить номер</a>'}
    </div>
  </main>`;
}

function Info() {
  return `<main class="screen">
    <div class="row">${backBtn('/', 'На главную')}<h1 class="h1" style="font-size:26px">Информация</h1></div>
    <div style="display:flex;justify-content:center;color:var(--text);padding:8px 0">${logoEmblem(220)}</div>
    ${S.venues.map((v) => `<section class="card stack">
      <div class="between"><span class="h2" style="font-size:18px">${esc(v.name)}</span>${v.accepting === false ? '<span class="status-pill">скоро</span>' : ''}</div>
      <span style="color:var(--text-2)">${esc(v.address)}</span>
      <span class="muted" style="font-size:13px">Ежедневно ${esc(v.hours)} · доставка: ${esc(v.zone)}</span>
      ${v.phone ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(v.phone.replace(/[^+\d]/g, ''))}" style="align-self:flex-start">${icon.phone}${esc(fmtPhone(v.phone) || v.phone)}</a>` : ''}
    </section>`).join('')}
    <section class="card stack">
      <span class="eyebrow">О доставке</span>
      <span style="font-size:14px;line-height:1.6;color:var(--text-2)">Доставляем еду и безалкогольные напитки. Алкоголь по закону продаётся только в зале. Оплата онлайн (где включена), картой или наличными курьеру.</span>
    </section>
    ${Seller()}
    <nav class="menu-group" aria-label="Документы">
      ${[['offer', icon.info, 'Публичная оферта'], ['terms', icon.info, 'Пользовательское соглашение'], ['payment', icon.card, 'Оплата и возврат'],
         ['privacy', icon.id, 'Политика обработки персональных данных'], ['consent', icon.id, 'Согласие на обработку данных'], ['ads', icon.info, 'Согласие на рассылку']]
        .map(([h, ic, t]) => `<a class="menu-row" href="legal/#${h}"><span class="row">${ic}<span>${t}</span></span>${icon.chev}</a>`).join('')}
    </nav>
    <footer class="info-foot">
      © 2026 «<span data-act="secret">Патрики</span> Паб» · Санкт-Петербург<br>версия ${esc(CONFIG.APP_VERSION)}${store.demo ? ' · демо' : ''}
    </footer>
  </main>`;
}

// Сведения о продавце — Закон «О защите прав потребителей», ст. 8–9
function Seller() {
  const L = CONFIG.LEGAL;
  const rows = [['Продавец', L.SELLER], ['ИНН', L.INN], ['ОГРН', L.OGRN], ['Адрес', L.ADDRESS], ['Почта', L.EMAIL], ['Телефон', L.PHONE]].filter(([, v]) => v);
  if (!L.SELLER) return '';
  return `<section class="card stack" style="gap:6px">
    <span class="eyebrow">Продавец</span>
    ${rows.map(([k, v]) => `<div class="sum-row" style="font-size:13px"><span class="muted">${k}</span><span style="text-align:right">${esc(v)}</span></div>`).join('')}
  </section>`;
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
      ${x.composition || x.nutrition || x.allergens ? `<dl class="facts">
        ${x.composition ? `<dt>Состав</dt><dd>${esc(x.composition)}</dd>` : ''}
        ${x.nutrition ? `<dt>Пищевая ценность</dt><dd>${esc(x.nutrition)}</dd>` : ''}
        ${x.allergens ? `<dt>Аллергены</dt><dd>${esc(x.allergens)}</dd>` : ''}
      </dl>` : ''}
      <span class="muted" style="font-size:12px;line-height:1.5">Есть аллергия? Напишите в комментарии к заказу или позвоните — подскажем по составу.</span>
      <div class="between"><span class="price" style="font-size:26px">${rub(x.price)}</span>
        ${!onSale(x) ? '<span class="muted">Нет в наличии</span>' : Stepper(x.id, q)}</div>
      <button type="button" class="btn btn-ghost btn-block" data-close>Закрыть</button>
    </div>`;
  };
  draw();
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); render(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) return close();
    const b = e.target.closest('[data-act]');
    if (b?.dataset.act === 'inc') { setQty(x.id, (S.cart[x.id] || 0) + 1); draw(); }
    if (b?.dataset.act === 'dec') { setQty(x.id, (S.cart[x.id] || 0) - 1); draw(); }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  wrap.querySelector('[data-close]').focus();
}

/* ---------- подсказка «На экран Домой» для iPhone ---------- */
function maybeShowInstallHint() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const params = new URLSearchParams(location.search);
  const asked = params.has('install');
  if (asked) {
    // убираем ?install из адреса, чтобы на экран «Домой» добавился чистый адрес приложения
    params.delete('install');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  }
  if (!ios || standalone || window.Capacitor) return;
  if (!asked && keep.get('installHintDone', false)) return;
  // «На экран Домой» есть только в Safari; в Telegram, Instagram, Chrome — просим открыть в Safari
  const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|YaBrowser|Telegram|Instagram|FBAN|FBAV|VK|OPiOS/i.test(ua);
  const shareIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" style="vertical-align:-5px"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  const plusIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" style="vertical-align:-5px"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Установить приложение">
    <span class="grab"></span>
    <div class="row" style="gap:14px"><img src="icons/icon-180.png" width="64" height="64" alt="" style="border-radius:16px;border:1px solid var(--line)">
      <div class="stack" style="gap:2px"><span class="h2">Патрики</span><span class="muted" style="font-size:13px">Добавьте на экран — откроется как приложение</span></div></div>
    ${safari ? `<ol class="install-steps">
      <li>Нажмите ${shareIcon} <b>«Поделиться»</b> внизу экрана</li>
      <li>Пролистайте и выберите ${plusIcon} <b>«На экран “Домой”»</b></li>
      <li>Нажмите <b>«Добавить»</b> — иконка с бульдогом появится на экране</li>
    </ol>` : `<p style="margin:0;color:var(--text-2);line-height:1.5">Чтобы добавить приложение на экран, откройте эту страницу в <b>Safari</b>: нажмите «⋯» или значок компаса → «Открыть в Safari».</p>`}
    <button type="button" class="btn btn-accent btn-block" data-close>Понятно</button>
  </div>`;
  const close = () => { wrap.remove(); keep.set('installHintDone', true); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(wrap);
}

/* ---------- удаление профиля ---------- */
function deleteSheet() {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="del-h">
    <span class="grab"></span>
    <h2 class="h2" id="del-h">Удалить профиль?</h2>
    <p style="margin:0;color:var(--text-2);line-height:1.6">Сотрём имя, телефон, адреса, день рождения и привязку номера. В прошлых заказах останутся только состав и суммы — без ваших данных. Баллы, если они были, сгорят. Отменить удаление нельзя.</p>
    <p class="error" role="alert" style="margin:0"></p>
    <button type="button" class="btn btn-danger btn-block" data-x="yes">Удалить навсегда</button>
    <button type="button" class="btn btn-ghost btn-block" data-x="no">Оставить</button>
  </div>`;
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('[data-x=no]')) return wrap.remove();
    const yes = e.target.closest('[data-x=yes]'); if (!yes) return;
    yes.disabled = true; yes.textContent = 'Удаляем…';
    try {
      await store.deleteAccount();
      for (const k of ['customer', 'orders', 'pdConsent']) { try { localStorage.removeItem('patriki.ui.' + k); } catch { /* нет доступа */ } }
      S.orders = []; S.history = null; S.draftContact = null; S.addresses = [];
      S.verify = { step: 'phone', phone: '', ctx: null, until: 0, back: '/profile' };
      await loadGuest();
      wrap.remove(); location.hash = '#/profile'; render(); toast('Профиль и данные удалены', 3500);
    } catch (ex) {
      console.error(ex);
      wrap.querySelector('.error').textContent = ex.message === 'ACTIVE_ORDER'
        ? 'Сейчас у вас есть незавершённый заказ. Удалить профиль можно после доставки.'
        : 'Не получилось удалить. Попробуйте позже или напишите нам — удалим вручную.';
      yes.disabled = false; yes.textContent = 'Удалить навсегда';
    }
  });
  document.body.appendChild(wrap);
  wrap.querySelector('[data-x=no]').focus();
}

/* ---------- события ---------- */
app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const { act, id, v } = b.dataset;
  if (act === 'venue') { if (route() === '/checkout') saveCheckoutForm(); S.venueId = id; keep.set('venue', id); render(); }
  if (act === 'inc' || act === 'dec') {
    setQty(id, (S.cart[id] || 0) + (act === 'inc' ? 1 : -1));
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }
  if (act === 'open') openItem(id);
  if (act === 'jump') {
    document.getElementById('cat-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    app.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-current', String(c === b)));
  }
  if (act === 'when') { saveCheckoutForm(); S.checkout.when = v; render(); }
  if (act === 'pay') { saveCheckoutForm(); S.checkout.payment = v; S.checkout.payChosen = true; render(); }
  if (act === 'pay-now') payNow(id, b);
  if (act === 'mock-pay') {
    b.disabled = true;
    try { await store.mockPay(id, v); } catch (ex) { toast(ex.message); }
    location.hash = `#/order/${id}?pay=${v}`;
  }
  if (act === 'pick-addr') { saveCheckoutForm(); S.checkout.addr = id; render(); }
  if (act === 'repeat') repeatOrder(id);
  if (act === 'edit-addr') addrSheet(S.addresses.find((a) => a.id === id));
  if (act === 'verify-back') { S.verify.step = 'phone'; render(); }
  if (act === 'resend') sendCode(S.verify.phone, null, null);
  if (act === 'logout') {
    await store.guestSignOut();
    S.history = null; S.verify = { step: 'phone', phone: '', ctx: null, until: 0, back: '/profile' };
    await loadGuest(); render(); toast('Вы вышли из профиля');
  }
  if (act === 'marketing') {
    const on = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(on));
    try {
      if (on && !hasPdConsent()) await grantPd('profile');
      await store.recordConsent('marketing', on, CONFIG.LEGAL.EDITION, 'profile');
      S.profile = { ...S.profile, marketing_consent: on };
      toast(on ? 'Будем присылать акции' : 'Рассылка отключена');
    } catch (ex) { console.error(ex); b.setAttribute('aria-checked', String(!on)); toast('Не удалось сохранить'); }
  }
  if (act === 'delete-account') deleteSheet();
  if (act === 'secret') {
    const now = Date.now();
    S.infoTaps = [...S.infoTaps.filter((t) => now - t < 3000), now];
    if (S.infoTaps.length >= CONFIG.ADMIN_TAPS) { S.infoTaps = []; location.hash = '#/admin'; }
  }
});

app.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.id === 'checkout') { e.preventDefault(); return submitCheckout(f); }
  if (f.id === 'phone-form') {
    e.preventDefault();
    if (!hasPdConsent() && !f.pdConsent?.checked) return (f.querySelector('.error').textContent = 'Отметьте согласие на обработку персональных данных');
    if (!hasPdConsent()) keep.set('pdConsent', CV);
    return sendCode(phone10(f.phone.value), f.querySelector('.error'), f.querySelector('[type=submit]'));
  }
  if (f.id === 'code-form') {
    e.preventDefault();
    const err = f.querySelector('.error'), btn = f.querySelector('[type=submit]');
    const code = f.code.value.replace(/\D/g, '');
    if (code.length < 4) return (err.textContent = 'Введите код из сообщения');
    btn.disabled = true; btn.textContent = 'Проверяем…';
    try {
      await store.confirmPhone(S.verify.phone, code, S.verify.ctx);
      await loadGuest();
      if (keep.get('pdConsent', '') === CV && S.profile.pd_consent_version !== CV) await grantPd('verify');
      if (!S.profile.phone || phone10(S.profile.phone) !== S.verify.phone) {
        S.profile = await store.saveProfile({ ...S.profile, phone: fmtPhone(S.verify.phone) });
      }
      S.history = null;
      const back = S.verify.back || '/profile';
      S.verify = { step: 'phone', phone: '', ctx: null, until: 0, back: '/profile' };
      toast('Номер подтверждён');
      location.hash = '#' + back;
    } catch (ex) {
      err.textContent = ex.message || 'Неверный код';
      btn.disabled = false; btn.textContent = 'Подтвердить';
    }
  }
  if (f.id === 'me-form') {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    if (d.phone && phone10(d.phone).length !== 10) return (f.querySelector('.error').textContent = 'Введите номер полностью');
    try {
      S.profile = await store.saveProfile({ ...S.profile, name: d.name, phone: fmtPhone(d.phone), birthday: d.birthday || null });
      toast('Сохранено'); location.hash = '#/profile';
    } catch (ex) { console.error(ex); f.querySelector('.error').textContent = 'Не удалось сохранить'; }
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

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  if (route() === '/verify' && S.verify.step === 'phone') S.verify.back = S.verify.back || '/profile';
  render();
});

(async () => {
  const started = Date.now();
  try {
    await store.init();
    await Promise.all([reloadMenu(), loadGuest()]);
  } catch (e) {
    console.error(e);
    clearInterval(window.__pkLoaderTimer);
    app.innerHTML = `<main class="screen"><div class="empty">${logoMark(72)}Не удалось загрузить меню. Проверьте интернет и откройте приложение снова.<button class="btn btn-accent" onclick="location.reload()">Обновить</button></div></main>`;
    return;
  }
  // даём бульдогу хотя бы секунду покрутить головой — иначе экран просто мигнёт
  const wait = 1100 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  clearInterval(window.__pkLoaderTimer);
  render();
  maybeShowInstallHint();
})();

// В Android-приложении (Capacitor) файлы уже лежат внутри APK — service worker не нужен
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
