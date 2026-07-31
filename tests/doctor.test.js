'use strict';

// Тесты самодиагностики (`node server.js --check`).
// Она существует ради одного вопроса из FAQ — «панель пустая, что делать», —
// поэтому проверяем не только статусы, но и что советы реально написаны.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var execFileSync = require('node:child_process').execFileSync;

var doctor = require('../lib/doctor');
var argsLib = require('../lib/args');

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function rm(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* уже нет */ }
}
function byName(report, name) {
  return report.checks.filter(function (c) { return c.name === name; })[0];
}

test('диагностика на нормальном проекте: всё зелёное', async function () {
  var home = tmpdir('doc-home-');
  var proj = tmpdir('doc-proj-');
  var saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  try {
    fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"проба"}\n');
    execFileSync('git', ['init', '-q'], { cwd: proj });

    var paths = require('../lib/paths');
    var sess = path.join(home, 'projects', paths.encodeProjectDir(proj));
    fs.mkdirSync(sess, { recursive: true });
    fs.writeFileSync(path.join(sess, 's.jsonl'), JSON.stringify({
      type: 'user', uuid: 'u1', cwd: proj, timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'привет' }
    }) + '\n');

    var opts = argsLib.parse(['--project', proj, '--port', '4899']);
    var report = await doctor.run(opts);

    assert.strictEqual(byName(report, 'Папка проекта').status, doctor.OK);
    assert.strictEqual(byName(report, 'Git').status, doctor.OK);
    assert.strictEqual(byName(report, 'Транскрипты этого проекта').status, doctor.OK);
    assert.strictEqual(byName(report, 'Режим «только чтение»').status, doctor.OK);
    assert.strictEqual(report.ok, true);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    rm(home); rm(proj);
  }
});

test('диагностика без транскриптов предупреждает и объясняет, где искать', async function () {
  var home = tmpdir('doc-home2-');
  var proj = tmpdir('doc-proj2-');
  var saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  try {
    fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"проба"}\n');
    var opts = argsLib.parse(['--project', proj, '--port', '4898']);
    var report = await doctor.run(opts);

    var t = byName(report, 'Транскрипты этого проекта');
    assert.strictEqual(t.status, doctor.WARN);
    assert.ok(t.advice, 'совет обязателен: ради него всё и затевалось');
    assert.match(t.advice, /Claude Code запущен в другой папке/);
    assert.match(t.advice, /уровень B|карта проекта/, 'сказано, что панель всё равно полезна');

    assert.strictEqual(report.ok, true, 'отсутствие транскриптов — не препятствие для запуска');
    assert.strictEqual(report.worst, doctor.WARN);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    rm(home); rm(proj);
  }
});

test('диагностика замечает занятый порт и считает это препятствием', async function () {
  var proj = tmpdir('doc-proj3-');
  var net = require('node:net');
  var blocker = net.createServer();
  try {
    await new Promise(function (r) { blocker.listen(4897, '127.0.0.1', r); });
    var opts = argsLib.parse(['--project', proj, '--port', '4897']);
    var report = await doctor.run(opts);

    var p = byName(report, 'Порт 4897');
    assert.strictEqual(p.status, doctor.FAIL);
    assert.match(p.advice, /--port 4898/, 'подсказан конкретный следующий порт');
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.worst, doctor.FAIL);
  } finally {
    await new Promise(function (r) { blocker.close(r); });
    rm(proj);
  }
});

test('диагностика подтверждает, что git разрешён только на чтение', async function () {
  var proj = tmpdir('doc-proj4-');
  try {
    var opts = argsLib.parse(['--project', proj, '--port', '4896']);
    var report = await doctor.run(opts);
    var ro = byName(report, 'Режим «только чтение»');
    assert.strictEqual(ro.status, doctor.OK);
    assert.match(ro.detail, /только на чтение/);
  } finally { rm(proj); }
});

test('у каждой проверки есть имя, статус и описание', async function () {
  var proj = tmpdir('doc-proj5-');
  try {
    var report = await doctor.run(argsLib.parse(['--project', proj, '--port', '4895']));
    assert.ok(report.checks.length >= 8, 'проверок должно быть много: ' + report.checks.length);
    report.checks.forEach(function (c) {
      assert.ok(c.name, 'у проверки есть имя');
      assert.ok([doctor.OK, doctor.WARN, doctor.FAIL].indexOf(c.status) !== -1, c.name + ': статус');
      assert.ok(c.detail && c.detail.length > 3, c.name + ': описание непустое');
      if (c.status !== doctor.OK) {
        assert.ok(c.advice, c.name + ': у не-зелёной проверки обязан быть совет');
      }
    });
  } finally { rm(proj); }
});

test('вывод в терминал читаемый и не длиннее разумного', async function () {
  var proj = tmpdir('doc-proj6-');
  try {
    var opts = argsLib.parse(['--project', proj, '--port', '4894']);
    var report = await doctor.run(opts);
    var text = doctor.format(report, opts);

    assert.match(text, /Проверка Штурмана/);
    assert.match(text, /Итог:/);
    report.checks.forEach(function (c) {
      assert.ok(text.indexOf(c.name) !== -1, 'в выводе есть ' + c.name);
    });
    assert.ok(text.indexOf('undefined') === -1);
    // Совет переносится по словам, а не рвётся посередине.
    text.split('\n').forEach(function (line) {
      assert.ok(line.length <= 200, 'строка не должна расползаться: ' + line.slice(0, 60));
    });
  } finally { rm(proj); }
});

test('wrap переносит по словам и не режет слова', function () {
  var lines = doctor.wrap('короткое слово и ещё несколько слов подряд для проверки переноса', 20);
  lines.forEach(function (l) { assert.ok(l.length <= 20, 'строка «' + l + '» длиннее 20'); });
  assert.strictEqual(lines.join(' ').replace(/\s+/g, ' '),
    'короткое слово и ещё несколько слов подряд для проверки переноса');
});

test('args: --check и --doctor включают диагностику', function () {
  assert.strictEqual(argsLib.parse(['--check']).check, true);
  assert.strictEqual(argsLib.parse(['--doctor']).check, true);
  assert.strictEqual(argsLib.parse([]).check, false);
});
