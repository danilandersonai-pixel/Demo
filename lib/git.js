'use strict';

// Запуск git. ТОЛЬКО ЧТЕНИЕ.
//
// Три уровня защиты от случайной записи:
//   1. Белый список подкоманд (ALLOWED) — всё остальное отвергается кодом.
//   2. execFile с массивом аргументов, без шелла — подстановка невозможна.
//   3. Глобальные флаги --no-optional-locks и core.pager=cat: git не трогает
//      индекс ради оптимизаций и не подвешивается на пейджере.

var execFile = require('child_process').execFile;
var fs = require('fs');
var path = require('path');
var gp = require('./git-parse');

// Подкоманды, которые физически не могут изменить репозиторий.
var ALLOWED = new Set([
  'rev-parse',
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'rev-list',
  'symbolic-ref',
  'config',
  'ls-files',
  'remote',
  'version'
]);

var GLOBAL_ARGS = ['--no-optional-locks', '-c', 'core.pager=cat', '-c', 'color.ui=false'];

var DEFAULT_TIMEOUT = 8000;
var MAX_BUFFER = 12 * 1024 * 1024;   // 12 МБ: большой дифф не должен ронять вызов

/**
 * Единственная точка запуска git.
 * Возвращает промис {ok, stdout, stderr, code}. Никогда не реджектится —
 * отсутствие git и ошибка репозитория обрабатываются одинаково: ok:false.
 */
function run(cwd, args, options) {
  var opts = options || {};
  var sub = args[0];
  if (!ALLOWED.has(sub)) {
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: 'Штурман не выполняет git ' + sub + ': разрешены только читающие команды.',
      code: -1,
      forbidden: true
    });
  }
  // `git config` разрешён только на чтение — --get/--list и ничего больше.
  if (sub === 'config') {
    var writes = args.some(function (a) {
      return a === '--add' || a === '--unset' || a === '--replace-all' || a === '--edit';
    });
    var reads = args.some(function (a) {
      return a === '--get' || a === '--get-all' || a === '--list';
    });
    if (writes || !reads) {
      return Promise.resolve({
        ok: false, stdout: '', stderr: 'git config разрешён только на чтение.', code: -1, forbidden: true
      });
    }
  }

  return new Promise(function (resolve) {
    execFile('git', GLOBAL_ARGS.concat(args), {
      cwd: cwd,
      timeout: opts.timeout || DEFAULT_TIMEOUT,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        GIT_TERMINAL_PROMPT: '0',   // не зависать в ожидании пароля
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C.UTF-8'
      })
    }, function (err, stdout, stderr) {
      resolve({
        ok: !err,
        stdout: String(stdout || ''),
        stderr: String(stderr || (err ? err.message : '')),
        code: err ? (err.code === undefined ? 1 : err.code) : 0,
        missing: !!(err && err.code === 'ENOENT')
      });
    });
  });
}

/**
 * Доступен ли git и является ли папка репозиторием.
 * Возвращает {installed, isRepo, root, reason}.
 */
function probe(cwd) {
  return run(cwd, ['version']).then(function (v) {
    if (!v.ok) {
      return {
        installed: false,
        isRepo: false,
        root: null,
        reason: 'Git не установлен или недоступен в PATH. Панель будет работать без раздела «Git».'
      };
    }
    return run(cwd, ['rev-parse', '--show-toplevel']).then(function (r) {
      if (!r.ok) {
        return {
          installed: true,
          isRepo: false,
          root: null,
          version: v.stdout.trim(),
          reason: 'Эта папка не под контролем git. История изменений не ведётся: откатиться к прошлому состоянию будет нельзя.'
        };
      }
      return {
        installed: true,
        isRepo: true,
        root: r.stdout.trim(),
        version: v.stdout.trim(),
        reason: null
      };
    });
  });
}

function currentBranch(cwd) {
  return run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).then(function (r) {
    if (!r.ok) return null;
    var b = r.stdout.trim();
    return b === 'HEAD' ? 'HEAD (без ветки)' : b;
  });
}

function status(cwd) {
  return run(cwd, ['status', '--porcelain']).then(function (r) {
    if (!r.ok) return { entries: [], summary: gp.summarizeStatus([]), error: r.stderr };
    var entries = gp.parseStatus(r.stdout);
    return { entries: entries, summary: gp.summarizeStatus(entries), error: null };
  });
}

function log(cwd, limit) {
  var n = Math.max(1, Math.min(200, Number(limit) || 20));
  return run(cwd, ['log', '-n', String(n), '--pretty=format:' + gp.LOG_FORMAT]).then(function (r) {
    if (!r.ok) return [];
    return gp.parseLog(r.stdout).map(function (c) {
      c.explain = gp.describeCommit(c);
      return c;
    });
  });
}

// Статистика по незакоммиченным изменениям (рабочий каталог + индекс).
function diffStat(cwd) {
  return Promise.all([
    run(cwd, ['diff', '--numstat']),
    run(cwd, ['diff', '--numstat', '--cached'])
  ]).then(function (rs) {
    var work = gp.parseNumstat(rs[0].ok ? rs[0].stdout : '');
    var staged = gp.parseNumstat(rs[1].ok ? rs[1].stdout : '');
    return {
      work: work,
      staged: staged,
      totals: {
        added: work.totals.added + staged.totals.added,
        removed: work.totals.removed + staged.totals.removed,
        files: work.totals.files + staged.totals.files
      }
    };
  });
}

/**
 * Дифф одного файла. Сначала пробуем незакоммиченные изменения,
 * потом — подготовленные, потом — последний коммит, который его трогал.
 * Так клик по файлу почти всегда что-то показывает.
 */
function fileDiff(cwd, relPath) {
  return run(cwd, ['diff', '--', relPath]).then(function (r) {
    if (r.ok && r.stdout.trim()) return { source: 'work', diff: gp.parseDiff(r.stdout), raw: r.stdout };
    return run(cwd, ['diff', '--cached', '--', relPath]).then(function (c) {
      if (c.ok && c.stdout.trim()) return { source: 'staged', diff: gp.parseDiff(c.stdout), raw: c.stdout };
      return run(cwd, ['log', '-n', '1', '--format=%H', '--', relPath]).then(function (l) {
        var sha = l.ok ? l.stdout.trim() : '';
        if (!sha) return { source: 'none', diff: [], raw: '' };
        return run(cwd, ['show', '--format=', sha, '--', relPath]).then(function (s) {
          return {
            source: 'commit',
            sha: sha.slice(0, 7),
            diff: s.ok ? gp.parseDiff(s.stdout) : [],
            raw: s.ok ? s.stdout : ''
          };
        });
      });
    });
  });
}

// Дифф одного коммита целиком — для линии времени.
function commitDiff(cwd, sha) {
  if (!/^[0-9a-fA-F]{4,40}$/.test(String(sha || ''))) {
    return Promise.resolve({ diff: [], raw: '', error: 'Некорректный идентификатор коммита.' });
  }
  return run(cwd, ['show', '--format=', '--numstat', sha]).then(function (n) {
    return run(cwd, ['show', '--format=', sha]).then(function (s) {
      return {
        numstat: gp.parseNumstat(n.ok ? n.stdout : ''),
        diff: s.ok ? gp.parseDiff(s.stdout) : [],
        raw: s.ok ? s.stdout : '',
        error: s.ok ? null : s.stderr
      };
    });
  });
}

// Насколько локальная ветка разошлась с той, что на сервере.
function aheadBehind(cwd, branch) {
  if (!branch) return Promise.resolve(null);
  return run(cwd, ['rev-parse', '--abbrev-ref', branch + '@{upstream}']).then(function (u) {
    if (!u.ok) return null;
    var upstream = u.stdout.trim();
    return run(cwd, ['rev-list', '--left-right', '--count', upstream + '...' + branch]).then(function (r) {
      if (!r.ok) return null;
      var ab = gp.parseAheadBehind(r.stdout);
      ab.upstream = upstream;
      return ab;
    });
  });
}

/**
 * Полный снимок состояния git — то, что уходит в панель.
 */
function snapshot(cwd, options) {
  var opts = options || {};
  return probe(cwd).then(function (p) {
    if (!p.isRepo) {
      return {
        available: false,
        installed: p.installed,
        reason: p.reason,
        branch: null,
        entries: [],
        summary: gp.summarizeStatus([]),
        commits: [],
        diffStat: null,
        aheadBehind: null
      };
    }
    return currentBranch(cwd).then(function (branch) {
      return Promise.all([
        status(cwd),
        log(cwd, opts.logLimit || 20),
        diffStat(cwd),
        aheadBehind(cwd, branch)
      ]).then(function (res) {
        return {
          available: true,
          installed: true,
          reason: null,
          root: p.root,
          branch: branch,
          branchExplain: require('./humanize').describeBranch(branch),
          entries: res[0].entries,
          summary: res[0].summary,
          commits: res[1],
          diffStat: res[2],
          aheadBehind: res[3]
        };
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Кэш снимка
// ---------------------------------------------------------------------------

/**
 * Снимок git — это пять запусков процесса: probe, branch, status, log,
 * diffStat (плюс шестой на ahead/behind). Панель просила его раз в четыре
 * секунды, всегда, даже когда в репозитории ничего не менялось: девяносто
 * запусков процесса в минуту на пустом месте.
 *
 * Здесь три защиты сразу:
 *   1. **кэш по отпечатку** — если `.git` не трогали и файлы не менялись,
 *      отдаётся прошлый ответ, ни один процесс не запускается;
 *   2. **склейка параллельных вызовов** — второй вызов, пришедший пока
 *      считается первый, получает тот же промис, а не свои пять процессов;
 *   3. **пол по времени** — чаще раза в секунду не считаем в любом случае.
 *
 * Отпечаток берётся из времени правки служебных файлов git: они меняются
 * при любом коммите, переключении ветки и индексировании. Опрос двух-трёх
 * `stat` несравнимо дешевле запуска пяти процессов.
 */
var MIN_INTERVAL_MS = 1000;
var cacheByCwd = new Map();

function gitFingerprint(cwd) {
  var dir = path.join(cwd, '.git');
  var parts = [];
  ['HEAD', 'index', 'refs'].forEach(function (name) {
    try {
      var st = fs.statSync(path.join(dir, name));
      parts.push(name + ':' + st.mtimeMs + ':' + st.size);
    } catch (e) {
      parts.push(name + ':-');
    }
  });
  return parts.join('|');
}

/**
 * Снимок с кэшем.
 * @param {string} cwd
 * @param {object} options — `force: true` обходит кэш (но не склейку)
 */
function snapshotCached(cwd, options) {
  var opts = options || {};
  var entry = cacheByCwd.get(cwd);
  if (!entry) {
    entry = { value: null, at: 0, fingerprint: '', inflight: null, dirty: true };
    cacheByCwd.set(cwd, entry);
  }

  if (entry.inflight) return entry.inflight;

  var now = Date.now();
  var fp = gitFingerprint(cwd);
  var fresh = entry.value &&
    (now - entry.at) < MIN_INTERVAL_MS ||
    (entry.value && !entry.dirty && fp === entry.fingerprint && !opts.force);

  if (fresh) return Promise.resolve(entry.value);

  entry.inflight = snapshot(cwd, opts).then(function (snap) {
    entry.value = snap;
    entry.at = Date.now();
    entry.fingerprint = gitFingerprint(cwd);
    entry.dirty = false;
    entry.inflight = null;
    return snap;
  }).catch(function (e) {
    entry.inflight = null;
    throw e;
  });
  return entry.inflight;
}

/**
 * Сказать кэшу, что в рабочей папке что-то изменилось.
 * Правка файла не трогает `.git`, а на счётчик несохранённого влияет —
 * без этого сигнала панель показывала бы старое число до следующего коммита.
 */
function markDirty(cwd) {
  var entry = cacheByCwd.get(cwd);
  if (entry) entry.dirty = true;
}

module.exports = {
  ALLOWED: ALLOWED,
  MIN_INTERVAL_MS: MIN_INTERVAL_MS,
  snapshotCached: snapshotCached,
  markDirty: markDirty,
  gitFingerprint: gitFingerprint,
  run: run,
  probe: probe,
  currentBranch: currentBranch,
  status: status,
  log: log,
  diffStat: diffStat,
  fileDiff: fileDiff,
  commitDiff: commitDiff,
  aheadBehind: aheadBehind,
  snapshot: snapshot
};
