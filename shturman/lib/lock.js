'use strict';

/**
 * Один экземпляр Штурмана.
 *
 * Человек кликает по ярлыку столько раз, сколько захочет, — и каждый клик
 * должен приводить к одной и той же открытой панели, а не к пятому серверу
 * на пятом порту. Замок хранит pid и адрес уже работающего Штурмана.
 *
 * Почему файл, а не «занят ли порт»: порт может занять что угодно другое, а
 * нам нужно знать именно «наш ли это процесс и по какому адресу он отвечает».
 * Проверка живости — `process.kill(pid, 0)`: сигнал не посылается, просто
 * спрашивается, существует ли процесс.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

var FILE_NAME = '.shturman.lock';

function lockPath(dir) {
  return path.join(dir || os.homedir(), FILE_NAME);
}

/** Жив ли процесс с таким pid. */
function alive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM значит «процесс есть, но чужой» — для нас он всё равно живой.
    return e && e.code === 'EPERM';
  }
}

/** Прочитать замок как есть, без проверок. */
function read(dir) {
  try {
    var raw = JSON.parse(fs.readFileSync(lockPath(dir), 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return {
      pid: typeof raw.pid === 'number' ? raw.pid : 0,
      port: typeof raw.port === 'number' ? raw.port : 0,
      url: typeof raw.url === 'string' ? raw.url : '',
      project: typeof raw.project === 'string' ? raw.project : '',
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0
    };
  } catch (e) {
    return null;
  }
}

/**
 * Прочитать замок, но вернуть его только если процесс действительно живёт.
 * Мёртвый замок (компьютер выключили из розетки) молча убирается.
 */
function readAlive(dir) {
  var data = read(dir);
  if (!data) return null;
  if (alive(data.pid) && data.pid !== process.pid) return data;
  if (data.pid === process.pid) return data;
  release(dir);
  return null;
}

/** Записать замок. Пишем через временный файл: половина записи никому не нужна. */
function acquire(info, dir) {
  var file = lockPath(dir);
  var data = {
    pid: process.pid,
    port: (info && info.port) || 0,
    url: (info && info.url) || '',
    project: (info && info.project) || '',
    startedAt: Date.now()
  };
  var tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    return data;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) { /* и так не создался */ }
    return null;
  }
}

/** Убрать замок. Чужой не трогаем — вдруг там уже другой Штурман. */
function release(dir) {
  var file = lockPath(dir);
  var data = read(dir);
  if (data && data.pid && data.pid !== process.pid && alive(data.pid)) return false;
  try { fs.unlinkSync(file); return true; } catch (e) { return false; }
}

/**
 * Повесить снятие замка на выход. Вызывается один раз при старте сервера:
 * без этого после Ctrl+C или закрытия окна остался бы мёртвый замок, и
 * следующий клик по ярлыку открыл бы вкладку в никуда.
 */
function releaseOnExit(dir) {
  var done = false;
  var off = function () {
    if (done) return;
    done = true;
    release(dir);
  };
  process.once('exit', off);
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(function (sig) {
    process.once(sig, function () { off(); process.exit(0); });
  });
  return off;
}

module.exports = {
  FILE_NAME: FILE_NAME,
  lockPath: lockPath,
  alive: alive,
  read: read,
  readAlive: readAlive,
  acquire: acquire,
  release: release,
  releaseOnExit: releaseOnExit
};
