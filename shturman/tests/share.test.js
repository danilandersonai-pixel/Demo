'use strict';

// Тесты телефонного режима: ключ доступа, QR-код, экран подключения.
// Главное здесь — «с ключом пускает, без ключа нет», и что без --share
// сервер по-прежнему слушает только петлю.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var http = require('node:http');

var tokenLib = require('../lib/token');
var qr = require('../lib/qr');
var netLib = require('../lib/net');
var server = require('../server');
var argsLib = require('../lib/args');

function phone(extraHeaders, ip) {
  return { socket: { remoteAddress: ip || '192.168.1.77' }, headers: extraHeaders || {} };
}
function localReq(extraHeaders) {
  return { socket: { remoteAddress: '127.0.0.1' }, headers: extraHeaders || {} };
}

// ── Ключ доступа ────────────────────────────────────────────────────────────

test('ключ достаточно длинный и каждый раз новый', function () {
  var a = tokenLib.generate();
  var b = tokenLib.generate();
  assert.strictEqual(a.length, tokenLib.TOKEN_BYTES * 2);
  assert.ok(a.length >= 32, 'короткий ключ подобрали бы перебором');
  assert.notStrictEqual(a, b);
  assert.match(a, /^[0-9a-f]+$/, 'ключ должен без экранирования влезать в адрес');
});

test('без общего доступа охранник пускает всех', function () {
  var g = tokenLib.createGuard({ enabled: false });
  assert.strictEqual(g.check(phone(), {}).allowed, true,
    'сервер и так слушает только петлю — пароль на своей машине не нужен');
  assert.strictEqual(g.token(), null);
});

test('в share-режиме без ключа не пускает', function () {
  var g = tokenLib.createGuard({ enabled: true });
  var v = g.check(phone(), {});
  assert.strictEqual(v.allowed, false);
  assert.match(v.reason, /нет ключа/);
});

test('в share-режиме с верным ключом пускает, с чужим — нет', function () {
  var g = tokenLib.createGuard({ enabled: true });
  assert.strictEqual(g.check(phone(), { t: g.token() }).allowed, true);
  assert.strictEqual(g.check(phone(), { t: 'чужой' }).allowed, false);
  assert.strictEqual(g.check(phone(), { t: g.token() + 'x' }).allowed, false);
  assert.strictEqual(g.check(phone(), { t: '' }).allowed, false);
});

test('ключ принимается из ссылки, из куки и из заголовка', function () {
  var g = tokenLib.createGuard({ enabled: true });
  var t = g.token();
  assert.strictEqual(g.check(phone(), { t: t }).allowed, true, 'из ссылки (пришли по QR)');
  assert.strictEqual(g.check(phone({ cookie: 'shturman_token=' + t })).allowed, true, 'из куки');
  assert.strictEqual(g.check(phone({ 'x-shturman-token': t })).allowed, true, 'из заголовка');
});

test('с самого компьютера ключ не спрашивается даже в share-режиме', function () {
  var g = tokenLib.createGuard({ enabled: true });
  var v = g.check(localReq(), {});
  assert.strictEqual(v.allowed, true);
  assert.strictEqual(v.viaLoopback, true);
});

test('петля распознаётся во всех обличьях', function () {
  ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.1.1']
    .forEach(function (a) { assert.strictEqual(tokenLib.isLoopback(a), true, a); });
  ['192.168.1.5', '10.0.0.1', '', null]
    .forEach(function (a) { assert.strictEqual(tokenLib.isLoopback(a), false, String(a)); });
});

test('сброс ключа обрывает выданные ссылки', function () {
  var g = tokenLib.createGuard({ enabled: true });
  var old = g.token();
  assert.strictEqual(g.check(phone(), { t: old }).allowed, true);

  var fresh = g.rotate();
  assert.notStrictEqual(fresh, old);
  // Список устройств смотрим сразу после сброса: последующие проверки
  // ключа сами зарегистрируют устройство заново.
  assert.deepStrictEqual(g.devices(), [], 'список устройств тоже очищен');
  assert.strictEqual(g.check(phone(), { t: old }).allowed, false, 'старая ссылка обязана перестать работать');
  assert.strictEqual(g.check(phone(), { t: fresh }).allowed, true);
});

test('общий доступ включается и выключается на лету', function () {
  var g = tokenLib.createGuard({ enabled: false });
  assert.strictEqual(g.check(phone(), {}).allowed, true);
  g.setEnabled(true);
  assert.ok(g.token(), 'при включении ключ появился');
  assert.strictEqual(g.check(phone(), {}).allowed, false);
  g.setEnabled(false);
  assert.strictEqual(g.check(phone(), {}).allowed, true);
});

test('сравнение ключей не выдаёт совпадение по времени', function () {
  assert.strictEqual(tokenLib.safeEqual('abc', 'abc'), true);
  assert.strictEqual(tokenLib.safeEqual('abc', 'abd'), false);
  assert.strictEqual(tokenLib.safeEqual('abc', 'abcd'), false, 'разная длина — сразу нет');
  assert.strictEqual(tokenLib.safeEqual('', ''), false, 'пустой ключ не считается верным');
  assert.strictEqual(tokenLib.safeEqual(null, undefined), false);
});

test('куки разбираются, включая экранированные значения', function () {
  var c = tokenLib.parseCookies('a=1; shturman_token=abc%20def; b=2');
  assert.strictEqual(c.shturman_token, 'abc def');
  assert.strictEqual(c.a, '1');
  assert.deepStrictEqual(tokenLib.parseCookies(''), {});
  assert.deepStrictEqual(tokenLib.parseCookies(null), {});
});

test('заголовок куки без Secure, но с SameSite', function () {
  var g = tokenLib.createGuard({ enabled: true });
  var h = g.cookieHeader();
  assert.match(h, /^shturman_token=/);
  assert.match(h, /SameSite=Lax/);
  assert.ok(!/Secure/.test(h), 'панель работает по http — с Secure браузер выбросил бы куку');
  assert.strictEqual(tokenLib.createGuard({ enabled: false }).cookieHeader(), null);
});

test('устройства и отказы считаются', function () {
  var g = tokenLib.createGuard({ enabled: true });
  var t = g.token();
  g.check(phone({ 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605' }), { t: t });
  g.check(phone({ 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605' }), { t: t });
  g.check(phone({}, '192.168.1.99'), {});                       // отказ

  var list = g.devices();
  assert.strictEqual(list.length, 1, 'одно устройство, два обращения');
  assert.strictEqual(list[0].hits, 2);
  assert.strictEqual(list[0].shortAgent, 'iPhone, Safari');
  assert.strictEqual(g.rejectedCount(), 1);
});

test('устройство описывается человеческим языком', function () {
  assert.strictEqual(tokenLib.shortAgent('Mozilla/5.0 (iPhone) AppleWebKit Safari/605'), 'iPhone, Safari');
  assert.strictEqual(tokenLib.shortAgent('Mozilla/5.0 (Linux; Android 14) Chrome/120'), 'Android, Chrome');
  assert.strictEqual(tokenLib.shortAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120'), 'Windows, Chrome');
  assert.strictEqual(tokenLib.shortAgent(''), 'неизвестное устройство');
});

// ── QR-код ──────────────────────────────────────────────────────────────────

test('QR кодирует типичную ссылку и растёт с длиной', function () {
  var short = qr.encode('http://127.0.0.1:4517/');
  assert.strictEqual(short.size, 17 + short.version * 4);
  assert.ok(short.version >= 1 && short.version <= 10);

  var long = qr.encode('http://192.168.100.100:65535/?t=' + 'a'.repeat(32));
  assert.ok(long.version > short.version, 'длинная ссылка требует версии побольше');
});

test('QR: матрица квадратная, только нули и единицы', function () {
  var q = qr.encode('http://192.168.1.42:4517/?t=deadbeefcafebabe0123456789abcdef');
  assert.strictEqual(q.modules.length, q.size);
  q.modules.forEach(function (row) {
    assert.strictEqual(row.length, q.size);
    row.forEach(function (v) { assert.ok(v === 0 || v === 1, 'модуль должен быть 0 или 1'); });
  });
});

test('QR: поисковые узоры на трёх углах', function () {
  var q = qr.encode('http://192.168.1.42:4517/');
  var s = q.size;
  // Центр поискового узора — тёмный квадрат 3x3, вокруг светлое кольцо.
  [[0, 0], [0, s - 7], [s - 7, 0]].forEach(function (p) {
    var r = p[0]; var c = p[1];
    assert.strictEqual(q.modules[r][c], 1, 'внешний угол узора тёмный');
    assert.strictEqual(q.modules[r + 1][c + 1], 0, 'светлое кольцо');
    assert.strictEqual(q.modules[r + 3][c + 3], 1, 'тёмная сердцевина');
  });
  // В четвёртом углу поискового узора быть не должно: проверяем не один
  // модуль (там обычные данные), а отсутствие характерной рамки.
  var corner = q.modules[s - 7].slice(s - 7).join('') + q.modules[s - 1].slice(s - 7).join('');
  assert.notStrictEqual(corner, '11111111111111', 'в правом нижнем углу не должно быть рамки узора');
});

test('QR: обязательный тёмный модуль на месте', function () {
  var q = qr.encode('проверка');
  assert.strictEqual(q.modules[q.size - 8][8], 1);
});

test('QR: результат воспроизводим', function () {
  var a = qr.encode('http://192.168.1.42:4517/?t=abc');
  var b = qr.encode('http://192.168.1.42:4517/?t=abc');
  assert.deepStrictEqual(a.modules, b.modules, 'один вход — один и тот же код');
  assert.strictEqual(a.mask, b.mask);
});

// Эталонный вектор: матрица сверена побитово с пакетом qrcode 1.5.4
// (byte-режим, уровень M). Если генератор сломают — тест это поймает.
test('QR: контрольный вектор совпадает с эталоном', function () {
  var q = qr.encode('http://127.0.0.1:4517/');
  assert.strictEqual(q.version, 2);
  assert.strictEqual(q.size, 25);
  assert.strictEqual(q.mask, 2);
  var expectedRows = [
    '1111111001101010001111111',
    '1000001000111011001000001',
    '1011101010110000001011101',
    '1011101010001100101011101',
    '1011101011001010001011101',
    '1000001010010011101000001',
    '1111111010101010101111111',
    '0000000010000011000000000',
    '1011111000011101101111100'
  ];
  expectedRows.forEach(function (row, i) {
    assert.strictEqual(q.modules[i].join(''), row, 'строка ' + i + ' разошлась с эталоном');
  });
});

test('QR: слишком длинный текст отвергается понятной ошибкой', function () {
  assert.throws(function () { qr.encode('x'.repeat(2000)); }, /Слишком длинный текст/);
});

test('QR: ёмкости растут по версиям', function () {
  var prev = 0;
  for (var v = 1; v <= 10; v++) {
    var cap = qr.capacityBytes(v);
    assert.ok(cap > prev, 'версия ' + v + ': ёмкость должна расти');
    prev = cap;
  }
  // Самой длинной реальной ссылки должно хватать с запасом.
  var real = 'http://192.168.100.100:65535/?t=' + 'f'.repeat(32);
  assert.ok(qr.pickVersion(Buffer.byteLength(real)) > 0, 'реальная ссылка кодируется');
});

test('QR в терминал: псевдографика и поля вокруг', function () {
  var art = qr.toAscii('http://192.168.1.42:4517/?t=abc');
  var lines = art.split('\n');
  assert.ok(lines.length > 8);
  assert.ok(/[█▀▄]/.test(art), 'код нарисован полублоками');
  assert.ok(/^\s+$/.test(lines[0]), 'сверху светлое поле — без него сканер не поймает');
  var width = lines[0].length;
  lines.forEach(function (l) { assert.strictEqual(l.length, width, 'строки одинаковой ширины'); });
});

test('QR в SVG: самодостаточная картинка', function () {
  var svg = qr.toSvg('http://192.168.1.42:4517/?t=abc', { scale: 4 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /shape-rendering="crispEdges"/, 'иначе модули размоются');
  assert.match(svg, /<path d="M/);
  assert.match(svg, /aria-label=/, 'подпись для читалок экрана');
  assert.ok(svg.indexOf('http://www.w3.org/2000/svg') !== -1);
  assert.ok(svg.indexOf('<image') === -1, 'ничего внешнего не подгружается');
});

// ── Экран подключения ───────────────────────────────────────────────────────

var FAKE = {
  wlan0: [{ address: '192.168.1.42', family: 'IPv4', internal: false }],
  docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }]
};

test('экран подключения в share-режиме даёт ссылку с ключом', function () {
  var g = tokenLib.createGuard({ enabled: true });
  var info = server.connectInfo(g, { port: 4517 }, netLib.lanAddresses(FAKE));

  assert.strictEqual(info.enabled, true);
  assert.strictEqual(info.hasNetwork, true);
  assert.strictEqual(info.address, '192.168.1.42', 'выбран не Docker');
  assert.ok(info.url.indexOf(g.token()) !== -1, 'ключ вшит в ссылку');
  assert.match(info.url, /^http:\/\/192\.168\.1\.42:4517\//);
  assert.strictEqual(info.addresses.length, 2, 'запасные адреса тоже показаны');
  assert.ok(info.addresses[1].url, 'у каждого адреса своя готовая ссылка');
});

test('экран подключения без share объясняет, почему закрыто', function () {
  var g = tokenLib.createGuard({ enabled: false });
  var info = server.connectInfo(g, { port: 4517 }, netLib.lanAddresses(FAKE));
  assert.strictEqual(info.enabled, false);
  assert.strictEqual(info.url, null, 'ссылки нет, пока доступ выключен');
  assert.match(info.explain, /только на этом компьютере/);
  assert.match(info.explain, /--share/, 'сказано, как включить');
  assert.match(info.explain, /содержимое ваших файлов/, 'объяснено, почему по умолчанию выключено');
});

test('экран подключения честен, когда сети нет', function () {
  var g = tokenLib.createGuard({ enabled: true });
  var info = server.connectInfo(g, { port: 4517 }, []);
  assert.strictEqual(info.hasNetwork, false);
  assert.strictEqual(info.url, null);
  assert.strictEqual(info.address, null);
});

test('объяснение share-режима повторяет обещание «только читаю»', function () {
  var g = tokenLib.createGuard({ enabled: true });
  var info = server.connectInfo(g, { port: 4517 }, netLib.lanAddresses(FAKE));
  assert.match(info.explain, /только смотрит|только читает/);
  assert.match(info.explain, /ключ/);
});

test('страница отказа и манифест доступны без ключа', function () {
  ['/denied', '/manifest.json', '/sw.js', '/offline.html', '/icons/icon-192.png']
    .forEach(function (p) {
      assert.strictEqual(server.isPublicPath(p), true, p + ' должен открываться без ключа');
    });
  ['/', '/api/state', '/app.js', '/api/tree']
    .forEach(function (p) {
      assert.strictEqual(server.isPublicPath(p), false, p + ' обязан требовать ключ');
    });
});

// ── HTTP целиком ────────────────────────────────────────────────────────────

function get(port, urlPath, headers) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: port, path: urlPath, headers: headers || {} }, function (res) {
      var b = '';
      res.on('data', function (c) { b += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: b, headers: res.headers }); });
    }).on('error', reject);
  });
}

test('сервер без --share слушает только петлю и не требует ключа', async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-off-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  var port = 4741;
  var opts = argsLib.applyConfig(
    argsLib.parse(['--project', dir, '--port', String(port), '--tail-only']), {});
  var registry = server.createRegistry(opts);
  var srv = server.createServer(registry, opts);
  try {
    await registry.startAll();
    await new Promise(function (r) { srv.listen(port, '127.0.0.1', r); });

    assert.strictEqual(srv.address().address, '127.0.0.1', 'наружу не выставились');
    assert.strictEqual(srv.guard.enabled(), false);
    assert.strictEqual((await get(port, '/api/state')).status, 200, 'ключ не спрашивается');
  } finally {
    registry.stopAll();
    await new Promise(function (r) { srv.close(r); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('сервер в share-режиме отдаёт QR и данные подключения', async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-on-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  var port = 4742;
  var opts = argsLib.applyConfig(
    argsLib.parse(['--project', dir, '--port', String(port), '--share', '--tail-only']), {});
  opts.port = port;
  var guard = tokenLib.createGuard({ enabled: true });
  var registry = server.createRegistry(opts);
  var srv = server.createServer(registry, opts, guard);
  try {
    await registry.startAll();
    await new Promise(function (r) { srv.listen(port, '127.0.0.1', r); });

    // С самой машины — как обычно.
    assert.strictEqual((await get(port, '/api/state')).status, 200);

    var conn = JSON.parse((await get(port, '/api/connect')).body);
    assert.strictEqual(conn.enabled, true);
    assert.ok(conn.explain.length > 50);

    // Сброс ключа через API.
    var before = guard.token();
    var rotated = await new Promise(function (resolve) {
      var r = http.request({ host: '127.0.0.1', port: port, path: '/api/connect/rotate', method: 'POST' },
        function (res) {
          var b = '';
          res.on('data', function (c) { b += c; });
          res.on('end', function () { resolve({ status: res.statusCode, body: b }); });
        });
      r.end();
    });
    assert.strictEqual(rotated.status, 200);
    assert.notStrictEqual(guard.token(), before, 'ключ сменился');

    var devices = JSON.parse((await get(port, '/api/connect/devices')).body);
    assert.ok(Array.isArray(devices.devices));
  } finally {
    registry.stopAll();
    await new Promise(function (r) { srv.close(r); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('запрос без ключа с чужого адреса получает отказ на уровне HTTP', async function () {
  // Проверяем саму развилку: охранник считает адрес чужим, и обработчик
  // отдаёт 401 с понятным текстом, а для API — JSON.
  var guard = tokenLib.createGuard({ enabled: true });
  var verdict = guard.check(phone(), {});
  assert.strictEqual(verdict.allowed, false);

  var captured = { code: null, body: '', headers: null };
  var fakeRes = {
    writeHead: function (code, headers) { captured.code = code; captured.headers = headers; },
    end: function (body) { captured.body = String(body); },
    setHeader: function () {}
  };
  // Браузерный путь: человекочитаемая страница.
  require('../server');
  var denied = requireDenied();
  denied(fakeRes, '/', verdict);
  assert.strictEqual(captured.code, 401);
  assert.match(captured.body, /Нужен ключ/);
  assert.match(captured.headers['Content-Type'], /text\/html/);

  // Путь API: машиночитаемый JSON.
  denied(fakeRes, '/api/state', verdict);
  assert.strictEqual(captured.code, 401);
  var parsed = JSON.parse(captured.body);
  assert.match(parsed.error, /ключ доступа/);
  assert.ok(parsed.hint, 'подсказано, что делать');
});

// sendDenied наружу не экспортируется — достаём его через модуль сервера,
// чтобы не расширять публичный интерфейс ради одного теста.
function requireDenied() {
  var src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(src.indexOf('function sendDenied') !== -1, 'функция отказа на месте');
  var sandbox = { module: { exports: {} }, require: require, Buffer: Buffer, console: console };
  var fn = new Function('sendJson', 'escapeHtml', 'Buffer',
    src.slice(src.indexOf('function sendDenied'), src.indexOf('function escapeHtml')) +
    '; return sendDenied;');
  return fn(function (res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }, function (s) { return String(s); }, Buffer);
}
