'use strict';

// Включение и выключение общего доступа на лету, без перезапуска.
//
// Проверяем главное: пока доступ выключен, по сети не отвечает НИЧЕГО;
// после включения отвечает — но только по ключу; после выключения снова
// не отвечает. И что управлять этим можно лишь с самого компьютера.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var http = require('node:http');

var server = require('../server');
var argsLib = require('../lib/args');
var tokenLib = require('../lib/token');

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

function req(host, port, urlPath, method, body) {
  return new Promise(function (resolve, reject) {
    var r = http.request({
      host: host, port: port, path: urlPath, method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {}
    }, function (res) {
      var b = '';
      res.on('data', function (c) { b += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: b }); });
    });
    r.on('error', reject);
    r.setTimeout(4000, function () { r.destroy(new Error('таймаут')); });
    r.end(body);
  });
}

function unreachable(host, port, urlPath) {
  return req(host, port, urlPath).then(
    function (r) { return { reached: true, status: r.status }; },
    function (e) { return { reached: false, why: String(e.code || e.message) }; }
  );
}

test('общий доступ включается и выключается без перезапуска',
  { skip: SKIP }, async function () {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-rt-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    var port = 4771;

    // Собираем то же, что собирает main(), но без баннера и браузера.
    var opts = argsLib.applyConfig(
      argsLib.parse(['--project', dir, '--port', String(port), '--tail-only']), {});
    opts.port = port;

    var guard = tokenLib.createGuard({ enabled: false });
    var registry = server.createRegistry(opts);
    var srv = server.createServer(registry, opts, guard);
    var lan = null;

    // Ровно те же две функции, что заводит main().
    // Как в сервере: слушаем конкретный адрес машины, а не 0.0.0.0 —
    // тот включал бы петлю, уже занятую основным слушателем.
    opts.enableShare = function () {
      if (lan) return Promise.resolve({ ok: true });
      return new Promise(function (resolve) {
        var s2 = http.createServer(srv.listeners('request')[0]);
        s2.on('error', function (e) { resolve({ error: e.message }); });
        s2.listen(port, EXTERNAL, function () {
          lan = s2;
          guard.setEnabled(true);
          resolve({ ok: true });
        });
      });
    };
    opts.disableShare = function () {
      guard.setEnabled(false);
      if (!lan) return Promise.resolve({ ok: true });
      return new Promise(function (resolve) {
        var s2 = lan;
        lan = null;
        s2.close(function () { resolve({ ok: true }); });
        if (s2.closeAllConnections) s2.closeAllConnections();
      });
    };

    try {
      await registry.startAll();
      await new Promise(function (r) { srv.listen(port, '127.0.0.1', r); });

      // 1. Пока выключено — по сети недоступно совсем.
      var before = await unreachable(EXTERNAL, port, '/');
      assert.strictEqual(before.reached, false,
        'до включения панель не должна быть видна по сети: ' + JSON.stringify(before));
      assert.strictEqual(guard.enabled(), false);

      // 2. Включаем с самого компьютера.
      var on = await req('127.0.0.1', port, '/api/connect/share', 'POST',
        JSON.stringify({ enabled: true }));
      assert.strictEqual(on.status, 200);
      var info = JSON.parse(on.body);
      assert.strictEqual(info.enabled, true);
      assert.ok(guard.token(), 'ключ появился');

      // 3. Теперь по сети отвечает — но требует ключ.
      var denied = await req(EXTERNAL, port, '/');
      assert.strictEqual(denied.status, 401, 'без ключа по-прежнему нельзя');
      var allowed = await req(EXTERNAL, port, '/?t=' + guard.token());
      assert.strictEqual(allowed.status, 200, 'по ключу — можно');

      // 4. Выключаем — и сеть снова закрыта.
      var off = await req('127.0.0.1', port, '/api/connect/share', 'POST',
        JSON.stringify({ enabled: false }));
      assert.strictEqual(off.status, 200);
      assert.strictEqual(guard.enabled(), false);

      var after = await unreachable(EXTERNAL, port, '/?t=' + (guard.token() || 'x'));
      assert.strictEqual(after.reached, false,
        'после выключения сеть обязана закрыться: ' + JSON.stringify(after));

      // 5. С самого компьютера панель работает всё это время.
      assert.strictEqual((await req('127.0.0.1', port, '/api/state')).status, 200);
    } finally {
      if (lan) await new Promise(function (r) { lan.close(r); });
      registry.stopAll();
      await new Promise(function (r) { srv.close(r); });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test('управлять общим доступом можно только с самого компьютера',
  { skip: SKIP }, async function () {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-rt2-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    var port = 4772;
    var opts = argsLib.applyConfig(
      argsLib.parse(['--project', dir, '--port', String(port), '--share', '--tail-only']), {});
    opts.port = port;
    opts.enableShare = function () { return Promise.resolve({ ok: true }); };
    opts.disableShare = function () { return Promise.resolve({ ok: true }); };

    var guard = tokenLib.createGuard({ enabled: true });
    var registry = server.createRegistry(opts);
    var srv = server.createServer(registry, opts, guard);

    try {
      await registry.startAll();
      await new Promise(function (r) { srv.listen(port, '0.0.0.0', r); });

      // Гость с ключом читает панель, но выключить доступ не может.
      var guest = await req(EXTERNAL, port,
        '/api/connect/share?t=' + guard.token(), 'POST', JSON.stringify({ enabled: false }));
      assert.strictEqual(guest.status, 403,
        'иначе зашедший по ссылке смог бы управлять доступом');
      assert.match(JSON.parse(guest.body).error, /только на самом компьютере/);
      assert.strictEqual(guard.enabled(), true, 'доступ остался включённым');

      // А с самого компьютера — можно.
      var mine = await req('127.0.0.1', port, '/api/connect/share', 'POST',
        JSON.stringify({ enabled: false }));
      assert.strictEqual(mine.status, 200);
    } finally {
      registry.stopAll();
      await new Promise(function (r) { srv.close(r); });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test('без функций переключения сервер честно говорит, что так не умеет', async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-rt3-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  var port = 4773;
  var opts = argsLib.applyConfig(
    argsLib.parse(['--project', dir, '--port', String(port), '--tail-only']), {});
  // enableShare/disableShare не заданы — так бывает, когда сервер поднят
  // тестом или встроен в чужой код.
  var registry = server.createRegistry(opts);
  var srv = server.createServer(registry, opts);

  try {
    await registry.startAll();
    await new Promise(function (r) { srv.listen(port, '127.0.0.1', r); });
    var res = await req('127.0.0.1', port, '/api/connect/share', 'POST',
      JSON.stringify({ enabled: true }));
    assert.strictEqual(res.status, 501);
    assert.match(JSON.parse(res.body).error, /перезапустите Штурман с флагом --share/);
  } finally {
    registry.stopAll();
    await new Promise(function (r) { srv.close(r); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
