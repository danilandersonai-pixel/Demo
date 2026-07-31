'use strict';

// Самодиагностика: `node server.js --check`.
//
// Нужна ровно для одного вопроса из FAQ — «панель пустая, что делать».
// Вместо того чтобы объяснять новичку, куда лезть смотреть, Штурман
// проверяет всё сам и печатает список с галочками и понятными советами.
//
// Модуль возвращает данные; печатью занимается server.js.

var fs = require('fs');
var path = require('path');
var paths = require('./paths');
var gitLib = require('./git');
var treeLib = require('./tree');
var transcriptLib = require('./transcript');

// Одна проверка: что смотрели, чем кончилось, что делать, если плохо.
function check(name, status, detail, advice) {
  return { name: name, status: status, detail: detail, advice: advice || null };
}

var OK = 'ok';
var WARN = 'warn';
var FAIL = 'fail';

function checkNode() {
  var major = Number(String(process.versions.node).split('.')[0]);
  if (major >= 20) {
    return check('Node.js', OK, process.version + ' — подходит полностью');
  }
  if (major >= 18) {
    return check('Node.js', WARN, process.version + ' — работать будет',
      'На Node 18 наблюдение за файлами на Linux идёт опросом, а не системными ' +
      'событиями: изменения появятся с задержкой в пару секунд. На Node 20+ быстрее.');
  }
  return check('Node.js', FAIL, process.version + ' — слишком старая',
    'Штурману нужен Node.js 18 или новее. Обновите Node и запустите снова.');
}

function checkProject(projectRoot) {
  return treeLib.looksLikeProject(projectRoot).then(function (info) {
    if (info.isProject) {
      return check('Папка проекта', OK,
        projectRoot + ' — похоже на проект (' + info.markers.join(', ') + ')');
    }
    return check('Папка проекта', WARN, projectRoot + ' — на проект не похоже', info.reason);
  }).catch(function (e) {
    return check('Папка проекта', FAIL, projectRoot + ' — прочитать не удалось',
      e.message + '. Проверьте путь и права доступа.');
  });
}

function checkGit(projectRoot) {
  return gitLib.probe(projectRoot).then(function (p) {
    if (p.isRepo) {
      return check('Git', OK, 'репозиторий найден, ' + (p.version || 'git на месте'));
    }
    if (p.installed) {
      return check('Git', WARN, 'git есть, но папка не под контролем версий', p.reason);
    }
    return check('Git', WARN, 'git не найден в PATH', p.reason);
  });
}

function checkClaudeHome() {
  var home = paths.claudeHome();
  var projects = paths.claudeProjectsDir();
  try {
    fs.statSync(projects);
    var dirs = fs.readdirSync(projects).length;
    return check('Каталог Claude Code', OK,
      projects + ' — ' + dirs + ' шт. внутри');
  } catch (e) {
    return check('Каталог Claude Code', WARN, projects + ' — не найден',
      'Похоже, Claude Code на этой машине ещё не запускался, либо он настроен на ' +
      'другой каталог. Тогда укажите его переменной CLAUDE_CONFIG_DIR перед запуском ' +
      'Штурмана. Сейчас Штурман считает домашним каталогом ' + home + '.');
  }
}

function checkTranscripts(projectRoot) {
  return transcriptLib.findProjectDir(projectRoot).then(function (found) {
    if (!found || !found.dir) {
      return check('Транскрипты этого проекта', WARN, 'не найдены — будет уровень B',
        'Штурман ищет их в ' + paths.claudeProjectsDir() + ' по кодированному пути ' +
        '«' + paths.encodeProjectDir(projectRoot) + '» и перебором по полю cwd. ' +
        'Самая частая причина: Claude Code запущен в другой папке. Сверьте её с ' +
        projectRoot + '. Панель при этом остаётся полезной: карта проекта, git и ' +
        'словарь работают без транскриптов.');
    }
    return transcriptLib.describeSessions(found.dir, 5).then(function (list) {
      if (!list.length) {
        return check('Транскрипты этого проекта', WARN,
          'каталог есть (' + found.dir + '), но сессий в нём нет',
          'Запустите claude в папке ' + projectRoot + ' — как только он начнёт ' +
          'работать, Штурман сам перейдёт на уровень A.');
      }
      var newest = list[0];
      var ageMin = Math.round((Date.now() - newest.mtime) / 60000);
      return check('Транскрипты этого проекта', OK,
        list.length + ' шт., свежайший обновлялся ' + ageMin + ' мин назад' +
        ' (' + paths.baseName(newest.file) + ', найден способом «' + found.how + '»)');
    });
  }).catch(function (e) {
    return check('Транскрипты этого проекта', FAIL, 'ошибка при поиске', e.message);
  });
}

function checkWatch(projectRoot) {
  // Пробуем ровно то, чем пользуется вотчер, и сразу закрываем.
  return new Promise(function (resolve) {
    var w = null;
    try {
      w = fs.watch(projectRoot, { recursive: true, persistent: false }, function () {});
      w.close();
      resolve(check('Наблюдение за файлами', OK,
        'системное — изменения будут видны мгновенно'));
    } catch (e) {
      if (w) { try { w.close(); } catch (x) { /* уже закрыт */ } }
      resolve(check('Наблюдение за файлами', WARN,
        'рекурсивный режим недоступен — будет опрос',
        'Штурман будет пересматривать папку раз в несколько секунд. Всё работает, ' +
        'просто изменения появляются с небольшой задержкой. Период меняется флагом --poll.'));
    }
  });
}

/**
 * Готовность телефонного режима: есть ли адрес, по которому телефон
 * вообще сможет достучаться.
 */
function checkShare(opts) {
  var netLib = require('./net');
  var all = netLib.lanAddresses();
  var usable = all.filter(function (a) { return a.kind !== 'virtual'; });
  var wanted = opts && opts.share;

  if (!all.length) {
    // Совет прикладываем только когда доступ действительно просили: иначе
    // зелёная строка с наставлением выглядит как скрытая проблема.
    return wanted
      ? check('Доступ с телефона', WARN, 'адресов в локальной сети не найдено',
        'Компьютер не подключён к Wi-Fi или к роутеру. Панель работает, но ' +
        'открыть её с телефона не получится: телефон и компьютер должны быть ' +
        'в одной сети.')
      : check('Доступ с телефона', OK,
        'сейчас недоступен — компьютер не в локальной сети');
  }
  if (!usable.length) {
    return check('Доступ с телефона', WARN,
      'нашлись только виртуальные адаптеры (' +
      all.map(function (a) { return a.iface; }).join(', ') + ')',
      'Это адреса Docker, VPN или виртуальных машин — телефон до них, скорее ' +
      'всего, не достучится. Подключите компьютер к обычной сети Wi-Fi.');
  }
  var best = usable[0];
  return check('Доступ с телефона', OK,
    (wanted ? 'включён, ' : 'готов, ') + 'адрес ' + best.address + ' — ' + best.label +
    (usable.length > 1 ? ' (и ещё ' + (usable.length - 1) + ')' : '') +
    (wanted ? '' : '; включается флагом --share или кнопкой в панели'));
}

/**
 * Файлы оболочки PWA. Если их нет, установленное на телефон приложение
 * покажет белый экран вместо объяснения — это стоит поймать заранее.
 */
function checkPwa() {
  var pub = path.join(__dirname, '..', 'public');
  var required = [
    'index.html', 'app.js', 'styles.css',
    'manifest.json', 'sw.js', 'offline.html',
    path.join('icons', 'icon-192.png'),
    path.join('icons', 'icon-512.png')
  ];
  var missing = required.filter(function (f) {
    try { return !fs.statSync(path.join(pub, f)).isFile(); } catch (e) { return true; }
  });
  if (missing.length) {
    return check('Файлы панели', FAIL, 'не хватает: ' + missing.join(', '),
      'Похоже, папка Штурмана скопирована не целиком. Скачайте её заново.');
  }
  // Манифест должен быть разбираемым: браузер молча проигнорирует битый.
  try {
    var mf = JSON.parse(fs.readFileSync(path.join(pub, 'manifest.json'), 'utf8'));
    if (!mf.name || !Array.isArray(mf.icons) || !mf.icons.length) {
      return check('Файлы панели', WARN, 'манифест неполный',
        'Панель работать будет, но на главный экран телефона не установится.');
    }
  } catch (e) {
    return check('Файлы панели', WARN, 'манифест не разбирается: ' + e.message,
      'Панель работать будет, но установить её как приложение не выйдет.');
  }
  return check('Файлы панели', OK, 'все на месте, включая оболочку для телефона');
}

/** Сохранённые настройки: где лежат и читаются ли. */
function checkConfig() {
  var configLib = require('./config');
  var loaded = configLib.load();
  if (!loaded.existed) {
    return check('Настройки', OK, loaded.path + ' — ещё не создан, это первый запуск');
  }
  var recent = (loaded.config.recent || []).length;
  return check('Настройки', OK,
    loaded.path + ' — порт ' + loaded.config.port + ', тема ' + loaded.config.theme +
    ', проектов в истории ' + recent);
}

function checkPort(port) {
  var net = require('net');
  return new Promise(function (resolve) {
    var srv = net.createServer();
    srv.once('error', function (e) {
      if (e.code === 'EADDRINUSE') {
        resolve(check('Порт ' + port, FAIL, 'занят другой программой',
          'Запустите с другим портом: node server.js --port ' + (port + 1)));
      } else {
        resolve(check('Порт ' + port, WARN, 'проверить не удалось: ' + e.message));
      }
    });
    srv.once('listening', function () {
      srv.close(function () {
        resolve(check('Порт ' + port, OK, 'свободен, панель будет на http://127.0.0.1:' + port));
      });
    });
    srv.listen(port, '127.0.0.1');
  });
}

function checkClaudeBinary() {
  var execFile = require('child_process').execFile;
  return new Promise(function (resolve) {
    execFile(process.platform === 'win32' ? 'where' : 'which', ['claude'], {
      timeout: 3000, windowsHide: true
    }, function (err, stdout) {
      var found = !err && String(stdout || '').trim();
      if (found) {
        return resolve(check('Команда claude', OK,
          String(found).split('\n')[0].trim() + ' — кнопка «Спроси Клода» доступна с флагом --ask'));
      }
      resolve(check('Команда claude', WARN, 'в PATH не найдена',
        'Это влияет только на необязательную кнопку «Спроси Клода». ' +
        'Всё остальное работает: Штурман читает транскрипты с диска, а не запускает Клода.'));
    });
  });
}

// Штурман не должен ничего писать в проект — проверяем, что он и не собирается.
function checkReadOnly(projectRoot) {
  var writes = [];
  ['commit', 'add', 'push', 'checkout', 'reset'].forEach(function (sub) {
    if (gitLib.ALLOWED.has(sub)) writes.push(sub);
  });
  if (writes.length) {
    return check('Режим «только чтение»', FAIL,
      'в белом списке git оказались пишущие команды: ' + writes.join(', '),
      'Это ошибка сборки Штурмана — сообщите о ней.');
  }
  return check('Режим «только чтение»', OK,
    'git разрешён только на чтение (' + Array.from(gitLib.ALLOWED).length +
    ' команд), в ' + path.basename(projectRoot) + ' Штурман не пишет');
}

/**
 * Прогоняет все проверки. Возвращает {checks, worst, ok}.
 */
function run(opts) {
  var projectRoot = opts.projectAbs;
  var results = [checkNode(), checkClaudeHome(), checkReadOnly(projectRoot),
    checkShare(opts), checkPwa(), checkConfig()];

  return Promise.all([
    checkProject(projectRoot),
    checkGit(projectRoot),
    checkTranscripts(projectRoot),
    checkWatch(projectRoot),
    checkPort(opts.port),
    checkClaudeBinary()
  ]).then(function (rest) {
    // Порядок вывода задаём руками: от «где я» к «чем смотрю».
    var all = [
      results[0],                 // Node
      rest[0],                    // папка проекта
      rest[1],                    // git
      results[1],                 // каталог Claude Code
      rest[2],                    // транскрипты
      rest[3],                    // наблюдение
      rest[4],                    // порт
      results[3],                 // доступ с телефона
      results[4],                 // файлы панели
      results[5],                 // настройки
      rest[5],                    // бинарь claude
      results[2]                  // только чтение
    ];
    var worst = OK;
    all.forEach(function (c) {
      if (c.status === FAIL) worst = FAIL;
      else if (c.status === WARN && worst !== FAIL) worst = WARN;
    });
    return { checks: all, worst: worst, ok: worst !== FAIL };
  });
}

// Вывод в терминал. Отдельно от run, чтобы диагностику можно было
// использовать и программно.
function format(report, opts) {
  var GLYPH = { ok: '✔', warn: '!', fail: '✖' };
  var lines = ['', '  Проверка Штурмана', ''];

  report.checks.forEach(function (c) {
    lines.push('  ' + GLYPH[c.status] + ' ' + c.name + ': ' + c.detail);
    if (c.advice) {
      // Совет переносим по словам, чтобы не расползался за 78 колонок.
      wrap(c.advice, 72).forEach(function (l) { lines.push('      ' + l); });
    }
  });

  lines.push('');
  if (report.worst === 'fail') {
    lines.push('  Итог: есть препятствия — посмотрите пункты со знаком ✖.');
  } else if (report.worst === 'warn') {
    lines.push('  Итог: запускать можно. Пункты со знаком ! — это не поломки,');
    lines.push('  а места, где панель будет знать о происходящем меньше.');
  } else {
    lines.push('  Итог: всё на месте. Запускайте: node server.js --port ' + opts.port);
  }
  lines.push('');
  return lines.join('\n');
}

function wrap(text, width) {
  var words = String(text).split(/\s+/);
  var lines = [];
  var line = '';
  words.forEach(function (w) {
    if (!line) { line = w; return; }
    if ((line + ' ' + w).length > width) { lines.push(line); line = w; }
    else line += ' ' + w;
  });
  if (line) lines.push(line);
  return lines;
}

module.exports = {
  run: run, format: format, wrap: wrap,
  checkShare: checkShare, checkPwa: checkPwa, checkConfig: checkConfig,
  OK: OK, WARN: WARN, FAIL: FAIL
};
