'use strict';

// Перевод событий на человеческий русский.
// Здесь нет ввода-вывода — только текст. Каждая функция чистая и тестируемая.

var paths = require('./paths');

// ---------------------------------------------------------------------------
// Русская грамматика: без этого получается «5 файла» и «1 команд»
// ---------------------------------------------------------------------------

// plural(1, 'файл', 'файла', 'файлов') -> 'файл'
function plural(n, one, few, many) {
  var abs = Math.abs(Math.trunc(Number(n) || 0));
  var mod100 = abs % 100;
  var mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function withPlural(n, one, few, many) {
  return n + ' ' + plural(n, one, few, many);
}

// Длительность в человеческом виде: «2 ч 14 мин», «46 с».
function formatDuration(ms) {
  var total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  var sec = Math.floor(total % 60);
  var min = Math.floor((total / 60) % 60);
  var hrs = Math.floor(total / 3600);
  if (hrs > 0) return hrs + ' ч ' + min + ' мин';
  if (min > 0) return min + ' мин ' + sec + ' с';
  return sec + ' с';
}

// «только что», «3 мин назад», «вчера».
function formatAgo(ms) {
  var s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 10) return 'только что';
  if (s < 60) return withPlural(s, 'секунду', 'секунды', 'секунд') + ' назад';
  var m = Math.floor(s / 60);
  if (m < 60) return withPlural(m, 'минуту', 'минуты', 'минут') + ' назад';
  var h = Math.floor(m / 60);
  if (h < 24) return withPlural(h, 'час', 'часа', 'часов') + ' назад';
  var d = Math.floor(h / 24);
  if (d === 1) return 'вчера';
  return withPlural(d, 'день', 'дня', 'дней') + ' назад';
}

// Обрезка длинного текста для заголовка события.
function shorten(text, limit) {
  var max = limit || 80;
  var s = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// Объяснение консольных команд
// ---------------------------------------------------------------------------

// Правило: [регулярка, объяснение]. Порядок важен — первое совпадение
// выигрывает, поэтому частные правила стоят выше общих.
var COMMAND_RULES = [
  [/^npm\s+(run\s+)?test\b/, 'проверяет, работают ли тесты'],
  [/^npm\s+run\s+build\b/, 'собирает проект в готовый вид'],
  [/^npm\s+run\s+(dev|start)\b/, 'запускает проект, чтобы посмотреть его в браузере'],
  [/^npm\s+run\s+lint\b/, 'проверяет код на опечатки и нарушения стиля'],
  [/^npm\s+(i|install|ci)\b/, 'скачивает библиотеки, от которых зависит проект'],
  [/^npm\s+run\b/, 'запускает команду, описанную в package.json'],
  [/^(yarn|pnpm)\s+(test|run\s+test)\b/, 'проверяет, работают ли тесты'],
  [/^(yarn|pnpm)\s+(install|i)\b/, 'скачивает библиотеки, от которых зависит проект'],
  [/^node\s+--test\b/, 'запускает тесты встроенным средством Node.js'],
  [/^node\s+--check\b/, 'проверяет файл на синтаксические ошибки, не запуская его'],
  [/^node\s+/, 'запускает программу на Node.js'],
  [/^(python3?|py)\s+-m\s+pytest\b/, 'запускает тесты Python'],
  [/^pytest\b/, 'запускает тесты Python'],
  [/^(python3?|py)\s+/, 'запускает программу на Python'],
  [/^pip3?\s+install\b/, 'скачивает библиотеки Python'],
  [/^go\s+test\b/, 'запускает тесты Go'],
  [/^go\s+(build|run)\b/, 'собирает или запускает программу на Go'],
  [/^cargo\s+test\b/, 'запускает тесты Rust'],
  [/^cargo\s+(build|run)\b/, 'собирает или запускает программу на Rust'],
  [/^make\b/, 'выполняет заранее описанный набор шагов'],

  [/^git\s+status\b/, 'смотрит, какие файлы изменились и ещё не сохранены в историю'],
  [/^git\s+diff\b/, 'смотрит, что именно поменялось в файлах, построчно'],
  [/^git\s+log\b/, 'смотрит историю сохранений'],
  [/^git\s+add\b/, 'помечает файлы для сохранения в историю'],
  [/^git\s+commit\b/, 'сохраняет изменения в историю проекта'],
  [/^git\s+push\b/, 'отправляет сохранённые изменения на сервер (GitHub)'],
  [/^git\s+pull\b/, 'забирает свежие изменения с сервера'],
  [/^git\s+fetch\b/, 'проверяет, что нового на сервере, ничего не меняя у себя'],
  [/^git\s+checkout\b/, 'переключается на другую ветку или откатывает файл'],
  [/^git\s+(switch|branch)\b/, 'работает с ветками — параллельными линиями разработки'],
  [/^git\s+(merge|rebase)\b/, 'объединяет изменения из разных веток'],
  [/^git\s+(show|rev-parse|rev-list)\b/, 'достаёт справочную информацию из истории git'],
  [/^git\b/, 'работает с историей проекта'],

  [/^(ls|dir)\b/, 'смотрит, какие файлы лежат в папке'],
  [/^(cat|head|tail)\b/, 'читает содержимое файла'],
  [/^(cd)\b/, 'переходит в другую папку'],
  [/^(mkdir)\b/, 'создаёт папку'],
  [/^(rm|del)\b/, 'удаляет файлы'],
  [/^(cp|copy)\b/, 'копирует файлы'],
  [/^(mv|move)\b/, 'перемещает или переименовывает файлы'],
  [/^(grep|rg|ripgrep)\b/, 'ищет текст внутри файлов'],
  [/^find\b/, 'ищет файлы по имени'],
  [/^(curl|wget)\b/, 'обращается к сайту или к серверу по сети'],
  [/^echo\b/, 'просто выводит текст'],
  [/^(chmod|chown)\b/, 'меняет права доступа к файлам'],
  [/^(docker)\b/, 'работает с контейнерами — изолированными окружениями'],
  [/^(kill|pkill)\b/, 'останавливает запущенную программу'],
  [/^(sleep)\b/, 'просто ждёт указанное время'],
  [/^(which|where|whereis)\b/, 'проверяет, установлена ли программа'],
  [/^(diff)\b/, 'сравнивает два файла']
];

/**
 * Объяснение команды простыми словами.
 * Возвращает строку без заглавной буквы, чтобы подставлялась в предложение:
 * «запустил npm test — проверяет, работают ли тесты».
 * Если команда незнакома — null (тогда объяснение просто не показываем,
 * а не выдумываем).
 */
function explainCommand(command) {
  var cmd = String(command || '').trim();
  if (!cmd) return null;
  // Составные команды: объясняем по первому осмысленному звену.
  var first = cmd.split(/\s*(?:&&|\|\||;|\|)\s*/)[0].trim();
  // Срезаем префиксы вида «cd /path && …» уже сделано выше; убираем sudo/env.
  first = first.replace(/^(sudo|env|nohup)\s+/, '');
  for (var i = 0; i < COMMAND_RULES.length; i++) {
    if (COMMAND_RULES[i][0].test(first)) return COMMAND_RULES[i][1];
  }
  return null;
}

// Короткое имя команды для заголовка: «npm test», а не вся строка с флагами.
function commandLabel(command) {
  var cmd = String(command || '').trim();
  if (!cmd) return '';
  var oneLine = cmd.replace(/\s+/g, ' ');
  return shorten(oneLine, 64);
}

// ---------------------------------------------------------------------------
// Иконки и подписи инструментов
// ---------------------------------------------------------------------------

var ACTION_ICON = {
  read: '📖',
  write: '✍️',
  edit: '📝',
  run: '🔧',
  search: '🔍',
  web: '🌐',
  agent: '🤝',
  plan: '🗒',
  skill: '🎯',
  mcp: '🔌',
  tool: '⚙️'
};

// Имя инструмента человеческим языком — для режима «Подробно» и подсказок.
var TOOL_RU = {
  Read: 'чтение файла',
  Write: 'создание файла',
  Edit: 'правка файла',
  MultiEdit: 'правка файла',
  NotebookEdit: 'правка блокнота',
  Bash: 'команда в терминале',
  Glob: 'поиск файлов по маске',
  Grep: 'поиск текста в файлах',
  WebFetch: 'загрузка страницы',
  WebSearch: 'поиск в интернете',
  Task: 'запуск помощника',
  Agent: 'запуск помощника',
  TodoWrite: 'план работ',
  Skill: 'навык',
  SlashCommand: 'команда-навык'
};

function toolRu(name) {
  if (!name) return 'инструмент';
  if (TOOL_RU[name]) return TOOL_RU[name];
  if (String(name).indexOf('mcp__') === 0) {
    var parts = String(name).split('__');
    return 'внешний сервис ' + (parts[1] || '') + (parts[2] ? ' → ' + parts[2] : '');
  }
  return name;
}

// Витрины известных сервисов: узнаваемое имя вместо технического.
// Незнакомый сервис показывается своим именем без выдумок.
var MCP_SERVICE_RU = {
  github: 'GitHub',
  gitlab: 'GitLab',
  slack: 'Slack',
  gmail: 'Gmail',
  notion: 'Notion',
  linear: 'Linear',
  jira: 'Jira',
  figma: 'Figma',
  filesystem: 'файлы',
  memory: 'память',
  puppeteer: 'браузер',
  playwright: 'браузер'
};

/**
 * Разбор имени MCP-инструмента: mcp__github__list_issues →
 * { service: 'GitHub', method: 'list issues' }. Дефисы и подчёркивания
 * становятся пробелами; длинные UUID-имена серверов не считаются сервисом.
 */
function mcpParts(name) {
  var s = String(name || '');
  if (s.indexOf('mcp__') !== 0) return { service: '', method: '' };
  var parts = s.split('__');
  var rawService = parts[1] || '';
  var service = MCP_SERVICE_RU[rawService.toLowerCase()] ||
    rawService.replace(/[-_]+/g, ' ').trim();
  // Служебные идентификаторы вместо имён (UUID и похожее) не показываем
  // как «сервис» — карточка честно скажет «внешний сервис».
  if (/^[0-9a-f-]{16,}$/i.test(rawService)) service = '';
  var method = parts.length > 2
    ? parts.slice(2).join('_').replace(/[-_]+/g, ' ').trim()
    : '';
  return { service: service, method: method };
}

// «+42 −7» для правок.
function statsLabel(stats) {
  if (!stats) return '';
  var a = stats.added || 0;
  var r = stats.removed || 0;
  if (!a && !r) return '';
  return '+' + a + ' −' + r;
}

function statsHint(stats) {
  if (!stats) return '';
  var a = stats.added || 0;
  var r = stats.removed || 0;
  var parts = [];
  if (a) parts.push(withPlural(a, 'строка', 'строки', 'строк') + ' добавлено');
  if (r) parts.push(withPlural(r, 'строка', 'строки', 'строк') + ' удалено');
  if (!parts.length) return '';
  var text = parts.join(', ');
  return stats.approx ? text + ' (примерно)' : text;
}

// ---------------------------------------------------------------------------
// Главная функция: событие -> человеческий текст
// ---------------------------------------------------------------------------

/**
 * Принимает нормализованное событие (из transcript-parse / watcher / git),
 * возвращает {icon, title, hint, level}.
 * Никогда не бросает: неизвестное событие получает нейтральную формулировку.
 */
function humanize(ev) {
  if (!ev || typeof ev !== 'object') {
    return { icon: '•', title: 'Событие', hint: '', level: 'info' };
  }

  // Работа субагента подписывается отдельно: это не Клод, а его помощник,
  // и путать их нельзя — иначе непонятно, кто трогал файл.
  if (ev.sidechain) {
    var inner = humanizeMain(ev);
    return {
      icon: inner.icon,
      title: 'Помощник: ' + lowerFirst(stripActor(inner.title)),
      hint: inner.hint,
      level: inner.level
    };
  }
  return humanizeMain(ev);
}

// «Клод читает README.md» -> «читает README.md»: подлежащее подменяется
// на помощника, а остальная формулировка остаётся прежней.
function stripActor(title) {
  return String(title || '').replace(/^Клод\s+/, '');
}

function lowerFirst(s) {
  var t = String(s || '');
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

function humanizeMain(ev) {
  switch (ev.kind) {
    case 'user': return humanizeUser(ev);
    case 'assistant': return humanizeAssistant(ev);
    case 'tool': return humanizeTool(ev);
    case 'result': return humanizeResult(ev);
    case 'file': return humanizeFile(ev);
    case 'git': return humanizeGit(ev);
    case 'session': return humanizeSession(ev);
    case 'system': return {
      icon: ev.level === 'error' ? '⛔' : (ev.level === 'warn' ? '⚠️' : 'ℹ️'),
      title: ev.title || 'Сообщение Штурмана',
      hint: ev.hint || '',
      level: ev.level || 'info'
    };
    default:
      return { icon: '•', title: ev.title || 'Событие', hint: ev.hint || '', level: ev.level || 'info' };
  }
}

function humanizeUser(ev) {
  return {
    icon: '🙋',
    title: 'Вы написали Клоду',
    hint: shorten(ev.text, 160),
    level: 'info'
  };
}

function humanizeAssistant(ev) {
  if (ev.action === 'think') {
    return {
      icon: '💭',
      title: 'Клод думает',
      hint: shorten(ev.text, 160) || 'Обдумывает следующий шаг — это нормально, ждите.',
      level: 'info'
    };
  }
  return {
    icon: '💬',
    title: 'Клод отвечает',
    hint: shorten(ev.text, 200),
    level: 'info'
  };
}

function humanizeTool(ev) {
  var icon = ACTION_ICON[ev.action] || '⚙️';
  var file = ev.file ? paths.baseName(ev.file) : '';
  var full = ev.file || '';

  switch (ev.action) {
    case 'read':
      return {
        icon: icon,
        title: 'Клод читает ' + (full || 'файл'),
        hint: 'Смотрит содержимое, чтобы понять, как всё устроено. Файл при этом не меняется.',
        level: 'info'
      };

    case 'write':
      return {
        icon: '✍️',
        title: 'Клод создаёт ' + (full || 'файл'),
        hint: statsHint(ev.stats) || 'Записывает новый файл целиком.',
        level: 'info'
      };

    case 'edit': {
      var label = statsLabel(ev.stats);
      return {
        icon: '📝',
        title: 'Клод изменил ' + (full || 'файл') + (label ? ' (' + label + ')' : ''),
        hint: statsHint(ev.stats) || 'Правит существующий файл.',
        level: 'info'
      };
    }

    case 'run': {
      var cmd = commandLabel(ev.command);
      var why = explainCommand(ev.command);
      var hint = why ? why[0].toUpperCase() + why.slice(1) + '.' : (ev.description || 'Команда в терминале.');
      if (ev.background) hint += ' Запущена в фоне — результат придёт позже.';
      return {
        icon: '🔧',
        title: 'Клод запустил ' + (cmd || 'команду') + (why ? ' — ' + why : ''),
        hint: hint,
        level: 'info'
      };
    }

    case 'search': {
      var what = ev.pattern ? '«' + shorten(ev.pattern, 48) + '»' : 'что-то';
      var where = ev.searchPath ? ' в ' + ev.searchPath : ' по проекту';
      var verb = ev.tool === 'Glob' ? 'ищет файлы по маске ' : 'ищет ';
      return {
        icon: '🔍',
        title: 'Клод ' + verb + what + where,
        hint: 'Ориентируется в проекте: выясняет, где лежит нужный код. Ничего не меняет.',
        level: 'info'
      };
    }

    case 'web':
      if (ev.tool === 'WebSearch') {
        return {
          icon: '🌐',
          title: 'Клод ищет в интернете: ' + shorten(ev.query, 60),
          hint: 'Обращается к поиску за справкой.',
          level: 'info'
        };
      }
      return {
        icon: '🌐',
        title: 'Клод открывает страницу ' + shorten(ev.url, 60),
        hint: 'Читает документацию или страницу в сети.',
        level: 'info'
      };

    case 'agent':
      return {
        icon: '🤝',
        title: 'Клод позвал помощника: ' + shorten(ev.description, 60),
        hint: 'Отдельный агент работает над подзадачей параллельно. Его шаги в эту ленту не попадают.',
        level: 'info'
      };

    case 'plan': {
      var done = typeof ev.todoDone === 'number' ? ev.todoDone : null;
      var total = typeof ev.todoCount === 'number' ? ev.todoCount : null;
      var progress = (done !== null && total !== null) ? ' (' + done + ' из ' + total + ')' : '';
      return {
        icon: '🗒',
        title: 'Клод обновил план работ' + progress,
        hint: ev.todoActive ? 'Сейчас в работе: ' + shorten(ev.todoActive, 90) : 'Список шагов, которые Клод собирается сделать.',
        level: 'info'
      };
    }

    case 'skill':
      return {
        icon: '🎯',
        title: 'Клод применил навык ' + shorten(ev.skill, 48),
        hint: 'Навык — заготовленная инструкция для типовой задачи.',
        level: 'info'
      };

    case 'mcp': {
      var mcp = mcpParts(ev.tool);
      if (!mcp.service) {
        return {
          icon: '🔌',
          title: 'Клод обратился к внешнему сервису',
          hint: toolRu(ev.tool) + '. Это подключённый к Клоду сторонний инструмент.',
          level: 'info'
        };
      }
      return {
        icon: '🔌',
        title: 'Клод обратился к сервису ' + mcp.service +
          (mcp.method ? ': ' + mcp.method : ''),
        hint: 'Внешний сервис — сторонний инструмент, подключённый к Клоду. ' +
          'Что передали и что пришло в ответ — по нажатию на карточку.',
        level: 'info'
      };
    }

    default:
      return {
        icon: icon,
        title: 'Клод использует ' + toolRu(ev.tool),
        hint: file ? 'Файл: ' + full : '',
        level: 'info'
      };
  }
}

function humanizeResult(ev) {
  if (!ev.ok) {
    var reason = shorten(ev.stderr || ev.output, 160);
    if (ev.interrupted) {
      return {
        icon: '✋',
        title: 'Команда прервана',
        hint: 'Выполнение остановлено, не дождавшись конца. Часто это таймаут.',
        level: 'warn'
      };
    }
    return {
      icon: '⛔',
      title: 'Ошибка: ' + (ev.tool ? toolRu(ev.tool) : 'инструмент') + ' не сработал',
      hint: reason || 'Клод, скорее всего, попробует иначе — это нормальная часть работы.',
      level: 'error'
    };
  }

  // Успех показываем сдержанно: лента не должна дублировать каждый вызов.
  if (typeof ev.fileLines === 'number' && ev.fileLines > 0) {
    return {
      icon: '✅',
      title: 'Прочитано: ' + withPlural(ev.fileLines, 'строка', 'строки', 'строк'),
      hint: ev.file ? ev.file : '',
      level: 'info'
    };
  }
  if (typeof ev.numFiles === 'number') {
    return {
      icon: '✅',
      title: 'Найдено: ' + withPlural(ev.numFiles, 'файл', 'файла', 'файлов'),
      hint: 'Результат поиска.',
      level: 'info'
    };
  }
  var out = shorten(ev.stdout || ev.output, 120);
  return {
    icon: '✅',
    title: 'Готово' + (ev.tool ? ': ' + toolRu(ev.tool) : ''),
    hint: out || 'Команда отработала без ошибок.',
    level: 'info'
  };
}

function humanizeFile(ev) {
  var p = ev.file || '';
  switch (ev.action) {
    case 'added':
      return {
        icon: '🆕',
        title: 'Появился файл ' + p,
        hint: 'В проекте стало на один файл больше.',
        level: 'info'
      };
    case 'removed':
      return {
        icon: '🗑',
        title: 'Файл удалён: ' + p,
        hint: 'Файла больше нет в проекте.',
        level: 'warn'
      };
    case 'dir-added':
      return { icon: '📁', title: 'Появилась папка ' + p, hint: '', level: 'info' };
    case 'dir-removed':
      return { icon: '📁', title: 'Папка удалена: ' + p, hint: '', level: 'warn' };
    default:
      return {
        icon: '💾',
        title: 'Файл изменён: ' + p,
        hint: 'Содержимое на диске обновилось.',
        level: 'info'
      };
  }
}

function humanizeGit(ev) {
  switch (ev.action) {
    case 'branch':
      return {
        icon: '🌿',
        title: 'Ветка теперь «' + ev.branch + '»',
        hint: 'Ветка — отдельная линия работы. Изменения в ней не мешают остальным.',
        level: 'info'
      };
    case 'commit':
      return {
        icon: '📌',
        title: 'Новое сохранение в истории: ' + shorten(ev.subject, 70),
        hint: 'Коммит — точка, к которой всегда можно вернуться.',
        level: 'info'
      };
    case 'dirty': {
      var n = ev.count || 0;
      if (n === 0) {
        return {
          icon: '🧹',
          title: 'Все изменения сохранены в историю',
          hint: 'Несохранённых правок не осталось.',
          level: 'info'
        };
      }
      return {
        icon: '📊',
        title: withPlural(n, 'файл', 'файла', 'файлов') + ' изменено и пока не сохранено',
        hint: 'Правки есть на диске, но их ещё нет в истории git. Пока не сделан коммит, вернуться к ним будет нельзя.',
        level: 'info'
      };
    }
    default:
      return { icon: '🌿', title: ev.title || 'Изменение в git', hint: ev.hint || '', level: 'info' };
  }
}

function humanizeSession(ev) {
  switch (ev.action) {
    case 'idle':
      return {
        icon: '🔔',
        title: 'Клод остановился и ждёт вас',
        hint: 'Новых действий нет уже ' + formatDuration(ev.quietMs) + '. Загляните в терминал: скорее всего, нужен ваш ответ.',
        level: 'warn'
      };
    case 'resumed':
      return {
        icon: '▶️',
        title: 'Клод снова работает',
        hint: 'Появились новые действия.',
        level: 'info'
      };
    case 'started':
      return {
        icon: '🚀',
        title: 'Началась сессия Клода',
        hint: ev.hint || 'Штурман подключился к транскрипту и следит за происходящим.',
        level: 'info'
      };
    case 'ended':
      return {
        icon: '🏁',
        title: 'Сессия завершена',
        hint: 'Транскрипт больше не пополняется.',
        level: 'info'
      };
    default:
      return { icon: '🧭', title: ev.title || 'Событие сессии', hint: ev.hint || '', level: 'info' };
  }
}

/**
 * Одна строка про ветку — «смысл ветки» для git-панели.
 */
function describeBranch(branch) {
  var b = String(branch || '').trim();
  if (!b) return 'Ветка не определена — возможно, в репозитории ещё нет ни одного коммита.';
  if (b === 'main' || b === 'master') {
    return 'Главная ветка проекта. Обычно в ней лежит то, что считается рабочей версией.';
  }
  if (/^(HEAD|detached)/i.test(b)) {
    return 'Вы не на ветке, а на конкретном коммите («отсоединённая голова»). Новые сохранения здесь легко потерять.';
  }
  if (/^(feature|feat)\//i.test(b)) {
    return 'Ветка с новой возможностью: работа идёт в стороне от главной, чтобы ничего там не сломать.';
  }
  if (/^(fix|bugfix|hotfix)\//i.test(b)) {
    return 'Ветка с исправлением ошибки: правка живёт отдельно, пока её не проверят.';
  }
  if (/^claude\//i.test(b)) {
    return 'Ветка, созданная для работы Claude Code. Изменения копятся здесь и не задевают главную ветку.';
  }
  if (/^(release|rc)\//i.test(b)) {
    return 'Ветка подготовки выпуска: сюда пускают только то, что войдёт в релиз.';
  }
  return 'Отдельная линия работы. Всё, что вы здесь меняете, не затрагивает другие ветки, пока их не объединят.';
}

/**
 * Пояснение к числу незакоммиченных изменений.
 */
function describeDirty(count) {
  var n = Number(count) || 0;
  if (n === 0) {
    return 'Чисто: всё, что было сделано, уже сохранено в историю проекта.';
  }
  return withPlural(n, 'файл', 'файла', 'файлов') + ' с несохранёнными правками. ' +
    'Это значит, что изменения существуют только на диске. Чтобы зафиксировать их в истории и иметь возможность вернуться, нужен коммит.';
}

module.exports = {
  plural: plural,
  withPlural: withPlural,
  formatDuration: formatDuration,
  formatAgo: formatAgo,
  shorten: shorten,
  explainCommand: explainCommand,
  commandLabel: commandLabel,
  toolRu: toolRu,
  mcpParts: mcpParts,
  statsLabel: statsLabel,
  statsHint: statsHint,
  humanize: humanize,
  describeBranch: describeBranch,
  describeDirty: describeDirty,
  ACTION_ICON: ACTION_ICON
};
