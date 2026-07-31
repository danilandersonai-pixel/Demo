'use strict';

// Тесты разбора вывода git — на зафиксированных образцах реального вывода.

var test = require('node:test');
var assert = require('node:assert');
var gp = require('../lib/git-parse');
var h = require('./helpers');

test('parseStatus: разбирает все коды из фикстуры', function () {
  var entries = gp.parseStatus(h.fixture('git-status.txt'));
  var byPath = {};
  entries.forEach(function (e) { byPath[e.path] = e; });

  assert.strictEqual(entries.length, 11);

  // Изменён только в рабочем каталоге.
  assert.strictEqual(byPath['lib/humanize.js'].code, ' M');
  assert.strictEqual(byPath['lib/humanize.js'].staged, false);
  assert.strictEqual(byPath['lib/humanize.js'].label, 'изменён');

  // Изменён и подготовлен.
  assert.strictEqual(byPath['lib/git.js'].staged, true);

  // Изменён и там, и там.
  assert.strictEqual(byPath['public/app.js'].code, 'MM');
  assert.strictEqual(byPath['public/app.js'].staged, true);

  // Новый файл.
  assert.strictEqual(byPath['scratch/'].untracked, true);
  assert.strictEqual(byPath['scratch/'].label, 'новый');
  assert.match(byPath['scratch/'].explain, /Git его пока не отслеживает/);

  // Игнорируемый.
  assert.strictEqual(byPath['ignored.log'].label, 'игнорируется');

  // Конфликт.
  assert.strictEqual(byPath['конфликт.js'].conflicted, true);
  assert.match(byPath['конфликт.js'].explain, /Конфликт/);
});

test('parseStatus: переименование сохраняет старое имя', function () {
  var entries = gp.parseStatus(h.fixture('git-status.txt'));
  var renamed = entries.filter(function (e) { return e.from; })[0];
  assert.strictEqual(renamed.from, 'lib/old-name.js');
  assert.strictEqual(renamed.path, 'lib/new-name.js');
  assert.strictEqual(renamed.label, 'переименован');
});

test('parseStatus: путь в кавычках с экранированной кириллицей', function () {
  var entries = gp.parseStatus(h.fixture('git-status.txt'));
  var quoted = entries.filter(function (e) { return /кириллицей/.test(e.path); })[0];
  assert.ok(quoted, 'путь с восьмеричным экранированием разобран: ' +
    entries.map(function (e) { return e.path; }).join(', '));
  assert.strictEqual(quoted.path, 'путь с кириллицей.txt');
});

test('parseStatus: пустой ввод и мусор не роняют разбор', function () {
  assert.deepStrictEqual(gp.parseStatus(''), []);
  assert.deepStrictEqual(gp.parseStatus(null), []);
  assert.deepStrictEqual(gp.parseStatus(undefined), []);
  assert.deepStrictEqual(gp.parseStatus('X'), [], 'слишком короткая строка пропущена');
});

test('parseStatus: поддерживает формат -z с нулевым разделителем', function () {
  var NUL = String.fromCharCode(0);
  var entries = gp.parseStatus(' M a.js' + NUL + '?? b.txt' + NUL);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].path, 'a.js');
  assert.strictEqual(entries[1].untracked, true);
});

test('summarizeStatus: считает по категориям и объясняет по-русски', function () {
  var entries = gp.parseStatus(h.fixture('git-status.txt'));
  var s = gp.summarizeStatus(entries);
  assert.strictEqual(s.total, 11);
  assert.ok(s.untracked >= 2);
  assert.strictEqual(s.conflicted, 1);
  assert.match(s.explain, /несохранённ/);

  var clean = gp.summarizeStatus([]);
  assert.strictEqual(clean.total, 0);
  assert.match(clean.explain, /Чисто/);
});

test('parseLog: разбирает записи с разделителями', function () {
  var commits = gp.parseLog(h.fixture('git-log.txt'));
  assert.strictEqual(commits.length, 3);
  assert.strictEqual(commits[0].short, 'aaa111b');
  assert.strictEqual(commits[0].author, 'Оля');
  assert.strictEqual(commits[0].subject, 'fix: поправлен импорт в движке');
  assert.strictEqual(commits[0].merge, false);
  assert.ok(commits[0].ts > 0, 'дата разобрана');

  assert.strictEqual(commits[1].merge, true, 'два родителя — это слияние');
  assert.strictEqual(commits[2].parents.length, 0, 'у первого коммита родителей нет');
});

test('parseLog: пустой вывод даёт пустой список', function () {
  assert.deepStrictEqual(gp.parseLog(''), []);
  assert.deepStrictEqual(gp.parseLog(null), []);
});

test('describeCommit: подписи по типу коммита', function () {
  var commits = gp.parseLog(h.fixture('git-log.txt'));
  assert.match(gp.describeCommit(commits[0]), /Исправление/);
  assert.match(gp.describeCommit(commits[1]), /Объединение веток/);
  assert.match(gp.describeCommit(commits[2]), /первое сохранение/);
  assert.match(gp.describeCommit({ subject: 'docs: правки' }), /документаци/);
  assert.match(gp.describeCommit({ subject: 'что-то своё' }), /Сохранение в истории/);
  assert.strictEqual(gp.describeCommit(null), '');
});

test('parseNumstat: считает добавленное, удалённое и бинарники', function () {
  var r = gp.parseNumstat(h.fixture('git-numstat.txt'));
  assert.strictEqual(r.files.length, 4);
  assert.strictEqual(r.totals.added, 45);
  assert.strictEqual(r.totals.removed, 23);
  assert.strictEqual(r.totals.binary, 1);

  var bin = r.files.filter(function (f) { return f.binary; })[0];
  assert.strictEqual(bin.path, 'assets/logo.png');
  assert.strictEqual(bin.added, 0, 'у бинарника строк нет');
});

test('parseNumstat: при переименовании берётся новое имя', function () {
  var r = gp.parseNumstat(h.fixture('git-numstat.txt'));
  var renamed = r.files.filter(function (f) { return /mod\.js$/.test(f.path); })[0];
  assert.strictEqual(renamed.path, 'new/mod.js');
});

test('parseDiff: разбирает куски и помечает строки', function () {
  var files = gp.parseDiff(h.fixture('git-diff.txt'));
  assert.strictEqual(files.length, 2);

  var game = files[0];
  assert.strictEqual(game.path, 'engine/game.js');
  assert.strictEqual(game.hunks.length, 2);
  assert.strictEqual(game.added, 3);
  assert.strictEqual(game.removed, 2);
  assert.strictEqual(game.hunks[0].newStart, 1);
  assert.strictEqual(game.hunks[0].context, 'function start()');

  var types = game.hunks[0].lines.map(function (l) { return l.type; });
  assert.deepStrictEqual(types, ['ctx', 'del', 'add', 'add', 'ctx']);

  // Служебные строки (index, ---, +++) в вывод не попали.
  var texts = game.hunks[0].lines.map(function (l) { return l.text; });
  assert.ok(!texts.some(function (t) { return /^\+\+ b\// .test(t); }));

  assert.strictEqual(files[1].binary, true, 'бинарный файл помечен');
});

test('parseDiff: пустой ввод даёт пустой список', function () {
  assert.deepStrictEqual(gp.parseDiff(''), []);
  assert.deepStrictEqual(gp.parseDiff(null), []);
});

test('parseAheadBehind: разбирает счётчик расхождения', function () {
  assert.deepStrictEqual(gp.parseAheadBehind('2\t5'), { behind: 2, ahead: 5 });
  assert.deepStrictEqual(gp.parseAheadBehind('0  0'), { behind: 0, ahead: 0 });
  assert.deepStrictEqual(gp.parseAheadBehind(''), { behind: 0, ahead: 0 });
});

test('unquotePath: восьмеричные последовательности и экранирование', function () {
  assert.strictEqual(gp.unquotePath('обычный.txt'), 'обычный.txt');
  assert.strictEqual(gp.unquotePath('"\\320\\276\\320\\272.txt"'), 'ок.txt');
  assert.strictEqual(gp.unquotePath('"с \\"кавычками\\".txt"'), 'с "кавычками".txt');
});
