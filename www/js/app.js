import { store } from './store.js';
import { CONFIG } from './config.js';
import { HERO_IMG } from './seed.js';
import { logoMark, logoEmblem, bulldogLoader } from './logo.js';
import { renderAdmin } from './admin.js';
import { qrSvg, qrPayload } from './loyalty.js';
import { markReady, startUpdateChecks, BUILD } from './update.js';

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
  cal: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
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
  booking: { guests: 2, day: '', time: '', comment: '' },
  bookings: null,
  draftAddr: { street: '', flat: '', entrance: '', floor: '', intercom: '', label: '', save: true },
  draftContact: null,                             // { name, phone } пока заполняют форму
  verify: { step: 'phone', phone: '', until: 0, back: '/profile' },
  infoTaps: [],
  loy: null,                                      // карта гостя: баланс, уровень, история
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
// ссылка на документ: открывается поверх экрана, введённые данные не теряются
const doc = (hash, text) => `<a href="legal/index.html#${hash}" data-act="doc" data-h="${hash}">${text}</a>`;
function docSheet(hash) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet doc-sheet" role="dialog" aria-modal="true" aria-label="Документ">
    <span class="grab"></span>
    <iframe src="legal/index.html?embed=1#${hash}" title="Документ"></iframe>
    <button type="button" class="btn btn-accent btn-block" data-close>Закрыть</button>
  </div>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) wrap.remove(); });
  document.body.appendChild(wrap);
}
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
    store.myReservations().then((l) => { S.bookings = l; if (route() === '/') render(); }).catch(() => {});
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
  else if (r === '/booking') html = Booking();
  else if (r === '/profile/bookings') html = MyBookings();
  else if (r === '/verify') html = Verify();
  else if (r === '/card') html = GuestCard();
  else if (r === '/info') html = Info();
  else html = Home();
  app.innerHTML = html + TabBar(r) + CartBar(r);
  app.classList.toggle('has-cartbar', !!CartBar(r));
  if (r.startsWith('/order/')) pollOrder(r.split('/')[2]);
  if (r === '/profile/orders' && S.history === null) loadHistory();
  if ((r === '/profile/bookings' || r === '/booking') && S.bookings === null) loadBookings();
  if (r === '/card') startCardQr();
  // карту гостя освежаем, если данные старше 20 секунд (баллы могли начислить в пабе)
  if (['/', '/profile', '/card', '/checkout'].includes(r) && (S.loy === null || (S.loy && Date.now() - (S.loyAt || 0) > 20000))) loadLoyalty();
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
    ${v.booking_enabled !== false ? `<a class="card card-link between" href="#/booking">
      <div class="row" style="gap:12px">${icon.cal}<div class="stack" style="gap:4px"><span class="eyebrow">Забронировать стол</span><span style="font-size:15px;font-weight:600">${esc(v.name || 'Паб')} · ${upcomingBooking() ? `бронь ${esc(upcomingBooking())}` : 'выберите дату и время'}</span></div></div>
      <span class="row muted">${icon.chev}</span></a>` : ''}
    ${`<a class="card card-link between loy-home" href="#/card">
      <div class="stack" style="gap:4px"><span class="eyebrow">Карта гостя${S.loy?.tier ? ` · ${esc(S.loy.tier.name)} ${esc(S.loy.tier.pct)}%` : ''}</span><span style="font-size:15px;font-weight:600">${S.loy && S.loy.settings?.enabled ? `${pts(S.loy.balance)} ${ptsWord(S.loy.balance)}` : 'Баллы за заказы и визиты'}</span></div>
      <span class="row muted" style="font-size:13px">QR ${icon.chev}</span></a>`}
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
  const redeemMax = loyActive() ? Math.max(0, Math.min(S.loy.balance, Math.floor(cartSum() * (S.loy.settings.max_redeem_pct || 0) / 100))) : 0;
  const redeem = k.useBonus ? redeemMax : 0;
  const total = cartSum() + (v.delivery_fee || 0) - redeem;
  const st = S.loy?.settings || {};
  const noEarn = redeem > 0 && st.accrue_if_redeem === false;
  const earn = !noEarn && loyActive() && st.app_enabled && cartSum() - redeem >= Math.max(st.app_min_order || 0, 1) ? Math.floor((cartSum() - redeem) * (S.loy.tier?.pct || 0) / 100) : 0;
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
          <span class="stack" style="gap:2px;text-align:left"><b>Картой или СБП онлайн</b><span class="muted" style="font-size:12px">Банковская карта, СБП, SberPay · спишем, когда паб примет заказ</span></span></button>` : ''}
        <div class="grid-2">
          <button type="button" class="opt" data-act="pay" data-v="card" aria-pressed="${k.payment === 'card'}">Картой курьеру</button>
          <button type="button" class="opt" data-act="pay" data-v="cash" aria-pressed="${k.payment === 'cash'}">Наличными</button>
        </div>
      </section>
      ${redeemMax > 0 ? `<section class="stack"><span class="eyebrow">Баллы · на карте ${pts(S.loy.balance)}</span>
        <label class="check"><input type="checkbox" name="useBonus" data-act="bonus" ${k.useBonus ? 'checked' : ''}><span>Оплатить баллами ${pts(redeemMax)} ₽ <span class="muted">(до ${esc(st.max_redeem_pct)}% заказа)</span></span></label></section>` : ''}
      <label class="field">Комментарий к заказу<textarea class="textarea" name="comment" placeholder="Приборы, пожелания">${esc(k.comment)}</textarea></label>
      <div class="card stack">
        <div class="sum-row"><span>Блюда (${cartCount()})</span><span>${rub(cartSum())}</span></div>
        <div class="sum-row"><span>Доставка</span><span>${v.delivery_fee ? rub(v.delivery_fee) : 'бесплатно'}</span></div>
        ${redeem ? `<div class="sum-row"><span>Баллами</span><span>−${rub(redeem)}</span></div>` : ''}
        <div class="total"><span class="h2">К оплате</span><b>${rub(total)}</b></div>
        ${earn ? `<span class="muted" style="font-size:12px">После доставки начислим +${pts(earn)} ${ptsWord(earn)}${st.accrue_delay_days ? ` (придут через ${esc(st.accrue_delay_days)} дн.)` : ''}</span>` : noEarn ? '<span class="muted" style="font-size:12px">При оплате баллами новые баллы за этот заказ не начисляются</span>' : ''}
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
  if (f.useBonus) S.checkout.useBonus = !!d.useBonus;
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
      redeem: k.useBonus && loyActive() ? Math.max(0, Math.min(S.loy.balance, Math.floor(cartSum() * (S.loy.settings.max_redeem_pct || 0) / 100))) : 0,
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
    S.history = null; S.loy = null; S.draftContact = null; S.checkout = { ...S.checkout, addr: null, comment: '', noCall: false, pdTick: false, useBonus: false };
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
      ${row('#/profile/orders', icon.clock, 'Мои заказы')}
      ${row('#/profile/bookings', icon.cal, 'Мои брони', S.bookings?.filter(bookingActive).length ? `<span class="pill">${S.bookings.filter(bookingActive).length}</span>` : '')}
      ${row('#/profile/addresses', icon.pin, 'Мои адреса', S.addresses.length ? `<span class="pill">${S.addresses.length}</span>` : '')}
      ${row('#/card', icon.card, 'Карта гостя', S.loy && S.loy.settings?.enabled ? `<span class="pill">${pts(S.loy.balance)} б.</span>` : '')}
      ${row('#/profile/me', icon.id, 'Личные данные')}
    </nav>
    ${InfoRows()}
    ${me?.verified ? '<button type="button" class="btn btn-ghost btn-block" data-act="logout">Выйти из профиля</button>' : ''}
  </main>`;
}
const InfoRows = () => `<nav class="menu-group" aria-label="О пабе">
  ${row('#/info', icon.info, 'Адреса и контакты')}
  ${row('legal/index.html', icon.id, 'Документы')}
  <button type="button" class="menu-row" data-act="call"><span class="row">${icon.phone}<span>Позвонить в паб</span></span>${icon.chev}</button>
</nav>`;

/* ---------- бронирование столов ---------- */
const BOOK_STATUS = { new: 'Ждёт подтверждения', confirmed: 'Подтверждена', declined: 'Отклонена', cancelled: 'Отменена', done: 'Состоялась', noshow: 'Гость не пришёл' };
const bookingActive = (b) => ['new', 'confirmed'].includes(b.status) && new Date(b.starts_at) > Date.now();
const fmtBookTime = (iso) => new Date(iso).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
function upcomingBooking() {
  const b = (S.bookings || []).filter(bookingActive).sort((a, z) => a.starts_at.localeCompare(z.starts_at))[0];
  return b ? new Date(b.starts_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) : '';
}
async function loadBookings() {
  try { S.bookings = await store.myReservations(); } catch (e) { console.warn(e); S.bookings = []; }
  if (['/profile/bookings', '/booking', '/', '/profile'].includes(route())) render();
}
// ближайшие 14 дней и получасовые слоты 12:00–23:30 (по Москве)
function bookingDays() {
  const out = [], now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getTime() + i * 864e5);
    const key = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
    out.push({ key, label: i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }) });
  }
  return out;
}
function bookingSlots(day) {
  const out = [];
  for (let h = 12; h <= 23; h++) for (const m of [0, 30]) {
    const t = `${String(h).padStart(2, '0')}:${m ? '30' : '00'}`;
    const at = new Date(`${day}T${t}:00+03:00`);
    if (at.getTime() > Date.now() + 30 * 60e3) out.push(t);
  }
  return out;
}
function Booking() {
  const v = venue(), b = S.booking, c = S.draftContact || {};
  const days = bookingDays();
  if (!b.day || !days.some((d) => d.key === b.day)) b.day = days[0].key;
  let slots = bookingSlots(b.day);
  if (!slots.length && b.day === days[0].key) { b.day = days[1].key; slots = bookingSlots(b.day); }
  if (b.time && !slots.includes(b.time)) b.time = '';
  const max = v.booking_max_guests || 12, dep = (v.booking_deposit || 0) * b.guests;
  if (v.booking_enabled === false || v.accepting === false) return `<main class="screen">
    <div class="row">${backBtn('/')}<h1 class="h1" style="font-size:26px">Бронь стола</h1></div>
    <div class="card stack"><span style="color:var(--text-2);line-height:1.5">В заведении «${esc(v.name)}» бронирование пока недоступно. Позвоните нам — подскажем.</span>
    <button type="button" class="btn btn-outline" data-act="call">Позвонить в паб</button></div></main>`;
  return `<main class="screen">
    <div class="row">${backBtn('/')}<h1 class="h1" style="font-size:26px">Бронь стола</h1></div>
    ${VenueSwitch()}
    <form id="booking" class="stack" style="gap:18px" novalidate>
      <section class="stack"><span class="eyebrow">Дата</span>
        <div class="chips" style="flex-wrap:nowrap;overflow-x:auto">${days.map((d) => `<button type="button" class="chip" data-act="bk-day" data-v="${d.key}" aria-current="${d.key === b.day}">${esc(d.label)}</button>`).join('')}</div></section>
      <section class="stack"><span class="eyebrow">Время</span>
        <div class="slots">${slots.map((t) => `<button type="button" class="opt" data-act="bk-time" data-v="${t}" aria-pressed="${t === b.time}">${t}</button>`).join('')}</div></section>
      <section class="stack"><span class="eyebrow">Гостей</span>
        <div class="row" style="gap:14px"><button type="button" class="icon-btn" data-act="bk-g" data-v="-1" aria-label="Меньше">−</button>
          <b style="font-size:22px;min-width:32px;text-align:center">${b.guests}</b>
          <button type="button" class="icon-btn" data-act="bk-g" data-v="1" aria-label="Больше" ${b.guests >= max ? 'disabled' : ''}>+</button>
          <span class="muted" style="font-size:12px">больше ${max} — по телефону</span></div></section>
      <section class="stack"><span class="eyebrow">Контакты</span>
        <label class="field">Имя<input class="input" name="name" autocomplete="given-name" required value="${esc(c.name || S.profile.name || '')}"></label>
        <label class="field">Телефон<input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" data-phone required placeholder="${PHONE_PH}" value="${esc(fmtPhone(c.phone || S.profile.phone || ''))}"></label>
        <label class="field">Пожелания<input class="input" name="comment" maxlength="300" placeholder="У окна, день рождения, детский стул…" value="${esc(b.comment || '')}"></label></section>
      ${dep > 0 ? `<div class="card" style="font-size:14px;line-height:1.5">Депозит ${rub(dep)} (${rub(v.booking_deposit)} с гостя) — оплачивается онлайн при бронировании и засчитывается в счёт. При отмене позже чем за 3 часа депозит не возвращается.</div>`
        : `<div class="muted" style="font-size:12px;line-height:1.5">Бронь бесплатная. Паб подтвердит её звонком или сообщением; держим стол 15 минут после назначенного времени.</div>`}
      ${ConsentBox(b.pdTick)}
      <p class="error" id="bk-err" role="alert"></p>
      <button type="submit" class="btn btn-accent btn-block">${dep > 0 ? `Забронировать и оплатить ${rub(dep)}` : 'Забронировать'}</button>
    </form>
    ${(S.bookings || []).filter(bookingActive).length ? `<a class="btn btn-ghost btn-block" href="#/profile/bookings">Мои брони</a>` : ''}
  </main>`;
}
function saveBookingForm() {
  const f = document.getElementById('booking'); if (!f) return;
  S.booking.comment = f.comment.value;
  S.booking.pdTick = !!f.pdConsent?.checked;
  S.draftContact = { ...S.draftContact, name: f.name.value, phone: f.phone.value };
}
async function submitBooking(form) {
  saveBookingForm();
  const b = S.booking, c = S.draftContact || {}, err = document.getElementById('bk-err');
  if (!b.time) return (err.textContent = 'Выберите время');
  if (!c.name?.trim()) return (err.textContent = 'Укажите имя');
  if (phone10(c.phone).length !== 10) return (err.textContent = 'Введите номер полностью: +7 (XXX) XXX-XX-XX');
  if (!hasPdConsent() && !b.pdTick) return (err.textContent = 'Отметьте согласие на обработку персональных данных');
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Бронируем…';
  try {
    await grantPd('booking');
    const res = await store.placeReservation({
      venue_id: S.venueId, starts_at: new Date(`${b.day}T${b.time}:00+03:00`).toISOString(), guests: b.guests,
      name: c.name.trim(), phone: fmtPhone(c.phone), comment: (b.comment || '').trim(), pd_consent: true, pd_consent_version: CV,
    });
    S.booking = { guests: 2, day: '', time: '', comment: '' };
    S.bookings = null; loadBookings();
    toast(res.deposit > 0 ? `Бронь №${res.number} создана — осталось оплатить депозит` : `Бронь №${res.number} отправлена в паб`);
    location.hash = '#/profile/bookings';
  } catch (ex) {
    err.textContent = ex.message || 'Не удалось забронировать';
    btn.disabled = false; btn.textContent = 'Забронировать';
  }
}
function MyBookings() {
  const list = S.bookings;
  return `<main class="screen">
    <div class="row">${backBtn('/profile')}<h1 class="h1" style="font-size:26px">Мои брони</h1></div>
    ${list === null ? bulldogLoader('Смотрим журнал брони…')
      : !list.length ? `<div class="empty">${icon.cal}<span>Броней пока нет.</span><a class="btn btn-accent" href="#/booking">Забронировать стол</a></div>`
      : list.map((x) => `<article class="card stack">
        <div class="between"><span class="h2" style="font-size:18px">№${esc(x.number)}</span><span class="status-pill ${x.status === 'confirmed' ? 'done' : x.status === 'new' ? 'new' : 'cancelled'}">${BOOK_STATUS[x.status] || esc(x.status)}</span></div>
        <span style="font-size:15px">${esc(fmtBookTime(x.starts_at))} · ${esc(x.guests)} чел.</span>
        <span class="muted" style="font-size:13px">${esc((S.venues.find((v) => v.id === x.venue_id) || {}).name || x.venue_id)}${x.comment ? ` · ${esc(x.comment)}` : ''}</span>
        ${x.deposit > 0 ? `<span class="muted" style="font-size:13px">Депозит ${rub(x.deposit)} · ${x.payment_status === 'pending' ? 'ожидает оплаты' : x.payment_status === 'held' || x.payment_status === 'paid' ? 'оплачен' : esc(x.payment_status)}</span>` : ''}
        ${bookingActive(x) ? `<button type="button" class="btn btn-ghost btn-sm" style="align-self:flex-start" data-act="bk-cancel" data-id="${esc(x.id)}">Отменить бронь</button>` : ''}
      </article>`).join('')}
    <a class="btn btn-outline btn-block" href="#/booking">Новая бронь</a>
  </main>`;
}

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

/* ---------- подтверждение номера: Telegram-бот или звонок-сброс ---------- */
const tgIcon = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.4 4.1 2.9 11.3c-1.3.5-1.3 1.2-.2 1.6l4.7 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.5-1.5ZM8.7 14l9.6-6.1c.5-.3.9-.1.5.2l-8.2 7.4-.3 3.4-1.6-4.9Z"/></svg>';
function Verify() {
  const v = S.verify;
  const pre = v.phone || S.profile.phone || '';
  const head = (title, backAct) => `<div class="row">${backAct ? `<button type="button" class="icon-btn" data-act="${backAct}" aria-label="Назад">${icon.back}</button>` : backBtn(v.back || '/profile')}<h1 class="h1" style="font-size:26px">${title}</h1></div>`;
  if (v.step === 'tg') {
    return `<main class="screen">
      ${head('Через Telegram', 'verify-back')}
      <div class="verify-dog" aria-hidden="true">${logoMark(88)}</div>
      <ol class="install-steps">
        <li>Откройте нашего бота — кнопка ниже</li>
        <li>Нажмите в боте <b>«Start»</b>, затем <b>«📱 Поделиться номером»</b></li>
        <li>Вернитесь сюда — экран обновится сам</li>
      </ol>
      <a class="btn btn-accent btn-block" href="${esc(v.tgUrl || '#')}" target="_blank" rel="noopener" data-act="tg-open">${tgIcon} Открыть Telegram</a>
      <p class="muted" id="tg-wait" style="text-align:center;margin:0">${v.tgOpened ? 'Ждём подтверждения из Telegram…' : ''}</p>
      <p class="error" role="alert" style="margin:0;text-align:center">${esc(v.err || '')}</p>
      <button type="button" class="btn btn-ghost btn-block" data-act="verify-back">Подтвердить звонком</button>
    </main>`;
  }
  if (v.step === 'in') {
    const left = Math.max(0, Math.ceil((v.until - Date.now()) / 1000));
    const n = v.number || '';
    const shown = n.length === 11 ? fmtPhone(n.slice(1)) : n;
    return `<main class="screen">
      ${head('Звонок', 'verify-back')}
      <div class="verify-dog" aria-hidden="true">${logoMark(88)}</div>
      ${v.failed ? `<p style="text-align:center;color:var(--text-2);margin:0;line-height:1.6">${esc(v.err || 'Звонок не поступил')}</p>
        <button type="button" class="btn btn-accent btn-block" data-act="in-retry">Попробовать ещё раз</button>`
      : `<p style="text-align:center;color:var(--text-2);margin:0;line-height:1.6">Позвоните с номера <b style="color:var(--text)">${esc(fmtPhone(v.phone))}</b> на номер ниже.<br><b style="color:var(--text)">Звонок бесплатный</b> и сбросится сам — разговаривать не нужно.</p>
        <div class="in-number">${esc(shown)}</div>
        ${v.test ? `<button type="button" class="btn btn-accent btn-block" data-act="in-call">${icon.phone} Позвонить</button>` : `<a class="btn btn-accent btn-block" href="tel:+${esc(n)}" data-act="in-call">${icon.phone} Позвонить</a>`}
        <p class="muted" id="in-wait" style="text-align:center;margin:0">${v.called ? 'Ждём ваш звонок…' : 'Номер действует'} ${left ? `· ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}</p>`}
      <p class="error" role="alert" style="margin:0;text-align:center">${v.failed ? '' : esc(v.err || '')}</p>
      ${v.test ? '<p class="demo-banner" style="margin:0">Тестовый режим: звонить не нужно — нажмите «Позвонить», и номер подтвердится через несколько секунд.</p>' : ''}
      <div class="or-line"><span>или</span></div>
      <button type="button" class="btn btn-ghost btn-block" data-act="tg-start">${tgIcon} Через Telegram</button>
    </main>`;
  }
  if (v.step === 'code') {
    const left = Math.max(0, Math.ceil((v.until - Date.now()) / 1000));
    return `<main class="screen">
      ${head(v.channel === 'sms' ? 'Код из SMS' : 'Звонок', 'verify-back')}
      <div class="verify-dog" aria-hidden="true">${logoMark(88)}</div>
      ${v.channel === 'sms'
        ? `<p style="text-align:center;color:var(--text-2);margin:0;line-height:1.6">Отправили SMS с кодом на <b style="color:var(--text)">${esc(fmtPhone(v.phone))}</b>. Введите 4 цифры из сообщения.</p>`
        : `<p style="text-align:center;color:var(--text-2);margin:0;line-height:1.6">Сейчас на <b style="color:var(--text)">${esc(fmtPhone(v.phone))}</b> поступит звонок.<br><b style="color:var(--text)">Трубку брать не нужно</b> — введите последние 4 цифры номера, с которого звонят.</p>`}
      <form id="code-form" class="stack" style="gap:14px">
        <label class="sr-only" for="otp">Код подтверждения</label>
        <input id="otp" class="input otp" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="4" placeholder="••••" required>
        <p class="error" role="alert" style="margin:0"></p>
        <button type="submit" class="btn btn-accent btn-block">Подтвердить</button>
      </form>
      ${left > 0 ? `<p class="muted" style="text-align:center;margin:0" id="resend">${v.channel === 'sms' ? 'Отправить ещё раз' : 'Не пришёл звонок? Код в SMS'} — через ${left} с</p>`
        : `<div class="stack" style="gap:8px">
            ${v.channel !== 'sms' ? '<button type="button" class="btn btn-outline btn-block" data-act="resend" data-v="sms">Получить код в SMS</button>' : ''}
            <button type="button" class="btn btn-ghost btn-block" data-act="resend" data-v="${v.channel === 'sms' ? 'sms' : 'call'}">${v.channel === 'sms' ? 'Отправить SMS ещё раз' : 'Позвонить ещё раз'}</button></div>`}
      ${v.test ? `<p class="demo-banner" style="margin:0">Тестовый режим: ${v.channel === 'sms' ? 'SMS' : 'звонок'} пока не отправляется. Код виден управляющему в админке и в Telegram-группе.</p>` : ''}
    </main>`;
  }
  return `<main class="screen">
    ${head('Подтвердить номер')}
    <div class="verify-dog" aria-hidden="true">${logoMark(88)}</div>
    <p style="text-align:center;color:var(--text-2);margin:0;line-height:1.5">Подтвердите номер — и заказы, адреса и баллы будут с вами на любом телефоне</p>
    <form id="phone-form" class="stack" style="gap:14px">
      <label class="field">Номер мобильного<input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" data-phone placeholder="${PHONE_PH}" value="${esc(fmtPhone(pre))}"></label>
      ${ConsentBox()}
      <p class="error" role="alert" style="margin:0"></p>
      <button type="submit" class="btn btn-accent btn-block">Подтвердить звонком</button>
      <span class="muted" style="font-size:12px;text-align:center;margin-top:-6px">Покажем номер — позвоните на него со своего телефона. Звонок бесплатный и сбросится сам.</span>
      <div class="or-line"><span>или</span></div>
      <button type="button" class="btn btn-ghost btn-block" data-act="tg-start">${tgIcon} Через Telegram</button>
    </form>
  </main>`;
}
let verifyTimer = null;
function tickVerify() {
  clearInterval(verifyTimer);
  if (S.verify.step === 'tg') { pollTg(); return; }
  if (S.verify.step === 'in') { pollIn(); return; }
  if (S.verify.step !== 'code') return;
  verifyTimer = setInterval(() => {
    const el = document.getElementById('resend');
    if (!el || route() !== '/verify') return clearInterval(verifyTimer);
    const left = Math.ceil((S.verify.until - Date.now()) / 1000);
    if (left <= 0) { clearInterval(verifyTimer); render(); } else el.textContent = `${S.verify.channel === 'sms' ? 'Отправить ещё раз' : 'Не пришёл звонок? Код в SMS'} — через ${left} с`;
  }, 1000);
  document.getElementById('otp')?.focus();
}
// согласие перед любым способом подтверждения
function consentOk(form) {
  if (hasPdConsent()) return true;
  if (form?.pdConsent?.checked) { keep.set('pdConsent', CV); return true; }
  const e = form?.querySelector('.error'); if (e) e.textContent = 'Отметьте согласие на обработку персональных данных';
  return false;
}
async function startTg(btn) {
  btn.disabled = true;
  try {
    const r = await store.tgStart();
    S.verify = { ...S.verify, step: 'tg', tgToken: r.token, tgUrl: r.url, tgOpened: false, err: '' };
    render();
    // сразу открываем бота (в приложении на телефоне откроется Telegram)
    if (!r.demo) { S.verify.tgOpened = true; window.open(r.url, '_blank'); }
  } catch (ex) {
    console.error(ex); btn.disabled = false;
    const e = document.querySelector('#phone-form .error'); if (e) e.textContent = ex.message || 'Не получилось. Попробуйте звонком';
  }
}
let tgPoll = null;
function pollTg() {
  clearTimeout(tgPoll);
  const tick = async () => {
    if (route() !== '/verify' || S.verify.step !== 'tg') return;
    try {
      const r = await store.tgStatus(S.verify.tgToken);
      if (r.status === 'done' || r.status === 'login') return finishVerify(r);
      if (r.status === 'failed') { S.verify.err = r.message || 'Не получилось, попробуйте ещё раз'; return render(); }
    } catch (e) { console.warn(e); }
    tgPoll = setTimeout(tick, 2500);
  };
  tgPoll = setTimeout(tick, 1500);
}
async function startCall(p10, errEl, btn, channel = 'call') {
  if (p10.length !== 10) { if (errEl) errEl.textContent = 'Введите номер полностью: +7 (XXX) XXX-XX-XX'; return; }
  if (btn) { btn.disabled = true; btn.textContent = channel === 'sms' ? 'Отправляем…' : 'Звоним…'; }
  try {
    const r = await store.callStart(p10, channel);
    S.verify = { ...S.verify, step: 'code', phone: p10, channel, test: !!r.test, until: Date.now() + 30000 };
    render();
    if (r.demoCode) toast(`Демо-режим: код ${r.demoCode}`, 6000);
  } catch (ex) {
    console.error(ex);
    if (errEl) errEl.textContent = ex.message || 'Не удалось отправить код';
    else toast(ex.message || 'Не удалось отправить код', 4000);
    if (btn) { btn.disabled = false; btn.textContent = 'Получить код'; }
  }
}
async function startIncoming(p10, errEl, btn) {
  if (p10.length !== 10) { if (errEl) errEl.textContent = 'Введите номер полностью: +7 (XXX) XXX-XX-XX'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Получаем номер…'; }
  try {
    const r = await store.inStart(p10);
    S.verify = { ...S.verify, step: 'in', phone: p10, inId: r.id, number: r.number, test: !!r.test, called: false, failed: false, err: '', until: Date.now() + (r.timeout || 120) * 1000 };
    render();
  } catch (ex) {
    console.error(ex);
    if (errEl) errEl.textContent = ex.message || 'Не получилось. Попробуйте через Telegram';
    else toast(ex.message || 'Не получилось', 4000);
    if (btn) { btn.disabled = false; btn.textContent = 'Подтвердить звонком'; }
  }
}
let inPoll = null;
function pollIn() {
  clearTimeout(inPoll);
  const tick = async () => {
    if (route() !== '/verify' || S.verify.step !== 'in' || S.verify.failed) return;
    const left = Math.max(0, Math.ceil((S.verify.until - Date.now()) / 1000));
    const w = document.getElementById('in-wait');
    if (w) w.textContent = `${S.verify.called ? 'Ждём ваш звонок…' : 'Номер действует'}${left ? ` · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}`;
    try {
      const r = await store.inCheck(S.verify.inId, S.verify.called);
      if (r.status === 'done' || r.status === 'login') return finishVerify(r);
      if (r.status === 'failed') { S.verify.failed = true; S.verify.err = r.message || 'Звонок не поступил'; return render(); }
    } catch (e) { console.warn(e); }
    inPoll = setTimeout(tick, 2000);
  };
  inPoll = setTimeout(tick, 1000);
}
async function finishVerify(r) {
  clearTimeout(tgPoll); clearTimeout(inPoll);
  try {
    if (r.status === 'login') await store.applyLogin(r.login_hash);
    else await store.refreshUser();
  } catch (e) { console.error(e); S.verify.err = e.message; return render(); }
  await loadGuest();
  if (keep.get('pdConsent', '') === CV && S.profile.pd_consent_version !== CV) await grantPd('verify');
  const p10 = phone10(r.phone || S.me?.phone || '');
  if (p10 && phone10(S.profile.phone || '') !== p10) {
    try { S.profile = await store.saveProfile({ ...S.profile, phone: fmtPhone(p10) }); } catch (e) { console.warn(e); }
  }
  S.history = null; S.loy = null;
  const back = S.verify.back || '/profile';
  S.verify = { step: 'phone', phone: '', until: 0, back: '/profile' };
  toast(r.status === 'login' ? 'Номер подтверждён — вошли в ваш профиль' : 'Номер подтверждён', 3500);
  location.hash = '#' + back;
  render();
}

/* ---------- карта гостя и информация ---------- */
let loyLoading = false;
async function loadLoyalty() {
  if (loyLoading) return; loyLoading = true;
  if (!S.loy) S.loy = false;                        // первая загрузка
  try { S.loy = await store.myLoyalty(); S.loyAt = Date.now(); } catch (e) { console.warn('Карта гостя не загрузилась', e); S.loy = null; return; }
  finally { loyLoading = false; }
  if (['/', '/profile', '/card', '/checkout'].includes(route())) render();
}
const loyActive = () => S.loy && S.loy.settings?.enabled && (!S.loy.settings.verified_only || S.loy.verified);
const pts = (n) => `${Number(n || 0).toLocaleString('ru-RU')}`;
const ptsWord = (n) => { n = Math.abs(n) % 100; const d = n % 10; return n > 10 && n < 20 ? 'баллов' : d === 1 ? 'балл' : d >= 2 && d <= 4 ? 'балла' : 'баллов'; };
const LOY_KIND = { accrue: 'Начислено', pending: 'Начислится', redeem: 'Списано', refund: 'Возврат', bonus: 'Бонус', adjust: 'Корректировка', expire: 'Сгорело', reverse: 'Отмена начисления', import: 'Перенос с прежней карты' };
const LOY_SRC = { app: 'заказ в приложении', venue: 'в пабе', pos: 'касса', admin: 'управляющий', system: '' };

function GuestCard() {
  const L = S.loy;
  if (!L) return `<main class="screen"><div class="row">${backBtn('/profile')}<h1 class="h1" style="font-size:26px">Карта гостя</h1></div>${bulldogLoader('Достаём карту…')}</main>`;
  const st = L.settings || {};
  if (!st.enabled) return `<main class="screen"><div class="row">${backBtn('/profile')}<h1 class="h1" style="font-size:26px">Карта гостя</h1></div>
    <div class="card"><span style="color:var(--text-2)">Программа лояльности скоро заработает.</span></div></main>`;
  const t = L.tier || {};
  const need = t.next_from != null ? Math.max(0, t.next_from - L.spent) : 0;
  const prog = t.next_from != null ? Math.min(100, Math.round(((L.spent - t.from) / Math.max(1, t.next_from - t.from)) * 100)) : 100;
  const locked = st.verified_only && !L.verified;
  const tiers = [...(st.tiers || [])].sort((a, b) => a.from - b.from);
  return `<main class="screen">
    <div class="row">${backBtn('/profile')}<h1 class="h1" style="font-size:26px">Карта гостя</h1></div>
    <section class="guest-card loy-card">
      <div class="between"><div class="stack" style="gap:2px"><span class="eyebrow accent">${esc(t.name || '')} · ${esc(t.pct ?? 0)}%</span><span class="loy-balance">${pts(L.balance)} <small>${ptsWord(L.balance)}</small></span></div>${logoMark(52)}</div>
      ${t.fixed ? '<span class="muted" style="font-size:12px">Особый уровень</span>' : t.next_from != null ? `<div class="loy-prog" role="progressbar" aria-valuenow="${prog}" aria-valuemin="0" aria-valuemax="100"><span style="width:${prog}%"></span></div>
        <span class="muted" style="font-size:12px">До уровня «${esc(t.next_name)}» (${esc(tiers.find((x) => x.name === t.next_name)?.pct ?? '')}%) — ещё ${rub(need)} покупок</span>` : '<span class="muted" style="font-size:12px">Максимальный уровень — спасибо, что вы с нами!</span>'}
      ${L.pending ? `<span class="muted" style="font-size:12px">+${pts(L.pending)} ${ptsWord(L.pending)} ещё в пути — начислятся через ${esc(st.accrue_delay_days || 0)} дн. после покупки</span>` : ''}
      <span class="loy-no">№ ${esc(String(L.card_no).replace(/(\d{4})(\d{4})/, '$1 $2'))}</span>
    </section>
    ${locked ? `<div class="card stack"><b>Подтвердите номер — и баллы начнут копиться</b>
        <span class="muted" style="font-size:13px;line-height:1.5">Так мы защищаем баллы от чужих рук: карта привязывается к вашему телефону.</span>
        <a class="btn btn-accent btn-sm" href="#/verify" style="align-self:flex-start">Подтвердить номер</a></div>`
      : `<section class="card stack" style="align-items:center;gap:10px">
        <span class="eyebrow">В пабе — покажите бармену</span>
        <div id="loy-qr" class="loy-qr">${qrSvg(qrPayload(L.card_no, L.secret), 220)}</div>
        <span class="muted" style="font-size:12px" id="loy-qr-tick">Код обновляется каждые 30 секунд</span>
        <span class="muted" style="font-size:12px">Не сканируется? Назовите номер карты или телефон.</span>
      </section>`}
    <section class="card stack" style="gap:8px">
      <span class="eyebrow">Как копить</span>
      ${tiers.map((x) => `<div class="sum-row"><span>${esc(x.name)}${x.from ? ` <span class="muted">· от ${rub(x.from)}</span>` : ''}</span><b>${esc(x.pct)}%</b></div>`).join('')}
      <span class="muted" style="font-size:12px;line-height:1.6">
        ${st.app_enabled ? `За заказ в приложении — после доставки${st.app_min_order ? `, от ${rub(st.app_min_order)}` : ''}. ` : ''}${st.venue_enabled ? 'В пабе — по QR-коду при расчёте. ' : ''}
        Уровень — по сумме покупок${st.period_days ? ` за последние ${esc(st.period_days)} дней` : ' за всё время'}.
        1 балл = 1 ₽; баллами можно оплатить до ${esc(st.max_redeem_pct)}% заказа${st.accrue_if_redeem === false ? ' — в этом случае на покупку баллы не начисляются' : ''}.
        ${st.accrue_delay_days ? `Баллы приходят через ${esc(st.accrue_delay_days)} дн. после покупки. ` : ''}${st.welcome_bonus ? `За выпуск карты — ${pts(st.welcome_bonus)} ${ptsWord(st.welcome_bonus)}. ` : ''}
        ${st.burn_after_days ? `Баллы сгорают, если ${esc(st.burn_after_days)} дней не было покупок. ` : ''}${st.birthday_bonus ? `В день рождения дарим ${pts(st.birthday_bonus)} ${ptsWord(st.birthday_bonus)}. ` : ''}
        ${st.rules_text ? esc(st.rules_text) : ''}
        ${doc('loyalty', 'Правила программы')}.
      </span>
    </section>
    ${(L.history || []).length ? `<section class="stack" style="gap:8px"><span class="eyebrow">История</span>
      <div class="menu-group">${L.history.slice(0, 20).map((h) => `<div class="menu-row" style="cursor:default">
        <span class="stack" style="gap:2px"><span>${LOY_KIND[h.kind] || esc(h.kind)}${LOY_SRC[h.source] ? ` · ${LOY_SRC[h.source]}` : ''}</span>
        <span class="muted" style="font-size:12px">${new Date(h.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}${h.venue ? ` · ${esc(h.venue)}` : ''}${h.note ? ` · ${esc(h.note)}` : ''}</span></span>
        <b style="color:${h.kind === 'pending' ? 'var(--muted)' : h.points >= 0 ? 'var(--ok)' : 'var(--text-2)'}">${h.points >= 0 ? '+' : ''}${pts(h.points)}</b></div>`).join('')}</div></section>` : ''}
  </main>`;
}
// QR обновляется каждые 30 секунд, пока открыт экран карты
let qrTimer = null;
function startCardQr() {
  clearInterval(qrTimer);
  qrTimer = setInterval(() => {
    const box = document.getElementById('loy-qr');
    if (!box || route() !== '/card' || !S.loy) return clearInterval(qrTimer);
    box.innerHTML = qrSvg(qrPayload(S.loy.card_no, S.loy.secret), 220);
  }, 30000);
}

// выбор паба для звонка
function callSheet() {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Позвонить в паб">
    <span class="grab"></span><h2 class="h2">Позвонить в паб</h2>
    <div class="menu-group">${S.venues.filter((v) => v.phone).map((v) => `<a class="menu-row" href="tel:${esc(v.phone.replace(/[^+\d]/g, ''))}">
      <span class="row">${icon.phone}<span class="stack" style="gap:2px"><span>${esc(v.name)}</span><span class="muted" style="font-size:12px">${esc(v.address)} · ${esc(fmtPhone(v.phone) || v.phone)}</span></span></span>${icon.chev}</a>`).join('')}</div>
    <button type="button" class="btn btn-ghost btn-block" data-close>Отмена</button>
  </div>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]') || e.target.closest('a')) setTimeout(() => wrap.remove(), 50); });
  document.body.appendChild(wrap);
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
        .map(([h, ic, t]) => `<a class="menu-row" href="legal/index.html#${h}"><span class="row">${ic}<span>${t}</span></span>${icon.chev}</a>`).join('')}
    </nav>
    <footer class="info-foot">
      © 2026 «<span data-act="secret">Патрики</span> Паб» · Санкт-Петербург<br>версия ${esc(CONFIG.APP_VERSION)}${BUILD ? ` · сборка ${BUILD}` : ''}${store.demo ? ' · демо' : ''}
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
      S.orders = []; S.history = null; S.loy = null; S.draftContact = null; S.addresses = [];
      S.verify = { step: 'phone', phone: '', until: 0, back: '/profile' };
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
  if (act === 'doc') { e.preventDefault(); return docSheet(b.dataset.h); }
  if (act === 'call') return callSheet();
  if (act === 'bonus') { saveCheckoutForm(); S.checkout.useBonus = b.checked; const y = window.scrollY; render(); window.scrollTo(0, y); return; }
  if (act === 'venue') { if (route() === '/checkout') saveCheckoutForm(); if (route() === '/booking') saveBookingForm(); S.venueId = id; keep.set('venue', id); render(); }
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
  if (act === 'bk-day') { saveBookingForm(); S.booking.day = v; render(); return; }
  if (act === 'bk-time') { saveBookingForm(); S.booking.time = v; render(); return; }
  if (act === 'bk-g') { saveBookingForm(); const max = venue().booking_max_guests || 12; S.booking.guests = Math.max(1, Math.min(max, S.booking.guests + Number(v))); render(); return; }
  if (act === 'bk-cancel') {
    if (!confirm('Отменить бронь?')) return;
    try { await store.cancelReservation(id); toast('Бронь отменена'); S.bookings = null; loadBookings(); } catch (ex) { toast(ex.message || 'Не удалось отменить'); }
    return;
  }
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
  if (act === 'verify-back') { clearTimeout(tgPoll); clearTimeout(inPoll); S.verify.step = 'phone'; S.verify.err = ''; render(); }
  if (act === 'in-call') { S.verify.called = true; const w = document.getElementById('in-wait'); if (w) w.textContent = 'Ждём ваш звонок…'; }
  if (act === 'in-retry') startIncoming(S.verify.phone, null, null);
  if (act === 'resend') startCall(S.verify.phone, null, null, v === 'sms' ? 'sms' : 'call');
  if (act === 'tg-start') { if (consentOk(b.closest('form'))) startTg(b); }
  if (act === 'tg-open') { S.verify.tgOpened = true; const w = document.getElementById('tg-wait'); if (w) w.textContent = 'Ждём подтверждения из Telegram…'; }
  if (act === 'logout') {
    await store.guestSignOut();
    S.history = null; S.loy = null; S.verify = { step: 'phone', phone: '', until: 0, back: '/profile' };
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
  if (f.id === 'booking') { e.preventDefault(); return submitBooking(f); }
  if (f.id === 'phone-form') {
    e.preventDefault();
    if (!consentOk(f)) return;
    return startIncoming(phone10(f.phone.value), f.querySelector('.error'), f.querySelector('[type=submit]'));
  }
  if (f.id === 'code-form') {
    e.preventDefault();
    const err = f.querySelector('.error'), btn = f.querySelector('[type=submit]');
    const code = f.code.value.replace(/\D/g, '');
    if (code.length !== 4) return (err.textContent = 'Введите 4 цифры');
    btn.disabled = true; btn.textContent = 'Проверяем…';
    try {
      const r = await store.callCheck(S.verify.phone, code);
      await finishVerify(r);
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

markReady(); // APK: «эта версия запустилась» — иначе плагин обновлений откатит её

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
  startUpdateChecks();
})();

// В Android-приложении (Capacitor) файлы уже лежат внутри APK — service worker не нужен
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// вернулись в приложение (например, после оплаты в пабе) — обновляем баллы
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && route() === '/verify' && S.verify.step === 'in' && !S.verify.failed) pollIn();
  if (document.hidden || !S.loy) return;
  S.loyAt = 0;
  if (['/', '/profile', '/card'].includes(route())) loadLoyalty();
});
