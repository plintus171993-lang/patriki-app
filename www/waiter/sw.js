// Service worker приложения официантов: оболочка открывается без интернета.
// Данные (меню, столы, заказы) идут на сервер напрямую и здесь не кэшируются.
const CACHE = 'waiter-v1';
const SHELL = ['./', 'index.html', 'waiter.css', 'waiter.js', 'manifest.webmanifest', '../css/fonts.css', '../icons/icon.svg', '../icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('waiter-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// сначала сеть (чтобы обновления приходили сразу), без сети — из памяти
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const r = await fetch(req);
      if (r && r.ok && r.type === 'basic') c.put(req, r.clone());
      return r;
    } catch {
      return (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match('index.html') : Response.error());
    }
  })());
});
