/* ===========================================================================
   Service worker Штурмана.

   Задача узкая и оттого выполнимая:
     1) кэшировать оболочку (страницу, стили, скрипт, иконки), чтобы
        установленное приложение открывалось мгновенно;
     2) когда сервер на компьютере выключен — показать понятную страницу
        «запустите Штурман», а не белый экран с ошибкой браузера.

   Данные (/api/…) НЕ кэшируются никогда: показывать вчерашнюю ленту как
   сегодняшнюю — хуже, чем честно сказать, что связи нет.
   =========================================================================== */

var VERSION = 'shturman-v3-0';
var SHELL = VERSION + '-shell';

var SHELL_FILES = [
  '/',
  '/tokens.css',
  '/components.css',
  '/styles.css',
  '/copy.js',
  '/icons.js',
  '/app.js',
  '/offline.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL).then(function (cache) {
      // Кладём по одному: если какой-то файл не отдался, установка всё равно
      // должна завершиться, иначе приложение не установится вовсе.
      return Promise.all(SHELL_FILES.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
          return null;
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        // Чистим кэши прошлых версий, иначе они копятся навсегда.
        if (k !== SHELL) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Поток событий не трогаем вообще: SSE и кэш несовместимы.
  if (url.pathname === '/api/stream') return;

  // Данные — только из сети. Нет сети — честная ошибка, которую панель
  // покажет как «связь потеряна».
  if (url.pathname.indexOf('/api/') === 0) {
    event.respondWith(fetch(req).catch(function () {
      return new Response(
        JSON.stringify({ error: 'Нет связи с Штурманом', offline: true }),
        { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }));
    return;
  }

  // Навигация: сначала сеть — панель должна быть свежей.
  //
  // При отказе показываем именно страницу «сервер не запущен», а НЕ
  // закэшированную оболочку. Оболочка без сервера бесполезна: все данные
  // приходят из /api, и человек увидел бы пустую панель с фильтрами вместо
  // объяснения, что делать. Кэш оболочки нужен для быстрого старта, когда
  // сервер жив, а не как замена ему.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put('/', copy); });
        return res;
      }).catch(function () {
        return caches.match('/offline.html').then(function (page) {
          if (page) return page;
          // Офлайн-страницы в кэше не оказалось — отдаём хоть оболочку,
          // она сама покажет «связь потеряна».
          return caches.match('/');
        });
      })
    );
    return;
  }

  // Оболочка: сначала кэш (быстро), в фоне обновляем.
  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(SHELL).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});

// Сигнал «Клод остановился» может прийти из панели — показываем уведомление
// силами service worker: на Android только так оно и работает.
self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type !== 'attention') return;
  self.registration.showNotification('Штурман: ' + (data.title || 'Клод ждёт вас'), {
    body: data.text || '',
    tag: 'shturman-attention',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [120, 60, 120],
    renotify: true
  });
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
      return null;
    })
  );
});
