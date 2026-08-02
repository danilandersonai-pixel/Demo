'use strict';

// Тесты оболочки запуска: конфиг, свободный порт, адреса в локальной сети,
// ярлыки под ОС, баннер.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var net = require('node:net');

var configLib = require('../lib/config');
var netLib = require('../lib/net');
var shortcuts = require('../lib/shortcuts');
var banner = require('../lib/banner');
var argsLib = require('../lib/args');

function tmpdir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function rm(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* нет */ } }

// ── Конфиг ──────────────────────────────────────────────────────────────────

test('конфиг: без файла отдаются умолчания, а не ошибка', function () {
  var dir = tmpdir('cfg-none-');
  try {
    var r = configLib.load(dir);
    assert.strictEqual(r.existed, false, 'первый запуск — файла и не должно быть');
    assert.strictEqual(r.config.port, 4517);
    assert.strictEqual(r.config.theme, 'auto');
    assert.deepStrictEqual(r.config.recent, []);
  } finally { rm(dir); }
});

test('конфиг: сохраняется и переживает перезапуск', function () {
  var dir = tmpdir('cfg-rt-');
  try {
    var cfg = configLib.load(dir).config;
    cfg.port = 5123;
    cfg.theme = 'light';
    cfg.sound = false;
    cfg.idleSeconds = 90;
    var saved = configLib.save(cfg, dir);
    assert.strictEqual(saved.ok, true);
    assert.ok(fs.existsSync(path.join(dir, '.shturman.json')));

    var again = configLib.load(dir);
    assert.strictEqual(again.existed, true);
    assert.strictEqual(again.config.port, 5123);
    assert.strictEqual(again.config.theme, 'light');
    assert.strictEqual(again.config.sound, false);
    assert.strictEqual(again.config.idleSeconds, 90);
  } finally { rm(dir); }
});

test('конфиг: испорченный файл не роняет запуск', function () {
  var dir = tmpdir('cfg-bad-');
  try {
    fs.writeFileSync(path.join(dir, '.shturman.json'), '{ это не json ');
    var r = configLib.load(dir);
    assert.strictEqual(r.config.port, 4517, 'откатились на умолчания');
    assert.strictEqual(r.existed, false);
  } finally { rm(dir); }
});

test('конфиг: чужие и невалидные значения отбрасываются', function () {
  var dir = tmpdir('cfg-junk-');
  try {
    fs.writeFileSync(path.join(dir, '.shturman.json'), JSON.stringify({
      port: 999999,                 // вне диапазона
      theme: 'радуга',              // нет такой
      sound: 'да',                  // не булево
      idleSeconds: 2,               // слишком мало
      recent: 'не массив',
      посторонний: 'ключ'
    }));
    var c = configLib.load(dir).config;
    assert.strictEqual(c.port, 4517);
    assert.strictEqual(c.theme, 'auto');
    assert.strictEqual(c.sound, false, 'умолчание — молчать, пока не попросили');
    assert.strictEqual(c.idleSeconds, 45);
    assert.deepStrictEqual(c.recent, []);
    assert.strictEqual(c.посторонний, undefined, 'лишние ключи не протекают');
  } finally { rm(dir); }
});

test('конфиг: последние проекты не дублируются и всплывают наверх', function () {
  var cfg = Object.assign({}, configLib.DEFAULTS, { recent: [] });
  configLib.rememberProject(cfg, '/tmp/один', 4517, 1000);
  configLib.rememberProject(cfg, '/tmp/два', 4518, 2000);
  configLib.rememberProject(cfg, '/tmp/один', 4519, 3000);

  assert.strictEqual(cfg.recent.length, 2, 'повтор не создал третью запись');
  assert.strictEqual(path.basename(cfg.recent[0].path), 'один', 'последний открытый — сверху');
  assert.strictEqual(cfg.recent[0].port, 4519, 'порт обновился');
  assert.strictEqual(cfg.recent[0].lastOpened, 3000);
});

test('конфиг: список последних ограничен сверху', function () {
  var cfg = Object.assign({}, configLib.DEFAULTS, { recent: [] });
  for (var i = 0; i < 25; i++) configLib.rememberProject(cfg, '/tmp/п' + i, 4517, i);
  assert.strictEqual(cfg.recent.length, configLib.MAX_RECENT);
});

test('конфиг: исчезнувшие папки вычищаются из списка', function () {
  var dir = tmpdir('cfg-prune-');
  try {
    var cfg = Object.assign({}, configLib.DEFAULTS, { recent: [] });
    configLib.rememberProject(cfg, dir, 4517, 1);
    configLib.rememberProject(cfg, path.join(dir, 'нет-такой'), 4517, 2);
    configLib.pruneMissing(cfg);
    assert.strictEqual(cfg.recent.length, 1);
    assert.strictEqual(cfg.recent[0].path, path.resolve(dir));
  } finally { rm(dir); }
});

test('конфиг: запись в недоступную папку не роняет, а сообщает', function () {
  var r = configLib.save(configLib.DEFAULTS, '/такой/папки/точно/нет');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error, 'причина названа');
});

test('конфиг лежит в домашнем каталоге, а не в проекте пользователя', function () {
  var p = configLib.configPath();
  assert.strictEqual(path.dirname(p), os.homedir(),
    'иначе Штурман нарушил бы обещание ничего не писать в наблюдаемую папку');
});

// ── Флаги + конфиг ──────────────────────────────────────────────────────────

test('флаг сильнее конфига, конфиг сильнее умолчания', function () {
  var cfg = { port: 6000, share: true, openBrowser: false, idleSeconds: 90 };

  var fromCfg = argsLib.applyConfig(argsLib.parse([]), cfg);
  assert.strictEqual(fromCfg.port, 6000, 'порт взят из конфига');
  assert.strictEqual(fromCfg.share, true);
  assert.strictEqual(fromCfg.open, false);
  assert.strictEqual(fromCfg.idle, 90);

  var fromFlag = argsLib.applyConfig(argsLib.parse(['--port', '7000', '--idle', '30']), cfg);
  assert.strictEqual(fromFlag.port, 7000, 'флаг перебил конфиг');
  assert.strictEqual(fromFlag.idle, 30);
});

test('браузер открывается по умолчанию и выключается флагом', function () {
  assert.strictEqual(argsLib.applyConfig(argsLib.parse([]), {}).open, true,
    'новичок не должен копировать адрес руками');
  assert.strictEqual(argsLib.applyConfig(argsLib.parse(['--no-open']), {}).open, false);
  assert.strictEqual(argsLib.applyConfig(argsLib.parse([]), { openBrowser: false }).open, false);
});

test('новые флаги разбираются', function () {
  var a = argsLib.parse(['--share', '--app', '--tui', '--install-shortcuts']);
  assert.strictEqual(a.share, true);
  assert.strictEqual(a.app, true);
  assert.strictEqual(a.open, true, '--app подразумевает открытие окна');
  assert.strictEqual(a.tui, true);
  assert.strictEqual(a.installShortcuts, true);
});

// ── Порт ────────────────────────────────────────────────────────────────────

test('свободный порт находится и занятый пропускается', async function () {
  var blocker = net.createServer();
  await new Promise(function (r) { blocker.listen(4733, '127.0.0.1', r); });
  try {
    var found = await netLib.findFreePort(4733, '127.0.0.1');
    assert.notStrictEqual(found.port, 4733, 'занятый порт не выбран');
    assert.strictEqual(found.shifted, true);
    assert.ok(found.port > 4733, 'следующий по порядку, а не случайный');
    assert.strictEqual(await netLib.isFree(4733, '127.0.0.1'), false);
    assert.strictEqual(await netLib.isFree(found.port, '127.0.0.1'), true);
  } finally {
    await new Promise(function (r) { blocker.close(r); });
  }
});

test('свободный порт берётся как есть, если он свободен', async function () {
  var found = await netLib.findFreePort(4739, '127.0.0.1');
  assert.strictEqual(found.port, 4739);
  assert.strictEqual(found.shifted, false);
});

// ── Адреса в локальной сети ─────────────────────────────────────────────────

// Выдуманный набор интерфейсов: Wi-Fi, кабель, Docker, VPN, петля и IPv6.
var FAKE_IFACES = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  'wlp3s0': [{ address: '192.168.1.42', family: 'IPv4', internal: false }],
  'enp0s31f6': [{ address: '10.0.0.15', family: 'IPv4', internal: false }],
  'docker0': [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
  'tun0': [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
  'wlp3s0v6': [{ address: 'fe80::1', family: 'IPv6', internal: false }],
  'ppp0': [{ address: '203.0.113.7', family: 'IPv4', internal: false }]
};

test('LAN: петля, IPv6 и публичные адреса отсеиваются', function () {
  var list = netLib.lanAddresses(FAKE_IFACES);
  var addrs = list.map(function (a) { return a.address; });
  assert.ok(addrs.indexOf('127.0.0.1') === -1, 'петля не нужна для телефона');
  assert.ok(addrs.indexOf('fe80::1') === -1, 'IPv6 в QR-код не годится');
  assert.ok(addrs.indexOf('203.0.113.7') === -1, 'публичный адрес не наш случай');
  assert.strictEqual(list.length, 4);
});

test('LAN: Wi-Fi идёт первым, виртуальные адаптеры — последними', function () {
  var list = netLib.lanAddresses(FAKE_IFACES);
  assert.strictEqual(list[0].address, '192.168.1.42', 'Wi-Fi первым: телефон почти всегда в нём');
  assert.strictEqual(list[0].kind, 'wifi');
  assert.strictEqual(list[1].address, '10.0.0.15');
  assert.strictEqual(list[1].kind, 'wired');
  assert.strictEqual(list[list.length - 1].kind, 'virtual');
});

test('LAN: у каждого адреса человеческая подпись', function () {
  netLib.lanAddresses(FAKE_IFACES).forEach(function (a) {
    assert.ok(a.label && a.label.length > 2, a.address + ': подпись пустая');
    assert.ok(/[а-яА-Я]/.test(a.label) || /Wi-Fi/.test(a.label), a.address + ': подпись не по-русски');
  });
  var virt = netLib.lanAddresses(FAKE_IFACES).filter(function (a) { return a.kind === 'virtual'; })[0];
  assert.match(virt.label, /телефон сюда/, 'про виртуальный адаптер сказано прямо');
});

test('LAN: лучший адрес — не виртуальный', function () {
  assert.strictEqual(netLib.bestAddress(FAKE_IFACES).address, '192.168.1.42');
  // Если реальных нет — берём хоть что-то, но честно.
  var onlyDocker = { docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }] };
  assert.strictEqual(netLib.bestAddress(onlyDocker).address, '172.17.0.1');
  assert.strictEqual(netLib.bestAddress({}), null, 'сети нет — и не выдумываем');
});

test('LAN: частные диапазоны распознаются', function () {
  ['10.0.0.1', '172.16.5.5', '172.31.0.1', '192.168.0.1', '169.254.1.1']
    .forEach(function (ip) { assert.strictEqual(netLib.isPrivate(ip), true, ip); });
  ['8.8.8.8', '172.32.0.1', '203.0.113.1', 'не ip', '1.2.3']
    .forEach(function (ip) { assert.strictEqual(netLib.isPrivate(ip), false, ip); });
});

test('ссылка для QR собирается с ключом и без', function () {
  assert.strictEqual(netLib.buildUrl('192.168.1.42', 4517, 'abc123'),
    'http://192.168.1.42:4517/?t=abc123');
  assert.strictEqual(netLib.buildUrl('192.168.1.42', 4517, null),
    'http://192.168.1.42:4517/');
  // Ключ обязан быть безопасным для адреса.
  assert.ok(netLib.buildUrl('10.0.0.1', 80, 'a b&c').indexOf('a%20b%26c') !== -1);
});

// ── Ярлыки ──────────────────────────────────────────────────────────────────

test('ярлык Windows: UTF-8, CRLF и проверка Node', function () {
  var s = shortcuts.windowsScript({ serverPath: 'C:/шт/server.js' });
  assert.match(s, /^@echo off/);
  assert.match(s, /chcp 65001/, 'без этого русский текст в cmd превращается в мусор');
  assert.ok(s.indexOf('\r\n') !== -1, 'cmd.exe нужен CRLF');
  assert.match(s, /where node/, 'отсутствие Node объясняется человеку');
  assert.match(s, /nodejs\.org/);
  assert.match(s, /C:\\шт\\server\.js/, 'путь переведён в обратные слеши');
  assert.match(s, /--project "%CD%"/, 'следим за папкой, где лежит ярлык');
  assert.match(s, /pause/, 'окно не закроется мгновенно при ошибке');
});

test('ярлык macOS/Linux: shebang, проверка Node, переход в свою папку', function () {
  var s = shortcuts.unixScript({ serverPath: '/opt/шт/server.js' });
  assert.match(s, /^#!\/usr\/bin\/env bash/);
  assert.match(s, /cd "\$\(dirname "\$0"\)"/);
  assert.match(s, /command -v node/);
  assert.match(s, /--project "\$PWD"/);
  assert.ok(s.indexOf('\r') === -1, 'в bash CRLF ломает shebang');
});

test('ярлыки создаются на диске, у unix-варианта стоит бит исполнения', function () {
  var dir = tmpdir('short-');
  try {
    var res = shortcuts.install(dir, { serverPath: '/x/server.js' });
    assert.strictEqual(res.length, 2);
    assert.ok(res.every(function (r) { return r.status === 'created'; }),
      JSON.stringify(res));

    var bat = path.join(dir, shortcuts.WINDOWS_NAME);
    var cmd = path.join(dir, shortcuts.UNIX_NAME);
    assert.ok(fs.existsSync(bat));
    assert.ok(fs.existsSync(cmd));

    if (process.platform !== 'win32') {
      var mode = fs.statSync(cmd).mode & 0o777;
      assert.ok(mode & 0o100, 'без бита исполнения двойной клик не сработает, mode=' + mode.toString(8));
    }
  } finally { rm(dir); }
});

test('существующий ярлык не перезаписывается без спроса', function () {
  var dir = tmpdir('short-keep-');
  try {
    var file = path.join(dir, shortcuts.UNIX_NAME);
    fs.writeFileSync(file, 'моя правка\n');
    var res = shortcuts.install(dir, { only: 'unix' });
    assert.strictEqual(res[0].status, 'skipped');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'моя правка\n');

    var forced = shortcuts.install(dir, { only: 'unix', force: true });
    assert.strictEqual(forced[0].status, 'created');
    assert.notStrictEqual(fs.readFileSync(file, 'utf8'), 'моя правка\n');
  } finally { rm(dir); }
});

test('можно попросить ярлык только под одну ОС', function () {
  assert.strictEqual(shortcuts.plan('/tmp', { only: 'windows' }).length, 1);
  assert.strictEqual(shortcuts.plan('/tmp', { only: 'unix' })[0].name, shortcuts.UNIX_NAME);
  assert.strictEqual(shortcuts.plan('/tmp').length, 2, 'по умолчанию оба — папку могут синхронизировать');
});

// ── Баннер ──────────────────────────────────────────────────────────────────

var BANNER_INFO = {
  localUrl: 'http://127.0.0.1:4517/',
  port: 4517,
  requestedPort: 4517,
  portShifted: false,
  share: false,
  projects: [{ project: '/home/user/проект', level: 'A', branch: 'main' }]
};

test('баннер: адрес, проект, источник и обещание «только смотрю»', function () {
  var text = banner.render(BANNER_INFO);
  assert.match(text, /ШТУРМАН/);
  assert.match(text, /http:\/\/127\.0\.0\.1:4517\//);
  assert.match(text, /\/home\/user\/проект/);
  assert.match(text, /уровень A/);
  assert.match(text, /ветка main/);
  assert.match(text, /ничего не меняет в вашем проекте/);
  assert.match(text, /только на этом компьютере/, 'сказано, что сеть закрыта');
  assert.ok(text.indexOf('undefined') === -1);
});

test('баннер: подменённый порт объясняется', function () {
  var text = banner.render(Object.assign({}, BANNER_INFO, {
    portShifted: true, requestedPort: 4517, port: 4519,
    localUrl: 'http://127.0.0.1:4519/'
  }));
  assert.match(text, /порт 4517 был занят/, 'называется тот порт, который просили');
});

test('баннер: уровень B объясняет причину', function () {
  var text = banner.render(Object.assign({}, BANNER_INFO, {
    projects: [{ project: '/p', level: 'B', levelReason: 'Каталог транскриптов не найден', branch: null }]
  }));
  assert.match(text, /уровень B/);
  assert.match(text, /Каталог транскриптов не найден/);
  assert.match(text, /недоступен — панель работает без него/);
});

test('баннер: в share-режиме есть QR, ссылка и предупреждения', function () {
  var text = banner.render(Object.assign({}, BANNER_INFO, {
    share: true,
    shareUrl: 'http://192.168.1.42:4517/?t=deadbeef',
    addresses: [
      { address: '192.168.1.42', label: 'Wi-Fi (wlan0)', kind: 'wifi' },
      { address: '10.0.0.15', label: 'кабель (eth0)', kind: 'wired' }
    ]
  }));
  assert.match(text, /ДОСТУП С ТЕЛЕФОНА ВКЛЮЧЁН/);
  assert.match(text, /http:\/\/192\.168\.1\.42:4517\/\?t=deadbeef/);
  assert.ok(/[█▀▄]/.test(text), 'QR-код нарисован псевдографикой');
  assert.match(text, /той же сети/, 'сказано про общую сеть');
  assert.match(text, /ключ доступа/);
  assert.match(text, /только читает/, 'обещание повторено там, где оно важнее всего');
  assert.match(text, /кабель \(eth0\)/, 'запасные адреса показаны');
});

test('баннер: share без сети не врёт про QR', function () {
  var text = banner.render(Object.assign({}, BANNER_INFO, { share: true, addresses: [] }));
  assert.match(text, /Не нашлось ни одного адреса/);
  assert.ok(!/[█▀▄]/.test(text), 'QR не рисуется, когда некуда вести');
});

test('строка статуса для терминала помещается в одну строку', function () {
  var line = banner.tuiLine({
    detectorState: 'waiting', files: 12, commands: 34, errors: 2,
    duration: '5 мин 2 с', branch: 'main', lastTitle: 'Клод изменил a.js'
  });
  assert.ok(line.indexOf('\n') === -1);
  assert.match(line, /ЖДЁТ ВАС/);
  assert.match(line, /файлов 12/);
  assert.match(line, /ошибок 2/);
  assert.match(line, /main/);

  var calm = banner.tuiLine({ detectorState: 'working', files: 0, commands: 0, errors: 0, duration: '1 с' });
  assert.match(calm, /работает/);
  assert.match(calm, /ошибок нет/);
});
