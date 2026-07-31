'use strict';

// Тесты перевода событий на человеческий русский.
// Проверяем не дословные формулировки, а смысл и грамматику: панель читает
// новичок, и «5 файла» или «Клод изменил undefined» здесь недопустимы.

var test = require('node:test');
var assert = require('node:assert');
var hz = require('../lib/humanize');
var tp = require('../lib/transcript-parse');
var h = require('./helpers');

test('plural: русские окончания, включая 11-14', function () {
  assert.strictEqual(hz.plural(1, 'файл', 'файла', 'файлов'), 'файл');
  assert.strictEqual(hz.plural(2, 'файл', 'файла', 'файлов'), 'файла');
  assert.strictEqual(hz.plural(5, 'файл', 'файла', 'файлов'), 'файлов');
  assert.strictEqual(hz.plural(11, 'файл', 'файла', 'файлов'), 'файлов', '11 — исключение');
  assert.strictEqual(hz.plural(12, 'файл', 'файла', 'файлов'), 'файлов');
  assert.strictEqual(hz.plural(14, 'файл', 'файла', 'файлов'), 'файлов');
  assert.strictEqual(hz.plural(21, 'файл', 'файла', 'файлов'), 'файл');
  assert.strictEqual(hz.plural(22, 'файл', 'файла', 'файлов'), 'файла');
  assert.strictEqual(hz.plural(111, 'файл', 'файла', 'файлов'), 'файлов');
  assert.strictEqual(hz.plural(0, 'файл', 'файла', 'файлов'), 'файлов');
  assert.strictEqual(hz.withPlural(3, 'файл', 'файла', 'файлов'), '3 файла');
});

test('formatDuration: секунды, минуты, часы', function () {
  assert.strictEqual(hz.formatDuration(0), '0 с');
  assert.strictEqual(hz.formatDuration(45000), '45 с');
  assert.strictEqual(hz.formatDuration(125000), '2 мин 5 с');
  assert.strictEqual(hz.formatDuration(3 * 3600000 + 14 * 60000), '3 ч 14 мин');
});

test('formatAgo: человеческое «когда»', function () {
  assert.strictEqual(hz.formatAgo(3000), 'только что');
  assert.strictEqual(hz.formatAgo(42000), '42 секунды назад');
  assert.strictEqual(hz.formatAgo(5 * 60000), '5 минут назад');
  assert.strictEqual(hz.formatAgo(3 * 3600000), '3 часа назад');
  assert.strictEqual(hz.formatAgo(26 * 3600000), 'вчера');
});

test('shorten: длинный текст обрезается многоточием, пробелы схлопываются', function () {
  assert.strictEqual(hz.shorten('коротко', 20), 'коротко');
  assert.strictEqual(hz.shorten('а   б\n\nв', 20), 'а б в');
  var long = hz.shorten('x'.repeat(200), 20);
  assert.strictEqual(long.length, 20);
  assert.ok(long.endsWith('…'));
  assert.strictEqual(hz.shorten(null, 10), '');
});

test('explainCommand: узнаёт распространённые команды', function () {
  assert.match(hz.explainCommand('npm test'), /тест/);
  assert.match(hz.explainCommand('npm run test -- --watch'), /тест/);
  assert.match(hz.explainCommand('npm install'), /библиотек/);
  assert.match(hz.explainCommand('git status'), /какие файлы изменились/);
  assert.match(hz.explainCommand('git push origin main'), /отправляет/);
  assert.match(hz.explainCommand('node --check a.js'), /синтаксическ/);
  assert.match(hz.explainCommand('rg TODO'), /ищет текст/);
  assert.match(hz.explainCommand('ls -la'), /какие файлы лежат/);
});

test('explainCommand: составная команда объясняется по первому звену', function () {
  assert.match(hz.explainCommand('npm test && git push'), /тест/);
  assert.match(hz.explainCommand('sudo npm install'), /библиотек/);
  assert.match(hz.explainCommand('grep -r x . | head'), /ищет текст/);
});

test('explainCommand: незнакомая команда не выдумывает объяснение', function () {
  assert.strictEqual(hz.explainCommand('нечто-невиданное --флаг'), null);
  assert.strictEqual(hz.explainCommand(''), null);
  assert.strictEqual(hz.explainCommand(null), null);
});

test('humanize: чтение файла', function () {
  var r = hz.humanize({ kind: 'tool', action: 'read', tool: 'Read', file: 'README.md' });
  assert.strictEqual(r.icon, '📖');
  assert.match(r.title, /Клод читает README\.md/);
  assert.match(r.hint, /не меняется/);
});

test('humanize: правка файла показывает +/- в заголовке', function () {
  var r = hz.humanize({
    kind: 'tool', action: 'edit', tool: 'Edit', file: 'engine/game.js',
    stats: { added: 42, removed: 7, approx: false }
  });
  assert.match(r.title, /Клод изменил engine\/game\.js/);
  assert.match(r.title, /\+42 −7/);
  assert.match(r.hint, /42 строки добавлено/);
  assert.match(r.hint, /7 строк удалено/);
});

test('humanize: приблизительная статистика помечена как приблизительная', function () {
  var r = hz.humanize({
    kind: 'tool', action: 'edit', file: 'a.js',
    stats: { added: 1, removed: 0, approx: true }
  });
  assert.match(r.hint, /примерно/);
});

test('humanize: команда объясняется прямо в заголовке', function () {
  var r = hz.humanize({ kind: 'tool', action: 'run', tool: 'Bash', command: 'npm test' });
  assert.strictEqual(r.icon, '🔧');
  assert.match(r.title, /Клод запустил npm test — проверяет, работают ли тесты/);
});

test('humanize: фоновая команда упоминает, что результат придёт позже', function () {
  var r = hz.humanize({ kind: 'tool', action: 'run', command: 'npm run dev', background: true });
  assert.match(r.hint, /в фоне/);
});

test('humanize: ошибка получает уровень error и понятную причину', function () {
  var r = hz.humanize({
    kind: 'result', action: 'error', ok: false, tool: 'Bash',
    stderr: 'FAIL tests/game.test.js'
  });
  assert.strictEqual(r.level, 'error');
  assert.strictEqual(r.icon, '⛔');
  assert.match(r.hint, /FAIL/);
});

test('humanize: прерванная команда — предупреждение, а не ошибка', function () {
  var r = hz.humanize({ kind: 'result', ok: false, interrupted: true });
  assert.strictEqual(r.level, 'warn');
  assert.match(r.title, /прерван/);
});

test('humanize: сигнал остановки объясняет, что делать', function () {
  var r = hz.humanize({ kind: 'session', action: 'idle', quietMs: 60000 });
  assert.match(r.title, /остановился и ждёт/);
  assert.match(r.hint, /1 мин/);
  assert.match(r.hint, /терминал/);
  assert.strictEqual(r.level, 'warn');
});

test('humanize: события git', function () {
  assert.match(hz.humanize({ kind: 'git', action: 'branch', branch: 'main' }).title, /Ветка теперь «main»/);
  assert.match(hz.humanize({ kind: 'git', action: 'commit', subject: 'fix: тест' }).title, /Новое сохранение/);
  assert.match(hz.humanize({ kind: 'git', action: 'dirty', count: 3 }).title, /3 файла изменено/);
  assert.match(hz.humanize({ kind: 'git', action: 'dirty', count: 0 }).title, /Все изменения сохранены/);
});

test('humanize: события файловой системы', function () {
  assert.match(hz.humanize({ kind: 'file', action: 'added', file: 'a.js' }).title, /Появился файл a\.js/);
  assert.match(hz.humanize({ kind: 'file', action: 'removed', file: 'a.js' }).title, /удалён/);
  assert.strictEqual(hz.humanize({ kind: 'file', action: 'removed', file: 'a.js' }).level, 'warn');
  assert.match(hz.humanize({ kind: 'file', action: 'changed', file: 'a.js' }).title, /изменён/);
});

test('humanize: неизвестное событие не роняет и не выдаёт undefined', function () {
  var r = hz.humanize({ kind: 'что-то-новое' });
  assert.ok(r.title);
  assert.ok(!/undefined/.test(r.title + r.hint));
  var empty = hz.humanize(null);
  assert.ok(empty.title);
});

test('ни одна формулировка не содержит undefined или [object Object]', function () {
  var parser = tp.createParser({ projectRoot: '/home/user/proj' });
  var bad = [];
  ['session-basic.jsonl', 'session-edge.jsonl', 'session-real-slice.jsonl'].forEach(function (f) {
    h.records(f).forEach(function (rec) {
      parser.push(rec).forEach(function (ev) {
        var r = hz.humanize(ev);
        var text = r.title + ' ' + r.hint;
        if (/undefined|\[object Object\]|NaN/.test(text)) bad.push(text);
        if (!r.title) bad.push('пустой заголовок для ' + ev.kind + '/' + ev.action);
      });
    });
  });
  assert.deepStrictEqual(bad, []);
});

test('describeBranch: смысл ветки одной строкой', function () {
  assert.match(hz.describeBranch('main'), /Главная ветка/);
  assert.match(hz.describeBranch('master'), /Главная ветка/);
  assert.match(hz.describeBranch('feature/панель'), /новой возможностью/);
  assert.match(hz.describeBranch('fix/подвал'), /исправлением/);
  assert.match(hz.describeBranch('claude/что-то'), /Claude Code/);
  assert.match(hz.describeBranch('HEAD (без ветки)'), /отсоединённая голова/);
  assert.match(hz.describeBranch('своя-ветка'), /Отдельная линия работы/);
  assert.match(hz.describeBranch(''), /не определена/);
});

test('describeDirty: объясняет смысл незакоммиченных изменений', function () {
  assert.match(hz.describeDirty(0), /Чисто/);
  assert.match(hz.describeDirty(1), /^1 файл/);
  assert.match(hz.describeDirty(5), /^5 файлов/);
  assert.match(hz.describeDirty(3), /нужен коммит/);
});

test('toolRu: русские имена инструментов и MCP', function () {
  assert.strictEqual(hz.toolRu('Bash'), 'команда в терминале');
  assert.strictEqual(hz.toolRu('Read'), 'чтение файла');
  assert.match(hz.toolRu('mcp__github__list_issues'), /внешний сервис github/);
  assert.strictEqual(hz.toolRu(null), 'инструмент');
});

test('statsLabel и statsHint пустые, когда считать нечего', function () {
  assert.strictEqual(hz.statsLabel(null), '');
  assert.strictEqual(hz.statsLabel({ added: 0, removed: 0 }), '');
  assert.strictEqual(hz.statsHint(null), '');
  assert.strictEqual(hz.statsLabel({ added: 2, removed: 1 }), '+2 −1');
});
