'use strict';

/**
 * «Штурман» — локальная панель-наставник для новичка в Claude Code.
 * Только наблюдает: читает транскрипты Claude Code, файловую систему и git,
 * ничего не меняя в проекте. Сервер слушает исключительно 127.0.0.1.
 *
 * Запуск: node server.js [--project <путь>] [--port 4517]
 */

var http = require('node:http');
var fs = require('node:fs');
var path = require('node:path');
var url = require('node:url');

var cli = require('./lib/cli');
var paths = require('./lib/paths');
var git = require('./lib/git');
var tree = require('./lib/tree');
var sse = require('./lib/sse');
var pulseMod = require('./lib/pulse');
var watcherMod = require('./lib/watcher');
var transcript = require('./lib/transcript');
var humanize = require('./lib/humanize');
var glossary = require('./lib/glossary');
var filedoc = require('./lib/filedoc');

var args = cli.parseArgs(process.argv);
if (args.help) {
  console.log(cli.HELP);
  process.exit(0);
}
if (args.error) {
  console.error('Ошибка: ' + args.error);
  process.exit(1);
}
if (args.warning) console.warn(args.warning);

var PROJECT = args.project;
var PORT = args.port;

try {
  if (!fs.statSync(PROJECT).isDirectory()) throw new Error('не каталог');
} catch (e) {
  console.error('Не могу открыть папку проекта: ' + PROJECT);
  console.error('Проверьте путь и попробуйте ещё раз: node server.js --project <путь>');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Состояние                                                           */
/* ------------------------------------------------------------------ */

var hub = sse.createHub();
var recentFileChanges = {};   // rel → {mtimeMs, kind} — тепловой след карты

var pulse = pulseMod.createPulse(function (event) {
  pushEvent(event);
});

/** Нормализованное событие → humanize → SSE. */
function pushEvent(event) {
  var card = humanize.humanizeEvent(event, PROJECT);
  if (!card) return; // usage и прочее, что не показываем строкой
  hub.broadcast('feed', {
    ts: event.ts || new Date().toISOString(),
    kind: event.kind,
    icon: card.icon,
    title: card.title,
    category: card.category,
    tool: event.tool || null,
    input: event.input || null,
    output: event.output != null ? event.output : null,
    isError: !!event.isError,
    files: event.files || null,
    reason: event.reason || null,
    raw: event.raw || null
  });
}

/* --------------------------- Вотчер ФС ----------------------------- */

var watcher = watcherMod.createWatcher(PROJECT, function (changes) {
  var files = changes.map(function (c) { return c.file; }).filter(Boolean);
  if (!files.length) return;
  var now = Date.now();
  changes.forEach(function (c) {
    recentFileChanges[c.file] = { mtimeMs: now, kind: c.kind };
  });
  // след старше 10 минут выбрасываем, чтобы не рос без конца
  Object.keys(recentFileChanges).forEach(function (k) {
    if (now - recentFileChanges[k].mtimeMs > 600000) delete recentFileChanges[k];
  });
  pulse.feedFileChanges(files);
  pushEvent({ kind: 'file-change', ts: new Date().toISOString(), files: files });
  hub.broadcast('fs', { files: files });
});

/* --------------------------- Git-опрос ----------------------------- */

var lastGit = null;
var lastGitKey = '';

function pollGit() {
  git.collectGitInfo(PROJECT).then(function (info) {
    lastGit = info;
    var key = JSON.stringify([
      info.branch,
      info.status ? info.status.total : -1,
      info.commits.length ? info.commits[0].hash : ''
    ]);
    if (lastGitKey && key !== lastGitKey) {
      var text = describeGitChange(info);
      if (text) pushEvent({ kind: 'git-change', ts: new Date().toISOString(), text: text });
      hub.broadcast('git', publicGit(info));
    }
    lastGitKey = key;
  });
}

var prevBranch = null, prevHead = null;
function describeGitChange(info) {
  var msgs = [];
  if (info.branch && prevBranch && info.branch !== prevBranch) {
    msgs.push('Переключилась ветка: теперь «' + info.branch + '»');
  }
  var head = info.commits.length ? info.commits[0] : null;
  if (head && prevHead && head.hash !== prevHead) {
    msgs.push('Появился новый коммит: «' + head.subject + '»');
  }
  prevBranch = info.branch;
  prevHead = head ? head.hash : prevHead;
  if (!msgs.length) return null;
  return msgs.join('. ');
}

function publicGit(info) {
  if (!info) return null;
  return {
    available: info.available,
    isRepo: info.isRepo,
    branch: info.branch,
    branchMeaning: info.branchMeaning,
    status: info.status,
    commits: info.commits,
    diffstat: info.diffstat,
    error: info.error
  };
}

var gitTimer = setInterval(pollGit, 4000);
if (gitTimer.unref) gitTimer.unref();
pollGit();

/* ----------------------- Транскрипт (уровень A) --------------------- */

var transcriptDir = transcript.findTranscriptDir(PROJECT);
var level = transcriptDir ? 'A' : 'B';
var tailer = null;

if (transcriptDir) {
  tailer = transcript.createTailer(transcriptDir, {
    onEvents: function (events) {
      for (var i = 0; i < events.length; i++) {
        pulse.feed(events[i]);
        pushEvent(events[i]);
      }
      hub.broadcast('pulse', pulse.snapshot());
    },
    onSwitch: function (sessionId) {
      pulse.resetSession();
      pushEvent({ kind: 'session-switch', ts: new Date().toISOString() });
      hub.broadcast('session', { id: sessionId });
    }
  });
  tailer.start();
} else {
  // Каталог транскриптов может появиться позже (человек запустит Claude Code
  // после «Штурмана») — проверяем раз в 10 секунд.
  var findTimer = setInterval(function () {
    var dir = transcript.findTranscriptDir(PROJECT);
    if (!dir) return;
    clearInterval(findTimer);
    transcriptDir = dir;
    level = 'A';
    hub.broadcast('level', { level: 'A' });
    tailer = transcript.createTailer(dir, {
      onEvents: function (events) {
        for (var i = 0; i < events.length; i++) {
          pulse.feed(events[i]);
          pushEvent(events[i]);
        }
        hub.broadcast('pulse', pulse.snapshot());
      },
      onSwitch: function (sessionId) {
        pulse.resetSession();
        pushEvent({ kind: 'session-switch', ts: new Date().toISOString() });
        hub.broadcast('session', { id: sessionId });
      }
    });
    tailer.start();
  }, 10000);
  if (findTimer.unref) findTimer.unref();
}

/* Детектор остановки + периодический пульс */
var pulseTimer = setInterval(function () {
  pulse.check();
  hub.broadcast('pulse', pulse.snapshot());
}, 3000);
if (pulseTimer.unref) pulseTimer.unref();

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

var PUBLIC_DIR = path.join(__dirname, 'public');
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendStatic(res, rel) {
  var file = paths.safeJoin(PUBLIC_DIR, rel);
  if (!file) {
    res.writeHead(403);
    res.end('Нет доступа');
    return;
  }
  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Не найдено');
      return;
    }
    var ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  var route = parsed.pathname;
  var q = parsed.query || {};

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Только чтение: «Штурман» ничего не меняет.' });
    return;
  }

  switch (route) {
    case '/':
      return sendStatic(res, 'index.html');
    case '/app.js':
    case '/style.css':
    case '/favicon.svg':
      return sendStatic(res, route.slice(1));

    case '/events':
      return hub.attach(req, res);

    case '/api/state': {
      var sessions = transcriptDir ? transcript.listSessions(transcriptDir) : [];
      return sendJson(res, 200, {
        project: {
          path: paths.toDisplay(PROJECT),
          name: path.basename(PROJECT)
        },
        level: level,
        transcriptDir: transcriptDir ? paths.toDisplay(transcriptDir) : null,
        activeSession: tailer ? tailer.currentSession() : null,
        sessionsCount: sessions.length,
        watcherEngine: watcher.engine,
        git: publicGit(lastGit),
        pulse: pulse.snapshot(),
        looksLikeProject: looksLikeProject()
      });
    }

    case '/api/tree': {
      var t = tree.buildTree(PROJECT);
      return sendJson(res, 200, { tree: t, recent: recentFileChanges });
    }

    case '/api/file': {
      var rel = String(q.path || '');
      var abs = paths.safeJoin(PROJECT, rel);
      if (!abs) return sendJson(res, 403, { error: 'Путь выходит за пределы проекта.' });
      var st;
      try {
        st = fs.statSync(abs);
      } catch (e) {
        return sendJson(res, 404, { error: 'Файл не найден.' });
      }
      var info = {
        path: paths.toDisplay(rel),
        name: path.basename(abs),
        size: st.size,
        mtimeMs: Math.round(st.mtimeMs),
        isDir: st.isDirectory(),
        description: st.isDirectory() ? 'Папка.' : filedoc.describeFile(abs)
      };
      if (st.isDirectory() || !lastGit || !lastGit.isRepo) {
        return sendJson(res, 200, info);
      }
      return git.fileDiff(PROJECT, rel).then(function (d) {
        info.diff = { source: d.source, lines: d.lines.slice(0, 400) };
        sendJson(res, 200, info);
      });
    }

    case '/api/diff': {
      var relF = String(q.path || '');
      if (!paths.safeJoin(PROJECT, relF)) return sendJson(res, 403, { error: 'Путь выходит за пределы проекта.' });
      return git.fileDiff(PROJECT, relF).then(function (d) {
        sendJson(res, 200, d);
      });
    }

    case '/api/commit': {
      return git.commitDiff(PROJECT, String(q.hash || '')).then(function (d) {
        sendJson(res, 200, d);
      });
    }

    case '/api/git':
      return git.collectGitInfo(PROJECT).then(function (info) {
        lastGit = info;
        sendJson(res, 200, publicGit(info));
      });

    case '/api/glossary':
      return sendJson(res, 200, { terms: glossary.TERMS });

    case '/api/sessions': {
      if (!transcriptDir) return sendJson(res, 200, { sessions: [], level: 'B' });
      var list = transcript.listSessions(transcriptDir).map(function (s) {
        return { id: s.id, mtimeMs: Math.round(s.mtimeMs), size: s.size };
      });
      return sendJson(res, 200, { sessions: list, active: tailer ? tailer.currentSession() : null });
    }

    case '/api/session': {
      if (!transcriptDir) return sendJson(res, 404, { error: 'Транскрипты недоступны (уровень B).' });
      var id = String(q.id || '');
      if (!/^[0-9a-f-]{8,64}$/i.test(id)) return sendJson(res, 400, { error: 'Странный идентификатор сессии.' });
      var file = path.join(transcriptDir, id + '.jsonl');
      var events = transcript.readWholeSession(file, 1500);
      var feed = [];
      for (var i = 0; i < events.length; i++) {
        var card = humanize.humanizeEvent(events[i], PROJECT);
        if (!card) continue;
        feed.push({
          ts: events[i].ts,
          kind: events[i].kind,
          icon: card.icon,
          title: card.title,
          category: card.category,
          raw: events[i].raw || null
        });
      }
      return sendJson(res, 200, { id: id, events: feed });
    }

    case '/api/pulse':
      return sendJson(res, 200, pulse.snapshot());
  }

  sendJson(res, 404, { error: 'Такой страницы нет.' });
});

/** Похожа ли папка на проект (для мягкого сообщения при первом запуске). */
function looksLikeProject() {
  var markers = ['package.json', '.git', 'README.md', 'readme.md', 'pyproject.toml',
    'Cargo.toml', 'go.mod', 'index.html', 'src'];
  for (var i = 0; i < markers.length; i++) {
    try {
      fs.statSync(path.join(PROJECT, markers[i]));
      return true;
    } catch (e) { /* нет — смотрим дальше */ }
  }
  return false;
}

server.listen(PORT, '127.0.0.1', function () {
  console.log('');
  console.log('  ⛵ «Штурман» смотрит за проектом: ' + PROJECT);
  console.log('  Панель: http://127.0.0.1:' + PORT);
  console.log('  Источник данных: ' + (level === 'A'
    ? 'транскрипты Claude Code + файлы + git (уровень A)'
    : 'файлы + git (уровень B — транскрипты Claude Code не найдены)'));
  console.log('  Остановить: Ctrl+C');
  console.log('');
});

server.on('error', function (err) {
  if (err && err.code === 'EADDRINUSE') {
    console.error('Порт ' + PORT + ' уже занят. Попробуйте другой: node server.js --port ' + (PORT + 1));
  } else {
    console.error('Не удалось запустить сервер: ' + (err && err.message));
  }
  process.exit(1);
});

process.on('SIGINT', function () {
  console.log('\n«Штурман» останавливается. Пока!');
  watcher.stop();
  if (tailer) tailer.stop();
  process.exit(0);
});
