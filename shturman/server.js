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
var configMod = require('./lib/config');
var netinfo = require('./lib/netinfo');
var authMod = require('./lib/auth');
var shortcuts = require('./lib/shortcuts');

// qrcode — единственная (и необязательная) зависимость: без неё просто
// не будет картинки-QR, ссылка останется
var qrcode = null;
try { qrcode = require('qrcode'); } catch (e) { /* обойдёмся ссылкой */ }

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

if (args.command === 'shortcuts') {
  var made = shortcuts.writeShortcuts(process.cwd());
  console.log('Готово! Ярлыки созданы:');
  made.forEach(function (p) { console.log('  · ' + p); });
  console.log('Двойной клик по ярлыку поднимет «Штурман» для этой папки.');
  process.exit(0);
}

var SHARE = args.share;
var cfg = configMod.loadConfig();
var basePort = args.portGiven ? args.port : cfg.port;

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

// конфиг: запоминаем последние проекты и явный выбор порта
configMod.rememberProjects(cfg, args.projects);
if (args.portGiven) cfg.port = args.port;
configMod.saveConfig(cfg);

var auth = authMod.createAuth(SHARE);

/* ------------------------------------------------------------------ */
/* Мониторы проектов                                                   */
/* ------------------------------------------------------------------ */

var hub = sse.createHub();
var monitors = [];      // в порядке аргументов; первый — по умолчанию
var byId = {};          // id → монитор

var feedTail = []; // последние события для --tui

args.projects.forEach(function (root) {
  // id считаем заранее: монитор шлёт первые события ещё из фабрики,
  // до присваивания переменной mon
  var id = paths.encodeProjectDir(path.resolve(root));
  var mon = monitorMod.createMonitor(root, {
    onFeed: function (item) {
      item.project = id;
      feedTail.push({ ts: item.ts, icon: item.icon, title: item.title });
      if (feedTail.length > 12) feedTail.shift();
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
 * что пришло не на localhost-имя. В share-режиме дополнительно пускаем
 * IP-литералы (телефон ходит по http://192.168.х.х:порт); домены — нет,
 * а без токена чужой запрос всё равно не пройдёт.
 */
function hostAllowed(req) {
  var host = String(req.headers.host || '').toLowerCase();
  var name = host.replace(/:\d+$/, '');
  if (name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1') return true;
  if (SHARE) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return true;   // IPv4-литерал
    if (/^\[[0-9a-f:]+\]$/.test(name)) return true;           // IPv6-литерал
  }
  return false;
}

/** Статика, которую можно отдавать по имени (включая PWA-файлы). */
var STATIC_ROUTES = {
  '/': 'index.html',
  '/app.js': 'app.js',
  '/style.css': 'style.css',
  '/favicon.svg': 'favicon.svg',
  '/manifest.json': 'manifest.json',
  '/sw.js': 'sw.js',
  '/offline.html': 'offline.html',
  '/icons/icon-192.png': 'icons/icon-192.png',
  '/icons/icon-512.png': 'icons/icon-512.png',
  '/icons/icon-maskable-512.png': 'icons/icon-maskable-512.png'
};

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  var route = parsed.pathname;
  var q = parsed.query || {};

  if (!hostAllowed(req)) {
    sendJson(res, 403, { error: 'Запрос пришёл с неожиданным именем хоста.' });
    return;
  }
  // share-режим: чужие устройства обязаны предъявить токен из ссылки/QR
  var access = auth.check(req);
  if (!access.ok) {
    sendJson(res, 403, {
      error: 'Нет доступа. Откройте панель по ссылке с токеном — её выдаёт QR-код на компьютере (экран «Подключение»).'
    });
    return;
  }
  if (access.viaQueryToken) {
    // токен пришёл в ссылке — ставим cookie, дальше можно ходить без ?t=
    res.setHeader('Set-Cookie', auth.cookieHeader());
  }
  if (req.method === 'POST' && route === '/api/ask') {
    return handleAsk(req, res);
  }
  if (req.method === 'POST' && route === '/api/revoke') {
    // отзыв доступа: новый токен + обрыв всех чужих подключений.
    // Проект это не трогает — меняется только пропуск в панель.
    if (!access.owner) {
      return sendJson(res, 403, { error: 'Отозвать доступ может только компьютер-хозяин.' });
    }
    auth.rotate();
    hub.dropClients(function (c) { return auth.isLoopback(c.ip); });
    return sendJson(res, 200, { ok: true, message: 'Доступ отозван: старая ссылка больше не работает, чужие подключения оборваны. Новый QR — на этом экране.' });
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Только чтение: «Штурман» ничего не меняет в проекте.' });
    return;
  }

  var mon = pickMonitor(q);

  if (STATIC_ROUTES[route]) {
    return sendStatic(res, STATIC_ROUTES[route]);
  }

  switch (route) {

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

    case '/api/devices': {
      // кто сейчас смотрит панель — видит только хозяин
      if (!access.owner) return sendJson(res, 403, { error: 'Список устройств видит только компьютер-хозяин.' });
      return sendJson(res, 200, {
        share: SHARE,
        devices: hub.clientsInfo().map(function (c) {
          return {
            ip: c.ip.replace(/^::ffff:/, ''),
            ua: c.ua,
            sinceMs: c.sinceMs,
            isThisComputer: auth.isLoopback(c.ip)
          };
        })
      });
    }

    case '/api/share': {
      // экран «Подключение»: полную ссылку с токеном и QR видит только
      // хозяин (запрос с самой машины) — телефону хватит знать, что доступ есть
      var payload = {
        share: SHARE,
        owner: !!access.owner,
        addresses: SHARE ? netinfo.lanAddresses().map(function (a) { return a.address; }) : [],
        port: PORT
      };
      if (!SHARE || !access.owner) {
        return sendJson(res, 200, payload);
      }
      var urls = payload.addresses.map(function (ip) {
        return netinfo.buildShareUrl(ip, PORT, auth.getToken());
      });
      payload.urls = urls;
      if (qrcode && urls.length) {
        return qrcode.toDataURL(urls[0], { margin: 1, width: 320 }).then(function (dataUrl) {
          payload.qr = dataUrl;
          sendJson(res, 200, payload);
        }).catch(function () {
          sendJson(res, 200, payload);
        });
      }
      return sendJson(res, 200, payload);
    }
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

/* ------------------------------------------------------------------ */
/* Запуск: свободный порт → баннер → браузер                            */
/* ------------------------------------------------------------------ */

var PORT = basePort; // уточнится после подбора свободного
var LISTEN_HOST = SHARE ? '0.0.0.0' : '127.0.0.1';

/** Открыть браузер по-родному для каждой ОС; неудача — не беда. */
function openBrowser(targetUrl) {
  var spawn = require('node:child_process').spawn;
  var cmd, cmdArgs;
  if (process.platform === 'win32') {
    cmd = 'cmd';
    cmdArgs = ['/c', 'start', '', targetUrl];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    cmdArgs = [targetUrl];
  } else {
    cmd = 'xdg-open';
    cmdArgs = [targetUrl];
  }
  if (args.app) {
    // режим киоска: отдельное окно без адресной строки (Chrome/Edge/Chromium)
    var chromes = process.platform === 'win32'
      ? ['chrome', 'msedge']
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['google-chrome', 'chromium', 'chromium-browser'];
    for (var i = 0; i < chromes.length; i++) {
      try {
        var child = spawn(chromes[i], ['--app=' + targetUrl], { detached: true, stdio: 'ignore' });
        child.on('error', function () { /* следующий кандидат не пробуем — упадём в обычный */ });
        child.unref();
        return;
      } catch (e) { /* пробуем следующий */ }
    }
  }
  try {
    var opener = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
    opener.on('error', function () { /* нет открывалки — адрес есть в баннере */ });
    opener.unref();
  } catch (e) { /* ок */ }
}

function banner() {
  var lines = [];
  lines.push('');
  lines.push('  ┌──────────────────────────────────────────────┐');
  lines.push('  │  ⛵ Штурман v' + VERSION + ' — панель для Claude Code   │');
  lines.push('  └──────────────────────────────────────────────┘');
  if (monitors.length === 1) {
    lines.push('  Смотрю за проектом: ' + monitors[0].root);
  } else {
    lines.push('  Смотрю за проектами:');
    monitors.forEach(function (m) { lines.push('    · ' + m.root); });
  }
  lines.push('  Источник данных: ' + (monitors[0].level() === 'A'
    ? 'транскрипты Claude Code + файлы + git (уровень A)'
    : 'файлы + git (уровень B — транскрипты появятся, когда Claude Code поработает здесь)'));
  lines.push('');
  if (!monitors[0].looksLikeProject()) {
    lines.push('');
    lines.push('  ⚠ Эта папка не очень похожа на проект. Возможно, вы хотели одну из недавних:');
    (cfg.recentProjects || []).slice(0, 3).forEach(function (p) {
      if (p !== monitors[0].root) lines.push('    · shturman --project "' + p + '"');
    });
  }
  lines.push('  Панель на этом компьютере:  http://127.0.0.1:' + PORT);
  if (SHARE) {
    var addrs = netinfo.lanAddresses();
    if (addrs.length) {
      lines.push('  Доступ по локальной сети ВКЛЮЧЁН (--share):');
      addrs.forEach(function (a) {
        lines.push('    📱 ' + netinfo.buildShareUrl(a.address, PORT, auth.getToken()) + '  (' + a.iface + ')');
      });
      lines.push('  Ссылка защищена одноразовым токеном; сервер только читает проект.');
    } else {
      lines.push('  ⚠ --share включён, но адрес в локальной сети не найден.');
    }
  } else {
    lines.push('  Телефон: перезапустите с флагом --share, появится QR-код.');
  }
  lines.push('  Остановить: Ctrl+C');
  lines.push('');
  console.log(lines.join('\n'));
}

/* --tui: компактный живой статус прямо в терминале (для второго монитора) */
function startTui() {
  function fmtDur(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + ' с';
    if (s < 3600) return Math.floor(s / 60) + ' мин';
    return Math.floor(s / 3600) + ' ч ' + Math.floor((s % 3600) / 60) + ' мин';
  }
  function render() {
    var p = monitors[0].pulse.snapshot();
    var state = '⚪ жду начала сессии';
    if (p.sessionStartMs != null) {
      if (p.idle && p.idleReason === 'end-turn') state = '🔔 КЛОД ЖДЁТ ВАС';
      else if (p.idle) state = '🕰 Клод давно молчит';
      else state = '🟢 Клод работает';
    }
    var lines = [];
    lines.push('⛵ Штурман --tui · ' + monitors.map(function (m) { return m.name; }).join(', ') +
      ' · панель: http://127.0.0.1:' + PORT);
    lines.push('');
    lines.push('  ' + state +
      (p.quietMs != null ? '   (тишина ' + Math.round(p.quietMs / 1000) + ' с)' : ''));
    lines.push('  файлов: ' + p.filesTouched + ' · команд: ' + p.commandsRun +
      ' · ошибок: ' + p.errorsSeen + ' · сессия: ' + fmtDur(p.durationMs || 0) +
      (p.tokens.approxOutput ? ' · токены ≈' + Math.round(p.tokens.approxOutput / 1000) + ' тыс' : ''));
    lines.push('');
    feedTail.slice(-6).forEach(function (f) {
      var t = f.ts ? new Date(f.ts).toLocaleTimeString('ru-RU').slice(0, 5) : '  :  ';
      lines.push('  ' + t + '  ' + f.icon + ' ' + f.title.slice(0, 90));
    });
    lines.push('');
    lines.push('  Ctrl+C — выход');
    process.stdout.write('\x1b[2J\x1b[H' + lines.join('\n') + '\n');
  }
  var t = setInterval(render, 2000);
  if (t.unref) t.unref();
  render();
}

netinfo.findFreePort(basePort, LISTEN_HOST).then(function (freePort) {
  PORT = freePort;
  server.listen(PORT, LISTEN_HOST, function () {
    if (args.tui) {
      startTui();
      return;
    }
    banner();
    if (PORT !== basePort) {
      console.log('  (порт ' + basePort + ' был занят — взял свободный ' + PORT + ')');
      console.log('');
    }
    if (SHARE && qrcode) {
      var addrs = netinfo.lanAddresses();
      if (addrs.length) {
        qrcode.toString(netinfo.buildShareUrl(addrs[0].address, PORT, auth.getToken()),
          { type: 'terminal', small: true },
          function (err, art) {
            if (!err && art) {
              console.log('  Наведите камеру телефона:');
              console.log(art.split('\n').map(function (l) { return '  ' + l; }).join('\n'));
            }
          });
      }
    }
    if (cfg.openBrowser && !args.noOpen) {
      openBrowser('http://127.0.0.1:' + PORT);
    }
  });
}).catch(function (err) {
  console.error('Не удалось запустить сервер: ' + (err && err.message));
  process.exit(1);
});

server.on('error', function (err) {
  console.error('Не удалось запустить сервер: ' + (err && err.message));
  process.exit(1);
});

process.on('SIGINT', function () {
  console.log('\n«Штурман» останавливается. Пока!');
  monitors.forEach(function (m) { m.stop(); });
  process.exit(0);
});
