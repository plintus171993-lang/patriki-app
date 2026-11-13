// Service worker «Патрики»: приложение открывается сразу, даже при плохом интернете или VPN.
//  • Оболочка (страница, скрипты, стили, шрифты, иконки) — сначала из памяти телефона,
//    свежая копия подтягивается в фоне. Каждая сборка — своя версия кэша (номер подставляет сборка),
//    поэтому кнопка «Обновить» получает именно новую версию.
//  • Страница index.html — из сети, но не дольше 3 секунд; не успела — из памяти.
//  • Данные (меню, заказы, баллы) идут напрямую на сервер и сюда не попадают.
const BUILD = 'dev'; // сборка в GitHub заменяет на номер сборки
const CACHE = 'patriki-' + BUILD;
const SHELL = [
  './', 'index.html', 'offline.html', 'manifest.webmanifest',
  'css/app.css', 'css/fonts.css',
  'js/app.js', 'js/admin.js', 'js/store.js', 'js/config.js', 'js/seed.js', 'js/logo.js', 'js/loyalty.js', 'js/update.js', 'js/build.js',
  'vendor/supabase.js', 'vendor/qrcode.js',
  'img/emblem.svg', 'img/logo-full.svg', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // по одному файлу: если чего-то нет (например, шрифтов в локальной сборке), остальное всё равно кэшируется
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('patriki-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

async function fromNetwork(req, c) {
  const r = await fetch(req);
  if (r && r.ok && r.type === 'basic') c.put(req, r.clone());
  return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // файлы обновления и APK — всегда из сети
  if (url.pathname.includes('/update/') || url.pathname.includes('/download/')) return;

  // страница: сеть не дольше 3 секунд, иначе — сохранённая
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const net = fromNetwork(req, c);
      try {
        return await Promise.race([net, timeout(3000)]);
      } catch {
        const hit = (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html')) || (await c.match('./'));
        if (hit) { net.catch(() => {}); return hit; }
        try { return await net; } catch { return (await c.match('offline.html')) || Response.error(); }
      }
    })());
    return;
  }

  // остальное: сразу из памяти, а в фоне — свежая копия (stale-while-revalidate)
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fromNetwork(req, c);
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    try { return await net; } catch { return Response.error(); }
  })());
});
