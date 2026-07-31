'use strict';

var path = require('path');

/**
 * Разбор аргументов командной строки:
 *   node server.js --project <путь> [--port 4517] [--no-open]
 * Поддерживаем и запись через «=»: --port=4600.
 */
function parseArgs(argv) {
  var out = { project: process.cwd(), port: 4517, help: false };
  var args = argv.slice(2);
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    var eq = a.indexOf('=');
    var key = a, val = null;
    if (eq !== -1) {
      key = a.slice(0, eq);
      val = a.slice(eq + 1);
    }
    switch (key) {
      case '--project':
      case '-p':
        if (val === null) val = args[++i];
        if (val) out.project = val;
        break;
      case '--port':
        if (val === null) val = args[++i];
        var port = parseInt(val, 10);
        if (!isNaN(port) && port > 0 && port < 65536) out.port = port;
        else out.error = 'Непонятный порт: «' + val + '». Нужно число от 1 до 65535.';
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        // не падаем на незнакомом флаге — просто предупреждаем
        if (key.indexOf('-') === 0) {
          out.warning = 'Незнакомый параметр «' + key + '» — пропускаю.';
        } else if (!out._positionalUsed) {
          // «node server.js /путь/к/проекту» тоже поймём
          out.project = key;
          out._positionalUsed = true;
        }
    }
  }
  out.project = path.resolve(out.project);
  return out;
}

var HELP = [
  '«Штурман» — панель-наставник для новичка в Claude Code.',
  '',
  'Запуск:',
  '  node server.js                     наблюдать за текущей папкой',
  '  node server.js --project <путь>    наблюдать за другой папкой',
  '  node server.js --port 4600         другой порт (по умолчанию 4517)',
  '',
  'Затем откройте в браузере адрес, который появится в терминале.'
].join('\n');

module.exports = { parseArgs: parseArgs, HELP: HELP };
