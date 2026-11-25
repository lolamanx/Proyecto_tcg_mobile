const CACHE = 'cardfolio-shell-v6';
const SHELL = ['/', '/index.html', '/style.css', '/app.js','/scan-help.js','/auto-scan.js', '/catalog-online.js', '/recognition.mjs', '/catalog.json', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('cardfolio-shell-') && key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match(url.pathname) || Response.error()));
});
