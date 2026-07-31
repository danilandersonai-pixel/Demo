#!/usr/bin/env node
'use strict';

// «Штурман» — локальная панель-наставник для тех, кто осваивает Claude Code.
//
// Запуск:   node server.js --project <путь> [--port 4517]
// Панель:   http://127.0.0.1:4517
//
// Приложение ТОЛЬКО НАБЛЮДАЕТ. Оно не пишет в наблюдаемый проект, вызывает
// git исключительно на чтение и слушает только петлевой интерфейс.

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');
var execFile = require('child_process').execFile;

var argsLib = require('./lib/args');
var busLib = require('./lib/bus');
var sseLib = require('./lib/sse');
var watcherLib = require('./lib/watcher');
var gitLib = require('./lib/git');
var treeLib = require('./lib/tree');
var transcriptLib = require('./lib/transcript');
var idleLib = require('./lib/idle');
var statsLib = require('./lib/stats');
var glossary = require('./lib/glossary');
var digestLib = require('./lib/digest');
var textdiff = require('./lib/textdiff');
var doctor = require('./lib/doctor');
var configLib = require('./lib/config');
var netLib = require('./lib/net');
var tokenLib = require('./lib/token');
var qr = require('./lib/qr');
var shortcuts = require('./lib/shortcuts');
var banner = require('./lib/banner');
var humanize = require('./lib/humanize');
var paths = require('./lib/paths');

var PKG = require('./package.json');
var PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Сборка приложения
// ---------------------------------------------------------------------------

function createApp(opts) {
  var projectRoot = opts.projectAbs || (opts.projects && opts.projects[0]);

  var bus = busLib.createBus();
  var hub = sseLib.createHub();
  var stats = statsLib.createStats();
  var detector = idleLib.createDetector({ idleMs: opts.idleMs });

  var state = {
    project: projectRoot,
    projectName: paths.baseName(projectRoot) || projectRoot,
    startedAt: Date.now(),
    level: 'B',
    levelReason: 'Транскрипты ещё не найдены',
    watchMode: 'starting',
    watchReason: null,
    transcriptDir: null,
    transcriptFile: null,
    sessionId: null,
    git: null,
    projectCheck: null,
    askEnabled: !!opts.ask,
    askAvailable: false,
    idleSeconds: Math.round(opts.idleMs / 1000),
    version: PKG.version
  };

  var watcher = null;
  var tailer = null;
  var gitTimer = null;
  var tickTimer = null;
  var lastGitFingerprint = '';

  // --- всё, что публикуется, проходит здесь ---------------------------------
  function emit(ev) {
    var published = bus.publish(ev);
    if (published) {
      stats.add(published);
      var transition = detector.activity(published, published.ts);
      hub.broadcast('event', published, published.id);
      if (transition && transition.type === 'resumed') {
        var resumed = bus.publish({ kind: 'session', action: 'resumed', source: 'shturman' });
        if (resumed) hub.broadcast('event', resumed, resumed.id);
      }
    }
    return published;
  }

  // Поглощённое дедупликацией событие ФС: в ленту не идёт, но карту обновляет.
  bus.events.on('silent', function (ev) {
    hub.broadcast('fs', ev);
  });

  // --- git ------------------------------------------------------------------

  function refreshGit(announce) {
    return gitLib.snapshot(projectRoot).then(function (snap) {
      var prev = state.git;
      state.git = snap;

      // Отпечаток: по нему понимаем, есть ли о чём сообщать в ленту.
      var fp = [
        snap.available ? '1' : '0',
        snap.branch || '',
        snap.summary ? snap.summary.total : 0,
        snap.commits && snap.commits[0] ? snap.commits[0].hash : ''
      ].join('|');

      if (announce && prev && fp !== lastGitFingerprint) {
        if (prev.branch && snap.branch && prev.branch !== snap.branch) {
          emit({ kind: 'git', action: 'branch', source: 'git', branch: snap.branch });
        }
        var prevHead = prev.commits && prev.commits[0] ? prev.commits[0].hash : null;
        var head = snap.commits && snap.commits[0] ? snap.commits[0] : null;
        if (head && prevHead && head.hash !== prevHead) {
          emit({
            kind: 'git', action: 'commit', source: 'git',
            subject: head.subject, hash: head.hash, short: head.short
          });
        }
        var prevCount = prev.summary ? prev.summary.total : 0;
        var count = snap.summary ? snap.summary.total : 0;
        if (count !== prevCount) {
          emit({ kind: 'git', action: 'dirty', source: 'git', count: count });
        }
      }
      lastGitFingerprint = fp;
      hub.broadcast('git', snap);
      return snap;
    }).catch(function (e) {
      state.git = { available: false, installed: false, reason: 'Ошибка обращения к git: ' + e.message };
      return state.git;
    });
  }

  // --- запуск наблюдателей ---------------------------------------------------

  function start() {
    return treeLib.looksLikeProject(projectRoot).then(function (check) {
      state.projectCheck = check;
      if (!check.isProject && check.reason) {
        bus.say('Похоже, это не папка проекта', check.reason, 'warn');
      }
      return refreshGit(false);
    }).then(function (snap) {
      if (!snap.available && snap.reason) {
        bus.say(snap.installed ? 'Git здесь не используется' : 'Git не найден', snap.reason, 'warn');
      }
      return startWatcher();
    }).then(function () {
      return startTailer();
    }).then(function () {
      startTimers();
      return state;
    });
  }

  function startWatcher() {
    watcher = watcherLib.createWatcher(projectRoot, {
      debounce: opts.debounce,
      poll: opts.poll,
      forcePoll: opts.forcePoll
    });
    watcher.events.on('mode', function (m) {
      state.watchMode = m.mode;
      state.watchReason = m.reason;
      if (m.reason) bus.say('Режим наблюдения за файлами: резервный', m.reason, 'info');
      hub.broadcast('state', publicState());
    });
    watcher.events.on('change', function (c) {
      emit({
        kind: 'file',
        action: c.action,
        source: 'fs',
        file: c.file,
        size: c.size,
        mtime: c.mtime,
        ts: c.ts
      });
    });
    return watcher.start();
  }

  function startTailer() {
    tailer = transcriptLib.createTailer(projectRoot, {
      fromStart: !opts.tailOnly
    });

    tailer.events.on('level', function (l) {
      state.level = l.level;
      state.levelReason = l.reason;
      state.transcriptDir = l.dir;
      state.transcriptFile = l.file;
      if (l.level === 'A') {
        bus.say('Штурман видит работу Клода',
          'Транскрипт сессии найден — в ленте будут все чтения, правки и команды.', 'info');
      } else {
        bus.say('Работаем без транскриптов (уровень B)',
          (l.reason || 'Транскрипт недоступен') +
          '. Лента будет показывать изменения файлов и git, но не действия Клода. ' +
          'Проверьте, что Claude Code запущен в этой же папке.', 'warn');
      }
      hub.broadcast('state', publicState());
    });

    tailer.events.on('session', function (s) {
      state.sessionId = s.id;
      state.transcriptFile = s.file;
      emit({
        kind: 'session', action: 'started', source: 'transcript',
        hint: 'Сессия ' + String(s.id).slice(0, 8) + '. Штурман читает её транскрипт' +
          (s.fromStart ? ' с самого начала.' : ' с текущего момента.')
      });
      hub.broadcast('state', publicState());
    });

    tailer.events.on('events', function (list) {
      list.forEach(function (ev) { emit(ev); });
      hub.broadcast('pulse', pulse());
    });

    return tailer.start();
  }

  function startTimers() {
    // Опрос git — не чаще раза в 4 секунды: он самый дорогой из наблюдателей.
    gitTimer = setInterval(function () { refreshGit(true); }, 4000);
    if (gitTimer.unref) gitTimer.unref();

    // Тик детектора остановки и уборка дедупликации.
    tickTimer = setInterval(function () {
      bus.sweep();
      var transition = detector.tick();
      if (transition && transition.type === 'waiting') {
        var ev = bus.publish({
          kind: 'session',
          action: 'idle',
          source: 'shturman',
          quietMs: transition.quietMs,
          stuck: transition.stuck
        });
        if (ev) {
          hub.broadcast('event', ev, ev.id);
          // Отдельный канал: клиент по нему звонит и шлёт уведомление,
          // не разбирая ленту.
          hub.broadcast('attention', {
            quietMs: transition.quietMs,
            stuck: transition.stuck,
            title: transition.stuck
              ? 'Команда не отвечает'
              : 'Клод остановился и ждёт вас',
            text: transition.stuck
              ? 'Начатая команда не завершилась уже ' + humanize.formatDuration(transition.quietMs) + '. Загляните в терминал.'
              : 'Новых действий нет ' + humanize.formatDuration(transition.quietMs) + '. Скорее всего, нужен ваш ответ.'
          });
        }
      } else if (transition && transition.type === 'ended') {
        var ended = bus.publish({ kind: 'session', action: 'ended', source: 'shturman' });
        if (ended) hub.broadcast('event', ended, ended.id);
      }
      hub.broadcast('pulse', pulse());
    }, 2000);
    if (tickTimer.unref) tickTimer.unref();
  }

  function stop() {
    if (gitTimer) clearInterval(gitTimer);
    if (tickTimer) clearInterval(tickTimer);
    if (watcher) watcher.stop();
    if (tailer) tailer.stop();
    hub.close();
  }

  // --- срезы состояния -------------------------------------------------------

  function pulse() {
    var snap = stats.snapshot({ tokens: tailer ? tailer.tokens() : null });
    snap.detector = {
      state: detector.state(),
      quietMs: detector.quietMs(),
      idleMs: detector.idleMs(),
      pendingTools: detector.pendingTools()
    };
    snap.clients = hub.count();
    return snap;
  }

  function publicState() {
    return {
      project: state.project,
      projectName: state.projectName,
      startedAt: state.startedAt,
      level: state.level,
      levelReason: state.levelReason,
      watchMode: state.watchMode,
      watchReason: state.watchReason,
      transcriptDir: state.transcriptDir,
      transcriptFile: state.transcriptFile,
      sessionId: state.sessionId,
      projectCheck: state.projectCheck,
      askEnabled: state.askEnabled,
      askAvailable: state.askAvailable,
      idleSeconds: Math.round(detector.idleMs() / 1000),
      glossarySize: glossary.count,
      version: state.version,
      node: process.version,
      platform: process.platform
    };
  }

  return {
    bus: bus,
    hub: hub,
    stats: stats,
    detector: detector,
    state: state,
    publicState: publicState,
    pulse: pulse,
    refreshGit: refreshGit,
    start: start,
    stop: stop,
    watcher: function () { return watcher; },
    tailer: function () { return tailer; },
    emit: emit
  };
}

// ---------------------------------------------------------------------------
// Реестр проектов
// ---------------------------------------------------------------------------

// Панель умеет следить сразу за несколькими папками: каждая получает свой
// экземпляр приложения, а клиент выбирает нужную параметром ?project=<ключ>.
// Ключ — короткое имя папки; при совпадении имён добавляется номер.
function createRegistry(opts) {
  var byKey = new Map();
  var order = [];

  (opts.projects || [opts.projectAbs]).forEach(function (abs) {
    var base = paths.baseName(abs) || abs;
    var key = base;
    var n = 2;
    while (byKey.has(key)) key = base + '-' + (n++);
    var appOpts = Object.assign({}, opts, { projectAbs: abs, project: abs });
    var app = createApp(appOpts);
    byKey.set(key, { key: key, app: app, opts: appOpts, path: abs });
    order.push(key);
  });

  return {
    // Неизвестный ключ молча отдаёт основной проект: панель не должна
    // ломаться от старой ссылки в закладках.
    get: function (key) {
      var entry = key && byKey.get(String(key));
      return (entry || byKey.get(order[0])).app;
    },
    entry: function (key) {
      return (key && byKey.get(String(key))) || byKey.get(order[0]);
    },
    keyOf: function (key) {
      return (key && byKey.has(String(key))) ? String(key) : order[0];
    },
    list: function () {
      return order.map(function (k) {
        var e = byKey.get(k);
        return {
          key: k,
          path: e.path,
          name: paths.baseName(e.path) || e.path,
          level: e.app.state.level,
          branch: e.app.state.git && e.app.state.git.branch,
          waiting: e.app.detector.state() === 'waiting'
        };
      });
    },
    all: function () { return order.map(function (k) { return byKey.get(k).app; }); },
    size: function () { return order.length; },
    startAll: function () {
      return order.reduce(function (chain, k) {
        return chain.then(function () { return byKey.get(k).app.start(); });
      }, Promise.resolve());
    },
    stopAll: function () {
      order.forEach(function (k) { byKey.get(k).app.stop(); });
    }
  };
}

// Одиночное приложение тоже приводим к виду реестра — так маршруты не
// разветвляются на «один проект / много проектов».
function asRegistry(appOrRegistry, opts) {
  if (appOrRegistry && typeof appOrRegistry.get === 'function' && typeof appOrRegistry.list === 'function') {
    return appOrRegistry;
  }
  var app = appOrRegistry;
  var key = paths.baseName(opts.projectAbs) || 'project';
  return {
    get: function () { return app; },
    entry: function () { return { key: key, app: app, opts: opts, path: opts.projectAbs }; },
    keyOf: function () { return key; },
    list: function () {
      return [{
        key: key, path: opts.projectAbs, name: key,
        level: app.state.level,
        branch: app.state.git && app.state.git.branch,
        waiting: app.detector.state() === 'waiting'
      }];
    },
    all: function () { return [app]; },
    size: function () { return 1; },
    startAll: function () { return app.start(); },
    stopAll: function () { app.stop(); }
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

function sendJson(res, code, data) {
  var body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, code, text, mime) {
  var body = Buffer.from(String(text), 'utf8');
  res.writeHead(code, {
    'Content-Type': mime || 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

// Раздача статики. Единственный каталог — public/, выход за его пределы
// исключён проверкой относительного пути.
function serveStatic(res, pathname) {
  var rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  var abs = path.resolve(PUBLIC_DIR, rel);
  if (path.relative(PUBLIC_DIR, abs).indexOf('..') === 0) {
    return sendText(res, 403, 'Нет доступа');
  }
  fs.readFile(abs, function (err, data) {
    if (err) return sendText(res, 404, 'Не найдено: ' + rel);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var max = limit || 256 * 1024;
    req.on('data', function (c) {
      size += c.length;
      if (size > max) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function createServer(appOrRegistry, opts, sharedGuard) {
  var registry = asRegistry(appOrRegistry, opts);
  // Без --share охранник пускает всех: сервер и так слушает только петлю.
  var guard = sharedGuard || tokenLib.createGuard({ enabled: !!(opts && opts.share) });

  var server = http.createServer(function (req, res) {
    var parsed = url.parse(req.url, true);
    var pathname = decodeURIComponent(parsed.pathname);
    var q = parsed.query;

    // Какой проект имеется в виду. Всё ниже работает с этой парой.
    var app = registry.get(q.project);
    var projectRoot = registry.entry(q.project).path;

    // Панель локальная, но заголовок явно запрещает встраивание в чужие
    // страницы: чужой сайт не должен видеть содержимое ваших файлов.
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    // --- проверка ключа доступа ---------------------------------------------
    // Всё, кроме страницы отказа и манифеста, требует ключа в share-режиме.
    var verdict = guard.check(req, q);
    if (!verdict.allowed && !isPublicPath(pathname)) {
      return sendDenied(res, pathname, verdict);
    }
    // Пришли по ссылке с ключом — кладём его в куку, чтобы дальше работало
    // без «хвоста» в адресе и переживало переходы по страницам.
    if (verdict.allowed && guard.enabled() && q[tokenLib.QUERY_NAME]) {
      var cookie = guard.cookieHeader();
      if (cookie) res.setHeader('Set-Cookie', cookie);
    }

    // --- подключение с телефона -------------------------------------------------
    if (pathname === '/api/connect') {
      return sendJson(res, 200, connectInfo(guard, opts));
    }

    // QR-код отдаём картинкой: в разметке он не нужен, а <img> кэшируется.
    if (pathname === '/api/connect/qr.svg') {
      var info = connectInfo(guard, opts);
      if (!info.url) return sendText(res, 404, 'Нет адреса в локальной сети', 'text/plain; charset=utf-8');
      var svg = qr.toSvg(info.url, { scale: 8, dark: '#0d1117', light: '#ffffff' });
      return sendText(res, 200, svg, 'image/svg+xml; charset=utf-8');
    }

    // Сброс ключа: все выданные ссылки перестают работать.
    if (pathname === '/api/connect/rotate' && req.method === 'POST') {
      if (!guard.enabled()) {
        return sendJson(res, 400, { error: 'Общий доступ выключен — сбрасывать нечего.' });
      }
      guard.rotate();
      return sendJson(res, 200, connectInfo(guard, opts));
    }

    // Кто сейчас смотрит панель.
    if (pathname === '/api/connect/devices') {
      return sendJson(res, 200, {
        devices: guard.devices(),
        rejected: guard.rejectedCount(),
        enabled: guard.enabled()
      });
    }

    // --- список проектов ------------------------------------------------------
    if (pathname === '/api/projects') {
      return sendJson(res, 200, {
        projects: registry.list(),
        active: registry.keyOf(q.project)
      });
    }

    // --- поток событий ------------------------------------------------------
    if (pathname === '/api/stream') {
      var lastId = Number(req.headers['last-event-id'] || q.lastId || 0);
      app.hub.attach(req, res, {
        snapshot: {
          state: withProject(app.publicState(), registry, q.project),
          events: app.bus.since(lastId),
          pulse: app.pulse(),
          git: app.state.git
        },
        lastId: app.bus.lastId()
      });
      return;
    }

    // --- состояние ----------------------------------------------------------
    if (pathname === '/api/state') {
      return sendJson(res, 200, {
        state: withProject(app.publicState(), registry, q.project),
        pulse: app.pulse(),
        git: app.state.git,
        events: app.bus.all()
      });
    }

    if (pathname === '/api/pulse') {
      return sendJson(res, 200, app.pulse());
    }

    // --- карта проекта -------------------------------------------------------
    if (pathname === '/api/tree') {
      return treeLib.scan(projectRoot).then(function (t) {
        sendJson(res, 200, t);
      }).catch(function (e) {
        sendJson(res, 500, { error: 'Не удалось прочитать папку проекта: ' + e.message });
      });
    }

    if (pathname === '/api/file') {
      var rel = String(q.path || '');
      if (!rel) return sendJson(res, 400, { error: 'Не указан путь к файлу.' });
      if (paths.relativeToProject(projectRoot, path.resolve(projectRoot, rel)) === null) {
        return sendJson(res, 403, { error: 'Файл вне проекта — Штурман его не показывает.' });
      }
      return treeLib.fileCard(projectRoot, rel).then(function (card) {
        if (!app.state.git || !app.state.git.available) {
          return applyFallbackDiff(app, card, rel, 'Проект не под git');
        }
        return gitLib.fileDiff(projectRoot, rel).then(function (d) {
          if (!d.diff || !d.diff.length) {
            return applyFallbackDiff(app, card, rel, 'Git об этом файле ничего не знает');
          }
          card.diff = d.diff;
          card.diffSource = d.source;
          card.diffNote = diffNote(d);
          return card;
        });
      }).then(function (card) {
        sendJson(res, 200, card);
      }).catch(function (e) {
        sendJson(res, 500, { error: e.message });
      });
    }

    // --- git -----------------------------------------------------------------
    if (pathname === '/api/git') {
      return app.refreshGit(false).then(function (snap) { sendJson(res, 200, snap); });
    }

    if (pathname === '/api/git/diff') {
      var f = String(q.path || '');
      if (!f) return sendJson(res, 400, { error: 'Не указан путь.' });
      if (paths.relativeToProject(projectRoot, path.resolve(projectRoot, f)) === null) {
        return sendJson(res, 403, { error: 'Файл вне проекта.' });
      }
      var gitReady = app.state.git && app.state.git.available;
      var pending = gitReady
        ? gitLib.fileDiff(projectRoot, f)
        : Promise.resolve({ source: 'none', diff: [] });
      return pending.then(function (d) {
        if (d.diff && d.diff.length) {
          return sendJson(res, 200, { path: f, diff: d.diff, source: d.source, note: diffNote(d) });
        }
        // Git ничего не показал — пробуем восстановить из транскрипта.
        var card = applyFallbackDiff(app, { path: f }, f,
          gitReady ? 'Git об этом файле ничего не знает' : 'Проект не под git');
        sendJson(res, 200, {
          path: f, diff: card.diff || [], source: card.diffSource, note: card.diffNote
        });
      });
    }

    if (pathname === '/api/git/commit') {
      var sha = String(q.sha || '');
      return gitLib.commitDiff(projectRoot, sha).then(function (d) {
        sendJson(res, 200, d);
      });
    }

    // --- словарь --------------------------------------------------------------
    if (pathname === '/api/glossary') {
      if (q.term) {
        var term = glossary.get(String(q.term));
        return sendJson(res, 200, term || { error: 'Термин не найден.' });
      }
      return sendJson(res, 200, { terms: glossary.all(), count: glossary.count });
    }

    // --- журнал сессий ----------------------------------------------------------
    if (pathname === '/api/sessions') {
      var dir = app.tailer() ? app.tailer().dir() : null;
      if (!dir) {
        return sendJson(res, 200, {
          sessions: [],
          note: 'Транскрипты не найдены — журнал прошлых сессий недоступен.'
        });
      }
      return transcriptLib.describeSessions(dir, 40).then(function (list) {
        sendJson(res, 200, { sessions: list, active: app.state.sessionId, dir: dir });
      }).catch(function (e) {
        sendJson(res, 500, { error: e.message });
      });
    }

    if (pathname.indexOf('/api/session/') === 0) {
      var id = pathname.slice('/api/session/'.length);
      // Идентификатор сессии — UUID; всё остальное отвергаем, чтобы никто не
      // подставил путь наружу.
      if (!/^[A-Za-z0-9._-]{4,120}$/.test(id) || id.indexOf('..') !== -1) {
        return sendJson(res, 400, { error: 'Некорректный идентификатор сессии.' });
      }
      var sdir = app.tailer() ? app.tailer().dir() : null;
      if (!sdir) return sendJson(res, 404, { error: 'Каталог транскриптов не найден.' });
      var file = path.join(sdir, id + '.jsonl');
      if (path.relative(sdir, file).indexOf('..') === 0) {
        return sendJson(res, 400, { error: 'Некорректный идентификатор сессии.' });
      }
      return transcriptLib.readSession(file, { projectRoot: projectRoot }).then(function (s) {
        // Прогоняем через humanize, чтобы архив выглядел как живая лента.
        var enriched = s.events.map(function (ev, i) {
          var h = humanize.humanize(ev);
          return Object.assign({}, ev, {
            id: i + 1, icon: h.icon, title: h.title, hint: h.hint, level: ev.level || h.level
          });
        });
        sendJson(res, 200, { id: id, events: enriched, tokens: s.tokens, counters: s.counters });
      }).catch(function (e) {
        sendJson(res, 404, { error: 'Сессию прочитать не удалось: ' + e.message });
      });
    }

    // --- дайджест ----------------------------------------------------------------
    if (pathname === '/api/digest') {
      var evs = app.bus.all();
      var md = digestLib.build(evs, {
        projectName: app.state.projectName,
        stats: app.pulse(),
        git: app.state.git,
        tokens: app.tailer() ? app.tailer().tokens() : null,
        level: app.state.level
      });
      if (q.download) {
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="' + digestLib.suggestFilename() + '"'
        });
        return res.end(md);
      }
      return sendJson(res, 200, { markdown: md, filename: digestLib.suggestFilename() });
    }

    // --- приём хуков (необязательный источник, см. DECISIONS.md) -------------
    if (pathname === '/api/hook' && req.method === 'POST') {
      return readBody(req).then(function (body) {
        var data = {};
        try { data = JSON.parse(body || '{}'); } catch (e) { data = { raw: body }; }
        var name = String(data.hook_event_name || data.event || 'Hook');
        if (name === 'Stop' || name === 'SubagentStop') {
          var t = app.detector.stopHook();
          if (t) {
            var ev = app.bus.publish({
              kind: 'session', action: 'idle', source: 'hook', quietMs: t.quietMs
            });
            if (ev) {
              app.hub.broadcast('event', ev, ev.id);
              app.hub.broadcast('attention', {
                quietMs: t.quietMs,
                title: 'Клод закончил и ждёт вас',
                text: 'Пришёл сигнал завершения от Claude Code.'
              });
            }
          }
        } else {
          app.emit({
            kind: 'system', action: 'hook', source: 'hook',
            title: 'Хук: ' + name,
            hint: humanize.shorten(JSON.stringify(data), 160)
          });
        }
        sendJson(res, 200, { ok: true });
      }).catch(function (e) {
        sendJson(res, 400, { error: e.message });
      });
    }

    // --- «Спроси Клода» (по умолчанию выключено) -------------------------------
    if (pathname === '/api/ask' && req.method === 'POST') {
      if (!app.state.askEnabled) {
        return sendJson(res, 403, {
          error: 'Функция «Спроси Клода» выключена. Она расходует ваши лимиты — включите её флагом --ask при запуске.'
        });
      }
      return readBody(req).then(function (body) {
        var data = {};
        try { data = JSON.parse(body || '{}'); } catch (e) { /* пустой запрос */ }
        var question = String(data.prompt || '').slice(0, 4000);
        if (!question.trim()) return sendJson(res, 400, { error: 'Пустой вопрос.' });
        askClaude(question, projectRoot).then(function (answer) {
          sendJson(res, 200, answer);
        });
      }).catch(function (e) {
        sendJson(res, 400, { error: e.message });
      });
    }

    // --- настройки на лету ------------------------------------------------------
    if (pathname === '/api/settings' && req.method === 'POST') {
      return readBody(req).then(function (body) {
        var data = {};
        try { data = JSON.parse(body || '{}'); } catch (e) { /* пустой запрос */ }
        if (data.idleSeconds !== undefined) {
          app.detector.setIdleMs(Number(data.idleSeconds) * 1000);
        }
        var st = app.publicState();
        app.hub.broadcast('state', st);
        sendJson(res, 200, st);
      }).catch(function (e) {
        sendJson(res, 400, { error: e.message });
      });
    }

    if (pathname.indexOf('/api/') === 0) {
      return sendJson(res, 404, { error: 'Нет такого адреса: ' + pathname });
    }

    return serveStatic(res, pathname);
  });

  // Охранник доступен снаружи: тесты и режим --share обращаются к нему.
  server.guard = guard;
  return server;
}

// Что отдаётся без ключа доступа: сама страница отказа, иконки и манифест.
// Пускать сюда безопасно — ничего о проекте эти адреса не рассказывают.
function isPublicPath(pathname) {
  return pathname === '/denied' ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/offline.html' ||
    pathname.indexOf('/icons/') === 0;
}

// Отказ без ключа. Для браузера — понятная страница, для API — JSON.
function sendDenied(res, pathname, verdict) {
  if (pathname.indexOf('/api/') === 0) {
    return sendJson(res, 401, {
      error: 'Нужен ключ доступа',
      reason: verdict.reason,
      hint: 'Откройте панель по ссылке из QR-кода — ключ уже вшит в неё.'
    });
  }
  var html = [
    '<!DOCTYPE html><html lang="ru-RU"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Штурман — нужен ключ доступа</title>',
    '<style>',
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;',
    'background:#0d1117;color:#e6edf5;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}',
    '.b{max-width:420px;text-align:center}h1{font-size:20px;margin:16px 0 8px}',
    'p{color:#9aa8bb;font-size:15px}.i{font-size:52px}code{color:#7dd3fc;font-size:13px}',
    '</style></head><body><div class="b">',
    '<div class="i">🔒</div>',
    '<h1>Нужен ключ доступа</h1>',
    '<p>Эта панель открыта в локальной сети, и войти в неё можно только по ссылке ' +
    'с ключом — той самой, что зашита в QR-код.</p>',
    '<p>Отсканируйте код заново на экране «Подключение» на компьютере, ' +
    'где запущен Штурман.</p>',
    '<p><code>' + escapeHtml(verdict.reason || '') + '</code></p>',
    '</div></body></html>'
  ].join('');
  var body = Buffer.from(html, 'utf8');
  res.writeHead(401, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

/**
 * Данные экрана «Подключение»: адреса, ссылка, состояние доступа.
 * Собираются на каждый запрос — интерфейсы могут меняться на ходу
 * (человек перевтыкает Wi-Fi, поднимает VPN).
 */
function connectInfo(guard, opts, addressList) {
  var port = (opts && opts.port) || 4517;
  // Список адресов можно подать снаружи — так экран подключения проверяется
  // на выдуманных Wi-Fi и Docker, не завися от машины, где идут тесты.
  var addresses = addressList || netLib.lanAddresses();
  var best = addresses.filter(function (a) { return a.kind !== 'virtual'; })[0] || addresses[0] || null;
  var enabled = guard.enabled();

  return {
    enabled: enabled,
    port: port,
    localUrl: 'http://127.0.0.1:' + port + '/',
    url: enabled && best ? netLib.buildUrl(best.address, port, guard.token()) : null,
    address: best ? best.address : null,
    addresses: addresses.map(function (a) {
      return {
        address: a.address,
        label: a.label,
        kind: a.kind,
        url: enabled ? netLib.buildUrl(a.address, port, guard.token()) : null
      };
    }),
    hasNetwork: addresses.length > 0,
    rotatedAt: guard.rotatedAt(),
    devices: guard.devices(),
    rejected: guard.rejectedCount(),
    // Объяснение простыми словами — показывается прямо на экране.
    explain: enabled
      ? 'Панель видна другим устройствам в вашей сети — телефону, планшету, ' +
        'второму компьютеру. Войти можно только по ссылке с ключом: она в QR-коде ниже. ' +
        'Штурман по-прежнему только смотрит — изменить что-то в проекте с телефона нельзя.'
      : 'Сейчас панель открывается только на этом компьютере — так безопаснее по умолчанию: ' +
        'она показывает содержимое ваших файлов и вывод команд, и по умолчанию этого не ' +
        'должен видеть никто, кроме вас. Чтобы смотреть с телефона, перезапустите Штурман ' +
        'с флагом --share.'
  };
}

// Дополняем состояние сведениями о реестре: клиенту нужен свой ключ и
// список соседних проектов, чтобы нарисовать переключатель.
function withProject(state, registry, key) {
  return Object.assign({}, state, {
    projectKey: registry.keyOf(key),
    projects: registry.list()
  });
}

/**
 * Дифф без git: восстанавливаем из транскрипта.
 * У инструмента Edit в аргументах лежат old_string и new_string — этого
 * достаточно, чтобы показать нормальный построчный дифф вместо строчки
 * «недоступно». Работает на уровне B и для файлов вне контроля версий.
 */
function applyFallbackDiff(app, card, rel, why) {
  var found = null;
  var events = app.bus.all();
  for (var i = events.length - 1; i >= 0; i--) {
    var e = events[i];
    if (e.kind !== 'tool' || e.file !== rel || !e.args) continue;
    if (typeof e.args.old_string === 'string' || typeof e.args.new_string === 'string') {
      found = { old: e.args.old_string || '', now: e.args.new_string || '', ts: e.ts };
      break;
    }
    if (e.action === 'write' && typeof e.args.content === 'string') {
      found = { old: '', now: e.args.content, ts: e.ts, created: true };
      break;
    }
  }

  if (!found) {
    card.diff = null;
    card.diffSource = 'none';
    card.diffNote = why + ', и в этой сессии Клод его не правил — показать построчные изменения не из чего.';
    return card;
  }

  card.diff = [textdiff.buildFileDiff(rel, found.old, found.now)];
  card.diffSource = 'transcript';
  card.diffNote = why + '. Изменения восстановлены из транскрипта — это ' +
    (found.created ? 'то, чем Клод создал файл' : 'последняя правка Клода') + ', а не полная история файла.';
  return card;
}

function diffNote(d) {
  if (!d) return 'Дифф недоступен.';
  if (d.source === 'work') return 'Незакоммиченные изменения — то, что отличается от последнего сохранения.';
  if (d.source === 'staged') return 'Изменения, подготовленные к коммиту.';
  if (d.source === 'commit') return 'Файл сейчас совпадает с историей. Показан последний коммит, который его менял (' + (d.sha || '') + ').';
  return 'Дифф недоступен: файл не менялся или не под git.';
}

// Вызов `claude -p`. Отдельная функция, чтобы её было легко не вызывать.
function askClaude(question, cwd) {
  return new Promise(function (resolve) {
    execFile('claude', ['-p', question], {
      cwd: cwd,
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8'
    }, function (err, stdout, stderr) {
      if (err) {
        resolve({
          ok: false,
          error: err.code === 'ENOENT'
            ? 'Команда claude не найдена в PATH — спросить не получится.'
            : ('Не удалось получить ответ: ' + (stderr || err.message))
        });
        return;
      }
      resolve({ ok: true, answer: String(stdout || '').trim() });
    });
  });
}

// Есть ли вообще бинарь claude — чтобы не показывать бесполезную кнопку.
function probeClaude() {
  return new Promise(function (resolve) {
    execFile(process.platform === 'win32' ? 'where' : 'which', ['claude'], {
      timeout: 3000, windowsHide: true
    }, function (err, stdout) {
      resolve(!err && String(stdout || '').trim() !== '');
    });
  });
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------

function main(argv) {
  var opts;
  try {
    opts = argsLib.parse(argv);
  } catch (e) {
    process.stderr.write('\n  ' + e.message + '\n' + argsLib.HELP);
    process.exitCode = 2;
    return Promise.resolve();
  }

  if (opts.help) {
    process.stdout.write(opts.text + '\n');
    return Promise.resolve();
  }
  if (opts.version) {
    process.stdout.write(PKG.version + '\n');
    return Promise.resolve();
  }

  // Сохранённые настройки. Флаг всегда сильнее конфига.
  var loaded = configLib.load();
  opts = argsLib.applyConfig(opts, loaded.config);

  // Папки проверяем до всего остального: понятная ошибка лучше стека.
  var missing = opts.projects.filter(function (p) { return !fs.existsSync(p); });
  if (missing.length) {
    process.stderr.write('\n  ' + (missing.length === 1 ? 'Папки не существует' : 'Этих папок не существует') +
      ':\n' + missing.map(function (p) { return '    ' + p; }).join('\n') +
      '\n  Укажите правильный путь флагом --project.\n\n');
    process.exitCode = 2;
    return Promise.resolve();
  }

  // Ярлыки — отдельная команда: положили файлы и вышли, сервер не поднимаем.
  if (opts.installShortcuts) {
    return installShortcuts(opts);
  }

  // Самодиагностика вместо запуска: ничего не поднимаем, только смотрим.
  if (opts.check) {
    return doctor.run(opts).then(function (report) {
      process.stdout.write(doctor.format(report, opts));
      if (!report.ok) process.exitCode = 1;
    });
  }

  var host = opts.share ? '0.0.0.0' : '127.0.0.1';
  var guard = tokenLib.createGuard({ enabled: opts.share });

  var registry = createRegistry(opts);
  var app = registry.get();
  var resolvedPort = opts.port;
  // Запоминаем до подмены: иначе в баннере окажется «порт 4518 был занят»
  // как раз на том порту, где панель и поднялась.
  var requestedPort = opts.port;

  return netLib.findFreePort(opts.port, host).then(function (found) {
    // Порт, заданный руками, не подменяем молча: человек мог настроить под
    // него проброс или закладку. Скажем прямо, что он занят.
    if (found.shifted && opts.portExplicit) {
      var err = new Error('busy');
      err.code = 'EADDRINUSE';
      err.wanted = opts.port;
      throw err;
    }
    resolvedPort = found.port;
    opts.port = found.port;
    opts.portShifted = found.shifted;
    return registry.startAll();
  }).then(function () {
    return probeClaude();
  }).then(function (hasClaude) {
    registry.all().forEach(function (a) {
      a.state.askAvailable = hasClaude;
      a.state.share = opts.share;
      a.guard = guard;
      a.port = resolvedPort;
    });
    var server = createServer(registry, opts, guard);
    return new Promise(function (resolve, reject) {
      server.on('error', reject);
      // Без --share слушаем только петлю, как в первой версии.
      server.listen(resolvedPort, host, function () { resolve(server); });
    });
  }).then(function (server) {
    var localUrl = 'http://127.0.0.1:' + resolvedPort + '/';
    var addresses = opts.share ? netLib.lanAddresses() : [];
    var best = addresses.length ? addresses[0] : null;
    var shareUrl = best ? netLib.buildUrl(best.address, resolvedPort, guard.token()) : null;

    // Запоминаем проект и порт — в следующий раз поднимется там же.
    var cfg = loaded.config;
    opts.projects.forEach(function (p) { configLib.rememberProject(cfg, p, resolvedPort); });
    cfg.port = resolvedPort;
    configLib.pruneMissing(cfg);
    configLib.save(cfg);

    if (!opts.quiet && !opts.tui) {
      process.stdout.write(banner.render({
        localUrl: localUrl,
        port: resolvedPort,
        requestedPort: requestedPort,
        portShifted: !!opts.portShifted,
        share: !!opts.share,
        shareUrl: shareUrl,
        addresses: addresses,
        projects: registry.all().map(function (a) {
          var st = a.publicState();
          return {
            project: st.project,
            level: st.level,
            levelReason: st.levelReason,
            branch: a.state.git && a.state.git.available ? a.state.git.branch : null
          };
        })
      }));
    }

    if (opts.open) openBrowser(localUrl, opts.app);
    var tui = opts.tui ? startTui(app) : null;

    var shuttingDown = false;
    function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      if (tui) tui.stop();
      process.stdout.write('\n  Штурман закрывается. В вашем проекте ничего не изменено.\n\n');
      registry.stopAll();
      server.close(function () { process.exit(0); });
      // Если соединения висят, не ждём их вечно.
      setTimeout(function () { process.exit(0); }, 1500).unref();
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return { app: app, registry: registry, server: server, guard: guard, port: resolvedPort };
  }).catch(function (e) {
    if (e && e.code === 'EADDRINUSE') {
      var wanted = e.wanted || opts.port;
      process.stderr.write('\n  Порт ' + wanted + ' занят другой программой.' +
        '\n  Уберите флаг --port — Штурман сам найдёт свободный,' +
        '\n  либо укажите другой: shturman --port ' + (wanted + 1) + '\n\n');
    } else {
      process.stderr.write('\n  Не удалось запустить Штурман: ' + (e && e.message) + '\n\n');
    }
    process.exitCode = 1;
  });
}

// --- ярлыки ------------------------------------------------------------------

function installShortcuts(opts) {
  var target = opts.projectAbs;
  var results = shortcuts.install(target, {
    serverPath: path.join(__dirname, 'server.js')
  });

  var lines = ['', '  Ярлыки запуска в ' + target, ''];
  results.forEach(function (r) {
    if (r.status === 'created') {
      lines.push('  ✔ ' + r.name + ' — двойной клик на ' + r.os);
    } else if (r.status === 'skipped') {
      lines.push('  · ' + r.name + ' — ' + r.reason);
    } else {
      lines.push('  ✖ ' + r.name + ' — не получилось: ' + r.reason);
    }
  });
  lines.push('');
  lines.push('  Теперь Штурман запускается двойным кликом по файлу.');
  lines.push('  В macOS первый запуск может потребовать «Открыть всё равно»');
  lines.push('  в Системных настройках → Конфиденциальность и безопасность.');
  lines.push('');
  process.stdout.write(lines.join('\n'));

  if (results.some(function (r) { return r.status === 'failed'; })) process.exitCode = 1;
  return Promise.resolve();
}

// --- компактный режим для терминала -------------------------------------------

function startTui(app) {
  // Перерисовываем одну строку на месте: второй монитор не должен
  // превращаться в бесконечную простыню.
  var timer = setInterval(function () {
    var pulse = app.pulse();
    var events = app.bus.all();
    var last = events.length ? events[events.length - 1] : null;
    var text = banner.tuiLine({
      detectorState: pulse.detector.state,
      files: pulse.filesTouched,
      commands: pulse.commands,
      errors: pulse.errors,
      duration: pulse.durationText,
      branch: app.state.git && app.state.git.available ? app.state.git.branch : null,
      lastTitle: last ? humanize.shorten(last.title, 48) : null
    });
    if (process.stdout.isTTY) {
      process.stdout.write('\r\u001b[2K  ' + text);
    } else {
      process.stdout.write('  ' + text + '\n');
    }
  }, 1000);
  if (timer.unref) timer.unref();
  return { stop: function () { clearInterval(timer); process.stdout.write('\n'); } };
}

function openBrowser(addr, appMode) {
  // Режим киоска: отдельное окно без адресной строки и вкладок. Работает в
  // Chrome, Edge и других браузерах на Chromium; если такого нет, просто
  // открываем обычным способом.
  if (appMode) {
    var candidates = process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
         '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
         '/Applications/Yandex.app/Contents/MacOS/Yandex']
      : process.platform === 'win32'
        ? ['chrome', 'msedge']
        : ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'];

    var tryNext = function (i) {
      if (i >= candidates.length) return openBrowser(addr, false);
      execFile(candidates[i], ['--app=' + addr], { windowsHide: true }, function (err) {
        if (err) tryNext(i + 1);
      });
    };
    tryNext(0);
    return;
  }

  var cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  var args = process.platform === 'win32' ? ['/c', 'start', '', addr] : [addr];
  execFile(cmd, args, { windowsHide: true }, function () { /* не открылось — не беда */ });
}

module.exports = {
  createApp: createApp,
  createRegistry: createRegistry,
  createServer: createServer,
  main: main,
  askClaude: askClaude,
  installShortcuts: installShortcuts,
  connectInfo: connectInfo,
  isPublicPath: isPublicPath
};

if (require.main === module) {
  main(process.argv.slice(2));
}
