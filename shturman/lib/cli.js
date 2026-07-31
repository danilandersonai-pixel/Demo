'use strict';

var path = require('path');

/**
 * Разбор аргументов командной строки:
 *   node server.js --project <путь> [--project <ещё путь>] [--port 4517]
 * Поддерживаем и запись через «=»: --port=4600. Несколько --project —
 * несколько папок в одной панели (переключатель в шапке).
 */
function parseArgs(argv) {
  var out = {
    projects: [], port: 4517, portGiven: false, help: false,
    share: false, noOpen: false, app: false, tui: false, command: null
  };
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
        if (val) out.projects.push(val);
        break;
      case '--port':
        if (val === null) val = args[++i];
        var port = parseInt(val, 10);
        if (!isNaN(port) && port > 0 && port < 65536) {
          out.port = port;
          out.portGiven = true;
        } else out.error = 'Непонятный порт: «' + val + '». Нужно число от 1 до 65535.';
        break;
      case '--share':
        out.share = true;
        break;
      case '--no-open':
        out.noOpen = true;
        break;
      case '--app':
        out.app = true;
        break;
      case '--tui':
        out.tui = true;
        out.noOpen = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      case 'ярлыки':
      case 'shortcuts':
        out.command = 'shortcuts';
        break;
      default:
        // не падаем на незнакомом флаге — просто предупреждаем
        if (key.indexOf('-') === 0) {
          out.warning = 'Незнакомый параметр «' + key + '» — пропускаю.';
        } else {
          // «node server.js /путь/к/проекту» тоже поймём
          out.projects.push(key);
        }
    }
  }
  if (!out.projects.length) out.projects.push(process.cwd());
  // резолвим и убираем дубли, сохраняя порядок
  var seen = {};
  out.projects = out.projects.map(function (p) { return path.resolve(p); })
    .filter(function (p) {
      if (seen[p]) return false;
      seen[p] = true;
      return true;
    });
  out.project = out.projects[0]; // совместимость: «главный» проект
  return out;
}

var HELP = [
  '«Штурман» — панель-наставник для новичка в Claude Code.',
  '',
  'Запуск:',
  '  shturman                     наблюдать за текущей папкой',
  '  shturman --project <путь>    наблюдать за другой папкой',
  '  shturman -p <путь> -p <ещё>  несколько папок в одной панели',
  '  shturman --port 4600         другой порт (по умолчанию 4517)',
  '  shturman --share             доступ с телефона по локальной сети (QR)',
  '  shturman --no-open           не открывать браузер автоматически',
  '  shturman --app               отдельное окно без адресной строки',
  '  shturman --tui               компактный статус прямо в терминале',
  '  shturman ярлыки              создать Штурман.bat и Штурман.command',
  '                               в текущей папке (для двойного клика)',
  '',
  '(Если команда shturman не установлена, то же самое: node server.js …)',
  'Браузер откроется сам; адрес всегда виден в терминале.'
].join('\n');

module.exports = { parseArgs: parseArgs, HELP: HELP };
