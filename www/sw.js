// Service worker: оболочка приложения работает офлайн, меню и заказы всегда идут в сеть.
const CACHE = 'patriki-v13';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/admin.js', 'js/store.js', 'js/config.js', 'js/seed.js', 'js/logo.js', 'js/loyalty.js', 'js/update.js', 'js/build.js', 'img/emblem.svg', 'img/logo-full.svg', 'icons/icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Сначала сеть, при отсутствии интернета — кэш
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
