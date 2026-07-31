'use strict';

// Поиск и «хвостение» транскриптов Claude Code.
// Здесь весь ввод-вывод; разбор содержимого — в transcript-parse.js.

var fs = require('fs');
var path = require('path');
var events = require('events');
var paths = require('./paths');
var tp = require('./transcript-parse');

var POLL_MS = 600;          // как часто проверять, вырос ли файл
var DIR_POLL_MS = 3000;     // как часто искать более свежую сессию

// ---------------------------------------------------------------------------
// Где лежит транскрипт этого проекта
// ---------------------------------------------------------------------------

/**
 * Находит каталог транскриптов для проекта.
 * Сначала — по кодированному имени (быстро и точно в 99% случаев),
 * затем — перебором всех каталогов со сверкой поля cwd внутри JSONL
 * (спасает, когда версия Claude Code кодирует путь иначе).
 */
function findProjectDir(projectRoot) {
  var base = paths.claudeProjectsDir();
  var encoded = path.join(base, paths.encodeProjectDir(projectRoot));

  return fs.promises.stat(encoded).then(function (st) {
    if (st.isDirectory()) return { dir: encoded, how: 'encoded' };
    return scanForProject(base, projectRoot);
  }).catch(function () {
    return scanForProject(base, projectRoot);
  });
}

// Перебор: читаем первую строку самого свежего файла в каждом каталоге и
// сравниваем cwd с искомым проектом.
function scanForProject(base, projectRoot) {
  var target = path.resolve(projectRoot);
  return fs.promises.readdir(base, { withFileTypes: true }).then(function (entries) {
    var dirs = entries.filter(function (e) { return e.isDirectory(); })
      .map(function (e) { return path.join(base, e.name); });

    var chain = Promise.resolve(null);
    dirs.forEach(function (dir) {
      chain = chain.then(function (found) {
        if (found) return found;
        return newestSession(dir).then(function (file) {
          if (!file) return null;
          return readFirstRecord(file.path).then(function (rec) {
            if (!rec) return null;
            var cwd = rec.cwd;
            if (!cwd) return null;
            if (path.resolve(cwd) === target) return { dir: dir, how: 'cwd-scan' };
            return null;
          });
        }).catch(function () { return null; });
      });
    });
    return chain;
  }).catch(function () {
    return null;
  });
}

// Первая осмысленная запись файла — читаем только начало, не весь файл.
function readFirstRecord(file) {
  return readHead(file, 64 * 1024).then(function (head) {
    var lines = head.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var rec = tp.parseLine(lines[i]);
      if (rec && rec.cwd) return rec;
      if (rec && i > 5) return rec;   // cwd бывает не в самой первой строке
    }
    return null;
  }).catch(function () { return null; });
}

function readHead(file, bytes) {
  return fs.promises.open(file, 'r').then(function (fh) {
    var buf = Buffer.alloc(bytes);
    return fh.read(buf, 0, bytes, 0).then(function (r) {
      return fh.close().then(function () {
        return buf.slice(0, r.bytesRead).toString('utf8');
      });
    }).catch(function (e) {
      return fh.close().then(function () { throw e; });
    });
  });
}

// Хвост файла — для быстрого чтения последней записи без загрузки целиком.
function readTail(file, bytes) {
  return fs.promises.stat(file).then(function (st) {
    var size = st.size;
    var len = Math.min(bytes, size);
    var start = size - len;
    return fs.promises.open(file, 'r').then(function (fh) {
      var buf = Buffer.alloc(len);
      return fh.read(buf, 0, len, start).then(function (r) {
        return fh.close().then(function () {
          return buf.slice(0, r.bytesRead).toString('utf8');
        });
      }).catch(function (e) {
        return fh.close().then(function () { throw e; });
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Список сессий
// ---------------------------------------------------------------------------

// Только .jsonl; служебные .ccr-tip.json и прочее отбрасываем.
function listSessionFiles(dir) {
  if (!dir) return Promise.resolve([]);
  return fs.promises.readdir(dir).then(function (names) {
    var files = names.filter(function (n) { return /\.jsonl$/i.test(n); });
    return Promise.all(files.map(function (n) {
      var p = path.join(dir, n);
      return fs.promises.stat(p).then(function (st) {
        return { path: p, name: n, id: n.replace(/\.jsonl$/i, ''), size: st.size, mtime: st.mtimeMs };
      }).catch(function () { return null; });
    })).then(function (list) {
      return list.filter(Boolean).sort(function (a, b) { return b.mtime - a.mtime; });
    });
  }).catch(function () { return []; });
}

function newestSession(dir) {
  return listSessionFiles(dir).then(function (list) { return list[0] || null; });
}

/**
 * Карточки сессий для журнала: начало, конец, первый промпт, размер.
 * Читаем только голову и хвост каждого файла — журнал на 50 сессий не должен
 * поднимать в память сотни мегабайт.
 */
function describeSessions(dir, limit) {
  return listSessionFiles(dir).then(function (files) {
    var take = files.slice(0, limit || 40);
    return Promise.all(take.map(function (f) {
      return Promise.all([
        readHead(f.path, 96 * 1024).catch(function () { return ''; }),
        readTail(f.path, 32 * 1024).catch(function () { return ''; })
      ]).then(function (parts) {
        var headLines = parts[0].split('\n');
        var tailLines = parts[1].split('\n');

        var firstTs = 0;
        var firstPrompt = '';
        var branch = null;
        for (var i = 0; i < headLines.length; i++) {
          var rec = tp.parseLine(headLines[i]);
          if (!rec) continue;
          if (!firstTs) firstTs = tp.tsOf(rec);
          if (!branch && rec.gitBranch) branch = rec.gitBranch;
          if (!firstPrompt) {
            var p = tp.humanPrompt(rec);
            if (p && p.trim()) firstPrompt = p.trim();
          }
          if (firstPrompt && branch && firstTs) break;
        }

        var lastTs = 0;
        for (var j = tailLines.length - 1; j >= 0; j--) {
          var r2 = tp.parseLine(tailLines[j]);
          if (r2 && tp.tsOf(r2)) { lastTs = tp.tsOf(r2); break; }
        }

        return {
          id: f.id,
          file: f.path,
          size: f.size,
          mtime: f.mtime,
          startedAt: firstTs || f.mtime,
          endedAt: lastTs || f.mtime,
          durationMs: (lastTs && firstTs) ? Math.max(0, lastTs - firstTs) : 0,
          branch: branch,
          firstPrompt: firstPrompt.slice(0, 300)
        };
      });
    }));
  });
}

/**
 * Полный разбор одной сессии — для просмотра архива.
 * Отдаёт готовые события, как если бы они пришли живьём.
 */
function readSession(file, options) {
  var opts = options || {};
  return fs.promises.readFile(file, 'utf8').then(function (text) {
    var parser = tp.createParser({ projectRoot: opts.projectRoot });
    var out = [];
    text.split('\n').forEach(function (line) {
      var rec = tp.parseLine(line);
      if (!rec) return;
      parser.push(rec).forEach(function (ev) { out.push(ev); });
    });
    return {
      events: out,
      tokens: parser.tokens(),
      counters: parser.counters()
    };
  });
}

// ---------------------------------------------------------------------------
// Хвостение живого транскрипта
// ---------------------------------------------------------------------------

/**
 * Следит за каталогом проекта: читает прирост активного файла и отдаёт
 * события через EventEmitter.
 *
 *   'record'  — сырая запись JSONL
 *   'events'  — массив нормализованных событий
 *   'session' — сменился активный файл сессии
 *   'quiet'   — прошёл тик, новых записей нет (для детектора остановки)
 *   'level'   — доступность транскриптов изменилась (A <-> B)
 *
 * Опрос, а не fs.watch: файл дописывается в конец, нам нужен размер и смещение,
 * а не факт события. Опрос надёжнее одинаково на всех трёх ОС.
 */
function createTailer(projectRoot, options) {
  var opts = options || {};
  var emitter = new events.EventEmitter();
  var pollMs = opts.poll || POLL_MS;
  var dirPollMs = opts.dirPoll || DIR_POLL_MS;

  var dir = null;
  var activeFile = null;
  var offset = 0;
  var rest = '';
  var parser = tp.createParser({ projectRoot: projectRoot });
  var lastRecordTs = 0;
  var lastGrowthAt = 0;
  var level = 'B';
  var timer = null;
  var dirTimer = null;
  var stopped = false;
  var reading = false;

  function setLevel(next, reason) {
    if (level === next) return;
    level = next;
    emitter.emit('level', { level: level, reason: reason, dir: dir, file: activeFile });
  }

  // Переключение на новый (или первый) файл сессии.
  function switchTo(file, opts2) {
    var fromStart = opts2 && opts2.fromStart;
    activeFile = file.path;
    rest = '';
    parser = tp.createParser({ projectRoot: projectRoot });
    // По умолчанию читаем с начала — новичку полезно увидеть, что уже было.
    // Флагом --tail-only можно начать с конца.
    offset = fromStart ? 0 : file.size;
    lastGrowthAt = Date.now();
    emitter.emit('session', {
      id: file.id,
      file: file.path,
      size: file.size,
      fromStart: !!fromStart
    });
    setLevel('A', 'Транскрипт найден');
  }

  function pickSession() {
    if (!dir || stopped) return Promise.resolve();
    return newestSession(dir).then(function (f) {
      if (!f || stopped) return;
      if (activeFile !== f.path) {
        switchTo(f, { fromStart: opts.fromStart !== false });
      }
    });
  }

  // Дочитываем прирост файла.
  function pump() {
    if (!activeFile || stopped || reading) return Promise.resolve();
    reading = true;
    return fs.promises.stat(activeFile).then(function (st) {
      // Файл усох — его пересоздали. Читаем заново с нуля.
      if (st.size < offset) {
        offset = 0;
        rest = '';
        parser = tp.createParser({ projectRoot: projectRoot });
      }
      if (st.size === offset) {
        emitter.emit('quiet', {
          quietMs: Date.now() - (lastGrowthAt || Date.now()),
          lastRecordTs: lastRecordTs
        });
        return;
      }
      var length = st.size - offset;
      return fs.promises.open(activeFile, 'r').then(function (fh) {
        var buf = Buffer.alloc(length);
        return fh.read(buf, 0, length, offset).then(function (r) {
          return fh.close().then(function () {
            offset += r.bytesRead;
            lastGrowthAt = Date.now();
            var parsed = tp.parseChunk(rest + buf.slice(0, r.bytesRead).toString('utf8'));
            rest = parsed.rest;
            var all = [];
            parsed.records.forEach(function (rec) {
              emitter.emit('record', rec);
              var ts = tp.tsOf(rec);
              if (ts > lastRecordTs) lastRecordTs = ts;
              parser.push(rec).forEach(function (ev) { all.push(ev); });
            });
            if (all.length) emitter.emit('events', all);
          });
        }).catch(function (e) {
          return fh.close().then(function () { throw e; });
        });
      });
    }).catch(function () {
      // Файл унесли прямо из-под нас — на следующем тике найдём новый.
      activeFile = null;
    }).then(function () {
      reading = false;
    });
  }

  return {
    events: emitter,

    start: function () {
      return findProjectDir(projectRoot).then(function (found) {
        if (stopped) return { level: 'B' };
        if (found && found.dir) {
          dir = found.dir;
          return pickSession().then(function () {
            if (!activeFile) {
              setLevel('B', 'Каталог транскриптов есть, но сессий в нём пока нет');
            }
            return { level: level, dir: dir, how: found.how };
          });
        }
        setLevel('B', 'Каталог транскриптов Claude Code для этого проекта не найден');
        return { level: 'B', dir: null };
      }).then(function (res) {
        if (stopped) return res;
        timer = setInterval(function () { pump(); }, pollMs);
        if (timer.unref) timer.unref();
        // Отдельный, более редкий таймер: вдруг Клод стартовал новую сессию
        // или транскрипты появились только что.
        dirTimer = setInterval(function () {
          if (stopped) return;
          if (!dir) {
            findProjectDir(projectRoot).then(function (f) {
              if (f && f.dir && !stopped) {
                dir = f.dir;
                pickSession();
              }
            });
            return;
          }
          pickSession();
        }, dirPollMs);
        if (dirTimer.unref) dirTimer.unref();
        return res;
      });
    },

    stop: function () {
      stopped = true;
      if (timer) clearInterval(timer);
      if (dirTimer) clearInterval(dirTimer);
      timer = null;
      dirTimer = null;
    },

    level: function () { return level; },
    dir: function () { return dir; },
    activeFile: function () { return activeFile; },
    lastRecordTs: function () { return lastRecordTs; },
    lastGrowthAt: function () { return lastGrowthAt; },
    tokens: function () { return parser.tokens(); },
    counters: function () { return parser.counters(); },
    lastAssistantText: function () { return parser.lastAssistantText(); }
  };
}

module.exports = {
  findProjectDir: findProjectDir,
  scanForProject: scanForProject,
  listSessionFiles: listSessionFiles,
  newestSession: newestSession,
  describeSessions: describeSessions,
  readSession: readSession,
  readHead: readHead,
  readTail: readTail,
  createTailer: createTailer,
  POLL_MS: POLL_MS
};
