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
var humanize = require('./lib/humanize');
var paths = require('./lib/paths');

var PKG = require('./package.json');
var PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Сборка приложения
// ---------------------------------------------------------------------------

function createApp(opts) {
  var projectRoot = opts.projectAbs;

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

function createServer(app, opts) {
  var projectRoot = opts.projectAbs;

  return http.createServer(function (req, res) {
    var parsed = url.parse(req.url, true);
    var pathname = decodeURIComponent(parsed.pathname);
    var q = parsed.query;

    // Панель локальная, но заголовок явно запрещает встраивание в чужие
    // страницы: чужой сайт не должен видеть содержимое ваших файлов.
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    // --- поток событий ------------------------------------------------------
    if (pathname === '/api/stream') {
      var lastId = Number(req.headers['last-event-id'] || q.lastId || 0);
      app.hub.attach(req, res, {
        snapshot: {
          state: app.publicState(),
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
        state: app.publicState(),
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
          card.diff = null;
          card.diffNote = 'Дифф недоступен: проект не под git.';
          return card;
        }
        return gitLib.fileDiff(projectRoot, rel).then(function (d) {
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
      return gitLib.fileDiff(projectRoot, f).then(function (d) {
        sendJson(res, 200, { path: f, diff: d.diff, source: d.source, note: diffNote(d) });
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

  // Папку проверяем до всего остального: понятная ошибка лучше стека.
  if (!fs.existsSync(opts.projectAbs)) {
    process.stderr.write('\n  Папки не существует: ' + opts.projectAbs +
      '\n  Укажите правильный путь флагом --project.\n\n');
    process.exitCode = 2;
    return Promise.resolve();
  }

  var app = createApp(opts);
  var server = createServer(app, opts);

  return app.start().then(function () {
    return probeClaude();
  }).then(function (hasClaude) {
    app.state.askAvailable = hasClaude;
    return new Promise(function (resolve, reject) {
      server.on('error', reject);
      // Только петля. Никакого 0.0.0.0 — см. DECISIONS.md, решение 10.
      server.listen(opts.port, '127.0.0.1', resolve);
    });
  }).then(function () {
    var addr = 'http://127.0.0.1:' + opts.port;
    if (!opts.quiet) printBanner(app, opts, addr);
    if (opts.open) openBrowser(addr);

    var shuttingDown = false;
    function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      process.stdout.write('\n  Штурман закрывается. В вашем проекте ничего не изменено.\n\n');
      app.stop();
      server.close(function () { process.exit(0); });
      // Если соединения висят, не ждём их вечно.
      setTimeout(function () { process.exit(0); }, 1500).unref();
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return { app: app, server: server };
  }).catch(function (e) {
    if (e && e.code === 'EADDRINUSE') {
      process.stderr.write('\n  Порт ' + opts.port + ' уже занят другой программой.' +
        '\n  Запустите с другим портом: node server.js --port ' + (opts.port + 1) + '\n\n');
    } else {
      process.stderr.write('\n  Не удалось запустить Штурман: ' + (e && e.message) + '\n\n');
    }
    process.exitCode = 1;
  });
}

function printBanner(app, opts, addr) {
  var s = app.publicState();
  var lines = [
    '',
    '  ╭──────────────────────────────────────────────╮',
    '  │  ШТУРМАН — панель-наставник для Claude Code  │',
    '  ╰──────────────────────────────────────────────╯',
    '',
    '  Панель:   ' + addr,
    '  Проект:   ' + s.project,
    '  Источник: ' + (s.level === 'A'
      ? 'уровень A — транскрипты Claude Code + файлы + git'
      : 'уровень B — только файлы и git (' + (s.levelReason || '') + ')'),
    '  Git:      ' + (app.state.git && app.state.git.available
      ? 'ветка ' + app.state.git.branch
      : 'недоступен — панель работает без него'),
    '',
    '  Откройте адрес в браузере. Остановить — Ctrl+C.',
    '  Штурман только наблюдает: он ничего не меняет в вашем проекте.',
    ''
  ];
  process.stdout.write(lines.join('\n'));
}

function openBrowser(addr) {
  var cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  var args = process.platform === 'win32' ? ['/c', 'start', '', addr] : [addr];
  execFile(cmd, args, { windowsHide: true }, function () { /* не открылось — не беда */ });
}

module.exports = { createApp: createApp, createServer: createServer, main: main, askClaude: askClaude };

if (require.main === module) {
  main(process.argv.slice(2));
}
