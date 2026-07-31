'use strict';

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var net = require('node:net');

var configMod = require('../lib/config');
var netinfo = require('../lib/netinfo');
var authMod = require('../lib/auth');
var shortcuts = require('../lib/shortcuts');

/* ---------- конфиг ~/.shturman.json ---------- */

function withTempConfig(fn) {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-cfg-'));
  var file = path.join(tmp, 'cfg.json');
  var prev = process.env.SHTURMAN_CONFIG;
  process.env.SHTURMAN_CONFIG = file;
  try {
    return fn(file);
  } finally {
    if (prev === undefined) delete process.env.SHTURMAN_CONFIG;
    else process.env.SHTURMAN_CONFIG = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('конфиг: нет файла — умолчания, сохранение — создаёт файл', function () {
  withTempConfig(function (file) {
    var cfg = configMod.loadConfig();
    assert.strictEqual(cfg.port, 4517);
    assert.deepStrictEqual(cfg.recentProjects, []);
    cfg.port = 4600;
    assert.strictEqual(configMod.saveConfig(cfg), true);
    assert.ok(fs.existsSync(file), 'файл создан');
    assert.strictEqual(configMod.loadConfig().port, 4600, 'переживает перезапуск');
  });
});

test('конфиг: битый JSON молча заменяется умолчаниями', function () {
  withTempConfig(function (file) {
    fs.writeFileSync(file, '{кривой json!!!');
    var cfg = configMod.loadConfig();
    assert.strictEqual(cfg.port, 4517);
  });
});

test('конфиг: неразумный порт из файла отбрасывается', function () {
  withTempConfig(function (file) {
    fs.writeFileSync(file, JSON.stringify({ port: 999999 }));
    assert.strictEqual(configMod.loadConfig().port, 4517);
  });
});

test('конфиг: последние проекты — свежие в начало, без дублей, максимум 10', function () {
  var cfg = { recentProjects: ['/b', '/c'] };
  configMod.rememberProjects(cfg, ['/a', '/b']);
  assert.deepStrictEqual(cfg.recentProjects, ['/a', '/b', '/c']);
  var many = [];
  for (var i = 0; i < 15; i++) many.push('/p' + i);
  configMod.rememberProjects(cfg, many);
  assert.strictEqual(cfg.recentProjects.length, 10);
});

/* ---------- определение LAN-адресов ---------- */

test('lanAddresses: берёт IPv4 не-internal, домашние сети — вперёд', function () {
  var fake = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
    eth0: [
      { address: 'fe80::1', family: 'IPv6', internal: false },
      { address: '192.168.1.42', family: 'IPv4', internal: false }
    ],
    wg0: [{ address: '10.8.0.2', family: 'IPv4', internal: false }]
  };
  var out = netinfo.lanAddresses(fake);
  assert.deepStrictEqual(out.map(function (a) { return a.address; }),
    ['192.168.1.42', '10.8.0.2', '172.17.0.1'],
    'локальная сеть раньше docker-моста, IPv6 и loopback отброшены');
  assert.strictEqual(out[0].iface, 'eth0');
});

test('lanAddresses: family может быть числом (старые Node)', function () {
  var out = netinfo.lanAddresses({ eth0: [{ address: '192.168.0.5', family: 4, internal: false }] });
  assert.strictEqual(out.length, 1);
});

/* ---------- ссылка для QR ---------- */

test('buildShareUrl: адрес + порт + токен', function () {
  assert.strictEqual(
    netinfo.buildShareUrl('192.168.1.42', 4517, 'abc123'),
    'http://192.168.1.42:4517/?t=abc123');
});

test('buildShareUrl: IPv6 берётся в скобки, токен кодируется', function () {
  var u = netinfo.buildShareUrl('fe80::1', 4517, 'a b');
  assert.strictEqual(u, 'http://[fe80::1]:4517/?t=a%20b');
});

/* ---------- подбор порта ---------- */

test('findFreePort: занят — берёт следующий', function () {
  return new Promise(function (resolve, reject) {
    var blocker = net.createServer();
    blocker.listen(0, '127.0.0.1', function () {
      var busy = blocker.address().port;
      netinfo.findFreePort(busy, '127.0.0.1').then(function (free) {
        blocker.close();
        assert.ok(free > busy, 'порт ' + free + ' > занятого ' + busy);
        resolve();
      }).catch(reject);
    });
  });
});

/* ---------- токен-авторизация ---------- */

function fakeReq(opts) {
  return {
    url: opts.url || '/',
    headers: opts.headers || {},
    socket: { remoteAddress: opts.remote || '192.168.1.7' }
  };
}

test('auth: без share чужие запросы не пускаются, локальные — да', function () {
  var auth = authMod.createAuth(false);
  assert.strictEqual(auth.check(fakeReq({ remote: '192.168.1.7' })).ok, false);
  assert.strictEqual(auth.check(fakeReq({ remote: '127.0.0.1' })).ok, true);
  assert.strictEqual(auth.check(fakeReq({ remote: '::ffff:127.0.0.1' })).ok, true);
});

test('auth (share): с токеном пускает — query, cookie, Bearer', function () {
  var auth = authMod.createAuth(true);
  var t = auth.getToken();
  var byQuery = auth.check(fakeReq({ url: '/?t=' + t }));
  assert.strictEqual(byQuery.ok, true);
  assert.strictEqual(byQuery.viaQueryToken, true, 'подсказка «поставь cookie»');
  assert.strictEqual(auth.check(fakeReq({ headers: { cookie: 'shturman_token=' + t } })).ok, true);
  assert.strictEqual(auth.check(fakeReq({ headers: { authorization: 'Bearer ' + t } })).ok, true);
});

test('auth (share): без токена и с неверным — отказ', function () {
  var auth = authMod.createAuth(true);
  assert.strictEqual(auth.check(fakeReq({})).ok, false);
  assert.strictEqual(auth.check(fakeReq({ url: '/?t=deadbeef' })).ok, false);
  assert.strictEqual(auth.check(fakeReq({ headers: { cookie: 'shturman_token=wrong' } })).ok, false);
});

test('auth: rotate() отзывает старый токен', function () {
  var auth = authMod.createAuth(true);
  var old = auth.getToken();
  auth.rotate();
  assert.strictEqual(auth.check(fakeReq({ url: '/?t=' + old })).ok, false, 'старый больше не работает');
  assert.strictEqual(auth.check(fakeReq({ url: '/?t=' + auth.getToken() })).ok, true);
});

test('auth: хозяин (loopback) в share-режиме проходит без токена', function () {
  var auth = authMod.createAuth(true);
  var r = auth.check(fakeReq({ remote: '127.0.0.1' }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.owner, true);
});

/* ---------- ярлыки ---------- */

test('ярлык .bat: cd в папку ярлыка, путь к server.js, CRLF', function () {
  var c = shortcuts.batContent('C:\\tools\\shturman\\server.js');
  assert.ok(c.indexOf('cd /d "%~dp0"') !== -1, 'переходит в папку ярлыка');
  assert.ok(c.indexOf('node "C:\\tools\\shturman\\server.js" --project "%cd%"') !== -1);
  assert.ok(c.indexOf('chcp 65001') !== -1, 'русский вывод не ломается');
  assert.ok(c.indexOf('\r\n') !== -1, 'Windows-переводы строк');
});

test('ярлык .command: shebang и dirname', function () {
  var c = shortcuts.commandContent('/opt/shturman/server.js');
  assert.strictEqual(c.indexOf('#!/bin/sh'), 0);
  assert.ok(c.indexOf('cd "$(dirname "$0")"') !== -1);
  assert.ok(c.indexOf('node "/opt/shturman/server.js" --project "$(pwd)"') !== -1);
});

test('writeShortcuts: создаёт оба файла, .command исполняемый', function () {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-sc-'));
  var made = shortcuts.writeShortcuts(tmp, '/x/server.js');
  assert.strictEqual(made.length, 2);
  assert.ok(fs.existsSync(path.join(tmp, 'Штурман.bat')));
  var st = fs.statSync(path.join(tmp, 'Штурман.command'));
  if (process.platform !== 'win32') {
    assert.ok(st.mode & 64, 'владелец может исполнять'); // 0o100
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});
