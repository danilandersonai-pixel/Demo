'use strict';

// Сквозная проверка телефонного режима по НАСТОЯЩЕЙ сети.
//
// Предыдущий файл проверяет охранника напрямую; здесь запросы идут через
// сокет на не-петлевой адрес машины — ровно так, как придёт телефон.
// Если у машины нет ни одного внешнего интерфейса, тесты пропускаются.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var http = require('node:http');

var server = require('../server');
var argsLib = require('../lib/args');
var tokenLib = require('../lib/token');
var qr = require('../lib/qr');
var netLib = require('../lib/net');

// Любой не-петлевой IPv4 — даже если он не из частных диапазонов: нам важен
// сам факт, что соединение придёт «не с этого компьютера».
function externalAddress() {
  var ifaces = os.networkInterfaces();
  var found = null;
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (i) {
      if (found || i.internal) return;
      if (i.family !== 'IPv4' && i.family !== 4) return;
      found = i.address;
    });
  });
  return found;
}

var EXTERNAL = externalAddress();
var SKIP = EXTERNAL ? false : 'у машины нет внешнего сетевого интерфейса';

function request(host, port, urlPath, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.get({
      host: host, port: port, path: urlPath, headers: headers || {}
    }, function (res) {
      var b = '';
      res.on('data', function (c) { b += c; });
      res.on('end', function () {
        resolve({ status: res.statusCode, body: b, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, function () { req.destroy(new Error('таймаут')); });
  });
}

function makeProject() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-net-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"проба"}\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log(1)\n');
  return dir;
}

test('телефонный режим: с ключом пускает, без ключа нет — по настоящей сети',
  { skip: SKIP }, async function () {
    var dir = makeProject();
    var port = 4751;
    var opts = argsLib.applyConfig(
      argsLib.parse(['--project', dir, '--port', String(port), '--share', '--tail-only']), {});
    opts.port = port;

    var guard = tokenLib.createGuard({ enabled: true });
    var registry = server.createRegistry(opts);
    var srv = server.createServer(registry, opts, guard);

    try {
      await registry.startAll();
      // Слушаем все интерфейсы — как это делает --share.
      await new Promise(function (r) { srv.listen(port, '0.0.0.0', r); });
      assert.strictEqual(srv.address().address, '0.0.0.0');

      var token = guard.token();

      // 1. Чужое устройство без ключа — отказ и понятная страница.
      var denied = await request(EXTERNAL, port, '/');
      assert.strictEqual(denied.status, 401, 'без ключа панель открываться не должна');
      assert.match(denied.body, /Нужен ключ доступа/);
      assert.match(denied.headers['content-type'], /text\/html/);

      // 2. Чужое устройство без ключа на API — JSON, а не страница.
      var deniedApi = await request(EXTERNAL, port, '/api/state');
      assert.strictEqual(deniedApi.status, 401);
      var parsed = JSON.parse(deniedApi.body);
      assert.match(parsed.error, /ключ доступа/);

      // 3. С чужим ключом — тоже отказ.
      var wrong = await request(EXTERNAL, port, '/?t=' + 'f'.repeat(32));
      assert.strictEqual(wrong.status, 401);

      // 4. С верным ключом — панель открывается и ставит куку.
      var ok = await request(EXTERNAL, port, '/?t=' + token);
      assert.strictEqual(ok.status, 200, 'по ссылке из QR панель обязана открыться');
      assert.match(ok.body, /Штурман/);
      assert.ok(ok.headers['set-cookie'], 'ключ кладётся в куку, чтобы не таскать его в адресе');
      assert.match(String(ok.headers['set-cookie']), /shturman_token=/);

      // 5. Второй заход — уже по куке, без ключа в адресе.
      var byCookie = await request(EXTERNAL, port, '/api/state', {
        Cookie: 'shturman_token=' + token
      });
      assert.strictEqual(byCookie.status, 200);
      var state = JSON.parse(byCookie.body);
      assert.ok(state.state.project, 'данные приходят полностью');

      // 6. С этой же машины (петля) ключ не нужен.
      var loop = await request('127.0.0.1', port, '/api/state');
      assert.strictEqual(loop.status, 200);

      // 7. После сброса ключа старая ссылка перестаёт работать.
      guard.rotate();
      var stale = await request(EXTERNAL, port, '/?t=' + token);
      assert.strictEqual(stale.status, 401, 'отозванный доступ обязан закрыться');
      var fresh = await request(EXTERNAL, port, '/?t=' + guard.token());
      assert.strictEqual(fresh.status, 200);
    } finally {
      registry.stopAll();
      await new Promise(function (r) { srv.close(r); });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test('без --share сервер недоступен по сети совсем', { skip: SKIP }, async function () {
  var dir = makeProject();
  var port = 4752;
  var opts = argsLib.applyConfig(
    argsLib.parse(['--project', dir, '--port', String(port), '--tail-only']), {});
  var registry = server.createRegistry(opts);
  var srv = server.createServer(registry, opts);

  try {
    await registry.startAll();
    await new Promise(function (r) { srv.listen(port, '127.0.0.1', r); });

    // С петли — работает.
    assert.strictEqual((await request('127.0.0.1', port, '/api/state')).status, 200);

    // По внешнему адресу — соединение вообще не устанавливается.
    var failed = null;
    try {
      await request(EXTERNAL, port, '/');
    } catch (e) {
      failed = e;
    }
    assert.ok(failed, 'без --share панель не должна быть видна по сети вообще');
    assert.match(String(failed.code || failed.message), /ECONNREFUSED|таймаут|EHOSTUNREACH/);
  } finally {
    registry.stopAll();
    await new Promise(function (r) { srv.close(r); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('страница отказа и оболочка PWA доступны без ключа', { skip: SKIP }, async function () {
  var dir = makeProject();
  var port = 4753;
  var opts = argsLib.applyConfig(
    argsLib.parse(['--project', dir, '--port', String(port), '--share', '--tail-only']), {});
  opts.port = port;
  var guard = tokenLib.createGuard({ enabled: true });
  var registry = server.createRegistry(opts);
  var srv = server.createServer(registry, opts, guard);

  try {
    await registry.startAll();
    await new Promise(function (r) { srv.listen(port, '0.0.0.0', r); });

    // Манифест и офлайн-страница нужны браузеру ДО того, как он получит ключ,
    // иначе установленное приложение покажет белый экран.
    var manifest = await request(EXTERNAL, port, '/manifest.json');
    assert.strictEqual(manifest.status, 200);
    assert.match(JSON.parse(manifest.body).name, /Штурман/);

    var offline = await request(EXTERNAL, port, '/offline.html');
    assert.strictEqual(offline.status, 200);
    assert.match(offline.body, /Сервер Штурмана не запущен/);

    var sw = await request(EXTERNAL, port, '/sw.js');
    assert.strictEqual(sw.status, 200);

    var icon = await request(EXTERNAL, port, '/icons/icon-192.png');
    assert.strictEqual(icon.status, 200);
    assert.strictEqual(icon.headers['content-type'], 'image/png');

    // А вот сама панель и данные — только по ключу.
    assert.strictEqual((await request(EXTERNAL, port, '/')).status, 401);
    assert.strictEqual((await request(EXTERNAL, port, '/api/tree')).status, 401);
    assert.strictEqual((await request(EXTERNAL, port, '/app.js')).status, 401);
  } finally {
    registry.stopAll();
    await new Promise(function (r) { srv.close(r); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('QR-код ведёт на работающий адрес', { skip: SKIP }, async function () {
  var dir = makeProject();
  var port = 4754;
  var opts = argsLib.applyConfig(
    argsLib.parse(['--project', dir, '--port', String(port), '--share', '--tail-only']), {});
  opts.port = port;
  var guard = tokenLib.createGuard({ enabled: true });
  var registry = server.createRegistry(opts);
  var srv = server.createServer(registry, opts, guard);

  try {
    await registry.startAll();
    await new Promise(function (r) { srv.listen(port, '0.0.0.0', r); });

    // Собираем ту же ссылку, что попадёт в QR, и ходим по ней.
    var url = netLib.buildUrl(EXTERNAL, port, guard.token());
    assert.ok(qr.encode(url).size > 0, 'ссылка кодируется в QR');

    var parsedUrl = new URL(url);
    var res = await request(parsedUrl.hostname, Number(parsedUrl.port),
      parsedUrl.pathname + parsedUrl.search);
    assert.strictEqual(res.status, 200, 'адрес из QR обязан открываться');
    assert.match(res.body, /Штурман/);

    // И тот же адрес без ключа — закрыт.
    assert.strictEqual((await request(parsedUrl.hostname, Number(parsedUrl.port), '/')).status, 401);
  } finally {
    registry.stopAll();
    await new Promise(function (r) { srv.close(r); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('в share-режиме наблюдаемый проект по-прежнему не меняется', { skip: SKIP }, async function () {
  var dir = makeProject();
  var port = 4755;
  var opts = argsLib.applyConfig(
    argsLib.parse(['--project', dir, '--port', String(port), '--share', '--tail-only']), {});
  opts.port = port;
  var guard = tokenLib.createGuard({ enabled: true });
  var registry = server.createRegistry(opts);
  var srv = server.createServer(registry, opts, guard);

  function listing(d, rel) {
    var out = [];
    fs.readdirSync(d, { withFileTypes: true }).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    }).forEach(function (e) {
      var p = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { out.push('d ' + p); out = out.concat(listing(path.join(d, e.name), p)); }
      else out.push('f ' + p + ' ' + fs.statSync(path.join(d, e.name)).size);
    });
    return out;
  }

  try {
    var before = listing(dir, '').join('\n');
    await registry.startAll();
    await new Promise(function (r) { srv.listen(port, '0.0.0.0', r); });
    var t = guard.token();

    // Дёргаем всё, что умеет ходить в проект, с «телефона».
    for (var p of ['/api/tree', '/api/git', '/api/state', '/api/digest',
      '/api/file?path=package.json', '/api/connect']) {
      var sep = p.indexOf('?') === -1 ? '?' : '&';
      await request(EXTERNAL, port, p + sep + 't=' + t);
    }
    await new Promise(function (r) { setTimeout(r, 700); });

    assert.strictEqual(listing(dir, '').join('\n'), before,
      'ни одного изменения в наблюдаемом проекте');
  } finally {
    registry.stopAll();
    await new Promise(function (r) { srv.close(r); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
