'use strict';

// Наблюдение за файловой системой проекта.
//
// Зависимостей нет: Node ≥ 18 умеет fs.watch(dir, {recursive:true}) на
// Windows и macOS, Node ≥ 20 — и на Linux. Если рекурсивный режим недоступен
// (сетевой диск, экзотическая ФС), молча переходим на периодическое
// пересканирование — снаружи разницы не видно.

var fs = require('fs');
var path = require('path');
var events = require('events');
var paths = require('./paths');
var ignore = require('./ignore');
var debounceLib = require('./debounce');

var DEFAULT_DEBOUNCE = 220;    // мс: одно сохранение файла даёт 3-5 сырых событий
var DEFAULT_POLL = 3000;       // мс: как часто пересканировать в резервном режиме

/**
 * Создаёт вотчер. Событие 'change' приходит уже дебаунснутым, по одному
 * на файл: {action:'added'|'changed'|'removed'|'dir-added'|'dir-removed',
 *           file:'rel/path', ts, size, mtime}.
 * Событие 'mode' — смена режима наблюдения (native/poll).
 */
function createWatcher(projectRoot, options) {
  var opts = options || {};
  var root = path.resolve(projectRoot);
  var debounceMs = opts.debounce === undefined ? DEFAULT_DEBOUNCE : opts.debounce;
  var pollMs = opts.poll || DEFAULT_POLL;
  var emitter = new events.EventEmitter();

  var known = new Map();       // rel -> {size, mtime, dir}
  var nativeWatcher = null;
  var pollTimer = null;
  var mode = 'starting';
  var stopped = false;

  // На каждый файл свой таймер: сохранение a.js не должно откладывать b.js.
  var emitDebounced = debounceLib.debounceByKey(function (rel) {
    if (stopped) return;
    inspect(rel);
  }, debounceMs);

  // Проверяем, что стало с файлом, и сравниваем с тем, что помним.
  function inspect(rel) {
    var abs = path.join(root, rel);
    fs.stat(abs, function (err, st) {
      if (stopped) return;
      var prev = known.get(rel);
      if (err) {
        if (prev) {
          known.delete(rel);
          emit(prev.dir ? 'dir-removed' : 'removed', rel, null);
        }
        return;
      }
      if (st.isDirectory()) {
        if (!prev) {
          known.set(rel, { size: 0, mtime: st.mtimeMs, dir: true });
          emit('dir-added', rel, st);
        }
        return;
      }
      if (!prev) {
        known.set(rel, { size: st.size, mtime: st.mtimeMs, dir: false });
        emit('added', rel, st);
        return;
      }
      // Одинаковый размер и время — это «касание», а не правка. Молчим.
      if (prev.size === st.size && prev.mtime === st.mtimeMs) return;
      known.set(rel, { size: st.size, mtime: st.mtimeMs, dir: false });
      emit('changed', rel, st);
    });
  }

  function emit(action, rel, st) {
    emitter.emit('change', {
      action: action,
      file: rel,
      ts: Date.now(),
      size: st ? st.size : 0,
      mtime: st ? st.mtimeMs : 0
    });
  }

  // Первичная опись: наполняем known, ничего не эмитим. Иначе на старте
  // в ленту выпадет весь проект.
  function primeIndex() {
    return require('./tree').scan(root, opts.scan).then(function (res) {
      res.nodes.forEach(function (n) {
        known.set(n.path, { size: n.size, mtime: n.mtime, dir: n.type === 'dir' });
      });
      return res;
    });
  }

  // --- режим 1: нативный рекурсивный fs.watch ------------------------------
  function startNative() {
    try {
      nativeWatcher = fs.watch(root, { recursive: true, persistent: true }, function (evType, filename) {
        if (stopped || !filename) return;
        var rel = paths.toPosix(filename);
        if (!rel || ignore.isIgnored(rel)) return;
        emitDebounced(rel);
      });
      nativeWatcher.on('error', function () {
        // Нативный вотчер сдался на ходу — не теряем наблюдение, падаем в опрос.
        try { nativeWatcher.close(); } catch (e) { /* уже закрыт */ }
        nativeWatcher = null;
        if (!stopped) startPolling('Нативное наблюдение оборвалось');
      });
      mode = 'native';
      emitter.emit('mode', { mode: mode, reason: null });
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- режим 2: периодическое пересканирование -----------------------------
  function startPolling(reason) {
    if (pollTimer) return;
    mode = 'poll';
    emitter.emit('mode', {
      mode: mode,
      reason: (reason || 'Рекурсивное наблюдение недоступно') +
        '. Штурман пересматривает папку каждые ' + Math.round(pollMs / 1000) + ' с — изменения появятся с небольшой задержкой.'
    });
    pollTimer = setInterval(function () {
      if (stopped) return;
      rescan();
    }, pollMs);
    if (pollTimer.unref) pollTimer.unref();
  }

  // Полное сравнение снимка с тем, что помним. Дорого, но только в резерве.
  function rescan() {
    require('./tree').scan(root, opts.scan).then(function (res) {
      if (stopped) return;
      var seen = new Set();
      res.nodes.forEach(function (n) {
        seen.add(n.path);
        var prev = known.get(n.path);
        if (!prev) {
          known.set(n.path, { size: n.size, mtime: n.mtime, dir: n.type === 'dir' });
          emit(n.type === 'dir' ? 'dir-added' : 'added', n.path, { size: n.size, mtimeMs: n.mtime });
          return;
        }
        if (n.type !== 'dir' && (prev.size !== n.size || prev.mtime !== n.mtime)) {
          known.set(n.path, { size: n.size, mtime: n.mtime, dir: false });
          emit('changed', n.path, { size: n.size, mtimeMs: n.mtime });
        }
      });
      Array.from(known.keys()).forEach(function (rel) {
        if (!seen.has(rel)) {
          var prev = known.get(rel);
          known.delete(rel);
          emit(prev && prev.dir ? 'dir-removed' : 'removed', rel, null);
        }
      });
    }).catch(function () { /* папку унесли — переживём до следующего тика */ });
  }

  return {
    events: emitter,

    start: function () {
      return primeIndex().then(function (res) {
        if (stopped) return res;
        if (opts.forcePoll || !startNative()) {
          startPolling(opts.forcePoll ? 'Опрос включён вручную' : 'Рекурсивное наблюдение недоступно на этой системе');
        }
        return res;
      });
    },

    stop: function () {
      stopped = true;
      emitDebounced.cancel();
      if (nativeWatcher) {
        try { nativeWatcher.close(); } catch (e) { /* уже закрыт */ }
        nativeWatcher = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },

    mode: function () { return mode; },
    knownCount: function () { return known.size; },
    // Для тестов и для /api/tree: текущее представление о файлах.
    snapshot: function () {
      var out = [];
      known.forEach(function (v, k) {
        out.push({ path: k, size: v.size, mtime: v.mtime, type: v.dir ? 'dir' : 'file' });
      });
      return out;
    }
  };
}

module.exports = {
  createWatcher: createWatcher,
  DEFAULT_DEBOUNCE: DEFAULT_DEBOUNCE,
  DEFAULT_POLL: DEFAULT_POLL
};
