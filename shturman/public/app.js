/* «Штурман» — клиент. Ванильный JS, без сборки и внешних библиотек. */
(function () {
  'use strict';

  /* ---------------- настройки (localStorage) ---------------- */

  var settings = {
    sound: true,
    notif: false,
    quietSec: 90,
    tourDone: false,
    detail: false,
    ask: false,
    theme: 'auto'
  };
  try {
    var saved = JSON.parse(localStorage.getItem('shturman-settings') || '{}');
    Object.keys(saved).forEach(function (k) { settings[k] = saved[k]; });
  } catch (e) { /* повреждённые настройки — берём умолчания */ }

  function saveSettings() {
    try { localStorage.setItem('shturman-settings', JSON.stringify(settings)); } catch (e) { /* ок */ }
  }

  /* ---------------- утилиты ---------------- */

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function fmtSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
  }

  function fmtDuration(ms) {
    if (!ms || ms < 0) return '—';
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + ' ч ' + m + ' мин';
    if (m > 0) return m + ' мин';
    return s + ' с';
  }

  function fmtTokens(n) {
    if (n == null) return '—';
    if (n >= 1000000) return '≈' + (n / 1000000).toFixed(1) + ' млн';
    if (n >= 1000) return '≈' + Math.round(n / 1000) + ' тыс';
    return '≈' + n;
  }

  function fmtAgo(ms) {
    var diff = Date.now() - ms;
    if (diff < 60000) return 'только что';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' мин назад';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' ч назад';
    return new Date(ms).toLocaleDateString('ru-RU') + ' ' +
      new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------- состояние клиента ---------------- */

  var feedItems = [];        // все события всех проектов (с меткой project)
  var FEED_CAP = 600;
  var feedPaused = false;
  var feedFilter = 'all';
  var feedQuery = '';
  var viewingOldSession = null;   // id старой сессии или null
  var oldSessionItems = [];
  var treeData = null;
  var heat = {};             // path → mtimeMs
  var HEAT_TTL = 60000;      // Д-11: след живёт 60 секунд
  var lastPulse = null;
  var gitState = null;
  var glossTerms = [];
  var level = null;

  /* несколько проектов: события помечены id, панели показывают активный */
  var projects = [];         // [{id, name, path}]
  var activeProject = null;  // id активного проекта
  var signalled = {};        // projectId → уже сигналили об этой паузе
  var pulseSeen = {};        // projectId → первый пульс уже приходил

  /** api('/api/tree') → '/api/tree?project=<активный>' */
  function api(route) {
    if (!activeProject) return route;
    return route + (route.indexOf('?') === -1 ? '?' : '&') + 'project=' + encodeURIComponent(activeProject);
  }

  function projectName(id) {
    for (var i = 0; i < projects.length; i++) {
      if (projects[i].id === id) return projects[i].name;
    }
    return '';
  }

  /* ---------------- звук и уведомления ---------------- */

  var audioCtx = null;

  /* Браузер разрешает звук только после жеста пользователя: создаём и
     «будим» AudioContext на первом клике/клавише, чтобы сигнал не пропал. */
  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* звук не критичен */ }
    document.removeEventListener('pointerdown', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
  }
  document.addEventListener('pointerdown', unlockAudio);
  document.addEventListener('keydown', unlockAudio);

  function playChime() {
    if (!settings.sound) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t = audioCtx.currentTime;
      [523.25, 659.25, 783.99].forEach(function (freq, i) { // до-ми-соль
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.18, t + i * 0.12 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.9);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t + i * 0.12);
        osc.stop(t + i * 0.12 + 1);
      });
    } catch (e) { /* звук не критичен */ }
  }

  function notify(title, body) {
    if (!settings.notif) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      var n = new Notification(title, { body: body, tag: 'shturman-idle' });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) { /* ок */ }
  }

  var BASE_TITLE = document.title;

  function setTitleBadge(on) {
    document.title = on ? '🔔 Клод ждёт — Штурман' : BASE_TITLE;
  }

  function fireIdleSignal(projectId, reason, quietMs) {
    if (signalled[projectId]) return;
    signalled[projectId] = true;
    if (!pulseSeen[projectId]) return; // Клод стоял ещё до открытия панели — молчим
    playChime();
    setTitleBadge(true);
    if (navigator.vibrate) {
      try { navigator.vibrate([200, 90, 200]); } catch (e) { /* ок */ }
    }
    // при нескольких проектах говорим, в каком именно
    var where = projects.length > 1 ? ' (' + projectName(projectId) + ')' : '';
    if (reason === 'end-turn') {
      notify('Клод закончил и ждёт вас' + where, 'Посмотрите его ответ в Claude Code.');
    } else {
      notify('Клод давно молчит' + where, 'Тишина уже ' + Math.round((quietMs || 0) / 1000) + ' секунд. Возможно, он ждёт подтверждения.');
    }
  }

  /* ---------------- шапка: статус Клода ---------------- */

  function setClaudeState(mode, text) {
    var box = $('claude-state');
    box.className = mode;
    $('claude-state-text').textContent = text;
  }

  /**
   * Пульс приходит для каждого наблюдаемого проекта. Сигналы (звук,
   * уведомление) обрабатываются для всех; индикатор и цифры — только для
   * активного.
   */
  function updateStateFromPulse(projectId, p) {
    var isActive = projectId === activeProject;
    if (isActive) lastPulse = p;
    if (!p || p.sessionStartMs == null) {
      if (isActive) {
        setClaudeState('unknown', level === 'B' ? 'транскриптов нет — слежу за файлами' : 'жду начала сессии');
      }
      return;
    }
    var isFirst = !pulseSeen[projectId];
    var clientQuietMs = settings.quietSec * 1000;
    if (p.idle && p.idleReason === 'end-turn') {
      if (isActive) setClaudeState('waiting', 'Клод ждёт вас');
      fireIdleSignal(projectId, 'end-turn', p.quietMs);
    } else if (p.quietMs != null && p.quietMs >= clientQuietMs) {
      // порог «давно молчит» — настройка пользователя; серверные 90 с
      // здесь не главнее: и меньшие, и большие значения работают
      if (isActive) setClaudeState('waiting', 'Клод молчит…');
      fireIdleSignal(projectId, 'quiet', p.quietMs);
    } else if (p.idle) {
      // сервер считает паузой, но пользовательский порог ещё не истёк
      if (isActive) {
        setClaudeState('working', 'Клод работает');
        setTitleBadge(false);
      }
    } else {
      if (isActive) {
        setClaudeState('working', 'Клод работает');
        setTitleBadge(false);
      }
      signalled[projectId] = false;
    }
    pulseSeen[projectId] = true;
    if (isFirst && (p.idle || (p.quietMs != null && p.quietMs >= clientQuietMs))) {
      signalled[projectId] = true; // Клод стоял ещё до открытия панели — без сигнала
    }
    if (isActive) renderPulse(p);
  }

  function renderPulse(p) {
    $('p-files').textContent = p.filesTouched;
    $('p-cmds').textContent = p.commandsRun;
    $('p-errors').textContent = p.errorsSeen;
    $('p-errors-cell').className = 'pulse-cell' + (p.errorsSeen > 0 ? ' alert' : '');
    $('p-duration').textContent = fmtDuration(p.durationMs);
    var tok = p.tokens || {};
    $('p-tokens').textContent = tok.approxOutput ? fmtTokens(tok.approxOutput) : '—';
    var note = '';
    if (tok.approxOutput) {
      note = 'Оценка приблизительная, по данным транскрипта: ≈' +
        (tok.approxOutput || 0).toLocaleString('ru-RU') + ' токенов ответов Клода; ' +
        'текущий контекст ≈' + (tok.approxContext || 0).toLocaleString('ru-RU') + ' токенов' +
        (tok.model ? ' · модель ' + tok.model : '') + '.';
    }
    $('token-note').textContent = note;
  }

  /* ---------------- лента ---------------- */

  function passesFilter(item) {
    // живые события фильтруем по активному проекту; у ленты старой сессии
    // метки проекта нет — она уже загружена для нужного
    if (!viewingOldSession && item.project && activeProject && item.project !== activeProject) return false;
    if (feedFilter !== 'all' && item.category !== feedFilter) return false;
    if (feedQuery) {
      var q = feedQuery.toLowerCase();
      var hay = (item.title + ' ' + (item.tool || '') + ' ' + (item.output || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  var feedUid = 0;
  var expandedIds = {};      // uid → true: раскрытые карточки переживают перерисовку
  var MAX_FEED_DOM = 300;

  function buildDetails(item) {
    var det = el('div', 'feed-details');
    if (item.input && Object.keys(item.input).length) {
      det.appendChild(el('div', '', 'Параметры вызова:'));
      var preIn = el('pre');
      preIn.textContent = JSON.stringify(item.input, null, 2);
      det.appendChild(preIn);
    }
    if (item.output) {
      det.appendChild(el('div', '', item.isError ? 'Текст ошибки:' : 'Результат / вывод:'));
      var preOut = el('pre');
      preOut.textContent = item.output;
      det.appendChild(preOut);
    }
    if (settings.detail && item.raw) {
      det.appendChild(el('div', '', 'Сырая запись транскрипта:'));
      var preRaw = el('pre');
      try { preRaw.textContent = JSON.stringify(JSON.parse(item.raw), null, 2); }
      catch (e) { preRaw.textContent = item.raw; }
      det.appendChild(preRaw);
    }
    if (!det.children.length) det.appendChild(el('div', 'muted', 'У этого события нет дополнительных данных.'));
    if (settings.ask) det.appendChild(buildAskBlock(item));
    return det;
  }

  /** «Спроси Клода»: объяснение события через claude -p (бонус, opt-in). */
  function buildAskBlock(item) {
    var wrap = el('div');
    wrap.style.marginTop = '8px';
    var btn = el('button', '', '🤔 Спросить Клода, что это значит');
    var out = el('div', 'muted');
    out.style.marginTop = '6px';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      btn.disabled = true;
      out.textContent = 'Спрашиваю Клода… (это может занять до минуты)';
      var context = item.title +
        (item.input ? '\nПараметры: ' + JSON.stringify(item.input).slice(0, 2000) : '') +
        (item.output ? '\nРезультат: ' + String(item.output).slice(0, 2000) : '');
      fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: context })
      }).then(function (r) { return r.json(); }).then(function (d) {
        btn.disabled = false;
        if (d.answer) {
          out.className = '';
          out.style.fontSize = '14px';
          out.textContent = '💡 ' + d.answer;
        } else {
          out.textContent = d.error || 'Не получилось.';
        }
      }).catch(function () {
        btn.disabled = false;
        out.textContent = 'Сервер не ответил.';
      });
    });
    wrap.appendChild(btn);
    wrap.appendChild(out);
    return wrap;
  }

  function renderFeedItem(item) {
    var row = el('div', 'feed-item');
    if (item.category === 'signal') row.className += ' signal';
    if (item.isError) row.className += ' error-item';
    var ico = el('div', 'ico', item.icon || '•');
    var body = el('div', 'body');
    body.appendChild(el('div', 'title', item.title));
    body.appendChild(el('div', 'time', fmtTime(item.ts)));
    row.appendChild(ico);
    row.appendChild(body);

    if (expandedIds[item.uid]) body.appendChild(buildDetails(item));
    row.addEventListener('click', function () {
      var d = row.querySelector('.feed-details');
      if (d) {
        d.remove();
        delete expandedIds[item.uid];
      } else {
        expandedIds[item.uid] = true;
        body.appendChild(buildDetails(item));
      }
    });
    return row;
  }

  function feedCountText(source) {
    return source.length ? '· событий: ' + source.length + (feedPaused ? ' (пауза)' : '') : '';
  }

  /* лёгкая «виртуализация»: рисуем окно из FEED_CHUNK строк, дальше —
     по кнопке «Показать ещё» (на телефоне длинный список иначе тормозит) */
  var FEED_CHUNK = 100;
  var feedRenderLimit = FEED_CHUNK;

  /** Полная пересборка — только для смены фильтра/поиска/режима/сессии. */
  function renderFeed() {
    var box = $('feed');
    box.innerHTML = '';
    var source = viewingOldSession ? oldSessionItems : feedItems;
    var shown = 0;
    var hiddenRest = 0;
    for (var i = source.length - 1; i >= 0; i--) { // свежее — сверху
      var item = source[i];
      if (!passesFilter(item)) continue;
      if (shown >= Math.min(feedRenderLimit, MAX_FEED_DOM)) {
        hiddenRest++;
        continue;
      }
      box.appendChild(renderFeedItem(item));
      shown++;
    }
    if (hiddenRest > 0 && feedRenderLimit < MAX_FEED_DOM) {
      var more = el('button', 'feed-more', 'Показать ещё (' + hiddenRest + ')');
      more.style.width = '100%';
      more.addEventListener('click', function () {
        feedRenderLimit += 200;
        renderFeed();
      });
      box.appendChild(more);
    }
    if (!shown) {
      var msg = source.length
        ? 'Ничего не подходит под фильтр или поиск.'
        : (level === 'B'
          ? 'Транскрипты Claude Code не найдены — показываю только изменения файлов и git.\nЗапустите Claude Code в этой папке, и лента оживёт полностью.'
          : 'Пока тихо. Запустите Claude Code в этой папке —\nи здесь появится живая лента его действий.');
      box.appendChild(el('div', 'feed-empty', msg));
    }
    $('feed-count').textContent = feedCountText(source);
  }

  /* Живые события НЕ пересобирают ленту: копятся и вставляются сверху одной
     пачкой на кадр — раскрытые карточки и прокрутка остаются на месте. */
  var pendingItems = [];
  var flushScheduled = false;

  function flushPending() {
    flushScheduled = false;
    if (!pendingItems.length) return;
    var batch = pendingItems;
    pendingItems = [];
    if (feedPaused || viewingOldSession) return; // покажем при возврате (полный рендер)
    var box = $('feed');
    var emptyNote = box.querySelector('.feed-empty');
    if (emptyNote) emptyNote.remove();

    var prevScrollTop = box.scrollTop;
    var prevHeight = box.scrollHeight;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < batch.length; i++) {
      if (passesFilter(batch[i])) frag.appendChild(renderFeedItem(batch[i]));
    }
    // свежее — сверху: пачку вставляем в начало (внутри пачки свежее выше)
    var first = box.firstChild;
    var nodes = Array.prototype.slice.call(frag.childNodes).reverse();
    for (var n = 0; n < nodes.length; n++) box.insertBefore(nodes[n], first);
    while (box.children.length > MAX_FEED_DOM) box.removeChild(box.lastChild);
    // если человек читал что-то ниже — не дёргаем ему прокрутку
    if (prevScrollTop > 10) {
      box.scrollTop = prevScrollTop + (box.scrollHeight - prevHeight);
    }
    $('feed-count').textContent = feedCountText(feedItems);
  }

  function addFeedItem(item) {
    item.uid = ++feedUid;
    trackAttention(item);
    feedItems.push(item);
    if (feedItems.length > FEED_CAP) {
      var dropped = feedItems.shift();
      delete expandedIds[dropped.uid];
    }
    pendingItems.push(item);
    if (!flushScheduled) {
      flushScheduled = true;
      if (window.requestAnimationFrame) requestAnimationFrame(flushPending);
      else setTimeout(flushPending, 50);
    }
    if (feedPaused || viewingOldSession) {
      $('feed-count').textContent = feedCountText(feedItems);
    }
  }

  /* управление лентой */

  $('btn-pause').addEventListener('click', function () {
    feedPaused = !feedPaused;
    this.textContent = feedPaused ? '▶ Продолжить' : '⏸ Пауза';
    this.classList.toggle('active', feedPaused);
    if (!feedPaused) renderFeed();
  });

  $('btn-detail').addEventListener('click', function () {
    settings.detail = !settings.detail;
    saveSettings();
    this.textContent = settings.detail ? 'Подробно' : 'Просто';
    this.classList.toggle('active', settings.detail);
    var mirror = $('set-detail');
    if (mirror) mirror.checked = settings.detail;
    renderFeed();
  });
  if (settings.detail) {
    $('btn-detail').textContent = 'Подробно';
    $('btn-detail').classList.add('active');
  }

  $('feed-search').addEventListener('input', function () {
    feedQuery = this.value.trim();
    feedRenderLimit = FEED_CHUNK;
    renderFeed();
  });

  $('feed-chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    feedFilter = chip.getAttribute('data-cat');
    this.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); });
    chip.classList.add('on');
    feedRenderLimit = FEED_CHUNK;
    renderFeed();
  });

  $('feed-notice-btn').addEventListener('click', function () {
    viewingOldSession = null;
    oldSessionItems = [];
    $('feed-notice').classList.remove('show');
    renderFeed();
  });

  /* ---------------- карта проекта ---------------- */

  function loadTree() {
    lastTreeLoad = Date.now();
    fetch(api('/api/tree')).then(function (r) { return r.json(); }).then(function (data) {
      treeData = data.tree;
      var now = Date.now();
      Object.keys(data.recent || {}).forEach(function (p) {
        var rec = data.recent[p];
        if (now - rec.mtimeMs < HEAT_TTL) heat[p] = rec.mtimeMs;
      });
      renderTree();
    }).catch(function () { /* сервер ответит в следующий раз */ });
  }

  var openPaths = { '': true }; // раскрытые папки переживают перерисовку

  function renderTree() {
    var box = $('tree');
    var prevScroll = box.scrollTop;
    box.innerHTML = '';
    if (!treeData) return;
    var query = $('tree-search').value.trim().toLowerCase();
    var rootNode = buildTreeNode(treeData, query, 0);
    if (rootNode) {
      rootNode.classList.add('open');
      box.appendChild(rootNode);
    } else {
      box.appendChild(el('div', 'muted', 'Ничего не найдено.'));
    }
    if (treeData.truncated) {
      box.appendChild(el('div', 'muted', 'Проект большой — показана только часть дерева.'));
    }
    box.scrollTop = prevScroll;
  }

  function matchesQuery(node, query) {
    if (!query) return true;
    if (node.name.toLowerCase().indexOf(query) !== -1) return true;
    if (node.children) {
      for (var i = 0; i < node.children.length; i++) {
        if (matchesQuery(node.children[i], query)) return true;
      }
    }
    return false;
  }

  function buildTreeNode(node, query, depth) {
    if (!matchesQuery(node, query)) return null;
    var wrap = el('div', 'tnode');
    var row = el('div', 'row');
    var isDir = node.type === 'dir';
    var arrow = el('span', 'arrow', isDir ? '▶' : '');
    var nm = el('span', 'nm' + (isDir ? ' dir' : ''), node.name);
    row.appendChild(arrow);
    row.appendChild(nm);
    row.setAttribute('data-path', node.path || '');
    if (!isDir) row.setAttribute('data-file', '1');
    wrap.appendChild(row);

    if (isDir) {
      var kids = el('div', 'kids');
      (node.children || []).forEach(function (child) {
        var childNode = buildTreeNode(child, query, depth + 1);
        if (childNode) kids.appendChild(childNode);
      });
      wrap.appendChild(kids);
      if (openPaths[node.path || ''] || query) wrap.classList.add('open');
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = wrap.classList.toggle('open');
        if (isOpen) openPaths[node.path || ''] = true;
        else delete openPaths[node.path || ''];
      });
    } else {
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        openFileCard(node.path);
      });
    }
    applyHeat(row, node.path);
    return wrap;
  }

  function applyHeat(row, p) {
    var t = heat[p];
    if (!t) return;
    var age = Date.now() - t;
    if (age > HEAT_TTL) {
      delete heat[p];
      row.classList.remove('hot');
      row.style.removeProperty('--heat-a');
      return;
    }
    var a = 1 - age / HEAT_TTL; // 1 → 0 за 60 секунд
    row.classList.add('hot');
    row.style.setProperty('--heat-a', a.toFixed(2));
  }

  /* гаснущий след: раз в секунду пересчитываем прозрачность */
  setInterval(function () {
    var rows = $('tree').querySelectorAll('.row.hot, .row[data-path]');
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i].getAttribute('data-path');
      if (heat[p]) applyHeat(rows[i], p);
      else if (rows[i].classList.contains('hot')) {
        rows[i].classList.remove('hot');
        rows[i].style.removeProperty('--heat-a');
      }
    }
  }, 1000);

  $('tree-search').addEventListener('input', renderTree);

  var lastTreeLoad = 0;
  function markHot(files) {
    var now = Date.now();
    files.forEach(function (f) {
      heat[f] = now;
      // прогреваем и родительские папки — чтобы след был виден в свёрнутом дереве
      var parts = f.split('/');
      while (parts.length > 1) {
        parts.pop();
        var dir = parts.join('/');
        if (!heat[dir] || heat[dir] < now) heat[dir] = now;
      }
    });
    // дерево могло измениться (новые/удалённые файлы), но не дёргаем сервер
    // чаще, чем раз в 3 секунды — подсветка уже видна через heat
    if (now - lastTreeLoad > 3000) loadTree();
  }

  /* карточка файла */

  function openFileCard(relPath) {
    fetch(api('/api/file?path=' + encodeURIComponent(relPath)))
      .then(function (r) { return r.json(); })
      .then(function (info) {
        $('file-title').innerHTML = '';
        $('file-title').appendChild(document.createTextNode('📄 ' + (info.name || relPath) + ' '));
        var x = el('button', 'x', 'Закрыть');
        x.setAttribute('data-close', 'modal-file');
        $('file-title').appendChild(x);

        var body = $('file-body');
        body.innerHTML = '';
        if (info.error) {
          body.appendChild(el('div', 'empty-note', info.error));
        } else {
          var desc = el('div', 'kv');
          desc.innerHTML = '<b>Что это:</b> ';
          desc.appendChild(document.createTextNode(info.description || ''));
          body.appendChild(desc);
          var kv2 = el('div', 'kv');
          kv2.innerHTML = '<b>Путь:</b> <span class="mono">' + escapeHtml(info.path) + '</span>';
          body.appendChild(kv2);
          if (!info.isDir) {
            var kv3 = el('div', 'kv');
            kv3.innerHTML = '<b>Размер:</b> ' + fmtSize(info.size) + ' · <b>менялся:</b> ' + fmtAgo(info.mtimeMs);
            body.appendChild(kv3);
          }
          if (info.diff && info.diff.lines && info.diff.lines.length) {
            var head = el('div', 'kv');
            head.style.marginTop = '10px';
            head.innerHTML = '<b>Последние изменения</b> ' + (info.diff.source === 'worktree'
              ? '(ещё не закоммичены)'
              : '(из последнего коммита с этим файлом)');
            body.appendChild(head);
            body.appendChild(diffLegend());
            body.appendChild(renderDiff(info.diff.lines));
          } else if (!info.isDir) {
            body.appendChild(el('div', 'muted', 'Изменений в git для этого файла не видно.'));
          }
        }
        showModal('modal-file');
      })
      .catch(function () { /* сеть локальная, но всякое бывает */ });
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function diffLegend() {
    var lg = el('div', 'diff-legend');
    lg.innerHTML = '<span class="lg-add">■ зелёное — добавлено</span> · <span class="lg-del">■ красное — удалено</span>';
    return lg;
  }

  function renderDiff(lines) {
    var box = el('div', 'diff');
    lines.forEach(function (line) {
      if (line.kind === 'meta') return; // технические заголовки прячем
      var cls = line.kind === 'add' ? 'add' : line.kind === 'del' ? 'del' : line.kind === 'hunk' ? 'hunk' : 'ctx';
      var text = line.kind === 'hunk' ? '· ' + line.text : line.text;
      var dl = el('div', 'dl ' + cls, (line.kind === 'add' ? '+ ' : line.kind === 'del' ? '− ' : line.kind === 'hunk' ? '' : '  ') + text);
      box.appendChild(dl);
    });
    if (!box.children.length) box.appendChild(el('div', 'dl ctx', '(пусто)'));
    return box;
  }

  /* ---------------- мини-карта внимания ---------------- */

  var attention = {};            // projectId → [{file, ts, kind}]
  var ATT_TTL = 300000;          // след живёт 5 минут
  var ATT_MAX_NODES = 8;
  var ATT_TOOLS = {
    Read: 'read', Grep: 'read', NotebookEdit: 'edit',
    Edit: 'edit', MultiEdit: 'edit', Write: 'edit'
  };

  /** Событие ленты → отметка «Клод смотрел на этот файл». */
  function trackAttention(item) {
    if (item.kind !== 'tool-use' || !item.project) return;
    var mode = ATT_TOOLS[item.tool];
    if (!mode) return;
    var input = item.input || {};
    var file = input.file_path || input.notebook_path || (item.tool !== 'Grep' ? input.path : null);
    if (!file) return;
    var rel = toProjectRel(String(file), item.project);
    if (!rel) return;
    if (!attention[item.project]) attention[item.project] = [];
    var list = attention[item.project];
    list.push({ file: rel, ts: Date.parse(item.ts) || Date.now(), kind: mode });
    if (list.length > 60) list.shift();
  }

  /** Абсолютный путь → относительный внутри проекта (для показа и карточки). */
  function toProjectRel(file, projectId) {
    var f = file.replace(/\\/g, '/');
    for (var i = 0; i < projects.length; i++) {
      if (projects[i].id !== projectId) continue;
      var root = projects[i].path.replace(/\\/g, '/');
      if (f.indexOf(root + '/') === 0) return f.slice(root.length + 1);
      if (f === root) return null; // сам корень не интересен
    }
    if (f.indexOf('/') !== 0 && !/^[A-Za-z]:/.test(f)) return f; // уже относительный
    return null; // файл вне проекта — на карту не попадает
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function renderAttention() {
    var box = $('attention');
    var now = Date.now();
    var list = (attention[activeProject] || []).filter(function (a) { return now - a.ts < ATT_TTL; });
    // последние упоминания каждого файла, свежие — первыми
    var latest = {};
    for (var i = list.length - 1; i >= 0; i--) {
      var a = list[i];
      if (!latest[a.file]) latest[a.file] = a;
    }
    var nodes = Object.keys(latest).map(function (k) { return latest[k]; })
      .sort(function (x, y) { return y.ts - x.ts; })
      .slice(0, ATT_MAX_NODES);

    box.innerHTML = '';
    if (!nodes.length) {
      box.appendChild(el('div', 'att-empty',
        level === 'B'
          ? 'Здесь появится след внимания Клода — когда найдутся транскрипты (уровень A).'
          : 'Пока пусто: как только Клод начнёт читать и править файлы, здесь появится его «взгляд».'));
      return;
    }

    var W = 340, H = 190, CX = W / 2, CY = H / 2, R = 62;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H });

    nodes.forEach(function (n, i) {
      // свежайший — наверху, дальше по кругу
      var angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(nodes.length, 3);
      var x = CX + R * Math.cos(angle);
      var y = CY + R * Math.sin(angle);
      var alpha = Math.max(0.15, 1 - (now - n.ts) / ATT_TTL);

      var edge = svgEl('line', { x1: CX, y1: CY, x2: x, y2: y, 'class': 'att-edge' });
      edge.style.opacity = (alpha * 0.8).toFixed(2);
      svg.appendChild(edge);

      var g = svgEl('g', { 'class': 'att-node ' + n.kind });
      var c = svgEl('circle', { cx: x, cy: y, r: 4 + alpha * 4 });
      c.style.opacity = alpha.toFixed(2);
      g.appendChild(c);
      var name = n.file.split('/').pop();
      if (name.length > 22) name = name.slice(0, 20) + '…';
      var anchor = x < CX - 6 ? 'end' : x > CX + 6 ? 'start' : 'middle';
      var label = svgEl('text', {
        x: x + (anchor === 'end' ? -10 : anchor === 'start' ? 10 : 0),
        y: y + (y < CY ? -10 : 16),
        'text-anchor': anchor
      });
      label.textContent = name;
      label.style.opacity = Math.max(0.35, alpha).toFixed(2);
      g.appendChild(label);
      var titleEl = svgEl('title');
      titleEl.textContent = n.file + ' — ' + (n.kind === 'edit' ? 'правил' : 'читал') + ' ' + fmtAgo(n.ts);
      g.appendChild(titleEl);
      g.addEventListener('click', function () { openFileCard(n.file); });
      svg.appendChild(g);
    });

    // центр — сам Клод
    var center = svgEl('circle', { cx: CX, cy: CY, r: 14, 'class': 'att-center' });
    svg.appendChild(center);
    var centerLabel = svgEl('text', {
      x: CX, y: CY + 4, 'text-anchor': 'middle', 'class': 'att-center-label'
    });
    centerLabel.textContent = '🤖';
    svg.appendChild(centerLabel);

    box.appendChild(svg);
    var legend = el('div', 'att-legend');
    legend.innerHTML = '<span class="lg-read">● читал</span> · <span class="lg-edit">● правил</span> — ближе к непрозрачному значит свежее';
    box.appendChild(legend);
  }

  setInterval(renderAttention, 2000);

  /* ---------------- git ---------------- */

  function renderGit(g) {
    gitState = g;
    var box = $('git-body');
    box.innerHTML = '';
    if (!g || !g.available) {
      var note = el('div', 'empty-note');
      note.innerHTML = '<b>Git здесь не установлен или недоступен.</b><br>' +
        'Это не страшно: «Штурман» продолжает следить за файлами. ' +
        'Git пригодится, чтобы сохранять историю изменений — загляните в словарь (термин «репозиторий»).';
      box.appendChild(note);
      return;
    }
    if (!g.isRepo) {
      var note2 = el('div', 'empty-note');
      note2.innerHTML = '<b>Эта папка — ещё не git-репозиторий.</b><br>' +
        'История изменений не ведётся. Обычно её включают командой <span class="mono">git init</span>, ' +
        'но «Штурман» сам ничего не меняет — он только наблюдает.';
      box.appendChild(note2);
      return;
    }

    var line = el('div', 'git-line');
    line.innerHTML = 'Ветка <span class="qm" data-term="ветка">?</span>: <span class="branch-name">' +
      escapeHtml(g.branch || '(нет)') + '</span>';
    box.appendChild(line);
    box.appendChild(el('div', 'git-meaning', g.branchMeaning || ''));

    var st = g.status || { total: 0, entries: [] };
    var dirty = el('div', 'git-dirty ' + (st.total ? 'dirty' : 'clean'));
    var num = el('div', 'num', String(st.total));
    var expl = el('div', 'expl');
    if (st.total === 0) {
      expl.textContent = 'Незакоммиченных изменений нет: всё, что есть в файлах, уже сохранено в истории git.';
    } else {
      expl.innerHTML = 'файлов изменено, но не закоммичено <span class="qm" data-term="незакоммиченные изменения">?</span>. ' +
        'Это правки, которые ещё не сохранены в истории git: пока Клод работает — это нормально.';
    }
    dirty.appendChild(num);
    dirty.appendChild(expl);
    box.appendChild(dirty);

    if (st.entries && st.entries.length) {
      var files = el('div');
      files.id = 'git-files';
      st.entries.slice(0, 12).forEach(function (entry) {
        var gf = el('div', 'gf');
        gf.appendChild(el('span', 'st', (entry.x + entry.y).trim() || '·'));
        gf.appendChild(el('span', 'fn', entry.file));
        gf.appendChild(el('span', 'hint', entry.human));
        gf.addEventListener('click', function () { openFileCard(entry.file); });
        files.appendChild(gf);
      });
      if (st.entries.length > 12) {
        files.appendChild(el('div', 'muted', '…и ещё ' + (st.entries.length - 12)));
      }
      box.appendChild(files);
    }

    var h = el('div', 'git-line');
    h.style.marginTop = '6px';
    h.innerHTML = '<b>История коммитов</b> <span class="qm" data-term="коммит">?</span>';
    box.appendChild(h);

    var tl = el('div');
    tl.id = 'timeline';
    (g.commits || []).forEach(function (c) {
      var item = el('div', 'commit');
      item.appendChild(el('div', 'subj', c.subject));
      item.appendChild(el('div', 'meta', c.author + ' · ' + fmtAgo(new Date(c.date).getTime()) + ' · ' + c.short));
      item.addEventListener('click', function () { openCommit(c); });
      tl.appendChild(item);
    });
    if (!g.commits || !g.commits.length) {
      tl.appendChild(el('div', 'muted', 'Коммитов пока нет — история появится после первого сохранения.'));
    }
    box.appendChild(tl);
  }

  function openCommit(c) {
    $('commit-title').innerHTML = '';
    $('commit-title').appendChild(document.createTextNode('🌿 ' + c.subject + ' '));
    var x = el('button', 'x', 'Закрыть');
    x.setAttribute('data-close', 'modal-commit');
    $('commit-title').appendChild(x);
    var body = $('commit-body');
    body.innerHTML = '<div class="kv"><b>Автор:</b> ' + escapeHtml(c.author) + ' · <b>когда:</b> ' +
      fmtAgo(new Date(c.date).getTime()) + ' · <span class="mono">' + escapeHtml(c.short) + '</span></div>' +
      '<div class="muted">Загружаю изменения…</div>';
    showModal('modal-commit');
    fetch(api('/api/commit?hash=' + encodeURIComponent(c.hash)))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        body.querySelector('.muted').remove();
        if (d.numstat && d.numstat.length) {
          var sum = el('div', 'kv');
          var add = 0, rem = 0;
          d.numstat.forEach(function (row) { add += row.added || 0; rem += row.removed || 0; });
          sum.innerHTML = '<b>Затронуто файлов:</b> ' + d.numstat.length +
            ' · <span class="lg-add" style="color:var(--good)">+' + add + ' строк</span>' +
            ' · <span style="color:var(--bad)">−' + rem + '</span>';
          body.appendChild(sum);
        }
        if (d.lines && d.lines.length) {
          body.appendChild(diffLegend());
          body.appendChild(renderDiff(d.lines));
        } else {
          body.appendChild(el('div', 'muted', 'Дифф пуст или слишком велик для показа.'));
        }
      })
      .catch(function () {
        body.appendChild(el('div', 'muted', 'Не удалось загрузить дифф.'));
      });
  }

  /* ---------------- словарь ---------------- */

  function loadGlossary() {
    fetch('/api/glossary').then(function (r) { return r.json(); }).then(function (d) {
      glossTerms = d.terms || [];
      renderGlossary('');
    });
  }

  function renderGlossary(query, highlightTerm) {
    var box = $('gloss-list');
    box.innerHTML = '';
    var q = (query || '').toLowerCase();
    glossTerms.forEach(function (t) {
      if (q && (t.term + ' ' + t.def).toLowerCase().indexOf(q) === -1) return;
      var item = el('div', 'gloss-item');
      if (highlightTerm && t.term.toLowerCase().indexOf(highlightTerm.toLowerCase()) === 0) {
        item.classList.add('hl');
      }
      item.appendChild(el('div', 't', t.term));
      item.appendChild(el('div', 'd', t.def));
      box.appendChild(item);
    });
    if (!box.children.length) box.appendChild(el('div', 'muted', 'Такого термина в словаре пока нет.'));
  }

  $('gloss-search').addEventListener('input', function () { renderGlossary(this.value); });

  /* «?» рядом с терминами — открывают словарь на нужном месте */
  document.body.addEventListener('click', function (e) {
    var qm = e.target.closest('.qm');
    if (!qm) return;
    e.stopPropagation();
    var term = qm.getAttribute('data-term') || '';
    $('gloss-search').value = '';
    renderGlossary('', term);
    showModal('modal-gloss');
    var hl = document.querySelector('.gloss-item.hl');
    if (hl) hl.scrollIntoView({ block: 'center' });
  });

  /* ---------------- сессии ---------------- */

  /** Бонус: дайджест «Что мы сегодня сделали» — markdown-дневник новичка. */
  function buildDigest() {
    var p = lastPulse || {};
    var g = gitState || {};
    var lines = [];
    lines.push('# Дневник сессии Claude Code — ' + new Date().toLocaleString('ru-RU'));
    lines.push('');
    lines.push('Проект: `' + ($('project-path').textContent || '') + '`');
    if (g.branch) lines.push('Ветка: `' + g.branch + '` — ' + (g.branchMeaning || ''));
    lines.push('');
    lines.push('## Итоги в цифрах');
    lines.push('');
    lines.push('- Сессия длилась: ' + fmtDuration(p.durationMs || 0));
    lines.push('- Файлов затронуто: ' + (p.filesTouched || 0));
    lines.push('- Команд выполнено: ' + (p.commandsRun || 0));
    lines.push('- Ошибок замечено: ' + (p.errorsSeen || 0));
    if (p.tokens && p.tokens.approxOutput) {
      lines.push('- Токенов потрачено (приблизительно): ~' + p.tokens.approxOutput.toLocaleString('ru-RU'));
    }
    lines.push('');
    if (g.commits && g.commits.length) {
      lines.push('## Свежие коммиты');
      lines.push('');
      g.commits.slice(0, 10).forEach(function (c) {
        lines.push('- `' + c.short + '` ' + c.subject);
      });
      lines.push('');
    }
    lines.push('## Хроника (последние события, свежее внизу)');
    lines.push('');
    var interesting = feedItems.filter(function (it) {
      if (it.project && activeProject && it.project !== activeProject) return false;
      return it.kind !== 'tool-result' || it.isError; // «инструмент отработал» — шум
    }).slice(-120);
    interesting.forEach(function (it) {
      lines.push('- ' + (fmtTime(it.ts) || '·') + ' ' + it.icon + ' ' + it.title);
    });
    lines.push('');
    lines.push('---');
    lines.push('_Составлено панелью «Штурман» автоматически. Числа токенов — оценка._');
    return lines.join('\n');
  }

  function downloadDigest() {
    var text = buildDigest();
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var stamp = new Date().toISOString().slice(0, 10);
    a.download = 'shturman-digest-' + stamp + '.md'; // латиница: кириллицу в download режут некоторые браузеры
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function openSessions() {
    fetch(api('/api/sessions')).then(function (r) { return r.json(); }).then(function (d) {
      var body = $('sessions-body');
      body.innerHTML = '';
      var digestBtn = el('button', '', '📝 Скачать дайджест текущей сессии (markdown)');
      digestBtn.style.marginBottom = '12px';
      digestBtn.addEventListener('click', downloadDigest);
      body.appendChild(digestBtn);
      if (!d.sessions || !d.sessions.length) {
        body.appendChild(el('div', 'empty-note',
          'Сессий Claude Code для этой папки не найдено. Запустите Claude Code здесь — и сессии появятся.'));
      } else {
        d.sessions.forEach(function (s) {
          var row = el('div', 'gloss-item');
          row.style.cursor = 'pointer';
          var title = el('div', 't', (s.id === d.active ? '▶ ' : '') + s.id.slice(0, 8) + '…' +
            (s.id === d.active ? ' (текущая)' : ''));
          var meta = el('div', 'd', 'последняя активность: ' + fmtAgo(s.mtimeMs) + ' · размер журнала: ' + fmtSize(s.size));
          row.appendChild(title);
          row.appendChild(meta);
          row.addEventListener('click', function () {
            hideModal('modal-sessions');
            if (s.id === d.active) {
              viewingOldSession = null;
              $('feed-notice').classList.remove('show');
              renderFeed();
            } else {
              openOldSession(s.id);
            }
          });
          body.appendChild(row);
        });
      }
      showModal('modal-sessions');
    });
  }

  function openOldSession(id) {
    fetch(api('/api/session?id=' + encodeURIComponent(id)))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        viewingOldSession = id;
        oldSessionItems = d.events || [];
        oldSessionItems.forEach(function (it) { it.uid = ++feedUid; });
        $('feed-notice-text').textContent = 'Вы смотрите прошлую сессию ' + id.slice(0, 8) + '… (' +
          oldSessionItems.length + ' событий). Живая лента продолжает записываться.';
        $('feed-notice').classList.add('show');
        renderFeed();
      });
  }

  $('btn-sessions').addEventListener('click', openSessions);

  /* ---------------- модальные окна ---------------- */

  function showModal(id) { $(id).classList.add('show'); }
  function hideModal(id) { $(id).classList.remove('show'); }

  document.body.addEventListener('click', function (e) {
    var closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      hideModal(closeBtn.getAttribute('data-close'));
      return;
    }
    var back = e.target.classList && e.target.classList.contains('modal-back');
    if (back) e.target.classList.remove('show');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-back.show').forEach(function (m) { m.classList.remove('show'); });
      $('tour-back').classList.remove('show');
      $('tour-box').classList.remove('show');
      clearTourHighlight();
    }
  });

  $('btn-gloss').addEventListener('click', function () {
    $('gloss-search').value = '';
    renderGlossary('');
    showModal('modal-gloss');
  });

  /* ---------------- настройки ---------------- */

  $('btn-settings').addEventListener('click', function () { showModal('modal-settings'); });

  $('set-sound').checked = settings.sound;
  $('set-sound').addEventListener('change', function () {
    settings.sound = this.checked;
    saveSettings();
  });

  $('set-notif').checked = settings.notif && ('Notification' in window) && Notification.permission === 'granted';
  $('set-notif').addEventListener('change', function () {
    var input = this;
    if (!('Notification' in window)) {
      $('notif-note').textContent = 'Этот браузер не умеет показывать уведомления.';
      input.checked = false;
      return;
    }
    if (input.checked) {
      Notification.requestPermission().then(function (perm) {
        if (perm === 'granted') {
          settings.notif = true;
        } else {
          settings.notif = false;
          input.checked = false;
          $('notif-note').textContent = 'Браузер не дал разрешения — уведомления выключены.';
        }
        saveSettings();
      });
    } else {
      settings.notif = false;
      saveSettings();
    }
  });

  $('set-quiet').value = settings.quietSec;
  $('set-quiet').addEventListener('change', function () {
    var v = parseInt(this.value, 10);
    if (!isNaN(v) && v >= 15 && v <= 600) {
      settings.quietSec = v;
      saveSettings();
    } else {
      this.value = settings.quietSec;
    }
  });

  $('set-ask').checked = settings.ask;
  $('set-ask').addEventListener('change', function () {
    settings.ask = this.checked;
    saveSettings();
  });

  $('set-theme').value = settings.theme || 'auto';
  $('set-theme').addEventListener('change', function () {
    settings.theme = this.value;
    saveSettings();
    applyTheme();
  });

  $('set-detail').checked = settings.detail;
  $('set-detail').addEventListener('change', function () {
    settings.detail = this.checked;
    saveSettings();
    $('btn-detail').textContent = settings.detail ? 'Подробно' : 'Просто';
    $('btn-detail').classList.toggle('active', settings.detail);
    renderFeed();
  });

  $('btn-test-signal').addEventListener('click', function () {
    var wasSignalled = signalledIdle;
    signalledIdle = false;
    var savedSound = settings.sound;
    settings.sound = true;
    playChime();
    settings.sound = savedSound;
    if (settings.notif) notify('Проверка сигнала', 'Так «Штурман» позовёт вас, когда Клод остановится.');
    signalledIdle = wasSignalled;
  });

  /* ---------------- тур ---------------- */

  var TOUR = [
    {
      target: 'panel-feed',
      title: 'Лента «Что происходит»',
      text: 'Каждое действие Клода — строчкой на человеческом языке: что читает, что меняет, какие команды запускает. Кликните по строчке, чтобы увидеть детали, а кнопка «Просто/Подробно» показывает сырые данные.'
    },
    {
      target: 'claude-state',
      title: 'Состояние Клода',
      text: 'Зелёная точка — работает, жёлтая — остановился и ждёт вас. Когда Клод закончит, «Штурман» подаст звуковой сигнал (а если разрешите — и уведомление браузера). Можно спокойно уходить пить чай.'
    },
    {
      target: 'panel-map',
      title: 'Карта проекта',
      text: 'Все файлы папки. То, что только что менялось, подсвечено тёплым цветом — след гаснет за минуту. Кликните файл, чтобы узнать, что это такое и что в нём поменялось.'
    },
    {
      target: 'panel-git',
      title: 'Git без страха',
      text: 'Текущая ветка и её смысл, количество несохранённых изменений и история коммитов. Кликните коммит — увидите изменения: зелёное добавлено, красное удалено.'
    },
    {
      target: 'btn-gloss',
      title: 'Словарь и знаки «?»',
      text: 'Незнакомое слово? Жмите на «?» рядом с ним или откройте словарь — там всё объяснено по-простому. Хорошего плавания! ⛵'
    }
  ];
  var tourStep = 0;

  function clearTourHighlight() {
    document.querySelectorAll('.tour-target').forEach(function (n) { n.classList.remove('tour-target'); });
    document.querySelectorAll('.tour-raise').forEach(function (n) { n.classList.remove('tour-raise'); });
  }

  function showTourStep(i) {
    clearTourHighlight();
    if (i >= TOUR.length) {
      $('tour-back').classList.remove('show');
      $('tour-box').classList.remove('show');
      settings.tourDone = true;
      saveSettings();
      return;
    }
    tourStep = i;
    var step = TOUR[i];
    var target = $(step.target);
    $('tour-title').textContent = step.title;
    $('tour-text').textContent = step.text;
    $('tour-step').textContent = 'Шаг ' + (i + 1) + ' из ' + TOUR.length;
    $('tour-next').textContent = i === TOUR.length - 1 ? 'Готово' : 'Дальше';
    $('tour-back').classList.add('show');
    $('tour-box').classList.add('show');

    var box = $('tour-box');
    if (target) {
      target.classList.add('tour-target');
      // цель в шапке: sticky-шапка образует свой слой (z-index 50), и без
      // подъёма всей шапки подсветка останется под затемнением
      var bar = target.closest('.topbar');
      if (bar) bar.classList.add('tour-raise');
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      var r = target.getBoundingClientRect();
      var top = Math.min(window.innerHeight - 240, Math.max(16, r.top + 20));
      var left = Math.min(window.innerWidth - 450, Math.max(16, r.left + 30));
      box.style.top = top + 'px';
      box.style.left = left + 'px';
    } else {
      box.style.top = '20vh';
      box.style.left = 'calc(50% - 210px)';
    }
  }

  $('tour-next').addEventListener('click', function () { showTourStep(tourStep + 1); });
  $('tour-skip').addEventListener('click', function () {
    clearTourHighlight();
    $('tour-back').classList.remove('show');
      $('tour-box').classList.remove('show');
    settings.tourDone = true;
    saveSettings();
  });
  $('btn-tour').addEventListener('click', function () { showTourStep(0); });

  /* ---------------- SSE ---------------- */

  var es = null;
  var lastSeenId = 0; // для экономного реконнекта: /events?after=<id>

  function noteId(e) {
    var n = parseInt(e.lastEventId || '0', 10);
    if (n > lastSeenId) lastSeenId = n;
  }

  function connectSSE() {
    es = new EventSource('/events' + (lastSeenId ? '?after=' + lastSeenId : ''));
    es.addEventListener('feed', function (e) {
      noteId(e);
      try {
        var item = JSON.parse(e.data);
        addFeedItem(item);
        // Сигнал (звук/уведомление) даёт только «пульс» — одна точка правды
        // с учётом пользовательского порога; реплей истории при подключении
        // не пищит задним числом.
        if (item.kind === 'claude-idle' && item.project) {
          var age = Date.now() - Date.parse(item.ts || 0);
          if (!isFinite(age) || age >= 20000) signalled[item.project] = true;
        }
      } catch (err) { /* пропускаем битое */ }
    });
    es.addEventListener('fs', function (e) {
      noteId(e);
      try {
        var d = JSON.parse(e.data); // {project, data:{files}}
        if (d.project === activeProject) markHot((d.data && d.data.files) || []);
      } catch (err) { /* ок */ }
    });
    es.addEventListener('git', function (e) {
      noteId(e);
      try {
        var d = JSON.parse(e.data); // {project, data}
        if (d.project === activeProject) renderGit(d.data);
      } catch (err) { /* ок */ }
    });
    es.addEventListener('pulse', function (e) {
      noteId(e);
      try {
        var d = JSON.parse(e.data); // {project, data}
        updateStateFromPulse(d.project, d.data);
      } catch (err) { /* ок */ }
    });
    es.addEventListener('session', function (e) {
      noteId(e);
      try {
        var d = JSON.parse(e.data);
        if (d.project) signalled[d.project] = false;
      } catch (err) { /* ок */ }
    });
    es.addEventListener('level', function (e) {
      noteId(e);
      try {
        var d = JSON.parse(e.data);
        if (!d.project || d.project === activeProject) setLevel(d.level);
      } catch (err) { /* ок */ }
    });
    es.onerror = function () {
      setClaudeState('unknown', 'сервер недоступен — переподключаюсь…');
    };
  }

  /* экономия на телефоне: свёрнутая вкладка через 45 с закрывает SSE,
     возвращение — переподключает и докачивает пропущенное (?after=) */
  var hiddenTimer = null;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (!hiddenTimer) {
        hiddenTimer = setTimeout(function () {
          hiddenTimer = null;
          if (es) {
            es.close();
            es = null;
          }
        }, 45000);
      }
    } else {
      if (hiddenTimer) {
        clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
      if (!es) connectSSE();
    }
  });

  function setLevel(lv) {
    level = lv;
    var badge = $('level-badge');
    if (lv === 'A') {
      badge.textContent = 'уровень A: полная картина';
      badge.className = 'badge level-a';
      badge.title = 'Штурман читает транскрипты Claude Code, файлы и git.';
    } else {
      badge.textContent = 'уровень B: файлы и git';
      badge.className = 'badge level-b';
      badge.title = 'Транскрипты Claude Code не найдены. Панель показывает файлы и git; запустите Claude Code в этой папке, чтобы увидеть полную картину.';
    }
    renderFeed();
  }

  /* ---------------- вкладки (телефон), свайп, меню ---------------- */

  var TAB_ORDER = ['feed', 'map', 'git', 'pulse'];

  function setTab(name) {
    if (TAB_ORDER.indexOf(name) === -1) return;
    document.body.setAttribute('data-tab', name);
    document.querySelectorAll('#tabbar button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab-btn') === name);
    });
    window.scrollTo(0, 0);
  }

  $('tabbar').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tab-btn]');
    if (btn) setTab(btn.getAttribute('data-tab-btn'));
  });

  /* свайп влево/вправо листает вкладки (только на телефоне) */
  var touchX = null, touchY = null;
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (touchX === null || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return; // не свайп
    if (document.querySelector('.modal-back.show')) return;             // в шторке не листаем
    var idx = TAB_ORDER.indexOf(document.body.getAttribute('data-tab') || 'feed');
    var next = idx + (dx < 0 ? 1 : -1);
    if (next >= 0 && next < TAB_ORDER.length) setTab(TAB_ORDER[next]);
  }, { passive: true });

  /* мобильное меню ☰ — пункты нажимают «настоящие» кнопки шапки */
  $('btn-menu').addEventListener('click', function (e) {
    e.stopPropagation();
    $('mobile-menu').classList.toggle('open');
  });
  $('mobile-menu').addEventListener('click', function (e) {
    var item = e.target.closest('[data-menu]');
    if (!item) return;
    $('mobile-menu').classList.remove('open');
    var target = $(item.getAttribute('data-menu'));
    if (target) target.click();
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#mobile-menu') && !e.target.closest('#btn-menu')) {
      $('mobile-menu').classList.remove('open');
    }
  });

  /* ---------------- тема ---------------- */

  function applyTheme() {
    var t = settings.theme || 'auto';
    if (t === 'auto') {
      t = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', t);
  }
  if (window.matchMedia) {
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
      if (settings.theme === 'auto') applyTheme();
    });
  }

  /* ---------------- горячие клавиши (компьютер) ---------------- */

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) {
      var name = TAB_ORDER[n - 1];
      setTab(name);
      // на десктопе все панели видны — подсветим и прокрутим нужную
      var panel = document.querySelector('.panel[data-tab="' + name + '"]');
      if (panel && window.innerWidth > 720) {
        panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        panel.classList.add('tour-target');
        setTimeout(function () { panel.classList.remove('tour-target'); }, 900);
      }
    } else if (e.key === '/') {
      e.preventDefault();
      if (window.innerWidth <= 720) setTab('feed');
      $('feed-search').focus();
    } else if (e.key === 'm' || e.key === 'ь') {
      settings.sound = !settings.sound;
      saveSettings();
      $('set-sound').checked = settings.sound;
      setClaudeState($('claude-state').className, settings.sound ? 'звук включён 🔔' : 'звук выключен 🔕');
      setTimeout(function () { if (lastPulse) updateStateFromPulse(activeProject, lastPulse); }, 1200);
    }
  });

  /* ---------------- разделитель колонок (компьютер) ---------------- */

  (function initSplitter() {
    var splitter = $('col-splitter');
    if (!splitter) return;
    try {
      var savedCol = localStorage.getItem('shturman-left-col');
      if (savedCol) document.querySelector('.layout').style.setProperty('--left-col', savedCol);
    } catch (e) { /* ок */ }
    var dragging = false;
    splitter.addEventListener('mousedown', function (e) {
      dragging = true;
      splitter.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var layout = document.querySelector('.layout');
      var rect = layout.getBoundingClientRect();
      var frac = (e.clientX - rect.left) / rect.width;
      frac = Math.max(0.28, Math.min(0.72, frac));
      var value = (frac * 100).toFixed(1) + '%';
      layout.style.setProperty('--left-col', value);
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove('dragging');
      try {
        var layoutEl = document.querySelector('.layout');
        localStorage.setItem('shturman-left-col', layoutEl.style.getPropertyValue('--left-col'));
      } catch (e) { /* ок */ }
    });
  })();

  /* ---------------- экран «Подключение» (телефон по QR) ---------------- */

  function openShare() {
    var body = $('share-body');
    body.innerHTML = '<div class="muted">Спрашиваю сервер…</div>';
    showModal('modal-share');
    fetch(api('/api/share')).then(function (r) { return r.json(); }).then(function (d) {
      body.innerHTML = '';
      if (!d.share) {
        var off = el('div');
        off.innerHTML =
          '<p><b>Доступ с телефона сейчас выключен</b> — и это нормально: по умолчанию ' +
          '«Штурман» слушает только этот компьютер (127.0.0.1), наружу не видно ничего.</p>' +
          '<p>Чтобы смотреть панель с телефона, перезапустите сервер с флагом:</p>' +
          '<div class="share-url">node server.js --share</div>' +
          '<p>Появится QR-код: телефон должен быть в той же Wi-Fi-сети. ' +
          'Ссылка защищена одноразовым токеном — без него сервер отвечает отказом. ' +
          'И даже с токеном сервер <b>только читает</b> проект: изменить с телефона ничего нельзя.</p>';
        body.appendChild(off);
        return;
      }
      if (d.owner && d.urls && d.urls.length) {
        var on = el('div');
        var urlsHtml = d.urls.map(function (u) { return '<div class="share-url">' + escapeHtml(u) + '</div>'; }).join('');
        on.innerHTML =
          '<p><b>Доступ включён.</b> Наведите камеру телефона на QR-код ' +
          '(телефон должен быть в той же Wi-Fi-сети):</p>' +
          (d.qr ? '<div class="qr-wrap"><img alt="QR-код со ссылкой на панель" src="' + d.qr + '"></div>' : '') +
          '<p>Или откройте ссылку вручную:</p>' + urlsHtml +
          '<p>Ссылка содержит одноразовый токен — не публикуйте её за пределами ' +
          'домашней сети. Сервер только читает проект: с телефона (как и отсюда) ' +
          'ничего изменить нельзя.</p>';
        body.appendChild(on);
        return;
      }
      var remote = el('div');
      remote.innerHTML =
        '<p><b>Вы уже подключены по share-ссылке.</b> Адреса сервера в сети: ' +
        (d.addresses || []).map(function (a) { return '<span class="mono">' + escapeHtml(a) + '</span>'; }).join(', ') +
        '.</p><p>QR-код с токеном показывается только на самом компьютере — чтобы доступ раздавал только хозяин.</p>';
      body.appendChild(remote);
    }).catch(function () {
      body.innerHTML = '<div class="empty-note">Не удалось узнать состояние share-режима.</div>';
    });
  }
  $('btn-share').addEventListener('click', openShare);
  document.body.addEventListener('click', function (e) {
    if (e.target.closest('[data-open-share]')) {
      hideModal('modal-settings');
      openShare();
    }
  });

  /* ---------------- проекты и запуск ---------------- */

  /** Применить состояние активного проекта из /api/state. */
  function applyState(s, firstBoot) {
    projects = s.projects || [{ id: s.project.id, name: s.project.name, path: s.project.path }];
    if (!activeProject) activeProject = s.project.id;
    if (firstBoot) {
      // реплей SSE мог прийти раньше списка проектов — пересобираем след
      // внимания теперь, когда известны корни проектов
      attention = {};
      feedItems.forEach(trackAttention);
    }
    $('project-path').textContent = s.project.name + ' — ' + s.project.path;
    $('project-path').title = s.project.path;
    if (s.version) $('about-version').textContent = '⛵ Штурман v' + s.version;
    renderProjectSwitch();
    setLevel(s.level);
    if (s.git) renderGit(s.git);
    updateStateFromPulse(s.project.id, s.pulse || null);
    if (firstBoot && !s.looksLikeProject) {
      var note = el('div', 'feed-notice show');
      note.textContent = 'Эта папка не очень похожа на проект (нет package.json, .git или README). ' +
        'Ничего страшного — «Штурман» всё равно будет наблюдать. Проверьте только, ту ли папку вы открыли: ' + s.project.path;
      $('panel-feed').insertBefore(note, $('feed-notice'));
    }
  }

  function renderProjectSwitch() {
    var sel = $('project-switch');
    if (projects.length < 2) {
      sel.style.display = 'none';
      return;
    }
    sel.style.display = '';
    sel.innerHTML = '';
    projects.forEach(function (p) {
      var opt = el('option', '', '📁 ' + p.name);
      opt.value = p.id;
      opt.title = p.path;
      if (p.id === activeProject) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function switchProject(id) {
    if (id === activeProject) return;
    activeProject = id;
    // панели активного проекта — с чистого листа
    heat = {};
    treeData = null;
    openPaths = { '': true };
    lastPulse = null;
    viewingOldSession = null;
    oldSessionItems = [];
    $('feed-notice').classList.remove('show');
    fetch(api('/api/state')).then(function (r) { return r.json(); }).then(function (s) {
      applyState(s, false);
    });
    loadTree();
    renderFeed(); // лента отфильтруется по метке проекта
  }

  $('project-switch').addEventListener('change', function () {
    switchProject(this.value);
  });

  function boot() {
    applyTheme();
    // PWA: оболочка кэшируется, при недоступном сервере — понятная страница
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        /* http по локальной сети — SW недоступен, панель работает и так */
      });
    }
    fetch('/api/state').then(function (r) { return r.json(); }).then(function (s) {
      applyState(s, true);
      if (!settings.tourDone) showTourStep(0);
    });
    loadTree();
    loadGlossary();
    connectSSE();
    /* git обновляем и по таймеру — вдруг что-то поменялось мимо событий */
    setInterval(function () {
      fetch(api('/api/git')).then(function (r) { return r.json(); }).then(renderGit).catch(function () { /* ок */ });
    }, 15000);
    /* пересборка дерева раз в 20 с — mtime и новые файлы */
    setInterval(loadTree, 20000);
  }

  boot();
})();
