'use strict';

/**
 * Синтетическая нагрузка для стенда.
 *
 * Тормоза нужно уметь воспроизводить по команде, иначе «стало быстрее» —
 * это ощущение, а не факт. Здесь собирается проект, который заведомо тяжелее
 * настоящего: тысячи файлов, десять тысяч событий, длинные диффы и большие
 * файлы. Всё во временных каталогах — ни ваш проект, ни ваш ~/.claude не
 * трогаются.
 *
 * Данные должны быть **правдоподобными**, а не случайным мусором: панель
 * разбирает их настоящим парсером, и если подсунуть ей записи, каких Claude
 * Code не пишет, замер получится про парсер, а не про панель.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

var DEFAULTS = {
  files: 5000,        // файлов в проекте
  events: 10000,      // записей в транскрипте
  bigDiffLines: 4000, // строки в самом длинном диффе
  bigFileKb: 900      // размер самого большого файла
};

/** Кодировка имени каталога в ~/.claude/projects — как у самого Claude Code. */
function encodeProjectDir(p) {
  return String(p).replace(/[^A-Za-z0-9]/g, '-');
}

// Детерминированный «рандом»: один и тот же стенд от прогона к прогону,
// иначе замеры «до» и «после» сравнивать нельзя.
function rng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

var DIRS = ['src', 'lib', 'app', 'components', 'utils', 'server', 'client',
  'models', 'views', 'tests', 'docs', 'config', 'scripts', 'assets'];
var EXT = ['.js', '.ts', '.tsx', '.css', '.json', '.md', '.py', '.go'];
var WORDS = ['render', 'parse', 'queue', 'buffer', 'client', 'handler', 'store',
  'router', 'stream', 'cache', 'session', 'worker', 'panel', 'index', 'main',
  'config', 'utils', 'types', 'helpers', 'service'];

/** Дерево проекта: N файлов, разложенных по каталогам с реальной глубиной. */
function makeProject(root, opts) {
  var rand = rng(42);
  var made = [];
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({ name: 'bench-project', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(root, 'README.md'), '# Стенд\n\nСинтетический проект для замеров.\n');

  // Каталоги, которые обязаны игнорироваться: если вотчер их читает, это
  // видно сразу по времени старта и нагрузке.
  ['node_modules/big-package/lib', '.git/objects', 'dist/assets', 'coverage/lcov'].forEach(function (d) {
    var full = path.join(root, d);
    fs.mkdirSync(full, { recursive: true });
    for (var i = 0; i < 200; i++) {
      fs.writeFileSync(path.join(full, 'junk' + i + '.js'), 'module.exports = ' + i + ';\n');
    }
  });

  var perDir = Math.ceil(opts.files / (DIRS.length * 4));
  DIRS.forEach(function (d1) {
    for (var d2 = 0; d2 < 4; d2++) {
      var dir = path.join(root, d1, 'part' + d2);
      fs.mkdirSync(dir, { recursive: true });
      for (var i = 0; i < perDir && made.length < opts.files; i++) {
        var name = WORDS[Math.floor(rand() * WORDS.length)] + '-' + i + EXT[Math.floor(rand() * EXT.length)];
        var rel = path.join(d1, 'part' + d2, name);
        var lines = 20 + Math.floor(rand() * 80);
        var body = '';
        for (var l = 0; l < lines; l++) body += '// строка ' + l + ' файла ' + name + '\n';
        fs.writeFileSync(path.join(root, rel), body);
        made.push(rel);
      }
    }
  });

  // Один заведомо большой файл: карточка файла и дифф на нём не должны
  // подвешивать интерфейс.
  var big = 'src/huge-generated.js';
  var chunk = '// эта строка повторяется, чтобы файл стал большим\n';
  fs.writeFileSync(path.join(root, big),
    chunk.repeat(Math.ceil(opts.bigFileKb * 1024 / chunk.length)));
  made.push(big);

  return made;
}

/** Одна запись транскрипта в том же формате, что пишет Claude Code. */
function record(base, i, rand, opts, files) {
  var at = new Date(base.t0 + i * 1000).toISOString();
  var common = {
    sessionId: base.sessionId, cwd: base.cwd, gitBranch: 'main',
    version: '2.0.0', timestamp: at
  };
  var kind = i % 10;
  var file = files[Math.floor(rand() * files.length)];

  if (kind === 0) {
    return Object.assign({}, common, {
      type: 'user', uuid: 'u' + i,
      message: { role: 'user', content: 'Сделай следующий шаг по задаче номер ' + i }
    });
  }
  if (kind === 1) {
    return Object.assign({}, common, {
      type: 'assistant', uuid: 'a' + i,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Смотрю ' + file + ' и правлю обработчик очереди.' }]
      },
      usage: { input_tokens: 1200, output_tokens: 300 }
    });
  }
  if (kind === 2 || kind === 5) {
    return Object.assign({}, common, {
      type: 'assistant', uuid: 'a' + i,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use', id: 'tool_' + i, name: 'Read',
          input: { file_path: path.join(base.cwd, file) }
        }]
      }
    });
  }
  if (kind === 3 || kind === 6) {
    return Object.assign({}, common, {
      type: 'assistant', uuid: 'a' + i,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use', id: 'tool_' + i, name: 'Bash',
          input: { command: 'npm test -- --grep "case ' + i + '"', description: 'прогоняет тесты' }
        }]
      }
    });
  }
  if (kind === 4 || kind === 7) {
    // Правка файла: каждая десятая — с очень длинным диффом.
    var huge = i % 100 === 4;
    var n = huge ? opts.bigDiffLines : 12;
    var patch = [];
    for (var l = 0; l < n; l++) {
      patch.push({ line: l + 1, type: l % 3 === 0 ? 'add' : (l % 3 === 1 ? 'del' : 'ctx'),
        content: 'строка ' + l + ' в ' + file });
    }
    return Object.assign({}, common, {
      type: 'user', uuid: 'r' + i,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_' + (i - 1), content: 'ok' }] },
      toolUseResult: {
        filePath: path.join(base.cwd, file),
        structuredPatch: [{
          oldStart: 1, oldLines: n, newStart: 1, newLines: n,
          lines: patch.map(function (p) {
            return (p.type === 'add' ? '+' : p.type === 'del' ? '-' : ' ') + p.content;
          })
        }]
      }
    });
  }
  // Результат команды с длинным выводом.
  var out = [];
  for (var o = 0; o < (i % 50 === 8 ? 1200 : 8); o++) out.push('  прошло: проверка ' + o);
  return Object.assign({}, common, {
    type: 'user', uuid: 'r' + i,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_' + (i - 1), content: out.join('\n') }] },
    toolUseResult: { stdout: out.join('\n'), stderr: '', interrupted: false }
  });
}

/**
 * Собрать стенд целиком.
 * @returns {{home, project, transcript, files, events}}
 */
function build(options) {
  var opts = Object.assign({}, DEFAULTS, options || {});
  var home = opts.home || fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-bench-home-'));
  var project = opts.project || fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-bench-proj-'));

  var files = makeProject(project, opts);

  var dir = path.join(home, '.claude', 'projects', encodeProjectDir(project));
  fs.mkdirSync(dir, { recursive: true });
  var transcript = path.join(dir, 'bench.jsonl');

  var rand = rng(7);
  var base = { sessionId: 'bench', cwd: project, t0: Date.now() - opts.events * 1000 };
  var out = [];
  for (var i = 0; i < opts.events; i++) {
    out.push(JSON.stringify(record(base, i, rand, opts, files)));
    // Пишем частями: десять тысяч записей в одной строке съедают память.
    if (out.length >= 500) {
      fs.appendFileSync(transcript, out.join('\n') + '\n');
      out = [];
    }
  }
  if (out.length) fs.appendFileSync(transcript, out.join('\n') + '\n');

  return {
    home: home, project: project, transcript: transcript,
    files: files.length, events: opts.events,
    transcriptBytes: fs.statSync(transcript).size
  };
}

/**
 * Дописать в транскрипт одно событие «сейчас» с меткой.
 * Метка нужна замеру задержки: по ней страница узнаёт своё событие и
 * считает, сколько прошло от записи на диск до появления на экране.
 */
function appendMarked(fixture, seq) {
  var now = Date.now();
  var mark = 'BENCHMARK-' + seq + '-' + now;
  var rec = {
    type: 'assistant', uuid: 'bench' + seq, sessionId: 'bench',
    cwd: fixture.project, gitBranch: 'main', version: '2.0.0',
    timestamp: new Date(now).toISOString(),
    message: {
      role: 'assistant',
      content: [{
        type: 'tool_use', id: 'benchtool_' + seq, name: 'Bash',
        input: { command: 'echo ' + mark, description: 'метка стенда' }
      }]
    }
  };
  fs.appendFileSync(fixture.transcript, JSON.stringify(rec) + '\n');
  return { mark: mark, at: now };
}

/** Дописать обычное событие без метки — просто нагрузка. */
function appendNoise(fixture, seq) {
  var now = Date.now();
  var rec = {
    type: 'user', uuid: 'noise' + seq, sessionId: 'bench',
    cwd: fixture.project, gitBranch: 'main', version: '2.0.0',
    timestamp: new Date(now).toISOString(),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'benchtool_' + seq, content: 'готово' }] },
    toolUseResult: { stdout: 'готово ' + seq, stderr: '', interrupted: false }
  };
  fs.appendFileSync(fixture.transcript, JSON.stringify(rec) + '\n');
}

function cleanup(fixture) {
  [fixture.home, fixture.project].forEach(function (d) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* и ладно */ }
  });
}

module.exports = {
  DEFAULTS: DEFAULTS,
  encodeProjectDir: encodeProjectDir,
  build: build,
  appendMarked: appendMarked,
  appendNoise: appendNoise,
  cleanup: cleanup
};
