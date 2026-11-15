// Сайт «Патрики Паб» (веселый-патрик.рф). Та же база и те же правила, что у приложения:
// меню, доставка, бронь, вход по номеру телефона, карта гостя — через js/store.js (копия из patriki-app).
// Своё у сайта: новости и акции (таблица news) и заявки на мероприятия (submit_event_request).
import { store } from './store.js';
import { CONFIG } from './config.js';
import { HERO_IMG } from './seed.js';
import { qrSvg, qrPayload } from './loyalty.js';

/* ---------- утилиты ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/,/g, ' ')} ₽`;
const pts = (n) => Number(n || 0).toLocaleString('ru-RU');
const ptsWord = (n) => { n = Math.abs(n) % 100; const d = n % 10; return n > 10 && n < 20 ? 'баллов' : d === 1 ? 'балл' : d >= 2 && d <= 4 ? 'балла' : 'баллов'; };
const keep = {
  get(k, d) { try { const v = localStorage.getItem('patriki.site.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('patriki.site.' + k, JSON.stringify(v)); } catch { /* недоступно */ } },
};
function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function phone10(s) { let d = String(s || '').replace(/\D/g, ''); if (d.length > 10 && /^[78]/.test(d)) d = d.slice(1); return d.slice(0, 10); }
function fmtPhone(s) {
  const d = phone10(s); if (!d) return '';
  let r = '+7 (' + d.slice(0, 3);
  if (d.length >= 3) r += ') ' + d.slice(3, 6);
  if (d.length >= 6) r += '-' + d.slice(6, 8);
  if (d.length >= 8) r += '-' + d.slice(8, 10);
  return r;
}
const telHref = (p) => 'tel:' + String(p || '').replace(/[^+\d]/g, '');
const PHONE_PH = '+7 (___) ___-__-__';
document.addEventListener('focusin', (e) => { const el = e.target; if (!el.matches?.('input[data-phone]')) return; if (!el.value) el.value = '+7 ('; el.dataset.prev = phone10(el.value); });
document.addEventListener('focusout', (e) => { const el = e.target; if (!el.matches?.('input[data-phone]')) return; if (!phone10(el.value)) el.value = ''; });
document.addEventListener('input', (e) => {
  const el = e.target; if (!el.matches?.('input[data-phone]')) return;
  const raw = el.value; let d = raw.replace(/\D/g, '');
  if (raw.startsWith('+7')) d = d.slice(1);
  if (d.length > 10 && /^[78]/.test(d)) d = d.slice(1);
  d = d.slice(0, 10);
  if (e.inputType === 'deleteContentBackward' && d === el.dataset.prev) d = d.slice(0, -1);
  el.dataset.prev = d; el.value = d ? fmtPhone(d) : '+7 (';
});

const I = (p, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${p}</svg>`;
const icon = {
  cal: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  bag: I('<path d="M5 7h14l-1.5 12h-11z"/><path d="M9 7a3 3 0 0 1 6 0"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', 20),
  card: I('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>'),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pin: I('<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  phone: I('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 18),
  truck: I('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
  party: I('<path d="M4 20l5-14 9 9z"/><path d="M14 4v2M19 9h2M17 6l1.5-1.5M10 11l3 3"/>'),
  star: I('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  check: I('<path d="M5 12l5 5 9-10"/>', 14),
  back: I('<path d="M15 6l-6 6 6 6"/>', 20),
  x: I('<path d="M6 6l12 12M18 6L6 18"/>', 20),
  tg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.9 4.3 18.7 19.5c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6.2 13.2l-4.9-1.5c-1-.3-1.1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3z"/></svg>',
};
const photo = (url, cls = '', alt = '') => url
  ? `<div class="photo ph ${cls}"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" onerror="this.remove()"></div>`
  : `<div class="photo ph ${cls}" aria-hidden="true"></div>`;
const loader = (t = 'Загружаем…') => `<div class="pk-loader" role="status"><img src="img/emblem.svg" alt=""><span>${esc(t)}</span></div>`;
const LEGAL = 'https://patrikipab.ru/legal/';
const doc = (hash, text) => `<a href="${LEGAL}#${hash}" target="_blank" rel="noopener">${text}</a>`;

/* ---------- состояние ---------- */
const S = {
  ready: false, categories: [], items: [], venues: [],
  venueId: keep.get('venue', 'petrogradka'),
  cart: keep.get('cart', {}),
  orders: keep.get('orders', []),
  me: null, profile: { name: '', phone: '', birthday: null }, addresses: [],
  loy: null, bookings: null, history: null, myEvents: null,
  news: null,
  checkout: { when: 'asap', time: '', payment: 'card', addr: null, comment: '', noCall: false },
  draftAddr: { street: '', flat: '', entrance: '', floor: '', intercom: '', save: true },
  draftContact: null,
  booking: { guests: 2, day: '', time: '', comment: '', venue: '' },
  ev: { kind: '', venue: '', format: '', sent: null },
  verify: { step: 'phone', phone: '', back: '/account' },
  accTab: 'card',
  newsFilter: 'all',
};
const venue = () => S.venues.find((v) => v.id === S.venueId) || S.venues[0] || {};
const itemById = (id) => S.items.find((x) => x.id === id);
const onSale = (x) => x && x.available !== false && !(x.stop_in || []).includes(S.venueId);
const cartLines = () => Object.entries(S.cart).map(([id, qty]) => ({ item: itemById(id), qty })).filter((l) => onSale(l.item) && l.qty > 0);
const cartCount = () => cartLines().reduce((s, l) => s + l.qty, 0);
const cartSum = () => cartLines().reduce((s, l) => s + l.qty * l.item.price, 0);
function setQty(id, qty) { if (qty <= 0) delete S.cart[id]; else S.cart[id] = Math.min(qty, 50); keep.set('cart', S.cart); }
const addrLine = (a) => [a.street, a.flat && `кв. ${a.flat}`, a.entrance && `под. ${a.entrance}`, a.floor && `эт. ${a.floor}`, a.intercom && `домофон ${a.intercom}`].filter(Boolean).join(', ');
const verified = () => !!S.me?.verified;

/* ---------- согласие на обработку ПД (та же редакция, что в приложении) ---------- */
const CV = CONFIG.LEGAL.CONSENT_VERSION;
const hasPdConsent = () => S.profile.pd_consent_version === CV || keep.get('pdConsent', '') === CV;
const ConsentBox = () => hasPdConsent() ? '' : `<label class="check"><input type="checkbox" name="pdConsent">
  <span>Даю ${doc('consent', 'согласие на обработку персональных данных')} в соответствии с ${doc('privacy', 'Политикой')}</span></label>`;
async function grantPd(source) {
  keep.set('pdConsent', CV);
  if (S.profile.pd_consent_version === CV) return;
  try { await store.recordConsent('pd', true, CV, source); S.profile = { ...S.profile, pd_consent_version: CV }; } catch (e) { console.warn(e); }
}
const consentOk = (form) => hasPdConsent() || !!form?.pdConsent?.checked;

/* ---------- данные ---------- */
async function loadGuest() {
  try {
    S.me = await store.me();
    S.profile = await store.getProfile();
    S.addresses = await store.listAddresses();
  } catch (e) { console.warn('Профиль не загрузился', e); }
  updateHead();
}
async function loadLoyalty(force = false) {
  if (S.loy && !force) return;
  try { S.loy = await store.myLoyalty(); } catch (e) { console.warn(e); S.loy = null; }
  updateHead(); rerenderIf(['/account', '/checkout']);
}
const loyActive = () => S.loy && S.loy.settings?.enabled && (!S.loy.settings.verified_only || S.loy.verified);
async function loadNews() {
  try { S.news = await store.listNews(); } catch (e) { console.warn(e); S.news = []; }
  rerenderIf(['/', '/news', '/events']);
}

/* ---------- маршрутизация ---------- */
const app = document.getElementById('app');
const route = () => (location.hash.replace(/^#/, '').split('?')[0] || '/');
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
const rerenderIf = (list) => { const r = route(); if (list.some((x) => (x.endsWith('/') && x !== '/' ? r.startsWith(x) : r === x))) render(false); };
let lastRoute = null;

function render(scroll = true) {
  const r = route();
  let html;
  if (!S.ready) html = loader('Разжигаем смокер…');
  else if (r === '/') html = Home();
  else if (r === '/menu' || r === '/delivery') html = MenuPage(r === '/delivery');
  else if (r === '/cart') html = Cart();
  else if (r === '/checkout') html = Checkout();
  else if (r.startsWith('/order/')) html = OrderStatus(r.slice(7));
  else if (r.startsWith('/pay-test/')) html = PayTest(r.slice(10));
  else if (r === '/booking') html = Booking();
  else if (r === '/events') html = Events();
  else if (r === '/news') html = News();
  else if (r.startsWith('/news/')) html = NewsItem(r.slice(6));
  else if (r === '/contacts') html = Contacts();
  else if (r === '/login') html = Login();
  else if (r === '/account') html = Account();
  else html = `<div class="wrap page"><h1 class="h1">Страница не найдена</h1><a class="btn btn-accent" href="#/" style="align-self:flex-start">На главную</a></div>`;
  app.innerHTML = html;
  const changed = r !== lastRoute; lastRoute = r;
  if (changed && scroll) window.scrollTo({ top: 0, behavior: 'instant' });
  if (changed) document.title = TITLES[r.split('/')[1] || ''] || TITLES[''];
  updateHead();
  after(r, changed);
}
const TITLES = {
  '': 'Патрики Паб — ирландский паб в Санкт-Петербурге и Мурино: бронь, доставка, банкеты',
  menu: 'Меню — Патрики Паб', delivery: 'Доставка из паба — Патрики Паб', booking: 'Бронь стола — Патрики Паб',
  events: 'Банкеты, дни рождения, корпоративы и аренда зала — Патрики Паб', news: 'Новости и акции — Патрики Паб',
  contacts: 'Контакты и адреса — Патрики Паб', login: 'Вход по номеру телефона — Патрики Паб', account: 'Личный кабинет — Патрики Паб',
  cart: 'Корзина — Патрики Паб', checkout: 'Оформление заказа — Патрики Паб', order: 'Заказ — Патрики Паб',
};

function after(r, changed) {
  if (r === '/account') {
    if (!S.loy) loadLoyalty();
    if (S.bookings === null) { S.bookings = false; store.myReservations().then((l) => { S.bookings = l; rerenderIf(['/account']); }).catch(() => { S.bookings = []; }); }
    if (S.history === null) { S.history = false; store.myOrders().then((l) => { S.history = l; rerenderIf(['/account']); }).catch(() => { S.history = []; }); }
    if (S.myEvents === null) { S.myEvents = false; store.myEventRequests().then((l) => { S.myEvents = l; rerenderIf(['/account']); }).catch(() => { S.myEvents = []; }); }
    if (S.accTab === 'card') startCardQr();
  }
  if (r === '/checkout' && !S.loy) loadLoyalty();
  if (r.startsWith('/order/')) pollOrder(r.slice(7), changed);
  if (r === '/login') tickVerify();
  if (r === '/events' && changed) {
    const k = hashParams().get('k'); if (k && KINDS.some((x) => x.id === k)) { S.ev.kind = k; setTimeout(() => document.getElementById('ev-form')?.scrollIntoView(), 50); render(false); }
  }
  if ((r === '/menu' || r === '/delivery') && changed) { const c = hashParams().get('c'); if (c) setTimeout(() => document.getElementById('cat-' + c)?.scrollIntoView(), 30); }
}

function updateHead() {
  const n = S.ready ? cartCount() : 0;
  const hc = document.getElementById('head-cart');
  if (hc) hc.innerHTML = icon.bag + (n ? `<span class="badge">${n}</span>` : '');
  const hl = document.getElementById('head-login');
  if (hl) {
    if (verified()) { hl.href = '#/account'; hl.innerHTML = `${icon.user}<span>${loyActive() ? `${pts(S.loy.balance)} ${ptsWord(S.loy.balance)}` : 'Кабинет'}</span>`; }
    else { hl.href = '#/login'; hl.innerHTML = `${icon.user}<span>Войти</span>`; }
  }
  const r = route();
  document.querySelectorAll('[data-nav]').forEach((a) => a.setAttribute('aria-current', r === a.dataset.nav ? 'page' : 'false'));
  const cb = document.getElementById('cartbar');
  const show = n > 0 && ['/', '/menu', '/delivery'].includes(r);
  cb.classList.toggle('show', show); document.body.classList.toggle('has-cartbar', show);
  if (show) cb.innerHTML = `<span>${icon.bag} Корзина · ${n}</span><span>${rub(cartSum())}</span>`;
}

/* ---------- блюда ---------- */
const Stepper = (id, q) => q > 0
  ? `<span class="qty"><button type="button" data-act="dec" data-id="${esc(id)}" aria-label="Убрать одну">−</button><span>${q}</span><button type="button" data-act="inc" data-id="${esc(id)}" aria-label="Добавить ещё">+</button></span>`
  : `<button type="button" class="add" data-act="inc" data-id="${esc(id)}" aria-label="В корзину">+ <span class="t">В корзину</span></button>`;
function Dish(x) {
  const sale = onSale(x);
  return `<article class="dish${sale ? '' : ' off'}">
    <div style="position:relative" data-act="item" data-id="${esc(x.id)}">${photo(x.image_url, '', x.name)}${x.popular ? '<span class="hit">Хит</span>' : ''}</div>
    <div class="dish-body">
      <span class="dish-name" data-act="item" data-id="${esc(x.id)}">${esc(x.name)}</span>
      ${x.description ? `<span class="dish-desc">${esc(x.description)}</span>` : ''}
      ${x.weight ? `<span class="dish-desc">${esc(x.weight)}</span>` : ''}
      <div class="dish-foot"><span class="price">${rub(x.price)}</span>${sale ? Stepper(x.id, S.cart[x.id] || 0) : '<span class="muted small">нет в наличии</span>'}</div>
    </div></article>`;
}
function openItem(id) {
  const x = itemById(id); if (!x) return;
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap';
  const draw = () => {
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(x.name)}" style="position:relative">
      <button type="button" class="icon-btn x" data-close aria-label="Закрыть">${icon.x}</button>
      ${photo(x.image_url, '', x.name)}
      <div class="mb">
        <h2 class="h3">${esc(x.name)}</h2>
        ${x.weight ? `<span class="muted">${esc(x.weight)}</span>` : ''}
        ${x.description ? `<p style="margin:0;color:var(--text-2)">${esc(x.description)}</p>` : ''}
        ${x.composition ? `<div class="small"><span class="eyebrow">Состав</span><br><span style="color:var(--text-2)">${esc(x.composition)}</span></div>` : ''}
        ${x.nutrition ? `<div class="small"><span class="eyebrow">КБЖУ</span><br><span style="color:var(--text-2)">${esc(typeof x.nutrition === 'string' ? x.nutrition : Object.entries(x.nutrition).map(([k, v]) => `${k}: ${v}`).join(' · '))}</span></div>` : ''}
        ${x.allergens ? `<div class="small"><span class="eyebrow">Аллергены</span><br><span style="color:var(--text-2)">${esc(Array.isArray(x.allergens) ? x.allergens.join(', ') : x.allergens)}</span></div>` : ''}
        <div class="between" style="margin-top:6px"><span class="price" style="font-size:26px">${rub(x.price)}</span>${onSale(x) ? Stepper(x.id, S.cart[x.id] || 0) : '<span class="muted">нет в наличии</span>'}</div>
      </div></div>`;
  };
  draw();
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) return wrap.remove();
    const b = e.target.closest('[data-act="inc"],[data-act="dec"]');
    if (b) { e.stopPropagation(); setQty(x.id, (S.cart[x.id] || 0) + (b.dataset.act === 'inc' ? 1 : -1)); draw(); render(false); }
  });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { wrap.remove(); document.removeEventListener('keydown', k); } });
  document.body.appendChild(wrap);
}

/* ---------- главная ---------- */
function Home() {
  const hits = S.items.filter((x) => x.popular && x.available !== false).slice(0, 8);
  const list = (hits.length >= 4 ? hits : S.items.filter((x) => x.available !== false).slice(0, 8));
  const news = (S.news || []).slice(0, 3);
  return `
  <section class="hero">
    <div class="hero-bg" style="background-image:url('${esc(HERO_IMG)}')"></div>
    <div class="wrap">
      <div class="hero-tags"><span class="tag gold">Ирландский паб</span><span class="tag">Петроградка</span><span class="tag">Мурино</span><span class="tag">12:00–01:00</span></div>
      <h1 class="h1">Мясо из <em>смокера</em>, пиво и праздники, которые помнят</h1>
      <p class="lead">Брискет, копчёные крылья, бургеры и пельмени ручной лепки. Забронируйте стол, закажите доставку или соберите своих на день рождения и корпоратив.</p>
      <div class="row" style="margin-top:6px">
        <a class="btn btn-accent" href="#/booking">${icon.cal} Забронировать стол</a>
        <a class="btn btn-outline" href="#/delivery">${icon.truck} Заказать доставку</a>
        <a class="btn btn-ghost" href="#/events">${icon.party} Праздник у нас</a>
      </div>
    </div>
  </section>
  <div class="wrap page">
    <section class="grid g4">
      <a class="card card-link feature" href="#/delivery"><span class="ic">${icon.truck}</span><span class="h3">Доставка бесплатно</span><p>Примерно за ${esc(venue().eta_minutes || 45)} минут по Петроградской стороне. Оплата онлайн, картой или наличными.</p></a>
      <a class="card card-link feature" href="#/booking"><span class="ic">${icon.cal}</span><span class="h3">Бронь за минуту</span><p>Выберите паб, дату, время и число гостей — администратор подтвердит бронь.</p></a>
      <a class="card card-link feature" href="#/account"><span class="ic">${icon.card}</span><span class="h3">Карта гостя</span><p>${loyText()}</p></a>
      <a class="card card-link feature" href="#/events"><span class="ic">${icon.party}</span><span class="h3">Банкеты и аренда</span><p>Дни рождения, корпоративы, свадьбы. Часть зала или весь паб — под ваш формат.</p></a>
    </section>

    <section class="stack" style="gap:18px">
      <div class="sec-head"><div class="stack" style="gap:4px"><span class="eyebrow accent">Хиты паба</span><h2 class="h2">Из смокера и не только</h2></div><a href="#/menu">Всё меню →</a></div>
      <div class="dishes">${list.map(Dish).join('')}</div>
    </section>

    ${EventsTeaser()}

    ${news.length ? `<section class="stack" style="gap:18px">
      <div class="sec-head"><div class="stack" style="gap:4px"><span class="eyebrow accent">Новости и акции</span><h2 class="h2">Что у нас происходит</h2></div><a href="#/news">Все новости →</a></div>
      <div class="grid g3">${news.map(NewsCard).join('')}</div>
    </section>` : ''}

    <section class="stack" style="gap:18px">
      <div class="sec-head"><div class="stack" style="gap:4px"><span class="eyebrow accent">Где мы</span><h2 class="h2">Два паба</h2></div><a href="#/contacts">Контакты и карта →</a></div>
      <div class="grid g2">${S.venues.map((v) => VenueCard(v, false)).join('')}</div>
    </section>

    <section class="card app-strip">
      <div class="stack" style="gap:6px;max-width:620px"><span class="eyebrow accent">Приложение</span><h2 class="h3">Патрики в телефоне</h2>
        <span style="color:var(--text-2)">Те же меню, бронь и баллы — в приложении для iPhone и Android. Вход по тому же номеру: баллы и заказы общие с сайтом.</span></div>
      <a class="btn btn-accent" href="https://patrikipab.ru/get/" target="_blank" rel="noopener">Установить приложение</a>
    </section>
  </div>`;
}
function loyText() {
  const st = S.loy?.settings || S.loyPublic;
  const tiers = st?.tiers?.length ? [...st.tiers].sort((a, b) => a.pct - b.pct) : null;
  if (tiers) return `Возвращаем ${tiers[0].pct}–${tiers[tiers.length - 1].pct}% баллами. Вход по номеру телефона — баланс и QR-код прямо на сайте.`;
  return 'Копите баллы с каждого заказа и визита. Вход по номеру телефона — баланс и QR-код прямо на сайте.';
}
// Точки на Яндекс Картах: Петроградка — карточка организации «Патрики Паб», Мурино — дом (паб ещё не на картах)
const MAPS = {
  petrogradka: { oid: '13394987565', ll: '30.314997,59.937374', link: 'https://yandex.ru/maps/org/patriki_pab/13394987565/' },
  murino: { ll: '30.438668,60.060173', link: 'https://yandex.ru/maps/?pt=30.438668,60.060173&z=17&l=map' },
};
function mapSrc(v) {
  const m = MAPS[v.id];
  if (m?.oid) return `https://yandex.ru/map-widget/v1/?oid=${m.oid}&ol=biz&z=16`;
  if (m) return `https://yandex.ru/map-widget/v1/?ll=${m.ll}&pt=${m.ll},pm2rdl&z=16`;
  return `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(v.address || '')}&z=16`;
}
const routeHref = (v) => (MAPS[v.id] ? `https://yandex.ru/maps/?rtext=~${MAPS[v.id].ll.split(',').reverse().join(',')}&rtt=auto` : `https://yandex.ru/maps/?text=${encodeURIComponent(v.address || '')}`);
function VenueCard(v, map = true) {
  return `<article class="card venue-card">
    <div class="between"><span class="h3">${esc(v.name)}</span>${v.accepting === false ? '<span class="pill gold">скоро открытие</span>' : '<span class="pill ok">открыто</span>'}</div>
    <span style="color:var(--text-2)">${icon.pin} ${esc(v.address)}</span>
    <span class="muted small">Ежедневно ${esc(v.hours || '12:00–01:00')}${v.zone && v.accepting !== false ? ` · доставка: ${esc(v.zone)}` : ''}</span>
    ${map ? `<div class="map"><iframe loading="lazy" title="Карта: ${esc(v.name)}" src="${esc(mapSrc(v))}"></iframe></div>` : ''}
    <div class="row">
      ${v.phone ? `<a class="btn btn-ghost btn-sm" href="${telHref(v.phone)}">${icon.phone} ${esc(v.phone)}</a>` : ''}
      <a class="btn btn-ghost btn-sm" href="${esc(routeHref(v))}" target="_blank" rel="noopener">${icon.pin} Маршрут</a>
      <a class="btn btn-accent btn-sm" href="#/booking" data-act="bk-venue-go" data-id="${esc(v.id)}">Забронировать</a>
    </div>
  </article>`;
}

/* ---------- меню и доставка ---------- */
function VenueSwitch(label = 'Доставка из паба') {
  return `<div class="stack" style="gap:6px"><span class="eyebrow">${label}</span><div class="seg" role="group">${S.venues.map((v) => `<button type="button" data-act="venue" data-id="${esc(v.id)}" aria-pressed="${v.id === S.venueId}">${esc(v.name)}<small>${v.accepting === false ? 'скоро' : esc(v.zone || v.address)}</small></button>`).join('')}</div></div>`;
}
function MenuPage(delivery) {
  const v = venue();
  const cats = S.categories.filter((c) => S.items.some((x) => x.category_id === c.id));
  return `<div class="wrap page">
    <div class="sec-head">
      <div class="stack" style="gap:8px"><span class="eyebrow accent">${delivery ? 'Доставка' : 'Меню паба'}</span>
        <h1 class="h1">${delivery ? 'Доставка из паба' : 'Меню'}</h1>
        <p class="lead">${delivery
          ? `Привезём горячим примерно за ${esc(v.eta_minutes || 45)} минут. ${v.delivery_fee ? `Доставка ${rub(v.delivery_fee)}` : 'Доставка бесплатная'}${v.min_order ? `, заказ от ${rub(v.min_order)}` : ''}. Еда и безалкогольные напитки — алкоголь по закону продаём только в зале.`
          : 'Блюда из смокера, бургеры, закуски к пиву и горячее. Все позиции можно заказать с доставкой или попробовать в пабе.'}</p></div>
      ${VenueSwitch(delivery ? 'Откуда везём' : 'Меню и наличие в пабе')}
    </div>
    ${v.accepting === false ? `<div class="card" style="border-color:var(--accent)"><b>Паб «${esc(v.name)}» скоро откроется.</b> <span style="color:var(--text-2)">Заказ с доставкой пока можно оформить из паба «${esc(S.venues.find((x) => x.accepting !== false)?.name || '')}».</span></div>` : ''}
    <div class="chips" role="navigation" aria-label="Разделы меню">${cats.map((c) => `<a class="chip" href="#${route()}?c=${esc(c.id)}" data-act="cat" data-id="${esc(c.id)}">${esc(c.name)}</a>`).join('')}</div>
    <div class="menu-layout">
      <nav class="cat-nav" aria-label="Разделы меню">${cats.map((c) => `<a href="#${route()}?c=${esc(c.id)}" data-act="cat" data-id="${esc(c.id)}">${esc(c.name)}</a>`).join('')}
        ${cartCount() ? `<a class="btn btn-accent btn-sm" href="#/cart" style="margin-top:14px;color:#0E0E0D">Корзина · ${rub(cartSum())}</a>` : ''}</nav>
      <div>${cats.map((c) => `<section class="cat-block" id="cat-${esc(c.id)}"><h2 class="h3">${esc(c.name)}</h2>
        <div class="dishes">${S.items.filter((x) => x.category_id === c.id).map(Dish).join('')}</div></section>`).join('')}</div>
    </div>
  </div>`;
}

/* ---------- корзина и оформление ---------- */
const canOrder = () => cartCount() > 0 && venue().accepting !== false && !(venue().min_order && cartSum() < venue().min_order);
function Cart() {
  const lines = cartLines(), v = venue();
  if (!lines.length) return `<div class="wrap page"><h1 class="h1">Корзина</h1>
    <div class="empty">${icon.bag}<span>Пока пусто. Загляните в меню — там брискет и крылья из смокера.</span><a class="btn btn-accent" href="#/delivery">Открыть меню</a></div></div>`;
  return `<div class="wrap page"><h1 class="h1">Корзина</h1>
    <div class="two-col">
      <div class="stack" style="gap:0">${lines.map(({ item, qty }) => `<div class="line">${photo(item.image_url, '', item.name)}
        <div class="stack" style="gap:2px;flex:1;min-width:0"><span style="font-weight:600">${esc(item.name)}</span><span class="muted small">${rub(item.price)} × ${qty}</span></div>
        ${Stepper(item.id, qty)}<b class="price" style="min-width:90px;text-align:right">${rub(item.price * qty)}</b></div>`).join('')}
        <a href="#/delivery" class="btn btn-ghost btn-sm" style="align-self:flex-start;margin-top:16px">+ Добавить ещё</a>
      </div>
      <aside class="card stack">
        ${VenueSwitch('Откуда везём')}
        <div class="sum-row"><span>Блюда</span><span>${rub(cartSum())}</span></div>
        <div class="sum-row"><span>Доставка</span><span>${v.delivery_fee ? rub(v.delivery_fee) : 'бесплатно'}</span></div>
        <div class="total"><span class="h3">Итого</span><b>${rub(cartSum() + (v.delivery_fee || 0))}</b></div>
        ${v.accepting === false ? `<span class="error">«${esc(v.name)}» пока не принимает заказы — выберите другой паб</span>` : v.min_order && cartSum() < v.min_order ? `<span class="error">Минимальный заказ — ${rub(v.min_order)}</span>` : ''}
        <a class="btn btn-accent btn-block" href="#/checkout" ${canOrder() ? '' : 'aria-disabled="true" style="pointer-events:none;opacity:.45"'}>Оформить заказ</a>
      </aside>
    </div></div>`;
}

function Checkout() {
  if (!canOrder()) { setTimeout(() => { location.hash = '#/cart'; }); return ''; }
  const k = S.checkout, v = venue(), d = S.draftAddr;
  if (k.payment === 'online' && !v.pay_online) k.payment = 'card';
  if (!k.payChosen && v.pay_online) k.payment = 'online';
  const c = S.draftContact || { name: S.profile.name, phone: S.profile.phone || (S.me?.phone ? fmtPhone(S.me.phone) : '') };
  if (k.addr === null) k.addr = S.addresses[0]?.id || 'new';
  const isNew = k.addr === 'new' || !S.addresses.find((a) => a.id === k.addr);
  const st = S.loy?.settings || {};
  const redeemMax = loyActive() ? Math.max(0, Math.min(S.loy.balance, Math.floor(cartSum() * (st.max_redeem_pct || 0) / 100))) : 0;
  const redeem = k.useBonus ? redeemMax : 0;
  const total = cartSum() + (v.delivery_fee || 0) - redeem;
  const noEarn = redeem > 0 && st.accrue_if_redeem === false;
  const earn = !noEarn && loyActive() && st.app_enabled && cartSum() - redeem >= Math.max(st.app_min_order || 0, 1) ? Math.floor((cartSum() - redeem) * (S.loy.tier?.pct || 0) / 100) : 0;
  return `<div class="wrap page">
    <div class="row"><a class="icon-btn" href="#/cart" aria-label="Назад в корзину">${icon.back}</a><h1 class="h1" style="font-size:clamp(30px,4vw,44px)">Оформление</h1></div>
    <form id="checkout" class="two-col" novalidate>
      <div class="stack" style="gap:26px">
        <section class="stack">${VenueSwitch('Откуда везём')}<span class="muted small">Заказ получит паб «${esc(v.name)}» — доставка: ${esc(v.zone || '')}.</span></section>
        <section class="stack"><span class="eyebrow">Куда доставить</span>
          ${S.addresses.length ? `<div class="stack" role="radiogroup">${S.addresses.slice(0, 5).map((a) => `<button type="button" class="addr-opt" role="radio" aria-checked="${k.addr === a.id}" data-act="pick-addr" data-id="${esc(a.id)}"><span class="radio-dot"></span><span>${esc(addrLine(a))}</span></button>`).join('')}
            <button type="button" class="addr-opt" role="radio" aria-checked="${isNew}" data-act="pick-addr" data-id="new"><span class="radio-dot"></span><span>Новый адрес</span></button></div>` : ''}
          ${isNew ? `<label class="field">Улица и дом<input class="input" name="street" autocomplete="street-address" required placeholder="Большая Пушкарская, 10" value="${esc(d.street)}"></label>
            <div class="form-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
              <label class="field">Квартира<input class="input" name="flat" value="${esc(d.flat)}"></label>
              <label class="field">Подъезд<input class="input" name="entrance" value="${esc(d.entrance)}"></label>
              <label class="field">Этаж<input class="input" name="floor" value="${esc(d.floor)}"></label>
              <label class="field">Домофон<input class="input" name="intercom" value="${esc(d.intercom)}"></label>
            </div>
            <label class="check"><input type="checkbox" name="saveAddr" ${d.save ? 'checked' : ''}><span>Запомнить адрес</span></label>` : ''}
        </section>
        <section class="stack"><span class="eyebrow">Контакты</span>
          <div class="form-grid">
            <label class="field">Имя<input class="input" name="name" autocomplete="name" required value="${esc(c.name)}"></label>
            <label class="field">Телефон<input class="input" name="phone" type="tel" autocomplete="tel" data-phone required placeholder="${PHONE_PH}" value="${esc(fmtPhone(c.phone))}"></label>
          </div>
          ${verified() && phone10(c.phone) === phone10(S.me.phone) ? `<span class="ok-note">${icon.check} Номер подтверждён</span>` : !verified() ? `<span class="muted small"><a href="#/login" data-act="login-from" data-back="/checkout">Войдите по номеру</a> — заказ попадёт в историю, а баллы начислятся на карту гостя.</span>` : ''}
          <label class="check"><input type="checkbox" name="noCall" ${k.noCall ? 'checked' : ''}><span>Не звонить для подтверждения заказа</span></label>
        </section>
        <section class="stack"><span class="eyebrow">Когда</span>
          <div class="row"><button type="button" class="opt" data-act="when" data-v="asap" aria-pressed="${k.when === 'asap'}">Как можно скорее</button><button type="button" class="opt" data-act="when" data-v="time" aria-pressed="${k.when === 'time'}">Ко времени</button></div>
          ${k.when === 'time' ? `<label class="field" style="max-width:220px">Время доставки<input class="input" name="time" type="time" value="${esc(k.time)}" required></label>` : `<span class="muted small">Привезём примерно за ${esc(v.eta_minutes || 45)} мин</span>`}
        </section>
        <section class="stack"><span class="eyebrow">Оплата</span>
          ${v.pay_online ? `<button type="button" class="opt opt-wide" data-act="pay" data-v="online" aria-pressed="${k.payment === 'online'}"><span class="stack" style="gap:2px"><b>Картой или СБП онлайн</b><span class="muted small">Спишем, когда паб примет заказ</span></span></button>` : ''}
          <div class="row"><button type="button" class="opt" data-act="pay" data-v="card" aria-pressed="${k.payment === 'card'}">Картой курьеру</button><button type="button" class="opt" data-act="pay" data-v="cash" aria-pressed="${k.payment === 'cash'}">Наличными</button></div>
        </section>
        ${redeemMax > 0 ? `<section class="stack"><span class="eyebrow">Баллы · на карте ${pts(S.loy.balance)}</span>
          <label class="check"><input type="checkbox" name="useBonus" data-act="bonus" ${k.useBonus ? 'checked' : ''}><span>Оплатить баллами ${pts(redeemMax)} ₽ <span class="muted">(до ${esc(st.max_redeem_pct)}% заказа)</span></span></label></section>` : ''}
        <label class="field">Комментарий к заказу<textarea class="textarea" name="comment" placeholder="Приборы, пожелания">${esc(k.comment)}</textarea></label>
      </div>
      <aside class="card stack">
        <span class="eyebrow">Ваш заказ</span>
        ${cartLines().map(({ item, qty }) => `<div class="sum-row"><span>${esc(item.name)} × ${qty}</span><span>${rub(item.price * qty)}</span></div>`).join('')}
        <div class="sum-row"><span>Доставка</span><span>${v.delivery_fee ? rub(v.delivery_fee) : 'бесплатно'}</span></div>
        ${redeem ? `<div class="sum-row"><span>Баллами</span><span>−${rub(redeem)}</span></div>` : ''}
        <div class="total"><span class="h3">К оплате</span><b>${rub(total)}</b></div>
        ${earn ? `<span class="muted small">После доставки начислим +${pts(earn)} ${ptsWord(earn)}</span>` : ''}
        ${ConsentBox()}
        <span class="muted small">Нажимая «Отправить заказ», вы принимаете условия ${doc('offer', 'публичной оферты')} и ${doc('terms', 'пользовательского соглашения')}.</span>
        <p id="co-err" class="error" role="alert"></p>
        <button class="btn btn-accent btn-block" type="submit">Отправить заказ · ${rub(total)}</button>
      </aside>
    </form></div>`;
}
function saveCheckoutForm() {
  const f = document.getElementById('checkout'); if (!f) return;
  const d = Object.fromEntries(new FormData(f));
  S.draftContact = { name: d.name || '', phone: d.phone || '' };
  if ('street' in d) S.draftAddr = { ...S.draftAddr, street: d.street || '', flat: d.flat || '', entrance: d.entrance || '', floor: d.floor || '', intercom: d.intercom || '', save: !!d.saveAddr };
  S.checkout.noCall = !!d.noCall; S.checkout.pdTick = !!d.pdConsent;
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
  const where = addrLine(addr).toLowerCase();
  if (S.venueId !== 'murino' && /мурин|девятк/.test(where)) return (err.textContent = 'Похоже, адрес в Мурино — выберите паб «Мурино»');
  if (!c.name.trim()) return (err.textContent = 'Укажите имя');
  if (phone10(c.phone).length !== 10) return (err.textContent = 'Введите номер полностью: +7 (XXX) XXX-XX-XX');
  if (k.when === 'time' && !k.time) return (err.textContent = 'Выберите время доставки');
  if (!hasPdConsent() && !k.pdTick) return (err.textContent = 'Отметьте согласие на обработку персональных данных');
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Отправляем…';
  try {
    await grantPd('site-checkout');
    const st = S.loy?.settings || {};
    const res = await store.placeOrder({
      venue_id: S.venueId, customer_name: c.name.trim(), phone: fmtPhone(c.phone),
      address: addrLine(addr), comment: [k.noCall ? '⚑ Не звонить для подтверждения' : '', '🌐 с сайта', k.comment.trim()].filter(Boolean).join('. '),
      when_text: k.when === 'asap' ? 'Как можно скорее' : `К ${k.time}`, payment: k.payment, pd_consent: CV,
      redeem: k.useBonus && loyActive() ? Math.max(0, Math.min(S.loy.balance, Math.floor(cartSum() * (st.max_redeem_pct || 0) / 100))) : 0,
      items: cartLines().map(({ item, qty }) => ({ item_id: item.id, name: item.name, price: item.price, qty })),
    });
    const online = k.payment === 'online';
    S.orders.unshift({ id: res.id, number: res.number, total: res.total, status: 'new', payment: k.payment, payment_status: online ? 'pending' : 'none', at: Date.now() });
    S.orders = S.orders.slice(0, 20); keep.set('orders', S.orders);
    S.cart = {}; keep.set('cart', S.cart);
    try {
      if (c.name.trim() !== S.profile.name || fmtPhone(c.phone) !== S.profile.phone) S.profile = await store.saveProfile({ ...S.profile, name: c.name, phone: fmtPhone(c.phone) });
      if (saved) await store.touchAddress(saved.id);
      else if (S.draftAddr.save) { await store.saveAddress(S.draftAddr); S.draftAddr = { street: '', flat: '', entrance: '', floor: '', intercom: '', save: true }; }
      S.addresses = await store.listAddresses();
    } catch (e2) { console.warn(e2); }
    S.history = null; S.loy = null; S.draftContact = null; S.checkout = { ...S.checkout, addr: null, comment: '', noCall: false, pdTick: false, useBonus: false };
    location.hash = '#/order/' + res.id;
    if (online) payNow(res.id);
  } catch (ex) {
    console.error(ex);
    err.textContent = 'Не получилось отправить заказ. Проверьте интернет или позвоните нам.';
    btn.disabled = false; btn.textContent = 'Отправить заказ';
  }
}

/* ---------- статус заказа и оплата ---------- */
const STATUS = [['new', 'Заказ принят'], ['cooking', 'Готовим'], ['delivering', 'Курьер в пути'], ['done', 'Доставлен']];
const STATUS_RU = { new: 'Принят', cooking: 'Готовим', delivering: 'В пути', done: 'Доставлен', cancelled: 'Отменён' };
function PaymentBlock(o) {
  if (o.payment !== 'online') return '';
  const ps = o.payment_status;
  const box = (title, text, btn = '') => `<div class="card stack"><b>${title}</b>${text ? `<span class="muted small">${text}</span>` : ''}${btn}</div>`;
  const payBtn = (l) => `<button type="button" class="btn btn-accent" data-act="pay-now" data-id="${esc(o.id)}" style="align-self:flex-start">${l} · ${rub(o.total)}</button>`;
  if (ps === 'held') return box('✓ Оплачено', 'Сумма заблокирована на карте. Спишем, когда паб примет заказ.');
  if (ps === 'paid') return box('✓ Оплачено', 'Деньги списаны.');
  if (ps === 'cancelled') return box('Блокировка снята', 'Деньги снова доступны на карте.');
  if (ps === 'refunded') return box('Деньги возвращены', 'Возврат обычно занимает от нескольких минут до 3–5 рабочих дней.');
  if (ps === 'failed') return box('Оплата не прошла', 'Попробуйте ещё раз или выберите другую карту.', payBtn('Оплатить снова'));
  return box('Ожидаем оплату', 'Заказ уйдёт в паб сразу после оплаты.', payBtn('Оплатить'));
}
async function payNow(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Открываем оплату…'; }
  try {
    const r = await store.startPayment(id, location.origin + location.pathname);
    if (r.formUrl) { location.href = r.formUrl; return; }
    if (r.already) { const o = S.orders.find((x) => x.id === id); if (o) o.payment_status = r.already; render(false); }
  } catch (ex) { toast('Не удалось открыть оплату: ' + ex.message, 4000); if (btn) { btn.disabled = false; btn.textContent = 'Оплатить'; } }
}
function PayTest(id) {
  const o = S.orders.find((x) => x.id === id) || {};
  return `<div class="wrap page"><div class="card stack" style="max-width:520px;margin:0 auto;gap:16px">
    <span class="eyebrow accent">Тестовая оплата · имитация Сбера</span>
    <span class="h3">Заказ №${esc(o.number || '')}</span>${o.total ? `<span class="price" style="font-size:32px">${rub(o.total)}</span>` : ''}
    <span class="muted small">Здесь будет страница Сбера. Сейчас деньги не списываются — выберите результат.</span>
    <button type="button" class="btn btn-accent" data-act="mock-pay" data-id="${esc(id)}" data-v="ok">Оплатить (тест)</button>
    <button type="button" class="btn btn-danger" data-act="mock-pay" data-id="${esc(id)}" data-v="fail">Отказ банка (тест)</button></div></div>`;
}
function OrderStatus(id) {
  const o = S.orders.find((x) => x.id === id) || (S.history || []).find((x) => x.id === id) || { id, number: '…', status: 'new' };
  const idx = Math.max(0, STATUS.findIndex(([k]) => k === o.status));
  const waitingPay = o.payment === 'online' && ['pending', 'failed'].includes(o.payment_status);
  return `<div class="wrap page" style="max-width:640px">
    <span class="eyebrow accent">Спасибо за заказ</span><h1 class="h1">Заказ №${esc(o.number)}</h1>
    ${PaymentBlock(o)}
    ${waitingPay ? '' : o.status === 'cancelled' ? '<div class="card"><span class="error">Заказ отменён. Если это ошибка — позвоните нам.</span></div>'
      : `<div class="card steps" aria-live="polite">${STATUS.map(([, label], i) => `<div class="step ${i <= idx ? 'done' : ''}"><span class="dot"></span>${label}</div>`).join('')}</div>`}
    <p class="muted" style="margin:0">Статус обновляется сам.</p>
    <div class="row"><a class="btn btn-ghost" href="${telHref(venue().phone)}">${icon.phone} Позвонить в паб</a><a class="btn btn-accent" href="#/menu">Вернуться в меню</a></div>
  </div>`;
}
let pollTimer = null;
function pollOrder(id, now) {
  clearTimeout(pollTimer);
  const o0 = S.orders.find((x) => x.id === id);
  const payWait = o0?.payment === 'online' && o0.payment_status === 'pending';
  pollTimer = setTimeout(async () => {
    if (route() !== '/order/' + id) return;
    try {
      const s = await store.getOrderStatus(id);
      let o = S.orders.find((x) => x.id === id);
      if (!o && s) { o = { id, ...s }; S.orders.unshift(o); }
      let ps = s?.payment_status;
      if (s?.payment === 'online' && ps === 'pending') { try { ps = (await store.paymentStatus(id)).payment_status; } catch { /* сеть */ } }
      if (s && o && (s.status !== o.status || ps !== o.payment_status || !o.payment || o.number === '…')) {
        Object.assign(o, { status: s.status, number: s.number ?? o.number, payment: s.payment, payment_status: ps, total: s.total ?? o.total });
        keep.set('orders', S.orders);
        if (hashParams().has('pay')) history.replaceState(null, '', location.pathname + '#/order/' + id);
        render(false); return;
      }
    } catch { /* сеть */ }
    if (hashParams().has('pay')) history.replaceState(null, '', location.pathname + '#/order/' + id);
    pollOrder(id, false);
  }, now || hashParams().has('pay') ? 300 : payWait ? 4000 : 15000);
}

/* ---------- бронь стола ---------- */
function bookingDays() {
  const out = [], now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getTime() + i * 864e5);
    out.push({ key: d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }), label: i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }) });
  }
  return out;
}
function bookingSlots(day) {
  const out = [];
  for (let h = 12; h <= 23; h++) for (const m of [0, 30]) {
    const t = `${String(h).padStart(2, '0')}:${m ? '30' : '00'}`;
    if (new Date(`${day}T${t}:00+03:00`).getTime() > Date.now() + 30 * 60e3) out.push(t);
  }
  return out;
}
function Booking() {
  const b = S.booking, c = S.draftContact || {};
  if (b.venue && !S.venues.some((x) => x.id === b.venue)) b.venue = '';
  const pick = `<section class="stack"><span class="eyebrow">В какой паб?</span>
    <div class="seg${b.venue ? '' : ' need'}" role="radiogroup">${S.venues.map((v) => `<button type="button" role="radio" data-act="bk-venue" data-id="${esc(v.id)}" aria-pressed="${v.id === b.venue}" aria-checked="${v.id === b.venue}">${esc(v.name)}<small>${esc(v.address)}</small></button>`).join('')}</div>
    ${b.venue ? '' : '<span class="small" style="color:var(--accent)">Нажмите на паб, в котором хотите забронировать стол</span>'}</section>`;
  const head = `<div class="stack" style="gap:8px"><span class="eyebrow accent">Бронь стола</span><h1 class="h1">Забронировать стол</h1>
    <p class="lead">Бронь бесплатная. Паб подтвердит её звонком или сообщением; держим стол 15 минут после назначенного времени. Компания больше 12 человек или праздник — <a href="#/events">оставьте заявку на банкет</a>.</p></div>`;
  if (!b.venue) return `<div class="wrap page" style="max-width:860px">${head}${pick}</div>`;
  const v = S.venues.find((x) => x.id === b.venue);
  if (v.booking_enabled === false || v.accepting === false) return `<div class="wrap page" style="max-width:860px">${head}${pick}
    <div class="card stack"><b>«${esc(v.name)}» скоро открывается — бронь столов начнём принимать после открытия.</b>
    <span style="color:var(--text-2)">Планируете праздник? Заявку на банкет можно оставить уже сейчас.</span>
    <div class="row"><a class="btn btn-accent btn-sm" href="#/events">Заявка на мероприятие</a>${v.phone ? `<a class="btn btn-ghost btn-sm" href="${telHref(v.phone)}">${icon.phone} ${esc(v.phone)}</a>` : ''}</div></div></div>`;
  const days = bookingDays();
  if (!b.day || !days.some((d) => d.key === b.day)) b.day = days[0].key;
  let slots = bookingSlots(b.day);
  if (!slots.length && b.day === days[0].key) { b.day = days[1].key; slots = bookingSlots(b.day); }
  if (b.time && !slots.includes(b.time)) b.time = '';
  const max = v.booking_max_guests || 12, dep = (v.booking_deposit || 0) * b.guests;
  return `<div class="wrap page" style="max-width:860px">${head}${pick}
    <form id="booking" class="stack" style="gap:22px" novalidate>
      <section class="stack"><span class="eyebrow">Дата</span><div class="row" style="gap:8px">${days.map((d) => `<button type="button" class="chip" data-act="bk-day" data-v="${d.key}" aria-pressed="${d.key === b.day}">${esc(d.label)}</button>`).join('')}</div></section>
      <section class="stack"><span class="eyebrow">Время</span><div class="slots">${slots.map((t) => `<button type="button" class="opt" data-act="bk-time" data-v="${t}" aria-pressed="${t === b.time}">${t}</button>`).join('')}</div></section>
      <section class="stack"><span class="eyebrow">Гостей</span>
        <div class="row" style="gap:14px"><button type="button" class="icon-btn" data-act="bk-g" data-v="-1" aria-label="Меньше">−</button><b style="font-size:24px;min-width:32px;text-align:center">${b.guests}</b>
        <button type="button" class="icon-btn" data-act="bk-g" data-v="1" aria-label="Больше" ${b.guests >= max ? 'disabled' : ''}>+</button><span class="muted small">больше ${max} — <a href="#/events?k=banquet">заявка на банкет</a></span></div></section>
      <section class="stack"><span class="eyebrow">Контакты</span>
        <div class="form-grid">
          <label class="field">Имя<input class="input" name="name" autocomplete="given-name" required value="${esc(c.name || S.profile.name || '')}"></label>
          <label class="field">Телефон<input class="input" name="phone" type="tel" autocomplete="tel" data-phone required placeholder="${PHONE_PH}" value="${esc(fmtPhone(c.phone || S.profile.phone || ''))}"></label>
        </div>
        <label class="field">Пожелания<input class="input" name="comment" maxlength="300" placeholder="У окна, день рождения, детский стул…" value="${esc(b.comment || '')}"></label></section>
      ${dep > 0 ? `<div class="card small">Депозит ${rub(dep)} — засчитывается в счёт.</div>` : ''}
      ${ConsentBox()}
      <p class="error" id="bk-err" role="alert"></p>
      <button type="submit" class="btn btn-accent" style="align-self:flex-start;min-width:260px">Забронировать${b.time ? ` на ${b.time}` : ''}</button>
    </form></div>`;
}
function saveBookingForm() {
  const f = document.getElementById('booking'); if (!f) return;
  S.booking.comment = f.comment.value; S.booking.pdTick = !!f.pdConsent?.checked;
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
    await grantPd('site-booking');
    const res = await store.placeReservation({
      venue_id: b.venue, starts_at: new Date(`${b.day}T${b.time}:00+03:00`).toISOString(), guests: b.guests,
      name: c.name.trim(), phone: fmtPhone(c.phone), comment: ((b.comment || '').trim() + ' (с сайта)').trim(), pd_consent: true, pd_consent_version: CV,
    });
    const vname = S.venues.find((x) => x.id === b.venue)?.name || '';
    S.booking = { guests: 2, day: '', time: '', comment: '', venue: '' }; S.bookings = null;
    showDone('Бронь отправлена', `Бронь №${res.number} — «${vname}». Паб подтвердит её звонком или сообщением.`, verified() ? '#/account' : '#/login', verified() ? 'Мои брони' : 'Войти, чтобы видеть брони');
  } catch (ex) { err.textContent = ex.message || 'Не удалось забронировать'; btn.disabled = false; btn.textContent = 'Забронировать'; }
}
function showDone(title, text, href, label) {
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="mb" style="align-items:center;text-align:center;padding:36px 28px">
    <img src="img/emblem.svg" width="90" height="90" alt=""><h2 class="h2">${esc(title)}</h2><p style="margin:0;color:var(--text-2)">${esc(text)}</p>
    <div class="row" style="justify-content:center;margin-top:8px"><button type="button" class="btn btn-ghost" data-close>Хорошо</button>${href ? `<a class="btn btn-accent" href="${href}" data-close>${esc(label)}</a>` : ''}</div></div></div>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) setTimeout(() => wrap.remove(), 30); });
  document.body.appendChild(wrap);
  location.hash = '#/';
}

/* ---------- мероприятия: банкеты, дни рождения, корпоративы, аренда ---------- */
const KINDS = [
  { id: 'birthday', em: '🎂', title: 'День рождения', text: 'Стол или отдельная зона для вашей компании, сеты из смокера и торт, который можно принести с собой — обсудим заранее.' },
  { id: 'corporate', em: '🍻', title: 'Корпоратив', text: 'Новогодние и летние вечеринки, тимбилдинги, встречи с партнёрами. Подберём меню под бюджет на человека и закроем документы для бухгалтерии.' },
  { id: 'wedding', em: '💍', title: 'Свадьба', text: 'Камерная свадьба или after-party в атмосфере ирландского паба. Банкетное меню, рассадка и оформление — под ваш сценарий.' },
  { id: 'banquet', em: '🥩', title: 'Банкет и выпускной', text: 'Юбилеи, выпускные, встречи выпускников и любые поводы собраться большой компанией. Сеты BBQ, закуски к пиву, горячее.' },
  { id: 'rent', em: '🔑', title: 'Аренда зала', text: 'Часть зала или весь паб под закрытое мероприятие: презентация, трансляция, вечеринка, съёмка. Условия — по дате и числу гостей.' },
  { id: 'other', em: '✨', title: 'Свой формат', text: 'Квиз, турнир, просмотр матча, мальчишник или девичник — расскажите идею, а мы предложим, как её провести.' },
];
const FORMATS = ['Стол или зона в зале', 'Часть зала', 'Весь паб (закрытое мероприятие)', 'Пока не знаю — посоветуйте'];
function EventsTeaser() {
  return `<section class="ev-hero">
    <div class="hero-bg" style="background-image:url('${esc(HERO_IMG)}')"></div>
    <div class="in"><span class="eyebrow accent">Праздники и аренда</span><h2 class="h2" style="font-size:clamp(28px,4vw,44px)">Отмечайте у нас: дни рождения, корпоративы, свадьбы</h2>
      <p class="lead">Отдаём под ваш праздник стол, часть зала или весь паб. Банкетное меню из смокера, пиво и атмосфера, ради которой возвращаются.</p>
      <div class="row">${KINDS.slice(0, 4).map((k) => `<a class="tag" href="#/events?k=${k.id}" style="text-decoration:none">${k.em} ${esc(k.title)}</a>`).join('')}</div>
      <a class="btn btn-accent" href="#/events" style="align-self:flex-start">Обсудить мероприятие</a></div>
  </section>`;
}
function Events() {
  const e = S.ev;
  const evNews = (S.news || []).filter((n) => n.kind === 'event');
  if (e.sent) return `<div class="wrap page" style="max-width:720px"><div class="card stack" style="align-items:center;text-align:center;padding:40px 28px;gap:14px">
    <img src="img/emblem.svg" width="96" height="96" alt=""><span class="eyebrow accent">Заявка №${esc(e.sent.number)}</span><h1 class="h2">Спасибо! Заявка у нас</h1>
    <p style="margin:0;color:var(--text-2)">Менеджер паба свяжется с вами по номеру ${esc(e.sent.phone)}, уточнит детали и предложит меню. Обычно перезваниваем в течение дня.</p>
    <div class="row" style="justify-content:center"><button type="button" class="btn btn-ghost" data-act="ev-again">Ещё одна заявка</button><a class="btn btn-accent" href="#/menu">Посмотреть меню</a></div></div></div>`;
  return `<div class="wrap page">
    <section class="ev-hero" style="min-height:420px">
      <div class="hero-bg" style="background-image:url('${esc(HERO_IMG)}')"></div>
      <div class="in"><span class="eyebrow accent">Банкеты и аренда зала</span>
        <h1 class="h1">Ваш праздник — в «Патрики»</h1>
        <p class="lead">Дни рождения, корпоративы, свадьбы, выпускные и закрытые вечеринки на Петроградке и в Мурино. Отдадим под вас стол, часть зала или весь паб.</p>
        <div class="row"><a class="btn btn-accent" href="#/events" data-act="ev-scroll">Оставить заявку</a><a class="btn btn-outline" href="${telHref(S.venues[0]?.phone || '+79633027595')}">${icon.phone} ${esc(S.venues[0]?.phone || '+7 963 302-75-95')}</a></div></div>
    </section>

    <section class="stack" style="gap:18px"><div class="stack" style="gap:4px"><span class="eyebrow accent">Форматы</span><h2 class="h2">Под какой повод</h2></div>
      <div class="grid g3">${KINDS.map((k) => `<article class="card format"><span class="em" aria-hidden="true">${k.em}</span><span class="h3">${esc(k.title)}</span><p>${esc(k.text)}</p>
        <button type="button" class="btn btn-ghost btn-sm" data-act="ev-kind" data-v="${k.id}">Выбрать</button></article>`).join('')}</div></section>

    <section class="grid g2" style="gap:24px;align-items:start">
      <div class="card stack" style="gap:16px"><span class="eyebrow accent">Что берём на себя</span><h2 class="h3">Вы отдыхаете — мы готовим</h2>
        <ul class="checklist">
          <li>Банкетное меню под бюджет: сеты из смокера, микс BBQ, закуски к пиву, горячее и салаты</li>
          <li>Рассадка под ваш формат — от длинного стола до фуршета</li>
          <li>Отдельный официант и бар для вашей компании</li>
          <li>Можно принести свой торт — договоримся заранее</li>
          <li>Музыка, трансляция матча или ваш плейлист — обсудим</li>
          <li>Для компаний — счёт и закрывающие документы на юрлицо</li>
        </ul></div>
      <div class="card stack" style="gap:16px"><span class="eyebrow accent">Как всё устроено</span><h2 class="h3">Четыре шага</h2>
        <div class="steps-h" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div><b>Заявка</b><p>Оставьте заявку ниже или позвоните — это бесплатно и ни к чему не обязывает.</p></div>
          <div><b>Звонок</b><p>Менеджер уточнит дату, число гостей и формат, ответит на вопросы.</p></div>
          <div><b>Меню и смета</b><p>Предложим меню и посчитаем стоимость под ваш бюджет.</p></div>
          <div><b>Праздник</b><p>Подготовим зал и стол к вашему приходу — остаётся только отдыхать.</p></div>
        </div></div>
    </section>

    ${evNews.length ? `<section class="stack" style="gap:18px"><div class="stack" style="gap:4px"><span class="eyebrow accent">Афиша</span><h2 class="h2">Ближайшие события в пабе</h2></div>
      <div class="grid g3">${evNews.slice(0, 6).map(NewsCard).join('')}</div></section>` : ''}

    <section class="two-col" id="ev-form">
      <form id="event-form" class="card stack" style="gap:20px" novalidate>
        <div class="stack" style="gap:4px"><span class="eyebrow accent">Заявка</span><h2 class="h2">Расскажите о празднике</h2>
          <span class="muted small">Заполните, что знаете, — остальное уточним по телефону.</span></div>
        <section class="stack"><span class="eyebrow">Повод</span><div class="row" style="gap:8px">${KINDS.map((k) => `<button type="button" class="chip" data-act="ev-kind" data-v="${k.id}" aria-pressed="${e.kind === k.id}">${k.em} ${esc(k.title)}</button>`).join('')}</div></section>
        <section class="stack"><span class="eyebrow">Паб</span><div class="seg" role="radiogroup">${S.venues.map((v) => `<button type="button" role="radio" data-act="ev-venue" data-id="${esc(v.id)}" aria-pressed="${e.venue === v.id}">${esc(v.name)}<small>${v.accepting === false ? 'после открытия' : esc(v.address)}</small></button>`).join('')}</div></section>
        <div class="form-grid">
          <label class="field">Дата<input class="input" type="date" name="date" min="${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })}" value="${esc(e.date || '')}"></label>
          <label class="field">Сколько гостей<input class="input" type="number" name="guests" min="1" max="500" inputmode="numeric" placeholder="например, 25" value="${esc(e.guests || '')}"></label>
        </div>
        <section class="stack"><span class="eyebrow">Формат</span><div class="row" style="gap:8px">${FORMATS.map((f) => `<button type="button" class="chip" data-act="ev-format" data-v="${esc(f)}" aria-pressed="${e.format === f}">${esc(f)}</button>`).join('')}</div></section>
        <label class="field">Бюджет на гостя (по желанию)<input class="input" name="budget" maxlength="60" placeholder="например, 2 500 ₽" value="${esc(e.budget || '')}"></label>
        <div class="form-grid">
          <label class="field">Имя<input class="input" name="name" autocomplete="name" required value="${esc(e.name ?? S.profile.name ?? '')}"></label>
          <label class="field">Телефон<input class="input" name="phone" type="tel" autocomplete="tel" data-phone required placeholder="${PHONE_PH}" value="${esc(fmtPhone(e.phone ?? S.profile.phone ?? ''))}"></label>
        </div>
        <label class="field">Пожелания<textarea class="textarea" name="comment" maxlength="1000" placeholder="Время начала, меню, музыка, оформление, нужен ли проектор…">${esc(e.comment || '')}</textarea></label>
        ${ConsentBox()}
        <p class="error" id="ev-err" role="alert"></p>
        <button type="submit" class="btn btn-accent" style="align-self:flex-start;min-width:260px">Отправить заявку</button>
      </form>
      <aside class="stack" style="gap:16px">
        ${S.venues.map((v) => `<div class="card stack" style="gap:6px"><span class="h3">${esc(v.name)}</span><span style="color:var(--text-2)">${esc(v.address)}</span>
          ${v.accepting === false ? '<span class="pill gold" style="align-self:flex-start">открываемся скоро — принимаем заявки на даты после открытия</span>' : ''}
          ${v.phone ? `<a href="${telHref(v.phone)}" style="text-decoration:none">${icon.phone} ${esc(v.phone)}</a>` : ''}</div>`).join('')}
        <div class="card small" style="color:var(--text-2)">Предпочитаете голосом? Позвоните — расскажем о свободных датах и пришлём меню в мессенджер.</div>
      </aside>
    </section>
  </div>`;
}
function saveEventForm() {
  const f = document.getElementById('event-form'); if (!f) return;
  Object.assign(S.ev, { date: f.date.value, guests: f.guests.value, budget: f.budget.value, name: f.name.value, phone: f.phone.value, comment: f.comment.value, pdTick: !!f.pdConsent?.checked });
}
async function submitEvent(form) {
  saveEventForm();
  const e = S.ev, err = document.getElementById('ev-err');
  if (!e.kind) return (err.textContent = 'Выберите повод — день рождения, корпоратив или другой');
  if (!e.name?.trim()) return (err.textContent = 'Укажите имя');
  if (phone10(e.phone).length !== 10) return (err.textContent = 'Введите номер полностью: +7 (XXX) XXX-XX-XX');
  if (!hasPdConsent() && !e.pdTick) return (err.textContent = 'Отметьте согласие на обработку персональных данных');
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Отправляем…';
  try {
    await grantPd('site-event');
    const res = await store.submitEventRequest({
      kind: e.kind, venue_id: e.venue || '', event_date: e.date || '', guests: e.guests || '', format: e.format || '', budget: (e.budget || '').trim(),
      name: e.name.trim(), phone: fmtPhone(e.phone), comment: (e.comment || '').trim(), pd_consent: true, pd_consent_version: CV, source: 'site',
    });
    S.ev = { kind: '', venue: '', format: '', sent: { number: res.number, phone: fmtPhone(e.phone) } }; S.myEvents = null;
    render();
  } catch (ex) { err.textContent = ex.message || 'Не получилось отправить. Позвоните нам, пожалуйста'; btn.disabled = false; btn.textContent = 'Отправить заявку'; }
}

/* ---------- новости и акции ---------- */
const NEWS_KIND = { news: 'Новость', promo: 'Акция', event: 'Афиша' };
const fmtDate = (iso, opt = { day: 'numeric', month: 'long' }) => new Date(iso).toLocaleDateString('ru-RU', { ...opt, timeZone: 'Europe/Moscow' });
function NewsCard(n) {
  const vn = n.venue_id ? S.venues.find((v) => v.id === n.venue_id)?.name : '';
  return `<a class="card card-link news-card" href="#/news/${esc(n.id)}">
    ${n.image_url ? photo(n.image_url, '', n.title) : '<div class="news-banner"><img src="img/emblem.svg" alt=""></div>'}
    <div class="nb"><div class="row" style="gap:8px"><span class="pill ${n.kind === 'promo' ? 'gold' : ''}">${NEWS_KIND[n.kind] || 'Новость'}</span>${vn ? `<span class="pill">${esc(vn)}</span>` : ''}</div>
      <span class="h3" style="font-size:19px">${esc(n.title)}</span><p>${esc(n.body)}</p>
      <div class="between"><span class="muted small">${n.kind === 'event' && n.event_at ? fmtDate(n.event_at, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : n.ends_on ? `до ${fmtDate(n.ends_on)}` : fmtDate(n.created_at)}</span><span class="small">Подробнее →</span></div></div></a>`;
}
function News() {
  if (S.news === null) return `<div class="wrap page">${loader('Листаем новости…')}</div>`;
  const f = S.newsFilter;
  const list = S.news.filter((n) => f === 'all' || n.kind === f);
  return `<div class="wrap page">
    <div class="stack" style="gap:8px"><span class="eyebrow accent">Новости и акции</span><h1 class="h1">Что нового в пабе</h1><p class="lead">Акции, события, трансляции и новости обоих пабов.</p></div>
    <div class="row" style="gap:8px">${[['all', 'Всё'], ['promo', 'Акции'], ['event', 'Афиша'], ['news', 'Новости']].map(([k, l]) => `<button type="button" class="chip" data-act="news-f" data-v="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
    ${list.length ? `<div class="grid g3">${list.map(NewsCard).join('')}</div>` : '<div class="empty">Здесь пока пусто — загляните позже.</div>'}
  </div>`;
}
function NewsItem(id) {
  if (S.news === null) return `<div class="wrap page">${loader()}</div>`;
  const n = S.news.find((x) => x.id === id);
  if (!n) return `<div class="wrap page"><h1 class="h2">Новость не найдена</h1><a class="btn btn-accent" href="#/news" style="align-self:flex-start">Все новости</a></div>`;
  const vn = n.venue_id ? S.venues.find((v) => v.id === n.venue_id)?.name : '';
  return `<div class="wrap page"><article class="article">
    <a href="#/news" class="small" style="text-decoration:none">← Все новости и акции</a>
    <div class="row" style="gap:8px"><span class="pill ${n.kind === 'promo' ? 'gold' : ''}">${NEWS_KIND[n.kind] || 'Новость'}</span>${vn ? `<span class="pill">${esc(vn)}</span>` : ''}
      <span class="muted small">${n.kind === 'event' && n.event_at ? fmtDate(n.event_at, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : fmtDate(n.created_at, { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
    <h1 class="h1" style="font-size:clamp(30px,4vw,48px)">${esc(n.title)}</h1>
    ${n.image_url ? photo(n.image_url, '', n.title) : ''}
    <div class="body">${esc(n.body)}</div>
    ${n.ends_on ? `<span class="muted small">Действует до ${fmtDate(n.ends_on, { day: 'numeric', month: 'long', year: 'numeric' })}</span>` : ''}
    <div class="row">${n.kind === 'event' ? '<a class="btn btn-accent" href="#/booking">Забронировать стол</a>' : '<a class="btn btn-accent" href="#/delivery">Заказать доставку</a>'}<a class="btn btn-ghost" href="#/events">Праздник у нас</a></div>
  </article></div>`;
}

/* ---------- контакты ---------- */
function Contacts() {
  const L = CONFIG.LEGAL;
  return `<div class="wrap page">
    <div class="stack" style="gap:8px"><span class="eyebrow accent">Контакты</span><h1 class="h1">Как нас найти</h1><p class="lead">Два паба, одна кухня. Работаем ежедневно с 12:00 до 01:00.</p></div>
    <div class="grid g2">${S.venues.map((v) => VenueCard(v, true)).join('')}</div>
    <div class="grid g3">
      <div class="card stack" style="gap:6px"><span class="eyebrow">Бронь и банкеты</span><a href="tel:+79633027595" style="font-family:var(--display);font-size:24px;text-decoration:none">+7 963 302-75-95</a><span class="muted small">Ответим на вопросы о брони, доставке и мероприятиях</span></div>
      <div class="card stack" style="gap:6px"><span class="eyebrow">Почта</span><a href="mailto:${esc(L.EMAIL)}" style="font-size:18px">${esc(L.EMAIL)}</a><span class="muted small">Предложения, претензии и запросы по персональным данным</span></div>
      <div class="card stack" style="gap:6px"><span class="eyebrow">Telegram</span><a href="https://t.me/PatrikiPubBot" target="_blank" rel="noopener" style="font-size:18px">${icon.tg} @PatrikiPubBot</a><span class="muted small">Бот для входа по номеру телефона</span></div>
    </div>
    <section class="card stack" style="gap:6px"><span class="eyebrow">Продавец</span>
      ${[['Продавец', L.SELLER], ['ИНН', L.INN], ['ОГРН', L.OGRN], ['Юридический адрес', L.ADDRESS]].filter(([, v]) => v).map(([k, v]) => `<div class="sum-row"><span class="muted">${k}</span><span style="text-align:right">${esc(v)}</span></div>`).join('')}
    </section>
  </div>`;
}

/* ---------- вход по номеру телефона ---------- */
function Login() {
  const v = S.verify;
  if (verified() && v.step === 'phone') { setTimeout(() => { location.hash = '#' + (v.back || '/account'); }); return ''; }
  const head = (t) => `<div class="stack" style="gap:8px;align-items:center;text-align:center"><img src="img/emblem.svg" width="86" height="86" alt=""><h1 class="h2">${t}</h1></div>`;
  if (v.step === 'tg') {
    return `<div class="wrap page"><div class="login-box">${head('Вход через Telegram')}
      <ol style="color:var(--text-2);margin:0;padding-left:20px;line-height:1.8">
        <li>Откройте нашего бота @PatrikiPubBot — кнопка ниже${matchMedia('(min-width: 861px)').matches ? ' или наведите камеру телефона на QR-код' : ''}</li>
        <li>Нажмите в боте <b>«Start»</b>, затем <b>«📱 Поделиться номером»</b></li>
        <li>Вернитесь сюда — страница обновится сама</li></ol>
      ${matchMedia('(min-width: 861px)').matches && v.tgUrl ? `<div class="tg-qr card"><div class="loy-qr">${qrSvg(v.tgUrl, 150)}</div><span class="muted small">Сканируйте камерой телефона, где установлен Telegram</span></div>` : ''}
      <a class="btn btn-accent btn-block" href="${esc(v.tgUrl || '#')}" target="_blank" rel="noopener" data-act="tg-open">${icon.tg} Открыть Telegram</a>
      <p class="muted" id="tg-wait" style="text-align:center;margin:0">Ждём подтверждения из Telegram…</p>
      <p class="error" role="alert" style="text-align:center">${esc(v.err || '')}</p>
      <button type="button" class="btn btn-ghost btn-block" data-act="verify-back">Назад</button></div></div>`;
  }
  if (v.step === 'in') {
    const n = v.number || '', shown = n.length === 11 ? fmtPhone(n.slice(1)) : n;
    return `<div class="wrap page"><div class="login-box">${head('Вход звонком')}
      ${v.failed ? `<p style="text-align:center;color:var(--text-2);margin:0">${esc(v.err || 'Звонок не поступил')}</p><button type="button" class="btn btn-accent btn-block" data-act="in-retry">Попробовать ещё раз</button>`
      : `<p style="text-align:center;color:var(--text-2);margin:0">Позвоните с номера <b style="color:var(--text)">${esc(fmtPhone(v.phone))}</b> на номер ниже. Звонок бесплатный и сбросится сам.</p>
        <div class="in-number">${esc(shown)}</div>
        ${v.test ? `<button type="button" class="btn btn-accent btn-block" data-act="in-call">${icon.phone} Позвонить</button>` : `<a class="btn btn-accent btn-block" href="tel:+${esc(n)}" data-act="in-call">${icon.phone} Позвонить</a>`}
        <p class="muted" id="in-wait" style="text-align:center;margin:0">${v.called ? 'Ждём ваш звонок…' : 'Номер действует 2 минуты'}</p>`}
      ${v.test ? '<p class="demo-banner">Тестовый режим: звонить не нужно — нажмите «Позвонить».</p>' : ''}
      <div class="or-line"><span>или</span></div>
      <button type="button" class="btn btn-ghost btn-block" data-act="tg-start">${icon.tg} Через Telegram</button></div></div>`;
  }
  return `<div class="wrap page"><div class="login-box">${head('Вход по номеру телефона')}
    <p style="text-align:center;color:var(--text-2);margin:0">Подтвердите номер — увидите баллы карты гостя, QR-код для бармена, свои брони и заказы. Аккаунт общий с приложением «Патрики Паб».</p>
    <form id="phone-form" class="stack" style="gap:14px">
      <label class="field">Номер мобильного<input class="input" name="phone" type="tel" autocomplete="tel" data-phone placeholder="${PHONE_PH}" value="${esc(fmtPhone(v.phone || S.profile.phone || ''))}"></label>
      ${ConsentBox()}
      <p class="error" role="alert"></p>
      <button type="button" class="btn btn-accent btn-block" data-act="tg-start">${icon.tg} Войти через Telegram</button>
      <div class="or-line"><span>или</span></div>
      <button type="submit" class="btn btn-ghost btn-block">${icon.phone} Подтвердить звонком</button>
      <span class="muted small" style="text-align:center">Покажем номер — позвоните на него со своего телефона. Звонок бесплатный и сбросится сам.</span>
    </form></div></div>`;
}
let tgPoll = null, inPoll = null;
function tickVerify() { clearTimeout(tgPoll); clearTimeout(inPoll); if (S.verify.step === 'tg') pollTg(); if (S.verify.step === 'in') pollIn(); }
async function startTg(btn) {
  const form = document.getElementById('phone-form');
  if (form && !consentOk(form)) { form.querySelector('.error').textContent = 'Отметьте согласие на обработку персональных данных'; return; }
  if (form?.pdConsent?.checked) keep.set('pdConsent', CV);
  btn.disabled = true;
  try {
    const r = await store.tgStart();
    S.verify = { ...S.verify, step: 'tg', tgToken: r.token, tgUrl: r.url, err: '' };
    render();
    if (!matchMedia('(min-width: 861px)').matches && !r.demo) window.open(r.url, '_blank');
  } catch (ex) { btn.disabled = false; const e = document.querySelector('#phone-form .error'); if (e) e.textContent = ex.message || 'Не получилось. Попробуйте ещё раз'; else toast(ex.message || 'Не получилось'); }
}
function pollTg() {
  const tick = async () => {
    if (route() !== '/login' || S.verify.step !== 'tg') return;
    try {
      const r = await store.tgStatus(S.verify.tgToken);
      if (r.status === 'done' || r.status === 'login') return finishVerify(r);
      if (r.status === 'failed') { S.verify.err = r.message || 'Не получилось, попробуйте ещё раз'; return render(false); }
    } catch (e) { console.warn(e); }
    tgPoll = setTimeout(tick, 2500);
  };
  tgPoll = setTimeout(tick, 1500);
}
async function startIncoming(p10, errEl, btn) {
  if (p10.length !== 10) { if (errEl) errEl.textContent = 'Введите номер полностью: +7 (XXX) XXX-XX-XX'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Получаем номер…'; }
  try {
    const r = await store.inStart(p10);
    S.verify = { ...S.verify, step: 'in', phone: p10, inId: r.id, number: r.number, test: !!r.test, called: false, failed: false, err: '', until: Date.now() + (r.timeout || 120) * 1000 };
    render();
  } catch (ex) {
    if (errEl) errEl.textContent = ex.message || 'Не получилось. Попробуйте через Telegram'; else toast(ex.message || 'Не получилось', 4000);
    if (btn) { btn.disabled = false; btn.textContent = 'Подтвердить звонком'; }
  }
}
function pollIn() {
  const tick = async () => {
    if (route() !== '/login' || S.verify.step !== 'in' || S.verify.failed) return;
    try {
      const r = await store.inCheck(S.verify.inId, S.verify.called);
      if (r.status === 'done' || r.status === 'login') return finishVerify(r);
      if (r.status === 'failed') { S.verify.failed = true; S.verify.err = r.message || 'Звонок не поступил'; return render(false); }
    } catch (e) { console.warn(e); }
    inPoll = setTimeout(tick, 2000);
  };
  inPoll = setTimeout(tick, 1000);
}
async function finishVerify(r) {
  clearTimeout(tgPoll); clearTimeout(inPoll);
  try { if (r.status === 'login') await store.applyLogin(r.login_hash); else await store.refreshUser(); }
  catch (e) { S.verify.err = e.message; return render(false); }
  await loadGuest();
  if (keep.get('pdConsent', '') === CV && S.profile.pd_consent_version !== CV) await grantPd('site-verify');
  const p10 = phone10(r.phone || S.me?.phone || '');
  if (p10 && phone10(S.profile.phone || '') !== p10) { try { S.profile = await store.saveProfile({ ...S.profile, phone: fmtPhone(p10) }); } catch (e) { console.warn(e); } }
  S.loy = null; S.bookings = null; S.history = null; S.myEvents = null;
  const back = S.verify.back || '/account';
  S.verify = { step: 'phone', phone: '', back: '/account' };
  toast(r.status === 'login' ? 'Готово — вошли в ваш профиль' : 'Номер подтверждён', 3500);
  loadLoyalty(true);
  location.hash = '#' + back;
}

/* ---------- личный кабинет ---------- */
const LOY_KIND = { accrue: 'Начислено', pending: 'Начислится', redeem: 'Списано', refund: 'Возврат', bonus: 'Бонус', adjust: 'Корректировка', expire: 'Сгорело', reverse: 'Отмена начисления', import: 'Перенос с прежней карты' };
const LOY_SRC = { app: 'заказ', venue: 'в пабе', pos: 'касса', admin: 'управляющий', system: '' };
const BK_RU = { new: 'ждёт подтверждения', confirmed: 'подтверждена', cancelled: 'отменена', done: 'состоялась', no_show: 'не пришли', rejected: 'отклонена' };
const EV_RU = { new: 'новая', in_work: 'в работе', done: 'проведено', cancelled: 'отменена' };
function Account() {
  if (!verified()) { S.verify.back = '/account'; setTimeout(() => { location.hash = '#/login'; }); return ''; }
  const t = S.accTab;
  const tab = (id, l) => `<button type="button" class="chip" data-act="acc-tab" data-v="${id}" aria-pressed="${t === id}">${l}</button>`;
  return `<div class="wrap page">
    <div class="between"><div class="stack" style="gap:6px"><span class="eyebrow accent">Личный кабинет</span><h1 class="h1" style="font-size:clamp(30px,4vw,48px)">${esc(S.profile.name || 'Гость')}</h1>
      <span class="ok-note">${icon.check} ${esc(fmtPhone(S.me.phone))}</span></div>
      <button type="button" class="btn btn-ghost btn-sm" data-act="logout">Выйти</button></div>
    <div class="acc-tabs">${tab('card', 'Карта гостя')}${tab('bookings', 'Брони')}${tab('orders', 'Заказы')}${tab('events', 'Мероприятия')}${tab('me', 'Личные данные')}</div>
    ${t === 'card' ? AccCard() : t === 'bookings' ? AccBookings() : t === 'orders' ? AccOrders() : t === 'events' ? AccEvents() : AccMe()}
  </div>`;
}
function AccCard() {
  const L = S.loy;
  if (!L) return loader('Достаём карту…');
  const st = L.settings || {};
  if (!st.enabled) return '<div class="card">Программа лояльности скоро заработает.</div>';
  const t = L.tier || {}, tiers = [...(st.tiers || [])].sort((a, b) => a.from - b.from);
  const need = t.next_from != null ? Math.max(0, t.next_from - L.spent) : 0;
  const prog = t.next_from != null ? Math.min(100, Math.round(((L.spent - t.from) / Math.max(1, t.next_from - t.from)) * 100)) : 100;
  return `<div class="grid g2" style="gap:24px;align-items:start">
    <div class="stack" style="gap:16px">
      <section class="loy-card">
        <div class="between"><div class="stack" style="gap:4px"><span class="eyebrow accent">${esc(t.name || '')} · ${esc(t.pct ?? 0)}%</span><span class="loy-balance">${pts(L.balance)} <small>${ptsWord(L.balance)}</small></span></div><img src="img/emblem.svg" width="58" height="58" alt=""></div>
        ${t.fixed ? '' : t.next_from != null ? `<div class="loy-prog"><span style="width:${prog}%"></span></div><span class="muted small">До уровня «${esc(t.next_name)}» — ещё ${rub(need)} покупок</span>` : '<span class="muted small">Максимальный уровень — спасибо, что вы с нами!</span>'}
        ${L.pending ? `<span class="muted small">+${pts(L.pending)} ${ptsWord(L.pending)} в пути — начислятся через ${esc(st.accrue_delay_days || 0)} дн.</span>` : ''}
        <span class="loy-no">№ ${esc(String(L.card_no).replace(/(\d{4})(\d{4})/, '$1 $2'))}</span>
      </section>
      <section class="card stack" style="gap:8px"><span class="eyebrow">Как копить</span>
        ${tiers.map((x) => `<div class="sum-row"><span>${esc(x.name)}${x.from ? ` <span class="muted">· от ${rub(x.from)}</span>` : ''}</span><b>${esc(x.pct)}%</b></div>`).join('')}
        <span class="muted small">1 балл = 1 ₽. Баллами можно оплатить до ${esc(st.max_redeem_pct)}% заказа или счёта в пабе. ${st.accrue_delay_days ? `Баллы приходят через ${esc(st.accrue_delay_days)} дн. после покупки. ` : ''}${doc('loyalty', 'Правила программы')}.</span>
      </section>
    </div>
    <div class="stack" style="gap:16px">
      <section class="card stack" style="align-items:center;gap:10px"><span class="eyebrow">В пабе — покажите бармену</span>
        <div id="loy-qr" class="loy-qr">${qrSvg(qrPayload(L.card_no, L.secret), 200)}</div>
        <span class="muted small" style="text-align:center">Код обновляется каждые 30 секунд. Не сканируется? Назовите номер карты или телефон.</span></section>
      ${(L.history || []).length ? `<section class="card"><span class="eyebrow">История</span>${L.history.slice(0, 15).map((h) => `<div class="list-row"><span class="stack" style="gap:2px"><span>${LOY_KIND[h.kind] || esc(h.kind)}${LOY_SRC[h.source] ? ` · ${LOY_SRC[h.source]}` : ''}</span><span class="muted small">${fmtDate(h.created_at)}${h.note ? ` · ${esc(h.note)}` : ''}</span></span>
        <b style="color:${h.points >= 0 ? 'var(--ok)' : 'var(--text-2)'}">${h.points >= 0 ? '+' : ''}${pts(h.points)}</b></div>`).join('')}</section>` : ''}
    </div></div>`;
}
let qrTimer = null;
function startCardQr() {
  clearInterval(qrTimer);
  qrTimer = setInterval(() => {
    const box = document.getElementById('loy-qr');
    if (!box || route() !== '/account' || !S.loy) return clearInterval(qrTimer);
    box.innerHTML = qrSvg(qrPayload(S.loy.card_no, S.loy.secret), 200);
  }, 30000);
}
function AccBookings() {
  if (!S.bookings) return loader();
  const active = (b) => ['new', 'confirmed'].includes(b.status) && new Date(b.starts_at) > Date.now();
  if (!S.bookings.length) return `<div class="empty">${icon.cal}<span>Броней пока нет.</span><a class="btn btn-accent" href="#/booking">Забронировать стол</a></div>`;
  return `<div class="card">${S.bookings.map((b) => `<div class="list-row"><span class="stack" style="gap:2px"><b>№${esc(b.number)} · ${esc(S.venues.find((v) => v.id === b.venue_id)?.name || '')}</b>
    <span class="muted small">${new Date(b.starts_at).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })} · ${esc(b.guests)} чел.</span></span>
    <span class="row" style="gap:8px"><span class="pill ${b.status === 'confirmed' ? 'ok' : b.status === 'new' ? 'gold' : ''}">${BK_RU[b.status] || esc(b.status)}</span>${active(b) ? `<button type="button" class="btn btn-danger btn-sm" data-act="bk-cancel" data-id="${esc(b.id)}">Отменить</button>` : ''}</span></div>`).join('')}</div>
    <a class="btn btn-accent" href="#/booking" style="align-self:flex-start">Новая бронь</a>`;
}
function AccOrders() {
  if (!S.history) return loader();
  if (!S.history.length) return `<div class="empty">${icon.bag}<span>Заказов пока нет. Самое время попробовать брискет.</span><a class="btn btn-accent" href="#/delivery">В меню</a></div>`;
  return `<div class="card">${S.history.map((o) => `<div class="list-row"><span class="stack" style="gap:2px"><b>№${esc(o.number)} · ${rub(o.total)}</b>
    <span class="muted small">${fmtDate(o.created_at, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · ${esc((o.items || []).map((l) => l.name).slice(0, 3).join(', '))}</span></span>
    <span class="row" style="gap:8px"><span class="pill">${STATUS_RU[o.status] || esc(o.status)}</span><button type="button" class="btn btn-ghost btn-sm" data-act="repeat" data-id="${esc(o.id)}">Повторить</button></span></div>`).join('')}</div>`;
}
function AccEvents() {
  if (!S.myEvents) return loader();
  if (!S.myEvents.length) return `<div class="empty">${icon.party}<span>Заявок на мероприятия пока нет.</span><a class="btn btn-accent" href="#/events">Обсудить праздник</a></div>`;
  return `<div class="card">${S.myEvents.map((e) => `<div class="list-row"><span class="stack" style="gap:2px"><b>№${esc(e.number)} · ${esc(KINDS.find((k) => k.id === e.kind)?.title || 'Мероприятие')}</b>
    <span class="muted small">${e.event_date ? fmtDate(e.event_date) : 'дата не выбрана'}${e.guests ? ` · ${esc(e.guests)} гостей` : ''}${e.venue_id ? ` · ${esc(S.venues.find((v) => v.id === e.venue_id)?.name || '')}` : ''}</span></span>
    <span class="pill ${e.status === 'in_work' ? 'gold' : e.status === 'done' ? 'ok' : ''}">${EV_RU[e.status] || esc(e.status)}</span></div>`).join('')}</div>`;
}
function AccMe() {
  const p = S.profile;
  return `<form id="me-form" class="card stack" style="max-width:560px;gap:16px">
    <label class="field">Имя<input class="input" name="name" value="${esc(p.name || '')}" autocomplete="name"></label>
    <label class="field">День рождения<input class="input" type="date" name="birthday" value="${esc(p.birthday || '')}"></label>
    <span class="muted small">Телефон ${esc(fmtPhone(S.me.phone))} подтверждён. Адреса доставки и согласия — те же, что в приложении.</span>
    <button class="btn btn-accent" type="submit" style="align-self:flex-start">Сохранить</button></form>`;
}

/* ---------- события ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
  const R = {
    burger: () => {
      const w = document.createElement('div'); w.className = 'drawer-wrap';
      w.innerHTML = `<nav class="drawer" aria-label="Разделы"><div class="between" style="margin-bottom:8px"><span class="eyebrow accent">Разделы</span><button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon.x}</button></div>
        ${[['/menu', 'Меню'], ['/delivery', 'Доставка'], ['/booking', 'Бронь стола'], ['/events', 'Банкеты и аренда'], ['/news', 'Новости и акции'], ['/contacts', 'Контакты'], [verified() ? '/account' : '/login', verified() ? 'Личный кабинет' : 'Войти']].map(([h, l]) => `<a class="dl" href="#${h}">${l}</a>`).join('')}
        <a class="btn btn-accent" href="tel:+79633027595" style="margin-top:18px">${icon.phone} +7 963 302-75-95</a></nav>`;
      w.addEventListener('click', (ev) => { if (ev.target === w || ev.target.closest('[data-close]') || ev.target.closest('a')) setTimeout(() => w.remove(), 20); });
      document.body.appendChild(w);
    },
    inc: () => { if (el.closest('.modal-wrap')) return; setQty(id, (S.cart[id] || 0) + 1); render(false); },
    dec: () => { if (el.closest('.modal-wrap')) return; setQty(id, (S.cart[id] || 0) - 1); render(false); },
    item: () => openItem(id),
    venue: () => { saveCheckoutForm(); S.venueId = id; keep.set('venue', id); render(false); },
    cat: () => { e.preventDefault(); document.getElementById('cat-' + id)?.scrollIntoView({ behavior: 'smooth' }); },
    'pick-addr': () => { saveCheckoutForm(); S.checkout.addr = id; render(false); },
    when: () => { saveCheckoutForm(); S.checkout.when = v; render(false); },
    pay: () => { saveCheckoutForm(); S.checkout.payment = v; S.checkout.payChosen = true; render(false); },
    bonus: () => { saveCheckoutForm(); render(false); },
    'login-from': () => { saveCheckoutForm(); S.verify.back = el.dataset.back || '/account'; },
    'pay-now': () => payNow(id, el),
    'mock-pay': async () => { el.disabled = true; try { const r = await store.mockPay(id, v); const o = S.orders.find((x) => x.id === id); if (o) o.payment_status = r.payment_status; keep.set('orders', S.orders); } catch (ex) { toast(ex.message); } location.hash = '#/order/' + id; },
    'bk-venue': () => { saveBookingForm(); S.booking.venue = id; render(false); },
    'bk-venue-go': () => { S.booking.venue = id; },
    'bk-day': () => { saveBookingForm(); S.booking.day = v; render(false); },
    'bk-time': () => { saveBookingForm(); S.booking.time = v; render(false); },
    'bk-g': () => { saveBookingForm(); const max = S.venues.find((x) => x.id === S.booking.venue)?.booking_max_guests || 12; S.booking.guests = Math.max(1, Math.min(max, S.booking.guests + Number(v))); render(false); },
    'bk-cancel': async () => { if (!confirm('Отменить бронь?')) return; el.disabled = true; try { await store.cancelReservation(id); toast('Бронь отменена'); S.bookings = null; render(false); } catch (ex) { toast(ex.message); el.disabled = false; } },
    'ev-kind': () => { saveEventForm(); S.ev.kind = v; render(false); if (!el.closest('#event-form')) document.getElementById('ev-form')?.scrollIntoView({ behavior: 'smooth' }); },
    'ev-venue': () => { saveEventForm(); S.ev.venue = id; render(false); },
    'ev-format': () => { saveEventForm(); S.ev.format = S.ev.format === v ? '' : v; render(false); },
    'ev-scroll': () => { e.preventDefault(); document.getElementById('ev-form')?.scrollIntoView({ behavior: 'smooth' }); },
    'ev-again': () => { S.ev.sent = null; render(); },
    'news-f': () => { S.newsFilter = v; render(false); },
    'tg-start': () => startTg(el),
    'tg-open': () => { const w = document.getElementById('tg-wait'); if (w) w.textContent = 'Ждём подтверждения из Telegram…'; },
    'verify-back': () => { clearTimeout(tgPoll); clearTimeout(inPoll); S.verify = { ...S.verify, step: 'phone', err: '' }; render(false); },
    'in-call': () => { S.verify.called = true; const w = document.getElementById('in-wait'); if (w) w.textContent = 'Ждём ваш звонок…'; },
    'in-retry': () => startIncoming(S.verify.phone, null, el),
    'acc-tab': () => { S.accTab = v; render(false); },
    logout: async () => { await store.guestSignOut(); S.me = null; S.loy = null; S.bookings = null; S.history = null; S.myEvents = null; await loadGuest(); location.hash = '#/'; toast('Вы вышли из кабинета'); },
    repeat: () => { const o = (S.history || []).find((x) => x.id === id); if (!o) return; for (const l of o.items || []) if (itemById(l.item_id)) setQty(l.item_id, (S.cart[l.item_id] || 0) + l.qty); location.hash = '#/cart'; },
  };
  if (R[a]) await R[a]();
});
document.addEventListener('submit', async (e) => {
  const f = e.target; e.preventDefault();
  if (f.id === 'checkout') return submitCheckout(f);
  if (f.id === 'booking') return submitBooking(f);
  if (f.id === 'event-form') return submitEvent(f);
  if (f.id === 'phone-form') {
    const err = f.querySelector('.error');
    if (!consentOk(f)) { err.textContent = 'Отметьте согласие на обработку персональных данных'; return; }
    if (f.pdConsent?.checked) keep.set('pdConsent', CV);
    return startIncoming(phone10(f.phone.value), err, f.querySelector('[type=submit]'));
  }
  if (f.id === 'me-form') {
    try { S.profile = await store.saveProfile({ ...S.profile, name: f.name.value, birthday: f.birthday.value || null }); toast('Сохранено'); render(false); }
    catch (ex) { toast(ex.message || 'Не сохранилось'); }
  }
});
window.addEventListener('hashchange', () => render());

/* ---------- запуск ---------- */
(async function start() {
  render();
  try {
    await store.init();
    const cached = store.cachedMenu();
    if (cached) Object.assign(S, { categories: cached.categories, items: cached.items, venues: cached.venues, ready: true });
    if (S.ready) render(false);
    const m = await store.getMenu();
    Object.assign(S, { categories: m.categories, items: m.items, venues: m.venues, ready: true });
    if (!S.venues.some((v) => v.id === S.venueId && v.accepting !== false)) S.venueId = (S.venues.find((v) => v.accepting !== false) || S.venues[0])?.id;
  } catch (e) {
    console.error(e);
    if (!S.ready) { app.innerHTML = `<div class="wrap page"><h1 class="h2">Не удалось загрузить</h1><p class="lead">Проверьте интернет и обновите страницу. Или позвоните нам: <a href="tel:+79633027595">+7 963 302-75-95</a>.</p></div>`; return; }
  }
  render(false);
  loadNews();
  await loadGuest();
  if (verified()) loadLoyalty();
  else store.loyaltySettings().then((st) => { S.loyPublic = st; rerenderIf(['/']); }).catch(() => {});
  render(false);
})();
