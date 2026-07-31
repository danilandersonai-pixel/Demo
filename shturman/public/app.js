/* «Штурман» — клиент. Ванильный JS, без сборки и внешних библиотек. */
(function () {
  'use strict';

  /* ---------------- настройки (localStorage) ---------------- */

  var settings = {
    sound: true,
    notif: false,
    quietSec: 90,
    tourDone: false,
    detail: false
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

  var feedItems = [];        // все события (живая лента)
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
  var signalledIdle = false; // уже сигналили об этой паузе?
  var gitState = null;
  var glossTerms = [];
  var level = null;

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

  var firstPulseSeen = false; // при загрузке страницы не пищим, если Клод уже стоял

  function fireIdleSignal(reason, quietMs) {
    if (signalledIdle) return;
    signalledIdle = true;
    if (!firstPulseSeen) return; // молча запоминаем состояние «уже стоит»
    playChime();
    if (reason === 'end-turn') {
      notify('Клод закончил и ждёт вас', 'Посмотрите его ответ в Claude Code.');
    } else {
      notify('Клод давно молчит', 'Тишина уже ' + Math.round((quietMs || 0) / 1000) + ' секунд. Возможно, он ждёт подтверждения.');
    }
  }

  /* ---------------- шапка: статус Клода ---------------- */

  function setClaudeState(mode, text) {
    var box = $('claude-state');
    box.className = mode;
    $('claude-state-text').textContent = text;
  }

  function updateStateFromPulse(p) {
    lastPulse = p;
    var isFirst = !firstPulseSeen;
    if (!p || p.sessionStartMs == null) {
      setClaudeState('unknown', level === 'B' ? 'транскриптов нет — слежу за файлами' : 'жду начала сессии');
      return;
    }
    var clientQuietMs = settings.quietSec * 1000;
    if (p.idle && p.idleReason === 'end-turn') {
      setClaudeState('waiting', 'Клод ждёт вас');
      fireIdleSignal('end-turn', p.quietMs);
    } else if (p.quietMs != null && p.quietMs >= clientQuietMs) {
      // порог «давно молчит» — настройка пользователя; серверные 90 с
      // здесь не главнее: и меньшие, и большие значения работают
      setClaudeState('waiting', 'Клод молчит…');
      fireIdleSignal('quiet', p.quietMs);
    } else if (p.idle) {
      // сервер считает паузой, но пользовательский порог ещё не истёк
      setClaudeState('working', 'Клод работает');
    } else {
      setClaudeState('working', 'Клод работает');
      signalledIdle = false;
    }
    firstPulseSeen = true;
    if (isFirst && (p.idle || (p.quietMs != null && p.quietMs >= settings.quietSec * 1000))) {
      signalledIdle = true; // Клод стоял ещё до открытия панели — без сигнала
    }
    renderPulse(p);
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
    return det;
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

  /** Полная пересборка — только для смены фильтра/поиска/режима/сессии. */
  function renderFeed() {
    var box = $('feed');
    box.innerHTML = '';
    var source = viewingOldSession ? oldSessionItems : feedItems;
    var shown = 0;
    for (var i = source.length - 1; i >= 0; i--) { // свежее — сверху
      var item = source[i];
      if (!passesFilter(item)) continue;
      box.appendChild(renderFeedItem(item));
      shown++;
      if (shown >= MAX_FEED_DOM) break;
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
    renderFeed();
  });
  if (settings.detail) {
    $('btn-detail').textContent = 'Подробно';
    $('btn-detail').classList.add('active');
  }

  $('feed-search').addEventListener('input', function () {
    feedQuery = this.value.trim();
    renderFeed();
  });

  $('feed-chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    feedFilter = chip.getAttribute('data-cat');
    this.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); });
    chip.classList.add('on');
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
    fetch('/api/tree').then(function (r) { return r.json(); }).then(function (data) {
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
    fetch('/api/file?path=' + encodeURIComponent(relPath))
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
    fetch('/api/commit?hash=' + encodeURIComponent(c.hash))
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

  function openSessions() {
    fetch('/api/sessions').then(function (r) { return r.json(); }).then(function (d) {
      var body = $('sessions-body');
      body.innerHTML = '';
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
    fetch('/api/session?id=' + encodeURIComponent(id))
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
  function connectSSE() {
    es = new EventSource('/events');
    es.addEventListener('feed', function (e) {
      try {
        var item = JSON.parse(e.data);
        addFeedItem(item);
        // Сигнал (звук/уведомление) даёт только «пульс» — одна точка правды
        // с учётом пользовательского порога; реплей истории при подключении
        // не пищит задним числом.
        if (item.kind === 'claude-idle') {
          var age = Date.now() - Date.parse(item.ts || 0);
          if (!isFinite(age) || age >= 20000) signalledIdle = true;
        }
      } catch (err) { /* пропускаем битое */ }
    });
    es.addEventListener('fs', function (e) {
      try {
        var d = JSON.parse(e.data);
        markHot(d.files || []);
      } catch (err) { /* ок */ }
    });
    es.addEventListener('git', function (e) {
      try { renderGit(JSON.parse(e.data)); } catch (err) { /* ок */ }
    });
    es.addEventListener('pulse', function (e) {
      try { updateStateFromPulse(JSON.parse(e.data)); } catch (err) { /* ок */ }
    });
    es.addEventListener('session', function () {
      signalledIdle = false;
    });
    es.addEventListener('level', function (e) {
      try {
        var d = JSON.parse(e.data);
        setLevel(d.level);
      } catch (err) { /* ок */ }
    });
    es.onerror = function () {
      setClaudeState('unknown', 'сервер недоступен — переподключаюсь…');
    };
  }

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

  /* ---------------- запуск ---------------- */

  function boot() {
    fetch('/api/state').then(function (r) { return r.json(); }).then(function (s) {
      $('project-path').textContent = s.project.name + ' — ' + s.project.path;
      $('project-path').title = s.project.path;
      setLevel(s.level);
      if (s.git) renderGit(s.git);
      if (s.pulse) updateStateFromPulse(s.pulse);
      if (!s.looksLikeProject) {
        var note = el('div', 'feed-notice show');
        note.textContent = 'Эта папка не очень похожа на проект (нет package.json, .git или README). ' +
          'Ничего страшного — «Штурман» всё равно будет наблюдать. Проверьте только, ту ли папку вы открыли: ' + s.project.path;
        $('panel-feed').insertBefore(note, $('feed-notice'));
      }
      if (!settings.tourDone) showTourStep(0);
    });
    loadTree();
    loadGlossary();
    connectSSE();
    /* git обновляем и по таймеру — вдруг что-то поменялось мимо событий */
    setInterval(function () {
      fetch('/api/git').then(function (r) { return r.json(); }).then(renderGit).catch(function () { /* ок */ });
    }, 15000);
    /* пересборка дерева раз в 20 с — mtime и новые файлы */
    setInterval(loadTree, 20000);
  }

  boot();
})();
