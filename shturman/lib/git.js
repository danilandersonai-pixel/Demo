'use strict';

var execFile = require('child_process').execFile;

/**
 * Git только для чтения. Все вызовы идут через execFile (без shell),
 * список команд фиксирован — приложение физически не может ничего изменить
 * в репозитории пользователя.
 */

var READONLY = ['rev-parse', 'status', 'log', 'diff', 'branch', 'show'];

function runGit(args, cwd) {
  return new Promise(function (resolve) {
    if (READONLY.indexOf(args[0]) === -1) {
      resolve({ ok: false, stdout: '', stderr: 'команда не из белого списка: ' + args[0] });
      return;
    }
    execFile('git', args, { cwd: cwd, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      function (err, stdout, stderr) {
        resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', code: err ? err.code : 0 });
      });
  });
}

/* ------------------------------------------------------------------ */
/* Чистые парсеры (покрыты тестами, git для них не нужен)              */
/* ------------------------------------------------------------------ */

/** Расшифровка двухбуквенных кодов `git status --porcelain` по-русски. */
var STATUS_WORDS = {
  'M': 'изменён',
  'A': 'добавлен',
  'D': 'удалён',
  'R': 'переименован',
  'C': 'скопирован',
  'U': 'конфликт',
  'T': 'сменился тип',
  '?': 'новый, git его ещё не знает'
};

/**
 * Разбор `git status --porcelain` (v1).
 * Возвращает { entries, staged, unstaged, untracked, conflicts, total }.
 */
function parseStatus(text) {
  var entries = [];
  var staged = 0, unstaged = 0, untracked = 0, conflicts = 0;
  var lines = String(text || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line || line.length < 4) continue;
    var x = line[0];
    var y = line[1];
    var rest = line.slice(3);
    var renamedFrom = null;
    var arrow = rest.indexOf(' -> ');
    if (arrow !== -1) {
      renamedFrom = unquote(rest.slice(0, arrow));
      rest = rest.slice(arrow + 4);
    }
    var file = unquote(rest);
    var isUntracked = (x === '?' && y === '?');
    var isConflict = (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D'));
    if (isUntracked) untracked++;
    else if (isConflict) conflicts++;
    else {
      if (x !== ' ' && x !== '?') staged++;
      if (y !== ' ' && y !== '?') unstaged++;
    }
    entries.push({
      x: x,
      y: y,
      file: file,
      renamedFrom: renamedFrom,
      untracked: isUntracked,
      conflict: isConflict,
      human: humanStatusEntry(x, y, isUntracked, isConflict)
    });
  }
  return {
    entries: entries,
    staged: staged,
    unstaged: unstaged,
    untracked: untracked,
    conflicts: conflicts,
    total: entries.length
  };
}

function unquote(s) {
  // git берёт в кавычки пути с пробелами/не-ASCII: "a b.txt"
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try {
      return JSON.parse(s);
    } catch (e) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function humanStatusEntry(x, y, isUntracked, isConflict) {
  if (isUntracked) return 'новый файл, git его ещё не отслеживает';
  if (isConflict) return 'конфликт слияния — файл ждёт ручного решения';
  var parts = [];
  if (x !== ' ' && STATUS_WORDS[x]) parts.push(STATUS_WORDS[x] + ' (подготовлен к коммиту)');
  if (y !== ' ' && STATUS_WORDS[y]) parts.push(STATUS_WORDS[y] + ' (ещё не подготовлен)');
  return parts.join(', ') || 'изменён';
}

var LOG_FIELD = String.fromCharCode(31);
var LOG_RECORD = String.fromCharCode(30);

/** Формат для `git log --pretty=…`, парный к parseLog. */
var LOG_FORMAT = '%H' + LOG_FIELD + '%h' + LOG_FIELD + '%an' + LOG_FIELD + '%aI' + LOG_FIELD + '%s' + LOG_RECORD;

/** Разбор вывода git log с LOG_FORMAT → [{hash, short, author, date, subject}] */
function parseLog(text) {
  var commits = [];
  var records = String(text || '').split(LOG_RECORD);
  for (var i = 0; i < records.length; i++) {
    var rec = records[i].replace(/^\s+/, '');
    if (!rec) continue;
    var f = rec.split(LOG_FIELD);
    if (f.length < 5) continue;
    commits.push({ hash: f[0], short: f[1], author: f[2], date: f[3], subject: f[4] });
  }
  return commits;
}

/** Разбор `git diff --numstat` → [{added, removed, file}] (бинарные — null). */
function parseNumstat(text) {
  var rows = [];
  var lines = String(text || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var m = line.split('\t');
    if (m.length < 3) continue;
    var added = m[0] === '-' ? null : parseInt(m[0], 10);
    var removed = m[1] === '-' ? null : parseInt(m[1], 10);
    var file = m.slice(2).join('\t');
    // переименования приходят как "old => new" или "{a => b}/c"
    rows.push({ added: added, removed: removed, file: file, binary: added === null });
  }
  return rows;
}

/**
 * Упрощение unified diff для новичка: массив строк
 * {kind: 'add'|'del'|'ctx'|'hunk'|'meta', text}.
 * Технические заголовки (index, ---/+++) прячем в meta.
 */
function simplifyDiff(text) {
  var out = [];
  var lines = String(text || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf('diff --git') === 0 || line.indexOf('index ') === 0 ||
        line.indexOf('--- ') === 0 || line.indexOf('+++ ') === 0 ||
        line.indexOf('new file mode') === 0 || line.indexOf('deleted file mode') === 0 ||
        line.indexOf('similarity index') === 0 || line.indexOf('rename ') === 0) {
      out.push({ kind: 'meta', text: line });
    } else if (line.indexOf('@@') === 0) {
      out.push({ kind: 'hunk', text: humanHunkHeader(line) });
    } else if (line[0] === '+') {
      out.push({ kind: 'add', text: line.slice(1) });
    } else if (line[0] === '-') {
      out.push({ kind: 'del', text: line.slice(1) });
    } else if (line[0] === '\\') {
      out.push({ kind: 'meta', text: line });
    } else {
      out.push({ kind: 'ctx', text: line.slice(1) });
    }
  }
  // хвостовую пустую ctx-строку от split('\n') убираем
  if (out.length && out[out.length - 1].kind === 'ctx' && out[out.length - 1].text === '') out.pop();
  return out;
}

/** "@@ -12,5 +12,8 @@ function foo" → "…строка 12 (function foo)" */
function humanHunkHeader(line) {
  var m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/);
  if (!m) return line;
  var where = 'со строки ' + m[1];
  return m[2] ? where + ' · ' + m[2] : where;
}

/** Смысл ветки одной строкой — по имени. */
function describeBranch(name) {
  if (!name) return 'Ветка не определена — возможно, репозиторий пуст или состояние «detached HEAD».';
  if (name === 'main' || name === 'master') {
    return 'Главная ветка проекта: сюда попадает проверенная, «официальная» версия кода.';
  }
  if (name === 'develop' || name === 'dev') {
    return 'Ветка разработки: здесь собирают изменения перед выпуском в главную ветку.';
  }
  if (/^(claude|ai)\//.test(name)) {
    return 'Рабочая ветка Клода: черновик изменений, который не трогает основной код, пока его не вольют.';
  }
  if (/^(feature|feat)\//.test(name)) {
    return 'Ветка новой функции: отдельная «песочница» для одной задачи.';
  }
  if (/^(fix|bugfix|hotfix)\//.test(name)) {
    return 'Ветка исправления: здесь чинят конкретную ошибку, не мешая остальному.';
  }
  if (/^release\//.test(name)) {
    return 'Ветка выпуска: подготовка версии к публикации.';
  }
  return 'Отдельная ветка «' + name + '»: изменения здесь не трогают основной код, пока их не вольют (merge).';
}

/* ------------------------------------------------------------------ */
/* Сборщик состояния git для сервера                                   */
/* ------------------------------------------------------------------ */

function collectGitInfo(projectRoot) {
  var info = {
    available: false,
    isRepo: false,
    branch: null,
    branchMeaning: null,
    status: null,
    commits: [],
    diffstat: [],
    error: null
  };
  return runGit(['rev-parse', '--is-inside-work-tree'], projectRoot).then(function (r) {
    if (!r.ok) {
      // git есть, но это не репозиторий? или git вообще не установлен?
      if (/not a git repository/i.test(r.stderr)) {
        info.available = true;
        info.isRepo = false;
      } else if (r.stderr.indexOf('ENOENT') !== -1 || /not found/i.test(r.stderr)) {
        info.available = false;
      } else {
        info.available = true;
        info.error = r.stderr.trim();
      }
      return info;
    }
    info.available = true;
    info.isRepo = true;
    return Promise.all([
      runGit(['branch', '--show-current'], projectRoot),
      runGit(['status', '--porcelain'], projectRoot),
      runGit(['log', '-20', '--pretty=' + LOG_FORMAT], projectRoot),
      runGit(['diff', '--numstat'], projectRoot)
    ]).then(function (rs) {
      info.branch = rs[0].ok ? rs[0].stdout.trim() : null;
      info.branchMeaning = describeBranch(info.branch);
      info.status = parseStatus(rs[1].ok ? rs[1].stdout : '');
      info.commits = parseLog(rs[2].ok ? rs[2].stdout : '');
      info.diffstat = parseNumstat(rs[3].ok ? rs[3].stdout : '');
      return info;
    });
  }).catch(function (e) {
    info.available = false;
    info.error = String(e && e.message || e);
    return info;
  });
}

/** Дифф одного файла (рабочая копия против HEAD), упрощённый. */
function fileDiff(projectRoot, relFile) {
  return runGit(['diff', 'HEAD', '--', relFile], projectRoot).then(function (r) {
    if (r.ok && r.stdout.trim()) return { source: 'worktree', lines: simplifyDiff(r.stdout) };
    // ничего в рабочей копии — покажем последний коммит, трогавший файл
    return runGit(['log', '-1', '--pretty=%H', '--', relFile], projectRoot).then(function (l) {
      var hash = l.ok ? l.stdout.trim() : '';
      if (!hash) return { source: 'none', lines: [] };
      return runGit(['show', hash, '--', relFile], projectRoot).then(function (s) {
        return { source: 'last-commit', hash: hash, lines: s.ok ? simplifyDiff(stripCommitHeader(s.stdout)) : [] };
      });
    });
  });
}

function stripCommitHeader(showOutput) {
  var idx = showOutput.indexOf('diff --git');
  return idx === -1 ? showOutput : showOutput.slice(idx);
}

/** Дифф целого коммита для линии времени. */
function commitDiff(projectRoot, hash) {
  if (!/^[0-9a-f]{4,40}$/i.test(String(hash))) {
    return Promise.resolve({ lines: [], numstat: [] });
  }
  return Promise.all([
    runGit(['show', hash, '--numstat', '--pretty='], projectRoot),
    runGit(['show', hash, '--pretty=%an%n%aI%n%s'], projectRoot)
  ]).then(function (rs) {
    return {
      numstat: parseNumstat(rs[0].ok ? rs[0].stdout : ''),
      lines: rs[1].ok ? simplifyDiff(stripCommitHeader(rs[1].stdout)).slice(0, 800) : []
    };
  });
}

module.exports = {
  runGit: runGit,
  parseStatus: parseStatus,
  parseLog: parseLog,
  parseNumstat: parseNumstat,
  simplifyDiff: simplifyDiff,
  humanHunkHeader: humanHunkHeader,
  describeBranch: describeBranch,
  collectGitInfo: collectGitInfo,
  fileDiff: fileDiff,
  commitDiff: commitDiff,
  LOG_FORMAT: LOG_FORMAT
};
