// Скрытая панель управляющего: заказы, меню и цены, настройки заведений.
import { store } from './store.js';
import { logoMark } from './logo.js';

const A = { tab: 'orders', filter: 'active', venue: 'all', me: null, orders: [], menu: null, catId: null, unsub: null, seen: new Set(), first: true };
let root, ctx;

const STATUS = { new: 'Новый', cooking: 'Готовим', delivering: 'В пути', done: 'Доставлен', cancelled: 'Отменён' };
const NEXT = { new: ['cooking', 'Принять и готовить'], cooking: ['delivering', 'Передать курьеру'], delivering: ['done', 'Доставлен'] };

export async function renderAdmin(el, c) {
  root = el; ctx = c;
  if (!(await store.isAdmin())) return drawLogin();
  if (!A.menu) await loadAll();
  draw();
}

/* ---------- вход ---------- */
function drawLogin(msg = '') {
  const { esc } = ctx;
  root.innerHTML = `<main class="screen" style="max-width:420px;margin:0 auto;padding-top:48px">
    <div style="display:flex;justify-content:center;color:var(--text)">${logoMark(72)}</div>
    <h1 class="h1" style="text-align:center;font-size:24px">Вход для управляющего</h1>
    <form id="adm-login" class="stack" style="gap:14px">
      ${store.demo
        ? `<div class="demo-banner">Демо-режим: сервер ещё не подключён. Пароль для входа — <b>patriki</b>. Изменения видны только в этом браузере.</div>
           <label class="field">Войти как (только в демо)<select class="select" name="demoVenue"><option value="">Владелец — оба заведения</option><option value="petrogradka">Управляющий Петроградки</option><option value="murino">Управляющий Мурино</option></select></label>`
        : '<label class="field">Email<input class="input" name="email" type="email" autocomplete="username" required></label>'}
      <label class="field">Пароль<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <p class="error" role="alert" style="margin:0">${esc(msg)}</p>
      <button class="btn btn-accent btn-block" type="submit">Войти</button>
      <a class="btn btn-ghost btn-block" href="#/">Вернуться в приложение</a>
    </form>
  </main>`;
  root.querySelector('#adm-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const b = e.target.querySelector('[type=submit]'); b.disabled = true; b.textContent = 'Проверяем…';
    try { await store.adminSignIn(d.email || '', d.password || '', d.demoVenue || ''); A.menu = null; A.me = null; renderAdmin(root, ctx); }
    catch (ex) { drawLogin(ex.message || 'Не удалось войти'); }
  });
}

/* ---------- данные ---------- */
async function loadAll() {
  A.me = await store.myAdmin();
  if (!A.me.owner) A.venue = A.me.venue_id;
  A.menu = await store.getMenu();
  A.catId = A.catId || A.menu.categories[0]?.id;
  await loadOrders();
  try { A.codes = await store.listSmsCodes(); } catch { A.codes = []; }
  if (!A.unsub) A.unsub = store.onOrdersChange(async () => { await loadOrders(); if (location.hash.startsWith('#/admin')) draw(); });
}
async function loadOrders() {
  A.orders = await store.listOrders();
  const fresh = A.orders.filter((o) => o.status === 'new' && !unpaid(o) && !A.seen.has(o.id));
  if (fresh.length && !A.first) { beep(); ctx.toast(`Новый заказ №${fresh[0].number}`, 4000); }
  fresh.forEach((o) => A.seen.add(o.id));
  A.first = false;
}
function beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.25, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.2);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2);
    });
  } catch { /* звук недоступен */ }
}

/* ---------- роли и заведения ---------- */
const owner = () => !!A.me?.owner;
const vName = (id) => A.menu?.venues.find((v) => v.id === id)?.name || id;
const myVenues = () => (owner() ? A.menu.venues : A.menu.venues.filter((v) => v.id === A.me.venue_id));
const VCLASS = (id) => 'v-' + String(id).replace(/[^a-z0-9_-]/gi, '');
const inScope = (o) => A.venue === 'all' || o.venue_id === A.venue;

/* ---------- каркас ---------- */
function draw() {
  const newCount = A.orders.filter((o) => o.status === 'new' && !unpaid(o) && inScope(o)).length;
  const role = owner() ? 'ВЛАДЕЛЕЦ · ВСЕ ЗАВЕДЕНИЯ' : 'УПРАВЛЯЮЩИЙ · ' + vName(A.me.venue_id).toUpperCase();
  const tab = (id, label) => `<button type="button" class="chip" data-a="tab" data-v="${id}" aria-current="${A.tab === id}">${label}</button>`;
  root.innerHTML = `<main class="screen">
    <div class="admin-top">
      <div class="brand">${logoMark(40)}<div><div class="brand-name" style="font-size:18px">УПРАВЛЕНИЕ</div><div class="brand-sub">${ctx.esc(role)}</div></div></div>
      <div class="row"><a class="btn btn-ghost btn-sm" href="#/">В приложение</a><button type="button" class="btn btn-ghost btn-sm" data-a="logout">Выйти</button></div>
    </div>
    ${store.demo ? '<div class="demo-banner">Демо-режим: сервер не подключён, изменения сохраняются только в этом браузере.</div>' : ''}
    <nav class="tabs">${tab('orders', `Заказы${newCount ? ` (${newCount})` : ''}`)}${tab('bookings', `Брони${A.bk ? (() => { const n = A.bk.filter((x) => x.status === 'new').length; return n ? ` (${n})` : ''; })() : ''}`)}${tab('cashier', 'Касса · QR')}${tab('menu', 'Меню и цены')}${owner() ? tab('loyalty', 'Баллы') : ''}${tab('venues', 'Заведения')}</nav>
    <div id="adm-body">${A.tab === 'orders' ? Orders() : A.tab === 'menu' ? MenuEditor() : A.tab === 'loyalty' ? LoyaltyEditor() : A.tab === 'cashier' ? Cashier() : A.tab === 'bookings' ? Bookings() : Venues()}</div>
  </main>`;
}

/* ---------- заказы ---------- */
const PAY_RU = { pending: 'ожидает оплаты', held: 'оплачен · сумма заблокирована', paid: 'оплачен · списано', cancelled: 'блокировка снята', refunded: 'деньги возвращены', failed: 'оплата не прошла' };
const unpaid = (o) => o.payment === 'online' && ['pending', 'failed'].includes(o.payment_status);

function Orders() {
  const { esc, rub } = ctx;
  const venueName = vName;
  const active = (o) => ['new', 'cooking', 'delivering'].includes(o.status) && !unpaid(o);
  // онлайн-заказ без оплаты — ещё не заказ: в «Активных» не показываем
  const list = A.orders.filter((o) => inScope(o) && (A.filter === 'all' || active(o)));
  const vchip = (id, label) => {
    const n = A.orders.filter((o) => active(o) && (id === 'all' || o.venue_id === id)).length;
    return `<button type="button" class="chip ${id === 'all' ? '' : VCLASS(id)}" data-a="venue" data-v="${esc(id)}" aria-current="${A.venue === id}">${esc(label)}${n ? ` · ${n}` : ''}</button>`;
  };
  const f = (id, label) => `<button type="button" class="chip" data-a="filter" data-v="${id}" aria-current="${A.filter === id}">${label}</button>`;
  // сколько заказов у этого гостя среди загруженных (последние 100)
  const visits = (o) => (o.user_id ? A.orders.filter((x) => x.user_id === o.user_id && x.status !== 'cancelled').length : 0);
  return `<div class="stack" style="gap:14px">
    <div id="sms-box">${SmsCodes()}</div>
    ${owner() && A.menu.venues.length > 1 ? `<div class="tabs" aria-label="Заведение">${vchip('all', 'Все заведения')}${A.menu.venues.map((v) => vchip(v.id, v.name)).join('')}</div>` : ''}
    <div class="tabs">${f('active', 'Активные')}${f('all', 'Все за последнее время')}</div>
    ${list.length ? `<div class="admin-grid">${list.map((o) => `<article class="card order ${o.status === 'new' ? 'new' : ''} ${VCLASS(o.venue_id)}">
      <span class="venue-tag ${VCLASS(o.venue_id)}">📍 ${esc(venueName(o.venue_id))}${o.transferred_from ? ` · передан из «${esc(venueName(o.transferred_from))}»` : ''}</span>
      <div class="between"><span class="h2" style="font-size:20px">№${esc(o.number)}</span><span class="status-pill ${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span></div>
      <span class="muted" style="font-size:13px">${new Date(o.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc(o.when_text || '')}</span>
      <div class="stack" style="gap:4px">${(o.items || []).map((l) => `<div class="sum-row" style="color:var(--text)"><span>${esc(l.name)} × ${esc(l.qty)}</span><span>${rub(l.price * l.qty)}</span></div>`).join('')}</div>
      <div class="total"><span class="muted">Итого · ${o.payment === 'cash' ? 'наличные' : o.payment === 'online' ? 'онлайн' : 'карта курьеру'}</span><b style="font-size:22px">${rub(o.total)}</b></div>
      ${o.payment === 'online' ? `<span class="pay-pill ${esc(o.payment_status)}" style="align-self:flex-start">💳 ${PAY_RU[o.payment_status] || esc(o.payment_status)}</span>` : ''}
      <div class="stack" style="gap:4px;font-size:14px">
        <span><b>${esc(o.customer_name)}</b> · <a href="tel:${esc(String(o.phone).replace(/[^+\d]/g, ''))}">${esc(o.phone)}</a></span>
        <span class="row" style="gap:10px;flex-wrap:wrap">
          ${o.phone_verified ? '<span class="badge-ok">✓ номер подтверждён</span>' : '<span class="muted" style="font-size:12px">номер не подтверждён</span>'}
          ${visits(o) > 1 ? `<span class="pill">постоянный гость · ${visits(o)} зак.</span>` : ''}
        </span>
        <span style="color:var(--text-2)">${esc(o.address)}</span>
        ${o.comment ? `<span class="muted">«${esc(o.comment)}»</span>` : ''}
      </div>
      <div class="row" style="flex-wrap:wrap">
        ${unpaid(o) ? '' : NEXT[o.status] ? `<button type="button" class="btn btn-accent btn-sm" data-a="status" data-id="${esc(o.id)}" data-v="${NEXT[o.status][0]}">${NEXT[o.status][1]}</button>` : ''}
        ${['new', 'cooking', 'delivering'].includes(o.status) ? `<button type="button" class="btn btn-danger btn-sm" data-a="status" data-id="${esc(o.id)}" data-v="cancelled">Отменить</button>` : ''}
        ${o.status === 'new' && !(o.payment === 'online' && ['held', 'paid'].includes(o.payment_status)) ? A.menu.venues.filter((v) => v.id !== o.venue_id).map((v) =>
          `<button type="button" class="btn btn-ghost btn-sm" data-a="transfer" data-id="${esc(o.id)}" data-v="${esc(v.id)}">Передать → ${esc(v.name)}</button>`).join('') : ''}
      </div>
    </article>`).join('')}</div>` : '<div class="empty">Заказов пока нет. Новые появятся здесь сами, со звуковым сигналом.</div>'}
  </div>`;
}

// Тестовый режим подтверждения номера: коды, которые гости запросили за последние 30 минут
function SmsCodes() {
  if (!A.codes?.length) return '';
  const { esc, fmtPhone } = ctx;
  return `<section class="card stack" style="gap:8px;border-color:#5A4A22">
    <span class="eyebrow accent">Коды подтверждения · тестовый режим звонка</span>
    <span class="muted" style="font-size:12px;line-height:1.4">Звонок-сброс ещё не подключён. Если гость подтверждает номер звонком и просит код — продиктуйте ему 4 цифры. Через Telegram код не нужен.</span>
    ${A.codes.slice(0, 5).map((c) => `<div class="between"><span>${esc(fmtPhone(c.phone))}</span><b style="font-family:var(--display);font-size:20px;letter-spacing:3px">${esc(c.otp)}</b><span class="muted" style="font-size:12px">${new Date(c.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('')}
  </section>`;
}
async function refreshCodes() {
  try { A.codes = await store.listSmsCodes(); } catch { A.codes = []; }
  const box = document.getElementById('sms-box');
  if (box) box.innerHTML = SmsCodes();
}
setInterval(() => { if (location.hash.startsWith('#/admin') && A.tab === 'orders' && A.menu) refreshCodes(); }, 10000);

/* ---------- меню ---------- */
function MenuEditor() {
  const { esc, photo } = ctx;
  const cats = A.menu.categories;
  const cat = cats.find((c) => c.id === A.catId) || cats[0];
  const items = cat ? A.menu.items.filter((x) => x.category_id === cat.id) : [];
  const own = owner();
  const stopChips = (x) => myVenues().map((v) => {
    const off = (x.stop_in || []).includes(v.id);
    return `<button type="button" class="chip stop-chip ${off ? 'off' : ''}" data-a="stop" data-id="${esc(x.id)}" data-v="${esc(v.id)}" aria-pressed="${off}" title="${off ? 'Вернуть в продажу' : 'В стоп-лист'}">${esc(v.name)}: ${off ? 'стоп' : 'есть'}</button>`;
  }).join('');
  if (!own) return `<div class="stack" style="gap:16px">
    <div class="tabs cat-tabs">${cats.map((c) => `<button type="button" class="chip" data-a="cat" data-v="${esc(c.id)}" aria-current="${c.id === cat?.id}">${esc(c.name)}</button>`).join('')}</div>
    <div class="card" style="padding:4px 16px">
      ${items.map((x) => `<div class="adm-item">${photo(x.image_url)}
        <div class="grow"><div class="name">${esc(x.name)}</div><div class="muted" style="font-size:12px">${esc(ctx.rub(x.price))}${x.available === false ? ' · снято с меню владельцем' : ''}</div></div>
        <div class="ctl">${stopChips(x)}</div></div>`).join('') || '<div class="empty">В категории пока нет позиций.</div>'}
    </div>
    <p class="muted" style="font-size:12px;margin:0">Стоп-лист вашего заведения: нажмите, если блюдо закончилось — гости этой точки не смогут его заказать. Цены и состав меню меняет владелец.</p>
  </div>`;
  return `<div class="stack" style="gap:16px">
    <div class="tabs cat-tabs">${cats.map((c) => `<button type="button" class="chip" data-a="cat" data-v="${esc(c.id)}" aria-current="${c.id === cat?.id}">${esc(c.name)}</button>`).join('')}
      <button type="button" class="chip" data-a="cat-add" style="border-style:dashed">+ Категория</button></div>
    ${cat ? `<div class="between" style="flex-wrap:wrap">
      <span class="h2">${esc(cat.name)}</span>
      <div class="row" style="flex-wrap:wrap">
        <button type="button" class="btn btn-ghost btn-sm" data-a="cat-up" aria-label="Категорию выше">↑</button>
        <button type="button" class="btn btn-ghost btn-sm" data-a="cat-down" aria-label="Категорию ниже">↓</button>
        <button type="button" class="btn btn-ghost btn-sm" data-a="cat-rename">Переименовать</button>
        <button type="button" class="btn btn-danger btn-sm" data-a="cat-del">Удалить</button>
        <button type="button" class="btn btn-accent btn-sm" data-a="item-new">+ Позиция</button>
      </div>
    </div>
    <div class="card" style="padding:4px 16px">
      ${items.length ? items.map((x) => `<div class="adm-item">
        ${photo(x.image_url)}
        <div class="grow"><div class="name">${esc(x.name)}</div><div class="muted" style="font-size:12px">${esc([x.weight, x.popular ? 'хит' : '', x.available === false ? 'стоп-лист' : '', !x.composition ? 'нет состава' : ''].filter(Boolean).join(' · '))}</div></div>
        <div class="ctl">
          <label class="sr-only" for="p-${esc(x.id)}">Цена ${esc(x.name)}</label>
          <input id="p-${esc(x.id)}" class="input price-input" inputmode="numeric" data-a="price" data-id="${esc(x.id)}" value="${esc(x.price)}">
          ${stopChips(x)}
          <button type="button" class="switch" role="switch" aria-checked="${x.available !== false}" aria-label="В меню: ${esc(x.name)}" title="Показывать в меню (во всех заведениях)" data-a="avail" data-id="${esc(x.id)}"></button>
          <button type="button" class="icon-btn" data-a="item-edit" data-id="${esc(x.id)}" aria-label="Изменить ${esc(x.name)}">✎</button>
        </div>
      </div>`).join('') : '<div class="empty">В категории пока нет позиций.</div>'}
    </div>
    <p class="muted" style="font-size:12px;margin:0">Цену можно менять прямо в поле — сохраняется при выходе из поля. Кнопки с названием заведения — стоп-лист этой точки. Переключатель — показывать блюдо в меню вообще.</p>` : '<div class="empty">Добавьте первую категорию.</div>'}
  </div>`;
}

function itemSheet(item) {
  const { esc, photo } = ctx;
  const x = item || { name: '', price: '', weight: '', description: '', image_url: '', category_id: A.catId, available: true, popular: false };
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<form class="sheet" id="item-form" role="dialog" aria-modal="true" aria-label="${item ? 'Изменить позицию' : 'Новая позиция'}">
    <span class="grab"></span>
    <h2 class="h2">${item ? 'Изменить позицию' : 'Новая позиция'}</h2>
    <div id="img-prev">${photo(x.image_url)}</div>
    <div class="grid-2">
      <label class="btn btn-ghost btn-sm" style="cursor:pointer">Загрузить фото<input type="file" accept="image/*" name="file" class="sr-only"></label>
      <button type="button" class="btn btn-ghost btn-sm" data-x="img-clear">Убрать фото</button>
    </div>
    <label class="field">Ссылка на фото (необязательно)<input class="input" name="image_url" value="${esc(x.image_url && !x.image_url.startsWith('data:') ? x.image_url : '')}"></label>
    <label class="field">Название<input class="input" name="name" ${lock} required value="${esc(x.name)}"></label>
    <div class="grid-2">
      <label class="field">Цена, ₽<input class="input" name="price" inputmode="numeric" required value="${esc(x.price)}"></label>
      <label class="field">Вес / объём<input class="input" name="weight" placeholder="300 г" value="${esc(x.weight)}"></label>
    </div>
    <label class="field">Категория<select class="select" name="category_id">${A.menu.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === x.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field">Описание<textarea class="textarea" name="description">${esc(x.description)}</textarea></label>
    <label class="field">Состав (по закону — для гостя)<textarea class="textarea" name="composition" placeholder="Говядина, булочка, сыр чеддер, соус…">${esc(x.composition || '')}</textarea></label>
    <label class="field">Пищевая ценность на 100 г<input class="input" name="nutrition" placeholder="Ккал 250 · Б 15 · Ж 12 · У 20" value="${esc(x.nutrition || '')}"></label>
    <label class="field">Аллергены<input class="input" name="allergens" placeholder="Глютен, молоко, горчица" value="${esc(x.allergens || '')}"></label>
    <div class="between"><span>В наличии</span><button type="button" class="switch" role="switch" data-x="available" aria-checked="${x.available !== false}" aria-label="В наличии"></button></div>
    <div class="between"><span>Показывать в «Хитах паба»</span><button type="button" class="switch" role="switch" data-x="popular" aria-checked="${!!x.popular}" aria-label="Хит"></button></div>
    <p class="error" role="alert" style="margin:0"></p>
    <button type="submit" class="btn btn-accent btn-block">Сохранить</button>
    ${item ? '<button type="button" class="btn btn-danger btn-block" data-x="delete">Удалить позицию</button>' : ''}
    <button type="button" class="btn btn-ghost btn-block" data-x="close">Отмена</button>
  </form>`;
  let imageUrl = x.image_url || '';
  const form = wrap.querySelector('form');
  const err = wrap.querySelector('.error');
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap) return wrap.remove();
    const b = e.target.closest('[data-x]'); if (!b) return;
    const k = b.dataset.x;
    if (k === 'close') wrap.remove();
    if (k === 'available' || k === 'popular') b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true'));
    if (k === 'img-clear') { imageUrl = ''; form.image_url.value = ''; wrap.querySelector('#img-prev').innerHTML = photo(''); }
    if (k === 'delete' && confirm(`Удалить «${x.name}»?`)) {
      await store.deleteItem(x.id); wrap.remove(); await refreshMenu(); ctx.toast('Позиция удалена');
    }
  });
  form.file.addEventListener('change', async () => {
    const f = form.file.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { err.textContent = 'Фото больше 5 МБ — уменьшите его'; return; }
    err.textContent = 'Загружаем фото…';
    try { imageUrl = await store.uploadImage(await shrink(f)); wrap.querySelector('#img-prev').innerHTML = photo(imageUrl); err.textContent = ''; }
    catch (ex) { console.error(ex); err.textContent = 'Не удалось загрузить фото'; }
  });
  form.image_url.addEventListener('change', () => { imageUrl = form.image_url.value.trim(); wrap.querySelector('#img-prev').innerHTML = photo(imageUrl); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const price = parseInt(String(d.price).replace(/\D/g, ''), 10);
    if (!d.name.trim()) return (err.textContent = 'Укажите название');
    if (!price || price <= 0) return (err.textContent = 'Укажите цену');
    const row = {
      ...(item ? { id: item.id } : {}),
      name: d.name.trim(), price, weight: d.weight.trim(), description: d.description.trim(),
      composition: d.composition.trim(), nutrition: d.nutrition.trim(), allergens: d.allergens.trim(),
      category_id: d.category_id, image_url: imageUrl,
      available: wrap.querySelector('[data-x=available]').getAttribute('aria-checked') === 'true',
      popular: wrap.querySelector('[data-x=popular]').getAttribute('aria-checked') === 'true',
    };
    if (!item) row.sort = Math.max(0, ...A.menu.items.map((i) => i.sort || 0)) + 1;
    try { await store.saveItem(row); wrap.remove(); A.catId = row.category_id; await refreshMenu(); ctx.toast('Сохранено'); }
    catch (ex) { console.error(ex); err.textContent = 'Не удалось сохранить'; }
  });
  document.body.appendChild(wrap);
  form.name.focus();
}

// Уменьшаем фото до 1200 px перед загрузкой, чтобы меню грузилось быстро
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 600 * 1024) return file;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

async function refreshMenu() { A.menu = await store.getMenu(); await ctx.reloadMenu(); draw(); }

/* ---------- программа лояльности: правила (владелец) ---------- */
async function loadLoyalty() {
  try { A.loy = await store.loyaltySettings(); A.loyStats = await store.loyaltyStats(); } catch (e) { console.error(e); A.loy = null; }
  if (A.tab === 'loyalty') draw();
}
function LoyaltyEditor() {
  const { esc, rub } = ctx;
  if (!A.loy) { loadLoyalty(); return '<div class="empty">Загружаем правила…</div>'; }
  const L = A.loy, S = A.loyStats || {};
  const sw = (k, label, hint = '') => `<div class="between" style="gap:16px"><span class="stack" style="gap:2px"><span>${label}</span>${hint ? `<span class="muted" style="font-size:12px">${hint}</span>` : ''}</span>
    <button type="button" class="switch" role="switch" data-a="loy-sw" data-v="${k}" aria-checked="${!!L[k]}" aria-label="${label}"></button></div>`;
  const num = (k, label, hint = '') => `<label class="field">${label}${hint ? ` <span class="muted" style="font-size:12px">${hint}</span>` : ''}<input class="input" name="${k}" inputmode="numeric" value="${esc(L[k] ?? 0)}"></label>`;
  return `<form id="loy-form" class="stack" style="gap:16px;max-width:760px">
    <div class="grid-2">
      <div class="card stack" style="gap:2px"><span class="muted" style="font-size:12px">Гостей с баллами</span><b style="font-size:22px">${esc(S.guests ?? 0)}</b></div>
      <div class="card stack" style="gap:2px"><span class="muted" style="font-size:12px">Баллов на картах</span><b style="font-size:22px">${rub(S.balance ?? 0)}</b></div>
      <div class="card stack" style="gap:2px"><span class="muted" style="font-size:12px">Начислено за 30 дней</span><b style="font-size:22px">${rub(S.accrued_30 ?? 0)}</b></div>
      <div class="card stack" style="gap:2px"><span class="muted" style="font-size:12px">Списано за 30 дней</span><b style="font-size:22px">${rub(S.redeemed_30 ?? 0)}</b></div>
    </div>
    ${S.imported ? `<div class="card" style="font-size:13px;color:var(--text-2)">Перенесено из MACE Loyalty: ${esc(S.imported)} гостей, уже в приложении: ${esc(S.imported_claimed || 0)}. Остальные получат баллы, когда подтвердят номер; бармен может проводить им чеки по телефону.</div>` : ''}
    <section class="card stack" style="gap:14px">
      ${sw('enabled', 'Программа лояльности включена')}
      ${sw('app_enabled', 'Начислять за заказы в приложении', 'после статуса «Доставлен»')}
      ${sw('venue_enabled', 'Начислять в пабе по QR-коду', 'вкладка «Касса · QR»')}
      ${sw('verified_only', 'Только с подтверждённым номером', 'защита от накруток — рекомендуется')}
      ${sw('accrue_delivery', 'Начислять и на стоимость доставки')}
      ${sw('accrue_if_redeem', 'Начислять, если гость платит баллами', 'выключено — как было в MACE')}
    </section>
    <section class="card stack" style="gap:12px">
      <span class="eyebrow">Уровни: % начисления от суммы покупок</span>
      <div class="stack" id="loy-tiers" style="gap:8px">
        ${(L.tiers || []).map((t, i) => `<div class="tier-row" data-i="${i}">
          <input class="input" name="t_name" value="${esc(t.name)}" placeholder="Название" aria-label="Название уровня">
          <label class="tier-f">от<input class="input" name="t_from" inputmode="numeric" value="${esc(t.from)}" aria-label="Сумма покупок от, ₽"></label>
          <label class="tier-f"><input class="input" name="t_pct" inputmode="numeric" value="${esc(t.pct)}" aria-label="Процент">%</label>
          <button type="button" class="icon-btn" data-a="tier-del" data-v="${i}" aria-label="Удалить уровень">✕</button></div>`).join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-a="tier-add" style="align-self:flex-start">+ Уровень</button>
      <span class="eyebrow" style="margin-top:6px">Особые уровни (назначаются вручную, % фиксированный)</span>
      <div class="stack" style="gap:8px">${(L.fixed_levels || []).map((t, i) => `<div class="tier-row fixed-row" data-i="${i}">
          <input class="input" name="f_name" value="${esc(t.name)}" aria-label="Название особого уровня">
          <label class="tier-f"><input class="input" name="f_pct" inputmode="numeric" value="${esc(t.pct)}" aria-label="Процент">%</label>
          <button type="button" class="icon-btn" data-a="fixed-del" data-v="${i}" aria-label="Удалить">✕</button><span></span></div>`).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-a="fixed-add" style="align-self:flex-start">+ Особый уровень</button>
      <div class="card stack" style="gap:8px;background:var(--surface-2)">
        <span style="font-size:13px">Назначить особый уровень гостю</span>
        <div class="grid-2"><input class="input" id="fx-code" placeholder="Телефон или номер карты"><select class="select" id="fx-level"><option value="">— обычный —</option>${(L.fixed_levels || []).map((t) => `<option>${esc(t.name)}</option>`).join('')}</select></div>
        <button type="button" class="btn btn-outline btn-sm" data-a="fixed-set" style="align-self:flex-start">Назначить</button>
      </div>
      <label class="field">Уровень считается по покупкам
        <select class="select" name="period_days">${[[0, 'за всё время'], [365, 'за последний год'], [180, 'за 6 месяцев'], [90, 'за 3 месяца']].map(([v, l]) => `<option value="${v}" ${+L.period_days === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </section>
    <section class="card stack" style="gap:12px">
      <span class="eyebrow">Условия</span>
      <div class="grid-2">
        ${num('max_redeem_pct', 'Баллами можно оплатить, %', 'до 90')}
        ${num('app_min_order', 'Мин. заказ в приложении для начисления, ₽')}
        ${num('burn_after_days', 'Сгорают без покупок, дней', '0 — не сгорают')}
        ${num('accrue_delay_days', 'Баллы приходят через, дней', '0 — сразу')}
        ${num('welcome_bonus', 'Приветственные баллы')}
        ${num('birthday_bonus', 'Баллы в день рождения')}
      </div>
      <label class="field">Дополнительные условия (видны гостю)<textarea class="textarea" name="rules_text" placeholder="Например: баллы не начисляются на алкоголь и по акциям">${esc(L.rules_text || '')}</textarea></label>
    </section>
    <p class="error" role="alert" style="margin:0"></p>
    <button type="submit" class="btn btn-accent">Сохранить правила</button>
    <p class="muted" style="font-size:12px;margin:0;line-height:1.6">Пример: «Гость 0 ₽ — 5%», «Завсегдатай от 5 000 ₽ — 10%», «Свой человек от 15 000 ₽ — 15%». Процент берётся по уровню на момент покупки. Изменения сразу действуют для всех гостей.</p>
  </form>`;
}
function readLoyForm(f) {
  const d = Object.fromEntries(new FormData(f));
  const n = (v) => Math.max(0, parseInt(String(v).replace(/\D/g, ''), 10) || 0);
  const tiers = [...f.querySelectorAll('#loy-tiers .tier-row')].map((r) => ({ name: r.querySelector('[name=t_name]').value.trim() || 'Уровень', from: n(r.querySelector('[name=t_from]').value), pct: Math.min(100, n(r.querySelector('[name=t_pct]').value)) }))
    .sort((a, b) => a.from - b.from);
  const sw = (k) => f.querySelector(`[data-a=loy-sw][data-v=${k}]`).getAttribute('aria-checked') === 'true';
  const fixed_levels = [...f.querySelectorAll('.fixed-row')].map((r) => ({ name: r.querySelector('[name=f_name]').value.trim() || 'Особый', pct: Math.min(100, n(r.querySelector('[name=f_pct]').value)) }));
  return { ...A.loy, tiers, period_days: n(d.period_days), max_redeem_pct: Math.min(90, n(d.max_redeem_pct)), app_min_order: n(d.app_min_order),
    fixed_levels, accrue_delay_days: n(d.accrue_delay_days), accrue_if_redeem: sw('accrue_if_redeem'),
    burn_after_days: n(d.burn_after_days), welcome_bonus: n(d.welcome_bonus), birthday_bonus: n(d.birthday_bonus), rules_text: (d.rules_text || '').trim(),
    enabled: sw('enabled'), app_enabled: sw('app_enabled'), venue_enabled: sw('venue_enabled'), verified_only: sw('verified_only'), accrue_delivery: sw('accrue_delivery') };
}
async function onLoyaltySubmit(e) {
  const f = e.target.closest('#loy-form'); if (!f) return;
  e.preventDefault();
  const st = readLoyForm(f);
  if (!st.tiers.length) return (f.querySelector('.error').textContent = 'Нужен хотя бы один уровень');
  if (st.tiers[0].from !== 0) st.tiers[0].from = 0;
  try { await store.saveLoyaltySettings(st); A.loy = st; draw(); ctx.toast('Правила сохранены'); }
  catch (ex) { console.error(ex); f.querySelector('.error').textContent = 'Не удалось сохранить: ' + (ex.message || ''); }
}

/* ---------- касса: QR гостя → начисление / списание ---------- */
function Cashier() {
  const { esc, rub } = ctx;
  const vs = myVenues();
  if (!A.cashVenue || !vs.find((v) => v.id === A.cashVenue)) A.cashVenue = vs[0]?.id;
  const g = A.cashGuest;
  const max = g ? Math.min(g.balance, Math.floor((A.cashAmount || 0) * (g.max_redeem_pct || 0) / 100)) : 0;
  const canScan = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  return `<div class="stack" style="gap:16px;max-width:560px">
    ${vs.length > 1 ? `<label class="field">Заведение<select class="select" data-a="cash-venue">${vs.map((v) => `<option value="${esc(v.id)}" ${v.id === A.cashVenue ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>` : `<span class="venue-tag v-${esc(A.cashVenue)}">📍 ${esc(vName(A.cashVenue))}</span>`}
    <form id="cash-find" class="stack" style="gap:10px">
      <label class="field">QR-код, номер карты или телефон гостя
        <input class="input" name="code" autocomplete="off" placeholder="Наведите сканер или введите номер" value="${esc(A.cashCode || '')}"></label>
      <div class="row" style="flex-wrap:wrap">
        <button type="submit" class="btn btn-accent btn-sm">Найти гостя</button>
        ${canScan ? '<button type="button" class="btn btn-outline btn-sm" data-a="scan">📷 Сканировать камерой</button>' : ''}
      </div>
      ${A.scanning ? '<video id="scan-video" class="scan-video" playsinline muted></video><button type="button" class="btn btn-ghost btn-sm" data-a="scan-stop">Остановить камеру</button>' : ''}
      ${canScan ? '' : '<span class="muted" style="font-size:12px">Камера в этом браузере не умеет читать QR — используйте сканер штрихкодов (он вводит код сам) или номер карты / телефон.</span>'}
      <p class="error" role="alert" style="margin:0">${esc(A.cashErr || '')}</p>
    </form>
    ${g ? `<form id="cash-go" class="card stack cashier-guest" style="gap:12px">
      <div class="between"><span class="h2" style="font-size:20px;text-transform:none">${esc(g.name)}</span><span class="pill">${esc(g.tier?.name || '')} · ${esc(g.tier?.pct ?? 0)}%</span></div>
      <span class="muted" style="font-size:13px">Карта № ${esc(g.card_no)}${g.phone_last4 ? ` · телефон …${esc(g.phone_last4)}` : ''}</span>
      ${g.legacy ? '<span class="pill" style="align-self:flex-start">прежняя карта MACE · приложение ещё не установлено</span>' : ''}
      <div class="sum-row"><span>Баллов на карте</span><b style="font-size:20px">${rub(g.balance)}</b></div>
      ${g.active ? '' : '<span class="error">У гостя не подтверждён номер — баллы не копятся. Попросите подтвердить номер в приложении.</span>'}
      <div class="grid-2">
        <label class="field">Сумма чека, ₽<input class="input" name="amount" inputmode="numeric" required value="${esc(A.cashAmount || '')}" data-a="cash-amount"></label>
        <label class="field">Списать баллов <span class="muted" style="font-size:12px">до ${esc(max)}</span><input class="input" name="redeem" inputmode="numeric" value="0"></label>
      </div>
      <label class="field">Комментарий (номер стола, чека)<input class="input" name="note"></label>
      <p class="error" role="alert" style="margin:0"></p>
      <button type="submit" class="btn btn-accent">Провести: начислить${g.tier?.pct ? ` ${esc(g.tier.pct)}%` : ''}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-a="cash-clear">Другой гость</button>
    </form>` : ''}
    ${A.cashLast ? `<div class="card" style="border-color:var(--ok)">✓ ${esc(A.cashLast)}</div>` : ''}
    <p class="muted" style="font-size:12px;line-height:1.6;margin:0">Гость открывает в приложении «Профиль → Карта гостя» и показывает QR. Код меняется каждые 30 секунд, поэтому скриншот чужой карты не сработает. Сначала спишите баллы (если гость хочет), остальное оплачивается обычным способом — баллы начислятся на оплаченную часть.</p>
  </div>`;
}
async function cashLookup(code) {
  A.cashErr = ''; A.cashCode = code; A.cashLast = '';
  try { A.cashGuest = await store.staffLookup(code); } catch (ex) { A.cashGuest = null; A.cashErr = ex.message; }
  draw();
  document.querySelector('#cash-go [name=amount]')?.focus();
}
let scanStream = null;
async function startScan() {
  A.scanning = true; draw();
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = document.getElementById('scan-video'); v.srcObject = scanStream; await v.play();
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!A.scanning) return;
      try { const r = await det.detect(v); if (r[0]?.rawValue) { stopScan(); return cashLookup(r[0].rawValue); } } catch { /* кадр не готов */ }
      requestAnimationFrame(tick);
    };
    tick();
  } catch (ex) { console.error(ex); stopScan(); A.cashErr = 'Нет доступа к камере'; draw(); }
}
function stopScan() { const was = A.scanning; A.scanning = false; scanStream?.getTracks().forEach((t) => t.stop()); scanStream = null; if (was && A.tab === 'cashier' && A.menu) draw(); }
async function onCashSubmit(e) {
  const f = e.target;
  if (f.id === 'cash-find') { e.preventDefault(); const c = f.code.value.trim(); if (c) cashLookup(c); return true; }
  if (f.id !== 'cash-go') return false;
  e.preventDefault();
  const n = (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0;
  const amount = n(f.amount.value), redeem = n(f.redeem.value);
  const btn = f.querySelector('[type=submit]'); btn.disabled = true;
  try {
    const r = await store.staffAccrue(A.cashCode, amount, redeem, A.cashVenue, f.note.value.trim());
    A.cashLast = `${A.cashGuest.name}: ${redeem ? `списано ${redeem}, ` : ''}начислено +${r.points}${r.delay_days ? ` (придут через ${r.delay_days} дн.)` : ''}. Теперь на карте ${r.balance}${r.tier?.name ? `, уровень «${r.tier.name}»` : ''}.`;
    A.cashGuest = null; A.cashCode = ''; A.cashAmount = '';
    draw(); ctx.toast(`Начислено +${r.points}`);
  } catch (ex) { btn.disabled = false; f.querySelector('.error').textContent = ex.message; }
  return true;
}

/* ---------- брони столов ---------- */
const BK_RU = { new: 'Новая', confirmed: 'Подтверждена', declined: 'Отклонена', cancelled: 'Отменена гостем', done: 'Состоялась', noshow: 'Не пришли' };
async function loadBookings() {
  try { A.bk = await store.listReservations(); } catch (e) { console.error(e); A.bk = []; }
  if (A.tab === 'bookings') draw();
}
setInterval(() => { if (location.hash.startsWith('#/admin') && A.menu) loadBookings(); }, 30000);
function Bookings() {
  const { esc, rub } = ctx;
  if (!A.bk) { loadBookings(); return '<div class="empty">Загружаем брони…</div>'; }
  const vs = myVenues().map((v) => v.id);
  const list = A.bk.filter((x) => vs.includes(x.venue_id) && (A.venue === 'all' || x.venue_id === A.venue));
  if (!list.length) return '<div class="empty">Броней на ближайшее время нет</div>';
  const day = (iso) => new Date(iso).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
  let last = '';
  return `<div class="stack" style="gap:10px">${list.map((x) => {
    const d = day(x.starts_at), head = d !== last ? `<span class="eyebrow" style="margin-top:8px">${esc(d)}</span>` : ''; last = d;
    const vn = (A.menu.venues.find((v) => v.id === x.venue_id) || {}).name || x.venue_id;
    return `${head}<article class="card stack" style="gap:6px">
      <div class="between"><b style="font-size:18px">${new Date(x.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })} · ${esc(x.guests)} чел.</b>
        <span class="status-pill ${x.status === 'new' ? 'new' : x.status === 'confirmed' ? 'done' : 'cancelled'}">${BK_RU[x.status] || esc(x.status)}</span></div>
      <span>${esc(x.name)} · <a href="tel:${esc(x.phone)}">${esc(ctx.fmtPhone(x.phone) || x.phone)}</a></span>
      <span class="muted" style="font-size:13px">№${esc(x.number)} · ${esc(vn)}${x.comment ? ` · ${esc(x.comment)}` : ''}${x.deposit ? ` · депозит ${rub(x.deposit)} (${esc(x.payment_status)})` : ''}</span>
      ${['new', 'confirmed'].includes(x.status) ? `<div class="row" style="gap:8px;flex-wrap:wrap">
        ${x.status === 'new' ? `<button type="button" class="btn btn-accent btn-sm" data-a="bk" data-v="confirmed" data-id="${esc(x.id)}">Подтвердить</button>
        <button type="button" class="btn btn-ghost btn-sm" data-a="bk" data-v="declined" data-id="${esc(x.id)}">Нет мест</button>` : ''}
        ${x.status === 'confirmed' ? `<button type="button" class="btn btn-outline btn-sm" data-a="bk" data-v="done" data-id="${esc(x.id)}">Пришли</button>
        <button type="button" class="btn btn-ghost btn-sm" data-a="bk" data-v="noshow" data-id="${esc(x.id)}">Не пришли</button>` : ''}
      </div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

/* ---------- заведения ---------- */
function Venues() {
  const { esc } = ctx;
  const lock = owner() ? '' : 'disabled title="Меняет владелец"';
  return `<div class="admin-grid">${myVenues().map((v) => `<form class="card stack" data-venue="${esc(v.id)}" style="gap:12px">
    <div class="between"><span class="h2">${esc(v.name)}</span>
      <div class="row"><span class="muted" style="font-size:13px">Принимаем заказы</span><button type="button" class="switch" role="switch" data-a="accepting" aria-checked="${v.accepting !== false}" aria-label="Принимаем заказы: ${esc(v.name)}"></button></div></div>
    <label class="field">Название<input class="input" name="name" value="${esc(v.name)}"></label>
    <label class="field">Адрес<input class="input" name="address" ${lock} value="${esc(v.address)}"></label>
    <label class="field">Зона доставки (видна гостям)<input class="input" name="zone" ${lock} value="${esc(v.zone)}"></label>
    <div class="grid-2">
      <label class="field">Телефон<input class="input" name="phone" type="tel" data-phone placeholder="+7 (___) ___-__-__" value="${esc(ctx.fmtPhone(v.phone) || v.phone)}"></label>
      <label class="field">Часы работы<input class="input" name="hours" value="${esc(v.hours)}"></label>
      <label class="field">Доставка, ₽<input class="input" name="delivery_fee" ${lock} inputmode="numeric" value="${esc(v.delivery_fee)}"></label>
      <label class="field">Мин. заказ, ₽<input class="input" name="min_order" ${lock} inputmode="numeric" value="${esc(v.min_order)}"></label>
      <label class="field">Время доставки, мин<input class="input" name="eta_minutes" inputmode="numeric" value="${esc(v.eta_minutes)}"></label>
    </div>
    <div class="between"><span class="stack" style="gap:2px"><span>Онлайн-оплата (Сбер)</span><span class="muted" style="font-size:12px">Карта, СБП, SberPay в приложении</span></span>
      <button type="button" class="switch" role="switch" data-a="pay_online" aria-checked="${!!v.pay_online}" aria-label="Онлайн-оплата: ${esc(v.name)}" ${lock}></button></div>
    <div class="between"><span class="stack" style="gap:2px"><span>Бронирование столов</span><span class="muted" style="font-size:12px">Кнопка «Забронировать стол» в приложении</span></span>
      <button type="button" class="switch" role="switch" data-a="booking_enabled" aria-checked="${v.booking_enabled !== false}" aria-label="Бронирование: ${esc(v.name)}"></button></div>
    <div class="grid-2">
      <label class="field">Депозит с гостя, ₽<input class="input" name="booking_deposit" ${lock} inputmode="numeric" value="${esc(v.booking_deposit || 0)}"><span class="muted" style="font-size:11px">0 — без депозита (тестовый режим)</span></label>
      <label class="field">Макс. гостей в брони<input class="input" name="booking_max_guests" inputmode="numeric" value="${esc(v.booking_max_guests || 12)}"></label>
    </div>
    <button type="submit" class="btn btn-accent">Сохранить</button>
  </form>`).join('')}</div>
  ${owner() ? `<section class="card stack" style="gap:8px;margin-top:16px">
    <span class="eyebrow">Как заказы разделяются по заведениям</span>
    <span style="font-size:14px;line-height:1.6;color:var(--text-2)">Гость выбирает точку при оформлении. Заказ видит только управляющий этой точки и вы. В Telegram он уходит в чат своего заведения (и копия — в ваш общий чат). Если гость ошибся точкой, управляющий нажимает «Передать → …» у нового заказа.</span>
  </section>` : ''}`;
}

/* ---------- события ---------- */
function onClick(e) {
  if (!location.hash.startsWith('#/admin')) return;
  const b = e.target.closest('[data-a]'); if (!b || !root.contains(b)) return;
  const { a, v, id } = b.dataset;
  const act = {
    tab: () => { if (A.scanning) stopScan(); A.tab = v; if (v === 'bookings') A.bk = null; draw(); },
    bk: async () => {
      try { await store.setReservationStatus(b.dataset.id, v); ctx.toast(BK_RU[v] || 'Готово'); await loadBookings(); }
      catch (ex) { ctx.toast(ex.message || 'Не удалось'); }
    },
    filter: () => { A.filter = v; draw(); },
    venue: () => { A.venue = v; draw(); },
    'loy-sw': () => b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')),
    'tier-add': () => { const f = document.getElementById('loy-form'); A.loy = readLoyForm(f); const last = A.loy.tiers[A.loy.tiers.length - 1] || { from: 0, pct: 5 };
      A.loy.tiers.push({ name: 'Новый уровень', from: last.from + 5000, pct: last.pct + 5 }); draw(); },
    'fixed-add': () => { const f = document.getElementById('loy-form'); A.loy = readLoyForm(f); A.loy.fixed_levels.push({ name: 'Особый', pct: 10 }); draw(); },
    'fixed-del': () => { const f = document.getElementById('loy-form'); A.loy = readLoyForm(f); A.loy.fixed_levels.splice(+v, 1); draw(); },
    'fixed-set': async () => {
      const code = document.getElementById('fx-code').value.trim(), lvl = document.getElementById('fx-level').value;
      if (!code) return ctx.toast('Укажите телефон или номер карты');
      const r = await store.setFixedLevel(code, lvl); ctx.toast(`${r.name}: ${r.tier?.name} ${r.tier?.pct}%`);
    },
    'tier-del': () => { const f = document.getElementById('loy-form'); A.loy = readLoyForm(f); A.loy.tiers.splice(+v, 1); draw(); },
    scan: () => startScan(),
    'scan-stop': () => stopScan(),
    'cash-clear': () => { A.cashGuest = null; A.cashCode = ''; A.cashErr = ''; draw(); },
    transfer: async () => {
      const o = A.orders.find((x) => x.id === id);
      if (!confirm(`Передать заказ №${o.number} в «${vName(v)}»? Он исчезнет из вашего списка и придёт управляющему той точки.`)) return;
      b.disabled = true;
      await store.transferOrder(id, v); await loadOrders(); draw(); ctx.toast(`Заказ передан в «${vName(v)}»`);
    },
    stop: async () => {
      const x = A.menu.items.find((i) => i.id === id);
      const off = !(x.stop_in || []).includes(v);
      x.stop_in = await store.setStop(id, v, off); await ctx.reloadMenu(); draw();
      ctx.toast(`${vName(v)}: ${x.name} — ${off ? 'в стоп-листе' : 'снова в продаже'}`);
    },
    logout: async () => { stopScan(); await store.adminSignOut(); A.menu = null; A.me = null; A.venue = 'all'; A.tab = 'orders'; A.filter = 'active'; A.loy = null; A.cashGuest = null; if (A.unsub) { A.unsub(); A.unsub = null; } location.hash = '#/'; },
    status: async () => {
      const o = A.orders.find((x) => x.id === id);
      const online = o?.payment === 'online' && ['held', 'paid'].includes(o.payment_status);
      if (v === 'cancelled' && !confirm(online ? 'Отменить заказ? Деньги гостю вернутся автоматически.' : 'Отменить заказ?')) return;
      b.disabled = true;
      // онлайн-оплата: при принятии списываем деньги, при отмене — снимаем блокировку / возвращаем
      if (online && v === 'cooking' && o.payment_status === 'held') {
        try { await store.capturePayment(id); }
        catch (ex) { b.disabled = false; ctx.toast('Не удалось списать оплату: ' + ex.message, 5000); return; }
      }
      if (online && v === 'cancelled') {
        try { await store.cancelPayment(id); }
        catch (ex) { b.disabled = false; ctx.toast('Не удалось вернуть оплату: ' + ex.message + '. Заказ не отменён.', 6000); return; }
      }
      await store.setOrderStatus(id, v); await loadOrders(); draw();
      if (online && v === 'cooking') ctx.toast('Оплата списана, заказ принят');
      if (online && v === 'cancelled') ctx.toast('Заказ отменён, деньги гостю возвращаются');
    },
    cat: () => { A.catId = v; draw(); },
    'cat-add': async () => {
      const name = prompt('Название новой категории'); if (!name?.trim()) return;
      const c = await store.saveCategory({ name: name.trim(), sort: A.menu.categories.length + 1 });
      A.catId = c.id; await refreshMenu();
    },
    'cat-rename': async () => {
      const c = A.menu.categories.find((x) => x.id === A.catId);
      const name = prompt('Новое название', c.name); if (!name?.trim()) return;
      await store.saveCategory({ ...c, name: name.trim() }); await refreshMenu();
    },
    'cat-del': async () => {
      const c = A.menu.categories.find((x) => x.id === A.catId);
      const n = A.menu.items.filter((x) => x.category_id === c.id).length;
      if (!confirm(`Удалить категорию «${c.name}»${n ? ` и ${n} позиций в ней` : ''}?`)) return;
      await store.deleteCategory(c.id); A.catId = null; await refreshMenu();
    },
    'cat-up': () => moveCat(-1),
    'cat-down': () => moveCat(1),
    'item-new': () => itemSheet(null),
    'item-edit': () => itemSheet(A.menu.items.find((x) => x.id === id)),
    avail: async () => {
      const x = A.menu.items.find((i) => i.id === id);
      await store.saveItem({ id, available: x.available === false });
      await refreshMenu();
      ctx.toast(x.available === false ? 'Вернули в продажу' : 'Убрано в стоп-лист');
    },
    accepting: () => b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')),
    pay_online: () => b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')),
    booking_enabled: () => b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')),
  }[a];
  if (act) Promise.resolve(act()).catch((ex) => { console.error(ex); ctx.toast('Ошибка: ' + (ex.message || 'не сохранилось')); });
}

async function moveCat(dir) {
  const cats = [...A.menu.categories];
  const i = cats.findIndex((c) => c.id === A.catId), j = i + dir;
  if (j < 0 || j >= cats.length) return;
  [cats[i], cats[j]] = [cats[j], cats[i]];
  await Promise.all(cats.map((c, k) => (c.sort !== k + 1 ? store.saveCategory({ ...c, sort: k + 1 }) : null)));
  await refreshMenu();
}

async function onPriceChange(e) {
  const el = e.target;
  if (el.dataset?.a !== 'price') return;
  const price = parseInt(el.value.replace(/\D/g, ''), 10);
  const x = A.menu.items.find((i) => i.id === el.dataset.id);
  if (!price || price <= 0) { el.value = x.price; return; }
  if (price === x.price) return;
  try { await store.saveItem({ id: x.id, price }); x.price = price; await ctx.reloadMenu(); ctx.toast(`${x.name}: ${ctx.rub(price)}`); }
  catch (ex) { console.error(ex); el.value = x.price; ctx.toast('Цена не сохранилась'); }
}

async function onVenueSubmit(e) {
  const f = e.target.closest('form[data-venue]'); if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  const num = (s) => parseInt(String(s).replace(/\D/g, ''), 10) || 0;
  try {
    const ops = {   // оперативное — может и управляющий своей точки
      id: f.dataset.venue, phone: d.phone.trim(), hours: d.hours.trim(), eta_minutes: num(d.eta_minutes) || 45,
      accepting: f.querySelector('[data-a=accepting]').getAttribute('aria-checked') === 'true',
      booking_enabled: f.querySelector('[data-a=booking_enabled]').getAttribute('aria-checked') === 'true',
      booking_max_guests: Math.max(1, Math.min(100, num(d.booking_max_guests) || 12)),
    };
    await store.saveVenue(!owner() ? ops : {
      ...ops, name: d.name.trim(), address: d.address.trim(), zone: d.zone.trim(),
      delivery_fee: num(d.delivery_fee), min_order: num(d.min_order),
      pay_online: f.querySelector('[data-a=pay_online]').getAttribute('aria-checked') === 'true',
      booking_deposit: num(d.booking_deposit),
    });
    await refreshMenu(); ctx.toast('Сохранено');
  } catch (ex) { console.error(ex); ctx.toast('Не удалось сохранить'); }
}

document.addEventListener('click', onClick);
document.addEventListener('change', onPriceChange);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.a === 'price') e.target.blur(); });
document.addEventListener('submit', (e) => {
  if (!location.hash.startsWith('#/admin')) return;
  if (e.target.id === 'loy-form') return onLoyaltySubmit(e);
  if (e.target.id === 'cash-find' || e.target.id === 'cash-go') return onCashSubmit(e);
  onVenueSubmit(e);
});
document.addEventListener('change', (e) => {
  if (!location.hash.startsWith('#/admin')) return;
  if (e.target.dataset?.a === 'cash-venue') { A.cashVenue = e.target.value; }
});
document.addEventListener('input', (e) => {
  if (e.target.dataset?.a === 'cash-amount') {
    A.cashAmount = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
    const g = A.cashGuest, lab = e.target.closest('form')?.querySelector('[name=redeem]')?.previousElementSibling;
    if (g && lab) lab.textContent = `до ${Math.min(g.balance, Math.floor(A.cashAmount * (g.max_redeem_pct || 0) / 100))}`;
  }
});
