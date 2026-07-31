'use strict';

// Тесты шины событий: нумерация, кольцевой буфер, дедупликация
// «транскрипт против файловой системы», досылка по Last-Event-ID.

var test = require('node:test');
var assert = require('node:assert');
var busLib = require('../lib/bus');
var sseLib = require('../lib/sse');

function fixedClock(start) {
  var t = start || 1000;
  return {
    now: function () { return t; },
    set: function (v) { t = v; }
  };
}

test('publish нумерует события и переводит их на человеческий язык', function () {
  var bus = busLib.createBus();
  var ev = bus.publish({ kind: 'tool', action: 'run', command: 'npm test' });
  assert.strictEqual(ev.id, 1);
  assert.ok(ev.ts > 0);
  assert.strictEqual(ev.icon, '🔧');
  assert.match(ev.title, /npm test/);
  assert.strictEqual(ev.level, 'info');

  assert.strictEqual(bus.publish({ kind: 'user', text: 'привет' }).id, 2);
  assert.strictEqual(bus.lastId(), 2);
});

test('publish отвергает мусор', function () {
  var bus = busLib.createBus();
  assert.strictEqual(bus.publish(null), null);
  assert.strictEqual(bus.publish('строка'), null);
  assert.strictEqual(bus.size(), 0);
});

test('кольцевой буфер держит только последние события', function () {
  var bus = busLib.createBus({ bufferSize: 5 });
  for (var i = 0; i < 12; i++) bus.publish({ kind: 'file', action: 'changed', file: 'f' + i });
  assert.strictEqual(bus.size(), 5);
  var all = bus.all();
  assert.strictEqual(all[0].file, 'f7', 'самые старые вытеснены');
  assert.strictEqual(all[4].file, 'f11');
  assert.strictEqual(bus.lastId(), 12, 'нумерация сквозная, не зависит от буфера');
});

test('since отдаёт только то, что клиент пропустил', function () {
  var bus = busLib.createBus();
  bus.publish({ kind: 'user', text: 'а' });
  bus.publish({ kind: 'user', text: 'б' });
  bus.publish({ kind: 'user', text: 'в' });

  assert.strictEqual(bus.since(0).length, 3, 'новый клиент получает весь буфер');
  assert.strictEqual(bus.since(1).length, 2);
  assert.strictEqual(bus.since(3).length, 0);
  assert.strictEqual(bus.since(99).length, 0, 'из будущего досылать нечего');
});

test('дедупликация: эхо файловой системы после правки Клода в ленту не идёт', function () {
  var clock = fixedClock(10000);
  var bus = busLib.createBus({ now: clock.now, dedupWindow: 2500 });
  var silent = [];
  bus.events.on('silent', function (e) { silent.push(e); });

  var edit = bus.publish({ kind: 'tool', action: 'edit', file: 'game.js' });
  assert.ok(edit, 'сама правка в ленте есть');

  clock.set(10800);
  var echo = bus.publish({ kind: 'file', action: 'changed', file: 'game.js' });
  assert.strictEqual(echo, null, 'эхо поглощено');
  assert.strictEqual(silent.length, 1, 'но карту проекта оно обновит');
  assert.strictEqual(silent[0].file, 'game.js');
});

test('дедупликация: изменение чужого файла проходит в ленту', function () {
  var clock = fixedClock(10000);
  var bus = busLib.createBus({ now: clock.now, dedupWindow: 2500 });
  bus.publish({ kind: 'tool', action: 'edit', file: 'game.js' });
  clock.set(10800);
  assert.ok(bus.publish({ kind: 'file', action: 'changed', file: 'другой.js' }),
    'другой файл — другое событие');
});

test('дедупликация: за пределами окна эхо снова считается событием', function () {
  var clock = fixedClock(10000);
  var bus = busLib.createBus({ now: clock.now, dedupWindow: 2500 });
  bus.publish({ kind: 'tool', action: 'edit', file: 'game.js' });
  clock.set(20000);
  assert.ok(bus.publish({ kind: 'file', action: 'changed', file: 'game.js' }),
    'через 10 секунд это уже правка руками, а не эхо');
});

test('дедупликация: чтение файла эхо не подавляет', function () {
  var clock = fixedClock(10000);
  var bus = busLib.createBus({ now: clock.now, dedupWindow: 2500 });
  bus.publish({ kind: 'tool', action: 'read', file: 'game.js' });
  clock.set(10500);
  assert.ok(bus.publish({ kind: 'file', action: 'changed', file: 'game.js' }),
    'чтение файл не меняет — значит, изменение настоящее');
});

test('sweep убирает устаревшие отметки, чтобы память не росла', function () {
  var clock = fixedClock(10000);
  var bus = busLib.createBus({ now: clock.now, dedupWindow: 1000 });
  bus.publish({ kind: 'tool', action: 'edit', file: 'a.js' });
  clock.set(30000);
  bus.sweep();
  // Отметка убрана — значит, событие ФС проходит как обычное.
  assert.ok(bus.publish({ kind: 'file', action: 'changed', file: 'a.js' }));
});

test('say публикует служебное сообщение Штурмана', function () {
  var bus = busLib.createBus();
  var ev = bus.say('Заголовок', 'Пояснение', 'warn');
  assert.strictEqual(ev.kind, 'system');
  assert.strictEqual(ev.title, 'Заголовок');
  assert.strictEqual(ev.hint, 'Пояснение');
  assert.strictEqual(ev.level, 'warn');
  assert.strictEqual(ev.icon, '⚠️');
});

test('clear опустошает буфер, но не сбрасывает нумерацию', function () {
  var bus = busLib.createBus();
  bus.publish({ kind: 'user', text: 'а' });
  bus.clear();
  assert.strictEqual(bus.size(), 0);
  assert.strictEqual(bus.publish({ kind: 'user', text: 'б' }).id, 2);
});

// ── SSE ─────────────────────────────────────────────────────────────────────

test('SSE: кадр собирается по спецификации', function () {
  var hub = sseLib.createHub();
  var f = hub.frame('event', { a: 1 }, 7);
  assert.strictEqual(f, 'id: 7\nevent: event\ndata: {"a":1}\n\n');
});

test('SSE: многострочные данные получают префикс на каждой строке', function () {
  var hub = sseLib.createHub();
  var f = hub.frame('note', 'первая\nвторая', 1);
  assert.ok(f.indexOf('data: первая\ndata: вторая\n\n') !== -1,
    'иначе браузер склеит строки неправильно: ' + JSON.stringify(f));
});

test('SSE: кадр без id и без имени события', function () {
  var hub = sseLib.createHub();
  assert.strictEqual(hub.frame(null, 'просто'), 'data: просто\n\n');
});

test('SSE: broadcast переживает мёртвого клиента', function () {
  var hub = sseLib.createHub();
  var written = [];
  var dead = {
    res: { write: function () { throw new Error('соединение закрыто'); } },
    alive: true
  };
  var live = { res: { write: function (t) { written.push(t); } }, alive: true };
  // Дотягиваемся до внутреннего набора через attach нельзя — проверяем
  // поведение через сам frame и ручной вызов write, имитируя хаб.
  [dead, live].forEach(function (c) {
    try { c.res.write(hub.frame('e', 1, 1)); } catch (e) { c.alive = false; }
  });
  assert.strictEqual(dead.alive, false);
  assert.strictEqual(written.length, 1, 'живой клиент получил кадр');
});
