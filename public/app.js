/* ===========================================================================
   Штурман — клиентская часть.

   Ванильный JS, без сборки и библиотек. Одна разметка на телефон и
   компьютер: раскладку меняет CSS, а этот файл лишь переключает активную
   секцию и следит, чтобы всё оставалось доступным на обоих форм-факторах.

   Разделы:
     0  помощники              8  словарь и подсказки
     1  состояние              9  шторка (детали, настройки, подключение)
     2  вкладки и жесты       10  пульс и граф внимания
     3  тема                  11  сигнал «Клод остановился»
     4  лента (виртуализация) 12  журнал сессий
     5  детали события        13  сообщения и состояние
     6  карта проекта         14  поток событий (SSE)
     7  git                   15  управление, горячие клавиши, тур, старт
   =========================================================================== */
(function () {
  'use strict';

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

  // Русские окончания — на клиенте нужна та же логика, что и на сервере.
  function plural(n, one, few, many) {
    var abs = Math.abs(Math.trunc(n) || 0);
    var m100 = abs % 100;
    var m10 = abs % 10;
    if (m100 >= 11 && m100 <= 14) return many;
    if (m10 === 1) return one;
    if (m10 >= 2 && m10 <= 4) return few;
    return many;
  }
  function withPlural(n, one, few, many) { return n + ' ' + plural(n, one, few, many); }

  function duration(ms) {
    var total = Math.max(0, Math.round((ms || 0) / 1000));
    var s = total % 60;
    var m = Math.floor(total / 60) % 60;
    var h = Math.floor(total / 3600);
    if (h > 0) return h + ' ч ' + m + ' мин';
    if (m > 0) return m + ' мин ' + s + ' с';
    return s + ' с';
  }

  function bytes(n) {
    if (!isFinite(n)) return '—';
    if (n < 1024) return n + ' Б';
    if (n < 1048576) return (n / 1024).toFixed(1).replace('.', ',') + ' КБ';
    return (n / 1048576).toFixed(1).replace('.', ',') + ' МБ';
  }

  function fmtNum(n) {
    return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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
      if (r.status === 401) throw new Error('Нужен ключ доступа');
      if (!r.ok && r.status >= 500) throw new Error('Сервер ответил ошибкой ' + r.status);
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
    collapsed: {},
    heat: {},
    selectedFile: null,
    gitTab: 'now',
    archive: null,
    projectKey: null,
    projects: [],
    view: 'feed',
    sound: store.get('sound', true),
    notify: store.get('notify', true),
    theme: store.get('theme', 'auto'),
    token: null,
    unseen: { feed: 0, git: 0 }
  };

  var MAX_EVENTS = 1500;
  var HEAT_MS = 90000;

  // Ключ доступа приходит в ссылке из QR-кода. Забираем его и убираем из
  // адресной строки: незачем светить ключ в истории браузера и в заголовке.
  (function pickToken() {
    var m = /[?&]t=([^&]+)/.exec(window.location.search);
    if (!m) return;
    app.token = decodeURIComponent(m[1]);
    try {
      var clean = window.location.pathname + window.location.hash;
      window.history.replaceState(null, '', clean);
    } catch (e) { /* не дали — не страшно, кука уже поставлена */ }
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
      t.setAttribute('aria-current', on ? 'page' : 'false');
    });

    // Счётчик непрочитанного снимается, когда вкладку открыли.
    if (name === 'feed') { app.unseen.feed = 0; }
    if (name === 'git') { app.unseen.git = 0; }
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
    // Лента виртуализируется — при возврате на вкладку пересчитываем окно.
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
  });

  // Свайп между вкладками. Слушаем только на узких экранах и только когда
  // жест горизонтальный — иначе он мешал бы обычной прокрутке списка.
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

  // ── 3. Тема ───────────────────────────────────────────────────────────────

  function applyTheme(theme) {
    app.theme = theme;
    store.set('theme', theme);
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);

    var label = { auto: '🌗', dark: '🌙', light: '☀️' }[theme] || '🌗';
    var title = {
      auto: 'Тема: как в системе',
      dark: 'Тема: тёмная',
      light: 'Тема: светлая'
    }[theme];
    $('btnTheme').textContent = label;
    $('btnTheme').title = title + ' — нажмите, чтобы сменить';
  }

  $('btnTheme').addEventListener('click', function () {
    var order = ['auto', 'dark', 'light'];
    applyTheme(order[(order.indexOf(app.theme) + 1) % order.length]);
  });

  // ── 4. Лента с виртуализацией ─────────────────────────────────────────────

  var feed = $('feed');
  var feedScroll = $('feedScroll');
  var feedEmpty = $('feedEmpty');
  var feedTop = $('feedTop');
  var feedBottom = $('feedBottom');

  // Высота карточки оценивается по факту: в подробном режиме и на узком
  // экране она заметно больше, и фиксированное число врало бы.
  var ROW_H = 74;
  var OVERSCAN = 8;

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
    else if (ev.level === 'warn') cls.push('ev--warn');
    if (ev.kind === 'user') cls.push('ev--user');
    if (ev.kind === 'tool' && (ev.action === 'edit' || ev.action === 'write')) cls.push('ev--edit');
    if (ev.kind === 'tool' && ev.action === 'run') cls.push('ev--run');
    if (ev.kind === 'session' && ev.action === 'idle') cls.push('ev--attention');
    if (ev.sidechain) cls.push('ev--agent');
    return cls.join(' ');
  }

  function renderEvent(ev, isNew) {
    var li = el('li', evClass(ev) + (isNew && !reduceMotion ? ' is-new' : ''));
    li.dataset.id = ev.id;
    li.appendChild(el('span', 'ev__icon', ev.icon || '•'));
    li.appendChild(el('span', 'ev__title', ev.title || ''));
    li.appendChild(el('span', 'ev__time', clock(ev.ts)));
    if (ev.hint) li.appendChild(el('span', 'ev__hint', ev.hint));
    if (app.detailed) li.appendChild(el('pre', 'ev__raw', rawText(ev)));
    li.addEventListener('click', function () { openEventDetails(ev); });
    return li;
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
      text += '\n\nАргументы:\n' + JSON.stringify(ev.args, null, 2).slice(0, 2000);
    }
    if (ev.output) text += '\n\nВывод:\n' + String(ev.output).slice(0, 2000);
    return text;
  }

  // Пересчёт списка видимых событий. Отдельно от отрисовки, чтобы фильтр и
  // поиск не трогали прокрутку.
  function recomputeVisible() {
    var source = app.archive ? app.archive.events : app.events;
    app.visible = source.filter(function (ev) {
      if (ev.kind === 'result' && ev.ok) return false;   // успех схлопнут в вызов
      return matches(ev);
    });
    feedEmpty.hidden = app.visible.length > 0;
  }

  /**
   * Виртуализация: в разметке живут только видимые карточки плюс запас,
   * высоту прокрутки держат распорки сверху и снизу. Без этого на телефоне
   * лента из тысячи событий отвечает с заметной задержкой.
   */
  function renderWindow() {
    var total = app.visible.length;
    var h = feedScroll.clientHeight || 600;
    var perScreen = Math.ceil(h / ROW_H) + OVERSCAN * 2;

    // Пока событий немного, виртуализация только мешает — рисуем всё.
    if (total <= perScreen) {
      feedTop.style.height = '0px';
      feedBottom.style.height = '0px';
      drawRows(0, total);
      return;
    }

    // Окно обязательно прижимается к границам списка. Без этого после смены
    // режима «Просто/Подробно» (карточки становятся выше или ниже) старый
    // scrollTop уводил окно за конец списка, и лента оказывалась пустой.
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
    // Сначала пересчитываем распорки под текущую высоту карточки, и только
    // потом прыгаем вниз — иначе scrollHeight ещё старый и прыжок промахнётся.
    renderWindow();
    feedScroll.scrollTop = feedScroll.scrollHeight;
    renderWindow();
  }

  function addEvent(ev) {
    app.events.push(ev);
    if (app.events.length > MAX_EVENTS) app.events.splice(0, app.events.length - MAX_EVENTS);

    if (ev.kind === 'result' && ev.ok && ev.toolUseId) { annotateCall(ev); return; }

    if (app.paused) {
      app.queued.push(ev);
      $('pausedCount').textContent = app.queued.length;
      return;
    }
    if (!matches(ev)) return;

    // Счётчик непрочитанного на вкладке — на телефоне видна одна секция.
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
    scrollToBottom();
  }

  // ── 5. Детали события ─────────────────────────────────────────────────────

  function section(parent, title) {
    var s = el('div', 'sec');
    s.appendChild(el('h4', 'sec__title', title));
    parent.appendChild(s);
    return s;
  }

  function facts(parent, pairs) {
    var dl = el('dl', 'card__facts');
    pairs.forEach(function (p) {
      if (p[1] === undefined || p[1] === null || p[1] === '') return;
      dl.appendChild(el('dt', null, p[0]));
      dl.appendChild(el('dd', null, String(p[1])));
    });
    if (dl.childElementCount) parent.appendChild(dl);
  }

  function openEventDetails(ev) {
    var body = openSheet((ev.icon || '') + ' ' + (ev.title || 'Событие'));
    if (ev.hint) body.appendChild(el('p', 'card__what', ev.hint));

    facts(body, [
      ['Когда', dateTime(ev.ts)],
      ['Источник', sourceRu(ev.source)],
      ['Кто', ev.sidechain ? 'помощник-субагент' : ''],
      ['Инструмент', ev.tool || ''],
      ['Файл', ev.file || ''],
      ['Команда', ev.command || ''],
      ['Шаблон поиска', ev.pattern || '']
    ]);

    var res = ev.result || (ev.kind === 'result' ? ev : null);
    if (res) {
      if (res.stdout && res.stdout.trim()) {
        section(body, 'Что вывела команда').appendChild(
          Object.assign(el('pre', 'out'), { textContent: res.stdout.slice(0, 20000) }));
      }
      if (res.stderr && res.stderr.trim()) {
        section(body, 'Сообщения об ошибках').appendChild(
          Object.assign(el('pre', 'out out--error'), { textContent: res.stderr.slice(0, 20000) }));
      }
      if (!res.stdout && !res.stderr && res.output) {
        section(body, 'Результат').appendChild(
          Object.assign(el('pre', 'out'), { textContent: String(res.output).slice(0, 20000) }));
      }
    }

    if (ev.text) {
      section(body, ev.kind === 'user' ? 'Ваше сообщение' : 'Текст Клода').appendChild(
        Object.assign(el('pre', 'out'), { textContent: ev.text.slice(0, 20000) }));
    }

    if (ev.file && (ev.action === 'edit' || ev.action === 'write' || ev.kind === 'file')) {
      var sec = section(body, 'Что изменилось в файле');
      var loading = el('p', 'muted', 'Смотрим дифф…');
      sec.appendChild(loading);
      api('/api/git/diff', null, { path: ev.file }).then(function (d) {
        sec.removeChild(loading);
        if (d.error) return sec.appendChild(el('p', 'muted', d.error));
        if (d.note) sec.appendChild(el('p', 'muted', d.note));
        renderDiff(sec, d.diff);
      }).catch(function () { loading.textContent = 'Дифф получить не удалось.'; });
    }

    if (app.state && app.state.askEnabled && app.state.askAvailable) addAskButton(body, ev);

    var rawSec = section(body, 'Сырые данные события');
    rawSec.appendChild(Object.assign(el('pre', 'out'), { textContent: rawText(ev) }));
  }

  function sourceRu(source) {
    return ({
      transcript: 'транскрипт Claude Code',
      fs: 'файловая система',
      git: 'git',
      hook: 'хук Claude Code',
      shturman: 'сам Штурман'
    })[source] || source || '';
  }

  function addAskButton(body, ev) {
    var sec = section(body, 'Не поняли, что произошло?');
    var btn = el('button', 'btn', '🤔 Спроси Клода');
    var answer = el('div');
    sec.appendChild(btn);
    sec.appendChild(answer);
    sec.appendChild(el('p', 'muted', 'Вопрос уйдёт в claude -p и израсходует часть ваших лимитов.'));

    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Спрашиваем…';
      var prompt = 'Объясни коротко и простыми словами новичку, что означает это ' +
        'событие в работе Claude Code и нужно ли что-то делать.\n\n' +
        'Событие: ' + ev.title + '\n' + (ev.hint || '') + '\n' +
        (ev.command ? 'Команда: ' + ev.command + '\n' : '') +
        (ev.file ? 'Файл: ' + ev.file + '\n' : '');
      api('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt })
      }).then(function (r) {
        btn.hidden = true;
        clear(answer);
        answer.appendChild(Object.assign(el('pre', 'out'), {
          textContent: r.ok ? r.answer : (r.error || 'Ответа не получилось.')
        }));
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = '🤔 Спроси Клода';
        answer.textContent = 'Не получилось: ' + e.message;
      });
    });
  }

  function renderDiff(parent, files) {
    if (!files || !files.length) {
      parent.appendChild(el('p', 'muted', 'Изменений не нашлось.'));
      return;
    }
    files.forEach(function (f) {
      var box = el('div', 'diff');
      var legend = el('div', 'diff__legend');
      legend.appendChild(el('span', null, f.path || ''));
      var addSpan = el('span');
      addSpan.appendChild(el('b', null, '+' + (f.added || 0)));
      addSpan.appendChild(document.createTextNode(' добавлено'));
      var delSpan = el('span');
      delSpan.appendChild(el('b', null, '−' + (f.removed || 0)));
      delSpan.appendChild(document.createTextNode(' удалено'));
      legend.appendChild(addSpan);
      legend.appendChild(delSpan);
      if (f.reconstructed) legend.appendChild(el('span', null, 'по транскрипту'));
      box.appendChild(legend);

      if (f.binary) {
        box.appendChild(el('div', 'diff__hunk-head',
          'Это не текстовый файл — построчно показать нечего.'));
      }

      (f.hunks || []).forEach(function (h) {
        box.appendChild(el('div', 'diff__hunk-head',
          'фрагмент со строки ' + h.newStart + (h.context ? ' · ' + h.context : '')));
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

  function loadTree() {
    return api('/api/tree').then(function (t) {
      app.treeNodes = t.nodes || [];
      if (t.truncated) {
        notice('Проект очень большой — карта показывает первые ' + app.treeNodes.length + ' элементов.');
      }
      renderTree();
    }).catch(function () {
      clear(treeBox);
      treeBox.appendChild(el('p', 'muted', 'Не удалось прочитать папку проекта.'));
    });
  }

  function renderTree() {
    clear(treeBox);
    var q = app.treeQuery;
    var nodes = app.treeNodes;

    if (q) {
      var found = nodes.filter(function (n) {
        return n.type === 'file' && n.path.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 200);
      if (!found.length) { treeBox.appendChild(el('p', 'muted', 'Ничего не нашлось.')); return; }
      found.forEach(function (n) { treeBox.appendChild(nodeRow(n, true)); });
      return;
    }

    if (!nodes.length) {
      treeBox.appendChild(el('p', 'muted', 'В папке нет файлов, которые стоит показывать.'));
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
      row.appendChild(el('span', 'node__caret', '▾'));
      if (app.collapsed[n.path]) row.classList.add('is-collapsed');
    }
    row.appendChild(el('span', 'node__icon', n.type === 'dir' ? '📁' : (n.icon || '📄')));
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

    var body = openSheet('📄 ' + pathStr);
    body.appendChild(el('p', 'muted', 'Загружаем…'));

    api('/api/file', null, { path: pathStr }).then(function (card) {
      clear(body);
      if (card.error && !card.title) { body.appendChild(el('p', 'muted', card.error)); return; }
      setSheetTitle((card.icon || '📄') + ' ' + card.name);
      body.appendChild(el('span', 'card__kind', card.title));
      body.appendChild(el('p', 'card__what', card.text));
      facts(body, [
        ['Путь', card.path],
        ['Размер', card.sizeText || '—'],
        ['Изменён', card.mtime ? dateTime(card.mtime) : '—'],
        ['Состояние', card.exists === false ? 'файла больше нет' : 'на месте']
      ]);
      var sec = section(body, 'Последние изменения');
      if (card.diffNote) sec.appendChild(el('p', 'muted', card.diffNote));
      renderDiff(sec, card.diff);
    }).catch(function (e) {
      clear(body);
      body.appendChild(el('p', 'muted', 'Не получилось: ' + e.message));
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
      now.appendChild(el('p', 'muted', (g && g.reason) || 'Git недоступен.'));
      now.appendChild(el('p', 'muted',
        'Остальные разделы Штурмана работают как обычно — карта проекта и лента ' +
        'не зависят от git.'));
      hist.appendChild(el('p', 'muted', 'Истории нет: проект не под контролем версий.'));
      return;
    }

    var line = el('div', 'gitline');
    line.appendChild(el('span', 'gitline__label', 'Ветка'));
    var b = el('span', 'gitline__value');
    b.appendChild(el('code', 'git__branch', g.branch));
    b.appendChild(termButton('branch'));
    line.appendChild(b);
    now.appendChild(line);
    now.appendChild(el('p', 'git__explain', g.branchExplain || ''));

    if (g.aheadBehind) {
      now.appendChild(el('p', 'muted',
        'Относительно ' + g.aheadBehind.upstream + ': у вас на ' +
        withPlural(g.aheadBehind.ahead, 'коммит', 'коммита', 'коммитов') + ' больше, не забрано ' +
        withPlural(g.aheadBehind.behind, 'коммит', 'коммита', 'коммитов') + '.'));
    }

    var count = el('div', 'git__count');
    count.appendChild(el('div', 'git__count-num' + (g.summary.total === 0 ? ' is-clean' : ''), g.summary.total));
    var ct = el('div', 'git__count-text', g.summary.explain);
    ct.appendChild(termButton('commit'));
    count.appendChild(ct);
    now.appendChild(count);

    if (g.diffStat && g.diffStat.totals.files) {
      now.appendChild(el('p', 'muted',
        'Всего по диффу: +' + g.diffStat.totals.added + ' −' + g.diffStat.totals.removed +
        ' в ' + withPlural(g.diffStat.totals.files, 'файле', 'файлах', 'файлах') + '.'));
    }

    if (g.entries.length) {
      var ul = el('ul', 'gitfiles');
      g.entries.slice(0, 60).forEach(function (entry) {
        var li = el('li', 'gitfile');
        li.title = entry.explain;
        var tagClass = 'gitfile__tag';
        if (entry.untracked) tagClass += ' gitfile__tag--new';
        else if (entry.index === 'D' || entry.work === 'D') tagClass += ' gitfile__tag--del';
        else if (entry.conflicted) tagClass += ' gitfile__tag--conf';
        li.appendChild(el('span', tagClass, entry.label));
        li.appendChild(el('span', 'gitfile__path', entry.path));
        li.addEventListener('click', function () { openFileCard(entry.path); });
        ul.appendChild(li);
      });
      now.appendChild(ul);
    }

    if (!g.commits.length) {
      hist.appendChild(el('p', 'muted', 'Коммитов пока нет — история начнётся с первого сохранения.'));
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

    // Значок на вкладке git, если появились новые несохранённые правки.
    if (isNarrow() && app.view !== 'git' && prevDirty !== null &&
        g.summary.total > prevDirty) {
      app.unseen.git += g.summary.total - prevDirty;
      renderBadges();
    }
  }

  function openCommit(c) {
    var body = openSheet('📌 ' + c.subject);
    facts(body, [
      ['Идентификатор', c.short],
      ['Автор', c.author],
      ['Когда', dateTime(c.ts)],
      ['Тип', c.merge ? 'объединение веток' : 'обычное сохранение']
    ]);
    body.appendChild(el('p', 'card__what', c.explain || ''));
    var sec = section(body, 'Что вошло в это сохранение');
    sec.appendChild(el('p', 'muted', 'Загружаем…'));
    api('/api/git/commit', null, { sha: c.hash }).then(function (d) {
      clear(sec);
      sec.appendChild(el('h4', 'sec__title', 'Что вошло в это сохранение'));
      if (d.error) return sec.appendChild(el('p', 'muted', d.error));
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
    }).catch(function () { /* словарь не критичен для показа ленты */ });
  }

  function termButton(id) {
    var b = el('button', 'term', '?');
    b.dataset.term = id;
    b.setAttribute('aria-label', 'Что это значит');
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
    var body = openSheet('📚 Словарь новичка');
    var search = el('input', 'input gl__search');
    search.type = 'search';
    search.placeholder = 'Найти термин…';
    search.setAttribute('enterkeyhint', 'search');
    body.appendChild(search);

    body.appendChild(el('p', 'gl__count', 'Терминов в словаре: ' + glossary.terms.length + '.'));
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
      if (!items.length) { list.appendChild(el('p', 'muted', 'Такого слова в словаре пока нет.')); return; }
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

  function openSheet(title) {
    setSheetTitle(title);
    clear(sheetBody);
    sheet.hidden = false;
    sheetBody.scrollTop = 0;
    return sheetBody;
  }
  function setSheetTitle(t) { $('sheetTitle').textContent = t; }
  function closeSheet() {
    sheet.hidden = true;
    app.selectedFile = null;
    Array.prototype.forEach.call(document.querySelectorAll('.node.is-selected'), function (n) {
      n.classList.remove('is-selected');
    });
  }

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

  // --- экран «Подключение» ---------------------------------------------------

  function openConnect() {
    var body = openSheet('📱 Открыть на телефоне');
    body.appendChild(el('p', 'muted', 'Смотрим сеть…'));

    api('/api/connect').then(function (info) {
      clear(body);
      var box = el('div', 'conn');
      body.appendChild(box);
      box.appendChild(el('p', 'conn__explain', info.explain));

      if (!info.enabled) {
        var off = el('div', 'conn__off');
        off.appendChild(document.createTextNode(
          'Включить можно прямо отсюда — перезапускать Штурман не нужно. ' +
          'Или запустить его сразу с флагом:'));
        off.appendChild(el('code', 'conn__cmd', 'shturman --share'));
        box.appendChild(off);

        var on = el('button', 'btn btn--primary', '📱 Включить доступ с телефона');
        on.style.marginTop = '14px';
        on.addEventListener('click', function () {
          on.disabled = true;
          on.textContent = 'Включаем…';
          api('/api/connect/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true })
          }).then(function (r) {
            if (r.error) {
              on.disabled = false;
              on.textContent = '📱 Включить доступ с телефона';
              box.appendChild(el('p', 'muted', r.error));
              return;
            }
            openConnect();
          }).catch(function (e) {
            on.disabled = false;
            on.textContent = '📱 Включить доступ с телефона';
            box.appendChild(el('p', 'muted', 'Не получилось: ' + e.message));
          });
        });
        box.appendChild(on);
        return;
      }

      if (!info.hasNetwork) {
        box.appendChild(el('div', 'conn__off',
          'Компьютер не подключён к локальной сети — открыть панель с телефона ' +
          'не получится. Проверьте Wi-Fi или кабель.'));
        return;
      }

      var img = el('img', 'conn__qr');
      img.src = href('/api/connect/qr.svg', { _: Date.now() });
      img.alt = 'QR-код со ссылкой на панель';
      box.appendChild(img);
      box.appendChild(el('p', 'muted', 'Наведите камеру телефона на код — панель откроется сама.'));
      box.appendChild(el('div', 'conn__url', info.url));

      if (info.addresses.length > 1) {
        var sec = section(body, 'Если первый адрес не открылся');
        info.addresses.slice(1).forEach(function (a) {
          var row = el('div', 'conn__addr');
          row.appendChild(el('span', 'conn__addr-ip', a.address));
          row.appendChild(el('span', 'conn__addr-label', a.label));
          sec.appendChild(row);
        });
      }

      // Кто сейчас смотрит + сброс ключа.
      var devSec = section(body, 'Кто сейчас смотрит панель');
      renderDevices(devSec, info.devices, info.rejected);

      var reset = el('button', 'btn', '🔑 Сбросить ключ доступа');
      reset.addEventListener('click', function () {
        reset.disabled = true;
        reset.textContent = 'Сбрасываем…';
        api('/api/connect/rotate', { method: 'POST' }).then(function () {
          openConnect();
        });
      });
      var resetSec = section(body, 'Отозвать доступ');
      resetSec.appendChild(el('p', 'muted',
        'Сбросить ключ — все выданные ссылки перестанут работать, а QR-код ' +
        'нужно будет отсканировать заново. Пригодится, если ссылка попала не туда. ' +
        'Выключить доступ — панель снова станет видна только на этом компьютере.'));
      resetSec.appendChild(reset);

      var offBtn = el('button', 'btn', '🔒 Выключить доступ по сети');
      offBtn.style.marginLeft = '8px';
      offBtn.addEventListener('click', function () {
        offBtn.disabled = true;
        offBtn.textContent = 'Выключаем…';
        api('/api/connect/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false })
        }).then(function () { openConnect(); })
          .catch(function () { openConnect(); });
      });
      resetSec.appendChild(offBtn);
    }).catch(function (e) {
      clear(body);
      body.appendChild(el('p', 'muted', 'Не получилось: ' + e.message));
    });
  }

  function renderDevices(parent, devices, rejected) {
    if (!devices || !devices.length) {
      parent.appendChild(el('p', 'muted', 'Пока никто не подключался.'));
    } else {
      devices.forEach(function (d) {
        var row = el('div', 'device');
        var what = el('div');
        what.appendChild(el('div', 'device__what',
          d.shortAgent + (d.loopback ? ' (этот компьютер)' : '')));
        what.appendChild(el('div', 'device__ip', d.ip));
        row.appendChild(what);
        row.appendChild(el('span', 'device__when', duration(Date.now() - d.lastSeen) + ' назад'));
        parent.appendChild(row);
      });
    }
    if (rejected) {
      parent.appendChild(el('p', 'muted',
        'Отклонено обращений без ключа: ' + rejected + '. Это нормально — так и должно быть.'));
    }
  }

  // --- настройки --------------------------------------------------------------

  function openSettings() {
    var body = openSheet('⚙️ Настройки');

    body.appendChild(settingRow('Звуковой сигнал',
      'Короткий сигнал, когда Клод остановился и ждёт вас.',
      app.sound, function (v) { app.sound = v; store.set('sound', v); saveServerSettings({ sound: v }); }));

    body.appendChild(settingRow('Уведомления браузера',
      'Всплывающее уведомление системы — видно, даже если вкладка свёрнута.',
      app.notify, function (v) {
        app.notify = v;
        store.set('notify', v);
        saveServerSettings({ notify: v });
        if (v && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }));

    // Тема
    var themeRow = el('div', 'set__row');
    var tl = el('div', 'set__label');
    tl.appendChild(el('b', null, 'Тема оформления'));
    tl.appendChild(el('span', null, 'По умолчанию — как в системе.'));
    themeRow.appendChild(tl);
    var themeSeg = el('div', 'seg seg--sm set__control');
    [['auto', 'Как в системе'], ['dark', 'Тёмная'], ['light', 'Светлая']].forEach(function (pair) {
      var b = el('button', 'seg__btn' + (app.theme === pair[0] ? ' is-active' : ''), pair[1]);
      b.addEventListener('click', function () {
        applyTheme(pair[0]);
        saveServerSettings({ theme: pair[0] });
        Array.prototype.forEach.call(themeSeg.children, function (c) {
          c.classList.toggle('is-active', c === b);
        });
      });
      themeSeg.appendChild(b);
    });
    themeRow.appendChild(themeSeg);
    body.appendChild(themeRow);

    // Режим ленты
    var modeRow = el('div', 'set__row');
    var ml = el('div', 'set__label');
    ml.appendChild(el('b', null, 'Режим ленты'));
    ml.appendChild(el('span', null, 'В подробном режиме под каждым событием видны сырые данные.'));
    modeRow.appendChild(ml);
    var modeSeg = el('div', 'seg seg--sm set__control');
    [['simple', 'Просто'], ['detailed', 'Подробно']].forEach(function (pair) {
      var b = el('button', 'seg__btn' + ((app.detailed ? 'detailed' : 'simple') === pair[0] ? ' is-active' : ''), pair[1]);
      b.addEventListener('click', function () {
        setDetailed(pair[0] === 'detailed');
        saveServerSettings({ feedMode: pair[0] });
        Array.prototype.forEach.call(modeSeg.children, function (c) {
          c.classList.toggle('is-active', c === b);
        });
      });
      modeSeg.appendChild(b);
    });
    modeRow.appendChild(modeSeg);
    body.appendChild(modeRow);

    // Порог тишины
    var idleRow = el('div', 'set__row');
    var lbl = el('div', 'set__label');
    lbl.appendChild(el('b', null, 'Через сколько тишины считать, что Клод ждёт'));
    lbl.appendChild(el('span', null, 'Сейчас: ' + (app.state ? app.state.idleSeconds : 45) + ' с. ' +
      'Слишком мало — сигнал будет срабатывать между шагами Клода.'));
    idleRow.appendChild(lbl);
    var input = el('input', 'input set__control');
    input.type = 'number';
    input.min = '5';
    input.max = '600';
    input.style.width = '96px';
    input.value = app.state ? app.state.idleSeconds : 45;
    input.addEventListener('change', function () {
      api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idleSeconds: Number(input.value) })
      }).then(renderState);
    });
    idleRow.appendChild(input);
    body.appendChild(idleRow);

    // Доступ по сети
    var shareRow = el('div', 'set__row');
    var sl = el('div', 'set__label');
    sl.appendChild(el('b', null, 'Доступ с телефона'));
    sl.appendChild(el('span', null, app.state && app.state.share
      ? 'Включён. Панель видна в вашей локальной сети — только по ссылке с ключом.'
      : 'Выключен. Панель открывается только на этом компьютере.'));
    shareRow.appendChild(sl);
    var shareBtn = el('button', 'btn set__control', 'Открыть экран');
    shareBtn.addEventListener('click', openConnect);
    shareRow.appendChild(shareBtn);
    body.appendChild(shareRow);

    // Справка
    var info = el('div', 'set__row');
    var il = el('div', 'set__label');
    il.appendChild(el('b', null, '«Спроси Клода»'));
    il.appendChild(el('span', null, app.state && app.state.askEnabled
      ? (app.state.askAvailable
        ? 'Включена. Кнопка появляется в карточке события. Расходует ваши лимиты.'
        : 'Включена флагом --ask, но команда claude не найдена в PATH.')
      : 'Выключена. Чтобы включить, перезапустите Штурман с флагом --ask.'));
    info.appendChild(il);
    body.appendChild(info);

    var about = el('div', 'set__row');
    var al = el('div', 'set__label');
    al.appendChild(el('b', null, 'О наблюдении'));
    al.appendChild(el('span', null, app.state
      ? 'Уровень ' + app.state.level +
        ' · файлы: ' + (app.state.watchMode === 'native' ? 'системное наблюдение' : 'периодический опрос') +
        ' · Node ' + app.state.node + ' · Штурман ' + app.state.version
      : ''));
    about.appendChild(al);
    body.appendChild(about);

    var keys = el('div', 'set__row');
    var kl = el('div', 'set__label');
    kl.appendChild(el('b', null, 'Горячие клавиши'));
    kl.appendChild(el('span', null, '1–4 — вкладки · / — поиск · m — звук · t — тема · Esc — закрыть'));
    keys.appendChild(kl);
    body.appendChild(keys);
  }

  function settingRow(title, text, value, onChange) {
    var row = el('div', 'set__row');
    var lbl = el('div', 'set__label');
    lbl.appendChild(el('b', null, title));
    lbl.appendChild(el('span', null, text));
    row.appendChild(lbl);
    var btn = el('button', 'btn set__control' + (value ? ' is-on' : ''), value ? 'Включено' : 'Выключено');
    btn.addEventListener('click', function () {
      value = !value;
      btn.textContent = value ? 'Включено' : 'Выключено';
      btn.classList.toggle('is-on', value);
      onChange(value);
    });
    row.appendChild(btn);
    return row;
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

  // --- дайджест ---------------------------------------------------------------

  function openDigest() {
    var body = openSheet('📄 Что мы сегодня сделали');
    body.appendChild(el('p', 'muted', 'Собираем дайджест…'));
    api('/api/digest').then(function (d) {
      clear(body);
      var actions = el('div', 'set__row');
      var dl = el('button', 'btn btn--primary', '⬇ Скачать .md');
      dl.addEventListener('click', function () {
        window.location.href = href('/api/digest', { download: 1 });
      });
      actions.appendChild(dl);

      // На телефоне — системное меню «Поделиться».
      if (navigator.share) {
        var sh = el('button', 'btn', '📤 Поделиться');
        sh.addEventListener('click', function () {
          navigator.share({ title: 'Итоги сессии — Штурман', text: d.markdown })
            .catch(function () { /* передумали — не беда */ });
        });
        actions.appendChild(sh);
      }
      if (navigator.clipboard) {
        var copy = el('button', 'btn', '📋 Скопировать');
        copy.addEventListener('click', function () {
          navigator.clipboard.writeText(d.markdown).then(function () {
            copy.textContent = '✓ Скопировано';
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
      ? '↑ ' + fmtNum(p.tokens.input + p.tokens.cacheCreate) +
        '  ↓ ' + fmtNum(p.tokens.output) + '  (кеш ' + fmtNum(p.tokens.cacheRead) + ')'
      : 'нет данных в транскрипте';

    renderStateChip(p.detector);
    renderAttention(p.recentFiles || []);
    renderAttentionGraph(p.attention);
  }

  function renderStateChip(d) {
    var dot = $('stateDot');
    var text = $('stateText');
    if (!d) return;
    dot.className = 'chip__dot';
    document.body.classList.toggle('is-waiting', d.state === 'waiting');
    if (d.state === 'working') {
      dot.classList.add('chip__dot--live');
      if (!reduceMotion) dot.classList.add('chip__dot--pulse');
      text.textContent = 'Клод работает';
    } else if (d.state === 'waiting') {
      dot.classList.add('chip__dot--warn');
      text.textContent = 'ждёт вас · ' + duration(d.quietMs);
    } else if (d.state === 'ended') {
      dot.classList.add('chip__dot--error');
      text.textContent = 'сессия затихла';
    } else {
      text.textContent = 'ждём действий';
    }
  }

  function renderAttention(recent) {
    var box = $('attentionMap');
    clear(box);
    if (!recent.length) {
      box.appendChild(el('p', 'muted', 'Пока никуда — ждём первых чтений и правок.'));
      return;
    }
    var now = Date.now();
    recent.forEach(function (r) {
      var age = Math.min(1, (now - r.ts) / 300000);
      var chip = el('span', 'att att--' + r.action);
      chip.style.setProperty('--fresh', (1 - age).toFixed(2));
      chip.appendChild(el('span', null, r.action === 'edit' ? '📝' : '📖'));
      chip.appendChild(el('span', null, r.file.split('/').pop()));
      chip.title = r.file + ' · ' + (r.action === 'edit' ? 'правил' : 'читал');
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
    var root = svg('svg', { class: 'attgraph', viewBox: '0 0 ' + W + ' ' + H });

    if (!att || att.empty || !att.nodes.length) {
      root.appendChild(Object.assign(
        svg('text', { class: 'attgraph__empty', x: W / 2, y: H / 2 }),
        { textContent: 'Пока никуда — ждём первых чтений и правок.' }));
      box.appendChild(root);
      return;
    }

    var cx = W / 2;
    var cy = H / 2;
    var rx = Math.max(70, W / 2 - 58);
    var ry = Math.max(48, H / 2 - 34);
    var pos = {};

    att.nodes.forEach(function (n, i) {
      if (i === 0) { pos[n.file] = { x: cx, y: cy, r: 11 }; return; }
      var count = att.nodes.length - 1;
      var angle = ((i - 1) / count) * Math.PI * 2 - Math.PI / 2 + 0.35;
      pos[n.file] = {
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
        r: 6 + Math.min(4, n.touches)
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
      g.appendChild(Object.assign(
        svg('text', { class: 'attgraph__glyph', x: p.x.toFixed(1), y: (p.y + 3.5).toFixed(1) }),
        { textContent: n.kind === 'edit' ? '✎' : '👁' }));
      g.appendChild(Object.assign(
        svg('text', { class: 'attgraph__label', x: p.x.toFixed(1), y: (p.y + p.r + 12).toFixed(1) }),
        { textContent: n.name.length > 16 ? n.name.slice(0, 15) + '…' : n.name }));

      var title = svg('title');
      title.textContent = n.file + '\n' +
        withPlural(n.reads, 'чтение', 'чтения', 'чтений') + ', ' +
        withPlural(n.edits, 'правка', 'правки', 'правок') + '\n' +
        'последний раз ' + duration(n.ageMs) + ' назад';
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

  // ── 11. Сигнал «Клод остановился» ─────────────────────────────────────────

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
      var n = new Notification('Штурман: ' + title, {
        body: text, tag: 'shturman-attention',
        icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
        vibrate: [120, 60, 120]
      });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) {
      // На Android уведомления создаются только через service worker.
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          reg.showNotification('Штурман: ' + title, {
            body: text, tag: 'shturman-attention',
            icon: '/icons/icon-192.png', vibrate: [120, 60, 120]
          }).catch(function () { /* и так бывает */ });
        });
      }
    }
  }

  function raiseAlarm(data) {
    $('alarmTitle').textContent = data.title || 'Клод остановился и ждёт вас';
    $('alarmText').textContent = data.text || '';
    $('alarm').hidden = false;
    beep();
    browserNotify(data.title || 'Клод ждёт вас', data.text || '');
    // Заголовок вкладки и вибрация — сигнал должен дойти и в фоне.
    document.title = '🔔 Клод ждёт — Штурман';
    if (navigator.vibrate) { try { navigator.vibrate([120, 60, 120]); } catch (e) { /* не все умеют */ } }
    setBadge(1);
  }

  function clearAlarm() {
    $('alarm').hidden = true;
    document.title = 'Штурман — что сейчас делает Клод';
    setBadge(0);
  }

  // Бейдж на иконке установленного приложения.
  function setBadge(n) {
    try {
      if (n && navigator.setAppBadge) navigator.setAppBadge(n);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) { /* поддерживают не все */ }
  }

  $('alarmOk').addEventListener('click', clearAlarm);

  $('btnBell').addEventListener('click', function () {
    // Клик — тот самый «жест пользователя», после которого браузер
    // разрешает звук и позволяет спросить про уведомления.
    beep();
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    raiseAlarm({
      title: 'Так выглядит сигнал',
      text: 'Именно это вы увидите и услышите, когда Клод остановится и будет ждать ответа.'
    });
    setTimeout(clearAlarm, 4000);
  });

  // ── 12. Журнал сессий ─────────────────────────────────────────────────────

  function loadSessions() {
    var box = $('sessions');
    return api('/api/sessions').then(function (data) {
      clear(box);
      if (data.note || !data.sessions.length) {
        box.appendChild(el('p', 'muted', data.note || 'Прошлых сессий пока нет — эта первая.'));
        return;
      }
      data.sessions.forEach(function (s) {
        var item = el('div', 'session' + (s.id === data.active ? ' is-active' : ''));
        var top = el('div', 'session__top');
        top.appendChild(el('span', 'session__when', dateTime(s.startedAt)));
        if (s.id === data.active) top.appendChild(el('span', 'session__badge', 'сейчас'));
        item.appendChild(top);
        if (s.firstPrompt) item.appendChild(el('div', 'session__prompt', s.firstPrompt));
        item.appendChild(el('div', 'session__meta',
          (s.branch ? s.branch + ' · ' : '') + duration(s.durationMs) + ' · ' + bytes(s.size)));
        item.addEventListener('click', function () { openArchive(s); });
        box.appendChild(item);
      });
    }).catch(function () {
      clear(box);
      box.appendChild(el('p', 'muted', 'Журнал сессий недоступен.'));
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
    notice('Показана прошлая сессия от ' + dateTime(s.startedAt) + ' (' +
      withPlural(data.events.length, 'событие', 'события', 'событий') +
      '). Нажмите «Вернуться», чтобы продолжить наблюдение.', 'archive');
    var bar = $('notice');
    if (!bar.querySelector('.btn')) {
      var back = el('button', 'btn btn--sm', 'Вернуться');
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
    $('noticeIcon').textContent = kind === 'archive' ? '🕰' : '⚠️';
    var stale = bar.querySelector('.btn');
    if (stale && kind !== 'archive') bar.removeChild(stale);
    bar.hidden = false;
  }

  function hideNotice() {
    var bar = $('notice');
    bar.hidden = true;
    var stale = bar.querySelector('.btn');
    if (stale) bar.removeChild(stale);
  }

  $('noticeClose').addEventListener('click', function () {
    if (app.archive) exitArchive(); else hideNotice();
  });

  function renderState(s) {
    app.state = s;
    $('projectName').textContent = s.projectName;
    $('projectPath').textContent = s.project;
    if (s.projectKey) app.projectKey = s.projectKey;
    if (s.projects) renderSwitcher(s.projects, s.projectKey);

    var dot = $('levelDot');
    dot.className = 'chip__dot';
    if (s.level === 'A') {
      dot.classList.add('chip__dot--ok');
      $('levelText').textContent = 'уровень A · видно всё';
      $('levelChip').title = 'Штурман читает транскрипт Claude Code: видны чтения, правки и команды.';
    } else {
      dot.classList.add('chip__dot--warn');
      $('levelText').textContent = 'уровень B · файлы и git';
      $('levelChip').title = (s.levelReason || '') +
        '. Панель работает, но действия Клода в ленту не попадают.';
    }

    // Кнопка «Подключение» полезна всегда: без share она объясняет, как включить.
    $('btnConnect').classList.toggle('is-on', !!s.share);

    if (s.projectCheck && !s.projectCheck.isProject && s.projectCheck.reason && !app.archive) {
      notice(s.projectCheck.reason);
    }

    $('feedEmptyText').textContent = s.level === 'A'
      ? 'Штурман подключился к сессии Клода и ждёт первых действий. Всё, что он сделает, появится здесь.'
      : 'Транскрипты Claude Code не найдены, поэтому лента показывает только изменения файлов и git. ' +
        'Убедитесь, что Claude Code запущен в той же папке: ' + s.project;
  }

  function renderSwitcher(list, activeKey) {
    app.projects = list;
    var box = $('switcher');
    if (!list || list.length < 2) { box.hidden = true; return; }
    box.hidden = false;
    var chips = $('switcherChips');
    clear(chips);
    list.forEach(function (p) {
      var btn = el('button', 'pchip' + (p.key === activeKey ? ' is-active' : ''));
      btn.title = p.path + (p.branch ? ' · ветка ' + p.branch : '') + ' · уровень ' + p.level;
      if (p.waiting && p.key !== activeKey) btn.appendChild(el('span', 'pchip__flag'));
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
  var reconnectTimer = null;

  function connect() {
    if (source) { source.close(); source = null; }
    source = new EventSource(href('/api/stream'));

    source.addEventListener('snapshot', function (e) {
      var data = JSON.parse(e.data);
      renderState(data.state);
      if (data.git) renderGit(data.git);
      if (data.pulse) renderPulse(data.pulse);
      app.events = [];
      (data.events || []).forEach(function (ev) {
        app.events.push(ev);
        if (ev.file) app.heat[ev.file] = ev.ts;
      });
      if (!app.archive) rebuildFeed();
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
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };

    source.onerror = function () {
      $('levelText').textContent = 'связь потеряна…';
      $('levelDot').className = 'chip__dot chip__dot--error';
      $('stateText').textContent = 'нет связи с Штурманом';
      $('stateDot').className = 'chip__dot chip__dot--error';
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
        sleepTimer = setTimeout(function () {
          disconnect();
          sleepTimer = null;
        }, 60000);
      } else {
        if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
        if (!source) connect();
        // Пока спали, могло произойти что угодно — обновляем срез.
        api('/api/pulse').then(renderPulse).catch(function () { /* переподключимся */ });
      }
    });
  })();

  // ── 15. Управление, горячие клавиши, тур, старт ───────────────────────────

  $('modeSimple').addEventListener('click', function () { setDetailed(false); });
  $('modeDetail').addEventListener('click', function () { setDetailed(true); });

  function setDetailed(v) {
    app.detailed = v;
    store.set('detailed', v);
    $('modeSimple').classList.toggle('is-active', !v);
    $('modeDetail').classList.toggle('is-active', v);
    ROW_H = v ? 190 : 74;              // в подробном режиме карточки выше
    drawnKey = '';
    rebuildFeed();
  }

  $('btnPause').addEventListener('click', function () { togglePause(); });
  $('btnResume').addEventListener('click', function () { togglePause(false); });

  function togglePause(force) {
    app.paused = force === undefined ? !app.paused : force;
    $('btnPause').innerHTML = '';
    $('btnPause').appendChild(document.createTextNode(app.paused ? '▶' : '⏸'));
    $('btnPause').appendChild(el('span', 'btn__label', app.paused ? ' Продолжить' : ' Пауза'));
    $('btnPause').classList.toggle('is-on', app.paused);
    $('feedPaused').hidden = !app.paused;
    if (!app.paused) flushQueue();
  }

  function flushQueue() {
    app.queued.forEach(function (ev) { app.events.push(ev); });
    app.queued = [];
    $('pausedCount').textContent = '0';
    rebuildFeed();
  }

  $('feedFilters').addEventListener('click', function (e) {
    var chip = e.target.closest('.fchip');
    if (!chip) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('is-active'); });
    chip.classList.add('is-active');
    app.filter = chip.dataset.filter;
    rebuildFeed();
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
  // Список строится из них же, поэтому разойтись они не могут.
  $('btnMore').addEventListener('click', function () {
    var body = openSheet('⋯ Ещё');
    [
      ['📱', 'Открыть на телефоне', 'QR-код и ссылка для другого устройства', openConnect],
      ['📚', 'Словарь', glossary.terms.length + ' терминов простыми словами', openGlossary],
      ['📄', 'Итоги сессии', 'Дневник в markdown: что просили, что менялось', openDigest],
      ['🌗', 'Тема оформления', 'Сейчас: ' + ({ auto: 'как в системе', dark: 'тёмная', light: 'светлая' })[app.theme],
        function () {
          var order = ['auto', 'dark', 'light'];
          applyTheme(order[(order.indexOf(app.theme) + 1) % order.length]);
          closeSheet();
        }],
      ['🎓', 'Тур по панели', 'Пять шагов: что где смотреть', function () { closeSheet(); startTour(); }],
      ['⚙️', 'Настройки', 'Звук, уведомления, тема, порог сигнала', openSettings]
    ].forEach(function (item) {
      var row = el('div', 'set__row');
      var lbl = el('div', 'set__label');
      lbl.appendChild(el('b', null, item[0] + '  ' + item[1]));
      lbl.appendChild(el('span', null, item[2]));
      row.appendChild(lbl);
      row.style.cursor = 'pointer';
      row.addEventListener('click', item[3]);
      body.appendChild(row);
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-gittab]'), function (btn) {
    btn.addEventListener('click', function () {
      app.gitTab = btn.dataset.gittab;
      Array.prototype.forEach.call(document.querySelectorAll('[data-gittab]'), function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      $('gitNow').hidden = app.gitTab !== 'now';
      $('gitHistory').hidden = app.gitTab !== 'history';
    });
  });

  // Горячие клавиши. Не срабатывают при вводе в поле — иначе «/» нельзя
  // было бы напечатать в поиске.
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
    } else if (e.key === 'm' || e.key === 'ь') {
      app.sound = !app.sound;
      store.set('sound', app.sound);
      notice(app.sound ? 'Звуковой сигнал включён.' : 'Звуковой сигнал выключен.');
      setTimeout(hideNotice, 1800);
    } else if (e.key === 't' || e.key === 'е') {
      var order = ['auto', 'dark', 'light'];
      applyTheme(order[(order.indexOf(app.theme) + 1) % order.length]);
    } else if (e.key === 'p' || e.key === 'з') {
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
      var feedPanel = $('panelFeed');
      var r = feedPanel.getBoundingClientRect();
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

  var TOUR = [
    {
      target: function () { return isNarrow() ? $('tabbar') : $('panelFeed'); },
      title: 'Лента «Что происходит»',
      text: 'Здесь по-русски описано каждое действие Клода: что он прочитал, что изменил, ' +
        'какую команду запустил и чем она закончилась. Нажмите на любую строку — откроются ' +
        'подробности: дифф, вывод команды, сырые данные. ' +
        'На телефоне разделы переключаются вкладками внизу или свайпом.'
    },
    {
      target: function () { return isNarrow() ? $('tabbar') : $('panelTree'); },
      title: 'Карта проекта',
      text: 'Живое дерево файлов. Только что изменённые подсвечиваются, и подсветка постепенно ' +
        'гаснет — так видно, где кипит работа. Клик по файлу открывает карточку: что это за файл ' +
        'простыми словами, размер и последние изменения.'
    },
    {
      target: function () { return isNarrow() ? $('tabbar') : $('panelGit'); },
      title: 'Git без страха',
      text: 'Текущая ветка и её смысл, счётчик несохранённых изменений и история как линия ' +
        'времени. Значки «?» рядом с терминами открывают объяснение — в словаре больше ' +
        'тридцати слов.'
    },
    {
      target: function () { return $('btnConnect'); },
      title: 'Смотреть с телефона',
      text: 'Если запустить Штурман командой «shturman --share», эта кнопка покажет QR-код. ' +
        'Наводите камеру телефона — панель откроется там же, со всеми разделами. ' +
        'Ссылка содержит ключ доступа, без него никто посторонний не войдёт.'
    },
    {
      target: function () { return $('btnBell'); },
      title: 'Главное: сигнал «Клод ждёт»',
      text: 'Когда Клод остановится и будет ждать вашего ответа, Штурман подаст звуковой сигнал ' +
        'и покажет уведомление — можно спокойно уйти за чаем. Нажмите эту кнопку сейчас, чтобы ' +
        'разрешить звук и уведомления: браузер требует вашего явного действия.'
    }
  ];

  var tourStep = 0;

  function startTour() {
    tourStep = 0;
    $('tour').hidden = false;
    drawTour();
  }

  function drawTour() {
    var step = TOUR[tourStep];
    var target = typeof step.target === 'function' ? step.target() : document.querySelector(step.target);
    $('tourStep').textContent = 'Шаг ' + (tourStep + 1) + ' из ' + TOUR.length;
    $('tourTitle').textContent = step.title;
    $('tourText').textContent = step.text;
    $('tourPrev').disabled = tourStep === 0;
    $('tourNext').textContent = tourStep === TOUR.length - 1 ? 'Готово' : 'Дальше';

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
      // На телефоне карточка ставится над или под подсвеченным местом.
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
    if (tourStep === TOUR.length - 1) { endTour(); return; }
    tourStep++;
    drawTour();
  });
  $('tourPrev').addEventListener('click', function () {
    if (tourStep > 0) { tourStep--; drawTour(); }
  });
  $('tourSkip').addEventListener('click', endTour);
  $('btnTour').addEventListener('click', startTour);
  window.addEventListener('resize', function () { if (!$('tour').hidden) drawTour(); });

  // --- PWA ---------------------------------------------------------------------

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        // Без service worker панель работает как обычная страница.
      });
    });
  }

  // --- старт -------------------------------------------------------------------

  applyTheme(app.theme);
  setDetailed(app.detailed);
  togglePause(false);
  setView(store.get('view', 'feed'));

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
      if (!store.get('tourDone', false)) setTimeout(startTour, 800);
    });

  setInterval(loadSessions, 60000);
})();
