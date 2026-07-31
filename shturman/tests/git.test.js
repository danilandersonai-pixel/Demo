'use strict';

var test = require('node:test');
var assert = require('node:assert');
var git = require('../lib/git');

/* ---------- git status --porcelain ---------- */

test('parseStatus: изменённый и новый файлы', function () {
  var out = git.parseStatus(' M lib/app.js\n?? new-file.txt\n');
  assert.strictEqual(out.total, 2);
  assert.strictEqual(out.unstaged, 1);
  assert.strictEqual(out.untracked, 1);
  assert.strictEqual(out.entries[0].file, 'lib/app.js');
  assert.strictEqual(out.entries[1].untracked, true);
});

test('parseStatus: staged и смешанные состояния', function () {
  var out = git.parseStatus('M  staged.js\nMM both.js\nA  added.js\n');
  assert.strictEqual(out.staged, 3);
  assert.strictEqual(out.unstaged, 1); // MM: правки и в индексе, и в рабочей копии
});

test('parseStatus: переименование с " -> "', function () {
  var out = git.parseStatus('R  old-name.js -> new-name.js\n');
  assert.strictEqual(out.entries[0].file, 'new-name.js');
  assert.strictEqual(out.entries[0].renamedFrom, 'old-name.js');
});

test('parseStatus: конфликт слияния распознан', function () {
  var out = git.parseStatus('UU conflict.js\n');
  assert.strictEqual(out.conflicts, 1);
  assert.ok(out.entries[0].human.indexOf('онфликт') !== -1);
});

test('parseStatus: путь в кавычках (пробелы/кириллица) расшифрован', function () {
  var out = git.parseStatus('?? "\\u043f\\u0430\\u043f\\u043a\\u0430/a b.txt"\n');
  assert.strictEqual(out.entries[0].file, 'папка/a b.txt');
});

test('parseStatus: пустой ввод — пустой результат', function () {
  var out = git.parseStatus('');
  assert.strictEqual(out.total, 0);
  assert.deepStrictEqual(out.entries, []);
});

test('parseStatus: человеческое описание для новичка', function () {
  var out = git.parseStatus(' M a.js\n?? b.js\n');
  assert.ok(out.entries[0].human.indexOf('ещё не подготовлен') !== -1);
  assert.ok(out.entries[1].human.indexOf('не отслеживает') !== -1);
});

/* ---------- git log ---------- */

var F = String.fromCharCode(31);
var R = String.fromCharCode(30);

test('parseLog: разбирает записи в нашем формате', function () {
  var text = 'abc123' + F + 'abc' + F + 'Иван' + F + '2026-07-31T01:00:00+03:00' + F + 'Первый коммит' + R +
    '\ndef456' + F + 'def' + F + 'Claude' + F + '2026-07-31T02:00:00+03:00' + F + 'Второй: с двоеточием' + R;
  var commits = git.parseLog(text);
  assert.strictEqual(commits.length, 2);
  assert.strictEqual(commits[0].author, 'Иван');
  assert.strictEqual(commits[1].subject, 'Второй: с двоеточием');
  assert.strictEqual(commits[1].short, 'def');
});

test('parseLog: пустой вывод — пустой список', function () {
  assert.deepStrictEqual(git.parseLog(''), []);
});

/* ---------- git diff --numstat ---------- */

test('parseNumstat: числа и бинарные файлы', function () {
  var rows = git.parseNumstat('10\t2\tsrc/app.js\n-\t-\tlogo.png\n');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].added, 10);
  assert.strictEqual(rows[0].removed, 2);
  assert.strictEqual(rows[1].binary, true);
});

test('parseNumstat: имя файла с табом не теряется', function () {
  var rows = git.parseNumstat('1\t1\tstrange\tname.txt\n');
  assert.strictEqual(rows[0].file, 'strange\tname.txt');
});

/* ---------- упрощение диффа ---------- */

var SAMPLE_DIFF = [
  'diff --git a/app.js b/app.js',
  'index 111..222 100644',
  '--- a/app.js',
  '+++ b/app.js',
  '@@ -1,3 +1,4 @@ function main',
  ' var a = 1;',
  '-var b = 2;',
  '+var b = 3;',
  '+var c = 4;'
].join('\n');

test('simplifyDiff: add/del/ctx/hunk/meta классифицированы', function () {
  var lines = git.simplifyDiff(SAMPLE_DIFF);
  var kinds = lines.map(function (l) { return l.kind; });
  assert.deepStrictEqual(kinds, ['meta', 'meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'add', 'add']);
});

test('simplifyDiff: маркеры +/- убраны из текста', function () {
  var lines = git.simplifyDiff(SAMPLE_DIFF);
  var add = lines.filter(function (l) { return l.kind === 'add'; });
  assert.strictEqual(add[0].text, 'var b = 3;');
  var del = lines.filter(function (l) { return l.kind === 'del'; });
  assert.strictEqual(del[0].text, 'var b = 2;');
});

test('humanHunkHeader: переведён на русский', function () {
  assert.strictEqual(git.humanHunkHeader('@@ -12,5 +14,8 @@ function foo'), 'со строки 14 · function foo');
  assert.strictEqual(git.humanHunkHeader('@@ -1 +1 @@'), 'со строки 1');
});

/* ---------- смысл ветки ---------- */

test('describeBranch: главная, рабочая Клода, фича, пустая', function () {
  assert.ok(git.describeBranch('main').indexOf('лавная') !== -1);
  assert.ok(git.describeBranch('claude/fix-tests-abc').indexOf('Клода') !== -1);
  assert.ok(git.describeBranch('feature/login').indexOf('функции') !== -1);
  assert.ok(git.describeBranch('').indexOf('не определена') !== -1);
});

test('describeBranch: неизвестное имя — общее объяснение с именем ветки', function () {
  var d = git.describeBranch('experiment-42');
  assert.ok(d.indexOf('experiment-42') !== -1);
  assert.ok(d.indexOf('merge') !== -1);
});

/* ---------- белый список команд ---------- */

test('runGit: команды вне белого списка отклоняются без запуска', function () {
  return git.runGit(['push', 'origin', 'main'], '.').then(function (r) {
    assert.strictEqual(r.ok, false);
    assert.ok(r.stderr.indexOf('белого списка') !== -1);
  });
});

test('runGit: commit тоже под запретом (только чтение)', function () {
  return git.runGit(['commit', '-m', 'x'], '.').then(function (r) {
    assert.strictEqual(r.ok, false);
  });
});
