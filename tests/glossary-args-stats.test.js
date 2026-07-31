'use strict';

// Тесты словаря, разбора флагов, пульса сессии и дайджеста.

var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');
var glossary = require('../lib/glossary');
var argsLib = require('../lib/args');
var statsLib = require('../lib/stats');
var digest = require('../lib/digest');
var tp = require('../lib/transcript-parse');
var h = require('./helpers');

// ── Словарь ─────────────────────────────────────────────────────────────────

test('в словаре не меньше 25 терминов (требование задания)', function () {
  assert.ok(glossary.count >= 25, 'терминов: ' + glossary.count);
});

test('обязательные термины из задания на месте', function () {
  ['commit', 'branch', 'repository', 'merge', 'pull', 'push', 'gitignore',
    'dependency', 'npm', 'localhost', 'port', 'token', 'context']
    .forEach(function (id) {
      assert.ok(glossary.get(id), 'нет термина ' + id);
    });
});

test('каждое объяснение — одно-два внятных предложения без жаргона', function () {
  glossary.all().forEach(function (t) {
    assert.ok(t.term && t.term.length > 1, 'у термина есть название');
    assert.ok(t.text.length >= 40, t.id + ': объяснение слишком короткое');
    assert.ok(t.text.length <= 400, t.id + ': объяснение слишком длинное');
    var sentences = t.text.split(/[.!?]\s/).filter(function (s) { return s.trim(); });
    assert.ok(sentences.length <= 3, t.id + ': предложений больше трёх');
    assert.ok(/[а-яА-ЯёЁ]/.test(t.text), t.id + ': текст должен быть на русском');
  });
});

test('термины уникальны по идентификатору', function () {
  var ids = glossary.all().map(function (t) { return t.id; });
  assert.strictEqual(new Set(ids).size, ids.length, 'есть повторяющиеся id');
});

test('поиск по словарю находит по названию, псевдониму и тексту', function () {
  assert.ok(glossary.search('коммит').length > 0);
  assert.ok(glossary.search('пуш').length > 0, 'псевдоним «пуш» ведёт к push');
  assert.ok(glossary.search('токен').length > 0);
  assert.strictEqual(glossary.search('такогословатутнет').length, 0);
  assert.strictEqual(glossary.search('').length, glossary.count, 'пустой запрос — весь словарь');
});

test('get понимает и id, и название, и псевдоним', function () {
  assert.strictEqual(glossary.get('push').id, 'push');
  assert.strictEqual(glossary.get('Push').id, 'push');
  assert.strictEqual(glossary.get('пуш').id, 'push');
  assert.strictEqual(glossary.get('127.0.0.1').id, 'localhost');
  assert.strictEqual(glossary.get('нетакого'), null);
  assert.strictEqual(glossary.get(''), null);
});

test('словарь отсортирован по алфавиту', function () {
  var terms = glossary.all().map(function (t) { return t.term; });
  var sorted = terms.slice().sort(function (a, b) { return a.localeCompare(b, 'ru'); });
  assert.deepStrictEqual(terms, sorted);
});

// ── Флаги командной строки ──────────────────────────────────────────────────

test('args: значения по умолчанию', function () {
  var a = argsLib.parse([]);
  assert.strictEqual(a.port, 4517);
  assert.strictEqual(a.host, '127.0.0.1');
  assert.strictEqual(a.idle, 45);
  assert.strictEqual(a.idleMs, 45000);
  assert.strictEqual(a.projectAbs, path.resolve('.'));
});

test('args: «--key value» и «--key=value» работают одинаково', function () {
  var a = argsLib.parse(['--port', '5000', '--project', '/tmp/проект']);
  var b = argsLib.parse(['--port=5000', '--project=/tmp/проект']);
  assert.strictEqual(a.port, b.port);
  assert.strictEqual(a.projectAbs, b.projectAbs);
  assert.strictEqual(a.projectAbs, path.resolve('/tmp/проект'));
});

test('args: позиционный аргумент — это путь к проекту', function () {
  var a = argsLib.parse(['../соседний']);
  assert.strictEqual(a.projectAbs, path.resolve('../соседний'));
});

test('args: флаги без значений', function () {
  var a = argsLib.parse(['--open', '--ask', '--force-poll', '--tail-only', '--quiet']);
  assert.strictEqual(a.open, true);
  assert.strictEqual(a.ask, true);
  assert.strictEqual(a.forcePoll, true);
  assert.strictEqual(a.tailOnly, true);
  assert.strictEqual(a.quiet, true);
});

test('args: --help и --version перехватываются до всего остального', function () {
  var hlp = argsLib.parse(['--help', '--что-угодно']);
  assert.strictEqual(hlp.help, true);
  assert.match(hlp.text, /Штурман/);
  assert.strictEqual(argsLib.parse(['-v']).version, true);
});

test('args: понятные ошибки вместо стека', function () {
  assert.throws(function () { argsLib.parse(['--неизвестный']); }, /Неизвестный флаг/);
  assert.throws(function () { argsLib.parse(['--port']); }, /нужно значение/);
  assert.throws(function () { argsLib.parse(['--port', 'абв']); }, /целым числом/);
  assert.throws(function () { argsLib.parse(['--port', '99999']); }, /должно быть от 1 до 65535/);
  assert.throws(function () { argsLib.parse(['--idle', '1']); }, /от 5 до 3600/);
});

test('args: несколько --project дают список проектов', function () {
  var a = argsLib.parse(['--project', '/tmp/один', '--project', '/tmp/два']);
  assert.strictEqual(a.projects.length, 2);
  assert.strictEqual(a.projects[0], path.resolve('/tmp/один'));
  assert.strictEqual(a.projects[1], path.resolve('/tmp/два'));
  assert.strictEqual(a.projectAbs, a.projects[0], 'основной проект — первый');
});

test('args: повторы одной папки схлопываются', function () {
  var a = argsLib.parse(['--project', '/tmp/один', '--project', '/tmp/один', '/tmp/один']);
  assert.strictEqual(a.projects.length, 1,
    'два наблюдателя на одну папку удвоили бы события в ленте');
});

test('args: позиционные пути тоже становятся проектами', function () {
  var a = argsLib.parse(['../первый', '../второй']);
  assert.strictEqual(a.projects.length, 2);
});

test('args: без указания проекта берётся текущая папка', function () {
  var a = argsLib.parse([]);
  assert.deepStrictEqual(a.projects, [path.resolve('.')]);
});

test('args: --host принимается, но игнорируется — слушаем только петлю', function () {
  var a = argsLib.parse(['--host', '0.0.0.0']);
  assert.strictEqual(a.host, '127.0.0.1', 'наружу панель не выставляется ни при каких флагах');
});

// ── Пульс сессии ────────────────────────────────────────────────────────────

test('stats: считает файлы, команды и ошибки', function () {
  var t = 1000;
  var s = statsLib.createStats({ now: function () { return t; }, startedAt: 0 });

  s.add({ kind: 'tool', action: 'edit', file: 'a.js', ts: 100 });
  s.add({ kind: 'tool', action: 'edit', file: 'a.js', ts: 200 });   // тот же файл
  s.add({ kind: 'tool', action: 'edit', file: 'b.js', ts: 300 });
  s.add({ kind: 'tool', action: 'read', file: 'c.js', ts: 400 });
  s.add({ kind: 'tool', action: 'run', command: 'npm test', ts: 500 });
  s.add({ kind: 'result', ok: false, ts: 600 });
  s.add({ kind: 'user', ts: 700 });

  var snap = s.snapshot();
  assert.strictEqual(snap.filesTouched, 2, 'один файл дважды — всё равно один');
  assert.strictEqual(snap.edits, 3);
  assert.strictEqual(snap.reads, 1);
  assert.strictEqual(snap.commands, 1);
  assert.strictEqual(snap.errors, 1);
  assert.strictEqual(snap.prompts, 1);
  assert.strictEqual(snap.durationMs, 1000);
  assert.strictEqual(snap.quietMs, 300, 'от последнего события до сейчас');
});

test('stats: «куда смотрит Клод» держит последние файлы без повторов', function () {
  var s = statsLib.createStats({ startedAt: 0 });
  s.add({ kind: 'tool', action: 'read', file: 'a.js', ts: 1 });
  s.add({ kind: 'tool', action: 'read', file: 'b.js', ts: 2 });
  s.add({ kind: 'tool', action: 'edit', file: 'a.js', ts: 3 });     // a.js всплывает наверх

  var recent = s.snapshot().recentFiles;
  assert.strictEqual(recent[0].file, 'a.js');
  assert.strictEqual(recent[0].action, 'edit');
  assert.strictEqual(recent.length, 2, 'повтора нет');
});

test('stats: сводка одной строкой по-русски', function () {
  var s = statsLib.createStats({ now: function () { return 125000; }, startedAt: 0 });
  s.add({ kind: 'tool', action: 'edit', file: 'a.js', ts: 1 });
  s.add({ kind: 'tool', action: 'run', command: 'ls', ts: 2 });
  var text = s.snapshot().summaryText;
  assert.match(text, /^За 2 мин 5 с/);
  assert.match(text, /1 файл/);
  assert.match(text, /1 команда/);
  assert.match(text, /ошибок не замечено/);
});

test('stats: reset обнуляет счётчики', function () {
  var s = statsLib.createStats({ startedAt: 0 });
  s.add({ kind: 'tool', action: 'run', ts: 1 });
  s.reset();
  assert.strictEqual(s.snapshot().commands, 0);
});

// ── Дайджест ────────────────────────────────────────────────────────────────

test('digest: собирает markdown по событиям сессии', function () {
  var parser = tp.createParser({ projectRoot: '/home/user/proj' });
  var events = [];
  h.records('session-basic.jsonl').forEach(function (r) {
    parser.push(r).forEach(function (e) {
      var hz = require('../lib/humanize').humanize(e);
      events.push(Object.assign({}, e, { title: hz.title, hint: hz.hint }));
    });
  });

  var stats = statsLib.createStats({ now: function () { return 60000; }, startedAt: 0 });
  events.forEach(function (e) { stats.add(e); });

  var md = digest.build(events, {
    projectName: 'проба',
    stats: stats.snapshot(),
    tokens: parser.tokens(),
    git: {
      available: true, branch: 'feature/панель',
      branchExplain: 'Ветка с новой возможностью.',
      summary: { explain: 'Чисто.' },
      commits: [{ short: 'aaa1111', subject: 'fix: импорт' }]
    }
  });

  assert.match(md, /^# Что мы сегодня сделали/);
  assert.match(md, /\*\*Проект:\*\* проба/);
  assert.match(md, /## Что я просил у Клода/);
  assert.match(md, /Почини тесты/);
  assert.match(md, /## Какие файлы изменились/);
  assert.match(md, /engine\/game\.js/);
  assert.match(md, /## Какие команды выполнялись/);
  assert.match(md, /npm test/);
  assert.match(md, /## Что пошло не так/);
  assert.match(md, /## Состояние проекта в git/);
  assert.match(md, /## Расход токенов \(приблизительно\)/);
  assert.ok(md.indexOf('undefined') === -1, 'в дайджесте не должно быть undefined');
});

test('digest: пустая сессия не ломается', function () {
  var md = digest.build([], { projectName: 'пусто', stats: {} });
  assert.match(md, /Что мы сегодня сделали/);
  assert.match(md, /Данных о сессии не набралось/);
});

test('digest: одинаковые команды сворачиваются в одну строку', function () {
  var evs = [
    { kind: 'tool', action: 'run', command: 'npm test', ts: 1 },
    { kind: 'tool', action: 'run', command: 'npm test', ts: 2 },
    { kind: 'tool', action: 'run', command: 'npm test', ts: 3 }
  ];
  var md = digest.build(evs, { projectName: 'п', stats: {} });
  assert.match(md, /npm test`\s*×3/);
});

test('digest: имя файла с датой', function () {
  var name = digest.suggestFilename(Date.UTC(2026, 6, 31, 12));
  assert.match(name, /^shturman-2026-07-\d\d\.md$/);
});
