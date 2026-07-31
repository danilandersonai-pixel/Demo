'use strict';

var test = require('node:test');
var assert = require('node:assert');
var pulseMod = require('../lib/pulse');

/** Пульс с подконтрольными часами. */
function makePulse(opts) {
  var clock = { t: 1000000 };
  var emitted = [];
  var p = pulseMod.createPulse(function (e) { emitted.push(e); }, {
    now: function () { return clock.t; },
    endTurnMs: opts && opts.endTurnMs || 5000,
    quietMs: opts && opts.quietMs || 90000
  });
  return { p: p, clock: clock, emitted: emitted };
}

test('пульс: считает команды, правки файлов, ошибки и запросы', function () {
  var m = makePulse();
  m.p.feed({ kind: 'user-prompt', text: 'сделай' });
  m.p.feed({ kind: 'tool-use', tool: 'Bash', input: { command: 'npm test' } });
  m.p.feed({ kind: 'tool-use', tool: 'Edit', input: { file_path: '/p/a.js' } });
  m.p.feed({ kind: 'tool-use', tool: 'Write', input: { file_path: '/p/b.js' } });
  m.p.feed({ kind: 'tool-use', tool: 'Read', input: { file_path: '/p/c.js' } }); // чтение — не «затронут»
  m.p.feed({ kind: 'tool-result', isError: true });
  var s = m.p.snapshot();
  assert.strictEqual(s.commandsRun, 1);
  assert.strictEqual(s.toolCalls, 4);
  assert.strictEqual(s.filesTouched, 2);
  assert.strictEqual(s.errorsSeen, 1);
  assert.strictEqual(s.promptsSent, 1);
});

test('пульс: токены по Д-10 — сумма output, контекст по последней записи', function () {
  var m = makePulse();
  m.p.feed({ kind: 'usage', usage: { input: 10, output: 100, cacheRead: 5000, cacheCreate: 100 }, model: 'claude-fable-5' });
  m.p.feed({ kind: 'usage', usage: { input: 20, output: 200, cacheRead: 6000, cacheCreate: 50 } });
  var s = m.p.snapshot();
  assert.strictEqual(s.tokens.approxOutput, 300);          // 100+200
  assert.strictEqual(s.tokens.approxContext, 20 + 6000 + 50); // только последняя запись
  assert.strictEqual(s.tokens.model, 'claude-fable-5');
});

test('детектор: end_turn + 5 секунд тишины → claude-idle (end-turn)', function () {
  var m = makePulse();
  m.p.feed({ kind: 'usage', usage: {}, stopReason: 'end_turn' });
  m.p.check();
  assert.strictEqual(m.emitted.length, 0, 'сразу не сигналим');
  m.clock.t += 6000;
  m.p.check();
  assert.strictEqual(m.emitted.length, 1);
  assert.strictEqual(m.emitted[0].kind, 'claude-idle');
  assert.strictEqual(m.emitted[0].reason, 'end-turn');
});

test('детектор: просто долгая тишина → claude-idle (quiet)', function () {
  var m = makePulse();
  m.p.feed({ kind: 'tool-use', tool: 'Bash', input: {} }); // работа шла
  m.clock.t += 91000;
  m.p.check();
  assert.strictEqual(m.emitted.length, 1);
  assert.strictEqual(m.emitted[0].reason, 'quiet');
});

test('детектор: повторно о той же паузе не сигналит', function () {
  var m = makePulse();
  m.p.feed({ kind: 'usage', usage: {}, stopReason: 'end_turn' });
  m.clock.t += 6000;
  m.p.check();
  m.clock.t += 60000;
  m.p.check();
  m.p.check();
  assert.strictEqual(m.emitted.length, 1, 'один сигнал на одну паузу');
});

test('детектор: новое событие снимает idle и шлёт claude-active', function () {
  var m = makePulse();
  m.p.feed({ kind: 'usage', usage: {}, stopReason: 'end_turn' });
  m.clock.t += 6000;
  m.p.check();
  m.p.feed({ kind: 'tool-use', tool: 'Bash', input: {} });
  assert.strictEqual(m.emitted.length, 2);
  assert.strictEqual(m.emitted[1].kind, 'claude-active');
  var s = m.p.snapshot();
  assert.strictEqual(s.idle, false);
});

test('детектор: пока сессии нет — молчит', function () {
  var m = makePulse();
  m.clock.t += 10000000;
  m.p.check();
  assert.strictEqual(m.emitted.length, 0);
});

test('пульс: длительность сессии берётся из таймстампов транскрипта', function () {
  var m = makePulse();
  var start = m.clock.t - 600000; // события были 10 минут назад
  m.p.feed({ kind: 'user-prompt', text: 'x', ts: new Date(start).toISOString() });
  m.p.feed({ kind: 'tool-use', tool: 'Bash', input: {}, ts: new Date(start + 60000).toISOString() });
  var s = m.p.snapshot();
  // тишина уже 9 минут (> порога) — длительность меряется до последнего
  // события: минута работы, а не «десять минут и растёт»
  assert.strictEqual(s.durationMs, 60000);
  assert.strictEqual(s.quietMs, 540000, 'тишина 9 минут по последнему событию');
});

test('пульс: resetSession обнуляет всё', function () {
  var m = makePulse();
  m.p.feed({ kind: 'tool-use', tool: 'Bash', input: {} });
  m.p.resetSession();
  var s = m.p.snapshot();
  assert.strictEqual(s.commandsRun, 0);
  assert.strictEqual(s.sessionStartMs, null);
});

test('пульс: файлы от вотчера попадают в «затронутые»', function () {
  var m = makePulse();
  m.p.feed({ kind: 'user-prompt', text: 'x' });
  m.p.feedFileChanges(['a.js', 'b.js', 'a.js']);
  assert.strictEqual(m.p.snapshot().filesTouched, 2);
});

test('пульс: записи одного сообщения (msgId) не удваивают output-токены', function () {
  var m = makePulse();
  m.p.feed({ kind: 'usage', usage: { output: 100 }, msgId: 'msg_1' });
  m.p.feed({ kind: 'usage', usage: { output: 100 }, msgId: 'msg_1' }); // та же запись
  m.p.feed({ kind: 'usage', usage: { output: 50 }, msgId: 'msg_2' });
  assert.strictEqual(m.p.snapshot().tokens.approxOutput, 150, '100 + 50, без дубля');
});

test('детектор: новый запрос человека снимает старый end_turn (нет ложного сигнала)', function () {
  var m = makePulse();
  m.p.feed({ kind: 'usage', usage: {}, stopReason: 'end_turn' });
  m.p.feed({ kind: 'user-prompt', text: 'а теперь сделай ещё' });
  m.clock.t += 10000; // Клод «думает» дольше 5 секунд
  m.p.check();
  assert.strictEqual(m.emitted.length, 0, 'сигнала «закончил» нет — идёт новый ход');
});

test('пульс: длительность замолчавшей сессии не растёт бесконечно', function () {
  var m = makePulse();
  var start = m.clock.t;
  m.p.feed({ kind: 'user-prompt', text: 'x', ts: new Date(start).toISOString() });
  m.clock.t = start + 300000; // часы идут вместе с сессией
  m.p.feed({ kind: 'tool-use', tool: 'Bash', input: {}, ts: new Date(start + 300000).toISOString() });
  m.clock.t = start + 8 * 3600000; // «Штурман» открыли через 8 часов
  var s = m.p.snapshot();
  assert.strictEqual(s.durationMs, 300000, '5 минут работы, а не 8 часов');
});

test('пульс: normalizePath склеивает абсолютный и относительный путь одного файла', function () {
  var emitted = [];
  var p = pulseMod.createPulse(function (e) { emitted.push(e); }, {
    now: function () { return 1000; },
    normalizePath: function (f) { return String(f).replace(/^\/proj\//, ''); }
  });
  p.feed({ kind: 'tool-use', tool: 'Edit', input: { file_path: '/proj/lib/a.js' } });
  p.feedFileChanges(['lib/a.js']);
  assert.strictEqual(p.snapshot().filesTouched, 1, 'один файл, а не два');
});
