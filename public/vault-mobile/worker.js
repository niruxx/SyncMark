const CACHE = 'syncmark-vault-shell-v1';
const FILES = ['/vault-mobile/', '/vault-mobile/index.html', '/vault-mobile/app.js', '/vault-mobile/style.css', '/vault-mobile/icon.svg', '/vault-mobile/manifest.webmanifest', '/vaultCrypto.js', '/vaultClient.js'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('syncmark-vault-shell-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !FILES.includes(url.pathname) || url.search) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname)));
});
