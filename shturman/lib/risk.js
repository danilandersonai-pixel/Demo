'use strict';

/**
 * Стоп-сигналы: действия, после которых что-то может не вернуться.
 *
 * Штурман ничего не запрещает и ни во что не вмешивается — он объясняет.
 * Поэтому здесь не «блокировка опасных команд», а разбор: что сейчас
 * произошло, чем это грозит и **какой командой это откатить**. Команду
 * человек копирует одним нажатием и вставляет в терминал сам.
 *
 * Правило отбора: сигнал поднимается только там, где потеря реальна и
 * необратима без действий. «git commit» ничего не ломает, «rm -rf» ломает.
 * Ложная тревога здесь дороже пропуска: если пугать по любому поводу, на
 * стоп-сигналы перестанут смотреть.
 */

var LEVEL = { warn: 'warn', danger: 'danger' };

/**
 * Команду сначала «обезвреживаем», иначе сигналы посыплются на ровном месте.
 *
 * Claude Code постоянно записывает файлы через heredoc, и внутри такого
 * текста может встретиться что угодно — включая строку «git reset --hard»
 * (например, в исходниках самого Штурмана). Тело heredoc — это данные, а
 * не команда, поэтому оно вырезается целиком.
 *
 * Потом вырезаются строки в кавычках: внутри них лежат данные — текст
 * коммита, содержимое файла, кусок чужого кода. Ровно на этом ловились
 * ложные тревоги: массив с примерами команд в тестовом скрипте выглядел
 * как сами команды.
 *
 * И только потом строка режется на отдельные команды по «;», «&&», «||»,
 * «|» и переводам строк: правило должно совпасть с началом команды, а не
 * с упоминанием где-то в аргументах.
 */
function segments(command) {
  var text = String(command);

  // Тело heredoc: от «<<MARK» до строки «MARK». Незакрытый — до конца.
  text = text.replace(/<<-?\s*(['"]?)([A-Za-z_][\w]*)\1[\s\S]*?(\n\2\s*$|\n\2\n|$)/g, ' ');

  // Кавычки. Экранированные кавычки внутри учитываем, иначе «съедим» лишнее.
  text = text.replace(/'(?:\\.|[^'\\])*'/g, ' ').replace(/"(?:\\.|[^"\\])*"/g, ' ');

  return split(text);
}

/** Те же куски, но без вырезания кавычек: нужны правилам про SQL. */
function rawSegments(command) {
  var text = String(command)
    .replace(/<<-?\s*(['"]?)([A-Za-z_][\w]*)\1[\s\S]*?(\n\2\s*$|\n\2\n|$)/g, ' ');
  return split(text);
}

function split(text) {
  return text.split(/\n|;|&&|\|\||\|/)
    .map(function (part) { return part.trim(); })
    .filter(Boolean);
}

/**
 * Правила разбираются по первому совпадению — порядок важен: сначала
 * узкие случаи, потом общие.
 */
var RULES = [
  {
    id: 'git-reset-hard',
    level: LEVEL.danger,
    test: /^git\s+reset\s+(--hard|--merge\s+--hard)/,
    title: 'Клод сбросил проект к прошлому состоянию',
    why: 'Команда git reset --hard стирает все несохранённые правки в папке. ' +
      'То, что не попало в историю, вернуть уже нельзя.',
    rollback: 'git reflog && git reset --hard HEAD@{1}',
    rollbackNote: 'Вернёт историю на шаг назад. Правки, которых не было в коммите, не вернутся.',
    term: 'reset'
  },
  {
    id: 'git-clean',
    level: LEVEL.danger,
    test: /^git\s+clean\s+(-[a-z]*f|--force)/,
    title: 'Клод удалил файлы, которых не было в истории',
    why: 'git clean удаляет всё, что git не отслеживает. Такие файлы не лежали ' +
      'в коммитах, поэтому git их вернуть не может.',
    rollback: null,
    rollbackNote: 'Откатить нечем: удалённое не было в истории проекта. Загляните в корзину.',
    term: 'untracked'
  },
  {
    id: 'git-checkout-discard',
    level: LEVEL.warn,
    test: /^git\s+(checkout|restore)\s+(--\s+|\.|--\s*\.)/,
    title: 'Клод вернул файлы к сохранённому виду',
    why: 'Правки, которые были на диске, но не попали в коммит, стёрты.',
    rollback: null,
    rollbackNote: 'Вернуть нечем: эти правки нигде не сохранялись.',
    term: 'checkout'
  },
  {
    id: 'git-push-force',
    level: LEVEL.danger,
    test: /^git\s+push\b[^\n]*(--force\b(?!-with-lease)|-f\b)/,
    title: 'Клод переписал историю на сервере',
    why: 'Принудительная отправка заменяет историю в общем репозитории. ' +
      'У тех, кто уже забрал старую версию, будет расхождение.',
    rollback: 'git reflog && git push --force-with-lease origin HEAD@{1}:<ветка>',
    rollbackNote: 'Отправит обратно предыдущее состояние. Замените <ветка> на имя своей ветки.',
    term: 'push'
  },
  {
    id: 'git-rebase',
    level: LEVEL.warn,
    test: /^git\s+rebase\b/,
    title: 'Клод переписывает историю ветки',
    why: 'Rebase переносит коммиты на новое основание. Номера коммитов меняются — ' +
      'старые ссылки на них перестают работать.',
    rollback: 'git rebase --abort',
    rollbackNote: 'Пока rebase не закончен, эта команда возвращает всё как было.',
    term: 'rebase'
  },
  {
    id: 'rm-rf',
    level: LEVEL.danger,
    test: /^rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r)\b/,
    title: 'Клод удалил папку целиком',
    why: 'rm -rf удаляет без корзины и без подтверждения.',
    rollback: 'git status && git checkout -- <путь>',
    rollbackNote: 'Сработает, если папка была в истории git. Если нет — файлы не вернуть.',
    term: 'rollback'
  },
  // Правила про «> файл» здесь нет намеренно: перенаправление есть почти в
  // каждой второй команде, и сигнал на него превратился бы в фон, который
  // перестают замечать. Перезаписанный файл всё равно виден в ленте как
  // изменение, а команда отката есть в его карточке.
  {
    id: 'drop',
    level: LEVEL.danger,
    // SQL живёт внутри кавычек, поэтому ищем его в исходной строке — но
    // только если рядом действительно клиент базы. Иначе сигнал ловил бы
    // любой скрипт, где эти слова просто упомянуты.
    raw: true,
    context: /^(psql|mysql|mariadb|sqlite3?|mongosh|clickhouse[\w-]*|pg_\w+)\b/i,
    test: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*;)/i,
    title: 'Клод удаляет данные в базе',
    why: 'Команда удаляет таблицу или её содержимое. У базы своей истории нет.',
    rollback: null,
    rollbackNote: 'Откатить можно только из резервной копии базы.',
    term: null
  },
  {
    id: 'chmod-777',
    level: LEVEL.warn,
    test: /^chmod\s+(-R\s+)?777\b/,
    title: 'Клод открыл файлы всем на запись',
    why: 'Права 777 разрешают изменять файлы любому пользователю системы.',
    rollback: 'chmod -R 755 <путь>',
    rollbackNote: 'Вернёт обычные права: владельцу — всё, остальным — чтение.',
    term: null
  },
  {
    id: 'sudo',
    level: LEVEL.warn,
    anywhere: true,
    test: /^sudo\s+/,
    title: 'Клод запросил права администратора',
    why: 'Под sudo команда может изменить систему целиком, а не только ваш проект.',
    rollback: null,
    rollbackNote: 'Отката нет — посмотрите в подробностях, что именно выполнялось.',
    term: null
  },
  {
    id: 'publish',
    level: LEVEL.warn,
    test: /^(npm\s+publish|docker\s+push)\b/,
    title: 'Клод публикует пакет наружу',
    why: 'Опубликованную версию видно всем, и удалить её обычно уже нельзя.',
    rollback: 'npm unpublish <пакет>@<версия>',
    rollbackNote: 'Работает только в первые 72 часа и только если пакетом никто не пользуется.',
    term: null
  }
];

/** Разобрать команду. Возвращает описание стоп-сигнала или null. */
function checkCommand(command) {
  if (!command || typeof command !== 'string') return null;
  var text = command.trim();
  if (!text) return null;
  var parts = segments(text);

  for (var i = 0; i < RULES.length; i++) {
    var rule = RULES[i];
    var hit;
    if (rule.raw) {
      // Правило смотрит на строку в кавычках — там живёт SQL, — но команда
      // должна начинаться с клиента базы. Иначе сигнал ловил бы любой
      // скрипт, где эти слова просто упомянуты.
      hit = rawSegments(text).some(function (p) {
        return (!rule.context || rule.context.test(p)) && rule.test.test(p);
      });
    } else if (rule.anywhere) {
      hit = parts.some(function (p) { return rule.test.test(p); });
    } else {
      hit = parts.some(function (p) {
        // Разрешаем приставки вроде «sudo » и «npx »: сама команда всё
        // равно должна стоять в начале, а не мелькать в аргументах.
        var head = p.replace(/^(sudo|env\s+\w+=\S+|npx|time|nice)\s+/i, '');
        return rule.test.test(head);
      });
    }
    if (!hit) continue;
    return {
      id: rule.id,
      level: rule.level,
      title: rule.title,
      why: rule.why,
      rollback: rule.rollback,
      rollbackNote: rule.rollbackNote,
      term: rule.term,
      command: text.length > 400 ? text.slice(0, 400) + '…' : text
    };
  }
  return null;
}

/**
 * Разобрать событие ленты. Смотрим только на то, что действительно
 * запускалось или удалялось: домыслы тут не нужны.
 */
function check(ev) {
  if (!ev) return null;

  // Запущенная команда.
  if (ev.kind === 'tool' && ev.action === 'run' && ev.command) {
    return checkCommand(ev.command);
  }

  // Файл исчез с диска — про это стоит сказать, даже если команду мы не видели.
  if (ev.kind === 'file' && ev.action === 'deleted' && ev.file) {
    return {
      id: 'file-deleted',
      level: LEVEL.warn,
      title: 'Файл удалён: ' + ev.file,
      why: 'Файла больше нет на диске.',
      rollback: 'git checkout -- ' + ev.file,
      rollbackNote: 'Вернёт файл, если он был сохранён в истории проекта.',
      term: 'rollback',
      command: null
    };
  }

  return null;
}

/** Команда, возвращающая один файл к последнему сохранению. */
function rollbackForFile(file) {
  if (!file) return null;
  return {
    rollback: 'git checkout -- ' + file,
    rollbackNote: 'Вернёт файл к последнему коммиту. Несохранённые правки в нём пропадут.'
  };
}

module.exports = {
  LEVEL: LEVEL,
  RULES: RULES,
  segments: segments,
  rawSegments: rawSegments,
  check: check,
  checkCommand: checkCommand,
  rollbackForFile: rollbackForFile
};
