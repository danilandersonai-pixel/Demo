'use strict';

/**
 * Индекс прошлых сессий.
 *
 * Журнал сессий строился так: для каждого из сорока файлов читалось 96 КБ
 * начала и 32 КБ конца, и всё это разбиралось заново — на каждый запрос,
 * а панель просит журнал раз в минуту. Пять мегабайт чтения с диска в
 * минуту ради списка, который меняется только когда появляется новая
 * сессия.
 *
 * Здесь описания складываются в индекс и переиспользуются, пока файл не
 * изменился. Ключ — путь, время правки и размер: этого достаточно, чтобы
 * заметить и дозапись, и подмену файла. Индекс живёт в домашнем каталоге,
 * а не в проекте: обещание «ничего не писать в чужую папку» действует и
 * здесь.
 *
 * Потеря индекса ничего не ломает — он просто соберётся заново.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

var FILE_NAME = '.shturman-sessions.json';
var MAX_ENTRIES = 400;      // сорок сессий на десяток проектов — с запасом

function indexPath(dir) {
  return path.join(dir || os.homedir(), FILE_NAME);
}

function keyOf(file) {
  return file.path + '|' + Math.round(file.mtimeMs || 0) + '|' + (file.size || 0);
}

/** Прочитать индекс. Битый или чужой файл — просто пустой индекс. */
function load(dir) {
  try {
    var raw = JSON.parse(fs.readFileSync(indexPath(dir), 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.entries) return { entries: {} };
    return { entries: raw.entries };
  } catch (e) {
    return { entries: {} };
  }
}

/** Записать индекс атомарно: обрезанный JSON хуже отсутствующего. */
function save(index, dir) {
  var file = indexPath(dir);
  var tmp = file + '.tmp';
  // Не даём индексу расти вечно: держим самые свежие записи.
  var keys = Object.keys(index.entries);
  if (keys.length > MAX_ENTRIES) {
    keys.sort(function (a, b) {
      return (index.entries[b].savedAt || 0) - (index.entries[a].savedAt || 0);
    });
    var trimmed = {};
    keys.slice(0, MAX_ENTRIES).forEach(function (k) { trimmed[k] = index.entries[k]; });
    index.entries = trimmed;
  }
  try {
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: index.entries }), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) { /* и не создался */ }
    return false;                       // не записалось — работаем без индекса
  }
}

/**
 * Описать сессии, читая с диска только то, чего ещё нет в индексе.
 *
 * @param {object} deps — { listSessionFiles, describeOne } из transcript.js
 * @param {string} dir  — каталог транскриптов
 * @param {number} limit
 * @param {string} [home] — куда класть индекс (для тестов)
 * @returns {Promise<{sessions: Array, fromIndex: number, read: number}>}
 */
function describe(deps, dir, limit, home) {
  return deps.listSessionFiles(dir).then(function (files) {
    var take = files.slice(0, limit || 40);
    var index = load(home);
    var fromIndex = 0;
    var read = 0;
    var dirty = false;

    return Promise.all(take.map(function (f) {
      var key = keyOf(f);
      var hit = index.entries[key];
      if (hit && hit.value) {
        fromIndex++;
        return hit.value;
      }
      read++;
      return deps.describeOne(f).then(function (value) {
        index.entries[key] = { value: value, savedAt: Date.now() };
        dirty = true;
        return value;
      });
    })).then(function (sessions) {
      if (dirty) save(index, home);
      return { sessions: sessions, fromIndex: fromIndex, read: read };
    });
  });
}

/** Забыть всё: нужно, если формат описания изменился. */
function clear(home) {
  try { fs.unlinkSync(indexPath(home)); return true; } catch (e) { return false; }
}

module.exports = {
  FILE_NAME: FILE_NAME,
  MAX_ENTRIES: MAX_ENTRIES,
  indexPath: indexPath,
  keyOf: keyOf,
  load: load,
  save: save,
  describe: describe,
  clear: clear
};
