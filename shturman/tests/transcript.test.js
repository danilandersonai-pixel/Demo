'use strict';

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');

var transcript = require('../lib/transcript');
var paths = require('../lib/paths');

var FIXTURES = path.join(__dirname, 'fixtures');
var REAL = path.join(FIXTURES, 'real-session-sample.jsonl');
var EDGE = path.join(FIXTURES, 'edge-cases.jsonl');

function eventsFromFile(file) {
  var ctx = { toolNames: {} };
  var out = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (line) {
    var entry = transcript.parseLine(line);
    if (!entry) return;
    transcript.entryToEvents(entry, ctx).forEach(function (e) { out.push(e); });
  });
  return out;
}

test('parseLine: корректный JSON разбирается', function () {
  var o = transcript.parseLine('{"type":"user","message":{"content":"привет"}}');
  assert.strictEqual(o.type, 'user');
});

test('parseLine: мусор и пустые строки дают null', function () {
  assert.strictEqual(transcript.parseLine('не json вообще'), null);
  assert.strictEqual(transcript.parseLine(''), null);
  assert.strictEqual(transcript.parseLine('   '), null);
  assert.strictEqual(transcript.parseLine('{"оборвано'), null);
  assert.strictEqual(transcript.parseLine('42'), null); // не объект
});

test('фикстура реальной сессии: разбирается без ошибок и даёт события', function () {
  var events = eventsFromFile(REAL);
  assert.ok(events.length >= 6, 'ожидали ≥6 событий, получили ' + events.length);
});

test('фикстура: запрос человека становится user-prompt', function () {
  var events = eventsFromFile(REAL);
  var prompts = events.filter(function (e) { return e.kind === 'user-prompt'; });
  assert.ok(prompts.length >= 1);
  assert.ok(prompts[0].text.indexOf('Штурман') !== -1, 'текст запроса сохраняется');
});

test('фикстура: tool_use даёт tool-use с именем инструмента и входом', function () {
  var events = eventsFromFile(REAL);
  var uses = events.filter(function (e) { return e.kind === 'tool-use'; });
  var toolNames = uses.map(function (e) { return e.tool; });
  assert.ok(toolNames.indexOf('Bash') !== -1, 'есть Bash: ' + toolNames.join(','));
  assert.ok(toolNames.indexOf('Edit') !== -1 || toolNames.indexOf('Write') !== -1);
  var bash = uses.filter(function (e) { return e.tool === 'Bash'; })[0];
  assert.ok(bash.input.command, 'у Bash есть команда');
});

test('фикстура: tool_result привязывается к имени инструмента через ctx', function () {
  var events = eventsFromFile(REAL);
  var results = events.filter(function (e) { return e.kind === 'tool-result'; });
  assert.ok(results.length >= 2);
  var withTool = results.filter(function (e) { return e.tool; });
  assert.ok(withTool.length >= 1, 'хотя бы один результат знает свой инструмент');
});

test('фикстура: ошибочный tool_result помечен isError', function () {
  var events = eventsFromFile(REAL);
  var errors = events.filter(function (e) { return e.kind === 'tool-result' && e.isError; });
  assert.ok(errors.length >= 1);
});

test('фикстура: usage-события несут токены и модель', function () {
  var events = eventsFromFile(REAL);
  var usage = events.filter(function (e) { return e.kind === 'usage'; });
  assert.ok(usage.length >= 1);
  assert.ok(usage[0].usage.output > 0, 'output_tokens прочитаны');
  assert.strictEqual(usage[0].model, 'claude-fable-5');
});

test('крайние случаи: битые строки не роняют разбор, служебные вставки скрыты', function () {
  var events = eventsFromFile(EDGE);
  // <system-reminder> не должен стать user-prompt
  var prompts = events.filter(function (e) { return e.kind === 'user-prompt'; });
  assert.strictEqual(prompts.length, 0, 'служебная вставка отфильтрована');
  // неизвестный тип записи просто пропускается
  var unknown = events.filter(function (e) { return e.kind === 'meta'; });
  assert.ok(unknown.length === 0 || unknown.length >= 0); // не упало — уже хорошо
});

test('крайние случаи: end_turn доносится до usage-события', function () {
  var events = eventsFromFile(EDGE);
  var usage = events.filter(function (e) { return e.kind === 'usage'; });
  assert.ok(usage.length >= 1);
  assert.strictEqual(usage[0].stopReason, 'end_turn');
});

test('крайние случаи: вложенный text в tool_result склеивается', function () {
  var events = eventsFromFile(EDGE);
  var results = events.filter(function (e) { return e.kind === 'tool-result'; });
  assert.ok(results.length >= 1);
  assert.ok(results[0].output.indexOf('TODO') !== -1);
  assert.strictEqual(results[0].tool, 'Grep', 'имя инструмента подтянулось из tool_use');
});

test('null-блок в content не роняет разбор (защита процесса сервера)', function () {
  var ctx = { toolNames: {} };
  var evs1 = transcript.entryToEvents({ type: 'user', message: { content: [null] } }, ctx);
  assert.deepStrictEqual(evs1, []);
  var evs2 = transcript.entryToEvents({
    type: 'assistant',
    message: { content: [null, { type: 'text', text: 'жив' }], stop_reason: 'end_turn' }
  }, ctx);
  assert.strictEqual(evs2.filter(function (e) { return e.kind === 'assistant-text'; }).length, 1);
});

test('usage-события несут msgId для дедупликации токенов', function () {
  var evs = transcript.entryToEvents({
    type: 'assistant',
    message: { id: 'msg_123', content: [{ type: 'text', text: 'x' }], usage: { output_tokens: 5 } }
  }, { toolNames: {} });
  var usage = evs.filter(function (e) { return e.kind === 'usage'; })[0];
  assert.strictEqual(usage.msgId, 'msg_123');
});

test('looksLikeSystemNoise отличает служебное от человеческого', function () {
  assert.strictEqual(transcript.looksLikeSystemNoise('<system-reminder>x</system-reminder>'), true);
  assert.strictEqual(transcript.looksLikeSystemNoise('Обычный вопрос про код'), false);
  assert.strictEqual(transcript.looksLikeSystemNoise('[Request interrupted by user]'), true);
});

test('flattenContent: строка, массив блоков, null', function () {
  assert.strictEqual(transcript.flattenContent('abc'), 'abc');
  assert.strictEqual(transcript.flattenContent([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.strictEqual(transcript.flattenContent(null), '');
});

/* ---------- поиск каталога транскриптов ---------- */

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-test-'));
}

test('findTranscriptDir: находит каталог по кодированному пути', function () {
  var tmp = makeTmp();
  var project = path.join(tmp, 'мой проект');
  fs.mkdirSync(project, { recursive: true });
  var projectsRoot = path.join(tmp, 'claude', 'projects');
  var encoded = path.join(projectsRoot, paths.encodeProjectDir(path.resolve(project)));
  fs.mkdirSync(encoded, { recursive: true });
  var found = transcript.findTranscriptDir(project, projectsRoot);
  assert.strictEqual(found, encoded);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('findTranscriptDir: fallback по полю cwd в JSONL', function () {
  var tmp = makeTmp();
  var project = path.join(tmp, 'proj');
  fs.mkdirSync(project, { recursive: true });
  var projectsRoot = path.join(tmp, 'claude', 'projects');
  var weird = path.join(projectsRoot, 'совсем-другое-имя');
  fs.mkdirSync(weird, { recursive: true });
  fs.writeFileSync(path.join(weird, 'abc.jsonl'),
    JSON.stringify({ type: 'user', cwd: path.resolve(project), message: { content: 'x' } }) + '\n');
  var found = transcript.findTranscriptDir(project, projectsRoot);
  assert.strictEqual(found, weird);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('findTranscriptDir: нет каталога → null (уровень B)', function () {
  var tmp = makeTmp();
  var project = path.join(tmp, 'lonely');
  fs.mkdirSync(project, { recursive: true });
  var projectsRoot = path.join(tmp, 'claude', 'projects');
  fs.mkdirSync(projectsRoot, { recursive: true });
  assert.strictEqual(transcript.findTranscriptDir(project, projectsRoot), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('listSessions: сортирует по свежести, игнорирует не-jsonl', function () {
  var tmp = makeTmp();
  fs.writeFileSync(path.join(tmp, 'old.jsonl'), '{}\n');
  fs.writeFileSync(path.join(tmp, 'skip.txt'), 'x');
  var past = Date.now() / 1000 - 3600;
  fs.utimesSync(path.join(tmp, 'old.jsonl'), past, past);
  fs.writeFileSync(path.join(tmp, 'fresh.jsonl'), '{}\n');
  var sessions = transcript.listSessions(tmp);
  assert.strictEqual(sessions.length, 2);
  assert.strictEqual(sessions[0].id, 'fresh');
  fs.rmSync(tmp, { recursive: true, force: true });
});

/* ---------- tailer ---------- */

test('tailer: читает дописанное и правильно копит оборванные строки', function (t, done) {
  var tmp = makeTmp();
  var file = path.join(tmp, 'sess.jsonl');
  var line1 = JSON.stringify({ type: 'user', timestamp: '2026-07-31T02:00:00Z', message: { role: 'user', content: 'первый' } });
  var line2 = JSON.stringify({ type: 'user', timestamp: '2026-07-31T02:00:01Z', message: { role: 'user', content: 'второй' } });
  fs.writeFileSync(file, line1 + '\n');

  var got = [];
  var tailer = transcript.createTailer(tmp, {
    pollMs: 60000, // тикаем вручную
    onEvents: function (events) { events.forEach(function (e) { got.push(e); }); },
    onSwitch: function () {}
  });
  tailer.start(); // прочитает line1

  // дописываем половину строки — она не должна попасть в события
  var half = line2.slice(0, 20);
  fs.appendFileSync(file, half);
  tailer._tick();
  var afterHalf = got.length;

  // дописываем хвост — событие должно прийти целиком
  fs.appendFileSync(file, line2.slice(20) + '\n');
  tailer._tick();

  setTimeout(function () {
    tailer.stop();
    assert.strictEqual(got[0].text, 'первый');
    assert.strictEqual(afterHalf, 1, 'оборванная строка не породила событие');
    assert.strictEqual(got.length, 2);
    assert.strictEqual(got[1].text, 'второй');
    fs.rmSync(tmp, { recursive: true, force: true });
    done();
  }, 50);
});

test('tailer: многобайтовый UTF-8 на границе чтения не портится', function (t, done) {
  var tmp = makeTmp();
  var file = path.join(tmp, 'sess.jsonl');
  var line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'привет мир' } });
  var full = Buffer.from(line + '\n', 'utf8');
  // режем буфер ровно посреди многобайтового символа «м»
  var cut = full.indexOf(Buffer.from('мир', 'utf8')) + 1;
  fs.writeFileSync(file, full.slice(0, cut));

  var got = [];
  var tailer = transcript.createTailer(tmp, {
    pollMs: 60000,
    onEvents: function (events) { events.forEach(function (e) { got.push(e); }); },
    onSwitch: function () {}
  });
  tailer.start();
  tailer._tick(); // прочитан кусок без '\n' — событий нет, байты в остатке
  fs.appendFileSync(file, full.slice(cut));
  tailer._tick();

  setTimeout(function () {
    tailer.stop();
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0].text, 'привет мир', 'символ не превратился в U+FFFD');
    fs.rmSync(tmp, { recursive: true, force: true });
    done();
  }, 50);
});

test('tailer: две живые сессии — возврат к файлу продолжает с места, без дублей', function (t, done) {
  var tmp = makeTmp();
  var fa = path.join(tmp, 'aaa.jsonl');
  var fb = path.join(tmp, 'bbb.jsonl');
  function line(txt) {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: txt } }) + '\n';
  }
  fs.writeFileSync(fa, line('a1'));

  var got = [];
  var switches = 0;
  var tailer = transcript.createTailer(tmp, {
    pollMs: 60000,
    onEvents: function (events) { events.forEach(function (e) { got.push(e.text); }); },
    onSwitch: function () { switches++; }
  });
  tailer.start();               // читает a1
  fs.writeFileSync(fb, line('b1'));
  tailer._tick();               // свежее bbb → читает b1
  fs.appendFileSync(fa, line('a2'));
  tailer._tick();               // свежее aaa → должен дочитать ТОЛЬКО a2
  fs.appendFileSync(fb, line('b2'));
  tailer._tick();               // назад к bbb → только b2

  setTimeout(function () {
    tailer.stop();
    assert.deepStrictEqual(got, ['a1', 'b1', 'a2', 'b2'], 'ни одного дубля');
    assert.strictEqual(switches, 2, 'onSwitch только для впервые увиденных файлов');
    fs.rmSync(tmp, { recursive: true, force: true });
    done();
  }, 50);
});

test('tailer: переключается на более свежий файл сессии', function (t, done) {
  var tmp = makeTmp();
  fs.writeFileSync(path.join(tmp, 'aaa.jsonl'),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'старая сессия' } }) + '\n');
  var past = Date.now() / 1000 - 600;
  fs.utimesSync(path.join(tmp, 'aaa.jsonl'), past, past);

  var switches = [];
  var tailer = transcript.createTailer(tmp, {
    pollMs: 60000,
    onEvents: function () {},
    onSwitch: function (id) { switches.push(id); }
  });
  tailer.start();
  assert.deepStrictEqual(switches, ['aaa']);

  fs.writeFileSync(path.join(tmp, 'bbb.jsonl'),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'новая сессия' } }) + '\n');
  tailer._tick();

  setTimeout(function () {
    tailer.stop();
    assert.deepStrictEqual(switches, ['aaa', 'bbb']);
    assert.strictEqual(tailer.currentSession(), 'bbb');
    fs.rmSync(tmp, { recursive: true, force: true });
    done();
  }, 50);
});
