'use strict';

// Тесты построчного диффа без git — он нужен на уровне B и для файлов,
// которых git не знает.

var test = require('node:test');
var assert = require('node:assert');
var td = require('../lib/textdiff');

function types(lines) {
  return lines.map(function (l) { return l.type; }).join('');
}

test('splitLines: хвостовой перевод строки не создаёт пустую строку', function () {
  assert.deepStrictEqual(td.splitLines('а\nб\n'), ['а', 'б']);
  assert.deepStrictEqual(td.splitLines('а\nб'), ['а', 'б']);
  assert.deepStrictEqual(td.splitLines(''), []);
  assert.deepStrictEqual(td.splitLines(null), []);
  assert.deepStrictEqual(td.splitLines('\n'), ['']);
});

test('diffLines: одинаковый текст даёт только контекст', function () {
  var d = td.diffLines('а\nб\nв', 'а\nб\nв');
  assert.strictEqual(types(d), 'ctxctxctx');
});

test('diffLines: добавление строки в середину', function () {
  var d = td.diffLines('а\nв', 'а\nб\nв');
  assert.strictEqual(types(d), 'ctxaddctx');
  assert.strictEqual(d[1].text, 'б');
  assert.strictEqual(d[1].newLine, 2);
});

test('diffLines: удаление строки', function () {
  var d = td.diffLines('а\nб\nв', 'а\nв');
  assert.strictEqual(types(d), 'ctxdelctx');
  assert.strictEqual(d[1].text, 'б');
  assert.strictEqual(d[1].oldLine, 2);
});

test('diffLines: замена строки — это удаление плюс добавление', function () {
  var d = td.diffLines('а\nстарое\nв', 'а\nновое\nв');
  var t = types(d);
  assert.ok(t === 'ctxdeladdctx' || t === 'ctxadddelctx', 'получилось: ' + t);
  assert.strictEqual(d.filter(function (l) { return l.type === 'del'; })[0].text, 'старое');
  assert.strictEqual(d.filter(function (l) { return l.type === 'add'; })[0].text, 'новое');
});

test('diffLines: создание файла с нуля', function () {
  var d = td.diffLines('', 'первая\nвторая');
  assert.strictEqual(types(d), 'addadd');
});

test('diffLines: полное удаление содержимого', function () {
  var d = td.diffLines('первая\nвторая', '');
  assert.strictEqual(types(d), 'deldel');
});

test('diffLines: большой фрагмент не строит матрицу, а показывает замену', function () {
  var big = new Array(td.MAX_LINES).fill('строка').join('\n');
  var d = td.diffLines(big, big + '\nещё');
  assert.ok(d.every(function (l) { return l.type !== 'ctx'; }),
    'на предохранителе контекста не остаётся');
  assert.ok(d.length > td.MAX_LINES);
});

test('toHunks: изменения группируются с контекстом', function () {
  var oldText = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n');
  var newText = ['1', '2', '3', '4', 'ПЯТЬ', '6', '7', '8', '9', '10'].join('\n');
  var hunks = td.toHunks(td.diffLines(oldText, newText), 2);
  assert.strictEqual(hunks.length, 1, 'одно изменение — один кусок');
  var texts = hunks[0].lines.map(function (l) { return l.text; });
  assert.ok(texts.indexOf('3') !== -1, 'контекст сверху есть');
  assert.ok(texts.indexOf('7') !== -1, 'контекст снизу есть');
  assert.ok(texts.indexOf('1') === -1, 'далёкие строки не попали');
});

test('toHunks: далёкие изменения дают два куска, близкие — один', function () {
  var a = new Array(30).fill(0).map(function (_, i) { return 'строка ' + i; });
  var far = a.slice();
  far[2] = 'изменено';
  far[25] = 'изменено';
  assert.strictEqual(td.toHunks(td.diffLines(a.join('\n'), far.join('\n')), 2).length, 2);

  var near = a.slice();
  near[10] = 'изменено';
  near[12] = 'изменено';
  assert.strictEqual(td.toHunks(td.diffLines(a.join('\n'), near.join('\n')), 3).length, 1);
});

test('toHunks: без изменений кусков нет', function () {
  assert.deepStrictEqual(td.toHunks(td.diffLines('а\nб', 'а\nб')), []);
});

test('buildFileDiff отдаёт ту же форму, что и разбор git diff', function () {
  var f = td.buildFileDiff('engine/game.js',
    "const a = require('./a')\nconst b = require('./bb')",
    "const a = require('./a')\nconst b = require('./b')\nconst c = require('./c')");

  assert.strictEqual(f.path, 'engine/game.js');
  assert.strictEqual(f.added, 2);
  assert.strictEqual(f.removed, 1);
  assert.strictEqual(f.binary, false);
  assert.strictEqual(f.reconstructed, true, 'помечен как восстановленный');
  assert.ok(f.hunks.length >= 1);
  f.hunks.forEach(function (hk) {
    assert.ok(typeof hk.oldStart === 'number');
    assert.ok(typeof hk.newStart === 'number');
    hk.lines.forEach(function (l) {
      assert.ok(['add', 'del', 'ctx'].indexOf(l.type) !== -1);
      assert.strictEqual(typeof l.text, 'string');
    });
  });
});
