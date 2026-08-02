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
  quiet: false,
  check: false,          // самодиагностика вместо запуска панели
  share: false,          // слушать локальную сеть (телефонный режим)
  app: false,            // открыть браузер отдельным окном без адресной строки
  tui: false,            // компактный статус в терминале вместо панели
  installShortcuts: false,
  pick: false,           // показать экран выбора проекта вместо текущей папки
  forceNew: false,       // поднять свой сервер, даже если один уже работает
  portExplicit: false,   // порт задан руками — молча подменять его нельзя
  openExplicit: false,
  noOpen: false
};

var HELP = [
  '',
  '  Штурман — панель-наставник для Claude Code',
  '',
  '  Запуск:',
  '    shturman                       в текущей папке, порт подберётся сам',
  '    shturman --share               плюс доступ с телефона по QR-коду',
  '    node server.js [--project …]   то же самое без установки пакета',
  '',
  '  Флаги:',
  '    --project <путь>   папка проекта, за которой следим (по умолчанию — текущая);',
  '                       флаг можно повторить — в панели появится переключатель',
  '    --port <номер>     порт панели (по умолчанию 4517; занят — возьмётся соседний)',
  '    --share            открыть доступ по локальной сети: ссылка и QR для телефона',
  '    --app              открыть панель отдельным окном браузера, без адресной строки',
  '    --tui              компактный статус прямо в терминале, без браузера',
  '    --install-shortcuts  положить в папку «Штурман.bat» и «Штурман.command»',
  '    --pick             открыть экран выбора проекта (так работает ярлык)',
  '    --no-open          не открывать браузер',
  '    --idle <секунды>   через сколько тишины считать, что Клод ждёт (по умолчанию 45)',
  '    --debounce <мс>    склейка событий файловой системы (по умолчанию 220)',
  '    --poll <мс>        период пересканирования в резервном режиме (по умолчанию 3000)',
  '    --tail-only        читать транскрипт только с момента запуска, без истории',
  '    --force-poll       не пользоваться системным наблюдением за файлами',
  '    --ask              разрешить кнопку «Спроси Клода» (расходует ваши лимиты)',
  '    --open             открыть браузер сразу после запуска',
  '    --quiet            не печатать баннер',
  '    --check            проверить окружение и выйти (если панель пустая)',
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
  var projects = [];

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
        // Флаг можно повторить: «--project a --project b» откроет обе папки
        // в одной панели с переключателем.
        projects.push(nextValue());
        break;
      case 'port':
        out.port = toInt(nextValue(), 'port', 1, 65535);
        out.portExplicit = true;
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
        out.openExplicit = true;
        break;
      case 'no-open':
        out.noOpen = true;
        out.openExplicit = true;
        break;
      case 'share':
        out.share = true;
        break;
      case 'app':
        // Режим киоска: отдельное окно браузера без адресной строки.
        out.app = true;
        out.open = true;
        out.openExplicit = true;
        break;
      case 'tui':
        out.tui = true;
        break;
      case 'install-shortcuts':
        out.installShortcuts = true;
        break;
      case 'pick':
        // Так запускается ярлык: папку человек выберет в панели, а не в
        // командной строке.
        out.pick = true;
        break;
      case 'force-new':
        out.forceNew = true;
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
      case 'check': case 'doctor':
        out.check = true;
        break;
      case 'host':
        // Флаг есть, но значение игнорируем: слушаем только петлю.
        nextValue();
        break;
      default:
        throw fail('Неизвестный флаг --' + key + '. Запустите с --help, чтобы увидеть список.');
    }
  }

  // Позиционные аргументы — тоже пути к проектам: «node server.js ../myapp».
  positional.forEach(function (p) { projects.push(p); });
  if (!projects.length) projects.push(DEFAULTS.project);

  // Одинаковые пути схлопываем, чтобы не поднимать два наблюдателя на одну
  // папку — это удвоило бы события в ленте.
  var seen = new Set();
  out.projects = projects.map(function (p) {
    return path.resolve(p);
  }).filter(function (abs) {
    if (seen.has(abs)) return false;
    seen.add(abs);
    return true;
  });

  // Основной проект — первый. Остальные доступны через переключатель.
  out.project = out.projects[0];
  out.projectAbs = out.projects[0];
  out.idleMs = out.idle * 1000;
  return out;
}

/**
 * Наложение сохранённого конфига на флаги.
 *
 * Приоритет однозначный: **флаг всегда сильнее конфига**. Иначе человек
 * пишет `--port 5000`, а получает порт из файла — и не понимает, почему.
 * Конфиг подставляется только туда, где флага не было.
 */
function applyConfig(opts, config) {
  var out = Object.assign({}, opts);
  var cfg = config || {};

  if (!out.portExplicit && configHasPort(cfg)) out.port = cfg.port;
  if (!out.share && cfg.share === true) out.share = true;

  // Браузер открываем по умолчанию — новичок не должен копировать адрес
  // руками. Отключается флагом --no-open или настройкой в конфиге.
  if (!out.openExplicit) out.open = cfg.openBrowser !== false;
  if (out.noOpen) out.open = false;

  // Порог тишины: флаг --idle сильнее, но отличить «задан» от «по умолчанию»
  // можно только сравнением с умолчанием — оно же и есть значение по умолчанию.
  if (out.idle === DEFAULTS.idle && typeof cfg.idleSeconds === 'number') {
    out.idle = cfg.idleSeconds;
    out.idleMs = out.idle * 1000;
  }

  out.config = cfg;
  return out;
}

function configHasPort(cfg) {
  return typeof cfg.port === 'number' && cfg.port >= 1 && cfg.port <= 65535;
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

module.exports = { parse: parse, applyConfig: applyConfig, DEFAULTS: DEFAULTS, HELP: HELP };
