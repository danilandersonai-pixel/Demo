'use strict';

/**
 * «Штурман» — локальная панель-наставник для новичка в Claude Code.
 * Только наблюдает: читает транскрипты Claude Code, файловую систему и git,
 * ничего не меняя в проекте. Сервер слушает исключительно 127.0.0.1.
 *
 * Запуск: node server.js [--project <путь>]… [--port 4517]
 * Несколько --project — несколько папок в одной панели (переключатель).
 * Пер-проектная логика живёт в lib/monitor.js, здесь — HTTP и маршруты.
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
var transcript = require('./lib/transcript');
var humanize = require('./lib/humanize');
var glossary = require('./lib/glossary');
var filedoc = require('./lib/filedoc');
var monitorMod = require('./lib/monitor');

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

var PORT = args.port;

var VERSION = '0.0.0';
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || VERSION;
} catch (e) { /* без версии тоже жить можно */ }

args.projects.forEach(function (p) {
  try {
    if (!fs.statSync(p).isDirectory()) throw new Error('не каталог');
  } catch (e) {
    console.error('Не могу открыть папку проекта: ' + p);
    console.error('Проверьте путь и попробуйте ещё раз: node server.js --project <путь>');
    process.exit(1);
  }
});

/* ------------------------------------------------------------------ */
/* Мониторы проектов                                                   */
/* ------------------------------------------------------------------ */

var hub = sse.createHub();
var monitors = [];      // в порядке аргументов; первый — по умолчанию
var byId = {};          // id → монитор

args.projects.forEach(function (root) {
  // id считаем заранее: монитор шлёт первые события ещё из фабрики,
  // до присваивания переменной mon
  var id = paths.encodeProjectDir(path.resolve(root));
  var mon = monitorMod.createMonitor(root, {
    onFeed: function (item) {
      item.project = id;
      hub.broadcast('feed', item);
    },
    onTransient: function (type, data) {
      hub.transient(type, { project: id, data: data });
    },
    onBroadcast: function (type, data) {
      data.project = id;
      hub.broadcast(type, data);
    }
  });
  monitors.push(mon);
  byId[mon.id] = mon;
});

/** Монитор по параметру ?project= (по умолчанию — первый). */
function pickMonitor(q) {
  var id = String(q.project || '');
  return (id && byId[id]) || monitors[0];
}

function projectsList() {
  return monitors.map(function (m) {
    return { id: m.id, name: m.name, path: paths.toDisplay(m.root) };
  });
}

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

/**
 * Защита от DNS rebinding: браузер на чужом сайте может заставить запрос
 * прийти на 127.0.0.1, но заголовок Host там будет чужим — отклоняем всё,
 * что пришло не на localhost-имя.
 */
function hostAllowed(req) {
  var host = String(req.headers.host || '').toLowerCase();
  var name = host.replace(/:\d+$/, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1';
}

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  var route = parsed.pathname;
  var q = parsed.query || {};

  if (!hostAllowed(req)) {
    sendJson(res, 403, { error: 'Запрос пришёл с неожиданным именем хоста.' });
    return;
  }
  if (req.method === 'POST' && route === '/api/ask') {
    return handleAsk(req, res);
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Только чтение: «Штурман» ничего не меняет в проекте.' });
    return;
  }

  var mon = pickMonitor(q);

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
      var tDir = mon.transcriptDir();
      var sessions = tDir ? transcript.listSessions(tDir) : [];
      return sendJson(res, 200, {
        version: VERSION,
        projects: projectsList(),
        project: {
          id: mon.id,
          path: paths.toDisplay(mon.root),
          name: mon.name
        },
        level: mon.level(),
        transcriptDir: tDir ? paths.toDisplay(tDir) : null,
        activeSession: mon.activeSession(),
        sessionsCount: sessions.length,
        watcherEngine: mon.watcherEngine,
        git: mon.publicGit(),
        pulse: mon.pulse.snapshot(),
        looksLikeProject: mon.looksLikeProject()
      });
    }

    case '/api/tree': {
      var t = tree.buildTree(mon.root);
      return sendJson(res, 200, { tree: t, recent: mon.recent() });
    }

    case '/api/file': {
      var rel = String(q.path || '');
      var abs = paths.safeJoin(mon.root, rel);
      if (!abs) return sendJson(res, 403, { error: 'Путь выходит за пределы проекта.' });
      // симлинк внутри проекта не должен выводить чтение наружу
      try {
        var realTarget = fs.realpathSync(abs);
        var realRoot = fs.realpathSync(mon.root);
        if (realTarget !== realRoot && realTarget.indexOf(realRoot + path.sep) !== 0) {
          return sendJson(res, 403, { error: 'Путь выходит за пределы проекта (символическая ссылка).' });
        }
      } catch (e) {
        return sendJson(res, 404, { error: 'Файл не найден.' });
      }
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
      var lastGit = mon.lastGitInfo();
      if (st.isDirectory() || !lastGit || !lastGit.isRepo) {
        return sendJson(res, 200, info);
      }
      return git.fileDiff(mon.root, rel).then(function (d) {
        info.diff = { source: d.source, lines: d.lines.slice(0, 400) };
        sendJson(res, 200, info);
      });
    }

    case '/api/diff': {
      var relF = String(q.path || '');
      if (!paths.safeJoin(mon.root, relF)) return sendJson(res, 403, { error: 'Путь выходит за пределы проекта.' });
      return git.fileDiff(mon.root, relF).then(function (d) {
        sendJson(res, 200, d);
      });
    }

    case '/api/commit': {
      return git.commitDiff(mon.root, String(q.hash || '')).then(function (d) {
        sendJson(res, 200, d);
      });
    }

    case '/api/git':
      return mon.refreshGit().then(function (pub) {
        sendJson(res, 200, pub);
      });

    case '/api/glossary':
      return sendJson(res, 200, { terms: glossary.TERMS });

    case '/api/sessions': {
      var tDir2 = mon.transcriptDir();
      if (!tDir2) return sendJson(res, 200, { sessions: [], level: 'B' });
      var list = transcript.listSessions(tDir2).map(function (s) {
        return { id: s.id, mtimeMs: Math.round(s.mtimeMs), size: s.size };
      });
      return sendJson(res, 200, { sessions: list, active: mon.activeSession() });
    }

    case '/api/session': {
      var tDir3 = mon.transcriptDir();
      if (!tDir3) return sendJson(res, 404, { error: 'Транскрипты недоступны (уровень B).' });
      var id = String(q.id || '');
      if (!/^[0-9a-f-]{8,64}$/i.test(id)) return sendJson(res, 400, { error: 'Странный идентификатор сессии.' });
      var file = path.join(tDir3, id + '.jsonl');
      var events = transcript.readWholeSession(file, 1500);
      var feed = [];
      for (var i = 0; i < events.length; i++) {
        var card = humanize.humanizeEvent(events[i], mon.root);
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
      return sendJson(res, 200, mon.pulse.snapshot());
  }

  sendJson(res, 404, { error: 'Такой страницы нет.' });
});

/* ------------------------------------------------------------------ */
/* «Спроси Клода» (бонус, по умолчанию выключен в настройках панели)    */
/* ------------------------------------------------------------------ */

var askBusy = false;

/**
 * POST /api/ask {context: "..."} → короткое объяснение от `claude -p`.
 * Расходует лимиты пользователя, поэтому кнопка в панели появляется только
 * после явного включения в настройках. Проект при этом не трогается:
 * claude запускается в нейтральном каталоге, наружу уходит только текст
 * события, который пользователь и так видит на экране.
 */
function handleAsk(req, res) {
  if (askBusy) {
    return sendJson(res, 429, { error: 'Предыдущий вопрос ещё обрабатывается — подождите.' });
  }
  var body = '';
  var tooBig = false;
  req.on('data', function (chunk) {
    body += chunk;
    if (body.length > 32768) {
      tooBig = true;
      req.destroy();
    }
  });
  req.on('end', function () {
    if (tooBig) return sendJson(res, 413, { error: 'Слишком большой запрос.' });
    var context = '';
    try {
      context = String(JSON.parse(body || '{}').context || '').slice(0, 8000);
    } catch (e) {
      return sendJson(res, 400, { error: 'Непонятное тело запроса.' });
    }
    if (!context.trim()) return sendJson(res, 400, { error: 'Пустой вопрос.' });

    var prompt = 'Ты наставник новичка, который осваивает Claude Code и программирование. ' +
      'Ниже — событие из его сессии Claude Code. Объясни по-русски, простыми словами и ' +
      'без снисходительности, что это значит и зачем это было нужно. 2–4 предложения, без markdown.\n\n' +
      'Событие:\n' + context;

    askBusy = true;
    require('node:child_process').execFile('claude', ['-p', prompt], {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      cwd: require('node:os').tmpdir(),
      windowsHide: true
    }, function (err, stdout, stderr) {
      askBusy = false;
      if (err) {
        var why = err.code === 'ENOENT'
          ? 'Команда claude не найдена — «Спроси Клода» работает только там, где установлен Claude Code CLI.'
          : 'Не получилось спросить Клода: ' + String(stderr || err.message).slice(0, 300);
        return sendJson(res, 502, { error: why });
      }
      sendJson(res, 200, { answer: String(stdout).trim().slice(0, 4000) });
    });
  });
}

server.listen(PORT, '127.0.0.1', function () {
  console.log('');
  if (monitors.length === 1) {
    console.log('  ⛵ «Штурман» смотрит за проектом: ' + monitors[0].root);
  } else {
    console.log('  ⛵ «Штурман» смотрит за проектами:');
    monitors.forEach(function (m) { console.log('     · ' + m.root); });
  }
  console.log('  Панель: http://127.0.0.1:' + PORT);
  console.log('  Источник данных: ' + (monitors[0].level() === 'A'
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
  monitors.forEach(function (m) { m.stop(); });
  process.exit(0);
});
