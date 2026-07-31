'use strict';

// Сеть: свободный порт и адреса машины в локальной сети.
// Нужно и блоку 1 (порт подбирается сам), и блоку 2 (телефонный режим).

var net = require('net');
var os = require('os');

/**
 * Свободен ли порт на конкретном интерфейсе.
 * Проверяем именно тот адрес, который потом будем слушать: порт может быть
 * занят на 127.0.0.1 и свободен на 0.0.0.0, и наоборот.
 */
function isFree(port, host) {
  return new Promise(function (resolve) {
    var srv = net.createServer();
    srv.once('error', function () { resolve(false); });
    srv.once('listening', function () { srv.close(function () { resolve(true); }); });
    try {
      srv.listen(port, host || '127.0.0.1');
    } catch (e) {
      resolve(false);
    }
  });
}

/**
 * Подобрать свободный порт, начиная с желаемого.
 * Идём подряд, а не случайно: пользователю проще запомнить 4518 после 4517,
 * чем каждый раз новый пятизначный номер.
 */
function findFreePort(preferred, host, tries) {
  var start = Number(preferred) || 4517;
  var limit = tries || 40;

  function attempt(i) {
    if (i >= limit) {
      // Ни одного свободного в диапазоне — пусть ОС даст любой.
      return freeFromOs(host).then(function (p) {
        return { port: p, shifted: true, tried: limit, fallback: true };
      });
    }
    var port = start + i;
    if (port > 65535) return attempt(limit);
    return isFree(port, host).then(function (free) {
      if (free) return { port: port, shifted: i > 0, tried: i + 1, fallback: false };
      return attempt(i + 1);
    });
  }
  return attempt(0);
}

// Порт «от системы»: слушаем 0 и смотрим, что дали.
function freeFromOs(host) {
  return new Promise(function (resolve) {
    var srv = net.createServer();
    srv.listen(0, host || '127.0.0.1', function () {
      var port = srv.address().port;
      srv.close(function () { resolve(port); });
    });
    srv.once('error', function () { resolve(0); });
  });
}

/**
 * Адреса этой машины в локальной сети.
 *
 * Возвращает список {address, family, iface, kind, label, priority},
 * отсортированный так, чтобы первым шёл тот, который вероятнее всего нужен
 * человеку: обычный Wi-Fi или Ethernet, а не виртуальный адаптер Docker.
 */
function lanAddresses(override) {
  var out = [];
  // Список интерфейсов можно подать снаружи — так функция проверяется на
  // выдуманных Wi-Fi, Docker и VPN, не завися от машины, где идут тесты.
  var ifaces = override || os.networkInterfaces();

  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (info) {
      if (info.internal) return;                       // это 127.0.0.1
      if (info.family !== 'IPv4' && info.family !== 4) return;  // IPv6 в QR не годится
      if (!isPrivate(info.address)) return;            // публичный адрес не наш случай

      out.push({
        address: info.address,
        family: 'IPv4',
        iface: name,
        kind: classify(name),
        label: describe(name, info.address),
        priority: priorityOf(name)
      });
    });
  });

  out.sort(function (a, b) {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.address.localeCompare(b.address);
  });
  return out;
}

// Только частные диапазоны: 10/8, 172.16/12, 192.168/16, 169.254/16 (link-local).
function isPrivate(ip) {
  var p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some(isNaN)) return false;
  if (p[0] === 10) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  return false;
}

// Виртуальные адаптеры узнаём по имени: Docker, VirtualBox, VPN, WSL.
var VIRTUAL = /^(docker|br-|veth|virbr|vboxnet|vmnet|utun|tun|tap|zt|wg|tailscale|Hyper-V|WSL|vEthernet)/i;
var WIRELESS = /^(wl|wifi|Wi-Fi|Wireless|en0|airport)/i;
var WIRED = /^(en|eth|Ethernet|em|eno|enp|ens)/i;

function classify(name) {
  if (VIRTUAL.test(name)) return 'virtual';
  if (WIRELESS.test(name)) return 'wifi';
  if (WIRED.test(name)) return 'wired';
  return 'other';
}

function priorityOf(name) {
  var kind = classify(name);
  // Wi-Fi первым: телефон почти наверняка в той же беспроводной сети.
  if (kind === 'wifi') return 0;
  if (kind === 'wired') return 1;
  if (kind === 'other') return 2;
  return 3;                                  // виртуальные — в самый конец
}

function describe(name, address) {
  var kind = classify(name);
  if (kind === 'wifi') return 'Wi-Fi (' + name + ')';
  if (kind === 'wired') return 'кабель (' + name + ')';
  if (kind === 'virtual') {
    return 'виртуальный адаптер ' + name + ' — телефон сюда, скорее всего, не достучится';
  }
  if (address.indexOf('169.254.') === 0) {
    return name + ' — адрес без роутера, связи с телефоном не будет';
  }
  return name;
}

/**
 * Лучший адрес для показа в QR-коде. null, если сети нет вовсе.
 */
function bestAddress(override) {
  var all = lanAddresses(override);
  var real = all.filter(function (a) { return a.kind !== 'virtual'; });
  return real.length ? real[0] : (all[0] || null);
}

/**
 * Собирает ссылку для телефона. Токен идёт параметром — так его можно
 * зашить в QR-код, и человеку не придётся ничего вводить руками.
 */
function buildUrl(host, port, token) {
  var base = 'http://' + host + ':' + port + '/';
  if (!token) return base;
  return base + '?t=' + encodeURIComponent(token);
}

module.exports = {
  isFree: isFree,
  findFreePort: findFreePort,
  lanAddresses: lanAddresses,
  bestAddress: bestAddress,
  buildUrl: buildUrl,
  isPrivate: isPrivate,
  classify: classify
};
