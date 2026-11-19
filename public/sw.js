const cachePrefix = 'zoya7-blackjack-';
const cacheName = cachePrefix + 'cloud-v7';
const appFiles = [
  './', './table.css', './game.js', './bank-store.js',
  './bank-view.js', './pwa.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './assets/gem.webp', './assets/game_blackjack.webp',
  './assets/game_blackjackclassic.webp', './assets/blackjack.mp3', './assets/card.mp3',
  './assets/chip.mp3', './assets/lose.mp3', './assets/push.mp3', './assets/win.mp3'
];
const scope = new URL(self.registration.scope);
const offlineFiles = new Set(appFiles.map(path => new URL(path, scope).href));
const homePaths = new Set([scope.pathname, scope.pathname + 'index.html']);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(appFiles)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin) return;

  if (request.mode === 'navigate') {
    if (homePaths.has(url.pathname)) event.respondWith(readAppFile('./', request));
  } else if (offlineFiles.has(url.href)) {
    event.respondWith(readAppFile(request, request));
  }
});

async function readAppFile(key, request) {
  const cache = await caches.open(cacheName);
  const response = await cache.match(key);
  return response || fetch(request);
}
