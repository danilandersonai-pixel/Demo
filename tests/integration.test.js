'use strict';

// Интеграционные тесты: настоящая временная папка, настоящий git,
// настоящий вотчер и настоящий HTTP-сервер. Проверяем главное обещание
// приложения — «только наблюдаю, ничего не трогаю» — и деградацию на
// уровень B, когда транскриптов нет.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var http = require('node:http');
var execFileSync = require('node:child_process').execFileSync;

var gitLib = require('../lib/git');
var treeLib = require('../lib/tree');
var watcherLib = require('../lib/watcher');
var transcriptLib = require('../lib/transcript');
var server = require('../server');
var argsLib = require('../lib/args');

var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// Временный проект: package.json, немного кода, инициализированный git.
function makeProject(withGit) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-test-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"проба","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Проба\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log(1)\n');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'мусор.js'), 'шум\n');
  if (withGit && hasGit()) {
    var g = ['-c', 'user.email=t@example.com', '-c', 'user.name=Тест'];
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', g.concat(['add', '.']), { cwd: dir });
    execFileSync('git', g.concat(['commit', '-qm', 'initial: первый коммит']), { cwd: dir });
  }
  return dir;
}

function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* уже нет */ }
}

// ── Дерево проекта ──────────────────────────────────────────────────────────

test('tree.scan обходит проект и пропускает служебные каталоги', async function () {
  var dir = makeProject(false);
  try {
    var t = await treeLib.scan(dir);
    var byPath = t.nodes.map(function (n) { return n.path; });
    assert.ok(byPath.indexOf('package.json') !== -1);
    assert.ok(byPath.indexOf('src/index.js') !== -1);
    assert.ok(byPath.indexOf('src') !== -1);
    assert.ok(!byPath.some(function (p) { return p.indexOf('node_modules') === 0; }),
      'node_modules в карту не попадает');
    assert.strictEqual(t.truncated, false);
    assert.ok(t.counts.files >= 3);
  } finally { rm(dir); }
});

test('tree.scan уважает ограничение по числу элементов', async function () {
  var dir = makeProject(false);
  try {
    var t = await treeLib.scan(dir, { maxEntries: 2 });
    assert.strictEqual(t.truncated, true);
    assert.ok(t.nodes.length <= 2);
  } finally { rm(dir); }
});

test('tree.fileCard объясняет файл и не выпускает наружу проекта', async function () {
  var dir = makeProject(false);
  try {
    var card = await treeLib.fileCard(dir, 'package.json');
    assert.strictEqual(card.title, 'Паспорт проекта');
    assert.ok(card.size > 0);
    assert.strictEqual(card.exists, true);

    var outside = await treeLib.fileCard(dir, '../../../etc/passwd');
    assert.ok(outside.error, 'путь наружу отвергнут');

    var missing = await treeLib.fileCard(dir, 'нет-такого.js');
    assert.strictEqual(missing.exists, false);
    assert.ok(missing.title, 'даже для отсутствующего файла есть описание');
  } finally { rm(dir); }
});

test('looksLikeProject распознаёт проект и мягко предупреждает о чужой папке', async function () {
  var proj = makeProject(false);
  var plain = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-notproj-'));
  fs.writeFileSync(path.join(plain, 'заметки.txt'), 'просто текст\n');
  var empty = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-empty-'));
  try {
    var a = await treeLib.looksLikeProject(proj);
    assert.strictEqual(a.isProject, true);
    assert.ok(a.markers.indexOf('package.json') !== -1);
    assert.strictEqual(a.reason, null);

    var b = await treeLib.looksLikeProject(plain);
    assert.strictEqual(b.isProject, false);
    assert.match(b.reason, /нет привычных признаков проекта/);

    var c = await treeLib.looksLikeProject(empty);
    assert.strictEqual(c.empty, true);
    assert.match(c.reason, /пустая/);
  } finally { rm(proj); rm(plain); rm(empty); }
});

// ── Вотчер ──────────────────────────────────────────────────────────────────

test('вотчер замечает изменение, создание и удаление файла', async function () {
  var dir = makeProject(false);
  var w = watcherLib.createWatcher(dir, { debounce: 60 });
  var seen = [];
  w.events.on('change', function (c) { seen.push(c.action + ' ' + c.file); });
  try {
    await w.start();
    assert.ok(['native', 'poll'].indexOf(w.mode()) !== -1);
    assert.deepStrictEqual(seen, [], 'первичная опись событий не порождает');

    fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log(2)\n');
    fs.writeFileSync(path.join(dir, 'новый.txt'), 'привет\n');
    await wait(700);
    assert.ok(seen.indexOf('changed src/index.js') !== -1, 'видит правку: ' + seen.join(', '));
    assert.ok(seen.indexOf('added новый.txt') !== -1, 'видит новый файл: ' + seen.join(', '));

    fs.unlinkSync(path.join(dir, 'новый.txt'));
    await wait(700);
    assert.ok(seen.indexOf('removed новый.txt') !== -1, 'видит удаление: ' + seen.join(', '));
  } finally { w.stop(); rm(dir); }
});

test('вотчер молчит про node_modules', async function () {
  var dir = makeProject(false);
  var w = watcherLib.createWatcher(dir, { debounce: 60 });
  var seen = [];
  w.events.on('change', function (c) { seen.push(c.file); });
  try {
    await w.start();
    fs.writeFileSync(path.join(dir, 'node_modules', 'ещё.js'), 'шум\n');
    await wait(600);
    assert.deepStrictEqual(seen, [], 'шум сборки в ленту не идёт');
  } finally { w.stop(); rm(dir); }
});

test('вотчер в резервном режиме опроса работает так же', async function () {
  var dir = makeProject(false);
  var w = watcherLib.createWatcher(dir, { debounce: 30, poll: 300, forcePoll: true });
  var seen = [];
  var mode = null;
  w.events.on('mode', function (m) { mode = m; });
  w.events.on('change', function (c) { seen.push(c.action + ' ' + c.file); });
  try {
    await w.start();
    assert.strictEqual(w.mode(), 'poll');
    assert.match(mode.reason, /вручную/);

    fs.writeFileSync(path.join(dir, 'опрос.txt'), 'а\n');
    await wait(1000);
    assert.ok(seen.some(function (s) { return /added опрос\.txt/.test(s); }),
      'опрос тоже видит новые файлы: ' + seen.join(', '));
  } finally { w.stop(); rm(dir); }
});

// ── git ─────────────────────────────────────────────────────────────────────

test('git.snapshot совпадает с настоящим git status', { skip: !hasGit() }, async function () {
  var dir = makeProject(true);
  try {
    fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log(2)\n');
    fs.writeFileSync(path.join(dir, 'свежий.md'), '# новый\n');

    var snap = await gitLib.snapshot(dir);
    assert.strictEqual(snap.available, true);
    assert.ok(snap.branch, 'ветка определена');
    assert.ok(snap.branchExplain.length > 20, 'смысл ветки объяснён');
    assert.strictEqual(snap.commits.length, 1);
    assert.match(snap.commits[0].explain, /первое сохранение/);

    var real = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).length;
    assert.strictEqual(snap.summary.total, real, 'счётчик совпадает с git status');
  } finally { rm(dir); }
});

test('git: пишущие команды отвергаются кодом, а не полагаются на права', { skip: !hasGit() }, async function () {
  var dir = makeProject(true);
  try {
    var before = execFileSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' });
    var forbidden = ['commit', 'add', 'push', 'checkout', 'reset', 'clean', 'rm', 'merge', 'init'];
    for (var i = 0; i < forbidden.length; i++) {
      var r = await gitLib.run(dir, [forbidden[i], '-m', 'нельзя']);
      assert.strictEqual(r.ok, false, 'git ' + forbidden[i] + ' должен быть отвергнут');
      assert.strictEqual(r.forbidden, true);
      assert.match(r.stderr, /только читающие команды/);
    }
    // И даже git config на запись.
    var cfg = await gitLib.run(dir, ['config', '--add', 'user.name', 'Взлом']);
    assert.strictEqual(cfg.forbidden, true);

    var after = execFileSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(before, after, 'история не изменилась');
  } finally { rm(dir); }
});

test('git.fileDiff показывает незакоммиченные изменения', { skip: !hasGit() }, async function () {
  var dir = makeProject(true);
  try {
    fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log(1)\nconsole.log(2)\n');
    var d = await gitLib.fileDiff(dir, 'src/index.js');
    assert.strictEqual(d.source, 'work');
    assert.strictEqual(d.diff.length, 1);
    assert.strictEqual(d.diff[0].added, 1);

    // Нетронутый файл — показываем коммит, который его создал.
    var untouched = await gitLib.fileDiff(dir, 'README.md');
    assert.strictEqual(untouched.source, 'commit');
    assert.ok(untouched.sha);
  } finally { rm(dir); }
});

test('git.probe вежливо сообщает, что папка не под git', async function () {
  var dir = makeProject(false);
  try {
    var p = await gitLib.probe(dir);
    assert.strictEqual(p.isRepo, false);
    assert.match(p.reason, /не под контролем git/);
    var snap = await gitLib.snapshot(dir);
    assert.strictEqual(snap.available, false);
    assert.deepStrictEqual(snap.commits, []);
  } finally { rm(dir); }
});

// ── Транскрипты ─────────────────────────────────────────────────────────────

test('транскрипт: каталог проекта находится по кодированному имени', async function () {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-home-'));
  var proj = makeProject(false);
  var saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  try {
    var encoded = require('../lib/paths').encodeProjectDir(proj);
    var sessDir = path.join(home, 'projects', encoded);
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'сессия.jsonl'),
      JSON.stringify({ type: 'user', uuid: 'u1', cwd: proj, timestamp: new Date().toISOString() }) + '\n');

    var found = await transcriptLib.findProjectDir(proj);
    assert.ok(found, 'каталог найден');
    assert.strictEqual(found.dir, sessDir);
    assert.strictEqual(found.how, 'encoded');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    rm(home); rm(proj);
  }
});

test('транскрипт: каталог находится перебором по полю cwd', async function () {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-home2-'));
  var proj = makeProject(false);
  var saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  try {
    // Имя каталога НЕ совпадает с кодированным — как бывает на других
    // версиях Claude Code. Найтись должно всё равно.
    var sessDir = path.join(home, 'projects', 'совершенно-другое-имя');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'с.jsonl'),
      JSON.stringify({ type: 'user', uuid: 'u1', cwd: proj, timestamp: new Date().toISOString() }) + '\n');

    var found = await transcriptLib.findProjectDir(proj);
    assert.ok(found, 'каталог найден перебором');
    assert.strictEqual(found.how, 'cwd-scan');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    rm(home); rm(proj);
  }
});

test('транскрипт: хвостение подхватывает дописанные записи', async function () {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-home3-'));
  var proj = makeProject(false);
  var saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  var tailer = null;
  try {
    var sessDir = path.join(home, 'projects', require('../lib/paths').encodeProjectDir(proj));
    fs.mkdirSync(sessDir, { recursive: true });
    var file = path.join(sessDir, 'живая.jsonl');
    fs.writeFileSync(file, JSON.stringify({
      type: 'user', uuid: 'u1', cwd: proj, sessionId: 'живая',
      timestamp: new Date().toISOString(), message: { role: 'user', content: 'начали' }
    }) + '\n');

    tailer = transcriptLib.createTailer(proj, { poll: 120, dirPoll: 400, fromStart: true });
    var got = [];
    tailer.events.on('events', function (list) { list.forEach(function (e) { got.push(e); }); });

    var res = await tailer.start();
    assert.strictEqual(res.level, 'A', 'транскрипт найден — уровень A');
    await wait(400);
    assert.ok(got.some(function (e) { return e.kind === 'user'; }), 'первая запись прочитана');

    // Дописываем как настоящий Claude Code — в конец файла.
    fs.appendFileSync(file, JSON.stringify({
      type: 'assistant', uuid: 'u2', cwd: proj, sessionId: 'живая',
      timestamp: new Date().toISOString(),
      message: {
        id: 'm1', role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }],
        usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }
    }) + '\n');
    await wait(500);

    var tool = got.filter(function (e) { return e.kind === 'tool'; })[0];
    assert.ok(tool, 'дописанная запись подхвачена: ' + got.map(function (e) { return e.kind; }).join(','));
    assert.strictEqual(tool.command, 'npm test');
    assert.strictEqual(tailer.tokens().messages, 1);
  } finally {
    if (tailer) tailer.stop();
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    rm(home); rm(proj);
  }
});

test('транскрипт: без каталога сессий остаётся уровень B', async function () {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-home4-'));
  var proj = makeProject(false);
  var saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  var tailer = null;
  try {
    tailer = transcriptLib.createTailer(proj, { poll: 100, dirPoll: 5000 });
    var levels = [];
    tailer.events.on('level', function (l) { levels.push(l); });
    var res = await tailer.start();
    assert.strictEqual(res.level, 'B');
    assert.strictEqual(tailer.activeFile(), null);
  } finally {
    if (tailer) tailer.stop();
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    rm(home); rm(proj);
  }
});

test('транскрипт: readSession разбирает архив целиком', async function () {
  var s = await transcriptLib.readSession(
    require('./helpers').fixturePath('session-basic.jsonl'),
    { projectRoot: '/home/user/proj' }
  );
  assert.ok(s.events.length > 5);
  assert.strictEqual(s.counters.errors, 1);
  assert.strictEqual(s.tokens.messages, 5);
});

test('транскрипт: describeSessions читает голову и хвост без загрузки файла целиком', async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-sess-'));
  try {
    fs.copyFileSync(require('./helpers').fixturePath('session-basic.jsonl'),
      path.join(dir, 'первая.jsonl'));
    var list = await transcriptLib.describeSessions(dir, 10);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'первая');
    assert.match(list[0].firstPrompt, /Почини тесты/);
    assert.strictEqual(list[0].branch, 'feature/панель');
    assert.ok(list[0].durationMs > 0);
  } finally { rm(dir); }
});

// ── HTTP-сервер целиком ─────────────────────────────────────────────────────

function get(port, urlPath) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: port, path: urlPath }, function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: body, headers: res.headers }); });
    }).on('error', reject);
  });
}

test('сервер: поднимается, отдаёт панель и API, слушает только петлю', async function () {
  var dir = makeProject(true);
  var port = 4791;
  var opts = argsLib.parse(['--project', dir, '--port', String(port), '--tail-only']);
  var app = server.createApp(opts);
  var srv = server.createServer(app, opts);
  try {
    await app.start();
    await new Promise(function (r) { srv.listen(port, '127.0.0.1', r); });

    var addr = srv.address();
    assert.strictEqual(addr.address, '127.0.0.1', 'наружу не слушаем');

    var page = await get(port, '/');
    assert.strictEqual(page.status, 200);
    assert.match(page.body, /Штурман/);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.strictEqual(page.headers['x-frame-options'], 'DENY');

    var state = JSON.parse((await get(port, '/api/state')).body);
    assert.strictEqual(state.state.project, path.resolve(dir));
    assert.ok(['A', 'B'].indexOf(state.state.level) !== -1);

    var tree = JSON.parse((await get(port, '/api/tree')).body);
    assert.ok(tree.nodes.length > 0);

    var gl = JSON.parse((await get(port, '/api/glossary')).body);
    assert.ok(gl.count >= 25);

    var dig = JSON.parse((await get(port, '/api/digest')).body);
    assert.match(dig.markdown, /Что мы сегодня сделали/);

    var missing = await get(port, encodeURI('/api/нет-такого'));
    assert.strictEqual(missing.status, 404);
  } finally {
    app.stop();
    await new Promise(function (r) { srv.close(r); });
    rm(dir);
  }
});

test('сервер: не отдаёт файлы за пределами проекта', async function () {
  var dir = makeProject(false);
  var port = 4792;
  var opts = argsLib.parse(['--project', dir, '--port', String(port), '--tail-only']);
  var app = server.createApp(opts);
  var srv = server.createServer(app, opts);
  try {
    await app.start();
    await new Promise(function (r) { srv.listen(port, '127.0.0.1', r); });

    var r1 = await get(port, '/api/file?path=' + encodeURIComponent('../../../etc/passwd'));
    assert.strictEqual(r1.status, 403);

    var r2 = await get(port, '/api/session/' + encodeURIComponent('../../../secret'));
    assert.strictEqual(r2.status, 400);

    var r3 = await get(port, '/../server.js');
    assert.ok(r3.status === 403 || r3.status === 404, 'статика наружу не выходит');

    // «Спроси Клода» по умолчанию выключено.
    var ask = await new Promise(function (resolve) {
      var req = http.request({
        host: '127.0.0.1', port: port, path: '/api/ask', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, function (res) {
        var b = '';
        res.on('data', function (c) { b += c; });
        res.on('end', function () { resolve({ status: res.statusCode, body: b }); });
      });
      req.end(JSON.stringify({ prompt: 'привет' }));
    });
    assert.strictEqual(ask.status, 403);
    assert.match(ask.body, /выключена/);
  } finally {
    app.stop();
    await new Promise(function (r) { srv.close(r); });
    rm(dir);
  }
});

test('сервер: наблюдаемый проект остаётся нетронутым', { skip: !hasGit() }, async function () {
  var dir = makeProject(true);
  var port = 4793;
  var opts = argsLib.parse(['--project', dir, '--port', String(port), '--tail-only']);
  var app = server.createApp(opts);
  var srv = server.createServer(app, opts);

  function listing() {
    var out = [];
    (function walk(d, rel) {
      fs.readdirSync(d, { withFileTypes: true }).sort(function (a, b) {
        return a.name.localeCompare(b.name);
      }).forEach(function (e) {
        var p = rel ? rel + '/' + e.name : e.name;
        if (p.indexOf('.git/') === 0) return;   // git сам пишет в свои служебные файлы
        if (e.isDirectory()) { out.push('d ' + p); walk(path.join(d, e.name), p); }
        else out.push('f ' + p + ' ' + fs.statSync(path.join(d, e.name)).size);
      });
    })(dir, '');
    return out.join('\n');
  }

  try {
    var before = listing();
    await app.start();
    await new Promise(function (r) { srv.listen(port, '127.0.0.1', r); });

    // Дёргаем всё, что умеет ходить в проект.
    await get(port, '/api/tree');
    await get(port, '/api/git');
    await get(port, '/api/file?path=package.json');
    await get(port, '/api/git/diff?path=src/index.js');
    await get(port, '/api/digest');
    await wait(600);

    assert.strictEqual(listing(), before, 'ни одного изменения в проекте');
    var status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(status.trim(), '', 'git status чист');
  } finally {
    app.stop();
    await new Promise(function (r) { srv.close(r); });
    rm(dir);
  }
});

test('сервер: несколько проектов в одной панели', async function () {
  var a = makeProject(false);
  var b = makeProject(false);
  fs.writeFileSync(path.join(a, 'только-в-первом.txt'), 'а\n');
  fs.writeFileSync(path.join(b, 'только-во-втором.txt'), 'б\n');

  var port = 4795;
  var opts = argsLib.parse(['--project', a, '--project', b, '--port', String(port), '--tail-only']);
  assert.strictEqual(opts.projects.length, 2);

  var registry = server.createRegistry(opts);
  var srv = server.createServer(registry, opts);
  try {
    await registry.startAll();
    await new Promise(function (r) { srv.listen(port, '127.0.0.1', r); });

    var list = JSON.parse((await get(port, '/api/projects')).body);
    assert.strictEqual(list.projects.length, 2);
    var keyA = list.projects[0].key;
    var keyB = list.projects[1].key;
    assert.notStrictEqual(keyA, keyB, 'ключи проектов различаются');
    assert.strictEqual(list.active, keyA, 'по умолчанию — первый');

    // Каждый проект видит только свои файлы.
    var treeA = JSON.parse((await get(port, '/api/tree?project=' + encodeURIComponent(keyA))).body);
    var treeB = JSON.parse((await get(port, '/api/tree?project=' + encodeURIComponent(keyB))).body);
    var namesA = treeA.nodes.map(function (n) { return n.path; });
    var namesB = treeB.nodes.map(function (n) { return n.path; });
    assert.ok(namesA.indexOf('только-в-первом.txt') !== -1);
    assert.ok(namesA.indexOf('только-во-втором.txt') === -1);
    assert.ok(namesB.indexOf('только-во-втором.txt') !== -1);

    // Состояние тоже своё у каждого.
    var stateB = JSON.parse((await get(port, '/api/state?project=' + encodeURIComponent(keyB))).body);
    assert.strictEqual(stateB.state.project, path.resolve(b));
    assert.strictEqual(stateB.state.projectKey, keyB);
    assert.strictEqual(stateB.state.projects.length, 2);

    // Неизвестный ключ не роняет панель, а отдаёт основной проект.
    var fallback = JSON.parse((await get(port,
      '/api/state?project=' + encodeURIComponent('такого-нет'))).body);
    assert.strictEqual(fallback.state.project, path.resolve(a));
  } finally {
    registry.stopAll();
    await new Promise(function (r) { srv.close(r); });
    rm(a); rm(b);
  }
});

test('реестр: одинаковые имена папок получают разные ключи', function () {
  var opts = argsLib.parse(['--project', '/tmp/шт-1/общее', '--project', '/tmp/шт-2/общее']);
  var registry = server.createRegistry(opts);
  try {
    var keys = registry.list().map(function (p) { return p.key; });
    assert.strictEqual(new Set(keys).size, 2, 'ключи уникальны: ' + keys.join(', '));
    assert.strictEqual(keys[0], 'общее');
    assert.strictEqual(keys[1], 'общее-2');
  } finally { registry.stopAll(); }
});

test('сервер: уровень B остаётся полезным без транскриптов', async function () {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-nohome-'));
  var saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;      // пустой каталог — транскриптов нет
  var dir = makeProject(true);
  var port = 4794;
  var opts = argsLib.parse(['--project', dir, '--port', String(port)]);
  var app = server.createApp(opts);
  var srv = server.createServer(app, opts);
  try {
    await app.start();
    await new Promise(function (r) { srv.listen(port, '127.0.0.1', r); });

    var state = JSON.parse((await get(port, '/api/state')).body);
    assert.strictEqual(state.state.level, 'B');
    assert.ok(state.state.levelReason, 'причина названа человеку');

    // Лента предупредила и объяснила, что делать.
    var warn = state.events.filter(function (e) { return e.level === 'warn'; });
    assert.ok(warn.some(function (e) { return /уровень B/i.test(e.title); }),
      'в ленте есть объяснение уровня B');

    // И при этом всё главное работает.
    fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log(42)\n');
    await wait(900);
    var after = JSON.parse((await get(port, '/api/state')).body);
    assert.ok(after.events.some(function (e) { return e.kind === 'file'; }),
      'изменения файлов видны и без транскриптов');
    assert.strictEqual(after.git.available, true, 'git-панель работает');
    var tree = JSON.parse((await get(port, '/api/tree')).body);
    assert.ok(tree.nodes.length > 0, 'карта проекта работает');
    var sessions = JSON.parse((await get(port, '/api/sessions')).body);
    assert.match(sessions.note, /Транскрипты не найдены/);
  } finally {
    app.stop();
    await new Promise(function (r) { srv.close(r); });
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    rm(home); rm(dir);
  }
});
