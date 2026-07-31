'use strict';

// Тесты мини-карты внимания: какие файлы попадают в граф и как между ними
// возникают связи.

var test = require('node:test');
var assert = require('node:assert');
var att = require('../lib/attention');

function make(opts) {
  return att.createAttention(Object.assign({ now: function () { return 0; } }, opts || {}));
}

test('первое касание создаёт узел, он же в фокусе', function () {
  var a = make();
  assert.strictEqual(a.touch('src/game.js', 'read', 1000), true);
  var s = a.snapshot(1000);
  assert.strictEqual(s.nodes.length, 1);
  assert.strictEqual(s.focus, 'src/game.js');
  assert.strictEqual(s.nodes[0].name, 'game.js');
  assert.strictEqual(s.nodes[0].dir, 'src');
  assert.strictEqual(s.nodes[0].kind, 'read');
});

test('правка перевешивает чтение при определении вида узла', function () {
  var a = make();
  a.touch('a.js', 'read', 1000);
  a.touch('a.js', 'edit', 2000);
  var n = a.snapshot(2000).nodes[0];
  assert.strictEqual(n.kind, 'edit');
  assert.strictEqual(n.reads, 1);
  assert.strictEqual(n.edits, 1);
  assert.strictEqual(n.touches, 2);
});

test('поиск и команды в граф не попадают', function () {
  var a = make();
  assert.strictEqual(a.touch('a.js', 'search', 1000), false);
  assert.strictEqual(a.touch('a.js', 'run', 1000), false);
  assert.strictEqual(a.touch(null, 'read', 1000), false);
  assert.strictEqual(a.size(), 0);
});

test('два файла подряд связываются', function () {
  var a = make();
  a.touch('a.js', 'read', 1000);
  a.touch('b.js', 'read', 2000);
  var s = a.snapshot(2000);
  assert.strictEqual(s.links.length, 1);
  assert.strictEqual(s.links[0].from, 'a.js');
  assert.strictEqual(s.links[0].to, 'b.js');
  assert.strictEqual(s.focus, 'b.js', 'в фокусе — последний');
});

test('большой перерыв связь не создаёт', function () {
  var a = make();
  a.touch('a.js', 'read', 1000);
  a.touch('b.js', 'read', 1000 + 5 * 60000);   // пять минут спустя
  assert.strictEqual(a.snapshot().links.length, 0,
    'это уже другая мысль, а не продолжение той же');
});

test('повторный переход усиливает связь', function () {
  var a = make();
  a.touch('a.js', 'read', 1000);
  a.touch('b.js', 'read', 2000);
  a.touch('a.js', 'read', 3000);
  a.touch('b.js', 'read', 4000);
  var link = a.snapshot(4000).links.filter(function (l) {
    return l.from === 'a.js' && l.to === 'b.js';
  })[0];
  assert.strictEqual(link.count, 2);
  assert.ok(link.strength > 0.5);
});

test('повторное касание того же файла связь с самим собой не создаёт', function () {
  var a = make();
  a.touch('a.js', 'read', 1000);
  a.touch('a.js', 'edit', 2000);
  assert.strictEqual(a.snapshot().links.length, 0);
});

test('свежесть падает со временем', function () {
  var a = make({ halfLife: 1000 });
  a.touch('a.js', 'read', 0);
  assert.strictEqual(a.snapshot(0).nodes[0].freshness, 1);
  assert.ok(Math.abs(a.snapshot(1000).nodes[0].freshness - 0.5) < 0.001,
    'через один период полураспада — половина');
  assert.ok(a.snapshot(4000).nodes[0].freshness < 0.1);
});

test('узлы отсортированы от свежего к давнему', function () {
  var a = make();
  a.touch('старый.js', 'read', 1000);
  a.touch('средний.js', 'read', 2000);
  a.touch('свежий.js', 'read', 3000);
  var names = a.snapshot(3000).nodes.map(function (n) { return n.name; });
  assert.deepStrictEqual(names, ['свежий.js', 'средний.js', 'старый.js']);
});

test('карта не разрастается: старые узлы выбывают вместе со связями', function () {
  var a = make({ maxNodes: 3 });
  for (var i = 0; i < 8; i++) a.touch('f' + i + '.js', 'read', 1000 + i * 100);
  var s = a.snapshot(2000);
  assert.strictEqual(s.nodes.length, 3);
  assert.strictEqual(s.nodes[0].file, 'f7.js', 'остались самые свежие');

  var known = new Set(s.nodes.map(function (n) { return n.file; }));
  s.links.forEach(function (l) {
    assert.ok(known.has(l.from) && known.has(l.to), 'висячих связей не осталось');
  });
});

test('пустая карта помечена как пустая', function () {
  var s = make().snapshot(0);
  assert.strictEqual(s.empty, true);
  assert.strictEqual(s.focus, null);
  assert.deepStrictEqual(s.nodes, []);
  assert.deepStrictEqual(s.links, []);
});

test('reset очищает карту', function () {
  var a = make();
  a.touch('a.js', 'read', 1000);
  a.touch('b.js', 'read', 2000);
  a.reset();
  assert.strictEqual(a.size(), 0);
  assert.strictEqual(a.snapshot().empty, true);
});

test('пульс отдаёт карту внимания вместе со сводкой', function () {
  var statsLib = require('../lib/stats');
  var s = statsLib.createStats({ now: function () { return 5000; }, startedAt: 0 });
  s.add({ kind: 'tool', action: 'read', file: 'a.js', ts: 1000 });
  s.add({ kind: 'tool', action: 'edit', file: 'b.js', ts: 2000 });
  var snap = s.snapshot();
  assert.ok(snap.attention, 'карта внимания в пульсе есть');
  assert.strictEqual(snap.attention.nodes.length, 2);
  assert.strictEqual(snap.attention.focus, 'b.js');
  assert.strictEqual(snap.attention.links.length, 1);
});
