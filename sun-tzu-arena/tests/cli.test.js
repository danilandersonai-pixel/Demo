'use strict';

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');
var execFile = require('node:child_process').execFileSync;

var runCli = require('../sim/run');

var ROOT = path.join(__dirname, '..');

test('CLI: разбор аргументов покрывает все заявленные ключи', function () {
  var a = runCli.parseArgs(['--seed', '42']);
  assert.deepStrictEqual(a.seeds, [42]);
  assert.strictEqual(a.all, false);
  assert.strictEqual(a.noise, null, 'без ключа шум остаётся по умолчанию');
  assert.strictEqual(a.generations, null);

  var b = runCli.parseArgs(['--seed', '42', '--generations', '30', '--noise', '0.05']);
  assert.deepStrictEqual(b.seeds, [42]);
  assert.strictEqual(b.generations, 30);
  assert.strictEqual(b.noise, 0.05);

  var c = runCli.parseArgs(['--all']);
  assert.strictEqual(c.all, true);

  var d = runCli.parseArgs(['--seed', '7', '--seed', '2026']);
  assert.deepStrictEqual(d.seeds, [7, 2026], 'сидов можно указать несколько');

  var e = runCli.parseArgs(['--noise', '0']);
  assert.strictEqual(e.noise, 0, 'ноль — допустимое значение шума, а не «не задано»');

  assert.deepStrictEqual(runCli.REFERENCE_SEEDS, [7, 42, 2026]);
});

test('CLI: неизвестный аргумент отвергается, а не проглатывается', function () {
  assert.throws(function () { runCli.parseArgs(['--seeed', '42']); }, /Неизвестный аргумент/);
  assert.throws(function () { runCli.parseArgs(['42']); }, /Неизвестный аргумент/);
});

test('CLI: запуск без аргументов завершается с ненулевым кодом и подсказкой', function () {
  var failed = false;
  var output = '';
  try {
    execFile(process.execPath, ['sim/run.js'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    failed = true;
    output = String(err.stderr || '');
  }
  assert.ok(failed, 'команда без сидов обязана падать');
  assert.ok(/--seed|--all/.test(output), 'в подсказке должны быть ключи запуска');
});

test('CLI: --help печатает справку и завершается успешно', function () {
  var out = execFile(process.execPath, ['sim/run.js', '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(out.indexOf('--seed') >= 0);
  assert.ok(out.indexOf('--all') >= 0);
  assert.ok(out.indexOf('--noise') >= 0);
});

test('CLI: обещанные файлы результатов существуют и разбираются', function () {
  runCli.REFERENCE_SEEDS.forEach(function (seed) {
    var file = path.join(ROOT, 'results', seed + '.json');
    assert.ok(fs.existsSync(file), 'нет results/' + seed + '.json');
    var run = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(run.seed, seed);
    assert.strictEqual(run.generations, 30);
    assert.strictEqual(run.rounds, 200);
    assert.strictEqual(run.noise, 0.05);
  });
  assert.ok(fs.existsSync(path.join(ROOT, 'viz', 'replay.js')), 'нет viz/replay.js');
  assert.ok(fs.existsSync(path.join(ROOT, 'results', 'spatial.json')), 'нет results/spatial.json');
});

test('CLI: прогон с нестандартным шумом сохранён под отдельным именем', function () {
  // Отчёт опирается на сравнение с бесшумным прогоном — файлы обязаны быть
  // на месте и не перетирать эталонные.
  runCli.REFERENCE_SEEDS.forEach(function (seed) {
    var file = path.join(ROOT, 'results', seed + '-noise0-gen30.json');
    assert.ok(fs.existsSync(file), 'нет ' + path.basename(file) + ' — запусти node sim/run.js --all --noise 0');
    var run = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(run.noise, 0);
    assert.strictEqual(run.seed, seed);
  });
});

test('проект: в коде нет незавершённых мест, помеченных маркерами', function () {
  // Ищем именно маркеры незавершённой работы, а не слова: «заглушка» —
  // законное описание запасного экрана визуализатора, и запрещать это слово
  // значило бы проверять словарь, а не код.
  var MARKERS = /(^|[^A-Za-z])(TODO|FIXME|XXX|HACK|WIP)([^A-Za-z]|$)/;
  var offenders = [];

  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      var full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!/\.(js|html)$/.test(entry.name)) return;
      if (entry.name === 'replay.js') return; // сгенерированные данные
      if (full === __filename) return; // файл, который и объявляет эти маркеры
      fs.readFileSync(full, 'utf8').split('\n').forEach(function (line, i) {
        if (MARKERS.test(line)) {
          offenders.push(path.relative(ROOT, full) + ':' + (i + 1) + ' — ' + line.trim().slice(0, 60));
        }
      });
    });
  }

  ['engine', 'strategies', 'sim', 'tests', 'viz'].forEach(function (d) {
    walk(path.join(ROOT, d));
  });
  assert.deepStrictEqual(offenders, [], 'найдены незавершённые места:\n' + offenders.join('\n'));
});

test('проект: каждая стратегия лежит в своём файле и подключена к реестру', function () {
  var dir = path.join(ROOT, 'strategies');
  var files = fs.readdirSync(dir).filter(function (f) {
    return /\.js$/.test(f) && f !== 'index.js';
  });
  var registry = require('../strategies');
  assert.strictEqual(files.length, registry.list.length,
    'файлов стратегий ' + files.length + ', в реестре ' + registry.list.length);
  files.forEach(function (f) {
    var def = require(path.join(dir, f));
    assert.ok(registry.byId(def.id), 'файл ' + f + ' не подключён к реестру');
    assert.strictEqual(f, def.id + '.js', 'имя файла должно совпадать с id стратегии');
  });
});
