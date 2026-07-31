'use strict';

// Тесты детектора «Клод остановился и ждёт» — ключевой функции панели.
// Время подаётся аргументом, поэтому «искусственное затишье» здесь мгновенное.

var test = require('node:test');
var assert = require('node:assert');
var idle = require('../lib/idle');

var TOOL = { kind: 'tool', action: 'run' };
var RESULT = { kind: 'result', action: 'ok' };
var TEXT = { kind: 'assistant', action: 'say' };

test('до первой активности сигнала нет', function () {
  var d = idle.createDetector({ idleMs: 1000 });
  assert.strictEqual(d.state(), 'idle-unknown');
  assert.strictEqual(d.tick(50000), null, 'молчание до старта — не повод сигналить');
});

test('затишье дольше порога поднимает сигнал ровно один раз', function () {
  var d = idle.createDetector({ idleMs: 1000 });
  d.activity(TEXT, 0);
  assert.strictEqual(d.state(), 'working');

  assert.strictEqual(d.tick(900), null, 'до порога тихо');
  var t = d.tick(1100);
  assert.ok(t, 'сигнал поднят');
  assert.strictEqual(t.type, 'waiting');
  assert.strictEqual(t.quietMs, 1100);
  assert.strictEqual(d.state(), 'waiting');

  assert.strictEqual(d.tick(1300), null, 'повторно не сигналит');
  assert.strictEqual(d.tick(1900), null);
});

test('новая активность снимает ожидание и даёт событие «снова работает»', function () {
  var d = idle.createDetector({ idleMs: 1000 });
  d.activity(TEXT, 0);
  d.tick(1100);
  assert.strictEqual(d.state(), 'waiting');

  var r = d.activity(TOOL, 1200);
  assert.ok(r);
  assert.strictEqual(r.type, 'resumed');
  assert.strictEqual(d.state(), 'working');

  // И сигнал можно поднять заново.
  assert.ok(d.tick(2300));
});

test('незакрытый вызов инструмента помечается как «зависло»', function () {
  var d = idle.createDetector({ idleMs: 1000 });
  d.activity(TOOL, 0);          // инструмент начался…
  assert.strictEqual(d.pendingTools(), 1);
  var t = d.tick(1500);         // …и не закончился
  assert.strictEqual(t.stuck, true, 'это не «ждёт ответа», а зависшая команда');
});

test('закрытый вызов инструмента не считается зависшим', function () {
  var d = idle.createDetector({ idleMs: 1000 });
  d.activity(TOOL, 0);
  d.activity(RESULT, 100);
  assert.strictEqual(d.pendingTools(), 0);
  var t = d.tick(1200);
  assert.strictEqual(t.stuck, false);
});

test('счётчик незакрытых вызовов не уходит в минус', function () {
  var d = idle.createDetector({ idleMs: 1000 });
  d.activity(RESULT, 0);
  d.activity(RESULT, 1);
  assert.strictEqual(d.pendingTools(), 0);
});

test('долгое затишье переводит сессию в состояние «завершена»', function () {
  var d = idle.createDetector({ idleMs: 1000, endedFactor: 3 });
  d.activity(TEXT, 0);
  d.tick(1100);                  // waiting
  assert.strictEqual(d.tick(2000), null, 'ещё рано');
  var e = d.tick(3100);
  assert.ok(e);
  assert.strictEqual(e.type, 'ended');
  assert.strictEqual(d.state(), 'ended');
});

test('после «завершена» активность тоже возобновляет работу', function () {
  var d = idle.createDetector({ idleMs: 1000, endedFactor: 2 });
  d.activity(TEXT, 0);
  d.tick(1100);
  d.tick(2500);
  assert.strictEqual(d.state(), 'ended');
  var r = d.activity(TEXT, 2600);
  assert.strictEqual(r.type, 'resumed');
  assert.strictEqual(d.state(), 'working');
});

test('Stop-хук поднимает сигнал немедленно, не дожидаясь порога', function () {
  var d = idle.createDetector({ idleMs: 60000 });
  d.activity(TEXT, 0);
  var t = d.stopHook(500);
  assert.ok(t);
  assert.strictEqual(t.type, 'waiting');
  assert.strictEqual(t.hook, true);
  assert.strictEqual(d.state(), 'waiting');
  assert.strictEqual(d.stopHook(600), null, 'второй хук подряд молчит');
});

test('порог можно менять на лету, но только в разумных пределах', function () {
  var d = idle.createDetector({ idleMs: 45000 });
  assert.strictEqual(d.setIdleMs(10000), 10000);
  assert.strictEqual(d.idleMs(), 10000);
  assert.strictEqual(d.setIdleMs(100), 10000, 'слишком мало — значение не принято');
  assert.strictEqual(d.setIdleMs(99999999), 10000, 'слишком много — тоже');
  assert.strictEqual(d.setIdleMs('не число'), 10000);
});

test('quietMs показывает длительность текущего затишья', function () {
  var d = idle.createDetector({ idleMs: 1000 });
  assert.strictEqual(d.quietMs(5000), 0, 'без активности затишья нет');
  d.activity(TEXT, 1000);
  assert.strictEqual(d.quietMs(3500), 2500);
});

test('reset возвращает детектор в исходное состояние', function () {
  var d = idle.createDetector({ idleMs: 1000 });
  d.activity(TOOL, 0);
  d.tick(2000);
  d.reset();
  assert.strictEqual(d.state(), 'idle-unknown');
  assert.strictEqual(d.pendingTools(), 0);
  assert.strictEqual(d.tick(999999), null);
});

test('сигнал помнит, чем именно закончилась активность', function () {
  var d = idle.createDetector({ idleMs: 1000 });
  d.activity(TEXT, 0);
  assert.strictEqual(d.tick(1100).lastKind, 'assistant-text',
    'Клод договорил — значит, ждёт ответа');

  var d2 = idle.createDetector({ idleMs: 1000 });
  d2.activity({ kind: 'user' }, 0);
  assert.strictEqual(d2.tick(1100).lastKind, 'user');
});
