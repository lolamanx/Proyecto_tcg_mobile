const cacheName = 'cardfolio-shell-v3';
const shell = ['/', '/style.css', '/app.js', '/catalog-tools.mjs', '/camera.mjs', '/catalog.json',
  '/icon.png', '/icon-512.png', '/hero.webp', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('cardfolio-shell-') && key !== cacheName).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !shell.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(url.pathname) || Response.error();
  }));
});
