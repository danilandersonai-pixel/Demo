'use strict';

// Тесты парсера JSONL-транскриптов — на реальных обезличенных фикстурах.

var test = require('node:test');
var assert = require('node:assert');
var tp = require('../lib/transcript-parse');
var h = require('./helpers');

test('parseLine: битые строки не роняют парсер', function () {
  assert.strictEqual(tp.parseLine('не json'), null);
  assert.strictEqual(tp.parseLine(''), null);
  assert.strictEqual(tp.parseLine('   '), null);
  assert.strictEqual(tp.parseLine('{"неполная": '), null);
  assert.strictEqual(tp.parseLine(null), null);
  assert.strictEqual(tp.parseLine('123'), null, 'скаляр — не запись');
  assert.deepStrictEqual(tp.parseLine('{"type":"user"}'), { type: 'user' });
});

test('parseChunk: недописанная последняя строка возвращается хвостом', function () {
  var a = tp.parseChunk('{"type":"user","uuid":"1"}\n{"type":"asss');
  assert.strictEqual(a.records.length, 1);
  assert.strictEqual(a.rest, '{"type":"asss');

  // Хвост склеивается со следующим куском и разбирается целиком.
  var b = tp.parseChunk(a.rest + 'istant","uuid":"2"}\n');
  assert.strictEqual(b.records.length, 1);
  assert.strictEqual(b.records[0].uuid, '2');
  assert.strictEqual(b.rest, '');
});

test('parseChunk: пустой ввод не даёт записей', function () {
  var r = tp.parseChunk('');
  assert.deepStrictEqual(r.records, []);
  assert.strictEqual(r.rest, '');
});

test('countLines считает строки без хвостового перевода', function () {
  assert.strictEqual(tp.countLines(''), 0);
  assert.strictEqual(tp.countLines(null), 0);
  assert.strictEqual(tp.countLines('одна'), 1);
  assert.strictEqual(tp.countLines('одна\nдве'), 2);
  assert.strictEqual(tp.countLines('одна\nдве\n'), 2);
});

test('describeToolUse: Read отдаёт путь файла', function () {
  var d = tp.describeToolUse('Read', { file_path: '/proj/README.md' });
  assert.strictEqual(d.action, 'read');
  assert.strictEqual(d.file, '/proj/README.md');
});

test('describeToolUse: Bash отдаёт команду и описание', function () {
  var d = tp.describeToolUse('Bash', { command: 'npm test', description: 'Тесты', run_in_background: true });
  assert.strictEqual(d.action, 'run');
  assert.strictEqual(d.command, 'npm test');
  assert.strictEqual(d.background, true);
});

test('describeToolUse: Edit оценивает добавленные и удалённые строки', function () {
  var d = tp.describeToolUse('Edit', { file_path: 'a.js', old_string: 'один\nдва', new_string: 'один\nдва\nтри' });
  assert.strictEqual(d.stats.added, 3);
  assert.strictEqual(d.stats.removed, 2);
  assert.strictEqual(d.stats.approx, true, 'оценка помечена приблизительной');
});

test('describeToolUse: MCP-инструмент попадает в действие mcp', function () {
  assert.strictEqual(tp.actionForTool('mcp__github__list_issues'), 'mcp');
  assert.strictEqual(tp.actionForTool('НеизвестныйИнструмент'), 'tool');
  assert.strictEqual(tp.actionForTool(null), 'tool');
});

test('describeToolUse: TodoWrite считает выполненные пункты', function () {
  var d = tp.describeToolUse('TodoWrite', {
    todos: [
      { content: 'а', status: 'completed' },
      { content: 'б', status: 'in_progress' },
      { content: 'в', status: 'pending' }
    ]
  });
  assert.strictEqual(d.todoCount, 3);
  assert.strictEqual(d.todoDone, 1);
  assert.strictEqual(d.todoActive, 'б');
});

test('patchStats читает точную статистику из structuredPatch', function () {
  var s = tp.patchStats({
    structuredPatch: [{ lines: [' ctx', '+add', '+add', '-del'] }]
  });
  assert.deepStrictEqual(s, { added: 2, removed: 1, approx: false });
  assert.strictEqual(tp.patchStats({}), null);
});

test('looksLikeError: stderr без stdout считается ошибкой', function () {
  assert.strictEqual(tp.looksLikeError({ is_error: true }, null), true);
  assert.strictEqual(tp.looksLikeError({}, { stdout: '', stderr: 'упало' }), true);
  assert.strictEqual(tp.looksLikeError({}, { stdout: 'ок', stderr: 'предупреждение' }), false,
    'предупреждение при живом выводе — не ошибка');
  assert.strictEqual(tp.looksLikeError({}, { interrupted: true }), true);
  assert.strictEqual(tp.looksLikeError({}, { stdout: 'ок', stderr: '' }), false);
});

test('resultText разбирает и строку, и массив блоков', function () {
  assert.strictEqual(tp.resultText({ content: 'текст' }), 'текст');
  assert.strictEqual(
    tp.resultText({ content: [{ type: 'text', text: 'а' }, { type: 'text', text: 'б' }] }),
    'а\nб'
  );
  assert.strictEqual(tp.resultText(null), '');
});

test('токены дедуплицируются по messageId', function () {
  var acc = tp.createTokenAccumulator();
  var usage = { messageId: 'msg_1', input: 10, output: 20, cacheCreate: 5, cacheRead: 100 };
  assert.strictEqual(acc.add(usage), true);
  assert.strictEqual(acc.add(usage), false, 'тот же ответ второй раз не считается');
  acc.add({ messageId: 'msg_2', input: 1, output: 2, cacheCreate: 0, cacheRead: 0 });
  var t = acc.total();
  assert.strictEqual(t.messages, 2);
  assert.strictEqual(t.input, 11);
  assert.strictEqual(t.output, 22);
  assert.strictEqual(t.billableish, 11 + 22 + 5);
  assert.strictEqual(t.cacheRead, 100, 'чтение кеша считается отдельно');
});

test('isNoise отбрасывает служебные записи', function () {
  assert.strictEqual(tp.isNoise({ type: 'attachment' }), true);
  assert.strictEqual(tp.isNoise({ type: 'last-prompt' }), true);
  assert.strictEqual(tp.isNoise({ type: 'summary' }), true);
  assert.strictEqual(tp.isNoise({ type: 'user', isMeta: true }), true);
  assert.strictEqual(tp.isNoise({ type: 'user' }), false);
  assert.strictEqual(tp.isNoise(null), true);
});

// ── Сквозной разбор фикстуры ────────────────────────────────────────────────

test('фикстура session-basic: полный разбор сессии', function () {
  var parser = tp.createParser({ projectRoot: '/home/user/proj' });
  var events = [];
  h.records('session-basic.jsonl').forEach(function (rec) {
    parser.push(rec).forEach(function (e) { events.push(e); });
  });

  var prompts = events.filter(function (e) { return e.kind === 'user'; });
  assert.strictEqual(prompts.length, 1,
    'queue-operation и user несут один промпт — в ленту он идёт один раз');
  assert.match(prompts[0].text, /Почини тесты/);

  var tools = events.filter(function (e) { return e.kind === 'tool'; });
  assert.deepStrictEqual(
    tools.map(function (t) { return t.tool; }),
    ['Read', 'Edit', 'Bash', 'Grep']
  );

  // Пути внутри проекта становятся относительными.
  assert.strictEqual(tools[0].file, 'README.md');
  assert.strictEqual(tools[1].file, 'engine/game.js');

  var results = events.filter(function (e) { return e.kind === 'result'; });
  assert.strictEqual(results.length, 4);
  assert.strictEqual(results.filter(function (r) { return !r.ok; }).length, 1, 'ровно одна ошибка');

  // Правка получила точную статистику из structuredPatch, а не оценку.
  var edit = results[1];
  assert.deepStrictEqual(edit.stats, { added: 2, removed: 1, approx: false });

  var counters = parser.counters();
  assert.strictEqual(counters.edits, 1);
  assert.strictEqual(counters.reads, 1);
  assert.strictEqual(counters.commands, 1);
  assert.strictEqual(counters.errors, 1);
  assert.strictEqual(parser.pendingCount(), 0, 'все вызовы получили результат');

  assert.strictEqual(parser.tokens().messages, 5, 'usage посчитан по разным message.id');
});

test('фикстура session-edge: краевые случаи не ломают разбор', function () {
  var parser = tp.createParser({ projectRoot: '/home/user/proj' });
  var events = [];
  h.records('session-edge.jsonl').forEach(function (rec) {
    parser.push(rec).forEach(function (e) { events.push(e); });
  });

  // Битые строки просто выпали, остальное разобралось.
  var write = events.filter(function (e) { return e.tool === 'Write'; })[0];
  assert.ok(write, 'Write найден');
  assert.strictEqual(write.file, 'новый файл.txt', 'кириллица и пробел в имени');
  assert.strictEqual(write.stats.added, 3);

  var mcp = events.filter(function (e) { return e.action === 'mcp'; })[0];
  assert.ok(mcp, 'MCP-вызов распознан');

  // Осиротевший результат (вызова не было) всё равно даёт событие.
  var orphan = events.filter(function (e) {
    return e.kind === 'result' && e.toolUseId === 't9-неизвестный';
  })[0];
  assert.ok(orphan, 'результат без вызова не теряется');
  assert.strictEqual(orphan.tool, null);
});

test('фикстура session-real-slice: реальная сессия разбирается целиком', function () {
  var parser = tp.createParser({ projectRoot: '/home/user/proj' });
  var events = [];
  var recs = h.records('session-real-slice.jsonl');
  assert.ok(recs.length > 15, 'фикстура непустая');

  recs.forEach(function (rec) {
    assert.doesNotThrow(function () {
      parser.push(rec).forEach(function (e) { events.push(e); });
    });
  });

  assert.ok(events.length > 0, 'события получены');
  events.forEach(function (e) {
    assert.ok(e.kind, 'у каждого события есть kind');
    assert.ok(typeof e.ts === 'number' && e.ts > 0, 'у каждого события есть время');
    assert.strictEqual(e.source, 'transcript');
  });

  var tools = events.filter(function (e) { return e.kind === 'tool'; });
  assert.ok(tools.length > 0, 'вызовы инструментов найдены');
  assert.ok(parser.tokens().messages > 0, 'токены посчитаны');
});

test('фикстура session-windows: пути Windows приводятся к единому виду', function () {
  var parser = tp.createParser({ projectRoot: 'C:\\Users\\Оля\\proj' });
  var events = [];
  h.records('session-windows.jsonl').forEach(function (rec) {
    parser.push(rec).forEach(function (e) { events.push(e); });
  });
  var read = events.filter(function (e) { return e.tool === 'Read'; })[0];
  assert.ok(read);
  // На Linux path.relative не поймёт C:\…, но приведение к прямым слешам
  // должно отработать в любом случае — обратных слешей быть не должно.
  assert.ok(read.file.indexOf('\\') === -1, 'обратных слешей не осталось: ' + read.file);
  assert.match(read.file, /config\.json$/);
});

test('парсер помнит последний текст ассистента', function () {
  var parser = tp.createParser({});
  h.records('session-basic.jsonl').forEach(function (r) { parser.push(r); });
  assert.match(parser.lastAssistantText(), /тесты зелёные/);
});
