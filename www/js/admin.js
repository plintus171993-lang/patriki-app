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
    <nav class="tabs">${tab('orders', `Заказы${newCount ? ` (${newCount})` : ''}`)}${tab('menu', 'Меню и цены')}${tab('venues', 'Заведения')}</nav>
    <div id="adm-body">${A.tab === 'orders' ? Orders() : A.tab === 'menu' ? MenuEditor() : Venues()}</div>
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
    <span class="eyebrow accent">Коды подтверждения · тестовый режим</span>
    <span class="muted" style="font-size:12px;line-height:1.4">SMS ещё не подключены. Если гость просит код — продиктуйте ему его по телефону.</span>
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
    tab: () => { A.tab = v; draw(); },
    filter: () => { A.filter = v; draw(); },
    venue: () => { A.venue = v; draw(); },
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
    logout: async () => { await store.adminSignOut(); A.menu = null; A.me = null; A.venue = 'all'; A.tab = 'orders'; A.filter = 'active'; if (A.unsub) { A.unsub(); A.unsub = null; } location.hash = '#/'; },
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
    };
    await store.saveVenue(!owner() ? ops : {
      ...ops, name: d.name.trim(), address: d.address.trim(), zone: d.zone.trim(),
      delivery_fee: num(d.delivery_fee), min_order: num(d.min_order),
      pay_online: f.querySelector('[data-a=pay_online]').getAttribute('aria-checked') === 'true',
    });
    await refreshMenu(); ctx.toast('Сохранено');
  } catch (ex) { console.error(ex); ctx.toast('Не удалось сохранить'); }
}

document.addEventListener('click', onClick);
document.addEventListener('change', onPriceChange);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.a === 'price') e.target.blur(); });
document.addEventListener('submit', (e) => { if (location.hash.startsWith('#/admin')) onVenueSubmit(e); });
