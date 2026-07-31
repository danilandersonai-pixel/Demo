'use strict';

var os = require('os');
var net = require('net');

/**
 * Сеть: адреса машины в локальной сети, подбор свободного порта и сборка
 * ссылки для телефона. Чистые части принимают данные снаружи — для тестов.
 */

/**
 * IPv4-адреса локальной сети из os.networkInterfaces() (данные можно
 * подменить в тестах). Несколько интерфейсов — несколько адресов; порядок:
 * сначала «обычные» домашние сети (192.168.*, 10.*), потом остальное.
 */
function lanAddresses(interfaces) {
  var ifs = interfaces || os.networkInterfaces();
  var out = [];
  Object.keys(ifs).forEach(function (name) {
    (ifs[name] || []).forEach(function (addr) {
      var isV4 = addr.family === 'IPv4' || addr.family === 4;
      if (isV4 && !addr.internal && addr.address) {
        out.push({ address: addr.address, iface: name });
      }
    });
  });
  out.sort(function (a, b) {
    return rank(a.address) - rank(b.address);
  });
  return out;

  function rank(ip) {
    if (ip.indexOf('192.168.') === 0) return 0;
    if (ip.indexOf('10.') === 0) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3; // всякие docker0 и виртуалки — в конец списка
  }
}

/** Ссылка для телефона: адрес + порт + одноразовый токен. */
function buildShareUrl(address, port, token) {
  var host = address.indexOf(':') !== -1 ? '[' + address + ']' : address;
  return 'http://' + host + ':' + port + '/?t=' + encodeURIComponent(token || '');
}

/**
 * Подбор свободного порта: пробуем желанный, занято — следующий,
 * максимум maxTries попыток. Резолвится числом или reject-ится.
 */
function findFreePort(startPort, host, maxTries) {
  var tries = maxTries || 50;
  return new Promise(function (resolve, reject) {
    attempt(startPort, 0);

    function attempt(port, n) {
      if (n >= tries || port > 65535) {
        reject(new Error('Не нашлось свободного порта (пробовал ' + startPort + '–' + (port - 1) + ')'));
        return;
      }
      var probe = net.createServer();
      probe.once('error', function (err) {
        probe.close();
        if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
          attempt(port + 1, n + 1);
        } else {
          reject(err);
        }
      });
      probe.once('listening', function () {
        probe.close(function () { resolve(port); });
      });
      probe.listen(port, host);
    }
  });
}

module.exports = {
  lanAddresses: lanAddresses,
  buildShareUrl: buildShareUrl,
  findFreePort: findFreePort
};
