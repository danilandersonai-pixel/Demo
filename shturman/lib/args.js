'use strict';

// Разбор аргументов командной строки. Без зависимостей и без магии:
// поддерживаем «--key value» и «--key=value», остальное — ошибка с подсказкой.

var path = require('path');

var DEFAULTS = {
  project: '.',
  port: 4517,
  host: '127.0.0.1',     // менять нельзя: см. DECISIONS.md, решение 10
  idle: 45,              // секунды тишины до сигнала «Клод ждёт»
  debounce: 220,         // мс дебаунса вотчера
  poll: 3000,            // мс между пересканами в резервном режиме
  open: false,           // открыть браузер после старта
  forcePoll: false,      // принудительно резервный режим вотчера (для отладки)
  tailOnly: false,       // читать транскрипт только с конца
  ask: false,            // разрешить «Спроси Клода» (тратит лимиты)
  quiet: false
};

var HELP = [
  '',
  '  Штурман — панель-наставник для Claude Code',
  '',
  '  Запуск:',
  '    node server.js [--project <путь>] [--port 4517]',
  '',
  '  Флаги:',
  '    --project <путь>   папка проекта, за которой следим (по умолчанию — текущая)',
  '    --port <номер>     порт панели (по умолчанию 4517)',
  '    --idle <секунды>   через сколько тишины считать, что Клод ждёт (по умолчанию 45)',
  '    --debounce <мс>    склейка событий файловой системы (по умолчанию 220)',
  '    --poll <мс>        период пересканирования в резервном режиме (по умолчанию 3000)',
  '    --tail-only        читать транскрипт только с момента запуска, без истории',
  '    --force-poll       не пользоваться системным наблюдением за файлами',
  '    --ask              разрешить кнопку «Спроси Клода» (расходует ваши лимиты)',
  '    --open             открыть браузер сразу после запуска',
  '    --quiet            не печатать баннер',
  '    --help             эта справка',
  '',
  '  Панель слушает только 127.0.0.1 и ничего не меняет в вашем проекте.',
  ''
].join('\n');

function fail(message) {
  var err = new Error(message);
  err.usage = true;
  return err;
}

function parse(argv) {
  var args = Array.isArray(argv) ? argv.slice() : [];
  var out = Object.assign({}, DEFAULTS);
  var positional = [];

  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === '--help' || a === '-h') return { help: true, text: HELP };
    if (a === '--version' || a === '-v') return { version: true };

    if (a.indexOf('--') !== 0) { positional.push(a); continue; }

    var key = a.slice(2);
    var value = null;
    var eq = key.indexOf('=');
    if (eq !== -1) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    }

    function nextValue() {
      if (value !== null) return value;
      var v = args[i + 1];
      if (v === undefined || v.indexOf('--') === 0) {
        throw fail('Флагу --' + key + ' нужно значение. Пример: --' + key + ' <значение>');
      }
      i++;
      return v;
    }

    switch (key) {
      case 'project': case 'dir': case 'path':
        out.project = nextValue();
        break;
      case 'port':
        out.port = toInt(nextValue(), 'port', 1, 65535);
        break;
      case 'idle':
        out.idle = toInt(nextValue(), 'idle', 5, 3600);
        break;
      case 'debounce':
        out.debounce = toInt(nextValue(), 'debounce', 0, 10000);
        break;
      case 'poll':
        out.poll = toInt(nextValue(), 'poll', 250, 60000);
        break;
      case 'open':
        out.open = true;
        break;
      case 'force-poll':
        out.forcePoll = true;
        break;
      case 'tail-only':
        out.tailOnly = true;
        break;
      case 'ask':
        out.ask = true;
        break;
      case 'quiet':
        out.quiet = true;
        break;
      case 'host':
        // Флаг есть, но значение игнорируем: слушаем только петлю.
        nextValue();
        break;
      default:
        throw fail('Неизвестный флаг --' + key + '. Запустите с --help, чтобы увидеть список.');
    }
  }

  // Позиционный аргумент — тоже путь к проекту: «node server.js ../myapp».
  if (positional.length === 1 && out.project === DEFAULTS.project) {
    out.project = positional[0];
  } else if (positional.length > 1) {
    throw fail('Лишние аргументы: ' + positional.slice(1).join(', ') + '. Путь к проекту указывается один раз.');
  }

  out.projectAbs = path.resolve(out.project);
  out.idleMs = out.idle * 1000;
  return out;
}

function toInt(raw, name, min, max) {
  var n = Number(raw);
  if (!isFinite(n) || Math.floor(n) !== n) {
    throw fail('Значение флага --' + name + ' должно быть целым числом, а получено «' + raw + '».');
  }
  if (n < min || n > max) {
    throw fail('Значение флага --' + name + ' должно быть от ' + min + ' до ' + max + ', а получено ' + n + '.');
  }
  return n;
}

module.exports = { parse: parse, DEFAULTS: DEFAULTS, HELP: HELP };
