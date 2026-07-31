'use strict';

// Разбор вывода git. Чистые функции: на входе строка, на выходе структура.
// Ни один git не запускается — этим занимается git.js.

var humanize = require('./humanize');

// ---------------------------------------------------------------------------
// git status --porcelain
// ---------------------------------------------------------------------------

// Два символа статуса: первый — состояние в индексе («подготовлено к
// сохранению»), второй — в рабочем каталоге («изменено, но не подготовлено»).
var CODE_RU = {
  'M': 'изменён',
  'A': 'добавлен',
  'D': 'удалён',
  'R': 'переименован',
  'C': 'скопирован',
  'U': 'конфликт слияния',
  'T': 'сменил тип',
  '?': 'новый, git о нём ещё не знает',
  '!': 'игнорируется'
};

// Человеческое объяснение пары кодов — то, что показывается новичку.
function explainStatus(index, work) {
  if (index === '?' && work === '?') {
    return 'Совсем новый файл. Git его пока не отслеживает — при коммите он не сохранится, пока его не добавят.';
  }
  if (index === '!' && work === '!') {
    return 'Файл в списке игнорируемых (.gitignore). Git намеренно его не замечает.';
  }
  if (index === 'U' || work === 'U' || (index === 'A' && work === 'A') || (index === 'D' && work === 'D')) {
    return 'Конфликт: одно и то же место правили в двух ветках по-разному. Нужно выбрать вручную, какой вариант оставить.';
  }
  var parts = [];
  if (index && index !== ' ') {
    parts.push('Подготовлено к сохранению (' + (CODE_RU[index] || index) + ').');
  }
  if (work && work !== ' ') {
    parts.push('Изменено на диске и ещё не подготовлено (' + (CODE_RU[work] || work) + ').');
  }
  if (!parts.length) return 'Без изменений.';
  return parts.join(' ');
}

// Короткая метка для списка: «изменён», «новый», «удалён».
function shortStatus(index, work) {
  if (index === '?' && work === '?') return 'новый';
  if (index === '!' && work === '!') return 'игнорируется';
  if (index === 'U' || work === 'U') return 'конфликт';
  var c = (index && index !== ' ') ? index : work;
  return CODE_RU[c] || 'изменён';
}

/**
 * Разбор `git status --porcelain` (формат v1).
 * Понимает переименования («R  old -> new») и кавычки вокруг путей с
 * не-ASCII символами (git по умолчанию их экранирует).
 */
function parseStatus(output) {
  var text = String(output === undefined || output === null ? '' : output);
  // Поддерживаем и -z (разделитель \0), и обычный построчный вывод.
  var lines = text.indexOf('\x00') !== -1
    ? text.split('\x00')
    : text.split('\n');

  var entries = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line || line.length < 3) continue;
    var index = line[0];
    var work = line[1];
    var rest = line.slice(3);
    if (!rest) continue;

    var from = null;
    var to = rest;
    var arrow = rest.indexOf(' -> ');
    if (arrow !== -1 && (index === 'R' || index === 'C')) {
      from = unquotePath(rest.slice(0, arrow));
      to = rest.slice(arrow + 4);
    }

    entries.push({
      index: index,
      work: work,
      code: index + work,
      path: unquotePath(to),
      from: from,
      staged: index !== ' ' && index !== '?',
      untracked: index === '?' && work === '?',
      conflicted: index === 'U' || work === 'U',
      label: shortStatus(index, work),
      explain: explainStatus(index, work)
    });
  }
  return entries;
}

// Git оборачивает «сложные» пути в кавычки и экранирует байты как \303\251.
function unquotePath(p) {
  var s = String(p || '');
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return s;
  var inner = s.slice(1, -1);
  var bytes = [];
  for (var i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      var next = inner[i + 1];
      if (next >= '0' && next <= '7') {
        var oct = inner.substr(i + 1, 3);
        bytes.push(parseInt(oct, 8));
        i += 3;
        continue;
      }
      var esc = { n: 10, t: 9, r: 13, '"': 34, '\\': 92 };
      if (esc[next] !== undefined) {
        bytes.push(esc[next]);
        i += 1;
        continue;
      }
    }
    // Обычный символ. Если он не ASCII, git его не экранировал — значит,
    // в строке он уже в готовом виде, и его надо перевести в UTF-8 байты,
    // а не в один усечённый code unit (иначе кириллица превращается в мусор).
    var code = inner.charCodeAt(i);
    if (code < 128) {
      bytes.push(code);
    } else {
      var utf8 = Buffer.from(inner[i], 'utf8');
      for (var b = 0; b < utf8.length; b++) bytes.push(utf8[b]);
    }
  }
  try {
    return Buffer.from(bytes).toString('utf8');
  } catch (e) {
    return inner;
  }
}

// Сводка по статусу для панели.
function summarizeStatus(entries) {
  var list = entries || [];
  var summary = {
    total: list.length,
    staged: 0,
    modified: 0,
    untracked: 0,
    deleted: 0,
    conflicted: 0
  };
  list.forEach(function (e) {
    if (e.conflicted) summary.conflicted++;
    else if (e.untracked) summary.untracked++;
    else {
      if (e.staged) summary.staged++;
      if (e.index === 'D' || e.work === 'D') summary.deleted++;
      else summary.modified++;
    }
  });
  summary.explain = humanize.describeDirty(summary.total);
  return summary;
}

// ---------------------------------------------------------------------------
// git log
// ---------------------------------------------------------------------------

// Мы просим git печатать поля через \x1f (разделитель полей) и \x1e
// (разделитель записей) — так ничего не сломается на многострочных темах.
var FIELD = '\x1f';
var RECORD = '\x1e';
var LOG_FORMAT = ['%H', '%h', '%an', '%ae', '%aI', '%s', '%P'].join(FIELD) + RECORD;

function parseLog(output) {
  var text = String(output === undefined || output === null ? '' : output);
  return text.split(RECORD)
    .map(function (chunk) { return chunk.replace(/^\n+/, ''); })
    .filter(function (chunk) { return chunk.trim() !== ''; })
    .map(function (chunk) {
      var f = chunk.split(FIELD);
      var ts = Date.parse(f[4]);
      return {
        hash: f[0] || '',
        short: f[1] || '',
        author: f[2] || '',
        email: f[3] || '',
        date: f[4] || '',
        ts: isNaN(ts) ? 0 : ts,
        subject: f[5] || '',
        parents: (f[6] || '').split(' ').filter(Boolean),
        merge: (f[6] || '').split(' ').filter(Boolean).length > 1
      };
    });
}

// Человеческая подпись к коммиту для линии времени.
function describeCommit(commit) {
  if (!commit) return '';
  if (commit.merge) {
    return 'Объединение веток: сюда влили изменения из другой линии работы.';
  }
  var s = String(commit.subject || '');
  if (/^(fix|исправ)/i.test(s)) return 'Исправление: что-то работало не так и это починили.';
  if (/^(feat|добав)/i.test(s)) return 'Новая возможность: в проекте появилось что-то, чего не было.';
  if (/^(docs?|документ)/i.test(s)) return 'Правка документации: код не менялся, менялись объяснения.';
  if (/^(test|тест)/i.test(s)) return 'Работа с тестами: добавили или поправили проверки.';
  if (/^(refactor|рефактор)/i.test(s)) return 'Перестройка кода без изменения поведения: стало аккуратнее, работает так же.';
  if (/^(chore|style|формат)/i.test(s)) return 'Мелкая служебная правка: настройки, форматирование, порядок.';
  if (/^(revert|откат)/i.test(s)) return 'Откат: предыдущее изменение отменили.';
  if (/^(init|initial|первый)/i.test(s)) return 'Самое первое сохранение — с него начался проект.';
  return 'Сохранение в истории проекта.';
}

// ---------------------------------------------------------------------------
// git diff --numstat
// ---------------------------------------------------------------------------

// Формат: «добавлено<TAB>удалено<TAB>путь». Для бинарных файлов — «-<TAB>-».
function parseNumstat(output) {
  var text = String(output === undefined || output === null ? '' : output);
  var files = [];
  var totals = { added: 0, removed: 0, files: 0, binary: 0 };
  text.split('\n').forEach(function (line) {
    if (!line.trim()) return;
    var parts = line.split('\t');
    if (parts.length < 3) return;
    var binary = parts[0] === '-' || parts[1] === '-';
    var added = binary ? 0 : parseInt(parts[0], 10) || 0;
    var removed = binary ? 0 : parseInt(parts[1], 10) || 0;
    // При переименовании путь бывает вида «old => new» — берём новое имя.
    var p = unquotePath(parts.slice(2).join('\t'));
    var arrow = p.indexOf(' => ');
    if (arrow !== -1) p = p.slice(arrow + 4).replace(/[{}]/g, '');
    files.push({ path: p, added: added, removed: removed, binary: binary });
    totals.files++;
    totals.added += added;
    totals.removed += removed;
    if (binary) totals.binary++;
  });
  return { files: files, totals: totals };
}

// ---------------------------------------------------------------------------
// Разбор unified diff в вид, удобный для показа новичку
// ---------------------------------------------------------------------------

/**
 * Превращает вывод `git diff` в список кусков со строками, помеченными
 * 'add' | 'del' | 'ctx'. Служебные строки (index, --- , +++) отбрасываются:
 * новичку они ничего не говорят.
 */
function parseDiff(output) {
  var text = String(output === undefined || output === null ? '' : output);
  var files = [];
  var current = null;
  var hunk = null;
  if (!text.trim()) return files;

  text.split('\n').forEach(function (line) {
    if (line.indexOf('diff --git ') === 0) {
      current = { path: pathFromDiffHeader(line), hunks: [], binary: false };
      files.push(current);
      hunk = null;
      return;
    }
    if (!current) {
      // Дифф без заголовка (например, `git diff -- file` с одним файлом
      // всё равно печатает заголовок, но подстрахуемся).
      current = { path: '', hunks: [], binary: false };
      files.push(current);
    }
    if (line.indexOf('Binary files') === 0 || line.indexOf('GIT binary patch') === 0) {
      current.binary = true;
      return;
    }
    if (line.indexOf('@@') === 0) {
      var m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
      hunk = {
        oldStart: m ? parseInt(m[1], 10) : 0,
        newStart: m ? parseInt(m[3], 10) : 0,
        context: m ? String(m[5] || '').trim() : '',
        lines: []
      };
      current.hunks.push(hunk);
      return;
    }
    if (!hunk) return;                       // заголовочный мусор до первого @@
    if (line === '\\ No newline at end of file') return;
    var c = line[0];
    if (c === '+') hunk.lines.push({ type: 'add', text: line.slice(1) });
    else if (c === '-') hunk.lines.push({ type: 'del', text: line.slice(1) });
    else hunk.lines.push({ type: 'ctx', text: line.slice(1) });
  });

  // Считаем итоги, чтобы клиенту не пришлось.
  files.forEach(function (f) {
    var added = 0;
    var removed = 0;
    f.hunks.forEach(function (h) {
      h.lines.forEach(function (l) {
        if (l.type === 'add') added++;
        else if (l.type === 'del') removed++;
      });
    });
    f.added = added;
    f.removed = removed;
  });

  return files;
}

function pathFromDiffHeader(line) {
  // «diff --git a/path b/path» — берём вторую половину (новое имя).
  var m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
  if (m) return unquotePath(m[2]);
  return '';
}

// ---------------------------------------------------------------------------
// Прочее
// ---------------------------------------------------------------------------

// `git rev-list --left-right --count origin/x...x` -> «2\t3»
function parseAheadBehind(output) {
  var parts = String(output || '').trim().split(/\s+/);
  if (parts.length < 2) return { behind: 0, ahead: 0 };
  return {
    behind: parseInt(parts[0], 10) || 0,
    ahead: parseInt(parts[1], 10) || 0
  };
}

module.exports = {
  LOG_FORMAT: LOG_FORMAT,
  FIELD: FIELD,
  RECORD: RECORD,
  parseStatus: parseStatus,
  summarizeStatus: summarizeStatus,
  explainStatus: explainStatus,
  shortStatus: shortStatus,
  unquotePath: unquotePath,
  parseLog: parseLog,
  describeCommit: describeCommit,
  parseNumstat: parseNumstat,
  parseDiff: parseDiff,
  parseAheadBehind: parseAheadBehind
};
