'use strict';

// Тесты дебаунса. Время управляется вручную — тесты не спят.

var test = require('node:test');
var assert = require('node:assert');
var d = require('../lib/debounce');
var h = require('./helpers');

test('debounce: вызов происходит один раз после паузы', function () {
  var timers = h.fakeTimers();
  var calls = [];
  var fn = d.debounce(function (v) { calls.push(v); }, 200, timers);

  fn('а');
  fn('б');
  fn('в');
  assert.deepStrictEqual(calls, [], 'до истечения паузы ничего не вызвано');

  timers.advance(199);
  assert.deepStrictEqual(calls, [], 'за миллисекунду до срока — ещё тихо');

  timers.advance(1);
  assert.deepStrictEqual(calls, ['в'], 'вызван один раз с последними аргументами');
});

test('debounce: каждое обращение сдвигает срок', function () {
  var timers = h.fakeTimers();
  var calls = 0;
  var fn = d.debounce(function () { calls++; }, 100, timers);

  fn();
  timers.advance(90);
  fn();               // сдвинули
  timers.advance(90);
  assert.strictEqual(calls, 0, 'непрерывное дёрганье откладывает вызов');
  timers.advance(10);
  assert.strictEqual(calls, 1);
});

test('debounce: cancel отменяет отложенный вызов', function () {
  var timers = h.fakeTimers();
  var calls = 0;
  var fn = d.debounce(function () { calls++; }, 100, timers);
  fn();
  assert.strictEqual(fn.pending(), true);
  fn.cancel();
  assert.strictEqual(fn.pending(), false);
  timers.advance(500);
  assert.strictEqual(calls, 0);
});

test('debounce: flush выполняет отложенный вызов немедленно', function () {
  var timers = h.fakeTimers();
  var got = null;
  var fn = d.debounce(function (v) { got = v; }, 1000, timers);
  fn('срочно');
  fn.flush();
  assert.strictEqual(got, 'срочно');
  timers.advance(2000);
  assert.strictEqual(got, 'срочно', 'повторно не вызывается');
});

test('debounce: flush без отложенного вызова ничего не делает', function () {
  var timers = h.fakeTimers();
  var calls = 0;
  var fn = d.debounce(function () { calls++; }, 100, timers);
  fn.flush();
  assert.strictEqual(calls, 0);
});

test('debounceByKey: у каждого ключа свой таймер', function () {
  var timers = h.fakeTimers();
  var calls = [];
  var fn = d.debounceByKey(function (key, payload) { calls.push(key + ':' + payload); }, 100, timers);

  fn('a.js', 1);
  timers.advance(60);
  fn('b.js', 2);      // b пришёл позже — но a не должен из-за этого ждать
  timers.advance(40);
  assert.deepStrictEqual(calls, ['a.js:1'], 'a сработал по своему сроку');
  timers.advance(60);
  assert.deepStrictEqual(calls, ['a.js:1', 'b.js:2']);
});

test('debounceByKey: повторы по одному ключу схлопываются', function () {
  var timers = h.fakeTimers();
  var calls = [];
  var fn = d.debounceByKey(function (key, n) { calls.push(key + n); }, 100, timers);

  // Одно сохранение файла в редакторе даёт 3-5 сырых событий подряд —
  // ровно этот случай мы и склеиваем.
  fn('game.js', 1);
  fn('game.js', 2);
  fn('game.js', 3);
  assert.strictEqual(fn.pendingCount(), 1, 'таймер один на ключ');
  timers.advance(100);
  assert.deepStrictEqual(calls, ['game.js3'], 'осталось последнее значение');
});

test('debounceByKey: cancel по ключу и cancel целиком', function () {
  var timers = h.fakeTimers();
  var calls = [];
  var fn = d.debounceByKey(function (k) { calls.push(k); }, 100, timers);

  fn('a'); fn('b'); fn('c');
  assert.strictEqual(fn.pendingCount(), 3);
  fn.cancel('b');
  assert.strictEqual(fn.pendingCount(), 2);
  timers.advance(100);
  assert.deepStrictEqual(calls.sort(), ['a', 'c']);

  fn('x'); fn('y');
  fn.cancel();
  assert.strictEqual(fn.pendingCount(), 0);
  timers.advance(500);
  assert.deepStrictEqual(calls.sort(), ['a', 'c']);
});

test('debounceByKey: flushAll выполняет всё отложенное', function () {
  var timers = h.fakeTimers();
  var calls = [];
  var fn = d.debounceByKey(function (k, v) { calls.push(k + v); }, 5000, timers);
  fn('a', 1);
  fn('b', 2);
  fn.flushAll();
  assert.deepStrictEqual(calls.sort(), ['a1', 'b2']);
  assert.strictEqual(fn.pendingCount(), 0);
});

test('throttle: первый вызов проходит сразу, лишние схлопываются', function () {
  var timers = h.fakeTimers();
  var calls = [];
  var fn = d.throttle(function (v) { calls.push(v); }, 100, timers);

  fn(1);
  assert.deepStrictEqual(calls, [1], 'первый вызов немедленный');
  fn(2);
  fn(3);
  assert.deepStrictEqual(calls, [1], 'внутри окна вызовов нет');
  timers.advance(100);
  assert.deepStrictEqual(calls, [1, 3], 'хвостом прошёл последний');
});

test('throttle: cancel снимает отложенный хвост', function () {
  var timers = h.fakeTimers();
  var calls = [];
  var fn = d.throttle(function (v) { calls.push(v); }, 100, timers);
  fn(1);
  fn(2);
  fn.cancel();
  timers.advance(500);
  assert.deepStrictEqual(calls, [1]);
});

test('дебаунс с нулевой задержкой всё равно откладывает на тик', function () {
  var timers = h.fakeTimers();
  var calls = 0;
  var fn = d.debounce(function () { calls++; }, 0, timers);
  fn();
  fn();
  assert.strictEqual(calls, 0, 'синхронно не вызывается');
  timers.advance(0);
  assert.strictEqual(calls, 1, 'и всё равно схлопнулось в один вызов');
});
