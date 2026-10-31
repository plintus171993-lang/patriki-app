// Обновление приложения без переустановки.
// Android-приложение (APK) открывает сайт patrikipab.ru внутри себя (capacitor.config: server.url),
// поэтому при каждом запуске гость получает свежую версию — как на сайте.
// Если приложение долго было открыто, а за это время вышла новая сборка, — подсказка «Обновить» (перезагрузка).
// Если изменилась нативная часть (разрешения, плагины) — update.json: apk_min, и мы предложим скачать новый APK.

const LATEST_URL = 'https://patrikipab.ru/update/latest.json';
const CHECK_EVERY = 3 * 60 * 1000; // не чаще раза в 3 минуты

const cap = window.Capacitor;
const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
const plug = (name) => { try { return (cap.Plugins && cap.Plugins[name]) || (cap.registerPlugin ? cap.registerPlugin(name) : null); } catch { return null; } };
const AppPlugin = isNative ? plug('App') : null;

export const BUILD = Number(window.PK_BUILD) || 0;

let lastCheck = 0;
let shownFor = 0;      // для какой сборки уже показали окно в этом запуске
let busy = false;

/** Оставлено для совместимости (раньше подтверждало рабочую версию плагину обновлений). */
export function markReady() {}

export function startUpdateChecks() {
  if (!BUILD) return; // локальная разработка — проверять нечего
  setTimeout(check, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  try { AppPlugin && AppPlugin.addListener('resume', () => check()); } catch { /* нет плагина App */ }
}

async function check(force = false) {
  if (busy) return 'busy';
  if (!force && (!navigator.onLine || Date.now() - lastCheck < CHECK_EVERY)) return 'skip';
  lastCheck = Date.now();
  busy = true;
  try {
    const r = await fetch(LATEST_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('сервер обновлений ответил ' + r.status);
    const L = await r.json();
    if (!L || !(L.build > BUILD)) return 'latest';
    if (force) shownFor = 0;
    if (isNative) await nativeUpdate(L);
    else webPrompt(L);
    return 'update';
  } catch (e) {
    console.warn('update check', e);
    lastError = (e && e.message) || String(e);
    return 'error';
  } finally {
    busy = false;
  }
}
let lastError = '';

/** Кнопка «Проверить обновления» на экране «Информация». */
export async function checkNow() {
  const r = await check(true);
  if (r === 'latest') return { ok: true, text: `У вас последняя версия (сборка ${BUILD})` };
  if (r === 'update') return { ok: true, text: '' };
  if (r === 'busy') return { ok: true, text: 'Уже проверяем…' };
  return { ok: false, text: 'Не удалось проверить: ' + lastError + '' };
}

async function nativeUpdate(L) {
  // нативная часть устарела — нужна новая APK; иначе достаточно перезагрузить страницу
  let nativeBuild = 0;
  try { nativeBuild = Number((await AppPlugin.getInfo()).build) || 0; } catch { /* ignore */ }
  if (L.apk_min && nativeBuild && nativeBuild < L.apk_min) {
    if (shownFor !== L.build) { shownFor = L.build; apkSheet(L); }
    return;
  }
  webPrompt(L);
}

function webPrompt(L) {
  if (shownFor === L.build) return;
  shownFor = L.build;
  sheet({
    title: 'Есть новая версия',
    text: `Версия ${esc(L.version || '')}. Обновление займёт пару секунд — корзина и вход сохранятся.`,
    notes: L.notes,
    ok: 'Обновить',
    later: 'Позже',
    onOk: async () => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.update();
      } catch { /* ignore */ }
      location.reload();
    },
  });
}

function apkSheet(L) {
  sheet({
    title: 'Нужна новая версия приложения',
    text: 'В этой версии изменилась основа приложения, поэтому её нужно установить один раз заново. Скачайте файл и нажмите «Установить» — вход и баллы сохранятся.',
    notes: L.notes,
    ok: 'Скачать обновление',
    later: 'Позже',
    onOk: () => { location.href = L.apk || 'https://patrikipab.ru/download/patriki.apk'; },
  });
}

// не перебиваем оформление заказа, оплату и ввод кода — покажем позже
const BUSY_ROUTES = ['/checkout', '/verify', '/pay', '/booking'];
function routeBusy() {
  const h = (location.hash || '').replace(/^#/, '');
  return BUSY_ROUTES.some((r) => h.startsWith(r)) || !!document.querySelector('.sheet-wrap');
}

function sheet(o) {
  if (routeBusy()) {
    const retry = () => { if (!routeBusy()) { window.removeEventListener('hashchange', retry); sheet(o); } };
    window.addEventListener('hashchange', retry);
    return;
  }
  const notes = Array.isArray(o.notes) ? o.notes.filter(Boolean) : [];
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="upd-h">
    <span class="grab"></span>
    <div class="row" style="gap:14px"><img src="icons/icon-180.png" width="56" height="56" alt="" style="border-radius:14px;border:1px solid var(--line)">
      <div class="stack" style="gap:2px"><span class="h2" id="upd-h">${esc(o.title)}</span><span class="muted" style="font-size:13px">Патрики Паб</span></div></div>
    <p style="margin:0;color:var(--text-2);line-height:1.5">${o.text}</p>
    ${notes.length ? `<div class="stack" style="gap:6px"><b style="font-size:14px">Что нового</b><ul style="margin:0;padding-left:20px;color:var(--text-2);line-height:1.5">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    <button type="button" class="btn btn-accent btn-block" data-ok>${esc(o.ok)}</button>
    <button type="button" class="btn btn-ghost btn-block" data-close>${esc(o.later)}</button>
  </div>`;
  const close = () => wrap.remove();
  wrap.addEventListener('click', async (e) => {
    if (e.target.closest('[data-ok]')) {
      const b = e.target.closest('[data-ok]');
      b.disabled = true; b.textContent = 'Обновляем…';
      try { await o.onOk(); } catch (err) { console.warn(err); b.disabled = false; b.textContent = o.ok; }
      return;
    }
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  document.body.appendChild(wrap);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
