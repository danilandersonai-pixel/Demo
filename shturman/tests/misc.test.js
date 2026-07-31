'use strict';

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');

var debounce = require('../lib/debounce');
var glossary = require('../lib/glossary');
var filedoc = require('../lib/filedoc');
var tree = require('../lib/tree');
var sse = require('../lib/sse');
var cli = require('../lib/cli');

/* ---------- дебаунс ---------- */

test('дебаунс: копит события и отдаёт одной пачкой после паузы', function (t, done) {
  var batches = [];
  var d = debounce.createDebouncer(30, function (items) { batches.push(items); });
  d.push('a');
  d.push('b');
  d.push('c');
  assert.strictEqual(batches.length, 0, 'до паузы — тишина');
  setTimeout(function () {
    assert.strictEqual(batches.length, 1);
    assert.deepStrictEqual(batches[0], ['a', 'b', 'c']);
    done();
  }, 80);
});

test('дебаунс: новое событие продлевает ожидание', function (t, done) {
  var batches = [];
  var d = debounce.createDebouncer(50, function (items) { batches.push(items); });
  d.push(1);
  setTimeout(function () { d.push(2); }, 30); // до истечения — таймер перезапущен
  setTimeout(function () {
    assert.strictEqual(batches.length, 1, 'одна пачка, не две');
    assert.deepStrictEqual(batches[0], [1, 2]);
    done();
  }, 140);
});

test('дебаунс: flush отдаёт немедленно, cancel — выбрасывает', function () {
  var batches = [];
  var d = debounce.createDebouncer(10000, function (items) { batches.push(items); });
  d.push('x');
  d.flush();
  assert.deepStrictEqual(batches, [['x']]);
  d.push('y');
  d.cancel();
  d.flush();
  assert.strictEqual(batches.length, 1, 'после cancel ничего не приходит');
});

/* ---------- словарь ---------- */

test('словарь: не меньше 25 терминов', function () {
  assert.ok(glossary.TERMS.length >= 25, 'терминов: ' + glossary.TERMS.length);
});

test('словарь: у каждого термина есть объяснение из 1–2 предложений', function () {
  glossary.TERMS.forEach(function (t) {
    assert.ok(t.term && t.term.length >= 2, 'термин не пуст');
    assert.ok(t.def && t.def.length >= 20, 'объяснение не пустое: ' + t.term);
    var sentences = t.def.split(/[.!?]\s/).length;
    assert.ok(sentences <= 3, t.term + ': не больше пары предложений');
  });
});

test('словарь: ключевые термины задания на месте', function () {
  ['коммит', 'ветка', 'репозиторий', 'merge', 'pull', 'push', '.gitignore',
    'зависимость', 'npm', 'localhost', 'порт', 'токены', 'контекст'].forEach(function (needle) {
    assert.ok(glossary.findTerm(needle), 'нет термина: ' + needle);
  });
});

/* ---------- описания файлов ---------- */

test('filedoc: точные имена важнее расширений', function () {
  assert.ok(filedoc.describeFile('package.json').indexOf('аспорт проекта') !== -1);
  assert.ok(filedoc.describeFile('src/package.json').indexOf('аспорт') !== -1, 'работает и с путём');
  assert.ok(filedoc.describeFile('CLAUDE.md').indexOf('Клода') !== -1, 'регистр не мешает');
});

test('filedoc: расширения, включая составные', function () {
  assert.ok(filedoc.describeFile('app.test.js').indexOf('Тесты') !== -1, '.test.js раньше .js');
  assert.ok(filedoc.describeFile('style.css').indexOf('тили') !== -1);
  assert.ok(filedoc.describeFile('data.jsonl').indexOf('строк') !== -1);
});

test('filedoc: незнакомое расширение — честное «пока не знаю»', function () {
  var d = filedoc.describeFile('weird.xyz');
  assert.ok(d.indexOf('не знает') !== -1);
});

/* ---------- дерево ---------- */

test('дерево: строится, игнорирует node_modules, сортирует папки вперёд', function () {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-tree-'));
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.mkdirSync(path.join(tmp, 'node_modules', 'lodash'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'zz.txt'), 'x');
  fs.writeFileSync(path.join(tmp, 'src', 'app.js'), 'var a=1;');
  var root = tree.buildTree(tmp);
  var names = root.children.map(function (c) { return c.name; });
  assert.deepStrictEqual(names, ['src', 'zz.txt'], 'node_modules скрыт, папки вперёд');
  var src = root.children[0];
  assert.strictEqual(src.children[0].path, 'src/app.js');
  assert.ok(src.children[0].size > 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

/* ---------- SSE-хаб ---------- */

function fakeRes() {
  return {
    chunks: [],
    writeHead: function () {},
    write: function (s) { this.chunks.push(s); }
  };
}
function fakeReq(lastEventId) {
  var handlers = {};
  return {
    headers: lastEventId ? { 'last-event-id': String(lastEventId) } : {},
    on: function (ev, fn) { handlers[ev] = fn; },
    _close: function () { if (handlers.close) handlers.close(); }
  };
}

test('SSE: новый клиент получает буфер прошлых событий', function () {
  var hub = sse.createHub();
  hub.broadcast('feed', { n: 1 });
  hub.broadcast('feed', { n: 2 });
  var res = fakeRes();
  hub.attach(fakeReq(), res);
  var joined = res.chunks.join('');
  assert.ok(joined.indexOf('"n":1') !== -1);
  assert.ok(joined.indexOf('"n":2') !== -1);
});

test('SSE: с Last-Event-ID приходит только пропущенное', function () {
  var hub = sse.createHub();
  var id1 = hub.broadcast('feed', { n: 1 });
  hub.broadcast('feed', { n: 2 });
  var res = fakeRes();
  hub.attach(fakeReq(id1), res);
  var joined = res.chunks.join('');
  assert.strictEqual(joined.indexOf('"n":1'), -1, 'старое не дублируется');
  assert.ok(joined.indexOf('"n":2') !== -1);
});

test('SSE: живые клиенты получают новые события, ушедшие — отписываются', function () {
  var hub = sse.createHub();
  var res = fakeRes();
  var req = fakeReq();
  hub.attach(req, res);
  hub.broadcast('git', { branch: 'main' });
  assert.ok(res.chunks.join('').indexOf('main') !== -1);
  assert.strictEqual(hub.clientCount(), 1);
  req._close();
  assert.strictEqual(hub.clientCount(), 0);
});

test('SSE: transient уходит клиентам, но не попадает в буфер', function () {
  var hub = sse.createHub();
  var res = fakeRes();
  hub.attach(fakeReq(), res);
  hub.transient('pulse', { quietMs: 5 });
  assert.ok(res.chunks.join('').indexOf('quietMs') !== -1, 'клиент получил');
  assert.strictEqual(hub.bufferedEvents().length, 0, 'буфер чист');
});

test('SSE: буфер ограничен, старое вытесняется', function () {
  var hub = sse.createHub();
  for (var i = 0; i < sse.BUFFER_SIZE + 50; i++) hub.broadcast('feed', { i: i });
  var buf = hub.bufferedEvents();
  assert.strictEqual(buf.length, sse.BUFFER_SIZE);
  assert.strictEqual(buf[0].data.i, 50, 'самое старое выброшено');
});

/* ---------- разбор аргументов ---------- */

test('cli: значения по умолчанию', function () {
  var a = cli.parseArgs(['node', 'server.js']);
  assert.strictEqual(a.port, 4517);
  assert.strictEqual(a.project, process.cwd());
});

test('cli: --project и --port, включая форму с «=»', function () {
  var a = cli.parseArgs(['node', 'server.js', '--project', '/tmp', '--port=4600']);
  assert.strictEqual(a.project, path.resolve('/tmp'));
  assert.strictEqual(a.port, 4600);
});

test('cli: кривой порт — понятная ошибка, а не молчание', function () {
  var a = cli.parseArgs(['node', 'server.js', '--port', 'abc']);
  assert.ok(a.error && a.error.indexOf('порт') !== -1);
});
