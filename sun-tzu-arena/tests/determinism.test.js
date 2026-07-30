'use strict';

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');

var simulate = require('../sim/simulate');
var spatial = require('../sim/spatial');
var replayLib = require('../sim/replay');
var match = require('../engine/match');
var registry = require('../strategies');

var REFERENCE_SEEDS = [7, 42, 2026];

test('детерминизм: два матча с одним сидом совпадают до последнего очка', function () {
  var a = match.playMatch(registry.list[6], registry.list[9], { rounds: 200, noise: 0.05, seed: 12345, log: true });
  var b = match.playMatch(registry.list[6], registry.list[9], { rounds: 200, noise: 0.05, seed: 12345, log: true });
  assert.deepStrictEqual(a.log, b.log);
  assert.strictEqual(a.scoreA, b.scoreA);
  assert.strictEqual(a.flipsA, b.flipsA);
});

test('детерминизм: два прогона с одним сидом дают побайтово одинаковый JSON', function () {
  REFERENCE_SEEDS.forEach(function (seed) {
    var one = replayLib.serializeJson(simulate.run({ seed: seed, generations: 12 }));
    var two = replayLib.serializeJson(simulate.run({ seed: seed, generations: 12 }));
    assert.strictEqual(one, two, 'сид ' + seed + ' невоспроизводим');
  });
});

test('детерминизм: разные сиды дают разные результаты', function () {
  var runs = REFERENCE_SEEDS.map(function (seed) {
    return replayLib.serializeJson(simulate.run({ seed: seed, generations: 12 }));
  });
  assert.notStrictEqual(runs[0], runs[1]);
  assert.notStrictEqual(runs[1], runs[2]);
  assert.notStrictEqual(runs[0], runs[2]);
});

test('детерминизм: эталонные прогоны различаются по существу, а не только байтами', function () {
  var runs = REFERENCE_SEEDS.map(function (seed) {
    return simulate.run({ seed: seed, generations: 30 });
  });
  var signatures = runs.map(function (run) {
    return run.extinctions.map(function (e) { return e.id + '@' + e.gen; }).join(',');
  });
  assert.notStrictEqual(signatures[0], signatures[1], 'порядок вымираний обязан отличаться между сидами');
  var leaders = runs.map(function (run) { return run.standings[0].share; });
  assert.notStrictEqual(leaders[0], leaders[1]);
});

test('детерминизм: пространственный режим воспроизводится побайтово', function () {
  var one = replayLib.serializeJson(spatial.run({ seed: 42, generations: 6 }));
  var two = replayLib.serializeJson(spatial.run({ seed: 42, generations: 6 }));
  assert.strictEqual(one, two);
  var other = replayLib.serializeJson(spatial.run({ seed: 7, generations: 6 }));
  assert.notStrictEqual(one, other);
});

test('детерминизм: файл реплея, записанный дважды, совпадает побайтово', function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-'));
  try {
    var runs = [simulate.run({ seed: 7, generations: 5 }), simulate.run({ seed: 42, generations: 5 })];
    var arenaData = replayLib.buildArenaData(runs, {});
    var one = path.join(dir, 'a.js');
    var two = path.join(dir, 'b.js');
    replayLib.writeReplay(one, arenaData);
    replayLib.writeReplay(two, replayLib.buildArenaData(
      [simulate.run({ seed: 7, generations: 5 }), simulate.run({ seed: 42, generations: 5 })], {}
    ));
    assert.ok(fs.readFileSync(one).equals(fs.readFileSync(two)), 'реплей невоспроизводим');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('детерминизм: в выгрузке нет временных штампов и прочих летучих полей', function () {
  var json = replayLib.serializeJson(
    replayLib.buildArenaData([simulate.run({ seed: 7, generations: 3 })], {})
  );
  ['generatedAt', 'timestamp', 'createdAt', 'date', 'now'].forEach(function (key) {
    assert.strictEqual(json.indexOf('"' + key + '"'), -1, 'найдено летучее поле ' + key);
  });
  var yearNow = String(new Date().getFullYear());
  assert.strictEqual(
    json.indexOf('"' + yearNow + '-'), -1, 'похоже на дату в ISO-формате — она сломает воспроизводимость'
  );
});

test('детерминизм: результаты в results/ совпадают со свежим пересчётом', function () {
  var dir = path.join(__dirname, '..', 'results');
  REFERENCE_SEEDS.forEach(function (seed) {
    var file = path.join(dir, seed + '.json');
    assert.ok(fs.existsSync(file), 'нет ' + file + ' — запусти node sim/run.js --all');
    var stored = fs.readFileSync(file, 'utf8');
    var fresh = replayLib.serializeJson(simulate.run({ seed: seed, generations: 30 }));
    assert.strictEqual(stored, fresh,
      'results/' + seed + '.json разошёлся с пересчётом — перегенерируй прогоны');
  });
});
