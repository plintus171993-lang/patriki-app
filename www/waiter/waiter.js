// «Патрики · Официант» — приём заказов в зале.
// Заказ уходит через серверную функцию `waiter` в iiko: на кассу (стол) и сразу на кухню (сервисная печать).
// Без связи заказ остаётся в очереди на телефоне и уходит сам, когда связь вернётся.
const API = 'https://ozbdmczmpejyctezxrdk.supabase.co/functions/v1/waiter';
const APIKEY = 'sb_publishable_PhI0d9qM0Hp7KrERGKHQfg_668fWJMv';
const APK_URL = 'https://github.com/plintus171993-lang/patriki-app/releases/download/waiter-latest/patriki-waiter.apk';
const BUILD = 'dev'; // сборка в GitHub подставляет номер — по нему приложение понимает, что вышло обновление
// номер сборки Android-оболочки (из User-Agent приложения): «PatrikiWaiter/apk-5»; первая версия — без номера
const APK_BUILD = (() => { const m = (navigator.userAgent || '').match(/PatrikiWaiter\/apk(?:-(\d+))?/); return m ? Number(m[1] || 1) : 0; })();

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

/* ---------------- хранилище ---------------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('w_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('w_' + k, JSON.stringify(v)); } catch { /* память переполнена */ } },
  del(k) { try { localStorage.removeItem('w_' + k); } catch { /* */ } },
};

const S = {
  token: LS.get('token', ''),
  staff: LS.get('staff', null),
  data: LS.get('data', null),          // {tables, menu, stop, alive}
  carts: LS.get('carts', {}),          // tableId → {items:[], guests}
  queue: LS.get('queue', []),          // неотправленные / ждущие подтверждения кассы
  section: LS.get('section', null),
  view: 'tables', table: null, tab: 'menu', group: null, q: '',
  tableOrders: null, loadingOrders: false,
};
const save = () => { LS.set('carts', S.carts); LS.set('queue', S.queue); };

/* ---------------- утилиты ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = (n) => (Math.round(Number(n) || 0)).toLocaleString('ru-RU') + ' ₽';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const time = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
let toastT;
function toast(msg, kind = '') {
  $toast.textContent = msg; $toast.className = 'toast ' + kind; $toast.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { $toast.hidden = true; }, kind === 'err' ? 6000 : 3000);
}
function vibrate(ms = 15) { try { navigator.vibrate?.(ms); } catch { /* */ } }

async function api(action, body = {}, { timeout = 25000 } = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(API, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', apikey: APIKEY, 'x-waiter-token': S.token || '' },
      body: JSON.stringify({ action, ...body }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && action !== 'login') { logout(true); throw Object.assign(new Error(d.error || 'Войдите снова'), { auth: true }); }
    if (!r.ok) throw Object.assign(new Error(d.error || 'Ошибка сервера ' + r.status), { server: true });
    return d;
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) throw Object.assign(new Error('Нет связи с сервером'), { offline: true });
    throw e;
  } finally { clearTimeout(t); }
}

/* ---------------- данные ---------------- */
const allTables = () => (S.data?.tables || []).flatMap((s) => s.tables.map((t) => ({ ...t, section: s.name })));
const tableById = (id) => allTables().find((t) => t.id === id);
const tableLabel = (t) => t ? (t.name && t.name !== String(t.number) ? t.name : 'Стол ' + t.number) : '';
const products = () => {
  const m = new Map();
  for (const g of S.data?.menu?.groups || []) for (const it of g.items) if (!m.has(it.id)) m.set(it.id, { ...it, group: g.name });
  return m;
};
const isStop = (id) => S.data?.stop && Object.prototype.hasOwnProperty.call(S.data.stop, id) && S.data.stop[id] <= 0;
const cart = (tid) => (S.carts[tid] ||= { items: [], guests: 0 });
const cartCount = (tid) => (S.carts[tid]?.items || []).reduce((s, i) => s + i.amount, 0);
const lineSum = (i) => (i.price + (i.mods || []).reduce((a, m) => a + m.price * (m.amount || 1), 0)) * i.amount;
const cartSum = (tid) => (S.carts[tid]?.items || []).reduce((s, i) => s + lineSum(i), 0);

async function loadData(force = false) {
  const d = await api('bootstrap', { force });
  S.data = { tables: d.tables, menu: d.menu, stop: d.stop || {}, alive: d.alive, at: Date.now() };
  S.occ = d.occ || null;
  S.staff = d.staff; LS.set('staff', S.staff); LS.set('data', S.data);
  if (!S.section || !S.data.tables.some((s) => s.id === S.section)) S.section = S.data.tables[0]?.id || null;
}

// занятые столы: касса присылает открытые заказы, приложение подсвечивает столы
async function refreshOcc() {
  if (!S.token || document.hidden || S.view !== 'tables' || !$sheet.hidden) return;
  try {
    const d = await api('occupied');
    S.occ = d.occ || null;
    if (S.data && d.alive != null) S.data.alive = d.alive;
    if (S.view === 'tables' && $sheet.hidden) render();
  } catch { /* тихо */ }
}
const ago = (m) => m == null ? '' : m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')}`;

async function refreshStop() {
  if (!S.token) return;
  try { const d = await api('stop'); if (S.data) { S.data.stop = d.stop || {}; S.data.alive = d.alive; LS.set('data', S.data); } render(); } catch { /* тихо */ }
}

/* ---------------- очередь отправки ---------------- */
let flushing = false;
async function flush() {
  if (flushing || !S.token) return;
  flushing = true;
  try {
    for (const q of S.queue) {
      if (q.state === 'queued' || q.state === 'offline') {
        try {
          const r = await api('send', { clientId: q.clientId, tableId: q.tableId, tableLabel: q.tableLabel, orderId: q.orderId || null, guests: q.guests, items: q.items });
          q.correlationId = r.correlationId; q.state = 'sent'; q.sentAt = Date.now(); save();
        } catch (e) {
          if (e.offline) { q.state = 'offline'; save(); break; }
          q.state = 'error'; q.error = e.message; save();
          toast(`${q.tableLabel}: ${e.message}`, 'err');
        }
      }
      if ((q.state === 'sent' || q.state === 'slow') && q.correlationId) {
        try {
          const st = await api('status', { correlationId: q.correlationId });
          if (st.state === 'Success') { q.state = 'ok'; q.doneAt = Date.now(); toast(`${q.tableLabel}: ${st.number ? 'заказ №' + st.number : 'заказ'} на кассе и на кухне ✓${st.note ? '. ' + st.note : ''}`, st.note ? '' : 'ok'); vibrate(40); if (S.table === q.tableId) setTimeout(loadTableOrders, 1500); }
          else if (st.state === 'Error') { q.state = 'error'; q.error = st.error; toast(`${q.tableLabel}: касса не приняла — ${st.error}`, 'err'); vibrate([60, 60, 60]); }
          else q.wait = st.waiting || null;
          save();
        } catch (e) { if (e.offline) break; }
      }
    }
    // выполненные старше 12 часов убираем
    const cut = Date.now() - 12 * 3600 * 1000;
    S.queue = S.queue.filter((q) => !(q.state === 'ok' && (q.doneAt || 0) < cut));
    save();
  } finally { flushing = false; render(); }
}
setInterval(() => { if (S.queue.some((q) => ['queued', 'offline', 'sent', 'slow'].includes(q.state))) flush(); }, 2500);
setInterval(refreshStop, 60000);
setInterval(refreshOcc, 10000);
addEventListener('online', () => flush());
document.addEventListener('visibilitychange', () => { if (!document.hidden) { flush(); refreshStop(); refreshOcc(); checkUpdate(); } });

/* ---------------- автообновление ---------------- */
// Новая версия выходит на сайт → приложение тихо перезагружается, когда официант на экране столов
// и ничего не отправляется. Корзины столов и очередь хранятся в телефоне и не теряются.
S.update = null; S.apkOld = false;
let lastUpd = 0;
async function checkUpdate() {
  if (BUILD === 'dev' || Date.now() - lastUpd < 60000 || !navigator.onLine) return;
  lastUpd = Date.now();
  try {
    const v = await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json();
    if (APK_BUILD && v.apk_min && APK_BUILD < v.apk_min) S.apkOld = true;
    if (Number(v.build) > Number(BUILD)) { S.update = v.build; applyUpdate(); }
    render();
  } catch { /* нет связи — проверим позже */ }
}
function applyUpdate() {
  if (!S.update) return;
  const busy = flushing || !$sheet.hidden || S.queue.some((q) => ['queued', 'sent'].includes(q.state));
  if (!busy && (S.view === 'tables' || !S.token)) location.reload();
}
setInterval(checkUpdate, 3 * 60 * 1000);
setInterval(applyUpdate, 15000);

/* ---------------- вход ---------------- */
let pin = '';
function renderLogin(msg = '') {
  $app.innerHTML = `
  <div class="login">
    <img src="../img/emblem.svg" alt="" width="64" height="64" onerror="this.remove()">
    <h1>ОФИЦИАНТ</h1>
    <p>Введите свой ПИН-код</p>
    <div class="pins">${Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join('')}</div>
    <div class="err">${esc(msg)}</div>
    <div class="pad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
      <button data-k="del" aria-label="Стереть">⌫</button><button data-k="0">0</button><button data-k="ok" aria-label="Войти">→</button>
    </div>
    ${/Android/i.test(navigator.userAgent) && !/PatrikiWaiter/.test(navigator.userAgent) ? `<a class="link" href="${APK_URL}">Скачать приложение для Android</a>` : ''}
  </div>`;
  $app.querySelector('.pad').onclick = async (e) => {
    const k = e.target.closest('button')?.dataset.k; if (!k) return;
    vibrate();
    if (k === 'del') { pin = pin.slice(0, -1); return renderLogin(); }
    if (k === 'ok') return doLogin();
    if (pin.length < 6) pin += k;
    renderLogin();
    if (pin.length === 6) doLogin();
  };
}
async function doLogin() {
  if (pin.length < 4) return renderLogin('Минимум 4 цифры');
  const p = pin; pin = '';
  $app.querySelector('.err').innerHTML = '<span class="spin"></span>';
  try {
    const r = await api('login', { pin: p });
    S.token = r.token; LS.set('token', r.token);
    S.staff = { name: r.name, role: r.role }; LS.set('staff', S.staff);
    await start();
  } catch (e) { renderLogin(e.message); }
}
function logout(expired = false) {
  S.token = ''; LS.del('token'); S.staff = null; LS.del('staff');
  closeSheet(); renderLogin(expired ? 'Сессия закончилась — войдите снова' : '');
}

/* ---------------- экраны ---------------- */
function render() {
  if (!S.token) return renderLogin();
  if (!S.data) return;
  if (S.view === 'table' && S.table) return renderTable();
  if (S.view === 'history') return renderHistory();
  if (S.view === 'staff') return renderStaff();
  return renderTables();
}

function statusLine() {
  const a = S.data?.alive;
  const pend = S.queue.filter((q) => ['queued', 'offline'].includes(q.state)).length;
  const cls = a === true ? 'on' : a === false ? 'off' : '';
  const txt = a === true ? 'касса на связи' : a === false ? 'касса не на связи' : 'статус кассы неизвестен';
  return `<small><span class="dot ${cls}"></span>${esc(S.staff?.name || '')} · ${txt}${pend ? ` · в очереди ${pend}` : ''}</small>`;
}

function renderTables() {
  const secs = S.data.tables || [];
  const sec = secs.find((s) => s.id === S.section) || secs[0];
  const qByTable = new Set(S.queue.filter((q) => !['ok'].includes(q.state)).map((q) => q.tableId));
  const offline = !navigator.onLine;
  $app.innerHTML = `
  <div class="top">
    <h1>Столы${statusLine()}</h1>
    <button class="ib" data-a="reload" aria-label="Обновить">↻</button>
    <button class="ib" data-a="menu" aria-label="Меню">☰</button>
  </div>
  ${S.apkOld ? `<div class="banner warn">Вышла новая версия приложения для Android. <a href="${APK_URL}" style="color:inherit;font-weight:600">Скачать и установить</a> — заказы и вход сохранятся.</div>` : ''}
  ${offline ? '<div class="banner">Нет интернета. Заказы сохранятся на телефоне и уйдут сами, когда связь вернётся.</div>' : ''}
  ${S.data.alive === false ? '<div class="banner warn">Главная касса не на связи. Проверьте, что она включена, iikoFront запущен и есть интернет. Заказы подождут в очереди и встанут на столы, как только касса появится.</div>' : ''}
  <div class="tabs">${secs.map((s) => `<button class="chip ${s.id === sec?.id ? 'on' : ''}" data-sec="${s.id}">${esc(s.name)}</button>`).join('')}</div>
  ${S.occ ? '<div class="legend"><i class="lg open"></i>открыт: сколько сидят · сумма <i class="lg bill"></i>пречек</div>' : ''}
  <div class="grid">
    ${(sec?.tables || []).map((t) => {
      const n = cartCount(t.id);
      const o = S.occ?.[t.id];
      const sub = o ? `${o.bill ? 'счёт · ' : ''}${ago(o.mins)}${o.sum ? ` · ${rub(o.sum)}` : ''}` : (t.name && t.name !== String(t.number) ? t.name : 'стол');
      return `<button class="tbl ${o ? (o.bill ? 'open bill' : 'open') : ''} ${n ? 'cart' : ''} ${qByTable.has(t.id) ? 'q' : ''}" data-t="${t.id}" data-n="${n}">
        <b>${esc(t.number)}</b><span>${esc(sub)}</span></button>`;
    }).join('') || '<div class="empty">В этом зале нет столов</div>'}
  </div>`;
  $app.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sec) { S.section = b.dataset.sec; LS.set('section', S.section); return render(); }
    if (b.dataset.t) return openTable(b.dataset.t);
    if (b.dataset.a === 'reload') return reload();
    if (b.dataset.a === 'menu') return openMainMenu();
  };
}

async function reload() {
  toast('Обновляю меню и столы…');
  try { await loadData(true); toast('Меню и столы обновлены', 'ok'); } catch (e) { toast(e.message, 'err'); }
  render(); flush();
}

function openMainMenu() {
  openSheet(`
    <h2>${esc(S.staff?.name || '')}</h2>
    <div class="sub">${S.staff?.role === 'manager' ? 'Управляющий' : 'Официант'}</div>
    <div class="menu-list">
      <button data-a="history">Мои заказы за смену</button>
      ${S.staff?.role === 'manager' ? '<button data-a="staff">Сотрудники и ПИН-коды</button>' : ''}
      <button data-a="reload">Обновить меню и столы</button>
      <button data-a="logout" style="color:var(--danger)">Выйти</button>
    </div>`, (a) => {
    closeSheet();
    if (a === 'history') { S.view = 'history'; render(); loadHistory(); }
    if (a === 'staff') { S.view = 'staff'; render(); loadStaff(); }
    if (a === 'reload') reload();
    if (a === 'logout') logout();
  });
}

/* ---------- стол ---------- */
function openTable(id) {
  S.table = id; S.view = 'table'; S.tab = 'menu'; S.q = ''; S.group = null; S.tableOrders = null;
  render(); loadTableOrders();
}
async function loadTableOrders() {
  const id = S.table; S.loadingOrders = true; if (S.tab === 'orders') render();
  try { const r = await api('table_orders', { tableId: id }, { timeout: 20000 }); if (S.table === id) { S.tableOrders = r.orders || []; S.ordersAge = r.age ?? null; } }
  catch (e) { if (S.table === id) S.tableOrders = { error: e.message }; }
  finally { S.loadingOrders = false; if (S.table === id) render(); }
}
const openOrder = () => (Array.isArray(S.tableOrders) ? S.tableOrders.find((o) => o.status === 'New') : null);

function renderTable() {
  const t = tableById(S.table);
  const c = cart(S.table);
  const n = cartCount(S.table);
  const oo = openOrder();
  const sub = Array.isArray(S.tableOrders) ? (oo ? `открыт заказ №${oo.number} · ${rub(oo.sum)}` : 'свободен') : (S.loadingOrders ? 'проверяю заказы…' : '');
  $app.innerHTML = `
  <div class="top">
    <button class="ib" data-a="back" aria-label="Назад">←</button>
    <h1>${esc(tableLabel(t))}<small>${esc(t?.section || '')}${sub ? ' · ' + esc(sub) : ''}</small></h1>
  </div>
  <div class="seg">
    <button class="${S.tab === 'menu' ? 'on' : ''}" data-tab="menu">Меню</button>
    <button class="${S.tab === 'orders' ? 'on' : ''}" data-tab="orders">На столе${Array.isArray(S.tableOrders) && S.tableOrders.length ? ` (${S.tableOrders.length})` : ''}</button>
  </div>
  ${S.tab === 'menu' ? menuHtml() : ordersHtml()}
  ${n ? `<div class="bar"><div class="in"><button class="btn" data-a="cart"><span class="cnt">${n}</span> Заказ стола <span class="sum">${rub(cartSum(S.table))}</span></button></div></div>` : ''}`;
  const inp = $app.querySelector('.search input');
  if (inp) {
    inp.oninput = () => { S.q = inp.value; const l = $app.querySelector('.list'); l.innerHTML = listHtml(); };
    if (S._focus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); S._focus = false; }
  }
  $app.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'back') { S.view = 'tables'; S.table = null; render(); return refreshOcc(); }
    if (b.dataset.tab) { S.tab = b.dataset.tab; if (S.tab === 'orders') loadTableOrders(); return render(); }
    if (b.dataset.g !== undefined) { S.group = b.dataset.g || null; return render(); }
    if (b.dataset.p) return addProduct(b.dataset.p);
    if (b.dataset.a === 'cart') return openCart();
    if (b.dataset.a === 'reloadOrders') return loadTableOrders();
    if (b.dataset.a === 'clear') { S.q = ''; S._focus = true; return render(); }
  };
  void c;
}

function menuHtml() {
  const groups = S.data.menu?.groups || [];
  return `
  <div class="search"><input type="search" placeholder="Поиск блюда или напитка" value="${esc(S.q)}" autocomplete="off">
    ${S.q ? '<button class="ib" data-a="clear" aria-label="Очистить">✕</button>' : ''}</div>
  ${S.q ? '' : `<div class="tabs"><button class="chip ${!S.group ? 'on' : ''}" data-g="">Все</button>${groups.map((g) => `<button class="chip ${S.group === g.id ? 'on' : ''}" data-g="${g.id}">${esc(g.name)}</button>`).join('')}</div>`}
  <div class="list">${listHtml()}</div>`;
}

function listHtml() {
  const groups = S.data.menu?.groups || [];
  const c = S.carts[S.table]?.items || [];
  const inCart = (id) => c.filter((i) => i.productId === id).reduce((s, i) => s + i.amount, 0);
  const item = (it) => {
    const st = isStop(it.id), q = inCart(it.id);
    return `<button class="it ${st ? 'stop' : ''}" data-p="${it.id}">
      <span class="n">${esc(it.name)}${st ? '<small>стоп-лист</small>' : it.open ? '<small>свободная цена</small>' : it.mods?.some((g) => g.items.length > 1) || it.sizes ? '<small>с выбором</small>' : ''}</span>
      <span class="p">${it.open && !it.price ? 'цена ✎' : rub(it.price)}</span>${q ? `<span class="q">${q}</span>` : ''}</button>`;
  };
  if (S.q.trim()) {
    const q = S.q.trim().toLowerCase();
    const seen = new Set(); const found = [];
    for (const g of groups) for (const it of g.items) if (!seen.has(it.id) && it.name.toLowerCase().includes(q)) { seen.add(it.id); found.push(it); }
    return found.length ? found.slice(0, 80).map(item).join('') : '<div class="empty">Ничего не найдено</div>';
  }
  const show = S.group ? groups.filter((g) => g.id === S.group) : groups;
  if (!show.length) return '<div class="empty">Меню пустое. Нажмите «Обновить меню» в главном меню.</div>';
  return show.map((g) => `${S.group ? '' : `<div class="gh">${esc(g.name)}</div>`}${g.items.map(item).join('')}`).join('');
}

function ordersHtml() {
  if (S.loadingOrders && !Array.isArray(S.tableOrders)) return '<div class="empty"><span class="spin"></span><br><br>Запрашиваю заказы стола у кассы…</div>';
  if (S.tableOrders?.error) return `<div class="banner">Не удалось получить заказы: ${esc(S.tableOrders.error)}</div><div class="empty"><button class="link" data-a="reloadOrders">Повторить</button></div>`;
  const qs = S.queue.filter((q) => q.tableId === S.table && q.state !== 'ok');
  const qHtml = qs.map((q) => `<div class="ord"><h3><span>Отправка с телефона</span><span class="badge ${q.state === 'error' ? 'err' : 'q'}">${qLabel(q)}</span></h3>
    ${q.items.map((i) => `<div class="li"><span>${esc(i.name)} × ${i.amount}</span><span>${rub(lineSum(i))}</span></div>`).join('')}
    ${q.state === 'error' ? `<div class="mini" style="color:var(--danger);margin-top:6px">${esc(q.error || '')}</div><div class="row" style="margin-top:10px"><button class="btn ghost" data-retry="${q.clientId}">Отправить ещё раз</button><button class="btn danger" data-drop="${q.clientId}">Убрать</button></div>` : ''}
  </div>`).join('');
  const os = Array.isArray(S.tableOrders) ? S.tableOrders : [];
  const stale = S.ordersAge === null || S.ordersAge > 120;
  setTimeout(() => {
    $app.querySelectorAll('[data-retry]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const q = S.queue.find((x) => x.clientId === b.dataset.retry); if (q) { q.state = 'queued'; q.error = null; save(); flush(); } });
    $app.querySelectorAll('[data-drop]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); S.queue = S.queue.filter((x) => x.clientId !== b.dataset.drop); save(); render(); });
  });
  return `${stale && S.ordersAge !== undefined ? `<div class="banner warn">${S.ordersAge === null ? 'Касса ещё не присылала заказы столов.' : 'Касса давно не на связи — список может быть неполным.'}</div>` : ''}${qHtml}${os.length ? os.map((o) => `<div class="ord">
      <h3><span>Заказ №${esc(o.number)}${o.status === 'Bill' ? ' · пречек' : ''}</span><span>${rub(o.sum)}</span></h3>
      <div class="mini" style="margin-bottom:6px">${esc([o.waiter, o.guests ? o.guests + ' гост.' : '', o.created ? 'с ' + esc(String(o.created).slice(11, 16)) : ''].filter(Boolean).join(' · '))}</div>
      ${o.items.map((i) => `<div class="li"><span>${esc(i.name)} × ${i.amount}${i.mods?.length ? `<small>${esc(i.mods.join(', '))}</small>` : ''}${i.comment ? `<small>«${esc(i.comment)}»</small>` : ''}</span><span>${rub(i.sum)}</span></div>`).join('')}
    </div>`).join('') : (qs.length ? '' : '<div class="empty">На столе нет открытых заказов</div>')}
    <div class="empty" style="padding:16px"><button class="link" data-a="reloadOrders">${S.loadingOrders ? '<span class="spin"></span>' : 'Обновить'}</button></div>`;
}

function qLabel(q) {
  if (q.state === 'sent' && q.wait === 'queued' && Date.now() - (q.sentAt || 0) > 20000) return 'ждёт кассу';
  return { queued: 'отправляю…', offline: 'ждёт связи', sent: 'касса принимает…', slow: 'ждёт кассу', error: 'ошибка', ok: 'принят' }[q.state] || q.state;
}

/* ---------- добавление позиции ---------- */
function addProduct(pid) {
  const p = products().get(pid); if (!p) return;
  if (isStop(pid)) { toast('Позиция в стоп-листе', 'err'); return; }
  if (p.open) return openPrice(p);
  if (p.mods?.length || p.sizes?.length) return openMods(p);
  pushItem({ productId: p.id, name: p.name, price: p.price, sizeId: p.sizeId, amount: 1, mods: [] });
}
// свободное блюдо (свободная цена на кассе): официант вводит цену, касса ставит её позиции
function openPrice(p) {
  openSheet(`
    <h2>${esc(p.name)}</h2><div class="sub">Свободная цена — введите сумму за 1 шт.</div>
    <input class="field" id="op" placeholder="Цена, ₽" inputmode="decimal" autocomplete="off" value="${p.price ? esc(String(p.price)) : ''}">
    <div style="height:14px"></div><button class="btn" data-a="ok">Добавить</button>`, (a) => {
    if (a !== 'ok') return;
    const v = Number(String($sheet.querySelector('#op').value).replace(',', '.').replace(/\s/g, ''));
    if (!(v > 0) || v > 1000000) return toast('Введите цену', 'err');
    const price = Math.round(v * 100) / 100;
    closeSheet();
    if (p.mods?.length || p.sizes?.length) return openMods({ ...p, price, sizes: undefined }, { open: true });
    pushItem({ productId: p.id, name: p.name, price, sizeId: p.sizeId, amount: 1, mods: [], open: true });
  });
  setTimeout(() => $sheet.querySelector('#op')?.focus(), 50);
}
function pushItem(item) {
  const c = cart(S.table);
  const same = c.items.find((i) => i.productId === item.productId && i.sizeId === item.sizeId && !i.comment && i.price === item.price && !!i.open === !!item.open && JSON.stringify(i.mods) === JSON.stringify(item.mods));
  if (same) same.amount += item.amount; else c.items.push({ key: uid(), ...item });
  save(); vibrate();
  const l = $app.querySelector('.list'); const y = window.scrollY;
  renderTable(); if (l) window.scrollTo(0, y);
}

function openMods(p, extra = {}) {
  let size = p.sizes ? (p.sizes.find((s) => s.id === p.sizeId) || p.sizes[0]) : null;
  const sel = {}; // groupId → Set(modId)
  for (const g of p.mods || []) { sel[g.id] = new Set(); if ((g.def > 0 || (g.min === 1 && g.max === 1)) && g.items.length === 1) sel[g.id].add(g.items[0].id); }
  // нечего выбирать (только обязательные одиночные модификаторы) — сразу в заказ
  if (!p.sizes && (p.mods || []).every((g) => g.items.length === 1 && sel[g.id].size === 1 && g.min >= 1)) {
    const mods = p.mods.map((g) => ({ id: g.items[0].id, groupId: g.group ? g.id : null, name: g.items[0].name, price: g.items[0].price, amount: 1 }));
    return pushItem({ productId: p.id, name: p.name, price: p.price, sizeId: p.sizeId, amount: 1, mods, ...extra });
  }
  const draw = () => {
    const price = (size ? size.price : p.price) + (p.mods || []).flatMap((g) => g.items.filter((m) => sel[g.id].has(m.id))).reduce((s, m) => s + m.price, 0);
    const ok = (p.mods || []).every((g) => sel[g.id].size >= g.min);
    openSheet(`
      <h2>${esc(p.name)}</h2><div class="sub">${rub(price)}</div>
      ${p.sizes ? `<div class="mg">Размер</div>${p.sizes.map((s) => `<button class="opt ${size?.id === s.id ? 'on' : ''}" data-size="${s.id}"><span class="n">${esc(s.name || 'Обычный')}</span><span>${rub(s.price)}</span></button>`).join('')}` : ''}
      ${(p.mods || []).map((g) => `<div class="mg">${esc(g.name)} <small>${g.min ? 'обязательно' : 'по желанию'}${g.max > 1 ? `, до ${g.max}` : ''}</small></div>
        ${g.items.map((m) => `<button class="opt ${sel[g.id].has(m.id) ? 'on' : ''}" data-g="${g.id}" data-m="${m.id}"><span class="n">${esc(m.name)}</span>${m.price ? `<span>+${rub(m.price)}</span>` : ''}</button>`).join('')}`).join('')}
      <div style="height:14px"></div>
      <button class="btn" data-a="add" ${ok ? '' : 'disabled'}>Добавить · ${rub(price)}</button>`, (a, b) => {
      if (b.dataset.size) { size = p.sizes.find((s) => s.id === b.dataset.size); return draw(); }
      if (b.dataset.m) {
        const g = p.mods.find((x) => x.id === b.dataset.g); const s = sel[g.id];
        if (s.has(b.dataset.m)) s.delete(b.dataset.m);
        else { if (g.max === 1) s.clear(); if (!g.max || s.size < g.max) s.add(b.dataset.m); }
        return draw();
      }
      if (a === 'add' && ok) {
        const mods = (p.mods || []).flatMap((g) => g.items.filter((m) => sel[g.id].has(m.id)).map((m) => ({ id: m.id, groupId: g.group ? g.id : null, name: m.name, price: m.price, amount: 1 })));
        closeSheet();
        pushItem({ productId: p.id, name: p.name + (size?.name ? ` (${size.name})` : ''), price: size ? size.price : p.price, sizeId: size ? size.id : p.sizeId, amount: 1, mods, ...extra });
      }
    });
  };
  draw();
}

/* ---------- корзина и отправка ---------- */
function openCart() {
  const t = tableById(S.table); const c = cart(S.table); const oo = openOrder();
  if (!c.items.length) { closeSheet(); return renderTable(); }
  openSheet(`
    <h2>${esc(tableLabel(t))}</h2>
    <div class="sub">${oo ? `Дозаказ к открытому заказу №${esc(oo.number)}` : 'Новый заказ на стол'}</div>
    ${oo ? '' : `<div class="guests"><span>Гостей</span><div class="stepper"><button data-gu="-1">−</button><b>${c.guests || '—'}</b><button data-gu="1">+</button></div></div>`}
    ${c.items.map((i) => `<div class="ci">
      <div class="l1"><span class="n">${esc(i.name)}</span>
        <div class="stepper"><button data-dec="${i.key}">−</button><b>${i.amount}</b><button data-inc="${i.key}">+</button></div></div>
      ${i.mods?.length ? `<div class="mods">${esc(i.mods.map((m) => m.name).join(', '))}</div>` : ''}
      <div class="row" style="justify-content:space-between;align-items:center"><button class="link" data-cm="${i.key}">${i.comment ? '✎ ' + esc(i.comment) : '+ комментарий для кухни'}</button><span class="mini">${rub(lineSum(i))}</span></div>
    </div>`).join('')}
    <div class="total"><span>Итого</span><span>${rub(cartSum(S.table))}</span></div>
    <button class="btn" data-a="send">${oo ? 'Дозаказ на кухню' : 'Отправить на кухню'}</button>
    <div style="height:10px"></div>
    <button class="btn danger" data-a="clear">Очистить</button>`, (a, b) => {
    const it = (k) => c.items.find((i) => i.key === k);
    if (b.dataset.gu) { c.guests = Math.max(0, Math.min(50, (c.guests || 0) + Number(b.dataset.gu))); save(); return openCart(); }
    if (b.dataset.inc) { it(b.dataset.inc).amount++; save(); return openCart(); }
    if (b.dataset.dec) { const x = it(b.dataset.dec); x.amount--; if (x.amount <= 0) c.items = c.items.filter((i) => i !== x); save(); return openCart(); }
    if (b.dataset.cm) {
      const x = it(b.dataset.cm); const v = prompt('Комментарий для кухни', x.comment || '');
      if (v !== null) { x.comment = v.trim().slice(0, 200); save(); } return openCart();
    }
    if (a === 'clear') { if (confirm('Очистить заказ этого стола?')) { c.items = []; save(); closeSheet(); renderTable(); } return; }
    if (a === 'send') return sendCart();
  });
}

function sendCart() {
  const t = tableById(S.table); const c = cart(S.table); const oo = openOrder();
  if (!c.items.length) return;
  const stopped = c.items.filter((i) => isStop(i.productId));
  if (stopped.length) { toast('В стоп-листе: ' + stopped.map((i) => i.name).join(', '), 'err'); return; }
  const job = {
    clientId: uid(), tableId: S.table, tableLabel: tableLabel(t), orderId: oo?.id || null, guests: c.guests || 0,
    items: c.items.map(({ key, ...i }) => i), state: 'queued', createdAt: Date.now(),
  };
  S.queue.push(job);
  S.carts[S.table] = { items: [], guests: 0 };
  save(); closeSheet(); vibrate(30);
  toast(navigator.onLine ? 'Отправляю на кассу…' : 'Нет связи — заказ в очереди, уйдёт сам');
  S.tab = 'orders'; renderTable();
  flush().then(() => setTimeout(loadTableOrders, 4000));
}

/* ---------- история ---------- */
let hist = null;
async function loadHistory() {
  hist = null; render();
  try { hist = (await api('history')).orders || []; } catch (e) { hist = { error: e.message }; }
  render();
}
function renderHistory() {
  const local = S.queue.filter((q) => q.state !== 'ok').slice().reverse();
  $app.innerHTML = `
  <div class="top"><button class="ib" data-a="back">←</button><h1>Заказы за смену${statusLine()}</h1></div>
  ${local.length ? `<div class="gh" style="margin:16px 16px 0">На телефоне</div><div class="hist">${local.map((q) => `<div class="hi"><span class="n">${esc(q.tableLabel)}<small>${time(q.createdAt)} · ${q.items.length} поз.</small></span><span class="badge ${q.state === 'error' ? 'err' : 'q'}">${qLabel(q)}</span></div>`).join('')}</div>` : ''}
  <div class="gh" style="margin:16px 16px 0">Отправлено</div>
  <div class="hist">${hist === null ? '<div class="empty"><span class="spin"></span></div>' : hist.error ? `<div class="empty">${esc(hist.error)}</div>` :
    hist.length ? hist.map((o) => `<div class="hi"><span class="n">${esc(o.table_label || '')}${o.kind === 'add' ? ' · дозаказ' : ''}<small>${time(o.created_at)}${o.waiter_staff?.name && S.staff?.role === 'manager' ? ' · ' + esc(o.waiter_staff.name) : ''}${o.error ? ' · ' + esc(o.error) : ''}</small></span><span class="mini">${rub(o.total)}</span><span class="badge ${o.status === 'ok' ? 'ok' : o.status === 'error' ? 'err' : 'q'}">${o.status === 'ok' ? 'принят' : o.status === 'error' ? 'ошибка' : 'отправлен'}</span></div>`).join('')
    : '<div class="empty">Пока нет заказов</div>'}</div>`;
  $app.onclick = (e) => { if (e.target.closest('[data-a="back"]')) { S.view = 'tables'; render(); } };
}

/* ---------- официанты (управляющий) ---------- */
// Сотрудники берутся из iiko: управляющий выбирает человека из списка iiko и задаёт ему ПИН.
// Уволенный в iiko сотрудник отключается в приложении сам. Можно добавить и вручную (стажёр, подработка).
let staffList = null, staffNote = '';
async function loadStaff(force = false) {
  staffList = null; render();
  try { const r = await api('staff_list', { force }); staffList = r.staff || []; staffNote = r.iikoError ? 'iiko не ответил: ' + r.iikoError : ''; }
  catch (e) { staffList = { error: e.message }; }
  render();
}
function renderStaff() {
  const act = Array.isArray(staffList) ? staffList.filter((s) => s.active) : [];
  const off = Array.isArray(staffList) ? staffList.filter((s) => !s.active) : [];
  const row = (s) => `<div class="hi" style="${s.active ? '' : 'opacity:.45'}"><span class="n">${esc(s.name)}<small>${s.role === 'manager' ? 'управляющий' : 'официант'}${s.iiko_employee_id ? ' · из iiko' : ''}${s.active ? '' : ' · отключён'}</small></span>
      <button class="badge" data-edit="${s.id}">${s.active ? 'ПИН' : 'Вернуть'}</button>${s.active ? `<button class="badge err" data-off="${s.id}">Откл.</button>` : ''}</div>`;
  $app.innerHTML = `
  <div class="top"><button class="ib" data-a="back">←</button><h1>Сотрудники</h1><button class="ib" data-a="sync" aria-label="Обновить из iiko">↻</button></div>
  <div style="padding:12px 16px 0" class="row"><button class="btn" data-a="fromIiko">＋ Из сотрудников iiko</button></div>
  <div style="padding:10px 16px 0" class="row"><button class="btn ghost" data-a="add">＋ Вручную</button></div>
  ${staffNote ? `<div class="banner warn">${esc(staffNote)}</div>` : ''}
  <div class="hist" style="margin-top:8px">${staffList === null ? '<div class="empty"><span class="spin"></span></div>' : staffList.error ? `<div class="empty">${esc(staffList.error)}</div>` :
    act.map(row).join('') + (off.length ? `<div class="gh">Отключены</div>${off.map(row).join('')}` : '')}</div>
  <div class="empty mini" style="padding:16px">ПИН — 4–6 цифр, у каждого свой. Уволенный в iiko сотрудник отключается здесь автоматически, отключённый сразу выходит из приложения.</div>`;
  $app.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'back') { S.view = 'tables'; return render(); }
    if (b.dataset.a === 'sync') return loadStaff(true);
    if (b.dataset.a === 'add') return editStaff(null);
    if (b.dataset.a === 'fromIiko') return pickIiko();
    if (b.dataset.edit) return editStaff(staffList.find((s) => s.id === b.dataset.edit));
    if (b.dataset.off) {
      const s = staffList.find((x) => x.id === b.dataset.off);
      if (!confirm(`Отключить ${s.name}?`)) return;
      try { await api('staff_disable', { id: s.id }); toast('Отключён', 'ok'); loadStaff(); } catch (er) { toast(er.message, 'err'); }
    }
  };
}
async function pickIiko() {
  openSheet('<h2>Сотрудники iiko</h2><div class="sub">Загружаю список…</div><div class="empty"><span class="spin"></span></div>');
  let list;
  try { list = (await api('staff_iiko')).employees || []; } catch (e) { return openSheet(`<h2>Сотрудники iiko</h2><div class="banner">${esc(e.message)}</div>`); }
  const draw = (q = '') => {
    const f = list.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
    openSheet(`<h2>Сотрудники iiko</h2><div class="sub">Выберите, кому выдать ПИН</div>
      <input class="field" id="iq" placeholder="Поиск" value="${esc(q)}" autocomplete="off">
      <div class="menu-list">${f.map((x) => `<button data-emp="${x.id}" ${x.staffId ? 'style="opacity:.5"' : ''}>${esc(x.name)}<br><span class="mini">${esc(x.roles.join(', ') || 'без должности')}${x.staffId ? ' · уже есть ПИН' : ''}</span></button>`).join('') || '<div class="empty">Никого не нашлось</div>'}</div>`, (a, b) => {
      if (!b.dataset.emp) return;
      const x = list.find((y) => y.id === b.dataset.emp);
      if (x.staffId) { const s = Array.isArray(staffList) && staffList.find((y) => y.id === x.staffId); return editStaff(s || { id: x.staffId, name: x.name, role: 'waiter', iiko_employee_id: x.id }); }
      const mgr = x.roles.some((r) => /управляющ|менеджер|администратор/i.test(r));
      editStaff(null, { name: x.name, role: mgr ? 'manager' : 'waiter', iikoEmployeeId: x.id });
    });
    const inp = $sheet.querySelector('#iq');
    inp.oninput = () => { const v = inp.value; draw(v); const i2 = $sheet.querySelector('#iq'); i2.focus(); i2.setSelectionRange(v.length, v.length); };
  };
  draw();
}
function editStaff(s, pre = null) {
  const name = s?.name || pre?.name || '';
  const role = s?.role || pre?.role || 'waiter';
  const iikoId = s?.iiko_employee_id || pre?.iikoEmployeeId || null;
  openSheet(`
    <h2>${s ? esc(s.name) : pre ? esc(pre.name) : 'Новый сотрудник'}</h2>
    <div class="sub">${iikoId ? 'Сотрудник из iiko · ' : ''}${s ? 'задайте новый ПИН' : 'задайте ПИН для входа'}</div>
    <input class="field" id="sn" placeholder="Имя в приложении" value="${esc(name)}" maxlength="60">
    <input class="field" id="sp" placeholder="ПИН (4–6 цифр)" inputmode="numeric" maxlength="6" autocomplete="off">
    <div class="mg">Роль</div>
    <button class="opt ${role !== 'manager' ? 'on' : ''}" data-role="waiter"><span class="n">Официант</span></button>
    <button class="opt ${role === 'manager' ? 'on' : ''}" data-role="manager"><span class="n">Управляющий</span><span class="mini">видит все заказы, выдаёт ПИН</span></button>
    <div style="height:14px"></div><button class="btn" data-a="save">Сохранить</button>`, async (a, b) => {
    if (b.dataset.role) { $sheet.querySelectorAll('[data-role]').forEach((x) => x.classList.toggle('on', x === b)); return; }
    if (a !== 'save') return;
    const nm = $sheet.querySelector('#sn').value.trim(); const pinv = $sheet.querySelector('#sp').value.trim();
    const rl = $sheet.querySelector('[data-role].on')?.dataset.role || 'waiter';
    if (!nm) return toast('Введите имя', 'err');
    if (!/^[0-9]{4,6}$/.test(pinv)) return toast('ПИН — от 4 до 6 цифр', 'err');
    try {
      await api('staff_save', { id: s?.id || null, name: nm, pin: pinv, role: rl, ...(iikoId ? { iikoEmployeeId: iikoId, iikoName: pre?.name || s?.iiko_name || nm } : {}) });
      closeSheet(); toast(`Сохранено. ПИН ${nm}: ${pinv}`, 'ok'); loadStaff();
    } catch (er) { toast(er.message, 'err'); }
  });
}

/* ---------------- лист ---------------- */
function openSheet(html, onAction) {
  $sheet.innerHTML = `<div class="card">${html}</div>`; $sheet.hidden = false;
  $sheet.onclick = (e) => {
    if (e.target === $sheet) return closeSheet();
    const b = e.target.closest('button'); if (!b) return;
    onAction?.(b.dataset.a, b);
  };
}
function closeSheet() { $sheet.hidden = true; $sheet.innerHTML = ''; if (S.view === 'table') renderTable(); }

/* ---------------- запуск ---------------- */
async function start() {
  $app.innerHTML = '<div class="boot"><span class="spin"></span><br><br>Загружаю столы и меню…</div>';
  try { await loadData(); }
  catch (e) {
    if (e.auth) return;
    if (!S.data) { $app.innerHTML = `<div class="login"><h1>Нет данных</h1><p>${esc(e.message)}</p><button class="btn" style="max-width:260px" onclick="location.reload()">Повторить</button><button class="link" id="lo">Выйти</button></div>`; document.getElementById('lo').onclick = () => logout(); return; }
    toast('Нет связи — показываю сохранённое меню', 'err');
    // повторить в фоне, как только сервер ответит — подтянуть свежие столы и меню
    const retry = (n) => setTimeout(() => loadData().then(() => { if (S.view === 'tables' && $sheet.hidden) render(); }).catch(() => { if (n < 5) retry(n + 1); }), 5000 * n);
    retry(1);
  }
  render(); flush(); checkUpdate();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (S.token) start(); else renderLogin();
