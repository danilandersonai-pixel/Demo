'use strict';

/**
 * Service worker «Штурмана»: кэш оболочки, чтобы при выключенном сервере
 * вместо белого экрана показывалась понятная страница offline.html.
 * Живые данные (/api/*, /events) НИКОГДА не кэшируются.
 */

var CACHE = 'shturman-shell-v1';
var SHELL = [
  '/',
  '/app.js',
  '/style.css',
  '/favicon.svg',
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // живые данные всегда идут напрямую к серверу
  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/events') return;

  if (e.request.mode === 'navigate') {
    // страница: всегда сеть (свежий index + cookie-логика); сервер молчит —
    // честная страница «сервер не запущен», а не полуживая оболочка
    e.respondWith(
      fetch(e.request).catch(function () {
        return caches.match('/offline.html');
      })
    );
    return;
  }

  // статика оболочки: кэш в приоритете, обновляем в фоне
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      var fetched = fetch(e.request).then(function (resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return resp;
      }).catch(function () { return cached; });
      return cached || fetched;
    })
  );
});
