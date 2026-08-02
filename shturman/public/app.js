/* ===========================================================================
   Штурман — клиентская часть.

   Ванильный JS, без сборки и библиотек. Одна разметка на телефон и
   компьютер: раскладку меняет CSS, а этот файл лишь переключает активную
   секцию и следит, чтобы всё оставалось доступным на обоих форм-факторах.

   Правило файла: здесь НЕТ русских строк. Всё, что видит человек, приходит
   из copy.js (`C`), все значки — из icons.js (`ICON`). Это проверяется
   тестом: пока строки были рассыпаны по коду, одно и то же называлось
   по-разному в разных местах.

   Разделы:
     0  помощники                8  словарь и подсказки
     1  состояние                9  шторка (детали, настройки, подключение)
     2  вкладки и жесты         10  пульс и граф внимания
     3  оформление              11  картушка и сигнал
     4  лента (виртуализация)   12  журнал сессий
     5  детали события          13  сообщения и состояние
     6  карта проекта           14  поток событий (SSE)
     7  git                     15  управление, тур, приветствие, старт
   =========================================================================== */
(function () {
  'use strict';

  var C = window.COPY;
  var ICON = window.ICONS;

  // ── 0. Помощники ──────────────────────────────────────────────────────────

  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function icon(name, cls) { return ICON.svg(name, cls); }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function clock(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function dateTime(ts) {
    var d = new Date(ts);
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // Русские окончания — формы слов лежат в словаре, логика здесь.
  function plural(n, forms) {
    var abs = Math.abs(Math.trunc(n) || 0);
    var m100 = abs % 100;
    var m10 = abs % 10;
    if (m100 >= 11 && m100 <= 14) return forms[2];
    if (m10 === 1) return forms[0];
    if (m10 >= 2 && m10 <= 4) return forms[1];
    return forms[2];
  }
  function withPlural(n, forms) { return n + ' ' + plural(n, forms); }

  function duration(ms) {
    var u = C.units;
    var total = Math.max(0, Math.round((ms || 0) / 1000));
    var s = total % 60;
    var m = Math.floor(total / 60) % 60;
    var h = Math.floor(total / 3600);
    if (h > 0) return h + ' ' + u.hour + ' ' + m + ' ' + u.min;
    if (m > 0) return m + ' ' + u.min + ' ' + s + ' ' + u.sec;
    return s + ' ' + u.sec;
  }

  function bytes(n) {
    var u = C.units;
    if (!isFinite(n)) return '—';
    if (n < 1024) return n + ' ' + u.bytes;
    if (n < 1048576) return (n / 1024).toFixed(1).replace('.', ',') + ' ' + u.kb;
    return (n / 1048576).toFixed(1).replace('.', ',') + ' ' + u.mb;
  }

  function fmtNum(n) {
    return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  // Достать значение из словаря по пути «feed.title».
  function copyAt(path) {
    var parts = String(path).split('.');
    var node = C;
    for (var i = 0; i < parts.length && node; i++) node = node[parts[i]];
    return typeof node === 'string' ? node : '';
  }

  /**
   * Разметка приходит без слов и без значков: и то и другое подставляется
   * отсюда. Так словарь остаётся единственным источником текста, а набор
   * значков — единственным источником графики.
   */
  function dressUp(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-copy]'), function (n) {
      n.textContent = copyAt(n.dataset.copy);
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-copy-label]'), function (n) {
      var text = copyAt(n.dataset.copyLabel);
      n.setAttribute('aria-label', text);
      if (n.tagName === 'BUTTON' || n.tagName === 'A') n.title = text;
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-copy-ph]'), function (n) {
      n.placeholder = copyAt(n.dataset.copyPh);
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-icon]'), function (n) {
      if (n.querySelector('svg')) return;
      n.insertBefore(icon(n.dataset.icon, n.dataset.iconClass || ''), n.firstChild);
    });
  }

  // Все обращения к серверу проходят через один адресный сборщик: он
  // подставляет выбранный проект и ключ доступа, если мы пришли по ссылке.
  function href(pathStr, params) {
    var u = pathStr;
    var parts = [];
    if (app.projectKey) parts.push('project=' + encodeURIComponent(app.projectKey));
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] === undefined || params[k] === null) return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    if (parts.length) u += (u.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
    return u;
  }

  function api(pathStr, options, params) {
    var opts = options || {};
    // Ключ доступа шлём заголовком: он же лежит в куке, но при первом
    // заходе по ссылке кука может ещё не примениться к fetch.
    if (app.token) {
      opts.headers = Object.assign({ 'X-Shturman-Token': app.token }, opts.headers || {});
    }
    return fetch(href(pathStr, params), opts).then(function (r) {
      if (r.status === 401) throw new Error(C.errors.noKey);
      if (!r.ok && r.status >= 500) throw new Error(C.errors.server(r.status));
      return r.json();
    });
  }

  var store = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem('shturman.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('shturman.' + key, JSON.stringify(value)); } catch (e) { /* приватный режим */ }
    }
  };

  // ── 1. Состояние ──────────────────────────────────────────────────────────

  var app = {
    state: null,
    git: null,
    pulse: null,
    events: [],
    queued: [],
    paused: false,
    detailed: store.get('detailed', false),
    filter: 'all',
    query: '',
    visible: [],             // отфильтрованный срез для виртуализации
    treeNodes: [],
    treeQuery: '',
    treeFailed: false,
    collapsed: {},
    heat: {},
    selectedFile: null,
    gitTab: 'now',
    archive: null,
    projectKey: null,
    projects: [],
    view: 'feed',
    // Звук и уведомления по умолчанию молчат: пуши умеет сам Claude Code,
    // а панель не должна начинать знакомство со звуков.
    sound: store.get('sound', false),
    notify: store.get('notify', false),
    theme: store.get('theme', 'auto'),
    density: store.get('density', 'cozy'),
    openLast: true,
    system: null,
    token: null,
    offline: false,
    alarmed: false,          // сигнал поднят и ещё не отпущен
    alarmText: '',
    lastTitle: '',
    unseen: { feed: 0, git: 0 }
  };

  var MAX_EVENTS = 1500;
  var HEAT_MS = 90000;

  // Ключ доступа приходит в ссылке из QR-кода. Забираем его и убираем из
  // адресной строки: незачем светить ключ в истории браузера.
  (function pickToken() {
    var m = /[?&]t=([^&]+)/.exec(window.location.search);
    if (!m) return;
    app.token = decodeURIComponent(m[1]);
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    } catch (e) { /* не дали — кука уже поставлена */ }
  })();

  // ── 2. Вкладки и жесты ────────────────────────────────────────────────────

  var VIEWS = ['feed', 'map', 'git', 'pulse'];

  function isNarrow() { return window.matchMedia('(max-width: 900px)').matches; }

  function setView(name, direction) {
    if (VIEWS.indexOf(name) === -1) return;
    var prev = app.view;
    app.view = name;
    document.body.dataset.view = name;
    store.set('view', name);

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      // Неактивные вкладки убираем из обхода Tab: по ним ходят стрелками.
      t.tabIndex = on ? 0 : -1;
    });

    if (name === 'feed') app.unseen.feed = 0;
    if (name === 'git') app.unseen.git = 0;
    renderBadges();

    if (direction && prev !== name && !reduceMotion) {
      var section = document.querySelector('.view[data-view="' + name + '"]');
      if (section) {
        var cls = direction > 0 ? 'is-sliding-left' : 'is-sliding-right';
        section.classList.remove('is-sliding-left', 'is-sliding-right');
        void section.offsetWidth;                 // перезапуск анимации
        section.classList.add(cls);
        setTimeout(function () { section.classList.remove(cls); }, 260);
      }
    }
    if (name === 'feed') requestAnimationFrame(renderWindow);
  }

  function shiftView(delta) {
    var i = VIEWS.indexOf(app.view);
    var next = Math.min(VIEWS.length - 1, Math.max(0, i + delta));
    if (next !== i) setView(VIEWS[next], delta);
  }

  function renderBadges() {
    [['feed', 'tabBadgeFeed'], ['git', 'tabBadgeGit']].forEach(function (pair) {
      var n = app.unseen[pair[0]];
      var node = $(pair[1]);
      if (!node) return;
      node.hidden = !n || app.view === pair[0];
      node.textContent = n > 99 ? '99+' : String(n);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () {
      var from = VIEWS.indexOf(app.view);
      var to = VIEWS.indexOf(t.dataset.tab);
      setView(t.dataset.tab, to > from ? 1 : -1);
    });
    // Стрелками между вкладками — привычное поведение панели вкладок.
    t.addEventListener('keydown', function (e) {
      var delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!delta) return;
      e.preventDefault();
      var i = VIEWS.indexOf(t.dataset.tab);
      var next = VIEWS[Math.min(VIEWS.length - 1, Math.max(0, i + delta))];
      setView(next, delta);
      var btn = document.querySelector('.tab[data-tab="' + next + '"]');
      if (btn) btn.focus();
    });
  });

  // Свайп между вкладками: только на узких экранах и только когда жест
  // горизонтальный — иначе он мешал бы обычной прокрутке списка.
  (function swipes() {
    var x0 = null, y0 = null, decided = null;
    var grid = $('grid');

    grid.addEventListener('touchstart', function (e) {
      if (!isNarrow() || e.touches.length !== 1) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      decided = null;
    }, { passive: true });

    grid.addEventListener('touchmove', function (e) {
      if (x0 === null || e.touches.length !== 1) return;
      var dx = e.touches[0].clientX - x0;
      var dy = e.touches[0].clientY - y0;
      if (decided === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        decided = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
      }
    }, { passive: true });

    grid.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = (e.changedTouches[0] || {}).clientX - x0;
      if (decided === 'x' && Math.abs(dx) > 60) shiftView(dx < 0 ? 1 : -1);
      x0 = y0 = decided = null;
    }, { passive: true });
  })();

  // ── 3. Оформление: тема, плотность, пресеты ───────────────────────────────

  var PRESETS = {
    night: { theme: 'dark', density: 'cozy' },
    day: { theme: 'light', density: 'cozy' },
    focus: { theme: 'dark', density: 'compact' }
  };

  function applyTheme(theme) {
    app.theme = theme;
    store.set('theme', theme);
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    var name = { auto: C.settings.themeAuto, dark: C.settings.themeDark, light: C.settings.themeLight }[theme];
    $('btnTheme').title = C.head.theme + ': ' + name;
    $('btnTheme').setAttribute('aria-label', C.head.theme + ': ' + name);
  }

  function applyDensity(density) {
    app.density = density;
    store.set('density', density);
    document.documentElement.setAttribute('data-density', density);
    // Высота карточки изменилась — окно виртуализации нужно пересчитать.
    measureRow();
    rebuildFeed();
  }

  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    applyTheme(p.theme);
    applyDensity(p.density);
    store.set('preset', name);
    saveServerSettings({ theme: p.theme, density: p.density });
  }

  function presetName() {
    var keys = Object.keys(PRESETS);
    for (var i = 0; i < keys.length; i++) {
      var p = PRESETS[keys[i]];
      if (p.theme === app.theme && p.density === app.density) {
        return { night: C.settings.presetNight, day: C.settings.presetDay, focus: C.settings.presetFocus }[keys[i]];
      }
    }
    return { auto: C.settings.themeAuto, dark: C.settings.themeDark, light: C.settings.themeLight }[app.theme];
  }

  $('btnTheme').addEventListener('click', function () {
    var order = ['auto', 'dark', 'light'];
    applyTheme(order[(order.indexOf(app.theme) + 1) % order.length]);
    saveServerSettings({ theme: app.theme });
  });

  // ── 4. Лента с виртуализацией ─────────────────────────────────────────────

  var feed = $('feed');
  var feedScroll = $('feedScroll');
  var feedEmpty = $('feedEmpty');
  var feedTop = $('feedTop');
  var feedBottom = $('feedBottom');

  // Высота карточки зависит от плотности и режима показа, поэтому её не
  // зашиваем числом, а пересчитываем от текущего шага сетки.
  var ROW_H = 74;
  var OVERSCAN = 8;

  function measureRow() {
    var d = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--density')) || 1;
    ROW_H = Math.round((app.detailed ? 190 : 52) + 24 * d);
  }

  /**
   * Уточняет высоту карточки по факту. Оценка нужна виртуализации, а высота
   * зависит от плотности, режима показа и ширины окна — считать её формулой
   * значит промахиваться на каждой второй раскладке.
   */
  function calibrateRow() {
    var rows = feed.children;
    if (rows.length < 3) return false;
    var n = Math.min(rows.length, 12);
    var sum = 0;
    for (var i = 0; i < n; i++) sum += rows[i].getBoundingClientRect().height;
    var avg = Math.round(sum / n);
    if (avg > 20 && Math.abs(avg - ROW_H) > 6) { ROW_H = avg; return true; }
    return false;
  }

  var FILTERS = {
    all: function () { return true; },
    edit: function (e) { return e.kind === 'tool' && (e.action === 'edit' || e.action === 'write'); },
    read: function (e) { return e.kind === 'tool' && e.action === 'read'; },
    run: function (e) { return e.kind === 'tool' && e.action === 'run'; },
    search: function (e) { return e.kind === 'tool' && e.action === 'search'; },
    error: function (e) { return e.level === 'error' || e.level === 'warn'; },
    talk: function (e) { return e.kind === 'user' || e.kind === 'assistant'; },
    git: function (e) { return e.kind === 'git' || e.kind === 'file'; },
    agent: function (e) { return e.sidechain === true || e.action === 'agent'; }
  };

  var FILTER_ICON = {
    all: 'dot', edit: 'edit', read: 'read', run: 'run', search: 'search',
    error: 'error', talk: 'talk', git: 'git', agent: 'agent'
  };

  (function buildFilters() {
    var box = $('feedFilters');
    Object.keys(FILTERS).forEach(function (key) {
      var b = el('button', 'pill' + (key === 'all' ? ' is-active' : ''));
      b.dataset.filter = key;
      b.appendChild(icon(FILTER_ICON[key], 'i--sm'));
      b.appendChild(el('span', null, C.feed.filters[key]));
      box.appendChild(b);
    });
  })();

  function matches(ev) {
    var f = FILTERS[app.filter] || FILTERS.all;
    if (!f(ev)) return false;
    if (!app.query) return true;
    var hay = [ev.title, ev.hint, ev.file, ev.command, ev.text, ev.output]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(app.query) !== -1;
  }

  function evClass(ev) {
    var cls = ['ev'];
    if (ev.level === 'error') cls.push('ev--error');
    if (ev.kind === 'user') cls.push('ev--user');
    if (ev.kind === 'tool' && (ev.action === 'edit' || ev.action === 'write')) cls.push('ev--edit');
    if (ev.kind === 'session' && ev.action === 'idle') cls.push('ev--attention');
    if (ev.sidechain) cls.push('ev--agent');
    if (ev.risk) {
      cls.push('ev--risk');
      if (ev.risk.level !== 'danger') cls.push('ev--warn');
    }
    return cls.join(' ');
  }

  function renderEvent(ev, isNew) {
    var li = el('li', evClass(ev) + (isNew && !reduceMotion ? ' is-new' : ''));
    li.dataset.id = ev.id;
    var mark = el('span', 'ev__mark');
    mark.appendChild(icon(ICON.forGlyph(ev.icon), 'i--sm'));
    li.appendChild(mark);
    li.appendChild(el('span', 'ev__title', ev.risk ? ev.risk.title : (ev.title || '')));
    li.appendChild(el('span', 'ev__time', clock(ev.ts)));
    if (ev.risk) {
      var riskHint = el('span', 'ev__hint');
      riskHint.appendChild(withTerms(ev.risk.why));
      li.appendChild(riskHint);
      li.appendChild(rollbackBlock(ev.risk));
    } else if (ev.hint) {
      var hint = el('span', 'ev__hint');
      hint.appendChild(withTerms(ev.hint));
      li.appendChild(hint);
    }
    if (app.detailed) li.appendChild(el('pre', 'ev__raw', rawText(ev)));
    li.addEventListener('click', function () { openEventDetails(ev); });
    return li;
  }

  /**
   * Блок «как откатить». Команда не набирается руками — она копируется.
   * Кнопка сохраняет своё имя до конца сценария: «Скопировать» → «Скопировано».
   */
  function rollbackBlock(info) {
    var box = el('div', 'rollback');
    box.appendChild(el('div', 'rollback__label', C.risk.how));
    if (!info.rollback) {
      box.appendChild(el('div', 'rollback__cmd', '— ' + C.risk.none));
    } else {
      box.appendChild(el('code', 'rollback__cmd', info.rollback));
      var copy = el('button', 'btn btn--sm', C.risk.copy);
      copy.addEventListener('click', function (e) {
        e.stopPropagation();
        var done = function () { copy.textContent = C.risk.copied; copy.classList.add('is-on'); };
        if (navigator.clipboard) navigator.clipboard.writeText(info.rollback).then(done, done);
        else done();
      });
      box.appendChild(copy);
    }
    if (info.rollbackNote) box.appendChild(el('div', 'rollback__note', info.rollbackNote));
    return box;
  }

  function rawText(ev) {
    var out = {
      kind: ev.kind, action: ev.action, source: ev.source,
      tool: ev.tool || undefined, file: ev.file || undefined,
      command: ev.command || undefined, pattern: ev.pattern || undefined,
      ok: ev.ok, stats: ev.stats || undefined,
      sidechain: ev.sidechain || undefined,
      toolUseId: ev.toolUseId || undefined,
      ts: new Date(ev.ts).toISOString()
    };
    Object.keys(out).forEach(function (k) { if (out[k] === undefined) delete out[k]; });
    var text = JSON.stringify(out, null, 2);
    if (ev.args && Object.keys(ev.args).length) {
      text += '\n\n' + C.event.rawArgs + '\n' + JSON.stringify(ev.args, null, 2).slice(0, 2000);
    }
    if (ev.output) text += '\n\n' + C.event.rawOutput + '\n' + String(ev.output).slice(0, 2000);
    return text;
  }

  function recomputeVisible() {
    var source = app.archive ? app.archive.events : app.events;
    app.visible = source.filter(function (ev) {
      if (ev.kind === 'result' && ev.ok) return false;   // успех схлопнут в вызов
      return matches(ev);
    });
    renderFeedEmpty();
  }

  /**
   * Пустой экран называет причину и даёт следующий шаг. Раньше все три
   * причины (событий нет / фильтр не подошёл / поиск не нашёл) показывали
   * один и тот же текст, и в двух случаях из трёх он был неправдой.
   */
  function renderFeedEmpty() {
    var total = app.visible.length;
    feedEmpty.hidden = total > 0;
    if (total > 0) return;
    clear(feedEmpty);

    var block, act = null;
    if (app.query) {
      block = { icon: 'search', title: C.feed.emptySearch.title, text: C.feed.emptySearch.text(app.query) };
      act = { label: C.feed.emptySearch.act, run: function () {
        $('feedSearch').value = ''; app.query = ''; rebuildFeed();
      } };
    } else if (app.filter !== 'all') {
      block = { icon: 'filter', title: C.feed.emptyFilter.title,
        text: C.feed.emptyFilter.text(C.feed.filters[app.filter]) };
      act = { label: C.feed.emptyFilter.act, run: function () { setFilter('all'); } };
    } else {
      var levelB = app.state && app.state.level !== 'A';
      block = { icon: 'radar', title: C.feed.emptyQuiet.title,
        text: levelB ? C.feed.emptyQuiet.textB(app.state.project) : C.feed.emptyQuiet.textA };
      act = { label: C.feed.emptyQuiet.act, run: startTour };
    }

    var ic = el('div', 'empty__icon');
    ic.appendChild(icon(block.icon, 'i--xl'));
    feedEmpty.appendChild(ic);
    feedEmpty.appendChild(el('p', 'empty__title', block.title));
    feedEmpty.appendChild(el('p', 'empty__text', block.text));
    if (act) {
      var btn = el('button', 'btn', act.label);
      btn.addEventListener('click', act.run);
      feedEmpty.appendChild(btn);
    }
  }

  /**
   * Виртуализация: в разметке живут только видимые карточки плюс запас,
   * высоту прокрутки держат распорки. Без этого на телефоне лента из тысячи
   * событий отвечает с заметной задержкой.
   */
  function renderWindow() {
    var total = app.visible.length;
    var h = feedScroll.clientHeight || 600;
    var perScreen = Math.ceil(h / ROW_H) + OVERSCAN * 2;

    if (total <= perScreen) {
      feedTop.style.height = '0px';
      feedBottom.style.height = '0px';
      drawRows(0, total);
      return;
    }

    // Окно прижимается к границам списка: без этого после смены режима
    // показа старый scrollTop уводил окно за конец, и лента пустела.
    var maxFirst = Math.max(0, total - perScreen);
    var first = Math.floor(feedScroll.scrollTop / ROW_H) - OVERSCAN;
    first = Math.max(0, Math.min(first, maxFirst));
    var last = Math.min(total, first + perScreen);

    feedTop.style.height = (first * ROW_H) + 'px';
    feedBottom.style.height = Math.max(0, (total - last) * ROW_H) + 'px';
    drawRows(first, last);
  }

  var drawnKey = '';
  function drawRows(from, to) {
    var key = from + ':' + to + ':' + app.visible.length + ':' + (app.detailed ? 'd' : 's');
    if (key === drawnKey) return;
    drawnKey = key;
    clear(feed);
    for (var i = from; i < to; i++) {
      feed.appendChild(renderEvent(app.visible[i], false));
    }
  }

  var scrollTicking = false;
  feedScroll.addEventListener('scroll', function () {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(function () {
      scrollTicking = false;
      renderWindow();
    });
  }, { passive: true });

  function atBottom() {
    return feedScroll.scrollHeight - feedScroll.scrollTop - feedScroll.clientHeight < 120;
  }

  function scrollToBottom() {
    // Сначала пересчитываем распорки, потом прыгаем: иначе scrollHeight
    // ещё старый и прыжок промахнётся.
    renderWindow();
    feedScroll.scrollTop = feedScroll.scrollHeight;
    renderWindow();
  }

  function addEvent(ev) {
    app.events.push(ev);
    if (app.events.length > MAX_EVENTS) app.events.splice(0, app.events.length - MAX_EVENTS);
    if (ev.title) app.lastTitle = ev.title;
    refreshCheat();

    if (ev.kind === 'result' && ev.ok && ev.toolUseId) { annotateCall(ev); return; }

    if (app.paused) {
      app.queued.push(ev);
      $('pausedText').textContent = C.feed.paused(app.queued.length);
      return;
    }
    if (!matches(ev)) return;

    if (isNarrow() && app.view !== 'feed') { app.unseen.feed++; renderBadges(); }

    var stick = atBottom();
    recomputeVisible();
    drawnKey = '';
    renderWindow();
    if (stick) scrollToBottom();
  }

  function annotateCall(result) {
    var call = null;
    for (var i = app.events.length - 1; i >= 0; i--) {
      if (app.events[i].toolUseId === result.toolUseId && app.events[i].kind === 'tool') {
        call = app.events[i];
        break;
      }
    }
    if (!call) return;
    call.result = result;
    if (result.stats && !call.stats) call.stats = result.stats;
    var node = feed.querySelector('[data-id="' + call.id + '"]');
    if (!node) return;
    var badge = node.querySelector('.ev__time');
    if (badge && result.stats) {
      badge.textContent = clock(call.ts) + '  +' + result.stats.added + ' −' + result.stats.removed;
    }
  }

  function rebuildFeed() {
    recomputeVisible();
    drawnKey = '';
    renderWindow();
    if (calibrateRow()) { drawnKey = ''; renderWindow(); }
    scrollToBottom();
  }

  function setFilter(key) {
    app.filter = key;
    Array.prototype.forEach.call($('feedFilters').children, function (c) {
      c.classList.toggle('is-active', c.dataset.filter === key);
    });
    rebuildFeed();
  }

  // ── 5. Детали события ─────────────────────────────────────────────────────

  function section(parent, title) {
    var s = el('div', 'sec');
    s.appendChild(el('h4', 'sec__title', title));
    parent.appendChild(s);
    return s;
  }

  function facts(parent, pairs) {
    var dl = el('dl', 'facts');
    pairs.forEach(function (p) {
      if (p[1] === undefined || p[1] === null || p[1] === '') return;
      dl.appendChild(el('dt', null, p[0]));
      dl.appendChild(el('dd', null, String(p[1])));
    });
    if (dl.childElementCount) parent.appendChild(dl);
  }

  function openEventDetails(ev) {
    var body = openSheet(ev.title || C.event.fallbackTitle, ICON.forGlyph(ev.icon));
    if (ev.hint) body.appendChild(el('p', null, ev.hint));

    // Стоп-сигнал — первым делом: за подробностями человек пришёл именно
    // тогда, когда испугался.
    if (ev.risk) {
      var riskSec = section(body, C.risk.badge + ' · ' + ev.risk.title);
      riskSec.appendChild(el('p', null, ev.risk.why));
      riskSec.appendChild(rollbackBlock(ev.risk));
    }

    facts(body, [
      [C.event.when, dateTime(ev.ts)],
      [C.event.source, C.event.sources[ev.source] || ev.source || ''],
      [C.event.who, ev.sidechain ? C.event.agent : ''],
      [C.event.tool, ev.tool || ''],
      [C.event.file, ev.file || ''],
      [C.event.command, ev.command || ''],
      [C.event.pattern, ev.pattern || '']
    ]);

    var res = ev.result || (ev.kind === 'result' ? ev : null);
    if (res) {
      if (res.stdout && res.stdout.trim()) {
        section(body, C.event.stdout).appendChild(
          Object.assign(el('pre', 'out'), { textContent: res.stdout.slice(0, 20000) }));
      }
      if (res.stderr && res.stderr.trim()) {
        section(body, C.event.stderr).appendChild(
          Object.assign(el('pre', 'out out--error'), { textContent: res.stderr.slice(0, 20000) }));
      }
      if (!res.stdout && !res.stderr && res.output) {
        section(body, C.event.result).appendChild(
          Object.assign(el('pre', 'out'), { textContent: String(res.output).slice(0, 20000) }));
      }
    }

    if (ev.text) {
      section(body, ev.kind === 'user' ? C.event.yourWords : C.event.claudeWords).appendChild(
        Object.assign(el('pre', 'out'), { textContent: ev.text.slice(0, 20000) }));
    }

    if (ev.file && (ev.action === 'edit' || ev.action === 'write' || ev.kind === 'file')) {
      var sec = section(body, C.event.changes);
      var loading = el('p', 'dim', C.event.changesLoading);
      sec.appendChild(loading);
      api('/api/git/diff', null, { path: ev.file }).then(function (d) {
        sec.removeChild(loading);
        if (d.error) return sec.appendChild(el('p', 'dim', d.error));
        if (d.note) sec.appendChild(el('p', 'dim', d.note));
        renderDiff(sec, d.diff);
      }).catch(function () { loading.textContent = C.event.changesFailed; });
    }

    if (app.state && app.state.askEnabled && app.state.askAvailable) addAskButton(body, ev);

    var rawSec = section(body, C.event.raw);
    rawSec.appendChild(Object.assign(el('pre', 'out'), { textContent: rawText(ev) }));
  }

  function addAskButton(body, ev) {
    var sec = section(body, C.event.ask.title);
    var btn = el('button', 'btn', C.event.ask.act);
    var answer = el('div');
    sec.appendChild(btn);
    sec.appendChild(answer);
    sec.appendChild(el('p', 'dim', C.event.ask.note));

    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = C.event.ask.acting;
      api('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: C.event.ask.prompt(ev) })
      }).then(function (r) {
        btn.textContent = C.event.ask.done;
        clear(answer);
        answer.appendChild(Object.assign(el('pre', 'out'), {
          textContent: r.ok ? r.answer : (r.error || C.event.ask.empty)
        }));
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = C.event.ask.act;
        answer.textContent = C.connect.failed(e.message);
      });
    });
  }

  function renderDiff(parent, files) {
    if (!files || !files.length) {
      parent.appendChild(el('p', 'dim', C.diff.none));
      return;
    }
    files.forEach(function (f) {
      var box = el('div', 'diff');
      var legend = el('div', 'diff__legend');
      legend.appendChild(el('span', null, f.path || ''));
      var addSpan = el('span');
      addSpan.appendChild(el('b', null, '+' + (f.added || 0)));
      addSpan.appendChild(document.createTextNode(' ' + C.diff.added));
      var delSpan = el('span');
      delSpan.appendChild(el('b', null, '−' + (f.removed || 0)));
      delSpan.appendChild(document.createTextNode(' ' + C.diff.removed));
      legend.appendChild(addSpan);
      legend.appendChild(delSpan);
      if (f.reconstructed) legend.appendChild(el('span', null, C.diff.guessed));
      box.appendChild(legend);

      if (f.binary) box.appendChild(el('div', 'diff__hunk', C.diff.binary));

      (f.hunks || []).forEach(function (h) {
        box.appendChild(el('div', 'diff__hunk', C.diff.hunk(h.newStart, h.context)));
        h.lines.forEach(function (l) {
          var line = el('div', 'diff__line diff__line--' + l.type);
          line.appendChild(el('span', 'diff__sign',
            l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '));
          line.appendChild(el('span', 'diff__text', l.text));
          box.appendChild(line);
        });
      });
      parent.appendChild(box);
    });
  }

  // ── 6. Карта проекта ──────────────────────────────────────────────────────

  var treeBox = $('tree');

  function emptyBlock(parent, iconName, title, text, actLabel, actRun) {
    var box = el('div', 'empty');
    var ic = el('div', 'empty__icon');
    ic.appendChild(icon(iconName, 'i--xl'));
    box.appendChild(ic);
    box.appendChild(el('p', 'empty__title', title));
    if (text) box.appendChild(el('p', 'empty__text', text));
    if (actLabel) {
      var btn = el('button', 'btn', actLabel);
      btn.addEventListener('click', actRun);
      box.appendChild(btn);
    }
    parent.appendChild(box);
    return box;
  }

  function loadTree() {
    return api('/api/tree').then(function (t) {
      app.treeFailed = false;
      app.treeNodes = t.nodes || [];
      if (t.truncated) notice(C.map.big(app.treeNodes.length));
      renderTree();
    }).catch(function () {
      app.treeFailed = true;
      renderTree();
    });
  }

  function renderTree() {
    clear(treeBox);
    var q = app.treeQuery;
    var nodes = app.treeNodes;

    if (app.treeFailed) {
      emptyBlock(treeBox, 'folder', C.map.unreadable.title, C.map.unreadable.text,
        C.map.unreadable.act, loadTree);
      return;
    }

    if (q) {
      var found = nodes.filter(function (n) {
        return n.type === 'file' && n.path.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 200);
      if (!found.length) {
        emptyBlock(treeBox, 'search', C.map.emptySearch.title, C.map.emptySearch.text(q),
          C.map.emptySearch.act, function () {
            $('treeSearch').value = ''; app.treeQuery = ''; renderTree();
          });
        return;
      }
      found.forEach(function (n) { treeBox.appendChild(nodeRow(n, true)); });
      return;
    }

    if (!nodes.length) {
      emptyBlock(treeBox, 'folder', C.map.emptyDir.title, C.map.emptyDir.text);
      return;
    }
    nodes.forEach(function (n) {
      if (isHidden(n)) return;
      treeBox.appendChild(nodeRow(n, false));
    });
    applyHeat();
  }

  function isHidden(n) {
    if (!n.dir) return false;
    var parts = n.dir.split('/');
    var acc = '';
    for (var i = 0; i < parts.length; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i];
      if (app.collapsed[acc]) return true;
    }
    return false;
  }

  function nodeRow(n, flat) {
    var row = el('div', 'node' + (n.type === 'dir' ? ' node--dir' : ''));
    row.dataset.path = n.path;
    if (!flat) row.style.paddingLeft = (8 + n.depth * 13) + 'px';
    if (n.type === 'dir') {
      var caret = el('span', 'node__caret');
      caret.appendChild(icon('down', 'i--sm'));
      row.appendChild(caret);
      if (app.collapsed[n.path]) row.classList.add('is-collapsed');
    }
    var ic = el('span', 'node__icon');
    ic.appendChild(icon(n.type === 'dir' ? 'folder' : ICON.forGlyph(n.icon), 'i--sm'));
    row.appendChild(ic);
    row.appendChild(el('span', 'node__name', flat ? n.path : n.name));
    if (n.type === 'file') row.appendChild(el('span', 'node__meta', bytes(n.size)));
    row.appendChild(el('span', 'node__heat'));

    row.addEventListener('click', function (e) {
      e.stopPropagation();
      if (n.type === 'dir' && !flat) {
        app.collapsed[n.path] = !app.collapsed[n.path];
        renderTree();
        return;
      }
      openFileCard(n.path);
    });
    return row;
  }

  function applyHeat() {
    var now = Date.now();
    Array.prototype.forEach.call(treeBox.querySelectorAll('.node'), function (row) {
      var t = app.heat[row.dataset.path];
      if (!t) {
        row.style.removeProperty('--heat');
        row.classList.remove('is-hot');
        return;
      }
      var age = now - t;
      if (age > HEAT_MS) {
        delete app.heat[row.dataset.path];
        row.style.removeProperty('--heat');
        row.classList.remove('is-hot');
        return;
      }
      var v = 1 - age / HEAT_MS;
      row.style.setProperty('--heat', v.toFixed(3));
      row.classList.toggle('is-hot', v > 0.45);
    });
  }
  setInterval(applyHeat, 1000);

  function touchFile(pathStr) {
    if (!pathStr) return;
    app.heat[pathStr] = Date.now();
    if (!app.treeNodes.some(function (n) { return n.path === pathStr; })) scheduleTreeReload();
    applyHeat();
  }

  var treeReloadTimer = null;
  function scheduleTreeReload() {
    if (treeReloadTimer) return;
    treeReloadTimer = setTimeout(function () { treeReloadTimer = null; loadTree(); }, 1500);
  }

  function openFileCard(pathStr) {
    app.selectedFile = pathStr;
    Array.prototype.forEach.call(treeBox.querySelectorAll('.node'), function (n) {
      n.classList.toggle('is-selected', n.dataset.path === pathStr);
    });

    var body = openSheet(pathStr, 'file');
    body.appendChild(el('p', 'dim', C.file.loading));

    api('/api/file', null, { path: pathStr }).then(function (card) {
      clear(body);
      if (card.error && !card.title) { body.appendChild(el('p', 'dim', card.error)); return; }
      setSheetTitle(card.name, ICON.forGlyph(card.icon));
      body.appendChild(el('p', 'dim', card.title));
      body.appendChild(el('p', null, card.text));
      facts(body, [
        [C.file.path, card.path],
        [C.file.size, card.sizeText || '—'],
        [C.file.changed, card.mtime ? dateTime(card.mtime) : '—'],
        [C.file.status, card.exists === false ? C.file.gone : C.file.here]
      ]);
      if (card.rollback) {
        var back = section(body, C.file.rollback);
        back.appendChild(rollbackBlock(card.rollback));
      }
      var sec = section(body, C.file.recent);
      if (card.diffNote) sec.appendChild(el('p', 'dim', card.diffNote));
      renderDiff(sec, card.diff);
    }).catch(function (e) {
      clear(body);
      body.appendChild(el('p', 'dim', C.file.failed(e.message)));
    });
  }

  // ── 7. Git ────────────────────────────────────────────────────────────────

  function renderGit(g) {
    var prevDirty = app.git && app.git.summary ? app.git.summary.total : null;
    app.git = g;
    var now = $('gitNow');
    var hist = $('gitHistory');
    clear(now);
    clear(hist);

    if (!g || !g.available) {
      emptyBlock(now, 'git', C.git.off.title,
        ((g && g.reason) ? g.reason + ' ' : '') + C.git.off.text);
      emptyBlock(hist, 'clock', C.git.noCommits.title, C.git.noCommits.text);
      return;
    }

    var line = el('div', 'gitline');
    line.appendChild(el('span', 'dim', C.git.branch));
    var b = el('code', 'git__branch', g.branch);
    line.appendChild(b);
    line.appendChild(termButton('branch'));
    now.appendChild(line);
    now.appendChild(el('p', 'git__explain', g.branchExplain || ''));

    if (g.aheadBehind) {
      now.appendChild(el('p', 'dim', C.git.ahead(
        g.aheadBehind.upstream,
        withPlural(g.aheadBehind.ahead, C.words.commit),
        withPlural(g.aheadBehind.behind, C.words.commit))));
    }

    if (g.summary.total === 0) {
      emptyBlock(now, 'ok', C.git.clean.title, C.git.clean.text, C.git.clean.act, function () {
        setGitTab('history');
      });
    } else {
      var count = el('div', 'git__count');
      count.appendChild(el('div', 'git__count-num', g.summary.total));
      var ct = el('div', 'git__count-text', g.summary.explain);
      ct.appendChild(termButton('commit'));
      count.appendChild(ct);
      now.appendChild(count);

      if (g.diffStat && g.diffStat.totals.files) {
        now.appendChild(el('p', 'dim', C.git.diffTotals(
          g.diffStat.totals.added, g.diffStat.totals.removed,
          withPlural(g.diffStat.totals.files, C.words.inFile))));
      }

      if (g.entries.length) {
        var ul = el('ul', 'gitfiles');
        g.entries.slice(0, 60).forEach(function (entry) {
          var li = el('li', 'gitfile');
          li.title = entry.explain;
          var cls = 'badge';
          if (entry.untracked) cls += ' badge--ok';
          else if (entry.index === 'D' || entry.work === 'D') cls += ' badge--bad';
          else if (entry.conflicted) cls += ' badge--act';
          li.appendChild(el('span', cls, entry.label));
          li.appendChild(el('span', 'gitfile__path', entry.path));
          li.addEventListener('click', function () { openFileCard(entry.path); });
          ul.appendChild(li);
        });
        now.appendChild(ul);
      }
    }

    if (!g.commits.length) {
      emptyBlock(hist, 'clock', C.git.noCommits.title, C.git.noCommits.text);
    } else {
      var tl = el('ol', 'timeline');
      g.commits.forEach(function (c) {
        var li = el('li', 'tl' + (c.merge ? ' tl--merge' : ''));
        li.appendChild(el('div', 'tl__subject', c.subject));
        li.appendChild(el('div', 'tl__meta', c.short + ' · ' + c.author + ' · ' + dateTime(c.ts)));
        li.appendChild(el('div', 'tl__explain', c.explain || ''));
        li.addEventListener('click', function () { openCommit(c); });
        tl.appendChild(li);
      });
      hist.appendChild(tl);
    }

    if (isNarrow() && app.view !== 'git' && prevDirty !== null && g.summary.total > prevDirty) {
      app.unseen.git += g.summary.total - prevDirty;
      renderBadges();
    }
  }

  function setGitTab(tab) {
    app.gitTab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('[data-gittab]'), function (b) {
      b.classList.toggle('is-active', b.dataset.gittab === tab);
    });
    $('gitNow').hidden = tab !== 'now';
    $('gitHistory').hidden = tab !== 'history';
  }

  function openCommit(c) {
    var body = openSheet(c.subject, 'commit');
    facts(body, [
      [C.git.commit.id, c.short],
      [C.git.commit.author, c.author],
      [C.git.commit.when, dateTime(c.ts)],
      [C.git.commit.kind, c.merge ? C.git.commit.merge : C.git.commit.plain]
    ]);
    body.appendChild(el('p', null, c.explain || ''));
    var sec = section(body, C.git.commit.contents);
    var loading = el('p', 'dim', C.common.loading);
    sec.appendChild(loading);
    api('/api/git/commit', null, { sha: c.hash }).then(function (d) {
      sec.removeChild(loading);
      if (d.error) return sec.appendChild(el('p', 'dim', d.error));
      renderDiff(sec, d.diff);
    });
  }

  // ── 8. Словарь и подсказки ────────────────────────────────────────────────

  var glossary = { terms: [], byId: {} };

  function loadGlossary() {
    return api('/api/glossary').then(function (g) {
      glossary.terms = g.terms || [];
      glossary.byId = {};
      glossary.terms.forEach(function (t) {
        glossary.byId[t.id] = t;
        (t.aliases || []).forEach(function (a) { glossary.byId[String(a).toLowerCase()] = t; });
      });
      buildTermMatcher();
      drawnKey = '';
      renderWindow();
      renderCheat();
    }).catch(function () { /* словарь не критичен для показа ленты */ });
  }

  /**
   * Подсветка терминов прямо в ленте.
   *
   * Незнакомое слово должно объясняться там, где человек его встретил, —
   * иначе он уходит в словарь и теряет место в ленте. Подсвечиваем не
   * больше двух слов на карточку: если подчеркнуть всё, читать станет
   * нечего.
   */
  var termRe = null;
  var termById = {};

  function buildTermMatcher() {
    var words = [];
    termById = {};
    glossary.terms.forEach(function (t) {
      [t.term].concat(t.aliases || []).forEach(function (w) {
        var word = String(w).toLowerCase().replace(/\s*\(.*$/, '').trim();
        if (word.length < 4) return;                  // «git» и «api» слишком часты
        if (termById[word]) return;
        termById[word] = t.id;
        words.push(word);
      });
    });
    if (!words.length) { termRe = null; return; }
    words.sort(function (a, b) { return b.length - a.length; });
    var escaped = words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    // Границу слова считаем сами: \b в JS не знает про кириллицу.
    var edge = C.wordEdge;
    try {
      termRe = new RegExp('(?<!' + edge + ')(' + escaped.join('|') + ')(?!' + edge + ')', 'gi');
    } catch (e) {
      termRe = null;                                   // старый браузер без lookbehind
    }
  }

  /** Текст с подсвеченными терминами. Возвращает узел для вставки. */
  function withTerms(text, limit) {
    var frag = document.createDocumentFragment();
    if (!text) return frag;
    if (!termRe) { frag.appendChild(document.createTextNode(text)); return frag; }
    var max = limit || 2;
    var used = 0;
    var last = 0;
    termRe.lastIndex = 0;
    var m;
    while (used < max && (m = termRe.exec(text)) !== null) {
      var id = termById[m[0].toLowerCase()];
      if (!id) continue;
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      var mark = el('button', 'termword', m[0]);
      mark.dataset.termword = id;
      mark.setAttribute('aria-label', C.glossary.what + ': ' + m[0]);
      frag.appendChild(mark);
      last = m.index + m[0].length;
      used++;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  /**
   * Шпаргалка в шапке: три слова из того, что происходит прямо сейчас.
   *
   * Словарь на 62 термина новичку не помогает — он его не открывает. А три
   * слова, которые только что промелькнули в ленте, читаются мельком и
   * объясняются одним нажатием. Список пересобирается по свежим событиям,
   * поэтому шпаргалка всегда про текущую работу, а не про абстрактный git.
   */
  var CHEAT_COUNT = 3;
  var cheatShown = '';
  var cheatTimer = null;

  /** Пересобрать шпаргалку, но не чаще раза в три секунды. */
  function refreshCheat() {
    if (cheatTimer) return;
    cheatTimer = setTimeout(function () {
      cheatTimer = null;
      try { renderCheat(); } catch (e) { /* шпаргалка не должна ронять ленту */ }
    }, 3000);
  }

  function renderCheat() {
    var box = $('cheat');
    if (!termRe || !app.events.length) { box.hidden = true; return; }

    var picked = [];
    var seen = {};
    // Свежие события первыми: шпаргалка про то, что происходит сейчас.
    for (var i = app.events.length - 1; i >= 0 && picked.length < CHEAT_COUNT; i--) {
      var text = (app.events[i].title || '') + ' ' + (app.events[i].hint || '');
      termRe.lastIndex = 0;
      var m;
      while (picked.length < CHEAT_COUNT && (m = termRe.exec(text)) !== null) {
        var id = termById[m[0].toLowerCase()];
        if (!id || seen[id] || !glossary.byId[id]) continue;
        seen[id] = true;
        picked.push(id);
      }
    }
    if (picked.length < CHEAT_COUNT) {
      // Событий пока мало — дополняем основами, чтобы полоса не прыгала.
      C.cheat.basics.forEach(function (id) {
        if (picked.length < CHEAT_COUNT && !seen[id] && glossary.byId[id]) {
          seen[id] = true;
          picked.push(id);
        }
      });
    }
    if (!picked.length) { box.hidden = true; return; }

    var key = picked.join(',');
    if (key === cheatShown) { box.hidden = false; return; }
    cheatShown = key;

    var words = $('cheatWords');
    clear(words);
    picked.forEach(function (id) {
      var term = glossary.byId[id];
      var b = el('button', 'cheat__word', term.term);
      b.setAttribute('aria-label', C.glossary.what + ': ' + term.term);
      b.addEventListener('click', function () { openTermSheet(id); });
      words.appendChild(b);
    });
    box.hidden = false;
  }

  /** Объяснение одного слова: шторкой, чтобы не терять место в ленте. */
  function openTermSheet(id) {
    var term = glossary.byId[id];
    if (!term) return;
    var body = openSheet(term.term, 'book');
    body.appendChild(el('p', null, term.text));
    var all = el('button', 'btn', C.glossary.all);
    all.addEventListener('click', openGlossary);
    body.appendChild(all);
  }

  document.addEventListener('click', function (e) {
    var w = e.target.closest && e.target.closest('.termword');
    if (!w) return;
    e.preventDefault();
    e.stopPropagation();
    openTermSheet(w.dataset.termword);
  });

  function termButton(id) {
    var b = el('button', 'term', '?');
    b.dataset.term = id;
    b.setAttribute('aria-label', C.glossary.what);
    return b;
  }

  var tip = $('tip');

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.term');
    if (!t) { tip.hidden = true; return; }
    e.preventDefault();
    e.stopPropagation();
    showTip(t);
  });

  function showTip(button) {
    var term = glossary.byId[button.dataset.term];
    if (!term) { tip.hidden = true; return; }
    $('tipTerm').textContent = term.term;
    $('tipText').textContent = term.text;
    tip.hidden = false;
    var r = button.getBoundingClientRect();
    var w = tip.offsetWidth;
    var h = tip.offsetHeight;
    var left = Math.min(Math.max(8, r.left - w / 2 + r.width / 2), window.innerWidth - w - 8);
    var top = r.bottom + 8 + h > window.innerHeight ? r.top - h - 8 : r.bottom + 8;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  document.addEventListener('scroll', function () { tip.hidden = true; }, true);

  function openGlossary() {
    var body = openSheet(C.glossary.title, 'book');
    var wrap = el('label', 'field');
    wrap.appendChild(icon('search', 'i--sm'));
    var search = el('input', 'field__input');
    search.type = 'search';
    search.placeholder = C.glossary.search;
    search.setAttribute('aria-label', C.glossary.search);
    search.setAttribute('enterkeyhint', 'search');
    wrap.appendChild(search);
    body.appendChild(wrap);

    var count = el('p', 'dim', C.glossary.count(glossary.terms.length));
    body.appendChild(count);
    var list = el('div');
    body.appendChild(list);

    function draw(q) {
      clear(list);
      var query = (q || '').toLowerCase();
      var items = glossary.terms.filter(function (t) {
        if (!query) return true;
        return (t.term + ' ' + t.text + ' ' + (t.aliases || []).join(' '))
          .toLowerCase().indexOf(query) !== -1;
      });
      if (!items.length) {
        emptyBlock(list, 'book', C.glossary.empty.title, C.glossary.empty.text(q),
          C.glossary.empty.act, function () { search.value = ''; draw(''); });
        return;
      }
      items.forEach(function (t) {
        var item = el('div', 'gl__item');
        item.appendChild(el('div', 'gl__term', t.term));
        item.appendChild(el('div', 'gl__text', t.text));
        list.appendChild(item);
      });
    }
    search.addEventListener('input', function () { draw(search.value); });
    draw('');
    if (!isNarrow()) search.focus();
  }

  // ── 9. Шторка ─────────────────────────────────────────────────────────────

  var sheet = $('sheet');
  var sheetBody = $('sheetBody');
  var returnFocusTo = null;

  function openSheet(title, iconName) {
    setSheetTitle(title, iconName);
    clear(sheetBody);
    // Запоминаем, откуда пришли: при закрытии вернём фокус туда же.
    if (sheet.hidden) returnFocusTo = document.activeElement;
    sheet.hidden = false;
    sheetBody.scrollTop = 0;
    setTimeout(function () { $('sheetClose').focus(); }, 0);
    return sheetBody;
  }

  function setSheetTitle(t, iconName) {
    var head = $('sheetTitle');
    clear(head);
    if (iconName) head.appendChild(icon(iconName));
    head.appendChild(document.createTextNode(' ' + t));
  }

  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    app.selectedFile = null;
    Array.prototype.forEach.call(document.querySelectorAll('.node.is-selected'), function (n) {
      n.classList.remove('is-selected');
    });
    if (returnFocusTo && returnFocusTo.focus) {
      try { returnFocusTo.focus(); } catch (e) { /* элемент исчез */ }
    }
    returnFocusTo = null;
  }

  // Пока шторка открыта, Tab не должен уводить за её пределы.
  var FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  sheet.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var items = Array.prototype.filter.call(
      $('sheetBox').querySelectorAll(FOCUSABLE),
      function (n) { return n.offsetParent !== null && !n.disabled; });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetBackdrop').addEventListener('click', closeSheet);

  // Смахивание шторки вниз — привычный жест на телефоне.
  (function sheetSwipe() {
    var box = $('sheetBox');
    var y0 = null;
    box.addEventListener('touchstart', function (e) {
      if (!isNarrow() || sheetBody.scrollTop > 0) return;
      y0 = e.touches[0].clientY;
    }, { passive: true });
    box.addEventListener('touchmove', function (e) {
      if (y0 === null) return;
      var dy = e.touches[0].clientY - y0;
      if (dy > 0) box.style.transform = 'translateY(' + Math.min(dy, 400) + 'px)';
    }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (y0 === null) return;
      var dy = (e.changedTouches[0] || {}).clientY - y0;
      box.style.transform = '';
      if (dy > 110) closeSheet();
      y0 = null;
    }, { passive: true });
  })();


  // ── 9а. Выбор проекта ─────────────────────────────────────────────────────

  /**
   * Экран выбора проекта. Путь к папке человек не печатает никогда: список
   * собирается сам из записей Claude Code, «другая папка» — системный диалог,
   * а если его в системе нет, панель показывает свой обзор папок.
   */
  function openPicker(closable) {
    var box = $('picker');
    box.hidden = false;
    $('pickerClose').hidden = !closable;
    var list = $('pickerList');
    clear(list);
    list.appendChild(el('p', 'dim', C.common.loading));

    api('/api/projects/all').then(function (d) {
      clear(list);
      app.openLast = d.openLast;
      $('pickerNote').textContent = d.projects.length ? C.picker.note : C.picker.noteEmpty;
      renderOpenLast(d.openLast);

      d.projects.forEach(function (p) {
        var card = el('button', 'pcard' +
          (p.path === d.active ? ' is-current' : '') + (p.exists ? '' : ' is-gone'));
        card.appendChild(el('span', 'pcard__name', p.name));
        if (p.path === d.active) {
          card.appendChild(el('span', 'badge badge--act pcard__badge', C.picker.current));
        } else if (!p.exists) {
          card.appendChild(el('span', 'badge badge--bad pcard__badge', C.picker.gone));
        } else {
          card.appendChild(el('span', 'pcard__badge'));
        }
        card.appendChild(el('span', 'pcard__path', p.path));
        var meta = [];
        if (p.lastSession) meta.push(C.picker.lastSession(duration(Date.now() - p.lastSession)));
        else meta.push(C.picker.never);
        if (p.exists) meta.push(C.picker.files(p.files, p.filesTruncated));
        meta.push(C.picker.sessions(p.sessions));
        card.appendChild(el('span', 'pcard__meta', meta.join(' · ')));
        if (p.exists) {
          card.addEventListener('click', function () { chooseProject(p.path, card); });
        } else {
          card.disabled = true;
        }
        list.appendChild(card);
      });
    }).catch(function (e) {
      clear(list);
      list.appendChild(el('p', 'dim', C.picker.failed(e.message)));
    });
  }

  function closePicker() {
    $('picker').hidden = true;
  }

  function renderOpenLast(on) {
    var btn = $('pickerLast');
    btn.textContent = C.picker.openLast + ': ' + (on ? C.settings.on : C.settings.off);
    btn.classList.toggle('is-on', !!on);
    btn.title = C.picker.openLastNote;
  }

  $('pickerLast').addEventListener('click', function () {
    app.openLast = !app.openLast;
    renderOpenLast(app.openLast);
    saveServerSettings({ openLast: app.openLast });
  });
  $('pickerClose').addEventListener('click', closePicker);

  /** Открыть проект: сервер добавит его на лету, панель переключится. */
  function chooseProject(pathStr, card) {
    if (card) { card.disabled = true; card.classList.add('is-busy'); }
    api('/api/projects/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathStr })
    }).then(function (r) {
      if (r.error) throw new Error(r.error);
      closePicker();
      closeSheet();
      if (r.key === app.projectKey) return;
      switchProject(r.key);
    }).catch(function (e) {
      if (card) { card.disabled = false; card.classList.remove('is-busy'); }
      notice(C.picker.failed(e.message));
    });
  }

  /** «Открыть другую папку»: сначала системный диалог, потом свой обзор. */
  function browseFolder() {
    var btn = $('pickerBrowse');
    btn.disabled = true;
    api('/api/projects/pick', { method: 'POST' }).then(function (r) {
      btn.disabled = false;
      if (r && r.path) return chooseProject(r.path);
      if (r && r.cancelled) return;
      openBrowseSheet();
    }).catch(function () {
      btn.disabled = false;
      openBrowseSheet();
    });
  }
  $('pickerBrowse').addEventListener('click', browseFolder);

  /** Свой обзор папок — работает везде, печатать ничего не нужно. */
  function openBrowseSheet(startPath) {
    // По умолчанию показываем соседей текущего проекта: там же, скорее
    // всего, лежат и остальные. Домашняя папка бывает пустой на вид.
    var start = startPath;
    if (!start && app.state && app.state.project) {
      start = app.state.project.replace(/[\\/][^\\/]+$/, '') || app.state.project;
    }
    var body = openSheet(C.browse.title, 'folder');
    body.appendChild(el('p', 'dim', C.browse.dialogFailed));
    var crumb = el('p', 'crumb');
    var actions = el('div', 'row');
    var list = el('div', 'dirlist');
    body.appendChild(crumb);
    body.appendChild(actions);
    body.appendChild(list);

    function draw(dir) {
      clear(list);
      clear(actions);
      list.appendChild(el('p', 'dim', C.common.loading));
      api('/api/projects/browse', null, { path: dir || '' }).then(function (d) {
        crumb.textContent = d.path;
        clear(actions);
        clear(list);

        if (d.parent) {
          var up = el('button', 'btn btn--quiet');
          up.appendChild(icon('down', 'i--sm'));
          up.appendChild(el('span', null, C.browse.up));
          up.style.transform = 'none';
          up.addEventListener('click', function () { draw(d.parent); });
          actions.appendChild(up);
        }
        var here = el('button', 'btn btn--primary', C.browse.here);
        here.addEventListener('click', function () { chooseProject(d.path); });
        actions.appendChild(here);

        if (!d.dirs.length) {
          emptyBlock(list, 'folder', C.browse.empty.title, C.browse.empty.text);
          return;
        }
        d.dirs.forEach(function (entry) {
          var row = el('button', 'dirrow');
          row.appendChild(icon('folder', 'i--sm'));
          row.appendChild(el('span', 'dirrow__name', entry.name));
          if (entry.project) row.appendChild(el('span', 'badge badge--ok', C.browse.marker));
          row.appendChild(icon('right', 'i--sm'));
          row.addEventListener('click', function () { draw(entry.path); });
          list.appendChild(row);
        });
      }).catch(function (e) {
        clear(list);
        list.appendChild(el('p', 'dim', C.picker.failed(e.message)));
      });
    }
    draw(start);
  }

  /** Выключение с подтверждением: второй клик по той же кнопке. */
  function quitButton() {
    var btn = el('button', 'btn row__control', C.settings.quitAct);
    var armed = false;
    var timer = null;
    btn.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        btn.textContent = C.settings.quitConfirm;
        btn.classList.add('is-on');
        timer = setTimeout(function () {
          armed = false;
          btn.textContent = C.settings.quitAct;
          btn.classList.remove('is-on');
        }, 5000);
        return;
      }
      clearTimeout(timer);
      btn.disabled = true;
      btn.textContent = C.settings.quitting;
      api('/api/shutdown', { method: 'POST' }).then(showBye).catch(showBye);
    });
    return btn;
  }

  function showBye() {
    disconnect();
    closeSheet();
    closePicker();
    $('bye').hidden = false;
  }

  // --- экран «Открыть на телефоне» -------------------------------------------

  function openConnect() {
    var body = openSheet(C.connect.title, 'phone');
    body.appendChild(el('p', 'dim', C.connect.looking));

    api('/api/connect').then(function (info) {
      clear(body);
      setSheetTitle(info.enabled ? C.connect.titleOn : C.connect.title, 'phone');
      var box = el('div', 'conn');
      body.appendChild(box);
      box.appendChild(el('p', 'conn__explain', info.explain));

      if (!info.enabled) {
        var off = el('div', 'card');
        off.appendChild(document.createTextNode(C.connect.enableNote));
        off.appendChild(el('code', 'conn__cmd', 'shturman --share'));
        box.appendChild(off);

        var on = el('button', 'btn btn--primary', C.connect.enable);
        on.style.marginTop = 'var(--s3)';
        on.addEventListener('click', function () {
          on.disabled = true;
          on.textContent = C.connect.enabling;
          api('/api/connect/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true })
          }).then(function (r) {
            if (r.error) {
              on.disabled = false;
              on.textContent = C.connect.enable;
              box.appendChild(el('p', 'dim', r.error));
              return;
            }
            openConnect();
          }).catch(function (e) {
            on.disabled = false;
            on.textContent = C.connect.enable;
            box.appendChild(el('p', 'dim', C.connect.failed(e.message)));
          });
        });
        box.appendChild(on);
        return;
      }

      if (!info.hasNetwork) {
        emptyBlock(box, 'phone', C.connect.noNetwork.title, C.connect.noNetwork.text,
          C.connect.noNetwork.act, openConnect);
        return;
      }

      var img = el('img', 'conn__qr');
      img.src = href('/api/connect/qr.svg', { _: Date.now() });
      img.alt = C.connect.scan;
      box.appendChild(img);
      box.appendChild(el('p', 'dim', C.connect.scan));
      box.appendChild(el('div', 'conn__url', info.url));

      if (info.addresses.length > 1) {
        var sec = section(body, C.connect.others);
        info.addresses.slice(1).forEach(function (a) {
          var row = el('div', 'conn__addr');
          row.appendChild(el('span', 'conn__addr-ip', a.address));
          row.appendChild(el('span', 'conn__addr-label', a.label));
          sec.appendChild(row);
        });
      }

      var devSec = section(body, C.connect.devices);
      renderDevices(devSec, info.devices, info.rejected);

      var resetSec = section(body, C.connect.revoke);
      resetSec.appendChild(el('p', 'dim', C.connect.rotateNote));

      var reset = el('button', 'btn', C.connect.rotate);
      reset.addEventListener('click', function () {
        reset.disabled = true;
        reset.textContent = C.connect.rotating;
        api('/api/connect/rotate', { method: 'POST' }).then(openConnect);
      });
      resetSec.appendChild(reset);

      var offBtn = el('button', 'btn', C.connect.revoke);
      offBtn.style.marginLeft = 'var(--s2)';
      offBtn.addEventListener('click', function () {
        offBtn.disabled = true;
        offBtn.textContent = C.connect.disabling;
        api('/api/connect/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false })
        }).then(openConnect).catch(openConnect);
      });
      resetSec.appendChild(offBtn);
    }).catch(function (e) {
      clear(body);
      body.appendChild(el('p', 'dim', C.connect.failed(e.message)));
    });
  }

  function renderDevices(parent, devices, rejected) {
    if (!devices || !devices.length) {
      parent.appendChild(el('p', 'dim', C.connect.devicesEmpty));
    } else {
      devices.forEach(function (d) {
        var row = el('div', 'device');
        var what = el('div');
        what.appendChild(el('div', 'device__what',
          d.shortAgent + (d.loopback ? ' (' + C.connect.thisComputer + ')' : '')));
        what.appendChild(el('div', 'device__ip', d.ip));
        row.appendChild(what);
        row.appendChild(el('span', 'device__when',
          duration(Date.now() - d.lastSeen) + ' ' + C.units.ago));
        parent.appendChild(row);
      });
    }
    if (rejected) parent.appendChild(el('p', 'dim', C.connect.rejected(rejected)));
  }

  // --- настройки --------------------------------------------------------------

  function segRow(title, note, options, current, onPick) {
    var row = el('div', 'row');
    var lbl = el('div', 'row__label');
    lbl.appendChild(el('b', null, title));
    if (note) lbl.appendChild(el('span', null, note));
    row.appendChild(lbl);
    var seg = el('div', 'seg row__control');
    options.forEach(function (o) {
      var b = el('button', 'seg__btn' + (o[0] === current ? ' is-active' : ''), o[1]);
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(seg.children, function (c) { c.classList.toggle('is-active', c === b); });
        onPick(o[0]);
      });
      seg.appendChild(b);
    });
    row.appendChild(seg);
    return row;
  }

  function toggleRow(title, note, value, onChange) {
    var row = el('div', 'row');
    var lbl = el('div', 'row__label');
    lbl.appendChild(el('b', null, title));
    lbl.appendChild(el('span', null, note));
    row.appendChild(lbl);
    var btn = el('button', 'btn row__control' + (value ? ' is-on' : ''),
      value ? C.settings.on : C.settings.off);
    btn.addEventListener('click', function () {
      value = !value;
      btn.textContent = value ? C.settings.on : C.settings.off;
      btn.classList.toggle('is-on', value);
      onChange(value);
    });
    row.appendChild(btn);
    return row;
  }

  function openSettings() {
    var body = openSheet(C.settings.title, 'settings');

    body.appendChild(toggleRow(C.settings.sound, C.settings.soundNote, app.sound, function (v) {
      app.sound = v; store.set('sound', v); saveServerSettings({ sound: v });
    }));

    body.appendChild(toggleRow(C.settings.notify, C.settings.notifyNote, app.notify, function (v) {
      app.notify = v;
      store.set('notify', v);
      saveServerSettings({ notify: v });
      if (v && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }));

    // Три готовых сочетания темы и плотности.
    var presetRow = el('div', 'row');
    var pl = el('div', 'row__label');
    pl.appendChild(el('b', null, C.settings.look));
    pl.appendChild(el('span', null, C.settings.lookNote));
    presetRow.appendChild(pl);
    var presetSeg = el('div', 'seg row__control');
    [['night', C.settings.presetNight], ['day', C.settings.presetDay], ['focus', C.settings.presetFocus]]
      .forEach(function (p) {
        var b = el('button', 'seg__btn', p[1]);
        b.title = C.settings.presetNote[p[0]];
        var cur = PRESETS[p[0]];
        if (cur.theme === app.theme && cur.density === app.density) b.classList.add('is-active');
        b.addEventListener('click', function () {
          applyPreset(p[0]);
          closeSheet();
          openSettings();
        });
        presetSeg.appendChild(b);
      });
    presetRow.appendChild(presetSeg);
    body.appendChild(presetRow);

    body.appendChild(segRow(C.settings.theme, null,
      [['auto', C.settings.themeAuto], ['dark', C.settings.themeDark], ['light', C.settings.themeLight]],
      app.theme, function (v) { applyTheme(v); saveServerSettings({ theme: v }); }));

    body.appendChild(segRow(C.settings.density, C.settings.densityNote,
      [['cozy', C.settings.densityCozy], ['compact', C.settings.densityCompact]],
      app.density, function (v) { applyDensity(v); saveServerSettings({ density: v }); }));

    body.appendChild(segRow(C.settings.feedMode, C.settings.feedNote,
      [['simple', C.settings.feedSimple], ['detailed', C.settings.feedDetailed]],
      app.detailed ? 'detailed' : 'simple', function (v) {
        setDetailed(v === 'detailed');
        saveServerSettings({ feedMode: v });
      }));

    // Порог тишины
    var idleRow = el('div', 'row');
    var lbl = el('div', 'row__label');
    lbl.appendChild(el('b', null, C.settings.idle));
    lbl.appendChild(el('span', null, C.settings.idleNote(app.state ? app.state.idleSeconds : 45)));
    idleRow.appendChild(lbl);
    var wrap = el('label', 'field row__control');
    var input = el('input', 'field__input');
    input.type = 'number';
    input.min = '5';
    input.max = '600';
    input.style.width = '72px';
    input.value = app.state ? app.state.idleSeconds : 45;
    input.setAttribute('aria-label', C.settings.idle);
    input.addEventListener('change', function () {
      api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idleSeconds: Number(input.value) })
      }).then(renderState);
    });
    wrap.appendChild(input);
    idleRow.appendChild(wrap);
    body.appendChild(idleRow);

    // Доступ по сети — переключателем прямо здесь, а не флагом в командной
    // строке. Включённый доступ сразу показывает QR-код.
    var shareRow = toggleRow(C.settings.share,
      app.state && app.state.share ? C.settings.shareOn : C.settings.shareOff,
      !!(app.state && app.state.share), function (v) {
        api('/api/connect/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: v })
        }).then(function (r) {
          if (r && r.error) { notice(r.error); return; }
          if (app.state) app.state.share = v;
          if (v) { closeSheet(); openConnect(); }
        }).catch(function (e) { notice(C.connect.failed(e.message)); });
      });
    var shareOpen = el('button', 'btn btn--quiet', C.settings.shareAct);
    shareOpen.addEventListener('click', openConnect);
    shareRow.insertBefore(shareOpen, shareRow.lastChild);
    body.appendChild(shareRow);

    var info = el('div', 'row');
    var il = el('div', 'row__label');
    il.appendChild(el('b', null, C.settings.ask));
    il.appendChild(el('span', null, app.state && app.state.askEnabled
      ? (app.state.askAvailable ? C.settings.askOn : C.settings.askNoBinary)
      : C.settings.askOff));
    info.appendChild(il);
    body.appendChild(info);

    var about = el('div', 'row');
    var al = el('div', 'row__label');
    al.appendChild(el('b', null, C.settings.about));
    al.appendChild(el('span', null, app.state ? C.settings.aboutLine(app.state) : ''));
    about.appendChild(al);
    body.appendChild(about);

    // Проект: сменить папку можно в любой момент.
    var projRow = el('div', 'row');
    var prl = el('div', 'row__label');
    prl.appendChild(el('b', null, C.settings.project));
    prl.appendChild(el('span', null, (app.state ? app.state.project + ' · ' : '') + C.settings.projectNote));
    projRow.appendChild(prl);
    var projBtn = el('button', 'btn row__control', C.settings.projectAct);
    projBtn.addEventListener('click', function () { closeSheet(); openPicker(true); });
    projRow.appendChild(projBtn);
    body.appendChild(projRow);

    body.appendChild(toggleRow(C.settings.openLast, C.settings.openLastNote,
      app.openLast !== false, function (v) {
        app.openLast = v;
        saveServerSettings({ openLast: v });
      }));

    // Встраивание в систему: автозапуск и пункт меню правой кнопки.
    var sysRows = el('div');
    body.appendChild(sysRows);
    api('/api/system').then(function (sys) {
      clear(sysRows);
      app.system = sys;
      sysRows.appendChild(toggleRow(C.settings.startup, C.settings.startupNote,
        !!sys.autostart, function (v) { saveSystem({ autostart: v }); }));
      sysRows.appendChild(toggleRow(C.settings.menu,
        sys.checkable ? C.settings.menuNote : C.settings.menuNote + ' ' + C.settings.menuUnavailable,
        !!sys.menu, function (v) { saveSystem({ menu: v }); }));
      sysRows.appendChild(toggleRow(C.settings.appWindow, C.settings.appWindowNote,
        !!sys.appWindow, function (v) { saveSystem({ appWindow: v }); }));
    }).catch(function () { /* без встраивания панель работает так же */ });

    var keys = el('div', 'row');
    var kl = el('div', 'row__label');
    kl.appendChild(el('b', null, C.settings.keys));
    kl.appendChild(el('span', null, C.settings.keysLine));
    keys.appendChild(kl);
    body.appendChild(keys);

    // Выключение — последним пунктом и с подтверждением: искать, как
    // остановить программу, человек не должен, но и промахнуться не должен.
    var quitRow = el('div', 'row');
    var ql = el('div', 'row__label');
    ql.appendChild(el('b', null, C.settings.quit));
    ql.appendChild(el('span', null, C.settings.quitNote));
    quitRow.appendChild(ql);
    quitRow.appendChild(quitButton());
    body.appendChild(quitRow);
  }

  function saveSystem(patch) {
    return api('/api/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    }).then(function (sys) {
      app.system = sys;
      if (sys && sys.error) notice(sys.error);
      return sys;
    }).catch(function (e) { notice(C.picker.failed(e.message)); });
  }

  // Настройки дублируются на сервер: так они переживают смену браузера и
  // одинаковы на телефоне и компьютере.
  function saveServerSettings(patch) {
    api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    }).catch(function () { /* не сохранилось — останется хотя бы локально */ });
  }

  // --- итоги сессии ------------------------------------------------------------

  /**
   * Кнопки дневника прямо во вкладке: на телефоне это одно нажатие, а не
   * поход в «⋯». Сам текст открывается шторкой — в панели ему тесно.
   */
  function renderDigestActions() {
    var box = $('digestActions');
    if (!box) return;
    clear(box);
    var open = el('button', 'btn btn--primary', C.digest.title);
    open.addEventListener('click', openDigest);
    box.appendChild(open);

    var dl = el('button', 'btn', C.digest.download);
    dl.addEventListener('click', function () {
      window.location.href = href('/api/digest', { download: 1 });
      dl.textContent = C.digest.downloaded;
    });
    box.appendChild(dl);

    if (navigator.share) {
      var sh = el('button', 'btn', C.digest.share);
      sh.addEventListener('click', function () {
        api('/api/digest').then(function (d) {
          navigator.share({ title: C.digest.shareTitle, text: d.markdown })
            .catch(function () { /* передумали — не беда */ });
        });
      });
      box.appendChild(sh);
    }
  }

  function openDigest() {
    var body = openSheet(C.digest.title, 'digest');
    body.appendChild(el('p', 'dim', C.digest.loading));
    api('/api/digest').then(function (d) {
      clear(body);
      var actions = el('div', 'row');
      var dl = el('button', 'btn btn--primary', C.digest.download);
      dl.addEventListener('click', function () {
        window.location.href = href('/api/digest', { download: 1 });
        dl.textContent = C.digest.downloaded;
      });
      actions.appendChild(dl);

      if (navigator.share) {
        var sh = el('button', 'btn', C.digest.share);
        sh.addEventListener('click', function () {
          navigator.share({ title: C.digest.shareTitle, text: d.markdown })
            .catch(function () { /* передумали — не беда */ });
        });
        actions.appendChild(sh);
      }
      if (navigator.clipboard) {
        var copy = el('button', 'btn', C.digest.copy);
        copy.addEventListener('click', function () {
          navigator.clipboard.writeText(d.markdown).then(function () {
            copy.textContent = C.digest.copied;
          });
        });
        actions.appendChild(copy);
      }
      body.appendChild(actions);
      body.appendChild(Object.assign(el('pre', 'out'), { textContent: d.markdown }));
    });
  }

  // ── 10. Пульс и граф внимания ─────────────────────────────────────────────

  function renderPulse(p) {
    app.pulse = p;
    $('pulseFiles').textContent = p.filesTouched;
    $('pulseCommands').textContent = p.commands;
    var errNode = $('pulseErrors');
    errNode.textContent = p.errors;
    errNode.classList.toggle('is-bad', p.errors > 0);
    $('pulseDuration').textContent = duration(p.durationMs);

    $('pulseTokens').textContent = (p.tokens && p.tokens.messages)
      ? C.pulse.tokensLine(fmtNum(p.tokens.input + p.tokens.cacheCreate),
        fmtNum(p.tokens.output), fmtNum(p.tokens.cacheRead))
      : C.pulse.tokensNone;

    renderRose(p.detector);
    renderAttention(p.recentFiles || []);
    renderAttentionGraph(p.attention);
  }

  function renderAttention(recent) {
    var box = $('attentionMap');
    clear(box);
    if (!recent.length) {
      emptyBlock(box, 'radar', C.pulse.attentionEmpty.title, C.pulse.attentionEmpty.text);
      return;
    }
    var now = Date.now();
    recent.forEach(function (r) {
      var age = Math.min(1, (now - r.ts) / 300000);
      var chip = el('button', 'pill att att--' + r.action);
      chip.style.setProperty('--fresh', (1 - age).toFixed(2));
      chip.appendChild(icon(r.action === 'edit' ? 'edit' : 'read', 'i--sm'));
      chip.appendChild(el('span', null, r.file.split('/').pop()));
      chip.title = r.file;
      chip.addEventListener('click', function () { openFileCard(r.file); });
      box.appendChild(chip);
    });
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function renderAttentionGraph(att) {
    var box = $('attentionGraph');
    if (box.hidden) return;
    clear(box);
    var W = box.clientWidth || 380;
    var H = 240;

    if (!att || att.empty || !att.nodes.length) {
      emptyBlock(box, 'radar', C.pulse.attentionEmpty.title, C.pulse.attentionEmpty.text);
      return;
    }

    var root = svg('svg', { class: 'attgraph', viewBox: '0 0 ' + W + ' ' + H });
    var cx = W / 2;
    var cy = H / 2;
    var rx = Math.max(70, W / 2 - 58);
    var ry = Math.max(48, H / 2 - 34);
    var pos = {};
    var labels = [];

    // Подписи на плотном кольце налезали друг на друга — это была
    // единственная строка в списке ограничений, где оформление проигрывало
    // данным. Кольцо стало двухрядным: соседние узлы уходят на разный
    // радиус, и подписи расходятся.
    att.nodes.forEach(function (n, i) {
      if (i === 0) { pos[n.file] = { x: cx, y: cy, r: 11 }; return; }
      var count = att.nodes.length - 1;
      var angle = ((i - 1) / count) * Math.PI * 2 - Math.PI / 2 + 0.35;
      var ring = (count > 6 && i % 2 === 0) ? 0.72 : 1;
      pos[n.file] = {
        x: cx + Math.cos(angle) * rx * ring,
        y: cy + Math.sin(angle) * ry * ring,
        r: 6 + Math.min(4, n.touches),
        ring: ring
      };
    });

    att.links.forEach(function (l) {
      var a = pos[l.from];
      var b = pos[l.to];
      if (!a || !b) return;
      root.appendChild(svg('line', {
        class: 'attgraph__link',
        x1: a.x.toFixed(1), y1: a.y.toFixed(1),
        x2: b.x.toFixed(1), y2: b.y.toFixed(1),
        'stroke-width': (1 + l.strength * 2).toFixed(1),
        'stroke-opacity': (0.25 + l.strength * 0.5).toFixed(2)
      }));
    });

    att.nodes.forEach(function (n, i) {
      var p = pos[n.file];
      var g = svg('g', {
        class: 'attgraph__node attgraph__node--' + n.kind + (i === 0 ? ' attgraph__node--focus' : ''),
        opacity: (0.35 + 0.65 * n.freshness).toFixed(2)
      });
      g.appendChild(svg('circle', { class: 'attgraph__dot', cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: p.r }));

      // Подпись рисуем, только если она не наезжает на уже нарисованную:
      // лучше показать восемь читаемых имён, чем четырнадцать слипшихся.
      var text = n.name.length > 16 ? n.name.slice(0, 15) + '…' : n.name;
      var half = text.length * 3.4;                 // оценка полуширины при 10px моно
      var ly = p.y + p.r + 12;
      var clash = labels.some(function (l) {
        return Math.abs(l.y - ly) < 13 && Math.abs(l.x - p.x) < half + l.half + 6;
      });
      if (!clash || i === 0) {
        labels.push({ x: p.x, y: ly, half: half });
        g.appendChild(Object.assign(
          svg('text', { class: 'attgraph__label', x: p.x.toFixed(1), y: ly.toFixed(1) }),
          { textContent: text }));
      }

      var title = svg('title');
      title.textContent = C.pulse.fileTip(n.file,
        withPlural(n.reads, C.words.read), withPlural(n.edits, C.words.edit), duration(n.ageMs));
      g.appendChild(title);
      g.addEventListener('click', function () { openFileCard(n.file); });
      root.appendChild(g);
    });

    box.appendChild(root);
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-atttab]'), function (btn) {
    btn.addEventListener('click', function () {
      var isGraph = btn.dataset.atttab === 'graph';
      Array.prototype.forEach.call(document.querySelectorAll('[data-atttab]'), function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      $('attentionGraph').hidden = !isGraph;
      $('attentionMap').hidden = isGraph;
      if (isGraph && app.pulse) renderAttentionGraph(app.pulse.attention);
    });
  });

  // ── 11. Картушка и сигнал ─────────────────────────────────────────────────

  /**
   * Фирменный элемент. Одно место вместо трёх: раньше состояние жило в
   * мелком чипе шапки, менялось в карточке в противоположном углу и
   * дублировалось цветом шапки. DESIGN.md, раздел 4.
   */
  function renderRose(d) {
    var rose = $('rose');
    // Поднятый сигнал сильнее показаний детектора: иначе следующий пульс
    // через секунду стёр бы «ждёт вас» обратно в «работает».
    var state = app.offline ? 'offline' : (app.alarmed ? 'waiting' : (d ? d.state : 'idle'));
    if (!d && !app.offline && !app.alarmed) state = 'idle';
    rose.dataset.state = state;
    document.body.classList.toggle('is-waiting', state === 'waiting');

    var word = C.rose[state] || C.rose.idle;
    var detail;
    if (state === 'working') detail = C.rose.workingHint(app.lastTitle);
    else if (state === 'waiting') {
      detail = app.alarmed && app.alarmText
        ? app.alarmText
        : C.rose.waitingHint(duration(d ? d.quietMs : 0));
    }
    else if (state === 'ended') detail = C.rose.endedHint;
    else if (state === 'offline') detail = C.rose.offlineHint;
    else detail = C.rose.idleHint;

    $('roseState').textContent = word;
    $('roseDetail').textContent = detail;
    $('roseAct').hidden = state !== 'waiting';
  }

  var audioCtx = null;

  function beep() {
    if (!app.sound) return;
    try {
      if (!audioCtx) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      [0, 0.18].forEach(function (delay, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = i === 0 ? 660 : 880;
        var t0 = audioCtx.currentTime + delay;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.18);
      });
    } catch (e) { /* звук — не критичная функция */ }
  }

  function browserNotify(title, text) {
    if (!app.notify || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      var n = new Notification(C.app.name + ': ' + title, {
        body: text, tag: 'shturman-attention',
        icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
        vibrate: [120, 60, 120]
      });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) {
      // На Android уведомления создаются только через service worker.
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          reg.showNotification(C.app.name + ': ' + title, {
            body: text, tag: 'shturman-attention',
            icon: '/icons/icon-192.png', vibrate: [120, 60, 120]
          }).catch(function () { /* и так бывает */ });
        });
      }
    }
  }

  function raiseAlarm(data) {
    app.alarmed = true;
    app.alarmText = data.text || C.alarm.title;
    renderRose(app.pulse ? app.pulse.detector : null);
    beep();
    browserNotify(data.title || C.alarm.title, data.text || '');
    document.title = C.app.titleWaiting;
    if (navigator.vibrate) { try { navigator.vibrate([120, 60, 120]); } catch (e) { /* не все умеют */ } }
    setBadge(1);
  }

  function clearAlarm() {
    app.alarmed = false;
    app.alarmText = '';
    document.title = C.app.title;
    setBadge(0);
    renderRose(app.pulse ? app.pulse.detector : null);
  }

  function setBadge(n) {
    try {
      if (n && navigator.setAppBadge) navigator.setAppBadge(n);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) { /* поддерживают не все */ }
  }

  $('roseSeen').addEventListener('click', function (e) {
    e.stopPropagation();
    clearAlarm();
  });
  // На телефоне кнопка уезжает во вторую строку, но по прибору можно просто
  // ткнуть — это то же самое действие.
  $('rose').addEventListener('click', function () {
    if ($('rose').dataset.state === 'waiting') clearAlarm();
  });

  $('btnBell').addEventListener('click', function () {
    // Клик — тот самый «жест пользователя», после которого браузер
    // разрешает звук и позволяет спросить про уведомления.
    beep();
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    raiseAlarm({ title: C.alarm.demoTitle, text: C.alarm.demoText });
    setTimeout(clearAlarm, 4000);
  });

  // ── 12. Журнал сессий ─────────────────────────────────────────────────────

  function loadSessions() {
    var box = $('sessions');
    return api('/api/sessions').then(function (data) {
      clear(box);
      if (data.note || !data.sessions.length) {
        emptyBlock(box, 'clock', C.pulse.sessionsEmpty.title,
          data.note || C.pulse.sessionsEmpty.text);
        return;
      }
      data.sessions.forEach(function (s) {
        var item = el('div', 'session' + (s.id === data.active ? ' is-active' : ''));
        var top = el('div', 'session__top');
        top.appendChild(el('span', 'session__when', dateTime(s.startedAt)));
        if (s.id === data.active) top.appendChild(el('span', 'badge badge--act', C.pulse.now));
        item.appendChild(top);
        if (s.firstPrompt) item.appendChild(el('div', 'session__prompt', s.firstPrompt));
        item.appendChild(el('div', 'session__meta',
          (s.branch ? s.branch + ' · ' : '') + duration(s.durationMs) + ' · ' + bytes(s.size)));
        item.addEventListener('click', function () { openArchive(s); });
        box.appendChild(item);
      });
    }).catch(function () {
      clear(box);
      emptyBlock(box, 'clock', C.pulse.sessionsOff.title, C.pulse.sessionsOff.text);
    });
  }

  function openArchive(s) {
    if (app.state && s.id === app.state.sessionId) { exitArchive(); return; }
    api('/api/session/' + encodeURIComponent(s.id)).then(function (data) {
      if (data.error) { notice(data.error); return; }
      app.archive = data;
      rebuildFeed();
      showArchiveBar(s, data);
      setView('feed');
    });
  }

  function showArchiveBar(s, data) {
    notice(C.archive.shown(dateTime(s.startedAt), withPlural(data.events.length, C.words.event)), 'archive');
    var bar = $('notice');
    if (!bar.querySelector('.btn:not(#noticeClose)')) {
      var back = el('button', 'btn', C.archive.back);
      back.addEventListener('click', exitArchive);
      bar.insertBefore(back, $('noticeClose'));
    }
  }

  function exitArchive() {
    app.archive = null;
    hideNotice();
    rebuildFeed();
  }

  // ── 13. Сообщения и состояние ─────────────────────────────────────────────

  function notice(text, kind) {
    var bar = $('notice');
    $('noticeText').textContent = text;
    clear($('noticeIcon'));
    $('noticeIcon').appendChild(icon(kind === 'archive' ? 'clock' : 'info', 'i--sm'));
    var stale = bar.querySelector('.btn:not(#noticeClose)');
    if (stale && kind !== 'archive' && kind !== 'elsewhere') bar.removeChild(stale);
    bar.hidden = false;
  }

  function hideNotice() {
    var bar = $('notice');
    bar.hidden = true;
    var stale = bar.querySelector('.btn:not(#noticeClose)');
    if (stale) bar.removeChild(stale);
  }

  $('noticeClose').addEventListener('click', function () {
    if (app.archive) return exitArchive();
    // От предложения переключиться отмахнулись — сервер запомнит это и
    // больше про эту папку не напомнит.
    if (elsewhereShown) {
      elsewhereShown = '';
      api('/api/projects/elsewhere/dismiss', { method: 'POST' })
        .catch(function () { /* не дошло — предложение вернётся, не страшно */ });
    }
    hideNotice();
  });

  // Клод начал работать в другой папке. Самая частая причина пустой ленты —
  // и человек про неё не догадывается, поэтому Штурман говорит первым.
  var elsewhereShown = '';

  function renderElsewhere(info) {
    if (!info || !info.path) {
      if (elsewhereShown) { elsewhereShown = ''; hideNotice(); }
      return;
    }
    if (info.path === elsewhereShown) return;
    elsewhereShown = info.path;
    notice(C.elsewhere.text(info.name), 'elsewhere');
    var bar = $('notice');
    var stale = bar.querySelector('.btn:not(#noticeClose)');
    if (stale) bar.removeChild(stale);
    var go = el('button', 'btn', C.elsewhere.act);
    go.title = info.path;
    go.addEventListener('click', function () {
      elsewhereShown = '';
      hideNotice();
      chooseProject(info.path);
    });
    bar.insertBefore(go, $('noticeClose'));
  }

  var pickShown = false;

  function renderState(s) {
    app.state = s;
    if (typeof s.openLast === 'boolean') app.openLast = s.openLast;
    else if (s.settings && typeof s.settings.openLast === 'boolean') app.openLast = s.settings.openLast;
    // Экран выбора показываем ровно один раз и только когда состояние
    // действительно пришло: решает сервер, а не таймер на старте.
    if (s.pick && !pickShown) {
      pickShown = true;
      openPicker(true);
    }
    $('projectName').textContent = s.projectName;
    $('projectPath').textContent = s.project;
    if (s.projectKey) app.projectKey = s.projectKey;
    if (s.projects) renderSwitcher(s.projects, s.projectKey);

    $('btnConnect').classList.toggle('is-on', !!s.share);
    $('btnConnect').title = s.share ? C.head.connectOn : C.head.connect;

    if (!app.archive) renderElsewhere(s.elsewhere);
    if (s.projectCheck && !s.projectCheck.isProject && s.projectCheck.reason &&
        !app.archive && !elsewhereShown) {
      notice(s.projectCheck.reason);
    }
    renderFeedEmpty();
  }

  function renderSwitcher(list, activeKey) {
    app.projects = list;
    var box = $('switcher');
    if (!list || list.length < 2) { box.hidden = true; return; }
    box.hidden = false;
    var chips = $('switcherChips');
    clear(chips);
    list.forEach(function (p) {
      var btn = el('button', 'pill' + (p.key === activeKey ? ' is-active' : ''));
      btn.title = C.head.switchTo(p);
      if (p.waiting && p.key !== activeKey) btn.appendChild(el('span', 'pill__dot'));
      btn.appendChild(el('span', null, p.name));
      btn.addEventListener('click', function () { switchProject(p.key); });
      chips.appendChild(btn);
    });
  }

  function switchProject(key) {
    if (key === app.projectKey) return;
    app.projectKey = key;
    app.events = [];
    app.queued = [];
    app.archive = null;
    app.heat = {};
    app.treeNodes = [];
    cheatShown = '';
    app.collapsed = {};
    clearAlarm();
    hideNotice();
    closeSheet();
    recomputeVisible();
    drawnKey = '';
    renderWindow();
    store.set('project', key);
    loadTree();
    loadSessions();
    connect();
  }

  function pollProjects() {
    if (!app.projects || app.projects.length < 2) return;
    api('/api/projects').then(function (d) {
      renderSwitcher(d.projects, app.projectKey);
    }).catch(function () { /* сервер закрылся — SSE об этом скажет */ });
  }
  setInterval(pollProjects, 5000);

  // ── 14. Поток событий (SSE) ───────────────────────────────────────────────

  var source = null;

  function connect() {
    if (source) { source.close(); source = null; }
    source = new EventSource(href('/api/stream'));

    source.addEventListener('snapshot', function (e) {
      var data = JSON.parse(e.data);
      app.offline = false;
      renderState(data.state);
      if (data.git) renderGit(data.git);
      if (data.pulse) renderPulse(data.pulse);
      app.events = [];
      (data.events || []).forEach(function (ev) {
        app.events.push(ev);
        if (ev.title) app.lastTitle = ev.title;
        if (ev.file) app.heat[ev.file] = ev.ts;
      });
      if (!app.archive) rebuildFeed();
      refreshCheat();
    });

    source.addEventListener('event', function (e) {
      var ev = JSON.parse(e.data);
      if (ev.file) touchFile(ev.file);
      if (ev.kind === 'session' && ev.action === 'resumed') clearAlarm();
      if (app.archive) { app.events.push(ev); return; }
      addEvent(ev);
    });

    source.addEventListener('fs', function (e) {
      var ev = JSON.parse(e.data);
      if (ev.file) touchFile(ev.file);
    });

    source.addEventListener('git', function (e) { renderGit(JSON.parse(e.data)); });
    source.addEventListener('pulse', function (e) { renderPulse(JSON.parse(e.data)); });
    source.addEventListener('state', function (e) { renderState(JSON.parse(e.data)); });
    source.addEventListener('attention', function (e) { raiseAlarm(JSON.parse(e.data)); });

    source.onopen = function () {
      if (app.offline) { app.offline = false; hideNotice(); }
    };

    source.onerror = function () {
      app.offline = true;
      renderRose(null);
    };
  }

  function disconnect() {
    if (source) { source.close(); source = null; }
  }

  /**
   * Экономия на телефоне: пока вкладка свёрнута, поток не нужен — он держит
   * соединение и будит радиомодуль. Отключаемся через минуту в фоне и
   * подключаемся заново при возвращении.
   */
  (function visibility() {
    var sleepTimer = null;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        sleepTimer = setTimeout(function () { disconnect(); sleepTimer = null; }, 60000);
      } else {
        if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
        if (!source) connect();
        api('/api/pulse').then(renderPulse).catch(function () { /* переподключимся */ });
      }
    });
  })();

  // ── 15. Управление, тур, приветствие, старт ───────────────────────────────

  $('btnDetail').addEventListener('click', function () { setDetailed(!app.detailed); });

  function setDetailed(v) {
    app.detailed = v;
    store.set('detailed', v);
    $('btnDetail').classList.toggle('is-on', v);
    $('btnDetail').setAttribute('aria-pressed', v ? 'true' : 'false');
    measureRow();
    drawnKey = '';
    rebuildFeed();
  }

  $('btnPause').addEventListener('click', function () { togglePause(); });
  $('btnResume').addEventListener('click', function () { togglePause(false); });

  function togglePause(force) {
    app.paused = force === undefined ? !app.paused : force;
    var btn = $('btnPause');
    clear(btn);
    btn.appendChild(icon(app.paused ? 'play' : 'pause'));
    btn.appendChild(el('span', 'btn__label', app.paused ? C.feed.resume : C.feed.pause));
    btn.title = app.paused ? C.feed.resume : C.feed.pause;
    btn.setAttribute('aria-label', app.paused ? C.feed.resume : C.feed.pause);
    btn.classList.toggle('is-on', app.paused);
    $('feedPaused').hidden = !app.paused;
    $('pausedText').textContent = C.feed.paused(app.queued.length);
    if (!app.paused) flushQueue();
  }

  function flushQueue() {
    app.queued.forEach(function (ev) { app.events.push(ev); });
    app.queued = [];
    rebuildFeed();
  }

  $('feedFilters').addEventListener('click', function (e) {
    var chip = e.target.closest('.pill');
    if (!chip) return;
    setFilter(chip.dataset.filter);
  });

  var searchTimer = null;
  $('feedSearch').addEventListener('input', function () {
    var v = this.value.trim().toLowerCase();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { app.query = v; rebuildFeed(); }, 180);
  });

  var treeSearchTimer = null;
  $('treeSearch').addEventListener('input', function () {
    var v = this.value.trim().toLowerCase();
    clearTimeout(treeSearchTimer);
    treeSearchTimer = setTimeout(function () { app.treeQuery = v; renderTree(); }, 180);
  });

  $('btnTreeRefresh').addEventListener('click', loadTree);
  $('btnSessionsRefresh').addEventListener('click', loadSessions);
  $('btnGlossary').addEventListener('click', openGlossary);
  $('btnConnect').addEventListener('click', openConnect);
  $('btnDigest').addEventListener('click', openDigest);
  $('btnSettings').addEventListener('click', openSettings);

  // «⋯» на телефоне: то же самое, что кнопки в шапке на компьютере.
  $('btnMore').addEventListener('click', function () {
    var body = openSheet(C.more.title, 'more');
    var items = [
      ['phone', C.more.connect, C.more.connectNote, openConnect],
      ['book', C.more.glossary, C.more.glossaryNote(glossary.terms.length), openGlossary],
      ['digest', C.more.digest, C.more.digestNote, openDigest],
      ['theme', C.more.look, C.more.lookNote(presetName()), function () { closeSheet(); openSettings(); }],
      ['tour', C.more.tour, C.more.tourNote, function () { closeSheet(); startTour(); }],
      ['settings', C.more.settings, C.more.settingsNote, openSettings],
      ['folder', C.picker.change, C.settings.projectNote,
        function () { closeSheet(); openPicker(true); }]
    ];
    items.forEach(function (item) {
      var row = el('div', 'row row--act');
      var ic = el('span', 'row__control');
      ic.appendChild(icon(item[0]));
      row.appendChild(ic);
      var lbl = el('div', 'row__label');
      lbl.appendChild(el('b', null, item[1]));
      lbl.appendChild(el('span', null, item[2]));
      row.appendChild(lbl);
      var go = el('span', 'row__control');
      go.appendChild(icon('right', 'i--sm'));
      row.appendChild(go);
      row.addEventListener('click', item[3]);
      body.appendChild(row);
    });

    // Переключатель проектов на телефоне живёт здесь: в шапке для него
    // нет места, но потеряться он не должен.
    if (app.projects && app.projects.length > 1) {
      var sec = section(body, C.more.projects);
      sec.appendChild(el('p', 'dim', C.more.projectsNote));
      app.projects.forEach(function (p) {
        var row = el('div', 'row row--act');
        var lbl = el('div', 'row__label');
        lbl.appendChild(el('b', null, p.name));
        lbl.appendChild(el('span', null, p.path));
        row.appendChild(lbl);
        if (p.key === app.projectKey) row.appendChild(el('span', 'badge badge--act', C.pulse.now));
        row.addEventListener('click', function () { switchProject(p.key); closeSheet(); });
        sec.appendChild(row);
      });
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-gittab]'), function (btn) {
    btn.addEventListener('click', function () { setGitTab(btn.dataset.gittab); });
  });

  // Горячие клавиши. Не срабатывают при вводе в поле.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!sheet.hidden) closeSheet();
      else if (!$('tour').hidden) endTour();
      tip.hidden = true;
      return;
    }
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      setView(VIEWS[Number(e.key) - 1]);
    } else if (e.key === '/') {
      e.preventDefault();
      setView('feed');
      $('feedSearch').focus();
      $('feedSearch').select();
    } else if (C.hotkeys.sound.indexOf(e.key) !== -1) {
      app.sound = !app.sound;
      store.set('sound', app.sound);
      notice(app.sound ? C.settings.soundOn : C.settings.soundOff);
      setTimeout(hideNotice, 1800);
    } else if (C.hotkeys.theme.indexOf(e.key) !== -1) {
      var order = ['auto', 'dark', 'light'];
      applyTheme(order[(order.indexOf(app.theme) + 1) % order.length]);
    } else if (C.hotkeys.pause.indexOf(e.key) !== -1) {
      togglePause();
    }
  });

  // Перетаскивание границы панелей на компьютере.
  (function resizer() {
    var grid = $('grid');
    var bar = el('div', 'resizer');
    grid.appendChild(bar);

    var saved = store.get('gridSplit', null);
    function apply(fr) {
      if (isNarrow()) return;
      grid.style.gridTemplateColumns = fr;
    }
    if (saved) apply(saved);

    var dragging = false;
    function place() {
      if (isNarrow()) { bar.hidden = true; return; }
      bar.hidden = false;
      var r = $('panelFeed').getBoundingClientRect();
      bar.style.left = (r.right - grid.getBoundingClientRect().left + 6) + 'px';
    }

    bar.addEventListener('mousedown', function (e) {
      dragging = true;
      bar.classList.add('is-dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var r = grid.getBoundingClientRect();
      var left = Math.min(Math.max(e.clientX - r.left, 320), r.width - 320);
      var cols = window.matchMedia('(max-width: 1400px)').matches
        ? left + 'px 1fr'
        : left + 'px 1fr 1fr';
      apply(cols);
      store.set('gridSplit', cols);
      place();
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      bar.classList.remove('is-dragging');
    });
    window.addEventListener('resize', place);
    setTimeout(place, 300);
  })();

  window.addEventListener('resize', function () {
    drawnKey = '';
    renderWindow();
    if (app.pulse) renderAttentionGraph(app.pulse.attention);
  });

  // --- тур ---------------------------------------------------------------------

  var TOUR_TARGETS = [
    function () { return $('rose'); },
    function () { return isNarrow() ? $('tabbar') : $('panelFeed'); },
    function () { return isNarrow() ? $('tabbar') : $('panelTree'); },
    function () { return isNarrow() ? $('tabbar') : $('panelGit'); },
    function () { return $('btnBell'); }
  ];

  var tourStep = 0;

  function startTour() {
    closeSheet();
    tourStep = 0;
    $('tour').hidden = false;
    drawTour();
  }

  function drawTour() {
    var step = C.tour.steps[tourStep];
    var target = TOUR_TARGETS[tourStep]();
    $('tourStep').textContent = C.tour.step(tourStep + 1, C.tour.steps.length);
    $('tourTitle').textContent = step.title;
    $('tourText').textContent = step.text;
    $('tourPrev').disabled = tourStep === 0;
    $('tourNext').textContent = tourStep === C.tour.steps.length - 1 ? C.tour.done : C.tour.next;

    var spot = $('tourSpot');
    var card = $('tourCard');
    if (!target) { spot.style.display = 'none'; return; }
    spot.style.display = '';
    var r = target.getBoundingClientRect();
    var pad = 6;
    spot.style.left = (r.left - pad) + 'px';
    spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';

    var cw = card.offsetWidth || 380;
    var ch = card.offsetHeight || 200;
    var left, top;
    if (isNarrow()) {
      left = Math.max(12, Math.min((window.innerWidth - cw) / 2, window.innerWidth - cw - 12));
      top = r.top > window.innerHeight / 2 ? r.top - ch - 16 : r.bottom + 16;
      top = Math.max(12, Math.min(top, window.innerHeight - ch - 12));
    } else {
      left = r.right + 16;
      if (left + cw > window.innerWidth - 12) left = r.left - cw - 16;
      if (left < 12) left = Math.max(12, Math.min(r.left, window.innerWidth - cw - 12));
      top = Math.max(12, Math.min(r.top, window.innerHeight - ch - 12));
    }
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function endTour() {
    $('tour').hidden = true;
    store.set('tourDone', true);
  }

  $('tourNext').addEventListener('click', function () {
    if (tourStep === C.tour.steps.length - 1) { endTour(); return; }
    tourStep++;
    drawTour();
  });
  $('tourPrev').addEventListener('click', function () {
    if (tourStep > 0) { tourStep--; drawTour(); }
  });
  $('tourSkip').addEventListener('click', endTour);
  $('btnTour').addEventListener('click', startTour);
  window.addEventListener('resize', function () { if (!$('tour').hidden) drawTour(); });

  // --- приветствие при первом запуске ------------------------------------------

  function showWelcome() {
    var box = el('div', 'tour tour--welcome');
    box.appendChild(el('div', 'tour__backdrop'));
    var card = el('div', 'tour__card');
    var mark = el('div', 'welcome__mark');
    mark.appendChild(icon('compass', 'i--xl'));
    card.appendChild(mark);
    card.appendChild(el('h3', 'tour__title', C.welcome.title));
    card.appendChild(el('p', 'tour__text', C.welcome.text));
    var acts = el('div', 'tour__actions');
    var skip = el('button', 'btn', C.welcome.skip);
    var go = el('button', 'btn btn--primary', C.welcome.act);
    skip.addEventListener('click', function () { document.body.removeChild(box); store.set('tourDone', true); });
    go.addEventListener('click', function () { document.body.removeChild(box); startTour(); });
    acts.appendChild(skip);
    acts.appendChild(go);
    card.appendChild(acts);
    box.appendChild(card);
    document.body.appendChild(box);
    go.focus();
  }

  // --- PWA ---------------------------------------------------------------------

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        // Без service worker панель работает как обычная страница.
      });
    });
  }

  // --- старт -------------------------------------------------------------------

  dressUp(document);
  renderDigestActions();
  applyTheme(app.theme);
  applyDensity(app.density);
  setDetailed(app.detailed);
  togglePause(false);
  setView(store.get('view', 'feed'));
  renderRose(null);

  // Запуск приборов — один раз за открытие страницы, и только если человек
  // не просил убрать движение.
  (function boot() {
    var screen = $('boot');
    if (reduceMotion) {
      document.body.classList.remove('is-booting');
      screen.hidden = true;
      return;
    }
    setTimeout(function () {
      screen.hidden = true;
      document.body.classList.remove('is-booting');
    }, 1700);
  })();

  api('/api/projects').then(function (d) {
    var saved = store.get('project', null);
    var known = (d.projects || []).some(function (p) { return p.key === saved; });
    app.projectKey = known ? saved : d.active;
    renderSwitcher(d.projects, app.projectKey);
  }).catch(function () { /* одиночный проект — переключатель не нужен */ })
    .then(loadGlossary)
    .then(loadTree)
    .then(loadSessions)
    .then(function () {
      connect();
      if (!store.get('tourDone', false)) {
        setTimeout(showWelcome, reduceMotion ? 300 : 1900);
      }
    });

  setInterval(loadSessions, 60000);
})();
