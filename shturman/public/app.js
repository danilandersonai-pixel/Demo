/* ===========================================================================
   Штурман — клиентская часть.
   Ванильный JS, без сборки и без библиотек. Один IIFE, разделённый
   комментарными блоками по назначению.
   =========================================================================== */
(function () {
  'use strict';

  // ── 0. Мелкие помощники ───────────────────────────────────────────────────

  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

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
  // подставляет выбранный проект, чтобы переключатель работал сам собой.
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
    return fetch(href(pathStr, params), options).then(function (r) {
      if (!r.ok && r.status >= 500) throw new Error('Сервер ответил ошибкой ' + r.status);
      return r.json();
    });
  }

  // Настройки живут в localStorage: сервер о них ничего не знает и
  // ничего не пишет на диск пользователя.
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

  // ── 1. Состояние страницы ─────────────────────────────────────────────────

  var app = {
    state: null,
    git: null,
    pulse: null,
    events: [],              // всё, что пришло (до 800 карточек в памяти)
    queued: [],              // накопленное, пока лента на паузе
    paused: false,
    detailed: store.get('detailed', false),
    filter: 'all',
    query: '',
    treeNodes: [],
    treeQuery: '',
    collapsed: {},           // свёрнутые папки
    heat: {},                // path -> timestamp последнего изменения
    selectedFile: null,
    gitTab: 'now',
    archive: null,           // открытая архивная сессия
    projectKey: null,        // выбранный проект (когда их несколько)
    projects: [],
    sound: store.get('sound', true),
    notify: store.get('notify', true)
  };

  var MAX_EVENTS = 800;
  var HEAT_MS = 90000;       // тепловой след гаснет за полторы минуты

  // ── 2. Лента ──────────────────────────────────────────────────────────────

  var feed = $('feed');
  var feedEmpty = $('feedEmpty');

  // Соответствие «кнопка фильтра → какие события пропускать».
  var FILTERS = {
    all: function () { return true; },
    edit: function (e) { return e.kind === 'tool' && (e.action === 'edit' || e.action === 'write'); },
    read: function (e) { return e.kind === 'tool' && e.action === 'read'; },
    run: function (e) { return e.kind === 'tool' && e.action === 'run'; },
    search: function (e) { return e.kind === 'tool' && e.action === 'search'; },
    error: function (e) { return e.level === 'error' || e.level === 'warn'; },
    talk: function (e) { return e.kind === 'user' || e.kind === 'assistant'; },
    git: function (e) { return e.kind === 'git' || e.kind === 'file'; }
  };

  function matches(ev) {
    var f = FILTERS[app.filter] || FILTERS.all;
    if (!f(ev)) return false;
    if (!app.query) return true;
    var hay = [ev.title, ev.hint, ev.file, ev.command, ev.text, ev.output]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(app.query) !== -1;
  }

  // Класс-модификатор карточки: чем ярче событие, тем заметнее полоска слева.
  function evClass(ev) {
    var cls = ['ev'];
    if (ev.level === 'error') cls.push('ev--error');
    else if (ev.level === 'warn') cls.push('ev--warn');
    if (ev.kind === 'user') cls.push('ev--user');
    if (ev.kind === 'tool' && (ev.action === 'edit' || ev.action === 'write')) cls.push('ev--edit');
    if (ev.kind === 'tool' && ev.action === 'run') cls.push('ev--run');
    if (ev.kind === 'session' && ev.action === 'idle') cls.push('ev--attention');
    return cls.join(' ');
  }

  function renderEvent(ev, isNew) {
    var li = el('li', evClass(ev) + (isNew && !reduceMotion ? ' is-new' : ''));
    li.dataset.id = ev.id;

    li.appendChild(el('span', 'ev__icon', ev.icon || '•'));
    li.appendChild(el('span', 'ev__title', ev.title || ''));
    li.appendChild(el('span', 'ev__time', clock(ev.ts)));

    if (ev.hint) li.appendChild(el('span', 'ev__hint', ev.hint));

    // Режим «Подробно»: сырые данные прямо в карточке, без похода на сервер.
    if (app.detailed) {
      var raw = el('pre', 'ev__raw', rawText(ev));
      li.appendChild(raw);
    }

    li.addEventListener('click', function () { openEventDetails(ev); });
    return li;
  }

  // Что показывать в подробном режиме: осмысленный срез, а не весь JSON —
  // иначе карточка превращается в простыню.
  function rawText(ev) {
    var out = {
      kind: ev.kind,
      action: ev.action,
      source: ev.source,
      tool: ev.tool || undefined,
      file: ev.file || undefined,
      command: ev.command || undefined,
      pattern: ev.pattern || undefined,
      ok: ev.ok,
      stats: ev.stats || undefined,
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

  function addEvent(ev) {
    app.events.push(ev);
    if (app.events.length > MAX_EVENTS) app.events.splice(0, app.events.length - MAX_EVENTS);

    // Результат инструмента дополняет уже показанную карточку вызова,
    // а не плодит вторую строку — кроме ошибок, их видеть надо отдельно.
    if (ev.kind === 'result' && ev.ok && ev.toolUseId) {
      annotateCall(ev);
      return;
    }

    if (app.paused) {
      app.queued.push(ev);
      $('pausedCount').textContent = app.queued.length;
      return;
    }
    if (!matches(ev)) return;

    var atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;
    feed.appendChild(renderEvent(ev, true));
    trimFeedDom();
    feedEmpty.hidden = feed.childElementCount > 0;
    if (atBottom) feed.scrollTop = feed.scrollHeight;
  }

  // Дописываем статистику правки в карточку вызова, когда пришёл результат.
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

  function trimFeedDom() {
    while (feed.childElementCount > 400) feed.removeChild(feed.firstChild);
  }

  function rebuildFeed() {
    clear(feed);
    var source = app.archive ? app.archive.events : app.events;
    source.filter(function (ev) {
      if (ev.kind === 'result' && ev.ok) return false;   // успехи схлопнуты в вызов
      return matches(ev);
    }).forEach(function (ev) {
      feed.appendChild(renderEvent(ev, false));
    });
    trimFeedDom();
    feedEmpty.hidden = feed.childElementCount > 0;
    feed.scrollTop = feed.scrollHeight;
  }

  // ── 3. Детали события ─────────────────────────────────────────────────────

  var drawer = $('drawer');
  var drawerBody = $('drawerBody');

  function openDrawer(title) {
    $('drawerTitle').textContent = title;
    clear(drawerBody);
    drawer.hidden = false;
    return drawerBody;
  }

  function closeDrawer() {
    drawer.hidden = true;
    app.selectedFile = null;
    Array.prototype.forEach.call(document.querySelectorAll('.node.is-selected'), function (n) {
      n.classList.remove('is-selected');
    });
  }

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
    var body = openDrawer((ev.icon || '') + ' ' + (ev.title || 'Событие'));

    if (ev.hint) {
      var p = el('p', 'card__what', ev.hint);
      body.appendChild(p);
    }

    facts(body, [
      ['Когда', dateTime(ev.ts)],
      ['Источник', sourceRu(ev.source)],
      ['Инструмент', ev.tool || ''],
      ['Файл', ev.file || ''],
      ['Команда', ev.command || ''],
      ['Шаблон поиска', ev.pattern || '']
    ]);

    // Результат вызова: вывод команды или ошибка.
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

    // Дифф по файлу — подгружаем с сервера, если он под git.
    if (ev.file && (ev.action === 'edit' || ev.action === 'write' || ev.kind === 'file')) {
      var sec = section(body, 'Что изменилось в файле');
      var loading = el('p', 'muted', 'Смотрим дифф…');
      sec.appendChild(loading);
      api('/api/git/diff', null, { path: ev.file }).then(function (d) {
        sec.removeChild(loading);
        if (d.error) return sec.appendChild(el('p', 'muted', d.error));
        if (d.note) sec.appendChild(el('p', 'muted', d.note));
        renderDiff(sec, d.diff);
      }).catch(function () {
        loading.textContent = 'Дифф получить не удалось.';
      });
    }

    // Кнопка «Спроси Клода» — только если функция включена при запуске.
    if (app.state && app.state.askEnabled && app.state.askAvailable) {
      addAskButton(body, ev);
    }

    // Сырые данные — внизу, чтобы не мешали, но были под рукой.
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
    sec.appendChild(el('p', 'muted',
      'Вопрос уйдёт в claude -p и израсходует часть ваших лимитов.'));

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

  // ── 4. Дифф ───────────────────────────────────────────────────────────────

  function renderDiff(parent, files) {
    if (!files || !files.length) {
      parent.appendChild(el('p', 'muted', 'Изменений не нашлось.'));
      return;
    }
    files.forEach(function (f) {
      var box = el('div', 'diff');
      var legend = el('div', 'diff__legend');
      legend.appendChild(el('span', null, f.path || ''));
      var addSpan = el('span', null, '');
      addSpan.appendChild(el('b', null, '+' + (f.added || 0)));
      addSpan.appendChild(document.createTextNode(' добавлено'));
      var delSpan = el('span', null, '');
      delSpan.appendChild(el('b', null, '−' + (f.removed || 0)));
      delSpan.appendChild(document.createTextNode(' удалено'));
      legend.appendChild(addSpan);
      legend.appendChild(delSpan);
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
          line.appendChild(el('span', null, l.text));
          box.appendChild(line);
        });
      });
      parent.appendChild(box);
    });
  }

  // ── 5. Карта проекта ──────────────────────────────────────────────────────

  var treeBox = $('tree');

  function loadTree() {
    return api('/api/tree').then(function (t) {
      app.treeNodes = t.nodes || [];
      if (t.truncated) {
        notice('Проект очень большой — карта показывает первые ' +
          app.treeNodes.length + ' элементов.');
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
      // В режиме поиска показываем плоский список — так быстрее находится.
      var found = nodes.filter(function (n) {
        return n.type === 'file' && n.path.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 200);
      if (!found.length) {
        treeBox.appendChild(el('p', 'muted', 'Ничего не нашлось.'));
        return;
      }
      found.forEach(function (n) { treeBox.appendChild(nodeRow(n, true)); });
      return;
    }

    if (!nodes.length) {
      treeBox.appendChild(el('p', 'muted', 'В папке нет файлов, которые стоит показывать.'));
      return;
    }

    // Скрываем содержимое свёрнутых папок.
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
      var caret = el('span', 'node__caret', '▾');
      row.appendChild(caret);
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

  // Тепловой след. Один общий таймер на всё дерево — так дешевле, чем
  // отдельная анимация на каждом узле, и ничего не мигает.
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
    // Файл может быть новым — тогда дерево надо перечитать, но не чаще
    // раза в пару секунд, чтобы шквал изменений не положил панель.
    if (!app.treeNodes.some(function (n) { return n.path === pathStr; })) {
      scheduleTreeReload();
    }
    applyHeat();
  }

  var treeReloadTimer = null;
  function scheduleTreeReload() {
    if (treeReloadTimer) return;
    treeReloadTimer = setTimeout(function () {
      treeReloadTimer = null;
      loadTree();
    }, 1500);
  }

  function openFileCard(pathStr) {
    app.selectedFile = pathStr;
    Array.prototype.forEach.call(treeBox.querySelectorAll('.node'), function (n) {
      n.classList.toggle('is-selected', n.dataset.path === pathStr);
    });

    var body = openDrawer('📄 ' + pathStr);
    body.appendChild(el('p', 'muted', 'Загружаем…'));

    api('/api/file', null, { path: pathStr }).then(function (card) {
      clear(body);
      if (card.error && !card.title) {
        body.appendChild(el('p', 'muted', card.error));
        return;
      }
      $('drawerTitle').textContent = (card.icon || '📄') + ' ' + card.name;

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

  // ── 6. Git ────────────────────────────────────────────────────────────────

  function renderGit(g) {
    app.git = g;
    var now = $('gitNow');
    var hist = $('gitHistory');
    clear(now);
    clear(hist);

    if (!g || !g.available) {
      var msg = el('p', 'muted', (g && g.reason) || 'Git недоступен.');
      now.appendChild(msg);
      now.appendChild(el('p', 'muted',
        'Остальные разделы Штурмана работают как обычно — карта проекта и лента ' +
        'не зависят от git.'));
      hist.appendChild(el('p', 'muted', 'Истории нет: проект не под контролем версий.'));
      return;
    }

    // --- «Сейчас» ---------------------------------------------------------
    var line = el('div', 'gitline');
    line.appendChild(el('span', 'gitline__label', 'Ветка'));
    var b = el('span', 'gitline__value');
    b.appendChild(el('code', 'git__branch', g.branch));
    b.appendChild(termButton('branch'));
    line.appendChild(b);
    now.appendChild(line);
    now.appendChild(el('p', 'git__explain', g.branchExplain || ''));

    if (g.aheadBehind) {
      var ab = el('p', 'muted');
      ab.textContent = 'Относительно ' + g.aheadBehind.upstream + ': ' +
        'у вас на ' + withPlural(g.aheadBehind.ahead, 'коммит', 'коммита', 'коммитов') + ' больше, ' +
        'не забрано ' + withPlural(g.aheadBehind.behind, 'коммит', 'коммита', 'коммитов') + '.';
      now.appendChild(ab);
    }

    var count = el('div', 'git__count');
    var num = el('div', 'git__count-num' + (g.summary.total === 0 ? ' is-clean' : ''), g.summary.total);
    count.appendChild(num);
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

    // --- «История» --------------------------------------------------------
    if (!g.commits.length) {
      hist.appendChild(el('p', 'muted', 'Коммитов пока нет — история начнётся с первого сохранения.'));
    } else {
      var tl = el('ol', 'timeline');
      g.commits.forEach(function (c) {
        var li = el('li', 'tl' + (c.merge ? ' tl--merge' : ''));
        li.appendChild(el('div', 'tl__subject', c.subject));
        li.appendChild(el('div', 'tl__meta',
          c.short + ' · ' + c.author + ' · ' + dateTime(c.ts)));
        li.appendChild(el('div', 'tl__explain', c.explain || ''));
        li.addEventListener('click', function () { openCommit(c); });
        tl.appendChild(li);
      });
      hist.appendChild(tl);
    }
  }

  function openCommit(c) {
    var body = openDrawer('📌 ' + c.subject);
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

  // ── 7. Словарь и подсказки ────────────────────────────────────────────────

  var glossary = { terms: [], byId: {} };

  function loadGlossary() {
    return api('/api/glossary').then(function (g) {
      glossary.terms = g.terms || [];
      glossary.byId = {};
      glossary.terms.forEach(function (t) {
        glossary.byId[t.id] = t;
        (t.aliases || []).forEach(function (a) { glossary.byId[String(a).toLowerCase()] = t; });
      });
    });
  }

  function termButton(id) {
    var b = el('button', 'term', '?');
    b.dataset.term = id;
    b.setAttribute('aria-label', 'Что это значит');
    return b;
  }

  var tip = $('tip');

  // Одно делегирование на весь документ: значки «?» появляются динамически.
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.term');
    if (!t) { tip.hidden = true; return; }
    e.preventDefault();
    e.stopPropagation();
    showTip(t);
  });

  function showTip(button) {
    var term = glossary.byId[button.dataset.term];
    if (!term) {
      tip.hidden = true;
      return;
    }
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
    var body = openModal('📚 Словарь новичка');
    var search = el('input', 'input gl__search');
    search.type = 'search';
    search.placeholder = 'Найти термин…';
    body.appendChild(search);

    var count = el('p', 'gl__count', 'Терминов в словаре: ' + glossary.terms.length + '.');
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
        list.appendChild(el('p', 'muted', 'Такого слова в словаре пока нет.'));
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
    search.focus();
  }

  // ── 8. Модальное окно ─────────────────────────────────────────────────────

  var modal = $('modal');

  function openModal(title) {
    $('modalTitle').textContent = title;
    var body = $('modalBody');
    clear(body);
    modal.hidden = false;
    return body;
  }
  function closeModal() { modal.hidden = true; }

  $('modalClose').addEventListener('click', closeModal);
  $('modalBackdrop').addEventListener('click', closeModal);

  // ── 9. Пульс и «куда смотрит Клод» ────────────────────────────────────────

  function renderPulse(p) {
    app.pulse = p;
    $('pulseFiles').textContent = p.filesTouched;
    $('pulseCommands').textContent = p.commands;
    var errNode = $('pulseErrors');
    errNode.textContent = p.errors;
    errNode.classList.toggle('is-bad', p.errors > 0);
    $('pulseDuration').textContent = duration(p.durationMs);

    if (p.tokens && p.tokens.messages) {
      $('pulseTokens').textContent =
        '↑ ' + fmtNum(p.tokens.input + p.tokens.cacheCreate) +
        '  ↓ ' + fmtNum(p.tokens.output) +
        '  (кеш ' + fmtNum(p.tokens.cacheRead) + ')';
    } else {
      $('pulseTokens').textContent = 'нет данных в транскрипте';
    }

    renderStateChip(p.detector);
    renderAttention(p.recentFiles || []);
  }

  function renderStateChip(d) {
    var dot = $('stateDot');
    var text = $('stateText');
    if (!d) return;
    dot.className = 'chip__dot';
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
      text.textContent = 'ждём первых действий';
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

  // ── 10. Сигнал «Клод остановился» ─────────────────────────────────────────

  var audioCtx = null;

  // Звук генерируем на лету: бинарный файл в проекте без сборки — лишний вес.
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
        gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.18);
      });
    } catch (e) { /* звук — не критичная функция */ }
  }

  function browserNotify(title, text) {
    if (!app.notify) return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try {
        var n = new Notification('Штурман: ' + title, { body: text, tag: 'shturman-attention' });
        n.onclick = function () { window.focus(); n.close(); };
      } catch (e) { /* некоторые браузеры требуют service worker */ }
    }
  }

  function raiseAlarm(data) {
    $('alarmTitle').textContent = data.title || 'Клод остановился и ждёт вас';
    $('alarmText').textContent = data.text || '';
    $('alarm').hidden = false;
    beep();
    browserNotify(data.title || 'Клод ждёт вас', data.text || '');
    // Заголовок вкладки — чтобы сигнал был виден в фоне, даже без уведомлений.
    document.title = '🔔 Клод ждёт — Штурман';
  }

  function clearAlarm() {
    $('alarm').hidden = true;
    document.title = 'Штурман — что сейчас делает Клод';
  }

  $('alarmOk').addEventListener('click', clearAlarm);

  $('btnBell').addEventListener('click', function () {
    // Клик — это тот самый «жест пользователя», после которого браузер
    // разрешает звук и позволяет спросить про уведомления.
    beep();
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    raiseAlarm({
      title: 'Так выглядит сигнал',
      text: 'Именно это вы увидите и услышите, когда Клод остановится и будет ждать вашего ответа.'
    });
    setTimeout(clearAlarm, 4000);
  });

  // ── 11. Журнал сессий ─────────────────────────────────────────────────────

  function loadSessions() {
    var box = $('sessions');
    return api('/api/sessions').then(function (data) {
      clear(box);
      if (data.note || !data.sessions.length) {
        box.appendChild(el('p', 'muted', data.note ||
          'Прошлых сессий пока нет — эта первая.'));
        return;
      }
      data.sessions.forEach(function (s) {
        var item = el('div', 'session' + (s.id === data.active ? ' is-active' : ''));
        var top = el('div', 'session__top');
        top.appendChild(el('span', 'session__when', dateTime(s.startedAt)));
        if (s.id === data.active) top.appendChild(el('span', 'session__badge', 'сейчас'));
        item.appendChild(top);
        if (s.firstPrompt) {
          item.appendChild(el('div', 'session__prompt', s.firstPrompt));
        }
        item.appendChild(el('div', 'session__meta',
          (s.branch ? s.branch + ' · ' : '') +
          duration(s.durationMs) + ' · ' + bytes(s.size)));
        item.addEventListener('click', function () { openArchive(s); });
        box.appendChild(item);
      });
    }).catch(function () {
      clear(box);
      box.appendChild(el('p', 'muted', 'Журнал сессий недоступен.'));
    });
  }

  function openArchive(s) {
    var isCurrent = app.state && s.id === app.state.sessionId;
    if (isCurrent) { exitArchive(); return; }
    api('/api/session/' + encodeURIComponent(s.id)).then(function (data) {
      if (data.error) { notice(data.error); return; }
      app.archive = data;
      rebuildFeed();
      showArchiveBar(s, data);
    });
  }

  function showArchiveBar(s, data) {
    notice('Показана прошлая сессия от ' + dateTime(s.startedAt) + ' (' +
      withPlural(data.events.length, 'событие', 'события', 'событий') +
      '). Нажмите «Вернуться к живой ленте», чтобы продолжить наблюдение.',
      'archive');
    var bar = $('notice');
    if (!bar.querySelector('.btn')) {
      var back = el('button', 'btn btn--sm', 'Вернуться к живой ленте');
      back.addEventListener('click', exitArchive);
      bar.insertBefore(back, $('noticeClose'));
    }
  }

  function exitArchive() {
    app.archive = null;
    hideNotice();
    rebuildFeed();
  }

  // ── 12. Полоса сообщений ──────────────────────────────────────────────────

  function notice(text, kind) {
    var bar = $('notice');
    $('noticeText').textContent = text;
    $('noticeIcon').textContent = kind === 'archive' ? '🕰' : '⚠️';
    // Кнопку «вернуться» из архивного режима убираем, чтобы не залипала.
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
    if (app.archive) exitArchive();
    else hideNotice();
  });

  // ── 13. Состояние подключения ─────────────────────────────────────────────

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

    if (s.projectCheck && !s.projectCheck.isProject && s.projectCheck.reason && !app.archive) {
      notice(s.projectCheck.reason);
    }

    $('feedEmptyText').textContent = s.level === 'A'
      ? 'Штурман подключился к сессии Клода и ждёт первых действий. Всё, что он сделает, появится здесь.'
      : 'Транскрипты Claude Code не найдены, поэтому лента показывает только изменения файлов и git. ' +
        'Убедитесь, что Claude Code запущен в той же папке: ' + s.project;
  }

  // ── 13a. Переключатель проектов ───────────────────────────────────────────

  // Панель показывает переключатель, только если Штурман запущен с
  // несколькими --project. С одним проектом лишний элемент в шапке не нужен.
  function renderSwitcher(list, activeKey) {
    app.projects = list;
    var box = $('switcher');
    if (!list || list.length < 2) { box.hidden = true; return; }
    box.hidden = false;

    var chips = $('switcherChips');
    clear(chips);
    list.forEach(function (p) {
      var btn = el('button', 'pchip' + (p.key === activeKey ? ' is-active' : ''));
      btn.title = p.path + (p.branch ? ' · ветка ' + p.branch : '') +
        ' · уровень ' + p.level;
      // Точка на вкладке чужого проекта: там Клод уже ждёт ответа.
      if (p.waiting && p.key !== activeKey) btn.appendChild(el('span', 'pchip__flag'));
      btn.appendChild(el('span', null, p.name));
      btn.addEventListener('click', function () { switchProject(p.key); });
      chips.appendChild(btn);
    });
  }

  // Переключение — это полная смена контекста: своя лента, своё дерево,
  // свой git. Поэтому всё локальное состояние сбрасывается, а поток
  // переподключается уже к другому проекту.
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
    closeDrawer();
    clear(feed);
    feedEmpty.hidden = false;
    store.set('project', key);
    loadTree();
    loadSessions();
    connect();
  }

  // Список проектов обновляем и сами: на соседней вкладке Клод мог
  // остановиться, и об этом полезно узнать, не переключаясь туда.
  function pollProjects() {
    if (!app.projects || app.projects.length < 2) return;
    api('/api/projects').then(function (d) {
      renderSwitcher(d.projects, app.projectKey);
    }).catch(function () { /* сервер закрылся — SSE об этом уже сказал */ });
  }
  setInterval(pollProjects, 5000);

  // ── 14. Поток событий (SSE) ───────────────────────────────────────────────

  var source = null;
  var lastEventId = 0;

  function connect() {
    if (source) source.close();
    source = new EventSource(href('/api/stream'));

    source.addEventListener('snapshot', function (e) {
      var data = JSON.parse(e.data);
      renderState(data.state);
      if (data.git) renderGit(data.git);
      if (data.pulse) renderPulse(data.pulse);
      (data.events || []).forEach(function (ev) {
        app.events.push(ev);
        lastEventId = Math.max(lastEventId, ev.id);
        if (ev.file) app.heat[ev.file] = ev.ts;
      });
      if (!app.archive) rebuildFeed();
    });

    source.addEventListener('event', function (e) {
      var ev = JSON.parse(e.data);
      lastEventId = Math.max(lastEventId, ev.id);
      if (ev.file) touchFile(ev.file);
      if (ev.kind === 'session' && ev.action === 'resumed') clearAlarm();
      if (app.archive) { app.events.push(ev); return; }   // копим молча
      addEvent(ev);
    });

    // Событие файловой системы, поглощённое дедупликацией: ленту не трогает,
    // но карту проекта греет.
    source.addEventListener('fs', function (e) {
      var ev = JSON.parse(e.data);
      if (ev.file) touchFile(ev.file);
    });

    source.addEventListener('git', function (e) { renderGit(JSON.parse(e.data)); });
    source.addEventListener('pulse', function (e) { renderPulse(JSON.parse(e.data)); });
    source.addEventListener('state', function (e) { renderState(JSON.parse(e.data)); });
    source.addEventListener('attention', function (e) { raiseAlarm(JSON.parse(e.data)); });

    source.onerror = function () {
      // EventSource переподключается сам; наше дело — показать это человеку.
      $('levelText').textContent = 'связь с Штурманом потеряна…';
      $('levelDot').className = 'chip__dot chip__dot--error';
    };
  }

  // ── 15. Управление лентой ─────────────────────────────────────────────────

  $('modeSimple').addEventListener('click', function () { setDetailed(false); });
  $('modeDetail').addEventListener('click', function () { setDetailed(true); });

  function setDetailed(v) {
    app.detailed = v;
    store.set('detailed', v);
    $('modeSimple').classList.toggle('is-active', !v);
    $('modeDetail').classList.toggle('is-active', v);
    rebuildFeed();
  }

  $('btnPause').addEventListener('click', function () {
    app.paused = !app.paused;
    $('btnPause').textContent = app.paused ? '▶ Продолжить' : '⏸ Пауза';
    $('btnPause').classList.toggle('is-on', app.paused);
    $('feedPaused').hidden = !app.paused;
    if (!app.paused) flushQueue();
  });

  $('btnResume').addEventListener('click', function () {
    app.paused = false;
    $('btnPause').textContent = '⏸ Пауза';
    $('btnPause').classList.remove('is-on');
    $('feedPaused').hidden = true;
    flushQueue();
  });

  function flushQueue() {
    app.queued.forEach(function (ev) {
      if (matches(ev)) feed.appendChild(renderEvent(ev, false));
    });
    app.queued = [];
    $('pausedCount').textContent = '0';
    trimFeedDom();
    feedEmpty.hidden = feed.childElementCount > 0;
    feed.scrollTop = feed.scrollHeight;
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
    searchTimer = setTimeout(function () {
      app.query = v;
      rebuildFeed();
    }, 180);
  });

  var treeSearchTimer = null;
  $('treeSearch').addEventListener('input', function () {
    var v = this.value.trim().toLowerCase();
    clearTimeout(treeSearchTimer);
    treeSearchTimer = setTimeout(function () {
      app.treeQuery = v;
      renderTree();
    }, 180);
  });

  $('btnTreeRefresh').addEventListener('click', loadTree);
  $('btnSessionsRefresh').addEventListener('click', loadSessions);
  $('drawerClose').addEventListener('click', closeDrawer);
  $('btnGlossary').addEventListener('click', openGlossary);

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

  $('btnDigest').addEventListener('click', function () {
    var body = openModal('📄 Что мы сегодня сделали');
    body.appendChild(el('p', 'muted', 'Собираем дайджест…'));
    api('/api/digest').then(function (d) {
      clear(body);
      var actions = el('div', 'set__row');
      var dl = el('button', 'btn btn--primary', '⬇ Скачать .md');
      dl.addEventListener('click', function () {
        window.location.href = href('/api/digest', { download: 1 });
      });
      var copy = el('button', 'btn', '📋 Скопировать');
      copy.addEventListener('click', function () {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(d.markdown).then(function () {
            copy.textContent = '✓ Скопировано';
          });
        }
      });
      actions.appendChild(dl);
      actions.appendChild(copy);
      body.appendChild(actions);
      body.appendChild(Object.assign(el('pre', 'out'), { textContent: d.markdown }));
    });
  });

  $('btnSettings').addEventListener('click', function () {
    var body = openModal('⚙️ Настройки');

    body.appendChild(settingRow(
      'Звуковой сигнал', 'Короткий сигнал, когда Клод остановился и ждёт вас.',
      app.sound, function (v) { app.sound = v; store.set('sound', v); }));

    body.appendChild(settingRow(
      'Уведомления браузера', 'Всплывающее уведомление системы — видно, даже если вкладка свёрнута.',
      app.notify, function (v) {
        app.notify = v;
        store.set('notify', v);
        if (v && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }));

    var idleRow = el('div', 'set__row');
    var lbl = el('div', 'set__label');
    lbl.appendChild(el('b', null, 'Через сколько тишины считать, что Клод ждёт'));
    lbl.appendChild(el('span', null, 'Сейчас: ' + (app.state ? app.state.idleSeconds : 45) + ' с. ' +
      'Слишком мало — сигнал будет срабатывать между шагами Клода.'));
    idleRow.appendChild(lbl);
    var input = el('input', 'input');
    input.type = 'number';
    input.min = '5';
    input.max = '600';
    input.style.width = '90px';
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

    var info = el('div', 'set__row');
    var il = el('div', 'set__label');
    il.appendChild(el('b', null, '«Спроси Клода»'));
    il.appendChild(el('span', null, app.state && app.state.askEnabled
      ? (app.state.askAvailable
        ? 'Включена. Кнопка появляется в карточке события. Расходует ваши лимиты.'
        : 'Включена флагом --ask, но команда claude не найдена в PATH.')
      : 'Выключена. Чтобы включить, перезапустите Штурман с флагом --ask. ' +
        'Функция отправляет вопрос в claude -p и расходует ваши лимиты.'));
    info.appendChild(il);
    body.appendChild(info);

    var about = el('div', 'set__row');
    var al = el('div', 'set__label');
    al.appendChild(el('b', null, 'О наблюдении'));
    al.appendChild(el('span', null, app.state
      ? 'Файлы: ' + (app.state.watchMode === 'native' ? 'системное наблюдение' : 'периодический опрос') +
        ' · Транскрипт: ' + (app.state.transcriptFile || 'не найден') +
        ' · Node ' + app.state.node + ' · Штурман ' + app.state.version
      : ''));
    about.appendChild(al);
    body.appendChild(about);
  });

  function settingRow(title, text, value, onChange) {
    var row = el('div', 'set__row');
    var lbl = el('div', 'set__label');
    lbl.appendChild(el('b', null, title));
    lbl.appendChild(el('span', null, text));
    row.appendChild(lbl);
    var btn = el('button', 'btn' + (value ? ' is-on' : ''), value ? 'Включено' : 'Выключено');
    btn.addEventListener('click', function () {
      value = !value;
      btn.textContent = value ? 'Включено' : 'Выключено';
      btn.classList.toggle('is-on', value);
      onChange(value);
    });
    row.appendChild(btn);
    return row;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!modal.hidden) closeModal();
      else if (!drawer.hidden) closeDrawer();
      else if (!$('tour').hidden) endTour();
      tip.hidden = true;
    }
  });

  // ── 16. Тур первого запуска ───────────────────────────────────────────────

  var TOUR = [
    {
      target: '#panelFeed',
      title: 'Лента «Что происходит»',
      text: 'Здесь по-русски описано каждое действие Клода: что он прочитал, что изменил, ' +
        'какую команду запустил и чем она закончилась. Нажмите на любую строку — откроются подробности: ' +
        'дифф, вывод команды, сырые данные.'
    },
    {
      target: '#panelTree',
      title: 'Карта проекта',
      text: 'Живое дерево файлов. Только что изменённые подсвечиваются жёлтым, и подсветка постепенно гаснет — ' +
        'так видно, где именно кипит работа. Клик по файлу открывает карточку: что это за файл ' +
        'простыми словами, размер и последние изменения.'
    },
    {
      target: '#panelGit',
      title: 'Git без страха',
      text: 'Текущая ветка и её смысл, счётчик несохранённых изменений и история как линия времени. ' +
        'Значки «?» рядом с терминами открывают объяснение — в словаре больше тридцати слов.'
    },
    {
      target: '#pulse',
      title: 'Пульс сессии',
      text: 'Сколько файлов затронуто, сколько команд выполнено, сколько ошибок встретилось и как долго ' +
        'идёт работа. Расход токенов считается по транскрипту и всегда приблизительный.'
    },
    {
      target: '#btnBell',
      title: 'Главное: сигнал «Клод ждёт»',
      text: 'Когда Клод остановится и будет ждать вашего ответа, Штурман подаст звуковой сигнал и покажет ' +
        'уведомление — можно спокойно уйти за чаем. Нажмите эту кнопку сейчас, чтобы разрешить звук ' +
        'и уведомления: браузер требует вашего явного действия.'
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
    var target = document.querySelector(step.target);
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

    // Карточку ставим туда, где есть место: справа, слева или снизу.
    var cw = card.offsetWidth || 400;
    var ch = card.offsetHeight || 200;
    var left = r.right + 16;
    if (left + cw > window.innerWidth - 12) left = r.left - cw - 16;
    if (left < 12) left = Math.max(12, Math.min(r.left, window.innerWidth - cw - 12));
    var top = r.top;
    if (top + ch > window.innerHeight - 12) top = Math.max(12, window.innerHeight - ch - 12);
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
  window.addEventListener('resize', function () {
    if (!$('tour').hidden) drawTour();
  });

  // ── 17. Старт ─────────────────────────────────────────────────────────────

  setDetailed(app.detailed);

  // Сначала выясняем, какие проекты вообще есть, и восстанавливаем выбранный
  // с прошлого раза — иначе первый же запрос дерева уйдёт не в тот проект.
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
      if (!store.get('tourDone', false)) setTimeout(startTour, 700);
    });

  // Журнал сессий обновляем редко: он меняется от силы раз в час.
  setInterval(loadSessions, 60000);
})();
