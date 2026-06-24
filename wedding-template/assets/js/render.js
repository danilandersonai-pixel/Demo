/* ============================================================
   render.js — рендер контента из window.WEDDING (config.js).
   Ванильный IIFE, выполняется ДО main.js. Если конфига нет —
   тихо выходит (страница остаётся с плейсхолдерами разметки).

   Не трогать как код в задачах по контенту: весь контент —
   в config.js.
   ============================================================ */
(function () {
  'use strict';

  var W = window.WEDDING;
  if (!W) return; /* конфига нет — ничего не делаем */

  /* --- (a) Помощник доступа по пути "a.b.c" --- */
  function getPath(obj, path) {
    if (!path) return undefined;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /* Русские месяцы для форматтера дат */
  var MONTHS = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];

  /* Из "YYYY-MM-DD" → {y,m,d} */
  function parseISO(iso) {
    var p = String(iso || '').split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }
  /* "26 . 08 . 2026" */
  function fmtDotted(iso) {
    var p = parseISO(iso);
    if (!p.y) return '';
    return p.d + ' . ' + String(p.m).padStart(2, '0') + ' . ' + p.y;
  }
  /* "26 августа 2026" */
  function fmtLong(iso) {
    var p = parseISO(iso);
    if (!p.y) return '';
    return p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
  }

  /* Производные значения, которые удобно биндить как пути */
  var dateISO = getPath(W, 'event.dateISO');
  var startTime = getPath(W, 'event.startTime') || '';
  var city = getPath(W, 'event.city') || '';
  W._derived = {
    dateDotted: fmtDotted(dateISO),                                  /* 26 . 08 . 2026 */
    dateLong: fmtLong(dateISO),                                      /* 26 августа 2026 */
    dateLongTime: fmtLong(dateISO) + (startTime ? ' · ' + startTime : ''), /* 26 августа 2026 · 10:00 */
    dateDottedCity: fmtDotted(dateISO) + (city ? ' · ' + city : ''), /* 26 . 08 . 2026 · СПб */
    dateDottedCityHero: fmtDotted(dateISO) + (city ? '  ·  ' + city : ''),
    introKicker: getPath(W, 'couple.name1') + ' ' + getPath(W, 'couple.amp') +
                 ' ' + getPath(W, 'couple.name2') + (dateISO ? ' · ' + fmtLong(dateISO) : '')
  };

  /* --- (b) Текстовые/атрибутные привязки --- */
  function bindNode(el) {
    var path = el.getAttribute('data-bind');
    if (path) {
      var val = getPath(W, path);
      if (val == null) val = '';
      var tag = el.tagName;
      if (tag === 'IMG') {
        el.setAttribute('src', val);
      } else if (tag === 'A') {
        el.setAttribute('href', val);
      } else if (tag === 'IFRAME') {
        el.setAttribute('src', val);
      } else {
        /* контент может содержать &nbsp; и пр. сущности */
        el.innerHTML = val;
      }
    }
    var attrSpec = el.getAttribute('data-bind-attr');
    if (attrSpec) {
      attrSpec.split(';').forEach(function (pair) {
        var idx = pair.indexOf(':');
        if (idx < 0) return;
        var attr = pair.slice(0, idx).trim();
        var p = pair.slice(idx + 1).trim();
        var v = getPath(W, p);
        if (v != null) el.setAttribute(attr, v);
      });
    }
  }

  function bindAll(root) {
    var nodes = (root || document).querySelectorAll('[data-bind],[data-bind-attr]');
    Array.prototype.forEach.call(nodes, bindNode);
  }

  /* --- (c) Hero-имена, монограммы навигации и прелоадера --- */
  var amp = getPath(W, 'couple.amp') || '&';
  var name1 = getPath(W, 'couple.name1') || '';
  var name2 = getPath(W, 'couple.name2') || '';
  var mono1 = getPath(W, 'couple.monogram1') || '';
  var mono2 = getPath(W, 'couple.monogram2') || '';

  /* Имена «N1 <amp> N2» с заданным классом для амперсанда —
     одинаково для hero и футера */
  function buildNames(selector, ampClass) {
    var el = document.querySelector(selector);
    if (!el) return;
    el.textContent = '';
    el.appendChild(document.createTextNode(name1 + ' '));
    var span = document.createElement('span');
    span.className = ampClass;
    span.textContent = amp;
    el.appendChild(span);
    el.appendChild(document.createTextNode(' ' + name2));
  }

  /* alt hero-фото — из имён текущей пары (без утечки прежней) */
  function setHeroAlts() {
    var imgs = document.querySelectorAll('.hero__photo img');
    Array.prototype.forEach.call(imgs, function (img) {
      img.setAttribute('alt', name1 + ' и ' + name2);
    });
  }

  /* Монограмма: M1&nbsp;<span class="X">&</span>&nbsp;M2 */
  function buildMonogram(el, ampClass) {
    if (!el) return;
    el.textContent = '';
    el.appendChild(document.createTextNode(mono1 + ' '));
    var span = document.createElement('span');
    span.className = ampClass;
    span.textContent = amp;
    el.appendChild(span);
    el.appendChild(document.createTextNode(' ' + mono2));
  }

  /* --- (g) Карты из адреса --- */
  function mapWidget(address, zoom) {
    return 'https://yandex.ru/map-widget/v1/?text=' +
      encodeURIComponent(address) + '&z=' + (zoom || 16);
  }
  function yandexRoute(address) {
    return 'https://yandex.ru/maps/?text=' + encodeURIComponent(address);
  }
  function googleMaps(address) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
  }

  /* --- (d) Списки из <template> --- */
  function renderList(name) {
    var container = document.querySelector('[data-list="' + name + '"]');
    var tpl = document.querySelector('template[data-tpl="' + name + '"]');
    if (!container || !tpl) return;
    var items = getPath(W, name);
    if (!Array.isArray(items)) return;

    items.forEach(function (item, index) {
      var frag = tpl.content.cloneNode(true);
      var rootEl = frag.querySelector('*'); /* первый элемент шаблона */

      /* Привязки внутри шаблона: data-bind="field" → item[field] */
      var binds = frag.querySelectorAll('[data-bind]');
      Array.prototype.forEach.call(binds, function (node) {
        var field = node.getAttribute('data-bind');
        var val = item[field];
        if (val == null) val = '';
        var tag = node.tagName;
        if (tag === 'IMG') node.setAttribute('src', val);
        else if (tag === 'A' || tag === 'IFRAME') node.setAttribute('src', val), node.setAttribute('href', val);
        else node.innerHTML = val;
        /* alt для картинок */
        if (tag === 'IMG' && item.alt != null) node.setAttribute('alt', item.alt);
        /* СНЯТЬ data-bind, иначе финальный bindAll(document) затрёт
           эти узлы пустотой (item-поля не являются путями в W) */
        node.removeAttribute('data-bind');
      });

      /* data-bind-attr="attr:field;..." → item[field] */
      var attrBinds = frag.querySelectorAll('[data-bind-attr]');
      Array.prototype.forEach.call(attrBinds, function (node) {
        node.getAttribute('data-bind-attr').split(';').forEach(function (pair) {
          var idx = pair.indexOf(':');
          if (idx < 0) return;
          var attr = pair.slice(0, idx).trim();
          var f = pair.slice(idx + 1).trim();
          if (item[f] != null) node.setAttribute(attr, item[f]);
        });
        node.removeAttribute('data-bind-attr');
      });

      if (rootEl) {
        /* tilt → --r; parallax → data-parallax */
        if (item.tilt != null) rootEl.style.setProperty('--r', item.tilt);
        if (item.parallax != null) rootEl.setAttribute('data-parallax', item.parallax);

        /* Чередование reveal--left / reveal--right по чётности —
           только если шаблон помечен data-alt-reveal */
        if (rootEl.hasAttribute('data-alt-reveal')) {
          rootEl.removeAttribute('data-alt-reveal');
          rootEl.classList.add(index % 2 === 0 ? 'reveal--left' : 'reveal--right');
        }
      }

      container.appendChild(frag);
    });
  }

  /* Спец-рендер локаций (карты + кнопки маршрутов) */
  function renderLocations() {
    var container = document.querySelector('[data-list="locations"]');
    var tpl = document.querySelector('template[data-tpl="locations"]');
    if (!container || !tpl) return;
    var items = getPath(W, 'locations');
    if (!Array.isArray(items)) return;

    items.forEach(function (item, index) {
      var frag = tpl.content.cloneNode(true);
      var rootEl = frag.querySelector('*');

      var timeEl = frag.querySelector('[data-loc="time"]');
      var titleEl = frag.querySelector('[data-loc="title"]');
      var addrEl = frag.querySelector('[data-loc="address"]');
      var iframeEl = frag.querySelector('[data-loc="map"]');
      var yaEl = frag.querySelector('[data-loc="yandex"]');
      var ggEl = frag.querySelector('[data-loc="google"]');

      if (timeEl) timeEl.innerHTML = item.time || '';
      if (titleEl) titleEl.innerHTML = item.title || '';
      if (addrEl) addrEl.innerHTML = item.address || '';
      if (iframeEl) {
        iframeEl.setAttribute('src', mapWidget(item.address, item.zoom));
        iframeEl.setAttribute('title', 'Карта: ' + (item.title || item.address || ''));
      }
      if (yaEl) {
        yaEl.setAttribute('href', yandexRoute(item.address));
        yaEl.setAttribute('aria-label', 'Построить маршрут до «' + (item.title || '') + '» в Яндекс Картах');
      }
      if (ggEl) {
        ggEl.setAttribute('href', googleMaps(item.address));
        ggEl.setAttribute('aria-label', 'Открыть «' + (item.title || '') + '» в Google Maps');
      }

      if (rootEl) {
        rootEl.classList.add(index % 2 === 0 ? 'reveal--left' : 'reveal--right');
      }

      container.appendChild(frag);
    });
  }

  /* --- (e) Свотчи дресс-кода --- */
  function renderSwatches() {
    var ul = document.querySelector('[data-list="swatches"]');
    if (!ul) return;
    var sw = getPath(W, 'details.dress.swatches');
    if (!Array.isArray(sw)) return;
    sw.forEach(function (s) {
      var li = document.createElement('li');
      li.className = 'swatch';
      li.style.setProperty('--c', s.color);
      li.setAttribute('title', s.name);
      var span = document.createElement('span');
      span.className = 'sr-only';
      span.textContent = s.name;
      li.appendChild(span);
      ul.appendChild(li);
    });
  }

  /* --- (f) Booth: два изображения --- */
  function renderBooth() {
    var media = document.querySelector('[data-booth-media]');
    if (!media) return;
    var imgs = getPath(W, 'details.booth.images');
    if (!Array.isArray(imgs)) return;
    imgs.forEach(function (src, i) {
      var img = document.createElement('img');
      img.setAttribute('src', src);
      img.setAttribute('alt', 'Фотозона, вид ' + (i === 0 ? 'первый' : 'второй'));
      img.setAttribute('loading', 'lazy');
      img.setAttribute('onerror', "this.classList.add('img-failed')");
      media.appendChild(img);
    });
  }

  /* --- (h) Палитра → CSS-переменные :root --- */
  function applyColors() {
    var c = getPath(W, 'colors');
    if (!c) return;
    var map = {
      wine: '--wine', wineSoft: '--wine-soft', wineDeep: '--wine-deep',
      cream: '--cream', paper: '--paper', gold: '--gold',
      goldBright: '--gold-bright', ink: '--ink', muted: '--muted'
    };
    var root = document.documentElement;
    Object.keys(map).forEach(function (k) {
      if (c[k] != null) root.style.setProperty(map[k], c[k]);
    });
  }

  /* --- (i) Мета --- */
  function applyMeta() {
    var m = getPath(W, 'meta') || {};
    if (m.title) document.title = m.title;
    if (m.lang) document.documentElement.setAttribute('lang', m.lang);
    if (m.description) {
      var d = document.querySelector('meta[name="description"]');
      if (d) d.setAttribute('content', m.description);
    }
    if (m.themeColor) {
      var t = document.querySelector('meta[name="theme-color"]');
      if (t) t.setAttribute('content', m.themeColor);
    }
  }

  /* --- (j) Favicon из инициалов (inline-SVG data-URI) --- */
  function applyFavicon() {
    var gold = getPath(W, 'colors.gold') || '#c9a253';
    var goldBright = getPath(W, 'colors.goldBright') || '#e8cf95';
    var wine = getPath(W, 'colors.wine') || '#4a0008';
    var initials = mono1 + amp + mono2;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + goldBright + '"/>' +
      '<stop offset="1" stop-color="' + gold + '"/></linearGradient></defs>' +
      '<rect width="64" height="64" rx="14" fill="' + wine + '"/>' +
      '<rect x="3.5" y="3.5" width="57" height="57" rx="11" fill="none" stroke="url(#g)" stroke-width="1" opacity="0.55"/>' +
      '<path d="M32 7.5 L36.5 12 L32 16.5 L27.5 12 Z" fill="none" stroke="url(#g)" stroke-width="1.2"/>' +
      '<text x="32" y="40" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="24" font-weight="500" fill="url(#g)">' + initials + '</text>' +
      '<path d="M14 51 h36" stroke="url(#g)" stroke-width="1" opacity="0.7"/>' +
      '<path d="M32 48.6 L34.4 51 L32 53.4 L29.6 51 Z" fill="' + gold + '"/></svg>';
    var href = 'data:image/svg+xml,' + encodeURIComponent(svg);
    var link = document.querySelector('link[rel="icon"]');
    if (link) link.setAttribute('href', href);
  }

  /* ============================================================
     Запуск
     ============================================================ */
  applyColors();
  applyMeta();
  applyFavicon();

  buildNames('.hero__names', 'hero__amp');
  buildNames('.footer__names', 'footer__amp');
  setHeroAlts();
  buildMonogram(document.querySelector('.nav__brand'), 'nav__amp');
  buildMonogram(document.querySelector('.preloader__monogram'), 'preloader__amp');

  renderList('gallery');
  renderList('story');
  renderList('program');
  renderLocations();
  renderSwatches();
  renderBooth();

  /* Наклон QR-фигуры цветов (--r) */
  (function () {
    var qrFig = document.querySelector('[data-flowers-qr]');
    var tilt = getPath(W, 'flowers.tilt');
    if (qrFig && tilt != null) qrFig.style.setProperty('--r', tilt);
  })();

  /* Текстовые/атрибутные привязки — после построения списков,
     чтобы покрыть и статичные узлы. */
  bindAll(document);

})();
